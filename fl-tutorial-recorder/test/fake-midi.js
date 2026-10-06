// Stand-in for @julusian/midi that routes MIDI to fl-sim.py (the real FL script on stub FL modules).
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

let proc = null;
const inputs = new Set();
function sim() {
  if (proc) return proc;
  proc = spawn('python3', ['-I', '-B', path.join(__dirname, 'fl-sim.py')], { stdio: ['pipe', 'pipe', process.env.FL_SIM_LOG ? 'pipe' : 'inherit'] });
  if (process.env.FL_SIM_LOG) proc.stderr.pipe(require('fs').createWriteStream(process.env.FL_SIM_LOG, { flags: 'a' }));
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) for (const inp of inputs) inp.emit('message', 0, [...Buffer.from(line, 'hex')]);
    }
  });
  return proc;
}
class Output {
  getPortCount() { return 0; }
  getPortName() { return ''; }
  openVirtualPort() { sim(); }
  openPort() { sim(); }
  closePort() {}
  sendMessage(bytes) { sim().stdin.write(Buffer.from(bytes).toString('hex') + '\n'); }
}
class Input extends EventEmitter {
  getPortCount() { return 0; }
  getPortName() { return ''; }
  ignoreTypes() {}
  openVirtualPort() { inputs.add(this); sim(); }
  openPort() { inputs.add(this); sim(); }
  closePort() { inputs.delete(this); }
}
module.exports = { Output, Input };
