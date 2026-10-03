/**
 * LaTeX ⇄ formula model.
 *
 * `parseLatex` reads the subset of LaTeX that KaTeX understands into the
 * model; anything it can't structure is kept verbatim as a Raw node, so
 * nothing the user wrote by hand is lost. `toLatex` writes the model back
 * as tidy LaTeX (spaces around = and +, `{,}` for decimal commas, `\left`
 * `\right` only where brackets must grow). With `marks`, it writes the
 * version the formula field renders: every node and row wrapped in
 * `\htmlData` so clicks and the caret can be mapped back to the model.
 */
import * as M from './model';

// --- Command tables --------------------------------------------------------------

interface CmdSpec {
  /** Number of math arguments. */
  args: number;
  /** Takes an optional `[…]` argument (`\sqrt[3]{x}`). */
  opt?: boolean;
  /** First argument is a literal (`\textcolor{red}{x}`). */
  lit?: boolean;
  /** Arguments are stacked: 'down' = arg 0 above arg 1, 'up' = arg 1 above arg 0. */
  stacked?: 'down' | 'up';
}

export const CMDS: Record<string, CmdSpec> = {
  '\\frac': { args: 2, stacked: 'down' },
  '\\dfrac': { args: 2, stacked: 'down' },
  '\\tfrac': { args: 2, stacked: 'down' },
  '\\cfrac': { args: 2, stacked: 'down' },
  '\\binom': { args: 2, stacked: 'down' },
  '\\dbinom': { args: 2, stacked: 'down' },
  '\\tbinom': { args: 2, stacked: 'down' },
  '\\overset': { args: 2, stacked: 'down' },
  '\\stackrel': { args: 2, stacked: 'down' },
  '\\underset': { args: 2, stacked: 'up' },
  '\\sqrt': { args: 1, opt: true },
  '\\xrightarrow': { args: 1, opt: true },
  '\\xleftarrow': { args: 1, opt: true },
  '\\xRightarrow': { args: 1, opt: true },
  '\\xLeftarrow': { args: 1, opt: true },
  '\\xLeftrightarrow': { args: 1, opt: true },
  '\\xleftrightarrow': { args: 1, opt: true },
  '\\textcolor': { args: 1, lit: true },
  '\\pmod': { args: 1 },
};
for (const name of [
  'vec', 'overrightarrow', 'overleftarrow', 'overleftrightarrow', 'overline', 'underline', 'hat', 'widehat',
  'bar', 'dot', 'ddot', 'dddot', 'tilde', 'widetilde', 'check', 'widecheck', 'breve', 'acute', 'grave',
  'mathring', 'overgroup', 'undergroup', 'cancel', 'bcancel', 'xcancel', 'boxed', 'phantom', 'hphantom',
  'vphantom', 'overbrace', 'underbrace', 'underleftarrow', 'underrightarrow', 'utilde', 'not',
]) {
  if (name !== 'not') CMDS['\\' + name] = { args: 1 };
}

/** Commands whose argument is text-like (one Sym per character). */
const TEXT_CMDS = new Set([
  '\\text', '\\textrm', '\\textit', '\\textbf', '\\textsf', '\\texttt', '\\textnormal', '\\mathrm', '\\mathit',
  '\\mathbf', '\\mathsf', '\\mathtt', '\\mathbb', '\\mathcal', '\\mathfrak', '\\mathscr', '\\boldsymbol',
  '\\operatorname', '\\ce', '\\pu',
]);

/** Chemistry (mhchem) reads its own syntax: shown as plain text while being edited. */
const CHEM_CMDS = new Set(['\\ce', '\\pu']);

/** With a single character these are one symbol (ℝ, 𝐯), not editable text. */
const SYMBOL_STYLES = new Set(['\\mathbb', '\\mathcal', '\\mathfrak', '\\mathscr', '\\mathbf', '\\boldsymbol', '\\mathrm', '\\mathit', '\\mathsf']);

