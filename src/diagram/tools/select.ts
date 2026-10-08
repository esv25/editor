/**
 * Velg and Marker share this: click to select, drag to move (every selected
 * figure moves together), drag the corner handle of a lone figure to resize
 * it (all snap to the grid). A press only becomes a drag after the pointer
 * has moved a little (`settings.diagram.dragThreshold`), so a shaky click
 * never moves anything. Esc while dragging puts things back.
 *
 * - Velg: a click selects just that; Shift/Ctrl+click adds or takes away;
 *   dragging empty space moves the view (Shift/Ctrl+drag: mark an area).
 * - Marker: every click adds or takes away (no keys to hold), and dragging
 *   empty space marks everything the rectangle touches.
 */
import { edgesBetween, findNode, moveNodes, nodesInRect, snap, updateNode, type Point } from '../model';
import { h } from '../svg';
import { shapeIcon } from '../shapes/common';
import { sameItem, type PointerKeys, type Selection, type Tool, type ToolContext } from './types';

type Mode =
  | { kind: 'idle' }
  /**
   * Button down on a figure; `dragging` once it has moved far enough. `ids`
   * all move with `grab` (the one under the pointer). `onClick`: what a
   * release without dragging does to the selection.
   */
  | { kind: 'move'; grab: string; ids: string[]; start: Point; dx: number; dy: number; dragging: boolean; onClick?: () => void }
  | { kind: 'resize'; id: string; start: Point; dragging: boolean }
  /** Button down on empty space: dragging moves the view, holding `start` under the pointer. */
  | { kind: 'pan'; start: Point; dragging: boolean }
  /** Marking an area: `base` was selected before (kept, the area adds to it). */
  | { kind: 'area'; start: Point; end: Point; base: Selection[]; dragging: boolean };

const has = (selection: readonly Selection[], item: Selection) => selection.some((s) => sameItem(s, item));

const toggle = (ctx: ToolContext, item: Selection) =>
  ctx.select(has(ctx.selection, item) ? ctx.selection.filter((s) => !sameItem(s, item)) : [...ctx.selection, item]);

const selectedNodeIds = (ctx: ToolContext) => ctx.selection.filter((s) => s.kind === 'node').map((s) => s.id);

/** The bottom-right corner of the selected figure (only when it's alone), if `p` is on it. */
function onHandle(ctx: ToolContext, p: Point): string | null {
  const only = ctx.selection.length === 1 ? ctx.selection[0] : null;
  if (only?.kind !== 'node') return null;
  const node = findNode(ctx.diagram, only.id);
  if (!node) return null;
  const reach = Math.max(ctx.handleSize, ctx.tolerance * 0.75);
  return Math.abs(p.x - (node.x + node.w)) <= reach && Math.abs(p.y - (node.y + node.h)) <= reach ? node.id : null;
}

/** Selection hints shared by both tools. */
function selectionHint(ctx: ToolContext, marking: boolean): string | null {
  const nodes = ctx.selection.filter((s) => s.kind === 'node').length;
  const count = ctx.selection.length;
  if (count > 1) {
    const what = nodes === count ? `${count} figurer valgt` : `${count} ting valgt`;
    const more = marking ? 'klikk: legg til / ta bort' : 'Shift/Ctrl+klikk: legg til / ta bort';
    return `${what} · dra en av dem (eller piltastene): flytt alle · Delete: slett alle · ${more} · Esc: fjern markeringen`;
  }
  return null;
}

