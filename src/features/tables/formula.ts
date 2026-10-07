/**
 * Spreadsheet formulas in table cells, as in Excel: `=B2+B3`, `=SUMMER(B2:B4)`.
 * Columns are A, B, C …, the header is row 1. A computed cell is stored as
 * the answer with the formula in an HTML comment, `65 <!-- =SUM(B2:B3) -->`,
 * so other programs (GitHub, Obsidian, Word) show the answer and the formula
 * survives. Plain logic, no DOM (tested in tests/tableFormula.test.ts).
 */

export type Value = number | string | FormulaError;

export class FormulaError {
  constructor(readonly code: string) {}
  toString() {
    return this.code;
  }
}

const ERR = {
  div0: new FormulaError('#DIV/0!'),
  ref: new FormulaError('#REFERANSE!'),
  value: new FormulaError('#VERDI!'),
  name: new FormulaError('#NAVN?'),
  syntax: new FormulaError('#FEIL!'),
  cycle: new FormulaError('#SYKLUS!'),
};

// --- Cells: answer + formula ---------------------------------------------------------

const STORED = /^(.*?)\s*<!--\s*(=[\s\S]*?)\s*-->\s*$/;

/** A cell's formula (`=…`), if it has one, and what it shows otherwise. */
export function cellFormula(raw: string): string | null {
  const stored = STORED.exec(raw);
  if (stored) return stored[2];
  const text = raw.trim();
  return text.startsWith('=') && text.length > 1 ? text : null;
}

/** How a computed cell is written: the answer, then the formula hidden in a comment. */
export function storeFormula(value: Value, formula: string): string {
  // "--" would end the comment early.
  return `${formatValue(value)} <!-- ${formula.replace(/--/g, '- -')} -->`;
}

/** Numbers the Norwegian way: decimal comma, no more decimals than needed. */
export function formatValue(value: Value): string {
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return ERR.div0.code;
  const rounded = Number(value.toFixed(10));
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',');
}

/**
 * The number in a cell's text: "25", "2,5", "1 234,50", "-3", "20 %", "25 kr",
 * "**40**". Null for text that isn't a number (and for an empty cell).
 */
