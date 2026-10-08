/**
 * The drawing's data: figures (nodes) and arrows (edges) between them.
 * Plain data, changed only through the pure functions here, so every change
 * is a new Diagram (easy undo, easy to test).
 */
import { routes, type Route } from './routing';

export interface Point {
  x: number;
  y: number;
}

export interface DiagramNode {
  id: string;
  /** Shape type id (see shapes/). */
  shape: string;
  /** Top-left corner and size, in drawing units (px at 100 %). */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Outline drawn twice (weak entity, multivalued attribute …). */
  double?: boolean;
  /** Dashed outline (derived attribute …). */
  dashed?: boolean;
  /** Freehand ('path'): the clicked points, as fractions (0–1) of w and h, so resizing scales them. */
  points?: Point[];
  /** Freehand: joined back to the first point. */
  closed?: boolean;
  /** Freehand: a smooth curve through the points (false: straight lines). */
  smooth?: boolean;
  /** Freehand/Strek, when open: marks at the last and first point (arrow heads …). */
  head?: EndKind;
  tail?: EndKind;
  /** Strek (two points, open): corners instead of a slant (see routing.ts). */
  route?: Route;
  /** Freehand/Strek, when open: the first/last point is fastened to a point of another figure and follows it. */
  startAt?: AnchorRef;
  endAt?: AnchorRef;
}

/** One of a figure's snap points (`ShapeType.anchors`, by index): a line end fastened there. */
export interface AnchorRef {
  node: string;
  anchor: number;
  /** Which way is out of the figure there (−1/0/1 per axis; both set at a corner). Lines with corners leave that way first. */
  out?: Point;
}

/** What's drawn at an end of a line. */
export type EndKind = 'none' | 'arrow' | 'open' | 'triangle' | 'diamond' | 'filledDiamond';

export interface EdgeStyle {
  /** At `to`. */
  head: EndKind;
  /** At `from`. */
  tail: EndKind;
  dashed: boolean;
  /** Two parallel lines (ER: total participation). Not part of the presets – it's a toggle of its own. */
  double?: boolean;
  /** Corners instead of a slant. Also not part of the presets. */
  route?: Route;
}

export const defaultEdgeStyle: EdgeStyle = { head: 'arrow', tail: 'none', dashed: false };

export interface DiagramEdge {
  id: string;
  /** Node ids; the arrow head (by default) is at `to`. */
  from: string;
  to: string;
  head?: EndKind;
  tail?: EndKind;
  dashed?: boolean;
  double?: boolean;
  route?: Route;
  /** Text in the middle of the line. */
  label?: string;
  /** Text near each end (multiplicity, cardinality: «1», «0..*», «N»). */
  fromLabel?: string;
  toLabel?: string;
}

/** An edge's style with defaults filled in. */
export const styleOf = (e: DiagramEdge): EdgeStyle => ({
  head: e.head ?? defaultEdgeStyle.head,
  tail: e.tail ?? defaultEdgeStyle.tail,
  dashed: e.dashed ?? defaultEdgeStyle.dashed,
  ...(e.double ? { double: true } : {}),
  ...(e.route ? { route: e.route } : {}),
});

