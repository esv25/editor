/**
 * The formula editor's document model: a tree of rows and nodes.
 *
 * A row is a horizontal list of nodes (what you can move along with the
 * arrow keys). Nodes are symbols or structures that own rows of their own
 * (the numerator and denominator of a fraction, the cells of a matrix …).
 * Scripts (`^`, `_`) are their own node attached to the node before them,
 * as in MathQuill. The model is plain data without DOM, so it can be tested.
 */

/** How a symbol behaves – used for spacing in the LaTeX we write, «/» and alignment. */
export type AtomClass = 'num' | 'var' | 'ord' | 'bin' | 'rel' | 'punct' | 'open' | 'close' | 'func' | 'op' | 'space';

export interface Row {
  id: number;
  items: MathNode[];
  parent: MathNode | null;
}

interface NodeBase {
  id: number;
  parent: Row | null;
}

/** A single symbol: `x`, `2`, `+`, `\alpha`, `\sin`, `\mathbb{R}`. */
export interface Sym extends NodeBase {
  kind: 'sym';
  latex: string;
  cls: AtomClass;
  /** A comma typed between digits: written `{,}` so it isn't followed by a space (3,5). */
  decimal?: boolean;
}

/** A command with argument rows: `\frac{a}{b}`, `\sqrt[n]{x}`, `\vec{v}` … */
export interface Cmd extends NodeBase {
  kind: 'cmd';
  name: string;
  args: Row[];
  /** Optional argument in brackets (`\sqrt[3]{x}`), null when absent. */
  opt: Row | null;
  /** A literal first argument that isn't math (`\textcolor{red}{…}`). */
  lit?: string;
}

/** Super- and subscript, attached to the node before it. */
export interface Scripts extends NodeBase {
  kind: 'scripts';
  sub: Row | null;
  sup: Row | null;
}

/** Brackets around a row: `(…)`, `[…]`, `|…|`, `\langle…\rangle`; '' + '' is a TeX group `{…}`. */
export interface Group extends NodeBase {
  kind: 'group';
  open: string;
  close: string;
  body: Row;
}

/** Text in a formula (`\text{eller}`, `\mathrm{cm}`): its row holds one Sym per character. */
export interface TextNode extends NodeBase {
  kind: 'text';
  cmd: string;
  body: Row;
}

/** A command being typed after `\` (transient; never written to the document). */
export interface CmdInput extends NodeBase {
  kind: 'cmdinput';
  body: Row;
}

/** An environment with cells: matrices, `cases`, `array` and `aligned`. */
export interface Env extends NodeBase {
  kind: 'env';
  name: string;
  cells: Row[][];
  /** Column spec for `array` (`{c|cc}`). */
  colSpec: string | null;
  /** Row indices that have `\hline` above them (cells.length = below the last row). */
  hlines: number[];
}

/** An empty spot inside a row that's waiting for input (from templates, `#?`). */
export interface Placeholder extends NodeBase {
  kind: 'ph';
}

/**
 * Where a template's selection goes (`#0`), or with `prev` the term before
 * the cursor (`#@`, as in «/»). Never left in a finished model.
 */
export interface Slot extends NodeBase {
  kind: 'slot';
  prev?: boolean;
}

/** LaTeX we don't understand structurally: kept verbatim and treated as one symbol. */
export interface Raw extends NodeBase {
  kind: 'raw';
  latex: string;
}

export type MathNode = Sym | Cmd | Scripts | Group | TextNode | CmdInput | Env | Placeholder | Slot | Raw;

let nextId = 1;
export const newId = (): number => nextId++;

// --- Constructors ------------------------------------------------------------

export function row(items: MathNode[] = []): Row {
  const r: Row = { id: newId(), items, parent: null };
  for (const node of items) node.parent = r;
  return r;
}

function adopt<T extends MathNode>(node: T): T {
  for (const r of childRows(node)) r.parent = node;
  return node;
}

export const sym = (latex: string, cls: AtomClass = classOf(latex), decimal?: boolean): Sym => ({
  kind: 'sym',
  id: newId(),
  parent: null,
  latex,
  cls,
  ...(decimal ? { decimal } : {}),
});

