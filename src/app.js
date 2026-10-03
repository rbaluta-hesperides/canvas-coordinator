import { normalizeCourses, deriveSessions, parseStudentCsv, resolveTemplate, buildGmailUrl, isValidEmail } from './domain.js';
import { createInitialState, createDemoCourses, weeklyTemplate, upgradeWorkspace, VARIABLES } from './seed.js';
import { createWeeklyEntry, composeWeeklyAgenda, withoutActivityLinks } from './weekly.js';
import { nextCanvasWeek, canvasWeekFromInput, canvasWeekInput, shiftCanvasWeek, planCanvasWeek, dayInZone, validateWeekRange } from './canvas-planner.js';
import { mergeCanvasCourse, reconcileCanvasRecipients, refreshEditedCalendarSchedule } from './canvas-workspace.js';
import { academicCourses, academicCourseStudents, subjectsForAcademicCourse, subjectName } from './academic.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => crypto.randomUUID();
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
  template: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/>',
  draft: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  settings: '<path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42m-11.3 11.3-1.42 1.42"/>',
  moon: '<path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L21 7l-4-4L5 15Z"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  external: '<path d="M14 3h7v7M21 3l-10 10M10 3H4v17h17v-6"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  leaf: '<path d="M20 3C7 2 2 8 5 15c7 5 15-1 15-12ZM4 21 15 9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mail}</svg>`;