export interface Diagram {
  version: 1;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export function emptyDiagram(): Diagram {
  return { version: 1, nodes: [], edges: [] };
}

export const snap = (value: number, grid: number) => Math.round(value / grid) * grid;

export const center = (n: DiagramNode): Point => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** A fresh id like "n4" (one more than the highest in use). */
export function newId(d: Diagram, prefix: 'n' | 'e'): string {
  const items: { id: string }[] = prefix === 'n' ? d.nodes : d.edges;
  let max = 0;
  for (const { id } of items) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function findNode(d: Diagram, id: string): DiagramNode | undefined {
  return d.nodes.find((n) => n.id === id);
}

export function addNode(d: Diagram, node: Omit<DiagramNode, 'id'>): { diagram: Diagram; id: string } {
  const id = newId(d, 'n');
  return { diagram: { ...d, nodes: [...d.nodes, { ...node, id }] }, id };
}

export function updateNode(d: Diagram, id: string, patch: Partial<Omit<DiagramNode, 'id'>>): Diagram {
  return { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Move several nodes by the same amount (their lines follow, since lines hang on node ids). */
export function moveNodes(d: Diagram, ids: string[], dx: number, dy: number): Diagram {
  if (!dx && !dy) return d;
  const moving = new Set(ids);
  return { ...d, nodes: d.nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
}

/** Nodes that touch the rectangle (any corner order) – forgiving, so a rough drag catches them. */
export function nodesInRect(d: Diagram, a: Point, b: Point): DiagramNode[] {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return d.nodes.filter((n) => n.x <= right && n.x + n.w >= left && n.y <= bottom && n.y + n.h >= top);
}

/** Lines with both ends among these nodes. */
export function edgesBetween(d: Diagram, nodeIds: string[]): DiagramEdge[] {
  const ids = new Set(nodeIds);
  return d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

/** Remove nodes and every arrow touching them. Lines fastened to them stay where they are. */
export function removeNodes(d: Diagram, ids: string[]): Diagram {
  const gone = new Set(ids);
  const loose = (n: DiagramNode): DiagramNode => {
    if (!(n.startAt && gone.has(n.startAt.node)) && !(n.endAt && gone.has(n.endAt.node))) return n;
    const { startAt, endAt, ...rest } = n;
    return {
      ...rest,
      ...(startAt && !gone.has(startAt.node) ? { startAt } : {}),
      ...(endAt && !gone.has(endAt.node) ? { endAt } : {}),
    };
  };
  return {
    ...d,
    nodes: d.nodes.filter((n) => !gone.has(n.id)).map(loose),
    edges: d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
}

export function removeEdges(d: Diagram, ids: string[]): Diagram {
  const gone = new Set(ids);
  return { ...d, edges: d.edges.filter((e) => !gone.has(e.id)) };
}

/** Connect two nodes. No self-arrows, and no duplicate of an existing arrow. */
export function connect(
  d: Diagram,
  from: string,
  to: string,
  style: EdgeStyle = defaultEdgeStyle,
): { diagram: Diagram; id: string | null } {
  if (from === to || !findNode(d, from) || !findNode(d, to)) return { diagram: d, id: null };
  const existing = d.edges.find((e) => e.from === from && e.to === to);
  if (existing) return { diagram: d, id: existing.id };
  const id = newId(d, 'e');
  return { diagram: { ...d, edges: [...d.edges, { id, from, to, ...style }] }, id };
}

export function updateEdge(d: Diagram, id: string, patch: Partial<Omit<DiagramEdge, 'id' | 'from' | 'to'>>): Diagram {
  return { ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Turn the line around (ends and their texts swap places). */
export function reverseEdge(d: Diagram, id: string): Diagram {
  return {
    ...d,
    edges: d.edges.map((e) => {
      if (e.id !== id) return e;
      const style = styleOf(e);
      return { ...e, from: e.to, to: e.from, head: style.tail, tail: style.head, fromLabel: e.toLabel, toLabel: e.fromLabel };
    }),
  };
}

const overlaps = (a: DiagramNode, b: Omit<DiagramNode, 'id'>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A new node of the same shape and size next to `id` in `dir` (skipping past
 * anything already there), with an arrow to it. Builds lists and trees from
 * the keyboard.
 */
export function addNeighbor(
  d: Diagram,
  id: string,
  dir: Direction,
  grid: number,
  style: EdgeStyle = defaultEdgeStyle,
): { diagram: Diagram; id: string } | null {
  const from = findNode(d, id);
  if (!from) return null;
  const gap = grid * 3;
  const step = { x: 0, y: 0 };
  if (dir === 'left' || dir === 'right') step.x = (from.w + gap) * (dir === 'right' ? 1 : -1);
  else step.y = (from.h + gap) * (dir === 'down' ? 1 : -1);
  // Freehand figures continue as boxes.
  const shape = from.shape === 'path' ? 'box' : from.shape;
  const node = { shape, x: from.x + step.x, y: from.y + step.y, w: from.w, h: from.h, text: '' };
  for (let i = 0; i < 50 && d.nodes.some((n) => overlaps(n, node)); i++) {
    node.x += step.x;
    node.y += step.y;
  }
  const added = addNode(d, node);
  return { diagram: connect(added.diagram, id, added.id, style).diagram, id: added.id };
}

/** Distance from a point to a rectangle's edge (0 inside). */
export function distanceToRect(p: Point, n: DiagramNode): number {
  const dx = Math.max(n.x - p.x, 0, p.x - (n.x + n.w));
  const dy = Math.max(n.y - p.y, 0, p.y - (n.y + n.h));
  return Math.hypot(dx, dy);
}

/**
 * The node under `p`, or the nearest one within `tolerance` of it. Generous on
 * purpose: you shouldn't have to hit a figure exactly.
 */
export function nodeAt(
  d: Diagram,
  p: Point,
  tolerance: number,
  distanceTo: (n: DiagramNode, p: Point) => number = (n, q) => distanceToRect(q, n),
): DiagramNode | null {
  let best: DiagramNode | null = null;
  let bestDistance = Infinity;
  // Later nodes are drawn on top, so they win ties.
  for (const n of d.nodes) {
    const distance = distanceTo(n, p);
    if (distance <= tolerance && distance <= bestDistance) {
      best = n;
      bestDistance = distance;
    }
  }
  return best;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Bounding box of all nodes, or null for an empty drawing. */
export function bounds(d: Diagram): { x: number; y: number; w: number; h: number } | null {
  if (d.nodes.length === 0) return null;
  const x = Math.min(...d.nodes.map((n) => n.x));
  const y = Math.min(...d.nodes.map((n) => n.y));
  const right = Math.max(...d.nodes.map((n) => n.x + n.w));
  const bottom = Math.max(...d.nodes.map((n) => n.y + n.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Accept a parsed object as a Diagram if it looks like one (files may be old or hand-edited). */
export function normalizeDiagram(value: unknown): Diagram | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<Diagram>;
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
  const flag = (x: unknown) => (x === true ? true : undefined);
  const ends: EndKind[] = ['none', 'arrow', 'open', 'triangle', 'diamond', 'filledDiamond'];
  const end = (x: unknown) => (ends.includes(x as EndKind) ? (x as EndKind) : undefined);
  const route = (x: unknown) => (routes.includes(x as Route) ? (x as Route) : undefined);
  // Optional fields are only kept when set, so files stay small and tidy.
  const compact = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined)) as T;

  const nodes = v.nodes
    .filter((n): n is DiagramNode => typeof n === 'object' && n !== null && typeof n.id === 'string')
    .map((n) =>
      compact({
        id: n.id,
        shape: typeof n.shape === 'string' ? n.shape : 'box',
        x: num(n.x, 0),
        y: num(n.y, 0),
        w: Math.max(1, num(n.w, 160)),
        h: Math.max(1, num(n.h, 80)),
        text: typeof n.text === 'string' ? n.text : '',
        double: flag(n.double),
        dashed: flag(n.dashed),
        points: Array.isArray(n.points)
          ? n.points.filter((p) => typeof p?.x === 'number' && typeof p?.y === 'number').map((p) => ({ x: p.x, y: p.y }))
          : undefined,
        closed: flag(n.closed),
        smooth: n.smooth === false ? false : undefined,
        head: end(n.head),
        tail: end(n.tail),
        route: route(n.route),
        startAt: n.startAt,
        endAt: n.endAt,
      }),
    );
  const ids = new Set(nodes.map((n) => n.id));
  const step = (x: unknown) => x === -1 || x === 0 || x === 1;
  const unit = (p: unknown) => {
    const q = p as Partial<Point> | null;
    return typeof q === 'object' && q !== null && step(q.x) && step(q.y) && (q.x !== 0 || q.y !== 0);
  };
  const ref = (r: unknown, self: string): AnchorRef | undefined => {
    const a = r as Partial<AnchorRef> | null;
    return typeof a === 'object' && a !== null && typeof a.node === 'string' && a.node !== self && ids.has(a.node) &&
      Number.isInteger(a.anchor) && a.anchor! >= 0
      ? { node: a.node, anchor: a.anchor!, ...(unit(a.out) ? { out: { x: a.out!.x, y: a.out!.y } } : {}) }
      : undefined;
  };
  for (const n of nodes) {
    const [startAt, endAt] = [ref(n.startAt, n.id), ref(n.endAt, n.id)];
    delete n.startAt;
    delete n.endAt;
    Object.assign(n, compact({ startAt, endAt }));
  }
  const edges = v.edges
    .filter(
      (e): e is DiagramEdge =>
        typeof e === 'object' && e !== null && typeof e.id === 'string' && ids.has(e.from) && ids.has(e.to),
    )
    .map((e) =>
      compact({
        id: e.id,
        from: e.from,
        to: e.to,
        head: end(e.head),
        tail: end(e.tail),
        dashed: typeof e.dashed === 'boolean' ? e.dashed : undefined,
        double: flag(e.double),
        route: route(e.route),
        label: str(e.label),
        fromLabel: str(e.fromLabel),
        toLabel: str(e.toLabel),
      }),
    );
  return { version: 1, nodes, edges };
}
