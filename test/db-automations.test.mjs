import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';
import { automationOccurrence, scheduleEnded } from '../src/automation.mjs';

// Database automations (⚡): triggers on added pages, edited properties and schedules; actions run inside the
// command that set them off.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-db-automation-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `dba-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  const undo = result => w.undo({ id: `dba-undo-${++i}`, actor: 'test', expectedRevision: w.revision, targetCommandId: result.commandId });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'root', title: '자동화 DB' }, { type: 'source.create', id: 'work', pageId: 'root', name: '업무', titlePropertyId: 'name' },
    { type: 'property.create', id: 'status', sourceId: 'work', name: '상태', propertyType: 'select', options: [{ id: 'todo', name: '할 일' }, { id: 'done', name: '완료' }] },
    { type: 'property.create', id: 'checked', sourceId: 'work', name: '확인', propertyType: 'checkbox' },
    { type: 'property.create', id: 'note', sourceId: 'work', name: '메모', propertyType: 'text' },
    { type: 'page.create', id: 'a', sourceId: 'work', title: 'A' },
    { type: 'page.create', id: 'other-root', title: '다른 DB' }, { type: 'source.create', id: 'other', pageId: 'other-root', name: '다른', titlePropertyId: 'other-name' },
    { type: 'property.create', id: 'other-text', sourceId: 'other', name: '글', propertyType: 'text' },
    { type: 'view.create', id: 'open-view', sourceId: 'work', parentId: 'root', name: '열린 항목', viewType: 'table', config: { filter: { propertyId: 'checked', op: 'neq', value: true } } },
  ]);
  return { w, apply, undo, value: (id, key) => w.get(id).entity.values?.[key] };
}

test('a page added runs the actions in the same command, and one undo removes both', t => {
  const f = fixture(t);
  f.apply([{ type: 'automation.create', id: 'auto', sourceId: 'work', name: '새 업무', triggers: [{ type: 'page_added' }], actions: [{ action: 'set_property', propertyId: 'status', value: 'todo' }] }]);
  const result = f.apply([{ type: 'page.create', id: 'b', sourceId: 'work', title: 'B' }]);
  assert.equal(f.value('b', 'status'), 'todo');
  assert.equal(f.value('a', 'status'), undefined, 'existing pages are not touched');
  f.undo(result);
  assert.throws(() => f.w.get('b'), { code: 'NOT_FOUND' });
});

test('an edited property fires only for the chosen options, and automations do not set each other off', t => {
  const f = fixture(t);
  f.apply([
    { type: 'automation.create', id: 'on-done', sourceId: 'work', triggers: [{ type: 'property_edited', propertyId: 'status', values: ['done'] }], actions: [{ action: 'set_property', propertyId: 'checked', value: true }] },
    { type: 'automation.create', id: 'on-checked', sourceId: 'work', triggers: [{ type: 'property_edited', propertyId: 'checked' }], actions: [{ action: 'set_property', propertyId: 'note', value: '연쇄' }] },
  ]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'status', value: 'todo' }]);
  assert.equal(f.value('a', 'checked'), undefined);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'status', value: 'done' }]);
  assert.equal(f.value('a', 'checked'), true);
  assert.equal(f.value('a', 'note'), undefined, 'the change made by an automation does not trigger another');
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'checked', value: false }]);
  assert.equal(f.value('a', 'note'), '연쇄', 'a person editing the property does');
});

test('any edited property includes the title; setting the same value again is not an edit', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: '그대로' }, { type: 'automation.create', id: 'any', sourceId: 'work', triggers: [{ type: 'any_property_edited' }], actions: [{ action: 'set_property', propertyId: 'checked', value: true }] }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: '그대로' }]);
  assert.equal(f.value('a', 'checked'), undefined);
  f.apply([{ type: 'page.update', id: 'a', title: 'A2' }]);
  assert.equal(f.value('a', 'checked'), true);
});

test('"all" needs every condition; "any" needs one; the view scope and switching off are respected', t => {
  const f = fixture(t);
  f.apply([{ type: 'automation.create', id: 'both', sourceId: 'work', match: 'all', triggers: [{ type: 'property_edited', propertyId: 'status', values: ['done'] }, { type: 'property_edited', propertyId: 'checked', values: [true] }], actions: [{ action: 'set_property', propertyId: 'note', value: '둘 다' }] }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'status', value: 'done' }]);
  assert.equal(f.value('a', 'note'), undefined);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'checked', value: true }]);
  assert.equal(f.value('a', 'note'), '둘 다');
  f.apply([{ type: 'automation.update', id: 'both', enabled: false }, { type: 'value.set', pageId: 'a', propertyId: 'note', value: null }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'status', value: 'todo' }, { type: 'value.set', pageId: 'a', propertyId: 'status', value: 'done' }]);
  assert.equal(f.value('a', 'note') ?? null, null, 'a switched-off automation does nothing');
  // Scoped to a view: only pages the view shows.
  f.apply([{ type: 'automation.create', id: 'scoped', sourceId: 'work', match: 'any', viewId: 'open-view', triggers: [{ type: 'property_edited', propertyId: 'note' }], actions: [{ action: 'set_property', propertyId: 'status', value: 'todo' }] }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: '보기 밖' }]);
  assert.equal(f.value('a', 'status'), 'done', 'the page is checked, so the view does not show it');
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'checked', value: false }, { type: 'value.set', pageId: 'a', propertyId: 'note', value: '보기 안' }]);
  assert.equal(f.value('a', 'status'), 'todo');
  f.apply([{ type: 'automation.delete', id: 'scoped' }, { type: 'value.set', pageId: 'a', propertyId: 'status', value: 'done' }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: '삭제 후' }]);
  assert.equal(f.value('a', 'status'), 'done');
});

