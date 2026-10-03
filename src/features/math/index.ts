/**
 * Math in notes. Formulas are LaTeX in the Markdown – `$…$` in a line,
 * `$$ … $$` as a block – so the files work in Obsidian, Typora, GitHub and
 * pandoc. In the editor they're always shown typeset (KaTeX), and edited in
 * place with the formula field (WYSIWYG, see field.ts): click a formula, or
 * walk into it with the arrow keys, Backspace or Delete. Ctrl+M starts a
 * formula in the line, Ctrl+Shift+M a block of its own.
 *
 * While a formula is being edited, a StateField holds its range; the field
 * writes every change to the document (so undo, autosave and word count
 * just work), and reloads when something else changes it (undo/redo).
 *
 * Key shortcuts for symbols are the user's own (settings.math.keys: a key,
 * or a sequence like "Mod-m f", → the LaTeX it writes). They work both in
 * text (a new formula is started) and inside formulas.
 */
import { Annotation, Prec, StateEffect, StateField, type ChangeSet, type ChangeSpec, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet, type KeyBinding } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { cursorLineDown, cursorLineUp, redo, undo } from '@codemirror/commands';
import type { SyntaxNode } from '@lezer/common';
import { allCommands, formatKey, keysFor, type EditorCommand } from '../../commands/registry';
import { ChordMatcher, chordBindings, formatKeys, matchesKey, normalizeKey, strokes, type ChordBinding } from '../../commands/keys';
import { getSettings, updateSettings } from '../../settings';
import type { Feature } from '../types';
import { lookupCommand, type MathItem } from './catalog';
import type { Exit } from './editor';
import { MathField, type FieldHost } from './field';
import { renderMath } from './render';
import type { SymbolChoice } from './templates';
import { defaultShortcuts } from './shortcuts';
import { isClosedBlock } from './syntax';

export { mathSyntax } from './syntax';

// --- Formulas in the document ---------------------------------------------------

/** A formula's place in the document. */
export interface Formula {
  /** From the first `$` to after the last. */
  from: number;
  to: number;
  /** A `$$` block on lines of its own. */
  block: boolean;
  /** Number of dollar signs around inline math (2 = `$$x$$` inside a paragraph). */
  dollars: number;
  latex: string;
}

/** What comes before `$$` on its line, as the prefix for the block's other lines ("> ", spaces in lists). */
function linePrefix(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos);
  return line.text.slice(0, pos - line.from).replace(/[-*+]|\d+[.)]/g, (m) => ' '.repeat(m.length));
}

function blockLatex(state: EditorState, from: number, to: number): string {
  const prefix = linePrefix(state, from);
  const lines = state.sliceDoc(from + 2, to - 2).split('\n');
  return lines
    .map((l, i) => (i === 0 ? l : l.startsWith(prefix) ? l.slice(prefix.length) : l.trimStart()))
    .join('\n')
    .trim();
}

function blockSource(state: EditorState, from: number, latex: string): string {
  const prefix = linePrefix(state, from);
  const body = latex
    .split('\n')
    .map((l) => prefix + l)
    .join('\n');
  return `$$\n${body}\n${prefix}$$`;
}

function readFormula(state: EditorState, node: SyntaxNode): Formula | null {
  const marks = node.getChildren('MathMark');
  if (marks.length < 2) return null;
  const open = marks[0];
  const close = marks[marks.length - 1];
  if (node.name === 'InlineMath') {
    const dollars = open.to - open.from;
    return { from: node.from, to: node.to, block: false, dollars, latex: state.sliceDoc(open.to, close.from) };
  }
  if (node.name === 'BlockMath' && isClosedBlock(node)) {
    return { from: open.from, to: close.to, block: true, dollars: 2, latex: blockLatex(state, open.from, close.to) };
  }
  return null;
}