export const ENVS = new Set([
  'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'cases', 'dcases', 'rcases',
  'array', 'aligned', 'gathered',
]);

const SIZE_CMDS = /^\\(big|Big|bigg|Bigg)[lrm]?$/;

/** Commands that can follow \left, \right and \big. */
const DELIMS = new Set([
  '\\{', '\\}', '\\|', '\\langle', '\\rangle', '\\lvert', '\\rvert', '\\lVert', '\\rVert', '\\lfloor', '\\rfloor',
  '\\lceil', '\\rceil', '\\uparrow', '\\downarrow', '\\updownarrow', '\\Uparrow', '\\Downarrow', '\\backslash',
  '\\lgroup', '\\rgroup',
]);

/** Fractions and other tall things that make brackets around them grow. */
const TALL_CMDS = new Set(['\\frac', '\\dfrac', '\\cfrac', '\\binom', '\\dbinom', '\\overset', '\\underset', '\\stackrel', '\\overbrace', '\\underbrace']);

// --- Tokens ----------------------------------------------------------------------

type Tok =
  | { t: 'cmd'; v: string; len: number }
  | { t: 'char'; v: string; len: number }
  | { t: '{' | '}' | '^' | '_' | '&' | 'nl' | 'ph' | 'slot' | 'prev'; v: string; len: number };

const isLetter = (c: string | undefined) => c !== undefined && /[a-zA-Z]/.test(c);

const UNICODE_NORMALIZE: Record<string, string> = {
  '−': '-',
  '·': '\\cdot',
  '×': '\\times',
  '÷': '\\div',
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\ne',
  '≈': '\\approx',
  '±': '\\pm',
  '∞': '\\infty',
  '→': '\\to',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
  '⇌': '\\rightleftharpoons',
  '°': '^\\circ',
};

class Parser {
  pos = 0;
  /** Open environments and \left groups: their ends stop any row inside them. */
  private envDepth = 0;
  private leftDepth = 0;
  constructor(readonly src: string) {}

  skipSpace(): void {
    const { src } = this;
    while (this.pos < src.length) {
      const c = src[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos++;
      else if (c === '%') {
        while (this.pos < src.length && src[this.pos] !== '\n') this.pos++;
      } else break;
    }
  }

  token(): Tok | null {
    this.skipSpace();
    const { src, pos } = this;
    if (pos >= src.length) return null;
    const c = src[pos];
    if (c === '\\') {
      const next = src[pos + 1];
      if (next === undefined) return { t: 'char', v: '\\', len: 1 };
      if (next === '\\') return { t: 'nl', v: '\\\\', len: 2 };
      if (isLetter(next)) {
        const name = /^\\[a-zA-Z]+/.exec(src.slice(pos))![0];
        return { t: 'cmd', v: name, len: name.length };
      }
      return { t: 'cmd', v: '\\' + next, len: 2 };
    }
    if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&') return { t: c, v: c, len: 1 };
    if (c === '#') {
      const next = src[pos + 1];
      if (next === '?') return { t: 'ph', v: '#?', len: 2 };
      if (next === '0') return { t: 'slot', v: '#0', len: 2 };
      if (next === '@') return { t: 'prev', v: '#@', len: 2 };
    }
    const ch = String.fromCodePoint(src.codePointAt(pos)!);
    return { t: 'char', v: ch, len: ch.length };
  }

  take(): Tok | null {
    const tok = this.token();
    if (tok) this.pos += tok.len;
    return tok;
  }

  /**
   * The raw text of a `{…}` group (balanced), without the braces; '' if
   * there's none or it never closes (then nothing is consumed).
   */
  readBraced(): string {
    this.skipSpace();
    if (this.src[this.pos] !== '{') return '';
    let depth = 0;
    const start = this.pos + 1;
    for (let i = this.pos; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        this.pos = i + 1;
        return this.src.slice(start, i);
      }
    }
    return '';
  }

