// 18차 점검(전환 미리 보기 · "페이지로 옮기기"): 블록 메뉴 › 전환에서 항목을 가리키면 오른쪽에 어두운 미리 보기
// 카드(156 폭, 그림 140×100, 설명), 페이지 바로 다음 "페이지로 옮기기" › 페이지 고르기(400×420, "추가할 페이지 검색…",
// 추천: 개인 페이지 · 최근 페이지), 고르면 블록이 그 페이지 안의 페이지가 됨(안쪽 블록도 함께), 데이터베이스를 고르면 행 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite18.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite18-${Date.now()}`, sid = `${id}-src`, tag = String(Date.now()).slice(-5);
await post([
  { type: 'page.create', id, title: '옮기기 문서', parentId: null },
  { type: 'block.create', id: `${id}-p1`, parentId: id, blockType: 'paragraph', richText: [{ text: '옮길 문단' }] },
  { type: 'block.create', id: `${id}-p1c`, parentId: `${id}-p1`, blockType: 'paragraph', richText: [{ text: '안쪽 줄' }] },
  { type: 'block.create', id: `${id}-p2`, parentId: id, blockType: 'paragraph', richText: [{ text: '행이 될 문단' }] },
  { type: 'block.create', id: `${id}-p3`, parentId: id, blockType: 'paragraph', richText: [{ text: '남는 문단' }] },
  { type: 'page.create', id: `${id}-dest`, title: `받을 곳 ${tag}`, parentId: null },
  { type: 'page.create', id: `${id}-db`, title: `받는 DB ${tag}`, parentId: null },
  { type: 'source.create', id: sid, pageId: `${id}-db`, name: `받는 DB ${tag}`, titlePropertyId: `${id}-title` },
  { type: 'view.create', id: `${id}-v`, sourceId: sid, parentId: `${id}-db`, name: 'Default view', viewType: 'table', config: {} },
]);
const objects = async () => (await state()).objects;
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const block = text => page.locator('.page-editor .block', { hasText: new RegExp(`^${text}`) }).first();
const item = label => page.locator('.menu .menu-item').filter({ has: page.locator('.menu-item-label', { hasText: new RegExp(`^${label}$`) }) }).first();
const openTurnInto = async text => {
  await block(text).hover(); await page.waitForTimeout(250);
  await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(400);
  await item('전환').hover(); await page.waitForTimeout(500);
};

// 1. 전환 목록: 페이지 바로 다음 "페이지로 옮기기 ›"
await openTurnInto('옮길 문단');
const list = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item-label')].map(e => e.textContent).slice(4, 8).join('|'));
ok('전환: 제목4 · 페이지 · 페이지로 옮기기 › · 글머리 기호 목록', list === '제목4|페이지|페이지로 옮기기|글머리 기호 목록', list);

