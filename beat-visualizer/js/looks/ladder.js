// ladder — a printed loudness sheet: the integrated LUFS set huge, four meter rows against a
// streaming target, and a scrolling momentary history with a red playhead.
Looks.register({
  id: 'ladder',
  name: 'ladder',
  group: 'audio',
  theme: 'light',
  desc: 'a loudness meter sheet with a target line',
  defaults: { accent: '#5fb8a8', bg: '#f2f2ee', target: -14, window: 18, peakColor: '#e0503a' },
  controls: [
    { key: 'bg', label: 'Paper', type: 'color' },
    { key: 'peakColor', label: 'True peak / playhead', type: 'color' },
    { key: 'target', label: 'Target · LUFS', type: 'range', min: -24, max: -8, step: 1 },
    { key: 'window', label: 'History · s', type: 'range', min: 6, max: 30, step: 1 },
  ],
  prepare(S) {
    // momentary range over the clip, for the chart's scale
    const A = S.A, vals = [];
    for (let t = S.clipStart; t < S.clipStart + S.clipLen; t += 0.1) vals.push(A.lufs.momentary(t));
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.05)] || -30, hi = vals[Math.floor(vals.length * 0.99)] || -14;
    return { lo: Math.max(-60, lo), hi: Math.max(hi, lo + 4) };
  },
  draw(g, S) {
    const { w, h, pad, A, opt, unit } = S;
    const C = S.cache, ink = '#1b1b1b', grey = 'rgba(27,27,27,0.5)', red = opt.peakColor;
    g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
    const L = A.lufs, M0 = (t) => Math.max(-70, L.momentary(t));
    // momentary is stored in 100 ms blocks: interpolate and lightly smooth for a clean line
    const Mi = (t) => { const f = t * 10 - 0.5, i = Math.floor(f), u = f - i; return M0(i / 10 + 0.05) * (1 - u) + M0((i + 1) / 10 + 0.05) * u; };
    const M = (t) => (Mi(t - 0.1) + 2 * Mi(t) + Mi(t + 0.1)) / 4, ST = (t) => Math.max(-70, L.shortTerm(t));
    const tiny = { size: unit * 0.0125, font: U.FONT.PLEX, color: grey, spacing: unit * 0.0035 };
    const x0 = pad * 1.1, x1 = w - pad * 1.1;

    // header
    U.text(g, S.meta.title, x0, pad + unit * 0.05, { size: unit * 0.05, font: U.FONT.PLEX, color: ink, max: x1 - x0 });
    U.text(g, S.sub.toUpperCase(), x0, pad + unit * 0.075, { ...tiny, size: unit * 0.0135, max: x1 - x0 });

    // layout: everything sits between the header and the handle-safe strip
    const top = pad + unit * 0.11, bot = (S.portrait ? h - unit * 0.16 : h - pad * 0.9) - unit * 0.06, Hb = bot - top, W = x1 - x0;
    let big, meters, chart;
    if (Hb / W >= 0.95) {
      big = { x: x0, y: top + Hb * 0.19, size: Math.min(unit * 0.18, Hb * 0.125, W * 0.3) };
      meters = { x: x0, x1, y: top + Hb * 0.355, rowH: Hb * 0.095 };
      chart = { x: x0, x1, y: top + Hb * 0.76, y1: bot, labY: top + Hb * 0.715 };
    } else {
      const mid = x0 + W * 0.47;
      big = { x: x0, y: top + Hb * 0.34, size: Math.min(unit * 0.2, (mid - x0 - unit * 0.03) / 3.2, Hb * 0.3) };
      meters = { x: mid, x1, y: top + Hb * 0.07, rowH: Hb * 0.12 };
      chart = { x: x0, x1, y: top + Hb * 0.64, y1: bot, labY: top + Hb * 0.59 };
    }
    U.text(g, L.integrated.toFixed(1), big.x - big.size * 0.04, big.y, { size: big.size, font: U.FONT.PLEX, color: ink });
    U.text(g, 'LUFS INTEGRATED', big.x + unit * 0.006, big.y + big.size * 0.24, { ...tiny, size: unit * 0.014 });

    // meter rows
    const lu = (v) => U.clamp(U.invLerp(-30, -8, v)), tp = (v) => U.clamp(U.invLerp(-24, 0, v));
    const mw = meters.x1 - meters.x, tx = meters.x + lu(opt.target) * mw;
    const rows = [
      ['MOMENTARY', M(S.t), lu],
      ['SHORT TERM', ST(S.t), lu],
      ['INTEGRATED', L.integrated, lu],
      ['TRUE PEAK', L.truePeak, tp],
    ];
    const bh = Math.max(3, unit * 0.0075);
    rows.forEach(([name, v, f], i) => {
      const y = meters.y + i * meters.rowH;
      const by = y + meters.rowH * 0.45;
      U.text(g, name, meters.x, y, tiny);
      U.text(g, v <= -69.9 ? '-inf' : v.toFixed(1), meters.x1, y - meters.rowH * 0.04, { size: Math.min(unit * 0.033, meters.rowH * 0.3), font: U.FONT.PLEX, color: ink, align: 'right' });
      g.fillStyle = 'rgba(27,27,27,0.22)'; g.fillRect(meters.x, by, mw, 1);
      g.fillStyle = i === 3 ? red : '#343432';
      g.fillRect(meters.x, by - bh / 2 + 0.5, f(v) * mw, bh);
    });
    const ty0 = meters.y - meters.rowH * 0.42, ty1 = meters.y + 3 * meters.rowH + meters.rowH * 0.45;
    g.fillStyle = opt.accent; g.fillRect(tx, ty0, 1.2, ty1 - ty0);
    U.text(g, `TARGET ${opt.target}`, tx, ty0 - unit * 0.008, { ...tiny, size: unit * 0.011, color: opt.accent, align: 'center' });

    // history chart
    const win = opt.window, cw = chart.x1 - chart.x, ph = chart.x + cw * 0.72;
    U.text(g, `MOMENTARY · ${win.toFixed(1)} s`, chart.x, chart.labY, { ...tiny, max: cw * 0.48 });
    U.text(g, `${C.lo.toFixed(1)} .. ${C.hi.toFixed(1)} LUFS`, chart.x1, chart.labY, { ...tiny, align: 'right', max: cw * 0.48 });
    const cy0 = chart.y, cy1 = chart.y1, chH = cy1 - cy0;
    const vy = (v) => cy1 - U.clamp(U.invLerp(C.lo - 2, C.hi + 1, v)) * chH;
    // wrap history inside the clip so the chart is full and loops seamlessly
    const wrap = (tt) => S.clipStart + ((((tt - S.clipStart) % S.clipLen) + S.clipLen) % S.clipLen);
    const tAt = (x) => S.t + ((x - ph) / cw) * win;
    // target line
    g.fillStyle = U.rgba(opt.accent, 0.8); g.fillRect(chart.x, Math.round(vy(opt.target)), cw, 1);
    // bars: one per eighth note, height from short-term level
    const step = S.spb / 2, k0 = Math.floor((tAt(chart.x) - A.beatOffset) / step), bw = (step / win) * cw;
    for (let k = k0; ; k++) {
      const tk = A.beatOffset + k * step, x = ph + ((tk - S.t) / win) * cw;
      if (x > chart.x1) break;
      if (x < chart.x - 0.1) continue;
      const tt = wrap(tk), v = 0.25 + 0.75 * Math.pow(A.level(tt), 0.8) * (0.85 + 0.15 * U.hash(k));
      const bh2 = v * chH * 0.62;
      g.fillStyle = tk <= S.t ? 'rgba(27,27,27,0.28)' : 'rgba(27,27,27,0.16)';
      g.fillRect(x, cy1 - bh2, Math.max(1, bw * 0.62), bh2);
    }
    // momentary line: solid past, faded future
    const N = 220;
    const line = (a, b, color, lw) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = a + ((b - a) * i) / N, v = M(wrap(tAt(x)));
        i ? g.lineTo(x, vy(v)) : g.moveTo(x, vy(v));
      }
      g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
    };
    line(chart.x, ph, ink, Math.max(1.5, unit * 0.0022));
    line(ph, chart.x1, 'rgba(27,27,27,0.35)', Math.max(1, unit * 0.0014));
    g.fillStyle = red; g.fillRect(ph - 1, cy0 - chH * 0.12, 2, chH * 1.12);

    // footer
    // below the handle in portrait; beside it (never under it) in the other formats
    const fy = S.portrait ? h - pad * 1.2 : h - pad * 0.6, ft = { ...tiny, size: unit * 0.0115 };
    const tw = U.textWidth(g, S.timeLabel(2), ft);
    let room = W - tw - unit * 0.03;
    if (!S.portrait && S.meta.handle) room = Math.min(room, w / 2 - U.textWidth(g, S.meta.handle, { size: unit * 0.026, font: U.FONT.MONO, spacing: 1 }) / 2 - unit * 0.03 - x0);
    if (room > unit * 0.08) U.text(g, 'EBU R128 · 400 ms / 75 % · 4x OVERSAMPLED PEAK', x0, fy, { ...ft, max: room });
    U.text(g, S.timeLabel(2), x1, fy, { ...ft, align: 'right' });
  },
});
