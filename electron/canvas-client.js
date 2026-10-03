import { normalizeCourses, isValidEmail } from '../src/domain.js';
import { subjectName, subjectAcademicMemberships } from '../src/academic.js';

const DEFAULT_BASE = 'https://hesperides.instructure.com';
const DAY = 24 * 60 * 60 * 1000;
const text = value => value == null ? '' : String(value).trim();
const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function isNamedLesson(module) {
  if (module.published === false) return false;
  const name = fold(module.name);
  if (/\b(?:asincron[ao]s?|asincronic[ao]s?|asynchronous)\b/.test(name)) return true;
  if (/\b(?:sincron[ao]s?|sincronic[ao]s?|synchronous|live session|live class)\b/.test(name) || /^\s*⚪/.test(text(module.name))) return false;
  return /\b(?:sesion|session|lesson)\s+\d+\b/.test(name);
}

export class CanvasError extends Error {
  constructor(message, { code = 'CANVAS_ERROR', status, kind = code.toLowerCase() } = {}) {
    super(message);
    this.name = 'CanvasError';
    this.code = code;
    this.kind = kind;
    if (status != null) this.status = status;
  }
}

export function normalizeCanvasBase(input = '') {
  if (typeof input !== 'string') throw new CanvasError('Introduce el dominio HTTPS de Canvas.', { code: 'INVALID_BASE' });
  const raw = input.trim() || DEFAULT_BASE;
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`); } catch { /* validated below */ }
  if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      !/^\/*$/.test(url.pathname) || url.search || url.hash) {
    throw new CanvasError('Introduce solo el dominio HTTPS de Canvas, sin rutas ni credenciales.', { code: 'INVALID_BASE' });
  }
  return url.origin;
}

function aborted() { return new CanvasError('La sincronización se ha cancelado.', { code: 'ABORTED', kind: 'aborted' }); }
function checkSignal(signal) { if (signal?.aborted) throw aborted(); }
function pause(ms, signal) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(aborted()); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
const fatal = error => error?.status === 401 || ['AUTH_REQUIRED', 'ABORTED', 'UNSAFE_URL', 'REDIRECTED'].includes(error?.code);

function dateOnly(value, fallback) {
  if (value == null || value === '') return new Date(fallback).toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new CanvasError('Las fechas de sincronización deben tener el formato AAAA-MM-DD.', { code: 'INVALID_RANGE' });
  }
  return value;
}
function iso(value) {
  if (!value) return '';
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
}
function resourceUrl(value, baseUrl) {
  if (!value) return '';
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

const validId = value => (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
const validRow = value => value && typeof value === 'object' && !Array.isArray(value) && validId(value.id);

function assignmentDates(assignment, base, warn) {
  const common = { id: text(assignment.id), canvasAssignmentId: text(assignment.id), title: text(assignment.name),
    description: text(assignment.description), url: resourceUrl(assignment.html_url, base) };
  const dates = Array.isArray(assignment.all_dates) ? assignment.all_dates : [];
  const overrides = Array.isArray(assignment.overrides) ? assignment.overrides : [];
  const differentiated = assignment.has_overrides === true || assignment.only_visible_to_overrides === true || overrides.length > 0 || dates.some(date => date && date.base !== true);
  if (!differentiated) return [{ ...common, dueAt: iso(assignment.due_at) }];
  const warning = `«${common.title}» tiene fechas o destinatarios específicos. Cada estudiante debe comprobar en Canvas la fecha que le corresponde.`;
  warn(warning);
  // due_at can otherwise be the coordinator's effective date rather than a class-wide deadline.
  // all_dates contains the base plus each override; never turn an incomplete response into a universal date.
  const incomplete = !dates.length || dates.some(date => !date || typeof date !== 'object' || Array.isArray(date) ||
    (date.base !== true && !validId(date.id)) || !Object.prototype.hasOwnProperty.call(date, 'due_at') || (date.due_at != null && !iso(date.due_at))) ||
    (assignment.has_overrides === true && !dates.some(date => date.base !== true));
  if (incomplete) {
    warn(`No se han podido obtener todas las fechas específicas de «${common.title}». No se ha añadido una fecha general al resumen; consulta la actividad en Canvas.`);
    return [{ ...common, dueAt: '', differentiated: true, datesComplete: false }];
  }
  const byId = new Map(overrides.filter(validRow).map(override => [text(override.id), override]));
  const seen = new Set();
  return dates.filter(date => !(date.base === true && assignment.only_visible_to_overrides === true)).flatMap(date => {
    const variantId = date.base === true ? 'base' : `override-${text(date.id)}`;
    if (seen.has(variantId)) return [];
    seen.add(variantId);
    const override = byId.get(text(date.id));
    let dueScope = 'Destinatarios de esta fecha en Canvas';
    if (date.base === true) dueScope = 'Resto de estudiantes, según Canvas';
    // Individual extensions must not publish student names or IDs in a whole-class email.
    else if (Array.isArray(override?.student_ids)) dueScope = 'Estudiantes con una fecha individual en Canvas';
    else if (override?.course_section_id != null) dueScope = text(date.title || override.title) || 'Sección con fecha específica en Canvas';
    else if (override?.group_id != null) dueScope = text(date.title || override.title) || 'Grupo con fecha específica en Canvas';
    return [{ ...common, id: `${common.id}:${variantId}`, dueAt: iso(date.due_at), dueScope, differentiated: true, datesComplete: true }];
  });
}

// No writes, page views, or enrollment mutations. The caller owns authentication and storage.
// Canvas docs: /services/canvas/resources/{courses,modules,pages,calendar_events}.
export function createCanvasClient({ baseUrl, fetchImpl, getHeaders = () => ({}), timeoutMs = 30000,
  maxPages = 200, maxRetries = 2, sleepImpl = pause, now = Date.now } = {}) {
  const base = normalizeCanvasBase(baseUrl);
  if (typeof fetchImpl !== 'function') throw new TypeError('Canvas requiere un transporte de red.');
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5 || !(timeoutMs > 0)) {
    throw new TypeError('Los límites del cliente Canvas no son válidos.');
  }

  function apiUrl(input, query) {
    let url;
    try { url = new URL(input, base); } catch { /* validated below */ }
    if (!url || url.origin !== base || url.username || url.password || url.hash || !url.pathname.startsWith('/api/v1/')) {
      throw new CanvasError('Canvas devolvió un enlace de API fuera del dominio autorizado.', { code: 'UNSAFE_URL' });
    }
    for (const [key, value] of Object.entries(query || {})) {
      if (value == null) continue;
      for (const entry of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(Array.isArray(value) && !key.endsWith('[]') ? `${key}[]` : key, String(entry));
      }
    }
    return url.href;
  }

  async function request(input, { query, signal } = {}) {
    const url = apiUrl(input, query);
    for (let attempt = 0; ; attempt++) {
      checkSignal(signal);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      let retryDelay = null;
      try {
        const headers = new Headers(await getHeaders());
        headers.set('Accept', 'application/json+canvas-string-ids, application/json');
        checkSignal(signal);
        const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
        if (response.redirected || (response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
          throw new CanvasError('Canvas solicita iniciar sesión de nuevo. Vuelve a conectar la cuenta.', { code: 'REDIRECTED', kind: 'auth_required' });
        }
        if (response.url) apiUrl(response.url);
        const content = await response.text();
        checkSignal(signal);
        if (timedOut) throw new CanvasError('Canvas no respondió a tiempo.', { code: 'TIMEOUT' });
        if (!response.ok) {
          const rateLimited = response.status === 429 || (response.status === 403 && /rate limit exceeded/i.test(content));
          if ((rateLimited || response.status >= 500) && attempt < maxRetries) {
            const retryAfter = Number(response.headers.get('retry-after'));
            retryDelay = Math.min(8000, Math.max(250, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt));
          } else {
            const status = response.status;
            throw new CanvasError(status === 401 ? 'La sesión de Canvas ha caducado o el token no es válido. Vuelve a conectar la cuenta.'
              : status === 403 ? 'Tu cuenta de Canvas no tiene permiso para acceder a estos datos.'
                : rateLimited ? 'Canvas ha limitado las solicitudes. Inténtalo de nuevo en unos minutos.'
                  : `Canvas no pudo devolver estos datos (HTTP ${status}).`,
            { status, code: status === 401 ? 'AUTH_REQUIRED' : rateLimited ? 'RATE_LIMITED' : status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR' });
          }
        } else {
          if (/html/i.test(response.headers.get('content-type') || '') || /^\s*<!doctype html|^\s*<html/i.test(content)) {
            throw new CanvasError('Canvas solicita iniciar sesión de nuevo. Vuelve a conectar la cuenta.', { status: 401, code: 'AUTH_REQUIRED' });
          }
          let data;
          try { data = JSON.parse(content.replace(/^\s*while\(1\);/, '')); } catch {
            throw new CanvasError('Canvas devolvió una respuesta que no se puede leer.', { code: 'INVALID_RESPONSE' });
          }
          return { data, headers: response.headers };
        }
      } catch (error) {
        if (signal?.aborted) throw aborted();
        if (error instanceof CanvasError) throw error;
        if (attempt >= maxRetries) throw new CanvasError(timedOut ? 'Canvas no respondió a tiempo.' : 'No se pudo conectar con Canvas. Comprueba la conexión.',
          { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' });
        retryDelay = Math.min(4000, 500 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
      await sleepImpl(retryDelay, signal);
    }
  }

  async function paginate(path, query = {}, signal) {
    const output = [];
    const visited = new Set();
    let next = apiUrl(path, { per_page: 100, ...query });
    for (let page = 0; next; page++) {
      if (page >= maxPages || visited.has(next)) throw new CanvasError('Canvas devolvió demasiadas páginas o repitió una página. Los datos de esta lista no se han actualizado.', { code: 'PAGINATION_LIMIT' });
      visited.add(next);
      const response = await request(next, { signal });
      if (!Array.isArray(response.data)) throw new CanvasError('Canvas devolvió una lista con un formato inesperado.', { code: 'INVALID_RESPONSE' });
      output.push(...response.data);
      next = null;
      for (const match of (response.headers.get('link') || '').matchAll(/<([^>]+)>\s*;\s*rel\s*=\s*(?:"([^"]+)"|([^,;\s]+))/gi)) {
        if ((match[2] || match[3]).split(/\s+/).includes('next')) { next = apiUrl(match[1]); break; }
      }
    }
    return output;
  }

  async function getProfile({ signal } = {}) {
    const { data } = await request('/api/v1/users/self/profile', { signal });
    if (!data || data.id == null) throw new CanvasError('Canvas no devolvió el perfil de la cuenta.', { code: 'INVALID_RESPONSE' });
    return { id: text(data.id), name: text(data.name || data.short_name), email: isValidEmail(data.primary_email || data.email)
      ? text(data.primary_email || data.email) : isValidEmail(data.login_id) ? text(data.login_id) : '' };
  }

  async function sync({ onProgress, signal, startDate, endDate } = {}) {
    const started = Number(now());
    const range = { startDate: dateOnly(startDate, started - 7 * DAY), endDate: dateOnly(endDate, started + 60 * DAY) };
    if (range.endDate < range.startDate) throw new CanvasError('La fecha final debe ser posterior a la inicial.', { code: 'INVALID_RANGE' });
    // Canvas accepts inclusive dates without a timezone. Include adjacent days;
    // the planner applies the coordinator's timezone and chosen range precisely.
    const calendarBounds = {
      start: new Date(Date.parse(`${range.startDate}T12:00:00Z`) - DAY).toISOString().slice(0, 10),
      end: new Date(Date.parse(`${range.endDate}T12:00:00Z`) + DAY).toISOString().slice(0, 10),
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const syncSignal = controller.signal;
    const warnings = [];
    const syncedAt = new Date(started).toISOString();
    const progress = value => { if (typeof onProgress === 'function') onProgress(value); };
    try {
      progress({ phase: 'profile', completed: 0, total: 0, message: 'Conectando con Canvas…' });
      const user = await getProfile({ signal: syncSignal });
      const rawCourses = await paginate('/api/v1/courses', { include: ['term', 'enrollments'] }, syncSignal);
      if (rawCourses.some(course => !validRow(course))) {
        throw new CanvasError('Canvas devolvió una lista de asignaturas incompleta o inválida. Se conserva la última copia local.', { code: 'INVALID_RESPONSE' });
      }
      const seenCourses = new Set();
      const available = rawCourses.filter(course => {
        if (seenCourses.has(text(course.id))) return false;
        seenCourses.add(text(course.id));
        return !['deleted'].includes(course.workflow_state);
      });
      const courses = new Array(available.length);
      let nextIndex = 0;
      let completed = 0;
      let failure;
      async function syncCourse(raw) {
        const canvasCourseId = text(raw.id);
        const id = `canvas:${base}:${user.id}:${canvasCourseId}`;
        const coursePath = `/api/v1/courses/${encodeURIComponent(canvasCourseId)}`;
        const syncStatus = {};
        const syncWarnings = [];
        const labels = { modules: 'la estructura de módulos', students: 'la lista de estudiantes', pages: 'el contenido de las sesiones', teachers: 'el profesorado', calendar: 'el calendario', assignments: 'las actividades y entregas' };
        async function load(key, task, fallback = []) {
          checkSignal(syncSignal);
          try {
            const value = await task();
            syncStatus[key] = 'ok';
            return value;
          } catch (error) {
            if (fatal(error)) throw error;
            syncStatus[key] = 'error';
            syncWarnings.push(`${text(raw.name || raw.course_code) || 'Asignatura'}: no se pudo obtener ${labels[key]}. ${error.message}`);
            return fallback;
          }
        }
        progress({ phase: 'course', completed, total: available.length, courseId: id, courseName: text(raw.name), message: `Sincronizando ${text(raw.name || raw.course_code)}…` });
        const modules = await load('modules', async () => {
          const modules = await paginate(`${coursePath}/modules`, { include: ['items', 'content_details'] }, syncSignal);
          for (const module of modules) {
            if (!module || module.id == null) throw new CanvasError('Un módulo de Canvas no tiene identificador.', { code: 'INVALID_RESPONSE' });
            if (!Array.isArray(module.items) || Number(module.items_count) > module.items.length) {
              module.items = await paginate(`${coursePath}/modules/${encodeURIComponent(module.id)}/items`, { include: ['content_details'] }, syncSignal);
              if (Number(module.items_count) > module.items.length) throw new CanvasError('Canvas devolvió un módulo incompleto; se conserva la estructura anterior.', { code: 'INCOMPLETE_MODULE' });
            }
            module.items = module.items.map(item => ({ ...item, url: resourceUrl(item.html_url || item.external_url || item.url, base) }));
          }
          return modules;
        });
        const hasLessonModules = modules.some(isNamedLesson);
        const pageUrls = [...new Set(modules.filter(module => module.published !== false).flatMap(module => module.items || []).filter(item => item.published !== false && item.type === 'Page' && item.page_url && !/\bvideo\b/.test(fold(item.title))).map(item => text(item.page_url)))];
        const pages = await load('pages', async () => {
          if (hasLessonModules || !pageUrls.length) return [];
          const wanted = new Set(pageUrls);
          const byUrl = new Map();
          try {
            for (const page of await paginate(`${coursePath}/pages`, { include: ['body'] }, syncSignal)) {
              if (wanted.has(text(page.url)) && typeof page.body === 'string') byUrl.set(text(page.url), { url: text(page.url), body: page.body });
            }
          } catch (error) { if (fatal(error) || ![403, 404].includes(error.status)) throw error; }
          // CanvasManager uses revisions because GET /pages/:url marks a lesson as viewed.
          for (const pageUrl of pageUrls) {
            if (byUrl.has(pageUrl)) continue;
            const { data } = await request(`${coursePath}/pages/${encodeURIComponent(pageUrl)}/revisions/latest`, { signal: syncSignal });
            if (typeof data?.body !== 'string') throw new CanvasError('Canvas no devolvió el contenido de una sesión.', { code: 'INVALID_RESPONSE' });
            byUrl.set(pageUrl, { url: pageUrl, body: data.body });
          }
          return [...byUrl.values()];
        });
        const students = await load('students', async () => {
          // Email is part of User when permitted, not a supported include[] option.
          const users = await paginate(`${coursePath}/users`, { enrollment_type: ['student'], enrollment_state: ['active'], include: ['enrollments'] }, syncSignal);
          if (users.some(person => !person || typeof person !== 'object' || person.id == null)) {
            throw new CanvasError('Canvas devolvió una lista de estudiantes incompleta o inválida.', { code: 'INVALID_RESPONSE' });
          }
          return users.filter(person => {
            return !Array.isArray(person.enrollments) || person.enrollments.some(enrollment =>
              /^(?:StudentEnrollment|student)$/i.test(enrollment.type || '') &&
              (!enrollment.enrollment_state || enrollment.enrollment_state === 'active') &&
              (enrollment.course_id == null || text(enrollment.course_id) === canvasCourseId));
          });
        });
        const teachers = await load('teachers', async () => {
          const users = await paginate(`${coursePath}/users`, { enrollment_type: ['teacher', 'ta'], enrollment_state: ['active'], include: ['enrollments'] }, syncSignal);
          return [...new Set(users.filter(person => person && (!Array.isArray(person.enrollments) || person.enrollments.some(enrollment =>
            /^(?:TeacherEnrollment|TaEnrollment|teacher|ta)$/i.test(enrollment.type || '') && (!enrollment.enrollment_state || enrollment.enrollment_state === 'active'))))
            .map(person => text(person.name || person.short_name)).filter(Boolean))];
        });
        const calendarRaw = await load('calendar', () => paginate('/api/v1/calendar_events', { type: 'event', context_codes: [`course_${canvasCourseId}`], start_date: calendarBounds.start, end_date: calendarBounds.end }, syncSignal));
        const assignmentsRaw = await load('assignments', async () => {
          const values = await paginate(`${coursePath}/assignments`, { order_by: 'due_at', include: ['all_dates', 'overrides'], override_assignment_dates: false }, syncSignal);
          if (values.some(assignment => !validRow(assignment))) throw new CanvasError('Canvas devolvió una lista de actividades incompleta o inválida.', { code: 'INVALID_RESPONSE' });
          return values;
        });
        const assignments = assignmentsRaw.filter(assignment => assignment.published !== false).flatMap(assignment =>
          assignmentDates(assignment, base, warning => syncWarnings.push(`${text(raw.name || raw.course_code) || 'Asignatura'}: ${warning}`)));
        const calendarEvents = calendarRaw.filter(event => {
          if (!event || event.id == null || event.hidden === true || event.workflow_state === 'deleted' || !iso(event.start_at)) return false;
          const contexts = [event.effective_context_code, event.context_code, event.all_context_codes].filter(Boolean).flatMap(value => text(value).split(',').map(text));
          return !contexts.length || contexts.includes(`course_${canvasCourseId}`);
        }).map(event => ({ id: text(event.id), courseId: id, title: text(event.title), startAt: iso(event.start_at), endAt: iso(event.end_at) || iso(event.start_at),
          description: text(event.description), url: resourceUrl(event.html_url, base), type: 'event', allDay: event.all_day === true,
          day: event.all_day === true ? text(event.all_day_date || iso(event.start_at).slice(0, 10)) : '', location: text(event.location_name),
        }));
        for (const assignment of assignments) {
          const day = assignment.dueAt.slice(0, 10);
          if (!day || day < range.startDate || day > range.endDate) continue;
          calendarEvents.push({ id: `assignment_${assignment.id}`, assignmentId: assignment.id, courseId: id, title: assignment.title, startAt: assignment.dueAt,
            endAt: assignment.dueAt, description: assignment.description, url: assignment.url, type: 'assignment' });
        }
        calendarEvents.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
        const [course] = normalizeCourses([{ ...raw, id, modules, pages, students, hasStructure: syncStatus.modules === 'ok',
          source: { type: 'canvas', baseUrl: base, userId: user.id, canvasCourseId, savedAt: syncedAt }, savedAt: syncedAt }]);
        const missingEmailCount = syncStatus.students === 'ok' ? course.students.filter(student => !isValidEmail(student.email)).length : null;
        if (missingEmailCount) syncWarnings.push(`${course.name}: Canvas no permite leer un correo válido de ${missingEmailCount} estudiante(s). No se incluirán automáticamente como destinatarios.`);
        warnings.push(...syncWarnings);
        const originalName = text(raw.original_name || raw.name || raw.course_code);
        const academicSource = { originalName, name: originalName, courseCode: text(raw.course_code), termName: text(raw.term?.name) };
        return { ...course, originalName, displayName: subjectName(academicSource), subject: subjectName(academicSource),
          courseCode: academicSource.courseCode, termName: academicSource.termName,
          academicMemberships: subjectAcademicMemberships(academicSource), teachers, calendarEvents, assignments, syncStatus, syncWarnings, missingEmailCount,
          rosterAuthoritative: syncStatus.students === 'ok', rosterComplete: syncStatus.students === 'ok' && missingEmailCount === 0,
          preparationComplete: syncStatus.modules === 'ok' && syncStatus.pages === 'ok', calendarRange: { ...range }, timeZone: text(raw.time_zone), term: text(raw.term?.name) };
      }
      const workers = Array.from({ length: Math.min(3, available.length) }, async () => {
        while (nextIndex < available.length && !failure) {
          const index = nextIndex++;
          try {
            courses[index] = await syncCourse(available[index]);
            completed++;
            progress({ phase: 'course-complete', completed, total: available.length, courseId: courses[index].id, courseName: courses[index].name, message: `${completed} de ${available.length} asignaturas sincronizadas` });
          } catch (error) { failure ||= error; controller.abort(); }
        }
      });
      await Promise.all(workers);
      if (failure) throw failure;
      checkSignal(syncSignal);
      progress({ phase: 'complete', completed, total: available.length, message: 'Sincronización completada' });
      return { courses, user, syncedAt, warnings, baseUrl: base, ...range };
    } finally { signal?.removeEventListener('abort', cancel); }
  }

  return { baseUrl: base, getProfile, sync };
}
