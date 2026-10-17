// Structured stdio interface to the live game (talks to harness over WS).
// Usage: node src/play.mjs <cmd> [args]
import WebSocket from 'ws';

const PORT = Number(process.env.HARNESS_PORT || 8789);
const arg = process.argv.slice(2);
const cmd = arg[0];

function req(msg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT);
    const t = setTimeout(() => { ws.close(); reject(new Error('ws timeout')); }, Number(process.env.PLAY_TIMEOUT || 240000));
    ws.on('open', () => ws.send(JSON.stringify(msg)));
    ws.on('message', (d) => { clearTimeout(t); ws.close(); resolve(JSON.parse(String(d))); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out;
switch (cmd) {
  case 'shot': out = await req({ cmd: 'shot', name: arg[1], mode: arg[2] }); break;
  case 'find': case 'fg': case 'held': case 'list': out = await req({ cmd }); break;
  case 'focus': out = await req({ cmd: 'focus' }); break;
  case 'filter': out = await req({ cmd: 'filter', args: arg.slice(1).join(' ') }); break;
  case 'press': out = await req({ cmd: 'key', key: arg[1], action: 'press', hold: arg[2] === undefined ? undefined : Number(arg[2]) }); break;
  case 'hold': out = await req({ cmd: 'key', key: arg[1], action: 'press', hold: Number(arg[2] || 300) }); break;
  case 'down': out = await req({ cmd: 'key', key: arg[1], action: 'down' }); break;
  case 'up': out = await req({ cmd: 'key', key: arg[1], action: 'up' }); break;
  case 'seq': out = await req({ cmd: 'seq', steps: JSON.parse(arg[1]) }); break;
  case 'diff': out = await req({ cmd: 'diff', a: arg[1], b: arg[2] }); break;
  case 'watch': out = await req({ cmd: 'watch', frames: Number(arg[1] || 4), ms: Number(arg[2] || 1000), prefix: arg[3] || 'w' }); break;
  case 'scan': out = await req({ cmd: 'scan' }); break;
  case 'dodge': out = await req({ cmd: 'dodge', seconds: Number(arg[1] || 8) }); break;
  case 'page': out = await req({ cmd: 'page', pages: Number(arg[1] || 1), key: arg[2] === 'none' ? false : arg[2] }); break;
  case 'probe': out = await req({ cmd: 'probe', keys: String(arg[1] || '').split(','), ms: Number(arg[2] || 500), hold: arg[3] === undefined ? undefined : Number(arg[3]) }); break;
  case 'wait': await sleep(Number(arg[1] || 100)); out = { ok: true }; break;
  case 'text': out = await req({ cmd: 'text' }); break;
  case 'readtext': out = await req({ cmd: 'readtext', name: arg[1] }); break;
  case 'readwatch': out = await req({ cmd: 'readwatch', seconds: Number(arg[1] || 6), gap: Number(arg[2] || 350) }); break;
  case 'raw': out = await req({ cmd: 'raw', line: arg.slice(1).join(' ') }); break;
  case 'ping': out = await req({ cmd: 'ping' }); break;
  default: out = { ok: false, err: 'unknown cmd: ' + cmd }; break;
}
console.log(JSON.stringify(out));
if (!out || out.ok === false) process.exitCode = 1;
