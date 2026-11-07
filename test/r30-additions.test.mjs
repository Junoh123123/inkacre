import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r30 (coverage phase 5: databases and automations): database page or inline, comments on property values, date
// display formats, "hide when empty", formatted text values, dashboards, trigger conditions and text with @tokens
// in automations, the formula editor's check, buttons inserting whole block trees, and sprints.
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r30-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r30-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'db', title: '작업' },
    { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 'title' },
    { type: 'property.create', id: 'st', sourceId: 's', name: '상태', propertyType: 'status', options: [{ id: 'todo', name: '할 일', group: 'todo' }, { id: 'done', name: '완료', group: 'complete' }] },
    { type: 'property.create', id: 'note', sourceId: 's', name: '메모', propertyType: 'text' },
    { type: 'property.create', id: 'n', sourceId: 's', name: '점수', propertyType: 'number' },
    { type: 'property.create', id: 'due', sourceId: 's', name: '마감', propertyType: 'date' },
    { type: 'page.create', id: 'a', title: '가', sourceId: 's' }, { type: 'value.set', pageId: 'a', propertyId: 'n', value: 3 },
    { type: 'page.create', id: 'b', title: '나', sourceId: 's' }, { type: 'value.set', pageId: 'b', propertyId: 'st', value: 'done' },
  ]);
  return { w, apply, objects: () => w.snapshot().objects, get: id => w.snapshot().objects.find(item => item.id === id) };
}

test('a page is a database page or holds its database inline, as set', t => {
  const { w, apply, get } = fixture(t);
  apply([{ type: 'page.update', id: 'db', databasePage: false }]);
  assert.equal(get('db').databasePage, false);
  apply([{ type: 'page.update', id: 'db', databasePage: null }]);
  assert.equal(get('db').databasePage, undefined);
  const bundle = w.export({ id: 'db', format: 'bundle' });
  apply([{ type: 'page.update', id: 'db', databasePage: true }]);
  assert.ok(w.previewImport({ format: 'bundle', text: bundle.text }).operations.length);
});

test('comments on a property value stay with that property and its replies', t => {
  const { apply, get } = fixture(t);
  apply([{ type: 'comment.create', id: 'c1', parentId: 'a', propertyId: 'n', richText: [{ text: '점수가 맞나요?' }] }]);
  apply([{ type: 'comment.create', id: 'c2', parentId: 'a', propertyId: 'n', threadId: 'c1', richText: [{ text: '네' }] }]);
  assert.equal(get('c2').propertyId, 'n');
  assert.throws(() => apply([{ type: 'comment.create', parentId: 'a', threadId: 'c1', richText: [{ text: '다른 대상' }] }]), /답글/);
  apply([{ type: 'page.create', id: 'plain', title: '일반' }]);
  assert.throws(() => apply([{ type: 'comment.create', parentId: 'plain', propertyId: 'n', richText: [{ text: 'x' }] }]), /속성/);
});

test('date properties keep a display format; layouts hide a property when it is empty', t => {
  const { apply, get } = fixture(t);
  apply([{ type: 'property.update', id: 'due', dateFormat: 'ymd', timeFormat: '24' }]);
  assert.deepEqual([get('due').dateFormat, get('due').timeFormat], ['ymd', '24']);
  apply([{ type: 'property.update', id: 'due', dateFormat: null }]);
  assert.equal(get('due').dateFormat, undefined);
  assert.throws(() => apply([{ type: 'property.update', id: 'n', dateFormat: 'ymd' }]), /날짜/);
  apply([{ type: 'source.update', id: 's', pageLayout: { hideWhenEmpty: ['note', 'due'] } }]);
  assert.deepEqual(get('s').pageLayout.hideWhenEmpty, ['note', 'due']);
  apply([{ type: 'value.set', pageId: 'a', propertyId: 'due', value: { start: '2026-11-03T15:00:00+09:00', timeZone: 'Asia/Seoul' } }]);
  assert.equal(get('a').values.due.timeZone, 'Asia/Seoul');
});