/** Formulas overlapping a range of the document. */
export function formulasIn(state: EditorState, from: number, to: number): Formula[] {
  const out: Formula[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') return false;
      if (node.name !== 'InlineMath' && node.name !== 'BlockMath') return;
      const f = readFormula(state, node.node);
      if (f) out.push(f);
      return false;
    },
  });
  return out;
}

/** The formula at a position (for blocks: anywhere on their lines). */
function formulaAt(state: EditorState, pos: number): Formula | null {
  const { doc } = state;
  for (const f of formulasIn(state, Math.max(0, pos - 1), Math.min(doc.length, pos + 1))) {
    const from = f.block ? doc.lineAt(f.from).from : f.from;
    const to = f.block ? doc.lineAt(f.to).to : f.to;
    if (pos >= from && pos <= to) return f;
  }
  return null;
}

// --- The formula being edited -------------------------------------------------

type Entry = 'start' | 'end' | { x: number; y: number } | { insert: Pick<MathItem, 'latex' | 'action'>; wrap: boolean };

interface Active {
  id: number;
  from: number;
  to: number;
  block: boolean;
  dollars: number;
  entry: Entry;
}

const openEffect = StateEffect.define<Active>();
const closeEffect = StateEffect.define<null>();
/** Marks the field's own writes, so it doesn't reload itself. */
const fieldEdit = Annotation.define<boolean>();

const activeField = StateField.define<Active | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(openEffect)) return e.value;
      if (e.is(closeEffect)) return null;
    }
    if (value && tr.docChanged) {
      // A new, still empty formula grows with what the field writes; otherwise text typed
      // right after the closing $ isn't part of the formula.
      const toAssoc = value.from === value.to ? 1 : -1;
      return { ...value, from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, toAssoc) };
    }
    return value;
  },
});

/** The one open formula field (there's one editor view). */
let current: { id: number; field: MathField; view: EditorView } | null = null;
let nextFieldId = 1;
/** Fields that were closed or left behind (another tab was opened): never reopened from a saved state. */
const finished = new Set<number>();

/** Elements that may take focus without closing the formula (the math panel). */
const focusZones = new Set<Element>();
export function registerFocusZone(el: Element): void {
  focusZones.add(el);
}
export function unregisterFocusZone(el: Element): void {
  focusZones.delete(el);
}

const config = {
  shortcuts: defaultShortcuts(),
  bindings: [] as ChordBinding<string>[],
};

/** Options for a formula field outside the document (the shortcut editor). */
export function fieldOptions(): { shortcuts: ReadonlyMap<string, string>; lookupCommand: typeof lookupCommand } {
  return { shortcuts: config.shortcuts, lookupCommand };
}

/** The typed shortcuts in effect (built-in + the user's). */
export function activeShortcuts(): ReadonlyMap<string, string> {
  return config.shortcuts;
}

/** Shows the right-click menu for a symbol in a formula (set by the math panel, which owns the dialogs). */
let symbolMenu: ((e: MouseEvent, choices: SymbolChoice[]) => void) | null = null;
export function setSymbolMenu(fn: (e: MouseEvent, choices: SymbolChoice[]) => void): void {
  symbolMenu = fn;
}

/** Told when a formula opens or closes for editing (the math panel shows itself then). */
let openListener: ((open: boolean, view: EditorView) => void) | null = null;
export function onFormulaOpenChange(fn: (open: boolean, view: EditorView) => void): void {
  openListener = fn;
}

/** Whether a formula is being edited in this state. */
export function formulaOpenIn(state: EditorState): boolean {
  return !!state.field(activeField, false);
}

/** A field outside the document that panel clicks should go to (the shortcut editor), or null. */
let insertTarget: MathField | null = null;
export function setInsertTarget(field: MathField | null): void {
  insertTarget = field;
}

function latexOf(state: EditorState, a: Active): string {
  if (a.from === a.to) return '';
  if (a.block) return blockLatex(state, a.from, a.to);
  return state.sliceDoc(a.from + a.dollars, a.to - a.dollars);
}

