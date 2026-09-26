/**
 * Heading suggestion: shows a discreet hint next to lines that look like
 * headings. Never changes the text by itself – the user applies it with
 * the shortcut. The heuristics live in ./rules.ts.
 */
import { StateEffect, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { formatKey, keyFor } from '../../commands/registry';
import { getSettings } from '../../settings';
import { makeHeading } from '../headings';
import { blockTypeAt } from '../util/markdown';
import { isHeadingCandidate, type HeadingSuggestionConfig } from './rules';
import type { Feature } from '../types';

const COMMAND_ID = 'heading.fromSuggestion';
const idleEffect = StateEffect.define<null>();
const candidateLine = Decoration.line({ class: 'cm-heading-candidate' });

class HintWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: HintWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-heading-hint';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = this.text;
    return el;
  }
}

function suggestionPlugin(config: HeadingSuggestionConfig) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      /** False while the user is typing; the hint waits until they pause. */
      idle = true;
      timer: ReturnType<typeof setTimeout> | undefined;

      constructor(readonly view: EditorView) {
        this.decorations = this.build();
      }

      update(u: ViewUpdate) {
        if (u.docChanged) {
          this.idle = false;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.idle = true;
            this.view.dispatch({ effects: idleEffect.of(null) });
          }, config.idleDelayMs);
        }
        const woke = u.transactions.some((tr) => tr.effects.some((e) => e.is(idleEffect)));
        if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || woke) {
          this.decorations = this.build();
        }
      }

      destroy() {
        clearTimeout(this.timer);
      }

      build(): DecorationSet {
        const { view } = this;
        const { state } = view;
        const { doc } = state;
        const cursor = state.selection.main;
        const cursorLine = doc.lineAt(cursor.head).number;

        const lineNumbers: number[] = [];
        if (config.onlyOnCursorLine) {
          if (view.hasFocus && this.idle && cursor.empty) lineNumbers.push(cursorLine);
        } else {
          for (const { from, to } of view.visibleRanges) {
            for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
              if (n !== cursorLine || this.idle) lineNumbers.push(n);
            }
          }
        }

        const key = keyFor(COMMAND_ID);
        const hint = key ? `Gjør til overskrift? ${formatKey(key)}` : 'Gjør til overskrift?';
        const decos: Range<Decoration>[] = [];
        for (const n of lineNumbers) {
          const line = doc.line(n);
          if (line.text.trim() === '') continue;
          const ctx = {
            text: line.text,
            prevText: n > 1 ? doc.line(n - 1).text : null,
            nextText: n < doc.lines ? doc.line(n + 1).text : null,
            blockType: blockTypeAt(state, line.from),
          };
          if (!isHeadingCandidate(ctx, config)) continue;
          decos.push(candidateLine.range(line.from));
          decos.push(Decoration.widget({ widget: new HintWidget(hint), side: 1 }).range(line.to));
        }
        return Decoration.set(decos, true);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const headingSuggestion: Feature = {
  id: 'headingSuggestion',
  extension: (settings) => (settings.headingSuggestion.enabled ? suggestionPlugin(settings.headingSuggestion) : []),
  commands: [
    {
      id: COMMAND_ID,
      name: 'Gjør linja til overskrift',
      key: 'Mod-Shift-h',
      run: (view) => makeHeading(getSettings().headingSuggestion.level)(view),
    },
  ],
};
