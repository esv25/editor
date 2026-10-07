import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { fullyParsed } from './helpers';
import { cellAt, formatTable, parseTable } from '../src/features/tables/model';
import {
  insertTable,
  tableAlign,
  tableColumnLeft,
  tableColumnRight,
  tableDelete,
  tableDeleteColumn,
  tableDeleteRow,
  tableEnter,
  tableFormat,
  tableMoveColumnRight,
  tableMoveRowDown,
  tableNextCell,
  tablePreviousCell,
  tableRowAbove,
  tableRowBelow,
} from '../src/features/tables/commands';

const lines = (...l: string[]) => l.join('\n');

/** Like `run` in helpers, but "¦" is the cursor and «…» a selection (tables are full of "|"). */
function run(command: StateCommand, text: string): string {
  const doc = text.replace(/[¦«»]/g, '');
  const anchor = text.search(/[¦«]/);
  const head = text.includes('»') ? text.replace('«', '').indexOf('»') : anchor;
  let state = fullyParsed(
    EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ base: markdownLanguage })] }),
  );
  command({ state, dispatch: (tr) => (state = tr.state) });
  const { from, to, empty } = state.selection.main;
  const out = state.doc.toString();
  return empty ? out.slice(0, from) + '¦' + out.slice(from) : out.slice(0, from) + '«' + out.slice(from, to) + '»' + out.slice(to);
}

describe('table model', () => {
  it('reads cells, alignment and escaped pipes', () => {
    const t = parseTable(['a | b\\|c', ':-|--:', '| 1 |  |']);
    expect(t).toEqual({ indent: '', rows: [['a', 'b\\|c'], ['1', '']], align: ['left', 'right'] });
  });

  it('is not a table without a delimiter row', () => {
    expect(parseTable(['| a |', '| b |'])).toBeNull();
  });

  it('keeps cells beyond the header as new columns', () => {
    expect(parseTable(['| a |', '|---|', '| 1 | 2 |'])!.rows).toEqual([['a', ''], ['1', '2']]);
  });

  it('writes aligned columns', () => {
    const t = parseTable(['|a|bbbbb|', '|:-:|-:|', '|æøå|x|'])!;
    expect(formatTable(t).lines).toEqual(['| a   | bbbbb |', '| :-: | ----: |', '| æøå | x     |']);
  });

  it('finds the cell at a column', () => {
    const l = ['| ab | cd |', '| -- | -- |', '|x|y|'];
    expect(cellAt(l, 0, 3)).toEqual({ row: 0, col: 0, offset: 1 });
    expect(cellAt(l, 0, 5)).toEqual({ row: 0, col: 0, offset: 2 }); // before the pipe
    expect(cellAt(l, 0, 6)).toEqual({ row: 0, col: 1, offset: 0 });
    expect(cellAt(l, 2, 2)).toEqual({ row: 1, col: 0, offset: 1 });
    expect(cellAt(l, 2, 3)).toEqual({ row: 1, col: 1, offset: 0 });
  });
});

