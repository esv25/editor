/**
 * How a line goes from one end to the other: straight (possibly slanted), or
 * with right-angled corners so it never slants – sideways first, then up/down
 * ('hv'), or up/down first ('vh'). Pure geometry, shared by lines between
 * figures and free lines (Strek).
 */
import type { Point } from './model';

/** Undefined (in files and on lines) means straight. */
export type Route = 'hv' | 'vh';
export const routes: Route[] = ['hv', 'vh'];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** Drop repeated points and middle points on a straight stretch (so corners are real corners). */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length && same(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const [a, b] = [out[out.length - 2], out[out.length - 1]];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const forward = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0;
      if (Math.abs(cross) < 1e-9 && forward) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** A line from a to b: straight, or with one corner. */
export function cornerPath(a: Point, b: Point, route: Route | undefined): Point[] {
  if (route === 'hv') return simplify([a, { x: b.x, y: a.y }, b]);
  if (route === 'vh') return simplify([a, { x: a.x, y: b.y }, b]);
  return simplify([a, b]);
}

/**
 * The way between two figures, from centre to centre (the caller cuts the
 * ends off at the outlines). Diagonally apart: one corner, as chosen. Side by
 * side or one above the other, a single corner would run through a figure, so
 * the line goes straight out, turns halfway across the gap and goes straight in.
 * Overlapping figures: straight.
 */
export function routeBetween(from: Box, to: Box, route: Route | undefined): Point[] {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const overlapX = from.x < to.x + to.w && to.x < from.x + from.w;
  const overlapY = from.y < to.y + to.h && to.y < from.y + from.h;
  if (!route || (overlapX && overlapY)) return [a, b];
  if (!overlapX && !overlapY) return cornerPath(a, b, route);
  if (!overlapX) {
    const x = from.x < to.x ? (from.x + from.w + to.x) / 2 : (to.x + to.w + from.x) / 2;
    return simplify([a, { x, y: a.y }, { x, y: b.y }, b]);
  }
  const y = from.y < to.y ? (from.y + from.h + to.y) / 2 : (to.y + to.h + from.y) / 2;
  return simplify([a, { x: a.x, y }, { x: b.x, y }, b]);
}

export function polylineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

/** The point `distance` along the line from its start. */
export function pointAlong(points: Point[], distance: number): Point {
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const piece = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= piece && piece > 0) return { x: a.x + ((b.x - a.x) * left) / piece, y: a.y + ((b.y - a.y) * left) / piece };
    left -= piece;
  }
  return points[points.length - 1];
}

/** The line with `start` cut off its beginning and `end` off its end, or null if nothing is left. */
export function trim(points: Point[], start: number, end: number): Point[] | null {
  const length = polylineLength(points);
  if (points.length < 2 || length <= start + end) return null;
  const out: Point[] = [pointAlong(points, start)];
  let walked = 0;
  for (let i = 1; i < points.length - 1; i++) {
    walked += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (walked > start && walked < length - end) out.push(points[i]);
  }
  out.push(pointAlong(points, length - end));
  return out;
}

/** The same line moved `offset` to its left (seen along the line), with sharp corners. */
export function offsetPolyline(points: Point[], offset: number): Point[] {
  const normal = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  };
  return points.map((p, i) => {
    const before = i > 0 ? normal(points[i - 1], p) : null;
    const after = i < points.length - 1 ? normal(p, points[i + 1]) : null;
    if (!before || !after) {
      const n = (before ?? after)!;
      return { x: p.x + n.x * offset, y: p.y + n.y * offset };
    }
    const sum = { x: before.x + after.x, y: before.y + after.y };
    const length = Math.hypot(sum.x, sum.y) || 1;
    const miter = { x: sum.x / length, y: sum.y / length };
    const scale = offset / Math.max(0.2, miter.x * before.x + miter.y * before.y);
    return { x: p.x + miter.x * scale, y: p.y + miter.y * scale };
  });
}
