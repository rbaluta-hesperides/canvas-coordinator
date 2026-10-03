import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasClient, normalizeCanvasBase } from '../electron/canvas-client.js';
import { planCanvasWeek } from '../src/canvas-planner.js';

const base = 'https://canvas.example.edu';
const currentTime = Date.parse('2026-10-03T10:00:00Z');
const courseId = `canvas:${base}:coordinator:42`;
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const liveModules = [
  { id: 'lesson', name: 'Módulo 1 | Sesión 1', position: 1, items_count: 1, items: [{ id: 'video', title: 'Vídeo: Introducción', type: 'Page', page_url: 'video', position: 1 }] },
  { id: 'live', name: 'Clase sincrónica 1', position: 2, items_count: 0, items: [] },
];
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const routes = {
    '/api/v1/users/self/profile': () => response({ id: 'coordinator', name: 'Coordinación', primary_email: 'coord@example.edu' }),
    '/api/v1/courses': () => response([{ id: '42', name: 'Economía', course_code: 'ECO', modules: [], time_zone: 'Europe/Madrid' }]),
    '/api/v1/courses/42/modules': () => response(structuredClone(liveModules)),
    '/api/v1/courses/42/users': url => response(url.searchParams.getAll('enrollment_type[]').includes('student')
      ? [{ id: 'student', name: 'Ana', email: 'ana@example.edu', enrollments: [{ type: 'StudentEnrollment', enrollment_state: 'active', course_id: '42' }] }]
      : [{ id: 'teacher', name: 'Profesor', enrollments: [{ type: 'TeacherEnrollment', enrollment_state: 'active' }] }]),
    '/api/v1/calendar_events': () => response([{ id: 'event', title: 'Clase sincrónica 1', context_code: 'course_42', start_at: '2026-10-05T18:00:00Z', end_at: '2026-10-05T19:00:00Z', description: '<p>Clase semanal</p>' }]),
    '/api/v1/courses/42/assignments': () => response([{ id: 'assignment', name: 'Entrega 1', due_at: '2026-10-09T20:00:00Z', html_url: `${base}/courses/42/assignments/assignment`, description: 'Práctica' }]),
    ...overrides,
  };
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.match(init.headers.get('accept'), /canvas-string-ids/);
    const route = routes[url.pathname];
    assert.ok(route, `Unexpected endpoint: ${url.pathname}`);
    return route(url, init);
  };
  return { calls, client: createCanvasClient({ baseUrl: base, fetchImpl, now: () => currentTime, maxRetries: 0, ...options }) };
}

test('Canvas domain accepts only an HTTPS origin without embedded credentials', () => {
  assert.equal(normalizeCanvasBase(''), 'https://hesperides.instructure.com');
  assert.equal(normalizeCanvasBase('canvas.example.edu/'), base);
  assert.equal(normalizeCanvasBase(' https://canvas.example.edu/// '), base);
  for (const invalid of ['http://canvas.example.edu', `${base}/courses/42`, `${base}?token=secret`, `${base}#secret`, 'https://name:password@canvas.example.edu', 'file:///tmp/canvas', {}]) {
    assert.throws(() => normalizeCanvasBase(invalid), { code: 'INVALID_BASE' });
  }
});

test('profile headers are supplied by the authenticated transport and profile is reduced to necessary fields', async () => {
  const { client, calls } = fixture({}, { getHeaders: async () => ({ Authorization: 'Bearer test-token' }) });
  assert.deepEqual(await client.getProfile(), { id: 'coordinator', name: 'Coordinación', email: 'coord@example.edu' });
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer test-token');
});

