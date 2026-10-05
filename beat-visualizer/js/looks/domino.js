// domino — notes as purple blocks on a grey floor. Short notes stand as dominoes and topple
// when the playhead reaches them; held notes are planks on legs (length = duration) that light
// up while they sound. Rows are pitch, time scrolls right to left.
(function () {
  function rowsOf(parts) {
    const set = new Set();
    for (const p of parts) for (const n of p.notes) set.add(n.p);
    const list = [...set].sort((a, b) => a - b);
    return { list, idx: new Map(list.map((p, i) => [p, i])) };
  }
  // a box with a lit top face and darker side, drawn axis-aligned at (x, y) with size (w, h)
  function block(g, x, y, w, h, d, col, alpha) {
    g.globalAlpha = alpha;
    g.fillStyle = U.mix(col, '#ffffff', 0.35);                            // top face
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + d, y - d * 0.6); g.lineTo(x + w + d, y - d * 0.6); g.lineTo(x + w, y); g.closePath(); g.fill();
    g.fillStyle = U.mix(col, '#000000', 0.3);                             // side face
    g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + d, y - d * 0.6); g.lineTo(x + w + d, y + h - d * 0.6); g.lineTo(x + w, y + h); g.closePath(); g.fill();
    g.fillStyle = col; g.fillRect(x, y, w, h);                            // front face
    g.fillStyle = U.mix(col, '#000000', 0.18); g.fillRect(x, y + h * 0.55, w, h * 0.45);
    g.strokeStyle = U.mix(col, '#000000', 0.5); g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.globalAlpha = 1;
  }

  Looks.register({
    id: 'domino',
    name: 'domino',
    group: 'midi',
    theme: 'light',
    desc: 'short notes topple like dominoes, held notes rest under planks',
    defaults: { accent: '#6a4fc8', bg: '#e8e8ec', bars: 1.5, hold: 0.6, playhead: 0.42, glow: true },
    controls: [
      { key: 'bg', label: 'Floor', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'range', min: 1, max: 4, step: 0.5 },
      { key: 'hold', label: 'Plank from · beats', type: 'range', min: 0.25, max: 2, step: 0.05 },
      { key: 'playhead', label: 'Playhead position', type: 'range', min: 0.2, max: 0.6, step: 0.02 },
      { key: 'glow', label: 'Plank glow', type: 'toggle' },
    ],
    prepare(S) {
      const { w, h, opt } = S;
      // edge fades so blocks enter and leave softly
      const fade = U.layer(w, h, (g) => {
        const rgb = U.hexToRgb(opt.bg).join(',');
        const r = g.createLinearGradient(w * 0.82, 0, w, 0);
        r.addColorStop(0, `rgba(${rgb},0)`); r.addColorStop(1, `rgba(${rgb},1)`);
        g.fillStyle = r; g.fillRect(w * 0.82, 0, w * 0.18, h);
        const l = g.createLinearGradient(0, 0, w * 0.12, 0);
        l.addColorStop(0, `rgba(${rgb},1)`); l.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = l; g.fillRect(0, 0, w * 0.12, h);
      }, 0.5);
      return { rows: rowsOf(S.parts), fade };
    },
    draw(g, S) {
      const { w, h, unit: u, opt, parts } = S;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      const { list, idx } = S.cache.rows;
      const nR = Math.max(1, list.length);
      const y0 = S.portrait ? h * 0.07 : h * 0.12, y1 = S.portrait ? h * 0.97 : h * 0.95;
      const rowH = Math.min((y1 - y0) / nR, u * 0.12);
      const yb = y1 - ((y1 - y0) - nR * rowH) / 2;
      const base = (i) => yb - i * rowH;                                  // floor line of row i, low pitch at bottom
      const x0 = 0, x1 = w, W = x1 - x0;
      const win = S.bar * opt.bars, phx = x0 + W * opt.playhead;
      const tx = (tt) => phx + ((tt - S.t) / win) * W;
      const t0 = S.t - win * opt.playhead - S.bar, t1 = S.t + win * (1 - opt.playhead);
      const holdS = opt.hold * S.spb;
      const d = Math.max(3, rowH * 0.12);                                 // 3D depth
      const dh = Math.min(Math.max(rowH * 0.95, u * 0.045), u * 0.075), dw = Math.max(6, dh * 0.34);
      const pt = Math.max(5, Math.min(rowH * 0.16, u * 0.014)), legH = Math.min(rowH * 1.25, u * 0.1), legW = dw * 0.7;
      const shade = (p) => (p.role === 'bass' ? U.mix(opt.accent, '#2a1a70', 0.25) : p.role === 'lead' ? U.mix(opt.accent, '#b9a6ff', 0.35) : opt.accent);

      // collect drawables, painted bottom row last so nearer rows overlap farther ones
      const items = [];
      for (const p of parts) for (const n of Parts.inRange(p, t0, t1)) items.push([p, n]);
      items.sort((a, b) => b[1].p - a[1].p || a[1].s - b[1].s);
      for (const [p, n] of items) {
        const i = idx.get(n.p);
        if (i == null) continue;
        const col = shade(p), by = base(i);
        const xs = tx(n.s), xe = tx(n.e);
        const past = n.e <= S.t, playing = n.s <= S.t && !past, started = n.s <= S.t;
        const age = S.t - n.s;
        if (n.e - n.s < holdS) {
          // domino: upright until hit, then tips over to the left around its foot
          const k = started ? U.easeInOut(U.clamp(age / 0.22)) : 0;
          const ang = -k * Math.PI / 2;
          // soft floor shadow
          g.fillStyle = 'rgba(40,30,80,0.1)';
          g.fillRect(xs - dh * k - 2, by - 1, dw + dh * k * 1.02 + d, 3);
          g.save();
          g.translate(xs, by); g.rotate(ang);
          block(g, 0, -dh, dw, dh, d * (1 - k * 0.5), col, started ? 1 : 0.55);
          g.restore();
          if (started && age < 0.35) {
            // little impact puff
            const q = age / 0.35;
            g.strokeStyle = U.rgba(col, 0.5 * (1 - q)); g.lineWidth = 2;
            g.beginPath(); g.ellipse(xs - dh, by, dh * 0.3 * (0.5 + q), dh * 0.08 * (0.5 + q), 0, 0, U.TAU); g.stroke();
          }
        } else {
          // plank on legs; legs at both ends plus one per bar in between
          const top = by - legH - pt, len = Math.max(dw * 2, xe - xs);
          const a = started ? 1 : 0.4;
          g.fillStyle = 'rgba(40,30,80,0.09)';
          g.fillRect(xs, by - 1, len, 3);
          if (playing && opt.glow) {
            const gr = g.createLinearGradient(0, top - pt * 2, 0, top + pt * 4);
            gr.addColorStop(0, U.rgba(col, 0)); gr.addColorStop(0.45, U.rgba(col, 0.28)); gr.addColorStop(1, U.rgba(col, 0));
            g.fillStyle = gr; g.fillRect(xs - pt, top - pt * 2, len + pt * 2, pt * 6);
          }
          const nLegs = Math.max(2, Math.round(len / Math.max(dw * 8, W / (opt.bars * 4) * 1.6)) + 1);
          for (let j = 0; j < nLegs; j++) {
            const lx = xs + dw * 0.4 + (j / (nLegs - 1)) * (len - dw * 0.4 - legW - dw * 0.4);
            block(g, lx, top + pt, legW, legH, d * 0.6, col, a);
          }
          block(g, xs, top, len, pt, d, playing ? U.mix(col, '#8a6cff', 0.25) : col, a);
          if (!started) { g.strokeStyle = U.rgba(col, 0.6); g.lineWidth = 1.2; g.strokeRect(xs + 0.5, top + 0.5, len - 1, pt - 1); }
        }
      }

      // playhead
      g.fillStyle = 'rgba(70,70,80,0.55)'; g.fillRect(phx - 0.75, 0, 1.5, h);
      g.drawImage(S.cache.fade, 0, 0, w, h);

      if (!parts.length) {
        const by = (y0 + y1) / 2;
        for (let j = 0; j < 7; j++) {
          const x = w * 0.3 + j * u * 0.06, k = U.easeInOut(U.clamp((S.ct * 1.2 - j * 0.15) % 6));
          g.save(); g.translate(x, by); g.rotate(-k * Math.PI / 2.4); block(g, 0, -u * 0.06, u * 0.014, u * 0.06, u * 0.006, opt.accent, 0.8); g.restore();
        }
        U.text(g, 'no notes · load a midi file', w / 2, by + u * 0.06, { size: u * 0.022, font: U.FONT.MONO, color: '#6d6b78', align: 'center' });
      }
      // header
      U.text(g, `${S.meta.title || 'untitled'} · ${S.sub}`, S.pad, S.pad * 0.9 + u * 0.01, { size: u * 0.022, font: U.FONT.MONO, color: '#4a4856' });
      U.text(g, S.timeLabel(), w - S.pad, S.pad * 0.9 + u * 0.01, { size: u * 0.022, font: U.FONT.MONO, color: '#4a4856', align: 'right' });
    },
  });
})();
