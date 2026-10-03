import { deriveSessions, deriveExamPreparation, isExamActivity } from './domain.js';
import { createWeeklyEntry } from './weekly.js';

const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = number => String(number).padStart(2, '0');
const DAY_MS = 86400000;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number(String(value).slice(0, 4)) > 0 &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export function dayInZone(value, timeZone = 'Europe/Vienna') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function nextCanvasWeek(now = new Date(), timeZone = 'Europe/Vienna') {
  return canvasWeekFromInput(shiftCanvasWeek(canvasWeekInput(now, timeZone), 1));
}

/** ISO weeks use the week containing Thursday; dates are calendar days, not UTC instants. */
export function canvasWeekInput(value, timeZone = 'Europe/Vienna') {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value == null || value === '' ? '' : dayInZone(value, timeZone);
  if (!validDate(day)) throw new Error('La fecha de la semana no es válida.');
  const thursday = new Date(`${day}T12:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  if (year < 1 || year > 9999) throw new Error('La fecha de la semana no es válida.');
  const firstDay = new Date(`${String(year).padStart(4, '0')}-01-01T12:00:00Z`);
  const week = Math.floor((thursday - firstDay) / (7 * DAY_MS)) + 1;
  return `${String(year).padStart(4, '0')}-W${pad(week)}`;
}

/** HTML week input → the complete Monday–Sunday period, including weekend activities. */
export function canvasWeekFromInput(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 53) throw new Error('Elige una semana válida.');
  const monday = new Date(`${match[1]}-01-04T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 1 - (monday.getUTCDay() || 7) + (Number(match[2]) - 1) * 7);
  const startDate = monday.toISOString().slice(0, 10);
  if (!validDate(startDate) || canvasWeekInput(startDate) !== value) throw new Error('Elige una semana válida.');
  monday.setUTCDate(monday.getUTCDate() + 6);
  const endDate = monday.toISOString().slice(0, 10);
  if (!validDate(endDate)) throw new Error('Elige una semana válida.');
  return { startDate, endDate };
}

export function shiftCanvasWeek(value, amount = 1) {
  if (!Number.isInteger(amount)) throw new Error('El desplazamiento debe ser un número entero de semanas.');
  const { startDate } = canvasWeekFromInput(value);
  const next = new Date(`${startDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount * 7);
  if (!Number.isFinite(next.getTime())) throw new Error('La semana indicada está fuera del intervalo permitido.');
  const result = canvasWeekInput(next.toISOString().slice(0, 10));
  canvasWeekFromInput(result);
  return result;
}
export function validateWeekRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) throw new Error('Elige las fechas de inicio y fin del resumen.');
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
const classNumber = title => {
  const value = /\b(?:clase|sesion|class|session|lecture)(?:\s+(?:sincronic[ao]|sincron[ao]|en directo|en vivo|synchronous|live))?\s*(?:n[º°.]?\s*)?(\d+)\b/.exec(fold(title))?.[1];
  return value == null ? '' : String(Number(value));
};
const exam = isExamActivity;
const tutorial = title => /\b(?:tutoria|tutoring)\b/.test(fold(title));
const notAClass = event => event.type === 'assignment' || exam(event.title) || tutorial(event.title) ||
  /\b(?:entrega|tarea|plazo|vencimiento|cancelad[ao]s?|suspendid[ao]s?|reunion|meeting|deadline|assignment|recording|grabacion|foro|discussion|asincron[ao]s?|asincronic[ao]s?|asynchronous)\b|\b(?:fecha limite|office hours)\b/.test(fold(event.title));
const classEvent = title => /(?:^|[:|–—-])[\s⚪🟢🔴📚\uFE0F]*(?:(?:proxima|next)\s+)?(?:clase|sesion|class|session|lecture)\b|\b(?:clase|sesion)\s+(?:sincronic[ao]|sincron[ao]|en directo)\b|\b(?:live class|live session|synchronous class|synchronous session)\b/u.test(fold(title));
function eventDay(event, timeZone) {
  if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.day || '') && dayInZone(`${event.day}T12:00:00Z`, 'UTC') === event.day) return event.day;
  return dayInZone(event.startAt, timeZone);
}
function localSortTime(timestamp, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${dayInZone(timestamp, timeZone)}T${parts.hour}:${parts.minute}:${parts.second}`;
}

const spanishDate = date => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const timeInZone = (timestamp, timeZone) => new Intl.DateTimeFormat('es-ES', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));

