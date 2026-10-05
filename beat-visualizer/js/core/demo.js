// Built-in demo: an 8-bar beat at 102 BPM in D, synthesised in the browser,
// plus its parts (bass, chords, lead) so MIDI looks work without any files.
(function () {
  const BPM = 102, SPB = 60 / BPM, BAR = SPB * 4, BARS = 8, SR = 48000;
  const PROG = [[50, 54, 57, 61], [47, 50, 54, 57], [43, 47, 50, 54], [45, 49, 52, 55]]; // Dmaj7 Bm7 Gmaj7 A7 (roots)
  const midiHz = (p) => 440 * Math.pow(2, (p - 69) / 12);

  function notes() {
    const bass = [], chords = [], lead = [];
    // bass: syncopated root/fifth pattern, octave 2
    const bassPat = [[0, 0.75, 0], [1, 0.5, 0], [1.75, 0.25, 7], [2.5, 0.75, 0], [3.5, 0.5, 12]];
    for (let b = 0; b < BARS; b++) {
      const root = PROG[b % 4][0] - 12;
      for (const [beat, len, iv] of bassPat) bass.push({ p: root + iv, v: 0.85, s: b * BAR + beat * SPB, e: b * BAR + (beat + len) * SPB });
    }
    // chords: enter on bar 3, two stabs per bar
    for (let b = 2; b < BARS; b++) {
      const ch = PROG[b % 4].map((p) => p + 12);
      for (const [beat, len] of [[0, 1.75], [2, 1.75]]) for (const p of ch) chords.push({ p, v: 0.7, s: b * BAR + beat * SPB, e: b * BAR + (beat + len) * SPB });
    }
    // lead: enters on bar 5, simple motif over the chords
    const motif = [[0, 0.5, 74], [0.5, 0.5, 76], [1, 1, 78], [2.5, 0.5, 76], [3, 1, 74]];
    const motif2 = [[0, 0.5, 74], [0.75, 0.25, 73], [1, 0.5, 71], [1.5, 1, 69], [3, 0.5, 71], [3.5, 0.5, 73]];
    for (let b = 4; b < BARS; b++) {
      for (const [beat, len, p] of b % 2 ? motif2 : motif) lead.push({ p: p - (b === 6 ? 2 : 0), v: 0.8, s: b * BAR + beat * SPB, e: b * BAR + (beat + len) * SPB });
    }
    return { bass, chords, lead };
  }

  async function render() {
    const dur = BARS * BAR + 1.2;
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
    const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, SR, SR); const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; p.connect(master); return p; };
    const C = pan(0), Lp = pan(-0.35), Rp = pan(0.35);

    const kick = (t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(1.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g).connect(C); o.start(t); o.stop(t + 0.5);
    };
    const hit = (t, f, q, len, gain, out) => {
      const s = ctx.createBufferSource(); s.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      s.connect(bp).connect(g).connect(out); s.start(t); s.stop(t + len + 0.02);
    };
    const tone = (n, type, cutoff, gain, out, detune = 0) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = midiHz(n.p); o.detune.value = detune;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
      const g = ctx.createGain(), a = 0.008, len = n.e - n.s;
      g.gain.setValueAtTime(0, n.s); g.gain.linearRampToValueAtTime(gain * n.v, n.s + a);
      g.gain.setTargetAtTime(gain * n.v * 0.6, n.s + a, len * 0.4);
      g.gain.setTargetAtTime(0, n.e, 0.05);
      o.connect(lp).connect(g).connect(out); o.start(n.s); o.stop(n.e + 0.4);
    };

    for (let b = 0; b < BARS; b++) {
      const t0 = b * BAR;
      for (const beat of [0, 1.75, 2.5]) kick(t0 + beat * SPB);
      for (const beat of [1, 3]) hit(t0 + beat * SPB, 1800, 0.8, 0.22, 0.9, C);
      for (let k = 0; k < 8; k++) hit(t0 + k * SPB / 2, 9000, 1.2, k % 2 ? 0.04 : 0.07, 0.35, k % 2 ? Rp : Lp);
    }
    const n = notes();
    for (const x of n.bass) tone(x, 'sawtooth', 380, 0.55, C);
    for (const x of n.chords) { tone(x, 'triangle', 2400, 0.12, Lp, -6); tone(x, 'triangle', 2400, 0.12, Rp, 6); }
    for (const x of n.lead) tone(x, 'square', 2600, 0.12, C);
    return ctx.startRendering();
  }

  async function load() {
    const buffer = await render();
    const n = notes();
    const parts = [
      Parts.makePart(n.bass, 'bass', 'bass', 'midi'),
      Parts.makePart(n.chords, 'chords', 'chords', 'midi'),
      Parts.makePart(n.lead, 'lead', 'lead', 'midi'),
    ];
    return { buffer, parts, meta: { title: 'cedar', bpm: BPM, key: 'D', filename: 'cedar 102 d.wav' } };
  }

  window.Demo = { load, BPM };
})();
