/**
 * Builds the CodeMirror pieces: one shared EditorView, and one EditorState
 * per open document (Markdown or code). Switching tabs swaps the state, so
 * each document keeps its own undo history, cursor and scroll.
 */
import { Annotation, Compartment, EditorState, Facet, type Extension, type StateEffect } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap } from '@codemirror/search';
import { indentUnit } from '@codemirror/language';
import { assistCommands, codeAssistExtensions } from '../code/assist';
import { codeCommands, codeLanguage, codeModeExtensions } from '../code/codeMode';
import { indentationFor } from '../code/indentation';
import { loadLanguage, type DocKind } from '../code/languages';
import { commandKeymap, registerCommands } from '../commands/registry';
import { debuggerFor } from '../debug/debuggers';
import { features } from '../features';
import { mathSyntax } from '../features/math/syntax';
import { getSettings, onSettingsChange, type Settings } from '../settings';
import { editorHighlighting, editorTheme } from './theme';
import { undoCommands, undoHistory } from './undo';

/** What kind of document a state holds. */
export const docKind = Facet.define<DocKind, DocKind>({ combine: (values) => values[0] ?? 'markdown' });

/** Holds everything that depends on settings; reconfigured on change. */
const dynamic = new Compartment();

function dynamicExtensions(kind: DocKind, settings: Settings, lang = ''): Extension {
  if (kind === 'board') return [];
  if (kind === 'code') return [commandKeymap('code'), codeAssistExtensions(lang, settings.codeHelp)];
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
  return [dynamic.reconfigure(dynamicExtensions(state.facet(docKind), getSettings(), state.facet(codeLanguage)))];
}

let updateHandler: (u: ViewUpdate) => void = () => {};

function sharedExtensions(): Extension {
  return [
    undoHistory(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    editorHighlighting,
    editorTheme,
    search({ top: true }),
    keymap.of([...defaultKeymap, ...searchKeymap]),
    EditorView.updateListener.of((u) => updateHandler(u)),
  ];
}

/** `extra`: more extensions (a card on a board adds its own listener and keys). */
export function createMarkdownState(text: string, extra: Extension = []): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      extra,
      docKind.of('markdown'),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'nb' }),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [mathSyntax] }),
      // Used by code blocks (auto-indent after "for …:" etc.); lists and prose indent on their own.
      indentUnit.of('    '),
      placeholder('Begynn å skrive …'),
      dynamic.of(dynamicExtensions('markdown', getSettings())),
      sharedExtensions(),
    ],
  });
}

/** Marks the board's own writes to its document (nothing else may change a board's text). */
export const boardWrite = Annotation.define<boolean>();

/**
 * A board's document: its JSON Canvas text, shown and edited by the board
 * view (src/board/), not by the editor. Only the board writes to it.
 */
export function createBoardState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      docKind.of('board'),
      dynamic.of([]),
      EditorState.changeFilter.of((tr) => tr.annotation(boardWrite) === true),
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
      indentationFor(text, lang),
      codeModeExtensions(debuggerFor(lang) !== null),
      dynamic.of(dynamicExtensions('code', getSettings(), lang)),
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
  registerCommands(undoCommands);
  registerCommands(codeCommands);
  registerCommands(assistCommands((state) => state.facet(codeLanguage)));
  updateHandler = onUpdate;
  return new EditorView({ parent, state: createMarkdownState('') });
}
