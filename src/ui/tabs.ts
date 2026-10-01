/**
 * Tab bars: groups in the top bar, the active group's documents below.
 */
import type { EditorDocument } from '../app/document';
import type { Group, Workspace } from '../app/workspace';

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.title = title;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export class TabsUI {
  /** Group being renamed, and its input (kept across re-renders). */
  private renaming: { id: string; input: HTMLInputElement } | null = null;

  constructor(
    private groupsEl: HTMLElement,
    private docsEl: HTMLElement,
    private ws: Workspace,
    private actions: { newDocument(): void; newCodeFile(): void },
  ) {}

  render(): void {
    const ws = this.ws;
    this.groupsEl.replaceChildren(
      ...ws.groups.map((g) => this.groupTab(g)),
      button('tab-add', '+', 'Ny gruppe (Ctrl+Shift+N)', () => {
        const group = ws.newGroup();
        this.startRename(group);
      }),
    );
    const group = ws.activeGroup;
    this.docsEl.replaceChildren(
      ...group.docs.map((d) => this.docTab(d)),
      button('tab-add', '+', 'Nytt dokument (Ctrl+N)', () => this.actions.newDocument()),
      button('tab-add tab-add-code', '{ }', 'Ny kodefil', () => this.actions.newCodeFile()),
    );
    this.docsEl.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.renaming?.input.focus();
  }

  private groupTab(group: Group): HTMLElement {
    const tab = document.createElement('div');
    tab.className = `tab group-tab${group === this.ws.activeGroup ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');

    if (this.renaming?.id === group.id) {
      tab.append(this.renaming.input);
      return tab;
    }

    const icon = document.createElement('span');
    icon.className = 'group-icon';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = group.name;
    tab.title = `Gruppe «${group.name}» – dobbeltklikk for å gi nytt navn`;
    tab.append(icon, label);
    tab.append(button('tab-close', '✕', 'Lukk gruppen', () => void this.ws.closeGroup(group)));
    tab.addEventListener('mousedown', (e) => e.button === 0 && e.preventDefault());
    tab.addEventListener('click', () => this.ws.activateGroup(group));
    tab.addEventListener('dblclick', () => this.startRename(group));
    return tab;
  }

  startRename(group: Group): void {
    const input = document.createElement('input');
    input.className = 'tab-rename';
    input.value = group.name;
    input.size = Math.max(8, group.name.length + 2);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (save) this.ws.renameGroup(group, input.value);
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      // Otherwise the key goes on to the editor once the input is gone.
      e.preventDefault();
      e.stopPropagation();
      finish(e.key === 'Enter');
    });
    input.addEventListener('blur', () => finish(true));
    this.renaming = { id: group.id, input };
    this.render();
    input.select();
  }

  private docTab(doc: EditorDocument): HTMLElement {
    const tab = document.createElement('div');
    const active = doc === this.ws.activeDoc;
    tab.className = `tab doc-tab${active ? ' active' : ''}${doc.dirty ? ' dirty' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.title = doc.file?.path ?? (doc.file ? doc.name : `${doc.name} (ikke lagret til fil ennå)`);

    if (doc.kind === 'code') {
      const icon = document.createElement('span');
      icon.className = 'tab-icon';
      icon.textContent = '{ }';
      tab.append(icon);
    }
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = doc.name;
    tab.append(label);

    const dot = document.createElement('span');
    dot.className = 'tab-dirty';
    dot.textContent = '●';
    tab.append(dot, button('tab-close', '✕', 'Lukk (Ctrl+W)', () => void this.ws.closeDoc(doc)));

    tab.addEventListener('mousedown', (e) => {
      if (e.button === 0) e.preventDefault();
      if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
    });
    tab.addEventListener('click', () => this.ws.activate(doc));
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) void this.ws.closeDoc(doc);
    });
    return tab;
  }
}
