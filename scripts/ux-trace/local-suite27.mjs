// 21차: Korean input (IME). Chrome's own IME path (CDP Input.imeSetComposition / insertText) composes syllables jamo
// by jamo — ㅎ 하 한 → 한, ㄱ 그 글 → 글 — in the page body, the title, a "# " heading, the / menu, an @ mention, a table
// cell and search; an Enter pressed while a syllable is still composing must not split the block or commit a rename
// early. Starts its own server on an empty folder. 사용법: node scripts/ux-trace/local-suite27.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite27-'));
const port = 5000 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const text = runs => (runs ?? []).map(run => run.text).join('');

await post([
  { type: 'page.create', id: 'doc', title: '', parentId: null },
  { type: 'block.create', id: 'doc-b1', parentId: 'doc', blockType: 'paragraph', richText: [] },
  { type: 'page.create', id: 'target', title: '한강 산책', parentId: null },
  { type: 'page.create', id: 'db', title: '목록', parentId: null },
  { type: 'source.create', id: 'db-src', pageId: 'db', name: '목록', titlePropertyId: 'db-t' },
  { type: 'view.create', id: 'db-v', sourceId: 'db-src', parentId: 'db', name: '표', viewType: 'table', config: {} },
  { type: 'page.create', id: 'row1', title: '첫 행', sourceId: 'db-src' },
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const cdp = await page.context().newCDPSession(page);
// Hangul syllable → the jamo states a 2-beolsik IME shows while composing it.
const stages = syllable => {
  const code = syllable.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return [syllable];
  const lead = Math.floor(code / 588), vowel = Math.floor((code % 588) / 28), tail = code % 28;
  const leads = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const open = String.fromCharCode(0xac00 + lead * 588 + vowel * 28);
  return tail ? [leads[lead], open, syllable] : [leads[lead], syllable];
};
const compose = async word => {
  for (const ch of word) {
    if (ch === ' ') { await page.keyboard.press('Space'); continue; }
    for (const stage of stages(ch)) { await cdp.send('Input.imeSetComposition', { text: stage, selectionStart: stage.length, selectionEnd: stage.length }); await page.waitForTimeout(15); }
    await cdp.send('Input.insertText', { text: ch }); await page.waitForTimeout(15);
  }
};
// Enter while a syllable is still being composed (keyCode 229, isComposing) — what Chrome sends first on macOS.
const composingEnter = () => page.evaluate(() => { const target = document.activeElement; target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: true, bubbles: true, cancelable: true })); });
const blockText = id => page.evaluate(id => document.querySelector(`[data-block-id="${id}"]`)?.textContent ?? null, id);

await page.goto(`${base}/?id=doc`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);

// 1. Title.
await page.locator('.page-title').click(); await compose('한글 제목'); await page.waitForTimeout(200);
const titleShown = await page.locator('.page-title').textContent();
await page.locator('[data-block-id="doc-b1"]').click(); await page.waitForTimeout(900);
const titleSaved = (await state()).objects.find(o => o.id === 'doc').title;
ok('제목: "한글 제목"을 조합해 쓰면 그대로 보이고 저장됨', titleShown === '한글 제목' && titleSaved === '한글 제목', `shown=${titleShown} saved=${titleSaved}`);

// 2. Body: syllables, a space, more syllables; an Enter while composing does not split the block.
await compose('안녕 하세');
await cdp.send('Input.imeSetComposition', { text: '요', selectionStart: 1, selectionEnd: 1 });
await composingEnter(); await page.waitForTimeout(150);
await cdp.send('Input.insertText', { text: '요' }); await page.waitForTimeout(300);
const blocksAfter = await page.evaluate(() => document.querySelectorAll('.page-editor > [data-block-id]').length);
const body = await blockText('doc-b1');
await page.waitForTimeout(900);
const bodySaved = text((await state()).objects.find(o => o.id === 'doc-b1').richText);
ok('본문: "안녕 하세요" 조합 · 조합 중 Enter로 블록이 나뉘지 않음 · 저장됨', body === '안녕 하세요' && blocksAfter === 1 && bodySaved === '안녕 하세요', `body=${body} blocks=${blocksAfter} saved=${bodySaved}`);

