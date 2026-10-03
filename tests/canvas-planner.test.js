import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCanvasWeek, dayInZone, planCanvasWeek, relatedCanvasCourses, canvasPlainText } from '../src/canvas-planner.js';

const range = { startDate: '2026-10-05', endDate: '2026-10-09', timeZone: 'Europe/Vienna' };
const fixture = () => ({ id: 'c1', name: 'Economía', subject: 'Finanzas', students: [], teachers: ['Docente de prueba'],
  modules: [
    { id: 'a1', name: 'Sesión 1 - Asincrónico', position: 1, items: [{ id: 'v1', title: 'Vídeo de preparación', type: 'Page' }] },
    { id: 'l1', name: 'Clase sincrónica 1', position: 2, items: [] },
    { id: 'l2', name: 'Clase sincrónica 2', position: 3, items: [] },
  ], calendarEvents: [{ id: 'e1', title: 'Clase sincrónica 1', startAt: '2026-10-05T16:00:00Z', description: '<p>Traed dudas.</p>' }], assignments: [] });

test('next week uses coordinator timezone and a Monday-Friday range', () => {
  assert.deepEqual(nextCanvasWeek(new Date('2026-10-03T10:00:00Z')), { startDate: '2026-10-05', endDate: '2026-10-09' });
  assert.equal(dayInZone('2026-10-04T23:30:00Z'), '2026-10-05');
});
test('calendar fills class, teacher, local time and preparation without manually choosing a session', () => {
  const { entries, warnings } = planCanvasWeek([fixture()], range);
  assert.equal(entries.length, 1); assert.equal(warnings.length, 0);
  assert.equal(entries[0].sessionId, 'l1'); assert.equal(entries[0].preparationMode, 'canvas');
  assert.match(entries[0].preparation, /Sesión 1/); assert.match(entries[0].notes, /18:00/);
  assert.match(entries[0].notes, /Traed dudas/); assert.equal(entries[0].teacher, 'Docente de prueba');
});
test('no new material is inferred only when two known live-class cutoffs match', () => {
  const course = fixture(); course.calendarEvents[0].title = 'Clase sincrónica 2';
  assert.equal(planCanvasWeek([course], range).entries[0].preparationMode, 'none');
  course.modules = course.modules.filter(module => module.id !== 'a1');
  const entry = planCanvasWeek([course], range).entries[0];
  assert.equal(entry.preparationMode, 'manual'); assert.equal(entry.preparation, '');
});
test('exams and tutoring do not inherit a numbered live class preparation', () => {
  const course = fixture(); course.calendarEvents[0].title = 'Examen parcial 1'; course.calendarEvents[0].description = '';
  const plan = planCanvasWeek([course], range);
  assert.equal(plan.entries[0].sessionId, ''); assert.equal(plan.entries[0].preparation, ''); assert.equal(plan.warnings.length, 1);
  course.calendarEvents[0].description = '<p>Sesiones 1 a 14.</p>';
  assert.equal(planCanvasWeek([course], range).entries[0].preparation, 'Sesiones 1 a 14.');
  course.calendarEvents[0].title = 'Tutoría 1';
  assert.equal(planCanvasWeek([course], range).entries[0].sessionId, '');
});
test('assignment due dates are automatic and calendar assignment duplicates are removed', () => {
  const course = fixture();
  course.assignments = [{ id: '22', title: 'Ejercicio', dueAt: '2026-10-09T21:30:00Z', description: '<p>Resolver el caso.</p>' }];
  course.calendarEvents.push({ id: 'assignment_22', type: 'assignment', title: 'Ejercicio', startAt: '2026-10-09T21:30:00Z' });
  const plan = planCanvasWeek([course], range);
  assert.equal(plan.entries.length, 2); assert.equal(plan.entries[1].event, 'Entrega: Ejercicio'); assert.match(plan.entries[1].notes, /23:30/);
  course.assignments[0].dueAt = '2026-10-09T23:00:00Z'; course.calendarEvents.pop();
  assert.equal(planCanvasWeek([course], range).entries.length, 1);
});
test('dated module fallback does not duplicate the corresponding calendar meeting', () => {
  const course = fixture(); course.modules[1].date = '2026-10-05';
  assert.equal(planCanvasWeek([course], range).entries.length, 1);
  course.calendarEvents = [];
  assert.equal(planCanvasWeek([course], range).entries[0].sessionId, 'l1');
  assert.throws(() => planCanvasWeek([course], { startDate: '2026-02-30', endDate: '2026-03-04' }), /fechas/);
});
test('cohort suggestions require the same complete roster and account identity', () => {
  const base = { id: 'a', source: { type: 'canvas', baseUrl: 'https://canvas.example.com', userId: '1' }, rosterComplete: true, rosterAuthoritative: true, syncStatus: { students: 'ok' }, students: [{ id: '1', email: 'a@example.com' }, { id: '2', email: 'b@example.com' }] };
  const same = { ...base, id: 'b' }, different = { ...base, id: 'c', students: [{ id: '1', email: 'a@example.com' }] }, otherAccount = { ...base, id: 'd', source: { ...base.source, userId: '2' } };
  assert.deepEqual(relatedCanvasCourses([base, same, different, otherAccount], base), ['a', 'b']);
  const hiddenEmails = { ...base, id: 'hidden', rosterComplete: false, students: [...base.students, { id: '3', email: '' }] };
  const stale = { ...base, id: 'stale', rosterAuthoritative: false, syncStatus: { students: 'error' } };
  const differentPeople = { ...base, id: 'people', students: base.students.map((student, index) => ({ ...student, id: `other-${index}` })) };
  assert.deepEqual(relatedCanvasCourses([base, same, hiddenEmails, stale, differentPeople], base), ['a', 'b']);
  assert.deepEqual(relatedCanvasCourses([base, hiddenEmails], hiddenEmails), ['hidden']);
  const unknownCompleteness = { ...base, id: 'unknown', rosterComplete: undefined };
  assert.deepEqual(relatedCanvasCourses([base, unknownCompleteness], unknownCompleteness), ['unknown']);
});

