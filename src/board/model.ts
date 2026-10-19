/**
 * The board («tavle»): cards placed freely on an endless surface, arrows
 * between them and areas around them. Plain data and pure functions (no DOM),
 * each returning a new `Board`.
 *
 * The file format is JSON Canvas (https://jsoncanvas.org, `.canvas`), the
 * format Obsidian's canvas uses, so boards open there too. Fields we don't
 * know are kept as they are.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type EndKind = 'none' | 'arrow';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardNode extends Rect {
  id: string;
  /** 'text' (a card), 'group' (an area), 'file', 'link' – or something newer we only keep. */
  type: string;
  /** "1"–"6" (the preset colours) or "#rrggbb". */
  color?: string;
  /** Card text (Markdown). */
  text?: string;
  /** Area name. */
  label?: string;
  /** File cards: path relative to the vault (Obsidian) or the board's folder. */
  file?: string;
  url?: string;
  [extra: string]: unknown;
}

export interface BoardEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  /** Default 'none'. */
  fromEnd?: EndKind;
  /** Default 'arrow'. */
  toEnd?: EndKind;
  color?: string;
  label?: string;
  [extra: string]: unknown;
}

export interface Board {
  /** Back to front: the first node is drawn at the bottom. */
  nodes: BoardNode[];
  edges: BoardEdge[];
  /** Top-level fields besides nodes and edges (kept when saving). */
  extra?: Record<string, unknown>;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export const emptyBoard = (): Board => ({ nodes: [], edges: [] });

/** Size of a new card. */
export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 60;
/** Space between a card and the one made next to it. */
export const GAP = 60;

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A random id like Obsidian's (16 hex digits). */
export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read a `.canvas` file. Empty text is an empty board; anything that isn't a
 * JSON Canvas object throws (so the file is never overwritten with something else).
 */
export function parseBoard(text: string): Board {
  if (text.trim() === '') return emptyBoard();
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) throw new Error('Fila er ikke en tavle (JSON Canvas)');
  const { nodes, edges, ...extra } = data;
  if ((nodes !== undefined && !Array.isArray(nodes)) || (edges !== undefined && !Array.isArray(edges))) {
    throw new Error('Fila er ikke en tavle (JSON Canvas)');
  }
  const seen = new Set<string>();
  const outNodes: BoardNode[] = [];
  for (const raw of (nodes as unknown[] | undefined) ?? []) {
    if (!isObject(raw)) continue;
    const id = typeof raw.id === 'string' && raw.id && !seen.has(raw.id) ? raw.id : newId();
    seen.add(id);
    outNodes.push({
      ...raw,
      id,
      type: typeof raw.type === 'string' ? raw.type : 'text',
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      width: Math.max(1, num(raw.width, CARD_WIDTH)),
      height: Math.max(1, num(raw.height, CARD_HEIGHT)),
    });
  }
  const outEdges: BoardEdge[] = [];
  for (const raw of (edges as unknown[] | undefined) ?? []) {
    if (!isObject(raw) || typeof raw.fromNode !== 'string' || typeof raw.toNode !== 'string') continue;
    const edge: BoardEdge = { ...raw, id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), fromNode: raw.fromNode, toNode: raw.toNode };
    for (const key of ['fromSide', 'toSide'] as const) if (!SIDES.includes(edge[key] as Side)) delete edge[key];
    for (const key of ['fromEnd', 'toEnd'] as const) if (edge[key] !== 'none' && edge[key] !== 'arrow') delete edge[key];
    outEdges.push(edge);
  }
  return Object.keys(extra).length ? { nodes: outNodes, edges: outEdges, extra } : { nodes: outNodes, edges: outEdges };
}

/** Write a board as JSON Canvas (tab-indented, like Obsidian). */
export function serializeBoard(board: Board): string {
  const round = (node: BoardNode): BoardNode => ({
    ...node,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
  });
  return JSON.stringify({ nodes: board.nodes.map(round), edges: board.edges, ...board.extra }, null, '\t');
}

