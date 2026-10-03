/**
 * All figure types, in toolbar order. To add one: create shapes/<name>.ts
 * exporting a ShapeType and list it here.
 */
import { box } from './box';
import { diamond } from './diamond';
import { ellipse } from './ellipse';
import { path } from './path';
import { text } from './text';
import { umlClass } from './umlClass';
import type { ShapeType } from './types';

export const shapes: ShapeType[] = [box, ellipse, diamond, umlClass, text, path];

export function shapeFor(id: string): ShapeType {
  return shapes.find((s) => s.id === id) ?? box;
}

export type { Measure, ShapeType } from './types';
