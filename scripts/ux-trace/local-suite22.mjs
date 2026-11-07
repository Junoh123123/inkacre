// 19차 점검: 라이브러리는 데이터베이스 표 보기처럼 — 필터 메뉴(290: 6개 + 고급 필터 추가),
// 고른 열이 탭 아래 막대의 칩(정렬 칩 "최종 열람 일시" · 구분선 · 주황 점 칩 · "+ 필터" · 오른쪽 "재설정"), 날짜 규칙은
// 260 폭 편집기("날짜를 선택하거나 입력…" + 달력), 열 머리 메뉴(필터 · 정렬 · 그룹 · 숨기기 · 텍스트 줄바꿈), 오른쪽에 붙는
// "보기 설정"(속성 표시/숨기기 · 필터), 행을 가리키면 체크박스 · "열기", 고르면 "N개 선택됨" 막대, 검색 칸은 돋보기 오른쪽.
// 그리고 가운데 새 페이지 창의 본문 723 폭, 보기 삭제 확인("이 보기를 삭제할까요?") — 1512×828.
// 사용법: node scripts/ux-trace/local-suite22.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite22-${Date.now()}`, tag = String(Date.now()).slice(-5);
await post([
  { type: 'page.create', id, title: `라이브러리 문서 ${tag}`, parentId: null },
  { type: 'page.create', id: `${id}-b`, title: `둘째 문서 ${tag}`, parentId: null },
  { type: 'page.create', id: `${id}-db`, title: `보기 DB ${tag}`, parentId: id },
  { type: 'source.create', id: `${id}-src`, pageId: `${id}-db`, name: `보기 DB ${tag}`, titlePropertyId: `${id}-t` },
  { type: 'view.create', id: `${id}-v1`, sourceId: `${id}-src`, parentId: `${id}-db`, name: 'Default view', viewType: 'table', config: {} },
  { type: 'view.create', id: `${id}-v2`, sourceId: `${id}-src`, parentId: `${id}-db`, name: '지울 보기', viewType: 'board', config: {} },
]);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
// The two pages as recently opened (as visiting them from the sidebar records them).
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.evaluate(ids => { localStorage.setItem('pageyard-recent', JSON.stringify(ids)); const now = Date.now(); localStorage.setItem('pageyard-visited', JSON.stringify(Object.fromEntries(ids.map((id, i) => [id, new Date(now - i * 60000).toISOString()])))); }, [id, `${id}-b`]);
await page.goto(`${base}/?library=recents`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
const rect = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); }, sel);
const headBefore = await rect('.library-row.head');

// 1. 필터 → 290 메뉴(6개 + 회색 "고급 필터 추가") → 생성 일시: 막대(정렬 칩 · 점 칩 · + 필터 · 재설정), 260 날짜 편집기
await page.locator('.library-tools .filter-tool').click(); await page.waitForTimeout(400);
const menu = await page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); return { w: Math.round(m.getBoundingClientRect().width), items: [...m.querySelectorAll('.menu-item')].map(e => e.textContent).join('|'), muted: m.querySelector('.menu-item.muted')?.textContent }; });
await page.locator('.menu .menu-item', { hasText: '생성 일시' }).click(); await page.waitForTimeout(600);
const bar = await page.evaluate(() => { const chips = [...document.querySelectorAll('.library-filter-bar .filter-chip, .library-filter-bar .filter-add, .library-filter-bar .filter-reset')].map(e => `${e.textContent}${e.querySelector('.chip-dot') ? '•' : ''}`); const line = document.querySelector('.library-filter-bar').getBoundingClientRect().y; const p = document.querySelector('.filter-rule-popover'); return { chips: chips.join('|'), line: Math.round(line), tool: !!document.querySelector('.filter-tool .chip-dot'), pop: p ? Math.round(p.getBoundingClientRect().width) : null, ph: p?.querySelector('.filter-date-field input')?.placeholder, days: p?.querySelectorAll('.date-day').length }; });
ok('필터 → 290 메뉴(페이지 이름 · 생성 일시 · 작성자 · 최종 편집 일시 · 최종 편집자 · 최종 열람 일시 | 회색 고급 필터 추가) → 막대: "최종 열람 일시" · "생성 일시"(주황 점) · + 필터 · 재설정, 260 날짜 편집기 + 달력',
  menu.w === 290 && menu.items === '페이지 이름|생성 일시|작성자|최종 편집 일시|최종 편집자|최종 열람 일시|고급 필터 추가' && menu.muted === '고급 필터 추가' && bar.chips === '최종 열람 일시|생성 일시•|필터|재설정' && bar.line === Math.round(headBefore[1]) && bar.tool && bar.pop === 260 && bar.ph === '날짜를 선택하거나 입력…' && bar.days === 42,
  `${JSON.stringify(menu)} ${JSON.stringify(bar)} head=${headBefore}`);

