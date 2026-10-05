// receipt — a thermal till receipt that itemises the notes: QTY / NOTE / LEN / AT rows,
// the current line highlighted and the roll scrolling to keep it in view, then subtotal,
// total and a barcode. Chords print as one line (qty = voices, note = chord symbol).
(function () {
  const gridOff = (S) => (!S.hasMidi && S.A && S.A.beatOffset) || 0;

  // build the item list from the chosen parts (stable for a given parts/options set)
  function items(S) {
    const want = S.opt.part;
    let src = S.parts;
    if (want !== 'all') { const only = S.parts.filter((p) => p.role === want); if (only.length) src = only; }
    const out = [];
    for (const p of src) {
      const ns = p.notes;
      for (let i = 0; i < ns.length;) {
        let j = i + 1;
        if (S.opt.group) while (j < ns.length && Math.abs(ns[j].s - ns[i].s) < 0.02) j++;
        const grp = ns.slice(i, j);
        const e = Math.max(...grp.map((n) => n.e));
        const name = grp.length > 1 ? (Parts.chordName(grp.map((n) => n.p)) || U.noteName(grp[0].p)) : U.noteName(grp[0].p);
        out.push({ s: grp[0].s, e, qty: grp.length, name, part: p.name });
        i = j;
      }
    }
    out.sort((a, b) => a.s - b.s);
    return { list: out, names: src.map((p) => p.name), total: src.reduce((a, p) => a + p.notes.length, 0) };
  }

  Looks.register({
    id: 'receipt',
    name: 'receipt',
    group: 'midi',
    theme: 'dark',
    desc: 'a thermal till receipt itemising every note',
    defaults: { accent: '#dddcd5', bg: '#222222', paper: '#f7f6f1', part: 'all', group: true, tilt: 0.7 },
    controls: [
      { key: 'bg', label: 'Backdrop', type: 'color' },
      { key: 'paper', label: 'Paper', type: 'color' },
      { key: 'part', label: 'Print', type: 'select', options: ['all', 'bass', 'chords', 'lead'] },
      { key: 'group', label: 'Chords on one line', type: 'toggle' },
      { key: 'tilt', label: 'Tilt', type: 'range', min: -3, max: 3, step: 0.1 },
    ],
    prepare(S) {
      const { w, h, unit, portrait } = S;
      const pw = portrait ? w * 0.875 : Math.min(w * 0.8, h * 0.78);
      const ph = h * (portrait ? 0.955 : 0.94);
      const it = items(S);
      // barcode widths from the title
      const r = U.rng(U.strSeed(S.meta.title || 'x'));
      const code = [];
      for (let i = 0; i < 64; i++) code.push(1 + Math.floor(r() * 3.2), 1 + Math.floor(r() * 2.2));
      return { pw, ph, it, code, teeth: Math.max(10, Math.round(pw / (unit * 0.018))) };
    },
    draw(g, S) {
      const { w, h, unit, opt, t } = S;
      const { pw, ph, it, code, teeth } = S.cache;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

      g.save();
      g.translate(w / 2, h / 2);
      g.rotate((opt.tilt * Math.PI) / 180);
      const x0 = -pw / 2, y0 = -ph / 2, tw = pw / teeth, th = tw * 0.55;
      // paper with zig-zag tear at top and bottom
      g.beginPath();
      g.moveTo(x0, y0 + th);
      for (let i = 0; i < teeth; i++) { g.lineTo(x0 + (i + 0.5) * tw, y0); g.lineTo(x0 + (i + 1) * tw, y0 + th); }
      g.lineTo(x0 + pw, y0 + ph - th);
      for (let i = teeth - 1; i >= 0; i--) { g.lineTo(x0 + (i + 0.5) * tw, y0 + ph); g.lineTo(x0 + i * tw, y0 + ph - th); }
      g.closePath();
      g.fillStyle = opt.paper; g.fill();

      const ink = '#1c1c1a', faint = '#bdbcb5', mid = '#77766f';
      const F = U.FONT.PLEX, m = pw * 0.065, L = x0 + m, Rr = x0 + pw - m;
      const fs = pw * 0.027;
      const line = (y, dash, k = 1) => {
        g.strokeStyle = U.rgba('#55554f', 0.8 * k); g.lineWidth = Math.max(1, unit * 0.0012);
        g.setLineDash(dash); g.beginPath(); g.moveTo(L, y); g.lineTo(Rr, y); g.stroke(); g.setLineDash([]);
      };
      const dbl = (y) => { line(y, [unit * 0.004, unit * 0.003]); line(y + unit * 0.005, [unit * 0.004, unit * 0.003]); };

      let y = y0 + ph * 0.06;
      dbl(y);
      y += pw * 0.07;
      U.text(g, S.meta.title || 'untitled', L, y, { size: pw * 0.05, font: F, weight: 500, color: ink });
      y += pw * 0.04;
      const bars = Math.max(1, Math.round((S.clipLen) / S.bar));
      U.text(g, `${Math.round(S.bpm)} BPM  ·  ${S.meta.key || '—'}  ·  ${bars} BARS`, L, y, { size: fs * 0.85, font: F, color: ink, spacing: pw * 0.009 });
      y += pw * 0.045;
      const all = opt.part === 'all' || it.names.length !== 1;
      const w1 = U.text(g, all ? 'ALL LINES' : '1 LINE', L, y, { size: fs * 0.85, font: F, color: ink });
      U.text(g, it.names.join(' ') || '—', L + w1 + pw * 0.03, y, { size: fs * 0.85, font: F, color: ink });
      y += pw * 0.035;
      line(y, [unit * 0.004, unit * 0.003]);
      y += pw * 0.042;
      const cQ = L, cN = L + pw * 0.075, cL = x0 + pw * 0.56, cA = Rr;
      const hd = { size: fs * 0.72, font: F, color: ink };
      U.text(g, 'QTY', cQ, y, hd); U.text(g, 'NOTE', cN, y, hd);
      U.text(g, 'LEN', cL, y, { ...hd, align: 'center' }); U.text(g, 'AT', cA, y, { ...hd, align: 'right' });
      y += pw * 0.022;
      line(y, [unit * 0.004, unit * 0.003]);

      // footer block positions (from the bottom up)
      const yb = y0 + ph - ph * 0.045;
      const yCodeTxt = yb - pw * 0.01, codeH = pw * 0.085, yCode = yCodeTxt - pw * 0.035 - codeH;
      const yDbl = yCode - pw * 0.04, yTot = yDbl - pw * 0.035, ySub = yTot - pw * 0.042, yRule = ySub - pw * 0.04;

      // rows
      const rowH = pw * 0.031, top = y + pw * 0.04, nVis = Math.max(1, Math.floor((yRule - top) / rowH));
      const list = it.list, off = gridOff(S);
      let cur = -1;
      for (let i = 0; i < list.length && list[i].s <= t; i++) cur = i;
      const first = U.clamp(cur - Math.floor(nVis / 3), 0, Math.max(0, list.length - nVis));
      const sixteenth = S.spb / 4;
      for (let k = 0; k < nVis && first + k < list.length; k++) {
        const i = first + k, n = list[i], ry = top + k * rowH;
        const past = i <= cur, isCur = i === cur;
        if (isCur) {
          g.fillStyle = opt.accent;
          g.fillRect(L - pw * 0.035, ry - rowH * 0.76, Rr - L + pw * 0.05, rowH);
          U.text(g, '>', L - pw * 0.03, ry, { size: fs, font: F, color: ink });
        }
        const o = { size: fs, font: F, color: past ? ink : faint };
        const len = Math.max(1, Math.round((n.e - n.s) / sixteenth));
        const rel = (n.s - off) / S.spb, bar = Math.floor(rel / 4) + 1, beat = Math.floor(rel - (bar - 1) * 4) + 1;
        U.text(g, String(n.qty), cQ + pw * 0.012, ry, o);
        U.text(g, n.name, cN, ry, o);
        U.text(g, `${len}/16`, cL, ry, { ...o, align: 'center' });
        U.text(g, `${bar}.${beat}`, cA, ry, { ...o, align: 'right' });
      }
      if (!list.length) {
        U.text(g, '— NO ITEMS —', x0 + pw / 2, top + rowH * 4, { size: fs, font: F, color: mid, align: 'center', spacing: 3 });
      }

      // totals
      line(yRule, [unit * 0.004, unit * 0.003]);
      U.text(g, 'SUBTOTAL', L, ySub, { size: fs * 0.95, font: F, color: ink });
      U.text(g, `${it.total} NOTES`, x0 + pw * 0.33, ySub, { size: fs * 0.95, font: F, color: ink });
      U.text(g, 'TOTAL', L, yTot, { size: fs * 1.15, font: F, weight: 500, color: ink });
      U.text(g, U.fmtTime2(S.clipLen), x0 + pw * 0.38, yTot, { size: fs * 1.15, font: F, weight: 500, color: ink });
      dbl(yDbl);

      // barcode
      let total = 0; for (const c of code) total += c;
      const cw = pw * 0.48, unitW = cw / total;
      let bx = -cw / 2;
      g.fillStyle = ink;
      for (let i = 0; i < code.length; i++) { if (i % 2 === 0) g.fillRect(bx, yCode, code[i] * unitW, codeH); bx += code[i] * unitW; }
      U.text(g, `${Math.round(S.bpm)}   ${(S.meta.title || '').toUpperCase()}`, 0, yCodeTxt, { size: fs * 0.72, font: F, color: mid, align: 'center', spacing: pw * 0.012 });
      g.restore();
    },
  });
})();
