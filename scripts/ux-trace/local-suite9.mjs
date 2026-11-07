// 13차 점검: 조건부 색상, 데이터 소스 이동 · 빈 이름 자리글, 양식 조건부 로직, 자동화 변수 정의, 행 메뉴 속성 편집,
// "여기서 시작" 템플릿, 페이지 레이아웃 사용자 지정, 데이터베이스 잠금, 다크 모드 색 — 1512×828, 스크롤 막대 보임.
// 사용법: node scripts/ux-trace/local-suite9.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const root = `suite9-${Date.now()}`, db = `${root}-db`, sid = `${db}-src`, p = name => `${db}-p-${name}`;
const st = { todo: `${db}-s1`, doing: `${db}-s2`, done: `${db}-s3` };
const ops = [
  { type: 'page.create', id: root, title: '분석 실험 모음 2026-10-19', parentId: null },
  { type: 'page.create', id: db, title: '측정 DB', parentId: root },
  { type: 'page.create', id: `${root}-other`, title: '옮길 곳', parentId: root },
  { type: 'source.create', id: sid, pageId: db, name: '측정 DB', titlePropertyId: p('title') },
];
const props = [['memo', '메모', 'text'], ['amount', '금액', 'number'], ['created', '생성', 'created_time'], ['formula', '수식', 'formula', { formula: 'prop("금액") * 2' }],
  ['status', '상태', 'status', { options: [{ id: st.todo, name: '시작 전', group: '할 일', color: 'gray' }, { id: st.doing, name: '진행 중', group: '진행 중', color: 'blue' }, { id: st.done, name: '완료', group: '완료', color: 'green' }] }],
  ['select', '선택', 'select', { options: [{ id: `${db}-o1`, name: '낮음', color: 'gray' }, { id: `${db}-o2`, name: '보통', color: 'yellow' }] }],
  ['tag', '태그', 'multi_select', { options: [{ id: `${db}-t1`, name: '개발', color: 'blue' }] }], ['place', '장소', 'place']];
for (const [key, name, propertyType, extra = {}] of props) ops.push({ type: 'property.create', id: p(key), sourceId: sid, name, propertyType, ...extra });
[['베타', { status: st.todo }], ['델타', { status: st.doing }], ['감마', { status: st.done }]].forEach(([name, values], i) => {
  ops.push({ type: 'page.create', id: `${db}-r${i}`, title: `측정 작업 ${name}`, parentId: sid, sourceId: sid });
  for (const [key, value] of Object.entries(values)) ops.push({ type: 'value.set', pageId: `${db}-r${i}`, propertyId: p(key), value });
});
ops.push({ type: 'view.create', id: `${db}-v0`, sourceId: sid, parentId: db, name: 'Default view', viewType: 'table', config: {} },
  { type: 'view.create', id: `${db}-v1`, sourceId: sid, parentId: db, name: '양식', viewType: 'form', config: { form: { title: '', description: '', questions: ['title', 'select', 'memo', 'amount'].map(key => ({ propertyId: p(key) })) } } },
  { type: 'view.create', id: `${db}-v2`, sourceId: sid, parentId: db, name: '차트', viewType: 'chart', config: { chart: { groupBy: p('tag'), aggregation: 'count', type: 'bar' } } },
  { type: 'view.create', id: `${db}-v3`, sourceId: sid, parentId: db, name: '지도', viewType: 'map', config: { placePropertyId: p('place') } });
await post(ops);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const settings = async () => { await page.locator('.db-tool[aria-label="보기 설정"]').click(); await page.waitForTimeout(400); };
let s;

