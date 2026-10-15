/**
 * The board view («tavle»): shows the active board document in place of the
 * editor. Cards are small Markdown editors (the same CodeMirror features as
 * notes: formulas, lists, code, images …) placed freely on an endless
 * surface; arrows connect them and areas gather them.
 *
 * The board (model.ts) is the truth; every change is written straight to the
 * document as JSON Canvas, so saving, autosave and the session work as for
 * any other file. Undo for the board itself (move, add, delete, connect) is
 * snapshots (History); while a card is being written in, Ctrl+Z is the card's own.
 */
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { EditorDocument } from '../app/document';
import { History } from '../diagram/history';
import { createMarkdownState, refreshForSettings } from '../editor/createEditor';
import { dirOf } from '../features/util/imagePath';
import { getSettings, onSettingsChange } from '../settings';
import { showContextMenu, type MenuItem } from '../ui/contextMenu';
import {
  CARD_WIDTH,
  NORMAL,
  addNode,
  boardToMarkdown,
  boundsOf,
  connect,
  edgeById,
  edgeEnds,
  edgeGeometry,
  emptyBoard,
  facingSide,
  isCard,
  isGroup,
  moveNodes,
  newId,
  nodeById,
  overlaps,
  parseBoard,
  placeNextTo,
  readingOrder,
  removeEdges,
  removeNodes,
  reverseEdge,
  serializeBoard,
  sidePoint,
  snap,
  updateEdge,
  updateNode,
  type Board,
  type BoardNode,
  type Direction,
  type Rect,
} from './model';

export interface BoardHost {
  /** The board changed: write it to its document (and remember the session). */
  write(doc: EditorDocument, text: string): void;
  /** Editing, selection or undo changed: refresh the toolbars. */
  changed(): void;
  /** Open a file in a tab (file cards). */
  openPath(path: string): void;
  /** «Lag dokument av tavla»: a new note with this text. */
  createDocument(markdown: string): void;
}

/** The preset colours of JSON Canvas (Obsidian). */
export const BOARD_COLORS: { id: string; name: string }[] = [
  { id: '1', name: 'Rød' },
  { id: '2', name: 'Oransje' },
  { id: '3', name: 'Gul' },
  { id: '4', name: 'Grønn' },
  { id: '5', name: 'Turkis' },
  { id: '6', name: 'Lilla' },
];

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const MIN_CARD_WIDTH = 120;
const MIN_GROUP = { width: 160, height: 100 };
const SVG_NS = 'http://www.w3.org/2000/svg';
const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];
const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const icon = (body: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  color: icon('<circle cx="12" cy="12" r="7"/>'),
  connect: icon('<path d="M5 12h12M13 7l5 5-5 5"/>'),
  remove: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>', 18),
};

/** CSS colour for a node's or arrow's `color` ("1"–"6" or "#rgb"/"#rrggbb"; anything else is ignored). */
function colorValue(color: string | undefined): string | null {
  if (!color) return null;
  if (/^[1-6]$/.test(color)) return `var(--board-${color})`;
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color : null;
}

interface NodeDom {
  el: HTMLElement;
  type: string;
  /** Text cards: the card's own editor. */
  view?: EditorView;
  /** Areas: the name. */
  label?: HTMLElement;
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; pan: { x: number; y: number }; moved: boolean; click: 'empty' | 'none' }
  | { kind: 'move'; startX: number; startY: number; ids: string[]; before: Board; moved: boolean; anchor: Rect; target: string }
  | { kind: 'resize'; startX: number; startY: number; id: string; before: Board; moved: boolean; orig: Rect }
  | { kind: 'marquee'; startX: number; startY: number; moved: boolean; base: Set<string> };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  return e;
};

export class BoardView {
  private doc: EditorDocument | null = null;
  private board: Board = emptyBoard();
  /** Set when the file couldn't be read: shown, never written. */
  private broken: string | null = null;

  private world = el('div', 'board-world');
  private edgeLayer = document.createElementNS(SVG_NS, 'svg');
  private chrome = el('div', 'board-chrome');
  private hintEl = el('div', 'board-hint');
  private zoomLabel = el('button', 'board-zoom-label');
  private marqueeEl = el('div', 'board-marquee');
  private messageEl = el('div', 'board-message');

  private nodes = new Map<string, NodeDom>();
  /** Rendered heights of cards (they grow with their text). */
  private measured = new Map<string, number>();
  private selected = new Set<string>();
  private selectedEdges = new Set<string>();
  /** The card being written in. */
  private editing: string | null = null;
  /** The board when writing in the card started (one undo step for what's written). */
  private editStart: Board | null = null;
  /** A card made just now: if it's left empty, it goes away again. */
  private fresh: { id: string; before: Board } | null = null;
  /** Making an arrow from this node: the next click picks where it goes. */
  private connecting: string | null = null;
  private gesture: Gesture | null = null;
  /** Last pointer position on the board (for the arrow being made). */
  private pointer: { x: number; y: number } | null = null;
  /** Cards whose next measured height is stored (after their width changed). */
  private heightFollows = new Set<string>();
  /** A name or arrow text being typed. */
  private textInput: HTMLInputElement | null = null;

  private pan = { x: 0, y: 0 };
  private zoom = 1;
  private viewports = new Map<string, { pan: { x: number; y: number }; zoom: number }>();
  private histories = new Map<string, History<Board>>();
  private resizeObserver: ResizeObserver;

