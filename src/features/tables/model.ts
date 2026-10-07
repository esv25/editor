/**
 * GFM tables as plain data: reading the lines of a table, writing them back
 * neatly aligned, and where a cursor is (row, column, offset in the cell).
 * No CodeMirror here (tested in tests/tables.test.ts).
 */

import { remapRows, type IndexMap } from './formula';

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
  /** Whitespace before every line (tables in list items). */
  indent: string;
  /** Cell texts, trimmed. Row 0 is the header; the delimiter row isn't here. */
  rows: string[][];
  /** One per column. */
  align: Align[];
}

/** A place in a table. `offset` is in the cell's (trimmed) text; past the end = at the end. */
export interface Cell {
  row: number;
  col: number;
  offset: number;
  /** Select the cell's text instead of placing a cursor (Tab, like Word). */
  select?: boolean;
}

/** A cell's text and where it lies in its line (trimmed; an empty cell is a point). */
interface Segment {
  text: string;
  from: number;
  to: number;
  /** Just after the pipe before it. */
  start: number;
}

/** The cells of one line, split at unescaped pipes (also inside code, as in GFM). */
function segments(line: string): Segment[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '|') pipes.push(i);
  }
  const bounds = [-1, ...pipes, line.length];
  const out: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const rawFrom = bounds[i] + 1;
    const raw = line.slice(rawFrom, bounds[i + 1]);
    const text = raw.trim();
    const lead = raw.length - raw.trimStart().length;
    // An empty cell "|   |": its point is just after the pipe and a space.
    const from = text ? rawFrom + lead : Math.min(rawFrom + 1, bounds[i + 1]);
    out.push({ text, from, to: from + text.length, start: rawFrom });
  }
  // The pipes at the ends are borders, not cells.
  if (out.length > 1 && !out[0].text && pipes.length && !line.slice(0, pipes[0]).trim()) out.shift();
  if (out.length > 1 && !out[out.length - 1].text && pipes.length && !line.slice(pipes[pipes.length - 1] + 1).trim()) out.pop();
  return out;
}

/**
 * A cell's Markdown as it is typed in a field, where a pipe is just a pipe. A pipe
 * belongs to the cell when an odd run of backslashes stands before it; the last of
 * them is the table's escape.
 */
export function pipesUnescaped(raw: string): string {
  return raw.replace(/\\+\|/g, (m) => (m.length % 2 === 0 ? m.slice(0, -2) + '|' : m));
}

/**
 * The other way: every pipe not already escaped gets a backslash, and a backslash at
 * the end gets a partner, so neither can turn a pipe into a cell border. Markdown
 * shows the text the same either way.
 */
export function pipesEscaped(text: string): string {
  return text
    .replace(/\\*\|/g, (m) => (m.length % 2 === 1 ? m.slice(0, -1) + '\\|' : m))
    .replace(/\\+$/, (m) => (m.length % 2 === 1 ? m + '\\' : m));
}

const DELIMITER_CELL = /^:?-+:?$/;

export function isDelimiterRow(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = segments(line);
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c.text));
}

function alignOf(spec: string): Align {
  const left = spec.startsWith(':');
  const right = spec.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Read a table from its lines (header, delimiter row, body rows), or null if it isn't one. */
export function parseTable(lines: string[]): Table | null {
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const indent = /^[ \t]*/.exec(lines[0])![0];
  const align = segments(lines[1]).map((c) => alignOf(c.text));
  const rows = [lines[0], ...lines.slice(2)].map((line) => segments(line).map((c) => c.text));
  // Rows with more cells than the header widen the table rather than losing text.
  const width = Math.max(align.length, ...rows.map((r) => r.length));
  return {
    indent,
    rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
    align: Array.from({ length: width }, (_, i) => align[i] ?? null),
  };
}

/** Width as it looks in a monospace font (code points, not UTF-16 units). */
function widthOf(text: string): number {
  return [...text].length;
}

export interface Formatted {
  lines: string[];
  /** Per row (as in `Table.rows`): where each cell's text starts in its line. */
  cellStarts: number[][];
}

/** Write the table with aligned columns: `| a   | b |`, delimiter row `| --- | :-: |`. */
export function formatTable(table: Table): Formatted {
  const cols = table.align.length;
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...table.rows.map((r) => widthOf(r[c]))));
  const cellStarts: number[][] = [];
  const row = (cells: string[], fill = ' '): string => {
    const starts: number[] = [];
    let line = `${table.indent}|`;
    cells.forEach((cell, c) => {
      line += ' ';
      starts.push(line.length);
      line += cell + fill.repeat(widths[c] - widthOf(cell)) + ' |';
    });
    if (fill === ' ') cellStarts.push(starts);
    return line;
  };
  const delimiter = table.align.map((a, c) => {
    const w = widths[c];
    if (a === 'center') return `:${'-'.repeat(w - 2)}:`;
    if (a === 'right') return `${'-'.repeat(w - 1)}:`;
    if (a === 'left') return `:${'-'.repeat(w - 1)}`;
    return '-'.repeat(w);
  });
  const lines = table.rows.map((r) => row(r));
  lines.splice(1, 0, row(delimiter, '-'));
  return { lines, cellStarts };
}

