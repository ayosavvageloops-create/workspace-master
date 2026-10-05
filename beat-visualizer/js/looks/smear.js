// smear — a dusk landscape: violet-to-ember sky, a band of black round-canopy trees on
// the horizon, dark ground. Transients fire long horizontal light smears across the sky
// that slide and fade over a second or two; a low sun behind the trees breathes with the bass.
Looks.register({
  id: 'smear',
  name: 'smear',
  group: 'audio',
  theme: 'dark',
  desc: 'light smears over a dusk treeline',
  defaults: { accent: '#ffd0e4', bg: '#07060c', amount: 1, life: 1.6, sun: true },
  controls: [
    { key: 'bg', label: 'Night colour', type: 'color' },
    { key: 'amount', label: 'Smear amount', type: 'range', min: 0.2, max: 2, step: 0.05 },
    { key: 'life', label: 'Smear life · s', type: 'range', min: 0.5, max: 3, step: 0.1 },
    { key: 'sun', label: 'Sun glow', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, unit, A } = S;
    const r = U.rng(S.seed);
    const hzY = h * (S.portrait ? 0.575 : 0.66);
    const ground = (x) => hzY - h * 0.012 * (x / w) * (x / w) * 1.6 + h * 0.004 * U.vnoise(x / w * 6, 1.7);

    const sky = U.layer(w, h, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, hzY);
      gr.addColorStop(0, opt.bg); gr.addColorStop(0.35, '#1c0f33'); gr.addColorStop(0.62, '#3a1850');
      gr.addColorStop(0.82, '#6c2a62'); gr.addColorStop(0.95, '#a8485e'); gr.addColorStop(1, '#c86a5e');
      g.fillStyle = gr; g.fillRect(0, 0, w, hzY + 4);
      // static warm haze around the sun
      U.glowBlob(g, w * 0.55, hzY, unit * 0.75, '#d0706a', 0.45);
      // ground
      const gg = g.createLinearGradient(0, hzY, 0, h);
      gg.addColorStop(0, '#2c2428'); gg.addColorStop(0.35, '#1a1519'); gg.addColorStop(1, '#09080b');
      g.fillStyle = gg; g.fillRect(0, hzY + h * 0.02, w, h - hzY - h * 0.02);
    }, 1);

    // trees + ground silhouette: transparent layer cut to the horizon band
    const band = { y0: Math.round(hzY - h * 0.15), y1: Math.round(hzY + h * 0.03) };
    const trees = U.layer(w, h, (g) => {
      g.fillStyle = '#050407';
      // ground edge with a faint pink rim
      g.beginPath(); g.moveTo(0, band.y1);
      for (let x = 0; x <= w; x += w / 60) g.lineTo(x, ground(x));
      g.lineTo(w, band.y1); g.closePath();
      const gg = g.createLinearGradient(0, hzY, 0, h);
      gg.addColorStop(0, '#2c2428'); gg.addColorStop(0.35, '#1a1519'); gg.addColorStop(1, '#09080b');
      g.fillStyle = gg; g.fill();
      g.strokeStyle = 'rgba(240,150,170,0.55)'; g.lineWidth = Math.max(1, unit * 0.0016);
      g.beginPath(); for (let x = 0; x <= w; x += w / 60) x ? g.lineTo(x, ground(x)) : g.moveTo(x, ground(x)); g.stroke();
      // a dark rise on the right
      g.fillStyle = '#100c10';
      g.beginPath(); g.moveTo(w * 0.55, ground(w * 0.55) + 1);
      for (let x = w * 0.55; x <= w + 1; x += w / 80) { const k = (x - w * 0.55) / (w * 0.45); g.lineTo(x, ground(x) - h * 0.016 * Math.sin(k * Math.PI * 0.6)); }
      for (let x = w; x >= w * 0.55; x -= w / 80) g.lineTo(x, ground(x) + 1);
      g.closePath(); g.fill();
      g.fillStyle = '#050407';
      // trees, back (small) then front (big)
      const list = [];
      for (let i = 0; i < 34; i++) {
        const x = r() * w * 1.1 - w * 0.05;
        const big = r() < 0.45;
        list.push({ x, s: (big ? 0.055 + r() * 0.05 : 0.018 + r() * 0.025) * Math.max(w, h * 0.56), big });
      }
      list.sort((a, b) => a.s - b.s);
      for (const t of list) {
        const gy = ground(t.x), s = t.s;
        const trunkH = s * (t.big ? 0.75 + r() * 0.4 : 0.7 + r() * 0.5);
        const cy = gy - trunkH;
        // trunks: one to three thin, slightly splayed stems
        const nt = t.big ? 1 + Math.floor(r() * 3) : 1;
        for (let k = 0; k < nt; k++) {
          const tx = t.x + (k - (nt - 1) / 2) * s * 0.18, tw = Math.max(2, s * 0.07);
          g.beginPath();
          g.moveTo(tx - tw, gy + 2); g.lineTo(tx - tw * 0.5 + (k - 1) * s * 0.06, cy + s * 0.2);
          g.lineTo(tx + tw * 0.5 + (k - 1) * s * 0.06, cy + s * 0.2); g.lineTo(tx + tw, gy + 2); g.closePath(); g.fill();
        }
        // canopy: a few overlapping flat-bottomed ellipses
        const nc = 1 + Math.floor(r() * 3);
        for (let k = 0; k < nc; k++) {
          const ex = t.x + (r() - 0.5) * s * 0.7, ey = cy - r() * s * 0.25;
          const rx = s * (0.55 + r() * 0.3), ry = s * (0.38 + r() * 0.2);
          g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, Math.PI * 1.0, Math.PI * 2.0); g.ellipse(ex, ey, rx, ry * 0.55, 0, 0, Math.PI); g.fill();
        }
      }
    }, 1);

    // smears from transients: precomputed list of { t, s, lane, x0, speed, len }
    const smears = [];
    const src = A.onsets.hit.concat(A.onsets.bass.map((o) => ({ t: o.t, s: o.s * 0.9 })));
    src.sort((a, b) => a.t - b.t);
    let lastT = -1;
    for (let i = 0; i < src.length; i++) {
      const o = src[i];
      if (o.t - lastT < 0.09) continue;
      lastT = o.t;
      const hsh = (k) => U.hash(Math.round(o.t * 1000), k, S.seed & 0xffff);
      const kind = hsh(1);
      // lanes: mostly sky, some along the horizon (behind trunks), a few low over the ground
      const y = kind < 0.72 ? h * (0.06 + hsh(2) * (hzY / h - 0.16)) : kind < 0.88 ? hzY - h * (0.012 + 0.01 * hsh(2)) : hzY + h * (0.04 + hsh(2) * 0.12);
      smears.push({ t: o.t, s: o.s, y, x0: w * (-0.25 + hsh(3) * 0.85), v: w * (0.18 + hsh(4) * 0.25), len: w * (0.3 + hsh(5) * 0.25), th: hsh(6), back: kind >= 0.72 && kind < 0.88 });
    }
    return { sky, trees, band, smears, hzY };
  },
  draw(g, S) {
    const { w, h, A, opt, unit, cache: C } = S;
    const t = S.t;
    g.drawImage(C.sky, 0, 0);

    // sun behind the trees, pulsing with the bass (clipped to the sky)
    if (opt.sun) {
      const b = Math.max(A.band(t, 'bass'), A.pulse(t, 'bass', 0.3));
      g.save(); g.beginPath(); g.rect(0, 0, w, C.hzY); g.clip();
      U.glowBlob(g, w * 0.55, C.hzY + h * 0.02, unit * (0.42 + 0.12 * b), '#ff9a78', 0.15 + 0.3 * b);
      U.glowBlob(g, w * 0.55, C.hzY, unit * 0.14, '#ffc59a', 0.08 + 0.2 * b);
      g.restore();
    }

    // which smears are alive (strength gates by the amount control)
    const life = opt.life;
    const live = [];
    for (const m of C.smears) {
      if (m.t > t) break;
      const age = t - m.t;
      if (age > life || m.th > opt.amount * (0.35 + 0.65 * m.s)) continue;
      live.push([m, age]);
    }
    const drawSmear = ([m, age]) => {
      const k = age / life;
      const head = m.x0 + m.v * age + m.len * Math.min(1, age * 6);
      const L = m.len * (0.4 + 0.6 * Math.min(1, age * 4));
      const a = Math.pow(1 - k, 1.4) * (0.6 + 0.4 * m.s);
      const y = m.y, tail = head - L;
      const gr = g.createLinearGradient(tail, 0, head, 0);
      gr.addColorStop(0, U.rgba(opt.accent, 0));
      gr.addColorStop(0.7, U.rgba(opt.accent, 0.55 * a));
      gr.addColorStop(1, `rgba(255,255,255,${a})`);
      const th = unit * (0.003 + 0.0025 * m.s);
      // soft halo, then the bright core
      g.fillStyle = gr;
      g.globalAlpha = 0.25; g.fillRect(tail, y - th * 2.5, L, th * 5);
      g.globalAlpha = 1; g.fillRect(tail, y - th / 2, L, th);
      U.glowBlob(g, head, y, th * 5, '#ffffff', 0.6 * a);
    };
    // horizon smears go behind the trees
    for (const s of live) if (s[0].back) drawSmear(s);
    g.drawImage(C.trees, 0, C.band.y0, w, C.band.y1 - C.band.y0, 0, C.band.y0, w, C.band.y1 - C.band.y0);
    for (const s of live) if (!s[0].back) drawSmear(s);
  },
});
