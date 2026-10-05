// arcade — a rhythm-game highway: notes ride a perspective fretboard down to a hit
// line, where they flash as they cross. Lanes come from pitch (low → high) or parts.
(function () {
  const LANE_COLORS = ['#3fbf7a', '#d8432f', '#e2bd2c', '#3a78d4', '#b066e0', '#3fc6c6'];

  // all notes of the chosen source, each tagged with its lane
  function laneNotes(S) {
    const src = S.opt.source, n = Math.max(2, Math.min(6, +S.opt.lanes || 4));
    const parts = src === 'all' ? S.parts : S.parts.filter((p) => p.role === src);
    if (!parts.length) return { list: [], parts, lanes: n };
    const list = [];
    if (S.opt.mapping === 'parts' && src === 'all') {
      parts.forEach((p, i) => { for (const x of p.notes) list.push({ n: x, lane: i % n }); });
    } else {
      let lo = 127, hi = 0;
      for (const p of parts) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
      const span = Math.max(1, hi - lo + 1);
      for (const p of parts) for (const x of p.notes) list.push({ n: x, lane: Math.min(n - 1, Math.floor(((x.p - lo) / span) * n)) });
    }
    list.sort((a, b) => a.n.s - b.n.s || a.lane - b.lane);
    // stacked notes (same lane, same start) get a small index so they read as doubled capsules
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (b.lane === a.lane && Math.abs(b.n.s - a.n.s) < 0.02) b.stack = (a.stack || 0) + 1;
    }
    let maxLen = 0;
    for (const x of list) maxLen = Math.max(maxLen, x.n.e - x.n.s);
    return { list, parts, lanes: n, maxLen };
  }

  function geometry(S) {
    const { w, h, portrait } = S;
    const cx = w / 2;
    const yV = h * (portrait ? 0.105 : 0.06);         // vanishing point
    const yTop = h * (portrait ? 0.168 : 0.15);       // far end of the track
    const yHit = h * (portrait ? 0.862 : 0.82);
    const yBot = h * (portrait ? 0.945 : 0.93);
    const W0 = Math.min(w * 0.42, h * 0.62);          // half width at the hit line
    const halfW = (y) => W0 * (y - yV) / (yHit - yV);
    return { cx, yV, yTop, yHit, yBot, W0, halfW };
  }

  function drawLanes(g, S, G, n) {
    // lane lines (straight lines into the vanishing point)
    g.lineWidth = Math.max(1, S.unit * 0.0012);
    for (let i = 0; i <= n; i++) {
      const k = i / n - 0.5;
      g.strokeStyle = i === 0 || i === n ? 'rgba(170,180,190,0.42)' : 'rgba(170,180,190,0.3)';
      g.beginPath();
      g.moveTo(G.cx + k * 2 * G.halfW(G.yTop), G.yTop);
      g.lineTo(G.cx + k * 2 * G.halfW(G.yBot), G.yBot);
      g.stroke();
    }
    // bottom edge
    g.strokeStyle = 'rgba(170,180,190,0.25)';
    g.beginPath(); g.moveTo(G.cx - G.halfW(G.yBot), G.yBot); g.lineTo(G.cx + G.halfW(G.yBot), G.yBot); g.stroke();
  }

  Looks.register({
    id: 'arcade',
    name: 'arcade',
    group: 'midi',
    theme: 'dark',
    desc: 'rhythm-game highway: notes race down lanes to the hit line',
    defaults: { accent: '#d99a3c', bg: '#050607', lanes: 4, source: 'all', mapping: 'pitch', speed: 10, flash: true },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'lanes', label: 'Lanes', type: 'select', options: [3, 4, 5, 6] },
      { key: 'source', label: 'Notes from', type: 'select', options: ['all', 'bass', 'chords', 'lead'] },
      { key: 'mapping', label: 'Lane per', type: 'select', options: [{ value: 'pitch', label: 'pitch range' }, { value: 'parts', label: 'part' }] },
      { key: 'speed', label: 'Look-ahead (beats)', type: 'range', min: 4, max: 16, step: 1 },
      { key: 'flash', label: 'Hit flashes', type: 'toggle' },
    ],
    prepare(S) {
      const notes = laneNotes(S);
      const G = geometry(S), n = notes.lanes;
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = S.opt.bg; g.fillRect(0, 0, w, h);
        // faint haze behind the highway
        U.glowBlob(g, w / 2, G.yHit, G.W0 * 1.3, '#202830', 0.35);
        // hit-line glow band
        const band = S.unit * 0.05;
        const gr = g.createLinearGradient(0, G.yHit - band, 0, G.yHit + band);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.09)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(G.cx - G.halfW(G.yHit) - 10, G.yHit - band, G.halfW(G.yHit) * 2 + 20, band * 2);
      }, 0.25);
      // glow sprites (radial gradients are slow to fill per frame; blit small cached ones instead)
      const sprite = (col) => U.layer(128, 128, (g) => U.glowBlob(g, 64, 64, 64, col, 1));
      const glows = LANE_COLORS.map(sprite);
      glows.white = sprite('#ffffff');
      return { notes, G, bg, glows };
    },
    draw(g, S) {
      const { w, h, pad, unit, opt, cache } = S;
      const { G, notes } = cache;
      const n = notes.lanes;
      g.drawImage(cache.bg, 0, 0, w, h);
      drawLanes(g, S, G, n);

      // ---- header ----
      const ty = S.portrait ? h * 0.047 : pad + unit * 0.03;
      const title = String(S.meta.title || 'untitled').toLowerCase();
      U.text(g, title, pad, ty, { size: unit * 0.03, font: U.FONT.MONO, color: '#d8d8d8', spacing: unit * 0.016 });
      U.text(g, `${Math.round(S.bpm)} BPM`, w - pad, ty, { size: unit * 0.03, font: U.FONT.MONO, color: opt.accent, spacing: unit * 0.016, align: 'right' });
      const srcLabel = opt.source === 'all' ? 'mix' : opt.source;
      U.text(g, [srcLabel, `${n} LANES`, S.meta.key].filter(Boolean).join(' · '), pad, ty + unit * 0.04,
        { size: unit * 0.016, font: U.FONT.MONO, color: '#6a6d70', spacing: unit * 0.009 });
      U.text(g, S.timeLabel(2), w - pad, S.portrait ? h * 0.958 : h - pad * 0.6,
        { size: unit * 0.018, font: U.FONT.MONO, color: '#6a6d70', spacing: unit * 0.009, align: 'right' });

      // ---- depth mapping: time ahead (s) -> screen y ----
      const look = Math.max(2, opt.speed) * S.spb;
      const a = 0.5;                                     // mild foreshortening
      const yOf = (dt) => {
        if (dt <= 0) return G.yHit - (G.yHit - G.yTop) * (1 + a) * dt / look;
        const u = dt / look;
        return G.yHit - (G.yHit - G.yTop) * ((1 + a) * u) / (1 + a * u);
      };
      const below = (G.yBot - G.yHit) / ((G.yHit - G.yTop) * (1 + a)) * look; // seconds visible below the hit line
      const laneX = (lane, y) => G.cx + ((lane + 0.5) / n - 0.5) * 2 * G.halfW(y);
      const laneW = (y) => (2 * G.halfW(y)) / n;
      const scaleAt = (y) => (y - G.yV) / (G.yHit - G.yV);

      // ---- beat lines ----
      const origin = (S.A && S.A.beatOffset) || 0;
      const b0 = Math.ceil((S.t - below - origin) / S.spb), b1 = Math.floor((S.t + look - origin) / S.spb);
      g.lineWidth = Math.max(1, unit * 0.0011);
      for (let b = b0; b <= b1; b++) {
        const y = yOf(origin + b * S.spb - S.t);
        if (y < G.yTop || y > G.yBot) continue;
        const s = scaleAt(y);
        g.strokeStyle = `rgba(170,180,190,${(b % 4 === 0 ? 0.32 : 0.18) * (0.5 + 0.5 * Math.min(1, s))})`;
        g.beginPath(); g.moveTo(G.cx - G.halfW(y), y); g.lineTo(G.cx + G.halfW(y), y); g.stroke();
      }

      // ---- notes ----
      const list = notes.list;
      const capH = (y) => h * (S.portrait ? 0.021 : 0.03) * (0.14 + 0.86 * scaleAt(y));
      const hits = new Array(n).fill(0);
      if (list.length) {
        // binary search the first note that may still be on screen
        const tA = S.t - below - 0.3;
        let lo = 0, hi = list.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].n.s < tA) lo = m + 1; else hi = m; }
        for (let i = list.length - 1; i >= lo; i--) {
          const it = list[i], dt = it.n.s - S.t;
          if (dt > look) continue;
          if ((it.stack || 0) > 1) continue;
          const col = LANE_COLORS[it.lane % LANE_COLORS.length];
          if (dt <= 0 && dt > -0.35) hits[it.lane] = Math.max(hits[it.lane], (1 - -dt / 0.35) * (0.6 + 0.4 * it.n.v));
          let y = yOf(dt);
          const ch = capH(y);
          y -= (it.stack || 0) * ch * 0.55;
          if (y < G.yTop - ch || y > G.yBot + ch * 0.5) continue;
          const lw = laneW(y), cw = lw * 0.66, x = laneX(it.lane, y);
          const fadeFar = U.smooth(0, 0.25, scaleAt(y) - 0.07);
          const fadeNear = y > G.yHit ? 1 - U.smooth(G.yHit, G.yBot + ch, y) * 0.55 : 1;
          const alpha = fadeFar * fadeNear;
          if (alpha <= 0.01) continue;
          g.globalAlpha = alpha;
          // glow halo (cheap: a wider translucent capsule)
          U.rrect(g, x - cw / 2 - ch * 0.3, y - ch * 0.8, cw + ch * 0.6, ch * 1.6, ch * 0.8);
          g.fillStyle = U.rgba(col, 0.16); g.fill();
          U.rrect(g, x - cw / 2, y - ch / 2, cw, ch, ch / 2);
          g.fillStyle = col; g.fill();
          // specular streak
          g.fillStyle = 'rgba(255,255,255,0.18)';
          U.rrect(g, x - cw * 0.36, y - ch * 0.32, cw * 0.72, ch * 0.18, ch * 0.09); g.fill();
        }
        g.globalAlpha = 1;
      }

      // ---- hit line + targets ----
      const hw = G.halfW(G.yHit);
      g.fillStyle = 'rgba(235,235,235,0.9)';
      g.fillRect(G.cx - hw, G.yHit - unit * 0.0016, hw * 2, unit * 0.0032);
      const tch = capH(G.yHit) * 0.85, tlw = laneW(G.yHit) * 0.5;
      for (let i = 0; i < n; i++) {
        const col = LANE_COLORS[i % LANE_COLORS.length], x = laneX(i, G.yHit), k = opt.flash ? hits[i] : 0;
        if (k > 0) {
          const r1 = laneW(G.yHit) * (0.6 + 0.5 * k), r2 = laneW(G.yHit) * 0.3;
          g.globalAlpha = 0.55 * k; g.drawImage(cache.glows[i % LANE_COLORS.length], x - r1, G.yHit - r1, r1 * 2, r1 * 2);
          g.globalAlpha = 0.35 * k; g.drawImage(cache.glows.white, x - r2, G.yHit - r2, r2 * 2, r2 * 2);
          g.globalAlpha = 1;
        }
        U.rrect(g, x - tlw / 2, G.yHit - tch / 2, tlw, tch, tch / 2);
        g.fillStyle = k > 0 ? U.rgba(col, 0.25 + 0.5 * k) : 'rgba(5,6,7,0.85)';
        g.fill();
        g.lineWidth = Math.max(1.5, unit * 0.0022);
        g.strokeStyle = U.rgba(col, 0.75 + 0.25 * k); g.stroke();
      }

      // ---- empty state ----
      if (!list.length) {
        const p = S.A ? S.A.beatPulse(S.t, 0.25) : 0;
        U.text(g, opt.source === 'all' ? 'no notes yet · add midi' : `no ${opt.source} part`, w / 2, (G.yTop + G.yHit) / 2,
          { size: unit * 0.018, font: U.FONT.MONO, color: `rgba(170,180,190,${0.45 + 0.3 * p})`, spacing: unit * 0.008, align: 'center' });
      }
    },
  });
})();
