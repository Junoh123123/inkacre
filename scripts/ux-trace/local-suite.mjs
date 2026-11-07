// Usage: node scripts/ux-trace/local-suite.mjs --base http://127.0.0.1:PORT --db <database page id> [scenarios]
// Needs Playwright (PLAYWRIGHT_MODULE=path/to/playwright/index.mjs if it is not resolvable).
import { parseArgs } from 'node:util';
const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { base: { type: 'string' }, db: { type: 'string' } } });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { readFileSync } from 'node:fs';
const base = args.base;
const dbId = args.db;
const recorder = readFileSync(new URL('./recorder.js', import.meta.url), 'utf8');
const st = async () => (await (await fetch(`${base}/api/state`)).json());
const send = async ops => { const s = await st(); await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `u-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); };
const P = `ux${Date.now() % 100000}`;
await send([{ type: 'page.create', id: P, title: 'UI 점검 2026-10-23' },
  ...Array.from({ length: 12 }, (_, i) => ({ type: 'block.create', id: `${P}-b${i}`, parentId: P, richText: [{ text: `M${String(i).padStart(2, '0')} 측정 문단 하나` }] })),
  { type: 'block.create', id: `${P}-tg`, parentId: P, blockType: 'toggle', richText: [{ text: 'M13 토글' }] },
  { type: 'block.create', id: `${P}-tgc`, parentId: `${P}-tg`, richText: [{ text: '토글 안 내용' }] }]);
const only = positionals[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const arm = async (probe, ms = 800, start = ['pointerdown', 'keydown']) => { await page.evaluate(recorder); await page.evaluate(`__rec2(${probe}, ${ms}, ${JSON.stringify(start)})`); };
const read = async (label, wait = 1000) => { await page.waitForTimeout(wait); const out = await page.evaluate(() => window.__out); console.log(`\n== ${label}`); const lines = out.trace.map(([t, s]) => `${String(t).padStart(5)} ${s.replace(/\\"/g, '').slice(0, 150)}`); const shown = lines.length > 14 ? [...lines.slice(0, 9), '   …', ...lines.slice(-3)] : lines; console.log(shown.join('\n')); const a = Object.entries(out.anims); if (a.length) console.log('  anims', a.map(([k, v]) => `${k} ${v.duration}ms ${v.easing}${v.delay ? ` +${v.delay}` : ''} @${v.first}`).join(' | ')); };
const panelProbe = sel => `() => { const e = document.querySelector('${sel}'); if (!e) return ''; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), (+cs.opacity).toFixed(2), cs.transform.slice(0, 40)].join(':'); }`;
const run = name => !only || only.split(',').includes(name);
await page.goto(`${base}/?id=${P}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
const block = i => page.locator(`[data-block-id="${P}-b${i}"] .block-text`);
if (run('sidebar')) {
  const probe = `() => { const sb = document.querySelector('.sidebar'); const f = document.querySelector('.main-frame'); const t = document.querySelector('.page-title'); return [Math.round(sb.getBoundingClientRect().width), Math.round(f.getBoundingClientRect().x), Math.round(f.getBoundingClientRect().width), t ? Math.round(t.getBoundingClientRect().x) : -1].join(','); }`;
  await arm(probe, 600); await page.keyboard.press('Control+Backslash'); await read('사이드바 닫기 (⌘\\)');
  await arm(probe, 600); await page.keyboard.press('Control+Backslash'); await read('사이드바 열기 (⌘\\)');
}
if (run('tooltip')) {
  const tip = `() => { const t = document.querySelector('.tooltip'); if (!t) return ''; const r = t.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), (+getComputedStyle(t).opacity).toFixed(2), t.innerText.replace(/\\n/g, ' / ')].join(':'); }`;
  const star = page.locator('.topbar [aria-label="즐겨찾기에 추가"]'); const sb = await star.boundingBox();
  await page.mouse.move(900, 500); await page.waitForTimeout(300);
  await arm(tip, 600, ['pointerover']); await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await read('툴팁 (즐겨찾기 단추)', 800);
  console.log('  button', JSON.stringify(sb));
  await arm(tip, 400, ['pointerover']); await page.mouse.move(900, 500); await read('툴팁 사라짐', 500);
}
if (run('float')) {
  await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400);
  const fp = `() => { const e = document.querySelector('.sidebar-inner'); const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), (+getComputedStyle(e).opacity).toFixed(2), document.querySelector('.sidebar').className.replace('sidebar ', '')].join(':'); }`;
  const ob = await page.locator('.topbar .sidebar-open').boundingBox();
  await page.mouse.move(900, 500); await page.waitForTimeout(300);
  await arm(fp, 600, ['pointerover']); await page.mouse.move(ob.x + 10, ob.y + 10); await read('닫힌 사이드바 단추 hover → 떠 있는 사이드바', 800);
  await page.mouse.move(100, 300, { steps: 6 }); await page.waitForTimeout(400); console.log('  패널 위로 이동 후:', await page.evaluate(fp));
  await arm(fp, 700, ['pointerover']); await page.mouse.move(900, 500); await read('패널 밖으로 → 들어감', 900);
  await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400);
}
if (run('handles')) {
  await page.mouse.move(1300, 700); await page.waitForTimeout(300);
  await arm(panelProbe('.block-handles'), 500, ['pointerover']);
  const b = await block(5).boundingBox(); await page.mouse.move(b.x + 100, b.y + 10); await read('블록 hover → 핸들');
}
if (run('slash')) {
  await block(6).click(); await page.keyboard.press('End'); await page.keyboard.type(' ');
  await arm(panelProbe('.popover-panel'), 500); await page.keyboard.type('/'); await read('슬래시 메뉴 열기');
  await arm(panelProbe('.popover-panel'), 400); await page.keyboard.press('Escape'); await read('슬래시 메뉴 Esc');
  console.log('  text after Esc:', JSON.stringify(await block(6).innerText()), 'focus in editor:', await page.evaluate(() => !!document.activeElement?.closest('.page-editor')));
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  // no menu after a non-space character
  await page.keyboard.type('a/'); await page.waitForTimeout(200); console.log('  "a/" opens menu:', await page.locator('.popover-panel').count() > 0); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
}
if (run('typing')) {
  await block(9).click(); await page.keyboard.press('End'); await page.waitForTimeout(800);
  const top = `() => (+getComputedStyle(document.querySelector('.topbar')).opacity).toFixed(2) + ':' + (document.querySelector('.block-handles') ? getComputedStyle(document.querySelector('.block-handles')).visibility : '-')`;
  await arm(top, 400); await page.keyboard.type('x'); await read('타이핑 → 상단 바', 600);
  await arm(top, 900, ['pointermove', 'mousemove']); await page.mouse.move(900, 400); await page.mouse.move(905, 402); await read('마우스 이동 → 상단 바 복귀', 1000);
  await block(9).click(); await page.keyboard.press('End'); await page.keyboard.press('Backspace');
}
if (run('blockmenu')) {
  await page.mouse.click(1300, 700); await page.waitForTimeout(200);
  const b = await block(7).boundingBox(); await page.mouse.move(b.x + 100, b.y + 10); await page.waitForTimeout(400);
  const h = await page.locator('.block-handles .block-drag-handle').boundingBox();
  await arm(panelProbe('.popover-panel'), 500); await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2); await read('블록 핸들 클릭 → 블록 메뉴');
  await page.keyboard.press('Escape'); await page.mouse.click(1300, 700);
}
if (run('textmenu')) {
  const b = await block(8).boundingBox();
  await arm(panelProbe('.text-action-menu'), 900);
  await page.mouse.move(b.x + 10, b.y + 12); await page.mouse.down(); await page.mouse.move(b.x + 90, b.y + 12, { steps: 5 }); await page.mouse.up(); await read('텍스트 드래그 선택 → 서식 메뉴', 1200);
  await page.mouse.click(1300, 700);
}
if (run('toggle')) {
  const probe = `() => { const tg = document.querySelector('[data-block-id="${P}-tg"]'); const kid = document.querySelector('[data-block-id="${P}-tgc"]'); const svg = tg.querySelector('.toggle-button svg, .toggle-button'); return [kid && kid.getBoundingClientRect().height > 0 ? 'open' : 'closed', kid ? getComputedStyle(kid).opacity : '-', getComputedStyle(svg).transform.slice(0, 30)].join(':'); }`;
  const t = await page.locator(`[data-block-id="${P}-tg"] .toggle-button`).boundingBox();
  await arm(probe, 500); await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2); await read('토글 열기');
  await arm(probe, 500); await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2); await read('토글 닫기');
}
if (run('tabs') || run('peek')) {
  await page.goto(`${base}/?id=${dbId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  const probe = `() => { const tab = document.querySelector('.db-tab.active')?.textContent?.trim() ?? ''; const v = document.querySelector('.db-body > *'); return [tab, v ? v.className.toString().split(' ')[0] : '', v ? Math.round(v.getBoundingClientRect().height) : 0].join(':'); }`;
  if (run('tabs')) {
    await arm(probe, 500); await page.getByRole('tab', { name: '보드' }).click(); await read('보기 탭 전환 (표→보드)');
    await arm(probe, 500); await page.getByRole('tab', { name: 'Default view' }).click(); await read('보기 탭 전환 (보드→표)');
  }
  if (run('peek')) {
    await page.getByRole('tab', { name: '보드' }).click(); await page.waitForTimeout(500);
    const peekProbe = `() => { const p = document.querySelector('.peek'); const f = document.querySelector('.main-frame'); if (!p) return 'none:' + Math.round(f.getBoundingClientRect().width); const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return [Math.round(r.x), Math.round(r.width), (+cs.opacity).toFixed(2), cs.transform.slice(0, 40), Math.round(f.getBoundingClientRect().width), p.querySelector('.page-title') ? 'T' : '-'].join(':'); }`;
    const card = page.locator('.row-card', { hasText: '측정 작업 베타' }).first(); const c = await card.boundingBox();
    await arm(peekProbe, 600); await page.mouse.click(c.x + 40, c.y + 15); await read('카드 클릭 → 사이드 피크 열기');
    await arm(peekProbe, 600); await page.keyboard.press('Escape'); await read('Esc → 피크 닫기');
  }
}
console.log('\n' + (errors.join('\n') || 'no errors'));
await browser.close();
