const { contextBridge, ipcRenderer } = require('electron');
let beforeClose;
ipcRenderer.on('coordinator:before-close', async (_event, payload) => {
  let success = false;
  try { success = beforeClose ? (await beforeClose()) === true : true; }
  catch { /* The renderer reports the save error and the window stays open. */ }
  ipcRenderer.send('coordinator:ready-to-close', { requestId: payload.requestId, success });
});

contextBridge.exposeInMainWorld('coordinator', Object.freeze({
  load: () => ipcRenderer.invoke('coordinator:load'),
  save: state => ipcRenderer.invoke('coordinator:save', state),
  importCanvas: () => ipcRenderer.invoke('coordinator:import-canvas'),
  canvasStatus: () => ipcRenderer.invoke('coordinator:canvas-status'),
  canvasConnect: input => ipcRenderer.invoke('coordinator:canvas-connect', input),
  canvasSync: options => ipcRenderer.invoke('coordinator:canvas-sync', options),
  canvasDisconnect: () => ipcRenderer.invoke('coordinator:canvas-disconnect'),
  onCanvasProgress: callback => {
    if (typeof callback !== 'function') throw new TypeError('The Canvas progress handler must be a function.');
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('coordinator:canvas-progress', listener);
    return () => ipcRenderer.removeListener('coordinator:canvas-progress', listener);
  },
  openGmail: draft => ipcRenderer.invoke('coordinator:open-gmail', draft),
  info: () => ipcRenderer.invoke('coordinator:info'),
  copyText: text => ipcRenderer.invoke('coordinator:copy-text', text),
  onBeforeClose: callback => {
    if (typeof callback !== 'function') throw new TypeError('The close handler must be a function.');
    beforeClose = callback;
  },
}));
