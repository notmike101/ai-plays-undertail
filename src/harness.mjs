// Harness: Node.js WebSocket sidecar. Owns the native bridge process and exposes
// player-level commands over WS. Observation = window pixels; input = SendInput.
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';

const SRC = import.meta.dirname;
const ROOT = path.resolve(SRC, '..');
const BRIDGE = path.join(SRC, 'bridge', 'bridge.exe');
const PORT = Number(process.env.HARNESS_PORT || 8789);
const FRAMES = path.join(ROOT, 'logs', 'frames');
fs.mkdirSync(FRAMES, { recursive: true });

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
      const name = msg.name || ('f' + Date.now() + '.png');
      const p = path.isAbsolute(name) ? name : path.join(FRAMES, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      return bridgeT('shot ' + p + (msg.mode === 'blt' ? ' blt' : ''), 20000);
    }
    case 'key': return bridgeT(keyline(msg));
    case 'seq': {
      const out = [];
      for (const step of msg.steps) {
        if (step.sleep) { await sleep(step.sleep); out.push({ sleep: step.sleep }); continue; }
        if (step.cmd === 'shot' || step.shot) { out.push(await exec({ cmd: 'shot', name: step.shot || step.name, mode: step.mode })); continue; }
        out.push(await bridgeT(keyline(step)));
        if (step.after) await sleep(step.after);
      }
      return { ok: true, steps: out };
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
