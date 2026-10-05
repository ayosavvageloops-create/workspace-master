// keys — a giant diagonal piano lying on a pale floor. Every sounding note lights its key and
// drops a tiny person onto it (they jump on at note-on and cheer while it holds), while
// other little people stroll along the keyboard.
(function () {
  const WMAP = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  const isBlack = (p) => !(((p % 12) + 12) % 12 in WMAP);
  const wIndex = (p) => Math.floor(p / 12) * 7 + WMAP[((p % 12) + 12) % 12];
  const SHIRTS = ['#4aa3df', '#5cc26e', '#3d6fd6', '#f2a33a', '#e46a3a', '#6cc3c9', '#f2d14a', '#7f8c99'];
  const SKIN = ['#f1c9a5', '#d9a47c', '#a8714a', '#7a4b2c', '#e8b98f'];
  const HAIR = ['#2b2016', '#4a3122', '#16120f', '#6b4a2b'];

  function person(g, x, y, ph, o) {
    // shadow on the floor, cast down-left
    g.fillStyle = `rgba(30,30,40,${0.16 * (o.shadow ?? 1)})`;
    g.beginPath(); g.ellipse(x - ph * 0.14 + (o.lift || 0) * 0.3, y + ph * 0.05, ph * 0.26, ph * 0.08, -0.5, 0, U.TAU); g.fill();
    const yy = y - (o.lift || 0);
    const legH = ph * 0.34, bodyH = ph * 0.34, bw = ph * 0.3, hr = ph * 0.12;
    const sw = o.walk || 0;
    g.fillStyle = '#2d3a48';
    g.fillRect(x - bw * 0.42, yy - legH + sw * ph * 0.04, bw * 0.34, legH - sw * ph * 0.04);
    g.fillRect(x + bw * 0.08, yy - legH - sw * ph * 0.04, bw * 0.34, legH + sw * ph * 0.04);
    const by = yy - legH - bodyH;
    g.fillStyle = o.shirt;
    U.rrect(g, x - bw / 2, by, bw, bodyH + ph * 0.02, bw * 0.22); g.fill();
    // arms
    g.strokeStyle = o.shirt; g.lineWidth = Math.max(1.5, ph * 0.075); g.lineCap = 'round';
    g.beginPath();
    if (o.cheer) {
      const a = o.cheer;
      g.moveTo(x - bw * 0.4, by + ph * 0.05); g.lineTo(x - bw * (0.55 + 0.25 * a), by - ph * (0.05 + 0.22 * a));
      g.moveTo(x + bw * 0.4, by + ph * 0.05); g.lineTo(x + bw * (0.55 + 0.25 * a), by - ph * (0.05 + 0.22 * a));
    } else {
      g.moveTo(x - bw * 0.48, by + ph * 0.05); g.lineTo(x - bw * 0.55, by + bodyH * 0.85 - sw * ph * 0.05);
      g.moveTo(x + bw * 0.48, by + ph * 0.05); g.lineTo(x + bw * 0.55, by + bodyH * 0.85 + sw * ph * 0.05);
    }
    g.stroke();
    // head + hair
    g.fillStyle = o.skin; g.beginPath(); g.arc(x, by - hr * 0.95, hr, 0, U.TAU); g.fill();
    g.fillStyle = o.hair; g.beginPath(); g.arc(x, by - hr * 1.05, hr * 1.02, Math.PI * 1.02, Math.PI * 1.98); g.fill();
  }
  const look = (seed) => ({
    shirt: SHIRTS[Math.floor(U.hash(seed, 1) * SHIRTS.length)],
    skin: SKIN[Math.floor(U.hash(seed, 2) * SKIN.length)],
    hair: HAIR[Math.floor(U.hash(seed, 3) * HAIR.length)],
  });

  Looks.register({
    id: 'keys',
    name: 'keys',
    group: 'midi',
    theme: 'light',
    desc: 'a giant piano where little people stand on the notes you play',
    defaults: { accent: '#7c4dff', chords: '#14a58a', bg: '#ececef', zoom: 0.85, walkers: 12, angle: 35 },
    controls: [
      { key: 'chords', label: 'Chord colour', type: 'color' },
      { key: 'bg', label: 'Floor', type: 'color' },
      { key: 'zoom', label: 'Zoom', type: 'range', min: 0.6, max: 1.6, step: 0.05 },
      { key: 'walkers', label: 'Strollers', type: 'range', min: 0, max: 20, step: 1 },
      { key: 'angle', label: 'Tilt', type: 'range', min: 15, max: 55, step: 1 },
    ],
    prepare(S) {
      let lo = 127, hi = 0;
      for (const p of S.parts) for (const n of p.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
      if (lo > hi) { lo = 48; hi = 72; }
      return { lo, hi };
    },
    draw(g, S) {
      const { w, h, unit: u, opt, parts } = S;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      const th = -opt.angle * (S.portrait ? 1 : 0.62) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      const kw = u * 0.05 * opt.zoom, L = kw * 4.7, bw = kw * 0.58, bl = L * 0.6;
      const ph = kw * 1.35;
      const colOf = (p) => (p.role === 'bass' ? opt.accent : p.role === 'chords' ? opt.chords : p.role === 'lead' ? '#f08a2c' : '#3d8bfd');
      const keyX = (p) => (isBlack(p) ? (wIndex(p - 1) + 1) * kw : (wIndex(p) + 0.5) * kw);

      // camera: keyboard centre follows the recently played notes (pure function of time)
      const { lo, hi } = S.cache;
      const mid = (keyX(lo) + keyX(hi)) / 2;
      let acc = 0, wsum = 0;
      for (let k = 0; k < 10; k++) {
        const tt = S.t - k * 0.25, wt = Math.exp(-k * 0.25);
        let sx = 0, n = 0;
        for (const p of parts) for (const x of Parts.active(p, tt)) { sx += keyX(x.p); n++; }
        acc += (n ? sx / n : mid) * wt; wsum += wt;
      }
      const cx = U.lerp(mid, acc / wsum, 0.55);
      const ax = w * 0.5, ay = S.portrait ? h * 0.37 : h * 0.45;
      const oy = L * 0.45;
      const toS = (lx, ly) => [ax + c * (lx - cx) - s * (ly + oy), ay + s * (lx - cx) + c * (ly + oy)];
      const D = Math.hypot(w, h) * 0.6;

      // keyboard in its own rotated frame
      g.save();
      g.translate(ax, ay); g.rotate(th); g.translate(-cx, oy);
      // cast shadow on the floor (in front of the keyboard)
      const sg = g.createLinearGradient(0, 0, 0, L * 0.9);
      sg.addColorStop(0, 'rgba(40,40,60,0.14)'); sg.addColorStop(1, 'rgba(40,40,60,0)');
      g.fillStyle = sg; g.fillRect(cx - D, 0, D * 2, L * 0.9);
      // body
      g.fillStyle = '#141416'; g.fillRect(cx - D, -L - kw * 0.2, D * 2, L + kw * 0.2 + kw * 0.2);
      const wa = Math.floor((cx - D) / kw), wb = Math.ceil((cx + D) / kw);
      // sounding notes by pitch
      const on = new Map();
      for (const p of parts) for (const n of Parts.active(p, S.t)) if (!on.has(n.p)) on.set(n.p, { n, col: colOf(p) });
      const lip = kw * 0.16;
      for (let i = wa; i <= wb; i++) {
        const oct = Math.floor(i / 7), pc = [0, 2, 4, 5, 7, 9, 11][((i % 7) + 7) % 7], p = oct * 12 + pc;
        const x = i * kw, hit = on.get(p);
        g.fillStyle = hit ? hit.col : '#ffffff';
        g.fillRect(x + 1, -L, kw - 2, L - lip);
        g.fillStyle = hit ? U.mix(hit.col, '#000000', 0.25) : '#d6d6dc';
        g.fillRect(x + 1, -lip, kw - 2, lip);
        if (!hit) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x + kw - 4, -L, 3, L - lip); }
      }
      for (let i = wa; i <= wb; i++) {
        const pc = [0, 2, 4, 5, 7, 9, 11][((i % 7) + 7) % 7];
        if (pc === 4 || pc === 11) continue;
        const p = Math.floor(i / 7) * 12 + pc + 1, x = (i + 1) * kw - bw / 2, hit = on.get(p);
        g.fillStyle = hit ? U.mix(hit.col, '#000000', 0.35) : '#4b4b50';
        g.fillRect(x, -L, bw, bl + kw * 0.22);                         // front/side face
        g.fillStyle = hit ? hit.col : '#111113';
        g.fillRect(x, -L, bw, bl);                                      // top face
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + bw * 0.12, -L, bw * 0.12, bl * 0.96);
      }
      g.fillStyle = '#141416'; g.fillRect(cx - D, 0, D * 2, kw * 0.1);  // front edge
      g.restore();

      // figures: people on keys + strollers, painted back to front
      const figs = [];
      const lookback = 0.3;
      for (const p of parts) {
        const col = colOf(p);
        for (const n of Parts.inRange(p, S.t - lookback, S.t + 1e-6)) {
          if (n.s > S.t) continue;
          const k = (S.t - n.s) / 0.32, out = Math.max(0, (S.t - n.e) / lookback);
          const ly = isBlack(n.p) ? -L * 0.78 : -L * 0.3;
          const [x, y] = toS(keyX(n.p) + (U.hash(n.p, 5) - 0.5) * kw * 0.2, ly);
          const lift = (k < 1 ? Math.sin(Math.PI * k) * ph * 0.55 : 0) + out * ph * 0.4;
          figs.push({ x, y, lift, alpha: 1 - out, cheer: k < 1 ? U.clamp(k * 2) : 0.75 + 0.25 * Math.sin((S.t - n.s) * 9), seed: n.p * 7 + Math.floor(n.s * 10), col, k, ripple: true });
        }
      }
      const nW = Math.round(opt.walkers);
      for (let i = 0; i < nW; i++) {
        const front = U.hash(S.seed, i, 1) < 0.55;
        const ly = front ? kw * (2.2 + U.hash(S.seed, i, 2) * 9) : -L - kw * (1.8 + U.hash(S.seed, i, 2) * 8);
        const dir = U.hash(S.seed, i, 3) < 0.5 ? -1 : 1, v = kw * (0.5 + U.hash(S.seed, i, 4) * 0.7);
        let lx = U.hash(S.seed, i, 5) * D * 2 + dir * v * S.t;
        lx = cx + (((lx - cx + D) % (D * 2)) + D * 2) % (D * 2) - D;
        const [x, y] = toS(lx, ly);
        if (x < -ph || x > w + ph || y < -ph || y > h * (S.portrait ? 0.8 : 0.9)) continue;
        figs.push({ x, y, lift: Math.abs(Math.sin(S.t * 9 + i)) * ph * 0.04, walk: Math.sin(S.t * 9 + i), seed: 1000 + i, alpha: 1, scale: 0.92 });
      }
      figs.sort((a, b) => a.y - b.y);
      // ripples under the people who just landed
      for (const f of figs) {
        if (!f.ripple || f.k > 1.6) continue;
        const k = U.clamp(f.k / 1.6), r = ph * (0.45 + k * 0.9);
        g.strokeStyle = U.rgba(f.col, 0.85 * (1 - k)); g.lineWidth = Math.max(1.5, ph * 0.05); g.lineCap = 'round';
        g.beginPath();
        for (let j = 0; j < 14; j++) {
          const a = (j / 14) * U.TAU, ca = Math.cos(a), sa = Math.sin(a) * 0.6;
          g.moveTo(f.x + ca * r, f.y + sa * r); g.lineTo(f.x + ca * (r + ph * 0.16), f.y + sa * (r + ph * 0.16));
        }
        g.stroke();
      }
      for (const f of figs) {
        g.globalAlpha = f.alpha;
        person(g, f.x, f.y, ph * (f.scale || 1), { ...look(f.seed), lift: f.lift, cheer: f.cheer, walk: f.walk || 0, shadow: f.ripple ? 0.7 : 1 });
      }
      g.globalAlpha = 1;

      // captions
      const count = on.size;
      const cy = S.portrait ? h * 0.84 : h - S.pad;
      U.text(g, parts.length ? `${count} on the keys` : 'nobody on the keys yet', S.pad * 1.6, S.portrait ? cy : S.pad * 1.6, { size: u * 0.026, font: U.FONT.SANS, weight: 600, color: '#1b1b1f' });
      U.text(g, `${S.meta.title || 'untitled'} · ${S.sub}`, w - S.pad * 1.6, cy, { size: u * 0.026, font: U.FONT.SANS, weight: 600, color: '#1b1b1f', align: 'right' });
      U.text(g, S.timeLabel(), w - S.pad * 1.6, cy + u * 0.034, { size: u * 0.019, font: U.FONT.MONO, color: 'rgba(30,30,35,0.5)', align: 'right' });
    },
  });
})();
