import { h } from '../svg';
import { label, outline, rectBoundary, shapeIcon } from './common';
import type { ShapeType } from './types';

export const box: ShapeType = {
  id: 'box',
  name: 'Boks',
  definite: 'boksen',
  icon: shapeIcon('<rect x="3" y="6" width="18" height="12" rx="2"/>'),
  key: 'b',
  defaultSize: { w: 160, h: 80 },
  render: (node) =>
    h('g', {}, [h('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 6, ...outline }), ...label(node)]),
  boundary: rectBoundary,
};