// 3. Enter after composing → a new block; "# " then Korean → a heading.
await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
await page.keyboard.type('# '); await compose('소제목'); await page.waitForTimeout(800);
const heading = await page.evaluate(() => { const last = [...document.querySelectorAll('.page-editor > [data-block-id]')].at(-1); return last ? `${last.dataset.blockType}:${last.textContent}` : null; });
ok('Enter 후 새 블록에서 "# " + "소제목" 조합 → 제목 블록', heading === 'heading1:소제목', heading ?? 'none');

// 4. "/" then Korean filters the menu; Enter picks it and leaves no "/제목" behind.
await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
await page.keyboard.type('/'); await page.waitForTimeout(250); await compose('할 일'); await page.waitForTimeout(300);
const slash = await page.evaluate(() => [...document.querySelectorAll('.slash-menu .menu-item-label, .slash-menu .slash-item-label, .menu-panel .menu-item-label')].map(e => e.textContent).slice(0, 4).join('|'));
await page.keyboard.press('Enter'); await page.waitForTimeout(400);
const todo = await page.evaluate(() => { const last = [...document.querySelectorAll('.page-editor > [data-block-id]')].at(-1); return last ? `${last.className.includes('todo') || last.querySelector('input[type=checkbox], .todo-check') ? 'todo' : 'other'}:${last.textContent}` : null; });
ok('"/" + "할 일" 조합 → 메뉴가 할 일로 걸러지고 Enter로 할 일 블록(“/할 일” 글자 안 남음)', /할 일/.test(slash) && todo === 'todo:', `menu=${slash} last=${todo}`);

// 5. "@" then Korean → the mention menu finds 한강 산책.
await compose('메모 '); await page.keyboard.type('@'); await page.waitForTimeout(250); await compose('한강'); await page.waitForTimeout(500);
const mention = await page.evaluate(() => document.querySelector('.mention-menu')?.textContent ?? '');
await page.keyboard.press('Escape');
ok('"@" + "한강" 조합 → 멘션 메뉴에 "한강 산책"', mention.includes('한강 산책'), mention);

// 6. Table cell: a row's name typed in Korean is saved whole.
await page.goto(`${base}/?id=db-v`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.locator('.table-row', { hasText: '첫 행' }).locator('.cell-title, [data-type="title"], .table-cell').first().dblclick().catch(() => {});
await page.waitForTimeout(250);
await page.keyboard.press('Control+A'); await compose('둘째 행'); await page.waitForTimeout(150);
await composingEnter(); await page.waitForTimeout(150);
const stillEditing = await page.evaluate(() => !!document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement?.isContentEditable === true);
await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const rowTitle = (await state()).objects.find(o => o.id === 'row1').title;
ok('표 셀: "둘째 행" 조합 · 조합 중 Enter로 편집이 끝나지 않음 · 저장됨', rowTitle === '둘째 행' && stillEditing, `title=${rowTitle} editing=${stillEditing}`);

// 7. Search (⌘K): Korean query finds the page.
await page.keyboard.press('Control+K'); await page.waitForTimeout(300);
await compose('산책'); await page.waitForTimeout(700);
const query = await page.evaluate(() => document.querySelector('.search-input')?.value);
const results = await page.evaluate(() => [...document.querySelectorAll('.search-result, .search-results [role="option"], .search-item')].map(e => e.textContent).join('|'));
ok('검색: "산책" 조합 → 입력값 그대로, "한강 산책"이 결과에', query === '산책' && results.includes('한강 산책'), `query=${query} results=${results.slice(0, 120)}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
