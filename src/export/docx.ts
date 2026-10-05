/**
 * Document model → .docx (Office Open XML). Written by hand like the rest of
 * the export: headings and lists use Word's own styles and numbering, code
 * gets a grey box, and formulas become real Word equations (omml.ts). Pure
 * (images arrive as bytes), tested in tests/export.test.ts.
 */
import type { Align, Block, Inline, ListItem } from './document';
import { inlineText } from './document';
import { latexToOmml } from './omml';
import { esc } from './xml';
import { zip } from './zip';

export interface DocxImage {
  data: Uint8Array;
  type: 'png' | 'jpeg' | 'gif';
  /** Display size in CSS pixels. */
  width: number;
  height: number;
}

export interface DocxOptions {
  title: string;
  /** Image source (as written in the Markdown) → its bytes, or missing if it couldn't be read. */
  images: Map<string, DocxImage>;
}

// A4 with 2 cm margins, in twentieths of a point; images in EMU.
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1134;
const TEXT_W = PAGE_W - 2 * MARGIN;
const EMU_PER_TWIP = 635;
const EMU_PER_PX = 9525;
const LIST_INDENT = 425;
const QUOTE_INDENT = 284;

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

interface Fmt {
  b?: boolean;
  i?: boolean;
  strike?: boolean;
  vert?: 'superscript' | 'subscript';
  style?: string;
}

/** Where a block is: list depth, extra indent and quote depth. */
interface Ctx {
  level: number;
  indent: number;
  quote: number;
}

class Writer {
  private rels: string[] = [];
  private media: { name: string; data: Uint8Array }[] = [];
  private mediaIds = new Map<string, { rid: string; name: string }>();
  /** Ordered lists each get their own numbering instance (so they restart). */
  private orderedNums: { id: number; level: number; start: number }[] = [];
  private nextNum = 2;
  private drawingId = 1;

  constructor(private readonly images: Map<string, DocxImage>) {}

  private rel(type: string, target: string, external = false): string {
    const id = `rId${this.rels.length + 10}`;
    this.rels.push(
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    );
    return id;
  }

  // --- Runs --------------------------------------------------------------------------

  private rPr(f: Fmt): string {
    const p =
      (f.style ? `<w:rStyle w:val="${f.style}"/>` : '') +
      (f.b ? '<w:b/>' : '') +
      (f.i ? '<w:i/>' : '') +
      (f.strike ? '<w:strike/>' : '') +
      (f.vert ? `<w:vertAlign w:val="${f.vert}"/>` : '');
    return p ? `<w:rPr>${p}</w:rPr>` : '';
  }

  textRun(text: string, f: Fmt = {}): string {
    // Tabs and line breaks are their own elements.
    const parts = text.split(/(\t|\n)/).filter((p) => p !== '');
    const body = parts
      .map((p) => (p === '\t' ? '<w:tab/>' : p === '\n' ? '<w:br/>' : `<w:t xml:space="preserve">${esc(p)}</w:t>`))
      .join('');
    return body ? `<w:r>${this.rPr(f)}${body}</w:r>` : '';
  }

  inlines(items: Inline[], f: Fmt = {}): string {
    return items.map((item) => this.inline(item, f)).join('');
  }

  private inline(item: Inline, f: Fmt): string {
    switch (item.t) {
      case 'text':
        return this.textRun(item.text, f);
      case 'strong':
        return this.inlines(item.children, { ...f, b: true });
      case 'em':
        return this.inlines(item.children, { ...f, i: true });
      case 'strike':
        return this.inlines(item.children, { ...f, strike: true });
      case 'sup':
        return this.inlines(item.children, { ...f, vert: 'superscript' });
      case 'sub':
        return this.inlines(item.children, { ...f, vert: 'subscript' });
      case 'code':
        return this.textRun(item.text, { ...f, style: 'CodeChar' });
      case 'break':
        return '<w:r><w:br/></w:r>';
      case 'math':
        return latexToOmml(item.latex, false) ?? this.textRun(`$${item.latex}$`, { ...f, style: 'CodeChar' });
      case 'link': {
        const content = this.inlines(item.children, { ...f, style: 'Hyperlink' });
        if (!/^(https?:|mailto:)/i.test(item.href)) return this.inlines(item.children, f);
        return `<w:hyperlink r:id="${this.rel('hyperlink', item.href, true)}" w:history="1">${content}</w:hyperlink>`;
      }
      case 'image':
        return this.image(item.src, item.alt) ?? this.textRun(`[${item.alt || 'bilde'}]`, { ...f, i: true });
    }
  }

