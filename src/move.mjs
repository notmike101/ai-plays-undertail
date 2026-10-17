// Closed-loop movement: hold a direction, then decide from the screen whether the
// world actually changed. My on-screen position barely moves mid-room (the camera
// follows me), so "did the frame change" is the honest signal that I travelled;
// a static frame means a wall. Usage: node src/move.mjs <left|right|up|down> <px>
import { playerPos } from './walk.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
const [dir, pxS] = process.argv.slice(2);
const target = Number(pxS);
const PNG = 'logs/frames/move.png', BIN = 'logs/ocr/move.bin';
const sh = (args) => execFileSync('node', ['src/play.mjs', ...args], { stdio: 'pipe' });
const grab = () => {
  sh(['shot', 'move.png']);
  sh(['raw', `dump ${PNG} ${BIN}`]);
  return { buf: fs.readFileSync(BIN), pos: playerPos(BIN) };
};
const changed = (A, B) => {
  let n = 0;
  for (let i = 0; i < A.length; i += 4)
    if (Math.abs(A[i] - B[i]) > 40 || Math.abs(A[i + 1] - B[i + 1]) > 40 || Math.abs(A[i + 2] - B[i + 2]) > 40) n++;
  return n;
};
// measured: walking into a wall changes ~3k px (my own animation), walking freely
// scrolls the view for ~77k px, and standing still changes ~1.5k px
let cur = grab();
if (!cur.pos) { console.log(JSON.stringify({ ok: false, err: 'player not found' })); process.exit(1); }
let moved = 0, stalls = 0;
for (let i = 0; moved < target && i < 12; i++) {
  const step = Math.min(60, target - moved); // short holds: ~0.3 px per ms
  sh(['hold', dir, String(Math.round(step / 0.3))]);
  const next = grab();
  const scrolled = changed(cur.buf, next.buf) > 12000;
  const slid = next.pos && cur.pos ? Math.abs(next.pos.x - cur.pos.x) + Math.abs(next.pos.y - cur.pos.y) > 5 : false;
  if (scrolled || slid) { moved += step; stalls = 0; } else if (++stalls >= 2) { cur = next; break; }
  cur = next;
}
console.log(JSON.stringify({ ok: true, dir, want: target, moved, blocked: moved < target, at: [cur.pos.x, cur.pos.y] }));
