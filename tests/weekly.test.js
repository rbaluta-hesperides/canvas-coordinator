import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeeklyEntry, composeWeeklyAgenda, NO_ADDITIONAL_PREPARATION } from '../src/weekly.js';

const course = {
  id: 'course-a', name: 'Econometría', subject: 'Econometría',
  modules: [
    { id: 'live-1', name: 'Clase sincrónica 1', position: 1, items: [] },
    { id: 'lesson-1', name: 'Sesión 1', position: 2, items: [] },
    { id: 'live-2', name: 'Clase sincrónica 2', position: 3, items: [] },
    { id: 'lesson-2', name: 'Sesión 2', position: 4, items: [] },
    { id: 'live-3', name: 'Clase sincrónica 3', position: 5, items: [] },
    { id: 'tutorial', name: 'Tutoría', position: 6, items: [] },
    { id: 'exam', name: 'Examen', position: 7, items: [] },
  ],
};

test('two weekly classes for one subject retain their own Canvas cutoffs', () => {
  const before = JSON.stringify(course);
  const first = createWeeklyEntry(course, 'live-2');
  const second = createWeeklyEntry(course, 'live-3');
  assert.notEqual(first.id, second.id);
  assert.equal(first.preparationMode, 'canvas');
  assert.equal(first.preparation, 'Trabajar hasta Sesión 1.');
  assert.equal(second.preparation, 'Trabajar hasta Sesión 2.');
  assert.match(first.evidence, /antes de «Clase sincrónica 2»/);
  const result = composeWeeklyAgenda([first, second]);
  assert.equal(result.entryCount, 2);
  assert.deepEqual(result.missing, []);
  assert.match(result.text, /• Econometría — Clase sincrónica 2: Trabajar hasta Sesión 1\./);
  assert.match(result.text, /• Econometría — Clase sincrónica 3: Trabajar hasta Sesión 2\./);
  assert.equal(JSON.stringify(course), before);
});

test('weekly entries use the subject name without Canvas academic codes', () => {
  const coded = { ...course, name: 'Econometría [G.EC | 26/27 | S5 | 2]', subject: 'Econometría [G.EC | 26/27 | S5 | 2]' };
  assert.equal(createWeeklyEntry(coded, 'live-2').subject, 'Econometría');
  assert.equal(createWeeklyEntry().subject, '');
});

test('unknown preparation is incomplete until explicitly marked as no additional work', () => {
  const entry = createWeeklyEntry(course, 'live-1');
  assert.equal(entry.preparationMode, 'manual');
  assert.equal(entry.preparation, '');
  assert.equal(composeWeeklyAgenda([entry]).missing.length, 1);
  const declaredNone = { ...entry, preparationMode: 'none', preparation: 'Old cutoff must not leak.' };
  const result = composeWeeklyAgenda([declaredNone]);
  assert.deepEqual(result.missing, []);
  assert.match(result.text, /No hay sesiones adicionales que trabajar antes de esta clase\./);
  assert.ok(!result.text.includes('Old cutoff'));
  assert.equal(NO_ADDITIONAL_PREPARATION, 'No hay sesiones adicionales que trabajar antes de esta clase.');
});

test('no course, no selection, stale selection, tutoring and exams never invent Canvas coverage', () => {
  for (const entry of [createWeeklyEntry(), createWeeklyEntry(course), createWeeklyEntry(course, 'missing'),
    createWeeklyEntry(course, 'tutorial'), createWeeklyEntry(course, 'exam')]) {
    assert.equal(entry.sessionId, '');
    assert.equal(entry.event, '');
    assert.equal(entry.preparationMode, 'manual');
    assert.equal(entry.preparation, '');
  }
  const exam = { ...createWeeklyEntry(course), event: 'Examen', preparation: 'Revisar las instrucciones de evaluación.' };
  assert.deepEqual(composeWeeklyAgenda([exam]).missing, []);
  assert.match(composeWeeklyAgenda([exam]).text, /Econometría — Examen: Revisar las instrucciones de evaluación\./);
});

test('manual events preserve teachers and paragraph notes without mutating entries', () => {
  const entry = { ...createWeeklyEntry(course), event: 'Tutoría de repaso', teacher: 'Profesor de ejemplo',
    preparation: '  Traer las dudas.  ', notes: 'Primera observación.\r\n\r\nSegunda observación.' };
  const before = JSON.stringify(entry);
  const result = composeWeeklyAgenda([entry]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.text, '• Econometría — Tutoría de repaso, con Profesor de ejemplo: Traer las dudas.\n  Primera observación.\n  \n  Segunda observación.');
  assert.equal(JSON.stringify(entry), before);
});

test('a calendar timetable appears once in the email before the activity notes', () => {
  const entry = { ...createWeeklyEntry(course, 'live-2'),
    scheduleLabel: 'lunes, 5 de octubre de 2026 · 18:00–19:30 (Europe/Madrid)', notes: 'Traed dudas.' };
  const { text, missing } = composeWeeklyAgenda([entry]);
  assert.deepEqual(missing, []);
  assert.match(text, /18:00–19:30 \(Europe\/Madrid\)\n  Traed dudas/);
  assert.equal(text.split('18:00').length - 1, 1);
});

test('incomplete entries identify each missing field and cannot silently become sendable', () => {
  const result = composeWeeklyAgenda([{ subject: '  ', event: null, preparationMode: 'manual' },
    { subject: 'Historia', event: 'Clase', preparationMode: 'canvas', preparation: '   ' }]);
  assert.equal(result.missing.length, 4);
  assert.match(result.missing[0], /Entrada 1.*asignatura/);
  assert.match(result.missing[1], /Entrada 1.*actividad/);
  assert.match(result.missing[3], /Entrada 2.*preparación/);
  assert.match(result.text, /\{\{asignatura_1\}\} — \{\{actividad_1\}\}: \{\{preparacion_1\}\}/);
  assert.ok(!result.text.includes('undefined'));
  assert.equal(composeWeeklyAgenda([null]).missing.length, 3);
  assert.equal(composeWeeklyAgenda([{ subject: 'Historia', event: 'Clase', preparationMode: 'unexpected', preparation: 'Do not assume this is valid.' }]).missing.length, 1);
});

test('markup and template-like text stay literal plain content, never executed or expanded', () => {
  const entry = { ...createWeeklyEntry(), subject: '<img src=x onerror=alert(1)>', event: '{{actividad}}',
    preparation: '<script>throw Error("not executable")</script>', notes: 'Abrir {{enlace}} solo si procede.' };
  const result = composeWeeklyAgenda([entry]);
  assert.deepEqual(result.missing, []);
  assert.ok(result.text.includes(entry.subject));
  assert.ok(result.text.includes(entry.preparation));
  assert.ok(result.text.includes(entry.notes));
});

test('an empty or invalid agenda requires at least one class or activity', () => {
  for (const entries of [[], null, {}, undefined]) {
    const result = composeWeeklyAgenda(entries);
    assert.equal(result.entryCount, 0);
    assert.equal(result.text, '');
    assert.equal(result.missing.length, 1);
    assert.match(result.missing[0], /al menos una clase o actividad/);
  }
});
