// Talks to the FL Studio script (fl-script/device_FLTutorialRecorder.py) over MIDI SysEx.
// macOS: the app publishes its own virtual MIDI ports, FL just has to enable them.
// Windows: virtual ports don't exist, so two loopMIDI ports are used instead.
const path = require('path');
const fs = require('fs');
const os = require('os');

// FLTR_MIDI_MODULE swaps in a stand-in MIDI implementation (used by the automated tests).
let midi = null;
try { midi = require(process.env.FLTR_MIDI_MODULE || '@julusian/midi'); } catch (e) { midi = null; }

const PORT = 'FL Tutorial Recorder';
const WIN_TO_FL = 'FLTR to FL';
const WIN_FROM_FL = 'FLTR from FL';
const HEAD = [0xf0, 0x7d, 0x46, 0x54];

function encode(text) {
  return [...HEAD, ...Buffer.from(Buffer.from(text, 'utf8').toString('hex'), 'ascii'), 0xf7];
}
function decode(bytes) {
  if (bytes.length < 6 || HEAD.some((b, i) => bytes[i] !== b) || bytes[bytes.length - 1] !== 0xf7) return null;
  const hex = Buffer.from(bytes.slice(HEAD.length, -1)).toString('ascii');
  return Buffer.from(hex, 'hex').toString('utf8');
}

function createBridge({ onStatus, onMessage }) {
  let out = null, inp = null, error = null;
  let lastHello = 0, version = null, outputLinked = null;
  const waiters = [];
  let heartbeat = 0;

  function findPort(io, name) {
    for (let i = 0; i < io.getPortCount(); i++) if (io.getPortName(i).includes(name)) return i;
    return -1;
  }

  function open() {
    close();
    if (!midi) { error = 'MIDI-модуль не загрузился'; return status(); }
    try {
      out = new midi.Output();
      inp = new midi.Input();
      inp.ignoreTypes(false, true, true); // we need SysEx, not clock/active sensing
      inp.on('message', (_dt, msg) => handle(msg));
      if (process.platform === 'win32') {
        const o = findPort(out, WIN_TO_FL), i = findPort(inp, WIN_FROM_FL);
        if (o < 0 || i < 0) {
          error = `Нужны порты loopMIDI «${WIN_TO_FL}» и «${WIN_FROM_FL}»`;
          out = inp = null;
          return status();
        }
        out.openPort(o); inp.openPort(i);
      } else {
        out.openVirtualPort(PORT);
        inp.openVirtualPort(PORT);
      }
      error = null;
    } catch (e) {
      error = 'MIDI: ' + e.message;
      out = inp = null;
    }
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { send('hello'); status(); }, 1500);
    send('hello');
    status();
  }

  function close() {
    clearInterval(heartbeat);
    try { if (inp) inp.closePort(); } catch (e) {}
    try { if (out) out.closePort(); } catch (e) {}
    inp = out = null;
  }

  const connected = () => Date.now() - lastHello < 4000;
  function status() {
    const s = { connected: connected(), version, error, ports: !!out, outputLinked, platform: process.platform };
    onStatus && onStatus(s);
    return s;
  }

  function handle(msg) {
    const text = decode(msg);
    if (text == null) return;
    const f = text.split('|');
    if (f[0] === 'hello') {
      const was = connected();
      lastHello = Date.now(); version = f[1]; outputLinked = f[2] == null ? null : f[2] === '1';
      if (!was) status();
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(f)) { waiters[i].resolve(f); waiters.splice(i, 1); }
    }
    onMessage && onMessage(f);
  }

  function send(...fields) {
    if (!out) return false;
    try { out.sendMessage(encode(fields.join('|'))); return true; } catch (e) { error = e.message; return false; }
  }

  // Send a command and wait for the reply that satisfies `match`.
  function request(fields, match, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) { waiters.splice(i, 1); reject(new Error('FL Studio не ответил')); }
      }, timeout);
      if (!send(...fields)) { waiters.splice(waiters.indexOf(w), 1); reject(new Error('Нет MIDI-порта')); }
    });
  }

  async function list() {
    const f = await request(['list'], (r) => r[0] === 'list' || (r[0] === 'err' && r[1] === 'list'));
    if (f[0] === 'err') throw new Error(f.slice(2).join(' '));
    const pats = (f[2] || '').split('\t').filter(Boolean).map(p => {
      const [index, name, empty] = p.split('~');
      return { index: +index, name, empty: empty === '1' };
    });
    const chans = (f[3] || '').split('\t').map((name, index) => ({ index, name })).filter(c => c.name !== '');
    return { bpm: parseFloat(f[1]) || 0, patterns: pats, channels: chans, current: +f[4] || 1 };
  }

  const okOrErr = (cmd) => (r) => (r[0] === 'ok' && r[1] === cmd) || (r[0] === 'err' && r[1] === cmd);
  // Without replies from FL (its MIDI Output not set up) commands still go out "blind".
  async function command(fields) {
    if (!connected()) {
      if (!send(...fields)) throw new Error('Нет MIDI-порта');
      return true;
    }
    const f = await request(fields, okOrErr(fields[0]));
    if (f[0] === 'err') throw new Error(f.slice(2).join(' '));
    return true;
  }

  return {
    open, close, status, list,
    play: (pattern, view, channel) => command(['play', pattern, view || 'none', channel ?? -1]),
    song: (view) => command(['song', view || 'playlist']),
    stop: () => command(['stop']),
  };
}

// Where FL Studio looks for controller scripts.
function scriptDir(documents) {
  return path.join(documents, 'Image-Line', 'FL Studio', 'Settings', 'Hardware', 'FL Tutorial Recorder');
}
function installScript(documents) {
  const dir = scriptDir(documents);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(__dirname, 'fl-script', 'device_FLTutorialRecorder.py');
  fs.writeFileSync(path.join(dir, 'device_FLTutorialRecorder.py'), fs.readFileSync(src));
  return dir;
}

module.exports = { createBridge, installScript, scriptDir, encode, decode, PORT, WIN_TO_FL, WIN_FROM_FL };
