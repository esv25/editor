/**
 * All editor features, in the order their extensions are added.
 * To add a feature: create src/features/<name>.ts exporting a `Feature`
 * and list it here.
 */
import type { Feature } from './types';
import { livePreview } from './livePreview';
import { codeBlocks } from './codeBlocks';
import { headings } from './headings';
import { inlineFormat } from './inlineFormat';
import { lists } from './lists';
import { taskList } from './taskList';
import { smartLists } from './smartLists';
import { headingSuggestion } from './headingSuggestion';

export const features: Feature[] = [
  livePreview,
  codeBlocks,
  headings,
  inlineFormat,
  lists,
  taskList,
  smartLists,
  headingSuggestion,
];
