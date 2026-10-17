// motion.mjs - did this box of the frame actually move, and by how much?
//
// Two claims have already been published and retracted because I compared frames by eye: an NPC that was
// not moving looked like it was walking (the camera scrolled), and a block that I "pushed" was never even
// touched from its walkable row. Both questions are one number: the offset that best re-aligns a box of
// frame A inside frame B. Run it twice, once over a fixed wall and once over the object, and the NPC/
// block motion is (object offset - wall offset) - which is the only honest way to separate a scrolled
// camera from a moved sprite.
//
//   node src/motion.mjs <x0> <y0> <x1> <y1> [maxshift]      grab once now, save the crop for later
//   node src/motion.mjs match <x0> <y0> <x1> <y1> [maxshift] [cmd...]
//         grab A, run `node src/play.mjs <cmd...>` (e.g. `hold left 1200`), grab B, report the offset
//   node src/motion.mjs files <a.bin> <b.bin> <x0> <y0> <x1> <y1> [maxshift]
//
// Raw grabs are 646x520, 4 bytes per pixel in B,G,R,A order (same buffer slam.mjs reads).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const W = 646, H = 520, STEP = 2;
const arg = process.argv.slice(2);

function grabRaw(path) {
  for (let k = 0; k < 4; k++) {
    execFileSync('node', ['src/play.mjs', 'raw', 'grab', path], { stdio: 'pipe' });
    const b = readFileSync(path);
    if (b.length !== W * H * 4) throw new Error(`grab is ${b.length} bytes, expected ${W * H * 4}`);
    const seen = new Set();
    for (let y = 0; y < H; y += 3) {
      let h = 0;
      for (let x = 0; x < W; x += 7) h = (h * 31 + b[(y * W + x) * 4] + 3 * b[(y * W + x) * 4 + 1] + 7 * b[(y * W + x) * 4 + 2]) | 0;
      seen.add(h);
    }
    const distinct = seen.size;
    // slam.mjs's test, same reasoning: a torn grab repeats rows wholesale (a couple of dozen distinct
    // scanlines) while a merely flat frame still has hundreds, so a quiet room must not be rejected.
    if (distinct >= 40) return b;
    console.log(`grab came back smeared (${distinct} distinct scanlines); grabbing again`);
  }
  throw new Error('every grab came back smeared; the game or the bridge is in a bad state');
}

// Compare A's ROI against B shifted by (dx,dy), sampling every STEP px.
function score(a, b, x0, y0, x1, y1, dx, dy) {
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y += STEP) {
    const ra = y * W * 4, rb = (y + dy) * W * 4;
    for (let x = x0; x <= x1; x += STEP) {
      const ia = ra + x * 4, ib = rb + (x + dx) * 4;
      sum += Math.abs(a[ia] - b[ib]) + Math.abs(a[ia + 1] - b[ib + 1]) + Math.abs(a[ia + 2] - b[ib + 2]);
      n++;
    }
  }
  return sum / n;
}

function report(x0, y0, x1, y1, maxShift) {
  const a = grabRaw('logs/motion-a.bin');
  const cmd = arg.slice(5);
  if (cmd.length) execFileSync('node', ['src/play.mjs', ...cmd], { stdio: 'inherit' });
  const b = grabRaw('logs/motion-b.bin');
  const S = maxShift;
  let best = [0, 0, score(a, b, x0, y0, x1, y1, 0, 0)];
  for (let dy = -S; dy <= S; dy++)
    for (let dx = -S; dx <= S; dx++) {
      if (!dx && !dy) continue;
      const s = score(a, b, x0, y0, x1, y1, dx, dy);
      if (s < best[2]) best = [dx, dy, s];
    }
  console.log(`ROI ${x0},${y0}-${x1},${y1}: stayed put (mean |d| ${best[2].toFixed(1)}); ` +
    `best offset ${best[0]},${best[1]} (mean |d| ${best[2].toFixed(1)})` +
    (best[0] || best[1] ? ` -> this box moved ${best[0]},${best[1]} px` : ' -> this box did NOT move'));
  writeFileSync(`logs/motion-crop-a.bin`, a.subarray((y0 * W + x0) * 4, (y1 * W + x1) * 4));
}

const num = (s) => Number(s);
if (arg[0] === 'files') {
  const [pa, pb, x0, y0, x1, y1, s] = arg.slice(1);
  const a = readFileSync(pa), b = readFileSync(pb);
  const S = s === undefined ? 40 : num(s);
  const at0 = score(a, b, num(x0), num(y0), num(x1), num(y1), 0, 0);
  let best = [0, 0, at0];
  for (let dy = -S; dy <= S; dy++)
    for (let dx = -S; dx <= S; dx++) {
      if (!dx && !dy) continue;
      const v = score(a, b, num(x0), num(y0), num(x1), num(y1), dx, dy);
      if (v < best[2]) best = [dx, dy, v];
    }
  console.log(`${pa} vs ${pb} ROI ${x0},${y0}-${x1},${y1}: offset ${best[0]},${best[1]} ` +
    `(mean |d| ${best[2].toFixed(1)}; at (0,0) it was ${at0.toFixed(1)})`);
} else if (arg[0] === 'match') {
  report(num(arg[1]), num(arg[2]), num(arg[3]), num(arg[4]), arg[5] === undefined ? 40 : num(arg[5]));
} else {
  // No comparison yet: just park a raw grab so a later `files` run can use it.
  grabRaw('logs/motion-a.bin');
  writeFileSync('logs/motion-a.txt', arg.join(','));
  console.log(`grabbed logs/motion-a.bin (ROI ${arg.join(',')}); run \`match\` after the action`);
}
