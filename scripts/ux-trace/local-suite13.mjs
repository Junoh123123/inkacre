// 17차 점검: 인라인 수식 — 저장된 수식 그리기, "$$…$$", 고른 글 ⌘⇧E, "/인라인 수식"의 빈 수식과
// 한 줄 편집기(400×41, 수식 아래 6), 눌러 다시 편집, 비우면 지움. Mermaid 코드 — "/코드: Mermaid", 다이어그램(회색 상자),
// 미리 보기 형식(코드만 · 미리 보기만 · 둘 다), 코드 ⋯ 메뉴, 펼쳐 보기, 페이지 정책 위반 없음 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite13.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const runsOf = async id => (await state()).objects.find(o => o.id === id)?.richText ?? [];

const root = `suite13-${Date.now()}`, doc = `${root}-doc`;
await post([
  { type: 'page.create', id: root, title: '새 기능 점검', parentId: null },
  { type: 'page.create', id: doc, title: '수식 문서', parentId: root },
  { type: 'block.create', id: `${doc}-b1`, parentId: doc, blockType: 'paragraph', richText: [{ text: '앞 ' }, { text: 'a^2+b^2=c^2', equation: true }, { text: ' 뒤' }] },
  { type: 'block.create', id: `${doc}-b2`, parentId: doc, blockType: 'paragraph', richText: [{ text: '' }] },
  { type: 'block.create', id: `${doc}-b3`, parentId: doc, blockType: 'paragraph', richText: [{ text: '바꿀 x+y 글' }] },
  { type: 'block.create', id: `${doc}-b4`, parentId: doc, blockType: 'paragraph', richText: [{ text: '' }] },
]);

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${doc}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const blockText = id => page.locator(`[data-block-id="${id}"] .block-text, .block:has([data-id="${id}"]) .block-text`).first();
const textOf = async index => page.locator('.page-editor .block-text').nth(index);

// 1. 저장된 수식은 KaTeX로(글 크기 1.21em), 앞뒤 글은 그대로
const drawn = await page.evaluate(() => { const e = document.querySelector('.inline-equation'); const k = e?.querySelector('.katex'); return { katex: !!k, size: k ? getComputedStyle(k).fontSize : '-', line: e?.closest('.block-text')?.textContent.startsWith('앞 ') }; });
ok('저장된 인라인 수식: KaTeX(19.36px)로, 앞뒤 글 유지', drawn.katex && drawn.size === '19.36px' && drawn.line, JSON.stringify(drawn));

// 2. "$$x^2$$" 입력 → 수식
await (await textOf(1)).click(); await page.keyboard.type('$$x^2$$'); await page.waitForTimeout(1200);
let runs = await runsOf(`${doc}-b2`);
ok('"$$x^2$$" → 인라인 수식으로 저장', runs.length === 1 && runs[0].equation === true && runs[0].text === 'x^2', JSON.stringify(runs));

// 3. 글을 골라 ⌘⇧E → 그 글이 수식
await page.evaluate(id => {
  const el = [...document.querySelectorAll('.page-editor .block-text')].find(e => e.textContent === '바꿀 x+y 글');
  const node = el.firstChild; const range = document.createRange(); const start = node.textContent.indexOf('x+y'); range.setStart(node, start); range.setEnd(node, start + 3);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
}); await page.waitForTimeout(300);
await page.keyboard.press('Meta+Shift+E'); await page.waitForTimeout(300);
if (!(await runsOf(`${doc}-b3`)).some(run => run.equation)) { await page.keyboard.press('Control+Shift+E'); }
await page.waitForTimeout(1200);
runs = await runsOf(`${doc}-b3`);
ok('고른 "x+y"에 ⌘⇧E → 수식(앞뒤 글 유지)', runs.map(run => run.equation ? `[${run.text}]` : run.text).join('') === '바꿀 [x+y] 글', JSON.stringify(runs));

