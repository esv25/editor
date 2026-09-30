import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { blockAt, parseFence } from '../src/features/util/fence';

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
