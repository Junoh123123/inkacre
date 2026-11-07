// 11차 점검: 1512×828 창(스크롤 막대 보임)에서 합성 "측정 DB"로 잰 자리 — 이동 경로, 도구 막대,
// 표 아이콘, 보드 카드 간격, 달력·타임라인 머리, 피드·지도 자리, 보기 메뉴, 사이드 보기와 그 옆 화면.
// 사용법: node scripts/ux-trace/local-suite7.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const post = async ops => { const state = await (await fetch(`${base}/api/state`)).json(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: state.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const root = `suite7-${Date.now()}`, ui = `${root}-ui`, db = `${root}-db`, sid = `${db}-src`, p = name => `${db}-p-${name}`;
const st = { todo: `${db}-s1`, doing: `${db}-s2`, done: `${db}-s3` };
const ops = [
  { type: 'page.create', id: root, title: '분석 실험 모음 2026-10-19', parentId: null },
  { type: 'page.create', id: ui, title: 'UI 점검 2026-10-23', parentId: root },
  { type: 'page.create', id: db, title: '측정 DB', parentId: ui },
  { type: 'source.create', id: sid, pageId: db, name: '측정 DB', titlePropertyId: p('title') },
  { type: 'property.create', id: p('place'), sourceId: sid, name: '장소', propertyType: 'place' },
  { type: 'property.create', id: p('amount'), sourceId: sid, name: '금액', propertyType: 'number' },
  { type: 'property.create', id: p('status'), sourceId: sid, name: '상태', propertyType: 'status', options: [{ id: st.todo, name: '시작 전', group: '할 일', color: 'gray' }, { id: st.doing, name: '진행 중', group: '진행 중', color: 'blue' }, { id: st.done, name: '완료', group: '완료', color: 'green' }] },
  { type: 'property.create', id: p('date'), sourceId: sid, name: '일정', propertyType: 'date' },
];
[['베타', st.todo, { start: '2026-10-23' }], ['델타', st.doing, null], ['감마', st.done, { start: '2026-10-27', end: '2026-10-30' }], ['알파', st.doing, { start: '2026-10-21', end: '2026-10-24' }]].forEach(([name, status, date], i) => {
  ops.push({ type: 'page.create', id: `${db}-r${i}`, title: `측정 작업 ${name}`, parentId: sid, sourceId: sid }, { type: 'value.set', pageId: `${db}-r${i}`, propertyId: p('status'), value: status });
  if (date) ops.push({ type: 'value.set', pageId: `${db}-r${i}`, propertyId: p('date'), value: date });
});
const views = [['table', 'Default view', {}], ['board', '보드', { groupBy: p('status'), visibleProperties: [p('title')] }], ['calendar', '달력', { datePropertyId: p('date') }], ['timeline', '타임라인', { datePropertyId: p('date') }], ['feed', '피드', { visibleProperties: [p('title')] }], ['map', '지도', { placePropertyId: p('place') }]];
views.forEach(([viewType, name, config], i) => ops.push({ type: 'view.create', id: `${db}-v${i}`, sourceId: sid, parentId: db, name, viewType, config }));
await post(ops);

// These checks expect always-shown scrollbars; Playwright hides them unless told not to.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const boxes = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); }), sel);
const near = (a, b, d = 1.5) => Math.abs(a - b) <= d;

