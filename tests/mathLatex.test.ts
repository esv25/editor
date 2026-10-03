import { describe, expect, it } from 'vitest';
import { parseLatex, toLatex } from '../src/features/math/latex';

/** Parse and write back. */
const tidy = (latex: string) => toLatex(parseLatex(latex));

describe('math LaTeX round trip', () => {
  it('keeps simple formulas and tidies spacing', () => {
    expect(tidy('2x+3=7')).toBe('2x + 3 = 7');
    expect(tidy('x = -2')).toBe('x = -2');
    expect(tidy('-x+1')).toBe('-x + 1');
    expect(tidy('a\\cdot b')).toBe('a \\cdot b');
    expect(tidy('\\alpha x')).toBe('\\alpha x');
    expect(tidy('\\sin x')).toBe('\\sin x');
  });

  it('fractions, roots and scripts', () => {
    expect(tidy('\\frac{1}{2}')).toBe('\\frac{1}{2}');
    expect(tidy('\\frac12')).toBe('\\frac{1}{2}');
    expect(tidy('\\sqrt[3]{x+1}')).toBe('\\sqrt[3]{x + 1}');
    expect(tidy('x^2+x^{10}')).toBe('x^2 + x^{10}');
    expect(tidy('e^{-x}')).toBe('e^{-x}');
    expect(tidy('x_1^2')).toBe('x_1^2');
    expect(tidy('\\int_0^1 x\\,dx')).toBe('\\int_0^1 x\\,dx');
    expect(tidy('x^2{}^3')).toBe('x^2{}^3');
    expect(tidy('{}^{14}C')).toBe('{}^{14}C');
    expect(tidy('{x+1}^2')).toBe('{x + 1}^2');
  });

  it('decimal comma and lists', () => {
    expect(tidy('3{,}5')).toBe('3{,}5');
    expect(tidy('(1,2)')).toBe('(1, 2)');
    expect(tidy('x = 1{,}5 \\cdot 10^{8}')).toBe('x = 1{,}5 \\cdot 10^8');
  });

  it('brackets', () => {
    expect(tidy('f(x)')).toBe('f(x)');
    expect(tidy('\\left(x\\right)')).toBe('(x)');
    expect(tidy('\\left(\\frac{1}{2}\\right)^2')).toBe('\\left(\\frac{1}{2}\\right)^2');
    expect(tidy('P(A|B)')).toBe('P(A|B)');
    expect(tidy('|x|+|y|')).toBe('|x| + |y|');
    expect(tidy('[0, 2\\rangle')).toBe('[0, 2\\rangle');
    expect(tidy('x \\in \\langle 0, 2 \\rangle')).toBe('x \\in \\langle 0, 2\\rangle');
    expect(tidy('\\left. F(x) \\right|_a^b')).toBe('\\left.F(x)\\right|_a^b');
    expect(tidy('\\{1, 2\\}')).toBe('\\{1, 2\\}');
  });

  it('text and units', () => {
    expect(tidy('x=2 \\text{eller} x=3')).toBe('x = 2\\text{ eller }x = 3');
    expect(tidy('\\text{ eller }')).toBe('\\text{ eller }');
    expect(tidy('5\\,\\mathrm{cm}')).toBe('5\\,\\mathrm{cm}');
    expect(tidy('\\mathbb{R}')).toBe('\\mathbb{R}');
    expect(tidy('\\text{50 \\%}')).toBe('\\text{50 \\%}');
    expect(tidy('20\\%')).toBe('20\\%');
  });

  it('environments', () => {
    expect(tidy('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}')).toBe('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}');
    expect(tidy('\\begin{array}{c|cc} x & 1 & 2 \\\\ \\hline y & 3 & 4 \\end{array}')).toBe(
      '\\begin{array}{c|cc} x & 1 & 2 \\\\ \\hline y & 3 & 4 \\end{array}',
    );
    expect(tidy('\\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}')).toBe(
      '\\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}',
    );
    expect(tidy('\\left\\{\\begin{aligned} 2x+y &= 5 \\\\ x-y &= 1 \\end{aligned}\\right.')).toBe(
      '\\left\\{\\begin{aligned} 2x + y &= 5 \\\\ x - y &= 1 \\end{aligned}\\right.',
    );
  });

  it('multi-line display math is aligned at the first relation', () => {
    const lines = parseLatex('2x+3 = 7 \\\\ 2x = 4 \\\\ \\Leftrightarrow x = 2');
    expect(lines).toHaveLength(3);
    expect(toLatex(lines)).toBe('\\begin{aligned}\n2x + 3 &= 7 \\\\\n2x &= 4 \\\\\n\\Leftrightarrow x &= 2\n\\end{aligned}');
    expect(toLatex(parseLatex(toLatex(lines)))).toBe(toLatex(lines));
  });

  it('chemistry stays as typed', () => {
    expect(tidy('\\ce{2H2 + O2 -> 2H2O}')).toBe('\\ce{2H2 + O2 -> 2H2O}');
    expect(tidy('\\ce{SO4^2-}')).toBe('\\ce{SO4^2-}');
  });

  it('keeps what it does not understand', () => {
    expect(tidy('\\ce{H2O}')).toBe('\\ce{H2O}');
    expect(tidy('\\begin{tikzcd} a \\end{tikzcd}')).toBe('\\begin{tikzcd} a \\end{tikzcd}');
    expect(tidy('\\color{red} x')).toBe('\\color{red}x');
    expect(tidy('\\int\\limits_0^1')).toBe('\\int\\limits_0^1');
  });
});
