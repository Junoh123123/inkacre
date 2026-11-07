// 8차 점검: 차트(세로·가로 막대, 꺾은선, 도넛, 숫자)와 차트 설정, 보기 추가 메뉴·"N개 더" 메뉴·새 보기 패널,
// 피드·지도·양식 보기. 합성 자료로 점검용 데이터베이스를 새로 만들어 그 안에서만 고친다.
// 사용법: node scripts/ux-trace/local-suite5.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const post = async ops => { const state = await (await fetch(`${base}/api/state`)).json(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: state.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const pid = `suite5-${Date.now()}`, sid = `${pid}-src`, p = name => `${pid}-p-${name}`;
const st = { todo: `${pid}-s1`, doing: `${pid}-s2`, done: `${pid}-s3` };
const ops = [
  { type: 'page.create', id: pid, title: '8차 점검 DB', parentId: null },
  { type: 'source.create', id: sid, pageId: pid, name: '8차 점검 DB', titlePropertyId: p('title') },
  { type: 'property.create', id: p('amount'), sourceId: sid, name: '금액', propertyType: 'number' },
  { type: 'property.create', id: p('status'), sourceId: sid, name: '상태', propertyType: 'status', options: [{ id: st.todo, name: '시작 전', group: '할 일', color: 'gray' }, { id: st.doing, name: '진행 중', group: '진행 중', color: 'blue' }, { id: st.done, name: '완료', group: '완료', color: 'green' }] },
  { type: 'property.create', id: p('place'), sourceId: sid, name: '장소', propertyType: 'place' },
];
[['알파', 12000, st.doing], ['베타', 3500, st.todo], ['감마', 800, st.done], ['델타', 0, st.doing]].forEach(([name, amount, status], i) => {
  ops.push({ type: 'page.create', id: `${pid}-r${i}`, title: `작업 ${name}`, parentId: sid, sourceId: sid }, { type: 'value.set', pageId: `${pid}-r${i}`, propertyId: p('amount'), value: amount }, { type: 'value.set', pageId: `${pid}-r${i}`, propertyId: p('status'), value: status });
});
ops.push({ type: 'value.set', pageId: `${pid}-r0`, propertyId: p('place'), value: { name: '서울시청', latitude: 37.5663, longitude: 126.9779 } });
const views = [['table', '표', {}], ['chart', '차트', { chart: { groupBy: p('status'), aggregation: 'count', type: 'bar' } }], ['feed', '피드', { visibleProperties: [p('title')] }], ['map', '지도', { placePropertyId: p('place') }]];
views.forEach(([viewType, name, config], i) => ops.push({ type: 'view.create', id: `${pid}-v${i}`, sourceId: sid, parentId: pid, name, viewType, config }));
await post(ops);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const rect = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }, sel);
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };

