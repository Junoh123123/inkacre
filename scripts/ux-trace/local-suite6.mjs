// 10차 점검: 도구 막대의 필터·정렬 버튼(규칙이 있으면 칩 줄을 숨기고 다시 보임), 정렬 편집기 배치,
// 옵션 필터의 태그 입력칸, 걸러져 빈 표의 "필터 편집"·"새 페이지", 보기 설정 › 필터 목록, 차트 막대를 눌러 연
// 창의 칩·"+ 필터"·⋯·"필터 편집". 합성 자료로 점검용 데이터베이스를 새로 만들어 그 안에서만 고친다.
// 사용법: node scripts/ux-trace/local-suite6.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const post = async ops => { const state = await (await fetch(`${base}/api/state`)).json(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: state.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const viewOf = async id => (await (await fetch(`${base}/api/state`)).json()).objects.find(item => item.id === id);

const pid = `suite6-${Date.now()}`, sid = `${pid}-src`, p = name => `${pid}-p-${name}`;
const tag = { dev: `${pid}-t1`, design: `${pid}-t2`, research: `${pid}-t3` };
const ops = [
  { type: 'page.create', id: pid, title: '10차 점검 DB', parentId: null },
  { type: 'source.create', id: sid, pageId: pid, name: '10차 점검 DB', titlePropertyId: p('title') },
  { type: 'property.create', id: p('amount'), sourceId: sid, name: '금액', propertyType: 'number' },
  { type: 'property.create', id: p('memo'), sourceId: sid, name: '메모', propertyType: 'text' },
  { type: 'property.create', id: p('tag'), sourceId: sid, name: '태그', propertyType: 'multi_select', options: [{ id: tag.dev, name: '개발', color: 'blue' }, { id: tag.design, name: '디자인', color: 'pink' }, { id: tag.research, name: '조사', color: 'green' }] },
];
[['알파', 12000, [tag.dev, tag.design]], ['베타', 3500, [tag.research]], ['감마', 800, []], ['델타', 0, [tag.dev]]].forEach(([name, amount, tags], i) => {
  ops.push({ type: 'page.create', id: `${pid}-r${i}`, title: `작업 ${name}`, parentId: sid, sourceId: sid }, { type: 'value.set', pageId: `${pid}-r${i}`, propertyId: p('amount'), value: amount }, { type: 'value.set', pageId: `${pid}-r${i}`, propertyId: p('tag'), value: tags });
});
const views = [['table', '표', {}], ['chart', '차트', { chart: { groupBy: p('tag'), aggregation: 'count', type: 'bar' } }]];
views.forEach(([viewType, name, config], i) => ops.push({ type: 'view.create', id: `${pid}-v${i}`, sourceId: sid, parentId: pid, name, viewType, config }));
await post(ops);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
const has = sel => page.evaluate(sel => !!document.querySelector(sel), sel);
const texts = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].map(e => e.textContent.trim()), sel);
const tool = name => page.locator(`.db-toolbar button[aria-label="${name}"]`);

// 1. filter button: no rule → picker; with a rule → hides / brings back the chip bar
await go(`${pid}-v0`);
await tool('필터').click(); await page.waitForTimeout(300);
await page.locator('.popover-panel .menu-item', { hasText: '메모' }).first().click(); await page.waitForTimeout(400);
await page.keyboard.type('메'); await page.waitForTimeout(700);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await post([{ type: 'value.set', pageId: `${pid}-r0`, propertyId: p('memo'), value: '메모 있음' }]); await page.waitForTimeout(500);
ok('규칙 추가 뒤 칩 줄과 칩', await has('.filter-bar') && (await texts('.filter-bar .filter-chip')).some(t => t.startsWith('메모')), (await texts('.filter-bar .filter-chip')).join(','));
await tool('필터').click(); await page.waitForTimeout(300);
const hidden = !(await has('.filter-bar')) && !(await has('.popover-panel'));
const stillActive = await page.evaluate(() => document.querySelector('.db-toolbar button[aria-label="필터"]')?.classList.contains('active'));
const rows = await page.locator('.table-row').count();
ok('규칙이 있을 때 필터 버튼: 칩 줄을 숨김(규칙은 그대로, 버튼은 파란색)', hidden && stillActive && rows === 1, `rows=${rows}`);
await tool('필터').click(); await page.waitForTimeout(300);
ok('다시 누르면 칩 줄이 돌아옴', await has('.filter-bar') && !(await has('.popover-panel')));

