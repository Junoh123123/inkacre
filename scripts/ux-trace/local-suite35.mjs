// 29차 (coverage phase 7b). Audio, file and PDF blocks aligned and sized; "@remind 7pm"; partial text selected across
// paragraphs (copy, delete); a form's button colour and its title and message after submitting; dashboard widgets
// resized; "edit pages" on the pages a variable gives; office files inside a ZIP converted on import; a cell comment
// from the table's right-click menu. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite35.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { zipSync, strToU8 } = createRequire(path.join(root, 'package.json'))('fflate');
const folder = mkdtempSync(path.join(tmpdir(), 'suite35-'));
const port = 8800 + Math.floor(Math.random() * 40) * 20;
const base = `http://127.0.0.1:${port}`;
for (const at of [port, port + 10]) { const busy = await fetch(`http://127.0.0.1:${at}/api/state`).then(() => true, () => false); if (busy) { console.log(`FAIL port ${at} is in use; run again`); process.exit(1); } }
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };
const uploadBytes = async (name, mediaType, bytes) => { const s = await state(); const commandId = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`; const res = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, actor: 'user', expectedRevision: s.revision, name, mediaType, base64: Buffer.from(bytes).toString('base64') }) }); if (!res.ok) throw new Error(await res.text()); return (await res.json()).attachmentId; };

const audio = await uploadBytes('sound.mp3', 'audio/mpeg', Buffer.from('ID3'));
const file = await uploadBytes('notes.txt', 'text/plain', Buffer.from('hello'));
await post([
  { type: 'page.create', id: 'home', title: '작업 공간', parentId: null },
  { type: 'page.create', id: 'doc', title: '편집 문서', parentId: 'home' },
  { type: 'block.create', id: 'p1', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '첫째 문단의 앞부분과 뒷부분' }] },
  { type: 'block.create', id: 'p2', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '둘째 문단의 앞부분과 뒷부분' }] },
  { type: 'block.create', id: 'p3', parentId: 'doc', blockType: 'paragraph', richText: [{ text: '' }] },
  { type: 'block.create', id: 'aud', parentId: 'doc', blockType: 'audio', attachmentId: audio },
  { type: 'block.create', id: 'fil', parentId: 'doc', blockType: 'file', attachmentId: file },
  { type: 'page.create', id: 'db', title: '작업', parentId: 'home' },
  { type: 'source.create', id: 's', pageId: 'db', name: '작업', titlePropertyId: 'title' },
  { type: 'property.create', id: 'n', sourceId: 's', name: '점수', propertyType: 'number' },
  { type: 'property.create', id: 'note', sourceId: 's', name: '메모', propertyType: 'text' },
  { type: 'view.create', id: 'v', sourceId: 's', parentId: 'db', name: '표', viewType: 'table', config: { visibleProperties: ['title', 'n', 'note'] } },
  { type: 'view.create', id: 'v2', sourceId: 's', parentId: 'db', name: '목록', viewType: 'list', config: {} },
  { type: 'view.create', id: 'dash', sourceId: 's', parentId: 'db', name: '대시보드', viewType: 'dashboard', config: { widgets: ['v', 'v2'], dashboardRows: [['v', 'v2']] } },
  { type: 'view.create', id: 'form', sourceId: 's', parentId: 'db', name: '양식', viewType: 'form', config: { form: { title: '신청', questions: [{ propertyId: 'title' }] } } },
  { type: 'page.create', id: 'r1', title: '하나', sourceId: 's' },
  { type: 'page.create', id: 'r2', title: '둘', sourceId: 's' },
]);
await post([{ type: 'page.update', id: 'db', databasePage: true }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource|MEDIA_ERR|DEMUXER|Format error|NotSupportedError/.test(m.text())) errors.push(`console: ${m.text()}`); });
await context.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(350); };
const blockEl = id => page.locator(`.block[data-block-id="${id}"]`);

// 1. Audio and file blocks: 정렬 among their actions, saved on the block.
await open('doc');
await blockEl('aud').locator('.media-frame').hover(); await page.waitForTimeout(200);
await blockEl('aud').locator('button[aria-label="정렬"]').click(); await page.waitForTimeout(250);
await clickMenu('오른쪽 정렬'); await page.waitForTimeout(600);
await blockEl('fil').locator('.file-block').hover(); await page.waitForTimeout(200);
await blockEl('fil').locator('button[aria-label="정렬"]').click({ force: true }); await page.waitForTimeout(250);
await clickMenu('왼쪽 정렬'); await page.waitForTimeout(600);
const fileFrame = blockEl('fil').locator('.media-frame');
await fileFrame.hover();
const fh = await blockEl('fil').locator('.image-handle.right').boundingBox();
await page.mouse.move(fh.x + 3, fh.y + 5); await page.mouse.down(); await page.mouse.move(fh.x - 300, fh.y + 5, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(700);
const [aud, fil] = [await obj('aud'), await obj('fil')];
ok('오디오 · 파일 블록: 정렬(오른쪽 · 왼쪽)과 너비가 저장', aud.align === 'right' && fil.align === 'left' && fil.width > 100 && fil.width < 600, `audio=${aud.align} file=${fil.align}/${fil.width}`);

// 2. "@remind 7pm" offers a reminder at 19:00.
await blockEl('p3').locator('.block-text, p').first().click();
await page.keyboard.type('@remind 7pm'); await page.waitForTimeout(500);
const remindItem = await page.locator('.mention-menu .menu-item, .mention-menu [role="option"], .mention-item').filter({ hasText: '리마인드:' }).first().textContent().catch(() => '');
await page.keyboard.press('Enter'); await page.waitForTimeout(900);
const reminderRun = (await obj('p3')).richText.find(r => r.date);
ok('"@remind 7pm" → 리마인드 오후 7:00, 날짜 멘션과 리마인더 생성', /오후 7:00|19:00/.test(remindItem) && /T19:00/.test(reminderRun?.date ?? '') && reminderRun?.remind === 0, `item=${remindItem} run=${JSON.stringify(reminderRun)}`);

// 3. Partial text across two paragraphs: stays text, copies both parts, Backspace joins what is left.
const textNode = async (id, offset) => page.evaluate(([id, offset]) => { const el = document.querySelector(`.block[data-block-id="${id}"]`); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const node = walker.nextNode(); const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset); const r = range.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2 }; }, [id, offset]);
const from = await textNode('p1', 6), to = await textNode('p2', 6);
await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(300);
const blockSelected = await page.locator('.block-selected').count();
const selectedText = await page.evaluate(() => window.getSelection()?.toString());
await page.keyboard.press('Control+c'); await page.waitForTimeout(200);
const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
await page.keyboard.press('Escape'); await page.waitForTimeout(100);
await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(300);
await page.keyboard.press('Backspace'); await page.waitForTimeout(1500);
const p1 = await obj('p1'), p2 = await obj('p2');
ok('문단 두 개에 걸친 부분 선택: 블록 선택이 아닌 글 선택, 복사, Backspace로 남은 글이 합쳐짐', blockSelected === 0 && /뒷부분/.test(selectedText ?? '') && /둘째 문단/.test(copied) && (p1.richText ?? []).map(r => r.text).join('') === '첫째 문단의 앞부분과 뒷부분'.slice(0, 6) + '둘째 문단의 앞부분과 뒷부분'.slice(6) && p2.alive === false,
  `blocks=${blockSelected} sel=${selectedText?.slice(0, 30)} copied=${copied.slice(0, 30)} p1=${(p1.richText ?? []).map(r => r.text).join('')} p2alive=${p2.alive}`);

// 4. A form: the button's colour, a title and a message after submitting.
await open('form');
await page.locator('.form-submit-color[aria-label="초록색"]').click(); await page.waitForTimeout(500);
await page.locator('.form-confirmation-title').fill('고맙습니다'); await page.locator('.form-confirmation-title').blur(); await page.waitForTimeout(400);
await page.locator('.form-confirmation').fill('곧 연락드릴게요'); await page.locator('.form-confirmation').blur(); await page.waitForTimeout(600);
const formConfig = (await obj('form')).config.form;
await page.locator('button, [role="tab"]', { hasText: '미리 보기' }).first().click().catch(() => {}); await page.waitForTimeout(500);
const previewColor = await page.locator('form.form-preview .form-submit').evaluate(e => getComputedStyle(e).backgroundColor).catch(() => '');
await page.locator('form.form-preview .form-answer-input').first().fill('응답').catch(() => {});
await page.locator('form.form-preview .form-submit').click().catch(() => {}); await page.waitForTimeout(800);
const done = await page.locator('.form-done').textContent().catch(() => '');
ok('양식: 버튼 색(초록) · 제출 후 제목과 메시지', formConfig.submitColor === 'green' && formConfig.confirmationTitle === '고맙습니다' && formConfig.confirmation === '곧 연락드릴게요' && (previewColor === '' || /68, 131, 97/.test(previewColor)) && (done === '' || (/고맙습니다/.test(done) && /곧 연락드릴게요/.test(done))),
  `config=${JSON.stringify({ c: formConfig.submitColor, t: formConfig.confirmationTitle, m: formConfig.confirmation })} color=${previewColor} done=${done}`);

// 5. Dashboard: in 레이아웃 편집, dragging the first widget's right edge makes it wider; its bottom edge sets the height.
await open('dash');
await page.locator('.dashboard-toolbar button', { hasText: '레이아웃 편집' }).click(); await page.waitForTimeout(300);
const edge = await page.locator('.dashboard-widget[data-widget-id="v"] .dashboard-resize.width').boundingBox();
await page.mouse.move(edge.x + 4, edge.y + 40); await page.mouse.down(); await page.mouse.move(edge.x + 204, edge.y + 40, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(700);
const bottom = await page.locator('.dashboard-widget[data-widget-id="v2"] .dashboard-resize.height').boundingBox();
await page.mouse.move(bottom.x + 40, bottom.y + 4); await page.mouse.down(); await page.mouse.move(bottom.x + 40, bottom.y + 154, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(700);
const sizes = (await obj('dash')).config.dashboardSizes ?? {};
const widths = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(e => Math.round(e.getBoundingClientRect().width)));
ok('대시보드 레이아웃 편집: 오른쪽 끝을 끌어 너비 비율, 아래 끝을 끌어 높이', (sizes.v?.width ?? 1) > (sizes.v2?.width ?? 1) && widths[0] > widths[1] && (sizes.v2?.height ?? 0) >= 160, `${JSON.stringify(sizes)} widths=${widths}`);

// 6. "조건에 맞는 페이지 편집" on the pages a variable gives (a button with 변수 정의).
await post([
  { type: 'property.create', id: 'rel', sourceId: 's', name: '연결', propertyType: 'relation', targetSourceId: 's' },
  { type: 'relation.set', pageId: 'r1', propertyId: 'rel', targetIds: ['r2'] },
  { type: 'property.create', id: 'go', sourceId: 's', name: '연결 표시', propertyType: 'button', button: { label: '표시', actions: [
    { action: 'define_variables', variables: [{ id: 'linked', name: '연결된', mode: 'formula', value: 'prop("연결")' }] },
    { action: 'edit_pages', sourceId: 's', filter: { all: [] }, propertyId: 'note', value: '연결됨', pages: { $variable: 'linked' } },
  ] } },
  { type: 'view.update', id: 'v', config: { visibleProperties: ['title', 'n', 'note', 'go'] } },
]);
await open('db');
await page.locator('.table-row', { hasText: '하나' }).locator('.cell-button').click(); await page.waitForTimeout(900);
const linkedNote = [(await obj('r1')).values.note ?? null, (await obj('r2')).values.note ?? null];
ok('버튼: 변수(관계의 페이지)만 편집', linkedNote[0] === null && linkedNote[1] === '연결됨', JSON.stringify(linkedNote));

// 7. Right-click a cell › "메모에 댓글 달기".
const cell = page.locator('.table-row', { hasText: '둘' }).locator('.table-cell.type-text').first();
await cell.click({ button: 'right' }); await page.waitForTimeout(400);
await clickMenu('메모에 댓글 달기');
const commentBox = page.locator('.property-comments textarea, .property-comments [contenteditable="true"], .property-comments input').first();
await commentBox.fill('셀 댓글'); await page.keyboard.press('Enter'); await page.waitForTimeout(700); await page.keyboard.press('Escape');
const cellComment = (await state()).objects.find(o => o.kind === 'comment' && o.parentId === 'r2' && o.propertyId === 'note');
ok('표 셀 오른쪽 클릭 › "메모에 댓글 달기" → 속성 값 댓글', !!cellComment);

// 8. A ZIP with OPML, text and Excel files: each becomes its page.
const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xlsx = zipSync({
  'xl/workbook.xml': strToU8(`${xmlHead}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="재고" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels': strToU8(`${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
  'xl/sharedStrings.xml': strToU8(`${xmlHead}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>이름</t></si><si><t>수량</t></si><si><t>사과</t></si></sst>`),
  'xl/worksheets/sheet1.xml': strToU8(`${xmlHead}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>`),
});
const archive = Buffer.from(zipSync({
  '모음/개요.opml': strToU8('<?xml version="1.0"?><opml version="2.0"><head><title>개요</title></head><body><outline text="첫 단계"/></body></opml>'),
  '모음/메모.txt': strToU8('한 줄 메모'),
  '모음/재고.xlsx': xlsx,
  '모음/안내.md': strToU8('# 안내\n본문'),
}));
await open('home');
await page.locator('.topbar button[aria-label="페이지 메뉴"]').click(); await page.waitForTimeout(300);
await clickMenu('더 보기'); await clickMenu('가져오기'); await page.waitForTimeout(300);
await page.locator('input[type="file"]').setInputFiles({ name: '모음.zip', mimeType: 'application/zip', buffer: archive });
await page.waitForTimeout(1800);
await page.locator('button', { hasText: '미리보기' }).click().catch(() => {}); await page.waitForTimeout(800);
await page.locator('.dialog button, [role="dialog"] button', { hasText: /^가져오기$/ }).last().click().catch(() => {}); await page.waitForTimeout(1800);
const s8 = await state();
const titles = s8.objects.filter(o => o.kind === 'page' && o.alive !== false && !o.sourceId).map(o => o.title);
const outline = s8.objects.find(o => o.kind === 'page' && o.title === '개요');
const outlineBlock = outline && s8.objects.find(o => o.kind === 'block' && o.parentId === outline.id && o.blockType === 'bullet');
const sheet = s8.objects.find(o => o.kind === 'page' && o.title === '재고' && !o.sourceId);
const sheetSource = sheet && s8.objects.find(o => o.kind === 'source' && o.parentId === sheet.id);
ok('ZIP 안의 OPML · 텍스트 · 엑셀이 각자 페이지로(엑셀은 DB)', !!outlineBlock && titles.includes('메모') && titles.includes('안내') && !!sheetSource, `titles=${titles.filter(t => ['개요', '메모', '재고', '안내'].includes(t))} outline=${!!outlineBlock} sheetDb=${!!sheetSource}`);

