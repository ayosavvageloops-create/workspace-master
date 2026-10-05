// trap-phosphor — a green phosphor CRT in a dark bezel: pixel-font title, a spectrum strip,
// and a vertical piano roll whose notes rise through a glowing horizontal playhead.
(function () {
  // pitch range of the parts, padded and at least `span` semitones wide
  function range(parts, span) {
    let lo = 127, hi = 0;
    for (const p of parts) for (const n of p.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
    if (lo > hi) { lo = 36; hi = 84; }
    lo -= 3; hi += 3;
    if (hi - lo < span) { const c = (lo + hi) / 2; lo = Math.floor(c - span / 2); hi = lo + span; }
    return [lo, hi];
  }

  function layout(S) {
    const { w, h, unit, portrait } = S;
    let bx, by, bw, bh;
    if (portrait) { bx = w * 0.055; bw = w - bx * 2; by = h * 0.03; bh = h * 0.77; }
    else {
      // keep the bottom strip free for the core's handle watermark
      const markTop = h - S.pad * 0.9 - unit * 0.035;
      by = h * 0.045; bh = markTop - by - unit * 0.015; bw = Math.min(w - S.pad * 2, bh * 1.25); bx = (w - bw) / 2;
    }
    const b = unit * 0.026; // bezel thickness
    const sx = bx + b, sy = by + b, sw = bw - b * 2, sh = bh - b * 2;
    const ix = sx + sw * 0.035, iw = sw * 0.93;                       // inner content x span
    const titleY = sy + sh * (portrait ? 0.045 : 0.075);
    const specY0 = sy + sh * (portrait ? 0.058 : 0.095), specY1 = specY0 + sh * (portrait ? 0.038 : 0.06);
    const legY = specY1 + sh * 0.018;
    const ry0 = legY + sh * 0.015, ry1 = sy + sh * (portrait ? 0.945 : 0.9);
    const stepY = sy + sh * (portrait ? 0.98 : 0.965);
    return { bx, by, bw, bh, b, sx, sy, sw, sh, ix, iw, titleY, specY0, specY1, legY, ry0, ry1, stepY };
  }

  Looks.register({
    id: 'trap-phosphor',
    name: 'trap phosphor',
    group: 'midi',
    theme: 'dark',
    desc: 'a green phosphor monitor: notes rise through a glowing scanline',
    defaults: { accent: '#6fe35a', chords: '#1fb79a', bg: '#000000', bars: 2.5, playhead: 0.22, scanlines: true, glow: true },
    controls: [
      { key: 'chords', label: 'Chord colour', type: 'color' },
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'range', min: 1, max: 6, step: 0.5 },
      { key: 'playhead', label: 'Playhead height', type: 'range', min: 0.1, max: 0.6, step: 0.02 },
      { key: 'scanlines', label: 'Scanlines', type: 'toggle' },
      { key: 'glow', label: 'Phosphor glow', type: 'toggle' },
    ],
    prepare(S) {
      const L = layout(S), opt = S.opt;
      const [lo, hi] = range(S.parts, 30);
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        // bezel with a soft drop shadow and a subtle top highlight
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = S.unit * 0.03; g.shadowOffsetY = S.unit * 0.008;
        U.rrect(g, L.bx, L.by, L.bw, L.bh, S.unit * 0.03);
        const bz = g.createLinearGradient(0, L.by, 0, L.by + L.bh);
        bz.addColorStop(0, '#34373a'); bz.addColorStop(1, '#232528');
        g.fillStyle = bz; g.fill();
        g.restore();
        U.rrect(g, L.bx + 1, L.by + 1, L.bw - 2, L.bh - 2, S.unit * 0.03);
        g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2; g.stroke();
        // glass
        U.rrect(g, L.sx, L.sy, L.sw, L.sh, S.unit * 0.012);
        g.fillStyle = '#0b100b'; g.fill();
        g.save(); g.clip();
        const rg = g.createRadialGradient(L.sx + L.sw / 2, L.sy + L.sh * 0.45, 0, L.sx + L.sw / 2, L.sy + L.sh * 0.45, Math.max(L.sw, L.sh) * 0.75);
        rg.addColorStop(0, 'rgba(60,90,50,0.22)'); rg.addColorStop(1, 'rgba(0,0,0,0.5)');
        g.fillStyle = rg; g.fillRect(L.sx, L.sy, L.sw, L.sh);
        // pitch columns (black-key columns slightly darker)
        const cw = L.iw / (hi - lo + 1);
        for (let p = lo; p <= hi; p++) {
          const x = L.ix + (p - lo) * cw;
          if ([1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, L.ry0, cw, L.ry1 - L.ry0); }
          g.fillStyle = (p % 12 === 0) ? 'rgba(120,200,100,0.09)' : 'rgba(120,200,100,0.035)';
          g.fillRect(x, L.ry0, 1, L.ry1 - L.ry0);
        }
        g.restore();
      });
      // scanlines + inner glass shading, laid over the content
      const scan = U.layer(S.w, S.h, (g) => {
        U.rrect(g, L.sx, L.sy, L.sw, L.sh, S.unit * 0.012); g.clip();
        if (opt.scanlines) {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          const step = Math.max(3, Math.round(S.unit * 0.004));
          for (let y = L.sy; y < L.sy + L.sh; y += step) g.fillRect(L.sx, y, L.sw, step / 2);
        }
        const v = g.createRadialGradient(L.sx + L.sw / 2, L.sy + L.sh / 2, Math.min(L.sw, L.sh) * 0.35, L.sx + L.sw / 2, L.sy + L.sh / 2, Math.max(L.sw, L.sh) * 0.72);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
        g.fillStyle = v; g.fillRect(L.sx, L.sy, L.sw, L.sh);
      });
      return { L, lo, hi, bg, scan };
    },
    draw(g, S) {
      const { opt, parts, A, unit } = S;
      const { L, lo, hi } = S.cache;
      const green = opt.accent, teal = opt.chords;
      const lead = U.mix(green, '#f4ffb0', 0.55);
      const colOf = (p) => (p.role === 'chords' ? teal : p.role === 'bass' ? green : lead);
      g.drawImage(S.cache.bg, 0, 0, S.w, S.h);

      // title (pixel font) — slight glow via a second, wider pass
      const tSize = L.sh * (S.portrait ? 0.04 : 0.06);
      const title = (S.meta.title || 'untitled').toUpperCase();
      if (opt.glow) { g.save(); g.shadowColor = U.rgba(green, 0.6); g.shadowBlur = tSize * 0.35; }
      U.text(g, title, L.ix, L.titleY, { size: tSize, font: U.FONT.PIXEL, color: U.rgba(green, 0.85), spacing: 2, max: L.iw });
      if (opt.glow) g.restore();

      // spectrum strip
      // spectrum averaged over a few past instants so the bars breathe instead of flickering
      const NB = 48, sp = A.spectrum(S.t, NB, { min: 35, max: 12000 });
      const spB = A.spectrum(S.t - 0.03, NB, { min: 35, max: 12000 }), spC = A.spectrum(S.t - 0.06, NB, { min: 35, max: 12000 });
      for (let i = 0; i < NB; i++) sp[i] = sp[i] * 0.5 + spB[i] * 0.3 + spC[i] * 0.2;
      const bw = L.iw / NB, sh0 = L.specY1 - L.specY0;
      for (let i = 0; i < NB; i++) {
        const v = Math.max(0.3, Math.min(1, 0.25 + sp[i] * 1.2));
        const bh = sh0 * v;
        g.fillStyle = U.rgba(U.mix(green, '#20381c', i / NB * 0.55), 0.55 + 0.4 * v);
        g.fillRect(L.ix + i * bw + 1, L.specY1 - bh, bw - 2.5, bh);
      }

      // legend
      let lx = L.ix;
      const ls = L.sh * 0.012;
      for (const p of S.allParts) {
        if (lx > L.ix + L.iw * 0.5) break;
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        g.fillStyle = on ? colOf(p) : 'rgba(110,150,90,0.3)';
        g.fillRect(lx, L.legY - ls * 0.8, ls * 0.8, ls * 0.8);
        lx += ls * 1.4 + U.text(g, p.name, lx + ls * 1.3, L.legY, { size: ls * 1.4, font: U.FONT.PIXEL, color: on ? U.rgba(green, 0.6) : 'rgba(110,150,90,0.3)', max: L.iw * 0.2 }) + ls * 1.6;
      }

      // bpm / key / time readout on the legend line, right-aligned in the space the legend leaves
      U.text(g, `${S.sub}   ${S.timeLabel(2)}`, L.ix + L.iw, L.legY, { size: ls * 1.6, font: U.FONT.PIXEL, color: U.rgba(green, 0.5), align: 'right', spacing: 1, max: Math.max(ls * 10, L.ix + L.iw - lx - ls * 2) });

      // roll: pitch on x, time on y (future below, rising)
      const ry0 = L.ry0, ry1 = L.ry1, rh = ry1 - ry0;
      const win = S.bar * opt.bars, phy = ry0 + rh * opt.playhead;
      const ty = (tt) => phy + ((tt - S.t) / win) * rh;
      const t0 = S.t - win * opt.playhead, t1 = S.t + win * (1 - opt.playhead);
      const cw = L.iw / (hi - lo + 1);
      g.save();
      g.beginPath(); g.rect(L.sx, ry0, L.sw, rh); g.clip();
      // beat / bar lines that scroll with time
      const b0 = Math.floor((t0 - A.beatOffset) / S.spb), b1 = Math.ceil((t1 - A.beatOffset) / S.spb);
      for (let b = b0; b <= b1; b++) {
        const y = ty(A.beatOffset + b * S.spb);
        g.fillStyle = b % 4 === 0 ? 'rgba(120,200,100,0.1)' : 'rgba(120,200,100,0.035)';
        g.fillRect(L.ix, Math.round(y), L.iw, 1);
      }
      const nw = Math.max(3, cw * 0.38);
      const hits = [];
      for (const p of parts) {
        const col = colOf(p);
        for (const n of Parts.inRange(p, t0, t1)) {
          const x = L.ix + (n.p - lo + 0.5) * cw - nw / 2;
          const ya = ty(n.s) + 1, yb = ty(n.e) - 2;
          const playing = n.s <= S.t && n.e > S.t;
          if (playing && opt.glow) { g.fillStyle = U.rgba(col, 0.18); g.fillRect(x - nw, ya, nw * 3, yb - ya); }
          g.fillStyle = U.rgba(col, playing ? 1 : n.e <= S.t ? 0.55 : 0.8);
          g.fillRect(x, ya, nw, Math.max(2, yb - ya));
          if (playing) hits.push([x + nw / 2, col, U.clamp((S.t - n.s) / 0.25)]);
        }
      }
      g.restore();

      // playhead: soft band + bright core
      if (opt.glow) {
        const gr = g.createLinearGradient(0, phy - unit * 0.02, 0, phy + unit * 0.02);
        gr.addColorStop(0, U.rgba(green, 0)); gr.addColorStop(0.5, U.rgba(green, 0.32)); gr.addColorStop(1, U.rgba(green, 0));
        g.fillStyle = gr; g.fillRect(L.ix - 4, phy - unit * 0.02, L.iw + 8, unit * 0.04);
      }
      g.fillStyle = U.rgba(green, 0.95); g.fillRect(L.ix - 4, phy - 2, L.iw + 8, 4);
      g.fillStyle = 'rgba(230,255,210,0.8)'; g.fillRect(L.ix - 4, phy - 0.75, L.iw + 8, 1.5);
      // a small ring where a note crosses the line
      g.lineWidth = 2;
      for (const [x, col, k] of hits) {
        g.strokeStyle = U.rgba(col, 0.9 * (1 - k * 0.6));
        g.beginPath(); g.arc(x, phy, unit * (0.008 + 0.01 * k), 0, U.TAU); g.stroke();
      }

      // empty state
      if (!parts.length || !parts.some((p) => p.notes.length)) {
        const blink = Math.floor(S.t * 1.5) % 2 === 0;
        U.text(g, 'NO SIGNAL', L.ix + L.iw / 2, ry0 + rh * 0.55, { size: L.sh * 0.05, font: U.FONT.PIXEL, color: U.rgba(green, blink ? 0.8 : 0.35), align: 'center', spacing: 4 });
        U.text(g, 'load a midi file', L.ix + L.iw / 2, ry0 + rh * 0.55 + L.sh * 0.035, { size: L.sh * 0.022, font: U.FONT.PIXEL, color: U.rgba(green, 0.35), align: 'center', spacing: 2 });
      }

      // 16 step marks for the current bar: taller where a note starts, bright on the current step
      const barStart = A.beatOffset + Math.floor((S.t - A.beatOffset) / S.bar) * S.bar;
      const step = S.bar / 16, cur = Math.floor((S.t - barStart) / step);
      const on = new Float32Array(16);
      for (const p of parts) for (const n of Parts.inRange(p, barStart, barStart + S.bar)) {
        const k = Math.floor((n.s - barStart) / step);
        if (k >= 0 && k < 16) on[k] = Math.max(on[k], n.v || 0.8);
      }
      const sw = L.iw / 16, mh = L.sh * 0.012;
      for (let k = 0; k < 16; k++) {
        const hh = mh * (0.35 + on[k] * 0.9) * (k === cur ? 1.4 : 1);
        g.fillStyle = U.rgba(green, k === cur ? 0.95 : on[k] ? 0.6 : 0.3);
        g.fillRect(L.ix + k * sw + sw * 0.3, L.stepY - hh, sw * 0.28, hh);
      }

      g.drawImage(S.cache.scan, 0, 0, S.w, S.h);
    },
  });
})();
