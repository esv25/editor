/**
 * Images: `![alt](sti)` is shown as the picture below its line. Like code
 * blocks, the Markdown itself is never shown as text: a small header always
 * replaces it, with the caption (alt text; click to edit), «Bytt bilde» and
 * «Fjern». The cursor steps over the header as one unit. Relative paths
 * resolve against the document's folder.
 */
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { getSettings, updateSettings } from '../../settings';
import { storage } from '../../storage';
import type { Feature } from '../types';
import { editInPlace } from '../util/editInPlace';
import {
  baseNameOf,
  imageExtensions,
  imageMarkdown,
  isHostAllowed,
  relativeImagePath,
  remoteHost,
  resolveImageSource,
} from '../util/imagePath';
import { DIAGRAM_EXTENSION, isDiagramPath, newDiagramSvg } from '../../diagram/fileFormat';
import { insertOnOwnLine, readImage, removeImage, setImageAlt, setImageDest, type ImageRef } from './commands';
import { forgetImages, imageUrl, keyOf, knownSize, rememberSize } from './loader';

/** Set by the app. */
export const imageContext = {
  /** The folder relative image paths resolve against (the active document's). */
  baseDir: (): string | undefined => undefined,
  /** Open a drawing (a .diagram.svg file, or a new blank one) in the drawing window. */
  openDrawing: null as ((path?: string) => void) | null,
};

/** The file behind a drawing's image link, if it is one we can open. */
function drawingPath(dest: string): string | null {
  const source = resolveImageSource(dest, imageContext.baseDir());
  return source.kind === 'file' && isDiagramPath(source.path) && imageContext.openDrawing ? source.path : null;
}

const redraw = StateEffect.define<null>();

/** Resolve and draw all images again, e.g. after the document moved to another folder. */
export function redrawImages(view: EditorView): void {
  view.dispatch({ effects: redraw.of(null) });
}

/** Read the given image files again (they changed on disk) and redraw. */
export function reloadImages(view: EditorView, paths: string[]): void {
  forgetImages(paths);
  redrawImages(view);
}

/** Inline images (`![alt](dest)`); reference-style images are skipped. */
function eachImage(state: EditorState, f: (image: ImageRef) => void): void {
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') return false;
      if (node.name !== 'Image') return;
      const image = readImage(state, node.node);
      if (image) f(image);
      return false;
    },
  });
}

/** Ask for an image file; its path as written from the current document. */
async function pickImage(title: string): Promise<{ dest: string; name: string } | null> {
  const path = await storage.pickFile?.({ title, filters: [{ name: 'Bilder', extensions: imageExtensions }] });
  return path ? { dest: relativeImagePath(imageContext.baseDir(), path), name: baseNameOf(path) } : null;
}

// --- The header (replaces the Markdown) ------------------------------------

class ImageHeaderWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly dest: string,
  ) {
    super();
  }

  eq(other: ImageHeaderWidget) {
    return other.alt === this.alt && other.dest === this.dest;
  }

  toDOM(view: EditorView) {
    const root = document.createElement('span');
    root.className = 'cm-image-header';
    const pos = () => view.posAtDOM(root);

    // Caption: the alt text, or the file name as a placeholder. Edited in place.
    const caption = document.createElement('span');
    caption.className = `cm-image-caption${this.alt ? '' : ' placeholder'}`;
    caption.textContent = this.alt || baseNameOf(this.dest.replace(/^<|>$/g, ''));
    caption.title = 'Klikk for å skrive bildetekst';
    caption.addEventListener('mousedown', (e) => {
      e.preventDefault();
      editInPlace(caption, {
        value: this.alt,
        placeholder: 'Bildetekst',
        className: 'cm-image-caption-input',
        onSave: (value) => setImageAlt(pos(), value)(view),
        onDone: () => view.focus(),
      });
    });
    root.append(caption);

    const button = (label: string, title: string, onClick: () => void) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.title = title;
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', onClick);
      root.append(el);
    };
    const drawing = drawingPath(this.dest);
    if (drawing) {
      button('Rediger tegning', 'Åpne tegningen i tegnevinduet (eller dobbeltklikk på den)', () => imageContext.openDrawing?.(drawing));
    } else if (storage.pickFile) {
      button('Bytt bilde', 'Velg en annen bildefil', async () => {
        const picked = await pickImage('Bytt bilde');
        if (picked) setImageDest(pos(), picked.dest)(view);
        view.focus();
      });
    }
    button('Fjern', 'Fjern bildet fra notatet (filen slettes ikke)', () => {
      removeImage(pos())(view);
      view.focus();
    });
    return root;
  }

  ignoreEvent() {
    return true;
  }
}

