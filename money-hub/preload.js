'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

contextBridge.exposeInMainWorld('hub', {
  snapshot: () => call('hub:snapshot'),
  action: (id, act) => call('hub:action', id, act),
  log: (id) => call('hub:log', id),
  runScenario: (id) => call('hub:scenario', id),
  setStep: (id, i, on) => call('hub:step', id, i, on),
  saveSettings: (patch) => call('hub:settings', patch),
  pickDir: (current) => call('hub:pickDir', current),
  onChange: (fn) => ipcRenderer.on('hub:change', () => fn()),
  onLog: (fn) => ipcRenderer.on('hub:log', (_e, id) => fn(id)),
});
