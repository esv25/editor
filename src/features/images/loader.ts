/**
 * Turns an image source into something an <img> can show. Files on disk are
 * read through the storage layer and cached as blob URLs (per path).
 */
import { exportSvg, isDiagramPath, parseDiagramSvg } from '../../diagram/fileFormat';
import { storage } from '../../storage';
import { imageMime, type ImageSource } from '../util/imagePath';

const cache = new Map<string, Promise<string>>();
/** Natural sizes of loaded images, so re-created widgets reserve their space at once. */
const sizes = new Map<string, { width: number; height: number }>();

/** Windows paths: case and / vs \ don't matter (the drawing window may spell a path differently). */
const pathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase();

export const keyOf = (source: ImageSource): string =>
  source.kind === 'url' ? source.url : source.kind === 'file' ? pathKey(source.path) : '';

export function imageUrl(source: ImageSource): Promise<string> {
  if (source.kind === 'url') return Promise.resolve(source.url);
  if (source.kind === 'unresolved') return Promise.reject(new Error(source.reason));
  const key = keyOf(source);
  let url = cache.get(key);
  if (!url) {
    const read = storage.readBinary;
    if (!read) return Promise.reject(new Error('Bilder fra disk vises bare i skrivebordsappen'));
    const path = source.path;
    url = read(path).then(
      (bytes) => URL.createObjectURL(new Blob([redrawn(path, bytes) ?? (bytes as Uint8Array<ArrayBuffer>)], { type: imageMime(path) })),
      () => {
        throw new Error('Fant ikke bildet');
      },
    );
    url.catch(() => cache.delete(key));
    cache.set(key, url);
  }
  return url;
}

/**
 * A drawing drawn again from the data in it, so pictures saved by an older
 * version look like the drawing window shows them now (larger text …).
 * Null for other images and SVGs that aren't ours.
 */
function redrawn(path: string, bytes: Uint8Array): string | null {
  if (!isDiagramPath(path)) return null;
  const diagram = parseDiagramSvg(new TextDecoder().decode(bytes));
  return diagram ? exportSvg(diagram) : null;
}

export function knownSize(key: string) {
  return sizes.get(key);
}

export function rememberSize(key: string, width: number, height: number): void {
  sizes.set(key, { width, height });
}

/** Drop cached files (all, or the given paths) so they're read again. */
export function forgetImages(paths?: string[]): void {
  const keys = paths ? paths.map(pathKey) : [...cache.keys()];
  for (const key of keys) {
    void cache.get(key)?.then(URL.revokeObjectURL, () => {});
    cache.delete(key);
    sizes.delete(key);
  }
}
