/**
 * Velg: click a figure to select it; drag it to move it, drag its corner
 * handle to resize it (both snap to the grid). A press only becomes a drag
 * after the pointer has moved a little (`settings.diagram.dragThreshold`), so
 * a shaky click never moves anything. Esc while dragging puts it back.
 */
import { findNode, snap, updateNode, type Point } from '../model';
import { shapeIcon } from '../shapes/common';
import type { Tool, ToolContext } from './types';

type Mode =
  | { kind: 'idle' }
  /** Button down on a figure (or its corner); `dragging` once it has moved far enough. */
  | { kind: 'move' | 'resize'; id: string; start: Point; dx: number; dy: number; dragging: boolean };

let mode: Mode = { kind: 'idle' };

/** The bottom-right corner of the selected figure, if `p` is on it. */
function onHandle(ctx: ToolContext, p: Point): string | null {
  if (ctx.selection?.kind !== 'node') return null;
  const node = findNode(ctx.diagram, ctx.selection.id);
  if (!node) return null;
  const reach = Math.max(ctx.handleSize, ctx.tolerance * 0.75);
  return Math.abs(p.x - (node.x + node.w)) <= reach && Math.abs(p.y - (node.y + node.h)) <= reach ? node.id : null;
}

/** The figure's position or size with the pointer at `p`. */
function change(ctx: ToolContext, p: Point) {
  if (mode.kind === 'idle' || !mode.dragging) return null;
  if (mode.kind === 'move') return { x: snap(p.x - mode.dx, ctx.grid), y: snap(p.y - mode.dy, ctx.grid) };
  const node = findNode(ctx.diagram, mode.id);
  if (!node) return null;
  const min = ctx.grid * 2;
  return { w: Math.max(min, snap(p.x - node.x, ctx.grid)), h: Math.max(min, snap(p.y - node.y, ctx.grid)) };
}

export const selectTool: Tool = {
  id: 'select',
  name: 'Velg',
  key: 'v',
  icon: shapeIcon('<path d="m5 3 14 8-6 1.5L10 19z"/>'),

  hint(ctx) {
    if (mode.kind === 'move' && mode.dragging) return 'Slipp der figuren skal stå · Esc: avbryt';
    if (mode.kind === 'resize' && mode.dragging) return 'Slipp der hjørnet skal være · Esc: avbryt';
    if (ctx.selection?.kind === 'node') {
      return 'Dra figuren for å flytte den · dra hjørnet: endre størrelse · Enter: skriv tekst · Ctrl+pil: ny figur ved siden av · Delete: slett';
    }
    if (ctx.selection?.kind === 'edge') return 'Velg type linje til høyre · Enter: tekst midt på · Delete: slett linja';
    return 'Klikk på en figur for å velge den, dra for å flytte den – eller velg et verktøy for å tegne';
  },

  pointerDown(ctx, p) {
    const handle = onHandle(ctx, p);
    if (handle) {
      mode = { kind: 'resize', id: handle, start: p, dx: 0, dy: 0, dragging: false };
      return;
    }
    const node = ctx.nodeAt(p);
    if (node) {
      ctx.select({ kind: 'node', id: node.id });
      mode = { kind: 'move', id: node.id, start: p, dx: p.x - node.x, dy: p.y - node.y, dragging: false };
      return;
    }
    const edge = ctx.edgeAt(p);
    ctx.select(edge ? { kind: 'edge', id: edge.id } : null);
  },

  pointerMove(ctx, p) {
    if (mode.kind === 'idle' || mode.dragging) return;
    if (Math.hypot(p.x - mode.start.x, p.y - mode.start.y) >= ctx.dragThreshold) {
      mode.dragging = true;
      ctx.refresh();
    }
  },

  pointerUp(ctx, p) {
    const done = change(ctx, p);
    const id = mode.kind === 'idle' ? null : mode.id;
    mode = { kind: 'idle' };
    if (done && id) ctx.commit(updateNode(ctx.diagram, id, done));
    else ctx.refresh();
  },

  preview(ctx, pointer) {
    if (!pointer || mode.kind === 'idle') return {};
    const done = change(ctx, pointer);
    return done ? { diagram: updateNode(ctx.diagram, mode.id, done), noHover: true } : {};
  },

  cancel(ctx) {
    if (mode.kind === 'idle' || !mode.dragging) return false;
    mode = { kind: 'idle' };
    ctx.refresh();
    return true;
  },

  reset() {
    mode = { kind: 'idle' };
  },
};
