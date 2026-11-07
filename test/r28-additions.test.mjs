import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.mjs';

// r28 (coverage phase 3: find and organize): search words, "exact phrases", location, date, archive filters and
// sorting; archived pages; permanent delete from the trash; page lock and wiki flags; named versions and whole-database
// restore; the task list behind 내 작업; inbox notifications with their source and archive.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r28-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r28-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([
    { type: 'page.create', id: 'notes', title: '노트' },
    { type: 'page.create', id: 'a', title: '회의 메모', parentId: 'notes' },
    { type: 'block.create', id: 'a1', parentId: 'a', blockType: 'paragraph', richText: [{ text: '분기 예산 검토와 채용 계획' }] },
    { type: 'page.create', id: 'b', title: '예산 정리' },
    { type: 'block.create', id: 'b1', parentId: 'b', blockType: 'paragraph', richText: [{ text: '채용 예산은 다음 달 검토' }] },
    { type: 'page.create', id: 'c', title: '아카이브 후보' },
    { type: 'block.create', id: 'c1', parentId: 'c', blockType: 'paragraph', richText: [{ text: '예산 검토 끝' }] },
  ]);
  return { w, apply };
}
const ids = result => result.results.map(row => row.id).sort();

test('all words must appear; quotes ask for the exact phrase', t => {
  const { w } = fixture(t);
  assert.deepEqual(ids(w.search({ query: '예산 검토' })), ['a', 'b', 'c']);
  assert.deepEqual(ids(w.search({ query: '"예산 검토"' })), ['a', 'c']);
  assert.deepEqual(ids(w.search({ query: '채용 "예산 검토"' })), ['a']);
  assert.deepEqual(ids(w.search({ query: '예산', titleOnly: true })), ['b']);
});

test('location, date range and sort filters; an empty query with filters lists pages', t => {
  const { w, apply } = fixture(t);
  assert.deepEqual(ids(w.search({ query: '예산', withinIds: ['notes'] })), ['a']);
  assert.deepEqual(ids(w.search({ query: '', withinIds: ['notes'] })), ['a', 'notes']);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(w.search({ query: '예산', dateField: 'created', from: today, to: today }).total, 3);
  assert.equal(w.search({ query: '예산', dateField: 'edited', to: '2000-01-01' }).total, 0);
  assert.throws(() => w.search({ query: '' }), /검색어/);
  const later = Date.now() + 5; while (Date.now() < later) { /* a later creation time */ }
  apply([{ type: 'page.create', id: 'd', title: '새 예산' }]);
  assert.equal(w.search({ query: '예산', sort: 'created_desc' }).results[0].id, 'd');
  assert.equal(w.search({ query: '예산', sort: 'created_asc' }).results.at(-1).id, 'd');
  assert.equal(w.search({ query: '예산', sort: 'edited_desc' }).results[0].id, 'd');
  // Best match puts the page whose title is the word first.
  assert.equal(w.search({ query: '예산 정리' }).results[0].id, 'b');
});

test('archived pages leave search and database views until asked for; links still open', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'page.update', id: 'c', archived: true }]);
  assert.equal(w.get('c').entity.archived, true);
  assert.deepEqual(ids(w.search({ query: '예산' })), ['a', 'b']);
  assert.deepEqual(ids(w.search({ query: '예산', archived: 'only' })), ['c']);
  assert.equal(w.search({ query: '예산', archived: 'include' }).results.find(row => row.id === 'c').archived, true);
  // Pages under an archived page count as archived too.
  apply([{ type: 'page.update', id: 'notes', archived: true }]);
  assert.deepEqual(ids(w.search({ query: '예산' })), ['b']);
  apply([
    { type: 'page.create', id: 'db', title: '할 일' },
    { type: 'source.create', id: 's', pageId: 'db', name: '할 일', titlePropertyId: 's-t' },
    { type: 'page.create', id: 'r1', title: '하나', sourceId: 's' }, { type: 'page.create', id: 'r2', title: '둘', sourceId: 's' },
    { type: 'page.update', id: 'r2', archived: true },
  ]);
  assert.deepEqual(w.query({ sourceId: 's' }).rows.map(row => row.id), ['r1']);
  assert.deepEqual(w.query({ sourceId: 's', includeArchived: true }).rows.map(row => row.id).sort(), ['r1', 'r2']);
  apply([{ type: 'page.update', id: 'r2', archived: false }]);
  assert.equal(w.get('r2').entity.archived, undefined);
});

