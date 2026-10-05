// monitor — a DAW window floating in a dark room: the clip's waveform overview and a band
// spectrogram on a slightly tilted screen, soft light from above, a slow camera drift.
(function () {
  const STRIPS = 36;

  function paintWindow(g, W, H, S, opt) {
    const { A } = S;
    const k = W / 1000;
    // frame
    U.rrect(g, 0, 0, W, H, 9 * k); g.fillStyle = '#26292d'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 2 * k; g.stroke();
    // title bar
    g.fillStyle = '#2f3237'; g.fillRect(4 * k, 4 * k, W - 8 * k, 34 * k);
    ['#d9655b', '#d9b14e', '#6db35a'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc((22 + i * 18) * k, 21 * k, 5 * k, 0, U.TAU); g.fill(); });
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (const [x, ww] of [[110, 40], [190, 55], [270, 34], [330, 48], [400, 36], [470, 60], [560, 44]]) { U.rrect(g, x * k, 17 * k, ww * k, 7 * k, 3 * k); g.fill(); }
    // toolbar
    g.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < 16; i++) g.fillRect((20 + i * 38) * k, 50 * k, 22 * k, 13 * k);
    const cx0 = 18 * k, cx1 = W - 18 * k, cw = cx1 - cx0;
    // waveform lane
    const wy0 = 78 * k, wy1 = H * 0.55;
    g.fillStyle = '#1b1f22'; g.fillRect(cx0, wy0, cw, wy1 - wy0);
    const N = Math.round(cw / 3.2), sr = A.sr, src = A.M, wcy = (wy0 + wy1) / 2, wamp = (wy1 - wy0) * 0.47;
    let top = 0; const vals = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.floor((S.clipStart + (i / N) * S.clipLen) * sr), b = Math.floor((S.clipStart + ((i + 1) / N) * S.clipLen) * sr);
      let p = 0; for (let j = Math.max(0, a); j < Math.min(src.length, b); j += 4) { const v = Math.abs(src[j]); if (v > p) p = v; }
      vals[i] = p; top = Math.max(top, p);
    }
    g.fillStyle = U.rgba(opt.accent, 0.9);
    const bw = cw / N;
    for (let i = 0; i < N; i++) {
      const v = Math.pow(vals[i] / (top || 1), 0.6) * (0.75 + 0.25 * U.hash(i, 9)), hh = Math.max(1, v * wamp);
      g.fillRect(Math.round(cx0 + i * bw), wcy - hh, Math.max(1, Math.round(bw * 0.4)), hh * 2);
    }
    // gap lane
    const gy0 = wy1, gy1 = H * 0.6;
    const gr = g.createLinearGradient(0, gy0, 0, gy1); gr.addColorStop(0, '#202428'); gr.addColorStop(1, '#2b3a44');
    g.fillStyle = gr; g.fillRect(cx0, gy0, cw, gy1 - gy0);
    // spectrogram grid
    const sy0 = gy1, sy1 = H * 0.915, cols = 64, rows = 10;
    const chh = (sy1 - sy0) / rows, cww = cw / cols;
    const ramp = (v) => (v < 0.4 ? U.mix('#182838', '#24485e', v / 0.4) : v < 0.84 ? U.mix('#24485e', '#3a7891', (v - 0.4) / 0.44) : U.mix('#3a7891', opt.hot, Math.min(1, (v - 0.84) / 0.1)));
    for (let c = 0; c < cols; c++) {
      const tt = S.clipStart + ((c + 0.5) / cols) * S.clipLen, b = A.bands12(tt);
      for (let r = 0; r < rows; r++) {
        const bi = Math.min(11, Math.floor(((rows - 1 - r) / rows) * 12));
        const v = U.clamp(b[bi] * (0.75 + 0.35 * U.hash(c, r, 4)) - 0.08);
        g.fillStyle = ramp(v); g.fillRect(cx0 + c * cww, sy0 + r * chh, cww + 0.5, chh + 0.5);
      }
    }
    // status bar
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 6; i++) g.fillRect((20 + i * 26) * k, H - 26 * k, 16 * k, 10 * k);
    // screen glare + light from above
    const gl = g.createLinearGradient(0, 0, W * 0.6, H);
    gl.addColorStop(0, 'rgba(255,255,255,0.09)'); gl.addColorStop(0.45, 'rgba(255,255,255,0.025)'); gl.addColorStop(0.46, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(0, 0, W, H);
    const tl = g.createLinearGradient(0, 0, 0, H * 0.25); tl.addColorStop(0, 'rgba(255,255,255,0.08)'); tl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = tl; g.fillRect(0, 0, W, H * 0.25);
    return { cx0: cx0 / W, cx1: cx1 / W, py0: wy0 / H, py1: sy1 / H };
  }

  Looks.register({
    id: 'monitor',
    name: 'monitor',
    group: 'audio',
    theme: 'dark',
    desc: 'a DAW window floating in a dark room',
    defaults: { accent: '#6cc7ab', bg: '#08090b', hot: '#e3dc9c', drift: 1, tilt: 1, grain: false },
    controls: [
      { key: 'bg', label: 'Room', type: 'color' },
      { key: 'hot', label: 'Spectrogram peak', type: 'color' },
      { key: 'drift', label: 'Camera drift', type: 'range', min: 0, max: 3, step: 0.1 },
      { key: 'tilt', label: 'Tilt', type: 'range', min: 0, max: 3, step: 0.1 },
      { key: 'grain', label: 'Film grain (slower)', type: 'toggle' },
    ],
    prepare(S) {
      const { w, h, opt, unit } = S;
      const W = Math.round(S.portrait ? w * 0.97 : Math.min(w * 0.7, (h * 0.8) / 0.86)), H = Math.round(W * 0.86);
      let geo;
      const art = U.layer(W, H, (g) => { geo = paintWindow(g, W, H, S, opt); });
      // fixed perspective (slight yaw, pitch and roll); the camera drift is a cheap 2D move per frame
      const tl = opt.tilt, yaw = -0.06 * tl, pitch = 0.045 * tl, roll = -0.018 * tl, D = W * 2.2;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const proj = (u, v) => {
        const X = (u - 0.5) * W, Y = (v - 0.5) * H;
        const x1 = X * cy, z1 = X * sy;
        const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
        const f = D / (D + z2), px = x1 * f, py = y2 * f;
        return [px * cr - py * sr, px * sr + py * cr];
      };
      const m = Math.round(unit * 0.06), BW = W + m * 2, BH = H + m * 2;
      const win = U.layer(BW, BH, (g) => {
        g.translate(BW / 2, BH / 2);
        const c0 = proj(0, 0), c1 = proj(1, 0), c2 = proj(1, 1), c3 = proj(0, 1);
        // soft shadow
        g.save(); g.filter = `blur(${Math.round(unit * 0.015)}px)`; g.fillStyle = 'rgba(0,0,0,0.6)';
        g.beginPath(); g.moveTo(c0[0], c0[1] + 8); g.lineTo(c1[0], c1[1] + 8); g.lineTo(c2[0] + 8, c2[1] + 26); g.lineTo(c3[0] - 8, c3[1] + 26); g.closePath(); g.fill();
        g.restore();
        for (let i = 0; i < STRIPS; i++) {
          const u0 = i / STRIPS, u1 = (i + 1) / STRIPS;
          const TL = proj(u0, 0), TR = proj(u1, 0), BL = proj(u0, 1);
          g.save();
          g.transform(TR[0] - TL[0], TR[1] - TL[1], BL[0] - TL[0], BL[1] - TL[1], TL[0], TL[1]);
          const sx = u0 * art.width, sw = (u1 - u0) * art.width, last = i === STRIPS - 1;
          g.drawImage(art, sx, 0, last ? sw : Math.min(art.width - sx, sw * 1.05), art.height, 0, 0, last ? 1 : 1.05, 1);
          g.restore();
        }
        // light from above catching the top edge
        g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.stroke();
      });
      const room = U.layer(w, h, (g) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        g.save(); g.translate(w * 0.5, -h * 0.05); g.scale(1, 2.2);
        U.glowBlob(g, 0, 0, Math.max(w, h) * 0.45, '#9aa3ad', 0.16);
        g.restore();
        U.glowBlob(g, w * 0.55, h * 0.12, w * 0.5, '#7f8a96', 0.07);
        const v = g.createRadialGradient(w / 2, h * 0.45, unit * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.75);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
        g.fillStyle = v; g.fillRect(0, 0, w, h);
      });
      const r = U.rng(S.seed);
      const dust = Array.from({ length: 50 }, () => ({ x: r(), y: r() * 0.9, s: 0.5 + r() * 1.5, a: 0.05 + r() * 0.15, v: 0.002 + r() * 0.006 }));
      return { win, room, geo, dust, proj, BW, BH };
    },
    draw(g, S) {
      const { w, h, opt, A, t } = S;
      const C = S.cache;
      g.drawImage(C.room, 0, 0);
      for (const d of C.dust) {
        const y = U.fract(d.y + t * d.v) * h, x = (d.x + 0.01 * Math.sin(t * 0.3 + d.y * 9)) * w;
        g.fillStyle = `rgba(200,210,220,${d.a})`; g.fillRect(x, y, d.s, d.s);
      }
      // camera drift: slow float and dolly
      const dr = opt.drift;
      const ox = w * 0.5 + w * 0.01 * dr * Math.sin(t * 0.09), oy = h * (S.portrait ? 0.49 : 0.5) + h * 0.008 * dr * Math.sin(t * 0.07 + 1);
      const sc = 1 + 0.02 * dr * Math.sin(t * 0.05 + 0.4);
      g.save();
      g.translate(ox, oy); g.scale(sc, sc);
      g.drawImage(C.win, -C.BW / 2, -C.BH / 2);
      const G = C.geo, u = G.cx0 + (G.cx1 - G.cx0) * S.prog;
      const p0 = C.proj(u, G.py0), p1 = C.proj(u, G.py1);
      const lv = A.level(S.t);
      g.strokeStyle = U.rgba(opt.accent, 0.1 + 0.2 * lv); g.lineWidth = S.unit * 0.012;
      g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      g.strokeStyle = 'rgba(235,240,240,0.85)'; g.lineWidth = Math.max(1.2, S.unit * 0.0016);
      g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      g.restore();
      if (opt.grain) U.grain(g, w, h, 0.05, S.frame, true);
    },
  });
})();
