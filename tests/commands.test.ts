import { describe, expect, it } from 'vitest';
import { run } from './helpers';
import { toggleHeading, makeHeading } from '../src/features/headings';
import { toggleBold, toggleItalic, toggleInlineCode } from '../src/features/inlineFormat';
import { toggleList } from '../src/features/lists';
import { toggleCodeBlock } from '../src/features/codeBlocks';
import { toggleTaskDone } from '../src/features/taskList';
import { continueList as insertNewlineContinueMarkup, indentListItem, outdentListItem } from '../src/features/smartLists';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';

describe('headings', () => {
  it('adds, switches and removes', () => {
    expect(run(toggleHeading(2), 'Tit|tel')).toBe('## Tit|tel');
    expect(run(toggleHeading(1), '## Tit|tel')).toBe('# Tit|tel');
    expect(run(toggleHeading(1), '# Tit|tel')).toBe('Tit|tel');
    expect(run(toggleHeading(2), '|')).toBe('## |');
    expect(run(toggleHeading(2), '- pun|kt')).toBe('## pun|kt');
  });
  it('makeHeading never removes', () => {
    expect(run(makeHeading(2), 'Tit|tel')).toBe('## Tit|tel');
    expect(run(makeHeading(2), '# Tit|tel')).toBe('# Tit|tel');
  });
});

describe('inline formatting', () => {
  it('wraps a selection', () => {
    expect(run(toggleBold, 'a <ord> b')).toBe('a **<ord>** b');
    expect(run(toggleBold, 'a < ord > b')).toBe('a  **<ord>**  b');
  });
  it('unwraps when inside or selecting', () => {
    expect(run(toggleBold, 'a **o|rd** b')).toBe('a o|rd b');
    expect(run(toggleBold, 'a <**ord**> b')).toBe('a <ord> b');
    expect(run(toggleItalic, 'a *o|rd* b')).toBe('a o|rd b');
    expect(run(toggleInlineCode, 'a `o|rd` b')).toBe('a o|rd b');
  });
  it('wraps the word at the cursor', () => {
    expect(run(toggleItalic, 'a o|rd b')).toBe('a *o|rd* b');
  });
  it('inserts an empty pair when not in a word', () => {
    expect(run(toggleBold, 'a | b')).toBe('a **|** b');
  });
  it('italic inside bold adds italic', () => {
    expect(run(toggleItalic, '**o|rd**')).toBe('***o|rd***');
  });
});

describe('lists', () => {
  it('toggles bullets on multiple lines', () => {
    expect(run(toggleList('bullet'), '<a\nb>')).toBe('<- a\n- b>');
    expect(run(toggleList('bullet'), '<- a\n- b>')).toBe('<a\nb>');
  });
  it('puts the cursor after the marker on an empty line', () => {
    expect(run(toggleList('bullet'), '|')).toBe('- |');
    expect(run(toggleList('task'), '|')).toBe('- [ ] |');
  });
  it('numbers ordered lists and converts between kinds', () => {
    expect(run(toggleList('ordered'), '<- a\n- b\n\n- c>')).toBe('<1. a\n2. b\n\n3. c>');
    expect(run(toggleList('task'), '1. a|')).toBe('- [ ] a|');
    expect(run(toggleList('bullet'), '- [x] a|')).toBe('- a|');
  });
  it('continues numbering from the item above', () => {
    expect(run(toggleList('ordered'), '1. a\n2. b\nc|')).toBe('1. a\n2. b\n3. c|');
  });
});

describe('code blocks', () => {
  it('wraps and unwraps lines', () => {
    expect(run(toggleCodeBlock, '<a\nb>')).toBe('```\n<a\nb>\n```');
    expect(run(toggleCodeBlock, '```\na|\nb\n```')).toBe('a|\nb');
  });
  it('inserts an empty block on an empty line', () => {
    expect(run(toggleCodeBlock, 'x\n\n|')).toBe('x\n\n```\n|\n```');
  });
});

describe('tasks', () => {
  it('toggles done', () => {
    expect(run(toggleTaskDone, '- [ ] a|')).toBe('- [x] a|');
    expect(run(toggleTaskDone, '- [x] a|')).toBe('- [ ] a|');
  });
});

describe('smart lists', () => {
  it('continues lists on Enter', () => {
    expect(run(insertNewlineContinueMarkup, '- a|')).toBe('- a\n- |');
    expect(run(insertNewlineContinueMarkup, '1. a|')).toBe('1. a\n2. |');
    expect(run(insertNewlineContinueMarkup, '- [x] a|')).toBe('- [x] a\n- [ ] |');
  });
  it('ends the list on an empty item', () => {
    expect(run(insertNewlineContinueMarkup, '- a\n- |')).toBe('- a\n|');
  });
  it('Backspace after a marker removes it', () => {
    expect(run(deleteMarkupBackward, '- a\n- |')).not.toBe('- a\n- |');
  });
  it('indents under the previous sibling at its content column', () => {
    expect(run(indentListItem, '- a\n- b|')).toBe('- a\n  - b|');
    expect(run(indentListItem, '1. a\n2. b|')).toBe('1. a\n   2. b|');
  });
  it('cannot indent the first item', () => {
    expect(run(indentListItem, '- a|')).toBe('- a|');
  });
  it('outdents to the parent level, bringing children', () => {
    expect(run(outdentListItem, '- a\n  - b|')).toBe('- a\n- b|');
    expect(run(outdentListItem, '- a\n  - b|\n    - c\n- d')).toBe('- a\n- b|\n  - c\n- d');
  });
  it('indent moves sub-items along', () => {
    expect(run(indentListItem, '- a\n- b|\n  - c')).toBe('- a\n  - b|\n    - c');
  });
  it('does nothing outside lists', () => {
    expect(run(indentListItem, 'tekst|')).toBe('tekst|');
  });
});
