// PDF 내보내기 (with "Include subpages" a ZIP holding one PDF per page and folders of the
// pages' images and files). The pages are printed by a Chromium-based browser already on this computer (Chrome, Edge,
// Chromium, Brave, Vivaldi), started headless with an empty profile of its own and no way out to the network (a
// dead proxy; this app on the loopback address stays reachable): the print window's layout, saved without a dialog.
// Without such a browser the interface keeps the print window. PAGEYARD_BROWSER names a browser to use instead.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import { children, visible } from './workspace.mjs';
import { fileStem, uniquePath } from './export-tree.mjs';
import { requireThat } from './contracts.mjs';

export function findBrowser(env = process.env, platform = process.platform) {
  if (env.PAGEYARD_BROWSER) return existsSync(env.PAGEYARD_BROWSER) ? env.PAGEYARD_BROWSER : null;
  const candidates = [];
  if (platform === 'darwin') {
    const apps = ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser', 'Vivaldi', 'Google Chrome Canary'];
    for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) for (const app of apps) candidates.push(path.join(root, `${app}.app`, 'Contents', 'MacOS', app));
  } else if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) candidates.push(
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(root, 'Chromium', 'Application', 'chrome.exe'), path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(root, 'Vivaldi', 'Application', 'vivaldi.exe'));
  } else {
    for (const directory of String(env.PATH ?? '').split(path.delimiter).filter(Boolean)) for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'vivaldi']) candidates.push(path.join(directory, name));
  }
  return candidates.find(file => existsSync(file)) ?? null;
}

