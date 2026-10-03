import { describe, expect, it } from 'vitest';
import { parseLatex, toLatex } from '../src/features/math/latex';
import { MathEditor } from '../src/features/math/editor';
import { defaultShortcuts } from '../src/features/math/shortcuts';

const doc = `# Mattetest

Løs likningen $2x+3=7$ og regn ut $\\frac{1}{2}+\\sqrt{x^2+1}$.

$$
\\begin{aligned}
2x + 3 &= 7 \\\\
2x &= 4 \\\\
x &= 2
\\end{aligned}
$$

Integral: $\\int_0^1 x^2\\,dx = \\left[\\frac{x^3}{3}\\right]_0^1$ slutt.
`;

const tidy = (latex: string) => toLatex(parseLatex(latex));

describe('math robustness', () => {
  it('parses a whole Markdown document as LaTeX without hanging', () => {
    const lines = parseLatex(doc);
    expect(toLatex(lines).length).toBeGreaterThan(0);
  });

  it('survives random input', () => {
    const alphabet = ['\\', '{', '}', '[', ']', '(', ')', '^', '_', '&', '$', '#', '?', '0', '@', 'a', 'x', ' ', '\n', '\\\\',
      '\\frac', '\\left', '\\right', '\\begin{pmatrix}', '\\end{pmatrix}', '\\begin{foo}', '\\text{', '\\sqrt', '|', ',', '%'];
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i++) {
      let s = '';
      const n = Math.floor(rand() * 20);
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      // Reading and writing settles (broken LaTeX may take a round or two to be tidied).
      const settled = tidy(tidy(s));
      expect(tidy(settled), JSON.stringify(s)).toBe(settled);
    }
  });

  it('typing random keys never throws', () => {
    const keys = ['a', '1', '/', '^', '_', '(', ')', '|', '\\', '"', ' ', ',', '*', 's', 'q', 'r', 't', '<', '=', '>'];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const ed = new MathEditor('', { display: i % 2 === 0, shortcuts: defaultShortcuts() });
      for (let j = 0; j < 30; j++) {
        const r = rand();
        if (r < 0.6) ed.type(keys[Math.floor(rand() * keys.length)]);
        else if (r < 0.7) ed.backspace();
        else if (r < 0.75) ed.deleteForward();
        else if (r < 0.8) ed.move(rand() < 0.5 ? 'left' : 'right', rand() < 0.3);
        else if (r < 0.85) ed.moveVertical(rand() < 0.5 ? 'up' : 'down');
        else if (r < 0.9) ed.tab(rand() < 0.5);
        else if (r < 0.95) ed.enter();
        else ed.edge(rand() < 0.5 ? 'start' : 'end', rand() < 0.5);
      }
      const once = tidy(ed.latex);
      expect(tidy(once)).toBe(once);
    }
  });
});
