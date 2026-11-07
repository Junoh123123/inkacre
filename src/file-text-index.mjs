// 첨부 파일 내용 검색's index: the text of each attached file by its content (sha256), kept in file-text.sqlite beside
// the workspace — derived data, safe to delete (it is read again). New attachments are read shortly after they
// arrive, one at a time in a worker thread, so the server never waits on a large PDF. Search reads it from memory.
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { EXTRACTOR_VERSION, sizeLimit, textKind } from './file-text.mjs';

export class FileTextIndex {
  constructor(workspace, { timeout = 120000, delay = 1500 } = {}) {
    this.workspace = workspace; this.timeout = timeout; this.delay = delay;
    this.db = new DatabaseSync(path.join(workspace.directory, 'file-text.sqlite'), { timeout: 10000 });
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS file_text(sha256 TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL, text TEXT, error TEXT, updated_at TEXT NOT NULL) STRICT;`);
    this.stopListening = workspace.onCommit(changes => { if (changes.some(change => (change.after ?? change.before).kind === 'attachment')) this.schedule(); });
    this.texts = null; this.queue = []; this.queued = new Set(); this.worker = null; this.current = null; this.timer = null; this.deadline = null; this.waiting = []; this.closed = false;
  }
  // Search's view: { text, folded } for a file that has text.
  lookup(sha256) {
    if (!this.texts) {
      this.texts = new Map();
      for (const row of this.db.prepare("SELECT sha256, text FROM file_text WHERE status='ok' AND text<>''").iterate()) this.texts.set(row.sha256, { text: row.text, folded: null });
    }
    const entry = this.texts.get(sha256);
    if (entry) entry.folded ??= entry.text.toLocaleLowerCase();
    return entry;
  }
  attachments() {
    return this.workspace.read(state => [...state.values()].filter(item => item.kind === 'attachment' && item.alive !== false && !item.purged).map(item => ({ sha256: item.sha256, name: item.name, mediaType: item.mediaType, bytes: item.bytes })));
  }
  // Look for files not read yet (or read by an older reader), a moment after a change.
  schedule(delay = this.delay) {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { try { this.sync(); } catch { /* the next change tries again */ } }, delay);
    this.timer.unref?.();
  }
  sync() {
    if (this.closed) return;
    const known = new Map(this.db.prepare('SELECT sha256, status, version FROM file_text').all().map(row => [row.sha256, row]));
    const seen = new Set();
    for (const file of this.attachments()) {
      if (seen.has(file.sha256)) continue;
      const row = known.get(file.sha256), blob = path.join(this.workspace.blobDirectory, file.sha256);
      // Read already (by this reader) — or it was being read when the app stopped, which a second try won't change;
      // a file whose content was missing is tried again once it is there.
      if (row?.version === EXTRACTOR_VERSION && !(row.status === 'missing' && existsSync(blob))) { seen.add(file.sha256); continue; }
      const kind = textKind(file.name, file.mediaType);
      if (!kind) continue;
      seen.add(file.sha256);
      if (this.queued.has(file.sha256) || this.current?.sha256 === file.sha256) continue;
      if (Number(file.bytes) > sizeLimit(kind)) { this.record(file.sha256, { status: 'unsupported', error: 'size' }); continue; }
      this.queued.add(file.sha256);
      this.queue.push({ sha256: file.sha256, name: file.name, mediaType: file.mediaType, file: blob });
    }
    this.pump();
  }
  record(sha256, result) {
    const text = result.status === 'ok' ? String(result.text ?? '').normalize('NFKC') : null;
    this.db.prepare('INSERT INTO file_text VALUES (?,?,?,?,?,?) ON CONFLICT(sha256) DO UPDATE SET status=excluded.status, version=excluded.version, text=excluded.text, error=excluded.error, updated_at=excluded.updated_at')
      .run(sha256, result.status, EXTRACTOR_VERSION, text, result.error ?? null, new Date().toISOString());
    if (this.texts) { if (text) this.texts.set(sha256, { text, folded: null }); else this.texts.delete(sha256); }
  }
  spawn() {
    // Its own heap limit: a file that needs more stops the reader, not the app.
    const worker = new Worker(new URL('./file-text-worker.mjs', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 768 } });
    worker.unref();
    worker.on('message', result => { if (worker === this.worker && this.current?.sha256 === result.sha256) this.finish(result); });
    worker.on('error', error => { if (worker === this.worker) { this.worker = null; if (this.current) this.finish({ sha256: this.current.sha256, status: 'failed', error: String(error?.message ?? error).slice(0, 200) }); } });
    worker.on('exit', () => { if (worker === this.worker) { this.worker = null; if (this.current) this.finish({ sha256: this.current.sha256, status: 'failed', error: 'reader stopped' }); } });
    return worker;
  }
  pump() {
    if (this.closed || this.current) return;
    const job = this.queue.shift();
    if (!job) { for (const resolve of this.waiting.splice(0)) resolve(); return; }
    this.queued.delete(job.sha256);
    this.current = job;
    // Marked first: if reading this file brings the whole app down, it isn't read again on the next start.
    try { this.record(job.sha256, { status: 'reading' }); } catch { /* closed */ }
    this.worker ??= this.spawn();
    this.deadline = setTimeout(() => {
      // A file that takes too long is left unread; a new reader takes the next one.
      const worker = this.worker; this.worker = null; worker?.terminate();
      this.finish({ sha256: job.sha256, status: 'failed', error: 'timeout' });
    }, this.timeout);
    this.deadline.unref?.();
    this.worker.postMessage(job);
  }
  finish(result) {
    clearTimeout(this.deadline);
    const job = this.current; this.current = null;
    if (!this.closed && job) { try { this.record(job.sha256, result); } catch { /* closed meanwhile */ } }
    this.pump();
  }
  // For tests and the status line: resolves when nothing is waiting to be read.
  idle() { return !this.current && !this.queue.length ? Promise.resolve() : new Promise(resolve => this.waiting.push(resolve)); }
  status() {
    const rows = new Map(this.db.prepare('SELECT sha256, status, version FROM file_text').all().map(row => [row.sha256, row]));
    const counts = { files: 0, readable: 0, indexed: 0, pending: 0, failed: 0, encrypted: 0, unsupported: 0 }, seen = new Set();
    for (const file of this.attachments()) {
      if (seen.has(file.sha256)) continue;
      seen.add(file.sha256); counts.files++;
      if (!textKind(file.name, file.mediaType)) { counts.unsupported++; continue; }
      counts.readable++;
      const row = rows.get(file.sha256);
      if (!row || row.version !== EXTRACTOR_VERSION || this.queued.has(file.sha256) || this.current?.sha256 === file.sha256) counts.pending++;
      else if (row.status === 'ok') counts.indexed++;
      else if (row.status === 'encrypted') counts.encrypted++;
      else if (row.status === 'unsupported') counts.unsupported++;
      else counts.failed++;
    }
    return { ...counts, reading: !!this.current };
  }
  close() {
    this.closed = true;
    this.stopListening();
    clearTimeout(this.timer); clearTimeout(this.deadline);
    this.worker?.terminate(); this.worker = null;
    for (const resolve of this.waiting.splice(0)) resolve();
    try { this.db.close(); } catch { /* already closed */ }
  }
}