// The pages to print, depth first as the sidebar lists them: the page, its subpages, and the rows of the databases on
// them (in a folder of the database's name). Each page's own pictures and files (blocks, cover, files properties) go
// in a folder of the page's name beside its PDF, where its subpages are too.
export function planPdfExport(state, { id, subpages = false, files = true }) {
  const root = state.get(id);
  requireThat(root?.kind === 'page' && visible(state, id), 'EXPORT_TARGET', '페이지를 선택하세요.');
  const taken = new Set(), pages = [];
  const assetsOf = page => {
    const found = [];
    const add = ref => { const file = state.get(ref); if (file?.kind === 'attachment' && file.alive !== false && !found.includes(ref)) found.push(ref); };
    if (page.coverAttachmentId) add(page.coverAttachmentId);
    for (const [key, value] of Object.entries(page.values ?? {})) if (state.get(key)?.type === 'files') for (const ref of value ?? []) add(ref);
    const walk = parentId => { for (const child of children(state, parentId)) if (child.kind === 'block' && visible(state, child.id)) { if (child.attachmentId) add(child.attachmentId); walk(child.id); } };
    walk(page.id);
    return found;
  };
  const visit = (page, folder) => {
    const file = uniquePath(taken, folder, fileStem(page.title, 'Untitled'), 'pdf');
    const inner = `${file.slice(0, -4)}/`;
    pages.push({ id: page.id, path: file, assets: files && subpages ? assetsOf(page).map(ref => ({ id: ref, folder: inner })) : [] });
    if (!subpages) return;
    for (const child of children(state, page.id)) {
      if (!visible(state, child.id)) continue;
      if (child.kind === 'page' && !child.template) visit(child, inner);
      if (child.kind === 'source') {
        const rows = [...state.values()].filter(row => row.kind === 'page' && row.sourceId === child.id && !row.template && visible(state, row.id)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const databaseFolder = `${inner}${fileStem(child.name, 'Database')}/`;
        for (const row of rows) visit(row, databaseFolder);
      }
    }
  };
  visit(root, '');
  requireThat(pages.length <= 2000, 'EXPORT_LIMIT', '한 번에 PDF로 내보낼 수 있는 페이지는 2,000개까지입니다. 나눠서 내보내세요.');
  return { title: root.title, pages, zip: !!subpages, files: files !== false };
}

// A browser spoken to over its DevTools pipe (fd 3 in, fd 4 out, messages ending in NUL).
class Headless {
  constructor(executable) {
    this.profile = mkdtempSync(path.join(os.tmpdir(), 'pageyard-pdf-'));
    const args = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
      '--disable-gpu', '--mute-audio', '--hide-scrollbars', '--proxy-server=127.0.0.1:9', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'];
    this.child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.seq = 0; this.pending = new Map(); this.buffer = '';
    this.child.stdio[4].on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
        const waiting = message.id && this.pending.get(message.id);
        if (!waiting) continue;
        this.pending.delete(message.id);
        if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`)); else waiting.resolve(message.result);
      }
    });
    const fail = error => { for (const waiting of this.pending.values()) waiting.reject(error); this.pending.clear(); this.closed = true; };
    this.child.on('error', fail);
    this.child.on('exit', () => fail(new Error('The browser closed')));
    this.child.stdio[3].on('error', () => undefined);
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('The browser closed'));
    const id = ++this.seq;
    this.child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  async evaluate(sessionId, expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result?.value;
  }
  async open(url) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Page.navigate', { url }, sessionId);
    return sessionId;
  }
  close() {
    try { this.child.kill(); } catch { /* gone */ }
    setTimeout(() => { try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* still in use */ } }, 1500).unref?.();
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Prints the plan's pages one after another in one tab of the print document (it switches pages in place, so the app
// and the workspace load once). prefs: the interface's language and settings, so the pages read as they do there.
export async function printPdfs({ workspace, plan, baseUrl, browser, size = 'A4', scale = 100, prefs = {}, onProgress = () => undefined, cancelled = () => false, timeoutMs = 90000 }) {
  const headless = new Headless(browser);
  try {
    const sessionId = await headless.open(`${baseUrl}/api/health`);
    for (let tries = 0; tries < 100 && (await headless.evaluate(sessionId, 'location.pathname')) !== '/api/health'; tries++) await wait(100);
    const allowed = Object.fromEntries(Object.entries(prefs ?? {}).filter(([key, value]) => /^pageyard-[a-z0-9-]+$/.test(key) && typeof value === 'string' && value.length <= 20000));
    await headless.evaluate(sessionId, `(() => { const prefs = ${JSON.stringify(allowed)}; for (const [key, value] of Object.entries(prefs)) localStorage.setItem(key, value); })()`);
    const params = new URLSearchParams({ print: plan.pages[0].id, sub: '0', files: plan.files === false ? '0' : '1', size, scale: String(Math.round(scale)), noprint: '1' });
    await headless.send('Page.navigate', { url: `${baseUrl}/?${params}` }, sessionId);
    const outputs = [];
    onProgress(0, plan.pages.length);
    for (let index = 0; index < plan.pages.length; index++) {
      requireThat(!cancelled(), 'EXPORT_CANCELLED', 'PDF 내보내기를 취소했습니다.');
      const page = plan.pages[index];
      if (index > 0) await headless.evaluate(sessionId, `window.pageyardPrintPage?.(${JSON.stringify(page.id)})`);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = await headless.evaluate(sessionId, `(() => { const doc = document.querySelector('[data-print-state]'); return doc ? doc.dataset.printState + '|' + (doc.dataset.pageId || '') : ''; })()`).catch(() => '');
        if (status === `ready|${page.id}`) break;
        requireThat(status !== `missing|${page.id}`, 'EXPORT_TARGET', '이 페이지를 찾을 수 없습니다');
        requireThat(Date.now() < deadline && !cancelled(), cancelled() ? 'EXPORT_CANCELLED' : 'PDF_TIMEOUT', cancelled() ? 'PDF 내보내기를 취소했습니다.' : 'PDF를 만드는 데 시간이 너무 오래 걸립니다.');
        await wait(150);
      }
      const { data } = await headless.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, sessionId);
      outputs.push([page.path, new Uint8Array(Buffer.from(data, 'base64'))]);
      onProgress(index + 1, plan.pages.length);
    }
    if (!plan.zip) return { filename: outputs[0][0], mediaType: 'application/pdf', bytes: Buffer.from(outputs[0][1]) };
    const entries = {}, taken = new Set(outputs.map(([file]) => file.toLowerCase()));
    for (const [file, bytes] of outputs) entries[file] = [bytes, { level: 0 }];
    for (const page of plan.pages) for (const asset of page.assets) {
      let entity, bytes;
      try { ({ entity, bytes } = workspace.attachmentBytes(asset.id)); } catch { continue; }
      const dot = entity.name?.lastIndexOf('.') ?? -1;
      const file = uniquePath(taken, asset.folder, fileStem(dot > 0 ? entity.name.slice(0, dot) : entity.name, 'file'), dot > 0 ? entity.name.slice(dot + 1).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '') || 'bin' : 'bin');
      entries[file] = [new Uint8Array(bytes), { level: /^(image\/(png|jpe?g|gif|webp)|video|audio|application\/(pdf|zip))/.test(entity.mediaType ?? '') ? 0 : 6 }];
    }
    return { filename: `${fileStem(plan.title, 'Export')}.zip`, mediaType: 'application/zip', bytes: Buffer.from(zipSync(entries)) };
  } finally {
    headless.close();
  }
}

// Running exports, read by the export window (progress) and fetched once done. Kept for ten minutes.
export class PdfJobs {
  constructor() { this.jobs = new Map(); }
  start(run) {
    const id = randomUUID(), job = { id, status: 'running', done: 0, total: 0, cancelled: false, startedAt: Date.now() };
    this.jobs.set(id, job);
    run({ progress: (done, total) => { job.done = done; job.total = total; }, cancelled: () => job.cancelled })
      .then(result => { job.status = 'done'; job.result = result; })
      .catch(error => { job.status = job.cancelled ? 'cancelled' : 'failed'; job.error = { code: error.code ?? 'PDF_FAILED', message: error.code ? error.message : 'PDF를 만들지 못했습니다.', ...(error.code ? {} : { detail: String(error.message ?? error).slice(0, 300) }) }; })
      .finally(() => setTimeout(() => this.jobs.delete(id), 10 * 60 * 1000).unref?.());
    return job;
  }
  get(id) { const job = this.jobs.get(id); requireThat(job, 'NOT_FOUND', '내보내기 작업을 찾을 수 없습니다.'); return job; }
  view(job) { return { id: job.id, status: job.status, done: job.done, total: job.total, ...(job.result ? { filename: job.result.filename, bytes: job.result.bytes.length } : {}), ...(job.error ? { error: job.error } : {}) }; }
  cancel(id) { const job = this.get(id); job.cancelled = true; return job; }
}
