import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace, canonical } from '../src/workspace.mjs';
import { patchRuns, toggleMark } from '../web/rich-text.mjs';

export function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-test-'));
  let workspace = new Workspace(directory), sequence = 0;
  const apply = (operations, extra = {}) => workspace.execute({ id: `command-${++sequence}`, actor: 'test-user', expectedRevision: workspace.revision, operations, ...extra });
  const reopen = () => { workspace.close(); workspace = new Workspace(directory); return workspace; };
  t.after(() => { workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'root', title: '합성 기능 검증' },
    { type: 'page.create', id: 'doc', parentId: 'root', title: '회의 원문' },
    { type: 'source.create', id: 'items', pageId: 'root', name: '항목', titlePropertyId: 'name' },
    { type: 'property.create', id: 'amount', sourceId: 'items', name: 'Amount', propertyType: 'number' },
    { type: 'property.create', id: 'double', sourceId: 'items', name: 'Double', propertyType: 'formula', formula: 'prop("Amount") * 2' },
    { type: 'property.create', id: 'state', sourceId: 'items', name: 'State', propertyType: 'status', options: [{ id: 'todo', name: '대기', group: 'todo' }, { id: 'done', name: '완료', group: 'complete' }] },
    { type: 'property.create', id: 'due', sourceId: 'items', name: 'Due', propertyType: 'date' },
    { type: 'property.create', id: 'notes', sourceId: 'items', name: 'Notes', propertyType: 'text' },
    { type: 'property.create', id: 'files', sourceId: 'items', name: 'Files', propertyType: 'files' },
    { type: 'property.create', id: 'related', sourceId: 'items', name: 'Related', propertyType: 'relation', targetSourceId: 'items', inverse: { id: 'backlinks', name: 'Backlinks' } },
    { type: 'property.create', id: 'total', sourceId: 'items', name: 'RelatedAmount', propertyType: 'rollup', rollup: { relationPropertyId: 'related', targetPropertyId: 'amount', aggregation: 'sum' } },
    ...['a1', 'a2', 'a3'].map(id => ({ type: 'page.create', id, title: id.toUpperCase(), sourceId: 'items' })),
    ...[10, 20, 5].map((value, index) => ({ type: 'value.set', pageId: `a${index + 1}`, propertyId: 'amount', value })),
    ...['a1', 'a2', 'a3'].map(pageId => ({ type: 'value.set', pageId, propertyId: 'state', value: 'todo' })),
    { type: 'relation.set', pageId: 'a1', propertyId: 'related', targetIds: ['a2', 'a3'] },
    { type: 'view.create', id: 'active', sourceId: 'items', parentId: 'root', name: '진행 중', config: { filter: { propertyId: 'state', op: 'neq', value: 'done' }, sorts: [{ propertyId: 'amount', direction: 'asc' }, { propertyId: 'name', direction: 'asc' }] } },
  ]);
  return { get workspace() { return workspace; }, apply, reopen, directory };
}

test('body attachment registration, replacement, detachment and undo preserve bytes and atomicity', t => {
  const f = fixture(t), bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64');
  const blob = f.workspace.putBlob(bytes);
  f.apply([{ type: 'block.create', id: 'after-media', parentId: 'doc', richText: [{ text: '기존 본문' }] }]);
  const command = { id: 'body-upload', actor: 'user', expectedRevision: f.workspace.revision, operations: [{ type: 'attachment.register', id: 'body-png', name: 'generated.png', mediaType: 'image/png', ...blob,
    reference: { parentId: 'doc', blockId: 'body-image', blockType: 'image', beforeId: 'after-media' } }] };
  const result = f.workspace.execute(command);
  assert.equal(f.workspace.get('body-image').entity.attachmentId, 'body-png');
  assert.deepEqual(f.workspace.get('doc').entity.children.map(item => item.id), ['body-image', 'after-media']);
  f.reopen(); assert.equal(f.workspace.execute(command).replayed, true);
  assert.deepEqual(f.workspace.attachmentBytes('body-png').bytes, bytes);
  const undo = f.workspace.undo({ id: 'undo-body-upload', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: result.commandId });
  assert.throws(() => f.workspace.get('body-image'), { code: 'NOT_FOUND' });
  f.workspace.undo({ id: 'redo-body-upload', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: undo.commandId });
  const before = canonical(f.workspace.snapshot());
  assert.throws(() => f.apply([{ type: 'attachment.register', id: 'invalid-media', name: 'bad.txt', mediaType: 'text/plain', ...blob, reference: { blockId: 'body-image' } }]), { code: 'IMAGE_MEDIA_TYPE' });
  assert.throws(() => f.apply([{ type: 'attachment.register', id: 'invalid-parent', name: 'bad.png', mediaType: 'image/png', ...blob, reference: { parentId: 'items', blockId: 'bad-block', blockType: 'image' } }]), { code: 'INVALID_PARENT' });
  assert.equal(canonical(f.workspace.snapshot()), before);
  const replacement = f.apply([{ type: 'attachment.register', id: 'body-png-2', name: 'second.png', mediaType: 'image/png', ...blob, reference: { blockId: 'body-image' } }]);
  assert.equal(f.workspace.get('body-image').entity.attachmentId, 'body-png-2');
  f.workspace.undo({ id: 'undo-replace', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: replacement.commandId });
  assert.equal(f.workspace.get('body-image').entity.attachmentId, 'body-png');
  const detached = f.apply([{ type: 'block.update', id: 'body-image', attachmentId: null }]);
  assert.equal(f.workspace.get('body-image').entity.attachmentId, null);
  assert.deepEqual(f.workspace.attachmentBytes('body-png').bytes, bytes);
  f.workspace.undo({ id: 'undo-detach', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: detached.commandId });
  assert.throws(() => f.workspace.undo({ id: 'unsafe-old-upload-undo', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: result.commandId }), { code: 'UNDO_CONFLICT' });
  assert.equal(f.workspace.get('body-image').entity.attachmentId, 'body-png');
  assert.equal(f.workspace.get('after-media').entity.richText[0].text, '기존 본문');
});

