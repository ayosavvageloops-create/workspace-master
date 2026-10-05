// blob — soft metaballs in a mint-to-magenta gradient, each one tracked by a thin
// reticle. Ball sizes follow the bands; they drift on slow noise and merge when close.
// The field is evaluated per frame at reduced resolution into a reusable ImageData.
Looks.register({
  id: 'blob',
  name: 'blob',
  group: 'audio',
  theme: 'dark',
  desc: 'metaballs under tracking reticles',
  defaults: { accent: '#e052c4', top: '#a8f0c8', bg: '#05090b', count: 5, wobble: 1, reticles: true },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'top', label: 'Top colour', type: 'color' },
    { key: 'count', label: 'Blobs', type: 'range', min: 3, max: 6, step: 1 },
    { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 2, step: 0.05 },
    { key: 'reticles', label: 'Reticles', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, unit } = S;
    const SC = 0.32; // field resolution
    const fw = Math.ceil(w * SC), fh = Math.ceil(h * SC);
    const cv = document.createElement('canvas'); cv.width = fw; cv.height = fh;
    const cg = cv.getContext('2d');
    const img = cg.createImageData(fw, fh);
    // gradient LUT: top colour -> teal -> violet -> accent
    const stops = [[0, opt.top], [0.36, '#48d2bd'], [0.72, '#9466ee'], [1, opt.accent]];
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const k = i / 255;
      let j = 0; while (j < stops.length - 2 && k > stops[j + 1][0]) j++;
      const c = U.hexToRgb(U.mix(stops[j][1], stops[j + 1][1], U.clamp((k - stops[j][0]) / (stops[j + 1][0] - stops[j][0]))));
      lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
    }
    const glowRgb = U.hexToRgb('#2a8f8a');
    // static dither so the fills read slightly grainy, like the reference
    const dith = new Float32Array(fw * fh), r = U.rng(S.seed);
    for (let i = 0; i < dith.length; i++) dith[i] = (r() - 0.5) * 10;
    // ball layout in unit-relative coordinates around the composition centre
    const base = [
      { x: -0.15, y: -0.15, r: 0.06, band: 'high' },
      { x: 0.16, y: -0.01, r: 0.095, band: 'mid' },
      { x: -0.17, y: 0.1, r: 0.1, band: 'bass' },
      { x: -0.07, y: 0.22, r: 0.09, band: 'sub' },
      { x: 0.1, y: 0.14, r: 0.065, band: 'lowmid' },
      { x: 0.13, y: -0.2, r: 0.065, band: 'highmid' },
    ].map((b, i) => ({ ...b, ph: r() * 100, ax: 0.07 + r() * 0.05, ay: 0.06 + r() * 0.05, hp: [r() * 9, r() * 9, r() * 9] }));
    const bg = U.layer(w, h, (g) => {
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
      U.glowBlob(g, w / 2, h * 0.48, unit * 0.75, '#0f2226', 0.7);
      U.glowBlob(g, w / 2, h * 0.5, unit * 0.45, '#13292c', 0.5);
    }, 1);
    return { SC, fw, fh, cv, cg, img, lut, glowRgb, dith, base, bg, field: new Float32Array(fw * fh) };
  },
  draw(g, S) {
    const { w, h, A, opt, unit, cache: C } = S;
    g.drawImage(C.bg, 0, 0, w, h);
    const t = S.t;
    const cx0 = w / 2, cy0 = S.portrait ? Math.min(h * 0.5, h - unit * 0.62) : h * 0.47;
    const U2 = S.portrait ? Math.min(unit * 1.25, h * 0.68) : unit * 1.05;
    const yMax = S.portrait ? h - unit * 0.2 : h - S.pad * 0.9 - unit * 0.045; // above the handle strip
    const n = Math.round(opt.count);

    // balls at time t (pure function of t: drift on slow noise, size from bands)
    const balls = [];
    for (let i = 0; i < n; i++) {
      const b = C.base[i];
      // band level averaged over ~200 ms: sizes breathe with the music without twitching
      let e = 0;
      for (let k = 0; k < 6; k++) e += A.band(t - k * 0.04, b.band) / 6;
      const br = U2 * b.r * (0.72 + 0.5 * e), m = br * 1.45 + S.pad;
      balls.push({
        // drift on slow noise, kept inside the frame (reticles included)
        x: U.clamp(cx0 + U2 * (b.x * 1.15 + b.ax * U.vnoise(b.ph, t * 0.16)), m, w - m),
        y: U.clamp(cy0 + U2 * (b.y + b.ay * U.vnoise(b.ph + 31, t * 0.14)), m, yMax - br * 1.3),
        r: br,
        // wobble harmonics (2nd, 3rd, 4th), animated and pushed by level
        a2: opt.wobble * (0.06 + 0.1 * e) * U.vnoise(b.ph + 7, t * 0.5),
        a3: opt.wobble * (0.05 + 0.06 * e) * U.vnoise(b.ph + 9, t * 0.6),
        a4: opt.wobble * 0.03 * U.vnoise(b.ph + 13, t * 0.7),
        p2: b.hp[0] + t * 0.4, p3: b.hp[1] - t * 0.3, p4: b.hp[2] + t * 0.5,
      });
    }
    // satellite: a tiny drop below the cluster
    const sat = { x: cx0 + U2 * (0.03 + 0.03 * U.vnoise(5.5, t * 0.2)), y: Math.min(yMax - unit * 0.03, cy0 + U2 * (0.36 + 0.02 * U.vnoise(8.5, t * 0.2))),
      r: U2 * 0.02 * (0.8 + 0.4 * (0.5 * A.pulse(t, 'high', 0.25) + 0.5 * A.pulse(t - 0.05, 'high', 0.25))), a2: 0.1, a3: 0, a4: 0, p2: t, p3: 0, p4: 0 };
    balls.push(sat);
    for (const b of balls) {
      b.c2 = Math.cos(b.p2); b.s2 = Math.sin(b.p2); b.c3 = Math.cos(b.p3); b.s3 = Math.sin(b.p3); b.c4 = Math.cos(b.p4); b.s4 = Math.sin(b.p4);
    }

    // field evaluation into the low-res buffer, only inside the cluster's bounds
    const { SC, fw, fh, img, lut, glowRgb, dith } = C, d = img.data;
    d.fill(0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of balls) { const m = b.r * 2.4; x0 = Math.min(x0, b.x - m); y0 = Math.min(y0, b.y - m); x1 = Math.max(x1, b.x + m); y1 = Math.max(y1, b.y + m); }
    const ix0 = Math.max(0, Math.floor(x0 * SC)), ix1 = Math.min(fw - 1, Math.ceil(x1 * SC));
    const iy0 = Math.max(0, Math.floor(y0 * SC)), iy1 = Math.min(fh - 1, Math.ceil(y1 * SC));
    const gy0 = cy0 - U2 * 0.14, gspan = U2 * 0.52;
    const nb = balls.length;
    const bx = new Float32Array(nb), by = new Float32Array(nb);
    const ri2 = new Float32Array(nb), rmax2 = new Float32Array(nb), T = 0.2274;
    for (let k = 0; k < nb; k++) {
      bx[k] = balls[k].x * SC; by[k] = balls[k].y * SC;
      const ri = balls[k].r * SC * 1.6; ri2[k] = ri * ri; rmax2[k] = ri * ri * 1.6;
    }
    // splat each ball's compact kernel (1 - q)^3, q = d² / (1.6·r(θ))², into the field
    const F = C.field;
    for (let py = iy0; py <= iy1; py++) F.fill(0, py * fw + ix0, py * fw + ix1 + 1);
    for (let k = 0; k < nb; k++) {
      const b = balls[k], R = Math.sqrt(rmax2[k]);
      const qx0 = Math.max(ix0, Math.floor(bx[k] - R)), qx1 = Math.min(ix1, Math.ceil(bx[k] + R));
      const qy0 = Math.max(iy0, Math.floor(by[k] - R)), qy1 = Math.min(iy1, Math.ceil(by[k] + R));
      for (let py = qy0; py <= qy1; py++) {
        const dy = py - by[k], row = py * fw;
        for (let px = qx0; px <= qx1; px++) {
          const dx = px - bx[k], d2 = dx * dx + dy * dy;
          if (d2 >= rmax2[k]) continue;
          const dl = Math.sqrt(d2) + 1e-3, c = dx / dl, s = dy / dl;
          // cos(nθ - p) via Chebyshev identities
          const c2 = c * c - s * s, s2 = 2 * c * s;
          const c3 = c * (4 * c * c - 3), s3 = s * (3 - 4 * s * s);
          const c4 = c2 * c2 - s2 * s2, s4 = 2 * c2 * s2;
          const wob = 1 + b.a2 * (c2 * b.c2 + s2 * b.s2) + b.a3 * (c3 * b.c3 + s3 * b.s3) + b.a4 * (c4 * b.c4 + s4 * b.s4);
          const q = d2 / (ri2[k] * wob * wob);
          if (q < 1) { const u = 1 - q; F[row + px] += u * u * u; }
        }
      }
    }
    const invT = 1 / T;
    for (let py = iy0; py <= iy1; py++) {
      const gyy = py / SC - gy0;
      for (let px = ix0; px <= ix1; px++) {
        const i = py * fw + px, f = F[i] * invT;
        if (f < 0.12) continue;
        const o = i * 4;
        if (f >= 1) {
          const k = U.clamp((gyy - 0.35 * (px / SC - cx0)) / gspan) * 255 | 0;
          const a = f < 1.12 ? (f - 1) / 0.12 : 1, dz = dith[i];
          // inside: gradient colour; antialiased rim blends toward the glow
          d[o] = lut[k * 3] + dz; d[o + 1] = lut[k * 3 + 1] + dz; d[o + 2] = lut[k * 3 + 2] + dz;
          d[o + 3] = 60 + 195 * a;
        } else {
          const gl = (f - 0.12) / 0.88;
          d[o] = glowRgb[0]; d[o + 1] = glowRgb[1]; d[o + 2] = glowRgb[2]; d[o + 3] = 55 * gl * gl;
        }
      }
    }
    C.cg.clearRect(0, 0, fw, fh);
    if (ix1 >= ix0 && iy1 >= iy0) C.cg.putImageData(img, 0, 0, ix0, iy0, ix1 - ix0 + 1, iy1 - iy0 + 1);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    g.drawImage(C.cv, 0, 0, w, h);

    // reticles: thin circles with four ticks, one per ball
    if (opt.reticles) {
      g.lineWidth = Math.max(1, unit * 0.0012);
      g.strokeStyle = 'rgba(200,235,235,0.26)';
      g.beginPath();
      for (const b of balls) {
        if (b === sat) continue;
        const rr = b.r * 1.28, tk = unit * 0.012;
        g.moveTo(b.x + rr, b.y); g.arc(b.x, b.y, rr, 0, U.TAU);
        for (let q = 0; q < 4; q++) {
          const a = (q * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
          g.moveTo(b.x + ca * (rr - tk), b.y + sa * (rr - tk)); g.lineTo(b.x + ca * (rr + tk), b.y + sa * (rr + tk));
        }
      }
      g.stroke();
    }
  },
});
