// Where am I, relative to the plank? The camera scrolls, so screen position is
// useless on its own; the plank's brown tiles are the landmark.
// CLI: node src/where.mjs [grab-target]   ->  {"me":[x,y],"plank":[x0,y0,x1,y1],"gap":[dx,dy]}
import fs from 'fs';
import { execFileSync } from 'child_process';
import { playerPos } from './walk.mjs';

const sh = (args) => execFileSync('node', ['src/play.mjs', ...args], { stdio: 'pipe' });
const file = process.argv[2] || 'logs/ocr/w.bin';
sh(['raw', 'grab', file]);
const b = fs.readFileSync(file);
const W = 646;
let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1, n = 0;
for (let y = 60; y < 480; y++)
  for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, R = b[p + 2], G = b[p + 1], B = b[p];
    if (R > 100 && R < 205 && G > 50 && G < 130 && B < 100) { n++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
const me = playerPos(file);
const plank = n > 200 ? [minx, miny, maxx, maxy] : null;
const gap = plank && me ? [me.x - (maxx + 1), me.y - Math.round((miny + maxy) / 2)] : null;
console.log(JSON.stringify({ me: me ? [me.x, me.y, me.n] : null, plank, nplank: n, gap }));
