// mosh — a soft pastel painting (or the cover art, when there is one) run through a
// broken codec: flat macroblocks, displaced blocks, stretched smears, torn strips and
// RGB-split edges between black letterbox bars. Glitch amount follows the transients.
Looks.register({
  id: 'mosh',
  name: 'mosh',
  group: 'audio',
  theme: 'dark',
  desc: 'a painting run through a broken codec',
  defaults: { accent: '#ff5fa8', bg: '#050407', amount: 1, block: 48, tear: true, letterbox: true },
  controls: [
    { key: 'bg', label: 'Bars', type: 'color' },
    { key: 'amount', label: 'Glitch amount', type: 'range', min: 0, max: 2.5, step: 0.05 },
    { key: 'block', label: 'Macroblock size', type: 'select', options: [24, 32, 48, 64, 96] },
    { key: 'tear', label: 'Tearing strips', type: 'toggle' },
    { key: 'letterbox', label: 'Letterbox', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, seed } = S;
    const box = mosh_box(S);
    const r = U.rng(seed);

    // noisy blob outline (polar, fbm on angle)
    const blob = (g, cx, cy, rx, ry, s, rough) => {
      g.beginPath();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * U.TAU;
        const n = 1 + rough * U.fbm(Math.cos(a) * 1.6 + s, Math.sin(a) * 1.6 - s, s * 0.37, 4);
        const x = cx + Math.cos(a) * rx * n, y = cy + Math.sin(a) * ry * n;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
    };

    // the painting, at quarter resolution — it is meant to be soft
    const paint = (g) => {
      const { x: X, y: Y, w: W, h: H } = box;
      const P = (fx, fy) => [X + fx * W, Y + fy * H];
      const cover = S.meta && S.meta.cover;
      if (cover && cover.width) {
        const k = Math.max(W / cover.width, H / cover.height);
        g.drawImage(cover, X + (W - cover.width * k) / 2, Y + (H - cover.height * k) / 2, cover.width * k, cover.height * k);
        return;
      }
      // sky
      const sky = g.createLinearGradient(0, Y, 0, Y + H * 0.62);
      sky.addColorStop(0, '#2e1660'); sky.addColorStop(0.45, '#4b2490'); sky.addColorStop(0.78, '#8a35a6'); sky.addColorStop(1, '#d4559c');
      g.fillStyle = sky; g.fillRect(X, Y, W, H);
      // sun glow
      let [sx, sy] = P(0.6, 0.27);
      U.glowBlob(g, sx, sy, W * 0.42, '#f0a6b8', 0.55);
      U.glowBlob(g, sx, sy, W * 0.2, '#ffd6c8', 0.7);
      U.glowBlob(g, sx - W * 0.03, sy + H * 0.02, W * 0.07, '#ffffff', 0.95);
      // horizon haze
      const hz = g.createLinearGradient(0, Y + H * 0.36, 0, Y + H * 0.48);
      hz.addColorStop(0, 'rgba(220,80,170,0)'); hz.addColorStop(0.7, 'rgba(225,95,165,0.75)'); hz.addColorStop(1, 'rgba(240,120,150,0.9)');
      g.fillStyle = hz; g.fillRect(X, Y + H * 0.36, W, H * 0.12);
      // ground: peach base
      const gr = g.createLinearGradient(0, Y + H * 0.45, 0, Y + H);
      gr.addColorStop(0, '#f2909a'); gr.addColorStop(0.35, '#f6b072'); gr.addColorStop(0.8, '#f2a070'); gr.addColorStop(1, '#e08070');
      g.fillStyle = gr; g.fillRect(X, Y + H * 0.46, W, H * 0.54);
      // yellow field on the right
      [sx, sy] = P(0.72, 0.66);
      blob(g, sx, sy, W * 0.36, H * 0.14, 3.1, 0.22);
      g.fillStyle = '#f3d27a'; g.fill();
      [sx, sy] = P(0.12, 0.62);
      blob(g, sx, sy, W * 0.16, H * 0.1, 7.7, 0.3);
      g.fillStyle = '#f3c070'; g.fill();
      // pale blue-grey cloud mass, with a lighter rim
      [sx, sy] = P(0.33, 0.6);
      blob(g, sx, sy, W * 0.3, H * 0.13, 1.3, 0.28);
      g.fillStyle = '#90b2c4'; g.fill();
      g.lineWidth = W * 0.01; g.strokeStyle = 'rgba(214,232,236,0.75)'; g.stroke();
      blob(g, sx - W * 0.04, sy - H * 0.02, W * 0.2, H * 0.08, 4.4, 0.3);
      g.fillStyle = 'rgba(170,200,212,0.6)'; g.fill();
      // dark ragged foreground edge
      g.fillStyle = '#251436';
      g.beginPath(); g.moveTo(X, Y + H);
      for (let k = 0; k <= 40; k++) {
        const fx = k / 40;
        g.lineTo(X + fx * W, Y + H * (0.955 - 0.02 * fx + 0.015 * U.fbm(fx * 9, 2.2, 0, 3)));
      }
      g.lineTo(X + W, Y + H); g.closePath(); g.fill();
    };
    const small = U.layer(w, h, (g) => { g.fillStyle = opt.bg; g.fillRect(0, 0, w, h); paint(g); }, 0.25);
    // upscale with a little blur so it reads as paint, not pixels; torn edges baked on top
    const base = U.layer(w, h, (g) => {
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
      g.filter = `blur(${Math.round(S.unit * 0.006)}px)`;
      g.drawImage(small, 0, 0, w, h);
      g.filter = 'none';
      mosh_edges(g, S, box, r);
      g.restore();
    }, 1);
    // macroblock averages: one pixel per block, drawn back with nearest-neighbour
    const bs = Math.max(8, Math.round((+opt.block * S.unit) / 1080));
    const mb = document.createElement('canvas');
    mb.width = Math.ceil(w / bs); mb.height = Math.ceil(h / bs);
    const mg = mb.getContext('2d');
    mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high';
    mg.drawImage(base, 0, 0, mb.width, mb.height);
    // where the picture has detail, blocks get flattened more often (like a starved encoder)
    const px = mg.getImageData(0, 0, mb.width, mb.height).data, MW = mb.width, MH = mb.height;
    const lum = (i) => px[i * 4] * 0.3 + px[i * 4 + 1] * 0.55 + px[i * 4 + 2] * 0.15;
    const wcum = new Float32Array(MW * MH);
    let acc = 0;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = y * MW + x, inBox = y * bs >= box.y && (y + 1) * bs <= box.y + box.h;
      let c = 0;
      if (x > 0) c += Math.abs(lum(i) - lum(i - 1)); if (x < MW - 1) c += Math.abs(lum(i) - lum(i + 1));
      if (y > 0) c += Math.abs(lum(i) - lum(i - MW)); if (y < MH - 1) c += Math.abs(lum(i) - lum(i + MW));
      acc += inBox ? 0.25 + Math.min(4, c / 12) + lum(i) / 120 : 0;
      wcum[i] = acc;
    }
    const blocky = U.layer(w, h, (g) => { g.imageSmoothingEnabled = false; g.drawImage(mb, 0, 0, mb.width * bs, mb.height * bs); }, 1);

    // glitch events: strong transients at least half a beat apart
    const cand = A.onsets.hit.concat(A.onsets.bass).filter((o) => o.s > 0.3).sort((p, q) => p.t - q.t);
    const events = [], gap = Math.max(0.18, S.spb * 0.5);
    for (const o of cand) {
      const last = events[events.length - 1];
      if (last && o.t - last.t < gap) { if (o.s > last.s && o.t - last.t < 0.05) last.s = o.s; continue; }
      events.push({ t: o.t, s: o.s });
    }
    return { box, base, blocky, bs, wcum, MW, events };
  },
  draw(g, S) {
    const { w, h, A, opt, cache: C, unit } = S;
    const { box, bs } = C;
    const hit = Math.max(A.pulse(S.t, 'hit', 0.25), A.pulse(S.t, 'bass', 0.3) * 0.9);
    const beat = A.beatIndex(S.t);
    // glitch events: the latest strong transient picks the damaged blocks; they stay put
    // until the next event while their displacement eases back (no per-frame re-rolls)
    const ev = C.events;
    let lo = 0, hi = ev.length - 1, e = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ev[m].t <= S.t) { e = m; lo = m + 1; } else hi = m - 1; }
    const es = e >= 0 ? ev[e].s : 0, age = e >= 0 ? S.t - ev[e].t : 9;
    const env = es * Math.exp(-age / 0.45);           // smooth decay after each event
    const ease = 0.25 + 0.75 * env;
    const amount = opt.amount;

    // base painting (bars and torn edges included)
    g.drawImage(C.base, 0, 0);

    g.save();
    g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
    g.imageSmoothingEnabled = false;
    const cols = Math.ceil(box.w / bs), rows = Math.ceil(box.h / bs);
    const bx0 = Math.floor(box.x / bs) * bs, by0 = Math.floor(box.y / bs) * bs;
    const flat = (key, salt, n, alpha) => {
      g.globalAlpha = alpha;
      for (let k = 0; k < n; k++) {
        // weighted pick: detailed / bright blocks (the sun, the cloud rim) break up more
        const i = mosh_pick(C.wcum, U.hash(k, key, salt));
        const m = 1 + Math.floor(U.hash(k, key, salt + 1) * 2.2);
        const x = (i % C.MW) * bs, y = Math.floor(i / C.MW) * bs;
        g.drawImage(C.blocky, x, y, bs * m, bs, x, y, bs * m, bs);
      }
      g.globalAlpha = 1;
    };
    // 1) flat macroblocks: a resident set that changes every two beats, plus an event set that fades
    const cells = cols * rows;
    flat(Math.floor(beat / 2), 11, Math.round(cells * 0.05 * amount), 1);
    if (e >= 0) flat(e, 61, Math.round(cells * 0.05 * amount * (0.4 + es)), Math.min(1, env * 2.2));
    // 2) displaced blocks: stale motion vectors, sliding back as the event decays
    const nDisp = e >= 0 ? Math.round((8 + 22 * es) * amount) : 0;
    for (let k = 0; k < nDisp; k++) {
      const cx = Math.floor(U.hash(k, e, 21) * cols), cy = Math.floor(U.hash(k, e, 22) * rows);
      const sz = bs * (1 + Math.floor(U.hash(k, e, 23) * 2.5));
      const dx = (U.hash(k, e, 24) - 0.5) * bs * 3 * ease, dy = (U.hash(k, e, 25) - 0.5) * bs * 2 * ease;
      const x = bx0 + cx * bs, y = by0 + cy * bs;
      g.drawImage(C.base, x + dx, y + dy, sz, sz * 0.75, x, y, sz, sz * 0.75);
    }
    // 3) smears: one row of pixels stretched down, shrinking as the event fades
    const nSmear = e >= 0 ? Math.round(3 * amount * es + 0.4) : 0;
    for (let k = 0; k < nSmear; k++) {
      const cx = Math.floor(U.hash(k, e, 31) * cols), cy = Math.floor(U.hash(k, e, 32) * rows);
      const sw = bs * (1 + Math.floor(U.hash(k, e, 34) * 3));
      const x = bx0 + cx * bs, y = by0 + cy * bs, len = bs * (1 + U.hash(k, e, 33) * 2.5) * ease;
      g.globalAlpha = 0.85;
      g.drawImage(C.base, x, y, sw, 2, x, y, sw, len);
      g.globalAlpha = 1;
    }
    // 4) horizontal tearing strips, shifted sideways and settling back
    if (opt.tear && e >= 0) {
      const nTear = Math.floor(es * 2.6 * amount + U.hash(e, 41) * 0.8);
      for (let k = 0; k < nTear; k++) {
        const y = box.y + U.hash(k, e, 42) * box.h, sh = unit * (0.006 + 0.03 * U.hash(k, e, 43));
        const dx = (U.hash(k, e, 44) - 0.5) * unit * 0.14 * amount * env;
        g.drawImage(C.base, box.x, y, box.w, sh, box.x + dx, y, box.w, sh);
        g.fillStyle = `rgba(255,255,255,${0.08 * env})`; g.fillRect(box.x, y, box.w, 1);
      }
    }
    // 5) near-black dropout blocks, only right on the hit
    if (e >= 0 && age < 0.18) {
      const nDrop = Math.floor(es * 2 * amount);
      for (let k = 0; k < nDrop; k++) {
        const x = bx0 + Math.floor(U.hash(k, e, 51) * cols) * bs, y = by0 + Math.floor(U.hash(k, e, 52) * rows) * bs;
        g.fillStyle = `rgba(20,12,40,${0.85 * (1 - age / 0.18)})`; g.fillRect(x, y, bs, bs * 0.6);
      }
    }
    g.imageSmoothingEnabled = true;
    g.restore();

    // RGB split at the sides, wider on hits
    const split = unit * 0.003 * (1 + 2.5 * hit);
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.18 + 0.25 * hit;
    g.fillStyle = '#ff2050'; g.fillRect(box.x + split, box.y, unit * 0.004, box.h);
    g.fillStyle = '#20ffa0'; g.fillRect(box.x + box.w - split - unit * 0.004, box.y, unit * 0.004, box.h);
    g.restore();
  },
});