test('direct formatting, link and mention edits plus bookmark URLs survive restart, undo and stale writes', t => {
  const f = fixture(t), original = [{ text: '보존 ' }, { text: '대상', italic: true }, { text: ' 끝' }];
  f.apply([{ type: 'block.create', id: 'rich-body', parentId: 'doc', richText: original }, { type: 'block.create', id: 'bookmark', parentId: 'doc', blockType: 'bookmark' }]);
  const bold = toggleMark(original, 3, 5, 'bold'), linked = patchRuns(bold, 3, 5, { pageId: 'a1' });
  const change = f.apply([{ type: 'block.update', id: 'rich-body', richText: linked }, { type: 'block.update', id: 'bookmark', url: 'https://example.com/reference' }]);
  f.reopen(); assert.deepEqual(f.workspace.get('rich-body').entity.richText, linked);
  assert.ok(f.workspace.get('a1').entity.backlinks.some(item => item.id === 'doc'));
  assert.equal(f.workspace.get('bookmark').entity.url, 'https://example.com/reference');
  const before = canonical(f.workspace.snapshot());
  assert.throws(() => f.apply([{ type: 'block.update', id: 'bookmark', url: 'javascript:alert(1)' }]), { code: 'UNSAFE_LINK' });
  assert.equal(canonical(f.workspace.snapshot()), before);
  f.workspace.undo({ id: 'undo-rich-and-bookmark', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: change.commandId });
  assert.deepEqual(f.workspace.get('rich-body').entity.richText, original);
  assert.equal(f.workspace.get('a1').entity.backlinks.some(item => item.id === 'doc'), false);
  const stale = f.workspace.revision;
  f.apply([{ type: 'block.update', id: 'bookmark', url: 'https://example.com/agent' }], { actor: 'agent' });
  assert.throws(() => f.apply([{ type: 'block.update', id: 'bookmark', url: 'https://example.com/user' }], { expectedRevision: stale }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.workspace.get('bookmark').entity.url, 'https://example.com/agent');
});

test('durable atomic batches, replay after restart, and conflicting command IDs', t => {
  const f = fixture(t), before = canonical(f.workspace.snapshot());
  assert.throws(() => f.apply([{ type: 'page.update', id: 'a1', title: '저장되면 안 됨' }, { type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 'bad' }]), { code: 'VALUE_TYPE' });
  assert.equal(canonical(f.workspace.snapshot()), before);
  const input = { id: 'retry-key', actor: 'agent', expectedRevision: f.workspace.revision, operations: [{ type: 'page.create', id: 'once', parentId: 'root', title: '한 번만' }] };
  const result = f.workspace.execute(input); f.reopen();
  assert.equal(f.workspace.execute(input).replayed, true);
  assert.equal(f.workspace.revision, result.revision);
  assert.equal(f.workspace.snapshot().objects.filter(entity => entity.id === 'once').length, 1);
  assert.throws(() => f.workspace.execute({ ...input, actor: 'other' }), { code: 'COMMAND_ID_REUSED' });
});

test('relations unlink without deleting records; inverse and rollup change atomically; undo and redo', t => {
  const f = fixture(t);
  assert.equal(f.workspace.get('a1').entity.computed.total, 25);
  const change = f.apply([{ type: 'relation.set', pageId: 'a1', propertyId: 'related', targetIds: ['a3'] }]);
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, []);
  assert.equal(f.workspace.get('a2').entity.alive, true);
  assert.equal(f.workspace.get('a1').entity.computed.total, 5);
  const undo = f.workspace.undo({ id: 'undo-link', actor: 'test-user', expectedRevision: f.workspace.revision, targetCommandId: change.commandId });
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, ['a1']);
  assert.equal(f.workspace.get('a1').entity.computed.total, 25);
  f.workspace.undo({ id: 'redo-link', actor: 'test-user', expectedRevision: f.workspace.revision, targetCommandId: undo.commandId });
  assert.equal(f.workspace.get('a1').entity.computed.total, 5);
  assert.throws(() => f.apply([{ type: 'relation.set', pageId: 'a1', propertyId: 'related', targetIds: ['doc'] }]), { code: 'VALUE_TYPE' });
});

test('calculation definitions use stable IDs, preserve empty/zero/false, and report errors', t => {
  const f = fixture(t);
  f.apply([{ type: 'property.update', id: 'amount', name: '금액' }, { type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 15 }]);
  assert.equal(f.workspace.get('a1').entity.computed.double, 30);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'amount', value: null }]);
  assert.equal(f.workspace.get('a1').entity.computed.double, 0);
  f.apply([{ type: 'property.update', id: 'double', formula: 'if(empty(prop("amount")), 7, prop("amount") / 0)' }]);
  assert.equal(f.workspace.get('a1').entity.computed.double, 7);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 0 }]);
  assert.equal(f.workspace.get('a1').entity.computed.double, 7);
  assert.equal(f.workspace.get('a1').entity.values.amount, 0);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 1 }]);
  assert.equal(f.workspace.get('a1').entity.computed.double.error.code, 'FORMULA_DIV0');
  f.apply([{ type: 'property.update', id: 'double', formula: 'prop("double") + 1' }]);
  assert.equal(f.workspace.get('a1').entity.computed.double.error.code, 'FORMULA_CYCLE');
  assert.throws(() => f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'double', value: 999 }]), { code: 'READ_ONLY_PROPERTY' });
  assert.throws(() => f.apply([{ type: 'property.update', id: 'double', formula: 'prop(' }]), { code: 'FORMULA_SYNTAX' });
  assert.throws(() => f.apply([{ type: 'property.update', id: 'double', formula: '1e999' }]), { code: 'FORMULA_SYNTAX' });
});

test('saved filters, compound sorts, linked views, grouping and changed records remain independent', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a2', propertyId: 'amount', value: 10 },
    { type: 'view.create', id: 'linked', sourceId: 'items', parentId: 'doc', name: '연결 보기', config: { visibleProperties: ['name'] } }]);
  assert.deepEqual(f.workspace.query({ viewId: 'active' }).rows.map(row => row.id), ['a3', 'a1', 'a2']);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'state', value: 'done' }, { type: 'page.update', id: 'a2', title: '이름 변경' }]);
  assert.deepEqual(f.workspace.query({ viewId: 'active' }).rows.map(row => row.id), ['a3', 'a2']);
  assert.equal(f.workspace.get('a1').entity.computed.state, 'done');
  assert.equal(f.workspace.query({ viewId: 'linked' }).rows.find(row => row.id === 'a2').title, '이름 변경');
  assert.equal(f.workspace.query({ viewId: 'linked' }).visibleProperties.length, 1);
  assert.ok(f.workspace.query({ sourceId: 'items' }).properties.length > 1);
  f.apply([{ type: 'view.update', id: 'linked', viewType: 'board', config: { groupBy: 'state' } }]);
  assert.equal(f.workspace.query({ viewId: 'linked' }).presentation.groups.find(group => group.value === 'done').rowIds[0], 'a1');
});