// 2. sort: picker → sort chip "↑ 이름" with the editor open under it; toggling; direction menu
await tool('정렬').click(); await page.waitForTimeout(300);
await page.locator('.popover-panel .menu-item', { hasText: '이름' }).first().click(); await page.waitForTimeout(600);
const sortOpen = await page.evaluate(() => { const pop = document.querySelector('.sort-popover'); const chip = document.querySelector('.sort-chip'); if (!pop || !chip) return null; const a = pop.getBoundingClientRect(), b = chip.getBoundingClientRect(); return { w: Math.round(a.width), under: Math.abs(a.x - b.x) < 2 && a.y > b.bottom, fields: [...pop.querySelectorAll('.sort-field')].map(f => [Math.round(f.getBoundingClientRect().width), Math.round(f.getBoundingClientRect().height), f.textContent]), actions: [...pop.querySelectorAll('.sort-action')].map(a => a.textContent) }; });
ok('정렬 기준을 고르면 칩 아래에 정렬 편집기(335 폭, 32 높이 칸, 방향 150 폭)', !!sortOpen && sortOpen.w === 335 && sortOpen.under && sortOpen.fields[1][0] === 150 && sortOpen.fields.every(f => f[1] === 32) && sortOpen.fields[1][2].includes('A→Z') && sortOpen.actions.join('|') === '정렬 추가|정렬 삭제', JSON.stringify(sortOpen));
await page.locator('.sort-field.direction').click(); await page.waitForTimeout(300);
const dirItems = await texts('.popover-panel .menu-item-label');
await page.locator('.popover-panel .menu-item', { hasText: 'Z→A' }).first().click(); await page.waitForTimeout(500);
const sorts = (await viewOf(`${pid}-v0`)).config.sorts;
ok('방향 목록(A→Z · Z→A)에서 내림차순', dirItems.some(t => t.includes('Z→A')) && sorts?.[0]?.direction === 'desc', JSON.stringify(sorts));
await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await tool('정렬').click(); await page.waitForTimeout(300);
const sortHidden = !(await has('.filter-bar'));
await tool('정렬').click(); await page.waitForTimeout(400);
ok('정렬이 있을 때 정렬 버튼: 숨김 → 다시 보이며 편집기 열림', sortHidden && await has('.filter-bar') && await has('.sort-popover'));
await page.locator('.sort-action', { hasText: '정렬 삭제' }).click(); await page.waitForTimeout(400);
ok('정렬 삭제', !(await viewOf(`${pid}-v0`)).config.sorts?.length && !(await has('.sort-popover')));