function makeSelectTool(tool: { id: string; name: string; key: string; icon: string; marking: boolean }): Tool {
  let mode: Mode = { kind: 'idle' };

  /** The drawing with the drag so far applied, or null if nothing has moved. */
  const change = (ctx: ToolContext, p: Point) => {
    if (mode.kind === 'move' && mode.dragging) {
      const grabbed = findNode(ctx.diagram, mode.grab);
      if (!grabbed) return null;
      const dx = snap(p.x - mode.dx, ctx.grid) - grabbed.x;
      const dy = snap(p.y - mode.dy, ctx.grid) - grabbed.y;
      return moveNodes(ctx.diagram, mode.ids, dx, dy);
    }
    if (mode.kind === 'resize' && mode.dragging) {
      const node = findNode(ctx.diagram, mode.id);
      if (!node) return null;
      const min = ctx.grid * 2;
      return updateNode(ctx.diagram, mode.id, {
        w: Math.max(min, snap(p.x - node.x, ctx.grid)),
        h: Math.max(min, snap(p.y - node.y, ctx.grid)),
      });
    }
    return null;
  };

  /** Select what the marked area touches (live, while dragging). */
  const markArea = (ctx: ToolContext) => {
    if (mode.kind !== 'area') return;
    const nodes = nodesInRect(ctx.diagram, mode.start, mode.end).map((n) => n.id);
    const items: Selection[] = [
      ...nodes.map((id) => ({ kind: 'node' as const, id })),
      ...edgesBetween(ctx.diagram, nodes).map((e) => ({ kind: 'edge' as const, id: e.id })),
    ];
    const base = mode.base;
    ctx.select([...base, ...items.filter((item) => !has(base, item))]);
  };

  const startMove = (ctx: ToolContext, p: Point, grab: string, onClick?: () => void) => {
    const node = findNode(ctx.diagram, grab)!;
    const ids = selectedNodeIds(ctx);
    mode = { kind: 'move', grab, ids: ids.includes(grab) ? ids : [grab], start: p, dx: p.x - node.x, dy: p.y - node.y, dragging: false, onClick };
  };

  return {
    id: tool.id,
    name: tool.name,
    key: tool.key,
    icon: tool.icon,

    hint(ctx) {
      if (mode.kind === 'move' && mode.dragging) {
        return `Slipp der ${mode.ids.length > 1 ? 'figurene' : 'figuren'} skal stå (nær kanten ruller visningen) · Esc: avbryt`;
      }
      if (mode.kind === 'resize' && mode.dragging) return 'Slipp der hjørnet skal være · Esc: avbryt';
      if (mode.kind === 'pan' && mode.dragging) return 'Dra for å flytte visningen · slipp når du ser det du vil';
      if (mode.kind === 'area' && mode.dragging) return 'Alt rektangelet berører blir valgt · slipp for å velge · Esc: avbryt';
      const several = selectionHint(ctx, tool.marking);
      if (several) return several;
      if (tool.marking) {
        return 'Klikk på figurer og linjer for å velge flere · dra på et tomt sted: marker et område · dra en valgt figur: flytt alle';
      }
      const only = ctx.selection[0];
      if (only?.kind === 'node') {
        return 'Dra figuren for å flytte den · dra hjørnet: endre størrelse · Enter: skriv tekst · Ctrl+pil: ny figur ved siden av · Shift+klikk: velg flere · Delete: slett';
      }
      if (only?.kind === 'edge') return 'Velg type linje til høyre · Enter: tekst midt på · Shift+klikk: velg flere · Delete: slett linja';
      return 'Klikk på en figur for å velge den, dra for å flytte den · dra på et tomt sted (eller piltastene): flytt visningen · Shift+dra eller Marker: velg flere';
    },

    pointerDown(ctx, p, keys: PointerKeys = { add: false }) {
      const add = tool.marking || keys.add;
      const handle = add ? null : onHandle(ctx, p);
      if (handle) {
        mode = { kind: 'resize', id: handle, start: p, dragging: false };
        return;
      }
      const node = ctx.nodeAt(p);
      if (node) {
        const item: Selection = { kind: 'node', id: node.id };
        if (add) {
          // Not selected yet: add it now (so it moves with the rest). Already selected: a click takes it away, a drag moves them all.
          if (!has(ctx.selection, item)) {
            ctx.select([...ctx.selection, item]);
            startMove(ctx, p, node.id);
          } else startMove(ctx, p, node.id, () => toggle(ctx, item));
        } else if (has(ctx.selection, item) && ctx.selection.length > 1) {
          // Part of a group: dragging moves the group, a click picks just this one.
          startMove(ctx, p, node.id, () => ctx.select(item));
        } else {
          ctx.select(item);
          startMove(ctx, p, node.id);
        }
        return;
      }
      const edge = ctx.edgeAt(p);
      if (edge) {
        const item: Selection = { kind: 'edge', id: edge.id };
        if (add) toggle(ctx, item);
        else ctx.select(item);
        return;
      }
      if (add) {
        mode = { kind: 'area', start: p, end: p, base: [...ctx.selection], dragging: false };
        return;
      }
      ctx.select(null);
      mode = { kind: 'pan', start: p, dragging: false };
    },

    pointerMove(ctx, p) {
      if (mode.kind === 'idle') return;
      if (!mode.dragging) {
        if (Math.hypot(p.x - mode.start.x, p.y - mode.start.y) < ctx.dragThreshold) return;
        mode.dragging = true;
        ctx.refresh();
      }
      if (mode.kind === 'pan') ctx.panBy(mode.start.x - p.x, mode.start.y - p.y);
      if (mode.kind === 'area') {
        mode.end = p;
        markArea(ctx);
      }
    },

    pointerUp(ctx, p) {
      const done = change(ctx, p);
      const click = mode.kind === 'move' && !mode.dragging ? mode.onClick : undefined;
      mode = { kind: 'idle' };
      if (done) ctx.commit(done);
      else if (click) click();
      else ctx.refresh();
    },

    preview(ctx, pointer) {
      if (!pointer || mode.kind === 'idle') return {};
      if (mode.kind === 'pan') return mode.dragging ? { noHover: true } : {};
      if (mode.kind === 'area') {
        if (!mode.dragging) return {};
        const { start, end } = mode;
        const rect = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
        return { noHover: true, overlay: [h('rect', { ...rect, class: 'dg-area' })] };
      }
      const done = change(ctx, pointer);
      return done ? { diagram: done, noHover: true } : {};
    },

    cancel(ctx) {
      if (mode.kind === 'idle' || !mode.dragging) return false;
      if (mode.kind === 'area') ctx.select(mode.base);
      mode = { kind: 'idle' };
      ctx.refresh();
      return true;
    },

    reset() {
      mode = { kind: 'idle' };
    },

    busy: () => (mode.kind === 'move' || mode.kind === 'resize' || mode.kind === 'area') && mode.dragging,
  };
}

export const selectTool = makeSelectTool({
  id: 'select',
  name: 'Velg',
  key: 'v',
  icon: shapeIcon('<path d="m5 3 14 8-6 1.5L10 19z"/>'),
  marking: false,
});

export const markTool = makeSelectTool({
  id: 'mark',
  name: 'Marker',
  key: 'm',
  icon: shapeIcon('<rect x="3" y="3" width="13" height="13" rx="1" stroke-dasharray="3 2.5"/><path d="m12 12 9 5-4 1-1.5 4z"/>'),
  marking: true,
});

/** Velg and Marker: the tools where the selection is what you work on. */
export const isSelectingTool = (t: Tool) => t === selectTool || t === markTool;
