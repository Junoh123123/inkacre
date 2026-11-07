// 16차 점검(최종 감사): 열 메뉴 정렬 하위 메뉴 · 상태 표시 유형 · 제목 열 아이콘, 전체 페이지 DB ⋯ 메뉴(데이터 없이 복제),
// 보기 탭 메뉴(표시 유형), 보기 목록의 "새 보기" 격자 위치, 양식 도구 순서, 블록 전환(열 · 수식 · 동기화), 슬래시 차트 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite12.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const root = `suite12-${Date.now()}`, db = `${root}-db`, sid = `${db}-src`, p = name => `${db}-p-${name}`;
const st = { todo: `${db}-s1`, doing: `${db}-s2`, done: `${db}-s3` };
const ops = [
  { type: 'page.create', id: root, title: '최종 감사', parentId: null },
  { type: 'page.create', id: db, title: '감사 DB', parentId: root },
  { type: 'source.create', id: sid, pageId: db, name: '감사 DB', titlePropertyId: p('title') },
  { type: 'property.create', id: p('amount'), sourceId: sid, name: '금액', propertyType: 'number' },
  { type: 'property.create', id: p('status'), sourceId: sid, name: '상태', propertyType: 'status', options: [{ id: st.todo, name: '시작 전', group: 'todo', color: 'gray' }, { id: st.doing, name: '진행 중', group: 'in_progress', color: 'blue' }, { id: st.done, name: '완료', group: 'complete', color: 'green' }] },
  { type: 'page.create', id: `${db}-r0`, title: '하나', parentId: sid, sourceId: sid },
  { type: 'page.update', id: `${db}-r0`, icon: '🍎' },
  { type: 'value.set', pageId: `${db}-r0`, propertyId: p('status'), value: st.todo },
  { type: 'page.create', id: `${db}-r1`, title: '둘', parentId: sid, sourceId: sid },
  { type: 'view.create', id: `${db}-v0`, sourceId: sid, parentId: db, name: 'Default view', viewType: 'table', config: { visibleProperties: [p('title'), p('amount'), p('status')] } },
  { type: 'view.create', id: `${db}-v1`, sourceId: sid, parentId: db, name: '양식', viewType: 'form', config: {} },
  { type: 'page.create', id: `${root}-doc`, title: '전환 문서', parentId: root },
  { type: 'block.create', id: `${root}-b1`, parentId: `${root}-doc`, blockType: 'paragraph', richText: [{ text: '열로 감쌀 문단' }] },
  { type: 'block.create', id: `${root}-b2`, parentId: `${root}-doc`, blockType: 'paragraph', richText: [{ text: 'E=mc^2' }] },
  { type: 'block.create', id: `${root}-b3`, parentId: `${root}-doc`, blockType: 'paragraph', richText: [{ text: '끝' }] },
];
for (let i = 2; i < 10; i++) ops.push({ type: 'view.create', id: `${db}-v${i}`, sourceId: sid, parentId: db, name: `보기 ${i}`, viewType: 'list', config: {} });
await post(ops);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const head = name => page.locator('.table-head-cell', { hasText: name }).first();
const item = label => page.locator('.popover-panel .menu-item', { hasText: label }).last();
let s;

// 1. 열 메뉴: 가로 넘침 없음, 정렬 › 숫자는 낮음→높음 / 높음→낮음 (가운데 맞춤 하위 메뉴), 고르면 정렬
await go(`${db}-v0`);
await head('금액').click(); await page.waitForTimeout(400);
const overflow = await page.evaluate(() => { const sc = [...document.querySelectorAll('.popover-panel .menu-scroller')].pop(); return sc ? sc.scrollWidth - sc.clientWidth : -1; });
await item('정렬').hover(); await page.waitForTimeout(500);
const sub = await page.evaluate(() => { const panels = [...document.querySelectorAll('.popover-panel')]; const subPanel = panels[panels.length - 1]; const it = [...document.querySelectorAll('.menu-item')].find(e => e.textContent.trim() === '정렬'); const a = it.getBoundingClientRect(), b = subPanel.getBoundingClientRect(); return { labels: subPanel.innerText.split('\n'), dx: Math.round(b.left - a.right), dy: Math.round((b.top + b.height / 2) - (a.top + a.height / 2)) }; });
await item('높음→낮음 순으로 정렬').click(); await page.waitForTimeout(500);
s = await state();
ok('열 메뉴: 넘침 없음 · 정렬 › 낮음→높음/높음→낮음(항목에 붙어 가운데) · 내림차순 저장', overflow === 0 && sub.labels.join('|') === '낮음→높음 순으로 정렬|높음→낮음 순으로 정렬' && sub.dx === 0 && Math.abs(sub.dy) <= 1 && s.objects.find(o => o.id === `${db}-v0`).config.sorts?.[0]?.direction === 'desc', `${overflow} ${sub.labels.join('|')} ${sub.dx},${sub.dy}`);
await post([{ type: 'view.update', id: `${db}-v0`, config: { visibleProperties: [p('title'), p('amount'), p('status')], sorts: [] } }]);

