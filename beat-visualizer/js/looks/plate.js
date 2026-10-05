// plate — a DAW piano-roll editor: key column with octave labels, shaded rows, a bar ruler,
// outlined notes with velocity tails, and a blue playhead the view scrolls around.
(function () {
  const BLACK = [1, 3, 6, 8, 10];
  const ROLE = { bass: '#6a4fd8', chords: '#1f9e8a', lead: '#e0663a', other: '#4a8fd0', drums: '#c9a23a' };

  function range(parts) {
    let lo = 127, hi = 0;
    for (const p of parts) for (const n of p.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
    if (lo > hi) { lo = 36; hi = 84; }
    lo = Math.floor((lo - 2) / 12) * 12;         // start on a C
    hi = Math.max(hi + 3, lo + 48);              // at least four octaves
    return [lo, hi];
  }

  function layout(S) {
    const { w, h, unit, portrait } = S;
    const x0 = S.pad, x1 = w - S.pad;
    const ky = portrait ? h * 0.1 : h * 0.19;          // ruler top
    const rul = unit * 0.026;
    const y0 = ky + rul, y1 = portrait ? h * 0.8 : h - S.pad;
    const kw = Math.max(unit * 0.05, (x1 - x0) * 0.055);
    return { x0, x1, ky, rul, y0, y1, kw, rx0: x0 + kw };
  }

  Looks.register({
    id: 'plate',
    name: 'plate',
    group: 'midi',
    theme: 'light',
    desc: 'a daw piano-roll editor scrolling under a blue playhead',
    defaults: { accent: '#3d6fd6', bg: '#eef1f3', bars: 4, playhead: 0.3, velocity: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars on screen', type: 'select', options: [2, 4, 8] },
      { key: 'playhead', label: 'Playhead position', type: 'range', min: 0.1, max: 0.6, step: 0.05 },
      { key: 'velocity', label: 'Velocity tails', type: 'toggle' },
    ],
    prepare(S) {
      const L = layout(S), u = S.unit, opt = S.opt;
      const [lo, hi] = range(S.parts);
      const rows = hi - lo + 1, rowH = (L.y1 - L.y0) / rows;
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        // ruler strip
        g.fillStyle = '#e3e6e8'; g.fillRect(L.x0, L.ky, L.x1 - L.x0, L.rul);
        // rows: black-key rows darker, a hairline between rows
        for (let p = lo; p <= hi; p++) {
          const y = L.y1 - (p - lo + 1) * rowH;
          g.fillStyle = BLACK.includes(((p % 12) + 12) % 12) ? '#e1e5e8' : '#f3f5f6';
          g.fillRect(L.rx0, y, L.x1 - L.rx0, rowH);
          g.fillStyle = (p % 12 === 0) ? 'rgba(80,90,100,0.18)' : 'rgba(80,90,100,0.06)';
          g.fillRect(L.rx0, Math.round(y + rowH) - 1, L.x1 - L.rx0, 1);
        }
        // key column
        g.fillStyle = '#e4e7e9'; g.fillRect(L.x0, L.y0, L.kw, L.y1 - L.y0);
        for (let p = lo; p <= hi; p++) {
          const y = L.y1 - (p - lo + 1) * rowH;
          if (BLACK.includes(((p % 12) + 12) % 12)) { g.fillStyle = '#cfd4d8'; g.fillRect(L.x0 + L.kw * 0.45, y, L.kw * 0.55, rowH); }
          if (p % 12 === 0) {
            const bw = L.kw * 0.62, bh = Math.min(rowH * 1.4, u * 0.02);
            U.rrect(g, L.x0 + 2, y + rowH / 2 - bh / 2, bw, bh, 2); g.fillStyle = '#d3d8dc'; g.fill();
            U.text(g, U.noteName(p), L.x0 + 2 + bw / 2, y + rowH / 2 + u * 0.0055, { size: u * 0.0145, font: U.FONT.MONO, weight: 600, color: '#5c6670', align: 'center' });
          }
        }
        g.fillStyle = 'rgba(80,90,100,0.18)'; g.fillRect(L.rx0 - 1, L.y0, 1, L.y1 - L.y0);
      });
      return { L, lo, hi, rowH, bg };
    },
    draw(g, S) {
      const { opt, parts, unit: u, A } = S;
      const { L, lo, rowH } = S.cache;
      g.drawImage(S.cache.bg, 0, 0, S.w, S.h);
      const mono = U.FONT.MONO;

      // header + legend
      const top = S.pad + u * (S.portrait ? 0.035 : 0.03);
      U.text(g, `${S.meta.title || 'untitled'} · ${Math.round(S.bpm)} bpm${S.meta.key ? ' · ' + S.meta.key : ''}`, L.x0, top, { size: u * 0.03, font: mono, color: '#26292c' });
      U.text(g, S.timeLabel(), L.x1, top, { size: u * 0.03, font: mono, color: '#26292c', align: 'right' });
      let lx = L.x0;
      const ly = top + u * 0.034;
      for (const p of S.allParts) {
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        const col = ROLE[p.role] || ROLE.other;
        g.lineWidth = 2; g.strokeStyle = on ? col : '#c3c8cc';
        g.beginPath(); g.arc(lx + u * 0.006, ly - u * 0.0055, u * 0.0055, 0, U.TAU); g.stroke();
        lx += u * 0.018 + U.text(g, p.name, lx + u * 0.017, ly, { size: u * 0.016, font: mono, color: on ? '#3b4046' : '#b9bec2' }) + u * 0.02;
      }

      // time mapping
      const W = L.x1 - L.rx0, win = S.bar * opt.bars, phx = L.rx0 + W * opt.playhead;
      const tx = (tt) => phx + ((tt - S.t) / win) * W;
      const t0 = S.t - win * opt.playhead, t1 = S.t + win * (1 - opt.playhead);

      g.save(); g.beginPath(); g.rect(L.rx0, L.ky, W, L.y1 - L.ky); g.clip();
      // beat + bar lines and ruler numbers
      const b0 = Math.floor((t0 - A.beatOffset) / S.spb), b1 = Math.ceil((t1 - A.beatOffset) / S.spb);
      for (let b = b0; b <= b1; b++) {
        const x = Math.round(tx(A.beatOffset + b * S.spb));
        const isBar = ((b % 4) + 4) % 4 === 0;
        g.fillStyle = isBar ? 'rgba(70,80,90,0.2)' : 'rgba(70,80,90,0.07)';
        g.fillRect(x, isBar ? L.ky : L.y0, 1, L.y1 - (isBar ? L.ky : L.y0));
        if (isBar) U.text(g, String(b / 4 + 1), x + u * 0.007, L.ky + L.rul * 0.72, { size: u * 0.015, font: mono, color: '#5c6670' });
      }
      // notes
      const nh = Math.max(5, rowH * 0.78), r = Math.min(u * 0.004, nh / 3);
      for (const p of parts) {
        const col = ROLE[p.role] || ROLE.other;
        for (const n of Parts.inRange(p, t0, t1)) {
          const xa = tx(n.s) + 1, xb = tx(n.e) - 1, y = L.y1 - (n.p - lo + 1) * rowH + (rowH - nh) / 2;
          if (y < L.y0 - nh || y > L.y1) continue;
          const playing = n.s <= S.t && n.e > S.t, done = n.s <= S.t;
          U.rrect(g, xa, y, Math.max(4, xb - xa), nh, r);
          g.fillStyle = U.rgba(col, playing ? 0.22 : done ? 0.1 : 0.06); g.fill();
          g.lineWidth = playing ? 3 : 2.2;
          g.strokeStyle = U.rgba(col, done ? 1 : 0.45); g.stroke();
          if (opt.velocity && p.role === 'chords') {
            // velocity tail: a bracket under the note, its length scaled by velocity
            const ty = y + nh + rowH * 0.45, len = Math.max(4, (xb - xa) * (n.v ?? 0.8));
            g.fillStyle = U.rgba('#5a6e80', done ? 0.75 : 0.35);
            g.fillRect(xa, ty, len, 1.5); g.fillRect(xa, ty - 3, 1.5, 6.5); g.fillRect(xa + len - 1.5, ty - 3, 1.5, 6.5);
          }
        }
      }
      g.restore();

      if (!parts.length) {
        U.rrect(g, L.rx0 + W * 0.2, (L.y0 + L.y1) / 2 - u * 0.04, W * 0.6, u * 0.08, u * 0.01);
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill(); g.strokeStyle = 'rgba(70,80,90,0.25)'; g.lineWidth = 1.5; g.stroke();
        U.text(g, 'empty clip · drop a midi file', L.rx0 + W / 2, (L.y0 + L.y1) / 2 + u * 0.007, { size: u * 0.018, font: mono, color: '#6a737c', align: 'center' });
      }

      // playhead: soft band, line, and a triangle on the ruler
      g.fillStyle = U.rgba(opt.accent, 0.16); g.fillRect(phx - u * 0.006, L.ky, u * 0.012, L.y1 - L.ky);
      g.fillStyle = opt.accent; g.fillRect(phx - 1.5, L.ky, 3, L.y1 - L.ky);
      const tr = u * 0.011;
      g.beginPath(); g.moveTo(phx - tr, L.ky); g.lineTo(phx + tr, L.ky); g.lineTo(phx, L.ky + tr * 1.2); g.closePath(); g.fill();
    },
  });
})();
