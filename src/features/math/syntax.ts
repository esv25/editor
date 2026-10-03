/**
 * Markdown syntax for math (as in Obsidian, Typora, pandoc and GitHub):
 *
 * - `$…$` inline: the opening `$` must be followed by a non-space and the
 *   closing `$` preceded by one, so "Det koster $5 og $10" stays text.
 *   `$$…$$` inside a paragraph is inline too (shown in display style).
 * - `$$` on its own line starts a block that runs to a line ending in `$$`
 *   (or `$$…$$` on one line). Like fenced code, an unclosed block runs to
 *   the end of its container; such a block is shown as plain text.
 *
 * The content between the marks is LaTeX. Nodes: InlineMath, BlockMath,
 * both with MathMark children for the dollar signs.
 */
import type { BlockContext, Element, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';
import { styleTags, tags as t } from '@lezer/highlight';

const DOLLAR = 36;
const BACKSLASH = 92;

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

/** Position of `$$` at the start of the line's content, or -1. */
function blockOpening(line: Line): number {
  if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return -1;
  if (line.indent - line.baseIndent >= 4) return -1; // indented code
  // "$$x$$ er svaret" is a paragraph with inline math, not a block.
  const rest = line.text.slice(line.pos + 2).trimEnd();
  if (rest.length >= 2 && rest.endsWith('$$')) return rest.slice(0, -2).includes('$$') ? -1 : line.pos;
  return rest.includes('$$') ? -1 : line.pos;
}

/**
 * Whether the current line still belongs to the block's container (a list
 * item, a quote). Uses the same internal fields as the built-in fenced code
 * parser; without them, a block just runs to its closing `$$`.
 */
function inContainer(cx: BlockContext, line: Line): boolean {
  const depth = (line as unknown as { depth?: number }).depth;
  const stack = (cx as unknown as { stack?: unknown[] }).stack;
  return depth === undefined || stack === undefined || depth >= stack.length;
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  const start = blockOpening(line);
  if (start < 0) return false;
  const from = cx.lineStart + start;
  const marks: Element[] = [cx.elt('MathMark', from, from + 2)];
  const rest = line.text.slice(start + 2).trimEnd();

  if (rest.length >= 2 && rest.endsWith('$$')) {
    // `$$ … $$` on one line.
    const end = from + 2 + rest.length;
    marks.push(cx.elt('MathMark', end - 2, end));
    cx.nextLine();
    cx.addElement(cx.elt('BlockMath', from, end, marks));
    return true;
  }

  while (cx.nextLine() && inContainer(cx, line)) {
    for (const m of line.markers) marks.push(m);
    const text = line.text.trimEnd();
    if (text.length - line.pos >= 2 && text.endsWith('$$')) {
      const end = cx.lineStart + text.length;
      marks.push(cx.elt('MathMark', end - 2, end));
      cx.nextLine();
      cx.addElement(cx.elt('BlockMath', from, end, marks));
      return true;
    }
  }
  cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), marks));
  return true;
}

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1;
  const display = cx.char(pos + 1) === DOLLAR;
  const start = pos + (display ? 2 : 1);
  if (start >= cx.end || isSpace(cx.char(start)) || cx.char(start) === DOLLAR) return -1;
  for (let i = start; i < cx.end; i++) {
    const c = cx.char(i);
    if (c === BACKSLASH) {
      i++;
      continue;
    }
    if (c !== DOLLAR) continue;
    if (display) {
      if (cx.char(i + 1) !== DOLLAR) continue;
      return cx.addElement(
        cx.elt('InlineMath', pos, i + 2, [cx.elt('MathMark', pos, pos + 2), cx.elt('MathMark', i, i + 2)]),
      );
    }
    if (isSpace(cx.char(i - 1))) continue;
    return cx.addElement(cx.elt('InlineMath', pos, i + 1, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', i, i + 1)]));
  }
  return -1;
}

export const mathSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'BlockMath', block: true }, { name: 'InlineMath' }, { name: 'MathMark' }],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse: parseBlockMath,
      endLeaf: (_cx, line) => blockOpening(line) >= 0,
    },
  ],
  parseInline: [{ name: 'InlineMath', after: 'InlineCode', parse: parseInlineMath }],
  props: [
    styleTags({
      'InlineMath BlockMath': t.special(t.content),
      MathMark: t.processingInstruction,
    }),
  ],
};

/** Whether a BlockMath node has its closing `$$` (unclosed blocks are shown as text). */
export function isClosedBlock(node: { getChildren(name: string): unknown[] }): boolean {
  return node.getChildren('MathMark').length >= 2;
}