/** Calendar instants are authoritative; module titles never supply a missing calendar hour. */
function calendarSchedule(event, timeZone, scheduleSource = 'calendar') {
  const date = eventDay(event, timeZone);
  const [year, month, day] = date.split('-');
  const allDay = event.allDay === true;
  const hasEnd = !allDay && Number.isFinite(Date.parse(event.endAt)) && Date.parse(event.endAt) > Date.parse(event.startAt);
  const startTime = allDay ? '' : timeInZone(event.startAt, timeZone);
  const endTime = hasEnd ? timeInZone(event.endAt, timeZone) : '';
  const endDate = hasEnd ? dayInZone(event.endAt, timeZone) : '';
  const ending = endTime ? endDate === date ? `–${endTime}` : ` – ${spanishDate(endDate)} · ${endTime}` : '';
  return { date, day, month, year, startTime, endTime, endDate, allDay, timeZone, scheduleSource,
    scheduleLabel: `${spanishDate(date)} · ${allDay ? 'Todo el día' : `${startTime}${ending} (${timeZone})`}` };
}

function moduleSchedule(session, timeZone) {
  const date = sessionDay(session);
  return { date, day: pad(session.day), month: pad(session.month), year: String(session.year),
    startTime: session.time || '', endTime: '', endDate: '', allDay: false, timeZone, scheduleSource: 'module',
    scheduleLabel: `Fecha en el módulo de Canvas: ${spanishDate(date)}${session.time ? ` · ${session.time} (${timeZone})` : ' · Hora no publicada'}` };
}

/** Match a calendar event only when Canvas gives unambiguous evidence. */
function matchSession(event, sessions, timeZone) {
  const exact = sessions.filter(session => fold(session.title) === fold(event.title));
  if (notAClass(event)) {
    // A tutorial can be the university's name for a live module, but only an exact
    // synchronous-module identity proves it; "Tutoría 2" never implies "Clase 2".
    const withoutTutorialLabel = { ...event, title: String(event.title || '').replace(/\btutor[ií]a|tutoring/gi, '') };
    return tutorial(event.title) && !notAClass(withoutTutorialLabel) && exact.length === 1 ? exact[0] : null;
  }
  if (exact.length === 1) return exact[0];
  if (!classEvent(event.title)) return null;
  const number = classNumber(event.title);
  const numbered = number ? sessions.filter(session => classNumber(session.title) === number) : [];
  if (numbered.length === 1) return numbered[0];
  // An explicit class number is stronger evidence than a coinciding date.
  if (number && !numbered.length) return null;
  // A deadline or an unrelated meeting on a class day does not identify that class.
  const date = eventDay(event, timeZone);
  const dated = (number ? numbered : sessions).filter(session => sessionDay(session) === date);
  if (dated.length === 1) return dated[0];
  return null;
}