describe('table commands', () => {
  it('inserts an empty table on an empty line', () => {
    expect(run(insertTable, 'Tekst\n¦\nMer')).toBe(
      lines('Tekst', '', '| ¦    |     |     |', '| --- | --- | --- |', '|     |     |     |', '|     |     |     |', '', 'Mer'),
    );
  });

  it('inserts below a line of text', () => {
    expect(run(insertTable, 'Tekst¦')).toBe(
      lines('Tekst', '', '| ¦    |     |     |', '| --- | --- | --- |', '|     |     |     |', '|     |     |     |'),
    );
  });

  it('Tab formats and selects the next cell', () => {
    expect(run(tableNextCell, lines('| a¦ | bb |', '|-|-|', '| ccc| d|'))).toBe(
      lines('| a   | «bb»  |', '| --- | --- |', '| ccc | d   |'),
    );
    expect(run(tableNextCell, lines('| a | b¦ |', '|-|-|', '| c | d |'))).toBe(
      lines('| a   | b   |', '| --- | --- |', '| «c»   | d   |'),
    );
  });

  it('Tab in the last cell adds a row', () => {
    expect(run(tableNextCell, lines('| a | b |', '|---|---|', '| c | d¦ |'))).toBe(
      lines('| a   | b   |', '| --- | --- |', '| c   | d   |', '| ¦    |     |'),
    );
  });

  it('Shift+Tab goes back', () => {
    expect(run(tablePreviousCell, lines('| a | b |', '|---|---|', '| c¦ | d |'))).toBe(
      lines('| a   | «b»   |', '| --- | --- |', '| c   | d   |'),
    );
  });

  it('is not used outside tables', () => {
    expect(run(tableNextCell, 'Tekst | her¦')).toBe('Tekst | her¦');
  });

  it('Enter goes down, adds a row, and leaves on an empty last row', () => {
    expect(run(tableEnter, lines('| a¦ | b |', '|---|---|', '| c | d |'))).toBe(
      lines('| a   | b   |', '| --- | --- |', '| c¦   | d   |'),
    );
    expect(run(tableEnter, lines('| a | b |', '|---|---|', '| c | d¦ |'))).toBe(
      lines('| a   | b   |', '| --- | --- |', '| c   | d   |', '|     | ¦    |'),
    );
    expect(run(tableEnter, lines('| a | b |', '|---|---|', '| c | d |', '| ¦ |  |', '', 'Mer'))).toBe(
      lines('| a   | b   |', '| --- | --- |', '| c   | d   |', '', '¦', '', 'Mer'),
    );
  });

  it('adds and deletes rows', () => {
    const t = lines('| a | b |', '|---|---|', '| c¦ | d |');
    expect(run(tableRowBelow, t)).toBe(lines('| a   | b   |', '| --- | --- |', '| c   | d   |', '| ¦    |     |'));
    expect(run(tableRowAbove, t)).toBe(lines('| a   | b   |', '| --- | --- |', '| ¦    |     |', '| c   | d   |'));
    expect(run(tableDeleteRow, t)).toBe(lines('| a¦   | b   |', '| --- | --- |'));
  });

  it('deleting the header makes the first row the header', () => {
    expect(run(tableDeleteRow, lines('| a¦ | b |', '|---|---|', '| c | d |'))).toBe(lines('| c¦   | d   |', '| --- | --- |'));
  });

  it('adds, moves and deletes columns', () => {
    const t = lines('| a¦ | b |', '|---|--:|', '| c | d |');
    expect(run(tableColumnRight, t)).toBe(lines('| a   | ¦    | b   |', '| --- | --- | --: |', '| c   |     | d   |'));
    expect(run(tableColumnLeft, t)).toBe(lines('| ¦    | a   | b   |', '| --- | --- | --: |', '|     | c   | d   |'));
    expect(run(tableMoveColumnRight, t)).toBe(lines('| b   | a¦   |', '| --: | --- |', '| d   | c   |'));
    expect(run(tableDeleteColumn, t)).toBe(lines('| b¦   |', '| --: |', '| d   |'));
  });

  it('moves rows but not the header', () => {
    expect(run(tableMoveRowDown, lines('| a |', '|---|', '| b¦ |', '| c |'))).toBe(lines('| a   |', '| --- |', '| c   |', '| b¦   |'));
    expect(run(tableMoveRowDown, lines('| a¦ |', '|---|', '| b |'))).toBe(lines('| a¦ |', '|---|', '| b |'));
  });

  it('aligns the column', () => {
    expect(run(tableAlign('center'), lines('| a | b¦ |', '|---|---|'))).toBe(lines('| a   | b¦   |', '| --- | :-: |'));
  });

  it('deletes the whole table', () => {
    expect(run(tableDelete, lines('Før', '', '| a¦ |', '|---|', '', 'etter'))).toBe(lines('Før', '', '¦etter'));
  });

  it('keeps the indent of a table in a list item', () => {
    expect(run(tableFormat, lines('- liste', '', '  | a¦ |', '  |-|', '  | b |'))).toBe(
      lines('- liste', '', '  | a¦   |', '  | --- |', '  | b   |'),
    );
  });
});
