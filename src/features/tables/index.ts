/**
 * Tables (GFM), edited like in Word: the table is always drawn, and each cell
 * is a small text field. Click a cell (or arrow into the table) and type;
 * only that cell's own Markdown shows while it is being edited (`**fet**`),
 * never the pipes and dashes. Tab / Shift+Tab go between cells (a new row
 * after the last), Enter to the row below (on an empty last row: out of the
 * table), the arrow keys move between cells and out of the table, Esc leaves.
 * Every typed character is written to the document at once (undo, autosave
 * and word count work as usual); moving between cells writes the Markdown
 * back with aligned columns. Rows, columns and alignment: right click, or the
 * table button. With markup shown (`hideMarkup: false`) tables stay Markdown,
 * in a monospace font, and Tab/Enter work there too.
 */
import { Prec, StateField, type EditorState, type Range, type StateCommand } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type Command, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { parseDocument, type Block, type Inline } from '../../export/document';
import { commandsForKey } from '../../commands/keys';
import { showContextMenu, showMenuUnder, type MenuItem } from '../../ui/contextMenu';
import { renderInto } from '../math/render';
import type { Feature } from '../types';
import {
  cellDocRange,
  cellOf,
  formatChanges,
  insertTable,
  tableAlign,
  tableAt,
  tableColumnLeft,
  tableColumnRight,
  tableDelete,
  tableDeleteColumn,
  tableDeleteRow,
  tableEnter,
  tableFocus,
  tableFormat,
  tableMoveCell,
  tableMoveColumnLeft,
  tableMoveColumnRight,
  tableMoveRowDown,
  tableMoveRowUp,
  tableNextCell,
  tablePreviousCell,
  tableRowAbove,
  tableRowBelow,
  type TableAt,
} from './commands';
import { cellFormula, cellName, columnName, computeTable, formatValue, FormulaError, type Value } from './formula';
import { parseTable } from './model';

type TableBlock = Extract<Block, { t: 'table' }>;

const run = (command: StateCommand) => (view: EditorView) => command(view);

// --- Cell text: what the field shows ⇄ what the Markdown says ------------------------

/**
 * In the field a pipe is just a pipe (in the Markdown it must be escaped), and a
 * computed cell shows its formula, not the stored answer.
 */
const shown = (raw: string) => cellFormula(raw) ?? raw.replace(/\\\|/g, '|');
const written = (text: string) => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

// --- Drawing ---------------------------------------------------------------------------

function renderInlines(parent: HTMLElement, items: Inline[]): void {
  for (const item of items) {
    switch (item.t) {
      case 'text':
        parent.append(item.text);
        break;
      case 'code': {
        const el = document.createElement('code');
        el.className = 'cm-inline-code';
        el.textContent = item.text;
        parent.append(el);
        break;
      }
      case 'math': {
        const el = document.createElement('span');
        renderInto(el, item.latex, false);
        parent.append(el);
        break;
      }
      case 'image': {
        const el = document.createElement('span');
        el.className = 'cm-table-image';
        el.textContent = item.alt || 'bilde';
        parent.append(el);
        break;
      }
      case 'break':
        parent.append(document.createElement('br'));
        break;
      default: {
        const tag = { strong: 'strong', em: 'em', strike: 's', sup: 'sup', sub: 'sub', link: 'span' }[item.t];
        const el = document.createElement(tag);
        if (item.t === 'link') {
          el.className = 'cm-table-link';
          el.title = item.href;
        }
        renderInlines(el, item.children);
        parent.append(el);
      }
    }
  }
}

/** The table as the export model sees it (cells as inline content, alignment). */
function parseBlock(source: string): TableBlock | null {
  // Indented tables (in list items) would read as code blocks: parse them flush left.
  const indent = /^[ \t]*/.exec(source)![0].length;
  const text = source
    .split('\n')
    .map((l) => l.slice(Math.min(indent, /^[ \t]*/.exec(l)![0].length)))
    .join('\n');
  const block = parseDocument(text).find((b) => b.t === 'table');
  return block?.t === 'table' ? block : null;
}

const cellContent = (block: TableBlock, row: number, col: number): Inline[] =>
  (row === 0 ? block.head : block.rows[row - 1])?.[col] ?? [];

/** A drawn table: cells as inline content, their Markdown, and what each computes to. */
interface Drawn {
  block: TableBlock;
  raw: string[][];
  values: Value[][];
}