// 1. 조건부 색상: 상태 rule matching the option colours tints the rows
await go(`${db}-v0`); await settings();
await page.locator('.settings-row', { hasText: '조건부 색상' }).click(); await page.waitForTimeout(300);
await page.locator('.ccolor-new').click(); await page.waitForTimeout(300);
await page.locator('.menu-panel .menu-item', { hasText: /^상태$/ }).first().click(); await page.waitForTimeout(600);
const tints = await page.evaluate(() => [...document.querySelectorAll('.table-row')].map(row => [...row.classList].find(c => c.startsWith('cc-')) ?? '-'));
ok('조건부 색상: 상태 규칙(옵션 색과 일치)으로 행이 회색 · 파랑 · 초록', ['cc-gray', 'cc-blue', 'cc-green'].every(c => tints.includes(c)), tints.join(','));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// 2. 데이터 소스: a new source's heading shows the placeholder; ⋯ offers 이동, which moves it with its views
await settings();
await page.locator('.settings-row', { hasText: '데이터 소스 관리' }).click(); await page.waitForTimeout(300);
await page.locator('.ds-add', { hasText: '데이터 소스 추가' }).click(); await page.waitForTimeout(1000);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const heading = await page.evaluate(() => { const input = document.querySelector('.db-source-title'); return input ? { value: input.value, placeholder: input.getAttribute('placeholder') } : null; });
ok('새 데이터 소스: 머리 이름은 비고 자리글 "새 데이터 소스"', heading?.value === '' && heading?.placeholder === '새 데이터 소스', JSON.stringify(heading));
s = await state();
const added = s.objects.find(o => o.kind === 'source' && o.alive && o.parentId === db && o.id !== sid);
await settings();
await page.locator('.settings-row', { hasText: '데이터 소스 관리' }).click(); await page.waitForTimeout(300);
await page.locator('.ds-row').nth(1).locator('.ds-more').click(); await page.waitForTimeout(300);
const dsMenu = await page.locator('.menu-panel .menu-item').allInnerTexts();
ok('데이터 소스 ⋯: ID 복사 · 이동 · 휴지통으로 이동', ['데이터 소스 ID 복사', '이동', '휴지통으로 이동'].every(label => dsMenu.some(item => item.includes(label))), dsMenu.join(' | '));
await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await post([{ type: 'node.move', id: added.id, parentId: `${root}-other` }, ...s.objects.filter(o => o.kind === 'view' && o.alive && o.sourceId === added.id).map(o => ({ type: 'node.move', id: o.id, parentId: `${root}-other` }))]);
s = await state();
ok('데이터 소스 이동: 소스와 보기가 다른 페이지로', s.objects.find(o => o.id === added.id)?.parentId === `${root}-other` && s.objects.filter(o => o.kind === 'view' && o.alive && o.sourceId === added.id).every(o => o.parentId === `${root}-other`));

// 3. 양식 조건부 로직
await go(`${db}-v1`);
const choice = page.locator('.form-builder .form-question', { has: page.locator('.form-radio') }).first();
await choice.hover(); await choice.locator('.form-question-more').click(); await page.waitForTimeout(300);
await page.locator('.form-options .chart-card-row', { hasText: '조건부 로직 추가' }).click(); await page.waitForTimeout(300);
await page.locator('.form-logic-add').click(); await page.waitForTimeout(300);
const rule = await page.locator('.form-logic-rule').first().innerText();
await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const note = await page.locator('.form-question-condition').first().innerText().catch(() => '');
await page.locator('.form-preview-button').click(); await page.waitForTimeout(400);
const shown = async () => page.locator('.form-preview .form-question').count();
const before = await shown();
await page.locator('.form-preview .form-answer-option', { hasText: '낮음' }).first().click(); await page.waitForTimeout(300);
const after = await shown();
ok('양식 조건부 로직: 규칙이 생기고 대상 질문에 조건 표시, 미리 보기에서 답하면 나타남', /낮음/.test(rule) && /낮음/.test(note) && after === before + 1, `${rule.replace(/\s+/g, ' ')} / ${note} / ${before}→${after}`);