// --- Lookups -----------------------------------------------------------------------------

export const nodeById = (board: Board, id: string) => board.nodes.find((n) => n.id === id);
export const edgeById = (board: Board, id: string) => board.edges.find((e) => e.id === id);

export const isCard = (node: BoardNode) => node.type === 'text';
export const isGroup = (node: BoardNode) => node.type === 'group';

/**
 * A text can stand in a shape (or be a shape without text). Stored as
 * `styleAttributes.shape`, the way the Advanced Canvas plugin for Obsidian
 * does it (it knows pill, circle and diamond); Obsidian on its own shows the text as usual.
 */
export type ShapeKind = 'rectangle' | 'pill' | 'circle' | 'diamond' | 'triangle';

export const SHAPES: { id: ShapeKind; name: string; width: number; height: number }[] = [
  { id: 'rectangle', name: 'Rektangel', width: 200, height: 120 },
  { id: 'pill', name: 'Avrundet', width: 220, height: 80 },
  { id: 'circle', name: 'Sirkel', width: 140, height: 140 },
  { id: 'diamond', name: 'Rombe', width: 180, height: 140 },
  { id: 'triangle', name: 'Trekant', width: 160, height: 140 },
];

export function shapeOf(node: BoardNode): ShapeKind | null {
  if (!isCard(node)) return null;
  const attrs = node.styleAttributes;
  const shape = attrs && typeof attrs === 'object' ? (attrs as Record<string, unknown>).shape : undefined;
  return SHAPES.some((s) => s.id === shape) ? (shape as ShapeKind) : null;
}

/** Put a text in a shape (or take it out with null), keeping its other style attributes. */
export function withShape(node: BoardNode, shape: ShapeKind | null): BoardNode {
  const attrs = { ...((node.styleAttributes as Record<string, unknown> | undefined) ?? {}) };
  if (shape) attrs.shape = shape;
  else delete attrs.shape;
  const out: BoardNode = { ...node, styleAttributes: attrs };
  if (!Object.keys(attrs).length) delete out.styleAttributes;
  return out;
}

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Nodes lying wholly inside an area (an area moves them along). */
export function nodesInside(board: Board, group: BoardNode): BoardNode[] {
  return board.nodes.filter((n) => n.id !== group.id && inside(n, group));
}

