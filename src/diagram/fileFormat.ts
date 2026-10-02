/**
 * The file format: a normal SVG picture (shows up in notes, browsers, GitHub,
 * Word) with the editable drawing stored as JSON in its <metadata>. Files end
 * in `.diagram.svg`. Shared with the editor, which creates new drawings.
 */
import { bounds, emptyDiagram, normalizeDiagram, type Diagram } from './model';
import { renderDiagram } from './render';
import { drawingStyle } from './shapes/common';
import { h, toSvgString } from './svg';

export const DIAGRAM_EXTENSION = 'diagram.svg';

export const isDiagramPath = (path: string) => /\.diagram\.svg$/i.test(path);

const MARGIN = 20;

export function exportSvg(d: Diagram): string {
  const box = bounds(d);
  const view = box
    ? { x: box.x - MARGIN, y: box.y - MARGIN, w: box.w + 2 * MARGIN, h: box.h + 2 * MARGIN }
    : { x: 0, y: 0, w: 320, h: 120 };
  const content = box
    ? renderDiagram(d)
    : [
        h(
          'text',
          { x: 160, y: 60, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': drawingStyle.font, 'font-size': 15, fill: '#aaa59c' },
          [],
          'Tom tegning',
        ),
      ];
  const svg = h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: view.w,
      height: view.h,
      viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    },
    [h('rect', { x: view.x, y: view.y, width: view.w, height: view.h, fill: drawingStyle.paper }), ...content],
  );
  // The metadata goes in by hand: JSON as XML text (only &, < and > need escaping).
  const text = toSvgString(svg);
  const json = JSON.stringify(d).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const metadata = `  <metadata id="editor-diagram">${json}</metadata>`;
  return text.replace(/^(<svg[^>]*>)\n/, `$1\n${metadata}\n`) + '\n';
}

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * The drawing stored in a file. Null if it isn't one of ours (a plain SVG):
 * those must never be overwritten by the drawing tool.
 */
export function parseDiagramSvg(text: string): Diagram | null {
  const m = /<metadata id="editor-diagram">([\s\S]*?)<\/metadata>/.exec(text);
  if (!m) return null;
  try {
    return normalizeDiagram(JSON.parse(unescapeXml(m[1])));
  } catch {
    return null;
  }
}

export const newDiagramSvg = () => exportSvg(emptyDiagram());
