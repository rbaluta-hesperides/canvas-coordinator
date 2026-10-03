import { test, expect } from '@playwright/test';
import { createInitialState } from '../src/seed.js';
import { openWeeklyCustomization } from './ui-helpers.js';

const localOrigin = 'http://127.0.0.1:4174';
const baseUrl = 'https://canvas.example.edu';
const user = { id: 'academic-coordinator', name: 'Coordinación académica', email: 'coordinacion@example.edu' };
const courseId = id => `canvas:${baseUrl}:${user.id}:${id}`;
const person = (id, email = `${id}@example.edu`) => ({ id, name: id, email });
const localHour = date => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));

function academicSubjects(range, { completeWeek = false, examWeek = false } = {}) {
  const definitions = [
    { id: 'finance', name: 'Finanzas II', semester: 'S5', students: [person('ana'), person('alicia')], hour: 16 },
    { id: 'metrics', name: 'Econometría', semester: 'S5', students: [person('ana-other-id', 'ana@example.edu'), person('bruno')], hour: 18, tutorial: true },
    { id: 'micro', name: 'Microeconomía', semester: 'S3', students: [person('segundo')], hour: 10 },
    { id: 'trade', name: 'Economía Internacional', semester: 'S7', students: [person('cuarto')], hour: 12 },
  ];
  return definitions.map(subject => {
    const id = courseId(subject.id);
    const dayAfter = days => {
      const value = new Date(`${range.startDate}T12:00:00.000Z`);
      value.setUTCDate(value.getUTCDate() + days);
      return value.toISOString().slice(0, 10);
    };
    const startAt = `${completeWeek && subject.id === 'metrics' ? dayAfter(2) : range.startDate}T${subject.hour}:00:00.000Z`;
    const endAt = new Date(Date.parse(startAt) + 90 * 60000).toISOString();
    const result = {
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
    if (completeWeek && subject.id === 'finance') {
      result.modules.push(
        { id: 'finance-prep-saturday', name: 'Sesión 6 | Riesgo y rentabilidad', position: 3, items: [] },
        { id: 'finance-live-saturday', name: 'Clase sincrónica 3', position: 4, items: [] },
      );
      result.calendarEvents.push({ id: 'finance-saturday', courseId: id, title: 'Clase sincrónica 3', type: 'event',
        startAt: `${dayAfter(5)}T10:00:00.000Z`, endAt: `${dayAfter(5)}T11:30:00.000Z`, description: '' });
      result.assignments.push({ id: 'finance-deadline', title: 'Caso práctico de valoración', dueAt: `${dayAfter(6)}T20:00:00.000Z`,
        description: '<p>Entregar el caso de valoración con los cálculos justificados.</p>', url: `${baseUrl}/courses/finance/assignments/deadline` });
    }
    if (examWeek && subject.id === 'finance') {
      result.modules = [
        { id: 'finance-session-14', name: 'Sesión 14 | Repaso y aplicaciones', position: 1, items: [
          { id: 'finance-video-14', title: '14.2 Vídeo: Valoración final', type: 'Page', position: 1,
            url: 'https://vimeo.com/123456789' },
        ] },
        { id: 'finance-exam', name: 'Examen final', position: 2, items: [] },
        { id: 'finance-session-15', name: 'Sesión 15 | Contenido posterior al examen', position: 3, items: [
          { id: 'finance-video-15', title: '15.1 Vídeo: Ampliación posterior', type: 'Page', position: 1 },
        ] },
      ];
      result.calendarEvents[0] = { ...result.calendarEvents[0], title: 'Examen final',
        description: '<p>Convocatoria ordinaria.</p><p><a href="https://canvas.example.edu/courses/finance">Abrir en Canvas</a></p><p>https://vimeo.com/123456789</p>',
        url: `${baseUrl}/courses/finance/calendar` };
    }
    if (examWeek && subject.id === 'metrics') {
      result.calendarEvents[0].description = '';
      result.calendarEvents[0].url = `${baseUrl}/courses/metrics/calendar`;
    }
    return result;
  });
}

async function connectAcademicCanvas(page, options = {}) {
  const model = { connected: false, ranges: [], subjects: [], ...options };
  await page.route('**/api/canvas/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    let payload;
    const status = () => ({ supported: true, connected: model.connected, baseUrl, user: model.connected ? user : null,
      mode: model.connected ? 'session' : null, credentialStorage: model.connected ? 'encrypted' : null });
    if (endpoint === 'status') payload = status();
    else if (endpoint === 'connect') { model.connected = true; payload = status(); }
    else if (endpoint === 'sync') {
      const range = route.request().postDataJSON();
      model.ranges.push(range); model.subjects = academicSubjects(range, model);
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

test('choosing only an academic course and week creates the complete Monday-to-Sunday draft without activity assembly', async ({ page, context, request }) => {
  const external = [];
  page.on('request', request => { if (new URL(request.url()).origin !== localOrigin) external.push(request.url()); });
  const model = await connectAcademicCanvas(page, { completeWeek: true });
  await expect(page.locator('#weekly-customization')).toHaveJSProperty('open', false);
  await expect(page.locator('#week-select')).toBeVisible();
  await page.locator('#week-select').fill('2026-W41');
  await expect.poll(() => model.ranges.at(-1)).toEqual({ startDate: '2026-10-05', endDate: '2026-10-11' });
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#email-subject')).toHaveText('Semana del 5 al 11 | 3º de Grado en Economía');
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(4);
  await expect(page.locator('#weekly-customization')).toHaveJSProperty('open', false);
  await expect(page.locator('#weekly-customization input:visible, #weekly-customization textarea:visible')).toHaveCount(0);
  const body = await page.locator('#email-body').textContent();
  expect(body).toContain('Finanzas II');
  expect(body).toContain('Econometría');
  expect(body).toContain('Clase sincrónica 2');
  expect(body).toContain('Clase sincrónica 3');
  expect(body).toContain('Tutoría de Econometría');
  expect(body).toContain('Sesión 4 | Preparación');
  expect(body).toContain('Sesión 6 | Riesgo y rentabilidad');
  expect(body).toContain('Traed resueltos los ejercicios de estimación.');
  expect(body).toContain('Caso práctico de valoración');
  expect(body).toContain('Entregar el caso de valoración con los cálculos justificados.');
  expect(body).toContain('Docente de prueba');
  expect(body).toContain('18:00–19:30');
  expect(body).toContain('20:00–21:30');
  expect(body).toContain('12:00–13:30');
  expect(body).toContain('22:00');
  const lower = body.toLocaleLowerCase('es');
  const weekdays = ['lunes', 'miércoles', 'sábado', 'domingo'].map(day => lower.indexOf(day));
  expect(weekdays.every(index => index >= 0)).toBeTruthy();
  expect(weekdays).toEqual([...weekdays].sort((a, b) => a - b));
  expect(body).not.toContain('Microeconomía');
  expect(body).not.toContain('Economía Internacional');
  expect(body).not.toContain('{{');
  expect(external).toEqual([]);
  await expect(page.locator('#recipient-count')).toHaveText('3 de 3 estudiantes');
  await expect.poll(async () => {
    const state = await (await request.get('/api/state')).json();
    return state.composer.weeklyEntries.filter(entry => entry.generated === true).length;
  }).toBe(4);
  await page.screenshot({ path: test.info().outputPath('direct-weekly-light.png'), fullPage: true });
  await page.locator('[data-action="toggle-theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: test.info().outputPath('direct-weekly-dark.png'), fullPage: true });
  await page.locator('[data-action="toggle-theme"]').click();

  const gmail = page.locator('[data-action="gmail"]');
  await expect(gmail).toBeEnabled();
  const handoffPromise = context.waitForEvent('request', { predicate: request => request.url().startsWith('https://mail.google.com/') });
  const popupPromise = page.waitForEvent('popup');
  await gmail.click();
  const [handoff, popup] = await Promise.all([handoffPromise, popupPromise]);
  const url = new URL(handoff.url());
  expect(url.searchParams.get('to')).toBe(user.email);
  expect(url.searchParams.get('bcc').split(',').sort()).toEqual(['alicia@example.edu', 'ana@example.edu', 'bruno@example.edu']);
  expect(url.searchParams.has('cc')).toBeFalsy();
  expect(url.searchParams.get('body')).toBe(body);
  await popup.close();

  await page.locator('[data-action="shift-week"][data-direction="1"]').click();
  await expect.poll(() => model.ranges.at(-1)).toEqual({ startDate: '2026-10-12', endDate: '2026-10-18' });
  await expect(page.locator('#week-select')).toHaveValue('2026-W42');
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#email-subject')).toHaveText('Semana del 12 al 18 | 3º de Grado en Economía');
  await expect(page.locator('#weekly-customization')).toHaveJSProperty('open', false);
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(4);
  await page.locator('[data-action="shift-week"][data-direction="-1"]').click();
  await expect.poll(() => model.ranges.at(-1)).toEqual({ startDate: '2026-10-05', endDate: '2026-10-11' });
  await expect(page.locator('#week-select')).toHaveValue('2026-W41');
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#recipient-count')).toHaveText('3 de 3 estudiantes');
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

test('exam preparation stops at the preceding async session and activities without preparation omit it from the complete draft', async ({ page, context }) => {
  const model = await connectAcademicCanvas(page, { examWeek: true });
  await page.locator('#week-select').fill('2026-W41');
  await expect.poll(() => model.ranges.at(-1)).toEqual({ startDate: '2026-10-05', endDate: '2026-10-11' });
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#weekly-customization')).toHaveJSProperty('open', false);
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(2);
  const body = await page.locator('#email-body').textContent();
  expect(body).toContain('Examen final');
  expect(body).toContain('Trabajar hasta Sesión 14 | Repaso y aplicaciones.');
  expect(body).not.toContain('Sesión 15');
  expect(body).not.toContain('Ampliación posterior');
  expect(body).toContain('Tutoría de Econometría');
  expect(body).toContain('18:00–19:30');
  expect(body).toContain('20:00–21:30');
  expect(body).not.toMatch(/https?:\/\/|www\.|\{\{|No hay sesiones|Sin trabajo adicional/i);
  expect(body).not.toContain('Abrir en Canvas');
  const tutorialParagraph = body.split('\n\n').find(paragraph => paragraph.includes('Tutoría de Econometría'));
  expect(tutorialParagraph).toBeTruthy();
  expect(tutorialParagraph).not.toMatch(/preparaci[oó]n|trabajar|repasar|sin trabajo|no hay/i);
  await expect(page.locator('[data-action="gmail"]')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('exam-week-clean-draft.png'), fullPage: true });

  const handoffPromise = context.waitForEvent('request', { predicate: request => request.url().startsWith('https://mail.google.com/') });
  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-action="gmail"]').click();
  const [handoff, popup] = await Promise.all([handoffPromise, popupPromise]);
  const url = new URL(handoff.url());
  expect(url.searchParams.get('body')).toBe(body);
  expect(url.searchParams.get('to')).toBe(user.email);
  expect(url.searchParams.get('bcc').split(',').sort()).toEqual(['alicia@example.edu', 'ana@example.edu', 'bruno@example.edu']);
  expect(url.searchParams.has('cc')).toBeFalsy();
  await popup.close();
});

test('selecting a new week replaces old activity edits and the previous email override with its fresh calendar draft', async ({ page, request }) => {
  const model = await connectAcademicCanvas(page, { completeWeek: true });
  await page.locator('#week-select').fill('2026-W41');
  await expect.poll(() => model.ranges.at(-1)?.startDate).toBe('2026-10-05');
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await openWeeklyCustomization(page);
  await page.locator('.weekly-entry').first().locator('[data-weekly-field="notes"]').fill('Aviso exclusivo de la semana anterior.');
  await page.locator('[data-action="edit-mail"]').click();
  await page.locator('#mail-body').fill('Texto personalizado que solo pertenece a la semana anterior.');
  await page.locator('[data-action="apply-mail"]').click();
  await expect(page.locator('#email-body')).toContainText('Texto personalizado que solo pertenece a la semana anterior.');

  await page.locator('#week-select').fill('2026-W42');
  await expect.poll(() => model.ranges.at(-1)).toEqual({ startDate: '2026-10-12', endDate: '2026-10-18' });
  await expect(page.locator('[data-action="canvas-sync"]')).toBeEnabled();
  await expect(page.locator('#email-subject')).toHaveText('Semana del 12 al 18 | 3º de Grado en Economía');
  await expect(page.locator('#email-body')).toContainText('Finanzas II');
  await expect(page.locator('#email-body')).toContainText('Clase sincrónica 3');
  await expect(page.locator('#email-body')).not.toContainText('semana anterior');
  await expect(page.locator('#weekly-entries .weekly-entry')).toHaveCount(4);
  await expect.poll(async () => {
    const state = await (await request.get('/api/state')).json();
    return { customBody: state.composer.customBody, generated: state.composer.weeklyEntries.every(entry => entry.generated) };
  }).toEqual({ customBody: null, generated: true });
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