test('all view adapters use actual data; calendar ranges, chart drilldown and map absence are explicit', t => {
  const f = fixture(t);
  f.apply([{ type: 'property.create', id: 'place', sourceId: 'items', name: '장소', propertyType: 'place' },
    { type: 'value.set', pageId: 'a1', propertyId: 'place', value: { name: '도쿄역', latitude: 35.681, longitude: 139.767 } },
    { type: 'value.set', pageId: 'a1', propertyId: 'due', value: { start: '2026-10-19', end: '2026-10-21', timeZone: 'Asia/Tokyo' } },
    ...['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed', 'chart', 'map', 'form', 'dashboard'].map(viewType => ({ type: 'view.create', id: viewType, sourceId: 'items', parentId: 'root', name: viewType, viewType, config: viewType === 'chart' ? { chart: { groupBy: 'state', valuePropertyId: 'amount', aggregation: 'sum' } } : viewType === 'dashboard' ? { widgets: ['table', 'chart'] } : {} }))]);
  for (const type of ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed', 'chart', 'map', 'form', 'dashboard']) assert.equal(f.workspace.query({ viewId: type }).presentation.type, type);
  const calendar = f.workspace.query({ viewId: 'calendar' }).presentation;
  assert.equal(calendar.items[0].end, '2026-10-21'); assert.equal(calendar.undated.length, 2);
  const bar = f.workspace.query({ viewId: 'chart' }).presentation.bars[0];
  assert.equal(bar.value, 35); assert.equal(f.workspace.query({ sourceId: 'items', filter: bar.drilldown }).total, 3);
  assert.equal(f.workspace.query({ viewId: 'map' }).presentation.points[0].name, '도쿄역');
  assert.equal(f.workspace.query({ viewId: 'map' }).presentation.basemap, 'not-configured');
  assert.throws(() => f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'due', value: { start: '2026-02-30' } }]), { code: 'VALUE_TYPE' });
});

test('hierarchy move/Trash/restore preserve identity and prevent parent cycles', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'child', title: '하위', parentId: 'doc' }, { type: 'block.create', id: 'body', parentId: 'child', richText: [{ text: '남아야 하는 본문', bold: true }] }]);
  assert.throws(() => f.apply([{ type: 'node.move', id: 'doc', parentId: 'child' }]), { code: 'PARENT_CYCLE' });
  f.apply([{ type: 'node.move', id: 'child', parentId: 'root', beforeId: 'doc' }, { type: 'node.trash', id: 'child' }]);
  assert.equal(f.workspace.get('body').entity.visible, false);
  f.apply([{ type: 'node.restore', id: 'child' }]);
  assert.equal(f.workspace.get('body').entity.visible, true);
  assert.equal(f.workspace.get('child').entity.parentId, 'root');
  f.apply([{ type: 'node.trash', id: 'a2' }]);
  assert.equal(f.workspace.get('a1').entity.computed.total, 5);
  assert.deepEqual(f.workspace.get('a1').entity.values.related, ['a2', 'a3']);
  f.apply([{ type: 'node.restore', id: 'a2' }]); assert.equal(f.workspace.get('a1').entity.computed.total, 25);
});

test('independent template copies and shared synced references have distinct behavior and search', t => {
  const f = fixture(t);
  f.apply([{ type: 'page.create', id: 'template', title: '기본 템플릿', sourceId: 'items', template: true },
    { type: 'block.create', id: 'template-body', parentId: 'template', richText: [{ text: '고정 원문' }] },
    { type: 'template.instantiate', id: 'template', newId: 'instance', sourceId: 'items', title: '새 항목' },
    { type: 'block.create', id: 'sync', parentId: 'doc', blockType: 'synced' },
    { type: 'block.create', id: 'shared-body', parentId: 'sync', richText: [{ text: '공유 원문' }] },
    { type: 'block.create', id: 'reference', parentId: 'a1', blockType: 'synced_reference', sourceBlockId: 'sync' }]);
  const copy = f.workspace.get('instance').entity.children[0];
  assert.notEqual(copy.id, 'template-body');
  f.apply([{ type: 'block.update', id: copy.id, richText: [{ text: '개별 수정' }] }, { type: 'block.update', id: 'shared-body', richText: [{ text: 'SYNC7381 공유 변경' }] }]);
  assert.equal(f.workspace.get('template-body').entity.richText[0].text, '고정 원문');
  assert.equal(f.workspace.get('reference').entity.children[0].richText[0].text, 'SYNC7381 공유 변경');
  assert.deepEqual(new Set(f.workspace.search({ query: 'SYNC7381' }).results.map(row => row.id)), new Set(['doc', 'a1']));
  assert.equal(f.workspace.search({ query: 'SYNC7381', titleOnly: true }).total, 0);
  assert.equal(f.workspace.search({ query: 'SYNC7381', pageId: 'a1' }).blocks.length, 1);
  assert.throws(() => f.apply([{ type: 'node.move', id: 'reference', parentId: 'sync' }]), { code: 'PARENT_CYCLE' });
});

test('attachment bytes and record references survive unlink/undo, restart and consistent backup restore', async t => {
  const f = fixture(t), bytes = readFileSync(new URL('./fixtures/sample-attachment.txt', import.meta.url));
  assert.equal(bytes.length, 92);
  const blob = f.workspace.putBlob(bytes);
  f.apply([{ type: 'attachment.register', id: 'file', name: '인공 첨부.txt', mediaType: 'text/plain', ...blob }, { type: 'value.set', pageId: 'a1', propertyId: 'files', value: ['file'] }]);
  f.reopen(); assert.deepEqual(f.workspace.attachmentBytes('file').bytes, bytes);
  const unlink = f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'files', value: [] }]);
  assert.deepEqual(f.workspace.attachmentBytes('file').bytes, bytes);
  f.workspace.undo({ id: 'undo-attachment', actor: 'user', expectedRevision: f.workspace.revision, targetCommandId: unlink.commandId });
  const saved = await f.workspace.createBackup(), restore = mkdtempSync(path.join(tmpdir(), 'pageyard-restore-'));
  cpSync(saved.destination, restore, { recursive: true });
  const restored = new Workspace(restore);
  try { assert.deepEqual(restored.get('a1').entity.values.files, ['file']); assert.deepEqual(restored.attachmentBytes('file').bytes, bytes); assert.equal(restored.revision, saved.revision); }
  finally { restored.close(); rmSync(restore, { recursive: true, force: true }); }
});

