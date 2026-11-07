// 15차 점검: 화면 언어 — 브라우저 언어로 시작(없으면 English), 설정에서 바꾸면 다시 열림, 아홉 언어 모두 메뉴 · 설정 ·
// 보기 설정 같은 화면 틀에 한국어가 남지 않음, 날짜는 그 언어 형식, 엔진 오류도 번역. 1512×828.
// 사용법: node scripts/ux-trace/local-suite11.mjs <fixture 주소>   (PASS/FAIL 출력)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const dir = fileURLToPath(new URL('../../ui/src/i18n/locales', import.meta.url));
const locales = Object.fromEntries(readdirSync(dir).filter(name => name.endsWith('.json')).map(name => { const data = JSON.parse(readFileSync(join(dir, name), 'utf8')); return [data.$meta.code, data]; }));
const say = (code, key) => code === 'ko' ? key.replace(/^[a-z][a-z0-9-]*\|/, '') : locales[code]?.[key] ?? locales.en?.[key] ?? key;

// Content in plain ASCII so that any Hangul on screen comes from the interface.
const root = `suite11-${Date.now()}`, db = `${root}-db`, sid = `${db}-src`, p = name => `${db}-p-${name}`;
await post([
  { type: 'page.create', id: root, title: 'Language check', parentId: null },
  { type: 'block.create', id: `${root}-b1`, parentId: root, blockType: 'paragraph', richText: [{ text: 'Hello' }] },
  { type: 'page.create', id: db, title: 'Tasks', parentId: root },
  { type: 'source.create', id: sid, pageId: db, name: 'Tasks', titlePropertyId: p('title'), titleName: 'Name' },
  { type: 'property.create', id: p('date'), sourceId: sid, name: 'Due', propertyType: 'date' },
  { type: 'property.create', id: p('status'), sourceId: sid, name: 'State', propertyType: 'status', options: [{ id: `${db}-s1`, name: 'Open', group: 'todo' }, { id: `${db}-s2`, name: 'Doing', group: 'in_progress' }, { id: `${db}-s3`, name: 'Closed', group: 'complete' }] },
  { type: 'page.create', id: `${db}-r0`, title: 'First', parentId: sid, sourceId: sid },
  { type: 'value.set', pageId: `${db}-r0`, propertyId: p('date'), value: { start: '2026-10-23' } },
  { type: 'value.set', pageId: `${db}-r0`, propertyId: p('status'), value: `${db}-s2` },
  { type: 'view.create', id: `${db}-v0`, sourceId: sid, parentId: db, name: 'All', viewType: 'table', config: {} },
  { type: 'view.create', id: `${db}-v1`, sourceId: sid, parentId: db, name: 'Board', viewType: 'board', config: { groupBy: p('status') } },
]);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const hangul = text => (text.match(/[가-힣]/g) ?? []).length;
// Interface text on screen, without the workspace's own page names in the sidebar tree.
const chrome = page => page.evaluate(() => {
  const skip = el => el.closest('.sidebar-tree, .sidebar-row, .crumb, .page-title, .ProseMirror, .db-tab-name, .page-editor');
  const out = [];
  const walk = node => { for (const child of node.childNodes) { if (child.nodeType === 3) { if (child.textContent.trim() && !skip(child.parentElement)) out.push(child.textContent.trim()); } else if (child.nodeType === 1 && getComputedStyle(child).display !== 'none') walk(child); } };
  walk(document.body);
  for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) for (const name of ['aria-label', 'title', 'placeholder']) { const value = el.getAttribute(name); if (value && !skip(el)) out.push(value); }
  return out.join(' | ');
});

// 1. A fresh English browser starts in English; dates are English.
let context = await browser.newContext({ viewport: { width: 1512, height: 828 }, locale: 'en-US' });
let page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`${base}/?id=${db}-v0`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
const lang = await page.evaluate(() => document.documentElement.lang);
const search = await page.locator('.sidebar-search-text').innerText();
const dateCell = await page.locator(`[data-row-id="${db}-r0"] .table-cell`).allInnerTexts();
ok('새 English 브라우저: lang=en, 사이드바 "Search", 날짜 "October 23, 2026"', lang === 'en' && search === say('en', '검색') && dateCell.some(text => text.includes('October 23, 2026')), `${lang} / ${search} / ${dateCell.join(',').slice(0, 80)}`);

