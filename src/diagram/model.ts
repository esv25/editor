/**
 * The drawing's data: figures (nodes) and arrows (edges) between them.
 * Plain data, changed only through the pure functions here, so every change
 * is a new Diagram (easy undo, easy to test).
 */

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
}

export interface DiagramEdge {
  id: string;
  /** Node ids; the arrow head is at `to`. */
  from: string;
  to: string;
}

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

/** Remove nodes and every arrow touching them. */
export function removeNodes(d: Diagram, ids: string[]): Diagram {
  const gone = new Set(ids);
  return {
    ...d,
    nodes: d.nodes.filter((n) => !gone.has(n.id)),
    edges: d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
}

export function removeEdges(d: Diagram, ids: string[]): Diagram {
  const gone = new Set(ids);
  return { ...d, edges: d.edges.filter((e) => !gone.has(e.id)) };
}

/** Connect two nodes. No self-arrows, and no duplicate of an existing arrow. */
export function connect(d: Diagram, from: string, to: string): { diagram: Diagram; id: string | null } {
  if (from === to || !findNode(d, from) || !findNode(d, to)) return { diagram: d, id: null };
  const existing = d.edges.find((e) => e.from === from && e.to === to);
  if (existing) return { diagram: d, id: existing.id };
  const id = newId(d, 'e');
  return { diagram: { ...d, edges: [...d.edges, { id, from, to }] }, id };
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
): { diagram: Diagram; id: string } | null {
  const from = findNode(d, id);
  if (!from) return null;
  const gap = grid * 3;
  const step = { x: 0, y: 0 };
  if (dir === 'left' || dir === 'right') step.x = (from.w + gap) * (dir === 'right' ? 1 : -1);
  else step.y = (from.h + gap) * (dir === 'down' ? 1 : -1);
  const node = { shape: from.shape, x: from.x + step.x, y: from.y + step.y, w: from.w, h: from.h, text: '' };
  for (let i = 0; i < 50 && d.nodes.some((n) => overlaps(n, node)); i++) {
    node.x += step.x;
    node.y += step.y;
  }
  const added = addNode(d, node);
  return { diagram: connect(added.diagram, id, added.id).diagram, id: added.id };
}

/** Distance from a point to a rectangle's edge (0 inside). */
function distanceToRect(p: Point, n: DiagramNode): number {
  const dx = Math.max(n.x - p.x, 0, p.x - (n.x + n.w));
  const dy = Math.max(n.y - p.y, 0, p.y - (n.y + n.h));
  return Math.hypot(dx, dy);
}

/**
 * The node under `p`, or the nearest one within `tolerance` of it. Generous on
 * purpose: you shouldn't have to hit a figure exactly.
 */
export function nodeAt(d: Diagram, p: Point, tolerance: number): DiagramNode | null {
  let best: DiagramNode | null = null;
  let bestDistance = Infinity;
  // Later nodes are drawn on top, so they win ties.
  for (const n of d.nodes) {
    const distance = distanceToRect(p, n);
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
  const nodes = v.nodes
    .filter((n): n is DiagramNode => typeof n === 'object' && n !== null && typeof n.id === 'string')
    .map((n) => ({
      id: n.id,
      shape: typeof n.shape === 'string' ? n.shape : 'box',
      x: num(n.x, 0),
      y: num(n.y, 0),
      w: Math.max(1, num(n.w, 160)),
      h: Math.max(1, num(n.h, 80)),
      text: typeof n.text === 'string' ? n.text : '',
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = v.edges.filter(
    (e): e is DiagramEdge =>
      typeof e === 'object' && e !== null && typeof e.id === 'string' && ids.has(e.from) && ids.has(e.to),
  );
  return { version: 1, nodes, edges: edges.map(({ id, from, to }) => ({ id, from, to })) };
}
