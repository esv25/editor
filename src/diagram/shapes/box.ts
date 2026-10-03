import { h } from '../svg';
import { DOUBLE_GAP, innerOutline, label, outline, rectBoundary, shapeIcon } from './common';
import type { ShapeType } from './types';

/** Box: the general figure; an entity in ER models (double outline: weak entity). */
export const box: ShapeType = {
  id: 'box',
  name: 'Boks',
  definite: 'boksen',
  icon: shapeIcon('<rect x="3" y="6" width="18" height="12" rx="2"/>'),
  key: 'b',
  defaultSize: { w: 160, h: 80 },
  render: (node) => {
    const g = DOUBLE_GAP;
    return h('g', {}, [
      h('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 6, ...outline(node) }),
      ...(node.double
        ? [h('rect', { x: node.x + g, y: node.y + g, width: node.w - 2 * g, height: node.h - 2 * g, rx: 3, ...innerOutline(node) })]
        : []),
      ...label(node),
    ]);
  },
  boundary: rectBoundary,
};
