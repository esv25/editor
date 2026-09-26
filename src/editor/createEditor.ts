/**
 * Assembles the CodeMirror editor from the base setup plus all features.
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap } from '@codemirror/search';
import { commandKeymap, registerCommands } from '../commands/registry';
import { features } from '../features';
import { getSettings, onSettingsChange, type Settings } from '../settings';
import { editorHighlighting, editorTheme } from './theme';

/** Holds everything that depends on settings; reconfigured on change. */
const dynamic = new Compartment();

function dynamicExtensions(settings: Settings): Extension {
  return [commandKeymap(), features.map((f) => f.extension?.(settings) ?? [])];
}

export interface EditorHandle {
  view: EditorView;
  /** Replace the whole document (e.g. after opening a file); clears undo history. */
  setDocument(doc: string): void;
}

export function createEditor(parent: HTMLElement, doc: string, onUpdate: (u: ViewUpdate) => void): EditorHandle {
  for (const feature of features) registerCommands(feature.commands ?? []);

  const makeState = (text: string) =>
    EditorState.create({
      doc: text,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        highlightSpecialChars(),
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'nb' }),
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
        editorHighlighting,
        editorTheme,
        search({ top: true }),
        placeholder('Begynn å skrive …'),
        dynamic.of(dynamicExtensions(getSettings())),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of(onUpdate),
      ],
    });

  const view = new EditorView({ parent, state: makeState(doc) });

  onSettingsChange((settings) => {
    view.dispatch({ effects: dynamic.reconfigure(dynamicExtensions(settings)) });
  });

  return {
    view,
    setDocument(text) {
      view.setState(makeState(text));
    },
  };
}
