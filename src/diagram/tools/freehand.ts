/**
 * Frihånd with clicks instead of dragging: click points along the line, and a
 * smooth curve is drawn through them. Click the first point again to close
 * the shape; Enter, Esc or right click finishes an open line. Points snap to
 * half the grid, so small shakes don't show.
 */
import { addNode, type Point } from '../model';
import { anchorMark } from './line';
import { curveData, path, pathNodeFrom } from '../shapes/path';
import { h } from '../svg';
import type { Tool, ToolContext } from './types';

let points: Point[] = [];

function finish(ctx: ToolContext, closed: boolean): void {
  const done = points;
  points = [];
  if (done.length < 2) {
    ctx.refresh();
    return;
  }
  const added = addNode(ctx.diagram, pathNodeFrom(done, closed && done.length >= 3));
  ctx.commit(added.diagram);
  ctx.select({ kind: 'node', id: added.id });
}

// Corners of figures pull the point to them; otherwise half the grid.
const snapped = (ctx: ToolContext, p: Point) => ctx.snapPoint(p).point;
const near = (ctx: ToolContext, a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= Math.max(ctx.tolerance, ctx.grid / 2);

export const freehandTool: Tool = {
  id: 'path',
  name: path.name,
  key: path.key,
  icon: path.icon,

  hint: () =>
    points.length === 0
      ? 'Klikk der streken skal begynne'
      : points.length < 3
        ? 'Klikk neste punkt · Enter/Esc/høyreklikk: ferdig'
        : 'Klikk neste punkt · klikk første punkt for å lukke · Enter/Esc/høyreklikk: ferdig',

  pointerDown(ctx, p) {
    const q = snapped(ctx, p);
    if (points.length >= 3 && near(ctx, q, points[0])) {
      finish(ctx, true);
      return;
    }
    // Clicking the last point again (a double click) finishes too.
    if (points.length >= 2 && near(ctx, q, points[points.length - 1])) {
      finish(ctx, false);
      return;
    }
    if (points.length === 1 && near(ctx, q, points[0])) return;
    points = [...points, q];
    ctx.refresh();
  },

  preview(ctx, pointer) {
    if (!points.length) return {};
    const next = pointer ? snapped(ctx, pointer) : null;
    const closing = !!next && points.length >= 3 && near(ctx, next, points[0]);
    const all = next && !closing ? [...points, next] : points;
    // Same size on screen at any zoom (handleSize is 14 screen px).
    const r = (4 * ctx.handleSize) / 14;
    return {
      noHover: true,
      overlay: [
        h('path', { d: curveData(all, closing, true), class: 'dg-freehand' }),
        ...(pointer && ctx.snapPoint(pointer).anchored && !closing ? [anchorMark(ctx, ctx.snapPoint(pointer).point)] : []),
        ...points.map((p, i) => h('circle', { cx: p.x, cy: p.y, r: i === 0 && points.length >= 3 ? r * 1.8 : r, class: i === 0 ? 'dg-point-first' : 'dg-point' })),
      ],
    };
  },

  finish(ctx) {
    if (!points.length) return false;
    finish(ctx, false);
    return true;
  },

  cancel(ctx) {
    if (!points.length) return false;
    finish(ctx, false);
    return true;
  },

  reset() {
    points = [];
  },

  busy: () => points.length > 0,
};
