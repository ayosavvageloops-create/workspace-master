// trap-chrome — a retro silver MP3 player on a pastel backdrop: lime LCD with a pixel title,
// a dotted mini piano roll, the big time readout and an LED meter, plus chunky round buttons.
(function () {
  function range(parts, span) {
    let lo = 127, hi = 0;
    for (const p of parts) for (const n of p.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
    if (lo > hi) { lo = 36; hi = 84; }
    lo -= 2; hi += 2;
    if (hi - lo < span) { const c = (lo + hi) / 2; lo = Math.floor(c - span / 2); hi = lo + span; }
    return [lo, hi];
  }

  function layout(S) {
    const { w, h, portrait } = S;
    let bw, bh;
    if (portrait) { bw = w * 0.89; bh = bw * 0.48; }
    else { bw = Math.min(w * 0.89, (h * 0.5) / 0.48); bh = bw * 0.48; }
    const bx = (w - bw) / 2, by = portrait ? h * 0.425 - bh / 2 : (h - bh) / 2 - h * 0.03;
    const lx = bx + bw * 0.072, ly = by + bh * 0.16, lw = bw * 0.6, lh = bh * 0.6;
    const pr = bh * 0.205, px = bx + bw * 0.835, py = by + bh * 0.42;
    return { bx, by, bw, bh, lx, ly, lw, lh, pr, px, py,
      meterX: lx + lw * 0.06, meterY: ly + lh + bh * 0.11, meterW: lw * 0.6, meterH: bh * 0.07 };
  }

  const INK = '#1f2a0c';

  Looks.register({
    id: 'trap-chrome',
    name: 'trap chrome',
    group: 'midi',
    theme: 'light',
    desc: 'a silver mp3 player with a lime lcd piano roll',
    defaults: { accent: '#b6e04a', bg: '#f6f6f8', bars: 2, blooms: true, meter: 'spectrum' },
    controls: [
      { key: 'bg', label: 'Background', type: 'color' },
      { key: 'bars', label: 'Bars on lcd', type: 'range', min: 1, max: 4, step: 0.5 },
      { key: 'meter', label: 'LED meter', type: 'select', options: ['spectrum', 'level'] },
      { key: 'blooms', label: 'Pastel blooms', type: 'toggle' },
    ],
    prepare(S) {
      const L = layout(S), opt = S.opt, u = S.unit;
      const [lo, hi] = range(S.parts, 24);
      const bg = U.layer(S.w, S.h, (g, w, h) => {
        g.fillStyle = opt.bg; g.fillRect(0, 0, w, h);
        if (!opt.blooms) return;
        U.glowBlob(g, w * 0.2, h * 0.14, w * 0.42, '#c9b8ff', 0.55);
        U.glowBlob(g, w * 0.88, h * 0.24, w * 0.45, '#ffc7a6', 0.55);
        U.glowBlob(g, w * 0.14, h * 0.86, w * 0.42, '#bfeccb', 0.5);
        U.glowBlob(g, w * 0.86, h * 0.8, w * 0.45, '#bcd8ff', 0.5);
        U.glowBlob(g, w * 0.5, h * 0.55, w * 0.5, '#ffffff', 0.6);
      }, 0.25);
      const body = U.layer(S.w, S.h, (g) => {
        const { bx, by, bw, bh } = L, r = bh * 0.32;
        // shadow + body
        g.save();
        g.shadowColor = 'rgba(40,40,60,0.28)'; g.shadowBlur = u * 0.06; g.shadowOffsetY = u * 0.025;
        U.rrect(g, bx, by, bw, bh, r);
        const bgr = g.createLinearGradient(0, by, 0, by + bh);
        bgr.addColorStop(0, '#f7f7f5'); bgr.addColorStop(0.5, '#e7e7e4'); bgr.addColorStop(1, '#d2d2cf');
        g.fillStyle = bgr; g.fill();
        g.restore();
        // brushed lines
        g.save(); U.rrect(g, bx, by, bw, bh, r); g.clip();
        for (let y = by; y < by + bh; y += 3) { g.fillStyle = `rgba(${(y | 0) % 2 ? 255 : 0},${(y | 0) % 2 ? 255 : 0},${(y | 0) % 2 ? 255 : 0},0.035)`; g.fillRect(bx, y, bw, 1); }
        g.restore();
        // rims
        U.rrect(g, bx + 1.5, by + 1.5, bw - 3, bh - 3, r); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
        U.rrect(g, bx, by, bw, bh, r); g.lineWidth = 2; g.strokeStyle = 'rgba(120,120,125,0.55)'; g.stroke();
        U.rrect(g, bx + bh * 0.04, by + bh * 0.04, bw - bh * 0.08, bh - bh * 0.08, r * 0.86); g.lineWidth = 1.5; g.strokeStyle = 'rgba(150,150,150,0.3)'; g.stroke();
        // LCD bezel + glass
        const { lx, ly, lw, lh } = L, lr = lh * 0.07;
        U.rrect(g, lx - 5, ly - 5, lw + 10, lh + 10, lr + 4); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fill();
        U.rrect(g, lx, ly, lw, lh, lr);
        const lg = g.createLinearGradient(0, ly, 0, ly + lh);
        lg.addColorStop(0, U.mix(opt.accent, '#ffffff', 0.1)); lg.addColorStop(1, U.mix(opt.accent, '#7a9a20', 0.18));
        g.fillStyle = lg; g.fill();
        g.lineWidth = Math.max(3, u * 0.004); g.strokeStyle = '#2c3414'; g.stroke();
        // LCD pixel grid
        g.save(); U.rrect(g, lx, ly, lw, lh, lr); g.clip();
        const ps = Math.max(3, Math.round(u * 0.0045));
        g.fillStyle = 'rgba(60,80,10,0.07)';
        for (let x = lx; x < lx + lw; x += ps) g.fillRect(x, ly, 1, lh);
        for (let y = ly; y < ly + lh; y += ps) g.fillRect(lx, y, lw, 1);
        const ig = g.createLinearGradient(0, ly, 0, ly + lh * 0.25);
        ig.addColorStop(0, 'rgba(40,60,0,0.18)'); ig.addColorStop(1, 'rgba(40,60,0,0)');
        g.fillStyle = ig; g.fillRect(lx, ly, lw, lh * 0.25);
        g.restore();
        // play button
        const { px, py, pr } = L;
        g.save();
        g.shadowColor = 'rgba(30,30,40,0.35)'; g.shadowBlur = u * 0.03; g.shadowOffsetY = u * 0.01;
        g.beginPath(); g.arc(px, py, pr * 1.08, 0, U.TAU); g.fillStyle = '#cfcfcc'; g.fill();
        g.restore();
        const rg = g.createRadialGradient(px - pr * 0.3, py - pr * 0.4, pr * 0.1, px, py, pr * 1.05);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.6, '#e4e4e2'); rg.addColorStop(1, '#b9b9b6');
        g.beginPath(); g.arc(px, py, pr, 0, U.TAU); g.fillStyle = rg; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = 'rgba(110,110,110,0.45)'; g.stroke();
        // skip buttons
        const sw = pr * 0.66, sh = pr * 0.34, sy = py + pr * 1.5;
        for (const [k, dir] of [[-1, -1], [1, 1]]) {
          const sx = px + k * pr * 0.42 - sw / 2;
          g.save(); g.shadowColor = 'rgba(30,30,40,0.25)'; g.shadowBlur = u * 0.012; g.shadowOffsetY = u * 0.004;
          U.rrect(g, sx, sy - sh / 2, sw, sh, sh / 2);
          const sg = g.createLinearGradient(0, sy - sh / 2, 0, sy + sh / 2);
          sg.addColorStop(0, '#f2f2f0'); sg.addColorStop(1, '#cfcfcc');
          g.fillStyle = sg; g.fill(); g.restore();
          U.rrect(g, sx, sy - sh / 2, sw, sh, sh / 2); g.lineWidth = 1; g.strokeStyle = 'rgba(120,120,120,0.4)'; g.stroke();
          const cx = sx + sw / 2, s = sh * 0.22;
          g.fillStyle = '#6a6a6a';
          g.beginPath();
          if (dir < 0) { g.moveTo(cx + s, sy - s); g.lineTo(cx - s * 0.5, sy); g.lineTo(cx + s, sy + s); g.fill(); g.fillRect(cx - s, sy - s, s * 0.35, s * 2); }
          else { g.moveTo(cx - s, sy - s); g.lineTo(cx + s * 0.5, sy); g.lineTo(cx - s, sy + s); g.fill(); g.fillRect(cx + s * 0.65, sy - s, s * 0.35, s * 2); }
        }
      });
      return { L, lo, hi, bg, body };
    },
    draw(g, S) {
      const { opt, parts, A, unit } = S;
      const { L, lo, hi } = S.cache;
      g.drawImage(S.cache.bg, 0, 0, S.w, S.h);
      g.drawImage(S.cache.body, 0, 0, S.w, S.h);
      const { lx, ly, lw, lh } = L;
      const ghost = 'rgba(40,60,0,0.13)';
      const ink = INK;
      const pad = lw * 0.055;

      // status flags
      const fs = lh * 0.075;
      let fx = lx + lw - pad;
      for (const [label, on] of [['SHUF', false], ['LOOP', false], ['PAUSE', true]]) {
        const tw = U.text(g, label, fx, ly + lh * 0.14, { size: fs, font: U.FONT.PIXEL, color: on ? ink : 'rgba(40,60,0,0.3)', align: 'right', spacing: 0.5 });
        fx -= tw + fs * 0.6;
      }
      // title: a scrolling marquee when it is wider than the lcd (pauses at the start of each pass)
      const title = (S.meta.title || 'untitled').toUpperCase();
      const tOpt = { size: lh * 0.27, font: U.FONT.PIXEL, color: ink, spacing: 2 };
      const tw0 = U.textWidth(g, title, tOpt), avail = lw - pad * 2;
      if (tw0 <= avail) U.text(g, title, lx + pad, ly + lh * 0.37, tOpt);
      else {
        const gap = lh * 0.6, loop = tw0 + gap, speed = lh * 0.55, hold = 1.6;
        const period = hold + loop / speed, ph = ((S.t % period) + period) % period;
        const off = ph < hold ? 0 : (ph - hold) * speed;
        g.save(); g.beginPath(); g.rect(lx + pad * 0.6, ly + lh * 0.18, lw - pad * 1.2, lh * 0.24); g.clip();
        U.text(g, title, lx + pad - off, ly + lh * 0.37, tOpt);
        U.text(g, title, lx + pad - off + loop, ly + lh * 0.37, tOpt);
        g.restore();
      }

      // mini roll: pitch across, time down (future below), dotted lcd pixels
      const rx0 = lx + pad, rx1 = lx + lw - pad, ry0 = ly + lh * 0.42, ry1 = ly + lh * 0.7;
      const ps = Math.max(3, Math.round(unit * 0.0045));
      const cols = Math.max(8, Math.floor((rx1 - rx0) / (ps * 2)));
      const colW = (rx1 - rx0) / cols;
      // ghost lcd segments
      g.fillStyle = ghost;
      for (let c = 0; c < cols; c++) for (let y = ry0; y < ry1; y += ps * 1.6) g.fillRect(rx0 + c * colW, y, ps * 0.8, ps * 0.8);
      const win = S.bar * opt.bars, phK = 0.3, phy = ry0 + (ry1 - ry0) * phK;
      const t0 = S.t - win * phK, t1 = S.t + win * (1 - phK);
      const ty = (tt) => phy + ((tt - S.t) / win) * (ry1 - ry0);
      const span = hi - lo + 1;
      for (const p of parts) {
        for (const n of Parts.inRange(p, t0, t1)) {
          const c = Math.min(cols - 1, Math.floor(((n.p - lo) / span) * cols));
          const x = rx0 + c * colW;
          const ya = Math.max(ry0, ty(n.s)), yb = Math.min(ry1, ty(n.e));
          const playing = n.s <= S.t && n.e > S.t;
          g.fillStyle = playing ? ink : n.e <= S.t ? 'rgba(31,42,12,0.55)' : 'rgba(31,42,12,0.8)';
          for (let y = ya; y < yb; y += ps * 1.6) g.fillRect(x, y, ps * (playing ? 1.1 : 0.8), ps * 0.8);
        }
      }
      g.fillStyle = ink; g.fillRect(rx0 - ps, phy - ps * 0.35, rx1 - rx0 + ps * 2, ps * 0.7);
      if (!parts.length) U.text(g, 'NO MIDI · AUDIO ONLY', (rx0 + rx1) / 2, ry1 - ps, { size: fs, font: U.FONT.PIXEL, color: 'rgba(31,42,12,0.6)', align: 'center', spacing: 1 });

      // time readout + progress dots
      const [cur, tot] = S.timeLabel(2).split(' / ');
      const by = ly + lh * 0.89;
      const tw = U.text(g, cur, lx + pad, by, { size: lh * 0.25, font: U.FONT.PIXEL, color: ink, spacing: 1 });
      U.text(g, '/ ' + tot, lx + pad + tw + lh * 0.04, by, { size: lh * 0.085, font: U.FONT.PIXEL, color: ink, spacing: 0.5 });
      const used = lx + pad + tw + lh * 0.04 + U.textWidth(g, '/ ' + tot, { size: lh * 0.085, font: U.FONT.PIXEL, spacing: 0.5 });
      U.text(g, `${Math.round(S.bpm)} BPM${S.meta.key ? ' · ' + S.meta.key : ''}`, lx + lw - pad, by, { size: lh * 0.085, font: U.FONT.PIXEL, color: ink, align: 'right', spacing: 0.5, max: lx + lw - pad - used - lh * 0.06 });
      const dotsY = by + lh * 0.045, dn = Math.floor((lw - pad * 2) / (ps * 1.6));
      for (let i = 0; i < dn; i++) {
        g.fillStyle = i / dn <= S.prog ? ink : ghost;
        g.fillRect(lx + pad + i * ps * 1.6, dotsY, ps * 0.8, ps * 0.8);
      }

      // LED meter on the body
      const N = 12, mw = L.meterW / N;
      // meter values averaged over a few past instants so segments don't flicker frame to frame
      let vals = null;
      if (opt.meter !== 'level') {
        vals = new Float32Array(12);
        for (const [dt, wt] of [[0, 0.45], [0.03, 0.3], [0.06, 0.25]]) { const b = A.bands12(S.t - dt); for (let i = 0; i < 12; i++) vals[i] += b[i] * wt; }
      }
      const lvl = A.level(S.t) * 0.5 + A.level(S.t - 0.03) * 0.3 + A.level(S.t - 0.06) * 0.2;
      for (let i = 0; i < N; i++) {
        const v = vals ? U.clamp(vals[i] * 1.15) : (i / N < lvl ? 1 : 0.15);
        const hh = L.meterH * (0.3 + 0.7 * v);
        const x = L.meterX + i * mw;
        g.fillStyle = 'rgba(60,70,40,0.15)'; g.fillRect(x, L.meterY - L.meterH, mw * 0.5, L.meterH);
        g.fillStyle = i >= N - 2 ? '#d2c32a' : U.mix('#5f9c12', opt.accent, 0.4);
        g.globalAlpha = 0.35 + 0.65 * v;
        g.fillRect(x, L.meterY - hh, mw * 0.5, hh);
        g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(40,50,20,0.55)'; g.fillRect(L.meterX, L.meterY + 2, L.meterW - mw * 0.38, 2);

      // play triangle, nudged on each beat like a pressed button
      const bp = A.beatPulse(S.t, 0.09);
      const { px, py, pr } = L;
      if (bp > 0.05) { g.beginPath(); g.arc(px, py, pr, 0, U.TAU); g.fillStyle = `rgba(0,0,0,${0.06 * bp})`; g.fill(); }
      const s = pr * 0.36, off = bp * pr * 0.02;
      g.fillStyle = '#111';
      g.beginPath(); g.moveTo(px - s * 0.62, py - s + off); g.lineTo(px + s * 0.95, py + off); g.lineTo(px - s * 0.62, py + s + off); g.closePath(); g.fill();
    },
  });
})();
