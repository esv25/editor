import { center, type DiagramNode } from '../model';
import { h } from '../svg';
import { DOUBLE_GAP, innerOutline, label, outline, shapeIcon, sideAnchors } from './common';
import type { ShapeType } from './types';

const corners = (node: DiagramNode, inset = 0) => {
  const c = center(node);
  // Moving each corner inward by `inset` along the axes keeps the sides parallel.
  const dx = inset * Math.hypot(node.w, node.h) / node.h;
  const dy = inset * Math.hypot(node.w, node.h) / node.w;
  return `${c.x},${node.y + dy} ${node.x + node.w - dx},${c.y} ${c.x},${node.y + node.h - dy} ${node.x + dx},${c.y}`;
};

/** Rhombus: a relationship in ER models (double: identifying), a decision in flowcharts. */
export const diamond: ShapeType = {
  id: 'diamond',
  name: 'Rombe',
  definite: 'romben',
  icon: shapeIcon('<path d="M12 4 21 12 12 20 3 12z"/>'),
  key: 'r',
  defaultSize: { w: 160, h: 100 },
  render: (node, fontSize) =>
    h('g', {}, [
      h('polygon', { points: corners(node), 'stroke-linejoin': 'round', ...outline(node) }),
      ...(node.double ? [h('polygon', { points: corners(node, DOUBLE_GAP), 'stroke-linejoin': 'round', ...innerOutline(node) })] : []),
      ...label(node, fontSize),
    ]),
  anchors: sideAnchors,
  // The corners of the text block (plus a margin) on the sides of the rhombus.
  textRoom: (node, w, h) => {
    const inset = node.double ? 4 * DOUBLE_GAP : 0;
    return 1 / ((w + 8) / (node.w - inset) + (h * 0.8) / (node.h - inset));
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
