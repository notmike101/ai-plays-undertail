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

// Capture geometry. The frame is 646x520 (646*520*4 = the grab's byte count): rows 0-37
// are the window title bar (flat 243 grey), rows 38+ are game content, x 0-643 content.
// Two bugs lived here: a window that ran to x=759 read past the end of every row and
// wrapped into the next one (map smeared, offset 133 cells east of me), and the grey title
// bar inside the window both painted a fake SPIKE band across every room and pinned align()
// to dx=0, because chrome never scrolls with the camera.
const CX0 = 2, CY0 = 40, CX1 = 641, CY1 = 517, CW = 646, CHF = 520;
// map geometry: 1 cell = 2 capture px, canvas is per-room
const CELL = 2, GW = 1600, GH = 1000, GOX = 800, GOY = 500;
const DIR = 'logs/map';
const BIN = 'logs/ocr/slam.bin';

// class codes. The pale rounded shapes are the SAME walkable floor, just drawn lighter -
// only colour-exact hazards (void, water, vine, spikes) count as solid from the picture;
// everything else that stops me gets recorded as BLOCKED by the walker itself.
const UNKNOWN = 0, FLOOR = 1, LIGHT = 2, VOID = 3, WATER = 4, SPIKE = 5, WOOD = 6, VINE = 7, PROVEN = 8, OTH = 9, BLOCKED = 10, BRICK = 11;
const CH = { 0: '?', 1: '.', 2: 'L', 3: 'k', 4: 'W', 5: 'S', 6: 'B', 7: 'v', 8: '*', 9: '#', 10: 'X', 11: 'b' };
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
  // The dark mortar colour only occurs in raised brick walls: sampled over the platform
  // that stopped me it is 22 % of the pixels, over walkable floor and the pale blobs 0 %.
  // The base purple is identical in both, so this is the only colour that separates wall.
  if (near(c, 132, 53, 125, 22)) return BRICK;
  if (near(c, 167, 112, 82, 26) || near(c, 112, 66, 56, 26)) return WOOD;
  if (c[1] > 150 && c[2] > 150 && c[0] < 170) return WATER;
  if (near(c, 55, 97, 138, 30)) return WATER;
  if (c[1] > 110 && c[1] > c[0] + 20 && c[1] > c[2] + 20) return VINE;
  if (c[0] > 168 && c[1] > 168 && c[2] > 168 && Math.abs(c[0] - c[2]) < 12) return SPIKE;
  return OTH;
}

