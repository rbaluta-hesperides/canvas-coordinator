import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCanvasCourse, reconcileCanvasRecipients } from '../src/canvas-workspace.js';

const old = { students: [{ id: 'a', email: 'a@example.com' }, { id: 'b', email: 'b@example.com' }], modules: ['old module'], pages: ['old page'], calendarEvents: ['old date'], assignments: ['old assignment'], teachers: ['old teacher'] };
test('successful Canvas rosters replace prior enrollments, including empty rosters', () => {
  assert.deepEqual(mergeCanvasCourse(old, { students: [], syncStatus: { students: 'ok' } }).students, []);
  const fresh = { students: [{ id: 'c', email: 'c@example.com' }], syncStatus: { students: 'ok' } };
  assert.deepEqual(mergeCanvasCourse(old, fresh).students, fresh.students);
});
test('failed endpoints preserve last local copy alongside explicit failure status', () => {
  const next = mergeCanvasCourse(old, { students: [], modules: [], pages: {}, calendarEvents: [], assignments: [], teachers: [], syncStatus: { students: 'error', modules: 'error', calendar: 'error', assignments: 'error', teachers: 'error' } });
  for (const key of Object.keys(old)) assert.deepEqual(next[key], old[key]);
  assert.equal(next.syncStatus.students, 'error');
});
test('whole-class selections follow enrollment changes without adding missing emails', () => {
  const fresh = { students: [{ id: 'b', email: 'b@example.com' }, { id: 'c', email: 'c@example.com' }, { id: 'd', email: '' }] };
  assert.deepEqual(reconcileCanvasRecipients(old, fresh, ['a', 'b']), ['b', 'c']);
  assert.deepEqual(reconcileCanvasRecipients(old, fresh, ['a']), []);
  assert.deepEqual(reconcileCanvasRecipients(old, fresh, ['b']), ['b']);
  assert.deepEqual(reconcileCanvasRecipients(old, fresh, []), []);
  assert.deepEqual(reconcileCanvasRecipients({ students: [] }, fresh, [], 'all'), ['b', 'c']);
  assert.deepEqual(reconcileCanvasRecipients({ students: [] }, fresh, [], 'custom'), []);
});