test('stale writers and unsafe undo are rejected; run prose never enters business content', t => {
  const f = fixture(t), other = new Workspace(f.directory); t.after(() => other.close());
  const observed = other.revision;
  const edit = f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 12 }], { actor: 'agent' });
  assert.throws(() => other.execute({ id: 'stale', actor: 'user', expectedRevision: observed, operations: [{ type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 99 }] }), { code: 'REVISION_CONFLICT' });
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 13 }], { actor: 'user' });
  assert.throws(() => f.workspace.undo({ id: 'unsafe-undo', actor: 'agent', expectedRevision: f.workspace.revision, targetCommandId: edit.commandId }), { code: 'UNDO_CONFLICT' });
  assert.equal(f.workspace.get('a1').entity.computed.amount, 13);
  const before = canonical(f.workspace.snapshot());
  f.workspace.recordRun({ runId: 'meeting-example', message: '에이전트가 업무를 정리했습니다.', changedIds: ['a1'] });
  assert.equal(canonical(f.workspace.snapshot()), before);
  assert.equal(f.workspace.runs('meeting-example').length, 1);
});

test('backup retains bytes reachable only through undo history; verified restore never overwrites a workspace', async t => {
  const f = fixture(t), bytes = Buffer.from('recoverable historical attachment');
  const blob = f.workspace.putBlob(bytes);
  const registered = f.apply([{ type: 'attachment.register', id: 'history-only-file', name: 'history.txt', mediaType: 'text/plain', ...blob }]);
  const undo = f.workspace.undo({ id: 'undo-file-registration', actor: 'user', expectedRevision: f.workspace.revision, targetCommandId: registered.commandId });
  assert.throws(() => f.workspace.get('history-only-file'), { code: 'NOT_FOUND' });
  const saved = await f.workspace.createBackup();
  const parent = mkdtempSync(path.join(tmpdir(), 'pageyard-history-restore-')), destination = path.join(parent, 'restored');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  Workspace.restoreBackup(saved.destination, destination);
  const restored = new Workspace(destination);
  try {
    restored.undo({ id: 'redo-historical-file', actor: 'user', expectedRevision: restored.revision, targetCommandId: undo.commandId });
    assert.deepEqual(restored.attachmentBytes('history-only-file').bytes, bytes);
    assert.throws(() => Workspace.restoreBackup(saved.destination, destination), { code: 'RESTORE_TARGET_EXISTS' });
  } finally { restored.close(); }
});

test('multi-select chart drilldown and soft-deleted inverse schema remain consistent', t => {
  const f = fixture(t);
  f.apply([{ type: 'property.create', id: 'tags', sourceId: 'items', name: 'Tags', propertyType: 'multi_select', options: [{ id: 'red', name: 'red' }, { id: 'blue', name: 'blue' }] },
    { type: 'value.set', pageId: 'a1', propertyId: 'tags', value: ['red', 'blue'] },
    { type: 'value.set', pageId: 'a2', propertyId: 'tags', value: ['red'] },
    { type: 'view.create', id: 'tag-chart', sourceId: 'items', parentId: 'root', name: 'Tags', viewType: 'chart', config: { chart: { groupBy: 'tags', aggregation: 'count' } } }]);
  const red = f.workspace.query({ viewId: 'tag-chart' }).presentation.bars.find(bar => bar.key === '"red"');
  assert.equal(red.value, 2); assert.equal(f.workspace.query({ sourceId: 'items', filter: red.drilldown }).total, 2);
  f.apply([{ type: 'node.trash', id: 'related' }]);
  assert.equal(f.workspace.get('backlinks').entity.alive, false);
  f.apply([{ type: 'node.restore', id: 'related' }]);
  assert.equal(f.workspace.get('backlinks').entity.alive, true);
  assert.deepEqual(f.workspace.get('a2').entity.computed.backlinks, ['a1']);
});

test('ordinary backlinks differ from inverse properties; shared source deletion preserves live references', t => {
  const f = fixture(t);
  f.apply([{ type: 'block.create', id: 'mention', parentId: 'doc', richText: [{ text: 'A1 근거', pageId: 'a1' }] },
    { type: 'block.create', id: 'shared-source', parentId: 'doc', blockType: 'synced' },
    { type: 'block.create', id: 'shared-ref', parentId: 'a1', blockType: 'synced_reference', sourceBlockId: 'shared-source' }]);
  assert.ok(f.workspace.get('a1').entity.backlinks.some(page => page.id === 'doc' && page.types.includes('page-mention')));
  assert.deepEqual(f.workspace.get('a1').entity.values.backlinks ?? [], []);
  assert.throws(() => f.apply([{ type: 'node.trash', id: 'doc' }]), { code: 'SHARED_SOURCE_IN_USE' });
  f.apply([{ type: 'node.trash', id: 'shared-ref' }, { type: 'node.trash', id: 'doc' }]);
  assert.equal(f.workspace.get('doc').entity.alive, false);
});

test('chart drilldown preserves the saved filter; unknown filter fields are errors', t => {
  const f = fixture(t);
  f.apply([{ type: 'view.create', id: 'filtered-chart', sourceId: 'items', parentId: 'root', name: '큰 금액', viewType: 'chart', config: { filter: { propertyId: 'amount', op: 'gt', value: 5 }, chart: { groupBy: 'state', aggregation: 'count' } } }]);
  const bar = f.workspace.query({ viewId: 'filtered-chart' }).presentation.bars[0];
  assert.equal(bar.value, 2);
  assert.equal(f.workspace.query({ sourceId: 'items', filter: bar.drilldown }).total, 2);
  assert.throws(() => f.workspace.query({ sourceId: 'items', filter: { propertyId: 'does-not-exist', op: 'empty' } }), { code: 'QUERY_PROPERTY' });
});

