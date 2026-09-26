/**
 * Fenced code blocks: styling (monospace, own background, dimmed fences)
 * and a toggle command. Syntax highlighting of the code itself comes from
 * lang-markdown's `codeLanguages` + @codemirror/language-data.
 */
import { RangeSet, type Range, type StateCommand } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { applyChanges, findEnclosing } from './util/markdown';
import type { Feature } from './types';

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

const lineDeco = (cls: string) => Decoration.line({ class: cls });
const deco = {
  body: lineDeco('cm-codeblock'),
  begin: lineDeco('cm-codeblock cm-codeblock-begin cm-codeblock-fence'),
  end: lineDeco('cm-codeblock cm-codeblock-end cm-codeblock-fence'),
  single: lineDeco('cm-codeblock cm-codeblock-begin cm-codeblock-end cm-codeblock-fence'),
};

function build(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const decos: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return;
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        const closed = last > first && FENCE_RE.test(doc.line(last).text);
        const startLine = Math.max(first, doc.lineAt(from).number);
        const endLine = Math.min(last, doc.lineAt(to).number);
        for (let n = startLine; n <= endLine; n++) {
          if (seen.has(n)) continue;
          seen.add(n);
          let d = deco.body;
          if (n === first) d = first === last ? deco.single : deco.begin;
          else if (n === last && closed) d = deco.end;
          decos.push(d.range(doc.line(n).from));
        }
        return false;
      },
    });
  }
  return RangeSet.of(decos, true);
}

const codeBlockStyle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Wrap the selected lines in a fence, or remove the fence around the cursor. */
export const toggleCodeBlock: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  const { doc } = state;
  const block = findEnclosing(state, range.from, range.to, 'FencedCode');

  if (block) {
    const first = doc.lineAt(block.from);
    const last = doc.lineAt(block.to);
    const closed = last.number > first.number && FENCE_RE.test(last.text);
    const changes = [];
    if (!closed) {
      changes.push({ from: first.from, to: Math.min(first.to + 1, doc.length) });
    } else if (last.number === first.number + 1) {
      changes.push({ from: first.from, to: last.to });
    } else {
      changes.push({ from: first.from, to: first.to + 1 }, { from: last.from - 1, to: last.to });
    }
    applyChanges(state, dispatch, changes);
    return true;
  }

  const fromLine = doc.lineAt(range.from);
  const toLine = doc.lineAt(range.to);
  if (range.empty && fromLine.text.trim() === '') {
    // Empty line: insert an empty block and put the cursor inside it.
    dispatch(
      state.update({
        changes: { from: fromLine.from, to: fromLine.to, insert: '```\n\n```' },
        selection: { anchor: fromLine.from + 4 },
        scrollIntoView: true,
        userEvent: 'input.format',
      }),
    );
    return true;
  }
  // Keep the selection on the code, not the fences.
  applyChanges(
    state,
    dispatch,
    [
      { from: fromLine.from, insert: '```\n' },
      { from: toLine.to, insert: '\n```' },
    ],
    'input.format',
    { from: 1, to: -1 },
  );
  return true;
};

const codeIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 10-2 2 2 2M14 10l2 2-2 2"/></svg>';

export const codeBlocks: Feature = {
  id: 'codeBlocks',
  extension: () => codeBlockStyle,
  commands: [
    {
      id: 'codeblock.toggle',
      name: 'Kodeblokk',
      icon: codeIcon,
      key: 'Mod-Shift-e',
      run: (view) => toggleCodeBlock(view),
      isActive: (state) => findEnclosing(state, state.selection.main.from, state.selection.main.to, 'FencedCode') !== null,
    },
  ],
};
