// Exposes a native "Save as…" for exported videos to the web app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // Shows the save dialog, writes the file. Resolves to the saved path, or null if cancelled.
  saveFile: async (filename, blob) => {
    const data = new Uint8Array(await blob.arrayBuffer());
    return ipcRenderer.invoke('save-file', filename, data);
  },
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
});
