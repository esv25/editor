import { center } from '../model';
import { h } from '../svg';
import { DOUBLE_GAP, innerOutline, label, outline, shapeIcon, sideAnchors } from './common';
import type { ShapeType } from './types';

/** Ellipse: an attribute in ER models (_key_ underlined, double: multivalued, dashed: derived). */
export const ellipse: ShapeType = {
  id: 'ellipse',
  name: 'Ellipse',
  definite: 'ellipsen',
  icon: shapeIcon('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  key: 'e',
  defaultSize: { w: 160, h: 80 },
  render: (node, fontSize) => {
    const c = center(node);
    const g = DOUBLE_GAP;
    return h('g', {}, [
      h('ellipse', { cx: c.x, cy: c.y, rx: node.w / 2, ry: node.h / 2, ...outline(node) }),
      ...(node.double ? [h('ellipse', { cx: c.x, cy: c.y, rx: node.w / 2 - g, ry: node.h / 2 - g, ...innerOutline(node) })] : []),
      ...label(node, fontSize),
    ]);
  },
  anchors: sideAnchors,
  // The corners of the text block (plus a margin) on the ellipse.
  textRoom: (node, w, h) => {
    const inset = node.double ? 2 * DOUBLE_GAP : 0;
    return 1 / Math.hypot((w + 8) / (node.w - inset), (h * 0.8) / (node.h - inset));
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