function parseDrawn(source: string): Drawn | null {
  const block = parseBlock(source);
  const raw = parseTable(source.split('\n'))?.rows;
  if (!block || !raw) return null;
  return { block, raw, values: computeTable(raw) };
}

/** The latest parse of each drawn table, for putting a cell back when it's left. */
const blocks = new WeakMap<HTMLElement, Drawn>();

const editing = (td: HTMLElement) => td.dataset.editing === 'true';

/** Show a cell's drawn content (when it isn't being edited); a formula shows its answer, live. */
function drawCell(td: HTMLElement, drawn: Drawn): void {
  const row = Number(td.dataset.row);
  const col = Number(td.dataset.col);
  const formula = cellFormula(drawn.raw[row]?.[col] ?? '');
  td.replaceChildren();
  td.classList.toggle('cm-table-formula', formula !== null);
  td.classList.remove('cm-table-error');
  td.title = '';
  if (formula) {
    const value = drawn.values[row][col];
    td.textContent = formatValue(value);
    td.title = `${cellName(row, col)}: ${formula}`;
    if (value instanceof FormulaError) td.classList.add('cm-table-error');
  } else {
    renderInlines(td, cellContent(drawn.block, row, col));
  }
  const align = drawn.block.align[col];
  // Numbers line up on the right unless the column says otherwise.
  td.style.textAlign = align ?? (formula && typeof drawn.values[row][col] === 'number' ? 'right' : '');
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'cm-table-widget';
    const drawn = parseDrawn(this.source);
    if (!drawn) {
      root.textContent = this.source;
      return root;
    }
    blocks.set(root, drawn);
    const { block } = drawn;
    const table = document.createElement('table');
    const label = (text: string) => {
      const th = document.createElement('th');
      th.className = 'cm-table-ref';
      th.textContent = text;
      th.contentEditable = 'false';
      return th;
    };
    const addRow = (parent: HTMLElement, row: number, width: number) => {
      const tr = document.createElement('tr');
      // Row numbers, shown while a formula is written.
      tr.append(label(String(row + 1)));
      for (let col = 0; col < width; col++) {
        const td = document.createElement(row === 0 ? 'th' : 'td');
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        // Editable straight away, so a click puts the caret there.
        td.contentEditable = 'plaintext-only';
        if (td.contentEditable !== 'plaintext-only') td.contentEditable = 'true';
        td.spellcheck = true;
        drawCell(td, drawn);
        wireCell(view, root, td);
        tr.append(td);
      }
      parent.append(tr);
    };
    const width = block.align.length;
    const head = document.createElement('thead');
    // Column letters, shown while a formula is written.
    const letters = document.createElement('tr');
    letters.className = 'cm-table-ref-row';
    letters.append(label(''));
    for (let col = 0; col < width; col++) letters.append(label(columnName(col)));
    head.append(letters);
    addRow(head, 0, width);
    const body = document.createElement('tbody');
    block.rows.forEach((_, i) => addRow(body, i + 1, width));
    table.append(head, body);
    root.append(table);
    return root;
  }

  /** Same shape: redraw the cells in place, so the one being edited keeps focus and caret. */
  updateDOM(dom: HTMLElement) {
    const drawn = parseDrawn(this.source);
    const old = blocks.get(dom)?.block;
    if (!drawn || !old || drawn.block.align.length !== old.align.length || drawn.block.rows.length !== old.rows.length) return false;
    blocks.set(dom, drawn);
    // Every cell again, not just the changed one: formulas elsewhere may depend on it.
    for (const td of dom.querySelectorAll<HTMLElement>('[data-row]')) {
      if (!editing(td)) drawCell(td, drawn);
    }
    return true;
  }

  ignoreEvent() {
    return true;
  }
}

// --- Editing a cell ----------------------------------------------------------------------

/** The table a drawn table shows, and the cell a field is. */
function locate(view: EditorView, root: HTMLElement, td: HTMLElement): { at: TableAt; row: number; col: number } | null {
  if (!root.isConnected) return null;
  const at = tableAt(view.state, view.posAtDOM(root));
  return at ? { at, row: Number(td.dataset.row), col: Number(td.dataset.col) } : null;
}

/** Document range of the cell's text; pads a short row first. */
function cellRange(view: EditorView, root: HTMLElement, td: HTMLElement): [number, number] | null {
  let found = locate(view, root, td);
  if (!found) return null;
  let range = cellDocRange(view.state, found.at, found.row, found.col);
  if (!range) {
    const format = formatChanges(view.state, found.at);
    if (format) view.dispatch(format);
    found = locate(view, root, td);
    range = found && cellDocRange(view.state, found.at, found.row, found.col);
  }
  return range ?? null;
}

