import { describe, expect, it } from 'vitest';
import { categories, itemsById, lookupCommand, previewLatex, searchItems } from '../src/features/math/catalog';
import { DEFAULT_SHORTCUTS } from '../src/features/math/shortcuts';
import { MathEditor } from '../src/features/math/editor';
import { toLatex } from '../src/features/math/latex';
import { canRender } from '../src/features/math/render';

const all = categories.flatMap((c) => c.items);

describe('math catalog', () => {
  it('has unique ids', () => {
    const ids = all.map((it) => it.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i && all[i].latex !== all[ids.indexOf(id)].latex);
    expect(dupes).toEqual([]);
  });

  it('every button preview renders', () => {
    const broken = all.filter((it) => !canRender(previewLatex(it)));
    expect(broken.map((it) => it.id)).toEqual([]);
  });

  it('every template can be inserted, and what it writes renders', () => {
    const broken: string[] = [];
    for (const it of all) {
      if (it.action) continue;
      const ed = new MathEditor('x', { display: false });
      ed.insert(it.latex);
      const latex = ed.latex;
      const marked = toLatex(ed.lines, { marks: true });
      if (!canRender(latex) || !canRender(marked)) broken.push(`${it.id}: ${latex}`);
    }
    expect(broken).toEqual([]);
  });

  it('every built-in shortcut renders', () => {
    const broken: string[] = [];
    for (const [trigger, value] of Object.entries(DEFAULT_SHORTCUTS)) {
      if (value.startsWith('@')) continue;
      const ed = new MathEditor('', { display: false });
      ed.insert(value);
      if (!canRender(ed.latex)) broken.push(trigger);
    }
    expect(broken).toEqual([]);
  });

  it('finds symbols by Norwegian name', () => {
    expect(searchItems('brøk')[0].id).toBe('frac');
    expect(searchItems('kvadratrot')[0].id).toBe('sqrt');
    expect(searchItems('integral').some((it) => it.id === 'int')).toBe(true);
    expect(searchItems('vektor').some((it) => it.id === 'vec')).toBe(true);
    expect(searchItems('alpha').some((it) => it.id === 'greek.alpha')).toBe(true);
  });

  it('the equilibrium arrow is a relation in math and <=> inside \\ce', () => {
    const arrow = itemsById.get('equilibrium')!;
    const math = new MathEditor('', { display: false });
    math.type('A');
    expect(math.inChemistry()).toBe(false);
    math.insert(arrow.latex);
    math.type('B');
    expect(math.latex).toBe('A \\rightleftharpoons B');

    const chem = new MathEditor('', { display: false });
    chem.insert(itemsById.get('ce')!.latex);
    chem.type('N2 + 3H2 ');
    expect(chem.inChemistry()).toBe(true);
    chem.type(arrow.chem!);
    chem.type(' 2NH3');
    expect(chem.latex).toBe('\\ce{N2 + 3H2 <=> 2NH3}');
    expect(new MathEditor('A ⇌ B', { display: false }).latex).toBe('A \\rightleftharpoons B');
  });

  it('commands after a backslash', () => {
    expect(lookupCommand('sqrt')).toBe('\\sqrt{#0}');
    expect(lookupCommand('alpha')).toBe('\\alpha');
    expect(itemsById.get('frac')?.latex).toBe('\\frac{#@}{#?}');
  });
});
