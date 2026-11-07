// 14차 점검: 빈 행 템플릿 고르기, 페이지 레이아웃 섹션(그룹 · 속성 모듈 · 끌어 옮기기), 업데이트 및 분석 패널,
// 사이드바 새로 만들기 메뉴 · 위치 칩, 타임라인 처음 위치, 끌 때 가장자리 자동 스크롤, 검색 창 위치, 다크 모드 색 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite10.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const root = `suite10-${Date.now()}`, db = `${root}-db`, sid = `${db}-src`, p = name => `${db}-p-${name}`;
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ops = [
  { type: 'page.create', id: root, title: '분석 실험 모음 2026-10-19', parentId: null },
  { type: 'page.create', id: db, title: '측정 DB', parentId: root },
  { type: 'source.create', id: sid, pageId: db, name: '측정 DB', titlePropertyId: p('title') },
  { type: 'property.create', id: p('memo'), sourceId: sid, name: '메모', propertyType: 'text' },
  { type: 'property.create', id: p('amount'), sourceId: sid, name: '금액', propertyType: 'number' },
  { type: 'property.create', id: p('date'), sourceId: sid, name: '일정', propertyType: 'date' },
  { type: 'property.create', id: p('select'), sourceId: sid, name: '선택', propertyType: 'select', options: [{ id: `${db}-o1`, name: '보통', color: 'yellow' }] },
  { type: 'page.create', id: `${db}-r0`, title: '측정 작업 베타', parentId: sid, sourceId: sid },
  { type: 'value.set', pageId: `${db}-r0`, propertyId: p('amount'), value: 3500 },
  { type: 'value.set', pageId: `${db}-r0`, propertyId: p('date'), value: { start: day(0) } },
  { type: 'page.create', id: `${db}-empty`, title: '', parentId: sid, sourceId: sid },
  { type: 'view.create', id: `${db}-v0`, sourceId: sid, parentId: db, name: 'Default view', viewType: 'table', config: {} },
  { type: 'view.create', id: `${db}-v1`, sourceId: sid, parentId: db, name: '타임라인', viewType: 'timeline', config: { datePropertyId: p('date') } },
  { type: 'page.create', id: `${root}-long`, title: '긴 페이지', parentId: root },
];
for (let i = 0; i < 60; i++) ops.push({ type: 'block.create', id: `${root}-long-b${i}`, parentId: `${root}-long`, blockType: 'paragraph', richText: [{ text: `문단 ${i + 1}` }] });
await post(ops);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const box = async sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v)); }, sel);
let s;

// 1. 빈 행: 템플릿이 없으면 "템플릿을 만드세요", 있으면 템플릿 · 빈 페이지 · 새 템플릿 — ↓ Enter로 적용
await go(`${db}-empty`);
const noTemplates = await page.locator('.row-template-text').innerText().catch(() => '-');
await post([{ type: 'page.create', id: `${db}-tpl`, title: '회의록', parentId: sid, sourceId: sid, template: true },
  { type: 'value.set', pageId: `${db}-tpl`, propertyId: p('memo'), value: '템플릿 메모' },
  { type: 'block.create', id: `${db}-tpl-b1`, parentId: `${db}-tpl`, blockType: 'heading2', richText: [{ text: '안건' }] }]);
