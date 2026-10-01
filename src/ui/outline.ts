/**
 * Outline sidebar: lists the document's headings; clicking jumps there.
 */
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { docKind } from '../editor/createEditor';

export interface HeadingEntry {
  level: number;
  text: string;
  from: number;
}

/** All ATX/setext headings in the document, in order. */
export function extractHeadings(state: EditorState): HeadingEntry[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const headings: HeadingEntry[] = [];
  tree.iterate({
    enter(node) {
      const m = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
      if (!m) return;
      const line = state.doc.lineAt(node.from);
      const text = line.text
        .replace(/^#{1,6}\s*/, '')
        .replace(/\s+#+\s*$/, '')
        .replace(/(\*\*|__|\*|_|`|~~)/g, '')
        .trim();
      headings.push({ level: +m[1], text: text || '(tom overskrift)', from: node.from });
      return false;
    },
  });
  return headings;
}

export class OutlinePanel {
  private headings: HeadingEntry[] = [];
  private list = document.createElement('ul');
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private container: HTMLElement,
    private getView: () => EditorView,
  ) {
    const title = document.createElement('h2');
    title.textContent = 'Disposisjon';
    container.replaceChildren(title, this.list);
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-pos]');
      if (item) this.jumpTo(Number(item.dataset.pos));
    });
  }

  set visible(visible: boolean) {
    this.container.hidden = !visible;
    if (visible) this.refresh(this.getView().state);
  }

  get visible(): boolean {
    return !this.container.hidden;
  }

  /** Re-read headings soon (debounced – call on every doc change). */
  scheduleRefresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(this.getView().state), 250);
  }

  refresh(state: EditorState): void {
    if (!this.visible) return;
    const isCode = state.facet(docKind) === 'code';
    this.headings = isCode ? [] : extractHeadings(state);
    this.list.replaceChildren();
    if (this.headings.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = isCode ? 'Kodefiler har ingen disposisjon' : 'Ingen overskrifter ennå';
      this.list.append(empty);
      return;
    }
    for (const h of this.headings) {
      const li = document.createElement('li');
      li.className = `level-${h.level}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.pos = String(h.from);
      button.textContent = h.text;
      button.title = h.text;
      li.append(button);
      this.list.append(li);
    }
    this.highlightActive(state);
  }

  /** Mark the heading the cursor is under. */
  highlightActive(state: EditorState): void {
    if (!this.visible) return;
    const head = state.selection.main.head;
    let active = -1;
    this.headings.forEach((h, i) => {
      if (h.from <= head) active = i;
    });
    this.list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === active));
  }

  private jumpTo(pos: number): void {
    const view = this.getView();
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 48 }),
    });
    view.focus();
  }
}
