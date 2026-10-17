// ASCII map + player position for a raw BGRA dump (646x520) taken with `dump`.
// CLI: node src/walk.mjs logs/ocr/x.bin [step]   (map, then player line)
// exports playerPos(file) -> {x,y,n}
import fs from 'fs';
export function playerPos(file) {
  const b = fs.readFileSync(file);
  const W = 646, H = 520;
  // hair/dark body: R 45-85, G 8-40, B <35 (distinct from black outlines and brown brick)
  const isHair = (x, y) => { const p = (y * W + x) * 4; const R = b[p + 2], G = b[p + 1], B = b[p]; return R > 45 && R < 85 && G > 8 && G < 40 && B < 35; };
  const seen = new Uint8Array(W * H);
  let best = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (seen[y * W + x] || !isHair(x, y)) continue;
    const st = [y * W + x]; seen[y * W + x] = 1;
    let top = 0, sx = 0, sy = 0, n = 0;
    while (top < st.length) {
      const q = st[top++]; n++;
      const qx = q % W, qy = (q / W) | 0; sx += qx; sy += qy;
      for (const [rx, ry] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) {
        if (rx < 0 || ry < 0 || rx >= W || ry >= H) continue;
        const rp = ry * W + rx;
        if (!seen[rp] && isHair(rx, ry)) { seen[rp] = 1; st.push(rp); }
      }
    }
    if (n >= 200 && (!best || n > best.n)) best = { x: Math.round(sx / n), y: Math.round(sy / n), n };
  }
  return best;
}
function cls(R, G, B) {
  if (B > 200 && G > 170 && R < 180) return '~';   // water
  if (G > 150 && R < 110 && B < 120) return 'v';   // vine
  if (R > 190 && G > 150 && B < 130) return 'Y';   // yellow plate/marker
  if (R < 90 && G < 70 && B < 110) return 'K';     // dark recess
  if (R > 140 && G > 90 && G < 140 && B < 110) return 'B'; // brown brick
  if (Math.abs(R - 185) < 14 && Math.abs(G - 98) < 14) return 'P'; // walkable path
  if (Math.abs(R - 163) < 18 && Math.abs(G - 73) < 16) return 'p'; // non-path ground
  return '#';
}
if (process.argv[1] && process.argv[1].endsWith('walk.mjs')) {
  const [file, stepS] = process.argv.slice(2);
  const b = fs.readFileSync(file);
  const W = 646, S = Number(stepS || 8);
  let out = '';
  for (let y = 56; y < 496; y += S) {
    let row = '';
    for (let x = 0; x < W; x += S) {
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const p = ((y + dy) * W + x + dx) * 4;
        R += b[p + 2]; G += b[p + 1]; B += b[p]; n++;
      }
      row += cls(R / n, G / n, B / n);
    }
    out += row + '\n';
  }
  const pl = playerPos(file);
  // mark player on the map
  if (pl) {
    const rows = out.split('\n');
    const ri = Math.round((pl.y - 56) / S), ci = Math.round(pl.x / S);
    if (rows[ri] && ci >= 0 && ci < rows[ri].length) rows[ri] = rows[ri].slice(0, ci) + '@' + rows[ri].slice(ci + 1);
    out = rows.join('\n');
  }
  console.log(out);
  console.log(pl ? `player x=${pl.x} y=${pl.y} n=${pl.n}` : 'player not found');
}
