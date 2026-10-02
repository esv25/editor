/**
 * All tools, in toolbar order: Velg, one per figure type, Frihånd, Pil.
 */
import { shapes } from '../shapes';
import { arrowTool } from './arrow';
import { freehandTool } from './freehand';
import { placeTool } from './place';
import { selectTool } from './select';
import type { Tool } from './types';

export const tools: Tool[] = [selectTool, ...shapes.filter((s) => !s.ownTool).map(placeTool), freehandTool, arrowTool];

export function toolFor(id: string): Tool {
  return tools.find((t) => t.id === id) ?? selectTool;
}

export type { Preview, Selection, Tool, ToolContext } from './types';
