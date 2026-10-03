import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvasClient, normalizeCanvasBase } from './canvas-client.js';

export const CANVAS_PARTITION = 'persist:coordinator-canvas';

const emptyStatus = () => ({ connected: false, baseUrl: '', user: null, mode: null,
  connecting: false, syncing: false, lastSyncedAt: null, error: null, credentialStorage: null });
const cancelled = () => Object.assign(new Error('Operación de Canvas cancelada.'), { name: 'AbortError' });
const isAuthError = error => error?.status === 401 || /auth|session_expired|token_invalid/.test(String(error?.kind || error?.code || ''));
const cleanUser = user => {
  if (!user || user.id == null) throw new Error('Invalid Canvas profile');
  return { id: String(user.id), name: String(user.name || '').slice(0, 500), email: String(user.email || '').slice(0, 500) };
};

function publicError(error) {
  if (isAuthError(error)) return 'La sesión de Canvas ha caducado o no es válida. Vuelve a conectar Canvas.';
  if (error?.status === 403) return 'Tu cuenta no tiene permiso para acceder a estos datos de Canvas.';
  if (error?.code === 'LOGIN_BLOCKED') return 'El proveedor de acceso no permite esta ventana. Usa la opción de token personal de Canvas.';
  if (error?.code === 'LOGIN_TIMEOUT') return 'El inicio de sesión ha caducado. Vuelve a conectar Canvas.';
  return 'No se ha podido conectar con Canvas. Revisa tu conexión; los datos guardados siguen disponibles.';
}

function secureUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

/** Remote Canvas/SSO content gets a separate, sandboxed window without a preload. */
export function openCanvasLogin({ BrowserWindow, baseUrl, parent, whoAmI, signal, timeoutMs = 10 * 60_000, pollMs = 2500 }) {
  let loginWindow;
  let settled = false;
  let checking = false;
  let interval;
  let timeout;
  let resolve;
  let reject;
  const children = new Set();
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const finish = (error, user) => {
    if (settled) return;
    settled = true;
    clearInterval(interval);
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    for (const child of children) if (!child.isDestroyed()) child.destroy();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
    if (error) reject(error); else resolve(user);
  };
  const abort = () => finish(cancelled());
  const check = async () => {
    if (settled || checking) return;
    checking = true;
    try { const user = cleanUser(await whoAmI()); if (!settled) finish(null, user); }
    catch { /* A login page is expected until authentication succeeds. */ }
    finally { checking = false; }
  };
  const preferences = { partition: CANVAS_PARTITION, sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false };
  const guard = contents => {
    const navigation = (event, target) => {
      const url = target || event.url;
      if (!secureUrl(url)) event.preventDefault();
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'accounts.google.com' && /denied|rejected/i.test(parsed.pathname)) {
          finish(Object.assign(new Error('Embedded login blocked'), { code: 'LOGIN_BLOCKED' }));
        }
      } catch { /* Invalid navigation has already been blocked. */ }
    };
    contents.on('will-navigate', navigation);
    contents.on('will-redirect', navigation);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-navigate', (_event, url) => {
      try {
        if (new URL(url).origin === baseUrl) void check();
        if (secureUrl(url) && !loginWindow.isDestroyed()) loginWindow.setTitle(`Iniciar sesión — ${new URL(url).hostname}`);
      } catch { /* Navigation is still in progress. */ }
    });
    contents.on('did-navigate-in-page', () => { void check(); });
    contents.on('did-finish-load', () => { void check(); });
    contents.on('render-process-gone', () => finish(new Error('Login window unavailable')));
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new Error('Login page unavailable'));
    });
  };
  try {
    loginWindow = new BrowserWindow({ width: 560, height: 760, show: false,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      title: 'Iniciar sesión en Canvas', autoHideMenuBar: true, webPreferences: preferences });
    loginWindow.setMenuBarVisibility(false);
    guard(loginWindow.webContents);
    loginWindow.webContents.setWindowOpenHandler(({ url }) => secureUrl(url) ? {
      action: 'allow', overrideBrowserWindowOptions: { parent: loginWindow, width: 520, height: 740,
        autoHideMenuBar: true, webPreferences: { ...preferences } },
    } : { action: 'deny' });
    loginWindow.webContents.on('did-create-window', child => {
      children.add(child);
      child.on('closed', () => children.delete(child));
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      guard(child.webContents);
    });
    loginWindow.once('ready-to-show', () => { if (!settled) loginWindow.show(); });
    loginWindow.on('closed', () => finish(cancelled()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (!settled) {
      interval = setInterval(() => { void check(); }, pollMs);
      timeout = setTimeout(() => finish(Object.assign(new Error('Login timed out'), { code: 'LOGIN_TIMEOUT' })), timeoutMs);
      interval.unref?.();
      timeout.unref?.();
      loginWindow.loadURL(`${baseUrl}/login`).catch(error => {
        if (error?.code !== 'ERR_ABORTED' && error?.errno !== -3) finish(new Error('Login page unavailable'));
      });
    }
  } catch { finish(new Error('Login window unavailable')); }
  return { promise, close: abort, focus: () => { if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.show(); loginWindow.focus(); } } };
}

