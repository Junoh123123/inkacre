import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r18: 조건부 색상, moving a data source, form 조건부 로직, the database lock and page layout.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r18-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r18-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  const undo = result => w.undo({ id: `r18-undo-${++i}`, actor: 'test', expectedRevision: w.revision, targetCommandId: result.commandId });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'root', title: '업무 DB' }, { type: 'source.create', id: 'work', pageId: 'root', name: '업무', titlePropertyId: 'name' },
    { type: 'property.create', id: 'status', sourceId: 'work', name: '상태', propertyType: 'select', options: [{ id: 'todo', name: '할 일', color: 'blue' }, { id: 'done', name: '완료', color: 'green' }] },
    { type: 'property.create', id: 'n', sourceId: 'work', name: '점수', propertyType: 'number' },
    { type: 'page.create', id: 'a', sourceId: 'work', title: 'A' }, { type: 'page.create', id: 'b', sourceId: 'work', title: 'B' }, { type: 'page.create', id: 'c', sourceId: 'work', title: 'C' },
    { type: 'value.set', pageId: 'a', propertyId: 'status', value: 'todo' }, { type: 'value.set', pageId: 'b', propertyId: 'status', value: 'done' },
    { type: 'value.set', pageId: 'a', propertyId: 'n', value: 3 }, { type: 'value.set', pageId: 'c', propertyId: 'n', value: 9 },
    { type: 'view.create', id: 'table', sourceId: 'work', parentId: 'root', name: '표', viewType: 'table', config: {} },
    { type: 'page.create', id: 'other', title: '다른 페이지' },
  ]);
  return { w, apply, undo };
}

test('조건부 색상: the first matching rule colours the row or one cell; option colours follow the option', t => {
  const f = fixture(t);
  f.apply([{ type: 'view.update', id: 'table', config: { conditionalColors: [
    { id: 'r1', propertyId: 'n', op: 'gt', value: 5, color: 'red', applyTo: 'property' },
    { id: 'r2', propertyId: 'status', op: 'not_empty', matchOption: true, applyTo: 'row' },
    { id: 'r3', propertyId: 'n', op: 'not_empty', color: 'gray' },
  ] } }]);
  const rows = Object.fromEntries(f.w.query({ viewId: 'table' }).rows.map(row => [row.id, row.colors]));
  assert.deepEqual(rows.a, { row: 'blue' }, 'the status rule matches first and takes the option colour');
  assert.deepEqual(rows.b, { row: 'green' });
  assert.deepEqual(rows.c, { cells: { n: 'red' }, row: 'gray' }, 'a cell rule colours only its property; the row takes the first row rule that matches');
  assert.throws(() => f.apply([{ type: 'view.update', id: 'table', config: { conditionalColors: [{ id: 'x', propertyId: 'n', op: 'gt', value: 1, color: 'neon' }] } }]));
});

test('a data source moves with its views to another page in one command, and not into itself', t => {
  const f = fixture(t);
  const result = f.apply([{ type: 'node.move', id: 'work', parentId: 'other' }, { type: 'node.move', id: 'table', parentId: 'other' }]);
  assert.equal(f.w.get('work').entity.parentId, 'other');
  assert.equal(f.w.get('table').entity.parentId, 'other');
  f.undo(result);
  assert.equal(f.w.get('work').entity.parentId, 'root');
  assert.throws(() => f.apply([{ type: 'node.move', id: 'work', parentId: 'a' }]), { code: 'INVALID_PARENT' });
});

test('form questions keep 조건부 로직 rules (answer → questions to show)', t => {
  const f = fixture(t);
  f.apply([{ type: 'view.create', id: 'form', sourceId: 'work', parentId: 'root', name: '양식', viewType: 'form', config: { form: { title: '', description: '', questions: [
    { propertyId: 'status', logic: [{ value: 'done', show: ['n'] }] }, { propertyId: 'n' },
  ] } } }]);
  assert.deepEqual(f.w.get('form').entity.config.form.questions[0].logic, [{ value: 'done', show: ['n'] }]);
});

test('데이터베이스 잠금 and 페이지 레이아웃 are stored on the source and undo together', t => {
  const f = fixture(t);
  const result = f.apply([{ type: 'source.update', id: 'work', locked: true, pageLayout: { structure: 'tabs', hidden: ['n'], panel: ['status'], discussion: false } }]);
  let source = f.w.get('work').entity;
  assert.equal(source.locked, true);
  assert.deepEqual(source.pageLayout.panel, ['status']);
  assert.equal(source.name, '업무', 'the name is kept');
  f.undo(result);
  source = f.w.get('work').entity;
  assert.equal(source.locked, undefined);
  assert.equal(source.pageLayout, undefined);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'work' }]), 'something to change is required');
  f.apply([{ type: 'property.create', id: 'foreign', sourceId: 'work', name: 'x', propertyType: 'text' }, { type: 'page.create', id: 'db2', title: 'DB2' }, { type: 'source.create', id: 'other-source', pageId: 'db2', name: '다른', titlePropertyId: 'other-title' }]);
  assert.throws(() => f.apply([{ type: 'source.update', id: 'other-source', pageLayout: { panel: ['n'] } }]), { code: 'LAYOUT_PROPERTY' });
});
