// Persistent world map. Consecutive captures are aligned by best pixel agreement, which
// gives the exact camera displacement; my world position is then (camera + my on-screen
// position), so a clamped camera can no longer fake a wall. The room is painted into a
// tile-class grid saved on disk, so the map survives between runs and can be path-found.
//
// CLI: node src/slam.mjs init | mark | show | png | walk frontier|plank|"to x y" [steps]
import { execFileSync } from 'child_process';
import fs from 'fs';
import zlib from 'zlib';
import { playerPosFrom } from './walk.mjs';

// capture geometry (window rect inside the 646x520 frame)
const CX0 = 267, CY0 = 62, CX1 = 759, CY1 = 452, CW = 646;
// map geometry: 1 cell = 2 capture px, canvas is per-room
const CELL = 2, GW = 1600, GH = 1000, GOX = 800, GOY = 500;
const DIR = 'logs/map';
const BIN = 'logs/ocr/slam.bin';

// class codes. The pale rounded shapes are the SAME walkable floor, just drawn lighter -
// only colour-exact hazards (void, water, vine, spikes) count as solid from the picture;
// everything else that stops me gets recorded as BLOCKED by the walker itself.
const UNKNOWN = 0, FLOOR = 1, LIGHT = 2, VOID = 3, WATER = 4, SPIKE = 5, WOOD = 6, VINE = 7, PROVEN = 8, OTH = 9, BLOCKED = 10;
const CH = { 0: '?', 1: '.', 2: 'L', 3: 'k', 4: 'W', 5: 'S', 6: 'B', 7: 'v', 8: '*', 9: '#', 10: 'X' };
const WALK = new Set([FLOOR, LIGHT, WOOD, PROVEN]);

const sh = (a) => { try { return execFileSync('node', ['src/play.mjs', ...a], { stdio: 'pipe' }); } catch { } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function grab() {
  sh(['raw', 'grab', BIN]);
  return fs.readFileSync(BIN);
}
const px = (b, x, y) => { const i = (y * CW + x) * 4; return [b[i + 2], b[i + 1], b[i]]; };
const luma = (b, x, y) => { const i = (y * CW + x) * 4; return b[i] + b[i + 1] + b[i + 2]; };

function near(c, r, g, b, tol = 22) { return Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - b) <= tol; }

function classify(b, x, y) {
  const c = px(b, x, y);
  if (near(c, 185, 98, 185, 16)) return LIGHT;
  if (near(c, 0, 0, 0, 40)) return VOID;
  if (near(c, 163, 73, 164, 22)) return FLOOR;
  if (near(c, 132, 53, 125, 22)) return FLOOR;
  if (near(c, 167, 112, 82, 26) || near(c, 112, 66, 56, 26)) return WOOD;
  if (c[1] > 150 && c[2] > 150 && c[0] < 170) return WATER;
  if (near(c, 55, 97, 138, 30)) return WATER;
  if (c[1] > 110 && c[1] > c[0] + 20 && c[1] > c[2] + 20) return VINE;
  if (c[0] > 168 && c[1] > 168 && c[2] > 168 && Math.abs(c[0] - c[2]) < 12) return SPIKE;
  return OTH;
}

