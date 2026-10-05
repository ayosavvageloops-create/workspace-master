// proof — a CMYK press proof of the parts: registration marks, a grey step wedge, plate
// patches showing each part's activity, and one block per bar where every part is a
// plate row printed as flat colour blocks (height = pitch) as the playhead passes.
(function () {
  const PLATES = [['C', '#29abe2'], ['M', '#e9529c'], ['Y', '#f5d90a'], ['K', '#231f20']];
  const ROW_BG = '#e2e1d9', INK = '#1b1b1b';

  // bar grid origin: MIDI time 0 is the downbeat; guessed parts follow the audio grid
  const gridOff = (S) => (!S.hasMidi && S.A && S.A.beatOffset) || 0;

  // how busy a part is right now: velocity-weighted coverage of the last two beats, 0..1
  function activity(part, t, spb) {
    const ns = Parts.inRange(part, t - spb * 2, t + 1e-6);
    if (!ns.length) return 0;
    let sum = 0;
    for (let k = 0; k < 12; k++) {
      const tt = t - (k / 12) * spb * 2;
      let v = 0;
      for (const n of ns) if (n.s <= tt && n.e > tt) v = Math.max(v, n.v);
      sum += v;
    }
    return sum / 12;
  }

  function regMark(g, x, y, r, col) {
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(1.2, r * 0.14);
    g.beginPath(); g.arc(x, y, r * 0.62, 0, U.TAU); g.stroke();
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
    g.beginPath(); g.arc(x, y, r * 0.3, 0, U.TAU); g.fill();
  }

  Looks.register({
    id: 'proof',
    name: 'proof',
    group: 'midi',
    theme: 'light',
    desc: 'a CMYK press proof, one plate per part, printed bar by bar',
    defaults: { accent: '#1b1b1b', bg: '#f1f1ec', perPage: 4, progressive: true, marks: true },
    controls: [
      { key: 'bg', label: 'Paper', type: 'color' },
      { key: 'perPage', label: 'Bars per proof', type: 'select', options: [2, 4, 6, 8] },
      { key: 'progressive', label: 'Print as it plays', type: 'toggle' },
      { key: 'marks', label: 'Registration marks', type: 'toggle' },
    ],
    prepare(S) {
      const { w, h, unit, portrait } = S;
      // layout: content column(s)
      let L;
      if (portrait) {
        const cx0 = w * 0.168, cx1 = w * 0.83;
        L = {
          head: { x0: cx0, x1: cx1, y: h * 0.107 },
          bars: { x0: cx0, x1: cx1, y0: h * 0.225, y1: h * 0.872 },
          foot: { x: cx0, y: h * 0.888 },
          marks: { x0: w * 0.135, x1: w * 0.86, y0: h * 0.072, y1: h * 0.928 },
          patchCols: 4,
        };
      } else {
        const hx0 = w * 0.1, hx1 = w * 0.36;
        L = {
          head: { x0: hx0, x1: hx1, y: h * 0.16 },
          bars: { x0: w * 0.42, x1: w * 0.9, y0: h * 0.1, y1: h * 0.9 },
          foot: { x: hx0, y: h * 0.8 },
          marks: { x0: w * 0.065, x1: w * 0.935, y0: h * 0.075, y1: h * 0.925 },
          patchCols: 2,
        };
      }
      // static paper: background, marks, step wedge
      const bg = U.layer(w, h, (c) => {
        c.fillStyle = S.opt.bg; c.fillRect(0, 0, w, h);
        const m = L.marks, r = unit * 0.022;
        if (S.opt.marks) {
          for (const [x, y, sx, sy] of [[m.x0, m.y0, -1, -1], [m.x1, m.y0, 1, -1], [m.x0, m.y1, -1, 1], [m.x1, m.y1, 1, 1]]) {
            regMark(c, x, y, r, INK);
            // crop lines just outside the mark
            c.lineWidth = Math.max(1.2, unit * 0.0022);
            const cxl = x - sx * r * 1.4, cyl = y - sy * r * 1.4;
            c.beginPath();
            c.moveTo(x + sx * r * 1.2, cyl + sy * r * 1.1); c.lineTo(x + sx * r * 2.3, cyl + sy * r * 1.1);
            c.moveTo(cxl + sx * r * 0.2, y + sy * r * 0.9); c.lineTo(cxl + sx * r * 0.2, y + sy * r * 1.8);
            c.moveTo(x - sx * r * 1.0, y + sy * r * 1.35); c.lineTo(x - sx * r * 1.9, y + sy * r * 1.35);
            c.stroke();
          }
        }
        // grey step wedge 0..100
        const hd = L.head, ww = hd.x1 - hd.x0, sw = ww / 11, sh = unit * 0.058;
        for (let i = 0; i <= 10; i++) {
          const v = Math.round(255 - (i / 10) * (255 - 17));
          c.fillStyle = `rgb(${v},${v},${v})`;
          c.fillRect(hd.x0 + i * sw, hd.y, sw + 0.5, sh);
          U.text(c, String(i * 10), hd.x0 + i * sw + sw / 2, hd.y + sh + unit * 0.022,
            { size: unit * 0.0155, font: U.FONT.MONO, weight: 700, color: '#2a2a2a', align: 'center' });
        }
      }, 1);
      return { L, bg };
    },
    draw(g, S) {
      const { w, h, unit, opt, parts, t } = S;
      const { L, bg } = S.cache;
      g.drawImage(bg, 0, 0, w, h);

      const off = gridOff(S), barLen = S.bar, per = +opt.perPage || 4;
      const bi = Math.max(0, Math.floor((t - off) / barLen));
      const page = Math.floor(bi / per), pageStart = off + page * per * barLen;
      const pages = Math.max(1, Math.ceil((S.clipStart + S.clipLen - off) / (per * barLen) - 1e-3));

      // plates: parts that have started printing (at least one)
      const started = parts.filter((p) => p.notes.length && p.notes[0].s <= t);
      const plates = (started.length ? started : parts.slice(0, 1)).slice(0, 4);

      // colour patches
      const hd = L.head, sh = unit * 0.058;
      const py = hd.y + sh + unit * 0.045, ph = unit * 0.068;
      const cols = L.patchCols, gap = unit * 0.022, pw = (hd.x1 - hd.x0 - gap * (cols - 1)) / cols;
      PLATES.forEach(([letter, col], i) => {
        const part = parts[i];
        const val = part ? Math.round(U.clamp(activity(part, t, S.spb) * 1.05) * 10) * 10 : 0;
        const x = hd.x0 + (i % cols) * (pw + gap), y = py + Math.floor(i / cols) * (ph + gap);
        g.fillStyle = U.mix(letter === 'K' ? '#d4d4d0' : U.mix(col, '#ffffff', 0.78), letter === 'K' ? '#4a4a4a' : col, val / 100);
        g.fillRect(x, y, pw, ph);
        const tc = letter === 'K' && val > 50 ? '#f1f1ec' : INK;
        U.text(g, `${letter}  ${val}`, x + pw * 0.12, y + ph * 0.66, { size: unit * 0.03, font: U.FONT.MONO, weight: 600, color: tc });
      });

      // bars
      const B = L.bars, labH = unit * 0.026, bgap = unit * 0.012;
      const blockH = (B.y1 - B.y0) / per;
      const rows = Math.max(1, plates.length), rgap = unit * 0.01;
      const rowH = (blockH - labH - bgap - rgap * (rows - 1)) / rows;
      const bw = B.x1 - B.x0;
      const tx = (tt, b0) => B.x0 + ((tt - b0) / barLen) * bw;
      const lab = { size: unit * 0.0135, font: U.FONT.MONO, weight: 700, color: '#555' };
      for (let b = 0; b < per; b++) {
        const by = B.y0 + b * blockH, b0 = pageStart + b * barLen, b1 = b0 + barLen;
        U.text(g, `BAR ${page * per + b + 1}`, B.x0, by + labH * 0.7, lab);
        const cur = t >= b0 && t < b1;
        const printUntil = opt.progressive ? Math.min(b1, t) : b1;
        for (let r = 0; r < rows; r++) {
          const ry = by + labH + r * (rowH + rgap);
          g.fillStyle = ROW_BG; g.fillRect(B.x0, ry, bw, rowH);
          const pi = parts.indexOf(plates[r]);
          const [letter, col] = PLATES[Math.max(0, pi) % 4];
          U.text(g, letter, B.x0 - unit * 0.035, ry + rowH / 2 + unit * 0.006, { ...lab, color: '#333', align: 'center' });
          const part = plates[r];
          if (!part || printUntil <= b0) continue;
          const span = Math.max(1, part.hi - part.lo);
          // one block per onset: a chord prints as its top voice
          const ns = [];
          for (const n of Parts.inRange(part, b0, printUntil)) {
            const last = ns[ns.length - 1];
            if (last && Math.abs(last.s - n.s) < 0.02) { if (n.p > last.p) last.p = n.p; last.e = Math.max(last.e, n.e); }
            else ns.push({ s: n.s, e: n.e, p: n.p });
          }
          for (const n of ns) {
            const xa = tx(Math.max(n.s, b0), b0), xb = tx(Math.min(n.e, printUntil), b0);
            if (xb - xa < 0.5) continue;
            const k = part.hi === part.lo ? 0.7 : 0.28 + 0.72 * (n.p - part.lo) / span;
            const hh = rowH * k;
            g.fillStyle = U.mix(col, '#ffffff', U.hash(Math.round(n.s * 100), n.p) * 0.12);
            g.fillRect(xa, ry + rowH - hh, xb - xa, hh);
            // hairline gap between touching blocks
            g.fillStyle = 'rgba(241,241,236,0.9)'; g.fillRect(xb - 1, ry + rowH - hh, 1, hh);
            if (cur && n.s <= t && n.e > t && n.s >= b0) {
              g.strokeStyle = INK; g.lineWidth = Math.max(1.5, unit * 0.0025);
              g.strokeRect(xa, ry + rowH - hh, xb - xa, hh);
            }
          }
        }
        if (cur) {
          const x = tx(t, b0), yA = by + labH - unit * 0.012, yB = by + labH + rows * (rowH + rgap) - rgap + unit * 0.004;
          g.fillStyle = opt.accent;
          g.fillRect(x - unit * 0.0022, yA, unit * 0.0044, yB - yA);
        }
      }

      // footer
      const F = L.foot;
      U.text(g, S.meta.title || 'untitled', F.x, F.y, { size: unit * 0.034, font: U.FONT.MONO, weight: 700, color: INK });
      const nPl = parts.length ? started.length : 0;
      const bits = [`${Math.round(S.bpm)} BPM`, S.meta.key, parts.length ? `${nPl} plate${nPl === 1 ? '' : 's'}` : 'no plates',
        `proof ${Math.min(page + 1, pages)}/${pages}`, `${Math.round(S.prog * 100)}%`].filter(Boolean);
      U.text(g, bits.join('  ·  '), F.x, F.y + unit * 0.032, { size: unit * 0.0175, font: U.FONT.MONO, weight: 700, color: '#2a2a2a' });
      if (!parts.length) {
        U.text(g, 'NO PARTS TO PROOF', (B.x0 + B.x1) / 2, B.y0 + blockH * 0.5 + labH, { size: unit * 0.02, font: U.FONT.MONO, weight: 700, color: '#9a9a92', align: 'center', spacing: 3 });
      }
    },
  });
})();
