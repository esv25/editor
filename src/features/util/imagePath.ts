/**
 * Image paths in Markdown: where `![alt](dest)` points, and how to write a
 * destination for a picked file. Pure text, no I/O (tested in tests/imagePath.test.ts).
 */

export type ImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'unresolved'; reason: string };

export const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];

const mimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

export function imageMime(path: string): string {
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return mimeTypes[ext] ?? 'application/octet-stream';
}

/** The folder part of a file path ("C:\a\b.md" → "C:\a"). */
export function dirOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : undefined;
}

const isWindowsAbsolute = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
const isAbsolute = (p: string) => isWindowsAbsolute(p) || p.startsWith('/');

/** Split a path into its root ("C:", "\\server\share", "/" or "") and segments, resolving "." and "..". */
function splitPath(path: string): { root: string; parts: string[] } {
  let root = '';
  let rest = path;
  const unc = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.exec(path);
  const drive = /^[a-zA-Z]:/.exec(path);
  if (unc) {
    root = unc[0];
    rest = path.slice(unc[0].length);
  } else if (drive) {
    root = drive[0];
    rest = path.slice(2);
  } else if (path.startsWith('/')) {
    root = '/';
  }
  const parts: string[] = [];
  for (const part of rest.split(/[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return { root, parts };
}

function joinPath(base: string, relative: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const { root, parts } = splitPath(`${base}/${relative}`);
  const body = parts.join(sep);
  if (root === '/') return `/${body}`;
  return root ? `${root}${sep}${body}` : body;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Where an image destination points. Relative paths are resolved against the
 * document's folder, so they need a saved document.
 */
export function resolveImageSource(dest: string, baseDir: string | undefined): ImageSource {
  let raw = dest.trim();
  if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);
  if (!raw) return { kind: 'unresolved', reason: 'Bildet mangler sti' };
  if (/^(https?|data|blob):/i.test(raw)) return { kind: 'url', url: raw };
  if (/^file:/i.test(raw)) {
    // file:///C:/a.png → C:/a.png, file:///home/a.png → /home/a.png
    const path = decode(raw.replace(/^file:\/*/i, ''));
    return { kind: 'file', path: isWindowsAbsolute(path) ? path : `/${path}` };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return { kind: 'unresolved', reason: `Kan ikke vise ${raw}` };

  const path = decode(raw);
  if (isAbsolute(path)) return { kind: 'file', path };
  if (!baseDir) return { kind: 'unresolved', reason: 'Lagre dokumentet for å vise bilder med relativ sti' };
  return { kind: 'file', path: joinPath(baseDir, path) };
}

/**
 * How to refer to `target` from a document in `fromDir`: a relative path with
 * forward slashes when they share a drive, else the absolute path.
 */
export function relativeImagePath(fromDir: string | undefined, target: string): string {
  const to = splitPath(target);
  const toText = () => (to.root === '/' ? '/' : to.root ? `${to.root}/` : '') + to.parts.join('/');
  if (!fromDir) return toText();
  const from = splitPath(fromDir);
  if (from.root.toLowerCase() !== to.root.toLowerCase()) return toText();
  let common = 0;
  while (
    common < from.parts.length &&
    common < to.parts.length - 1 &&
    from.parts[common].toLowerCase() === to.parts[common].toLowerCase()
  ) {
    common++;
  }
  const up = from.parts.slice(common).map(() => '..');
  return [...up, ...to.parts.slice(common)].join('/');
}

/** A link destination that survives spaces and parentheses (CommonMark `<…>` form). */
export function markdownDestination(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path}>` : path;
}

/** `![alt](dest)` for a file, with the file name (minus extension) as alt text. */
export function imageMarkdown(dest: string, alt = ''): string {
  const cleanAlt = alt.replace(/[[\]]/g, '');
  return `![${cleanAlt}](${markdownDestination(dest)})`;
}

/** "C:\a\Lenket liste.png" → "Lenket liste". */
export function baseNameOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  // Drawings lose their whole ".diagram.svg".
  return name.replace(/(\.diagram)?\.[^.]+$/i, '');
}
