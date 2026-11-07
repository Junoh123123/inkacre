// 22차 (coverage phase 1): settings that showed but did nothing, and small options that were missing.
// List and gallery draw groups; "a. " / "i. " lists and 목록 형식; "/red"; recent slash commands first; words in the
// page menu; \ce chemistry; number bars; ID prefixes (shown, searched, opened by address); timeline quarter zoom,
// property columns, row dragging and load limit; icon-only tabs and tab dragging; template ⋯ 복제; settings and
// property search; sidebar width, 최종 편집 sort and dragging to the trash; form icon / submit words; files
// reordering; chart colour by value and PNG copy; a button opening a URL. Starts its own server on an empty folder.
// 사용법: node scripts/ux-trace/local-suite28.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite28-'));
const port = 5400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };
const attach = async (name, text) => { const s = await state(); const res = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: `a-${Math.random()}`, actor: 'test', expectedRevision: s.revision, name, mediaType: 'text/plain', base64: Buffer.from(text).toString('base64') }) }); return (await res.json()).attachmentId; };
const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

await post([
  { type: 'page.create', id: 'doc', title: '문서', parentId: null },
  { type: 'block.create', id: 'doc-b1', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '하나 둘 셋' }] },
  { type: 'block.create', id: 'doc-b2', parentId: 'doc', blockType: 'paragraph', richText: [] },
  { type: 'block.create', id: 'doc-btn', parentId: 'doc', blockType: 'button', button: { label: '열기 단추', actions: [{ action: 'open_url', url: `${base}/?opened=1` }] } },
  { type: 'page.create', id: 'db', title: '목록 DB', parentId: null },
  { type: 'source.create', id: 's', pageId: 'db', name: '목록 DB', titlePropertyId: 's-t' },
  { type: 'property.create', id: 's-k', sourceId: 's', name: '분류', propertyType: 'select', options: [{ id: 'oa', name: '가', color: 'blue' }, { id: 'ob', name: '나', color: 'green' }] },
  { type: 'property.create', id: 's-n', sourceId: 's', name: '점수', propertyType: 'number', numberFormat: { style: 'number', display: 'bar', color: 'blue' } },
  { type: 'property.create', id: 's-id', sourceId: 's', name: 'ID', propertyType: 'unique_id', idPrefix: 'TASK' },
  { type: 'property.create', id: 's-d', sourceId: 's', name: '일정', propertyType: 'date' },
  { type: 'property.create', id: 's-f', sourceId: 's', name: '파일', propertyType: 'files' },
  { type: 'view.create', id: 'v-table', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: {} },
  { type: 'view.create', id: 'v-list', sourceId: 's', parentId: 'db', name: '리스트', viewType: 'list', config: { groupBy: 's-k' } },
  { type: 'view.create', id: 'v-gal', sourceId: 's', parentId: 'db', name: '갤러리', viewType: 'gallery', config: { groupBy: 's-k' } },
  { type: 'view.create', id: 'v-time', sourceId: 's', parentId: 'db', name: '타임라인', viewType: 'timeline', config: { datePropertyId: 's-d', timelineZoom: 'quarter', loadLimit: 10 } },
  { type: 'view.create', id: 'v-chart', sourceId: 's', parentId: 'db', name: '차트', viewType: 'chart', config: { chart: { groupBy: 's-t', valuePropertyId: 's-n', aggregation: 'sum', type: 'bar', palette: 'blue', colorByValue: true } } },
  { type: 'view.create', id: 'v-form', sourceId: 's', parentId: 'db', name: '양식', viewType: 'form', config: { form: { title: '신청', icon: '📝', submitLabel: '보내기', confirmation: '고마워요', questions: [{ propertyId: 's-t' }] } } },
  ...Array.from({ length: 12 }, (_, i) => [
    { type: 'page.create', id: `r${i}`, title: `행 ${i}`, sourceId: 's' },
    { type: 'value.set', pageId: `r${i}`, propertyId: 's-k', value: i % 2 ? 'ob' : 'oa' },
    { type: 'value.set', pageId: `r${i}`, propertyId: 's-n', value: i === 0 ? 30 : (i + 1) * 7 },
    { type: 'value.set', pageId: `r${i}`, propertyId: 's-d', value: { start: day(i * 3), end: day(i * 3 + 2) } },
  ]).flat(),
  { type: 'page.create', id: 'tpl', title: '회의 양식', sourceId: 's', template: true },
  { type: 'page.create', id: 'p-old', title: '오래된 페이지', parentId: null },
  { type: 'page.create', id: 'p-trash', title: '버릴 페이지', parentId: null },
]);
const fa = await attach('a.txt', 'A'), fb = await attach('b.txt', 'B');
await post([{ type: 'value.set', pageId: 'r0', propertyId: 's-f', value: [fa, fb] }, { type: 'page.update', id: 'p-old', title: '오래된 페이지 (고침)' }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(250); };

// 1. List and gallery draw their groups.
await open('v-list');
const listGroups = await page.evaluate(() => [...document.querySelectorAll('.view-group')].map(g => `${g.querySelector('.table-group-head')?.textContent?.replace(/\s+/g, '')}:${g.querySelectorAll('.list-row').length}`));
await open('v-gal');
const galleryGroups = await page.evaluate(() => [...document.querySelectorAll('.view-group')].map(g => g.querySelectorAll('.row-card').length));
ok('리스트 · 갤러리 보기가 그룹(가 · 나)으로 나뉘어 그려짐', listGroups.length === 2 && listGroups[0].includes(':6') && galleryGroups.join(',') === '6,6', `list=${listGroups} gallery=${galleryGroups}`);

// 2. Number bar, ID prefix, open by address.
await open('v-table');
const bar = await page.evaluate(() => { const fill = document.querySelector('.number-bar .bar-fill'); return fill ? fill.style.width : null; });
const ids = await page.evaluate(() => [...document.querySelectorAll('.unique-id')].map(e => e.textContent).slice(0, 3).join(','));
await page.goto(`${base}/?id=TASK-3`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
const openedTitle = await page.evaluate(() => document.querySelector('.page-title')?.textContent);
const openedUrl = page.url();
ok('숫자 막대(30 → 30%), ID에 접두사(TASK-1…), 주소 ?id=TASK-3 → 세 번째 행이 열림', bar === '30%' && ids.startsWith('TASK-1') && openedTitle === '행 2' && openedUrl.includes('id=r2'), `bar=${bar} ids=${ids} opened=${openedTitle} ${openedUrl.split('?')[1]}`);

// 3. Search finds TASK-5 by ID.
await page.keyboard.press('Control+K'); await page.waitForTimeout(300);
await page.keyboard.type('task-5'); await page.waitForTimeout(700);
const searchHit = await page.evaluate(() => [...document.querySelectorAll('.search-result, .search-results [role="option"], .search-item')].map(e => e.textContent).join('|'));
await page.keyboard.press('Escape');
ok('검색에 "task-5" → 행 4', searchHit.includes('행 4'), searchHit.slice(0, 80));

// 4. Timeline: quarter zoom (7 levels), side table columns, load limit 10 of 12, row dragging.
await open('v-time');
await page.locator('.timeline-zoom').click(); await page.waitForTimeout(200);
const zooms = await menuItems(); await page.keyboard.press('Escape');
await page.locator('.timeline-toolbar-left .icon-button').first().click(); await page.waitForTimeout(400);
const heads = await page.evaluate(() => [...document.querySelectorAll('.timeline-table-head .timeline-table-cell')].map(e => e.textContent).join(','));
const shown = await page.evaluate(() => document.querySelectorAll('.timeline-table-row').length);
const more = await page.evaluate(() => document.querySelector('.timeline-more')?.textContent ?? '');
const rows = page.locator('.timeline-table-row');
const first = await rows.nth(0).boundingBox(), third = await rows.nth(2).boundingBox();
await page.mouse.move(first.x + 40, first.y + 18); await page.mouse.down(); await page.mouse.move(first.x + 40, first.y + 40, { steps: 3 }); await page.mouse.move(first.x + 40, third.y + 30, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(800);
const order = await page.evaluate(() => [...document.querySelectorAll('.timeline-table-row .timeline-table-title')].map(e => e.textContent).slice(0, 3).join(','));
ok('타임라인: 확대 7단계(…분기 · 연), 옆 표에 속성 열, 10개 + "더 불러오기 (2)", 행을 끌어 순서 바꿈', zooms.join(',').includes('분기') && zooms.includes('연') && zooms.length === 7 && heads.includes('점수') && shown === 10 && /2/.test(more) && order.startsWith('행 1,행 2,행 0'), `zooms=${zooms} heads=${heads} shown=${shown} more=${more} order=${order}`);

// 5. Tabs: icon only, then drag 리스트 before 표.
await open('v-table');
await page.locator('.db-tabs .db-tab[role="tab"]', { hasText: '표' }).first().click(); await page.waitForTimeout(250);
await clickMenu('탭 표시 방식'); await page.waitForTimeout(250); await clickMenu('아이콘만'); await page.waitForTimeout(600);
const iconOnly = await page.evaluate(() => { const tab = [...document.querySelectorAll('.db-tabs .db-tab[role="tab"]')][0]; return tab ? `${tab.querySelectorAll('span').length}:${tab.getAttribute('title')}` : null; });
const tabs = page.locator('.db-tabs .db-tab[role="tab"]');
const tabList = await tabs.nth(1).boundingBox(), tabTable = await tabs.nth(0).boundingBox();
await page.mouse.move(tabList.x + tabList.width / 2, tabList.y + 10); await page.mouse.down(); await page.mouse.move(tabList.x - 10, tabList.y + 10, { steps: 4 }); await page.mouse.move(tabTable.x + 4, tabTable.y + 10, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(800);
const tabOrder = await page.evaluate(() => [...document.querySelectorAll('.db-tabs .db-tab[role="tab"]')].map(e => e.textContent || e.getAttribute('aria-label')).slice(0, 2).join(','));
ok('보기 탭: "아이콘만"이면 글자 없이(이름은 제목), 탭을 끌어 리스트를 표 앞으로', iconOnly === '0:표' && tabOrder === '리스트,표', `iconOnly=${iconOnly} order=${tabOrder}`);

// 6. Template ⋯ 복제 keeps a template.
await page.locator('.db-new-arrow, .db-new-menu, [aria-label="템플릿 선택"], .new-button-arrow').first().click().catch(() => {});
await page.waitForTimeout(300);
let templateRows = await page.locator('.template-row-more').count();
if (!templateRows) { await page.locator('button', { hasText: '새로 만들기' }).locator('xpath=following-sibling::button[1]').click().catch(() => {}); await page.waitForTimeout(300); templateRows = await page.locator('.template-row-more').count(); }
await page.locator('.template-row-more').first().click(); await page.waitForTimeout(250);
const templateMenu = await menuItems();
await clickMenu('복제'); await page.waitForTimeout(800);
const templates = (await state()).objects.filter(o => o.kind === 'page' && o.template && o.alive !== false && o.sourceId === 's').length;
await page.keyboard.press('Escape');
ok('템플릿 ⋯ [기본값으로 설정 · 편집 · 복제 · 삭제] → 복제해도 템플릿 2개', templateMenu.slice(-4).join(',') === '기본값으로 설정,편집,복제,삭제' && templates === 2, `menu=${templateMenu} templates=${templates}`);

// 7. Property search in 보기 설정 › 속성.
await open('v-table');
await page.locator('.db-tool-settings').click(); await page.waitForTimeout(300);
await page.locator('.settings-row', { hasText: '속성' }).first().click(); await page.waitForTimeout(300);
await page.locator('.settings-search input').fill('점'); await page.waitForTimeout(200);
const props = await page.evaluate(() => [...document.querySelectorAll('.property-toggle .settings-row-label')].map(e => e.textContent).join(','));
await page.keyboard.press('Escape');
ok('보기 설정 › 속성 검색 "점" → 점수만', props === '점수', props);

// 8. Editor: "a. " list, 목록 형식 › 로마 숫자, "/red", recent first, words in the page menu, \ce.
await open('doc');
await page.locator('[data-block-id="doc-b2"]').click();
await page.keyboard.type('a. 첫 항목'); await page.keyboard.press('Enter'); await page.keyboard.type('둘째 항목'); await page.waitForTimeout(400);
const letters = await page.evaluate(() => [...document.querySelectorAll('.page-editor [data-block-type="numbered"]')].map(e => getComputedStyle(e, '::before').content !== 'none' ? (e.querySelector('.list-marker')?.textContent ?? e.dataset.marker ?? '') : '').join(','));
const markerText = await page.evaluate(() => [...document.querySelectorAll('.page-editor [data-block-type="numbered"] .block-marker, .page-editor [data-block-type="numbered"] .list-marker, .page-editor [data-block-type="numbered"] [class*="marker"]')].map(e => e.textContent).join(','));
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
const numbered = page.locator('.page-editor [data-block-type="numbered"]').first();
const nbox = await numbered.boundingBox();
await page.mouse.move(nbox.x + 30, nbox.y + nbox.height / 2); await page.waitForTimeout(250);
await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(300);
await clickMenu('목록 형식'); await page.waitForTimeout(300); await clickMenu('로마 숫자'); await page.waitForTimeout(600);
const romanText = await page.evaluate(() => [...document.querySelectorAll('.page-editor [data-block-type="numbered"] [class*="marker"]')].map(e => e.textContent).join(','));
const saved = (await state()).objects.filter(o => o.kind === 'block' && o.parentId === 'doc' && o.blockType === 'numbered').map(o => o.listFormat).join(',');
ok('"a. "로 문자 목록(a., b.), 블록 메뉴 목록 형식 › 로마 숫자 → i., ii. (둘 다 저장)', markerText === 'a.,b.' && romanText === 'i.,ii.' && saved === 'roman,roman', `before=${markerText || letters} after=${romanText} saved=${saved}`);

await page.locator('.page-editor [data-block-type="numbered"]').last().click(); await page.keyboard.press('End');
await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
await page.keyboard.type('빨강 줄'); await page.keyboard.press('Home'); await page.keyboard.type('/red'); await page.waitForTimeout(400);
const redItems = await page.evaluate(() => [...document.querySelectorAll('.slash-menu .slash-item-label')].map(e => e.textContent).slice(0, 2).join(','));
await page.keyboard.press('Enter'); await page.waitForTimeout(700);
const redBlock = (await state()).objects.find(o => o.kind === 'block' && o.parentId === 'doc' && JSON.stringify(o.richText).includes('빨강 줄'));
await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/'); await page.waitForTimeout(400);
const firstSuggested = await page.evaluate(() => document.querySelector('.slash-menu .slash-group .slash-item-label')?.textContent);
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
ok('"/red" → 빨간색 텍스트 · 빨간색 배경, 고르면 블록 색, 다음 "/"의 추천 맨 앞에 방금 쓴 명령', redItems.startsWith('빨간색 텍스트') && redBlock?.color === 'red' && firstSuggested === '빨간색 텍스트', `items=${redItems} color=${redBlock?.color} first=${firstSuggested}`);

await page.locator('[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300);
const count = await page.evaluate(() => document.querySelector('.page-menu-count')?.textContent);
await page.keyboard.press('Escape');
ok('페이지 ⋯ 아래에 단어 수와 글자 수', /단어/.test(count ?? '') && /자/.test(count ?? ''), count);

await post([{ type: 'block.create', id: 'doc-math', parentId: 'doc', blockType: 'math', richText: [{ text: '\\ce{2H2 + O2 -> 2H2O}' }] }]);
await open('doc'); await page.waitForTimeout(1200);
const chem = await page.evaluate(() => { const el = document.querySelector('[data-block-id="doc-math"]'); return el ? `${!!el.querySelector('.katex')}:${!!el.querySelector('.math-error')}` : null; });
ok('수식 블록의 \\ce{…} 화학식이 그려짐(오류 표시 없음)', chem === 'true:false', chem);

// 9. A button that opens a URL opens a new tab.
const popup = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
await page.locator('[data-block-id="doc-btn"] .button-block-run').click();
const opened = await popup;
ok('버튼 작업 "URL 열기" → 새 탭', !!opened && opened.url().includes('opened=1'), opened?.url() ?? 'none');
if (opened) await opened.close();

// 10. Settings search finds a setting by name.
await page.keyboard.press('Control+,').catch(() => {}); await page.waitForTimeout(400);
if (!(await page.locator('.prefs-modal').count())) { await page.locator('.workspace-switcher').click(); await page.waitForTimeout(200); await clickMenu('설정'); await page.waitForTimeout(400); }
await page.locator('.prefs-search input').fill('월요일'); await page.waitForTimeout(300);
const match = await page.evaluate(() => [...document.querySelectorAll('.prefs-nav-match-label')].map(e => e.textContent).join(','));
await page.locator('.prefs-nav-match').first().click(); await page.waitForTimeout(300);
const found = await page.evaluate(() => document.querySelector('.prefs-row-found')?.dataset.label);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('설정 검색 "월요일" → "한 주의 시작을 월요일로" 항목, 누르면 그 줄이 표시됨', match.includes('한 주의 시작을 월요일로') && found === '한 주의 시작을 월요일로', `match=${match} found=${found}`);

// 11. Sidebar: width by dragging the edge, 개인 페이지 정렬 › 최종 편집, dragging a page to the trash.
const edge = await page.locator('.sidebar-resizer').boundingBox();
await page.mouse.move(edge.x + 3, 300); await page.mouse.down(); await page.mouse.move(edge.x + 40, 300, { steps: 3 }); await page.mouse.move(edge.x + 83, 300, { steps: 3 }); await page.mouse.up(); await page.waitForTimeout(400);
const width = await page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width));
const stored = await page.evaluate(() => localStorage.getItem('pageyard-sidebar-width'));
const privateHead = page.locator('.sidebar-section-head', { hasText: '개인 페이지' });
await privateHead.hover(); await privateHead.locator('[aria-label="메뉴 열기"]').click(); await page.waitForTimeout(250);
await clickMenu('정렬'); await page.waitForTimeout(250); await clickMenu('최종 편집'); await page.waitForTimeout(500);
const privateOrder = await page.evaluate(() => [...document.querySelectorAll('[data-section="private"] > .sidebar-row .sidebar-row-label, [data-section="private"] .sidebar-row[data-tree-id] .sidebar-row-label')].map(e => e.textContent).slice(0, 1).join(','));
const trashRow = page.locator('[data-section="private"] .sidebar-row', { hasText: '버릴 페이지' }).first();
const tb = await trashRow.boundingBox();
await page.mouse.move(tb.x + 60, tb.y + 15); await page.mouse.down(); await page.mouse.move(tb.x + 70, tb.y + 40, { steps: 4 });
const dropShown = await page.locator('.sidebar-trash-drop').count();
const drop = await page.locator('.sidebar-trash-drop').boundingBox();
await page.mouse.move(drop.x + 40, drop.y + 18, { steps: 6 }); await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(800);
const trashed = (await obj('p-trash'))?.trashedAt ?? (await obj('p-trash'))?.alive === false;
ok('사이드바: 가장자리를 끌어 너비 350, 저장 · 개인 페이지 정렬 › 최종 편집(고친 페이지가 맨 위) · 끄는 중 "휴지통으로 이동"에 놓으면 휴지통', Math.abs(width - 350) <= 2 && stored === String(width) && privateOrder === '오래된 페이지 (고침)' && dropShown === 1 && !!trashed, `width=${width} stored=${stored} top=${privateOrder} drop=${dropShown} trashed=${trashed}`);

// 12. Form: icon, custom submit words and message.
await open('v-form');
const formIcon = await page.evaluate(() => document.querySelector('.form-icon')?.textContent);
await page.locator('.form-preview-button').click(); await page.waitForTimeout(400);
const submitText = await page.evaluate(() => document.querySelector('.form-submit')?.textContent);
await page.locator('.form-answer-input').first().fill('양식 응답'); await page.locator('.form-submit').click(); await page.waitForTimeout(700);
const thanks = await page.evaluate(() => document.querySelector('.form-done h3')?.textContent);
ok('양식: 아이콘 📝, 제출 버튼 "보내기", 제출 뒤 "고마워요"', formIcon === '📝' && submitText === '보내기' && thanks === '고마워요', `icon=${formIcon} submit=${submitText} thanks=${thanks}`);

// 13. Files reorder in a cell.
await open('v-table');
const fileCell = page.locator('[data-row-id="r0"] [data-col="5"]');
{ await fileCell.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); const box = await fileCell.boundingBox(); await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2); } await page.waitForTimeout(500);
const editorOpen = await page.locator('.files-editor').count();
let fileOrder = 'no-editor';
if (editorOpen) {
  const handles = page.locator('.files-editor .files-handle');
  const h0 = await handles.nth(0).boundingBox(), rowsBox = await page.locator('.files-editor .files-row').nth(1).boundingBox();
  await page.mouse.move(h0.x + 6, h0.y + 8); await page.mouse.down(); await page.mouse.move(h0.x + 6, rowsBox.y + rowsBox.height - 2, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(700);
  const value = (await obj('r0')).values['s-f'];
  fileOrder = value[0] === fb && value[1] === fa ? 'b,a' : value.join(',');
  await page.keyboard.press('Escape');
}
ok('파일 속성: 손잡이를 끌어 파일 순서를 바꿈 (b.txt가 앞으로)', fileOrder === 'b,a', fileOrder);

// 14. Chart: colour by value and PNG copy.
await open('v-chart'); await page.waitForTimeout(600);
const opacities = await page.evaluate(() => [...new Set([...document.querySelectorAll('.chart-bar path')].map(p => p.getAttribute('fill-opacity')))].length);
await page.locator('.db-tool-settings').click(); await page.waitForTimeout(300);
const saveButton = page.locator('.settings-panel button, .view-settings button', { hasText: /저장/ }).first();
await saveButton.click().catch(() => {}); await page.waitForTimeout(300);
const saveItems = await menuItems();
let copied = false;
if (saveItems.includes('PNG로 복사')) { await clickMenu('PNG로 복사'); await page.waitForTimeout(1200); copied = await page.evaluate(async () => { try { const items = await navigator.clipboard.read(); return items.some(item => item.types.includes('image/png')); } catch { return false; } }); }
ok('차트: 값에 따라 색(막대마다 짙기 다름), 저장 메뉴 [PNG로 복사 · PNG · SVG · 배경], 복사하면 클립보드에 PNG', opacities > 3 && saveItems.slice(0, 3).join(',') === 'PNG로 복사,PNG 다운로드,SVG 다운로드' && saveItems.includes('배경') && copied, `shades=${opacities} items=${saveItems} copied=${copied}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