export const cmd = (name: string, args: Row[], opt: Row | null = null, lit?: string): Cmd =>
  adopt({ kind: 'cmd', id: newId(), parent: null, name, args, opt, ...(lit !== undefined ? { lit } : {}) });

export const scripts = (sub: Row | null, sup: Row | null): Scripts =>
  adopt({ kind: 'scripts', id: newId(), parent: null, sub, sup });

export const group = (open: string, close: string, body: Row): Group =>
  adopt({ kind: 'group', id: newId(), parent: null, open, close, body });

export const text = (cmdName: string, body: Row): TextNode =>
  adopt({ kind: 'text', id: newId(), parent: null, cmd: cmdName, body });

export const cmdInput = (body: Row): CmdInput => adopt({ kind: 'cmdinput', id: newId(), parent: null, body });

export const env = (name: string, cells: Row[][], colSpec: string | null = null, hlines: number[] = []): Env =>
  adopt({ kind: 'env', id: newId(), parent: null, name, cells, colSpec, hlines });

export const placeholder = (): Placeholder => ({ kind: 'ph', id: newId(), parent: null });
export const slot = (): Slot => ({ kind: 'slot', id: newId(), parent: null });
export const raw = (latex: string): Raw => ({ kind: 'raw', id: newId(), parent: null, latex });

/** A text row from a string (one Sym per character). */
export function textRow(s: string): Row {
  return row([...s].map((ch) => sym(ch, 'ord')));
}

export function textOf(r: Row): string {
  return r.items.map((n) => (n.kind === 'sym' ? n.latex : '')).join('');
}

// --- Structure -----------------------------------------------------------------

/** A node's rows in reading order (the order the arrow keys visit them). */
export function childRows(node: MathNode): Row[] {
  switch (node.kind) {
    case 'cmd':
      return node.opt ? [node.opt, ...node.args] : node.args;
    case 'scripts':
      return [node.sub, node.sup].filter((r): r is Row => r !== null);
    case 'group':
    case 'text':
    case 'cmdinput':
      return [node.body];
    case 'env':
      return node.cells.flat();
    default:
      return [];
  }
}

export function hasRows(node: MathNode): boolean {
  return childRows(node).length > 0;
}

/** Re-establish parent links below the given rows (after structural edits). */
export function relink(rows: Row[], parent: MathNode | null = null): void {
  for (const r of rows) {
    r.parent = parent;
    for (const node of r.items) {
      node.parent = r;
      relink(childRows(node), node);
    }
  }
}

/** Deep copy (same ids), used for snapshots. */
export function cloneRow(r: Row): Row {
  const copy: Row = { id: r.id, items: r.items.map(cloneNode), parent: null };
  for (const n of copy.items) n.parent = copy;
  return copy;
}

export function cloneNode(node: MathNode): MathNode {
  const c = (r: Row | null) => (r ? cloneRow(r) : null);
  let copy: MathNode;
  switch (node.kind) {
    case 'cmd':
      copy = { ...node, args: node.args.map(cloneRow), opt: c(node.opt) };
      break;
    case 'scripts':
      copy = { ...node, sub: c(node.sub), sup: c(node.sup) };
      break;
    case 'group':
    case 'text':
    case 'cmdinput':
      copy = { ...node, body: cloneRow(node.body) };
      break;
    case 'env':
      copy = { ...node, cells: node.cells.map((cells) => cells.map(cloneRow)), hlines: [...node.hlines] };
      break;
    default:
      copy = { ...node };
  }
  copy.parent = null;
  return adopt(copy);
}

/** Every row in document order, depth first. */
export function allRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  const walk = (r: Row) => {
    out.push(r);
    for (const node of r.items) childRows(node).forEach(walk);
  };
  rows.forEach(walk);
  return out;
}

export function isEmptyRow(r: Row): boolean {
  return r.items.length === 0;
}

// --- Symbol classes ------------------------------------------------------------