// 3. option filter: tag field, search, × and ⓧ
await page.locator('.filter-bar .filter-add').click(); await page.waitForTimeout(300);
const offered = await texts('.popover-panel .menu-item-label');
await page.locator('.popover-panel .menu-item', { hasText: '태그' }).first().click(); await page.waitForTimeout(500);
const field = await page.evaluate(() => { const f = document.querySelector('.filter-rule-popover .filter-token-field'); const pop = document.querySelector('.filter-rule-popover'); return f && pop ? { w: Math.round(f.getBoundingClientRect().width), pw: Math.round(pop.getBoundingClientRect().width), focus: document.activeElement?.classList.contains('filter-token-input'), placeholder: document.activeElement?.getAttribute('placeholder') } : null; });
ok('이미 거른 속성(메모)은 "+ 필터" 목록에 없음', !offered.includes('메모'), offered.join(','));
ok('옵션 필터: 236 폭 입력칸에 포커스, 자리표시', !!field && field.w === 236 && field.pw === 260 && field.focus && field.placeholder === '옵션을 하나 이상 선택…', JSON.stringify(field));
await page.keyboard.type('조'); await page.waitForTimeout(200);
const listed = await texts('.filter-rule-popover .filter-option');
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const token = await texts('.filter-rule-popover .filter-token-field .tag-text');
ok('입력으로 옵션 검색, Enter로 선택 → 태그', listed.length === 1 && listed[0] === '조사' && token.join() === '조사', `${listed.join(',')} / ${token.join(',')}`);
await page.locator('.filter-rule-popover .filter-field-clear').click(); await page.waitForTimeout(400);
ok('ⓧ로 선택 지우기', !(await texts('.filter-rule-popover .filter-token-field .tag-text')).length);
await page.locator('.filter-rule-popover .filter-option', { hasText: '개발' }).click(); await page.waitForTimeout(400);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('칩 문구: "태그: 포함 개발"', (await texts('.filter-bar .filter-chip')).some(t => t.startsWith('태그:') && t.includes('포함 개발')), (await texts('.filter-bar .filter-chip')).join(','));