  private image(src: string, alt: string): string | null {
    const img = this.images.get(src);
    if (!img) return null;
    let media = this.mediaIds.get(src);
    if (!media) {
      const name = `image${this.media.length + 1}.${img.type === 'jpeg' ? 'jpeg' : img.type}`;
      this.media.push({ name, data: img.data });
      media = { rid: this.rel('image', `media/${name}`), name };
      this.mediaIds.set(src, media);
    }
    const maxW = TEXT_W * EMU_PER_TWIP;
    let cx = Math.max(1, Math.round(img.width * EMU_PER_PX));
    let cy = Math.max(1, Math.round(img.height * EMU_PER_PX));
    if (cx > maxW) {
      cy = Math.round((cy * maxW) / cx);
      cx = maxW;
    }
    const id = this.drawingId++;
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${id}" name="Bilde ${id}" descr="${esc(alt)}"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${media.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${media.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    );
  }

  // --- Paragraphs --------------------------------------------------------------------

  private para(content: string, ctx: Ctx, opts: { style?: string; num?: { id: number; level: number }; jc?: string; hanging?: boolean; keepNext?: boolean; after?: number } = {}): string {
    const left = ctx.indent + ctx.quote * QUOTE_INDENT;
    const props =
      (opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '') +
      (opts.keepNext ? '<w:keepNext/>' : '') +
      (opts.num ? `<w:numPr><w:ilvl w:val="${opts.num.level}"/><w:numId w:val="${opts.num.id}"/></w:numPr>` : '') +
      (ctx.quote ? '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr>' : '') +
      (opts.after !== undefined ? `<w:spacing w:after="${opts.after}"/>` : '') +
      (left || opts.hanging ? `<w:ind w:left="${left}"${opts.hanging ? ` w:hanging="${LIST_INDENT}"` : ''}/>` : '') +
      (opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '');
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
  }

  blocks(list: Block[], ctx: Ctx): string {
    return list.map((b) => this.block(b, ctx)).join('');
  }

  private block(block: Block, ctx: Ctx): string {
    switch (block.t) {
      case 'heading':
        return this.para(this.inlines(block.children), ctx, { style: `Heading${block.level}` });
      case 'para': {
        const only = block.children.length === 1 ? block.children[0] : null;
        if (only?.t === 'image') {
          // An image on its own line: the alt text is its caption (as in the editor).
          const picture = this.para(this.inlines([only]), ctx, { keepNext: !!only.alt });
          return only.alt && this.images.has(only.src) ? picture + this.para(this.textRun(only.alt), ctx, { style: 'Caption' }) : picture;
        }
        return this.para(this.inlines(block.children), ctx, { style: ctx.quote ? 'Quote' : undefined });
      }
      case 'math': {
        const omml = latexToOmml(block.latex, true);
        if (!omml) return this.code(`$$\n${block.latex}\n$$`, null, ctx);
        return this.para(`<m:oMathPara>${omml}</m:oMathPara>`, ctx);
      }
      case 'code':
        return this.code(block.text, block.title, ctx);
      case 'quote':
        return this.blocks(block.blocks, { ...ctx, quote: ctx.quote + 1 });
      case 'hr':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>';
      case 'list':
        return this.list(block, ctx);
      case 'table':
        return this.table(block.align, block.head, block.rows, ctx);
    }
  }

  private code(text: string, title: string | null, ctx: Ctx): string {
    const head = title ? this.para(this.textRun(title), ctx, { style: 'CodeTitle' }) : '';
    const lines = text.split('\n');
    // The box is one paragraph per line; the last one gets the usual space below.
    return head + lines.map((line, i) => this.para(this.textRun(line), ctx, { style: 'Code', after: i === lines.length - 1 ? 140 : undefined })).join('');
  }

  private list(block: Extract<Block, { t: 'list' }>, ctx: Ctx): string {
    const level = Math.min(ctx.level, 8);
    let numId = 1;
    if (block.ordered) {
      numId = this.nextNum++;
      this.orderedNums.push({ id: numId, level, start: block.start });
    }
    const inner: Ctx = { level: ctx.level + 1, indent: ctx.indent + LIST_INDENT, quote: ctx.quote };
    return block.items.map((item) => this.listItem(item, numId, level, ctx, inner)).join('');
  }

