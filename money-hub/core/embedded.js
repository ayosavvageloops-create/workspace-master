'use strict';
// Dolphin Outreach встроен в Money Hub: его сервер работает внутри приложения,
// отдельно скачивать и запускать ничего не нужно. Данные — в папке приложения.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function startEmbeddedOutreach({ dataDir, port }) {
  process.env.DOLPHIN_OUTREACH_DATA = dataDir; // читается при первом импорте config.js
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'outreach', 'src', 'server.js')).href);
  const { server } = mod.createApp();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

module.exports = { startEmbeddedOutreach };
