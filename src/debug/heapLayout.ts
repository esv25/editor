/**
 * Where the boxes of the data structure view go, and the arrows between them.
 * The calls stand in the first column; an object goes one column to the right
 * of whatever first points to it, in a band of its own – so a linked list runs
 * left to right, a tree spreads out to the right without crossing arrows, and
 * the chains of a hash table hang off their buckets.
 *
 * Pure logic: the view measures the boxes, this places them (tests/heap.test.ts).
 */
import type { HeapGraph } from './heap';

/** A box: a call ("f0", outermost first) or an object ("o" + id). */
export const frameBox = (i: number) => `f${i}`;
export const objectBox = (id: string) => `o${id}`;

export interface BoxSize {
  w: number;
  h: number;
  /** Centre of each entry's pointer dot, relative to the box (null: drawn in place). */
  dots: ({ x: number; y: number } | null)[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Arrow {
  /** The box and entry the pointer is in, and the object it points to. */
  from: string;
  entry: number;
  to: string;
  /** The object belongs elsewhere in the drawing (shared, or a cycle): drawn fainter. */
  shared: boolean;
  path: string;
}

export interface HeapLayout {
  boxes: Map<string, Rect>;
  arrows: Arrow[];
  width: number;
  height: number;
}

const PAD = 16;
const GAP_X = 56;
const GAP_Y = 18;

/**
 * The tree the boxes are laid out by: every object belongs to the pointer that
 * first reaches it (depth first, calls in order) and goes one column to its
 * right. Other pointers to it (shared objects, cycles) are drawn, but don't move it.
 */
export function heapTree(graph: HeapGraph): { columns: Map<string, number>; owner: Map<string, { box: string; entry: number }> } {
  const columns = new Map<string, number>();
  const owner = new Map<string, { box: string; entry: number }>();
  const visit = (from: string, entry: number, id: string, column: number) => {
    const box = objectBox(id);
    const o = graph.objects[id];
    if (!o || columns.has(box)) return;
    columns.set(box, column);
    owner.set(box, { box: from, entry });
    o.entries.forEach((e, i) => {
      if ('ref' in e.value) visit(box, i, e.value.ref, column + 1);
    });
  };
  graph.frames.forEach((frame, i) => {
    columns.set(frameBox(i), 0);
    frame.vars.forEach((v, n) => {
      if ('ref' in v.value) visit(frameBox(i), n, v.value.ref, 1);
    });
  });
  // Anything not reached (shouldn't happen) goes in a column of its own.
  const last = Math.max(0, ...columns.values()) + 1;
  for (const id of Object.keys(graph.objects)) if (!columns.has(objectBox(id))) columns.set(objectBox(id), last);
  return { columns, owner };
}

export const heapColumns = (graph: HeapGraph) => heapTree(graph).columns;

/** The pointers in a box, in order: [entry index, object id]. */
function pointers(graph: HeapGraph, box: string): [number, string][] {
  const values =
    box[0] === 'f' ? (graph.frames[Number(box.slice(1))]?.vars ?? []).map((v) => v.value) : (graph.objects[box.slice(1)]?.entries ?? []).map((e) => e.value);
  const out: [number, string][] = [];
  values.forEach((v, i) => {
    if ('ref' in v && graph.objects[v.ref]) out.push([i, v.ref]);
  });
  return out;
}

/**
 * Each structure gets a band of its own, laid out like a tree on its side: an
 * object's children to its right, one below the other, each with room for all
 * of its own – so the arrows of one structure never cross, nor run through
 * another's. The calls stand compactly in the first column.
 */
export function layoutHeap(graph: HeapGraph, sizes: Map<string, BoxSize>): HeapLayout {
  const { columns, owner } = heapTree(graph);
  const size = (box: string) => sizes.get(box) ?? { w: 80, h: 30, dots: [] };
  const owns = (box: string, entry: number, child: string) => {
    const o = owner.get(child);
    return !!o && o.box === box && o.entry === entry;
  };

  const widths: number[] = [];
  for (const [box, c] of columns) widths[c] = Math.max(widths[c] ?? 0, size(box).w);
  const xs: number[] = [];
  let x = PAD;
  for (let c = 0; c < widths.length; c++) {
    xs[c] = x;
    x += (widths[c] ?? 0) + GAP_X;
  }

  const boxes = new Map<string, Rect>();
  const put = (box: string, y: number) => {
    const { w, h } = size(box);
    boxes.set(box, { x: xs[columns.get(box)!], y, w, h });
  };
  /** Where a child's top goes: level with its pointer (its first line, roughly). */
  const levelWith = (box: string, y: number, entry: number, child: string) => {
    const dot = size(box).dots[entry];
    return dot ? y + dot.y - Math.min(14, size(child).h / 2) : y;
  };
  /** Place `box` and everything it owns from `top` down; gives the bottom of its band. */
  const placeTree = (box: string, top: number): number => {
    put(box, top);
    let bottom = top + size(box).h;
    let next = top;
    // An object's first child goes level with it, so a chain runs straight across;
    // a list's children go level with their pointers (a hash table's chains by their buckets).
    let first = graph.objects[box.slice(1)]?.kind === 'object';
    for (const [entry, id] of pointers(graph, box)) {
      const child = objectBox(id);
      if (!owns(box, entry, child)) continue;
      const hint = first ? top : levelWith(box, top, entry, child);
      first = false;
      const end = placeTree(child, Math.max(next, hint));
      next = end + GAP_Y;
      bottom = Math.max(bottom, end);
    }
    return bottom;
  };

  // The calls one below the other; each one's structures in bands below the ones before.
  let frameTop = PAD;
  let region = PAD;
  graph.frames.forEach((_, i) => {
    const frame = frameBox(i);
    put(frame, frameTop);
    for (const [entry, id] of pointers(graph, frame)) {
      const child = objectBox(id);
      if (!owns(frame, entry, child)) continue;
      region = placeTree(child, Math.max(region, levelWith(frame, frameTop, entry, child))) + GAP_Y;
    }
    frameTop += size(frame).h + GAP_Y;
  });
  for (const box of columns.keys()) if (!boxes.has(box)) region = placeTree(box, region) + GAP_Y;

  // Pointers to objects drawn elsewhere first, so the structures' own arrows lie on top.
  const arrows: Arrow[] = [];
  for (const [box, rect] of boxes) {
    for (const [entry, id] of pointers(graph, box)) {
      const dot = size(box).dots[entry];
      const target = boxes.get(objectBox(id));
      if (!dot || !target) continue;
      const shared = !owns(box, entry, objectBox(id));
      arrows.push({ from: box, entry, to: objectBox(id), shared, path: arrowPath({ x: rect.x + dot.x, y: rect.y + dot.y }, target) });
    }
  }
  arrows.sort((a, b) => Number(b.shared) - Number(a.shared));

  let width = 0;
  let height = 0;
  for (const r of boxes.values()) {
    width = Math.max(width, r.x + r.w + PAD);
    height = Math.max(height, r.y + r.h + PAD);
  }
  return { boxes, arrows, width, height };
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * From a pointer dot to an object: to its left side when it's further right
 * (straight across when level), otherwise round and down onto its top.
 */
export function arrowPath(from: { x: number; y: number }, to: Rect): string {
  if (to.x > from.x + 12) {
    const end = { x: to.x, y: Math.min(Math.max(from.y, to.y + 10), to.y + Math.max(10, to.h - 10)) };
    const bend = Math.max(20, (end.x - from.x) / 2);
    return `M${round(from.x)},${round(from.y)} C${round(from.x + bend)},${round(from.y)} ${round(end.x - bend)},${round(end.y)} ${round(end.x)},${round(end.y)}`;
  }
  const end = { x: to.x + Math.min(24, to.w / 2), y: to.y };
  const out = from.x + 36;
  const over = Math.max(4, Math.min(from.y, end.y) - 30);
  return `M${round(from.x)},${round(from.y)} C${round(out)},${round(from.y)} ${round(out)},${round(over)} ${round((out + end.x) / 2)},${round(over)} S${round(end.x)},${round(end.y - 30)} ${round(end.x)},${round(end.y)}`;
}
