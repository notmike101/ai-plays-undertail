// Pixel OCR for the game's bitmap fonts, component based: every glyph-sized ink
// blob is matched against templates learned from frames the operator already read.
//
//   node src/ocr.mjs lines <bin> <w> <h>                          # detected lines + glyph boxes
//   node src/ocr.mjs read  <bin> <w> <h> [set]                    # decode text, one line per row
//   node src/ocr.mjs train <bin> <w> <h> <set> "<line>" [lineIdx] # teach glyphs from a known line
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const GLYPHS = path.join(ROOT, 'ocr', 'glyphs.json');
const SPACE_GAP = 7;

function loadGlyphs() { try { return JSON.parse(fs.readFileSync(GLYPHS, 'utf8')); } catch { return {}; } }
function saveGlyphs(g) { fs.mkdirSync(path.dirname(GLYPHS), { recursive: true }); fs.writeFileSync(GLYPHS, JSON.stringify(g)); }

// ink -> lines of glyph boxes
export function analyze(buf, W, H) {
  const N = W * H;
  const lum = (p) => (buf[p * 4] + buf[p * 4 + 1] + buf[p * 4 + 2]) / 3;
  const dead = new Uint8Array(N); // borders and oversized blobs

  // long straight runs = box / bubble borders
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && lum(y * W + x) > 128) { run++; continue; }
      if (run > 100) for (let k = x - run; k < x; k++) dead[y * W + k] = 1;
      run = 0;
    }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && lum(y * W + x) > 128) { run++; continue; }
      if (run > 60) for (let k = y - run; k < y; k++) dead[k * W + x] = 1;
      run = 0;
    }
  }

  // connected components of the remaining ink
  const lab = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const alive = (p) => p >= 0 && p < N && lum(p) > 128 && !dead[p];
  const collect = () => {
    const comps = [];
    lab.fill(-1);
    for (let i = 0; i < N; i++) {
      if (!alive(i)) continue;
    const px = [];
    let top = 0;
    stack[top++] = i; lab[i] = comps.length;
    while (top > 0) {
      const p = stack[--top];
      px.push(p);
      const x = p % W;
      const nb = [];
      if (x > 0) nb.push(p - 1);
      if (x < W - 1) nb.push(p + 1);
      if (p >= W) nb.push(p - W);
      if (p < N - W) nb.push(p + W);
      for (const q of nb) if (lab[q] < 0 && alive(q)) { lab[q] = comps.length; stack[top++] = q; }
    }
    let minx = W, maxx = -1, miny = H, maxy = -1;
    for (const p of px) {
      const x = p % W, y = (p / W) | 0;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    comps.push({ px, minx, maxx, miny, maxy });
    }
    return comps;
  };
  // sprites / portraits are blobs; blank their whole box, then look again so
  // their inner details cannot masquerade as glyphs
  let comps = collect();
  for (const c of comps) {
    if (c.maxx - c.minx <= 24 && c.maxy - c.miny <= 24 && c.px.length <= 300) continue;
    for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) dead[y * W + x] = 1;
  }
  comps = collect();

  const ylo = Number(process.env.OCR_YMIN || 0), yhi = Number(process.env.OCR_YMAX || 1e9);
  // font-sized only: this font sits in a 16x21 box (dots are the tiny case),
  // which is what separates glyphs from sprite scraps
  const fontSized = (c) => {
    const w = c.maxx - c.minx + 1, h = c.maxy - c.miny + 1;
    return c.px.length >= 8 && (h <= 6 && w <= 6 ? true : h >= 8 && h <= 21 && w <= 16);
  };
  let glyphs = comps.filter((c) => fontSized(c) && c.maxy >= 40 && c.miny >= ylo && c.maxy <= yhi);

  // join fragments of one glyph (dot of an i): nearest pair first, so unrelated
  // ink elsewhere in the frame cannot change how a glyph is assembled
  const parent = glyphs.map((_, i) => i);
  const box = glyphs.map((g) => [g.minx, g.maxx, g.miny, g.maxy]);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs = [];
  for (let a = 0; a < glyphs.length; a++) {
    for (let b = a + 1; b < glyphs.length; b++) {
      const A = glyphs[a], B = glyphs[b];
      const xov = Math.min(A.maxx, B.maxx) - Math.max(A.minx, B.minx);
      const ygap = Math.max(A.miny, B.miny) - Math.min(A.maxy, B.maxy);
      if (xov >= -1 && ygap <= 5 && Math.abs((A.miny + A.maxy) - (B.miny + B.maxy)) <= 32) pairs.push([ygap, a, b]);
    }
  }
  pairs.sort((p, q) => p[0] - q[0]);
  for (const [, a, b] of pairs) {
    const ra = find(a), rb = find(b);
    if (ra === rb) continue;
    const u = [Math.min(box[ra][0], box[rb][0]), Math.max(box[ra][1], box[rb][1]), Math.min(box[ra][2], box[rb][2]), Math.max(box[ra][3], box[rb][3])];
    if (u[1] - u[0] > 20 || u[3] - u[2] > 24) continue;
    parent[rb] = ra;
    box[ra] = u;
  }
  const groups = new Map();
  glyphs.forEach((g, i) => {
    const r = find(i), B = box[r];
    const it = groups.get(r);
    if (it) { it.px = it.px.concat(g.px); }
    else groups.set(r, { px: g.px, minx: B[0], maxx: B[1], miny: B[2], maxy: B[3] });
  });
  glyphs = [...groups.values()];
  // text sits on a baseline in clusters; stray ink (box corners, sprite debris)
  // has no neighbour glyph next to it
  const p2 = glyphs.map((_, i) => i);
  const find2 = (i) => (p2[i] === i ? i : (p2[i] = find2(p2[i])));
  for (let a = 0; a < glyphs.length; a++) {
    for (let b = a + 1; b < glyphs.length; b++) {
      const A = glyphs[a], B = glyphs[b];
      const yov = Math.min(A.maxy, B.maxy) - Math.max(A.miny, B.miny);
      const xgap = Math.max(A.minx - B.maxx, B.minx - A.maxx);
      if (yov >= 2 && xgap <= 22) p2[find2(b)] = find2(a);
    }
  }
  const clusters = new Map();
  glyphs.forEach((g, i) => {
    const r = find2(i), c = clusters.get(r);
    if (c) { c.n++; c.minx = Math.min(c.minx, g.minx); c.maxx = Math.max(c.maxx, g.maxx); }
    else clusters.set(r, { n: 1, minx: g.minx, maxx: g.maxx });
  });
  glyphs = glyphs.filter((g) => { const c = clusters.get(find2(glyphs.indexOf(g))); return c && c.n >= 2 && c.maxx - c.minx >= 24; });
  const key = (c) => {
    const rows = [];
    for (let y = c.miny; y <= c.maxy; y++) {
      let r = '';
      for (let x = c.minx; x <= c.maxx; x++) r += alive(y * W + x) ? '#' : '.';
      rows.push(r);
    }
    return (c.maxx - c.minx + 1) + 'x' + (c.maxy - c.miny + 1) + ':' + rows.join('/');
  };

  // group glyphs into text lines by vertical overlap
  glyphs.sort((a, b) => (a.miny + a.maxy) - (b.miny + b.maxy) || a.minx - b.minx);
  const lines = [];
  for (const g of glyphs) {
    const line = lines.find((L) => Math.min(L.maxy, g.maxy) - Math.max(L.miny, g.miny) >= 3);
    if (line) { line.g.push(g); line.miny = Math.min(line.miny, g.miny); line.maxy = Math.max(line.maxy, g.maxy); }
    else lines.push({ miny: g.miny, maxy: g.maxy, g: [g] });
  }
  for (const L of lines) L.g.sort((a, b) => a.minx - b.minx);
  return { lines, key };
}

