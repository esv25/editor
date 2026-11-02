/**
 * Exam practice ("Eksamensøving"): understanding ratings `{n/10}` as coloured numbers (click to pick 1–10),
 * notes `^[…]` as 💬 buttons that open small note windows, clickable links on rated
 * topics (Ctrl+click anywhere), and an overview sorted by what needs work most.
 * The text stays the source of truth; see model.ts for the syntax.
 */
import { RangeSet, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { storage } from '../../storage';
import { openModal, button, el } from '../../ui/modal';
import type { Feature } from '../types';
import { imageContext } from '../images';
import { baseNameOf, relativeImagePath } from '../util/imagePath';
import { addLinkChange, addNoteChange, noteChange, ratingChange, ratingDown, ratingUp } from './commands';
import { noteButton, pickRating, ratingChip } from './dom';
import { averageRating, examItems, examTemplate, ratingClass, findNotes, findRatings, sortTablesByWeek, topicTitle, weekStats, type ExamItem } from './model';

/** Set by the app: how to follow links. */
export const examContext = {
  openDocument: null as ((path: string) => void) | null,
  openUrl: (url: string): void => void window.open(url, '_blank', 'noopener,noreferrer'),
};

class RatingWidget extends WidgetType {
  constructor(readonly value: number) {
    super();
  }
  eq(other: RatingWidget) {
    return other.value === this.value;
  }
  toDOM() {
    return ratingChip(this.value);
  }
  ignoreEvent() {
    return false;
  }
}

class NoteWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: NoteWidget) {
    return other.text === this.text;
  }
  toDOM() {
    return noteButton(this.text);
  }
  ignoreEvent() {
    return false;
  }
}

/** Code blocks, inline code and formulas don't have ratings or notes. */
function inCode(node: SyntaxNode | null): boolean {
  for (; node; node = node.parent) if (/Code|Math|HTML|Comment/.test(node.name)) return true;
  return false;
}

function build(view: EditorView, hideMarkup: boolean): DecorationSet {
  if (!hideMarkup) return Decoration.none;
  const { state } = view;
  const tree = syntaxTree(state);
  const decos: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (!line.text.includes('/10}') && !line.text.includes('^[')) continue;
      for (const r of findRatings(line.text)) {
        if (inCode(tree.resolveInner(line.from + r.from, 1))) continue;
        decos.push(Decoration.replace({ widget: new RatingWidget(r.value) }).range(line.from + r.from, line.from + r.to));
      }
      for (const n of findNotes(line.text)) {
        if (inCode(tree.resolveInner(line.from + n.from, 1))) continue;
        decos.push(Decoration.replace({ widget: new NoteWidget(n.text) }).range(line.from + n.from, line.from + n.to));
      }
    }
  }
  return RangeSet.of(decos, true);
}

