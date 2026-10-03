import { test, expect } from '@playwright/test';
import { createInitialState, createDemoCourses } from '../src/seed.js';
import { openWeeklyCustomization } from './ui-helpers.js';

const localOrigin = 'http://127.0.0.1:4174';
const field = (page, key) => page.locator(`[data-field="${key}"]`);
const nav = (page, view) => page.locator(`.sidebar [data-action="nav"][data-view="${view}"]`);
const entries = page => page.locator('.weekly-entry');
const entryField = (entry, key) => entry.locator(`[data-weekly-field="${key}"]`);
const entrySelect = (entry, key) => entry.locator(`[data-weekly-select="${key}"]`);
const gmailButton = page => page.locator('[data-action="gmail"]');

async function readState(request) {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openWeek(page) {
  await page.goto('/');
  await page.locator('[data-action="compose-mode"][data-mode="weekly"]').click();
  await openWeeklyCustomization(page);
  await expect(entries(page)).toHaveCount(1);
  await field(page, 'course_name').fill('3º de Grado en Economía');
  await field(page, 'week_start_day').fill('5');
  await field(page, 'week_end_day').fill('9');
}

async function addEntry(page) {
  const count = await entries(page).count();
  await page.locator('[data-action="add-weekly-entry"]').click();
  await expect(entries(page)).toHaveCount(count + 1);
  return entries(page).nth(count);
}

async function manualEntry(entry, { subject, event, preparation, teacher = '', notes = '' }) {
  await entryField(entry, 'subject').fill(subject);
  await entryField(entry, 'event').fill(event);
  await entryField(entry, 'teacher').fill(teacher);
  await entryField(entry, 'preparation').fill(preparation);
  await entryField(entry, 'notes').fill(notes);
}

async function selectTwoStudents(page) {
  await page.getByRole('button', { name: 'Elegir', exact: true }).click();
  await page.getByRole('button', { name: 'Ninguno', exact: true }).click();
  await page.getByRole('checkbox', { name: /Alba Navarro/ }).check();
  await page.getByRole('checkbox', { name: /Clara Martín/ }).check();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.locator('#recipient-count')).toHaveText('2 de 8 estudiantes');
}

test.beforeEach(async ({ context, request }) => {
  // Fixtures contain only invented contacts. No test can reach Gmail or any
  // other external origin, including through a newly opened compose window.
  await context.route('**/*', route => new URL(route.request().url()).origin === localOrigin
    ? route.continue() : route.abort('blockedbyclient'));
  const state = createInitialState();
  state.courses = createDemoCourses();
  state.settings = {
    name: 'Coordinación de ejemplo',
    email: 'coordinator@example.com',
    signature: 'Equipo académico de ejemplo',
  };
  const response = await request.post('/api/state', { headers: { Origin: localOrigin }, data: state });
  expect(response.ok()).toBeTruthy();
});

