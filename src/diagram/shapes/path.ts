/**
 * Freehand made from clicked points: a smooth curve (or straight lines)
 * through them, open or closed. The points are stored as fractions of the
 * figure's box, so moving and resizing work like for any other figure.
 */
import { distanceToSegment, type DiagramNode, type Point } from '../model';
import { h } from '../svg';
import { label, outline, rectBoundary, shapeIcon } from './common';
import type { ShapeType } from './types';

/** The node's points in drawing coordinates. */
export function absolutePoints(node: DiagramNode): Point[] {
  return (node.points ?? []).map((p) => ({ x: node.x + p.x * node.w, y: node.y + p.y * node.h }));
}

/** A figure for points clicked on the canvas. */
export function pathNodeFrom(points: Point[], closed: boolean): Omit<DiagramNode, 'id'> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x);
  const h = Math.max(1, Math.max(...ys) - y);
  return {
    shape: 'path',
    x,
    y,
    w,
    h,
    text: '',
    points: points.map((p) => ({ x: (p.x - x) / w, y: (p.y - y) / h })),
    ...(closed ? { closed: true } : {}),
  };
}

type Segment = [Point, Point, Point, Point];

/** Cubic Bézier segments of a Catmull-Rom curve through the points. */
function bezierSegments(points: Point[], closed: boolean): Segment[] {
  const n = points.length;
  const at = (i: number) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const segments: Segment[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    segments.push([
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return segments;
}

/** SVG path data through the points. */
export function curveData(points: Point[], closed: boolean, smooth: boolean): string {
  if (points.length === 0) return '';
  const f = (p: Point) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
  if (!smooth || points.length < 3) {
    return `M${points.map(f).join(' L')}${closed ? ' Z' : ''}`;
  }
  const segments = bezierSegments(points, closed);
  return `M${f(points[0])}${segments.map(([, c1, c2, p]) => ` C${f(c1)} ${f(c2)} ${f(p)}`).join('')}${closed ? ' Z' : ''}`;
}

/** The curve as many short straight pieces (for clicking near it). */
function sample(node: DiagramNode): Point[] {
  const points = absolutePoints(node);
  if (node.smooth === false || points.length < 3) return node.closed ? [...points, points[0]] : points;
  const out: Point[] = [points[0]];
  for (const [p0, c1, c2, p1] of bezierSegments(points, !!node.closed)) {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
      });
    }
  }
  return out;
}

function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

export const path: ShapeType = {
  id: 'path',
  name: 'Frihånd',
  definite: 'streken',
  icon: shapeIcon('<path d="M3 17c3-6 5-9 8-6s4 4 7-1 3-4 3-4"/>'),
  key: 'f',
  defaultSize: { w: 120, h: 80 },
  ownTool: true,
  render: (node) =>
    h('g', {}, [
      h('path', {
        d: curveData(absolutePoints(node), !!node.closed, node.smooth !== false),
        ...outline(node),
        fill: node.closed ? outline(node)!.fill : 'none',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
      ...label(node),
    ]),
  boundary: rectBoundary,
  distance(node, p) {
    const points = sample(node);
    if (node.closed && points.length > 2 && inside(p, points)) return 0;
    let best = Infinity;
    for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
    return points.length === 1 ? Math.hypot(p.x - points[0].x, p.y - points[0].y) : best;
  },
};
