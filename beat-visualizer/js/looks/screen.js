// screen — a risograph print of the piano roll: navy ink blocks with a misregistered pink
// pass, on pinkish paper with a fine dot screen. Time scrolls right to left.
(function () {
  Looks.register({
    id: 'screen',
    name: 'screen',
    group: 'midi',
    theme: 'light',
    desc: 'misregistered riso print of the piano roll',
    defaults: { accent: '#ef7fa6', bg: '#ecdcc8', ink: '#0b2b78', bars: 8, offset: 9, rows: 'used' },
    controls: [
      { key: 'bg', label: 'Paper', type: 'color' },
      { key: 'ink', label: 'Ink', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [2, 4, 8] },
      { key: 'offset', label: 'Misregistration', type: 'range', min: 0, max: 12, step: 1 },
      { key: 'rows', label: 'Rows', type: 'select', options: [{ value: 'used', label: 'pitches used' }, { value: 'all', label: 'every semitone' }] },
    ],
    prepare(S) {
      const { w, h, opt, unit } = S;
      // rows: the distinct pitches that occur (compact, like the print), or every semitone
      const set = new Set();
      for (const p of S.parts) for (const n of p.notes) set.add(n.p);
      let pitches = [...set].sort((a, b) => a - b);
      if (opt.rows === 'all' && pitches.length) {
        const lo = pitches[0], hi = pitches[pitches.length - 1];
        pitches = []; for (let p = lo; p <= hi; p++) pitches.push(p);
      }
      const row = new Map(pitches.map((p, i) => [p, i]));
      // paper tone (soft, quarter res) + a fine dot screen tile used as a pattern each frame
      const paper = U.layer(w, h, (g) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        const r = U.rng(S.seed + 3);
        for (let i = 0; i < 6; i++) U.glowBlob(g, r() * w, r() * h, unit * (0.3 + r() * 0.4), r() > 0.5 ? '#ffffff' : '#c9a98a', 0.14);
      }, 0.25);
      const step = Math.max(3, Math.round(unit * 0.0042));
      const dots = U.layer(step * 8, step * 8, (dg) => {
        dg.fillStyle = U.rgba(U.mix(opt.bg, '#7a5a40', 0.4), 0.5);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          dg.beginPath(); dg.arc(x * step + step / 2 + (y % 2 ? step / 2 : 0), y * step + step / 2, step * 0.24, 0, U.TAU); dg.fill();
          if (y % 2 && x === 7) { dg.beginPath(); dg.arc(step / 2 - step / 2, y * step + step / 2, step * 0.24, 0, U.TAU); dg.fill(); }
        }
      });
      return { row, nRows: pitches.length, paper, dots };
    },
    draw(g, S) {
      const { w, h, unit, opt, cache } = S;
      g.drawImage(cache.paper, 0, 0, w, h);
      g.fillStyle = g.createPattern(cache.dots, 'repeat');
      g.fillRect(0, 0, w, h);
      const off = (opt.offset / 1080) * unit * 1.0;
      const pink = opt.accent, ink = opt.ink;

      // header: black text with a pink misregistered copy
      const ty = S.portrait ? h * 0.047 : S.pad + unit * 0.025;
      const hs = { size: unit * 0.03, font: U.FONT.PLEX, color: U.rgba(pink, 0.85) };
      const title = `${S.meta.title} · ${Math.round(S.bpm)} BPM${S.meta.key ? ' · ' + S.meta.key : ''}`;
      U.text(g, title, S.pad + off, ty - off * 1.2, hs);
      U.text(g, S.timeLabel(), w - S.pad + off, ty - off * 1.2, { ...hs, align: 'right' });
      U.text(g, title, S.pad, ty, { ...hs, color: '#141414' });
      U.text(g, S.timeLabel(), w - S.pad, ty, { ...hs, color: '#141414', align: 'right' });

      // roll geometry
      const x0 = S.pad * 0.4, x1 = w - S.pad * 0.4;
      const y0 = S.portrait ? h * 0.075 : h * 0.13, y1 = S.portrait ? h * 0.8 : h * 0.9;
      const win = S.bar * (+opt.bars || 4), ph = 0.3;
      const phx = x0 + (x1 - x0) * ph;
      const tx = (t) => phx + ((t - S.t) / win) * (x1 - x0);
      const tA = S.t - win * ph, tB = S.t + win * (1 - ph);
      const n = Math.max(1, cache.nRows);
      const rowH = (y1 - y0) / Math.max(n, 6);
      const yTop = y0 + ((y1 - y0) - n * rowH) / 2;
      const bh = Math.min(rowH * 0.62, unit * 0.04);
      const rowY = (p) => yTop + (n - 1 - cache.row.get(p)) * rowH + rowH / 2;

      // collect visible blocks once
      const blocks = [];
      for (const part of S.parts) {
        for (const nt of Parts.inRange(part, tA, tB)) {
          if (!cache.row.has(nt.p)) continue;
          const xa = Math.max(x0, tx(nt.s)), xb = Math.min(x1, tx(nt.e) - unit * 0.004);
          if (xb - xa < 1) continue;
          const y = rowY(nt.p);
          const past = nt.s <= S.t;
          blocks.push({ x: xa, y: y - bh / 2, w: Math.max(unit * 0.006, xb - xa), past, playing: past && nt.e > S.t });
        }
      }
      // pink pass (offset up-right), then navy multiplied over it
      g.fillStyle = U.rgba(pink, 0.85);
      for (const b of blocks) g.fillRect(b.x + off, b.y - off, b.w, bh);
      const cPast = ink, cPlay = U.mix(ink, '#000000', 0.3), cFut = U.mix(ink, opt.bg, 0.32);
      for (const b of blocks) {
        g.fillStyle = b.playing ? cPlay : b.past ? cPast : cFut;
        g.fillRect(b.x, b.y, b.w, bh);
      }
      // a little ink speckle so the blocks read as printed
      g.fillStyle = U.rgba(opt.bg, 0.35);
      for (const b of blocks) {
        const k = Math.floor(b.x * 7 + b.y * 3);
        for (let i = 0; i < 3; i++) {
          const sx = b.x + U.hash(k, i) * b.w, sy = b.y + U.hash(k, i, 1) * bh;
          g.fillRect(sx, sy, unit * 0.003, unit * 0.003);
        }
      }

      // playhead: black line with a pink double
      const lw = Math.max(2, unit * 0.0028);
      const py0 = S.portrait ? h * 0.075 : h * 0.12, py1 = S.portrait ? h * 0.8 : h * 0.92;
      g.fillStyle = U.rgba(pink, 0.85); g.fillRect(phx + off * 0.9, py0 - off, lw * 1.4, py1 - py0);
      g.save(); g.globalCompositeOperation = 'multiply';
      g.fillStyle = '#1b1b1f'; g.fillRect(phx - lw / 2, py0, lw, py1 - py0);
      g.restore();

      if (!blocks.length && !S.parts.length) {
        const fs = { size: unit * 0.024, font: U.FONT.PLEX, align: 'center' };
        U.text(g, 'no notes · add midi', w / 2 + off, (y0 + y1) / 2 - off, { ...fs, color: U.rgba(pink, 0.85) });
        U.text(g, 'no notes · add midi', w / 2, (y0 + y1) / 2, { ...fs, color: U.rgba(ink, 0.8) });
      }
    },
  });
})();
