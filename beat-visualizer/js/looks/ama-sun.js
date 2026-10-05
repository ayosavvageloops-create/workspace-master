// ama-sun — two light desktop windows on warm cream: "listen" with a big title and a clip
// waveform, and "current step" with a dark mini piano roll and a glowing white playhead.
(function () {
  function range(parts, span) {
    let lo = 127, hi = 0;
    for (const p of parts) for (const n of p.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
    if (lo > hi) { lo = 36; hi = 84; }
    lo -= 3; hi += 3;
    if (hi - lo < span) { const c = (lo + hi) / 2; lo = Math.floor(c - span / 2); hi = lo + span; }
    return [lo, hi];
  }
  // peak envelope of the clip, normalised 0..1
  function clipPeaks(S, n) {
    const A = S.A, src = A.M, sr = A.sr, out = new Float32Array(n);
    const a = Math.max(0, Math.floor(S.clipStart * sr)), b = Math.min(src.length, Math.floor((S.clipStart + S.clipLen) * sr));
    const step = Math.max(1, (b - a) / n);
    let mx = 1e-6;
    for (let i = 0; i < n; i++) {
      let pk = 0, ss = 0, c = 0;
      const j0 = Math.floor(a + i * step), j1 = Math.min(b, Math.floor(a + (i + 1) * step));
      for (let j = j0; j < j1; j += 3) { const v = Math.abs(src[j]); if (v > pk) pk = v; ss += v * v; c++; }
      const v = Math.sqrt(0.4 * pk + 0.6 * Math.sqrt(ss / Math.max(1, c)) * 2.2);
      out[i] = v; if (v > mx) mx = v;
    }
    for (let i = 0; i < n; i++) out[i] /= mx;
    return out;
  }
  function keyWord(k) {
    if (!k) return '';
    const m = /m$/.test(k) && !/maj$/i.test(k);
    return k.replace(/m$/, '').toLowerCase() + (m ? 'min' : 'maj');
  }
  // window chrome: shadow, body, title bar with traffic lights and a mono title
  function windowChrome(g, x, y, w, h, u, title) {
    const r = u * 0.014, tb = u * 0.052;
    g.save();
    g.shadowColor = 'rgba(90,60,20,0.18)'; g.shadowBlur = u * 0.05; g.shadowOffsetY = u * 0.014;
    U.rrect(g, x, y, w, h, r); g.fillStyle = '#f7f6f1'; g.fill();
    g.restore();
    g.save(); U.rrect(g, x, y, w, h, r); g.clip();
    g.fillStyle = '#ecebe5'; g.fillRect(x, y, w, tb);
    g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(x, y + tb, w, 1);
    g.restore();
    U.rrect(g, x + 0.5, y + 0.5, w - 1, h - 1, r); g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1; g.stroke();
    const cols = ['#ff5f57', '#febc2e', '#28c840'];
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x + tb * 0.5 + i * tb * 0.42, y + tb / 2, tb * 0.13, 0, U.TAU); g.fillStyle = cols[i]; g.fill(); }
    return tb;
  }

  // y of the core's handle watermark strip top (keep look text above it)
  const markTop = (S) => (S.portrait ? S.h - S.unit * 0.16 : S.h - S.pad * 0.9) - S.unit * 0.035;

  // Fits a title into `maxW`: one line if it fits at >= 80% size, else two lines split at the
  // space nearest the middle, else one shrunken line cut with an ellipsis.
  function fitTitle(g, str, maxW, size, o) {
    const w1 = U.textWidth(g, str, { ...o, size });
    if (w1 * 0.8 <= maxW) return { lines: [str], size: Math.min(size, size * maxW / w1) };
    const sp = [...str.matchAll(/ /g)].map((m) => m.index);
    if (sp.length) {
      let best = sp[0];
      for (const i of sp) if (Math.abs(i - str.length / 2) < Math.abs(best - str.length / 2)) best = i;
      const a = str.slice(0, best), b = str.slice(best + 1);
      const wl = Math.max(U.textWidth(g, a, { ...o, size }), U.textWidth(g, b, { ...o, size }));
      const s2 = Math.min(size * 0.64, size * maxW / wl);
      if (s2 >= size * 0.42) return { lines: [a, b], size: s2 };
    }
    return { lines: [str], size: size * 0.6, max: maxW };
  }

  // Window geometry. `k` scales everything inside the windows so the stack fits short formats.
  function layout(S) {
    const { w, h, unit: u } = S;
    const mt = markTop(S);
    if (w / h >= 1.4) {
      const gap = u * 0.04, ww = (w - S.pad * 2 - gap) / 2, hh = u * 0.5, y = Math.max(S.pad, (mt - u * 0.02 - hh) / 2 + S.pad * 0.3);
      return { k: 1, a: { x: S.pad, y, w: ww, h: hh }, b: { x: S.pad + ww + gap, y, w: ww, h: hh } };
    }
    const avail = mt - u * 0.02 - S.pad * 0.6;
    const k = Math.min(1, avail / (u * 0.926)), total = u * 0.926 * k;
    const y0 = Math.max(S.pad * 0.6, Math.min(h * 0.26, (mt - u * 0.02 - total) * 0.75));
    const x = w * 0.055, ww = w - x * 2;
    return { k, a: { x, y: y0, w: ww, h: u * 0.41 * k }, b: { x, y: y0 + u * 0.46 * k, w: ww, h: u * 0.466 * k } };
  }

  Looks.register({
    id: 'ama-sun',
    name: 'ama sun',
    group: 'midi',
    theme: 'light',
    desc: 'warm desktop windows: a listen waveform and a dark piano roll',
    defaults: { accent: '#dd4a2c', bg: '#f6f1e6', bars: 4, playhead: 0.3, blooms: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars in roll', type: 'select', options: [2, 4, 8] },
      { key: 'playhead', label: 'Playhead position', type: 'range', min: 0.1, max: 0.6, step: 0.05 },
      { key: 'blooms', label: 'Sun blooms', type: 'toggle' },
    ],
    prepare(S) {
      const L = layout(S), opt = S.opt, uk = S.unit * L.k;
      const [lo, hi] = range(S.parts, 30);
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        if (!opt.blooms) return;
        U.glowBlob(g, w * 0.22, h * 0.15, w * 0.4, '#f2cf8a', 0.55);
        U.glowBlob(g, w * 0.82, h * 0.22, w * 0.38, '#ffbe84', 0.55);
        U.glowBlob(g, w * 0.12, h * 0.86, w * 0.38, '#f3d7a2', 0.4);
        U.glowBlob(g, w * 0.9, h * 0.82, w * 0.35, '#ffd5a8', 0.4);
      }, 0.25);
      const chrome = U.layer(S.w, S.h, (g) => {
        windowChrome(g, L.a.x, L.a.y, L.a.w, L.a.h, uk);
        windowChrome(g, L.b.x, L.b.y, L.b.w, L.b.h, uk);
      });
      const m = uk * 0.05, A = L.a, B = L.b, tb = uk * 0.052;
      const wp = { x: A.x + m, y: A.y + uk * 0.2, w: A.w - m * 2, h: uk * 0.158 };
      const rp = { x: B.x + m, y: B.y + uk * 0.135, w: B.w - m * 2 };
      rp.h = B.y + B.h - uk * 0.035 - rp.y;
      const N = Math.max(60, Math.round(wp.w / Math.max(2.5, S.unit * 0.0042)));
      return { L, uk, lo, hi, bg, chrome, wp, rp, tb, peaks: clipPeaks(S, N) };
    },
    draw(g, S) {
      const { opt, parts, A } = S;
      const C = S.cache, L = C.L, red = opt.accent, u = C.uk;
      const mono = U.FONT.PLEX;
      g.drawImage(C.bg, 0, 0, S.w, S.h);
      g.drawImage(C.chrome, 0, 0, S.w, S.h);
      const tbx = (W) => W.x + C.tb * 1.84;
      U.text(g, 'listen', tbx(L.a), L.a.y + C.tb * 0.62, { size: u * 0.021, font: mono, color: '#77756f' });
      U.text(g, 'current step', tbx(L.b), L.b.y + C.tb * 0.62, { size: u * 0.021, font: mono, color: '#77756f' });

      // ---- listen ----
      const m = u * 0.05, wp = C.wp;
      const title = S.meta.title || 'untitled';
      const tOpt = { font: mono, weight: 700, color: red };
      const ft = fitTitle(g, title, L.a.w - m * 2, u * 0.07, tOpt);
      const zoneTop = L.a.y + C.tb, zoneBot = wp.y - u * 0.018;
      if (ft.lines.length === 1) U.text(g, ft.lines[0], L.a.x + m, zoneBot - (zoneBot - zoneTop - ft.size * 0.72) / 2, { ...tOpt, size: ft.size, max: ft.max || 0 });
      else ft.lines.forEach((ln, i) => U.text(g, ln, L.a.x + m, zoneBot - (zoneBot - zoneTop - ft.size * 1.92) / 2 - (1 - i) * ft.size * 1.18, { ...tOpt, size: ft.size, max: L.a.w - m * 2 }));
      U.rrect(g, wp.x, wp.y, wp.w, wp.h, u * 0.014); g.fillStyle = '#1e1e21'; g.fill();
      const pk = C.peaks, N = pk.length, ix = wp.x + u * 0.025, iw = wp.w - u * 0.05, cy = wp.y + wp.h * 0.4, amp = wp.h * 0.27;
      const bw = iw / N, cut = S.prog * N;
      for (let i = 0; i < N; i++) {
        const v = Math.max(0.04, pk[i]) * amp;
        g.fillStyle = i < cut ? '#e9e8e4' : '#6f6f73';
        g.fillRect(ix + i * bw, cy - v, Math.max(1, bw * 0.7), v * 2);
      }
      g.fillStyle = '#e8432a'; g.fillRect(ix + S.prog * iw - 1, wp.y + wp.h * 0.08, 2.5, wp.h * 0.64);
      const small = { size: u * 0.017, font: mono, color: '#8c8b88' };
      const tw = U.text(g, U.fmtTime(Math.max(0, S.ct)), ix + iw, wp.y + wp.h * 0.88, { ...small, align: 'right' });
      U.text(g, `${title.toLowerCase()} ${Math.round(S.bpm)} ${keyWord(S.meta.key)} · ${Math.round(A.sr / 1000)} khz`, ix, wp.y + wp.h * 0.88, { ...small, max: iw - tw - u * 0.03 });
      U.text(g, `${Math.round(S.bpm)} bpm${S.meta.key ? ' · ' + S.meta.key : ''}`, L.a.x + m * 0.8, Math.min(wp.y + wp.h + u * 0.04, L.a.y + L.a.h - u * 0.014), { size: u * 0.017, font: mono, color: '#7b7a76', max: L.a.w - m * 1.6 });

      // ---- current step ----
      const rp = C.rp;
      const hdrY = rp.y - u * 0.026, hx0 = L.b.x + m * 0.8, hx1 = L.b.x + L.b.w - m * 0.8;
      const lw = U.text(g, parts.length ? `${parts.length} layer${parts.length > 1 ? 's' : ''}` : 'no layers', hx0, hdrY, { size: u * 0.036, font: mono, weight: 700, color: red, max: (hx1 - hx0) * 0.45 });
      let lastEnd = 0;
      for (const p of parts) for (const n of p.notes) if (n.e > lastEnd) lastEnd = n.e;
      const bars = Math.max(1, Math.round((lastEnd || S.clipLen) / S.bar));
      const stat = `${bars} bars${S.meta.key ? ' · ' + S.meta.key : ''} · ${Math.round(S.bpm)}`;
      const room = hx1 - hx0 - lw - u * 0.03;
      U.text(g, stat, hx1, hdrY, { size: Math.min(u * 0.036, u * 0.036 * room / Math.max(1, U.textWidth(g, stat, { size: u * 0.036, font: mono }))) , font: mono, color: '#6b6a67', align: 'right', max: room });
      U.rrect(g, rp.x, rp.y, rp.w, rp.h, u * 0.016); g.fillStyle = '#1d1d20'; g.fill();

      // legend
      const legCols = { bass: '#e2452c', chords: '#e2781e', lead: '#c23a6e', other: '#c9a23a', drums: '#9a9a9a' };
      let lx = rp.x + u * 0.026;
      const ly = rp.y + u * 0.04, ls = u * 0.011;
      for (const p of S.allParts) {
        if (lx > rp.x + rp.w * 0.8) break;
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        const col = legCols[p.role] || legCols.other;
        g.fillStyle = on ? col : U.rgba(col, 0.3); g.fillRect(lx, ly - ls, ls, ls);
        lx += ls * 1.6 + U.text(g, p.name, lx + ls * 1.6, ly, { size: u * 0.018, font: mono, color: on ? '#b9b8b4' : '#55545a', max: rp.w * 0.25 }) + ls * 2;
      }

      // roll body
      const x0 = rp.x + u * 0.02, x1 = rp.x + rp.w - u * 0.02, y0 = ly + u * 0.02, y1 = rp.y + rp.h - u * 0.02;
      const { lo, hi } = C, rows = hi - lo + 1, rowH = (y1 - y0) / rows;
      g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
      for (let r = 0; r < rows; r += 1) { g.fillStyle = r % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.045)'; g.fillRect(x0, y0 + r * rowH, x1 - x0, Math.max(1, rowH * 0.08)); }
      const win = S.bar * opt.bars, phx = x0 + (x1 - x0) * opt.playhead;
      const tx = (tt) => phx + ((tt - S.t) / win) * (x1 - x0);
      const t0 = S.t - win * opt.playhead, t1 = S.t + win * (1 - opt.playhead);
      for (let b = Math.floor((t0 - A.beatOffset) / S.bar); b <= Math.ceil((t1 - A.beatOffset) / S.bar); b++) {
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(tx(A.beatOffset + b * S.bar), y0, 1, y1 - y0);
      }
      const nh = Math.max(2.5, rowH * 0.36);
      for (const p of parts) {
        const col = legCols[p.role] || legCols.other;
        for (const n of Parts.inRange(p, t0, t1)) {
          const xa = tx(n.s), xb = tx(n.e) - 2, y = y1 - (n.p - lo + 0.5) * rowH - nh / 2;
          const playing = n.s <= S.t && n.e > S.t;
          g.fillStyle = U.rgba(col, playing ? 1 : n.e <= S.t ? 0.45 : 0.62);
          g.fillRect(xa, y, Math.max(2, xb - xa), playing ? nh * 1.6 : nh);
        }
      }
      g.restore();
      if (!parts.length) U.text(g, 'no notes found', (x0 + x1) / 2, (y0 + y1) / 2, { size: u * 0.02, font: mono, color: '#6a6a70', align: 'center' });
      // white playhead with soft glow
      const gw = u * 0.016;
      const gr = g.createLinearGradient(phx - gw, 0, phx + gw, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(phx - gw, y0 - u * 0.01, gw * 2, y1 - y0 + u * 0.02);
      g.fillStyle = '#ffffff'; g.fillRect(phx - 1.5, y0 - u * 0.01, 3, y1 - y0 + u * 0.02);
    },
  });
})();
