/**
 * Text-changing table commands, as StateCommands so they're testable without
 * a DOM (tests/tables.test.ts). Every edit writes the whole table back with
 * aligned columns.
 */
import { Annotation, EditorSelection, type EditorState, type StateCommand, type TransactionSpec } from '@codemirror/state';
import { findEnclosing } from '../util/markdown';
import {
  cellAt,
  cellEnd,
  cellRange,
  cellSpan,
  deleteColumn,
  deleteRow,
  emptyTable,
  formatTable,
  insertColumn,
  insertRow,
  lineOfRow,
  moveCell,
  moveColumn,
  moveRow,
  nextCell,
  nextRow,
  parseTable,
  previousCell,
  setAlign,
  type Align,
  type Cell,
  type Edit,
  type Table,
} from './model';
import { recalculateRows } from './formula';

/** The table with every formula's stored answer up to date (written on each edit). */
const settled = (table: Table): Table => ({ ...table, rows: recalculateRows(table.rows) });

/** On edits that put the cursor in a table cell: a drawn table moves the focus there. */
export const tableFocus = Annotation.define<boolean>();

export interface TableAt {
  /** Start of the header line and end of the last row. */
  from: number;
  to: number;
  lines: string[];
  table: Table;
}

/** The table at `pos`, if there is one we can edit (not one inside a quote). */
export function tableAt(state: EditorState, pos: number): TableAt | null {
  const node = findEnclosing(state, pos, pos, 'Table');
  if (!node) return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  if (state.sliceDoc(first.from, node.from).trim()) return null;
  const lines: string[] = [];
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text);
  const table = parseTable(lines);
  return table ? { from: first.from, to: last.to, lines, table } : null;
}

/** The cell `pos` is in. */
export function cellOf(state: EditorState, at: TableAt, pos: number): Cell {
  const line = state.doc.lineAt(pos);
  const first = state.doc.lineAt(at.from).number;
  return cellAt(at.lines, line.number - first, pos - line.from);
}

/** Document position of the end of a cell's text (clicking a drawn table). */
export function cellEndPos(state: EditorState, at: TableAt, row: number, col: number): number {
  const r = Math.max(0, Math.min(row, at.table.rows.length - 1));
  const line = state.doc.line(state.doc.lineAt(at.from).number + lineOfRow(r));
  return line.from + cellEnd(at.lines, r, col);
}

/** Document range of a cell's text (null if its row is too short: format the table first). */
export function cellDocRange(state: EditorState, at: TableAt, row: number, col: number): [number, number] | null {
  const span = cellSpan(at.lines, row, col);
  if (!span) return null;
  const line = state.doc.line(state.doc.lineAt(at.from).number + lineOfRow(row));
  return [line.from + span[0], line.from + span[1]];
}

/** The table written neatly aligned, keeping the selection where it is (null: already is). */
export function formatChanges(state: EditorState, at: TableAt): TransactionSpec | null {
  const text = formatTable(settled(at.table)).lines.join('\n');
  if (text === state.sliceDoc(at.from, at.to)) return null;
  return { changes: { from: at.from, to: at.to, insert: text }, userEvent: 'input.table' };
}

/** Write the edited table (or remove it) and put the cursor in its cell. */
function apply(state: EditorState, dispatch: Parameters<StateCommand>[0]['dispatch'], at: TableAt, edit: Edit, userEvent: string, after = ''): void {
  if (!edit.table) {
    // Remove the lines and the line break after them (and one of two blank lines around them).
    const { doc } = state;
    const first = doc.lineAt(at.from).number;
    const last = doc.lineAt(at.to).number;
    const blank = (n: number) => n >= 1 && n <= doc.lines && !doc.line(n).text.trim();
    let to = at.to < doc.length ? at.to + 1 : at.to;
    if (blank(first - 1) && blank(last + 1)) to = Math.min(doc.length, doc.line(last + 1).to + 1);
    const from = to === at.to && at.from > 0 ? at.from - 1 : at.from;
    dispatch(state.update({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true, userEvent: 'delete.table', annotations: tableFocus.of(true) }));
    return;
  }
  const table = settled(edit.table);
  const formatted = formatTable(table);
  const text = formatted.lines.join('\n') + after;
  const [line, cellFrom, cellTo] = cellRange(formatted, table, edit.cell);
  let base = at.from;
  for (let i = 0; i < line; i++) base += formatted.lines[i].length + 1;
  const selection = after
    ? EditorSelection.cursor(at.from + text.length)
    : edit.cell.select && cellTo > cellFrom
      ? EditorSelection.range(base + cellFrom, base + cellTo)
      : EditorSelection.cursor(base + cellFrom + Math.min(edit.cell.offset, cellTo - cellFrom));
  const unchanged = text === state.sliceDoc(at.from, at.to);
  dispatch(
    state.update({
      changes: unchanged ? undefined : { from: at.from, to: at.to, insert: text },
      selection,
      scrollIntoView: true,
      userEvent: unchanged ? 'select' : userEvent,
      annotations: tableFocus.of(true),
    }),
  );
}

