// 26차 (coverage phase 5: databases and automations). 인라인으로 전환 / 페이지로 전환; selection bar "속성 편집" for any
// property; the formula editor's live result and error; related pages' properties in cells; date formats and a
// date's time zone; formatted text values; comments on a property value; "비어 있으면 숨기기"; the side panel folding
// up; the feed showing whole posts; sub-items inside the parent's card; card preview of page content; dashboard rows
// and filters; sprints (turning them on, completing one); an automation trigger condition; the place's current
// location. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite32.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite32-'));
const port = 6600 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };

await post([
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'db', title: '작업', parentId: 'home' },
  { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 'title' },
  { type: 'property.create', id: 'st', sourceId: 's', name: '상태', propertyType: 'status', options: [{ id: 'todo', name: '할 일', color: 'default', group: 'todo' }, { id: 'doing', name: '진행 중', color: 'blue', group: 'in_progress' }, { id: 'done', name: '완료', color: 'green', group: 'complete' }] },
  { type: 'property.create', id: 'note', sourceId: 's', name: '메모', propertyType: 'text' },
  { type: 'property.create', id: 'due', sourceId: 's', name: '마감', propertyType: 'date' },
  { type: 'property.create', id: 'n', sourceId: 's', name: '점수', propertyType: 'number' },
  { type: 'property.create', id: 'tag', sourceId: 's', name: '분류', propertyType: 'select', options: [{ id: 'x', name: '기획', color: 'purple' }, { id: 'y', name: '개발', color: 'green' }] },
  { type: 'property.create', id: 'place', sourceId: 's', name: '장소', propertyType: 'place' },
  { type: 'page.create', id: 'pdb', title: '사람', parentId: 'home' },
  { type: 'source.create', id: 'ps', pageId: 'pdb', name: '사람', titlePropertyId: 'ptitle' },
  { type: 'property.create', id: 'role', sourceId: 'ps', name: '역할', propertyType: 'text' },
  { type: 'page.create', id: 'kim', title: '김', sourceId: 'ps' }, { type: 'value.set', pageId: 'kim', propertyId: 'role', value: '디자이너' },
  { type: 'property.create', id: 'who', sourceId: 's', name: '담당', propertyType: 'relation', targetSourceId: 'ps', displayProperties: ['role'] },
  { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: { visibleProperties: ['title', 'note', 'due', 'who', 'n', 'tag'] } },
  { type: 'page.create', id: 'a', title: '설계', sourceId: 's' }, { type: 'value.set', pageId: 'a', propertyId: 'n', value: 7 }, { type: 'value.set', pageId: 'a', propertyId: 'due', value: { start: '2026-11-03' } },
  { type: 'relation.set', pageId: 'a', propertyId: 'who', targetIds: ['kim'] },
  { type: 'block.create', id: 'a-h', parentId: 'a', blockType: 'heading1', richText: [{ text: '설계 개요' }] },
  { type: 'block.create', id: 'a-p', parentId: 'a', blockType: 'paragraph', richText: [{ text: '첫 문단 ' }, { text: '굵게', bold: true }] },
  { type: 'page.create', id: 'b', title: '구현', sourceId: 's' },
  { type: 'page.create', id: 'c', title: '검토', sourceId: 's' },
  { type: 'page.create', id: 'idb', title: '메모장', parentId: 'home' },
  { type: 'block.create', id: 'idb-1', parentId: 'idb', blockType: 'paragraph', richText: [{ text: '인라인 데이터베이스 위' }] },
  { type: 'source.create', id: 'is', pageId: 'idb', name: '할 일 목록', titlePropertyId: 'ititle' },
  { type: 'view.create', id: 'iv', sourceId: 'is', parentId: 'idb', name: '표', viewType: 'table', config: {} },
  { type: 'page.create', id: 'i1', title: '우유 사기', sourceId: 'is' },
]);
// The database page was made apart from its source: mark it a database page (the app's own create does both at once).
await post([{ type: 'page.update', id: 'db', databasePage: true }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write', 'geolocation'], geolocation: { latitude: 37.5665, longitude: 126.978 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(300); };
const cell = (r, c) => page.locator(`[data-cell="${r}:${c}"]`).first();
const settings = async () => { await page.locator('.db-tool-settings').first().click(); await page.waitForTimeout(350); };

// 1. Related pages' chosen properties in the cell; a date property's own format.
await open('v');
const relationCell = await cell(0, 3).textContent();
await post([{ type: 'property.update', id: 'due', dateFormat: 'ymd' }]); await page.waitForTimeout(800);
const dateCell = await cell(0, 2).textContent();
ok('관계형 셀에 표시 속성(역할), 날짜 형식 연도/월/일', relationCell.includes('디자이너') && dateCell.trim() === '2026/11/03', `relation=${relationCell} date=${dateCell}`);

// 2. Formatted text in a text cell: ⌘B while typing, Enter keeps the runs.
await cell(0, 1).click(); await page.waitForTimeout(400);
await page.keyboard.type('보통 '); await page.keyboard.press('Control+b'); await page.keyboard.type('강조'); await page.keyboard.press('Control+b'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const note = (await obj('a')).values.note;
const noteDom = await cell(0, 1).evaluate(element => element.querySelector('b, strong')?.textContent ?? '');
ok('텍스트 속성: ⌘B 서식이 값에 남고 셀에 굵게', Array.isArray(note) && note.some(run => run.bold && run.text === '강조') && noteDom === '강조', `note=${JSON.stringify(note)} dom=${noteDom}`);

// 3. The selection bar edits any property ("속성 편집").
for (const id of ['b', 'c']) { await page.evaluate(rowId => document.querySelector(`[data-row-id="${rowId}"] .row-check input`)?.click(), id); await page.waitForTimeout(200); }
await page.locator('.selection-action.labeled').click(); await page.waitForTimeout(300);
const bulkProps = await menuItems();
await clickMenu('분류'); await page.waitForTimeout(400);
await page.locator('.option-picker .option-row, .option-picker .menu-item', { hasText: '개발' }).first().click(); await page.waitForTimeout(700);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const bulk = [(await obj('b')).values.tag, (await obj('c')).values.tag];
ok('여러 행 선택 › 속성 편집 메뉴(모든 속성) → 분류 일괄 지정', ['상태', '메모', '마감', '점수', '분류', '장소', '담당'].every(name => bulkProps.includes(name)) && bulk.join(',') === 'y,y', `props=${bulkProps} values=${bulk}`);
await page.keyboard.press('Escape'); await page.mouse.click(5, 880); await page.waitForTimeout(200);

// 4. The formula editor: a result for the first rows while typing; an error names the problem; help for a function.
await open('a');
await page.locator('.property-add').first().click(); await page.waitForTimeout(400);
await page.locator('.dialog-panel select').first().selectOption('formula'); await page.waitForTimeout(300);
const editorShown = await page.locator('.formula-editor').count();
await page.locator('.formula-editor-input').fill('prop("점수") * 10'); await page.waitForTimeout(1000);
const preview = await page.locator('.formula-preview').textContent().catch(() => '');
await page.locator('.formula-editor-input').fill('prop("없음")'); await page.waitForTimeout(1000);
const previewError = await page.locator('.formula-preview.error').textContent().catch(() => '');
await page.locator('.formula-browser .formula-item', { hasText: 'dateAdd' }).first().hover(); await page.waitForTimeout(200);
const helpShown = await page.locator('.formula-help-code').first().textContent().catch(() => '');
await page.locator('.formula-browser .formula-item', { hasText: '점수' }).first().click(); await page.waitForTimeout(200);
const inserted = await page.locator('.formula-editor-input').inputValue();
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('수식 편집기: 처음 행 결과(설계 70) · 오류 표시 · 함수 형식 도움말 · 속성 넣기', editorShown === 1 && preview.includes('설계') && preview.includes('70') && /속성을 찾을 수 없습니다/.test(previewError) && /dateAdd\(/.test(helpShown) && inserted.includes('prop("점수")'), `editor=${editorShown} preview=${preview} error=${previewError} help=${helpShown} inserted=${inserted}`);

// 5. Comments on a property value; "비어 있으면 숨기기"; the side panel folds.
await post([{ type: 'source.update', id: 's', pageLayout: { panel: ['n', 'tag'] } }]);
await open('a');
const row = page.locator('.property-row[data-property-id="due"]').first();
await row.hover(); await page.waitForTimeout(150);
await row.locator('.property-comment-button').click(); await page.waitForTimeout(300);
await page.keyboard.type('마감이 너무 빠릅니다'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const propertyComment = (await state()).objects.find(o => o.kind === 'comment' && o.propertyId === 'due');
const countBadge = await row.locator('.property-comment-button span').textContent().catch(() => '');
const pageCommentsHasIt = await page.locator('.page-comments .comment', { hasText: '마감이 너무 빠릅니다' }).count();
await page.locator('.property-row[data-property-id="place"] .property-name').first().click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '표시 방식' }).first().hover(); await page.waitForTimeout(400);
await clickMenu('비어 있으면 숨기기'); await page.waitForTimeout(800);
const placeShown = await page.locator('.page-properties:not(.in-panel) .property-row[data-property-id="place"]').count();
const panelBefore = await page.locator('.page-panel:not(.collapsed) .property-row').count();
await page.locator('.page-panel .page-panel-toggle').click(); await page.waitForTimeout(300);
const collapsed = await page.locator('.page-panel.collapsed').count();
await page.locator('.page-panel .page-panel-toggle').click(); await page.waitForTimeout(300);
ok('속성 값 댓글(💬 1) · 비어 있으면 숨기기 · 패널 접기', propertyComment?.parentId === 'a' && countBadge === '1' && pageCommentsHasIt === 0 && placeShown === 0 && (await obj('s')).pageLayout.hideWhenEmpty?.includes('place') && panelBefore === 2 && collapsed === 1,
  `comment=${propertyComment?.propertyId} badge=${countBadge} inPage=${pageCommentsHasIt} place=${placeShown} panel=${panelBefore} collapsed=${collapsed}`);

// 6. The place's current location (the browser's position).
await post([{ type: 'source.update', id: 's', pageLayout: { panel: ['n', 'tag'] } }]); await page.waitForTimeout(600);
await page.locator('.property-row[data-property-id="place"] .property-value').first().click(); await page.waitForTimeout(300);
await page.locator('.place-actions button', { hasText: '현재 위치' }).click(); await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
const place = (await obj('a')).values.place;
ok('장소 › 현재 위치 → 좌표 저장', place?.latitude === 37.5665 && place?.longitude === 126.978 && place?.name === '현재 위치', JSON.stringify(place));

// 7. A date in another time zone: chosen in the picker, shown in that zone with its name.
await page.locator('.property-row[data-property-id="due"] .property-value').first().click(); await page.waitForTimeout(400);
await page.locator('.date-option-row', { hasText: '시간 포함' }).click(); await page.waitForTimeout(400);
await page.locator('.date-zone-select').selectOption('America/New_York'); await page.waitForTimeout(500);
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
const due = (await obj('a')).values.due;
const dueText = await page.locator('.property-row[data-property-id="due"] .property-value').first().textContent();
ok('날짜 › 시간대(뉴욕) → 값에 시간대, 그 시간대 시각과 이름', due?.timeZone === 'America/New_York' && /T09:00:00-05:00$/.test(due.start) && dueText.includes('New York') && dueText.includes('2026/11/03'), `due=${JSON.stringify(due)} text=${dueText}`);

// 8. 인라인으로 전환 on a database page; 페이지로 전환 on an inline database.
await open('db');
await page.locator('.topbar button[aria-label="페이지 메뉴"]').first().click(); await page.waitForTimeout(300);
await clickMenu('인라인으로 전환'); await page.waitForTimeout(900);
const inlineNow = (await obj('db')).databasePage === false && (await page.locator('.ProseMirror').count()) > 0;
await open('idb');
const tab = page.locator('.db-tabs .db-tab[role="tab"]', { hasText: '표' }).first();
await tab.click(); await page.waitForTimeout(200); if (!(await page.locator('.menu-item', { hasText: '페이지로 전환' }).count())) { await tab.click(); await page.waitForTimeout(300); }
const tabMenu = await menuItems();
await clickMenu('페이지로 전환'); await page.waitForTimeout(900);
const newPage = (await state()).objects.find(o => o.kind === 'page' && o.parentId === 'idb' && o.title === '할 일 목록');
const movedSource = await obj('is');
ok('데이터베이스 페이지 › 인라인으로 전환, 인라인 DB › 페이지로 전환', inlineNow && tabMenu.includes('페이지로 전환') && newPage?.databasePage === true && movedSource.parentId === newPage?.id && (await obj('iv')).parentId === newPage?.id, `inline=${inlineNow} menu=${tabMenu.slice(-6)} page=${newPage?.id} source=${movedSource.parentId}`);
await post([{ type: 'page.update', id: 'db', databasePage: true }]);

// 9. The feed shows the whole post (heading, formatting) and this browser's view count.
await post([{ type: 'view.create', id: 'feed', sourceId: 's', parentId: 'db', name: '피드', viewType: 'feed', config: {} }]);
await open('a'); await open('feed');
const feed = await page.evaluate(() => { const card = [...document.querySelectorAll('.feed-card')].find(e => e.textContent.includes('설계 개요')); return card ? { heading: !!card.querySelector('.feed-heading1'), bold: card.querySelector('.feed-text b, .feed-text strong')?.textContent ?? '', views: card.querySelector('.feed-views')?.textContent ?? '' } : null; });
ok('피드: 글 전체(제목 · 굵게)와 조회 수', feed?.heading && feed.bold === '굵게' && /조회 \d+회/.test(feed.views), JSON.stringify(feed));

// 10. Sub-items inside the parent's card; card preview of page content without the name.
await post([{ type: 'source.configure_tasks', id: 's', subitems: { enabled: true } }]);
const sub = (await obj('s')).tasks.subitems;
await post([{ type: 'relation.set', pageId: 'b', propertyId: sub.parentPropertyId, targetIds: ['a'] }, { type: 'view.create', id: 'board', sourceId: 's', parentId: 'db', name: '보드', viewType: 'board', config: { groupBy: 'st' } },
  { type: 'view.create', id: 'gal', sourceId: 's', parentId: 'db', name: '갤러리', viewType: 'gallery', config: { galleryPreview: 'page_content', hideTitle: true } }]);
await open('board');
await settings(); await page.locator('.settings-row', { hasText: '레이아웃' }).first().click(); await page.waitForTimeout(300);
const subRow = await page.locator('.settings-row', { hasText: '하위 항목 표시' }).count();
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const toggle = page.locator('.row-card[data-row-id="a"] .card-subitems-toggle');
const toggleText = await toggle.textContent().catch(() => '');
await toggle.click().catch(() => {}); await page.waitForTimeout(200);
const subTitles = await page.locator('.row-card[data-row-id="a"] .card-subitem').allTextContents();
await open('gal');
const galleryCard = await page.evaluate(() => { const card = document.querySelector('.row-card[data-row-id="a"]'); return card ? { preview: card.querySelector('.card-content-line.heading1')?.textContent ?? '', title: getComputedStyle(card.querySelector('.card-title')).display } : null; });
ok('하위 항목: 보기 설정 행 · 상위 카드 안 "하위 항목 1개", 갤러리 페이지 콘텐츠 미리보기 · 이름 숨김', subRow === 1 && toggleText.includes('하위 항목 1개') && subTitles.join() === '구현' && galleryCard?.preview === '설계 개요' && galleryCard.title === 'none', `row=${subRow} toggle=${toggleText} subs=${subTitles} card=${JSON.stringify(galleryCard)}`);

// 11. A dashboard: rows edited in place and a filter for one data source.
await post([{ type: 'view.create', id: 'dash', sourceId: 's', parentId: 'db', name: '대시보드', viewType: 'dashboard', config: { widgets: ['v', 'board'] } }]);
await open('dash');
const rowsBefore = await page.locator('.dashboard-row').count();
await page.locator('.dashboard-toolbar button', { hasText: '레이아웃 편집' }).click(); await page.waitForTimeout(250);
await page.locator('.dashboard-widget[data-widget-id="board"] [aria-label="아래 줄로"]').click(); await page.waitForTimeout(700);
const rowsAfter = (await obj('dash')).config.dashboardRows;
await page.locator('.dashboard-toolbar .filter-chip').first().click(); await page.waitForTimeout(300);
const filterUi = await page.locator('.dashboard-filter').count();
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await post([{ type: 'view.update', id: 'dash', config: { ...(await obj('dash')).config, dashboardFilters: { s: { propertyId: 'n', op: 'gt', value: 5 } } } }]); await page.waitForTimeout(900);
const tableRows = (await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget[data-widget-id="v"] .table-row[data-row-id]')].map(e => e.dataset.rowId))).join(',');
ok('대시보드: 한 줄 두 위젯 → 아래 줄로 · 데이터 소스 필터', rowsBefore === 1 && JSON.stringify(rowsAfter) === JSON.stringify([['v'], ['board']]) && filterUi === 1 && tableRows === 'a', `before=${rowsBefore} after=${JSON.stringify(rowsAfter)} filter=${filterUi} rows=${tableRows}`);

// 12. Sprints: 변환 › 스프린트 사용, then the current sprint view's "스프린트 완료".
await open('v');
await settings();
await page.locator('.settings-row', { hasText: '변환' }).first().click(); await page.waitForTimeout(300);
const convertItems = await menuItems();
await clickMenu('스프린트 사용'); await page.waitForTimeout(500);
await page.locator('.dialog-panel button', { hasText: '스프린트 사용' }).last().click(); await page.waitForTimeout(1200);
const sprints = (await obj('s')).tasks?.sprints;
const sprintView = (await state()).objects.find(o => o.kind === 'view' && o.sourceId === 's' && o.name === '현재 스프린트');
const sprintPages = (await state()).objects.filter(o => o.kind === 'page' && o.sourceId === sprints?.sourceId);
await post([{ type: 'relation.set', pageId: 'a', propertyId: sprints.relationPropertyId, targetIds: [sprintPages[0].id] }]);
await open(sprintView.id);
const completeButton = await page.locator('.sprint-complete').count();
await page.locator('.sprint-complete').click(); await page.waitForTimeout(300);
await page.locator('.popover-panel button, .dialog-panel button', { hasText: '스프린트 완료' }).last().click(); await page.waitForTimeout(1200);
const moved = (await obj('a')).values[sprints.relationPropertyId]?.[0];
const filterChip = await page.locator('.filter-bar, .db-filter-bar').first().textContent().catch(() => '');
ok('스프린트: 변환 › 스프린트 사용 → DB · 보기 3개, 현재 스프린트 보기의 "스프린트 완료"로 작업이 다음 스프린트로', convertItems.includes('스프린트 사용') && sprints?.enabled && sprintPages.length === 3 && completeButton === 1 && moved === sprintPages[1].id,
  `menu=${convertItems} pages=${sprintPages.length} button=${completeButton} moved=${moved === sprintPages[1].id} chip=${filterChip}`);

// 13. An automation trigger with a condition on a number.
await open('v');
await settings(); await page.locator('.settings-row', { hasText: '자동화' }).first().click(); await page.waitForTimeout(300);
await page.locator('.automations-new').click(); await page.waitForTimeout(400);
await page.locator('.automation-add', { hasText: '새 트리거' }).click(); await page.waitForTimeout(300);
await page.locator('.menu-search input, .menu input').first().fill('점수').catch(() => {}); await page.waitForTimeout(200);
await clickMenu('점수'); await page.waitForTimeout(300);
await page.locator('.automation-card', { hasText: '점수' }).first().click(); await page.waitForTimeout(300);
await page.locator('.automation-condition label', { hasText: '조건에 맞을 때만' }).click(); await page.waitForTimeout(200);
await page.locator('.automation-condition select').selectOption('gt'); await page.waitForTimeout(150);
await page.locator('.automation-condition input:not([type="radio"])').first().fill('5'); await page.waitForTimeout(150);
await page.locator('.automation-condition .automation-values-done').click(); await page.waitForTimeout(250);
const triggerText = await page.locator('.automation-card', { hasText: '점수' }).first().textContent();
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('자동화 트리거 조건: 점수 편집 · 보다 큼 5', /점수/.test(triggerText) && /5/.test(triggerText), triggerText);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