// 1. table: breadcrumb without the view, toolbar buttons touching, row icons
await go(`${db}-v0`);
const crumbs = await page.evaluate(() => [...document.querySelectorAll('.crumb')].map(e => e.textContent.trim()));
const crumbBoxes = await boxes('.crumb');
ok('이동 경로: 보기 이름 없이 "… / UI 점검 / 측정 DB", 첫 칸 172 폭(160에서 자름), 구분 6', crumbs.length === 3 && crumbs[2] === '측정 DB' && near(crumbBoxes[0][2], 172) && near(crumbBoxes[1][0] - (crumbBoxes[0][0] + crumbBoxes[0][2]), 6), JSON.stringify(crumbBoxes));
const tools = await boxes('.db-toolbar .db-tool');
ok('도구 단추 28 간격, 보기 설정 뒤 6 띄고 새로 만들기, 오른쪽 끝 1408', tools.every((b, i) => !i || near(b[0] - tools[i - 1][0], 28, 0.2)) && near((await boxes('.db-new'))[0][0] - (tools[tools.length - 1][0] + 28), 6, 0.2) && near((await boxes('.db-new-more'))[0][0] + 24, 1408), JSON.stringify(tools.map(b => b[0])));
const icons = await boxes('.table-row [data-col="0"] .title-icon svg');
ok('표 제목 칸 아이콘 y = 줄 위 +9.5 (382,212)', icons.length === 4 && near(icons[0][0], 382) && near(icons[0][1], 212, 0.6), JSON.stringify(icons[0]));

// 2. board: cards 48 apart, 20px status icon, name right after it
await go(`${db}-v1`);
const cards = await page.evaluate(() => [...document.querySelectorAll('.board-column')].map(col => [...col.querySelectorAll('.row-card')].map(c => Math.round(c.getBoundingClientRect().y * 10) / 10)));
const groupIcon = await page.evaluate(() => { const t = document.querySelector('.board-group-title'); const svg = t.querySelector('svg').getBoundingClientRect(); const name = t.querySelector('.board-group-name').getBoundingClientRect(); return [svg.width, Math.round(name.x - svg.right)]; });
ok('보드: 카드 48 간격, 상태 아이콘 20, 이름은 4 뒤', cards[1].length === 2 && near(cards[1][1] - cards[1][0], 48, 0.2) && groupIcon[0] === 20 && groupIcon[1] === 4, `${JSON.stringify(cards)} ${groupIcon}`);

// 3. calendar: 1px in, weekday row at +44, nav 24-high buttons flush right
await go(`${db}-v2`);
const day = (await boxes('.calendar-day'))[0], weekdays = (await boxes('.calendar-weekdays'))[0], nav = await boxes('.calendar-head > button');
ok('달력: 칸 375부터 145.4, 요일 줄 210.4, ‹ 오늘 › 1305·1329·1369 (24 높이)', near(day[0], 375, 0.2) && near(day[2], 145.4, 0.2) && near(weekdays[1], 210.4, 0.2) && nav.length === 3 && near(nav[0][0], 1305) && near(nav[1][0], 1329) && near(nav[2][0], 1369) && nav.every(b => b[3] === 24), JSON.stringify(nav));

// 4. timeline: controls 9px down, "날짜 없음" in the toolbar
await go(`${db}-v3`);
const tl = await boxes('.timeline-toolbar button');
const undatedInToolbar = await page.evaluate(() => !!document.querySelector('.db-toolbar .calendar-undated') && !document.querySelector('.timeline-toolbar .calendar-undated'));
ok('타임라인: » 177.9, ‹ 오늘 › 1328·1352·1392 (176.9), 날짜 없음은 도구 막대에', near(tl[0][1], 177.9, 0.2) && near(tl[tl.length - 3][0], 1328) && near(tl[tl.length - 2][0], 1352) && near(tl[tl.length - 1][0], 1392) && near(tl[tl.length - 1][1], 176.9, 0.2) && undatedInToolbar, JSON.stringify(tl.map(b => b.slice(0, 2))));