test('weekly summary supports repeated subjects, explicit preparation, and private group recipients', async ({ page, context }) => {
  await openWeek(page);
  await manualEntry(entries(page).nth(0), {
    subject: 'Economía Aplicada', event: 'Tutoría 1', teacher: 'Docente de ejemplo',
    preparation: 'Trabajar las sesiones 1 a 3 y entregar el trabajo individual 3.6.',
  });
  const repeat = await addEntry(page);
  await entryField(repeat, 'subject').fill('Economía Aplicada');
  await entryField(repeat, 'event').fill('Tutoría 2');
  await entrySelect(repeat, 'preparationMode').selectOption('none');
  await entryField(repeat, 'notes').fill('La entrega del ejercicio termina el viernes 9 a las 20:00.');
  const exam = await addEntry(page);
  await manualEntry(exam, {
    subject: 'Métodos Cuantitativos', event: 'Examen de repaso',
    preparation: 'Repasar el temario de las sesiones 1 a 14.',
    notes: 'La fecha y las condiciones del examen se confirmarán en Canvas.',
  });
  const live = await addEntry(page);
  await entrySelect(live, 'course').selectOption('demo-economics');
  await expect(page.locator('#course-select')).toHaveValue('demo-philosophy');
  await expect(page.locator('#recipient-count')).toHaveText('8 de 8 estudiantes');
  await entrySelect(live, 'session').selectOption('eco-live-2');
  await expect(entryField(live, 'preparation')).toHaveValue(/Sesión 4.*4\.3 Vídeo: Empleo y ciclo económico/);
  await expect(entrySelect(live, 'preparationMode')).toHaveValue('canvas');
  await entryField(live, 'event').fill('Clase de repaso');
  // Choosing no preparation omits this part from the activity in the email.
  await entrySelect(live, 'preparationMode').selectOption('none');
  await field(page, 'general_notices').fill('Revisad las fechas de entrega en Canvas.');
  await selectTwoStudents(page);

  const subject = await page.locator('#email-subject').textContent();
  const body = await page.locator('#email-body').textContent();
  expect(subject).toBe('Semana del 5 al 9 | 3º de Grado en Economía');
  expect(body.match(/• Economía Aplicada/g)).toHaveLength(2);
  expect(body).toContain('Tutoría 1, con Docente de ejemplo');
  expect(body).toContain('sesiones 1 a 3');
  expect(body).toContain('trabajo individual 3.6');
  expect(body).toContain('sesiones 1 a 14');
  expect(body).toContain('viernes 9 a las 20:00');
  expect(body).not.toContain('No hay sesiones adicionales que trabajar antes de esta clase.');
  expect(body).not.toContain('Empleo y ciclo económico');
  expect(body).not.toContain('{{');
  await expect(gmailButton(page)).toBeEnabled();

  await page.setViewportSize({ width: 1440, height: 940 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/weekly-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/weekly-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 940 });

  const requestPromise = context.waitForEvent('request', { predicate: request => request.url().startsWith('https://mail.google.com/') });
  const popupPromise = page.waitForEvent('popup');
  await gmailButton(page).click();
  const [handoff, popup] = await Promise.all([requestPromise, popupPromise]);
  const url = new URL(handoff.url());
  expect(url.searchParams.get('to')).toBe('coordinator@example.com');
  expect(url.searchParams.get('bcc').split(',').sort()).toEqual(['fil.estudiante1@example.com', 'fil.estudiante3@example.com']);
  expect(url.searchParams.has('cc')).toBeFalsy();
  expect(url.searchParams.get('su')).toBe(subject);
  expect(url.searchParams.get('body')).toBe(body);
  await popup.close();
});

test('weekly validation blocks unnamed activities while empty preparation and notices are omitted', async ({ page }) => {
  await openWeek(page);
  await expect(gmailButton(page)).toBeDisabled();
  const first = entries(page).first();
  await entryField(first, 'subject').fill('Economía Aplicada');
  await entryField(first, 'event').fill('Tutoría');
  await expect(gmailButton(page)).toBeEnabled();
  await expect(page.locator('#email-body')).not.toContainText('{{preparacion');
  await expect(page.locator('#email-body')).not.toContainText('No hay sesiones adicionales');
  await entrySelect(first, 'preparationMode').selectOption('none');
  await expect(gmailButton(page)).toBeEnabled();
  await expect(field(page, 'general_notices')).toHaveValue('');
  await expect(page.locator('#email-body')).not.toContainText('{{');

  await field(page, 'week_start_day').fill('lunes 5');
  await field(page, 'week_end_day').fill('viernes 9');
  await field(page, 'month').fill('');
  await field(page, 'year').fill('2027');
  await expect(page.locator('#email-subject')).toContainText('Semana del lunes 5 al viernes 9');
  await expect(gmailButton(page)).toBeEnabled();
  await first.locator('[data-action="remove-weekly-entry"]').click();
  await expect(entries(page)).toHaveCount(0);
  await expect(gmailButton(page)).toBeDisabled();
  await expect(page.locator('#preview-validation')).toContainText('Añade al menos una');
});

