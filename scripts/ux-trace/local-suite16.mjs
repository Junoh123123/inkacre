// 17차 점검(프레젠테이션, 베타): 페이지 ⋯ › 더 보기의 "프레젠테이션"(베타 ⌘⌥P) · ⌘⌥P · 블록 메뉴 "여기서 프레젠테이션 시작".
// 첫 장은 제목만(800 폭을 창 폭에 맞춰 확대, 가운데), 다음 장부터 맨 위 구분선마다 나눔, → · Space 다음, ← 이전, 주소 ?present=N,
// 아래 가운데 조작 막대(‹ n/N › | 링크 · 전체 화면 · 종료, 40 높이, 아래 24)는 움직일 때만 보이고 2초 뒤 사라짐, Esc 종료 — 1512×772.
// 사용법: node scripts/ux-trace/local-suite16.mjs <fixture 주소>   (PASS/FAIL 출력)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [base] = process.argv.slice(2);
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const id = `suite16-${Date.now()}`;
await post([{ type: 'page.create', id, title: '발표 문서', parentId: null },
  { type: 'block.create', id: `${id}-a`, parentId: id, blockType: 'paragraph', richText: [{ text: '첫 장 문단' }] },
  { type: 'block.create', id: `${id}-d1`, parentId: id, blockType: 'divider' },
  { type: 'block.create', id: `${id}-h`, parentId: id, blockType: 'heading1', richText: [{ text: '둘째 장 제목' }] },
  { type: 'block.create', id: `${id}-b`, parentId: id, blockType: 'bullet', richText: [{ text: '둘째 장 항목' }] },
  { type: 'block.create', id: `${id}-d2`, parentId: id, blockType: 'divider' },
  { type: 'block.create', id: `${id}-c`, parentId: id, blockType: 'paragraph', richText: [{ text: '셋째 장 문단' }] },
]);
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 772 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`${base}/?id=${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const shown = () => page.evaluate(() => [...document.querySelectorAll('.presentation .page-editor > .block')].filter(b => b.offsetParent).map(b => b.textContent.replace('•', '')).join('|'));
const where = () => page.evaluate(() => `${new URL(location.href).searchParams.get('present')}|${document.querySelector('.presentation-count')?.textContent}`);

// 1. ⋯ › 더 보기 › 프레젠테이션(베타 ⌘⌥P) → 제목 장(1.89배, 가운데), 조작 막대
await page.locator('[aria-label="페이지 메뉴"]').first().click(); await page.waitForTimeout(400);
await page.locator('.menu .menu-item', { hasText: '더 보기' }).last().hover(); await page.waitForTimeout(500);
const moreItem = await page.evaluate(() => [...document.querySelectorAll('.menu .menu-item')].find(e => e.textContent.startsWith('프레젠테이션'))?.textContent ?? '-');
await page.locator('.menu .menu-item', { hasText: '프레젠테이션' }).click(); await page.waitForTimeout(800);
const title = await page.evaluate(() => { const t = document.querySelector('.presentation-title-text'); const r = t.getBoundingClientRect(); return { text: t.textContent, tf: getComputedStyle(document.querySelector('.presentation-slide')).transform, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), size: getComputedStyle(t).fontSize }; });
ok('⋯ › 더 보기 › "프레젠테이션 베타 ⌘⌥P" → 제목 장: 40px 제목을 1.89배(1512/800), 화면 가운데', moreItem === '프레젠테이션베타⌘⌥P' && title.text === '발표 문서' && title.tf === 'matrix(1.89, 0, 0, 1.89, 0, 0)' && Math.abs(title.cx - 756) <= 1 && Math.abs(title.cy - 386) <= 2 && title.size === '40px' && (await where()) === '0|1/4', `${moreItem} ${JSON.stringify(title)} ${await where()}`);

// 2. → · Space로 넘김: 구분선마다 한 장(구분선은 보이지 않음)
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
const one = `${await shown()}@${await where()}`;
await page.keyboard.press('Space'); await page.waitForTimeout(500);
const two = `${await shown()}@${await where()}`;
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
const three = `${await shown()}@${await where()}`;
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
const stay = await where();
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500);
ok('→ · Space 다음, ← 이전: 맨 위 구분선마다 한 장, 마지막에서 멈춤, 주소 ?present=N', one === '첫 장 문단@1|2/4' && two === '둘째 장 제목|둘째 장 항목@2|3/4' && three === '셋째 장 문단@3|4/4' && stay === '3|4/4' && (await where()) === '2|3/4', `${one} / ${two} / ${three} / ${stay}`);

// 3. 조작 막대: 움직이면 보임(40 높이, 아래 24, 가운데) → 2초 뒤 사라짐
await page.mouse.move(700, 500); await page.mouse.move(720, 520); await page.waitForTimeout(400);
const bar = await page.evaluate(() => { const b = document.querySelector('.presentation-controls'); const r = b.getBoundingClientRect(); return { op: getComputedStyle(b).opacity, h: Math.round(r.height), bottom: Math.round(772 - r.bottom), cx: Math.round(r.x + r.width / 2), labels: [...b.querySelectorAll('button')].map(x => x.getAttribute('aria-label')).join('|'), count: b.querySelector('.presentation-count').textContent }; });
await page.waitForTimeout(2600);
const faded = await page.evaluate(() => getComputedStyle(document.querySelector('.presentation-controls')).opacity);
ok('조작 막대: 움직일 때 ‹ 3/4 › | 링크 · 전체 화면 · 종료(40 높이, 아래 24, 가운데), 2초 뒤 사라짐', bar.op === '1' && bar.h === 40 && bar.bottom === 24 && Math.abs(bar.cx - 756) <= 1 && bar.labels === '이전 슬라이드|다음 슬라이드|슬라이드 링크 복사|전체 화면으로 보기|프레젠테이션 종료' && bar.count === '3/4' && faded === '0', `${JSON.stringify(bar)} faded=${faded}`);

// 4. Esc → 끝, 주소에서 present가 빠지고 그 장의 첫 블록으로
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
ok('Esc → 프레젠테이션 끝(주소에서 present 제거)', !(await page.locator('.presentation').count()) && !(await page.evaluate(() => new URL(location.href).searchParams.has('present'))));

// 5. 블록 메뉴 "여기서 프레젠테이션 시작"(베타 ⌘⌥P, 댓글 다음 따로) → 그 블록의 장부터
await page.locator('.page-editor .block-bullet').hover(); await page.waitForTimeout(300);
await page.locator('.block-handles .block-drag-handle').click(); await page.waitForTimeout(400);
const items = await page.evaluate(() => [...[...document.querySelectorAll('.menu')].pop().querySelectorAll('.menu-item')].map(e => e.textContent).slice(-2).join('|'));
await page.locator('.menu .menu-item', { hasText: '여기서 프레젠테이션 시작' }).click(); await page.waitForTimeout(800);
const from = await where();
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
ok('블록 메뉴 "여기서 프레젠테이션 시작 베타 ⌘⌥P" → 그 블록이 있는 장(3/4)부터', items === '댓글⌘⇧M|여기서 프레젠테이션 시작베타⌘⌥P' && from === '2|3/4', `${items} ${from}`);

// 6. ⌘⌥P: 커서가 있는 장부터, 슬라이드 링크(?present=3)로 열면 그 장
await page.locator('.page-editor .block-text', { hasText: '셋째 장 문단' }).click(); await page.waitForTimeout(200);
await page.keyboard.press('Meta+Alt+KeyP'); await page.waitForTimeout(800);
const caret = await where();
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.goto(`${base}/?id=${id}&present=1`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
ok('⌘⌥P는 커서가 있는 장부터, ?present=1 주소는 그 장으로 열림(검색 창은 열리지 않음)', caret === '3|4/4' && (await where()) === '1|2/4' && !(await page.locator('.search-dialog, .search-preview').count()), `${caret} ${await where()}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
