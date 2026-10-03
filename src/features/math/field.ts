/**
 * The formula field: WYSIWYG editing of one formula, in place in the
 * document. The model and its behaviour live in MathEditor; this class
 * draws it with KaTeX (every node marked with \htmlData, so clicks and the
 * caret map back to the model), draws its own caret, and turns keys,
 * typing (via a hidden textarea, so dead keys like «^» on a Norwegian
 * keyboard compose properly), clicks and the clipboard into editor calls.
 *
 * Typing «\» shows a list of matching symbols (LaTeX or Norwegian names).
 */
import katex from 'katex';
import { isAltGraph } from '../../commands/keys';
import { previewLatex, searchItems, type MathItem } from './catalog';
import { MathEditor, type Exit, type Pos } from './editor';
import { toLatex } from './latex';
import * as M from './model';
import { renderInto, trust } from './render';
import { symbolChoices, type SymbolChoice } from './templates';

export interface FieldHost {
  /** The formula changed: new LaTeX for the document. */
  change(latex: string): void;
  /** Leave the field, the cursor going this way (null: focus went elsewhere). */
  exit(dir: Exit | null): void;
  undo(): void;
  redo(): void;
  /** The user's own shortcuts, before anything else (they choose exactly what keys do). True if taken. */
  userKey?(e: KeyboardEvent): boolean;
  /** A key the field doesn't use itself (Ctrl+S, tabs …): true if something ran. */
  key(e: KeyboardEvent): boolean;
  /** Elements that may take focus without closing the field (the math panel). */
  keepsFocus(el: Element | null): boolean;
  /** Right click on a symbol: show these choices for making a shortcut. */
  symbolMenu?(e: MouseEvent, choices: SymbolChoice[]): void;
}

export interface FieldOptions {
  display: boolean;
  shortcuts: ReadonlyMap<string, string>;
  lookupCommand?: (name: string) => string | undefined;
  /** Editing a shortcut's template (keeps empty spots as `#?`). */
  template?: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Bounding box of an element's glyphs (without the spacing KaTeX puts after it). */
function glyphRect(el: Element): DOMRect {
  let rect: DOMRect | null = null;
  for (const child of el.children) {
    if (child.classList.contains('mspace')) continue;
    rect = union(rect, child.getBoundingClientRect());
  }
  return rect && rect.width + rect.height > 0 ? rect : el.getBoundingClientRect();
}

/** Distance from a point to a box (vertical distance counts more: rows are wide, not tall). */
function distance(r: DOMRect, x: number, y: number): number {
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
  return dx * dx + dy * dy * 4;
}

function union(a: DOMRect | null, b: DOMRect): DOMRect {
  if (!a) return b;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
}

export class MathField {
  readonly dom: HTMLElement;
  editor: MathEditor;
  /** The user changed something (closing an untouched formula doesn't rewrite it). */
  edited = false;
  closed = false;
  /** Set while the field is being moved in the DOM (moving blurs it). */
  moving = false;
  private readonly view: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly popup: CommandPopup;
  private written: string;
  /** Cursor positions by LaTeX, so undo/redo can put the cursor back. */
  private readonly cursors = new Map<string, number[]>();
  private composing = false;

