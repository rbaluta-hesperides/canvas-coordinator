import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCanvasWeek, dayInZone, planCanvasWeek, canvasPlainText } from '../src/canvas-planner.js';

const range = { startDate: '2026-10-05', endDate: '2026-10-09', timeZone: 'Europe/Vienna' };
const fixture = () => ({ id: 'c1', name: 'Economía', subject: 'Finanzas', students: [], teachers: ['Docente de prueba'],
  modules: [
    { id: 'a1', name: 'Sesión 1 - Asincrónico', position: 1, items: [{ id: 'v1', title: 'Vídeo de preparación', type: 'Page' }] },
    { id: 'l1', name: 'Clase sincrónica 1', position: 2, items: [] },
    { id: 'l2', name: 'Clase sincrónica 2', position: 3, items: [] },
  ], calendarEvents: [{ id: 'e1', title: 'Clase sincrónica 1', startAt: '2026-10-05T16:00:00Z', endAt: '2026-10-05T17:30:00Z', description: '<p>Traed dudas.</p>' }], assignments: [] });

test('next week uses coordinator timezone and a Monday-Friday range', () => {
  assert.deepEqual(nextCanvasWeek(new Date('2026-10-03T10:00:00Z')), { startDate: '2026-10-05', endDate: '2026-10-09' });
  assert.equal(dayInZone('2026-10-04T23:30:00Z'), '2026-10-05');
});
test('calendar fills class, teacher, local time and preparation without manually choosing a session', () => {
  const { entries, warnings } = planCanvasWeek([fixture()], range);
  assert.equal(entries.length, 1); assert.equal(warnings.length, 0);
  assert.equal(entries[0].sessionId, 'l1'); assert.equal(entries[0].preparationMode, 'canvas');
  assert.match(entries[0].preparation, /Sesión 1/); assert.match(entries[0].scheduleLabel, /18:00–19:30/);
  assert.match(entries[0].notes, /Traed dudas/); assert.equal(entries[0].teacher, 'Docente de prueba');
  assert.deepEqual(Object.fromEntries(['date', 'day', 'month', 'year', 'startTime', 'endTime', 'endDate', 'scheduleSource', 'timeZone'].map(key => [key, entries[0][key]])), {
    date: '2026-10-05', day: '05', month: '10', year: '2026', startTime: '18:00', endTime: '19:30', endDate: '2026-10-05', scheduleSource: 'calendar', timeZone: 'Europe/Vienna',
  });
  assert.doesNotMatch(entries[0].notes, /18:00/);
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

test('an exact tutorial title may identify a proven synchronous module without assuming its class number', () => {
  const course = fixture();
  course.modules[1].name = 'Tutoría 1';
  course.modules[1].items = [{ id: 'before', title: 'Antes de la clase 1', type: 'Page' }];
  course.calendarEvents[0].title = 'Tutoría 1';
  const [entry] = planCanvasWeek([course], range).entries;
  assert.equal(entry.sessionId, 'l1'); assert.equal(entry.preparationMode, 'canvas');
  assert.match(entry.preparation, /Sesión 1/);
  course.calendarEvents[0].title = 'Tutoría 2';
  assert.equal(planCanvasWeek([course], range).entries[0].sessionId, '');
});
test('assignment due dates are automatic and calendar assignment duplicates are removed', () => {
  const course = fixture();
  course.assignments = [{ id: '22', title: 'Ejercicio', dueAt: '2026-10-09T21:30:00Z', description: '<p>Resolver el caso.</p>' }];
  course.calendarEvents.push({ id: 'assignment_22', type: 'assignment', title: 'Ejercicio', startAt: '2026-10-09T21:30:00Z' });
  const plan = planCanvasWeek([course], range);
  assert.equal(plan.entries.length, 2); assert.equal(plan.entries[1].event, 'Entrega: Ejercicio'); assert.match(plan.entries[1].scheduleLabel, /23:30/);
  assert.equal(plan.entries[1].scheduleSource, 'assignment');
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
  assert.match(plan.entries[0].scheduleLabel, /lunes, 5 de octubre de 2026 · Todo el día/);
  assert.doesNotMatch(plan.entries[0].scheduleLabel, /\d\d:\d\d/);
  assert.equal(plan.entries[0].startTime, ''); assert.equal(plan.entries[0].endTime, '');
  assert.equal(plan.entries[0].date, '2026-10-05');
  assert.match(plan.entries[1].scheduleLabel, /00:30/);
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
  assert.match(entries[1].scheduleLabel, /Fecha publicada para Resto de estudiantes, según Canvas/);
  assert.match(entries[2].scheduleLabel, /Fecha publicada para Grupo de tarde/);
  assert.match(entries[2].notes, /Comprueba en Canvas la fecha que te corresponde/);
  assert.doesNotMatch(entries[1].scheduleLabel, /Fecha límite:/);
  assert.equal(warnings.length, 1);
});
test('Canvas descriptions are plain text, never active markup', () => {
  assert.equal(canvasPlainText('<script>bad()</script><p>Leer &amp; revisar</p><img src="https://example.com/track">'), 'Leer & revisar');
});

test('calendar is authoritative when a module date or time is outdated', () => {
  const course = fixture();
  course.modules[1].date = '2026-10-06'; course.modules[1].time = '12:45';
  const { entries } = planCanvasWeek([course], range);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, '2026-10-05');
  assert.equal(entries[0].startTime, '18:00');
  assert.equal(entries[0].endTime, '19:30');
  course.calendarEvents[0].startAt = '2026-10-12T16:00:00Z';
  course.calendarEvents[0].endAt = '2026-10-12T17:30:00Z';
  assert.equal(planCanvasWeek([course], range).entries.length, 0, 'do not resurrect the old module date when the class was moved to next week');
});

test('module date is visibly a fallback and never invents a calendar time', () => {
  const course = fixture();
  course.calendarEvents = [];
  course.modules[1].date = '2026-10-05';
  const entry = planCanvasWeek([course], range).entries[0];
  assert.equal(entry.scheduleSource, 'module'); assert.equal(entry.startTime, ''); assert.equal(entry.endTime, '');
  assert.match(entry.scheduleLabel, /módulo de Canvas.*Hora no publicada/);
});

test('a successfully refreshed Canvas calendar does not resurrect dated modules absent from the timetable', () => {
  const course = fixture();
  course.source = { type: 'canvas' }; course.syncStatus = { calendar: 'ok' };
  course.calendarEvents = []; course.modules[1].date = '2026-10-05';
  assert.deepEqual(planCanvasWeek([course], range).entries, []);
  course.syncStatus.calendar = 'error';
  assert.equal(planCanvasWeek([course], range).entries[0].scheduleSource, 'module');
});

test('timetable converts both endpoints using the chosen zone, including midnight and daylight saving', () => {
  const course = fixture();
  course.calendarEvents[0].startAt = '2026-10-05T21:30:00Z';
  course.calendarEvents[0].endAt = '2026-10-05T23:30:00Z';
  const overnight = planCanvasWeek([course], range).entries[0];
  assert.equal(overnight.startTime, '23:30'); assert.equal(overnight.endTime, '01:30'); assert.equal(overnight.endDate, '2026-10-06');
  assert.match(overnight.scheduleLabel, /martes, 6 de octubre de 2026 · 01:30/);
  course.calendarEvents[0].startAt = '2026-10-26T16:00:00Z';
  course.calendarEvents[0].endAt = '2026-10-26T17:30:00Z';
  const winter = planCanvasWeek([course], { startDate: '2026-10-26', endDate: '2026-10-30', timeZone: 'Europe/Madrid' }).entries[0];
  assert.equal(winter.startTime, '17:00'); assert.equal(winter.endTime, '18:30');
  assert.match(winter.scheduleLabel, /Europe\/Madrid/);
  course.calendarEvents[0].endAt = '2026-10-26T15:00:00Z';
  assert.equal(planCanvasWeek([course], { startDate: '2026-10-26', endDate: '2026-10-30' }).entries[0].endTime, '');
});

test('numbered calendar classes use class identity, never a different class merely sharing a date', () => {
  const course = fixture(); course.modules[1].date = '2026-10-05';
  course.calendarEvents[0].title = 'Clase 99';
  assert.equal(planCanvasWeek([course], range).entries.find(entry => entry.sourceEventId === 'e1').sessionId, '');
  course.calendarEvents[0].title = '⚪️ Sesión 01 en vivo';
  assert.equal(planCanvasWeek([course], range).entries.find(entry => entry.sourceEventId === 'e1').sessionId, 'l1');
  course.calendarEvents[0].title = 'Sesión asíncrona 1';
  assert.equal(planCanvasWeek([course], range).entries.find(entry => entry.sourceEventId === 'e1').sessionId, '');
});
