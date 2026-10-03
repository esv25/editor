/**
 * From something in a formula to a template for a shortcut: right click a
 * symbol or structure (a fraction, a root, a matrix …) and get what a
 * shortcut for "that" should insert – the structure with empty spots, not
 * its current contents.
 */
import { itemsById } from './catalog';
import { cmdSpec, nodesToLatex } from './latex';
import * as M from './model';

/** The template for a node, or null if it's not worth a shortcut (a plain letter or digit). */
export function templateOf(node: M.MathNode): string | null {
  switch (node.kind) {
    case 'sym':
      return /^[a-zA-Z0-9.,']$/.test(node.latex) ? null : node.latex;
    case 'cmd': {
      if (node.name === '\\frac') return '\\frac{#@}{#?}';
      const lit = node.lit !== undefined ? `{${node.lit}}` : '';
      const opt = node.opt ? '[#?]' : '';
      const args = node.args.map((_, i) => (i === 0 && !cmdSpec(node.name)?.stacked ? '{#0}' : '{#?}')).join('');
      return node.name + opt + lit + args;
    }
    case 'scripts':
      return (node.sub ? '_{#?}' : '') + (node.sup ? '^{#?}' : '');
    case 'group':
      if (!node.open && !node.close) return null;
      return `\\left${node.open}#0\\right${node.close}`;
    case 'env': {
      const spec = node.colSpec !== null ? `{${node.colSpec}}` : '';
      const rows = node.cells.map((cells) => cells.map(() => '#?').join(' & ')).join(' \\\\ ');
      return `\\begin{${node.name}}${spec} ${rows} \\end{${node.name}}`;
    }
    case 'text':
      return `${node.cmd}{}`;
    case 'raw':
      return node.latex;
    default:
      return null;
  }
}

const CMD_NAMES: Record<string, string> = {
  '\\frac': 'brøk',
  '\\sqrt': 'rot',
  '\\vec': 'vektor',
  '\\overrightarrow': 'vektor',
  '\\overline': 'strek over',
  '\\underline': 'strek under',
  '\\hat': 'hatt',
  '\\binom': 'binomialkoeffisient',
  '\\cancel': 'stryk over',
  '\\boxed': 'boks',
  '\\text': 'tekst',
};

const ENV_NAMES: Record<string, string> = {
  pmatrix: 'matrise',
  bmatrix: 'matrise',
  vmatrix: 'determinant',
  cases: 'klamme med linjer',
  array: 'tabell',
  aligned: 'linjer',
};

/** A name for a template: the panel's name for it if it has one. */
export function nameOf(latex: string, node?: M.MathNode): string {
  for (const it of itemsById.values()) if (it.latex === latex) return it.name;
  if (node?.kind === 'cmd' && CMD_NAMES[node.name]) return CMD_NAMES[node.name];
  if (node?.kind === 'env') return `${ENV_NAMES[node.name] ?? 'tabell'} ${node.cells.length} × ${node.cells[0]?.length ?? 1}`;
  if (node?.kind === 'scripts') return node.sup && node.sub ? 'opphøyd og senket' : node.sup ? 'opphøyd' : 'senket';
  if (node?.kind === 'group') return node.open === '|' ? 'absoluttverdi' : 'parentes';
  return latex;
}

export interface SymbolChoice {
  /** What it is, for the menu: «brøk», «hele formelen». */
  name: string;
  latex: string;
}

/**
 * What a right click on `node` could make a shortcut for: the node and the
 * structures around it, the selection, and the whole formula.
 */
export function symbolChoices(node: M.MathNode | null, selection: M.MathNode[], whole: string): SymbolChoice[] {
  const out: SymbolChoice[] = [];
  const add = (name: string, latex: string) => {
    if (latex && !out.some((c) => c.latex === latex)) out.push({ name, latex });
  };
  if (selection.length) add('det markerte', nodesToLatex(selection));
  // The node itself, then up to two structures around it (the fraction a digit is in …).
  let structures = 0;
  for (let n: M.MathNode | null = node; n && structures < 3; n = n.parent?.parent ?? null) {
    const latex = templateOf(n);
    if (latex) {
      add(nameOf(latex, n), latex);
      structures++;
    }
  }
  add('hele formelen', whole);
  return out;
}
