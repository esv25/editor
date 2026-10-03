/**
 * Trusted folders as plain data (no platform; tested in tests/trust.test.ts).
 * Paths are compared like Windows does: case-insensitive, / and \ alike.
 */

/** The folder a file lies in. */
export const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '');

/** Lower case, / only, no trailing slash, and "." / ".." resolved (so C:\Trygg\..\x isn't in C:\Trygg). */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (part === '.' || (part === '' && parts.length > 0)) continue;
    if (part === '..') {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

/** Whether the file `path` lies in one of `folders` (or a folder below one). */
export function isInFolders(path: string, folders: string[]): boolean {
  const file = normalize(path);
  return folders.some((folder) => {
    const dir = normalize(folder);
    return dir !== '' && file.startsWith(`${dir}/`);
  });
}

/** `folders` with `folder` added, unless it (or a folder above it) is there already. */
export function withFolder(folders: string[], folder: string): string[] {
  return isInFolders(`${folder}/x`, folders) ? folders : [...folders, folder];
}
