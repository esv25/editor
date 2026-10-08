import type { DiagramNode, Point } from '../model';
import type { SvgNode } from '../svg';

/** Width of a line of text in drawing units (bold: as in a UML class name). */
export type Measure = (line: string, bold?: boolean) => number;

/**
 * A kind of figure. To add one: create shapes/<name>.ts exporting a ShapeType
 * and list it in shapes/index.ts – it gets a tool button automatically.
 */
export interface ShapeType {
  id: string;
  /** Norwegian name, shown on the tool button and in hints («Klikk der boksen skal stå»). */
  name: string;
  /** Definite form for hints: «boksen», «ellipsen». */
  definite: string;
  /** Toolbar icon (inline SVG markup, 24×24 viewBox). */
  icon: string;
  /** Tool shortcut (single key, shown in the tooltip). */
  key: string;
  defaultSize: { w: number; h: number };
  /** Draw the figure, text included (at `fontSize` if given; see `textRoom`). */
  render(node: DiagramNode, fontSize?: number): SvgNode;
  /** Where a line from the figure's centre toward `p` crosses its outline (arrows start/end here). */
  boundary(node: DiagramNode, p: Point): Point;
  /** Enter makes a new line while typing (Ctrl+Enter or Esc finishes). Default: Enter finishes. */
  multiline?: boolean;
  /** Grey example text in the empty text field. */
  placeholder?: string;
  /** The size the text needs (default: centred lines plus padding); `scale`: the drawing's text size. */
  fit?(text: string, measure: Measure, scale?: number): { w: number; h: number };
  /**
   * How many times larger a text block of w×h (at the normal font size) could
   * be drawn and still fit inside the figure. Without it the text keeps its size.
   */
  textRoom?(node: DiagramNode, w: number, h: number): number;
  /** Distance from `p` to the figure, for clicking (default: to its bounding box). */
  distance?(node: DiagramNode, p: Point): number;
  /** Points that lines snap to (default: corners and side middles of the box). */
  anchors?(node: DiagramNode): Point[];
  /** Made with its own tool rather than placed with a click (freehand). */
  ownTool?: boolean;
}
