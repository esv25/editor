import { describe, expect, it } from 'vitest';
import {
  cellFormula,
  columnName,
  computeTable,
  formatValue,
  numberIn,
  recalculateRows,
  remapFormula,
} from '../src/features/tables/formula';
import { deleteColumn, deleteRow, insertRow, moveColumn, type Table } from '../src/features/tables/model';

/** The value of a formula placed in an extra cell after the given rows. */
function calc(formula: string, rows: string[][] = [['Pris'], ['25'], ['40']]): string {
  const sheet = [...rows, [formula]];
  return formatValue(computeTable(sheet)[sheet.length - 1][0]);
}

describe('table formulas', () => {
  it('reads numbers the Norwegian way', () => {
    expect(numberIn('2,5')).toBe(2.5);
    expect(numberIn('1 234,50')).toBe(1234.5);
    expect(numberIn('25 kr')).toBe(25);
    expect(numberIn('**40**')).toBe(40);
    expect(numberIn('20 %')).toBe(0.2);
    expect(numberIn('-3')).toBe(-3);
    expect(numberIn('Melk')).toBeNull();
    expect(numberIn('')).toBeNull();
    expect(numberIn('65 <!-- =A2+A3 -->')).toBe(65);
    expect(numberIn('<!-- a -->5<!-- b -->')).toBe(5);
    expect(numberIn('5 <!-- uten slutt')).toBe(5);
    expect(numberIn('<!<!---->--5')).toBeNull();
  });

  it('writes answers with a decimal comma', () => {
    expect(formatValue(2.5)).toBe('2,5');
    expect(formatValue(0.1 + 0.2)).toBe('0,3');
    expect(formatValue(10 / 4)).toBe('2,5');
  });

  it('computes arithmetic with precedence', () => {
    expect(calc('=A2+A3')).toBe('65');
    expect(calc('=A2+A3*2')).toBe('105');
    expect(calc('=(A2+A3)*2')).toBe('130');
    expect(calc('=2^3^2')).toBe('512');
    expect(calc('=-A2+1')).toBe('-24');
    expect(calc('=A3*25%')).toBe('10');
    expect(calc('=2,5*2')).toBe('5');
    expect(calc('=a2+a3')).toBe('65');
  });

  it('has functions in Norwegian and English', () => {
    expect(calc('=SUMMER(A2:A3)')).toBe('65');
    expect(calc('=SUM(A1:A3)')).toBe('65'); // text in the range is skipped
    expect(calc('=GJENNOMSNITT(A2:A3)')).toBe('32,5');
    expect(calc('=average(A2:A3)')).toBe('32,5');
    expect(calc('=MAKS(A2:A3)-MIN(A2:A3)')).toBe('15');
    expect(calc('=ANTALL(A1:A3)')).toBe('2');
    expect(calc('=AVRUND(10/3;2)')).toBe('3,33');
    expect(calc('=ROT(16)')).toBe('4');
    expect(calc('=HVIS(A2>30;"dyr";"billig")')).toBe('billig');
    expect(calc('=MEDIAN(1;5;3)')).toBe('3');
  });

  it('gives Excel-style errors', () => {
    expect(calc('=A2/0')).toBe('#DIV/0!');
    expect(calc('=A1*2')).toBe('#VERDI!');
    expect(calc('=A9')).toBe('#REFERANSE!');
    expect(calc('=FOO(1)')).toBe('#NAVN?');
    expect(calc('=2+')).toBe('#FEIL!');
    expect(calc('=A4')).toBe('#SYKLUS!');
  });

  it('formulas use other formulas', () => {
    const values = computeTable([['A', 'B'], ['2', '=A2*10'], ['=B2+1', '=A3+B2']]);
    expect(values.map((r) => r.map(formatValue))).toEqual([['A', 'B'], ['2', '20'], ['21', '41']]);
  });

  it('stores the answer with the formula hidden in a comment', () => {
    expect(recalculateRows([['Pris'], ['25'], ['40'], ['=SUM(A2:A3)']])[3][0]).toBe('65 <!-- =SUM(A2:A3) -->');
    // An old answer is replaced.
    expect(recalculateRows([['Pris'], ['30'], ['40'], ['65 <!-- =SUM(A2:A3) -->']])[3][0]).toBe('70 <!-- =SUM(A2:A3) -->');
    expect(cellFormula('70 <!-- =SUM(A2:A3) -->')).toBe('=SUM(A2:A3)');
    expect(cellFormula('Melk')).toBeNull();
  });

  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('references follow rows and columns', () => {
  const table = (rows: string[][]): Table => ({ indent: '', rows, align: rows[0].map(() => null) });
  const at = (row: number, col: number) => ({ row, col, offset: 0 });

  it('inserting a row moves references below it', () => {
    const t = table([['Vare', 'Pris'], ['Melk', '25'], ['Sum', '=SUM(B2:B2)+B2']]);
    expect(insertRow(t, at(1, 0), true).table!.rows[3][1]).toBe('=SUM(B2:B2)+B2');
    expect(insertRow(t, at(1, 0), false).table!.rows[3][1]).toBe('=SUM(B3:B3)+B3');
  });

  it('deleting a row shrinks ranges and breaks single references', () => {
    const t = table([['Pris'], ['1'], ['2'], ['=SUM(A2:A3)+A2']]);
    expect(deleteRow(t, at(1, 0)).table!.rows[2][0]).toBe('=SUM(A2:A2)+#REFERANSE!');
    expect(calc('=1+#REFERANSE!')).toBe('#REFERANSE!');
  });

  it('columns move too', () => {
    const t = table([['A', 'B', 'C'], ['1', '2', '=A2+B2']]);
    expect(moveColumn(t, at(1, 0), true)!.table!.rows[1][2]).toBe('=B2+A2');
    expect(deleteColumn(t, at(1, 0)).table!.rows[1][1]).toBe('=#REFERANSE!+A2');
  });

  it('leaves text in quotes alone', () => {
    expect(remapFormula('=HVIS(A2>1;"A2";A2)', (r) => r + 1, (c) => c)).toBe('=HVIS(A3>1;"A2";A3)');
  });
});