test('sync fetches all enrollment types, live structure, active students, teachers, calendar, and assignments', async () => {
  const { client, calls } = fixture();
  const progress = [];
  const result = await client.sync({ onProgress: value => progress.push(value) });
  const [course] = result.courses;
  assert.equal(course.id, courseId);
  assert.deepEqual(course.source, { type: 'canvas', baseUrl: base, userId: 'coordinator', canvasCourseId: '42', savedAt: '2026-10-03T10:00:00.000Z' });
  assert.equal(course.sessions[0].preparation, 'Módulo 1 | Sesión 1 · Vídeo: Introducción');
  assert.deepEqual(course.students, [{ id: 'student', name: 'Ana', email: 'ana@example.edu' }]);
  assert.deepEqual(course.teachers, ['Profesor']);
  assert.equal(course.calendarEvents.length, 2);
  assert.equal(course.calendarEvents[0].courseId, courseId);
  assert.equal(course.calendarEvents[1].type, 'assignment');
  assert.equal(course.calendarEvents[1].startAt, '2026-10-09T20:00:00.000Z');
  assert.equal(course.assignments[0].title, 'Entrega 1');
  assert.equal(course.rosterComplete, true);
  assert.equal(course.rosterAuthoritative, true);
  assert.equal(course.missingEmailCount, 0);
  assert.equal(course.preparationComplete, true);
  assert.equal(result.startDate, '2026-09-26');
  assert.equal(result.endDate, '2026-12-02');
  assert.deepEqual(result.warnings, []);
  const courseRequest = calls.find(call => call.url.pathname === '/api/v1/courses');
  assert.equal(courseRequest.url.searchParams.has('enrollment_type'), false);
  assert.equal(courseRequest.url.searchParams.has('enrollment_type[]'), false);
  const rosterRequest = calls.find(call => call.url.searchParams.get('enrollment_type[]') === 'student');
  assert.deepEqual(rosterRequest.url.searchParams.getAll('enrollment_state[]'), ['active']);
  assert.deepEqual(rosterRequest.url.searchParams.getAll('include[]'), ['enrollments']);
  const assignmentRequest = calls.find(call => call.url.pathname.endsWith('/assignments'));
  assert.deepEqual(assignmentRequest.url.searchParams.getAll('include[]'), ['all_dates', 'overrides']);
  assert.equal(assignmentRequest.url.searchParams.get('override_assignment_dates'), 'false');
  assert.equal(progress.at(-1).phase, 'complete');
});

