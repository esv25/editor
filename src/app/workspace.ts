/**
 * Groups (top tabs) and their open documents (sub-tabs). There is one
 * EditorView; switching tabs swaps in the document's own EditorState.
 */
import { EditorSelection } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { extensionForLang, kindForName, langForName, withExtension, type DocKind } from '../code/languages';
import { breakpointLines, setBreakpointsEffect } from '../debug/breakpoints';
import {
  createCodeState,
  createMarkdownState,
  currentSettingsVersion,
  refreshForSettings,
} from '../editor/createEditor';
import { platform } from '../platform';
import { onSettingsChange } from '../settings';
import { storage, type FileRef, type OpenedFile } from '../storage';
import { EditorDocument } from './document';
import { saveSession, type Session, type SessionDoc } from './session';

export interface Group {
  id: string;
  name: string;
  /** Linked folder (optional): shown in the sidebar, new documents are saved here. */
  folder?: string;
  docs: EditorDocument[];
  activeDocId: string | null;
}

const UNTITLED = 'Uten tittel';
const newGroupId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const samePath = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function stateFor(kind: DocKind, content: string, lang: string) {
  return kind === 'markdown' ? createMarkdownState(content) : createCodeState(content, lang);
}

export class Workspace {
  groups: Group[] = [];
  activeGroupId = '';
  /** Last error to show in the status bar (e.g. a file that couldn't be opened). */
  message: string | null = null;

  private listeners = new Set<() => void>();
  private activeListeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private scrollPositions = new Map<string, number>();
  private converting = new Set<string>();

  constructor(private view: EditorView) {
    onSettingsChange(() => {
      const doc = this.activeDoc;
      if (!doc) return;
      this.view.dispatch({ effects: refreshForSettings(this.view.state) });
      doc.settingsVersion = currentSettingsVersion();
    });
  }

