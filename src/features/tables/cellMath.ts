/**
 * Formulas in table cells. A cell's field shows its text as typed, but each
 * `$…$` as a typeset formula (edited with the formula field, as elsewhere).
 * This is the pure part: a cell's Markdown ⇄ text pieces and formulas.
 *
 * In a table a pipe must be escaped, also inside a formula (`$\|x\|$` is
 * |x|, as in GitHub, Obsidian and pandoc), so LaTeX's own `\|` (‖) is
 * written `\Vert` there.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { MarkdownParser } from '@lezer/markdown';
import { mathSyntax } from '../math/syntax';
import { pipesUnescaped } from './model';

export type CellPart = { t: 'text'; text: string } | { t: 'math'; latex: string; dollars: number };

const parser = (markdownLanguage.parser as MarkdownParser).configure([mathSyntax]);

/** Escaped pipes in a formula in a table are just pipes. */
export const mathPipesUnescaped = (latex: string) => latex.replace(/\\\|/g, '|');

/** A cell's Markdown (pipes escaped, as in the file) → its text (pipes unescaped) and formulas. */
export function cellParts(raw: string): CellPart[] {
  // Parsed as a table cell, the way the document parses it (`$$x$$` alone is inline there).
  const source = `| ${raw} |\n| - |`;
  const at = 2;
  const parts: CellPart[] = [];
  let pos = 0;
  const text = (to: number) => {
    if (to > pos) parts.push({ t: 'text', text: pipesUnescaped(raw.slice(pos, to)) });
  };
  parser.parse(source).iterate({
    enter(node) {
      if (node.name === 'InlineCode') return false;
      if (node.name !== 'InlineMath') return;
      const marks = node.node.getChildren('MathMark');
      if (marks.length < 2 || node.from < at || node.to > at + raw.length) return false;
      text(node.from - at);
      const open = marks[0];
      const close = marks[marks.length - 1];
      parts.push({ t: 'math', latex: mathPipesUnescaped(source.slice(open.to, close.from)), dollars: open.to - open.from });
      pos = node.to - at;
      return false;
    },
  });
  text(raw.length);
  return parts;
}

/**
 * A formula as cell text (pipes not escaped yet; that's done for the whole
 * cell). Empty: nothing.
 */
export function mathSource(latex: string, dollars = 1): string {
  if (!latex.trim()) return '';
  const safe = latex
    // `\|` would read back as an escaped pipe.
    .replace(/(?<!\\)((?:\\\\)*)\\\|/g, '$1\\Vert ')
    // A closing $ can't follow a space.
    .replace(/\\ $/, '\\,');
  const d = '$'.repeat(dollars);
  return d + safe + d;
}