// Camera offset of B relative to A. The brick pattern repeats every ~32 px, so a plain
// best-match can lock onto a shifted copy of itself; `expect` (the direction the walker is
// pressing) rejects candidates that would mean I moved backwards, and near-ties go to the
// smallest shift.
const UNIT = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };
function align(A, B, expect = null, prev = null) {
  const cost = (dx, dy) => {
    let s = 0, n = 0;
    for (let y = CY0 + 8; y < CY1 - 8; y += 6) for (let x = CX0 + 8; x < CX1 - 8; x += 6) {
      const xa = x + dx, ya = y + dy;
      if (xa < CX0 || xa > CX1 || ya < CY0 || ya > CY1) continue;
      s += Math.abs(luma(A, xa, ya) - luma(B, x, y)); n++;
    }
    return s / n;
  };
  const cands = [];
  for (let dy = -56; dy <= 56; dy += 4) for (let dx = -56; dx <= 56; dx += 4) cands.push([dx, dy, cost(dx, dy)]);
  cands.sort((p, q) => p[2] - q[2]);
  const fine = [];
  for (let k = 0; k < Math.min(10, cands.length); k++) {
    const [bx, by] = cands[k];
    for (let dy = by - 4; dy <= by + 4; dy++) for (let dx = bx - 4; dx <= bx + 4; dx++) fine.push([dx, dy, cost(dx, dy)]);
  }
  let pool = fine.concat(cands.slice(0, 3));
  if (expect) {
    const u = UNIT[expect];
    const ok = pool.filter(([dx, dy]) => dx * u[0] + dy * u[1] >= -6);
    if (ok.length) pool = ok;
  }
  if (prev) pool.push([prev[0], prev[1], cost(prev[0], prev[1])]); // hysteresis: featureless floor makes every offset look alike
  pool.sort((p, q) => p[2] - q[2]);
  const best = pool[0];
  const keep = prev && pool.find((c) => c[0] === prev[0] && c[1] === prev[1]);
  let pick = keep && keep[2] <= best[2] * 1.25 + 1 ? keep : best;
  if (pick === best) {
    for (const c of pool) {
      if (c[2] > best[2] * 1.06 + 1) break;
      if (Math.abs(c[0]) + Math.abs(c[1]) < Math.abs(pick[0]) + Math.abs(pick[1])) pick = c;
    }
  }
  return { dx: pick[0], dy: pick[1], cost: pick[2] };
}

const dark = (b) => { let d = 0, n = 0; for (let y = CY0; y < CY1; y += 4) for (let x = CX0; x < CX1; x += 4) { if (luma(b, x, y) < 45) d++; n++; } return d / n; };

function statePath() { return `${DIR}/room${state().room}`; }
function state() {
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(`${DIR}/current.json`)) fs.writeFileSync(`${DIR}/current.json`, JSON.stringify({ room: 0 }));
  return JSON.parse(fs.readFileSync(`${DIR}/current.json`));
}
function loadRoom() {
  const s = state(), p = statePath();
  let grid = new Uint8Array(GW * GH);
  if (fs.existsSync(p + '.bin')) grid = new Uint8Array(fs.readFileSync(p + '.bin'));
  const meta = fs.existsSync(p + '.json') ? JSON.parse(fs.readFileSync(p + '.json')) : { cam: [0, 0], trail: [] };
  if (!meta.me) meta.me = [0, 0];
  if (!meta.world) meta.world = [0, 0];
  meta.prevBuf = fs.existsSync(`${DIR}/prev.bin`) ? fs.readFileSync(`${DIR}/prev.bin`) : null;
  return { s, grid, meta };
}
function saveRoom(r) {
  const meta = { ...r.meta };
  if (r.meta.prevBuf) fs.writeFileSync(`${DIR}/prev.bin`, r.meta.prevBuf); // frame buffer stays out of the JSON sidecar
  delete meta.prevBuf;
  fs.writeFileSync(statePath() + '.bin', Buffer.from(r.grid.buffer));
  fs.writeFileSync(statePath() + '.json', JSON.stringify(meta));
}

const FEET = 13; // the collision point is at my feet, not at the hair anchor I am located by
const cellOf = (wx, wy) => [GOX + Math.round(wx / CELL), GOY + Math.round(wy / CELL)];
const gidx = (gx, gy) => gy * GW + gx;