/** Line index (0 = header, 1 = delimiter row) of a table row. */
export function lineOfRow(row: number): number {
  return row === 0 ? 0 : row + 1;
}

/** The cell at column `column` of line `lineIndex` (the delimiter row counts as the header). */
export function cellAt(lines: string[], lineIndex: number, column: number): Cell {
  const row = lineIndex <= 1 ? 0 : lineIndex - 1;
  const cells = segments(lines[lineOfRow(row)]);
  if (!cells.length) return { row, col: 0, offset: 0 };
  // The cell whose span (from the pipe before it) holds the column.
  let col = 0;
  for (let i = 1; i < cells.length; i++) if (column >= cells[i].start) col = i;
  if (lineIndex === 1) return { row, col, offset: 0 };
  const cell = cells[col];
  return { row, col, offset: Math.max(0, Math.min(column, cell.to) - cell.from) };
}

/** Where a cell's text lies in its line: [from, to], or null if the row is too short. */
export function cellSpan(lines: string[], row: number, col: number): [number, number] | null {
  const cell = segments(lines[lineOfRow(row)] ?? '')[col];
  return cell ? [cell.from, cell.to] : null;
}

/** Column (in its line) where the text of a cell ends, e.g. to place the cursor there. */
export function cellEnd(lines: string[], row: number, col: number): number {
  const cells = segments(lines[lineOfRow(row)] ?? '');
  return cells[Math.min(col, cells.length - 1)]?.to ?? 0;
}

/** Where a cell's text lies in the formatted lines: [line index, from, to] within the line. */
export function cellRange(formatted: Formatted, table: Table, cell: Cell): [number, number, number] {
  const row = Math.max(0, Math.min(cell.row, table.rows.length - 1));
  const col = Math.max(0, Math.min(cell.col, table.align.length - 1));
  const start = formatted.cellStarts[row][col];
  const text = table.rows[row][col];
  return [lineOfRow(row), start, start + text.length];
}

/** An empty table: a header and `bodyRows` rows, `cols` wide. */
export function emptyTable(cols: number, bodyRows: number, indent = ''): Table {
  return {
    indent,
    rows: Array.from({ length: bodyRows + 1 }, () => Array<string>(cols).fill('')),
    align: Array<Align>(cols).fill(null),
  };
}

// --- Edits (each returns a new table and where the cursor goes) ----------------------

export interface Edit {
  /** null: the table is gone (its last row or column was deleted). */
  table: Table | null;
  cell: Cell;
}

const blankRow = (t: Table) => Array<string>(t.align.length).fill('');
const same: IndexMap = (i) => i;
/** Old index → new, when one is inserted at `at`. */
const inserted = (at: number): IndexMap => (i) => (i >= at ? i + 1 : i);
/** Old index → new, when `at` is deleted. */
const deleted = (at: number): IndexMap => (i) => (i === at ? null : i > at ? i - 1 : i);
/** Old index → new, when `a` and `b` swap places. */
const swapped = (a: number, b: number): IndexMap => (i) => (i === a ? b : i === b ? a : i);

export function insertRow(t: Table, at: Cell, below: boolean): Edit {
  const index = below ? at.row + 1 : at.row;
  const rows = remapRows(t.rows, inserted(index), same);
  rows.splice(index, 0, blankRow(t));
  return { table: { ...t, rows }, cell: { row: index, col: at.col, offset: 0 } };
}

