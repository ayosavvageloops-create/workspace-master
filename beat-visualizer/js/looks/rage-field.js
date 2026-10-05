// rage-field — a dark piano-roll panel with glowing capsule notes (purple bass, teal
// chords, rose lead) sliding past a white playhead.
(function () {
  const ROLE = { bass: '#b493ff', chords: '#5fe3d2', lead: '#ff7f9f', drums: '#ffd27a', other: '#8fc4ff' };
  const colOf = (p) => ROLE[p.role] || ROLE.other;

  // header: time label right; "title · bpm · key" left, where only the title shrinks/truncates
  function drawHeader(g, S, x0, x1, y, o, bpmWord) {
    const rw = U.text(g, S.timeLabel(), x1, y, { ...o, align: 'right', max: (x1 - x0) * 0.4 });
    const avail = x1 - x0 - rw - S.unit * 0.04;
    const rest = ` · ${Math.round(S.bpm)} ${bpmWord}${S.meta.key ? ' · ' + S.meta.key : ''}`;
    const restW = U.textWidth(g, rest, o);
    const f = U.fit(g, String(S.meta.title || 'untitled'), Math.max(S.unit * 0.08, avail - restW), o);
    const tw = U.text(g, f.str, x0, y, { ...o, size: f.size });
    U.text(g, rest, x0 + tw, y, { ...o, size: f.size, max: Math.max(1, avail - tw) });
  }

  Looks.register({
    id: 'rage-field',
    name: 'rage-field',
    group: 'midi',
    theme: 'dark',
    desc: 'glowing capsule notes on a dark piano-roll panel',
    defaults: { accent: '#ffffff', bg: '#000000', panel: '#121414', bars: 2, playhead: 0.3, glow: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'panel', label: 'Panel', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [1, 2, 4, 8] },
      { key: 'playhead', label: 'Playhead position', type: 'range', min: 0.1, max: 0.6, step: 0.05 },
      { key: 'glow', label: 'Glow on playing notes', type: 'toggle' },
    ],
    prepare(S) {
      let lo = 127, hi = 0;
      for (const p of S.parts) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
      if (lo > hi) { lo = 36; hi = 84; }
      lo -= 2; hi += 3;
      const { w, h, pad, portrait } = S;
      const box = { x0: pad, x1: w - pad, y0: portrait ? h * 0.098 : h * 0.15, y1: portrait ? Math.min(h * 0.8, h - S.unit * 0.21) : h - pad * 0.9 - S.unit * 0.05 };
      const rowH = (box.y1 - box.y0) / (hi - lo + 1);
      // glow sprites per role colour (cheaper than shadowBlur)
      const glows = {};
      for (const k in ROLE) glows[k] = U.layer(64, 32, (g) => {
        g.save(); g.scale(1, 0.5); U.glowBlob(g, 32, 32, 32, ROLE[k], 0.9); g.restore();
      });
      return { lo, hi, box, rowH, glows };
    },
    draw(g, S) {
      const { w, h, pad, unit, opt, parts, cache } = S;
      const { box, rowH, lo } = cache;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

      // header + legend
      const top = S.portrait ? h * 0.047 : pad + unit * 0.03;
      const ts = { size: unit * 0.03, font: U.FONT.PLEX, color: '#e8e8e8' };
      drawHeader(g, S, pad, w - pad, top, ts, 'bpm');
      const legend = S.allParts.length ? S.allParts : ['bass', 'chords', 'lead'].map((r) => ({ name: r, role: r, enabled: false, notes: [] }));
      let lx = pad;
      const ly = top + unit * 0.03, sq = unit * 0.009;
      for (const p of legend) {
        if (lx > w - pad - unit * 0.12) break;
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        g.fillStyle = on ? colOf(p) : U.rgba(colOf(p), 0.3);
        g.fillRect(lx, ly - sq * 1.1, sq, sq);
        lx += sq * 1.6 + U.text(g, p.name, lx + sq * 1.6, ly, { size: unit * 0.0145, font: U.FONT.PLEX, color: on ? '#bbb' : 'rgba(200,200,200,0.3)' }) + unit * 0.016;
      }

      // panel + faint grid
      const { x0, x1, y0, y1 } = box;
      U.rrect(g, x0, y0, x1 - x0, y1 - y0, unit * 0.006);
      g.fillStyle = opt.panel; g.fill();
      g.save();
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.018)';
      for (let p = lo; p <= cache.hi; p++) if ([1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)) g.fillRect(x0, y1 - (p - lo + 1) * rowH, x1 - x0, rowH);
      const win = S.bar * (+opt.bars || 2), ph = opt.playhead;
      const phx = x0 + (x1 - x0) * ph;
      const tx = (t) => phx + ((t - S.t) / win) * (x1 - x0);
      const tA = S.t - win * ph, tB = S.t + win * (1 - ph);
      const origin = (S.A && S.A.beatOffset) || 0;
      const sub = S.spb / 4;
      for (let k = Math.ceil((tA - origin) / sub); k * sub + origin <= tB; k++) {
        const x = tx(origin + k * sub);
        g.fillStyle = k % 16 === 0 ? 'rgba(255,255,255,0.06)' : k % 4 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.014)';
        g.fillRect(x, y0, 1, y1 - y0);
      }

      // notes
      const nh = Math.max(4, Math.min(rowH * 0.78, unit * 0.016));
      const glowList = [];
      for (const p of parts) {
        const c = colOf(p), dim = U.mix(c, opt.panel, 0.38);
        for (const n of Parts.inRange(p, tA, tB)) {
          const xa = tx(n.s), xb = tx(n.e) - unit * 0.004;
          const y = y1 - (n.p - lo + 0.5) * rowH;
          const past = n.s <= S.t, playing = past && n.e > S.t;
          // recent past and playing notes are bright; the future is dimmer; the old past fades a bit
          const ago = (S.t - n.e) / win;
          g.fillStyle = playing ? U.mix(c, '#ffffff', 0.25) : past ? (ago > 0.15 ? U.mix(c, opt.panel, Math.min(0.3, ago)) : c) : dim;
          U.rrect(g, xa, y - nh / 2, Math.max(nh, xb - xa), nh, nh / 2);
          g.fill();
          if (playing && opt.glow) glowList.push({ xa, xb, y, role: ROLE[p.role] ? p.role : 'other' });
        }
      }
      // glow on sounding notes (additive sprites)
      g.globalCompositeOperation = 'lighter';
      for (const q of glowList) {
        g.globalAlpha = 0.55;
        g.drawImage(cache.glows[q.role], q.xa - nh * 1.5, q.y - nh * 1.6, Math.max(nh, q.xb - q.xa) + nh * 3, nh * 3.2);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.restore();

      // playhead: white line with a small marker on top
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(phx - unit * 0.004, y0, unit * 0.008, y1 - y0);
      g.fillStyle = opt.accent;
      g.fillRect(phx - unit * 0.0012, y0, unit * 0.0024, y1 - y0);
      g.beginPath(); g.arc(phx, y0, unit * 0.0045, 0, U.TAU); g.fill();

      if (!parts.length) {
        U.text(g, 'no notes · add midi', (x0 + x1) / 2, (y0 + y1) / 2, { size: unit * 0.02, font: U.FONT.PLEX, color: 'rgba(220,220,220,0.4)', align: 'center' });
      }
    },
  });
})();
