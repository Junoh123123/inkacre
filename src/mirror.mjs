// Markdown 폴더 미러: the whole workspace kept as Markdown and CSV files (with its attachments) in a folder on this
// computer, a few seconds after each change — for Obsidian, an editor, Spotlight, git or a backup tool. One way only:
// the app writes the folder, it never reads it back. It writes only files it made (listed in .pageyard-mirror.json),
// never overwrites or deletes a file whose content changed outside since it wrote it (those are listed instead), never
// follows a link out of the folder, and works only in an empty folder or one it already mirrors — checked again on
// every pass, so a missing drive or a folder someone filled is left alone. One file that can't be written is listed
// and skipped; the rest still goes. The folder is a setting of this computer (mirror.json beside the workspace), not
// part of the workspace's data or history.
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { children, visible } from './workspace.mjs';
import { WorkspaceError, requireThat } from './contracts.mjs';
import { exportTree } from './export-tree.mjs';
import { markdownPage } from './exchange.mjs';
import { pageHtml } from './html-content.mjs';

export const MANIFEST = '.pageyard-mirror.json';
const SCRATCH = '.pageyard-tmp';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const fileHash = file => sha256(readFileSync(file));
const lstat = file => { try { return lstatSync(file); } catch { return null; } };
const inode = info => `${info.dev}:${info.ino}`;
const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
const comparable = value => { const normal = path.resolve(value).normalize('NFC'); return caseInsensitive ? normal.toLowerCase() : normal; };
const inside = (child, parent) => { const a = comparable(child), b = comparable(parent); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
// The real path of a folder that may not exist yet: its nearest existing ancestor resolved, the rest appended.
function realPath(folder) {
  const rest = [];
  for (let current = path.resolve(folder); ; current = path.dirname(current)) {
    try { return path.join(realpathSync(current), ...rest.reverse()); }
    catch { if (path.dirname(current) === current) return path.resolve(folder); rest.push(path.basename(current)); }
  }
}
const visibleEntries = folder => readdirSync(folder).filter(name => name !== '.DS_Store' && name !== SCRATCH && name !== 'Thumbs.db' && name !== 'desktop.ini');

export class MarkdownMirror {
  constructor(workspace, { delay = 2500 } = {}) {
    this.workspace = workspace; this.delay = delay;
    this.configFile = path.join(workspace.directory, 'mirror.json');
    this.folder = null; this.key = null; this.last = null; this.error = null; this.running = false; this.timer = null; this.pending = false; this.closed = false;
    try { const config = JSON.parse(readFileSync(this.configFile, 'utf8')); this.folder = config.folder ?? null; this.key = config.key ?? null; } catch { /* not set */ }
    this.stopListening = workspace.onCommit(() => this.schedule());
    if (this.folder) this.schedule(0);
  }
  // The folder as typed (~ is the home folder): absolute; not the home folder or a disk's top; not inside any Pageyard
  // data folder nor holding this one; and either new (its parent exists), empty, or already this workspace's mirror.
  resolve(input) {
    let folder = String(input ?? '').trim();
    requireThat(folder, 'MIRROR_FOLDER', '폴더 경로를 입력하세요.');
    if (folder === '~' || folder.startsWith('~/') || folder.startsWith('~\\')) folder = path.join(homedir(), folder.slice(1));
    requireThat(path.isAbsolute(folder), 'MIRROR_FOLDER', '전체 경로를 입력하세요. 예: ~/Documents/Inkacre');
    folder = path.resolve(folder);
    const real = realPath(folder), data = realPath(this.workspace.directory);
    requireThat(comparable(real) !== comparable(realPath(homedir())) && path.dirname(real) !== real, 'MIRROR_FOLDER', '홈 폴더나 디스크 맨 위가 아닌, 미러 전용 폴더를 고르세요.');
    let dataFolder = inside(real, data) || inside(data, real);
    for (let dir = real; !dataFolder; dir = path.dirname(dir)) { if (existsSync(path.join(dir, 'workspace.sqlite'))) dataFolder = true; if (path.dirname(dir) === dir) break; }
    requireThat(!dataFolder, 'MIRROR_FOLDER', '워크스페이스 데이터 폴더와 겹치지 않는 폴더를 고르세요.');
    requireThat(!this.overlapsInbox(real), 'MIRROR_FOLDER', '받은 파일 폴더와 겹치지 않는 폴더를 고르세요.');
    const info = lstat(folder);
    if (!info) { requireThat(lstat(path.dirname(folder))?.isDirectory() || existsSync(path.dirname(folder)), 'MIRROR_FOLDER', '상위 폴더가 없습니다.'); return folder; }
    requireThat(statSync(folder).isDirectory(), 'MIRROR_FOLDER', '폴더가 아니라 파일입니다.');
    const manifest = this.readManifest(folder);
    if (manifest) requireThat(manifest.workspace === this.key, 'MIRROR_FOLDER', '다른 워크스페이스가 미러하는 폴더입니다.');
    else requireThat(visibleEntries(folder).length === 0, 'MIRROR_FOLDER', '비어 있지 않은 폴더입니다. 빈 폴더나 새 폴더 경로를 고르세요.');
    return folder;
  }
  // The inbox folder, if one is set: the two must never overlap (the mirror's files would come back in as attachments).
  overlapsInbox(folder) {
    let inbox = null;
    try { inbox = JSON.parse(readFileSync(path.join(this.workspace.directory, 'inbox.json'), 'utf8')).folder ?? null; } catch { /* none */ }
    return !!inbox && (inside(realPath(folder), realPath(inbox)) || inside(realPath(inbox), realPath(folder)));
  }
  configure(input) {
    if (input == null || input === '') { this.folder = null; clearTimeout(this.timer); this.pending = false; this.last = null; this.error = null; this.save(); return this.status(); }
    this.key ??= randomUUID();
    const folder = this.resolve(input);
    mkdirSync(folder, { recursive: true });
    this.folder = folder; this.error = null; this.last = null; this.save();
    this.sync();
    return this.status();
  }
  save() { writeFileSync(this.configFile, JSON.stringify({ folder: this.folder, key: this.key }, null, 2), { mode: 0o600 }); }
  schedule(delay = this.delay) {
    if (this.closed || !this.folder) return;
    clearTimeout(this.timer);
    this.pending = true;
    this.timer = setTimeout(() => this.sync(), delay);
    this.timer.unref?.();
  }
  readManifest(folder = this.folder) {
    try { const manifest = JSON.parse(readFileSync(path.join(folder, MANIFEST), 'utf8')); return manifest?.app === 'Pageyard' ? manifest : null; } catch { return null; }
  }
  // One pass: write what changed, remove what is gone, leave alone what was changed outside or can't be written.
  sync() {
    if (this.closed || !this.folder || this.running) return this.status();
    this.running = true; this.pending = false; clearTimeout(this.timer);
    const folder = this.folder, started = Date.now();
    try {
      // The folder is checked again each time: gone (an unplugged drive), filled by someone, or taken by another.
      if (!lstat(folder)?.isDirectory() && !(existsSync(folder) && statSync(folder).isDirectory())) throw new WorkspaceError('MIRROR_MISSING', '미러 폴더를 찾을 수 없습니다. 폴더나 드라이브가 연결돼 있는지 확인하세요.');
      const root = realpathSync(folder), previous = this.readManifest(root);
      if (this.overlapsInbox(root)) throw new WorkspaceError('MIRROR_FOLDER', '받은 파일 폴더와 겹치지 않는 폴더를 고르세요.');
      if (previous) { if (previous.workspace !== this.key) throw new WorkspaceError('MIRROR_FOLDER', '다른 워크스페이스가 미러하는 폴더입니다.'); }
      else if (visibleEntries(root).length) throw new WorkspaceError('MIRROR_FOLDER', '비어 있지 않은 폴더입니다. 빈 폴더나 새 폴더 경로를 고르세요.');
      // Our own scratch folder for writing files before they take their place (left over from a crash: emptied).
      const scratch = path.join(root, SCRATCH);
      if (lstat(scratch)?.isSymbolicLink()) unlinkSync(scratch);
      mkdirSync(scratch, { recursive: true });
      for (const name of readdirSync(scratch)) { try { unlinkSync(path.join(scratch, name)); } catch { /* in use */ } }
      const { entries } = this.workspace.read(state => {
        const rootIds = children(state, null).filter(item => item.kind === 'page' && !item.template && !item.sourceId && visible(state, item.id)).map(item => item.id);
        return exportTree({ workspace: this.workspace, state, rootIds, format: 'markdown', files: true, subpages: true, folders: true, markdownPage, pageHtml, name: 'workspace', collect: true });
      });
      const known = previous?.files ?? {}, next = {}, changedOutside = [], failed = [], ours = new Set();
      let written = 0, removed = 0, knownInodes = null;
      // A path inside the folder that crosses no link and no file on its way.
      const target = relative => {
        const parts = relative.split('/');
        if (parts.some(part => !part || part === '.' || part === '..')) throw new WorkspaceError('MIRROR_PATH', '폴더 밖 경로입니다.');
        let dir = root;
        for (const part of parts.slice(0, -1)) {
          dir = path.join(dir, part);
          const info = lstat(dir);
          if (!info) break;
          if (!info.isDirectory()) throw new WorkspaceError('MIRROR_PATH', '폴더 안의 링크나 파일이 길을 막고 있습니다.');
        }
        return path.join(root, ...parts);
      };
      // The file of one of our earlier paths (the same file under another case or Unicode form on macOS and Windows).
      const earlier = info => {
        if (!knownInodes) {
          knownInodes = new Map();
          for (const relative of Object.keys(known)) { try { const found = lstat(target(relative)); if (found?.isFile()) knownInodes.set(inode(found), relative); } catch { /* not ours any more */ } }
        }
        return knownInodes.get(inode(info));
      };
      for (const [relative, value] of entries) {
        if (relative === MANIFEST || relative.split('/')[0] === SCRATCH) continue;
        const record = known[relative];
        try {
          const file = target(relative), text = typeof value === 'string';
          const hash = text ? sha256(value) : value.sha256, info = lstat(file);
          if (info && !info.isFile()) { changedOutside.push(relative); if (record) next[relative] = record; continue; }
          // Unchanged since we wrote it and still what it should be: nothing to do.
          if (info && record && record.hash === hash && info.size === record.size && Math.round(info.mtimeMs) === record.mtime) { next[relative] = record; ours.add(inode(info)); continue; }
          if (info) {
            const current = fileHash(file);
            if (current === hash) { next[relative] = { hash, size: info.size, mtime: Math.round(info.mtimeMs) }; ours.add(inode(info)); continue; }
            const before = record ?? known[earlier(info)];
            // Someone else's file, or ours with content changed since: kept as it is.
            if (!before || before.hash !== current) { changedOutside.push(relative); if (record) next[relative] = record; continue; }
          }
          let source = null;
          if (!text) { source = path.join(this.workspace.blobDirectory, value.sha256); if (!existsSync(source)) throw new WorkspaceError('MIRROR_BLOB', '첨부 파일 원본이 없습니다.'); }
          mkdirSync(path.dirname(file), { recursive: true });
          const temporary = path.join(scratch, `${randomUUID()}.tmp`);
          try {
            if (text) writeFileSync(temporary, value); else copyFileSync(source, temporary);
            renameSync(temporary, file);
          } catch (error) { try { unlinkSync(temporary); } catch { /* not made */ } throw error; }
          const after = lstatSync(file);
          next[relative] = { hash, size: after.size, mtime: Math.round(after.mtimeMs) };
          ours.add(inode(after));
          written++;
        } catch (error) {
          failed.push({ path: relative, message: error.code === 'ENAMETOOLONG' ? '이름이 너무 깁니다.' : error.message });
          if (record) next[relative] = record;
        }
      }
      // Gone from the workspace: our files whose content is as we wrote it are removed (and folders left empty);
      // changed ones stay, and so does a file we just wrote under another case of the same name.
      const emptied = new Set();
      for (const [relative, record] of Object.entries(known)) {
        if (entries.has(relative) || next[relative]) continue;
        try {
          const file = target(relative), info = lstat(file);
          if (!info || !info.isFile() || ours.has(inode(info))) continue;
          if (fileHash(file) !== record.hash) { changedOutside.push(relative); continue; }
          unlinkSync(file); removed++;
          for (let dir = path.dirname(file); dir.startsWith(root + path.sep); dir = path.dirname(dir)) emptied.add(dir);
        } catch (error) { failed.push({ path: relative, message: error.message }); next[relative] = record; }
      }
      for (const dir of [...emptied].sort((a, b) => b.length - a.length)) { try { if (!lstatSync(dir).isSymbolicLink() && !readdirSync(dir).length) rmdirSync(dir); } catch { /* not empty */ } }
      // The list of our files is written every time, whatever failed above.
      const manifest = { app: 'Pageyard', version: 1, workspace: this.key, note: 'Inkacre writes this folder. Edit pages in the app; files changed here are left alone.', files: next };
      const temporary = path.join(scratch, `${randomUUID()}.json`);
      writeFileSync(temporary, JSON.stringify(manifest, null, 1));
      renameSync(temporary, path.join(root, MANIFEST));
      try { rmdirSync(scratch); } catch { /* another pass is writing */ }
      this.last = { at: new Date().toISOString(), ms: Date.now() - started, files: Object.keys(next).length, written, removed,
        changedOutside: changedOutside.sort().slice(0, 50), changedOutsideCount: changedOutside.length, failed: failed.slice(0, 50), failedCount: failed.length };
      this.error = null;
    } catch (error) {
      this.error = { code: error.code ?? 'MIRROR_FAILED', message: error.message };
    } finally { this.running = false; }
    return this.status();
  }
  status() { return { folder: this.folder, home: homedir(), last: this.last, error: this.error }; }
  // A change still waiting is written before closing.
  close() {
    if (this.closed) return;
    if (this.pending) { try { this.sync(); } catch { /* best effort */ } }
    this.closed = true; clearTimeout(this.timer); this.stopListening();
  }
}
