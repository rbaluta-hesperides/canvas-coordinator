import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourses, deriveSessions, deriveExamPreparation, isExamActivity, parseStudentCsv, resolveTemplate, buildGmailUrl, isValidEmail } from '../src/domain.js';

const item = (id, title, position = 1, extra = {}) => ({ id, title, type: 'Page', position, ...extra });
const module = (id, name, position, items = [], extra = {}) => ({ id, name, position, items, ...extra });
const modules = [
  module('orientation', 'Orientación', 1, [item('welcome', 'Conoce a tu profesor')]),
  module('live1', '⚪ Módulo 1 | Clase sincrónica 1', 2, [item('before1', 'Antes de la clase 1: ¿Cómo me preparo?'), item('after1', 'Después de la clase 1 [03/09/2026]: Grabación y foro', 2, { type: 'Discussion' })]),
  module('lesson1', 'Módulo 1 | Sesión 1', 3, [item('v1', '1.1 Vídeo: Introducción')]),
  module('lesson2', 'Módulo 1 | Sesión 2', 4, [item('v3', '2.2 Vídeo: Variables', 2), item('v2', '2.1 Vídeo: Ejemplos', 1)]),
  module('tutorial', 'Tutoría 1', 5, [item('tutorial-video', 'Vídeo de la tutoría')]),
  module('live2', 'Módulo 2 | Clase sincrónica 2', 6, [item('before2', 'Antes de la clase 2'), item('after2', 'Después de la clase 2 [17/09/2026]: Grabación y foro', 2, { type: 'Discussion' })]),
  module('lesson3', 'Módulo 2 | Sesión 3', 7, [item('v4', '3.1 Vídeo: Ruido')]),
  module('live3', 'Módulo 2 | Clase sincrónica 3', 8),
];

test('CanvasManager courses cache and courseContent envelopes normalize with precision-safe ids', () => {
  const input = { courses: { savedAt: 100, userId: '7', data: [{ id: '203000000000000101', name: 'Econometría I', courseCode: 'ECO', source: { type: 'canvas-manager' }, savedAt: 99 }] },
    courseContent: { '203000000000000101': { savedAt: 100, userId: '7', data: { modules } } } };
  const [course] = normalizeCourses(input);
  assert.equal(course.id, '203000000000000101');
  assert.equal(course.code, 'ECO');
  assert.equal(course.modules.length, 8);
  assert.equal(course.sessions.length, 3);
  assert.equal(course.source.type, 'canvas-manager');
  assert.equal(course.savedAt, 99);
  assert.equal(normalizeCourses({ savedAt: 100, userId: '7', data: [{ id: 12, name: 'Law' }] })[0].name, 'Law');
});

test('single content file, Canvas enrollments, URLs, and empty input normalize without mutation', () => {
  const raw = { course: { id: 2, name: 'Finanzas' }, content: { modules: [module(3, 'Sesión 1', 1, [item(5, 'Vídeo', 1, { html_url: 'https://canvas.example/courses/2/modules/items/5' })])] } };
  const snapshot = JSON.stringify(raw);
  const [course] = normalizeCourses(raw);
  assert.equal(course.id, '2');
  assert.equal(course.modules[0].items[0].url, 'https://canvas.example/courses/2/modules/items/5');
  assert.equal(JSON.stringify(raw), snapshot);
  assert.equal(normalizeCourses({ modules: [] })[0].id, 'imported-course');
  assert.deepEqual(normalizeCourses(null), []);
  const [roster] = normalizeCourses([{ id: 2, enrollments: [{ user: { id: 1, name: 'Ana', email: 'ana@example.com' } }, { user: { id: 2, name: 'Duplicate', email: 'ANA@example.com' } }, { user: { id: 3, name: 'No email' } }] }]);
  assert.deepEqual(roster.students.map((student) => student.email), ['ana@example.com', '']);
});

test('metadata-only imports differ from explicitly empty structure and preserve the importer flag', () => {
  const courses = normalizeCourses([
    { id: 'metadata', name: 'Curso sin estructura' },
    { id: 'empty', name: 'Curso vacío', modules: [] },
    { id: 'content', name: 'Contenido vacío', content: { modules: [] } },
    { id: 'missing-cache', modules: [], hasStructure: false },
  ]);
  assert.deepEqual(courses.map((course) => course.hasStructure), [false, true, true, false]);
  assert.equal(normalizeCourses(courses)[0].hasStructure, false);
});

