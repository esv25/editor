/**
 * Lines between figures: their end marks (arrow heads, UML triangles and
 * diamonds), dashes, and texts at the ends and in the middle. The presets
 * are the one-click choices in the properties bar.
 */
import { styleOf, type DiagramEdge, type EdgeStyle, type EndKind, type Point } from './model';
import { drawingStyle } from './shapes/common';
import { h, type SvgNode } from './svg';

export interface EdgePreset {
  id: string;
  name: string;
  /** What it's for, in the button's tooltip. */
  title: string;
  style: EdgeStyle;
}

export const edgePresets: EdgePreset[] = [
  { id: 'arrow', name: 'Pil', title: 'Vanlig pil', style: { head: 'arrow', tail: 'none', dashed: false } },
  { id: 'line', name: 'Linje', title: 'Linje uten pil (ER, UML-assosiasjon)', style: { head: 'none', tail: 'none', dashed: false } },
  { id: 'inherit', name: 'Arv', title: 'UML: arv/generalisering (tom trekant mot superklassen)', style: { head: 'triangle', tail: 'none', dashed: false } },
  { id: 'realize', name: 'Implementerer', title: 'UML: implementerer et grensesnitt (stiplet, tom trekant)', style: { head: 'triangle', tail: 'none', dashed: true } },
  { id: 'depend', name: 'Avhengighet', title: 'UML: avhengighet (stiplet, åpen pil)', style: { head: 'open', tail: 'none', dashed: true } },
  { id: 'aggregate', name: 'Aggregering', title: 'UML: aggregering (tom rute hos helheten)', style: { head: 'none', tail: 'diamond', dashed: false } },
  { id: 'compose', name: 'Komposisjon', title: 'UML: komposisjon (fylt rute hos helheten)', style: { head: 'none', tail: 'filledDiamond', dashed: false } },
];

export const sameStyle = (a: EdgeStyle, b: EdgeStyle) => a.head === b.head && a.tail === b.tail && a.dashed === b.dashed;

/**
 * The mark at a line's end. `tip` is where the line meets the figure, `angle`
 * the line's direction arriving there. Returns the drawing and how far back
 * from the tip the line itself should stop.
 */
export function endMark(kind: EndKind, tip: Point, angle: number, color: string): { marks: SvgNode[]; inset: number } {
  const at = (back: number, side: number) => ({
    x: tip.x - back * Math.cos(angle) + side * Math.sin(angle),
    y: tip.y - back * Math.sin(angle) - side * Math.cos(angle),
  });
  const pts = (...ps: Point[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');
  const width = drawingStyle.strokeWidth;
  switch (kind) {
    case 'arrow': {
      const [l, r] = [at(12, 5.5), at(12, -5.5)];
      return { marks: [h('polygon', { points: pts(tip, l, r), fill: color, stroke: color, 'stroke-width': 1, 'stroke-linejoin': 'round' })], inset: 10 };
    }
    case 'open': {
      const [l, r] = [at(13, 7), at(13, -7)];
      return {
        marks: [h('polyline', { points: pts(l, tip, r), fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })],
        inset: 0,
      };
    }
    case 'triangle': {
      const [l, r] = [at(17, 9), at(17, -9)];
      return { marks: [h('polygon', { points: pts(tip, l, r), fill: drawingStyle.fill, stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round' })], inset: 17 };
    }
    case 'diamond':
    case 'filledDiamond': {
      const [l, back, r] = [at(11, 6.5), at(22, 0), at(11, -6.5)];
      const fill = kind === 'diamond' ? drawingStyle.fill : color;
      return { marks: [h('polygon', { points: pts(tip, l, back, r), fill, stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round' })], inset: 22 };
    }
    default:
      return { marks: [], inset: 0 };
  }
}

/** A small text with a paper-coloured backdrop, so it stays readable over lines. */
function tag(text: string, at: Point): SvgNode {
  const size = drawingStyle.fontSize - 2;
  const lines = text.split('\n');
  const width = Math.max(...lines.map((l) => l.length)) * size * 0.58 + 8;
  const height = lines.length * size * drawingStyle.lineHeight + 4;
  const firstY = at.y - ((lines.length - 1) * size * drawingStyle.lineHeight) / 2;
  return h('g', {}, [
    h('rect', { x: at.x - width / 2, y: at.y - height / 2, width, height, rx: 3, fill: drawingStyle.paper, 'fill-opacity': 0.9 }),
    h(
      'text',
      { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': drawingStyle.font, 'font-size': size, fill: drawingStyle.text },
      lines.map((line, i) => h('tspan', { x: at.x, y: firstY + i * size * drawingStyle.lineHeight }, [], line)),
    ),
  ]);
}

/** Where an end text goes: a little along the line from the end, and off to one side. */
function endTagPosition(end: Point, toward: Point): Point {
  const angle = Math.atan2(toward.y - end.y, toward.x - end.x);
  const along = 26;
  const side = 14;
  return {
    x: end.x + along * Math.cos(angle) + side * Math.sin(angle),
    y: end.y + along * Math.sin(angle) - side * Math.cos(angle),
  };
}

/** Draw a line from a (at `from`) to b (at `to`) with the edge's marks and texts. */
export function renderEdge(edge: Partial<DiagramEdge>, a: Point, b: Point, color: string = drawingStyle.stroke, extra: SvgNode['attrs'] = {}): SvgNode {
  const style = styleOf({ id: '', from: '', to: '', ...edge });
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = endMark(style.head, b, angle, color);
  const tail = endMark(style.tail, a, angle + Math.PI, color);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const parts: SvgNode[] = [];
  if (length > head.inset + tail.inset) {
    const start = { x: a.x + tail.inset * Math.cos(angle), y: a.y + tail.inset * Math.sin(angle) };
    const end = { x: b.x - head.inset * Math.cos(angle), y: b.y - head.inset * Math.sin(angle) };
    parts.push(
      h('line', {
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke: color,
        'stroke-width': drawingStyle.strokeWidth,
        'stroke-linecap': style.dashed ? 'butt' : 'round',
        'stroke-dasharray': style.dashed ? '8 6' : undefined,
      }),
    );
  }
  parts.push(...head.marks, ...tail.marks);
  if (edge.label) parts.push(tag(edge.label, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  if (edge.fromLabel) parts.push(tag(edge.fromLabel, endTagPosition(a, b)));
  if (edge.toLabel) parts.push(tag(edge.toLabel, endTagPosition(b, a)));
  return h('g', extra, parts);
}

/** A small picture of a preset, for its button. */
export function presetIcon(style: EdgeStyle): SvgNode {
  return h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 56 20', width: 42, height: 15 }, [
    renderEdge(style, { x: 3, y: 10 }, { x: 53, y: 10 }, 'currentColor'),
  ]);
}
