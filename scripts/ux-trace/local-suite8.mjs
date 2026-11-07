// 12차 점검: 라이브러리 자리, 차트 동점 순서와 다크 색, 양식 질문(유형 바꾸기 · 답 모양 · 옵션 창), 자동화(⚡ 편집기 ·
// 목록 · 실행), 여러 데이터 소스(추가 · 이름 머리 · 휴지통) — 1512×828, 스크롤 막대 보임.
// 사용법: node scripts/ux-trace/local-suite8.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };

const root = `suite8-${Date.now()}`, db = `${root}-db`, sid = `${db}-src`, p = name => `${db}-p-${name}`;
const st = { todo: `${db}-s1`, doing: `${db}-s2`, done: `${db}-s3` }, tag = { design: `${db}-t1`, dev: `${db}-t2`, research: `${db}-t3` };
const ops = [
  { type: 'page.create', id: root, title: '분석 실험 모음 2026-10-19', parentId: null },
  { type: 'page.create', id: db, title: '측정 DB', parentId: root },
  { type: 'source.create', id: sid, pageId: db, name: '측정 DB', titlePropertyId: p('title') },
];
const props = [['memo', '메모', 'text'], ['check', '체크', 'checkbox'], ['email', '이메일', 'email'], ['date', '일정', 'date'],
  ['tag', '태그', 'multi_select', { options: [{ id: tag.design, name: '디자인', color: 'pink' }, { id: tag.dev, name: '개발', color: 'blue' }, { id: tag.research, name: '조사', color: 'green' }] }],
  ['amount', '금액', 'number'], ['file', '파일', 'files'],
  ['status', '상태', 'status', { options: [{ id: st.todo, name: '시작 전', group: '할 일', color: 'gray' }, { id: st.doing, name: '진행 중', group: '진행 중', color: 'blue' }, { id: st.done, name: '완료', group: '완료', color: 'green' }] }],
  ['select', '선택', 'select', { options: [{ id: `${db}-o1`, name: '낮음', color: 'gray' }, { id: `${db}-o2`, name: '보통', color: 'yellow' }, { id: `${db}-o3`, name: '높음', color: 'red' }] }],
  ['owner', '담당', 'person'], ['place', '장소', 'place']];
for (const [key, name, propertyType, extra = {}] of props) ops.push({ type: 'property.create', id: p(key), sourceId: sid, name, propertyType, ...extra });
[['베타', { tag: [tag.research], status: st.todo }], ['델타', { status: st.doing }], ['감마', { status: st.done }], ['알파', { tag: [tag.design, tag.dev], status: st.doing }]].forEach(([name, values], i) => {
  ops.push({ type: 'page.create', id: `${db}-r${i}`, title: `측정 작업 ${name}`, parentId: sid, sourceId: sid });
  for (const [key, value] of Object.entries(values)) ops.push({ type: 'value.set', pageId: `${db}-r${i}`, propertyId: p(key), value });
});
ops.push({ type: 'view.create', id: `${db}-v0`, sourceId: sid, parentId: db, name: 'Default view', viewType: 'table', config: {} },
  { type: 'view.create', id: `${db}-v1`, sourceId: sid, parentId: db, name: '차트', viewType: 'chart', config: { chart: { groupBy: p('tag'), aggregation: 'count', type: 'bar', sort: 'valueDesc' } } },
  { type: 'view.create', id: `${db}-v2`, sourceId: sid, parentId: db, name: '양식', viewType: 'form', config: { form: { title: '', description: '', questions: ['title', 'memo', 'check', 'email', 'date', 'tag', 'amount', 'file', 'select', 'owner', 'place'].map(key => ({ propertyId: p(key) })) } } });
await post(ops);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const go = async id => { await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const box = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); }, sel);
const near = (a, b, d = 1.5) => Math.abs(a - b) <= d;

