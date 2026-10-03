import { deriveSessions } from './domain.js';
import { subjectName } from './academic.js';

const text = (value) => value == null ? '' : String(value).replace(/\r\n?/g, '\n').trim();
const sentence = (value) => /[.!?…][”"')\]]?$/.test(value) ? value : `${value}.`;

// Keep useful wording while excluding links from generated activity paragraphs,
// including URLs retained by drafts created before links were removed from the planner.
export function withoutActivityLinks(value) {
  return text(value)
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^\s)]+\)/gi, '$1')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, '')
    .split('\n').map(line => /^(?:(?:enlace|link|url)\s*:?\s*)?[.:;,–—-]*$/i.test(line.trim()) ? '' : line.trimEnd())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function calendarDateKey(entry) {
  if (entry?.generated !== true && !text(entry?.sourceEventId)) return '';
  const value = text(entry.sortAt) || `${text(entry.date)}T${entry.allDay ? '00:00' : text(entry.startTime) || '12:00'}:00`;
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return '';
  const day = value.slice(0, 10), parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? value : '';
}

/** A weekly item is independent, even when several items belong to the same course. */
export function createWeeklyEntry(course = null, sessionId = '') {
  const selectedId = text(sessionId);
  // Only an explicitly selected live class can supply a Canvas preparation cutoff.
  const session = selectedId ? deriveSessions(course).find((candidate) => candidate.id === selectedId) : null;
  const preparation = text(session?.preparation);
  return {
    id: globalThis.crypto.randomUUID(),
    courseId: text(course?.id),
    sessionId: session?.id || '',
    subject: course ? subjectName(course) : '',
    event: text(session?.title),
    teacher: '',
    preparationMode: preparation ? 'canvas' : 'manual',
    preparation: preparation ? sentence(`Trabajar hasta ${preparation}`) : '',
    notes: '',
    evidence: text(session?.evidence),
  };
}

/** Returns plain text only; the UI is responsible for escaping it in HTML previews. */
export function composeWeeklyAgenda(entries = []) {
  const items = Array.isArray(entries) ? entries : [];
  const indexed = items.map((entry, index) => ({ entry, index, sortKey: calendarDateKey(entry) }));
  const dated = indexed.filter(item => item.sortKey).sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.index - b.index);
  let datedIndex = 0;
  // Calendar activities keep chronological order even after their preparation is edited.
  // Independent manually authored rows keep their positions.
  const ordered = indexed.map(item => item.sortKey ? dated[datedIndex++] : item);
  const missing = [];
  if (!items.length) missing.push('Añade al menos una clase o actividad a la semana.');

  const paragraphs = ordered.map(({ entry, index }) => {
    const number = index + 1;
    const subject = text(entry?.subject);
    const event = text(entry?.event);
    const teacher = text(entry?.teacher);
    const schedule = text(entry?.scheduleLabel);
    const notes = withoutActivityLinks(entry?.notes);
    if (!subject) missing.push(`Entrada ${number}: falta la asignatura.`);
    if (!event) missing.push(`Entrada ${number}: falta la clase o actividad.`);

    const mode = text(entry?.preparationMode);
    let preparation = mode === 'none' ? '' : withoutActivityLinks(entry?.preparation);
    if (preparation && mode !== 'canvas' && mode !== 'manual') {
      missing.push(`Entrada ${number}: elige cómo indicar la preparación.`);
      preparation = '';
    }

    const label = `${subject || `{{asignatura_${number}}}`} — ${event || `{{actividad_${number}}}`}${teacher ? `, con ${teacher}` : ''}`;
    const work = preparation ? sentence(preparation) : '';
    const details = [schedule, work, notes].filter(Boolean);
    if (!details.length) return `• ${label}`;
    if (!schedule && work) return `• ${label}: ${work}${notes ? `\n  ${notes.replace(/\n/g, '\n  ')}` : ''}`;
    return `• ${label}:\n  ${details.join('\n').replace(/\n/g, '\n  ')}`;
  });

  return { text: paragraphs.join('\n\n'), missing, entryCount: items.length };
}