test('rollup definitions and renamed option IDs update without losing identity or formula dependencies', t => {
  const f = fixture(t);
  f.apply([{ type: 'property.update', id: 'amount', name: '금액' },
    { type: 'property.update', id: 'double', name: '두 배' },
    { type: 'property.update', id: 'state', options: [{ id: 'todo', name: '준비', group: 'todo' }, { id: 'done', name: '완료', group: 'complete' }] },
    { type: 'property.update', id: 'total', rollup: { relationPropertyId: 'related', targetPropertyId: 'amount', aggregation: 'average' } }]);
  assert.equal(f.workspace.get('a1').entity.computed.double, 20);
  assert.equal(f.workspace.get('a1').entity.computed.total, 12.5);
  assert.equal(f.workspace.get('a1').entity.values.state, 'todo');
  const revision = f.workspace.revision;
  assert.throws(() => f.apply([{ type: 'property.update', id: 'total', rollup: { relationPropertyId: 'state', targetPropertyId: 'amount', aggregation: 'sum' } }]), { code: 'ROLLUP_SCHEMA' });
  assert.equal(f.workspace.revision, revision);
});

test('block copies preserve hierarchy and remap copied synced sources; external references keep sharing', t => {
  const f = fixture(t);
  f.apply([{ type: 'block.create', id: 'group', parentId: 'doc', blockType: 'toggle', richText: [{ text: '묶음' }] },
    { type: 'block.create', id: 'sync', parentId: 'group', blockType: 'synced' },
    { type: 'block.create', id: 'shared', parentId: 'sync', richText: [{ text: '원문' }] },
    { type: 'block.create', id: 'ref', parentId: 'group', blockType: 'synced_reference', sourceBlockId: 'sync' },
    { type: 'block.duplicate', id: 'group', newId: 'group-copy', parentId: 'a1' }]);
  const copied = f.workspace.get('group-copy').entity.children;
  const source = copied.find(block => block.blockType === 'synced'), reference = copied.find(block => block.blockType === 'synced_reference');
  assert.equal(reference.sourceBlockId, source.id);
  const body = f.workspace.get(source.id).entity.children[0];
  f.apply([{ type: 'block.update', id: body.id, richText: [{ text: '독립 사본' }] }, { type: 'block.duplicate', id: 'ref', newId: 'external-ref', parentId: 'a2' }]);
  assert.equal(f.workspace.get('shared').entity.richText[0].text, '원문');
  assert.equal(f.workspace.get(reference.id).entity.children[0].richText[0].text, '독립 사본');
  assert.equal(f.workspace.get('external-ref').entity.sourceBlockId, 'sync');
});

test('personal annotations are separate from page content, resolve/reopen, persist and undo', t => {
  const f = fixture(t), before = canonical(f.workspace.get('a1').entity.values);
  f.apply([{ type: 'comment.create', id: 'note', parentId: 'a1', richText: [{ text: '확인할 근거' }] }]);
  assert.equal(f.workspace.get('a1').entity.comments[0].richText[0].text, '확인할 근거');
  const resolved = f.apply([{ type: 'comment.update', id: 'note', resolved: true }]);
  f.reopen(); assert.equal(f.workspace.get('a1').entity.comments[0].resolved, true);
  f.workspace.undo({ id: 'undo-resolve', actor: 'user', expectedRevision: f.workspace.revision, targetCommandId: resolved.commandId });
  assert.equal(f.workspace.get('note').entity.resolved, false);
  assert.equal(canonical(f.workspace.get('a1').entity.values), before);
  assert.equal(f.workspace.search({ query: '확인할 근거' }).total, 0);
});

test('page history restores content and relation inverses as a new undoable change, preserving unrelated work', t => {
  const f = fixture(t);
  const original = f.apply([{ type: 'block.create', id: 'original-body', parentId: 'a1', richText: [{ text: '복원할 원문', bold: true }] },
    { type: 'comment.create', id: 'note', parentId: 'a1', richText: [{ text: '개인 주석' }] }]);
  f.apply([{ type: 'page.update', id: 'a1', title: '나중 제목' }, { type: 'value.set', pageId: 'a1', propertyId: 'amount', value: 99 },
    { type: 'relation.set', pageId: 'a1', propertyId: 'related', targetIds: ['a3'] },
    { type: 'node.trash', id: 'original-body' }, { type: 'block.create', id: 'later-body', parentId: 'a1', richText: [{ text: '나중 본문' }] }]);
  f.apply([{ type: 'page.update', id: 'a2', title: '다른 항목 보존' }, { type: 'comment.update', id: 'note', resolved: true }]);
  const historical = f.workspace.pageVersion('a1', original.revision);
  assert.equal(historical.entity.title, 'A1'); assert.equal(historical.blocks[0].id, 'original-body');
  const restored = f.apply([{ type: 'page.restore_version', id: 'a1', revision: original.revision }]);
  const page = f.workspace.get('a1').entity;
  assert.equal(page.title, 'A1'); assert.equal(page.computed.amount, 10); assert.equal(page.computed.total, 25);
  assert.equal(page.children[0].id, 'original-body'); assert.equal(page.comments[0].resolved, true);
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, ['a1']);
  assert.equal(f.workspace.get('a2').entity.title, '다른 항목 보존');
  assert.equal(f.workspace.history(50, 'a1')[0].id, restored.commandId);
  f.reopen(); assert.equal(f.workspace.pageVersion('a1', original.revision).blocks[0].richText[0].bold, true);
  f.workspace.undo({ id: 'undo-restore-version', actor: 'user', expectedRevision: f.workspace.revision, targetCommandId: restored.commandId });
  assert.equal(f.workspace.get('a1').entity.title, '나중 제목'); assert.equal(f.workspace.get('later-body').entity.visible, true);
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, []);
});

test('historical restore refuses to pull a block back from another page and rolls back every field', t => {
  const f = fixture(t);
  const past = f.apply([{ type: 'block.create', id: 'moved-body', parentId: 'a1', richText: [{ text: '소유권' }] }]);
  f.apply([{ type: 'node.move', id: 'moved-body', parentId: 'a2' }, { type: 'page.update', id: 'a1', title: '현재 제목' }]);
  const before = canonical(f.workspace.snapshot());
  assert.throws(() => f.apply([{ type: 'page.restore_version', id: 'a1', revision: past.revision }]), { code: 'RESTORE_CONFLICT' });
  assert.equal(canonical(f.workspace.snapshot()), before);
});

