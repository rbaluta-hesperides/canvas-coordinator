// Pure local-data transformations. No network, storage, or Canvas API calls.
const string = (value) => value == null ? '' : String(value).trim();
const fold = (value) => string(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const array = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const finitePosition = (value, fallback) => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
const ordered = (values) => array(values).filter(object).map((value, index) => ({ value, index }))
  .sort((a, b) => finitePosition(a.value.position, a.index + 1) - finitePosition(b.value.position, b.index + 1) || a.index - b.index).map(({ value }) => value);

function unwrap(value) {
  for (let depth = 0; depth < 8 && object(value) && own(value, 'data') &&
    (own(value, 'savedAt') || own(value, 'userId') || Object.keys(value).length === 1); depth++) value = value.data;
  return value;
}

export function isValidEmail(value) {
  const email = string(value);
  if (!email || email.length > 254 || /[\s<>(),;:\r\n]/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2 || parts[0].length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
    parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(parts[1]);
}

function normalizeStudents(values) {
  const seen = new Set();
  return array(values).filter(object).map((entry, index) => {
    const raw = object(entry.user) ? { ...entry, ...entry.user } : entry;
    const email = string(raw.email || raw.email_address || raw.emailAddress || raw.correo ||
      (isValidEmail(raw.login_id) ? raw.login_id : ''));
    return { id: string(raw.id || raw.user_id || email || `student-${index + 1}`),
      name: string(raw.name || raw.nombre || raw.full_name || raw.sortable_name || email || 'Estudiante sin nombre'), email };
  }).filter((student) => {
    const key = student.email ? student.email.toLowerCase() : `id:${student.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeModules(values) {
  return ordered(values).map((raw, index) => ({
    id: string(raw.id || `module-${index + 1}`), name: string(raw.name || raw.title || `Módulo ${index + 1}`),
    position: finitePosition(raw.position, index + 1), published: raw.published !== false,
    date: string(raw.date || raw.startAt || raw.start_at), time: string(raw.time),
    items: ordered(raw.items).map((item, itemIndex) => ({
      id: string(item.id || `${raw.id || index + 1}-item-${itemIndex + 1}`),
      title: string(item.title || item.name || `Material ${itemIndex + 1}`), type: string(item.type || 'Page'),
      position: finitePosition(item.position, itemIndex + 1),
      url: string(item.url || item.html_url || item.htmlUrl || item.external_url), published: item.published !== false,
      pageUrl: string(item.pageUrl || item.page_url), body: string(item.body),
      date: string(item.date || item.startAt || item.start_at), time: string(item.time),
      ...(item.contentId != null || item.content_id != null ? { contentId: string(item.contentId ?? item.content_id) } : {}),
    })),
  }));
}

/** Accept Canvas API data, CanvasManager cache envelopes, and local coordinator backups. */
export function normalizeCourses(input) {
  const source = unwrap(input);
  let entries;
  if (Array.isArray(source)) entries = source;
  else if (object(source) && Array.isArray(unwrap(source.courses))) entries = unwrap(source.courses);
  else if (object(source) && (source.id != null || source.courseId != null || source.course_id != null || Array.isArray(source.modules))) entries = [source];
  else if (object(source) && object(source.course)) entries = [{ ...source.course, ...unwrap(source.courseContent || source.content || {}) }];
  else return [];

  return entries.filter(object).map((entry, index) => {
    const raw = unwrap(entry);
    const id = string(raw.id || raw.courseId || raw.course_id || (entries.length === 1 ? 'imported-course' : `imported-course-${index + 1}`));
    const contentMap = object(source) ? unwrap(source.courseContent || source.contents || source.content || {}) : {};
    const mapped = object(contentMap) ? unwrap(contentMap[id]) : array(contentMap).find((content) => string(content.courseId || content.course_id || content.id) === id);
    const content = unwrap(raw.courseContent || raw.content || mapped || {});
    const name = string(raw.original_name || raw.name || raw.displayName || raw.courseName || `Curso importado${entries.length > 1 ? ` ${index + 1}` : ''}`);
    const course = {
      id, name, code: string(raw.code || raw.course_code || raw.courseCode),
      subject: string(raw.subject || raw.subjectName || raw.displayName || name),
      students: normalizeStudents(raw.students || raw.users || raw.enrollments || content.students || content.users),
      modules: normalizeModules(raw.modules || content.modules),
      hasStructure: typeof raw.hasStructure === 'boolean' ? raw.hasStructure : Array.isArray(raw.modules) || Array.isArray(content.modules),
      pages: array(raw.pages || content.pages).filter(object).map((page) => ({ url: string(page.url || page.page_url), body: string(page.body) })),
      ...(object(raw.source) ? { source: { ...raw.source } } : {}),
      ...(raw.savedAt != null ? { savedAt: raw.savedAt } : {}),
      ...(raw.color ? { color: string(raw.color) } : {}),
      ...(typeof raw.isDemo === 'boolean' ? { isDemo: raw.isDemo } : {}),
      ...(object(raw.academic) ? { academic: { ...raw.academic } } : {}),
      ...(Array.isArray(raw.academicMemberships) ? { academicMemberships: raw.academicMemberships.map(value => ({ ...value })) } : {}),
      ...(raw.originalName ? { originalName: string(raw.originalName) } : {}),
      ...(raw.courseCode ? { courseCode: string(raw.courseCode) } : {}),
      ...(raw.termName ? { termName: string(raw.termName) } : {}),
    };
    course.sessions = deriveSessions(course);
    return course;
  });
}

function isAsync(text) { return /\b(?:asincron[ao]s?|asincronic[ao]s?|asynchronous)\b/.test(fold(text)); }
function isLive(text, module = false) {
  const value = fold(text);
  if (isAsync(value)) return false;
  if (/\b(?:sincron[ao]s?|sincronic[ao]s?|synchronous|live session|live class|clase en directo|sesion en directo)\b/.test(value)) return true;
  if (/\b(?:antes|despues) de la clase\s+\d+\b/.test(value)) return true;
  if (module && /(?:^|[|:])\s*clase\s+\d+\b/.test(value)) return true;
  if (module && /\ben vivo\b/.test(value) && /⚪/.test(string(text))) return true;
  return module && /^\s*⚪/.test(string(text)) && /\bsesion\s+\d+\b/.test(value);
}

function isLiveItem(item) {
  // A recording/discussion may name its live class, but is not another live meeting.
  return fold(item.type) !== 'discussion' && !/\b(?:despues|after|grabacion|recording)\b/.test(fold(item.title)) && isLive(item.title);
}

function isLessonModule(name) {
  const value = fold(name);
  return isAsync(value) || /\b(?:sesion|session|lesson)\s+\d+\b/.test(value);
}

function isAdministrative(name) {
  return /\b(?:orientacion|orientation|tutoria|tutorial|bienvenida|welcome|informacion general|presentacion del curso)\b/.test(fold(name));
}

function isMaterial(item) {
  if (item.published === false || ['subheader', 'discussion'].includes(fold(item.type))) return false;
  const title = fold(item.title);
  return !isLive(title) && !/\b(?:antes|despues) de la clase\b|\b(?:grabacion de clase|class recording|foro|transcripciones|lista de reproduccion)\b/.test(title);
}

function dateParts(values) {
  for (const value of values) {
    const text = string(value);
    const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(text);
    const european = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(text);
    if (!iso && !european) continue;
    const year = iso ? iso[1] : european[3];
    const month = (iso ? iso[2] : european[2]).padStart(2, '0');
    const day = (iso ? iso[3] : european[1]).padStart(2, '0');
    const parsed = new Date(`${year}-${month}-${day}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) continue;
    const rawTime = (iso && iso[4]) || /\b([01]\d|2[0-3]):([0-5]\d)\b/.exec(text)?.[0] || '';
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime : '';
    return { day, month, year, time };
  }
  return { day: '', month: '', year: '', time: '' };
}

/**
 * Hespérides/CanvasManager order: every lesson before the live module is preparation.
 * Plain “Sesión N” is recorded teaching; “Clase sincrónica N” (or ⚪ Sesión N) is live.
 * No previous lesson means an empty cutoff, so a coordinator must supply it explicitly.
 */
export function deriveSessions(course) {
  const modules = normalizeModules(course?.modules);
  const hasLessonModules = modules.some((module) => module.published !== false && isLessonModule(module.name) && !isLive(module.name, true));
  const pageBodies = new Map(array(course?.pages).filter(object).map((page) => [string(page.url || page.page_url), string(page.body)]));
  const isLessonVideo = (item) => fold(item.type) === 'page' && (/\bvideo\b/.test(fold(item.title)) ||
    /<video\b|media_objects_iframe|media_attachments_iframe|player\.vimeo\.com|youtube(?:-nocookie)?\.com\/embed/i.test(item.body || pageBodies.get(item.pageUrl) || ''));
  const preparations = [];
  let cutoff = null;
  const sessions = [];
  const append = (module, target = null) => {
    const title = target ? target.title : module.name;
    const dates = target ? [target.date, target.title] : [module.date, module.name, ...module.items.filter((item) => isLive(item.title)).flatMap((item) => [item.date, item.title])];
    const parts = dateParts(dates);
    const explicitTime = string(target?.time || module.time);
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(explicitTime)) parts.time = explicitTime;
    sessions.push({
      id: target ? `${module.id}:${target.id}` : module.id, title, moduleName: module.name, moduleId: module.id,
      position: sessions.length + 1, ...parts,
      preparation: cutoff ? `${cutoff.moduleName}${cutoff.title ? ` · ${cutoff.title}` : ''}` : '',
      preparationItems: preparations.map((item) => ({ ...item })),
      evidence: cutoff ? (hasLessonModules
        ? `Según el orden de Canvas, la preparación llega hasta «${cutoff.moduleName}»${cutoff.title ? ` / «${cutoff.title}»` : ''}, antes de «${title}».`
        : `No se identificaron módulos de sesiones asíncronas. El último vídeo previo es «${cutoff.moduleName}»${cutoff.title ? ` / «${cutoff.title}»` : ''}. Revisa esta preparación antes de usarla.`)
        : 'No se encontró una sesión o material de preparación previo en la estructura de Canvas importada. Introduce la preparación manualmente.',
    });
  };
  const addMaterial = (module, item) => {
    const material = { id: item.id, title: item.title, moduleId: module.id, moduleName: module.name, url: item.url };
    preparations.push(material);
    cutoff = material;
  };
  for (const module of modules) {
    if (module.published === false) continue;
    // Antes/Después pairs identify one class module even if its author renamed the module.
    const hasClassPair = module.items.some((item) => /\b(?:antes|despues) de la clase\s+\d+\b/.test(fold(item.title)));
    if (isLive(module.name, true) || (!isAsync(module.name) && hasClassPair)) { append(module); continue; }
    if (isAdministrative(module.name)) continue;
    const lessonModule = isLessonModule(module.name);
    if (lessonModule) cutoff = { moduleName: module.name, title: '' };
    for (const item of module.items) {
      if (item.published === false) continue;
      if (isLiveItem(item)) append(module, item);
      // A handbook or policy file between sessions is not a new preparation cutoff.
      // With no session-labelled modules, support CanvasManager's video-page convention.
      else if (isMaterial(item) && (lessonModule || (!hasLessonModules && isLessonVideo(item)))) addMaterial(module, item);
    }
  }
  return sessions;
}

const examWords = /\b(?:examen(?:es)?|parcial(?:es)?|exam(?:ination)?|quiz|evaluacion)\b/;
function examLabel(value) {
  const title = fold(value).replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ');
  const marker = examWords.exec(title);
  if (!marker || marker.index > 0 && !/[|:;–—-]\s*$/.test(title.slice(0, marker.index))) return '';
  return title.slice(marker.index)
    .replace(/\[?\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b\]?/g, '')
    .replace(/[\s|:;–—-]+(?:convocatoria del|opcion del?|alternativa del?)\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b.*$/, '')
    .replace(/[\s|:;–—-]+$/, '').replace(/\s+/g, ' ').trim();
}
function examResource(value) {
  const match = /\/(assignments|quizzes)\/([^/?#]+)/.exec(string(value));
  return match ? `${match[1]}:${match[2]}` : '';
}
export const isExamActivity = value => Boolean(examLabel(value));

/** Last asynchronous session before an exam's structural position, never a later lesson. */
export function deriveExamPreparation(course, event, { timeZone = 'Europe/Vienna' } = {}) {
  if (!examLabel(event?.title || event?.name)) return null;
  const modules = normalizeModules(course?.modules).filter(module => module.published !== false);
  const asynchronous = module => isLessonModule(module.name) && !isLive(module.name, true) && !isAdministrative(module.name) && !examLabel(module.name) &&
    !module.items.some(item => item.published !== false && /\b(?:antes|despues) de la clase\s+\d+\b/.test(fold(item.title)));
  const nodes = modules.flatMap((module, moduleIndex) => [
    { module, moduleIndex, item: null, title: module.name },
    ...module.items.filter(item => item.published !== false).map(item => ({ module, moduleIndex, item, title: item.title })),
  ]);
  const moduleItemId = string(event?.moduleItemId || event?.module_item_id);
  const moduleId = string(event?.moduleId || event?.module_id);
  const assignmentId = string(event?.canvasAssignmentId || event?.assignmentId || event?.assignment_id ||
    (event?.type === 'assignment' ? event.id : '')).replace(/^assignment[_-]/, '').replace(/:(?:base|override-.*)$/, '');
  const quizId = string(event?.quizId || event?.quiz_id);
  const resource = examResource(event?.url || event?.html_url);
  let targets = nodes.filter(node => node.item && (
    moduleItemId && node.item.id === moduleItemId ||
    assignmentId && fold(node.item.type) === 'assignment' && node.item.contentId === assignmentId ||
    quizId && fold(node.item.type) === 'quiz' && node.item.contentId === quizId ||
    resource && examResource(node.item.url) === resource
  ));
  if (!targets.length && moduleId) targets = nodes.filter(node => !node.item && node.module.id === moduleId);
  if (!targets.length) {
    const title = examLabel(event.title || event.name);
    targets = nodes.filter(node => examLabel(node.title) === title);
    // A module and its same-named exam item identify one boundary at the module start.
    targets = targets.filter(node => !node.item || !targets.some(candidate => candidate.moduleIndex === node.moduleIndex && !candidate.item));
  }
  if (targets.length > 1) return null;
  if (targets.length === 1) {
    const target = targets[0];
    const earlier = modules.filter((module, index) => index < target.moduleIndex && asynchronous(module));
    // An exam embedded in a session follows that session only when there is actual
    // asynchronous material before the exam item; an exam at item 1 does not count it.
    if (target.item && asynchronous(target.module)) {
      const itemIndex = target.module.items.findIndex(item => item.id === target.item.id);
      if (target.module.items.slice(0, itemIndex).some(item => isMaterial(item) && !examLabel(item.title))) earlier.push(target.module);
    }
    const last = earlier.at(-1);
    return last ? { preparation: last.name, moduleId: last.id, referenceId: target.item ? `${target.module.id}:${target.item.id}` : target.module.id,
      evidence: `Según el orden de Canvas, la última sesión asíncrona anterior a «${target.title}» es «${last.name}».` } : null;
  }
  // With no matching structural marker, only explicit dated asynchronous sessions
  // prove precedence. Undated modules and same-day sessions do not provide that proof.
  let examDay = event?.allDay ? string(event.day) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDay)) {
    const timestamp = event?.startAt || event?.start_at || event?.dueAt || event?.due_at;
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    examDay = `${parts.year}-${parts.month}-${parts.day}`;
  }
  const parsedExamDay = new Date(`${examDay}T12:00:00Z`);
  if (!Number.isFinite(parsedExamDay.getTime()) || parsedExamDay.toISOString().slice(0, 10) !== examDay) return null;
  const lessons = modules.filter(asynchronous).map((module, index) => {
    const parts = dateParts([module.date, module.name]);
    let day = parts.year ? `${parts.year}-${parts.month}-${parts.day}` : '';
    if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(module.date) && Number.isFinite(Date.parse(module.date))) {
      const local = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(module.date)).map(part => [part.type, part.value]));
      day = `${local.year}-${local.month}-${local.day}`;
    }
    return { module, day, index };
  });
  const dated = lessons.filter(entry => entry.day);
  if (dated.some((entry, index) => index > 0 && entry.day < dated[index - 1].day)) return null;
  const last = dated.filter(entry => entry.day < examDay).at(-1);
  if (last) {
    const boundary = dated.find(entry => entry.index > last.index && entry.day >= examDay)?.index ?? lessons.length;
    if (lessons.some(entry => entry.index > last.index && entry.index < boundary && !entry.day)) return null;
  }
  return last ? { preparation: last.module.name, moduleId: last.module.id, referenceId: `exam-date:${examDay}`,
    evidence: `La sesión asíncrona «${last.module.name}» tiene fecha ${last.day}, anterior al examen del ${examDay}, en el orden de Canvas.` } : null;
}

