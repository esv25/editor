/**
 * Velg: click a figure to select it. Click it again to pick it up – it follows
 * the pointer – and click where it should go. The corner handle works the
 * same way for resizing. No dragging needed.
 */
import { findNode, snap, updateNode, type Point } from '../model';
import { shapeIcon } from '../shapes/common';
import type { Tool, ToolContext } from './types';

type Mode = { kind: 'idle' } | { kind: 'moving'; id: string; dx: number; dy: number } | { kind: 'resizing'; id: string };

let mode: Mode = { kind: 'idle' };

/** The bottom-right corner of the selected figure, if `p` is on it. */
function onHandle(ctx: ToolContext, p: Point): string | null {
  if (ctx.selection?.kind !== 'node') return null;
  const node = findNode(ctx.diagram, ctx.selection.id);
  if (!node) return null;
  const reach = Math.max(ctx.handleSize, ctx.tolerance * 0.75);
  return Math.abs(p.x - (node.x + node.w)) <= reach && Math.abs(p.y - (node.y + node.h)) <= reach ? node.id : null;
}

function moved(ctx: ToolContext, p: Point) {
  if (mode.kind !== 'moving') return null;
  return { x: snap(p.x - mode.dx, ctx.grid), y: snap(p.y - mode.dy, ctx.grid) };
}

function resized(ctx: ToolContext, p: Point) {
  if (mode.kind !== 'resizing') return null;
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
    if (mode.kind === 'moving') return 'Klikk der figuren skal stå · Esc: avbryt';
    if (mode.kind === 'resizing') return 'Klikk der hjørnet skal være · Esc: avbryt';
    if (ctx.selection?.kind === 'node') {
      return 'Klikk figuren igjen for å flytte den · hjørnet: endre størrelse · Enter: skriv tekst · Ctrl+pil: ny figur ved siden av · Delete: slett';
    }
    if (ctx.selection?.kind === 'edge') return 'Delete: slett pila';
    return 'Klikk på en figur for å velge den, eller velg et verktøy for å tegne';
  },

  pointerDown(ctx, p) {
    if (mode.kind === 'moving') {
      const pos = moved(ctx, p)!;
      const id = mode.id;
      mode = { kind: 'idle' };
      ctx.commit(updateNode(ctx.diagram, id, pos));
      return;
    }
    if (mode.kind === 'resizing') {
      const size = resized(ctx, p);
      const id = mode.id;
      mode = { kind: 'idle' };
      if (size) ctx.commit(updateNode(ctx.diagram, id, size));
      return;
    }
    const handle = onHandle(ctx, p);
    if (handle) {
      mode = { kind: 'resizing', id: handle };
      ctx.refresh();
      return;
    }
    const node = ctx.nodeAt(p);
    if (node) {
      if (ctx.selection?.kind === 'node' && ctx.selection.id === node.id) {
        mode = { kind: 'moving', id: node.id, dx: p.x - node.x, dy: p.y - node.y };
        ctx.refresh();
      } else {
        ctx.select({ kind: 'node', id: node.id });
      }
      return;
    }
    const edge = ctx.edgeAt(p);
    ctx.select(edge ? { kind: 'edge', id: edge.id } : null);
  },

  preview(ctx, pointer) {
    if (!pointer) return {};
    if (mode.kind === 'moving') return { diagram: updateNode(ctx.diagram, mode.id, moved(ctx, pointer)!), noHover: true };
    if (mode.kind === 'resizing') {
      const size = resized(ctx, pointer);
      return size ? { diagram: updateNode(ctx.diagram, mode.id, size), noHover: true } : {};
    }
    return {};
  },

  cancel(ctx) {
    if (mode.kind === 'idle') return false;
    mode = { kind: 'idle' };
    ctx.refresh();
    return true;
  },

  reset() {
    mode = { kind: 'idle' };
  },
};
