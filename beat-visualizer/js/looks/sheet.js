// sheet — hand-engraved sheet music on cream paper: one bar per system, bass heads in
// ochre, chord stacks in teal with handwritten chord names, a red playhead sweeping the
// current bar and pages turning every few bars.
(function () {
  const COL = { bass: '#c68a2a', chords: '#24a093', lead: '#b5485a', other: '#4d6fb0', drums: '#888888' };
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];          // F C G D A E B (letter index C=0..B=6)
  const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];           // B E A D G C F
  // staff steps (0 = bottom line) of key-signature accidentals on a bass staff
  const SHARP_STEPS = [6, 3, 7, 4, 1, 5, 2];
  const FLAT_STEPS = [2, 5, 1, 4, 0, 3, -1];
  const MAJOR_SHARPS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 5: -1, 10: -2, 3: -3, 8: -4 };
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // key string ('D', 'F#m', 'Bb') -> number of sharps (negative = flats)
  function keySig(key) {
    const m = /^([A-Ga-g])([#b]?)(m?)/.exec(key || '');
    if (!m) return 0;
    let pc = PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    if (m[3]) pc += 3;                                  // relative major of a minor key
    return MAJOR_SHARPS[((pc % 12) + 12) % 12];
  }
  // spell a pitch in the key: { dn (diatonic number), acc ('#','b','n' or '') }
  function spell(p, sig) {
    const pc = ((p % 12) + 12) % 12, oct = Math.floor(p / 12) - 1;
    const SH = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
    const FL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
    const [letter, alt] = (sig < 0 ? FL : SH)[pc];
    const inSig = sig > 0 ? (SHARP_ORDER.slice(0, sig).includes(letter) ? 1 : 0) : sig < 0 ? (FLAT_ORDER.slice(0, -sig).includes(letter) ? -1 : 0) : 0;
    const acc = alt === inSig ? '' : alt === 1 ? '#' : alt === -1 ? 'b' : 'n';
    return { dn: oct * 7 + letter, acc };
  }
  const BASS_BOTTOM = 18;                               // G2 on the bottom line of a bass staff

  // ---------- glyphs (paths, so no music font is needed) ----------
  function bassClef(g, x, bottom, gap, color) {
    const yF = bottom - 3 * gap;
    g.save();
    g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round';
    g.lineWidth = gap * 0.32;
    g.beginPath();
    g.moveTo(x + gap * 0.3, yF);
    g.bezierCurveTo(x + gap * 0.1, yF - gap * 1.5, x + gap * 2.3, yF - gap * 1.7, x + gap * 2.3, yF + gap * 0.2);
    g.bezierCurveTo(x + gap * 2.3, yF + gap * 1.7, x + gap * 1.2, yF + gap * 2.7, x - gap * 0.1, yF + gap * 3.3);
    g.stroke();
    g.beginPath(); g.arc(x + gap * 0.42, yF + gap * 0.05, gap * 0.42, 0, U.TAU); g.fill();
    g.beginPath(); g.arc(x + gap * 2.95, yF - gap * 0.5, gap * 0.16, 0, U.TAU); g.fill();
    g.beginPath(); g.arc(x + gap * 2.95, yF + gap * 0.5, gap * 0.16, 0, U.TAU); g.fill();
    g.restore();
  }
  function accidental(g, kind, x, y, gap, color) {
    g.save();
    g.strokeStyle = color; g.lineCap = 'butt';
    if (kind === '#') {
      g.lineWidth = gap * 0.1;
      g.beginPath();
      g.moveTo(x - gap * 0.18, y - gap * 1.2); g.lineTo(x - gap * 0.18, y + gap * 1.25);
      g.moveTo(x + gap * 0.18, y - gap * 1.3); g.lineTo(x + gap * 0.18, y + gap * 1.15);
      g.stroke();
      g.lineWidth = gap * 0.24;
      g.beginPath();
      g.moveTo(x - gap * 0.42, y - gap * 0.3); g.lineTo(x + gap * 0.42, y - gap * 0.5);
      g.moveTo(x - gap * 0.42, y + gap * 0.5); g.lineTo(x + gap * 0.42, y + gap * 0.3);
      g.stroke();
    } else if (kind === 'b') {
      g.lineWidth = gap * 0.12;
      g.beginPath();
      g.moveTo(x - gap * 0.25, y - gap * 1.6); g.lineTo(x - gap * 0.25, y + gap * 0.5);
      g.bezierCurveTo(x + gap * 0.5, y + gap * 0.05, x + gap * 0.45, y - gap * 0.7, x - gap * 0.25, y - gap * 0.2);
      g.stroke();
    } else if (kind === 'n') {
      g.lineWidth = gap * 0.1;
      g.beginPath();
      g.moveTo(x - gap * 0.22, y - gap * 1.1); g.lineTo(x - gap * 0.22, y + gap * 0.45);
      g.moveTo(x + gap * 0.22, y - gap * 0.45); g.lineTo(x + gap * 0.22, y + gap * 1.1);
      g.stroke();
      g.lineWidth = gap * 0.22;
      g.beginPath();
      g.moveTo(x - gap * 0.22, y - gap * 0.2); g.lineTo(x + gap * 0.22, y - gap * 0.4);
      g.moveTo(x - gap * 0.22, y + gap * 0.4); g.lineTo(x + gap * 0.22, y + gap * 0.2);
      g.stroke();
    }
    g.restore();
  }
  function head(g, x, y, gap, color) {
    g.beginPath();
    g.ellipse(x, y, gap * 0.62, gap * 0.44, -0.4, 0, U.TAU);
    g.fillStyle = color; g.fill();
  }

  function layout(S) {
    const { w, h, portrait, pad } = S;
    const n = Math.max(2, Math.min(6, +S.opt.systems || 4));
    const yA = portrait ? h * 0.2 : h * 0.17, yB = portrait ? Math.min(h * 0.865, h - S.unit * 0.21) : h * 0.88;
    const sp = (yB - yA) / n;
    const gap = Math.min(sp * 0.105, S.unit * 0.034);
    const x0 = pad, x1 = w - pad;
    const sigN = Math.abs(keySig(S.meta.key));
    const xN0 = x0 + gap * (5.2 + sigN * 0.95), xN1 = x1 - gap * 1.6;
    const systems = [];
    for (let i = 0; i < n; i++) {
      const top = yA + i * sp + sp * 0.32;
      systems.push({ top, bottom: top + 4 * gap });
    }
    return { n, gap, x0, x1, xN0, xN1, systems, sig: keySig(S.meta.key) };
  }

  Looks.register({
    id: 'sheet',
    name: 'sheet',
    group: 'midi',
    theme: 'light',
    desc: 'hand-engraved sheet music with a playhead and turning pages',
    defaults: { accent: '#d6453d', bg: '#fafaf5', systems: 4, show: 'auto', octaveMarks: true, chordNames: true },
    controls: [
      { key: 'bg', label: 'Paper', type: 'color' },
      { key: 'systems', label: 'Bars per page', type: 'select', options: [2, 3, 4, 5, 6] },
      { key: 'show', label: 'Parts', type: 'select', options: [{ value: 'auto', label: 'bass + chords' }, { value: 'all', label: 'all parts' }] },
      { key: 'octaveMarks', label: '8va / 8vb marks', type: 'toggle' },
      { key: 'chordNames', label: 'Chord names', type: 'toggle' },
    ],
    prepare(S) {
      const L = layout(S), { gap } = L;
      const r = U.rng(S.seed + 5);
      // hand-ruled staff lines: precomputed wobbly polylines, stroked each frame
      const lines = [];
      for (const sys of L.systems) {
        for (let l = 0; l < 5; l++) {
          const y = sys.bottom - l * gap, ph = r() * 10, f = 2 + r() * 2, a = gap * (0.07 + r() * 0.07);
          const pts = [];
          for (let x = L.x0; x <= L.x1 + 1; x += 16) pts.push(x, y + Math.sin((x / (L.x1 - L.x0)) * f * Math.PI + ph) * a);
          lines.push(pts);
        }
      }
      return { L, lines };
    },
    draw(g, S) {
      const { w, h, unit, opt, cache } = S;
      const { L } = cache, { gap } = L;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,68,62,0.72)';
      g.lineWidth = Math.max(1, gap * 0.06);
      g.beginPath();
      for (const pts of cache.lines) { g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); }
      g.stroke();
      for (const sys of L.systems) {
        bassClef(g, L.x0 + gap * 0.25, sys.bottom, gap, '#141414');
        const sig = L.sig, steps = sig > 0 ? SHARP_STEPS : FLAT_STEPS;
        for (let k = 0; k < Math.abs(sig); k++) {
          accidental(g, sig > 0 ? '#' : 'b', L.x0 + gap * (4.0 + k * 0.95), sys.bottom - steps[k] * gap / 2, gap, '#24a093');
        }
      }

      const origin = (S.A && S.A.beatOffset) || 0;
      let lastEnd = 0;
      for (const p of S.parts) if (p.notes.length) lastEnd = Math.max(lastEnd, p.notes[p.notes.length - 1].e);
      const nBars = Math.max(1, S.hasMidi && lastEnd ? Math.ceil((lastEnd - origin) / S.bar - 0.05) : Math.floor((S.A.dur - origin) / S.bar + 0.25));
      const barIdx = Math.max(0, Math.floor((S.t - origin) / S.bar));
      const page = Math.floor(barIdx / L.n), pages = Math.max(1, Math.ceil(nBars / L.n));
      const barX = (t, b0) => L.xN0 + ((t - b0) / S.bar) * (L.xN1 - L.xN0);

      // header
      const hy = S.portrait ? h * 0.085 : S.pad + unit * 0.02;
      // title shrinks/truncates first so the bpm, key, bar and page info always stay readable
      const hs = { size: unit * 0.0165, font: U.FONT.MONO, color: 'rgba(60,60,55,0.55)', spacing: unit * 0.004 };
      const rest = ' · ' + [`${Math.round(S.bpm)} BPM`, S.meta.key, `${nBars} BARS`, `PAGE ${page + 1}/${pages}`].filter(Boolean).join(' · ');
      const restW = U.textWidth(g, rest, hs);
      const ft = U.fit(g, String(S.meta.title || 'untitled').toUpperCase(), Math.max(unit * 0.1, L.x1 - L.x0 - restW), hs);
      const tw = U.text(g, ft.str, L.x0, hy, { ...hs, size: ft.size });
      U.text(g, rest, L.x0 + tw, hy, { ...hs, size: ft.size, max: L.x1 - L.x0 - tw });

      const chordPart = S.parts.find((p) => p.role === 'chords');
      const progression = [];
      let any = false;

      for (let i = 0; i < L.n; i++) {
        const sys = L.systems[i], bi = page * L.n + i;
        const b0 = origin + bi * S.bar, b1 = b0 + S.bar;
        const yOf = (step) => sys.bottom - step * gap / 2;

        // bar number
        U.text(g, String(bi + 1), L.x0 + gap * 0.2, sys.bottom + gap * 1.5, { size: gap * 0.55, font: U.FONT.MONO, color: 'rgba(60,60,55,0.5)' });

        // current bar: grey band up to the playhead + red line
        if (bi === barIdx) {
          const px = Math.max(L.x0, barX(S.t, b0));
          const yT = sys.top - gap * 1.6, yBt = sys.bottom + gap * 1.6;
          const gr = g.createLinearGradient(L.x0, 0, px, 0);
          gr.addColorStop(0, 'rgba(110,108,100,0.16)'); gr.addColorStop(1, 'rgba(110,108,100,0.1)');
          g.fillStyle = gr;
          g.fillRect(L.x0, yT, px - L.x0, yBt - yT);
          g.fillStyle = 'rgba(110,108,100,0.06)';
          g.fillRect(L.x0, yT - gap * 0.25, px - L.x0, gap * 0.25);
          g.fillRect(L.x0, yBt, px - L.x0, gap * 0.25);
          g.fillStyle = opt.accent;
          g.fillRect(px - gap * 0.07, yT - gap * 0.4, gap * 0.14, yBt - yT + gap * 0.8);
        }

        // chord name above the system
        if (chordPart && opt.chordNames) {
          let first = Parts.active(chordPart, b0 + 0.02);
          if (!first.length) {
            const inBar = Parts.inRange(chordPart, b0, b1).filter((n) => n.s >= b0);
            first = inBar.filter((n) => inBar.length && Math.abs(n.s - inBar[0].s) < 0.03);
          }
          const name = Parts.chordName(first.map((n) => n.p));
          if (name) {
            U.text(g, name, L.x0 + gap * 0.2, sys.top - gap * 2.1, { size: gap * 1.55, font: U.FONT.HAND, weight: 700, color: '#161616' });
            if (progression[progression.length - 1] !== name) progression.push(name);
          }
        }

        // notes, grouped by onset per part
        for (const part of S.parts) {
          if (part.role === 'drums') continue;
          if (opt.show === 'auto' && part.role !== 'bass' && part.role !== 'chords' && S.parts.some((p) => p.role === 'bass' || p.role === 'chords')) continue;
          const col = COL[part.role] || COL.other;
          const notes = Parts.inRange(part, b0, b1).filter((n) => n.s >= b0 - 0.01);
          if (!notes.length) continue;
          any = true;
          const groups = [];
          for (const n of notes) {
            const last = groups[groups.length - 1];
            if (last && Math.abs(last.s - n.s) < 0.03) last.notes.push(n); else groups.push({ s: n.s, notes: [n] });
          }
          for (const grp of groups) {
            const x = barX(grp.s, b0);
            let heads = grp.notes.map((n) => Object.assign({ n }, spell(n.p, L.sig))).map((o) => ({ ...o, step: o.dn - BASS_BOTTOM }));
            // fit into the staff by whole octaves (keeping the stack together)
            const minS = Math.min(...heads.map((o) => o.step)), maxS = Math.max(...heads.map((o) => o.step));
            let shift = 0;
            while (maxS + shift > 10 && minS + shift - 7 >= -1) shift -= 7;
            while (minS + shift < -1) shift += 7;
            heads = heads.map((o) => ({ ...o, step: o.step + shift })).sort((a, b) => a.step - b.step);
            const mark = shift < 0 ? (shift <= -14 ? '15ma' : '8va') : shift > 0 ? (shift >= 14 ? '15mb' : '8vb') : '';
            const playing = grp.s <= S.t && grp.notes.some((n) => n.e > S.t);
            const c = playing ? U.mix(col, '#000000', 0.18) : col;
            // ledger lines
            g.strokeStyle = 'rgba(60,60,55,0.75)'; g.lineWidth = Math.max(1, gap * 0.07);
            const lo = heads[0].step, hi = heads[heads.length - 1].step;
            for (let s = -2; s >= lo; s -= 2) { g.beginPath(); g.moveTo(x - gap, yOf(s)); g.lineTo(x + gap, yOf(s)); g.stroke(); }
            for (let s = 10; s <= hi; s += 2) { g.beginPath(); g.moveTo(x - gap, yOf(s)); g.lineTo(x + gap, yOf(s)); g.stroke(); }
            // heads (seconds go to the other side of the stem)
            const up = (lo + hi) / 2 < 4;
            let prev = -99, side = 0;
            for (const o of heads) {
              side = o.step - prev === 1 ? 1 - side : 0;
              prev = o.step;
              const hx = x + (side ? (up ? 1 : -1) * gap * 1.1 : 0), y = yOf(o.step);
              head(g, hx, y, gap, c);
              if (o.acc) accidental(g, o.acc, x - gap * 1.45 - (side && !up ? gap * 1.1 : 0), y, gap * 0.85, c);
              if (mark && opt.octaveMarks && o === heads[heads.length - 1]) U.text(g, mark, hx + gap * 0.85, y - gap * 0.15, { size: gap * 0.5, font: U.FONT.MONO, color: 'rgba(60,60,55,0.55)' });
            }
            // stem
            g.strokeStyle = c; g.lineWidth = Math.max(1.2, gap * 0.1);
            g.beginPath();
            if (up) { const sx = x + gap * 0.56; g.moveTo(sx, yOf(lo) - gap * 0.1); g.lineTo(sx, yOf(hi) - gap * (heads.length > 1 ? 2.2 : 3.3)); }
            else { const sx = x - gap * 0.56; g.moveTo(sx, yOf(hi) + gap * 0.1); g.lineTo(sx, yOf(lo) + gap * (heads.length > 1 ? 2.2 : 3.3)); }
            g.stroke();
          }
        }
      }

      // progression written at the bottom
      const fy = S.portrait ? h * 0.945 : h - S.pad * 0.9;
      const fmax = S.portrait ? L.x1 - L.x0 : w / 2 - L.x0 - unit * 0.2;
      if (progression.length) {
        U.text(g, progression.join(' – '), L.x0, fy, { size: gap * 1.35, font: U.FONT.HAND, weight: 700, color: '#161616', max: fmax });
      } else if (!any) {
        U.text(g, S.parts.length ? 'tacet' : 'no notes yet · add a midi file', L.x0, fy, { size: gap * 1.35, font: U.FONT.HAND, weight: 700, color: 'rgba(22,22,22,0.6)', max: fmax });
      }
      if (!S.portrait) U.text(g, S.timeLabel(), L.x1, fy, { size: unit * 0.0165, font: U.FONT.MONO, color: 'rgba(60,60,55,0.55)', align: 'right', spacing: unit * 0.004, max: fmax });
    },
  });
})();
