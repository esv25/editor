/**
 * Pil: click the figure the arrow starts at, then the one it goes to. The
 * arrows chain – the target becomes the next start – so a linked list is just
 * click, click, click. Clicking empty space makes a new box there and
 * connects it. Esc ends the chain.
 */
import { addNode, center, connect, findNode, snap, type Point } from '../model';
import { arrow } from '../render';
import { shapeFor } from '../shapes';
import { shapeIcon } from '../shapes/common';
import { toPreview } from './preview';
import type { Tool } from './types';

let source: string | null = null;

export const arrowTool: Tool = {
  id: 'arrow',
  name: 'Pil',
  key: 'p',
  icon: shapeIcon('<path d="M4 18 18 6M10 6h8v8"/>'),

  hint(ctx) {
    if (source && findNode(ctx.diagram, source)) {
      return 'Klikk figuren pila skal gå til – eller et tomt sted for en ny boks · Esc: ferdig';
    }
    return 'Klikk figuren pila skal gå fra';
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
      ctx.commit(connect(ctx.diagram, from.id, target.id).diagram);
      source = target.id;
      ctx.select({ kind: 'node', id: target.id });
      return;
    }
    // Empty space: a new figure like the one we came from, connected to it.
    const shape = shapeFor(from.shape === 'text' ? 'box' : from.shape);
    const { w, h } = shape.defaultSize;
    const added = addNode(ctx.diagram, {
      shape: shape.id,
      x: snap(p.x - w / 2, ctx.grid),
      y: snap(p.y - h / 2, ctx.grid),
      w,
      h,
      text: '',
    });
    ctx.commit(connect(added.diagram, from.id, added.id).diagram);
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
    return { overlay: [toPreview(arrow(start, end))] };
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

/** The figure the next arrow starts from (highlighted by the canvas). */
export const arrowSource = () => source;
