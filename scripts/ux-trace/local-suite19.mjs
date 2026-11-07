// 18차 점검(HTML 블록 "HTML · 임베드"): "/html" → 빈 막대 + 540 폭 추가 창(탭 "추가", 점선 영역 516×130
// "HTML 파일 업로드 / 또는 여기로 끌어다 놓기"), .html을 올리면 머리 줄(파일 이름 13/500) + 1px #e6e5e3 r6 상자 안 500 높이
// 프레임(좌우 16), 프레임은 따로 격리(스크립트는 돌지만 앱 · API에 닿지 못함), ⋯ → "임베드" 메뉴(전환 · 바꾸기 · 다운로드 ·
// 캡션 · 전체 화면 · 원본 보기), 전체 화면(48 막대, Esc), 아래 막대로 높이 조절 — 1512×828.
// 사용법: node scripts/ux-trace/local-suite19.mjs <fixture 주소> [점검용 .html 파일 — 기본 fixtures/sandbox-test.html]   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base, htmlArg] = process.argv.slice(2);
const htmlPath = htmlArg ?? new URL('./fixtures/sandbox-test.html', import.meta.url).pathname;
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite19-${Date.now()}`;
await post([{ type: 'page.create', id, title: 'HTML 문서', parentId: null }, { type: 'block.create', id: `${id}-p`, parentId: id, blockType: 'paragraph', richText: [{ text: '위 문단' }] }]);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|Failed to fetch|CORS|blocked/i.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const rect = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); }, sel);

// 1. "/html": 걸러진 결과 "HTML · 임베드 신규", Enter → 빈 막대 + 추가 창
const first = page.locator('.page-editor .block', { hasText: /^위 문단$/ }).first();
const box = await first.boundingBox(); await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/html'); await page.waitForTimeout(400);
const slash = await page.evaluate(() => { const item = document.querySelector('.slash-menu .slash-item.active') ?? document.querySelector('.slash-menu .slash-item'); return item ? item.textContent : null; });
await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const panel = await page.evaluate(() => { const p = document.querySelector('.html-picker'); if (!p) return null; const drop = p.querySelector('.html-drop').getBoundingClientRect(); return { w: Math.round(p.getBoundingClientRect().width), tab: p.querySelector('.html-picker-tab').textContent, drop: `${Math.round(drop.width)}×${Math.round(drop.height)}`, title: p.querySelector('.html-drop-title').textContent, note: p.querySelector('.html-drop-note').textContent, bar: document.querySelector('.block-html .media-empty, .media-empty')?.textContent }; });
ok('/html → "HTML · 임베드 신규", Enter → 빈 막대 "HTML 파일 업로드" + 540 폭 추가 창(탭 추가, 점선 516×130 "HTML 파일 업로드 / 또는 여기로 끌어다 놓기")', /^HTML · 임베드신규$/.test(slash ?? '') && panel?.w === 540 && panel.tab === '추가' && panel.drop === '516×130' && panel.title === 'HTML 파일 업로드' && panel.note === '또는 여기로 끌어다 놓기' && panel.bar === 'HTML 파일 업로드', `${slash} ${JSON.stringify(panel)}`);

// 2. 파일을 고르면 머리 줄 + 500 높이 프레임(상자 1px #e6e5e3 r6, 좌우 16)
await page.locator('.html-picker input[type=file]').setInputFiles(htmlPath); await page.waitForTimeout(2000);
const all = await state();
const block = all.objects.find(o => o.kind === 'block' && o.parentId === id && o.blockType === 'html');
const shown = await page.evaluate(() => { const b = document.querySelector('.html-block'); if (!b) return null; const boxEl = b.querySelector('.html-box'), frame = b.querySelector('iframe'); const br = boxEl.getBoundingClientRect(), fr = frame.getBoundingClientRect(); const cs = getComputedStyle(boxEl); return { name: b.querySelector('.html-name').textContent, nameFont: `${getComputedStyle(b.querySelector('.html-name')).fontSize}/${getComputedStyle(b.querySelector('.html-name')).fontWeight}`, head: Math.round(b.querySelector('.html-head').getBoundingClientRect().height), boxH: Math.round(br.height), border: cs.border, radius: cs.borderRadius, inset: Math.round(fr.left - br.left), frameH: Math.round(fr.height), src: frame.getAttribute('src'), sandbox: frame.getAttribute('sandbox') }; });
ok('.html 올림 → 블록에 첨부, 머리 줄 28(이름 13/500) + 상자 502(1px #e6e5e3 r6) 안 프레임 500(좌우 16), /api/html/…', !!block?.attachmentId && shown?.name === 'sandbox-test.html' && shown.nameFont === '13px/500' && shown.head === 28 && shown.boxH === 502 && shown.border === '1px solid rgb(230, 229, 227)' && shown.radius === '6px' && shown.inset === 17 && shown.frameH === 500 && shown.src === `/api/html/${encodeURIComponent(block.attachmentId)}` && !/allow-same-origin/.test(shown.sandbox), JSON.stringify(shown));

// 3. 프레임 안: 스크립트는 돌고, 앱(parent)과 API에는 닿지 못함
await page.waitForTimeout(1200);
const frame = page.frameLocator('.html-block iframe');
const inside = { h: await frame.locator('#h').textContent(), parent: await frame.locator('#parent').textContent(), api: await frame.locator('#api').textContent() };
ok('프레임: 스크립트 실행, parent 접근 막힘, /api 읽기 막힘', inside.h === '스크립트 실행됨' && inside.parent === 'parent-blocked' && inside.api === 'api-blocked', JSON.stringify(inside));

// 4. ⋯ → "임베드" 메뉴(포인터 위치): 전환 · 바꾸기 · 다운로드 · 캡션 · 전체 화면 · 원본 보기 | …
await page.locator('.html-block').hover(); await page.waitForTimeout(200);
const more = await page.locator('.html-action[aria-label="더 보기"]').boundingBox();
await page.mouse.click(more.x + 12, more.y + 12); await page.waitForTimeout(500);
const menu = await page.evaluate(() => { const m = [...document.querySelectorAll('.menu')].pop(); return { head: m.querySelector('.menu-heading')?.textContent, items: [...m.querySelectorAll('.menu-item-label')].map(e => e.textContent).slice(0, 7).join('|') }; });
ok('⋯ → "임베드": 전환 · 바꾸기 · 다운로드 · 캡션 · 전체 화면 · 원본 보기 · 블록 링크 복사', menu.head === '임베드' && menu.items === '전환|바꾸기|다운로드|캡션|전체 화면|원본 보기|블록 링크 복사', JSON.stringify(menu));

// 5. 전체 화면: 페이지 영역 위(사이드바 오른쪽부터), 48 막대(다운로드 · 닫기), Esc로 닫힘
await page.locator('.menu .menu-item').filter({ has: page.locator('.menu-item-label', { hasText: /^전체 화면$/ }) }).click(); await page.waitForTimeout(600);
const full = await page.evaluate(() => { const f = document.querySelector('.html-fullscreen'); if (!f) return null; const side = document.querySelector('.sidebar'); return { left: Math.round(f.getBoundingClientRect().left), side: side ? Math.round(side.getBoundingClientRect().right) : 0, bar: Math.round(f.querySelector('.html-fullscreen-bar').getBoundingClientRect().height), button: f.querySelector('.html-fullscreen-button').textContent, frame: Math.round(f.querySelector('iframe').getBoundingClientRect().height) }; });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const closed = !(await page.locator('.html-fullscreen').count());
ok('전체 화면: 사이드바 오른쪽부터, 48 막대("다운로드" · 닫기), 아래 프레임, Esc로 닫힘', full?.left === full?.side && full.bar === 48 && full.button === '다운로드' && full.frame === 828 - 48 && closed, `${JSON.stringify(full)} closed=${closed}`);

// 6. 아래 막대를 끌어 높이 600 → 블록에 저장(새로 고쳐도)
await page.locator('.html-block').hover(); await page.waitForTimeout(200);
const bar = await page.locator('.html-resize').boundingBox();
await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2); await page.mouse.down(); await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2 + 100, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1200);
const height = (await state()).objects.find(o => o.id === block.id)?.height;
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const after = await rect('.html-box');
ok('아래 막대로 높이 600 → height 600 저장, 새로 고쳐도 상자 602', height === 600 && after?.[3] === 602, `${height} ${after}`);

// 7. 오른쪽 아래 모서리를 왼쪽으로 200 → 너비 200 줄고 가운데 정렬(손잡이도 따라감), 저장
await page.locator('.html-block').hover(); await page.waitForTimeout(200);
const beforeBox = await page.locator('.html-block').boundingBox();
const corner = await page.locator('.html-corner.right').boundingBox();
await page.mouse.move(corner.x + 10, corner.y + 10); await page.mouse.down(); await page.mouse.move(corner.x - 190, corner.y + 10, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1200);
const widthSaved = (await state()).objects.find(o => o.id === block.id)?.width;
const afterBox = await page.locator('.html-block').boundingBox();
const wrap = await page.locator('.html-block').evaluate(e => { const p = e.parentElement.getBoundingClientRect(); return { left: p.left, right: p.right }; });
await page.locator('.html-block .html-head').hover(); await page.waitForTimeout(300);
const handle = await page.locator('.block-handles .block-drag-handle').boundingBox();
ok('오른쪽 아래 모서리를 왼쪽으로 200 → 너비 200 줄어 가운데(양쪽 여백 같음), width 저장, ⋮⋮ 손잡이도 블록 왼쪽을 따라감', widthSaved === Math.round(beforeBox.width - 200) && Math.round(afterBox.width) === widthSaved && Math.abs((afterBox.x - wrap.left) - (wrap.right - afterBox.x - afterBox.width)) <= 1 && handle && handle.x + handle.width <= afterBox.x && handle.x > afterBox.x - 40, `${widthSaved} ${JSON.stringify(afterBox)} ${JSON.stringify(wrap)} ${JSON.stringify(handle)}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
