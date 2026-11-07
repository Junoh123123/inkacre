// 33차 (personal-workspace features). The time machine: the whole workspace at an earlier moment, read-only in a
// tab of its own (pages, sidebar, database views and search as they were), a page brought back to now or taken out
// as a copy, and the way in from 타임머신 and 변경 기록. 빠른 기록: 설정 › 빠른 기록 and the CLI.
// 첨부 파일 내용 검색: files read in the background and found by search. 폴더 미러. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite37.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite37-'));
const port = 8800 + Math.floor(Math.random() * 40) * 20;
const base = `http://127.0.0.1:${port}`;
for (const at of [port, port + 10]) { const busy = await fetch(`http://127.0.0.1:${at}/api/state`).then(() => true, () => false); if (busy) { console.log(`FAIL port ${at} is in use; run again`); process.exit(1); } }
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
process.on('exit', () => { server.kill(); rmSync(folder, { recursive: true, force: true }); });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };

await post([
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'diary', title: '일기', parentId: 'home' },
  { type: 'block.create', id: 'd1', parentId: 'diary', blockType: 'paragraph', richText: [{ text: '처음 쓴 문장' }] },
  { type: 'page.create', id: 'old', title: '지난 메모', parentId: 'home' },
  { type: 'block.create', id: 'o1', parentId: 'old', blockType: 'paragraph', richText: [{ text: '버린 생각' }] },
  { type: 'page.create', id: 'db', title: '할 일', parentId: 'home' },
  { type: 'source.create', id: 's', pageId: 'db', name: '할 일', titlePropertyId: 'title' },
  { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: {} },
  { type: 'property.create', id: 'st', sourceId: 's', name: '상태', propertyType: 'select', options: [{ id: 'open', name: '진행' }] },
  { type: 'page.create', id: 'r1', title: '처음 할 일', sourceId: 's' },
]);
const then = (await state()).revision;
await post([{ type: 'block.update', id: 'd1', richText: [{ text: '나중에 고친 문장' }] }]);
await post([{ type: 'page.update', id: 'r1', title: '바뀐 할 일' }]);
await post([{ type: 'page.create', id: 'later', title: '나중 페이지', parentId: 'home' }]);
await post([{ type: 'node.trash', id: 'old' }]);
const now = (await state()).revision;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource|TIME_MACHINE|타임머신/.test(m.text())) errors.push(`console: ${m.text()}`); });
await context.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const sidebarTitles = () => page.evaluate(() => [...document.querySelectorAll('.sidebar-row[data-tree-id]')].map(e => e.textContent.trim()));

