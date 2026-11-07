// 17차 점검(사이드바 바로가기): DB "새로 만들기 ⌄"의 "사이드바에 바로가기 추가" → 라이브러리 아래 "새 페이지는 <DB>에
// 만들어집니다." 줄(방금 추가한 줄 표시), 누르면 그 DB에 새 페이지를 만들어 전체 페이지로 열기, … 메뉴(240: 바로가기 이름 바꾸기 ·
// 표시 형식 › · <DB> 열기 · 템플릿 › · 보기에 추가 › | 위로 · 바로가기 삭제 | 사이드바 사용자 지정), 이름 바꾸기.
// 보기 탭 메뉴의 "보기를 사이드바에 추가" → "<보기> · <DB>" 섹션(행 5개, 누르면 사이드 보기), 섹션 … 메뉴, 표시 개수, 섹션 삭제 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite15.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const root = `suite15-${Date.now()}`, db = `${root}-db`, sid = `${db}-src`;
const ops = [
  { type: 'page.create', id: root, title: '바로가기 점검', parentId: null },
  { type: 'page.create', id: db, title: '할 일 DB', parentId: root },
  { type: 'source.create', id: sid, pageId: db, name: '할 일 DB', titlePropertyId: `${db}-title` },
  { type: 'view.create', id: `${db}-v0`, sourceId: sid, parentId: db, name: 'Default view', viewType: 'table', config: {} },
  { type: 'view.create', id: `${db}-v1`, sourceId: sid, parentId: db, name: '목록', viewType: 'list', config: {} },
];
for (let i = 1; i <= 7; i++) ops.push({ type: 'page.create', id: `${db}-r${i}`, title: `행 ${i}`, parentId: sid, sourceId: sid });
await post(ops);
const rowsInDb = async () => (await state()).objects.filter(o => o.kind === 'page' && o.sourceId === sid && o.alive !== false && !o.template).length;

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${db}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const menuItems = () => page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); return m ? [...m.querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|') : '-'; });

// 1. 새로 만들기 ⌄ → 사이드바에 바로가기 추가 → 라이브러리 아래 줄(방금 추가 표시)
await page.locator('.db-new-more').first().click(); await page.waitForTimeout(400);
const newMenu = await menuItems();
await page.locator('.menu .menu-item', { hasText: '사이드바에 바로가기 추가' }).click(); await page.waitForTimeout(400);
const shortcut = await page.evaluate(() => { const r = document.querySelector('.sidebar-page-shortcut'); const prev = r?.previousElementSibling; return r ? { text: r.textContent, flash: r.classList.contains('just-added'), afterLibrary: prev?.textContent === '라이브러리', h: Math.round(r.getBoundingClientRect().height) } : null; });
ok('새로 만들기 ⌄ 끝의 "사이드바에 바로가기 추가" → 라이브러리 아래 "새 페이지는 할 일 DB에 만들어집니다."(표시)', newMenu.endsWith('사이드바에 바로가기 추가') && shortcut?.text === '새 페이지는 할 일 DB에 만들어집니다.' && shortcut.flash && shortcut.afterLibrary && shortcut.h === 30, `${newMenu} ${JSON.stringify(shortcut)}`);

// 2. 누르면 그 DB에 새 페이지, 전체 페이지로 열림
const before = await rowsInDb();
await page.locator('.sidebar-page-shortcut').click(); await page.waitForTimeout(1500);
const after = await rowsInDb();
const opened = await page.evaluate(() => new URL(location.href).searchParams.get('id'));
const newest = (await state()).objects.filter(o => o.kind === 'page' && o.sourceId === sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
ok('바로가기를 누르면 DB에 새 페이지를 만들어 전체 페이지로 엶', after === before + 1 && opened === newest?.id, `${before}→${after} ${opened} ${newest?.id}`);

// 3. … 메뉴(240)
await page.locator('.sidebar-page-shortcut').hover(); await page.locator('.sidebar-page-shortcut .icon-button').click(); await page.waitForTimeout(400);
const shortcutMenu = await page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); return { items: [...m.querySelectorAll('.menu-item')].map(e => e.textContent).join('|'), w: Math.round(m.getBoundingClientRect().width) }; });
ok('… 메뉴: 바로가기 이름 바꾸기 · 표시 형식:전체 페이지 · 할 일 DB 열기 · 템플릿 비어 있음 · 보기에 추가 Default view · 위로 · 바로가기 삭제 · 사이드바 사용자 지정 (240)', shortcutMenu.items === '바로가기 이름 바꾸기|표시 형식:전체 페이지|할 일 DB 열기|템플릿비어 있음|보기에 추가Default view|위로|바로가기 삭제|사이드바 사용자 지정' && shortcutMenu.w === 240, JSON.stringify(shortcutMenu));

