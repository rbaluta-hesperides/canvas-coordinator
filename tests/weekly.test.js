import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeeklyEntry, composeWeeklyAgenda } from '../src/weekly.js';

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

test('unknown or deliberately omitted preparation produces no filler or missing-field error', () => {
  const entry = createWeeklyEntry(course, 'live-1');
  assert.equal(entry.preparationMode, 'manual');
  assert.equal(entry.preparation, '');
  assert.deepEqual(composeWeeklyAgenda([entry]).missing, []);
  assert.equal(composeWeeklyAgenda([entry]).text, '• Econometría — Clase sincrónica 1');
  const declaredNone = { ...entry, preparationMode: 'none', preparation: 'Old cutoff must not leak.' };
  const result = composeWeeklyAgenda([declaredNone]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.text, '• Econometría — Clase sincrónica 1');
  assert.ok(!result.text.includes('Old cutoff'));
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

test('a calendar timetable appears once before the preparation and activity notes', () => {
  const entry = { ...createWeeklyEntry(course, 'live-2'),
    scheduleLabel: 'lunes, 5 de octubre de 2026 · 18:00–19:30 (Europe/Madrid)', notes: 'Traed dudas.' };
  const { text, missing } = composeWeeklyAgenda([entry]);
  assert.deepEqual(missing, []);
  assert.match(text, /Clase sincrónica 2:\n  lunes, 5 de octubre de 2026 · 18:00–19:30 \(Europe\/Madrid\)\n  Trabajar hasta Sesión 1\.\n  Traed dudas/);
  assert.equal(text.split('18:00').length - 1, 1);
});

test('generated activities are chronological while repeated subjects and manual positions survive', () => {
  const early = { ...createWeeklyEntry(course, 'live-2'), generated: true, event: 'Clase del lunes', sortAt: '2026-10-05T18:00:00', scheduleLabel: 'Lunes · 18:00' };
  const late = { ...createWeeklyEntry(course, 'live-3'), generated: true, event: 'Clase del domingo', date: '2026-10-11', startTime: '09:00', scheduleLabel: 'Domingo · 09:00' };
  const middle = { ...createWeeklyEntry(course), event: 'Aviso de coordinación', preparationMode: 'none', notes: 'Nota añadida entre las actividades.' };
  const entries = [late, middle, early];
  const before = JSON.stringify(entries);
  const result = composeWeeklyAgenda(entries);
  assert.deepEqual(result.missing, []);
  assert.equal(result.entryCount, 3);
  assert.ok(result.text.indexOf('Clase del lunes') < result.text.indexOf('Aviso de coordinación'));
  assert.ok(result.text.indexOf('Aviso de coordinación') < result.text.indexOf('Clase del domingo'));
  assert.equal(result.text.split('• Econometría').length - 1, 3);
  assert.equal(JSON.stringify(entries), before);
});

test('sorting generated entries keeps validation references tied to the original editor rows', () => {
  const late = { ...createWeeklyEntry(course), generated: true, subject: '', event: 'Examen domingo', date: '2026-10-11', startTime: '09:00' };
  const early = { ...createWeeklyEntry(course, 'live-2'), generated: true, sortAt: '2026-10-05T18:00:00' };
  const result = composeWeeklyAgenda([late, early]);
  assert.equal(result.missing.length, 1);
  assert.match(result.missing[0], /^Entrada 1: falta la asignatura/);
  assert.ok(result.text.indexOf('Clase sincrónica 2') < result.text.indexOf('Examen domingo'));
  assert.match(result.text, /\{\{asignatura_1\}\} — Examen domingo/);
  assert.doesNotMatch(result.text, /preparacion_1/);
});

test('editing calendar preparation does not prevent a rescheduled activity from moving chronologically', () => {
  const edited = { ...createWeeklyEntry(course, 'live-2'), generated: false, sourceEventId: 'canvas-class',
    event: 'Clase reprogramada', sortAt: '2026-10-09T18:00:00', preparation: 'Preparación revisada por coordinación.' };
  const other = { ...createWeeklyEntry(course, 'live-3'), generated: true, event: 'Clase anterior', sortAt: '2026-10-05T18:00:00' };
  const result = composeWeeklyAgenda([edited, other]);
  assert.ok(result.text.indexOf('Clase anterior') < result.text.indexOf('Clase reprogramada'));
  assert.match(result.text, /Clase reprogramada: Preparación revisada por coordinación\./);
  assert.equal(edited.generated, false);
});

test('subject and activity remain required while preparation is optional', () => {
  const result = composeWeeklyAgenda([{ subject: '  ', event: null, preparationMode: 'manual' },
    { subject: 'Historia', event: 'Clase', preparationMode: 'canvas', preparation: '   ' }]);
  assert.equal(result.missing.length, 2);
  assert.match(result.missing[0], /Entrada 1.*asignatura/);
  assert.match(result.missing[1], /Entrada 1.*actividad/);
  assert.match(result.text, /\{\{asignatura_1\}\} — \{\{actividad_1\}\}/);
  assert.ok(!result.text.includes('undefined'));
  assert.equal(composeWeeklyAgenda([null]).missing.length, 2);
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


test('activities retain their timetable while links and absent preparation are omitted', () => {
  const entry = { ...createWeeklyEntry(course), event: 'Tutoría', scheduleLabel: 'Lunes · 18:00–19:00',
    preparation: 'https://canvas.example.edu/preparation', notes: 'https://canvas.example.edu/event' };
  const result = composeWeeklyAgenda([entry]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.text, '• Econometría — Tutoría:\n  Lunes · 18:00–19:00');
  assert.doesNotMatch(result.text, /https?:|No hay|preparaci[oó]n|\{\{/);
  assert.equal(entry.notes, 'https://canvas.example.edu/event');
  const withNotes = composeWeeklyAgenda([{ ...entry, preparation: 'Repasar las sesiones 1 a 14.',
    notes: 'Traed calculadora.\n\nhttps://canvas.example.edu/exam\n\nConsultad la convocatoria.' }]);
  assert.match(withNotes.text, /sesiones 1 a 14/);
  assert.match(withNotes.text, /Traed calculadora/);
  assert.match(withNotes.text, /Consultad la convocatoria/);
  assert.doesNotMatch(withNotes.text, /https?:/);
});
