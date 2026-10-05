// afro-paper — stacked desktop windows on cream paper: a slim "listen" bar with a waveform
// strip, and a tall "current step" window framed in thick black holding an outlined piano roll.
(function () {
  function range(parts, span) {
    let lo = 127, hi = 0;
    for (const p of parts) for (const n of p.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
    if (lo > hi) { lo = 36; hi = 84; }
    lo -= 3; hi += 3;
    if (hi - lo < span) { const c = (lo + hi) / 2; lo = Math.floor(c - span / 2); hi = lo + span; }
    return [lo, hi];
  }
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
  function windowChrome(g, x, y, w, h, u) {
    const r = u * 0.014, tb = u * 0.048;
    g.save();
    g.shadowColor = 'rgba(90,60,20,0.16)'; g.shadowBlur = u * 0.045; g.shadowOffsetY = u * 0.012;
    U.rrect(g, x, y, w, h, r); g.fillStyle = '#f7f6f1'; g.fill();
    g.restore();
    g.save(); U.rrect(g, x, y, w, h, r); g.clip();
    g.fillStyle = '#ebeae4'; g.fillRect(x, y, w, tb);
    g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(x, y + tb, w, 1);
    g.restore();
    U.rrect(g, x + 0.5, y + 0.5, w - 1, h - 1, r); g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1; g.stroke();
    const cols = ['#ff5f57', '#febc2e', '#28c840'];
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x + tb * 0.5 + i * tb * 0.42, y + tb / 2, tb * 0.13, 0, U.TAU); g.fillStyle = cols[i]; g.fill(); }
    return tb;
  }
  const ROLE = { bass: '#c98a35', chords: '#8f9a37', lead: '#b8573a', other: '#7a7a7a', drums: '#7a7a7a' };

  function layout(S) {
    const { w, h, unit, portrait } = S;
    const x = portrait ? w * 0.055 : S.pad, ww = w - x * 2;
    const a = { x, y: portrait ? h * 0.03 : S.pad * 0.8, w: ww, h: portrait ? h * 0.092 : h * 0.15 };
    const by = a.y + a.h + unit * 0.016;
    const b = { x, y: by, w: ww, h: (portrait ? h * 0.8 : h - S.pad * 0.8) - by };
    return { a, b };
  }

  Looks.register({
    id: 'afro-paper',
    name: 'afro paper',
    group: 'midi',
    theme: 'light',
    desc: 'cream paper windows with an outlined piano roll in a thick black frame',
    defaults: { accent: '#b8781e', bg: '#f6f2e9', bars: 2, playhead: 0.3, blooms: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars in roll', type: 'select', options: [1, 2, 4] },
      { key: 'playhead', label: 'Playhead position', type: 'range', min: 0.1, max: 0.6, step: 0.05 },
      { key: 'blooms', label: 'Warm blooms', type: 'toggle' },
    ],
    prepare(S) {
      const L = layout(S), u = S.unit, opt = S.opt;
      const [lo, hi] = range(S.parts, 28);
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        if (!opt.blooms) return;
        U.glowBlob(g, w * 1.0, h * 0.25, w * 0.35, '#f7c98c', 0.5);
        U.glowBlob(g, 0, h * 0.5, w * 0.3, '#f5d4a4', 0.4);
        U.glowBlob(g, w * 0.2, h * 0.88, w * 0.45, '#efd9b3', 0.45);
        U.glowBlob(g, w * 0.85, h * 0.92, w * 0.4, '#f6dcbc', 0.4);
      }, 0.25);
      const tb = u * 0.048, fw = Math.max(6, u * 0.012);
      const fr = { x: L.b.x + u * 0.018, y: L.b.y + tb + u * 0.012, w: L.b.w - u * 0.036 };
      fr.h = L.b.y + L.b.h - u * 0.018 - fr.y;
      const strip = { x: L.a.x + u * 0.03, w: L.a.w - u * 0.06, h: L.a.h * (S.portrait ? 0.22 : 0.2) };
      strip.y = L.a.y + L.a.h - strip.h - L.a.h * 0.1;
      const chrome = U.layer(S.w, S.h, (g) => {
        windowChrome(g, L.a.x, L.a.y, L.a.w, L.a.h, u);
        windowChrome(g, L.b.x, L.b.y, L.b.w, L.b.h, u);
        // thick black frame + paper inside
        U.rrect(g, fr.x, fr.y, fr.w, fr.h, u * 0.014); g.fillStyle = '#1b1b1b'; g.fill();
        U.rrect(g, fr.x + fw, fr.y + fw, fr.w - fw * 2, fr.h - fw * 2, u * 0.006); g.fillStyle = '#f3f2ec'; g.fill();
        U.rrect(g, strip.x, strip.y, strip.w, strip.h, strip.h / 2); g.fillStyle = '#222224'; g.fill();
      });
      const N = Math.max(60, Math.round(strip.w / Math.max(2.5, u * 0.004)));
      return { L, lo, hi, bg, chrome, tb, fr, fw, strip, peaks: clipPeaks(S, N) };
    },
    draw(g, S) {
      const { opt, parts, unit: u } = S;
      const C = S.cache, L = C.L, ochre = opt.accent, mono = U.FONT.PLEX;
      g.drawImage(C.bg, 0, 0, S.w, S.h);
      g.drawImage(C.chrome, 0, 0, S.w, S.h);
      const tbx = (W) => W.x + C.tb * 1.85;
      U.text(g, 'listen', tbx(L.a), L.a.y + C.tb * 0.64, { size: u * 0.02, font: mono, color: '#77756f' });
      const csw = U.text(g, 'current step', tbx(L.b), L.b.y + C.tb * 0.64, { size: u * 0.02, font: mono, color: '#77756f' });
      // part indicators in the title bar: small rings, filled while the part sounds
      let ix = tbx(L.b) + csw + u * 0.03;
      for (const p of S.allParts) {
        const col = ROLE[p.role] || ROLE.other, on = p.enabled && Parts.active(p, S.t).length > 0, seen = p.enabled && p.notes.some((n) => n.s <= S.t);
        g.beginPath(); g.arc(ix, L.b.y + C.tb / 2, u * 0.0065, 0, U.TAU);
        if (on) { g.fillStyle = U.rgba(col, 0.35); g.fill(); }
        g.lineWidth = 2; g.strokeStyle = U.rgba(col, seen ? 1 : 0.3); g.stroke();
        ix += u * 0.055;
      }

      // listen bar
      const ty = L.a.y + C.tb + (C.strip.y - L.a.y - C.tb) * 0.68;
      U.text(g, S.meta.title || 'untitled', L.a.x + u * 0.03, ty, { size: u * 0.036, font: mono, weight: 700, color: ochre });
      U.text(g, `${Math.round(S.bpm)} bpm${S.meta.key ? ' · ' + S.meta.key : ''}`, L.a.x + L.a.w - u * 0.03, ty, { size: u * 0.019, font: mono, color: '#6d6b66', align: 'right' });
      const st = C.strip, pk = C.peaks, N = pk.length;
      const sx = st.x + st.h * 0.6, sw = st.w - st.h * 1.2, cy = st.y + st.h / 2, amp = st.h * 0.36, bw = sw / N, cut = S.prog * N;
      for (let i = 0; i < N; i++) {
        const v = Math.max(0.06, pk[i]) * amp;
        g.fillStyle = i < cut ? '#bdbcb7' : '#5e5e62';
        g.fillRect(sx + i * bw, cy - v, Math.max(1, bw * 0.7), v * 2);
      }
      g.fillStyle = ochre; g.fillRect(sx + S.prog * sw - 1, st.y + st.h * 0.12, 2.5, st.h * 0.76);

      // roll
      const fr = C.fr, fw = C.fw;
      const x0 = fr.x + fw, x1 = fr.x + fr.w - fw, y0 = fr.y + fw, y1 = fr.y + fr.h - fw;
      const { lo, hi } = C, rows = hi - lo + 1, rowH = (y1 - y0) / rows;
      const win = S.bar * opt.bars, phx = x0 + (x1 - x0) * opt.playhead;
      const tx = (tt) => phx + ((tt - S.t) / win) * (x1 - x0);
      const t0 = S.t - win * opt.playhead, t1 = S.t + win * (1 - opt.playhead);
      g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
      const nh = Math.max(6, Math.min(rowH * 0.75, u * 0.016));
      for (const p of parts) {
        const col = ROLE[p.role] || ROLE.other;
        for (const n of Parts.inRange(p, t0, t1)) {
          const xa = tx(n.s) + 1, xb = tx(n.e) - 3, y = y1 - (n.p - lo + 0.5) * rowH - nh / 2;
          const playing = n.s <= S.t && n.e > S.t, past = n.e <= S.t;
          U.rrect(g, xa, y, Math.max(nh, xb - xa), nh, nh / 2);
          g.fillStyle = U.rgba(col, playing ? 0.32 : past ? 0.14 : 0.08); g.fill();
          g.lineWidth = playing ? 3.5 : 2.5;
          g.strokeStyle = U.rgba(U.mix(col, '#2a2410', playing ? 0.25 : 0), playing ? 1 : past ? 0.95 : 0.7);
          g.stroke();
        }
      }
      g.restore();
      if (!parts.length) {
        U.text(g, 'no notes yet', (x0 + x1) / 2, (y0 + y1) / 2, { size: u * 0.026, font: mono, color: '#9a978f', align: 'center' });
        U.text(g, 'drop a midi file to fill the roll', (x0 + x1) / 2, (y0 + y1) / 2 + u * 0.035, { size: u * 0.017, font: mono, color: '#b3b0a8', align: 'center' });
      }
      // grey playhead with a soft shadow
      const gr = g.createLinearGradient(phx - u * 0.012, 0, phx + u * 0.012, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(phx - u * 0.012, y0, u * 0.024, y1 - y0);
      g.fillStyle = '#8a8984'; g.fillRect(phx - 1.25, y0, 2.5, y1 - y0);
    },
  });
})();