// 4. 이름 바꾸기 → "새 할 일" → 줄 이름이 바뀜(새로 고쳐도 유지)
await page.locator('.menu .menu-item', { hasText: '바로가기 이름 바꾸기' }).click(); await page.waitForTimeout(300);
await page.keyboard.press('Meta+A'); await page.keyboard.type('새 할 일'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
ok('바로가기 이름 바꾸기 → "새 할 일"(새로 고쳐도)', (await page.locator('.sidebar-page-shortcut .sidebar-row-label').textContent()) === '새 할 일');

// 5. 보기 탭 메뉴 → 보기를 사이드바에 추가 → "Default view · 할 일 DB" 섹션(5행 + 모두 보기), 누르면 사이드 보기
await page.goto(`${base}/?id=${db}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
await page.locator('.db-tab.active').first().click(); await page.waitForTimeout(400);
const tabMenu = await menuItems();
await page.locator('.menu .menu-item', { hasText: '보기를 사이드바에 추가' }).click(); await page.waitForTimeout(1200);
const section = await page.evaluate(() => { const s = document.querySelector('.sidebar-view-section'); return s ? { head: s.querySelector('.sidebar-section-label').textContent, rows: s.querySelectorAll('[role=treeitem]').length, more: !!s.querySelector('.sidebar-more'), flash: s.classList.contains('just-added') } : null; });
await page.locator('.sidebar-view-section [role=treeitem]').first().click(); await page.waitForTimeout(800);
const peek = await page.evaluate(() => { const u = new URL(location.href); return `${u.searchParams.get('id')}|${u.searchParams.get('p') ?? u.searchParams.get('peek') ?? ''}`; });
ok('보기 탭 메뉴 "보기를 사이드바에 추가"(보기 링크 복사 다음) → "Default view · 할 일 DB" 5행 + 모두 보기, 행은 사이드 보기로', tabMenu.includes('보기 링크 복사|보기를 사이드바에 추가') && section?.head === 'Default view · 할 일 DB' && section.rows === 5 && section.more && section.flash && !!(await page.locator('.peek').count()), `${tabMenu} ${JSON.stringify(section)} ${peek}`);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// 6. 섹션 … 메뉴 → 표시 10 → 8행 모두 보임, 섹션 삭제
await page.locator('.sidebar-view-section .sidebar-section-head').hover(); await page.locator('.sidebar-view-section [aria-label="메뉴 열기"]').click(); await page.waitForTimeout(400);
const sectionMenu = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|'));
await page.locator('.menu .menu-item', { hasText: /^표시5$/ }).hover(); await page.waitForTimeout(500);
await page.locator('.menu .menu-item', { hasText: /^10$/ }).click(); await page.waitForTimeout(800);
const rows10 = await page.locator('.sidebar-view-section [role=treeitem]').count();
await page.locator('.sidebar-view-section .sidebar-section-head').hover(); await page.locator('.sidebar-view-section [aria-label="메뉴 열기"]').click(); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: '섹션 삭제' }).click(); await page.waitForTimeout(300);
ok('섹션 … 메뉴: 이름 바꾸기 · 표시 형식 · 표시 · 페이지 아이콘 표시 · 소스 · 보기 · 템플릿 · 위로 · 섹션 삭제 · 사이드바 사용자 지정, 표시 10 → 8행, 섹션 삭제', sectionMenu === '이름 바꾸기|표시 형식:|표시|페이지 아이콘 표시|소스|보기|템플릿|위로|섹션 삭제|사이드바 사용자 지정' && rows10 === 8 && !(await page.locator('.sidebar-view-section').count()), `${sectionMenu} rows=${rows10}`);

// 7. 바로가기 삭제
await page.locator('.sidebar-page-shortcut').hover(); await page.locator('.sidebar-page-shortcut .icon-button').click(); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: '바로가기 삭제' }).click(); await page.waitForTimeout(300);
ok('바로가기 삭제 → 줄이 사라짐', !(await page.locator('.sidebar-page-shortcut').count()));

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
