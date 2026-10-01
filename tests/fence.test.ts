import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { blockAt, parseFence, rewriteFence } from '../src/features/util/fence';

describe('parseFence', () => {
  it('reads language and title', () => {
    const f = parseFence('```python title="beregning.py"')!;
    expect(f.lang).toBe('python');
    expect(f.title).toBe('beregning.py');
    expect('```python title="beregning.py"'.slice(f.titleFrom, f.titleTo)).toBe('beregning.py');
  });
  it('handles missing parts', () => {
    expect(parseFence('```')).toMatchObject({ lang: '', title: null, langFrom: 3, langTo: 3 });
    expect(parseFence('~~~ js')).toMatchObject({ lang: 'js', fence: '~~~' });
    expect(parseFence('``` title="x"')).toMatchObject({ lang: '', title: 'x' });
  });
  it('rejects non-fences', () => {
    expect(parseFence('`inline`')).toBeNull();
    expect(parseFence('    ```')).toBeNull();
    expect(parseFence('```a`b')).toBeNull();
  });
});

describe('blockAt', () => {
  it('extracts the code between fences', () => {
    const doc = Text.of(['tekst', '```py', 'print(1)', 'print(2)', '```', 'etter']);
    const block = blockAt(doc, doc.line(2).from)!;
    expect(block.code).toBe('print(1)\nprint(2)');
    expect(block.close?.number).toBe(5);
  });
  it('runs to the end when unclosed', () => {
    const doc = Text.of(['```py', 'x = 1']);
    expect(blockAt(doc, 0)!.code).toBe('x = 1');
    expect(blockAt(doc, 0)!.close).toBeNull();
  });
});

describe('rewriteFence', () => {
  it('sets and replaces the title', () => {
    expect(rewriteFence('```', { title: 'navn.py' })).toBe('``` title="navn.py"');
    expect(rewriteFence('```python', { title: 'a b' })).toBe('```python title="a b"');
    expect(rewriteFence('```python title="gammel"', { title: 'ny' })).toBe('```python title="ny"');
  });
  it('removes an empty title', () => {
    expect(rewriteFence('```python title="x"', { title: '  ' })).toBe('```python');
    expect(rewriteFence('``` title="x"', { title: '' })).toBe('```');
  });
  it('changes language and keeps title and other attributes', () => {
    expect(rewriteFence('``` title="x"', { lang: 'js' })).toBe('```js title="x"');
    expect(rewriteFence('```py {1,3} title="x"', { lang: 'python' })).toBe('```python title="x" {1,3}');
    expect(rewriteFence('  ~~~js', { lang: '' })).toBe('  ~~~');
  });
  it('keeps the parse round-trip stable', () => {
    const line = rewriteFence('```', { lang: 'python', title: 'fil "1".py' })!;
    expect(parseFence(line)).toMatchObject({ lang: 'python', title: "fil '1'.py" });
  });
});
