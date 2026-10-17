// Walk until standing under the nearest yellow switch plate, then face it and press it.
// Usage: node src/align.mjs [pressZ|nokey]
import { playerPos } from './walk.mjs';
import { findPlates } from './yscan.mjs';
import { execFileSync } from 'child_process';
const sh = (a) => JSON.parse(execFileSync('node', ['src/play.mjs', ...a], { stdio: 'pipe' }).toString());
const snap = () => {
  sh(['shot', 'al.png']);
  sh(['raw', 'dump logs/frames/al.png logs/ocr/al.bin']);
  return { p: playerPos('logs/ocr/al.bin'), plates: findPlates('logs/ocr/al.bin') };
};
let log = [];
let stuck = 0, last = null;
for (let i = 0; i < 14; i++) {
  const { p, plates } = snap();
  if (!p) { log.push('no player'); break; }
  if (!plates.length) { log.push(`no plates in view (at ${p.x},${p.y})`); break; }
  const t = plates.reduce((a, c) => Math.abs(c.cx - p.x) < Math.abs(a.cx - p.x) ? c : a);
  const dx = t.cx - p.x;
  log.push(`at ${p.x},${p.y} plate cx=${t.cx} dx=${dx}`);
  if (Math.abs(dx) <= 10) { last = 'aligned'; break; }
  if (last !== null && Math.abs(dx) >= Math.abs(last) - 2 && i > 0) { stuck++; if (stuck >= 2) break; } else stuck = 0;
  last = dx;
  sh(['hold', dx > 0 ? 'right' : 'left', String(Math.min(400, Math.max(90, Math.round(Math.abs(dx) / 0.3))))]);
}
// step up against the wall so the plate is within interaction range
for (let i = 0; i < 8; i++) {
  const { p } = snap();
  if (!p || p.y <= 190) break;
  sh(['hold', 'up', String(Math.min(400, Math.max(90, Math.round((p.y - 188) / 0.3))))]);
  const { p: q } = snap();
  if (!q || Math.abs(p.y - q.y) < 3) break;
  log.push(`up->${q.y}`);
}
if (process.argv[2] !== 'nokey') {
  sh(['press', 'up']);
  sh(['press', 'z']);
  const t = sh(['text']);
  console.log(JSON.stringify({ ok: true, log, text: t.text }));
} else console.log(JSON.stringify({ ok: true, log }));