test('reference Canvas preparation uses all preceding lessons and final material in position order', () => {
  const before = JSON.stringify(modules);
  const sessions = deriveSessions({ modules: [modules[7], ...modules.slice(0, 7)] });
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0].preparation, '');
  assert.match(sessions[0].evidence, /No se encontró.*Introduce la preparación manualmente/);
  assert.deepEqual(sessions[1].preparationItems.map((value) => value.id), ['v1', 'v2', 'v3']);
  assert.equal(sessions[1].preparation, 'Módulo 1 | Sesión 2 · 2.2 Vídeo: Variables');
  assert.deepEqual(sessions[2].preparationItems.map((value) => value.id), ['v1', 'v2', 'v3', 'v4']);
  assert.deepEqual([sessions[1].day, sessions[1].month, sessions[1].year], ['17', '09', '2026']);
  assert.equal(JSON.stringify(modules), before);
});

test('async titles never become live; white-circle session numbering follows real Canvas convention', () => {
  const sessions = deriveSessions({ modules: [
    module('a', '⚪ Módulo 1 | Sesión 1', 1),
    module('b', 'Módulo 2 | Sesión asincrónica 1', 2, [item('v1', 'Vídeo 1')]),
    module('c', 'Sesión asíncrona 2', 3, [item('v2', 'Vídeo 2')]),
    module('d', 'Asynchronous session 3', 4, [item('v3', 'Video 3')]),
    module('e', '⚪ Módulo 4 | Sesión 2', 5),
  ] });
  assert.deepEqual(sessions.map((session) => session.id), ['a', 'e']);
  assert.equal(sessions[1].preparationItems.length, 3);
  assert.match(sessions[1].preparation, /Asynchronous session 3/);
});

test('renamed class modules use Antes/Después evidence; dates are validated and never inferred from unlockAt', () => {
  const sessions = deriveSessions({ modules: [
    module('lesson', 'Sesión 1', 1),
    module('live', 'Encuentro con el profesor', 2, [item('before', 'Antes de la clase 2'), item('after', 'Después de la clase 2 [31/02/2026]', 2)], { unlockAt: '2026-09-01T00:00:00Z' }),
    module('dated', 'Clase síncrona 3', 3, [], { date: '2026-09-24T18:30:00+02:00' }),
  ] });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].preparation, 'Sesión 1');
  assert.deepEqual([sessions[0].day, sessions[0].month, sessions[0].year], ['', '', '']);
  assert.deepEqual([sessions[1].day, sessions[1].month, sessions[1].year, sessions[1].time], ['24', '09', '2026', '18:30']);
});

test('white-circle en vivo modules identify the class itself, not its after-class recording discussion', () => {
  const title = 'Viernes 27 de septiembre | Calentando motores en vivo ⚪️';
  const sessions = deriveSessions({ modules: [module('warmup', title, 1, [
    item('recording', 'Después de la sesión sincrónica del viernes: la grabación y el foro', 1, { type: 'Discussion' }),
  ])] });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'warmup');
  assert.equal(sessions[0].title, title);
  assert.equal(sessions[0].preparation, '');
});

test('discussion and recording items never create live classes; numbered structural markers still do', () => {
  const sessions = deriveSessions({ modules: [
    module('resources', 'Recursos', 1, [
      item('discussion', 'Sesión sincrónica de bienvenida', 1, { type: 'Discussion' }),
      item('after', 'Después de la sesión sincrónica del viernes: la grabación y el foro', 2),
      item('recording', 'Grabación de la clase sincrónica', 3),
    ]),
    module('structural', 'Encuentro con el profesor', 2, [item('dated', 'Después de la clase 1 [03/10/2026]', 1, { type: 'Discussion' })]),
  ] });
  assert.deepEqual(sessions.map((session) => session.id), ['structural']);
  assert.equal(sessions[0].day, '03');
});

test('live items inside mixed modules stop preparation at that exact item and skip unpublished content', () => {
  const sessions = deriveSessions({ modules: [module('mixed', 'Sesión 1 | Unidad 1', 1, [
    item('first', 'Read chapter 1', 1), item('hidden', 'Not ready', 2, { published: false }),
    item('live', 'Synchronous class 1', 3), item('later', 'Read chapter 2', 4),
  ]), module('unpublished', 'Clase sincrónica 2', 2, [], { published: false }), module('next', 'Clase sincrónica 3', 3)] });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].id, 'mixed:live');
  assert.deepEqual(sessions[0].preparationItems.map((value) => value.id), ['first']);
  assert.deepEqual(sessions[1].preparationItems.map((value) => value.id), ['first', 'later']);
});