function csvRows(text, delimiter) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else if (quoted || value.trim() === '') quoted = !quoted;
      else value += char;
    } else if (!quoted && char === delimiter) { row.push(value); value = ''; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; value = '';
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else value += char;
  }
  if (quoted) throw new Error('El CSV contiene un campo con comillas sin cerrar.');
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function parseStudentCsv(text) {
  const content = string(text).replace(/^\uFEFF/, '');
  if (!content) return { students: [], warnings: [] };
  // Only count delimiters outside quotes in the header/first record.
  let quoted = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && /[\r\n]/.test(char)) break;
    else if (!quoted && own(counts, char)) counts[char]++;
  }
  const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = csvRows(content, delimiter);
  const headers = rows[0].map((header) => fold(header).replace(/[_-]/g, ' ').replace(/\s+/g, ' '));
  const emailHeaders = ['email', 'e mail', 'email address', 'correo', 'correo electronico', 'direccion de correo', 'direccion de correo electronico', 'sis login id', 'login id'];
  const nameHeaders = ['name', 'full name', 'student name', 'nombre', 'nombre completo', 'alumno', 'estudiante', 'student', 'display name'];
  const firstHeaders = ['first name', 'given name', 'nombres'];
  const lastHeaders = ['last name', 'surname', 'apellidos', 'apellido'];
  const idHeaders = ['id', 'student id', 'user id', 'canvas user id', 'sis user id', 'canvas id'];
  let emailIndex = headers.findIndex((header) => emailHeaders.includes(header));
  let nameIndex = headers.findIndex((header) => nameHeaders.includes(header));
  const firstIndex = headers.findIndex((header) => firstHeaders.includes(header));
  const lastIndex = headers.findIndex((header) => lastHeaders.includes(header));
  const idIndex = headers.findIndex((header) => idHeaders.includes(header));
  const hasHeader = emailIndex >= 0 || nameIndex >= 0 || firstIndex >= 0 || idIndex >= 0;
  if (emailIndex < 0 && !hasHeader) emailIndex = rows[0].findIndex((value) => isValidEmail(value));
  if (emailIndex < 0) throw new Error('No se encontró una columna de correo. Usa el encabezado Email o Correo electrónico.');
  if (!hasHeader) nameIndex = rows[0].findIndex((value, index) => index !== emailIndex && string(value));
  const students = [], warnings = [], seen = new Set();
  rows.slice(hasHeader ? 1 : 0).forEach((row, index) => {
    const rowNumber = index + (hasHeader ? 2 : 1);
    const email = string(row[emailIndex]);
    if (!isValidEmail(email)) { warnings.push(`Fila ${rowNumber}: falta el correo o no es válido; no se añadió este estudiante.`); return; }
    const key = email.toLowerCase();
    if (seen.has(key)) { warnings.push(`Fila ${rowNumber}: correo duplicado; no se añadió este estudiante.`); return; }
    seen.add(key);
    const givenName = string(row[nameIndex]);
    const name = (givenName && headers[nameIndex] === 'nombre' && lastIndex >= 0
      ? [givenName, row[lastIndex]].map(string).filter(Boolean).join(' ') : givenName)
      || [row[firstIndex], row[lastIndex]].map(string).filter(Boolean).join(' ') || email;
    students.push({ id: string(row[idIndex]) || email, name, email });
  });
  return { students, warnings };
}