test('permanent delete takes trashed items out for good; restore is refused but undo still works', t => {
  const { w, apply } = fixture(t);
  assert.throws(() => apply([{ type: 'node.purge', id: 'b' }]), /휴지통/);
  apply([{ type: 'node.trash', id: 'b' }]);
  assert.ok(w.get('b').entity.trashedAt);
  const purge = apply([{ type: 'node.purge', id: 'b' }]);
  assert.equal(w.snapshot().objects.find(item => item.id === 'b').purged, true);
  assert.throws(() => apply([{ type: 'node.restore', id: 'b' }]), /영구 삭제/);
  assert.throws(() => apply([{ type: 'node.purge', id: 'b' }]), /휴지통/);
  w.undo({ id: 'undo-purge', actor: 'user', expectedRevision: w.revision, targetCommandId: purge.commandId });
  apply([{ type: 'node.restore', id: 'b' }]);
  assert.equal(w.get('b').entity.alive, true);
  assert.equal(w.get('b').entity.trashedAt, undefined);
});

test('page lock and wiki are stored on the page; versions can be named', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'page.update', id: 'a', locked: true, wiki: true }]);
  assert.equal(w.get('a').entity.locked, true);
  assert.equal(w.get('a').entity.wiki, true);
  apply([{ type: 'page.update', id: 'a', locked: false }]);
  assert.equal(w.get('a').entity.locked, undefined);
  apply([{ type: 'version.name', pageId: 'a', revision: 1, name: '초안' }]);
  assert.deepEqual(w.get('a').entity.versionNames, { 1: '초안' });
  assert.throws(() => apply([{ type: 'version.name', pageId: 'a', revision: 9999, name: '미래' }]), /revision/);
  apply([{ type: 'version.name', pageId: 'a', revision: 1, name: null }]);
  assert.equal(w.get('a').entity.versionNames, undefined);
});

test('a database goes back to an earlier version: rows, values and properties', t => {
  const { w, apply } = fixture(t);
  apply([
    { type: 'page.create', id: 'db', title: '작업' },
    { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 's-t' },
    { type: 'property.create', id: 's-n', sourceId: 's', name: '점수', propertyType: 'number' },
    { type: 'page.create', id: 'r1', title: '가', sourceId: 's' }, { type: 'page.create', id: 'r2', title: '나', sourceId: 's' },
    { type: 'value.set', pageId: 'r1', propertyId: 's-n', value: 1 },
    { type: 'block.create', id: 'r1b', parentId: 'r1', blockType: 'paragraph', richText: [{ text: '처음' }] },
  ]);
  const then = w.revision;
  apply([
    { type: 'value.set', pageId: 'r1', propertyId: 's-n', value: 5 }, { type: 'page.update', id: 'r1', title: '가 수정' },
    { type: 'block.update', id: 'r1b', richText: [{ text: '나중' }] },
    { type: 'node.trash', id: 'r2' }, { type: 'page.create', id: 'r3', title: '다', sourceId: 's' },
    { type: 'property.create', id: 's-x', sourceId: 's', name: '새 속성', propertyType: 'text' },
    { type: 'node.trash', id: 's-n' },
  ]);
  apply([{ type: 'source.restore_version', id: 's', revision: then }]);
  const rows = w.query({ sourceId: 's' }).rows;
  assert.deepEqual(rows.map(row => row.id).sort(), ['r1', 'r2']);
  assert.equal(w.get('r1').entity.title, '가');
  assert.equal(w.get('r1').entity.computed['s-n'], 1);
  assert.equal(w.get('r1b').entity.richText[0].text, '처음');
  assert.equal(w.get('s-n').entity.alive, true);
  assert.equal(w.snapshot().objects.find(item => item.id === 's-x').alive, false);
  assert.equal(w.snapshot().objects.find(item => item.id === 'r3').alive, false);
});

