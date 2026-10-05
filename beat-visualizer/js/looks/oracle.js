// oracle — a radial clock where one turn is one loop: each part owns a ring band, notes are
// arcs at their position in the loop (radius = pitch), a white hand sweeps the dial and the
// notes it has passed this turn light up while the rest of the loop waits as dim ghosts.
(function () {
  const ROLE_COL = { bass: '#7a5ce0', chords: '#24a596', lead: '#e5553c', drums: '#e0b24a', other: '#5a9fe0' };
  const colOf = (p) => ROLE_COL[p.role] || p.color || ROLE_COL.other;
  const gridOff = (S) => (S.A && S.A.beatOffset) || 0; // beat grid origin (MIDI offset or detected downbeat)

  Looks.register({
    id: 'oracle',
    name: 'oracle',
    group: 'midi',
    theme: 'dark',
    desc: 'a radial clock: one turn is one loop, notes as arcs on part rings',
    defaults: { accent: '#ffffff', bg: '#0b0b10', loop: 4, ghosts: true, glow: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'loop', label: 'Bars per turn', type: 'select', options: [2, 4, 8] },
      { key: 'ghosts', label: 'Show the rest of the loop', type: 'toggle' },
      { key: 'glow', label: 'Radar glow', type: 'toggle' },
    ],
    prepare(S) {
      const { w, h, unit, portrait, pad } = S;
      // layout: wide formats keep the legend bottom-left beside the dial; others stack it above the handle watermark
      const wide = w / h > 1.3;
      const handleTop = (portrait ? h - unit * 0.16 : h - pad * 0.9) - unit * 0.036;
      const fy = wide ? h - pad * 0.9 - unit * 0.012 : handleTop - unit * 0.004;
      const headBot = pad * 0.9 + unit * 0.11, footTop = wide ? h - pad * 0.6 : fy - unit * 0.13;
      const cx = w / 2, cy = wide ? h * 0.52 : (headBot + footTop) / 2;
      const R = Math.min(portrait ? unit * 0.33 : unit * 0.36, (footTop - headBot) / 2 / 1.27);
      const bg = U.layer(w, h, (c) => {
        c.fillStyle = S.opt.bg; c.fillRect(0, 0, w, h);
        U.glowBlob(c, cx, cy, R * 1.35, '#2a2150', 0.55);
        U.glowBlob(c, cx, cy, R * 0.7, '#3a2e6a', 0.25);
      }, 0.25);
      // ticks + guides (sharp, full res)
      const dial = U.layer(w, h, (c) => {
        c.drawImage(bg, 0, 0, w, h);
        c.lineCap = 'butt';
        for (let i = 0; i < 96; i++) {
          const a = (i / 96) * U.TAU - Math.PI / 2, major = i % 8 === 0;
          const r0 = R * 1.1, r1 = R * (major ? 1.15 : 1.125);
          c.strokeStyle = major ? 'rgba(200,190,255,0.32)' : 'rgba(160,150,220,0.2)';
          c.lineWidth = Math.max(1, unit * 0.0016);
          c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
        }
        c.strokeStyle = 'rgba(230,230,240,0.55)'; c.lineWidth = Math.max(1.2, unit * 0.002);
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 - Math.PI / 2, r0 = R * 1.17, r1 = R * 1.24;
          c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
        }
      }, 1);
      return { cx, cy, R, dial, wide, fy };
    },
    draw(g, S) {
      const { w, h, unit, pad, opt, parts, t } = S;
      const { cx, cy, R } = S.cache;
      g.drawImage(S.cache.dial, 0, 0, w, h);

      const off = gridOff(S), loopLen = S.bar * (+opt.loop || 4);
      const li = Math.floor((t - off) / loopLen), L0 = off + li * loopLen, pos = (t - L0) / loopLen;
      const ang = (k) => -Math.PI / 2 + k * U.TAU;
      const handA = ang(pos);

      // bands: inner to outer, one per part
      const n = Math.max(1, parts.length), rIn = R * 0.2, rOut = R, bandW = (rOut - rIn) / n;
      const bands = parts.map((p, i) => ({ p, r0: rIn + i * bandW + bandW * 0.12, r1: rIn + (i + 1) * bandW - bandW * 0.08 }));

      // guide circles
      g.lineWidth = Math.max(1, unit * 0.0014);
      g.strokeStyle = 'rgba(190,185,230,0.16)';
      const guides = parts.length ? [rIn * 0.95, ...bands.map((b) => b.r1 + bandW * 0.04)] : [R * 0.35, R * 0.6, R];
      for (const r of guides) { g.beginPath(); g.arc(cx, cy, r, 0, U.TAU); g.stroke(); }
      // pitch labels at the top of each band
      for (const b of bands) {
        U.text(g, U.noteName(b.p.lo), cx + unit * 0.012, cy - b.r0 + unit * 0.004, { size: unit * 0.0115, font: U.FONT.MONO, color: 'rgba(200,195,235,0.4)' });
      }

      // radar sweep trailing the hand
      if (opt.glow && g.createConicGradient) {
        const cg = g.createConicGradient(handA - 0.9, cx, cy);
        cg.addColorStop(0, 'rgba(150,130,255,0)');
        cg.addColorStop(0.9 / U.TAU, 'rgba(170,150,255,0.08)');
        cg.addColorStop(0.9 / U.TAU + 0.001, 'rgba(170,150,255,0)');
        cg.addColorStop(1, 'rgba(150,130,255,0)');
        g.fillStyle = cg;
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 1.08, handA - 0.9, handA); g.closePath(); g.fill();
      }

      // note arcs
      g.lineCap = 'round';
      const lw = Math.max(2, Math.min(unit * 0.011, bandW * 0.12));
      const arc = (b, nt, a0, a1, style, width) => {
        const span = Math.max(1, b.p.hi - b.p.lo);
        const r = b.p.hi === b.p.lo ? (b.r0 + b.r1) / 2 : b.r0 + (b.r1 - b.r0) * (nt.p - b.p.lo) / span;
        const gapA = Math.min(0.02, (a1 - a0) * 0.2);
        g.strokeStyle = style; g.lineWidth = width;
        g.beginPath(); g.arc(cx, cy, r, a0 + gapA, Math.max(a0 + gapA + 0.004, a1 - gapA)); g.stroke();
      };
      for (const b of bands) {
        const col = colOf(b.p);
        if (opt.ghosts) {
          // the not-yet-reached part of the turn: previous turn's notes, else this turn's upcoming ones
          const src = li > 0 ? L0 - loopLen : L0;
          for (const nt of Parts.inRange(b.p, src + pos * loopLen, src + loopLen)) {
            const k0 = Math.max(pos, (nt.s - src) / loopLen), k1 = Math.min(1, (nt.e - src) / loopLen);
            if (k1 > k0) arc(b, nt, ang(k0), ang(k1), U.rgba(col, 0.22), lw);
          }
          if (li > 0) for (const nt of Parts.inRange(b.p, L0 + pos * loopLen, L0 + loopLen)) {
            const k0 = Math.max(pos, (nt.s - L0) / loopLen), k1 = Math.min(1, (nt.e - L0) / loopLen);
            if (k1 > k0) arc(b, nt, ang(k0), ang(k1), U.rgba(col, 0.14), lw);
          }
        }
        // played this turn
        for (const nt of Parts.inRange(b.p, L0, t)) {
          if (nt.s > t) continue;
          const k0 = Math.max(0, (nt.s - L0) / loopLen), k1 = Math.min(pos, (nt.e - L0) / loopLen);
          if (k1 <= k0) continue;
          const live = nt.e > t;
          arc(b, nt, ang(k0), ang(k1), live ? U.mix(col, '#ffffff', 0.25) : col, live ? lw * 1.25 : lw);
        }
      }

      // hand
      const hx = cx + Math.cos(handA) * R * 1.12, hy = cy + Math.sin(handA) * R * 1.12;
      g.lineCap = 'round';
      g.strokeStyle = U.rgba(opt.accent, 0.18); g.lineWidth = Math.max(3, unit * 0.007);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = U.rgba(opt.accent, 0.95); g.lineWidth = Math.max(1.5, unit * 0.0022);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(hx, hy); g.stroke();

      // centre key
      g.fillStyle = U.rgba(S.opt.bg, 0.85);
      g.beginPath(); g.arc(cx, cy, Math.min(rIn * 0.9, unit * 0.045), 0, U.TAU); g.fill();
      U.text(g, S.meta.key || '·', cx, cy + unit * 0.014, { size: unit * 0.04, font: U.FONT.MONO, color: '#f4f2ff', align: 'center', max: rIn * 1.6 });
      if (!parts.length) U.text(g, 'NO PARTS', cx, cy + R * 0.5, { size: unit * 0.014, font: U.FONT.MONO, color: 'rgba(200,195,235,0.45)', align: 'center', spacing: 4 });

      // header
      const top = pad * 0.9 + unit * 0.05, wide = S.cache.wide;
      const tMax = wide ? cx - R * 1.3 - pad * 0.9 : w - pad * 1.8;
      U.text(g, S.meta.title || 'untitled', pad * 0.9, top, { size: unit * 0.06, font: U.FONT.PLEX, color: '#f2f2f4', max: tMax });
      U.text(g, `ORACLE · ONE TURN = ${+opt.loop || 4} BARS`, pad * 0.9, top + unit * 0.036, { size: unit * 0.016, font: U.FONT.MONO, color: 'rgba(220,220,230,0.45)', spacing: 1.5, max: tMax });

      // legend + footer
      const fy = S.cache.fy, fw = wide ? Math.min(w * 0.3, cx - R * 1.3 - pad * 0.9) : w - pad * 1.8;
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(pad * 0.9, fy - unit * 0.035, fw, 1);
      U.text(g, S.sub, pad * 0.9, fy, { size: unit * 0.017, font: U.FONT.MONO, color: 'rgba(220,220,230,0.45)', spacing: 1, max: fw });
      const legend = S.allParts.length ? S.allParts : [{ role: 'bass', name: 'bass' }, { role: 'chords', name: 'chords' }, { role: 'lead', name: 'lead' }];
      const lgY = fy - unit * 0.07, nL = Math.min(5, legend.length), step = Math.min(unit * 0.145, fw / Math.max(1, nL));
      legend.slice(0, 5).forEach((p, i) => {
        const x = pad * 0.9 + i * step;
        g.fillStyle = p.enabled === false ? 'rgba(255,255,255,0.15)' : colOf(p);
        g.fillRect(x, lgY - unit * 0.026, unit * 0.028, Math.max(2, unit * 0.003));
        U.text(g, String(p.name || p.role).toUpperCase(), x, lgY, { size: unit * 0.015, font: U.FONT.MONO, color: 'rgba(220,220,230,0.5)', spacing: 1, max: step - unit * 0.012 });
      });
    },
  });
})();