test('malformed course rows reject the entire sync instead of silently deleting cached courses', async () => {
  for (const malformed of [null, [], { name: 'Missing ID' }, { id: '' }, { id: '   ' }, { id: {} }, { id: true }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const { client, calls } = fixture({ '/api/v1/courses': () => response([{ id: '42', name: 'Valid course' }, malformed]) });
    await assert.rejects(client.sync(), { code: 'INVALID_RESPONSE' });
    assert.ok(calls.every(call => !call.url.pathname.startsWith('/api/v1/courses/42/')));
  }
});

test('differentiated assignments keep scoped deadlines and exclude individual student identities', async () => {
  const { client } = fixture({ '/api/v1/courses/42/assignments': () => response([{
    id: 'paper', name: 'Ensayo', has_overrides: true, due_at: '2026-10-01T12:00:00Z',
    all_dates: [
      { base: true, title: 'Everyone Else', due_at: '2026-10-05T12:00:00Z' },
      { id: 'section-date', title: 'Grupo de tarde', due_at: '2026-10-06T12:00:00Z' },
      { id: 'personal-date', title: 'Private Student Name', due_at: '2026-10-07T12:00:00Z' },
      { id: 'undated', title: 'Sin fecha', due_at: null },
    ],
    overrides: [
      { id: 'section-date', course_section_id: '2', title: 'Grupo de tarde' },
      { id: 'personal-date', student_ids: ['private-student-id'], title: 'Private Student Name' },
      { id: 'undated', group_id: '3', title: 'Sin fecha' },
    ],
  }]) });
  const { courses, warnings } = await client.sync({ startDate: '2026-10-05', endDate: '2026-10-09' });
  const assignments = courses[0].assignments;
  assert.equal(assignments.length, 4);
  assert.equal(new Set(assignments.map(assignment => assignment.id)).size, 4);
  assert.ok(assignments.every(assignment => assignment.canvasAssignmentId === 'paper' && assignment.differentiated && assignment.datesComplete));
  assert.deepEqual(assignments.map(assignment => assignment.dueAt), ['2026-10-05T12:00:00.000Z', '2026-10-06T12:00:00.000Z', '2026-10-07T12:00:00.000Z', '']);
  assert.equal(assignments[0].dueScope, 'Resto de estudiantes, según Canvas');
  assert.equal(assignments[1].dueScope, 'Grupo de tarde');
  assert.equal(assignments[2].dueScope, 'Estudiantes con una fecha individual en Canvas');
  assert.equal(JSON.stringify(assignments).includes('Private Student Name'), false);
  assert.equal(JSON.stringify(assignments).includes('private-student-id'), false);
  assert.equal(courses[0].calendarEvents.filter(event => event.type === 'assignment').length, 3);
  assert.ok(warnings.some(warning => warning.includes('Cada estudiante debe comprobar')));
});

test('unavailable differentiated dates never become a universal deadline from due_at', async () => {
  for (const all_dates of [undefined, [], [{ base: true, due_at: '2026-10-05T12:00:00Z' }], [{ id: 'override', due_at: 'invalid' }]]) {
    const { client } = fixture({ '/api/v1/courses/42/assignments': () => response([{
      id: 'paper', name: 'Ensayo', has_overrides: true, due_at: '2026-10-05T12:00:00Z', all_dates,
    }]) });
    const { courses, warnings } = await client.sync();
    assert.equal(courses[0].assignments[0].dueAt, '');
    assert.equal(courses[0].assignments[0].datesComplete, false);
    assert.equal(courses[0].calendarEvents.filter(event => event.type === 'assignment').length, 0);
    assert.ok(warnings.some(warning => warning.includes('No se ha añadido una fecha general')));
  }
});

test('assignments limited to selected recipients never publish the hidden base date', async () => {
  const { client } = fixture({ '/api/v1/courses/42/assignments': () => response([{
    id: 'paper', name: 'Ensayo', only_visible_to_overrides: true, due_at: '2026-10-05T12:00:00Z',
    all_dates: [{ base: true, due_at: '2026-10-05T12:00:00Z' }, { id: 'specific', title: 'Private student', due_at: '2026-10-06T12:00:00Z' }],
  }]) });
  const { courses } = await client.sync();
  assert.equal(courses[0].assignments.length, 1);
  assert.equal(courses[0].assignments[0].dueAt, '2026-10-06T12:00:00.000Z');
  assert.equal(courses[0].assignments[0].dueScope, 'Destinatarios de esta fecha en Canvas');
  assert.equal(JSON.stringify(courses[0].assignments).includes('Private student'), false);
});

test('malformed assignment rows are an explicit endpoint failure, preserving old assignments on merge', async () => {
  const { client } = fixture({ '/api/v1/courses/42/assignments': () => response([{ name: 'Missing ID' }]) });
  const { courses, warnings } = await client.sync();
  assert.equal(courses[0].syncStatus.assignments, 'error');
  assert.deepEqual(courses[0].assignments, []);
  assert.ok(warnings.some(warning => warning.includes('lista de actividades incompleta')));
});

test('paginated course and student lists are fully fetched and student-only filtering prevents staff recipients', async () => {
  const { client, calls } = fixture({
    '/api/v1/courses': url => url.searchParams.get('page') === '2' ? response([])
      : response([{ id: '42', name: 'Economía' }], 200, { link: `<${base}/api/v1/courses?page=2>; rel="next"` }),
    '/api/v1/courses/42/users': url => {
      if (!url.searchParams.getAll('enrollment_type[]').includes('student')) return response([]);
      if (url.searchParams.get('page') === '2') return response([
        { id: 'student2', name: 'Bea', login_id: 'bea@example.edu', enrollments: [{ type: 'StudentEnrollment', enrollment_state: 'active' }] },
        { id: 'teacher', name: 'Staff', email: 'staff@example.edu', enrollments: [{ type: 'TeacherEnrollment' }] },
        { id: 'old', name: 'Inactive', email: 'inactive@example.edu', enrollments: [{ type: 'StudentEnrollment', enrollment_state: 'inactive' }] },
        { id: 'wrong-course', name: 'Otro curso', email: 'other@example.edu', enrollments: [{ type: 'StudentEnrollment', course_id: '999' }] },
      ]);
      return response([{ id: 'student1', name: 'Ana', email: 'ana@example.edu' }], 200,
        { link: `<${base}/api/v1/courses/42/users?page=2&enrollment_type%5B%5D=student>; rel="next"` });
    },
  });
  const { courses } = await client.sync();
  assert.deepEqual(courses[0].students.map(student => student.email), ['ana@example.edu', 'bea@example.edu']);
  assert.equal(calls.filter(call => call.url.pathname === '/api/v1/courses').length, 2);
});

test('partial inline module items trigger full paginated module items fetch', async () => {
  const { client, calls } = fixture({
    '/api/v1/courses/42/modules': () => response([
      { ...liveModules[0], items_count: 2 }, liveModules[1],
    ]),
    '/api/v1/courses/42/modules/lesson/items': url => url.searchParams.get('page') === '2'
      ? response([{ id: 'last-video', title: 'Vídeo: Última lección', type: 'Page', position: 2 }])
      : response(liveModules[0].items, 200, { link: `<${base}/api/v1/courses/42/modules/lesson/items?page=2>; rel="next"` }),
  });
  const { courses } = await client.sync();
  assert.equal(courses[0].modules[0].items.length, 2);
  assert.match(courses[0].sessions[0].preparation, /Última lección/);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/lesson/items')).length, 2);
});

test('incomplete module list is explicitly marked as failed rather than using a wrong preparation cutoff', async () => {
  const { client } = fixture({
    '/api/v1/courses/42/modules': () => response([{ ...liveModules[0], items_count: 2 }, liveModules[1]]),
    '/api/v1/courses/42/modules/lesson/items': () => response(liveModules[0].items),
  });
  const { courses, warnings } = await client.sync();
  assert.equal(courses[0].syncStatus.modules, 'error');
  assert.equal(courses[0].hasStructure, false);
  assert.equal(courses[0].preparationComplete, false);
  assert.deepEqual(courses[0].sessions, []);
  assert.match(warnings[0], /módulo incompleto/);
});

test('foreign-origin and non-API next links are rejected before any credentials can be forwarded', async () => {
  for (const next of ['https://attacker.example/api/v1/courses?page=2', `${base}/login`, 'https://user:password@canvas.example.edu/api/v1/courses']) {
    const { client, calls } = fixture({ '/api/v1/courses': () => response([], 200, { link: `<${next}>; rel="next"` }) },
      { getHeaders: () => ({ Authorization: 'Bearer test-token' }) });
    await assert.rejects(client.sync(), { code: 'UNSAFE_URL' });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.url.origin === base));
  }
});