  /** A delimiter after `\left`, `\right`, `\big` …: `(`, `\{`, `.`, `\langle` ('.' if there's none). */
  readDelim(): string {
    const tok = this.token();
    if (!tok) return '.';
    if (tok.t === 'cmd' && tok.v === '\\vert') {
      this.take();
      return '|';
    }
    if (tok.t === 'cmd' && tok.v === '\\Vert') {
      this.take();
      return '\\|';
    }
    if ((tok.t === 'char' && '()[]|./<>'.includes(tok.v)) || (tok.t === 'cmd' && DELIMS.has(tok.v))) {
      this.take();
      return tok.v;
    }
    return '.';
  }

  /** One row: items until `stop` matches (the stop token is not consumed). */
  parseRow(stop: (tok: Tok) => boolean): M.MathNode[] {
    const items: M.MathNode[] = [];
    let attachable = false;
    for (;;) {
      const tok = this.token();
      if (!tok || stop(tok) || this.closesOuter(tok)) break;
      if (tok.t === '^' || tok.t === '_') {
        this.pos += tok.len;
        const arg = this.parseArg();
        const last = items[items.length - 1];
        const key = tok.t === '^' ? 'sup' : 'sub';
        if (attachable && last?.kind === 'scripts' && last[key] === null) {
          last[key] = arg;
          arg.parent = last;
        } else {
          items.push(M.scripts(key === 'sub' ? arg : null, key === 'sup' ? arg : null));
        }
        attachable = true;
        continue;
      }
      attachable = false;
      if (tok.t === '}' || tok.t === '&' || tok.t === 'nl') {
        // Stray here (outside a group or environment): skip it.
        this.pos += tok.len;
        continue;
      }
      if (tok.t === 'cmd' && (tok.v === '\\limits' || tok.v === '\\nolimits')) {
        this.pos += tok.len;
        const last = items[items.length - 1];
        if (last?.kind === 'sym') last.latex += tok.v;
        continue;
      }
      items.push(...this.parseAtom());
    }
    return groupBrackets(items);
  }

  /** `\end`, `\right`, `&` and `\\` end the environment or group around a row, even inside braces. */
  private closesOuter(tok: Tok): boolean {
    if (tok.t === 'cmd') return (tok.v === '\\end' && this.envDepth > 0) || (tok.v === '\\right' && this.leftDepth > 0);
    return (tok.t === '&' || tok.t === 'nl') && this.envDepth > 0;
  }

  /** An argument: `{…}` or a single token. */
  parseArg(): M.Row {
    const tok = this.token();
    if (!tok) return M.row();
    if (tok.t === '{') {
      this.pos += 1;
      const items = this.parseRow((t) => t.t === '}');
      if (this.token()?.t === '}') this.pos += 1;
      return M.row(items);
    }
    if (tok.t === '}' || tok.t === '&' || tok.t === 'nl' || tok.t === '^' || tok.t === '_') return M.row();
    return M.row(this.parseAtom());
  }

  /** The next atom (consumes it). Usually one node; a `{…}` group may give several. */
  parseAtom(): M.MathNode[] {
    const start = this.pos;
    const tok = this.take()!;
    switch (tok.t) {
      case 'ph':
        return [M.placeholder()];
      case 'slot':
        return [M.slot()];
      case 'prev':
        return [{ ...M.slot(), prev: true }];
      case '{': {
        const items = this.parseRow((t) => t.t === '}');
        if (this.token()?.t === '}') this.pos += 1;
        if (items.length === 1 && items[0].kind === 'sym' && items[0].latex === ',') return [M.sym(',', 'punct', true)];
        const next = this.token();
        if (items.length > 1 && (next?.t === '^' || next?.t === '_')) return [M.group('', '', M.row(items))];
        return items;
      }
      case 'char':
        return this.parseChar(tok.v);
      case 'cmd':
        return this.parseCommand(tok.v, start);
      default:
        return [];
    }
  }