test('unrelated activities and deadlines on a live-class day never inherit class preparation', () => {
  for (const title of ['Reunión de coordinación', 'Entrega del trabajo', 'Entrega de la clase 1', 'Recordatorio administrativo', 'Información sobre la clase 1', 'Revisión del material de clase 1', 'Clase sincrónica 1 cancelada', 'Tutoría sobre la clase 1', 'Office hours - Class 1']) {
    const course = fixture();
    course.modules[1].date = '2026-10-05';
    course.calendarEvents[0].title = title;
    const event = planCanvasWeek([course], range).entries.find(entry => entry.sourceEventId === 'e1');
    assert.equal(event.sessionId, '', title);
    assert.equal(event.preparationMode, 'manual', title);
    assert.equal(event.preparation, 'Traed dudas.', title);
  }
  const course = fixture();
  course.modules[1].date = '2026-10-05';
  course.calendarEvents[0].title = 'Clase semanal';
  assert.equal(planCanvasWeek([course], range).entries[0].sessionId, 'l1');
});

test('stale preparation never infers no additional work, and every failed source remains visible', () => {
  const course = fixture();
  course.calendarEvents[0].title = 'Clase sincrónica 2';
  course.preparationComplete = false;
  course.syncStatus = { modules: 'error', pages: 'error', students: 'error', calendar: 'error', assignments: 'error', teachers: 'error' };
  course.assignments = [{ id: 'a1', title: 'Trabajo', dueAt: '2026-10-06T16:00:00Z', description: 'Resolver el caso.' }];
  const { entries, warnings } = planCanvasWeek([course], range);
  assert.equal(entries[0].preparationMode, 'canvas');
  assert.match(entries[0].preparation, /Sesión 1/);
  assert.match(entries[0].evidence, /última copia local/);
  assert.match(entries[1].evidence, /pendientes de actualizar/);
  assert.equal(warnings.length, 6);
  for (const source of ['módulos', 'sesiones', 'estudiantes', 'calendario', 'entregas', 'profesorado']) {
    assert.ok(warnings.some(warning => warning.includes(source)), source);
  }
});

test('all-day events use their published date across time zones and do not invent an hour', () => {
  const course = fixture();
  course.calendarEvents = [
    { id: 'timed', title: 'Actividad de madrugada', startAt: '2026-10-04T22:30:00Z', description: 'Actividad.' },
    { id: 'all-day', title: 'Jornada del curso', allDay: true, day: '2026-10-05', startAt: '2026-10-06T03:00:00Z', description: 'Jornada.' },
  ];
  const plan = planCanvasWeek([course], { ...range, endDate: '2026-10-05' });
  assert.deepEqual(plan.entries.map(entry => entry.sourceEventId), ['all-day', 'timed']);
  assert.match(plan.entries[0].notes, /lunes, 5 de octubre · Todo el día/);
  assert.doesNotMatch(plan.entries[0].notes, /\d\d:\d\d/);
  assert.match(plan.entries[1].notes, /00:30/);
});

test('differentiated assignment dates remain scoped in the email rather than applying to the whole class', () => {
  const course = fixture();
  course.assignments = [
    { id: 'paper:base', title: 'Ensayo', dueAt: '2026-10-06T12:00:00Z', differentiated: true, dueScope: 'Resto de estudiantes, según Canvas' },
    { id: 'paper:override-1', title: 'Ensayo', dueAt: '2026-10-07T12:00:00Z', differentiated: true, dueScope: 'Grupo de tarde' },
  ];
  course.calendarEvents.push(...course.assignments.map(assignment => ({ id: `assignment_${assignment.id}`, assignmentId: assignment.id, type: 'assignment', startAt: assignment.dueAt })));
  const { entries, warnings } = planCanvasWeek([course], range);
  assert.equal(entries.length, 3);
  assert.match(entries[1].notes, /Fecha publicada para Resto de estudiantes, según Canvas/);
  assert.match(entries[2].notes, /Fecha publicada para Grupo de tarde/);
  assert.match(entries[2].notes, /Comprueba en Canvas la fecha que te corresponde/);
  assert.doesNotMatch(entries[1].notes, /Fecha límite:/);
  assert.equal(warnings.length, 1);
});
test('Canvas descriptions are plain text, never active markup', () => {
  assert.equal(canvasPlainText('<script>bad()</script><p>Leer &amp; revisar</p><img src="https://example.com/track">'), 'Leer & revisar');
});
