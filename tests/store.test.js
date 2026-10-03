import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore, importCanvasDirectory, MAX_STATE_BYTES } from '../electron/store.js';

function workspace(name = 'Coordinator') {
  return { version: 1, courses: [], templates: [], drafts: [], settings: { name, email: 'coordinator@example.edu', signature: '' }, composer: null };
}

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-coordinator-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function write(directory, file, value) {
  await fs.writeFile(path.join(directory, file), JSON.stringify(value));
}

test('new workspace is absent, and concurrent saves retain ordered immutable snapshots', async t => {
  const directory = await temporary(t);
  const store = new WorkspaceStore(directory);
  assert.equal(await store.load(), null);
  const first = workspace('First');
  const firstSave = store.save(first);
  first.settings.name = 'Unexpected mutation';
  const secondSave = store.save(workspace('Second'));
  await Promise.all([firstSave, secondSave]);
  assert.equal((await store.load()).settings.name, 'Second');
  assert.equal(JSON.parse(await fs.readFile(store.backup, 'utf8')).settings.name, 'First');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['workspace.json', 'workspace.json.bak']);
});

test('corrupt primary is preserved before restoring the last valid backup', async t => {
  const directory = await temporary(t);
  const store = new WorkspaceStore(directory);
  await store.save(workspace('Previous'));
  await store.save(workspace('Latest'));
  await fs.writeFile(store.file, '{broken JSON');
  assert.equal((await store.load()).settings.name, 'Previous');
  assert.match(store.recoveryNotice, /recuperado la última copia de seguridad/);
  const preserved = (await fs.readdir(directory)).find(name => name.includes('.corrupt-'));
  assert.ok(preserved);
  assert.equal(await fs.readFile(path.join(directory, preserved), 'utf8'), '{broken JSON');
  assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).settings.name, 'Previous');
});

test('missing primary can recover backup and failed recovery never overwrites damaged files', async t => {
  const directory = await temporary(t);
  const store = new WorkspaceStore(directory);
  await store.save(workspace('Previous'));
  await store.save(workspace('Latest'));
  await fs.unlink(store.file);
  assert.equal((await store.load()).settings.name, 'Previous');
  assert.match(store.recoveryNotice, /Faltaba el archivo/);
  await fs.writeFile(store.file, '{invalid');
  await fs.writeFile(store.backup, '{also invalid');
  await assert.rejects(store.load(), /no hay una copia de seguridad válida/);
  await assert.rejects(store.save(workspace()), /no hay una copia de seguridad válida/);
  assert.equal(await fs.readFile(store.file, 'utf8'), '{invalid');
  assert.equal(await fs.readFile(store.backup, 'utf8'), '{also invalid');
});

test('invalid or oversized state is rejected before any existing data changes', async t => {
  const directory = await temporary(t);
  const store = new WorkspaceStore(directory);
  await store.save(workspace());
  await assert.rejects(store.save({ ...workspace(), version: 2 }), /formato.*no es compatible/);
  await assert.rejects(store.save({ ...workspace(), settings: {} }), /coordinación.*name/);
  const big = workspace();
  big.drafts.push({ body: 'x'.repeat(MAX_STATE_BYTES) });
  await assert.rejects(store.save(big), /demasiado grande/);
  assert.deepEqual(await store.load(), workspace());
  assert.deepEqual(await fs.readdir(directory), ['workspace.json']);
});

test('Canvas import joins only content with the same explicit account identity', async t => {
  const directory = await temporary(t);
  await write(directory, 'courses.json', { userId: '42', savedAt: 100, data: [
    { id: 1, name: 'Same account', course_code: 'SAME' },
    { id: 2, name: 'Other account' },
    { id: 3, name: 'Unidentified account' },
    { id: 4, name: 'Not cached' },
    { id: '../secrets', name: 'Invalid ID' },
  ] });
  const modules = title => [{ id: 10, name: title, position: 1, items: [{ id: 11, title: 'Lecture notes', type: 'Page', position: 1 }] }];
  await write(directory, 'content-1.json', { userId: 42, savedAt: 200, data: { modules: modules('Owned modules'), pages: [{ title: 'Page detail', body: 'Private reading' }] } });
  await write(directory, 'content-2.json', { userId: '99', data: { modules: modules('Wrong owner') } });
  await write(directory, 'content-3.json', { data: { modules: modules('Unknown owner') } });
  // A credential-like file in the selected folder is neither needed nor read.
  await fs.writeFile(path.join(directory, 'config.json'), 'not valid JSON');
  const result = await importCanvasDirectory(directory);
  assert.equal(result.courses.length, 4);
  assert.equal(result.courses[0].modules[0].name, 'Owned modules');
  for (const course of result.courses.slice(1)) assert.equal(course.modules.length, 0);
  assert.equal(result.savedAt, 100);
  assert.equal(result.source, directory);
  assert.equal(result.warnings.filter(warning => /otra cuenta.*sin identificar/.test(warning)).length, 2);
  assert.ok(result.warnings.some(warning => /identificador de Canvas no válido/.test(warning)));
  assert.ok(result.warnings.some(warning => /no hay módulos guardados/.test(warning)));
});

test('Canvas import detects nested cache, but rejects courses with no account identity', async t => {
  const directory = await temporary(t);
  const cache = path.join(directory, 'cache', 'canvas');
  await fs.mkdir(cache, { recursive: true });
  await write(cache, 'courses.json', { data: [] });
  await assert.rejects(importCanvasDirectory(directory), /no identifican la cuenta/);
  await write(cache, 'courses.json', { userId: '42', data: [] });
  assert.deepEqual((await importCanvasDirectory(directory)).courses, []);
  await assert.rejects(importCanvasDirectory(path.join(directory, 'missing')), /No se encontró el archivo courses.json/);
});