const button = (action, label, ico, cls = 'btn', attrs = '') => `<button class="${cls}" data-action="${action}" ${attrs}>${ico ? icon(ico) : ''}${label}</button>`;
const options = (items, selected, label = x => x.name) => items.map(x => `<option value="${esc(x.id)}" ${String(selected) === String(x.id) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');

const request = async (url, body) => {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
};
const api = window.coordinator || {
  load: () => request('/api/state'), save: state => request('/api/state', state),
  info: () => request('/api/info'), importCanvas: () => request('/api/import-canvas', {}),
  canvasStatus: () => request('/api/canvas/status'),
  canvasConnect: data => request('/api/canvas/connect', data),
  canvasSync: data => request('/api/canvas/sync', data),
  canvasDisconnect: () => request('/api/canvas/disconnect', {}),
  openGmail: async mail => {
    const url = buildGmailUrl(mail);
    if (url.length > 16000) throw new Error('El correo es demasiado largo para abrirlo mediante un enlace. Reduce el texto o los destinatarios; también puedes copiar el correo.');
    const tab = window.open(url, '_blank');
    if (!tab) throw new Error('El navegador bloqueó la ventana de Gmail. Permite las ventanas emergentes y vuelve a intentarlo.');
    tab.opener = null;
    return { ok: true };
  },
};

let state, view = 'compose', activeModal = null, fileTask = null, info = {}, saveTimer, saving = Promise.resolve(), saveFailed = false, loadingFailed = false;
let lastFocus = null, recipientSearch = '', courseSearch = '', revision = 0, savedRevision = 0;
let canvasStatus = { connected: false, baseUrl: 'https://hesperides.instructure.com' }, canvasBusy = false, canvasProgress = '', canvasTimer;
let weeklyCustomizationOpen = false, weekRangeOpen = false, weekSourcesOpen = false;
const timeZone = () => state.settings.timeZone || 'Europe/Vienna';
const liveCourse = value => value?.source?.type === 'canvas';
const course = () => state.courses.find(c => c.id === state.composer?.courseId);
const template = () => state.templates.find(t => t.id === state.composer?.templateId) || state.templates[0];
const isWeekly = () => (state.composer?.kind || template()?.kind) === 'weekly';
// Stored `courses` and `courseId` are Canvas subject IDs for compatibility with saved workspaces.
let academicGroupSnapshot = null;
const academicGroups = () => academicGroupSnapshot || academicCourses(state.courses);
const academicCourse = () => academicGroups().find(group => group.id === state.composer?.academicCourseId);
const groupForSubject = (subject, preferred) => { const groups = academicGroups(); return groups.find(group => group.id === preferred && group.subjectIds.includes(subject?.id)) || groups.find(group => group.subjectIds.includes(subject?.id)); };
const groupSubjects = () => { const group = academicCourse(); const assigned = new Set(academicGroups().flatMap(group => group.subjectIds)); return group ? subjectsForAcademicCourse(state.courses, group) : state.courses.filter(subject => !assigned.has(subject.id)); };
const recipientRoster = () => state.composer?.academicSelectionError ? [] : isWeekly() && academicCourse() ? academicCourseStudents(state.courses, academicCourse()) : course()?.students || [];
const selectedStudents = () => recipientRoster().filter(s => state.composer.selectedStudentIds.includes(s.id));
const academicName = (subject = course()) => groupForSubject(subject, state.composer?.academicCourseId)?.name || (!liveCourse(subject) ? subject?.name || '' : '');
const calendarEntries = subject => {
  if (!subject) return [];
  const period = subject.calendarRange || state.canvasLastSync || nextCanvasWeek(new Date(), timeZone());
  try { return planCanvasWeek([subject], { startDate: period.startDate, endDate: period.endDate, timeZone: timeZone() }).entries; }
  catch { return []; }
};
const calendarSelectionError = () => !isWeekly() && state.composer.calendarEventId && !calendarEntries(course()).some(entry => entry.sourceEventId === state.composer.calendarEventId)
  ? 'La actividad seleccionada ya no aparece en el calendario. Elige otra actividad antes de abrir Gmail.' : '';
function ensureAcademicSelection() {
  const comp = state.composer;
  if (comp.draftId && comp.academicCourseId && !academicGroups().some(group => group.id === comp.academicCourseId && group.subjectIds.includes(course()?.id))) {
    comp.academicSelectionError = 'El curso académico de este borrador ya no coincide con los datos de Canvas. Elige el curso correcto antes de abrir Gmail.';
    return;
  }
  comp.academicSelectionError = '';
  const group = groupForSubject(course(), comp.academicCourseId);
  const nextId = group?.id || '';
  if (comp.academicCourseId === nextId) return;
  comp.academicCourseId = nextId;
  if (!comp.draftId && group && (!comp.fields.course_name || comp.fields.course_name === course()?.name || comp.fields.course_name === comp.canvasValues?.course_name)) comp.fields.course_name = group.name;
  if (comp.weeklyPlan && group && !comp.draftId) { comp.weeklyPlan.courseIds = [...group.subjectIds]; comp.weeklyPlan.subjectSelection = 'all'; applyCanvasPlan(); }
  if (comp.recipientMode === 'all') comp.selectedStudentIds = recipientRoster().filter(s => isValidEmail(s.email)).map(s => s.id);
}

function updateThemeControls() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Activar modo claro' : 'Activar modo oscuro';
  document.querySelectorAll('[data-action="toggle-theme"]').forEach(el => {
    el.innerHTML = icon(dark ? 'sun' : 'moon');
    el.setAttribute('aria-label', label); el.title = label;
  });
  document.querySelectorAll('[data-theme-choice]').forEach(el => {
    el.setAttribute('aria-pressed', String(el.dataset.themeChoice === document.documentElement.dataset.themePreference));
  });
}
window.addEventListener('campus-theme-change', updateThemeControls);
function chooseTheme(preference) {
  if (!['light', 'dark', 'system'].includes(preference)) return;
  state.settings.theme = preference;
  window.campusTheme.apply(preference);
  scheduleSave();
}
function appearancePanel() {
  const choices = [
    { value: 'light', name: 'Claro', detail: 'Un espacio luminoso', icon: 'sun' },
    { value: 'dark', name: 'Oscuro', detail: 'Tonos suaves al trabajar', icon: 'moon' },
    { value: 'system', name: 'Sistema', detail: 'Según tu dispositivo', icon: 'monitor' },
  ];
  return `<section class="panel appearance-panel"><div class="section-heading">${icon('sun')}<h2>Apariencia</h2></div><p>Elige cómo quieres ver tu espacio. La preferencia se guarda en este equipo.</p><div class="theme-options" role="group" aria-label="Tema de la aplicación">${choices.map(choice => `<button class="theme-option" data-action="choose-theme" data-theme-choice="${choice.value}" aria-pressed="${(state.settings.theme || 'system') === choice.value}">${icon(choice.icon)}<span><strong>${choice.name}</strong><small>${choice.detail}</small></span></button>`).join('')}</div></section>`;
}

function ensureWeeklyFields() {
  if (!isWeekly()) return;
  const defaults = { week_start_day: '', week_end_day: '', greeting: 'Buenas tardes,', weekly_intro: 'A continuación, las clases y trabajo para la próxima semana:', general_notices: '', closing: 'Os deseo un feliz finde,' };
  for (const [key, value] of Object.entries(defaults)) if (state.composer.fields[key] === undefined) state.composer.fields[key] = value;
  if (!Array.isArray(state.composer.weeklyEntries)) state.composer.weeklyEntries = [createWeeklyEntry()];
  if (liveCourse(course()) && !state.composer.weeklyPlan) {
    state.composer.weeklyPlan = { ...nextCanvasWeek(new Date(), timeZone()), courseIds: academicCourse()?.subjectIds || [course().id], subjectSelection: 'all', suppressed: [] };
    fillWeekDates(); applyCanvasPlan();
  }
  if (academicCourse() && state.composer.weeklyPlan?.subjectSelection === 'all') state.composer.weeklyPlan.courseIds = [...academicCourse().subjectIds];
}
function fillWeekDates() {
  const plan = state.composer.weeklyPlan;
  if (!plan) return;
  const [year, month, day] = plan.startDate.split('-');
  Object.assign(state.composer.fields, { week_start_day: String(Number(day)), week_end_day: String(Number(plan.endDate.slice(-2))), year,
    month: new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(`${year}-${month}-01T12:00:00Z`)) });
}
async function chooseCanvasWeek(week) {
  if (canvasBusy) return;
  const period = canvasWeekFromInput(week);
  const previous = state.composer;
  freshComposer(course(), template(), previous.academicCourseId);
  state.composer.weeklyPlan = { ...period, courseIds: academicCourse()?.subjectIds || [course().id], subjectSelection: 'all', suppressed: [] };
  state.composer.weeklyEntries = [];
  state.composer.recipientMode = previous.recipientMode;
  state.composer.selectedStudentIds = previous.selectedStudentIds.filter(id => recipientRoster().some(student => student.id === id));
  for (const key of ['greeting', 'weekly_intro', 'closing']) if (previous.fields[key] !== undefined) state.composer.fields[key] = previous.fields[key];
  fillWeekDates(); applyCanvasPlan(); scheduleSave(); render();
  if (canvasStatus.connected || canvasStatus.mode) await syncCanvas({ notify: false });
}
function applyCanvasPlan() {
  const config = state.composer.weeklyPlan;
  if (!config || !isWeekly()) return;
  try {
    const allowed = new Set(academicCourse()?.subjectIds || state.courses.filter(c => !groupForSubject(c)).map(c => c.id));
    config.courseIds = config.courseIds.filter(id => allowed.has(id));
    const selected = state.courses.filter(c => config.courseIds.includes(c.id));
    const result = planCanvasWeek(selected, { ...config, timeZone: timeZone() });
    const existing = state.composer.weeklyEntries || [];
    const freshEntries = new Map(result.entries.map(entry => [`${entry.courseId}:${entry.sourceEventId}`, entry]));
    const edited = existing.filter(entry => !entry.generated && (entry.subject || entry.event || entry.preparation || entry.notes)).map(entry => {
      const fresh = freshEntries.get(`${entry.courseId}:${entry.sourceEventId}`);
      if (entry.sourceEventId && !fresh && entry.scheduleSource === 'calendar') {
        result.warnings.push(`«${entry.event}» ya no aparece en el calendario de este periodo. Revisa o elimina el apartado.`);
        return { ...entry, calendarStale: true };
      }
      return refreshEditedCalendarSchedule(entry, fresh);
    });
    const editedKeys = new Set(edited.filter(entry => entry.sourceEventId).map(entry => `${entry.courseId}:${entry.sourceEventId}`));
    const generated = result.entries.filter(entry => !(config.suppressed || []).includes(entry.id) && !editedKeys.has(`${entry.courseId}:${entry.sourceEventId}`));
    const byId = new Map([...generated, ...edited].map(entry => [entry.id, entry]));
    const ordered = existing.filter(entry => byId.has(entry.id)).map(entry => { const next = byId.get(entry.id); byId.delete(entry.id); return next; });
    state.composer.weeklyEntries = [...ordered, ...byId.values()];
    state.composer.planWarnings = result.warnings;
  } catch (error) { state.composer.planWarnings = [error.message]; }
}
function chooseTemplate(id) {
  state.composer.templateId = id;
  state.composer.kind = template()?.kind || 'single';
  state.composer.customSubject = null;
  state.composer.customBody = null;
  ensureWeeklyFields();
  if (state.composer.recipientMode === 'all') state.composer.selectedStudentIds = recipientRoster().filter(s => isValidEmail(s.email)).map(s => s.id);
}

function freshComposer(c = state.courses[0], t = state.templates.find(t => t.kind === 'weekly') || state.templates[0], academicId) {
  weeklyCustomizationOpen = false; weekRangeOpen = false; weekSourcesOpen = false;
  const composer = { courseId: c?.id || '', templateId: t?.id || '', kind: t?.kind || 'single', sessionId: '', fields: {}, selectedStudentIds: (c?.students || []).filter(s => isValidEmail(s.email)).map(s => s.id), customSubject: null, customBody: null, draftId: null };
  state.composer = composer;
  composer.recipientMode = 'all';
  composer.academicCourseId = groupForSubject(c, academicId)?.id || '';
  if (c) {
    const next = liveCourse(c) ? calendarEntries(c).find(entry => entry.scheduleSource === 'calendar') : null;
    chooseSession(next ? `event:${next.sourceEventId}` : deriveSessions(c)[0]?.id || '', false);
  }
  ensureWeeklyFields();
  composer.selectedStudentIds = recipientRoster().filter(s => isValidEmail(s.email)).map(s => s.id);
  return composer;
}
function canvasSessionFields(c, id, eventId = '') {
  const session = c ? deriveSessions(c).find(s => s.id === id) : null;
  const fields = { course_name: academicName(c), subject: c ? subjectName(c) : '', day: session?.day || '', month: session?.month || '', year: session?.year || '', time: session?.time || '', end_time: '', session_name: session?.title || '', preparation: session?.preparation || '', meeting_link: '', extra_notes: '' };
  const entry = calendarEntries(c).find(item => eventId ? item.sourceEventId === eventId : id && item.sessionId === id);
  if (entry) {
    Object.assign(fields, { day: entry.day || '', month: entry.month ? new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(`2000-${entry.month}-01T12:00:00Z`)) : '', year: entry.year || '', time: entry.startTime || '', end_time: entry.endTime || '', session_name: entry.event,
      preparation: session?.preparation || entry.preparation || '' });
  }
  return fields;
}
function chooseSession(id, reset = true) {
  const entries = calendarEntries(course());
  const entry = id.startsWith('event:') ? entries.find(item => item.sourceEventId === id.slice(6)) : entries.find(item => item.sessionId === id && item.scheduleSource === 'calendar');
  state.composer.sessionId = entry?.sessionId || (id.startsWith('event:') ? '' : id);
  state.composer.calendarEventId = entry?.scheduleSource === 'calendar' ? entry.sourceEventId : '';
  state.composer.fields = canvasSessionFields(course(), state.composer.sessionId, state.composer.calendarEventId);
  state.composer.canvasValues = structuredClone(state.composer.fields);
  state.composer.canvasNotice = '';
  if (reset) { state.composer.customSubject = null; state.composer.customBody = null; }
}
function classOptions(c) {
  const entries = calendarEntries(c).filter(entry => entry.scheduleSource === 'calendar');
  const represented = new Set(entries.map(entry => entry.sessionId).filter(Boolean));
  return [...entries.map(entry => ({ id: `event:${entry.sourceEventId}`, title: `${entry.event} · ${entry.scheduleLabel}` })),
    ...deriveSessions(c).filter(session => !represented.has(session.id)).map(session => ({ ...session, title: `${session.title}${liveCourse(c) ? ' · Módulo de Canvas' : ''}` }))];
}
function academicSelector() {
  const groups = academicGroups(), unassigned = state.courses.some(subject => !groupForSubject(subject));
  return `<label class="field">Curso académico<select id="academic-course-select">${state.composer.academicSelectionError ? '<option value="" selected disabled>Revisar curso del borrador</option>' : ''}${options(groups, state.composer.academicCourseId, group => `${group.name}${group.academicPeriod ? ` · ${group.academicPeriod}` : ''}`)}${unassigned || !groups.length ? `<option value="" ${!academicCourse() && !state.composer.academicSelectionError ? 'selected' : ''}>Sin curso académico identificado</option>` : ''}</select></label>`;
}
function variables() {
  return { ...state.composer.fields, weekly_agenda: isWeekly() ? composeWeeklyAgenda(state.composer.weeklyEntries).text : '', coordinator_name: state.settings.name, signature: state.settings.signature };
}
function resolvedMail() {
  const t = template();
  const values = variables();
  const resolve = text => {
    // General notices are the one optional weekly paragraph. Empty notices
    // disappear without leaving a token or generating mandatory filler text.
    const source = isWeekly() && !values.general_notices?.trim() ? text.replace(/\{\{\s*general_notices\s*\}\}/g, '') : text;
    const result = resolveTemplate(source, values);
    return { ...result, text: isWeekly() ? result.text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim() : result.text };
  };
  const subject = resolve(state.composer.customSubject ?? t?.subject ?? '');
  const body = resolve(state.composer.customBody ?? t?.body ?? '');
  return { subject: subject.text, body: body.text, missing: [...new Set([...subject.missing, ...body.missing])] };
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, error ? 8000 : 4500);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (loadingFailed) return Promise.reject(new Error('El archivo local no se pudo leer. Reinicia después de recuperar los datos.'));
  const snapshot = structuredClone(state), snapshotRevision = revision;
  const task = saving.catch(() => {}).then(() => api.save(snapshot));
  saving = task;
  task.then(() => { saveFailed = false; savedRevision = snapshotRevision; updateSaveStatus(); }, err => { saveFailed = true; updateSaveStatus(); toast(`No se pudo guardar: ${err.message}`, true); });
  return task;
}
function scheduleSave() { revision++; clearTimeout(saveTimer); updateSaveStatus('Guardando…'); saveTimer = setTimeout(() => { saveNow().catch(() => {}); }, 250); }
function updateSaveStatus(label) {
  const el = $('#save-status');
  if (el) el.innerHTML = `${icon(saveFailed ? 'info' : 'check')} ${esc(label || (saveFailed ? 'Error al guardar' : revision !== savedRevision ? 'Guardando…' : 'Guardado en este equipo'))}`;
}

function render() {
  academicGroupSnapshot = academicCourses(state.courses);
  try {
  if (!state.composer) freshComposer();
  ensureAcademicSelection();
  ensureWeeklyFields();
  const nav = [{ id: 'compose', name: 'Crear correo', icon: 'mail' }, { id: 'courses', name: 'Mis cursos', icon: 'book', count: academicGroups().length }, { id: 'templates', name: 'Plantillas', icon: 'template' }, { id: 'drafts', name: 'Borradores', icon: 'draft', count: state.drafts.length }];
  $('#app').innerHTML = `<aside class="sidebar">
    <a href="#" class="brand" data-action="nav" data-view="compose"><span class="brand-mark">${icon('book')}</span><span>campus<span class="brand-caption">COORDINACIÓN</span></span></a>
    <div class="workspace-label">TU ESPACIO DE TRABAJO</div>
    <nav aria-label="Navegación principal">${nav.map(n => `<button data-action="nav" data-view="${n.id}" aria-label="${n.name}" title="${n.name}" class="nav-item ${view === n.id ? 'active' : ''}">${icon(n.icon)}<span>${n.name}</span>${n.count !== undefined ? `<span class="nav-count">${n.count}</span>` : ''}</button>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="local-card"><span class="local-icon">${icon('shield')}</span><strong>Tu trabajo se queda aquí</strong><p>Cursos, plantillas y borradores.<br>En tu ordenador, bajo tu control.</p><span class="status-dot"></span><span class="small"> Almacenamiento local</span></div>
    <button data-action="nav" data-view="settings" aria-label="Ajustes" title="Ajustes" ${view === 'settings' ? 'aria-current="page"' : ''} class="nav-item settings-link ${view === 'settings' ? 'active' : ''}"><span class="settings-icon">${icon('settings')}</span><span>Ajustes</span>${icon('chevron', 'settings-chevron')}</button>
    <div class="profile"><span class="avatar">${esc((state.settings.name || 'CO').split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase())}</span><span><strong>${esc(state.settings.name || 'Mi coordinación')}</strong><small>Espacio personal</small></span></div></div>
  </aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Coordinación académica <span>/</span> <strong>${({ compose: 'Crear correo', courses: 'Mis cursos', templates: 'Plantillas', drafts: 'Borradores', settings: 'Ajustes' })[view]}</strong></div><div class="topbar-actions"><span class="local-pill">${icon('shield')} Solo en este equipo</span>${button('toggle-theme', '', 'moon', 'icon-button theme-toggle', 'aria-label="Activar modo oscuro" title="Activar modo oscuro"')}</div></header>
  <div id="canvas-connection-bar">${canvasBar()}</div><main id="main">${view === 'compose' ? composeView() : view === 'courses' ? coursesView() : view === 'templates' ? templatesView() : view === 'drafts' ? draftsView() : settingsView()}</main>
  <footer class="app-footer"><span>Un poco menos de administración. Más tiempo para acompañar.</span><span>Campus <span class="muted">/</span> 0.1</span></footer></div>`;
  updateCanvasBar();
  updateSaveStatus();
  updateThemeControls();
  } finally { academicGroupSnapshot = null; }
}
function pageHeading(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}
function canvasBar() {
  const last = state.canvasLastSync?.syncedAt;
  const label = canvasBusy ? canvasProgress || 'Leyendo datos de Canvas…' : canvasStatus.error ? 'Canvas necesita atención · copia local disponible' : canvasStatus.connected ? `Canvas conectado · ${canvasStatus.user?.name || 'Tu cuenta'}` : 'Conecta Canvas para traer tus cursos y estudiantes';
  return `<div class="canvas-bar ${canvasStatus.connected ? 'connected' : ''}"><div>${icon(canvasBusy ? 'clock' : 'book')}<span><strong>${esc(label)}</strong>${last && !canvasBusy ? `<small>Última actualización: ${new Date(last).toLocaleString('es-ES', { timeZone: timeZone(), dateStyle: 'short', timeStyle: 'short' })}</small>` : ''}</span></div><div class="button-row">${state.canvasLastSync?.warnings?.length || canvasStatus.error ? button('canvas-warnings', 'Ver avisos', 'info', 'btn compact') : ''}${canvasStatus.connected || canvasStatus.mode ? button('canvas-sync', 'Actualizar', 'down', 'btn compact', canvasBusy ? 'disabled' : '') : ''}${button('canvas-connect', canvasStatus.connected ? 'Cuenta Canvas' : 'Conectar Canvas', 'external', 'btn compact', canvasBusy ? 'disabled' : '')}</div></div>`;
}
function updateCanvasBar() {
  if ($('#canvas-connection-bar')) $('#canvas-connection-bar').innerHTML = canvasBar();
  document.querySelectorAll('[data-action="canvas-connect"],[data-action="canvas-sync"],[data-action="canvas-fill-week"],[data-action="shift-week"],[data-action="compose-mode"],#week-select,#academic-course-select,#course-select,[data-week-range],[data-week-course]').forEach(el => { el.disabled = canvasBusy; });
  if (view === 'compose' && course()) updatePreview();
}
function canvasConnectionModal() {
  activeModal = { type: 'canvas' };
  showModal('Conectar con Canvas', `<p class="modal-intro">Inicia sesión con tu cuenta de coordinación. Campus leerá las asignaturas, estudiantes, módulos, clases y entregas directamente de Canvas; se agruparán por curso académico.</p>${canvasStatus.connected ? `<div class="connection-account">${icon('check')} Conectado como ${esc(canvasStatus.user?.name || 'usuario de Canvas')}<br><small>${esc(canvasStatus.baseUrl)}</small></div>` : ''}
    <label class="field">Dirección de Canvas<input id="canvas-base-url" type="url" value="${esc(canvasStatus.baseUrl || 'https://hesperides.instructure.com')}" placeholder="https://tu-universidad.instructure.com"></label>
    <p class="field-help">Se abrirá la página de acceso de tu universidad. Los datos descargados y la sesión se guardan en este ordenador.</p>
    <details class="optional-fields"><summary>Acceso alternativo con token ${icon('plus')}</summary><p class="small muted">Si tu universidad bloquea el acceso en la ventana de la aplicación, puedes usar un token personal de Canvas.</p><label class="field">Token de acceso<input id="canvas-token" type="password" autocomplete="off" spellcheck="false"></label></details>
    ${canvasStatus.error ? `<p class="notice">${esc(canvasStatus.error)}</p>` : ''}${canvasStatus.credentialStorage === 'memory' ? '<p class="notice">El token solo está disponible durante esta sesión porque el sistema no permite guardarlo cifrado.</p>' : ''}`, `${canvasStatus.connected || canvasStatus.user ? button('canvas-disconnect', 'Desconectar', null, 'btn danger') : ''}<span class="spacer"></span>${button('close-modal', 'Cancelar')}${button('canvas-login', 'Iniciar sesión en Canvas', 'external', 'btn primary')}`);
}
async function connectCanvas() {
  const baseUrl = $('#canvas-base-url').value.trim(), token = $('#canvas-token').value.trim();
  $('#canvas-token').value = '';
  closeModal(); canvasBusy = true; canvasProgress = 'Esperando el inicio de sesión en Canvas…'; updateCanvasBar();
  try {
    canvasStatus = await api.canvasConnect({ baseUrl, ...(token ? { token } : {}) });
    if (!canvasStatus.connected) { if (canvasStatus.error) throw new Error(canvasStatus.error); return; }
    if (!state.settings.name && canvasStatus.user?.name) state.settings.name = canvasStatus.user.name;
    if (!state.settings.email && isValidEmail(canvasStatus.user?.email)) state.settings.email = canvasStatus.user.email;
    scheduleSave();
  } finally { canvasBusy = false; canvasProgress = ''; updateCanvasBar(); }
  if (canvasStatus.connected) await syncCanvas({ selectConnectedCourse: true });
}
async function syncCanvas({ notify = true, selectConnectedCourse = false } = {}) {
  if (canvasBusy) return;
  canvasBusy = true; canvasProgress = 'Leyendo asignaturas y estudiantes de Canvas…'; updateCanvasBar();
  try {
    const period = state.composer?.weeklyPlan || nextCanvasWeek(new Date(), timeZone());
    validateWeekRange(period.startDate, period.endDate);
    const result = await api.canvasSync({ startDate: period.startDate, endDate: period.endDate });
    const previousLiveIds = new Set(state.courses.filter(liveCourse).map(c => c.id));
    // A different account/Canvas host never inherits the previous account's courses.
    state.courses = state.courses.filter(c => !liveCourse(c) || (c.source.baseUrl === result.baseUrl && String(c.source.userId) === String(result.user.id)));
    const returnedIds = new Set(result.courses.map(c => c.id));
    state.courses = state.courses.filter(c => !liveCourse(c) || returnedIds.has(c.id));
    state.canvasLastSync = { syncedAt: result.syncedAt, baseUrl: result.baseUrl, userId: result.user.id, startDate: result.startDate || period.startDate, endDate: result.endDate || period.endDate, warnings: result.warnings || [] };
    mergeCourses(result.courses, { authoritativeCanvas: true });
    if (selectConnectedCourse || !course() || (course()?.isDemo && !previousLiveIds.size)) {
      const first = result.courses[0];
      if (first) freshComposer(state.courses.find(c => c.id === first.id), state.templates.find(t => t.kind === 'weekly') || template());
    }
    if (isWeekly()) { ensureWeeklyFields(); applyCanvasPlan(); }
    canvasStatus = { ...canvasStatus, connected: true, user: result.user, baseUrl: result.baseUrl, lastSyncedAt: result.syncedAt, error: null };
    await saveNow(); render();
    if (notify) toast(`${result.courses.length} asignaturas actualizadas desde Canvas.${result.warnings?.length ? ' Revisa los avisos de sincronización.' : ''}`);
  } catch (error) {
    canvasStatus = { ...canvasStatus, error: error.message };
    toast(`Canvas: ${error.message}`, true);
    throw error;
  } finally { canvasBusy = false; canvasProgress = ''; updateCanvasBar(); }
}
async function initializeCanvas() {
  api.onCanvasProgress?.(progress => {
    if (progress.status) canvasStatus = { ...canvasStatus, ...progress.status };
    if (progress.message) canvasProgress = progress.message;
    updateCanvasBar();
  });
  try {
    canvasStatus = await api.canvasStatus(); updateCanvasBar();
    if (canvasStatus.connected) {
      if (!state.settings.name && canvasStatus.user?.name) state.settings.name = canvasStatus.user.name;
      if (!state.settings.email && isValidEmail(canvasStatus.user?.email)) state.settings.email = canvasStatus.user.email;
      await syncCanvas({ notify: false });
    }
  } catch (error) { canvasStatus.error = error.message; updateCanvasBar(); }
  canvasTimer = setInterval(() => { if ((canvasStatus.connected || canvasStatus.mode) && !canvasBusy && !activeModal && !document.activeElement?.matches('input,textarea,select')) syncCanvas({ notify: false }).catch(() => {}); }, 15 * 60 * 1000);
}
function canvasSettingsPanel() {
  return `<section class="panel canvas-settings"><div class="section-heading">${icon('book')}<h2>Conexión con Canvas</h2>${button('canvas-connect', canvasStatus.connected ? 'Gestionar cuenta' : 'Conectar Canvas', 'external', 'btn compact')}</div><p>Las asignaturas, estudiantes, contenidos, fechas y entregas se leen de Canvas al iniciar y cada 15 minutos mientras la aplicación está abierta. Los correos se preparan y guardan localmente.</p><label class="field">Zona horaria del calendario<select data-setting="timeZone">${['Europe/Vienna', 'Europe/Madrid', 'Atlantic/Canary', 'Europe/London', 'UTC'].map(zone => `<option ${timeZone() === zone ? 'selected' : ''}>${zone}</option>`).join('')}</select></label><p class="small muted">Las fechas publicadas con hora se muestran en esta zona. Las fechas escritas en los títulos de los módulos se conservan como aparecen en Canvas.</p></section>`;
}
function rosterNotice(c) {
  const warnings = [];
  if (c.syncStatus?.students === 'error') warnings.push('No se pudo actualizar el listado de estudiantes. Se conserva la última copia local; revisa los permisos de tu cuenta Canvas.');
  const missing = c.students.filter(s => !isValidEmail(s.email)).length;
  if (missing) warnings.push(`Canvas no facilita un correo válido para ${missing} estudiantes. No se incluyen en CCO. Tu cuenta necesita permiso para ver sus direcciones.`);
  if (!c.students.length && c.syncStatus?.students !== 'error') warnings.push('Canvas no devuelve estudiantes activos en esta asignatura.');
  return warnings.map(message => `<p class="notice roster-notice">${esc(message)}</p>`).join('');
}
function composerRosterNotice() {
  const group = academicCourse();
  if (!isWeekly() || !group) return rosterNotice(course());
  const warnings = [...group.rosterWarnings];
  if (recipientRoster().some(s => !isValidEmail(s.email))) warnings.push('Los estudiantes sin correo disponible no se incluyen en CCO.');
  return warnings.map(message => `<p class="notice roster-notice">${esc(message)}</p>`).join('');
}
function canvasWeekControls() {
  const plan = state.composer.weeklyPlan;
  if (!liveCourse(course()) || !plan) return '';
  const available = groupSubjects().filter(c => liveCourse(c) && c.source.baseUrl === course().source.baseUrl && String(c.source.userId) === String(course().source.userId));
  const week = canvasWeekInput(plan.startDate);
  const standard = canvasWeekFromInput(week);
  const custom = standard.startDate !== plan.startDate || standard.endDate !== plan.endDate;
  const date = value => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  return `<div class="canvas-week week-picker"><label class="field" for="week-select">Semana</label><div class="week-picker-row">${button('shift-week', '', 'chevron', 'btn week-previous', 'data-direction="-1" aria-label="Semana anterior"')}<input id="week-select" type="week" value="${esc(week)}" aria-describedby="week-dates">${button('shift-week', '', 'chevron', 'btn', 'data-direction="1" aria-label="Semana siguiente"')}</div><p id="week-dates">Del ${esc(date(plan.startDate))} al ${esc(date(plan.endDate))}${custom ? ' · Periodo personalizado' : ''}</p><p class="week-explanation">El borrador reúne todas las actividades de las asignaturas del curso, con su horario y el material que preparar.</p>${button('canvas-fill-week', 'Actualizar desde Canvas', 'down', 'btn compact', canvasBusy ? 'disabled' : '')}<details id="week-range-options" class="optional-fields" ${weekRangeOpen ? 'open' : ''}><summary>Ajustar periodo o asignaturas ${icon('edit')}</summary><div class="two-fields"><label class="field">Inicio del calendario<input type="date" data-week-range="startDate" value="${esc(plan.startDate)}"></label><label class="field">Fin del calendario<input type="date" data-week-range="endDate" value="${esc(plan.endDate)}"></label></div><details class="week-sources" ${weekSourcesOpen ? 'open' : ''}><summary>Asignaturas incluidas (${plan.courseIds.length})</summary><p class="small muted">Todas las asignaturas del curso se incluyen por defecto. Desmarcar una cambia la agenda, no los destinatarios.</p>${available.map(c => `<label><input type="checkbox" data-week-course="${esc(c.id)}" ${plan.courseIds.includes(c.id) ? 'checked' : ''}><span>${esc(subjectName(c))}</span></label>`).join('')}</details></details></div>`;
}
function weeklyOverview() {
  const entries = state.composer.weeklyEntries || [];
  const subjects = new Set(entries.map(entry => entry.courseId || entry.subject).filter(Boolean));
  return `<section class="panel weekly-overview"><div class="section-heading">${icon('check')}<h2>Semana preparada</h2><span class="tag">${entries.length} actividades</span></div><p>${subjects.size} asignaturas con actividad. El borrador incluye clases, tutorías, exámenes y entregas en orden de fecha.</p>${!entries.length ? '<p class="notice">No hay actividades disponibles para este periodo. Actualiza Canvas o elige otra semana.</p>' : ''}${(state.composer.planWarnings || []).map(warning => `<p class="notice">${esc(warning)}</p>`).join('')}</section>`;
}

function emptyState(title, description, actions = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon('book')}</span><h2>${title}</h2><p>${description}</p><div class="button-row">${actions}</div></div>`;
}
function composeView() {
  const heading = pageHeading('COORDINACIÓN DE LA SEMANA', isWeekly() ? 'El correo de la semana, listo.' : 'El próximo correo, listo.', 'Elige curso y semana. Revisa el borrador y ábrelo en Gmail.', button('nav', 'Ver plantillas', 'template', 'btn subtle', 'data-view="templates"'));
  if (!course()) return heading + `<div class="welcome-panel"><div class="welcome-art">${icon('mail')}<span class="art-tag">Hecho para tu día a día</span></div><div class="welcome-content"><span class="eyebrow">EMPECEMOS POR TUS CURSOS</span><h2>De Canvas a un correo<br>con todo lo necesario.</h2><p>Inicia sesión en Canvas. Tus cursos, estudiantes y actividades se cargarán automáticamente para preparar los correos y el resumen de la semana.</p><div class="button-row">${button('canvas-connect', 'Conectar Canvas', 'external', 'btn primary', canvasBusy ? 'disabled' : '')}</div><button class="text-button demo-link" data-action="demo">Explorar con cursos de ejemplo ${icon('arrow')}</button><small>Los ejemplos están identificados y se pueden eliminar.</small></div></div><div class="feature-strip"><div>${icon('template')}<strong>Escribe una vez</strong><span>Reutiliza tus propias plantillas.</span></div><div>${icon('book')}<strong>El contexto de cada clase</strong><span>Preparación según el orden de Canvas.</span></div><div>${icon('shield')}<strong>Destinatarios en CCO</strong><span>Tú en «Para». Tus estudiantes, en privado.</span></div></div>`;
  const c = course(), sessions = deriveSessions(c), comp = state.composer;
  const session = sessions.find(s => s.id === comp.sessionId);
  const group = academicCourse();
  const schedule = calendarEntries(c).find(entry => comp.calendarEventId ? entry.sourceEventId === comp.calendarEventId : entry.sessionId === comp.sessionId);
  return heading + `<div class="composer-modes" aria-label="Tipo de correo">${button('compose-mode', 'Resumen semanal', 'book', `mode-button ${isWeekly() ? 'selected' : ''}`, 'data-mode="weekly"')}${button('compose-mode', 'Correo de una clase', 'mail', `mode-button ${!isWeekly() ? 'selected' : ''}`, 'data-mode="single"')}<span>Una semana. Todas las asignaturas.</span></div><div class="composer-toolbar"><div class="workflow"><span class="workflow-step current"><b>1</b> Preparar</span><span class="workflow-line"></span><span class="workflow-step"><b>2</b> Revisar</span><span class="workflow-line"></span><span class="workflow-step"><b>3</b> Abrir en Gmail</span></div><span class="save-status" id="save-status"></span></div>
    <div class="composer-layout ${isWeekly() ? 'weekly-layout' : ''}"><div class="composer-form">
      <section class="panel"><div class="section-heading"><span class="section-number">01</span><h2>${isWeekly() ? 'Curso y semana' : 'Curso y plantilla'}</h2></div>
        ${academicSelector()}
        ${!isWeekly() || !group ? `<label class="field">Asignatura<select id="course-select">${options(groupSubjects(), c.id, x => `${subjectName(x)}${x.isDemo ? ' · Ejemplo' : ''}`)}</select></label>` : ''}
        <div class="course-summary"><span class="course-monogram">${esc(group ? `${group.studyYear}º` : c.code?.slice(0, 3) || 'ASG')}</span><div><strong>${esc(group?.name || subjectName(c))}</strong><span>${group ? `${group.subjectIds.length} asignaturas · ` : ''}${recipientRoster().length} estudiantes${group?.academicPeriod ? ` · ${esc(group.academicPeriod)}` : ''}</span></div><span class="tag ${c.isDemo ? 'amber' : ''}">${c.isDemo ? 'Ejemplo' : liveCourse(c) ? 'Canvas' : 'Local'}</span></div>
        ${isWeekly() ? canvasWeekControls() : `<label class="field">Plantilla de correo<select id="template-select">${options(state.templates, comp.templateId)}</select></label><p class="field-help">${icon('template')}${esc(template()?.description || '')}</p>`}
      </section>
      ${isWeekly() ? weeklyOverview() : `<section class="panel"><div class="section-heading"><span class="section-number">02</span><h2>Los detalles de la clase</h2><span class="tag">Editables</span></div>
        <label class="field">${liveCourse(c) ? 'Clase o actividad del calendario' : 'Clase síncrona'}<select id="session-select">${calendarSelectionError() ? '<option value="" selected disabled>Actividad fuera del calendario actual</option>' : ''}<option value="">Introducir los datos manualmente</option>${options(classOptions(c), comp.calendarEventId ? `event:${comp.calendarEventId}` : comp.sessionId, s => s.title)}</select></label>
        ${schedule?.scheduleLabel ? `<p id="class-schedule" class="calendar-schedule">${icon('clock')}<span><strong>${schedule.scheduleSource === 'calendar' ? 'Horario del calendario' : 'Fecha del módulo'}</strong>${esc(schedule.scheduleLabel)}</span></p>` : ''}
        ${!classOptions(c).length ? '<p class="notice">No hay actividades de calendario ni clases publicadas en los módulos de esta asignatura.</p>' : ''}${comp.canvasNotice ? `<p class="notice">${esc(comp.canvasNotice)}</p>` : ''}
        <div class="two-fields">${field('course_name', 'Nombre del curso')}${field('subject', 'Asignatura')}</div>
        ${field('session_name', 'Nombre de la clase')}
        <div class="date-fields">${field('day', 'Día', 'Ej. 14')}${field('month', 'Mes', 'Ej. octubre')}${field('year', 'Año', 'Ej. 2026')}${field('time', 'Hora', 'Ej. 18:00')}</div>${field('end_time', 'Hora de fin', 'Según el calendario')}
        <div class="preparation-box"><div class="preparation-heading">${icon('book')}<strong>Antes de la clase</strong><span>SEGÚN CANVAS</span></div><label class="field">Preparación hasta<textarea data-field="preparation" rows="3" placeholder="Indica la última sesión o material que deben revisar">${esc(comp.fields.preparation)}</textarea></label><p class="evidence">${icon('info')}${esc(session?.evidence || 'Introduce la preparación a partir de la estructura de tu curso.')}</p>${session ? button('show-structure', 'Ver estructura de la asignatura', 'arrow', 'text-button') : ''}</div>
        <details class="optional-fields"><summary>Más detalles <span>Enlace y notas adicionales</span>${icon('plus')}</summary>${field('meeting_link', 'Enlace de la clase', 'https://…')}${field('extra_notes', 'Notas adicionales', 'Información que quieras añadir', true)}</details>
      </section>`}
      <section class="panel"><div class="section-heading"><span class="section-number">03</span><h2>Destinatarios</h2><span class="tag">CCO</span></div><div class="recipient-summary"><span class="recipient-icon">${icon('people')}</span><div><strong id="recipient-count">${selectedStudents().length} de ${recipientRoster().length} estudiantes</strong><p>Solo tú apareces en «Para».</p></div>${button('recipients', 'Elegir', null, 'btn compact')}</div>${liveCourse(c) ? composerRosterNotice() : !c.students.length ? `<p class="notice">Añade estudiantes o importa su listado CSV desde Mis cursos.</p>${button('manage-course', 'Añadir estudiantes', 'plus', 'text-button', `data-id="${esc(c.id)}"`)}` : ''}</section>
      ${isWeekly() ? `<details id="weekly-customization" class="weekly-customization" ${weeklyCustomizationOpen ? 'open' : ''}><summary>${icon('edit')}<span>Personalizar borrador<small>Plantilla, material, avisos y despedida</small></span>${icon('chevron')}</summary><div class="customization-content">${weeklyComposerView()}</div></details>` : ''}
    </div><aside class="preview-column"><div class="preview-heading"><div><span class="preview-dot"></span><strong>${isWeekly() ? 'Borrador de la semana' : 'Tu correo, en tiempo real'}</strong></div><span>VISTA PREVIA</span></div><div class="email-card"><div class="email-card-top"><span>${icon('mail')} Nuevo mensaje</span><div class="window-dots"><i></i><i></i><i></i></div></div><div class="email-meta"><div><span>Para</span><strong id="preview-to"></strong>${button('nav', 'Cambiar', null, 'text-button tiny', 'data-view="settings"')}</div><div><span>CCO</span><button class="recipient-chip" data-action="recipients" id="preview-bcc"></button><span class="private-label">${icon('shield')} Privados</span></div></div><div id="email-subject" class="email-subject"></div><div id="email-body" class="email-body"></div><div class="email-bottom"><span>Preparado con Campus</span>${button('edit-mail', 'Editar texto', 'edit', 'text-button')}</div></div><div id="preview-validation"></div><div class="preview-actions">${button('gmail', 'Abrir borrador en Gmail', 'external', 'btn primary gmail-button')}${button('save-draft', 'Guardar borrador', 'draft', 'btn')}${button('copy-mail', 'Copiar', 'copy', 'btn')}</div><p class="handoff-note">${icon('info')} Gmail se abrirá con el correo preparado en texto sin formato. Revísalo y envíalo desde allí cuando quieras.</p><div class="local-note">${icon('leaf')} Tus correos y borradores se guardan en este equipo.</div></aside></div>`;
}

function weeklyComposerView() {
  return `<section class="panel weekly-details"><div class="section-heading"><span class="section-number">02</span><h2>La semana de tu curso</h2><span class="tag">Resumen semanal</span></div>
    <label class="field">Plantilla de correo<select id="template-select">${options(state.templates, state.composer.templateId)}</select></label>
    ${field('course_name', 'Curso en el asunto', 'Ej. 3º de Grado en Economía')}
    <div class="date-fields">${field('week_start_day', 'Desde el día', 'Ej. 5')}${field('week_end_day', 'Hasta el día', 'Ej. 9')}${field('month', 'Mes', 'Octubre')}${field('year', 'Año', '2026')}</div>
    <p class="field-help">Cada parte de la fecha es independiente. El asunto de esta plantilla utiliza los dos días.</p>
    <details class="optional-fields"><summary>Saludo e introducción ${icon('edit')}</summary>${field('greeting', 'Saludo')}${field('weekly_intro', 'Introducción', '', true)}</details>
  </section>
  <section class="panel weekly-agenda"><div class="section-heading">${icon('book')}<h2>Clases y trabajo de la semana</h2><span class="tag">${state.composer.weeklyEntries.length} apartados</span></div><p class="weekly-help">${liveCourse(course()) ? 'Actividades traídas de Canvas. Las ediciones que hagas aquí se conservan en las siguientes actualizaciones.' : 'Añade una sección por clase, tutoría o examen. Puedes repetir una asignatura.'}</p>
    <div id="weekly-entries">${state.composer.weeklyEntries.map(weeklyEntryView).join('')}</div>
    ${button('add-weekly-entry', 'Añadir asignatura o actividad', 'plus', 'btn add-weekly')}
  </section>
  <section class="panel"><div class="section-heading">${icon('template')}<h2>Avisos y despedida</h2></div>${field('general_notices', 'Avisos generales (opcional)', 'Aclaraciones sobre fechas, entregas u organización del curso.', true)}${field('closing', 'Despedida', 'Os deseo un feliz finde,')}</section>`;
}
function weeklyEntryView(entry, index) {
  const source = state.courses.find(c => c.id === entry.courseId);
  const sessions = source ? deriveSessions(source) : [];
  const examPreparation = entry.preparationSource === 'exam';
  const valueField = (key, label, placeholder = '', area = false) => `<label class="field">${label}${area ? `<textarea data-weekly-field="${key}" data-entry="${esc(entry.id)}" rows="3" placeholder="${esc(placeholder)}">${esc(entry[key])}</textarea>` : `<input data-weekly-field="${key}" data-entry="${esc(entry.id)}" value="${esc(entry[key])}" placeholder="${esc(placeholder)}">`}</label>`;
  return `<article class="weekly-entry" data-entry-id="${esc(entry.id)}"><header><strong>Apartado ${index + 1}</strong><div>${button('move-weekly-entry', '', 'arrow', 'icon-button move-up', `data-id="${esc(entry.id)}" data-direction="-1" aria-label="Subir apartado ${index + 1}" ${index === 0 ? 'disabled' : ''}`)}${button('move-weekly-entry', '', 'arrow', 'icon-button move-down', `data-id="${esc(entry.id)}" data-direction="1" aria-label="Bajar apartado ${index + 1}" ${index === state.composer.weeklyEntries.length - 1 ? 'disabled' : ''}`)}${button('remove-weekly-entry', '', 'trash', 'icon-button', `data-id="${esc(entry.id)}" aria-label="Eliminar apartado ${index + 1}"`)}</div></header>
    ${entry.scheduleLabel ? `<p class="entry-schedule calendar-schedule">${icon('clock')}<span><strong>${entry.scheduleSource === 'calendar' ? 'Calendario de Canvas' : entry.scheduleSource === 'assignment' ? 'Entrega en Canvas' : 'Fecha del módulo'}</strong>${esc(entry.scheduleLabel)}</span></p>` : ''}
    <label class="field">Asignatura de origen<select data-weekly-select="course" data-entry="${esc(entry.id)}"><option value="">Introducir los datos manualmente</option>${options(academicCourse() ? subjectsForAcademicCourse(state.courses, academicCourse()) : state.courses, entry.courseId, subjectName)}</select></label>
    <div class="two-fields">${valueField('subject', 'Asignatura', 'Ej. Finanzas II')}${valueField('event', 'Clase, tutoría o examen', 'Ej. Tutoría 2')}</div>
    ${valueField('teacher', 'Profesor (opcional)', 'Nombre del profesor')}
    ${source && !examPreparation ? `<label class="field">Clase de referencia para la preparación<select data-weekly-select="session" data-entry="${esc(entry.id)}"><option value="">Sin clase de referencia</option>${options(sessions, entry.sessionId, s => s.title)}</select></label>` : ''}
    <label class="field">Preparación<select data-weekly-select="preparationMode" data-entry="${esc(entry.id)}"><option value="manual" ${entry.preparationMode === 'manual' ? 'selected' : ''}>Indicar sesiones, tareas o temario</option><option value="canvas" ${entry.preparationMode === 'canvas' ? 'selected' : ''} ${!entry.sessionId && !examPreparation ? 'disabled' : ''}>${examPreparation ? 'Última sesión asíncrona antes del examen' : 'Hasta la sesión indicada por Canvas'}</option><option value="none" ${entry.preparationMode === 'none' ? 'selected' : ''}>Omitir preparación</option></select></label>
    ${entry.preparationMode === 'none' ? '' : valueField('preparation', 'Contenido que deben preparar (opcional)', 'Ej. Trabajar las sesiones 1 a 3 y entregar el trabajo individual 3.6.', true)}
    ${entry.sessionId || examPreparation ? `<div class="weekly-source"><p>${esc(entry.evidence || 'La preparación se ha indicado manualmente.')}</p>${button('refresh-weekly-entry', 'Actualizar desde Canvas', 'book', 'text-button', `data-id="${esc(entry.id)}"`)}</div>` : ''}
    ${valueField('notes', 'Indicaciones adicionales (opcional)', 'Entregas, fecha del examen, cambios o recordatorios.', true)}
  </article>`;
}
function field(key, label, placeholder = '', area = false) {
  const val = esc(state.composer.fields[key] || '');
  return `<label class="field">${label}${area ? `<textarea data-field="${key}" placeholder="${esc(placeholder)}" rows="3">${val}</textarea>` : `<input data-field="${key}" value="${val}" placeholder="${esc(placeholder)}">`}</label>`;
}
function updatePreview() {
  if (!$('#email-body')) return;
  const mail = resolvedMail();
  $('#email-subject').textContent = mail.subject || 'Asunto del correo';
  $('#email-body').textContent = mail.body || 'El texto de tu correo aparecerá aquí.';
  $('#preview-to').textContent = state.settings.email || 'Añade tu correo en Ajustes';
  $('#preview-bcc').textContent = `${selectedStudents().length} estudiantes`;
  $('#recipient-count').textContent = `${selectedStudents().length} de ${recipientRoster().length} estudiantes`;
  const errors = composerDateErrors();
  if (canvasBusy) errors.push('Actualizando las actividades y el material desde Canvas…');
  if (calendarSelectionError()) errors.push(calendarSelectionError());
  if (state.composer.academicSelectionError) errors.push(state.composer.academicSelectionError);
  if (isWeekly()) errors.push(...weeklyErrors());
  else if (liveCourse(course()) && course().preparationComplete === false && state.composer.sessionId) errors.push('La estructura de Canvas está incompleta. Actualiza Canvas antes de usar la preparación de esta clase.');
  const unknown = mail.missing.filter(key => !VARIABLES.some(v => v.key === key));
  const known = mail.missing.filter(key => VARIABLES.some(v => v.key === key));
  if (known.length) errors.push(`Completa: ${known.map(key => VARIABLES.find(v => v.key === key)?.label || key).join(', ')}.`);
  if (unknown.length) errors.push(`Variables desconocidas: ${unknown.join(', ')}. Corrígelas en «Editar texto» o en la plantilla.`);
  if (!state.settings.email) errors.push('Añade tu dirección de correo en Ajustes.');
  if (!selectedStudents().length) errors.push('Selecciona al menos un estudiante.');
  if (!mail.subject.trim() || !mail.body.trim()) errors.push('El asunto y el mensaje no pueden estar vacíos.');
  if (!errors.length) {
    try {
      const url = buildGmailUrl({ to: state.settings.email, bcc: selectedStudents().map(s => s.email), subject: mail.subject, body: mail.body });
      if (url.length > 16000) errors.push('Este correo supera el tamaño del enlace de Gmail. Reduce el texto o los destinatarios, o copia el correo.');
    } catch (err) { errors.push(err.message); }
  }
  $('#preview-validation').innerHTML = errors.length ? `<div class="validation-box">${icon('info')}<div>${errors.map(e => `<p>${esc(e)}</p>`).join('')}</div></div>` : `<div class="ready-note">${icon('check')} Todo listo para revisar en Gmail.</div>`;
  if (liveCourse(course())) $('#preview-validation').insertAdjacentHTML('afterbegin', composerRosterNotice());
  const session = deriveSessions(course()).find(s => s.id === state.composer.sessionId);
  const evidence = !isWeekly() && $('.evidence');
  if (evidence && session) {
    const modified = state.composer.fields.preparation !== session.preparation;
    evidence.innerHTML = `${icon('info')}${modified ? '<span>Preparación personalizada o guardada anteriormente. ' : '<span>'}${esc(session.evidence)}</span>`;
  }
  const gmail = $('[data-action="gmail"]'); gmail.disabled = errors.length > 0;
  gmail.title = errors.length ? errors.join(' ') : 'Abrir en Gmail con los estudiantes en CCO';
}

function composerDateErrors() {
  if (!isWeekly()) return dateErrors(state.composer.fields);
  const fields = state.composer.fields;
  return [...new Set([
    ...dateErrors({ ...fields, day: fields.week_start_day, time: '' }),
    ...dateErrors({ ...fields, day: fields.week_end_day, time: '' }),
  ])];
}
function currentWeeklyPreparation(entry) {
  const source = state.courses.find(c => c.id === entry.courseId);
  if (entry.preparationSource === 'exam') return calendarEntries(source).find(item => item.sourceEventId === entry.sourceEventId) || { preparation: '', evidence: '' };
  return createWeeklyEntry(source, entry.sessionId);
}
function weeklyErrors() {
  const entries = state.composer.weeklyEntries || [];
  const errors = composeWeeklyAgenda(entries).missing;
  entries.forEach((entry, index) => {
    if (entry.calendarStale) errors.push(`Apartado ${index + 1}: la actividad ya no aparece en el calendario del periodo. Revísala antes de abrir Gmail.`);
    if (entry.preparationMode !== 'canvas' || !withoutActivityLinks(entry.preparation)) return;
    const source = state.courses.find(c => c.id === entry.courseId);
    const current = currentWeeklyPreparation(entry);
    if (!source || !current.preparation) errors.push(`Apartado ${index + 1}: no hay una preparación de Canvas disponible. Indícala manualmente o elige otra clase.`);
    else if (source.preparationComplete === false) errors.push(`Apartado ${index + 1}: no se pudo actualizar toda la preparación de Canvas. Vuelve a sincronizar o revisa las indicaciones antes de elegir la preparación manual.`);
    else if (current.preparation !== entry.preparation) errors.push(`Apartado ${index + 1}: la estructura de Canvas ha cambiado. Pulsa «Actualizar desde Canvas» o revisa la preparación manualmente.`);
  });
  return errors;
}

function dateErrors(fields) {
  // Free text is intentional (e.g. “martes 20”). Only reject unambiguous
  // impossible numeric dates; no field depends on the presence of another.
  const errors = [], numeric = value => /^\d+$/.test(String(value || '').trim());
  const day = String(fields.day || '').trim(), month = String(fields.month || '').trim(), year = String(fields.year || '').trim();
  if (numeric(day) && (+day < 1 || +day > 31)) errors.push('El día debe estar entre 1 y 31.');
  if (numeric(month) && (+month < 1 || +month > 12)) errors.push('El mes debe estar entre 1 y 12, o escrito por su nombre.');
  if (numeric(year) && (+year < 1 || +year > 9999)) errors.push('Revisa el año indicado.');
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const monthNumber = numeric(month) ? +month : monthNames.indexOf(month.toLowerCase()) + 1;
  if (!errors.length && numeric(day) && numeric(year) && monthNumber) {
    const date = new Date(0); date.setFullYear(+year, monthNumber - 1, +day);
    if (date.getMonth() !== monthNumber - 1) errors.push('La fecha indicada no existe. Revisa el día y el mes.');
  }
  if (/^\d{1,2}:\d{2}$/.test(fields.time || '')) { const [h, m] = fields.time.split(':').map(Number); if (h > 23 || m > 59) errors.push('La hora debe estar entre 00:00 y 23:59.'); }
  return errors;
}

function coursesView() {
  const groups = academicGroups();
  return pageHeading('CURSOS Y ASIGNATURAS', 'Cada curso, sus asignaturas.', 'El curso académico reúne las asignaturas de un año de la titulación.', `<div class="button-row">${button('import-json', 'Importar JSON', 'upload')}${button('import-canvas', 'CanvasManager', 'upload')}${button(canvasStatus.connected ? 'canvas-sync' : 'canvas-connect', canvasStatus.connected ? 'Actualizar Canvas' : 'Conectar Canvas', 'external', 'btn primary', canvasBusy ? 'disabled' : '')}</div>`) +
    (state.courses.length ? `<div class="list-toolbar"><span><strong>${groups.length}</strong> cursos académicos · ${state.courses.length} asignaturas</span><label class="search-input">${icon('search')}<input id="course-search" value="${esc(courseSearch)}" placeholder="Buscar curso o asignatura…" aria-label="Buscar cursos"></label></div><div class="academic-course-list" id="course-grid">${courseCards()}</div><div class="import-note">${icon('info')} El calendario de cada asignatura aporta las fechas y las horas. Canvas se actualiza al iniciar y cada 15 minutos.</div>` : emptyState('Tu primer curso empieza aquí', 'Conecta Canvas para organizar automáticamente tus cursos académicos y sus asignaturas.', button('demo', 'Explorar cursos de ejemplo', 'book')));
}
function subjectCard(c, index, groupId = '') {
  return `<article class="course-card"><div class="course-card-top"><span class="course-monogram color-${index % 3}">${icon('book')}</span><span class="tag ${c.isDemo ? 'amber' : ''}">${c.isDemo ? 'Ejemplo' : liveCourse(c) ? 'Canvas' : 'Local'}</span></div><span class="course-code">ASIGNATURA</span><h2>${esc(subjectName(c))}</h2><div class="course-metrics"><span>${icon('people')}${c.students.length} estudiantes</span><span>${icon('clock')}${deriveSessions(c).length} clases</span></div>${liveCourse(c) ? rosterNotice(c) : ''}<div class="course-card-actions">${button('compose-course', 'Correo de la asignatura', 'arrow', 'text-button', `data-id="${esc(c.id)}" data-academic-id="${esc(groupId)}"`)}${button('manage-course', 'Gestionar', null, 'btn compact', `data-id="${esc(c.id)}"`)}</div></article>`;
}
function courseCards() {
  const matches = value => value.toLowerCase().includes(courseSearch.toLowerCase());
  const groups = academicGroups();
  const sections = groups.map(group => {
    const members = subjectsForAcademicCourse(state.courses, group).filter(c => matches(group.name) || matches(`${subjectName(c)} ${c.code}`));
    if (!members.length) return '';
    return `<section class="academic-course-card panel"><header><div><span class="eyebrow">CURSO ACADÉMICO · ${esc(group.academicPeriod)}</span><h2>${esc(group.name)}</h2><p>${group.subjectIds.length} asignaturas · ${academicCourseStudents(state.courses, group).length} estudiantes</p></div>${button('compose-academic-course', 'Preparar resumen semanal', 'mail', 'btn primary', `data-id="${esc(group.id)}"`)}</header><div class="course-grid">${members.map((c, index) => subjectCard(c, index, group.id)).join('')}</div></section>`;
  }).filter(Boolean);
  const assigned = new Set(groups.flatMap(group => group.subjectIds));
  const unassigned = state.courses.filter(c => !assigned.has(c.id) && matches(`${c.name} ${c.subject} ${c.code}`));
  if (unassigned.length) sections.push(`<section class="academic-course-card panel"><header><div><span class="eyebrow">ASIGNATURAS</span><h2>Sin curso académico identificado</h2><p>Estas asignaturas no incluyen una titulación y un año identificables en sus datos.</p></div></header><div class="course-grid">${unassigned.map((c, index) => subjectCard(c, index)).join('')}</div></section>`);
  return sections.join('') || '<p class="muted">No hay cursos ni asignaturas que coincidan con tu búsqueda.</p>';
}
function templatesView() {
  return pageHeading('UN PUNTO DE PARTIDA, CADA VEZ', 'Tu voz. Tus plantillas.', 'Los detalles cambian. La forma de acompañar permanece.', button('new-template', 'Nueva plantilla', 'plus', 'btn primary')) + `<div class="template-grid">${state.templates.map((t, i) => `<article class="template-card"><div class="template-art art-${i % 3}"><div class="mini-document"><span></span><span></span><b>{{ asignatura }}</b><span></span><span></span></div><span class="template-art-icon">${icon(i % 3 === 0 ? 'clock' : i % 3 === 1 ? 'book' : 'mail')}</span></div><div class="template-content"><span class="eyebrow">${esc(t.category || 'PERSONALIZADA')}</span><h2>${esc(t.name)}</h2><p>${esc(t.description)}</p><div class="template-actions">${button('use-template', 'Usar plantilla', 'arrow', 'text-button', `data-id="${esc(t.id)}"`)}${button('edit-template', 'Editar', 'edit', 'btn compact', `data-id="${esc(t.id)}"`)}</div></div></article>`).join('')}</div><div class="token-guide">${icon('info')} Usa variables como <code>{{course_name}}</code>, <code>{{day}}</code> o <code>{{preparation}}</code>. Campus las sustituye con los datos de cada clase.</div>`;
}
function draftsView() {
  return pageHeading('RETOMA DONDE LO DEJASTE', 'Correos en preparación.', 'Borradores guardados en tu equipo, listos para cuando los necesites.', button('new-mail', 'Crear correo', 'plus', 'btn primary')) + (state.drafts.length ? `<div class="panel draft-list">${[...state.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(d => `<article class="draft-row"><span class="draft-icon">${icon('draft')}</span><div><h3>${esc(d.subject || 'Sin asunto')}</h3><p>${esc(d.courseName)} <span>·</span> ${new Date(d.updatedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</p></div><span class="tag">Local</span>${button('open-draft', 'Continuar', 'arrow', 'btn compact', `data-id="${esc(d.id)}"`)}${button('delete-draft', '', 'trash', 'icon-button', `data-id="${esc(d.id)}" aria-label="Eliminar borrador"`)}</article>`).join('')}</div>` : emptyState('Un espacio para tus próximos correos', 'Guarda un borrador desde el editor y vuelve a él cuando quieras.', button('nav', 'Preparar un correo', 'arrow', 'btn primary', 'data-view="compose"')));
}
function settingsView() {
  return pageHeading('A TU MANERA', 'Tu espacio de coordinación.', 'Los pequeños detalles que hacen que cada correo sea tuyo.') + `${appearancePanel()}${canvasSettingsPanel()}<div class="settings-layout"><section class="panel settings-panel"><div class="section-heading">${icon('people')}<h2>Tu perfil</h2></div><label class="field">Nombre del coordinador<input data-setting="name" value="${esc(state.settings.name)}" placeholder="Tu nombre"></label><label class="field">Tu dirección de correo<input type="email" data-setting="email" value="${esc(state.settings.email)}" placeholder="coordinacion@universidad.edu"></label><p class="field-help">Esta dirección aparecerá en «Para». Los estudiantes irán en CCO.</p><label class="field">Firma de tus correos<textarea data-setting="signature" rows="5">${esc(state.settings.signature)}</textarea></label><span class="save-status" id="save-status"></span></section><section class="panel privacy-panel"><span class="large-icon">${icon('shield')}</span><h2>Local por principio.</h2><p>El contenido de tus cursos, las direcciones de estudiantes, las plantillas y los borradores se guardan en este ordenador.</p><p>Al pulsar «Abrir borrador en Gmail», se comparten con Gmail el correo preparado y sus destinatarios. El envío lo haces tú, desde Gmail.</p><div class="data-location"><strong>Ubicación de tus datos</strong><code>${esc(info.dataPath || 'Carpeta de datos de Campus Coordinator')}</code></div><p class="small muted">Canvas se consulta solo para leer tus datos. No se modifican cursos ni se envían correos automáticamente.</p></section></div>`;
}

function showModal(title, content, actions = '', wide = false) {
  lastFocus = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${title}</h2>${button('close-modal', '', 'close', 'icon-button', 'aria-label="Cerrar"')}</header><div class="modal-content">${content}</div>${actions ? `<footer>${actions}</footer>` : ''}</section></div>`;
  $('#app').inert = true;
  requestAnimationFrame(() => $('.modal input, .modal textarea, .modal button')?.focus());
}
function closeModal() { $('#modal-root').innerHTML = ''; $('#app').inert = false; activeModal = null; lastFocus?.focus(); }
function recipientsModal() {
  activeModal = { type: 'recipients' }; recipientSearch = '';
  showModal('Elegir destinatarios', `<p class="modal-intro">Todos los seleccionados irán en <strong>CCO</strong>. Solo tu dirección aparecerá en «Para».</p><label class="search-input">${icon('search')}<input id="recipient-search" placeholder="Buscar por nombre o correo" aria-label="Buscar estudiantes"></label><div class="selection-toolbar"><span id="selection-label"></span><div>${button('select-all', 'Todos', null, 'text-button')}${button('select-none', 'Ninguno', null, 'text-button')}</div></div><div id="student-list" class="student-list"></div>`, button('close-modal', 'Listo', 'check', 'btn primary'));
  renderStudents();
}
function renderStudents() {
  if (!$('#student-list')) return;
  const students = recipientRoster().filter(s => `${s.name} ${s.email}`.toLowerCase().includes(recipientSearch.toLowerCase()));
  $('#selection-label').textContent = `${selectedStudents().length} seleccionados`;
  $('#student-list').innerHTML = students.length ? students.map(s => `<label class="student-row"><input type="checkbox" data-student-id="${esc(s.id)}" ${!isValidEmail(s.email) ? 'disabled' : ''} ${state.composer.selectedStudentIds.includes(s.id) ? 'checked' : ''}><span class="student-avatar">${esc(s.name?.slice(0, 1) || '@')}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.email || 'Canvas no permite ver su correo')}</small></span></label>`).join('') : '<p class="muted empty-list">No hay estudiantes para mostrar.</p>';
}
function templateModal(id) {
  const t = state.templates.find(t => t.id === id) || { id: uid(), name: '', description: '', category: 'Personalizada', subject: '', body: '' };
  activeModal = { type: 'template', id: t.id, isNew: !id };
  showModal(id ? 'Editar plantilla' : 'Crear una plantilla', `<div class="two-fields"><label class="field">Nombre<input id="tpl-name" value="${esc(t.name)}" placeholder="Ej. Recordatorio de clase"></label><label class="field">Categoría<input id="tpl-category" value="${esc(t.category)}"></label></div><label class="field">Tipo de correo<select id="tpl-kind"><option value="single" ${t.kind !== 'weekly' ? 'selected' : ''}>Correo de una clase</option><option value="weekly" ${t.kind === 'weekly' ? 'selected' : ''}>Resumen semanal con varias asignaturas</option></select></label><label class="field">Descripción<input id="tpl-description" value="${esc(t.description)}"></label><label class="field">Asunto<input id="tpl-subject" data-token-target value="${esc(t.subject)}"></label><label class="field">Mensaje<textarea id="tpl-body" data-token-target rows="11">${esc(t.body)}</textarea></label><p class="small muted">Inserta una variable en el asunto o el mensaje. «Clases y trabajo de la semana» reúne los apartados del resumen:</p><div class="token-list">${VARIABLES.map(v => button('insert-token', esc(v.label), null, 'token', `data-token="${esc(v.key)}" title="{{${esc(v.key)}}}"`)).join('')}</div>`, `${id && state.templates.length > 1 ? button('delete-template', 'Eliminar', 'trash', 'btn danger') : ''}<span class="spacer"></span>${button('close-modal', 'Cancelar')}${button('save-template', 'Guardar plantilla', 'check', 'btn primary')}`, true);
}
let tokenTarget = null;
function editMailModal() {
  const t = template(); activeModal = { type: 'edit-mail' };
  showModal('Ajustar este correo', `<p class="modal-intro">Estos cambios se aplican a este correo. Las variables se seguirán completando con los datos de la clase.</p><label class="field">Asunto<input id="mail-subject" value="${esc(state.composer.customSubject ?? t.subject)}"></label><label class="field">Mensaje<textarea id="mail-body" rows="14">${esc(state.composer.customBody ?? t.body)}</textarea></label>`, `${button('reset-mail', 'Restaurar plantilla', null, 'text-button')}<span class="spacer"></span>${button('apply-mail', 'Aplicar cambios', 'check', 'btn primary')}`, true);
}
function courseModal(id) {
  const c = state.courses.find(c => c.id === id);
  activeModal = { type: 'course', id };
  if (liveCourse(c)) {
    showModal('Asignatura de Canvas', `<p class="modal-intro"><strong>${esc(c.name)}</strong><br>${esc(c.code)} · ${esc(c.source.baseUrl)}</p><p>Los estudiantes, la estructura y el calendario de esta asignatura se actualizan directamente desde Canvas.</p>${rosterNotice(c)}<div class="roster-list">${c.students.map(s => `<div class="roster-row"><span><strong>${esc(s.name)}</strong><small>${esc(s.email || 'Canvas no permite ver su correo')}</small></span></div>`).join('')}</div><div class="course-source">${c.modules.length} módulos · ${deriveSessions(c).length} clases síncronas ${button('show-structure', 'Ver estructura', 'arrow', 'text-button', `data-id="${esc(id)}"`)}</div>`, button('close-modal', 'Cerrar'), true);
    return;
  }
  showModal(c ? 'Gestionar curso' : 'Añadir un curso', `<div class="two-fields"><label class="field">Curso o programa<input id="edit-course-name" value="${esc(c?.name || '')}" placeholder="Ej. Grado en Filosofía"></label><label class="field">Código<input id="edit-course-code" value="${esc(c?.code || '')}" placeholder="Ej. FIL-201"></label></div><label class="field">Asignatura<input id="edit-course-subject" value="${esc(c?.subject || '')}" placeholder="Ej. Ética"></label>${c ? `<div class="roster-header"><h3>Estudiantes <span class="tag">${c.students.length}</span></h3>${button('import-students', 'Importar CSV', 'upload', 'btn compact', `data-id="${esc(id)}"`)}</div><p class="small muted">CSV con columnas nombre y email. Se añaden estudiantes sin duplicar correos.</p><div class="add-student-row"><input id="new-student-name" aria-label="Nombre del estudiante" placeholder="Nombre"><input id="new-student-email" type="email" aria-label="Correo del estudiante" placeholder="Correo electrónico">${button('add-student', '', 'plus', 'btn', 'aria-label="Añadir estudiante"')}</div><div class="roster-list">${c.students.map(s => `<div class="roster-row"><span><strong>${esc(s.name)}</strong><small>${esc(s.email)}</small></span>${button('remove-student', '', 'trash', 'icon-button', `data-student="${esc(s.id)}" aria-label="Eliminar a ${esc(s.name)}"`)}</div>`).join('') || '<p class="empty-list muted">Este curso todavía no tiene estudiantes.</p>'}</div><div class="course-source">${c.modules.length} módulos locales · ${deriveSessions(c).length} clases síncronas detectadas ${button('show-structure', 'Ver estructura', 'arrow', 'text-button', `data-id="${esc(id)}"`)}</div>` : ''}`, `${c ? button('delete-course', 'Eliminar curso', 'trash', 'btn danger', `data-id="${esc(id)}"`) : ''}<span class="spacer"></span>${button('save-course', 'Guardar curso', 'check', 'btn primary')}`, true);
}
function structureModal(id) {
  const c = state.courses.find(c => c.id === id) || course();
  if (!c) return;
  const liveIds = new Set(deriveSessions(c).map(s => s.moduleId));
  activeModal = { type: 'structure' };
  showModal('La estructura de tu asignatura', `<p class="modal-intro">${esc(subjectName(c))} · El orden de Canvas determina qué material precede a cada clase.</p><div class="module-list">${c.modules.map(m => `<div class="module-item ${liveIds.has(m.id) ? 'live' : ''}"><div>${icon(liveIds.has(m.id) ? 'people' : 'book')}<strong>${esc(m.name)}</strong>${liveIds.has(m.id) ? '<span class="tag">Síncrona</span>' : ''}</div><ul>${m.items.map(i => `<li>${esc(i.title)}</li>`).join('')}</ul></div>`).join('') || '<p>No hay módulos importados. Introduce la preparación manualmente o importa la estructura de Canvas.</p>'}</div>`, button('close-modal', 'Cerrar'), true);
}

function mergeCourses(incoming, { authoritativeCanvas = false } = {}) {
  const oldRecipients = recipientRoster();
  const oldCourse = course(), oldSession = oldCourse ? deriveSessions(oldCourse).find(s => s.id === state.composer.sessionId) : null;
  for (const item of incoming) {
    const index = state.courses.findIndex(c => c.id === item.id);
    if (index >= 0) {
      const existing = state.courses[index];
      if (authoritativeCanvas && liveCourse(item)) {
        state.courses[index] = mergeCanvasCourse(existing, item);
        continue;
      }
      const students = new Map(existing.students.map(s => [s.email.toLowerCase(), s]));
      for (const s of item.students || []) if (!students.has(s.email.toLowerCase())) students.set(s.email.toLowerCase(), s);
      const hasStructure = item.hasStructure ?? !!item.modules?.length;
      state.courses[index] = { ...existing, ...item, students: [...students.values()], modules: hasStructure ? item.modules : existing.modules, pages: hasStructure ? item.pages : existing.pages };
    } else state.courses.push(item);
  }
  if (!course()) freshComposer();
  ensureAcademicSelection();
  if (authoritativeCanvas && oldCourse?.id === course()?.id) state.composer.selectedStudentIds = reconcileCanvasRecipients({ students: oldRecipients }, { students: recipientRoster() }, state.composer.selectedStudentIds, state.composer.recipientMode);
  if (!isWeekly() && oldCourse && incoming.some(c => c.id === oldCourse.id)) {
    const current = course(), nextSession = deriveSessions(current).find(s => s.id === state.composer.sessionId);
    const hasEvent = state.composer.calendarEventId && calendarEntries(current).some(entry => entry.sourceEventId === state.composer.calendarEventId);
    if (state.composer.calendarEventId ? hasEvent : nextSession) {
      const previousFields = state.composer.canvasValues || canvasSessionFields(oldCourse, oldSession?.id || '', state.composer.calendarEventId);
      const nextFields = canvasSessionFields(current, nextSession?.id || '', state.composer.calendarEventId);
      for (const key of Object.keys(nextFields)) if (state.composer.fields[key] === (previousFields[key] || '')) state.composer.fields[key] = nextFields[key] || '';
      state.composer.canvasValues = nextFields;
      state.composer.canvasNotice = 'Estructura de Canvas actualizada. Se han conservado los detalles que modificaste manualmente; revísalos antes de abrir Gmail.';
    } else state.composer.canvasNotice = 'La clase seleccionada ya no aparece en Canvas. Se conservan tus datos; elige otra clase o revísalos manualmente.';
  }
  scheduleSave(); render();
}
async function importCanvas() {
  toast('Selecciona la carpeta de caché de CanvasManager.');
  const result = await api.importCanvas();
  if (!result) return;
  mergeCourses(result.courses);
  toast(`${result.courses.length} ${result.courses.length === 1 ? 'asignatura importada' : 'asignaturas importadas'} en este equipo.`);
  if (result.warnings?.length) showModal('Importación completada con avisos', `<ul>${result.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`, button('close-modal', 'Entendido'));
}
function chooseFile(task, accept) { fileTask = task; const input = $('#file-input'); input.accept = accept; input.value = ''; input.click(); }
async function handleFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande. El máximo es 20 MB.');
  const text = await file.text();
  if (fileTask.type === 'courses') {
    const courses = normalizeCourses(JSON.parse(text));
    if (!courses.length) throw new Error('No se encontraron cursos en este JSON. Usa un archivo con courses o con un curso y sus modules.');
    mergeCourses(courses); toast(`${courses.length} ${courses.length === 1 ? 'asignatura importada' : 'asignaturas importadas'}.`);
  } else {
    const c = state.courses.find(c => c.id === fileTask.id); if (!c) return;
    const parsed = parseStudentCsv(text);
    const existing = new Set(c.students.map(s => s.email.toLowerCase()));
    let added = 0;
    for (const student of parsed.students) if (!existing.has(student.email.toLowerCase())) { c.students.push({ ...student, id: uid() }); existing.add(student.email.toLowerCase()); added++; }
    if (course()?.id === c.id) {
      // Newly imported students are deliberately unselected until reviewed.
      state.composer.selectedStudentIds = state.composer.selectedStudentIds.filter(id => c.students.some(s => s.id === id));
    }
    scheduleSave(); render(); courseModal(c.id);
    toast(`${added} estudiantes añadidos.${parsed.warnings.length ? ` ${parsed.warnings.length} avisos en el archivo.` : ''}`);
    if (parsed.warnings.length) { const p = document.createElement('div'); p.className = 'notice'; p.textContent = parsed.warnings.join('\n'); $('.roster-header').before(p); }
  }
}

