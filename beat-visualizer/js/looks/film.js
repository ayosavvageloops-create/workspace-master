// film — notes as soft grey dots on old film stock: grain, vignette, scan banding, flicker,
// gate weave and dust, with a thin dark playhead the roll drifts through.
(function () {
  function rowsOf(parts, mode) {
    const set = new Set();
    for (const p of parts) for (const n of p.notes) set.add(mode === 'class' ? ((n.p % 12) + 12) % 12 : n.p);
    let list = [...set].sort((a, b) => a - b);
    if (mode === 'class') list = [...Array(12).keys()];
    if (!list.length) list = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const idx = new Map(list.map((p, i) => [p, i]));
    return { list, idx };
  }
  // a soft, blurred dot used for every note (drawn in three slices so it can stretch into a pill)
  function dotSprite(r) {
    const b = Math.ceil(r * 0.35), s = Math.ceil((r + b) * 2);
    const c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r + b);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop((r - b * 0.6) / (r + b), 'rgba(0,0,0,0.97)');
    gr.addColorStop((r + b * 0.4) / (r + b), 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    return { c, s };
  }
  function pill(g, sp, cx, cy, len, scale) {
    const s = sp.s * scale, h = s / 2, mid = Math.max(0, len);
    const x = cx - h - mid / 2, y = cy - h;
    g.drawImage(sp.c, 0, 0, sp.s / 2, sp.s, x, y, h, s);
    if (mid > 0.5) g.drawImage(sp.c, sp.s / 2 - 0.5, 0, 1, sp.s, x + h, y, mid, s);
    g.drawImage(sp.c, sp.s / 2, 0, sp.s / 2, sp.s, x + h + mid, y, h, s);
  }

  // grain tile: sparse light/dark clumps with alpha, blended source-over (cheaper than 'overlay')
  function grainTile(seed, px) {
    const n = 128, c = document.createElement('canvas'); c.width = c.height = n * px;
    const g = c.getContext('2d'), r = U.rng(seed);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = r();
      if (v > 0.1 && v < 0.9) continue;
      g.fillStyle = v < 0.5 ? `rgba(20,20,18,${0.12 + (0.1 - v) * 2.5})` : `rgba(255,255,250,${0.2 + (v - 0.9) * 3})`;
      g.fillRect(x * px, y * px, px, px);
    }
    return c;
  }

  Looks.register({
    id: 'film',
    name: 'film',
    group: 'midi',
    theme: 'light',
    desc: 'soft grey note dots on flickering old film stock',
    defaults: { accent: '#3a3a38', bg: '#e9e8e2', bars: 2, rows: 'pitch', grain: 0.08, dust: true },
    controls: [
      { key: 'bg', label: 'Film base', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [1, 2, 4] },
      { key: 'rows', label: 'Rows', type: 'select', options: ['pitch', 'class'] },
      { key: 'grain', label: 'Grain', type: 'range', min: 0, max: 0.2, step: 0.01 },
      { key: 'dust', label: 'Dust & flicker', type: 'toggle' },
    ],
    prepare(S) {
      const { w, h, unit: u, opt } = S;
      const bg = U.layer(w, h, (g) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        // brighter centre column, dark burnt sides (projector hot spot + vignette)
        const lg = g.createLinearGradient(0, 0, w, 0);
        lg.addColorStop(0, 'rgba(60,58,52,0.42)'); lg.addColorStop(0.1, 'rgba(60,58,52,0.12)');
        lg.addColorStop(0.3, 'rgba(255,255,250,0.25)'); lg.addColorStop(0.7, 'rgba(255,255,250,0.22)');
        lg.addColorStop(0.88, 'rgba(60,58,52,0.12)'); lg.addColorStop(1, 'rgba(60,58,52,0.45)');
        g.fillStyle = lg; g.fillRect(0, 0, w, h);
        const vg = g.createLinearGradient(0, 0, 0, h);
        vg.addColorStop(0, 'rgba(60,58,52,0.12)'); vg.addColorStop(0.2, 'rgba(0,0,0,0)'); vg.addColorStop(0.8, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,58,52,0.2)');
        g.fillStyle = vg; g.fillRect(0, 0, w, h);
      }, 0.5);
      // fine horizontal scan lines at full res
      const lines = U.layer(w, h, (g) => {
        const r = U.rng(S.seed);
        for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,40,36'},${0.02 + r() * 0.035})`; g.fillRect(0, y, w, 1); }
      });
      const R = u * 0.017;
      return { bg, lines, grain: grainTile(S.seed, Math.max(2, Math.round(u / 320))), rows: rowsOf(S.parts, opt.rows), dot: dotSprite(R), R };
    },
    draw(g, S) {
      const { w, h, unit: u, opt, parts, A } = S;
      const C = S.cache;
      g.drawImage(C.bg, 0, 0, w, h);
      g.drawImage(C.lines, 0, 0, w, h);
      const fr = Math.floor(S.t * 24);                  // film frame index (24 fps feel)
      const weave = opt.dust ? (U.hash(fr, 7) - 0.5) * u * 0.004 + U.vnoise(S.t * 1.7, 3) * u * 0.003 : 0;

      g.save();
      g.translate(0, weave);
      const mono = U.FONT.MONO, top = S.pad + u * 0.012;
      U.text(g, `${S.meta.title || 'untitled'} · ${S.sub}`, S.pad, top, { size: u * 0.026, font: mono, color: '#2c2c2a' });
      U.text(g, S.timeLabel(), w - S.pad, top, { size: u * 0.026, font: mono, color: '#2c2c2a', align: 'right' });

      const x0 = S.pad, x1 = w - S.pad, y0 = S.portrait ? h * 0.085 : h * 0.14, y1 = S.portrait ? h * 0.8 : h * 0.9;
      const { list, idx } = C.rows, nR = list.length;
      const rowY = (i) => (nR === 1 ? (y0 + y1) / 2 : y1 - u * 0.03 - (i / (nR - 1)) * (y1 - y0 - u * 0.06));
      const win = S.bar * opt.bars, phK = 0.28, phx = x0 + (x1 - x0) * phK;
      const tx = (tt) => phx + ((tt - S.t) / win) * (x1 - x0);
      const t0 = S.t - win * phK - 0.3, t1 = S.t + win * (1 - phK) + 0.3;
      const R = C.R, pxPerSec = (x1 - x0) / win;
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        const scale = p.role === 'bass' ? 1.08 : p.role === 'lead' ? 0.85 : 0.95;
        for (const n of Parts.inRange(p, t0, t1)) {
          const key = opt.rows === 'class' ? ((n.p % 12) + 12) % 12 : n.p;
          const i = idx.get(key);
          if (i == null) continue;
          const len = Math.min(R * 1.6, Math.max(0, (n.e - n.s) * pxPerSec * 0.35 - R * 0.6));
          const cx = tx(n.s) + R + len / 2, cy = rowY(i);
          const playing = n.s <= S.t && n.e > S.t, past = n.e <= S.t;
          const k = playing ? 1 - U.clamp((S.t - n.s) / 0.4) * 0.3 : 0;
          g.globalAlpha = playing ? 0.55 + 0.12 * k : past ? 0.46 : 0.28;
          pill(g, C.dot, cx, cy, len, scale * (1 + 0.12 * k));
        }
      }
      g.globalAlpha = 1;
      if (!parts.length) U.text(g, '— no notes on this reel —', w / 2, (y0 + y1) / 2, { size: u * 0.024, font: mono, color: 'rgba(40,40,36,0.55)', align: 'center' });
      // playhead
      g.fillStyle = 'rgba(48,48,44,0.8)'; g.fillRect(phx - 1.25, y0 - u * 0.02, 2.5, y1 - y0 + u * 0.04);
      g.restore();

      // moving scan banding
      for (let k = 0; k < 2; k++) {
        const yb = U.fract(S.t * (0.07 + k * 0.05) + U.hash(S.seed, k)) * (h * 1.3) - h * 0.15, bh = h * (0.05 + 0.04 * k);
        const bg = g.createLinearGradient(0, yb - bh, 0, yb + bh);
        bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(0.5, k ? 'rgba(40,40,36,0.05)' : 'rgba(255,255,250,0.14)'); bg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = bg; g.fillRect(0, yb - bh, w, bh * 2);
      }
      if (opt.dust) {
        // flicker: tiny per-film-frame exposure change
        const f = (U.hash(fr, 1) - 0.5) * 0.07;
        g.fillStyle = f > 0 ? `rgba(255,255,250,${f})` : `rgba(30,30,26,${-f * 0.8})`;
        g.fillRect(0, 0, w, h);
        // dust specks, hairs and the odd scratch
        const n = 3 + Math.floor(U.hash(fr, 2) * 5);
        g.fillStyle = 'rgba(30,30,28,0.55)';
        for (let i = 0; i < n; i++) {
          const x = U.hash(fr, i, 3) * w, y = U.hash(fr, i, 4) * h, r = 0.8 + U.hash(fr, i, 5) * u * 0.0035;
          g.beginPath(); g.arc(x, y, r, 0, U.TAU); g.fill();
        }
        if (U.hash(fr, 9) < 0.18) {
          const x = U.hash(fr, 10) * w, y = U.hash(fr, 11) * h, l = u * (0.02 + U.hash(fr, 12) * 0.04);
          g.strokeStyle = 'rgba(30,30,28,0.4)'; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l * 0.6, y + l * (U.hash(fr, 13) - 0.5), x + l * 0.2, y + l); g.stroke();
        }
        const sx = Math.floor(S.t / 0.9);
        if (U.hash(sx, 14) < 0.45) {
          const x = U.hash(sx, 15) * w + Math.sin(S.t * 9) * 2;
          g.fillStyle = 'rgba(255,255,250,0.35)'; g.fillRect(x, 0, 1.2, h);
        }
      }
      if (opt.grain > 0) {
        const t = C.grain, ox = Math.floor(U.hash(fr, 21) * t.width), oy = Math.floor(U.hash(fr, 22) * t.height);
        g.save();
        g.globalAlpha = U.clamp(opt.grain * 6);
        g.translate(-ox, -oy);
        g.fillStyle = g.createPattern(t, 'repeat');
        g.fillRect(ox, oy, w, h);
        g.restore();
      }
    },
  });
})();