export function numberIn(text: string): number | null {
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[*_`]/g, '')
    .trim();
  const m = /^([-+−]?)\s*(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d+))?\s*(%)?\s*(?:kr|,-|[a-zæøå€$£]{0,3}\.?)?$/i.exec(plain);
  if (!m) return null;
  const n = Number(`${m[2].replace(/[  ]/g, '')}.${m[3] ?? '0'}`) * (m[1] === '-' || m[1] === '−' ? -1 : 1);
  return m[4] ? n / 100 : n;
}

// --- Addresses -----------------------------------------------------------------------

/** "A" → 0, "Z" → 25, "AA" → 26. */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** The address of a cell (row 0 = the header = row 1). */
export function cellName(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

// --- Parsing -------------------------------------------------------------------------

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; row: number; col: number }
  | { t: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { t: 'neg'; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

const TOKEN =
  /\s*(?:(#REFERANSE!)|(\d+(?:[.,]\d+)?)|([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?(?![A-Za-zæøåÆØÅ(])|([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9.]*)|"([^"]*)"|(<=|>=|<>|[-+*/^%(),;:<>=&]))/y;

type Token = { kind: 'num' | 'ref' | 'name' | 'str' | 'op'; text: string; node?: Node };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (!src.slice(TOKEN.lastIndex).trim()) break;
    const m = TOKEN.exec(src);
    if (!m) throw ERR.syntax;
    // A reference to a row or column that was deleted.
    if (m[1]) throw ERR.ref;
    if (m[2]) out.push({ kind: 'num', text: m[2], node: { t: 'num', v: Number(m[2].replace(',', '.')) } });
    else if (m[3]) {
      const [r1, c1] = [Number(m[4]) - 1, columnIndex(m[3])];
      const node: Node = m[5]
        ? { t: 'range', r1, c1, r2: Number(m[6]) - 1, c2: columnIndex(m[5]) }
        : { t: 'ref', row: r1, col: c1 };
      out.push({ kind: 'ref', text: m[0], node });
    } else if (m[7]) out.push({ kind: 'name', text: m[7].toUpperCase() });
    else if (m[8] !== undefined) out.push({ kind: 'str', text: m[8], node: { t: 'str', v: m[8] } });
    else out.push({ kind: 'op', text: m[9] });
  }
  return out;
}

/** Formula text (without "=") → syntax tree. Precedence as in Excel. */
function parse(src: string): Node {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (...ops: string[]) => peek()?.kind === 'op' && ops.includes(peek().text);
  const expect = (op: string) => {
    if (!isOp(op)) throw ERR.syntax;
    i++;
  };

  const comparison = (): Node => {
    let a = concat();
    while (isOp('=', '<>', '<', '>', '<=', '>=')) a = { t: 'bin', op: tokens[i++].text, a, b: concat() };
    return a;
  };
  const concat = (): Node => {
    let a = additive();
    while (isOp('&')) a = { t: 'bin', op: tokens[i++].text, a, b: additive() };
    return a;
  };
  const additive = (): Node => {
    let a = term();
    while (isOp('+', '-')) a = { t: 'bin', op: tokens[i++].text, a, b: term() };
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (isOp('*', '/')) a = { t: 'bin', op: tokens[i++].text, a, b: unary() };
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) return (i++, { t: 'neg', a: unary() });
    if (isOp('+')) return (i++, unary());
    return power();
  };
  const power = (): Node => {
    const a = postfix();
    return isOp('^') ? (i++, { t: 'bin', op: '^', a, b: unary() }) : a;
  };
  const postfix = (): Node => {
    let a = primary();
    while (isOp('%')) (i++, (a = { t: 'pct', a }));
    return a;
  };
  const primary = (): Node => {
    const tok = peek();
    if (!tok) throw ERR.syntax;
    if (tok.node) return (i++, tok.node);
    if (tok.kind === 'name') {
      i++;
      if (isOp('(')) {
        i++;
        const args: Node[] = [];
        if (!isOp(')')) {
          do args.push(comparison());
          while (isOp(';', ',') && ++i);
        }
        expect(')');
        return { t: 'call', name: tok.text, args };
      }
      if (tok.text === 'PI') return { t: 'num', v: Math.PI };
      if (tok.text === 'SANN' || tok.text === 'TRUE') return { t: 'num', v: 1 };
      if (tok.text === 'USANN' || tok.text === 'FALSE') return { t: 'num', v: 0 };
      throw ERR.name;
    }
    if (isOp('(')) {
      i++;
      const a = comparison();
      expect(')');
      return a;
    }
    throw ERR.syntax;
  };

  const tree = comparison();
  if (i < tokens.length) throw ERR.syntax;
  return tree;
}

// --- Evaluating ----------------------------------------------------------------------

/** Function names: Norwegian (as in Norwegian Excel) and English. */
const ALIASES: Record<string, string> = {
  SUMMER: 'SUM', SUMMÉR: 'SUM',
  GJENNOMSNITT: 'AVERAGE', SNITT: 'AVERAGE', MIDDEL: 'AVERAGE',
  MAKS: 'MAX',
  ANTALL: 'COUNT',
  AVRUND: 'ROUND',
  ROT: 'SQRT',
  PRODUKT: 'PRODUCT',
  HVIS: 'IF',
  ABS: 'ABS', MIN: 'MIN', MAX: 'MAX', MEDIAN: 'MEDIAN', SUM: 'SUM', AVERAGE: 'AVERAGE', COUNT: 'COUNT',
  ROUND: 'ROUND', SQRT: 'SQRT', PRODUCT: 'PRODUCT', IF: 'IF',
};

export interface Sheet {
  /** The value of a cell (computes formulas, finds cycles). */
  value(row: number, col: number): Value;
}

/** Numbers in a list of values (text and empty cells are skipped, errors pass on). */
function numbersOf(values: Value[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v instanceof FormulaError) throw v;
    if (typeof v === 'number') out.push(v);
  }
  return out;
}

function evaluate(node: Node, sheet: Sheet, size: { rows: number; cols: number }): Value {
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < size.rows && c < size.cols;
  /** All values an argument stands for (a range is many). */
  const list = (n: Node): Value[] => {
    if (n.t !== 'range') return [evaluate(n, sheet, size)];
    const out: Value[] = [];
    const [r1, r2] = [Math.min(n.r1, n.r2), Math.max(n.r1, n.r2)];
    const [c1, c2] = [Math.min(n.c1, n.c2), Math.max(n.c1, n.c2)];
    if (!inside(r1, c1) || !inside(r2, c2)) throw ERR.ref;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(sheet.value(r, c));
    return out;
  };
  const num = (n: Node): number => {
    const v = evaluate(n, sheet, size);
    if (v instanceof FormulaError) throw v;
    if (typeof v === 'number') return v;
    if (v === '') return 0; // an empty cell counts as 0, as in Excel
    const parsed = numberIn(v);
    if (parsed === null) throw ERR.value;
    return parsed;
  };

  switch (node.t) {
    case 'num':
    case 'str':
      return node.v;
    case 'ref':
      if (!inside(node.row, node.col)) throw ERR.ref;
      return sheet.value(node.row, node.col);
    case 'range':
      throw ERR.value; // only as a function argument
    case 'neg':
      return -num(node.a);
    case 'pct':
      return num(node.a) / 100;
    case 'bin': {
      if (node.op === '&') return formatValue(evaluate(node.a, sheet, size)) + formatValue(evaluate(node.b, sheet, size));
      const [a, b] = [num(node.a), num(node.b)];
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw ERR.div0;
          return a / b;
        case '^': return a ** b;
        case '=': return a === b ? 1 : 0;
        case '<>': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
      }
      throw ERR.syntax;
    }
    case 'call': {
      const fn = ALIASES[node.name];
      if (!fn) throw ERR.name;
      const all = () => numbersOf(node.args.flatMap(list));
      const argc = (min: number, max = min) => {
        if (node.args.length < min || node.args.length > max) throw ERR.value;
      };
      switch (fn) {
        case 'SUM':
          return all().reduce((s, x) => s + x, 0);
        case 'PRODUCT':
          return all().reduce((s, x) => s * x, 1);
        case 'AVERAGE': {
          const xs = all();
          if (!xs.length) throw ERR.div0;
          return xs.reduce((s, x) => s + x, 0) / xs.length;
        }
        case 'MIN':
        case 'MAX': {
          const xs = all();
          return xs.length ? (fn === 'MIN' ? Math.min(...xs) : Math.max(...xs)) : 0;
        }
        case 'MEDIAN': {
          const xs = all().sort((x, y) => x - y);
          if (!xs.length) throw ERR.value;
          const mid = xs.length >> 1;
          return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
        }
        case 'COUNT':
          return all().length;
        case 'ABS':
          argc(1);
          return Math.abs(num(node.args[0]));
        case 'SQRT': {
          argc(1);
          const x = num(node.args[0]);
          if (x < 0) throw ERR.value;
          return Math.sqrt(x);
        }
        case 'ROUND': {
          argc(1, 2);
          const digits = node.args[1] ? Math.trunc(num(node.args[1])) : 0;
          const f = 10 ** digits;
          const x = num(node.args[0]);
          return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
        }
        case 'IF': {
          argc(2, 3);
          const pick = num(node.args[0]) !== 0 ? node.args[1] : node.args[2];
          return pick ? evaluate(pick, sheet, size) : 0;
        }
      }
      throw ERR.name;
    }
  }
}

/**
 * Compute every cell of a table (rows of raw cell texts, the header first).
 * Plain cells give their number, or their text; formulas their answer or an error.
 */
export function computeTable(rows: string[][]): Value[][] {
  const size = { rows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)) };
  const done = new Map<string, Value>();
  const busy = new Set<string>();
  const sheet: Sheet = {
    value(row, col) {
      const key = `${row},${col}`;
      const known = done.get(key);
      if (known !== undefined) return known;
      if (busy.has(key)) throw ERR.cycle;
      const raw = rows[row]?.[col] ?? '';
      const formula = cellFormula(raw);
      let value: Value;
      if (!formula) {
        const n = numberIn(raw);
        value = n ?? raw.trim();
      } else {
        busy.add(key);
        try {
          value = evaluate(parse(formula.slice(1)), sheet, size);
        } catch (e) {
          if (!(e instanceof FormulaError)) throw e;
          value = e;
        } finally {
          busy.delete(key);
        }
      }
      done.set(key, value);
      return value;
    },
  };
  return rows.map((r, row) =>
    r.map((_, col) => {
      try {
        return sheet.value(row, col);
      } catch (e) {
        if (e instanceof FormulaError) return e;
        throw e;
      }
    }),
  );
}

// --- Moving cells: references follow -------------------------------------------------

/** Where an old row (column) index ends up, or null if it was deleted. */
export type IndexMap = (index: number) => number | null;

const REF_TEXT = /(?<![A-Za-z0-9æøåÆØÅ#])([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?(?![A-Za-z0-9æøåÆØÅ(])/g;
const REF_ERROR = '#REFERANSE!';

/** Rewrite the cell references in a formula after rows/columns moved, as Excel does. */
export function remapFormula(formula: string, mapRow: IndexMap, mapCol: IndexMap): string {
  // Only outside "text in quotes".
  return formula
    .split('"')
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(REF_TEXT, (_, c1: string, r1: string, c2?: string, r2?: string) => {
            const single = (col: number, row: number) => {
              const [r, c] = [mapRow(row), mapCol(col)];
              return r === null || c === null ? null : cellName(r, c);
            };
            const [row1, col1] = [Number(r1) - 1, columnIndex(c1)];
            if (c2 === undefined || r2 === undefined) return single(col1, row1) ?? REF_ERROR;
            // A range shrinks when rows/columns inside it go; it's only lost when all of it does.
            const [row2, col2] = [Number(r2) - 1, columnIndex(c2)];
            const edge = (from: number, to: number, map: IndexMap) => {
              const step = from <= to ? 1 : -1;
              for (let i = from; i !== to + step; i += step) {
                const m = map(i);
                if (m !== null) return m;
              }
              return null;
            };
            const [a, b] = [edge(row1, row2, mapRow), edge(row2, row1, mapRow)];
            const [c, d] = [edge(col1, col2, mapCol), edge(col2, col1, mapCol)];
            if (a === null || b === null || c === null || d === null) return REF_ERROR;
            return `${cellName(a, c)}:${cellName(b, d)}`;
          }),
    )
    .join('"');
}

/** Rows of cells with every formula's references moved along (answers are recomputed later). */
export function remapRows(rows: string[][], mapRow: IndexMap, mapCol: IndexMap): string[][] {
  return rows.map((r) =>
    r.map((raw) => {
      const formula = cellFormula(raw);
      if (!formula) return raw;
      const moved = remapFormula(formula, mapRow, mapCol);
      return moved === formula ? raw : moved;
    }),
  );
}

/** The table's rows with every formula cell's stored answer brought up to date. */
export function recalculateRows(rows: string[][]): string[][] {
  if (!rows.some((r) => r.some((c) => cellFormula(c)))) return rows;
  const values = computeTable(rows);
  return rows.map((r, row) =>
    r.map((raw, col) => {
      const formula = cellFormula(raw);
      return formula ? storeFormula(values[row][col], formula) : raw;
    }),
  );
}
