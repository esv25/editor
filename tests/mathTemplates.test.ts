import { describe, expect, it } from 'vitest';
import { parseLatex } from '../src/features/math/latex';
import * as M from '../src/features/math/model';
import { symbolChoices, templateOf } from '../src/features/math/templates';

/** The first node in a formula matching a test. */
function find(latex: string, test: (n: M.MathNode) => boolean): M.MathNode {
  for (const r of M.allRows(parseLatex(latex))) for (const n of r.items) if (test(n)) return n;
  throw new Error('not found');
}

describe('shortcut templates from a formula', () => {
  it('structures become empty templates', () => {
    expect(templateOf(find('\\frac{1}{2}', (n) => n.kind === 'cmd'))).toBe('\\frac{#@}{#?}');
    expect(templateOf(find('\\sqrt{x}', (n) => n.kind === 'cmd'))).toBe('\\sqrt{#0}');
    expect(templateOf(find('\\sqrt[3]{x}', (n) => n.kind === 'cmd'))).toBe('\\sqrt[#?]{#0}');
    expect(templateOf(find('x^2', (n) => n.kind === 'scripts'))).toBe('^{#?}');
    expect(templateOf(find('|x|', (n) => n.kind === 'group'))).toBe('\\left|#0\\right|');
    expect(templateOf(find('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', (n) => n.kind === 'env'))).toBe(
      '\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}',
    );
  });

  it('symbols are kept, plain letters and digits are not worth it', () => {
    expect(templateOf(find('\\alpha', () => true))).toBe('\\alpha');
    expect(templateOf(find('x', () => true))).toBeNull();
    expect(templateOf(find('2', () => true))).toBeNull();
  });

  it('a right click offers the symbol, the structures around it and the whole formula', () => {
    const lines = parseLatex('\\frac{\\pi}{2}');
    const pi = M.allRows(lines).flatMap((r) => r.items).find((n) => n.kind === 'sym' && n.latex === '\\pi')!;
    const choices = symbolChoices(pi, [], '\\frac{\\pi}{2}');
    expect(choices.map((c) => c.name)).toEqual(['Pi', 'Brøk', 'hele formelen']);
    expect(choices.map((c) => c.latex)).toEqual(['\\pi', '\\frac{#@}{#?}', '\\frac{\\pi}{2}']);
  });
});
