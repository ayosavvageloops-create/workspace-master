// Copies the web app (one folder up) into ./app so electron-builder can package it.
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..');
const dst = path.join(__dirname, 'app');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const item of ['index.html', 'css', 'js', 'vendor']) {
  fs.cpSync(path.join(src, item), path.join(dst, item), { recursive: true });
}
console.log('web app copied to', dst);
