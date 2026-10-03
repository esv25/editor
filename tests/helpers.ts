import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { mathSyntax } from '../src/features/math/syntax';

/**
 * Build a state from text where "|" marks the cursor, or "<" and ">" mark a selection.
 */
export function stateOf(text: string): EditorState {
  let anchor: number, head: number;
  if (text.includes('|')) {
    anchor = head = text.indexOf('|');
    text = text.replace('|', '');
  } else {
    anchor = text.indexOf('<');
    text = text.replace('<', '');
    head = text.indexOf('>');
    text = text.replace('>', '');
  }
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage, extensions: [mathSyntax] })],
  });
  return fullyParsed(state);
}

/**
 * Return the state with a complete syntax tree. A new state only parses for ~20 ms, and
 * `ensureSyntaxTree` finishes the parse without updating the tree that `syntaxTree(state)`
 * (and so indentation, folding …) reads – an empty transaction carries it over.
 */
export function fullyParsed(state: EditorState): EditorState {
  if (!ensureSyntaxTree(state, state.doc.length, 5000)) throw new Error('Parsing did not finish');
  const next = state.update({}).state;
  if (syntaxTree(next).length < next.doc.length) throw new Error('Syntax tree is incomplete');
  return next;
}

/** Render a state back to text with the same cursor/selection markers. */
export function textOf(state: EditorState): string {
  const { anchor, head } = state.selection.main;
  const doc = state.doc.toString();
  if (anchor === head) return doc.slice(0, head) + '|' + doc.slice(head);
  const [from, to] = [Math.min(anchor, head), Math.max(anchor, head)];
  return doc.slice(0, from) + '<' + doc.slice(from, to) + '>' + doc.slice(to);
}

/** Run a command on the given text and return the resulting text (with markers). */
export function run(command: StateCommand, text: string): string {
  let state = stateOf(text);
  command({ state, dispatch: (tr) => { state = tr.state; } });
  return textOf(state);
}
