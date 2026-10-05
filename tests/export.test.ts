import { describe, expect, it } from 'vitest';
import { imageSources, parseDocument } from '../src/export/document';
import { buildDocx, documentTitle } from '../src/export/docx';
import { blocks as toHtml } from '../src/export/html';
import { latexToOmml } from '../src/export/omml';
import { parseXml } from '../src/export/xml';
import { crc32, zip } from '../src/export/zip';

describe('parseDocument', () => {
  it('reads headings, paragraphs and inline formatting', () => {
    expect(parseDocument('# Hei *du*\n\nTekst med **fet** og `kode`\nsom fortsetter.')).toEqual([
      { t: 'heading', level: 1, children: [{ t: 'text', text: 'Hei ' }, { t: 'em', children: [{ t: 'text', text: 'du' }] }] },
      {
        t: 'para',
        children: [
          { t: 'text', text: 'Tekst med ' },
          { t: 'strong', children: [{ t: 'text', text: 'fet' }] },
          { t: 'text', text: ' og ' },
          { t: 'code', text: 'kode' },
          { t: 'text', text: ' som fortsetter.' },
        ],
      },
    ]);
  });

  it('reads math, links, images, escapes and entities', () => {
    const [p] = parseDocument('Se $x^2$ og [her](https://a.no) ![Figur](bilde.png) \\*ikke\\* &amp; https://b.no');
    expect(p).toEqual({
      t: 'para',
      children: [
        { t: 'text', text: 'Se ' },
        { t: 'math', latex: 'x^2' },
        { t: 'text', text: ' og ' },
        { t: 'link', href: 'https://a.no', children: [{ t: 'text', text: 'her' }] },
        { t: 'text', text: ' ' },
        { t: 'image', src: 'bilde.png', alt: 'Figur' },
        { t: 'text', text: ' *ikke* & ' },
        { t: 'link', href: 'https://b.no', children: [{ t: 'text', text: 'https://b.no' }] },
      ],
    });
  });

  it('reads block math, code with title and hard breaks', () => {
    expect(parseDocument('$$\n\\frac12\n$$\n\n```python title="a.py"\nfor i in x:\n    print(i)\n```\n\nen\\\nto')).toEqual([
      { t: 'math', latex: '\\frac12' },
      { t: 'code', lang: 'python', title: 'a.py', text: 'for i in x:\n    print(i)' },
      { t: 'para', children: [{ t: 'text', text: 'en' }, { t: 'break' }, { t: 'text', text: 'to' }] },
    ]);
  });

  it('reads nested lists, tasks and code inside lists', () => {
    const doc = parseDocument('- [x] gjort\n- [ ] ikke\n- punkt\n  1. en\n  2. to\n\n  ```\n  kode\n  ```');
    expect(doc).toHaveLength(1);
    const list = doc[0];
    if (list.t !== 'list') throw new Error('not a list');
    expect(list.items.map((i) => i.checked)).toEqual([true, false, null]);
    const nested = list.items[2].blocks;
    expect(nested[1]).toMatchObject({ t: 'list', ordered: true, start: 1 });
    expect(parseDocument('3. tre')[0]).toMatchObject({ t: 'list', ordered: true, start: 3 });
    expect(nested[2]).toEqual({ t: 'code', lang: '', title: null, text: 'kode' });
  });

  it('reads tables with alignment and empty cells', () => {
    const [table] = parseDocument('| a | b | c |\n|:-|:-:|--:|\n| 1 || 3 |');
    expect(table).toEqual({
      t: 'table',
      align: ['left', 'center', 'right'],
      head: [[{ t: 'text', text: 'a' }], [{ t: 'text', text: 'b' }], [{ t: 'text', text: 'c' }]],
      rows: [[[{ t: 'text', text: '1' }], [], [{ t: 'text', text: '3' }]]],
    });
  });

  it('keeps raw HTML as text and drops comments', () => {
    expect(parseDocument('<div onclick="x">hei</div>\n\n<!-- skjult -->')).toEqual([
      { t: 'para', children: [{ t: 'text', text: '<div onclick="x">hei</div>' }] },
    ]);
  });

  it('lists image sources and finds a title', () => {
    const doc = parseDocument('Tekst\n\n## Tittel\n\n![a](x.png)\n\n> ![b](y.svg) ![a](x.png)');
    expect(imageSources(doc)).toEqual(['x.png', 'y.svg']);
    expect(documentTitle(doc, 'fil')).toBe('Tittel');
    expect(documentTitle(parseDocument('bare tekst'), 'fil')).toBe('fil');
  });
});

describe('HTML', () => {
  it('escapes text, drops inline HTML and only links to web and mail addresses', () => {
    const html = toHtml(parseDocument('<b onclick="x">&</b> a<b [x](javascript:alert(1)) [y](https://a.no)\n\n<script>x</script>'), new Map());
    expect(html).toContain('<p>&amp; a&lt;b x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript');
    expect(html).toContain('<a href="https://a.no">y</a>');
  });

  it('shows images it has, with the alt text as caption', () => {
    const doc = parseDocument('![Graf](g.png)\n\n![](mangler.png)');
    const html = toHtml(doc, new Map([['g.png', 'blob:1']]));
    expect(html).toContain('<figure><img src="blob:1" alt="Graf"><figcaption>Graf</figcaption></figure>');
    expect(html).toContain('[bilde]');
  });

  it('renders math with KaTeX', () => {
    expect(toHtml(parseDocument('$x$'), new Map())).toContain('class="katex"');
  });
});