// boxes in capture coordinates that must never be painted into the map: my own sprite and
// any robed NPC. Painting them smears fake obstacle cells over the floor I am standing on.
function spriteBoxes(b) {
  const boxes = [];
  const p = playerPosFrom(b);
  if (p) boxes.push([p.x - 12, p.x + 12, p.y - 10, p.y + 24]);
  let n = 0, x0 = 1e9, x1 = 0, y0 = 1e9, y1 = 0;
  for (let y = CY0; y < CY1; y += 2) for (let x = CX0; x < CX1; x += 2) {
    if (near(px(b, x, y), 94, 84, 146, 12)) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (n >= 150) boxes.push([x0 - 3, x1 + 3, y0 - 3, y1 + 3]);
  return { boxes, robe: n >= 150 ? [x0, x1, y0, y1] : null };
}

function paint(r, b, cam) {
  const { boxes } = spriteBoxes(b);
  const inside = (x, y) => boxes.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  for (let y = CY0; y <= CY1 - CELL; y += CELL) {
    for (let x = CX0; x <= CX1 - CELL; x += CELL) {
      let vote = {}, top = OTH, tn = 0;
      for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) {
        const c = classify(b, x + dx, y + dy);
        vote[c] = (vote[c] || 0) + 1;
        if (vote[c] > tn) { tn = vote[c]; top = c; }
      }
      if (top === OTH) continue; // my own sprite and the brick grout are unnameable; painting them would fence me in
      if (top === WATER && inside(x, y)) continue; // my shirt is the pool's blue
      const gx = GOX + Math.round((cam[0] + x) / CELL), gy = GOY + Math.round((cam[1] + y) / CELL);
      if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
      r.grid[gidx(gx, gy)] = top;
    }
  }
}

// mark the tiles I have physically stood on: strongest walkability evidence there is
function markFeet(r, cam, me) {
  const [wx, wy] = [cam[0] + me.x, cam[1] + me.y + 13];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (dx * dx + dy * dy > 12) continue;
    const [gx, gy] = cellOf(wx + dx * CELL, wy + dy * CELL);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
    if (r.grid[gidx(gx, gy)] !== VOID) r.grid[gidx(gx, gy)] = PROVEN;
  }
  r.meta.trail.push([Math.round(wx), Math.round(wy)]);
  if (r.meta.trail.length > 4000) r.meta.trail.splice(0, 2000);
}

// an NPC currently standing there is painted as an obstacle; a later frame paints over it
function markRobe(r, b, cam) {
  const { robe } = spriteBoxes(b);
  if (!robe) return null;
  for (let y = robe[2]; y <= robe[3]; y += CELL) for (let x = robe[0]; x <= robe[1]; x += CELL) {
    const gx = GOX + Math.round((cam[0] + x) / CELL), gy = GOY + Math.round((cam[1] + y) / CELL);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
    if (r.grid[gidx(gx, gy)] !== PROVEN) r.grid[gidx(gx, gy)] = OTH;
  }
  return robe;
}

function walkable(r, gx, gy) {
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return false;
  let c = {}, top = UNKNOWN, tn = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const v = r.grid[gidx(gx + dx, gy + dy)];
    c[v] = (c[v] || 0) + 1;
    if (c[v] > tn) { tn = c[v]; top = v; }
  }
  if (c[PROVEN] >= 2) return true;
  if (top === VOID || top === WATER || top === VINE || top === SPIKE || top === BLOCKED) return false;
  if (c[BLOCKED] >= 3) return false;
  return WALK.has(top);
}