  constructor(
    private root: HTMLElement,
    private host: BoardHost,
  ) {
    root.tabIndex = 0;
    root.classList.add('board');
    this.edgeLayer.classList.add('board-edges');
    this.world.append(this.edgeLayer, this.chrome);
    const zoomBar = el('div', 'board-zoom');
    const zoomButton = (text: string, title: string, action: () => void) => {
      const b = el('button', 'board-zoom-button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', action);
      return b;
    };
    this.zoomLabel.type = 'button';
    this.zoomLabel.title = 'Tilbake til 100 %';
    this.zoomLabel.addEventListener('mousedown', (e) => e.preventDefault());
    this.zoomLabel.addEventListener('click', () => this.zoomAround(1 / this.zoom));
    zoomBar.append(
      zoomButton('−', 'Zoom ut (Ctrl+hjul)', () => this.zoomAround(1 / 1.25)),
      this.zoomLabel,
      zoomButton('+', 'Zoom inn (Ctrl+hjul)', () => this.zoomAround(1.25)),
      zoomButton('Vis alt', 'Vis hele tavla (Home)', () => this.fit()),
    );
    this.marqueeEl.hidden = true;
    this.messageEl.hidden = true;
    root.append(this.world, this.marqueeEl, this.messageEl, zoomBar, this.hintEl);

    root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    root.addEventListener('pointermove', (e) => this.pointerMove(e));
    root.addEventListener('pointerup', (e) => this.pointerUp(e));
    root.addEventListener('pointercancel', () => this.cancelGesture());
    root.addEventListener('dblclick', (e) => this.doubleClick(e));
    root.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    root.addEventListener('keydown', (e) => this.keyDown(e));
    root.addEventListener('contextmenu', (e) => this.contextMenu(e));

    this.resizeObserver = new ResizeObserver((entries) => this.measuredResize(entries));
    new ResizeObserver(() => this.applyTransform()).observe(root);
    onSettingsChange(() => {
      for (const dom of this.nodes.values()) dom.view?.dispatch({ effects: refreshForSettings(dom.view.state) });
    });
  }

  // --- Showing a document ------------------------------------------------------------------

  get activeDoc(): EditorDocument | null {
    return this.doc;
  }

  /** Show a board document (called whenever the active document changes). */
  show(doc: EditorDocument): void {
    if (this.doc === doc) return this.focus();
    this.hide();
    this.doc = doc;
    this.root.hidden = false;
    try {
      this.board = parseBoard(doc.content);
      this.broken = null;
    } catch (err) {
      this.board = emptyBoard();
      this.broken = `Kunne ikke lese tavla: ${err instanceof Error ? err.message : String(err)}. Fila er ikke endret.`;
    }
    this.messageEl.hidden = !this.broken;
    this.messageEl.textContent = this.broken ?? '';
    const saved = this.viewports.get(doc.id);
    this.render();
    if (saved) {
      this.pan = { ...saved.pan };
      this.zoom = saved.zoom;
      this.applyTransform();
    } else requestAnimationFrame(() => this.fit(1));
    this.focus();
    this.host.changed();
  }

  /** Another kind of document became active (or this one was closed). */
  hide(): void {
    if (!this.doc) return;
    this.stopEditing();
    this.viewports.set(this.doc.id, { pan: { ...this.pan }, zoom: this.zoom });
    for (const dom of this.nodes.values()) this.dropNode(dom);
    this.nodes.clear();
    this.measured.clear();
    this.selected.clear();
    this.selectedEdges.clear();
    this.connecting = null;
    this.gesture = null;
    this.closeTextInput(false);
    this.doc = null;
    this.root.hidden = true;
  }

  focus(): void {
    if (this.editing) this.nodes.get(this.editing)?.view?.focus();
    else this.root.focus({ preventScroll: true });
  }

  private get history(): History<Board> {
    const id = this.doc?.id ?? '';
    let h = this.histories.get(id);
    if (!h) this.histories.set(id, (h = new History<Board>()));
    return h;
  }

  /** The card editor that typing and the formatting buttons go to, if one is being written in. */
  get editingView(): EditorView | null {
    return (this.editing && this.nodes.get(this.editing)?.view) || null;
  }

  /**
   * For the formatting toolbar and the math panel: the card being written in,
   * or else the selected card (which then starts being written in).
   */
  viewForFormatting(): EditorView | null {
    if (this.editingView) return this.editingView;
    const only = this.selected.size === 1 ? [...this.selected][0] : null;
    const view = only ? this.nodes.get(only)?.view : undefined;
    if (!view || !only) return null;
    this.editCard(only);
    return view;
  }

  get canUndo(): boolean {
    return !!this.doc && this.history.canUndo;
  }

  get canRedo(): boolean {
    return !!this.doc && this.history.canRedo;
  }

  // --- Changing the board ------------------------------------------------------------------

  /** Write the board to its document. */
  private write(): void {
    if (this.doc && !this.broken) this.host.write(this.doc, serializeBoard(this.board));
  }

  /** A change the user made (one undo step). */
  private commit(next: Board, before = this.board): void {
    if (this.broken || next === before) return;
    this.checkpointText(before);
    this.history.record(before);
    this.board = next;
    this.forgetMissing();
    this.write();
    this.render();
    this.host.changed();
  }

  /** What's been written in the card so far becomes its own undo step, before another change. */
  private checkpointText(current: Board): void {
    if (!this.editing || !this.editStart || this.fresh?.id === this.editing) return;
    const id = this.editing;
    if (nodeById(this.editStart, id)?.text !== nodeById(current, id)?.text) this.history.record(this.editStart);
    this.editStart = current;
  }

  undo(): boolean {
    return this.step(true);
  }

  redo(): boolean {
    return this.step(false);
  }

  private step(back: boolean): boolean {
    if (!this.doc || this.broken) return false;
    this.stopEditing();
    const next = back ? this.history.undo(this.board) : this.history.redo(this.board);
    if (!next) return true;
    this.board = next;
    this.forgetMissing();
    this.write();
    this.render();
    this.host.changed();
    return true;
  }

  /** Drop selections of things that are gone. */
  private forgetMissing(): void {
    for (const id of this.selected) if (!nodeById(this.board, id)) this.selected.delete(id);
    for (const id of this.selectedEdges) if (!edgeById(this.board, id)) this.selectedEdges.delete(id);
    if (this.connecting && !nodeById(this.board, this.connecting)) this.connecting = null;
  }

  /** The board with cards at their drawn height (for placing and arrows). */
  private laidOut(): Board {
    return { ...this.board, nodes: this.board.nodes.map((n) => ({ ...n, ...this.rectOf(n) })) };
  }

  private rectOf(node: BoardNode): Rect {
    const height = isCard(node) ? (this.measured.get(node.id) ?? node.height) : node.height;
    return { x: node.x, y: node.y, width: node.width, height };
  }

  /** A new card at a point on the board, written in at once; optionally with an arrow from another node. */
  addCardAt(x: number, y: number, from?: string): void {
    if (!this.doc || this.broken) return;
    const grid = getSettings().diagram.grid;
    const parent = from ? nodeById(this.board, from) : undefined;
    const card: BoardNode = { id: newId(), type: 'text', text: '', x: snap(x, grid), y: snap(y, grid), width: CARD_WIDTH, height: 60 };
    if (parent?.color && isCard(parent)) card.color = parent.color;
    this.addCard(card, from);
  }

