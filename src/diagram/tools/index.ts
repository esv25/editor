/**
 * All tools, in toolbar order: Velg, one per figure type, Pil.
 */
import { shapes } from '../shapes';
import { arrowTool } from './arrow';
import { placeTool } from './place';
import { selectTool } from './select';
import type { Tool } from './types';

export const tools: Tool[] = [selectTool, ...shapes.map(placeTool), arrowTool];

export function toolFor(id: string): Tool {
  return tools.find((t) => t.id === id) ?? selectTool;
}

export type { Preview, Selection, Tool, ToolContext } from './types';
