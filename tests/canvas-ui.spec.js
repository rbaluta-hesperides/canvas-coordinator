import { test, expect } from '@playwright/test';
import { createInitialState } from '../src/seed.js';
import { normalizeCourses } from '../src/domain.js';

const localOrigin = 'http://127.0.0.1:4174';
const baseUrl = 'https://canvas.example.edu';
const user = { id: 'coordinator-41', name: 'Coordinación desde Canvas', email: 'coordinacion@example.edu' };
const courseId = `canvas:${baseUrl}:${user.id}:42`;
const secondCourseId = `canvas:${baseUrl}:${user.id}:99`;
const student = (id, name, email) => ({ id, name, email });
const enrolled = [student('ana', 'Ana Canvas', 'ana@example.edu'), student('bruno', 'Bruno Canvas', 'bruno@example.edu'), student('no-email', 'Estudiante sin correo', '')];
const nav = (page, view) => page.locator(`.sidebar button[data-action="nav"][data-view="${view}"]`);

async function readState(request) {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function syncedCourses(range, model) {
  const savedAt = new Date().toISOString();
  const [course] = normalizeCourses([{
    id: courseId, name: `Economía [G.EC | 26/27 | ${model.semester} | 2]`, subject: 'Economía', code: `G.EC | 26/27 | ${model.semester} | 2`, students: model.students,
    modules: [
      { id: 'lesson-1', name: 'Sesión 1 | Introducción', position: 1, items: [{ id: 'video-1', type: 'Page', title: 'Vídeo: Conceptos iniciales', position: 1 }] },
      { id: 'lesson-2', name: 'Sesión 2 | Oferta y demanda', position: 2, items: [{ id: 'video-2', type: 'Page', title: 'Vídeo: Equilibrio de mercado', position: 1 }] },
      { id: 'live-2', name: 'Clase sincrónica 2', position: 3, items: [] },
    ],
    source: { type: 'canvas', baseUrl, userId: user.id, canvasCourseId: '42', savedAt },
  }]);
  const assignments = [{ id: '51', title: 'Trabajo individual', dueAt: `${range.endDate}T18:00:00.000Z`,
    description: '<p>Resolver los ejercicios publicados en Canvas.</p>', url: `${baseUrl}/courses/42/assignments/1` }];
  const classStartAt = model.classStartAt || `${range.startDate}T16:00:00.000Z`;
  Object.assign(course, {
    teachers: ['Profesora Canvas'], savedAt, assignments, calendarRange: range, timeZone: 'Europe/Vienna',
    calendarEvents: [
      { id: 'class-2', courseId, title: 'Clase sincrónica 2', startAt: classStartAt, endAt: new Date(Date.parse(classStartAt) + 3600000).toISOString(),
        type: 'event', description: model.classDescription, url: `${baseUrl}/courses/42` },
      { id: 'assignment_51', assignmentId: '51', courseId, title: 'Trabajo individual', type: 'assignment',
        startAt: assignments[0].dueAt, endAt: assignments[0].dueAt, description: assignments[0].description },
    ],
    syncStatus: { students: 'ok', modules: 'ok', pages: 'ok', teachers: 'ok', calendar: 'ok', assignments: 'ok' },
    syncWarnings: [], rosterAuthoritative: true, rosterComplete: model.students.every(person => person.email),
    missingEmailCount: model.students.filter(person => !person.email).length, preparationComplete: true,
  });
  if (!model.includeClass) course.calendarEvents = course.calendarEvents.filter(event => event.id !== 'class-2');
  if (!model.includeSecondCourse) return [course];
  const [second] = normalizeCourses([{
    id: secondCourseId, name: 'Estadística [G.EC | 26/27 | S5 | 2]', subject: 'Estadística', code: 'G.EC | 26/27 | S5 | 2',
    students: [student('other', 'Otro grupo', 'otro-grupo@example.edu')], modules: [],
    source: { type: 'canvas', baseUrl, userId: user.id, canvasCourseId: '99', savedAt },
  }]);
  Object.assign(second, {
    teachers: [], savedAt, assignments: [], calendarRange: range,
    calendarEvents: [{ id: 'tutorial', courseId: secondCourseId, title: 'Tutoría de Estadística', startAt: `${range.startDate}T18:00:00.000Z`,
      endAt: `${range.startDate}T19:00:00.000Z`, type: 'event', description: '<p>Revisar los ejercicios de probabilidad.</p>' }],
    syncStatus: { ...course.syncStatus }, syncWarnings: [], rosterAuthoritative: true, rosterComplete: true, missingEmailCount: 0, preparationComplete: true,
  });
  return [course, second];
}

async function mockCanvas(page, changes = {}) {
  const model = { students: structuredClone(enrolled), classDescription: '<p>Traed las preguntas de esta semana.</p>',
    includeSecondCourse: false, includeClass: true, semester: 'S5', connected: false, connectCalls: [], syncCalls: [], disconnectCalls: 0, ...changes };
  const status = () => ({ supported: true, connected: model.connected, baseUrl, user: model.connected ? user : null,
    mode: model.connected ? 'session' : null, credentialStorage: model.connected ? 'encrypted' : null });
  await page.route('**/api/canvas/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let payload;
    if (pathname.endsWith('/status')) payload = status();
    else if (pathname.endsWith('/connect')) {
      model.connectCalls.push(route.request().postDataJSON());
      model.connected = true;
      payload = status();
    } else if (pathname.endsWith('/sync')) {
      const range = route.request().postDataJSON();
      model.syncCalls.push(range);
      payload = { courses: syncedCourses(range, model), user, baseUrl, ...range, syncedAt: new Date().toISOString(), warnings: [] };
    } else if (pathname.endsWith('/disconnect')) {
      model.disconnectCalls++;
      model.connected = false;
      payload = status();
    } else throw new Error(`Unexpected Canvas endpoint: ${pathname}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  return model;
}

async function connectCanvas(page) {
  await page.goto('/');
  await page.locator('[data-action="canvas-connect"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Conectar con Canvas' })).toBeVisible();
  await expect(page.locator('#canvas-base-url')).toHaveValue(baseUrl);
  await page.locator('[data-action="canvas-login"]').click();
  await expect(page.locator('#academic-course-select option:checked')).toContainText('3º de Grado en Economía');
  await expect(page.locator('#canvas-connection-bar')).toContainText(user.name);
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('[data-action="canvas-fill-week"]')).toBeEnabled();
}

test.beforeEach(async ({ context, request }) => {
  // The real Canvas endpoints are never contacted, and Gmail popups cannot leave the test browser.
  await context.route('**/*', route => new URL(route.request().url()).origin === localOrigin ? route.continue() : route.abort('blockedbyclient'));
  const response = await request.post('/api/state', { headers: { Origin: localOrigin }, data: createInitialState() });
  expect(response.ok()).toBeTruthy();
});

test('Canvas login automatically fills the weekly email, profile, preparation and valid BCC recipients', async ({ page, context, request }) => {
  const model = await mockCanvas(page);
  const imports = [];
  page.on('filechooser', () => imports.push('file'));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/import-canvas') imports.push('cache'); });
  await connectCanvas(page);
  expect(model.connectCalls).toEqual([{ baseUrl }]);
  expect(model.syncCalls).toHaveLength(1);
  expect(imports).toEqual([]);
  await expect(page.locator('#template-select')).toHaveValue('template-weekly-summary');
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(2);
  await expect(page.locator('#email-body')).toContainText('Clase sincrónica 2');
  await expect(page.locator('#email-body')).toContainText('Sesión 2 | Oferta y demanda · Vídeo: Equilibrio de mercado');
  await expect(page.locator('#email-body')).toContainText('Entrega: Trabajo individual');
  await expect(page.locator('#email-body')).toContainText('Resolver los ejercicios publicados en Canvas.');
  await expect(page.locator('#email-body')).toContainText('Profesora Canvas');
  await expect(page.locator('[data-field="course_name"]')).toHaveValue('3º de Grado en Economía');
  await expect(page.locator('.weekly-entry').first().locator('.entry-schedule')).toContainText(/\d\d:\d\d–\d\d:\d\d/);
  await expect(page.locator('#preview-to')).toHaveText(user.email);
  await expect(page.locator('#recipient-count')).toHaveText('2 de 3 estudiantes');
  await expect(page.locator('.preview-column .roster-notice').filter({ hasText: /no se incluyen en CCO/i })).toBeVisible();
  await expect(page.locator('[data-week-range="startDate"]')).toHaveValue(model.syncCalls[0].startDate);
  await expect(page.locator('[data-week-range="endDate"]')).toHaveValue(model.syncCalls[0].endDate);

  await page.locator('[data-action="recipients"]').first().click();
  await expect(page.locator('[data-student-id="no-email"]')).toBeDisabled();
  await expect(page.locator('[data-student-id="ana"]')).toBeChecked();
  await expect(page.locator('[data-student-id="bruno"]')).toBeChecked();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect.poll(async () => (await readState(request)).settings.email).toBe(user.email);
  const subject = await page.locator('#email-subject').textContent();
  const body = await page.locator('#email-body').textContent();
  const gmail = page.locator('[data-action="gmail"]');
  await expect(gmail).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('canvas-connected.png'), fullPage: true });
  const handoffPromise = context.waitForEvent('request', { predicate: request => request.url().startsWith('https://mail.google.com/') });
  const popupPromise = page.waitForEvent('popup');
  await gmail.click();
  const [handoff, popup] = await Promise.all([handoffPromise, popupPromise]);
  const url = new URL(handoff.url());
  expect(url.searchParams.get('to')).toBe(user.email);
  expect(url.searchParams.get('bcc').split(',').sort()).toEqual(['ana@example.edu', 'bruno@example.edu']);
  expect(url.searchParams.has('cc')).toBeFalsy();
  expect(url.searchParams.get('su')).toBe(subject);
  expect(url.searchParams.get('body')).toBe(body);
  expect(body).not.toContain('{{');
  await popup.close();
});

test('refresh removes withdrawn students while preserving a recipient subset and an edited weekly entry', async ({ page, request }) => {
  const model = await mockCanvas(page, { students: [
    student('ana', 'Ana Canvas', 'ana@example.edu'), student('bruno', 'Bruno Canvas', 'bruno@example.edu'), student('carla', 'Carla Canvas', 'carla@example.edu'),
  ] });
  await connectCanvas(page);
  await page.locator('[data-action="recipients"]').first().click();
  await page.locator('[data-student-id="bruno"]').uncheck();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.locator('#recipient-count')).toHaveText('2 de 3 estudiantes');
  const preparation = page.locator('.weekly-entry').first().locator('[data-weekly-field="preparation"]');
  await preparation.fill('Preparación revisada por coordinación: ejercicios 1 y 2.');

  model.students = [student('ana', 'Ana Canvas', 'ana@example.edu'), student('bruno', 'Bruno Canvas', 'bruno@example.edu'), student('diana', 'Diana Canvas', 'diana@example.edu')];
  model.classDescription = '<p>Información actualizada desde Canvas.</p>';
  model.classStartAt = `${model.syncCalls[0].startDate}T19:30:00.000Z`;
  await page.locator('[data-action="canvas-sync"]').click();
  await expect.poll(() => model.syncCalls.length).toBe(2);
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#recipient-count')).toHaveText('1 de 3 estudiantes');
  await expect(preparation).toHaveValue('Preparación revisada por coordinación: ejercicios 1 y 2.');
  const movedStart = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date(model.classStartAt));
  await expect(page.locator('.weekly-entry').first().locator('.entry-schedule')).toContainText(movedStart);
  await expect(page.locator('#email-body')).toContainText(movedStart);
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(2);
  await page.locator('[data-action="recipients"]').first().click();
  await expect(page.locator('[data-student-id="carla"]')).toHaveCount(0);
  await expect(page.locator('[data-student-id="ana"]')).toBeChecked();
  await expect(page.locator('[data-student-id="bruno"]')).not.toBeChecked();
  await expect(page.locator('[data-student-id="diana"]')).not.toBeChecked();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect.poll(async () => (await readState(request)).courses[0].students.map(person => person.id).sort()).toEqual(['ana', 'bruno', 'diana']);
  await expect.poll(async () => (await readState(request)).composer.selectedStudentIds).toEqual(['ana']);
});

test('week selection synchronizes every included subject and uses the academic course recipient union', async ({ page }) => {
  const model = await mockCanvas(page, { includeSecondCourse: true });
  await connectCanvas(page);
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(3);
  await page.locator('.week-sources summary').click();
  const extra = page.locator(`[data-week-course="${secondCourseId}"]`);
  await expect(extra).toBeChecked();
  await extra.uncheck();
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(2);
  await page.locator('.week-sources summary').click();
  await extra.check();
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(3);
  await expect(page.locator('#email-body')).toContainText('Tutoría de Estadística');
  await expect(page.locator('#recipient-count')).toHaveText('3 de 4 estudiantes');
  const nextStart = new Date(`${model.syncCalls[0].startDate}T12:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() + 7);
  const nextEnd = new Date(`${model.syncCalls[0].endDate}T12:00:00Z`);
  nextEnd.setUTCDate(nextEnd.getUTCDate() + 7);
  // Extend the end before advancing the start so the intermediate range remains valid.
  await page.locator('[data-week-range="endDate"]').fill(nextEnd.toISOString().slice(0, 10));
  await page.locator('[data-week-range="startDate"]').fill(nextStart.toISOString().slice(0, 10));
  await page.locator('[data-action="canvas-fill-week"]').click();
  await expect.poll(() => model.syncCalls.at(-1)).toEqual({ startDate: nextStart.toISOString().slice(0, 10), endDate: nextEnd.toISOString().slice(0, 10) });
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(3);
  await page.locator('[data-action="recipients"]').first().click();
  await expect(page.locator('[data-student-id="other"]')).toBeChecked();
  await expect(page.locator('[data-student-id="ana"]')).toBeChecked();
});

test('disconnect clears the saved connection while keeping the synchronized local courses and email', async ({ page, request }) => {
  const model = await mockCanvas(page);
  await connectCanvas(page);
  const body = await page.locator('#email-body').textContent();
  await page.locator('[data-action="canvas-connect"]').first().click();
  await page.locator('[data-action="canvas-disconnect"]').click();
  await expect.poll(() => model.disconnectCalls).toBe(1);
  await expect(page.locator('#canvas-connection-bar')).toContainText('Conectar Canvas');
  await expect(page.locator('#academic-course-select option:checked')).toContainText('3º de Grado en Economía');
  await expect(page.locator('#email-body')).toHaveText(body);
  await expect.poll(async () => (await readState(request)).courses.length).toBe(1);
  await nav(page, 'courses').click();
  await expect(page.locator('.course-card')).toHaveCount(1);
  await expect(page.locator('.course-card')).toContainText('Economía');
});

test('single-class refresh follows rescheduled calendar dates while preserving an edited day', async ({ page, request }) => {
  const model = await mockCanvas(page);
  await connectCanvas(page);
  await page.locator('[data-action="compose-mode"][data-mode="single"]').click();
  const day = page.locator('[data-field="day"]');
  const time = page.locator('[data-field="time"]');
  const calendarDate = new Date(`${model.syncCalls[0].startDate}T16:00:00.000Z`);
  const localDay = date => new Intl.DateTimeFormat('en', { timeZone: 'Europe/Vienna', day: '2-digit' }).format(date);
  const localTime = date => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(date);
  await expect(day).toHaveValue(localDay(calendarDate));
  await expect(time).toHaveValue(localTime(calendarDate));

  calendarDate.setUTCDate(calendarDate.getUTCDate() + 1);
  calendarDate.setUTCHours(calendarDate.getUTCHours() + 1);
  model.classStartAt = calendarDate.toISOString();
  await page.locator('[data-action="canvas-sync"]').click();
  await expect.poll(() => model.syncCalls.length).toBe(2);
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(day).toHaveValue(localDay(calendarDate));
  await expect(time).toHaveValue(localTime(calendarDate));

  const editedDay = 'día indicado por coordinación';
  await day.fill(editedDay);
  calendarDate.setUTCDate(calendarDate.getUTCDate() + 1);
  calendarDate.setUTCHours(calendarDate.getUTCHours() + 2);
  model.classStartAt = calendarDate.toISOString();
  await page.locator('[data-action="canvas-sync"]').click();
  await expect.poll(() => model.syncCalls.length).toBe(3);
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(day).toHaveValue(editedDay);
  await expect(time).toHaveValue(localTime(calendarDate));
  await expect.poll(async () => (await readState(request)).composer.fields.day).toBe(editedDay);
  await expect.poll(async () => (await readState(request)).composer.fields.time).toBe(localTime(calendarDate));
});

test('a single draft blocks Gmail when its calendar event disappears while its module remains', async ({ page, request }) => {
  const model = await mockCanvas(page);
  await connectCanvas(page);
  await page.locator('[data-action="compose-mode"][data-mode="single"]').click();
  await expect(page.locator('#session-select')).toHaveValue('event:class-2');
  await expect(page.locator('[data-action="gmail"]')).toBeEnabled();
  await page.locator('[data-action="save-draft"]').click();
  await expect(page.locator('#toast')).toContainText('Borrador guardado');
  const oldFields = (await readState(request)).composer.fields;
  const oldBody = await page.locator('#email-body').textContent();

  model.includeClass = false;
  await page.locator('[data-action="canvas-sync"]').click();
  await expect.poll(() => model.syncCalls.length).toBe(2);
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#preview-validation')).toContainText('La actividad seleccionada ya no aparece en el calendario');
  await expect(page.locator('[data-action="gmail"]')).toBeDisabled();
  await expect(page.locator('#session-select option:checked')).toHaveText('Actividad fuera del calendario actual');
  await expect(page.locator('#session-select option:checked')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#session-select option[value="live-2"]')).toHaveCount(1);
  await expect(page.locator('#email-body')).toHaveText(oldBody);
  await expect.poll(async () => (await readState(request)).composer.fields).toEqual(oldFields);

  await page.locator('#session-select').selectOption({ label: 'Introducir los datos manualmente' });
  await expect(page.locator('#preview-validation')).not.toContainText('La actividad seleccionada ya no aparece en el calendario');
  await expect.poll(async () => (await readState(request)).composer.calendarEventId).toBe('');
});

test('a saved draft requires reviewing its academic course after Canvas moves its subject to another year', async ({ page, request }) => {
  const model = await mockCanvas(page);
  await connectCanvas(page);
  await expect(page.locator('[data-action="gmail"]')).toBeEnabled();
  await page.locator('[data-action="save-draft"]').click();
  await expect(page.locator('#toast')).toContainText('Borrador guardado');
  const saved = (await readState(request)).drafts[0];

  model.semester = 'S7';
  await page.locator('[data-action="canvas-sync"]').click();
  await expect.poll(() => model.syncCalls.length).toBe(2);
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#preview-validation')).toContainText('El curso académico de este borrador ya no coincide con los datos de Canvas');
  await expect(page.locator('[data-action="gmail"]')).toBeDisabled();
  await expect(page.locator('#recipient-count')).toHaveText('0 de 0 estudiantes');
  await expect(page.locator('#academic-course-select option:checked')).toHaveText('Revisar curso del borrador');
  await expect(page.locator('#academic-course-select option:checked')).toHaveJSProperty('disabled', true);
  await expect(page.locator('[data-field="course_name"]')).toHaveValue('3º de Grado en Economía');
  await page.locator('[data-action="recipients"]').first().click();
  await expect(page.locator('[data-student-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  expect((await readState(request)).drafts[0]).toEqual(saved);

  const fourth = page.locator('#academic-course-select option').filter({ hasText: '4º de Grado en Economía' });
  await page.locator('#academic-course-select').selectOption(await fourth.getAttribute('value'));
  await expect(page.locator('[data-field="course_name"]')).toHaveValue('4º de Grado en Economía');
  await expect(page.locator('#preview-validation')).not.toContainText('El curso académico de este borrador ya no coincide');
  await expect(page.locator('#recipient-count')).toHaveText('2 de 3 estudiantes');
  await expect(page.locator('[data-action="gmail"]')).toBeEnabled();
});