// 1. library: title and tabs start at 374; the tools end 8 before the "새 페이지" button
await page.goto(`${base}/?library=recents`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
const lib = await page.evaluate(() => { const r = e => { const b = document.querySelector(e)?.getBoundingClientRect(); return b ? [b.x, b.y, b.width] : null; }; const range = document.createRange(); range.selectNodeContents(document.querySelector('.library-title-text').firstChild); const t = range.getBoundingClientRect(); const tools = [...document.querySelectorAll('.library-tools button')].map(e => e.getBoundingClientRect()); return { title: t.x, tab: r('.library-tabs > *'), toolsEnd: tools.length ? tools[tools.length - 1].right : null, newEnd: document.querySelector('.library-new').getBoundingClientRect().right }; });
ok('라이브러리: 제목 · 탭 x 374, 도구 끝 = 새 페이지 끝 − 8', near(lib.title, 374, 0.5) && near(lib.tab[0], 374, 0.5) && near(lib.toolsEnd, lib.newEnd - 8, 0.5), JSON.stringify(lib));

// 2. chart: equal counts go by name (개발 · 디자인 · 조사); dark bars and grid
await go(`${db}-v1`);
const labels = await page.evaluate(() => [...document.querySelectorAll('.chart-svg text.chart-axis-text')].map(t => t.textContent).filter(t => /[가-힣]/.test(t)));
ok('차트 값 정렬 동점은 이름순: 태그 없음 2 → 개발 · 디자인 · 조사', JSON.stringify(labels.slice(0, 4)) === JSON.stringify(['태그 없음', '개발', '디자인', '조사']), JSON.stringify(labels));
await page.evaluate(() => { localStorage.setItem('pageyard-settings-v1', JSON.stringify({ theme: 'dark' })); }); await go(`${db}-v1`);
const dark = await page.evaluate(() => ({ fills: [...document.querySelectorAll('.chart-svg path[fill]')].map(e => e.getAttribute('fill')).filter(f => f.startsWith('rgb')), grid: getComputedStyle(document.querySelector('.chart-svg line[stroke-dasharray="1 3"]')).stroke, outline: getComputedStyle(document.querySelector('.chart-svg path[stroke="#fff"]')).stroke }));
// 13차: 다크의 빈 그룹 막대는 rgba(255,255,255,.1).
ok('다크 차트: 빈 막대 rgba(255,255,255,.1), 격자 #383836, 막대 테두리 #191919', dark.fills[0] === 'rgba(255, 255, 255, 0.1)' && dark.grid === 'rgb(56, 56, 54)' && dark.outline === 'rgb(25, 25, 25)', JSON.stringify(dark));
await go(`${db}-v2`);
const darkForm = await page.evaluate(() => getComputedStyle(document.querySelector('.form-answer-box')).boxShadow);
ok('다크 양식: 답 상자 테두리 #2c2c2b (밝은 #f0efed의 짝)', darkForm.includes('44, 44, 43'), darkForm);
await page.evaluate(() => { localStorage.setItem('pageyard-settings-v1', JSON.stringify({ theme: 'light' })); });

// 3. form builder: answer shapes and card heights
await go(`${db}-v2`);
const cards = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.form-builder .form-question')].map(card => [card.querySelector('.form-question-title').value, Math.round(card.getBoundingClientRect().height)])));
ok('양식 카드 높이: 글 120 · 날짜 112 · 다중 선택 240 · 선택 204 · 사람 148 · 파일 126 · 위치 120', cards['메모'] === 120 && cards['일정'] === 112 && cards['태그'] === 240 && cards['선택'] === 204 && cards['담당'] === 148 && cards['파일'] === 126 && cards['장소'] === 120, JSON.stringify(cards));
const note = await page.locator('.form-question', { has: page.locator('textarea[aria-label="태그"]') }).locator('.form-question-note').innerText();
const upload = await page.locator('.form-upload-button').innerText();
ok('여러 개 고르는 질문의 안내 "(응답자는 여러 개 선택 가능)", 파일은 흐린 "업로드" 단추', note === '(응답자는 여러 개 선택 가능)' && upload.includes('업로드'), `${note} / ${upload}`);
const memo = page.locator('.form-question', { has: page.locator('textarea[aria-label="메모"]') });
await memo.hover(); await memo.locator('.form-question-more').click(); await page.waitForTimeout(400);
const panel = await box('.form-options'), memoBox = await memo.evaluate(e => { const r = e.getBoundingClientRect(); return [r.right, r.top]; });
const rows = await page.locator('.form-options .chart-card-row > span:first-of-type').allInnerTexts();
ok('질문 옵션: 카드 오른쪽 24 옆, 290 폭; 필수 · 설명 · 긴 답변 · 질문 유형 · 연결된 속성 보기 · 속성 이름과 동기화 · 질문 이동 · 질문 복제 · 질문 삭제', panel && near(panel[0], memoBox[0] + 24, 0.5) && panel[2] === 290 && JSON.stringify(rows) === JSON.stringify(['필수', '설명', '긴 답변', '질문 유형', '연결된 속성 보기', '속성 이름과 동기화', '질문 이동', '질문 복제', '질문 삭제']), `${JSON.stringify(panel)} ${JSON.stringify(rows)}`);
await page.locator('.form-options .chart-card-row', { hasText: '질문 유형' }).click(); await page.waitForTimeout(300);
const typeMenu = await box('.question-type-menu');
ok('질문 유형 메뉴 250×458, 11가지', typeMenu && typeMenu[2] === 250 && near(typeMenu[3], 458, 1) && (await page.locator('.question-type-menu .menu-item').count()) === 11, JSON.stringify(typeMenu));
await page.locator('.question-type-menu .menu-item', { hasText: '숫자' }).click(); await page.waitForTimeout(600);
let s = await state();
ok('질문 유형을 숫자로 바꾸면 속성이 숫자로 바뀜', s.objects.find(o => o.id === p('memo'))?.type === 'number');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const tagCard = page.locator('.form-question', { has: page.locator('textarea[aria-label="태그"]') });
await tagCard.hover(); await tagCard.locator('.form-question-more').click(); await page.waitForTimeout(300);
await page.locator('.form-options .chart-card-row', { hasText: '최대 선택 수' }).click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: /^2$/ }).click(); await page.waitForTimeout(500);
s = await state();
ok('다중 선택 질문의 최대 선택 수가 보기에 저장됨', s.objects.find(o => o.id === `${db}-v2`).config.form.questions.find(q => q.propertyId === p('tag'))?.maxSelections === 2);
await page.keyboard.press('Escape');

