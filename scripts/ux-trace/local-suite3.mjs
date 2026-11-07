// 4차 점검: 메뉴 단추 다시 누르기, 홈 탭 메뉴, 사이드바 행 메뉴·이름 바꾸기, 표 행 손잡이(+ / ⋮⋮).
// 사용법: node scripts/ux-trace/local-suite3.mjs <fixture 주소> <측정 DB 페이지 id>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base, dbId] = process.argv.slice(2);
const shots = process.env.SHOTS ?? (await import('node:os')).tmpdir() + '/ux-suite3';
import { mkdirSync } from 'node:fs';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const menus = () => page.evaluate(() => [...document.querySelectorAll('.popover-panel')].map(p => p.getAttribute('aria-label') || p.className.split(' ').slice(1, 3).join('.')).join(' / ') || 'none');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
await page.goto(`${base}/?id=handoff-root`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);

// 1. toggles
for (const [label, sel] of [['로컬 워크스페이스', '.workspace-switcher'], ['라이브러리, 휴지통, 기타', '.sidebar-foot button[aria-label^="라이브러리"]'], ['개인 페이지 ⋯', '.sidebar-section-head:has(.sidebar-section-label:text("개인 페이지")) button[aria-label="메뉴 열기"]'], ['홈 탭', '.sidebar-tab']]) {
  const el = page.locator(sel).first();
  await el.hover(); await el.click(); await page.waitForTimeout(250); const first = await menus();
  await el.click(); await page.waitForTimeout(250); const second = await menus();
  ok(`${label}: 한 번 클릭 → 열림, 다시 클릭 → 닫힘`, first !== 'none' && second === 'none', `${first} → ${second}`);
  await page.keyboard.press('Escape');
}
// 홈 tab stays selected on the library and doesn't navigate
await page.locator('.sidebar-shortcut').click(); await page.waitForTimeout(300);
const tabState = await page.evaluate(() => ({ sel: document.querySelector('.sidebar-tab.selected')?.getAttribute('aria-selected'), lib: !!document.querySelector('.library') }));
await page.locator('.sidebar-tab.selected').click(); await page.waitForTimeout(300);
const stillLib = await page.evaluate(() => !!document.querySelector('.library'));
const items = await page.evaluate(() => [...document.querySelectorAll('.popover-panel .menu-item, .popover-panel .menu-section')].map(e => e.textContent.trim()).join(' | '));
ok('홈 탭 클릭 → 탭 메뉴 (페이지 이동 없음)', tabState.lib && stillLib && /이름 바꾸기/.test(items), items);
await page.screenshot({ path: `${shots}/tab-menu.png`, clip: { x: 0, y: 0, width: 320, height: 360 } });
await page.getByRole('menuitem', { name: '이름 바꾸기' }).click(); await page.waitForTimeout(250);
const pop = await page.evaluate(() => { const p = document.querySelector('.rename-popover'); const b = p?.getBoundingClientRect(); const i = document.activeElement; return p ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), i.tagName, i.selectionStart + '-' + i.selectionEnd].join(',') : 'none'; });
await page.screenshot({ path: `${shots}/tab-rename.png`, clip: { x: 0, y: 0, width: 320, height: 200 } });
await page.keyboard.type('작업 공간'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
ok('이름 바꾸기 패널 (탭 아래, 글자 선택) → Enter', (await page.locator('.sidebar-tab.selected').textContent()) === '작업 공간', pop);
await page.locator('.sidebar-tab.selected').click(); await page.getByRole('menuitem', { name: '탭 이름 숨기기' }).click(); await page.waitForTimeout(200);
const w = await page.locator('.sidebar-tab.selected').evaluate(e => e.getBoundingClientRect().width);
ok('탭 이름 숨기기 → 아이콘만', w === 32, `width ${w}`);
await page.locator('.sidebar-tab.selected').click(); await page.getByRole('menuitem', { name: '탭 초기화' }).click(); await page.waitForTimeout(200);
ok('탭 초기화', (await page.locator('.sidebar-tab.selected').textContent()) === '홈');

// 2. sidebar row menu + rename
await page.goto(`${base}/?id=handoff-root`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
const row = page.locator('[data-section="private"] .sidebar-row').first();
await row.hover(); await row.locator('button[aria-label="삭제, 복제 등"]').click(); await page.waitForTimeout(250);
const rowItems = await page.evaluate(() => [...document.querySelectorAll('.popover-panel .menu-item, .popover-panel .menu-section')].map(e => e.textContent.trim()).join(' | '));
console.log('  행 메뉴:', rowItems);
await page.screenshot({ path: `${shots}/row-menu.png`, clip: { x: 0, y: 150, width: 560, height: 420 } });
const titleBefore = await row.locator('.sidebar-row-label').textContent();
await page.getByRole('menuitem', { name: /이름 바꾸기/ }).click(); await page.waitForTimeout(250);
const rp = await page.evaluate(() => { const p = document.querySelector('.rename-popover'); const b = p?.getBoundingClientRect(); return p ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(',') : 'none'; });
await page.screenshot({ path: `${shots}/row-rename.png`, clip: { x: 0, y: 150, width: 700, height: 200 } });
await page.keyboard.press('End'); await page.keyboard.type(' 2'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
const titleAfter = await row.locator('.sidebar-row-label').textContent();
ok('행 이름 바꾸기 → Esc로 닫아도 저장', titleAfter === `${titleBefore} 2`, `${rp} ${titleBefore} → ${titleAfter}`);
await page.keyboard.press('Meta+z').catch(() => {});

// 3. table row gutter on a full-page table and an inline table
for (const [label, id] of [['전체 페이지 표', dbId], ['인라인 표', 'handoff-root']]) {
  await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const tab = page.getByRole('tab', { name: /Default view|표/ }).first(); if (await tab.count()) { await tab.click(); await page.waitForTimeout(400); }
  const r = page.locator('.table-row').nth(1);
  // Bring the row into view vertically only (scrolling it into view would also scroll the table sideways).
  await page.evaluate(() => { const row = document.querySelectorAll('.table-row')[1]; const scroller = row?.closest('.frame-scroller'); if (row && scroller) scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 200; });
  await page.waitForTimeout(200);
  if (!(await r.count())) { ok(`${label}: 행 없음`, false); continue; }
  const box = await r.boundingBox();
  await page.mouse.move(box.x + 200, box.y + 15); await page.waitForTimeout(250);
  const g = await page.evaluate(() => { const row = [...document.querySelectorAll('.table-row')][1]; const vis = sel => { const e = row.querySelector(sel); if (!e) return 'missing'; const b = e.getBoundingClientRect(); const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}${e.contains(top) ? '' : ' (가려짐)'}`; }; return { add: vis('.row-add'), drag: vis('.row-drag'), first: row.getBoundingClientRect().x }; });
  ok(`${label}: + / ⋮⋮ 보임`, !/가려짐|missing/.test(g.add + g.drag), JSON.stringify(g));
  await page.screenshot({ path: `${shots}/gutter-${id === dbId ? 'full' : 'inline'}.png`, clip: { x: Math.max(0, box.x - 120), y: box.y - 60, width: 700, height: 160 } });
  const rowsBefore = await page.locator('.table-row').count();
  await r.locator('.row-add').click(); await page.waitForTimeout(500);
  const rowsAfter = await page.locator('.table-row').count();
  const editing = await page.evaluate(() => { const p = document.querySelector('.popover-panel.value-editor'); return p ? 'editor' : document.activeElement?.className ?? ''; });
  ok(`${label}: + → 아래에 새 행, 제목 편집`, rowsAfter === rowsBefore + 1 && /editor/.test(editing), `${rowsBefore}→${rowsAfter} ${editing}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  ok(`${label}: 빈 새 행 Esc → 사라짐`, (await page.locator('.table-row').count()) === rowsBefore, `${await page.locator('.table-row').count()}`);
  await r.hover(); await r.locator('.row-drag').click(); await page.waitForTimeout(300);
  const m = await page.evaluate(() => { const p = [...document.querySelectorAll('.popover-panel')].at(-1); const b = p?.getBoundingClientRect(); const h = [...document.querySelectorAll('.table-row')][1].querySelector('.row-drag').getBoundingClientRect(); return p ? `${p.getAttribute('aria-label')} ${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)} handle ${Math.round(h.x)},${Math.round(h.y)}` : 'none'; });
  const selected = await r.getAttribute('class');
  ok(`${label}: ⋮⋮ 클릭 → 행 선택 + 행 메뉴`, /행 메뉴/.test(m) && /selected/.test(selected ?? ''), m);
  await page.screenshot({ path: `${shots}/rowmenu-${id === dbId ? 'full' : 'inline'}.png` });
  await r.locator('.row-drag').click(); await page.waitForTimeout(250);
  ok(`${label}: ⋮⋮ 다시 클릭 → 메뉴 닫힘`, !(await page.evaluate(() => [...document.querySelectorAll('.popover-panel')].some(p => p.getAttribute('aria-label') === '행 메뉴'))));
  await page.keyboard.press('Escape');
}
console.log(errors.length ? `errors: ${errors.join(' / ')}` : 'no page errors');
await browser.close();
