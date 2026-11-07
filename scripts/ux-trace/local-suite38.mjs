// 34차 (personal-workspace features, continued). 자동 백업: 설정 › 백업 — the schedule, a backup by hand, checking it,
// another folder, and a backup opened as a new workspace. 받은 파일 폴더. 연결 지도. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite38.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite38-')), elsewhere = mkdtempSync(path.join(tmpdir(), 'suite38-drive-'));
const port = 8800 + Math.floor(Math.random() * 40) * 20 + 7;
const base = `http://127.0.0.1:${port}`;
for (const at of [port, port + 10]) { const busy = await fetch(`http://127.0.0.1:${at}/api/state`).then(() => true, () => false); if (busy) { console.log(`FAIL port ${at} is in use; run again`); process.exit(1); } }
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
process.on('exit', () => { server.kill(); rmSync(folder, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async (at = base) => (await fetch(`${at}/api/state`)).json();
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };

await post([
  { type: 'workspace.update', name: '내 노트' },
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'plan', title: '계획', parentId: 'home' },
  { type: 'block.create', id: 'p1', parentId: 'plan', blockType: 'paragraph', richText: [{ text: '백업 전의 문장' }] },
]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
await context.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const openSettings = async name => {
  await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
  await page.locator('.menu-item', { hasText: /^설정$/ }).first().click(); await page.waitForTimeout(400);
  await page.locator('.prefs-nav-item', { hasText: name }).first().click(); await page.waitForTimeout(500);
};
const row = label => page.locator('.prefs-row', { hasText: label }).first();

// 1. 설정 › 백업: daily by default in the data folder (with the same-disk warning); a backup by hand, then checked.
await page.goto(`${base}/?id=plan`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await openSettings('백업');
const every = await row('주기').locator('select').inputValue();
const where = await row('백업 폴더').textContent();
await row('마지막 백업').locator('button', { hasText: '지금 백업' }).click(); await page.waitForTimeout(1500);
const items = await page.locator('.backup-item').allTextContents();
await page.locator('.backup-item').first().locator('button', { hasText: '점검' }).click(); await page.waitForTimeout(1200);
const checked = await page.locator('.backup-item').first().locator('.backup-check').textContent();
const lastNote = await row('마지막 백업').locator('.prefs-row-note').textContent();
ok('설정 › 백업: 기본은 매일 · 데이터 폴더 안(디스크 고장 경고) · 지금 백업 → 목록에 "직접" · 점검 → 이상 없음 · 그 뒤로 바뀐 내용 없음',
  every === 'daily' && /데이터 폴더 안/.test(where ?? '') && /디스크가 고장/.test(where ?? '') && items.length === 1 && /직접/.test(items[0]) && checked === '이상 없음' && /바뀐 내용이 없습니다/.test(lastNote ?? ''),
  `every=${every} items=${items} checked=${checked} note=${lastNote}`);

// 2. Another folder (an existing one), then a backup there; keep count changes.
await row('백업 폴더').locator('button', { hasText: '바꾸기' }).click(); await page.waitForTimeout(200);
await row('백업 폴더').locator('input').fill(path.join(elsewhere, 'nope')); await row('백업 폴더').locator('button', { hasText: '저장' }).click(); await page.waitForTimeout(500);
const refusal = await page.locator('.mirror-error').textContent().catch(() => '');
await row('백업 폴더').locator('input').fill(elsewhere); await row('백업 폴더').locator('button', { hasText: '저장' }).click(); await page.waitForTimeout(600);
const shown = await row('백업 폴더').locator('.mirror-folder').textContent();
await row('보관 개수').locator('select').selectOption('14'); await page.waitForTimeout(400);
await row('마지막 백업').locator('button', { hasText: '지금 백업' }).click(); await page.waitForTimeout(1500);
const there = readdirSync(elsewhere);
const inside = there.length ? readdirSync(path.join(elsewhere, there[0])) : [];
const keep = (await (await fetch(`${base}/api/backups`)).json()).keep;
ok('없는 폴더는 거절 · 있는 폴더로 바꾸면 그 안 "Pageyard backups …"에 백업 · 보관 개수 14', /찾을 수 없습니다/.test(refusal ?? '') && shown === elsewhere && /^Pageyard backups [0-9a-f]{8}$/.test(there[0] ?? '') && inside.length === 1 && keep === 14,
  `refusal=${refusal} shown=${shown} there=${there} inside=${inside} keep=${keep}`);

// 3. Changed afterwards; the backup opened as a new workspace shows the page as it was, in a tab of its own.
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await post([{ type: 'block.update', id: 'p1', richText: [{ text: '백업 뒤에 고친 문장' }] }]);
await openSettings('백업');
const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.locator('.backup-item').first().locator('button', { hasText: '새 워크스페이스로 열기' }).click()]);
await popup?.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800);
const popupUrl = popup?.url() ?? '';
const restoredOrigin = popupUrl ? new URL(popupUrl).origin : '';
const restored = restoredOrigin ? await state(restoredOrigin) : { objects: [] };
const restoredText = restored.objects.find(item => item.id === 'p1')?.richText?.[0]?.text;
const restoredName = restored.objects.find(item => item.id === 'workspace-settings')?.name ?? '';
const nowText = (await state()).objects.find(item => item.id === 'p1')?.richText?.[0]?.text;
ok('새 워크스페이스로 열기 → 새 탭(다른 포트)에 백업 시점의 페이지 · 이름 "내 노트 (백업 …)" · 지금 워크스페이스는 그대로', !!popupUrl && restoredOrigin !== base && restoredText === '백업 전의 문장' && /^내 노트 \(백업 /.test(restoredName) && nowText === '백업 뒤에 고친 문장',
  `url=${popupUrl} text=${restoredText} name=${restoredName} now=${nowText}`);
await popup?.close();

// 4. 받은 파일 폴더 (설정 › 빠른 기록): a file already there stays out; a new one appears on the page by itself.
const { writeFileSync, utimesSync } = await import('node:fs');
const drop = mkdtempSync(path.join(tmpdir(), 'suite38-inbox-'));
process.on('exit', () => rmSync(drop, { recursive: true, force: true }));
writeFileSync(path.join(drop, '예전 파일.txt'), '예전');
await page.goto(`${base}/?id=plan`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await openSettings('빠른 기록');
await row('기록이 들어갈 페이지').locator('button', { hasText: '새로 만들기' }).click(); await page.waitForTimeout(800);
const inboxRow = page.locator('.prefs-row', { hasText: /^폴더/ }).first();
await inboxRow.locator('input').fill(drop); await inboxRow.locator('button', { hasText: '켜기' }).click(); await page.waitForTimeout(600);
const waitingNote = await inboxRow.locator('.prefs-row-note').textContent().catch(() => '');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const captureId = (await state()).objects.find(item => item.id === 'workspace-settings')?.capturePageId;
await page.goto(`${base}/?id=${captureId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(path.join(drop, '스캔한 영수증.png'), png);
const past = new Date(Date.now() - 10_000); utimesSync(path.join(drop, '스캔한 영수증.png'), past, past);
let appeared = false;
for (let tries = 0; tries < 40 && !appeared; tries++) { await page.waitForTimeout(500); appeared = await page.locator('.page-editor img, .page-editor [data-block-type="image"]').count() > 0; }
const names = (await state()).objects.filter(item => item.kind === 'attachment').map(item => item.name);
ok('받은 파일 폴더: 켜면 "새 파일을 기다리는 중" · 이미 있던 파일은 안 가져옴 · 새 그림은 몇 초 뒤 빠른 기록 페이지에 저절로 나타남', /새 파일을 기다리는 중/.test(waitingNote ?? '') && appeared && names.includes('스캔한 영수증.png') && !names.includes('예전 파일.txt'),
  `note=${waitingNote} appeared=${appeared} names=${names}`);

// 5. 연결 지도: pages and the lines between them; rows with relations on request; a page's own map from its ⋯ menu.
const link = (from, n, to) => ({ type: 'block.create', id: `${from}-link${n}`, parentId: from, blockType: 'paragraph', richText: [{ text: '참고 ' }, { text: 'x', pageId: to }] });
await post([
  { type: 'page.create', id: 'g-hub', title: '분기 계획', parentId: null },
  { type: 'page.create', id: 'g-a', title: '아이디어', parentId: 'g-hub' },
  { type: 'page.create', id: 'g-b', title: '경쟁사', parentId: null },
  { type: 'page.create', id: 'g-c', title: '회의록', parentId: null },
  { type: 'page.create', id: 'g-lonely', title: '혼자인 페이지', parentId: null },
  link('g-hub', 1, 'g-b'), link('g-c', 1, 'g-hub'), link('g-a', 1, 'g-b'),
  { type: 'page.create', id: 'g-db', title: '책', parentId: null },
  { type: 'source.create', id: 'g-src', pageId: 'g-db', name: '책', titlePropertyId: 'g-title' },
  { type: 'property.create', id: 'g-rel', sourceId: 'g-src', name: '관련', propertyType: 'relation', targetSourceId: 'g-src' },
  { type: 'page.create', id: 'g-r1', title: '첫 책', sourceId: 'g-src', parentId: 'g-src' },
  { type: 'page.create', id: 'g-r2', title: '둘째 책', sourceId: 'g-src', parentId: 'g-src' },
  { type: 'value.set', pageId: 'g-r1', propertyId: 'g-rel', value: ['g-r2'] },
]);
await page.goto(`${base}/?id=g-hub`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(250);
await page.locator('.menu-item', { hasText: '연결 지도' }).first().click(); await page.waitForTimeout(2500);
const listed = async () => page.locator('.graph-list button').evaluateAll(buttons => buttons.map(button => button.textContent));
const graphUrl = page.url(), names1 = await listed(), count1 = await page.locator('.graph-count').textContent();
const set = async (key, on) => { const chip = page.locator(`.graph-tools [data-option="${key}"]`); if ((await chip.getAttribute('aria-pressed')) !== String(on)) { await chip.click(); await page.waitForTimeout(900); } };
await set('orphans', false);
const names2 = await listed();
await set('rows', true);
const names3 = await listed();
ok('연결 지도: 전환 메뉴에서 열림(?graph=1) · 페이지와 링크 · 연결 없는 페이지 끄면 사라짐 · 데이터베이스 행 켜면 관계 있는 행만',
  graphUrl.includes('graph=1') && names1.includes('혼자인 페이지') && names1.includes('분기 계획') && !names1.includes('첫 책') && /연결 \d+개/.test(count1 ?? '') &&
  !names2.includes('혼자인 페이지') && names3.includes('첫 책') && names3.includes('둘째 책'),
  `count=${count1} n1=${names1.length} n2=${names2.length} n3=${names3}`);
await set('rows', false); await set('orphans', true);
await page.waitForTimeout(1500);
const spot = await page.locator('.graph-list button', { hasText: '경쟁사' }).evaluate(button => ({ x: Number(button.dataset.x), y: Number(button.dataset.y) }));
await page.mouse.click(spot.x, spot.y); await page.waitForTimeout(800);
const clicked = page.url();
await page.goto(`${base}/?id=g-hub`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await page.locator('.topbar [aria-label="더 보기"], .topbar-actions button[aria-label*="더"], [aria-label="페이지 메뉴"]').first().click().catch(() => {}); await page.waitForTimeout(300);
await page.locator('.menu-item', { hasText: '연결 지도에서 보기' }).first().click(); await page.waitForTimeout(2000);
const focusUrl = page.url(), focusLabel = await page.locator('.graph-focus-label').textContent().catch(() => ''), focusNames = await listed();
ok('지도에서 점을 누르면 그 페이지로 · 페이지 ⋯ → "연결 지도에서 보기" → 그 페이지 중심(1단계 이웃만)', clicked.includes('id=g-b') && focusUrl.includes('focus=g-hub') && /분기 계획/.test(focusLabel ?? '') &&
  focusNames.includes('경쟁사') && focusNames.includes('회의록') && focusNames.includes('아이디어') && !focusNames.includes('혼자인 페이지') && !focusNames.includes('작업 공간'),
  `clicked=${clicked} focus=${focusUrl} label=${focusLabel} names=${focusNames}`);

ok('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(0);
