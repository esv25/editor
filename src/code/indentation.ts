/**
 * Indentation for code: which unit to use (detected from the file, or the
 * language's usual one) and a VS Code-like Tab.
 */
import { countColumn, EditorSelection, type EditorState, type Extension, type StateCommand } from '@codemirror/state';
import { getIndentUnit, indentUnit, matchBrackets } from '@codemirror/language';
import { indentMore } from '@codemirror/commands';

/** Languages that are usually indented with 2 spaces; most others use 4. */
const TWO_SPACES = new Set(['javascript', 'typescript', 'json', 'html', 'css', 'yaml', 'xml']);

export function defaultIndentFor(lang: string): string {
  if (lang === 'go') return '\t';
  return TWO_SPACES.has(lang) ? '  ' : '    ';
}

/**
 * The indentation a file uses: "\t" if lines are mostly tab-indented, else
 * the most common step by which indentation increases (2, 4 …). Null if the
 * file has no indented lines to go by.
 */
export function detectIndent(text: string): string | null {
  let tabLines = 0;
  let spaceLines = 0;
  const steps = new Map<number, number>();
  let previous = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const ws = /^[ \t]*/.exec(line)![0];
    if (ws.includes('\t')) {
      tabLines++;
      continue;
    }
    if (ws.length > 0) spaceLines++;
    const step = ws.length - previous;
    if (step > 0 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = ws.length;
  }
  if (tabLines > spaceLines) return '\t';
  let best = 0;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (count > bestCount || (count === bestCount && step < best)) [best, bestCount] = [step, count];
  }
  return best ? ' '.repeat(best) : null;
}

/** Indent unit for a code document: what the file already uses, else the language default. */
export function indentationFor(text: string, lang: string): Extension {
  return indentUnit.of(detectIndent(text) ?? defaultIndentFor(lang));
}

/**
 * Tab in code, like VS Code: with a selection, indent the selected lines;
 * otherwise insert spaces up to the next tab stop at the cursor (or a tab
 * character when the unit is a tab).
 */
export const insertIndent: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  const unit = state.facet(indentUnit);
  const size = getIndentUnit(state);
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    let insert = '\t';
    if (!unit.includes('\t')) {
      const column = countColumn(line.text.slice(0, range.head - line.from), state.tabSize);
      insert = ' '.repeat(size - (column % size));
    }
    return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.indent' }));
  return true;
};

// ---- Indentation levels (indent guides, status bar) ----

/** Indent width of a line in columns, or null for a blank line. */
export function indentColumns(text: string, tabSize: number): number | null {
  let col = 0;
  for (const ch of text) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += tabSize - (col % tabSize);
    else return col;
  }
  return null;
}

/**
 * Indentation level per line (1-based line numbers), cached. A blank line gets
 * the smaller level of the nearest non-blank lines around it, so guides run through it.
 */
export function indentLevels(state: EditorState): (lineNo: number) => number {
  const { doc, tabSize } = state;
  const unit = getIndentUnit(state) || 4;
  const cache = new Map<number, number>();
  const nearest = (from: number, step: 1 | -1): number => {
    for (let n = from, i = 0; n >= 1 && n <= doc.lines && i < 200; n += step, i++) {
      const cols = indentColumns(doc.line(n).text, tabSize);
      if (cols !== null) return cols;
    }
    return 0;
  };
  return (n) => {
    let level = cache.get(n);
    if (level === undefined) {
      let cols = indentColumns(doc.line(n).text, tabSize);
      if (cols === null) cols = Math.min(nearest(n - 1, -1), nearest(n + 1, 1));
      level = Math.ceil(cols / unit);
      cache.set(n, level);
    }
    return level;
  };
}

/**
 * The block the cursor is in, the way VS Code highlights its indent guide: on a line
 * that opens a block (the next line is deeper) it's that block; otherwise the
 * innermost block the line belongs to. `level` is the guide (1 = the first one);
 * `from`/`to` are the line numbers the guide runs through.
 */
