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

// A raw grab sometimes comes back TORN: the buffer is a vertical smear whose rows repeat, which
// silently poisons both align() (it happily "confirms" the stale camera against smeared scenery)
// and the sprite detector, so the recorded position drifts by hundreds of px. resync proved it
// happened here: "no saved room matches what I can see" in a room I had just mapped, while the
// colour shot shows the same room plainly. A healthy frame has hundreds of distinct scanlines; a
// smear has a couple of dozen.
function smearRows(b) {
  const seen = new Set();
  for (let y = 0; y < CHF; y += 3) {
    let h = 0;
    for (let x = 0; x < CW; x += 7) h = (h * 31 + b[(y * CW + x) * 4] + 3 * b[(y * CW + x) * 4 + 1] + 7 * b[(y * CW + x) * 4 + 2]) | 0;
    seen.add(h);
  }
  return seen.size;
}

function grab() {
  let last = 0;
  for (let t = 0; t < 4; t++) {
    sh(['raw', 'grab', BIN]);
    const b = fs.readFileSync(BIN);
    last = smearRows(b);
    if (last >= 40) return b; // a real smear repeats rows wholesale; a merely FLAT frame (this one:
    // 91 distinct scanlines, brick texture plus letterbox) must not be rejected, or every quiet room
    // would burn four grabs per step and then take the last one anyway.
    console.log(`the frame grab came back smeared (${last} distinct scanlines); grabbing again`);
  }
  sh(['raw', 'grab', BIN]); // four smears in a row: take it rather than stall, and say so
  console.log(`every frame grab came back smeared (${last} distinct scanlines); the map may drift from here`);
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
function samp(A, B, dx, dy) { // [mean luma delta, badly mismatched samples, samples]
  let s = 0, bad = 0, n = 0;
  for (let y = CY0 + 8; y < CY1 - 8; y += 6) for (let x = CX0 + 8; x < CX1 - 8; x += 6) {
    const xa = x + dx, ya = y + dy;
    if (xa < CX0 || xa > CX1 || ya < CY0 || ya > CY1) continue;
    const d = Math.abs(luma(A, xa, ya) - luma(B, x, y));
    s += d; if (d > 60) bad++; n++;
  }
  return [s / n, bad, n];
}
const cost = (A, B, dx, dy) => samp(A, B, dx, dy)[0];
const badFrac = (A, B, dx, dy) => { const [m, bad, n] = samp(A, B, dx, dy); return bad / (n || 1); };
function align(A, B, dir = null, ms = 150, sm = null) {
  const c0 = cost(A, B, 0, 0);
  if (c0 < 2) return { dx: 0, dy: 0, cost: c0 };
  const pool = [];
  let exp = [0, 0];
  if (dir) {
    const u = UNIT[dir];
    exp = [Math.round(u[0] * ms * PXMS), Math.round(u[1] * ms * PXMS)];
    // The held axis may have scrolled the scenery anywhere between 0 (camera clamped at the
    // room edge) and the commanded shift plus slack; the perpendicular axis barely moves.
    const ax = u[0] !== 0 ? 0 : 1;
    for (let p = -3; p <= 3; p++) {
      for (let a = Math.min(-2, exp[ax]); a <= Math.max(2, exp[ax]) + 14; a++) {
        const dx = ax === 0 ? a : p, dy = ax === 1 ? a : p;
        pool.push([dx, dy, cost(A, B, dx, dy)]);
      }
    }
    // Physics: my on-screen movement plus the scenery shift is how far I actually travelled,
    // and one key hold cannot exceed the speed model. Over featureless floor the pixel cost is
    // flat, so the tie-break happily chose the commanded shift even when the camera had CLAMPED
    // at the room edge and only my sprite moved - that double-counted my position and stretched
    // the map until two vine columns 205 px apart on screen sat 410 px apart on the grid.
    if (sm) {
      const maxMove = 1.15 * ms * PXMS;
      const ok = pool.filter((c) => Math.abs(c[0] + sm[0]) + Math.abs(c[1] + sm[1]) <= maxMove);
      if (ok.length) { pool.length = 0; pool.push(...ok); }
    }
  } else {
    const cands = [];
    for (let dy = -56; dy <= 56; dy += 4) for (let dx = -56; dx <= 56; dx += 4) cands.push([dx, dy, cost(A, B, dx, dy)]);
    cands.sort((p, q) => p[2] - q[2]);
    for (let k = 0; k < Math.min(6, cands.length); k++) {
      const [bx, by] = cands[k];
      for (let dy = by - 3; dy <= by + 3; dy++) for (let dx = bx - 3; dx <= bx + 3; dx++) pool.push([dx, dy, cost(A, B, dx, dy)]);
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
// Coarse-to-fine search over a window far wider than one step, for the case where the
// camera scrolled more than align() was willing to consider.
function wideAlign(A, B) {
  let best = [0, 0, 1e9];
  for (let dy = -128; dy <= 128; dy += 8) for (let dx = -128; dx <= 128; dx += 8) {
    const c = cost(A, B, dx, dy);
    if (c < best[2]) best = [dx, dy, c];
  }
  for (let dy = best[1] - 8; dy <= best[1] + 8; dy += 2) for (let dx = best[0] - 8; dx <= best[0] + 8; dx += 2) {
    const c = cost(A, B, dx, dy);
    if (c < best[2]) best = [dx, dy, c];
  }
  return { dx: best[0], dy: best[1], cost: best[2] };
}

// A real room change replaces the scenery, so almost every sample mismatches even at the best
// offset. Animated water and spikes (and a camera scroll that outran the window) only inflate
// the mean, which is how a mid-room step in the pool room got logged as a room change.
function classifyShift(A, B, dir, ms, sm = null) {
  const a = align(A, B, dir, ms, sm);
  if (a.cost <= 45) return { ...a, transition: 0 };
  const w = wideAlign(A, B);
  if (badFrac(A, B, w.dx, w.dy) > 0.45) return { dx: w.dx, dy: w.dy, cost: w.cost, transition: w.cost };
  return { ...w, transition: 0 };
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
  // the signature travels with the room: it is what lets a doorway I come back through
  // re-attach to the grid I already painted instead of starting a new room number
  if (r.meta.world) {
    r.meta.anchor = cellOf(r.meta.world[0], r.meta.world[1]);
    r.meta.land = landmarks(r, r.meta.anchor);
  }
  const meta = { ...r.meta };
  if (r.veto) meta.veto = [...r.veto]; // moves that failed three times outlive this walk
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
// The message box sits in the same band of the window every time: a black field with a white frame
// about 400x70 px. Two walks painted that rectangle - border, glyphs and all - into the grid as a
// false wing of the room. A pair of long, aligned white runs (top and bottom border) is the box; a
// single run is pale scenery and must not blank a region of the map.
function boxRect(b) {
  const runs = [];
  for (let y = CY0; y < 460; y += 2) {
    let run = 0, start = 0, best = null;
    for (let x = 0; x <= CX1; x++) {
      const p = (y * CW + x) * 4;
      if (b[p] > 200 && b[p + 1] > 200 && b[p + 2] > 200) { if (!run) start = x; run++; if (!best || run > best.len) best = { x0: start, len: run }; } else run = 0;
    }
    if (best && best.len >= 200) runs.push({ y, x0: best.x0, len: best.len });
  }
  for (const top of runs) for (const bot of runs) {
    if (bot.y <= top.y + 20 || bot.y > top.y + 220) continue;
    if (Math.abs(bot.x0 - top.x0) > 6 || Math.abs(bot.len - top.len) > 6) continue;
    return [top.x0, top.x0 + top.len, top.y, bot.y];
  }
  return null;
}
function paintMask(b) {
  const m = [];
  const p = playerPosFrom(b);
  if (p) m.push([p.x - 14, p.x + 12, p.y + 6, p.y + 45]); // the dress, not the whole body
  const { robe } = spriteBoxes(b);
  if (robe && robe[1] - robe[0] <= 44 && robe[3] - robe[2] <= 70 &&
      !(p && Math.abs((robe[0] + robe[1]) / 2 - p.x) < 24 && Math.abs((robe[2] + robe[3]) / 2 - p.y) < 40)) {
    m.push([robe[0] - 3, robe[1] + 3, robe[2] - 3, robe[3] + 3]);
  }
  const box = boxRect(b);
  if (box) m.push(box); // the message box is drawn over the room; it is not part of it
  return m;
}

const MW = Math.ceil((CX1 - CX0) / CELL) + 2, MH = Math.ceil((CY1 - CY0) / CELL) + 2;
const MORTAR = new Uint8Array(MW * MH);
// One frame of disagreement is texture, not geography: a cell whose class is already known keeps
// it until two separate frames agree on the new one.
const PCLASS = new Uint8Array(GW * GH), PCOUNT = new Uint8Array(GW * GH);
function rewriteOk(i, v, top) {
  if (v === UNKNOWN || v === VOID) return true; // first read of a cell is always allowed
  if (v === top) return false;
  if (PCLASS[i] === top) PCOUNT[i]++; else { PCLASS[i] = top; PCOUNT[i] = 1; }
  if (PCOUNT[i] < 2) return false;
  PCLASS[i] = 0; PCOUNT[i] = 0;
  return true;
}
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
      // PROVEN means my feet were on this cell. No colour vote may downgrade that to impassable;
      // a walkable verdict is still allowed to refine the picture.
      if (r.grid[i] === PROVEN && !WALK.has(top)) continue;
      // Known ground only changes when the picture repeats the change. walk24 reversed its route
      // every step (path 28 -> 40 cells, right/left forever) because the plateau lip resolved as
      // wall from one standing position and as floor from the other, so each paint deleted the
      // obstacle the previous paint had just created.
      if (!rewriteOk(i, r.grid[i], top)) continue;
      r.grid[i] = top;
    }
  }
  thinSeamsToFloor(r);
  stoodRepair(r);
  thinBrick(r, cam);
  thinDark(r, cam);
}

// The floor tiles are drawn with 1-2 px black seams, and black is exactly what VOID means
// here (the colour of a real pit or of the letterbox outside the room). Left in the grid the
// seams slice every corridor into pockets: bodyFit refuses a cell with known solid within 3
// cells sideways, and the gaps between seams are 6-7 cells, so nothing was reachable and the
// room read as walked out. Anything thinner than 4 cells in either direction is a seam.
const RUNH = new Int16Array(GW * GH), RUNV = new Int16Array(GW * GH);
function thinSeamsToFloor(r) {
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW;) {
      if (r.grid[gidx(x, y)] !== VOID) { x++; continue; }
      let e = x;
      while (e < GW && r.grid[gidx(e, y)] === VOID) e++;
      for (let q = x; q < e; q++) RUNH[gidx(q, y)] = e - x;
      x = e;
    }
  }
  for (let x = 0; x < GW; x++) {
    for (let y = 0; y < GH;) {
      if (r.grid[gidx(x, y)] !== VOID) { y++; continue; }
      let e = y;
      while (e < GH && r.grid[gidx(x, e)] === VOID) e++;
      for (let q = y; q < e; q++) RUNV[gidx(x, q)] = e - y;
      y = e;
    }
  }
  for (let i = 0, n = GW * GH; i < n; i++) {
    if (r.grid[i] === VOID && Math.min(RUNH[i], RUNV[i]) <= 3) r.grid[i] = FLOOR;
  }
}