/** The ids, plus everything inside the areas among them (and areas inside those). */
export function withContents(board: Board, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const queue = [...out];
  while (queue.length) {
    const node = nodeById(board, queue.pop()!);
    if (!node || !isGroup(node)) continue;
    for (const n of nodesInside(board, node)) {
      if (!out.has(n.id)) {
        out.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return out;
}

/** The smallest rectangle around the nodes, or null when there are none. */
export function boundsOf(nodes: Rect[]): Rect | null {
  if (!nodes.length) return null;
  const x = Math.min(...nodes.map((n) => n.x));
  const y = Math.min(...nodes.map((n) => n.y));
  const right = Math.max(...nodes.map((n) => n.x + n.width));
  const bottom = Math.max(...nodes.map((n) => n.y + n.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The topmost card or area under a point (cards before areas). */
export function nodeAt(board: Board, x: number, y: number): BoardNode | null {
  const hit = (n: BoardNode) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height;
  const nodes = [...board.nodes].reverse();
  return nodes.find((n) => !isGroup(n) && hit(n)) ?? nodes.find((n) => isGroup(n) && hit(n)) ?? null;
}

// --- Changes -----------------------------------------------------------------------------

export function addNode(board: Board, node: BoardNode): Board {
  // Areas go at the back, so they never hide cards.
  return isGroup(node) ? { ...board, nodes: [node, ...board.nodes] } : { ...board, nodes: [...board.nodes, node] };
}

export function updateNode(board: Board, id: string, patch: Partial<BoardNode>): Board {
  return { ...board, nodes: board.nodes.map((n) => (n.id === id ? clean({ ...n, ...patch }) : n)) };
}

export function updateEdge(board: Board, id: string, patch: Partial<BoardEdge>): Board {
  return { ...board, edges: board.edges.map((e) => (e.id === id ? clean({ ...e, ...patch }) : e)) };
}

/** Drop fields set to undefined or '' (e.g. a colour taken off), so they aren't written. */
function clean<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined || (key !== 'text' && out[key] === '')) delete out[key];
  return out as T;
}

/** Move nodes (and what's inside moved areas) by dx, dy. */
export function moveNodes(board: Board, ids: Iterable<string>, dx: number, dy: number): Board {
  const moving = withContents(board, ids);
  if (!moving.size || (dx === 0 && dy === 0)) return board;
  return { ...board, nodes: board.nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
}

/** Delete nodes and the arrows to and from them. Things inside a deleted area stay. */
export function removeNodes(board: Board, ids: Iterable<string>): Board {
  const gone = new Set(ids);
  return {
    ...board,
    nodes: board.nodes.filter((n) => !gone.has(n.id)),
    edges: board.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)),
  };
}

export function removeEdges(board: Board, ids: Iterable<string>): Board {
  const gone = new Set(ids);
  return { ...board, edges: board.edges.filter((e) => !gone.has(e.id)) };
}

/**
 * An arrow from one node to another. Returns the board unchanged (and the
 * existing arrow's id) if they're already connected that way; null for a node to itself.
 */
export function connect(board: Board, from: string, to: string, id = newId()): { board: Board; edge: string } | null {
  if (from === to || !nodeById(board, from) || !nodeById(board, to)) return null;
  const existing = board.edges.find((e) => e.fromNode === from && e.toNode === to);
  if (existing) return { board, edge: existing.id };
  return { board: { ...board, edges: [...board.edges, { id, fromNode: from, toNode: to }] }, edge: id };
}

/** Turn an arrow around: it now points the other way (the arrowheads stay at «from» and «to»). */
export function reverseEdge(board: Board, id: string): Board {
  return {
    ...board,
    edges: board.edges.map((e) => {
      if (e.id !== id) return e;
      return clean({ ...e, fromNode: e.toNode, toNode: e.fromNode, fromSide: e.toSide, toSide: e.fromSide });
    }),
  };
}

/** Ends of an arrow with the defaults filled in. */
export function edgeEnds(edge: BoardEdge): { from: EndKind; to: EndKind } {
  return { from: edge.fromEnd ?? 'none', to: edge.toEnd ?? 'arrow' };
}

/** Bring nodes to the front (last), keeping their order; areas stay at the back. */
export function bringToFront(board: Board, ids: Iterable<string>): Board {
  const front = new Set(ids);
  const moved = board.nodes.filter((n) => front.has(n.id) && !isGroup(n));
  if (!moved.length || board.nodes.slice(-moved.length).every((n, i) => n === moved[i])) return board;
  return { ...board, nodes: [...board.nodes.filter((n) => !moved.includes(n)), ...moved] };
}

/** Round to the grid. */
export const snap = (value: number, grid: number) => (grid > 0 ? Math.round(value / grid) * grid : value);

/**
 * Where a new card goes next to `node` in a direction: `GAP` away, and
 * further along the side if that spot is taken (so a second «→» lands under
 * the first instead of on top of it).
 */
export function placeNextTo(board: Board, node: Rect, direction: Direction, size = { width: CARD_WIDTH, height: CARD_HEIGHT }): Rect {
  const base: Rect = { ...size, x: node.x, y: node.y };
  if (direction === 'right') base.x = node.x + node.width + GAP;
  if (direction === 'left') base.x = node.x - GAP - size.width;
  if (direction === 'down') base.y = node.y + node.height + GAP;
  if (direction === 'up') base.y = node.y - GAP - size.height;
  if (direction === 'up' || direction === 'down') base.x = node.x + (node.width - size.width) / 2;
  const others = board.nodes.filter((n) => !isGroup(n));
  const free = (r: Rect) => !others.some((n) => overlaps({ x: r.x - 10, y: r.y - 10, width: r.width + 20, height: r.height + 20 }, n));
  const sideways = direction === 'left' || direction === 'right';
  for (let step = 0; step < 50; step++) {
    const r = sideways ? { ...base, y: base.y + step * (size.height + 20) } : { ...base, x: base.x + step * (size.width + 30) };
    if (free(r)) return r;
  }
  return base;
}

/** The side of `a` that faces `b` (by their centres). */
export function facingSide(a: Rect, b: Rect): Side {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  // Compare relative to the sizes, so wide cards side by side still connect sideways.
  if (Math.abs(dx) / (a.width + b.width) > Math.abs(dy) / (a.height + b.height)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

export const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Which way a side faces (out of the card). */
export const NORMAL: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** The middle of a side. */
export function sidePoint(r: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

export interface EdgeGeometry {
  /** SVG path (a curve that leaves and enters the cards straight out of their sides). */
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Point halfway along the curve (for the label). */
  mid: { x: number; y: number };
  fromSide: Side;
  toSide: Side;
}

/** The curve of an arrow between two rectangles; sides not given are picked to face each other. */
export function edgeGeometry(a: Rect, b: Rect, fromSide?: Side, toSide?: Side): EdgeGeometry {
  const fs = fromSide ?? facingSide(a, b);
  const ts = toSide ?? facingSide(b, a);
  const p0 = sidePoint(a, fs);
  const p3 = sidePoint(b, ts);
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const reach = Math.max(30, Math.min(160, dist / 2.5));
  const p1 = { x: p0.x + NORMAL[fs].x * reach, y: p0.y + NORMAL[fs].y * reach };
  const p2 = { x: p3.x + NORMAL[ts].x * reach, y: p3.y + NORMAL[ts].y * reach };
  const mid = {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8,
  };
  const f = (n: number) => Math.round(n * 10) / 10;
  return {
    d: `M ${f(p0.x)} ${f(p0.y)} C ${f(p1.x)} ${f(p1.y)}, ${f(p2.x)} ${f(p2.y)}, ${f(p3.x)} ${f(p3.y)}`,
    from: p0,
    to: p3,
    mid,
    fromSide: fs,
    toSide: ts,
  };
}

// --- Reading order and turning a board into a document ----------------------------------

/**
 * Cards in the order a reader would take them: arrows first (a card comes
 * after the cards pointing to it), otherwise top to bottom, left to right.
 * Cycles are broken at the topmost card.
 */
export function readingOrder(board: Board, nodes = board.nodes.filter(isCard)): BoardNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const next = new Map<string, string[]>();
  for (const e of board.edges) {
    if (!ids.has(e.fromNode) || !ids.has(e.toNode) || e.fromNode === e.toNode) continue;
    // Only arrows that point somewhere give an order.
    const { from, to } = edgeEnds(e);
    const [src, dst] = from === 'arrow' && to === 'none' ? [e.toNode, e.fromNode] : [e.fromNode, e.toNode];
    if (from === to && to === 'none') continue;
    incoming.set(dst, (incoming.get(dst) ?? 0) + 1);
    next.set(src, [...(next.get(src) ?? []), dst]);
  }
  const before = (a: BoardNode, b: BoardNode) => (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x) || a.y - b.y;
  const remaining = [...nodes].sort(before);
  const out: BoardNode[] = [];
  const done = new Set<string>();
  // A depth-first walk keeps a chain of arrows together (A → B → C before the next start).
  const visit = (node: BoardNode) => {
    done.add(node.id);
    out.push(node);
    const children = (next.get(node.id) ?? []).map((id) => nodes.find((n) => n.id === id)!).sort(before);
    for (const child of children) {
      if (done.has(child.id)) continue;
      incoming.set(child.id, incoming.get(child.id)! - 1);
      if (incoming.get(child.id)! <= 0) visit(child);
    }
  };
  while (out.length < nodes.length) {
    const start = remaining.find((n) => !done.has(n.id) && incoming.get(n.id)! <= 0) ?? remaining.find((n) => !done.has(n.id))!;
    visit(start);
  }
  return out;
}

/**
 * The board as one Markdown document. Areas and cards outside areas are taken
 * in reading order as units (an arrow from a card in one area to a card in
 * another, or to a loose card, leads there next); each area becomes a heading
 * with its cards under it, and headings in those cards move down a level so
 * they sit under it. An arrow's text becomes a line in italics before the card it points to.
 */
export function boardToMarkdown(board: Board): string {
  const groups = board.nodes.filter(isGroup);
  const cards = board.nodes.filter(isCard);
  // Each card belongs to the smallest area around it.
  const home = new Map<string, BoardNode | null>();
  for (const card of cards) {
    const around = groups.filter((g) => inside(card, g)).sort((a, b) => a.width * a.height - b.width * b.height);
    home.set(card.id, around[0] ?? null);
  }
  const labels = new Map<string, string>();
  for (const e of board.edges) if (e.label?.trim()) labels.set(e.toNode, labels.has(e.toNode) ? `${labels.get(e.toNode)}, ${e.label.trim()}` : e.label.trim());

  const cardText = (card: BoardNode, inArea: boolean) => {
    const text = (card.text ?? '').trim();
    if (!text) return '';
    const body = inArea ? demoteHeadings(text, 2) : text;
    const label = labels.get(card.id);
    return label ? `*${label}:*\n\n${body}` : body;
  };

  // Units: the areas that hold cards (or have a name), and the loose cards.
  const unitOf = (id: string) => home.get(id)?.id ?? id;
  const units: BoardNode[] = [
    ...groups.filter((g) => g.label?.trim() || cards.some((c) => home.get(c.id) === g)).map((g) => ({ ...g, type: 'text' })),
    ...cards.filter((c) => !home.get(c.id)),
  ];
  const unitIds = new Set(units.map((u) => u.id));
  const unitEdges = board.edges
    .filter((e) => home.has(e.fromNode) && home.has(e.toNode))
    .map((e) => ({ ...e, fromNode: unitOf(e.fromNode), toNode: unitOf(e.toNode) }))
    .filter((e) => e.fromNode !== e.toNode && unitIds.has(e.fromNode) && unitIds.has(e.toNode));

  const parts: string[] = [];
  for (const unit of readingOrder({ nodes: units, edges: unitEdges }, units)) {
    const group = groups.find((g) => g.id === unit.id);
    if (!group) {
      const text = cardText(unit, false);
      if (text) parts.push(text);
      continue;
    }
    const body = readingOrder(board, cards.filter((c) => home.get(c.id) === group))
      .map((c) => cardText(c, true))
      .filter((t) => t !== '')
      .join('\n\n');
    parts.push(`## ${group.label?.trim() || 'Område'}${body ? `\n\n${body}` : ''}`);
  }
  return parts.join('\n\n') + '\n';
}

/** Move ATX headings down `levels` (at most to ######), outside code blocks. */
export function demoteHeadings(text: string, levels: number): string {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^(\s{0,3})(#{1,6})(?=\s|$)/, (_, indent: string, marks: string) => indent + '#'.repeat(Math.min(6, marks.length + levels)));
    })
    .join('\n');
}

/** Text to name a new board's file after: its first card (in reading order). */
export function boardTitleText(board: Board): string {
  const named = board.nodes.filter(isGroup).find((g) => g.label?.trim());
  const first = readingOrder(board).find((c) => (c.text ?? '').trim());
  return first?.text ?? named?.label ?? '';
}

/** All the words on the board (cards, area names, arrow texts) – for the word count. */
export function boardText(board: Board): string {
  return [
    ...board.nodes.map((n) => (isCard(n) ? n.text : isGroup(n) ? n.label : '') ?? ''),
    ...board.edges.map((e) => e.label ?? ''),
  ].join('\n');
}
