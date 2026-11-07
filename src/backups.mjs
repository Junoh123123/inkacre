// 자동 백업: the workspace backed up on a schedule (hourly, daily or weekly) when something changed since the last
// backup — into <data>/backups by default, or a folder of your choice (another disk is what protects against a failed
// one). Attachments already in the previous backup (and still intact there) are hard links to it, so a backup costs
// only what changed. Only scheduled backups of this workspace are pruned, keeping the newest ones; backups you make
// yourself stay. Any backup can be checked whole, or opened as a new workspace beside this one. Settings live in
// backup.json beside the workspace (this computer's, not the workspace's data).
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { requireThat, WorkspaceError } from './contracts.mjs';
import { Workspace } from './workspace.mjs';

export const PERIODS = { hourly: 3600e3, daily: 86400e3, weekly: 7 * 86400e3 };
const KEEP = [3, 7, 14, 30, 90];
// A scheduled backup's own folder name: the time it was made, then "-auto" (and a number when two share a moment).
const SCHEDULED = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-auto(-\d+)?$/;
const STAMPED = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(auto|manual)(-\d+)?\.partial$/;
// After a failed scheduled backup, the next try waits this long (a full disk shouldn't be hit every few minutes).
const RETRY = 60 * 60_000;
const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
const comparable = value => { const normal = path.resolve(value).normalize('NFC'); return caseInsensitive ? normal.toLowerCase() : normal; };
const inside = (child, parent) => { const a = comparable(child), b = comparable(parent); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
const real = folder => { try { return realpathSync(folder); } catch { return path.resolve(folder); } };

export class BackupManager {
  constructor(workspace, { tick = 5 * 60_000, firstCheck = 60_000 } = {}) {
    this.workspace = workspace;
    this.configFile = path.join(workspace.directory, 'backup.json');
    this.config = { every: 'daily', keep: 7, folder: null, key: null };
    try { this.config = { ...this.config, ...JSON.parse(readFileSync(this.configFile, 'utf8')) }; } catch { /* defaults: daily, keep 7, in the data folder */ }
    if (!this.config.key) { this.config.key = randomUUID(); this.save(); }
    this.error = null; this.running = null; this.failedAt = 0; this.closed = false;
    this.timer = setInterval(() => this.check(), tick); this.timer.unref?.();
    this.first = setTimeout(() => this.check(), firstCheck); this.first.unref?.();
  }
  save() { writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), { mode: 0o600 }); }
  // Where this workspace's backups go: <data>/backups, or a folder of its own inside the chosen folder.
  root() { return this.config.folder ? path.join(this.config.folder, `Pageyard backups ${this.config.key.slice(0, 8)}`) : path.join(this.workspace.directory, 'backups'); }
  // Finished backups here (real folders with a manifest; not links, not ".partial"), newest first. Those of another
  // workspace are skipped; old ones made before backups were marked with their workspace are kept in the list.
  list() {
    const root = this.root();
    if (!existsSync(root)) return [];
    const found = [];
    for (const name of readdirSync(root)) {
      const dir = path.join(root, name);
      if (name.endsWith('.partial') || !lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
      try {
        const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        if (manifest.workspace && manifest.workspace !== this.config.key) continue;
        found.push({ name, path: dir, revision: manifest.revision, completedAt: manifest.completedAt, auto: !!manifest.auto, attachments: manifest.attachments?.length ?? 0, damaged: manifest.damaged?.length ?? 0, mine: manifest.workspace === this.config.key });
      } catch { /* not a finished backup */ }
    }
    return found.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  }
  // The chosen folder (its real path) must exist and stay out of any Pageyard data folder; this workspace's backup
  // folder is made in it now, so a missing one later means the disk isn't there.
  resolve(input) {
    let folder = String(input ?? '').trim();
    if (folder === '~' || folder.startsWith('~/') || folder.startsWith('~\\')) folder = path.join(homedir(), folder.slice(1));
    requireThat(path.isAbsolute(folder), 'BACKUP_FOLDER', '전체 경로를 입력하세요. 예: /Volumes/외장디스크/백업');
    requireThat(statSync(folder, { throwIfNoEntry: false })?.isDirectory(), 'BACKUP_FOLDER', '그 폴더를 찾을 수 없습니다. 이미 있는 폴더를 고르세요.');
    folder = real(folder);
    const data = real(this.workspace.directory);
    let dataFolder = inside(folder, data) || inside(data, folder);
    for (let dir = folder; !dataFolder; dir = path.dirname(dir)) { if (existsSync(path.join(dir, 'workspace.sqlite'))) dataFolder = true; if (path.dirname(dir) === dir) break; }
    requireThat(!dataFolder, 'BACKUP_FOLDER', '워크스페이스 데이터 폴더 밖의 폴더를 고르세요. 데이터 폴더 안에 두려면 기본 위치를 쓰세요.');
    return folder;
  }
  configure({ every, keep, folder } = {}) {
    if (every !== undefined) { requireThat(every === 'off' || PERIODS[every], 'BACKUP_EVERY', '백업 주기를 고르세요.'); this.config.every = every; }
    if (keep !== undefined) { requireThat(KEEP.includes(keep), 'BACKUP_KEEP', '보관 개수를 고르세요.'); this.config.keep = keep; }
    if (folder !== undefined) {
      this.config.folder = folder === null || folder === '' ? null : this.resolve(folder);
      if (this.config.folder) mkdirSync(this.root(), { recursive: true, mode: 0o700 });
      this.error = null; this.failedAt = 0;
    }
    this.save();
    return this.status();
  }
  // Due when the period has passed since the last backup here and something changed since. A backup dated in the
  // future (a clock that was wrong once) doesn't hold the schedule back.
  due() {
    if (this.closed || this.config.every === 'off') return false;
    if (this.failedAt && Date.now() - this.failedAt < RETRY) return false;
    const latest = this.list()[0];
    if (!latest) return this.workspace.revision > 0;
    const made = Date.parse(latest.completedAt), age = made > Date.now() + 5 * 60_000 ? Infinity : Date.now() - made;
    return age >= PERIODS[this.config.every] - 60_000 && latest.revision !== this.workspace.revision;
  }
  async check() {
    try { if (!this.running && this.due()) await this.run({ auto: true }); }
    catch { /* kept in this.error */ }
  }
  // One backup at a time. A scheduled one asked for while another runs is the same backup; one asked for by hand
  // waits for it and is then made on its own (so it is never pruned as a scheduled one).
  run({ auto = false } = {}) {
    if (this.running) return auto ? this.running : this.running.catch(() => {}).then(() => this.run({ auto }));
    this.running = this.perform(auto).finally(() => { this.running = null; });
    return this.running;
  }
  async perform(auto) {
    try {
      if (this.config.folder && !statSync(this.root(), { throwIfNoEntry: false })?.isDirectory()) throw new WorkspaceError('BACKUP_MISSING', '백업 폴더를 찾을 수 없습니다. 디스크가 연결돼 있는지 확인하거나 폴더를 다시 고르세요.');
      const root = this.root();
      mkdirSync(root, { recursive: true, mode: 0o700 });
      // Left over from a backup that stopped half-way (the app closed): removed.
      for (const name of readdirSync(root)) if (STAMPED.test(name) && lstatSync(path.join(root, name)).isDirectory()) rmSync(path.join(root, name), { recursive: true, force: true });
      const previous = this.list()[0]?.path ?? null;
      const result = await this.workspace.createBackup({ root, auto, previous, workspaceKey: this.config.key });
      if (auto) this.prune();
      this.error = result.damaged?.length ? { code: 'BACKUP_DAMAGED', message: '손상된 첨부 파일 {0}개는 백업하지 못했습니다.', count: result.damaged.length, at: result.completedAt } : null;
      this.failedAt = 0;
      return result;
    } catch (error) {
      this.error = { code: error.code ?? 'BACKUP_FAILED', message: error.message, at: new Date().toISOString() };
      if (auto) this.failedAt = Date.now();
      throw error;
    }
  }
  // Only a scheduled backup of this workspace — its key in the manifest, a real folder directly in its backup
  // folder, named as scheduled backups are — is ever removed, and only past the number kept.
  prune() {
    const root = this.root();
    const scheduled = this.list().filter(item => item.auto && item.mine && SCHEDULED.test(item.name) && path.dirname(item.path) === root);
    for (const old of scheduled.slice(this.config.keep)) if (lstatSync(old.path, { throwIfNoEntry: false })?.isDirectory()) rmSync(old.path, { recursive: true, force: true });
  }
  find(name) {
    const item = this.list().find(entry => entry.name === name);
    requireThat(item, 'BACKUP_NOT_FOUND', '그 백업을 찾을 수 없습니다.');
    return item;
  }
  async verify(name) { const item = this.find(name); await Workspace.verifyBackup(item.path); return { name, ok: true, checkedAt: new Date().toISOString() }; }
  status() {
    let backups = [], listError = null;
    try { backups = this.list(); } catch (error) { listError = { code: error.code ?? 'BACKUP_LIST', message: error.message }; }
    const latest = backups[0] ?? null;
    return {
      every: this.config.every, keep: this.config.keep, folder: this.config.folder, root: this.root(), home: homedir(),
      sameDisk: !this.config.folder, running: !!this.running, error: this.error ?? listError,
      latest, changedSince: latest ? latest.revision !== this.workspace.revision : this.workspace.revision > 0,
      next: latest && this.config.every !== 'off' ? new Date(Date.parse(latest.completedAt) + PERIODS[this.config.every]).toISOString() : null,
      backups: backups.slice(0, 30),
    };
  }
  close() { this.closed = true; clearInterval(this.timer); clearTimeout(this.first); }
}
