/**
 * Builds the CodeMirror pieces: one shared EditorView, and one EditorState
 * per open document (Markdown or code). Switching tabs swaps the state, so
 * each document keeps its own undo history, cursor and scroll.
 */
import { Compartment, EditorState, Facet, type Extension, type StateEffect } from '@codemirror/state';
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
import { codeCommands, codeLanguage, codeModeExtensions } from '../code/codeMode';
import { loadLanguage, type DocKind } from '../code/languages';
import { commandKeymap, registerCommands } from '../commands/registry';
import { features } from '../features';
import { getSettings, onSettingsChange, type Settings } from '../settings';
import { editorHighlighting, editorTheme } from './theme';

/** What kind of document a state holds. */
export const docKind = Facet.define<DocKind, DocKind>({ combine: (values) => values[0] ?? 'markdown' });

/** Holds everything that depends on settings; reconfigured on change. */
const dynamic = new Compartment();

function dynamicExtensions(kind: DocKind, settings: Settings): Extension {
  if (kind === 'code') return commandKeymap('code');
  return [commandKeymap('markdown'), features.map((f) => f.extension?.(settings) ?? [])];
}

/** Bumped whenever settings change; documents compare it to know if they're stale. */
let settingsVersion = 0;
onSettingsChange(() => settingsVersion++);

export function currentSettingsVersion(): number {
  return settingsVersion;
}

/** Effects that bring a state up to date with the current settings. */
export function refreshForSettings(state: EditorState): StateEffect<unknown>[] {
  return [dynamic.reconfigure(dynamicExtensions(state.facet(docKind), getSettings()))];
}

let updateHandler: (u: ViewUpdate) => void = () => {};

function sharedExtensions(): Extension {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    editorHighlighting,
    editorTheme,
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of((u) => updateHandler(u)),
  ];
}

export function createMarkdownState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      docKind.of('markdown'),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'nb' }),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
      placeholder('Begynn å skrive …'),
      dynamic.of(dynamicExtensions('markdown', getSettings())),
      sharedExtensions(),
    ],
  });
}

/** A code-mode state. Async because the language's highlighting is loaded on demand. */
export async function createCodeState(text: string, lang: string): Promise<EditorState> {
  const support = await loadLanguage(lang);
  return EditorState.create({
    doc: text,
    extensions: [
      docKind.of('code'),
      codeLanguage.of(lang),
      support,
      codeModeExtensions(),
      dynamic.of(dynamicExtensions('code', getSettings())),
      sharedExtensions(),
    ],
  });
}

/**
 * Create the editor view. Commands must be registered before any state is
 * created (keymaps are built from the registry), so this registers the
 * feature commands; register app commands before calling it.
 */
export function createView(parent: HTMLElement, onUpdate: (u: ViewUpdate) => void): EditorView {
  for (const feature of features) registerCommands(feature.commands ?? []);
  registerCommands(codeCommands);
  updateHandler = onUpdate;
  return new EditorView({ parent, state: createMarkdownState('') });
}