test('saved weekly draft restores activity order, wording, teacher, and recipients after changes and reload', async ({ page, request }) => {
  await openWeek(page);
  await manualEntry(entries(page).first(), {
    subject: 'Economía Aplicada', event: 'Tutoría', teacher: 'Docente de ejemplo',
    preparation: 'Trabajar las sesiones 1 a 3.', notes: 'Entregar la actividad antes del viernes.',
  });
  const exam = await addEntry(page);
  await manualEntry(exam, {
    subject: 'Métodos Cuantitativos', event: 'Examen de repaso', preparation: 'Revisar las sesiones 1 a 14.',
  });
  await exam.locator('[data-action="move-weekly-entry"][data-direction="-1"]').click();
  await expect(entryField(entries(page).first(), 'subject')).toHaveValue('Métodos Cuantitativos');
  await selectTwoStudents(page);
  const originalBody = await page.locator('#email-body').textContent();
  await page.locator('[data-action="save-draft"]').click();
  await expect(page.locator('#toast')).toContainText('Borrador guardado');
  await expect.poll(async () => (await readState(request)).drafts.length).toBe(1);
  const savedComposer = (await readState(request)).drafts[0].composer;
  expect(savedComposer.kind).toBe('weekly');
  expect(savedComposer.weeklyEntries.map(entry => entry.subject)).toEqual(['Métodos Cuantitativos', 'Economía Aplicada']);

  await entryField(entries(page).nth(1), 'teacher').fill('Otro docente');
  await entries(page).first().locator('[data-action="remove-weekly-entry"]').click();
  await field(page, 'week_start_day').fill('12');
  await expect.poll(async () => (await readState(request)).composer.fields.week_start_day).toBe('12');
  await page.reload();
  await expect(entries(page)).toHaveCount(1);
  await nav(page, 'drafts').click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(entries(page)).toHaveCount(2);
  await expect(field(page, 'week_start_day')).toHaveValue('5');
  await expect(entryField(entries(page).first(), 'subject')).toHaveValue('Métodos Cuantitativos');
  await expect(entryField(entries(page).nth(1), 'teacher')).toHaveValue('Docente de ejemplo');
  await expect(entryField(entries(page).nth(1), 'notes')).toHaveValue('Entregar la actividad antes del viernes.');
  await expect(page.locator('#recipient-count')).toHaveText('2 de 8 estudiantes');
  await expect(page.locator('#email-body')).toHaveText(originalBody);
  await expect(gmailButton(page)).toBeEnabled();
});

test('editing and using a weekly template retains the weekly composer and its agenda', async ({ page, request }) => {
  await openWeek(page);
  await manualEntry(entries(page).first(), {
    subject: 'Economía Aplicada', event: 'Tutoría', preparation: 'Repasar las sesiones 1 a 3.',
  });
  await nav(page, 'templates').click();
  await page.locator('[data-action="edit-template"][data-id="template-weekly-summary"]').click();
  const dialog = page.getByRole('dialog', { name: 'Editar plantilla' });
  await dialog.locator('#tpl-subject').fill('Plan semanal | {{course_name}}');
  await dialog.locator('#tpl-body').fill('{{greeting}}\n\n{{weekly_agenda}}\n\n{{general_notices}}\n\n{{closing}}');
  await dialog.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await expect.poll(async () => (await readState(request)).templates.find(t => t.id === 'template-weekly-summary')?.subject).toBe('Plan semanal | {{course_name}}');
  expect((await readState(request)).templates.find(t => t.id === 'template-weekly-summary').kind).toBe('weekly');
  await page.locator('[data-action="use-template"][data-id="template-weekly-summary"]').click();
  await expect(page.locator('[data-action="compose-mode"][data-mode="weekly"]')).toHaveClass(/selected/);
  await expect(entries(page)).toHaveCount(1);
  await expect(entryField(entries(page).first(), 'subject')).toHaveValue('Economía Aplicada');
  await expect(page.locator('#email-subject')).toHaveText('Plan semanal | 3º de Grado en Economía');
  await expect(page.locator('#email-body')).toContainText('Repasar las sesiones 1 a 3.');
  await expect(gmailButton(page)).toBeEnabled();
  await page.reload();
  await expect(entries(page)).toHaveCount(1);
  await expect(page.locator('#email-subject')).toHaveText('Plan semanal | 3º de Grado en Economía');
});