test('the task list gathers rows of databases with a status property, by due date', t => {
  const { w, apply } = fixture(t);
  apply([
    { type: 'page.create', id: 'db', title: '프로젝트' },
    { type: 'source.create', id: 's', pageId: 'db', name: '프로젝트', titlePropertyId: 's-t' },
    { type: 'property.create', id: 's-st', sourceId: 's', name: '상태', propertyType: 'status', options: [{ id: 'todo', name: '시작 전', group: '할 일' }, { id: 'doing', name: '진행 중', group: '진행 중' }, { id: 'done', name: '완료', group: '완료' }] },
    { type: 'property.create', id: 's-d', sourceId: 's', name: '마감일', propertyType: 'date' },
    { type: 'property.create', id: 's-p', sourceId: 's', name: '담당자', propertyType: 'person' },
    { type: 'page.create', id: 't1', title: '나중 일', sourceId: 's' }, { type: 'value.set', pageId: 't1', propertyId: 's-st', value: 'todo' }, { type: 'value.set', pageId: 't1', propertyId: 's-d', value: { start: '2030-05-01' } },
    { type: 'page.create', id: 't2', title: '급한 일', sourceId: 's' }, { type: 'value.set', pageId: 't2', propertyId: 's-st', value: 'doing' }, { type: 'value.set', pageId: 't2', propertyId: 's-d', value: { start: '2030-01-01' } }, { type: 'value.set', pageId: 't2', propertyId: 's-p', value: ['지은'] },
    { type: 'page.create', id: 't3', title: '끝난 일', sourceId: 's' }, { type: 'value.set', pageId: 't3', propertyId: 's-st', value: 'done' },
    { type: 'page.create', id: 'plain', title: '그냥 DB' },
    { type: 'source.create', id: 'p', pageId: 'plain', name: '그냥', titlePropertyId: 'p-t' },
    { type: 'page.create', id: 'x', title: '목록', sourceId: 'p' },
  ]);
  const list = w.tasks();
  assert.deepEqual(list.sources.map(source => source.id), ['s']);
  assert.equal(list.sources[0].datePropertyId, 's-d');
  assert.deepEqual(list.tasks.map(task => task.id), ['t2', 't1']);
  assert.equal(list.tasks[0].status.kind, 'in_progress');
  assert.deepEqual(w.tasks({ includeDone: true }).tasks.map(task => task.id), ['t2', 't1', 't3']);
  assert.deepEqual(w.tasks({ assignee: '지은' }).tasks.map(task => task.id), ['t2']);
});

test('notifications say what sent them and can be archived', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'reminder.set', id: 'rem', parentId: 'a', at: '2026-01-01T00:00:00Z', message: '확인' }]);
  w.tick('2026-01-01T00:01:00Z');
  const note = w.snapshot().objects.find(item => item.kind === 'notification');
  assert.equal(note.source, 'reminder');
  apply([{ type: 'notification.archive', id: note.id, archived: true }]);
  const archived = w.snapshot().objects.find(item => item.id === note.id);
  assert.equal(archived.archived, true);
  assert.equal(archived.read, true);
  apply([{ type: 'notification.archive', id: note.id, archived: false }]);
  assert.equal(w.snapshot().objects.find(item => item.id === note.id).archived, undefined);
});

test('a database history lists the commands that touched its rows or properties', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'page.create', id: 'db', title: '작업' }, { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 's-t' }]);
  const row = apply([{ type: 'page.create', id: 'r1', title: '가', sourceId: 's' }]);
  apply([{ type: 'block.create', id: 'other', parentId: 'b', blockType: 'paragraph', richText: [{ text: '다른 페이지' }] }]);
  const content = apply([{ type: 'block.create', id: 'rb', parentId: 'r1', blockType: 'paragraph', richText: [{ text: '행 내용' }] }]);
  const revisions = w.history(50, undefined, 's').map(entry => entry.revision);
  assert.ok(revisions.includes(row.revision) && revisions.includes(content.revision));
  assert.ok(!revisions.includes(content.revision - 1));
});

test('a database version lists its rows and properties as they were', t => {
  const { w, apply } = fixture(t);
  apply([{ type: 'page.create', id: 'db', title: '작업' }, { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 's-t' }, { type: 'page.create', id: 'r1', title: '가', sourceId: 's' }]);
  const then = w.revision;
  apply([{ type: 'page.create', id: 'r2', title: '나', sourceId: 's' }, { type: 'page.update', id: 'r1', title: '가2' }]);
  const version = w.sourceVersion('s', then);
  assert.equal(version.total, 1);
  assert.equal(version.rows[0].title, '가');
  assert.equal(w.sourceVersion('s', w.revision).total, 2);
});

test('naming a version, locking or archiving is not itself a version', t => {
  const { w, apply } = fixture(t);
  const before = w.history(50, 'a').length;
  apply([{ type: 'version.name', pageId: 'a', revision: 1, name: '처음' }]);
  apply([{ type: 'page.update', id: 'a', locked: true }]);
  assert.equal(w.history(50, 'a').length, before);
  apply([{ type: 'page.update', id: 'a', title: '회의 메모 2' }]);
  assert.equal(w.history(50, 'a').length, before + 1);
});
