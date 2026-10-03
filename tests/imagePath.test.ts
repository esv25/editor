import { describe, expect, it } from 'vitest';
import { imageAt, insertOnOwnLine, removeImage, setImageAlt, setImageDest } from '../src/features/images/commands';
import {
  baseNameOf,
  dirOf,
  imageMarkdown,
  imageMime,
  isHostAllowed,
  relativeImagePath,
  remoteHost,
  resolveImageSource,
} from '../src/features/util/imagePath';
import { run, stateOf } from './helpers';

describe('resolveImageSource', () => {
  const base = 'C:\\Users\\Eirik\\Notater';

  it('resolves relative paths against the document folder', () => {
    expect(resolveImageSource('figurer/liste.svg', base)).toEqual({ kind: 'file', path: 'C:\\Users\\Eirik\\Notater\\figurer\\liste.svg' });
    expect(resolveImageSource('./bilde.png', base)).toEqual({ kind: 'file', path: 'C:\\Users\\Eirik\\Notater\\bilde.png' });
    expect(resolveImageSource('../Bilder/a.png', base)).toEqual({ kind: 'file', path: 'C:\\Users\\Eirik\\Bilder\\a.png' });
  });

  it('handles <…> destinations and percent-encoding', () => {
    expect(resolveImageSource('<mine bilder/a b.png>', base)).toEqual({ kind: 'file', path: 'C:\\Users\\Eirik\\Notater\\mine bilder\\a b.png' });
    expect(resolveImageSource('a%20b.png', base)).toEqual({ kind: 'file', path: 'C:\\Users\\Eirik\\Notater\\a b.png' });
  });

  it('keeps absolute paths and URLs', () => {
    expect(resolveImageSource('D:/bilder/x.png', base)).toEqual({ kind: 'file', path: 'D:/bilder/x.png' });
    expect(resolveImageSource('file:///C:/x/y.png', base)).toEqual({ kind: 'file', path: 'C:/x/y.png' });
    expect(resolveImageSource('https://example.com/a.png', base)).toEqual({ kind: 'url', url: 'https://example.com/a.png' });
  });

  it('needs a saved document for relative paths', () => {
    expect(resolveImageSource('a.png', undefined).kind).toBe('unresolved');
    expect(resolveImageSource('', base).kind).toBe('unresolved');
    expect(resolveImageSource('mailto:x@y.no', base).kind).toBe('unresolved');
  });
});

describe('relativeImagePath', () => {
  it('is relative with forward slashes on the same drive', () => {
    expect(relativeImagePath('C:\\Notater', 'C:\\Notater\\figurer\\a.svg')).toBe('figurer/a.svg');
    expect(relativeImagePath('C:\\Notater\\fag', 'C:\\Notater\\Bilder\\a.png')).toBe('../Bilder/a.png');
    expect(relativeImagePath('c:\\notater', 'C:\\Notater\\a.png')).toBe('a.png');
  });

  it('is absolute across drives or without a folder', () => {
    expect(relativeImagePath('C:\\Notater', 'D:\\Bilder\\a.png')).toBe('D:/Bilder/a.png');
    expect(relativeImagePath(undefined, 'C:\\Bilder\\a.png')).toBe('C:/Bilder/a.png');
  });
});

describe('image helpers', () => {
  it('writes valid Markdown for any path', () => {
    expect(imageMarkdown('figurer/a.svg', 'Lenket liste')).toBe('![Lenket liste](figurer/a.svg)');
    expect(imageMarkdown('mine bilder/a (2).png', 'a (2)')).toBe('![a (2)](<mine bilder/a (2).png>)');
    expect(imageMarkdown('a.png', 'x [1]')).toBe('![x 1](a.png)');
  });

  it('knows names, folders and types', () => {
    expect(baseNameOf('C:\\a\\Lenket liste.png')).toBe('Lenket liste');
    expect(baseNameOf('figurer/tegning (2).diagram.svg')).toBe('tegning (2)');
    expect(dirOf('C:\\a\\b.md')).toBe('C:\\a');
    expect(dirOf(undefined)).toBeUndefined();
    expect(imageMime('a.SVG')).toBe('image/svg+xml');
  });
});

describe('insertOnOwnLine', () => {
  it('uses an empty line', () => {
    expect(run(insertOnOwnLine('![a](a.png)'), 'Tekst\n|\nMer')).toBe('Tekst\n![a](a.png)|\nMer');
  });

  it('adds a line after a non-empty one', () => {
    expect(run(insertOnOwnLine('![a](a.png)'), 'Te|kst\nMer')).toBe('Tekst\n![a](a.png)|\nMer');
  });

  it('can leave the cursor inside the link', () => {
    expect(run(insertOnOwnLine('![]()', 4), '|')).toBe('![](|)');
  });
});

describe('image edits', () => {
  const text = 'Tekst\n|![Ikon](bilder/ikon.png)\nMer';
  const pos = text.indexOf('!') - 1; // the "|" marker is removed by run()

  it('finds the image starting at a position', () => {
    expect(imageAt(stateOf('![a](b.png)'), 0)?.dest).toBe('b.png');
    expect(imageAt(stateOf('![a](b.png)'), 1)).toBeNull();
    expect(imageAt(stateOf('[a](b.png)'), 0)).toBeNull();
  });

  it('changes the caption', () => {
    expect(run(setImageAlt(pos, 'Lenket liste'), text)).toBe('Tekst\n|![Lenket liste](bilder/ikon.png)\nMer');
    expect(run(setImageAlt(pos, 'a [b]\nc'), text)).toBe('Tekst\n|![a b c](bilder/ikon.png)\nMer');
  });

  it('changes the file', () => {
    expect(run(setImageDest(pos, 'mine bilder/x.png'), text)).toBe('Tekst\n|![Ikon](<mine bilder/x.png>)\nMer');
  });

  it('removes the image with its line', () => {
    expect(run(removeImage(pos), text)).toBe('Tekst\n|Mer');
    expect(run(removeImage(6), 'Tekst\n![a](b.png)|')).toBe('Tekst|');
  });

  it('keeps the rest of a line', () => {
    expect(run(removeImage(3), 'Se |![a](b.png) her')).toBe('Se | her');
  });
});

describe('web images', () => {
  const host = (dest: string) => remoteHost(resolveImageSource(dest, 'C:/notes'));

  it('names the host of http(s) images', () => {
    expect(host('https://Example.com/a.png')).toBe('example.com');
    expect(host('http://cdn.example.com:8080/a.png?x=1')).toBe('cdn.example.com');
  });

  it('treats files, data: and blob: as local', () => {
    expect(host('bilde.png')).toBeNull();
    expect(host('data:image/png;base64,AAAA')).toBeNull();
    expect(host('blob:http://tauri.localhost/1234')).toBeNull();
  });

  it('allows a listed host and its subdomains, nothing else', () => {
    const hosts = ['example.com'];
    expect(isHostAllowed('example.com', hosts)).toBe(true);
    expect(isHostAllowed('cdn.example.com', hosts)).toBe(true);
    expect(isHostAllowed('badexample.com', hosts)).toBe(false);
    expect(isHostAllowed('example.com.evil.net', hosts)).toBe(false);
    expect(isHostAllowed('example.com', [''])).toBe(false);
  });
});
