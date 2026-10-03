/**
 * Sidebar file list for the active group's linked folder, with expandable
 * subfolders. Only files the editor can open (notes and code) are listed.
 */
import type { Group, Workspace } from '../app/workspace';
import { codeFileExtensions, extensionOf, kindForName } from '../code/languages';
import { platform } from '../platform';
import { storage, type FolderEntry } from '../storage';
import { showContextMenu, type MenuItem } from './contextMenu';

const OPENABLE = new Set(['md', 'markdown', 'txt', ...codeFileExtensions]);

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  folderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h12.5l3.5-8H7.5L4 19"/>'),
  note: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  code: svg('<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
};

export interface FileTreeActions {
  /** Ask for a folder and link it to the group. */
  linkFolder(group: Group): void;
  newDocument(folder: string, kind: 'markdown' | 'code'): void;
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const samePath = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export class FileTree {
  /** Expanded subfolders (by path), kept across refreshes and group switches. */
  private expanded = new Set<string>();
  private renderToken = 0;

  constructor(
    private container: HTMLElement,
    private ws: Workspace,
    private actions: FileTreeActions,
  ) {}

  /** Re-read the folder and redraw. Safe to call often; stale renders are dropped. */
  async refresh(): Promise<void> {
    const token = ++this.renderToken;
    const group = this.ws.activeGroup;
    const header = document.createElement('div');
    header.className = 'sidebar-header';
    const title = document.createElement('h2');
    title.textContent = 'Filer';
    header.append(title);

    if (!storage.listFolder) {
      this.container.replaceChildren(header, this.hint('Mapper kan kobles til i skrivebordsappen.'));
      return;
    }
    if (!group.folder) {
      const link = this.linkButton('Koble mappe til gruppen …', group);
      this.container.replaceChildren(header, this.hint('Gruppen har ingen mappe. Du kan koble til en, så vises filene her og nye dokumenter lagres der.'), link);
      return;
    }

    const folder = group.folder;
    this.revealActive(folder);
    title.textContent = baseName(folder);
    title.title = folder;
    header.append(
      this.iconButton('⟳', 'Oppdater', () => void this.refresh()),
      this.iconButton('⋯', 'Mer', (e) => this.folderMenu(e, folder, group, true)),
    );

    const rows = document.createElement('div');
    rows.className = 'file-tree';
    try {
      await this.renderDir(folder, 0, rows, token);
    } catch {
      if (token !== this.renderToken) return;
      this.container.replaceChildren(header, this.hint(`Fant ikke mappa ${folder}.`), this.linkButton('Velg en annen mappe …', group));
      return;
    }
    if (token !== this.renderToken) return;
    if (!rows.childElementCount) rows.append(this.hint('Mappa er tom.'));
    rows.addEventListener('contextmenu', (e) => {
      if (e.target === rows) this.folderMenu(e, folder, group, true);
    });
    this.container.replaceChildren(header, rows);
  }

  /** Expand the subfolders leading to the active document, once per document. */
  private revealedFor: string | undefined;
  private revealActive(root: string): void {
    const path = this.ws.activeDoc?.file?.path;
    if (!path || path === this.revealedFor) return;
    this.revealedFor = path;
    const prefix = root.replace(/[\\/]+$/, '');
    if (!path.toLowerCase().startsWith(prefix.toLowerCase() + path[prefix.length])) return;
    let dir = path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
    while (dir.length > prefix.length) {
      this.expanded.add(dir);
      dir = dir.slice(0, Math.max(dir.lastIndexOf('\\'), dir.lastIndexOf('/')));
    }
  }

  private async renderDir(path: string, depth: number, into: HTMLElement, token: number): Promise<void> {
    const entries = await storage.listFolder!(path);
    if (token !== this.renderToken) return;
    for (const entry of entries) {
      if (!entry.isDirectory && !OPENABLE.has(extensionOf(entry.name))) continue;
      into.append(this.row(entry, depth));
      if (entry.isDirectory && this.expanded.has(entry.path)) {
        try {
          await this.renderDir(entry.path, depth + 1, into, token);
        } catch {
          this.expanded.delete(entry.path);
        }
      }
    }
  }

  private row(entry: FolderEntry, depth: number): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    const expanded = entry.isDirectory && this.expanded.has(entry.path);
    const isCode = !entry.isDirectory && kindForName(entry.name) === 'code';
    row.className = `file-row ${entry.isDirectory ? 'dir' : isCode ? 'file code' : 'file note'}${expanded ? ' expanded' : ''}`;
    row.title = entry.path;

    // One guide per level, so it's clear which folder a row belongs to.
    for (let i = 0; i < depth; i++) {
      const guide = document.createElement('span');
      guide.className = 'file-guide';
      row.append(guide);
    }
    const chevron = document.createElement('span');
    chevron.className = 'file-chevron';
    if (entry.isDirectory) chevron.innerHTML = icons.chevron;
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.innerHTML = entry.isDirectory ? (expanded ? icons.folderOpen : icons.folder) : isCode ? icons.code : icons.note;
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;
    row.append(chevron, icon, name);

    if (!entry.isDirectory && samePath(this.ws.activeDoc?.file?.path, entry.path)) row.classList.add('active');

    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => {
      if (entry.isDirectory) {
        if (this.expanded.has(entry.path)) this.expanded.delete(entry.path);
        else this.expanded.add(entry.path);
        void this.refresh();
      } else {
        void this.ws.openPath(entry.path);
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      if (entry.isDirectory) this.folderMenu(e, entry.path, this.ws.activeGroup, false);
      else
        showContextMenu(e, [
          { label: 'Åpne', action: () => void this.ws.openPath(entry.path) },
          { label: 'Vis i Utforsker', action: () => void platform.revealPath?.(entry.path), disabled: !platform.revealPath },
          {
            label: 'Vis sikkerhetskopier',
            action: () => void storage.backupFolder?.().then((dir) => platform.revealPath?.(dir)),
            disabled: !storage.backupFolder || !platform.revealPath,
          },
        ]);
    });
    return row;
  }

  /** Menu for a folder (the group folder itself, or a subfolder). */
  private folderMenu(e: MouseEvent, folder: string, group: Group, isRoot: boolean): void {
    const items: MenuItem[] = [
      { label: 'Nytt dokument her', action: () => this.actions.newDocument(folder, 'markdown') },
      { label: 'Ny kodefil her', action: () => this.actions.newDocument(folder, 'code') },
      'separator',
      { label: 'Vis i Utforsker', action: () => void platform.revealPath?.(folder), disabled: !platform.revealPath },
    ];
    if (isRoot) {
      items.push(
        { label: 'Bytt mappe …', action: () => this.actions.linkFolder(group) },
        { label: 'Fjern mappekobling', action: () => this.ws.setGroupFolder(group, undefined) },
      );
    }
    showContextMenu(e, items);
  }

  private hint(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'sidebar-hint';
    p.textContent = text;
    return p;
  }

  private linkButton(text: string, group: Group): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sidebar-link';
    b.textContent = text;
    b.addEventListener('click', () => this.actions.linkFolder(group));
    return b;
  }

  private iconButton(text: string, title: string, onClick: (e: MouseEvent) => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sidebar-icon';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
}