const actions = {
  'toggle-theme'() { chooseTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); },
  'choose-theme'(el) { chooseTheme(el.dataset.themeChoice); },
  nav(el) { view = el.dataset.view; closeModal(); render(); window.scrollTo(0, 0); },
  'close-modal': closeModal,
  'canvas-connect': canvasConnectionModal,
  'canvas-login': connectCanvas,
  'canvas-sync'() { return syncCanvas(); },
  async 'canvas-disconnect'() {
    canvasStatus = await api.canvasDisconnect(); closeModal(); render();
    toast('Canvas desconectado. Tus cursos y borradores siguen disponibles en este equipo.');
  },
  'canvas-warnings'() {
    activeModal = { type: 'canvas-warnings' };
    const warnings = [...new Set([...(state.canvasLastSync?.warnings || []), ...(canvasStatus.error ? [canvasStatus.error] : [])])];
    showModal('Avisos de Canvas', warnings.map(message => `<p class="notice">${esc(message)}</p>`).join('') || '<p>Todos los datos disponibles se han actualizado.</p>', button('close-modal', 'Cerrar'), true);
  },
  async 'canvas-fill-week'() {
    const plan = state.composer.weeklyPlan;
    validateWeekRange(plan.startDate, plan.endDate);
    if (canvasStatus.connected || canvasStatus.mode) await syncCanvas();
    else { applyCanvasPlan(); scheduleSave(); render(); toast('Semana preparada con la última copia local de Canvas.'); }
  },
  'shift-week'(el) {
    return chooseCanvasWeek(shiftCanvasWeek(canvasWeekInput(state.composer.weeklyPlan.startDate), Number(el.dataset.direction)));
  },
  demo() {
    const demo = createDemoCourses(); mergeCourses(demo);
    if (!course() || !course().isDemo) freshComposer(demo[0]);
    view = 'compose'; scheduleSave(); render(); toast('Cursos de ejemplo añadidos. No contienen estudiantes reales.');
  },
  'import-canvas': importCanvas,
  'import-json'() { chooseFile({ type: 'courses' }, '.json,application/json'); },
  'import-students'(el) { preserveCourseEdits(); chooseFile({ type: 'students', id: el.dataset.id }, '.csv,text/csv'); },
  'add-course'() { courseModal(); },
  'manage-course'(el) { courseModal(el.dataset.id); },
  'compose-course'(el) { freshComposer(state.courses.find(c => c.id === el.dataset.id), state.templates.find(t => t.kind !== 'weekly'), el.dataset.academicId); view = 'compose'; scheduleSave(); render(); },
  'compose-academic-course'(el) {
    const group = academicGroups().find(group => group.id === el.dataset.id);
    if (!group) return;
    const target = state.templates.find(t => t.kind === 'weekly') || weeklyTemplate();
    if (!state.templates.some(t => t.id === target.id)) state.templates.push(target);
    freshComposer(subjectsForAcademicCourse(state.courses, group)[0], target, group.id);
    view = 'compose'; scheduleSave(); render();
  },
  'new-mail'() { freshComposer(); view = 'compose'; scheduleSave(); render(); },
  'compose-mode'(el) {
    const weekly = el.dataset.mode === 'weekly';
    if (weekly === isWeekly()) return;
    let target = state.templates.find(t => weekly ? t.kind === 'weekly' : t.kind !== 'weekly');
    if (!target) { target = weekly ? weeklyTemplate() : createInitialState().templates[0]; state.templates.push(target); }
    chooseTemplate(target.id); scheduleSave(); render();
  },
  'add-weekly-entry'() { state.composer.weeklyEntries.push(createWeeklyEntry()); scheduleSave(); render(); },
  'remove-weekly-entry'(el) {
    if (state.composer.weeklyPlan) state.composer.weeklyPlan.suppressed = [...new Set([...(state.composer.weeklyPlan.suppressed || []), el.dataset.id])];
    state.composer.weeklyEntries = state.composer.weeklyEntries.filter(e => e.id !== el.dataset.id); scheduleSave(); render();
  },
  'move-weekly-entry'(el) {
    const entries = state.composer.weeklyEntries, index = entries.findIndex(e => e.id === el.dataset.id), next = index + Number(el.dataset.direction);
    if (index < 0 || next < 0 || next >= entries.length) return;
    [entries[index], entries[next]] = [entries[next], entries[index]]; scheduleSave(); render();
  },
  'refresh-weekly-entry'(el) {
    const entry = state.composer.weeklyEntries.find(e => e.id === el.dataset.id);
    const next = currentWeeklyPreparation(entry);
    Object.assign(entry, { preparation: next.preparation || '', preparationMode: next.preparation ? 'canvas' : 'none', evidence: next.evidence || '' }); scheduleSave(); render();
  },
  'show-structure'(el) { structureModal(el.dataset.id); },
  recipients: recipientsModal,
  'select-all'() { state.composer.recipientMode = recipientSearch ? 'custom' : 'all'; const list = recipientRoster().filter(s => isValidEmail(s.email) && `${s.name} ${s.email}`.toLowerCase().includes(recipientSearch.toLowerCase())); state.composer.selectedStudentIds = [...new Set([...state.composer.selectedStudentIds, ...list.map(s => s.id)])]; scheduleSave(); renderStudents(); updatePreview(); },
  'select-none'() { state.composer.recipientMode = 'custom'; const list = new Set(recipientRoster().filter(s => `${s.name} ${s.email}`.toLowerCase().includes(recipientSearch.toLowerCase())).map(s => s.id)); state.composer.selectedStudentIds = state.composer.selectedStudentIds.filter(id => !list.has(id)); scheduleSave(); renderStudents(); updatePreview(); },
  'edit-mail': editMailModal,
  'apply-mail'() { state.composer.customSubject = $('#mail-subject').value; state.composer.customBody = $('#mail-body').value; closeModal(); scheduleSave(); updatePreview(); },
  'reset-mail'() { state.composer.customSubject = null; state.composer.customBody = null; closeModal(); scheduleSave(); updatePreview(); },
  async 'copy-mail'() { const mail = resolvedMail(); const text = `Para: ${state.settings.email}\nCCO: ${selectedStudents().map(s => s.email).join(', ')}\nAsunto: ${mail.subject}\n\n${mail.body}`; if (api.copyText) await api.copyText(text); else await navigator.clipboard.writeText(text); toast('Correo copiado con las direcciones en CCO.'); },
  async gmail() {
    if (canvasBusy) throw new Error('Espera a que termine la actualización de Canvas.');
    const mail = resolvedMail();
    if (mail.missing.length) throw new Error('Completa las variables pendientes antes de abrir Gmail.');
    if (!mail.subject.trim() || !mail.body.trim()) throw new Error('Añade el asunto y el mensaje.');
    const errors = [...composerDateErrors(), ...(isWeekly() ? weeklyErrors() : [])];
    if (calendarSelectionError()) errors.push(calendarSelectionError());
    if (state.composer.academicSelectionError) errors.push(state.composer.academicSelectionError);
    if (!isWeekly() && liveCourse(course()) && course().preparationComplete === false && state.composer.sessionId) errors.push('La estructura de Canvas está incompleta. Actualiza Canvas antes de usar la preparación de esta clase.');
    if (errors.length) throw new Error(errors.join(' '));
    const result = await api.openGmail({ to: state.settings.email, bcc: selectedStudents().map(s => s.email), subject: mail.subject, body: mail.body });
    if (result?.ok) toast('Gmail abierto con el correo preparado. Revisa el borrador allí.');
  },
  async 'save-draft'() {
    const mail = resolvedMail(), id = state.composer.draftId || uid(); state.composer.draftId = id;
    const snapshot = structuredClone(state.composer);
    snapshot.customSubject = snapshot.customSubject ?? template()?.subject ?? '';
    snapshot.customBody = snapshot.customBody ?? template()?.body ?? '';
    const item = { id, subject: mail.subject, courseName: academicCourse()?.name || state.composer.fields.course_name || subjectName(course()), updatedAt: new Date().toISOString(), composer: snapshot };
    const index = state.drafts.findIndex(d => d.id === id); if (index >= 0) state.drafts[index] = item; else state.drafts.push(item);
    await saveNow(); render(); toast('Borrador guardado en este equipo.');
  },
  'open-draft'(el) {
    const d = state.drafts.find(d => d.id === el.dataset.id);
    if (!state.courses.some(c => c.id === d.composer.courseId)) throw new Error('El curso de este borrador ya no está disponible. Vuelve a importarlo para continuar.');
    state.composer = structuredClone(d.composer);
    state.composer.recipientMode = 'custom';
    ensureAcademicSelection();
    state.composer.selectedStudentIds = state.composer.selectedStudentIds.filter(id => recipientRoster().some(s => s.id === id));
    view = 'compose'; scheduleSave(); render();
  },
  'delete-draft'(el) { confirmDelete('Eliminar borrador', 'Se eliminará este borrador guardado en el equipo.', () => { state.drafts = state.drafts.filter(d => d.id !== el.dataset.id); if (state.composer.draftId === el.dataset.id) state.composer.draftId = null; scheduleSave(); render(); }); },
  'new-template'() { templateModal(); },
  'edit-template'(el) { tokenTarget = null; templateModal(el.dataset.id); },
  'use-template'(el) { chooseTemplate(el.dataset.id); view = 'compose'; scheduleSave(); render(); },
  'insert-token'(el) {
    const target = tokenTarget && document.contains(tokenTarget) ? tokenTarget : $('#tpl-body');
    const from = target.selectionStart ?? target.value.length, to = target.selectionEnd ?? from;
    target.setRangeText(`{{${el.dataset.token}}}`, from, to, 'end'); target.focus();
  },
  'save-template'() {
    const value = { id: activeModal.id, name: $('#tpl-name').value.trim(), kind: $('#tpl-kind').value, description: $('#tpl-description').value.trim(), category: $('#tpl-category').value.trim(), subject: $('#tpl-subject').value, body: $('#tpl-body').value, updatedAt: new Date().toISOString() };
    if (!value.name || !value.subject.trim() || !value.body.trim()) throw new Error('Escribe el nombre, el asunto y el mensaje de la plantilla.');
    const unknown = resolveTemplate(`${value.subject}\n${value.body}`, {}).missing.filter(key => !VARIABLES.some(v => v.key === key));
    if (unknown.length) throw new Error(`Variables desconocidas: ${unknown.join(', ')}. Usa las variables de los botones del editor.`);
    const index = state.templates.findIndex(t => t.id === value.id); if (index >= 0) state.templates[index] = value; else state.templates.push(value);
    if (state.composer.templateId === value.id && !state.composer.draftId) { state.composer.kind = value.kind; ensureWeeklyFields(); }
    closeModal(); scheduleSave(); render(); toast('Plantilla guardada.');
  },
  'delete-template'() {
    const id = activeModal.id;
    if (state.drafts.some(d => d.composer.templateId === id)) throw new Error('Esta plantilla se usa en un borrador. Elimina esos borradores antes de eliminarla.');
    confirmDelete('Eliminar plantilla', 'Se eliminará esta plantilla de tu biblioteca.', () => { state.templates = state.templates.filter(t => t.id !== id); if (state.composer.templateId === id) chooseTemplate(state.templates[0].id); scheduleSave(); render(); });
  },
  'save-course'() {
    const name = $('#edit-course-name').value.trim(), subject = $('#edit-course-subject').value.trim(), code = $('#edit-course-code').value.trim();
    if (!name) throw new Error('Escribe un nombre para el curso.');
    const c = state.courses.find(c => c.id === activeModal.id);
    if (c) Object.assign(c, { name, subject, code });
    else { state.courses.push({ id: uid(), name, subject, code, students: [], modules: [] }); if (!course()) freshComposer(); }
    closeModal(); scheduleSave(); render(); toast('Curso guardado.');
  },
  'add-student'() {
    const name = $('#new-student-name').value.trim(), email = $('#new-student-email').value.trim();
    if (!name) throw new Error('Escribe el nombre del estudiante.');
    // Use the same recipient validation as the Gmail handoff.
    buildGmailUrl({ to: 'validation@example.com', bcc: [email], subject: 'Validar', body: 'Validar' });
    const c = state.courses.find(c => c.id === activeModal.id);
    if (c.students.some(s => s.email.toLowerCase() === email.toLowerCase())) throw new Error('Este correo ya está en el curso.');
    preserveCourseEdits(); c.students.push({ id: uid(), name, email }); scheduleSave(); render(); courseModal(c.id); toast('Estudiante añadido. Selecciónalo al preparar el correo.');
  },
  'remove-student'(el) { const c = state.courses.find(c => c.id === activeModal.id); preserveCourseEdits(); c.students = c.students.filter(s => s.id !== el.dataset.student); state.composer.selectedStudentIds = state.composer.selectedStudentIds.filter(id => id !== el.dataset.student); scheduleSave(); render(); courseModal(c.id); },
  'delete-course'(el) { confirmDelete('Eliminar curso', 'Se eliminará la copia local del curso y su lista de estudiantes. Los datos de Canvas no cambian y reaparecerán en la próxima sincronización. Los borradores guardados permanecerán.', () => { state.courses = state.courses.filter(c => c.id !== el.dataset.id); if (!course()) freshComposer(); scheduleSave(); render(); }); },
};
function preserveCourseEdits() {
  if (activeModal?.type !== 'course') return;
  const c = state.courses.find(c => c.id === activeModal.id);
  if (c) { c.name = $('#edit-course-name').value.trim() || c.name; c.subject = $('#edit-course-subject').value.trim(); c.code = $('#edit-course-code').value.trim(); }
}
function confirmDelete(title, message, callback) {
  activeModal = { type: 'confirm', callback };
  showModal(title, `<p>${esc(message)}</p>`, `${button('close-modal', 'Cancelar')}${button('confirm-delete', 'Eliminar', 'trash', 'btn danger')}`);
}
actions['confirm-delete'] = () => { const callback = activeModal.callback; closeModal(); callback(); };

