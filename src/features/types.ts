import type { Extension } from '@codemirror/state';
import type { EditorCommand } from '../commands/registry';
import type { Settings } from '../settings';

/**
 * A self-contained editor feature. Each file in src/features/ exports one.
 *
 * - `commands` are registered in the command registry (toolbar + shortcuts).
 * - `extension` is rebuilt whenever settings change, so read settings there,
 *   not at module load.
 */
export interface Feature {
  id: string;
  commands?: EditorCommand[];
  extension?: (settings: Settings) => Extension;
}