// Camera offset of B relative to A. The Ruins brick pattern repeats every ~32 px, so a
// free search can lock onto a shifted copy of itself; the walker knows which key it pressed
// and for how long, so the search is a small window around that expected shift - closer
// than the pattern period, which makes aliasing impossible. A near-identical frame means the
// camera did not move at all (clamped, or I am pressed against something).
const UNIT = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };
const PXMS = 0.18; // measured walking speed in capture px per ms of held key
function align(A, B, dir = null, ms = 150) {
  const cost = (dx, dy) => {
    let s = 0, n = 0;
    for (let y = CY0 + 8; y < CY1 - 8; y += 6) for (let x = CX0 + 8; x < CX1 - 8; x += 6) {
      const xa = x + dx, ya = y + dy;
      if (xa < CX0 || xa > CX1 || ya < CY0 || ya > CY1) continue;
      s += Math.abs(luma(A, xa, ya) - luma(B, x, y)); n++;
    }
    return s / n;
  };
  const c0 = cost(0, 0);
  if (c0 < 2) return { dx: 0, dy: 0, cost: c0 };
  const pool = [];
  let exp = [0, 0];
  if (dir) {
    const u = UNIT[dir];
    exp = [Math.round(u[0] * ms * PXMS), Math.round(u[1] * ms * PXMS)];
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) pool.push([exp[0] + dx, exp[1] + dy, cost(exp[0] + dx, exp[1] + dy)]);
  } else {
    const cands = [];
    for (let dy = -56; dy <= 56; dy += 4) for (let dx = -56; dx <= 56; dx += 4) cands.push([dx, dy, cost(dx, dy)]);
    cands.sort((p, q) => p[2] - q[2]);
    for (let k = 0; k < Math.min(6, cands.length); k++) {
      const [bx, by] = cands[k];
      for (let dy = by - 3; dy <= by + 3; dy++) for (let dx = bx - 3; dx <= bx + 3; dx++) pool.push([dx, dy, cost(dx, dy)]);
    }
    pool.push([0, 0, c0]);
  }
  pool.sort((p, q) => p[2] - q[2]);
  const best = pool[0];
  // Near-ties need a tie-break: over a featureless floor almost every offset costs the same,
  // so when a key was pressed the honest choice is the shift that key implies (picking the
  // smallest instead froze my world position mid-room); with no key pressed, no shift.
  const tie = (c) => dir ? Math.abs(c[0] - exp[0]) + Math.abs(c[1] - exp[1]) : Math.abs(c[0]) + Math.abs(c[1]);
  let pick = best;
  // Only genuine near-ties get the tie-break (an absolute band, not a percentage: 6 % of a
  // textured mismatch is a big number). Over featureless floor every offset costs about the
  // same, so the key I pressed decides; when the frame really did not scroll, cost 0 wins.
  for (const c of pool) {
    if (c[2] > best[2] + 1.5) break;
    if (tie(c) < tie(pick)) pick = c;
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

// Only the BLUE sprite pixels lie about the map: my dress and an NPC's robe are the pool's
// colour and the brickwork carries the same purple. Head and hair classify as OTH, which
// paint already drops. A whole-body mask punched a 15x23-cell hole my walked-disc could not
// bridge, so BFS saw every room as a box sealed around me - hence "nothing left to map".
function paintMask(b) {
  const m = [];
  const p = playerPosFrom(b);
  if (p) m.push([p.x - 14, p.x + 12, p.y + 6, p.y + 45]); // the dress, not the whole body
  const { robe } = spriteBoxes(b);
  if (robe && robe[1] - robe[0] <= 44 && robe[3] - robe[2] <= 70 &&
      !(p && Math.abs((robe[0] + robe[1]) / 2 - p.x) < 24 && Math.abs((robe[2] + robe[3]) / 2 - p.y) < 40)) {
    m.push([robe[0] - 3, robe[1] + 3, robe[2] - 3, robe[3] + 3]);
  }
  return m;
}

const MW = Math.ceil((CX1 - CX0) / CELL) + 2, MH = Math.ceil((CY1 - CY0) / CELL) + 2;
const MORTAR = new Uint8Array(MW * MH);
function paint(r, b, cam) {
  const mask = paintMask(b);
  const inside = (x, y) => mask.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  for (let cy = 0, y = CY0; y <= CY1 - CELL; cy++, y += CELL) {
    for (let cx = 0, x = CX0; x <= CX1 - CELL; cx++, x += CELL) {
      let m = 0;
      for (let dy = -2; dy < 2; dy++) for (let dx = -2; dx < 2; dx++) if (classify(b, x + dx, y + dy) === BRICK) m++;
      MORTAR[cy * MW + cx] = m;
    }
  }
  for (let cy = 0, y = CY0; y <= CY1 - CELL; cy++, y += CELL) {
    for (let cx = 0, x = CX0; x <= CX1 - CELL; cx++, x += CELL) {
      let vote = {}, top = OTH, tn = 0;
      for (let dy = -2; dy < 2; dy++) for (let dx = -2; dx < 2; dx++) {
        const c = classify(b, x + dx, y + dy);
        vote[c] = (vote[c] || 0) + 1;
        if (vote[c] > tn) { tn = vote[c]; top = c; }
      }
      let msum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || nx < 0 || ny >= MH || nx >= MW) continue;
        msum += MORTAR[ny * MW + nx];
      }
      // A raised brick wall is the base purple crossed with mortar lines: 22 % of the
      // platform that stopped me is mortar, walkable floor and the pale blobs have none. The
      // lines have gaps, so the evidence is summed over the 3x3 neighbourhood - that turns
      // the texture into one solid mass instead of a porous dither the walker squeezes into.
      // WOOD is exempt: the plank I need to carry is brown with a dark outline.
      if (msum >= 14 && top !== WOOD) top = BRICK;
      if (inside(x, y)) continue; // sprites - me or an NPC - say nothing about the floor
      if (top === OTH) continue;  // unnameable colour
      const gx = GOX + Math.round((cam[0] + x) / CELL), gy = GOY + Math.round((cam[1] + y) / CELL);
      if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
      const i = gidx(gx, gy);
      if (r.grid[i] === BLOCKED) continue; // walls do not move; a tested wall survives repaints
      r.grid[i] = top;
    }
  }
}

