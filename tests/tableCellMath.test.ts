import { describe, expect, it } from 'vitest';
import { cellParts, mathSource } from '../src/features/tables/cellMath';
import { pipesEscaped } from '../src/features/tables/model';

describe('cellParts', () => {
  it('splits a cell into text and formulas', () => {
    expect(cellParts('$x^2$ og $\\frac{1}{2}$')).toEqual([
      { t: 'math', latex: 'x^2', dollars: 1 },
      { t: 'text', text: ' og ' },
      { t: 'math', latex: '\\frac{1}{2}', dollars: 1 },
    ]);
  });

  it('reads escaped pipes as pipes, in text and formulas', () => {
    expect(cellParts('$\\|x\\|$ a\\|b')).toEqual([
      { t: 'math', latex: '|x|', dollars: 1 },
      { t: 'text', text: ' a|b' },
    ]);
  });

  it('leaves dollars that are not formulas, and code, as text', () => {
    expect(cellParts('koster $5 og $10')).toEqual([{ t: 'text', text: 'koster $5 og $10' }]);
    expect(cellParts('`$x$`')).toEqual([{ t: 'text', text: '`$x$`' }]);
  });

  it('reads $$…$$ alone in a cell as a formula in the line', () => {
    expect(cellParts('$$x$$')).toEqual([{ t: 'math', latex: 'x', dollars: 2 }]);
  });

  it('gives nothing for an empty cell', () => {
    expect(cellParts('')).toEqual([]);
  });
});

describe('mathSource', () => {
  it('writes a formula that reads back the same in a table', () => {
    for (const latex of ['|x|', '\\frac{a}{b}', '\\left|x\\right|']) {
      const raw = pipesEscaped(mathSource(latex));
      expect(cellParts(raw)).toEqual([{ t: 'math', latex, dollars: 1 }]);
    }
  });

  it('writes LaTeX’s \\| as \\Vert (\\| reads as an escaped pipe)', () => {
    expect(mathSource('\\|v\\|')).toBe('$\\Vert v\\Vert $');
    expect(mathSource('a\\\\|b')).toBe('$a\\\\|b$');
  });

  it('drops an empty formula and keeps a closing $ off a space', () => {
    expect(mathSource('  ')).toBe('');
    expect(mathSource('x\\ ')).toBe('$x\\,$');
    expect(mathSource('x', 2)).toBe('$$x$$');
  });
});