  parseChar(ch: string): M.MathNode[] {
    const normalized = UNICODE_NORMALIZE[ch];
    if (normalized === '^\\circ') return [M.scripts(null, M.row([M.sym('\\circ')]))];
    if (normalized) return [M.sym(normalized)];
    if (ch === "'") return [M.sym("'", 'ord')];
    if (ch === '~') return [M.sym('~', 'space')];
    if (ch === '#' || ch === '$' || ch === '%') return [M.sym('\\' + ch, 'ord')];
    if (ch === '\\') return [M.sym('\\backslash', 'ord')];
    return [M.sym(ch)];
  }

  parseCommand(name: string, start: number): M.MathNode[] {
    if (name === '\\left') return [this.parseLeftRight()];
    if (name === '\\begin') return [this.parseEnv(start)];
    if (name === '\\right' || name === '\\middle') {
      this.readDelim();
      return [];
    }
    if (name === '\\end') {
      this.readBraced();
      return [];
    }
    if (TEXT_CMDS.has(name)) return [this.parseTextLike(name, start)];
    const spec = CMDS[name];
    if (spec) {
      let opt: M.Row | null = null;
      this.skipSpace();
      if (spec.opt && this.src[this.pos] === '[') {
        this.pos++;
        opt = M.row(this.parseRow((t) => t.t === 'char' && t.v === ']'));
        if (this.token()?.v === ']') this.pos++;
      }
      const lit = spec.lit ? this.readBraced() : undefined;
      const args: M.Row[] = [];
      for (let i = 0; i < spec.args; i++) args.push(this.parseArg());
      return [M.cmd(name, args, opt, lit)];
    }
    if (name === '\\not') {
      const next = this.take();
      return [M.sym('\\not' + (next?.t === 'cmd' ? next.v : (next?.v ?? '')), 'rel')];
    }
    if (SIZE_CMDS.test(name)) {
      const delim = this.readDelim();
      const cls = name.endsWith('l') ? 'open' : name.endsWith('r') ? 'close' : 'ord';
      return [M.sym(name + (/^\\[a-zA-Z]/.test(delim) ? ' ' : '') + delim, cls)];
    }
    if (name === '\\color') return [M.raw(`\\color{${this.readBraced()}}`)];
    if (name === '\\vert') return [M.sym('|')];
    if (name === '\\Vert') return [M.sym('\\|')];
    // An unknown command with arguments is kept as it is.
    this.skipSpace();
    if (!isKnownSymbol(name) && this.src[this.pos] === '{') {
      while (this.src[this.pos] === '{') {
        const at = this.pos;
        this.readBraced();
        if (this.pos === at) break; // never closes
        this.skipSpace();
      }
      return [M.raw(this.src.slice(start, this.pos).trim())];
    }
    return [M.sym(name)];
  }

  parseLeftRight(): M.Group {
    const open = this.readDelim();
    this.leftDepth++;
    const items = this.parseRow((t) => t.t === 'cmd' && t.v === '\\right');
    this.leftDepth--;
    let close = '.';
    if (this.token()?.v === '\\right') {
      this.take();
      close = this.readDelim();
    }
    return M.group(open, close, M.row(items));
  }

