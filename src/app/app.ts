/**
 * Wires the editor, workspace (groups + tabs), storage and UI together.
 */
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { registerCommands } from '../commands/registry';
import { createMarkdownState, createView } from '../editor/createEditor';
import { runContext } from '../features/codeBlockTools';
import { imageContext, redrawImages } from '../features/images';
import { dirOf } from '../features/util/imagePath';
import { platform } from '../platform';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
import { drafts, storage } from '../storage';
import { CodeBar } from '../ui/codeBar';
import { FileTree } from '../ui/fileTree';
import { OutlinePanel } from '../ui/outline';
import { renderCount, renderSaveStatus, renderTitle } from '../ui/statusbar';
import { TabsUI } from '../ui/tabs';
import { checkForUpdates } from '../ui/updates';
import { renderButtons } from '../ui/toolbar';
import { initAppearance, resolvedTheme } from './appearance';
import { EditorDocument } from './document';
import { loadSession } from './session';
import { welcomeText } from './welcome';
import { Workspace, type Group } from './workspace';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const FIRST_RUN_KEY = 'editor.seenWelcome';
const el = (id: string) => document.getElementById(id)!;

export async function startApp(): Promise<void> {
  initAppearance();

  // Late-bound: commands must be registered before the editor (and its
  // keymaps) are created, but they act on the workspace created below.
  let ws!: Workspace;
  let view!: EditorView;
  const getView = () => view;
  const active = () => ws.activeDoc;

  registerCommands([
    {
      id: 'file.new',
      name: 'Nytt dokument',
      icon: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>'),
      key: 'Mod-n',
      scope: 'any',
      run: () => (void ws.newDocument(), true),
    },
    {
      id: 'file.newCode',
      name: 'Ny kodefil',
      label: 'Ny kodefil',
      scope: 'any',
      run: () => (void ws.newDocument('code', active()?.lang || 'python'), true),
    },
    {
      id: 'file.open',
      name: 'Åpne fil',
      icon: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h13l3-9H7l-3 9"/>'),
      key: 'Mod-o',
      scope: 'any',
      run: () => (void ws.openFile(), true),
    },
    {
      id: 'file.save',
      name: 'Lagre',
      icon: svg('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>'),
      key: 'Mod-s',
      scope: 'any',
      run: () => (void active()?.save(), true),
    },
    {
      id: 'file.saveAs',
      name: 'Lagre som',
      label: 'Lagre som',
      key: 'Mod-Shift-s',
      scope: 'any',
      run: () => (void active()?.saveAs(), true),
    },
    {
      id: 'tab.close',
      name: 'Lukk fanen',
      key: 'Mod-w',
      scope: 'any',
      run: () => {
        const doc = active();
        if (doc) void ws.closeDoc(doc);
        return true;
      },
    },
    { id: 'tab.next', name: 'Neste fane', key: ['Mod-Tab', 'Mod-PageDown'], scope: 'any', run: () => (ws.cycleDoc(1), true) },
    { id: 'tab.prev', name: 'Forrige fane', key: ['Mod-Shift-Tab', 'Mod-PageUp'], scope: 'any', run: () => (ws.cycleDoc(-1), true) },
    {
      id: 'group.new',
      name: 'Ny gruppe',
      key: 'Mod-Shift-n',
      scope: 'any',
      run: () => (tabs.startRename(ws.newGroup()), true),
    },
    {
      id: 'view.toggleOutline',
      name: 'Vis/skjul sidefeltet',
      icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
      key: 'Mod-Shift-o',
      scope: 'any',
      run: () => (updateSettings({ outlineVisible: !getSettings().outlineVisible }), true),
      isActive: () => getSettings().outlineVisible,
    },
    {
      id: 'view.toggleTheme',
      name: 'Bytt mellom lyst og mørkt tema',
      icon: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
      scope: 'any',
      run: () => (updateSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }), true),
    },
  ]);

  let countTimer: ReturnType<typeof setTimeout> | undefined;
  const onUpdate = (u: ViewUpdate) => {
    ws?.handleUpdate(u);
    const doc = ws?.activeDoc;
    if (!doc) return;
    if (u.docChanged) outline.scheduleRefresh();
    if (u.docChanged || u.selectionSet) {
      clearTimeout(countTimer);
      countTimer = setTimeout(() => renderCount(doc), u.docChanged ? 300 : 50);
      if (doc.kind === 'markdown') mdToolbar.update(u.state);
      outline.highlightActive(u.state);
    }
  };

  view = createView(el('editor'), onUpdate);
  ws = new Workspace(view);
  // Handy for debugging in the browser console during development.
  if (import.meta.env.DEV) Object.assign(window, { editorView: view, workspace: ws });

  const mdToolbar = renderButtons(el('md-tools'), getSettings().toolbar, getView);
  const codeBar = new CodeBar(el('code-tools'), getView, (doc, lang) => void ws.setLanguage(doc, lang));
  const fileBar = renderButtons(el('file-actions'), ['file.new', 'file.open', 'file.save'], getView);
  const viewBar = renderButtons(el('view-actions'), ['view.toggleOutline', 'view.toggleTheme'], getView);
  const outline = new OutlinePanel(el('outline'), getView);
  const linkFolder = async (group: Group) => {
    const folder = await storage.pickFolder?.();
    if (folder) ws.setGroupFolder(group, folder);
  };
  const tabs = new TabsUI(el('group-tabs'), el('doc-tabs'), ws, {
    newDocument: () => void ws.newDocument(),
    newCodeFile: () => void ws.newDocument('code', 'python'),
    linkFolder: (group) => void linkFolder(group),
  });
  const fileTree = new FileTree(el('files'), ws, {
    linkFolder: (group) => void linkFolder(group),
    newDocument: (folder, kind) => void ws.newDocument(kind, 'python', folder),
  });
  // Re-read the folder when the group changes, files appear (autosave/rename), or the
  // window regains focus (files may have changed outside the app).
  let treeKey = '';
  const refreshTree = (force = false) => {
    const group = ws.activeGroup;
    const key = `${group.id}|${group.folder ?? ''}|${ws.activeDoc?.id}|${ws.allDocs().map((d) => d.file?.path ?? '').join(',')}`;
    if (!force && key === treeKey) return;
    treeKey = key;
    void fileTree.refresh();
  };
  window.addEventListener('focus', () => refreshTree(true));

  // Code blocks and code files run in the document's folder, so they can use files next to it.
  runContext.cwd = () => ws.activeDoc?.file?.path?.replace(/[\\/][^\\/]*$/, '');
  // Relative image paths are relative to the document; redraw them if it moves (autosave, Lagre som).
  imageContext.baseDir = () => dirOf(ws.activeDoc?.file?.path);
  let imageDoc = { id: '', dir: undefined as string | undefined };

  // Tabs, names and save states.
  ws.onChange(() => {
    const doc = ws.activeDoc;
    if (!doc) return;
    const dir = dirOf(doc.file?.path);
    if (doc.id === imageDoc.id && dir !== imageDoc.dir && doc.kind === 'markdown') queueMicrotask(() => redrawImages(view));
    imageDoc = { id: doc.id, dir };
    tabs.render();
    refreshTree();
    renderTitle(doc);
    renderSaveStatus(doc, ws.message);
  });

  // Another document became active (or was rebuilt): everything that shows it.
  ws.onActiveChange(() => {
    const doc = ws.activeDoc;
    if (!doc) return;
    const isCode = doc.kind === 'code';
    el('md-tools').hidden = isCode;
    el('code-tools').hidden = !isCode;
    if (isCode) codeBar.update(doc);
    else mdToolbar.update(doc.state);
    viewBar.update(doc.state);
    outline.refresh(doc.state);
    renderCount(doc);
  });

  onSettingsChange((next, prev) => {
    el('sidebar').hidden = !next.outlineVisible;
    outline.visible = next.outlineVisible;
    viewBar.update(view.state);
    if (next.keybindings !== prev.keybindings) {
      for (const bar of [mdToolbar, fileBar, viewBar]) bar.refreshTooltips();
    }
  });
  el('sidebar').hidden = !getSettings().outlineVisible;
  outline.visible = getSettings().outlineVisible;

  // Restore the last session, or start with one group ("Notater").
  const session = loadSession();
  if (session) {
    await ws.restore(session);
  } else {
    let firstRun = false;
    try {
      firstRun = localStorage.getItem(FIRST_RUN_KEY) === null;
      localStorage.setItem(FIRST_RUN_KEY, '1');
    } catch {
      // ignore
    }
    const group = ws.newGroup('Notater');
    if (firstRun) {
      const welcome = new EditorDocument({ file: null, name: 'Velkommen.md', kind: 'markdown', state: createMarkdownState(welcomeText) });
      group.docs.splice(0, group.docs.length);
      group.docs.push(welcome);
      group.activeDocId = welcome.id;
      ws.activate(welcome);
    }
  }

  // Unsaved work from before tabs existed (single-document versions).
  const draft = drafts.load();
  if (draft) {
    const doc = await ws.newDocument();
    view.dispatch({ changes: { from: 0, insert: draft.content } });
    doc.name = draft.name;
    drafts.clear();
  }

  // Desktop: the file the app was started with, and files opened later via
  // "Open with" (forwarded from a second launch to this window).
  void platform.startupFile().then((path) => {
    if (path) void ws.openPath(path);
  });
  platform.onOpenFile?.((path) => void ws.openPath(path));

  // Updates (installed desktop app only): check quietly shortly after start;
  // clicking the version in the status bar checks on demand.
  const beforeInstall = async () => {
    await Promise.all(ws.allDocs().filter((d) => d.dirty && d.file).map((d) => d.save({ silent: true })));
    ws.saveNow();
  };
  if (platform.appVersion) {
    const versionEl = el('status-version');
    versionEl.textContent = `v${await platform.appVersion()}`;
    versionEl.title = 'Se etter oppdateringer';
    versionEl.hidden = false;
    versionEl.addEventListener('click', () => void checkForUpdates(false, beforeInstall));
    if (import.meta.env.PROD) setTimeout(() => void checkForUpdates(true, beforeInstall), 4000);
  }

  platform.onCloseRequested(() => {
    ws.saveNow();
    return ws.allDocs().some((d) => d.hasUnsavedWork);
  });
  window.addEventListener('pagehide', () => ws.saveNow());
}