const PREV = new Int32Array(GW * GH).fill(-2);
const QUEUE = new Int32Array(600000);
function bfs(r, start, goal, cap = 500000) {
  const gi = gidx(goal[0], goal[1]); // goals are cell pairs, not flat indices
  const touched = [];
  let head = 0, tail = 0;
  const si = gidx(start[0], start[1]);
  PREV[si] = -1; touched.push(si); QUEUE[tail++] = si;
  while (head < tail) {
    const cur = QUEUE[head++];
    if (cur === gi) break;
    const x = cur % GW, y = (cur - x) / GW;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx >= GW - 1 || ny < 1 || ny >= GH - 1) continue;
      const ni = gidx(nx, ny);
      if (PREV[ni] !== -2) continue;
      if (!walkable(r, nx, ny)) continue;
      PREV[ni] = cur; touched.push(ni); QUEUE[tail++] = ni;
      if (tail >= cap) break;
    }
  }
  let path = null;
  if (PREV[gi] !== -2) {
    path = [];
    for (let c = gi; c >= 0; c = PREV[c]) path.push([c % GW, (c - (c % GW)) / GW]);
    path.reverse();
  }
  for (const t of touched) PREV[t] = -2;
  return path;
}

function frontierGoal(r, start) {
  // nearest walkable cell that touches unmapped space
  let best = null, bd = 1e9;
  const R = 320;
  for (let gy = Math.max(1, start[1] - R); gy < Math.min(GH - 1, start[1] + R); gy++) {
    for (let gx = Math.max(1, start[0] - R); gx < Math.min(GW - 1, start[0] + R); gx++) {
      if (!walkable(r, gx, gy)) continue;
      let unk = false;
      for (let dy = -1; dy <= 1 && !unk; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = r.grid[gidx(gx + dx, gy + dy)];
        if (dx === 0 && dy === 0) continue;
        if (gx + dx < 0 || gx + dx >= GW || gy + dy < 0 || gy + dy >= GH || n === UNKNOWN) { unk = true; break; }
      }
      if (!unk) continue;
      const d = Math.abs(gx - start[0]) + Math.abs(gy - start[1]);
      if (d < bd) { bd = d; best = [gx, gy]; }
    }
  }
  return best;
}

function plankGoal(r) {
  let best = null, bn = 0;
  for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
    if (r.grid[gidx(gx, gy)] !== WOOD) continue;
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (r.grid[gidx(gx + dx, gy + dy)] === WOOD) n++;
    if (n > bn) { bn = n; best = [gx, gy]; }
  }
  return bn > 40 ? best : null;
}

const sameFrame = (A, B) => {
  if (!A || A.length !== B.length) return false;
  for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) return false;
  return true;
};

// a failed step is the only real proof of a wall in this art style
function markBlocked(r, cell, dir) {
  const d = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[dir];
  for (let s = 4; s <= 7; s++) for (let w = -1; w <= 1; w++) {
    const gx = cell[0] + d[0] * s + (d[0] ? 0 : w), gy = cell[1] + d[1] * s + (d[1] ? 0 : w);
    if (gx < 1 || gx >= GW - 1 || gy < 1 || gy >= GH - 1) continue;
    const i = gidx(gx, gy);
    if (r.grid[i] !== PROVEN) r.grid[i] = BLOCKED;
  }
}

// one verified step; returns how far my world position actually moved
function step(r, dir, ms = 150) {
  const before = r.meta.cam, me0 = r.meta.me;
  sh(['hold', dir, String(ms)]);
  sleep(160);
  let b = grab();
  if (sameFrame(r.meta.prevBuf, b)) { // the game pauses when its window loses focus; a byte-identical frame means my key went nowhere
    sh(['focus']);
    sh(['hold', dir, String(ms)]);
    sleep(160);
    b = grab();
  }
  if (dark(b) > 0.6) return { fade: true };
  const a = align(r.meta.prevBuf || b, b, dir, r.meta.lastOff);
  if (a.cost > 45) return { transition: a.cost };
  r.meta.lastOff = [a.dx, a.dy];
  r.meta.cam = [before[0] + a.dx, before[1] + a.dy];
  const me = playerPosFrom(b);
  if (!me) return { lost: true };
  const d = Math.hypot(r.meta.cam[0] + me.x - (before[0] + me0[0]), r.meta.cam[1] + me.y - (before[1] + me0[1]));
  r.meta.me = [me.x, me.y];
  r.meta.world = [r.meta.cam[0] + me.x, r.meta.cam[1] + me.y + FEET];
  r.meta.prevBuf = b;
  paint(r, b, r.meta.cam);
  markRobe(r, b, r.meta.cam);
  markFeet(r, r.meta.cam, me);
  return { moved: d, world: [r.meta.cam[0] + me.x, r.meta.cam[1] + me.y] };
}

