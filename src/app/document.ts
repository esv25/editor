/**
 * The open document: which file it belongs to, whether it has unsaved
 * changes, autosave and draft backup. Talks to storage only through the
 * `storage` module.
 */
import { Text } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import type { EditorHandle } from '../editor/createEditor';
import { getSettings } from '../settings';
import { drafts, NeedsPermissionError, storage, type FileRef } from '../storage';

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

  private scheduleAutosave(): void {
    const { autosave } = getSettings();
    clearTimeout(this.autosaveTimer);
    if (!autosave.enabled || !this.file || !storage.canSaveInPlace) return;
    this.autosaveTimer = setTimeout(() => void this.save({ silent: true }), autosave.delayMs);
  }

  /** Save to the current file, or ask where to save if there is none. */
  async save(opts: { silent?: boolean } = {}): Promise<boolean> {
    if (!this.file || !storage.canSaveInPlace) return opts.silent ? false : this.saveAs();
    const snapshot = this.editor.view.state.doc;
    this.status = { kind: 'saving' };
    this.notify();
    try {
      await storage.save(this.file, snapshot.toString());
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
      this.markSaved(snapshot);
      return true;
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke lagre: ${err instanceof Error ? err.message : String(err)}` };
      this.notify();
      return false;
    }
  }

  async open(): Promise<void> {
    if (!this.confirmDiscard()) return;
    try {
      const opened = await storage.open();
      if (opened) this.load(opened.content, opened.file, opened.file.name);
    } catch (err) {
      this.status = { kind: 'error', message: `Kunne ikke åpne: ${err instanceof Error ? err.message : String(err)}` };
      this.notify();
    }
  }

  newDocument(): void {
    if (!this.confirmDiscard()) return;
    this.load('', null, UNTITLED);
  }

  /** True if there's unsaved work that autosave won't take care of. */
  get hasUnsavedWork(): boolean {
    return this.dirty && !(this.file && storage.canSaveInPlace && getSettings().autosave.enabled);
  }

  private confirmDiscard(): boolean {
    return !this.dirty || window.confirm('Dokumentet har ulagrede endringer. Forkaste dem?');
  }

  private markSaved(snapshot: Text): void {
    this.savedDoc = snapshot;
    this.dirty = !this.editor.view.state.doc.eq(snapshot);
    this.status = { kind: 'saved', at: new Date() };
    if (!this.dirty) drafts.clear();
    this.notify();
  }
}