/** Main-process owner of authentication. No credential is returned by this API. */
export class CanvasService {
  constructor({ userData, session, BrowserWindow, safeStorage, getParent = () => null,
    onProgress = () => {}, clientFactory = createCanvasClient, loginFactory = openCanvasLogin }) {
    this.file = path.join(userData, 'canvas-connection.json');
    this.session = session;
    this.BrowserWindow = BrowserWindow;
    this.safeStorage = safeStorage;
    this.getParent = getParent;
    this.onProgress = onProgress;
    this.clientFactory = clientFactory;
    this.loginFactory = loginFactory;
    this.state = emptyStatus();
    this.token = null;
    this.generation = 0;
    this.pendingWrite = Promise.resolve();
    this.pendingCleanup = Promise.resolve();
    this.configureSession();
    this.ready = this.restore();
  }

  configureSession() {
    this.session.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler?.(() => false);
    this.session.on?.('will-download', event => event.preventDefault());
    // The login partition can reach Canvas and HTTPS identity providers only.
    this.session.webRequest?.onBeforeRequest((details, callback) => {
      callback({ cancel: !secureUrl(details.url) && !/^(?:about:blank|data:|blob:)/.test(details.url) });
    });
  }

  encryptedStorageAvailable() {
    try {
      return this.safeStorage?.isEncryptionAvailable() === true && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch { return false; }
  }

  snapshot() { return structuredClone(this.state); }
  notify() { this.onProgress({ phase: 'connection', status: this.snapshot() }); }
  async status() { await this.ready; return this.snapshot(); }

  makeClient(baseUrl = this.state.baseUrl, token = this.token, { authCheck = false } = {}) {
    return this.clientFactory({ baseUrl, timeoutMs: authCheck ? 12000 : 30000, maxRetries: authCheck ? 0 : 2,
      fetchImpl: (url, init = {}) => {
        const target = new URL(url);
        if (target.origin !== baseUrl || !target.pathname.startsWith('/api/v1/') || target.username || target.password || (init.method && init.method !== 'GET')) {
          throw new Error('Only read-only Canvas API requests are allowed.');
        }
        return this.session.fetch(url, { ...init, credentials: token ? 'omit' : 'include', redirect: 'manual' });
      },
      getHeaders: async () => {
        if (token) return { Authorization: `Bearer ${token}` };
        const cookies = await this.session.cookies.get({ url: baseUrl });
        const csrf = cookies.find(cookie => cookie.name === '_csrf_token');
        if (!csrf) return {};
        let value = csrf.value;
        try { value = decodeURIComponent(value); } catch { /* Some Canvas installations use literal cookie values. */ }
        return { 'X-CSRF-Token': value };
      },
    });
  }

  async restore() {
    const generation = this.generation;
    try {
      let saved;
      try {
        const content = await fs.readFile(this.file, 'utf8');
        if (content.length > 1_000_000) return;
        saved = JSON.parse(content);
      } catch { return; }
      if (saved.version !== 1 || !['session', 'token'].includes(saved.mode)) return;
      const baseUrl = normalizeCanvasBase(saved.baseUrl);
      Object.assign(this.state, { baseUrl, mode: saved.mode,
        user: saved.user ? cleanUser(saved.user) : null, lastSyncedAt: saved.lastSyncedAt || null });
      let secrets = {};
      if (saved.encrypted && this.encryptedStorageAvailable()) {
        try { secrets = JSON.parse(this.safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64'))); }
        catch { /* An OS key change requires a fresh login. */ }
      }
      if (saved.mode === 'token') {
        this.token = typeof secrets.token === 'string' ? secrets.token : null;
        this.state.credentialStorage = this.token ? 'encrypted' : 'memory';
        if (!this.token) {
          this.state.error = 'Vuelve a introducir el token de Canvas. No había almacenamiento cifrado disponible o la clave del sistema ha cambiado.';
          return;
        }
      } else {
        this.state.credentialStorage = saved.encrypted ? 'encrypted' : 'session';
        for (const cookie of Array.isArray(secrets.cookies) ? secrets.cookies : []) {
          if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue;
          try {
            await this.session.cookies.set({ url: baseUrl, name: cookie.name, value: cookie.value,
              path: cookie.path || '/', secure: true, httpOnly: !!cookie.httpOnly,
              sameSite: cookie.sameSite || 'lax', ...(Number.isFinite(cookie.expirationDate) ? { expirationDate: cookie.expirationDate } : {}) });
          } catch { /* Skip a malformed or expired cookie. */ }
        }
      }
      if (generation !== this.generation) return;
      this.controller = new AbortController();
      const user = await this.makeClient(baseUrl, this.token, { authCheck: true }).getProfile({ signal: this.controller.signal });
      if (generation !== this.generation) return;
      Object.assign(this.state, { user: cleanUser(user), connected: true, error: null });
    } catch (error) {
      if (generation === this.generation) {
        this.state.connected = false;
        this.state.error = publicError(error);
      }
    } finally { if (generation === this.generation) this.notify(); }
  }

  async persist(generation = this.generation) {
    if (generation !== this.generation) return;
    const saved = { version: 1, baseUrl: this.state.baseUrl, mode: this.state.mode,
      user: this.state.user, lastSyncedAt: this.state.lastSyncedAt };
    const token = this.token;
    if (this.encryptedStorageAvailable()) {
      const secrets = token ? { token } : { cookies: (await this.session.cookies.get({ url: this.state.baseUrl }))
        .filter(cookie => String(cookie.domain || '').replace(/^\./, '') === new URL(this.state.baseUrl).hostname)
        .map(({ name, value, path: cookiePath, httpOnly, sameSite, expirationDate }) =>
          ({ name, value, path: cookiePath, httpOnly, sameSite, expirationDate })) };
      if (generation !== this.generation) return;
      saved.encrypted = this.safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
      this.state.credentialStorage = 'encrypted';
    } else this.state.credentialStorage = token ? 'memory' : 'session';
    if (generation !== this.generation) return;
    const contents = JSON.stringify(saved, null, 2);
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(`${this.file}.tmp`, contents, { mode: 0o600 });
      await fs.rename(`${this.file}.tmp`, this.file);
    });
    await this.pendingWrite;
    await this.session.cookies.flushStore?.();
  }

  cancelActive() {
    this.generation += 1;
    this.controller?.abort();
    this.login?.close();
    this.login = null;
    this.activeSync = null;
  }

  async connect(input = {}) {
    const baseUrl = normalizeCanvasBase(input.baseUrl);
    if (input.token != null && (typeof input.token !== 'string' || input.token.length > 4096)) throw new Error('El token de Canvas no es válido.');
    const token = input.token?.trim() || null;
    if (token && /[\s\x00-\x1f\x7f]/.test(token)) throw new Error('Copia el token de Canvas completo, sin espacios.');
    await this.ready;
    if (this.state.connecting && this.state.baseUrl === baseUrl && !token && this.activeConnect) {
      this.login?.focus();
      return this.activeConnect;
    }
    this.cancelActive();
    const generation = this.generation;
    const previousBase = this.state.baseUrl;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.token = token;
    this.state = { ...emptyStatus(), baseUrl, mode: token ? 'token' : 'session', connecting: true };
    this.notify();
    const operation = (async () => {
      try {
        // Remove old persisted credentials before selecting another account or host.
        await this.cleanupConnection(!!previousBase && previousBase !== baseUrl);
        if (generation !== this.generation) throw cancelled();
        const client = this.makeClient(baseUrl, token, { authCheck: true });
        let user;
        try { user = await client.getProfile({ signal }); }
        catch (error) {
          if (signal.aborted || token) throw error;
          this.login = this.loginFactory({ BrowserWindow: this.BrowserWindow, baseUrl,
            parent: this.getParent(), whoAmI: () => client.getProfile({ signal }), signal });
          user = await this.login.promise;
        }
        if (generation !== this.generation) throw cancelled();
        Object.assign(this.state, { user: cleanUser(user), connected: true, connecting: false, error: null });
        await this.persist(generation);
      } catch (error) {
        if (generation === this.generation) {
          Object.assign(this.state, { connected: false, connecting: false,
            error: error?.name === 'AbortError' ? null : publicError(error), cancelled: error?.name === 'AbortError' });
          this.token = null;
        }
      } finally {
        if (generation === this.generation) { this.controller.abort(); this.login = null; this.activeConnect = null; this.notify(); }
      }
      return this.snapshot();
    })();
    this.activeConnect = operation;
    return operation;
  }

  async sync(options = {}) {
    await this.ready;
    if (this.activeSync) return this.activeSync;
    if (this.state.connecting) throw new Error('Termina de iniciar sesión en Canvas antes de sincronizar.');
    if (!this.state.baseUrl || !this.state.mode || (this.state.mode === 'token' && !this.token)) {
      throw new Error('Conecta Canvas para sincronizar tus cursos.');
    }
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.state.syncing = true;
    this.state.error = null;
    this.notify();
    const operation = (async () => {
      try {
        const result = await this.makeClient().sync({ startDate: options?.startDate, endDate: options?.endDate,
          signal: controller.signal, onProgress: progress => { if (generation === this.generation) this.onProgress(progress); } });
        if (generation !== this.generation) throw cancelled();
        Object.assign(this.state, { user: cleanUser(result.user), connected: true, lastSyncedAt: result.syncedAt, error: null });
        await this.persist(generation);
        if (generation !== this.generation) throw cancelled();
        return result;
      } catch (error) {
        if (generation !== this.generation || error?.name === 'AbortError') throw cancelled();
        this.state.connected = false;
        this.state.error = publicError(error);
        throw new Error(this.state.error);
      } finally {
        if (generation === this.generation) { this.state.syncing = false; this.activeSync = null; this.notify(); }
      }
    })();
    this.activeSync = operation;
    return operation;
  }

  async removeSavedConnection() {
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(async () => {
      await fs.rm(this.file, { force: true });
      await fs.rm(`${this.file}.tmp`, { force: true });
    });
    await this.pendingWrite;
  }

  cleanupConnection(clearSession) {
    this.pendingCleanup = this.pendingCleanup.catch(() => {}).then(async () => {
      await this.removeSavedConnection();
      if (clearSession) {
        await this.session.clearStorageData();
        await this.session.clearCache?.();
      }
    });
    return this.pendingCleanup;
  }

  async disconnect() {
    await this.ready;
    this.cancelActive();
    this.token = null;
    this.state = emptyStatus();
    await this.cleanupConnection(true);
    this.notify();
    return this.snapshot();
  }

  dispose() { this.cancelActive(); this.state.connecting = false; this.state.syncing = false; }
}