function render(L, T, key) {
  let s = '';
  L.g.forEach((g, i) => {
    if (i && g.minx - L.g[i - 1].maxx >= SPACE_GAP) s += ' ';
    s += T[key(g)] || '?';
  });
  return s;
}

export function readText(buf, W, H, set = 'dialog') {
  const T = loadGlyphs()[set] || {};
  const { lines, key } = analyze(buf, W, H);
  return lines.filter((L) => L.g.length >= 2 && L.maxy - L.miny >= 6)
    .map((L) => render(L, T, key).replace(/^[\s?]+/, '').replace(/[\s?]+$/, ''))
    .filter((s) => s.length > 0).join('\n');
}

export function trainLine(buf, W, H, set, text, lineIdx = 0) {
  const all = loadGlyphs();
  const T = all[set] || (all[set] = {});
  const { lines, key } = analyze(buf, W, H);
  const L = lines[lineIdx];
  if (!L) return 'no such line (' + lines.length + ' lines)';
  let ti = 0, warn = '';
  L.g.forEach((g, i) => {
    if (i && g.minx - L.g[i - 1].maxx >= SPACE_GAP) while (text[ti] === ' ') ti++;
    while (text[ti] === ' ') ti++;
    const ch = text[ti];
    if (ch === undefined) { warn = 'WARN: known text shorter than glyph count'; return; }
    T[key(g)] = ch;
    ti++;
  });
  saveGlyphs(all);
  return (warn ? warn + '\n' : '') + 'line ' + lineIdx + ' -> ' + render(L, T, key) + ' (' + L.g.length + ' glyphs)';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.slice(2);
  const cmd = arg[0];
  const buf = fs.readFileSync(arg[1]);
  const W = Number(arg[2]), H = Number(arg[3]);
  if (cmd === 'lines') {
    const { lines, key } = analyze(buf, W, H);
    console.log(JSON.stringify(lines.map((L, i) => ({ i, y: [L.miny, L.maxy], n: L.g.length, x: [L.g[0].minx, L.g[L.g.length - 1].maxx], text: render(L, loadGlyphs()[arg[4] || 'dialog'] || {}, key) }))));
  } else if (cmd === 'read') {
    console.log(readText(buf, W, H, arg[4] || 'dialog'));
  } else if (cmd === 'train') {
    console.log(trainLine(buf, W, H, arg[4], arg[5], Number(arg[6] || 0)));
  } else {
    console.log('usage: ocr.mjs lines|read|train <bin> <w> <h> [set] ["line"] [lineIdx]');
  }
}
