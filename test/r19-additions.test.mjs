import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r19: an empty row page picks a template.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r19-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r19-${++i}`, actor: 'test', expectedRevision: w.revision, operations });
  const undo = result => w.undo({ id: `r19-undo-${++i}`, actor: 'test', expectedRevision: w.revision, targetCommandId: result.commandId });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'root', title: '업무 DB' }, { type: 'source.create', id: 'work', pageId: 'root', name: '업무', titlePropertyId: 'name' },
    { type: 'property.create', id: 'status', sourceId: 'work', name: '상태', propertyType: 'select', options: [{ id: 'todo', name: '할 일' }, { id: 'done', name: '완료' }] },
    { type: 'property.create', id: 'note', sourceId: 'work', name: '메모', propertyType: 'text' },
    { type: 'page.create', id: 'tpl', sourceId: 'work', title: '회의록', template: true },
    { type: 'value.set', pageId: 'tpl', propertyId: 'status', value: 'todo' }, { type: 'value.set', pageId: 'tpl', propertyId: 'note', value: '템플릿 메모' },
    { type: 'block.create', id: 'tb1', parentId: 'tpl', blockType: 'heading2', richText: [{ text: '안건' }] },
    { type: 'block.create', id: 'tb2', parentId: 'tpl', blockType: 'todo', richText: [{ text: '할 일' }] },
    { type: 'page.create', id: 'row', sourceId: 'work', title: '' },
    { type: 'value.set', pageId: 'row', propertyId: 'note', value: '내 메모' },
  ]);
  return { w, apply, undo };
}

test('apply_template fills an empty row: content, empty values and the title; the number and own values stay; one undo', t => {
  const f = fixture(t);
  const before = f.w.get('row').entity;
  const result = f.apply([{ type: 'page.apply_template', id: 'row', templateId: 'tpl' }]);
  const page = f.w.get('row').entity;
  const blocks = f.w.snapshot().objects.filter(item => item.kind === 'block' && item.parentId === 'row' && item.alive);
  assert.deepEqual(blocks.map(block => block.richText[0].text), ['안건', '할 일']);
  assert.equal(page.values.status, 'todo', 'an empty value takes the template value');
  assert.equal(page.values.note, '내 메모', 'a value already there is kept');
  assert.equal(page.title, '회의록');
  assert.equal(page.uniqueId, before.uniqueId, 'the row keeps its number');
  assert.equal(f.w.snapshot().objects.filter(item => item.kind === 'page' && item.sourceId === 'work' && !item.template && item.alive).length, 1, 'no scratch page is left');
  f.undo(result);
  assert.equal(f.w.snapshot().objects.filter(item => item.kind === 'block' && item.parentId === 'row' && item.alive).length, 0);
  assert.equal(f.w.get('row').entity.title, '');
  assert.throws(() => f.apply([{ type: 'page.apply_template', id: 'row', templateId: 'row' }]), { code: 'TEMPLATE_SOURCE' });
});

test('updates lists a page\'s edits (merged per actor), value changes before → after, added blocks and comments', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'row', propertyId: 'status', value: 'todo' }]);
  f.apply([{ type: 'value.set', pageId: 'row', propertyId: 'status', value: 'done' }, { type: 'block.create', id: 'rb1', parentId: 'row', blockType: 'paragraph', richText: [{ text: '새 문단' }] }]);
  f.apply([{ type: 'comment.create', id: 'c1', parentId: 'rb1', richText: [{ text: '확인 부탁' }] }]);
  f.apply([{ type: 'block.update', id: 'rb1', richText: [{ text: '새 문단', comments: ['c1'] }] }]);
  const entries = f.w.updates('row');
  assert.equal(entries[0].kind, 'edit');
  assert.equal(entries[1].kind, 'comment');
  assert.equal(entries[1].comment.richText[0].text, '확인 부탁');
  const created = entries.find(entry => entry.kind === 'create');
  assert.ok(created, 'the page creation and the edits right after merge into one entry');
  const status = created.properties.find(change => change.propertyId === 'status');
  assert.deepEqual([status.before, status.after], [null, 'done']);
  assert.deepEqual(created.blocks.map(block => [block.id, block.change]), [['rb1', 'added']]);
  assert.deepEqual(f.w.updates('tpl').map(entry => entry.kind), ['create']);
});