function show(r) {
  const [gx, gy] = cellOf(...r.meta.world);
  const S = 6;
  for (let y = gy - 24; y <= gy + 24; y += S / CELL * 2) {
    let line = '';
    for (let x = gx - 40; x <= gx + 40; x += S / CELL * 2) {
      const v = r.grid[gidx(x, y)];
      line += (Math.abs(x - gx) <= 1 && Math.abs(y - gy) <= 1) ? '@' : (CH[v] || '?');
    }
    console.log(line);
  }
  console.log(`room ${r.s.room} cell ${gx},${gy} world ${r.meta.world.map(Math.round)} cam ${r.meta.cam.map(Math.round)}`);
}

function writePng(r) {
  const w = GW, h = GH;
  const raw = Buffer.alloc(w * (h * 3 + 1));
  const col = { 0: [20, 20, 24], 1: [120, 60, 120], 2: [200, 150, 200], 3: [0, 0, 0], 4: [70, 187, 217], 5: [190, 190, 190], 6: [167, 112, 82], 7: [40, 140, 60], 8: [255, 220, 60], 9: [90, 90, 110], 10: [60, 60, 220] };
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = col[r.grid[gidx(x, y)]] || col[0];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcv = Buffer.alloc(4); crcv.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, crcv]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  const out = `${DIR}/room${r.s.room}.png`;
  fs.writeFileSync(out, png);
  return out;
}

