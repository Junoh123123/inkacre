// 19차 점검: 데이터베이스 날짜 필터 — 날짜 속성의 새 규칙은 "오늘 기준 상대 날짜 · 이번 주"로 바로 걸러지고
// (칩 "일정: 이번 주"), 260 편집기 머리 "시작일 ⌄ · 오늘 기준 상대 날짜 ⌄ · ⋯", [이번 ⌄][주 ⌄](112 둘) + 달력(범위 표시) +
// "필터는 최신 날짜에 맞춰 업데이트됩니다". 조건 목록 9개(같음 · 이전 · 이후 · 당일 또는 이전 · 당일 또는 이후 · 기간 내 ·
// 오늘 기준 상대 날짜 · 비어 있음 · 비어 있지 않음). 지난 → 수 칸, 기간 내 → "시작" · "종료" 칸 둘, 종료일 → 끝 날짜로 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite23.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const id = `suite23-${Date.now()}`;
await post([
  { type: 'page.create', id, title: '날짜 필터 DB', parentId: null },
  { type: 'source.create', id: `${id}-src`, pageId: id, name: '날짜 필터 DB', titlePropertyId: `${id}-t` },
  { type: 'property.create', id: `${id}-d`, sourceId: `${id}-src`, name: '일정', propertyType: 'date' },
  { type: 'view.create', id: `${id}-v`, sourceId: `${id}-src`, parentId: id, name: 'Default view', viewType: 'table', config: {} },
  ...[['오늘 행', 0], ['열흘 전 행', -10], ['한 달 뒤 행', 32]].flatMap(([title, offset], i) => [{ type: 'page.create', id: `${id}-r${i}`, title, parentId: `${id}-src`, sourceId: `${id}-src` },
    { type: 'value.set', pageId: `${id}-r${i}`, propertyId: `${id}-d`, value: { start: day(offset), ...(i === 1 ? { end: day(-2) } : {}) } }]),
]);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
const rows = () => page.evaluate(() => [...document.querySelectorAll('.table-row .cell-title, .table-row [data-title], .table-row')].map(e => e.textContent).filter(Boolean).join('|'));
const visible = async () => (await state()).objects.length && page.evaluate(() => [...document.querySelectorAll('.page-title-cell, .table-title, .row-title')].map(e => e.textContent));
const titles = () => page.evaluate(() => ['오늘 행', '열흘 전 행', '한 달 뒤 행'].filter(name => [...document.querySelectorAll('.database-block *')].some(e => e.children.length === 0 && e.textContent === name)));

// 1. 필터 → 일정: 칩 "일정: 이번 주", 편집기 260(시작일 ⌄ · 오늘 기준 상대 날짜 ⌄, [이번][주] 112, 달력, 안내), 오늘 행만
await page.locator('.db-toolbar [aria-label="필터"], .database-toolbar [aria-label="필터"], [aria-label="필터"]').first().click(); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: /^일정$/ }).click(); await page.waitForTimeout(800);
const first = await page.evaluate(() => { const p = document.querySelector('.filter-rule-popover'); const chip = [...document.querySelectorAll('.filter-bar .filter-chip')].map(e => e.textContent).join('|'); return p ? { chip, w: Math.round(p.getBoundingClientRect().width), head: [...p.querySelectorAll('.filter-rule-head .filter-rule-op')].map(e => e.textContent).join('|'), selects: [...p.querySelectorAll('.filter-select')].map(e => `${e.textContent}:${Math.round(e.getBoundingClientRect().width)}`).join('|'), days: p.querySelectorAll('.date-day').length, marked: p.querySelectorAll('.date-day.range-start, .date-day.range-end, .date-day.in-range').length, note: p.querySelector('.filter-relative-note')?.textContent } : { chip }; });
const shown1 = await titles();
ok('일정 필터 → "일정: 이번 주"(바로 걸러짐: 오늘 행만), 편집기 260: 시작일 · 오늘 기준 상대 날짜, [이번 112][주 112], 달력 7칸 표시, 안내 문구',
  first.chip === '일정:이번 주' && first.w === 260 && first.head === '시작일|오늘 기준 상대 날짜' && first.selects === '이번:112|주:112' && first.days === 42 && first.marked === 7 && first.note === '필터는 최신 날짜에 맞춰 업데이트됩니다' && shown1.join('|') === '오늘 행',
  `${JSON.stringify(first)} ${shown1}`);

