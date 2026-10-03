import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { CANVAS_PARTITION, CanvasService, openCanvasLogin } from '../electron/canvas-service.js';

const baseUrl = 'https://campus.example.edu';
const user = { id: '41', name: 'Coordinator', email: 'coordinator@example.edu' };
const authError = () => Object.assign(new Error('Untrusted server content'), { status: 401 });
const safeStorage = { isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from([...text].reverse().join('')),
  decryptString: data => [...data.toString()].reverse().join('') };
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fakeSession() {
  const session = new EventEmitter();
  session.cookieList = [];
  session.cookies = { get: async () => session.cookieList,
    set: async cookie => session.cookieList.push({ ...cookie, domain: new URL(cookie.url).hostname }), flushStore: async () => {} };
  session.clearStorageData = async () => { session.cookieList = []; session.cleared = true; };
  session.clearCache = async () => {};
  session.setPermissionRequestHandler = callback => { session.permissionRequest = callback; };
  session.setPermissionCheckHandler = callback => { session.permissionCheck = callback; };
  session.webRequest = { onBeforeRequest: callback => { session.requestFilter = callback; } };
  session.fetch = async (_url, init) => { session.lastFetch = init; return { ok: true }; };
  return session;
}

async function setup(t, overrides = {}) {
  const userData = overrides.userData || await fs.mkdtemp(path.join(os.tmpdir(), 'coordinator-canvas-auth-'));
  if (!overrides.userData) t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const session = overrides.session || fakeSession();
  const clients = [];
  const progress = [];
  const service = new CanvasService({ userData, session, safeStorage,
    clientFactory: options => {
      clients.push(options);
      return { getProfile: async () => user, sync: async () => ({ courses: [], user, syncedAt: '2026-10-03T10:00:00Z', baseUrl, warnings: [] }) };
    }, onProgress: event => progress.push(event), ...overrides });
  t.after(() => service.dispose());
  await service.ready;
  return { service, session, clients, progress, userData };
}

test('an unconfigured app makes no Canvas requests and its dedicated session denies permissions and insecure requests', async t => {
  const { service, clients, session } = await setup(t);
  assert.equal((await service.status()).connected, false);
  assert.equal(clients.length, 0);
  assert.equal(session.permissionCheck(), false);
  session.permissionRequest(null, 'camera', accepted => assert.equal(accepted, false));
  session.requestFilter({ url: `${baseUrl}/login` }, result => assert.equal(result.cancel, false));
  session.requestFilter({ url: 'https://sso.example.edu/login' }, result => assert.equal(result.cancel, false));
  for (const url of ['http://campus.example.edu', 'file:///C:/private', 'https://user:password@example.edu']) {
    session.requestFilter({ url }, result => assert.equal(result.cancel, true));
  }
});

test('a personal token is encrypted locally, restored, and never included in status or progress', async t => {
  const { service, clients, progress, userData } = await setup(t);
  const token = 'test-token-secret-012345';
  const status = await service.connect({ baseUrl, token });
  assert.equal(status.connected, true);
  assert.equal(status.credentialStorage, 'encrypted');
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(JSON.stringify(progress).includes(token), false);
  assert.equal((await clients[0].getHeaders()).Authorization, `Bearer ${token}`);
  const persisted = await fs.readFile(service.file, 'utf8');
  assert.equal(persisted.includes(token), false);
  assert.ok(JSON.parse(persisted).encrypted);
  const restored = await setup(t, { userData });
  assert.equal((await restored.service.status()).connected, true);
  assert.equal((await restored.clients[0].getHeaders()).Authorization, `Bearer ${token}`);
});

test('unavailable encryption keeps the token in memory only and never falls back to plaintext', async t => {
  const unencrypted = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' };
  const { service, userData } = await setup(t, { safeStorage: unencrypted });
  const token = 'memory-token-123';
  const status = await service.connect({ baseUrl, token });
  assert.equal(status.connected, true);
  assert.equal(status.credentialStorage, 'memory');
  assert.equal((await fs.readFile(service.file, 'utf8')).includes(token), false);
  assert.equal(JSON.parse(await fs.readFile(service.file, 'utf8')).encrypted, undefined);
  const restored = await setup(t, { userData, safeStorage: unencrypted });
  assert.equal((await restored.service.status()).connected, false);
  assert.match((await restored.service.status()).error, /token/);
  assert.equal(restored.clients.length, 0);
});