describe('OMML', () => {
  const omml = (latex: string, display = false) => latexToOmml(latex, display)!;

  it('writes fractions, scripts and roots', () => {
    expect(omml('\\frac{a}{b}')).toContain('<m:f><m:num>');
    expect(omml('x^2_1')).toContain('<m:sSubSup>');
    expect(omml('\\sqrt{2}')).toContain('<m:degHide m:val="1"/>');
    expect(omml('\\sqrt[3]{x}')).toMatch(/<m:rad><m:deg>.*3.*<\/m:deg>/);
  });

  it('turns big operators into n-ary with what follows as body', () => {
    const sum = omml('\\sum_{i=1}^{n} i^2 = s', true);
    expect(sum).toMatch(/<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr>/);
    // The body stops at the relation.
    expect(sum).toMatch(/<m:e><m:sSup>.*<\/m:sSup><\/m:e><\/m:nary><m:r>.*=/);
    expect(omml('\\int f\\,dx')).toContain('<m:subHide m:val="1"/><m:supHide m:val="1"/>');
  });

  it('writes fences, accents, bars and matrices', () => {
    expect(omml('\\left(\\frac12\\right)')).toContain('<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/>');
    expect(omml('\\vec v')).toContain('<m:acc><m:accPr><m:chr m:val="⃗"/>');
    expect(omml('\\overline{AB}')).toContain('<m:bar><m:barPr><m:pos m:val="top"/>');
    expect(omml('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}')).toMatch(/<m:m>.*<m:count m:val="2"\/>.*<m:mr>/);
    expect(omml('\\begin{cases}x&1\\\\y&2\\end{cases}')).toContain('<m:endChr m:val=""/>');
  });

  it('aligns multi-line math at the &', () => {
    const eq = omml('\\begin{aligned}x&=1\\\\y&=2\\end{aligned}', true);
    expect(eq).toContain('<m:eqArr>');
    expect(eq).toContain('<m:t>&amp;</m:t>');
  });

  it('uses combining accents and function structures', () => {
    expect(omml('\\hat x')).toContain('<m:chr m:val="\u0302"/>');
    expect(omml('\\sin x + 1')).toMatch(/<m:func><m:fName>.*sin.*<\/m:fName><m:e><m:r>.*x.*<\/m:e><\/m:func><m:r>.*\+/);
    expect(omml('\\ln(2x)')).toMatch(/<m:func>.*<m:e>.*\(.*2.*x.*\).*<\/m:e><\/m:func><\/m:oMath>$/);
  });

  it('keeps text upright and function names upright', () => {
    expect(omml('\\text{eller}')).toContain('<m:rPr><m:nor/></m:rPr><m:t>eller</m:t>');
    expect(omml('\\sin x')).toContain('<m:sty m:val="p"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>sin</m:t>');
  });

  it('puts chemistry subscripts on the element', () => {
    expect(omml('\\ce{H2O}')).toMatch(/<m:sSub><m:e><m:r>.*<m:t>H<\/m:t><\/m:r><\/m:e><m:sub>.*2.*<\/m:sub><\/m:sSub>/);
  });

  it('gives up on LaTeX KaTeX cannot read', () => {
    expect(latexToOmml('\\frac{', false)).toBeNull();
  });

  it('writes well-formed XML', () => {
    for (const latex of ['\\frac{a}{b}', '\\sum_{i=1}^n i', '\\ce{2H2 + O2 -> 2H2O}', 'a<b', '\\text{a \\& b}']) {
      expect(isWellFormed(omml(latex, true)), latex).toBe(true);
    }
  });
});

describe('docx', () => {
  it('stores files in a zip with correct checksums', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = zip([{ name: 'a.txt', data: 'hei' }]);
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(z.slice(30 + 5, 30 + 5 + 3))).toBe('hei');
  });

  it('builds a package with document, styles, numbering and images', () => {
    const doc = parseDocument('# Tittel\n\n1. en\n2. to\n\n- [x] ok\n\n$$x^2$$\n\n![Bilde](a.png)\n\n| a |\n|---|\n| 1 |');
    const png = new Uint8Array([1, 2, 3]);
    const docx = buildDocx(doc, { title: 'Tittel', images: new Map([['a.png', { data: png, type: 'png', width: 100, height: 50 }]]) });
    const files = unzipNames(docx);
    expect(files).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/media/image1.png']),
    );
    const xml = fileText(docx, 'word/document.xml');
    expect(isWellFormed(xml)).toBe(true);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<m:oMathPara><m:oMath>');
    expect(xml).toContain('☒');
    expect(xml).toContain('<wp:extent cx="952500" cy="476250"/>');
    expect(xml).toContain('<w:tbl>');
    expect(isWellFormed(fileText(docx, 'word/numbering.xml'))).toBe(true);
    expect(isWellFormed(fileText(docx, 'word/styles.xml'))).toBe(true);
    expect(fileText(docx, 'word/_rels/document.xml.rels')).toContain('Target="media/image1.png"');
  });
});

// --- Helpers ----------------------------------------------------------------------------

/** Tags open and close in order (our XML reader is lenient, so check by hand). */
function isWellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]);
  }
  return stack.length === 0 && parseXml(xml).length > 0 && !/&(?!amp;|lt;|gt;|quot;|#)/.test(xml);
}

function entries(z: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(z.buffer, z.byteOffset);
  const out = [];
  let pos = 0;
  while (view.getUint32(pos, true) === 0x04034b50) {
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const name = new TextDecoder().decode(z.slice(pos + 30, pos + 30 + nameLen));
    out.push({ name, data: z.slice(pos + 30 + nameLen, pos + 30 + nameLen + size) });
    pos += 30 + nameLen + size;
  }
  return out;
}
const unzipNames = (z: Uint8Array) => entries(z).map((e) => e.name);
const fileText = (z: Uint8Array, name: string) => new TextDecoder().decode(entries(z).find((e) => e.name === name)!.data);
