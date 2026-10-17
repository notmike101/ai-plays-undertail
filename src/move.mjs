// Closed-loop movement with position feedback. Usage: node src/move.mjs <left|right|up|down> <px>
// Holds the key, re-measures the player sprite, repeats; reports blocked if the position stops changing.
import { playerPos } from './walk.mjs';
import { execFileSync } from 'child_process';
const [dir, pxS] = process.argv.slice(2);
const target = Number(pxS);
const PNG = 'logs/frames/move.png', BIN = 'logs/ocr/move.bin';
const sh = (args) => execFileSync('node', ['src/play.mjs', ...args], { stdio: 'pipe' });
const snap = () => {
  sh(['shot', 'move.png']);
  sh(['raw', `dump ${PNG} ${BIN}`]);
  return playerPos(BIN);
};
const axis = dir === 'left' || dir === 'right' ? 'x' : 'y';
const sign = dir === 'right' || dir === 'down' ? 1 : -1;
let prev = snap();
if (!prev) { console.log(JSON.stringify({ ok: false, err: 'player not found' })); process.exit(1); }
const anchor = prev[axis];
let moved = 0, stalls = 0;
for (let i = 0; Math.abs(moved) < target && i < 8; i++) {
  const remain = target - Math.abs(moved);
  sh(['hold', dir, String(Math.max(90, Math.round(remain / 0.3)))]);
  const now = snap();
  if (!now) break;
  const d = sign * (now[axis] - anchor);
  if (Math.abs(d - moved) < 3) { if (++stalls >= 2) { prev = now; break; } }
  else { stalls = 0; moved = d; }
  prev = now;
}
console.log(JSON.stringify({ ok: true, dir, want: target, moved, blocked: Math.abs(moved) < target, at: [prev.x, prev.y] }));
