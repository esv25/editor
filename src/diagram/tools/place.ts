/**
 * A tool per figure type: a ghost of the figure follows the pointer (snapped
 * to the grid, or lined up with other figures), a click puts it there and
 * starts typing its text. The tool stays on, so several figures can be placed in a row.
 */
import { alignMove, guidesFor } from '../align';
import { addNode, type Point } from '../model';
import type { ShapeType } from '../shapes';
import { guideMarks, toPreview } from './preview';
import type { Tool, ToolContext } from './types';

function placement(ctx: ToolContext, shape: ShapeType, p: Point) {
  const { w, h } = shape.defaultSize;
  const at = alignMove(ctx.diagram, { x: p.x - w / 2, y: p.y - h / 2, w, h }, { grid: ctx.grid, tolerance: ctx.alignTolerance });
  return { shape: shape.id, ...at, w, h, text: '' };
}

export function placeTool(shape: ShapeType): Tool {
  return {
    id: shape.id,
    name: shape.name,
    key: shape.key,
    icon: shape.icon,

    hint: () => `Klikk der ${shape.definite} skal stå · Esc: tilbake til Velg`,

    pointerDown(ctx, p) {
      // Clicking an existing figure selects it instead of stacking a new one on top.
      const hit = ctx.nodeAt(p);
      if (hit) {
        ctx.select({ kind: 'node', id: hit.id });
        return;
      }
      const added = addNode(ctx.diagram, placement(ctx, shape, p));
      ctx.commit(added.diagram);
      ctx.select({ kind: 'node', id: added.id });
      ctx.editText(added.id);
    },

    preview(ctx, pointer) {
      if (!pointer || ctx.nodeAt(pointer)) return {};
      const ghost = { id: 'ghost', ...placement(ctx, shape, pointer) };
      return { overlay: [toPreview(shape.render(ghost)), ...guideMarks(guidesFor(ctx.diagram, ghost), ctx.handleSize)] };
    },
  };
}