function sourceFor(state: EditorState, a: Active, latex: string): string {
  if (a.block) return blockSource(state, a.from, latex);
  if (!latex) return '';
  // A closing $ can't follow a space.
  const safe = latex.replace(/\\ $/, '\\,');
  const d = '$'.repeat(a.dollars);
  return d + safe + d;
}

function fieldFor(view: EditorView, a: Active): MathField {
  if (current?.id === a.id && current.view === view) return current.field;
  const host: FieldHost = {
    change: (latex) => write(view, a.id, latex),
    exit: (dir) => void close(view, a.id, dir),
    undo: () => void undo(view),
    redo: () => void redo(view),
    userKey: (e) => handleUserKey(view, e),
    key: (e) => handleAppKey(view, e),
    keepsFocus: (el) => !!el && [...focusZones].some((zone) => zone.contains(el)),
    symbolMenu: (e, choices) => symbolMenu?.(e, choices),
  };
  const field = new MathField(
    latexOf(view.state, a),
    { display: a.block, shortcuts: config.shortcuts, lookupCommand },
    host,
  );
  current = { id: a.id, field, view };
  return field;
}

function applyEntry(field: MathField, entry: Entry): void {
  if (entry === 'start') field.placeAtEdge('start');
  else if (entry === 'end') field.placeAtEdge('end');
  else if ('x' in entry) {
    field.draw();
    field.placeFromPoint(entry.x, entry.y);
  } else {
    if (entry.wrap) field.editor.selectAll();
    field.applyItem(entry.insert as MathItem);
    return;
  }
  field.update();
}

