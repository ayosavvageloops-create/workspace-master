// Offline analysis of a decoded AudioBuffer. Everything a look needs is a pure
// function of time, so preview and export render identical frames.
//
//   const A = await Analysis.analyze(audioBuffer, { bpm, onProgress })
//   A.dur, A.sr, A.L, A.R, A.M          raw channels (Float32Array)
//   A.level(t)                          overall loudness 0..1 (normalised to the track)
//   A.band(t, name)                     'sub'|'bass'|'lowmid'|'mid'|'highmid'|'high' 0..1
//   A.bands12(t)                        12 log bands 0..1 (Float32Array, shared)
//   A.spectrum(t, n, {min,max,smooth})  n log-spaced bins 0..1 (new Float32Array)
//   A.wave(t, n, {span, ch, center})    n samples -1..1 ending at t (or centred)
//   A.stereo(t, n, span)                {l, r} sample windows for goniometers
//   A.lowpassed()                       mono 150 Hz low-passed signal (lazy, for scopes)
//   A.onsets.{bass,hit,high}            [{t, s}] detected onsets (s = strength 0..1)
//   A.pulse(t, kind='bass', decay=0.18) decaying envelope from onsets, 0..1
//   A.bpm, A.beatOffset, A.beatPhase(t), A.beatIndex(t), A.beatPulse(t, decay)
//   A.lufs: { integrated, truePeak, lra, momentary(t), shortTerm(t) }
//   A.peaks(n, ch)                      overview {min, max} Float32Arrays of n buckets
(function () {
  const FPS = 60;
  const BAND_EDGES = [20, 60, 250, 500, 2000, 6000, 16000];
  const BAND_NAMES = ['sub', 'bass', 'lowmid', 'mid', 'highmid', 'high'];

  // ---------- FFT ----------
  const fftCache = {};
  function fftPlan(n) {
    if (fftCache[n]) return fftCache[n];
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
    const win = new Float32Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return (fftCache[n] = { n, rev, cos, sin, win, re: new Float32Array(n), im: new Float32Array(n), mag: new Float32Array(n / 2) });
  }
  // Magnitude spectrum (linear, window-normalised) of `src` around sample index `pos`.
  function magnitudes(src, pos, n) {
    const p = fftPlan(n), { re, im, rev, win, cos, sin, mag } = p;
    const start = Math.floor(pos - n / 2);
    for (let i = 0; i < n; i++) {
      const j = start + i;
      re[rev[i]] = (j >= 0 && j < src.length ? src[j] : 0) * win[i];
      im[rev[i]] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step], s = sin[k * step];
          const a = i + k, b = a + half;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    const norm = 4 / n;
    for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) * norm;
    return mag;
  }

  // ---------- K-weighting (BS.1770) ----------
  function kFilters(fs) {
    const shelf = (() => {
      const G = 3.999843853973347, Q = 0.7071752369554193, fc = 1681.974450955533;
      const A = Math.pow(10, G / 40), w0 = 2 * Math.PI * fc / fs, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0), sA = Math.sqrt(A);
      const a0 = (A + 1) - (A - 1) * c + 2 * sA * al;
      return [A * ((A + 1) + (A - 1) * c + 2 * sA * al) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0,
              A * ((A + 1) + (A - 1) * c - 2 * sA * al) / a0, 2 * ((A - 1) - (A + 1) * c) / a0,
              ((A + 1) - (A - 1) * c - 2 * sA * al) / a0];
    })();
    const hp = (() => {
      const Q = 0.5003270373238773, fc = 38.13547087602444;
      const w0 = 2 * Math.PI * fc / fs, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0), a0 = 1 + al;
      return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0];
    })();
    return [shelf, hp];
  }
  function biquadInPlace(x, [b0, b1, b2, a1, a2]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i], y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0;
    }
  }
  const toLufs = (ms) => (ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120);

  function percentile(arr, q) {
    if (!arr.length) return 0;
    const s = Float32Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function analyze(buf, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    const sr = buf.sampleRate, N = buf.length, dur = buf.duration;
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const M = new Float32Array(N);
    for (let i = 0; i < N; i++) M[i] = (L[i] + R[i]) * 0.5;

    const hop = sr / FPS, frames = Math.ceil(N / hop) + 1;

    // ---- per-frame band energies (FFT 2048) ----
    const FFTN = 2048, binHz = sr / FFTN, nb = FFTN / 2;
    const b12 = new Float32Array(frames * 12), b6 = new Float32Array(frames * 6), rms = new Float32Array(frames);
    const flux = new Float32Array(frames), fluxBass = new Float32Array(frames), fluxHigh = new Float32Array(frames);
    const edges12 = Array.from({ length: 13 }, (_, i) => 30 * Math.pow(16000 / 30, i / 12));
    let prevLog = new Float32Array(nb);
    const of12 = new Int8Array(nb).fill(-1), of6 = new Int8Array(nb).fill(-1);
    for (let k = 1; k < nb; k++) {
      const hz = k * binHz;
      for (let i = 0; i < 12; i++) if (hz >= edges12[i] && hz < edges12[i + 1]) of12[k] = i;
      for (let i = 0; i < 6; i++) if (hz >= BAND_EDGES[i] && hz < BAND_EDGES[i + 1]) of6[k] = i;
    }
    for (let f = 0; f < frames; f++) {
      const pos = f * hop;
      const mag = magnitudes(M, pos, FFTN);
      // bands
      const acc12 = new Float64Array(12), cnt12 = new Uint16Array(12), acc6 = new Float64Array(6), cnt6 = new Uint16Array(6);
      let fl = 0, flB = 0, flH = 0;
      for (let k = 1; k < nb; k++) {
        const hz = k * binHz, e = mag[k] * mag[k];
        const bi = of12[k], bj = of6[k];
        if (bi >= 0) { acc12[bi] += e; cnt12[bi]++; }
        if (bj >= 0) { acc6[bj] += e; cnt6[bj]++; }
        const lg = Math.log1p(mag[k] * 1000);
        const d = lg - prevLog[k];
        prevLog[k] = lg;
        if (d > 0) { fl += d; if (hz < 200) flB += d; else if (hz > 5000) flH += d; }
      }
      for (let i = 0; i < 12; i++) b12[f * 12 + i] = 10 * Math.log10(acc12[i] / Math.max(1, cnt12[i]) + 1e-12);
      for (let i = 0; i < 6; i++) b6[f * 6 + i] = 10 * Math.log10(acc6[i] / Math.max(1, cnt6[i]) + 1e-12);
      flux[f] = fl; fluxBass[f] = flB; fluxHigh[f] = flH;
      let s = 0;
      const a = Math.max(0, Math.floor(pos - hop)), b = Math.min(N, Math.floor(pos + hop));
      for (let i = a; i < b; i++) s += M[i] * M[i];
      rms[f] = Math.sqrt(s / Math.max(1, b - a));
      if (f % 400 === 0) { onProgress(0.7 * f / frames); await tick(); }
    }

    // Normalise dB bands to 0..1 against the track's own range (5th..99th percentile).
    function normBands(arr, k) {
      for (let i = 0; i < k; i++) {
        const col = new Float32Array(frames);
        for (let f = 0; f < frames; f++) col[f] = arr[f * k + i];
        const lo = percentile(col, 0.05), hi = percentile(col, 0.995);
        for (let f = 0; f < frames; f++) arr[f * k + i] = Math.min(1, Math.max(0, (arr[f * k + i] - lo) / Math.max(1e-6, hi - lo)));
      }
    }
    normBands(b12, 12); normBands(b6, 6);
    const rmsHi = percentile(rms, 0.995) || 1;
    const level = rms.map((v) => Math.min(1, v / rmsHi));

    // ---- onsets ----
    function pick(fx, minGap) {
      const out = [], W = Math.round(FPS * 0.25), hi = percentile(fx, 0.99) || 1;
      for (let f = 1; f < frames - 1; f++) {
        if (fx[f] < fx[f - 1] || fx[f] < fx[f + 1]) continue;
        let s = 0, c = 0;
        for (let j = Math.max(0, f - W); j < Math.min(frames, f + W); j++) { s += fx[j]; c++; }
        const thr = (s / c) * 1.5 + hi * 0.08;
        if (fx[f] > thr) {
          const t = f / FPS;
          if (out.length && t - out[out.length - 1].t < minGap) {
            if (fx[f] / hi > out[out.length - 1].s) out[out.length - 1] = { t, s: Math.min(1, fx[f] / hi) };
          } else out.push({ t, s: Math.min(1, fx[f] / hi) });
        }
      }
      return out;
    }
    const onsets = { bass: pick(fluxBass, 0.12), hit: pick(flux, 0.08), high: pick(fluxHigh, 0.05) };
    onProgress(0.75); await tick();

    // ---- tempo ----
    let bpm = opts.bpm || 0;
    if (!bpm) {
      let best = 0, bestLag = 0;
      for (let b = 70; b <= 180; b += 0.5) {
        const lag = FPS * 60 / b;
        let s = 0;
        for (let f = 0; f + lag * 4 < frames; f += 2) {
          const i1 = Math.round(f + lag), i2 = Math.round(f + lag * 2);
          s += flux[f] * (flux[i1] + 0.5 * flux[i2]);
        }
        s *= b >= 85 && b <= 165 ? 1 : 0.85;
        if (s > best) { best = s; bestLag = b; }
      }
      bpm = Math.round(bestLag) || 120;
    }
    let beatOffset = 0;
    if (opts.beatOffset != null) beatOffset = opts.beatOffset;
    else {
      const spb = 60 / bpm; let best = -1;
      for (let o = 0; o < spb; o += 1 / FPS) {
        let s = 0;
        for (let t = o; t < dur; t += spb) { const f = Math.round(t * FPS); s += (fluxBass[f] || 0) * 2 + (flux[f] || 0); }
        if (s > best) { best = s; beatOffset = o; }
      }
    }

    // ---- loudness ----
    const [shelf, hp] = kFilters(sr);
    const kL = Float32Array.from(L); biquadInPlace(kL, shelf); biquadInPlace(kL, hp);
    let kR = kL;
    if (R !== L) { kR = Float32Array.from(R); biquadInPlace(kR, shelf); biquadInPlace(kR, hp); }
    onProgress(0.85); await tick();
    const hopN = Math.round(sr / 10); // 100 ms blocks
    const nH = Math.ceil(N / hopN);
    const hopSum = new Float64Array(nH);
    for (let i = 0; i < N; i++) hopSum[(i / hopN) | 0] += kL[i] * kL[i] + (kR === kL ? 0 : kR[i] * kR[i]);
    const chanScale = kR === kL ? 2 : 1; // mono counts as both channels
    const winMs = (endHop, nHops) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, endHop - nHops + 1); j <= endHop && j < nH; j++) { s += hopSum[j]; c += hopN; }
      return c ? (s * chanScale) / c : 0;
    };
    const mom = new Float32Array(nH), st = new Float32Array(nH);
    for (let j = 0; j < nH; j++) { mom[j] = toLufs(winMs(j, 4)); st[j] = toLufs(winMs(j, 30)); }
    const blocks = []; for (let j = 3; j < nH; j++) blocks.push(winMs(j, 4));
    const abs = blocks.filter((m) => toLufs(m) > -70);
    const relThr = toLufs(abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length)) - 10;
    const gated = abs.filter((m) => toLufs(m) > relThr);
    const integrated = gated.length ? toLufs(gated.reduce((a, b) => a + b, 0) / gated.length) : -70;
    const stBlocks = []; for (let j = 29; j < nH; j += 1) stBlocks.push(st[j]);
    const stAbs = stBlocks.filter((v) => v > -70);
    const stRel = stAbs.filter((v) => v > (stAbs.length ? 10 * Math.log10(stAbs.reduce((a, v) => a + Math.pow(10, v / 10), 0) / stAbs.length) : -70) - 20);
    const lra = stRel.length ? percentile(stRel, 0.95) - percentile(stRel, 0.1) : 0;
    let peak = 0;
    for (const ch of R === L ? [L] : [L, R]) {
      for (let i = 1; i < ch.length - 2; i++) {
        const a = Math.abs(ch[i]); if (a > peak) peak = a;
        if (a > peak * 0.7) { // cheap 4x cubic interpolation near peaks
          const y0 = ch[i - 1], y1 = ch[i], y2 = ch[i + 1], y3 = ch[i + 2];
          for (const x of [0.25, 0.5, 0.75]) {
            const v = y1 + 0.5 * x * (y2 - y0 + x * (2 * y0 - 5 * y1 + 4 * y2 - y3 + x * (3 * (y1 - y2) + y3 - y0)));
            if (Math.abs(v) > peak) peak = Math.abs(v);
          }
        }
      }
    }
    const truePeak = 20 * Math.log10(peak + 1e-12);
    onProgress(0.95); await tick();

    // ---- accessors ----
    const fAt = (t) => Math.max(0, Math.min(frames - 1, t * FPS));
    function interp(arr, k, i, t) {
      const x = fAt(t), f0 = Math.floor(x), f1 = Math.min(frames - 1, f0 + 1), u = x - f0;
      return arr[f0 * k + i] * (1 - u) + arr[f1 * k + i] * u;
    }
    const tmp12 = new Float32Array(12);
    let lp = null;
    const peaksCache = {};

    const A = {
      sr, dur, L, R, M, FPS, bpm, beatOffset, onsets,
      level: (t) => interp(level, 1, 0, t),
      band: (t, name) => interp(b6, 6, Math.max(0, BAND_NAMES.indexOf(name)), t),
      bands12(t) { for (let i = 0; i < 12; i++) tmp12[i] = interp(b12, 12, i, t); return tmp12; },
      spectrum(t, n, o = {}) {
        const min = o.min || 30, max = o.max || 16000, size = o.size || 4096;
        const out = new Float32Array(n), weights = o.smooth === false ? [[0, 1]] : [[0, 0.55], [1 / 60, 0.3], [2 / 60, 0.15]];
        const hz = sr / size;
        for (const [dt, wgt] of weights) {
          const mag = magnitudes(M, (t - dt) * sr, size);
          for (let i = 0; i < n; i++) {
            const f0 = min * Math.pow(max / min, i / n), f1 = min * Math.pow(max / min, (i + 1) / n);
            const a = Math.max(1, Math.floor(f0 / hz)), b = Math.max(a, Math.floor(f1 / hz));
            let m = 0; for (let k = a; k <= b && k < size / 2; k++) m = Math.max(m, mag[k]);
            const db = 20 * Math.log10(m + 1e-9);
            out[i] += wgt * Math.max(0, Math.min(1, (db + 72 + Math.log2(f0 / 100) * 2.5) / 66));
          }
        }
        return out;
      },
      wave(t, n, o = {}) {
        const span = o.span || 0.05, src = o.ch === 'L' ? L : o.ch === 'R' ? R : o.src || M;
        const out = new Float32Array(n), end = o.center ? (t + span / 2) * sr : t * sr, start = end - span * sr;
        for (let i = 0; i < n; i++) { const j = Math.floor(start + (i / (n - 1)) * (end - start)); out[i] = j >= 0 && j < src.length ? src[j] : 0; }
        return out;
      },
      stereo(t, n, span = 0.03) {
        return { l: A.wave(t, n, { span, ch: 'L' }), r: A.wave(t, n, { span, ch: 'R' }) };
      },
      lowpassed() {
        if (lp) return lp;
        lp = Float32Array.from(M);
        const k = 1 - Math.exp(-2 * Math.PI * 150 / sr);
        for (let pass = 0; pass < 2; pass++) { let y = 0; for (let i = 0; i < lp.length; i++) { y += k * (lp[i] - y); lp[i] = y; } }
        let mx = 0; for (let i = 0; i < lp.length; i += 4) mx = Math.max(mx, Math.abs(lp[i]));
        if (mx > 0) for (let i = 0; i < lp.length; i++) lp[i] /= mx;
        return lp;
      },
      pulse(t, kind = 'bass', decay = 0.18) {
        const list = onsets[kind] || onsets.bass;
        let lo = 0, hi = list.length - 1, idx = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
        let v = 0;
        for (let i = idx; i >= 0 && t - list[i].t < decay * 6; i--) v = Math.max(v, list[i].s * Math.exp(-(t - list[i].t) / decay));
        return Math.min(1, v);
      },
      beatPhase: (t) => { const x = (t - A.beatOffset) * A.bpm / 60; return x - Math.floor(x); },
      beatIndex: (t) => Math.floor((t - A.beatOffset) * A.bpm / 60),
      beatPulse: (t, decay = 0.12) => Math.exp(-(A.beatPhase(t) * 60 / A.bpm) / decay),
      lufs: {
        integrated, truePeak, lra,
        momentary: (t) => mom[Math.max(0, Math.min(nH - 1, Math.floor(t * 10)))],
        shortTerm: (t) => st[Math.max(0, Math.min(nH - 1, Math.floor(t * 10)))],
      },
      peaks(n, ch = 'M') {
        const key = n + ch;
        if (peaksCache[key]) return peaksCache[key];
        const src = ch === 'L' ? L : ch === 'R' ? R : M, min = new Float32Array(n), max = new Float32Array(n);
        const step = src.length / n;
        for (let i = 0; i < n; i++) {
          let lo = 0, hi = 0;
          const a = Math.floor(i * step), b = Math.min(src.length, Math.floor((i + 1) * step));
          for (let j = a; j < b; j += 2) { const v = src[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
          min[i] = lo; max[i] = hi;
        }
        return (peaksCache[key] = { min, max });
      },
      setTempo(newBpm, offset) {
        if (newBpm) A.bpm = newBpm;
        if (offset != null) A.beatOffset = offset;
      },
    };
    onProgress(1);
    return A;
  }

  window.Analysis = { analyze, FPS, BAND_NAMES };
})();
