// tmp_crop.mjs <out.png> <x0> <y0> <x1> <y1> [scale] [raw.bin]
// Zoom a window of the live frame (or of a saved raw grab) so small sprites, decals and sign
// glyphs are actually legible in a screenshot read. Nearest-neighbour upscale, no interpretation.
// Frame geometry matches slam.mjs: 646x520 raw, 4 bytes per pixel in B,G,R,A order.
import { execFileSync } from 'child_process';
import fs from 'fs';
import zlib from 'zlib';

const CW = 646, CHF = 520;
const [out, x0s, y0s, x1s, y1s, sc, src] = process.argv.slice(2);
const [x0, y0, x1, y1] = [x0s, y0s, x1s, y1s].map(Number);
const S = Number(sc || Math.max(1, Math.floor(900 / Math.max(x1 - x0, y1 - y0))));
let b;
if (src) {
  b = fs.readFileSync(src);
} else {
  const tmp = 'logs/ocr/crop.bin';
  for (let k = 0; k < 4; k++) {
    execFileSync('node', ['src/play.mjs', 'raw', 'grab', tmp], { stdio: 'pipe' });
    b = fs.readFileSync(tmp);
    const seen = new Set();
    for (let yy = 0; yy < CHF; yy += 3) {
      let hsh = 0;
      for (let xx = 0; xx < CW; xx += 7) hsh = (hsh * 31 + b[(yy * CW + xx) * 4] + 3 * b[(yy * CW + xx) * 4 + 1] + 7 * b[(yy * CW + xx) * 4 + 2]) | 0;
      seen.add(hsh);
    }
    if (seen.size >= 40) break;
  }
}

const w = x1 - x0 + 1, h = y1 - y0 + 1;
const raw = Buffer.alloc(h * S * (w * S * 3 + 1));
for (let y = 0; y < h * S; y++) {
  const row = y * (w * S * 3 + 1);
  raw[row] = 0; // filter: none
  const sy = y0 + Math.floor(y / S);
  for (let x = 0; x < w * S; x++) {
    const sx = x0 + Math.floor(x / S);
    const i = (sy * CW + sx) * 4, o = row + 1 + x * 3;
    raw[o] = b[i + 2]; raw[o + 1] = b[i + 1]; raw[o + 2] = b[i];
  }
}
const crcT = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcv = Buffer.alloc(4); crcv.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, crcv]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w * S, 0); ihdr.writeUInt32BE(h * S, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${out}: crop ${x0},${y0}-${x1},${y1} at ${S}x`);