// 2. 날짜 입력: 2000-01-01이면 결과 없음, 오늘이면 두 문서 다 보임; 재설정 → 규칙이 사라지고 재설정도 사라짐
const field = page.locator('.filter-rule-popover .filter-date-field input');
await field.fill('2000-01-01'); await field.press('Enter'); await page.waitForTimeout(500);
const none = await page.evaluate(() => ({ rows: document.querySelectorAll('.library-row:not(.head)').length, empty: document.querySelector('.library-empty')?.textContent }));
const now = new Date(); const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
await field.fill(todayKey); await field.press('Enter'); await page.waitForTimeout(500);
const todayCell = await page.locator('.filter-rule-popover .date-day.today.selected').count();
const today = await page.evaluate(tag => [...document.querySelectorAll('.library-row:not(.head) .library-title')].map(e => e.textContent).filter(text => text.endsWith(tag)).length, tag);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.locator('.library-filter-bar .filter-reset').click(); await page.waitForTimeout(400);
const afterReset = await page.evaluate(() => [...document.querySelectorAll('.library-filter-bar .filter-chip, .library-filter-bar .filter-reset')].map(e => e.textContent).join('|'));
ok('날짜 2000-01-01 → 결과 없음, 오늘(달력에 파랑으로) → 두 문서, 재설정 → "최종 열람 일시" 칩만(막대는 남음)', none.rows === 0 && none.empty === '결과 없음' && today === 2 && todayCell === 1 && afterReset === '최종 열람 일시', `${JSON.stringify(none)} ${today} ${todayCell} ${afterReset}`);

// 3. 열 머리 "만든 사람" → 필터 · 정렬 · 그룹 · 숨기기 · 텍스트 줄바꿈, 그룹 → "나" 묶음, 다시 → 그룹 해제
await page.locator('.library-head-cell', { hasText: '만든 사람' }).first().click(); await page.waitForTimeout(300);
const colMenu = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|'));
await page.locator('.menu .menu-item', { hasText: /^그룹$/ }).click(); await page.waitForTimeout(400);
const grouped = await page.evaluate(() => ({ heads: [...document.querySelectorAll('.library-group-head')].map(e => e.textContent), cols: document.querySelectorAll('.library-row.head').length }));
await page.locator('.library-head-cell', { hasText: '만든 사람' }).first().click(); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: '그룹 해제' }).click(); await page.waitForTimeout(400);
const ungrouped = await page.evaluate(() => document.querySelectorAll('.library-group-head').length);
ok('열 머리 메뉴: 필터 · 정렬 · 그룹 · 숨기기 · 텍스트 줄바꿈, 그룹 → "나" 묶음(머리 줄 반복), 그룹 해제', colMenu === '필터|정렬|그룹|숨기기|텍스트 줄바꿈' && grouped.heads.length === 1 && /나/.test(grouped.heads[0]) && grouped.cols === 1 && ungrouped === 0, `${colMenu} ${JSON.stringify(grouped)} ${ungrouped}`);