  /** «Nytt kort»: next to the selected card, or in the middle of what's shown. */
  addCard(card?: BoardNode, from?: string): void {
    if (!this.doc || this.broken) return;
    if (!card) {
      const sel = this.singleSelected();
      if (sel && !isGroup(sel)) return this.addNeighbor(sel.id, 'right');
      const c = this.viewCenter();
      return this.addCardAt(c.x - CARD_WIDTH / 2, c.y - 30);
    }
    this.stopEditing();
    const before = this.board;
    let next = addNode(this.board, card);
    if (from) next = connect(next, from, card.id)?.board ?? next;
    this.commit(next, before);
    this.fresh = { id: card.id, before };
    this.select([card.id]);
    this.editCard(card.id);
    this.ensureVisible(card.id);
  }

  /** A new card next to a node, with an arrow to it (Ctrl+arrow, the + buttons). */
  addNeighbor(fromId: string, direction: Direction): void {
    const from = nodeById(this.board, fromId);
    if (!from || !this.doc || this.broken) return;
    const grid = getSettings().diagram.grid;
    const r = placeNextTo(this.laidOut(), this.rectOf(from), direction);
    const card: BoardNode = { id: newId(), type: 'text', text: '', x: snap(r.x, grid), y: snap(r.y, grid), width: r.width, height: r.height };
    if (from.color && isCard(from)) card.color = from.color;
    this.addCard(card, fromId);
  }

  /** «Nytt område»: around the selected cards, or in the middle of what's shown. Its name is typed at once. */
  addGroup(): void {
    if (!this.doc || this.broken) return;
    this.stopEditing();
    const grid = getSettings().diagram.grid;
    const around = boundsOf([...this.selected].map((id) => nodeById(this.board, id)).filter((n): n is BoardNode => !!n).map((n) => this.rectOf(n)));
    const c = this.viewCenter();
    const r = around
      ? { x: around.x - 40, y: around.y - 40, width: around.width + 80, height: around.height + 80 }
      : { x: c.x - 300, y: c.y - 200, width: 600, height: 400 };
    const group: BoardNode = { id: newId(), type: 'group', label: 'Område', x: snap(r.x, grid), y: snap(r.y, grid), width: snap(r.width, grid), height: snap(r.height, grid) };
    this.commit(addNode(this.board, group));
    this.select([group.id]);
    this.renameGroup(group.id);
  }

  /** «Koble»: an arrow from the selected node to the one clicked next. */
  startConnecting(fromId?: string): void {
    const id = fromId ?? this.singleSelected()?.id;
    if (!id) return;
    this.stopEditing();
    this.connecting = id;
    this.select([id]);
    this.root.focus({ preventScroll: true });
    this.renderChrome();
  }

  private finishConnecting(toId: string): void {
    const from = this.connecting;
    this.connecting = null;
    if (!from || from === toId) return this.renderChrome();
    const result = connect(this.board, from, toId);
    if (result) {
      this.commit(result.board);
      this.selectedEdges = new Set([result.edge]);
      this.selected.clear();
    }
    this.render();
  }

  private deleteSelection(): void {
    if (!this.selected.size && !this.selectedEdges.size) return;
    let next = removeEdges(this.board, this.selectedEdges);
    next = removeNodes(next, this.selected);
    this.selected.clear();
    this.selectedEdges.clear();
    this.commit(next);
  }

  private setColor(ids: string[], edgeIds: string[], color: string | undefined): void {
    let next = this.board;
    for (const id of ids) next = updateNode(next, id, { color });
    for (const id of edgeIds) next = updateEdge(next, id, { color });
    this.commit(next);
  }

  /** «Lag dokument av tavla». */
  toDocument(): void {
    if (!this.doc || this.broken) return;
    this.stopEditing();
    this.host.createDocument(boardToMarkdown(this.board));
  }

  // --- Writing in cards --------------------------------------------------------------------

  /** Start writing in a card (cursor at the end, or where clicked). */
  editCard(id: string, at: 'end' | 'keep' = 'end'): void {
    const view = this.nodes.get(id)?.view;
    if (!view) return;
    if (at === 'end') view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  }

  private startEditing(id: string): void {
    if (this.editing === id) return;
    if (this.editing) this.finishEditing(this.editing);
    this.editing = id;
    this.editStart = this.board;
    this.connecting = null;
    if (!this.selected.has(id) || this.selected.size > 1 || this.selectedEdges.size) this.select([id]);
    else this.renderChrome();
    this.host.changed();
  }

  private finishEditing(id: string): void {
    if (this.editing !== id) return;
    this.editing = null;
    const card = nodeById(this.board, id);
    if (card && this.fresh?.id === id && !(card.text ?? '').trim()) {
      // Nothing was written in the new card: as if it was never made.
      this.history.forget(this.fresh.before);
      this.board = this.fresh.before;
      this.forgetMissing();
      this.write();
    } else if (card && this.editStart && this.fresh?.id !== id && nodeById(this.editStart, id)?.text !== card.text) {
      this.history.record(this.editStart);
    }
    this.fresh = null;
    this.editStart = null;
    this.render();
    this.host.changed();
  }

  /** Stop writing in the card (Esc), keeping it selected. */
  stopEditing(): void {
    if (!this.editing) return;
    const id = this.editing;
    // Asked before finishing: an empty new card is removed, and the focus with it.
    const hadFocus = this.root.contains(document.activeElement);
    this.finishEditing(id);
    if (hadFocus) this.root.focus({ preventScroll: true });
  }

  private cardTextChanged(id: string, text: string): void {
    const node = nodeById(this.board, id);
    if (!node || node.text === text) return;
    this.board = updateNode(this.board, id, { text });
    this.write();
  }

