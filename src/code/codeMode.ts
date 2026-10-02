/**
 * Code mode: how plain code files (.py, .js, …) are edited. Line numbers,
 * no Markdown styling, and a Run command that runs the whole file with the
 * output in a panel at the bottom.
 */
import { Facet, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  showPanel,
  type Panel,
} from '@codemirror/view';
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { indentLess } from '@codemirror/commands';
import { insertIndent } from './indentation';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { EditorCommand } from '../commands/registry';
import { renderOutput } from '../features/codeBlockTools/output';
import { runCode, runnability, type RunOutcome } from '../features/codeBlockTools/run';

/** The language of the code file in this state (runner id, e.g. "python"). */
export const codeLanguage = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });

interface RunState {
  id: number;
  running: boolean;
  outcome?: RunOutcome;
}

const setRun = StateEffect.define<RunState | null>();

const runField = StateField.define<RunState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setRun)) {
        // Ignore results of an earlier run that finished after a newer one started.
        if (e.value && value && !e.value.running && e.value.id !== value.id) continue;
        value = e.value;
      }
    }
    return value;
  },
  provide: (field) =>
    showPanel.from(field, (run) => (run ? (view) => outputPanel(view, run) : null)),
});

function outputPanel(view: EditorView, run: RunState): Panel {
  const dom = renderOutput({
    running: run.running,
    outcome: run.outcome,
    onRerun: () => runFile(view),
    onClose: () => view.dispatch({ effects: setRun.of(null) }),
  });
  dom.classList.add('cm-run-panel');
  return { dom };
}

let nextId = 1;

/** Run the whole file. */
export function runFile(view: EditorView): boolean {
  const lang = view.state.facet(codeLanguage);
  if (!runnability(lang).ok) return false;
  const id = nextId++;
  view.dispatch({ effects: setRun.of({ id, running: true }) });
  void runCode(lang, view.state.doc.toString()).then((outcome) => {
    view.dispatch({ effects: setRun.of({ id, running: false, outcome }) });
  });
  return true;
}

export const codeCommands: EditorCommand[] = [
  { id: 'code.run', name: 'Kjør filen', key: 'Mod-Shift-Enter', scope: 'code', run: runFile },
];

/** Extensions for a code-mode editor state (language support is added separately). */
export function codeModeExtensions(): Extension {
  return [
    lineNumbers(),
    foldGutter(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    indentOnInput(),
    closeBrackets(),
    keymap.of([...closeBracketsKeymap, { key: 'Tab', run: insertIndent, shift: indentLess }]),
    runField,
    EditorView.editorAttributes.of({ class: 'cm-code-mode' }),
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
  ];
}
