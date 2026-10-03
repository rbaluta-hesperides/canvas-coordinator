import { test, expect } from '@playwright/test';
import { createInitialState } from '../src/seed.js';

const localOrigin = 'http://127.0.0.1:4174';
const baseUrl = 'https://canvas.example.edu';
const user = { id: 'academic-coordinator', name: 'Coordinación académica', email: 'coordinacion@example.edu' };
const courseId = id => `canvas:${baseUrl}:${user.id}:${id}`;
const person = (id, email = `${id}@example.edu`) => ({ id, name: id, email });
const localHour = date => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));

function academicSubjects(range) {
  const definitions = [
    { id: 'finance', name: 'Finanzas II', semester: 'S5', students: [person('ana'), person('alicia')], hour: 16 },
    { id: 'metrics', name: 'Econometría', semester: 'S5', students: [person('ana-other-id', 'ana@example.edu'), person('bruno')], hour: 18, tutorial: true },
    { id: 'micro', name: 'Microeconomía', semester: 'S3', students: [person('segundo')], hour: 10 },
    { id: 'trade', name: 'Economía Internacional', semester: 'S7', students: [person('cuarto')], hour: 12 },
  ];
  return definitions.map(subject => {
    const id = courseId(subject.id);
    const startAt = `${range.startDate}T${subject.hour}:00:00.000Z`;
    const endAt = new Date(Date.parse(startAt) + 90 * 60000).toISOString();
    return {
      id, name: `${subject.name} [G.EC | 26/27 | ${subject.semester} | 2]`, subject: subject.name,
      code: `G.EC | 26/27 | ${subject.semester} | 2`, students: subject.students,
      source: { type: 'canvas', baseUrl, userId: user.id, canvasCourseId: subject.id },
      modules: subject.tutorial ? [] : [
        { id: `${subject.id}-prep`, name: 'Sesión 4 | Preparación', position: 1, items: [] },
        { id: `${subject.id}-live`, name: 'Clase sincrónica 2', position: 2, items: [] },
      ],
      calendarEvents: [{ id: `${subject.id}-event`, courseId: id,
        title: subject.tutorial ? `Tutoría de ${subject.name}` : 'Clase sincrónica 2',
        type: 'event', startAt, endAt,
        description: subject.tutorial ? '<p>Traed resueltos los ejercicios de estimación.</p>' : '<p>Se resolverán las dudas de la sesión.</p>',
      }],
      calendarRange: range, assignments: [], teachers: ['Docente de prueba'], preparationComplete: true,
      syncStatus: { modules: 'ok', pages: 'ok', calendar: 'ok', students: 'ok', teachers: 'ok', assignments: 'ok' },
      syncWarnings: [], rosterComplete: true, rosterAuthoritative: true, missingEmailCount: 0,
    };
  });
}

