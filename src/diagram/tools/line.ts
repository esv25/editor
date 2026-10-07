/**
 * Strek: a straight line (or arrow) anywhere, not tied to figures. Click where
 * it starts, click where it ends. Near a figure's corner or side middle (or
 * another line's end) the point jumps there – shown by a ring – otherwise it
 * snaps to half the grid. The ends get the type chosen in the panel (Linje,
 * Pil, Arv …). It's a freehand figure with two points, so it moves, resizes
 * and is deleted like any figure.
 */
import { edgePresets, renderEdge } from '../edges';
import { addNode, type EdgeStyle, type Point } from '../model';
import { pathNodeFrom } from '../shapes/path';
import { shapeIcon } from '../shapes/common';
import { h, type SvgNode } from '../svg';
import type { Tool, ToolContext } from './types';

let start: { point: Point; anchored: boolean } | null = null;
let style: EdgeStyle = edgePresets.find((p) => p.id === 'line')!.style;

export const newLineStyle = () => style;
export function setNewLineStyle(next: EdgeStyle): void {
  style = next;
}

/** A ring around a point a line end has jumped to. */
export function anchorMark(ctx: ToolContext, p: Point): SvgNode {
  return h('circle', { cx: p.x, cy: p.y, r: (7 * ctx.handleSize) / 14, class: 'dg-anchor' });
}

export const lineTool: Tool = {
  id: 'line',
  name: 'Strek',
  key: 'l',
  icon: shapeIcon('<path d="M4 20 20 4"/>'),

  hint: () =>
    start
      ? 'Klikk der streken skal slutte (den hekter seg på hjørner og midtpunkter) · Esc: avbryt'
      : 'Klikk der streken skal begynne – nær et hjørne hekter den seg fast der · velg pil eller strek til høyre',

  pointerDown(ctx, p) {
    const q = ctx.snapPoint(p);
    if (!start) {
      start = q;
      ctx.refresh();
      return;
    }
    if (q.point.x === start.point.x && q.point.y === start.point.y) return;
    const ends = {
      ...(style.head !== 'none' ? { head: style.head } : {}),
      ...(style.tail !== 'none' ? { tail: style.tail } : {}),
      ...(style.dashed ? { dashed: true } : {}),
      ...(style.double ? { double: true } : {}),
    };
    const added = addNode(ctx.diagram, { ...pathNodeFrom([start.point, q.point], false), smooth: false, ...ends });
    start = null;
    ctx.commit(added.diagram);
    ctx.select({ kind: 'node', id: added.id });
  },

  preview(ctx, pointer) {
    if (!pointer) return { noHover: true };
    const end = ctx.snapPoint(pointer);
    const overlay: SvgNode[] = [];
    if (start) {
      overlay.push(h('g', { class: 'dg-ghost' }, [renderEdge(style, start.point, end.point)]));
      if (start.anchored) overlay.push(anchorMark(ctx, start.point));
    }
    if (end.anchored) overlay.push(anchorMark(ctx, end.point));
    return { noHover: true, overlay };
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

  busy: () => !!start,
};