// painting box: full width, letterboxed top and bottom
function mosh_box(S) {
  const { w, h } = S;
  if (!S.opt.letterbox) return { x: 0, y: 0, w, h };
  if (S.portrait) return { x: 0, y: Math.round(h * 0.125), w, h: Math.round(h * 0.75) };
  return { x: 0, y: Math.round(h * 0.07), w, h: Math.round(h * 0.86) };
}

// ragged torn side edges with chromatic fringes, and a broken first row
function mosh_edges(g, S, box, r) {
  const bg = S.opt.bg, segs = 60;
  for (const side of [0, 1]) {
    for (let k = 0; k < segs; k++) {
      const y = box.y + (k / segs) * box.h, sh = box.h / segs + 1;
      const d = S.unit * (0.006 + 0.022 * Math.pow(r(), 2.2));
      const x = side ? box.x + box.w - d : box.x;
      g.fillStyle = bg; g.fillRect(x, y, d, sh);
      const fx = side ? x : x + d;
      g.fillStyle = 'rgba(255,40,60,0.5)'; g.fillRect(fx - (side ? 3 : 0), y, 3, sh);
      g.fillStyle = 'rgba(40,255,140,0.35)'; g.fillRect(fx + (side ? -6 : 3), y, 3, sh);
    }
  }
  for (let k = 0; k < 30; k++) {
    const x = box.x + (k / 30) * box.w, d = S.unit * 0.012 * r();
    g.fillStyle = bg; g.fillRect(x, box.y - 1, box.w / 30 + 1, d);
    if (r() < 0.3) { g.fillStyle = 'rgba(255,190,90,0.55)'; g.fillRect(x, box.y + d, box.w / 30, 2); }
  }
}

function mosh_pick(cum, u) {
  const v = u * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
