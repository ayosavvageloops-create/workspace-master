// Visualisation modes. Each mode draws only its reactive element; background,
// cover art, text and progress are layered by the renderer (render.js).
//
// A mode is { id, name, coverLayout?, draw(g, s) } where `s` holds:
//   audio  – AudioEngine (bars(), wave, bass, mid, high, level, beat)
//   w, h   – canvas size;  cx, cy – centre;  unit – min(w, h)
//   opt    – user settings (colors, intensity, barCount, ...)
//   t      – seconds since start;  dt – frame delta in seconds
//   state  – per-mode scratch object that persists between frames
// `coverLayout: 'center'` makes the renderer draw the cover in the middle
// (scaled with the beat) instead of the default corner/side position.
(function () {
  const TAU = Math.PI * 2;

  function gradient(g, x0, y0, x1, y1, opt) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, opt.color1);
    gr.addColorStop(1, opt.color2);
    return gr;
  }

  function glow(g, opt, color) {
    g.shadowBlur = opt.glow ? 24 : 0;
    g.shadowColor = color || opt.color1;
  }

  function roundBar(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    g.fill();
  }

  const MODES = [
    {
      id: 'bars',
      name: 'Bars',
      draw(g, s) {
        const { w, h, opt } = s;
        const n = opt.barCount, v = s.audio.bars(n);
        const areaW = w * 0.86, x0 = (w - areaW) / 2, gap = areaW / n * 0.25, bw = areaW / n - gap;
        const base = h * 0.82, maxH = h * 0.42 * opt.intensity;
        g.fillStyle = gradient(g, 0, base, 0, base - maxH, opt);
        glow(g, opt);
        for (let i = 0; i < n; i++) {
          const bh = Math.max(4, v[i] * maxH);
          roundBar(g, x0 + i * (bw + gap), base - bh, bw, bh, bw / 2);
        }
      },
    },
    {
      id: 'mirror',
      name: 'Mirror Bars',
      draw(g, s) {
        const { w, h, cy, opt } = s;
        const n = opt.barCount, v = s.audio.bars(n);
        const areaW = w * 0.9, x0 = (w - areaW) / 2, gap = areaW / n * 0.3, bw = areaW / n - gap;
        const maxH = h * 0.3 * opt.intensity;
        g.fillStyle = gradient(g, 0, cy - maxH, 0, cy + maxH, opt);
        glow(g, opt);
        for (let i = 0; i < n; i++) {
          // Symmetric: lows in the middle, highs on both edges.
          const k = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
          const bh = Math.max(3, v[Math.floor(k * (n - 1))] * maxH);
          roundBar(g, x0 + i * (bw + gap), cy - bh, bw, bh * 2, bw / 2);
        }
      },
    },
    {
      id: 'circle',
      name: 'Circle Spectrum',
      coverLayout: 'center',
      draw(g, s) {
        const { cx, cy, unit, opt, audio } = s;
        const n = opt.barCount * 2, v = audio.bars(opt.barCount);
        const r = unit * (0.2 + audio.beat * 0.015 * opt.intensity);
        const maxL = unit * 0.15 * opt.intensity;
        g.lineCap = 'round';
        g.lineWidth = Math.max(2, (TAU * r / n) * 0.55);
        g.strokeStyle = gradient(g, cx - r, cy - r, cx + r, cy + r, opt);
        glow(g, opt);
        g.save();
        g.translate(cx, cy);
        g.rotate(s.t * 0.1);
        for (let i = 0; i < n; i++) {
          const k = i < n / 2 ? i : n - 1 - i; // mirror so the ring is seamless
          const len = 4 + v[k] * maxL;
          const a = (i / n) * TAU - Math.PI / 2;
          g.beginPath();
          g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          g.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len));
          g.stroke();
        }
        g.restore();
      },
    },
    {
      id: 'blob',
      name: 'Liquid Circle',
      coverLayout: 'center',
      draw(g, s) {
        const { cx, cy, unit, opt, audio } = s;
        const n = 96, v = audio.bars(48);
        const r = unit * 0.22;
        for (let layer = 2; layer >= 0; layer--) {
          g.beginPath();
          for (let i = 0; i <= n; i++) {
            const k = i % n, j = k < n / 2 ? k : n - 1 - k;
            const a = (k / n) * TAU - Math.PI / 2;
            const wob = Math.sin(a * 3 + s.t * (1.2 + layer * 0.4)) * 0.02;
            const rr = r * (1 + layer * 0.08 + wob) + v[j >> 1] * unit * 0.12 * opt.intensity * (1 - layer * 0.25);
            const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.closePath();
          g.globalAlpha = layer === 0 ? 0.95 : 0.35 - layer * 0.08;
          g.fillStyle = gradient(g, cx - r, cy - r, cx + r, cy + r, opt);
          glow(g, opt);
          g.fill();
        }
        g.globalAlpha = 1;
      },
    },
    {
      id: 'wave',
      name: 'Waveform',
      draw(g, s) {
        const { w, cy, h, opt, audio } = s;
        const data = audio.wave;
        if (!data) return;
        const amp = h * 0.28 * opt.intensity, step = data.length / 512;
        g.lineWidth = Math.max(2, h * 0.004);
        g.lineJoin = 'round';
        g.strokeStyle = gradient(g, 0, 0, w, 0, opt);
        glow(g, opt);
        for (const [off, alpha] of [[0, 1], [6, 0.35]]) {
          g.globalAlpha = alpha;
          g.beginPath();
          for (let i = 0; i < 512; i++) {
            const x = (i / 511) * w;
            const y = cy + off + ((data[Math.floor(i * step)] - 128) / 128) * amp;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.stroke();
        }
        g.globalAlpha = 1;
      },
    },
    {
      id: 'curve',
      name: 'Spectrum Curve',
      draw(g, s) {
        const { w, h, opt, audio } = s;
        const n = 64, v = audio.bars(n), base = h * 0.85, maxH = h * 0.5 * opt.intensity;
        const pts = Array.from(v, (val, i) => [(i / (n - 1)) * w, base - val * maxH]);
        g.beginPath();
        g.moveTo(0, base);
        g.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        g.lineTo(pts[n - 1][0], pts[n - 1][1]);
        g.lineTo(w, base);
        g.closePath();
        const gr = g.createLinearGradient(0, base - maxH, 0, base);
        gr.addColorStop(0, opt.color1);
        gr.addColorStop(1, 'transparent');
        g.fillStyle = gr;
        g.globalAlpha = 0.8;
        g.fill();
        g.globalAlpha = 1;
        g.lineWidth = Math.max(2, h * 0.004);
        g.strokeStyle = opt.color2;
        glow(g, opt, opt.color2);
        g.stroke();
      },
    },
    {
      id: 'particles',
      name: 'Particles',
      coverLayout: 'center',
      draw(g, s) {
        const { cx, cy, unit, opt, audio, state, dt } = s;
        const ps = state.ps || (state.ps = []);
        const spawn = Math.floor(2 + audio.level * 6 + (audio.beat > 0.95 ? 60 * opt.intensity : 0));
        for (let i = 0; i < spawn && ps.length < 1500; i++) {
          const a = Math.random() * TAU, sp = unit * (0.05 + Math.random() * 0.25) * (0.5 + audio.bass);
          ps.push({ x: cx + Math.cos(a) * unit * 0.2, y: cy + Math.sin(a) * unit * 0.2,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1,
                    r: unit * (0.002 + Math.random() * 0.005), c: Math.random() < 0.5 ? opt.color1 : opt.color2 });
        }
        glow(g, opt);
        const boost = 1 + audio.beat * 2 * opt.intensity;
        for (let i = ps.length - 1; i >= 0; i--) {
          const p = ps[i];
          p.x += p.vx * dt * boost;
          p.y += p.vy * dt * boost;
          p.life -= dt * 0.5;
          if (p.life <= 0) { ps.splice(i, 1); continue; }
          g.globalAlpha = p.life;
          g.fillStyle = p.c;
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, TAU);
          g.fill();
        }
        g.globalAlpha = 1;
      },
    },
    {
      id: 'rings',
      name: 'Pulse Rings',
      coverLayout: 'center',
      draw(g, s) {
        const { cx, cy, unit, opt, audio, state, dt } = s;
        const rings = state.rings || (state.rings = []);
        if (audio.beat > 0.95 && (!state.last || s.t - state.last > 0.15)) {
          rings.push({ r: unit * 0.2, a: 1 });
          state.last = s.t;
        }
        g.lineWidth = Math.max(2, unit * 0.006);
        glow(g, opt);
        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i];
          ring.r += unit * 0.35 * dt * opt.intensity;
          ring.a -= dt * 0.7;
          if (ring.a <= 0) { rings.splice(i, 1); continue; }
          g.globalAlpha = ring.a;
          g.strokeStyle = i % 2 ? opt.color2 : opt.color1;
          g.beginPath();
          g.arc(cx, cy, ring.r, 0, TAU);
          g.stroke();
        }
        g.globalAlpha = 0.9;
        g.strokeStyle = opt.color1;
        g.lineWidth = unit * 0.01 * (1 + audio.bass * 2);
        g.beginPath();
        g.arc(cx, cy, unit * (0.205 + audio.bass * 0.02), 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      },
    },
  ];

  window.MODES = MODES;
})();
