// 28차 (coverage phase 7: the remaining options). Sidebar page shortcuts, their order and a full tab reset; ⌃⇧number
// to another workspace; exporting a database's current view; the slash menu's most-used commands; files in bulk edits;
// 💬 on table cells; videos sized and aligned, media download and replace; the link mention hover card; a date
// mention in another time zone; custom emoji as reactions; filling ranges in simple and database tables; a filter for
// every dashboard widget; variables in button actions; PDF tables imported as simple tables; ⌘⇧-click block selection.
// Starts its own server.
// 사용법: node scripts/ux-trace/local-suite34.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { unzipSync, strFromU8 } = createRequire(path.join(root, 'package.json'))('fflate');
const folder = mkdtempSync(path.join(tmpdir(), 'suite34-'));
const port = 7900 + Math.floor(Math.random() * 40) * 20;
const base = `http://127.0.0.1:${port}`;
for (const at of [port, port + 10]) { const busy = await fetch(`http://127.0.0.1:${at}/api/state`).then(() => true, () => false); if (busy) { console.log(`FAIL port ${at} is in use; run again`); process.exit(1); } }
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };
const uploadBytes = async (name, mediaType, bytes) => { const s = await state(); const commandId = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`; const res = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, actor: 'user', expectedRevision: s.revision, name, mediaType, base64: Buffer.from(bytes).toString('base64') }) }); if (!res.ok) throw new Error(await res.text()); return (await res.json()).attachmentId; };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const emoji = await uploadBytes('party.png', 'image/png', png);
const video = await uploadBytes('clip.webm', 'video/webm', Buffer.from('1a45dfa3', 'hex'));
const file = await uploadBytes('notes.txt', 'text/plain', Buffer.from('hello'));
await post([
  { type: 'emoji.set', name: 'party', attachmentId: emoji },
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'target', title: '바로가기 대상', parentId: null },
  { type: 'page.create', id: 'doc', title: '편집 문서', parentId: 'home' },
  { type: 'block.create', id: 'b1', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '첫 줄 ' }, { text: '예시', href: 'https://example.com', mention: true, linkSite: 'Example Site', linkDescription: '예시 사이트의 설명입니다' }] },
  { type: 'block.create', id: 'b2', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '회의 ' }, { text: '11월 3일 9:00', date: '2026-11-03T09:00:00-05:00', dateZone: 'America/New_York' }] },
  { type: 'block.create', id: 'b3', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '셋째 줄' }] },
  { type: 'block.create', id: 'vid', parentId: 'doc', blockType: 'video', attachmentId: video },
  { type: 'block.create', id: 'fil', parentId: 'doc', blockType: 'file', attachmentId: file },
  { type: 'block.create', id: 'tbl', parentId: 'doc', blockType: 'table', cells: [[[{ text: '가' }], [{ text: '1' }]], [[{ text: '나' }], [{ text: '2' }]], [[{ text: '다' }], [{ text: '3' }]]] },
  { type: 'comment.create', id: 'cm', parentId: 'b3', richText: [{ text: '확인' }], reactions: [`attachment:${emoji}`] },
  { type: 'page.create', id: 'db', title: '작업', parentId: 'home' },
  { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 'title' },
  { type: 'property.create', id: 'n', sourceId: 's', name: '점수', propertyType: 'number' },
  { type: 'property.create', id: 'note', sourceId: 's', name: '메모', propertyType: 'text' },
  { type: 'property.create', id: 'att', sourceId: 's', name: '첨부', propertyType: 'files' },
  { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '전체', viewType: 'table', config: { visibleProperties: ['title', 'n', 'note'] } },
  { type: 'view.create', id: 'big', sourceId: 's', parentId: 'db', name: '큰 점수', viewType: 'table', config: { visibleProperties: ['title', 'n', 'note'], filter: { propertyId: 'n', op: 'gt', value: 5 } } },
  { type: 'page.create', id: 'r1', title: '하나', sourceId: 's' }, { type: 'value.set', pageId: 'r1', propertyId: 'n', value: 3 }, { type: 'value.set', pageId: 'r1', propertyId: 'note', value: '복사할 메모' },
  { type: 'page.create', id: 'r2', title: '둘', sourceId: 's' }, { type: 'value.set', pageId: 'r2', propertyId: 'n', value: 9 },
  { type: 'page.create', id: 'r3', title: '셋', sourceId: 's' }, { type: 'value.set', pageId: 'r3', propertyId: 'n', value: 7 },
  { type: 'page.create', id: 'db2', title: '기록', parentId: 'home' },
  { type: 'source.create', id: 's2', pageId: 'db2', name: '기록', titlePropertyId: 'title2' },
  { type: 'property.create', id: 'n2', sourceId: 's2', name: '점수', propertyType: 'number' },
  { type: 'view.create', id: 'v2', sourceId: 's2', parentId: 'db2', name: '표', viewType: 'table', config: {} },
  { type: 'page.create', id: 'q1', title: '낮음', sourceId: 's2' }, { type: 'value.set', pageId: 'q1', propertyId: 'n2', value: 1 },
  { type: 'page.create', id: 'q2', title: '높음', sourceId: 's2' }, { type: 'value.set', pageId: 'q2', propertyId: 'n2', value: 8 },
  { type: 'view.create', id: 'dash', sourceId: 's', parentId: 'db', name: '대시보드', viewType: 'dashboard', config: { widgets: ['v', 'v2'] } },
]);
await post([{ type: 'page.update', id: 'db', databasePage: true }, { type: 'page.update', id: 'db2', databasePage: true }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource|MEDIA_ERR|DEMUXER|Format error/.test(m.text())) errors.push(`console: ${m.text()}`); });
await context.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(350); };
const blockEl = id => page.locator(`.block[data-block-id="${id}"]`);

// 1. Sidebar: a page shortcut (사이드바 사용자 지정 › 바로가기 추가 › 페이지), dragged above 홈; 탭 초기화 brings the defaults back.
await open('home');
await page.locator('.sidebar-tab.selected').click(); await page.waitForTimeout(250);
await clickMenu('사이드바 사용자 지정');
await page.locator('.sidebar-add', { hasText: '바로가기 추가' }).click(); await page.waitForTimeout(250);
await clickMenu('페이지');
await page.locator('.picker-popover input').fill('바로가기 대상'); await page.waitForTimeout(400);
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const topRows = async () => page.evaluate(() => [...document.querySelectorAll('[data-customize-top] [data-top-id]')].map(e => e.querySelector('.sidebar-row-label')?.textContent));
const beforeDrag = await topRows();
const linkRow = page.locator('[data-customize-top] [data-top-id]').filter({ hasText: '바로가기 대상' });
const homeRow = page.locator('[data-customize-top] [data-top-id="home"]');
const from = await linkRow.boundingBox(), to = await homeRow.boundingBox();
await page.mouse.move(from.x + 60, from.y + from.height / 2); await page.mouse.down();
await page.mouse.move(from.x + 60, from.y - 10, { steps: 4 }); await page.mouse.move(to.x + 60, to.y + 4, { steps: 8 }); await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(400);
const afterDrag = await topRows();
await page.locator('.sidebar-done-button').click(); await page.waitForTimeout(300);
const shortcut = page.locator('.sidebar-link-shortcut', { hasText: '바로가기 대상' });
const shown = await shortcut.count();
await shortcut.click(); await page.waitForTimeout(600);
const went = new URL(page.url()).searchParams.get('id');
await page.locator('.sidebar-tab.selected').click(); await page.waitForTimeout(250);
await clickMenu('탭 초기화'); await page.waitForTimeout(300);
const afterReset = await page.locator('.sidebar-link-shortcut').count();
ok('사이드바: 페이지 바로가기 추가 → 끌어서 홈 위로 → 누르면 그 페이지, 탭 초기화로 기본값', beforeDrag.at(-1) === '바로가기 대상' && afterDrag[0] === '바로가기 대상' && shown === 1 && went === 'target' && afterReset === 0,
  `before=${beforeDrag} after=${afterDrag} shown=${shown} went=${went} reset=${afterReset}`);

// 2. ⌃⇧2 opens the second workspace.
const created = await (await fetch(`${base}/api/workspaces/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '둘째' }) })).json();
await open('home');
await page.keyboard.press('Control+Shift+Digit2');
await page.waitForURL(url => url.toString().startsWith(created.url), { timeout: 5000 }).catch(() => {});
ok('⌃⇧2 → 둘째 워크스페이스 주소로', page.url().startsWith(created.url), page.url());