  private listItem(item: ListItem, numId: number, level: number, ctx: Ctx, inner: Ctx): string {
    const [first, ...rest] = item.blocks;
    let head: string;
    if (item.checked !== null) {
      const box = this.textRun(item.checked ? '☒\t' : '☐\t');
      const text = first?.t === 'para' ? this.inlines(first.children) : '';
      head = this.para(box + text, inner, { hanging: true, after: 60 });
    } else if (first?.t === 'para') {
      head = this.para(this.inlines(first.children), { ...ctx, indent: 0 }, { num: { id: numId, level }, after: 60 });
    } else {
      head = this.para('', { ...ctx, indent: 0 }, { num: { id: numId, level }, after: 60 }) + (first ? this.block(first, inner) : '');
    }
    return head + this.blocks(rest, inner);
  }

  private table(align: Align[], head: Inline[][], rows: Inline[][][], ctx: Ctx): string {
    const cols = Math.max(1, head.length);
    const width = TEXT_W - ctx.indent - ctx.quote * QUOTE_INDENT;
    const colW = Math.floor(width / cols);
    const cell = (content: Inline[], i: number, header: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr>` +
      `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${align[i] ? `<w:jc w:val="${align[i] === 'center' ? 'center' : align[i]}"/>` : ''}</w:pPr>${this.inlines(content, header ? { b: true } : {})}</w:p></w:tc>`;
    const row = (cells: Inline[][], header: boolean) =>
      `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c, i) => cell(c, i, header)).join('')}</w:tr>`;
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${colW * cols}" w:type="dxa"/>${ctx.indent ? `<w:tblInd w:w="${ctx.indent}" w:type="dxa"/>` : ''}` +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>` +
      row(head, true) +
      rows.map((r) => row(r, false)).join('') +
      '</w:tbl>' +
      // Space after the table (and Word wants a paragraph between two tables).
      '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'
    );
  }

  // --- Package -----------------------------------------------------------------------

  document(blocks: Block[]): string {
    const body = this.blocks(blocks, { level: 0, indent: 0, quote: 0 });
    const sect = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
    return `${XML_HEAD}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  }

  numbering(): string {
    const bullets = ['•', '◦', '▪'];
    const lvl = (i: number, ordered: boolean) =>
      `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/>` +
      `<w:lvlText w:val="${ordered ? `%${i + 1}.` : bullets[i % 3]}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${(i + 1) * LIST_INDENT}" w:hanging="${LIST_INDENT}"/></w:pPr></w:lvl>`;
    const abstract = (id: number, ordered: boolean) =>
      `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, ordered)).join('')}</w:abstractNum>`;
    const nums =
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      this.orderedNums
        .map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`)
        .join('');
    return `${XML_HEAD}<w:numbering ${NS}>${abstract(0, false)}${abstract(1, true)}${nums}</w:numbering>`;
  }

  documentRels(): string {
    const fixed =
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
    return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fixed}${this.rels.join('')}</Relationships>`;
  }

  mediaFiles() {
    return this.media;
  }
}

const STYLES = (() => {
  const heading = (n: number, size: number, before: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
    `<w:rPr><w:b/>${n >= 4 ? '<w:i/>' : ''}<w:color w:val="1F2937"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const mono = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
  return (
    `${XML_HEAD}<w:styles ${NS}>` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="nb-NO" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
    heading(1, 36, 360) + heading(2, 30, 300) + heading(3, 26, 240) + heading(4, 24, 200) + heading(5, 22, 200) + heading(6, 22, 200) +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Kode"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="113" w:right="113"/></w:pPr><w:rPr>${mono}<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>` +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeTitle"><w:name w:val="Kodetittel"/><w:basedOn w:val="Normal"/><w:next w:val="Code"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="0"/></w:pPr><w:rPr><w:b/><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>' +
    `<w:style w:type="character" w:customStyle="1" w:styleId="CodeChar"><w:name w:val="Kode (tegn)"/><w:rPr>${mono}<w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:rPr></w:style>` +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="404040"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '</w:styles>'
  );
})();

const CONTENT_TYPES =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const PACKAGE_RELS =
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

const coreProps = (title: string) =>
  `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:title>${esc(title)}</dc:title></cp:coreProperties>`;

export function buildDocx(blocks: Block[], options: DocxOptions): Uint8Array {
  const w = new Writer(options.images);
  const document = w.document(blocks);
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: PACKAGE_RELS },
    { name: 'docProps/core.xml', data: coreProps(options.title) },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: w.numbering() },
    { name: 'word/_rels/document.xml.rels', data: w.documentRels() },
    ...w.mediaFiles().map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ]);
}

/** A title for the document's properties: its first heading, or the file name. */
export function documentTitle(blocks: Block[], fallback: string): string {
  const heading = blocks.find((b) => b.t === 'heading');
  return heading?.t === 'heading' ? inlineText(heading.children).trim() || fallback : fallback;
}
