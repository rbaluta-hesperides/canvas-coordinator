import { deriveSessions, isValidEmail } from './domain.js';
import { createWeeklyEntry } from './weekly.js';

const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = number => String(number).padStart(2, '0');
export function dayInZone(value, timeZone = 'Europe/Vienna') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function nextCanvasWeek(now = new Date(), timeZone = 'Europe/Vienna') {
  const date = new Date(`${dayInZone(now, timeZone)}T12:00:00Z`);
  const untilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + untilMonday);
  const startDate = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 4);
  return { startDate, endDate: date.toISOString().slice(0, 10) };
}
export function validateWeekRange(startDate, endDate) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(startDate) || !valid(endDate)) throw new Error('Elige las fechas de inicio y fin del resumen.');
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
  if (days < 0 || days > 90) throw new Error('El periodo debe ir de la fecha inicial a una fecha posterior, con un máximo de 90 días.');
}
export function canvasPlainText(html = '') {
  return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '').replace(/&#(x[\da-f]+|\d+);/gi, (_, value) => {
      const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : +value;
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const sessionDay = session => session.year && session.month && session.day ? `${session.year}-${pad(session.month)}-${pad(session.day)}` : '';
const classNumber = title => /\b(?:clase|sesion)(?:\s+sincronic[ao])?\s*(\d+)\b/.exec(fold(title))?.[1];
const exam = title => /\b(?:examen|parcial|exam|quiz|evaluacion)\b/.test(fold(title));
const tutorial = title => /\b(?:tutoria|tutoring)\b/.test(fold(title));
const notAClass = event => event.type === 'assignment' || exam(event.title) || tutorial(event.title) ||
  /\b(?:entrega|tarea|plazo|vencimiento|cancelad[ao]s?|suspendid[ao]s?|reunion|meeting|deadline|assignment|recording|grabacion|foro|discussion)\b|\b(?:fecha limite|office hours)\b/.test(fold(event.title));
const classEvent = title => /(?:^|[:|–—-])\s*(?:(?:proxima|next)\s+)?(?:clase|sesion|class|session|lecture)\b|\b(?:clase|sesion)\s+(?:sincronic[ao]|sincron[ao]|en directo)\b|\b(?:live class|live session|synchronous class|synchronous session)\b/.test(fold(title));
function eventDay(event, timeZone) {
  if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.day || '') && dayInZone(`${event.day}T12:00:00Z`, 'UTC') === event.day) return event.day;
  return dayInZone(event.startAt, timeZone);
}
function localSortTime(timestamp, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${dayInZone(timestamp, timeZone)}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Match a calendar event only when Canvas gives unambiguous evidence. */
function matchSession(event, sessions, timeZone) {
  if (notAClass(event)) return null;
  const exact = sessions.filter(session => fold(session.title) === fold(event.title));
  if (exact.length === 1) return exact[0];
  if (!classEvent(event.title)) return null;
  const number = classNumber(event.title);
  const numbered = number ? sessions.filter(session => classNumber(session.title) === number) : [];
  if (numbered.length === 1) return numbered[0];
  // A deadline or an unrelated meeting on a class day does not identify that class.
  const date = eventDay(event, timeZone);
  const dated = sessions.filter(session => sessionDay(session) === date);
  if (dated.length === 1) return dated[0];
  return null;
}

/** Exact shared rosters suggest a cohort; recipients still come from the selected course. */
export function relatedCanvasCourses(courses, selected) {
  if (!selected) return [];
  const signature = course => {
    if (course.source?.type !== 'canvas' || course.rosterComplete !== true || course.rosterAuthoritative !== true || course.syncStatus?.students !== 'ok') return '';
    const students = course.students || [];
    if (students.some(student => !student.id || !isValidEmail(student.email))) return '';
    const ids = [...new Set(students.map(student => String(student.id)))].sort();
    return ids.length >= 2 ? JSON.stringify(ids) : '';
  };
  const own = signature(selected);
  return courses.filter(course => course.id === selected.id || (own && course.source?.type === 'canvas' &&
    course.source?.baseUrl === selected.source?.baseUrl && course.source?.userId === selected.source?.userId && signature(course) === own)).map(course => course.id);
}

export function planCanvasWeek(courses, { startDate, endDate, timeZone = 'Europe/Vienna' }) {
  validateWeekRange(startDate, endDate);
  const entries = [], warnings = [];
  const inRange = day => day && day >= startDate && day <= endDate;
  const when = timestamp => new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  const allDayWhen = event => `${new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${eventDay(event, timeZone)}T12:00:00Z`))} · Todo el día`;
  for (const course of courses) {
    const sessions = deriveSessions(course), usedSessions = new Set();
    const assignments = course.assignments || [];
    const assignmentIds = new Set(assignments.map(item => String(item.id)));
    const events = course.calendarEvents || [];
    const seenEvents = new Set();
    const stalePreparation = course.preparationComplete === false || course.syncStatus?.modules === 'error' || course.syncStatus?.pages === 'error';
    const labels = { modules: 'los módulos', pages: 'el contenido de las sesiones', students: 'la lista de estudiantes', calendar: 'el calendario', assignments: 'las actividades y entregas', teachers: 'el profesorado' };
    for (const [endpoint, label] of Object.entries(labels)) {
      if (course.syncStatus?.[endpoint] === 'error') warnings.push(`${course.subject || course.name}: no se ha podido actualizar ${label}; la información disponible puede proceder de la última copia local. Revísala antes de abrir Gmail.`);
    }
    if (stalePreparation && course.syncStatus?.modules !== 'error' && course.syncStatus?.pages !== 'error') {
      warnings.push(`${course.subject || course.name}: la preparación de Canvas está incompleta; revísala antes de abrir Gmail.`);
    }
    const append = (event, session = null, fallback = false) => {
      const item = createWeeklyEntry(course, session?.id);
      const description = canvasPlainText(event.description);
      const previous = session ? sessions[sessions.findIndex(candidate => candidate.id === session.id) - 1] : null;
      if (!stalePreparation && session?.preparation && previous?.preparation === session.preparation) item.preparationMode = 'none';
      item.id = `canvas-event:${course.id}:${event.id}`;
      item.sourceEventId = String(event.id);
      item.generated = true;
      item.event = event.title || session?.title || 'Actividad de Canvas';
      item.teacher = (course.teachers || []).length === 1 ? (typeof course.teachers[0] === 'string' ? course.teachers[0] : course.teachers[0].name || '') : '';
      if (!session) {
        // Exam coverage and tutoring instructions come only from the event itself.
        item.preparation = description;
        item.preparationMode = 'manual';
        item.evidence = description ? 'Indicaciones publicadas en el calendario de Canvas.' : 'Canvas no publica la preparación de esta actividad.';
        if (!description) warnings.push(`${course.subject || course.name}: Canvas no indica la preparación de «${item.event}». Revísala antes de abrir Gmail.`);
      }
      if (session && stalePreparation) item.evidence = `Preparación pendiente de actualizar; puede proceder de la última copia local. ${item.evidence}`;
      if (!fallback && course.syncStatus?.calendar === 'error') item.evidence = `Calendario de la última copia local, pendiente de actualizar. ${item.evidence}`;
      item.notes = [fallback ? `Fecha en Canvas: ${session.day}/${session.month}/${session.year}${session.time ? ` · ${session.time}` : ''}` : event.allDay ? allDayWhen(event) : `${when(event.startAt)} (${timeZone})`, session && description ? description : '', /^https:\/\//.test(event.url || '') ? event.url : ''].filter(Boolean).join('\n\n');
      item.sortAt = fallback ? `${sessionDay(session)}T${session.time || '12:00'}:00` : event.allDay ? `${eventDay(event, timeZone)}T00:00:00` : localSortTime(event.startAt, timeZone);
      entries.push(item);
      if (session) usedSessions.add(session.id);
    };
    for (const event of events) {
      if (!inRange(eventDay(event, timeZone)) || seenEvents.has(String(event.id))) continue;
      const assignmentId = String(event.assignmentId || event.id).replace(/^assignment[_-]/, '');
      if (event.type === 'assignment' && assignmentIds.has(assignmentId)) continue;
      seenEvents.add(String(event.id));
      append(event, matchSession(event, sessions, timeZone));
    }
    for (const session of sessions) {
      if (!usedSessions.has(session.id) && inRange(sessionDay(session))) append({ id: `module-${session.id}`, title: session.title }, session, true);
    }
    for (const assignment of assignments) {
      if (!assignment.dueAt || !inRange(dayInZone(assignment.dueAt, timeZone))) continue;
      const description = canvasPlainText(assignment.description);
      const deadlineLabel = assignment.differentiated ? `Fecha publicada para ${assignment.dueScope || 'los destinatarios indicados en Canvas'}` : 'Fecha límite';
      if (assignment.differentiated) warnings.push(`${course.subject || course.name}: «${assignment.title}» tiene fechas o destinatarios específicos; cada estudiante debe comprobar en Canvas la fecha que le corresponde.`);
      entries.push({ ...createWeeklyEntry(course), id: `canvas-assignment:${course.id}:${assignment.id}`, sourceEventId: `assignment-${assignment.id}`, generated: true,
        event: `Entrega: ${assignment.title}`, preparationMode: 'manual', preparation: description || 'Completar y entregar la actividad en Canvas.',
        notes: `${deadlineLabel}: ${when(assignment.dueAt)} (${timeZone})${assignment.differentiated ? '\nComprueba en Canvas la fecha que te corresponde.' : ''}${/^https:\/\//.test(assignment.url || '') ? `\n${assignment.url}` : ''}`, evidence: course.syncStatus?.assignments === 'error' ? 'Fecha de entrega e instrucciones de la última copia local; pendientes de actualizar en Canvas.' : 'Fecha de entrega e instrucciones de la actividad en Canvas.', sortAt: localSortTime(assignment.dueAt, timeZone) });
    }
  }
  entries.sort((a, b) => String(a.sortAt).localeCompare(String(b.sortAt)) || a.id.localeCompare(b.id));
  return { entries, warnings: [...new Set(warnings)] };
}
