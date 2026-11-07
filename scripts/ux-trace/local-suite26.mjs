// 21차: page layouts — pin properties in the heading, backlinks always /
// on hover / off, a section's ⋯ (위로 · 아래로 이동, 패널로 이동, 레이아웃에서 제거), dragging a property between a group,
// the panel and the heading, renaming a property from the builder, no relations in the panel, and 탭 구조 tabs that
// show another database's view narrowed to rows related to the page (a row added there belongs to the page).
// Starts its own server on an empty folder. 사용법: node scripts/ux-trace/local-suite26.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite26-'));
const port = 4900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const post = async ops => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor: 'test', expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); };
const layoutOf = async () => (await state()).objects.find(o => o.id === 'p').pageLayout ?? {};

await post([
  { type: 'page.create', id: 'projects', title: '프로젝트', parentId: null },
  { type: 'source.create', id: 'p', pageId: 'projects', name: '프로젝트', titlePropertyId: 'p-t' },
  { type: 'property.create', id: 'p-status', sourceId: 'p', name: '상태', propertyType: 'select', options: [{ id: 'o1', name: '진행', color: 'blue' }] },
  { type: 'property.create', id: 'p-owner', sourceId: 'p', name: '담당', propertyType: 'text' },
  { type: 'property.create', id: 'p-budget', sourceId: 'p', name: '예산', propertyType: 'number' },
  { type: 'view.create', id: 'p-table', sourceId: 'p', parentId: 'projects', name: '표', viewType: 'table', config: {} },
  { type: 'page.create', id: 'tasks', title: '할 일', parentId: null },
  { type: 'source.create', id: 'k', pageId: 'tasks', name: '할 일', titlePropertyId: 'k-t' },
  { type: 'property.create', id: 'k-project', sourceId: 'k', name: '프로젝트', propertyType: 'relation', targetSourceId: 'p', inverse: { id: 'p-tasks', name: '할 일' } },
  { type: 'view.create', id: 'k-table', sourceId: 'k', parentId: 'tasks', name: '표', viewType: 'table', config: {} },
  { type: 'page.create', id: 'alpha', title: '알파', sourceId: 'p' }, { type: 'value.set', pageId: 'alpha', propertyId: 'p-status', value: 'o1' }, { type: 'value.set', pageId: 'alpha', propertyId: 'p-owner', value: '준오' },
  { type: 'page.create', id: 'beta', title: '베타', sourceId: 'p' },
  { type: 'page.create', id: 't1', title: '알파 일', sourceId: 'k' }, { type: 'page.create', id: 't2', title: '베타 일', sourceId: 'k' },
  { type: 'relation.set', pageId: 't1', propertyId: 'k-project', targetIds: ['alpha'] }, { type: 'relation.set', pageId: 't2', propertyId: 'k-project', targetIds: ['beta'] },
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 828 }, locale: 'ko-KR' });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const openEditor = async () => {
  await page.goto(`${base}/?id=p-table`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  await page.locator('.db-tool[aria-label="보기 설정"]').click(); await page.waitForTimeout(400);
  await page.locator('.settings-row', { hasText: '기타 설정' }).click(); await page.waitForTimeout(300);
  await page.locator('.menu-item', { hasText: '페이지 레이아웃 사용자 지정' }).click(); await page.waitForTimeout(600);
};
const menuPick = async text => { await page.locator('.menu-panel .menu-item', { hasText: text }).first().click(); await page.waitForTimeout(250); };

// 1. Pin 상태 in the heading, backlinks on hover; on the page: 상태 under the title, gone from the property list.
{
  await openEditor();
  await page.locator('.layout-pin-add').click(); await page.waitForTimeout(250);
  await menuPick('상태');
  await page.locator('.layout-head-option').click(); await page.waitForTimeout(200);
  const modes = await page.evaluate(() => [...[...document.querySelectorAll('.menu-panel')].pop().querySelectorAll('.menu-item')].map(e => e.textContent.trim()).join('|'));
  await menuPick('마우스를 올릴 때');
  const pins = await page.locator('.layout-pin').count();
  await page.locator('.layout-apply-main').click(); await page.waitForTimeout(700);
  const saved = await layoutOf();
  await page.goto(`${base}/?id=alpha`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const pinned = await page.evaluate(() => [...document.querySelectorAll('.page-pinned .pinned-property')].map(e => `${e.getAttribute('title')}=${e.textContent.trim()}`).join('|'));
  const listed = await page.locator('.page-body .page-properties .property-name span').allInnerTexts();
  ok('속성 고정 → 헤더에 "상태"(값 "진행"), 속성 목록에서 빠짐 · 백링크 [항상 표시 · 펼쳐서 · 팝오버 · 마우스를 올릴 때 · 끄기] → hover로 저장',
    pins === 1 && JSON.stringify(saved.pinned) === '["p-status"]' && saved.backlinks === 'hover' && modes === '항상 표시|펼쳐서 표시|팝오버로 표시|마우스를 올릴 때|끄기' && pinned === '상태=진행' && !listed.includes('상태') && listed.includes('담당'),
    `pins=${pins} saved=${JSON.stringify(saved)} modes=${modes} pinned=${pinned} listed=${listed}`);
}

// 2. 페이지에 추가(+) → 예산 as its own section; its ⋯: 위로 이동 · 아래로 이동 · 패널로 이동 · 레이아웃에서 제거; 위로 이동 puts
// it above the property group; then 패널로 이동 sends it to the panel.
{
  await openEditor();
  await page.locator('.layout-add').first().click(); await page.waitForTimeout(250);
  await menuPick('예산');
  const module = page.locator('.layout-section', { hasText: '예산' }).filter({ has: page.locator('.layout-module') });
  await module.locator('.layout-section-more').click(); await page.waitForTimeout(200);
  const items = await page.evaluate(() => [...[...document.querySelectorAll('.menu-panel')].pop().querySelectorAll('.menu-item')].map(e => e.textContent.trim()).join('|'));
  await menuPick('위로 이동');
  const order1 = await page.evaluate(() => [...document.querySelectorAll('.layout-main [data-section-id] .layout-section-label')].map(e => e.textContent).join('|'));
  await module.locator('.layout-section-more').click(); await page.waitForTimeout(200);
  await menuPick('패널로 이동');
  const panel = await page.locator('.layout-panel .layout-property-name').allInnerTexts();
  await page.locator('.layout-apply-main').click(); await page.waitForTimeout(700);
  const saved = await layoutOf();
  ok('섹션 ⋯ [위로 이동 · 아래로 이동 · 패널로 이동 · 레이아웃에서 제거] → 예산이 속성 그룹 위로, 이어서 패널로',
    items === '위로 이동|아래로 이동|패널로 이동|레이아웃에서 제거' && order1.startsWith('예산|속성 그룹') && panel.join('|').includes('예산') && JSON.stringify(saved.panel) === '["p-budget"]',
    `items=${items} order=${order1} panel=${panel} saved=${JSON.stringify(saved.panel)}`);
}

// 3. Drag 담당 from the group to the heading (pins it); 할 일(관계) can't go to the panel; double-click renames.
{
  await openEditor();
  const row = page.locator('.layout-section.clickable .layout-property', { hasText: '담당' });
  const from = await row.boundingBox(); const to = await page.locator('.layout-pinned').boundingBox();
  await page.mouse.move(from.x + 40, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 }); await page.mouse.move(to.x + 200, to.y + 10, { steps: 8 }); await page.waitForTimeout(150);
  const highlighted = await page.evaluate(() => document.querySelector('.layout-section.drop-over')?.dataset.drop ?? null);
  await page.mouse.up(); await page.waitForTimeout(300);
  const pins = await page.evaluate(() => [...document.querySelectorAll('.layout-pin')].map(e => e.getAttribute('title')).join('|'));
  await page.locator('.layout-panel-add').click(); await page.waitForTimeout(250);
  const panelChoices = await page.evaluate(() => [...[...document.querySelectorAll('.menu-panel')].pop().querySelectorAll('.menu-item')].map(e => e.textContent.trim()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.locator('.layout-section.clickable').first().click({ position: { x: 300, y: 12 } }); await page.waitForTimeout(300);
  await page.locator('.layout-group-row .layout-property-label', { hasText: '할 일' }).dblclick(); await page.waitForTimeout(150);
  await page.locator('.layout-property-rename').fill('관련 할 일'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  const renamed = (await state()).objects.find(o => o.id === 'p-tasks')?.name;
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.locator('.layout-apply-main').click(); await page.waitForTimeout(700);
  const saved = await layoutOf();
  ok('담당을 끌어 헤더로 → 고정(놓을 곳 강조), 패널 후보에 관계형(할 일) 없음, 속성 이름을 두 번 눌러 "관련 할 일"로',
    highlighted === 'pinned' && pins === '상태|담당' && !panelChoices.some(text => text.startsWith('할 일')) && renamed === '관련 할 일' && JSON.stringify(saved.pinned) === '["p-status","p-owner"]',
    `highlight=${highlighted} pins=${pins} panelChoices=${panelChoices.slice(0, 6)} renamed=${renamed} pinned=${JSON.stringify(saved.pinned)}`);
}

// 4. 구조 › 탭, "+ 탭 추가" → 할 일 · 표 (관련 항목만); on 알파: tabs 콘텐츠 · 할 일, the tab lists only 알파 일, and a row
// added there belongs to 알파.
{
  await openEditor();
  await page.locator('.layout-structure', { hasText: '탭' }).click(); await page.waitForTimeout(200);
  await page.locator('.layout-tab-add').click(); await page.waitForTimeout(250);
  const choice = await page.evaluate(() => [...[...document.querySelectorAll('.menu-panel')].pop().querySelectorAll('.menu-item')].map(e => e.textContent.trim()).join('|'));
  await menuPick('할 일 · 표');
  await page.locator('.layout-apply-main').click(); await page.waitForTimeout(700);
  const saved = await layoutOf();
  await page.goto(`${base}/?id=alpha`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const tabs = await page.locator('.page-tabs .page-tab').allInnerTexts();
  await page.locator('.page-tabs .page-tab', { hasText: '할 일' }).click(); await page.waitForTimeout(900);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.page-tab-database .table-row')].map(e => e.textContent).filter(Boolean).join('|'));
  const editorHidden = await page.evaluate(() => document.querySelector('.page-content-tab')?.hidden === true);
  await page.locator('.page-tab-database .db-new-main, .page-tab-database .table-add-row, .page-tab-database .table-new-row').first().click().catch(() => {});
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const related = (await state()).objects.filter(o => o.kind === 'page' && o.sourceId === 'k' && o.alive !== false && (o.values?.['k-project'] ?? []).includes('alpha')).length;
  await page.locator('.page-tabs .page-tab', { hasText: '콘텐츠' }).click(); await page.waitForTimeout(300);
  const back = await page.evaluate(() => document.querySelector('.page-content-tab')?.hidden === false);
  ok('탭 구조 + "할 일 · 표"(관련 항목만) → 알파에 [콘텐츠 · 할 일] 탭, 할 일 탭엔 "알파 일"만, 거기서 만든 행도 알파에 연결, 콘텐츠로 돌아옴',
    saved.structure === 'tabs' && saved.tabs?.[0]?.relationPropertyId === 'k-project' && choice.includes('관련 항목만') && tabs.join('|') === '콘텐츠|할 일' && rows.includes('알파 일') && !rows.includes('베타 일') && editorHidden && related === 2 && back,
    `choice=${choice} saved=${JSON.stringify(saved.tabs)} tabs=${tabs} rows=${rows} hidden=${editorHidden} related=${related} back=${back}`);
}

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
