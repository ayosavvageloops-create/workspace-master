// lidar — a LIDAR point cloud of a dark domed room: rows of dotted scan segments on a floor in
// perspective; the spectrum lights a ridge of segments across the field and its recent past
// trails toward the viewer like a scanner sweep.
Looks.register({
  id: 'lidar',
  name: 'lidar',
  group: 'audio',
  theme: 'dark',
  desc: 'a LIDAR point-cloud room lit by the spectrum',
  defaults: { accent: '#7fd6e4', bg: '#04070c', rows: 32, trail: 6, sweep: true },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'rows', label: 'Scan rows', type: 'range', min: 24, max: 64, step: 2 },
    { key: 'trail', label: 'Trail', type: 'range', min: 0, max: 10, step: 1 },
    { key: 'sweep', label: 'Scanner sweep', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, unit } = S;
    const hy = S.portrait ? h * 0.3 : h * 0.18, bottom = S.portrait ? h * 0.84 : h * 0.98;
    const R = Math.round(opt.rows), cells = [];
    const halfNear = S.portrait ? w * 0.62 : w * 0.5;
    const rows = [];
    for (let k = 0; k < R; k++) {
      const s = k / (R - 1);                                 // 0 near … 1 far
      const y = bottom - (bottom - hy) * Math.pow(s, 0.75);
      const d = U.lerp(1, 0.3, Math.pow(s, 0.9));            // perspective scale
      const ext = Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.25) / 0.78, 2))); // dome: widest a little above the near edge
      rows.push({ s, y, d, half: halfNear * (0.4 + 0.6 * d) * ext });
    }
    // cells: segments of dots in world X (-1..1), staggered per row
    const NC = 24;
    rows.forEach((r, k) => {
      for (let c = 0; c < NC; c++) {
        if (U.hash(k, c, 1) < 0.18) continue;
        const X0 = -1 + (c + U.hash(k, c, 2) * 0.35) * (2 / NC);
        const frac = 0.45 + U.hash(k, c, 3) * 0.4;
        const x0 = w / 2 + X0 * r.half, x1 = w / 2 + (X0 + frac * (2 / NC)) * r.half;
        if (x1 < -10 || x0 > w + 10) continue;
        const gap = Math.max(2.6, unit * 0.0105 * r.d);
        const n = Math.max(2, Math.floor((x1 - x0) / gap));
        cells.push({ k, s: r.s, y: r.y, x0, gap, n, sz: Math.max(1.4, unit * 0.0062 * r.d), band: (X0 + frac / NC + 1) / 2, base: 0.25 + U.hash(k, c, 4) * 0.55, d: r.d });
      }
    });
    const back = U.layer(w, h, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, opt.bg); gr.addColorStop(0.45, U.mix(opt.bg, '#0c2236', 0.6)); gr.addColorStop(1, '#000000');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w / 2, hy + (bottom - hy) * 0.45); g.scale(1, 0.5);
      U.glowBlob(g, 0, 0, w * 0.75, '#12324a', 0.55);
      g.restore();
    });
    const front = U.layer(w, h, (g) => {
      const fb = g.createLinearGradient(0, h * 0.7, 0, h);
      fb.addColorStop(0, 'rgba(0,0,0,0)'); fb.addColorStop(1, 'rgba(0,0,0,0.92)');
      g.fillStyle = fb; g.fillRect(0, h * 0.7, w, h * 0.3);
      const v = g.createRadialGradient(w / 2, h * 0.55, S.unit * 0.4, w / 2, h * 0.55, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
      g.fillStyle = v; g.fillRect(0, 0, w, h);
    });
    return { cells, back, front, R };
  },
  draw(g, S) {
    const { w, h, A, opt } = S;
    const C = S.cache;
    g.drawImage(C.back, 0, 0);
    // ridge positions for now and the recent past (pure function of time)
    const T = Math.round(opt.trail), hist = [];
    for (let k = 0; k <= T; k++) hist.push(Float32Array.from(A.bands12(S.t - k * 0.09)));
    const bandAt = (arr, u) => { const x = U.clamp(u) * 11, i = Math.floor(x), f = x - i; return arr[i] * (1 - f) + arr[Math.min(11, i + 1)] * f; };
    const sweep = opt.sweep ? U.fract(S.t / (S.spb * 2)) : -1;
    const NB = 8, dim = Array.from({ length: NB }, () => []), lit = Array.from({ length: NB }, () => []), cy = Array.from({ length: NB }, () => []);
    for (const c of C.cells) {
      let best = 0, bestK = 0;
      for (let k = 0; k <= T; k++) {
        const v = bandAt(hist[k], c.band);
        const sr = 0.2 + 0.55 * Math.pow(v, 1.3) - k * 0.035;
        const dd = (c.s - sr) / 0.05, e = Math.exp(-dd * dd) * (1 - k / (T + 1.5)) * U.smooth(0.15, 0.45, v);
        if (e > best) { best = e; bestK = k; }
      }
      let base = c.base * (0.6 + 0.4 * c.d);
      if (sweep >= 0) { const ds = (c.s - sweep) / 0.05; base += 0.35 * Math.exp(-ds * ds); }
      let bucket, b;
      if (best > 0.2 && bestK <= 1) { bucket = lit; b = Math.min(NB - 1, Math.floor(best * NB)); }
      else if (best > 0.2) { bucket = cy; b = Math.min(NB - 1, Math.floor(best * NB)); }
      else { bucket = dim; b = Math.min(NB - 1, Math.floor(U.clamp(base + best) * NB)); }
      bucket[b].push(c);
    }
    const paint = (list, color, alpha, grow) => {
      if (!list.length) return;
      g.beginPath();
      for (const c of list) {
        const s = c.sz * grow, o = s / 2;
        for (let i = 0; i < c.n; i++) g.rect(c.x0 + i * c.gap - o, c.y - o, s, s);
      }
      g.globalAlpha = alpha; g.fillStyle = color; g.fill();
    };
    for (let b = 0; b < NB; b++) paint(dim[b], b > 5 ? '#7cc4e2' : '#4596c8', Math.min(1, 0.3 + 0.95 * (b / NB)), 1);
    for (let b = 0; b < NB; b++) {
      paint(cy[b], opt.accent, 0.08 * (b / NB), 2.6);
      paint(cy[b], opt.accent, 0.35 + 0.6 * (b / NB), 1.05);
    }
    for (let b = 0; b < NB; b++) {
      paint(lit[b], '#cfeee6', 0.1 * (b / NB), 3);
      paint(lit[b], '#f2fbf5', 0.5 + 0.5 * (b / NB), 1.15);
    }
    g.globalAlpha = 1;
    g.drawImage(C.front, 0, 0);
  },
});
