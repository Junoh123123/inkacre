// 18차 점검("고른 글에 반응"): 글을 고르면 글 메뉴의 "댓글"(108×28) 옆에 반응 단추, 누르면 이모지만 있는 고르기,
// 고르면 그 글에 댓글 표시(노란 밑줄)가 생기고 오른쪽 여백에 "😀 1" 알약(r100, 2 8, 이모지 16 · 수 12/500 파랑,
// rgba(0,124,215,.094))만 — 카드 테두리 없이. 알약을 누르면 반응이 빠지고 표시도 사라짐. 글이 있는 댓글에도 반응 추가 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite20.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite20-${Date.now()}`;
await post([{ type: 'page.create', id, title: '반응 문서', parentId: null },
  { type: 'block.create', id: `${id}-p`, parentId: id, blockType: 'paragraph', richText: [{ text: 'M26 reaction here' }] },
  { type: 'block.create', id: `${id}-q`, parentId: id, blockType: 'paragraph', richText: [{ text: '두 번째 문단' }] }]);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const comments = async () => (await state()).objects.filter(o => o.kind === 'comment' && o.parentId === `${id}-p` && o.alive !== false);

// 1. "reaction"을 두 번 눌러 고르면 글 메뉴: 댓글(108) 옆 반응 단추
const word = await page.evaluate(() => { const el = [...document.querySelectorAll('.page-editor .block')].find(b => b.textContent === 'M26 reaction here'); const text = el.querySelector('[data-text-host], .block-content, p, div') ?? el; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const node = walker.nextNode(); const range = document.createRange(); range.setStart(node, 4); range.setEnd(node, 12); const r = range.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.dblclick(word.x, word.y); await page.waitForTimeout(700);
const row = await page.evaluate(() => { const c = document.querySelector('.tam-comment'), r = document.querySelector('.tam-react'); if (!c || !r) return null; const cr = c.getBoundingClientRect(), rr = r.getBoundingClientRect(); return { comment: Math.round(cr.width), react: `${Math.round(rr.width)}×${Math.round(rr.height)}`, label: r.getAttribute('aria-label'), sel: getSelection().toString() }; });
ok('글을 고르면 글 메뉴에 "댓글"(108 폭)과 "고른 글에 반응 달기"(32×28)', row?.comment === 108 && row.react === '32×28' && row.label === '고른 글에 반응 달기' && row.sel === 'reaction', JSON.stringify(row));

// 2. 반응 단추 → 이모지만 있는 고르기(탭 없음) → 첫 이모지 → 그 글에 댓글 표시, 반응만 있는 댓글
await page.locator('.tam-react').dispatchEvent('mousedown'); await page.waitForTimeout(500);
const picker = await page.evaluate(() => { const p = document.querySelector('.emoji-picker.emoji-only'); return p ? { tabs: !!p.querySelector('.emoji-tabs'), w: Math.round(p.getBoundingClientRect().width) } : null; });
await page.locator('.emoji-picker .emoji-grid button, .emoji-picker button.emoji-cell, .emoji-picker [data-emoji]').first().click(); await page.waitForTimeout(1500);
let list = await comments();
const marked = await page.evaluate(() => [...document.querySelectorAll('.comment-highlight')].map(e => e.textContent).join('|'));
ok('반응 고르기는 이모지만(탭 없음, 408) → 고르면 반응만 있는 댓글 + 그 글 "reaction"에 댓글 표시', picker?.tabs === false && picker.w === 408 && list.length === 1 && list[0].reactions?.length === 1 && !list[0].richText.length && marked === 'reaction', `${JSON.stringify(picker)} ${JSON.stringify(list.map(c => c.reactions))} ${marked}`);

// 3. 여백: 카드 없이 알약만(r100, 2 8, 이모지 16, 수 12/500 파랑), 블록 위 +4.5
const pill = await page.evaluate(() => { const chip = document.querySelector('.discussion-card.reactions-only .reaction-chip'); if (!chip) return null; const card = chip.closest('.discussion-card'); const cs = getComputedStyle(chip), cc = getComputedStyle(card); const block = [...document.querySelectorAll('.page-editor .block')].find(b => b.textContent === 'M26 reaction here').getBoundingClientRect(); const r = chip.getBoundingClientRect(); return { text: chip.textContent.slice(-1), radius: cs.borderRadius, pad: cs.padding, bg: cs.backgroundColor, color: cs.color, count: getComputedStyle(chip.querySelector('.reaction-count')).fontSize, emoji: getComputedStyle(chip.querySelector('.reaction-emoji')).fontSize, card: cc.boxShadow, dy: Math.round((r.top - block.top) * 10) / 10, h: Math.round(r.height) }; });
ok('여백에 카드 없이 "😀 1" 알약(r100 · 2 8 · rgba(0,124,215,.094) · 수 12px 파랑 · 이모지 16), 블록 위에서 +4.5', pill?.text === '1' && pill.radius === '100px' && pill.pad === '2px 8px' && pill.bg === 'rgba(0, 124, 215, 0.094)' && pill.color === 'rgb(39, 131, 222)' && pill.count === '12px' && pill.emoji === '16px' && pill.card === 'none' && Math.abs(pill.dy - 4.5) <= 1 && pill.h === 25, JSON.stringify(pill));

// 4. 알약을 누르면 반응이 빠지고(댓글 삭제) 표시도 사라짐
await page.locator('.reaction-chip').first().click(); await page.waitForTimeout(1500);
list = await comments();
const gone = await page.evaluate(() => ({ chips: document.querySelectorAll('.reaction-chip').length, marks: document.querySelectorAll('.comment-highlight').length }));
ok('알약을 누르면 반응이 빠지고 반응만 있던 댓글 · 글 표시가 사라짐', !list.length && !gone.chips && !gone.marks, `${list.length} ${JSON.stringify(gone)}`);

// 5. 글이 있는 댓글: 도구의 "반응 추가" → 글 아래 알약
await post([{ type: 'comment.create', id: `${id}-c`, parentId: `${id}-q`, richText: [{ text: '좋은 문단' }] }]); await page.waitForTimeout(1500);
await page.locator('.discussion-card .discussion-comment').first().hover(); await page.waitForTimeout(300);
await page.locator('.discussion-comment .discussion-tool[aria-label="반응 추가"]').first().click(); await page.waitForTimeout(500);
await page.locator('.emoji-picker .emoji-grid button, .emoji-picker button.emoji-cell, .emoji-picker [data-emoji]').first().click(); await page.waitForTimeout(1500);
const withText = (await state()).objects.find(o => o.id === `${id}-c`);
const under = await page.evaluate(() => { const c = document.querySelector('.discussion-comment .reaction-row .reaction-chip'); return c ? c.closest('.discussion-comment-main')?.querySelector('.discussion-text')?.textContent : null; });
ok('글이 있는 댓글: "반응 추가" → reactions에 저장, 글 아래 알약', withText?.reactions?.length === 1 && under === '좋은 문단', `${JSON.stringify(withText?.reactions)} ${under}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
