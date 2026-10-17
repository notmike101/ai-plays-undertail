// Closed-loop movement. Preferred signal: the anchored position (me - brown plank
// tiles), which is invariant to the following camera. Without a visible landmark
// (other rooms) fall back to my sprite's own screen shift, then to a big frame
// change, which only happens when the camera actually scrolled.
// Usage: node src/move.mjs <left|right|up|down> <px>
import { anchorFrom, playerPosFrom } from './walk.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

const [dir, pxS] = process.argv.slice(2);
const target = Number(pxS);
const BIN = 'logs/ocr/move.bin';
const sh = (args) => execFileSync('node', ['src/play.mjs', ...args], { stdio: 'pipe' });
const AXIS = { left: [0, -1], right: [0, 1], up: [1, -1], down: [1, 1] }; // [gap component, sign]
const SIGN = { left: -1, right: 1, up: -1, down: 1 };
const grab = () => {
  sh(['raw', 'grab', BIN]);
  const buf = fs.readFileSync(BIN);
  return { buf, a: anchorFrom(buf), p: playerPosFrom(buf) };
};
const changed = (A, B) => {
  let n = 0;
  for (let i = 0; i < A.length; i += 4)
    if (Math.abs(A[i] - B[i]) > 40 || Math.abs(A[i + 1] - B[i + 1]) > 40 || Math.abs(A[i + 2] - B[i + 2]) > 40) n++;
  return n;
};
// how far I travelled along dir between two grabs
const gain = (A, B, step) => {
  if (A.a && B.a) { const [c, s] = AXIS[dir]; return (B.a.g[c] - A.a.g[c]) * s; }
  if (A.p && B.p) {
    const d = dir === 'left' || dir === 'right' ? (B.p.x - A.p.x) * SIGN[dir] : (B.p.y - A.p.y) * SIGN[dir];
    if (Math.abs(d) > 8) return d;
  }
  return changed(A.buf, B.buf) > 12000 ? step : 0;
};

let cur = grab();
let moved = 0, stalls = 0;
for (let i = 0; moved < target && i < 12; i++) {
  const step = Math.min(60, target - moved); // short holds: ~0.3 px per ms
  sh(['hold', dir, String(Math.round(step / 0.3))]);
  sh(['wait', '150']);
  const next = grab();
  const g = gain(cur, next, step);
  if (g > 8) { moved += Math.min(Math.round(g), Math.round(step * 1.6)); stalls = 0; }
  else if (++stalls >= 2) { cur = next; break; }
  cur = next;
}
console.log(JSON.stringify({
  ok: true, dir, want: target, moved, blocked: moved < target,
  gap: cur.a ? cur.a.g : null, me: cur.p ? [cur.p.x, cur.p.y] : null,
}));
