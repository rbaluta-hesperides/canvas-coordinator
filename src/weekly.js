import { deriveSessions } from './domain.js';

const text = (value) => value == null ? '' : String(value).replace(/\r\n?/g, '\n').trim();
const sentence = (value) => /[.!?…][”"')\]]?$/.test(value) ? value : `${value}.`;

export const NO_ADDITIONAL_PREPARATION = 'No hay sesiones adicionales que trabajar antes de esta clase.';

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
    subject: text(course?.subject || course?.name),
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
  const missing = [];
  if (!items.length) missing.push('Añade al menos una clase o actividad a la semana.');

  const paragraphs = items.map((entry, index) => {
    const number = index + 1;
    const subject = text(entry?.subject);
    const event = text(entry?.event);
    const teacher = text(entry?.teacher);
    const notes = text(entry?.notes);
    if (!subject) missing.push(`Entrada ${number}: falta la asignatura.`);
    if (!event) missing.push(`Entrada ${number}: falta la clase o actividad.`);

    const mode = text(entry?.preparationMode);
    let preparation;
    if (mode === 'none') preparation = NO_ADDITIONAL_PREPARATION;
    else if (mode === 'canvas' || mode === 'manual') {
      preparation = text(entry?.preparation);
      if (!preparation) missing.push(`Entrada ${number}: falta indicar la preparación o elegir «Sin trabajo adicional».`);
    } else {
      missing.push(`Entrada ${number}: elige cómo indicar la preparación.`);
      preparation = '';
    }

    const label = `${subject || `{{asignatura_${number}}}`} — ${event || `{{actividad_${number}}}`}${teacher ? `, con ${teacher}` : ''}`;
    const work = preparation ? sentence(preparation) : `{{preparacion_${number}}}`;
    return `• ${label}: ${work}${notes ? `\n  ${notes.replace(/\n/g, '\n  ')}` : ''}`;
  });

  return { text: paragraphs.join('\n\n'), missing, entryCount: items.length };
}
