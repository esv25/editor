/**
 * Line ends fastened to figures. A Strek or freehand line whose first or last
 * point sits on one of a figure's snap points (the dots it jumps to) remembers
 * which one (`startAt`/`endAt`), and follows when that figure is moved or
 * resized. Moving the line itself fastens its ends anew: to the snap points
 * they then sit on, or to nothing.
 */
import type { AnchorRef, Diagram, DiagramNode, Point } from './model';
import { shapeFor } from './shapes';
import { rectAnchors } from './shapes/common';
import { absolutePoints, pathNodeFrom } from './shapes/path';

/** The points lines snap to on a figure. */
export const anchorsOf = (n: DiagramNode): Point[] => shapeFor(n.shape).anchors?.(n) ?? rectAnchors(n);

const isOpenLine = (n: DiagramNode) => n.shape === 'path' && !n.closed && (n.points?.length ?? 0) >= 2;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
const geometry = (n: DiagramNode) => JSON.stringify([n.x, n.y, n.w, n.h, n.points, !!n.closed]);

/** Where a fastened end should be, or null if the figure or point is gone. */
export function anchorPoint(d: Diagram, ref: AnchorRef): Point | null {
  const n = d.nodes.find((m) => m.id === ref.node);
  return (n && anchorsOf(n)[ref.anchor]) ?? null;
}

/** The ends of a line, fastened ones only. */
export function fastenedEnds(n: DiagramNode): Point[] {
  const points = absolutePoints(n);
  return [n.startAt ? points[0] : null, n.endAt ? points[points.length - 1] : null].filter((p): p is Point => !!p);
}

/** The snap point of another figure at `p`, if any. Figures win over lines (so a box carries both lines meeting at its corner). */
function anchorAt(d: Diagram, self: string, p: Point): AnchorRef | undefined {
  let found: AnchorRef | undefined;
  for (const n of d.nodes) {
    if (n.id === self) continue;
    const index = anchorsOf(n).findIndex((a) => same(a, p));
    if (index < 0) continue;
    if (n.shape !== 'path') return { node: n.id, anchor: index };
    found ??= { node: n.id, anchor: index };
  }
  return found;
}

/** The line with its first/last point moved (the points in between stay). */
function withEnds(n: DiagramNode, start: Point | null, end: Point | null): DiagramNode {
  const points = absolutePoints(n);
  const next = [...points];
  if (start) next[0] = start;
  if (end) next[next.length - 1] = end;
  if (next.every((p, i) => same(p, points[i]))) return n;
  const { x, y, w, h, points: fractions } = pathNodeFrom(next, false);
  return { ...n, x, y, w, h, points: fractions };
}

/** Move every fastened end to its snap point. Lines fastened to lines follow in turn (a few rounds; loops just stop). */
export function followAnchors(d: Diagram): Diagram {
  let current = d;
  for (let round = 0; round < 8; round++) {
    let changed = false;
    const nodes = current.nodes.map((n) => {
      if (!isOpenLine(n) || (!n.startAt && !n.endAt)) return n;
      const next = withEnds(n, n.startAt ? anchorPoint(current, n.startAt) : null, n.endAt ? anchorPoint(current, n.endAt) : null);
      if (next !== n) changed = true;
      return next;
    });
    if (!changed) return current;
    current = { ...current, nodes };
  }
  return current;
}

/**
 * `next` after a change from `prev` (already settled): lines that were drawn,
 * moved or resized themselves are fastened to the snap points their ends now
 * sit on; then every fastened end follows its figure.
 */
export function settleAnchors(prev: Diagram, next: Diagram): Diagram {
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  let changed = false;
  const nodes = next.nodes.map((n) => {
    const old = before.get(n.id);
    if (old && geometry(old) === geometry(n)) return n;
    const { startAt: _s, endAt: _e, ...rest } = n;
    let fastened: DiagramNode = rest;
    if (isOpenLine(n)) {
      const points = absolutePoints(n);
      const startAt = anchorAt(next, n.id, points[0]);
      const endAt = anchorAt(next, n.id, points[points.length - 1]);
      fastened = { ...rest, ...(startAt ? { startAt } : {}), ...(endAt ? { endAt } : {}) };
    }
    if (JSON.stringify([n.startAt, n.endAt]) === JSON.stringify([fastened.startAt, fastened.endAt])) return n;
    changed = true;
    return fastened;
  });
  return followAnchors(changed ? { ...next, nodes } : next);
}
