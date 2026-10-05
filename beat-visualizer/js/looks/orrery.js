// orrery — twelve orbit rings, one per log band. Each planet's angular speed is its
// band's level, so its angle is the running integral of that level (a cumulative table
// built once in prepare). When planets line up with the sun, a thin line marks it.
Looks.register({
  id: 'orrery',
  name: 'orrery',
  group: 'audio',
  theme: 'dark',
  desc: 'twelve bands orbiting, speed = level',
  defaults: { accent: '#d6f55c', bg: '#0b0b0e', speed: 1, tail: 0.35, lines: true },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'speed', label: 'Orbit speed', type: 'range', min: 0.25, max: 2.5, step: 0.05 },
    { key: 'tail', label: 'Tail length · s', type: 'range', min: 0, max: 1, step: 0.05 },
    { key: 'lines', label: 'Alignment lines', type: 'toggle' },
  ],
  prepare(S) {
    const { A, opt } = S;
    const RATE = 60, n = Math.max(2, Math.ceil(A.dur * RATE) + 2);
    // cum[k*12+i] = ∫ (0.12 + level_i) dt  from 0 to k/RATE   (small floor so nothing stalls dead)
    const cum = new Float32Array(n * 12);
    for (let k = 1; k < n; k++) {
      const b = A.bands12((k - 0.5) / RATE);
      for (let i = 0; i < 12; i++) cum[k * 12 + i] = cum[(k - 1) * 12 + i] + (0.12 + b[i] * b[i] * 1.1) / RATE;
    }
    const r = U.rng(S.seed);
    const pal = ['#7b5cf0', opt.accent, '#1fb3a0', '#f2a227'];
    const rings = [];
    for (let i = 0; i < 12; i++) {
      rings.push({
        a0: r() * U.TAU,
        k: 2.6 * (1.15 - i * 0.035) * (0.85 + r() * 0.3),
        col: pal[[0, 1, 2, 3, 2, 0, 1, 3, 1, 2, 0, 3][i]],
        hz: 30 * Math.pow(16000 / 30, (i + 0.5) / 12),
      });
    }
    return {
      cum, n, RATE, rings,
      bg: U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        U.glowBlob(g, w / 2, S.portrait ? h * 0.44 : h * 0.5, S.unit * 0.5, '#15151d', 0.6);
      }, 0.25),
    };
  },
  draw(g, S) {
    const { w, h, pad, A, opt, unit, cache: C } = S;
    g.drawImage(C.bg, 0, 0, w, h);
    const ink = 'rgba(235,235,240,';

    // header + footer
    U.text(g, S.meta.title, pad, pad + unit * 0.045, { size: unit * 0.05, font: U.FONT.MONO, weight: 300, color: '#e4e4e8', spacing: 1 });
    U.text(g, S.sub.toUpperCase(), pad, pad + unit * 0.078, { size: unit * 0.016, font: U.FONT.MONO, color: 'rgba(255,255,255,0.36)', spacing: unit * 0.006 });
    U.text(g, 'TWELVE RINGS · RATE = BAND LEVEL · ALIGNMENT IS THE EVENT', pad, h - pad - (S.portrait ? unit * 0.06 : 0),
      { size: unit * 0.0145, font: U.FONT.MONO, color: 'rgba(255,255,255,0.36)', spacing: unit * 0.0035 });

    const cx = w / 2, cy = S.portrait ? h * 0.44 : h * 0.5;
    const R = S.portrait ? w * 0.38 : h * 0.37;
    const ringR = (i) => R * (0.14 + i * 0.0715);

    // bezel: outer circle, minor ticks, major ticks
    g.lineWidth = 1;
    g.strokeStyle = ink + '0.16)';
    g.beginPath(); g.arc(cx, cy, R, 0, U.TAU); g.stroke();
    g.beginPath();
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * U.TAU, major = k % 6 === 0;
      const r0 = R * (major ? 0.985 : 0.992), r1 = R * (major ? 1.03 : 1.006);
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    g.strokeStyle = ink + '0.3)'; g.stroke();
    // faint spokes
    g.beginPath();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * U.TAU;
      g.moveTo(cx + Math.cos(a) * ringR(0), cy + Math.sin(a) * ringR(0));
      g.lineTo(cx + Math.cos(a) * ringR(11), cy + Math.sin(a) * ringR(11));
    }
    g.strokeStyle = ink + '0.04)'; g.stroke();
    // orbit rings
    g.strokeStyle = ink + '0.3)';
    for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(cx, cy, ringR(i), 0, U.TAU); g.stroke(); }

    // angle at time t = a0 + k * speed * ∫level
    const cumAt = (i, t) => {
      const x = U.clamp(t * C.RATE, 0, C.n - 1.001), k = Math.floor(x), u = x - k;
      return C.cum[k * 12 + i] * (1 - u) + C.cum[(k + 1) * 12 + i] * u;
    };
    const ang = (i, t) => C.rings[i].a0 - Math.PI / 2 + C.rings[i].k * opt.speed * cumAt(i, t);
    const lv = A.bands12(S.t);
    const P = [];
    for (let i = 0; i < 12; i++) {
      const a = ang(i, S.t), rr = ringR(i);
      P.push({ i, a, rr, x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, l: lv[i], col: C.rings[i].col });
    }

    // labels: the low bound near the inner rings, the loudest band at the top of the dial
    let top = 0; for (let i = 1; i < 12; i++) if (lv[i] > lv[top]) top = i;
    const hzLab = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(1) + ' kHz' : Math.round(hz / 10) * 10 + ' Hz');
    const lab = { size: unit * 0.0125, font: U.FONT.MONO, color: 'rgba(255,255,255,0.42)', spacing: 1 };
    U.text(g, '| ' + hzLab(C.rings[Math.max(top, 6)].hz), cx - unit * 0.002, cy - R - unit * 0.012, lab);
    U.text(g, hzLab(C.rings[0].hz), cx + R * 0.05, cy - ringR(3) - unit * 0.006, lab);

    // alignment: pairs within a few degrees — draw a ray from the sun to the farther planet
    if (opt.lines) {
      g.lineWidth = Math.max(1, unit * 0.0011);
      for (let i = 0; i < 12; i++) {
        for (let j = i + 1; j < 12; j++) {
          let d = Math.abs(((P[i].a - P[j].a) % U.TAU + U.TAU * 1.5) % U.TAU - Math.PI);
          const thr = 0.24;
          if (d > thr) continue;
          const k = 1 - d / thr, p = P[j];
          const gr = g.createLinearGradient(cx, cy, p.x, p.y);
          gr.addColorStop(0, U.rgba(p.col, 0.05));
          gr.addColorStop(1, U.rgba(p.col, 0.15 + 0.4 * k));
          g.strokeStyle = gr;
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke();
        }
      }
    }

    // tails: arcs back along the orbit over the last `tail` seconds
    if (opt.tail > 0) {
      g.lineCap = 'round';
      const SEG = 8;
      for (const p of P) {
        const aPast = ang(p.i, S.t - opt.tail);
        const span = p.a - aPast;
        if (Math.abs(span) < 0.01) continue;
        g.lineWidth = Math.max(1.2, unit * (0.0016 + 0.0016 * p.l));
        for (let s = 0; s < SEG; s++) {
          const a0 = aPast + (span * s) / SEG, a1 = aPast + (span * (s + 1)) / SEG;
          g.strokeStyle = U.rgba(p.col, 0.6 * Math.pow((s + 1) / SEG, 1.6));
          g.beginPath(); g.arc(cx, cy, p.rr, Math.min(a0, a1), Math.max(a0, a1)); g.stroke();
        }
      }
    }

    // sun
    g.fillStyle = '#c9c9cf';
    g.beginPath(); g.arc(cx, cy, unit * 0.0135, 0, U.TAU); g.fill();

    // planets
    for (const p of P) {
      const r = unit * (0.0052 + 0.0095 * p.l * p.l);
      U.glowBlob(g, p.x, p.y, r * 3, p.col, 0.22 * p.l);
      g.fillStyle = p.col;
      g.beginPath(); g.arc(p.x, p.y, r, 0, U.TAU); g.fill();
    }
  },
});
