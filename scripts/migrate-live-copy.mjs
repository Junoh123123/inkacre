// Makes a NEW workspace folder for daily use from an existing one, without writing to the
// source: the source files are byte-copied into a scratch folder (hashes checked before and
// after so a concurrent write aborts the copy), the copy's WAL is folded in there, the
// attachments it refers to are verified and copied, and the result goes through the regular
// backup restore (manifest hash, quick_check, revision). Never overwrites an existing folder.
//
//   node scripts/migrate-live-copy.mjs --from data --to data-live
import { parseArgs } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from '../src/workspace.mjs';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' } } });
if (!values.from || !values.to) throw new Error('사용법: node scripts/migrate-live-copy.mjs --from 원본폴더 --to 새폴더');
const source = path.resolve(values.from), target = path.resolve(values.to);
if (source === target) throw new Error('원본과 다른 새 폴더를 지정하세요.');
if (existsSync(target)) throw new Error(`이미 있는 폴더에는 쓰지 않습니다: ${target}`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['workspace.sqlite', 'workspace.sqlite-wal'];
const fingerprint = () => Object.fromEntries(names.map(name => {
  const file = path.join(source, name);
  return [name, existsSync(file) ? { bytes: statSync(file).size, sha256: digest(readFileSync(file)) } : null];
}));

const stage = mkdtempSync(path.join(tmpdir(), 'pageyard-live-copy-'));
try {
  const before = fingerprint();
  if (!before['workspace.sqlite']) throw new Error('원본 폴더에 workspace.sqlite가 없습니다.');
  for (const name of names) if (before[name]?.bytes) copyFileSync(path.join(source, name), path.join(stage, name));
  const after = fingerprint();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('복사하는 동안 원본이 바뀌었습니다. 원본 서버가 쉬는 때 다시 실행하세요.');

  // Fold the WAL into the scratch copy and check it.
  const db = new DatabaseSync(path.join(stage, 'workspace.sqlite'));
  let revision, files;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const check = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    if (check !== 'ok') throw new Error(`복사본 무결성 검사 실패: ${check}`);
    revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
    const retained = new Map();
    const retain = file => { if (file?.kind === 'attachment') retained.set(`${file.id}:${file.sha256}`, file); };
    db.prepare("SELECT data FROM objects WHERE kind='attachment'").all().forEach(row => retain(JSON.parse(row.data)));
    for (const row of db.prepare('SELECT changes FROM commands').all()) for (const change of JSON.parse(row.changes)) { retain(change.before); retain(change.after); }
    files = [...retained.values()];
    db.exec('PRAGMA journal_mode=DELETE');
  } finally { db.close(); }

  mkdirSync(path.join(stage, 'blobs'), { recursive: true, mode: 0o700 });
  const missing = [];
  for (const file of files) {
    const from = path.join(source, 'blobs', file.sha256);
    if (!existsSync(from)) { missing.push(file.id); continue; }
    const bytes = readFileSync(from);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`첨부 파일 내용이 기록과 다릅니다: ${file.id}`);
    copyFileSync(from, path.join(stage, 'blobs', file.sha256));
  }
  if (missing.length) throw new Error(`원본에 없는 첨부 ${missing.length}개: ${missing.join(', ')}`);
  const manifest = { schemaVersion: 1, revision, sqliteSha256: digest(readFileSync(path.join(stage, 'workspace.sqlite'))), attachments: files.map(file => ({ id: file.id, sha256: file.sha256, bytes: file.bytes })), completedAt: new Date().toISOString() };
  writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  const restored = Workspace.restoreBackup(stage, target);
  writeFileSync(path.join(target, 'migrated-from.json'), JSON.stringify({ source, sourceFiles: before, revision, attachments: files.length, migratedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ target: restored.destination, revision, attachments: files.length, sourceUnchanged: JSON.stringify(fingerprint()) === JSON.stringify(before) }));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