export function activeIndentBlock(state: EditorState, pos: number, levelOf = indentLevels(state)): { level: number; from: number; to: number } | null {
  const { doc } = state;
  const lineNo = doc.lineAt(pos).number;
  const here = levelOf(lineNo);
  let next = lineNo + 1;
  while (next <= doc.lines && indentColumns(doc.line(next).text, state.tabSize) === null) next++;
  const opens = next <= doc.lines && levelOf(next) > here;
  const level = opens ? here + 1 : here;
  if (level < 1) return null;
  let from = opens ? lineNo + 1 : lineNo;
  let to = from;
  while (from > 1 && levelOf(from - 1) >= level) from--;
  while (to < doc.lines && levelOf(to + 1) >= level) to++;
  // Trailing blank lines don't belong to the block.
  while (to > from && indentColumns(doc.line(to).text, state.tabSize) === null) to--;
  return { level, from, to };
}

/** "innrykk 2" for the cursor's line – counting the whitespace even on an otherwise empty line. */
export function describeIndent(state: EditorState, pos: number): string {
  const text = state.doc.lineAt(pos).text;
  const cols = countColumn(/^[ \t]*/.exec(text)![0], state.tabSize);
  const unit = getIndentUnit(state) || 4;
  const level = Math.floor(cols / unit);
  const extra = cols % unit;
  return `innrykk ${level}` + (extra ? ` + ${extra} mellomrom` : '');
}

// ---- Sticky scroll: the lines that open the blocks around a line ----

const COMMENT = /^\s*(#|\/\/|\/\*|\*|<!--|--)/;

/**
 * The lines that open the blocks a line is inside (function, loop, class …), outermost
 * first: going up, each line indented less than the last one found. A line that starts
 * with ")" or "]" (the end of a long parameter list) stands for the line its bracket opens on.
 */
export function blockHeaders(state: EditorState, lineNo: number): number[] {
  const { doc, tabSize } = state;
  // Comment lines don't open blocks, and one at column 0 inside a function
  // (commented-out code) doesn't end it.
  const colsOf = (n: number) => {
    const text = doc.line(n).text;
    return COMMENT.test(text) ? null : indentColumns(text, tabSize);
  };
  let cols = colsOf(lineNo) ?? (indentColumns(doc.line(lineNo).text, tabSize) || null);
  if (cols === null) {
    // A blank line belongs to the shallower of the blocks around it.
    let up = lineNo - 1;
    while (up >= 1 && colsOf(up) === null) up--;
    let down = lineNo + 1;
    while (down <= doc.lines && colsOf(down) === null) down++;
    cols = Math.min(up >= 1 ? colsOf(up)! : 0, down <= doc.lines ? colsOf(down)! : 0);
  }
  const out: number[] = [];
  for (let n = lineNo - 1; n >= 1 && cols > 0 && lineNo - n < 5000; n--) {
    const line = doc.line(n);
    const c = colsOf(n);
    if (c === null || c >= cols) continue;
    let header = n;
    const first = line.from + line.text.length - line.text.trimStart().length;
    if (line.text[first - line.from] === ')' || line.text[first - line.from] === ']') {
      const match = matchBrackets(state, first + 1, -1);
      if (match?.matched && match.end) header = Math.min(n, doc.lineAt(match.end.from).number);
    }
    out.unshift(header);
    cols = indentColumns(doc.line(header).text, tabSize) ?? 0;
    n = header;
  }
  return out;
}

/**
 * The header lines to keep at the top when `top` is the first visible line, at most `max`.
 * The headers cover lines themselves, so they are the headers of the first line *below*
 * them: as many as fit that way (otherwise "def a" could stand over the start of "def b").
 */
export function stickyHeaders(state: EditorState, top: number, max = 5): number[] {
  for (let k = max; k > 0; k--) {
    const below = Math.min(top + k, state.doc.lines);
    const headers = blockHeaders(state, below);
    // A header at slot i must be above the line the slot covers.
    if (headers.length >= k && headers.slice(0, k).every((h, i) => h < top + i)) return headers.slice(0, k);
  }
  return [];
}
