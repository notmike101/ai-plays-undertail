// tmp: count map classes and locate the biggest blobs of a class (delete when done)
import fs from 'fs';
const GW = 1600, GH = 1000; // slam's real grid; a wrong GW silently shears every bbox below
const g = new Uint8Array(fs.readFileSync('logs/map/room0.bin'));
const N = ['UNKNOWN', 'FLOOR', 'LIGHT', 'WOOD', 'WATER', 'VINE', 'SPIKE', 'BRICK', 'BLOCKED', 'VOID', 'PROVEN', 'OTH'];
const count = new Array(N.length).fill(0);
for (const v of g) count[v]++;
console.log(N.map((n, i) => `${n}=${count[i]}`).join(' '));

// biggest connected blobs per class, with the cell nearest the map centre
const want = process.argv[2] ? N.indexOf(process.argv[2]) : -1;
if (want < 0) process.exit(0);
const seen = new Uint8Array(GW * GH);
const blobs = [];
const q = new Int32Array(400000);
for (let i = 0; i < GW * GH; i++) {
  if (g[i] !== want || seen[i]) continue;
  let head = 0, tail = 0;
  q[tail++] = i; seen[i] = 1;
  let n = 0, minx = GW, maxx = 0, miny = GH, maxy = 0, best = -1, bd = 1e9;
  while (head < tail) {
    const c = q[head++];
    n++;
    const x = c % GW, y = (c - x) / GW;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    const d = Math.abs(x - 800) + Math.abs(y - 500);
    if (d < bd) { bd = d; best = c; }
    for (const nb of [c - 1, c + 1, c - GW, c + GW]) {
      if (nb < 0 || nb >= GW * GH || seen[nb] || g[nb] !== want) continue;
      seen[nb] = 1; q[tail++] = nb;
    }
  }
  blobs.push({ n, bbox: `${minx}..${miny}..${maxx}..${maxy}`, near: `${best % GW},${(best - (best % GW)) / GW}`, world: `${2 * ((best % GW) - 800)},${2 * (((best - (best % GW)) / GW) - 500)}` });
}
blobs.sort((a, b) => b.n - a.n);
for (const b of blobs.slice(0, 6)) console.log(`blob cells=${b.n} bbox=${b.bbox} nearest-me=${b.near} world=${b.world}`);
console.log(`total ${N[want]} blobs: ${blobs.length}`);