// 4. nothing left: "필터 편집" and "새 페이지"; 필터 편집 opens the settings' 필터 list without a way back
await page.locator('.filter-bar .filter-chip', { hasText: '메모' }).click(); await page.waitForTimeout(300);
await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('없는 값'); await page.waitForTimeout(700);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const empty = await page.evaluate(() => { const band = document.querySelector('.table-empty'); if (!band) return null; const r = band.getBoundingClientRect(); return { h: Math.round(r.height), buttons: [...band.querySelectorAll('button')].map(b => [b.textContent, Math.round(b.getBoundingClientRect().height)]), newRow: !!document.querySelector('.table-new-row') }; });
ok('걸러져 빈 표: 144 높이 띠에 "필터 편집"·"새 페이지"(28 높이), 새 페이지 줄 없음', !!empty && empty.h === 144 && empty.buttons.map(b => b[0]).join('|') === '필터 편집|새 페이지' && empty.buttons.every(b => b[1] === 28) && !empty.newRow, JSON.stringify(empty));
await page.locator('.table-empty-button', { hasText: '필터 편집' }).click(); await page.waitForTimeout(500);
const panel = await page.evaluate(() => { const head = document.querySelector('.view-settings .settings-head, .settings-panel .settings-head'); return { title: head?.querySelector('.settings-title')?.textContent, back: !!head?.querySelector('[aria-label="뒤로"]'), chips: [...document.querySelectorAll('.filter-rule-item .filter-chip')].map(c => c.textContent), add: document.querySelector('.filter-rule-add')?.textContent }; });
ok('"필터 편집" → 필터 목록(뒤로 없음, 칩 2개, 필터 추가)', panel.title === '필터' && !panel.back && panel.chips.length === 2 && panel.add === '필터 추가', JSON.stringify(panel));
await page.locator('.filter-rule-item .filter-chip', { hasText: '메모' }).click(); await page.waitForTimeout(300);
await page.locator('.filter-rule-popover .filter-rule-more').click(); await page.waitForTimeout(200);
await page.locator('.popover-panel .menu-item', { hasText: '필터 삭제' }).click(); await page.waitForTimeout(500);
const left = (await viewOf(`${pid}-v0`)).config.filter;
ok('목록에서 규칙 삭제(바로 적용)', JSON.stringify(left).includes(tag.dev) && !JSON.stringify(left).includes(p('memo')), JSON.stringify(left));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// 5. chart: the toolbar has no sort or search; the drill's chips, "+ 필터", ⋯ and 필터 편집 work
await go(`${pid}-v1`);
ok('차트 보기 도구: 필터·보기 설정만(정렬·검색 없음)', await tool('필터').count() === 1 && await tool('정렬').count() === 0 && await tool('검색').count() === 0);
const barBox = await page.locator('.chart-bar path').nth(1).boundingBox();
await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height - 4); await page.waitForTimeout(700);
const modal = await page.evaluate(() => { const e = document.querySelector('.chart-drill-modal'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), chips: [...e.querySelectorAll('.chart-drill-chips .filter-chip')].map(c => c.textContent), rows: e.querySelectorAll('.table-row').length }; });
ok('막대 → 800 폭 창, 그룹 조건 칩', !!modal && modal.w === 800 && modal.h === Math.round(827 * 0.6) && modal.chips.length === 1 && modal.chips[0].startsWith('태그:'), JSON.stringify(modal));
await page.locator('.chart-drill-chips .filter-add').click(); await page.waitForTimeout(300);
const drillOffered = await texts('.popover-panel .menu-item-label');
await page.locator('.popover-panel .menu-item', { hasText: '금액' }).first().click(); await page.waitForTimeout(400);
const numberOpen = await has('.filter-rule-popover');
await page.keyboard.type('999999'); await page.waitForTimeout(700);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const drillEmpty = await page.evaluate(() => [...document.querySelectorAll('.chart-drill-modal .table-empty-button')].map(b => b.textContent));
ok('창의 "+ 필터": 이미 쓴 속성 제외, 새 규칙 편집기, 걸러져 비면 "필터 편집"만', !drillOffered.includes('태그') && numberOpen && drillEmpty.join('|') === '필터 편집', `${drillOffered.length} / ${drillEmpty.join('|')}`);
const before = JSON.stringify((await viewOf(`${pid}-v1`)).config.filter ?? null);
ok('창 안의 필터는 보기를 바꾸지 않음', before === 'null', before);
await page.locator('.chart-drill-modal .table-empty-button').click(); await page.waitForTimeout(400);
const drillPanel = await page.evaluate(() => { const panel = document.querySelector('.chart-drill-filter-panel'); const modal = document.querySelector('.chart-drill-modal'); if (!panel || !modal) return null; const a = panel.getBoundingClientRect(), b = modal.getBoundingClientRect(); return { x: Math.round(a.x - b.right), w: Math.round(a.width), chips: panel.querySelectorAll('.filter-rule-item').length }; });
ok('"필터 편집" → 창 오른쪽 끝에 290 폭 필터 목록', !!drillPanel && Math.abs(drillPanel.x) <= 1 && drillPanel.w === 290 && drillPanel.chips === 2, JSON.stringify(drillPanel));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.locator('.chart-drill-modal [aria-label="더 보기"]').click(); await page.waitForTimeout(300);
const moreItems = await texts('.popover-panel .menu-item-label');
ok('⋯: 보기로 저장… · <DB> 열기', moreItems.join('|') === '보기로 저장…|10차 점검 DB 열기', moreItems.join('|'));
await page.locator('.popover-panel .menu-item', { hasText: '보기로 저장' }).click(); await page.waitForTimeout(400);
await page.keyboard.type('10차 점검'); await page.waitForTimeout(300);
await page.keyboard.press('Enter'); await page.waitForTimeout(700);
const saved = (await (await fetch(`${base}/api/state`)).json()).objects.filter(item => item.kind === 'view' && item.parentId === pid && item.viewType === 'table' && item.id !== `${pid}-v0`);
ok('보기로 저장: 고른 페이지에 표 보기(그룹 조건+추가 규칙)', saved.length === 1 && JSON.stringify(saved[0].config.filter).includes(tag.dev) && JSON.stringify(saved[0].config.filter).includes(p('amount')) && await has('.chart-drill-modal'), JSON.stringify(saved[0]?.config.filter ?? null));
ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
