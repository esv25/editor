import type { Guide } from '../align';
import { h, type SvgNode } from '../svg';

/** Show a figure as a see-through ghost (styled in diagram.css). */
export const toPreview = (node: SvgNode): SvgNode => h('g', { class: 'dg-ghost' }, [node]);

/** Alignment guides, a little longer than the figures they run through. */
export const guideMarks = (guides: Guide[], pad: number): SvgNode[] =>
  guides.map((g) =>
    h('line', {
      x1: g.x1 - (g.x1 === g.x2 ? 0 : pad),
      y1: g.y1 - (g.y1 === g.y2 ? 0 : pad),
      x2: g.x2 + (g.x1 === g.x2 ? 0 : pad),
      y2: g.y2 + (g.y1 === g.y2 ? 0 : pad),
      class: 'dg-guide',
    }),
  );