export function planCanvasWeek(courses, { startDate, endDate, timeZone = 'Europe/Vienna' }) {
  validateWeekRange(startDate, endDate);
  const entries = [], warnings = [];
  const inRange = day => day && day >= startDate && day <= endDate;
  for (const course of courses) {
    const sessions = deriveSessions(course), usedSessions = new Set();
    const assignments = course.assignments || [];
    const assignmentIds = new Set(assignments.map(item => String(item.id)));
    const events = course.calendarEvents || [];
    // A class moved outside this week must not reappear on an obsolete module date.
    const eventSessions = new Map(events.map(event => [event, matchSession(event, sessions, timeZone)]));
    for (const session of eventSessions.values()) if (session) usedSessions.add(session.id);
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
      Object.assign(item, fallback ? moduleSchedule(session, timeZone) : calendarSchedule(event, timeZone));
      item.event = event.title || session?.title || 'Actividad de Canvas';
      item.teacher = (course.teachers || []).length === 1 ? (typeof course.teachers[0] === 'string' ? course.teachers[0] : course.teachers[0].name || '') : '';
      if (exam(event.title)) {
        const preparation = deriveExamPreparation(course, event, { timeZone });
        item.preparationSource = 'exam';
        item.preparation = preparation ? `Trabajar hasta ${preparation.preparation.replace(/[.!?]+$/, '')}.` : '';
        item.preparationMode = preparation ? 'canvas' : 'none';
        item.preparationReferenceId = preparation?.referenceId || '';
        item.preparationModuleId = preparation?.moduleId || '';
        item.evidence = preparation?.evidence || 'No se identificó una sesión asíncrona anterior al examen en Canvas.';
      } else if (!session) {
        item.preparation = description;
        item.preparationMode = description ? 'manual' : 'none';
        item.evidence = description ? 'Indicaciones publicadas en el calendario de Canvas.' : 'Canvas no publica la preparación de esta actividad.';
      }
      if ((session || item.preparationSource === 'exam') && stalePreparation) item.evidence = `Preparación pendiente de actualizar; puede proceder de la última copia local. ${item.evidence}`;
      if (!fallback && course.syncStatus?.calendar === 'error') item.evidence = `Calendario de la última copia local, pendiente de actualizar. ${item.evidence}`;
      item.notes = !exam(event.title) && session && description ? description : '';
      item.sortAt = fallback ? `${sessionDay(session)}T${session.time || '12:00'}:00` : event.allDay ? `${eventDay(event, timeZone)}T00:00:00` : localSortTime(event.startAt, timeZone);
      entries.push(item);
      if (session) usedSessions.add(session.id);
    };
    for (const event of events) {
      if (!inRange(eventDay(event, timeZone)) || seenEvents.has(String(event.id))) continue;
      const assignmentId = String(event.assignmentId || event.id).replace(/^assignment[_-]/, '');
      if (event.type === 'assignment' && assignmentIds.has(assignmentId)) continue;
      seenEvents.add(String(event.id));
      append(event, eventSessions.get(event));
    }
    for (const session of sessions) {
      if (usedSessions.has(session.id) || !inRange(sessionDay(session))) continue;
      // A fresh Canvas timetable can omit a moved/cancelled class even if its module retains an old date.
      if (course.source?.type === 'canvas' && course.syncStatus?.calendar === 'ok') continue;
      append({ id: `module-${session.id}`, title: session.title }, session, true);
    }
    for (const assignment of assignments) {
      if (!assignment.dueAt || !inRange(dayInZone(assignment.dueAt, timeZone))) continue;
      const description = canvasPlainText(assignment.description);
      const deadlineLabel = assignment.differentiated ? `Fecha publicada para ${assignment.dueScope || 'los destinatarios indicados en Canvas'}` : 'Fecha límite';
      const schedule = calendarSchedule({ startAt: assignment.dueAt }, timeZone, 'assignment');
      schedule.scheduleLabel = `${deadlineLabel}: ${schedule.scheduleLabel}`;
      const isExam = exam(assignment.title);
      const examPreparation = isExam ? deriveExamPreparation(course, { ...assignment, type: 'assignment' }, { timeZone }) : null;
      if (assignment.differentiated) warnings.push(`${course.subject || course.name}: «${assignment.title}» tiene fechas o destinatarios específicos; cada estudiante debe comprobar en Canvas la fecha que le corresponde.`);
      entries.push({ ...createWeeklyEntry(course), ...schedule, id: `canvas-assignment:${course.id}:${assignment.id}`, sourceEventId: `assignment-${assignment.id}`, generated: true,
        event: isExam ? assignment.title : `Entrega: ${assignment.title}`,
        preparationMode: isExam ? examPreparation ? 'canvas' : 'none' : description ? 'manual' : 'none',
        preparation: isExam ? examPreparation ? `Trabajar hasta ${examPreparation.preparation.replace(/[.!?]+$/, '')}.` : '' : description,
        ...(isExam ? { preparationSource: 'exam', preparationReferenceId: examPreparation?.referenceId || '', preparationModuleId: examPreparation?.moduleId || '', assignmentId: assignment.canvasAssignmentId || assignment.id } : {}),
        notes: assignment.differentiated ? 'Comprueba en Canvas la fecha que te corresponde.' : '', evidence: isExam ? `${stalePreparation ? 'Preparación pendiente de actualizar; puede proceder de la última copia local. ' : ''}${examPreparation?.evidence || 'No se identificó una sesión asíncrona anterior al examen en Canvas.'}` : course.syncStatus?.assignments === 'error' ? 'Fecha de entrega e instrucciones de la última copia local; pendientes de actualizar en Canvas.' : 'Fecha de entrega e instrucciones de la actividad en Canvas.', sortAt: localSortTime(assignment.dueAt, timeZone) });
    }
  }
  entries.sort((a, b) => String(a.sortAt).localeCompare(String(b.sortAt)) || a.id.localeCompare(b.id));
  return { entries, warnings: [...new Set(warnings)] };
}
