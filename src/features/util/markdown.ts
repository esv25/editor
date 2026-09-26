/**
 * Small shared helpers for working with Markdown lines and the syntax tree.
 */
import { EditorSelection, type ChangeSpec, type EditorState, type Line, type Transaction } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export type ListKind = 'bullet' | 'ordered' | 'task';

export interface ListLine {
  kind: ListKind;
  indent: string;
  /** The marker itself: "-", "*", "1.", "2)". */
  marker: string;
  /** Number for ordered lists. */
  number?: number;
  checked?: boolean;
  /** Column where a nested child item should start (after marker + space, before any task box). */
  childIndent: number;
  /** Offset where the item's text begins (after the task box, if any). */
  contentOffset: number;
}

const LIST_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)(\[([ xX])\](?:[ \t]+|$))?/;
const HEADING_RE = /^(#{1,6})(?:[ \t]+|$)/;

export function parseListLine(text: string): ListLine | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const [full, indent, bullet, num, delim, space, task, check] = m;
  const marker = bullet ?? num + delim;
  const childIndent = indent.length + marker.length + Math.max(space.length, 1);
  // A bare "- [ ]" only counts as a task when it's a bullet item.
  const isTask = task !== undefined && bullet !== undefined;
  return {
    kind: isTask ? 'task' : bullet ? 'bullet' : 'ordered',
    indent,
    marker,
    number: num ? parseInt(num, 10) : undefined,
    checked: isTask ? check !== ' ' : undefined,
    childIndent,
    contentOffset: isTask ? full.length : indent.length + marker.length + space.length,
  };
}

export function headingLevel(text: string): number {
  const m = HEADING_RE.exec(text);
  return m ? m[1].length : 0;
}

/** Length of the "## " prefix, or 0. */
export function headingPrefixLength(text: string): number {
  const m = HEADING_RE.exec(text);
  return m ? m[0].length : 0;
}

export function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)![0];
}

/**
 * The lines touched by the selection, in document order, without duplicates.
 * Blank lines are skipped when more than one line is selected.
 */
export function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    // A selection ending at the very start of a line doesn't include that line.
    if (last > first && state.doc.line(last).from === range.to) last--;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  lines.sort((a, b) => a.from - b.from);
  const nonBlank = lines.filter((l) => l.text.trim() !== '');
  return lines.length > 1 && nonBlank.length > 0 ? nonBlank : lines;
}

/**
 * Apply changes and keep the selection sensible:
 * - a cursor ends up after markup inserted at its position (toggling "- "
 *   on an empty line leaves the cursor after the marker)
 * - a selection grows to include markup inserted at its start, unless
 *   `assoc` says otherwise
 */
export function applyChanges(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  changes: ChangeSpec[],
  userEvent = 'input.format',
  assoc: { from: -1 | 1; to: -1 | 1 } = { from: -1, to: 1 },
): void {
  const changeSet = state.changes(changes);
  if (changeSet.empty) return;
  const selection = EditorSelection.create(
    state.selection.ranges.map((r) => {
      if (r.empty) return EditorSelection.cursor(changeSet.mapPos(r.head, 1));
      const from = changeSet.mapPos(r.from, assoc.from);
      const to = changeSet.mapPos(r.to, assoc.to);
      return r.head < r.anchor ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
    }),
    state.selection.mainIndex,
  );
  dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent }));
}

/** Syntax tree, parsed at least up to `upto` (falls back to whatever is available). */
export function treeUpTo(state: EditorState, upto: number) {
  return ensureSyntaxTree(state, upto, 100) ?? syntaxTree(state);
}

/** Innermost node named `name` that covers from..to, if any. */
export function findEnclosing(state: EditorState, from: number, to: number, names: string | string[]): SyntaxNode | null {
  const wanted = Array.isArray(names) ? names : [names];
  const tree = treeUpTo(state, to);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(from, side); node; node = node.parent) {
      if (wanted.includes(node.name) && node.from <= from && node.to >= to) return node;
    }
  }
  return null;
}

/** Name of the top-level block (child of Document) at `pos`, e.g. "Paragraph", "BulletList". */
export function blockTypeAt(state: EditorState, pos: number): string {
  let node: SyntaxNode | null = treeUpTo(state, pos).resolveInner(pos, 1);
  let block = '';
  for (; node && node.name !== 'Document'; node = node.parent) block = node.name;
  return block;
}
