/**
 * All figure types, in toolbar order. To add one: create shapes/<name>.ts
 * exporting a ShapeType and list it here.
 */
import { box } from './box';
import { diamond } from './diamond';
import { ellipse } from './ellipse';
import { text } from './text';
import type { ShapeType } from './types';

export const shapes: ShapeType[] = [box, ellipse, diamond, text];

export function shapeFor(id: string): ShapeType {
  return shapes.find((s) => s.id === id) ?? box;
}

export type { ShapeType } from './types';
