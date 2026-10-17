// Whole-screen room map with the legend measured in the Ruins.
// CLI: node src/map.mjs [file]   (grabs a fresh frame when no file is given)
import fs from 'fs';
import { execFileSync } from 'child_process';

let file = process.argv[2];
if (!file) { file = 'logs/ocr/m.bin'; execFileSync('node', ['src/play.mjs', 'raw', 'grab', file], { stdio: 'pipe' }); }
const b = fs.readFileSync(file);
const W = 646;
const at = (x, y) => { const p = (y * W + x) * 4; return [b[p + 2], b[p + 1], b[p]]; };
function cls(x, y) {
  let A = 0, Bc = 0, Cc = 0, D = 0, Wa = 0, Sp = 0, Br = 0, Vi = 0, Da = 0, n = 0;
  for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
    const [R, G, B] = at(x + dx, y + dy);
    n++;
    if (Math.abs(R - 185) < 16 && Math.abs(G - 98) < 16) A++;
    else if (Math.abs(R - 163) < 18 && Math.abs(G - 73) < 18) Bc++;
    else if (Math.abs(R - 132) < 22 && Math.abs(G - 53) < 22) D++;
    else if (B > 200 && G > 190 && R < 190) Wa++;
    else if (R > 168 && G > 168 && B > 168) Sp++;
    else if (R > 105 && R < 205 && G > 50 && G < 130 && B < 100) Br++;
    else if (G > 130 && R < 120 && B < 120) Vi++;
    else if (R < 60 && G < 60 && B < 80) Da++;
  }
  const m = [['W', Wa], ['v', Vi], ['B', Br], ['S', Sp], ['A', A], ['b', Bc], ['.', D], ['#', n - (Wa + Vi + Br + Sp + A + Bc + D + Da)]];
  m.sort((p, q) => q[1] - p[1]);
  return m[0][0];
}
const xs = 4;
console.log('     ' + Array.from({ length: Math.floor((646 - 0) / xs) }, (_, i) => (Math.floor(i * xs / 100) % 10)).join(''));
for (let y = 60; y < 470; y += 6) {
  let r = '';
  for (let x = 0; x + 6 < 646; x += xs) r += cls(x, y);
  console.log(String(y).padStart(4) + ' ' + r);
}
console.log('legend: A bright ledge top, b brick ledge face, . walkable floor, W water, S spike/white tile, B plank/wood, v vine, # other/dark');
