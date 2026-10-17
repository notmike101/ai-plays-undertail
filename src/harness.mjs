// Harness: Node.js WebSocket sidecar. Owns the native bridge process and exposes
// player-level commands over WS. Observation = window pixels; input = SendInput.
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import { readText } from './ocr.mjs';

const SRC = import.meta.dirname;
const ROOT = path.resolve(SRC, '..');
const BRIDGE = path.join(SRC, 'bridge', 'bridge.exe');
const PORT = Number(process.env.HARNESS_PORT || 8789);
const FRAMES = path.join(ROOT, 'logs', 'frames');
fs.mkdirSync(FRAMES, { recursive: true });
const OCRDIR = path.join(ROOT, 'logs', 'ocr');
fs.mkdirSync(OCRDIR, { recursive: true });
const OCRBIN = path.join(OCRDIR, 'live.bin');

const child = spawn(BRIDGE, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => process.stderr.write('[bridge] ' + d));
child.on('exit', (c) => { console.log('[harness] bridge exited ' + c); process.exit(c ?? 1); });

// Commands are serialized: one bridge line in, one JSON line out.
let waiter = null;
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (waiter) { const w = waiter; waiter = null; w(obj); }
  }
});

let queue = Promise.resolve();
function bridge(line) {
  // ponytail: strictly serialized one-line/one-reply pipe. A timeout can desync
  // one reply; recover with a ping if that ever bites.
  queue = queue
    .then(() => new Promise((res) => { waiter = res; child.stdin.write(line + '\n'); }))
    .catch((e) => ({ ok: false, err: String(e) }));
  return queue;
}
// timeout guard so a stuck bridge cannot wedge the queue forever
function bridgeT(line, ms = 15000) {
  return Promise.race([
    bridge(line),
    new Promise((res) => setTimeout(() => res({ ok: false, err: 'timeout' }), ms)),
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyline(m) {
  const act = m.action || 'press';
  const hold = m.hold === undefined ? (act === 'press' ? 90 : 0) : m.hold;
  return `key ${m.key} ${act}${m.scan ? ' scan' : ''} ${hold}`;
}

function resolve(name) { return path.isAbsolute(name) ? name : path.join(FRAMES, name); }

async function exec(msg) {
  const cmd = msg.cmd;
  switch (cmd) {
    case 'raw': return bridgeT(msg.line);
    case 'find': return bridgeT('find');
    case 'list': return bridgeT('list');
    case 'fg': return bridgeT('fg');
    case 'focus': return bridgeT('focus');
    case 'filter': return bridgeT('filter ' + (msg.args || ''));
    case 'held': return bridgeT('held');
    case 'shot': {
      const p = resolve(msg.name || ('f' + Date.now() + '.png'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      return bridgeT('shot ' + p + (msg.mode === 'blt' ? ' blt' : ''), 20000);
    }
    case 'diff': return bridgeT('diff ' + resolve(msg.a) + ' ' + resolve(msg.b), 20000);
    case 'key': return bridgeT(keyline(msg));
    case 'scan': return bridgeT('scan');
    case 'dodge': {
      // reflex aid: reads only visible pixels, sends ordinary arrow-key holds.
      // picks the box position that maximises distance from predicted pellets.
      const secs = msg.seconds || 8;
      let heldX = null, heldY = null, iters = 0, bulletFrames = 0, closest = 1e9;
      let last = [], empty = 0, ended = '';
      const setAxis = async (axis, dir) => {
        const cur = axis === 'x' ? heldX : heldY;
        if (cur === dir) return;
        if (cur) await bridgeT(`key ${cur} up 0`);
        if (dir) await bridgeT(`key ${dir} down 0`);
        if (axis === 'x') heldX = dir; else heldY = dir;
      };
      const end = Date.now() + secs * 1000;
      while (Date.now() < end) {
        const s = await bridgeT('scan');
        if (!s.ok || s.soul[2] === 0) { await sleep(50); continue; }
        const [sx, sy] = s.soul;
        const [x0, y0, x1, y1] = s.inner;
        iters++;
        if (s.bullets.length) bulletFrames++;
        empty = s.bullets.length ? 0 : empty + 1;
        if (bulletFrames > 0 && empty > 25) { ended = 'pellets stopped'; break; }
        const cur = s.bullets.map((b) => [b[0], b[1]]);
        const pred = cur.map(([bx, by]) => {
          let bestD = 1e9, src = null;
          for (const p of last) {
            const d = Math.hypot(bx - p[0], by - p[1]);
            if (d < bestD) { bestD = d; src = p; }
          }
          if (!src || bestD > 24) return [bx, by];
          return [bx + (bx - src[0]) * 1.6, by + (by - src[1]) * 1.6];
        });
        last = cur;
        let bx = (x0 + x1) / 2, by = (y0 + y1) / 2, bestScore = -1e9;
        for (let cy = y0 + 6; cy <= y1 - 6; cy += 10) {
          for (let cx = x0 + 6; cx <= x1 - 6; cx += 10) {
            let m = 1e9;
            for (const [px, py] of pred) {
              const d = Math.hypot(cx - px, cy - py);
              if (d < m) m = d;
            }
            const score = (m === 1e9 ? 9999 : Math.min(m, 120)) - Math.hypot(cx - sx, cy - sy) * 0.2;
            if (score > bestScore) { bestScore = score; bx = cx; by = cy; }
          }
        }
        for (const [px, py] of cur) {
          const g = Math.hypot(px - sx, py - sy);
          if (g < closest) closest = g;
        }
        const dx = bx - sx, dy = by - sy;
        await setAxis('x', Math.abs(dx) > 5 ? (dx > 0 ? 'right' : 'left') : null);
        await setAxis('y', Math.abs(dy) > 5 ? (dy > 0 ? 'down' : 'up') : null);
        await sleep(20);
      }
      await setAxis('x', null); await setAxis('y', null);
      return { ok: true, iters, bulletFrames, ended, closestPx: closest === 1e9 ? null : Math.round(closest) };
    }
    case 'seq': {
      const out = [];
      for (const step of msg.steps) {
        if (step.sleep) { await sleep(step.sleep); out.push({ sleep: step.sleep }); continue; }
        if (step.cmd === 'shot' || step.shot) { out.push(await exec({ cmd: 'shot', name: step.shot || step.name, mode: step.mode })); continue; }
        if (step.diff) { out.push(await exec({ cmd: 'diff', a: step.diff[0], b: step.diff[1] })); continue; }
        if (step.cmd === 'watch') { out.push(await exec({ cmd: 'watch', frames: step.frames, ms: step.ms, prefix: step.prefix })); continue; }
        out.push(await bridgeT(keyline(step)));
        if (step.after) await sleep(step.after);
      }
      return { ok: true, steps: out };
    }
    case 'watch': {
      // capture N frames ms apart and report change between neighbours
      const n = msg.frames || 4, gap = msg.ms || 1000, pre = msg.prefix || 'w';
      const names = [];
      for (let i = 0; i < n; i++) names.push(`${pre}${Date.now()}_${i}.png`);
      const shots = [];
      for (let i = 0; i < n; i++) {
        shots.push(await exec({ cmd: 'shot', name: names[i] }));
        if (i < n - 1) await sleep(gap);
      }
      const diffs = [];
      for (let i = 1; i < n; i++) {
        const d = await exec({ cmd: 'diff', a: names[i - 1], b: names[i] });
        diffs.push({ pair: [names[i - 1], names[i]], changed: d.changed, bbox: d.bbox });
      }
      return { ok: true, frames: names, diffs };
    }
    case 'page': {
      // advance dialogue, then hold the capture until the text stops changing
      const n = msg.pages || 1, out = [];
      for (let i = 0; i < n; i++) {
        if (msg.key !== false) await bridgeT(keyline({ key: msg.key || 'z' }));
        let prev = `pg_a${Date.now()}_${i}.png`;
        await exec({ cmd: 'shot', name: prev });
        let stable = 0;
        for (let k = 0; k < 16 && stable < 2; k++) {
          await sleep(250);
          const cur = `pg_b${Date.now()}_${i}_${k}.png`;
          await exec({ cmd: 'shot', name: cur });
          const d = await exec({ cmd: 'diff', a: prev, b: cur });
          stable = (d.changed || 0) < 40 ? stable + 1 : 0;
          prev = cur;
        }
        out.push(prev);
      }
      // capture the settled page's text so nothing has to be read off a picture
      const texts = [];
      for (const p of out) {
        const d = await bridgeT('dump ' + p + ' ' + OCRBIN, 20000);
        texts.push(d.ok ? readText(fs.readFileSync(OCRBIN), d.w, d.h, msg.set || 'dialog') : '');
      }
      return { ok: true, pages: out, texts };
    }
    case 'text': {
      const g = await bridgeT('grab ' + OCRBIN, 20000);
      if (!g.ok) return g;
      return { ok: true, text: readText(fs.readFileSync(OCRBIN), g.w, g.h, msg.set || 'dialog') };
    }
    case 'readtext': {
      const d = await bridgeT('dump ' + resolve(msg.name) + ' ' + OCRBIN, 20000);
      if (!d.ok) return d;
      return { ok: true, text: readText(fs.readFileSync(OCRBIN), d.w, d.h, msg.set || 'dialog') };
    }
    case 'readwatch': {
      // sample the screen text continuously: catches pages that advance by themselves
      const ms = (msg.seconds || 6) * 1000, gap = msg.gap || 350;
      const seen = [];
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const r = await exec({ cmd: 'text', set: msg.set });
        const t = (r.text || '').trim();
        if (t && (!seen.length || seen[seen.length - 1].t !== t)) seen.push({ t, at: Date.now() });
        await sleep(gap);
      }
      return { ok: true, count: seen.length, pages: seen.map((s) => ({ at: s.at, text: s.t })) };
    }
    case 'probe': {
      // press each key, then report changed pixels and where
      const gap = msg.ms || 500;
      let prev = `probe_a${Date.now()}.png`;
      await exec({ cmd: 'shot', name: prev });
      const res = [];
      for (const k of msg.keys) {
        await bridgeT(keyline({ key: k, hold: msg.hold }));
        await sleep(gap);
        const cur = `probe_b${Date.now()}_${k}.png`;
        await exec({ cmd: 'shot', name: cur });
        const d = await exec({ cmd: 'diff', a: prev, b: cur });
        res.push({ key: k, changed: d.changed, bbox: d.bbox });
        prev = cur;
      }
      return { ok: true, last: prev, results: res };
    }
    case 'ping': return { ok: true, t: Date.now() };
    default: return { ok: false, err: 'unknown cmd ' + cmd };
  }
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
console.log('[harness] ws on 127.0.0.1:' + PORT);
wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    let msg; try { msg = JSON.parse(String(data)); } catch { ws.send(JSON.stringify({ ok: false, err: 'bad json' })); return; }
    let res;
    try { res = await exec(msg); } catch (e) { res = { ok: false, err: String(e) }; }
    ws.send(JSON.stringify({ id: msg.id, ...res }));
  });
});