// 1. The way in: the workspace menu's 타임머신 resolves a moment; 변경 기록 links each change to its moment.
await page.goto(`${base}/?id=diary`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: '타임머신' }).first().click(); await page.waitForTimeout(600);
// (Moments are picked by the minute: a minute from now covers every change made so far.)
const soon = await page.evaluate(() => { const date = new Date(Date.now() + 60000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
await page.locator('.time-machine-input').fill(soon); await page.waitForTimeout(600);
const resolved = await page.locator('.time-machine-moment').textContent().catch(() => '');
await page.locator('.dialog .text-button', { hasText: '1시간 전' }).click(); await page.waitForTimeout(600);
const earlier = await page.locator('.time-machine-moment').textContent().catch(() => '');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: '변경 기록' }).first().click(); await page.waitForTimeout(800);
const momentLinks = await page.locator('.history-moment').evaluateAll(links => links.map(link => link.getAttribute('href')));
ok('타임머신 창: 지금은 마지막 변경(버전 ' + now + '), 1시간 전은 "아직 아무것도 없었습니다" · 변경 기록마다 "이 시점 열기"(?at=버전)',
  new RegExp(`버전 ${now}`).test(resolved ?? '') && /아직 아무것도/.test(earlier ?? '') && momentLinks.length >= 5 && momentLinks.some(href => href?.includes(`at=${then}`)),
  `resolved=${resolved} earlier=${earlier} links=${momentLinks.slice(0, 3)}`);
await page.keyboard.press('Escape');

// 2. The past moment: the bar, the page as it was, nothing editable, the sidebar and a database view of then, search.
await page.goto(`${base}/?at=${then}&id=diary`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
const bar = await page.locator('.time-machine-bar').textContent().catch(() => '');
const text = await page.locator('.page-editor').first().textContent().catch(() => '');
const editable = await page.evaluate(() => document.querySelector('.ProseMirror')?.getAttribute('contenteditable'));
await page.goto(`${base}/?at=${then}&id=home`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
const titles = [await page.locator('.page-editor').first().textContent().catch(() => '')];
await page.goto(`${base}/?at=${then}&id=diary`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.locator('.ProseMirror').first().click().catch(() => {}); await page.keyboard.type('추가', { delay: 20 }).catch(() => {}); await page.waitForTimeout(600);
const unchanged = (await obj('d1')).richText[0].text === '나중에 고친 문장' && (await state()).revision === now;
ok('?at=그때 → 시점 막대 · 그때의 본문(처음 쓴 문장) · 편집 불가 · 그때의 하위 페이지(지난 메모 있고 나중 페이지 없음) · 입력해도 지금 자료 그대로',
  /읽기 전용/.test(bar ?? '') && text?.includes('처음 쓴 문장') && editable === 'false' && titles.some(title => title.includes('지난 메모')) && !titles.some(title => title.includes('나중 페이지')) && unchanged,
  `bar=${bar} text=${text?.slice(0, 20)} editable=${editable} titles=${titles}`);
const links = await page.evaluate(() => [...document.querySelectorAll('.sidebar-row[data-tree-id] a, a.sidebar-row')].map(a => a.getAttribute('href')).filter(Boolean).slice(0, 3));
await page.goto(`${base}/?at=${then}&id=db`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
const rows = await page.evaluate(() => [...document.querySelectorAll('.table-row')].map(row => row.textContent));
ok('그때의 데이터베이스 보기(행 제목이 바뀌기 전) · 사이드바 링크도 그 시점(?at)', rows.some(row => row.includes('처음 할 일')) && !rows.some(row => row.includes('바뀐 할 일')) && (links.length === 0 || links.every(href => href.includes('at='))), `rows=${rows} links=${links}`);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await page.waitForTimeout(500);
await page.locator('.search-input').fill('처음 쓴'); await page.waitForTimeout(900);
const found = await page.locator('.search-result, .search-results [role="option"]').allTextContents().catch(() => []);
ok('그 시점에서 검색 → 그때의 글을 찾음', found.some(item => item.includes('일기')), `found=${found.slice(0, 3)}`);
await page.keyboard.press('Escape');

// 3. Bring back: the page's content to now; a page now in the trash comes back; a copy taken out beside it.
await page.goto(`${base}/?at=${then}&id=diary`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.locator('.time-machine-button', { hasText: '지금으로 되살리기' }).click(); await page.waitForTimeout(300);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^되살리기$/ }).last().click(); await page.waitForTimeout(1500);
const restored = (await obj('d1')).richText[0].text, landed = page.url();
ok('지금으로 되살리기 → 지금 페이지의 본문이 그때로(처음 쓴 문장), 지금 화면으로 이동', restored === '처음 쓴 문장' && !landed.includes('at=') && landed.includes('id=diary'), `text=${restored} url=${landed}`);
await page.goto(`${base}/?at=${then}&id=old`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.locator('.time-machine-button', { hasText: '복사본으로 꺼내기' }).click(); await page.waitForTimeout(300);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^꺼내기$/ }).last().click(); await page.waitForTimeout(1500);
const s3 = await state();
const copy = s3.objects.find(item => item.kind === 'page' && item.alive !== false && item.id !== 'old' && /^지난 메모 \(/.test(item.title ?? ''));
const copyText = copy && s3.objects.find(item => item.kind === 'block' && item.parentId === copy.id)?.richText?.[0]?.text;
ok('휴지통에 간 페이지 → 복사본으로 꺼내기: "지난 메모 (시점)" 새 페이지와 그때 본문, 원본은 휴지통에 그대로', !!copy && copyText === '버린 생각' && copy.parentId === 'home' && (await obj('old')).alive === false, `copy=${copy?.title} text=${copyText}`);
await page.goto(`${base}/?at=${then}&id=old`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.locator('.time-machine-button', { hasText: '지금으로 되살리기' }).click(); await page.waitForTimeout(300);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^되살리기$/ }).last().click(); await page.waitForTimeout(1500);
ok('휴지통에 간 페이지 → 지금으로 되살리기: 휴지통에서 돌아옴', (await obj('old')).alive === true);

// 4. 빠른 기록: 설정 › 빠른 기록 makes a capture page, sends a trial line there, shows the calls with this address;
// the CLI (`inkacre capture`) adds a to-do there and a database row by its name and its properties' names.
await page.goto(`${base}/?id=home`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: /^설정$/ }).first().click(); await page.waitForTimeout(400);
await page.locator('.prefs-nav-item', { hasText: '빠른 기록' }).click(); await page.waitForTimeout(300);
const unsetDisabled = await page.locator('.prefs-row', { hasText: '시험 삼아 보내기' }).locator('button').isDisabled();
await page.locator('.prefs-row', { hasText: '기록이 들어갈 페이지' }).locator('button', { hasText: '새로 만들기' }).click(); await page.waitForTimeout(800);
const s4 = await state();
const capturePageId = s4.objects.find(item => item.id === 'workspace-settings')?.capturePageId;
const capturePage = s4.objects.find(item => item.id === capturePageId);
const selected = await page.locator('.prefs-row', { hasText: '기록이 들어갈 페이지' }).locator('select').inputValue();
ok('설정 › 빠른 기록: 처음엔 보내기 비활성 · 새로 만들기 → "빠른 기록" 페이지가 기본 페이지로 정해짐', unsetDisabled && capturePage?.title === '빠른 기록' && selected === capturePageId, `disabled=${unsetDisabled} page=${capturePage?.title} selected=${selected}`);
await page.locator('.prefs-row', { hasText: '시험 삼아 보내기' }).locator('input').fill('설정에서 보낸 줄');
await page.locator('.prefs-row', { hasText: '시험 삼아 보내기' }).locator('input').press('Enter'); await page.waitForTimeout(900);
const bodyOf = async id => (await state()).objects.filter(item => item.kind === 'block' && item.parentId === id && item.alive !== false).sort((x, y) => x.position - y.position).map(item => [item.blockType ?? item.type, (item.richText ?? []).map(run => run.text).join('')]);
const afterTrial = await bodyOf(capturePageId);
const snippets = await page.locator('.capture-snippet pre').allTextContents();
const status = await page.locator('.status-toast, .toast, [role="status"]').allTextContents().catch(() => []);
ok('시험 삼아 보내기(Enter) → 그 페이지 끝에 한 줄 · 터미널/DB/curl/단축어 예시에 이 주소', afterTrial.some(([, line]) => line === '설정에서 보낸 줄') && snippets.length === 4 && snippets.some(code => code.includes(`${base}/api/capture`)) && snippets[0].includes('inkacre capture'),
  `body=${JSON.stringify(afterTrial)} snippets=${snippets.length} status=${status.slice(0, 2)}`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

const { execFileSync } = await import('node:child_process');
const cli = (args, input) => execFileSync(process.execPath, [path.join(root, 'bin/cli.mjs'), 'capture', '--port', String(port), ...args], { input, encoding: 'utf8', env: process.env });
let cliOut = '', cliError = '';
try { cliOut = cli(['--todo', '터미널에서 온 할 일']); cli(['--to', '일기'], '표준 입력 첫 줄\n표준 입력 둘째 줄\n'); } catch (error) { cliError = String(error.stderr || error.message); }
const afterCli = await bodyOf(capturePageId), diaryLines = await bodyOf('diary');
ok('CLI capture --todo → 기본 페이지에 할 일 · --to 일기 + 표준 입력 → 일기에 두 줄', afterCli.at(-1)?.[0] === 'todo' && afterCli.at(-1)?.[1] === '터미널에서 온 할 일' && diaryLines.slice(-2).map(([, line]) => line).join('|') === '표준 입력 첫 줄|표준 입력 둘째 줄',
  `out=${cliOut.trim()} err=${cliError.slice(0, 120)} last=${JSON.stringify(afterCli.at(-1))} diary=${JSON.stringify(diaryLines.slice(-2))}`);
let rowError = '';
try { cli(['--db', '할 일', '--prop', '상태=진행', '터미널에서 온 행']); } catch (error) { rowError = String(error.stderr || error.message); }
const rowObjects = (await state()).objects.filter(item => item.kind === 'page' && item.sourceId === 's' && item.alive !== false), rowsNow = rowObjects.map(item => item.title);
const cliRow = rowObjects.find(item => item.title === '터미널에서 온 행');
let missingError = '';
try { cli(['--to', '없는 페이지', '어디로']); } catch (error) { missingError = String(error.stderr || error.message); }
ok('CLI capture --db "할 일" → 그 데이터베이스에 행 · 없는 페이지는 오류 메시지로 끝남', cliRow?.values?.st === 'open' && /찾을 수 없습니다/.test(missingError),
  `rows=${rowsNow} rowError=${rowError.slice(0, 120)} missing=${missingError.slice(0, 120)}`);

// 5. 첨부 파일 내용 검색: an uploaded PDF and a text file are read in the background; search shows the page with the
// file and a line of it, and the file's line opens the page at that block; 설정 › 일반 shows how many were read.
const { readFileSync } = await import('node:fs');
const upload = async (name, mediaType, bytes) => { const s5 = await state(); const res = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: `up-${name}-${Date.now()}`, actor: 'user', expectedRevision: s5.revision, name, mediaType, base64: bytes.toString('base64') }) }); return (await res.json()).attachmentId; };
const pdfId = await upload('견적.pdf', 'application/pdf', readFileSync(path.join(root, 'test/fixtures/file-text/chromium.pdf')));
const textId = await upload('memo.txt', 'text/plain', Buffer.from('창고 열쇠는 경비실에 맡김'));
await post([
  { type: 'page.create', id: 'files', title: '자료실', parentId: 'home' },
  ...Array.from({ length: 30 }, (_, i) => ({ type: 'block.create', id: `filler-${i}`, parentId: 'files', blockType: 'paragraph', richText: [{ text: `채움 문단 ${i}` }] })),
  { type: 'block.create', id: 'pdf-block', parentId: 'files', blockType: 'pdf', attachmentId: pdfId },
  { type: 'block.create', id: 'text-block', parentId: 'files', blockType: 'file', attachmentId: textId },
]);
let indexStatus = {};
for (let tries = 0; tries < 50; tries++) { indexStatus = await (await fetch(`${base}/api/file-text`)).json(); if (indexStatus.indexed >= 2 && !indexStatus.pending) break; await new Promise(resolve => setTimeout(resolve, 200)); }
await page.goto(`${base}/?id=home`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await page.waitForTimeout(400);
await page.locator('.search-input').fill('삼천만 원'); await page.waitForTimeout(900);
const fileLines = await page.locator('.search-result-file').allTextContents();
const resultTitle = await page.locator('.search-result', { has: page.locator('.search-result-file') }).first().locator('.search-result-title').textContent().catch(() => '');
ok('검색 "삼천만 원" → 자료실 아래 견적.pdf와 그 줄', indexStatus.indexed >= 2 && resultTitle === '자료실' && fileLines.some(line => line.includes('견적.pdf') && line.includes('삼천만 원')), `status=${JSON.stringify(indexStatus)} title=${resultTitle} lines=${fileLines}`);
await page.locator('.search-result-file').first().click(); await page.waitForTimeout(1200);
const landed5 = page.url();
const inView = await page.evaluate(() => { const element = document.querySelector('[data-block-id="pdf-block"]'); if (!element) return false; const box = element.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; });
ok('파일 줄을 누르면 그 페이지의 PDF 블록으로 이동', landed5.includes('id=files') && landed5.includes('#pdf-block') && inView, `url=${landed5} inView=${inView}`);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await page.waitForTimeout(400);
await page.locator('.search-input').fill('경비실'); await page.waitForTimeout(900);
const memoLines = await page.locator('.search-result-file').allTextContents();
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: /^설정$/ }).first().click(); await page.waitForTimeout(400);
await page.locator('.prefs-nav-item', { hasText: '일반' }).click(); await page.waitForTimeout(600);
const statusLine = await page.locator('.prefs-row', { hasText: '첨부 파일 내용 검색' }).locator('.file-text-status').textContent().catch(() => '');
ok('텍스트 파일도 검색(memo.txt) · 설정 › 일반에 "읽을 수 있는 파일 2개 중 2개 색인됨"', memoLines.some(line => line.includes('memo.txt') && line.includes('경비실')) && /2개 중 2개 색인됨/.test(statusLine ?? ''), `memo=${memoLines} status=${statusLine}`);
await page.keyboard.press('Escape');

