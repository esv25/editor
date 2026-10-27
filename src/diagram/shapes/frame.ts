/**
 * Frame: a rectangle around other figures (a UML package, a system boundary,
 * a group), with its name in a tab at the top left. Drawn behind everything
 * else, and only its outline and tab count as clicking it, so figures inside
 * can be placed and picked as usual. Moving it moves what's inside
 * (`withFramed` in model.ts).
 */
import { distanceToRect, type DiagramNode, type Point } from '../model';
import { h } from '../svg';
import { DOUBLE_GAP, drawingStyle, innerOutline, lineHeight, measureText, outline, rectBoundary, shapeIcon, styledLine, textBlock } from './common';
import type { ShapeType } from './types';

const PAD_X = 10;
const PAD_Y = 4;
/** The tab's cut corner. */
const CUT = 8;

/** The name's first line only: a frame's name is short. */
const title = (text: string) => text.split('\n')[0].trim();

/** The tab with the name, at the top left (null without a name). */
export function frameTab(node: DiagramNode, fontSize = drawingStyle.fontSize): { x: number; y: number; w: number; h: number } | null {
  const name = title(node.text);
  if (!name) return null;
  const scale = fontSize / drawingStyle.fontSize;
  const styled = styledLine(name);
  const w = Math.min(node.w, measureText(styled.text, false, styled.italic) * scale + 2 * PAD_X + CUT);
  return { x: node.x, y: node.y, w, h: Math.min(node.h, lineHeight * scale + 2 * PAD_Y) };
}

export const frame: ShapeType = {
  id: 'frame',
  name: 'Ramme',
  definite: 'rammen',
  icon: shapeIcon('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h7l2-2V4"/>'),
  key: 'g',
  defaultSize: { w: 360, h: 240 },
  placeholder: 'Navn',

  fit: (text, measure, scale = 1) => {
    const name = title(text);
    return { w: (name ? measure(styledLine(name).text) * scale : 0) + 2 * PAD_X + CUT + 40, h: lineHeight * scale + 2 * PAD_Y + 40 };
  },

  render(node, fontSize = drawingStyle.fontSize) {
    const g = DOUBLE_GAP;
    // No fill: what's behind it (the paper) shows through, and nothing inside is hidden.
    const parts = [h('rect', { x: node.x, y: node.y, width: node.w, height: node.h, ...outline(node), fill: 'none' })];
    if (node.double) {
      parts.push(h('rect', { x: node.x + g, y: node.y + g, width: node.w - 2 * g, height: node.h - 2 * g, ...innerOutline(node) }));
    }
    const tab = frameTab(node, fontSize);
    if (tab) {
      const right = tab.x + tab.w;
      const bottom = tab.y + tab.h;
      parts.push(
        h('path', {
          d: `M${tab.x} ${bottom}H${right - CUT}L${right} ${bottom - CUT}V${tab.y}`,
          fill: 'none',
          stroke: drawingStyle.stroke,
          'stroke-width': drawingStyle.strokeWidth,
        }),
        ...textBlock([{ line: title(node.text), x: tab.x + PAD_X, y: tab.y + tab.h / 2 }], 'start', fontSize),
      );
    }
    return h('g', {}, parts);
  },

  boundary: rectBoundary,

  distance(node, p: Point) {
    const tab = frameTab(node);
    if (tab && distanceToRect(p, { ...node, ...tab }) === 0) return 0;
    const inside = p.x > node.x && p.x < node.x + node.w && p.y > node.y && p.y < node.y + node.h;
    const d = inside
      ? Math.min(p.x - node.x, node.x + node.w - p.x, p.y - node.y, node.y + node.h - p.y)
      : distanceToRect(p, node);
    // A little further than it is, so a figure lying on the outline wins.
    return d + 0.5;
  },

  textArea(node) {
    const tab = frameTab(node);
    return { x: node.x, y: node.y, w: Math.max(tab?.w ?? 0, Math.min(node.w, 200)), h: tab?.h ?? lineHeight + 2 * PAD_Y };
  },
};
