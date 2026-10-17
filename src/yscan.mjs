// Yellow switch-plate finder in a raw BGRA dump. CLI: node src/yscan.mjs logs/ocr/x.bin
import fs from 'fs';
export function findPlates(file, y0 = 120, y1 = 210) {
  const b = fs.readFileSync(file);
  const W = 646, H = 520;
  const isY = (x, y) => { const p = (y * W + x) * 4; return b[p + 2] > 170 && b[p + 1] > 150 && b[p] < 120; };
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) {
    if (seen[y * W + x] || !isY(x, y)) continue;
    const st = [y * W + x]; seen[y * W + x] = 1;
    let top = 0, x0 = x, x1 = x, yy0 = y, yy1 = y, n = 0;
    while (top < st.length) {
      const q = st[top++]; n++;
      const qx = q % W, qy = (q / W) | 0;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < yy0) yy0 = qy; if (qy > yy1) yy1 = qy;
      for (const [rx, ry] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) {
        if (rx < 0 || ry < y0 || rx >= W || ry > y1) continue;
        const rp = ry * W + rx;
        if (!seen[rp] && isY(rx, ry)) { seen[rp] = 1; st.push(rp); }
      }
    }
    // plates: tall (h>=14), narrow (w<=16), dense; arrow sparkles are flat/wide/sparse
    if (yy1 - yy0 >= 14 && x1 - x0 <= 16 && n >= 60) out.push({ x0, x1, y0: yy0, y1: yy1, cx: (x0 + x1) >> 1, n });
  }
  return out;
}
if (process.argv[1] && process.argv[1].endsWith('yscan.mjs')) {
  console.log(JSON.stringify(findPlates(process.argv[2])));
}
