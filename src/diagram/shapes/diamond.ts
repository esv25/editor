import { center } from '../model';
import { h } from '../svg';
import { label, outline, shapeIcon } from './common';
import type { ShapeType } from './types';

/** Rhombus: relationships in ER models, decisions in flowcharts. */
export const diamond: ShapeType = {
  id: 'diamond',
  name: 'Rombe',
  definite: 'romben',
  icon: shapeIcon('<path d="M12 4 21 12 12 20 3 12z"/>'),
  key: 'r',
  defaultSize: { w: 160, h: 100 },
  render: (node) => {
    const c = center(node);
    const points = `${c.x},${node.y} ${node.x + node.w},${c.y} ${c.x},${node.y + node.h} ${node.x},${c.y}`;
    return h('g', {}, [h('polygon', { points, 'stroke-linejoin': 'round', ...outline }), ...label(node)]);
  },
  boundary: (node, p) => {
    const c = center(node);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const t = 1 / (Math.abs(dx) / (node.w / 2) + Math.abs(dy) / (node.h / 2));
    return { x: c.x + dx * t, y: c.y + dy * t };
  },
};
