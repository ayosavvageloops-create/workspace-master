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

  function layout(S) {
    const { w, h, unit, portrait } = S;
    if (portrait) {
      const x = w * 0.055, ww = w - x * 2;
      return { a: { x, y: h * 0.26, w: ww, h: h * 0.232 }, b: { x, y: h * 0.52, w: ww, h: h * 0.262 } };
    }
    const gap = unit * 0.04, ww = (w - S.pad * 2 - gap) / 2, hh = h * 0.5, y = (h - hh) / 2 + h * 0.04;
    return { a: { x: S.pad, y, w: ww, h: hh }, b: { x: S.pad + ww + gap, y, w: ww, h: hh } };
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
      const L = layout(S), u = S.unit, opt = S.opt;
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
        const A = L.a, B = L.b;
        const tbA = windowChrome(g, A.x, A.y, A.w, A.h, u, 'listen');
        const tbB = windowChrome(g, B.x, B.y, B.w, B.h, u, 'current step');
        L.tb = tbA; L.tbB = tbB;
      });
      const m = u * 0.05;
      // listen panel geometry
      const A = L.a, B = L.b, tb = u * 0.052;
      const titleY = A.y + tb + A.h * (S.portrait ? 0.27 : 0.2);
      const wp = { x: A.x + m, y: titleY + A.h * 0.07, w: A.w - m * 2, h: A.h * (S.portrait ? 0.45 : 0.42) };
      const rp = { x: B.x + m, y: B.y + tb + B.h * (S.portrait ? 0.24 : 0.2), w: B.w - m * 2 };
      rp.h = B.y + B.h - m * 0.7 - rp.y;
      const N = Math.max(60, Math.round(wp.w / Math.max(2.5, u * 0.0042)));
      return { L, lo, hi, bg, chrome, titleY, wp, rp, tb, peaks: clipPeaks(S, N) };
    },
    draw(g, S) {
      const { opt, parts, unit: u, A } = S;
      const C = S.cache, L = C.L, red = opt.accent;
      const mono = U.FONT.PLEX;
      g.drawImage(C.bg, 0, 0, S.w, S.h);
      g.drawImage(C.chrome, 0, 0, S.w, S.h);
      const tbx = (W) => W.x + C.tb * 0.5 + C.tb * 0.42 * 2 + C.tb * 0.5;
      U.text(g, 'listen', tbx(L.a), L.a.y + C.tb * 0.62, { size: u * 0.021, font: mono, color: '#77756f' });
      U.text(g, 'current step', tbx(L.b), L.b.y + C.tb * 0.62, { size: u * 0.021, font: mono, color: '#77756f' });

      // ---- listen ----
      const m = u * 0.05;
      U.text(g, S.meta.title || 'untitled', L.a.x + m, C.titleY, { size: u * 0.07, font: mono, weight: 700, color: red });
      const wp = C.wp;
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
      U.text(g, `${(S.meta.title || 'untitled').toLowerCase()} ${Math.round(S.bpm)} ${keyWord(S.meta.key)} · ${Math.round(A.sr / 1000)} khz`, ix, wp.y + wp.h * 0.88, small);
      U.text(g, U.fmtTime(Math.max(0, S.ct)), ix + iw, wp.y + wp.h * 0.88, { ...small, align: 'right' });
      U.text(g, `${Math.round(S.bpm)} bpm${S.meta.key ? ' · ' + S.meta.key : ''}`, L.a.x + m * 0.8, wp.y + wp.h + (L.a.y + L.a.h - wp.y - wp.h) * 0.55, { size: u * 0.017, font: mono, color: '#7b7a76' });

      // ---- current step ----
      const rp = C.rp;
      const hdrY = rp.y - u * 0.028;
      U.text(g, parts.length ? `${parts.length} layer${parts.length > 1 ? 's' : ''}` : 'no layers', L.b.x + m * 0.8, hdrY, { size: u * 0.036, font: mono, weight: 700, color: red });
      let lastEnd = 0;
      for (const p of parts) for (const n of p.notes) if (n.e > lastEnd) lastEnd = n.e;
      const bars = Math.max(1, Math.round((lastEnd || S.clipLen) / S.bar));
      U.text(g, `${bars} bars${S.meta.key ? ' · ' + S.meta.key : ''} · ${Math.round(S.bpm)}`, L.b.x + L.b.w - m * 0.8, hdrY, { size: u * 0.036, font: mono, color: '#6b6a67', align: 'right' });
      U.rrect(g, rp.x, rp.y, rp.w, rp.h, u * 0.016); g.fillStyle = '#1d1d20'; g.fill();

      // legend
      const legCols = { bass: '#e2452c', chords: '#e2781e', lead: '#c23a6e', other: '#c9a23a', drums: '#9a9a9a' };
      let lx = rp.x + u * 0.026;
      const ly = rp.y + u * 0.04, ls = u * 0.011;
      for (const p of S.allParts) {
        const on = p.enabled && p.notes.some((n) => n.s <= S.t);
        const col = legCols[p.role] || legCols.other;
        g.fillStyle = on ? col : U.rgba(col, 0.3); g.fillRect(lx, ly - ls, ls, ls);
        lx += ls * 1.6 + U.text(g, p.name, lx + ls * 1.6, ly, { size: u * 0.018, font: mono, color: on ? '#b9b8b4' : '#55545a' }) + ls * 2;
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
      const nh = Math.max(2, rowH * 0.32);
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
      if (!parts.length) U.text(g, 'no midi loaded', (x0 + x1) / 2, (y0 + y1) / 2, { size: u * 0.02, font: mono, color: '#6a6a70', align: 'center' });
      // white playhead with soft glow
      const gw = u * 0.016;
      const gr = g.createLinearGradient(phx - gw, 0, phx + gw, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(phx - gw, y0 - u * 0.01, gw * 2, y1 - y0 + u * 0.02);
      g.fillStyle = '#ffffff'; g.fillRect(phx - 1.5, y0 - u * 0.01, 3, y1 - y0 + u * 0.02);
    },
  });
})();