async function connectAcademicCanvas(page) {
  const model = { connected: false, ranges: [], subjects: [] };
  await page.route('**/api/canvas/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    let payload;
    const status = () => ({ supported: true, connected: model.connected, baseUrl, user: model.connected ? user : null,
      mode: model.connected ? 'session' : null, credentialStorage: model.connected ? 'encrypted' : null });
    if (endpoint === 'status') payload = status();
    else if (endpoint === 'connect') { model.connected = true; payload = status(); }
    else if (endpoint === 'sync') {
      const range = route.request().postDataJSON();
      model.ranges.push(range); model.subjects = academicSubjects(range);
      payload = { courses: model.subjects, user, baseUrl, ...range, syncedAt: new Date().toISOString(), warnings: [] };
    } else throw new Error(`Unexpected Canvas endpoint: ${endpoint}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto('/');
  await page.locator('[data-action="canvas-connect"]').first().click();
  await page.locator('[data-action="canvas-login"]').click();
  await expect(page.locator('#academic-course-select')).toBeVisible();
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  const third = page.locator('#academic-course-select option').filter({ hasText: '3º de Grado en Economía' });
  await page.locator('#academic-course-select').selectOption(await third.getAttribute('value'));
  return model;
}

test.beforeEach(async ({ context, request }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === localOrigin ? route.continue() : route.abort('blockedbyclient'));
  const state = createInitialState(); state.settings.timeZone = 'Europe/Madrid';
  const response = await request.post('/api/state', { headers: { Origin: localOrigin }, data: state });
  expect(response.ok()).toBeTruthy();
});

test('third year contains its subjects and calendar timetable, with the deduplicated third-year roster in BCC', async ({ page, context }) => {
  const imports = [];
  page.on('filechooser', () => imports.push('file'));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/import-canvas') imports.push('cache'); });
  const model = await connectAcademicCanvas(page);
  expect(imports).toEqual([]);
  await expect(page.locator('#academic-course-select option')).toContainText([
    '2º de Grado en Economía', '3º de Grado en Economía', '4º de Grado en Economía',
  ]);
  await expect(page.locator('#course-select')).toHaveCount(0);
  await expect(page.locator('[data-field="course_name"]')).toHaveValue('3º de Grado en Economía');
  await expect(page.locator('#email-subject')).toContainText('3º de Grado en Economía');
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(2);
  await expect(page.locator('#email-body')).toContainText('Finanzas II');
  await expect(page.locator('#email-body')).toContainText('Econometría');
  await expect(page.locator('#email-body')).not.toContainText('Microeconomía');
  await expect(page.locator('#email-body')).not.toContainText('Economía Internacional');
  await expect(page.locator('#recipient-count')).toHaveText('3 de 3 estudiantes');

  const finance = model.subjects.find(subject => subject.id === courseId('finance')).calendarEvents[0];
  const hours = `${localHour(finance.startAt)}–${localHour(finance.endAt)}`;
  await expect(page.locator('.entry-schedule').first()).toContainText(hours);
  await expect(page.locator('.entry-schedule').first()).toContainText('Europe/Madrid');
  await expect(page.locator('#email-body')).toContainText(hours);
  await expect(page.locator('#email-body')).toContainText('Traed resueltos los ejercicios de estimación.');
  await page.screenshot({ path: test.info().outputPath('academic-weekly.png'), fullPage: true });
  const handoffPromise = context.waitForEvent('request', { predicate: request => request.url().startsWith('https://mail.google.com/') });
  const popupPromise = page.waitForEvent('popup');
  await expect(page.locator('[data-action="gmail"]')).toBeEnabled();
  await page.locator('[data-action="gmail"]').click();
  const [handoff, popup] = await Promise.all([handoffPromise, popupPromise]);
  const url = new URL(handoff.url());
  expect(url.searchParams.get('to')).toBe(user.email);
  expect(url.searchParams.get('bcc').split(',').sort()).toEqual(['alicia@example.edu', 'ana@example.edu', 'bruno@example.edu']);
  expect(url.searchParams.has('cc')).toBeFalsy();
  expect(url.searchParams.get('body')).toContain(hours);
  await popup.close();
});

test('changing academic year changes subjects and recipients instead of renaming one Canvas subject', async ({ page }) => {
  await connectAcademicCanvas(page);
  const fourth = page.locator('#academic-course-select option').filter({ hasText: '4º de Grado en Economía' });
  await page.locator('#academic-course-select').selectOption(await fourth.getAttribute('value'));
  await expect(page.locator('[data-field="course_name"]')).toHaveValue('4º de Grado en Economía');
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(1);
  await expect(page.locator('#email-body')).toContainText('Economía Internacional');
  await expect(page.locator('#email-body')).not.toContainText('Finanzas II');
  await expect(page.locator('#email-body')).not.toContainText('Econometría');
  await expect(page.locator('#recipient-count')).toHaveText('1 de 1 estudiantes');
  await page.locator('[data-action="recipients"]').first().click();
  await expect(page.locator('[data-student-id="cuarto"]')).toBeChecked();
  await expect(page.locator('[data-student-id="ana"]')).toHaveCount(0);
});

test('a subject-only email uses its own roster and calendar hours even for a tutorial without a module session', async ({ page }) => {
  const model = await connectAcademicCanvas(page);
  await page.locator('[data-action="compose-mode"][data-mode="single"]').click();
  await expect(page.locator('#course-select option')).toHaveCount(2);
  await expect(page.locator('#course-select option')).toContainText(['Finanzas II', 'Econometría']);
  await page.locator('#course-select').selectOption(courseId('metrics'));
  await page.locator('#session-select').selectOption('event:metrics-event');
  await expect(page.locator('[data-field="course_name"]')).toHaveValue('3º de Grado en Economía');
  await expect(page.locator('[data-field="subject"]')).toHaveValue('Econometría');
  await expect(page.locator('[data-field="preparation"]')).toHaveValue('Traed resueltos los ejercicios de estimación.');
  const event = model.subjects.find(subject => subject.id === courseId('metrics')).calendarEvents[0];
  await expect(page.locator('[data-field="time"]')).toHaveValue(localHour(event.startAt));
  await expect(page.locator('#class-schedule')).toContainText(`${localHour(event.startAt)}–${localHour(event.endAt)}`);
  await expect(page.locator('#recipient-count')).toHaveText('2 de 2 estudiantes');
  await page.locator('[data-action="recipients"]').first().click();
  await expect(page.locator('[data-student-id="bruno"]')).toBeChecked();
  await expect(page.locator('[data-student-id="alicia"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.locator('[data-field="day"]').fill('día acordado con la clase');
  await page.locator('.sidebar [data-action="nav"][data-view="settings"]').click();
  await page.locator('[data-setting="timeZone"]').selectOption('UTC');
  await page.locator('.sidebar button[data-action="nav"][data-view="compose"]').click();
  await expect(page.locator('[data-field="day"]')).toHaveValue('día acordado con la clase');
  await expect(page.locator('[data-field="time"]')).toHaveValue('18:00');
  await expect(page.locator('[data-field="end_time"]')).toHaveValue('19:30');
  await expect(page.locator('#class-schedule')).toContainText('18:00–19:30 (UTC)');
});
