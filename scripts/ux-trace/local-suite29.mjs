// 23차 (coverage phase 2): getting documents in and out. Word, Excel, PDF, OPML, EPUB and text files import (several at
// once with progress); /import opens the import window; exports with their options (Markdown & CSV with subpages in
// folders, HTML, PDF through a print window with page size and scale); the whole workspace exports from 설정 › 일반;
// the browser's own print leaves the sidebar out. Starts its own server on an empty folder.
// 사용법: node scripts/ux-trace/local-suite29.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { zipSync, unzipSync, strToU8, strFromU8 } = await import(path.join(root, 'node_modules/fflate/esm/index.mjs'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const folder = mkdtempSync(path.join(tmpdir(), 'suite29-'));
const files = mkdtempSync(path.join(tmpdir(), 'suite29-files-'));
const port = 5800 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const blocksOf = (s, pageId) => s.objects.filter(o => o.kind === 'block' && o.parentId === pageId && o.alive !== false).sort((a, b) => a.position - b.position);
const text = block => (block?.richText ?? []).map(run => run.text).join('');

// ----- test files -----
const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const docx = zipSync({
  '[Content_Types].xml': strToU8(`${xmlHead}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
  '_rels/.rels': strToU8(`${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/_rels/document.xml.rels': strToU8(`${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
  'word/styles.xml': strToU8(`${xmlHead}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`),
  'word/document.xml': strToU8(`${xmlHead}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>회의 정리</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">일반 문장과 </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>굵은 글</w:t></w:r></w:p></w:body></w:document>`),
});
writeFileSync(path.join(files, '회의.docx'), docx);
const xlsx = zipSync({
  'xl/workbook.xml': strToU8(`${xmlHead}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="목록" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels': strToU8(`${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
  'xl/sharedStrings.xml': strToU8(`${xmlHead}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>이름</t></si><si><t>수량</t></si><si><t>사과</t></si></sst>`),
  'xl/worksheets/sheet1.xml': strToU8(`${xmlHead}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>배</t></is></c><c r="B3"><v>7</v></c></row></sheetData></worksheet>`),
});
writeFileSync(path.join(files, '재고.xlsx'), xlsx);
{
  const stream = 'BT /F1 24 Tf 72 700 Td (Report Title) Tj ET\nBT /F1 12 Tf 72 660 Td (First paragraph line) Tj ET\nBT /F1 12 Tf 72 646 Td (continues here.) Tj ET\nBT /F1 12 Tf 72 600 Td (Second paragraph.) Tj ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path.join(files, 'report.pdf'), pdf, 'latin1');
}
writeFileSync(path.join(files, '개요.opml'), `<?xml version="1.0"?><opml version="2.0"><head><title>개요</title></head><body><outline text="첫 단계"><outline text="세부 항목"/></outline><outline text="둘째 단계"/></body></opml>`);
writeFileSync(path.join(files, '책.epub'), zipSync({
  'mimetype': strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`),
  'OEBPS/text/ch1.xhtml': strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1장</title></head><body><h2>첫 장</h2><p>옛날 옛적에</p></body></html>`),
}));
writeFileSync(path.join(files, '메모.txt'), '# 이건 제목이 아님\n둘째 줄');

// Files are handed over as buffers: a path with Korean letters does not reach the page in this harness.
const payload = name => ({ name, mimeType: 'application/octet-stream', buffer: readFileSync(path.join(files, name)) });

await post([
  { type: 'page.create', id: 'doc', title: '보고서', parentId: null },
  { type: 'block.create', id: 'doc-b1', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '본문 ' }, { text: '부록', pageId: 'sub' }] },
  { type: 'block.create', id: 'doc-b2', parentId: 'doc', blockType: 'paragraph', richText: [] },
  { type: 'page.create', id: 'sub', title: '부록', parentId: 'doc' },
  { type: 'block.create', id: 'sub-b1', parentId: 'sub', blockType: 'paragraph', richText: [{ text: '부록 내용' }] },
]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(300); };
const openPageMenu = async () => { await page.locator('[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300); };

// 1. /import opens the import window; a Word file imports with its heading and bold words.
await open('doc');
await page.locator('[data-block-id="doc-b2"]').click(); await page.keyboard.type('/import'); await page.waitForTimeout(400);
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const dialog = await page.locator('.dialog, [role="dialog"]').filter({ hasText: '가져오기' }).count();
await page.locator('input[type="file"]').setInputFiles(payload('회의.docx'));
await page.waitForTimeout(1500);
const titleValue = await page.locator('.field input.text-input').first().inputValue().catch(() => '');
await page.locator('button', { hasText: '미리보기' }).click(); await page.waitForTimeout(800);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^가져오기$/ }).last().click(); await page.waitForTimeout(1200);
let s = await state();
const wordPage = s.objects.find(o => o.kind === 'page' && o.title === '회의' && o.alive !== false);
const wordBlocks = wordPage ? blocksOf(s, wordPage.id) : [];
ok('"/import"로 가져오기 창, Word(.docx) → 제목1 "회의 정리" + 굵은 글, 이 페이지 아래에', dialog > 0 && titleValue === '회의' && wordBlocks[0]?.blockType === 'heading1' && text(wordBlocks[0]) === '회의 정리' && wordBlocks[1]?.richText?.some(run => run.bold && run.text === '굵은 글') && wordPage.parentId === 'doc',
  `dialog=${dialog} title=${titleValue} blocks=${wordBlocks.map(b => `${b.blockType}:${text(b)}`).join('|')} parent=${wordPage?.parentId}`);

// 2. Five files at once: Excel → database, PDF → heading + paragraphs, OPML → nested list, EPUB → chapter, text → lines.
await open('doc');
await openPageMenu(); await clickMenu('더 보기'); await clickMenu('가져오기'); await page.waitForTimeout(300);
await page.locator('input[type="file"]').setInputFiles(['재고.xlsx', 'report.pdf', '개요.opml', '책.epub', '메모.txt'].map(payload));
await page.waitForTimeout(400);
const listed = await page.evaluate(() => document.querySelectorAll('.import-file-list li').length);
await page.locator('button', { hasText: '5개 가져오기' }).click();
await page.waitForFunction(() => document.querySelector('.import-progress span')?.textContent === '완료' || !document.querySelector('.import-progress'), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
s = await state();
const byTitle = title => s.objects.find(o => o.kind === 'page' && o.title === title && o.alive !== false && !o.sourceId);
const sheet = byTitle('재고'), sheetSource = sheet && s.objects.find(o => o.kind === 'source' && o.parentId === sheet.id);
const sheetRows = sheetSource ? s.objects.filter(o => o.kind === 'page' && o.sourceId === sheetSource.id).map(o => o.title).sort().join(',') : '';
const pdfBlocks = byTitle('report') ? blocksOf(s, byTitle('report').id).map(b => `${b.blockType}:${text(b)}`) : [];
const outline = byTitle('개요') ? blocksOf(s, byTitle('개요').id) : [];
const outlineChild = outline[0] ? s.objects.find(o => o.kind === 'block' && o.parentId === outline[0].id) : null;
const book = byTitle('책') ? blocksOf(s, byTitle('책').id).map(b => `${b.blockType}:${text(b)}`).join('|') : '';
const memo = byTitle('메모') ? blocksOf(s, byTitle('메모').id).map(b => `${b.blockType}:${text(b)}`).join('|') : '';
ok('여러 파일 한 번에(목록 5개): 엑셀 → DB(사과 · 배), PDF → 제목 + 문단, OPML → 중첩 목록, EPUB → 장, 텍스트 → 줄 그대로',
  listed === 5 && sheetRows === '배,사과' && pdfBlocks[0] === 'heading1:Report Title' && pdfBlocks[1] === 'paragraph:First paragraph line continues here.' && pdfBlocks[2] === 'paragraph:Second paragraph.' && outline[0]?.blockType === 'bullet' && text(outlineChild) === '세부 항목' && book.includes('첫 장') && book.includes('옛날 옛적에') && memo === 'paragraph:# 이건 제목이 아님|paragraph:둘째 줄',
  `listed=${listed} rows=${sheetRows} pdf=${pdfBlocks.join('|')} outline=${outline.map(b => `${b.blockType}:${text(b)}`).join('|')}>${text(outlineChild)} book=${book} memo=${memo}`);

// 3. Export Markdown & CSV with subpages in folders.
await open('doc');
await openPageMenu(); await clickMenu('더 보기'); await clickMenu('내보내기'); await page.waitForTimeout(300);
const exportLabels = await page.evaluate(() => [...document.querySelectorAll('.export-row-text > span:first-child')].map(e => e.textContent).join(','));
await page.locator('.export-row', { hasText: '하위 페이지 포함' }).locator('[role="switch"], .switch, button').first().click(); await page.waitForTimeout(200);
const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^내보내기$/ }).last().click();
const download = await downloadPromise.catch(() => null);
let entries = [];
if (download) { const saved = path.join(files, 'export.zip'); await download.saveAs(saved); entries = Object.keys(unzipSync(readFileSync(saved))).sort(); }
ok('내보내기 창 [형식 · 포함할 콘텐츠 · 하위 페이지 포함] → Markdown ZIP에 보고서.md와 보고서/부록.md(하위 페이지 폴더)', exportLabels.startsWith('내보내기 형식,포함할 콘텐츠') && entries.includes('보고서.md') && entries.includes('보고서/부록.md') && entries.some(name => name.startsWith('보고서/회의')),
  `labels=${exportLabels} entries=${entries.join(',')}`);

