// filament — a glowing white fractal tree in a cold blue haze. The tree is grown once
// (seeded); per frame only sway and brightness move: the trunk glows with the bass,
// the finest tips sparkle with the highs.
Looks.register({
  id: 'filament',
  name: 'filament',
  group: 'audio',
  theme: 'dark',
  desc: 'a glowing fractal tree in blue haze',
  defaults: { accent: '#cfe6ff', bg: '#05080b', depth: 7, sway: 1, haze: true },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'depth', label: 'Branching depth', type: 'range', min: 5, max: 9, step: 1 },
    { key: 'sway', label: 'Sway', type: 'range', min: 0, max: 3, step: 0.05 },
    { key: 'haze', label: 'Light cone', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, unit } = S;
    const r = U.rng(S.seed);
    const maxD = Math.round(opt.depth);
    // nodes: { p (parent index), a (angle relative to parent), len, d (depth), ph }
    const nodes = [];
    const grow = (parent, rel, len, d) => {
      const i = nodes.length;
      nodes.push({ p: parent, a: rel, len, d, ph: r() * U.TAU, bend: (r() - 0.5) * 0.25 });
      if (d >= maxD) return;
      const kids = d >= 2 && r() < 0.15 ? 1 : 2;
      for (let k = 0; k < kids; k++) {
        const spread = d === 0 ? 0.22 : 0.32 + r() * 0.3;
        const off = kids === 1 ? (r() - 0.5) * 0.5 : -spread + (2 * spread * k) / (kids - 1);
        const lf = d === 0 ? 0.62 : 0.74 + r() * 0.14;
        grow(i, off + (r() - 0.5) * 0.18, len * lf, d + 1);
      }
    };
    // three stems from the root, close together, like the reference trunk
    nodes.push({ p: -1, a: -Math.PI / 2, len: 0, d: -1, ph: 0, bend: 0 });
    for (let k = 0; k < 3; k++) grow(0, (k - 1) * 0.1 + (r() - 0.5) * 0.04, 0.3 - Math.abs(k - 1) * 0.04, 0);

    const geom = filament_geom(S);
    // haze cone + backdrop, full-res layer (cheap to blit)
    const bg = U.layer(w, h, (g) => {
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      if (opt.haze) {
        const cw = geom.size * 1.25, top = geom.by - geom.size * 2.25;
        g.save();
        g.filter = `blur(${Math.round(unit * 0.09)}px)`;
        const gr = g.createLinearGradient(0, top, 0, geom.by);
        gr.addColorStop(0, 'rgba(30,48,62,0)'); gr.addColorStop(0.35, 'rgba(32,52,66,0.32)'); gr.addColorStop(1, 'rgba(38,60,74,0.4)');
        g.fillStyle = gr;
        U.rrect(g, geom.bx - cw / 2, top, cw, geom.by - top + unit * 0.05, cw / 2);
        g.fill();
        g.restore();
        U.glowBlob(g, geom.bx, geom.by - geom.size * 0.5, geom.size * 0.8, '#2e4c5e', 0.2);
      }
      // a few specks of dust
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(190,215,235,${0.1 + r() * 0.25})`;
        g.fillRect(geom.bx + (r() - 0.5) * geom.size * 1.2, geom.by - r() * geom.size * 1.5, 1.5, 1.5);
      }
    }, 1);
    return { nodes, maxD, bg, geom, X: new Float32Array(nodes.length), Y: new Float32Array(nodes.length), A: new Float32Array(nodes.length) };
  },
  draw(g, S) {
    const { A, opt, unit, cache: C } = S;
    const { nodes, geom, X, Y } = C, AN = C.A;
    g.drawImage(C.bg, 0, 0);
    const t = S.t;
    const bass = A.band(t, 'bass'), sub = A.band(t, 'sub'), high = A.band(t, 'high'), hm = A.band(t, 'highmid');
    const lvl = A.level(t), kick = A.pulse(t, 'bass', 0.25);

    // positions for this frame: sway grows with depth, pushed by level
    const sw = opt.sway * (0.012 + 0.03 * lvl);
    X[0] = geom.bx; Y[0] = geom.by; AN[0] = -Math.PI / 2;
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      const a = AN[n.p] + n.a + sw * (n.d + 1) * 0.35 * Math.sin(t * 0.9 + n.ph) + 0.004 * opt.sway * Math.sin(t * 0.5);
      AN[i] = a;
      const L = n.len * geom.size;
      X[i] = X[n.p] + Math.cos(a) * L; Y[i] = Y[n.p] + Math.sin(a) * L;
    }

    // base glow pulses with the bass
    U.glowBlob(g, geom.bx, geom.by - geom.size * 0.04, geom.size * (0.1 + 0.08 * kick), '#cfe6ff', 0.1 + 0.25 * Math.max(bass, sub));

    g.lineCap = 'round';
    g.lineJoin = 'round';
    // draw by depth: a wide faint blue pass (glow), then the white filament
    for (let pass = 0; pass < 2; pass++) {
      for (let d = 0; d <= C.maxD; d++) {
        g.beginPath();
        for (let i = 1; i < nodes.length; i++) {
          const n = nodes[i];
          if (n.d !== d) continue;
          const mx = (X[n.p] + X[i]) / 2 + Math.cos(AN[i] + Math.PI / 2) * n.bend * n.len * geom.size * 0.5;
          const my = (Y[n.p] + Y[i]) / 2 + Math.sin(AN[i] + Math.PI / 2) * n.bend * n.len * geom.size * 0.5;
          g.moveTo(X[n.p], Y[n.p]); g.quadraticCurveTo(mx, my, X[i], Y[i]);
        }
        const wd = Math.max(1, unit * 0.0065 * Math.pow(0.66, d));
        // trunk brightness from the bass, fine branches from the upper mids
        const e = d <= 2 ? 0.55 + 0.45 * Math.max(bass, kick) : 0.55 + 0.35 * (d / C.maxD) * hm + 0.2 * lvl;
        if (pass === 0) {
          g.strokeStyle = `rgba(140,185,230,${0.16 * e})`;
          g.lineWidth = wd * 4 + unit * 0.005;
        } else {
          g.strokeStyle = `rgba(232,242,255,${Math.min(1, 0.55 + 0.45 * e)})`;
          g.lineWidth = wd;
        }
        g.stroke();
      }
    }

    // sparkles on the finest tips: which ones light follows the highs, re-rolled 12x per second
    const step = Math.floor(t * 12), p = 0.02 + 0.16 * Math.max(high * high, A.pulse(t, 'high', 0.15));
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.d < C.maxD - 1) continue;
      const hsh = U.hash(i, step);
      if (hsh > p) continue;
      const rr = unit * (0.002 + 0.0028 * (1 - hsh / p));
      U.glowBlob(g, X[i], Y[i], rr * 3.5, U.hash(i, 9) < 0.35 ? '#ffe9b0' : opt.accent, 0.5);
      g.fillStyle = U.hash(i, 9) < 0.35 ? '#fff2cc' : '#f2f8ff';
      g.fillRect(X[i] - rr / 2, Y[i] - rr / 2, rr, rr);
    }
  },
});

function filament_geom(S) {
  const { w, h } = S;
  const size = S.portrait ? Math.min(w * 0.6, h * 0.34) : h * 0.5; // tree height scale
  return { bx: w / 2, by: S.portrait ? h * 0.94 : h * 0.95, size };
}