/** Write the field's LaTeX into the document (only what changed). Returns the changes. */
function write(view: EditorView, id: number, latex: string): ChangeSet | null {
  const a = view.state.field(activeField, false);
  if (!a || a.id !== id) return null;
  const next = sourceFor(view.state, a, latex);
  const old = view.state.sliceDoc(a.from, a.to);
  if (old === next) return null;
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let endOld = old.length;
  let endNew = next.length;
  while (endOld > start && endNew > start && old[endOld - 1] === next[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const tr = view.state.update({
    changes: { from: a.from + start, to: a.from + endOld, insert: next.slice(start, endNew) },
    annotations: fieldEdit.of(true),
    userEvent: 'input.math',
  });
  view.dispatch(tr);
  return tr.changes;
}

function open(view: EditorView, f: Omit<Formula, 'latex'>, entry: Entry): void {
  const id = nextFieldId++;
  const anchor = f.block ? view.state.doc.lineAt(f.to).to : f.to;
  view.dispatch({
    effects: openEffect.of({ id, from: f.from, to: f.to, block: f.block, dollars: f.dollars, entry }),
    selection: { anchor },
  });
  // The field is in the DOM now: put the cursor where it belongs and take the keyboard at
  // once, so nothing typed goes to the text.
  if (current?.id === id) {
    const { field } = current;
    applyEntry(field, entry);
    field.focus();
  }
}

/**
 * Close the field: tidy its LaTeX, remove it if it's empty, and put the
 * cursor beside it (dir null: focus went elsewhere, leave the cursor be).
 * Returns the changes made, to map positions through.
 */
function close(view: EditorView, id: number, dir: Exit | null): ChangeSet | null {
  const a0 = view.state.field(activeField, false);
  if (!current || current.id !== id || !a0 || a0.id !== id) {
    if (current?.id === id) current = null;
    return null;
  }
  const { field } = current;
  current = null;
  finished.add(id);
  const latex = field.finish();
  const written = field.edited ? write(view, id, latex) : null;
  const a = view.state.field(activeField)!;
  const { doc } = view.state;
  const changes: ChangeSpec[] = [];
  let anchor: number | null = null;
  if (a.block) {
    const first = doc.lineAt(a.from);
    const last = doc.lineAt(a.to);
    if (!latex.trim()) {
      // An empty block goes away, with its line.
      const from = last.to < doc.length ? first.from : Math.max(0, first.from - 1);
      const to = last.to < doc.length ? last.to + 1 : last.to;
      changes.push({ from, to });
      anchor = from;
    } else if (dir === 'left' || dir === 'up') {
      anchor = Math.max(0, first.from - 1);
    } else if (dir === 'right' || dir === 'down') {
      if (last.to < doc.length) anchor = last.to + 1;
      else {
        changes.push({ from: doc.length, insert: '\n' });
        anchor = doc.length + 1;
      }
    }
  } else if (dir === 'left' || dir === 'up') anchor = a.from;
  else if (dir) anchor = a.to;
  const tr = view.state.update({
    changes,
    effects: closeEffect.of(null),
    selection: anchor !== null ? { anchor } : undefined,
    scrollIntoView: dir !== null,
    userEvent: 'select',
  });
  view.dispatch(tr);
  if (!a.block && (dir === 'up' || dir === 'down')) (dir === 'up' ? cursorLineUp : cursorLineDown)(view);
  if (dir !== null) view.focus();
  // Everything that changed while closing.
  return written ? written.compose(tr.changes) : tr.changes;
}

/** Close the open formula field, if any (e.g. before switching tabs). */
export function closeMathField(dir: Exit | null = null): void {
  if (current) close(current.view, current.id, dir);
}

/** Open the formula at a position. */
function openAt(view: EditorView, pos: number, entry: Entry): boolean {
  if (current) {
    const changes = close(current.view, current.id, null);
    if (changes) pos = changes.mapPos(pos);
  }
  const f = formulaAt(view.state, pos);
  if (!f) return false;
  open(view, f, entry);
  return true;
}

/** Start a new formula at the cursor (the selected text becomes its LaTeX). */
function openNew(view: EditorView, block: boolean, entry: Entry): void {
  if (current) close(current.view, current.id, null);
  const { state } = view;
  const sel = state.selection.main;
  const text = state.sliceDoc(sel.from, sel.to);
  if (!block) {
    if (text.trim()) {
      const latex = text.trim();
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: `$${latex}$` } });
      open(view, { from: sel.from, to: sel.from + latex.length + 2, block: false, dollars: 1 }, entry);
    } else {
      open(view, { from: sel.head, to: sel.head, block: false, dollars: 1 }, entry);
    }
    return;
  }
  const line = state.doc.lineAt(sel.head);
  const body = `$$\n${text.trim()}\n$$`;
  let from: number;
  let to: number;
  let insert: string;
  if (!text && line.text.trim() === '') {
    [from, to, insert] = [line.from, line.to, body];
  } else if (!text) {
    [from, to, insert] = [line.to, line.to, '\n' + body];
  } else {
    const before = state.doc.lineAt(sel.from);
    const after = state.doc.lineAt(sel.to);
    const lead = sel.from > before.from ? '\n' : '';
    const trail = sel.to < after.to ? '\n' : '';
    [from, to, insert] = [sel.from, sel.to, lead + body + trail];
  }
  view.dispatch({ changes: { from, to, insert } });
  const start = from + insert.indexOf('$$');
  open(view, { from: start, to: start + body.length, block: true, dollars: 2 }, entry);
}

/**
 * Insert a symbol or template (math panel, key shortcut): into the open
 * formula, or a new formula at the cursor (wrapping selected text).
 */
export function insertMath(view: EditorView, item: Pick<MathItem, 'latex' | 'action'>): void {
  if (insertTarget && !insertTarget.closed) {
    insertTarget.applyItem(item as MathItem);
    return;
  }
  const a = view.state.field(activeField, false);
  if (current && current.view === view && a?.id === current.id && !current.field.closed) {
    current.field.applyItem(item as MathItem);
    return;
  }
  if (item.action) return;
  const sel = view.state.selection.main;
  openNew(view, false, { insert: item, wrap: !sel.empty });
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, {
    mathDebug: {
      active: (state: EditorState) => state.field(activeField, false),
      formulas: (state: EditorState) => formulasIn(state, 0, state.doc.length),
      current: () => current,
    },
  });
}