test('API transports are read-only, same-origin, use manual redirects and keep token requests free of cookies', async t => {
  const { service, clients, session } = await setup(t);
  await service.connect({ baseUrl, token: 'secret-token' });
  await clients[0].fetchImpl(`${baseUrl}/api/v1/courses`, { method: 'GET', redirect: 'follow' });
  assert.equal(session.lastFetch.redirect, 'manual');
  assert.equal(session.lastFetch.credentials, 'omit');
  assert.throws(() => clients[0].fetchImpl('https://other.example.edu/api/v1/courses'), /read-only/);
  assert.throws(() => clients[0].fetchImpl(`${baseUrl}/api/v1/users/self/tokens`, { method: 'POST' }), /read-only/);
  assert.throws(() => clients[0].fetchImpl(`${baseUrl}/login`), /read-only/);
});

test('browser login verifies the account and restores only encrypted Canvas cookies', async t => {
  const session = fakeSession();
  session.cookieList = [
    { name: 'canvas_session', value: 'private-cookie', domain: 'campus.example.edu', path: '/', httpOnly: true, sameSite: 'lax' },
    { name: '_csrf_token', value: 'csrf%2Bvalue', domain: 'campus.example.edu', path: '/' },
    { name: 'idp', value: 'idp-secret', domain: 'sso.example.edu', path: '/' },
  ];
  let loginCalls = 0;
  let options;
  const { service, userData } = await setup(t, { session,
    clientFactory: value => { options = value; return { getProfile: async () => { throw authError(); } }; },
    loginFactory: () => { loginCalls += 1; return { promise: Promise.resolve(user), close() {} }; },
  });
  const status = await service.connect({ baseUrl });
  assert.equal(status.mode, 'session');
  assert.equal(status.connected, true);
  assert.equal(loginCalls, 1);
  assert.deepEqual(await options.getHeaders(), { 'X-CSRF-Token': 'csrf+value' });
  await options.fetchImpl(`${baseUrl}/api/v1/courses`);
  assert.equal(session.lastFetch.credentials, 'include');
  const saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64')));
  assert.equal(secrets.cookies.length, 2);
  const restored = await setup(t, { userData });
  assert.equal((await restored.service.status()).connected, true);
  assert.equal(restored.session.cookieList.find(cookie => cookie.name === 'canvas_session').value, 'private-cookie');
});

test('closing login cancels connection cleanly without saving a credential', async t => {
  const { service } = await setup(t, {
    clientFactory: () => ({ getProfile: async () => { throw authError(); } }),
    loginFactory: () => ({ promise: Promise.reject(Object.assign(new Error('Closed'), { name: 'AbortError' })), close() {} }),
  });
  const status = await service.connect({ baseUrl });
  assert.equal(status.connected, false);
  assert.equal(status.connecting, false);
  assert.equal(status.cancelled, true);
  assert.equal(status.error, null);
  await assert.rejects(fs.readFile(service.file), { code: 'ENOENT' });
});

test('offline startup preserves cached account details but does not claim a live connection or expose raw errors', async t => {
  const { service, userData } = await setup(t);
  await service.connect({ baseUrl, token: 'private-token' });
  const restored = await setup(t, { userData, clientFactory: () => ({
    getProfile: async () => { throw new Error('Network failed: private-token'); },
  }) });
  const status = await restored.service.status();
  assert.equal(status.connected, false);
  assert.deepEqual(status.user, user);
  assert.match(status.error, /datos guardados/);
  assert.equal(JSON.stringify(status).includes('private-token'), false);
});

test('concurrent sync requests share one operation and persist the successful sync time', async t => {
  const work = deferred();
  let calls = 0;
  let syncOptions;
  const { service, progress } = await setup(t, { clientFactory: () => ({ getProfile: async () => user,
    sync: async options => { calls += 1; syncOptions = options; return work.promise; },
  }) });
  await service.connect({ baseUrl, token: 'private-token' });
  const first = service.sync({ startDate: '2026-10-01', endDate: '2026-11-01' });
  const second = service.sync();
  await turn();
  assert.equal(calls, 1);
  assert.equal((await service.status()).syncing, true);
  assert.equal(syncOptions.startDate, '2026-10-01');
  syncOptions.onProgress({ phase: 'courses', completed: 1, total: 2 });
  assert.ok(progress.some(event => event.phase === 'courses'));
  const result = { courses: [], user, syncedAt: '2026-10-03T10:00:00Z', warnings: [], baseUrl };
  work.resolve(result);
  assert.deepEqual(await first, result);
  assert.deepEqual(await second, result);
  assert.equal((await service.status()).syncing, false);
  assert.equal(JSON.parse(await fs.readFile(service.file, 'utf8')).lastSyncedAt, result.syncedAt);
});