test('formatted text values keep their runs; filters, formulas and exports read the words', t => {
  const { w, apply, get } = fixture(t);
  apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: [{ text: '중요', bold: true }, { text: ' 메모 ' }, { text: '링크', href: 'https://example.com' }] }]);
  assert.equal(get('a').values.note.length, 3);
  apply([{ type: 'value.set', pageId: 'b', propertyId: 'note', value: [{ text: '그냥 글' }] }]);
  assert.equal(get('b').values.note, '그냥 글');
  const rows = w.query({ sourceId: 's', filter: { propertyId: 'note', op: 'contains', value: '중요 메모' } }).rows;
  assert.deepEqual(rows.map(row => row.id), ['a']);
  assert.equal(rows[0].values.note, '중요 메모 링크');
  assert.equal(rows[0].rich.note[0].bold, true);
  apply([{ type: 'property.create', id: 'f', sourceId: 's', name: '길이', propertyType: 'formula', formula: 'length(prop("메모"))' }]);
  assert.equal(w.query({ sourceId: 's' }).rows.find(row => row.id === 'a').values.f, 8);
  assert.match(w.export({ id: 's', format: 'csv' }).text, /중요 메모 링크/);
  assert.throws(() => apply([{ type: 'value.set', pageId: 'a', propertyId: 'note', value: [{ text: 'x', bogus: 1 }] }]), /형식/);
});