await go(`${db}-empty`);
const rows = await page.locator('.row-template-row').allInnerTexts();
await page.locator('.page-title').click(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
s = await state();
const applied = s.objects.find(o => o.id === `${db}-empty`);
const copied = s.objects.filter(o => o.kind === 'block' && o.parentId === `${db}-empty` && o.alive).map(o => o.richText?.[0]?.text);
ok('빈 행: "템플릿을 만드세요" → 템플릿 행(회의록 · 빈 페이지 · 새 템플릿), ↓ Enter로 내용 · 빈 값 · 제목 채움', noTemplates.includes('템플릿을 만드세요') && rows.join('|') === '회의록|빈 페이지|새 템플릿' && applied.values?.[p('memo')] === '템플릿 메모' && applied.title === '회의록' && copied.includes('안건'), `${noTemplates} / ${rows.join('|')} / ${applied.title} / ${copied.join(',')}`);

// 2. 페이지 레이아웃 섹션: 이름 붙은 그룹, 속성 하나짜리 섹션, 순서
await post([{ type: 'source.update', id: sid, pageLayout: { sections: [{ type: 'group', id: 'g-fin', name: '재무', properties: [p('amount')] }, { type: 'group', id: 'main' }, { type: 'property', id: 'm-memo', propertyId: p('memo') }, { type: 'discussion', id: 'discussion' }] } }]);
await go(`${db}-r0`);
const order = await page.evaluate(() => [...document.querySelector('.page-header').children].map(c => c.querySelector?.('.property-group-name, .property-module-name')?.textContent || c.className.split(' ')[0]).filter(name => !['page-controls', 'page-title'].includes(name)));
ok('레이아웃 섹션: 재무 그룹 → 기본 속성 → 메모 모듈 → 댓글', order.slice(0, 4).join('|') === '재무|page-properties|메모|page-comments', order.join('|'));
let rejected = '';
try { await post([{ type: 'source.update', id: sid, pageLayout: { sections: [{ type: 'property', id: 'x', propertyId: 'nope' }] } }]); } catch (error) { rejected = String(error.message).includes('LAYOUT_PROPERTY') ? 'LAYOUT_PROPERTY' : String(error.message).slice(0, 80); }
ok('레이아웃 섹션: 없는 속성은 LAYOUT_PROPERTY로 거절', rejected === 'LAYOUT_PROPERTY', rejected);
await post([{ type: 'source.update', id: sid, pageLayout: null }]);

// 3. 업데이트 및 분석: 385 패널, 53 탭 줄, 편집 항목(제목 · 추가 블록), 분석 차트 353×175 · 기간 4개, 이동하면 닫힘
await go(`${root}-long`);
await page.locator('.page-title').click(); await page.keyboard.press('End'); await page.keyboard.type(' 수정'); await page.waitForTimeout(900);
await page.locator('.topbar [aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300);
const menuHas = (await page.locator('.menu-panel .menu-item').allInnerTexts()).some(text => text.startsWith('업데이트 및 분석'));
await page.locator('.menu-item', { hasText: '업데이트 및 분석' }).click(); await page.waitForTimeout(900);
const panel = await box('.updates-panel'), tabs = await box('.updates-tabs'), scroller = await box('.frame-scroller'), avatar = await box('.update-avatar');
const heads = await page.locator('.update-head').allInnerTexts();
const blocks = await page.locator('.update-block.added').count(), more = await page.locator('.update-more').innerText().catch(() => '-');
const hidden = await page.evaluate(() => [...document.querySelectorAll('.topbar-edited, .topbar-link')].every(e => getComputedStyle(e).display === 'none'));
ok('업데이트: ⋯ 메뉴 항목, 패널 1127/385 · 탭 줄 44/53 · 본문 857, 편집 항목 · 추가 블록 4개 · "그 외 56개 더 보기", 편집 시간 · 링크 숨김',
  menuHas && panel?.join(',') === '1127,0,385,828' && tabs?.[1] === 44 && tabs?.[3] === 53 && scroller?.[2] === 857 && avatar?.join(',') === '1148,111,24,24' && heads[0]?.includes('편집했습니다') && blocks === 4 && more === '그 외 56개 더 보기' && hidden,
  `${menuHas} ${panel} ${tabs} ${scroller} ${avatar} ${heads.join(' / ')} ${blocks} ${more} ${hidden}`);
await page.locator('.updates-tab', { hasText: '분석' }).click(); await page.waitForTimeout(400);
const chart = await box('.analytics-chart'), period = await page.locator('.analytics-period').innerText();
await page.locator('.analytics-period').click(); await page.waitForTimeout(300);
const periods = await page.locator('.menu-panel .menu-item').allInnerTexts();
await page.keyboard.press('Escape');
const total = await page.locator('.analytics-total').innerText();
ok('분석: 조회수 (총 N회) · 지난 28일 · 차트 353×175 · 기간 지난 7일/28일/90일/전체 기간', chart?.[2] === 353 && chart?.[3] === 175 && period === '지난 28일' && periods.join('|') === '지난 7일|지난 28일|지난 90일|전체 기간' && /^\(총 \d+회\)$/.test(total), `${chart} ${period} ${periods.join('|')} ${total}`);
await page.locator('.updates-tab', { hasText: '업데이트' }).click();
await page.locator('.breadcrumbs .crumb').first().click(); await page.waitForTimeout(600);
ok('업데이트 패널: 다른 페이지로 가면 닫힘', await page.locator('.updates-panel').count() === 0);

// 4. 사이드바 새로 만들기: 180 메뉴(224,40) 페이지 · 데이터베이스, 페이지 → 제목에 커서 + "개인 페이지" 칩 → 옮기기
await page.locator('.sidebar-head [aria-label="새 페이지"]').click(); await page.waitForTimeout(300);
const newMenu = await box('.menu-panel'), newItems = await page.locator('.menu-panel .menu-item').allInnerTexts();
await page.locator('.menu-panel .menu-item', { hasText: /^페이지$/ }).click(); await page.waitForTimeout(800);
const chip = await page.locator('.crumb-place').innerText().catch(() => '-'), focused = await page.evaluate(() => document.activeElement?.classList.contains('page-title'));
await page.locator('.crumb-place').click(); await page.waitForTimeout(400);
const picker = await page.locator('.picker-popover').count();
await page.keyboard.press('Escape');
ok('새로 만들기 메뉴 224,40 180 · 페이지|데이터베이스, 새 페이지 제목 포커스 · "개인 페이지" 칩 → 옮기기 창', newMenu?.slice(0, 3).join(',') === '224,40,180' && newItems.join('|') === '페이지|데이터베이스' && chip === '개인 페이지' && focused && picker === 1, `${newMenu} ${newItems.join('|')} ${chip} ${focused} ${picker}`);

// 5. 타임라인: 처음에 오늘 칸이 창 가운데(1242 폭에서 617)부터
await go(`${db}-v1`);
const timeline = await page.evaluate(() => { const scrollerBox = document.querySelector('.timeline-scroll').getBoundingClientRect(); const today = document.querySelector('.timeline-days .today').getBoundingClientRect(); return Math.round(today.left - scrollerBox.left); });
ok('타임라인 처음 위치: 오늘 칸 왼쪽 617', Math.abs(timeline - 617) <= 1, String(timeline));

// 6. 블록을 끌어 아래 가장자리에 두면 페이지가 따라 내려감
await go(`${root}-long`);
const second = await page.locator('.page-editor [data-block-id]').nth(1).boundingBox();
await page.mouse.move(second.x + 20, second.y + second.height / 2); await page.waitForTimeout(300);
const handle = await page.locator('.block-drag-handle').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
await page.mouse.move(handle.x + 40, handle.y + 60, { steps: 5 }); await page.mouse.move(handle.x + 40, 815, { steps: 10 });
await page.waitForTimeout(600);
const scrolled = await page.evaluate(() => document.querySelector('.frame-scroller').scrollTop);
await page.mouse.move(handle.x + 40, 60, { steps: 10 }); await page.waitForTimeout(900);
const back = await page.evaluate(() => document.querySelector('.frame-scroller').scrollTop);
await page.mouse.move(handle.x + 400, 300, { steps: 3 }); await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(300);
ok('끌기 자동 스크롤: 아래 가장자리에서 내려가고 위 가장자리에서 올라옴', scrolled > 200 && back < scrolled, `${scrolled} → ${back}`);

// 7. 검색 창: 253,75 1006×708
await page.keyboard.press('Meta+k'); await page.waitForTimeout(500);
if (!(await page.locator('.search-modal').count())) { await page.keyboard.press('Control+k'); await page.waitForTimeout(500); }
const search = await box('.search-modal');
await page.keyboard.press('Escape');
ok('검색 창 위치 253,75 · 1006×708', search?.join(',') === '253,75,1006,708', String(search));

// 8. 다크: 업데이트 패널 선 · 추가 강조 · 차트 색
await page.addInitScript(() => { localStorage.setItem('pageyard-settings-v1', JSON.stringify({ theme: 'dark' })); });
await go(`${root}-long`);
await page.locator('.topbar [aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '업데이트 및 분석' }).click(); await page.waitForTimeout(900);
const dark = await page.evaluate(() => [getComputedStyle(document.querySelector('.updates-tabs')).borderBottomColor, getComputedStyle(document.querySelector('.update-added') ?? document.body).backgroundColor].join(' / '));
await page.locator('.updates-tab', { hasText: '분석' }).click(); await page.waitForTimeout(400);
const darkChart = await page.evaluate(() => [getComputedStyle(document.querySelector('.series-views')).fill, getComputedStyle(document.querySelector('.series-unique')).fill].join(' / '));
ok('다크: 선 rgba(255,255,243,.082) · 추가 강조 rgba(67,155,255,.24) · 차트 rgb(20,58,78)/rgb(86,67,40)', dark === 'rgba(255, 255, 243, 0.082) / rgba(67, 155, 255, 0.24)' && darkChart === 'rgb(20, 58, 78) / rgb(86, 67, 40)', `${dark} | ${darkChart}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
