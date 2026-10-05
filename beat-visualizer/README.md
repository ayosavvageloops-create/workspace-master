# Beat Visualizer

Browser tool that turns an audio track into a beat-reactive video (audio → video).
No build step or server: open `index.html` in Chrome.

## Features
- Load an audio track, cover art and an optional background image (the cover is used, blurred, if no background is set).
- Visual styles: Bars, Mirror Bars, Circle Spectrum, Liquid Circle, Waveform, Spectrum Curve, Particles, Pulse Rings.
- Formats: 16:9, 9:16 (Reels/TikTok), 1:1, 4:5.
- Title/artist overlay, fonts, two-colour gradient, background colour, blur and dimming.
- Beat reaction: intensity, bar count, beat-detection sensitivity, glow, zoom pulse, shake, flash, progress bar.
- Export: records the canvas plus the audio in real time (30/60 fps), for the full track or a chosen segment. Chrome saves MP4; other browsers save WebM.

## Structure
- `audio.js`: Web Audio playback, spectrum and bands, beat detection.
- `modes.js`: registry of visual styles. To add a style, append `{ id, name, coverLayout?, draw(g, s) }`.
- `app.js`: renderer layers (background, mode, cover, text, progress), UI bindings and export.