test('miscellaneous modules cannot replace the last asynchronous session cutoff', () => {
  const sessions = deriveSessions({ modules: [
    module('lesson', 'Sesión 2', 1, [item('lesson-video', '2.1 Vídeo: Costes')]),
    module('resources', 'Recursos del curso', 2, [item('handbook', 'Manual de la universidad', 1, { type: 'File' }), item('help-video', 'Vídeo de ayuda técnica', 2)]),
    module('live', 'Clase sincrónica 1', 3),
    module('new-policy', 'Políticas actualizadas', 4, [item('policy', 'Política de asistencia', 1, { type: 'File' })]),
    module('next-live', 'Clase sincrónica 2', 5),
  ] });
  assert.equal(sessions[0].preparation, 'Sesión 2 · 2.1 Vídeo: Costes');
  assert.equal(sessions[1].preparation, sessions[0].preparation);
  assert.deepEqual(sessions[1].preparationItems.map((value) => value.id), ['lesson-video']);
});

test('unlabelled modules require explicit lesson video evidence; arbitrary files give no inferred cutoff', () => {
  const sessions = deriveSessions({ modules: [
    module('resources', 'Recursos', 1, [item('policy', 'Política de asistencia', 1, { type: 'File' })]),
    module('first', 'Clase sincrónica 1', 2),
    module('topic', 'Tema 1', 3, [item('video', 'Introducción al VAN', 1, { page_url: 'van' })]),
    module('second', 'Clase sincrónica 2', 4),
  ], pages: [{ url: 'van', body: '<iframe src="https://player.vimeo.com/video/123"></iframe>' }] });
  assert.equal(sessions[0].preparation, '');
  assert.match(sessions[0].evidence, /Introduce la preparación manualmente/);
  assert.deepEqual(sessions[1].preparationItems.map((value) => value.id), ['video']);
  assert.match(sessions[1].evidence, /No se identificaron módulos.*Revisa esta preparación/);
});

test('invalid imported ISO times are not presented as a valid class time', () => {
  const [session] = deriveSessions({ modules: [module('live', 'Clase sincrónica 1', 1, [], { date: '2026-10-03T99:99:00Z' })] });
  assert.equal(session.day, '03');
  assert.equal(session.time, '');
});

test('exam preparation stops at the last asynchronous session before its decorated module marker', () => {
  const course = { modules: [
    module('later', 'Sesión 15', 6),
    module('exam', '🟡 Examen parcial [08/10/2026]', 5),
    module('lesson', 'Sesión 14 | Repaso para el examen', 1, [item('video', '14.2 Vídeo: Último material')]),
    module('live', '⚪ Sesión 15', 2),
    module('resource', 'Recursos', 3, [item('policy', 'Normas del examen')]),
    module('hidden', 'Sesión 99', 4, [], { published: false }),
  ] };
  const before = JSON.stringify(course);
  const result = deriveExamPreparation(course, { title: 'Finanzas II — Examen parcial', startAt: '2026-10-08T15:00:00Z' });
  assert.equal(result.preparation, 'Sesión 14 | Repaso para el examen');
  assert.equal(result.moduleId, 'lesson'); assert.equal(result.referenceId, 'exam');
  assert.match(result.evidence, /última sesión asíncrona/);
  assert.doesNotMatch(result.preparation, /15|99|Último material/);
  assert.equal(JSON.stringify(course), before);
});

test('partial and final exam boundaries retain their own preceding asynchronous sessions', () => {
  const course = { modules: [module('first', 'Sesión 4', 1), module('partial', 'Examen parcial', 2),
    module('second', 'Sesión 14', 3), module('final', 'Examen final', 4), module('after', 'Sesión 15', 5)] };
  assert.equal(deriveExamPreparation(course, { title: 'Examen parcial' }).moduleId, 'first');
  assert.equal(deriveExamPreparation(course, { title: 'Examen final' }).moduleId, 'second');
  assert.equal(deriveExamPreparation(course, { title: 'Examen extraordinario' }), null);
  assert.equal(deriveExamPreparation({ modules: [module('exam', 'Examen final', 1), module('later', 'Sesión 1', 2)] }, { title: 'Examen final' }), null);
});

