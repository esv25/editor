/**
 * The open document: which file it belongs to, whether it has unsaved
 * changes, autosave and draft backup. Talks to storage only through the
 * `storage` module.
 */
import { Text } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import type { EditorHandle } from '../editor/createEditor';
import { platform } from '../platform';
import { suggestFileName, titleFromContent } from './fileNames';
import { getSettings } from '../settings';
import { drafts, NeedsPermissionError, storage, type FileRef, type OpenedFile } from '../storage';

export type SaveStatus =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string };

const UNTITLED = 'Uten tittel.md';

export class DocumentController {
  file: FileRef | null = null;
  name = UNTITLED;
  dirty = false;
  status: SaveStatus = { kind: 'clean' };

  private savedDoc: Text = Text.empty;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while a new document is being autosaved to its first file. */
  private creating = false;
  /**
   * The file name was picked automatically (autosaved new document), so it
   * follows the document's first line. Cleared once the user picks a file.
   */
  private autoNamed = false;
  private listeners = new Set<() => void>();
  private loadListeners = new Set<() => void>();

  constructor(private editor: EditorHandle) {}

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Called after the whole document has been replaced (new/open/restore). */
  onLoad(fn: () => void): void {
    this.loadListeners.add(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private get content(): string {
    return this.editor.view.state.doc.toString();
  }

  /** Replace the editor content. `dirty` is for restored drafts that were never saved. */
  load(content: string, file: FileRef | null, name: string, dirty = false): void {
    clearTimeout(this.autosaveTimer);
    this.editor.setDocument(content);
    this.file = file;
    this.name = name;
    this.autoNamed = false;
    this.savedDoc = dirty ? Text.empty : this.editor.view.state.doc;
    this.dirty = dirty && content !== '';
    this.status = { kind: this.dirty ? 'dirty' : 'clean' };
    if (!this.dirty) drafts.clear();
    this.editor.view.focus();
    this.notify();
    for (const fn of this.loadListeners) fn();
  }

  /** Call from the editor's update listener. */
  handleUpdate(update: ViewUpdate): void {
    if (!update.docChanged) return;
    const wasDirty = this.dirty;
    this.dirty = !update.state.doc.eq(this.savedDoc);

    clearTimeout(this.draftTimer);
    if (this.dirty) {
      this.draftTimer = setTimeout(() => drafts.save(this.name, this.content), 500);
      if (this.status.kind !== 'saving') this.status = { kind: 'dirty' };
      this.scheduleAutosave();
    } else {
      drafts.clear();
      clearTimeout(this.autosaveTimer);
      if (this.status.kind === 'dirty') this.status = { kind: 'clean' };
    }
    if (wasDirty !== this.dirty || this.status.kind === 'dirty') this.notify();
  }

  /** Whether autosave will take care of the current document. */
  private get autosaves(): boolean {
    if (!getSettings().autosave.enabled) return false;
    return this.file ? storage.canSaveInPlace : storage.createNew !== undefined;
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
    const snapshot = this.editor.view.state.doc;
    if (this.file || this.creating || !storage.createNew || snapshot.toString().trim() === '') return;
    this.creating = true;
    this.status = { kind: 'saving' };
    this.notify();
    try {
      const content = snapshot.toString();
      const file = await storage.createNew(content, suggestFileName(content), getSettings().autosave.folder || undefined);
      this.file = file;
      this.name = file.name;
      this.autoNamed = true;
      this.markSaved(snapshot);
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke autolagre: ${err instanceof Error ? err.message : String(err)}` };
      this.notify();
    } finally {
      this.creating = false;
    }
  }

  /** Save to the current file, or ask where to save if there is none. */
  async save(opts: { silent?: boolean } = {}): Promise<boolean> {
    if (!this.file || !storage.canSaveInPlace) return opts.silent ? false : this.saveAs();
    const snapshot = this.editor.view.state.doc;
    this.status = { kind: 'saving' };
    this.notify();
    try {
      await storage.save(this.file, snapshot.toString());
      await this.followTitle(snapshot.toString());
      this.markSaved(snapshot);
      return true;
    } catch (err) {
      const message =
        err instanceof NeedsPermissionError
          ? 'Trenger skrivetilgang – trykk Ctrl+S'
          : `Kunne ikke lagre: ${err instanceof Error ? err.message : String(err)}`;
      this.status = { kind: 'error', message };
      this.notify();
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    const snapshot = this.editor.view.state.doc;
    try {
      const file = await storage.saveAs(snapshot.toString(), this.name);
      if (!file) return false;
      this.file = file;
      this.name = file.name;
      this.autoNamed = false;
      this.markSaved(snapshot);
      return true;
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke lagre: ${err instanceof Error ? err.message : String(err)}` };
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

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.tryOpen(() => storage.open());
  }

  /** Open a file by path (desktop: the file the app was launched with). */
  async openPath(path: string): Promise<void> {
    if (!storage.openPath || !(await this.confirmDiscard())) return;
    await this.tryOpen(() => storage.openPath!(path));
  }

  async newDocument(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.load('', null, UNTITLED);
  }

  private async tryOpen(read: () => Promise<OpenedFile | null>): Promise<void> {
    try {
      const opened = await read();
      if (opened) this.load(opened.content, opened.file, opened.file.name);
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke åpne: ${err instanceof Error ? err.message : String(err)}` };
      this.notify();
    }
  }

  /** True if there's unsaved work that autosave won't take care of. */
  get hasUnsavedWork(): boolean {
    return this.dirty && !this.autosaves;
  }

  private async confirmDiscard(): Promise<boolean> {
    return !this.dirty || platform.confirm('Dokumentet har ulagrede endringer. Forkaste dem?');
  }

  private markSaved(snapshot: Text): void {
    this.savedDoc = snapshot;
    this.dirty = !this.editor.view.state.doc.eq(snapshot);
    this.status = { kind: 'saved', at: new Date() };
    if (!this.dirty) drafts.clear();
    // Typed more while saving? Save that too.
    else this.scheduleAutosave();
    this.notify();
  }
}
