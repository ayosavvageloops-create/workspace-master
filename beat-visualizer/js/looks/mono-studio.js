// mono-studio — a vertical piano roll on white with pastel colour blooms: thin note bars
// (pitch = x, time = down) rise through a horizontal playhead.
(function () {
  const ROLE = { bass: '#141414', chords: '#2e5ea8', lead: '#e48aa6', drums: '#9a8a5a', other: '#5a8f7a' };
  const colOf = (p) => ROLE[p.role] || ROLE.other;

  // header: time label right; "title · bpm · key" left, where only the title shrinks/truncates
  function drawHeader(g, S, x0, x1, y, o, bpmWord) {
    const rw = U.text(g, S.timeLabel(), x1, y, { ...o, align: 'right', max: (x1 - x0) * 0.4 });
    const avail = x1 - x0 - rw - S.unit * 0.04;
    const rest = ` · ${Math.round(S.bpm)} ${bpmWord}${S.meta.key ? ' · ' + S.meta.key : ''}`;
    const restW = U.textWidth(g, rest, o);
    const tw = U.text(g, String(S.meta.title || 'untitled'), x0, y, { ...o, max: Math.max(S.unit * 0.08, avail - restW) });
    U.text(g, rest, x0 + tw, y, { ...o, max: Math.max(1, avail - tw) });
  }

  Looks.register({
    id: 'mono-studio',
    name: 'mono-studio',
    group: 'midi',
    theme: 'light',
    desc: 'thin note bars rising through a playhead on pastel-bloomed white',
    defaults: { accent: '#141414', bg: '#fbfbfa', bars: 2, playhead: 0.3, blooms: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [1, 2, 4, 8] },
      { key: 'playhead', label: 'Playhead height', type: 'range', min: 0.15, max: 0.6, step: 0.05 },
      { key: 'blooms', label: 'Colour blooms', type: 'toggle' },
    ],
    prepare(S) {
      const { opt } = S;
      let lo = 127, hi = 0;
      for (const p of S.parts) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
      if (lo > hi) { lo = 36; hi = 84; }
      return {
        lo: lo - 1, hi: hi + 1,
        bg: U.layer(S.w, S.h, (g, w, h) => {
          g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
          if (!opt.blooms) return;
          const R = Math.max(w, h);
          U.glowBlob(g, w * 0.2, h * 0.13, R * 0.24, '#cfc2ff', 0.75);
          U.glowBlob(g, w * 0.88, h * 0.27, R * 0.28, '#ffc8a8', 0.7);
          U.glowBlob(g, w * 0.12, h * 0.86, R * 0.27, '#bdeccb', 0.65);
          U.glowBlob(g, w * 0.86, h * 0.8, R * 0.28, '#c4dcff', 0.7);
        }, 0.25),
      };
    },
    draw(g, S) {
      const { w, h, pad, unit, opt, parts, cache } = S;
      g.drawImage(cache.bg, 0, 0, w, h);

      // header + legend
      const top = S.portrait ? h * 0.047 : pad + unit * 0.03;
      const ts = { size: unit * 0.03, font: U.FONT.PLEX, color: '#1a1a1a' };
      drawHeader(g, S, pad, w - pad, top, ts, 'bpm');
      const legend = S.allParts.length ? S.allParts : ['bass', 'chords', 'lead'].map((r) => ({ name: r, role: r, enabled: false, notes: [] }));
      let lx = pad;
      const ly = top + unit * 0.03, sq = unit * 0.009;
      for (const p of legend) {
        if (lx > w - pad - unit * 0.12) break;
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        g.fillStyle = on ? colOf(p) : U.rgba(colOf(p), 0.3);
        g.fillRect(lx, ly - sq * 1.1, sq, sq);
        lx += sq * 1.6 + U.text(g, p.name, lx + sq * 1.6, ly, { size: unit * 0.0145, font: U.FONT.PLEX, color: on ? '#333' : 'rgba(60,60,60,0.35)' }) + unit * 0.016;
      }

      // roll: pitch -> x, time -> y (future below the playhead, moving up)
      const x0 = pad, x1 = w - pad;
      const y0 = S.portrait ? h * 0.085 : h * 0.14, y1 = S.portrait ? h * 0.8 : h * 0.93;
      const win = S.bar * (+opt.bars || 2);
      const phy = y0 + (y1 - y0) * opt.playhead;
      const ty = (t) => phy + ((t - S.t) / win) * (y1 - y0);
      const tA = S.t - win * opt.playhead, tB = S.t + win * (1 - opt.playhead);
      const span = cache.hi - cache.lo;
      const colW = (x1 - x0) / (span + 1);
      const bw = Math.max(2, Math.min(colW * 0.55, unit * 0.0075));
      const X = (p) => x0 + (p - cache.lo + 0.5) * colW;

      g.save();
      g.beginPath(); g.rect(0, y0, w, y1 - y0); g.clip();
      for (const p of parts) {
        const c = colOf(p);
        const cPast = p.role === 'bass' ? '#0e0e0e' : U.mix(c, '#000000', 0.12);
        const cFut = p.role === 'bass' ? '#4a4a4a' : U.mix(c, '#ffffff', 0.22);
        for (const n of Parts.inRange(p, tA, tB)) {
          const ya = ty(n.s), yb = ty(n.e) - unit * 0.004;
          const x = X(n.p);
          const past = n.s <= S.t;
          g.fillStyle = past ? cPast : cFut;
          g.globalAlpha = past ? 1 : 0.9;
          g.fillRect(x - bw / 2, ya, bw, Math.max(unit * 0.004, yb - ya));
        }
      }
      g.globalAlpha = 1;
      g.restore();

      // playhead with a soft shadow and a small arrow at its left
      const sh = unit * 0.012;
      const gr = g.createLinearGradient(0, phy - sh, 0, phy + sh);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x0, phy - sh, x1 - x0, sh * 2);
      g.fillStyle = opt.accent;
      g.fillRect(x0, phy - unit * 0.0012, x1 - x0, unit * 0.0024);
      const a = unit * 0.008;
      g.beginPath(); g.moveTo(x0 - a * 0.2, phy - a); g.lineTo(x0 + a * 1.1, phy); g.lineTo(x0 - a * 0.2, phy + a); g.closePath(); g.fill();

      if (!parts.length) {
        U.text(g, 'no notes · add midi', w / 2, (phy + y1) / 2, { size: unit * 0.02, font: U.FONT.PLEX, color: 'rgba(30,30,30,0.4)', align: 'center' });
      }
    },
  });
})();