// 3. Export from a database page shows its current view (the tab picked there).
await open('db');
await page.locator('.db-tabs .db-tab[role="tab"]', { hasText: '큰 점수' }).click(); await page.waitForTimeout(500);
await page.locator('.topbar button[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300);
await clickMenu('더 보기'); await clickMenu('내보내기'); await page.waitForTimeout(400);
const scope = await page.evaluate(() => { const select = [...document.querySelectorAll('select.export-select')].find(item => [...item.options].some(option => option.textContent === '현재 보기')); return select ? { value: select.value, disabled: select.querySelector('option[value="current"]')?.disabled } : null; });
const download = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^내보내기$/ }).last().click();
const saved = await download;
let csv = '';
if (saved) { const bytes = readFileSync(await saved.path()); try { const files = unzipSync(new Uint8Array(bytes)); csv = Object.entries(files).filter(([name]) => name.endsWith('.csv')).map(([, data]) => strFromU8(data)).join('\n'); } catch { csv = bytes.toString('utf8'); } }
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('DB 내보내기: 고른 탭이 "현재 보기"로 선택되고 그 필터대로(점수 > 5만)', scope?.value === 'current' && scope.disabled === false && csv.includes('둘') && csv.includes('셋') && !csv.includes('하나'), `${JSON.stringify(scope)} saved=${!!saved}`);

