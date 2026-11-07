// 21차: dragging near an edge scrolls. Several selected blocks drag as one see-through copy of all of them and the
// page scrolls at the bottom edge; board cards and calendar events scroll the page; timeline bars scroll the
// timeline sideways and keep moving by the days scrolled. Starts its own server on an empty folder.
// 사용법: node scripts/ux-trace/local-suite25.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite25-'));
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// A long page, and a database whose first status column is longer than the window.
await post([{ type: 'page.create', id: 'long', title: '긴 페이지', parentId: null },
  ...Array.from({ length: 60 }, (_, i) => ({ type: 'block.create', id: `long-b${i}`, parentId: 'long', blockType: 'paragraph', richText: [{ text: `줄 ${i}` }] }))]);
await post([
  { type: 'page.create', id: 'db', title: '끌기 DB', parentId: null },
  { type: 'source.create', id: 'db-src', pageId: 'db', name: '끌기 DB', titlePropertyId: 'db-t' },
  { type: 'property.create', id: 'db-s', sourceId: 'db-src', name: '상태', propertyType: 'status', options: [{ id: 's1', name: '시작 전', group: 'todo' }, { id: 's2', name: '진행 중', group: 'in_progress' }, { id: 's3', name: '완료', group: 'complete' }] },
  { type: 'property.create', id: 'db-d', sourceId: 'db-src', name: '일정', propertyType: 'date' },
  { type: 'view.create', id: 'db-board', sourceId: 'db-src', parentId: 'db', name: '보드', viewType: 'board', config: { groupBy: 'db-s' } },
  { type: 'view.create', id: 'db-time', sourceId: 'db-src', parentId: 'db', name: '타임라인', viewType: 'timeline', config: { datePropertyId: 'db-d' } },
  { type: 'view.create', id: 'db-cal', sourceId: 'db-src', parentId: 'db', name: '캘린더', viewType: 'calendar', config: { datePropertyId: 'db-d' } },
  ...Array.from({ length: 24 }, (_, i) => [{ type: 'page.create', id: `r${i}`, title: `카드 ${i}`, sourceId: 'db-src' }, { type: 'value.set', pageId: `r${i}`, propertyId: 'db-s', value: 's1' }, { type: 'value.set', pageId: `r${i}`, propertyId: 'db-d', value: { start: day(i % 5), end: day(i % 5 + 1) } }]).flat(),
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const scrollTop = () => page.evaluate(() => document.querySelector('.frame-scroller')?.scrollTop ?? -1);
const hold = async (x, y, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await page.mouse.move(x, y + (Date.now() % 2)); await page.waitForTimeout(60); } };

// 1. Three selected blocks: one copy of all three follows the pointer; the page scrolls at the bottom edge.
{
  await page.goto(`${base}/?id=long`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.locator('[data-block-id="long-b2"]').click(); await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await page.waitForTimeout(200);
  const selected = await page.evaluate(() => document.querySelectorAll('.block-selected').length);
  const box = await page.locator('[data-block-id="long-b2"]').boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height / 2); await page.waitForTimeout(300);
  const handle = await page.locator('.block-handles .block-drag-handle').boundingBox();
  const hx = handle.x + handle.width / 2, hy = handle.y + handle.height / 2;
  await page.mouse.move(hx, hy); await page.mouse.down();
  // Held over the blocks' own column, just right of their left edge (left of it would make columns, further right
  // would nest under the block above).
  const dropX = box.x + 8;
  await page.mouse.move(dropX, hy + 40, { steps: 4 });
  const copies = await page.evaluate(() => [...document.querySelectorAll('.drag-ghost-layer .drag-ghost-context > *')].map(e => e.textContent).join('|'));
  const before = await scrollTop();
  await hold(dropX, 818, 900);
  const after = await scrollTop();
  await page.mouse.up(); await page.waitForTimeout(800);
  const order = (await state()).objects.filter(o => o.kind === 'block' && o.parentId === 'long');
  const ids = await page.evaluate(() => [...document.querySelectorAll('.page-editor > [data-block-id]')].map(e => e.dataset.blockId));
  const at = ids.indexOf('long-b2');
  ok('블록 3개 선택 → 끌면 3개 복사본 하나로("줄 2|줄 3|줄 4"), 아래 가장자리에서 페이지가 내려감, 놓으면 셋이 함께 아래로',
    selected === 3 && copies === '줄 2|줄 3|줄 4' && after > before + 150 && at > 5 && ids[at + 1] === 'long-b3' && ids[at + 2] === 'long-b4',
    `selected=${selected} copies=${copies} scroll ${before}→${after} at=${at} next=${ids[at + 1]},${ids[at + 2]} blocks=${order.length}`);
}

// 2. Board card held at the bottom edge scrolls the page.
{
  await page.goto(`${base}/?id=db-board`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
  const card = await page.locator('.row-card').first().boundingBox();
  const scrollable = await page.evaluate(() => { const s = document.querySelector('.frame-scroller'); return s.scrollHeight - s.clientHeight; });
  await page.mouse.move(card.x + 40, card.y + 15); await page.mouse.down(); await page.mouse.move(card.x + 50, card.y + 60, { steps: 4 });
  const before = await scrollTop();
  await hold(card.x + 50, 818, 900);
  const after = await scrollTop();
  const line = await page.evaluate(() => !!document.querySelector('.card-drop-line'));
  await page.mouse.up(); await page.waitForTimeout(500);
  ok('보드 카드를 아래 가장자리에 두면 페이지가 내려가고 놓일 선이 따라감', scrollable > 100 && after > before + 100 && line, `scrollable=${scrollable} ${before}→${after} line=${line}`);
}

// 3. Timeline bar held at the right edge scrolls the timeline and keeps moving by the days scrolled.
{
  await page.goto(`${base}/?id=db-time`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
  const bar = page.locator('.timeline-bar').first();
  const title = await bar.getAttribute('title');
  const row = (await state()).objects.find(o => o.kind === 'page' && o.title === title);
  const startBefore = row.values?.['db-d']?.start ?? (await state()).objects.find(o => o.id === row.id).values['db-d'].start;
  const box = await bar.boundingBox();
  const scroller = await page.locator('.timeline-scroll').boundingBox();
  const left0 = await page.evaluate(() => document.querySelector('.timeline-scroll').scrollLeft);
  await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
  await hold(scroller.x + scroller.width - 8, box.y + box.height / 2, 900);
  const left1 = await page.evaluate(() => document.querySelector('.timeline-scroll').scrollLeft);
  await page.mouse.up(); await page.waitForTimeout(800);
  const startAfter = (await state()).objects.find(o => o.id === row.id).values['db-d'].start;
  const moved = Math.round((new Date(startAfter) - new Date(startBefore)) / 86400000);
  const pointerDays = Math.round((scroller.x + scroller.width - 8 - (box.x + 20)) / 40);
  ok('타임라인 막대를 오른쪽 가장자리에 두면 타임라인이 옆으로 흐르고, 흐른 날짜만큼 더 옮겨짐', left1 > left0 + 100 && moved > 0 && startAfter > startBefore, `scroll ${left0}→${left1} moved=${moved}d (${startBefore}→${startAfter}) pointer≈${pointerDays}`);
}

// 4. Calendar event held at the bottom edge scrolls the page when the month is taller than the window.
{
  await page.setViewportSize({ width: 1512, height: 560 });
  await page.goto(`${base}/?id=db-cal`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
  const event = await page.locator('.calendar-event').first().boundingBox();
  const scrollable = await page.evaluate(() => { const s = document.querySelector('.frame-scroller'); return s.scrollHeight - s.clientHeight; });
  await page.mouse.move(event.x + 20, event.y + 8); await page.mouse.down(); await page.mouse.move(event.x + 30, event.y + 40, { steps: 4 });
  const before = await scrollTop();
  await hold(event.x + 30, 552, 900);
  const after = await scrollTop();
  await page.mouse.up(); await page.waitForTimeout(500);
  ok('캘린더 일정을 아래 가장자리에 두면 페이지가 내려감(달력이 창보다 길 때)', scrollable > 50 && after > before + 50, `scrollable=${scrollable} ${before}→${after}`);
}

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
