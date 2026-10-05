// stipple — a pen-stippled form on paper: thousands of fixed dots on a deformed sphere,
// shown or skipped by a lighting-driven density, so the shading reads like a drawing.
// The outline swells with the level and the bands; the light (and the dense side) drifts.
Looks.register({
  id: 'stipple',
  name: 'stipple',
  group: 'audio',
  theme: 'light',
  desc: 'a stippled form that breathes with the mix',
  defaults: { accent: '#141414', bg: '#efefea', dots: 18000, morph: 1, spin: 1 },
  controls: [
    { key: 'bg', label: 'Paper', type: 'color' },
    { key: 'dots', label: 'Dots', type: 'range', min: 6000, max: 30000, step: 1000 },
    { key: 'morph', label: 'Morph', type: 'range', min: 0, max: 2.5, step: 0.05 },
    { key: 'spin', label: 'Turn speed', type: 'range', min: 0, max: 3, step: 0.05 },
  ],
  prepare(S) {
    const { w, h, opt, unit } = S;
    const N = Math.round(opt.dots), r = U.rng(S.seed);
    const D = new Float32Array(N * 3), J = new Float32Array(N), Q = new Float32Array(N), Z = new Float32Array(N);
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      // jittered fibonacci sphere: even but not regular
      const y = 1 - (2 * (i + r())) / N, rad = Math.sqrt(Math.max(0, 1 - y * y)), a = i * ga + r() * 0.5;
      D[i * 3] = Math.cos(a) * rad; D[i * 3 + 1] = y; D[i * 3 + 2] = Math.sin(a) * rad;
      J[i] = r() < 0.03 ? 1 + r() * 0.12 : 1 - Math.pow(r(), 2) * 0.06; // a few strays outside the edge
      Q[i] = r();                                                          // keep threshold
      Z[i] = 0.5 + r() * r() * 1.4;                                             // dot size factor
    }
    // a few deformation lobes: direction, frequency, phase, which band drives it
    const lobes = [];
    const bands = ['sub', 'bass', 'lowmid', 'mid', 'highmid'];
    for (let k = 0; k < 5; k++) {
      const v = [r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...v);
      lobes.push({ v: v.map((x) => x / l), f: 1.1 + r() * 1.1, ph: r() * U.TAU, sp: 0.15 + r() * 0.25, a: 0.045 + r() * 0.04, band: bands[k] });
    }
    // a fixed, lumpy base form (so it reads as a stone / a head rather than a ball)
    const base = [];
    for (let k = 0; k < 6; k++) {
      const v = [r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...v);
      base.push({ v: v.map((x) => x / l), f: 1.2 + r() * 1.6, ph: r() * U.TAU, a: 0.05 + r() * 0.05 });
    }
    const B = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let b = 1;
      for (const o of base) b += o.a * Math.sin(o.f * (D[i * 3] * o.v[0] + D[i * 3 + 1] * o.v[1] + D[i * 3 + 2] * o.v[2]) * 2 + o.ph);
      // flatten the back/right a little, push a brow out at the upper left
      b *= 1 - 0.08 * Math.max(0, D[i * 3]) + 0.06 * Math.max(0, -D[i * 3 + 1] - D[i * 3]);
      B[i] = b;
    }
    const bg = U.layer(w, h, (g) => {
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      U.glowBlob(g, w * 0.5, h * 0.45, unit * 0.9, '#ffffff', 0.35);
      const vg = g.createRadialGradient(w / 2, h / 2, unit * 0.5, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,60,50,0.07)');
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
    }, 1);
    return { N, D, J, Q, Z, B, lobes, bg };
  },
  draw(g, S) {
    const { w, h, A, opt, unit, cache: C } = S;
    const { N, D, J, Q, Z, B, lobes } = C;
    g.drawImage(C.bg, 0, 0);
    const t = S.t;
    // everything that drives the form is averaged over a short window, so it breathes, not twitches
    const avg = (f, span, n = 6) => { let v = 0; for (let k = 0; k < n; k++) v += f(t - (k * span) / (n - 1)); return v / n; };
    const lvl = avg((x) => A.level(x), 0.3);

    // form: centre, size (taller than wide, like a head or a stone)
    const cx = w * (S.portrait ? 0.54 : 0.5), cy = h * (S.portrait ? 0.47 : 0.5);
    const R = S.portrait ? w * 0.25 : h * 0.2;
    const yaw = opt.spin * (t * 0.12 + 0.12 * Math.sin(t * 0.3)), pitch = 0.1 * Math.sin(t * 0.21);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // lobe amplitudes from the bands (smoothed a little by averaging two instants)
    const L = lobes.map((o) => {
      const e = avg((x) => A.band(x, o.band), 0.3);
      return { v: o.v, f: o.f, ph: o.ph + t * o.sp, a: opt.morph * o.a * (0.5 + 1.1 * e) };
    });
    const swell = 1 + 0.07 * lvl + 0.045 * avg((x) => A.pulse(x, 'bass', 0.3), 0.1, 4);
    // light from the right, drifting; the dense (shadowed) side is on the left
    const la = 0.35 + 0.35 * Math.sin(t * 0.13) + 0.2 * avg((x) => A.band(x, 'mid'), 0.6);
    const lx = Math.cos(la) * 0.85, ly = -0.25, lz = Math.sin(la) * 0.5 + 0.2;
    const ll = Math.hypot(lx, ly, lz);

    // three paths by how far a dot is inside the density threshold: dots near the
    // threshold are faint, so they fade in and out instead of popping
    const P3 = [new Path2D(), new Path2D(), new Path2D()];
    const ds = Math.max(1.5, unit * 0.0026);
    for (let i = 0; i < N; i++) {
      let x = D[i * 3], y = D[i * 3 + 1], z = D[i * 3 + 2];
      // radius from the lobes (object space, so the shape turns with the form)
      let rr = B[i];
      for (let k = 0; k < L.length; k++) {
        const o = L[k];
        rr += o.a * Math.sin(o.f * (x * o.v[0] + y * o.v[1] + z * o.v[2]) * 2 + o.ph);
      }
      rr *= swell * J[i];
      // rotate (yaw then pitch); view along +z
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      // shading: lambert on the base normal, stippled as density
      const lam = Math.max(0, (x1 * lx + y2 * ly + z2 * lz) / ll);
      const rim = 1 - Math.abs(z2); // silhouettes collect dots
      // the far side shows through faintly, like a cloud of stipple
      const dens = (0.16 + 0.8 * Math.pow(1 - lam, 2.2) + 0.07 * rim * rim) * (z2 < 0 ? 0.35 : 1);
      const mg = dens - Q[i];
      if (mg < 0) continue;
      const px = cx + x1 * rr * R * 1.02, py = cy + y2 * rr * R * 1.32;
      const s = ds * Z[i];
      P3[mg < 0.04 ? 0 : mg < 0.09 ? 1 : 2].rect(px, py, s, s);
    }
    g.fillStyle = opt.accent;
    g.globalAlpha = 0.28; g.fill(P3[0]);
    g.globalAlpha = 0.58; g.fill(P3[1]);
    g.globalAlpha = 0.88; g.fill(P3[2]);
    g.globalAlpha = 1;
  },
});