// 2. Settings › Language lists nine languages; picking 日本語 reloads in Japanese.
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(300);
await page.locator('.menu-panel .menu-item', { hasText: say('en', '설정') }).first().click(); await page.waitForTimeout(500);
await page.locator(`.prefs-choice[aria-label="${say('en', '언어')}"]`).click(); await page.waitForTimeout(300);
const names = await page.locator('.menu-panel .menu-item').allInnerTexts();
await Promise.all([page.waitForEvent('load'), page.locator('.menu-panel .menu-item', { hasText: '日本語' }).click()]);
await page.waitForTimeout(1000);
const jaLang = await page.evaluate(() => document.documentElement.lang);
const jaSearch = await page.locator('.sidebar-search-text').innerText();
ok('설정 › 언어: 아홉 언어(English · 한국어 · 日本語 · 简体中文 · 繁體中文 · Español · Français · Deutsch · Português (Brasil)), 日本語를 고르면 다시 열려 일본어', names.join('|') === 'English|한국어|日本語|简体中文|繁體中文|Español|Français|Deutsch|Português (Brasil)' && jaLang === 'ja' && jaSearch === say('ja', '검색'), `${names.join('|')} / ${jaLang} / ${jaSearch}`);
await context.close();

// 3. Every language: no Korean left in the interface around a page, its menus and a database's settings.
const report = [];
for (const code of ['en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR']) {
  context = await browser.newContext({ viewport: { width: 1512, height: 828 }, locale: 'en-US' });
  await context.addInitScript(language => localStorage.setItem('pageyard-language', language), code);
  page = await context.newPage(); page.on('pageerror', e => errors.push(`${code}: ${e.message}`));
  let count = 0; const samples = [];
  const check = async label => { const text = await chrome(page); const n = hangul(text); if (n) { count += n; samples.push(`${label}: ${text.split(' | ').filter(part => hangul(part)).slice(0, 3).join(' / ')}`); } };
  await page.goto(`${base}/?id=${root}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  await check('page');
  await page.locator('.topbar-right button').last().click(); await page.waitForTimeout(300); await check('page menu'); await page.keyboard.press('Escape');
  await page.locator('.page-editor [data-block-id]').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/'); await page.waitForTimeout(400); await check('slash'); await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.goto(`${base}/?id=${db}-v0`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); await check('table');
  await page.locator('.db-tool-settings').click(); await page.waitForTimeout(400); await check('view settings'); await page.keyboard.press('Escape');
  await page.goto(`${base}/?id=${db}-v1`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); await check('board');
  await page.goto(`${base}/?id=${db}-r0`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); await check('row page');
  report.push(`${code}:${count}${samples.length ? ` (${samples.slice(0, 2).join(' ; ')})` : ''}`);
  await context.close();
}
ok('여덟 언어 모두 화면 틀에 한국어 없음(페이지 · ⋯ 메뉴 · / 메뉴 · 표 · 보기 설정 · 보드 · 행 페이지)', report.every(line => /:0$/.test(line)), report.join(' | ').slice(0, 900));

// 4. Engine errors come back translated (a stale revision → the English conflict text).
context = await browser.newContext({ viewport: { width: 1512, height: 828 }, locale: 'en-US' });
page = await context.newPage();
await page.goto(`${base}/?id=${root}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
const conflict = await page.evaluate(async () => { const response = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `stale-${Date.now()}`, actor: 'user', expectedRevision: 0, operations: [{ type: 'page.update', id: 'nope', title: 'x' }] }) }); return (await response.json()).error?.message ?? ''; });
const listed = Object.keys(locales.en).some(key => key === conflict || (/\{\d+\}/.test(key) && new RegExp(`^${key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`, 's').test(conflict)));
ok('엔진 오류 메시지(revision 충돌)가 번역 표에 있음', listed, conflict);
await context.close();

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
