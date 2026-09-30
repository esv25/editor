/**
 * Wires the editor, document, storage and UI together.
 */
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { registerCommands } from '../commands/registry';
import { createEditor } from '../editor/createEditor';
import { runContext } from '../features/codeBlockTools';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
import { platform } from '../platform';
import { drafts } from '../storage';
import { renderButtons } from '../ui/toolbar';
import { OutlinePanel } from '../ui/outline';
import { renderCount, renderSaveStatus, renderTitle } from '../ui/statusbar';
import { initAppearance, resolvedTheme } from './appearance';
import { DocumentController } from './document';
import { welcomeText } from './welcome';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const FIRST_RUN_KEY = 'editor.seenWelcome';

export function startApp(): void {
  initAppearance();

  // Late-bound so commands can be registered before the editor exists
  // (the keymap is built from the registry when the editor is created).
  let doc!: DocumentController;
  let view!: EditorView;
  const getView = () => view;

  registerCommands([
    { id: 'file.new', name: 'Nytt dokument', label: 'Ny', run: () => (void doc.newDocument(), true) },
    { id: 'file.open', name: 'Åpne fil', label: 'Åpne', key: 'Mod-o', run: () => (void doc.open(), true) },
    { id: 'file.save', name: 'Lagre', label: 'Lagre', key: 'Mod-s', run: () => (void doc.save(), true) },
    { id: 'file.saveAs', name: 'Lagre som', label: 'Lagre som', key: 'Mod-Shift-s', run: () => (void doc.saveAs(), true) },
    {
      id: 'view.toggleOutline',
      name: 'Vis/skjul disposisjon',
      icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
      key: 'Mod-Shift-o',
      run: () => (updateSettings({ outlineVisible: !getSettings().outlineVisible }), true),
      isActive: () => getSettings().outlineVisible,
    },
    {
      id: 'view.toggleTheme',
      name: 'Bytt mellom lyst og mørkt tema',
      icon: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
      run: () => (updateSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }), true),
    },
  ]);

  const onUpdate = (u: ViewUpdate) => {
    doc?.handleUpdate(u);
    if (u.docChanged) {
      outline.scheduleRefresh();
      scheduleCount();
    }
    if (u.docChanged || u.selectionSet) {
      toolbar.update(u.state);
      outline.highlightActive(u.state);
    }
  };

  const editor = createEditor(document.getElementById('editor')!, '', onUpdate);
  view = editor.view;
  doc = new DocumentController(editor);
  // Code blocks run in the document's folder, so they can use files next to it.
  runContext.cwd = () => doc.file?.path?.replace(/[\\/][^\\/]*$/, '');
  // Handy for debugging in the browser console during development.
  if (import.meta.env.DEV) Object.assign(window, { editorView: view, editorDoc: doc });

  const toolbar = renderButtons(document.getElementById('toolbar')!, getSettings().toolbar, getView);
  const fileBar = renderButtons(document.getElementById('file-actions')!, ['file.new', 'file.open', 'file.save'], getView);
  const viewBar = renderButtons(document.getElementById('view-actions')!, ['view.toggleOutline', 'view.toggleTheme'], getView);
  const outline = new OutlinePanel(document.getElementById('outline')!, getView);

  let countTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleCount = () => {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => renderCount(view.state), 300);
  };

  // Everything that depends on the whole document being replaced.
  const refreshAll = () => {
    renderTitle(doc);
    renderSaveStatus(doc);
    renderCount(view.state);
    toolbar.update(view.state);
    viewBar.update(view.state);
    outline.refresh(view.state);
  };
  doc.onChange(() => {
    renderTitle(doc);
    renderSaveStatus(doc);
  });
  // Loading uses setState, which doesn't go through onUpdate.
  doc.onLoad(refreshAll);

  onSettingsChange((next, prev) => {
    outline.visible = next.outlineVisible;
    viewBar.update(view.state);
    if (next.keybindings !== prev.keybindings) {
      for (const bar of [toolbar, fileBar, viewBar]) bar.refreshTooltips();
    }
  });
  outline.visible = getSettings().outlineVisible;

  // Initial content: an unsaved draft from last time, the welcome text on first run, or empty.
  const draft = drafts.load();
  let seenWelcome = true;
  try {
    seenWelcome = localStorage.getItem(FIRST_RUN_KEY) !== null;
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    // ignore
  }
  if (draft) doc.load(draft.content, null, draft.name, true);
  else doc.load(seenWelcome ? '' : welcomeText, null, 'Uten tittel.md');


  // Desktop: a file passed on the command line ("Open with" in Explorer) replaces the above.
  void platform.startupFile().then((path) => {
    if (path) void doc.openPath(path);
  });

  platform.onCloseRequested(() => doc.hasUnsavedWork);
}