// 4. PDF opens a print window with the pages; the print page itself lays out every page with the chosen size.
await page.keyboard.press('Escape').catch(() => {});
await open('doc');
await openPageMenu(); await clickMenu('더 보기'); await clickMenu('내보내기'); await page.waitForTimeout(300);
await page.locator('.export-row', { hasText: '내보내기 형식' }).locator('select').selectOption('pdf'); await page.waitForTimeout(200);
const pdfRows = await page.evaluate(() => [...document.querySelectorAll('.export-row-text > span:first-child')].map(e => e.textContent).join(','));
await page.locator('.export-row', { hasText: '페이지 형식' }).locator('select').selectOption('Letter');
await page.locator('.export-row', { hasText: '하위 페이지 포함' }).locator('[role="switch"], .switch, button').first().click(); await page.waitForTimeout(200);
const popupPromise = context.waitForEvent('page', { timeout: 8000 });
await page.locator('.dialog button, [role="dialog"] button', { hasText: 'PDF로 저장' }).click();
const popup = await popupPromise.catch(() => null);
const popupUrl = popup?.url() ?? '';
if (popup) await popup.close().catch(() => {});
const preview = await context.newPage();
await preview.goto(`${base}/?print=doc&sub=1&files=1&size=Letter&scale=80&noprint=1&stay=1`, { waitUntil: 'networkidle' }); await preview.waitForTimeout(1500);
const printInfo = await preview.evaluate(() => ({ pages: [...document.querySelectorAll('.print-page .page-title')].map(e => e.textContent), size: document.querySelector('style')?.textContent?.match(/size: (\w+)/)?.[1], zoom: document.querySelector('.print-document')?.style.zoom, controls: document.querySelectorAll('.print-document .page-controls').length, sidebar: !!document.querySelector('.sidebar') }));
await preview.close();
ok('PDF: [형식 · 포함할 콘텐츠 · 페이지 형식 · 배율 · 하위 페이지 포함] → 인쇄 창(?print=…&size=Letter), 보고서 · 부록 · 회의…가 차례로, 사이드바 없음',
  pdfRows.includes('페이지 형식') && pdfRows.includes('배율') && /print=doc/.test(popupUrl) && /size=Letter/.test(popupUrl) && printInfo.pages[0] === '보고서' && printInfo.pages.includes('부록') && printInfo.size === 'Letter' && printInfo.zoom === '0.8' && printInfo.controls === 0 && !printInfo.sidebar,
  `rows=${pdfRows} url=${popupUrl.split('?')[1]} info=${JSON.stringify(printInfo)}`);