// 2. [이번 ⌄] → 지난: 수 칸(1) → 3 · [주 ⌄] → 주: 지난 3주 → 오늘 행 · 열흘 전 행
await page.locator('.filter-rule-popover .filter-select').first().click(); await page.waitForTimeout(200);
const periods = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|'));
await page.locator('.menu .menu-item', { hasText: /^지난$/ }).click(); await page.waitForTimeout(400);
const amount = page.locator('.filter-rule-popover .filter-relative-amount input');
const amountShown = await amount.inputValue();
await amount.fill('3'); await page.waitForTimeout(800);
const units = await (async () => { await page.locator('.filter-rule-popover .filter-select').last().click(); await page.waitForTimeout(200); const list = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|')); await page.keyboard.press('Escape'); return list; })();
await page.waitForTimeout(400);
const shown2 = await titles();
const chip2 = await page.evaluate(() => [...document.querySelectorAll('.filter-bar .filter-chip')].map(e => e.textContent).join('|'));
ok('[지난 · 다음 · 이번], 지난 → 수 칸 1 → 3, 단위 [일 · 주 · 월 · 년], 칩 "일정: 지난 3 주" → 오늘 행 · 열흘 전 행', periods === '지난|다음|이번' && amountShown === '1' && units === '일|주|월|년' && chip2 === '일정:지난 3 주' && shown2.join('|') === '오늘 행|열흘 전 행', `${periods} ${amountShown} ${units} ${chip2} ${shown2}`);

// 3. 조건 목록 9개, 기간 내 → "시작" · "종료" 칸 둘(108)
await page.locator('.filter-rule-popover .filter-rule-op').last().click(); await page.waitForTimeout(200);
const ops = await page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); return { w: Math.round(m.getBoundingClientRect().width), items: [...m.querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|') }; });
await page.locator('.menu .menu-item', { hasText: /^기간 내$/ }).click(); await page.waitForTimeout(400);
const range = await page.evaluate(() => [...document.querySelectorAll('.filter-rule-popover .filter-date-range .filter-date-field')].map(e => `${e.querySelector('input').placeholder}:${Math.round(e.getBoundingClientRect().width)}`).join('|'));
const fields = page.locator('.filter-rule-popover .filter-date-range input');
await fields.nth(0).fill(day(-12)); await fields.nth(0).press('Enter'); await fields.nth(1).fill(day(-5)); await fields.nth(1).press('Enter'); await page.waitForTimeout(800);
const shown3 = await titles();
ok('조건 9개(같음 · 이전 · 이후 · 당일 또는 이전 · 당일 또는 이후 · 기간 내 · 오늘 기준 상대 날짜 · 비어 있음 · 비어 있지 않음), 기간 내 → 시작 · 종료 칸(108), 12일 전~5일 전 → 열흘 전 행',
  ops.items === '같음|이전|이후|당일 또는 이전|당일 또는 이후|기간 내|오늘 기준 상대 날짜|비어 있음|비어 있지 않음' && range === '시작:108|종료:108' && shown3.join('|') === '열흘 전 행', `${JSON.stringify(ops)} ${range} ${shown3}`);

// 4. 시작일 ⌄ → 종료일: 열흘 전 행은 끝이 이틀 전이라 12일 전~5일 전에서 빠짐
await page.locator('.filter-rule-popover .filter-rule-edge').click(); await page.waitForTimeout(200);
const edges = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|'));
await page.locator('.menu .menu-item', { hasText: /^종료일$/ }).click(); await page.waitForTimeout(800);
const shown4 = await titles();
const saved = (await state()).objects.find(o => o.id === `${id}-v`).config.filter;
ok('시작일 ⌄ → [시작일 · 종료일], 종료일 → 끝 날짜로 비교(열흘 전 행 빠짐), 보기에 end: true 저장', edges === '시작일|종료일' && shown4.length === 0 && JSON.stringify(saved).includes('"end":true') && JSON.stringify(saved).includes('"within"'), `${edges} ${shown4} ${JSON.stringify(saved)}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