function setCaret(td: HTMLElement, how: { offset?: number; select?: boolean }): void {
  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const text = td.firstChild;
  if (how.select || !text) {
    range.selectNodeContents(td);
    if (!how.select) range.collapse(false);
  } else {
    const at = Math.min(how.offset ?? Infinity, text.textContent!.length);
    range.setStart(text, at);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Caret offset in the field, and whether it's collapsed. */
function caretIn(td: HTMLElement): { offset: number; collapsed: boolean; length: number } {
  const sel = document.getSelection();
  const length = td.textContent?.length ?? 0;
  if (!sel || !sel.rangeCount) return { offset: length, collapsed: true, length };
  const range = sel.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(td);
  before.setEnd(range.endContainer, range.endOffset);
  return { offset: before.toString().length, collapsed: range.collapsed, length };
}

/** Turn a drawn cell into a text field showing its Markdown. */
function startEditing(view: EditorView, root: HTMLElement, td: HTMLElement): void {
  if (editing(td)) return;
  const range = cellRange(view, root, td);
  if (!range) return;
  td.dataset.editing = 'true';
  td.textContent = shown(view.state.sliceDoc(...range));
  // The editor's cursor follows, so commands (menu, toolbar) know the cell.
  view.dispatch({ selection: { anchor: range[1] }, userEvent: 'select' });
}

function stopEditing(view: EditorView, root: HTMLElement, td: HTMLElement): void {
  if (!editing(td)) return;
  delete td.dataset.editing;
  root.classList.remove('cm-table-show-refs');
  const drawn = blocks.get(root);
  if (drawn) drawCell(td, drawn);
  // Leaving the table: write it back neatly aligned.
  setTimeout(() => {
    if (root.contains(document.activeElement)) return;
    const found = locate(view, root, td);
    const format = found && formatChanges(view.state, found.at);
    if (format) view.dispatch(format);
  });
}

/** Write what's in the field to the document (just the part that changed). */
function writeCell(view: EditorView, root: HTMLElement, td: HTMLElement): void {
  const range = cellRange(view, root, td);
  if (!range) return;
  const old = view.state.sliceDoc(...range);
  const next = written(td.textContent ?? '');
  if (old === next) return;
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let end = 0;
  while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++;
  const from = range[0] + start;
  const insert = next.slice(start, next.length - end);
  view.dispatch({
    changes: { from, to: range[1] - end, insert },
    selection: { anchor: from + insert.length },
    userEvent: insert ? 'input.type' : 'delete',
  });
}

/** The drawn table for the table starting at `from`. */
function widgetAt(view: EditorView, from: number): HTMLElement | null {
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-widget')) {
    if (view.posAtDOM(el) === from) return el;
  }
  return null;
}

/** Move the focus to the cell holding the editor's cursor (after Tab, menu commands, undo …). */
function focusSelection(view: EditorView): void {
  const sel = view.state.selection.main;
  const at = tableAt(view.state, sel.head);
  const root = at && widgetAt(view, at.from);
  if (!at || !root) {
    // Out of the table (the cell that had the focus may be gone): back to the text.
    if (!view.hasFocus) view.focus();
    return;
  }
  const cell = cellOf(view.state, at, sel.head);
  const td = root.querySelector<HTMLElement>(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
  if (!td) return;
  const range = cellDocRange(view.state, at, cell.row, cell.col);
  const raw = range ? view.state.sliceDoc(...range) : '';
  if (editing(td) && td.textContent !== shown(raw)) td.textContent = shown(raw);
  td.focus();
  startEditing(view, root, td);
  setCaret(td, sel.empty ? { offset: shown(raw.slice(0, Math.max(0, sel.head - (range?.[0] ?? 0)))).length } : { select: true });
}

/** Put the editor's cursor just before or after the table, and the focus back in the text. */
function leaveTable(view: EditorView, root: HTMLElement, after: boolean): void {
  const at = tableAt(view.state, view.posAtDOM(root));
  if (!at) return;
  const { doc } = view.state;
  if (after) {
    if (at.to < doc.length) view.dispatch({ selection: { anchor: at.to + 1 }, scrollIntoView: true });
    else view.dispatch({ changes: { from: at.to, insert: '\n' }, selection: { anchor: at.to + 1 }, scrollIntoView: true });
  } else {
    if (at.from > 0) view.dispatch({ selection: { anchor: at.from - 1 }, scrollIntoView: true });
    else view.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 }, scrollIntoView: true });
  }
  view.focus();
}

