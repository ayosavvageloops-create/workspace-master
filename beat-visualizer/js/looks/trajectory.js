// trajectory — the parts as paths through a 3D box: TIME across, PITCH up and the mix's
// BRIGHTNESS (spectral centroid) in depth. Notes are dots joined into zig-zag melody lines;
// the camera drifts slowly round the box, with a spectrogram strip and loudness readout below.
(function () {
  const ROLE_COL = { bass: '#f0a33c', chords: '#3fd3bb', lead: '#f2677a', drums: '#e8d25a', other: '#8fb4ff' };
  const colOf = (p) => ROLE_COL[p.role] || ROLE_COL.other;
  const gridOff = (S) => (!S.hasMidi && S.A && S.A.beatOffset) || 0;
  const RATE = 20; // brightness samples per second

  Looks.register({
    id: 'trajectory',
    name: 'trajectory',
    group: 'midi',
    theme: 'dark',
    desc: 'notes as a 3D path: time, pitch and brightness inside a slowly turning box',
    defaults: { accent: '#ffffff', bg: '#05080a', page: 4, spin: 1, trail: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'page', label: 'Bars in the box', type: 'select', options: [1, 2, 4, 8] },
      { key: 'spin', label: 'Camera drift', type: 'range', min: 0, max: 3, step: 0.1 },
      { key: 'trail', label: 'Brightness trail', type: 'toggle' },
    ],
    prepare(S) {
      const { A, w, h } = S;
      // brightness = centroid of the 12 log bands, normalised over the track
      const n = A ? Math.max(2, Math.ceil(A.dur * RATE)) : 2;
      const br = new Float32Array(n);
      let mn = 1, mx = 0;
      for (let i = 0; i < n; i++) {
        if (!A) break;
        const b = A.bands12(i / RATE);
        let s = 0, ws = 0;
        for (let k = 0; k < 12; k++) { s += b[k]; ws += b[k] * k; }
        const c = s > 1e-4 ? ws / s / 11 : 0;
        br[i] = c; if (s > 0.05) { mn = Math.min(mn, c); mx = Math.max(mx, c); }
      }
      if (mx <= mn) { mn = 0; mx = 1; }
      for (let i = 0; i < n; i++) br[i] = U.clamp((br[i] - mn) / (mx - mn));
      // spectrogram strip over the clip (12 rows, one column per ~1/12 s)
      const cols = 240, strip = document.createElement('canvas');
      strip.width = cols; strip.height = 12;
      const sg = strip.getContext('2d');
      sg.fillStyle = '#120f22'; sg.fillRect(0, 0, cols, 12);
      if (A) {
        for (let c = 0; c < cols; c++) {
          const b = A.bands12(S.clipStart + (c / cols) * S.clipLen);
          for (let k = 0; k < 12; k++) {
            const v = U.clamp(b[k]);
            sg.fillStyle = U.mix('#120e24', '#9a86f5', Math.pow(v, 3) * 0.75);
            sg.fillRect(c, 11 - k, 1, 1);
          }
        }
      }
      return { br, strip, n };
    },
    draw(g, S) {
      const { w, h, unit, pad, opt, parts, t, A, portrait } = S;
      const { br, n: nBr, strip } = S.cache;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      const bAt = (tt) => {
        const x = U.clamp(tt * RATE, 0, nBr - 1), i = Math.floor(x), f = x - i;
        return br[i] * (1 - f) + br[Math.min(nBr - 1, i + 1)] * f;
      };

      // oblique camera that drifts slowly
      const th = 1.1 + 0.16 * Math.sin(t * 0.21 * opt.spin) * (opt.spin > 0 ? 1 : 0);
      const D = portrait ? w * 0.36 : h * 0.24;
      const DX = D * Math.cos(th), DY = D * Math.sin(th);
      const L = portrait ? w * 0.1 : w * 0.26, Rt = portrait ? w * 0.93 : w * 0.74;
      const T = portrait ? h * 0.12 : h * 0.13, B = portrait ? h * 0.87 : h * 0.8;
      const DXm = D * Math.cos(0.94), DYm = D * Math.sin(1.26);
      const FW = Rt - L - DXm, FH = B - T - DYm;
      const P = (x, y, z) => [L + x * FW + z * DX, B - y * FH - z * DY];
      const line = (a, b) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); };

      // box
      g.lineWidth = Math.max(1, unit * 0.0012);
      g.strokeStyle = 'rgba(150,175,165,0.16)';
      g.beginPath();
      for (const k of [0.25, 0.5, 0.75]) { line(P(0, k, 1), P(1, k, 1)); line(P(0, k, 0), P(0, k, 1)); line(P(k, 0, 0), P(k, 0, 1)); }
      g.stroke();
      g.strokeStyle = 'rgba(160,185,175,0.38)';
      g.beginPath();
      for (const z of [0, 1]) { line(P(0, 0, z), P(1, 0, z)); line(P(1, 0, z), P(1, 1, z)); line(P(1, 1, z), P(0, 1, z)); line(P(0, 1, z), P(0, 0, z)); }
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) line(P(x, y, 0), P(x, y, 1));
      g.stroke();

      // page of notes
      const off = gridOff(S), pageLen = S.bar * (+opt.page || 4);
      const p0 = off + Math.floor((t - off) / pageLen) * pageLen, p1 = p0 + pageLen;
      let lo = 127, hi = 0, count = 0;
      const sets = parts.map((p) => {
        const ns = Parts.inRange(p, p0, p1).filter((n) => n.s >= p0 - 1e-6).sort((a, b) => a.s - b.s || a.p - b.p);
        for (const n of ns) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
        count += ns.length;
        return { p, ns };
      });
      if (lo > hi) { lo = 36; hi = 72; }
      if (hi - lo < 6) { lo -= 3; hi += 3; }
      const X = (tt) => (tt - p0) / pageLen, Y = (p) => 0.04 + 0.92 * (p - lo) / (hi - lo), Z = (tt) => 0.04 + 0.3 * bAt(tt);

      // brightness trail (mix centroid over the page)
      if (opt.trail && A) {
        const N = 40;
        for (let k = 0; k <= N; k++) {
          const tt = p0 + (k / N) * pageLen, b = bAt(tt), lv = A.level(tt);
          const q = P(k / N, 0.05 + 0.85 * b, b);
          const past = tt <= t;
          g.fillStyle = past ? 'rgba(40,170,140,0.75)' : 'rgba(40,170,140,0.22)';
          g.beginPath(); g.arc(q[0], q[1], Math.max(1.2, unit * (0.002 + 0.007 * lv * (k % 4 === 0 ? 1 : 0.4))), 0, U.TAU); g.fill();
        }
      }

      // melody paths
      let curPt = null;
      for (const { p, ns } of sets) {
        if (!ns.length) continue;
        const col = colOf(p);
        const pts = ns.map((n) => ({ n, q: P(X(n.s), Y(n.p), Z(n.s)) }));
        g.lineWidth = Math.max(1, unit * 0.0016);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], past = b.n.s <= t;
          g.strokeStyle = U.rgba(col, past ? 0.85 : 0.35);
          g.beginPath(); line(a.q, b.q); g.stroke();
        }
        for (const { n, q } of pts) {
          const past = n.s <= t, live = past && n.e > t;
          g.fillStyle = U.rgba(col, past ? 1 : 0.45);
          g.beginPath(); g.arc(q[0], q[1], unit * (live ? 0.0075 : past ? 0.0055 : 0.0035), 0, U.TAU); g.fill();
          if (live && (!curPt || n.p > curPt.p)) curPt = { q, p: n.p };
        }
      }
      if (curPt) {
        g.strokeStyle = opt.accent; g.lineWidth = Math.max(1.2, unit * 0.002);
        g.beginPath(); g.arc(curPt.q[0], curPt.q[1], unit * 0.012, 0, U.TAU); g.stroke();
        g.fillStyle = opt.accent; g.beginPath(); g.arc(curPt.q[0], curPt.q[1], unit * 0.0035, 0, U.TAU); g.fill();
      }

      // axis labels
      const lab = { size: unit * 0.0125, font: U.FONT.MONO, color: 'rgba(190,205,200,0.5)', spacing: 2 };
      const a0 = P(0, 1, 0), a1 = P(0, 0, 0), am = P(0, 0.5, 0), tb = P(0.5, 0, 0), bz = P(1, 0, 0.5);
      U.text(g, U.noteName(hi), a0[0] - unit * 0.012, a0[1] + unit * 0.005, { ...lab, align: 'right', spacing: 0 });
      U.text(g, U.noteName(lo), a1[0] - unit * 0.012, a1[1] + unit * 0.005, { ...lab, align: 'right', spacing: 0 });
      U.text(g, 'PITCH', am[0] + unit * 0.012, am[1], lab);
      U.text(g, 'TIME', tb[0], tb[1] + unit * 0.03, { ...lab, align: 'center' });
      U.text(g, 'BRIGHTNESS', bz[0] + unit * 0.02, bz[1] + unit * 0.01, lab);
      if (!parts.length) U.text(g, 'NO NOTES', (L + Rt) / 2, (T + B) / 2, { ...lab, size: unit * 0.016, align: 'center', spacing: 5 });

      // header
      const hx = pad * 0.9, hy = portrait ? h * 0.075 : pad + unit * 0.02;
      U.text(g, [`${Math.max(0, S.ct).toFixed(1)} s`, `RANGE ${U.noteName(lo)}–${U.noteName(hi)}`, `${count} NOTES`, `BRIGHT ${Math.round(bAt(t) * 30)}`].join('  ·  '),
        hx, hy, { size: unit * 0.0145, font: U.FONT.MONO, color: 'rgba(190,205,200,0.5)', spacing: 2 });

      // spectrogram strip + footer
      const sx0 = pad * 0.9, sx1 = w - pad * 0.9, sy = portrait ? h * 0.892 : h * 0.86, sh = portrait ? h * 0.04 : h * 0.055;
      g.imageSmoothingEnabled = false;
      g.drawImage(strip, sx0, sy, sx1 - sx0, sh);
      g.imageSmoothingEnabled = true;
      const px = sx0 + S.prog * (sx1 - sx0);
      g.fillStyle = opt.accent; g.fillRect(px - 1.5, sy - unit * 0.004, 3, sh + unit * 0.008);
      const lufs = A && A.lufs ? `${A.lufs.integrated.toFixed(1)} LUFS` : '';
      U.text(g, [String(S.meta.title || 'untitled').toUpperCase(), S.sub, lufs].filter(Boolean).join(' · '),
        sx0, sy + sh + unit * 0.035, { size: unit * 0.0135, font: U.FONT.MONO, color: 'rgba(190,205,200,0.5)', spacing: 1.5 });
    },
  });
})();