document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el) return;
  event.preventDefault();
  if (el.disabled) return;
  try { await actions[el.dataset.action]?.(el); } catch (err) { toast(err.message || 'No se pudo completar la operación.', true); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.field) { state.composer.fields[el.dataset.field] = el.value; scheduleSave(); updatePreview(); }
  if (el.dataset.weeklyField) {
    const entry = state.composer.weeklyEntries.find(e => e.id === el.dataset.entry);
    entry.generated = false;
    entry[el.dataset.weeklyField] = el.value;
    if (el.dataset.weeklyField === 'preparation') { entry.preparationMode = 'manual'; el.closest('.weekly-entry').querySelector('[data-weekly-select="preparationMode"]').value = 'manual'; }
    scheduleSave(); updatePreview();
  }
  if (el.dataset.setting) { state.settings[el.dataset.setting] = el.value; scheduleSave(); }
  if (el.id === 'recipient-search') { recipientSearch = el.value; renderStudents(); }
  if (el.id === 'course-search') { courseSearch = el.value; $('#course-grid').innerHTML = courseCards(); }
});
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.id === 'week-select') {
    if (!el.value) return;
    try { await chooseCanvasWeek(el.value); } catch (error) { toast(error.message, true); }
    return;
  }
  if (el.id === 'academic-course-select') {
    const group = academicGroups().find(group => group.id === el.value);
    const next = group ? subjectsForAcademicCourse(state.courses, group)[0] : state.courses.find(subject => !groupForSubject(subject));
    const period = state.composer.weeklyPlan;
    freshComposer(next, template(), group?.id);
    if (isWeekly() && period && state.composer.weeklyPlan) {
      Object.assign(state.composer.weeklyPlan, { startDate: period.startDate, endDate: period.endDate });
      fillWeekDates(); applyCanvasPlan();
    }
    scheduleSave(); render();
  }
  if (el.dataset.weekRange) {
    const plan = state.composer.weeklyPlan;
    try {
      const next = { ...plan, [el.dataset.weekRange]: el.value };
      validateWeekRange(next.startDate, next.endDate);
      Object.assign(plan, next);
      fillWeekDates(); applyCanvasPlan(); scheduleSave(); render();
      if (canvasStatus.connected) await syncCanvas({ notify: false });
    } catch (error) { el.value = plan[el.dataset.weekRange]; toast(error.message, true); }
  }
  if (el.dataset.weekCourse) {
    const plan = state.composer.weeklyPlan, ids = new Set(plan.courseIds);
    el.checked ? ids.add(el.dataset.weekCourse) : ids.delete(el.dataset.weekCourse);
    plan.courseIds = [...ids]; plan.subjectSelection = 'custom'; applyCanvasPlan(); scheduleSave(); render();
  }
  if (el.dataset.setting === 'timeZone') {
    if (isWeekly()) applyCanvasPlan();
    else if (course() && state.composer.canvasValues && !calendarSelectionError()) {
      const fields = canvasSessionFields(course(), state.composer.sessionId, state.composer.calendarEventId);
      for (const key of ['day', 'month', 'year', 'time', 'end_time']) {
        if (state.composer.fields[key] === state.composer.canvasValues[key]) state.composer.fields[key] = fields[key];
        state.composer.canvasValues[key] = fields[key];
      }
    }
    scheduleSave();
  }
  if (el.id === 'course-select') {
    const next = state.courses.find(c => c.id === el.value);
    if (isWeekly()) {
      const previous = course(); state.composer.courseId = next.id;
      state.composer.selectedStudentIds = next.students.filter(s => isValidEmail(s.email)).map(s => s.id);
      state.composer.recipientMode = 'all';
      if (!state.composer.fields.course_name || state.composer.fields.course_name === previous?.name) state.composer.fields.course_name = next.name;
      if (liveCourse(next) && state.composer.weeklyPlan) {
        state.composer.weeklyPlan.courseIds = academicCourse()?.subjectIds || [next.id];
        state.composer.weeklyPlan.subjectSelection = 'all';
        state.composer.weeklyPlan.suppressed = [];
        applyCanvasPlan();
      }
    } else freshComposer(next, template(), state.composer.academicCourseId);
    scheduleSave(); render();
  }
  if (el.id === 'template-select') { chooseTemplate(el.value); scheduleSave(); render(); }
  if (el.id === 'session-select') { chooseSession(el.value); scheduleSave(); render(); }
  if (el.dataset.weeklySelect) {
    const entry = state.composer.weeklyEntries.find(e => e.id === el.dataset.entry);
    entry.generated = false;
    const source = state.courses.find(c => c.id === entry.courseId);
    if (el.dataset.weeklySelect === 'course') {
      const nextSource = state.courses.find(c => c.id === el.value);
      const next = createWeeklyEntry(nextSource);
      if (entry.sourceEventId && state.composer.weeklyPlan) state.composer.weeklyPlan.suppressed = [...new Set([...(state.composer.weeklyPlan.suppressed || []), entry.id])];
      const notes = entry.notes;
      for (const key of Object.keys(entry)) delete entry[key];
      Object.assign(entry, next, { notes });
    } else if (el.dataset.weeklySelect === 'session') {
      const previous = createWeeklyEntry(source, entry.sessionId), next = createWeeklyEntry(source, el.value);
      const event = !entry.event || entry.event === previous.event ? next.event : entry.event;
      Object.assign(entry, { sessionId: next.sessionId, event, preparation: next.preparation, preparationMode: next.preparationMode, evidence: next.evidence });
    } else if (el.dataset.weeklySelect === 'preparationMode') {
      entry.preparationMode = el.value;
      if (el.value === 'canvas') { const next = currentWeeklyPreparation(entry); entry.preparation = next.preparation || ''; entry.evidence = next.evidence || ''; }
    }
    scheduleSave(); render();
  }
  if (el.dataset.studentId) { state.composer.recipientMode = 'custom'; const set = new Set(state.composer.selectedStudentIds); el.checked ? set.add(el.dataset.studentId) : set.delete(el.dataset.studentId); state.composer.selectedStudentIds = [...set]; scheduleSave(); $('#selection-label').textContent = `${selectedStudents().length} seleccionados`; updatePreview(); }
  if (el.id === 'file-input') { try { await handleFile(el.files[0]); } catch (err) { toast(err.message, true); } }
});
document.addEventListener('toggle', event => {
  if (!event.target.isConnected) return;
  if (event.target.id === 'weekly-customization') weeklyCustomizationOpen = event.target.open;
  if (event.target.id === 'week-range-options') weekRangeOpen = event.target.open;
  if (event.target.classList.contains('week-sources')) weekSourcesOpen = event.target.open;
}, true);
document.addEventListener('focusin', event => { if (event.target.hasAttribute('data-token-target')) tokenTarget = event.target; });
document.addEventListener('keydown', event => {
  if (!$('.modal')) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') {
    const items = [...$('.modal').querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(el => !el.disabled && el.offsetParent);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('beforeunload', event => {
  if (!window.coordinator && revision !== savedRevision && !loadingFailed) {
    // A JSON beacon keeps pending browser-preview edits alive during a reload.
    navigator.sendBeacon('/api/state', new Blob([JSON.stringify(state)], { type: 'application/json' }));
  }
  if (saveFailed) { event.preventDefault(); event.returnValue = ''; }
});

async function init() {
  try {
    const saved = await api.load(), details = await api.info();
    const upgrade = upgradeWorkspace(saved || createInitialState());
    info = details || {}; state = upgrade.state;
    window.campusTheme.apply(state.settings.theme || 'system');
    if (state.composer && !state.courses.some(c => c.id === state.composer.courseId)) freshComposer();
    if (!state.composer) freshComposer();
    render();
    if (upgrade.changed) await saveNow();
    api.onBeforeClose?.(async () => { try { await saveNow(); return true; } catch { return false; } });
    if (info.recoveryNotice) toast(info.recoveryNotice, true);
    initializeCanvas().catch(error => toast(error.message, true));
  } catch (err) {
    loadingFailed = true;
    $('#app').innerHTML = `<div class="startup-error">${icon('info')}<h1>Los datos locales necesitan atención.</h1><p>${esc(err.message)}</p><p>No se han sobrescrito tus archivos.</p><button class="btn" id="reload">Volver a intentar</button></div>`;
    $('#reload').addEventListener('click', () => location.reload());
  }
}
init();
