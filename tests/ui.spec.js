import { test, expect } from '@playwright/test';
import { createInitialState, createDemoCourses } from '../src/seed.js';

const localOrigin = 'http://127.0.0.1:4174';
const nav = (page, view) => page.locator(`.sidebar button[data-action="nav"][data-view="${view}"]`);
const field = (page, key) => page.locator(`[data-field="${key}"]`);

async function loadDemo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Explorar con cursos de ejemplo/ }).click();
  await expect(page.locator('#course-select')).toHaveValue('demo-philosophy');
}

async function setProfile(page) {
  await nav(page, 'settings').click();
  await page.getByRole('textbox', { name: 'Nombre del coordinador', exact: true }).fill('Alex Coordinación');
  await page.getByRole('textbox', { name: 'Tu dirección de correo', exact: true }).fill('coordinacion@example.com');
  await page.getByRole('textbox', { name: 'Firma de tus correos', exact: true }).fill('Equipo académico\nUniversidad de ejemplo');
  await expect(page.locator('#save-status')).toContainText('Guardado en este equipo');
  await nav(page, 'compose').click();
}

async function readState(request) {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function importCourseJson(page, course) {
  await nav(page, 'courses').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar JSON', exact: true }).click();
  await (await chooser).setFiles({
    name: 'curso.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(course)),
  });
  await expect(page.locator('#toast')).toHaveText('1 asignatura importada.');
  await nav(page, 'compose').click();
}

test.beforeEach(async ({ context, request }) => {
  // Block every external navigation at the browser boundary, including Gmail.
  // No test can send mail or open a system browser.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === localOrigin ? route.continue() : route.abort('blockedbyclient');
  });
  const response = await request.post('/api/state', {
    headers: { Origin: localOrigin },
    data: createInitialState(),
  });
  expect(response.ok()).toBeTruthy();
});

test('starts empty and adds clearly identified local examples only when requested', async ({ page, request }) => {
  const external = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== localOrigin) external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /De Canvas a un correo/ })).toBeVisible();
  expect((await readState(request)).courses).toEqual([]);

  await page.getByRole('button', { name: /Explorar con cursos de ejemplo/ }).click();
  await expect(page.locator('#course-select option')).toHaveCount(3);
  await expect(page.locator('#course-select option')).toContainText(['Ejemplo', 'Ejemplo', 'Ejemplo']);
  await expect(page.locator('#recipient-count')).toHaveText('8 de 8 estudiantes');
  await expect(page.getByRole('button', { name: 'Abrir borrador en Gmail' })).toBeDisabled();
  await expect(page.locator('#preview-validation')).toContainText('Añade tu dirección de correo');
  await expect.poll(async () => (await readState(request)).courses.length).toBe(3);
  expect(external).toEqual([]);
});

test('date parts are independent and choosing the next class updates the Canvas cutoff', async ({ page }) => {
  await loadDemo(page);
  await expect(field(page, 'preparation')).toHaveValue(/Sesión 2.*2\.3 Vídeo: Análisis de un caso/);
  await field(page, 'day').fill('martes 20');
  await field(page, 'month').fill('noviembre');
  await field(page, 'year').fill('2027');
  await expect(field(page, 'day')).toHaveValue('martes 20');
  await expect(field(page, 'month')).toHaveValue('noviembre');
  await expect(field(page, 'year')).toHaveValue('2027');
  await expect(page.locator('#email-subject')).toContainText('martes 20 de noviembre de 2027');

  await page.getByRole('combobox', { name: 'Clase síncrona', exact: true }).selectOption('fil-live-2');
  await expect(field(page, 'day')).toHaveValue('27');
  await expect(field(page, 'month')).toHaveValue('10');
  await expect(field(page, 'year')).toHaveValue('2026');
  await expect(field(page, 'preparation')).toHaveValue(/Sesión 4.*4\.3 Vídeo: Cómo argumentar un dilema/);
  await page.getByRole('button', { name: 'Ver estructura de la asignatura', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'La estructura de tu asignatura' });
  await expect(dialog.locator('.module-item')).toHaveCount(6);
  await expect(dialog.locator('.module-item.live')).toHaveCount(2);
  await expect(dialog).toContainText('Sesión 4 | Dilemas contemporáneos');
});

