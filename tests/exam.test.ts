import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { examItems, findNotes, findRatings, noteText, ratingInsertAt, rowCells, sortTablesByWeek, topicTitle, weekStats } from '../src/features/exam/model';
import { addLinkChange, addNoteChange, noteChange, ratingChange, ratingDown, ratingUp } from '../src/features/exam/commands';
import { run, stateOf } from './helpers';

describe('exam model', () => {
  it('finds ratings and notes outside inline code', () => {
    const line = "- [ ] Derivasjon {7/10} `{1/10}` {0/10} {11/10} ^[f'(x) er [stigning]] ^[to]";
    expect(findRatings(line).map((r) => r.value)).toEqual([7]);
    expect(findNotes(line).map((n) => n.text)).toEqual(["f'(x) er [stigning]", 'to']);
  });
  it('escapes notes to one line, pipes too (tables)', () => {
    expect(noteText('a ] b\nc')).toBe('^[a \\] b c]');
    expect(noteText('a | b')).toBe('^[a \\| b]');
    expect(findNotes(noteText('a ] b'))[0].text).toBe('a ] b');
  });
  it('puts new ratings before links and notes', () => {
    const line = '- [ ] Emne [Notat](n.md) ^[x]';
    expect(line.slice(0, ratingInsertAt(line))).toBe('- [ ] Emne');
  });
  it('lists rated items with their section', () => {
    const items = examItems(['# Fag', '## Tema', '- [x] **Emne** {4/10} [Notat](n.md) ^[x]', '- uten']);
    expect(items).toEqual([{ line: 3, title: 'Emne Notat', rating: 4, done: true, section: 'Tema', week: null }]);
    expect(topicTitle('- [ ] A {2/10}')).toBe('A');
  });
  it('reads table rows', () => {
    const items = examItems(['## Tema', '| Emne | Forståelse | Notat |', '| --- | --- | --- |', '| Integral | {2/10} | ^[a \\| b] |']);
    expect(items).toEqual([{ line: 4, title: 'Integral', rating: 2, done: false, section: 'Tema', week: null }]);
    expect(rowCells('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
  });
  const weekly = [
    '| Uke | Emne | Forståelse |',
    '| --- | --- | --- |',
    '| 3 | C | {1/10} |',
    '| uke 1 | A | {8/10} |',
    '|  | X |  |',
    '| 1 | B | {2/10} |',
  ];
  it('reads weeks and the topic column', () => {
    expect(examItems(weekly).map((i) => [i.title, i.week])).toEqual([['C', 3], ['A', 1], ['X', null], ['B', 1]]);
  });
  it('gives stats per week, weeks in order', () => {
    expect(weekStats(examItems(weekly)).map((w) => [w.week, w.count, w.average, w.byRating])).toEqual([
      [1, 2, 5, [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]],
      [3, 1, 1, [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      [null, 1, null, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ]);
  });
  it('sorts tables by week, stable, rows without a week last', () => {
    const lines = [...weekly, '', 'Tekst'];
    const changed = sortTablesByWeek(lines);
    changed.forEach((text, i) => (lines[i] = text));
    expect(lines.slice(2, 6)).toEqual(['| uke 1 | A | {8/10} |', '| 1 | B | {2/10} |', '| 3 | C | {1/10} |', '|  | X |  |']);
    expect(sortTablesByWeek(lines).size).toBe(0);
  });
});

describe('exam commands', () => {
  it('adds and steps ratings', () => {
    expect(run(ratingUp, '- [ ] Emne| ^[x]')).toBe('- [ ] Emne| {1/10} ^[x]');
    expect(run(ratingUp, '- [ ] Emne {9/10}|')).toBe('- [ ] Emne {10/10}|');
    expect(run(ratingUp, '- Emne {10/10}|')).toBe('- Emne {10/10}|');
    expect(run(ratingDown, '- Emne {1/10}|')).toBe('- Emne {1/10}|');
    expect(run(ratingUp, 'Ikke liste|')).toBe('Ikke liste|');
  });
  it('steps ratings in table rows that have one', () => {
    const state = EditorState.create({ doc: '| A | {2/10} |' });
    expect(state.update({ changes: ratingChange(state, 1, (v) => v + 1)! }).state.doc.toString()).toBe('| A | {3/10} |');
    expect(ratingChange(EditorState.create({ doc: '| A | |' }), 1, (v) => v + 1)).toBeNull();
  });
  it('edits, removes and adds notes', () => {
    const state = stateOf('- A ^[gammel] x|');
    const apply = (c: ReturnType<typeof noteChange>) => state.update({ changes: c! }).state.doc.toString();
    expect(apply(noteChange(state, 4, 'ny'))).toBe('- A ^[ny] x');
    expect(apply(noteChange(state, 4, ''))).toBe('- A x');
    const b = stateOf('- B|');
    expect(b.update({ changes: addNoteChange(b, 1)!.change }).state.doc.toString()).toBe('- B ^[Forklaring]');
  });
  it('adds links before notes', () => {
    const state = stateOf('- A {1/10} ^[n]|');
    expect(state.update({ changes: addLinkChange(state, 1, 'Mitt notat', 'mapper/mitt notat.md') }).state.doc.toString())
      .toBe('- A {1/10} [Mitt notat](<mapper/mitt notat.md>) ^[n]');
  });
});