  constructor(
    latex: string,
    private readonly opts: FieldOptions,
    private readonly host: FieldHost,
  ) {
    this.editor = this.makeEditor(latex);
    this.written = latex;

    this.dom = document.createElement(opts.display ? 'div' : 'span');
    this.dom.className = `mf ${opts.display ? 'mf-display' : 'mf-inline'}`;
    this.view = document.createElement(opts.display ? 'div' : 'span');
    this.view.className = 'mf-view';
    this.caret = document.createElement('span');
    this.caret.className = 'mf-caret';
    this.input = document.createElement('textarea');
    this.input.className = 'mf-input';
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('autocomplete', 'off');
    this.input.setAttribute('autocorrect', 'off');
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Formel');
    this.dom.append(this.view, this.caret, this.input);
    this.popup = new CommandPopup((it) => this.applyItem(it));

    this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('compositionstart', () => (this.composing = true));
    this.input.addEventListener('compositionend', () => {
      this.composing = false;
      this.onInput();
    });
    this.input.addEventListener('copy', (e) => this.onCopy(e, false));
    this.input.addEventListener('cut', (e) => this.onCopy(e, true));
    this.input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        this.editor.paste(text);
        this.update();
      }
    });
    this.input.addEventListener('blur', (e) => this.onBlur(e));
    this.dom.addEventListener('contextmenu', (e) => this.contextMenu(e));
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.placeFromPoint(e.clientX, e.clientY);
      this.focus();
      this.update();
    });
  }

  private makeEditor(latex: string): MathEditor {
    return new MathEditor(latex, {
      display: this.opts.display,
      shortcuts: this.opts.shortcuts,
      lookupCommand: this.opts.lookupCommand,
      template: this.opts.template,
    });
  }

  focus(): void {
    if (document.activeElement !== this.input) this.input.focus({ preventScroll: true });
  }

  hasFocus(): boolean {
    return document.activeElement === this.input;
  }

  /** Put the cursor at the start or end of the whole formula. */
  placeAtEdge(edge: 'start' | 'end'): void {
    const lines = this.editor.lines;
    const row = edge === 'start' ? lines[0] : lines[lines.length - 1];
    this.editor.setCursorPath([lines.indexOf(row), edge === 'start' ? 0 : row.items.length]);
  }

  // --- Drawing ----------------------------------------------------------------

  /** Redraw, and tell the host if the LaTeX changed. */
  update(): void {
    this.draw();
    const latex = this.editor.latex;
    if (latex !== this.written) {
      this.written = latex;
      this.edited = true;
      this.host.change(latex);
    }
    this.cursors.set(latex, this.editor.cursorPath());
    if (this.cursors.size > 200) this.cursors.delete(this.cursors.keys().next().value!);
  }

  draw(): void {
    const { lines } = this.editor;
    try {
      renderInto(this.view, toLatex(lines, { marks: true }), this.opts.display);
    } catch {
      try {
        renderInto(this.view, toLatex(lines, { marks: true, rawAsText: true }), this.opts.display);
      } catch {
        this.view.textContent = this.editor.latex;
      }
    }
    for (const node of this.editor.selectedNodes()) for (const el of this.elementsOf(node)) el.classList.add('mf-sel');
    const { row } = this.editor.pos;
    if (row.items.length === 0) this.view.querySelector(`[data-r="${row.id}"]`)?.classList.add('mf-ph-active');
    this.dom.classList.toggle('mf-empty', this.editor.isEmpty());
    if (this.dom.isConnected) this.placeCaret();
    this.updatePopup();
  }

  private rowElement(r: M.Row): Element | null {
    return this.view.querySelector(`[data-r="${r.id}"]`);
  }

  /** The elements showing a node (for highlighting a selection). */
  private elementsOf(node: M.MathNode): Element[] {
    const el = this.view.querySelector(`[data-a="${node.id}"]`);
    const unwrapped = node.kind === 'scripts' || (el instanceof HTMLElement && el.dataset.m === '1');
    if (!unwrapped) return el ? [el] : [];
    return M.childRows(node)
      .map((r) => this.rowElement(r))
      .filter((e): e is Element => !!e);
  }

  /** Where a node is drawn (screen coordinates). */
  private nodeRect(node: M.MathNode | undefined): DOMRect | null {
    if (!node) return null;
    if (node.kind === 'scripts') {
      let rect: DOMRect | null = null;
      for (const r of M.childRows(node)) {
        const e = this.rowElement(r);
        if (e) rect = union(rect, glyphRect(e));
      }
      return rect;
    }
    const el = this.view.querySelector(`[data-a="${node.id}"]`);
    if (!el) return null;
    if (!(el instanceof HTMLElement) || el.dataset.m !== '1') return glyphRect(el);
    // A node carrying a script is drawn unmarked after an empty marker: it spans from the
    // marker to where the script starts.
    const start = el.getBoundingClientRect();
    const row = node.parent;
    const script = row ? this.nodeRect(row.items[row.items.indexOf(node) + 1]) : null;
    let inner: DOMRect | null = null;
    for (const r of M.childRows(node)) {
      const e = this.rowElement(r);
      if (e) inner = union(inner, e.getBoundingClientRect());
    }
    const right = Math.max(start.left, script ? script.left : (inner?.right ?? start.right));
    let top = start.top;
    let bottom = start.bottom;
    if (inner) {
      top = Math.min(top, inner.top);
      bottom = Math.max(bottom, inner.bottom);
    } else if (bottom - top < 2) {
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 16;
      top = start.top - fontSize * 0.75;
      bottom = start.top + fontSize * 0.25;
    }
    return new DOMRect(start.left, top, right - start.left, bottom - top);
  }

  /** Where the caret goes for a position, relative to the field. */
  caretAt(pos: Pos): { x: number; top: number; height: number } | null {
    const { row, index } = pos;
    const prev = row.items[index - 1];
    const next = row.items[index];
    let x: number | null = null;
    let ref: DOMRect | null = null;
    let rect = this.nodeRect(prev);
    if (rect) {
      x = rect.right;
      // After x²: as tall as the x, not the little 2.
      ref = prev?.kind === 'scripts' ? (this.nodeRect(row.items[index - 2]) ?? rect) : rect;
    } else if ((rect = this.nodeRect(next))) {
      x = rect.left;
      ref = next?.kind === 'scripts' ? (this.nodeRect(row.items[index - 1]) ?? rect) : rect;
    } else {
      const el = this.view.querySelector(`[data-r="${row.id}"]`);
      if (el) {
        ref = el.getBoundingClientRect();
        x = ref.left + (row.items.length === 0 ? ref.width / 2 : 0);
      }
    }
    if (x === null || !ref) {
      const r = this.view.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      ref = r;
      x = r.left + 1;
    }
    const base = this.dom.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(this.dom).fontSize) || 16;
    const height = Math.max(ref.height, fontSize * 1.05);
    const top = ref.top + ref.height / 2 - height / 2;
    return { x: x - base.left, top: top - base.top, height };
  }

  private placeCaret(): void {
    const box = this.caretAt(this.editor.pos);
    this.caret.hidden = !box || this.editor.hasSelection;
    if (!box) return;
    Object.assign(this.caret.style, { left: `${box.x - 1}px`, top: `${box.top}px`, height: `${box.height}px` });
    Object.assign(this.input.style, { left: `${box.x}px`, top: `${box.top}px` });
    // Restart the blink so the caret is visible right after each keystroke.
    this.caret.classList.remove('mf-blink');
    void this.caret.offsetWidth;
    this.caret.classList.add('mf-blink');
  }

  private updatePopup(): void {
    const query = this.editor.pendingCommand();
    if (query === null || !this.dom.isConnected) {
      this.popup.hide();
      return;
    }
    const caret = this.caret.getBoundingClientRect();
    const box = this.dom.getBoundingClientRect();
    this.popup.show(query, caret.left || box.left, Math.max(caret.bottom, box.bottom) + 4);
  }

  // --- Input --------------------------------------------------------------------

  private onInput(): void {
    if (this.composing) return;
    const text = this.input.value;
    this.input.value = '';
    if (!text) return;
    this.editor.type(text);
    this.update();
  }

  private onKeyDown(e: KeyboardEvent): void {
    // The field is its own world: the text editor around it must not see these keys.
    e.stopPropagation();
    if (e.isComposing || this.composing || e.key === 'Dead' || e.key === 'Process') return;
    if (isAltGraph(e)) return; // AltGr+7 = «{» etc.: a character, comes through input
    if (this.host.userKey?.(e)) {
      e.preventDefault();
      return;
    }
    if (this.popup.visible && this.popup.handleKey(e)) {
      e.preventDefault();
      return;
    }
    const ed = this.editor;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    let exit: Exit | null = null;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        if (e.altKey) handled = false;
        else exit = ed.move(e.key === 'ArrowLeft' ? 'left' : 'right', e.shiftKey);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (e.altKey) handled = false;
        else if (mod) ed.insert(e.key === 'ArrowUp' ? '^{#?}' : '_{#?}');
        else exit = ed.moveVertical(e.key === 'ArrowUp' ? 'up' : 'down', (p) => this.caretAt(p)?.x ?? null);
        break;
      case 'Home':
      case 'End':
        ed.edge(e.key === 'Home' ? 'start' : 'end', e.shiftKey);
        break;
      case 'Backspace':
        if (ed.isEmpty() && !ed.hasSelection && ed.pendingCommand() === null) exit = 'left';
        else ed.backspace();
        break;
      case 'Delete':
        ed.deleteForward();
        break;
      case 'Tab':
        exit = ed.tab(e.shiftKey);
        break;
      case 'Enter':
        exit = ed.enter();
        break;
      case 'Escape':
        if (ed.pendingCommand() !== null) ed.cancelCommand();
        else exit = 'right';
        break;
      default:
        handled = false;
    }
    if (!handled && mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.host.undo();
        return;
      }
      if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        this.host.redo();
        return;
      }
      if (k === 'a') {
        ed.selectAll();
        handled = true;
      }
      // Ctrl+C/X/V: the copy/cut/paste events follow.
      if (k === 'c' || k === 'x' || k === 'v') return;
    }
    if (!handled) {
      if (mod || e.altKey || /^F\d+$/.test(e.key)) {
        if (this.host.key(e)) e.preventDefault();
      }
      return; // a character: arrives through the input event
    }
    e.preventDefault();
    e.stopPropagation();
    this.update();
    if (exit) this.host.exit(exit);
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    e.preventDefault();
    const ed = this.editor;
    const text = ed.hasSelection ? ed.selectionLatex() : ed.latex;
    e.clipboardData?.setData('text/plain', text);
    if (cut && ed.hasSelection) {
      ed.backspace();
      this.update();
    }
  }

  private onBlur(e: FocusEvent): void {
    if (this.closed || this.host.keepsFocus(e.relatedTarget as Element | null)) return;
    setTimeout(() => {
      if (this.closed || this.moving || !this.dom.isConnected) return;
      if (document.activeElement === this.input) return;
      // Another window got focus: keep editing when we come back.
      if (!document.hasFocus()) return;
      if (this.host.keepsFocus(document.activeElement)) return;
      this.host.exit(null);
    }, 0);
  }

  /**
   * Put the cursor where the user clicked: beside the symbol clicked on, or
   * the nearest one (generous: clicking a bit off still lands sensibly).
   */
  placeFromPoint(x: number, y: number): void {
    const hit = this.hitTest(x, y);
    if (!hit) return;
    if ('row' in hit) this.editor.placeInRow(hit.row.id, 'end');
    else this.editor.placeAtNode(hit.node.id, hit.before ? 'before' : 'after');
  }

  /** The symbol at (or nearest to) a point, and which half of it; or an empty row. */
  private hitTest(x: number, y: number): { node: M.MathNode; before: boolean } | { row: M.Row } | null {
    const hit = document.elementFromPoint(x, y);
    const el = hit && this.view.contains(hit) ? hit.closest('[data-a],[data-r]') : null;
    const all = M.allRows(this.editor.lines);
    if (el instanceof HTMLElement && el.dataset.a && el.dataset.m !== '1') {
      const id = Number(el.dataset.a);
      const node = all.flatMap((r) => r.items).find((n) => n.id === id);
      const r = glyphRect(el);
      if (node) return { node, before: x < r.left + r.width / 2 };
    }
    // In a row (between symbols, or on one that carries a script) or outside all: the nearest.
    const clickedRow = el instanceof HTMLElement && el.dataset.r ? all.find((r) => r.id === Number(el.dataset.r)) : undefined;
    if (clickedRow && clickedRow.items.length === 0) return { row: clickedRow };
    let best: { node: M.MathNode; before: boolean } | { row: M.Row } | null = null;
    let bestDist = Infinity;
    for (const r of clickedRow ? [clickedRow] : all) {
      if (r.items.length === 0) {
        const rect = this.rowElement(r)?.getBoundingClientRect();
        if (rect && distance(rect, x, y) < bestDist) {
          bestDist = distance(rect, x, y);
          best = { row: r };
        }
        continue;
      }
      for (const node of r.items) {
        if (node.kind === 'scripts') continue; // its rows are found directly
        const rect = this.nodeRect(node);
        if (!rect) continue;
        const d = distance(rect, x, y);
        if (d < bestDist) {
          bestDist = d;
          best = { node, before: x < rect.left + rect.width / 2 };
        }
      }
    }
    return best;
  }

  /** Right click: offer shortcuts for the symbol there, the structures around it, the formula. */
  contextMenu(e: MouseEvent): void {
    if (!this.host.symbolMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const hit = this.hitTest(e.clientX, e.clientY);
    const node = hit && 'node' in hit ? hit.node : hit && 'row' in hit ? hit.row.parent : null;
    const choices = symbolChoices(node, this.editor.selectedNodes(), this.editor.latex);
    this.host.symbolMenu(e, choices);
  }

  // --- From outside (the math panel, undo) --------------------------------------

  /** Insert a panel item (or run its action, like a new matrix row). */
  applyItem(item: MathItem): void {
    const ed = this.editor;
    if (item.action) {
      ed.cancelCommand();
      const actions = {
        addRow: () => ed.addRow(true),
        addRowAbove: () => ed.addRow(false),
        addColumn: () => ed.addColumn(true),
        addColumnLeft: () => ed.addColumn(false),
        deleteRow: () => ed.deleteRow(),
        deleteColumn: () => ed.deleteColumn(),
      };
      actions[item.action]();
    } else if (ed.pendingCommand() !== null) {
      ed.commitCommand(item.latex);
    } else if (item.chem && ed.inChemistry()) {
      ed.type(item.chem);
    } else {
      ed.insert(item.latex);
    }
    this.update();
    this.focus();
  }

  /** The document changed under the field (undo/redo): show that LaTeX. */
  reload(latex: string): void {
    if (latex === this.written) return;
    this.editor = this.makeEditor(latex);
    const path = this.cursors.get(latex);
    if (path) this.editor.setCursorPath(path);
    this.written = latex;
    this.draw();
  }

  /** Tidy up for leaving; the final LaTeX. */
  finish(): string {
    this.closed = true;
    this.popup.hide();
    const latex = this.editor.finish();
    return latex;
  }
}

