import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'coordinator-electron-smoke-'));
const profile = path.join(temporary, 'profile');
const cache = path.join(temporary, 'canvas-cache');
await fs.mkdir(profile);
await fs.mkdir(cache);
const fixture = { version: 1, courses: [], templates: [], drafts: [],
  settings: { name: 'Smoke coordinator', email: 'coordinator@example.edu', signature: 'Academic office' }, composer: null };
await fs.writeFile(path.join(cache, 'courses.json'), JSON.stringify({ userId: '42', savedAt: 10, data: [{ id: 7, name: 'Test course' }] }));
await fs.writeFile(path.join(cache, 'content-7.json'), JSON.stringify({ userId: 42, savedAt: 20,
  data: { modules: [{ id: 1, name: 'Study before class', position: 1, items: [] }], pages: [] } }));
const env = { ...process.env, COORDINATOR_USER_DATA: profile, COORDINATOR_START_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  const packaged = process.env.COORDINATOR_PACKAGED_APP;
  const executablePath = packaged || process.env.COORDINATOR_ELECTRON_PATH;
  app = await electron.launch({ args: packaged ? [] : [root], env, timeout: 45000,
    ...(executablePath ? { executablePath } : {}) });
  const appInfo = await app.evaluate(({ app }) => ({ path: app.getAppPath(), packaged: app.isPackaged }));
  if (packaged) {
    assert.equal(appInfo.packaged, true, 'The installed bundle must run without the source checkout.');
    assert.equal(path.basename(appInfo.path), 'app.asar');
  } else assert.equal(path.resolve(appInfo.path), root, 'Electron must load the coordinator project.');
  let page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('h1');
  assert.match(await page.locator('h1').innerText(), /correo/);
  assert.equal(await page.evaluate(() => typeof window.coordinator?.load), 'function');
  for (const name of ['canvasStatus', 'canvasConnect', 'canvasSync', 'canvasDisconnect', 'onCanvasProgress']) {
    assert.equal(await page.evaluate(key => typeof window.coordinator?.[key], name), 'function');
  }
  assert.equal((await page.evaluate(() => window.coordinator.canvasStatus())).connected, false);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  if (process.platform === 'darwin') {
    const roles = await app.evaluate(({ Menu }) => {
      const collect = menu => menu.items.flatMap(item => [item.role?.toLowerCase(), ...(item.submenu ? collect(item.submenu) : [])]);
      return collect(Menu.getApplicationMenu());
    });
    for (const role of ['quit', 'close', 'copy', 'paste', 'selectall', 'undo']) assert.ok(roles.includes(role), `Native Mac menu needs ${role}.`);
  }
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, webSecurity: prefs.webSecurity };
  });
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  const info = await page.evaluate(() => window.coordinator.info());
  assert.equal(info.dataPath, path.join(profile, 'workspace.json'));
  assert.equal(await page.evaluate(() => window.coordinator.load()), null);
  const saved = await page.evaluate(state => window.coordinator.save(state), fixture);
  assert.equal(saved.path, path.join(profile, 'workspace.json'));
  assert.deepEqual(await page.evaluate(() => window.coordinator.load()), fixture);
  assert.deepEqual(JSON.parse(await fs.readFile(saved.path, 'utf8')), fixture);

  // Stub OS integration in the main process: no dialog or Gmail browser is opened.
  await app.evaluate(({ dialog, shell, clipboard }, directory) => {
    globalThis.smokeOpenedUrls = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    shell.openExternal = async url => { globalThis.smokeOpenedUrls.push(url); };
    clipboard.writeText = text => { globalThis.smokeCopiedText = text; };
  }, cache);
  const imported = await page.evaluate(() => window.coordinator.importCanvas());
  assert.equal(imported.courses[0].name, 'Test course');
  assert.equal(imported.courses[0].modules[0].name, 'Study before class');
  assert.equal(imported.warnings.length, 0);
  await page.evaluate(() => window.coordinator.openGmail({ to: 'coordinator@example.edu', bcc: ['student@example.edu'], subject: 'Class details', body: 'Read unit 1.' }));
  const opened = await app.evaluate(() => globalThis.smokeOpenedUrls);
  assert.equal(opened.length, 1);
  const gmail = new URL(opened[0]);
  assert.equal(gmail.origin, 'https://mail.google.com');
  assert.equal(gmail.searchParams.get('to'), 'coordinator@example.edu');
  assert.equal(gmail.searchParams.get('bcc'), 'student@example.edu');
  await assert.rejects(page.evaluate(() => window.coordinator.openGmail({ to: 'coordinator@example.edu', bcc: ['student@example.edu'], subject: 'Long', body: 'x'.repeat(17000) })), /demasiado largo/);
  await assert.rejects(page.evaluate(() => window.coordinator.openGmail({ to: 'coordinator@example.edu', bcc: ['invalid'], subject: 'Invalid', body: '' })), /correo electrónico no válido/);
  assert.equal(await app.evaluate(() => globalThis.smokeOpenedUrls.length), 1);
  await page.evaluate(() => window.coordinator.copyText('Asunto: Clase\nCCO: student@example.edu\nTexto del correo.'));
  assert.match(await app.evaluate(() => globalThis.smokeCopiedText), /CCO: student@example.edu/);
  await assert.rejects(page.evaluate(() => window.coordinator.copyText('x'.repeat(1024 * 1024 + 1))), /demasiado grande/);
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = async () => { throw new Error('Synthetic clipboard failure'); };
  });
  await assert.rejects(page.evaluate(() => window.coordinator.copyText('Clipboard retry')), /Synthetic clipboard failure/);

  // Exercise the actual Canvas service/IPC/client using a fake dedicated-session transport.
  // All responses are synthetic; this test never contacts a real university.
  await app.evaluate(({ session }) => {
    globalThis.smokeCanvasRequests = [];
    session.fromPartition('persist:coordinator-canvas').fetch = async (url, init) => {
      globalThis.smokeCanvasRequests.push({ url, method: init.method || 'GET', credentials: init.credentials });
      const route = new URL(url).pathname;
      let body = [];
      if (route === '/api/v1/users/self/profile') body = { id: 41, name: 'Canvas coordinator', primary_email: 'coordinator@example.edu' };
      else if (route === '/api/v1/courses') body = [{ id: 9, name: 'Live Canvas course', course_code: 'LIVE9' }];
      else if (route === '/api/v1/courses/9/modules') body = [{ id: 91, name: 'Study unit', position: 1, items: [], items_count: 0 }];
      else if (route === '/api/v1/courses/9/users') body = [{ id: 81, name: 'Canvas student', email: 'student@example.edu' }];
      const response = new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
  });
  await page.evaluate(() => {
    window.smokeCanvasProgress = [];
    window.smokeStopCanvasProgress = window.coordinator.onCanvasProgress(progress => window.smokeCanvasProgress.push(progress));
  });
  const connection = await page.evaluate(() => window.coordinator.canvasConnect({ baseUrl: 'https://canvas.example.edu', token: 'synthetic-test-token' }));
  assert.equal(connection.connected, true);
  assert.equal(connection.user.id, '41');
  assert.equal(JSON.stringify(connection).includes('synthetic-test-token'), false);
  const live = await page.evaluate(() => window.coordinator.canvasSync());
  assert.equal(live.courses.length, 1);
  assert.equal(live.courses[0].name, 'Live Canvas course');
  assert.equal(live.courses[0].students[0].email, 'student@example.edu');
  assert.ok((await page.evaluate(() => window.smokeCanvasProgress)).length > 0);
  const requests = await app.evaluate(() => globalThis.smokeCanvasRequests);
  assert.ok(requests.length >= 4);
  assert.ok(requests.every(request => request.method === 'GET' && request.credentials === 'omit'));
  assert.equal((await fs.readFile(path.join(profile, 'canvas-connection.json'), 'utf8')).includes('synthetic-test-token'), false);
  const disconnected = await page.evaluate(() => window.coordinator.canvasDisconnect());
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.user, null);
  await assert.rejects(fs.readFile(path.join(profile, 'canvas-connection.json')), { code: 'ENOENT' });
  await page.evaluate(() => window.smokeStopCanvasProgress());

  // Inspect a real embedded login window without loading remote content.
  await app.evaluate(({ BrowserWindow, session }) => {
    const canvasSession = session.fromPartition('persist:coordinator-canvas');
    globalThis.smokeCanvasFetch = canvasSession.fetch;
    canvasSession.fetch = async () => new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    globalThis.smokeOriginalLoadUrl = BrowserWindow.prototype.loadURL;
    BrowserWindow.prototype.loadURL = function(url, options) {
      if (url === 'https://canvas.example.edu/login') return Promise.resolve();
      return globalThis.smokeOriginalLoadUrl.call(this, url, options);
    };
  });
  await page.evaluate(() => {
    window.smokeCanvasLogin = window.coordinator.canvasConnect({ baseUrl: 'https://canvas.example.edu' });
  });
  await page.waitForFunction(async () => (await window.coordinator.canvasStatus()).connecting);
  let loginPreferences;
  for (let attempt = 0; attempt < 50 && !loginPreferences; attempt++) {
    loginPreferences = await app.evaluate(({ BrowserWindow, session }) => {
      const login = BrowserWindow.getAllWindows().find(win => win.webContents.session === session.fromPartition('persist:coordinator-canvas'));
      if (!login) return null;
      const prefs = login.webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, preload: prefs.preload || null };
    });
    if (!loginPreferences) await page.waitForTimeout(50);
  }
  assert.deepEqual(loginPreferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: null });
  await app.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.getAllWindows().find(win => win.webContents.session === session.fromPartition('persist:coordinator-canvas')).close();
  });
  const cancelledLogin = await page.evaluate(() => window.smokeCanvasLogin);
  assert.equal(cancelledLogin.cancelled, true);
  assert.equal(cancelledLogin.connecting, false);
  await app.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.prototype.loadURL = globalThis.smokeOriginalLoadUrl;
    session.fromPartition('persist:coordinator-canvas').fetch = globalThis.smokeCanvasFetch;
  });
  await page.evaluate(() => window.coordinator.canvasDisconnect());

  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://example.com/'); return 'allowed'; } catch { return 'blocked'; }
  }), 'blocked');
  await page.evaluate(() => window.open('https://example.com/', '_blank'));
  assert.equal(app.windows().length, 1);
  await page.reload();
  await page.waitForSelector('h1');
  assert.match(await page.locator('.profile').innerText(), /Smoke coordinator/);

  // A failed flush must cancel Quit and keep the desktop window usable.
  await page.evaluate(() => window.coordinator.onBeforeClose(async () => {
    window.smokeCloseBlocked = true;
    return false;
  }));
  await app.evaluate(({ app }) => app.quit());
  await page.waitForFunction(() => window.smokeCloseBlocked === true);
  assert.equal(app.windows().length, 1);

  // Restore the real UI handler, then close before its debounce can save.
  await page.reload();
  await page.waitForSelector('h1');
  await page.locator('[data-action="nav"][data-view="settings"]').click();
  await page.locator('[data-setting="name"]').fill('Flushed on native close');
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  assert.equal(JSON.parse(await fs.readFile(saved.path, 'utf8')).settings.name, 'Flushed on native close');
  if (process.platform === 'darwin') {
    // Closing the final Mac window keeps the process alive; the Dock reopens it.
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app }) => app.emit('activate'));
    page = await reopened;
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('h1');
    assert.match(await page.locator('.profile').innerText(), /Flushed on native close/);
    await page.locator('[data-action="nav"][data-view="settings"]').click();
    await page.locator('[data-setting="name"]').fill('Flushed on Command-Q');
    const quit = app.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
    await quit;
    assert.equal(JSON.parse(await fs.readFile(saved.path, 'utf8')).settings.name, 'Flushed on Command-Q');
  }
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: sandboxed renderer, isolated persistence/reload, live Canvas IPC/sync with synthetic responses, sandboxed login/cancellation, private credentials/disconnect, native cache import, Gmail BCC handoff/limits, blocked renderer network/popups, and save-on-close handshake.');
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
