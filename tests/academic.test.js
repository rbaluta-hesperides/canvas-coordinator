import test from 'node:test';
import assert from 'node:assert/strict';
import { subjectName, subjectAcademicMemberships, academicCourses, subjectsForAcademicCourse, academicCourseStudents } from '../src/academic.js';

const source = { type: 'canvas', baseUrl: 'https://canvas.example.edu', userId: 'coordinator' };
const subject = (id, name, students = [], extra = {}) => ({ id, name, students, source, ...extra });
const ana = { id: 'student-1', name: 'Ana', email: 'ana@example.edu' };
const luis = { id: 'student-2', name: 'Luis', email: 'luis@example.edu' };
const maria = { id: 'student-3', name: 'María', email: 'maria@example.edu' };
const thirdYear = groups => groups.find(group => group.studyYear === 3);

test('Canvas subject codes identify degree, academic period and study year separately', () => {
  const value = subject('a', 'Econometría I [G.EC|26/27|S5|2]');
  assert.equal(subjectName(value), 'Econometría I');
  assert.deepEqual(subjectAcademicMemberships(value), [{ degreeCode: 'G.EC', degree: 'Grado en Economía', academicPeriod: '2026/27', studyYear: 3, semesters: [5], evidence: '[G.EC|26/27|S5|2]' }]);
  const group = academicCourses([value])[0];
  assert.equal(group.name, '3º de Grado en Economía');
  assert.equal(group.academicPeriod, '2026/27');
  assert.deepEqual(group.subjectIds, ['a']);
  assert.equal(subjectAcademicMemberships({ code: 'G.EC|2026/2027|S6|1' })[0].studyYear, 3);
});

test('cross-listed semesters create only their stated years and never an intervening year', () => {
  const value = subject('shared', 'Teoría de la Empresa [G.EC|26/27|S3-S7|2-2]');
  assert.deepEqual(subjectAcademicMemberships(value).map(value => value.studyYear), [2, 4]);
  assert.deepEqual(academicCourses([value]).map(group => group.studyYear), [2, 4]);
  assert.equal(subjectAcademicMemberships({ name: 'Asignatura [G.EC|26/27|S5-S6|2-2]' }).length, 1);
});

test('authoritative name metadata prevents stale codes or nicknames from inventing cross-listing', () => {
  const value = subject('current', 'Nombre antiguo [G.EC|25/26|S3|1]', [ana], {
    originalName: 'Econometría I [G.EC|26/27|S5|2]', code: 'G.EC|24/25|S1|1',
    courseCode: 'G.EC|23/24|S7|1',
  });
  const groups = academicCourses([value]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].studyYear, 3);
  assert.equal(groups[0].academicPeriod, '2026/27');
  assert.deepEqual(academicCourseStudents([value], groups[0]), [ana], 'the roster stays eligible because a stale field did not invent a second course');
  assert.deepEqual(groups[0].rosterWarnings, []);

  const withoutOriginalName = { ...value, originalName: undefined, name: 'Econometría I [G.EC|26/27|S5|2]' };
  assert.equal(academicCourses([withoutOriginalName]).length, 1);
  assert.equal(academicCourses([withoutOriginalName])[0].studyYear, 3);

  const multipleBrackets = { ...value, originalName: 'Asignatura compartida [G.EC|26/27|S3|1] [G.EC|26/27|S5|1]' };
  assert.deepEqual(subjectAcademicMemberships(multipleBrackets).map(item => item.studyYear), [2, 3]);
  assert.deepEqual(academicCourseStudents([multipleBrackets], thirdYear(academicCourses([multipleBrackets]))), []);

  const fallback = { ...value, originalName: 'Asignatura sin código', name: 'Nombre [G.EC|26/27]', code: 'G.EC|26/27|S5|1' };
  assert.equal(subjectAcademicMemberships(fallback)[0].studyYear, 3);
  assert.equal(subjectAcademicMemberships(fallback).length, 1);
});

test('same rosters never group different study years, degrees or academic periods', () => {
  const subjects = [
    subject('third', 'Econometría I [G.EC|26/27|S5|2]', [ana]),
    subject('fourth', 'Economía Conductual [G.EC|26/27|S7|2]', [ana]),
    subject('second-degree', 'Derecho [G.DER|26/27|S5|2]', [ana]),
    subject('old', 'Econometría I [G.EC|25/26|S5|2]', [ana]),
    subject('unknown', 'Un espacio sin metadatos', [ana]),
  ];
  assert.equal(academicCourses(subjects).length, 4);
  const group = academicCourses(subjects).find(group => group.degreeCode === 'G.EC' && group.studyYear === 3 && group.academicPeriod === '2026/27');
  assert.deepEqual(subjectsForAcademicCourse(subjects, group.id).map(subject => subject.id), ['third']);
  assert.equal(academicCourses(subjects).find(group => group.degreeCode === 'G.DER').degree, 'G.DER', 'an unknown degree abbreviation is never expanded speculatively');
});

