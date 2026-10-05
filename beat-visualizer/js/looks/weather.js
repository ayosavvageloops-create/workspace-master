// weather — a surface-analysis chart: wobbling isobars around a low-pressure centre, every
// note a station plot (circle + wind barb) placed by its position in the loop (angle) and
// pitch (radius), and a cold front that sweeps round the low like a clock hand.
(function () {
  const ROLE_COL = { bass: '#d9553f', chords: '#2e8a7e', lead: '#7d7768', drums: '#c49a3a', other: '#5f7fa6' };
  const colOf = (p) => ROLE_COL[p.role] || ROLE_COL.other;
  const gridOff = (S) => (S.A && S.A.beatOffset) || 0; // beat grid origin (MIDI offset or detected downbeat)

  Looks.register({
    id: 'weather',
    name: 'weather',
    group: 'midi',
    theme: 'light',
    desc: 'a surface-analysis weather map: notes as station plots round a low',
    defaults: { accent: '#5c5a52', bg: '#e9e8dc', loop: 4, isobars: 7, wobble: 1 },
    controls: [
      { key: 'bg', label: 'Paper', type: 'color' },
      { key: 'loop', label: 'Bars per sweep', type: 'select', options: [2, 4, 8] },
      { key: 'isobars', label: 'Isobars', type: 'range', min: 3, max: 10, step: 1 },
      { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 2, step: 0.1 },
    ],
    prepare(S) {
      const { w, h, unit, portrait } = S;
      const cx = w / 2, cy = portrait ? h * 0.52 : h * 0.54;
      const R = portrait ? unit * 0.36 : unit * 0.37;
      return { cx, cy, R };
    },
    draw(g, S) {
      const { w, h, unit, pad, opt, parts, t, A } = S;
      const { cx, cy, R } = S.cache;
      g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);

      const off = gridOff(S), loopLen = S.bar * (+opt.loop || 4);
      const li = Math.floor((t - off) / loopLen), L0 = off + li * loopLen, pos = (t - L0) / loopLen;
      const ang = (k) => -Math.PI / 2 + k * U.TAU;
      const sx = 1.12; // the low is a little wider than tall

      // isobars
      const lvl = A ? A.level(t) : 0.3, bp = A ? A.pulse(t, 'bass', 0.25) : 0;
      const nIso = Math.round(opt.isobars), wob = +opt.wobble;
      g.lineWidth = Math.max(1, unit * 0.0016);
      g.strokeStyle = 'rgba(110,108,96,0.55)';
      const N = 96;
      for (let k = 0; k < nIso; k++) {
        const kk = (k + 1) / nIso, base = R * (0.1 + 0.92 * kk);
        const irr = 0.05 + 0.26 * kk * kk; // outer lines are wilder
        g.beginPath();
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * U.TAU, ca = Math.cos(a), sa = Math.sin(a);
          const nz = U.fbm(ca * 1.1 + 3, sa * 1.1 + 7, k * 0.35 + t * 0.06 * wob, 3);
          const r = base * (1 + irr * nz * (0.8 + 0.4 * wob) + wob * 0.035 * (lvl + bp * 0.6) * Math.sin(a * 3 + k + t * 0.8));
          const x = cx + ca * r * sx, y = cy + sa * r;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.closePath(); g.stroke();
      }

      // stations
      const sr = Math.max(3, unit * 0.0085), stem = unit * 0.034;
      parts.forEach((p, pi) => {
        const col = colOf(p);
        const draw = (n, src, alpha, fresh) => {
          const k = (n.s - src) / loopLen;
          if (k < 0 || k >= 1) return;
          const a = ang(k) + (U.hash(Math.round(n.s * 50), n.p, 3) - 0.5) * 0.08;
          const pk = p.hi > p.lo ? (n.p - p.lo) / (p.hi - p.lo) : 0.5;
          const rr = R * (0.3 + 0.72 * pk) + (U.hash(n.p, Math.round(n.s * 50), pi) - 0.5) * R * 0.14;
          const x = cx + Math.cos(a) * rr * sx, y = cy + Math.sin(a) * rr;
          const da = U.hash(n.p, 11) * U.TAU; // wind direction: pitch class
          const len = stem * (fresh ? 1.15 : 1);
          const ex = x + Math.cos(da) * (sr + len), ey = y + Math.sin(da) * (sr + len);
          g.strokeStyle = U.rgba(col, alpha); g.lineWidth = Math.max(1.2, unit * (fresh ? 0.0028 : 0.0018));
          g.beginPath(); g.arc(x, y, sr * (fresh ? 1.25 : 1), 0, U.TAU);
          g.moveTo(x + Math.cos(da) * sr, y + Math.sin(da) * sr); g.lineTo(ex, ey);
          // barbs: one per 1/8 of length, up to 3
          const nb = U.clamp(Math.round((n.e - n.s) / (S.spb / 2)), 1, 3);
          for (let b = 0; b < nb; b++) {
            const bx = ex - Math.cos(da) * b * stem * 0.2, by = ey - Math.sin(da) * b * stem * 0.2;
            g.moveTo(bx, by); g.lineTo(bx + Math.cos(da + 2.2) * stem * 0.38, by + Math.sin(da + 2.2) * stem * 0.38);
          }
          g.stroke();
        };
        // the rest of this sweep is already forecast, faded
        for (const n of Parts.inRange(p, t, L0 + loopLen)) if (n.s > t) draw(n, L0, 0.3, false);
        for (const n of Parts.inRange(p, L0, t)) {
          if (n.s < L0 || n.s > t) continue;
          const age = (t - n.s) / S.spb;
          const fresh = age < 2.5;
          draw(n, L0, fresh ? 1 : U.lerp(0.75, 0.45, U.clamp((age - 2.5) / 8)), fresh);
        }
      });

      // cold front sweeping round the low
      const fa = ang(pos);
      const r0 = R * 0.3, r1 = R * 1.2;
      const fx = (r) => cx + Math.cos(fa) * r * sx, fy = (r) => cy + Math.sin(fa) * r;
      g.strokeStyle = opt.accent; g.fillStyle = opt.accent; g.lineWidth = Math.max(1.5, unit * 0.0024);
      g.beginPath(); g.moveTo(fx(r0), fy(r0)); g.lineTo(fx(r1), fy(r1)); g.stroke();
      const ux = Math.cos(fa) * sx, uy = Math.sin(fa), ul = Math.hypot(ux, uy);
      const nx = -uy / ul, ny = ux / ul, tri = unit * 0.011;
      for (let i = 0; i < 6; i++) {
        const r = U.lerp(r0 + R * 0.1, r1 - R * 0.05, i / 5);
        const bx = fx(r), by = fy(r);
        g.beginPath();
        g.moveTo(bx - (ux / ul) * tri, by - (uy / ul) * tri);
        g.lineTo(bx + (ux / ul) * tri, by + (uy / ul) * tri);
        g.lineTo(bx + nx * tri * 1.5, by + ny * tri * 1.5);
        g.closePath(); g.fill();
      }

      // the low
      U.text(g, 'L', cx, cy + unit * 0.02, { size: unit * 0.058, font: U.FONT.MONO, color: '#2a2a26', align: 'center' });
      const hpa = Math.round(1003 - lvl * 14 - bp * 4);
      U.text(g, String(hpa), cx, cy + unit * 0.052, { size: unit * 0.016, font: U.FONT.MONO, color: '#6c6a60', align: 'center' });
      if (!parts.length) U.text(g, 'NO STATIONS REPORTING', cx, cy + R * 1.3, { size: unit * 0.015, font: U.FONT.MONO, color: '#8a887c', align: 'center', spacing: 3 });

      // header
      const top = pad * 0.9 + unit * 0.05;
      U.text(g, S.meta.title || 'untitled', pad * 0.9, top, { size: unit * 0.062, font: U.FONT.PLEX, color: '#1f1f1c' });
      U.text(g, `SURFACE ANALYSIS · ${S.sub}`, pad * 0.9, top + unit * 0.036, { size: unit * 0.016, font: U.FONT.MONO, color: '#6c6a60', spacing: 1.5 });
    },
  });
})();