/** Suggestions while typing a command after «\». */
class CommandPopup {
  private el: HTMLElement | null = null;
  private items: MathItem[] = [];
  private index = 0;
  private query: string | null = null;
  private at = { x: 0, y: 0 };

  constructor(private readonly pick: (item: MathItem) => void) {}

  get visible(): boolean {
    return this.el !== null && this.items.length > 0;
  }

  show(query: string, x: number, y: number): void {
    if (query !== this.query) {
      this.query = query;
      this.items = query ? searchItems(query, 8).filter((it) => !it.action) : [];
      this.index = 0;
    }
    this.at = { x, y };
    this.render();
  }

  private render(): void {
    const { x, y } = this.at;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'mf-popup';
      this.el.setAttribute('role', 'listbox');
      document.body.append(this.el);
    }
    this.el.hidden = this.items.length === 0;
    this.el.replaceChildren(
      ...this.items.map((it, i) => {
        const row = document.createElement('div');
        row.className = `mf-popup-item${i === this.index ? ' active' : ''}`;
        row.setAttribute('role', 'option');
        const preview = document.createElement('span');
        preview.className = 'mf-popup-preview';
        try {
          preview.innerHTML = katex.renderToString(previewLatex(it), { throwOnError: true, strict: 'ignore', trust });
        } catch {
          preview.textContent = it.latex;
        }
        const name = document.createElement('span');
        name.textContent = it.name;
        row.append(preview, name);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.pick(it);
        });
        return row;
      }),
    );
    const hint = document.createElement('div');
    hint.className = 'mf-popup-hint';
    hint.textContent = 'Enter velger · Esc avbryter';
    if (this.items.length) this.el.append(hint);
    const width = this.el.offsetWidth;
    this.el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 8))}px`;
    const height = this.el.offsetHeight;
    this.el.style.top = `${y + height > window.innerHeight - 8 ? Math.max(4, y - height - 40) : y}px`;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
    this.query = null;
    this.items = [];
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.items.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.index = (this.index + step + this.items.length) % this.items.length;
      this.render();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ' ') {
      this.pick(this.items[this.index]);
      return true;
    }
    return false;
  }
}
