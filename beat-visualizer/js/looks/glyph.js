// glyph — a soft-focus foliage picture framed on a pale page, read out as rows of tiny
// ASCII glyphs. Each row is one frequency band: its length follows the band, its
// characters get heavier with the band and the picture's brightness. Thin light streaks
// flicker over it on hits.
Looks.register({
  id: 'glyph',
  name: 'glyph',
  group: 'audio',
  theme: 'light',
  desc: 'a blurred picture read out in ascii',
  defaults: { accent: '#ffb3c8', bg: '#f2f2ee', cols: 84, streaks: true, ink: '#eef8e4' },
  controls: [
    { key: 'bg', label: 'Page', type: 'color' },
    { key: 'ink', label: 'Glyph colour', type: 'color' },
    { key: 'cols', label: 'Columns', type: 'range', min: 48, max: 120, step: 4 },
    { key: 'streaks', label: 'Light streaks', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, seed, unit } = S;
    const box = S.portrait
      ? { x: Math.round(w * 0.03), y: Math.round(h * 0.142), w: Math.round(w * 0.94), h: Math.round(h * 0.716) }
      : { x: Math.round(w * 0.2), y: Math.round(h * 0.07), w: Math.round(w * 0.6), h: Math.round(h * 0.86) };
    const r = U.rng(seed);

    // the picture, painted small and blurred up: layered greens, a bright patch, a blossom
    const PS = 0.125;
    const paint = (g) => {
      const { x, y, w: W, h: H } = box;
      const lg = g.createLinearGradient(x, y, x + W * 0.4, y + H);
      lg.addColorStop(0, '#3f9e2c'); lg.addColorStop(0.5, '#2f7d1e'); lg.addColorStop(1, '#1d5512');
      g.fillStyle = lg; g.fillRect(x, y, W, H);
      const greens = ['#5aa83a', '#2c6a16', '#79b84e', '#1e5410', '#4c9a30', '#8ec462', '#174a0c'];
      for (let i = 0; i < 70; i++) {
        const c = greens[Math.floor(r() * greens.length)];
        U.glowBlob(g, x + r() * W, y + r() * H, W * (0.06 + r() * 0.16), c, 0.5 + r() * 0.4);
      }
      // left side lighter and busier, right side deep shadow, like the reference
      U.glowBlob(g, x + W * 0.2, y + H * 0.4, W * 0.5, '#8cc45a', 0.4);
      U.glowBlob(g, x + W * 0.15, y + H * 0.75, W * 0.3, '#93c25e', 0.45);
      U.glowBlob(g, x + W * 0.6, y + H * 0.75, W * 0.3, '#164a0c', 0.5);
      U.glowBlob(g, x + W * 0.82, y + H * 0.62, W * 0.35, '#0f3d08', 0.55);
      U.glowBlob(g, x + W * 0.85, y + H * 0.9, W * 0.3, '#3d4a2a', 0.5);
      U.glowBlob(g, x + W * 0.95, y + H * 0.05, W * 0.25, '#4cb83a', 0.7);
      U.glowBlob(g, x + W * 0.8, y + H * 0.2, W * 0.16, '#b8e07a', 0.85);
    };
    const small = U.layer(w, h, (g) => { g.fillStyle = '#2f7d1e'; g.fillRect(0, 0, w, h); paint(g); }, PS);
    const page = U.layer(w, h, (g) => {
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
      g.filter = `blur(${Math.round(unit * 0.012)}px)`;
      g.drawImage(small, 0, 0, w, h);
      g.filter = 'none';
      g.restore();
    }, 1);

    // glyph grid: columns from the option, rows from a 1.24 aspect
    const cols = Math.round(opt.cols), cw = box.w / cols, rh = cw * 1.24;
    const rows = Math.floor(box.h / rh);
    // luminance of the picture per cell
    const lc = document.createElement('canvas'); lc.width = cols; lc.height = rows;
    const lg = lc.getContext('2d');
    lg.drawImage(page, box.x, box.y, box.w, rows * rh, 0, 0, cols, rows);
    const px = lg.getImageData(0, 0, cols, rows).data;
    const lum = new Float32Array(cols * rows);
    for (let i = 0; i < lum.length; i++) lum[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.6 + px[i * 4 + 2] * 0.1) / 255;
    // pick a font size whose mono advance equals the cell width
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = U.font(100, U.FONT.PLEX, 500);
    const fs = ((cw * 0.8) / probe.measureText('M').width) * 100;
    const ls = cw - (probe.measureText('M').width * fs) / 100;
    // streak positions (x as fraction of box, y range)
    const streaks = [];
    for (let i = 0; i < 9; i++) streaks.push({ x: 0.58 + r() * 0.26, y: 0.03 + r() * 0.8, len: 0.08 + r() * 0.12, wd: 0.6 + r() * 0.8 });
    return { box, page, cols, rows, cw, rh, lum, fs, ls, streaks };
  },
  draw(g, S) {
    const { A, opt, unit, cache: C } = S;
    const { box, cols, rows, cw, rh, lum } = C;
    g.drawImage(C.page, 0, 0);

    const t = S.t, hit = A.pulse(t, 'hit', 0.2), lvl = (A.level(t) + A.level(t - 0.05) + A.level(t - 0.1)) / 3;
    // blossom: a pink glow that swells a little with the mids
    const bx = box.x + box.w * 0.64, by = box.y + box.h * 0.575;
    const bl = 0.75 + 0.25 * A.band(t, 'mid');
    g.save();
    g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
    g.translate(bx, by); g.rotate(0.3); g.scale(0.7, 1);
    U.glowBlob(g, 0, 0, box.w * 0.17 * bl, opt.accent, 0.9);
    U.glowBlob(g, 0, 0, box.w * 0.1 * bl, '#ffa8c0', 0.7);
    U.glowBlob(g, box.w * 0.035, -box.w * 0.07, box.w * 0.075 * bl, '#fff6f8', 0.95);
    g.restore();

    // spectrum: one bin per row, low end at the bottom
    const spec = A.spectrum(t, 48, { min: 40, max: 12000 }), spec2 = A.spectrum(t - 0.06, 48, { min: 40, max: 12000 });
    for (let i = 0; i < 48; i++) spec[i] = 0.6 * spec[i] + 0.4 * spec2[i];
    const RAMP = ' .:-=+*#%';
    g.save();
    g.font = U.font(C.fs, U.FONT.PLEX, 500);
    if ('letterSpacing' in g) g.letterSpacing = `${C.ls.toFixed(2)}px`;
    g.textBaseline = 'top';
    g.fillStyle = opt.ink;
    for (let ry = 0; ry < rows; ry++) {
      const fr = 1 - ry / (rows - 1);
      const sb = fr * 47, s0 = Math.floor(sb), su = sb - s0;
      const sv = spec[s0] * (1 - su) + spec[Math.min(47, s0 + 1)] * su;
      // row length follows its band; ragged ends
      const len = U.clamp(0.36 + 0.42 * sv + 0.1 * lvl + 0.05 * U.vnoise(ry * 0.5, t * 0.7, 3.3), 0, 0.92);
      const n = Math.floor(len * cols);
      let str = '';
      for (let cx = 0; cx < n; cx++) {
        const l = lum[ry * cols + cx];
        // weight: band energy, picture brightness, a little flicker; thins toward the row end
        let v = 0.55 * sv + 0.55 * (l - 0.25) + 0.08 * U.vnoise(cx * 0.35, ry * 0.6, t * 1.2);
        v *= 0.6 + 0.4 * U.smooth(n, n * 0.7, cx);
        v = U.clamp(v, 0, 0.999);
        str += RAMP[Math.floor(v * RAMP.length)];
      }
      g.globalAlpha = 0.42 + 0.45 * sv;
      g.fillText(str, box.x + cw * 0.1, box.y + ry * rh + rh * 0.12);
    }
    // a pattern row along the bottom, like a marker line
    g.globalAlpha = 0.55 + 0.3 * A.band(t, 'sub');
    const nb = Math.floor(cols * (0.5 + 0.1 * (A.band(t, 'bass') + A.band(t - 0.08, 'bass'))));
    let pat = ''; for (let i = 0; i < nb; i++) pat += i % 2 ? '0' : 'X';
    g.fillText(pat, box.x + cw * 0.1, box.y + (rows - 4) * rh + rh * 0.12);
    g.restore();

    // light streaks: thin translucent vertical bars that flicker on hits
    if (opt.streaks) {
      // the streak set changes once per beat; brightness follows the hits
      const idx = A.beatIndex(t);
      C.streaks.forEach((s, i) => {
        const on = U.hash(i, idx) < 0.55 || i < 3;
        if (!on) return;
        const a = (0.12 + 0.3 * hit) * (0.6 + 0.4 * U.hash(i, idx, 2));
        g.fillStyle = `rgba(235,245,225,${a})`;
        const yy = box.y + box.h * U.clamp(s.y + 0.04 * (U.hash(i, idx, 3) - 0.5), 0, 1 - s.len);
        g.fillRect(box.x + box.w * s.x, yy, unit * 0.008 * s.wd, box.h * s.len);
      });
    }
  },
});