// 1. vertical bars: 16 wide, option colours, value labels, dashed grid
await go(`${pid}-v1`);
const bars = await page.evaluate(() => [...document.querySelectorAll('.chart-bar path')].map(path => { const r = path.getBoundingClientRect(); return [Math.round(r.width), path.getAttribute('fill')]; }));
const labels = await page.evaluate(() => [...document.querySelectorAll('.chart-value-text')].map(t => t.textContent).join(','));
const grid = await page.evaluate(() => document.querySelector('.chart-svg line')?.getAttribute('stroke-dasharray'));
const ticks = await page.evaluate(() => [...document.querySelectorAll('.chart-svg > text[text-anchor="end"]')].map(t => t.textContent).join(','));
ok('값 축: 가장 큰 값 2 → 0…4 (네 칸)', ticks === '0,1,2,3,4', ticks);
ok('세로 막대: 16 폭, 옵션 색, 값 레이블, 점선 격자', bars.length === 3 && bars.every(([w]) => w === 16) && bars[1][1] === 'rgb(94, 159, 232)' && bars[2][1] === 'rgb(114, 188, 143)' && bars[0][1] === 'rgb(199, 198, 196)' && labels === '1,2,1' && grid === '1 3', `${JSON.stringify(bars)} ${labels} ${grid}`);
// 2. settings: docked panel narrows the view; five type tiles; donut and number
await page.getByRole('button', { name: '보기 설정' }).first().click(); await page.waitForTimeout(400);
const panel = await rect('.view-settings'), body = await rect('.db-body');
const tiles = await page.locator('.chart-type-tile').count();
ok('보기 설정: 차트 유형 타일 5개, 패널이 보기를 밀어냄', tiles === 5 && body[0] + body[2] <= panel[0], `${tiles} ${body} ${panel}`);
await page.locator('.chart-type-tile[aria-label="도넛형"]').click(); await page.waitForTimeout(500);
const slices = await page.locator('.chart-slice').count(), center = await page.evaluate(() => document.querySelector('.chart-donut-number')?.textContent);
await page.locator('.chart-type-tile[aria-label="숫자"]').click(); await page.waitForTimeout(500);
const number = await page.evaluate(() => document.querySelector('.chart-number-value')?.textContent);
ok('도넛(조각 3·가운데 4) · 숫자(4)', slices === 3 && center === '4' && number === '4', `${slices} ${center} ${number}`);
await page.locator('.chart-type-tile[aria-label="세로 막대형"]').click(); await page.waitForTimeout(400);
await page.locator('.view-settings .settings-row', { hasText: '정렬' }).first().click(); await page.waitForTimeout(250);
await page.locator('.chart-sort-menu .menu-item', { hasText: '개수 큼 → 작음' }).click(); await page.waitForTimeout(500);
const order = await page.evaluate(() => [...document.querySelectorAll('.chart-svg > text.chart-axis-text')].map(t => t.textContent).filter(t => !/^\d/.test(t)).join(','));
ok('정렬: 개수 큼 → 작음', order.startsWith('진행 중'), order);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.mouse.click(700, 700); await page.waitForTimeout(400);
await page.locator('.chart-bar path').nth(0).click(); await page.waitForTimeout(700);
const drill = await page.evaluate(() => [document.querySelector('.chart-drill-title')?.textContent, document.querySelectorAll('.chart-drill-modal .table-row, .chart-drill-modal [data-row-id]').length]);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('막대를 누르면 그 그룹의 행 창(진행 중 2행)', drill[0] === '진행 중' && drill[1] === 2, JSON.stringify(drill));
ok('패널 밖을 누르면 닫힘', !(await page.evaluate(() => !!document.querySelector('.view-settings'))));
// 3. "+" menu → new chart view with the 새 보기 panel
await go(`${pid}-v0`);
await page.click('.db-tab-add'); await page.waitForTimeout(300);
const add = await rect('.add-view-menu'), tile = await rect('.add-view-tile');
ok('+ 메뉴: 390 폭, 92×62 타일 (8,38)', add?.[2] === 390 && tile?.[2] === 92 && tile?.[3] === 62 && tile[0] - add[0] === 8 && tile[1] - add[1] === 38, `${add} ${tile}`);
await page.mouse.click(400, 600); await page.waitForTimeout(300);
ok('+ 메뉴 밖을 누르면 닫힘', !(await page.evaluate(() => !!document.querySelector('.add-view-menu'))));
await page.click('.db-tab-add'); await page.waitForTimeout(300);
await page.locator('.add-view-tile', { hasText: '갤러리' }).click(); await page.waitForTimeout(800);
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
const title = await page.evaluate(() => document.querySelector('.new-view-title')?.textContent);
await page.locator('.new-view-done .blue-button').click(); await page.waitForTimeout(400);
ok('보기 추가 → "새 보기" 패널(이름 칸에 포커스) → 완료로 닫힘', title === '새 보기' && focused === '보기 이름' && !(await page.evaluate(() => !!document.querySelector('.view-settings'))), `${title} ${focused}`);
// 4. feed
await go(`${pid}-v2`);
const card = await rect('.feed-card'), titleSize = await page.evaluate(() => getComputedStyle(document.querySelector('.feed-title')).fontSize);
ok('피드: 752 폭 카드, 제목 26px, 작성자 줄, 속성 없음', card?.[2] === 752 && titleSize === '26px' && !!(await rect('.feed-card-head')) && !(await rect('.feed-fields')), `${card} ${titleSize}`);
await page.locator('.feed-comment-box').first().click(); await page.keyboard.type('피드 댓글'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
ok('피드 카드에서 댓글 달기', (await page.evaluate(() => document.querySelector('.feed-comment-text')?.textContent)) === '피드 댓글');
// 5. map
await go(`${pid}-v3`); await page.waitForTimeout(800);
const land = await page.evaluate(() => (document.querySelector('.map-land')?.getAttribute('d') ?? '').length);
const unlocated = await page.evaluate(() => document.querySelector('.map-unlocated-button')?.textContent);
ok('지도: 육지·국경 그림, 핀 1개, "지도 보기에 위치 없음(3)"', land > 10000 && (await page.locator('.map-pin').count()) === 1 && unlocated === '지도 보기에 위치 없음(3)', `${land} ${unlocated}`);
await page.click('.map-control'); await page.waitForTimeout(200);
const canvasBox = await page.locator('.map-canvas').boundingBox();
await page.mouse.click(canvasBox.x + 200, canvasBox.y + 300); await page.waitForTimeout(900);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
ok('지도: 핀 추가 모드 → 지도를 누르면 그 자리에 새 항목', (await page.locator('.map-pin').count()) === 2, String(await page.locator('.map-pin').count()));
await page.click('.map-unlocated-button'); await page.waitForTimeout(300);
await page.keyboard.type('알파'); await page.waitForTimeout(200);
const listed = await page.evaluate(() => [...document.querySelectorAll('.map-unlocated-list .menu-item')].map(e => e.textContent));
await page.keyboard.press('Escape');
ok('지도: 위치 없음 목록 320 폭, 검색', listed.length === 0 || listed.every(text => text.includes('알파')), JSON.stringify(listed));
// 6. form: the questions dialog, the builder and a submission from the preview
await go(`${pid}-v0`);
await page.click('.db-tab-add'); await page.waitForTimeout(300);
await page.locator('.add-view-tile', { hasText: '양식' }).click(); await page.waitForTimeout(700);
const dialog = await page.evaluate(() => document.querySelector('.form-questions-ok')?.textContent);
await page.locator('.form-questions-ok').click(); await page.waitForTimeout(600);
const question = await rect('.form-question');
await page.locator('.form-preview-button').click(); await page.waitForTimeout(300);
await page.locator('.form-answer-input').first().fill('양식 응답'); await page.locator('.form-submit').click(); await page.waitForTimeout(700);
const state = await (await fetch(`${base}/api/state`)).json();
const made = Object.values(state.objects).some(item => item.kind === 'page' && item.sourceId === sid && item.title === '양식 응답');
await page.locator('.form-preview-button').click(); await page.waitForTimeout(300);
// The card itself only selects; its "⋯" opens 질문 옵션.
await page.locator('.form-question').first().hover(); await page.locator('.form-question-more').first().click(); await page.waitForTimeout(300);
const optionsTitle = await page.evaluate(() => document.querySelector('.form-options-head')?.textContent);
await page.locator('.form-options .chart-card-row', { hasText: '필수' }).click(); await page.waitForTimeout(500);
const required = await page.evaluate(() => !!document.querySelector('.form-question-required'));
await page.keyboard.press('Escape');
ok('양식: 질문을 고르면 "질문 옵션" 카드, 필수 켜기', optionsTitle === '질문 옵션' && required, `${optionsTitle} ${required}`);
ok('양식: 질문 만들기 창 → 600 폭 질문 카드 → 미리 보기에서 제출하면 항목 생김', /질문 \d+개 만들기/.test(dialog ?? '') && question?.[2] === 600 && made, `${dialog} ${question}`);
await page.setViewportSize({ width: 600, height: 827 }); await go(`${pid}-v3`); await page.waitForTimeout(500);
const switcher = await page.evaluate(() => document.querySelector('.db-tab-switcher')?.textContent);
ok('좁은 창: 탭이 "<보기> ⌄" 하나로 접힘', !!switcher && switcher.includes('지도'), switcher);
ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