function walk(mode, steps) {
  const r = loadRoom();
  const b0 = grab();
  r.meta.prevBuf = r.meta.prevBuf || b0;
  const me0 = playerPosFrom(b0);
  if (!me0) { console.log('player not found'); return; }
  r.meta.me = [me0.x, me0.y];
  r.meta.world = [r.meta.cam[0] + me0.x, r.meta.cam[1] + me0.y + FEET];
  paint(r, b0, r.meta.cam); markRobe(r, b0, r.meta.cam); markFeet(r, r.meta.cam, me0);
  const start = cellOf(...r.meta.world);
  let target = null;
  if (mode === 'plank') target = plankGoal(r);
  else if (mode === 'frontier') target = frontierGoal(r, start);
  else if (mode.startsWith('to')) target = cellOf(Number(mode.split(' ')[1]), Number(mode.split(' ')[2]));
  if (!target) { console.log('no reachable target for ' + mode); saveRoom(r); return; }
  let tgx = target[0], tgy = target[1];
  console.log(`walk ${mode}: cell ${start} -> ${tgx},${tgy}`);
  let blocked = 0;
  for (let i = 0; i < steps; i++) {
    const cur = cellOf(...r.meta.world);
    const path = bfs(r, cur, [tgx, tgy]);
    if (!path) { console.log(`step ${i}: no path from ${cur} to ${tgx},${tgy}`); break; }
    const next = path[1] || path[0];
    const dx = Math.sign(next[0] - cur[0]), dy = Math.sign(next[1] - cur[1]);
    const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : dy < 0 ? 'up' : null;
    if (!dir || path.length <= 2) {
      if (mode === 'frontier') {
        const f = frontierGoal(r, cur);
        if (!f) { console.log(`step ${i}: nothing further reachable is unmapped`); break; }
        tgx = f[0]; tgy = f[1];
        console.log(`step ${i}: reached that frontier, retargeting to ${tgx},${tgy}`);
        continue;
      }
      console.log(`step ${i}: arrived at ${cur}`);
      break;
    }
    const ms = Math.max(90, Math.min(150, Math.round((path.length * CELL) / 0.3))); // hold sized to the distance still to go
    const res = step(r, dir, ms);
    if (res.fade) { console.log(`step ${i}: fade (room transition in progress)`); continue; }
    if (res.transition) {
      saveRoom(r);
      r.s.room += 1;
      fs.writeFileSync(`${DIR}/current.json`, JSON.stringify(r.s));
      r.grid = new Uint8Array(GW * GH);
      r.meta = { cam: [0, 0], me: r.meta.me, world: r.meta.world, trail: [] };
      console.log(`step ${i}: ROOM CHANGE (align cost ${res.transition.toFixed(1)}) -> now mapping room ${r.s.room}`);
      let b = null;
      for (let k = 0; k < 6 && !b; k++) { sleep(400); const g = grab(); if (!dark(g) && playerPosFrom(g)) b = g; }
      if (!b) { console.log('frame never settled after the transition'); break; }
      const me = playerPosFrom(b);
      r.meta.prevBuf = b; r.meta.me = [me.x, me.y]; r.meta.world = [me.x, me.y + FEET];
      paint(r, b, r.meta.cam); markRobe(r, b, r.meta.cam); markFeet(r, r.meta.cam, me);
      if (mode === 'frontier') {
        const f = frontierGoal(r, cellOf(...r.meta.world));
        if (!f) { console.log('nothing further to map in this room'); saveRoom(r); break; }
        tgx = f[0]; tgy = f[1];
      }
      saveRoom(r);
      continue;
    }
    if (res.lost) { console.log(`step ${i}: player not found`); break; }
    if (res.moved < 6) markBlocked(r, cur, dir);
    blocked = res.moved < 6 ? blocked + 1 : 0;
    console.log(`step ${i}: ${dir} moved ${res.moved.toFixed(0)}px -> world ${r.meta.world.map(Math.round)} blocked=${blocked} path=${path.length}`);
    saveRoom(r);
    if (blocked > 3) { console.log(`stuck at cell ${cur} heading ${dir}: map said walkable, the game says no`); break; }
  }
  saveRoom(r);
  console.log(`saved ${statePath()}.bin, world ${r.meta.world.map(Math.round)}`);
}

const cmd = process.argv[2] || 'mark';
if (cmd === 'init') {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) if (/^room\d+/.test(f)) fs.rmSync(`${DIR}/${f}`);
  fs.rmSync(`${DIR}/current.json`, { force: true });
  fs.rmSync(`${DIR}/prev.bin`, { force: true });
  console.log('map cleared');
} else if (cmd === 'mark') {
  const r = loadRoom();
  const b = grab();
  r.meta.prevBuf = r.meta.prevBuf || b;
  const a = align(r.meta.prevBuf, b, null, r.meta.lastOff);
  r.meta.cam = [r.meta.cam[0] + a.dx, r.meta.cam[1] + a.dy];
  const me = playerPosFrom(b);
  r.meta.me = [me.x, me.y];
  r.meta.world = [r.meta.cam[0] + me.x, r.meta.cam[1] + me.y + FEET];
  r.meta.prevBuf = b;
  paint(r, b, r.meta.cam); markRobe(r, b, r.meta.cam); markFeet(r, r.meta.cam, me);
  saveRoom(r);
  console.log(`align dx ${a.dx} dy ${a.dy} cost ${a.cost.toFixed(1)} | world ${r.meta.world.map(Math.round)} | trail ${r.meta.trail.length}`);
} else if (cmd === 'show') {
  show(loadRoom());
} else if (cmd === 'png') {
  const r = loadRoom();
  const out = writePng(r);
  const filled = r.grid.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0);
  console.log(`${out} mapped cells ${filled} (${(100 * filled / (GW * GH)).toFixed(1)}%)`);
} else if (cmd === 'walk') {
  walk(process.argv[3] || 'frontier', Number(process.argv[4] || 60));
}
