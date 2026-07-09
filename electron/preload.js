const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aoc', {
  saveImage: (dataUrl) => ipcRenderer.invoke('save-image', dataUrl),
  openImage: () => ipcRenderer.invoke('open-image')
});
