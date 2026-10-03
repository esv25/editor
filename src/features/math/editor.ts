/**
 * How the formula field behaves, without any DOM: a cursor in the model and
 * the operations keys and buttons trigger.
 *
 * - Typing: «/» makes a fraction of the term before it, «^»/«_» scripts,
 *   «(» «[» «{» «|» bracket pairs, «*» is ·, «"» starts text, «\» a command,
 *   «,» between digits is a decimal comma (a space after it makes it a list
 *   comma). Typed shortcuts («sqrt», «pi», «<=», «->» …) are replaced as you
 *   type; Backspace right after a replacement takes it back.
 * - Space jumps on (numerator → denominator → out); Tab goes to the next
 *   empty spot; Enter makes a new line (display) or leaves (inline).
 * - Backspace steps into structures and unwraps them at their start, as in
 *   MathQuill/MathLive, so nothing large disappears by accident.
 *
 * Methods that can leave the formula return an Exit direction; the field
 * then hands the cursor back to the text editor.
 */
import * as M from './model';
import { cmdSpec, nodesToLatex, parseLatex, parseNodes, toLatex } from './latex';

export type Exit = 'left' | 'right' | 'up' | 'down';

export interface Pos {
  row: M.Row;
  index: number;
}

export interface Snapshot {
  lines: M.Row[];
  path: number[];
  anchor: number | null;
}

export interface EditorOptions {
  display: boolean;
  /** Typed shortcut → LaTeX template, or '@sup', '@sub', '@frac'. */
  shortcuts?: ReadonlyMap<string, string>;
  /** Template for a command typed after «\» (Norwegian names, aliases); undefined = default. */
  lookupCommand?: (name: string) => string | undefined;
  /** Editing a shortcut's template: empty spots and the selection slot are kept as `#?`/`#0`. */
  template?: boolean;
}

const MAX_SHORTCUT = 12;

/** Dead-key circumflex on a Norwegian keyboard: «^» + «e» arrives as «ê». */
const CIRCUMFLEX: Record<string, string> = {
  â: 'a', ê: 'e', î: 'i', ô: 'o', û: 'u', ŷ: 'y', ĉ: 'c', ĝ: 'g', ĥ: 'h', ĵ: 'j', ŝ: 's', ŵ: 'w', ẑ: 'z',
  Â: 'A', Ê: 'E', Î: 'I', Ô: 'O', Û: 'U', Ŷ: 'Y', Ĉ: 'C', Ĝ: 'G', Ĥ: 'H', Ĵ: 'J', Ŝ: 'S', Ŵ: 'W', Ẑ: 'Z',
};

/** Unicode characters typed (or pasted) directly. */
const UNICODE_INPUT: Record<string, string> = {
  '²': '^{2}', '³': '^{3}', '¹': '^{1}', '½': '\\frac{1}{2}', '¼': '\\frac{1}{4}', '¾': '\\frac{3}{4}',
  '°': '^{\\circ}', '√': '\\sqrt{#0}', '·': '\\cdot', '×': '\\times', '÷': '\\div', '−': '-', '±': '\\pm',
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '∞': '\\infty', 'π': '\\pi', '∈': '\\in',
  '∉': '\\notin', '∫': '\\int', '∑': '\\sum', '→': '\\to', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
  'Δ': '\\Delta', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'θ': '\\theta',
  'λ': '\\lambda', 'μ': '\\mu', 'σ': '\\sigma', 'φ': '\\varphi', 'ω': '\\omega', '∠': '\\angle',
  '⊥': '\\perp', '∥': '\\parallel', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset', '‰': '\\text{‰}',
  '§': '', '¨': '', '´': '', '`': '',
};

/** Escapes for characters that mean something in LaTeX. */
const ESCAPED: Record<string, string> = { '%': '\\%', $: '\\$', '#': '\\#', '&': '\\&', '~': '\\sim' };

function isTermPart(n: M.MathNode): boolean {
  switch (n.kind) {
    case 'sym':
      return (
        n.cls === 'num' || n.cls === 'var' || (n.cls === 'ord' && n.latex !== '/') || !!n.decimal || n.latex === '!'
      );
    case 'scripts':
    case 'cmd':
    case 'group':
    case 'raw':
      return true;
    default:
      return false;
  }
}

/** The row above/below `row` inside `node`, if the node stacks them. */
function verticalNeighbor(node: M.MathNode, row: M.Row, dir: 'up' | 'down'): M.Row | null {
  switch (node.kind) {
    case 'cmd': {
      const stacked = cmdSpec(node.name)?.stacked;
      if (!stacked) return null;
      const [top, bottom] = stacked === 'down' ? [node.args[0], node.args[1]] : [node.args[1], node.args[0]];
      if (dir === 'up' && row === bottom) return top;
      if (dir === 'down' && row === top) return bottom;
      return null;
    }
    case 'scripts':
      if (dir === 'up' && row === node.sub) return node.sup;
      if (dir === 'down' && row === node.sup) return node.sub;
      return null;
    case 'env': {
      const r = node.cells.findIndex((cells) => cells.includes(row));
      const c = node.cells[r].indexOf(row);
      return node.cells[r + (dir === 'up' ? -1 : 1)]?.[c] ?? null;
    }
    default:
      return null;
  }
}

