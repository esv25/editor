/**
 * UML class: name, fields and methods in compartments. It's all one text,
 * typed with a line of `--` between the parts:
 *
 *   Person
 *   --
 *   - navn: String
 *   --
 *   + hils(): void
 *
 * `_static_` lines are underlined (`__dashed__` too), `*abstract*` ones
 * italic, and «stereotype» lines in the name part aren't bold.
 */
import { h, type SvgNode } from '../svg';
import { lineHeight, outline, rectBoundary, shapeIcon, styledLine, textBlock } from './common';
import type { ShapeType } from './types';

const PAD_X = 10;
const PAD_Y = 6;
/** Height of a compartment with nothing in it. */
const EMPTY = 2 * PAD_Y + 6;

/** The text split into compartments (at lines of `--`); always at least three. */
export function classSections(text: string): string[][] {
  const sections: string[][] = [[]];
  for (const line of text.split('\n')) {
    if (/^\s*-{2,}\s*$/.test(line)) sections.push([]);
    else sections[sections.length - 1].push(line);
  }
  // Leading/trailing empty lines inside a compartment are just typing leftovers.
  const trimmed = sections.map((lines) => {
    let from = 0;
    let to = lines.length;
    while (from < to && !lines[from].trim()) from++;
    while (to > from && !lines[to - 1].trim()) to--;
    return lines.slice(from, to);
  });
  while (trimmed.length < 3) trimmed.push([]);
  return trimmed;
}

const sectionHeight = (lines: string[]) => (lines.length ? lines.length * lineHeight + 2 * PAD_Y : EMPTY);
const isStereotype = (line: string) => /^\s*(«|<<)/.test(line);

export const umlClass: ShapeType = {
  id: 'class',
  name: 'Klasse',
  definite: 'klassen',
  icon: shapeIcon('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 9h16M4 15h16"/>'),
  key: 'k',
  defaultSize: { w: 200, h: 120 },
  multiline: true,
  placeholder: 'Navn\n--\n- felt: Type\n--\n+ metode(): Type',

  fit(text, measure) {
    const sections = classSections(text);
    const widths = sections.flatMap((lines, i) =>
      lines.map((line) => measure(styledLine(line).text, i === 0 && !isStereotype(line)) + 2 * PAD_X + (i === 0 ? 16 : 0)),
    );
    return { w: Math.max(0, ...widths), h: sections.reduce((sum, lines) => sum + sectionHeight(lines), 0) };
  },

  render(node) {
    const sections = classSections(node.text);
    const parts: SvgNode[] = [h('rect', { x: node.x, y: node.y, width: node.w, height: node.h, ...outline(node) })];
    const bottom = node.y + node.h;
    let top = node.y;
    sections.forEach((lines, i) => {
      if (top >= bottom) return;
      if (i > 0) parts.push(h('line', { x1: node.x, y1: top, x2: node.x + node.w, y2: top, stroke: outline(node)!.stroke, 'stroke-width': outline(node)!['stroke-width'] }));
      const name = i === 0;
      const x = name ? node.x + node.w / 2 : node.x + PAD_X;
      parts.push(
        ...textBlock(
          lines.map((line, j) => ({ line, x, y: top + PAD_Y + lineHeight / 2 + j * lineHeight, bold: name && !isStereotype(line) })),
          name ? 'middle' : 'start',
        ),
      );
      top += sectionHeight(lines);
    });
    return h('g', {}, parts);
  },

  boundary: rectBoundary,
};
