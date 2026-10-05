// Макет IG Sender Pro для тестов: те же ключи хранилища и глобальные startProcess()/stopBot().
// Ник с префиксом skip → skipped, fail → error, block → блок Instagram (останавливает бота).
let timer = null;

async function startProcess() {
  const d = await chrome.storage.local.get(['mode2026', 'pairs']);
  if (!d.mode2026) throw new Error('mode2026 off');
  const tabs = await chrome.tabs.query({});
  if (!tabs.some((t) => /\/ig\b/.test(t.url || ''))) { await chrome.storage.local.set({ isRunning: false }); return; }
  await chrome.storage.local.set({ isRunning: true });
  timer = setInterval(step, 150);
}

async function step() {
  const d = await chrome.storage.local.get(['pairs', 'pairIndex', 'isRunning', 'sentLog']);
  if (!d.isRunning) { clearInterval(timer); return; }
  const pairs = d.pairs || [];
  const sentLog = d.sentLog || {};
  const i = pairs.findIndex((p) => !p.status || p.status === 'pending');
  if (i < 0) { clearInterval(timer); await chrome.storage.local.set({ isRunning: false, pairIndex: 0 }); return; }
  const p = pairs[i];
  if (p.user.startsWith('block')) {
    p.status = 'error'; p.note = 'instagram limited';
    await chrome.storage.local.set({ pairs });
    return stopBot();
  }
  if (p.user.startsWith('skip')) { p.status = 'skipped'; p.note = 'no message button'; }
  else if (p.user.startsWith('fail')) { p.status = 'error'; p.note = 'timeout'; }
  else { p.status = 'sent'; sentLog[p.user] = { ts: Date.now(), mode: '2026', text: p.opener }; }
  p.ts = Date.now();
  await chrome.storage.local.set({ pairs, pairIndex: i + 1, sentLog });
}

async function stopBot() {
  clearInterval(timer);
  await chrome.storage.local.set({ isRunning: false, stage2026: null });
}
