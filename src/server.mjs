import {DeliveryWorker} from './delivery.mjs';
import {PublicContent} from './public-content.mjs';
import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, createReadStream, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Workspace } from './workspace.mjs';
import { WorkspaceRegistry } from './workspaces.mjs';
import { findBrowser, planPdfExport, printPdfs, PdfJobs } from './pdf-export.mjs';
import { ArchiveImports } from './archive-import.mjs';
import { querySource, searchWorkspace, listTasks } from './query.mjs';
import { APP, instanceId } from './app-info.mjs';
import { MarkdownMirror } from './mirror.mjs';
import { BackupManager } from './backups.mjs';
import { InboxFolder } from './inbox-folder.mjs';
import { WorkspaceError, operationSchema, attachmentReferenceSchema, requireThat, inlineImageTypes, iconImageTypes, searchSchema, tasksSchema, formulaPreviewSchema } from './contracts.mjs';

const webDirectory = fileURLToPath(new URL('../web/', import.meta.url));
// Library files are found wherever npm put the package (nested in this folder, or hoisted beside it by npx/npm -g).
const require = createRequire(import.meta.url);
function packageRoot(name) {
  try { return path.dirname(require.resolve(`${name}/package.json`)); } catch {}
  let directory = path.dirname(require.resolve(name));
  while (!existsSync(path.join(directory, 'package.json')) && path.dirname(directory) !== directory) directory = path.dirname(directory);
  return directory;
}
const highlightRoot = packageRoot('highlight.js'), katexRoot = packageRoot('katex');
const staticFiles = { '/map-layout.mjs':['map-layout.mjs','text/javascript; charset=utf-8'], '/code-highlight.mjs':['code-highlight.mjs','text/javascript; charset=utf-8'],'/highlight.css':[path.join(highlightRoot,'styles/github.min.css'),'text/css; charset=utf-8'], '/paste-blocks.mjs':['paste-blocks.mjs','text/javascript; charset=utf-8'], '/katex.mjs':[path.join(katexRoot,'dist/katex.mjs'),'text/javascript; charset=utf-8'],'/katex.min.css':[path.join(katexRoot,'dist/katex.min.css'),'text/css; charset=utf-8'], '/katex-contrib/mhchem.mjs':[path.join(katexRoot,'dist/contrib/mhchem.mjs'),'text/javascript; charset=utf-8'], '/vendor/mermaid.min.js':['vendor/mermaid.min.js','text/javascript; charset=utf-8'], '/vendor/mammoth.browser.min.js':['vendor/mammoth.browser.min.js','text/javascript; charset=utf-8'], '/vendor/pdf.min.mjs':['vendor/pdf.min.mjs','text/javascript; charset=utf-8'], '/vendor/pdf.worker.min.mjs':['vendor/pdf.worker.min.mjs','text/javascript; charset=utf-8'], '/mermaid-frame.mjs':['mermaid-frame.mjs','text/javascript; charset=utf-8'], '/table-grid.mjs':['table-grid.mjs','text/javascript; charset=utf-8'], '/': ['app/index.html', 'text/html; charset=utf-8'], '/classic': ['index.html', 'text/html; charset=utf-8'], '/app/app.js': ['app/app.js', 'text/javascript; charset=utf-8'], '/app/app.css': ['app/app.css', 'text/css; charset=utf-8'], '/app/world-50m.json': ['app/world-50m.json', 'application/json; charset=utf-8'], '/app/favicon.svg': ['app/favicon.svg', 'image/svg+xml'], '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'], '/rich-text.mjs': ['rich-text.mjs', 'text/javascript; charset=utf-8'], '/view-layout.mjs': ['view-layout.mjs', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/sw.mjs': ['sw.mjs', 'text/javascript; charset=utf-8'] };
async function jsonBody(request) {
  requireThat(request.headers['content-type']?.split(';')[0] === 'application/json', 'CONTENT_TYPE', 'application/json 요청이 필요합니다.');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length; requireThat(size <= 24 * 1024 * 1024, 'PAYLOAD_TOO_LARGE', '요청 크기 제한을 넘었습니다.'); chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new WorkspaceError('INVALID_JSON', 'JSON 형식을 확인하세요.'); }
}
// quit: set when the app was opened as the downloadable app (bin/cli.mjs `app`); the menu then offers to quit it.
export function createLocalServer(workspace, { registry = null, id = 'main', launch = null, fileIndex = false, mirror: mirrorOn = false, backups: backupsOn = false, inbox: inboxOn = false, quit = null } = {}) {
  const instance = instanceId(workspace.directory);
  if (fileIndex) workspace.startFileIndex();
  // Markdown 폴더 미러 (src/mirror.mjs): kept by the server that holds this workspace.
  const mirror = mirrorOn ? new MarkdownMirror(workspace) : null;
  // 자동 백업 (src/backups.mjs): on a schedule, into the chosen folder; also where 백업 만들기 puts its backups.
  const backups = backupsOn ? new BackupManager(workspace) : null;
  // 받은 파일 폴더 (src/inbox-folder.mjs): new files in a folder land on the quick capture page.
  const inbox = inboxOn ? new InboxFolder(workspace, { onChange: () => notify() }) : null;
  const listeners = new Set(),publicContent=new PublicContent(workspace.directory),pdfJobs=new PdfJobs(),archives=new ArchiveImports(workspace);
  const notify = () => { for (const response of listeners) response.write(`data: ${JSON.stringify({ revision: workspace.revision })}\n\n`); };
  const deliveries=new DeliveryWorker(workspace,{onChange:notify});
  registry?.listen(id, notify);
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    // A failure after the headers went out (a file vanishing mid-build) can only end the response, not replace it.
    const json = (data, status = 200) => { if (response.headersSent) { response.end(); return; } response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    try {
      const host = new URL(`http://${request.headers.host ?? ''}`);
      requireThat(['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname), 'HOST_DENIED', '로컬 호스트 요청만 허용합니다.');
      const origin = request.headers.origin;
      requireThat(!origin || origin === `http://${request.headers.host}`, 'ORIGIN_DENIED', '다른 사이트의 요청은 허용하지 않습니다.');
      const url = new URL(request.url, `http://${request.headers.host}`);
      if(request.method==='GET'&&url.pathname==='/highlight.mjs'){const body='const module={exports:{}};\n'+readFileSync(path.join(highlightRoot,'lib/core.js'),'utf8')+'\nexport default module.exports;';response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return response.end(body);}
      if(request.method==='GET'&&/^\/highlight-languages\/(javascript|typescript|python|json|sql|xml|css|bash|markdown)\.js$/.test(url.pathname)){const body=readFileSync(path.join(highlightRoot,'es/languages',path.basename(url.pathname)));response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return response.end(body);}
      // pdf.js character maps (CJK text in imported PDFs), read when an import needs them.
      if(request.method==='GET'&&/^\/vendor\/pdfjs-cmaps\/[A-Za-z0-9_-]+\.bcmap$/.test(url.pathname)){const body=readFileSync(path.join(webDirectory,'vendor/pdfjs-cmaps',path.basename(url.pathname)));response.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'max-age=86400'});return response.end(body);}
      if(request.method==='GET'&&/^\/fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(url.pathname)){const body=readFileSync(path.join(katexRoot,'dist/fonts',path.basename(url.pathname)));response.writeHead(200,{'Content-Type':url.pathname.endsWith('woff2')?'font/woff2':url.pathname.endsWith('woff')?'font/woff':'font/ttf'});return response.end(body);}
      // The Mermaid frame may use inline styles (Mermaid needs them to lay diagrams out) and only the app may frame it.
      if (request.method === 'GET' && url.pathname === '/mermaid-frame.html') {
        const bytes = readFileSync(path.join(webDirectory, 'mermaid-frame.html'));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" });
        return response.end(bytes);
      }
      if (request.method === 'GET' && staticFiles[url.pathname]) {
        const [name, type] = staticFiles[url.pathname];
        const bytes = readFileSync(path.resolve(webDirectory, name));
        response.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; frame-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        return response.end(bytes);
      }
      if(request.method==='GET'&&/^\/api\/map\/tiles\/\d+\/\d+\/\d+$/.test(url.pathname)){const [z,x,y]=url.pathname.split('/').slice(-3).map(Number),bytes=await publicContent.tile(z,x,y,`http://${request.headers.host}/`);response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public,max-age=604800'});return response.end(bytes);}
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ status: 'ok', revision: workspace.revision, schemaVersion: 1, instance });
      // 타임머신: ?at=<revision> reads the workspace as it was then (the state and, below, queries and search).
      const at = url.searchParams.has('at') ? Number(url.searchParams.get('at')) : null;
      if (at !== null) requireThat(Number.isInteger(at) && at >= 0, 'HISTORY_REVISION', '저장된 revision 범위에서 선택하세요.');
      if (request.method === 'GET' && url.pathname === '/api/state') return json(at === null ? workspace.snapshot() : workspace.snapshotAt(at));
      if (request.method === 'GET' && url.pathname === '/api/file-text') return json(workspace.fileTextStatus() ?? { off: true });
      if (request.method === 'GET' && url.pathname === '/api/mirror') return json(mirror ? mirror.status() : { off: true });
      if (request.method === 'GET' && url.pathname === '/api/backups') return json(backups ? backups.status() : { off: true });
      if (request.method === 'GET' && url.pathname === '/api/inbox') return json(inbox ? inbox.status() : { off: true });
      if (request.method === 'GET' && url.pathname === '/api/time-machine') return json(url.searchParams.has('revision') ? workspace.revisionInfo(Number(url.searchParams.get('revision'))) : workspace.revisionAt(url.searchParams.get('time') ?? ''));
      // 여러 워크스페이스: every workspace on this computer, with its name, icon and address.
      if (request.method === 'GET' && url.pathname === '/api/workspaces') {
        if (!registry) { const info = workspace.settingsInfo(); return json({ workspaces: [{ id, name: info.name ?? null, icon: info.icon ?? null, url: `http://${request.headers.host}`, current: true }] }); }
        return json({ workspaces: registry.list(id) });
      }
      // First-run hints from the command line (--lang): the welcome screen's preselected language; app: opened as the
      // downloadable app, so the menu offers to quit it.
      if (request.method === 'GET' && url.pathname === '/api/setup') return json({ language: process.env.LOCAL_WORKSPACE_LANG || null, app: !!quit });
      if (request.method === 'GET' && url.pathname === '/api/schema') return json({ operations: z.toJSONSchema(operationSchema), revisionPolicy: 'expectedRevision required; stale writes rejected', recovery: 'undo a command; undo that recovery command to redo', executionLogs: 'stored separately from page/block content' });
      if (request.method === 'GET' && url.pathname.startsWith('/api/objects/')) return json(workspace.get(decodeURIComponent(url.pathname.slice('/api/objects/'.length))));
      if (request.method === 'GET' && url.pathname === '/api/history') return json({ commands: workspace.history(url.searchParams.get('limit'), url.searchParams.get('pageId') || undefined, url.searchParams.get('sourceId') || undefined) });
      if (request.method === 'GET' && url.pathname === '/api/updates') return json({ entries: workspace.updates(url.searchParams.get('pageId'), url.searchParams.get('limit')) });
      if (request.method === 'GET' && url.pathname.startsWith('/api/source-versions/')) return json(workspace.sourceVersion(decodeURIComponent(url.pathname.slice('/api/source-versions/'.length)), Number(url.searchParams.get('revision'))));
      if (request.method === 'GET' && url.pathname.startsWith('/api/versions/')) return json(workspace.pageVersion(decodeURIComponent(url.pathname.slice('/api/versions/'.length)), Number(url.searchParams.get('revision'))));
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        listeners.add(response); response.write(`data: ${JSON.stringify({ revision: workspace.revision })}\n\n`);
        request.on('close', () => listeners.delete(response)); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/attachments/')) {
        const attachmentId = decodeURIComponent(url.pathname.slice('/api/attachments/'.length));
        // Large files (a big ZIP's videos, say) come from their file in pieces, a byte range when the player asks.
        const large = workspace.attachmentFile(attachmentId);
        if (large.entity.bytes > 32 * 1024 * 1024 || request.headers.range) {
          const { entity, file } = large, total = entity.bytes, name = encodeURIComponent(entity.name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
          const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
          let start = 0, end = total - 1;
          if (range && (range[1] || range[2])) { start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2])); end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1; }
          if (start > end || start >= total) { response.writeHead(416, { 'Content-Range': `bytes */${total}` }); return response.end(); }
          response.writeHead(range ? 206 : 200, { 'Content-Type': entity.mediaType, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}), 'Content-Disposition': `${entity.mediaType === 'text/plain' || inlineImageTypes.includes(entity.mediaType) ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`, 'Content-Security-Policy': "sandbox; default-src 'none'" });
          createReadStream(file, { start, end }).on('error', () => response.destroy()).pipe(response);
          return;
        }
        const { entity, bytes } = workspace.attachmentBytes(attachmentId);
        const name = encodeURIComponent(entity.name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        response.writeHead(200, { 'Content-Type': entity.mediaType, 'Content-Length': bytes.length, 'Accept-Ranges': 'bytes', 'Content-Disposition': `${entity.mediaType === 'text/plain' || inlineImageTypes.includes(entity.mediaType) ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`, 'Content-Security-Policy': "sandbox; default-src 'none'" });
        return response.end(bytes);
      }
      // An HTML block's file, shown in its frame (18차): its own origin-less sandbox (scripts, forms and popups
      // run, but it can reach neither the app nor its API — requests from it carry Origin: null and are refused).
      if (request.method === 'GET' && url.pathname.startsWith('/api/html/')) {
        const { entity, bytes } = workspace.attachmentBytes(decodeURIComponent(url.pathname.slice('/api/html/'.length)));
        requireThat(entity.mediaType === 'text/html', 'NOT_FOUND', 'HTML 파일이 아닙니다.');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length, 'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'", 'Referrer-Policy': 'no-referrer' });
        return response.end(bytes);
      }
      // PDF files (with subpages a ZIP of one PDF per page): made by a headless browser of this
      // computer's (src/pdf-export.mjs) as a job the export window follows, then fetched once.
      if (request.method === 'GET' && url.pathname === '/api/export/pdf') { const browser = findBrowser(); return json({ available: !!browser, browser: browser ? path.basename(browser).replace(/\.exe$/i, '') : null }); }
      if (request.method === 'GET' && /^\/api\/export\/pdf\/[\w-]+$/.test(url.pathname)) return json(pdfJobs.view(pdfJobs.get(url.pathname.split('/').pop())));
      if (request.method === 'GET' && /^\/api\/export\/pdf\/[\w-]+\/file$/.test(url.pathname)) {
        const job = pdfJobs.get(url.pathname.split('/').at(-2));
        requireThat(job.status === 'done', 'PDF_NOT_READY', 'PDF가 아직 준비되지 않았습니다.');
        const { filename, mediaType, bytes } = job.result, name = encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        response.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': bytes.length, 'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${name}` });
        return response.end(bytes);
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') return json(workspace.listRuns(Object.fromEntries(url.searchParams)));
      if (request.method === 'GET' && url.pathname.startsWith('/api/runs/')) return json(workspace.runDetail(decodeURIComponent(url.pathname.slice('/api/runs/'.length)), Object.fromEntries(url.searchParams)));
      // A large ZIP's files, each its own stream of bytes (archive-import.mjs).
      if (request.method === 'POST' && /^\/api\/import\/archive\/[\w-]+\/file$/.test(url.pathname)) {
        requireThat(request.headers['content-type']?.split(';')[0] === 'application/octet-stream', 'CONTENT_TYPE', 'application/octet-stream 요청이 필요합니다.');
        return json(await archives.addFile(url.pathname.split('/').at(-2), Object.fromEntries(url.searchParams), request), 201);
      }
      if (request.method === 'POST') {
        const body = await jsonBody(request);
        // 앱 끄기 (the downloadable app): every workspace closes and the app stops after this answer.
        if (url.pathname === '/api/quit') {
          requireThat(quit, 'QUIT_OFF', '여기서는 앱을 끌 수 없습니다. 실행한 터미널에서 멈추세요.');
          response.on('finish', () => setTimeout(quit, 50));
          return json({ ok: true });
        }
        if (url.pathname === '/api/import/archive') return json(archives.start(body), 201);
        if (/^\/api\/import\/archive\/[\w-]+\/(documents|preview|commit|cancel)$/.test(url.pathname)) {
          const [archiveId, step] = url.pathname.split('/').slice(-2);
          if (step === 'documents') return json(archives.addDocuments(archiveId, body));
          if (step === 'preview') return json(archives.preview(archiveId));
          if (step === 'cancel') return json(archives.cancel(archiveId));
          const result = archives.commit(archiveId, body); notify(); return json(result);
        }
        if(url.pathname==='/api/bookmark-preview')return json(await publicContent.bookmark(z.string().url().parse(body.url)));
        if(url.pathname==='/api/geocode')return json({results:await publicContent.geocode(body.query),attribution:'© OpenStreetMap contributors · Photon'});
        if (url.pathname === '/api/commands') { const result = workspace.execute(body); notify(); return json(result); }
        if (url.pathname === '/api/undo') { const result = workspace.undo(body); notify(); return json(result); }
        if (url.pathname === '/api/query') return json(at === null ? workspace.query(body) : workspace.readAt(at, state => ({ revision: at, ...querySource(state, body) })));
        if (url.pathname === '/api/search') return json(at === null ? workspace.search(searchSchema.parse(body)) : workspace.readAt(at, state => ({ revision: at, ...searchWorkspace(state, searchSchema.parse(body), workspace.searchOptions()) })));
        if (url.pathname === '/api/tasks') return json(at === null ? workspace.tasks(tasksSchema.parse(body)) : workspace.readAt(at, state => ({ revision: at, ...listTasks(state, tasksSchema.parse(body)) })));
        if (url.pathname === '/api/mirror' || url.pathname === '/api/mirror/run') {
          requireThat(mirror, 'MIRROR_OFF', '이 서버에서는 폴더 미러를 쓸 수 없습니다.');
          if (url.pathname === '/api/mirror/run') return json(mirror.sync());
          const input = z.object({ folder: z.string().max(4096).nullable() }).strict().parse(body);
          return json(mirror.configure(input.folder));
        }
        if (url.pathname === '/api/inbox' || url.pathname === '/api/inbox/run') {
          requireThat(inbox, 'INBOX_OFF', '이 서버에서는 받은 파일 폴더를 쓸 수 없습니다.');
          if (url.pathname === '/api/inbox/run') { const status = await inbox.poll(); notify(); return json(status); }
          return json(inbox.configure(z.object({ folder: z.string().max(4096).nullable().optional(), after: z.enum(['keep', 'move']).optional() }).strict().parse(body)));
        }
        if (url.pathname === '/api/capture') { const result = workspace.capture(body); notify(); return json(result, 201); }
        if (url.pathname === '/api/time-machine/restore') {
          const input = z.object({ pageId: z.string().min(1), revision: z.number().int().nonnegative(), mode: z.enum(['restore', 'copy']).default('restore'), title: z.string().max(500).optional(), commandId: z.string().min(1), actor: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict().parse(body);
          const result = workspace.restoreFromPast(input); notify(); return json(result);
        }
        if (url.pathname === '/api/workspaces/create') {
          requireThat(registry && launch, 'WORKSPACES_OFF', '여기서는 워크스페이스를 만들 수 없습니다.');
          const input = z.object({ name: z.string().trim().min(1).max(200), icon: z.string().max(80).nullable().optional() }).strict().parse(body);
          const created = await launch(registry.create());
          created.workspace.execute({ id: `workspace-name-${created.id}`, actor: 'user', expectedRevision: created.workspace.revision, operations: [{ type: 'workspace.update', name: input.name, ...(input.icon ? { icon: input.icon } : {}) }] });
          return json({ id: created.id, url: registry.url(created.id) });
        }
        // A page (with everything under it) copied — or moved — into another workspace on this computer.
        if (url.pathname === '/api/workspaces/copy') {
          requireThat(registry, 'WORKSPACES_OFF', '다른 워크스페이스가 없습니다.');
          const input = z.object({ pageId: z.string().min(1), targetId: z.string().min(1), move: z.boolean().optional() }).strict().parse(body);
          const target = registry.running.get(input.targetId)?.workspace;
          requireThat(target && input.targetId !== id, 'WORKSPACE_TARGET', '다른 워크스페이스를 고르세요.');
          const bundle = workspace.export({ id: input.pageId, format: 'bundle' });
          const plan = target.previewImport({ format: 'bundle', text: bundle.text, parentId: null, title: '' });
          const result = target.execute({ id: `copy-${input.pageId}-${Date.now()}`, actor: 'user', expectedRevision: target.revision, operations: plan.operations });
          if (input.move) workspace.execute({ id: `moved-${input.pageId}-${Date.now()}`, actor: 'user', expectedRevision: workspace.revision, operations: [{ type: 'node.trash', id: input.pageId }] });
          registry.notify(input.targetId); if (input.move) notify();
          const copied = plan.changes.find(change => change.kind === 'page')?.id ?? null;
          return json({ revision: result.revision, pageId: copied, url: `${registry.url(input.targetId)}/${copied ? `?id=${encodeURIComponent(copied)}` : ''}` });
        }
        if (url.pathname === '/api/formula-preview') return json(workspace.previewFormula(formulaPreviewSchema.parse(body)));
        if (url.pathname === '/api/property-conversion/preview') return json(workspace.previewPropertyConversion(body));
        if (url.pathname === '/api/import/preview') return json(workspace.previewImport(body));
        if (url.pathname === '/api/export') return json(workspace.export(body));
        if (url.pathname === '/api/export/pdf') {
          const input = z.object({ id: z.string().min(1), subpages: z.boolean().default(false), files: z.boolean().default(true), size: z.enum(['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid']).default('A4'), scale: z.number().int().min(25).max(200).default(100), prefs: z.record(z.string(), z.string()).optional() }).strict().parse(body);
          const browser = findBrowser();
          requireThat(browser, 'PDF_BROWSER', 'PDF 파일을 만들려면 이 컴퓨터에 Chrome · Edge 같은 Chromium 계열 브라우저가 있어야 합니다.');
          const plan = workspace.read(state => planPdfExport(state, input));
          const job = pdfJobs.start(({ progress, cancelled }) => printPdfs({ workspace, plan, baseUrl: `http://${request.headers.host}`, browser, size: input.size, scale: input.scale, prefs: input.prefs, onProgress: progress, cancelled }));
          job.total = plan.pages.length;
          return json(pdfJobs.view(job), 202);
        }
        if (/^\/api\/export\/pdf\/[\w-]+\/cancel$/.test(url.pathname)) return json(pdfJobs.view(pdfJobs.cancel(url.pathname.split('/').at(-2))));
        if (url.pathname === '/api/runs') return json(workspace.recordRun(body));
        if (url.pathname === '/api/backups') return json(backups ? await backups.run({ auto: false }) : await workspace.createBackup(), 201);
        if (url.pathname.startsWith('/api/backups/')) {
          requireThat(backups, 'BACKUPS_OFF', '이 서버에서는 백업 설정을 쓸 수 없습니다.');
          if (url.pathname === '/api/backups/settings') {
            const input = z.object({ every: z.enum(['off', 'hourly', 'daily', 'weekly']).optional(), keep: z.number().int().optional(), folder: z.string().max(4096).nullable().optional() }).strict().parse(body);
            return json(backups.configure(input));
          }
          if (url.pathname === '/api/backups/verify') return json(await backups.verify(z.object({ name: z.string().min(1).max(200) }).strict().parse(body).name));
          // A backup opened as a new workspace beside this one (nothing here is touched).
          if (url.pathname === '/api/backups/open') {
            requireThat(registry && launch, 'WORKSPACES_OFF', '새 워크스페이스를 만들 수 없습니다.');
            const input = z.object({ name: z.string().min(1).max(200), title: z.string().max(200).optional() }).strict().parse(body);
            // The new workspace's folder is made new by registry.create, so undoing a failed open removes only it.
            const item = backups.find(input.name), created = registry.create(), directory = registry.directory(created.id);
            const undo = () => { registry.save(registry.entries().filter(entry => entry.id !== created.id)); rmSync(directory, { recursive: true, force: true }); };
            let opened;
            try { Workspace.restoreBackup(item.path, directory, { emptyFolder: true }); opened = await launch(created); }
            catch (error) { undo(); throw error; }
            if (input.title) opened.workspace.execute({ id: `backup-open-${created.id}`, actor: 'user', expectedRevision: opened.workspace.revision, operations: [{ type: 'workspace.update', name: input.title }] });
            return json({ id: created.id, url: registry.url(created.id) }, 201);
          }
        }
        // A file at a web address, downloaded once and kept as a local attachment (이미지 · 파일 · PDF · 표지 링크,
        // 북마크 그림, 사이트 아이콘). Only public http(s) addresses; at most 16 MiB.
        if (url.pathname === '/api/attachments/from-url') {
          const input = z.object({ commandId: z.string().min(1), actor: z.string().min(1), expectedRevision: z.number().int().nonnegative(), url: z.string().url().max(4000),
            kind: z.enum(['image', 'icon', 'video', 'audio', 'pdf', 'file']).default('file'), reference: attachmentReferenceSchema.optional() }).strict().parse(body);
          const file = await publicContent.download(input.url);
          const allowed = { image: type => inlineImageTypes.includes(type), icon: type => iconImageTypes.includes(type), video: type => type.startsWith('video/'), audio: type => type.startsWith('audio/'), pdf: type => type === 'application/pdf', file: type => type !== 'text/html' }[input.kind];
          requireThat(allowed(file.mediaType), 'REMOTE_TYPE', '이 주소의 파일 형식은 여기에 넣을 수 없습니다.', { mediaType: file.mediaType });
          const blob = workspace.putBlob(file.bytes), attachmentId = `attachment:${input.commandId}`;
          const operations = [{ type: 'attachment.register', id: attachmentId, name: file.name, mediaType: file.mediaType, ...blob, ...(input.reference ? { reference: input.reference } : {}) }];
          const result = workspace.execute({ id: input.commandId, actor: input.actor, expectedRevision: input.expectedRevision, operations });
          notify(); return json({ ...result, attachmentId, blob, name: file.name, mediaType: file.mediaType }, 201);
        }
        if (url.pathname === '/api/attachments') {
          const input = z.object({ commandId: z.string().min(1), actor: z.string().min(1), expectedRevision: z.number().int().nonnegative(), name: z.string().min(1).max(255), mediaType: z.string().regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/), base64: z.string().max(23 * 1024 * 1024),
            reference: attachmentReferenceSchema.optional() }).strict().parse(body);
          const bytes = Buffer.from(input.base64, 'base64');
          requireThat(bytes.toString('base64') === input.base64 && bytes.length <= 16 * 1024 * 1024, 'ATTACHMENT_BYTES', '유효한 base64와 16 MiB 이하 파일을 사용하세요.');
          const blob = workspace.putBlob(bytes), attachmentId = `attachment:${input.commandId}`;
          const operations = [{ type: 'attachment.register', id: attachmentId, name: input.name, mediaType: input.mediaType, ...blob, ...(input.reference ? { reference: input.reference } : {}) }];
          const result = workspace.execute({ id: input.commandId, actor: input.actor, expectedRevision: input.expectedRevision, operations });
          notify(); return json({ ...result, attachmentId, blob }, 201);
        }
      }
      throw new WorkspaceError('NOT_FOUND', '요청한 경로가 없습니다.');
    } catch (error) {
      const code = error instanceof z.ZodError ? 'VALIDATION' : error.code ?? 'INTERNAL';
      const status = ['REVISION_CONFLICT', 'UNDO_CONFLICT', 'COMMAND_ID_REUSED', 'RUN_LOG_ID_REUSED'].includes(code) ? 409 : code === 'NOT_FOUND' ? 404 : ['ORIGIN_DENIED', 'HOST_DENIED'].includes(code) ? 403 : code === 'INTERNAL' ? 500 : 422;
      json({ error: { code, message: error instanceof z.ZodError ? '명령 형식을 확인하세요.' : error.message, details: error instanceof z.ZodError ? error.issues : error.details ?? {} } }, status);
    }
  });
  const heartbeat = setInterval(() => { for (const response of listeners) response.write(': heartbeat\n\n'); }, 15000);
  const scheduler = setInterval(() => {deliveries.tick().catch(error=>console.error(`Delivery worker: ${error.code??'UNKNOWN'}`)); try { if (workspace.tick()) notify(); } catch (error) { console.error(`Local scheduler: ${error.code ?? 'INTERNAL'}`); } }, 30000);
  scheduler.unref();
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); clearInterval(scheduler); });
  server.closeEventStreams = () => { for (const response of listeners) response.end(); listeners.clear(); };
  server.on('close', () => { mirror?.close(); backups?.close(); inbox?.close(); });
  server.mirror = mirror;
  return server;
}
// Starts the app on one folder of data. host stays 127.0.0.1 unless a container needs 0.0.0.0 (requests must
// still name a local host, so the app never answers other machines).
// app: opened as the downloadable app — the menu can quit it (every workspace's server and this process).
export function startLocalServer({ directory, port = 4141, host = '127.0.0.1', onListening, app = false } = {}) {
  const registry = new WorkspaceRegistry(directory, port);
  const quit = app ? () => stop() : null;
  // Another workspace's server: on its kept port, or the next free one (kept from then on).
  const launch = ({ id, port: wanted }) => new Promise((resolve, reject) => {
    const workspace = new Workspace(registry.directory(id)), server = createLocalServer(workspace, { registry, id, launch, fileIndex: true, mirror: true, backups: true, inbox: true, quit });
    let tries = 0, at = wanted;
    const attempt = () => server.listen(at, host);
    server.on('error', error => {
      if (error.code === 'EADDRINUSE' && at && ++tries < 30) { at += 1; attempt(); return; }
      workspace.close(); reject(error);
    });
    server.on('listening', () => { if (at !== wanted) registry.setPort(id, at); registry.register(id, workspace, server); resolve({ id, workspace, server }); });
    attempt();
  });
  const workspace = new Workspace(directory), server = createLocalServer(workspace, { registry, id: 'main', launch, fileIndex: true, mirror: true, backups: true, inbox: true, quit });
  registry.register('main', workspace, server);
  server.on('error', () => workspace.close());
  server.listen(port, host, () => {
    onListening?.(server);
    for (const entry of registry.entries()) launch(entry).catch(error => console.error(`Workspace ${entry.id}: ${error.code ?? error.message}`));
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    for (const { server: each } of registry.running.values()) { each.closeEventStreams?.(); each.closeIdleConnections?.(); }
    // A connection that stays busy can't hold the app open: the data is closed and the process ends regardless.
    setTimeout(() => { for (const { workspace: data } of registry.running.values()) { try { data.close(); } catch { /* closed */ } } process.exit(0); }, 4000).unref();
    let open = registry.running.size;
    for (const { server: each, workspace: data } of registry.running.values()) each.close(() => { data.close(); if (--open <= 0) process.exit(0); });
    if (!open) process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return { server, workspace, registry };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.env.LOCAL_WORKSPACE_DATA ?? fileURLToPath(new URL('../data/', import.meta.url));
  startLocalServer({ directory, port: Number(process.env.LOCAL_WORKSPACE_PORT ?? 4141), host: process.env.LOCAL_WORKSPACE_HOST ?? '127.0.0.1',
    onListening: server => console.log(`${APP.name}: http://127.0.0.1:${server.address().port}`) });
}