// 4. Slash menu: the last used first, then the most used.
await open('doc');
const slash = async query => { await blockEl('b3').locator('.block-text, p').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type(`/${query}`); await page.waitForTimeout(350); await page.keyboard.press('Enter'); await page.waitForTimeout(350); await page.keyboard.press('Escape'); };
for (let i = 0; i < 3; i++) await slash('할 일');
await slash('인용');
await blockEl('b3').locator('.block-text, p').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/'); await page.waitForTimeout(400);
const suggested = await page.evaluate(() => [...document.querySelectorAll('.slash-menu .slash-group')][0] ? [...[...document.querySelectorAll('.slash-menu .slash-group')][0].querySelectorAll('.slash-item-label')].map(e => e.textContent) : []);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('/ 추천: 방금 쓴 인용 다음에 자주 쓴 할 일 목록', /인용/.test(suggested[0] ?? '') && /할 일/.test(suggested[1] ?? ''), suggested.join(','));

// 5. Bulk edit lists files; 6. 💬 on a table cell.
await open('db');
await page.locator('.db-tabs .db-tab[role="tab"]', { hasText: '전체' }).click(); await page.waitForTimeout(500);
await page.evaluate(() => { for (const box of [...document.querySelectorAll('.table-row .row-check input')].slice(0, 2)) box.click(); });
await page.waitForTimeout(300);
await page.locator('.selection-action.labeled').click(); await page.waitForTimeout(300);
const bulk = await menuItems();
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('여러 행 › 속성 편집에 파일과 미디어(첨부)도', bulk.includes('첨부'), bulk.join(','));
const noteCell = page.locator('.table-row', { hasText: '하나' }).locator('.table-cell.type-text').first();
await noteCell.click({ button: 'right' }); await page.waitForTimeout(400);
await clickMenu('메모에 댓글 달기'); await page.waitForTimeout(400);
const commentBox = page.locator('.property-comments textarea, .property-comments [contenteditable="true"], .property-comments input').first();
await commentBox.fill('셀에서 단 댓글'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const cellComment = (await state()).objects.find(o => o.kind === 'comment' && o.parentId === 'r1' && o.propertyId === 'note');
const badge = await page.locator('.table-row', { hasText: '하나' }).locator('.cell-comment.has').textContent().catch(() => '');
ok('표 셀 오른쪽 클릭 › "메모에 댓글 달기" → 그 속성 값 댓글, 셀에 💬 개수', !!cellComment && /1/.test(badge), `comment=${!!cellComment} badge=${badge}`);

// 13. Fill in a database table: the range from the top row down.
const cellOf = (title, type) => page.locator('.table-row', { hasText: title }).locator(`.table-cell.type-${type}`).first();
await page.keyboard.press('Escape');
await cellOf('하나', 'text').click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(250);
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
await cellOf('셋', 'text').click({ modifiers: ['Shift'], position: { x: 5, y: 5 } }); await page.waitForTimeout(200);
await page.keyboard.press('Control+d'); await page.waitForTimeout(800);
const filled = [(await obj('r2')).values.note, (await obj('r3')).values.note];
ok('DB 표: 범위 고르고 ⌃D → 맨 위 값으로 아래 칸 채움', filled.every(value => value === '복사할 메모'), JSON.stringify(filled));

// 14. Dashboard: a filter for every widget, applied by property name in the other source.
await open('dash');
await page.locator('.dashboard-shared-filter').click(); await page.waitForTimeout(300);
const sharedChip = await page.locator('.dashboard-filter').count();
await page.keyboard.press('Escape');
await post([{ type: 'view.update', id: 'dash', config: { ...(await obj('dash')).config, dashboardShared: { sourceId: 's', filter: { propertyId: 'n', op: 'gt', value: 5 } } } }]); await page.waitForTimeout(1000);
const widgetTitles = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(widget => [...widget.querySelectorAll('.table-row .title-text')].map(e => e.textContent).join('/')));
ok('대시보드 "모든 위젯" 필터: 두 데이터 소스 모두 점수 > 5만', sharedChip === 1 && widgetTitles[0] === '둘/셋' && widgetTitles[1] === '높음', JSON.stringify(widgetTitles));

