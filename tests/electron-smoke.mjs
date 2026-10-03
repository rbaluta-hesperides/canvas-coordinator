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
  app = await electron.launch({ args: [root], env, timeout: 45000,
    ...(process.env.COORDINATOR_ELECTRON_PATH ? { executablePath: process.env.COORDINATOR_ELECTRON_PATH } : {}) });
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getAppPath())), root, 'Electron must load the coordinator project.');
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('h1');
  assert.match(await page.locator('h1').innerText(), /correo/);
  assert.equal(await page.evaluate(() => typeof window.coordinator?.load), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
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

  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://example.com/'); return 'allowed'; } catch { return 'blocked'; }
  }), 'blocked');
  await page.evaluate(() => window.open('https://example.com/', '_blank'));
  assert.equal(app.windows().length, 1);
  await page.reload();
  await page.waitForSelector('h1');
  assert.match(await page.locator('.profile').innerText(), /Smoke coordinator/);

  // A failed flush must keep the desktop window open.
  await page.evaluate(() => window.coordinator.onBeforeClose(async () => {
    window.smokeCloseBlocked = true;
    return false;
  }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
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
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: sandboxed renderer, isolated persistence/reload, native cache import, Gmail BCC handoff/limits, blocked renderer network/popups, and save-on-close handshake.');
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
