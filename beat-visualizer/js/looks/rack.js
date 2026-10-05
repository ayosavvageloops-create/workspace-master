// rack — a metering plugin rack: a scrolling stereo envelope, a phase scope, a 12-band
// LED grid with peak hold and an EBU loudness panel with the clip's short-term history.
Looks.register({
  id: 'rack',
  name: 'rack',
  group: 'audio',
  theme: 'dark',
  desc: 'a metering rack: wave, phase, bands and loudness',
  defaults: { accent: '#c8f05a', bg: '#0b0c0d', span: 6, rows: 6, peak: '#e08a2a' },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'peak', label: 'Peak hold', type: 'color' },
    { key: 'span', label: 'Wave window · s', type: 'range', min: 2, max: 16, step: 1 },
    { key: 'rows', label: 'LED rows', type: 'range', min: 4, max: 10, step: 1 },
  ],
  prepare(S) {
    const { A } = S;
    // stereo envelope at 100 Hz: peak and rms per channel, lightly smoothed
    const RATE = 100, n = Math.ceil(A.dur * RATE) + 1, hop = A.sr / RATE;
    const env = {};
    for (const ch of ['L', 'R']) {
      const src = A[ch], pk = new Float32Array(n), rm = new Float32Array(n);
      for (let f = 0; f < n; f++) {
        const a = Math.floor(f * hop - hop), b = Math.min(src.length, Math.floor(f * hop + hop));
        let p = 0, s = 0, c = 0;
        for (let i = Math.max(0, a); i < b; i += 2) { const v = Math.abs(src[i]); if (v > p) p = v; s += v * v; c++; }
        pk[f] = p; rm[f] = c ? Math.sqrt(s / c) : 0;
      }
      const sm = (arr, k) => {
        const out = new Float32Array(n);
        for (let f = 0; f < n; f++) { let s = 0, c = 0; for (let j = -k; j <= k; j++) { const v = arr[f + j]; if (v !== undefined) { s += v; c++; } } out[f] = s / c; }
        return out;
      };
      env[ch] = { pk: sm(sm(pk, 8), 8), rm: sm(sm(rm, 12), 8) };
    }
    let top = 0;
    for (const ch of ['L', 'R']) for (let f = 0; f < n; f++) top = Math.max(top, env[ch].pk[f]);
    // short-term loudness across the clip, for the history curve
    const HN = 240, hist = new Float32Array(HN);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < HN; i++) {
      const v = Math.max(-60, A.lufs.shortTerm(S.clipStart + (i / (HN - 1)) * S.clipLen));
      hist[i] = v; hi = Math.max(hi, v);
    }
    const raw = Float32Array.from(hist);
    for (let i = 0; i < HN; i++) { let s = 0, c = 0; for (let j = -4; j <= 4; j++) if (raw[i + j] !== undefined) { s += raw[i + j]; c++; } hist[i] = s / c; }
    const sorted = Float32Array.from(hist).sort();
    hi = sorted[Math.floor(HN * 0.97)];
    lo = Math.max(sorted[Math.floor(HN * 0.1)] - 2, hi - 12);
    return { env, RATE, n, top: top || 1, hist, hlo: lo, hhi: hi + 1 };
  },
  draw(g, S) {
    const { w, h, pad, A, opt, unit } = S;
    const C = S.cache, acc = opt.accent;
    const olive = U.mix(acc, opt.bg, 0.62);
    g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

    const ink = '#e8e9e4', dim = 'rgba(232,233,228,0.45)';
    U.text(g, S.meta.title, pad * 1.1, pad + unit * 0.05, { size: unit * 0.05, font: U.FONT.PLEX, color: ink });
    U.text(g, S.sub, pad * 1.1, pad + unit * 0.085, { size: unit * 0.017, font: U.FONT.PLEX, color: dim, spacing: 2 });

    // ---- layout ----
    const gap = unit * 0.03, X0 = pad * 1.1, X1 = w - pad * 1.1, W = X1 - X0;
    let wave, phase, bands, loud;
    if (S.portrait) {
      const y0 = h * 0.265;
      wave = { x: X0, y: y0, w: W, h: h * 0.165 };
      const ry = wave.y + wave.h + gap, rh = h * 0.193, pw = W * 0.385;
      phase = { x: X0, y: ry, w: pw, h: rh };
      bands = { x: X0 + pw + gap, y: ry, w: W - pw - gap, h: rh };
      loud = { x: X0, y: ry + rh + gap, w: W, h: h * 0.139 };
    } else {
      const y0 = h * 0.22;
      wave = { x: X0, y: y0, w: W, h: h * 0.3 };
      const ry = wave.y + wave.h + gap, rh = h - pad * 1.2 - ry, pw = rh;
      phase = { x: X0, y: ry, w: pw, h: rh };
      const bw = (W - pw - gap * 2) * 0.42;
      bands = { x: X0 + pw + gap, y: ry, w: bw, h: rh };
      loud = { x: bands.x + bw + gap, y: ry, w: X1 - (bands.x + bw + gap), h: rh };
    }
    const lab = { size: unit * 0.0115, font: U.FONT.PLEX, color: 'rgba(232,233,228,0.42)', spacing: 1 };
    const panel = (r, name) => {
      g.fillStyle = 'rgba(255,255,255,0.012)'; g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1;
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      U.text(g, name, r.x + unit * 0.012, r.y + unit * 0.02, lab);
    };

    // ---- WAVE ----
    panel(wave, 'WAVE');
    {
      const ix = wave.x + unit * 0.012, iw = wave.w - unit * 0.024, iy = wave.y + unit * 0.032, ih = wave.h - unit * 0.05;
      const cy = iy + ih / 2, amp = ih * 0.5 / (C.top * 1.02);
      const N = 180, span = opt.span, t0 = S.t - span / 2;
      // beat ticks along the bottom
      g.fillStyle = 'rgba(255,255,255,0.08)';
      const b0 = Math.ceil((t0 - A.beatOffset) / S.spb);
      for (let b = b0; ; b++) {
        const tb = A.beatOffset + b * S.spb; if (tb > t0 + span) break;
        const x = ix + ((tb - t0) / span) * iw;
        g.fillRect(x, iy + ih - (b % 4 ? ih * 0.04 : ih * 0.09), 1, b % 4 ? ih * 0.04 : ih * 0.09);
      }
      const at = (arr, tt) => {
        const f = tt * C.RATE;
        if (f < 0 || f >= C.n - 1) return 0;
        const i = Math.floor(f), u = f - i; return arr[i] * (1 - u) + arr[i + 1] * u;
      };
      const shape = (kL, kR, fill) => {
        g.beginPath();
        for (let i = 0; i <= N; i++) { const tt = t0 + (i / N) * span; const x = ix + (i / N) * iw; const y = cy - at(C.env.L[kL], tt) * amp * (kL === 'rm' ? 1.7 : 1); i ? g.lineTo(x, y) : g.moveTo(x, y); }
        for (let i = N; i >= 0; i--) { const tt = t0 + (i / N) * span; const x = ix + (i / N) * iw; const y = cy + at(C.env.R[kR], tt) * amp * (kR === 'rm' ? 1.7 : 1); g.lineTo(x, y); }
        g.closePath(); g.fillStyle = fill; g.fill();
      };
      g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
      shape('pk', 'pk', olive);
      shape('rm', 'rm', acc);
      // future side sits a touch further back
      g.fillStyle = U.rgba(opt.bg, 0.07); g.fillRect(ix + iw / 2, iy, iw / 2, ih);
      g.restore();
      g.fillStyle = 'rgba(240,240,236,0.85)';
      g.fillRect(Math.round(ix + iw / 2), wave.y + unit * 0.01, 1.5, wave.h - unit * 0.02);
    }

    // ---- PHASE ----
    panel(phase, 'PHASE');
    {
      const side = Math.min(phase.w * 0.66, phase.h * 0.66);
      const cx = phase.x + phase.w / 2, cy = phase.y + phase.h * 0.49;
      g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1;
      g.strokeRect(cx - side / 2, cy - side / 2, side, side);
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.beginPath(); g.moveTo(cx, cy - side / 2); g.lineTo(cx, cy + side / 2); g.moveTo(cx - side / 2, cy); g.lineTo(cx + side / 2, cy); g.stroke();
      const n = 220, st = A.stereo(S.t, n, 0.03);
      let sl = 0, sr = 0, slr = 0;
      for (let i = 0; i < n; i++) { sl += st.l[i] * st.l[i]; sr += st.r[i] * st.r[i]; slr += st.l[i] * st.r[i]; }
      const corr = sl && sr ? slr / Math.sqrt(sl * sr) : 0;
      const k = (side * 0.5) / C.top;
      g.save(); g.beginPath(); g.rect(cx - side / 2, cy - side / 2, side, side); g.clip();
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = cx + (st.r[i] - st.l[i]) * k * 2.2 + (st.l[i] + st.r[i]) * k * 0.12, y = cy - (st.l[i] + st.r[i]) * k * 0.5;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.fillStyle = U.rgba(acc, 0.85); g.fill();
      g.strokeStyle = acc; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
      g.restore();
      U.text(g, `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`, cx, cy + side / 2 + unit * 0.026, { ...lab, align: 'center' });
    }

    // ---- BANDS ----
    panel(bands, 'BANDS');
    {
      const rows = Math.round(opt.rows), cols = 12;
      const ix = bands.x + unit * 0.012, iy = bands.y + unit * 0.03, iw = bands.w - unit * 0.024, ih = bands.h - unit * 0.042;
      const cg = Math.max(1, unit * 0.003), cw = (iw - cg * (cols - 1)) / cols, ch = (ih - cg * (rows - 1)) / rows;
      const lvl = (v) => Math.min(rows, Math.floor(Math.pow(v, 2.3) * (rows + 0.5)));
      const now = Float32Array.from(A.bands12(S.t));
      const peak = new Int8Array(cols);
      for (let k = 1; k <= 12; k++) { const b = A.bands12(S.t - k * 0.06); for (let i = 0; i < cols; i++) peak[i] = Math.max(peak[i], lvl(b[i])); }
      const hot = Math.max(1, Math.round(rows / 3));
      for (let i = 0; i < cols; i++) {
        const lit = lvl(now[i]);
        for (let r = 0; r < rows; r++) {
          const x = ix + i * (cw + cg), y = iy + ih - (r + 1) * ch - r * cg;
          let col;
          if (r < lit) col = acc;
          else if (r === peak[i] - 1 && peak[i] > lit + 1) col = r >= rows - hot ? opt.peak : U.mix(acc, opt.bg, 0.45);
          else col = r >= rows - hot ? '#211816' : U.mix(acc, opt.bg, 0.86);
          g.fillStyle = col; g.fillRect(x, y, cw, ch);
        }
      }
    }

    // ---- LOUDNESS ----
    panel(loud, 'LOUDNESS');
    {
      const L = A.lufs, f1 = (v) => (v <= -99 ? '-inf' : v.toFixed(1));
      const vals = [['I', f1(L.integrated)], ['S', f1(Math.max(-99.9, L.shortTerm(S.t)))], ['TP', f1(L.truePeak)], ['LRA', L.lra.toFixed(1)]];
      const ix = loud.x + unit * 0.012, iw = loud.w - unit * 0.024;
      const colW = iw / 4.1, big = Math.min(unit * 0.05, colW / 3.6);
      vals.forEach(([k, v], i) => {
        const x = ix + i * colW;
        U.text(g, k, x, loud.y + unit * 0.044, lab);
        U.text(g, v, x, loud.y + unit * 0.044 + big * 1.15, { size: big, font: U.FONT.PLEX, color: ink });
      });
      const cy0 = loud.y + unit * 0.044 + big * 1.6, cy1 = loud.y + loud.h - unit * 0.012;
      const hy = (v) => cy1 - U.clamp(U.invLerp(C.hlo, C.hhi, v)) * (cy1 - cy0);
      g.beginPath();
      g.moveTo(ix, cy1);
      for (let i = 0; i < C.hist.length; i++) g.lineTo(ix + (i / (C.hist.length - 1)) * iw, hy(C.hist[i]));
      g.lineTo(ix + iw, cy1); g.closePath();
      g.fillStyle = U.mix(acc, opt.bg, 0.8); g.fill();
      g.beginPath();
      for (let i = 0; i < C.hist.length; i++) { const x = ix + (i / (C.hist.length - 1)) * iw, y = hy(C.hist[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = U.mix(acc, opt.bg, 0.25); g.lineWidth = Math.max(1, unit * 0.0015); g.stroke();
      const cx = ix + S.prog * iw;
      g.fillStyle = 'rgba(240,240,236,0.8)'; g.fillRect(cx, cy0 - unit * 0.008, 1.5, cy1 - cy0 + unit * 0.008);
    }
  },
});
