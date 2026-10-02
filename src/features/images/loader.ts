/**
 * Turns an image source into something an <img> can show. Files on disk are
 * read through the storage layer and cached as blob URLs (per path).
 */
import { storage } from '../../storage';
import { imageMime, type ImageSource } from '../util/imagePath';

const cache = new Map<string, Promise<string>>();
/** Natural sizes of loaded images, so re-created widgets reserve their space at once. */
const sizes = new Map<string, { width: number; height: number }>();

export const keyOf = (source: ImageSource): string =>
  source.kind === 'url' ? source.url : source.kind === 'file' ? source.path.toLowerCase() : '';

export function imageUrl(source: ImageSource): Promise<string> {
  if (source.kind === 'url') return Promise.resolve(source.url);
  if (source.kind === 'unresolved') return Promise.reject(new Error(source.reason));
  const key = keyOf(source);
  let url = cache.get(key);
  if (!url) {
    const read = storage.readBinary;
    if (!read) return Promise.reject(new Error('Bilder fra disk vises bare i skrivebordsappen'));
    url = read(source.path).then(
      (bytes) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: imageMime(source.path) })),
      () => {
        throw new Error('Fant ikke bildet');
      },
    );
    url.catch(() => cache.delete(key));
    cache.set(key, url);
  }
  return url;
}

export function knownSize(key: string) {
  return sizes.get(key);
}

export function rememberSize(key: string, width: number, height: number): void {
  sizes.set(key, { width, height });
}

/** Drop cached files (all, or the given paths) so they're read again. */
export function forgetImages(paths?: string[]): void {
  const keys = paths ? paths.map((p) => p.toLowerCase()) : [...cache.keys()];
  for (const key of keys) {
    void cache.get(key)?.then(URL.revokeObjectURL, () => {});
    cache.delete(key);
    sizes.delete(key);
  }
}
