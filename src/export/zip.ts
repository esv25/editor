/**
 * A minimal zip writer (stored, no compression) – all a .docx needs.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

export function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const files = entries.map((e) => {
    const data = typeof e.data === 'string' ? encoder.encode(e.data) : e.data;
    return { name: encoder.encode(e.name), data, crc: crc32(data) };
  });
  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  // DOS time/date: 1980-01-01 00:00 keeps the output the same for the same input.
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1;
  let pos = 0;
  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // version needed
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 names
    view.setUint16(pos + 8, 0, true); // stored
    view.setUint16(pos + 10, time, true);
    view.setUint16(pos + 12, date, true);
    view.setUint32(pos + 14, f.crc, true);
    view.setUint32(pos + 18, f.data.length, true);
    view.setUint32(pos + 22, f.data.length, true);
    view.setUint16(pos + 26, f.name.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(f.name, pos + 30);
    out.set(f.data, pos + 30 + f.name.length);
    pos += 30 + f.name.length + f.data.length;
  }
  const centralStart = pos;
  files.forEach((f, i) => {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true); // made by
    view.setUint16(pos + 6, 20, true); // needed
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, time, true);
    view.setUint16(pos + 14, date, true);
    view.setUint32(pos + 16, f.crc, true);
    view.setUint32(pos + 20, f.data.length, true);
    view.setUint32(pos + 24, f.data.length, true);
    view.setUint16(pos + 28, f.name.length, true);
    // extra, comment, disk, internal attrs, external attrs: all 0
    view.setUint32(pos + 42, offsets[i], true);
    out.set(f.name, pos + 46);
    pos += 46 + f.name.length;
  });
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 8, files.length, true);
  view.setUint16(pos + 10, files.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  return out;
}
