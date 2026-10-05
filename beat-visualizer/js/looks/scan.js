// scan — a floating point-cloud scan of a small room: back wall with a doorway, side
// panels, a floor slab, plants and a few objects, drawn as dots in perspective with a
// soft shadow below. Points jitter and thin out with the level; a scan band sweeps up.
Looks.register({
  id: 'scan',
  name: 'scan',
  group: 'audio',
  theme: 'light',
  desc: 'a point-cloud scan of a room',
  defaults: { accent: '#4f7a3a', bg: '#f0f0ec', orbit: 1, jitter: 1, band: true },
  controls: [
    { key: 'bg', label: 'Background', type: 'color' },
    { key: 'orbit', label: 'Camera orbit', type: 'range', min: 0, max: 3, step: 0.05 },
    { key: 'jitter', label: 'Jitter', type: 'range', min: 0, max: 3, step: 0.05 },
    { key: 'band', label: 'Scan band', type: 'toggle' },
  ],
  prepare(S) {
    const { w, h, opt, unit } = S;
    const r = U.rng(S.seed);
    const P = []; // [x, y, z, kind]  kind: 0 grey wall, 1 floor, 2 green, 3 object (darker)
    const add = (x, y, z, k) => P.push(x, y, z, k);
    const jit = () => (r() - 0.5) * 0.05;
    // back wall (z = 3) with a doorway gap
    for (let i = 0; i < 2400; i++) {
      const x = -1.65 + r() * 3.3, y = r() * 2.2;
      if (x > -0.42 && x < 0.32 && y < 1.55) { if (r() < 0.1) add(x, y * r(), 3 + jit(), 0); continue; }
      add(x, y, 3 + jit() * 0.5, 0);
    }
    // side panels: slightly angled, folded, standing off the back wall
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 700; i++) {
        const u = r(), y = -0.05 + r() * 2.45;
        const fold = u < 0.55;
        const z = fold ? 0.2 + u / 0.55 * 1.1 : 1.3 + (u - 0.55) / 0.45 * 0.8;
        const x = sx * (fold ? 1.98 - (z - 0.2) * 0.18 : 1.78 - (z - 1.3) * 0.04);
        add(x + jit() * 0.4, y, z, 4);
      }
    }
    // floor slab: denser, slightly lumpy, ragged front edge
    for (let i = 0; i < 2800; i++) {
      const x = -2.5 + r() * 5, z = -0.2 + r() * 3.2;
      const edge = 0.05 + 0.3 * U.fbm(x * 1.3, 3.3, 0, 3);
      if (z < edge) continue;
      add(x, 0.02 * U.vnoise(x * 3, z * 3) + jit() * 0.3 - (z < 0.4 ? 0.06 * r() : 0), z, 1);
    }
    // plants: green clusters at the foot of the back wall
    const bush = (cx, cz, rx, ry, n) => {
      for (let i = 0; i < n; i++) {
        const a = r() * U.TAU, rr = Math.sqrt(r());
        add(cx + Math.cos(a) * rx * rr, Math.abs(r() * ry * (1 - rr * 0.4)), cz + Math.sin(a) * 0.25 * rr, 2);
      }
    };
    bush(-1.15, 2.75, 0.5, 0.95, 380);
    bush(0.85, 2.7, 0.7, 0.85, 420);
    bush(-0.1, 2.85, 0.25, 0.6, 90);
    // wreaths on the wall
    for (const [cx, cy, rr] of [[-0.95, 1.55, 0.17], [-0.25, 1.68, 0.15]]) {
      for (let i = 0; i < 70; i++) { const a = r() * U.TAU, q = rr * (0.7 + 0.3 * r()); add(cx + Math.cos(a) * q, cy + Math.sin(a) * q, 2.95, i % 3 ? 2 : 3); }
    }
    // a glass sphere: sparse ring outline
    const sphere = { x: 1.15, y: 0.55, z: 2.6, r: 0.55 };
    // picture frames floating above the wall top
    for (const [cx, cy] of [[-0.75, 2.62], [0.45, 2.55]]) {
      for (let i = 0; i < 46; i++) {
        const u = r(), side = Math.floor(r() * 4), q = 0.12;
        const x = side < 2 ? cx - q + u * 2 * q : cx + (side === 2 ? -q : q), y = side >= 2 ? cy - q + u * 2 * q : cy + (side === 0 ? -q : q);
        add(x, y, 3, 3);
      }
      for (let i = 0; i < 14; i++) add(cx + (r() - 0.5) * 0.18, cy + (r() - 0.5) * 0.18, 3, 3);
    }
    const pts = Float32Array.from(P);
    const n = pts.length / 4;
    const seedv = new Float32Array(n); for (let i = 0; i < n; i++) seedv[i] = r();
    const geom = scan_geom(S);
    const bg = U.layer(w, h, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, U.mix(opt.bg, '#ffffff', 0.4)); gr.addColorStop(1, U.mix(opt.bg, '#d8dad4', 0.4));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      // soft shadow ellipse beneath the floating room
      g.save();
      g.translate(w / 2, geom.shadowY); g.scale(1, 0.12);
      const sg = g.createRadialGradient(0, 0, 0, 0, 0, geom.shadowR);
      sg.addColorStop(0, 'rgba(120,124,118,0.32)'); sg.addColorStop(0.7, 'rgba(120,124,118,0.22)'); sg.addColorStop(1, 'rgba(120,124,118,0)');
      g.fillStyle = sg; g.beginPath(); g.arc(0, 0, geom.shadowR, 0, U.TAU); g.fill();
      g.restore();
    }, 1);
    return { pts, n, seedv, sphere, bg, geom };
  },
  draw(g, S) {
    const { A, opt, unit, cache: C } = S;
    const { pts, n, seedv, geom } = C;
    g.drawImage(C.bg, 0, 0);
    const t = S.t, lvl = A.level(t), hit = A.pulse(t, 'hit', 0.2);

    // camera: slow orbit around the room's middle, looking slightly down
    const yaw = opt.orbit * 0.07 * Math.sin(t * 0.21) + 0.012 * opt.orbit * Math.sin(t * 0.9);
    const pitch = 0.03 + opt.orbit * 0.012 * Math.sin(t * 0.17);
    const tx = 0, ty = 1.5, tz = 1.0, dist = 5.1;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const camX = tx - syw * cp * dist, camY = ty + sp * dist, camZ = tz - cyw * cp * dist;
    const f = geom.f, ox = geom.cx, oy = geom.cy;
    // scan band: a vertical slab sweeping across the room once per bar
    const bandX = -2.4 + 4.8 * ((((t - A.beatOffset) / S.bar) % 1) + 1) % 1;
    const keep = 0.55 + 0.45 * Math.min(1, lvl * 1.3);
    const jstep = Math.floor(t * 15), jamp = opt.jitter * (0.006 + 0.03 * hit);

    // project into buckets by kind and depth so each bucket is a single fill
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < n; i++) {
      const sv = seedv[i];
      if (sv > keep) continue;
      const k = pts[i * 4 + 3];
      let x = pts[i * 4], y = pts[i * 4 + 1], z = pts[i * 4 + 2];
      if (jamp > 0) {
        x += (U.hash(i, jstep) - 0.5) * jamp; y += (U.hash(i, jstep, 1) - 0.5) * jamp;
      }
      // world -> camera
      const dx = x - camX, dy = y - camY, dz = z - camZ;
      const xr = dx * cyw - dz * syw, zr0 = dx * syw + dz * cyw;
      const yr = dy * cp + zr0 * sp, zr = -dy * sp + zr0 * cp;
      if (zr < 0.5) continue;
      const sx = ox + (xr / zr) * f, sy = oy - (yr / zr) * f;
      const near = 6.5 / zr;
      const inBand = opt.band && Math.abs(x - bandX) < 0.07;
      const sz = unit * (k === 1 ? 0.0028 : 0.0032) * near * (inBand ? 1.4 : 1);
      let b = k === 2 ? 3 : k === 3 ? 4 : k === 1 ? 1 : k === 4 ? 2 : 0;
      if (inBand) b = 5;
      if (sz < 2.4) paths[b].rect(sx - sz, sy - sz, sz * 2, sz * 2);
      else { paths[b].moveTo(sx + sz, sy); paths[b].arc(sx, sy, sz, 0, U.TAU); }
    }
    const fills = ['rgba(88,96,86,0.85)', 'rgba(98,98,96,0.9)', 'rgba(150,150,146,0.85)', U.rgba(opt.accent, 0.88), 'rgba(80,90,78,0.9)', U.rgba(opt.accent, 0.95)];
    for (let b = 0; b < 6; b++) { g.fillStyle = fills[b]; g.fill(paths[b]); }

    // glass sphere: a faint wireframe globe (projected lat/long rings)
    {
      const s = C.sphere, R = s.r * (1 + 0.04 * A.band(t, 'mid'));
      const proj = (x, y, z) => {
        const dx = x - camX, dy = y - camY, dz = z - camZ;
        const xr = dx * cyw - dz * syw, zr0 = dx * syw + dz * cyw;
        const yr = dy * cp + zr0 * sp, zr = -dy * sp + zr0 * cp;
        return [ox + (xr / zr) * f, oy - (yr / zr) * f];
      };
      g.strokeStyle = 'rgba(110,130,125,0.4)'; g.lineWidth = Math.max(1, unit * 0.001);
      g.beginPath();
      const spin = t * 0.2;
      for (let m = 0; m < 6; m++) {
        const lon = spin + (m / 6) * Math.PI;
        for (let k = 0; k <= 24; k++) {
          const lat = (k / 24) * Math.PI - Math.PI / 2;
          const [px, py] = proj(s.x + R * Math.cos(lat) * Math.cos(lon), s.y + R * Math.sin(lat), s.z + R * Math.cos(lat) * Math.sin(lon));
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
      }
      for (let p = 1; p < 6; p++) {
        const lat = (p / 6) * Math.PI - Math.PI / 2;
        for (let k = 0; k <= 32; k++) {
          const lon = (k / 32) * U.TAU;
          const [px, py] = proj(s.x + R * Math.cos(lat) * Math.cos(lon), s.y + R * Math.sin(lat), s.z + R * Math.cos(lat) * Math.sin(lon));
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
      }
      g.stroke();
    }
  },
});

function scan_geom(S) {
  const { w, h } = S;
  const f = S.portrait ? w * 1.5 : h * 1.15;
  return { f, cx: w / 2, cy: S.portrait ? h * 0.46 : h * 0.4, shadowY: S.portrait ? h * 0.8 : h * 0.9, shadowR: S.portrait ? w * 0.42 : h * 0.5 };
}