test('the formula editor checks a formula and works it out for the first rows', t => {
  const { w } = fixture(t);
  const ok = w.previewFormula({ sourceId: 's', formula: 'prop("점수") * 10' });
  assert.equal(ok.ok, true);
  assert.equal(ok.rows.find(row => row.id === 'a').value, 30);
  assert.equal(ok.rows.length, 2);
  const bad = w.previewFormula({ sourceId: 's', formula: 'prop("없는 속성")' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'FORMULA_REF');
});

test('dashboards keep rows of up to four widgets and filters per data source', t => {
  const { apply, get } = fixture(t);
  apply([
    { type: 'view.create', id: 'v1', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: {} },
    { type: 'view.create', id: 'v2', sourceId: 's', parentId: 'db', name: '보드', viewType: 'board', config: { groupBy: 'st' } },
    { type: 'view.create', id: 'dash', sourceId: 's', parentId: 'db', name: '대시보드', viewType: 'dashboard', config: { widgets: ['v1', 'v2'] } },
  ]);
  apply([{ type: 'view.update', id: 'dash', config: { widgets: ['v1', 'v2'], dashboardRows: [['v2'], ['v1']], dashboardFilters: { s: { propertyId: 'st', op: 'eq', value: 'todo' } } } }]);
  assert.deepEqual(get('dash').config.dashboardRows, [['v2'], ['v1']]);
  assert.throws(() => apply([{ type: 'view.update', id: 'dash', config: { widgets: ['v1'], dashboardRows: [['v1', 'v1']] } }]), /대시보드/);
});

test('automations: a condition on the edited value, and @tokens in a notice and a new page title', t => {
  const { w, apply, objects } = fixture(t);
  apply([{ type: 'automation.create', id: 'auto', sourceId: 's', name: '높은 점수', triggers: [{ type: 'property_edited', propertyId: 'n', condition: { op: 'gt', value: 5 } }],
    actions: [{ action: 'notify', message: '{{title}} 점수 {{n}}' }, { action: 'add_page', sourceId: 's', title: '후속: {{title}}', values: { st: 'todo' } }] }]);
  apply([{ type: 'value.set', pageId: 'a', propertyId: 'n', value: 4 }]);
  assert.equal(objects().filter(item => item.kind === 'notification').length, 0);
  apply([{ type: 'value.set', pageId: 'a', propertyId: 'n', value: 9 }]);
  const notes = objects().filter(item => item.kind === 'notification').map(item => item.message);
  assert.deepEqual(notes, ['가 점수 9']);
  const follow = objects().find(item => item.kind === 'page' && item.title === '후속: 가');
  assert.ok(follow && follow.values.st === 'todo');
  void w;
});

test('a button inserts a whole tree of blocks — formatting, a picture, a table and nested items', t => {
  const { w, apply, objects } = fixture(t);
  const picture = w.putBlob(png);
  apply([
    { type: 'page.create', id: 'p', title: '버튼 페이지' },
    { type: 'attachment.register', id: 'attachment:pic', name: 'pic.png', mediaType: 'image/png', ...picture },
    { type: 'block.create', id: 'btn', parentId: 'p', blockType: 'button', richText: [], button: { label: '넣기', actions: [{ action: 'insert_blocks', position: 'below', blocks: [
      { blockType: 'callout', icon: '💡', color: 'blue_background', richText: [{ text: '굵게', bold: true }], children: [{ blockType: 'bullet', richText: [{ text: '하위' }] }] },
      { blockType: 'image', attachmentId: 'attachment:pic', richText: [], width: 200 },
      { blockType: 'table', cells: [[[{ text: 'a' }], [{ text: 'b' }]]], richText: [] },
    ] }] } },
  ]);
  apply([{ type: 'button.run', id: 'btn' }]);
  const blocks = objects().filter(item => item.kind === 'block' && item.alive);
  const callout = blocks.find(item => item.blockType === 'callout');
  assert.equal(callout.richText[0].bold, true);
  assert.ok(blocks.some(item => item.parentId === callout.id && item.blockType === 'bullet'));
  assert.equal(blocks.find(item => item.blockType === 'image' && item.parentId === 'p').width, 200);
  assert.ok(blocks.some(item => item.blockType === 'table' && item.parentId === 'p'));
});

test('sprints: the sprints database, views of the current sprint, completing a sprint moves unfinished work', t => {
  const { w, apply, get, objects } = fixture(t);
  apply([{ type: 'source.configure_sprints', id: 's', enabled: true, lengthWeeks: 1, startDay: 1, upcoming: 2, timeZone: 'UTC' }]);
  const config = get('s').tasks.sprints;
  const status = id => Object.entries(config.statusOptions).find(([, option]) => option === get(id).values[config.statusPropertyId])[0];
  const sprints = () => objects().filter(item => item.kind === 'page' && item.sourceId === config.sourceId).map(item => item.id);
  assert.deepEqual(sprints().map(status), ['current', 'next', 'future']);
  const [first] = sprints();
  apply([{ type: 'relation.set', pageId: 'a', propertyId: config.relationPropertyId, targetIds: [first] }, { type: 'relation.set', pageId: 'b', propertyId: config.relationPropertyId, targetIds: [first] }]);
  const current = objects().find(item => item.kind === 'view' && item.sourceId === 's' && JSON.stringify(item.config.filter ?? null).includes('$currentSprint'));
  assert.deepEqual(w.query({ viewId: current.id }).rows.map(row => row.id).sort(), ['a', 'b']);
  apply([{ type: 'sprint.complete', id: 's' }]);
  assert.equal(status(first), 'past');
  const now = sprints().find(id => status(id) === 'current');
  assert.deepEqual(get('a').values[config.relationPropertyId], [now]);
  assert.deepEqual(get('b').values[config.relationPropertyId], [first]);
  assert.deepEqual(w.query({ viewId: current.id }).rows.map(row => row.id), ['a']);
  assert.equal(sprints().filter(id => ['next', 'future'].includes(status(id))).length, 2);
  apply([{ type: 'source.configure_sprints', id: 's', enabled: false }]);
  assert.throws(() => apply([{ type: 'sprint.complete', id: 's' }]), /스프린트/);
});
