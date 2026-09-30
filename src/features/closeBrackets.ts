/**
 * Auto-close brackets: typing an opening bracket inserts the closing one.
 * With text selected, the selection is wrapped. Typing the closing bracket
 * steps over an auto-inserted one, and Backspace between an empty pair
 * deletes both. Which characters are paired is set in `settings.closeBrackets`.
 * Inside code blocks, the code language's own rules apply (e.g. quotes in JS).
 */
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { closeBrackets as closeBracketsExtension, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { Feature } from './types';

export const closeBrackets: Feature = {
  id: 'closeBrackets',
  extension: (settings) =>
    settings.closeBrackets.length === 0
      ? []
      : [
          EditorState.languageData.of(() => [{ closeBrackets: { brackets: settings.closeBrackets } }]),
          closeBracketsExtension(),
          // Above smart lists' Backspace, so "(|)" + Backspace removes the pair.
          Prec.highest(keymap.of(closeBracketsKeymap)),
        ],
};
