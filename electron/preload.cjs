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
  openGmail: draft => ipcRenderer.invoke('coordinator:open-gmail', draft),
  info: () => ipcRenderer.invoke('coordinator:info'),
  copyText: text => ipcRenderer.invoke('coordinator:copy-text', text),
  onBeforeClose: callback => {
    if (typeof callback !== 'function') throw new TypeError('The close handler must be a function.');
    beforeClose = callback;
  },
}));
