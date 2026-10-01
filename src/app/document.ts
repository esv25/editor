/**
 * One open document (one tab): its file, editor state, unsaved-changes
 * tracking and autosave. Talks to storage only through `storage`.
 */
import { Text, type EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { extensionForLang, extensionOf, type DocKind } from '../code/languages';
import { currentSettingsVersion } from '../editor/createEditor';
import { getSettings } from '../settings';
import { NeedsPermissionError, storage, type FileRef } from '../storage';
import { suggestFileName, titleFromContent } from './fileNames';

export type SaveStatus =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string };

export interface DocumentInit {
  id?: string;
  file: FileRef | null;
  name: string;
  kind: DocKind;
  /** Language of a code document (runner id, e.g. "python"). */
  lang?: string;
  state: EditorState;
  /** Content differs from what's on disk (e.g. restored unsaved work). */
  dirty?: boolean;
  /** Folder to autosave a new document in. */
  targetFolder?: string;
}

let idCounter = 0;
const newId = () => `d${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class EditorDocument {
  readonly id: string;
  file: FileRef | null;
  name: string;
  kind: DocKind;
  lang: string;
  /** The editor state; kept current by the workspace while the document is active. */
  state: EditorState;
  dirty: boolean;
  status: SaveStatus;
  /** Folder a new document should be autosaved in (e.g. a subfolder picked in the file tree). */
  targetFolder: string | undefined;
  /** Fallback folder from outside (the group's folder); set by the workspace. */
  folderProvider: () => string | undefined = () => undefined;
  /** Settings version the state was configured with (see createEditor). */
  settingsVersion = currentSettingsVersion();

  private savedDoc: Text;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while a new document is being autosaved to its first file. */
  private creating = false;
  /**
   * The file name was picked automatically (autosaved new document), so it
   * follows the document's first line. Cleared once the user picks a file.
   */
  private autoNamed = false;
  private listeners = new Set<() => void>();

  constructor(init: DocumentInit) {
    this.id = init.id ?? newId();
    this.file = init.file;
    this.name = init.name;
    this.kind = init.kind;
    this.lang = init.lang ?? '';
    this.targetFolder = init.targetFolder;
    this.state = init.state;
    this.dirty = !!init.dirty && init.state.doc.length > 0;
    this.savedDoc = this.dirty ? Text.empty : init.state.doc;
    this.status = { kind: this.dirty ? 'dirty' : 'clean' };
    if (this.dirty) this.scheduleAutosave();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  get content(): string {
    return this.state.doc.toString();
  }

  /** Untitled, unchanged and empty – safe to replace when opening a file. */
  get isBlank(): boolean {
    return !this.file && !this.dirty && this.state.doc.length === 0;
  }

  /** Call with every editor update while this document is active. */
  handleUpdate(update: ViewUpdate): void {
    this.state = update.state;
    if (!update.docChanged) return;
    const wasDirty = this.dirty;
    this.dirty = !update.state.doc.eq(this.savedDoc);
    if (this.dirty) {
      if (this.status.kind !== 'saving') this.status = { kind: 'dirty' };
      this.scheduleAutosave();
    } else {
      clearTimeout(this.autosaveTimer);
      if (this.status.kind === 'dirty') this.status = { kind: 'clean' };
    }
    if (wasDirty !== this.dirty || this.status.kind === 'dirty') this.notify();
  }

  /** Swap in a rebuilt state (e.g. after a language change), keeping unsaved-change tracking. */
  replaceState(state: EditorState): void {
    this.state = state;
    this.settingsVersion = currentSettingsVersion();
    this.notify();
  }

  /** Whether autosave will take care of this document. */
  private get autosaves(): boolean {
    if (!getSettings().autosave.enabled) return false;
    return this.file ? storage.canSaveInPlace : storage.createNew !== undefined;
  }

  /** True if there's unsaved work that autosave won't take care of. */
  get hasUnsavedWork(): boolean {
    return this.dirty && !this.autosaves;
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    if (!this.autosaves) return;
    this.autosaveTimer = setTimeout(
      () => void (this.file ? this.save({ silent: true }) : this.createFile()),
      getSettings().autosave.delayMs,
    );
  }

  /** Autosave a new document: give it a file in the autosave folder. */
  private async createFile(): Promise<void> {
    const snapshot = this.state.doc;
    const content = snapshot.toString();
    if (this.file || this.creating || !storage.createNew || content.trim() === '') return;
    this.creating = true;
    this.status = { kind: 'saving' };
    this.notify();
    try {
      const isMarkdown = this.kind === 'markdown';
      const ext = isMarkdown ? 'md' : extensionOf(this.name) || extensionForLang[this.lang] || 'txt';
      // Code files are named by time; Markdown by its first line (and follows it).
      const baseName = isMarkdown ? suggestFileName(content) : suggestFileName('').replace('Notat', 'Kode');
      const folder = this.targetFolder || this.folderProvider() || getSettings().autosave.folder || undefined;
      const file = await storage.createNew(content, baseName, ext, folder);
      this.file = file;
      this.name = file.name;
      this.autoNamed = isMarkdown;
      this.markSaved(snapshot);
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke autolagre: ${errorText(err)}` };
      this.notify();
    } finally {
      this.creating = false;
    }
  }

  /** Save to the current file, or ask where to save if there is none. */
  async save(opts: { silent?: boolean } = {}): Promise<boolean> {
    if (!this.file || !storage.canSaveInPlace) return opts.silent ? false : this.saveAs();
    const snapshot = this.state.doc;
    this.status = { kind: 'saving' };
    this.notify();
    try {
      await storage.save(this.file, snapshot.toString());
      await this.followTitle(snapshot.toString());
      this.markSaved(snapshot);
      return true;
    } catch (err) {
      const message =
        err instanceof NeedsPermissionError ? 'Trenger skrivetilgang – trykk Ctrl+S' : `Kunne ikke lagre: ${errorText(err)}`;
      this.status = { kind: 'error', message };
      this.notify();
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    const snapshot = this.state.doc;
    try {
      const file = await storage.saveAs(snapshot.toString(), this.name);
      if (!file) return false;
      this.file = file;
      this.name = file.name;
      this.autoNamed = false;
      this.markSaved(snapshot);
      return true;
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke lagre: ${errorText(err)}` };
      this.notify();
      return false;
    }
  }

  /** Rename an auto-named file when the document's first line has changed. */
  private async followTitle(content: string): Promise<void> {
    if (!this.autoNamed || !this.file || !storage.rename) return;
    const title = titleFromContent(content);
    if (!title || this.name.replace(/\.[^.]+$/, '') === title) return;
    try {
      this.file = await storage.rename(this.file, title);
      this.name = this.file.name;
    } catch {
      // Keep the old name; renaming is a nicety, saving is what matters.
    }
  }

  private markSaved(snapshot: Text): void {
    this.savedDoc = snapshot;
    this.dirty = !this.state.doc.eq(snapshot);
    this.status = { kind: 'saved', at: new Date() };
    // Typed more while saving? Save that too.
    if (this.dirty) this.scheduleAutosave();
    this.notify();
  }

  /** Stop timers; call when the tab is closed. */
  dispose(): void {
    clearTimeout(this.autosaveTimer);
    this.listeners.clear();
  }
}