test('typed date filters, ordered form fields and pagination retain source data and reject invalid view bindings', t => {
  const f = fixture(t);
  f.apply([
    { type: 'value.set', pageId: 'a1', propertyId: 'due', value: { start: '2026-10-22T10:00:00+09:00', end: '2026-10-22T11:00:00+09:00', timeZone: 'Asia/Tokyo' } },
    { type: 'view.create', id: 'form', sourceId: 'items', parentId: 'doc', name: '입력', viewType: 'form', config: { visibleProperties: ['due', 'name', 'double', 'amount'] } },
  ]);
  assert.deepEqual(f.workspace.query({ sourceId: 'items', filter: { propertyId: 'due', op: 'eq', value: '2026-10-22' } }).rows.map(row => row.id), ['a1']);
  assert.equal(f.workspace.query({ sourceId: 'items', filter: { propertyId: 'due', op: 'eq', value: '2026-10-22T01:00:00Z' } }).total, 1);
  assert.equal(f.workspace.query({ sourceId: 'items', filter: { propertyId: 'due', op: 'neq', value: '2026-10-22' } }).total, 2);
  assert.deepEqual(f.workspace.query({ viewId: 'form' }).presentation.fields.map(field => field.id), ['due', 'name', 'amount']);
  const first = f.workspace.query({ viewId: 'active', limit: 2 }), second = f.workspace.query({ viewId: 'active', offset: 2, limit: 2 });
  assert.deepEqual([...first.rows, ...second.rows].map(row => row.id), ['a3', 'a1', 'a2']);
  assert.equal(first.total, 3); assert.equal(first.hasMore, true); assert.equal(second.hasMore, false);
  const before = canonical(f.workspace.snapshot());
  for (const config of [{ datePropertyId: 'amount' }, { endDatePropertyId: 'state' }, { placePropertyId: 'due' }, { visibleProperties: ['name', 'name'] }]) {
    assert.throws(() => f.apply([{ type: 'view.update', id: 'form', config }]));
    assert.equal(canonical(f.workspace.snapshot()), before);
  }
});

test('attachment registration with a reference is atomic, replayable and undoable without changing other files', t => {
  const f = fixture(t), blob = f.workspace.putBlob(Buffer.from('generated local storage test bytes'));
  f.apply([{ type: 'attachment.register', id: 'existing-file', name: 'existing.txt', mediaType: 'text/plain', ...blob },
    { type: 'value.set', pageId: 'a1', propertyId: 'files', value: ['existing-file'] }]);
  const before = canonical(f.workspace.snapshot());
  assert.throws(() => f.apply([{ type: 'attachment.register', id: 'invalid-file', name: 'bad.txt', mediaType: 'text/plain', ...blob,
    reference: { pageId: 'a1', propertyId: 'notes', attachmentIds: [] } }]), { code: 'ATTACHMENT_PROPERTY' });
  assert.equal(canonical(f.workspace.snapshot()), before);
  const command = { id: 'atomic-file', actor: 'test', expectedRevision: f.workspace.revision, operations: [{ type: 'attachment.register', id: 'new-file', name: 'new.txt', mediaType: 'text/plain', ...blob,
    reference: { pageId: 'a1', propertyId: 'files', attachmentIds: ['existing-file'] } }] };
  const result = f.workspace.execute(command); f.reopen();
  assert.equal(f.workspace.execute(command).replayed, true);
  assert.deepEqual(f.workspace.get('a1').entity.values.files, ['existing-file', 'new-file']);
  f.workspace.undo({ id: 'undo-file', actor: 'test', expectedRevision: result.revision, targetCommandId: result.commandId });
  assert.deepEqual(f.workspace.get('a1').entity.values.files, ['existing-file']);
  assert.throws(() => f.workspace.get('new-file'), { code: 'NOT_FOUND' });
});