// 6. 폴더 미러: 설정 › 폴더 미러 refuses a folder with someone's files, turns on for a new one, writes the workspace
// there, follows a change a few seconds later, and turns off leaving the files.
const { existsSync, writeFileSync: writeFile, mkdirSync: makeDir, readFileSync: readFile } = await import('node:fs');
const busyFolder = path.join(folder + '-busy'); makeDir(busyFolder, { recursive: true }); writeFile(path.join(busyFolder, '남의 파일.txt'), 'x');
const mirrorFolder = folder + '-mirror';
process.on('exit', () => { rmSync(busyFolder, { recursive: true, force: true }); rmSync(mirrorFolder, { recursive: true, force: true }); });
await page.goto(`${base}/?id=home`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: /^설정$/ }).first().click(); await page.waitForTimeout(400);
await page.locator('.prefs-nav-item', { hasText: '폴더 미러' }).click(); await page.waitForTimeout(400);
const folderRow = page.locator('.prefs-row', { hasText: /^폴더/ }).first();
await folderRow.locator('input').fill(busyFolder); await folderRow.locator('button', { hasText: '켜기' }).click(); await page.waitForTimeout(600);
const refusal = await page.locator('.mirror-error').textContent().catch(() => '');
await folderRow.locator('input').fill(mirrorFolder); await folderRow.locator('button', { hasText: '켜기' }).click(); await page.waitForTimeout(1200);
const shown = await page.locator('.mirror-folder').textContent().catch(() => '');
const lastNote = await page.locator('.prefs-row', { hasText: '마지막 반영' }).locator('.prefs-row-note').textContent().catch(() => '');
const written = existsSync(path.join(mirrorFolder, '작업 공간.md')) && existsSync(path.join(mirrorFolder, '작업 공간', '일기.md')) && existsSync(path.join(mirrorFolder, '.pageyard-mirror.json'));
ok('폴더 미러: 남의 파일이 있는 폴더는 거절 · 새 폴더로 켜면 워크스페이스가 .md/.csv로 써짐', /비어 있지 않은 폴더/.test(refusal ?? '') && shown === mirrorFolder && /파일 \d+개/.test(lastNote ?? '') && written, `refusal=${refusal} shown=${shown} note=${lastNote} written=${written}`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await post([{ type: 'block.create', id: 'mirror-line', parentId: 'diary', blockType: 'paragraph', richText: [{ text: '미러로 갈 문장' }] }]);
let mirrored = '';
for (let tries = 0; tries < 40 && !mirrored.includes('미러로 갈 문장'); tries++) { await new Promise(resolve => setTimeout(resolve, 250)); try { mirrored = readFile(path.join(mirrorFolder, '작업 공간', '일기.md'), 'utf8'); } catch {} }
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: /^설정$/ }).first().click(); await page.waitForTimeout(400);
await page.locator('.prefs-nav-item', { hasText: '폴더 미러' }).click(); await page.waitForTimeout(400);
await page.locator('.prefs-row', { hasText: /^폴더/ }).first().locator('button', { hasText: '끄기' }).click(); await page.waitForTimeout(600);
const offInput = await page.locator('.prefs-row', { hasText: /^폴더/ }).first().locator('input').count();
ok('바꾼 내용이 몇 초 뒤 폴더 파일에 반영 · 끄면 입력란으로 돌아가고 파일은 남음', mirrored.includes('미러로 갈 문장') && offInput === 1 && existsSync(path.join(mirrorFolder, '작업 공간.md')), `mirrored=${mirrored.slice(0, 80)} offInput=${offInput}`);
await page.keyboard.press('Escape');

ok('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(0);
