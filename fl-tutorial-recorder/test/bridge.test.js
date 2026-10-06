// node test/bridge.test.js — bridge ↔ real FL script round trip through fake MIDI.
process.env.FLTR_MIDI_MODULE = require('path').join(__dirname, 'fake-midi.js');
const assert = require('assert');
const { createBridge, encode, decode } = require('../fl-bridge');

(async () => {
  assert.strictEqual(decode(encode('play|3|piano|ü')), 'play|3|piano|ü');
  let last = null;
  const b = createBridge({ onStatus: (s) => { last = s; } });
  b.open();
  for (let i = 0; i < 50 && !(last && last.connected); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(last.connected, 'bridge should see the script hello');
  const list = await b.list();
  assert.strictEqual(list.bpm, 150);
  assert.deepStrictEqual(list.patterns.map(p => p.name), ['Loop', 'Kick', 'Open Hat', 'Hi-Hat', 'Snare', 'Pattern 6']);
  assert.strictEqual(list.patterns[5].empty, true);
  assert.strictEqual(list.channels[4].name, 'Loop Piano');
  await b.play(3, 'piano', 1);
  await b.play(2, 'rack', -1);
  await b.song('playlist');
  await b.stop();
  await assert.rejects(b.play(99, 'rack', -1), /bad pattern/);
  b.close();
  console.log('bridge ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
