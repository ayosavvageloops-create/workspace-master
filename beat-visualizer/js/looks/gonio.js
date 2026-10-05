// gonio — a stereo goniometer: the L/R samples drawn as a Lissajous trace rotated so mono is
// vertical, with short phosphor persistence, a correlation meter and L/R peak bars.
Looks.register({
  id: 'gonio',
  name: 'gonio',
  group: 'audio',
  theme: 'dark',
  desc: 'a goniometer with correlation and level meters',
  defaults: { accent: '#e8141c', bg: '#000000', gain: 1, persistence: 5, width: 2.5 },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'gain', label: 'Scope gain', type: 'range', min: 0.4, max: 2.5, step: 0.05 },
    { key: 'persistence', label: 'Persistence', type: 'range', min: 0, max: 10, step: 1 },
    { key: 'width', label: 'Stereo zoom', type: 'range', min: 1, max: 6, step: 0.5 },
  ],
  prepare(S) {
    const { A } = S;
    let pk = 0;
    for (const ch of [A.L, A.R]) for (let i = 0; i < ch.length; i += 3) { const v = Math.abs(ch[i]); if (v > pk) pk = v; }
    pk = pk || 1;
    // smooth gain envelope at 20 Hz: block peaks → max over ±0.6 s → box blur over ±0.5 s
    const RATE = 20, n = Math.ceil(A.dur * RATE) + 1, hop = A.sr / RATE, blk = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let p = 0; const e = Math.min(A.L.length, (f + 1) * hop);
      for (let i = Math.floor(f * hop); i < e; i += 5) p = Math.max(p, Math.abs(A.L[i]), Math.abs(A.R[i]));
      blk[f] = Math.max(p, pk / 3);
    }
    const mx = new Float32Array(n), env = new Float32Array(n);
    for (let f = 0; f < n; f++) { let m = 0; for (let j = Math.max(0, f - 12); j <= Math.min(n - 1, f + 12); j++) m = Math.max(m, blk[j]); mx[f] = m; }
    for (let f = 0; f < n; f++) { let sum = 0, c = 0; for (let j = Math.max(0, f - 10); j <= Math.min(n - 1, f + 10); j++) { sum += mx[j]; c++; } env[f] = sum / c; }
    return { pk, env, RATE };
  },
  draw(g, S) {
    const { w, h, A, opt, unit } = S;
    g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
    const red = opt.accent;
    const lab = (s, x, y, o = {}) => U.text(g, s, x, y, { size: unit * 0.016, font: U.FONT.PLEX, color: 'rgba(255,255,255,0.55)', ...o });

    // layout: scope on top, meters below (portrait) or beside (landscape)
    // (kept clear of the handle strip at the bottom)
    const pad = S.pad, top = pad, bot = (S.portrait ? h - unit * 0.16 : h - pad * 0.9) - unit * 0.045, avH = bot - top;
    const MB = unit * 0.29; // height of the meter block
    let cx, cy, r, mx0, mx1, my;
    if (h / w >= 1.1) {
      r = Math.min(w * 0.34, (avH - unit * 0.135 - MB) / 2);
      const total = unit * 0.135 + 2 * r + MB, y0 = top + (avH - total) / 2;
      cx = w / 2; cy = y0 + unit * 0.045 + r; my = cy + r + unit * 0.09;
      mx0 = w / 2 - Math.max(r, w * 0.38) * 1.0; mx1 = w - mx0;
    } else {
      r = Math.min(avH * 0.42, w * 0.22);
      const gap = unit * 0.12, mw = Math.min(w - pad * 2 - 2 * r - gap, unit * 0.75), xs = (w - (2 * r + gap + mw)) / 2;
      cx = xs + r; cy = top + avH / 2; mx0 = xs + 2 * r + gap; mx1 = mx0 + mw; my = cy - MB / 2 + unit * 0.02;
    }
    const mw = mx1 - mx0;

    // ---- scope frame ----
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = Math.max(1, unit * 0.0012);
    g.beginPath(); g.arc(cx, cy, r, 0, U.TAU); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * 0.5, 0, U.TAU); g.stroke();
    g.save();
    g.setLineDash([unit * 0.006, unit * 0.006]);
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r);
    for (const a of [-3, -1, 1, 3]) {
      const ang = (a * Math.PI) / 4;
      g.moveTo(cx + Math.cos(ang) * r * 0.5, cy + Math.sin(ang) * r * 0.5); g.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    }
    g.stroke();
    g.restore();
    lab('M', cx, cy - r - unit * 0.022, { align: 'center' });
    lab('L', cx - r * 0.82, cy - r * 0.82, { align: 'center' });
    lab('R', cx + r * 0.82, cy - r * 0.82, { align: 'center' });

    // ---- trace ----
    // gentle auto-gain from a pre-smoothed peak envelope (never boosts quiet passages past 3x)
    const C = S.cache, ef = U.clamp(S.t * C.RATE, 0, C.env.length - 1), e0 = Math.floor(ef), e1 = Math.min(C.env.length - 1, e0 + 1);
    const lp = C.env[e0] + (C.env[e1] - C.env[e0]) * (ef - e0);
    const k = (r * 0.62 * opt.gain) / lp, sz = opt.width;
    const trace = (tt, n, color, alpha, lw) => {
      const st = A.stereo(tt, n, 0.035);
      g.beginPath();
      for (let i = 0; i < n; i++) {
        let x = (st.r[i] - st.l[i]) * k * sz, y = -(st.l[i] + st.r[i]) * k;
        const d = Math.hypot(x, y); if (d > r * 0.98) { x *= (r * 0.98) / d; y *= (r * 0.98) / d; }
        i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y);
      }
      g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = lw; g.stroke();
    };
    g.save(); g.lineJoin = 'round';
    const cols = ['#7fe6dc', '#f08aa4', '#e8e8f0'];
    const P = Math.round(opt.persistence);
    for (let p = P; p >= 1; p--) trace(S.t - p * 0.018, 80, cols[p % 3], 0.18 + 0.4 * (1 - p / (P + 1)), Math.max(1, unit * 0.0012));
    trace(S.t, 90, '#f6f0f2', 0.95, Math.max(1.2, unit * 0.0016));
    g.restore();

    // ---- correlation ----
    const st = A.stereo(S.t, 600, 0.3);
    let sl = 0, sr = 0, slr = 0;
    for (let i = 0; i < 600; i++) { sl += st.l[i] * st.l[i]; sr += st.r[i] * st.r[i]; slr += st.l[i] * st.r[i]; }
    const corr = sl > 1e-9 && sr > 1e-9 ? slr / Math.sqrt(sl * sr) : 1;
    const spaced = { spacing: unit * 0.008 };
    lab('CORRELATION', mx0, my, spaced);
    lab(`${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`, mx1, my, { align: 'right', color: '#fff' });
    const ly = my + unit * 0.036;
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(mx0, ly, mw, 1);
    for (const [v, s] of [[-1, '-1'], [0, '0'], [1, '+1']]) {
      const x = mx0 + ((v + 1) / 2) * mw;
      g.fillRect(x, ly - unit * 0.008, 1, unit * 0.016);
      lab(s, x, ly + unit * 0.03, { align: 'center', size: unit * 0.012 });
    }
    const cxm = mx0 + ((corr + 1) / 2) * mw;
    g.fillStyle = red; g.fillRect(cxm - unit * 0.003, ly - unit * 0.016, unit * 0.006, unit * 0.032);
    g.fillStyle = '#fff'; g.fillRect(cxm + unit * 0.0045, ly - unit * 0.012, 1.5, unit * 0.024);

    // ---- L / R level bars ----
    const db = (v) => 20 * Math.log10(v + 1e-9);
    const peakOf = (src, tt, span) => { const a = Math.max(0, Math.floor((tt - span) * A.sr)), b = Math.min(src.length, Math.floor(tt * A.sr)); let p = 0; for (let i = a; i < b; i += 3) { const v = Math.abs(src[i]); if (v > p) p = v; } return p; };
    const xdb = (d) => U.clamp(U.invLerp(-40, 0, d));
    const bx0 = mx0 + mw * 0.045, bw = mx1 - bx0, bh = Math.max(4, unit * 0.011);
    [['L', A.L], ['R', A.R]].forEach(([name, src], i) => {
      const y = ly + unit * 0.1 + i * unit * 0.058;
      // peak meter with a 12 dB/s release, plus a 1.5 s peak hold
      let lvl = 0, hold = 0;
      for (let j = 0; j < 30; j++) {
        const d = db(peakOf(src, S.t - j * 0.05, 0.05));
        lvl = Math.max(lvl, xdb(d - j * 0.05 * 12)); hold = Math.max(hold, xdb(d));
      }
      lab(name, mx0, y + bh * 0.4, { size: unit * 0.0125 });
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(bx0, y - bh / 2, bw, bh);
      g.fillStyle = red; g.fillRect(bx0, y - bh / 2, lvl * bw, bh);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(bx0 + hold * bw - 1, y - bh, 2, bh * 2);
    });
    const sy = ly + unit * 0.1 + unit * 0.058 + unit * 0.07;
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bx0, sy, bw, 1);
    lab('-40', bx0, sy + unit * 0.025, { size: unit * 0.012 });
    lab('0 dB', mx1, sy + unit * 0.025, { size: unit * 0.012, align: 'right' });
  },
});