export function deleteRow(t: Table, at: Cell): Edit {
  if (t.rows.length <= 1) return { table: null, cell: at };
  // Deleting the header makes the first row the header.
  const rows = remapRows(t.rows, deleted(at.row), same).filter((_, i) => i !== at.row);
  return { table: { ...t, rows }, cell: { row: Math.min(at.row, rows.length - 1), col: at.col, offset: Infinity } };
}

export function insertColumn(t: Table, at: Cell, right: boolean): Edit {
  const index = right ? at.col + 1 : at.col;
  const rows = remapRows(t.rows, same, inserted(index)).map((r) => [...r.slice(0, index), '', ...r.slice(index)]);
  const align = [...t.align.slice(0, index), null, ...t.align.slice(index)];
  return { table: { ...t, rows, align }, cell: { row: at.row, col: index, offset: 0 } };
}

export function deleteColumn(t: Table, at: Cell): Edit {
  if (t.align.length <= 1) return { table: null, cell: at };
  const keep = (_: unknown, i: number) => i !== at.col;
  const rows = remapRows(t.rows, same, deleted(at.col)).map((r) => r.filter(keep));
  const table = { ...t, rows, align: t.align.filter(keep) };
  return { table, cell: { row: at.row, col: Math.min(at.col, table.align.length - 1), offset: Infinity } };
}

export function setAlign(t: Table, at: Cell, align: Align): Edit {
  return { table: { ...t, align: t.align.map((a, i) => (i === at.col ? align : a)) }, cell: at };
}

/** Swap a row with its neighbour (not the header: that changes what the columns are). */
export function moveRow(t: Table, at: Cell, down: boolean): Edit | null {
  const other = at.row + (down ? 1 : -1);
  if (at.row === 0 || other < 1 || other >= t.rows.length) return null;
  const rows = remapRows(t.rows, swapped(at.row, other), same);
  [rows[at.row], rows[other]] = [rows[other], rows[at.row]];
  return { table: { ...t, rows }, cell: { ...at, row: other } };
}

export function moveColumn(t: Table, at: Cell, right: boolean): Edit | null {
  const other = at.col + (right ? 1 : -1);
  if (other < 0 || other >= t.align.length) return null;
  const swap = <T>(list: T[]) => {
    const out = [...list];
    [out[at.col], out[other]] = [out[other], out[at.col]];
    return out;
  };
  const rows = remapRows(t.rows, same, swapped(at.col, other)).map(swap);
  return { table: { ...t, rows, align: swap(t.align) }, cell: { ...at, col: other } };
}

/** Tab: the next cell, or a new row after the last one. */
export function nextCell(t: Table, at: Cell): Edit {
  if (at.col + 1 < t.align.length) return { table: t, cell: { row: at.row, col: at.col + 1, offset: 0, select: true } };
  if (at.row + 1 < t.rows.length) return { table: t, cell: { row: at.row + 1, col: 0, offset: 0, select: true } };
  return { table: { ...t, rows: [...t.rows, blankRow(t)] }, cell: { row: at.row + 1, col: 0, offset: 0 } };
}

/** Shift+Tab: the cell before (stays in the first cell). */
export function previousCell(t: Table, at: Cell): Edit {
  if (at.col > 0) return { table: t, cell: { row: at.row, col: at.col - 1, offset: 0, select: true } };
  if (at.row > 0) return { table: t, cell: { row: at.row - 1, col: t.align.length - 1, offset: 0, select: true } };
  return { table: t, cell: { ...at, offset: 0, select: true } };
}

/** Enter: the same column one row down; a new row after the last one. */
export function nextRow(t: Table, at: Cell): Edit {
  if (at.row + 1 < t.rows.length) return { table: t, cell: { row: at.row + 1, col: at.col, offset: Infinity } };
  return { table: { ...t, rows: [...t.rows, blankRow(t)] }, cell: { row: at.row + 1, col: at.col, offset: 0 } };
}

/** Arrow keys between cells; null at the table's edge. */
export function moveCell(t: Table, at: Cell, dir: 'up' | 'down' | 'left' | 'right'): Edit | null {
  const last = t.align.length - 1;
  let { row, col } = at;
  let offset = Infinity;
  if (dir === 'up') row--;
  else if (dir === 'down') row++;
  else if (dir === 'left') {
    if (col > 0) col--;
    else [row, col] = [row - 1, last];
  } else {
    offset = 0;
    if (col < last) col++;
    else [row, col] = [row + 1, 0];
  }
  if (row < 0 || row >= t.rows.length) return null;
  return { table: t, cell: { row, col, offset } };
}
