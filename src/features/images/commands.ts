/**
 * Text-changing image commands, as StateCommands so they're testable without
 * a DOM (tests/imagePath.test.ts). Images are addressed by the position where
 * their `![` starts.
 */
import type { EditorState, StateCommand } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { markdownDestination } from '../util/imagePath';

export interface ImageRef {
  from: number;
  to: number;
  /** The alt text's range (between "![" and "]"). */
  altFrom: number;
  altTo: number;
  /** The destination's range (inside the parentheses, incl. any <…>). */
  destFrom: number;
  destTo: number;
  dest: string;
}

/** An inline image (`![alt](dest)`); null for reference-style images. */
export function readImage(state: EditorState, node: SyntaxNode): ImageRef | null {
  const url = node.getChild('URL');
  const marks = node.getChildren('LinkMark');
  if (!url || marks.length < 2) return null;
  return {
    from: node.from,
    to: node.to,
    altFrom: marks[0].to,
    altTo: marks[1].from,
    destFrom: url.from,
    destTo: url.to,
    dest: state.doc.sliceString(url.from, url.to),
  };
}

export function imageAt(state: EditorState, pos: number): ImageRef | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'Image') return node.from === pos ? readImage(state, node) : null;
  }
  return null;
}

/** Brackets and line breaks would end the alt text early. */
const cleanAlt = (alt: string) => alt.replace(/[[\]]/g, '').replace(/\s*\n\s*/g, ' ').trim();

export function setImageAlt(pos: number, alt: string): StateCommand {
  return ({ state, dispatch }) => {
    const image = imageAt(state, pos);
    if (!image) return false;
    dispatch(state.update({ changes: { from: image.altFrom, to: image.altTo, insert: cleanAlt(alt) }, userEvent: 'input.image' }));
    return true;
  };
}

export function setImageDest(pos: number, dest: string): StateCommand {
  return ({ state, dispatch }) => {
    const image = imageAt(state, pos);
    if (!image) return false;
    dispatch(
      state.update({ changes: { from: image.destFrom, to: image.destTo, insert: markdownDestination(dest) }, userEvent: 'input.image' }),
    );
    return true;
  };
}

/** Remove the image; if it was alone on its line, the line goes too. */
export function removeImage(pos: number): StateCommand {
  return ({ state, dispatch }) => {
    const image = imageAt(state, pos);
    if (!image) return false;
    const { doc } = state;
    const first = doc.lineAt(image.from);
    const last = doc.lineAt(image.to);
    const rest = doc.sliceString(first.from, image.from) + doc.sliceString(image.to, last.to);
    let from = image.from;
    let to = image.to;
    if (rest.trim() === '') {
      from = first.from;
      to = last.to;
      if (to < doc.length) to++;
      else if (from > 0) from--;
    }
    dispatch(state.update({ changes: { from, to }, selection: { anchor: from }, userEvent: 'delete.image' }));
    return true;
  };
}

/**
 * Put `markdown` on its own line: on the cursor's line if it's empty, else on
 * a new line after it. The cursor ends at `cursorOffset` into the inserted
 * text (default: after it).
 */
export function insertOnOwnLine(markdown: string, cursorOffset = markdown.length): StateCommand {
  return ({ state, dispatch }) => {
    const line = state.doc.lineAt(state.selection.main.head);
    const empty = line.text.trim() === '';
    const from = empty ? line.from : line.to;
    const insert = empty ? markdown : `\n${markdown}`;
    dispatch(
      state.update({
        changes: { from, to: line.to, insert },
        selection: { anchor: from + insert.length - markdown.length + cursorOffset },
        scrollIntoView: true,
        userEvent: 'input',
      }),
    );
    return true;
  };
}
