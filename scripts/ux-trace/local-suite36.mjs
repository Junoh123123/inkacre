// 31차 (the last two offline gaps). PDF export through a headless browser of this computer's: a page as one PDF
// file, with subpages a ZIP of one PDF per page and folders of their pictures; a ZIP import read in pieces — an
// export with subpage folders and pictures, Excel 97–2003 (.xls), OpenDocument (.ods), TSV and text files converted,
// hidden files left out, folders without a document made pages, files no page shows placed as blocks, ZIP64, and a
// ZIP over the old 16 MiB limit whose large files are kept as attachments (served in byte ranges). Starts its own
// server, pointed at Playwright's Chromium (PAGEYARD_BROWSER) for the PDFs.
// 사용법: node scripts/ux-trace/local-suite36.mjs   (PASS/FAIL 출력)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { zipSync, unzipSync, strToU8 } = createRequire(path.join(root, 'package.json'))('fflate');
const folder = mkdtempSync(path.join(tmpdir(), 'suite36-'));
const port = 8800 + Math.floor(Math.random() * 40) * 20;
const base = `http://127.0.0.1:${port}`;
for (const at of [port, port + 10]) { const busy = await fetch(`http://127.0.0.1:${at}/api/state`).then(() => true, () => false); if (busy) { console.log(`FAIL port ${at} is in use; run again`); process.exit(1); } }
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore', env: { ...process.env, PAGEYARD_BROWSER: chromium.executablePath() } });
process.on('exit', () => { server.kill(); rmSync(folder, { recursive: true, force: true }); });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };
const uploadBytes = async (name, mediaType, bytes) => { const s = await state(); const commandId = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`; const res = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, actor: 'user', expectedRevision: s.revision, name, mediaType, base64: Buffer.from(bytes).toString('base64') }) }); if (!res.ok) throw new Error(await res.text()); return (await res.json()).attachmentId; };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const picture = await uploadBytes('표지 그림.png', 'image/png', png);
await post([
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'report', title: '보고서', parentId: 'home' },
  { type: 'block.create', id: 'r1', parentId: 'report', blockType: 'paragraph', richText: [{ text: '보고서 본문 — 日本語も。' }] },
  { type: 'block.create', id: 'r2', parentId: 'report', blockType: 'image', attachmentId: picture },
  { type: 'page.create', id: 'appendix', title: '부록', parentId: 'report' },
  { type: 'block.create', id: 'a1', parentId: 'appendix', blockType: 'paragraph', richText: [{ text: '부록 본문' }] },
  { type: 'page.create', id: 'tasks', title: '할 일', parentId: 'report' },
  { type: 'source.create', id: 's', pageId: 'tasks', name: '작업', titlePropertyId: 'title' },
  { type: 'page.create', id: 'row1', title: '첫 작업', sourceId: 's' },
]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
await context.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(350); };
const openPageMenu = async () => { await page.locator('.topbar button[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300); };
const pdftotext = file => { try { return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }); } catch { return null; } };
const scratch = mkdtempSync(path.join(tmpdir(), 'suite36-out-'));

// 1. PDF with subpages: a ZIP of one PDF per page (rows of a database in its folder) and the page's picture.
await open('report');
await openPageMenu(); await clickMenu('더 보기'); await clickMenu('내보내기');
await page.locator('.export-row', { hasText: '내보내기 형식' }).locator('select').selectOption('pdf'); await page.waitForTimeout(500);
const note1 = await page.locator('.export-pdf-note').textContent().catch(() => '');
await page.locator('.export-row', { hasText: '하위 페이지 포함' }).locator('[role="switch"], .switch, button').first().click(); await page.waitForTimeout(200);
const note2 = await page.locator('.export-pdf-note').textContent().catch(() => '');
// (Playwright's Chromium names non-ASCII downloads "download", so the name is read from the finished job.)
const jobNames = [];
page.on('response', response => { if (/\/api\/export\/pdf\/[\w-]+$/.test(response.url())) response.json().then(job => { if (job.status === 'done') jobNames.push(job.filename); }).catch(() => {}); });
const named = async () => { for (let tries = 0; tries < 50 && !jobNames.length; tries++) await new Promise(resolve => setTimeout(resolve, 100)); return jobNames.shift() ?? ''; };
const download1 = page.waitForEvent('download', { timeout: 60000 });
await page.locator('.dialog button, [role="dialog"] button', { hasText: 'PDF로 저장' }).click();
const sawProgress = await page.locator('.export-pdf-progress').waitFor({ timeout: 5000 }).then(() => true, () => false);
const zipFile = await download1.then(async item => { const target = path.join(scratch, 'pdf-bundle.zip'); await item.saveAs(target); return target; }, () => null);
const zipName = await named();
const entries = zipFile ? Object.keys(unzipSync(readFileSync(zipFile))) : [];
const reportText = zipFile ? (() => { const files = unzipSync(readFileSync(zipFile)); const target = path.join(scratch, 'report.pdf'); writeFileSync(target, files['보고서.pdf']); return pdftotext(target); })() : null;
ok('PDF + 하위 페이지 → ZIP(보고서.pdf · 보고서/부록.pdf · 보고서/할 일.pdf · 보고서/할 일/작업/첫 작업.pdf · 보고서/표지 그림.png), 진행 표시',
  zipName === '보고서.zip' && ['보고서.pdf', '보고서/부록.pdf', '보고서/할 일.pdf', '보고서/할 일/작업/첫 작업.pdf', '보고서/표지 그림.png'].every(name => entries.includes(name)) && sawProgress && /PDF 파일/.test(note1 ?? '') && /ZIP/.test(note2 ?? ''),
  `file=${zipName} entries=${entries.join(',')} progress=${sawProgress} notes=${note1}|${note2}`);
ok('PDF 안의 글이 페이지 그대로(한국어 · 일본어), 선택할 수 있는 글자', reportText == null || (/보고서 본문/.test(reportText) && /日本語/.test(reportText)), reportText == null ? 'pdftotext 없음' : reportText.slice(0, 60).replace(/\s+/g, ' '));

// 2. One page without subpages: a single PDF file.
await open('appendix');
await openPageMenu(); await clickMenu('더 보기'); await clickMenu('내보내기');
await page.locator('.export-row', { hasText: '내보내기 형식' }).locator('select').selectOption('pdf'); await page.waitForTimeout(500);
const download2 = page.waitForEvent('download', { timeout: 60000 });
await page.locator('.dialog button, [role="dialog"] button', { hasText: 'PDF로 저장' }).click();
const pdfFile = await download2.then(async item => { const target = path.join(scratch, 'single.pdf'); await item.saveAs(target); return target; }, () => null);
const pdfName = await named();
const head = pdfFile ? readFileSync(pdfFile).subarray(0, 5).toString() : '';
ok('하위 페이지 없이 → PDF 파일 하나(부록.pdf), 대화 상자 없이 저장', pdfName === '부록.pdf' && head === '%PDF-', `file=${pdfName} head=${head}`);

// 3. A ZIP import: an exported workspace with folders and pictures; .xls, .ods, .tsv, .txt converted; hidden files left out.
// (test/fixtures: an Excel 97–2003 workbook with 399 rows, and the same archive written with ZIP64 records.)
const odsContent = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="시트1">
<table:table-row><table:table-cell office:value-type="string"><text:p>도시</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>인구</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>날짜</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16380"/></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>서울<text:s text:c="2"/>특별시</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="9500000"><text:p>9,500,000</text:p></table:table-cell><table:table-cell office:value-type="date" office:date-value="2026-10-26"><text:p>26/10/26</text:p></table:table-cell></table:table-row>
<table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="string"><text:p>반복</text:p></table:table-cell><table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell></table:table-row>
<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`;
const odsFile = zipSync({ mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }], 'content.xml': strToU8(odsContent) });
const id32 = '0123456789abcdef0123456789abcdef', sub32 = 'abcdefabcdefabcdefabcdefabcdefab';
const exportFiles = {
  [`보고서 ${id32}.md`]: strToU8(`# 보고서\n\n본문과 ![그림](${encodeURIComponent(`보고서 ${id32}`)}/${encodeURIComponent('그림.png')})\n\n[하위](${encodeURIComponent(`보고서 ${id32}`)}/${encodeURIComponent(`하위 ${sub32}.md`)})\n`),
  [`보고서 ${id32}/하위 ${sub32}.md`]: strToU8('# 하위\n\n하위 페이지 본문\n'),
  [`보고서 ${id32}/그림.png`]: png,
  '표/작업.xls': readFileSync(path.join(root, 'test/fixtures/archive-sample.xls')),
  '표/도시.ods': [odsFile, { level: 0 }],
  '표/점수.tsv': strToU8('이름\t점수\n가\t1\n"나\t다"\t2\n'),
  '메모.txt': strToU8('첫 줄\n# 둘째 줄\n'),
  '사진/여행/바다.png': png,
  '.DS_Store': strToU8('junk'),
  '__MACOSX/._메모.txt': strToU8('junk'),
};
writeFileSync(path.join(scratch, 'small.zip'), zipSync(exportFiles));
const noise = Buffer.alloc(19999744); for (let i = 0; i < noise.length; i += 4) noise.writeUInt32LE((i * 2654435761) >>> 0, i);
writeFileSync(path.join(scratch, 'big.zip'), zipSync({ ...exportFiles, '영상/큰 파일.bin': [noise, { level: 0 }], '영상/압축된 큰 파일.txt.bin': Buffer.alloc(20000000, 65) }));
const importZip = async (file, name) => {
  await open('home');
  await openPageMenu(); await clickMenu('더 보기'); await clickMenu('가져오기'); await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/zip', buffer: readFileSync(file) });
  await page.waitForTimeout(1200);
  const label = await page.locator('.field .muted').first().textContent().catch(() => '');
  await page.locator('button', { hasText: '미리보기' }).click();
  await page.locator('.archive-summary').waitFor({ timeout: 60000 }).catch(() => {});
  const summary = await page.locator('.archive-summary').textContent().catch(() => '');
  await page.locator('.dialog button, [role="dialog"] button', { hasText: /^가져오기$/ }).last().click().catch(() => {});
  await page.waitForTimeout(2000);
  return { label, summary };
};
const before = new Set((await state()).objects.map(o => o.id));
const small = await importZip(path.join(scratch, 'small.zip'), '내보낸 자료.zip');
const s3 = await state();
const added = s3.objects.filter(o => !before.has(o.id) && o.alive !== false);
const pageNamed = title => added.find(o => o.kind === 'page' && o.title === title && !o.sourceId);
const rootPage = pageNamed('내보낸 자료');
const reportPage = pageNamed('보고서'), subPage = pageNamed('하위');
const reportImage = reportPage && added.find(o => o.kind === 'block' && o.parentId === reportPage.id && o.blockType === 'image');
const reportLink = reportPage && added.find(o => o.kind === 'block' && o.parentId === reportPage.id && (o.richText ?? []).some(run => run.pageId === subPage?.id));
ok('내보낸 ZIP → 보고서(그림 블록 · 하위 페이지 링크) › 하위, 32자리 ID는 제목에서 빠짐', !!rootPage && !!reportPage && subPage?.parentId === reportPage.id && !!reportImage && !!reportLink, `root=${!!rootPage} report=${!!reportPage} sub=${subPage?.parentId === reportPage?.id} image=${!!reportImage} link=${!!reportLink}`);
const sourceOf = title => { const holder = pageNamed(title); return holder && added.find(o => o.kind === 'source' && o.parentId === holder.id); };
const rowsOf = source => added.filter(o => o.kind === 'page' && o.sourceId === source?.id);
const propsOf = source => added.filter(o => o.kind === 'property' && o.sourceId === source?.id);
const xls = sourceOf('작업'), ods = sourceOf('도시'), tsv = sourceOf('점수');
const xlsRows = rowsOf(xls), xlsProps = propsOf(xls);
const valueOf = (row, props, name) => row?.values?.[props.find(p => p.name === name)?.id];
const xlsFirst = xlsRows.find(row => /^항목 1 /.test(row.title));
const xlsLast = xlsRows.find(row => /^항목 399 /.test(row.title));
ok('.xls(Excel 97–2003) → 첫 시트가 DB: 399행, 공유 문자열(이어진 레코드 포함) · 숫자 · 수식에 저장된 결과 · 참거짓', xlsRows.length === 399 && xlsProps.map(p => p.name).join(',') === '이름,점수,합계,완료' && valueOf(xlsFirst, xlsProps, '점수') === '1.5' && valueOf(xlsFirst, xlsProps, '합계') === '3' && valueOf(xlsFirst, xlsProps, '완료') === 'true' && valueOf(xlsLast, xlsProps, '합계') === '1197' && !!xlsLast && /가나다라마바사가나다라마바사가나다라마바사$/.test(xlsLast.title),
  `rows=${xlsRows.length} props=${xlsProps.map(p => p.name)} first=${xlsFirst?.title}|${valueOf(xlsFirst, xlsProps, '점수')}|${valueOf(xlsFirst, xlsProps, '합계')}|${valueOf(xlsFirst, xlsProps, '완료')} last=${xlsLast?.title}`);
