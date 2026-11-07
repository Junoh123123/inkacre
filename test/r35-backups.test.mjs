import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Workspace } from '../src/workspace.mjs';
import { BackupManager } from '../src/backups.mjs';
import { startLocalServer } from '../src/server.mjs';

// r35 (34차): 자동 백업 — on a schedule when something changed, hard links for attachments already backed up,
// scheduled backups pruned to the number kept, a folder of your choice, checking and opening a backup.
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'pageyard-backups-'));
  const w = new Workspace(path.join(root, 'data')); let i = 0;
  const apply = operations => w.execute({ id: `b-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  const managers = [];
  const open = () => { const manager = new BackupManager(w, { tick: 3_600_000, firstCheck: 3_600_000 }); managers.push(manager); return manager; };
  t.after(() => { for (const manager of managers) manager.close(); w.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, w, apply, open };
}
const age = (backup, ms) => { const file = path.join(backup.path, 'manifest.json'), manifest = JSON.parse(readFileSync(file, 'utf8')); manifest.completedAt = new Date(Date.now() - ms).toISOString(); writeFileSync(file, JSON.stringify(manifest)); };

test('scheduled backups: daily by default, only when something changed, attachments linked, the oldest pruned', async t => {
  const { w, apply, open } = fixture(t);
  const manager = open();
  assert.deepEqual([manager.config.every, manager.config.keep, manager.config.folder], ['daily', 7, null]);
  assert.match(JSON.parse(readFileSync(path.join(w.directory, 'backup.json'), 'utf8')).key, /^[0-9a-f-]{36}$/);
  assert.equal(manager.due(), false, 'nothing to back up in an empty workspace');
  const blob = w.putBlob(Buffer.from('첨부 파일 내용'));
  apply([{ type: 'page.create', id: 'p', title: '페이지' }, { type: 'attachment.register', id: 'a', name: 'a.txt', mediaType: 'text/plain', ...blob }, { type: 'block.create', id: 'b', parentId: 'p', blockType: 'file', attachmentId: 'a' }]);
  assert.equal(manager.due(), true);
  await manager.check();
  let list = manager.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].auto, true);
  assert.equal(path.dirname(list[0].path), path.join(w.directory, 'backups'));
  assert.notEqual(statSync(path.join(list[0].path, 'blobs', blob.sha256)).ino, statSync(path.join(w.blobDirectory, blob.sha256)).ino, 'a copy: nothing done to a backup touches the live file');
  // Not due again until the period has passed — and then only if something changed.
  assert.equal(manager.due(), false);
  age(list[0], 25 * 3600e3);
  assert.equal(manager.due(), false, 'nothing changed since');
  apply([{ type: 'page.update', id: 'p', title: '바뀐 페이지' }]);
  assert.equal(manager.due(), true);
  await manager.check();
  list = manager.list();
  assert.equal(list.length, 2);
  assert.equal(statSync(path.join(list[0].path, 'blobs', blob.sha256)).ino, statSync(path.join(list[1].path, 'blobs', blob.sha256)).ino, 'already backed up: a link to the earlier backup');
  // Keep 3: the oldest scheduled ones go; one made by hand stays.
  manager.configure({ keep: 3 });
  await manager.run({ auto: false });
  for (let n = 0; n < 4; n++) { apply([{ type: 'page.update', id: 'p', title: `제목 ${n}` }]); await manager.run({ auto: true }); }
  list = manager.list();
  assert.deepEqual(list.map(item => item.auto), [true, true, true, false]);
  assert.equal(readdirSync(path.join(w.directory, 'backups')).length, 4);
  // Hourly, weekly and off.
  manager.configure({ every: 'off' });
  apply([{ type: 'page.update', id: 'p', title: '또 바뀜' }]);
  for (const backup of manager.list()) age(backup, 30 * 86400e3);
  assert.equal(manager.due(), false);
  manager.configure({ every: 'weekly' });
  assert.equal(manager.due(), true);
  assert.throws(() => manager.configure({ keep: 5 }), error => error.code === 'BACKUP_KEEP');
  assert.throws(() => manager.configure({ every: 'monthly' }), error => error.code === 'BACKUP_EVERY');
});

test('another folder (another disk): copies there; an unplugged drive is reported, not recreated; check finds damage', async t => {
  const { root, w, apply, open } = fixture(t);
  const blob = w.putBlob(Buffer.from('사진이라 치고'));
  apply([{ type: 'page.create', id: 'p', title: '페이지' }, { type: 'attachment.register', id: 'a', name: 'a.png', mediaType: 'image/png', ...blob }, { type: 'block.create', id: 'b', parentId: 'p', blockType: 'image', attachmentId: 'a' }]);
  const manager = open(), drive = path.join(root, 'drive');
  const code = name => error => error?.code === name;
  assert.throws(() => manager.configure({ folder: drive }), code('BACKUP_FOLDER'), 'the folder must exist');
  assert.throws(() => manager.configure({ folder: 'relative' }), code('BACKUP_FOLDER'));
  assert.throws(() => manager.configure({ folder: path.join(w.directory, 'blobs') }), code('BACKUP_FOLDER'), 'not inside the data folder');
  mkdirSync(drive);
  const status = manager.configure({ folder: drive });
  assert.equal(status.folder, drive);
  assert.equal(status.sameDisk, false);
  const made = await manager.run({ auto: false });
  assert.equal(path.dirname(path.dirname(made.destination)), drive);
  assert.match(path.basename(path.dirname(made.destination)), /^Pageyard backups [0-9a-f]{8}$/);
  assert.equal(made.workspace, manager.config.key);
  assert.deepEqual(await manager.verify(manager.list()[0].name).then(result => result.ok), true);
  // Damage is found by the check.
  writeFileSync(path.join(made.destination, 'blobs', blob.sha256), '바뀐 내용!!!!!!!!!');
  await assert.rejects(manager.verify(manager.list()[0].name), code('BACKUP_INTEGRITY'));
  // The drive is gone: the backup fails with a clear reason and nothing is made in its place.
  rmSync(drive, { recursive: true });
  apply([{ type: 'page.update', id: 'p', title: '바뀜' }]);
  await assert.rejects(manager.run({ auto: true }), code('BACKUP_MISSING'));
  assert.equal(manager.status().error.code, 'BACKUP_MISSING');
  assert.ok(!existsSync(drive));
  // Back to the data folder.
  assert.equal(manager.configure({ folder: null }).folder, null);
  await manager.run({ auto: true });
  assert.equal(manager.status().error, null);
});

test('the server: settings, a backup by hand into the chosen place, and a backup opened as a new workspace', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r35-server-'));
  const { server, workspace, registry } = startLocalServer({ directory, port: 0 });
  await once(server, 'listening');
  t.after(async () => {
    for (const { server: each, workspace: data } of registry.running.values()) { each.closeEventStreams?.(); await new Promise(resolve => each.close(resolve)); data.close(); }
    rmSync(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (base, route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  workspace.execute({ id: 'seed', actor: 'user', expectedRevision: workspace.revision, operations: [{ type: 'workspace.update', name: '내 노트' }, { type: 'page.create', id: 'doc', title: '그때의 문서' }] });
  let status = await (await fetch(`${origin}/api/backups`)).json();
  assert.equal(status.every, 'daily');
  assert.equal(status.latest, null);
  assert.equal(status.changedSince, true);
  assert.equal((await post(origin, '/api/backups/settings', { every: 'hourly', keep: 14 })).body.every, 'hourly');
  const made = await post(origin, '/api/backups', {});
  assert.equal(made.status, 201);
  assert.equal(made.body.auto, false);
  status = await (await fetch(`${origin}/api/backups`)).json();
  assert.equal(status.backups.length, 1);
  assert.equal(status.changedSince, false);
  assert.equal((await post(origin, '/api/backups/verify', { name: status.backups[0].name })).body.ok, true);
  // Changed since; then the backup opened as a new workspace has the page as it was.
  workspace.execute({ id: 'later', actor: 'user', expectedRevision: workspace.revision, operations: [{ type: 'page.update', id: 'doc', title: '지금의 문서' }] });
  const opened = await post(origin, '/api/backups/open', { name: status.backups[0].name, title: '내 노트 (백업)' });
  assert.equal(opened.status, 201);
  const restored = await (await fetch(`${opened.body.url}/api/state`)).json();
  assert.equal(restored.objects.find(item => item.id === 'doc').title, '그때의 문서');
  assert.equal(restored.objects.find(item => item.id === 'workspace-settings').name, '내 노트 (백업)');
  assert.equal(workspace.snapshot().objects.find(item => item.id === 'doc').title, '지금의 문서', 'this workspace untouched');
  const missing = await post(origin, '/api/backups/open', { name: 'nope' });
  assert.equal(missing.body.error.code, 'BACKUP_NOT_FOUND');
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'workspaces.json'), 'utf8')).length, 1, 'nothing registered for a failed open');
});

test('damage never spreads: a bad copy in the last backup is replaced from the live file; a bad live file is left out and reported', async t => {
  const { w, apply, open } = fixture(t);
  const { symlinkSync, writeFileSync: write, mkdirSync: mkdir } = await import('node:fs');
  const good = w.putBlob(Buffer.from('좋은 첨부 내용')), other = w.putBlob(Buffer.from('다른 첨부'));
  apply([{ type: 'page.create', id: 'p', title: '페이지' }, { type: 'attachment.register', id: 'a', name: 'a.txt', mediaType: 'text/plain', ...good }, { type: 'attachment.register', id: 'b', name: 'b.txt', mediaType: 'text/plain', ...other }]);
  const manager = open();
  const first = await manager.run({ auto: true });
  write(path.join(first.destination, 'blobs', good.sha256), '망가진 내용!!!!!!!!!');
  apply([{ type: 'page.update', id: 'p', title: '바뀜' }]);
  const second = await manager.run({ auto: true });
  assert.notEqual(statSync(path.join(second.destination, 'blobs', good.sha256)).ino, statSync(path.join(first.destination, 'blobs', good.sha256)).ino, 'copied again from the live file');
  assert.equal(statSync(path.join(second.destination, 'blobs', other.sha256)).ino, statSync(path.join(first.destination, 'blobs', other.sha256)).ino, 'the intact one still linked');
  await Workspace.verifyBackup(second.destination);
  await assert.rejects(Workspace.verifyBackup(first.destination), error => error.code === 'BACKUP_INTEGRITY');
  // A live file damaged after it was backed up: the good copy in the last backup carries on.
  write(path.join(w.blobDirectory, other.sha256), '살아 있는 파일이 망가짐');
  apply([{ type: 'page.update', id: 'p', title: '또 바뀜' }]);
  const kept = await manager.run({ auto: true });
  assert.equal(kept.damaged, undefined);
  assert.equal(readFileSync(path.join(kept.destination, 'blobs', other.sha256), 'utf8'), '다른 첨부');
  // A new attachment already damaged: the backup still completes without it, and says so.
  const fresh = w.putBlob(Buffer.from('새 첨부'));
  apply([{ type: 'attachment.register', id: 'c', name: 'c.txt', mediaType: 'text/plain', ...fresh }]);
  write(path.join(w.blobDirectory, fresh.sha256), '바로 망가짐');
  const third = await manager.run({ auto: true });
  assert.deepEqual(third.damaged.map(item => item.id), ['c']);
  assert.equal(manager.status().error.code, 'BACKUP_DAMAGED');
  assert.equal(manager.list()[0].damaged, 1);
  await Workspace.verifyBackup(third.destination);
  // Half-made backups (".partial") are never listed and are cleared on the next run; links and other workspaces'
  // folders are never pruned.
  const root = manager.root();
  mkdir(path.join(root, '2020-01-01T00-00-00-000Z-auto.partial', 'blobs'), { recursive: true });
  mkdir(path.join(root, '2020-01-02T00-00-00-000Z-auto')); write(path.join(root, '2020-01-02T00-00-00-000Z-auto', 'manifest.json'), JSON.stringify({ schemaVersion: 1, revision: 1, completedAt: '2020-01-02T00:00:00.000Z', auto: true, attachments: [] }));
  symlinkSync(first.destination, path.join(root, '2020-01-03T00-00-00-000Z-auto'));
  manager.configure({ keep: 3 });
  for (let n = 0; n < 4; n++) { apply([{ type: 'page.update', id: 'p', title: `제목 ${n}` }]); await manager.run({ auto: true }); }
  const names = readdirSync(root);
  assert.ok(!names.some(name => name.endsWith('.partial')));
  assert.ok(names.includes('2020-01-02T00-00-00-000Z-auto'), 'no key of ours: never pruned');
  assert.ok(names.includes('2020-01-03T00-00-00-000Z-auto'), 'a link: never pruned');
  assert.ok(!manager.list().some(item => item.name === '2020-01-03T00-00-00-000Z-auto'), 'and never listed');
  assert.equal(manager.list().filter(item => item.mine && item.auto).length, 3);
});

test('the schedule: a manual backup asked for during a scheduled one is its own; a failure waits; a future date or a missing backup folder', async t => {
  const { root, w, apply, open } = fixture(t);
  apply([{ type: 'page.create', id: 'p', title: '페이지' }]);
  const manager = open();
  const scheduled = manager.run({ auto: true }), byHand = manager.run({ auto: false });
  const [a, b] = await Promise.all([scheduled, byHand]);
  assert.equal(a.auto, true); assert.equal(b.auto, false); assert.notEqual(a.destination, b.destination);
  // A backup dated far in the future doesn't stop the schedule.
  const latest = manager.list()[0], file = path.join(latest.path, 'manifest.json'), manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const backup of manager.list()) { const f = path.join(backup.path, 'manifest.json'), m = JSON.parse(readFileSync(f, 'utf8')); m.completedAt = '2031-01-01T00:00:00.000Z'; writeFileSync(f, JSON.stringify(m)); }
  apply([{ type: 'page.update', id: 'p', title: '바뀜' }]);
  assert.equal(manager.due(), true);
  void manifest;
  // The chosen disk's backup folder gone (the drive's mount point is still there): reported, not made again here; and
  // a failed scheduled backup waits before trying again.
  const drive = path.join(root, 'drive'); mkdirSync(drive);
  manager.configure({ folder: drive });
  assert.ok(existsSync(manager.root()), 'made when the folder was chosen');
  rmSync(manager.root(), { recursive: true });
  await assert.rejects(manager.run({ auto: true }), error => error.code === 'BACKUP_MISSING');
  assert.ok(!existsSync(manager.root()));
  assert.equal(manager.due(), false, 'waits after a failure');
});