test('disconnect aborts active work and rejects stale sync results without restoring authentication', async t => {
  const work = deferred();
  let options;
  const { service, session, progress } = await setup(t, { clientFactory: () => ({ getProfile: async () => user,
    sync: async value => { options = value; return work.promise; },
  }) });
  await service.connect({ baseUrl, token: 'private-token' });
  const sync = service.sync();
  const rejection = assert.rejects(sync, { name: 'AbortError' });
  await turn();
  await service.disconnect();
  assert.equal(options.signal.aborted, true);
  assert.equal(session.cleared, true);
  const before = progress.length;
  options.onProgress({ phase: 'stale' });
  assert.equal(progress.length, before);
  work.resolve({ courses: [{ name: 'Stale course' }], user, syncedAt: '2026-10-03', baseUrl, warnings: [] });
  await rejection;
  assert.equal((await service.status()).connected, false);
  assert.equal((await service.status()).user, null);
  await assert.rejects(fs.readFile(service.file), { code: 'ENOENT' });
});

test('changing Canvas accounts rejects old sync results and keeps the new account and host', async t => {
  const oldWork = deferred();
  const nextUser = { id: '90', name: 'Other coordinator', email: 'other@example.edu' };
  const nextBase = 'https://another.example.edu';
  const { service, session } = await setup(t, { clientFactory: options => ({
    getProfile: async () => options.baseUrl === nextBase ? nextUser : user,
    sync: async () => oldWork.promise,
  }) });
  await service.connect({ baseUrl, token: 'first-private-token' });
  const pending = service.sync();
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  await turn();
  await service.connect({ baseUrl: nextBase, token: 'second-private-token' });
  oldWork.resolve({ courses: [{ name: 'Previous account course' }], user, syncedAt: '2026-10-03', baseUrl, warnings: [] });
  await rejection;
  const status = await service.status();
  assert.deepEqual(status.user, nextUser);
  assert.equal(status.baseUrl, nextBase);
  assert.equal(status.connected, true);
  assert.equal(status.syncing, false);
  assert.equal(session.cleared, true);
  const saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.baseUrl, nextBase);
  assert.deepEqual(saved.user, nextUser);
});

test('expired credentials disconnect sync and preserve the previous successful data timestamp', async t => {
  let fail = false;
  const { service } = await setup(t, { clientFactory: () => ({ getProfile: async () => user,
    sync: async () => { if (fail) throw authError(); return { courses: [], user, syncedAt: '2026-10-03T10:00:00Z', baseUrl, warnings: [] }; },
  }) });
  await service.connect({ baseUrl, token: 'private-token' });
  await service.sync();
  fail = true;
  await assert.rejects(service.sync(), /caducado/);
  const status = await service.status();
  assert.equal(status.connected, false);
  assert.equal(status.syncing, false);
  assert.equal(status.lastSyncedAt, '2026-10-03T10:00:00Z');
});

class FakeWindow extends EventEmitter {
  static all = [];
  constructor(options) {
    super(); this.options = options; this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = callback => { this.popup = callback; };
    FakeWindow.all.push(this);
  }
  setMenuBarVisibility() {}
  setTitle() {}
  loadURL(url) { this.url = url; return Promise.resolve(); }
  show() {}
  focus() {}
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}

test('login and SSO popups have no privileged preload and are closed after verified authentication', async () => {
  FakeWindow.all = [];
  const login = openCanvasLogin({ BrowserWindow: FakeWindow, baseUrl, whoAmI: async () => user });
  const win = FakeWindow.all[0];
  assert.equal(win.url, `${baseUrl}/login`);
  const prefs = win.options.webPreferences;
  assert.equal(prefs.partition, CANVAS_PARTITION);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined);
  const popup = win.popup({ url: 'https://sso.example.edu/login' });
  assert.equal(popup.action, 'allow');
  assert.deepEqual(popup.overrideBrowserWindowOptions.webPreferences, prefs);
  assert.equal(win.popup({ url: 'file:///C:/private.txt' }).action, 'deny');
  let blocked = false;
  win.webContents.emit('will-redirect', { preventDefault() { blocked = true; } }, 'http://insecure.example.edu');
  assert.equal(blocked, true);
  const child = new FakeWindow(popup.overrideBrowserWindowOptions);
  win.webContents.emit('did-create-window', child);
  assert.equal(child.popup({ url: 'https://example.edu' }).action, 'deny');
  win.webContents.emit('did-finish-load');
  assert.deepEqual(await login.promise, user);
  assert.equal(win.destroyed, true);
  assert.equal(child.destroyed, true);
});

test('closing a login window or aborting its signal settles the login promise', async () => {
  const controller = new AbortController();
  const login = openCanvasLogin({ BrowserWindow: FakeWindow, baseUrl, signal: controller.signal,
    whoAmI: async () => { throw authError(); } });
  const rejection = assert.rejects(login.promise, { name: 'AbortError' });
  controller.abort();
  await rejection;
  const closed = openCanvasLogin({ BrowserWindow: FakeWindow, baseUrl, whoAmI: async () => { throw authError(); } });
  const closeRejection = assert.rejects(closed.promise, { name: 'AbortError' });
  FakeWindow.all.at(-1).destroy();
  await closeRejection;
});