test('page duplication copies owned sources and references, preserves external views, and returns the ID mapping', t => {
  const f = fixture(t);
  f.apply([
    { type: 'page.create', id: 'outside', title: '외부' },
    { type: 'source.create', id: 'external-items', pageId: 'outside', name: '외부 DB' },
    { type: 'page.create', id: 'external-row', sourceId: 'external-items', title: '외부 항목' },
    { type: 'property.create', id: 'external-link', sourceId: 'items', name: '외부 관계', propertyType: 'relation', targetSourceId: 'external-items', inverse: { id: 'external-inverse', name: '참조 항목' } },
    { type: 'relation.set', pageId: 'a1', propertyId: 'external-link', targetIds: ['external-row'] },
    { type: 'view.create', id: 'external-view', sourceId: 'external-items', parentId: 'doc', name: '외부 연결 보기', config: { visibleProperties: ['external-inverse'] } },
    { type: 'block.create', id: 'mention', parentId: 'doc', richText: [{ text: '내부 참조', pageId: 'a1' }] },
    { type: 'block.create', id: 'sync-source', parentId: 'doc', blockType: 'synced' },
    { type: 'block.create', id: 'sync-body', parentId: 'sync-source', richText: [{ text: '공유 원문' }] },
    { type: 'block.create', id: 'sync-ref', parentId: 'a1', blockType: 'synced_reference', sourceBlockId: 'sync-source' },
    { type: 'property.create', id: 'literal', sourceId: 'items', name: '문자 보존', propertyType: 'formula', formula: 'concat("amount", prop("amount"))' },
    { type: 'property.create', id: 'large-literal', sourceId: 'items', name: '큰 숫자', propertyType: 'formula', formula: '1000000000000000000000' },
    { type: 'property.update', id: 'amount', name: '금액' },
    { type: 'node.trash', id: 'a3' },
  ]);
  const beforeIds = f.workspace.snapshot().objects.map(item => item.id).sort(), beforeExternal = f.workspace.get('external-row').entity.values;
  const result = f.apply([{ type: 'page.duplicate', id: 'root', newId: 'root-copy' }]), map = result.copies[0].idMap;
  assert.equal(map.root, 'root-copy'); assert.notEqual(map.items, 'items');
  assert.equal(f.workspace.get(map.doc).entity.parentId, 'root-copy');
  const a1 = f.workspace.get(map.a1).entity;
  assert.equal(a1.sourceId, map.items); assert.deepEqual(a1.values[map.related], [map.a2, map.a3]);
  assert.equal(a1.computed[map.double], 20); assert.equal(a1.computed[map.literal], 'amount10');
  f.apply([{ type: 'property.update', id: map['large-literal'], formula: `${f.workspace.get(map['large-literal']).entity.formula} / 1e21` }]);
  assert.equal(f.workspace.get(map.a1).entity.computed[map['large-literal']], 1);
  assert.equal(f.workspace.get(map.a3).entity.alive, false);
  assert.equal(f.workspace.get(map.mention).entity.richText[0].pageId, map.a1);
  assert.equal(f.workspace.get(map['sync-ref']).entity.sourceBlockId, map['sync-source']);
  assert.deepEqual(f.workspace.get(map['external-view']).entity.config.visibleProperties, ['external-inverse']);
  assert.deepEqual(f.workspace.get('external-row').entity.values[map['external-inverse']], [map.a1]);
  assert.deepEqual(f.workspace.get('external-row').entity.values['external-inverse'], ['a1']);
  assert.equal(f.workspace.get(map.active).entity.config.filter.propertyId, map.state);
  f.apply([{ type: 'value.set', pageId: map.a1, propertyId: map.amount, value: 33 }]);
  assert.equal(f.workspace.get('a1').entity.computed.amount, 10);
  // Undo the later edit, then the whole graph copy, including external inverse additions.
  const later = f.workspace.history()[0];
  f.workspace.undo({ id: 'undo-copy-edit', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: later.id });
  // Version fields changed by the intermediate edit intentionally make a stale graph undo unsafe.
  assert.throws(() => f.workspace.undo({ id: 'unsafe-copy-undo', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: result.commandId }), { code: 'UNDO_CONFLICT' });
  const fresh = f.apply([{ type: 'page.duplicate', id: 'root', newId: 'second-copy' }]);
  f.workspace.undo({ id: 'undo-fresh-copy', actor: 'test', expectedRevision: f.workspace.revision, targetCommandId: fresh.commandId });
  assert.equal(f.workspace.snapshot().objects.some(item => item.id === 'second-copy'), false);
  assert.deepEqual(f.workspace.get('external-row').entity.values['external-inverse'], beforeExternal['external-inverse']);
  assert.ok(beforeIds.every(id => f.workspace.snapshot().objects.some(item => item.id === id)));
});

test('row duplication preserves hidden relations, increments unique IDs and refuses cross-source value loss', t => {
  const f = fixture(t);
  f.apply([{ type: 'node.trash', id: 'a3' }]);
  const result = f.apply([{ type: 'page.duplicate', id: 'a1', newId: 'a1-copy' }]);
  const copy = f.workspace.get('a1-copy').entity;
  assert.deepEqual(copy.values.related, ['a2', 'a3']);
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, ['a1', 'a1-copy']);
  assert.ok(copy.uniqueId > f.workspace.get('a1').entity.uniqueId);
  f.workspace.undo({ id: 'undo-row-copy', actor: 'test', expectedRevision: result.revision, targetCommandId: result.commandId });
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, ['a1']);
  f.apply([{ type: 'source.create', id: 'other-source', pageId: 'doc', name: '다른 DB' }]);
  const before = canonical(f.workspace.snapshot());
  assert.throws(() => f.apply([{ type: 'page.duplicate', id: 'a1', sourceId: 'other-source' }]), { code: 'COPY_SOURCE' });
  assert.equal(canonical(f.workspace.snapshot()), before);
});

test('property conversion previews stable IDs, dependent calculations and typed filters without writing', t => {
  const f = fixture(t);
  f.apply([{ type: 'view.create', id: 'amount-view', sourceId: 'items', parentId: 'doc', name: '금액 일치', config: { filter: { propertyId: 'amount', op: 'eq', value: 10 } } }]);
  f.apply([{ type: 'view.create', id: 'amount-chart', sourceId: 'items', parentId: 'doc', name: '금액 합계', viewType: 'chart', config: { chart: { groupBy: 'state', valuePropertyId: 'amount', aggregation: 'sum' } } }]);
  f.apply([{ type: 'view.create', id: 'unrelated-broken-chart', sourceId: 'items', parentId: 'doc', name: '삭제된 조건의 차트', viewType: 'chart', config: { filter: { propertyId: 'notes', op: 'empty' } } }, { type: 'node.trash', id: 'notes' }]);
  const before = canonical(f.workspace.snapshot());
  const preview = f.workspace.previewPropertyConversion({ type: 'property.convert', id: 'amount', propertyType: 'text' });
  assert.equal(preview.allowed, true); assert.equal(canonical(f.workspace.snapshot()), before);
  assert.equal(preview.changes.find(row => row.pageId === 'a1').after, '10');
  assert.ok(preview.effects.some(effect => effect.propertyId === 'double' && effect.after.error.code === 'FORMULA_TYPE'));
  assert.equal(preview.chartEffects[0].before[0].value, 35);
  assert.equal(preview.chartEffects[0].after[0].value.error.code, 'CHART_TYPE');
  const result = f.apply([preview.operation]);
  assert.equal(f.workspace.get('amount').entity.id, 'amount');
  assert.deepEqual(f.workspace.query({ viewId: 'amount-view' }).rows.map(row => row.id), ['a1']);
  assert.equal(f.workspace.get('amount-view').entity.config.filter.value, '10');
  assert.equal(f.workspace.query({ viewId: 'amount-chart' }).presentation.bars[0].value.error.code, 'CHART_TYPE');
  f.reopen(); assert.equal(f.workspace.get('a1').entity.values.amount, '10');
  f.workspace.undo({ id: 'undo-type', actor: 'test', expectedRevision: result.revision, targetCommandId: result.commandId });
  assert.equal(f.workspace.get('a1').entity.computed.double, 20);
  assert.equal(f.workspace.get('amount-view').entity.config.filter.value, 10);
  assert.equal(f.workspace.query({ viewId: 'amount-chart' }).presentation.bars[0].value, 35);
  assert.throws(() => f.apply([{ ...preview.operation, fromType: 'checkbox' }]), { code: 'CONVERSION_STALE' });
});

