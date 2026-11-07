import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Workspace } from '../src/workspace.mjs';
import { InboxFolder, mediaTypeOf } from '../src/inbox-folder.mjs';
import { createLocalServer } from '../src/server.mjs';

// r35 (34차): 받은 파일 폴더 — new files in a folder become blocks on the quick capture page; files that were already
// there, still downloading or hidden are left out; the files stay (or move to Imported) and nothing is deleted.
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'pageyard-inbox-'));
  const w = new Workspace(path.join(root, 'data')); let i = 0;
  const apply = operations => w.execute({ id: `i-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  const folders = [];
  const open = () => { const inbox = new InboxFolder(w, { interval: 3_600_000, settle: 0 }); folders.push(inbox); return inbox; };
  t.after(() => { for (const inbox of folders) inbox.close(); w.close(); rmSync(root, { recursive: true, force: true }); });
  const blocks = id => w.snapshot().objects.filter(item => item.kind === 'block' && item.parentId === id && item.alive !== false).sort((a, b) => a.position - b.position)
    .map(block => [block.blockType, w.snapshot().objects.find(item => item.id === block.attachmentId)?.name]);
  return { root, w, apply, open, blocks };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const old = file => { const past = new Date(Date.now() - 10_000); utimesSync(file, past, past); };
// Two looks: the first sees a file, the second takes it once it hasn't changed.
const twice = async inbox => { await inbox.poll(); return inbox.poll(); };

test('new files land on the quick capture page as the right blocks; old, hidden and unfinished ones are left out', async t => {
  const { root, w, apply, open, blocks } = fixture(t);
  apply([{ type: 'page.create', id: 'inbox-page', title: '받은 것' }, { type: 'workspace.update', capturePageId: 'inbox-page' }]);
  const folder = path.join(root, 'scans');
  mkdirSync(folder); writeFileSync(path.join(folder, '원래 있던 파일.txt'), '예전 것');
  const inbox = open();
  const status = inbox.configure({ folder });
  assert.equal(status.folder, folder);
  assert.deepEqual(status.target, { id: 'inbox-page', title: '받은 것' });
  for (const [name, data] of [['영수증.png', png], ['계약서.pdf', Buffer.from('%PDF-1.4\n%%EOF')], ['메모.txt', Buffer.from('창고 열쇠')], ['사진.heic', Buffer.from('heic')], ['.DS_Store', Buffer.from('x')], ['~$문서.docx', Buffer.from('x')], ['받는 중.pdf.crdownload', Buffer.from('x')]]) {
    writeFileSync(path.join(folder, name), data); old(path.join(folder, name));
  }
  const first = await inbox.poll();
  assert.equal(first.waiting, 4, 'seen once, not yet taken');
  assert.deepEqual(blocks('inbox-page'), []);
  await inbox.poll();
  assert.deepEqual(blocks('inbox-page').sort(), [['file', '메모.txt'], ['file', '사진.heic'], ['image', '영수증.png'], ['pdf', '계약서.pdf']].sort());
  const history = [w.history(1)].flat()[0];
  assert.equal(history.actor, 'inbox-folder');
  assert.ok(existsSync(path.join(folder, '영수증.png')), 'the file stays where it was');
  // Nothing new: nothing taken again. A finished download comes in under its real name.
  await twice(inbox);
  assert.equal(blocks('inbox-page').length, 4);
  renameSync(path.join(folder, '받는 중.pdf.crdownload'), path.join(folder, '받은 문서.pdf'));
  await twice(inbox);
  assert.deepEqual(blocks('inbox-page').at(-1), ['pdf', '받은 문서.pdf']);
  // A file saved again (new content) comes in again as a new block.
  writeFileSync(path.join(folder, '메모.txt'), '창고 열쇠는 경비실'); old(path.join(folder, '메모.txt'));
  await twice(inbox);
  assert.deepEqual(blocks('inbox-page').at(-1), ['file', '메모.txt']);
  assert.equal(blocks('inbox-page').length, 6);
  assert.equal(mediaTypeOf('보고서.HWPX'), 'application/hwp+zip');
});

test('without a quick capture page it waits and says why; "move" puts taken files into Imported; nothing is deleted', async t => {
  const { root, apply, open, blocks } = fixture(t);
  const folder = path.join(root, 'new-inbox');
  const inbox = open();
  inbox.configure({ folder, after: 'move' });
  assert.ok(existsSync(folder), 'made when only its parent existed');
  writeFileSync(path.join(folder, 'a.png'), png); old(path.join(folder, 'a.png'));
  const waiting = await twice(inbox);
  assert.equal(waiting.error.code, 'INBOX_TARGET');
  apply([{ type: 'page.create', id: 'p', title: '받은 것' }, { type: 'workspace.update', capturePageId: 'p' }]);
  mkdirSync(path.join(folder, 'Imported')); writeFileSync(path.join(folder, 'Imported', 'a.png'), 'earlier one');
  const done = await inbox.poll();
  assert.equal(done.error, null);
  assert.deepEqual(blocks('p'), [['image', 'a.png']]);
  assert.deepEqual(readdirSync(folder).sort(), ['Imported']);
  assert.deepEqual(readdirSync(path.join(folder, 'Imported')).sort(), ['a 2.png', 'a.png'], 'an earlier file there keeps its name');
  assert.equal(done.last.count, 1);
});

test('the folder: not home, a disk top, a data folder or a Markdown mirror; the server routes', async t => {
  const { root, w, apply, open } = fixture(t);
  const inbox = open();
  const code = name => error => error?.code === name;
  assert.throws(() => inbox.configure({ folder: 'relative' }), code('INBOX_FOLDER'));
  assert.throws(() => inbox.configure({ folder: '~' }), code('INBOX_FOLDER'));
  assert.throws(() => inbox.configure({ folder: path.join(w.directory, 'blobs') }), code('INBOX_FOLDER'));
  const mirror = path.join(root, 'mirror'); mkdirSync(mirror); writeFileSync(path.join(mirror, '.pageyard-mirror.json'), '{}');
  assert.throws(() => inbox.configure({ folder: path.join(mirror, 'files') }), code('INBOX_FOLDER'));
  assert.throws(() => inbox.configure({ folder: path.join(root, 'no', 'parent') }), code('INBOX_FOLDER'));
  assert.throws(() => inbox.configure({ after: 'delete' }), code('INBOX_AFTER'));
  // Off again: the setting is cleared and the folder left as it is.
  const folder = path.join(root, 'drop'); inbox.configure({ folder });
  assert.equal(inbox.configure({ folder: null }).folder, null);
  assert.ok(existsSync(folder));
  // Server: status, setting, a look now.
  apply([{ type: 'page.create', id: 'p', title: '받은 것' }, { type: 'workspace.update', capturePageId: 'p' }]);
  const server = createLocalServer(w, { inbox: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeEventStreams?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await (await fetch(`${base}/api/inbox`)).json()).folder, null);
  const served = path.join(root, 'served');
  const set = await post('/api/inbox', { folder: served, after: 'keep' });
  assert.equal(set.body.folder, served);
  assert.equal(set.body.target.title, '받은 것');
  assert.equal((await post('/api/inbox', { folder: 'x' })).body.error.code, 'INBOX_FOLDER');
  writeFileSync(path.join(served, 'n.txt'), 'note'); old(path.join(served, 'n.txt'));
  await post('/api/inbox/run', {});
  const after = await post('/api/inbox/run', {});
  assert.equal(after.body.last.count, 1);
});

test('a file is known by what it is: renamed, briefly gone or moved back, it never comes in twice; "move" leaves a changed file', async t => {
  const { root, w, apply, open, blocks } = fixture(t);
  apply([{ type: 'page.create', id: 'p', title: '받은 것' }, { type: 'workspace.update', capturePageId: 'p' }]);
  const folder = path.join(root, 'inbox'); mkdirSync(folder);
  for (let n = 0; n < 3; n++) { writeFileSync(path.join(folder, `옛 파일 ${n}.txt`), `옛 ${n}`); old(path.join(folder, `옛 파일 ${n}.txt`)); }
  const inbox = open();
  inbox.configure({ folder });
  // The folder looks empty for a moment (a share reconnecting), then everything is back: nothing comes in.
  renameSync(folder, `${folder}-away`); await inbox.poll(); mkdirSync(folder); await inbox.poll();
  rmSync(folder, { recursive: true }); renameSync(`${folder}-away`, folder);
  await twice(inbox);
  assert.deepEqual(blocks('p'), []);
  // Renamed: not again.
  writeFileSync(path.join(folder, '새 파일.txt'), '새것'); old(path.join(folder, '새 파일.txt'));
  await twice(inbox);
  assert.equal(blocks('p').length, 1);
  renameSync(path.join(folder, '새 파일.txt'), path.join(folder, '이름 바꾼 파일.txt'));
  await twice(inbox);
  assert.equal(blocks('p').length, 1);
  // "move": a file replaced between reading and moving stays, and comes in as what it is now.
  inbox.configure({ after: 'move' });
  writeFileSync(path.join(folder, '바뀔 파일.txt'), '처음'); old(path.join(folder, '바뀔 파일.txt'));
  await inbox.poll();
  const putBlobStream = w.putBlobStream.bind(w);
  w.putBlobStream = async (...args) => { const result = await putBlobStream(...args); writeFileSync(path.join(folder, '바뀔 파일.txt'), '그 사이 바뀐 내용'); old(path.join(folder, '바뀔 파일.txt')); return result; };
  await inbox.poll();
  w.putBlobStream = putBlobStream;
  assert.ok(existsSync(path.join(folder, '바뀔 파일.txt')), 'not moved: it changed after it was read');
  await twice(inbox);
  assert.ok(!existsSync(path.join(folder, '바뀔 파일.txt')), 'its new content came in, then it was moved');
  assert.equal(blocks('p').length, 3);
});

test('the inbox and the mirror never share a folder; a link can\'t lead the inbox into the data folder', async t => {
  const { root, w, open } = fixture(t);
  const { symlinkSync } = await import('node:fs');
  const { MarkdownMirror } = await import('../src/mirror.mjs');
  const inbox = open(), mirror = new MarkdownMirror(w, { delay: 3_600_000 });
  t.after(() => mirror.close());
  const shared = path.join(root, 'shared');
  inbox.configure({ folder: shared });
  assert.throws(() => mirror.configure(shared), error => error.code === 'MIRROR_FOLDER');
  assert.throws(() => mirror.configure(path.join(shared, 'inside')), error => error.code === 'MIRROR_FOLDER');
  inbox.configure({ folder: null });
  mirror.configure(path.join(root, 'mirror'));
  assert.throws(() => inbox.configure({ folder: path.join(root, 'mirror') }), error => error.code === 'INBOX_FOLDER');
  symlinkSync(w.blobDirectory, path.join(root, 'innocent'));
  assert.throws(() => inbox.configure({ folder: path.join(root, 'innocent') }), error => error.code === 'INBOX_FOLDER');
});
