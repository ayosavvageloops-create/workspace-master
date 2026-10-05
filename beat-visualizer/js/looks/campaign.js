(function () {
// content column is laid out in local units 1000 wide; this maps it onto the canvas
function layout(S) {
  // fit either the stacked print layout (1000 × 1600 local units) or the two-column one
  // (2070 × 920) into the area above the handle-safe strip, whichever ends up larger
  const { w, h, pad, unit } = S, gap = 70;
  const top = pad * 0.8, bot = (S.portrait ? h - unit * 0.16 : h - pad * 0.9) - unit * 0.045;
  const avW = w - pad * 2, avH = bot - top;
  const cwP = Math.min(w * 0.72, avH / 1.6, avW), cwL = Math.min(avH / 0.92, avW / 2.07);
  if (cwP >= cwL * 0.95) return { cw: cwP, gap, ox: (w - cwP) / 2, oy: top + (avH - cwP * 1.58) / 2 + cwP * 0.02, cardDx: 0, cardDy: 0 };
  return { cw: cwL, gap, ox: (w - cwL * (2 + gap / 1000)) / 2, oy: top + (avH - cwL * 0.9) / 2 + cwL * 0.03, cardDx: 1000 + gap, cardDy: 72 - 921 };
}
// campaign — the beat presented as a release: a print layout with a 12" sleeve, a spinning
// record, three crops (spectrum / flat / halftone), the inner tracklist and the back credits.
Looks.register({
  id: 'campaign',
  name: 'campaign',
  group: 'audio',
  theme: 'light',
  desc: 'the beat as a release: sleeve, record, crops and credits',
  defaults: {
    accent: '#5a40a0', bg: '#ffffff', label: '#e2492b',
    album: 'leftovers',
    tracks: 'harbour, slow tide w/ mirel, paper moon, static, aside, juniper, low sun, soft focus, twelve',
    catalogue: '',
  },
  controls: [
    { key: 'bg', label: 'Paper', type: 'color' },
    { key: 'label', label: 'Label / flat', type: 'color' },
    { key: 'album', label: 'Album name', type: 'text' },
    { key: 'tracks', label: 'Tracklist (comma separated)', type: 'text' },
    { key: 'catalogue', label: 'Catalogue code', type: 'text' },
  ],
  prepare(S) {
    const { opt } = S;
    const title = String(S.meta.title || 'untitled');
    const cat = (opt.catalogue || '').trim() ||
      `${(title.replace(/[^a-z0-9]/gi, '').slice(0, 3) || 'REC').toUpperCase()}-0${10 + (S.seed % 90)}`;
    // tracklist: the title is the highlighted track (inserted as the 7th unless already listed)
    let tracks = String(opt.tracks || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    let cur = tracks.findIndex((s) => s.toLowerCase() === title.toLowerCase());
    if (cur < 0) { cur = Math.min(6, tracks.length); tracks.splice(cur, 0, title); tracks = tracks.slice(0, 12); cur = Math.min(cur, tracks.length - 1); }
    // record sprite (grooves + label + text), rotated per frame; sized to its on-screen pixels
    const R = Math.max(64, Math.round(216 * layout(S).cw / 1000));
    const rec = U.layer(R * 2, R * 2, (g) => {
      g.translate(R, R);
      g.fillStyle = '#0f2422'; g.beginPath(); g.arc(0, 0, R, 0, U.TAU); g.fill();
      const gs = Math.max(1.6, R / 160);
      for (let r = R * 0.97; r > R * 0.5; r -= gs) {
        const k = U.hash(Math.round(r), 3);
        g.strokeStyle = k > 0.8 ? 'rgba(80,140,128,0.55)' : k > 0.45 ? 'rgba(40,90,82,0.6)' : 'rgba(10,26,24,0.6)';
        g.lineWidth = gs * 0.5; g.beginPath(); g.arc(0, 0, r, 0, U.TAU); g.stroke();
      }
      // band gaps between tracks
      for (const r of [0.86, 0.74, 0.62]) { g.strokeStyle = '#0a1716'; g.lineWidth = gs * 1.6; g.beginPath(); g.arc(0, 0, R * r, 0, U.TAU); g.stroke(); }
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = gs; g.beginPath(); g.arc(0, 0, R - 3, 0, U.TAU); g.stroke();
      g.fillStyle = opt.label; g.beginPath(); g.arc(0, 0, R * 0.48, 0, U.TAU); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(0, 0, R * 0.035, 0, U.TAU); g.fill();
      U.text(g, `${cat} · A`, 0, R * 0.2, { size: R * 0.15, font: U.FONT.SANS, weight: 500, color: '#1a0d0a', align: 'center', max: R * 0.8 });
      U.text(g, 'SIDE A · 33⅓', 0, -R * 0.24, { size: R * 0.055, font: U.FONT.SANS, weight: 600, color: 'rgba(26,13,10,0.6)', align: 'center', spacing: R * 0.006 });
    });
    // static sheen over the grooves
    const sheen = U.layer(R * 2, R * 2, (g) => {
      if (!g.createConicGradient) return;
      const cg = g.createConicGradient(-0.6, R, R);
      cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(0.08, 'rgba(160,220,205,0.14)'); cg.addColorStop(0.16, 'rgba(255,255,255,0)');
      cg.addColorStop(0.5, 'rgba(255,255,255,0)'); cg.addColorStop(0.58, 'rgba(160,220,205,0.1)'); cg.addColorStop(0.66, 'rgba(255,255,255,0)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(R, R, R, 0, U.TAU); g.arc(R, R, R * 0.49, 0, U.TAU, true); g.fill();
    });
    // barcode widths from the catalogue string
    const bars = [];
    const rr = U.rng(U.strSeed(cat));
    for (let i = 0; i < 46; i++) bars.push(1 + Math.floor(rr() * 3), 1 + Math.floor(rr() * 2));
    return { cat, tracks, cur, rec, sheen, bars };
  },
  draw(g, S) {
    const { w, h, pad, A, opt } = S;
    const C = S.cache, title = String(S.meta.title || 'untitled');
    g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

    // layout in local units: the content column is 1000 wide
    const { cw, ox, oy, cardDx, cardDy, gap } = layout(S);
    const s = cw / 1000, px = 1 / s;
    g.save(); g.translate(ox, oy); g.scale(s, s);
    const ink = '#141414', grey = '#8a8a86';
    const cap = (str, x, y) => U.text(g, str, x, y, { size: 15, font: U.FONT.SANS, weight: 500, color: grey, spacing: 2.2 });

    // header
    const hx = cardDx ? 2000 + gap : 1000;
    const subW = U.text(g, S.sub, hx, 30, { size: 30, font: U.FONT.SANS, color: grey, align: 'right', max: hx * 0.4 });
    U.text(g, `"${title.toUpperCase()}"`, 0, 30, { size: 36, font: U.FONT.SANS, weight: 700, color: ink, spacing: 2, max: hx - subW - 40 });
    g.fillStyle = 'rgba(20,20,20,0.35)'; g.fillRect(0, 54, hx, px);

    // ---- sleeve ----
    const sx = 0, sy = 72, ss = 546;
    g.fillStyle = opt.accent; g.fillRect(sx, sy, ss, ss);
    g.save(); g.beginPath(); g.rect(sx, sy, ss, ss); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 1.6 * px;
    const acx = sx + ss * 0.93, acy = sy + ss * 0.33;
    for (let i = 1; i <= 7; i++) { g.beginPath(); g.arc(acx, acy, ss * 0.14 * i, 0, U.TAU); g.stroke(); }
    // playhead sweep across the sleeve with the clip
    const phx = sx + ss * (0.04 + 0.92 * S.prog);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(phx - 10, sy, 1.5 * px, ss);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(phx, sy, 2 * px, ss);
    U.text(g, opt.album || 'untitled', sx + 34, sy + ss * 0.84, { size: 104, font: U.FONT.SERIF, color: '#fff', spacing: -3, max: ss - 70 });
    U.text(g, 'SIDE A', sx + 36, sy + ss * 0.95, { size: 17, font: U.FONT.SANS, weight: 700, color: '#fff', spacing: 2 });
    g.restore();
    cap('12" SLEEVE · 1/1', 0, 643);

    // ---- record ----
    const rcx = 787, rcy = 309, rr = 216;
    g.save(); g.translate(rcx, rcy); g.rotate((S.t * 0.555) * U.TAU);
    g.drawImage(C.rec, -rr, -rr, rr * 2, rr * 2);
    g.restore();
    g.drawImage(C.sheen, rcx - rr, rcy - rr, rr * 2, rr * 2);
    // tonearm
    const pvx = rcx + rr * 1.0, pvy = rcy - rr * 1.05, sxx = rcx + rr * 0.72, syy = rcy - rr * 0.5;
    g.strokeStyle = '#d6d6d2'; g.lineWidth = 3 * px; g.lineCap = 'round';
    g.beginPath(); g.moveTo(pvx, pvy); g.lineTo(sxx, syy); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sxx, syy, 6, 0, U.TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = px; g.stroke();
    cap('LABEL A/B', 574, 515);

    // ---- crops ----
    const cy0 = 677, ch = 189;
    // spectrum
    {
      const x0 = 0, x1 = 320;
      g.fillStyle = '#0b0b0a'; g.fillRect(x0, cy0, x1 - x0, ch);
      const n = 34, sp = A.spectrum(S.t, n, { min: 40, max: 12000, smooth: false, size: 2048 }), bw = (x1 - x0 - 16) / n;
      for (let i = 0; i < n; i++) {
        const v = Math.pow(sp[i], 1.1), bh = Math.max(4, v * ch * 0.95);
        const x = x0 + 8 + i * bw;
        g.fillStyle = '#b8780f'; g.fillRect(x, cy0 + ch - bh, bw * 0.62, bh);
        g.fillStyle = '#f0b03a'; g.fillRect(x, cy0 + ch - bh, bw * 0.62, Math.min(bh, 5));
      }
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x0 + (x1 - x0) * (0.12 + 0.76 * S.prog), cy0, 1.5 * px, ch);
    }
    // flat
    {
      const x0 = 340, x1 = 656;
      g.fillStyle = opt.label; g.fillRect(x0, cy0, x1 - x0, ch);
      U.text(g, title, (x0 + x1) / 2, cy0 + ch * 0.6, { size: 64, font: U.FONT.SERIF, color: '#2a0c06', align: 'center', max: x1 - x0 - 36 });
    }
    // halftone: diagonal bands of dot sizes, slowly drifting with the beat
    {
      const x0 = 680, x1 = 1000, step = 12.5;
      g.fillStyle = '#fbfbf9'; g.fillRect(x0, cy0, x1 - x0, ch);
      g.save(); g.beginPath(); g.rect(x0, cy0, x1 - x0, ch); g.clip();
      g.fillStyle = '#111';
      const ph = S.t * 0.35 + A.level(S.t) * 0.3;
      g.beginPath();
      for (let yy = cy0 + step / 2; yy < cy0 + ch; yy += step) {
        for (let xx = x0 + step / 2; xx < x1; xx += step) {
          const u = (xx - x0 - (yy - cy0)) / 150 + ph;
          const k = 0.5 + 0.5 * Math.sin(u * U.TAU);
          const r = 0.9 + k * k * 4.6;
          g.moveTo(xx + r, yy); g.arc(xx, yy, r, 0, U.TAU);
        }
      }
      g.fill();
      g.restore();
    }
    cap('CROPS · SPECTRUM / FLAT / HALFTONE', 0, 890);

    // ---- cards ----
    g.save(); g.translate(cardDx, cardDy);
    const ky = 921, kh = 629;
    // inner: tracklist
    {
      const x0 = 0, x1 = 495;
      g.fillStyle = '#f0f0ec'; g.fillRect(x0, ky, x1 - x0, kh);
      U.text(g, `SIDE A · ${(opt.album || '').toUpperCase()}`, x0 + 30, ky + 46, { size: 17, font: U.FONT.SANS, weight: 700, color: ink, spacing: 2, max: x1 - x0 - 60 });
      const n = C.tracks.length, lh = Math.min(44, 470 / Math.max(1, n));
      C.tracks.forEach((name, i) => {
        const y = ky + 100 + i * lh, on = i === C.cur;
        const txt = `A${i + 1}.  ${name}`;
        const tw = U.text(g, txt, x0 + 30, y, { size: Math.min(33, lh * 0.8), font: U.FONT.SANS, weight: on ? 700 : 400, color: ink, max: x1 - x0 - 50 });
        if (on) {
          g.fillStyle = opt.label; g.beginPath(); g.arc(x0 + 16, y - 10, 5, 0, U.TAU); g.fill();
          // the underline fills with the clip's progress
          g.fillStyle = 'rgba(20,20,20,0.25)'; g.fillRect(x0 + 30, y + 9, x1 - 70, px * 1.2);
          g.fillStyle = opt.label; g.fillRect(x0 + 30, y + 8, Math.max(tw * 0.4, (x1 - 70) * S.prog), 3);
        }
      });
      U.text(g, `${C.cat}-A  ·  MATRIX`, x0 + 30, ky + kh - 22, { size: 14, font: U.FONT.SANS, weight: 500, color: grey, spacing: 2, max: x1 - x0 - 60 });
    }
    // back: credits
    {
      const x0 = 515, x1 = 1000;
      g.fillStyle = '#141416'; g.fillRect(x0, ky, x1 - x0, kh);
      const L = A.lufs, gain = -14 - L.integrated, tp = Math.min(-1, L.truePeak + gain);
      const ln = { size: 21, font: U.FONT.SANS, color: '#c9c9c6', max: x1 - x0 - 52 };
      U.text(g, S.sub, x0 + 26, ky + 40, ln);
      U.text(g, 'Loudness −14.0 LUFS', x0 + 26, ky + 72, ln);
      U.text(g, `True peak ${tp.toFixed(1).replace('-', '−')} dBTP`, x0 + 26, ky + 104, ln);
      U.text(g, C.cat, x0 + 26, ky + 152, { size: 38, font: U.FONT.SANS, color: '#9b9b98', max: x1 - x0 - 52 });
      let bx = x0 + 26;
      g.fillStyle = '#e8e8e4';
      for (let i = 0; i < C.bars.length; i += 2) {
        g.fillRect(bx, ky + kh - 62, C.bars[i] * 2.4, 40);
        bx += (C.bars[i] + C.bars[i + 1]) * 2.4;
        if (bx > x1 - 150) break;
      }
    }
    cap('INNER · PRINTED', 0, 1570);
    cap('BACK · CREDITS', 515, 1570);
    g.restore();
    g.restore();
  },
});
})();