test('otherwise identical academic courses remain separated by Canvas account and domain', () => {
  const values = [
    subject('a', 'Asignatura [G.EC|26/27|S5|1]'),
    subject('b', 'Asignatura [G.EC|26/27|S5|1]', [], { source: { ...source, userId: 'other' } }),
    subject('c', 'Asignatura [G.EC|26/27|S5|1]', [], { source: { ...source, baseUrl: 'https://other.example.edu' } }),
    subject('d', 'Asignatura [G.EC|26/27|S5|1]', [], { source: { type: 'local' } }),
  ];
  const groups = academicCourses(values);
  assert.equal(groups.length, 4);
  assert.equal(new Set(groups.map(group => group.id)).size, 4);
  assert.deepEqual(groups.map(group => group.subjectIds.length), [1, 1, 1, 1]);
});

test('academic recipients merge exclusive-year rosters without leaking shared-subject students', () => {
  const values = [
    subject('one', 'Econometría [G.EC|26/27|S5|1]', [ana, { ...luis, email: '' }]),
    subject('two', 'Finanzas [G.EC|26/27|S5|1]', [luis, { ...ana, id: 'alias', email: 'ANA@example.edu' }]),
    subject('shared', 'Teoría [G.EC|26/27|S3-S5|1-1]', [ana, luis, maria]),
  ];
  const group = thirdYear(academicCourses(values));
  assert.deepEqual(academicCourseStudents(values, group).map(student => student.id), ['student-1', 'student-2']);
  assert.equal(academicCourseStudents(values, group)[1].email, luis.email);
  assert.equal(group.rosterComplete, true);
  assert.ok(group.rosterWarnings.some(warning => warning.includes('otros cursos')));
  assert.deepEqual(subjectsForAcademicCourse(values, group).map(subject => subject.id), ['one', 'two', 'shared']);
});

test('shared-only groups show unavailable recipients instead of guessing a year from all students', () => {
  const values = [subject('shared', 'Teoría [G.EC|26/27|S3-S5|1-1]', [ana, maria])];
  const group = thirdYear(academicCourses(values));
  assert.deepEqual(academicCourseStudents(values, group.id), []);
  assert.equal(group.rosterComplete, false);
  assert.ok(group.rosterWarnings.some(warning => warning.includes('no permite identificar')));
});

test('missing emails and stale rosters remain visible in cohort completeness', () => {
  const missing = { id: 'missing', name: 'Sin correo', email: '' };
  const values = [subject('a', 'Asignatura [G.EC|26/27|S5|1]', [ana, missing], { syncStatus: { students: 'error' }, rosterComplete: false })];
  const group = thirdYear(academicCourses(values));
  assert.equal(academicCourseStudents(values, group).length, 2);
  assert.equal(group.rosterComplete, false);
  assert.equal(group.rosterWarnings.length, 2);
});

test('explicit demo/import metadata is supported without modifying the stored data', () => {
  const membership = { degreeCode: 'G.EC', degree: 'Grado en Economía', academicPeriod: '2026/27', studyYear: 3 };
  const value = subject('demo', 'Finanzas de demostración', [ana], { source: undefined, isDemo: true, academicMemberships: [membership] });
  const snapshot = structuredClone(value);
  const groups = academicCourses([value]);
  assert.equal(groups[0].name, '3º de Grado en Economía');
  assert.equal(groups[0].isDemo, true);
  assert.equal(groups[0].rosterComplete, true);
  assert.deepEqual(value, snapshot);
  assert.equal(academicCourses([{ ...value, academicMemberships: [], academic: membership }]).length, 1);
  assert.deepEqual(subjectAcademicMemberships({ academic: { ...membership, studyYear: -1 } }), []);
});

test('incomplete or malformed codes never produce confident course identification', () => {
  for (const name of ['Econometría [G.EC|26/27]', 'Asignatura [G.EC|26/28|S5|1]', 'Asignatura [G.EC|26/27|S0|1]', 'Asignatura [G.EC|26/27|Semestre tercero|1]', 'Grado en Economía']) {
    assert.deepEqual(subjectAcademicMemberships({ name }), [], name);
  }
  assert.equal(subjectName({ name: 'Finanzas - [G.EC|26/27|S5|1] ()' }), 'Finanzas');
  assert.equal(subjectName({ name: '[G.EC|26/27|S5|1]' }), '[G.EC|26/27|S5|1]');
  assert.deepEqual(academicCourseStudents([], 'missing'), []);
});