// 2. 가리키면 미리 보기 카드(156 폭, 그림 140×100, 설명), 항목 오른쪽 6 · 가운데
await item('제목1').hover(); await page.waitForTimeout(300);
const tip = await page.evaluate(() => { const t = document.querySelector('.menu-preview.shown'); const item = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-label')?.textContent === '제목1'); if (!t || !item) return null; const r = t.getBoundingClientRect(), i = item.getBoundingClientRect(), im = t.querySelector('.menu-preview-image').getBoundingClientRect(); return { text: t.querySelector('.menu-preview-text').textContent, w: r.width, gap: Math.round(r.left - i.right), mid: Math.round((r.top + r.height / 2) - (i.top + i.height / 2)), img: `${im.width}×${im.height}`, bg: getComputedStyle(t).backgroundColor }; });
ok('제목1을 가리키면 미리 보기 "큰 섹션 제목"(156 폭, 그림 140×100, 항목 오른쪽 6, 가운데 맞춤, #2c2c2b)', tip?.text === '큰 섹션 제목' && tip.w === 156 && tip.gap === 6 && Math.abs(tip.mid) <= 1 && tip.img === '140×100' && tip.bg === 'rgb(44, 44, 43)', JSON.stringify(tip));
await item('2개의 열').hover(); await page.waitForTimeout(300);
const cols = await page.evaluate(() => ({ text: document.querySelector('.menu-preview.shown .menu-preview-text')?.textContent, columns: document.querySelectorAll('.menu-preview.shown .bp-column').length }));
ok('2개의 열 미리 보기: "2개의 열로 된 블록을 만듭니다", 열 그림 2개', cols.text === '2개의 열로 된 블록을 만듭니다' && cols.columns === 2, JSON.stringify(cols));

// 3. 페이지로 옮기기 → 고르기(400×420, 검색 칸 포커스, 추천: 개인 페이지 · 최근)
await item('페이지로 옮기기').hover(); await page.waitForTimeout(600);
const picker = await page.evaluate(() => { const p = document.querySelector('.menu-sub-panel'); if (!p) return null; const r = p.getBoundingClientRect(); const input = p.querySelector('input'); const item = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-label')?.textContent === '페이지로 옮기기').getBoundingClientRect(); return { size: `${r.width}×${r.height}`, ph: input.placeholder, focused: document.activeElement === input, heading: p.querySelector('.picker-panel-heading')?.textContent, first: p.querySelector('.picker-tree-row .picker-tree-title')?.textContent, x: Math.round(r.left - item.right), mid: Math.round(r.top + r.height / 2 - (item.top + item.height / 2)), tip: !!document.querySelector('.menu-preview.shown') }; });
ok('페이지로 옮기기 ›: 400×420 고르기(항목 옆 · 가운데), "추가할 페이지 검색…" 포커스, 추천 · 개인 페이지 먼저, 미리 보기 없음', picker?.size === '400×420' && picker.ph === '추가할 페이지 검색…' && picker.focused && picker.heading === '추천' && picker.first === '개인 페이지' && picker.x === 0 && Math.abs(picker.mid) <= 1 && !picker.tip, JSON.stringify(picker));

// 4. 검색 → Enter: 블록이 "받을 곳 18" 안의 페이지가 되고 안쪽 줄도 함께, 이 페이지에서 사라짐
await page.keyboard.type(`받을 곳 ${tag}`); await page.waitForTimeout(300);
const found = await page.locator('.menu-sub-panel .picker-result-title').allTextContents();
await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
let all = await objects();
const moved = all.find(o => o.kind === 'page' && o.parentId === `${id}-dest` && o.title === '옮길 문단' && o.alive !== false);
const child = all.find(o => o.id === `${id}-p1c`);
const original = all.find(o => o.id === `${id}-p1`);
const shownNow = await page.locator('.page-editor .block', { hasText: /^옮길 문단/ }).count();
ok('"받을 곳 18" 골라 Enter → 그 안에 "옮길 문단" 페이지(안쪽 줄도 그 페이지로), 원래 블록은 휴지통 · 화면에서 사라짐', found.join('|') === `받을 곳 ${tag}` && !!moved && child?.parentId === moved?.id && original?.alive === false && shownNow === 0 && !(await page.locator('.menu-sub-panel').count()), `${found.join('|')} ${moved?.id} ${child?.parentId} ${original?.alive} ${shownNow}`);

// 5. 데이터베이스를 고르면 그 데이터베이스의 행
await openTurnInto('행이 될 문단');
await item('페이지로 옮기기').click(); await page.waitForTimeout(600);
await page.keyboard.type(`받는 DB ${tag}`); await page.waitForTimeout(300);
await page.locator('.menu-sub-panel .picker-result-row').first().click(); await page.waitForTimeout(1500);
all = await objects();
const row = all.find(o => o.kind === 'page' && o.sourceId === sid && o.title === '행이 될 문단' && o.alive !== false);
ok('데이터베이스 "받는 DB 18"을 고르면 그 행이 됨', !!row && all.find(o => o.id === `${id}-p2`)?.alive === false, row?.id);

// 6. 키보드: → 로 전환 하위 메뉴에 들어가 ↓ 하면 첫 항목 미리 보기
await block('남는 문단').hover(); await page.waitForTimeout(250);
await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
const keyTip = await page.evaluate(() => document.querySelector('.menu-preview.shown .menu-preview-text')?.textContent);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('키보드로 전환 › 첫 항목 → 미리 보기 "일반 텍스트로 바로 글쓰기를 시작합니다"', keyTip === '일반 텍스트로 바로 글쓰기를 시작합니다', keyTip);

// 7. 슬래시 메뉴: 화살표로 고른 항목에만 미리 보기(포인터로는 없음), 그림 없는 항목(HTML)은 설명만
await block('남는 문단').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/'); await page.waitForTimeout(400);
const atOpen = await page.locator('.menu-preview.shown').count();
const suggested = await page.evaluate(() => { const g = document.querySelector('.slash-group'); return `${g.querySelector('.slash-heading').textContent}:${[...g.querySelectorAll('.slash-item-label')].map(e => e.textContent).join('|')}`; });
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
const slashTip = await page.evaluate(() => { const t = document.querySelector('.menu-preview.shown'); const item = document.querySelector('.slash-item.active'); if (!t || !item) return null; const r = t.getBoundingClientRect(), i = item.getBoundingClientRect(); return { text: t.querySelector('.menu-preview-text').textContent, gap: Math.round(r.left - i.right), img: !!t.querySelector('.menu-preview-image') }; });
const other = await page.locator('.slash-item').nth(4).boundingBox(); await page.mouse.move(other.x + 40, other.y + 10); await page.mouse.move(other.x + 60, other.y + 12); await page.waitForTimeout(250);
const afterPointer = await page.locator('.menu-preview.shown').count();
await page.keyboard.type('html'); await page.waitForTimeout(300); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
const htmlTip = await page.evaluate(() => { const t = document.querySelector('.menu-preview.shown'); return t ? { text: t.querySelector('.menu-preview-text').textContent, img: !!t.querySelector('.menu-preview-image'), h: Math.round(t.getBoundingClientRect().height) } : null; });
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('슬래시: 맨 위 추천(HTML · 임베드 | 페이지 | 데이터 소스 연결 보기 · 데이터베이스), 열 때는 미리 보기 없음, ↓로 고른 "페이지" → "이 페이지 안에 하위 페이지를 넣습니다"(항목 오른쪽 6), 포인터로 옮기면 사라짐, HTML은 그림 없이 설명만', suggested === '추천:HTML · 임베드|페이지|데이터 소스 연결 보기 · 데이터베이스' && atOpen === 0 && slashTip?.text === '이 페이지 안에 하위 페이지를 넣습니다' && slashTip.gap === 6 && slashTip.img && afterPointer === 0 && htmlTip?.text === 'HTML 파일을 올립니다' && !htmlTip.img, `${suggested} ${atOpen} ${JSON.stringify(slashTip)} ${afterPointer} ${JSON.stringify(htmlTip)}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
