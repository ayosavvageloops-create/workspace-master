'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  defaults: () => ipcRenderer.invoke('defaults'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickOutput: () => ipcRenderer.invoke('pick-output'),
  expand: (paths) => ipcRenderer.invoke('expand', paths),
  pathsFromDrop: (fileList) => Array.from(fileList).map((f) => webUtils.getPathForFile(f)),
  lutsInfo: () => ipcRenderer.invoke('luts-info'),
  genLuts: (n) => ipcRenderer.invoke('gen-luts', n),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showFile: (p) => ipcRenderer.invoke('show-file', p),
  run: (payload) => ipcRenderer.invoke('run', payload),
  cancel: () => ipcRenderer.invoke('cancel'),
  onJob: (cb) => ipcRenderer.on('job', (_e, d) => cb(d)),
});
