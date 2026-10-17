// throwaway: every contiguous BLACK region that touches walkable ground, with its bounding box and
// the world point nearest to me - so a doorway can be aimed at deliberately.
import fs from 'node:fs';
const GW = 1600, GH = 1000, GOX = 800, GOY = 500;
const g = fs.readFileSync('logs/map/room0.bin');
const WALK = new Set([1, 2, 6, 8]);
const me = [+(process.argv[2] || 924), +(process.argv[3] || 748)];
const seen = new Uint8Array(GW * GH);
const out = [];
for (let s0 = 0; s0 < GW * GH; s0++) {
  if (g[s0] !== 3 || seen[s0]) continue;
  const st = [s0]; seen[s0] = 1;
  let n = 0, x0 = GW, x1 = 0, y0 = GH, y1 = 0, touches = 0, best = -1, bestCell = null;
  while (st.length) {
    const q = st.pop(); n++;
    const qx = q % GW, qy = (q / GW) | 0;
    if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = qx + dx, ny = qy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const v = g[ny * GW + nx];
      if (WALK.has(v)) { touches++; const d = Math.abs(nx - me[0]) + Math.abs(ny - me[1]); if (best < 0 || d < best) { best = d; bestCell = [nx, ny]; } continue; }
      if (v === 3 && !seen[ny * GW + nx]) { seen[ny * GW + nx] = 1; st.push(ny * GW + nx); }
    }
  }
  if (!touches || n < 25) continue;
  out.push({ n, w: x1 - x0 + 1, h: y1 - y0 + 1, box: [x0, y0, x1, y1], touches, near: best, nearCell: bestCell, world: bestCell ? [2 * (bestCell[0] - GOX), 2 * (bestCell[1] - GOY)] : null });
}
out.sort((a, b) => a.near - b.near);
for (const c of out.slice(0, 14)) console.log(`black region cells=${c.n} bbox=${c.box.join('..')} ${c.w}x${c.h} touches=${c.touches} nearest-walkable=${c.nearCell} world=${c.world}`);
console.log(`total black regions touching floor: ${out.length}`);
