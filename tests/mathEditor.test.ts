import { describe, expect, it } from 'vitest';
import { MathEditor } from '../src/features/math/editor';
import * as M from '../src/features/math/model';
import { defaultShortcuts } from '../src/features/math/shortcuts';

function editor(latex = '', display = false): MathEditor {
  return new MathEditor(latex, { display, shortcuts: defaultShortcuts() });
}

/** The editor's LaTeX with ▮ at the cursor (and [ ] around a selection). */
function show(ed: MathEditor): string {
  const s = ed.snapshot();
  const { row, index } = ed.pos;
  if (ed.hasSelection) {
    const a = ed.anchor!;
    const [from, to] = a < index ? [a, index] : [index, a];
    row.items.splice(to, 0, M.raw(']'));
    row.items.splice(from, 0, M.raw('['));
  } else {
    row.items.splice(index, 0, M.raw('▮'));
  }
  const out = ed.latex;
  ed.restore(s);
  return out;
}

function typed(text: string, display = false): string {
  const ed = editor('', display);
  ed.type(text);
  return show(ed);
}

describe('typing', () => {
  it('plain arithmetic', () => {
    expect(typed('3+4=7')).toBe('3 + 4 = 7▮');
    expect(typed('3*4')).toBe('3 \\cdot 4▮');
    expect(typed('12:3')).toBe('12 : 3▮');
  });
  it('fractions take the term before the slash', () => {
    expect(typed('1/2')).toBe('\\frac{1}{2▮}');
    expect(typed('x+12/')).toBe('x + \\frac{12}{▮}');
    expect(typed('(x+1)/2')).toBe('\\frac{x + 1}{2▮}');
    expect(typed('/')).toBe('\\frac{▮}{}');
    expect(typed('2x/3 +1')).toBe('\\frac{2x}{3} + 1▮');
  });
  it('scripts', () => {
    expect(typed('x^2')).toBe('x^{2▮}');
    expect(typed('x^2 +1')).toBe('x^2 + 1▮');
    expect(typed('x**2')).toBe('x^{2▮}');
    expect(typed('a_n')).toBe('a_{n▮}');
    expect(typed('xê')).toBe('x^{e▮}');
    expect(typed('x²+1')).toBe('x^2 + 1▮');
  });
  it('brackets pair up and step out', () => {
    expect(typed('(x+1')).toBe('(x + 1▮)');
    expect(typed('(x+1)')).toBe('(x + 1)▮');
    expect(typed('(x+1)^2')).toBe('(x + 1)^{2▮}');
    expect(typed('|x|')).toBe('|x|▮');
    expect(typed('[0,2)')).toBe('[0{,}2)▮');
  });
  it('decimal comma and list comma', () => {
    expect(typed('3,5')).toBe('3{,}5▮');
    expect(typed('(1, 2)')).toBe('(1, 2)▮');
  });
  it('shortcuts', () => {
    expect(typed('sqrt')).toBe('\\sqrt{▮}');
    expect(typed('sqrt2')).toBe('\\sqrt{2▮}');
    expect(typed('2pi')).toBe('2\\pi▮');
    expect(typed('x<=3')).toBe('x \\le 3▮');
    expect(typed('a<=>b')).toBe('a \\Leftrightarrow b▮');
    expect(typed('sin')).toBe('\\sin▮');
    expect(typed('sinh')).toBe('\\sinh▮');
    expect(typed('theta')).toBe('\\theta▮');
    expect(typed('beta')).toBe('\\beta▮');
    expect(typed('epsilon')).toBe('\\varepsilon▮');
    expect(typed('x->oo')).toBe('x \\to \\infty▮');
    expect(typed('+-')).toBe('\\pm▮');
  });
  it('backspace right after a replacement takes it back', () => {
    const ed = editor();
    ed.type('sin');
    ed.backspace();
    expect(show(ed)).toBe('sin▮');
    const ed2 = editor();
    ed2.type('a/');
    ed2.backspace();
    expect(show(ed2)).toBe('a/▮');
  });
  it('text with quotes', () => {
    expect(typed('x=2"eller"x=3')).toBe('x = 2\\text{ eller }x = 3▮');
  });
  it('commands after a backslash', () => {
    expect(typed('\\alpha ')).toBe('\\alpha▮');
    expect(typed('\\frac ')).toBe('\\frac{▮}{}');
  });
});

