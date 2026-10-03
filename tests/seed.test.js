import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, upgradeWorkspace, VARIABLES, weeklyTemplate } from '../src/seed.js';

test('new workspaces append the weekly summary without changing the existing template order', () => {
  const state = createInitialState();
  assert.equal(state.catalogVersion, 1);
  assert.deepEqual(state.templates.map((template) => template.id), [
    'template-reminder',
    'template-preparation',
    'template-schedule-change',
    'template-weekly-summary',
  ]);
  assert.deepEqual(state.templates.at(-1), weeklyTemplate());
  assert.deepEqual(state.courses, []);
  assert.deepEqual(state.drafts, []);
  assert.equal(state.composer, null);
});

test('weekly summary provides reusable Spanish sections with known placeholders', () => {
  const template = weeklyTemplate();
  assert.equal(template.kind, 'weekly');
  assert.equal(template.name, 'Resumen semanal');
  assert.equal(template.subject, 'Semana del {{week_start_day}} al {{week_end_day}} | {{course_name}}');
  assert.deepEqual(template.body.split('\n\n'), [
    '{{greeting}}', '{{weekly_intro}}', '{{weekly_agenda}}', '{{general_notices}}', '{{closing}}',
    '{{coordinator_name}}\n{{signature}}',
  ]);
  const keys = new Set(VARIABLES.map((variable) => variable.key));
  for (const match of `${template.subject}\n${template.body}`.matchAll(/\{\{(\w+)\}\}/g)) {
    assert.ok(keys.has(match[1]), `Unknown placeholder: ${match[1]}`);
  }
  assert.equal(keys.size, VARIABLES.length);
  assert.notStrictEqual(weeklyTemplate(), template);
});

test('upgrading an old workspace preserves custom templates and saved user content without mutation', () => {
  const customTemplate = { id: 'custom', name: 'Mi plantilla', subject: 'Mi asunto', body: 'Mi texto' };
  const old = {
    version: 1,
    templates: [customTemplate],
    courses: [{ id: 'course-1', students: [{ email: 'student@example.com' }] }],
    composer: { templateId: 'custom', bodyOverride: 'Trabajo en curso' },
    drafts: [{ id: 'draft-1', body: 'Borrador existente' }],
    settings: { name: 'Coordinación', signature: 'Mi firma' },
    customProperty: 'preserved',
  };
  const snapshot = structuredClone(old);
  const { state, changed } = upgradeWorkspace(old);
  assert.equal(changed, true);
  assert.equal(state.catalogVersion, 1);
  assert.equal(state.templates.length, 2);
  assert.strictEqual(state.templates[0], customTemplate);
  assert.equal(state.templates[1].id, 'template-weekly-summary');
  for (const key of ['courses', 'composer', 'drafts', 'settings', 'customProperty']) {
    assert.strictEqual(state[key], old[key]);
  }
  assert.notStrictEqual(state, old);
  assert.notStrictEqual(state.templates, old.templates);
  assert.deepEqual(old, snapshot);
});

test('upgrading preserves an existing weekly template with user edits', () => {
  const customized = { ...weeklyTemplate(), subject: 'Asunto editado', body: 'Contenido editado' };
  const old = { version: 1, templates: [customized] };
  const { state, changed } = upgradeWorkspace(old);
  assert.equal(changed, true);
  assert.equal(state.catalogVersion, 1);
  assert.strictEqual(state.templates, old.templates);
  assert.deepEqual(state.templates, [customized]);
});

test('workspace upgrades are idempotent and respect later deletion of the weekly template', () => {
  const { state: upgraded } = upgradeWorkspace({ version: 1, templates: [] });
  assert.deepEqual(upgradeWorkspace(upgraded), { state: upgraded, changed: false });
  assert.strictEqual(upgradeWorkspace(upgraded).state, upgraded);

  const afterDeletion = { ...upgraded, templates: [] };
  const result = upgradeWorkspace(afterDeletion);
  assert.equal(result.changed, false);
  assert.strictEqual(result.state, afterDeletion);
  assert.deepEqual(result.state.templates, []);

  const future = { ...afterDeletion, catalogVersion: 2 };
  assert.deepEqual(upgradeWorkspace(future), { state: future, changed: false });
});