test('exam assignment identity survives normalization and stops inside the exact module item', () => {
  const [course] = normalizeCourses([{ id: 'exam-course', modules: [module('previous', 'Sesión 13', 1),
    module('inside', 'Sesión 14', 2, [item('material', '14.1 Vídeo: Caso de estudio', 1),
      item('exam-item', 'Evaluación de conocimientos', 2, { type: 'Assignment', content_id: '40000000000000002' }),
      item('post-exam', 'Material posterior al examen', 3)]), module('later', 'Sesión 15', 3)] }]);
  const event = { title: 'Examen final', type: 'assignment', id: '40000000000000002:override-17', canvasAssignmentId: '40000000000000002' };
  assert.equal(course.modules[1].items[1].contentId, '40000000000000002');
  assert.equal(deriveExamPreparation(course, event).preparation, 'Sesión 14');
  assert.equal(deriveExamPreparation(course, event).referenceId, 'inside:exam-item');
  course.modules[1].items[1].position = 0;
  assert.equal(deriveExamPreparation(course, event).preparation, 'Sesión 13', 'an exam at the beginning cannot include later material in its module');
});

test('exam quiz and explicit module-item identities do not confuse different Canvas ID namespaces', () => {
  const course = { modules: [module('lesson', 'Sesión 7', 1), module('evaluation', 'Evaluaciones', 2,
    [item('module-item', 'Prueba A', 1, { type: 'Quiz', content_id: '88' })]), module('after', 'Sesión 8', 3)] };
  assert.equal(deriveExamPreparation(course, { title: 'Examen final', quizId: '88' }).preparation, 'Sesión 7');
  assert.equal(deriveExamPreparation(course, { title: 'Examen final', moduleItemId: 'module-item' }).preparation, 'Sesión 7');
  assert.equal(deriveExamPreparation(course, { title: 'Examen final', assignmentId: '88' }), null);
});

test('ambiguous or absent exam markers never select the last course lesson by assumption', () => {
  const course = { modules: [module('first', 'Sesión 2', 1), module('exam-one', 'Examen final', 2),
    module('next', 'Sesión 5', 3), module('exam-two', 'Examen final', 4)] };
  assert.equal(deriveExamPreparation(course, { title: 'Examen final' }), null);
  assert.equal(deriveExamPreparation({ modules: [module('last', 'Sesión 99', 1)] }, { title: 'Examen final', startAt: '2026-10-08T18:00:00Z' }), null);
  assert.equal(isExamActivity('Clase de repaso para el examen'), false);
  assert.equal(isExamActivity('Tutoría sobre el examen final'), false);
  assert.equal(isExamActivity('Finanzas II — Examen final'), true);
});

test('calendar-only exams use explicit earlier asynchronous dates and reject ambiguous ordering', () => {
  const course = { modules: [module('before', 'Sesión 14', 1, [], { date: '2026-10-07' }),
    module('same-day', 'Sesión 15', 2, [], { date: '2026-10-08' }), module('after', 'Sesión 16', 3, [], { date: '2026-10-09' }),
    module('undated', 'Sesión 99', 4)] };
  const event = { title: 'Examen final', startAt: '2026-10-08T18:00:00Z' };
  const result = deriveExamPreparation(course, event);
  assert.equal(result.preparation, 'Sesión 14'); assert.equal(result.referenceId, 'exam-date:2026-10-08');
  course.modules[2].date = '2026-10-06';
  assert.equal(deriveExamPreparation(course, event), null, 'contradictory dated module order is not a reliable cutoff');
  assert.equal(deriveExamPreparation(course, { title: 'Examen final', allDay: true, day: '2026-02-30' }), null);
});

test('dated exam fallback uses coordinator-local days across UTC midnight', () => {
  const course = { modules: [module('before', 'Sesión 1', 1, [], { date: '2026-10-03' }),
    module('next-day', 'Sesión 2', 2, [], { date: '2026-10-04T23:30:00Z' })] };
  const event = { title: 'Examen final', startAt: '2026-10-05T08:00:00Z' };
  assert.equal(deriveExamPreparation(course, event, { timeZone: 'Europe/Madrid' }).preparation, 'Sesión 1');
  assert.equal(deriveExamPreparation(course, event, { timeZone: 'UTC' }).preparation, 'Sesión 2');
});

test('an undated asynchronous session after the dated candidate makes the exam cutoff unknown', () => {
  const event = { title: 'Examen final', startAt: '2026-10-08T18:00:00Z' };
  const course = { modules: [module('before', 'Sesión 13', 1, [], { date: '2026-10-07' }),
    module('uncertain', 'Sesión 14', 2), module('after', 'Sesión 15', 3, [], { date: '2026-10-09' })] };
  assert.equal(deriveExamPreparation(course, event), null);
  course.modules.pop();
  assert.equal(deriveExamPreparation(course, event), null, 'an undated tail also prevents claiming the last session before the exam');
});