// 4. "/인라인 수식" → 빈 수식 칩 + 편집기(400×41, 칩 아래 6), 입력 중 미리 보기, Enter로 저장
await (await textOf(3)).click(); await page.keyboard.type('/인라인 수식'); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
const editor = await page.evaluate(() => { const chip = document.querySelector('.inline-equation.empty'); const pop = document.querySelector('.math-popover.inline'); const c = chip?.getBoundingClientRect(), p = pop?.getBoundingClientRect(); return { chip: chip?.textContent, w: p && Math.round(p.width), h: p && Math.round(p.height), dx: c && p ? Math.round(p.left - c.left) : null, dy: c && p ? Math.round(p.top - c.bottom) : null, focused: document.activeElement?.classList.contains('math-input') }; });
await page.keyboard.type('E=mc^2'); await page.waitForTimeout(300);
const live = await page.evaluate(() => !!document.querySelector('.inline-equation.editing .katex'));
await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
runs = await runsOf(`${doc}-b4`);
ok('"/인라인 수식": "새 수식" 칩 · 400×41 편집기(칩 아래 6, 왼쪽 맞춤) · 입력하는 대로 그림 · Enter 저장', editor.chip === '새 수식' && editor.w === 400 && editor.h === 41 && editor.dx === 0 && editor.dy === 6 && editor.focused && live && runs.length === 1 && runs[0].text === 'E=mc^2' && runs[0].equation, `${JSON.stringify(editor)} live=${live} ${JSON.stringify(runs)}`);

// 5. 수식을 누르면 TeX가 골라진 편집기 → 비우고 Enter → 수식이 지워짐
await page.locator('.inline-equation', { hasText: '' }).last().click(); await page.waitForTimeout(500);
const reopened = await page.evaluate(() => { const input = document.querySelector('.math-input.inline'); return input ? `${input.value}|${input.selectionStart}-${input.selectionEnd}` : '-'; });
await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
runs = await runsOf(`${doc}-b4`);
ok('수식을 누르면 TeX 전체가 골라진 편집기, 비우면 수식 삭제', reopened === 'E=mc^2|0-6' && !runs.some(run => run.equation), `${reopened} ${JSON.stringify(runs)}`);

// 6. 고른 글 메뉴의 √x 단추 = 수식으로 변환 (낱말을 두 번 눌러 고름)
const word = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.page-editor .block-text')].find(e => e.textContent.startsWith('바꿀'));
  const node = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.includes('글'));
  const range = document.createRange(); const i = node.textContent.indexOf('글'); range.setStart(node, i); range.setEnd(node, i + 1);
  const r = range.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
});
await page.mouse.dblclick(word[0], word[1]); await page.waitForTimeout(700);
const button = page.locator('.text-action-menu [aria-label^="수식으로 변환"]');
const shown = await button.count();
if (shown) { await button.dispatchEvent('mousedown'); await page.waitForTimeout(1200); }
runs = await runsOf(`${doc}-b3`);
ok('글 선택 메뉴의 √x "수식으로 변환 ⌘⇧E" → 고른 낱말이 수식', shown === 1 && runs.filter(run => run.equation).map(run => run.text).join('|') === 'x+y|글', `${shown} ${JSON.stringify(runs)}`);

// 7. "/코드: Mermaid" → 견본 코드(고른 채) + 그 아래 다이어그램(#eee 상자 · #999 테두리 · 180×54), 같은 상자 안
await (await textOf(0)).click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
await page.keyboard.type('/코드: Mermaid'); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(4000);
const diagram = await page.evaluate(() => { const block = document.querySelector('.code-mermaid-block'); const rect = block?.querySelector('.mermaid-preview svg g.node rect'); const sel = getSelection().toString(); const pre = block?.querySelector('pre').getBoundingClientRect(), preview = block?.querySelector('.mermaid-preview').getBoundingClientRect(); return { code: block?.querySelector('code').textContent, selected: sel, fill: rect && getComputedStyle(rect).fill, stroke: rect && getComputedStyle(rect).stroke, size: rect && `${Math.round(rect.getBoundingClientRect().width)}x${Math.round(rect.getBoundingClientRect().height)}`, joined: pre && preview ? Math.round(preview.top - pre.bottom) : null }; });
ok('"/코드: Mermaid": 견본(고른 채) · 다이어그램 #eee/#999 180×54 · 코드 바로 아래 같은 상자', diagram.code === 'graph TD\n  Mermaid --> Diagram' && diagram.selected === diagram.code && diagram.fill === 'rgb(238, 238, 238)' && diagram.stroke === 'rgb(153, 153, 153)' && diagram.size === '180x54' && diagram.joined === 0, JSON.stringify(diagram));

