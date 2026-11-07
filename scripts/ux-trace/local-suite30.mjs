// 24차 (coverage phase 3: find and organize). Search filters (위치 · 날짜 · 콘텐츠 상태 · 정렬), "exact phrases" and
// 바로 가기; ⌘F find in page; 홈 and 내 작업; archiving; the trash (open a trashed page, 영구 삭제); page lock stored on
// the page with 이번만 편집; 위키 tabs; 버전 기록 (list, name, copy, restore) and a database restore; inbox type filter and
// archive; library bulk favorite/move; backlinks in a popover; dragging a page into 즐겨찾기. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite30.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite30-'));
const port = 5800 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };
const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

await post([
  { type: 'page.create', id: 'wiki', title: '팀 위키', parentId: null },
  { type: 'block.create', id: 'wiki-b', parentId: 'wiki', blockType: 'paragraph', richText: [{ text: '위키 첫 화면' }] },
  { type: 'page.create', id: 'w1', title: '온보딩', parentId: 'wiki' },
  { type: 'page.create', id: 'w2', title: '휴가 규정', parentId: 'w1' },
  { type: 'page.create', id: 'memo', title: '회의 메모', parentId: null },
  { type: 'block.create', id: 'memo-1', parentId: 'memo', blockType: 'paragraph', richText: [{ text: '분기 예산 검토와 채용 계획' }] },
  { type: 'block.create', id: 'memo-2', parentId: 'memo', blockType: 'paragraph', richText: [{ text: '두 번째 문단 예산' }] },
  { type: 'block.create', id: 'memo-3', parentId: 'memo', blockType: 'paragraph', richText: [{ text: '링크: ' }, { text: '온보딩', pageId: 'w1' }] },
  { type: 'block.create', id: 'memo-5', parentId: 'memo', blockType: 'paragraph', richText: [{ text: '남은 예산 메모' }] },
  { type: 'page.create', id: 'budget', title: '예산 정리', parentId: null },
  { type: 'block.create', id: 'budget-1', parentId: 'budget', blockType: 'paragraph', richText: [{ text: '채용 예산은 다음 달 검토' }] },
  { type: 'page.create', id: 'old', title: '지난 계획', parentId: null },
  { type: 'block.create', id: 'old-1', parentId: 'old', blockType: 'paragraph', richText: [{ text: '예산 검토 끝' }] },
  { type: 'page.create', id: 'bin', title: '버릴 문서', parentId: null },
  { type: 'block.create', id: 'bin-1', parentId: 'bin', blockType: 'paragraph', richText: [{ text: '휴지통 안 내용' }] },
  { type: 'page.create', id: 'db', title: '프로젝트', parentId: null },
  { type: 'source.create', id: 's', pageId: 'db', name: '프로젝트', titlePropertyId: 's-t' },
  { type: 'property.create', id: 's-st', sourceId: 's', name: '상태', propertyType: 'status', options: [{ id: 'todo', name: '시작 전', group: '할 일' }, { id: 'doing', name: '진행 중', group: '진행 중' }, { id: 'done', name: '완료', group: '완료' }] },
  { type: 'property.create', id: 's-d', sourceId: 's', name: '마감일', propertyType: 'date' },
  { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: {} },
  { type: 'page.create', id: 't1', title: '보고서 쓰기', sourceId: 's' }, { type: 'value.set', pageId: 't1', propertyId: 's-st', value: 'doing' }, { type: 'value.set', pageId: 't1', propertyId: 's-d', value: { start: day(-1) } },
  { type: 'page.create', id: 't2', title: '발표 준비', sourceId: 's' }, { type: 'value.set', pageId: 't2', propertyId: 's-st', value: 'todo' }, { type: 'value.set', pageId: 't2', propertyId: 's-d', value: { start: day(3) } },
  { type: 'page.create', id: 't3', title: '끝난 일', sourceId: 's' }, { type: 'value.set', pageId: 't3', propertyId: 's-st', value: 'done' },
  { type: 'reminder.set', id: 'rem', parentId: 'memo', at: new Date(Date.now() - 60000).toISOString(), message: '메모 확인' },
]);
await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'tick', actor: 'scheduler', expectedRevision: (await state()).revision, operations: [{ type: 'scheduler.tick', at: new Date().toISOString() }] }) });
const versionBefore = (await state()).revision;
await post([{ type: 'block.update', id: 'memo-2', richText: [{ text: '고친 두 번째 문단' }] }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(300); };
const results = () => page.evaluate(() => [...document.querySelectorAll('.search-group')].filter(g => g.querySelector('.search-group-label')?.textContent === '검색 결과').flatMap(g => [...g.querySelectorAll('.search-result-title')].map(e => e.textContent)));
const openPageMenu = async () => { await page.locator('.topbar button[aria-label="페이지 메뉴"]').first().click(); await page.waitForTimeout(300); };

// 1. Search: words, "phrases", location, archive filter, sort, jump-to.
await open('memo');
await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
await page.keyboard.type('예산 검토'); await page.waitForTimeout(600);
const words = (await results()).sort().join(',');
await page.locator('.search-input').fill('"예산 검토"'); await page.waitForTimeout(600);
const phrase = (await results()).sort().join(',');
await page.locator('.search-filters [data-filter="within"]').click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '팀 위키' }).first().click(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.locator('.search-input').fill(''); await page.waitForTimeout(600);
const within = (await results()).sort().join(',');
await page.locator('.search-filters [data-filter="within"]').click(); await page.waitForTimeout(300);
await clickMenu('모든 위치'); await page.waitForTimeout(200);
await page.locator('.search-filters [data-filter="sort"]').click(); await page.waitForTimeout(250);
const sortItems = await menuItems();
await clickMenu('생성 일시: 최신순');
await page.locator('.search-input').fill('예산'); await page.waitForTimeout(600);
const sorted = await results();
await page.locator('.search-input').fill('휴지'); await page.waitForTimeout(600);
const jump = await page.evaluate(() => [...document.querySelectorAll('.search-group')].find(g => g.querySelector('.search-group-label')?.textContent === '바로 가기')?.textContent ?? '');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('검색: 단어는 모두 포함, "따옴표"는 정확한 구문, 위치 필터(팀 위키 아래만), 정렬 메뉴 5가지, 바로 가기(휴지통)',
  words === '예산 정리,지난 계획,회의 메모' && phrase === '지난 계획,회의 메모' && within === '온보딩,팀 위키,휴가 규정' && sortItems.length === 5 && sortItems.includes('생성 일시: 최신순') && sorted.length === 3 && jump.includes('휴지통'),
  `words=${words} phrase=${phrase} within=${within} sort=${sortItems.join('/')} sorted=${sorted.join('/')} jump=${jump}`);

// 2. ⌘F finds in the page.
await open('memo');
await page.mouse.click(700, 500);
await page.keyboard.press('Control+f'); await page.waitForTimeout(300);
await page.keyboard.type('예산'); await page.waitForTimeout(500);
const count = await page.evaluate(() => document.querySelector('.find-bar-count')?.textContent);
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
const count2 = await page.evaluate(() => document.querySelector('.find-bar-count')?.textContent);
const painted = await page.evaluate(() => !!(globalThis.CSS?.highlights?.get('pageyard-find-current')));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const closed = await page.evaluate(() => !document.querySelector('.find-bar'));
ok('⌘F: 페이지 안 찾기 막대, 1/2 → Enter 2/2, 하이라이트, Esc로 닫힘', count === '1/2' && count2 === '2/2' && painted && closed, `count=${count}→${count2} painted=${painted} closed=${closed}`);

// 3. 홈 and 내 작업.
await page.locator('.sidebar-app-link[data-app="home"]').click(); await page.waitForTimeout(800);
const home = await page.evaluate(() => ({ greeting: document.querySelector('.home-greeting')?.textContent, sections: [...document.querySelectorAll('.home-section')].map(s => s.dataset.section), recent: document.querySelectorAll('.home-recent .home-card').length, tasks: [...document.querySelectorAll('.home-tasks .task-title')].map(e => e.textContent), upcoming: document.querySelectorAll('.home-upcoming .home-event').length, url: location.search }));
await page.locator('.sidebar-app-link[data-app="tasks"]').click(); await page.waitForTimeout(800);
const tasks = await page.evaluate(() => ({ groups: [...document.querySelectorAll('.task-group-head')].map(e => e.firstChild?.textContent), rows: [...document.querySelectorAll('.task-row .task-title')].map(e => e.textContent) }));
await page.locator('.task-row', { hasText: '발표 준비' }).locator('.task-status').click(); await page.waitForTimeout(250);
await clickMenu('완료'); await page.waitForTimeout(700);
const t2 = await obj('t2');
const tasksAfter = await page.evaluate(() => [...document.querySelectorAll('.task-row .task-title')].map(e => e.textContent));
ok('홈(인사 · 최근 방문 · 내 작업 · 다가오는 일정)과 내 작업(기한 지남 · 앞으로 7일, 상태 바꾸면 사라짐)',
  !!home.greeting && home.recent >= 1 && home.tasks.join(',') === '보고서 쓰기,발표 준비' && home.upcoming >= 1 && home.url === '?home=1'
  && tasks.groups.join(',') === '기한 지남,앞으로 7일' && tasks.rows.join(',') === '보고서 쓰기,발표 준비' && t2.values['s-st'] === 'done' && tasksAfter.join(',') === '보고서 쓰기',
  `home=${JSON.stringify(home)} tasks=${JSON.stringify(tasks)} after=${tasksAfter}`);

// 4. Archive: from the page menu; gone from search and the sidebar; banner with 보관 해제; found with the filter.
await open('old');
await openPageMenu();
await clickMenu('보관'); await page.waitForTimeout(500);
const archivedFlag = (await obj('old')).archived;
const banner = await page.evaluate(() => document.querySelector('.archive-banner')?.textContent ?? '');
const inSidebar = await page.evaluate(() => [...document.querySelectorAll('.sidebar [data-section="private"] .sidebar-row-label')].some(e => e.textContent === '지난 계획'));
await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
await page.keyboard.type('예산 검토'); await page.waitForTimeout(600);
const hidden = (await results()).sort().join(',');
await page.locator('.search-filters [data-filter="archived"]').click(); await page.waitForTimeout(250);
await clickMenu('보관된 페이지만'); await page.waitForTimeout(600);
const onlyArchived = (await results()).join(',');
const badge = await page.evaluate(() => document.querySelector('.search-result-badge')?.textContent);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('보관: 페이지 메뉴 → 배너, 사이드바·검색에서 빠지고 "보관된 페이지만"으로 찾음', archivedFlag === true && banner.includes('보관된 페이지') && !inSidebar && hidden === '예산 정리,회의 메모' && onlyArchived === '지난 계획' && badge === '보관됨',
  `flag=${archivedFlag} sidebar=${inSidebar} hidden=${hidden} only=${onlyArchived} badge=${badge}`);
await page.locator('.archive-banner button').click(); await page.waitForTimeout(500);
ok('보관 해제 단추로 되돌림', (await obj('old')).archived === undefined);

// 5. Trash: opening a trashed page shows it read-only with 복원 · 영구 삭제; 영구 삭제 takes it out of the trash.
await post([{ type: 'node.trash', id: 'bin' }]);
await page.goto(`${base}/?id=bin`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
const trashView = await page.evaluate(() => ({ banner: document.querySelector('.trash-banner')?.textContent ?? '', text: document.querySelector('.page-editor')?.textContent ?? '', editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true' }));
await page.locator('.trash-banner-button.danger').click(); await page.waitForTimeout(300);
await page.locator('.dialog-panel button[type="submit"]').click(); await page.waitForTimeout(700);
const purged = (await obj('bin')).purged;
await page.evaluate(() => document.querySelector('.sidebar-more-button')?.click()); await page.waitForTimeout(300);
await clickMenu('휴지통'); await page.waitForTimeout(400);
const trashRows = await page.evaluate(() => [...document.querySelectorAll('.trash-row .trash-title')].map(e => e.textContent));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('휴지통 페이지 열기(읽기 전용, 복원 · 영구 삭제 배너) → 영구 삭제하면 휴지통에서도 사라짐', trashView.banner.includes('휴지통에 있습니다') && trashView.text.includes('휴지통 안 내용') && !trashView.editable && purged === true && !trashRows.includes('버릴 문서'),
  `banner=${trashView.banner} editable=${trashView.editable} purged=${purged} rows=${trashRows}`);

// 6. Page lock is stored on the page; 이번만 편집 unlocks this window only.
await open('budget');
await openPageMenu();
await page.locator('.menu-item', { hasText: '페이지 잠금' }).first().click(); await page.waitForTimeout(500);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const lockedFlag = (await obj('budget')).locked;
const lockedEditor = await page.evaluate(() => document.querySelector('.ProseMirror')?.getAttribute('contenteditable'));
await page.locator('.lock-banner button', { hasText: '이번만 편집' }).click(); await page.waitForTimeout(300);
const unlockedEditor = await page.evaluate(() => document.querySelector('.ProseMirror')?.getAttribute('contenteditable'));
const stillStored = (await obj('budget')).locked;
const page2 = await context.newPage(); await page2.goto(`${base}/?id=budget`, { waitUntil: 'networkidle' }); await page2.waitForTimeout(600);
const otherWindow = await page2.evaluate(() => !!document.querySelector('.lock-banner'));
await page2.close();
ok('페이지 잠금: 페이지에 저장(다른 창도 잠김), "이번만 편집"은 이 창만 풀림', lockedFlag === true && lockedEditor === 'false' && unlockedEditor === 'true' && stillStored === true && otherWindow, `stored=${lockedFlag} editor=${lockedEditor}→${unlockedEditor} other=${otherWindow}`);

// 7. Wiki: tabs over the page; 모든 페이지 lists the pages under it.
await open('wiki');
await openPageMenu();
await clickMenu('위키로 전환'); await page.waitForTimeout(500);
const tabs = await page.evaluate(() => [...document.querySelectorAll('.wiki-tab')].map(e => e.textContent));
await page.locator('.wiki-tab', { hasText: '모든 페이지' }).click(); await page.waitForTimeout(400);
const wikiRows = await page.evaluate(() => [...document.querySelectorAll('.wiki-row .wiki-title')].map(e => e.textContent));
const editorHidden = await page.evaluate(() => document.querySelector('.page-content-tab')?.hidden);
await page.locator('.wiki-tab', { hasText: '홈' }).click(); await page.waitForTimeout(300);
ok('위키로 전환: 홈 · 모든 페이지 · 내 페이지 탭, 모든 페이지에 하위 페이지 전부', (await obj('wiki')).wiki === true && tabs.join(',') === '홈,모든 페이지,내 페이지' && wikiRows.sort().join(',') === '온보딩,휴가 규정' && editorHidden === true, `tabs=${tabs} rows=${wikiRows} hidden=${editorHidden}`);

// 8. Version history: list, name a version, copy a block, restore.
await open('memo');
await openPageMenu();
await clickMenu('버전 기록'); await page.waitForTimeout(900);
const versions = await page.evaluate(() => [...document.querySelectorAll('.version-item-title')].map(e => e.textContent));
await page.locator('.version-item').last().click(); await page.waitForTimeout(600);
const previewText = await page.evaluate(() => document.querySelector('.version-history-preview')?.textContent ?? '');
await page.locator('.version-item').last().locator('button[aria-label="버전 이름 지정"]').click(); await page.waitForTimeout(200);
await page.keyboard.type('첫 초안'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
const named = Object.values((await obj('memo')).versionNames ?? {});
await page.locator('.version-row').first().click(); await page.waitForTimeout(150);
await page.locator('.version-copy-tools button').first().click(); await page.waitForTimeout(400);
const clip = await page.evaluate(async () => { try { const items = await navigator.clipboard.read(); const html = items[0].types.includes('text/html') ? await (await items[0].getType('text/html')).text() : ''; return html; } catch (error) { return String(error); } });
const selectedVersion = await page.evaluate(() => document.querySelector('.version-item.selected')?.textContent);
await page.locator('.dialog-panel button[type="submit"]').click(); await page.waitForTimeout(900);
const dialogError = await page.evaluate(() => document.querySelector('.dialog-panel .error-text')?.textContent ?? document.querySelector('.toast')?.textContent ?? '');
const restored = (await obj('memo-2')).richText[0].text;
ok('버전 기록: 목록(현재 버전 먼저), 이름 지정, 블록 복사(HTML), 이 버전으로 복원', versions[0] === '현재 버전' && previewText.includes('두 번째 문단 예산') && named.includes('첫 초안') && clip.includes('분기 예산 검토') && restored === '두 번째 문단 예산',
  `versions=${versions.slice(0, 3)} selected=${selectedVersion} named=${named} clip=${clip.slice(0, 60)} restored=${restored} error=${dialogError}`);

// 9. Database restore from its version history.
const dbBefore = (await state()).revision;
await post([{ type: 'page.update', id: 't1', title: '보고서 쓰기 (수정)' }, { type: 'page.create', id: 't4', title: '새 일', sourceId: 's' }]);
await open('db');
await openPageMenu();
await clickMenu('버전 기록'); await page.waitForTimeout(900);
const dbTitle = await page.evaluate(() => document.querySelector('.dialog-title')?.textContent);
const dbIndex = await page.evaluate(before => [...document.querySelectorAll('.version-item')].findIndex((_, i, all) => i > 0), dbBefore);
await page.locator('.version-item').nth(Math.max(1, dbIndex)).click(); await page.waitForTimeout(600);
const rowsShown = await page.evaluate(() => [...document.querySelectorAll('.version-table tbody td:first-child')].map(e => e.textContent));
await page.locator('.dialog-panel button[type="submit"]').click(); await page.waitForTimeout(300);
await page.locator('.dialog-panel button[type="submit"]').last().click(); await page.waitForTimeout(900);
const t1 = await obj('t1'), t4 = await obj('t4');
ok('데이터베이스 버전 기록: 그때의 행 표 → 복원하면 제목이 돌아오고 새 행은 휴지통', dbTitle === '데이터베이스 버전 기록' && rowsShown.includes('보고서 쓰기') && t1.title === '보고서 쓰기' && t4.alive === false, `title=${dbTitle} rows=${rowsShown} t1=${t1.title} t4=${t4.alive}`);

// 10. Inbox: the reminder is typed; archive it; the archived filter brings it back.
await page.locator('[data-inbox-toggle]').click(); await page.waitForTimeout(500);
const inboxText = await page.evaluate(() => document.querySelector('.inbox-row-text')?.textContent ?? '');
await page.locator('.inbox-row').first().hover();
await page.locator('.inbox-archive').first().click(); await page.waitForTimeout(500);
const afterArchive = await page.evaluate(() => document.querySelectorAll('.inbox-row').length);
await page.locator('.inbox-panel-head button[aria-label="알림 필터"]').click(); await page.waitForTimeout(250);
const filterItems = await menuItems();
await clickMenu('보관된 알림'); await page.waitForTimeout(400);
const archivedRows = await page.evaluate(() => document.querySelectorAll('.inbox-row').length);
await page.locator('.inbox-panel-head button[aria-label="알림 필터"]').click(); await page.waitForTimeout(250);
await clickMenu('모든 알림'); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('받은 알림: 유형 표시(리마인더), 보관, 필터(상태 · 유형)로 보관된 알림 보기', inboxText.startsWith('리마인더') && afterArchive === 0 && archivedRows === 1 && filterItems.includes('자동화 오류') && filterItems.includes('보관된 알림'), `text=${inboxText} after=${afterArchive} archived=${archivedRows} items=${filterItems}`);

// 11. Library bulk: favorite several and move them under a page.
await page.goto(`${base}/?library=private`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
for (const title of ['회의 메모', '예산 정리']) { const row = page.locator('.library-row', { hasText: title }).first(); await row.hover(); await row.locator('.library-check input').check(); }
await page.waitForTimeout(200);
await page.locator('.selection-action[aria-label="더 보기"]').click(); await page.waitForTimeout(250);
const bulkItems = await menuItems();
await clickMenu('즐겨찾기에 추가'); await page.waitForTimeout(500);
const favorites = (await obj('workspace-navigation'))?.favorites ?? [];
await page.locator('.selection-action[aria-label="더 보기"]').click(); await page.waitForTimeout(250);
await clickMenu('다른 페이지로 옮기기'); await page.waitForTimeout(400);
await page.keyboard.type('지난 계획'); await page.waitForTimeout(400);
await page.keyboard.press('Enter'); await page.waitForTimeout(700);
const moved = [(await obj('memo')).parentId, (await obj('budget')).parentId];
ok('라이브러리 여러 항목: 즐겨찾기에 추가 · 아이콘 변경 · 다른 페이지로 옮기기', bulkItems.includes('아이콘 변경') && favorites.includes('memo') && favorites.includes('budget') && moved.join(',') === 'old,old', `items=${bulkItems} fav=${favorites} moved=${moved}`);

// 12. Backlinks in a popover (database page layout) and dragging a page into 즐겨찾기 reorders it.
await post([{ type: 'source.update', id: 's', pageLayout: { backlinks: 'popover' } }, { type: 'block.create', id: 'memo-4', parentId: 'memo', blockType: 'paragraph', richText: [{ text: '일: ' }, { text: '보고서 쓰기', pageId: 't1' }] }]);
await open('t1');
await page.locator('.backlinks-toggle').click(); await page.waitForTimeout(300);
const popover = await page.evaluate(() => document.querySelector('.backlinks-popover')?.textContent ?? '');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const favRows = async () => page.evaluate(() => [...document.querySelectorAll('[data-section="favorites"] > .sidebar-row[data-tree-depth="0"], [data-section="favorites"] .sidebar-row[data-tree-depth="0"]')].map(e => e.dataset.treeId));
const beforeFav = await favRows();
const src = page.locator(`[data-section="favorites"] .sidebar-row[data-tree-id="${beforeFav[1]}"]`).first(), dst = page.locator(`[data-section="favorites"] .sidebar-row[data-tree-id="${beforeFav[0]}"]`).first();
const a = await src.boundingBox(), b = await dst.boundingBox();
await page.mouse.move(a.x + 60, a.y + a.height / 2); await page.mouse.down();
await page.mouse.move(a.x + 60, a.y - 6, { steps: 4 }); await page.mouse.move(b.x + 60, b.y + 4, { steps: 6 }); await page.waitForTimeout(150);
await page.mouse.up(); await page.waitForTimeout(700);
const afterFav = (await obj('workspace-navigation')).favorites;
ok('백링크 팝오버, 즐겨찾기 안에서 끌어 순서 바꾸기', popover.includes('회의 메모') && beforeFav.length === 2 && afterFav[0] === beforeFav[1], `popover=${popover} before=${beforeFav} after=${afterFav}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