  parseEnv(start: number): M.MathNode {
    const name = this.readBraced();
    if (!ENVS.has(name)) {
      // Unknown environment: keep it verbatim (up to the matching \end).
      const re = new RegExp(`\\\\(begin|end)\\{${name.replace(/[*]/g, '\\*')}\\}`, 'g');
      re.lastIndex = this.pos;
      let depth = 1;
      for (let m = re.exec(this.src); m; m = re.exec(this.src)) {
        depth += m[1] === 'begin' ? 1 : -1;
        if (depth === 0) {
          this.pos = m.index + m[0].length;
          return M.raw(this.src.slice(start, this.pos));
        }
      }
      // No \end: keep just the \begin{…} as it is and read on.
      return M.raw(this.src.slice(start, this.pos));
    }
    const colSpec = name === 'array' ? this.readBraced() : null;
    this.envDepth++;
    const cells: M.Row[][] = [];
    const hlines: number[] = [];
    let current: M.Row[] = [];
    for (;;) {
      if (current.length === 0) {
        for (let tok = this.token(); tok?.t === 'cmd' && (tok.v === '\\hline' || tok.v === '\\hdashline'); tok = this.token()) {
          this.take();
          if (!hlines.includes(cells.length)) hlines.push(cells.length);
        }
      }
      const items = this.parseRow((t) => t.t === '&' || t.t === 'nl' || (t.t === 'cmd' && t.v === '\\end'));
      current.push(M.row(items));
      const tok = this.take();
      if (!tok) break;
      if (tok.t === '&') continue;
      if (tok.t === 'nl') {
        cells.push(current);
        current = [];
        continue;
      }
      this.readBraced(); // \end{name}
      break;
    }
    this.envDepth--;
    // A trailing "\\" leaves an empty last row: drop it (but an empty line being written stays).
    const trailingEmpty = current.length === 1 && current[0].items.length === 0 && cells.length > 0;
    if (!trailingEmpty || name === 'aligned') cells.push(current);
    if (name === 'aligned') {
      // Alignment points are written automatically; one cell per line.
      return M.env(name, cells.map((r) => [M.row(r.flatMap((cell) => cell.items))]), null, []);
    }
    const width = Math.max(...cells.map((r) => r.length));
    for (const r of cells) while (r.length < width) r.push(M.row());
    return M.env(name, cells, colSpec, hlines);
  }

  parseTextLike(name: string, start: number): M.MathNode {
    this.skipSpace();
    let content: string;
    if (this.src[this.pos] === '{') content = this.readBraced();
    else {
      const tok = this.take();
      content = tok?.v ?? '';
    }
    if (name === '\\operatorname') return M.sym(`\\operatorname{${content}}`, 'func');
    if (CHEM_CMDS.has(name)) {
      // mhchem's own syntax (H2O, SO4^2-, ->) is kept as typed.
      return /[{}$\\]/.test(content) ? M.raw(this.src.slice(start, this.pos)) : M.text(name, M.textRow(content));
    }
    const decoded = decodeText(content);
    if (decoded === null) return M.raw(this.src.slice(start, this.pos));
    if (SYMBOL_STYLES.has(name) && [...decoded].length === 1) return M.sym(`${name}{${content}}`, 'ord');
    return M.text(name, M.textRow(decoded));
  }
}

/** Zero-argument commands we know, so an unknown `\foo{…}` can be kept whole. */
const ORD_SYMBOLS = new Set(
  (
    'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi ' +
    'varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma ' +
    'Upsilon Phi Psi Omega infty partial nabla emptyset varnothing forall exists nexists neg lnot angle ' +
    'measuredangle triangle square blacksquare Box circ degree prime hbar ell Re Im aleph dots ldots cdots vdots ' +
    'ddots therefore because top bot checkmark complement imath jmath'
  )
    .split(' ')
    .map((n) => '\\' + n),
);
const isKnownSymbol = (name: string) => M.classOf(name) !== 'ord' || ORD_SYMBOLS.has(name);

const TEXT_ESCAPES: Record<string, string> = {
  '\\{': '{',
  '\\}': '}',
  '\\$': '$',
  '\\%': '%',
  '\\&': '&',
  '\\#': '#',
  '\\_': '_',
  '\\ ': ' ',
  '\\textbackslash': '\\',
  '\\textasciicircum': '^',
  '\\textasciitilde': '~',
};