// --- The pictures (block widgets below the line) ---------------------------

function notice(message: string, dest?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-image-notice';
  el.textContent = message;
  if (dest) {
    const path = document.createElement('span');
    path.className = 'cm-image-notice-path';
    path.textContent = dest;
    el.append(path);
  }
  return el;
}

/** Web images the user chose to see this time (until the app restarts). */
const shownRemote = new Set<string>();

/**
 * In place of a web image: fetching it would tell the host that (and when)
 * the document was opened, so it waits for the user.
 */
function remoteNotice(view: EditorView, host: string, url: string): HTMLElement {
  const el = notice(`Bildet ligger på ${host}. Henter du det, kan nettstedet se at du åpnet dokumentet.`, url);
  el.classList.add('cm-image-remote');
  const actions = document.createElement('span');
  actions.className = 'cm-image-remote-actions';
  const button = (label: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      onClick();
      redrawImages(view);
    });
    actions.append(b);
  };
  button('Vis bildet', 'Hent dette bildet nå', () => shownRemote.add(url));
  button(`Alltid fra ${host}`, `Vis bilder fra ${host} uten å spørre`, () => {
    const hosts = getSettings().security.imageHosts;
    updateSettings({ security: { imageHosts: [...hosts, host] } });
  });
  el.append(actions);
  return el;
}

function renderImage(view: EditorView, dest: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'cm-image';
  const source = resolveImageSource(dest, imageContext.baseDir());
  const fail = (message: string) => {
    box.replaceChildren(notice(message, dest));
    view.requestMeasure();
  };
  if (source.kind === 'unresolved') {
    box.append(notice(source.reason));
    return box;
  }
  const host = remoteHost(source);
  if (host && !shownRemote.has(keyOf(source)) && !isHostAllowed(host, getSettings().security.imageHosts)) {
    box.append(remoteNotice(view, host, keyOf(source)));
    return box;
  }
  const img = document.createElement('img');
  img.draggable = false;
  // Don't tell the image's host which page asked for it.
  if (host) img.referrerPolicy = 'no-referrer';
  img.title = dest;
  const key = keyOf(source);
  // Reserve the space at once when we've seen the picture before (no jumping).
  const size = knownSize(key);
  if (size) {
    img.width = size.width;
    img.height = size.height;
  }
  img.addEventListener('load', () => {
    rememberSize(key, img.naturalWidth, img.naturalHeight);
    view.requestMeasure();
  });
  img.addEventListener('error', () => fail('Kunne ikke vise bildet'));
  const drawing = drawingPath(dest);
  if (drawing) {
    // Drawings may be wider than the text column (see `drawingRoom`): the frame centres them.
    box.classList.add('cm-image-drawing');
    const frame = document.createElement('div');
    frame.className = 'cm-drawing-frame';
    frame.append(img);
    box.append(frame);
    img.title = 'Dobbeltklikk for å redigere tegningen';
    img.addEventListener('dblclick', () => imageContext.openDrawing?.(drawing));
  } else {
    box.append(img);
  }
  imageUrl(source).then(
    (url) => (img.src = url),
    (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
  );
  return box;
}

class ImageBlockWidget extends WidgetType {
  constructor(
    readonly dests: string[],
    readonly generation: number,
  ) {
    super();
  }

  eq(other: ImageBlockWidget) {
    return (
      other.generation === this.generation &&
      other.dests.length === this.dests.length &&
      other.dests.every((d, i) => d === this.dests[i])
    );
  }

  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'cm-image-block';
    for (const dest of this.dests) root.append(renderImage(view, dest));
    return root;
  }

  ignoreEvent() {
    return true;
  }
}

// --- Decorations -----------------------------------------------------------

interface ImageDecorations {
  /** Headers and pictures. */
  all: DecorationSet;
  /** Just the headers (the cursor steps over them as a unit). */
  headers: DecorationSet;
  generation: number;
}

