// 6차 점검: 멘션 메뉴 순서, + · [[ · : 메뉴, 도움말·키보드 단축키 창, 이동 경로·오디오·수식·버튼·동기화 블록,
// 고급 필터. 시험 페이지(합성 자료)를 새로 만들어 그 안에서만 고친다.
// 사용법: node scripts/ux-trace/local-suite4.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const shots = process.env.SHOTS ?? (await import('node:os')).tmpdir() + '/ux-suite4';
import { mkdirSync } from 'node:fs';
mkdirSync(shots, { recursive: true });
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);

// A page of plain lines to work in.
const state = await (await fetch(`${base}/api/state`)).json();
const pid = `suite4-${Date.now()}`;
const ops = [{ type: 'page.create', id: pid, title: '6차 점검', parentId: null }];
for (let i = 1; i <= 12; i++) ops.push({ type: 'block.create', id: `${pid}-b${i}`, parentId: pid, richText: [{ text: `줄 ${i}` }] });
const made = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${pid}`, actor: 'test', expectedRevision: state.revision, operations: ops }) });
if (!made.ok) throw new Error(await made.text());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 827 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${pid}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
const end = async text => { const b = page.locator('.page-editor .block', { hasText: new RegExp(`^${text}$`) }).first(); await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(100); const box = await b.boundingBox(); await page.mouse.click(box.x + box.width - 5, box.y + box.height / 2); await page.keyboard.press('End'); };
const line = text => page.evaluate(t => [...document.querySelectorAll('.page-editor .block')].find(b => b.textContent.startsWith(t))?.textContent, text);
const rect = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }, sel);

// 1. @ menu: dates, then page links with their location, then new page
await end('줄 1'); await page.keyboard.type(' @'); await page.waitForTimeout(300);
const heads = await page.evaluate(() => [...document.querySelectorAll('.mention-menu .slash-heading')].map(h => h.textContent).join(' / '));
const box = await rect('.mention-menu');
ok('@ 메뉴: 날짜 → 페이지에 링크하기 → 새 페이지, 330 폭', heads === '날짜 / 페이지에 링크하기 / 새 페이지' && box?.[2] === 330, `${heads} ${box}`);
await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
// 2. + and [[ open the link menu (no dates); a space after an unmatched word closes it
await page.keyboard.type(' +'); await page.waitForTimeout(250);
const plus = await page.evaluate(() => document.querySelector('.mention-menu')?.getAttribute('aria-label') ?? document.querySelector('.mention-menu')?.closest('[aria-label]')?.getAttribute('aria-label'));
await page.keyboard.type('zzq '); await page.waitForTimeout(250);
const closed = await page.evaluate(() => !document.querySelector('.mention-menu'));
ok('+ → 페이지 링크 메뉴, 맞는 것 없이 공백 → 닫힘', !!plus && closed, `${plus}`);
for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
await page.keyboard.type(' [['); await page.waitForTimeout(250);
ok('[[ → 페이지 링크 메뉴', await page.evaluate(() => !!document.querySelector('.mention-menu') && !/날짜/.test(document.querySelector('.mention-menu').textContent)));
await page.keyboard.press('Escape'); for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
ok('줄 1 원래대로', (await line('줄 1')) === '줄 1', await line('줄 1'));
// 3. : emoji
await end('줄 2'); await page.keyboard.type(' :sm'); await page.waitForTimeout(300);
const emojiBox = await rect('.emoji-inline');
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
ok(': 이모지 (408×356) → Enter로 넣기', emojiBox?.[2] === 408 && emojiBox?.[3] === 356 && /\p{Extended_Pictographic}/u.test(await line('줄 2')), `${emojiBox} ${await line('줄 2')}`);
await page.keyboard.type(' 10:30 :)'); await page.waitForTimeout(200);
ok('"10:30 :)"는 그대로', !(await page.evaluate(() => !!document.querySelector('.emoji-inline'))) && (await line('줄 2')).endsWith('10:30 :)'));
// 4. help menu and shortcuts window
await page.click('.sidebar-foot button[aria-label="도움말"]'); await page.waitForTimeout(250);
const help = await page.evaluate(() => [...document.querySelectorAll('.popover-panel')].at(-1)?.innerText.replace(/\n+/g, ' | '));
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+Alt+Slash'); await page.waitForTimeout(400);
const win = await rect('.shortcuts-modal');
ok('도움말 메뉴 · ⌘⌥/ 단축키 창 960×700', /키보드 단축키/.test(help ?? '') && win?.[2] === 960 && win?.[3] === 700, `${help} ${win}`);
await page.screenshot({ path: `${shots}/shortcuts.png` });
await page.keyboard.press('Escape'); await page.waitForTimeout(250);
// 5. blocks from the / menu
const slash = async (after, query) => { await end(after); await page.keyboard.press('Enter'); await page.keyboard.type(`/${query}`); await page.waitForTimeout(250); await page.keyboard.press('Enter'); await page.waitForTimeout(1000); };
await slash('줄 4', 'bread');
ok('/bread → 이동 경로', ((await page.evaluate(() => document.querySelector('.breadcrumb-block')?.textContent)) ?? '').includes('6차 점검'));
await slash('줄 5', 'audio');
const picker = await rect('.embed-popover');
ok('/audio → 49 높이 바 + 300 폭 선택 상자가 바로', (await rect('.media-empty'))?.[3] === 49 && picker?.[2] === 300, `${picker}`);
await page.keyboard.press('Escape');
await slash('줄 6', 'math');
const mathPop = await rect('.math-popover'); const mathBar = await rect('.math-empty');
await page.keyboard.type('a^2'); await page.waitForTimeout(400);
const live = await page.evaluate(() => !!document.querySelector('.math-block .katex'));
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
ok('/math → 편집기 400×79 바로 아래, 입력하는 대로 그림', mathPop?.[2] === 400 && mathPop?.[1] === mathBar?.[1] + mathBar?.[3] && live, `${mathBar} ${mathPop}`);
await slash('줄 8', 'button');
const panel = await rect('.button-panel');
await page.keyboard.type('할 일'); await page.click('.button-panel-done'); await page.waitForTimeout(600);
ok('/button → 600 폭 설정 패널, 완료로 이름 저장', panel?.[2] === 600 && (await page.evaluate(() => [...document.querySelectorAll('.button-block-run')].at(-1)?.textContent)) === '할 일', `${panel}`);
await slash('줄 10', '동기화 블록'); await page.keyboard.type('동기화 내용'); await page.waitForTimeout(500);
const synced = await page.evaluate(() => { const c = [...document.querySelectorAll('.in-synced')].at(-1); return c ? [c.className.includes('synced-on'), getComputedStyle(c, '::after').borderLeftColor] : null; });
ok('동기화 블록: 캐럿이 있으면 테두리 #f3ddcb', synced?.[0] && synced[1] === 'rgb(243, 221, 203)', JSON.stringify(synced));
await page.screenshot({ path: `${shots}/blocks.png`, fullPage: true });
// 6. advanced filter on the synthetic table
await page.goto(`${base}/?id=handoff-table`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
await page.getByRole('button', { name: '필터' }).first().click(); await page.waitForTimeout(250);
await page.locator('.popover-panel').last().getByText('고급 필터 추가').click(); await page.waitForTimeout(700);
const adv = await rect('.advanced-filter-popover');
const chip = await page.evaluate(() => document.querySelector('.filter-chip.active')?.textContent);
await page.click('.filter-delete-all'); await page.waitForTimeout(500);
ok('고급 필터: "규칙 1개" 칩 + 494 폭 상자, 필터 삭제', adv?.[2] === 494 && chip === '규칙 1개' && !(await page.evaluate(() => !!document.querySelector('.filter-chip.active'))), `${adv} ${chip}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
