// 17차 점검(블록 캡션): 코드 블록 ⋯ "캡션 ⌘⌥M"(전환 다음) → 상자 아래 캡션 줄(14/19.6 · #7d7a75 · 패딩 6 0 6 2,
// 빈 칸 "캡션을 작성하세요…"), 입력하면 저장(코드와 따로 caption), 비운 채 나오면 사라짐. ⌘⌥M으로도. 이미지 · 북마크 같은 미디어
// 블록은 richText에 캡션 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite17.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite17-${Date.now()}`;
await post([{ type: 'page.create', id, title: '캡션 문서', parentId: null },
  { type: 'block.create', id: `${id}-code`, parentId: id, blockType: 'code', language: 'javascript', richText: [{ text: "const m19 = 'code block';" }] },
  { type: 'block.create', id: `${id}-bm`, parentId: id, blockType: 'bookmark', url: 'https://example.com' },
  { type: 'block.create', id: `${id}-p`, parentId: id, blockType: 'paragraph', richText: [{ text: '끝' }] },
]);
const entity = async bid => (await state()).objects.find(o => o.id === bid);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);

// 1. 코드 ⋯ 메뉴: 전환 · 캡션 ⌘⌥M · 코드 복사 … → 캡션 줄(빈 칸 안내, 크기)
await page.locator('.block-code').hover(); await page.waitForTimeout(200);
await page.locator('.block-code .code-tool[aria-label="블록 메뉴 열기"]').dispatchEvent('mousedown'); await page.waitForTimeout(400);
const items = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item')].map(e => e.textContent).slice(0, 3).join('|'));
await page.locator('.menu .menu-item', { hasText: '캡션' }).click(); await page.waitForTimeout(400);
const cap = await page.evaluate(() => { const c = document.querySelector('.block-code .block-caption'); const pre = document.querySelector('.block-code pre').getBoundingClientRect(); const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); const before = getComputedStyle(c, '::before'); return { focused: document.activeElement === c, ph: before.content, h: Math.round(r.height * 10) / 10, x: Math.round(r.left - pre.left), w: Math.round(r.width - pre.width), dy: Math.round(r.top - pre.bottom), font: `${cs.fontSize}/${cs.lineHeight}`, color: cs.color, pad: cs.padding }; });
ok('코드 ⋯: 전환 · 캡션 ⌘⌥M · 코드 복사, 캡션 줄(빈 칸 "캡션을 작성하세요…", 14/19.6 #7d7a75, 6 0 6 2, 31.6 높이, 상자 바로 아래 같은 폭)', items === '전환|캡션⌘⌥M|코드 복사' && cap.focused && cap.ph === '"캡션을 작성하세요…"' && cap.h === 31.6 && cap.x === 0 && cap.w === 0 && cap.dy === 0 && cap.font === '14px/19.6px' && cap.color === 'rgb(125, 122, 117)' && cap.pad === '6px 0px 6px 2px', `${items} ${JSON.stringify(cap)}`);

// 2. 입력 → 코드와 따로 caption으로 저장, 새로 고쳐도
await page.keyboard.type('예제 코드'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
let code = await entity(`${id}-code`);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
const shown = await page.evaluate(() => { const c = document.querySelector('.block-code .block-caption'); return c && !c.hidden ? c.textContent : '-'; });
ok('캡션 입력 → caption 저장(코드 그대로), 새로 고쳐도 보임', JSON.stringify(code.caption) === '[{"text":"예제 코드"}]' && code.richText[0].text === "const m19 = 'code block';" && shown === '예제 코드', `${JSON.stringify(code.caption)} ${shown}`);

// 3. 캡션을 비우고 나오면 사라지고 caption 삭제
await page.locator('.block-code .block-caption').click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
code = await entity(`${id}-code`);
const gone = await page.evaluate(() => document.querySelector('.block-code .block-caption').hidden);
ok('캡션을 비우고 나오면 줄이 사라지고 caption 없음', gone && code.caption === undefined, `${gone} ${JSON.stringify(code.caption)}`);

// 4. ⌘⌥M(코드 안 커서) → 캡션 줄에 커서, 아무것도 안 쓰고 나오면 그대로 사라짐
await page.locator('.block-code code').click(); await page.keyboard.press('ControlOrMeta+Alt+KeyM'); await page.waitForTimeout(300);
const viaKey = await page.evaluate(() => document.activeElement?.classList.contains('block-caption'));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const goneAgain = await page.evaluate(() => document.querySelector('.block-code .block-caption').hidden);
ok('⌘⌥M → 캡션 줄, 빈 채로 나오면 사라짐', viaKey && goneAgain, `${viaKey} ${goneAgain}`);

// 5. 북마크 블록 메뉴 "캡션" → 캡션 줄 → 입력하면 richText로
await page.locator('.block-bookmark').hover(); await page.waitForTimeout(300);
await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(400);
await page.locator('.menu .menu-item', { hasText: '캡션' }).click(); await page.waitForTimeout(400);
const bmFocus = await page.evaluate(() => document.activeElement?.classList.contains('atom-caption'));
await page.keyboard.type('예시 사이트'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
const bm = await entity(`${id}-bm`);
ok('북마크 블록 메뉴 "캡션" → 캡션 줄에 입력 → richText 저장', bmFocus && JSON.stringify(bm.richText) === '[{"text":"예시 사이트"}]' && (await page.locator('.block-bookmark .atom-caption').textContent()) === '예시 사이트', `${bmFocus} ${JSON.stringify(bm.richText)}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
