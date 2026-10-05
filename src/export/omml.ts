/**
 * LaTeX → Word equations (OMML), so formulas in a .docx are real, editable
 * Word equations. KaTeX does the LaTeX part (macros, mhchem …) and writes
 * MathML; this maps that MathML onto OMML. Pure strings, tested in
 * tests/export.test.ts.
 */
import katex from 'katex';
import 'katex/contrib/mhchem';
import { trust } from '../features/math/render';
import { elements, esc, parseXml, textOf, type XmlElement, type XmlNode } from './xml';

/** `<m:oMath>` for a formula, or null if KaTeX can't read it. */
export function latexToOmml(latex: string, display: boolean): string | null {
  let mathml: string;
  try {
    mathml = katex.renderToString(latex, { output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore', trust });
  } catch {
    return null;
  }
  const math = findElement(parseXml(mathml), 'math');
  return math ? `<m:oMath>${row(math.children)}</m:oMath>` : null;
}

function findElement(nodes: XmlNode[], name: string): XmlElement | null {
  for (const el of elements(nodes)) {
    if (el.name === name) return el;
    const found = findElement(el.children, name);
    if (found) return found;
  }
  return null;
}

// --- Runs ------------------------------------------------------------------------------

const MATH_FONT = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';

/** Invisible operators (function application, invisible times …) carry no ink. */
const INVISIBLE = /[⁡-⁤​]/g;

function run(text: string, style: string | null = null, normalText = false): string {
  const t = text.replace(INVISIBLE, '');
  if (!t) return '';
  const props = normalText ? '<m:rPr><m:nor/></m:rPr>' : style ? `<m:rPr>${style}</m:rPr>` : '';
  const space = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : '';
  return `<m:r>${props}${normalText ? '' : MATH_FONT}<m:t${space}>${esc(t)}</m:t></m:r>`;
}

const VARIANTS: Record<string, string> = {
  normal: '<m:sty m:val="p"/>',
  bold: '<m:sty m:val="b"/>',
  'bold-italic': '<m:sty m:val="bi"/>',
  italic: '<m:sty m:val="i"/>',
  'double-struck': '<m:scr m:val="double-struck"/><m:sty m:val="p"/>',
  script: '<m:scr m:val="script"/><m:sty m:val="p"/>',
  'bold-script': '<m:scr m:val="script"/><m:sty m:val="b"/>',
  fraktur: '<m:scr m:val="fraktur"/><m:sty m:val="p"/>',
  'bold-fraktur': '<m:scr m:val="fraktur"/><m:sty m:val="b"/>',
  'sans-serif': '<m:scr m:val="sans-serif"/><m:sty m:val="p"/>',
  monospace: '<m:scr m:val="monospace"/><m:sty m:val="p"/>',
};

function token(el: XmlElement): string {
  const text = textOf(el);
  const variant = el.attrs.mathvariant;
  switch (el.name) {
    case 'mi':
      // A multi-letter identifier (sin, lim) is upright, as in MathML.
      return run(text, variant ? VARIANTS[variant] ?? null : [...text].length > 1 ? VARIANTS.normal : null);
    case 'mtext':
    case 'ms':
      return run(text.replace(/ /g, ' '), null, true);
    default:
      return run(text, variant ? VARIANTS[variant] ?? null : VARIANTS.normal);
  }
}

// --- Structure -------------------------------------------------------------------------

const wrap = (tag: string, content: string) => `<m:${tag}>${content}</m:${tag}>`;
const arg = (el: XmlElement | undefined) => (el ? node(el) : '');

const NARY = /^[∑∏∐⋃⋂⨁⨂⨀⨄∫∬∭∮∯∰]$/;
const RELATION = /^[=<>≤≥≠≈≡→←↔⇒⇐⇔∼≃≅∝∈∉∋⊂⊆⊃⊇⊥∥≪≫≔≐⟶⟹⟺↦⩽⩾]$/;

const isMo = (el: XmlElement | undefined, test: RegExp) => el?.name === 'mo' && test.test(textOf(el).trim());

/** The single meaningful child of a wrapper (mrow with one child …). */
function core(el: XmlElement): XmlElement {
  const kids = elements(el.children);
  return (el.name === 'mrow' || el.name === 'mstyle') && kids.length === 1 ? core(kids[0]) : el;
}

interface Nary {
  chr: string;
  sub?: XmlElement;
  sup?: XmlElement;
  limLoc: 'undOvr' | 'subSup';
}

function naryOf(el: XmlElement): Nary | null {
  if (isMo(el, NARY)) return { chr: textOf(el).trim(), limLoc: 'subSup' };
  const [base, a, b] = elements(el.children);
  if (!base || !isMo(core(base), NARY)) return null;
  const chr = textOf(core(base)).trim();
  switch (el.name) {
    case 'msub':
      return { chr, sub: a, limLoc: 'subSup' };
    case 'msup':
      return { chr, sup: a, limLoc: 'subSup' };
    case 'msubsup':
      return { chr, sub: a, sup: b, limLoc: 'subSup' };
    case 'munder':
      return { chr, sub: a, limLoc: 'undOvr' };
    case 'mover':
      return { chr, sup: a, limLoc: 'undOvr' };
    case 'munderover':
      return { chr, sub: a, sup: b, limLoc: 'undOvr' };
  }
  return null;
}

function nary(n: Nary, body: string): string {
  const props =
    `<m:chr m:val="${esc(n.chr)}"/><m:limLoc m:val="${n.limLoc}"/>` +
    (n.sub ? '' : '<m:subHide m:val="1"/>') +
    (n.sup ? '' : '<m:supHide m:val="1"/>');
  return `<m:nary><m:naryPr>${props}</m:naryPr><m:sub>${arg(n.sub)}</m:sub><m:sup>${arg(n.sup)}</m:sup><m:e>${body}</m:e></m:nary>`;
}

/** Whether an element draws nothing (mhchem puts subscripts on an invisible base). */
function isInvisible(el: XmlElement): boolean {
  if (el.name === 'mphantom') return true;
  if (el.name === 'mrow' || el.name === 'mpadded' || el.name === 'mstyle') return elements(el.children).every(isInvisible);
  return false;
}

const SCRIPTS = new Set(['msub', 'msup', 'msubsup']);

function scripts(el: XmlElement, base: string): string {
  const [, a, b] = elements(el.children);
  if (el.name === 'msub') return `<m:sSub><m:e>${base}</m:e><m:sub>${arg(a)}</m:sub></m:sSub>`;
  if (el.name === 'msup') return `<m:sSup><m:e>${base}</m:e><m:sup>${arg(a)}</m:sup></m:sSup>`;
  return `<m:sSubSup><m:e>${base}</m:e><m:sub>${arg(a)}</m:sub><m:sup>${arg(b)}</m:sup></m:sSubSup>`;
}

/** A row of siblings. Big operators take what follows them (up to a relation) as their body. */
function row(nodes: XmlNode[]): string {
  const els = elements(nodes);
  const out: string[] = [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const n = naryOf(el);
    if (n) {
      let j = i + 1;
      while (j < els.length && !isMo(core(els[j]), RELATION)) j++;
      out.push(nary(n, row(els.slice(i + 1, j))));
      i = j - 1;
      continue;
    }
    // H₂ in \ce: the subscript sits on an invisible base after the H – attach it to the H.
    const base = elements(el.children)[0];
    if (SCRIPTS.has(el.name) && base && isInvisible(base)) {
      let prev = '';
      while (out.length && !prev) prev = out.pop()!;
      out.push(scripts(el, prev));
      continue;
    }
    // sin x, ln(x): KaTeX puts "function application" after the name; Word has a structure for it.
    if (isMo(els[i + 1], /^⁡$/) && els[i + 2]) {
      const end = argumentEnd(els, i + 2);
      out.push(`<m:func><m:fName>${node(el)}</m:fName><m:e>${row(els.slice(i + 2, end))}</m:e></m:func>`);
      i = end - 1;
      continue;
    }
    out.push(node(el));
  }
  return out.join('');
}

const OPENERS = /^[([{⟨|‖⌊⌈]$/;
const CLOSERS = /^[)\]}⟩|‖⌋⌉]$/;

/** Where a function's argument ends: one element, or a whole bracket pair (sin(2x)). */
function argumentEnd(els: XmlElement[], start: number): number {
  if (!isMo(els[start], OPENERS)) return start + 1;
  let depth = 0;
  for (let j = start; j < els.length; j++) {
    const t = els[j].name === 'mo' ? textOf(els[j]).trim() : '';
    if (OPENERS.test(t) && !(CLOSERS.test(t) && depth > 0)) depth++;
    else if (CLOSERS.test(t)) depth--;
    if (depth === 0) return j + 1;
  }
  return start + 1;
}

function fenced(el: XmlElement): string | null {
  const kids = elements(el.children);
  const first = kids[0];
  if (kids.length < 2 || first.name !== 'mo' || first.attrs.fence !== 'true') return null;
  const last = kids[kids.length - 1];
  const closed = last.name === 'mo' && last.attrs.fence === 'true';
  const open = textOf(first).trim();
  const close = closed ? textOf(last).trim() : '';
  const inner = kids.slice(1, closed ? -1 : undefined);
  return `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr><m:e>${row(inner)}</m:e></m:d>`;
}

const OVERLINE = /^[‾¯_]$/;

/** KaTeX writes accents as spacing characters; Word wants the combining ones. */
const COMBINING: Record<string, string> = {
  '^': '̂',
  ˆ: '̂',
  '~': '̃',
  '˜': '̃',
  ˉ: '̄',
  '˘': '̆',
  '˙': '̇',
  '¨': '̈',
  '˚': '̊',
  ˇ: '̌',
  '´': '́',
  '`': '̀',
  '→': '⃗',
};
const BRACES = /^[⏞⏟⏜⏝⎴⎵]$/;
const ARROW = /^[→←↔⇒⇐⇔⟶⟵⟷⟹⟸⟺⇌⇋↦]$/;

function underOver(el: XmlElement): string {
  const [base, a, b] = elements(el.children);
  const markOf = (m: XmlElement | undefined) => (m?.name === 'mo' ? textOf(m).trim() : '');
  if (el.name === 'munderover') {
    return `<m:limUpp><m:e><m:limLow><m:e>${arg(base)}</m:e><m:lim>${arg(a)}</m:lim></m:limLow></m:e><m:lim>${arg(b)}</m:lim></m:limUpp>`;
  }
  const over = el.name === 'mover';
  const mark = markOf(a);
  if (OVERLINE.test(mark)) return `<m:bar><m:barPr><m:pos m:val="${over ? 'top' : 'bot'}"/></m:barPr><m:e>${arg(base)}</m:e></m:bar>`;
  if (BRACES.test(mark)) {
    return `<m:groupChr><m:groupChrPr><m:chr m:val="${esc(mark)}"/><m:pos m:val="${over ? 'top' : 'bot'}"/><m:vertJc m:val="${over ? 'bot' : 'top'}"/></m:groupChrPr><m:e>${arg(base)}</m:e></m:groupChr>`;
  }
  if (over && (el.attrs.accent === 'true' || a?.attrs.accent === 'true') && mark) {
    return `<m:acc><m:accPr><m:chr m:val="${esc(COMBINING[mark] ?? mark)}"/></m:accPr><m:e>${arg(base)}</m:e></m:acc>`;
  }
  // An arrow with nothing on it (\ce{->}) is just the arrow.
  if (base && isMo(core(base), ARROW) && a && !textOf(a).trim()) return arg(base);
  const tag = over ? 'limUpp' : 'limLow';
  return `<m:${tag}><m:e>${arg(base)}</m:e><m:lim>${arg(a)}</m:lim></m:${tag}>`;
}

function table(el: XmlElement): string {
  const rows = elements(el.children).filter((r) => r.name === 'mtr' || r.name === 'mlabeledtr');
  const cells = rows.map((r) => elements(r.children).filter((c) => c.name === 'mtd'));
  const align = (el.attrs.columnalign ?? '').split(/\s+/);
  // aligned/align: right-left column pairs → an equation array aligned at "&".
  if (align.length >= 2 && align[0] === 'right' && align[1] === 'left') {
    return wrap('eqArr', cells.map((r) => wrap('e', r.map((c) => row(c.children)).join(run('&')))).join(''));
  }
  const count = Math.max(1, ...cells.map((r) => r.length));
  const jc = align[0] === 'left' ? 'left' : align[0] === 'right' ? 'right' : 'center';
  const props = `<m:mPr><m:baseJc m:val="center"/><m:plcHide m:val="1"/><m:mcs><m:mc><m:mcPr><m:count m:val="${count}"/><m:mcJc m:val="${jc}"/></m:mcPr></m:mc></m:mcs></m:mPr>`;
  const body = cells.map((r) => wrap('mr', Array.from({ length: count }, (_, i) => wrap('e', r[i] ? row(r[i].children) : '')).join(''))).join('');
  return `<m:m>${props}${body}</m:m>`;
}

function enclose(el: XmlElement): string {
  const notation = el.attrs.notation ?? 'box';
  const body = row(el.children);
  if (/strike/.test(notation)) {
    const strikes = notation.includes('up') || notation.includes('updiagonal') ? '<m:strikeBLTR m:val="1"/>' : '';
    const down = notation.includes('downdiagonal') ? '<m:strikeTLBR m:val="1"/>' : '';
    const hide = '<m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/>';
    return `<m:borderBox><m:borderBoxPr>${hide}${strikes}${down}</m:borderBoxPr><m:e>${body}</m:e></m:borderBox>`;
  }
  return `<m:borderBox><m:e>${body}</m:e></m:borderBox>`;
}

function node(el: XmlElement): string {
  const kids = elements(el.children);
  switch (el.name) {
    case 'mi':
    case 'mn':
    case 'mtext':
    case 'ms':
      return token(el);
    case 'mo':
      return kids.length ? row(el.children) : token(el);
    case 'mspace': {
      const width = parseFloat(el.attrs.width ?? '0');
      return width >= 0.25 ? run(' ') : '';
    }
    case 'mfrac': {
      const noBar = /^0(?:\.0*)?[a-z]*$/.test(el.attrs.linethickness ?? '');
      const props = noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : '';
      return `<m:f>${props}<m:num>${arg(kids[0])}</m:num><m:den>${arg(kids[1])}</m:den></m:f>`;
    }
    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${row(el.children)}</m:e></m:rad>`;
    case 'mroot':
      return `<m:rad><m:deg>${arg(kids[1])}</m:deg><m:e>${arg(kids[0])}</m:e></m:rad>`;
    case 'msub':
    case 'msup':
    case 'msubsup':
      return scripts(el, arg(kids[0]));
    case 'munder':
    case 'mover':
    case 'munderover':
      return underOver(el);
    case 'mtable':
      return table(el);
    case 'menclose':
      return enclose(el);
    case 'mphantom':
    case 'annotation':
    case 'annotation-xml':
      return '';
    case 'mrow':
      return fenced(el) ?? row(el.children);
    default:
      // math, semantics, mstyle, mpadded, merror, mtd …
      return row(el.children);
  }
}
