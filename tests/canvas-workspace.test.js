import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCanvasCourse, reconcileCanvasRecipients, refreshEditedCalendarSchedule } from '../src/canvas-workspace.js';

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

test('a rescheduled calendar updates hours in an edited weekly item without overwriting its wording', () => {
  const entry = { sourceEventId: 'event-1', subject: 'Finanzas', preparation: 'Una indicación propia.', notes: 'Traer preguntas.', startTime: '18:00', endTime: '19:00', scheduleLabel: 'lunes 18:00–19:00', generated: false };
  const next = refreshEditedCalendarSchedule(entry, { startTime: '19:00', endTime: '20:30', scheduleLabel: 'martes 19:00–20:30', date: '2026-10-06', preparation: 'Texto de Canvas' });
  assert.equal(next.preparation, entry.preparation);
  assert.equal(next.notes, entry.notes);
  assert.equal(next.startTime, '19:00');
  assert.equal(next.endTime, '20:30');
  assert.equal(next.scheduleLabel, 'martes 19:00–20:30');
  assert.equal(entry.startTime, '18:00');
});
