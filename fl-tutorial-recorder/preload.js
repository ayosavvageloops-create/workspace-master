const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  platform: invoke('platform'),
  listSources: invoke('sources:list'),
  selectSource: invoke('sources:select'),

  createProject: invoke('project:create'),
  saveProject: invoke('project:save'),
  loadProject: invoke('project:load'),
  listProjects: invoke('project:list'),
  revealProject: invoke('project:reveal'),
  fileUrl: invoke('file:url'),
  importFile: invoke('file:import'),
  pathForFile: (file) => webUtils.getPathForFile(file),

  openStream: invoke('stream:open'),
  writeStream: invoke('stream:write'),
  closeStream: invoke('stream:close'),

  finalizeRecording: invoke('recording:finalize'),
  finishExport: invoke('export:finish'),
  onFinalizeProgress: listen('progress:finalize'),
  onExportProgress: listen('progress:export'),

  enableHotkeys: invoke('hotkeys:enable'),
  disableHotkeys: invoke('hotkeys:disable'),
  onHotkey: listen('hotkey'),

  showHud: invoke('hud:show'),
  hideHud: invoke('hud:hide'),
  updateHud: (state) => ipcRenderer.send('hud:update', state),
  onHudState: listen('hud:state'),
});