/** Plain text from a `\text{…}` argument, or null if it holds more than text. */
function decodeText(content: string): string | null {
  let out = '';
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '$' || c === '{' || c === '}' || c === '^' || c === '_') return null;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const m = /^\\([a-zA-Z]+|.)/.exec(content.slice(i));
    const escape = m ? TEXT_ESCAPES[m[0]] : undefined;
    if (escape === undefined) return null;
    out += escape;
    i += m![0].length - 1;
    // "\textbackslash{}" / "\textbackslash " end with an empty group or a space.
    if (content.startsWith('{}', i + 1)) i += 2;
    else if (/^[a-z]/.test(m![1]) && content[i + 1] === ' ') i += 1;
  }
  return out;
}

function encodeText(s: string): string {
  return [...s]
    .map((c) => {
      switch (c) {
        case '\\':
          return '\\textbackslash{}';
        case '^':
          return '\\textasciicircum{}';
        case '~':
          return '\\textasciitilde{}';
        case '{':
        case '}':
        case '$':
        case '%':
        case '&':
        case '#':
        case '_':
          return '\\' + c;
        default:
          return c;
      }
    })
    .join('');
}

/** Turn matching bracket symbols in a row into groups: `( … )` → Group. */
function groupBrackets(items: M.MathNode[]): M.MathNode[] {
  const out: M.MathNode[] = [];
  const stack: { index: number; open: string }[] = [];
  for (const node of items) {
    if (node.kind === 'sym') {
      const l = node.latex;
      let match = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (M.PAIRS[stack[i].open] === l) {
          match = i;
          break;
        }
      }
      if (match >= 0) {
        const entry = stack[match];
        stack.length = match;
        const body = out.splice(entry.index + 1);
        out.pop();
        out.push(M.group(entry.open, l, M.row(body)));
        continue;
      }
      if (l in M.PAIRS) stack.push({ index: out.length, open: l });
    }
    out.push(node);
  }
  return out;
}

// --- Parsing entry points --------------------------------------------------------

/** Parse a formula into lines (several only for multi-line display math). */
export function parseLatex(latex: string): M.Row[] {
  const p = new Parser(latex);
  const lines: M.Row[] = [];
  for (;;) {
    lines.push(M.row(p.parseRow((t) => t.t === 'nl')));
    if (!p.take()) break;
  }
  // `\begin{aligned} … \end{aligned}` on its own is the multi-line form we write.
  const only = lines.length === 1 && lines[0].items.length === 1 ? lines[0].items[0] : null;
  const result = only?.kind === 'env' && only.name === 'aligned' ? only.cells.map((cells) => cells[0]) : lines;
  M.relink(result);
  return result;
}

/** Parse LaTeX as a single row's nodes (templates, pasted text). */
export function parseNodes(latex: string): M.MathNode[] {
  const p = new Parser(latex);
  return p.parseRow(() => false);
}

// --- Writing ---------------------------------------------------------------------

export interface WriteOptions {
  /** Wrap nodes and rows in `\htmlData` and show placeholders (the formula field). */
  marks?: boolean;
  /** Show Raw nodes as text instead of LaTeX (when they made rendering fail). */
  rawAsText?: boolean;
  /** Write placeholders as `#?` and selection slots as `#0`/`#@` (editing a shortcut's template). */
  template?: boolean;
}

const PLACEHOLDER = '\\htmlClass{mf-ph}{\\square}';
const SLOT = '\\htmlClass{mf-slot}{\\blacksquare}';

/**
 * Join two pieces of LaTeX, adding a space where a command name would run
 * into a letter (required), or a digit or script into a letter (readability).
 */
function join(a: string, b: string): string {
  if (/(\\[a-zA-Z]+|[_^][a-zA-Z0-9])$/.test(a) && /^[a-zA-Z0-9]/.test(b)) return a + ' ' + b;
  return a + b;
}

function isUnary(items: M.MathNode[], i: number): boolean {
  if (i === 0) return true;
  const prev = items[i - 1];
  return prev.kind === 'sym' && ['bin', 'rel', 'open', 'punct', 'op'].includes(prev.cls);
}

function spaced(items: M.MathNode[], i: number): boolean {
  const n = items[i];
  if (n.kind !== 'sym') return false;
  return n.cls === 'rel' || (n.cls === 'bin' && !isUnary(items, i));
}

