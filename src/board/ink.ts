/**
 * Pen strokes on the board («penn»): pure geometry, no DOM.
 *
 * A stroke is a node of type 'drawing' (not part of JSON Canvas; other
 * programs leave it out) whose `points` are fractions of its box, like
 * freehand figures in the drawing window: moving the node moves the stroke,
 * resizing it stretches the stroke, and the line keeps its width.
 */
import { newId, type BoardNode } from './model';

export interface Point {
  x: number;
  y: number;
}

export const isDrawing = (node: BoardNode) => node.type === 'drawing';

/** Pen widths offered in the menu (board px). */
export const INK_WIDTHS: { width: number; name: string }[] = [
  { width: 2, name: 'Tynn' },
  { width: 4, name: 'Middels' },
  { width: 8, name: 'Tykk' },
];
export const DEFAULT_INK_WIDTH = 4;

/** Drop points closer than `minDist` to the last one kept (a hand that rests shakes). */
export function thin(points: Point[], minDist: number): Point[] {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (const p of points.slice(1, -1)) {
    const last = out[out.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Fewer points, same shape (Ramer–Douglas–Peucker): wobbles smaller than `epsilon` go. */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  const len = Math.hypot(last.x - first.x, last.y - first.y);
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d =
      len === 0
        ? Math.hypot(p.x - first.x, p.y - first.y)
        : Math.abs((last.x - first.x) * (first.y - p.y) - (first.x - p.x) * (last.y - first.y)) / len;
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= epsilon) return [first, last];
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
}

const f = (n: number) => Math.round(n * 10) / 10;

/** A smooth SVG path through the points (Catmull–Rom curves). One point is a dot. */
export function smoothPath(points: Point[]): string {
  if (!points.length) return '';
  const [p0] = points;
  if (points.length === 1) return `M ${f(p0.x)} ${f(p0.y)} l 0.01 0`;
  if (points.length === 2) return `M ${f(p0.x)} ${f(p0.y)} L ${f(points[1].x)} ${f(points[1].y)}`;
  let d = `M ${f(p0.x)} ${f(p0.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const c = points[i + 1];
    const e = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6 };
    const c2 = { x: c.x - (e.x - b.x) / 6, y: c.y - (e.y - b.y) / 6 };
    d += ` C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(c.x)} ${f(c.y)}`;
  }
  return d;
}

/** The board points of a hand-drawn line, cleaned: no resting shakes, small wobbles smoothed out. */
export function cleanStroke(points: Point[], zoom = 1): Point[] {
  return simplify(thin(points, 2 / zoom), 0.8 / zoom);
}

/** A stroke as a node: the box around the points (with room for the line's width), points as fractions of it. */
export function inkNode(points: Point[], opts: { width?: number; color?: string; id?: string } = {}): BoardNode {
  const width = opts.width ?? DEFAULT_INK_WIDTH;
  const pad = width;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const node: BoardNode = {
    id: opts.id ?? newId(),
    type: 'drawing',
    x,
    y,
    width: w,
    height: h,
    points: points.map((p) => [round((p.x - x) / w), round((p.y - y) / h)]),
    strokeWidth: width,
  };
  if (opts.color) node.color = opts.color;
  return node;
}

/** A stroke's points, relative to its box (as drawn in it). */
export function inkPoints(node: BoardNode): Point[] {
  const raw = Array.isArray(node.points) ? (node.points as unknown[]) : [];
  return raw
    .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
    .map(([fx, fy]) => ({ x: fx * node.width, y: fy * node.height }));
}

/** The stroke's line width (a sane default for anything odd in the file). */
export function inkWidth(node: BoardNode): number {
  const w = node.strokeWidth;
  return typeof w === 'number' && w > 0 && w < 100 ? w : DEFAULT_INK_WIDTH;
}