/** Ctrl+B / Ctrl+I / Ctrl+E in a cell: put the marks around the selected text (or take them away). */
function wrapInCell(td: HTMLElement, mark: string): void {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return;
  const selected = sel.toString();
  const wrapped = selected.length > 2 * mark.length && selected.startsWith(mark) && selected.endsWith(mark);
  const insert = wrapped ? selected.slice(mark.length, -mark.length) : mark + selected + mark;
  // execCommand keeps the field's own undo and fires "input" like typing does.
  document.execCommand('insertText', false, insert);
  if (!selected) {
    const caret = caretIn(td).offset - mark.length;
    setCaret(td, { offset: caret });
  }
}

const isFormula = (td: HTMLElement) => (td.textContent ?? '').trim().startsWith('=');

/** Column letters and row numbers, while a formula is being written. */
function showRefs(root: HTMLElement, td: HTMLElement): void {
  root.classList.toggle('cm-table-show-refs', isFormula(td));
}

/**
 * Writing a formula and clicking another cell puts that cell's address in the
 * formula, as in Excel (Shift+click right after an address makes a range: B2:B5).
 */
function insertReference(formulaCell: HTMLElement, target: HTMLElement, range: boolean): void {
  const name = cellName(Number(target.dataset.row), Number(target.dataset.col));
  const before = (formulaCell.textContent ?? '').slice(0, caretIn(formulaCell).offset);
  const extend = range && /[A-Za-z]{1,3}\d+$/.test(before);
  document.execCommand('insertText', false, extend ? `:${name}` : name);
}

function wireCell(view: EditorView, root: HTMLElement, td: HTMLElement): void {
  td.addEventListener('focus', () => {
    startEditing(view, root, td);
    showRefs(root, td);
    if (!document.getSelection()?.rangeCount || !td.contains(document.getSelection()!.anchorNode)) setCaret(td, {});
  });
  td.addEventListener('mousedown', (e) => {
    const writing = root.querySelector<HTMLElement>('[data-editing]');
    if (e.button === 0 && writing && writing !== td && isFormula(writing)) {
      // Keep the focus (and caret) in the formula.
      e.preventDefault();
      insertReference(writing, td, e.shiftKey);
      return;
    }
    // The first click turns the drawn cell into its text: put the caret at the end.
    if (e.button === 0 && !editing(td)) {
      e.preventDefault();
      td.focus();
      setCaret(td, {});
    }
  });
  td.addEventListener('blur', () => stopEditing(view, root, td));
  td.addEventListener('input', () => {
    showRefs(root, td);
    writeCell(view, root, td);
  });
  td.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text.replace(/\s*\r?\n\s*/g, ' '));
  });
  td.addEventListener('contextmenu', (e) => {
    if (!editing(td)) {
      td.focus();
      setCaret(td, {});
    }
    showContextMenu(e, tableMenu(view));
  });
  td.addEventListener('keydown', (e) => onCellKey(view, root, td, e));
}