/** Whether brackets around this row should grow with its content. */
function isTall(r: M.Row): boolean {
  return r.items.some(
    (n) =>
      (n.kind === 'cmd' && TALL_CMDS.has(n.name)) ||
      n.kind === 'env' ||
      (n.kind === 'sym' && n.cls === 'op') ||
      (n.kind === 'group' && isTall(n.body)),
  );
}

const isDigit = (n: M.MathNode | undefined) => n?.kind === 'sym' && n.cls === 'num';

class Writer {
  constructor(readonly opts: WriteOptions) {}

  get marks(): boolean {
    return !!this.opts.marks;
  }

  /** A child row (argument, script, cell): wrapped so it can be found in the rendering. */
  child(r: M.Row): string {
    const inner = this.row(r);
    if (!this.marks) return inner;
    return `\\htmlData{r=${r.id}}{${r.items.length === 0 ? PLACEHOLDER : inner}}`;
  }

  /** Script argument: braces unless it's a single digit or letter. */
  script(r: M.Row): string {
    if (!this.marks && r.items.length === 1) {
      const n = r.items[0];
      if (n.kind === 'sym' && /^[a-zA-Z0-9]$/.test(n.latex)) return n.latex;
    }
    return `{${this.child(r)}}`;
  }

  row(r: M.Row, alignAt = -1): string {
    const { items } = r;
    if (items.length === 0) return this.marks && !r.parent ? `\\htmlData{r=${r.id}}{${PLACEHOLDER}}` : '';
    let out = '';
    items.forEach((node, i) => {
      let piece = this.node(node, items, i);
      if (this.marks && node.kind !== 'scripts') {
        // What carries a script stays unwrapped, so TeX places the script exactly as in the
        // finished formula (and keeps the spacing inside brackets); an empty marker before
        // it lets the field find it.
        piece =
          items[i + 1]?.kind === 'scripts'
            ? `\\htmlData{a=${node.id},m=1}{}${piece}`
            : `\\htmlData{a=${node.id}}{${piece}}`;
      }
      if (i === alignAt) piece = '&' + piece;
      if (i > 0 && node.kind !== 'scripts' && !this.marks) {
        const prev = items[i - 1];
        const afterComma = prev.kind === 'sym' && prev.latex === ',' && !this.decimalComma(items, i - 1);
        if (spaced(items, i) || spaced(items, i - 1) || afterComma || i === alignAt) out += ' ';
      }
      out = join(out, piece);
    });
    return out;
  }

  decimalComma(items: M.MathNode[], i: number): boolean {
    const n = items[i];
    return n.kind === 'sym' && n.latex === ',' && !!n.decimal && isDigit(items[i - 1]) && isDigit(items[i + 1]);
  }