// 4. automations
await go(`${db}-v0`);
await page.locator('.db-tool[aria-label="자동화"]').click(); await page.waitForTimeout(500);
const editor = await box('.automation-editor'), add = await box('.automation-add'), conn = await box('.automation-connector');
ok('⚡ 자동화가 없으면 바로 편집 창: 500×600 (506,88), 새 트리거 카드 (523,215) 466 폭, 연결선 277', editor && JSON.stringify(editor) === '[506,88,500,600]' && add && near(add[0], 523, 0.5) && near(add[1], 215, 0.5) && add[2] === 466 && conn && near(conn[1], 277, 0.5), `${JSON.stringify(editor)} ${JSON.stringify(add)} ${JSON.stringify(conn)}`);
await page.locator('.automation-add', { hasText: '새 트리거' }).click(); await page.waitForTimeout(300);
const triggerMenu = await box('.menu-panel');
ok('트리거 메뉴 266×414 (523,261)', triggerMenu && JSON.stringify(triggerMenu) === '[523,261,266,414]', JSON.stringify(triggerMenu));
await page.locator('.menu-item', { hasText: '페이지 추가됨' }).click(); await page.waitForTimeout(200);
await page.locator('.automation-add', { hasText: '새 작업' }).click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '알림 보내기…' }).click(); await page.waitForTimeout(300);
await page.locator('.automation-action .automation-var-input').click(); await page.keyboard.type('새 업무가 들어왔습니다'); await page.waitForTimeout(150); await page.locator('.automation-values-done').click(); await page.waitForTimeout(200);
const saveLabel = await page.locator('.automation-save').innerText();
await page.locator('.automation-save').click(); await page.waitForTimeout(600);
s = await state();
const automation = s.objects.find(o => o.kind === 'automation' && o.alive && o.sourceId === sid);
ok('활성화로 저장: 페이지 추가됨 → 알림 보내기', saveLabel === '활성화' && automation?.triggers?.[0]?.type === 'page_added' && automation.actions[0].action === 'notify', JSON.stringify(automation?.actions));
await post([{ type: 'page.create', id: `${db}-auto-row`, title: '자동화 확인', sourceId: sid }]);
s = await state();
ok('행을 추가하면 같은 명령 안에서 알림이 생김', s.objects.some(o => o.kind === 'notification' && o.parentId === `${db}-auto-row` && o.message === '새 업무가 들어왔습니다'));
await go(`${db}-v0`);
ok('⚡ 켜진 자동화가 있으면 파란색', (await page.locator('.db-tool[aria-label="자동화"]').getAttribute('class')).includes('automation-on'));
await page.locator('.db-tool[aria-label="자동화"]').click(); await page.waitForTimeout(500);
const list = { panel: await box('.view-settings'), search: await box('.automations-search'), item: await box('.automation-item'), add: await box('.automations-new') };
ok('목록: 패널 (1126,166.4) 290, 검색 (1138,216.4), 카드 (1138,364.4) 266, 새 자동화는 카드 32 아래 258 폭', list.panel && near(list.panel[0], 1126, 0.5) && near(list.search[1], 216.4, 0.5) && near(list.item[1], 364.4, 0.5) && list.item[2] === 266 && near(list.add[1], list.item[1] + list.item[3] + 32, 0.5) && list.add[2] === 258, JSON.stringify(list));
await page.locator('.automation-item').hover(); await page.locator('.automation-item-more').click(); await page.waitForTimeout(300);
await page.locator('.automation-active-row .switch').click(); await page.waitForTimeout(400);
s = await state();
ok('⋯ › 활성 끄기', s.objects.find(o => o.id === automation.id)?.enabled === false);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.locator('.automation-item').hover(); await page.locator('.automation-item-more').click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '삭제' }).click(); await page.waitForTimeout(300); await page.locator('.confirm-small-ok').click(); await page.waitForTimeout(500);
s = await state();
ok('⋯ › 삭제 (확인 후)', !s.objects.find(o => o.id === automation.id)?.alive);

