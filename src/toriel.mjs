// Watch Toriel: sample her position (white fur + blue-grey robe) every few seconds.
// CLI: node src/toriel.mjs [samples] [gapMs]
import fs from 'fs';
import { execFileSync } from 'child_process';

const sh = (a) => { try { return execFileSync('node', ['src/play.mjs', ...a], { stdio: 'pipe' }); } catch { } };
const n0 = Number(process.argv[2] || 5);
const gap = Number(process.argv[3] || 5000);

function tor() {
  sh(['raw', 'grab', 'logs/ocr/t.bin']);
  const b = fs.readFileSync('logs/ocr/t.bin');
  const W = 646;
  let n = 0, sx = 0, sy = 0, mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
  for (let y = 150; y < 450; y++) for (let x = 0; x < 646; x++) {
    const p = (y * W + x) * 4, B = b[p], G = b[p + 1], R = b[p + 2];
    if (R === 94 && G === 84 && B === 146) { n++; sx += x; sy += y; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  }
  return n ? { n, c: [Math.round(sx / n), Math.round(sy / n)], box: [mnx, mny, mxx, mxy] } : null;
}
(async () => {
  for (let i = 0; i < n0; i++) {
    console.log(new Date().toISOString().slice(11, 19), JSON.stringify(tor()));
    if (i + 1 < n0) await new Promise((r) => setTimeout(r, gap));
  }
})();
