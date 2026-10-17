// Maze probe: tries one direction repeatedly while shifting sideways, so a room's
// channels become visible without colour-classifying the art.
// Usage: node src/probe.mjs <tryDir> <shiftDir> [tries] [tryPx] [shiftPx]
import { playerPos } from './walk.mjs';
import { execFileSync } from 'child_process';
const [tryDir, shiftDir, triesS = '8', tryPxS = '120', shiftPxS = '40'] = process.argv.slice(2);
const PNG = 'logs/frames/probe.png', BIN = 'logs/ocr/probe.bin';
const sh = (args) => execFileSync('node', ['src/play.mjs', ...args], { stdio: 'pipe' });
const snap = () => {
  sh(['shot', 'probe.png']);
  sh(['raw', `dump ${PNG} ${BIN}`]);
  return playerPos(BIN);
};
const mv = (dir, px) => JSON.parse(String(execFileSync('node', ['src/move.mjs', dir, String(px)], { stdio: 'pipe' })));
let p = snap();
if (!p) { console.log('player not found'); process.exit(1); }
for (let i = 0; i < Number(triesS); i++) {
  const r = mv(tryDir, Number(tryPxS));
  p = snap();
  console.log(`at ${p ? p.x + ',' + p.y : '?'}  ${tryDir} -> moved ${r.moved} blocked=${r.blocked}`);
  const s = mv(shiftDir, Number(shiftPxS));
  if (s.blocked && Math.abs(s.moved) < 5) { console.log(`  ${shiftDir} blocked too, stop`); break; }
}
