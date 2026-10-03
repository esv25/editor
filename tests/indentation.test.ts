import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Extension, type StateCommand } from '@codemirror/state';
import { deleteCharBackward, insertNewlineAndIndent } from '@codemirror/commands';
import { indentUnit, LanguageDescription } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { detectIndent, indentationFor, insertIndent } from '../src/code/indentation';
import { loadLanguage } from '../src/code/languages';
import { indentListItem, shiftTabOutsideList, tabOutsideList } from '../src/features/smartLists';
import { fullyParsed, textOf } from './helpers';

/** State from text where "|" is the cursor, or "<" ">" mark a selection. */
function withSelection(text: string): { doc: string; selection: EditorSelection } {
  if (text.includes('|')) {
    const pos = text.indexOf('|');
    return { doc: text.replace('|', ''), selection: EditorSelection.single(pos) };
  }
  const anchor = text.indexOf('<');
  const stripped = text.replace('<', '');
  const head = stripped.indexOf('>');
  return { doc: stripped.replace('>', ''), selection: EditorSelection.single(anchor, head) };
}

/** A code file: language + indentation detected from the text (like createCodeState). */
async function codeFile(text: string, lang: string): Promise<EditorState> {
  const { doc, selection } = withSelection(text);
  return fullyParsed(EditorState.create({ doc, selection, extensions: [await loadLanguage(lang), indentationFor(doc, lang)] }));
}

/** A note with Python available for code blocks (like createMarkdownState). */
async function note(text: string): Promise<EditorState> {
  await LanguageDescription.matchLanguageName(languages, 'python')!.load();
  const { doc, selection } = withSelection(text);
  const extensions: Extension = [markdown({ base: markdownLanguage, codeLanguages: languages }), indentUnit.of('    ')];
  return fullyParsed(EditorState.create({ doc, selection, extensions }));
}

function apply(command: StateCommand, state: EditorState): string {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return textOf(next);
}

describe('detectIndent', () => {
  it('finds the step a file indents by', () => {
    expect(detectIndent('def f():\n    if x:\n        y\n    z')).toBe('    ');
    expect(detectIndent('function f() {\n  if (x) {\n    y();\n  }\n}')).toBe('  ');
    expect(detectIndent('func f() {\n\tx := 1\n}')).toBe('\t');
  });
  it('returns null without indented lines', () => {
    expect(detectIndent('print(1)\nprint(2)')).toBeNull();
    expect(detectIndent('')).toBeNull();
  });
});

describe('Enter in code files', () => {
  it('indents Python by 4 spaces after a block header', async () => {
    expect(apply(insertNewlineAndIndent, await codeFile('for i in range(3):|', 'python'))).toBe('for i in range(3):\n    |');
  });
  it('keeps the body level inside a 4-space block', async () => {
    expect(apply(insertNewlineAndIndent, await codeFile('def f():\n    x = 1|', 'python'))).toBe('def f():\n    x = 1\n    |');
  });
  it('follows a file that uses 2 spaces', async () => {
    expect(apply(insertNewlineAndIndent, await codeFile('def f():\n  x = 1|', 'python'))).toBe('def f():\n  x = 1\n  |');
  });
  it('uses 2 spaces for new JavaScript files', async () => {
    expect(apply(insertNewlineAndIndent, await codeFile('if (x) {|}', 'javascript'))).toBe('if (x) {\n  |\n}');
  });
});

describe('Tab in code files', () => {
  it('inserts spaces up to the next tab stop at the cursor', async () => {
    expect(apply(insertIndent, await codeFile('|x', 'python'))).toBe('    |x');
    expect(apply(insertIndent, await codeFile('x = 1|', 'python'))).toBe('x = 1   |');
    expect(apply(insertIndent, await codeFile('  |x', 'python'))).toBe('    |x');
  });
  it('Backspace in indentation removes a whole level', async () => {
    expect(apply(deleteCharBackward as unknown as StateCommand, await codeFile('def f():\n    |x', 'python'))).toBe('def f():\n|x');
  });
  it('indents the selected lines', async () => {
    expect(apply(insertIndent, await codeFile('<a\nb>', 'python'))).toBe('    <a\n    b>');
  });
});

describe('code blocks in notes', () => {
  it('Enter auto-indents Python by 4 spaces', async () => {
    const s = await note('```python\nfor i in range(3):|\n```');
    expect(apply(insertNewlineAndIndent, s)).toBe('```python\nfor i in range(3):\n    |\n```');
  });
  it('list-like code lines are not treated as list items', async () => {
    expect(apply(indentListItem, await note('```python\n- a\n|- b\n```'))).toBe('```python\n- a\n|- b\n```');
  });
  it('Tab inserts 4 spaces in a code block, 2 in prose', async () => {
    expect(apply(tabOutsideList, await note('```python\n|x\n```'))).toBe('```python\n    |x\n```');
    expect(apply(tabOutsideList, await note('Tekst|'))).toBe('  Tekst|');
    expect(apply(shiftTabOutsideList, await note('  Tekst|'))).toBe('Tekst|');
  });
});