// 4. 자동화 변수 정의: 1 + 2 → 금액
await go(`${db}-v0`);
await page.locator('.db-tool[aria-label="자동화"]').click(); await page.waitForTimeout(500);
await page.locator('.automation-add', { hasText: '새 트리거' }).click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '페이지 추가됨' }).click(); await page.waitForTimeout(300);
await page.locator('.automation-add', { hasText: '새 작업' }).click(); await page.waitForTimeout(300);
const actionMenu = await page.locator('.menu-panel .menu-item').allInnerTexts();
await page.locator('.menu-item', { hasText: '변수 정의' }).click(); await page.waitForTimeout(300);
await page.locator('.automation-var-name').first().click(); await page.waitForTimeout(300);
const varMenu = await page.locator('.menu-panel .menu-item').allInnerTexts();
await page.locator('.menu-item', { hasText: '수식으로 편집' }).click(); await page.waitForTimeout(300);
await page.locator('.formula-input').fill('1 + 2'); await page.locator('.formula-head .blue-button').click(); await page.waitForTimeout(300);
await page.locator('.automation-add', { hasText: '작업 추가' }).click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '속성 편집…' }).hover(); await page.waitForTimeout(500);
await page.locator('.menu-panel .menu-item', { hasText: /^금액$/ }).last().click(); await page.waitForTimeout(400);
await page.locator('.automation-action-option', { hasText: '변수 1' }).click(); await page.waitForTimeout(300);
const card = await page.locator('.automation-card .automation-card-text').last().innerText();
await page.locator('.automation-save').click(); await page.waitForTimeout(600);
await page.locator('.db-new-main').click(); await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
s = await state();
const newest = s.objects.filter(o => o.kind === 'page' && o.alive && o.sourceId === sid && !o.template).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
ok('변수 정의: 작업 메뉴 끝에 있고, 이름 메뉴(텍스트로 · 수식으로 편집 · 복제 · 변수 지우기), 금액 ← 변수 1 = 3', actionMenu[actionMenu.length - 1]?.includes('변수 정의') && ['텍스트로 편집', '수식으로 편집', '복제', '변수 지우기'].every(label => varMenu.some(item => item.includes(label))) && /변수 1/.test(card) && newest?.values?.[p('amount')] === 3, `${card.replace(/\s+/g, ' ')} / ${newest?.values?.[p('amount')]}`);
const auto = s.objects.find(o => o.kind === 'automation' && o.alive && o.sourceId === sid);
if (auto) await post([{ type: 'automation.delete', id: auto.id }]);

// 5. 행 메뉴 › 속성 편집: the view's order, the title first, formulas in, the created stamp out
await go(`${db}-v0`);
await page.locator('.table-row').first().click({ button: 'right' }); await page.waitForTimeout(400);
await page.locator('.menu-item', { hasText: '속성 편집' }).hover(); await page.waitForTimeout(600);
const rowProps = await page.locator('.menu-panel').last().locator('.menu-item').allInnerTexts();
ok('행 메뉴 속성 편집: 이름이 먼저, 수식 포함, 생성 일시 제외', rowProps[0]?.includes('이름') && rowProps.some(item => item.includes('수식')) && !rowProps.some(item => item.includes('생성')), rowProps.join(','));
await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);

// 6. "여기서 시작" › 템플릿
const blank = `${root}-blank`;
await post([{ type: 'page.create', id: blank, title: '', parentId: root }]);
await go(blank);
const chips = await page.locator('.page-start-chip').allInnerTexts();
await page.locator('.page-start-chip', { hasText: '템플릿' }).click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '회의록' }).click(); await page.waitForTimeout(800);
s = await state();
ok('여기서 시작: 데이터베이스 · 양식 · 템플릿 · ⋯, 템플릿 "회의록"이 제목 · 아이콘 · 개요를 채움', chips.slice(0, 3).join(',') === '데이터베이스,양식,템플릿' && s.objects.find(o => o.id === blank)?.title === '회의록' && s.objects.filter(o => o.kind === 'block' && o.alive && o.parentId === blank).length >= 8, chips.join(','));

