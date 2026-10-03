// Canvas calls each subject a "course". An academic course is a degree + study year,
// scoped to an academic period and the connected account. Student overlap is never
// evidence of that hierarchy: optional and repeated subjects can share students.
import { isValidEmail } from './domain.js';

const text = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
const array = value => Array.isArray(value) ? value : [];
const knownDegrees = { 'G.EC': 'Grado en Economía' };

function periodIn(value) {
  for (const match of text(value).matchAll(/(?:^|[^\d])((?:19|20)?\d{2})\s*[/-]\s*((?:19|20)?\d{2})(?!\d)/g)) {
    const start = match[1].length === 4 ? Number(match[1]) : 2000 + Number(match[1]);
    const end = match[2].length === 4 ? Number(match[2]) : Math.floor(start / 100) * 100 + Number(match[2]);
    if (end === start + 1) return `${start}/${String(end).slice(-2)}`;
  }
  return '';
}

function scope(subject) {
  const source = subject?.source || {};
  return source.type === 'canvas'
    ? `canvas:${text(source.baseUrl)}:${text(source.userId)}`
    : subject?.isDemo ? 'demo' : `local:${text(source.baseUrl)}:${text(source.userId)}`;
}

const membershipKey = value => `${value.degreeCode}|${value.academicPeriod}|${value.studyYear}`;
const groupId = (subject, membership) => `academic:${[scope(subject), membership.degreeCode, membership.academicPeriod, membership.studyYear].map(value => encodeURIComponent(value)).join(':')}`;

/** Remove the administrative suffix only when it contains the documented academic code. */
export function subjectName(subject) {
  const full = text(typeof subject === 'string' ? subject : subject?.displayName || subject?.subject || subject?.name || subject?.originalName);
  const clean = full.replace(/\s*\[[^[\]]*\|[^\[\]]*\]\s*(?:\(\s*\))?\s*$/, '').replace(/\s*[-–—·|:,;/]+\s*$/, '').trim();
  return clean || full || 'Asignatura';
}

function explicitMemberships(subject) {
  const values = [...array(subject?.academicMemberships)];
  if (subject?.academic && typeof subject.academic === 'object') values.push(subject.academic);
  const output = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const degreeCode = text(value.degreeCode || value.degree).toUpperCase();
    const degree = text(value.degree) || knownDegrees[degreeCode] || degreeCode;
    const academicPeriod = periodIn(value.academicPeriod || subject.termName || subject.term || subject.name);
    const semesters = array(value.semesters).map(Number).filter(number => Number.isInteger(number) && number >= 1 && number <= 20);
    const years = [...new Set([value.studyYear, ...array(value.studyYears), ...semesters.map(semester => Math.ceil(semester / 2))]
      .map(Number).filter(number => Number.isInteger(number) && number >= 1 && number <= 10))];
    if (!degreeCode || !degree || !years.length) continue;
    for (const studyYear of years) output.push({ degreeCode, degree, academicPeriod, studyYear,
      semesters: semesters.filter(semester => Math.ceil(semester / 2) === studyYear), evidence: text(value.evidence) || 'Metadatos académicos' });
  }
  return output;
}

/** S5/S6 = third year; S3-S5 denotes a subject shared by second and third year. */
export function subjectAcademicMemberships(subject) {
  if (!subject || typeof subject !== 'object') return [];
  const explicit = explicitMemberships(subject);
  if (explicit.length) return mergeMemberships(explicit);
  // A copied course_code or nickname can retain an older academic period. Use
  // the first source with valid metadata, preserving every bracket within that
  // source for genuine cross-listing rather than combining conflicting fields.
  const candidates = [subject.originalName, subject.original_name, subject.name, subject.code, subject.courseCode, subject.course_code];
  for (const value of candidates) {
    const output = [];
    const raw = text(value);
    const codes = [...raw.matchAll(/\[([^\[\]]+)\]/g)].map(match => match[1]);
    if (!codes.length && raw.includes('|')) codes.push(raw);
    for (const code of codes) {
      const [degreePart, periodPart, semesterPart] = code.split('|').map(text);
      if (!/^[A-Z][A-Z0-9.]{1,20}$/i.test(degreePart || '') || !/^S\d{1,2}(?:\s*[-,;/+]\s*S?\d{1,2})*$/i.test(semesterPart || '')) continue;
      const degreeCode = degreePart.toUpperCase();
      const academicPeriod = periodIn(periodPart);
      const semesters = [...new Set((semesterPart.match(/\d+/g) || []).map(Number))];
      if (!academicPeriod || semesters.some(number => number < 1 || number > 20)) continue;
      const years = [...new Set(semesters.map(semester => Math.ceil(semester / 2)))];
      for (const studyYear of years) output.push({ degreeCode, degree: knownDegrees[degreeCode] || degreeCode, academicPeriod, studyYear,
        semesters: semesters.filter(semester => Math.ceil(semester / 2) === studyYear), evidence: `[${code}]` });
    }
    if (output.length) return mergeMemberships(output);
  }
  return [];
}