// 7–12, 16. Editor: video, file, link card, date zone, custom reactions, simple table fill, ⌘⇧-click.
await open('doc');
const videoFrame = blockEl('vid').locator('.media-frame');
await videoFrame.hover(); await page.waitForTimeout(200);
const videoTools = await blockEl('vid').locator('.media-actions').evaluate(e => [...e.querySelectorAll('button, a')].map(x => x.getAttribute('aria-label') || x.textContent));
await blockEl('vid').locator('.media-actions button[aria-label="정렬"]').click(); await page.waitForTimeout(250);
await clickMenu('오른쪽 정렬'); await page.waitForTimeout(600);
const handle = blockEl('vid').locator('.image-handle.left');
await videoFrame.hover();
const hb = await handle.boundingBox();
await page.mouse.move(hb.x + 3, hb.y + 10); await page.mouse.down(); await page.mouse.move(hb.x + 203, hb.y + 10, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(700);
const vidBlock = await obj('vid');
ok('동영상: 다운로드 · 바꾸기 · 원본 · 정렬, 오른쪽 정렬과 너비 조절이 저장', vidBlock.align === 'right' && vidBlock.width > 100 && vidBlock.width < 700 && videoTools.includes('다운로드') && videoTools.includes('바꾸기') && videoTools.includes('원본'),
  `tools=${videoTools} align=${vidBlock.align} width=${vidBlock.width}`);
await blockEl('fil').locator('.file-block').hover(); await page.waitForTimeout(200);
const fileTools = await blockEl('fil').locator('.media-actions').evaluate(e => ({ shown: getComputedStyle(e).opacity, items: [...e.querySelectorAll('button, a')].map(x => x.getAttribute('aria-label') || x.textContent), download: e.querySelector('a[download]')?.getAttribute('download') }));
ok('파일 블록: 가리키면 다운로드 · 바꾸기 · 원본', fileTools.shown === '1' && fileTools.items.includes('바꾸기') && fileTools.download === 'notes.txt', JSON.stringify(fileTools));

await blockEl('b1').locator('.link-mention').hover(); await page.waitForTimeout(800);
const card = await page.locator('.link-mention-card').textContent().catch(() => '');
await page.mouse.move(10, 10); await page.waitForTimeout(400);
const cardGone = await page.locator('.link-mention-card').count();
ok('링크 멘션에 머물면 카드(사이트 · 제목 · 설명 · 주소), 벗어나면 닫힘', /Example Site/.test(card) && /예시 사이트의 설명입니다/.test(card) && /example\.com/.test(card) && cardGone === 0, card);

const dateText = await blockEl('b2').locator('.date-mention').textContent();
await blockEl('b2').locator('.date-mention').click(); await page.waitForTimeout(400);
const zoneSelect = await page.locator('.date-mention-editor select[aria-label="시간대"]').inputValue().catch(() => '');
await page.locator('.date-mention-editor select[aria-label="시간대"]').selectOption('Asia/Tokyo'); await page.waitForTimeout(500);
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
const run = (await obj('b2')).richText.find(r => r.date);
ok('날짜 멘션 시간대: 뉴욕 9:00으로 표시, 고르면 도쿄로 바뀌고 시차가 저장', /9:00/.test(dateText) && /New York/.test(dateText) && zoneSelect === 'America/New_York' && run?.dateZone === 'Asia/Tokyo' && /\+09:00$/.test(run?.date ?? ''),
  `text=${dateText} select=${zoneSelect} run=${JSON.stringify(run)}`);

const reactionImg = await page.locator('img.custom-emoji-reaction').count();
ok('사용자 지정 이모지 반응이 그림으로', reactionImg >= 1, `imgs=${reactionImg}`);

const tableCell = (r, c) => blockEl('tbl').locator('tr').nth(r).locator('.simple-table-text').nth(c);
await tableCell(0, 1).click(); await page.waitForTimeout(200);
await tableCell(2, 1).click({ modifiers: ['Shift'] }); await page.waitForTimeout(200);
const inRange = await blockEl('tbl').locator('.simple-table-cell.in-range').count();
await page.keyboard.press('Control+d'); await page.waitForTimeout(900);
const cells = (await obj('tbl')).cells.map(row => row.map(cell => cell.map(r => r.text).join('')));
ok('단순 표: Shift-클릭으로 범위(3칸) → ⌃D로 맨 위 값 채움', inRange === 3 && cells[1][1] === '1' && cells[2][1] === '1' && cells[0][0] === '가', `range=${inRange} cells=${JSON.stringify(cells)}`);

await page.keyboard.press('Escape');
await blockEl('b1').click({ modifiers: ['Meta', 'Shift'], position: { x: 20, y: 8 } }); await page.waitForTimeout(200);
await blockEl('b3').click({ modifiers: ['Meta', 'Shift'], position: { x: 20, y: 8 } }); await page.waitForTimeout(200);
const picked = await page.evaluate(() => [...document.querySelectorAll('.block.block-selected, .block.selected')].map(e => e.dataset.blockId));
await blockEl('b1').click({ modifiers: ['Meta', 'Shift'], position: { x: 20, y: 8 } }); await page.waitForTimeout(200);
const afterToggle = await page.evaluate(() => [...document.querySelectorAll('.block.block-selected, .block.selected')].map(e => e.dataset.blockId));
await page.keyboard.press('Escape');
ok('⌘⇧-클릭: 블록을 선택에 넣고 다시 누르면 뺌', picked.includes('b1') && picked.includes('b3') && !picked.includes('b2') && !afterToggle.includes('b1') && afterToggle.includes('b3'), `picked=${picked} after=${afterToggle}`);

// 15. A button with 변수 정의: the action list offers it and its value can come from a variable.
await post([{ type: 'block.create', id: 'btn', parentId: 'doc', blockType: 'button', button: { label: '변수 버튼', actions: [{ action: 'define_variables', variables: [{ id: 'x', name: '기준', mode: 'formula', value: '2 * 5' }] }, { action: 'edit_pages', sourceId: 's', filter: { propertyId: 'n', op: 'gt', value: 0 }, propertyId: 'n', value: { $variable: 'x' } }] } }]);
await open('doc');
await blockEl('btn').locator('button').first().click(); await page.waitForTimeout(900);
const varied = [(await obj('r1')).values.n, (await obj('r2')).values.n];
ok('버튼의 변수 정의 → 조건에 맞는 페이지 편집 값으로', varied.every(value => value === 10), JSON.stringify(varied));

// 16. A PDF with a table: the rows become a simple table.
const maker = await context.newPage();
await maker.setContent('<html><body style="font: 12px sans-serif"><h1>Quarter report</h1><p>Intro paragraph text.</p><table style="border-collapse: collapse" cellpadding="6"><tr><td>Item</td><td>Count</td><td>Owner</td></tr><tr><td>Apples</td><td>12</td><td>Kim</td></tr><tr><td>Pears</td><td>7</td><td>Lee</td></tr></table><p>Closing words.</p></body></html>');
const pdf = await maker.pdf({ format: 'A4' });
await maker.close();
await open('home');
await page.locator('.topbar button[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300);
await clickMenu('더 보기'); await clickMenu('가져오기'); await page.waitForTimeout(300);
await page.locator('input[type="file"]').setInputFiles({ name: 'quarter.pdf', mimeType: 'application/pdf', buffer: pdf });
await page.waitForTimeout(1800);
await page.locator('button', { hasText: '미리보기' }).click().catch(() => {}); await page.waitForTimeout(800);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^가져오기$/ }).last().click().catch(() => {}); await page.waitForTimeout(1500);
const s16 = await state();
const pdfPage = s16.objects.find(o => o.kind === 'page' && o.title === 'quarter' && o.alive !== false);
const pdfTable = pdfPage ? s16.objects.find(o => o.kind === 'block' && o.parentId === pdfPage.id && o.blockType === 'table') : null;
const tableText = pdfTable ? pdfTable.cells.map(row => row.map(cell => cell.map(r => r.text).join('')).join('|')).join(' / ') : '';
ok('PDF 가져오기: 표가 단순 표로(3행 3열)', pdfTable?.cells.length === 3 && pdfTable.cells[0].length === 3 && /Apples\|12\|Kim/.test(tableText), tableText || `page=${!!pdfPage}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
