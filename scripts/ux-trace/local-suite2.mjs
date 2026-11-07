// Second round of behaviour traces (2026-10-24): dragging, right-click menus, pickers, center peek,
// table keys and the new-page window.
// Usage: node scripts/ux-trace/local-suite2.mjs --base http://127.0.0.1:PORT --db <database page id> [scenarios]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { base: { type: 'string' }, db: { type: 'string' } } });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = args.base, dbId = args.db;
const recorder = readFileSync(new URL('./recorder.js', import.meta.url), 'utf8');
const st = async () => (await (await fetch(`${base}/api/state`)).json());
const send = async ops => { const s = await st(); const r = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `u-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!r.ok) throw new Error(await r.text()); };
const P = `ux2${Date.now() % 100000}`;
const types = ['paragraph', 'bullet', 'bullet', 'bullet', 'numbered', 'numbered', 'todo', 'paragraph'];
await send([{ type: 'page.create', id: P, title: 'UI 점검 2026-10-23' },
  ...types.map((t, i) => ({ type: 'block.create', id: `${P}-b${i}`, parentId: i === 3 ? `${P}-b2` : P, blockType: t, richText: [{ text: `M${String(i).padStart(2, '0')} ${t}` }] })),
  { type: 'page.create', id: `${P}-k1`, title: 'Doc B — 복구 검증', parentId: P }, { type: 'page.create', id: `${P}-k2`, title: 'Doc A — 편집 검증', parentId: P }, { type: 'page.create', id: `${P}-k3`, title: '측정 하위', parentId: P }]);
const only = positionals[0];
const run = name => !only || only.split(',').includes(name);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
// Show every root page under "개인 페이지" (the default is 5) so the measuring page is in the tree.
await page.addInitScript(() => { if (!localStorage.getItem('pageyard-sidebar-layout-v1')) localStorage.setItem('pageyard-sidebar-layout-v1', JSON.stringify({ library: true, sections: [{ id: 'recent', count: 5, collapsed: true }, { id: 'favorites', count: 5 }, { id: 'private', count: 50 }] })); });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const arm = async (probe, ms = 800, start = ['pointerdown', 'keydown']) => { await page.evaluate(recorder); await page.evaluate(`__rec2(${probe}, ${ms}, ${JSON.stringify(start)})`); };
const show = (label, out, max = 14) => { console.log(`\n== ${label}`); const lines = out.trace.map(([t, s]) => `${String(t).padStart(5)} ${s.replace(/\\"/g, '').slice(0, 170)}`); console.log((lines.length > max ? [...lines.slice(0, max - 4), '   …', ...lines.slice(-3)] : lines).join('\n')); const a = Object.entries(out.anims).filter(([k]) => !/selection-halo|peek-in|sidebar/.test(k) || label.includes('peek')); if (a.length) console.log('  anims', a.map(([k, v]) => `${k} ${v.duration}ms ${v.easing}${v.delay ? ` +${v.delay}` : ''} @${v.first}`).join(' | ')); };
const read = async (label, wait = 900, max) => { await page.waitForTimeout(wait); show(label, await page.evaluate(() => window.__out), max); };
// Marks shown while dragging, and the ghost.
const dragProbe = `() => { const r = e => { const b = e.getBoundingClientRect(); return Math.round(b.x) + ',' + Math.round(b.y) + ',' + Math.round(b.width) + (b.height !== 4 ? 'x' + Math.round(b.height) : ''); }; const marks = [...document.querySelectorAll('.drop-indicator, .card-drop-line, .sidebar-drop-line')].map(e => 'L' + r(e) + '@' + (+getComputedStyle(e).opacity).toFixed(2)); const halos = [...document.querySelectorAll('.drop-halo, .sidebar-drop-target')].map(e => 'H' + r(e) + '@' + (+getComputedStyle(e).opacity).toFixed(2)); const g = document.querySelector('.drag-ghost-layer'); return [...marks, ...halos, g ? 'G' + r(g.firstElementChild?.firstElementChild ?? g) + '@' + getComputedStyle(g).opacity : 'noG'].join(' '); }`;
const popProbe = `() => { const ps = [...document.querySelectorAll('.popover-panel')]; const p = ps.at(-1); if (!p) return 'none'; const b = p.getBoundingClientRect(); const c = getComputedStyle(p); return [p.getAttribute('role'), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), (+c.opacity).toFixed(2), c.transform === 'none' ? '-' : c.transform.slice(0, 30)].join(':'); }`;
const order = async () => page.evaluate(() => [...document.querySelectorAll('.page-editor > .block[data-block-id]')].map(e => e.dataset.blockId.split('-').pop()).join(','));

await page.goto(`${base}/?id=${P}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400); // sidebar closed
const block = i => page.locator(`[data-block-id="${P}-b${i}"]`);

if (run('blockdrag')) {
  const src = await block(4).boundingBox(); const tgt = await block(5).boundingBox();
  await page.mouse.move(src.x + 100, src.y + 15); await page.waitForTimeout(300);
  const handle = await page.locator('.block-handles .block-drag-handle').boundingBox();
  const hx = handle.x + handle.width / 2, hy = handle.y + handle.height / 2;
  await page.mouse.move(hx, hy); await page.waitForTimeout(100);
  await page.mouse.down();
  for (let d = 1; d <= 8; d++) { await page.mouse.move(hx, hy + d); await page.waitForTimeout(30); const g = await page.evaluate(() => !!document.querySelector('.drag-ghost-layer')); if (g) { console.log(`\n== 블록 끌기 시작 거리: ${d}px`); break; } }
  const yy = tgt.y + 24;
  const res = [];
  for (const dx of [6, 26, 30, 34, 40, 80]) { await page.mouse.move(tgt.x + dx, yy, { steps: 3 }); await page.waitForTimeout(260); res.push(`${dx}: ${await page.evaluate(`(${dragProbe})()`)}`); }
  console.log(`  대상 블록 x=${Math.round(tgt.x)} y=${Math.round(tgt.y)} h=${Math.round(tgt.height)}\n  ` + res.join('\n  '));
  console.log('  원래 블록 투명도:', await page.evaluate(id => getComputedStyle(document.querySelector(`[data-block-id="${id}"]`)).opacity, `${P}-b4`), '선택:', await page.evaluate(() => document.querySelectorAll('.block-selected, .has-block-selection .selected').length));
  await page.mouse.move(tgt.x + 6, yy, { steps: 2 }); await page.waitForTimeout(300);
  await page.evaluate(recorder);
  await page.evaluate(`__rec2(() => (${dragProbe})() + ' | ' + [...document.querySelectorAll('.page-editor > .block[data-block-id]')].map(e => e.dataset.blockId.split('-').pop()).join(',') + ' sel=' + [...document.querySelectorAll('.page-editor > .block.block-selected, .page-editor > .block.selected')].map(e => e.dataset.blockId.split('-').pop()).join(','), 700, ['pointerup'])`);
  await page.mouse.up(); await read('블록 놓기', 900);
  console.log('  순서:', await order());
  await page.keyboard.press('Escape'); await page.mouse.click(1300, 760);
}
if (run('ctx')) {
  // right-click on the drag handle → block menu; on text → browser menu (not taken)
  const b = await block(1).boundingBox(); await page.mouse.move(b.x + 100, b.y + 15); await page.waitForTimeout(300);
  const h = await page.locator('.block-handles .block-drag-handle').boundingBox();
  await arm(popProbe, 500, ['pointerdown', 'contextmenu']); await page.mouse.click(h.x + 9, h.y + 12, { button: 'right' }); await read('핸들 오른쪽 클릭 → 블록 메뉴', 600);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.mouse.click(1300, 760);
  const prevented = await page.evaluate(id => { const t = document.querySelector(`[data-block-id="${id}"] .block-text`); const r = t.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10, button: 2 }); t.dispatchEvent(ev); return ev.defaultPrevented; }, `${P}-b1`);
  console.log('  본문 글자 오른쪽 클릭이 앱 메뉴를 여는가:', prevented);
}
if (run('emoji')) {
  await page.mouse.move(700, 120); await page.waitForTimeout(300);
  const add = page.locator('.page-control', { hasText: '아이콘 추가' });
  await add.hover(); await page.waitForTimeout(250);
  await arm(popProbe, 600); await add.click(); await read('아이콘 추가 → 무작위 아이콘 + 선택기', 800);
  const icon = await page.locator('.page-icon').boundingBox().catch(() => null);
  console.log('  아이콘:', icon && [Math.round(icon.x), Math.round(icon.y), Math.round(icon.width), Math.round(icon.height)].join(','));
  await page.keyboard.press('Escape');
  await page.locator('.page-icon').click(); await page.waitForTimeout(300); await page.getByRole('button', { name: '제거' }).click(); await page.waitForTimeout(300);
}
if (run('sidebardrag') || run('newpage')) {
  await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400);
  // expand the measuring page in the tree
  const row = page.locator(`[data-section="private"] .sidebar-row[data-tree-id="${P}"]`).first();
  if (await row.getAttribute('aria-expanded') !== 'true') { await row.hover(); await row.locator('.sidebar-toggle').click(); await page.waitForTimeout(300); }
}
if (run('sidebardrag')) {
  await page.evaluate(id => document.querySelector(`.sidebar-row[data-tree-id="${id}"]`)?.scrollIntoView({ block: 'center' }), `${P}-k2`); await page.waitForTimeout(200);
  const r3 = await page.locator(`.sidebar-row[data-tree-id="${P}-k3"]`).boundingBox();
  const r2 = await page.locator(`.sidebar-row[data-tree-id="${P}-k2"]`).boundingBox();
  const r1 = await page.locator(`.sidebar-row[data-tree-id="${P}-k1"]`).boundingBox();
  const x = r3.x + 120, y0 = r3.y + 15;
  await page.mouse.move(x, y0); await page.waitForTimeout(200); await page.mouse.down();
  const res = [];
  for (const [label, y] of [['DocA 위쪽', r2.y + 5], ['DocA 아래쪽', r2.y + 24], ['첫 행 가운데', r1.y + 15], ['자기 자리', y0]]) { await page.mouse.move(x, y, { steps: 6 }); await page.waitForTimeout(300); res.push(`${label}: ${await page.evaluate(`(${dragProbe})()`)}`); }
  console.log(`\n== 사이드바 행 끌기 (행 x=${Math.round(r2.x)} w=${Math.round(r2.width)}, DocA y=${Math.round(r2.y)} h=${Math.round(r2.height)})\n  ` + res.join('\n  '));
  await page.mouse.up(); await page.waitForTimeout(400);
  console.log('  놓은 뒤 주소:', await page.evaluate(() => location.search), '순서:', await page.evaluate(p => [...document.querySelectorAll('.sidebar-row[data-tree-id]')].map(e => e.dataset.treeId).filter(id => id.startsWith(p + '-k')).map(id => id.slice(-2)).join(','), P));
  // right-click a sidebar row near the bottom → menu above the pointer
  const rr = await page.locator(`.sidebar-row[data-tree-id="${P}-k2"]`).boundingBox();
  await arm(popProbe, 500, ['pointerdown', 'contextmenu']); await page.mouse.click(rr.x + 100, rr.y + 15, { button: 'right' }); await read(`사이드바 행 오른쪽 클릭 (포인터 ${Math.round(rr.x + 100)},${Math.round(rr.y + 15)})`, 600);
  await page.keyboard.press('Escape');
}
if (run('newpage')) {
  const row = page.locator(`.sidebar-row[data-tree-id="${P}-k3"]`);
  await row.hover(); await page.waitForTimeout(200);
  const probe = `() => { const kids = [...document.querySelectorAll('.sidebar-row[data-tree-id]')].filter(e => e.dataset.treeDepth && e.closest('[role=tree]')).length; const p = document.querySelector('.peek-center'); const b = p?.getBoundingClientRect(); const ae = document.activeElement; return [location.search.replace(/id=[^&]*&?/, ''), kids, p ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), getComputedStyle(p).opacity].join(',') : '-', ae?.className?.toString?.().slice(0, 20), document.querySelector('.peek-add-to')?.textContent ?? ''].join(' | '); }`;
  await arm(probe, 900); await row.locator('[aria-label="하위 페이지 추가"]').click(); await read('사이드바 + → 새 페이지 창', 1000);
  const fresh = await page.evaluate(() => new URLSearchParams(location.search).get('peek'));
  await arm(probe, 500); await page.keyboard.press('Escape'); await read('빈 새 페이지에서 Esc', 600);
  await page.waitForTimeout(1500);
  const s = await st(); const obj = s.objects.find(o => o.id === fresh);
  console.log('  닫은 뒤 그 페이지:', obj ? (obj.alive ? '남아 있음' : '휴지통') : '없음(만들기 전으로 되돌림)', '· 사이드바 행:', await page.locator(`.sidebar-row[data-tree-id="${fresh}"]`).count());
  // typed title survives
  await row.hover(); await row.locator('[aria-label="하위 페이지 추가"]').click(); await page.waitForTimeout(500);
  await page.keyboard.type('제목 있음'); await page.keyboard.press('Escape'); await page.waitForTimeout(1800);
  const kept = (await st()).objects.find(o => o.kind === 'page' && o.title === '제목 있음' && o.parentId === `${P}-k3` && o.alive);
  console.log('  제목을 치고 바로 Esc → 페이지 유지:', !!kept);
  await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400);
}
if (dbId && (run('carddrag') || run('cardctx') || run('datepicker') || run('centerpeek') || run('tablekeys') || run('rowctx'))) {
  await page.goto(`${base}/?id=${dbId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  if (await page.locator('.sidebar:not(.closed)').count()) { await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400); }
  if (run('tablekeys')) {
    await page.getByRole('tab', { name: 'Default view' }).click(); await page.waitForTimeout(500);
    const cell = page.locator('.table-row', { hasText: '측정 작업 베타' }).locator('.table-cell.type-number'); const c = await cell.boundingBox();
    const probe = `() => { const f = document.querySelector('.table-cell.focused'); const b = f?.getBoundingClientRect(); const a = f && getComputedStyle(f, '::after'); const p = [...document.querySelectorAll('.popover-panel')].at(-1); const pb = p?.getBoundingClientRect(); return [f ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), a.backgroundColor].join(',') : '-', p ? 'editor ' + [Math.round(pb.x), Math.round(pb.y), Math.round(pb.width), Math.round(pb.height), (+getComputedStyle(p).opacity).toFixed(2)].join(',') : '', document.activeElement.tagName].join(' | '); }`;
    await arm(probe, 400); await page.mouse.click(c.x + 40, c.y + 15); await read('금액 칸 클릭 → 편집', 500, 6);
    console.log('  칸:', [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height)].join(','));
    await arm(probe, 1600); await page.keyboard.press('Escape'); await page.waitForTimeout(250); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); await page.keyboard.press('Tab'); await page.waitForTimeout(250); await page.keyboard.press('Escape'); await read('Esc → ↓ → → → Tab → Esc', 600, 10);
  }
  if (run('rowctx')) {
    const row = page.locator('.table-row', { hasText: '측정 작업 델타' }); const r = await row.boundingBox();
    await arm(popProbe, 500, ['pointerdown', 'contextmenu']); await page.mouse.click(r.x + 400, r.y + 15, { button: 'right' }); await read(`표 행 오른쪽 클릭 (포인터 ${Math.round(r.x + 400)},${Math.round(r.y + 15)})`, 600);
    console.log('  행 선택:', await row.getAttribute('class'));
    await page.keyboard.press('Escape'); await page.mouse.click(1300, 760);
  }
  await page.getByRole('tab', { name: '보드' }).click(); await page.waitForTimeout(600);
  const cards = async () => page.evaluate(() => [...document.querySelectorAll('.row-card')].map(e => { const b = e.getBoundingClientRect(); return e.textContent.trim().slice(-2) + Math.round(b.x) + ',' + Math.round(b.y); }).join(' '));
  if (run('cardctx')) {
    const c = await page.locator('.row-card', { hasText: '측정 작업 델타' }).boundingBox();
    await arm(popProbe, 500, ['pointerdown', 'contextmenu']); await page.mouse.click(c.x + 60, c.y + 20, { button: 'right' }); await read(`카드 오른쪽 클릭 (포인터 ${Math.round(c.x + 60)},${Math.round(c.y + 20)})`, 600);
    console.log('  카드 선택 표시:', await page.locator('.row-card.selected').count());
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  if (run('carddrag')) {
    console.log('\n  카드 위치:', await cards());
    const c = await page.locator('.row-card', { hasText: '측정 작업 델타' }).boundingBox();
    // Drop under a card in another column (works whatever column the card is in now).
    const others = await page.evaluate(x => [...document.querySelectorAll('.row-card')].map(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, text: e.textContent }; }).filter(b => Math.abs(b.x - x) > 50), c.x);
    const t = others[0];
    const from = [c.x + 100, c.y + 20], to = [t.x + 100, t.y + t.height + 33];
    await page.mouse.move(...from); await page.waitForTimeout(200); await page.mouse.down();
    await page.mouse.move(from[0], from[1] + 3); await page.waitForTimeout(80); const early = await page.evaluate(`(${dragProbe})()`);
    await page.mouse.move(...to, { steps: 12 }); await page.waitForTimeout(300);
    console.log('== 카드 끌기 (3px:', early, ')\n  들고 있는 중:', await page.evaluate(`(${dragProbe})()`), '\n  원래 카드:', await page.evaluate(() => { const e = document.querySelector('.row-card.drag-source'); return e ? getComputedStyle(e).opacity + ' ' + getComputedStyle(e).backgroundColor : '-'; }), '\n  아래에 놓을 카드:', [Math.round(t.x), Math.round(t.y), Math.round(t.width), Math.round(t.height)].join(','));
    await page.evaluate(recorder); await page.evaluate(`__rec2(() => (${dragProbe})() + ' sel=' + document.querySelectorAll('.row-card.selected').length, 700, ['pointerup'])`);
    await page.mouse.up(); await read('카드 놓기', 900, 10);
    console.log('  카드 위치:', await cards());
    await page.mouse.click(1300, 760); await page.waitForTimeout(200); console.log('  다른 곳 클릭 후 선택:', await page.locator('.row-card.selected').count());
  }
  if (run('datepicker')) {
    await page.locator('.row-card', { hasText: '측정 작업 베타' }).click(); await page.waitForTimeout(700);
    console.log('\n== 피크 열린 카드 선택 표시:', await page.locator('.row-card.selected').count());
    const anchor = page.locator('.peek .property-row', { hasText: '날짜' }).locator('.property-value').first();
    const a = await anchor.boundingBox();
    await arm(popProbe, 500); await anchor.click(); await read(`날짜 선택기 (값 칸 ${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.width)}x${Math.round(a.height)})`, 600);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  if (run('centerpeek')) {
    const vid = `${dbId}-v1`; const view = (await st()).objects.find(o => o.id === vid);
    await send([{ type: 'view.update', id: vid, config: { openMode: 'center' } }]); await page.waitForTimeout(800);
    const probe = `() => { const bd = document.querySelector('.peek-backdrop'); const p = document.querySelector('.peek-center'); if (!p) return 'none'; const b = p.getBoundingClientRect(); const c = getComputedStyle(p); return [getComputedStyle(bd).backgroundColor, (+getComputedStyle(bd).opacity).toFixed(2), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), (+c.opacity).toFixed(2), c.borderRadius, c.transform === 'none' ? '-' : c.transform].join(':'); }`;
    await arm(probe, 500); await page.locator('.row-card', { hasText: '측정 작업 베타' }).click(); await read('가운데 피크 열기', 600);
    await arm(probe, 400); await page.keyboard.press('Escape'); await read('가운데 피크 Esc', 500);
    await send([{ type: 'view.update', id: vid, config: { openMode: view?.config?.openMode ?? 'side' } }]);
  }
}
console.log('\n' + (errors.join('\n') || 'no errors'));
await browser.close();
