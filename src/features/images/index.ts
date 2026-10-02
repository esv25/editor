/**
 * Images: `![alt](sti)` is shown as the picture below its line. Like code
 * blocks, the Markdown itself is never shown as text: a small header always
 * replaces it, with the caption (alt text; click to edit), «Bytt bilde» and
 * «Fjern». The cursor steps over the header as one unit. Relative paths
 * resolve against the document's folder.
 */
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { storage } from '../../storage';
import type { Feature } from '../types';
import { editInPlace } from '../util/editInPlace';
import {
  baseNameOf,
  imageExtensions,
  imageMarkdown,
  relativeImagePath,
  resolveImageSource,
} from '../util/imagePath';
import { insertOnOwnLine, readImage, removeImage, setImageAlt, setImageDest, type ImageRef } from './commands';
import { forgetImages, imageUrl, keyOf, knownSize, rememberSize } from './loader';

/** The folder relative image paths resolve against (the active document's). Set by the app. */
export const imageContext = {
  baseDir: (): string | undefined => undefined,
};

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
    if (storage.pickFile) {
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
  const img = document.createElement('img');
  img.draggable = false;
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
  box.append(img);
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

const imageIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/></svg>';

export const images: Feature = {
  id: 'images',
  extension: (settings) => (settings.hideMarkup ? withHeaders : withMarkup),
  commands: [
    {
      id: 'image.insert',
      name: 'Sett inn bilde',
      icon: imageIcon,
      run: (view) => (void pickAndInsert(view), true),
    },
  ],
};