/** A small floating window showing (and editing) one note. */
class NoteWindow {
  readonly root: HTMLElement;
  private readonly area: HTMLTextAreaElement;
  constructor(
    private view: EditorView,
    public from: number,
    title: string,
    text: string,
    anchor: DOMRect,
    private onClose: (w: NoteWindow) => void,
  ) {
    this.root = el('div', 'exam-note-window');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', `Notat: ${title}`);
    const head = el('div', 'exam-note-head');
    const close = button('✕', () => this.close(), 'exam-note-close');
    close.title = 'Lukk (Esc)';
    head.append(el('strong', '', title || 'Notat'), close);
    this.area = el('textarea', 'exam-note-text');
    this.area.value = text;
    this.area.rows = 5;
    this.area.addEventListener('input', () => this.write());
    this.area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        view.focus();
      }
    });
    const foot = el('div', 'exam-note-foot');
    foot.append(
      el('span', 'exam-note-hint', 'Enter eller Esc lukker'),
      button('Slett notat', () => {
        this.area.value = '';
        this.write();
        this.close();
      }),
    );
    this.root.append(head, this.area, foot);
    document.body.append(this.root);
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    this.root.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - w - 8))}px`;
    this.root.style.top = `${anchor.bottom + h + 8 < innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - h - 6)}px`;
    this.area.focus();
    this.area.select();
  }
  private write() {
    const change = noteChange(this.view.state, this.from, this.area.value);
    if (change) this.view.dispatch({ changes: change, userEvent: 'input.examNote' });
    if (!this.area.value.trim()) this.close();
  }
  close() {
    if (!this.root.isConnected) return;
    this.root.remove();
    this.onClose(this);
  }
}

class ExamPlugin {
  decorations: DecorationSet;
  windows: NoteWindow[] = [];
  constructor(
    readonly view: EditorView,
    readonly hideMarkup: boolean,
  ) {
    this.decorations = build(view, hideMarkup);
  }
  update(u: ViewUpdate) {
    if (u.docChanged) for (const w of this.windows) w.from = u.changes.mapPos(w.from, 1);
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view, this.hideMarkup);
  }
  destroy() {
    for (const w of [...this.windows]) w.close();
  }
  openNote(from: number, anchor: DOMRect) {
    const line = this.view.state.doc.lineAt(from);
    const note = findNotes(line.text).find((n) => line.from + n.from === from);
    if (!note) return;
    this.windows.find((w) => w.from === from)?.close();
    const item = examItems(this.view.state.doc.toString().split('\n')).find((i) => i.line === line.number);
    const win = new NoteWindow(this.view, from, item?.title ?? topicTitle(line.text), note.text, anchor, (w) => {
      this.windows = this.windows.filter((x) => x !== w);
    });
    if (win.root.isConnected) this.windows.push(win);
  }
}

const pluginRef: { current: ViewPlugin<ExamPlugin> | null } = { current: null };

/** Open the note starting at document position `from` in its own little window. */
export function openNoteAt(view: EditorView, from: number, anchor: DOMRect): void {
  const plugin = pluginRef.current && view.plugin(pluginRef.current);
  plugin?.openNote(from, anchor);
}

/** Follow a Markdown link: web addresses in the browser, files as documents. */
export function followLink(dest: string): boolean {
  dest = dest.trim().replace(/^<(.*)>$/, '$1');
  if (/^(https?:|mailto:)/i.test(dest)) {
    examContext.openUrl(dest);
    return true;
  }
  if (!examContext.openDocument || /^[a-z][a-z0-9+.-]+:(?![\\/])/i.test(dest)) return false;
  let path = dest.split('#')[0];
  try {
    path = decodeURI(path);
  } catch {
    // Keep it as written.
  }
  if (!path) return false;
  if (!/^([a-zA-Z]:)?[\\/]/.test(path)) {
    const base = imageContext.baseDir();
    if (!base) return false;
    path = `${base}/${path}`;
  }
  examContext.openDocument(path.replace(/\//g, '\\'));
  return true;
}

function linkAt(view: EditorView, pos: number): string | null {
  for (let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'Link') {
      const url = node.getChild('URL');
      return url ? view.state.sliceDoc(url.from, url.to) : null;
    }
    if (node.name === 'URL' || node.name === 'Autolink') return view.state.sliceDoc(node.from, node.to).replace(/^<|>$/g, '');
  }
  return null;
}

function examPlugin(hideMarkup: boolean) {
  return ViewPlugin.define((view) => new ExamPlugin(view, hideMarkup), {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event, view) {
        if (event.button !== 0) return false;
        const target = event.target as HTMLElement;
        const chip = target.closest<HTMLElement>('.cm-exam-rating');
        if (chip) {
          // On mousedown, so the cursor doesn't jump to the line.
          event.preventDefault();
          const from = view.posAtDOM(chip);
          const line = view.state.doc.lineAt(from);
          const token = findRatings(line.text).find((r) => line.from + r.from === from);
          pickRating(chip.getBoundingClientRect(), token?.value ?? null, (value) => {
            const at = view.state.doc.lineAt(Math.min(from, view.state.doc.length));
            const now = findRatings(at.text)[0];
            if (!now) return;
            const change = value === null
              ? { from: at.from + now.from - (at.text[now.from - 1] === ' ' ? 1 : 0), to: at.from + now.to, insert: '' }
              : ratingChange(view.state, at.number, () => value);
            if (change) view.dispatch({ changes: change, userEvent: 'input.examRating' });
          });
          return true;
        }
        const note = target.closest<HTMLElement>('.cm-exam-note');
        if (note) {
          event.preventDefault();
          this.openNote(view.posAtDOM(note), note.getBoundingClientRect());
          return true;
        }
        // Links: Ctrl+click anywhere; a plain click on a rated topic's line.
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const rated = hideMarkup && findRatings(view.state.doc.lineAt(pos).text).length > 0;
        if (!(event.ctrlKey || event.metaKey || rated)) return false;
        const dest = linkAt(view, pos);
        if (!dest || !followLink(dest)) return false;
        event.preventDefault();
        return true;
      },
    },
  });
}

const fmt = (n: number) => n.toFixed(1).replace('.', ',');

/** A bar split by how many topics have each rating. */
function ratingBar(byRating: number[]): HTMLElement {
  const bar = el('div', 'exam-bar');
  byRating.forEach((n, r) => {
    if (!n) return;
    const part = el('span', `exam-bar-part ${ratingClass(r || null)}`);
    part.style.flexGrow = String(n);
    part.title = `${r ? `${r} av 10` : 'Ikke vurdert'}: ${n}`;
    bar.append(part);
  });
  return bar;
}

/** Sort every exam table with a "Uke" column by week. */
function sortByWeek(view: EditorView): boolean {
  const { doc } = view.state;
  const changed = sortTablesByWeek(doc.toString().split('\n'));
  if (!changed.size) return false;
  view.dispatch({
    changes: [...changed].map(([i, text]) => {
      const line = doc.line(i + 1);
      return { from: line.from, to: line.to, insert: text };
    }),
    userEvent: 'input.examSort',
  });
  return true;
}

type Order = 'weak' | 'week';
let order: Order = 'weak';

function overview(view: EditorView): boolean {
  const items = examItems(view.state.doc.toString().split('\n'));
  const modal = openModal('Eksamensøving – oversikt');
  modal.footer.append(button('Lukk', () => modal.close()));
  if (!items.length) {
    modal.body.append(el('p', '', 'Ingen emner har forståelse ennå. Bruk «Eksamen» for å lage en pensumtabell.'));
    return true;
  }
  const avg = averageRating(items);
  const solid = items.filter((i) => (i.rating ?? 0) >= 8).length;
  const unrated = items.filter((i) => i.rating === null).length;
  const total = weekStats(items.map((i) => ({ ...i, week: null })))[0];
  modal.body.append(el('p', 'exam-summary', `${items.length} emner · snitt ${avg === null ? '–' : fmt(avg)} av 10 · ${solid} sitter godt (8–10)` + (unrated ? ` · ${unrated} ikke vurdert` : '')), ratingBar(total.byRating));

  // Per week: how many topics, the average, and the spread of ratings.
  const weeks = weekStats(items);
  if (weeks.some((w) => w.week !== null)) {
    modal.body.append(el('h3', 'exam-heading', 'Uke for uke'));
    const table = el('div', 'exam-weeks');
    for (const w of weeks) {
      const row = el('div', 'exam-week');
      const color = ratingClass(w.average === null ? null : Math.round(w.average));
      row.append(
        el('span', 'exam-week-name', w.week === null ? 'Uten uke' : `Uke ${w.week}`),
        el('span', `exam-week-avg ${color}`, w.average === null ? '–' : fmt(w.average)),
        ratingBar(w.byRating),
        el('span', 'exam-week-count', `${w.count} ${w.count === 1 ? 'emne' : 'emner'}`),
      );
      table.append(row);
    }
    modal.body.append(table);
  }

  // The topics, weakest first or week by week.
  const head = el('div', 'exam-list-head');
  const toggle = (o: Order, label: string) => {
    const b = button(label, () => {
      order = o;
      draw();
    }, 'exam-toggle');
    return b;
  };
  const weak = toggle('weak', 'Svakest først');
  const byWeek = toggle('week', 'Etter uke');
  head.append(el('span', 'exam-hint', 'Klikk et emne for å gå dit:'), weak, byWeek);
  const list = el('div', 'exam-list');
  modal.body.append(head, list);

  const sortItems = (a: ExamItem, b: ExamItem) =>
    order === 'week'
      ? (a.week ?? Infinity) - (b.week ?? Infinity) || a.line - b.line
      : (a.rating ?? 0) - (b.rating ?? 0) || a.line - b.line; // not rated counts as weakest
  const draw = () => {
    weak.classList.toggle('active', order === 'weak');
    byWeek.classList.toggle('active', order === 'week');
    list.replaceChildren();
    for (const item of [...items].sort(sortItems)) {
      const row = button('', () => {
        modal.close();
        const line = view.state.doc.line(item.line);
        view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
        view.focus();
      }, 'exam-row');
      row.append(
        el('span', 'exam-row-week', item.week === null ? '' : `Uke ${item.week}`),
        el('span', `exam-row-rating ${ratingClass(item.rating)}`, item.rating === null ? '–' : `${item.rating}/10`),
        el('span', 'exam-row-title', item.title),
        el('span', 'exam-row-section', item.section),
      );
      list.append(row);
    }
  };
  draw();

  if (sortTablesByWeek(view.state.doc.toString().split('\n')).size) {
    modal.footer.prepend(button('Sorter tabellene etter uke', () => {
      sortByWeek(view);
      modal.close();
    }));
  }
  return true;
}

function insertTemplate(view: EditorView): boolean {
  const { state } = view;
  const empty = state.doc.toString().trim() === '';
  const line = state.doc.lineAt(state.selection.main.head);
  const from = empty ? 0 : line.to;
  const insert = empty ? examTemplate : (line.length ? '\n\n' : '\n') + examTemplate;
  const fag = from + insert.indexOf('Fag');
  view.dispatch({
    changes: { from, to: empty ? state.doc.length : from, insert },
    selection: { anchor: fag, head: fag + 3 },
    scrollIntoView: true,
  });
  return true;
}

function currentLine(view: EditorView) {
  return view.state.doc.lineAt(view.state.selection.main.head);
}

function addOrOpenNote(view: EditorView): boolean {
  const line = currentLine(view);
  const existing = findNotes(line.text)[0];
  let from: number;
  if (existing) {
    from = line.from + existing.from;
  } else {
    const added = addNoteChange(view.state, line.number);
    if (!added) return false;
    view.dispatch({ changes: added.change, userEvent: 'input.examNote' });
    from = added.at;
  }
  const coords = view.coordsAtPos(from) ?? view.coordsAtPos(line.from);
  const rect = coords ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) : new DOMRect(100, 100, 0, 0);
  openNoteAt(view, from, rect);
  return true;
}

function addLinkToFile(view: EditorView): boolean {
  const line = currentLine(view);
  if (!storage.pickFile) {
    view.dispatch({ changes: addLinkChange(view.state, line.number, 'Lenke', 'https://'), userEvent: 'input' });
    return true;
  }
  const lineNo = line.number;
  void storage
    .pickFile({ title: 'Lenk til dokument', filters: [{ name: 'Dokumenter', extensions: ['md', 'txt', 'pdf', 'docx', 'pptx', 'py', 'js', 'ts', 'java'] }] })
    .then((path) => {
      if (!path || lineNo > view.state.doc.lines) return;
      const name = baseNameOf(path).replace(/\.[^.]+$/, '');
      view.dispatch({ changes: addLinkChange(view.state, lineNo, name, relativeImagePath(imageContext.baseDir(), path)), userEvent: 'input' });
    });
  return true;
}

export const exam: Feature = {
  id: 'exam',
  extension: (settings) => (pluginRef.current = examPlugin(settings.hideMarkup)),
  commands: [
    { id: 'exam.new', name: 'Ny eksamensøving (pensumliste)', label: 'Eksamen', run: insertTemplate },
    { id: 'exam.overview', name: 'Eksamensøving: oversikt over forståelse', label: 'Oversikt', run: overview },
    { id: 'exam.sortWeek', name: 'Sorter eksamenstabellene etter uke', run: sortByWeek },
    { id: 'exam.rateUp', name: 'Forståelse opp', key: 'Alt-+', run: (v) => ratingUp(v) },
    { id: 'exam.rateDown', name: 'Forståelse ned', key: 'Alt--', run: (v) => ratingDown(v) },
    { id: 'exam.note', name: 'Notat på emnet (åpne/legg til)', key: 'Alt-n', run: addOrOpenNote },
    { id: 'exam.link', name: 'Lenk emnet til et dokument', run: addLinkToFile },
  ],
};
