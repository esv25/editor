import type { DiagramNode, Point } from '../model';
import type { SvgNode } from '../svg';

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
  /** Draw the figure, text included. */
  render(node: DiagramNode): SvgNode;
  /** Where a line from the figure's centre toward `p` crosses its outline (arrows start/end here). */
  boundary(node: DiagramNode, p: Point): Point;
}