// 4. 설정 → 오른쪽에 붙은 "보기 설정"(머리 줄 높이에서, 290, 12px 제목) → 속성 표시/숨기기: 생성 일시 · 최종 편집자는 숨김, 눈을 누르면 열이 생김
await page.locator('.library-tools [aria-label="설정"]').click(); await page.waitForTimeout(400);
const panel = await page.evaluate(() => { const p = document.querySelector('.library-settings'); const r = p.getBoundingClientRect(); const t = p.querySelector('.library-settings-title'); const lib = document.querySelector('.library').getBoundingClientRect(); return { y: Math.round(r.y), w: Math.round(r.width - parseFloat(getComputedStyle(p).paddingRight)), toEdge: Math.round(lib.right - r.right), title: t.textContent, size: getComputedStyle(t).fontSize, rows: [...p.querySelectorAll('.settings-row .settings-row-label')].map(e => e.textContent).join('|') }; });
await page.locator('.library-settings .settings-row', { hasText: '속성 표시/숨기기' }).click(); await page.waitForTimeout(300);
const hiddenList = await page.evaluate(() => [...document.querySelectorAll('.library-settings .hidden-property .settings-row-label')].map(e => e.textContent).join('|'));
await page.locator('.library-settings .hidden-property', { hasText: '생성 일시' }).locator('button').click(); await page.waitForTimeout(300);
const cols = await page.evaluate(() => [...document.querySelectorAll('.library-row.head [role=columnheader]')].map(e => e.textContent).join('|'));
await page.locator('.library-settings .settings-close').click(); await page.waitForTimeout(200);
ok('설정 → "보기 설정"(머리 줄 높이, 290 + 오른쪽 여백까지 덮음, 12px) 속성 표시/숨기기 · 필터, 숨김: 생성 일시 · 최종 편집자, 눈 → 생성 일시 열', panel.y === Math.round(headBefore[1]) && panel.w === 290 && panel.toEdge === 0 && panel.title === '보기 설정' && panel.size === '12px' && panel.rows === '속성 표시/숨기기|필터' && hiddenList === '생성 일시|최종 편집자' && cols.endsWith('생성 일시'), `${JSON.stringify(panel)} ${hiddenList} ${cols}`);

// 5. 행: 체크박스(표 왼쪽 −26) · "열기", 고르면 "1개 선택됨" 막대(표 왼쪽 −10, 탭 위 −4), ⋯ → 페이지 메뉴, 오른쪽 클릭도
const first = page.locator('.library-row:not(.head)', { hasText: `라이브러리 문서 ${tag}` }).first();
const box = await first.boundingBox();
await page.mouse.move(box.x + 200, box.y + box.height / 2); await page.waitForTimeout(250);
const hover = await page.evaluate(tag => { const row = [...document.querySelectorAll('.library-row:not(.head)')].find(r => r.textContent.includes(`라이브러리 문서 ${tag}`)); const c = row.querySelector('.library-check input').getBoundingClientRect(); const o = row.querySelector('.library-open'); return { dx: Math.round(row.getBoundingClientRect().x - c.x), shown: getComputedStyle(row.querySelector('.library-check')).opacity, open: getComputedStyle(o).display, text: o.textContent }; }, tag);
await first.locator('.library-check input').click(); await page.waitForTimeout(300);
const tabs = await rect('.library-tabs');
const sel = await page.evaluate(() => { const s = document.querySelector('.library-selection'); const r = s.getBoundingClientRect(); return { text: s.querySelector('.selection-count').textContent, x: Math.round(r.x), y: Math.round(r.y) }; });
await page.locator('.library-selection .selection-action').last().click(); await page.waitForTimeout(300);
const more = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-heading, .menu-section-label, .menu-item-label')].map(e => e.textContent).join('|'));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await first.click({ button: 'right', position: { x: 600, y: 18 } }); await page.waitForTimeout(300);
const ctx = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|'));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const cleared = await page.locator('.library-selection').count();
ok('행: 체크박스 표 왼쪽 −26 · "열기", 고르면 "1개 선택됨"(표 −10, 탭 −4), ⋯ · 오른쪽 클릭 → 즐겨찾기 · 최근 항목에서 제거 · 아이콘 편집 · 이름 바꾸기 | 새 탭 · 사이드 보기 | 링크 복사 · 옮기기 · 휴지통, Esc로 선택 해제',
  hover.dx === 26 && hover.shown === '1' && ['flex', 'inline-flex'].includes(hover.open) && hover.text === '열기' && sel.text === '1개 선택됨' && sel.x === Math.round(box.x - 10) && sel.y === Math.round(tabs[1] - 4) && /즐겨찾기에 추가\|최근 항목에서 제거\|아이콘 편집\|이름 바꾸기\|새 탭에서 열기\|사이드 보기로 열기\|링크 복사\|다른 페이지로 옮기기\|휴지통으로 이동/.test(more) && ctx === more.replace(/^페이지\|/, '') && cleared === 0,
  `${JSON.stringify(hover)} ${JSON.stringify(sel)} tabs=${tabs} box=${box.x} | ${more} | ${ctx} | ${cleared}`);