export function resolveTemplate(template, variables = {}) {
  const missing = new Set();
  const text = String(template ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, rawKey) => {
    const key = rawKey.trim();
    if (!own(variables, key) || variables[key] == null || string(variables[key]) === '') { missing.add(key); return placeholder; }
    return String(variables[key]);
  });
  return { text, missing: [...missing] };
}

/** Only invoked after the coordinator explicitly chooses to open Gmail. Never sends mail. */
export function buildGmailUrl({ to, bcc = [], subject = '', body = '' } = {}) {
  const sender = string(to);
  if (!isValidEmail(sender)) throw new Error('Introduce un correo de coordinación válido para el campo «Para».');
  const recipients = Array.isArray(bcc) ? bcc : string(bcc).split(/[,;\n]/).filter((value) => string(value));
  if (!recipients.length) throw new Error('Selecciona al menos un estudiante como destinatario.');
  const seen = new Set([sender.toLowerCase()]);
  const addresses = [];
  for (const value of recipients) {
    const email = string(value);
    if (!isValidEmail(email)) throw new Error('Un estudiante seleccionado tiene un correo electrónico no válido.');
    if (!seen.has(email.toLowerCase())) { seen.add(email.toLowerCase()); addresses.push(email); }
  }
  if (!addresses.length) throw new Error('Selecciona al menos un estudiante con un correo distinto al de coordinación.');
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: sender, bcc: addresses.join(','), su: String(subject), body: String(body) });
  return `https://mail.google.com/mail/u/0/?${params.toString()}`;
}