const BIN = new Set([
  '+', '-', '*', ':', '\\pm', '\\mp', '\\cdot', '\\times', '\\div', '\\ast', '\\star', '\\circ', '\\bullet',
  '\\cup', '\\cap', '\\setminus', '\\land', '\\lor', '\\wedge', '\\vee', '\\oplus', '\\otimes', '\\uplus',
  '\\sqcup', '\\sqcap',
]);

const REL = new Set([
  '=', '<', '>', '\\le', '\\ge', '\\leq', '\\geq', '\\leqslant', '\\geqslant', '\\ne', '\\neq', '\\approx',
  '\\equiv', '\\sim', '\\simeq', '\\cong', '\\propto', '\\to', '\\rightarrow', '\\leftarrow', '\\gets',
  '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\leftrightarrow', '\\iff', '\\implies', '\\impliedby',
  '\\longrightarrow', '\\Longrightarrow', '\\Longleftrightarrow', '\\mapsto', '\\in', '\\notin', '\\ni',
  '\\subset', '\\subseteq', '\\supset', '\\supseteq', '\\nsubseteq', '\\perp', '\\parallel', '\\mid', '\\nmid',
  '\\ll', '\\gg', '\\doteq', '\\coloneqq', '\\nearrow', '\\searrow', '\\uparrow', '\\downarrow', '\\models',
  '\\vdash', '\\asymp', '\\not=', '\\nless', '\\ngtr', '\\lessgtr',
]);

const OPEN = new Set(['(', '[', '\\{', '\\langle', '\\lfloor', '\\lceil', '\\lvert', '\\lVert']);
const CLOSE = new Set([')', ']', '\\}', '\\rangle', '\\rfloor', '\\rceil', '\\rvert', '\\rVert', '!']);
const PUNCT = new Set([',', ';', '\\colon']);
const SPACE = new Set(['\\,', '\\;', '\\:', '\\!', '\\ ', '\\quad', '\\qquad', '~', '\\enspace', '\\thinspace']);

export const FUNCS = new Set([
  '\\sin', '\\cos', '\\tan', '\\cot', '\\sec', '\\csc', '\\arcsin', '\\arccos', '\\arctan', '\\sinh', '\\cosh',
  '\\tanh', '\\coth', '\\ln', '\\log', '\\lg', '\\exp', '\\lim', '\\limsup', '\\liminf', '\\max', '\\min',
  '\\sup', '\\inf', '\\det', '\\gcd', '\\deg', '\\dim', '\\ker', '\\arg', '\\Pr', '\\bmod',
]);

const OPS = new Set(['\\int', '\\iint', '\\iiint', '\\oint', '\\sum', '\\prod', '\\coprod', '\\bigcup', '\\bigcap']);

export function classOf(latex: string): AtomClass {
  if (/^[0-9]$/.test(latex)) return 'num';
  if (/^\p{L}$/u.test(latex)) return 'var';
  if (BIN.has(latex)) return 'bin';
  if (REL.has(latex)) return 'rel';
  if (OPEN.has(latex)) return 'open';
  if (CLOSE.has(latex)) return 'close';
  if (PUNCT.has(latex)) return 'punct';
  if (SPACE.has(latex)) return 'space';
  if (FUNCS.has(latex) || latex.startsWith('\\operatorname')) return 'func';
  if (OPS.has(latex) || /^\\(int|sum|prod|oint|iint)\\limits$/.test(latex)) return 'op';
  return 'ord';
}

/** Matching close delimiter for an open one ('' if it isn't a pair-able opener). */
export const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '\\{': '\\}',
  '\\langle': '\\rangle',
  '\\lfloor': '\\rfloor',
  '\\lceil': '\\rceil',
  '\\lvert': '\\rvert',
  '\\lVert': '\\rVert',
  '|': '|',
  '\\|': '\\|',
};

/** Whether a node counts as a relation (alignment point, spacing). */
export function isRel(node: MathNode | undefined): boolean {
  return node?.kind === 'sym' && node.cls === 'rel';
}

/** Index of the node a line is aligned at (`&` goes before it), or 0. */
export function alignIndex(items: MathNode[]): number {
  const rels = items.flatMap((n, i) => (isRel(n) ? [i] : []));
  return rels.find((i) => i > 0) ?? rels[0] ?? 0;
}