test('template editor inserts variables into the focused field and persists the result', async ({ page, request }) => {
  await loadDemo(page);
  await nav(page, 'templates').click();
  const card = page.locator('.template-card').filter({ has: page.getByRole('heading', { name: 'Recordatorio de clase', exact: true }) });
  await card.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar plantilla' });
  await dialog.getByRole('textbox', { name: 'Mensaje', exact: true }).fill('Preparación: ');
  await dialog.getByRole('textbox', { name: 'Mensaje', exact: true }).press('End');
  await dialog.getByRole('button', { name: 'Preparación previa', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveValue('Preparación: {{preparation}}');
  await dialog.getByRole('textbox', { name: 'Asunto', exact: true }).fill('Aviso · ');
  await dialog.getByRole('textbox', { name: 'Asunto', exact: true }).press('End');
  await dialog.getByRole('button', { name: 'Día', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Asunto', exact: true })).toHaveValue('Aviso · {{day}}');
  await dialog.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await card.getByRole('button', { name: 'Usar plantilla', exact: true }).click();
  await expect(page.locator('#email-subject')).toHaveText('Aviso · 13');
  await expect(page.locator('#email-body')).toContainText('Preparación: Sesión 2');
  await expect.poll(async () => (await readState(request)).templates[0].subject).toBe('Aviso · {{day}}');
  await page.reload();
  await expect(page.locator('#email-subject')).toHaveText('Aviso · 13');
});

test('saved draft restores its own fields and recipients after the current composer changes and reloads', async ({ page, request }) => {
  await loadDemo(page);
  await setProfile(page);
  await field(page, 'time').fill('18:30');
  await field(page, 'month').fill('octubre');
  await page.getByRole('button', { name: 'Elegir', exact: true }).click();
  await page.getByRole('checkbox', { name: /Clara Martín/ }).uncheck();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.locator('#recipient-count')).toHaveText('7 de 8 estudiantes');
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Borrador guardado');
  await field(page, 'day').fill('31');
  await expect.poll(async () => (await readState(request)).composer.fields.day).toBe('31');
  await page.reload();
  await expect(field(page, 'day')).toHaveValue('31');
  await nav(page, 'drafts').click();
  await expect(page.locator('.draft-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(field(page, 'day')).toHaveValue('13');
  await expect(field(page, 'month')).toHaveValue('octubre');
  await expect(field(page, 'time')).toHaveValue('18:30');
  await expect(page.locator('#recipient-count')).toHaveText('7 de 8 estudiantes');
  await expect(page.locator('#email-body')).toContainText('Alex Coordinación');
  await expect(page.locator('#email-body')).toContainText('Equipo académico\nUniversidad de ejemplo');
  await expect(page.getByRole('button', { name: 'Abrir borrador en Gmail' })).toBeEnabled();
});

test('CSV import adds valid students, keeps existing students, reports invalid rows, and leaves additions unselected', async ({ page, request }) => {
  await loadDemo(page);
  await nav(page, 'courses').click();
  await page.locator('[data-action="manage-course"][data-id="demo-philosophy"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar CSV', exact: true }).click();
  await (await chooser).setFiles({
    name: 'estudiantes.csv', mimeType: 'text/csv',
    buffer: Buffer.from('nombre,email\nNueva Estudiante,nueva@example.com\nDuplicado,fil.estudiante1@example.com\nSin correo,no-es-correo\n'),
  });
  const dialog = page.getByRole('dialog', { name: 'Gestionar curso' });
  await expect(dialog.locator('.roster-row')).toHaveCount(9);
  await expect(dialog.locator('.roster-list')).toContainText('Alba Navarro');
  await expect(dialog.locator('.roster-list')).toContainText('nueva@example.com');
  await expect(dialog.locator('.roster-list')).not.toContainText('no-es-correo');
  await expect(dialog.locator('.notice')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('1 estudiantes añadidos');
  await page.getByRole('button', { name: 'Guardar curso', exact: true }).click();
  await nav(page, 'compose').click();
  await expect(page.locator('#recipient-count')).toHaveText('8 de 9 estudiantes');
  await expect.poll(async () => (await readState(request)).courses[0]?.students.length || 0).toBe(9);
  await page.reload();
  await expect(page.locator('#recipient-count')).toHaveText('8 de 9 estudiantes');
});

test('Gmail handoff includes only the selected BCC recipients and the rendered subject and body', async ({ page, context }) => {
  await loadDemo(page);
  await setProfile(page);
  await field(page, 'time').fill('18:30');
  await field(page, 'month').fill('octubre');
  await page.getByRole('button', { name: 'Elegir', exact: true }).click();
  await page.getByRole('button', { name: 'Ninguno', exact: true }).click();
  await expect(page.locator('#selection-label')).toHaveText('0 seleccionados');
  await page.getByRole('checkbox', { name: /Alba Navarro/ }).check();
  await page.getByRole('checkbox', { name: /Clara Martín/ }).check();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.locator('#recipient-count')).toHaveText('2 de 8 estudiantes');
  const subject = await page.locator('#email-subject').textContent();
  const body = await page.locator('#email-body').textContent();
  const gmail = page.getByRole('button', { name: 'Abrir borrador en Gmail', exact: true });
  await expect(gmail).toBeEnabled();

  const requestPromise = context.waitForEvent('request', { predicate: request => request.url().startsWith('https://mail.google.com/') });
  const popupPromise = page.waitForEvent('popup');
  await gmail.click();
  const [handoff, popup] = await Promise.all([requestPromise, popupPromise]);
  const url = new URL(handoff.url());
  expect(url.origin).toBe('https://mail.google.com');
  expect(url.searchParams.get('to')).toBe('coordinacion@example.com');
  expect(url.searchParams.get('bcc').split(',').sort()).toEqual(['fil.estudiante1@example.com', 'fil.estudiante3@example.com']);
  expect(url.searchParams.has('cc')).toBeFalsy();
  expect(url.searchParams.get('su')).toBe(subject);
  expect(url.searchParams.get('body')).toBe(body);
  expect(url.searchParams.get('body')).not.toContain('{{');
  await popup.close();
});

test('a saved draft retains its wording when the original template is edited later', async ({ page, request }) => {
  await loadDemo(page);
  await setProfile(page);
  await field(page, 'time').fill('18:30');
  const originalSubject = await page.locator('#email-subject').textContent();
  const originalBody = await page.locator('#email-body').textContent();
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Borrador guardado');

  await nav(page, 'templates').click();
  await page.locator('[data-action="edit-template"][data-id="template-reminder"]').click();
  const editor = page.getByRole('dialog', { name: 'Editar plantilla' });
  await editor.getByRole('textbox', { name: 'Asunto', exact: true }).fill('Nueva versión de {{subject}}');
  await editor.getByRole('textbox', { name: 'Mensaje', exact: true }).fill('Este texto pertenece a la plantilla actualizada.');
  await editor.getByRole('button', { name: 'Guardar plantilla', exact: true }).click();
  await expect.poll(async () => (await readState(request)).templates[0].subject).toBe('Nueva versión de {{subject}}');
  await page.reload();
  await expect(page.locator('#email-subject')).toHaveText('Nueva versión de Ética');
  await nav(page, 'drafts').click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('#email-subject')).toHaveText(originalSubject);
  await expect(page.locator('#email-body')).toHaveText(originalBody);
});

test('JSON refresh preserves modules, updates untouched preparation, and retains a manual preparation override', async ({ page, request }) => {
  await loadDemo(page);
  const originalPreparation = await field(page, 'preparation').inputValue();
  await importCourseJson(page, {
    id: 'demo-philosophy', name: 'Filosofía · Grupo actualizado', code: 'FIL-201', subject: 'Ética',
  });
  await expect(page.locator('#session-select option')).toHaveCount(3);
  await expect(field(page, 'course_name')).toHaveValue('Filosofía · Grupo actualizado');
  await expect(field(page, 'preparation')).toHaveValue(originalPreparation);
  await expect(page.locator('#recipient-count')).toHaveText('8 de 8 estudiantes');
  await expect.poll(async () => (await readState(request)).courses[0]?.modules.length || 0).toBe(6);

  const refreshed = createDemoCourses()[0];
  refreshed.name = 'Filosofía · Grupo actualizado';
  refreshed.modules[1].items.push({
    id: 'fil-new-lesson', title: '2.4 Vídeo: Debate de responsabilidades', type: 'Page', position: 4,
  });
  await importCourseJson(page, refreshed);
  await expect(field(page, 'preparation')).toHaveValue(/2\.4 Vídeo: Debate de responsabilidades$/);
  await expect(page.locator('.notice')).toContainText('Estructura de Canvas actualizada');

  const manual = 'Revisar solamente los apartados 2.1 y 2.2 y traer una pregunta.';
  await field(page, 'preparation').fill(manual);
  refreshed.modules[1].items.push({
    id: 'fil-second-new-lesson', title: '2.5 Vídeo: Ejercicio de revisión', type: 'Page', position: 5,
  });
  await importCourseJson(page, refreshed);
  await expect(field(page, 'preparation')).toHaveValue(manual);
  await expect(page.locator('.notice')).toContainText('Se han conservado los detalles que modificaste manualmente');
  await expect(page.locator('.evidence')).toContainText('2.5 Vídeo: Ejercicio de revisión');
  await expect.poll(async () => (await readState(request)).composer?.fields.preparation).toBe(manual);
  await page.reload();
  await expect(field(page, 'preparation')).toHaveValue(manual);
});

test('impossible numeric dates block Gmail while independent free text date parts remain usable', async ({ page }) => {
  await loadDemo(page);
  await setProfile(page);
  await field(page, 'time').fill('18:30');
  const gmail = page.getByRole('button', { name: 'Abrir borrador en Gmail', exact: true });
  await expect(gmail).toBeEnabled();
  await field(page, 'day').fill('31');
  await field(page, 'month').fill('02');
  await expect(gmail).toBeDisabled();
  await expect(page.locator('#preview-validation')).toContainText('La fecha indicada no existe');

  await field(page, 'day').fill('martes 24');
  await field(page, 'month').fill('febrero');
  await expect(field(page, 'year')).toHaveValue('2026');
  await expect(gmail).toBeEnabled();
  await expect(page.locator('#email-subject')).toContainText('martes 24 de febrero de 2026');
});
