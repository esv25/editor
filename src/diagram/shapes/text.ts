import { h } from '../svg';
import { drawingStyle, label, rectBoundary, rectTextRoom, shapeIcon } from './common';
import type { ShapeType } from './types';

/** Free text without an outline (titles, notes, labels next to arrows). */
export const text: ShapeType = {
  id: 'text',
  name: 'Tekst',
  definite: 'teksten',
  icon: shapeIcon('<path d="M5 6h14M12 6v13M9 19h6"/>'),
  key: 't',
  defaultSize: { w: 120, h: 40 },
  render: (node, fontSize) =>
    // An invisible rectangle keeps the whole area clickable.
    h('g', {}, [
      h('rect', { x: node.x, y: node.y, width: node.w, height: node.h, fill: drawingStyle.paper, 'fill-opacity': 0 }),
      ...label(node, fontSize),
    ]),
  boundary: rectBoundary,
  textRoom: rectTextRoom,
};