function onCellKey(view: EditorView, root: HTMLElement, td: HTMLElement, e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  const caret = caretIn(td);
  const done = () => {
    e.preventDefault();
    e.stopPropagation();
  };
  // Keep the editor's cursor on the caret, so commands act on this cell.
  const sync = () => {
    const range = cellRange(view, root, td);
    if (range) view.dispatch({ selection: { anchor: Math.min(range[1], range[0] + caret.offset) }, userEvent: 'select' });
  };
  const move = (dir: 'up' | 'down' | 'left' | 'right') => {
    done();
    sync();
    if (!tableMoveCell(dir)(view)) leaveTable(view, root, dir === 'down' || dir === 'right');
  };
  if (e.altKey && !mod) return;
  switch (e.key) {
    case 'Tab':
      done();
      sync();
      (e.shiftKey ? tablePreviousCell : tableNextCell)(view);
      return;
    case 'Enter':
      done();
      if (!mod && !e.shiftKey) {
        sync();
        tableEnter(view);
      }
      return;
    case 'Escape':
      done();
      leaveTable(view, root, true);
      return;
    case 'ArrowUp':
    case 'ArrowDown':
      if (e.shiftKey || mod) return;
      move(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    case 'ArrowLeft':
      if (!e.shiftKey && !mod && caret.collapsed && caret.offset === 0) move('left');
      return;
    case 'ArrowRight':
      if (!e.shiftKey && !mod && caret.collapsed && caret.offset === caret.length) move('right');
      return;
  }
  if (mod && !e.altKey && !e.shiftKey) {
    // Select all = the cell's text (not the whole document).
    if (e.key.toLowerCase() === 'a') {
      done();
      setCaret(td, { select: true });
      return;
    }
    const mark = { b: '**', i: '*', e: '`' }[e.key.toLowerCase()];
    if (mark) {
      done();
      wrapInCell(td, mark);
      return;
    }
  }
  // App commands (save, undo, new tab …): the editor ignores keys from inside a drawn table.
  if (mod || /^F\d+$/.test(e.key)) {
    sync();
    for (const command of commandsForKey(e)) {
      if (command.run(view)) {
        done();
        focusSelection(view);
        return;
      }
    }
  }
}

// --- Decorations -----------------------------------------------------------------------

const tableLine = Decoration.line({ class: 'cm-table-line' });
const delimiterLine = Decoration.line({ class: 'cm-table-line cm-table-delimiter' });

function build(state: EditorState, draw: boolean): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { doc } = state;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      if (node.name !== 'Table') return;
      const at = tableAt(state, node.from);
      if (!at) return false;
      if (draw) {
        decos.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(at.from, at.to)), block: true }).range(at.from, at.to));
      } else {
        const first = doc.lineAt(at.from).number;
        for (let n = first; n <= doc.lineAt(at.to).number; n++) {
          decos.push((n === first + 1 ? delimiterLine : tableLine).range(doc.line(n).from));
        }
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

// Block replacements must come from a state field.
function tableField(draw: boolean) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, draw),
    update(value, tr) {
      if (!tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) return value;
      return build(tr.state, draw);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

// One instance each, so reconfiguring (settings changes) keeps the drawn tables.
const drawn = tableField(true);
const plain = tableField(false);

/** Table commands put the editor's cursor in a cell: give that cell the focus. */
const followCursor = EditorView.updateListener.of((u) => {
  if (u.transactions.some((tr) => tr.annotation(tableFocus))) focusSelection(u.view);
});

/**
 * When the editor gets the focus with its cursor in a drawn table (a toolbar
 * button, Angre …), the cell gets it instead.
 */
const focusIntoCell = EditorView.domEventHandlers({
  focus(_event, view) {
    requestAnimationFrame(() => {
      if (view.hasFocus && tableAt(view.state, view.state.selection.main.head)) focusSelection(view);
    });
    return false;
  },
});

/** Arrow keys from the text into a drawn table: its first (last) row. */
function arrowInto(dir: 'up' | 'down' | 'left' | 'right'): Command {
  return (view) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const { doc } = view.state;
    const line = doc.lineAt(sel.head);
    const down = dir === 'down' || dir === 'right';
    if (dir === 'right' && sel.head !== line.to) return false;
    if (dir === 'left' && sel.head !== line.from) return false;
    // Up/down only when leaving the line (a long line wraps over several screen lines).
    if ((dir === 'up' || dir === 'down') && doc.lineAt(view.moveVertically(sel, down).head).number === line.number) return false;
    const n = line.number + (down ? 1 : -1);
    if (n < 1 || n > doc.lines) return false;
    const target = doc.line(n);
    const at = tableAt(view.state, down ? target.from : target.to);
    if (!at || (down ? at.from !== target.from : at.to !== target.to)) return false;
    const row = down ? 0 : at.table.rows.length - 1;
    const col = dir === 'left' ? at.table.align.length - 1 : 0;
    const range = cellDocRange(view.state, at, row, col);
    const pos = range ? (dir === 'right' ? range[0] : range[1]) : at.from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, annotations: tableFocus.of(true) });
    return true;
  };
}

// --- Menus -------------------------------------------------------------------------------

