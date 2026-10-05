// strip — a horizontal piano roll of every part, outlined notes passing a fixed playhead
// on a pale paper background with soft colour blooms.
(function () {
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
    id: 'strip',
    name: 'strip',
    group: 'midi',
    theme: 'light',
    desc: 'outlined notes sliding past the playhead',
    defaults: { accent: '#1d1d22', bg: '#f8f7f3', bars: 2, playhead: 0.3, blooms: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [1, 2, 4, 8] },
      { key: 'playhead', label: 'Playhead position', type: 'range', min: 0.1, max: 0.6, step: 0.05 },
      { key: 'blooms', label: 'Colour blooms', type: 'toggle' },
    ],
    prepare(S) {
      const { opt } = S;
      // static paper + blooms, painted once at quarter resolution (it is all soft gradients)
      return {
        bg: U.layer(S.w, S.h, (g, w, h) => {
          g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
          if (!opt.blooms) return;
          U.glowBlob(g, w * 0.15, h * 0.12, w * 0.45, '#efd9a8', 0.55);
          U.glowBlob(g, w * 0.85, h * 0.22, w * 0.5, '#ffc9a0', 0.5);
          U.glowBlob(g, w * 0.1, h * 0.85, w * 0.5, '#f1e2b8', 0.45);
          U.glowBlob(g, w * 0.9, h * 0.8, w * 0.5, '#ffe0c4', 0.45);
        }, 0.25),
      };
    },
    draw(g, S) {
      const { w, h, pad, opt, parts } = S;
      g.drawImage(S.cache.bg, 0, 0, w, h);

      // header + legend
      const top = pad + S.unit * 0.03;
      drawHeader(g, S, pad, w - pad, top, { size: S.unit * 0.026, font: U.FONT.MONO, color: '#222' }, 'bpm');
      let lx = pad;
      const ly = top + S.unit * 0.028;
      for (const p of S.allParts) {
        if (lx > w - pad - S.unit * 0.12) break;
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        g.strokeStyle = on ? p.color : '#bbb'; g.lineWidth = 2;
        g.beginPath(); g.arc(lx + 6, ly - 6, 5, 0, U.TAU); g.stroke();
        lx += 18 + U.text(g, p.name, lx + 16, ly, { size: S.unit * 0.014, font: U.FONT.MONO, color: on ? '#333' : '#bbb' }) + 14;
      }

      // roll area
      const x0 = pad, x1 = w - pad, y0 = S.portrait ? h * 0.11 : h * 0.18, y1 = S.portrait ? Math.min(h * 0.9, h - S.unit * 0.225) : Math.min(h * 0.9, h - pad * 0.9 - S.unit * 0.05);
      let lo = 127, hi = 0;
      for (const p of parts) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
      if (lo > hi) { lo = 36; hi = 84; }
      lo -= 2; hi += 2;
      const rowH = (y1 - y0) / (hi - lo + 1);
      const win = S.bar * opt.bars, phx = x0 + (x1 - x0) * opt.playhead;
      const tx = (tt) => phx + ((tt - S.t) / win) * (x1 - x0);
      const tStart = S.t - win * opt.playhead, tEnd = S.t + win * (1 - opt.playhead);

      g.save();
      g.beginPath(); g.rect(x0, y0 - rowH, x1 - x0, y1 - y0 + rowH * 2); g.clip();
      for (const p of parts) {
        for (const n of Parts.inRange(p, tStart, tEnd)) {
          const xa = Math.max(x0 - 20, tx(n.s)), xb = Math.min(x1 + 20, tx(n.e)) - 2;
          const y = y1 - (n.p - lo + 1) * rowH, hh = Math.max(6, rowH * 0.62);
          const playing = n.s <= S.t && n.e > S.t, past = n.e <= S.t;
          U.rrect(g, xa, y + (rowH - hh) / 2, Math.max(4, xb - xa), hh, hh / 2);
          g.fillStyle = playing ? U.rgba(p.color, 0.35) : U.rgba(p.color, past ? 0.08 : 0.12);
          g.fill();
          g.lineWidth = playing ? 3 : 2;
          g.strokeStyle = U.rgba(p.color, playing ? 1 : past ? 0.45 : 0.85);
          g.stroke();
        }
      }
      g.restore();

      // playhead
      g.fillStyle = opt.accent;
      g.fillRect(phx - 1.5, y0 - 4, 3, y1 - y0 + 8);
      g.beginPath(); g.moveTo(phx - 8, y0 - 12); g.lineTo(phx + 8, y0 - 12); g.lineTo(phx, y0); g.closePath(); g.fill();
    },
  });
})();
