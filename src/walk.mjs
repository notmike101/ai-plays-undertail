// ASCII map + player position for a raw BGRA dump (646x520) taken with `dump`.
// CLI: node src/walk.mjs logs/ocr/x.bin [step]   (map, then player line)
// exports playerPosFrom(buf)/playerPos(file) -> {x,y,n}, anchor(bin) -> {g,me,plank}
import fs from 'fs';
import { execFileSync } from 'child_process';
export function playerPosFrom(b) {
  const W = 646, H = 520;
  // My sprite is the only tall compact yellow blob (face + hands); yellow switch
  // plates are wide and short, so the height/width ratio tells them apart. The
  // dark brown hair blob is the fallback when the face is hidden.
  const isFace = (p) => { p *= 4; return b[p + 2] > 200 && b[p + 1] > 150 && b[p] < 110; };
  const isHair = (p) => { p *= 4; const R = b[p + 2], G = b[p + 1], B = b[p]; return Math.abs(R - 61) < 12 && Math.abs(G - 18) < 12 && Math.abs(B - 14) < 12; };
  const blobs = (pred) => {
    const seen = new Uint8Array(W * H);
    const out = [];
    for (let y = 90; y < 430; y++) for (let x = 0; x < W; x++) {
      const s = y * W + x;
      if (seen[s] || !pred(s)) continue;
      const st = [s];
      seen[s] = 1;
      let top = 0, n = 0, sx = 0, sy = 0, minx = W, maxx = 0, miny = H, maxy = 0;
      while (top < st.length) {
        const q = st[top++];
        n++;
        const qx = q % W, qy = (q / W) | 0;
        sx += qx; sy += qy;
        if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
        if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
        for (const [rx, ry] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) {
          if (rx < 0 || ry < 0 || rx >= W || ry >= H) continue;
          const rp = ry * W + rx;
          if (!seen[rp] && pred(rp)) { seen[rp] = 1; st.push(rp); }
        }
      }
      out.push({ x: Math.round(sx / n), y: Math.round(sy / n), n, w: maxx - minx + 1, h: maxy - miny + 1 });
    }
    return out;
  };
  const pick = (list) => list.reduce((a, g) => (!a || g.n > a.n ? g : a), null);
  // The hair blob is visible whatever way I face, so it is the primary anchor;
  // the face blob only helps when the hair is hidden.
  const hair = pick(blobs(isHair).filter((g) => g.n >= 200 && g.w <= 40 && g.h <= 60));
  if (hair) return hair;
  return pick(blobs(isFace).filter((g) => g.n >= 60 && g.h >= 25 && g.h <= 60 && g.w <= 34));
}
export const playerPos = (file) => playerPosFrom(fs.readFileSync(file));

// Landmark anchoring: brown plank/wood tiles are static scenery, so (player -
// landmark) is a world coordinate even while the camera scrolls.
export function anchorFrom(buf) {
  const W = 646;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 60; y < 480; y += 2) for (let x = 0; x < W; x += 2) {
    const p = (y * W + x) * 4, R = buf[p + 2], G = buf[p + 1], B = buf[p];
    if (R > 105 && R < 205 && G > 50 && G < 130 && B < 100) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (n < 400) return null;
  const me = playerPosFrom(buf);
  if (!me) return null;
  return { g: [me.x - x0, me.y - y0], me, plank: [x0, y0, x1, y1] };
}
export function anchor(binPath) {
  execFileSync('node', ['src/play.mjs', 'raw', 'grab', binPath], { stdio: 'pipe' });
  return anchorFrom(fs.readFileSync(binPath));
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