test('a failing automation leaves the edit in place and leaves a note instead', t => {
  const f = fixture(t);
  f.apply([{ type: 'automation.create', id: 'broken', name: '고장', sourceId: 'work', triggers: [{ type: 'property_edited', propertyId: 'note' }], actions: [{ action: 'set_property', propertyId: 'checked', value: true }, { action: 'set_property', propertyId: 'status', value: 'missing-option' }] }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: '편집' }]);
  assert.equal(f.value('a', 'note'), '편집');
  assert.equal(f.value('a', 'checked'), undefined, 'the earlier action of the failed run is rolled back');
  const notes = f.w.snapshot().objects.filter(item => item.kind === 'notification' && item.parentId === 'a');
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /고장/);
});

test('schedules: daily runs from the scheduler, weekdays skip weekends, the end date stops it', t => {
  const f = fixture(t);
  const start = new Date(Date.now() + 60000).toISOString().slice(0, 16);
  f.apply([{ type: 'automation.create', id: 'daily', sourceId: 'work', triggers: [{ type: 'recurring', schedule: { frequency: 'day', interval: 1, start, timeZone: 'UTC' } }], actions: [{ action: 'add_page', sourceId: 'work', title: '매일 점검' }] }]);
  const nextAt = f.w.get('daily').entity.schedule.nextAt;
  assert.equal(f.w.tick(new Date(Date.parse(nextAt) - 1000).toISOString()), null, 'nothing before it is due');
  f.w.tick(new Date(Date.parse(nextAt) + 1000).toISOString());
  const pages = () => f.w.snapshot().objects.filter(item => item.kind === 'page' && item.title === '매일 점검' && item.alive);
  assert.equal(pages().length, 1);
  assert.equal(Date.parse(f.w.get('daily').entity.schedule.nextAt) - Date.parse(nextAt), 86400000);
  // 2026-10-23 is a Friday: the next weekday run is Monday the 26th.
  const weekday = { frequency: 'weekday', interval: 1, start: '2026-10-23T09:00', timeZone: 'UTC' };
  assert.equal(automationOccurrence(weekday, 0), '2026-10-23T09:00:00.000Z');
  assert.equal(automationOccurrence(weekday, 1), '2026-10-26T09:00:00.000Z');
  assert.equal(scheduleEnded({ ...weekday, end: '2026-10-25' }, '2026-10-26T09:00:00.000Z'), true);
  assert.equal(scheduleEnded({ ...weekday, end: '2026-10-26' }, '2026-10-26T09:00:00.000Z'), false);
});

test('checks: a schedule stands alone and cannot change "this page"; properties belong to the database', t => {
  const f = fixture(t);
  const schedule = { frequency: 'week', interval: 1, start: '2030-01-01T09:00', timeZone: 'UTC' };
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'recurring', schedule }, { type: 'page_added' }], actions: [{ action: 'notify', message: 'x' }] }]), { code: 'AUTOMATION_TRIGGER' });
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'recurring', schedule }], actions: [{ action: 'set_property', propertyId: 'checked', value: true }] }]), { code: 'AUTOMATION_PAGE' });
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'property_edited', propertyId: 'other-text' }], actions: [{ action: 'notify', message: 'x' }] }]), { code: 'AUTOMATION_PROPERTY' });
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'page_added' }], actions: [{ action: 'open_page', targetId: 'a' }] }]));
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'page_added' }], actions: [] }]));
});

test('변수 정의: formulas and text fill later actions; a variable must be defined before it is used', t => {
  const f = fixture(t);
  f.apply([{ type: 'property.create', id: 'amount', sourceId: 'work', name: '금액', propertyType: 'number' }]);
  f.apply([{ type: 'automation.create', id: 'vars', sourceId: 'work', triggers: [{ type: 'property_edited', propertyId: 'status' }], actions: [
    { action: 'define_variables', variables: [
      { id: 'v1', name: '변수 1', mode: 'formula', value: '1 + 2' },
      { id: 'v2', name: '두 배', mode: 'formula', value: 'prop("변수 1") * 2' },
      { id: 'v3', name: '설명', mode: 'text', value: '상태 {{status}} · {{var:v2}}' },
    ] },
    { action: 'set_property', propertyId: 'amount', value: { $variable: 'v2' } },
    { action: 'set_property', propertyId: 'note', value: { $variable: 'v3' } },
    { action: 'set_property', propertyId: 'checked', value: { $formula: 'prop("두 배") > 5' } },
  ] }]);
  f.apply([{ type: 'value.set', pageId: 'a', propertyId: 'status', value: 'done' }]);
  assert.equal(f.value('a', 'amount'), 6);
  assert.equal(f.value('a', 'note'), '상태 완료 · 6');
  assert.equal(f.value('a', 'checked'), true);
  // A variable used before its definition, or a formula that does not compile, is refused when saving.
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'page_added' }], actions: [{ action: 'set_property', propertyId: 'amount', value: { $variable: 'later' } }, { action: 'define_variables', variables: [{ id: 'later', name: '나중', mode: 'text', value: 'x' }] }] }]), { code: 'AUTOMATION_VARIABLE' });
  assert.throws(() => f.apply([{ type: 'automation.create', sourceId: 'work', triggers: [{ type: 'page_added' }], actions: [{ action: 'define_variables', variables: [{ id: 'bad', name: '틀림', mode: 'formula', value: 'prop("없는 속성")' }] }] }]), { code: 'FORMULA_REF' });
});
