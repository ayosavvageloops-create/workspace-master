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
      Z[i] = 0.6 + r() * 0.8;                                              // dot size factor
    }
    // a few deformation lobes: direction, frequency, phase, which band drives it
    const lobes = [];
    const bands = ['sub', 'bass', 'lowmid', 'mid', 'highmid'];
    for (let k = 0; k < 5; k++) {
      const v = [r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...v);
      lobes.push({ v: v.map((x) => x / l), f: 1.4 + r() * 1.8, ph: r() * U.TAU, sp: 0.15 + r() * 0.25, a: 0.07 + r() * 0.06, band: bands[k] });
    }
    const bg = U.layer(w, h, (g) => {
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      U.glowBlob(g, w * 0.5, h * 0.45, unit * 0.9, '#ffffff', 0.35);
      const vg = g.createRadialGradient(w / 2, h / 2, unit * 0.5, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,60,50,0.07)');
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
    }, 1);
    return { N, D, J, Q, Z, lobes, bg };
  },
  draw(g, S) {
    const { w, h, A, opt, unit, cache: C } = S;
    const { N, D, J, Q, Z, lobes } = C;
    g.drawImage(C.bg, 0, 0);
    const t = S.t, lvl = A.level(t);

    // form: centre, size (taller than wide, like a head or a stone)
    const cx = w * (S.portrait ? 0.54 : 0.5), cy = h * (S.portrait ? 0.47 : 0.5);
    const R = S.portrait ? w * 0.25 : h * 0.26;
    const yaw = opt.spin * (t * 0.12 + 0.25 * Math.sin(t * 0.3)), pitch = 0.15 * Math.sin(t * 0.21);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // lobe amplitudes from the bands (smoothed a little by averaging two instants)
    const L = lobes.map((o) => {
      const e = 0.5 * (A.band(t, o.band) + A.band(t - 0.1, o.band));
      return { v: o.v, f: o.f, ph: o.ph + t * o.sp, a: opt.morph * o.a * (0.5 + 1.1 * e) };
    });
    const swell = 1 + 0.07 * lvl + 0.05 * A.pulse(t, 'bass', 0.25);
    // light from the right, drifting; the dense (shadowed) side is on the left
    const la = 0.35 + 0.35 * Math.sin(t * 0.13) + 0.2 * A.band(t, 'mid');
    const lx = Math.cos(la) * 0.85, ly = -0.25, lz = Math.sin(la) * 0.5 + 0.2;
    const ll = Math.hypot(lx, ly, lz);

    g.beginPath();
    const ds = Math.max(1.2, unit * 0.0021);
    for (let i = 0; i < N; i++) {
      let x = D[i * 3], y = D[i * 3 + 1], z = D[i * 3 + 2];
      // radius from the lobes (object space, so the shape turns with the form)
      let rr = 1;
      for (let k = 0; k < L.length; k++) {
        const o = L[k];
        rr += o.a * Math.sin(o.f * (x * o.v[0] + y * o.v[1] + z * o.v[2]) * 3 + o.ph);
      }
      rr *= swell * J[i];
      // rotate (yaw then pitch); view along +z
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      if (z2 < -0.15) continue; // back side hidden
      // shading: lambert on the base normal, stippled as density
      const lam = Math.max(0, (x1 * lx + y2 * ly + z2 * lz) / ll);
      const rim = 1 - Math.abs(z2); // silhouettes collect dots
      const dens = 0.1 + 0.75 * Math.pow(1 - lam, 1.8) + 0.18 * rim * rim;
      if (Q[i] > dens) continue;
      const px = cx + x1 * rr * R * 1.02, py = cy + y2 * rr * R * 1.32;
      const s = ds * Z[i];
      g.rect(px, py, s, s);
    }
    g.fillStyle = opt.accent;
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
  },
});