// A footstep outranks a colour. This room draws its walkable floor with a flat brick-and-seam
// texture, so the colour vote stamped BRICK and VOID over ground I physically stood on (185 of
// 828 footfalls) and left 2 cells routable from my own position, inside a room I had walked
// across. Footfalls are ~13 cells apart, so repairing the exact cells is not enough: the grid is
// repaired along the swept path, claiming the collision box at every point of every trail
// segment. A wall cannot overlap the box I am standing in, so this is physical evidence, not a
// colour guess. Segments are applied incrementally (one per paint), and in full on `slam clean`.
function stoodRepair(r) {
  const t = r.meta.trail || [];
  const start = Math.max(1, r.meta.repaired || 1);
  for (let k = start; k < t.length; k++) {
    const a = cellOf(t[k - 1][0], t[k - 1][1]), b = cellOf(t[k][0], t[k][1]);
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let s = 0; s <= n; s++) {
      const cx = a[0] + Math.round((b[0] - a[0]) * s / n), cy = a[1] + Math.round((b[1] - a[1]) * s / n);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 12) continue; // the collision box, not the picture of my sprite
        const gx = cx + dx, gy = cy + dy;
        if (gx < 1 || gx >= GW - 1 || gy < 1 || gy >= GH - 1) continue;
        const i = gidx(gx, gy);
        if (WALK.has(r.grid[i])) continue;
        r.grid[i] = PROVEN;
      }
    }
  }
  r.meta.repaired = t.length;
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
    // BLOCKED belongs here: without it the feet band re-claims the very cells the failed
    // step just walled off, and BFS replans the same blocked direction forever
    if (v === VOID || v === BRICK || v === WATER || v === VINE || v === SPIKE || v === BLOCKED) continue;
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
// VOID is deliberately NOT here. The black outside a room is both the room outline and every
// doorway out of it, and a clearance rule against black made it impossible to path anywhere
// near an exit: no cell within 3 cells of the outline was routable, so a room I had fully
// painted had no frontier to probe and the walker quit inside it. Black is still not
// standable ground (walkable() keeps it out); it just does not shrink the corridor.
const SOLID = new Set([WATER, VINE, SPIKE, BLOCKED, BRICK]);
// My collision box is ~16 px = 8 cells across. Point pathing happily threads a 1-2 cell
// crack that my body cannot enter, which is how the walker pressed right into a wall over
// and over: BFS had a route, the game said no. Refuse any cell with ground I know is solid
// within 3 cells sideways - unknown ground is still allowed, that is how I discover edges.
// PROVEN is exempt: that is ground my collision box physically occupied, so the corridor there is
// known passable even when it is exactly body-width, which is how these corridors are drawn. The
// clearance rule only earns its keep on ground I have merely inferred from colour.
function bodyFit(r, gx, gy) {
  if (r.grid[gidx(gx, gy)] === PROVEN) return true;
  if (THIN[gidx(gx, gy)]) return true; // a <=3 cell band is probed by walking, not by clearance
  for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
    const i2 = gidx(gx + dx, gy + dy), v = r.grid[i2];
    // a probeable band must not disqualify the floor next to it, or nothing can reach it
    if (SOLID.has(v) && !(v === BRICK && THIN[i2])) return false;
  }
  return true;
}

// The direction the walker aims at comes from a lookahead point, not from the route, so it has to be
// re-checked against the graph the route was planned on: a vetoed move, a cell the grid calls solid,
// or a cell my collision box refuses are all off-limits even when they are the straight line to the
// lookahead.
const VEC = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
function legalAim(r, cur, dir) {
  const [dx, dy] = VEC[dir];
  if (r.veto && r.veto.has(`${cur[0]},${cur[1]}|${dir}`)) return false;
  return passable(r, cur[0] + dx, cur[1] + dy) && bodyFit(r, cur[0] + dx, cur[1] + dy);
}

// A BRICK band at most 3 cells thick is far more likely a misread shadow seam than a wall: this
// room's dark floor keeps being painted VOID and its edges BRICK, and one such band sealed my whole
// reachable area - walk34 reported no frontier at all while the colour shots show the wide room
// continuing one band away. Thin bands are made pressable: BFS may plan through them, my body then
// either moves (the cell was floor, footprints prove it) or fails (markBlocked makes the wall real).
// Thick brick masses keep the "raised wall" verdict the mortar rule earned.
// The band passes run over the painted window plus a margin, never the whole 1600x1000 canvas.
function winOf(cam) {
  const x0 = Math.max(1, GOX + Math.round((cam[0] + CX0) / CELL) - 8), x1 = Math.min(GW - 2, GOX + Math.round((cam[0] + CX1) / CELL) + 8);
  const y0 = Math.max(1, GOY + Math.round((cam[1] + CY0) / CELL) - 8), y1 = Math.min(GH - 2, GOY + Math.round((cam[1] + CY1) / CELL) + 8);
  return [x0, x1, y0, y1];
}

const THIN = new Uint8Array(GW * GH);
function thinBrick(r, cam) {
  const [x0, x1, y0, y1] = winOf(cam);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1;) {
      const i = gidx(x, y);
      THIN[i] = 0;
      if (r.grid[i] !== BRICK) { RUNH[i] = 0; x++; continue; }
      let e = x;
      while (e <= x1 && r.grid[gidx(e, y)] === BRICK) e++;
      const len = e > x1 ? 99 : e - x; // the band runs out of the window: assume it is thick
      for (let q = x; q < e; q++) RUNH[gidx(q, y)] = len;
      x = e;
    }
  }
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (r.grid[gidx(x, y)] !== BRICK) { RUNV[gidx(x, y)] = 0; continue; }
      let e = y;
      while (e <= y1 && r.grid[gidx(x, e)] === BRICK) e++;
      const len = e > y1 ? 99 : e - y;
      for (let q = y; q < e; q++) RUNV[gidx(x, q)] = len;
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = gidx(x, y);
    if (r.grid[i] === BRICK && Math.min(RUNH[i], RUNV[i]) <= 3) THIN[i] = 1;
  }
}

// A black band that ENDS inside the window is a shadowed doorway, not the outside: the room
// exterior and the letterbox run past the sampled window, while the gate between two rooms is
// drawn black and is only 10-25 cells wide. Only the frontier walker could ever step onto black
// (the short-path press), so `walk "to"` answered "no path" across a gate it had just crossed
// twice. A bounded band therefore gets the thin-brick treatment: BFS may plan through it, my body
// either crosses it (footprints then prove floor) or fails, and the three-strike veto takes the
// edge off the graph.
// Measured on the live grid: the gate between the octagon and the corridor is a 10-cell brick
// band (the vine column) beside a 28-cell black band, while the room exterior runs for hundreds.
const DARK_MAX = 40;
function thinDark(r, cam) {
  const [x0, x1, y0, y1] = winOf(cam);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1;) {
      if (r.grid[gidx(x, y)] !== VOID) { x++; continue; }
      const lim = Math.min(x + DARK_MAX + 1, GW - 1);
      let e = x;
      while (e < lim && r.grid[gidx(e, y)] === VOID) e++;
      if (e >= lim || r.grid[gidx(e, y)] === VOID || r.grid[gidx(x - 1, y)] === VOID) { x = e; continue; } // unbounded black
      for (let q = x; q < e; q++) THIN[gidx(q, y)] = 1;
      x = e;
    }
  }
}

