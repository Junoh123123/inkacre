// 17차 점검: 탭 블록 — "/탭"으로 만들기(탭1·탭2·탭3, 첫 탭 표시, 아래 새 줄에 커서),
// 크기(바깥 여백 8 · 테두리 r16 · 머리 62 · 알약 32 · 간격 4 · 내용 x+25), 빈 탭 안내와 편집, 탭 바꾸기(새로 고쳐도 유지),
// 보이는 탭을 누르면 메뉴(180 폭, 4 아래: 이름 바꾸기 · 아이콘 편집 · 링크 복사 · 삭제), 이름 바꾸기, "+"(머리에 올릴 때만)로
// 탭N 추가, 탭 삭제(이웃 탭 표시), ⋮⋮ 블록 메뉴, 마지막 탭을 지우면 블록이 지워짐 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite14.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const alive = objects => objects.filter(o => o.alive !== false && !o.trashedAt);

const root = `suite14-${Date.now()}`, doc = `${root}-doc`;
await post([
  { type: 'page.create', id: root, title: '탭 점검', parentId: null },
  { type: 'page.create', id: doc, title: '탭 문서', parentId: root },
  { type: 'block.create', id: `${doc}-b1`, parentId: doc, blockType: 'paragraph', richText: [{ text: '탭 앞 문단' }] },
]);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${doc}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const engineTabs = async () => {
  const objects = alive((await state()).objects);
  const tabs = objects.find(o => o.kind === 'block' && o.blockType === 'tabs' && o.parentId === doc);
  if (!tabs) return null;
  const list = objects.filter(o => o.parentId === tabs.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return { id: tabs.id, tabs: list.map(tab => ({ id: tab.id, name: (tab.richText ?? []).map(r => r.text).join(''), icon: tab.icon ?? null, content: objects.filter(o => o.parentId === tab.id).map(o => (o.richText ?? []).map(r => r.text).join('')) })) };
};
const pills = () => page.evaluate(() => [...document.querySelectorAll('.block-tabs .tab-pill')].map(p => `${p.textContent}${p.classList.contains('active') ? '*' : ''}`).join(' '));

// 1. "/탭" → 탭1·탭2·탭3(첫 탭 표시), 커서는 블록 아래 새 줄. 크기.
await page.locator('.page-editor .block-text').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
await page.keyboard.type('/탭'); await page.waitForTimeout(400);
const slash = await page.evaluate(() => { const item = [...document.querySelectorAll('.slash-menu .menu-item, .slash-menu [role=option]')].find(e => e.textContent.startsWith('탭')); return item ? item.textContent : '-'; });
await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const made = await page.evaluate(() => {
  const block = document.querySelector('.block-tabs'); if (!block) return null;
  const r = block.getBoundingClientRect(), frame = block.querySelector('.tabs-frame').getBoundingClientRect(), header = block.querySelector('.tabs-header').getBoundingClientRect();
  const pills = [...block.querySelectorAll('.tab-pill')].map(p => p.getBoundingClientRect());
  const hint = block.querySelector('.tab-panel.tab-active .tab-empty-hint'); const h = hint?.getBoundingClientRect();
  const caret = getSelection().anchorNode; const caretBlock = (caret?.nodeType === 3 ? caret.parentElement : caret)?.closest('.block');
  return { frame: `${Math.round(frame.left - r.left)},${Math.round(frame.top - r.top)},${Math.round(r.width - frame.width)}`, radius: getComputedStyle(block.querySelector('.tabs-frame')).borderRadius,
    header: Math.round(header.height), pill: `${Math.round(pills[0].height)} gap ${Math.round(pills[1].left - pills[0].right)} x+${Math.round(pills[0].left - r.left)}`,
    hint: hint ? `${hint.textContent}|${Math.round(h.height)}|x+${Math.round(h.left - r.left)}` : '-', caretBelow: !!caretBlock && caretBlock.previousElementSibling === block && caretBlock.textContent === '' };
});
await page.waitForTimeout(1500);
let engine = await engineTabs();
ok('"/탭"(신규 표시) → 탭1·탭2·탭3, 첫 탭 표시, 아래 새 줄에 커서', slash.includes('신규') && (await pills()) === '탭1* 탭2 탭3' && made?.caretBelow && engine?.tabs.map(tab => tab.name).join(',') === '탭1,탭2,탭3', `${slash} ${await pills()} ${JSON.stringify(engine?.tabs.map(t => t.name))} caretBelow=${made?.caretBelow}`);
ok('크기: 바깥 8 · r16 · 머리 62 · 알약 32(간격 4, x+25) · 빈 탭 안내 30(x+25)', made && made.frame === '8,8,16' && made.radius === '16px' && made.header === 62 && made.pill === '32 gap 4 x+25' && made.hint === '빈 탭입니다. 클릭하여 편집하거나 블록을 끌어다 놓으세요.|30|x+25', JSON.stringify(made));

// 2. 탭2를 누르면 탭2 표시, 새로 고쳐도 유지
await page.locator('.tab-pill', { hasText: '탭2' }).click(); await page.waitForTimeout(400);
const switched = await pills();
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
ok('탭2를 누르면 탭2 표시, 새로 고쳐도 탭2', switched === '탭1 탭2* 탭3' && (await pills()) === '탭1 탭2* 탭3', `${switched} → ${await pills()}`);

// 3. 빈 탭 안내를 누르면 그 탭에서 입력 → 엔진에 그 탭의 내용으로
await page.locator('.tab-panel.tab-active .tab-empty-hint').click(); await page.waitForTimeout(300);
await page.keyboard.type('둘째 탭 내용'); await page.waitForTimeout(1500);
engine = await engineTabs();
ok('빈 탭 안내를 눌러 입력 → 탭2의 내용으로 저장', engine?.tabs[1]?.content.join('|') === '둘째 탭 내용' && !(await page.locator('.tab-panel.tab-active .tab-empty-hint').count()), JSON.stringify(engine?.tabs[1]));

// 4. 보이는 탭을 누르면 메뉴(180 폭, 탭 4 아래, 왼쪽 맞춤)
await page.locator('.tab-pill.active').click(); await page.waitForTimeout(400);
const menu = await page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); const p = document.querySelector('.tab-pill.active').getBoundingClientRect(); const r = m?.getBoundingClientRect(); return m ? { items: [...m.querySelectorAll('.menu-item-label')].map(e => e.textContent).join('|'), w: Math.round(r.width), dy: Math.round(r.top - p.bottom), dx: Math.round(r.left - p.left) } : null; });
ok('보이는 탭을 누르면 메뉴: 이름 바꾸기 · 아이콘 편집 · 링크 복사 · 삭제 (180, 4 아래)', menu?.items === '이름 바꾸기|아이콘 편집|링크 복사|삭제' && menu.w === 180 && menu.dy === 4 && menu.dx === 0, JSON.stringify(menu));