test('CSV accepts BOM, Spanish headers, quoted semicolons, escaped quotes, multiline names and deduplicates', () => {
  const result = parseStudentCsv('\uFEFFNombre completo;Correo electrónico\r\n"García; Ana";ana@example.com\r\n"Luis ""Lucho""\nPérez";luis@example.com\r\nRepeated;ANA@example.com\r\nMissing;invalid\r\n');
  assert.deepEqual(result.students.map(({ name, email }) => [name, email]), [['García; Ana', 'ana@example.com'], ['Luis "Lucho"\nPérez', 'luis@example.com']]);
  assert.equal(result.warnings.length, 2);
});

test('CSV supports Canvas headers, tab separation, headerless files, and split names', () => {
  assert.equal(parseStudentCsv('Student,SIS Login ID,ID\n"Pérez, Marta",marta@example.com,42').students[0].id, '42');
  assert.equal(parseStudentCsv('First Name\tLast Name\tEmail\nAna\tGarcía\tana@example.com').students[0].name, 'Ana García');
  assert.equal(parseStudentCsv('Nombre,Apellidos,Email\nAna,García,ana@example.com').students[0].name, 'Ana García');
  assert.equal(parseStudentCsv('"Pérez, Marta",marta@example.com').students[0].name, 'Pérez, Marta');
  assert.equal(parseStudentCsv('marta@example.com').students[0].name, 'marta@example.com');
  assert.throws(() => parseStudentCsv('Name,ID\nAna,42'), /No se encontró una columna de correo/);
  assert.throws(() => parseStudentCsv('Name,Email\n"Ana,ana@example.com'), /comillas sin cerrar/);
  assert.deepEqual(parseStudentCsv('  '), { students: [], warnings: [] });
});

test('templates replace supplied independent dates, retain unresolved fields and report unique missing keys', () => {
  const result = resolveTemplate('{{course}} · {{day}}/{{month}}/{{year}}: {{topic}} {{topic}}', { course: 'Econometría', day: '17', month: '', year: 2026 });
  assert.equal(result.text, 'Econometría · 17/{{month}}/2026: {{topic}} {{topic}}');
  assert.deepEqual(result.missing, ['month', 'topic']);
  assert.equal(resolveTemplate('{{ count }} {{toString}}', { count: 0 }).text, '0 {{toString}}');
  assert.equal(resolveTemplate('{{value}}', { value: '$& <script>' }).text, '$& <script>');
});

test('Gmail compose has only coordinator in To and case-insensitively deduplicated students in BCC', () => {
  const url = new URL(buildGmailUrl({ to: 'coordinator@example.com', bcc: ['ana@example.com', 'ANA@example.com', 'COORDINATOR@example.com', 'luis@example.com'], subject: 'Mañana & Finanzas?', body: 'Hola Ana,\n2 + 2 = 4 & 5 # 6' }));
  assert.equal(url.origin, 'https://mail.google.com');
  assert.equal(url.searchParams.get('to'), 'coordinator@example.com');
  assert.equal(url.searchParams.get('bcc'), 'ana@example.com,luis@example.com');
  assert.equal(url.searchParams.get('su'), 'Mañana & Finanzas?');
  assert.equal(url.searchParams.get('body'), 'Hola Ana,\n2 + 2 = 4 & 5 # 6');
  assert.equal(url.searchParams.has('cc'), false);
});

test('Gmail rejects invalid addresses, injection and empty/all-self selection', () => {
  for (const to of ['', 'invalid', 'a@example.com\r\nBcc:someone@example.com', 'a..b@example.com']) assert.throws(() => buildGmailUrl({ to, bcc: ['a@example.com'] }), /correo de coordinación válido/);
  for (const bcc of [[], '', ['self@example.com'], ['bad'], ['student@example.com\ncc:bad@example.com']]) assert.throws(() => buildGmailUrl({ to: 'self@example.com', bcc }));
  const url = new URL(buildGmailUrl({ to: 'self@example.com', bcc: 'one@example.com; two@example.com' }));
  assert.equal(url.searchParams.get('bcc'), 'one@example.com,two@example.com');
  assert.equal(isValidEmail('ana+course@example.edu'), true);
  assert.equal(isValidEmail('ana@-example.com'), false);
});