const PREV = new Int32Array(GW * GH).fill(-2);
const QUEUE = new Int32Array(600000);
function bfs(r, start, goal, cap = 500000) {
  const [gx, gy] = goal; // goals are cell pairs, not flat indices
  const touched = [];
  let head = 0, tail = 0;
  const si = gidx(start[0], start[1]);
  PREV[si] = -1; touched.push(si); QUEUE[tail++] = si;
  let end = -1;
  while (head < tail) {
    const cur = QUEUE[head++];
    const x = cur % GW, y = (cur - x) / GW;
    // within 3 cells (6 px) of the target IS arrival. Frontier cells hug walls, and my own
    // collision box refuses the exact cell, so demanding it made whole unexplored regions
    // read as unreachable and the walk quit inside a half-mapped room.
    if (Math.abs(x - gx) + Math.abs(y - gy) <= 3) { end = cur; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // a move that failed three times in a row is not on the graph at all
      if (r.veto && r.veto.has(`${x},${y}|${dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up'}`)) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx >= GW - 1 || ny < 1 || ny >= GH - 1) continue;
      const ni = gidx(nx, ny);
      if (PREV[ni] !== -2) continue;
      if (!passable(r, nx, ny) || !bodyFit(r, nx, ny)) continue;
      PREV[ni] = cur; touched.push(ni); QUEUE[tail++] = ni;
      if (tail >= cap) break;
    }
  }
  let path = null;
  if (end >= 0) {
    path = [];
    for (let c = end; c >= 0; c = PREV[c]) path.push([c % GW, (c - (c % GW)) / GW]);
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
  if (THIN[gidx(gx, gy)]) return true; // a thin "brick" band is probed by stepping into it
  if (r.grid[gidx(gx, gy)] !== UNKNOWN) return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (walkable(r, gx + dx, gy + dy)) return true;
  return false;
}

// Reachability is ONE flood, not one bfs per frontier candidate. The old list searched only
// +-320 cells around me and sorted by straight-line distance, so the unexplored edge behind
// me - the side I had already walked away from, which is where the doorway out of room 3 was
// - was never even a candidate, and every candidate it did try sat behind a brick wall.
// Result: "nothing left to map" in a room with a third of it still UNKNOWN.
const REACH = new Int32Array(GW * GH).fill(-1);
const REACH_T = [];
function flood(r, start) {
  for (const t of REACH_T) REACH[t] = -1;
  REACH_T.length = 0;
  const si = gidx(start[0], start[1]);
  REACH[si] = 0; REACH_T.push(si);
  QUEUE[0] = si;
  let head = 0, tail = 1;
  while (head < tail) {
    const cur = QUEUE[head++];
    const x = cur % GW, y = (cur - x) / GW;
    const d = REACH[cur] + 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx >= GW - 1 || ny < 1 || ny >= GH - 1) continue;
      const ni = gidx(nx, ny);
      if (REACH[ni] !== -1 || !passable(r, nx, ny) || !bodyFit(r, nx, ny)) continue;
      REACH[ni] = d; REACH_T.push(ni); QUEUE[tail++] = ni;
    }
  }
  return REACH_T.length;
}

// The unexplored cell I can get within 6 px of, measured by real walking distance through this
// room rather than by crow-flies distance. Farthest-first was wrong on its own: the farthest cell
// sits ~560 cells away, painting reclassifies it long before I arrive, and the walk spent 20
// retargets per 300 steps without ever entering the corridor straight ahead. So: the farthest
// target I can actually finish (within FRONTIER_CAP of walking), and only if none is close
// enough, the farthest one there is.
const FRONTIER_CAP = 200; // cells of walking: one 150 ms hold covers ~13, so ~15 steps to arrive
function pickFrontier(r, cur, tried) {
  flood(r, cur);
  let best = null, bestNear = null;
  for (let gy = 1; gy < GH - 1; gy++) {
    for (let gx = 1; gx < GW - 1; gx++) {
      const i = gidx(gx, gy);
      // Black gaps count as unmapped ground too: in this art the way out of a room I have
      // completely painted is drawn as a black notch, so an UNKNOWN-only frontier strands the
      // walker inside a room it has fully seen. Each black target gets one honest try (the walk
      // adds it to `tried`), and a failed attempt records the wall, so probing the whole outline
      // costs one attempt per gap instead of one per cell.
      const v = r.grid[i];
      if ((v !== UNKNOWN && v !== VOID) || tried.has(gx + ',' + gy)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (walkable(r, gx + dx, gy + dy)) near = true;
      if (!near) continue;
      let ad = 4, d = -1;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const dd = Math.abs(dx) + Math.abs(dy);
        if (dd >= ad) continue;
        const v = REACH[gidx(gx + dx, gy + dy)];
        if (v >= 0) { ad = dd; d = v; }
      }
      if (ad > 3) continue;
      const dn = d + ad;
      if (!best || dn > best.d) best = { t: [gx, gy], d: dn };
      if (dn <= FRONTIER_CAP && (!bestNear || dn > bestNear.d)) bestNear = { t: [gx, gy], d: dn };
    }
  }
  const chosen = bestNear || best; // a finishable target beats the farthest one on the map
  if (!chosen) {
    // Before a room is called finished, repair the picture with the evidence my own feet carry.
    // walk36 quit at 104 steps with "nothing further reachable is unmapped"; running the same seam
    // and footprint passes afterwards (slam clean) found a frontier 34 cells away - the last paints
    // had stranded me in a pocket of cells painted solid under my own body.
    if (!r.meta.repairTried) {
      r.meta.repairTried = 1;
      thinSeamsToFloor(r);
      stoodRepair(r);
      thinBrick(r, r.meta.cam || [0, 0]);
      thinDark(r, r.meta.cam || [0, 0]);
      console.log('the map looked finished; repairing seams and footprints and looking again');
      return pickFrontier(r, cur, tried);
    }
    return null;
  }
  const p = bfs(r, cur, chosen.t);
  if (!p || p.length <= 10) { tried.add(chosen.t[0] + ',' + chosen.t[1]); return pickFrontier(r, cur, tried); } // closer than one key hold - that is how the sawing started
  return { t: chosen.t, path: p };
}

function plankGoal(r) {
  // A plank is an object, not a texture: take the biggest connected WOOD blob and aim at the cell of
  // it nearest me. The old test counted WOOD inside a 5x5 window (so at most 25 cells) and then
  // required more than 40 - it could never return a target, and the puzzle this room is built around
  // (carry a plank over the water) was never attempted.
  const seen = new Uint8Array(GW * GH);
  const [mx, my] = cellOf(...r.meta.world);
  let best = null, bn = 0;
  for (let s0 = 0; s0 < GW * GH; s0++) {
    if (r.grid[s0] !== WOOD || seen[s0]) continue;
    const st = [s0]; seen[s0] = 1;
    let n = 0, near = -1, nearCell = null, minx = GW, maxx = 0, miny = GH, maxy = 0;
    while (st.length) {
      const q = st.pop(); n++;
    const qx = q % GW, qy = (q - qx) / GW;
    if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
    if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
      const d = Math.abs(qx - mx) + Math.abs(qy - my);
      if (near < 0 || d < near) { near = d; nearCell = [qx, qy]; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const ni = gidx(nx, ny);
        if (!seen[ni] && r.grid[ni] === WOOD) { seen[ni] = 1; st.push(ni); }
      }
    }
    // ...but the blob has to be COMPACT. The census: 74,119 WOOD cells sit in TWO regions 829x195 and
    // 829x234 cells - wooden floor, walkable, and not something to carry - plus one 42-cell object.
    // A plank is a hand-sized prop, tens of cells long at most, so floor-sized regions are ineligible.
    if (n > bn && maxx - minx <= 40 && maxy - miny <= 40) { bn = n; best = nearCell; }
  }
  return bn >= 25 ? best : null;
}
// Room identity. Every transition used to mint a brand new grid, so walking back through a
// doorway gave me room 4, 5, 6... of the same corridor and the map remembered nothing.
// A room is signed by the offsets of its scenery landmarks (walls, water, spikes, planks,
// vines) relative to the cell I am standing on: the camera cannot change those offsets, and
// a few cells of alignment error are absorbed by the +-1 match tolerance.
function landmarks(r, cell, R = 60) {
  const out = [];
  for (let gy = cell[1] - R; gy <= cell[1] + R; gy++) {
    for (let gx = cell[0] - R; gx <= cell[0] + R; gx++) {
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const v = r.grid[gidx(gx, gy)];
      if (v === UNKNOWN || v === FLOOR || v === LIGHT || v === PROVEN || v === BLOCKED) continue;
      out.push([gx - cell[0], gy - cell[1]]);
    }
  }
  out.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  const cap = 120, step = Math.max(1, Math.ceil(out.length / cap));
  return out.filter((_, i) => i % step === 0);
}

// Pure so the selftest can drive it: rooms is [{room, anchor, land}]. Hypothesise a
// translation from a few landmark pairs, score it by how many of my landmarks land on one of
// theirs, and only call it the same room when a real majority agrees.
const lmSet = (arr) => new Set(arr.map(([x, y]) => x + ',' + y));
function lmScore(land, set, tx, ty) {
  let n = 0;
  for (const [x, y] of land) {
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) if (set.has(x + tx + dx + ',' + (y + ty + dy))) hit = true;
    if (hit) n++;
  }
  return n;
}
function matchRoom(land, rooms) {
  let best = null;
  for (const rm of rooms) {
    if (!rm.land || !rm.anchor || rm.land.length < 8 || land.length < 8) continue;
    const set = lmSet(rm.land);
    // Hypotheses come from a spread of each list, not the head of it: the nearest landmarks
    // all belong to whichever block happens to be closest, and two views of one room rarely
    // have the same block nearest, so the correct translation never gets proposed.
    const spread = (arr, k) => { const s = Math.max(1, Math.ceil(arr.length / k)); return arr.filter((_, i) => i % s === 0); };
    for (const pa of spread(land, 12)) {
      for (const pb of spread(rm.land, 12)) {
        const t = [pb[0] - pa[0], pb[1] - pa[1]];
        const n = lmScore(land, set, t[0], t[1]);
        if (!best || n > best.matches) best = { room: rm.room, t, matches: n, total: rm.total };
      }
    }
    if (best.room !== rm.room) continue;
    // sampled pairs pin the translation only to within a cell or two; hill-climb it whole cells
    const base = best.t;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const n = lmScore(land, set, base[0] + dx, base[1] + dy);
      if (n > best.matches) best = { room: rm.room, t: [base[0] + dx, base[1] + dy], matches: n, total: rm.total };
    }
  }
  // Most of the smaller landmark set has to agree: one shared wall is not a room, and that
  // is what keeps a genuinely new corridor from being folded into an old one.
  if (best && best.matches >= 8 && best.matches >= 0.55 * Math.min(land.length, best.total || land.length)) return best;
  return null;
}