// 5. 이름 바꾸기 → 이름 전체가 골라진 채 편집, "계획" Enter → 저장
await page.locator('.menu .menu-item', { hasText: '이름 바꾸기' }).click(); await page.waitForTimeout(300);
const editing = await page.evaluate(() => { const e = document.activeElement; return e?.classList.contains('tab-title-input') ? `${e.textContent}|${getSelection().toString()}` : '-'; });
await page.keyboard.type('계획'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
engine = await engineTabs();
ok('이름 바꾸기: 이름이 골라진 채 편집 → "계획" Enter 저장', editing === '탭2|탭2' && (await pills()) === '탭1 계획* 탭3' && engine?.tabs[1]?.name === '계획', `${editing} ${await pills()} ${engine?.tabs[1]?.name}`);

// 6. "+"는 머리에 올릴 때만 보임 → 누르면 탭4(표시, 이름 편집 중), Esc로 그대로
const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.tabs-add-wrap')).opacity);
await page.locator('.tabs-header').hover(); await page.waitForTimeout(200);
const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.tabs-add-wrap')).opacity);
await page.locator('.tabs-add').click(); await page.waitForTimeout(300);
const adding = await page.evaluate(() => { const e = document.activeElement; return e?.classList.contains('tab-title-input') ? `${e.textContent}|${getSelection().toString()}` : '-'; });
await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
engine = await engineTabs();
ok('"+"(머리에 올릴 때만) → 탭4 추가·표시·이름 편집, Esc로 그대로', hidden === '0' && shown === '1' && adding === '탭4|탭4' && (await pills()) === '탭1 계획 탭3 탭4*' && engine?.tabs.length === 4, `${hidden}/${shown} ${adding} ${await pills()} ${engine?.tabs.length}`);

// 7. 탭4 삭제 → 앞 탭(탭3) 표시
await page.locator('.tab-pill.active').click(); await page.waitForTimeout(300);
await page.locator('.menu .menu-item', { hasText: '삭제' }).click(); await page.waitForTimeout(1500);
engine = await engineTabs();
ok('표시된 마지막 탭 삭제 → 앞 탭 표시', (await pills()) === '탭1 계획 탭3*' && engine?.tabs.length === 3, `${await pills()} ${engine?.tabs.length}`);

// 8. ⋮⋮(틀 위쪽) → 블록 메뉴: 탭 · 블록 링크 복사 · 복제 · 옮기기 · 삭제 · 댓글 (전환·색 없음)
await page.mouse.move(1, 1); await page.locator('.tabs-header').hover(); await page.waitForTimeout(400);
const handle = await page.evaluate(() => { const h = document.querySelector('.block-handles .block-drag-handle')?.getBoundingClientRect(); const b = document.querySelector('.block-tabs').getBoundingClientRect(); return h ? { dy: Math.round(h.top - b.top), dx: Math.round(b.left - h.left) } : null; });
await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(400);
const blockMenu = await page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); return m ? [...m.querySelectorAll('.menu-heading, .menu-item-label')].map(e => e.textContent).join('|') : '-'; });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('⋮⋮(틀 위, 블록 x−28) → 블록 메뉴: 탭 · 링크 복사 · 복제 · 옮기기 · 삭제 · 댓글 · 여기서 프레젠테이션 시작', handle?.dy === 8 && handle?.dx === 28 && blockMenu === '탭|블록 링크 복사|복제|옮기기|삭제|댓글|여기서 프레젠테이션 시작', `${JSON.stringify(handle)} ${blockMenu}`);

// 9. 탭을 하나씩 지워 마지막 탭을 지우면 블록이 지워짐(내용 포함)
for (let i = 0; i < 3; i++) {
  await page.locator('.tab-pill.active').click(); await page.waitForTimeout(300);
  await page.locator('.menu .menu-item', { hasText: '삭제' }).click(); await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);
engine = await engineTabs();
ok('마지막 탭을 지우면 탭 블록이 지워짐', !engine && !(await page.locator('.block-tabs').count()), JSON.stringify(engine));

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