// 5. feed and map
await go(`${db}-v4`);
const feed = (await boxes('.feed-card'))[0];
ok('피드: 첫 카드 507.5,180.4 752 폭', near(feed[0], 507.5) && near(feed[1], 180.4, 0.2) && near(feed[2], 752, 0.2), JSON.stringify(feed));
await go(`${db}-v5`);
const canvas = (await boxes('.map-canvas'))[0], control = (await boxes('.map-control'))[0];
const sortButton = await page.locator('.db-toolbar button[aria-label="정렬"]').count();
ok('지도: 캔버스 374,174.4 1026×600, 핀 단추 1366,184.4, 정렬 단추 없음', near(canvas[0], 374) && near(canvas[1], 174.4, 0.2) && near(canvas[2], 1026, 0.2) && near(control[0], 1366) && near(control[1], 184.4, 0.2) && sortButton === 0, `${JSON.stringify(canvas)} ${JSON.stringify(control)}`);

// 6. views menu: list starts 4px nearer the search field
await page.setViewportSize({ width: 1000, height: 828 }); await go(`${db}-v0`);
await page.locator('.db-tab-more, .db-tab-switcher').first().click(); await page.waitForTimeout(400);
const menu = (await boxes('.views-menu'))[0], firstRow = (await boxes('.views-menu-row'))[0], field = (await boxes('.views-menu-search input'))[0];
ok('보기 메뉴: 검색 칸 +12, 첫 행 +52', near(field[1] - menu[1], 12, 0.2) && near(firstRow[1] - menu[1], 52, 0.2), `${menu[1]} ${field[1]} ${firstRow[1]}`);
await page.keyboard.press('Escape');

// 7. side peek and the page beside it
await page.setViewportSize({ width: 1512, height: 828 }); await go(`${db}-v0`);
await page.locator('.table-row').first().hover(); await page.locator('.table-row .row-open').first().click(); await page.waitForTimeout(1000);
await page.mouse.move(500, 600); await page.waitForTimeout(300);
const hidden = await page.evaluate(() => [...document.querySelectorAll('.peek-header .peek-reveal')].map(e => getComputedStyle(e).opacity));
await page.mouse.move(1000, 22); await page.waitForTimeout(300);
const headIcons = await page.evaluate(() => [...document.querySelectorAll('.peek-header-left svg')].map(s => Math.round(s.getBoundingClientRect().x)));
const rightButtons = await boxes('.peek-header-right .icon-button');
const propIcon = (await boxes('.peek .property-name .icon'))[0];
ok('사이드 보기 머리: 평소 » ⤢만, 올리면 보기 방식 · ↑ ↓ (770·798·837·878·904), 오른쪽 28 단추 끝 1502', hidden.every(o => o === '0') && JSON.stringify(headIcons) === '[770,798,837,878,904]' && rightButtons.every(b => b[2] === 28) && near(rightButtons[rightButtons.length - 1][0] + 28, 1502), `${hidden} ${headIcons} ${JSON.stringify(rightButtons.map(b => b[0]))}`);
ok('사이드 보기 속성 아이콘 16 (841,143)', propIcon && propIcon[2] === 16 && near(propIcon[0], 841) && near(propIcon[1], 143), JSON.stringify(propIcon));
const beside = await page.evaluate(() => { const r = e => { const b = document.querySelector(e)?.getBoundingClientRect(); return b ? [b.x, b.y, b.width].map(v => Math.round(v * 10) / 10) : null; }; return { title: r('.db-page-title'), switcher: r('.db-tab-switcher'), right: r('.db-new-more'), tools: [...document.querySelectorAll('.db-toolbar .db-tool')].filter(e => e.getBoundingClientRect().width).map(e => e.getAttribute('aria-label')), topRight: getComputedStyle(document.querySelector('.main-frame .topbar-right')).display }; });
ok('사이드 보기 옆: 제목 y 108, "Default view ⌄" 147 폭, 도구는 보기 설정만, 오른쪽 끝 732, 위 막대 오른쪽 숨김', beside.title && near(beside.title[1], 108, 0.2) && beside.switcher && near(beside.switcher[2], 147.2, 1) && JSON.stringify(beside.tools) === '["보기 설정"]' && near(beside.right[0] + 24, 732) && beside.topRight === 'none', JSON.stringify(beside));
ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
