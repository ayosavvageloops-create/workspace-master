// totem — a carved vertical spine: one stacked, mirrored pair of shapes per note event
// (bass = ochre almond seeds with pupils, chords = teal chevrons, lead = red diamonds),
// a feather fan on top and an arrowhead below. Played slots are inked, the rest wait as ghosts.
(function () {
  const STYLE = {
    bass: { col: '#b07b20', kind: 'seed' },
    chords: { col: '#2a8a78', kind: 'chevron' },
    lead: { col: '#c8452c', kind: 'diamond' },
    other: { col: '#5a7fa8', kind: 'diamond' },
  };
  const styleOf = (p) => STYLE[p.role] || STYLE.other;
  const DARK = '#2a1d0e', GHOST_F = '#dcd2b6', GHOST_S = '#c9bd9c';

  // one slot per note (a chord fills several stacked slots, top voice first)
  function events(part) {
    return part.notes.map((n) => ({ s: n.s, e: n.e, p: n.p })).sort((a, b) => a.s - b.s || b.p - a.p);
  }

  Looks.register({
    id: 'totem',
    name: 'totem',
    group: 'midi',
    theme: 'light',
    desc: 'a carved totem: one mirrored glyph per note, stacked down a spine',
    defaults: { accent: '#d2462e', bg: '#e6e0cf', window: 32, size: 1, ghosts: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'window', label: 'Slots per part', type: 'select', options: [12, 16, 24, 32, 48] },
      { key: 'size', label: 'Glyph size', type: 'range', min: 0.6, max: 1.6, step: 0.05 },
      { key: 'ghosts', label: 'Show upcoming slots', type: 'toggle' },
    ],
    prepare(S) {
      const ev = S.parts.map((p) => ({ p, ev: events(p) })).filter((x) => x.ev.length);
      // empty state: an uncarved totem of ghost seeds
      const ghost = { p: { role: 'bass', name: 'bass', lo: 0, hi: 1 }, ev: Array.from({ length: 24 }, (_, i) => ({ s: Infinity, e: Infinity, p: (i % 3) / 2 })) };
      return { ev, ghost };
    },
    draw(g, S) {
      const { w, h, unit, pad, opt, t } = S;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      const cx = w / 2;
      const yTop = h * (S.portrait ? 0.075 : 0.13), yBot = h * (S.portrait ? 0.875 : 0.86);
      const fanY = yTop - unit * 0.01;
      const all = S.cache.ev;

      // sections from the top: lead, chords, bass (reverse role order), only once a part has entered
      const live = all.filter((x) => x.ev[0].s <= t).reverse();
      const shown = live.length ? live : all.length ? all.slice(0, 1) : [S.cache.ghost];
      const win = +opt.window || 32;
      const counts = shown.map((x) => Math.min(win, x.ev.length));
      const totalSlots = counts.reduce((a, b) => a + b, 0) || 1;
      const y0 = yTop + unit * 0.012, span = yBot - y0 - unit * 0.012;
      const gw = unit * 0.055 * opt.size;

      // spine
      g.strokeStyle = '#3d3427'; g.lineWidth = Math.max(1.2, unit * 0.0018);
      g.beginPath(); g.moveTo(cx, fanY); g.lineTo(cx, yBot); g.stroke();

      let yy = y0;
      shown.forEach((x, si) => {
        const st = styleOf(x.p), ev = x.ev, n = counts[si];
        const secH = span * (n / totalSlots), step = secH / n;
        // current event index and the sliding window around it
        let cur = -1;
        for (let i = 0; i < ev.length && ev[i].s <= t; i++) cur = i;
        const first = U.clamp(cur - Math.floor(n * 0.35), 0, Math.max(0, ev.length - n));
        const lo = x.p.lo, hi = Math.max(x.p.hi, lo + 1);
        // draw bottom-up so upper glyphs overlap lower ones like scales
        for (let k = n - 1; k >= 0; k--) {
          const i = first + k, e = ev[i];
          if (!e) continue;
          const played = i <= cur, sounding = played && e.e > t;
          if (!played && !opt.ghosts) continue;
          const y = yy + (k + 0.5) * step;
          const sz = 0.82 + 0.36 * (e.p - lo) / (hi - lo);
          const hh = U.clamp(step * 1.25, gw * 0.5, gw * 0.85) * sz, ww = gw * sz * (sounding ? 1.08 : 1);
          const fill = played ? st.col : GHOST_F, stroke = played ? DARK : GHOST_S;
          g.lineWidth = Math.max(1, unit * (played ? 0.0022 : 0.0014));
          for (const side of [-1, 1]) {
            const gx = cx + side * (ww * 0.5 + unit * 0.002);
            if (st.kind === 'seed') {
              g.beginPath(); g.ellipse(gx, y, ww * 0.5, hh * 0.5, 0, 0, U.TAU);
              g.fillStyle = played ? fill : U.rgba(GHOST_F, 0.75); g.fill();
              g.strokeStyle = stroke; g.stroke();
              g.beginPath(); g.arc(gx + side * ww * 0.08, y, Math.min(hh, ww) * 0.2, 0, U.TAU);
              g.fillStyle = played ? DARK : U.rgba('#b9ac88', 0.7); g.fill();
            } else if (st.kind === 'chevron') {
              const cw = ww * 0.42, ch = Math.min(hh * 0.45, cw * 0.7);
              g.strokeStyle = played ? st.col : U.rgba('#b9c2b0', 0.8);
              g.lineWidth = Math.max(1.2, unit * (played ? 0.0032 : 0.002));
              g.beginPath(); g.moveTo(gx - cw, y + ch * 0.5); g.lineTo(gx, y - ch * 0.5); g.lineTo(gx + cw, y + ch * 0.5); g.stroke();
            } else {
              const dw = ww * 0.32, dh = Math.min(hh * 0.5, dw * 1.3);
              g.beginPath(); g.moveTo(gx, y - dh); g.lineTo(gx + dw, y); g.lineTo(gx, y + dh); g.lineTo(gx - dw, y); g.closePath();
              g.fillStyle = played ? fill : U.rgba(GHOST_F, 0.75); g.fill();
              g.strokeStyle = stroke; g.stroke();
            }
          }
        }
        yy += secH;
      });

      // feather fan
      const nF = 8, fr = unit * 0.0125, fl = unit * 0.052;
      const beat = S.A ? S.A.beatIndex(t) : Math.floor(t / S.spb);
      const reds = ((beat % 4) + 4) % 4 + 1;
      g.lineWidth = Math.max(1, unit * 0.0018); g.strokeStyle = DARK;
      for (let i = 0; i < nF; i++) {
        const a = -Math.PI / 2 + (i - (nF - 1) / 2) * 0.29;
        const ex = cx + Math.cos(a) * fl, ey = fanY + Math.sin(a) * fl * 0.85;
        g.beginPath(); g.moveTo(cx, fanY); g.lineTo(ex, ey); g.stroke();
      }
      for (let i = 0; i < nF; i++) {
        const a = -Math.PI / 2 + (i - (nF - 1) / 2) * 0.29;
        const ex = cx + Math.cos(a) * fl, ey = fanY + Math.sin(a) * fl * 0.85;
        g.beginPath(); g.arc(ex, ey, fr, 0, U.TAU);
        g.fillStyle = i < reds ? opt.accent : '#fbf8ef'; g.fill(); g.stroke();
      }
      // arrowhead
      const aw = unit * 0.034, ah = unit * 0.02;
      g.fillStyle = DARK;
      g.beginPath(); g.moveTo(cx - aw, yBot); g.lineTo(cx + aw, yBot); g.lineTo(cx, yBot + ah); g.closePath(); g.fill();

      // footer
      const bits = [];
      for (const x of all) bits.push(`${String(x.p.name || x.p.role).toUpperCase()} ${x.ev.length}`);
      if (!all.length) bits.push('NO PARTS');
      bits.push(S.sub);
      U.text(g, bits.join(' · '), pad * 0.9, h - pad * 0.9 - unit * 0.035, { size: unit * 0.0145, font: U.FONT.MONO, color: '#8f8672', spacing: 2 });
    },
  });
})();