  /** Tabs, names or save states changed. */
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** A different document became active. */
  onActiveChange(fn: () => void): void {
    this.activeListeners.add(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
    this.scheduleSave();
  }

  get activeGroup(): Group {
    return this.groups.find((g) => g.id === this.activeGroupId) ?? this.groups[0];
  }

  get activeDoc(): EditorDocument | null {
    const group = this.activeGroup;
    return group?.docs.find((d) => d.id === group.activeDocId) ?? group?.docs[0] ?? null;
  }

  allDocs(): EditorDocument[] {
    return this.groups.flatMap((g) => g.docs);
  }

  groupOf(doc: EditorDocument): Group {
    return this.groups.find((g) => g.docs.includes(doc))!;
  }

  /** Editor update listener: goes to the active document. */
  handleUpdate(update: ViewUpdate): void {
    this.activeDoc?.handleUpdate(update);
    if (update.docChanged) this.scheduleSave();
  }

  // ---------- Documents ----------

  private adopt(doc: EditorDocument): void {
    doc.folderProvider = () => this.groups.find((g) => g.docs.includes(doc))?.folder;
    doc.onChange(() => {
      // "Save as" with a different extension turns a note into code or back.
      if (doc.file && kindForName(doc.name) !== doc.kind) void this.convert(doc);
      this.changed();
    });
  }

  private insertDoc(group: Group, doc: EditorDocument): void {
    this.adopt(doc);
    const activeIndex = group.docs.findIndex((d) => d.id === group.activeDocId);
    group.docs.splice(activeIndex >= 0 ? activeIndex + 1 : group.docs.length, 0, doc);
  }

  activate(doc: EditorDocument): void {
    const previous = this.activeDoc;
    if (previous && previous !== doc) this.scrollPositions.set(previous.id, this.view.scrollDOM.scrollTop);
    const group = this.groupOf(doc);
    this.activeGroupId = group.id;
    group.activeDocId = doc.id;
    if (doc.settingsVersion !== currentSettingsVersion()) {
      doc.state = doc.state.update({ effects: refreshForSettings(doc.state) }).state;
      doc.settingsVersion = currentSettingsVersion();
    }
    if (this.view.state !== doc.state) {
      this.view.setState(doc.state);
      const top = this.scrollPositions.get(doc.id) ?? 0;
      requestAnimationFrame(() => (this.view.scrollDOM.scrollTop = top));
    }
    for (const fn of this.activeListeners) fn();
    this.changed();
    this.view.focus();
  }

  /** New untitled document in the active group; `folder`: autosave it there (e.g. a subfolder). */
  async newDocument(kind: DocKind = 'markdown', lang = 'python', folder?: string): Promise<EditorDocument> {
    const name = kind === 'markdown' ? `${UNTITLED}.md` : `${UNTITLED}.${extensionForLang[lang] ?? 'txt'}`;
    const doc = new EditorDocument({
      file: null,
      name,
      kind,
      lang: kind === 'code' ? lang : '',
      state: await stateFor(kind, '', lang),
      targetFolder: folder,
    });
    this.insertDoc(this.activeGroup, doc);
    this.activate(doc);
    return doc;
  }

  private async docFor(file: FileRef, content: string, extra: Partial<SessionDoc> = {}): Promise<EditorDocument> {
    const kind = kindForName(file.name);
    const lang = kind === 'code' ? (extra.lang ?? langForName(file.name)) : '';
    return new EditorDocument({
      id: extra.id,
      file,
      name: file.name,
      kind,
      lang,
      state: await stateFor(kind, content, lang),
      dirty: extra.dirty,
    });
  }

  async openFile(): Promise<void> {
    try {
      const opened = await storage.open();
      if (opened) await this.addOpened(opened);
    } catch (err) {
      this.showError(`Kunne ikke åpne: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Open a file by path (desktop: "Open with" / launched with a file). */
  async openPath(path: string): Promise<void> {
    const existing = this.allDocs().find((d) => samePath(d.file?.path, path));
    if (existing) return this.activate(existing);
    if (!storage.openPath) return;
    try {
      await this.addOpened(await storage.openPath(path));
    } catch (err) {
      this.showError(`Kunne ikke åpne ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async addOpened(opened: OpenedFile): Promise<void> {
    const existing = this.allDocs().find((d) => samePath(d.file?.path, opened.file.path));
    if (existing) return this.activate(existing);
    const blank = this.activeDoc?.isBlank ? this.activeDoc : null;
    const doc = await this.docFor(opened.file, opened.content);
    this.insertDoc(this.activeGroup, doc);
    this.activate(doc);
    // Opening a file replaces an empty untitled tab instead of adding next to it.
    if (blank) this.removeDoc(blank);
  }

  async closeDoc(doc: EditorDocument): Promise<void> {
    if (doc.hasUnsavedWork && !(await platform.confirm(`«${doc.name}» har ulagrede endringer. Lukke likevel?`))) return;
    this.removeDoc(doc);
  }

  private removeDoc(doc: EditorDocument): void {
    const group = this.groupOf(doc);
    if (!group) return;
    const index = group.docs.indexOf(doc);
    const wasActive = this.activeDoc === doc;
    group.docs.splice(index, 1);
    doc.dispose();
    this.scrollPositions.delete(doc.id);
    if (group.docs.length === 0) {
      const blank = new EditorDocument({ file: null, name: `${UNTITLED}.md`, kind: 'markdown', state: createMarkdownState('') });
      this.adopt(blank);
      group.docs.push(blank);
    }
    if (group.activeDocId === doc.id || !group.docs.some((d) => d.id === group.activeDocId)) {
      group.activeDocId = group.docs[Math.min(index, group.docs.length - 1)].id;
    }
    if (wasActive) this.activate(this.activeDoc!);
    else this.changed();
  }

  /** Change the language of a code document (highlighting and runner). */
  async setLanguage(doc: EditorDocument, lang: string): Promise<void> {
    if (doc.kind !== 'code' || doc.lang === lang) return;
    const state = await createCodeState(doc.state.doc.toString(), lang);
    doc.lang = lang;
    if (!doc.file) doc.name = withExtension(doc.name, extensionForLang[lang] ?? lang);
    this.swapState(doc, state);
  }

  /** Rebuild a document as Markdown or code after its file type changed. */
  private async convert(doc: EditorDocument): Promise<void> {
    if (this.converting.has(doc.id)) return;
    this.converting.add(doc.id);
    try {
      doc.kind = kindForName(doc.name);
      doc.lang = doc.kind === 'code' ? langForName(doc.name) : '';
      this.swapState(doc, await stateFor(doc.kind, doc.state.doc.toString(), doc.lang));
    } finally {
      this.converting.delete(doc.id);
    }
  }

  private swapState(doc: EditorDocument, state: EditorDocument['state']): void {
    const head = Math.min(doc.state.selection.main.head, state.doc.length);
    const next = state.update({
      selection: EditorSelection.cursor(head),
      effects: setBreakpointsEffect.of(breakpointLines(doc.state)),
    }).state;
    const active = this.activeDoc === doc;
    doc.replaceState(next);
    if (active) {
      this.view.setState(next);
      for (const fn of this.activeListeners) fn();
    }
    this.changed();
  }

  cycleDoc(direction: 1 | -1): void {
    const group = this.activeGroup;
    if (group.docs.length < 2) return;
    const index = group.docs.findIndex((d) => d === this.activeDoc);
    this.activate(group.docs[(index + direction + group.docs.length) % group.docs.length]);
  }

  // ---------- Groups ----------

  newGroup(name?: string): Group {
    const group: Group = {
      id: newGroupId(),
      name: name ?? this.uniqueGroupName(),
      docs: [],
      activeDocId: null,
    };
    const blank = new EditorDocument({ file: null, name: `${UNTITLED}.md`, kind: 'markdown', state: createMarkdownState('') });
    this.adopt(blank);
    group.docs.push(blank);
    group.activeDocId = blank.id;
    this.groups.push(group);
    this.activate(blank);
    return group;
  }

  private uniqueGroupName(): string {
    for (let n = this.groups.length + 1; ; n++) {
      const name = `Gruppe ${n}`;
      if (!this.groups.some((g) => g.name === name)) return name;
    }
  }

  /** Link a folder to a group (or unlink with undefined). */
  setGroupFolder(group: Group, folder: string | undefined): void {
    group.folder = folder;
    for (const fn of this.activeListeners) fn();
    this.changed();
  }

  renameGroup(group: Group, name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    group.name = trimmed;
    this.changed();
  }

  activateGroup(group: Group): void {
    const doc = group.docs.find((d) => d.id === group.activeDocId) ?? group.docs[0];
    if (doc) this.activate(doc);
  }

  async closeGroup(group: Group): Promise<void> {
    const unsaved = group.docs.filter((d) => d.hasUnsavedWork);
    const question = unsaved.length
      ? `Gruppen «${group.name}» har ${unsaved.length} dokument(er) med ulagrede endringer. Lukke likevel?`
      : null;
    if (question && !(await platform.confirm(question))) return;
    const index = this.groups.indexOf(group);
    const wasActive = this.activeGroup === group;
    for (const doc of group.docs) doc.dispose();
    this.groups.splice(index, 1);
    if (this.groups.length === 0) return void this.newGroup('Notater');
    if (wasActive) this.activateGroup(this.groups[Math.max(0, index - 1)]);
    else this.changed();
  }

  // ---------- Messages ----------

  showError(message: string): void {
    this.message = message;
    this.changed();
    setTimeout(() => {
      if (this.message === message) {
        this.message = null;
        this.changed();
      }
    }, 8000);
  }

  // ---------- Persistence ----------

  toSession(): Session {
    return {
      version: 1,
      activeGroupId: this.activeGroupId,
      groups: this.groups.map((g) => ({
        id: g.id,
        name: g.name,
        folder: g.folder,
        activeDocId: g.activeDocId,
        docs: g.docs.map((d) => {
          const path = d.file?.path;
          const entry: SessionDoc = { id: d.id, name: d.name, kind: d.kind, cursor: d.state.selection.main.head };
          if (path) entry.path = path;
          if (d.kind === 'code') entry.lang = d.lang;
          const breakpoints = breakpointLines(d.state);
          if (breakpoints.length) entry.breakpoints = breakpoints;
          if (!path && d.targetFolder) entry.targetFolder = d.targetFolder;
          if (!path || d.dirty) {
            entry.content = d.content;
            entry.dirty = d.dirty;
          }
          return entry;
        }),
      })),
    };
  }

  scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 500);
  }

  saveNow(): void {
    clearTimeout(this.saveTimer);
    if (this.groups.length) saveSession(this.toSession());
  }

  /** Rebuild groups and tabs from a saved session, re-reading files from disk. */
  async restore(session: Session): Promise<void> {
    const missing: string[] = [];
    const restoreDoc = async (sd: SessionDoc): Promise<EditorDocument | null> => {
      let doc: EditorDocument | null = null;
      if (sd.path && storage.openPath) {
        try {
          const opened = await storage.openPath(sd.path);
          const unsaved = sd.dirty && sd.content !== undefined;
          doc = await this.docFor(opened.file, unsaved ? sd.content! : opened.content, { ...sd, dirty: unsaved });
        } catch {
          missing.push(sd.name);
          if (sd.content === undefined) return null;
        }
      }
      if (!doc) {
        // Untitled, or a file that's gone: keep the stored content as an unsaved document.
        const kind = sd.kind ?? kindForName(sd.name);
        const lang = sd.lang ?? (kind === 'code' ? langForName(sd.name) : '');
        doc = new EditorDocument({
          id: sd.id,
          file: null,
          name: sd.name,
          kind,
          lang,
          state: await stateFor(kind, sd.content ?? '', lang),
          dirty: sd.dirty || (sd.path !== undefined && !!sd.content),
          targetFolder: sd.targetFolder,
        });
      }
      if (sd.cursor !== undefined && sd.cursor <= doc.state.doc.length) {
        doc.state = doc.state.update({ selection: EditorSelection.cursor(sd.cursor) }).state;
      }
      if (sd.breakpoints?.length) doc.state = doc.state.update({ effects: setBreakpointsEffect.of(sd.breakpoints) }).state;
      return doc;
    };

    for (const sg of session.groups) {
      const docs = (await Promise.all(sg.docs.map(restoreDoc))).filter((d): d is EditorDocument => d !== null);
      const group: Group = { id: sg.id, name: sg.name, folder: sg.folder, docs, activeDocId: sg.activeDocId };
      if (docs.length === 0) {
        docs.push(new EditorDocument({ file: null, name: `${UNTITLED}.md`, kind: 'markdown', state: createMarkdownState('') }));
      }
      docs.forEach((d) => this.adopt(d));
      this.groups.push(group);
    }
    this.activeGroupId = session.activeGroupId;
    this.activate(this.activeDoc!);
    if (missing.length) this.showError(`Fant ikke: ${missing.join(', ')}`);
  }
}
