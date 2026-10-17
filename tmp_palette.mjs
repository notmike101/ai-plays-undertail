// tmp_palette.mjs [x0 y0 x1 y1] - inventory the colours in the live frame, so a classify()
// change can be grounded in sampled RGB instead of eyeballed. Prints each quantized colour with
// its count, bounding box and a representative pixel, plus what slam's classify() calls it.
// Pass a crop to confine the census to one object (the pale plateau, a red hedge, a wall band).
import { execFileSync } from 'child_process';
import fs from 'fs';
import { classify } from './src/slam.mjs';

const CW = 646, CHF = 520, CX0 = 2, CY0 = 40, CX1 = 641, CY1 = 517;
const BIN = 'logs/ocr/palette.bin';
execFileSync('node', ['src/play.mjs', 'raw', 'grab', BIN], { stdio: 'pipe' });
const b = fs.readFileSync(BIN);
const [x0, y0, x1, y1] = process.argv.slice(2).length === 4
  ? process.argv.slice(2).map(Number) : [CX0, CY0, CX1, CY1];
const px = (x, y) => { const i = (y * CW + x) * 4; return [b[i + 2], b[i + 1], b[i]]; };
const key = (c) => `${c[0] >> 3},${c[1] >> 3},${c[2] >> 3}`;
const seen = new Map();
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const c = px(x, y), k = key(c);
    let e = seen.get(k);
    if (!e) { e = { n: 0, c, x0: x, y0: y, x1: x, y1: y, sx: x, sy: y }; seen.set(k, e); }
    e.n++;
    if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
    if (y < e.y0) e.y0 = y; if (y > e.y1) e.y1 = y;
    if (e.n === 1) { e.sx = x; e.sy = y; }
  }
}
const rows = [...seen.values()].sort((a, b2) => b2.n - a.n);
const total = (x1 - x0 + 1) * (y1 - y0 + 1);
console.log(`crop ${x0},${y0} - ${x1},${y1} (${total} px), ${rows.length} colour buckets`);
for (const e of rows) {
  if (e.n < total * 0.002) continue;
  console.log(
    `rgb(${e.c.join(',')})  n=${e.n} (${(100 * e.n / total).toFixed(1)}%)  ` +
    `bbox ${e.x0},${e.y0}-${e.x1},${e.y1}  slam=${classify(b, e.sx, e.sy)}`);
}