const roomCatalog = () => fs.readdirSync(DIR)
  .map((f) => /^room(\d+)\.json$/.exec(f))
  .filter(Boolean)
  .map((m) => { const j = JSON.parse(fs.readFileSync(`${DIR}/room${m[1]}.json`)); return { room: +m[1], anchor: j.anchor, land: j.land, total: j.land ? j.land.length : 0 }; });

const sameFrame = (A, B) => {
  if (!A || A.length !== B.length) return false;
  for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) return false;
  return true;
};

// a failed step is the only real proof of a wall in this art style
function markBlocked(r, cell, dir) {
  const d = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[dir];
  // A zero-move step means the obstacle is at my collision box EDGE, about 8 px (4 cells)
  // ahead of my centre - and 1 cell marks crowd the 3x3 majority of the cell I am standing
  // on, which made my own tile read solid. So the mark spans the body edge outward, and it
  // may overwrite PROVEN, the assumption about the ground under my sprite. It previously
  // started 4 cells in and skipped PROVEN, so four "recorded walls" recorded nothing and
  // BFS replanned the identical route.
  for (let s = 4; s <= 16; s++) for (let w = -3; w <= 3; w++) {
    const gx = cell[0] + d[0] * s + (d[0] ? 0 : w), gy = cell[1] + d[1] * s + (d[1] ? 0 : w);
    if (gx < 1 || gx >= GW - 1 || gy < 1 || gy >= GH - 1) continue;
    const i = gidx(gx, gy);
    if (r.grid[i] === VOID || r.grid[i] === BLOCKED || r.grid[i] === PROVEN) continue; // my feet were there; a failed approach is not a wall
    r.grid[i] = BLOCKED;
  }
}
// A message box freezes my movement, and my sprite stays perfectly visible behind it, so the box
// is detected by its TEXT, not by the player going missing. walk18 and walk19 burned 411 steps
// reading "* There is another puzzle in this room. . ." over and over because this function bailed
// out as soon as it saw my sprite and never pressed the confirm key at all.
function boxText() { try { return (JSON.parse(execFileSync('node', ['src/play.mjs', 'text'], { stdio: 'pipe' }).toString()).text || '').trim(); } catch { return ''; } }
function clearBox(r) {
  let last = '';
  for (let k = 0; k < 4; k++) {
    const t = boxText();
    if (!t) break; // nothing on screen: the box is closed (or there never was one)
    if (t !== last) console.log(`on screen: ${t.replace(/\n/g, ' ')}`);
    last = t;
    sh(['press', 'z']);
    sleep(450);
  }
  const b = grab();
  const p = playerPosFrom(b);
  if (p) r.meta.prevBuf = b;
  return p;
}

