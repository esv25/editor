/**
 * Code block tools: a header with name + language menu + Run button, and
 * running the code with output shown below the block.
 *
 * Name and language live in the fence line (```python title="navn.py"),
 * so the document stays plain Markdown. Output is kept in editor state only.
 */
import type { EditorView } from '@codemirror/view';
import { blockAt } from '../util/fence';
import { findEnclosing } from '../util/markdown';
import type { Feature } from '../types';
import { headerPlugin } from './header';
import { finishRun, outputField, setOutputActions, startRun } from './output';
import { runCode, runnability } from './run';

let nextId = 1;

/** Run the block whose opening fence line starts at `pos`. */
export function runBlockAt(view: EditorView, pos: number): boolean {
  const block = blockAt(view.state.doc, pos);
  if (!block || !runnability(block.info.lang).ok) return false;
  const id = nextId++;
  view.dispatch({ effects: startRun.of({ id, pos: block.open.from }) });
  void runCode(block.info.lang, block.code).then((outcome) => {
    view.dispatch({ effects: finishRun.of({ id, outcome }) });
  });
  return true;
}

/** Run the code block the cursor is in. */
function runBlockAtCursor(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const node = findEnclosing(view.state, from, to, 'FencedCode');
  return node ? runBlockAt(view, view.state.doc.lineAt(node.from).from) : false;
}

setOutputActions({ rerun: runBlockAt });

export const codeBlockTools: Feature = {
  id: 'codeBlockTools',
  extension: (settings) => [outputField, headerPlugin(settings.hideMarkup, { run: runBlockAt })],
  commands: [
    {
      id: 'codeblock.run',
      name: 'Kjør kodeblokk',
      key: 'Mod-Shift-Enter',
      run: runBlockAtCursor,
    },
  ],
};

export { runContext } from './run';