function tableMenu(view: EditorView): MenuItem[] {
  const item = (label: string, command: StateCommand): MenuItem => ({ label, action: () => command(view) });
  return [
    { heading: 'Tabell' },
    item('Ny rad over', tableRowAbove),
    item('Ny rad under', tableRowBelow),
    item('Ny kolonne til venstre', tableColumnLeft),
    item('Ny kolonne til høyre', tableColumnRight),
    'separator',
    item('Flytt raden opp', tableMoveRowUp),
    item('Flytt raden ned', tableMoveRowDown),
    item('Flytt kolonnen til venstre', tableMoveColumnLeft),
    item('Flytt kolonnen til høyre', tableMoveColumnRight),
    'separator',
    item('Venstrejuster kolonnen', tableAlign('left')),
    item('Midtstill kolonnen', tableAlign('center')),
    item('Høyrejuster kolonnen', tableAlign('right')),
    'separator',
    item('Slett raden', tableDeleteRow),
    item('Slett kolonnen', tableDeleteColumn),
    item('Slett tabellen', tableDelete),
  ];
}

/** Right click in a table's Markdown (markup shown). */
const contextMenu = EditorView.domEventHandlers({
  contextmenu(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null || !tableAt(view.state, pos)) return false;
    if (!tableAt(view.state, view.state.selection.main.head)) view.dispatch({ selection: { anchor: pos } });
    showContextMenu(event, tableMenu(view));
    return true;
  },
});

/** The toolbar button: a new table, or (in a table) the table menu. */
function tableButton(view: EditorView): boolean {
  if (!tableAt(view.state, view.state.selection.main.head)) return insertTable(view);
  const button = document.querySelector<HTMLElement>('[data-command="table.insert"]');
  if (button) showMenuUnder(button, tableMenu(view));
  return true;
}

const inTable = (state: EditorState) => tableAt(state, state.selection.main.head) !== null;

const tableIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>';

export const tables: Feature = {
  id: 'tables',
  extension: (settings) => [
    settings.hideMarkup ? [drawn, followCursor, focusIntoCell] : [plain, contextMenu],
    // Before lists and code blocks, which also use Tab and Enter.
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: run(tableNextCell), shift: run(tablePreviousCell) },
        { key: 'Enter', run: run(tableEnter) },
        ...(settings.hideMarkup
          ? (['up', 'down', 'left', 'right'] as const).map((dir) => ({
              key: `Arrow${dir[0].toUpperCase()}${dir.slice(1)}`,
              run: arrowInto(dir),
            }))
          : []),
      ]),
    ),
  ],
  commands: [
    { id: 'table.insert', name: 'Tabell', icon: tableIcon, run: tableButton, isActive: inTable },
    { id: 'table.rowBelow', name: 'Tabell: ny rad under', run: run(tableRowBelow), isEnabled: inTable },
    { id: 'table.rowAbove', name: 'Tabell: ny rad over', run: run(tableRowAbove), isEnabled: inTable },
    { id: 'table.columnRight', name: 'Tabell: ny kolonne til høyre', run: run(tableColumnRight), isEnabled: inTable },
    { id: 'table.columnLeft', name: 'Tabell: ny kolonne til venstre', run: run(tableColumnLeft), isEnabled: inTable },
    { id: 'table.moveRowUp', name: 'Tabell: flytt raden opp', run: run(tableMoveRowUp), isEnabled: inTable },
    { id: 'table.moveRowDown', name: 'Tabell: flytt raden ned', run: run(tableMoveRowDown), isEnabled: inTable },
    { id: 'table.moveColumnLeft', name: 'Tabell: flytt kolonnen til venstre', run: run(tableMoveColumnLeft), isEnabled: inTable },
    { id: 'table.moveColumnRight', name: 'Tabell: flytt kolonnen til høyre', run: run(tableMoveColumnRight), isEnabled: inTable },
    { id: 'table.alignLeft', name: 'Tabell: venstrejuster kolonnen', run: run(tableAlign('left')), isEnabled: inTable },
    { id: 'table.alignCenter', name: 'Tabell: midtstill kolonnen', run: run(tableAlign('center')), isEnabled: inTable },
    { id: 'table.alignRight', name: 'Tabell: høyrejuster kolonnen', run: run(tableAlign('right')), isEnabled: inTable },
    { id: 'table.deleteRow', name: 'Tabell: slett raden', run: run(tableDeleteRow), isEnabled: inTable },
    { id: 'table.deleteColumn', name: 'Tabell: slett kolonnen', run: run(tableDeleteColumn), isEnabled: inTable },
    { id: 'table.delete', name: 'Tabell: slett tabellen', run: run(tableDelete), isEnabled: inTable },
    { id: 'table.format', name: 'Tabell: rett opp kolonnene', run: run(tableFormat), isEnabled: inTable },
  ],
};