// A single frame where my sprite cannot be found does not end a walk: retry, and report which
// kind of blank we are looking at (a fade in progress, or an animation frame that hides me).
function settlePlayer(r, tries = 6) {
  for (let k = 0; k < tries; k++) {
    if (k) sleep(400);
    const b = grab();
    if (dark(b) > 0.6) return { fade: true };
    const p = playerPosFrom(b);
    if (p) return { p, b };
  }
  return null;
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
  const me = playerPosFrom(b);
  if (!me) return { lost: true };
  // My own screen motion is the only thing that separates "the camera scrolled" from "the
  // camera clamped at the room edge and I walked instead"; align() cannot tell the two apart
  // over flat featureless floor, and getting it wrong doubles my recorded position.
  const sm = [me.x - me0[0], me.y - me0[1]];
  const a = classifyShift(r.meta.prevBuf || b, b, dir, ms, sm);
  if (a.transition) return { transition: a.transition };
  // Physics bound. My world position is cam + my screen position, so the camera shift plus my own
  // screen motion has to add up to what the held key could actually move me. A 35 ms hold that
  // reports 273 px is the align locking onto a copy of the repeating brick pattern several tiles
  // away, and painting such a frame stamps a false patch of walked floor far from where I stand.
  const phys = 1.25 * ms * PXMS + 8;
  const claimed = Math.hypot(a.dx + sm[0], a.dy + sm[1]);
  if (claimed > phys) {
    console.log(`align claims ${Math.round(claimed)} px of travel from a ${ms} ms hold (max ${Math.round(phys)}): treating the camera as clamped`);
    a.dx = 0; a.dy = 0;
    // if my sprite anchor jumped by an impossible amount too, refuse the frame rather than smear it
    if (Math.hypot(sm[0], sm[1]) > phys) return { lost: true };
  }
  r.meta.lastOff = [a.dx, a.dy];
  r.meta.cam = [before[0] + a.dx, before[1] + a.dy];
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
  // one character per cell: the stride this used to take (6/CELL*2) shrank the view to 14x9 cells
  // once CELL became 0.5, which hid exactly the walls and gaps it was meant to reveal.
  for (let y = gy - 24; y <= gy + 24; y++) {
    let line = '';
    for (let x = gx - 60; x <= gx + 60; x++) {
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
    // Animated water and spikes inflate the mean pixel cost without replacing the scenery,
    // and a camera scroll bigger than the align window did the same: both were logged as
    // ROOM CHANGE, which threw away a mapped room mid-walk. Decide by the fraction of
    // badly mismatched samples, and recover the scroll with a wide search.
    const base = Buffer.alloc(646 * 520 * 4);
    for (let y = 0; y < 520; y++) for (let x = 0; x < 646; x++) {
      const v = ((x * 7 + y * 131) ^ (x >> 2)) & 255, p = (y * 646 + x) * 4;
      base[p] = v; base[p + 1] = v >> 1; base[p + 2] = v; base[p + 3] = 255;
    }
    const anim = Buffer.from(base); // the same room; one patch of water rippled
    for (let y = 100; y < 180; y++) for (let x = 100; x < 300; x++) { const p = (y * 646 + x) * 4; anim[p] = anim[p + 1] = anim[p + 2] = 250; }
    const same = classifyShift(base, anim, 'right', 150);
    ok(!same.transition, `animated scenery read as a room change (cost ${same.cost.toFixed(1)})`);
    ok(same.dx === 0, `the camera scroll was not recovered by the wide search (dx ${same.dx})`);
    const other = Buffer.alloc(646 * 520 * 4); // a different room entirely
    for (let y = 0; y < 520; y++) for (let x = 0; x < 646; x++) {
      const v = ((x * 37 + y * 13) ^ (y >> 3)) & 255, p = (y * 646 + x) * 4;
      other[p] = v; other[p + 1] = v; other[p + 2] = v; other[p + 3] = 255;
    }
    ok(classifyShift(base, other, 'right', 150).transition > 0, 'a replaced frame was not seen as a room change');
    // The scale bug, in the exact conditions that caused it: scenery whose pixel cost is flat
    // over a shift of one commanded step (brick/stripes repeat), plus an animated patch, plus
    // a camera that had CLAMPED so only my sprite moved. The tie-break then chose the
    // commanded shift and my recorded position advanced twice as fast as I walked.
    const stripes = Buffer.alloc(646 * 520 * 4);
    for (let y = 0; y < 520; y++) for (let x = 0; x < 646; x++) {
      const v = x % 27 < 4 ? 200 : 120, p = (y * 646 + x) * 4;
      stripes[p] = v; stripes[p + 1] = v >> 1; stripes[p + 2] = v; stripes[p + 3] = 255;
    }
    const rippled = Buffer.from(stripes);
    for (let y = 200; y < 260; y++) for (let x = 120; x < 320; x++) { const p = (y * 646 + x) * 4; rippled[p] = rippled[p + 1] = rippled[p + 2] = 250; }
    const clamped = classifyShift(stripes, rippled, 'right', 150, [27, 0]);
    ok(Math.abs(clamped.dx) <= 6, `a clamped camera was read as a ${clamped.dx} px scenery scroll (this stretched the map 2x)`);
    const free = classifyShift(stripes, rippled, 'right', 150, [0, 0]);
    ok(free.dx >= 20, `my sprite did not move, so the scenery should count as scrolled (dx ${free.dx})`);
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
  {
    // a move that failed three times must leave the routing graph, otherwise the walker presses
    // into the same ledge lip until its step budget runs out
    const p0 = bfs(r, [795, 500], [825, 500]);
    const [nx, ny] = p0[1];
    const d0 = nx > 795 ? 'right' : nx < 795 ? 'left' : ny > 500 ? 'down' : 'up';
    r.veto = new Set([`795,500|${d0}`]);
    const p1 = bfs(r, [795, 500], [825, 500]);
    ok(!p1 || !(p1[1][0] === nx && p1[1][1] === ny), `the vetoed first move ${d0} was still planned`);
    r.veto = null;
  }
  const r2 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
  for (let y = 490; y <= 520; y++) for (let x = 790; x <= 830; x++) r2.grid[gidx(x, y)] = FLOOR;
  markBlocked(r2, [800, 500], 'right');
  ok(!walkable(r2, 810, 500), 'a failed step right did not leave a tested wall in front of me');
  ok(walkable(r2, 800, 500), 'markBlocked poisoned the cell I am standing on');
  ok(walkable(r2, 802, 500), 'markBlocked reached inside my own collision box');
  // the next frame re-marks the ground under my sprite; that must not undo a wall I have
  // physically walked into, or BFS replans the same blocked direction forever
  markFeet(r2, [0, 0], { x: 0, y: -FEET });
  ok(!walkable(r2, 806, 500), 'the feet band erased a wall I had physically tested');
  ok(walkable(r2, 800, 500), 'the feet band erased the cell I am standing on');
  {
    // a 4-cell (8 px) crack in a tested wall: point pathfinding threads it, my 16 px body
    // does not fit, and that is exactly the route that made the walker press into a wall
    const r3 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 480; y <= 530; y++) for (let x = 780; x <= 840; x++) r3.grid[gidx(x, y)] = FLOOR;
    for (let y = 480; y <= 530; y++) if (y < 498 || y > 501) for (let w = 0; w <= 1; w++) r3.grid[gidx(810 + w, y)] = BLOCKED;
    ok(!bfs(r3, [795, 500], [825, 500]), 'bfs planned through a crack my collision box cannot fit');
  }
  {
    // Room identity: coming back through a doorway used to mint room 4, 5, 6... of the same
    // corridor, so nothing I had learned survived. Scenery offsets relative to my own cell are
    // camera-proof, so they identify the room and tell me which cell I landed on.
    const mk = (pat) => {
      const g = new Uint8Array(GW * GH);
      for (const [x, y, v, w, h] of pat) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) g[gidx(x + dx, y + dy)] = v;
      return g;
    };
    const cellA = cellOf(0, 0);
    const rA = { grid: mk([[GOX - 30, GOY - 20, BRICK, 10, 10], [GOX + 10, GOY + 5, WATER, 10, 10], [GOX - 5, GOY + 25, SPIKE, 10, 10]]), meta: {} };
    const landA = landmarks(rA, cellA);
    // the same room entered from the other side: every landmark sits 25 cells east, 12 north
    const rB = { grid: mk([[GOX - 5, GOY - 32, BRICK, 10, 10], [GOX + 35, GOY - 7, WATER, 10, 10], [GOX + 20, GOY + 13, SPIKE, 10, 10]]), meta: {} };
    const hit = matchRoom(landmarks(rB, cellOf(0, 0)), [{ room: 3, anchor: cellA, land: landA, total: landA.length }]);
    ok(hit && hit.room === 3 && hit.t[0] === -25 && hit.t[1] === 12, `re-entry did not re-attach to room 3 (${hit ? JSON.stringify(hit) : 'no match'})`);
    // a different room must not match, even though one bar of scenery is the same shape class
    const rC = { grid: mk([[GOX - 40, GOY - 3, WATER, 4, 30], [GOX + 8, GOY - 2, VINE, 30, 4]]), meta: {} };
    ok(!matchRoom(landmarks(rC, cellOf(0, 0)), [{ room: 3, anchor: cellA, land: landA, total: landA.length }]), 'a different room matched room 3');
  }
  {
    // The floor tiles' 1-2 px black seams classify as VOID, the same value a real pit gets, so
    // they were painted as pits: they broke the scenery signature and, while the clearance rule
    // still counted black as solid, they cut corridors my body could not cross.
    const r4 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 480; y <= 530; y++) for (let x = 780; x <= 860; x++) r4.grid[gidx(x, y)] = FLOOR;
    for (let y = 480; y <= 530; y++) { r4.grid[gidx(810, y)] = VOID; r4.grid[gidx(816, y)] = VOID; }
    for (let y = 495; y <= 510; y++) for (let x = 840; x <= 855; x++) r4.grid[gidx(x, y)] = VOID; // a genuine pit
    thinSeamsToFloor(r4);
    ok(r4.grid[gidx(813, 500)] === FLOOR, 'the seam cleanup left a thin seam painted as a pit');
    ok(bfs(r4, [790, 500], [830, 500]), 'the seam-cut corridor is still not routable');
    ok(r4.grid[gidx(847, 502)] === VOID, 'the cleanup erased a real pit');
    ok(!bfs(r4, [790, 500], [847, 502]), 'the walker paths through the middle of a real pit');
  }
  {
    // walk34 reported "no frontier" in a room the colour shots show continuing one band away: the
    // dark plateau floor had been painted VOID and its EDGES BRICK, and bodyFit refuses anything
    // within 3 cells of brick, so a 2-cell band sealed my whole reachable area. A thin brick band
    // must be steppable-into (a failed step then makes the wall real); a thick one must stay solid.
    const r4b = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 480; y <= 520; y++) for (let x = 780; x <= 880; x++) r4b.grid[gidx(x, y)] = FLOOR;
    for (let y = 460; y <= 540; y++) for (let x = 810; x <= 811; x++) r4b.grid[gidx(x, y)] = BRICK; // 2 cells thick, full height
    for (let y = 460; y <= 540; y++) for (let x = 850; x <= 855; x++) r4b.grid[gidx(x, y)] = BRICK; // 6 cells thick, full height
    const camx = 2 * (830 - GOX) - (CX0 + CX1) / 2, camy = 2 * (500 - GOY) - (CY0 + CY1) / 2;
    thinBrick(r4b, [camx, camy]);
    ok(THIN[gidx(810, 500)] === 1, 'a 2-cell brick band was not treated as probeable');
    ok(THIN[gidx(852, 500)] === 0, 'a 6-cell brick wall was treated as probeable');
    ok(bfs(r4b, [795, 500], [820, 500]), 'bfs still refused to cross the thin band');
    ok(!bfs(r4b, [795, 500], [870, 500]), 'bfs now walks through a real raised wall');
  }
  {
    // `walk "to"` answered "no path" across a gate the frontier walk crossed twice without
    // trouble: the doorway between two rooms is drawn BLACK, bfs cannot stand on black, and only
    // the frontier press ever stepped onto it. A bounded black band is a shadowed gate and must be
    // probeable; black that runs past the window (the room exterior, the letterbox) must not be.
    const r9 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 480; y <= 520; y++) for (let x = 780; x <= 960; x++) r9.grid[gidx(x, y)] = FLOOR;
    for (let y = 460; y <= 540; y++) for (let x = 850; x <= 869; x++) r9.grid[gidx(x, y)] = VOID; // a 20-cell gate
    const cx9 = 2 * (860 - GOX) - (CX0 + CX1) / 2, cy9 = 2 * (500 - GOY) - (CY0 + CY1) / 2;
    thinBrick(r9, [cx9, cy9]); // production order: the brick pass rebuilds THIN in the window
    thinDark(r9, [cx9, cy9]);
    ok(THIN[gidx(855, 500)] === 1, 'a 20-cell black gate was not made probeable');
    ok(bfs(r9, [800, 500], [900, 500]), 'bfs still refused to cross a black gate the game walks through');
    for (let y = 460; y <= 540; y++) for (let x = 850; x <= 869; x++) r9.grid[gidx(x, y)] = FLOOR;
    for (let y = 460; y <= 540; y++) for (let x = 850; x <= 949; x++) r9.grid[gidx(x, y)] = VOID; // 100 cells: the outside
    thinBrick(r9, [cx9, cy9]);
    thinDark(r9, [cx9, cy9]);
    ok(THIN[gidx(860, 500)] === 0, 'a 100-cell black region was made probeable');
    ok(!bfs(r9, [800, 500], [930, 500]), 'bfs crosses a 100-cell black region');
  }
  {
    // The walker aims 8 cells down the route, so it can point at the very move the route exists to
    // avoid: walk35 sawed left out of 875,700 for 34 re-targets after that edge was vetoed at step 153.
    const r6 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 490; y <= 510; y++) for (let x = 790; x <= 830; x++) r6.grid[gidx(x, y)] = FLOOR;
    r6.veto = new Set(['810,500|left']);
    ok(legalAim(r6, [810, 500], 'right'), 'a plain floor move was refused');
    ok(!legalAim(r6, [810, 500], 'left'), 'a vetoed move was aimed into anyway');
    for (let y = 490; y <= 510; y++) for (let x = 806; x <= 809; x++) r6.grid[gidx(x, y)] = BRICK; // 4 wide: a lone brick cell reads floor by 3x3 majority, and a 3-wide band is THIN
    r6.veto = null;
    ok(!legalAim(r6, [810, 500], 'left'), 'a move into painted brick was aimed into anyway');
  }
  {
    // Frontier cells hug walls. The exact cell fails my collision box, so requiring bfs to
    // stand on it made every wall-side frontier unreachable and the walk declared a
    // half-mapped room finished. Arriving 6 px away is arrival.
    const r5 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 490; y <= 520; y++) for (let x = 780; x <= 828; x++) r5.grid[gidx(x, y)] = FLOOR;
    for (let y = 485; y <= 525; y++) r5.grid[gidx(831, y)] = BRICK; // exactly 3 cells off the goal, which is what bodyFit refuses
    ok(walkable(r5, 828, 500) && !bodyFit(r5, 828, 500), 'the wall-side goal was not the intended impossible cell');
    ok(bfs(r5, [790, 500], [828, 500]), 'bfs refused a goal it can stand 6 px away from');
    ok(!bfs(r5, [790, 500], [840, 500]), 'bfs walked through a brick wall to get near a goal');
  }
  {
    // The old frontier list only looked +-320 cells around me and ranked by crow-flies
    // distance, so the unexplored edge behind me - where the doorway out of room 3 actually
    // was - was never a candidate, and the walk declared a half-mapped room finished.
    // Candidates now come from one reachability flood over the whole grid.
    const r6 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 508; y <= 513; y++) for (let x = 700; x <= 1100; x++) r6.grid[gidx(x, y)] = FLOOR;
    const p = pickFrontier(r6, [720, 510], new Set());
    ok(p && p.path.length <= FRONTIER_CAP + 30, `the walker picked a target it cannot finish in one go (${p && p.path.length})`);
    ok(p && p.t[0] > 870, `the capped pick did not head for unexplored ground (${p ? p.t : 'none'})`);
    // ... and nothing gets abandoned: once the reachable edge is tried, the far edge is still taken.
    const tried = new Set();
    for (let x = 700; x <= 950; x++) { tried.add(x + ',507'); tried.add(x + ',514'); }
    for (let y = 505; y <= 517; y++) { tried.add('699,' + y); tried.add('698,' + y); }
    const q = pickFrontier(r6, [720, 510], tried);
    ok(q && q.t[0] > 1040, `with the near edge tried, the far edge behind me was abandoned (${q ? q.t : 'none'})`);
    ok(q && q.path.length > 320, `the route to the far edge was not the long way around (${q && q.path.length})`);
  }
  {
    // A room I have completely painted has no UNKNOWN left, yet its way out is drawn as a black
    // notch in the wall: an UNKNOWN-only frontier strands me inside a room I have fully seen.
    const r7 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 500; y <= 540; y++) for (let x = 780; x <= 860; x++) r7.grid[gidx(x, y)] = FLOOR;
    for (let y = 480; y <= 560; y++) for (let x = 760; x <= 880; x++) if (x < 780 || x > 860) r7.grid[gidx(x, y)] = VOID;
    for (let y = 480; y <= 499; y++) for (let x = 780; x <= 860; x++) r7.grid[gidx(x, y)] = VOID;
    for (let y = 541; y <= 560; y++) for (let x = 780; x <= 860; x++) r7.grid[gidx(x, y)] = VOID;
    const p2 = pickFrontier(r7, [820, 520], new Set());
    ok(p2 && r7.grid[gidx(p2.t[0], p2.t[1])] === VOID, `a fully painted room offered no frontier at all (${p2 ? p2.t : 'none'})`);
    for (let y = 480; y <= 560; y++) for (let x = 775; x <= 865; x++) if (r7.grid[gidx(x, y)] === VOID) r7.grid[gidx(x, y)] = BLOCKED;
    ok(!pickFrontier(r7, [820, 520], new Set()), 'a room whose whole outline is a tested wall still wants exploring');
  }
  {
    // A smeared grab (rows repeating) is what let align confirm a stale camera against scenery that
    // was never in the frame: resync later found NO saved room matching a room I had just mapped.
    const healthy = Buffer.alloc(646 * 520 * 4);
    for (let y = 0; y < 520; y++) for (let x = 0; x < 646; x++) { const p = (y * 646 + x) * 4; healthy[p] = (x * 3 + y * 5) & 255; healthy[p + 1] = (x + y * 11) & 255; healthy[p + 2] = (x * 7) & 255; }
    const smear = Buffer.alloc(646 * 520 * 4);
    for (let y = 0; y < 520; y++) { const yy = y % 4; for (let x = 0; x < 646; x++) { const p = (y * 646 + x) * 4; smear[p] = (x * 3 + yy * 5) & 255; smear[p + 1] = (x + yy * 11) & 255; smear[p + 2] = (x * 7) & 255; } }
    ok(smearRows(healthy) >= 100, `a varied frame was called smeared (${smearRows(healthy)})`);
    ok(smearRows(smear) < 100, 'a repeating-scanline smear was accepted as a frame');
  }
  {
    // The census of the mapped area: 74,119 WOOD cells in TWO regions 829x195 and 829x234 cells (real
    // wooden floor), and one 42-cell object. plankGoal must chase the object, not the floor it is on.
    const r7 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [], world: [0, 0] } };
    for (let x = 0; x < GW; x++) for (let y = 495; y <= 505; y++) r7.grid[gidx(x, y)] = WOOD; // a wooden floor region, full width
    for (let x = 820; x <= 831; x++) for (let y = 520; y <= 524; y++) r7.grid[gidx(x, y)] = WOOD; // a plank, 12x5
    const g7 = plankGoal(r7);
    ok(g7 && g7[0] >= 820 && g7[0] <= 831 && g7[1] >= 520 && g7[1] <= 524, `plankGoal chased the floor region instead of the plank (${g7})`);
    r7.grid.fill(0);
    for (let x = 0; x < GW; x++) for (let y = 495; y <= 505; y++) r7.grid[gidx(x, y)] = WOOD;
    ok(plankGoal(r7) === null, 'a whole grid of wooden floor still offered a plank target');
  }
  {
    // A footstep outranks a colour. This room draws its walkable floor with a flat brick-and-seam
    // texture, so the colour vote stamped BRICK and VOID over ground I physically stood on (185 of
    // 828 footfalls) and left 2 cells routable from my own position. The trail repairs that, and a
    // failed approach may not wall off a cell my feet have occupied.
    const r8 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [[400, 0], [402, 0], [412, 0]] } };
    for (let y = 490; y <= 510; y++) for (let x = 980; x <= 1030; x++) r8.grid[gidx(x, y)] = BRICK;
    r8.grid[gidx(1001, 500)] = VOID; // a black seam over a cell I stood on
    stoodRepair(r8);
    ok(r8.grid[gidx(1000, 500)] === PROVEN && r8.grid[gidx(1001, 500)] === PROVEN, 'my own footprints did not overrule the colour vote');
    ok(r8.grid[gidx(1010, 505)] === BRICK, 'stoodRepair erased walls I never stood on');
    markBlocked(r8, [1000, 500], 'left');
    ok(r8.grid[gidx(996, 500)] === BLOCKED, 'the blocked fan recorded nothing again');
    ok(r8.grid[gidx(997, 500)] === PROVEN, 'a failed approach walled off a cell my feet had occupied');
  }
  {
    // A corridor exactly my body width is passable when I have walked it. The +-3 clearance rule
    // exists to stop BFS threading cracks inferred from colour; applied to PROVEN ground it made
    // every swept corridor one cell wide, and the walker sawed left/right along its own trail.
    const r9 = { grid: new Uint8Array(GW * GH), meta: { cam: [0, 0], trail: [] } };
    for (let y = 495; y <= 505; y++) { r9.grid[gidx(790, y)] = BRICK; r9.grid[gidx(798, y)] = BRICK; }
    for (let y = 496; y <= 504; y++) r9.grid[gidx(794, y)] = PROVEN; // the thread my feet took
    ok(bodyFit(r9, 794, 500), 'a cell my collision box occupied still demanded clearance');
    ok(bfs(r9, [794, 496], [794, 504]), 'the walked thread was not routable');
    ok(!bodyFit(r9, 795, 500), 'an inferred cell beside a wall was accepted without clearance');
  }
  {
    // the flip-flop that reversed a route every step: known ground must survive one disagreeing
    // frame and only move when two frames agree
    const i = gidx(900, 600);
    ok(rewriteOk(i, UNKNOWN, FLOOR), 'the first read of a cell was blocked');
    ok(!rewriteOk(i, FLOOR, SPIKE), 'one disagreeing frame rewrote known ground');
    ok(rewriteOk(i, FLOOR, SPIKE), 'two agreeing frames did not allow the rewrite');
    ok(!rewriteOk(i, FLOOR, SPIKE), 'the pending count was not reset after a rewrite');
  }
  {
    // the box that got painted into the map: a black field with a white frame and white glyphs,
    // drawn in the same band every time. It is not scenery and must never reach the grid.
    const f = Buffer.alloc(CW * CHF * 4);
    for (let y = 0; y < CHF; y++) for (let x = 0; x < CW; x++) { const p = (y * CW + x) * 4; f[p] = f[p + 1] = f[p + 2] = 120; }
    for (let y = 60; y <= 130; y++) for (let x = 50; x <= 450; x++) { const p = (y * CW + x) * 4; f[p] = f[p + 1] = f[p + 2] = (y === 60 || y === 130 || x === 50 || x === 450) ? 255 : 0; }
    const rct = boxRect(f);
    ok(rct && Math.abs(rct[0] - 50) <= 2 && Math.abs(rct[1] - 451) <= 3 && Math.abs(rct[2] - 60) <= 2 && Math.abs(rct[3] - 130) <= 3, `boxRect on a drawn box gave ${rct}`);
    const decoy = Buffer.alloc(CW * CHF * 4);
    for (let y = 0; y < CHF; y++) for (let x = 0; x < CW; x++) { const p = (y * CW + x) * 4; decoy[p] = decoy[p + 1] = decoy[p + 2] = 120; }
    for (let x = 100; x <= 400; x++) { const p = (200 * CW + x) * 4; decoy[p] = decoy[p + 1] = decoy[p + 2] = 255; }
    ok(boxRect(decoy) === null, 'a single pale edge was mistaken for a message box');
  }
  console.log('selftest ok: align anti-aliasing, transition classifier, seam cleanup, bfs arrival, frontier reach and cap, blocked marking, footprint evidence, body-width lanes, room identity, paint hysteresis, message box mask');
}

