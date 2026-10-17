// throwaway: black (VOID) cells adjacent to walkable ground, nearest first, so a doorway can be
// aimed at deliberately instead of hoping the frontier offers one.
import fs from 'node:fs';
const GW = 1600, GH = 1000, CELL = 2, GOX = 800, GOY = 500;
const g = fs.readFileSync('logs/map/room0.bin');
const WALK = new Set([1, 2, 6, 8]); // FLOOR LIGHT WOOD PROVEN
const me = [Number(process.argv[2]), Number(process.argv[3])];
const out = [];
for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
  if (g[gy * GW + gx] !== 3) continue;
  let adj = 0, wide = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (WALK.has(g[(gy + dy) * GW + gx + dx])) adj++;
  if (adj < 1) continue;
  for (let dy = -3; dy <= 3; dy++) if (g[(gy + dy) * GW + gx] === 3) wide++;
  if (wide < (+(process.argv[4]) || 0) || adj < 3) continue;
  out.push({ gx, gy, adj, wide, d, world: [2 * (gx - GOX), 2 * (gy - GOY)] });
}
out.sort((a, b) => a.d - b.d);
for (const c of out.slice(0, 12)) console.log(`gap ${c.gx},${c.gy} world ${c.world} manhattan ${c.d} walkable-neighbours ${c.adj} black-run-vertical ${c.wide}`);
console.log(`total candidate gap cells ${out.length}`);
