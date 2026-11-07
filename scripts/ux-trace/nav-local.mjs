// Usage: node scripts/ux-trace/nav-local.mjs --base http://127.0.0.1:PORT [scenarios]
// Needs Playwright (PLAYWRIGHT_MODULE=path/to/playwright/index.mjs if it is not resolvable).
import { parseArgs } from 'node:util';
const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { base: { type: 'string' }, db: { type: 'string' } } });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { readFileSync } from 'node:fs';
const base = args.base;
const recorder = readFileSync(new URL('./recorder.js', import.meta.url), 'utf8');
const st = async () => (await (await fetch(`${base}/api/state`)).json());
const send = async ops => { const s = await st(); const r = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `n-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (r.status !== 200) console.log('send', r.status, await r.text()); };
const P = `nav${Date.now() % 100000}`;
const ids = { root: `${P}-root`, a: `${P}-a`, b: `${P}-b`, ui: `${P}-ui`, db: `${P}-db` };
await send([
  { type: 'page.create', id: ids.root, title: '분석 실험 모음 2026-10-19' },
  { type: 'page.create', id: ids.b, parentId: ids.root, title: 'Doc B — 복구 검증' },
  { type: 'page.create', id: ids.a, parentId: ids.root, title: 'Doc A — 편집 검증' },
  { type: 'page.create', id: ids.ui, parentId: ids.root, title: 'UI 점검 2026-10-23' },
  ...Array.from({ length: 60 }, (_, i) => ({ type: 'block.create', parentId: ids.ui, richText: [{ text: `M${i} 측정 문단 ${'내용 '.repeat(8)}` }] })),
  { type: 'page.create', id: ids.db, parentId: ids.root, title: '측정 DB' },
]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
// Show every root page under "개인 페이지" (the default is 5) so the measuring pages are in the tree.
await page.addInitScript(() => { if (!localStorage.getItem('pageyard-sidebar-layout-v1')) localStorage.setItem('pageyard-sidebar-layout-v1', JSON.stringify({ library: true, sections: [{ id: 'recent', count: 5 }, { id: 'favorites', count: 5 }, { id: 'private', count: 50 }] })); });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const names = ['UI 점검 2026-10-23', '측정 DB', 'Doc A — 편집 검증', 'Doc B — 복구 검증', '분석 실험 모음 2026-10-19'];
const probe = `() => {
  const names = ${JSON.stringify(names)};
  const sb = document.querySelector('.sidebar-scroller');
  const rows = sb ? [...sb.querySelectorAll('.sidebar-row')].filter(e => e.getBoundingClientRect().height > 0).map(e => { const t = e.querySelector('.sidebar-row-label')?.textContent ?? ''; return [names.includes(t) ? t.slice(-3) : null, Math.round(e.getBoundingClientRect().y), getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)']; }).filter(x => x[0]) : [];
  const title = document.querySelector('.page-title')?.textContent ?? '';
  const sc = document.querySelector('.view-scroller');
  return { items: rows.map(x => x[0] + ':' + x[1] + (x[2] ? '*' : '')).join(' '), title: names.find(n => title.startsWith(n))?.slice(-3) ?? (title ? '#' : ''), path: location.search.slice(-4), st: sc ? Math.round(sc.scrollTop) : -1, sbst: sb ? Math.round(sb.scrollTop) : -1 };
}`;
const arm = async (ms = 1500, start = ['pointerdown', 'keydown']) => { await page.evaluate(recorder); await page.evaluate(`__rec2(${probe}, ${ms}, ${JSON.stringify(start)})`); };
const read = async label => { await page.waitForTimeout(1800); const out = await page.evaluate(() => window.__out); console.log(`\n== ${label}`); for (const [t, s] of out.trace) console.log(String(t).padStart(5), s.replace(/\\"/g, '')); const a = Object.entries(out.anims); if (a.length) console.log('  anims', JSON.stringify(Object.fromEntries(a))); if (out.shifts.length) console.log('  shifts', JSON.stringify(out.shifts)); };
// Build the recent list by visiting pages, expanding the tree.
await page.goto(`${base}/?id=${ids.ui}`, { waitUntil: 'networkidle' });
await page.evaluate(list => { localStorage.setItem('pageyard-recent', JSON.stringify(list)); localStorage.removeItem('pageyard-recent-closed'); }, [ids.ui, ids.db, ids.a, ids.b]);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
const row = name => page.locator('.sidebar-row', { has: page.locator('.sidebar-row-label', { hasText: name }) });
// R1 recent: click 4th recent item
const recentRows = page.locator('.sidebar-section').filter({ hasText: '최근' }).locator('.sidebar-row');
console.log('recent', await recentRows.allInnerTexts());
await arm(); { const b = await recentRows.nth(3).boundingBox(); await page.mouse.move(b.x + 60, b.y + 15); await page.mouse.down(); await page.mouse.up(); } await read('R1 최근 목록 4번째 클릭');
// R2 expand tree root (chevron)
const rootRow = page.locator('[role=tree][aria-label="개인 페이지"] .sidebar-row', { has: page.locator('.sidebar-row-label', { hasText: '분석 실험 모음' }) }).first();
await rootRow.hover(); await page.waitForTimeout(200);
await arm(1000); await rootRow.locator('.sidebar-toggle').click(); await read('R2 트리 펼치기');
// R3 scroll the long page, open Doc A from the tree, then go back
await page.goto(`${base}/?id=${ids.ui}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.view-scroller').scrollTop = 600);
await page.waitForTimeout(200);
await page.locator('[role=tree][aria-label="개인 페이지"] .sidebar-row', { has: page.locator('.sidebar-row-label', { hasText: 'Doc A' }) }).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
await arm(); { const b = await page.locator('[role=tree][aria-label="개인 페이지"] .sidebar-row', { has: page.locator('.sidebar-row-label', { hasText: 'Doc A' }) }).first().boundingBox(); await page.mouse.move(b.x + 80, b.y + 15); await page.mouse.down(); await page.mouse.up(); } await read('R3 트리에서 Doc A 클릭 (본문 600 스크롤 상태)');
await arm(1500, ['keydown', 'manual']); await page.evaluate(() => { window.__startRec(); history.back(); }); await read('R4 뒤로 가기 (스크롤 복원?)');
console.log(errors.join('\n') || 'no errors');
await browser.close();
