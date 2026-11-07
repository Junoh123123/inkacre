// 받은 파일 폴더: a folder on this computer whose new files land in the workspace on their own — a scanner's output,
// screenshots, downloads. A few seconds after a file stops changing it is added to the quick capture page (설정 ›
// 빠른 기록) as an image, video, audio, PDF or file block, in one command per batch (actor "inbox-folder"), and the
// attachment search reads it like any other. Files already there when the folder was chosen are left out, and a file
// is known by what it is on disk (device, inode, size, time), so a rename, a brief disappearance (a share
// reconnecting) or moving it back never brings it in twice. The files themselves are left as they are — or, if
// chosen, moved into an "Imported" folder beside them, only if unchanged since they were read; nothing is deleted.
// The folder is a setting of this computer (inbox.json beside the workspace).
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { inlineImageTypes, requireThat, WorkspaceError } from './contracts.mjs';
import { visible } from './workspace.mjs';

export const MOVED = 'Imported';
const LIMIT = 2 * 1024 ** 3 - 1;
const FORGET_AFTER = 20; // looks in a row a name must be missing before it is forgotten (its identity stays known)
const KNOWN = 5000; // identities remembered
const MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', heic: 'image/heic', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', html: 'text/html', htm: 'text/html', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation', hwpx: 'application/hwp+zip' };
export const mediaTypeOf = name => MEDIA[/\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream';
const blockTypeOf = mediaType => inlineImageTypes.includes(mediaType) ? 'image' : mediaType.startsWith('video/') ? 'video' : mediaType.startsWith('audio/') ? 'audio' : mediaType === 'application/pdf' ? 'pdf' : 'file';
// Not ready or not ours: hidden files, Office lock files, downloads still in progress, system files.
const ignored = name => name.startsWith('.') || name.startsWith('~$') || /\.(crdownload|part|partial|download|tmp|opdownload|icloud)$/i.test(name) || ['Thumbs.db', 'desktop.ini', MOVED].includes(name);
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
const identity = info => `${info.id}:${info.size}:${info.mtime}`;
const same = (a, b) => a && b && a.size === b.size && a.mtime === b.mtime && (!a.id || !b.id || a.id === b.id);

export class InboxFolder {
  constructor(workspace, { interval = 3000, settle = 2000, batch = 50, onChange = null } = {}) {
    this.workspace = workspace; this.settle = settle; this.batch = batch; this.onChange = onChange;
    this.configFile = path.join(workspace.directory, 'inbox.json');
    this.config = { folder: null, after: 'keep', seen: {}, known: {} };
    try { this.config = { ...this.config, ...JSON.parse(readFileSync(this.configFile, 'utf8')) }; } catch { /* off */ }
    this.config.known ??= {};
    this.waiting = new Map(); this.error = null; this.last = null; this.busy = false; this.closed = false;
    this.timer = setInterval(() => { this.poll().catch(() => {}); }, interval); this.timer.unref?.();
  }
  save() { writeFileSync(this.configFile, JSON.stringify(this.config, null, 1), { mode: 0o600 }); }
  // The Markdown mirror's folder, if one is set: the two must never overlap (each would feed the other).
  mirrorFolder() { try { return JSON.parse(readFileSync(path.join(this.workspace.directory, 'mirror.json'), 'utf8')).folder ?? null; } catch { return null; } }
  // Not home or a disk's top; not in or around a Pageyard data folder or a Markdown mirror — judged by real paths, so
  // a link can't lead there.
  check(folder) {
    const real = realPath(folder);
    requireThat(comparable(real) !== comparable(realPath(homedir())) && path.dirname(real) !== real, 'INBOX_FOLDER', '홈 폴더나 디스크 맨 위가 아닌 폴더를 고르세요.');
    const data = realPath(this.workspace.directory), mirror = this.mirrorFolder();
    let refused = inside(real, data) || inside(data, real) || (mirror && (inside(real, realPath(mirror)) || inside(realPath(mirror), real)));
    for (let dir = real; !refused; dir = path.dirname(dir)) { if (existsSync(path.join(dir, 'workspace.sqlite')) || existsSync(path.join(dir, '.pageyard-mirror.json'))) refused = true; if (path.dirname(dir) === dir) break; }
    requireThat(!refused, 'INBOX_FOLDER', '워크스페이스 데이터 폴더나 Markdown 미러 폴더와 겹치지 않는 폴더를 고르세요.');
    return real;
  }
  resolve(input) {
    let folder = String(input ?? '').trim();
    requireThat(folder, 'INBOX_FOLDER', '폴더 경로를 입력하세요.');
    if (folder === '~' || folder.startsWith('~/') || folder.startsWith('~\\')) folder = path.join(homedir(), folder.slice(1));
    requireThat(path.isAbsolute(folder), 'INBOX_FOLDER', '전체 경로를 입력하세요. 예: ~/Documents/Inkacre 받은 파일');
    folder = path.resolve(folder);
    this.check(folder);
    const info = statSync(folder, { throwIfNoEntry: false });
    if (info) requireThat(info.isDirectory(), 'INBOX_FOLDER', '폴더가 아니라 파일입니다.');
    else requireThat(statSync(path.dirname(folder), { throwIfNoEntry: false })?.isDirectory(), 'INBOX_FOLDER', '상위 폴더가 없습니다.');
    return folder;
  }
  // What is there now: the files to watch, by name, with what they are on disk.
  scan(folder) {
    const found = new Map();
    for (const name of readdirSync(folder)) {
      if (ignored(name)) continue;
      const info = lstatSync(path.join(folder, name), { throwIfNoEntry: false });
      if (info?.isFile()) found.set(name, { size: info.size, mtime: Math.round(info.mtimeMs), id: `${info.dev}:${info.ino}` });
    }
    return found;
  }
  remember(name, info) {
    const known = this.config.known;
    delete known[identity(info)]; known[identity(info)] = name;
    const keys = Object.keys(known);
    for (const key of keys.slice(0, Math.max(0, keys.length - KNOWN))) delete known[key];
  }
  configure({ folder, after } = {}) {
    if (after !== undefined) { requireThat(['keep', 'move'].includes(after), 'INBOX_AFTER', '가져온 뒤 파일을 어떻게 할지 고르세요.'); this.config.after = after; }
    if (folder !== undefined) {
      this.waiting.clear(); this.error = null; this.last = null;
      if (folder === null || folder === '') { this.config.folder = null; this.config.seen = {}; this.config.known = {}; }
      else {
        const resolved = this.resolve(folder);
        mkdirSync(resolved, { recursive: true });
        // Files already there are left out: only what arrives from now on comes in.
        this.config.folder = resolved; this.config.seen = {}; this.config.known = {};
        for (const [name, info] of this.scan(resolved)) { this.config.seen[name] = info; this.remember(name, info); }
      }
    }
    this.save();
    return this.status();
  }
  target() {
    return this.workspace.read(state => {
      const id = state.get('workspace-settings')?.capturePageId, page = id ? state.get(id) : null;
      return page?.kind === 'page' && visible(state, page.id) ? { id: page.id, title: page.title } : null;
    });
  }
  // One look at the folder: a file is taken once it has kept its size and time for a moment.
  async poll() {
    const folder = this.config.folder;
    if (this.closed || !folder || this.busy) return this.status();
    this.busy = true;
    try {
      if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new WorkspaceError('INBOX_MISSING', '받은 파일 폴더를 찾을 수 없습니다. 폴더나 디스크가 연결돼 있는지 확인하세요.');
      this.check(folder);
      const now = this.scan(folder), seen = this.config.seen, known = this.config.known, ready = [];
      let changed = false;
      // A name missing for a while is forgotten (what it was stays known, so it isn't taken again if it returns).
      for (const [name, info] of Object.entries(seen)) {
        if (now.has(name)) { if (info.missing) { delete info.missing; changed = true; } continue; }
        info.missing = (info.missing ?? 0) + 1; changed = true;
        if (info.missing > FORGET_AFTER) delete seen[name];
      }
      for (const name of [...this.waiting.keys()]) if (!now.has(name)) this.waiting.delete(name);
      for (const [name, info] of now) {
        if (same(seen[name], info)) continue;
        // Renamed, moved back, or back after a disconnect: already in.
        if (known[identity(info)]) { seen[name] = info; changed = true; continue; }
        const before = this.waiting.get(name);
        if (same(before, info) && (Date.now() - info.mtime >= this.settle || info.mtime > Date.now() + 60_000)) ready.push({ name, ...info });
        else this.waiting.set(name, info);
      }
      if (ready.length) {
        const target = this.target();
        if (!target) throw new WorkspaceError('INBOX_TARGET', '받은 파일을 붙일 페이지가 없습니다. 빠른 기록의 기본 페이지를 정하세요.');
        await this.take(folder, target, ready.slice(0, this.batch));
        changed = true;
      }
      if (changed) this.save();
      this.error = null;
    } catch (error) {
      this.error = { code: error.code ?? 'INBOX_FAILED', message: error.message, at: new Date().toISOString() };
    } finally { this.busy = false; }
    return this.status();
  }
  async take(folder, target, files) {
    const operations = [], taken = [], seen = this.config.seen;
    for (const file of files) {
      const source = path.join(folder, file.name);
      this.waiting.delete(file.name);
      if (file.size > LIMIT) { seen[file.name] = { ...file, skipped: 'size' }; this.remember(file.name, file); continue; }
      const stream = createReadStream(source);
      let blob;
      try { blob = await this.workspace.putBlobStream(stream, { size: file.size, limit: LIMIT }); }
      catch { stream.destroy(); continue; } // still changing: looked at again next time
      const mediaType = mediaTypeOf(file.name), attachmentId = `inbox-${randomUUID()}`;
      operations.push({ type: 'attachment.register', id: attachmentId, name: file.name, mediaType, ...blob },
        { type: 'block.create', id: randomUUID(), parentId: target.id, blockType: blockTypeOf(mediaType), attachmentId });
      taken.push(file);
    }
    if (!operations.length) return;
    this.workspace.execute({ id: `inbox-${randomUUID()}`, actor: 'inbox-folder', expectedRevision: this.workspace.revision, operations });
    this.onChange?.();
    for (const file of taken) {
      seen[file.name] = { size: file.size, mtime: file.mtime, id: file.id };
      this.remember(file.name, file);
      if (this.config.after !== 'move') continue;
      // Moved beside — only if it is still exactly what was read (a file replaced or still growing stays, and comes in
      // again as what it is now).
      try {
        const from = path.join(folder, file.name), info = lstatSync(from, { throwIfNoEntry: false });
        if (!info?.isFile() || !same({ size: info.size, mtime: Math.round(info.mtimeMs), id: `${info.dev}:${info.ino}` }, file)) continue;
        const dir = path.join(folder, MOVED); mkdirSync(dir, { recursive: true });
        const dot = file.name.lastIndexOf('.'), stem = dot > 0 ? file.name.slice(0, dot) : file.name, ext = dot > 0 ? file.name.slice(dot) : '';
        let destination = path.join(dir, file.name);
        for (let n = 2; existsSync(destination); n++) destination = path.join(dir, `${stem} ${n}${ext}`);
        renameSync(from, destination);
        delete seen[file.name];
      } catch { /* left in place */ }
    }
    this.last = { at: new Date().toISOString(), count: taken.length, names: taken.map(file => file.name).slice(0, 10), pageId: target.id };
  }
  status() {
    return { folder: this.config.folder, after: this.config.after, home: homedir(), target: this.config.folder ? this.target() : null, waiting: this.waiting.size,
      skipped: Object.entries(this.config.seen).filter(([, info]) => info.skipped).map(([name]) => name).slice(0, 20), last: this.last, error: this.error };
  }
  close() { this.closed = true; clearInterval(this.timer); }
}