const odsRows = rowsOf(ods), odsProps = propsOf(ods);
ok('.ods → DB(공백 · 숫자 · 날짜 · 반복 행, 끝의 빈 행·열 1백만 개는 무시)', odsRows.length === 3 && odsProps.length === 3 && odsRows.some(row => row.title === '서울  특별시' && valueOf(row, odsProps, '인구') === '9500000' && valueOf(row, odsProps, '날짜') === '2026-10-26') && odsRows.filter(row => row.title === '반복').length === 2,
  `rows=${odsRows.map(r => r.title)} props=${odsProps.length}`);
const tsvRows = rowsOf(tsv);
ok('.tsv → DB(따옴표 안의 탭 유지)', tsvRows.length === 2 && tsvRows.some(row => row.title === '나\t다'), `rows=${JSON.stringify(tsvRows.map(r => r.title))}`);
const memo = pageNamed('메모'), memoBlocks = memo ? added.filter(o => o.kind === 'block' && o.parentId === memo.id) : [];
const photos = pageNamed('사진'), trip = pageNamed('여행'), tripImage = trip && added.find(o => o.kind === 'block' && o.parentId === trip.id && o.blockType === 'image');
const hiddenGone = !added.some(o => o.kind === 'attachment' && /DS_Store|^\._/.test(o.name ?? ''));
ok('.txt → 줄마다 문단, 문서 없는 폴더(사진/여행)는 페이지로 · 그림은 블록으로, .DS_Store · __MACOSX 제외', memoBlocks.length === 2 && memoBlocks.every(b => b.blockType === 'paragraph') && trip?.parentId === photos?.id && !!tripImage && hiddenGone && /10|8/.test(small.label ?? ''),
  `memo=${memoBlocks.map(b => b.blockType)} trip=${trip?.parentId === photos?.id} image=${!!tripImage} hidden=${hiddenGone} label=${small.label} summary=${small.summary}`);

