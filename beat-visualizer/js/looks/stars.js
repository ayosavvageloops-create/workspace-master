// stars — the parts as constellations on a night sky: every note a star placed by time
// and pitch, each part joined into its own figure (bass low, chords above the horizon),
// stars light up as the dashed meridian passes and the sounding ones wear a halo.
(function () {
  const ROLE_COL = { bass: '#8f7dff', chords: '#45d4bd', lead: '#ff8b78', drums: '#f2cf63', other: '#7fb2ff' };
  const colOf = (p) => ROLE_COL[p.role] || ROLE_COL.other;
  const WORDS = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
  const gridOff = (S) => (S.A && S.A.beatOffset) || 0; // beat grid origin (MIDI offset or detected downbeat)

  Looks.register({
    id: 'stars',
    name: 'stars',
    group: 'midi',
    theme: 'dark',
    desc: 'notes as stars joined into one constellation per part',
    defaults: { accent: '#dfe4ff', bg: '#050a14', bars: 4, mode: 'scroll', labels: true, sky: 1 },
    controls: [
      { key: 'bg', label: 'Sky', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [2, 4, 8] },
      { key: 'mode', label: 'Motion', type: 'select', options: ['scroll', 'page'] },
      { key: 'labels', label: 'Note labels', type: 'toggle' },
      { key: 'sky', label: 'Background stars', type: 'range', min: 0, max: 2, step: 0.1 },
    ],
    prepare(S) {
      const { w, h, unit } = S;
      const sky = U.layer(w, h, (c) => {
        c.fillStyle = S.opt.bg; c.fillRect(0, 0, w, h);
        const r = U.rng(S.seed + 17), n = Math.round(260 * S.opt.sky * (w * h) / (1080 * 1920));
        for (let i = 0; i < n; i++) {
          const x = r() * w, y = r() * h, big = r() < 0.06;
          c.fillStyle = `rgba(210,220,255,${(big ? 0.45 : 0.12) + r() * 0.3})`;
          c.beginPath(); c.arc(x, y, (big ? 1.4 : 0.7) * Math.max(1, unit / 1080) + r() * 0.6, 0, U.TAU); c.fill();
        }
      }, 1);
      return { sky };
    },
    draw(g, S) {
      const { w, h, unit, pad, opt, parts, t, portrait } = S;
      g.drawImage(S.cache.sky, 0, 0, w, h);

      const off = gridOff(S), bars = +opt.bars || 4, win = bars * S.bar;
      const ws = opt.mode === 'page' ? off + Math.floor((t - off) / win) * win : Math.max(off, t - win / 2);
      const x0 = pad * 0.9, x1 = w - pad * 0.9;
      const X = (tt) => x0 + ((tt - ws) / win) * (x1 - x0);

      // regions, bottom-up: bass, chords, lead…
      const handleTop = (portrait ? h - unit * 0.16 : h - pad * 0.9) - unit * 0.036;
      const B = Math.min(portrait ? h * 0.86 : h * 0.83, handleTop - unit * 0.075), T = portrait ? h * 0.15 : h * 0.2;
      const k = Math.max(1, parts.length), gap = h * 0.05;
      const rh = Math.min(h * 0.22, (B - T - gap * (k - 1)) / k);
      const regions = parts.map((p, i) => ({ p, y1: B - i * (rh + gap), y0: B - i * (rh + gap) - rh }));

      // horizon arc between the first two regions
      const hy = regions.length > 1 ? (regions[0].y0 + regions[1].y1) / 2 : h * 0.5;
      g.strokeStyle = 'rgba(150,165,190,0.3)'; g.lineWidth = Math.max(1, unit * 0.0014);
      g.setLineDash([unit * 0.006, unit * 0.007]);
      g.beginPath(); g.moveTo(x0, hy + h * 0.025); g.quadraticCurveTo(w / 2, hy - h * 0.05, x1, hy + h * 0.025); g.stroke();

      // meridian (playhead)
      const px = X(t), yTop = T - h * 0.05, yBot = B + unit * 0.022;
      g.strokeStyle = 'rgba(180,195,220,0.4)';
      g.setLineDash([unit * 0.004, unit * 0.006]);
      g.beginPath(); g.moveTo(px, yTop); g.lineTo(px, yBot); g.stroke();
      g.setLineDash([]);

      // constellations
      const tA = ws - S.bar * 0.25, tB = ws + win + S.bar * 0.25;
      const lab = { size: unit * 0.0115, font: U.FONT.MONO, color: 'rgba(170,180,205,0.55)' };
      g.save();
      g.beginPath(); g.rect(x0 - unit * 0.02, 0, x1 - x0 + unit * 0.04, h); g.clip();
      for (const R of regions) {
        const p = R.p, col = colOf(p), span = Math.max(1, p.hi - p.lo);
        const ns = Parts.inRange(p, tA, tB).filter((n) => n.s >= tA).sort((a, b) => a.s - b.s || a.p - b.p);
        const pts = ns.map((n) => ({ n, x: X(n.s), y: p.hi === p.lo ? (R.y0 + R.y1) / 2 : R.y1 - ((n.p - p.lo) / span) * (R.y1 - R.y0) }));
        g.lineWidth = Math.max(1, unit * 0.0015);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], past = b.n.s <= t;
          g.strokeStyle = past ? U.rgba(U.mix(col, '#9aa0c0', 0.45), 0.55) : 'rgba(110,116,140,0.35)';
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        let lastBar = -1;
        for (const { n, x, y } of pts) {
          const past = n.s <= t, live = past && n.e > t;
          const r = unit * (past ? 0.0058 : 0.0046) * (0.75 + 0.4 * n.v);
          if (live) {
            U.glowBlob(g, x, y, r * 6, col, 0.35);
            g.strokeStyle = col; g.lineWidth = Math.max(1.5, unit * 0.0026);
            g.beginPath(); g.arc(x, y, r * 2.1, 0, U.TAU); g.stroke();
          }
          g.fillStyle = past ? opt.accent : '#5e6476';
          g.beginPath(); g.arc(x, y, live ? r * 1.25 : r, 0, U.TAU); g.fill();
          if (opt.labels && p.role === 'bass') {
            const b = Math.floor((n.s - off) / S.bar + 1e-6);
            if (b !== lastBar) { lastBar = b; U.text(g, U.noteName(n.p), x + r * 2.4, y + unit * 0.004, lab); }
          }
        }
      }
      g.restore();
      if (!parts.length) U.text(g, 'AN EMPTY SKY', w / 2, h * 0.5, { size: unit * 0.016, font: U.FONT.MONO, color: 'rgba(170,180,205,0.5)', align: 'center', spacing: 6 });

      // bar axis ("hours")
      const ay = B + unit * 0.05;
      const b0 = Math.ceil((ws - off) / S.bar - 1e-6), curBar = Math.floor((t - off) / S.bar);
      for (let b = b0; off + b * S.bar <= ws + win + 1e-6; b++) {
        const x = X(off + b * S.bar);
        U.text(g, `${b}h`, x, ay, { size: unit * 0.0135, font: U.FONT.MONO, align: 'center', color: b === curBar ? 'rgba(235,240,255,0.9)' : 'rgba(150,160,185,0.5)' });
      }

      // header + footer
      const top = pad * 0.9 + unit * 0.05;
      U.text(g, S.meta.title || 'untitled', pad * 0.9, top, { size: unit * 0.06, font: U.FONT.PLEX, color: '#f2f4fb', max: w - pad * 1.8 });
      U.text(g, `${WORDS[bars] || bars} CONSTELLATIONS${S.meta.key ? ' · ' + S.meta.key : ''}`, pad * 0.9, top + unit * 0.036,
        { size: unit * 0.0135, font: U.FONT.MONO, color: 'rgba(170,180,205,0.5)', spacing: unit * 0.006, max: w - pad * 1.8 });
      const fy = h - pad * 0.9 - unit * 0.02;
      U.text(g, `${Math.round(S.bpm)} BPM`, pad * 0.9, fy, { size: unit * 0.0145, font: U.FONT.MONO, color: 'rgba(170,180,205,0.6)', spacing: unit * 0.008 });
      U.text(g, S.timeLabel(2), w - pad * 0.9, fy, { size: unit * 0.0145, font: U.FONT.MONO, color: 'rgba(170,180,205,0.6)', align: 'right' });
    },
  });
})();
