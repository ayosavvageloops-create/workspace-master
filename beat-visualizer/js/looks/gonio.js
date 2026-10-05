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
    return { pk: pk || 1 };
  },
  draw(g, S) {
    const { w, h, A, opt, unit } = S;
    g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
    const red = opt.accent;
    const lab = (s, x, y, o = {}) => U.text(g, s, x, y, { size: unit * 0.016, font: U.FONT.PLEX, color: 'rgba(255,255,255,0.55)', ...o });

    // layout: scope on top, meters below (portrait) or beside (landscape)
    let cx, cy, r, mx0, mx1, my;
    if (S.portrait) {
      r = w * 0.34; cx = w / 2; cy = h * 0.36; mx0 = w * 0.12; mx1 = w * 0.88; my = cy + r + h * 0.075;
    } else {
      r = h * 0.33; cx = w * 0.3; cy = h * 0.5; mx0 = w * 0.55; mx1 = w * 0.9; my = h * 0.3;
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
    // gentle auto-gain: fit the last half second, never boost quiet passages past 3x
    let lp = 0;
    for (let i = Math.max(0, Math.floor((S.t - 0.5) * A.sr)), e = Math.min(A.M.length, Math.floor(S.t * A.sr)); i < e; i += 7) lp = Math.max(lp, Math.abs(A.L[i]), Math.abs(A.R[i]));
    const k = (r * 0.62 * opt.gain) / Math.max(lp, S.cache.pk / 3), sz = opt.width;
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
    const st = A.stereo(S.t, 600, 0.12);
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
