// Hold-rate measurement for a room where the camera never scrolls: the whole-window align is
// useless there (it reports 0 for any motion), so measure my sprite's own screen displacement.
// usage: node tools/rate.mjs <dir> <ms> [trials]
import { execFileSync } from 'child_process';
import { playerPos } from '../src/walk.mjs';
const [dir, ms, trials = '3'] = process.argv.slice(2);
const pos = () => {
  execFileSync('node', ['src/play.mjs', 'raw', 'grab', 'logs/rate.bin'], { stdio: 'pipe' });
  const p = playerPos('logs/rate.bin');
  return p ? [p.x, p.y] : null;
};
const run = (cmd) => execFileSync('node', ['src/play.mjs', ...cmd], { stdio: 'pipe' });
const rows = [];
for (let i = 0; i < Number(trials); i++) {
  const back = dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir === 'left' ? 'right' : 'left';
  let a = pos();
  if (!a) { console.log('sprite not found'); continue; }
  run(['hold', dir, String(ms)]);
  const b = pos();
  run(['hold', back, String(ms)]); // walk back so trials stay inside the room
  if (!b) { console.log('sprite lost after the hold'); continue; }
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  rows.push([ms, d, d / ms]);
  console.log(`${dir} ${ms}ms -> ${d.toFixed(1)} px  = ${(d / ms).toFixed(3)} px/ms`);
}
if (rows.length) {
  const long = rows.filter((r) => r[0] >= 500);
  const use = long.length ? long : rows;
  const avg = use.reduce((s, r) => s + r[2], 0) / use.length;
  console.log(`PXMS from holds >=500ms: ${avg.toFixed(3)} px/ms  (set PXMS = ${avg.toFixed(2)})`);
}