  node(node: M.MathNode, items: M.MathNode[], i: number): string {
    switch (node.kind) {
      case 'sym':
        return this.decimalComma(items, i) ? '{,}' : node.latex;
      case 'ph':
        return this.marks ? PLACEHOLDER : this.opts.template ? '#?' : '';
      case 'slot':
        if (this.marks) return SLOT;
        return this.opts.template ? (node.prev ? '#@' : '#0') : '';
      case 'raw':
        return this.opts.rawAsText ? `\\htmlClass{mf-raw}{\\text{${encodeText(node.latex)}}}` : node.latex;
      case 'cmd': {
        let out = node.name;
        if (node.opt && (node.opt.items.length > 0 || this.marks)) out += `[${this.child(node.opt)}]`;
        if (node.lit !== undefined) out += `{${node.lit}}`;
        for (const arg of node.args) out += `{${this.child(arg)}}`;
        return out;
      }
      case 'scripts': {
        const prev = items[i - 1];
        let out = !prev || prev.kind === 'scripts' ? '{}' : '';
        if (node.sub) out += '_' + this.script(node.sub);
        if (node.sup) out += '^' + this.script(node.sup);
        return out;
      }
      case 'group': {
        const body = this.child(node.body);
        if (node.open === '' && node.close === '') return `{${body}}`;
        const sized = node.open === '.' || node.close === '.' || isTall(node.body);
        if (sized) return join(join(`\\left${node.open}`, body), `\\right${node.close}`);
        return join(join(node.open, body), node.close);
      }
      case 'text': {
        // Text next to math gets a space on that side, so «x = 2 eller x = 3» reads right.
        const s = M.textOf(node.body);
        const pad = node.cmd.startsWith('\\text');
        const before = pad && i > 0 && !s.startsWith(' ') ? ' ' : '';
        const after = pad && i < items.length - 1 && !s.endsWith(' ') ? ' ' : '';
        if (!this.marks) return `${node.cmd}{${before}${CHEM_CMDS.has(node.cmd) ? s.replace(/[{}$\\]/g, '') : encodeText(s)}${after}}`;
        if (node.body.items.length === 0) return `\\htmlData{r=${node.body.id}}{${PLACEHOLDER}}`;
        const chars = node.body.items
          .map((c) => `\\htmlData{a=${c.id}}{${encodeText(c.kind === 'sym' ? c.latex : '')}}`)
          .join('');
        if (CHEM_CMDS.has(node.cmd)) return `\\htmlData{r=${node.body.id}}{\\htmlClass{mf-chem}{\\texttt{${chars}}}}`;
        return `\\htmlData{r=${node.body.id}}{${node.cmd}{${before}${chars}${after}}}`;
      }
      case 'cmdinput': {
        if (!this.marks) return '';
        const chars = node.body.items
          .map((c) => `\\htmlData{a=${c.id}}{${c.kind === 'sym' ? encodeText(c.latex) : ''}}`)
          .join('');
        return `\\htmlClass{mf-cmd}{\\text{\\textbackslash\\htmlData{r=${node.body.id}}{${chars || '\\,'}}}}`;
      }
      case 'env':
        return this.env(node);
    }
  }

  env(node: M.Env): string {
    const rows = node.cells.map((cells, r) => {
      const line = node.name === 'aligned' ? this.alignedLine(cells[0]) : cells.map((c) => this.child(c)).join(' & ');
      return (node.hlines.includes(r) ? '\\hline ' : '') + line;
    });
    let body = rows.join(' \\\\ ');
    if (node.hlines.includes(node.cells.length)) body += ' \\\\ \\hline';
    const spec = node.colSpec !== null ? `{${node.colSpec}}` : '';
    return `\\begin{${node.name}}${spec} ${body} \\end{${node.name}}`;
  }

  /** A line of an aligned block: `&` before its first relation (never inside a marker group). */
  alignedLine(r: M.Row): string {
    if (r.items.length === 0) return this.marks ? `\\htmlData{r=${r.id}}{${PLACEHOLDER}}` : '';
    return this.row(r, M.alignIndex(r.items));
  }
}

/**
 * Write lines as LaTeX. Several lines become an `aligned` block with each
 * line aligned at its first relation (`=`, `<`, `⇔` …).
 */
export function toLatex(lines: M.Row[], opts: WriteOptions = {}): string {
  const w = new Writer(opts);
  if (lines.length <= 1) return w.row(lines[0] ?? M.row());
  const body = lines.map((l) => w.alignedLine(l)).join(opts.marks ? ' \\\\ ' : ' \\\\\n');
  return opts.marks ? `\\begin{aligned} ${body} \\end{aligned}` : `\\begin{aligned}\n${body}\n\\end{aligned}`;
}

/** LaTeX for some nodes of a row (copying a selection). */
export function nodesToLatex(nodes: M.MathNode[]): string {
  const copy = M.row(nodes.map(M.cloneNode));
  return new Writer({}).row(copy);
}

export function cmdSpec(name: string): CmdSpec | undefined {
  return CMDS[name];
}