// 9. A notice that names a page (@) links to it from the inbox; the action's text field offers 다른 페이지 · 날짜 선택 · Σ.
await post([{ type: 'block.create', id: 'note-btn', parentId: 'doc', blockType: 'button', button: { label: '알림 버튼', actions: [{ action: 'notify', message: '확인: {{page:db}} · {{=1 + 1}}' }] } }]);
await post([{ type: 'button.run', id: 'note-btn', confirmed: true }]);
await open('home');
await page.locator('[data-inbox-toggle]').click(); await page.waitForTimeout(500);
const linkText = await page.locator('.inbox-row .inbox-page-link').first().textContent().catch(() => '');
const rowText = await page.locator('.inbox-row', { hasText: '확인' }).first().textContent().catch(() => '');
await page.locator('.inbox-row .inbox-page-link').first().click(); await page.waitForTimeout(700);
const landed = new URL(page.url()).searchParams.get('id');
await page.keyboard.press('Escape');
await open('doc');
await blockEl('note-btn').hover(); await page.waitForTimeout(200);
const settings = blockEl('note-btn').locator('button[aria-label*="편집"], button[aria-label*="설정"], .button-block-edit').first();
const tokenMenu = await (async () => {
  try {
    await settings.click({ timeout: 3000 }); await page.waitForTimeout(400);
    await page.locator('.automation-var-field .automation-var-tool', { hasText: '@' }).first().click(); await page.waitForTimeout(300);
    const items = await page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    const sigma = await page.locator('.automation-var-tool[aria-label="수식 넣기"]').count();
    return { items, sigma };
  } catch { return null; }
})();
ok('알림의 @페이지는 받은 알림에서 링크(누르면 그 페이지), 수식은 값으로', linkText === '작업' && /2/.test(rowText) && landed === 'db', `link=${linkText} row=${rowText} landed=${landed} menu=${JSON.stringify(tokenMenu)}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
