// Loads every look file (one look per file in this folder, registered via Looks.register).
// Order here is the order of the picker grid.
(function () {
  const LOOKS = [
    'scope', 'proof', 'campaign', 'oracle', 'weather', 'rack', 'orrery', 'mosh', 'blob', 'arcade',
    'receipt', 'transit', 'lidar', 'glyph', 'totem', 'trajectory', 'stars', 'filament', 'monitor', 'scan',
    'smear', 'stipple', 'chart', 'eclipse', 'ladder', 'sheet', 'screen', 'strip', 'mono-studio', 'rage-field',
    'rage-night', 'trap-phosphor', 'trap-chrome', 'ama-sun', 'afro-paper', 'plate', 'film', 'gonio', 'keys', 'domino',
  ];
  for (const id of LOOKS) document.write(`<script src="js/looks/${id}.js" onerror="console.warn('look file missing: ${id}')"><\/script>`);
})();
