import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Extension, type StateCommand } from '@codemirror/state';
import { deleteCharBackward, insertNewlineAndIndent } from '@codemirror/commands';
import { indentUnit, LanguageDescription } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { activeIndentBlock, blockHeaders, describeIndent, stickyHeaders, detectIndent, indentationFor, insertIndent } from '../src/code/indentation';
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

describe('indent levels', () => {
  const code = ['def f(x):', '    if x:', '        a = 1', '', '        b = 2', '    return x', '', 'f(1)'].join('\n');
  const stateAt = (line: number, col = 0) => {
    const state = EditorState.create({ doc: code, extensions: indentUnit.of('    ') });
    return { state, pos: state.doc.line(line).from + col };
  };
  const block = (line: number) => {
    const { state, pos } = stateAt(line);
    return activeIndentBlock(state, pos);
  };

  it('highlights the block a header line opens', () => {
    expect(block(1)).toEqual({ level: 1, from: 2, to: 6 });
    expect(block(2)).toEqual({ level: 2, from: 3, to: 5 });
  });

  it('highlights the innermost block a line belongs to, through blank lines', () => {
    expect(block(3)).toEqual({ level: 2, from: 3, to: 5 });
    expect(block(4)).toEqual({ level: 2, from: 3, to: 5 });
    expect(block(6)).toEqual({ level: 1, from: 2, to: 6 });
  });

  it('has no block at the top level', () => {
    expect(block(8)).toBeNull();
  });

  it('describes the indentation at the cursor', () => {
    const { state, pos } = stateAt(3);
    expect(describeIndent(state, pos)).toBe('innrykk 2');
    const odd = EditorState.create({ doc: '      x', extensions: indentUnit.of('    ') });
    expect(describeIndent(odd, 0)).toBe('innrykk 1 + 2 mellomrom');
  });
});

describe('sticky scroll', () => {
  const py = [
    'class A:', //       1
    '    def f(self):', // 2
    '        # note', //    3
    '        for i in x:', // 4
    '            a = 1', //   5
    '# commented out', //     6
    '            b = 2', //   7
    '', //                    8
    '    def g(', //          9
    '        self,', //       10
    '    ):', //              11
    '        return 1', //    12
    '', //                    13
    'f(1)', //                14
  ].join('\n');

  it('finds the lines that open the blocks around a line, skipping comments', async () => {
    const state = await codeFile(py, 'python');
    expect(blockHeaders(state, 7)).toEqual([1, 2, 4]);
    expect(blockHeaders(state, 3)).toEqual([1, 2]);
    expect(blockHeaders(state, 6)).toEqual([1, 2, 4]);
    // A blank line between two methods belongs to the class.
    expect(blockHeaders(state, 8)).toEqual([1]);
    expect(blockHeaders(state, 13)).toEqual([]);
    expect(blockHeaders(state, 14)).toEqual([]);
  });

  it('uses the line a long parameter list starts on', async () => {
    const state = await codeFile(py, 'python');
    expect(blockHeaders(state, 12)).toEqual([1, 9]);
  });

  it('keeps headers whose blocks go on below them', async () => {
    const state = await codeFile(py, 'python');
    expect(stickyHeaders(state, 1)).toEqual([]);
    // The class covers line 2, so "def f" goes under it.
    expect(stickyHeaders(state, 2)).toEqual([1, 2]);
    expect(stickyHeaders(state, 4)).toEqual([1, 2, 4]);
    expect(stickyHeaders(state, 4, 2)).toEqual([1, 2]);
    // Three headers would cover lines 5–7 and leave the blank line before "def g" below them.
    expect(stickyHeaders(state, 5)).toEqual([1, 2]);
    expect(stickyHeaders(state, 6)).toEqual([1]);
    expect(stickyHeaders(state, 9)).toEqual([1]);
    expect(stickyHeaders(state, 10)).toEqual([1, 9]);
  });
});