test('conversion rejects unrepresentable values atomically, including templates and hidden rows, and keeps zero and false', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'notes', value: '0' },
    { type: 'value.set', pageId: 'a2', propertyId: 'notes', value: '1' },
    { type: 'value.set', pageId: 'a3', propertyId: 'notes', value: 'invalid' }, { type: 'node.trash', id: 'a3' }]);
  const before = canonical(f.workspace.snapshot()), operation = { type: 'property.convert', id: 'notes', propertyType: 'number' };
  const rejected = f.workspace.previewPropertyConversion(operation);
  assert.equal(rejected.allowed, false); assert.equal(rejected.error.details.rows[0].pageId, 'a3');
  assert.throws(() => f.apply([operation]), { code: 'PROPERTY_CONVERSION' });
  assert.equal(canonical(f.workspace.snapshot()), before);
  f.apply([{ type: 'node.restore', id: 'a3' }, { type: 'value.set', pageId: 'a3', propertyId: 'notes', value: null },
    { type: 'page.create', id: 'conversion-template', sourceId: 'items', title: '템플릿', template: true },
    { type: 'value.set', pageId: 'conversion-template', propertyId: 'notes', value: '0' }, { type: 'node.trash', id: 'a3' }]);
  f.apply([operation]); assert.equal(f.workspace.get('a1').entity.values.notes, 0);
  f.apply([{ type: 'property.convert', id: 'notes', propertyType: 'checkbox' }]);
  assert.equal(f.workspace.get('a1').entity.values.notes, false); assert.equal(f.workspace.get('a2').entity.values.notes, true);
  assert.equal(f.workspace.get('conversion-template').entity.values.notes, false); assert.equal(f.workspace.get('a3').entity.values.notes, null);
});

test('selection conversion generates stable option IDs and refuses to discard multiple selections', t => {
  const f = fixture(t);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'notes', value: '빨강' }, { type: 'value.set', pageId: 'a2', propertyId: 'notes', value: '파랑' }]);
  const preview = f.workspace.previewPropertyConversion({ type: 'property.convert', id: 'notes', propertyType: 'status' });
  assert.equal(preview.allowed, true); f.apply([preview.operation]);
  const firstId = f.workspace.get('a1').entity.values.notes, secondId = f.workspace.get('a2').entity.values.notes;
  assert.equal(f.workspace.get('notes').entity.options.find(option => option.id === firstId).name, '빨강');
  f.apply([{ type: 'property.convert', id: 'notes', propertyType: 'multi_select' }]);
  assert.deepEqual(f.workspace.get('a1').entity.values.notes, [firstId]);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'notes', value: [firstId, secondId] }]);
  const before = canonical(f.workspace.snapshot());
  assert.equal(f.workspace.previewPropertyConversion({ type: 'property.convert', id: 'notes', propertyType: 'select' }).allowed, false);
  assert.equal(canonical(f.workspace.snapshot()), before);
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'notes', value: [firstId] }, { type: 'property.convert', id: 'notes', propertyType: 'select' }]);
  assert.equal(f.workspace.get('a1').entity.values.notes, firstId);
});

test('date conversion preserves ranges and timezone, clears incompatible bindings, and restores them on undo', t => {
  const f = fixture(t), value = { start: '2026-10-22T10:00:00+09:00', end: '2026-10-24T11:00:00+09:00', timeZone: 'Asia/Tokyo' };
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'due', value }, { type: 'view.create', id: 'cal', sourceId: 'items', parentId: 'doc', name: '달력', viewType: 'calendar', config: { datePropertyId: 'due' } }]);
  const preview = f.workspace.previewPropertyConversion({ type: 'property.convert', id: 'due', propertyType: 'text' });
  assert.equal(preview.allowed, true); assert.equal(preview.viewChanges[0].id, 'cal');
  const changed = f.apply([preview.operation]); assert.deepEqual(JSON.parse(f.workspace.get('a1').entity.values.due), value);
  assert.equal(f.workspace.get('cal').entity.config.datePropertyId, null);
  f.workspace.undo({ id: 'undo-date-conversion', actor: 'test', expectedRevision: changed.revision, targetCommandId: changed.commandId });
  assert.equal(f.workspace.get('cal').entity.config.datePropertyId, 'due');
  assert.deepEqual(f.workspace.get('a1').entity.values.due, value);
  f.apply([{ type: 'property.convert', id: 'due', propertyType: 'text' }, { type: 'property.convert', id: 'due', propertyType: 'date' }]);
  assert.deepEqual(f.workspace.get('a1').entity.values.due, value);
});

test('relation conversion preserves reverse links as one-way data and creates validated new inverses', t => {
  const f = fixture(t), operation = { type: 'property.convert', id: 'related', propertyType: 'text' };
  assert.equal(f.workspace.previewPropertyConversion(operation).error.code, 'CONVERSION_DEPENDENCY');
  f.apply([{ type: 'property.convert', id: 'total', propertyType: 'formula', formula: '7' }]);
  const changed = f.apply([operation]);
  assert.equal(f.workspace.get('related').entity.type, 'text');
  assert.equal(f.workspace.get('backlinks').entity.inversePropertyId, undefined);
  assert.deepEqual(f.workspace.get('a2').entity.values.backlinks, ['a1']);
  f.workspace.undo({ id: 'undo-relation-type', actor: 'test', expectedRevision: changed.revision, targetCommandId: changed.commandId });
  assert.equal(f.workspace.get('backlinks').entity.inversePropertyId, 'related');
  f.apply([{ type: 'value.set', pageId: 'a1', propertyId: 'notes', value: 'A2' }]);
  const preview = f.workspace.previewPropertyConversion({ type: 'property.convert', id: 'notes', propertyType: 'relation', targetSourceId: 'items', inverse: { name: '새 역관계' } });
  assert.equal(preview.allowed, true); assert.ok(preview.operation.inverse.id);
  f.apply([preview.operation]);
  assert.deepEqual(f.workspace.get('a2').entity.values[preview.operation.inverse.id], ['a1']);
  f.apply([{ type: 'property.convert', id: 'total', propertyType: 'number' }]);
  assert.equal(f.workspace.get('a1').entity.values.total, 7);
});