// 7. 페이지 레이아웃 사용자 지정
await go(`${db}-v0`); await settings();
await page.locator('.settings-row', { hasText: '기타 설정' }).click(); await page.waitForTimeout(300);
const more = await page.locator('.menu-panel .menu-item').allInnerTexts();
await page.locator('.menu-item', { hasText: '페이지 레이아웃 사용자 지정' }).click(); await page.waitForTimeout(600);
const canvas = await page.evaluate(() => { const r = document.querySelector('.layout-canvas')?.getBoundingClientRect(); return r ? [r.x, r.y, r.width] : null; });
await page.locator('.layout-section.clickable').click(); await page.waitForTimeout(300);
await page.locator('.layout-group-row', { hasText: '메모' }).locator('.layout-eye').click(); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.locator('.layout-panel-add').click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '금액' }).first().click(); await page.waitForTimeout(200);
await page.locator('.layout-apply-main').click(); await page.waitForTimeout(700);
await go(`${db}-r0`);
const mainProps = await page.locator('.page-body .page-properties .property-name span').allInnerTexts();
const panelProps = await page.locator('.page-panel .property-name span').allInnerTexts();
ok('페이지 레이아웃: 기타 설정(하위 항목 · 종속성 · 스프린트 · 페이지 레이아웃), 편집기 24/60에서 시작, 숨긴 속성은 빠지고 패널 속성은 옆 패널에', more.join(',') === '하위 항목,종속성,스프린트,페이지 레이아웃 사용자 지정' && canvas?.[0] === 24 && canvas?.[1] === 60 && !mainProps.includes('메모') && !mainProps.includes('금액') && panelProps.join() === '금액', `${more.join(',')} / ${mainProps.join(',')} / ${panelProps.join(',')}`);

// 8. 데이터베이스 잠금
await go(`${db}-v0`); await settings();
await page.locator('.settings-row', { hasText: '데이터베이스 잠금' }).click(); await page.waitForTimeout(500);
const disabled = await page.locator('.view-settings .settings-row:disabled .settings-row-label').allInnerTexts();
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.locator('.table-head-cell').nth(1).click(); await page.waitForTimeout(300);
const headerMenu = await page.locator('.menu-panel').count();
const lockedUi = { chip: await page.locator('.crumb-lock').innerText().catch(() => ''), addColumn: await page.locator('.table-head-add').count(), addView: await page.locator('.db-tab-add').count() };
await page.locator('.crumb-lock').click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '모든 사용자 잠금 해제' }).click(); await page.waitForTimeout(600);
s = await state();
ok('데이터베이스 잠금: 행 비활성(그룹 · 조건부 색상 · 소스 · 속성 편집 · 변환 · 기타 설정), 머리 메뉴 · + 숨김, "잠김" → 모든 사용자 잠금 해제', ['그룹', '조건부 색상', '소스', '속성 편집', '변환', '기타 설정'].every(label => disabled.includes(label)) && headerMenu === 0 && lockedUi.chip === '잠김' && !lockedUi.addColumn && !lockedUi.addView && !s.objects.find(o => o.id === sid)?.locked, `${disabled.join(',')} / ${JSON.stringify(lockedUi)}`);

// 9. 다크 모드 색: 차트 빈 그룹, 지도 바다 · 육지, 양식 카드 테두리
await page.addInitScript(() => { localStorage.setItem('pageyard-settings-v1', JSON.stringify({ theme: 'dark' })); });
await go(`${db}-v2`);
const emptyBar = await page.evaluate(() => [...document.querySelectorAll('.chart-svg path')].map(e => getComputedStyle(e).fill).find(fill => fill.startsWith('rgba(255, 255, 255')) ?? '-');
await go(`${db}-v3`);
const mapColors = await page.evaluate(() => ['.map-sea', '.map-land', '.map-border'].map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[sel === '.map-border' ? 'stroke' : 'fill'] : '-'; }).join(' / '));
await go(`${db}-v1`);
const ring = await page.evaluate(() => getComputedStyle(document.querySelectorAll('.form-question')[1]).boxShadow);
ok('다크: 차트 빈 그룹 rgba(255,255,255,.1) · 지도 rgb(61,72,92)/rgb(46,46,46)/rgb(95,80,98) · 양식 카드 rgb(53,95,139)', emptyBar === 'rgba(255, 255, 255, 0.1)' && mapColors === 'rgb(61, 72, 92) / rgb(46, 46, 46) / rgb(95, 80, 98)' && ring.includes('rgb(53, 95, 139)'), `${emptyBar} | ${mapColors} | ${ring}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