// The tiles I have physically stood on, plus the ground my sprite is standing on: paint
// cannot see that ground (my sprite hides those pixels), so it stayed UNKNOWN in a band as
// wide as the sprite and BFS could never leave my own position - every room looked sealed.
// Anything the picture proves solid still wins over the assumption.
function markFeet(r, cam, me) {
  const [wx, wy] = [cam[0] + me.x, cam[1] + me.y + 13];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (dx * dx + dy * dy > 12) continue;
    const [gx, gy] = cellOf(wx + dx * CELL, wy + dy * CELL);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
    if (r.grid[gidx(gx, gy)] !== VOID) r.grid[gidx(gx, gy)] = PROVEN;
  }
  for (let dy = -2; dy <= 3; dy++) for (let dx = -9; dx <= 9; dx++) {
    const [gx, gy] = cellOf(wx + dx * CELL, wy + dy * CELL);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
    const i = gidx(gx, gy), v = r.grid[i];
    if (v === VOID || v === BRICK || v === WATER || v === VINE || v === SPIKE) continue;
    r.grid[i] = PROVEN;
  }
  r.meta.trail.push([Math.round(wx), Math.round(wy)]);
  if (r.meta.trail.length > 4000) r.meta.trail.splice(0, 2000);
}

// an NPC currently standing there is painted as an obstacle; a later frame paints over it
function markRobe(r, b, cam) {
  const mask = paintMask(b);
  if (mask.length < 2) return null;             // no separate NPC on screen
  const [robe] = mask.slice(1);
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
  if (top === VOID || top === WATER || top === VINE || top === SPIKE || top === BLOCKED || top === BRICK) return false;
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
      if (!passable(r, nx, ny)) continue;
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

// Cells I am allowed to try: named floor, or unknown ground touching floor I know. Unknown
// is passable on purpose - a failed step turns it into a recorded wall, which is how the
// room's real outline gets discovered, since colour alone cannot tell wall from floor here.
function passable(r, gx, gy) {
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return false;
  if (walkable(r, gx, gy)) return true;
  if (r.grid[gidx(gx, gy)] !== UNKNOWN) return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (walkable(r, gx + dx, gy + dy)) return true;
  return false;
}

// Frontier: unknown cells touching known floor, farthest first. Taking the farthest one I
// can actually reach is what stops the walker sawing between an unreachable target and one
// under my own feet.
function frontierList(r, start, skip) {
  const out = [];
  const R = 320;
  for (let gy = Math.max(1, start[1] - R); gy < Math.min(GH - 1, start[1] + R); gy++) {
    for (let gx = Math.max(1, start[0] - R); gx < Math.min(GW - 1, start[0] + R); gx++) {
      if (skip.has(gx + ',' + gy) || r.grid[gidx(gx, gy)] !== UNKNOWN) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (walkable(r, gx + dx, gy + dy)) { near = true; break; }
      }
      if (!near) continue;
      out.push([gx, gy, Math.abs(gx - start[0]) + Math.abs(gy - start[1])]);
    }
  }
  out.sort((a, b) => b[2] - a[2]);
  return out;
}

