// transit — the beat as a metro map: 12 octilinear lines (one per frequency band) radiate from a
// dense interchange; trains run on a line while its band is active and swell the stations they pass.
(function () {
  // 8 octilinear directions: E, SE, S, SW, W, NW, N, NE (y grows downward)
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const COLORS = ['#7b4fd6', '#3f9a3a', '#8aa422', '#d1a22a', '#ec9a22', '#16a6b8',
    '#1f6fb8', '#d6402e', '#c02f7a', '#7a5a3c', '#9a9a9a', '#6cc04a'];
  // arm directions per line: a designed spread so every compass point is served
  const ARMS = [[4, 7], [3, 7], [4, 0], [4, 1], [0, 5], [6, 2], [7, 1], [6, 2], [5, 1], [7, 3], [5, 2], [2, 6]];

  function buildMap(seed) {
    const r = U.rng(seed), M = 0.03;
    const room = (p, d) => {
      const [dx, dy] = DIRS[d];
      const tx = dx > 0 ? (1 - M - p[0]) / dx : dx < 0 ? (M - p[0]) / dx : Infinity;
      const ty = dy > 0 ? (1 - M - p[1]) / dy : dy < 0 ? (M - p[1]) / dy : Infinity;
      return Math.max(0, Math.min(tx, ty));
    };
    const lines = [];
    const cx = 0.5, cy = 0.47, sp = 0.024;
    for (let i = 0; i < 12; i++) {
      const o = [cx + (Math.floor(r() * 7) - 3) * sp, cy + (Math.floor(r() * 7) - 3) * sp];
      const arms = ARMS[i].map((d) => {
        const pts = [o.slice()];
        let p = o.slice(), dir = d;
        // optional short orthogonal jog out of the interchange
        if (r() < 0.35) {
          const jd = (d + (r() < 0.5 ? 2 : 6)) % 8, L = Math.min(room(p, jd), sp * (1 + Math.floor(r() * 2)));
          p = [p[0] + DIRS[jd][0] * L, p[1] + DIRS[jd][1] * L]; pts.push(p.slice());
        }
        // main run, then maybe one 45° bend
        const L1 = room(p, dir) * (0.22 + r() * 0.35);
        p = [p[0] + DIRS[dir][0] * L1, p[1] + DIRS[dir][1] * L1]; pts.push(p.slice());
        if (r() < 0.45) dir = (dir + (r() < 0.5 ? 1 : 7)) % 8;
        const L2 = room(p, dir) * (0.62 + r() * 0.38);
        p = [p[0] + DIRS[dir][0] * L2, p[1] + DIRS[dir][1] * L2]; pts.push(p.slice());
        return pts;
      });
      // full path: terminus A → interchange → terminus B
      const pts = arms[0].slice().reverse().concat(arms[1].slice(1));
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const len = cum[cum.length - 1];
      // stations: termini, the interchange, and stops at irregular spacing
      const st = [0, len];
      const mid = cum[arms[0].length - 1];
      st.push(mid);
      const rs = U.rng(seed * 31 + i * 977 + 5); // separate stream so station spacing never reshapes the network
      for (const [a, b, sgn] of [[mid, 0, -1], [mid, len, 1]]) {
        let s = a + sgn * (0.07 + rs() * 0.04);
        while (sgn > 0 ? s < b - 0.06 : s > b + 0.06) { st.push(s); s += sgn * (0.15 + rs() * 0.1); }
      }
      st.sort((a, b) => a - b);
      const trains = Array.from({ length: 4 }, (_, j) => ({ ph: rs(), sp: (0.035 + rs() * 0.03) * (j % 2 ? -1 : 1), th: 0.18 + 0.12 * j + rs() * 0.1 }));
      lines.push({ color: COLORS[i], pts, cum, len, st, trains });
    }
    return lines;
  }
  // Splits a title into at most two lines that fit `max` (the second line is ellipsised by U.text).
  function wrapTitle(g, str, max, size) {
    const o = { size, font: U.FONT.TIGHT, weight: 700, spacing: -1 };
    const words = String(str || '').split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    for (const wd of words) {
      const t = cur ? cur + ' ' + wd : wd;
      if (!cur || U.textWidth(g, t, o) <= max) cur = t; else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    return lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines.length ? lines : [''];
  }
  function posAt(L, s) {
    s = U.clamp(s, 0, L.len);
    let k = 1;
    while (k < L.cum.length - 1 && L.cum[k] < s) k++;
    const a = L.pts[k - 1], b = L.pts[k], seg = L.cum[k] - L.cum[k - 1] || 1, u = (s - L.cum[k - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }

  Looks.register({
    id: 'transit',
    name: 'transit',
    group: 'audio',
    theme: 'light',
    desc: 'a metro map whose 12 lines run on the 12 frequency bands',
    defaults: { accent: '#e0322a', bg: '#ffffff', variant: 0, trains: 4, swell: true },
    controls: [
      { key: 'bg', label: 'Paper', type: 'color' },
      { key: 'variant', label: 'Network', type: 'range', min: 0, max: 20, step: 1 },
      { key: 'trains', label: 'Trains per line', type: 'range', min: 1, max: 4, step: 1 },
      { key: 'swell', label: 'Lines swell with band', type: 'toggle' },
    ],
    prepare(S) {
      const lines = buildMap(S.seed + Math.round(S.opt.variant) * 7919);
      return { lines, stations: lines.reduce((n, l) => n + l.st.length, 0) };
    },
    draw(g, S) {
      const { w, h, pad, A, opt, unit } = S;
      const C = S.cache, ink = '#141414';
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

      // ---- layout: map square plus an info block that stays clear of the handle strip ----
      const bot = (S.portrait ? h - unit * 0.16 : h - pad * 0.9) - unit * 0.045;
      let tSize = unit * 0.05, fs = unit * 0.0165;
      const rowsN = S.meta.key ? 6 : 5;
      let mx, my, ms, ix, colW, side = h / w < 1.1;
      if (!side) {
        ix = pad * 1.1; colW = w - ix * 2;
        const lines = wrapTitle(g, S.meta.title, colW, tSize).length;
        const blockH = lines * tSize * 1.12 + unit * 0.05 + rowsN * fs * 1.45 + unit * 0.09;
        my = pad * 0.4; ms = Math.min(w - pad, bot - my - blockH - unit * 0.06); mx = (w - ms) / 2;
      } else {
        ms = Math.min(h - pad * 1.4, w * 0.6); mx = w - ms - pad * 1.0; my = (h - ms) / 2;
        ix = pad * 1.2; colW = mx - ix - pad * 0.8;
        // a narrow column (1:1) gets proportionally smaller type
        tSize = Math.min(tSize, colW * 0.12); fs = Math.min(fs, colW / 19);
      }
      const P = (p) => [mx + p[0] * ms, my + p[1] * ms];
      // bands averaged over the last quarter second so lines and trains do not flicker
      const bands = new Float32Array(12);
      for (let k = 0; k < 5; k++) { const b = A.bands12(S.t - k * 0.05); for (let i = 0; i < 12; i++) bands[i] += b[i] / 5; }
      const lw = unit * 0.0042 * Math.min(1, ms / (w - pad)) ** 0.5, sr = unit * 0.0068 * Math.min(1, ms / (w - pad)) ** 0.5;
      g.lineJoin = 'round'; g.lineCap = 'round';

      // lines
      C.lines.forEach((L, i) => {
        const b = bands[i];
        g.beginPath();
        L.pts.forEach((p, k) => { const q = P(p); k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
        g.strokeStyle = L.color; g.lineWidth = lw * (opt.swell ? 0.85 + 1.5 * b * b : 1); g.stroke();
      });

      // trains: they hop on the beat (glide for 60 % of a beat, then dwell) and fade in with their band
      const bt = (S.t - A.beatOffset) / S.spb, bi = Math.floor(bt), bp = U.easeInOut(Math.min(1, (bt - bi) / 0.6));
      let running = 0, inService = 0;
      const nT = Math.round(opt.trains), live = [];
      C.lines.forEach((L, i) => {
        const b = bands[i];
        if (b > 0.08) inService++;
        for (let j = 0; j < nT; j++) {
          const T = L.trains[j], vis = U.smooth(T.th, T.th + 0.08, b);
          if (vis <= 0.02) continue;
          if (vis > 0.5) running++;
          const s = U.fract(T.ph + (bi + bp) * T.sp * S.spb) * L.len;
          live.push({ i, s, b, vis });
        }
      });

      // stations (swell when a train is at the platform)
      C.lines.forEach((L, i) => {
        L.st.forEach((s, k) => {
          let near = 0;
          for (const tr of live) if (tr.i === i) near = Math.max(near, (1 - Math.abs(tr.s - s) / 0.05) * tr.vis);
          const term = k === 0 || k === L.st.length - 1;
          const q = P(posAt(L, s)), r = sr * (term ? 1.35 : 1) * (1 + 0.7 * Math.max(0, near));
          g.beginPath(); g.arc(q[0], q[1], r, 0, U.TAU);
          g.fillStyle = '#fff'; g.fill();
          g.strokeStyle = L.color; g.lineWidth = unit * 0.0026; g.stroke();
        });
      });
      for (const tr of live) {
        const L = C.lines[tr.i], q = P(posAt(L, tr.s));
        g.beginPath(); g.arc(q[0], q[1], sr * (0.9 + 0.5 * tr.b) * tr.vis, 0, U.TAU);
        g.fillStyle = L.color; g.fill();
      }

      // ---- info block ----
      const tl = wrapTitle(g, S.meta.title, colW, tSize);
      const blockH = tl.length * tSize * 1.12 + unit * 0.05 + rowsN * fs * 1.45 + unit * 0.09;
      let iy = side ? bot - blockH + tSize : Math.min(my + ms + unit * 0.06 + tSize + (bot - (my + ms + unit * 0.06) - blockH) * 0.35, bot - blockH + tSize);
      tl.forEach((ln, k) => U.text(g, ln, ix, iy + k * tSize * 1.12, { size: tSize, font: U.FONT.TIGHT, weight: 700, color: ink, spacing: -1, max: colW }));
      iy += (tl.length - 1) * tSize * 1.12;
      const rows = [
        ['Lines:', `${inService} of 12 in service`],
        ['Stations:', String(C.stations)],
        ['Trains running:', String(running)],
        ['Tempo:', `${Math.round(S.bpm)} BPM`],
        ...(S.meta.key ? [['Key:', S.meta.key]] : []),
        ['Integrated loudness:', `${A.lufs.integrated.toFixed(1)} LUFS`],
      ];
      let y = iy;
      rows.forEach(([k, v], j) => {
        y = iy + unit * 0.05 + j * fs * 1.45;
        const kw = U.text(g, k, ix, y, { size: fs, font: U.FONT.SANS, weight: 700, color: ink });
        U.text(g, v, ix + kw + fs * 0.3, y, { size: fs, font: U.FONT.SANS, color: '#2a2a2a', max: colW - kw - fs * 0.3 });
      });

      // scale bar: bars from the beat grid origin, red marker on the current bar
      const by = y + unit * 0.07, bx = ix + unit * 0.045, bw = Math.min(w * 0.24, colW - unit * 0.05), seg = bw / 8;
      U.text(g, 'BARS', ix, by - unit * 0.012, { size: unit * 0.0095, font: U.FONT.SANS, weight: 600, color: ink, spacing: 1 });
      for (let k = 0; k <= 8; k++) U.text(g, String(k), bx + k * seg, by - unit * 0.012, { size: unit * 0.0095, font: U.FONT.SANS, color: ink, align: 'center' });
      const bh = unit * 0.0055;
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#fff' : ink; g.fillRect(bx + k * seg, by, seg, bh); }
      g.strokeStyle = ink; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
      const cur = U.fract(Math.max(0, S.t - A.beatOffset) / S.bar / 8) * 8;
      g.fillStyle = opt.accent; g.fillRect(bx + cur * seg - unit * 0.002, by - unit * 0.009, unit * 0.004, bh + unit * 0.012);
    },
  });
})();
