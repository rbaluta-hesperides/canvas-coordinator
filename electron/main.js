import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WorkspaceStore, defaultCanvasCacheDirectory, importCanvasDirectory } from './store.js';
import { buildGmailUrl } from '../src/domain.js';
import { CANVAS_PARTITION, CanvasService } from './canvas-service.js';
import { createWindowCloseGuard } from './window-close.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.resolve(directory, '..', 'src');
const rendererUrl = pathToFileURL(path.join(rendererDirectory, 'index.html')).href;
let window;
let store;
let canvas;
let lastRecoveryNotice;
const closeGuard = createWindowCloseGuard({
  requestSave: payload => window.webContents.send('coordinator:before-close', payload),
  closeWindow: () => window.close(),
  quitApp: () => app.quit(),
  showWindow: () => { window.show(); window.focus(); },
});
// Optional alternate profile for isolated smoke tests or separate local workspaces.
if (process.env.COORDINATOR_USER_DATA) app.setPath('userData', path.resolve(process.env.COORDINATOR_USER_DATA));
const ownsWorkspace = app.requestSingleInstanceLock();
if (!ownsWorkspace) app.quit();
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});

function trustedSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) {
    throw new Error('La solicitud no procede de la ventana de coordinación.');
  }
}

async function showRecoveryNotice() {
  if (store.recoveryNotice && store.recoveryNotice !== lastRecoveryNotice) {
    lastRecoveryNotice = store.recoveryNotice;
    await dialog.showMessageBox(window, { type: 'warning', title: 'Espacio de trabajo recuperado', message: store.recoveryNotice });
  }
}

function registerIpc() {
  ipcMain.on('coordinator:ready-to-close', (event, payload) => {
    try { trustedSender(event); } catch { return; }
    closeGuard.complete(payload);
  });
  const handle = (name, callback) => ipcMain.handle(`coordinator:${name}`, async (event, payload) => {
    trustedSender(event);
    return callback(payload);
  });
  handle('load', async () => {
    const state = await store.load();
    await showRecoveryNotice();
    return state;
  });
  handle('save', async state => {
    const result = await store.save(state);
    await showRecoveryNotice();
    return result;
  });
  handle('info', () => ({ dataPath: store.file, version: app.getVersion(), recoveryNotice: store.recoveryNotice }));
  handle('canvas-status', () => canvas.status());
  handle('canvas-connect', input => canvas.connect(input));
  handle('canvas-sync', options => canvas.sync(options));
  handle('canvas-disconnect', () => canvas.disconnect());
  handle('copy-text', async text => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
      throw new Error('El texto no es válido o es demasiado grande para copiarlo (máximo 1 MB).');
    }
    await clipboard.writeText(text);
    return { ok: true };
  });
  handle('import-canvas', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Importar datos locales de Canvas Manager',
      defaultPath: await defaultCanvasCacheDirectory(),
      properties: ['openDirectory'],
      buttonLabel: 'Importar cursos locales',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importCanvasDirectory(result.filePaths[0]);
  });
  handle('open-gmail', async payload => {
    if (!payload || typeof payload !== 'object') throw new Error('Elige los destinatarios y el correo que quieres abrir.');
    const draftUrl = buildGmailUrl({ to: payload.to, bcc: payload.bcc, subject: payload.subject, body: payload.body });
    const url = new URL(draftUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com' || url.port || url.username || url.password) {
      throw new Error('Esta aplicación solo puede abrir enlaces para redactar correos en Gmail.');
    }
    if (draftUrl.length > 16000) {
      throw new Error('El correo es demasiado largo para abrirlo mediante un enlace de Gmail. Selecciona menos estudiantes, acorta el mensaje o copia el correo y la lista CCO en Gmail. No se ha recortado ningún dato.');
    }
    await shell.openExternal(draftUrl);
    return { ok: true };
  });
}

function createWindow() {
  closeGuard.reset();
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1060, minHeight: 700,
    title: 'Campus Coordinator', backgroundColor: '#f6f5f1', show: false,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => { if (process.env.COORDINATOR_START_HIDDEN !== '1') window.show(); });
  window.on('close', event => closeGuard.beforeClose(event));
  window.on('closed', () => { window = null; canvas?.dispose(); });
  window.loadURL(rendererUrl);
}

app.whenReady().then(() => {
  if (!ownsWorkspace) return;
  if (process.platform === 'darwin') {
    // Native roles provide standard Command shortcuts in both the editor and
    // Canvas login windows without exposing reload or developer tools.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Archivo', submenu: [{ role: 'close', label: 'Cerrar ventana' }] },
      { role: 'editMenu', label: 'Edición' },
      { label: 'Visualización', submenu: [
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ] },
      { role: 'windowMenu', label: 'Ventana' },
    ]));
  }
  store = new WorkspaceStore(app.getPath('userData'));
  const rendererSession = session.defaultSession;
  rendererSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (url.protocol === 'file:') {
        const relative = path.relative(rendererDirectory, fileURLToPath(url));
        allowed = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
      }
    } catch { /* Reject malformed requests. */ }
    callback({ cancel: !allowed });
  });
  rendererSession.on('will-download', event => event.preventDefault());
  canvas = new CanvasService({ userData: app.getPath('userData'),
    session: session.fromPartition(CANVAS_PARTITION), BrowserWindow, safeStorage,
    getParent: () => window,
    onProgress: progress => {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('coordinator:canvas-progress', progress);
      }
    },
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (!window) createWindow();
    else {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => closeGuard.beforeQuit());
app.on('will-quit', () => canvas?.dispose());