function pickFrontier(r, cur, tried) {
  for (const [gx, gy] of frontierList(r, cur, tried)) {
    const p = bfs(r, cur, [gx, gy]);
    if (!p || p.length <= 10) { tried.add(gx + ',' + gy); continue; } // unreachable, or closer than one key hold - that is how the sawing started
    return { t: [gx, gy], path: p };
  }
  return null;
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
  const a = align(r.meta.prevBuf || b, b, dir, ms);
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
  return { moved: d, cost: a.cost, world: [r.meta.cam[0] + me.x, r.meta.cam[1] + me.y] };
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
  const col = { 0: [20, 20, 24], 1: [120, 60, 120], 2: [200, 150, 200], 3: [0, 0, 0], 4: [70, 187, 217], 5: [190, 190, 190], 6: [167, 112, 82], 7: [40, 140, 60], 8: [255, 220, 60], 9: [90, 90, 110], 10: [60, 60, 220], 11: [95, 40, 95] };
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

// one runnable check of the parts that were wrong in interesting ways:
// node src/slam.mjs selftest
function selftest() {
  const ok = (cond, msg) => { if (!cond) { console.error('SELFTEST FAIL: ' + msg); process.exit(1); } };
  ok(CX1 < CW && CY1 < CHF && CX0 >= 0 && CY0 >= 0, 'capture window must fit inside the 646x520 frame');
  {
    // the title bar is flat 243 grey above row 38; inside the window it paints a fake grey
    // band across every room and pins align() to dx=0, because chrome never scrolls
    const b = Buffer.alloc(646 * 520 * 4);
    for (let y = 0; y < 38; y++) for (let x = 0; x < 646; x++) { const p = (y * 646 + x) * 4; b[p] = b[p + 1] = b[p + 2] = 243; }
    for (let y = 38; y < 520; y++) for (let x = 0; x < 646; x++) { const p = (y * 646 + x) * 4; b[p] = 164; b[p + 1] = 73; b[p + 2] = 163; }
    let grey = 0;
    for (let y = CY0; y < CY1; y++) for (let x = CX0; x < CX1; x++) if (classify(b, x, y) === SPIKE) grey++;
    ok(grey === 0, `window must exclude the title bar (${grey} grey cells)`);
  }
  {
    // raised brick walls are the same purple as the floor; only the mortar lines tell them
    // apart, and calling them floor is what sent the walker into a wall for four steps
    const b = Buffer.alloc(646 * 520 * 4);
    const put = (x, y, rgb) => { const p = (y * 646 + x) * 4; b[p] = rgb[2]; b[p + 1] = rgb[1]; b[p + 2] = rgb[0]; };
    for (let y = 40; y < 517; y++) for (let x = 2; x < 641; x++) put(x, y, [163, 73, 164]);
    for (let y = 40; y < 300; y++) for (let x = 300; x < 641; x++) if (y % 8 < 2 || (x + ((y >> 3) & 1) * 16) % 32 < 2) put(x, y, [132, 53, 125]);
    const rr = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], me: [0, 0], world: [0, 0], trail: [] } };
    paint(rr, b, [0, 0]);
    // mortar lines have gaps, so the property is "the walker cannot cross the platform",
    // not "every cell is solid": check the regions, not single cells
    let tot = 0, solid = 0;
    for (let gy = 530; gy < 640; gy++) for (let gx = 960; gx < 1090; gx++) { tot++; if (!walkable(rr, gx, gy)) solid++; }
    ok(solid > tot * 0.7, `mortared brick platform must be mostly solid (${solid}/${tot})`);
    let otot = 0, open = 0;
    for (let gy = 660; gy < 700; gy++) for (let gx = 820; gx < 900; gx++) { otot++; if (walkable(rr, gx, gy)) open++; }
    ok(open === otot, `flat purple floor must be fully walkable (${open}/${otot})`);
  }
  const mk = (shift) => {
    const b = Buffer.alloc(646 * 520 * 4);
    for (let y = 0; y < 520; y++) for (let x = 0; x < 646; x++) {
      const v = (((x + shift) >> 4) & 1) ? 190 : 70; // 32 px period, like the brick pattern
      const p = (y * 646 + x) * 4;
      b[p] = v; b[p + 1] = v >> 1; b[p + 2] = v; b[p + 3] = 255;
    }
    return b;
  };
  const A = mk(0), B = mk(17);
  const a = align(A, B, 'right', 120);
  ok(Math.abs(a.dx - 17) <= 1 && a.dy === 0, `windowed align on a 32 px periodic pattern gave ${a.dx},${a.dy} (expected 17+-1; a shifted copy of the pattern 32 px away is the trap)`);
  const same = align(A, A, 'right', 120);
  ok(same.dx === 0 && same.dy === 0, `identical frames gave ${same.dx},${same.dy}`);
  const r = { grid: new Uint8Array(GW * GH), meta: {} };
  for (let y = 490; y <= 520; y++) for (let x = 790; x <= 830; x++) r.grid[gidx(x, y)] = FLOOR;
  for (let y = 490; y <= 513; y++) for (let w = -1; w <= 1; w++) r.grid[gidx(810 + w, y)] = BLOCKED;
  const path = bfs(r, [795, 500], [825, 500]);
  ok(path && path.some((c) => c[1] >= 515), 'bfs did not route around the tested wall');
  ok(!(path && path.some((c) => c[0] >= 809 && c[0] <= 811 && c[1] <= 513)), 'bfs walked through a tested wall');
  const r2 = { grid: new Uint8Array(GW * GH), meta: {} };
  for (let y = 490; y <= 520; y++) for (let x = 790; x <= 830; x++) r2.grid[gidx(x, y)] = FLOOR;
  markBlocked(r2, [800, 500], 'right');
  ok(!walkable(r2, 806, 500), 'a failed step right did not leave a tested wall in front of me');
  ok(walkable(r2, 800, 500), 'markBlocked poisoned the cell I am standing on');
  console.log('selftest ok: align anti-aliasing, bfs routing around tested walls, blocked marking');
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
  const tried = new Set();
  let tgx = 0, tgy = 0;
  if (mode === 'frontier') {
    const p = pickFrontier(r, start, tried);
    if (!p) { console.log('nothing left to map that I can reach from here'); saveRoom(r); return; }
    tgx = p.t[0]; tgy = p.t[1];
  } else {
    let target = null;
    if (mode === 'plank') target = plankGoal(r);
    else if (mode.startsWith('to')) target = cellOf(Number(mode.split(' ')[1]), Number(mode.split(' ')[2]));
    if (!target) { console.log('no reachable target for ' + mode); saveRoom(r); return; }
    tgx = target[0]; tgy = target[1];
  }
  console.log(`walk ${mode}: cell ${start} -> ${tgx},${tgy}`);
  let blocked = 0, stuckEvents = 0;
  for (let i = 0; i < steps; i++) {
    const cur = cellOf(...r.meta.world);
    let path = bfs(r, cur, [tgx, tgy]);
    if (!path || path.length <= 10) {
      if (mode === 'frontier') {
        tried.add(tgx + ',' + tgy);
        const p = pickFrontier(r, cur, tried);
        if (!p) {
          // one wrong "wall" (a paused window, a camera clamp) can disconnect a whole room,
          // so before declaring it finished, test whether my recorded walls are the cause
          let cleared = 0;
          for (let k = 0; k < r.grid.length; k++) if (r.grid[k] === BLOCKED) { r.grid[k] = UNKNOWN; cleared++; }
          const q = cleared ? pickFrontier(r, cur, tried) : null;
          if (q) {
            tgx = q.t[0]; tgy = q.t[1];
            console.log(`step ${i}: my ${cleared} recorded walls disconnected the room - clearing them, retarget ${tgx},${tgy}`);
            continue;
          }
          console.log(`step ${i}: nothing further reachable is unmapped; room ${r.s.room} is walked out`);
          break;
        }
        tgx = p.t[0]; tgy = p.t[1];
        console.log(`step ${i}: new frontier target ${tgx},${tgy} (path ${p.path.length})`);
        continue;
      }
      console.log(`step ${i}: no path from ${cur} to ${tgx},${tgy}`);
      break;
    }
    const next = path[1] || path[0];
    const dx = Math.sign(next[0] - cur[0]), dy = Math.sign(next[1] - cur[1]);
    const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : dy < 0 ? 'up' : null;
    if (!dir) { console.log(`step ${i}: arrived at ${cur}`); break; }
    const ms = Math.max(90, Math.min(150, Math.round((path.length * CELL) / PXMS))); // hold sized to the distance still to go
    let res = step(r, dir, ms);
    if (res.moved < 6 && !res.lost && !res.fade && !res.transition) {
      // the game pauses when its window loses focus: a zero move is not evidence of a wall
      // until the key has provably landed, and marking a fake wall poisons the map
      sh(['focus']); sleep(250);
      const retry = step(r, dir, ms);
      if (retry.moved >= 6) { res = retry; console.log(`  refocused: ${dir} moved ${retry.moved.toFixed(0)}px after all`); }
    }
    if (process.env.TRACE) console.log(`  trace ${dir} ms=${ms} path=${path.length} target=${tgx},${tgy} cam=${r.meta.cam} off=${r.meta.lastOff} cost=${res.cost}`);
    if (res.fade) { console.log(`step ${i}: fade (room transition in progress)`); continue; }
    if (res.transition) {
      saveRoom(r);
      r.s.room += 1;
      fs.writeFileSync(`${DIR}/current.json`, JSON.stringify(r.s));
      r.grid = new Uint8Array(GW * GH);
      r.meta = { cam: [0, 0], me: r.meta.me, world: r.meta.world, trail: [] };
      console.log(`step ${i}: ROOM CHANGE (align cost ${res.transition.toFixed(1)}) -> now mapping room ${r.s.room}`);
      // a room change fades to black and reloads; that takes longer than a few grabs, and
      // giving up here would strand me in a room I never painted
      let b = null;
      for (let k = 0; k < 24 && !b; k++) { sleep(500); const g = grab(); if (!dark(g) && playerPosFrom(g)) b = g; }
      if (!b) { console.log('frame never settled after the transition; mapping it anyway'); b = grab(); if (!playerPosFrom(b)) break; }
      const me = playerPosFrom(b);
      r.meta.prevBuf = b; r.meta.me = [me.x, me.y]; r.meta.world = [me.x, me.y + FEET];
      paint(r, b, r.meta.cam); markRobe(r, b, r.meta.cam); markFeet(r, r.meta.cam, me);
      if (mode === 'frontier') {
        const p = pickFrontier(r, cellOf(...r.meta.world), new Set());
        if (!p) { console.log('nothing further to map in this room'); saveRoom(r); break; }
        tgx = p.t[0]; tgy = p.t[1];
      }
      saveRoom(r);
      continue;
    }
    if (res.lost) { console.log(`step ${i}: player not found`); break; }
    if (res.moved < 6) markBlocked(r, cur, dir);
    blocked = res.moved < 6 ? blocked + 1 : 0;
    console.log(`step ${i}: ${dir} moved ${res.moved.toFixed(0)}px -> world ${r.meta.world.map(Math.round)} blocked=${blocked} path=${path.length}`);
    saveRoom(r);
    if (blocked > 3) {
      // the wall in front is now recorded, so a route around it exists; quitting here is
      // what left half of every room unexplored
      stuckEvents++;
      blocked = 0;
      console.log(`stuck at cell ${cur} heading ${dir}: recorded a wall, re-targeting (attempt ${stuckEvents})`);
      if (stuckEvents > 3 || mode !== 'frontier') break;
      tried.add(tgx + ',' + tgy);
      const p = pickFrontier(r, cellOf(...r.meta.world), tried);
      if (!p) { console.log('no other frontier is reachable from here'); break; }
      tgx = p.t[0]; tgy = p.t[1];
    }
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
  const a = align(r.meta.prevBuf, b);
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
} else if (cmd === 'selftest') {
  selftest();
} else if (cmd === 'probe') {
  const r = loadRoom();
  const cur = cellOf(...r.meta.world);
  const list = frontierList(r, cur, new Set());
  let w = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (walkable(r, x, y)) w++;
  console.log(`me ${cur} walkable(me)=${walkable(r, cur[0], cur[1])} walkable cells ${w} frontier ${list.length}`, list.slice(0, 3));
  for (const [gx, gy] of list.slice(0, 5)) {
    const p = bfs(r, cur, [gx, gy]);
    console.log(`  frontier ${gx},${gy} path ${p ? p.length : 'none'}`);
  }
} else if (cmd === 'maskdbg') {
  const b = grab();
  const p = playerPosFrom(b);
  console.log('player', p && [p.x, p.y], 'mask', JSON.stringify(paintMask(b)));
  const S = '.123456789ab';
  for (let y = p.y - 40; y <= p.y + 40; y += 2) {
    let s = '';
    for (let x = p.x - 40; x <= p.x + 40; x += 2) s += S[classify(b, x, y)] || '?';
    console.log(y, s);
  }
}