describe('moving', () => {
  it('through a fraction', () => {
    const ed = editor('\\frac{1}{2}+3');
    ed.edge('start');
    expect(show(ed)).toBe('▮\\frac{1}{2} + 3');
    ed.move('right');
    expect(show(ed)).toBe('\\frac{▮1}{2} + 3');
    ed.move('right');
    ed.move('right');
    expect(show(ed)).toBe('\\frac{1}{▮2} + 3');
    ed.moveVertical('up');
    expect(show(ed)).toBe('\\frac{▮1}{2} + 3');
    ed.move('right');
    ed.move('right');
    ed.move('right');
    ed.move('right');
    expect(show(ed)).toBe('\\frac{1}{2}▮ + 3');
  });
  it('leaves at the edges', () => {
    const ed = editor('x');
    expect(ed.move('right')).toBe('right');
    ed.edge('start');
    expect(ed.move('left')).toBe('left');
  });
  it('tab goes to the next empty spot, then out', () => {
    const ed = editor();
    ed.insert('\\int_{#?}^{#?} #? \\, dx');
    expect(show(ed)).toBe('\\int_{▮}^{}\\,dx');
    ed.type('0');
    ed.tab();
    ed.type('1');
    ed.tab();
    expect(show(ed)).toBe('\\int_0^1[]\\,dx');
    ed.type('x');
    expect(show(ed)).toBe('\\int_0^1 x▮\\,dx');
    expect(ed.tab()).toBe('right');
  });
  it('shift+arrows select whole structures', () => {
    const ed = editor('a+\\frac{1}{2}');
    ed.move('left', true);
    expect(show(ed)).toBe('a + [\\frac{1}{2}]');
    ed.type('/');
    expect(show(ed)).toBe('a + \\frac{\\frac{1}{2}}{▮}');
  });
});

describe('deleting', () => {
  it('steps into structures and unwraps at their start', () => {
    const ed = editor('x^2');
    ed.backspace();
    expect(show(ed)).toBe('x^{2▮}');
    ed.backspace();
    expect(show(ed)).toBe('x^{▮}');
    ed.backspace();
    expect(show(ed)).toBe('x▮');
  });
  it('unwraps a fraction from its denominator', () => {
    const ed = editor('\\frac{1}{2}');
    ed.backspace();
    ed.backspace();
    ed.backspace();
    expect(show(ed)).toBe('1▮');
  });
  it('selects a matrix before deleting it', () => {
    const ed = editor('\\begin{pmatrix} 1 \\end{pmatrix}');
    ed.backspace();
    expect(ed.hasSelection).toBe(true);
    ed.backspace();
    expect(show(ed)).toBe('▮');
  });
});

describe('lines and matrices', () => {
  it('enter makes aligned lines in display math', () => {
    const ed = editor('', true);
    ed.type('2x+3=7');
    ed.enter();
    ed.type('x=2');
    expect(ed.latex).toBe('\\begin{aligned}\n2x + 3 &= 7 \\\\\nx &= 2\n\\end{aligned}');
  });
  it('enter in inline math leaves', () => {
    const ed = editor('x');
    expect(ed.enter()).toBe('right');
  });
  it('rows and columns', () => {
    const ed = editor();
    ed.insert('\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}');
    ed.type('1');
    ed.tab();
    ed.type('2');
    ed.addColumn();
    ed.type('3');
    expect(ed.latex).toBe('\\begin{pmatrix} 1 & 2 & 3 \\\\  &  &  \\end{pmatrix}');
    ed.addRow();
    expect(ed.latex).toBe('\\begin{pmatrix} 1 & 2 & 3 \\\\  &  &  \\\\  &  &  \\end{pmatrix}');
    // The cursor is in the new row's first cell: that row, then the first column, go.
    ed.deleteRow();
    ed.deleteColumn();
    expect(ed.latex).toBe('\\begin{pmatrix} 2 & 3 \\\\  &  \\end{pmatrix}');
  });
});

describe('templates', () => {
  it('wraps the selection', () => {
    const ed = editor('x+1');
    ed.selectAll();
    ed.insert('\\sqrt{#0}');
    expect(show(ed)).toBe('\\sqrt{x + 1}▮');
  });
  it('a script template attaches to what is before it', () => {
    const ed = editor('x');
    ed.insert('^{2}');
    expect(show(ed)).toBe('x^2▮');
    const empty = editor();
    empty.insert('^{2}');
    expect(show(empty)).toBe('[]^2');
  });
  it('a selection that gets a script is bracketed', () => {
    const ed = editor('x+1');
    ed.selectAll();
    ed.insert('#0^{2}');
    expect(show(ed)).toBe('(x + 1)^2▮');
  });
});