// 2. 상태 열: 표시 유형 › 체크박스 → 칸이 체크 상자, 누르면 완료 그룹의 첫 옵션
await go(`${db}-v0`);
await head('상태').click(); await page.waitForTimeout(400);
await item('표시 유형').hover(); await page.waitForTimeout(500);
await item('체크박스').click(); await page.waitForTimeout(600);
const boxes = await page.locator('.table-cell.type-status .checkbox-box').count();
await page.locator('.table-row').first().locator('.table-cell.type-status').click(); await page.waitForTimeout(600);
s = await state();
ok('상태 표시 유형 체크박스: 두 행 모두 체크 상자, 눌러 "완료"로', boxes === 2 && s.objects.find(o => o.id === `${db}-r0`).values[p('status')] === st.done, `${boxes} ${s.objects.find(o => o.id === `${db}-r0`).values[p('status')]}`);

// 3. 제목 열: 속성 편집 없음, 페이지 아이콘 표시 끄면 행 아이콘이 사라짐
await head('이름').click(); await page.waitForTimeout(400);
const titleItems = await page.locator('.popover-panel .menu-item').allInnerTexts();
await item('페이지 아이콘 표시').click(); await page.waitForTimeout(500);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const icons = await page.locator('.table-row .title-icon').count();
ok('제목 열 메뉴: 속성 편집 없이 "페이지 아이콘 표시", 끄면 아이콘 0', !titleItems.some(t => t.startsWith('속성 편집')) && titleItems.some(t => t.startsWith('페이지 아이콘 표시')) && icons === 0, `${titleItems.length} ${icons}`);

// 4. 보기 탭 메뉴: 이름 바꾸기 · 표시 유형 › · 보기 편집 · 소스 | 보기 링크 복사 | 보기 복제 · 보기 삭제 (220 폭), 표시 유형 › 보드
await page.locator('.db-tab.active, .db-tab[aria-selected="true"]').first().click(); await page.waitForTimeout(400);
const tabMenu = await page.evaluate(() => { const m = [...document.querySelectorAll('.popover-panel')].pop(); return { width: Math.round(m.getBoundingClientRect().width), items: [...m.querySelectorAll('.menu-item-label')].map(e => e.textContent) }; });
await item('표시 유형').hover(); await page.waitForTimeout(500);
await page.locator('.popover-panel').last().getByRole('menuitem', { name: '보드', exact: true }).click(); await page.waitForTimeout(600);
s = await state();
ok('보기 탭 메뉴: 220 폭 항목 순서(22차: 탭 표시 방식 추가), 표시 유형 › 보드로 바꿈', tabMenu.width === 220 && tabMenu.items.join('|') === '이름 바꾸기|표시 유형|탭 표시 방식|보기 편집|소스|보기 링크 복사|보기를 사이드바에 추가|보기 복제|보기 삭제' && s.objects.find(o => o.id === `${db}-v0`).viewType === 'board', `${tabMenu.width} ${tabMenu.items.join('|')}`);
await post([{ type: 'view.update', id: `${db}-v0`, viewType: 'table' }]);

// 5. 보기 목록 "새 보기": 목록은 열린 채, 격자가 그 줄 왼쪽에 붙어 가운데 — 고르면 둘 다 닫히고 새 보기
await go(`${db}-v0`);
await page.locator('.db-tab-more').click(); await page.waitForTimeout(400);
await page.locator('.views-menu-new').first().click(); await page.waitForTimeout(400);
const grid = await page.evaluate(() => { const row = document.querySelector('.views-menu-new').getBoundingClientRect(); const g = document.querySelector('.add-view-menu').getBoundingClientRect(); return { listOpen: !!document.querySelector('.views-menu'), dx: Math.round(row.left - g.right), dy: Math.round((g.top + g.height / 2) - (row.top + row.height / 2)) }; });
const before = (await state()).objects.filter(o => o.kind === 'view' && o.parentId === db && o.alive).length;
await page.locator('.add-view-tile', { hasText: '갤러리' }).click(); await page.waitForTimeout(800);
const after = (await state()).objects.filter(o => o.kind === 'view' && o.parentId === db && o.alive).length;
const closed = await page.evaluate(() => !document.querySelector('.views-menu') && !document.querySelector('.add-view-menu'));
ok('"새 보기" 격자: 목록 왼쪽에 붙어 가운데, 목록 열린 채 → 고르면 보기 하나 추가 · 둘 다 닫힘', grid.listOpen && grid.dx === 0 && Math.abs(grid.dy) <= 1 && after === before + 1 && closed, JSON.stringify(grid) + ` ${before}→${after}`);
await page.keyboard.press('Escape');