// 5. The whole workspace from 설정 › 일반.
await open('doc');
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250); await clickMenu('설정'); await page.waitForTimeout(400);
await page.locator('.prefs-nav-item', { hasText: '일반' }).click(); await page.waitForTimeout(300);
await page.locator('.prefs-row', { hasText: '모든 워크스페이스 콘텐츠 내보내기' }).locator('button').click(); await page.waitForTimeout(400);
const wholeTitle = await page.evaluate(() => document.querySelector('.dialog-title, [role="dialog"] h2')?.textContent);
const wholeDownload = page.waitForEvent('download', { timeout: 10000 });
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^내보내기$/ }).last().click();
const whole = await wholeDownload.catch(() => null);
let wholeEntries = [];
if (whole) { const saved = path.join(files, 'whole.zip'); await whole.saveAs(saved); wholeEntries = Object.keys(unzipSync(readFileSync(saved))); }
ok('설정 › 일반 › 모든 워크스페이스 콘텐츠 내보내기 → ZIP에 모든 페이지(가져온 DB는 CSV와 행 폴더로)', /모든 워크스페이스/.test(wholeTitle ?? '') && wholeEntries.includes('보고서.md') && wholeEntries.includes('보고서/재고.csv') && wholeEntries.includes('보고서/개요.md') && wholeEntries.includes('보고서/재고/사과.md'), `title=${wholeTitle} entries=${wholeEntries.slice(0, 12).join(',')}`);

// 6. Browser printing (File › Print): the open page only.
await open('doc');
await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300);
const printed = await page.evaluate(() => ({ sidebar: getComputedStyle(document.querySelector('.sidebar')).display, topbar: getComputedStyle(document.querySelector('.topbar') ?? document.body).display, title: document.querySelector('.page-title')?.textContent }));
await page.emulateMedia({ media: 'screen' });
ok('브라우저 인쇄(파일 › 인쇄): 사이드바와 위 막대 없이 페이지만', printed.sidebar === 'none' && printed.topbar === 'none' && printed.title === '보고서', JSON.stringify(printed));

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
rmSync(files, { recursive: true, force: true });