// 4. ZIP64 records read the same; 5. a ZIP over 16 MiB: its 20 MB files kept as attachments, served in ranges.
const before64 = new Set((await state()).objects.map(o => o.id));
await importZip(path.join(root, 'test/fixtures/archive-zip64.zip'), 'z64.zip');
const s4 = await state();
const added64 = s4.objects.filter(o => !before64.has(o.id) && o.alive !== false);
ok('ZIP64 기록(EOCD64 · 확장 필드)도 같은 결과', added64.some(o => o.kind === 'page' && o.title === '하위') && added64.some(o => o.kind === 'source' && o.name === '작업'), `pages=${added64.filter(o => o.kind === 'page' && !o.sourceId).length}`);
const beforeBig = new Set(s4.objects.map(o => o.id));
const big = await importZip(path.join(scratch, 'big.zip'), '큰 자료.zip');
const s5 = await state();
const addedBig = s5.objects.filter(o => !beforeBig.has(o.id) && o.alive !== false);
const stored = addedBig.find(o => o.kind === 'attachment' && o.name === '큰 파일.bin'), deflated = addedBig.find(o => o.kind === 'attachment' && o.name === '압축된 큰 파일.txt.bin');
const ranged = stored ? await fetch(`${base}/api/attachments/${encodeURIComponent(stored.id)}`, { headers: { Range: 'bytes=100-199' } }) : null;
const rangedBytes = ranged ? Buffer.from(await ranged.arrayBuffer()) : Buffer.alloc(0);
const whole = deflated ? await fetch(`${base}/api/attachments/${encodeURIComponent(deflated.id)}`) : null;
ok('16 MiB 넘는 ZIP(20 MB 파일 둘, 저장 · 압축) → 첨부로 그대로, 큰 첨부는 범위 요청(206)으로', stored?.bytes === 19999744 && deflated?.bytes === 20000000 && ranged?.status === 206 && rangedBytes.length === 100 && whole?.headers.get('content-length') === '20000000' && whole?.headers.get('accept-ranges') === 'bytes',
  `stored=${stored?.bytes} deflated=${deflated?.bytes} range=${ranged?.status}/${rangedBytes.length} whole=${whole?.headers.get('content-length')} summary=${big.summary}`);

// 6. A standalone .xls file imports as a database too.
const xlsBytes = unzipSync(readFileSync(path.join(scratch, 'small.zip')))['표/작업.xls'];
await open('home');
await openPageMenu(); await clickMenu('더 보기'); await clickMenu('가져오기'); await page.waitForTimeout(300);
await page.locator('input[type="file"]').setInputFiles({ name: '단독.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(xlsBytes) });
await page.waitForTimeout(1200);
await page.locator('button', { hasText: '미리보기' }).click(); await page.waitForTimeout(800);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^가져오기$/ }).last().click().catch(() => {}); await page.waitForTimeout(1500);
const s6 = await state();
const alone = s6.objects.find(o => o.kind === 'page' && o.title === '단독' && !o.sourceId);
const aloneSource = alone && s6.objects.find(o => o.kind === 'source' && o.parentId === alone.id);
ok('.xls 파일 하나 → 데이터베이스', !!aloneSource && s6.objects.filter(o => o.kind === 'page' && o.sourceId === aloneSource.id).length === 399);

ok('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
rmSync(scratch, { recursive: true, force: true });
process.exit(0);