// 6. 검색: 필터 · 검색 · 칸(150, "입력하여 검색…") · 설정 순서, 치면 걸러짐
await page.locator('.library-tools [aria-label="검색"]').click(); await page.waitForTimeout(200);
const search = await page.evaluate(() => { const tools = document.querySelector('.library-tools'); const input = tools.querySelector('.library-search'); return { order: [...tools.children].map(e => e.getAttribute('aria-label') ?? e.tagName).join('|'), w: Math.round(input.getBoundingClientRect().width), ph: input.placeholder }; });
await page.keyboard.type(`둘째 문서 ${tag}`); await page.waitForTimeout(300);
const found = await page.evaluate(() => [...document.querySelectorAll('.library-row:not(.head) .library-title')].map(e => e.textContent));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('검색: 필터 · 검색 · 칸(150, "입력하여 검색…") · 설정, 치면 그 문서만', search.order === '필터|검색|INPUT|설정' && search.w === 150 && search.ph === '입력하여 검색…' && found.length === 1 && found[0] === `둘째 문서 ${tag}`, `${JSON.stringify(search)} ${found}`);

// 7. 고급 필터: "규칙 1개" 칩 + 고급 편집기(페이지 이름), 값을 치면 걸러짐
await page.locator('.library-tools .filter-tool').click(); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: '고급 필터 추가' }).click(); await page.waitForTimeout(600);
const adv = await page.evaluate(() => ({ chip: document.querySelector('.library-filter-bar .filter-chip.advanced')?.textContent, prop: document.querySelector('.advanced-filter-popover .filter-button.property')?.textContent }));
await page.locator('.advanced-filter-popover .filter-rule-value input').fill(`둘째 문서 ${tag}`); await page.waitForTimeout(400);
const advRows = await page.evaluate(() => document.querySelectorAll('.library-row:not(.head)').length);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.locator('.library-filter-bar .filter-reset').click(); await page.waitForTimeout(300);
ok('고급 필터 추가 → "규칙 1개" 칩 + 편집기(페이지 이름), 값을 치면 한 줄', adv.chip === '규칙 1개' && adv.prop === '페이지 이름' && advRows === 1, `${JSON.stringify(adv)} ${advRows}`);

// 8. 사이드바 + → 가운데 새 페이지 창: 제목이 창 +126 · +108, 폭 723
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
const srow = page.locator(`.sidebar-row[data-tree-id$="${id}"]`).first();
await srow.hover(); await srow.locator('[aria-label="하위 페이지 추가"]').click(); await page.waitForTimeout(1000);
const peek = await page.evaluate(() => { const b = document.querySelector('.peek-center').getBoundingClientRect(); const t = document.querySelector('.peek-center .page-title').getBoundingClientRect(); return { dx: Math.round((t.x - b.x) * 10) / 10, dy: Math.round(t.y - b.y), w: Math.round(t.width), boxW: Math.round(b.width) }; });
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
ok('새 페이지 창(975): 제목 +126 · +108, 폭 723', peek.boxW === 975 && peek.dx === 126 && peek.dy === 108 && peek.w === 723, JSON.stringify(peek));

// 9. 보기 삭제: 작은 확인 "이 보기를 삭제할까요?"(빨간 글자 테두리 단추 "보기 삭제" · 취소) → 지우면 "삭제된 보기"
await page.goto(`${base}/?id=${id}-db`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await page.locator('button.db-tab', { hasText: '지울 보기' }).first().click({ button: 'right' }); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: '보기 삭제' }).click(); await page.waitForTimeout(300);
const confirm = await page.evaluate(() => { const c = document.querySelector('.confirm-small'); return c ? { title: c.querySelector('.confirm-small-title').textContent, ok: c.querySelector('.confirm-small-ok').textContent, outline: c.querySelector('.confirm-small-ok').classList.contains('outline'), w: Math.round(c.getBoundingClientRect().width) } : null; });
await page.locator('.confirm-small-ok').click(); await page.waitForTimeout(800);
const gone = (await state()).objects.find(o => o.id === `${id}-v2`);
const toast = await page.evaluate(() => document.body.textContent.includes('삭제된 보기'));
ok('보기 삭제 → "이 보기를 삭제할까요?"(324, 테두리 단추 "보기 삭제") → 보기 휴지통, "삭제된 보기"', confirm?.title === '이 보기를 삭제할까요?' && confirm.ok === '보기 삭제' && confirm.outline && confirm.w === 324 && gone?.alive === false && toast, `${JSON.stringify(confirm)} ${gone?.alive} ${toast}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
