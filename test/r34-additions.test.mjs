import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';

// r34 (33차, personal-workspace features): the time machine (the workspace at an earlier revision, a moment chosen by
// time, a page brought back or copied out) and 빠른 기록 (a line, to-do or database row from outside the app).
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r34-'));
  const w = new Workspace(directory); let i = 0;
  const apply = (operations, actor = 'user') => w.execute({ id: `r34-${++i}`, actor, expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  const get = id => w.snapshot().objects.find(item => item.id === id);
  const under = id => w.snapshot().objects.filter(item => item.kind === 'block' && item.parentId === id && item.alive !== false).sort((a, b) => a.position - b.position);
  return { w, apply, get, under };
}
async function serve(t, w) {
  const server = createLocalServer(w); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeEventStreams?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const get = async route => { const response = await fetch(`${base}${route}`); return { status: response.status, body: await response.json() }; };
  return { post, get };
}
const code = name => error => error?.code === name;
const kind = block => block.blockType ?? block.type;
const text = block => (block.richText ?? []).map(run => run.text).join('');

function workspaceWithTasks(apply) {
  apply([
    { type: 'page.create', id: 'inbox', title: '받은 메모' },
    { type: 'page.create', id: 'db', title: '할 일 목록' },
    { type: 'source.create', id: 'tasks', pageId: 'db', name: '할 일', titlePropertyId: 'title' },
    { type: 'property.create', id: 'due', sourceId: 'tasks', name: '마감', propertyType: 'date' },
    { type: 'property.create', id: 'state', sourceId: 'tasks', name: '상태', propertyType: 'select', options: [{ id: 'open', name: '진행' }, { id: 'done', name: '완료' }] },
    { type: 'property.create', id: 'size', sourceId: 'tasks', name: '크기', propertyType: 'number' },
    { type: 'property.create', id: 'calc', sourceId: 'tasks', name: '계산', propertyType: 'formula', formula: 'prop("크기") * 2' },
    { type: 'page.create', id: 'project', title: '분기 보고', sourceId: 'tasks' },
    { type: 'property.create', id: 'parent', sourceId: 'tasks', name: '상위', propertyType: 'relation', targetSourceId: 'tasks' },
  ]);
}

test('빠른 기록 to a page: the capture page or one named by title or id, lines in order, as text, to-dos or bullets', t => {
  const { w, apply, under } = fixture(t);
  workspaceWithTasks(apply);
  assert.throws(() => w.capture({ text: '첫 줄' }), code('CAPTURE_TARGET'), 'no capture page yet');
  assert.throws(() => apply([{ type: 'workspace.update', capturePageId: 'nowhere' }]), code('CAPTURE_TARGET'));
  apply([{ type: 'workspace.update', capturePageId: 'inbox' }]);
  assert.equal(w.snapshot().objects.find(item => item.kind === 'settings')?.capturePageId, 'inbox');

  const first = w.capture({ text: '우유 사기\n\n빵 사기\n', source: 'shortcuts' });
  assert.equal(first.pageId, 'inbox');
  assert.deepEqual(under('inbox').map(block => [kind(block), text(block)]), [['paragraph', '우유 사기'], ['paragraph', ''], ['paragraph', '빵 사기']]);
  assert.deepEqual(first.blockIds, under('inbox').map(block => block.id));
  const last = [w.history(1)].flat()[0];
  assert.equal(last.actor, 'capture:shortcuts', 'the change history names where it came from');

  w.capture({ text: '전화하기', as: 'todo', to: '받은 메모' });
  w.capture({ text: '생각 하나', as: 'bullet', to: 'inbox' });
  assert.deepEqual(under('inbox').slice(-2).map(block => [kind(block), text(block)]), [['todo', '전화하기'], ['bullet', '생각 하나']]);
  assert.ok(!under('inbox').at(-2).checked, 'a captured to-do starts unchecked');

  assert.throws(() => w.capture({ text: '  \n ' }), code('CAPTURE_EMPTY'));
  assert.throws(() => w.capture({ text: Array.from({ length: 201 }, (_, i) => `줄 ${i}`).join('\n') }), code('CAPTURE_LIMIT'));
  assert.throws(() => w.capture({ text: '어디로', to: '없는 페이지' }), code('CAPTURE_TARGET'));
  apply([{ type: 'page.create', id: 'twin', title: '받은 메모' }]);
  assert.throws(() => w.capture({ text: '둘 중 하나', to: '받은 메모' }), code('CAPTURE_TARGET'), 'two pages share the title');
  assert.throws(() => w.capture({ text: 'x', unknown: 1 }), 'unknown fields are refused');

  // The capture page in the trash: captures that name no page are refused until another is chosen.
  apply([{ type: 'node.trash', id: 'inbox' }]);
  assert.throws(() => w.capture({ text: '휴지통으로?' }), code('CAPTURE_TARGET'));
});

test('빠른 기록 to a database: a row by the database’s name, its properties by name, the rest of the text as its body', t => {
  const { w, apply, get, under } = fixture(t);
  workspaceWithTasks(apply);
  const row = w.capture({ database: '할 일', text: '보고서 제출\n첫 문단\n둘째 문단', properties: { 마감: '2026-11-01', 상태: '진행', 크기: '3', 상위: '분기 보고' }, source: 'raycast' });
  const page = get(row.pageId);
  assert.equal(page.sourceId, 'tasks');
  assert.equal(page.title, '보고서 제출');
  assert.equal(row.sourceId, 'tasks');
  assert.equal(page.values.due?.start ?? page.values.due, '2026-11-01');
  assert.equal(page.values.state, 'open');
  assert.equal(page.values.size, 3);
  assert.deepEqual(page.values.parent, ['project']);
  assert.deepEqual(under(row.pageId).map(text), ['첫 문단', '둘째 문단']);

  const titled = w.capture({ database: 'tasks', title: '제목만', properties: { 상태: null } });
  assert.equal(get(titled.pageId).title, '제목만');
  assert.equal(under(titled.pageId).length, 0);

  assert.throws(() => w.capture({ database: '없는 데이터베이스', text: '행' }), code('CAPTURE_TARGET'));
  assert.throws(() => w.capture({ database: '할 일', text: '행', properties: { 없는속성: '값' } }), code('CAPTURE_TARGET'));
  assert.throws(() => w.capture({ database: '할 일', text: '행', properties: { 계산: '1' } }), code('CAPTURE_PROPERTY'));
  assert.throws(() => w.capture({ database: '할 일', text: '행', properties: { 상위: '없는 상위' } }), code('CAPTURE_TARGET'));
  assert.throws(() => w.capture({ database: '할 일', text: '' }), code('CAPTURE_EMPTY'));
});

test('time machine: the workspace at a revision, the revision at a moment, and a page brought back or copied out', t => {
  const { w, apply, get, under } = fixture(t);
  apply([
    { type: 'page.create', id: 'home', title: '작업 공간' },
    { type: 'page.create', id: 'diary', title: '일기', parentId: 'home' },
    { type: 'block.create', id: 'd1', parentId: 'diary', blockType: 'paragraph', richText: [{ text: '처음 쓴 문장' }] },
    { type: 'page.create', id: 'old', title: '지난 메모', parentId: 'home' },
    { type: 'block.create', id: 'o1', parentId: 'old', blockType: 'paragraph', richText: [{ text: '버린 생각' }] },
    { type: 'page.create', id: 'db', title: '목록', parentId: 'home' },
    { type: 'source.create', id: 's', pageId: 'db', name: '목록', titlePropertyId: 'title' },
    { type: 'page.create', id: 'r1', title: '처음 행', sourceId: 's' },
  ]);
  const then = w.revision;
  apply([{ type: 'block.update', id: 'd1', richText: [{ text: '나중에 고친 문장' }] }]);
  apply([{ type: 'page.update', id: 'r1', title: '바뀐 행' }]);
  apply([{ type: 'node.trash', id: 'old' }]);
  const now = w.revision;

  const past = w.snapshotAt(then);
  assert.equal(past.revision, then);
  assert.equal(past.currentRevision, now);
  assert.equal(past.objects.find(item => item.id === 'd1').richText[0].text, '처음 쓴 문장');
  assert.equal(past.objects.find(item => item.id === 'old').alive, true);
  assert.equal(get('d1').richText[0].text, '나중에 고친 문장', 'reading the past changes nothing');
  assert.equal(w.snapshotAt(then).objects.find(item => item.id === 'r1').title, '처음 행', 'the same moment reads again');

  const later = w.revisionAt(new Date(Date.now() + 60000).toISOString());
  assert.equal(later.revision, now);
  assert.equal(w.revisionAt('2000-01-01T00:00:00Z').revision, 0);
  assert.throws(() => w.revisionAt('어제'), code('HISTORY_TIME'));
  assert.equal(w.revisionInfo(then).revision, then);
  assert.throws(() => w.revisionInfo(now + 1), code('HISTORY_REVISION'));

  // Restore: the page's content as it was; its database's rows as they were.
  const restored = w.restoreFromPast({ pageId: 'diary', revision: then, mode: 'restore', commandId: 'tm-1', actor: 'user', expectedRevision: w.revision });
  assert.equal(restored.mode, 'restore');
  assert.equal(under('diary').map(text).join('|'), '처음 쓴 문장');
  w.restoreFromPast({ pageId: 'db', revision: then, mode: 'restore', commandId: 'tm-2', actor: 'user', expectedRevision: w.revision });
  assert.equal(get('r1').title, '처음 행');
  // A page in the trash comes back; a copy is a new page with what was under it, beside it.
  const copy = w.restoreFromPast({ pageId: 'old', revision: then, mode: 'copy', title: '지난 메모 (그때)', commandId: 'tm-3', actor: 'user', expectedRevision: w.revision });
  assert.equal(copy.mode, 'copy');
  assert.notEqual(copy.pageId, 'old');
  assert.equal(get(copy.pageId).title, '지난 메모 (그때)');
  assert.equal(get(copy.pageId).parentId, 'home');
  assert.equal(under(copy.pageId).map(text).join('|'), '버린 생각');
  assert.equal(get('old').alive, false);
  w.restoreFromPast({ pageId: 'old', revision: then, mode: 'restore', commandId: 'tm-4', actor: 'user', expectedRevision: w.revision });
  assert.equal(get('old').alive, true);
  // Not there then; a database row that is gone now; a stale revision.
  assert.throws(() => w.restoreFromPast({ pageId: copy.pageId, revision: then, mode: 'restore', commandId: 'tm-5', actor: 'user', expectedRevision: w.revision }), code('RESTORE_PAGE'));
  assert.throws(() => w.restoreFromPast({ pageId: 'r1', revision: then, mode: 'copy', commandId: 'tm-6', actor: 'user', expectedRevision: w.revision }), code('RESTORE_ROW'));
  assert.throws(() => w.restoreFromPast({ pageId: 'diary', revision: then, mode: 'restore', commandId: 'tm-7', actor: 'user', expectedRevision: then }));
});

test('the server: state, search and the moment at ?at=, a restore, and POST /api/capture', async t => {
  const { w, apply, under } = fixture(t);
  apply([{ type: 'page.create', id: 'note', title: '노트' }, { type: 'block.create', id: 'n1', parentId: 'note', blockType: 'paragraph', richText: [{ text: '옛날 단어' }] }]);
  const then = w.revision;
  apply([{ type: 'block.update', id: 'n1', richText: [{ text: '새 단어' }] }]);
  const { post, get } = await serve(t, w);

  const state = await get(`/api/state?at=${then}`);
  assert.equal(state.status, 200);
  assert.equal(state.body.objects.find(item => item.id === 'n1').richText[0].text, '옛날 단어');
  const moment = await get(`/api/time-machine?revision=${then}`);
  assert.equal(moment.body.revision, then);
  assert.equal(moment.body.currentRevision, w.revision);
  assert.equal((await get(`/api/time-machine?time=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`)).body.revision, w.revision);
  const search = await post(`/api/search?at=${then}`, { query: '옛날' });
  assert.equal(search.status, 200);
  assert.ok(search.body.results.some(result => (result.pageId ?? result.id) === 'note'), 'the old word is found at that moment');
  const nowSearch = await post('/api/search', { query: '옛날' });
  assert.ok(!nowSearch.body.results.some(result => (result.pageId ?? result.id) === 'note'), 'and not now');

  const restored = await post('/api/time-machine/restore', { pageId: 'note', revision: then, mode: 'restore', commandId: 'srv-1', actor: 'user', expectedRevision: w.revision });
  assert.equal(restored.status, 200);
  assert.equal(under('note').map(text).join(''), '옛날 단어');

  const refused = await post('/api/capture', { text: '어디에?' });
  assert.equal(refused.status >= 400 && refused.status < 500, true);
  apply([{ type: 'workspace.update', capturePageId: 'note' }]);
  const captured = await post('/api/capture', { text: '밖에서 온 줄', as: 'todo', source: 'curl' });
  assert.equal(captured.status, 201);
  assert.equal(captured.body.pageId, 'note');
  assert.equal(kind(under('note').at(-1)), 'todo');
  assert.equal(text(under('note').at(-1)), '밖에서 온 줄');
});