function mergeMemberships(values) {
  const merged = new Map();
  for (const value of values) {
    const key = membershipKey(value);
    if (!merged.has(key)) merged.set(key, { ...value, semesters: [...value.semesters] });
    else merged.get(key).semesters = [...new Set([...merged.get(key).semesters, ...value.semesters])].sort((a, b) => a - b);
  }
  return [...merged.values()].sort((a, b) => a.degree.localeCompare(b.degree, 'es') || a.studyYear - b.studyYear || a.academicPeriod.localeCompare(b.academicPeriod));
}

function rosterForGroup(subjects, group) {
  const members = subjects.filter(subject => group.subjectIds.includes(subject.id));
  const exclusive = members.filter(subject => subjectAcademicMemberships(subject).length === 1);
  const shared = members.filter(subject => !exclusive.includes(subject));
  const students = new Map();
  const byEmail = new Map();
  for (const subject of exclusive) {
    for (const student of array(subject.students)) {
      const id = text(student.id);
      const email = text(student.email).toLowerCase();
      const existingKey = id && students.has(`id:${id}`) ? `id:${id}` : email && byEmail.get(email);
      const key = existingKey || (id ? `id:${id}` : email ? `email:${email}` : '');
      if (!key) continue;
      const previous = students.get(key);
      if (!previous || !isValidEmail(previous.email) && isValidEmail(student.email)) students.set(key, { ...student });
      if (email) byEmail.set(email, key);
    }
  }
  const rosterWarnings = [];
  if (!exclusive.length && shared.length) rosterWarnings.push('Las asignaturas de este curso son compartidas con otros cursos. Canvas no permite identificar a sus destinatarios solo con estas matrículas.');
  else if (shared.length) rosterWarnings.push('Las asignaturas compartidas se incluyen en la agenda. Sus matrículas no amplían los destinatarios del curso para evitar mezclar estudiantes de otros cursos.');
  if (exclusive.some(subject => subject.syncStatus?.students === 'error')) rosterWarnings.push('No se pudo actualizar alguna lista de estudiantes. Los destinatarios conservan la última copia local.');
  const missing = [...students.values()].filter(student => !isValidEmail(student.email)).length;
  if (missing) rosterWarnings.push(`Canvas no proporciona un correo válido de ${missing} estudiante(s).`);
  return { students: [...students.values()].sort((a, b) => text(a.name).localeCompare(text(b.name), 'es')),
    rosterWarnings, rosterComplete: exclusive.length > 0 && !missing && exclusive.every(subject => subject.syncStatus?.students !== 'error' && subject.rosterComplete !== false) };
}

/** Derive degree-year groups without combining accounts, academic periods, or unknown subjects. */
export function academicCourses(subjects = []) {
  const groups = new Map();
  for (const subject of array(subjects)) {
    if (!subject?.id) continue;
    for (const membership of subjectAcademicMemberships(subject)) {
      const id = groupId(subject, membership);
      if (!groups.has(id)) groups.set(id, { id, name: `${membership.studyYear}º de ${membership.degree}`, degreeCode: membership.degreeCode,
        degree: membership.degree, academicPeriod: membership.academicPeriod, studyYear: membership.studyYear, subjectIds: [],
        source: { type: subject.source?.type || (subject.isDemo ? 'demo' : 'local'), baseUrl: text(subject.source?.baseUrl), userId: text(subject.source?.userId) },
        isDemo: subject.isDemo === true });
      const group = groups.get(id);
      if (!group.subjectIds.includes(subject.id)) group.subjectIds.push(subject.id);
    }
  }
  return [...groups.values()].map(group => {
    const { rosterWarnings, rosterComplete } = rosterForGroup(array(subjects), group);
    return { ...group, rosterWarnings, rosterComplete };
  }).sort((a, b) => b.academicPeriod.localeCompare(a.academicPeriod) || a.degree.localeCompare(b.degree, 'es') || a.studyYear - b.studyYear || a.id.localeCompare(b.id));
}

export function subjectsForAcademicCourse(subjects, groupOrId) {
  const group = typeof groupOrId === 'string' ? academicCourses(subjects).find(value => value.id === groupOrId) : groupOrId;
  return group ? array(subjects).filter(subject => array(group.subjectIds).includes(subject.id)) : [];
}

export function academicCourseStudents(subjects, groupOrId) {
  const group = typeof groupOrId === 'string' ? academicCourses(subjects).find(value => value.id === groupOrId) : groupOrId;
  return group ? rosterForGroup(array(subjects), group).students : [];
}