/** A command for the table at the cursor; false (so others may run) outside a table. */
function tableCommand(f: (t: Table, cell: Cell) => Edit | null, userEvent = 'input.table'): StateCommand {
  return ({ state, dispatch }) => {
    const head = state.selection.main.head;
    const at = tableAt(state, head);
    if (!at) return false;
    const edit = f(at.table, cellOf(state, at, head));
    if (edit) apply(state, dispatch, at, edit, userEvent);
    return true;
  };
}

/** The cell next to this one; false at the table's edge (so the caller can leave the table). */
export const tableMoveCell =
  (dir: 'up' | 'down' | 'left' | 'right'): StateCommand =>
  ({ state, dispatch }) => {
    const head = state.selection.main.head;
    const at = tableAt(state, head);
    const edit = at && moveCell(at.table, cellOf(state, at, head), dir);
    if (!at || !edit) return false;
    apply(state, dispatch, at, edit, 'input.table');
    return true;
  };

export const tableNextCell = tableCommand(nextCell);
export const tablePreviousCell = tableCommand(previousCell);
export const tableFormat = tableCommand((table, cell) => ({ table, cell }));
export const tableRowAbove = tableCommand((t, c) => insertRow(t, c, false));
export const tableRowBelow = tableCommand((t, c) => insertRow(t, c, true));
export const tableColumnLeft = tableCommand((t, c) => insertColumn(t, c, false));
export const tableColumnRight = tableCommand((t, c) => insertColumn(t, c, true));
export const tableDeleteRow = tableCommand(deleteRow, 'delete.table');
export const tableDeleteColumn = tableCommand(deleteColumn, 'delete.table');
export const tableMoveRowUp = tableCommand((t, c) => moveRow(t, c, false), 'move.table');
export const tableMoveRowDown = tableCommand((t, c) => moveRow(t, c, true), 'move.table');
export const tableMoveColumnLeft = tableCommand((t, c) => moveColumn(t, c, false), 'move.table');
export const tableMoveColumnRight = tableCommand((t, c) => moveColumn(t, c, true), 'move.table');
export const tableDelete = tableCommand((_, cell) => ({ table: null, cell }), 'delete.table');
export const tableAlign = (align: Align) => tableCommand((t, c) => setAlign(t, c, align));

/**
 * Enter: the cell below (a new row after the last). On an empty last row, the
 * row goes away and the cursor leaves the table, a blank line below it.
 */
export const tableEnter: StateCommand = ({ state, dispatch }) => {
  const head = state.selection.main.head;
  const at = tableAt(state, head);
  if (!at) return false;
  const cell = cellOf(state, at, head);
  const { rows } = at.table;
  const last = cell.row === rows.length - 1;
  if (last && cell.row > 0 && rows[cell.row].every((c) => !c)) {
    const table = { ...at.table, rows: rows.slice(0, -1) };
    apply(state, dispatch, at, { table, cell: { row: 0, col: 0, offset: 0 } }, 'input.table', '\n\n');
    return true;
  }
  apply(state, dispatch, at, nextRow(at.table, cell), 'input.table');
  return true;
};

/** A new empty table (3 columns, header and two rows), cursor in the first header cell. */
export const insertTable: StateCommand = ({ state, dispatch }) => {
  const head = state.selection.main.head;
  if (tableAt(state, head)) return false;
  const { doc } = state;
  const line = doc.lineAt(head);
  const indent = /^[ \t]*/.exec(line.text)![0];
  const formatted = formatTable(emptyTable(3, 2, line.text.trim() ? '' : indent));
  const text = formatted.lines.join('\n');
  const blank = (n: number) => n < 1 || n > doc.lines || !doc.line(n).text.trim();
  let from: number, to: number, before: string;
  if (!line.text.trim()) {
    // Use the empty line; a table needs a blank line between it and a paragraph.
    [from, to] = [line.from, line.to];
    before = blank(line.number - 1) ? '' : '\n';
  } else {
    [from, to] = [line.to, line.to];
    before = '\n\n';
  }
  const after = blank(line.number + 1) ? '' : '\n';
  dispatch(
    state.update({
      changes: { from, to, insert: before + text + after },
      selection: { anchor: from + before.length + formatted.cellStarts[0][0] },
      scrollIntoView: true,
      userEvent: 'input.table',
      annotations: tableFocus.of(true),
    }),
  );
  return true;
};
