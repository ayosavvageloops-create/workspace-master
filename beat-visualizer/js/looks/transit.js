// transit — the beat as a metro map: 12 octilinear lines (one per frequency band) radiate from a
// dense interchange; trains run on a line while its band is active and swell the stations they pass.
(function () {
  // 8 octilinear directions: E, SE, S, SW, W, NW, N, NE (y grows downward)
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const COLORS = ['#7b4fd6', '#3f9a3a', '#8aa422', '#d1a22a', '#ec9a22', '#16a6b8',
    '#1f6fb8', '#d6402e', '#c02f7a', '#7a5a3c', '#9a9a9a', '#6cc04a'];
  // arm directions per line: a designed spread so every compass point is served
  const ARMS = [[4, 7], [3, 7], [4, 0], [4, 1], [0, 5], [6, 2], [7, 1], [5, 2], [5, 1], [7, 3], [6, 3], [3, 6]];

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
        if (r() < 0.6) dir = (dir + (r() < 0.5 ? 1 : 7)) % 8;
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
      for (const [a, b, sgn] of [[mid, 0, -1], [mid, len, 1]]) {
        let s = a + sgn * (0.06 + r() * 0.03);
        while (sgn > 0 ? s < b - 0.045 : s > b + 0.045) { st.push(s); s += sgn * (0.065 + r() * 0.07); }
      }
      st.sort((a, b) => a - b);
      const trains = Array.from({ length: 4 }, (_, j) => ({ ph: r(), sp: (0.035 + r() * 0.03) * (j % 2 ? -1 : 1), th: 0.18 + 0.12 * j + r() * 0.1 }));
      lines.push({ color: COLORS[i], pts, cum, len, st, big: st.map(() => r()), trains });
    }
    return lines;
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

      // map square
      let mx, my, ms;
      if (S.portrait) { ms = w - pad * 1.0; mx = pad * 0.5; my = h * 0.022; }
      else { ms = h - pad * 1.4; mx = w - ms - pad * 1.2; my = pad * 0.7; }
      const P = (p) => [mx + p[0] * ms, my + p[1] * ms];
      const bands = A.bands12(S.t);
      const lw = unit * 0.0042, sr = unit * 0.0068;
      g.lineJoin = 'round'; g.lineCap = 'round';

      // lines
      C.lines.forEach((L, i) => {
        const b = bands[i];
        g.beginPath();
        L.pts.forEach((p, k) => { const q = P(p); k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
        g.strokeStyle = L.color; g.lineWidth = lw * (opt.swell ? 0.85 + 1.5 * b * b : 1); g.stroke();
      });

      // trains (positions are a pure function of time; a train shows while its band clears its threshold)
      let running = 0, inService = 0;
      const nT = Math.round(opt.trains), live = [];
      C.lines.forEach((L, i) => {
        const b = bands[i];
        if (b > 0.08) inService++;
        for (let j = 0; j < nT; j++) {
          const T = L.trains[j];
          if (b < T.th) continue;
          running++;
          const s = U.fract(T.ph + S.t * T.sp) * L.len;
          live.push({ i, s, b });
        }
      });

      // stations (swell when a train is at the platform)
      C.lines.forEach((L, i) => {
        L.st.forEach((s, k) => {
          let near = 0;
          for (const tr of live) if (tr.i === i) near = Math.max(near, 1 - Math.abs(tr.s - s) / 0.05);
          const term = k === 0 || k === L.st.length - 1;
          const q = P(posAt(L, s)), r = sr * (term ? 1.35 : 1) * (1 + 0.7 * Math.max(0, near));
          g.beginPath(); g.arc(q[0], q[1], r, 0, U.TAU);
          g.fillStyle = '#fff'; g.fill();
          g.strokeStyle = L.color; g.lineWidth = unit * 0.0026; g.stroke();
        });
      });
      for (const tr of live) {
        const L = C.lines[tr.i], q = P(posAt(L, tr.s));
        g.beginPath(); g.arc(q[0], q[1], sr * (0.9 + 0.5 * tr.b), 0, U.TAU);
        g.fillStyle = L.color; g.fill();
      }

      // info block
      let ix, iy;
      if (S.portrait) { ix = pad * 1.1; iy = h * 0.655; } else { ix = pad * 1.2; iy = h * 0.5; }
      U.text(g, S.meta.title, ix, iy, { size: unit * 0.05, font: U.FONT.TIGHT, weight: 700, color: ink, spacing: -1 });
      const rows = [
        ['Lines:', `${inService} of 12 in service`],
        ['Stations:', String(C.stations)],
        ['Trains running:', String(running)],
        ['Tempo:', `${Math.round(S.bpm)} BPM`],
        ...(S.meta.key ? [['Key:', S.meta.key]] : []),
        ['Integrated loudness:', `${A.lufs.integrated.toFixed(1)} LUFS`],
      ];
      const fs = unit * 0.0165;
      rows.forEach(([k, v], j) => {
        const y = iy + unit * 0.05 + j * fs * 1.45;
        const kw = U.text(g, k, ix, y, { size: fs, font: U.FONT.SANS, weight: 700, color: ink });
        U.text(g, v, ix + kw + fs * 0.3, y, { size: fs, font: U.FONT.SANS, color: '#2a2a2a' });
      });

      // scale bar: bars of the clip, red marker on the current bar
      const by = S.portrait ? h * 0.925 : h - pad * 0.9, bx = ix + unit * 0.045, bw = S.portrait ? w * 0.24 : w * 0.16, seg = bw / 8;
      U.text(g, 'BARS', ix, by - unit * 0.012, { size: unit * 0.0095, font: U.FONT.SANS, weight: 600, color: ink, spacing: 1 });
      for (let k = 0; k <= 8; k++) U.text(g, String(k), bx + k * seg, by - unit * 0.012, { size: unit * 0.0095, font: U.FONT.SANS, color: ink, align: 'center' });
      const bh = unit * 0.0055;
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#fff' : ink; g.fillRect(bx + k * seg, by, seg, bh); }
      g.strokeStyle = ink; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
      const cur = U.fract(Math.max(0, S.ct) / S.bar / 8) * 8;
      g.fillStyle = opt.accent; g.fillRect(bx + cur * seg - unit * 0.002, by - unit * 0.009, unit * 0.004, bh + unit * 0.012);
    },
  });
})();