/** Whether a formula is being edited (the panel shows matrix tools etc.). */
export function mathFieldOpen(): boolean {
  return current !== null && !current.field.closed;
}

// --- Keys ------------------------------------------------------------------------

let chordHint: HTMLElement | null = null;

function showChordHint(keys: string[] | null): void {
  if (!keys) {
    chordHint?.remove();
    chordHint = null;
    return;
  }
  if (!chordHint) {
    chordHint = document.createElement('div');
    chordHint.className = 'math-chord-hint';
    document.body.append(chordHint);
  }
  chordHint.textContent = `${keys.map(formatKey).join(', ')} … trykk neste tast`;
}

const matcher = new ChordMatcher<string>(showChordHint);

function valueToItem(value: string): Pick<MathItem, 'latex' | 'action'> {
  return value.startsWith('@') ? { latex: '', action: value.slice(1) as MathItem['action'] } : { latex: value };
}

/** The user's own math keys and key sequences (in text and in formulas; they come first). */
function handleUserKey(view: EditorView, e: KeyboardEvent): boolean {
  const result = matcher.feed(e, config.bindings, (keys) => chordTimedOut(view, keys));
  if (result === 'pending') {
    e.preventDefault();
    return true;
  }
  if (result) {
    e.preventDefault();
    insertMath(view, valueToItem(result.value));
    return true;
  }
  return false;
}

/** In a formula: the app's own commands that make sense there (Ctrl+S, tabs, Ctrl+M …). */
function handleAppKey(view: EditorView, e: KeyboardEvent): boolean {
  for (const command of allCommands()) {
    if ((command.scope ?? 'markdown') !== 'any' && !command.id.startsWith('math.')) continue;
    if (!keysFor(command.id).some((k) => strokes(k).length === 1 && matchesKey(e, k))) continue;
    // Leave the formula before switching tabs and the like; saving can happen in place.
    if (command.id !== 'file.save' && !command.id.startsWith('math.')) closeMathField(null);
    command.run(view);
    return true;
  }
  return false;
}

/** A sequence's first key was pressed but no second came: run what that key does on its own. */
function chordTimedOut(view: EditorView, keys: string[]): void {
  const exact = config.bindings.find((b) => b.keys.length === keys.length && b.keys.every((k, i) => k === keys[i]));
  if (exact) {
    insertMath(view, valueToItem(exact.value));
    return;
  }
  if (keys.length !== 1) return;
  const command = allCommands().find((c) => keysFor(c.id).some((k) => normalizeKey(k) === keys[0]));
  command?.run(view);
}

/** Entering a formula from the text with the arrow keys, Backspace and Delete. */
function enter(dir: 'left' | 'right' | 'up' | 'down') {
  return (view: EditorView): boolean => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const head = sel.head;
    const { doc } = state;
    const line = doc.lineAt(head);
    const lineOf = (pos: number) => doc.lineAt(pos).number;
    if (dir === 'right') {
      for (const f of formulasIn(state, head, Math.min(doc.length, line.to + 1))) {
        if (!f.block && f.from === head) return openAt(view, f.from, 'start');
        if (f.block && (doc.lineAt(f.from).from === head || (head === line.to && lineOf(f.from) === line.number + 1))) {
          return openAt(view, f.from, 'start');
        }
      }
    } else if (dir === 'left') {
      for (const f of formulasIn(state, Math.max(0, line.from - 1), head)) {
        if (!f.block && f.to === head) return openAt(view, f.from, 'end');
        if (f.block && (doc.lineAt(f.to).to === head || (head === line.from && lineOf(f.to) === line.number - 1))) {
          return openAt(view, f.from, 'end');
        }
      }
    } else {
      const n = line.number + (dir === 'down' ? 1 : -1);
      if (n < 1 || n > doc.lines) return false;
      const target = doc.line(n);
      for (const f of formulasIn(state, target.from, target.to)) {
        if (!f.block) continue;
        if (dir === 'down' && lineOf(f.from) === n) return openAt(view, f.from, 'start');
        if (dir === 'up' && lineOf(f.to) === n) return openAt(view, f.from, 'end');
      }
    }
    return false;
  };
}

