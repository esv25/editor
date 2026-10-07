/**
 * Live Markdown styling (à la Obsidian/Typora):
 * - headings get larger type (line classes cm-heading-N)
 * - inline code gets a background
 * - markup characters (#, **, *, `, ~~) are hidden on lines the cursor
 *   isn't on, and dimmed (via the highlight style) on the active line
 */
import { RangeSet, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { Feature } from './types';

const hidden = Decoration.replace({});
const inlineCode = Decoration.mark({ class: 'cm-inline-code', attributes: { spellcheck: 'false' } });
const headingLine = (level: number) => Decoration.line({ class: `cm-heading cm-heading-${level}` });
const headingLines = [1, 2, 3, 4, 5, 6].map(headingLine);

/** Line numbers touched by any selection range (empty when the editor is unfocused). */
export function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc } = view.state;
  for (const range of view.state.selection.ranges) {
    const last = doc.lineAt(range.to).number;
    for (let n = doc.lineAt(range.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

function build(view: EditorView, hideMarkup: boolean): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const active = activeLines(view);
  const decos: Range<Decoration>[] = [];
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        if (name === 'FencedCode' || name === 'CodeBlock') return false; // handled by codeBlocks
        if (name === 'InlineMath' || name === 'BlockMath') return false; // handled by math
        if (name === 'Table') return false; // handled by tables (hidden marks would misalign the columns)

        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          decos.push(headingLines[+heading[1] - 1].range(doc.lineAt(node.from).from));
          return;
        }

        if (name === 'InlineCode') {
          if (node.to > node.from) decos.push(inlineCode.range(node.from, node.to));
          return;
        }

        if (!hideMarkup || isActive(node.from)) return;

        if (name === 'HeaderMark') {
          const parent = node.node.parent?.name ?? '';
          if (!parent.startsWith('ATXHeading')) return; // keep setext underlines visible
          const line = doc.lineAt(node.from);
          if (node.from === line.from) {
            // Opening "## " – hide the marks and the following space.
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            decos.push(hidden.range(node.from, end));
          } else {
            // Closing "## " – hide it with the space before it.
            const start = doc.sliceString(node.from - 1, node.from) === ' ' ? node.from - 1 : node.from;
            decos.push(hidden.range(start, node.to));
          }
          return;
        }

        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          decos.push(hidden.range(node.from, node.to));
          return;
        }

        if (name === 'CodeMark' && node.node.parent?.name === 'InlineCode') {
          decos.push(hidden.range(node.from, node.to));
        }
      },
    });
  }
  return RangeSet.of(decos, true);
}

function livePreviewPlugin(hideMarkup: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, hideMarkup);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view, hideMarkup);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const livePreview: Feature = {
  id: 'livePreview',
  extension: (settings) => livePreviewPlugin(settings.hideMarkup),
};
