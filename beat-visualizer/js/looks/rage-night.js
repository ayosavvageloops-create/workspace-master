// rage-night — two floating desktop windows on a dark, softly bloomed backdrop: a
// "listen" player with a purple waveform overview, and a "MIDI" window with a mini roll.
(function () {
  const ROLE = { bass: '#9a86ff', chords: '#f07ad0', lead: '#5f86ff', drums: '#e6c46a', other: '#7fc4c0' };
  const colOf = (p) => ROLE[p.role] || ROLE.other;

  function keyWord(key) {
    const m = /^([A-Ga-g][#b]?)(m?)/.exec(key || '');
    if (!m) return '';
    return m[1].toLowerCase() + (m[2] ? 'min' : 'maj');
  }

  function layout(S) {
    // Windows are laid out in a virtual space and drawn with a uniform scale k, so they
    // always fit above the handle watermark strip (stacked in tall/square formats).
    const { w, h, unit, pad } = S;
    const th = unit * 0.052;                                     // title bar
    const hL = th + unit * 0.39, hM = th + unit * 0.42;          // window heights
    const stack = S.portrait || w / h < 1.3;
    const handleTop = S.portrait ? h - unit * 0.16 - unit * 0.035 : h - pad * 0.9 - unit * 0.035;
    const topMin = unit * 0.06, bottomMax = handleTop - unit * 0.02;
    let L, M, k;
    if (stack) {
      const gap = unit * 0.04, total = hL + gap + hM;
      k = Math.min(1, (bottomMax - topMin) / total);
      const top = Math.max(topMin, Math.min(h * 0.5 - total * k / 2 + unit * 0.02, bottomMax - total * k)) / k;
      const x = pad / k, ww = w / k - pad * 2 / k;
      L = { x, y: top, w: ww, h: hL };
      M = { x, y: top + hL + gap, w: ww, h: hM };
    } else {
      k = Math.min(1, (bottomMax - topMin) / hM);
      const gap = pad / k, x = pad / k, ww = (w / k - x * 2 - gap) / 2;
      const top = Math.max(topMin, Math.min(h * 0.5 - hM * k / 2, bottomMax - hM * k)) / k;
      L = { x, y: top, w: ww, h: hL };
      M = { x: x + ww + gap, y: top, w: ww, h: hM };
    }
    const inset = unit * 0.035;
    L.box = { x: L.x + inset, y: L.y + th + unit * 0.12, w: L.w - inset * 2, h: unit * 0.19 };
    M.box = { x: M.x + inset, y: M.y + th + unit * 0.1, w: M.w - inset * 2, h: unit * 0.285 };
    return { th, inset, L, M, k };
  }

  function windowChrome(g, S, win, title, th) {
    const r = S.unit * 0.018;
    U.rrect(g, win.x, win.y, win.w, win.h, r);
    g.fillStyle = '#1c1b22'; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#25242c'; g.fillRect(win.x, win.y, win.w, th);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(win.x, win.y + th - 1, win.w, 1);
    g.restore();
    U.rrect(g, win.x + 0.5, win.y + 0.5, win.w - 1, win.h - 1, r);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; g.stroke();
    const dr = th * 0.15, cy = win.y + th / 2;
    ['#e0544c', '#d9a332', '#3fb950'].forEach((c, i) => {
      g.fillStyle = c; g.beginPath(); g.arc(win.x + th * 0.5 + i * dr * 3.2, cy, dr, 0, U.TAU); g.fill();
    });
    U.text(g, title, win.x + th * 0.5 + dr * 9.6 + th * 0.25, cy + th * 0.14, { size: th * 0.36, font: U.FONT.MONO, color: '#9a98a6' });
  }

  Looks.register({
    id: 'rage-night',
    name: 'rage-night',
    group: 'midi',
    theme: 'dark',
    desc: 'a listen window with a waveform and a MIDI window with a mini roll',
    defaults: { accent: '#b38cff', bg: '#111114', bars: 4, blooms: true, chordBands: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Roll bars', type: 'select', options: [2, 4, 8] },
      { key: 'blooms', label: 'Colour blooms', type: 'toggle' },
      { key: 'chordBands', label: 'Chord bands', type: 'toggle' },
    ],
    prepare(S) {
      const { opt, A } = S;
      const Lo = layout(S);
      // backdrop: blooms + soft window shadows (quarter res, all soft)
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        if (opt.blooms) {
          const R = Math.max(w, h);
          U.glowBlob(g, w * 0.22, h * 0.16, R * 0.3, '#4a2f78', 0.55);
          U.glowBlob(g, w * 0.9, h * 0.22, R * 0.3, '#1d5c4a', 0.55);
          U.glowBlob(g, w * 0.12, h * 0.84, R * 0.28, '#17473a', 0.45);
          U.glowBlob(g, w * 0.9, h * 0.86, R * 0.28, '#3b2a5e', 0.45);
        }
        for (const win of [Lo.L, Lo.M]) {
          g.save();
          g.scale(Lo.k, Lo.k);
          g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = S.unit * 0.05; g.shadowOffsetY = S.unit * 0.015;
          U.rrect(g, win.x, win.y, win.w, win.h, S.unit * 0.018); g.fillStyle = '#1c1b22'; g.fill();
          g.restore();
        }
      }, 0.25);
      // waveform overview of the clip
      const nVis = Math.max(60, Math.round(Lo.L.box.w / (S.unit * 0.0052)));
      const nAll = Math.max(nVis, Math.ceil(nVis * A.dur / Math.max(0.1, S.clipLen)));
      const pk = A.peaks(nAll);
      const i0 = Math.floor((S.clipStart / A.dur) * nAll);
      const amp = new Float32Array(nVis);
      let mx = 1e-6;
      for (let i = 0; i < nVis; i++) {
        const j = Math.min(nAll - 1, i0 + i);
        amp[i] = Math.max(Math.abs(pk.min[j]), Math.abs(pk.max[j]));
        mx = Math.max(mx, amp[i]);
      }
      for (let i = 0; i < nVis; i++) amp[i] /= mx;
      let lo = 127, hi = 0;
      for (const p of S.parts) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
      if (lo > hi) { lo = 36; hi = 84; }
      return { Lo, bg, amp, lo: lo - 2, hi: hi + 2 };
    },
    draw(g, S) {
      const { w, h, unit, opt, parts, cache } = S;
      const { Lo, amp } = cache, { th, L, M } = Lo;
      g.drawImage(cache.bg, 0, 0, w, h);
      g.save();
      g.scale(Lo.k, Lo.k);

      // ---------------- listen window ----------------
      windowChrome(g, S, L, 'listen', th);
      U.text(g, String(S.meta.title || 'untitled'), L.box.x, L.y + th + unit * 0.09, { size: unit * 0.062, font: U.FONT.MONO, weight: 700, color: opt.accent, max: L.box.w });
      const b = L.box;
      U.rrect(g, b.x, b.y, b.w, b.h, unit * 0.012); g.fillStyle = '#131218'; g.fill();
      const wx0 = b.x + unit * 0.022, wx1 = b.x + b.w - unit * 0.022;
      const wy = b.y + b.h * 0.4, wa = b.h * 0.28;
      const n = amp.length, bw = (wx1 - wx0) / n;
      const playedTo = S.prog * n;
      const cPlay = opt.accent, cRest = U.mix(opt.accent, '#131218', 0.62);
      for (let i = 0; i < n; i++) {
        const a = Math.max(0.03, amp[i]) * wa;
        g.fillStyle = i < playedTo ? cPlay : cRest;
        g.fillRect(wx0 + i * bw, wy - a, Math.max(1, bw * 0.72), a * 2);
      }
      const px = wx0 + (wx1 - wx0) * S.prog;
      g.fillStyle = '#f2f0ff'; g.fillRect(px - unit * 0.0012, wy - wa * 1.35, unit * 0.0024, wa * 2.7);
      const small = { size: unit * 0.019, font: U.FONT.MONO, color: '#a9a6b8' };
      const sr = S.A && S.A.sr ? `${Math.round(S.A.sr / 1000)} khz` : '';
      const tw = U.text(g, U.fmtTime(Math.max(0, S.ct)), wx1, b.y + b.h - unit * 0.025, { ...small, align: 'right' });
      // caption: the title part shrinks/truncates, "bpm key · khz" stays whole
      const capRest = ' ' + [`${Math.round(S.bpm)} ${keyWord(S.meta.key)}`.trim(), sr].filter(Boolean).join(' · ');
      const capAvail = wx1 - wx0 - tw - unit * 0.03, capRestW = U.textWidth(g, capRest, small);
      const ctw = U.text(g, String(S.meta.title || ''), wx0, b.y + b.h - unit * 0.025, { ...small, max: Math.max(unit * 0.06, capAvail - capRestW) });
      U.text(g, capRest, wx0 + ctw, b.y + b.h - unit * 0.025, { ...small, max: Math.max(1, capAvail - ctw) });
      U.text(g, `${Math.round(S.bpm)} bpm${S.meta.key ? ' · ' + S.meta.key : ''}`, b.x, b.y + b.h + unit * 0.045, { ...small, color: '#8d8a9c', max: b.w });

      // ---------------- MIDI window ----------------
      windowChrome(g, S, M, 'MIDI', th);
      const hy = M.y + th + unit * 0.06;

      const origin = (S.A && S.A.beatOffset) || 0;
      let lastEnd = 0;
      for (const p of parts) if (p.notes.length) lastEnd = Math.max(lastEnd, p.notes[p.notes.length - 1].e);
      const nBars = Math.max(1, S.hasMidi && lastEnd ? Math.ceil((lastEnd - origin) / S.bar - 0.05) : Math.floor((S.A.dur - origin) / S.bar + 0.25));
      const rw = U.text(g, [`${nBars} bars`, S.meta.key, Math.round(S.bpm)].filter(Boolean).join(' · '), M.box.x + M.box.w, hy, { size: unit * 0.036, font: U.FONT.MONO, color: '#8d8a9c', align: 'right', max: M.box.w * 0.62 });
      U.text(g, `${parts.length} layer${parts.length === 1 ? '' : 's'}`, M.box.x, hy, { size: unit * 0.04, font: U.FONT.MONO, weight: 700, color: opt.accent, max: M.box.w - rw - unit * 0.03 });

      const mb = M.box;
      U.rrect(g, mb.x, mb.y, mb.w, mb.h, unit * 0.012); g.fillStyle = '#131218'; g.fill();
      // legend
      const legend = S.allParts.length ? S.allParts : ['bass', 'chords', 'lead'].map((r) => ({ name: r, role: r, enabled: false, notes: [] }));
      let lx = mb.x + unit * 0.022;
      const ly = mb.y + unit * 0.038, sq = unit * 0.009;
      for (const p of legend) {
        if (lx > mb.x + mb.w - unit * 0.12) break;
        const on = p.enabled && p.notes.some((nn) => nn.s <= S.t);
        g.fillStyle = on ? colOf(p) : U.rgba(colOf(p), 0.3);
        g.fillRect(lx, ly - sq * 1.05, sq, sq);
        lx += sq * 1.7 + U.text(g, p.name, lx + sq * 1.7, ly, { size: unit * 0.016, font: U.FONT.MONO, color: on ? '#a9a6b8' : 'rgba(170,166,184,0.3)' }) + unit * 0.018;
      }
      // mini roll
      const rx0 = mb.x + unit * 0.014, rx1 = mb.x + mb.w - unit * 0.014;
      const ry0 = mb.y + unit * 0.06, ry1 = mb.y + mb.h - unit * 0.014;
      const span = cache.hi - cache.lo + 1, rowH = (ry1 - ry0) / span;
      g.fillStyle = 'rgba(255,255,255,0.025)';
      for (let k = 0; k <= span; k += 2) g.fillRect(rx0, ry0 + k * rowH, rx1 - rx0, 1);
      const winT = S.bar * (+opt.bars || 4), ph = 0.25;
      const phx = rx0 + (rx1 - rx0) * ph;
      const tx = (t) => phx + ((t - S.t) / winT) * (rx1 - rx0);
      const tA = S.t - winT * ph, tB = S.t + winT * (1 - ph);
      g.save();
      g.beginPath(); g.rect(rx0, ry0, rx1 - rx0, ry1 - ry0); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let k = Math.ceil((tA - origin) / S.bar); origin + k * S.bar < tB; k++) g.fillRect(tx(origin + k * S.bar), ry0, 1, ry1 - ry0);
      const lh = Math.max(2, Math.min(rowH * 0.55, unit * 0.005));
      for (const p of parts) {
        const c = colOf(p);
        const notes = Parts.inRange(p, tA, tB);
        // translucent band around each chord stack
        if (p.role === 'chords' && opt.chordBands) {
          for (let i = 0; i < notes.length;) {
            let j = i, plo = notes[i].p, phi = notes[i].p;
            while (j + 1 < notes.length && Math.abs(notes[j + 1].s - notes[i].s) < 0.03) { j++; plo = Math.min(plo, notes[j].p); phi = Math.max(phi, notes[j].p); }
            if (j > i) {
              const xa = tx(notes[i].s), xb = tx(notes[i].e) - unit * 0.003;
              const yt = ry1 - (phi - cache.lo + 1.2) * rowH, yb = ry1 - (plo - cache.lo - 0.2) * rowH;
              const on = notes[i].s <= S.t && notes[i].e > S.t;
              g.fillStyle = U.rgba(c, on ? 0.2 : 0.09);
              g.fillRect(xa, yt, xb - xa, yb - yt);
            }
            i = j + 1;
          }
        }
        for (const nt of notes) {
          const xa = tx(nt.s), xb = tx(nt.e) - unit * 0.003;
          const y = ry1 - (nt.p - cache.lo + 0.5) * rowH;
          const past = nt.s <= S.t, on = past && nt.e > S.t;
          g.fillStyle = on ? U.mix(c, '#ffffff', 0.35) : past ? c : U.mix(c, '#131218', 0.35);
          g.fillRect(xa, y - lh / 2, Math.max(lh, xb - xa), lh);
        }
      }
      g.restore();
      g.fillStyle = '#f2f0ff';
      g.fillRect(phx - unit * 0.0012, ry0 - unit * 0.01, unit * 0.0024, ry1 - ry0 + unit * 0.01);

      if (!parts.length) {
        U.text(g, 'no midi layers yet', (rx0 + rx1) / 2, (ry0 + ry1) / 2, { size: unit * 0.02, font: U.FONT.MONO, color: 'rgba(170,166,184,0.5)', align: 'center' });
      }
      g.restore();
    },
  });
})();
