import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';
import { MarkdownMirror, MANIFEST } from '../src/mirror.mjs';

// r34 (33차): Markdown 폴더 미러 — the workspace as Markdown, CSV and its files in a folder, one way, a moment after
// each change, touching only the files it wrote.
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'pageyard-mirror-'));
  const w = new Workspace(path.join(root, 'data')); let i = 0;
  const apply = operations => w.execute({ id: `m-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  const mirrors = [];
  const open = options => { const mirror = new MarkdownMirror(w, options); mirrors.push(mirror); return mirror; };
  t.after(() => { for (const mirror of mirrors) mirror.close(); w.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, w, apply, open };
}
const tree = folder => readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(folder, path.join(entry.parentPath ?? entry.path, entry.name))).sort();
const read = (folder, file) => readFileSync(path.join(folder, file), 'utf8');

test('the mirror writes the workspace as files, then only what changed; renames and removals follow', t => {
  const { root, w, apply, open } = fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  apply([
    { type: 'page.create', id: 'home', title: '작업 공간' },
    { type: 'block.create', id: 'h1', parentId: 'home', blockType: 'paragraph', richText: [{ text: '첫 문단 ' }, { text: '일기', pageId: 'diary' }] },
    { type: 'page.create', id: 'diary', title: '일기', parentId: 'home' },
    { type: 'block.create', id: 'd1', parentId: 'diary', blockType: 'todo', richText: [{ text: '산책' }], checked: true },
    { type: 'attachment.register', id: 'pic', name: '사진.png', mediaType: 'image/png', ...w.putBlob(png) },
    { type: 'block.create', id: 'd2', parentId: 'diary', blockType: 'image', attachmentId: 'pic' },
    { type: 'page.create', id: 'db', title: '독서', parentId: 'home' },
    { type: 'source.create', id: 's', pageId: 'db', name: '독서', titlePropertyId: 'title' },
    { type: 'property.create', id: 'author', sourceId: 's', name: '저자', propertyType: 'text' },
    { type: 'page.create', id: 'book', title: '토지', sourceId: 's' },
    { type: 'value.set', pageId: 'book', propertyId: 'author', value: '박경리' },
    { type: 'page.create', id: 'later', title: '버릴 메모' },
  ]);
  const folder = path.join(root, 'mirror');
  const mirror = open({ delay: 10_000 });
  const status = mirror.configure(folder);
  assert.equal(status.error, null);
  assert.deepEqual(tree(folder), [MANIFEST, '버릴 메모.md', '작업 공간.md', '작업 공간/독서.csv', '작업 공간/독서/토지.md', '작업 공간/일기.md', 'files/사진.png'].sort());
  assert.match(read(folder, '작업 공간.md'), /^# 작업 공간\n\n첫 문단 \[일기\]\(%EC%9E%91%EC%97%85%20%EA%B3%B5%EA%B0%84\/%EC%9D%BC%EA%B8%B0\.md\)/);
  assert.match(read(folder, '작업 공간/일기.md'), /- \[x\] 산책[\s\S]*!\[사진\.png\]\(\.\.\/files\/%EC%82%AC%EC%A7%84\.png\)/);
  assert.match(read(folder, '작업 공간/독서/토지.md'), /^# 토지\n\n저자: 박경리/);
  assert.ok(readFileSync(path.join(folder, 'files/사진.png')).equals(png));
  assert.equal(status.last.written, 6);
  const manifest = JSON.parse(read(folder, MANIFEST));
  assert.equal(manifest.app, 'Pageyard');
  assert.deepEqual(Object.keys(manifest.files).sort(), tree(folder).filter(file => file !== MANIFEST));

  // Nothing changed → nothing written. One page changed → that file only.
  assert.equal(mirror.sync().last.written, 0);
  apply([{ type: 'block.update', id: 'd1', richText: [{ text: '산책 30분' }] }]);
  const second = mirror.sync().last;
  assert.equal(second.written, 1);
  assert.match(read(folder, '작업 공간/일기.md'), /산책 30분/);
  // Renamed: the old file goes; a page in the trash: its file goes; folders left empty go too.
  apply([{ type: 'page.update', id: 'diary', title: '하루 기록' }, { type: 'node.trash', id: 'later' }, { type: 'node.trash', id: 'db' }]);
  const third = mirror.sync().last;
  assert.deepEqual(tree(folder), [MANIFEST, '작업 공간.md', '작업 공간/하루 기록.md', 'files/사진.png'].sort());
  assert.equal(third.removed, 4);
  assert.ok(!existsSync(path.join(folder, '작업 공간/독서')), 'the database folder left empty is removed');
  assert.match(read(folder, '작업 공간.md'), /\[일기\]\(%EC%9E%91%EC%97%85%20%EA%B3%B5%EA%B0%84\/%ED%95%98%EB%A3%A8%20%EA%B8%B0%EB%A1%9D\.md\)/, 'links follow the new name');
});

test('files changed or added outside are never overwritten or removed; they are listed instead', t => {
  const { root, w, apply, open } = fixture(t);
  apply([{ type: 'page.create', id: 'a', title: '가' }, { type: 'page.create', id: 'b', title: '나' }]);
  const folder = path.join(root, 'mirror'), mirror = open({ delay: 10_000 });
  mirror.configure(folder);
  writeFileSync(path.join(folder, '가.md'), '# 가\n\n밖에서 고친 내용이 더 깁니다\n');
  writeFileSync(path.join(folder, '내 메모.txt'), '내 파일');
  apply([{ type: 'block.create', id: 'a1', parentId: 'a', blockType: 'paragraph', richText: [{ text: '앱에서 쓴 문단' }] }, { type: 'node.trash', id: 'b' }]);
  writeFileSync(path.join(folder, '나.md'), '# 나\n\n이것도 밖에서 고침\n');
  const status = mirror.sync();
  assert.deepEqual(status.last.changedOutside, ['가.md', '나.md']);
  assert.match(read(folder, '가.md'), /밖에서 고친 내용/);
  assert.ok(existsSync(path.join(folder, '나.md')), 'a page gone from the app keeps its changed file');
  assert.equal(read(folder, '내 메모.txt'), '내 파일');
  // A page whose title matches someone else's file: that file is kept; once it is gone the mirror writes its own.
  apply([{ type: 'page.create', id: 'c', title: '내 메모' }]);
  writeFileSync(path.join(folder, '내 메모.md'), '남의 파일');
  assert.ok(mirror.sync().last.changedOutside.includes('내 메모.md'));
  assert.equal(read(folder, '내 메모.md'), '남의 파일');
  rmSync(path.join(folder, '가.md'));
  rmSync(path.join(folder, '내 메모.md'));
  const after = mirror.sync().last;
  assert.match(read(folder, '가.md'), /앱에서 쓴 문단/);
  assert.equal(read(folder, '내 메모.md'), '# 내 메모\n');
  assert.deepEqual(after.changedOutside, [], 'a changed file of a page that is gone is yours now: not listed again');
  assert.ok(existsSync(path.join(folder, '나.md')));
});

test('the folder: empty or new, or this workspace’s mirror; ~ is home; the setting stays on this computer', async t => {
  const { root, w, apply, open } = fixture(t);
  apply([{ type: 'page.create', id: 'p', title: '페이지' }]);
  const mirror = open({ delay: 10_000 });
  const code = name => error => error?.code === name;
  mkdirSync(path.join(root, 'busy')); writeFileSync(path.join(root, 'busy', 'x.md'), 'x');
  assert.throws(() => mirror.configure(path.join(root, 'busy')), code('MIRROR_FOLDER'), 'not empty');
  assert.throws(() => mirror.configure('relative/folder'), code('MIRROR_FOLDER'));
  assert.throws(() => mirror.configure(path.join(w.directory, 'mirror')), code('MIRROR_FOLDER'), 'inside the data folder');
  assert.throws(() => mirror.configure(root), code('MIRROR_FOLDER'), 'holds the data folder');
  assert.throws(() => mirror.configure(path.join(root, 'missing', 'deeper')), code('MIRROR_FOLDER'), 'parent missing');
  assert.throws(() => mirror.configure('~'), code('MIRROR_FOLDER'), 'the home folder itself');
  assert.equal(mirror.resolve('~/Pageyard 미러'), path.join((await import('node:os')).homedir(), 'Pageyard 미러'));
  const folder = path.join(root, 'mirror');
  mirror.configure(folder);
  const config = JSON.parse(readFileSync(path.join(w.directory, 'mirror.json'), 'utf8'));
  assert.equal(config.folder, folder);
  assert.match(config.key, /^[0-9a-f-]{36}$/, 'the mirror knows its folder by a key of its own, not the data path');
  assert.equal(mirror.configure(folder).error, null, 'its own mirror can be chosen again');
  // Another workspace can't take this folder.
  const other = new Workspace(path.join(root, 'other'));
  t.after(() => other.close());
  const second = new MarkdownMirror(other, { delay: 10_000 });
  t.after(() => second.close());
  assert.throws(() => second.configure(folder), code('MIRROR_FOLDER'));
  // A new mirror object (a restart) picks the folder up and syncs after the next change, a moment later.
  mirror.configure(null);
  assert.equal(JSON.parse(readFileSync(path.join(w.directory, 'mirror.json'), 'utf8')).folder, null);
  assert.ok(existsSync(path.join(folder, '페이지.md')), 'turning it off leaves the files');
  mirror.configure(folder); mirror.close();
  const restarted = open({ delay: 20 });
  apply([{ type: 'page.create', id: 'q', title: '새 페이지 하나' }]);
  for (let tries = 0; tries < 50 && !existsSync(path.join(folder, '새 페이지 하나.md')); tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(path.join(folder, '새 페이지 하나.md')));
  assert.equal(restarted.status().error, null);
});

test('the server: GET and POST /api/mirror, and /api/mirror/run', async t => {
  const { root, w, apply } = fixture(t);
  apply([{ type: 'page.create', id: 'p', title: '서버에서' }]);
  const server = createLocalServer(w, { mirror: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeEventStreams?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await (await fetch(`${base}/api/mirror`)).json()).folder, null);
  const folder = path.join(root, 'served');
  const set = await post('/api/mirror', { folder });
  assert.equal(set.status, 200);
  assert.equal(set.body.folder, folder);
  assert.equal(set.body.last.files, 1);
  assert.ok(existsSync(path.join(folder, '서버에서.md')));
  const refused = await post('/api/mirror', { folder: 'not/absolute' });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'MIRROR_FOLDER');
  assert.equal((await post('/api/mirror/run', {})).body.last.written, 0);
  const off = await post('/api/mirror', { folder: null });
  assert.equal(off.body.folder, null);
});

test('one file that cannot be written is listed and skipped; the rest still goes, and it is written once it can be', t => {
  const { root, w, apply, open } = fixture(t);
  const long = '아주 긴 제목'.repeat(30);
  const blob = w.putBlob(Buffer.from('첨부 내용'));
  apply([
    { type: 'page.create', id: 'a', title: long },
    { type: 'page.create', id: 'b', title: '..' },
    { type: 'page.create', id: 'b1', title: '하위', parentId: 'b' },
    { type: 'page.create', id: 'c', title: '첨부' },
    { type: 'attachment.register', id: 'f', name: 'note.txt', mediaType: 'text/plain', ...blob },
    { type: 'block.create', id: 'fb', parentId: 'c', blockType: 'file', attachmentId: 'f' },
  ]);
  const stored = path.join(w.blobDirectory, blob.sha256), aside = `${stored}.aside`;
  renameSync(stored, aside);
  const folder = path.join(root, 'mirror'), mirror = open({ delay: 10_000 });
  const first = mirror.configure(folder).last;
  assert.equal(first.failedCount, 1);
  assert.equal(first.failed[0].path, 'files/note.txt');
  const files = tree(folder);
  assert.ok(files.includes('Untitled.md') && files.includes('Untitled/하위.md'), 'a ".." title becomes Untitled, never a path out');
  const longFile = files.find(file => file.startsWith('아주 긴 제목'));
  assert.ok(longFile && Buffer.byteLength(path.basename(longFile)) <= 160, 'a long title is cut to a name every disk accepts');
  assert.ok(existsSync(path.join(folder, MANIFEST)));
  renameSync(aside, stored);
  const second = mirror.sync().last;
  assert.equal(second.failedCount, 0);
  assert.deepEqual(second.changedOutside, []);
  assert.equal(read(folder, 'files/note.txt'), '첨부 내용');
});

test('an outside edit with the same size and time is still seen; links out of the folder are not followed', t => {
  const { root, w, apply, open } = fixture(t);
  apply([{ type: 'page.create', id: 'a', title: '할 일' }, { type: 'block.create', id: 'a1', parentId: 'a', blockType: 'todo', richText: [{ text: '장보기' }] }, { type: 'page.create', id: 'b', title: '상위' }, { type: 'page.create', id: 'b1', title: '하위', parentId: 'b' }]);
  const folder = path.join(root, 'mirror'), mirror = open({ delay: 10_000 });
  mirror.configure(folder);
  // Tick the box outside, keeping the size and the time (as some disks and sync tools do).
  const file = path.join(folder, '할 일.md'), before = statSync(file), text = read(folder, '할 일.md');
  writeFileSync(file, text.replace('- [ ]', '- [x]')); utimesSync(file, before.atime, before.mtime);
  apply([{ type: 'block.update', id: 'a1', richText: [{ text: '장보기!' }] }]);
  assert.deepEqual(mirror.sync().last.changedOutside, ['할 일.md']);
  assert.match(read(folder, '할 일.md'), /- \[x\] 장보기$/m, 'not overwritten');
  apply([{ type: 'node.trash', id: 'a' }]);
  mirror.sync();
  assert.ok(existsSync(file), 'not removed either');
  // A subfolder replaced by a link to somewhere else: nothing is written or removed there.
  const elsewhere = path.join(root, 'elsewhere'); mkdirSync(elsewhere); writeFileSync(path.join(elsewhere, '하위.md'), '# 하위\n');
  rmSync(path.join(folder, '상위'), { recursive: true }); symlinkSync(elsewhere, path.join(folder, '상위'));
  apply([{ type: 'page.create', id: 'b2', title: '새 하위', parentId: 'b' }]);
  const linked = mirror.sync().last;
  assert.ok(linked.failed.some(item => item.path === '상위/새 하위.md'));
  assert.deepEqual(readdirSync(elsewhere), ['하위.md']);
  apply([{ type: 'node.trash', id: 'b' }]);
  mirror.sync();
  assert.ok(existsSync(path.join(elsewhere, '하위.md')), 'a file behind a link is never removed');
});

test('each pass checks the folder again: gone (an unplugged drive) or filled by someone else, it is left alone', t => {
  const { root, w, apply, open } = fixture(t);
  apply([{ type: 'page.create', id: 'a', title: '가' }]);
  const folder = path.join(root, 'mirror'), mirror = open({ delay: 10_000 });
  mirror.configure(folder);
  rmSync(folder, { recursive: true });
  apply([{ type: 'page.create', id: 'b', title: '나' }]);
  assert.equal(mirror.sync().error.code, 'MIRROR_MISSING');
  assert.ok(!existsSync(folder), 'not made again');
  mkdirSync(folder); writeFileSync(path.join(folder, '남의 파일.md'), 'x');
  assert.equal(mirror.sync().error.code, 'MIRROR_FOLDER');
  assert.deepEqual(readdirSync(folder), ['남의 파일.md']);
  // Inside any Pageyard data folder (another workspace's included) is refused.
  const other = path.join(root, 'other-data'); mkdirSync(other); writeFileSync(path.join(other, 'workspace.sqlite'), '');
  assert.throws(() => mirror.configure(path.join(other, 'mirror')), error => error.code === 'MIRROR_FOLDER');
});
