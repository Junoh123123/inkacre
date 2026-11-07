// 18차 점검("다른 페이지로 옮기기" 고르기): 가운데 대화 상자가 아니라 연 곳 바로 아래 330×420 고르기 —
// 블록은 손잡이 아래(왼쪽 맞춤), 페이지 ⋯는 단추 아래(오른쪽 맞춤), ⌘⇧P도 페이지 ⋯ 아래. 자리글 "페이지의 이동 위치…",
// 페이지만(데이터베이스 없음). 치면 "페이지" 머리 아래 45 높이 결과(이름 + 위치 "A / ... / C"), Enter로 옮김 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite21.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite21-${Date.now()}`, tag = String(Date.now()).slice(-5);
await post([
  { type: 'page.create', id, title: '옮김 문서', parentId: null },
  { type: 'block.create', id: `${id}-p`, parentId: id, blockType: 'paragraph', richText: [{ text: '옮길 블록' }] },
  { type: 'page.create', id: `${id}-a`, title: `가 ${tag}`, parentId: null },
  { type: 'page.create', id: `${id}-b`, title: `나 ${tag}`, parentId: `${id}-a` },
  { type: 'page.create', id: `${id}-c`, title: `다 ${tag}`, parentId: `${id}-b` },
  { type: 'page.create', id: `${id}-d`, title: `목적지 ${tag}`, parentId: `${id}-c` },
  { type: 'page.create', id: `${id}-db`, title: `목적지 DB ${tag}`, parentId: null },
  { type: 'source.create', id: `${id}-src`, pageId: `${id}-db`, name: `목적지 DB ${tag}`, titlePropertyId: `${id}-t` },
  { type: 'view.create', id: `${id}-v`, sourceId: `${id}-src`, parentId: `${id}-db`, name: 'Default view', viewType: 'table', config: {} },
]);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const picker = () => page.evaluate(() => { const p = document.querySelector('.picker-popover'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), ph: p.querySelector('input').placeholder, heading: p.querySelector('.picker-panel-heading')?.textContent, rows: [...p.querySelectorAll('.picker-tree-title, .picker-result-title')].map(e => e.textContent) }; });

// 1. 블록 ⋮⋮ → 옮기기 → 손잡이 바로 아래(왼쪽 맞춤) 330×420
await page.locator('.page-editor .block', { hasText: /^옮길 블록$/ }).hover(); await page.waitForTimeout(250);
const handle = await page.locator('.block-handles .block-drag-handle').boundingBox();
await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(400);
await page.locator('.menu .menu-item').filter({ has: page.locator('.menu-item-label', { hasText: /^옮기기$/ }) }).click(); await page.waitForTimeout(500);
const blockPicker = await picker();
ok('블록 옮기기: 손잡이 바로 아래 왼쪽 맞춤 330×420 고르기, "페이지의 이동 위치…", 추천(개인 페이지 행 없이 페이지만), 데이터베이스 없음', blockPicker?.w === 330 && blockPicker.h === 420 && Math.abs(blockPicker.x - Math.round(handle.x)) <= 1 && Math.abs(blockPicker.y - Math.round(handle.y + handle.height)) <= 1 && blockPicker.ph === '페이지의 이동 위치…' && blockPicker.heading === '추천' && blockPicker.rows.length > 0 && !blockPicker.rows.includes('개인 페이지') && !blockPicker.rows.some(name => name.startsWith('목적지 DB')),`${JSON.stringify(blockPicker)} handle=${Math.round(handle.x)},${Math.round(handle.y + handle.height)}`);

// 2. 치면 "페이지" 결과(45 높이, 이름 + 위치 "가 / ... / 다"), Enter → 블록이 옮겨짐
await page.keyboard.type(`목적지 ${tag}`); await page.waitForTimeout(300);
const results = await page.evaluate(() => { const p = document.querySelector('.picker-popover'); const row = p.querySelector('.picker-result-row'); return row ? { heading: p.querySelector('.picker-panel-heading').textContent, h: Math.round(row.getBoundingClientRect().height), place: row.querySelector('.picker-result-place')?.textContent, active: row.classList.contains('active'), count: p.querySelectorAll('.picker-result-row').length, panel: Math.round(p.getBoundingClientRect().height) } : null; });
await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
const moved = (await state()).objects.find(o => o.id === `${id}-p`);
ok(`검색 → "페이지" 아래 45 높이 결과(위치 "가 ${tag} / ... / 다 ${tag}", 첫 줄 고름, 창은 결과 높이로), Enter → 블록이 목적지로`, results?.heading === '페이지' && results.h === 45 && results.place === `가 ${tag}/.../다 ${tag}` && results.active && results.count === 1 && results.panel < 420 && moved?.parentId === `${id}-d` && !(await page.locator('.picker-popover').count()), `${JSON.stringify(results)} ${moved?.parentId}`);

// 3. 페이지 ⋯ → 다른 페이지로 옮기기 → ⋯ 단추 바로 아래(오른쪽은 창 안 12까지), 고르면 페이지가 옮겨짐
const more = await page.locator('.topbar button[aria-haspopup="menu"]').last().boundingBox();
await page.locator('.topbar button[aria-haspopup="menu"]').last().click(); await page.waitForTimeout(400);
await page.locator('.menu .menu-item').filter({ has: page.locator('.menu-item-label', { hasText: /^다른 페이지로 옮기기$/ }) }).click(); await page.waitForTimeout(500);
const pagePicker = await picker();
await page.keyboard.type(`나 ${tag}`); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
const movedPage = (await state()).objects.find(o => o.id === id);
ok('페이지 ⋯ → 다른 페이지로 옮기기: ⋯ 단추 바로 아래, 오른쪽 맞춤(창 안 12), 고르면 페이지가 그 아래로', pagePicker?.w === 330 && pagePicker.y === Math.round(more.y + more.height) && pagePicker.right === Math.min(Math.round(more.x + more.width), 1512 - 12) && movedPage?.parentId === `${id}-b`, `${JSON.stringify(pagePicker)} more=${Math.round(more.x + more.width)},${Math.round(more.y + more.height)} ${movedPage?.parentId}`);

// 4. ⌘⇧P → 같은 고르기가 페이지 ⋯ 아래에, 개인 페이지(최상위)로도 옮길 수 있음
await page.locator('.page-editor').click(); await page.keyboard.press('ControlOrMeta+Shift+KeyP'); await page.waitForTimeout(500);
const keyPicker = await picker();
await page.locator('.picker-popover .picker-tree-row').first().click(); await page.waitForTimeout(1500);
const atRoot = (await state()).objects.find(o => o.id === id);
ok('⌘⇧P → 페이지 ⋯ 아래 고르기, 첫 줄 "개인 페이지"로 옮기면 최상위', keyPicker?.y === Math.round(more.y + more.height) && keyPicker.rows[0] === '개인 페이지' && atRoot?.parentId == null, `${JSON.stringify(keyPicker)} ${atRoot?.parentId}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