/** The math symbol for a character that was text (when text is unwrapped). */
function mathSym(ch: string): M.MathNode[] {
  if (ch === ' ') return [];
  if (ESCAPED[ch]) return [M.sym(ESCAPED[ch])];
  if ('{}\\^_'.includes(ch)) return [];
  return [M.sym(ch)];
}

type Spot = { kind: 'ph'; row: M.Row; index: number } | { kind: 'empty'; row: M.Row };

export class MathEditor {
  lines: M.Row[];
  pos: Pos;
  /** Selection anchor (an index in pos.row); null = no selection. */
  anchor: number | null = null;
  private buffer: { ch: string; before: Snapshot }[] = [];
  /** Buffer range used by the last shortcut: a new match must cover all of it or none. */
  private consumed: [number, number] | null = null;
  /** State to go back to if Backspace follows an automatic replacement. */
  private revert: Snapshot | null = null;

  constructor(
    latex: string,
    readonly options: EditorOptions,
  ) {
    this.lines = parseLatex(latex);
    if (!options.display && this.lines.length > 1) {
      this.lines = [M.row(this.lines.flatMap((l) => l.items))];
    }
    const last = this.lines[this.lines.length - 1];
    this.pos = { row: last, index: last.items.length };
  }

  // --- State -------------------------------------------------------------------

  get latex(): string {
    return toLatex(this.lines, { template: this.options.template });
  }

  isEmpty(): boolean {
    return this.lines.every((l) => l.items.every((n) => n.kind === 'ph' || n.kind === 'cmdinput'));
  }

  get hasSelection(): boolean {
    return this.anchor !== null && this.anchor !== this.pos.index;
  }

  /** The selected nodes (all in pos.row). */
  selectedNodes(): M.MathNode[] {
    if (!this.hasSelection) return [];
    const [from, to] = this.range();
    return this.pos.row.items.slice(from, to);
  }

  selectionLatex(): string {
    return nodesToLatex(this.selectedNodes());
  }

  /** The command being typed after «\», or null. */
  pendingCommand(): string | null {
    const p = this.pos.row.parent;
    return p?.kind === 'cmdinput' ? M.textOf(p.body) : null;
  }

  /** The innermost environment cell holding the cursor. */
  envCell(): { env: M.Env; r: number; c: number } | null {
    for (let row: M.Row | null = this.pos.row; row?.parent; row = row.parent.parent) {
      const node = row.parent;
      if (node.kind === 'env') {
        const r = node.cells.findIndex((cells) => cells.includes(row!));
        return { env: node, r, c: node.cells[r].indexOf(row) };
      }
    }
    return null;
  }

  snapshot(): Snapshot {
    return { lines: this.lines.map(M.cloneRow), path: this.cursorPath(), anchor: this.anchor };
  }

  restore(s: Snapshot): void {
    this.lines = s.lines.map(M.cloneRow);
    M.relink(this.lines);
    this.pos = this.resolve(s.path);
    this.anchor = s.anchor !== null && s.anchor <= this.pos.row.items.length ? s.anchor : null;
  }

  /** The cursor as indices from the top (survives re-parsing the same LaTeX). */
  cursorPath(pos: Pos = this.pos): number[] {
    const path = [pos.index];
    let r = pos.row;
    while (r.parent) {
      const node = r.parent;
      path.unshift(M.childRows(node).indexOf(r));
      const prow = node.parent!;
      path.unshift(prow.items.indexOf(node));
      r = prow;
    }
    path.unshift(Math.max(0, this.lines.indexOf(r)));
    return path;
  }

  setCursorPath(path: number[]): void {
    this.touch();
    this.anchor = null;
    this.pos = this.resolve(path);
  }

  private resolve(path: number[]): Pos {
    let r = this.lines[Math.min(path[0] ?? 0, this.lines.length - 1)];
    for (let i = 1; i < path.length - 1; i += 2) {
      const node = r.items[path[i]];
      const next = node ? M.childRows(node)[path[i + 1]] : undefined;
      if (!next) return { row: r, index: r.items.length };
      r = next;
    }
    return { row: r, index: Math.min(path[path.length - 1] ?? 0, r.items.length) };
  }

  private range(): [number, number] {
    const a = this.anchor ?? this.pos.index;
    return a < this.pos.index ? [a, this.pos.index] : [this.pos.index, a];
  }

  /** Forget shortcut and take-back state (any action other than typing). */
  private touch(): void {
    this.revert = null;
    this.buffer = [];
    this.consumed = null;
  }

  private fix(): void {
    M.relink(this.lines);
  }

  /** Remove what's selected; true if there was a selection. */
  private deleteSelection(): boolean {
    if (!this.hasSelection) {
      this.anchor = null;
      return false;
    }
    this.takeSelection();
    return true;
  }

  private takeSelection(): M.MathNode[] {
    if (!this.hasSelection) {
      this.anchor = null;
      return [];
    }
    const [from, to] = this.range();
    const nodes = this.pos.row.items.splice(from, to - from);
    this.pos = { row: this.pos.row, index: from };
    this.anchor = null;
    this.fix();
    return nodes;
  }