const enterKeys: KeyBinding[] = [
  { key: 'ArrowRight', run: enter('right') },
  { key: 'ArrowLeft', run: enter('left') },
  { key: 'ArrowDown', run: enter('down') },
  { key: 'ArrowUp', run: enter('up') },
  { key: 'Backspace', run: enter('left') },
  { key: 'Delete', run: enter('right') },
];

// --- Drawing ------------------------------------------------------------------

/** A typeset formula; clicking it opens it for editing where you clicked. */
class MathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly block: boolean,
    readonly displayStyle: boolean,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.latex === this.latex && other.block === this.block && other.displayStyle === this.displayStyle;
  }

  toDOM(view: EditorView) {
    const el: HTMLElement = document.createElement(this.block ? 'div' : 'span');
    el.className = `cm-math ${this.block ? 'cm-math-block' : 'cm-math-inline'}`;
    if (!this.latex.trim()) {
      el.classList.add('cm-math-empty');
      el.textContent = 'Tom formel';
    } else {
      const { html, error } = renderMath(this.latex, this.block || this.displayStyle);
      el.innerHTML = html;
      if (error) {
        el.classList.add('cm-math-error');
        el.title = `Feil i formelen: ${error}`;
      }
    }
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      openAt(view, view.posAtDOM(el), { x: e.clientX, y: e.clientY });
    });
    // Right click: open the formula there, then offer a shortcut for the symbol clicked.
    el.addEventListener('contextmenu', (e) => {
      if (!symbolMenu) return;
      e.preventDefault();
      if (openAt(view, view.posAtDOM(el), { x: e.clientX, y: e.clientY })) current?.field.contextMenu(e);
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

/** The open formula field, in place of the formula. */
class FieldWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly block: boolean,
  ) {
    super();
  }

  eq(other: FieldWidget) {
    return other.id === this.id;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement(this.block ? 'div' : 'span');
    wrap.className = `cm-math ${this.block ? 'cm-math-block' : 'cm-math-inline'} cm-math-editing`;
    const a = view.state.field(activeField, false);
    if (!a || a.id !== this.id) return wrap;
    if (finished.has(a.id)) {
      // A field left open in a document that was switched away from: just close it.
      queueMicrotask(() => {
        if (view.state.field(activeField, false)?.id === a.id) view.dispatch({ effects: closeEffect.of(null) });
      });
      return wrap;
    }
    const field = fieldFor(view, a);
    field.moving = true;
    wrap.append(field.dom);
    // Draw once laid out (the caret is placed by measuring), and keep the keyboard.
    queueMicrotask(() => {
      field.moving = false;
      if (field.closed || !field.dom.isConnected) return;
      field.draw();
      field.focus();
    });
    requestAnimationFrame(() => {
      if (!field.closed && field.dom.isConnected) field.draw();
    });
    return wrap;
  }

  destroy() {
    // Another document was shown (its state has no open field): the field is done.
    if (!current || current.id !== this.id) return;
    const { view } = current;
    if (view.state.field(activeField, false)?.id === this.id) return; // just redrawn
    finished.add(this.id);
    current.field.finish();
    current = null;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(state: EditorState, typeset: boolean): DecorationSet {
  const a = state.field(activeField, false) ?? null;
  const { doc } = state;
  const decos: Range<Decoration>[] = [];
  if (typeset) {
    for (const f of formulasIn(state, 0, doc.length)) {
      if (a && f.from <= a.to && f.to >= a.from) continue;
      if (f.block) {
        const widget = new MathWidget(f.latex, true, true);
        decos.push(Decoration.replace({ widget, block: true }).range(doc.lineAt(f.from).from, doc.lineAt(f.to).to));
      } else {
        decos.push(Decoration.replace({ widget: new MathWidget(f.latex, false, f.dollars === 2) }).range(f.from, f.to));
      }
    }
  }
  if (a) {
    const widget = new FieldWidget(a.id, a.block);
    if (a.block) decos.push(Decoration.replace({ widget, block: true }).range(doc.lineAt(a.from).from, doc.lineAt(a.to).to));
    else if (a.from === a.to) decos.push(Decoration.widget({ widget, side: 1 }).range(a.from));
    else decos.push(Decoration.replace({ widget }).range(a.from, a.to));
  }
  return Decoration.set(decos, true);
}

function mathDecorations(typeset: boolean) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, typeset),
    update(decos, tr) {
      const changed =
        tr.docChanged ||
        tr.effects.some((e) => e.is(openEffect) || e.is(closeEffect)) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state);
      return changed ? buildDecorations(tr.state, typeset) : decos;
    },
    provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
  });
}

