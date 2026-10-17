// Coverage-seeking walk. Position is tracked in world pixels: my screen shift
// minus the landmark's screen shift (the landmark only moves when the camera
// scrolls). If neither moved but the frame changed enormously, the camera
// scrolled without the landmark being identifiable, so count the step length.
// CLI: node src/explore.mjs [steps] [facing]   e.g. node src/explore.mjs 60 right
import { execFileSync } from 'child_process';
import fs from 'fs';
import { anchorFrom, playerPosFrom } from './walk.mjs';

const sh = (a) => { try { return execFileSync('node', ['src/play.mjs', ...a], { stdio: 'pipe' }); } catch { } };
const steps = Number(process.argv[2] || 40);
let face = process.argv[3] || 'right';
const ORDER = { right: ['right', 'down', 'left', 'up'], down: ['down', 'left', 'up', 'right'], left: ['left', 'up', 'right', 'down'], up: ['up', 'right', 'down', 'left'] };
const DELTA = { right: [36, 0], left: [-36, 0], up: [0, -36], down: [0, 36] };
const BIN = 'logs/ocr/e.bin';

function look() {
  sh(['raw', 'grab', BIN]);
  const buf = fs.readFileSync(BIN);
  const p = playerPosFrom(buf);
  if (!p) return null;
  const a = anchorFrom(buf);
  return { buf, me: [p.x, p.y], pl: a ? [a.plank[0], a.plank[1]] : null };
}
const delta = (A, B) => {
  let dx = B.me[0] - A.me[0], dy = B.me[1] - A.me[1];
  if (A.pl && B.pl) { dx -= B.pl[0] - A.pl[0]; dy -= B.pl[1] - A.pl[1]; }
  return [dx, dy];
};
const changed = (A, B) => {
  let n = 0;
  for (let i = 0; i < A.length; i += 4)
    if (Math.abs(A[i] - B[i]) > 40 || Math.abs(A[i + 1] - B[i + 1]) > 40 || Math.abs(A[i + 2] - B[i + 2]) > 40) n++;
  return n;
};
const key = (p) => Math.round(p[0] / 24) + ',' + Math.round(p[1] / 24);

let pos = null, prev = null;
const seen = new Set();
const dead = new Set(); // (cell,dir) pairs where a hold gained nothing
let stall = 0;
for (let i = 0; i < steps; i++) {
  const A = look();
  if (!A) { console.log(`step ${i}: player not found`); break; }
  pos = prev ? [pos[0] + delta(prev, A)[0], pos[1] + delta(prev, A)[1]] : [0, 0];
  prev = A;
  const here = key(pos);
  seen.add(here);
  const cand = ORDER[face].filter((d) => !dead.has(here + d));
  face = cand.find((d) => !seen.has(key([pos[0] + DELTA[d][0], pos[1] + DELTA[d][1]]))) || cand[0] || ORDER[face][0];
  sh(['hold', face, '140']);
  sh(['wait', '150']);
  const B = look();
  if (!B) continue;
  const [dx, dy] = delta(A, B);
  const scrolled = Math.abs(dx) < 10 && Math.abs(dy) < 10 && changed(A.buf, B.buf) > 12000;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || scrolled) {
    const d = scrolled ? DELTA[face] : [dx, dy];
    pos = [pos[0] + d[0], pos[1] + d[1]];
    prev = B;
    const fresh = !seen.has(key(pos));
    seen.add(key(pos));
    console.log(`step ${i}: ${face} -> ${pos.map(Math.round).join(',')} ${fresh ? '*' : ' '} visited=${seen.size}`);
    stall = 0;
  } else {
    dead.add(here + face);
    console.log(`step ${i}: ${face} blocked at ${here}`);
    if (++stall > 10) { console.log('giving up'); break; }
  }
}
console.log('facing ' + face + ', visited cells: ' + seen.size + ', last pos ' + (pos ? pos.map(Math.round).join(',') : 'none'));
