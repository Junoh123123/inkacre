// 27차 (coverage phase 6: workspace and settings). The template gallery (a template makes its page and database);
// sidebar tabs (add, ⌃1–6, delete); high contrast; the display time zone moving a date's time; the workspace's own
// name and icon; creating another workspace (its own address) and copying or moving a page to it; comments by an
// agent in the inbox. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite33.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite33-'));
const port = 7000 + Math.floor(Math.random() * 40) * 20;
const base = `http://127.0.0.1:${port}`;
for (const at of [port, port + 10]) { const busy = await fetch(`http://127.0.0.1:${at}/api/state`).then(() => true, () => false); if (busy) { console.log(`FAIL port ${at} is in use; run again`); process.exit(1); } }
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const stateOf = async origin => (await fetch(`${origin}/api/state`)).json();
const state = () => stateOf(base);
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };

await post([
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'doc', title: '옮길 문서', parentId: null },
  { type: 'block.create', id: 'doc-1', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '함께 옮겨질 본문' }] },
  { type: 'page.create', id: 'doc-child', title: '하위 문서', parentId: 'doc' },
  { type: 'page.create', id: 'db', title: '일정', parentId: 'home' },
  { type: 'source.create', id: 's', pageId: 'db', name: '일정', titlePropertyId: 'title' },
  { type: 'property.create', id: 'when', sourceId: 's', name: '시각', propertyType: 'date' },
  { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: { visibleProperties: ['title', 'when'] } },
  { type: 'page.create', id: 'm', title: '회의', sourceId: 's' }, { type: 'value.set', pageId: 'm', propertyId: 'when', value: { start: '2026-11-03T09:00:00.000Z' } },
]);
await post([{ type: 'page.update', id: 'db', databasePage: true }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
await context.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async (id, origin = base) => { await page.goto(`${origin}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(350); };
const switcher = async () => { await page.locator('.workspace-switcher').click(); await page.waitForTimeout(400); };
const openSettings = async () => { await switcher(); await clickMenu('설정'); await page.waitForTimeout(400); };
const closeSettings = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); };

// 1. Template gallery: 템플릿 from the sidebar's more menu; categories, search, and 사용 making the page with its database.
await open('home');
await page.locator('.sidebar-more-button').click(); await page.waitForTimeout(300);
await clickMenu('템플릿'); await page.waitForTimeout(400);
const allCards = await page.locator('.template-gallery .template-card').count();
await page.locator('.template-gallery-category', { hasText: '업무' }).click(); await page.waitForTimeout(200);
const workCards = await page.locator('.template-gallery .template-card').count();
await page.locator('.template-gallery input').fill('버그'); await page.waitForTimeout(200);
const found = await page.locator('.template-gallery .template-card-name').allTextContents();
await page.locator('.template-gallery .template-card', { hasText: '버그 트래커' }).locator('button').click(); await page.waitForTimeout(1500);
const s1 = await state();
const made = s1.objects.find(o => o.kind === 'page' && o.title === '버그 트래커' && o.alive !== false);
const madeSource = made && s1.objects.find(o => o.kind === 'source' && o.parentId === made.id);
const madeRows = madeSource ? s1.objects.filter(o => o.kind === 'page' && o.sourceId === madeSource.id).length : 0;
const shownTitle = await page.locator('.page-title, h1').first().textContent().catch(() => '');
ok('템플릿 갤러리: 50개 이상 · 업무 분류 · "버그" 검색 → 사용 → 버그 트래커 페이지와 DB(예시 행) 생성, 그 페이지로 이동',
  allCards >= 50 && workCards > 0 && workCards < allCards && found.length === 1 && !!madeSource && madeRows > 0 && new URL(page.url()).searchParams.get('id') === made?.id,
  `all=${allCards} work=${workCards} found=${found} rows=${madeRows} title=${shownTitle}`);

// 2. Sidebar tabs: + adds a tab (selected), ⌃1 returns to the first, the tab menu deletes it.
await open('home');
const tabCount = () => page.locator('.sidebar-tabs .sidebar-tab[role="tab"]').count();
const before = await tabCount();
await page.locator('.sidebar-tab.add').click(); await page.waitForTimeout(400);
const afterAdd = await tabCount();
const secondSelected = await page.locator('.sidebar-tabs .sidebar-tab[role="tab"]').nth(1).getAttribute('aria-selected');
await page.keyboard.press('Control+1'); await page.waitForTimeout(300);
const firstSelected = await page.locator('.sidebar-tabs .sidebar-tab[role="tab"]').nth(0).getAttribute('aria-selected');
await page.keyboard.press('Control+2'); await page.waitForTimeout(300);
await page.locator('.sidebar-tabs .sidebar-tab[aria-selected="true"]').click(); await page.waitForTimeout(300);
const tabMenu = await menuItems();
await clickMenu('탭 삭제'); await page.waitForTimeout(300);
const afterDelete = await tabCount();
ok('사이드바 탭: + 로 추가(선택됨) · ⌃1/⌃2 전환 · 탭 메뉴 "탭 삭제"', before === 1 && afterAdd === 2 && secondSelected === 'true' && firstSelected === 'true' && tabMenu.includes('탭 삭제') && afterDelete === 1,
  `before=${before} add=${afterAdd} second=${secondSelected} first=${firstSelected} menu=${tabMenu.join('/')} after=${afterDelete}`);

// 3. High contrast.
await openSettings();
await page.locator('input[aria-label="고대비"]').click({ force: true }); await page.waitForTimeout(300);
const contrastOn = await page.evaluate(() => document.documentElement.dataset.contrast);
const textColor = await page.evaluate(() => getComputedStyle(document.body).color);
await page.locator('input[aria-label="고대비"]').click({ force: true }); await page.waitForTimeout(300);
const contrastOff = await page.evaluate(() => document.documentElement.dataset.contrast ?? null);
const plainColor = await page.evaluate(() => getComputedStyle(document.body).color);
ok('고대비: 켜면 html[data-contrast=high] · 글자색 진해짐, 끄면 해제', contrastOn === 'high' && contrastOff === null && textColor !== plainColor, `${contrastOn}/${contrastOff} ${textColor} vs ${plainColor}`);
await closeSettings();

// 4. The display time zone: 09:00 UTC shows as 오후 6:00 in Seoul, 오전 4:00 in New York.
await open('db');
const cellText = () => page.locator('.table-row', { hasText: '회의' }).first().textContent();
const seoul = await cellText();
await openSettings();
await page.locator('select.prefs-select[aria-label="시간대"]').selectOption('America/New_York'); await page.waitForTimeout(300);
const autoLabel = await page.locator('select.prefs-select[aria-label="시간대"] option').first().textContent();
await closeSettings(); await page.waitForTimeout(300);
const newYork = await cellText();
await openSettings();
await page.locator('select.prefs-select[aria-label="시간대"]').selectOption(''); await page.waitForTimeout(300);
await closeSettings();
ok('시간대: 자동(Asia/Seoul)에서 6:00 → America/New_York로 바꾸면 4:00', /6:00/.test(seoul) && /4:00/.test(newYork) && /Asia\/Seoul/.test(autoLabel ?? ''), `seoul=${seoul} ny=${newYork} auto=${autoLabel}`);

// 5. The workspace's own name and icon (일반), shown in the switcher.
await openSettings();
await page.locator('.prefs-nav-item', { hasText: '일반' }).click(); await page.waitForTimeout(300);
await page.locator('input[aria-label="워크스페이스 이름"]').fill('우리 집'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
await page.locator('.workspace-icon-choice').click(); await page.waitForTimeout(400);
await page.locator('.emoji-picker .emoji-grid button, .emoji-picker button.emoji-cell, .emoji-picker [data-emoji]').first().click(); await page.waitForTimeout(700);
await closeSettings();
const identity = await obj('workspace-settings');
const switcherText = await page.locator('.workspace-switcher').textContent();
const markEmoji = await page.locator('.workspace-switcher .workspace-mark').first().textContent().catch(() => '');
ok('워크스페이스 이름 · 아이콘: 일반에서 저장 → 데이터(workspace-settings)와 전환 버튼에 표시', identity?.name === '우리 집' && !!identity?.icon && switcherText.includes('우리 집') && !!markEmoji && markEmoji === identity.icon,
  `name=${identity?.name} icon=${identity?.icon} switcher=${switcherText} mark=${markEmoji}`);

// 6. Another workspace: 새 워크스페이스 만들기 opens it at its own address; the switcher lists both.
await switcher();
await clickMenu('새 워크스페이스 만들기');
await page.waitForURL(url => !url.toString().startsWith(base), { timeout: 8000 }).catch(() => {});
await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
const otherOrigin = new URL(page.url()).origin;
const otherName = await page.locator('.workspace-switcher').textContent().catch(() => '');
const otherDocs = (await stateOf(otherOrigin)).objects.filter(o => o.kind === 'page').length;
await switcher();
const listed = await menuItems();
await page.keyboard.press('Escape');
ok('새 워크스페이스: 다른 주소(포트+10)로 열리고 빈 데이터, 전환 메뉴에 두 워크스페이스', otherOrigin === `http://127.0.0.1:${port + 10}` && otherName.includes('새 워크스페이스') && otherDocs === 0 && listed.includes('우리 집') && listed.includes('새 워크스페이스'),
  `origin=${otherOrigin} name=${otherName} pages=${otherDocs} menu=${listed.slice(0, 4).join('/')}`);

// 7. A page copied, then moved, to the other workspace from the page menu.
await open('doc');
const pageMenu = async () => { await page.locator('.topbar button[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(400); };
await pageMenu();
const pageMenuItems = await menuItems();
await page.locator('.menu-item', { hasText: '다른 워크스페이스로 복제' }).first().hover(); await page.waitForTimeout(500);
await page.locator('.menu-item', { hasText: '새 워크스페이스' }).last().click(); await page.waitForTimeout(1200);
const copiedTitles = (await stateOf(otherOrigin)).objects.filter(o => o.kind === 'page' && o.alive !== false).map(o => o.title).sort();
const stillHere = await obj('doc');
const popup = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
await pageMenu();
await page.locator('.menu-item', { hasText: '다른 워크스페이스로 옮기기' }).first().hover(); await page.waitForTimeout(500);
await page.locator('.menu-item', { hasText: '새 워크스페이스' }).last().click(); await page.waitForTimeout(1500);
const opened = await popup;
const movedOriginal = await obj('doc');
const otherCount = (await stateOf(otherOrigin)).objects.filter(o => o.kind === 'page' && o.alive !== false && o.title === '옮길 문서').length;
ok('다른 워크스페이스로 복제(하위 포함) → 원본 유지, 옮기기 → 원본은 휴지통 · 대상 워크스페이스 창 열림',
  pageMenuItems.includes('다른 워크스페이스로 복제') && copiedTitles.join() === '옮길 문서,하위 문서' && stillHere?.trashed !== true && stillHere?.alive !== false && otherCount === 2 && (movedOriginal?.trashed === true || !!movedOriginal?.trashedAt || movedOriginal?.alive === false) && !!opened && opened.url().startsWith(otherOrigin),
  `menu=${pageMenuItems.includes('다른 워크스페이스로 복제')} copied=${copiedTitles} moved=${JSON.stringify({ trashed: movedOriginal?.trashed, at: movedOriginal?.trashedAt, alive: movedOriginal?.alive })} other=${otherCount} popup=${opened?.url()}`);
await opened?.close();

// 8. A comment an agent writes lands in the inbox as 댓글.
await post([{ type: 'comment.create', id: 'agent-c', parentId: 'm', richText: [{ text: '시간을 확인했습니다' }] }], 'mcp:agent');
await open('home');
await page.locator('[data-inbox-toggle]').click(); await page.waitForTimeout(500);
const inboxRow = await page.locator('.inbox-row', { hasText: '시간을 확인했습니다' }).first().textContent().catch(() => '');
const commentAvatar = await page.locator('.inbox-row', { hasText: '시간을 확인했습니다' }).locator('.inbox-avatar.type-comment').count();
ok('에이전트 댓글 → 받은 알림에 "댓글" 유형으로', /댓글/.test(inboxRow) && commentAvatar === 1, inboxRow);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