  // --- Typing ------------------------------------------------------------------

  /** Typed text, one character at a time. */
  type(text: string): void {
    for (const ch of text) this.typeChar(ch);
  }

  typeChar(ch: string): void {
    if (CIRCUMFLEX[ch] && this.context() === 'math') {
      this.typeChar('^');
      this.typeChar(CIRCUMFLEX[ch]);
      return;
    }
    const before = this.snapshot();
    this.revert = null;
    const context = this.context();
    if (context === 'text') {
      this.touch();
      this.textChar(ch);
      return;
    }
    if (context === 'cmd') {
      this.touch();
      this.commandChar(ch);
      return;
    }
    if (this.mathChar(ch)) {
      this.buffer.push({ ch, before });
      if (this.buffer.length > MAX_SHORTCUT) {
        this.buffer.shift();
        if (this.consumed) this.consumed = [this.consumed[0] - 1, this.consumed[1] - 1];
      }
      this.applyShortcut();
    } else {
      this.buffer = [];
      this.consumed = null;
    }
  }

  private context(): 'math' | 'text' | 'cmd' {
    const p = this.pos.row.parent;
    if (p?.kind === 'text') return 'text';
    if (p?.kind === 'cmdinput') return 'cmd';
    return 'math';
  }

  /** Handle a character in math; true if it was inserted as a plain symbol (shortcuts apply). */
  private mathChar(ch: string): boolean {
    switch (ch) {
      case '^':
        this.script('sup');
        return false;
      case '_':
        this.script('sub');
        return false;
      case '/':
        this.withTakeBack('/', () => this.fraction());
        return false;
      case '(':
        this.withTakeBack('(', () => this.openGroup('(', ')'));
        return false;
      case '[':
        this.withTakeBack('[', () => this.openGroup('[', ']'));
        return false;
      case '{':
        this.withTakeBack('\\{', () => this.openGroup('\\{', '\\}'));
        return false;
      case '|':
        if (!this.closeGroup('|')) this.withTakeBack('|', () => this.openGroup('|', '|'));
        return false;
      case ')':
      case ']':
      case '}':
        this.closeChar(ch === '}' ? '\\}' : ch);
        return false;
      case '\\':
        this.startCommand();
        return false;
      case '"':
        this.startText();
        return false;
      case ' ':
        this.space();
        return false;
      case '\n':
      case '\r':
      case '\t':
        return false;
      case '*':
        this.insertNodes([M.sym('\\cdot')]);
        return true;
      case "'":
        this.insertNodes([M.sym("'", 'ord')]);
        return true;
      case ',':
        this.insertNodes([M.sym(',', 'punct', true)]);
        return true;
    }
    if (ESCAPED[ch]) {
      this.insertNodes([M.sym(ESCAPED[ch])]);
      return true;
    }
    const unicode = UNICODE_INPUT[ch];
    if (unicode !== undefined) {
      if (unicode) this.template(unicode);
      return false;
    }
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) return false;
    this.insertNodes([M.sym(ch)]);
    return true;
  }

  /** Do an automatic action, but let Backspace turn it back into the typed character. */
  private withTakeBack(literal: string, action: () => void): void {
    const before = this.snapshot();
    this.insertNodes([M.sym(literal)]);
    const typed = this.snapshot();
    this.restore(before);
    action();
    this.revert = typed;
  }

  private applyShortcut(): void {
    const shortcuts = this.options.shortcuts;
    if (!shortcuts) return;
    const n = this.buffer.length;
    for (let len = Math.min(n, MAX_SHORTCUT); len >= 1; len--) {
      const start = n - len;
      if (this.consumed && start > this.consumed[0] && start < this.consumed[1]) continue;
      const trigger = this.buffer
        .slice(start)
        .map((b) => b.ch)
        .join('');
      const replacement = shortcuts.get(trigger);
      if (replacement === undefined) continue;
      const typed = this.snapshot();
      this.restore(this.buffer[start].before);
      this.replace(replacement);
      this.revert = typed;
      this.consumed = [start, n];
      return;
    }
  }

  private replace(replacement: string): void {
    if (replacement === '@sup') this.script('sup');
    else if (replacement === '@sub') this.script('sub');
    else if (replacement === '@frac') this.fraction();
    else this.template(replacement);
  }

  private textChar(ch: string): void {
    if (ch === '"') {
      this.exitNode('right');
      return;
    }
    if (ch === '\n' || ch === '\r' || ch === '\t') return;
    this.insertNodes([M.sym(ch, 'ord')]);
  }

  private commandChar(ch: string): void {
    const body = this.pos.row;
    if (/[a-zA-Z]/.test(ch)) {
      this.insertNodes([M.sym(ch, 'ord')]);
      return;
    }
    if (body.items.length === 0) {
      // «\» followed by a non-letter: a one-character command (\, \{ \% …).
      this.cancelCommand();
      if (ch === '{') this.openGroup('\\{', '\\}');
      else if (ch === ' ') this.insertNodes([M.sym('\\ ', 'space')]);
      else if (ch === '\\') this.insertNodes([M.sym('\\backslash')]);
      else this.insertNodes([M.sym('\\' + ch)]);
      return;
    }
    this.commitCommand();
    if (ch !== ' ' && ch !== '\n' && ch !== '\t') this.typeChar(ch);
  }

  // --- Structures -----------------------------------------------------------------

  insertNodes(nodes: M.MathNode[]): void {
    this.deleteSelection();
    this.dropPlaceholderAtCursor();
    const { row, index } = this.pos;
    row.items.splice(index, 0, ...nodes);
    this.fix();
    this.pos = { row, index: index + nodes.length };
  }

  /** Typing next to a placeholder fills it. */
  private dropPlaceholderAtCursor(): void {
    const { row, index } = this.pos;
    if (row.items[index]?.kind === 'ph') row.items.splice(index, 1);
    else if (row.items[index - 1]?.kind === 'ph') {
      row.items.splice(index - 1, 1);
      this.pos = { row, index: index - 1 };
    }
  }

  private script(which: 'sup' | 'sub'): void {
    if (this.hasSelection) this.pos = { row: this.pos.row, index: this.range()[1] };
    this.anchor = null;
    const { row, index } = this.pos;
    const prev = row.items[index - 1];
    const next = row.items[index];
    let target = prev?.kind === 'scripts' ? prev : next?.kind === 'scripts' ? next : null;
    if (!target) {
      target = M.scripts(null, null);
      row.items.splice(index, 0, target);
    }
    if (!target[which]) target[which] = M.row();
    this.fix();
    const r = target[which]!;
    this.pos = { row: r, index: r.items.length };
  }

  /** The term just before the cursor (what «/» puts in the numerator); removed from the row. */
  private takeTerm(): M.MathNode[] {
    const { row, index } = this.pos;
    let start = index;
    while (start > 0 && isTermPart(row.items[start - 1])) start--;
    const nodes = row.items.splice(start, index - start);
    this.pos = { row, index: start };
    this.fix();
    // "(x+1)/" → x+1 over …: a fraction line already groups it.
    const only = nodes.length === 1 ? nodes[0] : null;
    if (only?.kind === 'group' && only.open === '(' && only.close === ')') return only.body.items;
    return nodes;
  }

  private fraction(): void {
    const num = this.hasSelection ? this.takeSelection() : this.takeTerm();
    const f = M.cmd('\\frac', [M.row(num), M.row()]);
    this.insertNodes([f]);
    const target = num.length ? f.args[1] : f.args[0];
    this.pos = { row: target, index: target.items.length };
  }

  private openGroup(open: string, close: string): void {
    const body = this.takeSelection();
    const g = M.group(open, close, M.row(body));
    this.insertNodes([g]);
    this.pos = { row: g.body, index: body.length };
  }

  /** At the end of a group with this closer: step out of it. */
  private closeGroup(close: string): boolean {
    const p = this.pos.row.parent;
    if (p?.kind === 'group' && p.close === close && this.pos.index === this.pos.row.items.length) {
      this.exitNode('right');
      return true;
    }
    return false;
  }

  private closeChar(close: string): void {
    if (this.closeGroup(close)) return;
    const p = this.pos.row.parent;
    const atEnd = this.pos.index === this.pos.row.items.length;
    // "[0, 2)" style: another bracket closes the group and replaces its closer.
    if (p?.kind === 'group' && atEnd && (p.open === '(' || p.open === '[') && (close === ')' || close === ']')) {
      p.close = close;
      this.exitNode('right');
      return;
    }
    this.insertNodes([M.sym(close)]);
  }

  private startText(): void {
    const t = M.text('\\text', M.row());
    this.insertNodes([t]);
    this.pos = { row: t.body, index: 0 };
  }

  private startCommand(): void {
    const c = M.cmdInput(M.row());
    this.insertNodes([c]);
    this.pos = { row: c.body, index: 0 };
  }

  /** Replace the command being typed with what it names (or the given template). */
  commitCommand(template?: string): void {
    const name = this.pendingCommand();
    if (name === null) return;
    this.cancelCommand();
    this.template(template ?? this.templateFor(name));
  }

  /** Remove the command being typed. */
  cancelCommand(): void {
    const node = this.pos.row.parent;
    if (node?.kind !== 'cmdinput') return;
    const prow = node.parent!;
    const i = prow.items.indexOf(node);
    prow.items.splice(i, 1);
    this.fix();
    this.pos = { row: prow, index: i };
    this.anchor = null;
  }

  private templateFor(name: string): string {
    const found = this.options.lookupCommand?.(name);
    if (found !== undefined) return found;
    const spec = cmdSpec('\\' + name);
    if (spec) return '\\' + name + (spec.lit ? '{red}' : '') + '{#0}' + '{#?}'.repeat(spec.args - 1);
    return name ? '\\' + name : '';
  }

  /** Insert an empty spot or a selection slot (when making a shortcut's template). */
  insertSpecial(kind: 'ph' | 'slot' | 'prev'): void {
    this.touch();
    this.deleteSelection();
    const node: M.MathNode = kind === 'ph' ? M.placeholder() : { ...M.slot(), ...(kind === 'prev' ? { prev: true } : {}) };
    const { row, index } = this.pos;
    row.items.splice(index, 0, node);
    this.fix();
    this.pos = { row, index: index + 1 };
  }

  /** Insert a template: `#?` empty spot, `#0` the selection, `#@` the selection or the term before. */
  insert(latex: string): void {
    this.touch();
    this.template(latex);
  }

  private template(latex: string): void {
    if (!latex) return;
    const nodes = parseNodes(latex);
    // A lone `#?` is just an empty row (which shows as a placeholder anyway).
    for (const r of M.allRows([M.row(nodes)])) {
      if (r.items.length === 1 && r.items[0].kind === 'ph' && r.parent) r.items = [];
    }
    const slots = findSlots(nodes);
    let content: M.MathNode[] = this.takeSelection();
    if (content.length === 0 && slots.some((s) => s.prev)) content = this.takeTerm();
    for (const slot of slots) {
      const r = slot.parent;
      const i = r ? r.items.indexOf(slot) : nodes.indexOf(slot);
      const items = r ? r.items : nodes;
      let fill = content;
      content = [];
      // A selection that gets a script needs brackets: (x+1)².
      if (fill.length > 1 && items[i + 1]?.kind === 'scripts') fill = [M.group('(', ')', M.row(fill))];
      if (fill.length === 0 && items.length > 1) fill = [M.placeholder()];
      items.splice(i, 1, ...fill);
    }
    // A template starting with a script attaches to the node before the cursor.
    if (nodes[0]?.kind === 'scripts') {
      const first = nodes[0];
      const prev = this.pos.row.items[this.pos.index - 1];
      const free = prev?.kind === 'scripts' && !(first.sub && prev.sub) && !(first.sup && prev.sup);
      if (free && nodes.length === 1) {
        if (first.sub) prev.sub = first.sub;
        if (first.sup) prev.sup = first.sup;
        nodes.splice(0, 1);
        this.fix();
        const spot = firstSpot([prev]);
        if (spot) this.select(spot);
        return;
      }
      if (!prev || prev.kind === 'scripts' || (prev.kind === 'sym' && ['bin', 'rel', 'open', 'punct'].includes(prev.cls))) {
        nodes.unshift(M.placeholder());
      }
    }
    this.insertNodes(nodes);
    const spot = firstSpot(nodes);
    if (spot) this.select(spot);
  }

  private select(spot: Spot): void {
    if (spot.kind === 'ph') {
      this.pos = { row: spot.row, index: spot.index + 1 };
      this.anchor = spot.index;
    } else {
      this.pos = { row: spot.row, index: 0 };
      this.anchor = null;
    }
  }

  /** Space: a list comma, or on to the next spot / out of a script or fraction. */
  private space(): void {
    const { row, index } = this.pos;
    const prev = row.items[index - 1];
    if (prev?.kind === 'sym' && prev.latex === ',' && prev.decimal) {
      prev.decimal = false;
      return;
    }
    const node = row.parent;
    if (!node || node.kind === 'group' || node.kind === 'env') return;
    const ph = row.items.findIndex((n, i) => i >= index && n.kind === 'ph');
    if (ph >= 0) {
      this.select({ kind: 'ph', row, index: ph });
      return;
    }
    const rows = M.childRows(node);
    const next = rows[rows.indexOf(row) + 1];
    if (next) this.pos = { row: next, index: next.items.length };
    else this.exitNode('right');
  }

  private exitNode(side: 'left' | 'right'): void {
    const node = this.pos.row.parent;
    if (!node?.parent) return;
    const prow = node.parent;
    const i = prow.items.indexOf(node);
    this.pos = { row: prow, index: side === 'right' ? i + 1 : i };
    this.anchor = null;
  }

  // --- Deleting ------------------------------------------------------------------

  backspace(): void {
    if (this.revert) {
      const typed = this.revert;
      this.touch();
      this.restore(typed);
      return;
    }
    this.touch();
    if (this.deleteSelection()) return;
    const { row, index } = this.pos;
    if (index > 0) {
      const node = row.items[index - 1];
      if (node.kind === 'env') {
        this.anchor = index - 1; // select a whole matrix before deleting it
        return;
      }
      const rows = M.childRows(node);
      if (rows.length) {
        const r = rows[rows.length - 1];
        this.pos = { row: r, index: r.items.length };
        return;
      }
      row.items.splice(index - 1, 1);
      this.fix();
      this.pos = { row, index: index - 1 };
      return;
    }
    const parent = row.parent;
    if (!parent) {
      const li = this.lines.indexOf(row);
      if (li > 0) {
        const prev = this.lines[li - 1];
        const at = prev.items.length;
        prev.items.push(...row.items);
        this.lines.splice(li, 1);
        this.fix();
        this.pos = { row: prev, index: at };
      }
      return;
    }
    if (parent.kind === 'env') {
      if (parent.cells.flat().every(M.isEmptyRow)) this.removeNode(parent);
      else this.leaveRow('left');
      return;
    }
    this.unwrap(parent, row, 'start');
  }

  deleteForward(): void {
    this.touch();
    if (this.deleteSelection()) return;
    const { row, index } = this.pos;
    if (index < row.items.length) {
      const node = row.items[index];
      if (node.kind === 'env') {
        this.anchor = index + 1;
        return;
      }
      const rows = M.childRows(node);
      if (rows.length) {
        this.pos = { row: rows[0], index: 0 };
        return;
      }
      row.items.splice(index, 1);
      this.fix();
      return;
    }
    const parent = row.parent;
    if (!parent) {
      const li = this.lines.indexOf(row);
      const next = this.lines[li + 1];
      if (next) {
        row.items.push(...next.items);
        this.lines.splice(li + 1, 1);
        this.fix();
      }
      return;
    }
    if (parent.kind === 'env') {
      if (parent.cells.flat().every(M.isEmptyRow)) this.removeNode(parent);
      else this.leaveRow('right');
      return;
    }
    this.unwrap(parent, row, 'end');
  }

  private removeNode(node: M.MathNode): void {
    const prow = node.parent!;
    const i = prow.items.indexOf(node);
    prow.items.splice(i, 1);
    this.fix();
    this.pos = { row: prow, index: i };
    this.anchor = null;
  }

  /** Replace a structure with the contents of its rows (Backspace at the start of one). */
  private unwrap(node: M.MathNode, from: M.Row, at: 'start' | 'end'): void {
    const prow = node.parent!;
    const i = prow.items.indexOf(node);
    const contents: M.MathNode[] = [];
    let cursor = i;
    for (const r of M.childRows(node)) {
      const items = node.kind === 'text' ? r.items.flatMap((c) => mathSym(c.kind === 'sym' ? c.latex : '')) : r.items;
      if (r === from) cursor = i + contents.length + (at === 'end' ? items.length : 0);
      contents.push(...items);
    }
    prow.items.splice(i, 1, ...contents);
    this.fix();
    this.pos = { row: prow, index: cursor };
    this.anchor = null;
  }

  // --- Moving --------------------------------------------------------------------

  /** Left/right (with Shift: extend the selection). Returns a direction when leaving the formula. */
  move(dir: 'left' | 'right', extend = false): Exit | null {
    this.touch();
    if (extend) {
      this.extend(dir === 'left' ? -1 : 1);
      return null;
    }
    if (this.hasSelection) {
      const [from, to] = this.range();
      this.pos = { row: this.pos.row, index: dir === 'left' ? from : to };
      this.anchor = null;
      return null;
    }
    this.anchor = null;
    const { row, index } = this.pos;
    if (dir === 'left' && index > 0) {
      const node = row.items[index - 1];
      const rows = M.childRows(node);
      const r = rows[rows.length - 1];
      this.pos = r ? { row: r, index: r.items.length } : { row, index: index - 1 };
      return null;
    }
    if (dir === 'right' && index < row.items.length) {
      const r = M.childRows(row.items[index])[0];
      this.pos = r ? { row: r, index: 0 } : { row, index: index + 1 };
      return null;
    }
    return this.leaveRow(dir);
  }

  /** From the start/end of a row: to the neighbouring row, out of the structure, or out of the formula. */
  private leaveRow(dir: 'left' | 'right'): Exit | null {
    const { row } = this.pos;
    const node = row.parent;
    const step = dir === 'left' ? -1 : 1;
    if (!node) {
      const next = this.lines[this.lines.indexOf(row) + step];
      if (!next) return dir;
      this.pos = { row: next, index: dir === 'left' ? next.items.length : 0 };
      return null;
    }
    const rows = M.childRows(node);
    const sibling = rows[rows.indexOf(row) + step];
    if (sibling) {
      this.pos = { row: sibling, index: dir === 'left' ? sibling.items.length : 0 };
      return null;
    }
    this.exitNode(dir);
    return null;
  }

  private extend(step: -1 | 1): void {
    if (this.anchor === null) this.anchor = this.pos.index;
    const { row, index } = this.pos;
    const next = index + step;
    if (next >= 0 && next <= row.items.length) {
      this.pos = { row, index: next };
      return;
    }
    // Past the edge of a row: select the whole structure around it.
    const node = row.parent;
    if (!node?.parent) return;
    const prow = node.parent;
    const i = prow.items.indexOf(node);
    this.pos = { row: prow, index: step < 0 ? i : i + 1 };
    this.anchor = step < 0 ? i + 1 : i;
  }

  /**
   * Up/down: numerator ⇄ denominator, superscript ⇄ subscript, matrix rows,
   * lines. `xOf` measures where a position is drawn, to land straight below.
   */
  moveVertical(dir: 'up' | 'down', xOf?: (pos: Pos) => number | null): Exit | null {
    this.touch();
    this.anchor = null;
    let row = this.pos.row;
    for (; row.parent; row = row.parent.parent!) {
      const target = verticalNeighbor(row.parent, row, dir);
      if (target) {
        this.pos = { row: target, index: this.closestIndex(target, xOf) };
        return null;
      }
    }
    const next = this.lines[this.lines.indexOf(row) + (dir === 'up' ? -1 : 1)];
    if (!next) return dir;
    this.pos = { row: next, index: this.closestIndex(next, xOf) };
    return null;
  }

  private closestIndex(target: M.Row, xOf?: (pos: Pos) => number | null): number {
    const x = xOf?.(this.pos);
    if (x == null) {
      const len = this.pos.row.items.length;
      return len ? Math.round((this.pos.index / len) * target.items.length) : target.items.length;
    }
    let best = target.items.length;
    let bestDist = Infinity;
    for (let i = 0; i <= target.items.length; i++) {
      const xi = xOf!({ row: target, index: i });
      if (xi == null) continue;
      const d = Math.abs(xi - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** Home/End: to the start/end of the row, or of the whole line if already there. */
  edge(dir: 'start' | 'end', extend = false): void {
    this.touch();
    if (extend && this.anchor === null) this.anchor = this.pos.index;
    if (!extend) this.anchor = null;
    let { row } = this.pos;
    const atEdge = this.pos.index === (dir === 'start' ? 0 : row.items.length);
    if (atEdge && !extend) while (row.parent) row = row.parent.parent!;
    this.pos = { row, index: dir === 'start' ? 0 : row.items.length };
  }

  selectAll(): void {
    this.touch();
    let row = this.pos.row;
    while (row.parent) row = row.parent.parent!;
    this.pos = { row, index: row.items.length };
    this.anchor = 0;
  }

  /** Tab: the next empty spot; else the next cell; else out of the structure (or formula). */
  tab(back = false): Exit | null {
    this.touch();
    const spot = this.findSpot(back);
    if (spot) {
      this.select(spot);
      return null;
    }
    const cell = this.envCell();
    if (cell) {
      const cells = cell.env.cells.flat();
      const next = cells[cells.indexOf(cell.env.cells[cell.r][cell.c]) + (back ? -1 : 1)];
      if (next) this.pos = { row: next, index: back ? 0 : next.items.length };
      else this.leaveEnv(cell.env, back ? 'left' : 'right');
      this.anchor = null;
      return null;
    }
    if (this.pos.row.parent) {
      this.exitNode(back ? 'left' : 'right');
      return null;
    }
    return back ? 'left' : 'right';
  }

  private leaveEnv(envNode: M.Env, side: 'left' | 'right'): void {
    const prow = envNode.parent!;
    const i = prow.items.indexOf(envNode);
    this.pos = { row: prow, index: side === 'right' ? i + 1 : i };
  }

  /** The next/previous empty spot (placeholder or empty row) after/before the cursor. */
  private findSpot(back: boolean): Spot | null {
    type Stop = { pos: Pos } | { spot: Spot };
    const stops: Stop[] = [];
    const walk = (r: M.Row) => {
      if (r.items.length === 0) stops.push({ spot: { kind: 'empty', row: r } }, { pos: { row: r, index: 0 } });
      r.items.forEach((node, i) => {
        stops.push({ pos: { row: r, index: i } });
        if (node.kind === 'ph') stops.push({ spot: { kind: 'ph', row: r, index: i } });
        M.childRows(node).forEach(walk);
      });
      if (r.items.length) stops.push({ pos: { row: r, index: r.items.length } });
    };
    this.lines.forEach(walk);
    const [from, to] = this.hasSelection ? this.range() : [this.pos.index, this.pos.index];
    const at = (i: number) => stops.findIndex((s) => 'pos' in s && s.pos.row === this.pos.row && s.pos.index === i);
    if (back) {
      const start = at(from);
      for (let i = start - 1; i >= 0; i--) {
        const s = stops[i];
        if ('spot' in s && !(s.spot.kind === 'empty' && s.spot.row === this.pos.row)) return s.spot;
      }
    } else {
      const start = at(to);
      for (let i = start + 1; i < stops.length; i++) {
        const s = stops[i];
        if ('spot' in s && !(s.spot.kind === 'empty' && s.spot.row === this.pos.row)) return s.spot;
      }
    }
    return null;
  }

  /** Enter: finish a command; a new row in a matrix/system; a new line (display) or leave (inline). */
  enter(): Exit | null {
    this.touch();
    if (this.context() === 'cmd') {
      this.commitCommand();
      return null;
    }
    if (this.envCell()) {
      this.addRow(true);
      return null;
    }
    if (!this.options.display) return 'right';
    let { row, index } = this.pos;
    while (row.parent) {
      const node = row.parent;
      row = node.parent!;
      index = row.items.indexOf(node) + 1;
    }
    const tail = row.items.splice(index);
    const line = M.row(tail);
    this.lines.splice(this.lines.indexOf(row) + 1, 0, line);
    this.fix();
    this.pos = { row: line, index: 0 };
    this.anchor = null;
    return null;
  }

  // --- Matrices and tables ------------------------------------------------------

  addRow(below = true): boolean {
    this.touch();
    const cell = this.envCell();
    if (!cell) return false;
    const { env, r } = cell;
    const at = r + (below ? 1 : 0);
    const width = env.cells[0].length;
    env.cells.splice(at, 0, Array.from({ length: width }, () => M.row()));
    env.hlines = env.hlines.map((h) => (h > at || (h === at && below) ? h + 1 : h));
    this.fix();
    this.pos = { row: env.cells[at][0], index: 0 };
    this.anchor = null;
    return true;
  }

  addColumn(right = true): boolean {
    this.touch();
    const cell = this.envCell();
    if (!cell || cell.env.name === 'aligned') return false;
    const { env, r, c } = cell;
    const at = c + (right ? 1 : 0);
    for (const cells of env.cells) cells.splice(at, 0, M.row());
    if (env.colSpec !== null) env.colSpec = insertColumnSpec(env.colSpec, at);
    this.fix();
    this.pos = { row: env.cells[r][at], index: 0 };
    this.anchor = null;
    return true;
  }

  deleteRow(): boolean {
    this.touch();
    const cell = this.envCell();
    if (!cell) return false;
    const { env, r, c } = cell;
    if (env.cells.length === 1) {
      this.removeNode(env);
      return true;
    }
    env.cells.splice(r, 1);
    env.hlines = [...new Set(env.hlines.map((h) => (h > r ? h - 1 : h)))];
    this.fix();
    const row = env.cells[Math.min(r, env.cells.length - 1)][c];
    this.pos = { row, index: row.items.length };
    this.anchor = null;
    return true;
  }

  deleteColumn(): boolean {
    this.touch();
    const cell = this.envCell();
    if (!cell || cell.env.name === 'aligned') return false;
    const { env, r, c } = cell;
    if (env.cells[0].length === 1) {
      this.removeNode(env);
      return true;
    }
    for (const cells of env.cells) cells.splice(c, 1);
    if (env.colSpec !== null) env.colSpec = removeColumnSpec(env.colSpec, c);
    this.fix();
    const row = env.cells[r][Math.min(c, env.cells[r].length - 1)];
    this.pos = { row, index: row.items.length };
    this.anchor = null;
    return true;
  }

  // --- Clipboard and placing the cursor -------------------------------------------

  /** Insert pasted LaTeX (surrounding $ removed). */
  paste(text: string): void {
    this.touch();
    const latex = text.trim().replace(/^\$\$?([\s\S]*?)\$?\$$/, '$1');
    const lines = parseLatex(latex);
    if (lines.length === 1 || !this.options.display) {
      this.insertNodes(lines.flatMap((l) => l.items));
      return;
    }
    this.insertNodes(lines[0].items);
    for (const line of lines.slice(1)) {
      this.enter();
      this.insertNodes(line.items);
    }
  }

  /** Put the cursor next to the node with this id (after a click). */
  placeAtNode(id: number, side: 'before' | 'after'): boolean {
    for (const r of M.allRows(this.lines)) {
      const i = r.items.findIndex((n) => n.id === id);
      if (i >= 0) {
        this.touch();
        this.anchor = null;
        this.pos = { row: r, index: side === 'after' ? i + 1 : i };
        return true;
      }
    }
    return false;
  }

  /** Put the cursor in the row with this id. */
  placeInRow(id: number, where: 'start' | 'end'): boolean {
    const r = M.allRows(this.lines).find((row) => row.id === id);
    if (!r) return false;
    this.touch();
    this.anchor = null;
    this.pos = { row: r, index: where === 'start' ? 0 : r.items.length };
    return true;
  }

  /** Tidy up before leaving: drop unfinished commands, placeholders and empty lines. */
  finish(): string {
    for (const r of M.allRows(this.lines)) {
      r.items = r.items.filter((n) => n.kind !== 'cmdinput' && (this.options.template || n.kind !== 'ph'));
    }
    if (this.lines.length > 1) this.lines = this.lines.filter((l) => l.items.length > 0);
    if (this.lines.length === 0) this.lines = [M.row()];
    this.fix();
    const last = this.lines[this.lines.length - 1];
    this.pos = { row: last, index: last.items.length };
    this.anchor = null;
    return this.latex;
  }
}

function findSlots(nodes: M.MathNode[]): M.Slot[] {
  const out: M.Slot[] = [];
  const walk = (list: M.MathNode[]) => {
    for (const n of list) {
      if (n.kind === 'slot') out.push(n);
      for (const r of M.childRows(n)) walk(r.items);
    }
  };
  walk(nodes);
  return out;
}

function firstSpot(nodes: M.MathNode[]): Spot | null {
  for (const node of nodes) {
    if (node.kind === 'ph' && node.parent) return { kind: 'ph', row: node.parent, index: node.parent.items.indexOf(node) };
    for (const r of M.childRows(node)) {
      if (r.items.length === 0) return { kind: 'empty', row: r };
      const inner = firstSpot(r.items);
      if (inner) return inner;
    }
  }
  return null;
}

/** Column spec with a new centred column at position `at` (`c|cc` → `c|ccc`). */
function insertColumnSpec(spec: string, at: number): string {
  let col = 0;
  for (let i = 0; i <= spec.length; i++) {
    if (col === at && (i === spec.length || /[lcr]/.test(spec[i]))) return spec.slice(0, i) + 'c' + spec.slice(i);
    if (/[lcr]/.test(spec[i] ?? '')) col++;
  }
  return spec + 'c';
}

function removeColumnSpec(spec: string, at: number): string {
  let col = 0;
  for (let i = 0; i < spec.length; i++) {
    if (/[lcr]/.test(spec[i])) {
      if (col === at) return spec.slice(0, i) + spec.slice(i + 1);
      col++;
    }
  }
  return spec;
}
