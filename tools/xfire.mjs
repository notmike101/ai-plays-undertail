// Did ANYTHING on screen change, and where? Grabs the frame, runs a play.mjs action, grabs again and
// reports the count of differing pixels plus the bbox they cover. Sign text, a door opening, a water
// level or a flipped switch all show up; eyeballing two frames does not.
// usage: node tools/xfire.mjs [play.mjs args...]
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
const W = 646, H = 520;
const grab = (f) => { execFileSync('node', ['src/play.mjs', 'raw', 'grab', f], { stdio: 'pipe' }); return readFileSync(f); };
const a = grab('logs/xfire-a.bin');
const act = process.argv.slice(2);
if (act.length) execFileSync('node', ['src/play.mjs', ...act], { stdio: 'inherit' });
const b = grab('logs/xfire-b.bin');
let n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = (y * W + x) * 4;
  if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 24) {
    n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
}
console.log(`${act.join(' ') || 'no action'}: ${n} px changed${n ? ` over bbox ${x0},${y0}-${x1},${y1}` : ''}`);
