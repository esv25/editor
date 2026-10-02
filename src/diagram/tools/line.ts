/**
 * Strek: a straight line anywhere, not tied to figures. Click where it starts,
 * click where it ends (both snap to half the grid). It's a freehand figure
 * with two points, so it moves, resizes and gets deleted like any figure.
 */
import { addNode, snap, type Point } from '../model';
import { pathNodeFrom } from '../shapes/path';
import { shapeIcon } from '../shapes/common';
import { h } from '../svg';
import type { Tool, ToolContext } from './types';

let start: Point | null = null;

const snapped = (ctx: ToolContext, p: Point) => ({ x: snap(p.x, ctx.grid / 2), y: snap(p.y, ctx.grid / 2) });

export const lineTool: Tool = {
  id: 'line',
  name: 'Strek',
  key: 'l',
  icon: shapeIcon('<path d="M4 20 20 4"/>'),

  hint: () => (start ? 'Klikk der streken skal slutte · Esc: avbryt' : 'Klikk der streken skal begynne'),

  pointerDown(ctx, p) {
    const q = snapped(ctx, p);
    if (!start) {
      start = q;
      ctx.refresh();
      return;
    }
    if (q.x === start.x && q.y === start.y) return;
    const added = addNode(ctx.diagram, pathNodeFrom([start, q], false));
    start = null;
    ctx.commit(added.diagram);
    ctx.select({ kind: 'node', id: added.id });
  },

  preview(ctx, pointer) {
    if (!start || !pointer) return {};
    const end = snapped(ctx, pointer);
    return { noHover: true, overlay: [h('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'dg-freehand' })] };
  },

  cancel(ctx) {
    if (!start) return false;
    start = null;
    ctx.refresh();
    return true;
  },

  reset() {
    start = null;
  },
};