// One instance each, so reconfiguring (settings changes) keeps them.
const typesetDecorations = mathDecorations(true);
const rawDecorations = mathDecorations(false);

/** Undo/redo and other changes from outside reach the open field. */
const syncField = EditorView.updateListener.of((u) => {
  if (!current || current.view !== u.view) return;
  const a = u.state.field(activeField, false);
  if (!a || a.id !== current.id) {
    current = null;
    return;
  }
  if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fieldEdit))) current.field.reload(latexOf(u.state, a));
});

const watchOpen = EditorView.updateListener.of((u) => {
  const open = formulaOpenIn(u.state);
  if (open !== formulaOpenIn(u.startState)) openListener?.(open, u.view);
});

const keyHandler = Prec.highest(EditorView.domEventHandlers({ keydown: (e, view) => handleUserKey(view, e) }));

// --- Feature -----------------------------------------------------------------

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const commands: EditorCommand[] = [
  {
    id: 'math.inline',
    name: 'Formel',
    icon: svg('<path d="M3 13h2l3 7 4-16h9"/><path d="m14 10 5 6M19 10l-5 6"/>'),
    key: 'Mod-m',
    run: (view) => {
      if (current) closeMathField('right');
      else openNew(view, false, 'end');
      return true;
    },
  },
  {
    id: 'math.block',
    name: 'Formelblokk (egen linje, flere linjer)',
    icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M9 7v4M14 9h4M7 15h4M14 14h4M14 16h4"/>'),
    key: 'Mod-Shift-m',
    run: (view) => {
      if (current) closeMathField('right');
      openNew(view, true, 'start');
      return true;
    },
  },
  {
    id: 'math.palette',
    name: 'Vis mattepanelet hele tiden (ellers bare i formler)',
    icon: svg('<path d="M18 4H6l6 8-6 8h12"/>'),
    run: () => {
      updateSettings({ math: { palette: !getSettings().math.palette } });
      return true;
    },
    isActive: () => getSettings().math.palette,
  },
];

export const math: Feature = {
  id: 'math',
  commands,
  extension: (settings) => {
    config.shortcuts = defaultShortcuts(settings.math.shortcuts);
    config.bindings = chordBindings(
      Object.entries(settings.math.keys).filter((entry): entry is [string, string] => !!entry[1]),
    );
    return [
      activeField,
      settings.hideMarkup ? typesetDecorations : rawDecorations,
      syncField,
      watchOpen,
      keyHandler,
      settings.hideMarkup ? Prec.highest(keymap.of(enterKeys)) : [],
    ];
  },
};

/** "Mod-m f" as shown to the user: "Ctrl+M, F". */
export function describeKeys(spec: string): string {
  return formatKeys(spec, formatKey);
}
