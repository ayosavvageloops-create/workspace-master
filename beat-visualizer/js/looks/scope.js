// scope — an oscilloscope locked to the 808: the timebase triggers on the low end's
// rising zero crossing, CH2 draws the rest of the mix beside it, with phosphor persistence.
Looks.register({
  id: 'scope',
  name: 'scope',
  group: 'audio',
  theme: 'dark',
  desc: 'an oscilloscope locked to the 808',
  defaults: { accent: '#c9e44a', bg: '#050905', span: 80, gain: 1, ch2: true, persistence: 4 },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'span', label: 'Timebase · ms', type: 'range', min: 20, max: 200, step: 5 },
    { key: 'gain', label: 'Gain', type: 'range', min: 0.3, max: 2.5, step: 0.05 },
    { key: 'ch2', label: 'CH2 (rest of mix)', type: 'toggle' },
    { key: 'persistence', label: 'Persistence', type: 'range', min: 0, max: 8, step: 1 },
  ],
  prepare(S) {
    // smooth peak envelopes (20 Hz) for the auto-gain, so the trace height never jumps between frames
    const A = S.A, RATE = 20;
    const env = (src) => {
      const n = Math.ceil(A.dur * RATE) + 1, hop = A.sr / RATE, blk = new Float32Array(n), mx = new Float32Array(n), out = new Float32Array(n);
      for (let f = 0; f < n; f++) { let p = 0; const e = Math.min(src.length, (f + 1) * hop); for (let i = Math.floor(f * hop); i < e; i += 4) { const v = Math.abs(src[i]); if (v > p) p = v; } blk[f] = p; }
      for (let f = 0; f < n; f++) { let m = 0; for (let j = Math.max(0, f - 8); j <= Math.min(n - 1, f + 8); j++) m = Math.max(m, blk[j]); mx[f] = m; }
      for (let f = 0; f < n; f++) { let sm = 0, c = 0; for (let j = Math.max(0, f - 6); j <= Math.min(n - 1, f + 6); j++) { sm += mx[j]; c++; } out[f] = sm / c; }
      return out;
    };
    return { RATE, lp: env(A.lowpassed()), m: env(A.M) };
  },
  draw(g, S) {
    const { w, h, pad, A, opt } = S;
    const C = S.cache;
    const envAt = (arr, t) => { const f = U.clamp(t * C.RATE, 0, arr.length - 1), i = Math.floor(f), j = Math.min(arr.length - 1, i + 1); return arr[i] + (arr[j] - arr[i]) * (f - i); };
    const ink = opt.accent;
    g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

    // header
    U.text(g, S.meta.title, pad, pad + S.unit * 0.04, { size: S.unit * 0.042, font: U.FONT.SANS, weight: 500, color: '#f2f2ee', max: w - pad * 2 });
    U.text(g, S.sub, pad, pad + S.unit * 0.075, { size: S.unit * 0.017, font: U.FONT.MONO, color: 'rgba(255,255,255,0.32)', spacing: 3, max: w - pad * 2 });

    // screen
    const sx = pad * 0.35, sw = w - sx * 2;
    const sh = S.portrait ? h * 0.4 : h * 0.62;
    const sy = S.portrait ? h * 0.22 : h * 0.24;
    g.fillStyle = 'rgba(30,50,20,0.18)'; g.fillRect(sx, sy, sw, sh);
    g.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = sx + (sw * i) / 10;
      g.strokeStyle = i === 5 ? 'rgba(160,200,120,0.28)' : 'rgba(160,200,120,0.1)';
      g.beginPath(); g.moveTo(x, sy); g.lineTo(x, sy + sh); g.stroke();
    }
    for (let i = 0; i <= 8; i++) {
      const y = sy + (sh * i) / 8;
      g.strokeStyle = i === 4 ? 'rgba(160,200,120,0.28)' : 'rgba(160,200,120,0.1)';
      g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + sw, y); g.stroke();
    }
    const lab = { size: S.unit * 0.012, font: U.FONT.MONO, color: 'rgba(200,230,160,0.45)', spacing: 1 };
    U.text(g, 'TRIG ↑', sx + 12, sy + 22, lab);
    U.text(g, 'LP 150 Hz', sx + sw - 12, sy + 22, { ...lab, align: 'right' });
    U.text(g, `${(opt.span / 10).toFixed(1)} ms/div`, sx + 12, sy + sh - 12, lab);
    U.text(g, `${(0.25 / opt.gain).toFixed(2)} V/div`, sx + sw - 12, sy + sh - 12, { ...lab, align: 'right' });

    const lp = A.lowpassed(), sr = A.sr, M = A.M, cy = sy + sh / 2, amp = sh * 0.42 * opt.gain;
    const N = 700, span = (opt.span / 1000) * sr;
    const trace = (tt, src, scale, color, alpha, width) => {
      // trigger: rising edge of the low end through a small positive level (ignores noise in quiet parts)
      const lvl = 0.06 * envAt(C.lp, tt), start = Math.floor(tt * sr);
      let i0 = start;
      for (let k = 0; k < sr * 0.05 && i0 > 1; k++, i0--) if (lp[i0 - 1] < lvl && lp[i0] >= lvl) break;
      if (start - i0 >= sr * 0.05 - 1) i0 = start; // no edge found: free-run
      // auto-gain from a pre-smoothed envelope; never amplify near-silence past 4x
      const pk = envAt(src === lp ? C.lp : C.m, tt);
      scale *= 0.8 / Math.max(pk, 0.2);
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const j = Math.floor(i0 + (i / (N - 1)) * span);
        const v = j < src.length ? src[j] : 0;
        const x = sx + (i / (N - 1)) * sw, y = cy - Math.max(-1.1, Math.min(1.1, v * scale)) * amp;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.stroke();
    };
    g.save();
    g.beginPath(); g.rect(sx, sy, sw, sh); g.clip();
    g.lineJoin = 'round';
    const level = 0.75 + 0.25 * A.level(S.t);
    for (let k = opt.persistence; k >= 1; k--) trace(S.t - k / 60, lp, level, ink, 0.07 + 0.06 * (opt.persistence - k) / Math.max(1, opt.persistence), 2);
    if (opt.ch2) trace(S.t, M, 0.7, U.mix(ink, '#ffffff', 0.4), 0.22, 1.2);
    g.shadowColor = ink; g.shadowBlur = 14;
    trace(S.t, lp, level, ink, 1, 3);
    g.shadowBlur = 0;
    g.globalAlpha = 0.6; trace(S.t, lp, level, '#f6ffd8', 0.5, 1);
    g.restore();
  },
});
