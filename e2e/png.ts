import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes an RGBA image as PNG. Test fixtures are generated so no binary images live in the repo. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A slicer-style preview: an isometric-ish part in the given hue on a transparent background. */
export function partThumbnail(size: number, hue: [number, number, number]): Buffer {
  const c = size / 2;
  return encodePng(size, size, (x, y) => {
    const dx = (x - c) / size;
    const dy = (y - c * 1.05) / size;
    const top = Math.abs(dx) + Math.abs(dy * 2 + 0.18) < 0.3;
    const body = Math.abs(dx) < 0.3 && dy > -0.09 && dy < 0.26 - Math.abs(dx) * 0.5;
    if (!top && !body) return [0, 0, 0, 0];
    const shade = top ? 1.15 : dx < 0 ? 0.8 : 0.6;
    const ring = Math.abs(Math.hypot(dx, dy * 2 + 0.18) - 0.12) < 0.025 && top;
    const [r, g, b] = hue.map((v) => Math.min(255, Math.round(v * (ring ? 0.55 : shade)))) as [number, number, number];
    return [r, g, b, 255];
  });
}