// 8. 미리 보기 형식: 미리 보기만 → 코드 숨김, 코드만 → 다이어그램 숨김
await page.locator('.code-mermaid-block').hover(); await page.waitForTimeout(300);
await page.locator('.code-mermaid-block .code-tool.code-mermaid').first().dispatchEvent('mousedown'); await page.waitForTimeout(400);
const picker = await page.evaluate(() => { const p = document.querySelector('.mermaid-mode-picker'); const r = p?.getBoundingClientRect(); return p ? `${Math.round(r.width)}x${Math.round(r.height)} ${[...p.querySelectorAll('.mermaid-mode')].map(b => b.classList.contains('active') ? '*' : '-').join('')}` : '-'; });
await page.locator('.mermaid-mode').nth(1).click(); await page.waitForTimeout(500);
const previewOnly = await page.evaluate(() => { const b = document.querySelector('.code-mermaid-block'); return getComputedStyle(b.querySelector('pre')).display === 'none' && getComputedStyle(b.querySelector('.mermaid-preview')).display !== 'none'; });
await page.locator('.code-mermaid-block').hover(); await page.locator('.code-mermaid-block .code-tool.code-mermaid').first().dispatchEvent('mousedown'); await page.waitForTimeout(400);
await page.locator('.mermaid-mode').nth(0).click(); await page.waitForTimeout(500);
const codeOnly = await page.evaluate(() => { const b = document.querySelector('.code-mermaid-block'); return getComputedStyle(b.querySelector('pre')).display !== 'none' && getComputedStyle(b.querySelector('.mermaid-preview')).display === 'none'; });
ok('미리 보기 형식 고르기(94×28, 셋 중 "둘 다" 표시) → 미리 보기만 · 코드만', picker === '94x28 --*' && previewOnly && codeOnly, `${picker} ${previewOnly} ${codeOnly}`);

// 9. 코드 블록의 ⋯ 메뉴: 전환 › · 코드 복사 · 오른쪽 끝에서 줄바꿈 · 언어 ›(현재 언어) — 색은 없음. 줄바꿈을 고르면 코드가 줄바꿈됨
await page.locator('.code-mermaid-block').hover(); await page.waitForTimeout(200);
await page.locator('.code-mermaid-block .code-tool[aria-label="블록 메뉴 열기"]').dispatchEvent('mousedown'); await page.waitForTimeout(500);
const codeMenu = await page.evaluate(() => [...document.querySelectorAll('.menu .menu-item')].map(item => `${item.querySelector('.menu-item-label')?.textContent ?? ''}${item.querySelector('.menu-item-hint') ? `(${item.querySelector('.menu-item-hint').textContent})` : ''}`));
await page.locator('.menu .menu-item', { hasText: '오른쪽 끝에서 줄바꿈' }).click(); await page.waitForTimeout(400);
const wrapped = await page.evaluate(() => { const b = document.querySelector('.code-mermaid-block'); return b.classList.contains('code-wrap') && getComputedStyle(b.querySelector('pre')).whiteSpace.startsWith('pre-wrap'); });
const want = ['전환', '캡션', '코드 복사', '오른쪽 끝에서 줄바꿈', '언어(Mermaid)', '블록 링크 복사', '복제', '옮기기', '삭제', '댓글', '여기서 프레젠테이션 시작'];
ok('코드 ⋯ 메뉴: 전환 · 캡션 · 코드 복사 · 오른쪽 끝에서 줄바꿈 · 언어(Mermaid) · 공통 항목, 색 없음 · 줄바꿈 켜기', JSON.stringify(codeMenu) === JSON.stringify(want) && wrapped, `${JSON.stringify(codeMenu)} wrap=${wrapped}`);

// 10. 다이어그램 펼치기 → 큰 보기(다이어그램 · 닫기), Esc로 닫힘
await page.locator('.code-mermaid-block').hover(); await page.waitForTimeout(200);
await page.locator('.code-mermaid-block .code-tool[aria-label="다이어그램 펼치기"]').dispatchEvent('mousedown'); await page.waitForTimeout(1500);
const viewer = await page.evaluate(() => { const v = document.querySelector('.mermaid-viewer'); return v ? { svg: !!v.querySelector('svg g.node'), close: !!v.querySelector('.mermaid-viewer-close') } : null; });
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
const closed = await page.locator('.mermaid-viewer').count() === 0;
ok('다이어그램 펼치기 → 큰 보기(다이어그램 · 닫기), Esc로 닫힘', !!viewer?.svg && viewer.close && closed, `${JSON.stringify(viewer)} closed=${closed}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
