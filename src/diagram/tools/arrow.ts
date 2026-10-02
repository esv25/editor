/**
 * Pil: click the figure the line starts at, then the one it goes to. The
 * lines chain – the target becomes the next start – so a linked list is just
 * click, click, click. Clicking empty space makes a new figure there and
 * connects it. Esc (or right click) ends the chain. New lines get the type
 * chosen in the properties bar (Pil, Linje, Arv …).
 */
import { edgePresets, renderEdge } from '../edges';
import { addNode, center, connect, findNode, snap, type EdgeStyle, type Point } from '../model';
import { shapeFor } from '../shapes';
import { shapeIcon } from '../shapes/common';
import { toPreview } from './preview';
import type { Tool } from './types';

let source: string | null = null;
let style: EdgeStyle = edgePresets[0].style;

/** The type new lines get. */
export const newEdgeStyle = () => style;
export function setNewEdgeStyle(next: EdgeStyle): void {
  style = next;
}

/** The figure the next line starts from (highlighted by the canvas). */
export const arrowSource = () => source;

export const arrowTool: Tool = {
  id: 'arrow',
  name: 'Pil',
  key: 'p',
  icon: shapeIcon('<path d="M4 18 18 6M10 6h8v8"/>'),

  hint(ctx) {
    if (source && findNode(ctx.diagram, source)) {
      return 'Klikk figuren linja skal gå til – eller et tomt sted for en ny figur · Esc/høyreklikk: ferdig';
    }
    return 'Klikk figuren linja skal gå fra · velg type linje til høyre';
  },

  pointerDown(ctx, p) {
    const target = ctx.nodeAt(p);
    const from = source ? findNode(ctx.diagram, source) : undefined;
    if (!from) {
      source = target?.id ?? null;
      if (target) ctx.select({ kind: 'node', id: target.id });
      ctx.refresh();
      return;
    }
    if (target) {
      if (target.id === from.id) return;
      ctx.commit(connect(ctx.diagram, from.id, target.id, style).diagram);
      source = target.id;
      ctx.select({ kind: 'node', id: target.id });
      return;
    }
    // Empty space: a new figure like the one we came from, connected to it.
    const shape = shapeFor(from.shape === 'text' || from.shape === 'path' ? 'box' : from.shape);
    const { w, h } = shape.defaultSize;
    const added = addNode(ctx.diagram, {
      shape: shape.id,
      x: snap(p.x - w / 2, ctx.grid),
      y: snap(p.y - h / 2, ctx.grid),
      w,
      h,
      text: '',
    });
    ctx.commit(connect(added.diagram, from.id, added.id, style).diagram);
    source = added.id;
    ctx.select({ kind: 'node', id: added.id });
    ctx.editText(added.id);
  },

  preview(ctx, pointer) {
    const from = source ? findNode(ctx.diagram, source) : undefined;
    if (!from || !pointer) return {};
    const target = ctx.nodeAt(pointer);
    const end: Point = target && target.id !== from.id ? shapeFor(target.shape).boundary(target, center(from)) : pointer;
    const start = shapeFor(from.shape).boundary(from, target ? center(target) : pointer);
    return { overlay: [toPreview(renderEdge(style, start, end))] };
  },

  cancel(ctx) {
    if (!source) return false;
    source = null;
    ctx.refresh();
    return true;
  },

  reset() {
    source = null;
  },
};