function build(state: EditorState, generation: number, headers: boolean): ImageDecorations {
  const { doc } = state;
  const headerDecos: Range<Decoration>[] = [];
  const lines = new Map<number, string[]>();
  eachImage(state, (image) => {
    if (headers) {
      const alt = doc.sliceString(image.altFrom, image.altTo).trim();
      headerDecos.push(Decoration.replace({ widget: new ImageHeaderWidget(alt, image.dest) }).range(image.from, image.to));
    }
    const end = doc.lineAt(image.to).to;
    const dests = lines.get(end) ?? [];
    dests.push(image.dest);
    lines.set(end, dests);
  });
  const blocks = [...lines].map(([pos, dests]) =>
    Decoration.widget({ widget: new ImageBlockWidget(dests, generation), block: true, side: 1 }).range(pos),
  );
  return {
    all: Decoration.set([...headerDecos, ...blocks], true),
    headers: Decoration.set(headerDecos, true),
    generation,
  };
}

// Block widgets (and replacements that may span lines) must come from a state field.
function imageField(headers: boolean) {
  return StateField.define<ImageDecorations>({
    create: (state) => build(state, 0, headers),
    update(value, tr) {
      const again = tr.effects.some((e) => e.is(redraw));
      if (!again && !tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) return value;
      return build(tr.state, value.generation + (again ? 1 : 0), headers);
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.all),
      EditorView.atomicRanges.of((view) => view.state.field(field).headers),
    ],
  });
}

/**
 * Drawings are often wide, and squeezed into the text column their text gets
 * tiny. They may use the editor's whole width instead: `--drawing-room` is
 * the width inside the content's side padding.
 */
const drawingRoom = ViewPlugin.fromClass(
  class {
    observer: ResizeObserver;
    constructor(view: EditorView) {
      // Reports the size at once and after every change (window, side panel …).
      this.observer = new ResizeObserver(() => {
        const style = getComputedStyle(view.contentDOM);
        const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        view.scrollDOM.style.setProperty('--drawing-room', `${Math.max(0, view.scrollDOM.clientWidth - pad)}px`);
      });
      this.observer.observe(view.scrollDOM);
    }
    destroy() {
      this.observer.disconnect();
    }
  },
);

// One instance each, so reconfiguring (settings changes) keeps the drawn pictures.
const withHeaders = imageField(true);
const withMarkup = imageField(false);

// --- Inserting -------------------------------------------------------------

/** Pick an image file and link it on its own line (path relative to the document). */
async function pickAndInsert(view: EditorView): Promise<void> {
  if (!storage.pickFile) {
    // No file dialog (browser): an empty image link with the cursor in the path.
    insertOnOwnLine('![]()', 4)(view);
    return;
  }
  const picked = await pickImage('Sett inn bilde');
  if (!picked) return;
  insertOnOwnLine(imageMarkdown(picked.dest, picked.name))(view);
  view.focus();
}

/**
 * New drawing: an empty .diagram.svg in a "figurer" folder next to the note,
 * linked on its own line and opened in the drawing window. In the browser
 * (no files by path) it just opens a blank drawing window.
 */
async function newDrawing(view: EditorView): Promise<void> {
  const open = imageContext.openDrawing;
  if (!open) return;
  if (!storage.createNew) {
    open();
    return;
  }
  const base = imageContext.baseDir();
  const folder = base ? `${base}${base.includes('\\') ? '\\' : '/'}figurer` : undefined;
  const file = await storage.createNew(newDiagramSvg(), 'tegning', DIAGRAM_EXTENSION, folder);
  if (!file.path) return;
  insertOnOwnLine(imageMarkdown(relativeImagePath(base, file.path)))(view);
  open(file.path);
}

const drawingIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="6" rx="1"/><circle cx="17" cy="17" r="4"/><path d="M7 9v4a4 4 0 0 0 4 4h2"/></svg>';

const imageIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/></svg>';

export const images: Feature = {
  id: 'images',
  extension: (settings) => [settings.hideMarkup ? withHeaders : withMarkup, drawingRoom],
  commands: [
    {
      id: 'image.insert',
      name: 'Sett inn bilde',
      icon: imageIcon,
      run: (view) => (void pickAndInsert(view), true),
    },
    {
      id: 'diagram.new',
      name: 'Ny tegning',
      icon: drawingIcon,
      run: (view) => (void newDrawing(view), true),
    },
  ],
};
