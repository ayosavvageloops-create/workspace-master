# Beat Visualizer

Turns a beat (wav/mp3) — and optionally the MIDI of its parts — into a short vertical
or horizontal video. Runs entirely in the browser: open `index.html` in Chrome or Edge.

## Workflow
1. **Beat** — drop a wav/mp3 anywhere on the page (or press *Demo*). Title, BPM and key are
   read from the filename (`loversrock 136 emin.wav`). Drop `.mid` files beside it: each track
   becomes a *part* (bass / chords / lead…) with its own colour. Without MIDI, parts are guessed
   from the audio.
2. **Look** — pick one of the looks; every tile is a live render of your beat. Each look has its
   own options (accent colour, layout, density…).
3. **Export** — renders off-screen as fast as the machine allows (WebCodecs H.264 + AAC → MP4),
   1080×1920 or 1920×1080 at 60 fps, audio normalised to −14 LUFS / −1 dBTP. Asks where to save.

## Looks (40)
- **Audio only:** scope, campaign, rack, orrery, mosh, blob, transit, lidar, glyph, filament,
  monitor, scan, smear, stipple, ladder, gonio.
- **With MIDI** (or with parts guessed from the audio): proof, oracle, weather, arcade, receipt,
  totem, trajectory, stars, chart, eclipse, sheet, screen, strip, mono studio, rage field,
  rage night, trap phosphor, trap chrome, ama sun, afro paper, plate, film, keys, domino.

Every look has an accent colour plus its own options. All looks work in 9:16, 16:9, 4:5 and 1:1.

## Structure
- `js/core/analysis.js` — offline audio analysis: spectrum, bands, onsets, tempo/beat grid, EBU R128 loudness.
- `js/core/midi.js` — MIDI parser and the parts model (`Parts.inRange`, `Parts.active`, `Parts.chordAt`).
- `js/core/looks.js` — look registry and the per-frame scene contract (documented at the top of the file).
- `js/core/export.js` — offline MP4 export (vendored `mp4-muxer`, MIT) with a real-time fallback.
- `js/looks/*.js` — one look per file, listed in `js/looks/index.js`.
- `tools/snap.cjs` — renders looks on the demo beat in headless Chromium for review:
  `node tools/snap.cjs <look|all> --out snaps [--format 16:9] [--nomidi]`.
- `vendor/fonts` — self-hosted Google Fonts (SIL OFL) so the app works offline.

## Desktop app (Electron)
`desktop/` wraps the web app in an Electron window with a native "Save as" dialog for exports.
```
cd desktop && npm install
npm start            # run it
npm run dist:mac     # macOS Apple Silicon zip
npm run dist:win     # Windows installer (needs wine when built on Linux)
```
On macOS the app is not notarised: the first time, right-click it and choose **Open**.