  private cardState(id: string, text: string) {
    return createMarkdownState(text, [
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.cardTextChanged(id, u.state.doc.toString());
      }),
      Prec.low(
        keymap.of([
          { key: 'Escape', run: () => (this.stopEditing(), true) },
          // Leaving the card with the arrow keys at its edges isn't wanted; Tab moves on in lists.
        ]),
      ),
    ]);
  }

  // --- Drawing -----------------------------------------------------------------------------

  private render(): void {
    const seen = new Set<string>();
    this.board.nodes.forEach((node, index) => {
      seen.add(node.id);
      let dom = this.nodes.get(node.id);
      if (dom && dom.type !== node.type) {
        this.dropNode(dom);
        dom = undefined;
      }
      if (!dom) {
        dom = this.createNode(node);
        this.nodes.set(node.id, dom);
        this.world.append(dom.el);
        if (isCard(node)) this.resizeObserver.observe(dom.el);
      }
      this.updateNode(dom, node, index);
    });
    for (const [id, dom] of this.nodes) {
      if (seen.has(id)) continue;
      this.dropNode(dom);
      this.nodes.delete(id);
      this.measured.delete(id);
    }
    this.renderEdges();
    this.renderChrome();
    this.applyTransform();
  }

  private dropNode(dom: NodeDom): void {
    this.resizeObserver.unobserve(dom.el);
    dom.view?.destroy();
    dom.el.remove();
  }

  private createNode(node: BoardNode): NodeDom {
    const id = node.id;
    if (isGroup(node)) {
      const box = el('div', 'board-group');
      const label = el('div', 'board-group-label');
      const resize = el('div', 'board-resize');
      resize.title = 'Dra for å endre størrelsen';
      box.append(label, resize);
      box.dataset.id = id;
      return { el: box, type: node.type, label };
    }
    const card = el('div', 'board-card');
    card.dataset.id = id;
    const bar = el('div', 'board-card-bar');
    bar.title = 'Dra for å flytte · høyreklikk for flere valg';
    const barButton = (cls: string, svg: string, title: string, action: (e: MouseEvent) => void) => {
      const b = el('button', `board-bar-button ${cls}`);
      b.type = 'button';
      b.innerHTML = svg;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        action(e);
      });
      return b;
    };
    bar.append(
      barButton('board-color-button', ICONS.color, 'Farge', (e) => showContextMenu(e, this.colorMenu([id], []))),
      barButton('', ICONS.connect, 'Pil til et annet kort (klikk så på kortet)', () => this.startConnecting(id)),
      barButton('', ICONS.remove, 'Slett kortet (Delete)', () => {
        this.select([id]);
        this.stopEditing();
        this.deleteSelection();
      }),
    );
    const body = el('div', 'board-card-body');
    const resize = el('div', 'board-resize');
    resize.title = 'Dra for å gjøre kortet bredere eller smalere';
    card.append(bar, body, resize);
    const dom: NodeDom = { el: card, type: node.type };
    if (isCard(node)) {
      dom.view = new EditorView({ parent: body, state: this.cardState(id, node.text ?? '') });
      card.addEventListener('focusin', () => this.startEditing(id));
      card.addEventListener('focusout', (e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && card.contains(next)) return;
        // Wait: a click on a menu or the toolbar may hand the focus back.
        setTimeout(() => {
          if (!card.contains(document.activeElement)) this.finishEditing(id);
        });
      });
    } else {
      // File, link or a kind of node this editor doesn't know: shown, kept, not edited here.
      body.classList.add('board-card-other');
      const text = node.type === 'file' ? String(node.file ?? '') : node.type === 'link' ? String(node.url ?? '') : `(${node.type})`;
      body.textContent = node.type === 'file' ? `📄 ${text.split(/[\\/]/).pop()}` : text;
      body.title = node.type === 'file' ? `${text}\nDobbeltklikk for å åpne` : text;
    }
    return dom;
  }

  private updateNode(dom: NodeDom, node: BoardNode, index: number): void {
    const s = dom.el.style;
    s.left = `${node.x}px`;
    s.top = `${node.y}px`;
    s.width = `${node.width}px`;
    // Areas lie under the arrows, cards over them.
    s.zIndex = String(isGroup(node) ? index : 1000 + index);
    const color = colorValue(node.color);
    if (color) s.setProperty('--node-color', color);
    else s.removeProperty('--node-color');
    dom.el.classList.toggle('colored', !!color);
    dom.el.classList.toggle('selected', this.selected.has(node.id));
    dom.el.classList.toggle('editing', this.editing === node.id);
    dom.el.classList.toggle('connect-target', !!this.connecting && this.connecting !== node.id);
    if (isGroup(node)) {
      s.height = `${node.height}px`;
      if (dom.label && !dom.label.contains(this.textInput)) dom.label.textContent = node.label?.trim() || 'Område';
    } else if (!isCard(node)) {
      s.height = `${node.height}px`;
    }
    if (dom.view) {
      const text = node.text ?? '';
      // Undo/redo of the board: the card shows the restored text.
      if (dom.view.state.doc.toString() !== text) {
        if (this.editing === node.id) dom.view.dispatch({ changes: { from: 0, to: dom.view.state.doc.length, insert: text } });
        else dom.view.setState(this.cardState(node.id, text));
      }
    }
  }

  private renderEdges(): void {
    const svg = this.edgeLayer;
    svg.replaceChildren();
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      return e;
    };
    const arrowHead = (tip: { x: number; y: number }, dir: { x: number; y: number }, cls: string) => {
      const size = 12;
      const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
      const perp = { x: -dir.y * size * 0.5, y: dir.x * size * 0.5 };
      return make('polygon', {
        class: cls,
        points: `${tip.x},${tip.y} ${back.x + perp.x},${back.y + perp.y} ${back.x - perp.x},${back.y - perp.y}`,
      });
    };
    for (const edge of this.board.edges) {
      const a = nodeById(this.board, edge.fromNode);
      const b = nodeById(this.board, edge.toNode);
      if (!a || !b) continue;
      const g = edgeGeometry(this.rectOf(a), this.rectOf(b), edge.fromSide, edge.toSide);
      const group = make('g', { class: `board-edge${this.selectedEdges.has(edge.id) ? ' selected' : ''}` });
      group.dataset.edge = edge.id;
      const color = colorValue(edge.color);
      if (color) group.style.setProperty('--edge-color', color);
      group.append(make('path', { d: g.d, class: 'board-edge-hit' }), make('path', { d: g.d, class: 'board-edge-line' }));
      const ends = edgeEnds(edge);
      // The curve leaves and enters straight out of the sides, so the heads point along the sides' normals.
      if (ends.to === 'arrow') {
        const n = NORMAL[g.toSide];
        group.append(arrowHead(g.to, { x: -n.x, y: -n.y }, 'board-edge-head'));
      }
      if (ends.from === 'arrow') {
        const n = NORMAL[g.fromSide];
        group.append(arrowHead(g.from, { x: -n.x, y: -n.y }, 'board-edge-head'));
      }
      if (edge.label?.trim()) {
        const text = make('text', { x: g.mid.x, y: g.mid.y, class: 'board-edge-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        text.textContent = edge.label;
        group.append(text);
      }
      svg.append(group);
    }
    // The arrow being made follows the pointer.
    const from = this.connecting ? nodeById(this.board, this.connecting) : undefined;
    if (from && this.pointer) {
      const r = this.rectOf(from);
      const p = this.pointer;
      const start = sidePoint(r, facingSide(r, { x: p.x, y: p.y, width: 0, height: 0 }));
      svg.append(make('path', { d: `M ${start.x} ${start.y} L ${p.x} ${p.y}`, class: 'board-edge-preview' }));
    }
  }

  /** The + buttons around the one selected card. */
  private renderChrome(): void {
    for (const [id, dom] of this.nodes) {
      dom.el.classList.toggle('selected', this.selected.has(id));
      dom.el.classList.toggle('editing', this.editing === id);
      dom.el.classList.toggle('connect-target', !!this.connecting && this.connecting !== id);
    }
    for (const g of this.edgeLayer.querySelectorAll<SVGGElement>('.board-edge')) {
      g.classList.toggle('selected', this.selectedEdges.has(g.dataset.edge ?? ''));
    }
    this.chrome.replaceChildren();
    const node = this.singleSelected();
    if (node && isCard(node) && !this.connecting && !this.gesture?.moved) {
      const r = this.rectOf(node);
      for (const direction of DIRECTIONS) {
        const b = el('button', `board-add board-add-${direction}`);
        b.type = 'button';
        b.innerHTML = ICONS.plus;
        b.title = {
          up: 'Nytt kort over, med pil (Ctrl+↑)',
          down: 'Nytt kort under, med pil (Ctrl+↓)',
          left: 'Nytt kort til venstre, med pil (Ctrl+←)',
          right: 'Nytt kort til høyre, med pil (Ctrl+→)',
        }[direction];
        const side = { up: 'top', down: 'bottom', left: 'left', right: 'right' } as const;
        const p = sidePoint(r, side[direction]);
        const n = NORMAL[side[direction]];
        b.style.left = `${p.x + n.x * 22}px`;
        b.style.top = `${p.y + n.y * 22}px`;
        b.style.setProperty('--inv-zoom', String(1 / this.zoom));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addNeighbor(node.id, direction);
        });
        this.chrome.append(b);
      }
    }
    this.updateHint();
  }

  private updateHint(): void {
    let hint: string;
    if (this.broken) hint = '';
    else if (this.connecting) hint = 'Klikk på kortet pila skal gå til – eller på et tomt sted for et nytt kort. Esc avbryter.';
    else if (this.editing) hint = 'Esc: ferdig med kortet · + på sidene: nytt kort med pil · dra i stripa øverst for å flytte kortet';
    else if (this.selectedEdges.size) hint = 'Enter: skriv tekst på pila · høyreklikk: snu, farge, pilspisser · Delete sletter';
    else if (this.selected.size) {
      const node = this.singleSelected();
      hint =
        node && isGroup(node)
          ? 'Dra i navnet for å flytte området med det som er inni · Enter gir nytt navn · Delete sletter området (kortene blir)'
          : 'Enter: skriv i kortet · Ctrl+pil eller +: nytt kort med pil · piltaster flytter · Delete sletter';
    } else if (!this.board.nodes.length) hint = 'Dobbeltklikk hvor som helst (eller trykk Enter) for å skrive et kort. Start gjerne flere steder!';
    else hint = 'Dobbeltklikk på et tomt sted for et nytt kort · dra i tomrommet for å flytte tavla · Ctrl+hjul zoomer · Shift+dra markerer';
    this.hintEl.textContent = hint;
    this.hintEl.hidden = !hint;
  }

  private applyTransform(): void {
    this.world.style.transform = `translate(${-this.pan.x * this.zoom}px, ${-this.pan.y * this.zoom}px) scale(${this.zoom})`;
    const grid = getSettings().diagram.grid * this.zoom;
    this.root.style.setProperty('--grid-size', `${grid}px`);
    this.root.style.setProperty('--grid-x', `${-this.pan.x * this.zoom}px`);
    this.root.style.setProperty('--grid-y', `${-this.pan.y * this.zoom}px`);
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)} %`;
    for (const b of this.chrome.children) (b as HTMLElement).style.setProperty('--inv-zoom', String(1 / this.zoom));
  }

  private measuredResize(entries: ResizeObserverEntry[]): void {
    let changed = false;
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      const id = target.dataset.id;
      if (!id || !target.isConnected) continue;
      const height = target.offsetHeight;
      if (this.measured.get(id) === height) continue;
      this.measured.set(id, height);
      changed = true;
      // The stored height follows the text while it's being written, and after the width
      // changed (so other programs show the card right). Not otherwise: opening a board changes nothing.
      const node = nodeById(this.board, id);
      const follows = this.editing === id || this.heightFollows.delete(id);
      if (node && follows && !this.gesture && Math.abs(node.height - height) > 1) {
        this.board = updateNode(this.board, id, { height });
        this.write();
      }
    }
    if (changed) {
      this.renderEdges();
      this.renderChrome();
    }
  }

  // --- Viewport ----------------------------------------------------------------------------

  private toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.zoom + this.pan.x, y: (clientY - rect.top) / this.zoom + this.pan.y };
  }

  private viewCenter(): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return this.toBoard(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private zoomAround(factor: number, clientX?: number, clientY?: number): void {
    const rect = this.root.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    const p = this.toBoard(cx, cy);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.pan = { x: p.x - (cx - rect.left) / this.zoom, y: p.y - (cy - rect.top) / this.zoom };
    this.applyTransform();
  }

  /** Show the whole board (at most at `maxZoom`). */
  fit(maxZoom = 1): void {
    const rect = this.root.getBoundingClientRect();
    const bounds = boundsOf(this.board.nodes.map((n) => this.rectOf(n)));
    if (!bounds || !rect.width) {
      this.zoom = 1;
      this.pan = { x: -rect.width / 2 + CARD_WIDTH / 2, y: -rect.height / 3 };
    } else {
      const pad = 60;
      this.zoom = Math.min(maxZoom, MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(rect.width / (bounds.width + pad * 2), rect.height / (bounds.height + pad * 2))));
      this.pan = {
        x: bounds.x + bounds.width / 2 - rect.width / 2 / this.zoom,
        y: bounds.y + bounds.height / 2 - rect.height / 2 / this.zoom,
      };
    }
    this.applyTransform();
  }

  /** Scroll a node into view if it isn't. */
  private ensureVisible(id: string): void {
    const node = nodeById(this.board, id);
    if (!node) return;
    const r = this.rectOf(node);
    const rect = this.root.getBoundingClientRect();
    const view = { x: this.pan.x, y: this.pan.y, width: rect.width / this.zoom, height: rect.height / this.zoom };
    const margin = 40 / this.zoom;
    const inner = { x: view.x + margin, y: view.y + margin, width: view.width - 2 * margin, height: view.height - 2 * margin };
    const fits = r.x >= inner.x && r.y >= inner.y && r.x + r.width <= inner.x + inner.width && r.y + Math.min(r.height, 200) <= inner.y + inner.height;
    if (fits) return;
    this.pan = { x: r.x + r.width / 2 - view.width / 2, y: r.y + Math.min(r.height, 200) / 2 - view.height / 2 };
    this.applyTransform();
  }

  private wheel(e: WheelEvent): void {
    if (this.root.hidden) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      return;
    }
    const scale = e.deltaMode === 1 ? 20 : 1;
    const dx = (e.shiftKey ? e.deltaY : e.deltaX) * scale;
    const dy = (e.shiftKey ? 0 : e.deltaY) * scale;
    this.pan = { x: this.pan.x + dx / this.zoom, y: this.pan.y + dy / this.zoom };
    this.applyTransform();
  }

  // --- Selection ---------------------------------------------------------------------------

  private select(ids: string[], edges: string[] = []): void {
    this.selected = new Set(ids);
    this.selectedEdges = new Set(edges);
    this.renderChrome();
    this.host.changed();
  }

  private singleSelected(): BoardNode | null {
    if (this.selected.size !== 1 || this.selectedEdges.size) return null;
    return nodeById(this.board, [...this.selected][0]) ?? null;
  }

  /** Tab: the next card in reading order. */
  private selectNext(back: boolean): void {
    const order = [...readingOrder(this.laidOut()), ...this.board.nodes.filter((n) => !isCard(n))];
    if (!order.length) return;
    const current = this.singleSelected();
    const index = current ? order.findIndex((n) => n.id === current.id) : -1;
    const next = order[(index + (back ? -1 : 1) + order.length) % order.length];
    this.select([next.id]);
    this.ensureVisible(next.id);
  }

  // --- Pointer -----------------------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    if (this.broken || e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('.board-zoom, .board-add, .board-bar-button, input')) return;
    if (e.button === 1) {
      e.preventDefault();
      this.capture(e);
      this.gesture = { kind: 'pan', startX: e.clientX, startY: e.clientY, pan: { ...this.pan }, moved: false, click: 'none' };
      return;
    }
    if (e.button !== 0) return;
    // Writing in a card: the editor handles the pointer itself.
    if (target.closest('.cm-editor')) return;
    const nodeEl = target.closest<HTMLElement>('.board-card, .board-group');
    const nodeId = nodeEl?.dataset.id;
    const edgeId = (target.closest('[data-edge]') as SVGElement | null)?.dataset.edge;
    const p = this.toBoard(e.clientX, e.clientY);
    this.pointer = p;

    if (nodeId && (nodeEl!.classList.contains('board-card') || target.closest('.board-group-label, .board-resize'))) {
      e.preventDefault();
      if (this.connecting) return this.finishConnecting(nodeId);
      // Grabbing another card ends writing in this one; grabbing the card itself keeps it.
      if (this.editing && this.editing !== nodeId) this.stopEditing();
      const node = nodeById(this.board, nodeId)!;
      if (target.closest('.board-resize')) {
        this.select([nodeId]);
        this.capture(e);
        this.gesture = { kind: 'resize', startX: e.clientX, startY: e.clientY, id: nodeId, before: this.board, moved: false, orig: this.rectOf(node) };
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const ids = new Set(this.selected);
        if (ids.has(nodeId)) ids.delete(nodeId);
        else ids.add(nodeId);
        this.select([...ids]);
        if (!ids.has(nodeId)) return;
      } else if (!this.selected.has(nodeId) || this.selectedEdges.size) this.select([nodeId]);
      this.capture(e);
      this.gesture = {
        kind: 'move',
        startX: e.clientX,
        startY: e.clientY,
        ids: [...this.selected],
        before: this.board,
        moved: false,
        anchor: this.rectOf(node),
        target: nodeId,
      };
      return;
    }

    if (edgeId) {
      e.preventDefault();
      this.stopEditing();
      this.root.focus({ preventScroll: true });
      if (this.connecting) return;
      if (e.shiftKey || e.ctrlKey) {
        const edges = new Set(this.selectedEdges);
        if (edges.has(edgeId)) edges.delete(edgeId);
        else edges.add(edgeId);
        this.select([...this.selected], [...edges]);
      } else this.select([], [edgeId]);
      return;
    }

    // An empty spot (or the inside of an area).
    e.preventDefault();
    this.stopEditing();
    this.root.focus({ preventScroll: true });
    this.capture(e);
    if (e.shiftKey && !this.connecting) {
      this.gesture = { kind: 'marquee', startX: e.clientX, startY: e.clientY, moved: false, base: new Set(this.selected) };
      return;
    }
    this.gesture = { kind: 'pan', startX: e.clientX, startY: e.clientY, pan: { ...this.pan }, moved: false, click: 'empty' };
  }

  private capture(e: PointerEvent): void {
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer (synthetic event): nothing to capture.
    }
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.toBoard(e.clientX, e.clientY);
    this.pointer = p;
    if (this.connecting && !this.gesture) this.renderEdges();
    const g = this.gesture;
    if (!g) return;
    const dxScreen = e.clientX - g.startX;
    const dyScreen = e.clientY - g.startY;
    if (!g.moved) {
      // A shaky click isn't a drag.
      if (Math.hypot(dxScreen, dyScreen) < getSettings().diagram.dragThreshold) return;
      g.moved = true;
      if (g.kind === 'move' || g.kind === 'resize') this.renderChrome();
    }
    const grid = getSettings().diagram.grid;
    const dx = dxScreen / this.zoom;
    const dy = dyScreen / this.zoom;
    switch (g.kind) {
      case 'pan':
        this.pan = { x: g.pan.x - dx, y: g.pan.y - dy };
        this.applyTransform();
        break;
      case 'move': {
        // The grabbed card snaps to the grid; the others keep their distance to it.
        const sdx = snap(g.anchor.x + dx, grid) - g.anchor.x;
        const sdy = snap(g.anchor.y + dy, grid) - g.anchor.y;
        this.board = moveNodes(g.before, g.ids, sdx, sdy);
        this.render();
        break;
      }
      case 'resize': {
        const node = nodeById(g.before, g.id);
        if (!node) break;
        const width = Math.max(isGroup(node) ? MIN_GROUP.width : MIN_CARD_WIDTH, snap(g.orig.width + dx, grid));
        const patch: Partial<BoardNode> = { width };
        if (!isCard(node)) patch.height = Math.max(MIN_GROUP.height, snap(g.orig.height + dy, grid));
        this.board = updateNode(g.before, g.id, patch);
        this.render();
        break;
      }
      case 'marquee': {
        const a = this.toBoard(g.startX, g.startY);
        const r = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), width: Math.abs(p.x - a.x), height: Math.abs(p.y - a.y) };
        const rootRect = this.root.getBoundingClientRect();
        Object.assign(this.marqueeEl.style, {
          left: `${Math.min(g.startX, e.clientX) - rootRect.left}px`,
          top: `${Math.min(g.startY, e.clientY) - rootRect.top}px`,
          width: `${Math.abs(dxScreen)}px`,
          height: `${Math.abs(dyScreen)}px`,
        });
        this.marqueeEl.hidden = false;
        const hit = this.board.nodes.filter((n) => !isGroup(n) && overlaps(r, this.rectOf(n))).map((n) => n.id);
        this.select([...new Set([...g.base, ...hit])]);
        break;
      }
    }
  }

  private pointerUp(e: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    this.marqueeEl.hidden = true;
    if ((g.kind === 'move' || g.kind === 'resize') && g.moved) {
      let after = this.board;
      if (g.kind === 'resize') {
        const h = this.measured.get(g.id);
        const node = nodeById(after, g.id);
        if (node && isCard(node) && h) after = updateNode(after, g.id, { height: h });
        this.heightFollows.add(g.id);
      }
      this.board = g.before;
      this.commit(after, g.before);
      return;
    }
    if (g.kind === 'move' && !g.moved && !(e.shiftKey || e.ctrlKey || e.metaKey) && this.selected.size > 1) {
      // A click on one of several selected cards selects just that one.
      this.select([g.target]);
    }
    if (g.kind === 'pan' && !g.moved && g.click === 'empty') {
      if (this.connecting) {
        const p = this.toBoard(e.clientX, e.clientY);
        const from = this.connecting;
        this.connecting = null;
        this.addCardAt(p.x - CARD_WIDTH / 2, p.y - 20, from);
      } else this.select([]);
    }
    this.renderChrome();
  }

  private cancelGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    this.marqueeEl.hidden = true;
    if (g && (g.kind === 'move' || g.kind === 'resize') && g.moved) {
      this.board = g.before;
      this.render();
    }
  }

  private doubleClick(e: MouseEvent): void {
    if (this.broken) return;
    const target = e.target as HTMLElement;
    if (target.closest('.cm-editor, .board-zoom, .board-add, .board-bar-button, input')) return;
    const edgeId = (target.closest('[data-edge]') as SVGElement | null)?.dataset.edge;
    if (edgeId) return this.editEdgeLabel(edgeId);
    if (target.closest('.board-group-label')) {
      const id = target.closest<HTMLElement>('.board-group')?.dataset.id;
      if (id) this.renameGroup(id);
      return;
    }
    const nodeEl = target.closest<HTMLElement>('.board-card');
    if (nodeEl?.dataset.id) {
      const node = nodeById(this.board, nodeEl.dataset.id);
      if (node?.type === 'file') this.openFileNode(node);
      else if (node && isCard(node)) this.editCard(node.id);
      return;
    }
    const p = this.toBoard(e.clientX, e.clientY);
    this.addCardAt(p.x - 30, p.y - 20);
  }

  private openFileNode(node: BoardNode): void {
    const file = typeof node.file === 'string' ? node.file : '';
    const dir = dirOf(this.doc?.file?.path);
    if (!file) return;
    this.host.openPath(/^([a-z]:)?[\\/]/i.test(file) || !dir ? file : `${dir}\\${file.replace(/\//g, '\\')}`);
  }

  // --- Keys --------------------------------------------------------------------------------

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    // Keys while writing in a card (or in a name field) belong there.
    if (this.broken || target.closest('.cm-editor, input, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const grid = getSettings().diagram.grid;
    const single = this.singleSelected();
    let handled = true;
    if (key === 'Escape') {
      if (this.connecting) {
        this.connecting = null;
        this.render();
      } else this.select([]);
    } else if (mod && key.toLowerCase() === 'z' && !e.shiftKey) this.undo();
    else if (mod && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && e.shiftKey))) this.redo();
    else if (mod && key.toLowerCase() === 'a') this.select(this.board.nodes.filter((n) => !isGroup(n)).map((n) => n.id));
    else if (key === 'Delete' || key === 'Backspace') this.deleteSelection();
    else if (key === 'Enter' || key === 'F2') {
      if (this.selectedEdges.size === 1 && !this.selected.size) this.editEdgeLabel([...this.selectedEdges][0]);
      else if (single && isGroup(single)) this.renameGroup(single.id);
      else if (single && isCard(single)) this.editCard(single.id);
      else if (!this.selected.size) this.addCard();
      else handled = false;
    } else if (key === 'Tab') this.selectNext(e.shiftKey);
    else if (key === 'Home') this.fit();
    else if (mod && ARROWS[key] && single && !isGroup(single)) this.addNeighbor(single.id, ARROWS[key]);
    else if (ARROWS[key] && !mod) {
      const d = ARROWS[key];
      const step = e.shiftKey ? grid * 5 : grid;
      const dx = d === 'left' ? -step : d === 'right' ? step : 0;
      const dy = d === 'up' ? -step : d === 'down' ? step : 0;
      if (this.selected.size) this.commit(moveNodes(this.board, this.selected, dx, dy));
      else {
        // Nothing selected: the arrow keys move the view.
        this.pan = { x: this.pan.x + (dx * 3) / this.zoom, y: this.pan.y + (dy * 3) / this.zoom };
        this.applyTransform();
      }
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // --- Names and arrow texts ---------------------------------------------------------------

  renameGroup(id: string): void {
    const dom = this.nodes.get(id);
    const node = nodeById(this.board, id);
    if (!dom?.label || !node) return;
    this.openTextInput(dom.label, node.label ?? '', 'Navn på området', (value) => this.commit(updateNode(this.board, id, { label: value.trim() || undefined })));
  }

  private editEdgeLabel(id: string): void {
    const edge = edgeById(this.board, id);
    if (!edge) return;
    const a = nodeById(this.board, edge.fromNode);
    const b = nodeById(this.board, edge.toNode);
    if (!a || !b) return;
    const g = edgeGeometry(this.rectOf(a), this.rectOf(b), edge.fromSide, edge.toSide);
    const holder = el('div', 'board-edge-input');
    holder.style.left = `${g.mid.x}px`;
    holder.style.top = `${g.mid.y}px`;
    this.chrome.append(holder);
    this.openTextInput(holder, edge.label ?? '', 'Tekst på pila', (value) => this.commit(updateEdge(this.board, id, { label: value.trim() || undefined })), () => holder.remove());
  }

  private openTextInput(parent: HTMLElement, value: string, placeholder: string, done: (value: string) => void, cleanup?: () => void): void {
    this.closeTextInput(false);
    const input = el('input', 'board-text-input');
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    let finished = false;
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      this.textInput = null;
      input.remove();
      cleanup?.();
      if (save && input.value !== value) done(input.value);
      else this.render();
      this.root.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        // Esc keeps what's written, as in the drawing window.
        finish(true);
      }
    });
    input.addEventListener('blur', () => finish(true));
    (input as HTMLInputElement & { finish?: (save: boolean) => void }).finish = finish;
    parent.replaceChildren(input);
    this.textInput = input;
    input.focus({ preventScroll: true });
    input.select();
  }

  private closeTextInput(save: boolean): void {
    const input = this.textInput as (HTMLInputElement & { finish?: (save: boolean) => void }) | null;
    input?.finish?.(save);
  }

  // --- Menus -------------------------------------------------------------------------------

  private colorMenu(ids: string[], edgeIds: string[]): MenuItem[] {
    const first = ids.length ? nodeById(this.board, ids[0])?.color : edgeIds.length ? edgeById(this.board, edgeIds[0])?.color : undefined;
    return [
      { heading: 'Farge' },
      ...BOARD_COLORS.map((c) => ({ label: c.name, checked: first === c.id, action: () => this.setColor(ids, edgeIds, c.id) })),
      { label: 'Ingen farge', checked: !first, action: () => this.setColor(ids, edgeIds, undefined) },
    ];
  }

  private contextMenu(e: MouseEvent): void {
    if (this.broken) return;
    const target = e.target as HTMLElement;
    // In a card's text: the usual menu (spelling suggestions …).
    if (target.closest('.cm-content, input')) return;
    const p = this.toBoard(e.clientX, e.clientY);
    const edgeId = (target.closest('[data-edge]') as SVGElement | null)?.dataset.edge;
    const nodeId = target.closest<HTMLElement>('.board-card, .board-group-label, .board-resize')
      ? target.closest<HTMLElement>('.board-card, .board-group')?.dataset.id
      : undefined;
    if (this.connecting) {
      e.preventDefault();
      this.connecting = null;
      this.render();
      return;
    }
    if (edgeId) {
      const edge = edgeById(this.board, edgeId)!;
      if (!this.selectedEdges.has(edgeId)) this.select([], [edgeId]);
      const ends = edgeEnds(edge);
      const setEnds = (from: 'none' | 'arrow', to: 'none' | 'arrow') => () =>
        this.commit(updateEdge(this.board, edgeId, { fromEnd: from === 'none' ? undefined : from, toEnd: to === 'arrow' ? undefined : to }));
      showContextMenu(e, [
        { label: 'Skriv tekst på pila …', action: () => this.editEdgeLabel(edgeId) },
        { label: 'Snu pila', action: () => this.commit(reverseEdge(this.board, edgeId)) },
        'separator',
        { label: 'Pil én vei', checked: ends.from === 'none' && ends.to === 'arrow', action: setEnds('none', 'arrow') },
        { label: 'Pil begge veier', checked: ends.from === 'arrow' && ends.to === 'arrow', action: setEnds('arrow', 'arrow') },
        { label: 'Bare strek', checked: ends.from === 'none' && ends.to === 'none', action: setEnds('none', 'none') },
        'separator',
        ...this.colorMenu([], [...this.selectedEdges]),
        'separator',
        { label: 'Slett pila', action: () => this.deleteSelection() },
      ]);
      return;
    }
    if (nodeId) {
      const node = nodeById(this.board, nodeId)!;
      if (!this.selected.has(nodeId)) this.select([nodeId]);
      const ids = [...this.selected];
      const items: MenuItem[] = [];
      if (isCard(node)) {
        items.push(
          { label: 'Skriv i kortet', action: () => this.editCard(nodeId) },
          { label: 'Pil til et annet kort …', action: () => this.startConnecting(nodeId) },
          { label: 'Nytt kort til høyre, med pil', action: () => this.addNeighbor(nodeId, 'right') },
          { label: 'Nytt kort under, med pil', action: () => this.addNeighbor(nodeId, 'down') },
          { label: 'Lag område rundt', action: () => this.addGroup() },
        );
      } else if (isGroup(node)) {
        items.push({ label: 'Gi nytt navn', action: () => this.renameGroup(nodeId) });
      } else if (node.type === 'file') {
        items.push({ label: 'Åpne fila', action: () => this.openFileNode(node) });
      }
      items.push('separator', ...this.colorMenu(ids, []), 'separator', {
        label: ids.length > 1 ? `Slett ${ids.length} valgte` : isGroup(node) ? 'Slett området (kortene blir)' : 'Slett',
        action: () => this.deleteSelection(),
      });
      showContextMenu(e, items);
      return;
    }
    showContextMenu(e, [
      { label: 'Nytt kort her', action: () => this.addCardAt(p.x - 30, p.y - 20) },
      { label: 'Nytt område', action: () => this.addGroup() },
      'separator',
      { label: 'Vis hele tavla', action: () => this.fit() },
      { label: 'Lag dokument av tavla', action: () => this.toDocument(), disabled: !this.board.nodes.some(isCard) },
    ]);
  }
}