// 5. several data sources
await page.keyboard.press('Escape'); await go(`${db}`);
await page.locator('.db-tool[aria-label="보기 설정"]').click(); await page.waitForTimeout(300);
const dsRows = await page.locator('.view-settings .settings-section').nth(-2).locator('.settings-row-label').allInnerTexts();
ok('데이터 소스 설정: 소스 · 속성 편집 · 자동화 · 변환 · 기타 설정', JSON.stringify(dsRows) === JSON.stringify(['소스', '속성 편집', '자동화', '변환', '기타 설정']), JSON.stringify(dsRows));
await page.locator('.settings-row', { hasText: '데이터 소스 관리' }).click(); await page.waitForTimeout(300);
await page.locator('.ds-add', { hasText: '데이터 소스 추가' }).click(); await page.waitForTimeout(1200);
const heading = await box('.db-source-title');
const tab = await page.evaluate(() => { const t = document.querySelector('.db-tab.active span'); const r = document.createRange(); r.selectNodeContents(t); return Math.round(r.getBoundingClientRect().y * 10) / 10; });
const newPanel = await page.locator('.view-settings .settings-title').innerText();
ok('추가하면 새 소스의 표 보기가 열리고 소스 이름 머리 (374,130.4) 24px, 탭 글자 y ≈ 183.7, "새 데이터 소스" 패널', heading && near(heading[0], 374, 0.5) && near(heading[1], 130.4, 0.5) && near(tab, 183.7, 1) && newPanel === '새 데이터 소스', `${JSON.stringify(heading)} ${tab} ${newPanel}`);
await page.locator('.ds-new-row', { hasText: '작업 관리' }).click(); await page.waitForTimeout(800);
s = await state();
const second = s.objects.find(o => o.kind === 'source' && o.alive && o.parentId === db && o.id !== sid);
ok('작업 관리로 채우기: 이름 "작업", 상태 · 담당자 · 마감일 · 우선순위', second?.name === '작업' && ['상태', '담당자', '마감일', '우선순위'].every(name => s.objects.some(o => o.kind === 'property' && o.alive && o.sourceId === second.id && o.name === name)));
await page.locator('.db-source-title').fill('작업 목록'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
s = await state();
ok('소스 이름 머리에서 이름 바꾸기', s.objects.find(o => o.id === second.id)?.name === '작업 목록');
await page.locator('.db-tool[aria-label="보기 설정"]').click(); await page.waitForTimeout(300);
await page.locator('.settings-row', { hasText: '데이터 소스 관리' }).click(); await page.waitForTimeout(300);
const counts = await page.locator('.ds-row').allInnerTexts();
await page.locator('.ds-row').nth(1).locator('.ds-more').click(); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '휴지통으로 이동' }).click(); await page.waitForTimeout(300); await page.locator('.confirm-small-ok').click(); await page.waitForTimeout(1200);
s = await state();
ok('관리 목록 "N개 보기", 휴지통으로 이동하면 소스와 보기가 함께 빠지고 머리가 사라짐', counts.length === 2 && counts[1].includes('1개 보기') && !s.objects.find(o => o.id === second.id)?.alive && (await box('.db-source-title')) === null, JSON.stringify(counts));
ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
