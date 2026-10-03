/**
 * All tools, in toolbar order: Velg, one per figure type, Strek, Frihånd, Pil.
 */
import { shapes } from '../shapes';
import { arrowTool } from './arrow';
import { freehandTool } from './freehand';
import { lineTool } from './line';
import { placeTool } from './place';
import { selectTool } from './select';
import type { Tool } from './types';
import { getSettings } from '../../settings';

export const tools: Tool[] = [selectTool, ...shapes.filter((s) => !s.ownTool).map(placeTool), lineTool, freehandTool, arrowTool];

/** The key that picks a tool: the user's choice (settings.diagram.toolKeys, '' = none) or its own. */
export function toolKey(tool: Tool): string {
  return getSettings().diagram.toolKeys[tool.id] ?? tool.key;
}

export function toolFor(id: string): Tool {
  return tools.find((t) => t.id === id) ?? selectTool;
}

export type { Preview, Selection, Tool, ToolContext } from './types';
