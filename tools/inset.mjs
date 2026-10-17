// How close can my feet get to a solid object's DRAWN edge? The map's SPIKE/BRICK classes come from
// sprite pixels, so if the game lets my body overlap the drawn edge, clearance inferred from colour
// cannot gate pathing. Walk into a known object and report my sprite position against its bbox.
// usage: node tools/inset.mjs <dir> <x0> <y0> <x1> <y1>   (the object's drawn bbox in screen px)
import { execFileSync } from 'child_process';
import { playerPos } from '../src/walk.mjs';
const [dir, x0, y0, x1, y1] = process.argv.slice(2);
const run = (c) => execFileSync('node', ['src/play.mjs', ...c], { stdio: 'pipe' });
const pos = () => { run(['raw', 'grab', 'logs/inset.bin']); const p = playerPos('logs/inset.bin'); return p ? [p.x, p.y] : null; };
console.log(`object bbox ${x0},${y0}-${x1},${y1}`);
for (let i = 0; i < 8; i++) {
  const p = pos();
  if (!p) { console.log('sprite lost'); break; }
  run(['hold', dir, '200']);
  const q = pos();
  if (!q) { console.log('sprite lost after hold'); break; }
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const gap = dir === 'right' ? Number(x0) - q[0] : dir === 'left' ? q[0] - Number(x1)
    : dir === 'up' ? Number(y0) - q[1] : q[1] - Number(y1);
  console.log(`hold ${dir} 200ms: ${p} -> ${q} moved ${d.toFixed(0)} px; feet-to-drawn-edge ${gap.toFixed(0)} px${d < 3 ? '  <-- STOPPED' : ''}`);
  if (d < 3) break;
}
