import { isValidEmail } from './domain.js';

// A failed endpoint must not erase the last usable local copy. A successful
// roster is authoritative, including an empty roster and withdrawn students.
export function mergeCanvasCourse(previous, incoming) {
  if (!previous) return incoming;
  const merged = { ...previous, ...incoming };
  const status = incoming.syncStatus || {};
  for (const [endpoint, property] of Object.entries({ modules: 'modules', students: 'students', calendar: 'calendarEvents', assignments: 'assignments', teachers: 'teachers', pages: 'pages' })) {
    if (status[endpoint] === 'error') merged[property] = previous[property];
  }
  if (status.modules === 'error') merged.pages = previous.pages;
  return merged;
}

export function reconcileCanvasRecipients(previous, incoming, selectedIds, mode) {
  const oldValid = (previous?.students || []).filter(s => isValidEmail(s.email));
  const freshValid = (incoming?.students || []).filter(s => isValidEmail(s.email));
  const selection = new Set(selectedIds || []);
  const selectedAll = mode === 'all' || (mode !== 'custom' && oldValid.length > 0 && oldValid.every(s => selection.has(s.id)));
  return freshValid.filter(s => selectedAll || selection.has(s.id)).map(s => s.id);
}
