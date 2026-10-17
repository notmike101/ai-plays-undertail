// Right-hand-rule wall follower for the current room.
// The camera scrolls, so screen x/y mean nothing; the plank's brown tiles are a
// fixed landmark, so (me - plank) is a world-invariant position. Walls are found
// empirically: a hold that does not change that vector is blocked.
// CLI: node src/explore.mjs [steps] [facing]   e.g. node src/explore.mjs 60 right
import { execFileSync } from 'child_process';
import fs from 'fs';

const sh = (a) => { try { return execFileSync('node', ['src/play.mjs', ...a], { stdio: 'pipe' }).toString(); } catch { return ''; } };
const steps = Number(process.argv[2] || 40);
let face = process.argv[3] || 'right';
const ORDER = { right: ['right', 'down', 'left', 'up'], down: ['down', 'left', 'up', 'right'], left: ['left', 'up', 'right', 'down'], up: ['up', 'right', 'down', 'left'] };

// landmark probe: [me.x - plank.x0, me.y - plank.y0], or null when unanchored
function spot() {
  sh(['raw', 'grab', 'logs/ocr/e.bin']);
  const b = fs.readFileSync('logs/ocr/e.bin');
  const W = 646;
  let px0 = 1e9, py0 = 1e9, pn = 0;
  for (let y = 60; y < 480; y += 2) for (let x = 0; x < W; x += 2) {
    const p = (y * W + x) * 4, R = b[p + 2], G = b[p + 1], B = b[p];
    if (R > 100 && R < 205 && G > 50 && G < 130 && B < 100) { pn++; if (x < px0) px0 = x; if (y < py0) py0 = y; }
  }
  let mx = 0, my = 0, mn = 0;
  for (let y = 150; y < 440; y += 2) for (let x = 120; x < 520; x += 2) {
    const p = (y * W + x) * 4, R = b[p + 2], G = b[p + 1], B = b[p];
    if (R > 200 && G > 150 && B < 110) { mn++; mx += x; my += y; }
  }
  if (!mn || pn < 200) return null;
  return [Math.round(mx / mn) - px0, Math.round(my / mn) - py0];
}

const key = (s) => Math.round(s[0] / 16) + ',' + Math.round(s[1] / 16);
const seen = new Set();
let stall = 0;
for (let i = 0; i < steps; i++) {
  const before = spot();
  if (!before) { console.log('no landmark/player (different room?)'); break; }
  seen.add(key(before));
  // pick the direction that most likely reaches an unvisited cell (1 probe/step)
  const DELTA = { right: [36, 0], left: [-36, 0], up: [0, -12], down: [0, 12] };
  const cand = ORDER[face];
  const freshDir = cand.find((d) => !seen.has(key([before[0] + DELTA[d][0], before[1] + DELTA[d][1]])));
  face = freshDir || cand[0];
  sh(['hold', face, '120']);
  const after = spot();
  const moved = !!after && (Math.abs(after[0] - before[0]) > 10 || Math.abs(after[1] - before[1]) > 10);
  if (moved) {
    const fresh = !seen.has(key(after));
    seen.add(key(after));
    console.log(`step ${i}: ${face} -> ${after.join(',')} ${fresh ? '*' : ' '} visited=${seen.size}`);
  } else {
    console.log(`step ${i}: ${face} blocked`);
  }
  if (!moved) {
    const back = { right: 'left', left: 'right', up: 'down', down: 'up' }[face];
    sh(['hold', back, '150']);
    face = ORDER[face][1];
    stall++;
    console.log(`step ${i}: blocked, back off, facing ${face}`);
    if (stall > 12) { console.log('giving up'); break; }
  } else stall = 0;
}
console.log('facing ' + face + ', visited cells: ' + seen.size);
