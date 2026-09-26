/**
 * Inline formatting toggles: bold, italic, inline code.
 *
 * Uses the syntax tree to find existing formatting, so toggling works
 * whether the cursor is inside the text, the selection covers the text,
 * or the selection includes the markup itself.
 */
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state';
import { findEnclosing } from './util/markdown';
import type { Feature } from './types';

interface InlineStyle {
  /** Syntax node that represents the formatted span. */
  node: string;
  /** Markup inserted when adding the style. */
  mark: string;
}

const STYLES = {
  bold: { node: 'StrongEmphasis', mark: '**' },
  italic: { node: 'Emphasis', mark: '*' },
  code: { node: 'InlineCode', mark: '`' },
} satisfies Record<string, InlineStyle>;

export function toggleInline(style: InlineStyle): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      const existing = findEnclosing(state, range.from, range.to, style.node);

      if (existing) {
        // Remove the opening and closing markup of the enclosing span.
        const open = existing.firstChild;
        const close = existing.lastChild;
        const openLen = open && open.from === existing.from ? open.to - open.from : style.mark.length;
        const closeLen = close && close.to === existing.to && close !== open ? close.to - close.from : openLen;
        const changes = state.changes([
          { from: existing.from, to: existing.from + openLen },
          { from: existing.to - closeLen, to: existing.to },
        ]);
        return {
          changes,
          range: EditorSelection.range(changes.mapPos(range.anchor, 1), changes.mapPos(range.head, -1)),
        };
      }

      let { from, to } = range;
      if (range.empty) {
        const word = state.wordAt(from);
        if (!word) {
          // Nothing to wrap: insert an empty pair and put the cursor in the middle.
          return {
            changes: { from, insert: style.mark + style.mark },
            range: EditorSelection.cursor(from + style.mark.length),
          };
        }
        const offset = range.from - word.from;
        return {
          changes: [
            { from: word.from, insert: style.mark },
            { from: word.to, insert: style.mark },
          ],
          range: EditorSelection.cursor(word.from + style.mark.length + offset),
        };
      }

      // Don't pull surrounding whitespace into the markup ("** bold **" isn't bold).
      const text = state.sliceDoc(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
      if (from >= to) return { range };
      return {
        changes: [
          { from, insert: style.mark },
          { from: to, insert: style.mark },
        ],
        range: EditorSelection.range(from + style.mark.length, to + style.mark.length),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

const isActive = (style: InlineStyle) => (state: EditorState) => {
  const { from, to } = state.selection.main;
  return findEnclosing(state, from, to, style.node) !== null;
};

export const toggleBold = toggleInline(STYLES.bold);
export const toggleItalic = toggleInline(STYLES.italic);
export const toggleInlineCode = toggleInline(STYLES.code);

export const inlineFormat: Feature = {
  id: 'inlineFormat',
  commands: [
    {
      id: 'format.bold',
      name: 'Fet',
      icon: '<span class="tb-label-bold">B</span>',
      key: 'Mod-b',
      run: toggleBold,
      isActive: isActive(STYLES.bold),
    },
    {
      id: 'format.italic',
      name: 'Kursiv',
      icon: '<span class="tb-label-italic">I</span>',
      key: 'Mod-i',
      run: toggleItalic,
      isActive: isActive(STYLES.italic),
    },
    {
      id: 'format.code',
      name: 'Inline kode',
      icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/></svg>',
      key: 'Mod-e',
      run: toggleInlineCode,
      isActive: isActive(STYLES.code),
    },
  ],
};