// 6. 양식 도구: ⚡ · ⚙ 다음에 미리 보기
await go(`${db}-v1`);
const formTools = await page.evaluate(() => [...document.querySelector('.db-toolbar').querySelectorAll('button')].filter(b => b.offsetParent).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(b => b.classList.contains('form-preview-button') ? 'preview' : b.classList.contains('db-tool-settings') ? 'settings' : 'tool'));
ok('양식 도구 순서: 자동화 · 설정 · 미리 보기', formTools.join('|') === 'tool|settings|preview', formTools.join('|'));

// 7. 전체 페이지 DB ⋯: 복제 › 데이터 없이 복제 → 행 없는 사본(속성 · 보기 유지)
await go(db);
await page.locator('.topbar [aria-haspopup="menu"]').last().click(); await page.waitForTimeout(400);
const dbMenu = await page.locator('.popover-panel .menu-item-label').allInnerTexts();
await item('복제').hover(); await page.waitForTimeout(500);
await item('데이터 없이 복제').click(); await page.waitForTimeout(900);
s = await state();
const copy = s.objects.find(o => o.kind === 'page' && o.alive && o.parentId === root && o.id !== db && o.title.startsWith('감사 DB'));
const copySource = copy && s.objects.find(o => o.kind === 'source' && o.parentId === copy.id && o.alive);
const copyRows = copySource ? s.objects.filter(o => o.kind === 'page' && o.parentId === copySource.id && o.alive && !o.template).length : -1;
const copyProps = copySource ? s.objects.filter(o => o.kind === 'property' && o.sourceId === copySource.id && o.alive).length : -1;
ok('DB ⋯ 메뉴(CSV 가져오기 · 레이아웃 사용자 지정 · 데이터베이스 잠금) · 데이터 없이 복제 → 행 0, 속성 3', ['CSV 가져오기', '레이아웃 사용자 지정', '데이터베이스 잠금'].every(label => dbMenu.includes(label)) && !dbMenu.includes('페이지 잠금') && copyRows === 0 && copyProps === 3, `${dbMenu.join('|')} / ${copyRows} ${copyProps}`);

// 8. 블록 전환: 2개의 열(첫 단에 블록), 수학 공식 블록(글이 수식)
await go(`${root}-doc`);
const handleOf = async text => { await page.locator('.block', { hasText: text }).first().hover(); await page.waitForTimeout(250); await page.locator('.block-drag-handle').click(); await page.waitForTimeout(350); };
await handleOf('열로 감쌀 문단');
await item('전환').hover(); await page.waitForTimeout(500);
await page.locator('.popover-panel').last().locator('.menu-item', { hasText: '2개의 열' }).click(); await page.waitForTimeout(1200);
s = await state();
const moved = s.objects.find(o => o.id === `${root}-b1`);
const column = s.objects.find(o => o.id === moved.parentId);
const columns = column && s.objects.find(o => o.id === column.parentId);
await handleOf('E=mc^2');
await item('전환').hover(); await page.waitForTimeout(500);
await page.locator('.popover-panel').last().locator('.menu-item', { hasText: '수학 공식 블록' }).click(); await page.waitForTimeout(1200);
s = await state();
const math = s.objects.find(o => o.id === `${root}-b2`);
ok('블록 전환: 2개의 열로 감쌈(단 2개), 수학 공식 블록으로(글 유지)', column?.blockType === 'column' && columns?.blockType === 'columns' && s.objects.filter(o => o.parentId === columns.id && o.alive).length === 2 && math.blockType === 'math' && math.richText?.[0]?.text === 'E=mc^2', `${column?.blockType} ${columns?.blockType} ${math.blockType}`);

// 9. 슬래시 메뉴: 데이터베이스 절 순서 · 차트 다섯 가지 · 토글 제목은 고급 블록, "/세로 막대" → 막대 차트 보기
await page.locator('.block', { hasText: '끝' }).last().locator('.block-text').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/');
await page.waitForTimeout(400);
const groups = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.slash-group')].map(g => [g.querySelector('.slash-heading').textContent, [...g.querySelectorAll('.slash-item-label')].map(e => e.textContent)])));
await page.keyboard.type('세로 막대'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
s = await state();
const chartView = s.objects.find(o => o.kind === 'view' && o.alive && o.viewType === 'chart' && s.objects.find(src => src.id === o.sourceId)?.parentId === `${root}-doc`);
const dbItems = groups['데이터베이스'] ?? [];
ok('슬래시: 차트 다섯(세로 막대형~숫자) · 양식 보기, 토글 제목1–3은 고급 블록, /세로 막대 → 막대 차트 보기', dbItems.slice(0, 9).join('|') === '표 보기|보드 보기|갤러리 보기|리스트 보기|피드 보기|대시보드 보기|캘린더 보기|타임라인 보기|지도 보기' && dbItems.includes('숫자 차트') && (groups['고급 블록'] ?? []).filter(l => l.startsWith('토글 제목')).length === 3 && !(groups['기본 블록'] ?? []).some(l => l.startsWith('토글 제목')) && chartView?.config.chart?.type === 'bar', `${dbItems.join('|')} / ${chartView?.config.chart?.type}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
