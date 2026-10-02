import { center } from '../model';
import { h } from '../svg';
import { label, outline, shapeIcon } from './common';
import type { ShapeType } from './types';

export const ellipse: ShapeType = {
  id: 'ellipse',
  name: 'Ellipse',
  definite: 'ellipsen',
  icon: shapeIcon('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  key: 'e',
  defaultSize: { w: 160, h: 80 },
  render: (node) => {
    const c = center(node);
    return h('g', {}, [h('ellipse', { cx: c.x, cy: c.y, rx: node.w / 2, ry: node.h / 2, ...outline }), ...label(node)]);
  },
  boundary: (node, p) => {
    const c = center(node);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const a = node.w / 2;
    const b = node.h / 2;
    const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return { x: c.x + dx * t, y: c.y + dy * t };
  },
};