test('redirect responses are never followed and require reconnecting', async () => {
  const { client, calls } = fixture({ '/api/v1/users/self/profile': () => new Response('', { status: 302, headers: { location: 'https://attacker.example/' } }) });
  await assert.rejects(client.getProfile(), { code: 'REDIRECTED' });
  assert.equal(calls.length, 1);
});

test('an authentication failure during a course sync aborts the entire result without leaking the body', async () => {
  const { client } = fixture({ '/api/v1/courses/42/users': () => response({ errors: [{ message: 'secret-token-in-response' }] }, 401) });
  await assert.rejects(client.sync(), error => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('denied roster access is an explicit partial failure, not an authoritative empty roster', async () => {
  const { client } = fixture({ '/api/v1/courses/42/users': url => url.searchParams.get('enrollment_type[]') === 'student' ? response({}, 403) : response([]) });
  const { courses, warnings } = await client.sync();
  assert.equal(courses[0].syncStatus.students, 'error');
  assert.equal(courses[0].rosterComplete, false);
  assert.equal(courses[0].rosterAuthoritative, false);
  assert.equal(courses[0].missingEmailCount, null);
  assert.equal(courses[0].syncStatus.modules, 'ok');
  assert.match(warnings.join(' '), /lista de estudiantes.*permiso/);
});

test('successful empty roster remains authoritative so withdrawn students can be removed', async () => {
  const { client } = fixture({ '/api/v1/courses/42/users': () => response([]) });
  const { courses } = await client.sync();
  assert.deepEqual(courses[0].students, []);
  assert.equal(courses[0].rosterAuthoritative, true);
  assert.equal(courses[0].rosterComplete, true);
});

test('malformed roster rows fail the roster instead of silently removing existing students', async () => {
  const { client } = fixture({ '/api/v1/courses/42/users': url => response(url.searchParams.get('enrollment_type[]') === 'student' ? [{ name: 'Missing identifier' }] : []) });
  const { courses } = await client.sync();
  assert.equal(courses[0].syncStatus.students, 'error');
  assert.equal(courses[0].rosterAuthoritative, false);
});

test('students without permitted valid email addresses are retained with a warning', async () => {
  const { client } = fixture({ '/api/v1/courses/42/users': url => response(url.searchParams.get('enrollment_type[]') === 'student' ? [
    { id: 'no-email', name: 'Sin correo', login_id: 'internal-login' }, { id: 'bad-email', name: 'Correo incorrecto', email: 'invalid' },
  ] : []) });
  const { courses, warnings } = await client.sync();
  assert.equal(courses[0].students.length, 2);
  assert.equal(courses[0].missingEmailCount, 2);
  assert.equal(courses[0].rosterAuthoritative, true);
  assert.equal(courses[0].rosterComplete, false);
  assert.match(warnings[0], /2 estudiante/);
});

test('calendar uses selected dates and excludes personal, deleted, undated and unpublished assignment entries', async () => {
  const { client, calls } = fixture({
    '/api/v1/calendar_events': () => response([
      { id: 'personal', title: 'Personal', context_code: 'user_coordinator', start_at: '2026-10-05T10:00:00Z' },
      { id: 'deleted', workflow_state: 'deleted', start_at: '2026-10-05T10:00:00Z' },
      { id: 'undated', title: 'Sin fecha' },
      { id: 'class', context_code: 'course_42', start_at: '2026-10-05T10:00:00Z' },
    ]),
    '/api/v1/courses/42/assignments': () => response([
      { id: 'outside', name: 'Fuera', due_at: '2026-12-01T12:00:00Z' },
      { id: 'unpublished', name: 'Borrador', published: false, due_at: '2026-10-06T12:00:00Z' },
      { id: 'inside', name: 'Entrega', due_at: '2026-10-09T22:00:00Z' },
    ]),
  });
  const { courses } = await client.sync({ startDate: '2026-10-05', endDate: '2026-10-09' });
  assert.deepEqual(courses[0].calendarEvents.map(event => event.id), ['class', 'assignment_inside']);
  assert.equal(courses[0].assignments.length, 2);
  const request = calls.find(call => call.url.pathname === '/api/v1/calendar_events');
  assert.equal(request.url.searchParams.get('start_date'), '2026-10-04');
  assert.equal(request.url.searchParams.get('end_date'), '2026-10-10');
  assert.equal(request.url.searchParams.get('context_codes[]'), 'course_42');
});

test('calendar fetches adjacent days and the planner keeps exactly the chosen local week', async () => {
  const events = [
    { id: 'first', title: 'Inicio de semana', start_at: '2026-10-04T22:30:00Z', description: 'Indicaciones.' },
    { id: 'last', title: 'Fin de semana', start_at: '2026-10-09T21:30:00Z', description: 'Indicaciones.' },
    { id: 'outside', title: 'Sábado', start_at: '2026-10-09T22:30:00Z', description: 'Indicaciones.' },
  ];
  const { client } = fixture({
    '/api/v1/calendar_events': url => response(events.filter(event => {
      const day = event.start_at.slice(0, 10);
      return day >= url.searchParams.get('start_date') && day <= url.searchParams.get('end_date');
    })),
    '/api/v1/courses/42/assignments': () => response([]),
  });
  const result = await client.sync({ startDate: '2026-10-05', endDate: '2026-10-09' });
  assert.equal(result.startDate, '2026-10-05');
  assert.equal(result.endDate, '2026-10-09');
  assert.deepEqual(result.courses[0].calendarRange, { startDate: '2026-10-05', endDate: '2026-10-09' });
  const plan = planCanvasWeek(result.courses, { startDate: result.startDate, endDate: result.endDate, timeZone: 'Europe/Vienna' });
  assert.deepEqual(plan.entries.map(entry => entry.sourceEventId), ['first', 'last']);
  assert.match(plan.entries[0].notes, /00:30/);
  assert.match(plan.entries[1].notes, /23:30/);
});

test('generic module video discovery reads latest revisions without marking pages viewed', async () => {
  const { client, calls } = fixture({
    '/api/v1/courses/42/modules': () => response([
      { id: 'generic', name: 'Unidad 1', items: [{ id: 'content', title: 'Introducción', type: 'Page', page_url: 'introduccion' }] },
      { id: 'live', name: '⚪ Sesión 1', items: [] },
    ]),
    '/api/v1/courses/42/pages': () => response({}, 404),
    '/api/v1/courses/42/pages/introduccion/revisions/latest': () => response({ body: '<video src="lesson.mp4"></video>' }),
  });
  const { courses } = await client.sync();
  assert.equal(courses[0].pages.length, 1);
  assert.match(courses[0].sessions[0].preparation, /Introducción/);
  assert.ok(calls.some(call => call.url.pathname.endsWith('/revisions/latest')));
  assert.ok(calls.every(call => call.url.pathname !== '/api/v1/courses/42/pages/introduccion'));
});

test('list page bodies avoid individual revision lookups when present', async () => {
  const { client, calls } = fixture({
    '/api/v1/courses/42/modules': () => response([{ id: 'generic', name: 'Tema', items: [{ id: 'p', type: 'Page', title: 'Tema', page_url: 'tema' }] }, liveModules[1]]),
    '/api/v1/courses/42/pages': () => response([{ url: 'tema', body: '<video></video>' }]),
  });
  const { courses } = await client.sync();
  assert.match(courses[0].sessions[0].preparation, /Tema/);
  assert.ok(!calls.some(call => call.url.pathname.endsWith('/revisions/latest')));
  assert.equal(calls.find(call => call.url.pathname.endsWith('/pages')).url.searchParams.get('include[]'), 'body');
});

test('page limits fail explicitly rather than silently truncating lists', async () => {
  const { client } = fixture({ '/api/v1/courses': () => response([{ id: '42' }], 200, { link: `<${base}/api/v1/courses?page=2>; rel="next"` }) }, { maxPages: 1 });
  await assert.rejects(client.sync(), { code: 'PAGINATION_LIMIT' });
});

test('pagination cycles fail before repeating a network request', async () => {
  const { client, calls } = fixture({ '/api/v1/courses': () => response([{ id: '42' }], 200, { link: `<${base}/api/v1/courses?page=2>; rel="next"` }) });
  await assert.rejects(client.sync(), { code: 'PAGINATION_LIMIT' });
  assert.equal(calls.filter(call => call.url.pathname === '/api/v1/courses').length, 2);
});

test('course identities are isolated by account even on the same Canvas server', async () => {
  const { client } = fixture({ '/api/v1/users/self/profile': () => response({ id: 'other-account', name: 'Other' }) });
  const { courses } = await client.sync();
  assert.notEqual(courses[0].id, courseId);
  assert.equal(courses[0].id, `canvas:${base}:other-account:42`);
  assert.equal(courses[0].calendarEvents[0].courseId, courses[0].id);
});

test('network timeout is bounded and reported without transport details', async () => {
  const client = createCanvasClient({ baseUrl: base, timeoutMs: 5, maxRetries: 0,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private transport details')))) });
  await assert.rejects(client.getProfile(), error => {
    assert.equal(error.code, 'TIMEOUT');
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test('rate limits retry a bounded number of times and then fail without response details', async () => {
  let attempts = 0;
  const delays = [];
  const { client } = fixture({ '/api/v1/users/self/profile': () => { attempts++; return response({ error: 'secret response' }, 429, { 'retry-after': '90' }); } },
    { maxRetries: 2, sleepImpl: async delay => delays.push(delay) });
  await assert.rejects(client.getProfile(), { code: 'RATE_LIMITED', status: 429 });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [8000, 8000]);
});

test('aborted sync makes no requests and invalid dates are rejected before connecting', async () => {
  const { client, calls } = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.sync({ signal: controller.signal }), { code: 'ABORTED' });
  await assert.rejects(client.sync({ startDate: '2026-02-30' }), { code: 'INVALID_RANGE' });
  await assert.rejects(client.sync({ startDate: '2026-10-10', endDate: '2026-10-01' }), { code: 'INVALID_RANGE' });
  assert.equal(calls.length, 0);
});

test('HTML login responses are treated as authentication failures', async () => {
  const { client } = fixture({ '/api/v1/users/self/profile': () => new Response('<html>Log in</html>', { headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(client.getProfile(), { code: 'AUTH_REQUIRED', status: 401 });
});