function walk(mode, steps) {
  const r = loadRoom();
  const b0 = grab();
  r.meta.prevBuf = r.meta.prevBuf || b0;
  const s0 = settlePlayer(r);
  if (s0 && s0.fade) { console.log('the screen is mid-fade, nothing to walk into yet'); saveRoom(r); return; }
  const me0 = s0 ? s0.p : clearBox(r);
  if (!me0) { console.log('player not found'); saveRoom(r); return; }
  r.meta.me = [me0.x, me0.y];
  r.meta.world = [r.meta.cam[0] + me0.x, r.meta.cam[1] + me0.y + FEET];
  if (s0) r.meta.prevBuf = s0.b;
  paint(r, r.meta.prevBuf, r.meta.cam); markRobe(r, r.meta.prevBuf, r.meta.cam); markFeet(r, r.meta.cam, me0);
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
  let blocked = 0, stuckEvents = 0, dialogEvents = 0;
  const strikes = new Map();
  const pressTries = new Map(); // black gaps get escalating holds, not wall marks
  let pressMs = 0, pressCount = 0;
  r.veto = new Set(r.meta.veto || []);
  r.meta.repairTried = 0; // one repair pass per walk, at the moment the map looks finished
  let prev = null; // the route I am committing to, so two equal detours cannot alternate
  for (let i = 0; i < steps; i++) {
    const cur = cellOf(...r.meta.world);
    // Re-planning from nothing every step lets two almost-equal routes around one obstacle take
    // turns: walk25 shuffled left/right for 780 steps because on the east side of a pillar the
    // west-going route was 3 cells shorter, and on the west side the east-going one was. Stay on
    // the route already being walked unless it stops being walkable or I have drifted off it.
    const pkey = tgx + ',' + tgy;
    let path = null;
    if (prev && prev.key === pkey && prev.path.length > 1 && Math.abs(cur[0] - prev.cell[0]) + Math.abs(cur[1] - prev.cell[1]) <= 12 && passable(r, prev.path[1][0], prev.path[1][1]) && bodyFit(r, prev.path[1][0], prev.path[1][1])) {
      path = [cur, ...prev.path.slice(1)];
      // I cover ~7 cells per step, so drop the waypoints I have already walked past
      while (path.length > 1 && Math.abs(cur[0] - path[1][0]) + Math.abs(cur[1] - path[1][1]) <= 10) path.shift();
    } else path = bfs(r, cur, [tgx, tgy]);
    // A target stops being a target when fresh paint reclassifies it: the frontier was chosen
    // while that cell was UNKNOWN, and as I approached, the picture resolved it into brick. Nine
    // steps were burned walking toward a wall that grew under me before the planner noticed.
    if (mode === 'frontier' && path !== null) {
      const tc = r.grid[gidx(tgx, tgy)];
      if (tc !== UNKNOWN && tc !== VOID) path = null;
    }
    // A black gap is not standable ground, so bfs can only bring my body as close as it fits;
    // that reads as "already arrived" and would strand me inside a room I have fully painted.
    // Press into the gap instead: a failed step records the wall, a good one walks me through
    // the doorway (and the loop's own fade/transition handling takes it from there).
    const press = path !== null && path.length <= 10 && r.grid[gidx(tgx, tgy)] === VOID;
    if (press) {
      path = [cur, [tgx, tgy]];
      // A black doorway is not a wall: a short press stops at the threshold and I back off. Each
      // retry holds the key longer (250, 500, 750 ms ...) so a doorway gets progressively harder
      // attempts instead of the same polite knock forever.
      const pk = tgx + ',' + tgy;
      const t = (pressTries.get(pk) || 0) + 1;
      pressTries.set(pk, t);
      // the counter is per WALK, not per gap cell: the frontier keeps offering neighbouring cells of
      // the same dark region (walk33 burned 31 re-targets that way) and a per-cell counter restarts
      // at 250 ms every time, so the long holds never actually happen.
      pressMs = Math.min(1500, 250 * ++pressCount);
    }
    if (!path || (path.length <= 10 && !press)) {
      if (mode === 'frontier') {
        if (process.env.TRACE) console.log(`  ${path ? 'short path ' + path.length : 'NO ROUTE'} from ${cur} (cell ${r.grid[gidx(cur[0], cur[1])]}) to ${tgx},${tgy} (cell ${r.grid[gidx(tgx, tgy)]})`);
        tried.add(tgx + ',' + tgy);
        const p = pickFrontier(r, cur, tried);
        if (!p) {
          // NEVER mass-delete BLOCKED: a cleared cell turns UNKNOWN, which is not walkable,
          // so wiping the walls disconnects the room worse than a wrong wall did. The only
          // honest second chance is the tried-set, which records "no path back then".
          if (tried.size === 0) {
            console.log(`step ${i}: nothing further reachable is unmapped; room ${r.s.room} is walked out`);
            break;
          }
          tried.clear();
          const q = pickFrontier(r, cur, tried);
          if (!q) {
            console.log(`step ${i}: nothing further reachable is unmapped; room ${r.s.room} is walked out`);
            break;
          }
          tgx = q.t[0]; tgy = q.t[1];
          if (r.grid[gidx(tgx, tgy)] === VOID) tried.add(tgx + ',' + tgy); // a black gap gets one honest try
          console.log(`step ${i}: retried the whole frontier list, retarget ${tgx},${tgy}`);
          continue;
        }
        tgx = p.t[0]; tgy = p.t[1];
        if (r.grid[gidx(tgx, tgy)] === VOID) tried.add(tgx + ',' + tgy); // a black gap gets one honest try
        console.log(`step ${i}: new frontier target ${tgx},${tgy} (path ${p.path.length})`);
        continue;
      }
      console.log(`step ${i}: no path from ${cur} to ${tgx},${tgy}`);
      break;
    }
    // Aim about 8 cells along the route rather than at the adjacent waypoint: waypoints are one
    // cell apart, so any deadband reads "arrived" on every step and any 1-cell position jitter
    // reads as a sideways command. A lookahead point is the direction I actually need.
    const next = path[Math.min(path.length - 1, 8)];
    // Offsets of 1-2 cells are noise at my step size (the shortest controllable hold is ~6 px =
    // 3 cells). Treating them as a sideways command made the walker shuffle left/right forever
    // beside a target instead of closing the 12-cell gap north of it. Ignore sub-step offsets and
    // take the dominant axis.
    const ax = Math.abs(next[0] - cur[0]), ay = Math.abs(next[1] - cur[1]);
    const ddx = ax <= 2 ? 0 : Math.sign(next[0] - cur[0]);
    const ddy = ay <= 2 ? 0 : Math.sign(next[1] - cur[1]);
    let dir = null;
    if (ax > ay && ddx) dir = ddx > 0 ? 'right' : 'left';
    else if (ddy) dir = ddy > 0 ? 'down' : 'up';
    else if (ddx) dir = ddx > 0 ? 'right' : 'left';
    // Aiming 8 cells ahead smooths route wiggle, but it can point straight into the move the route
    // was built to avoid: walk35 sawed left out of 875,700 for 34 re-targets although that very edge
    // had been vetoed at step 153, because the route curving around it put the lookahead point to the
    // left. An aimed move has to be legal on the vetted graph; otherwise take the route's own step.
    if (dir && !legalAim(r, cur, dir)) {
      const pd = path[1];
      if (pd && Math.abs(pd[0] - cur[0]) + Math.abs(pd[1] - cur[1]) === 1) {
        const pd2 = pd[0] === cur[0] ? (pd[1] > cur[1] ? 'down' : 'up') : pd[0] > cur[0] ? 'right' : 'left';
        console.log(`step ${i}: the aim wanted ${dir} out of ${cur}, which the vetted route forbids; taking ${pd2}`);
        dir = pd2;
      }
    }
    if (!dir) {
      console.log(`step ${i}: arrived at ${cur}`);
      // A frontier target is one stop on a tour, not the end of the walk: walk28 reached its target
      // cleanly and then quit with most of the room still unvisited.
      if (mode !== 'frontier') break;
      tried.add(tgx + ',' + tgy);
      const p = pickFrontier(r, cur, tried);
      if (!p) { console.log(`room ${r.s.room} is walked out: nothing further reachable is unmapped`); break; }
      tgx = p.t[0]; tgy = p.t[1];
      if (r.grid[gidx(tgx, tgy)] === VOID) tried.add(tgx + ',' + tgy); // a black gap gets one honest try
      console.log(`step ${i}: next target ${tgx},${tgy} (path ${p.path.length})`);
      prev = null;
      continue;
    }
    // The hold must not overshoot what is left to walk. 90 ms is 16 px = 32 cells, while arrival
    // counts as within 3 cells (6 px): at path lengths of 28-40 cells the walker sailed past the
    // target on every step and ping-ponged left/right for hundreds of steps (walk23, 800 steps,
    // zero progress at the end). Aim at half the remaining distance, floor just above key granularity.
    const ms = press ? pressMs : Math.max(35, Math.min(150, Math.round((path.length * CELL) / PXMS / 2)));
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
      saveRoom(r);                                  // refreshes the signature of the room I am leaving
      const land = landmarks(r, cellOf(r.meta.world[0], r.meta.world[1]));
      const hit = matchRoom(land, roomCatalog());
      let back = null;
      if (hit) {
        r.s.room = hit.room;
        fs.writeFileSync(`${DIR}/current.json`, JSON.stringify(r.s));
        const p = `${DIR}/room${hit.room}`;
        r.grid = fs.existsSync(p + '.bin') ? new Uint8Array(fs.readFileSync(p + '.bin')) : new Uint8Array(GW * GH);
        const m = JSON.parse(fs.readFileSync(p + '.json'));
        back = [m.anchor[0] + hit.t[0], m.anchor[1] + hit.t[1]];   // where the landmarks say I landed
        r.meta = { cam: [0, 0], me: r.meta.me, world: [(back[0] - GOX) * CELL, (back[1] - GOY) * CELL], trail: m.trail || [] };
        console.log(`step ${i}: ROOM CHANGE - that is room ${hit.room} again (${hit.matches} landmarks line up)`);
      } else {
        r.s.room += 1;
        fs.writeFileSync(`${DIR}/current.json`, JSON.stringify(r.s));
        r.grid = new Uint8Array(GW * GH);
        r.meta = { cam: [0, 0], me: r.meta.me, world: r.meta.world, trail: [] };
        console.log(`step ${i}: ROOM CHANGE (align cost ${res.transition.toFixed(1)}) -> now mapping room ${r.s.room}`);
      }
      // a room change fades to black and reloads; that takes longer than a few grabs, and
      // giving up here would strand me in a room I never painted
      let b = null;
      for (let k = 0; k < 24 && !b; k++) { sleep(500); const g = grab(); if (!dark(g) && playerPosFrom(g)) b = g; }
      if (!b) { console.log('frame never settled after the transition; mapping it anyway'); b = grab(); if (!playerPosFrom(b)) break; }
      const me = playerPosFrom(b);
      // a reused grid already knows which cell I landed on, so the camera follows from there;
      // a fresh grid gets anchored at my feet
      if (back) r.meta.cam = [r.meta.world[0] - me.x, r.meta.world[1] - me.y - FEET];
      else r.meta.world = [me.x, me.y + FEET];
      r.meta.prevBuf = b; r.meta.me = [me.x, me.y];
      paint(r, b, r.meta.cam); markRobe(r, b, r.meta.cam); markFeet(r, r.meta.cam, me);
      if (mode === 'frontier') {
        const p = pickFrontier(r, cellOf(...r.meta.world), new Set());
        if (!p) { console.log('nothing further to map in this room'); saveRoom(r); break; }
        tgx = p.t[0]; tgy = p.t[1];
      }
      saveRoom(r);
      continue;
    }
    if (res.lost) {
      const p = clearBox(r);
      if (!p) {
        // One unreadable frame is not the end of a walk: the detector loses my sprite during
        // animation frames and while the game moves me on its own. walk20 and walk22 both died on
        // a single such frame while the very next frame showed me clearly.
        const s = settlePlayer(r);
        if (!s || s.fade) { console.log(`step ${i}: player not found in 6 frames`); break; }
        console.log(`step ${i}: my sprite was unreadable for a moment, found again at ${s.p.x},${s.p.y}`);
        r.meta.me = [s.p.x, s.p.y];
        r.meta.world = [r.meta.cam[0] + s.p.x, r.meta.cam[1] + s.p.y + FEET];
        r.meta.prevBuf = s.b;
        paint(r, s.b, r.meta.cam); markRobe(r, s.b, r.meta.cam); markFeet(r, r.meta.cam, s.p);
        continue;
      }
      r.meta.me = [p.x, p.y];
      r.meta.world = [r.meta.cam[0] + p.x, r.meta.cam[1] + p.y + FEET];
      continue;
    }
    // A message box freezes my movement: the key lands, the sprite does not move. Believing that
    // as a wall paints false obstacles - walk17 recorded four wall fans while Toriel was
    // mid-sentence. Read the box, advance it, and let the next iteration try the step again.
    if (res.moved < 6) {
      const t = boxText();
      if (t) {
        dialogEvents++;
        console.log(`step ${i}: the game is talking, movement frozen: ${t.replace(/\n/g, ' ')}`);
        clearBox(r);
        // Toriel re-opens the same line while I stand inside her trigger radius, so retrying the stuck
        // direction just re-freezes me: walk18 spent 400 steps on one sentence on repeat. Break contact
        // instead - but SIDESTEP first. walk40 measured the cost of reversing: her box opened every 4-5
        // steps while I headed west and each break shoved me 75-80 px back east, so eight steps of route
        // ended 52 px east of where they began. A perpendicular step clears her radius as well and keeps
        // the progress; reversing is the last resort, for when both sidesteps are blocked.
        const tries = [dir === 'right' || dir === 'left' ? 'up' : 'left', dir === 'right' || dir === 'left' ? 'down' : 'right',
          dir === 'right' ? 'left' : dir === 'left' ? 'right' : dir === 'up' ? 'down' : 'up'];
        let moved = 0;
        for (const d2 of tries) {
          // a long hold: while I stay inside her trigger zone the box re-opens as soon as it
          // closes, so the escape has to clear the zone in one step (~80 px, not 40).
          const b2 = step(r, d2, 450);
          if (b2.fade || b2.transition) { console.log(`step ${i}: the contact-break went ${d2} straight into a room change; ending the walk so the map stays honest`); i = steps; break; }
          moved = b2.moved || 0;
          if (moved >= 6) { console.log(`step ${i}: broke contact going ${d2}: ${moved.toFixed(0)}px`); break; }
        }
        if (moved < 6 && dialogEvents > 10) { console.log('an NPC has me pinned: nothing moves and the box keeps reopening'); break; }
        continue;
      }
    }
    if (res.moved < 6) {
      if (press) {
        // A failed press into a black gap proves nothing about the geometry: markBlocked already
        // refuses to overwrite VOID, and whole runs were spent repeating the same 35-150 ms knock
        // on the same doorway (walk28/29). Spend neither a strike nor a wall mark on it.
        const pk = tgx + ',' + tgy;
        if ((pressTries.get(pk) || 0) >= 4) { tried.add(pk); console.log(`step ${i}: the black gap at ${pk} resisted four presses; it stays black, moving on`); }
        else console.log(`step ${i}: the black gap resisted; not painting a wall there (press ${pressTries.get(pk)} of 4)`);
      } else {
        markBlocked(r, cur, dir);
        // The same move failing over and over is not bad luck: walk21 spent 41 re-targets pressing
        // right into the ledge lip at 1066,820 because every replan found a route through the fan of
        // cells around it. Three strikes and this exact move is off the routing graph.
        const key = `${cur[0]},${cur[1]}|${dir}`;
        strikes.set(key, (strikes.get(key) || 0) + 1);
        if (strikes.get(key) === 3) { r.veto.add(key); console.log(`step ${i}: ${dir} out of ${cur} failed three times, vetoed for the rest of this walk`); }
      }
    }
    blocked = res.moved < 6 ? blocked + 1 : 0;
    console.log(`step ${i}: ${dir} moved ${res.moved.toFixed(0)}px -> world ${r.meta.world.map(Math.round)} blocked=${blocked} path=${path.length}`);
    saveRoom(r);
    if (blocked > 3) {
      // the wall in front is now recorded, so a route around it exists; quitting here is
      // what left half of every room unexplored
      stuckEvents++;
      blocked = 0;
      console.log(`stuck at cell ${cur} heading ${dir}: recorded a wall, re-targeting (attempt ${stuckEvents})`);
      // the tried-set and pickFrontier guarantee progress, so this ceiling only needs to stop a
      // true infinite loop; a fixed 4 ended a 300-step walk that was still finding new ground.
      if (stuckEvents > Math.max(4, Math.floor(steps / 10)) || mode !== 'frontier') break;
      tried.add(tgx + ',' + tgy);
      const p = pickFrontier(r, cellOf(...r.meta.world), tried);
      if (!p) { console.log('no other frontier is reachable from here'); break; }
      tgx = p.t[0]; tgy = p.t[1];
    }
    prev = { key: pkey, path, cell: cur };
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
} else if (cmd === 'resync') {
  // Drive the character by hand and meta.cam goes stale, which poisons every later step. Re-derive
  // my cell from the scenery alone: paint the live frame into a scratch grid wherever the old
  // camera thinks I am (the local pattern is right even when the offset is wrong), then ask the
  // room matcher where that pattern actually belongs and move the camera to make that true.
  const r = loadRoom();
  const b = grab();
  const me = playerPosFrom(b) || clearBox(r);
  if (!me) { console.log('player not found'); }
  else {
    const scratch = { grid: new Uint8Array(r.grid), meta: { ...r.meta, trail: [] } };
    paint(scratch, b, scratch.meta.cam);
    const land = landmarks(scratch, cellOf(scratch.meta.world[0], scratch.meta.world[1]));
    const hit = matchRoom(land, roomCatalog());
    if (!hit) console.log('no saved room matches what I can see; position left alone');
    else {
      const m = JSON.parse(fs.readFileSync(`${DIR}/room${hit.room}.json`));
      const cell = [m.anchor[0] + hit.t[0], m.anchor[1] + hit.t[1]];
      r.s.room = hit.room;
      r.meta.cam = [(cell[0] - GOX) * CELL - me.x, (cell[1] - GOY) * CELL - me.y - FEET];
      r.meta.me = [me.x, me.y];
      r.meta.world = [r.meta.cam[0] + me.x, r.meta.cam[1] + me.y + FEET];
      r.meta.prevBuf = b;
      paint(r, b, r.meta.cam); markRobe(r, b, r.meta.cam); markFeet(r, r.meta.cam, me);
      saveRoom(r);
      console.log(`resynced to room ${hit.room} cell ${cell} (${hit.matches} landmarks), world ${r.meta.world.map(Math.round)}`);
    }
  }
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
  const reached = flood(r, cur);
  let w = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (walkable(r, x, y)) w++;
  const p = pickFrontier(r, cur, new Set());
  console.log(`me ${cur} walkable cells ${w}, routable from me ${reached}, next frontier ${p ? p.t : 'none'} (path ${p ? p.path.length : 0})`);
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
} else if (cmd === 'clean') {
  const r = loadRoom();
  thinSeamsToFloor(r);
  thinBrick(r, r.meta.cam || [0, 0]);
  thinDark(r, r.meta.cam || [0, 0]);
  const before = r.grid.reduce((a, v) => a + (v === BRICK || v === VOID ? 1 : 0), 0);
  stoodRepair(r);
  const after = r.grid.reduce((a, v) => a + (v === BRICK || v === VOID ? 1 : 0), 0);
  saveRoom(r);
  console.log(`room ${r.s.room}: seams cleaned, ${before - after} impassable cells relieved because my feet were on them`);
}
