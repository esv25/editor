/**
 * "Lagre som PDF", "Åpne i Word" and "Skriv ut": the parts that need the DOM,
 * files and the platform. The conversions themselves are pure (document.ts,
 * html.ts, docx.ts, omml.ts).
 *
 * PDF and printing show the document on this page: a hidden #print-root that
 * `@media print` (styles.css) shows instead of the app. The desktop app
 * prints it straight to a file (WebView2, src-tauri/src/pdf.rs); the browser
 * opens its print dialog, where "Lagre som PDF" is one of the printers.
 */
import type { EditorDocument } from '../app/document';
import { imageUrl } from '../features/images/loader';
import { dirOf, isHostAllowed, remoteHost, resolveImageSource } from '../features/util/imagePath';
import { platform } from '../platform';
import { getSettings } from '../settings';
import { storage } from '../storage';
import { imageSources, parseDocument, type Block } from './document';
import { buildDocx, documentTitle, type DocxImage } from './docx';
import { blocks as toHtml, type ImageUrls } from './html';

export interface ExportHost {
  /** Errors go to the status bar. */
  showError(message: string): void;
  /** A file was saved (shown in a bubble under the export button, as Chrome does with downloads). */
  saved(path: string): void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The document as blocks; a code file is one code block. */
function blocksOf(doc: EditorDocument): Block[] {
  const text = doc.state.doc.toString();
  if (doc.kind === 'code') return [{ t: 'code', lang: doc.lang, title: doc.name, text }];
  return parseDocument(text);
}

const baseName = (doc: EditorDocument) => doc.name.replace(/\.[^.]+$/, '') || 'Dokument';

async function defaultPath(doc: EditorDocument, extension: string): Promise<string> {
  const dir = dirOf(doc.file?.path) ?? (await storage.defaultFolder?.());
  const name = `${baseName(doc)}.${extension}`;
  return dir ? `${dir}\\${name}` : name;
}

/** Images the export may show: files, data: URLs, and web images only from allowed sites. */
async function imageUrls(doc: EditorDocument, sources: string[]): Promise<ImageUrls> {
  const urls: ImageUrls = new Map();
  const baseDir = dirOf(doc.file?.path);
  await Promise.all(
    sources.map(async (src) => {
      const source = resolveImageSource(src, baseDir);
      const host = remoteHost(source);
      if (host && !isHostAllowed(host, getSettings().security.imageHosts)) return;
      try {
        urls.set(src, await imageUrl(source));
      } catch {
        // Missing image: the export shows its alt text.
      }
    }),
  );
  return urls;
}

// --- PDF and printing -------------------------------------------------------------------

/**
 * Put the document on the page while `print` runs. The HTML is built by
 * html.ts, which escapes all document text; the only markup in it is ours
 * and KaTeX's (as everywhere formulas are shown).
 */
async function onPrintPage<T>(doc: EditorDocument, print: () => Promise<T>): Promise<T> {
  const blocks = blocksOf(doc);
  const images = await imageUrls(doc, imageSources(blocks));
  document.getElementById('print-root')?.remove();
  const root = document.createElement('article');
  root.id = 'print-root';
  root.innerHTML = toHtml(blocks, images);
  document.body.append(root);
  document.body.classList.add('printing');
  try {
    await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    await document.fonts.ready;
    return await print();
  } finally {
    root.remove();
    document.body.classList.remove('printing');
  }
}

/** The browser's print dialog; resolves when it closes. */
function printDialog(): Promise<void> {
  const closed = new Promise<void>((resolve) => window.addEventListener('afterprint', () => resolve(), { once: true }));
  window.print();
  return closed;
}

export async function exportPdf(doc: EditorDocument, host: ExportHost): Promise<void> {
  if (!platform.printToPdf || !storage.pickSavePath) {
    // Browser: the print dialog can save as PDF.
    await onPrintPage(doc, printDialog);
    return;
  }
  const path = await storage.pickSavePath({
    title: 'Lagre som PDF',
    defaultPath: await defaultPath(doc, 'pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!path) return;
  try {
    await onPrintPage(doc, () => platform.printToPdf!(path));
  } catch (err) {
    host.showError(`Kunne ikke lage PDF: ${errorText(err)}`);
    return;
  }
  host.saved(path);
}

export async function printDocument(doc: EditorDocument): Promise<void> {
  await onPrintPage(doc, printDialog);
}

// --- Word ---------------------------------------------------------------------------------

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

function toPng(img: HTMLImageElement, scale: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  const s = Math.min(scale, 4000 / Math.max(img.naturalWidth, img.naturalHeight, 1));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * s));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * s));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error('Kunne ikke lage bilde'))), 'image/png'),
  );
}

const WORD_TYPES: Record<string, DocxImage['type']> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif' };

/** Images as Word can hold them: PNG, JPEG and GIF as they are, everything else (SVG drawings …) as PNG. */
async function docxImages(doc: EditorDocument, sources: string[]): Promise<Map<string, DocxImage>> {
  const urls = await imageUrls(doc, sources);
  const out = new Map<string, DocxImage>();
  const baseDir = dirOf(doc.file?.path);
  await Promise.all(
    [...urls].map(async ([src, url]) => {
      try {
        const img = await loadImage(url);
        const width = img.naturalWidth || 600;
        const height = img.naturalHeight || 400;
        const source = resolveImageSource(src, baseDir);
        const ext = source.kind === 'file' ? /\.([^.\\/]+)$/.exec(source.path)?.[1]?.toLowerCase() ?? '' : '';
        const type = WORD_TYPES[ext];
        if (type && source.kind === 'file' && storage.readBinary) {
          out.set(src, { data: await storage.readBinary(source.path), type, width, height });
        } else {
          // Vector drawings get twice the pixels so they stay sharp when printed.
          out.set(src, { data: await toPng(img, ext === 'svg' ? 2 : 1), type: 'png', width, height });
        }
      } catch {
        // Web images from other sites can't be copied (the canvas is tainted): alt text instead.
      }
    }),
  );
  return out;
}

export async function openInWord(doc: EditorDocument, host: ExportHost): Promise<void> {
  const blocks = blocksOf(doc);
  const build = async () =>
    buildDocx(blocks, { title: documentTitle(blocks, baseName(doc)), images: await docxImages(doc, imageSources(blocks)) });

  if (!storage.pickSavePath || !storage.writeBinary) {
    // Browser: download the file; it opens in Word from the downloads.
    const data = await build();
    const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName(doc)}.docx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const path = await storage.pickSavePath({
    title: 'Lagre som Word-dokument',
    defaultPath: await defaultPath(doc, 'docx'),
    filters: [{ name: 'Word-dokument', extensions: ['docx'] }],
  });
  if (!path) return;
  try {
    await storage.writeBinary(path, await build());
  } catch (err) {
    host.showError(`Kunne ikke lagre Word-fila (er den åpen i Word?): ${errorText(err)}`);
    return;
  }
  host.saved(path);
  try {
    await platform.openPath?.(path);
  } catch (err) {
    host.showError(`Fila er lagret, men kunne ikke åpnes i Word: ${errorText(err)}`);
  }
}
