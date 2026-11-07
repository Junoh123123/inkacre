// 25차 (coverage phase 4: editor and media). Pictures: place, size, crop and mask, link, alt text, full screen; PDF
// pages; embeds; link-to-page blocks (and their sidebar rows); a pasted address as a mention or an embed; date
// mentions with a reminder; custom emoji (settings, then :name: in text); table cell fill, colour and merge; text
// direction; ⌘-click block selection; the comments pane with replies; synced copies edited in place and unsynced;
// callout boxes around nested blocks. Starts its own server.
// 사용법: node scripts/ux-trace/local-suite31.mjs   (PASS/FAIL 출력)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const folder = mkdtempSync(path.join(tmpdir(), 'suite31-'));
const port = 6200 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'bin/cli.mjs'), '--data', folder, '--port', String(port), '--no-open'], { stdio: 'ignore' });
for (let tries = 0; tries < 50; tries++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
const state = async () => (await fetch(`${base}/api/state`)).json();
const obj = async id => (await state()).objects.find(o => o.id === id);
const post = async (ops, actor = 'user') => { const s = await state(); const res = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `c-${Date.now()}-${Math.random()}`, actor, expectedRevision: s.revision, operations: ops }) }); if (!res.ok) throw new Error(await res.text()); return res.json(); };
const attach = async (name, mediaType, bytes) => { const s = await state(); const res = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: `a-${Math.random()}`, actor: 'test', expectedRevision: s.revision, name, mediaType, base64: bytes.toString('base64') }) }); if (!res.ok) throw new Error(await res.text()); return (await res.json()).attachmentId; };

// A plain picture (one colour) and a two-page PDF, made here.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
function png(width, height, [r, g, b]) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
function pdf() {
  const content = 'BT /F1 24 Tf 40 100 Td (Pageyard PDF) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let text = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((body, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}
const picture = await attach('blue.png', 'image/png', png(400, 200, [40, 90, 200]));
const document = await attach('two-pages.pdf', 'application/pdf', pdf());

await post([
  { type: 'page.create', id: 'media', title: '미디어 시험', parentId: null },
  { type: 'block.create', id: 'img', parentId: 'media', blockType: 'image', attachmentId: picture, richText: [] },
  { type: 'block.create', id: 'pdf', parentId: 'media', blockType: 'pdf', attachmentId: document, richText: [] },
  { type: 'block.create', id: 'emb', parentId: 'media', blockType: 'embed', url: 'https://example.com/map', richText: [] },
  { type: 'block.create', id: 'para', parentId: 'media', blockType: 'paragraph', richText: [{ text: '댓글이 달린 문단' }] },
  { type: 'block.create', id: 'paste-empty', parentId: 'media', blockType: 'paragraph', richText: [] },
  { type: 'block.create', id: 'paste-text', parentId: 'media', blockType: 'paragraph', richText: [{ text: '참고 ' }] },
  { type: 'block.create', id: 'date-para', parentId: 'media', blockType: 'paragraph', richText: [] },
  { type: 'block.create', id: 'emoji-para', parentId: 'media', blockType: 'paragraph', richText: [] },
  { type: 'block.create', id: 'tbl', parentId: 'media', blockType: 'table', cells: [[[{ text: 'a' }], [{ text: 'b' }]], [[{ text: 'c' }], [{ text: 'd' }]]] },
  { type: 'block.create', id: 'arabic', parentId: 'media', blockType: 'paragraph', richText: [{ text: 'مرحبا بالعالم' }] },
  { type: 'block.create', id: 'call', parentId: 'media', blockType: 'callout', icon: '💡', color: 'blue_background', richText: [{ text: '알림 상자' }] },
  { type: 'block.create', id: 'call-1', parentId: 'call', blockType: 'paragraph', richText: [{ text: '상자 안 문단' }] },
  { type: 'block.create', id: 'slash', parentId: 'media', blockType: 'paragraph', richText: [] },
  { type: 'page.create', id: 'target', title: '대상 페이지', parentId: null },
  { type: 'comment.create', id: 'c1', parentId: 'para', richText: [{ text: '이 문단 확인' }] },
  { type: 'comment.create', id: 'c2', parentId: 'para', threadId: 'c1', richText: [{ text: '확인했어요' }] },
  { type: 'comment.create', id: 'c3', parentId: 'media', richText: [{ text: '끝난 논의' }] },
  { type: 'page.create', id: 'origin', title: '원본 페이지', parentId: null },
  { type: 'block.create', id: 'sync', parentId: 'origin', blockType: 'synced', richText: [] },
  { type: 'block.create', id: 's1', parentId: 'sync', blockType: 'paragraph', richText: [{ text: '공유 내용' }] },
  { type: 'page.create', id: 'copy', title: '사본 페이지', parentId: null },
  { type: 'block.create', id: 'ref', parentId: 'copy', blockType: 'synced_reference', sourceBlockId: 'sync', richText: [] },
  { type: 'block.create', id: 'copy-after', parentId: 'copy', blockType: 'paragraph', richText: [{ text: '사본 뒤 문단' }] },
]);
await post([{ type: 'comment.update', id: 'c3', resolved: true }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|net::|Failed to load resource|bookmark-preview|BOOKMARK|PUBLIC/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => { try { localStorage.setItem('pageyard-welcomed', 'true'); } catch {} });
const open = async id => { await page.goto(`${base}/?id=${encodeURIComponent(id)}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.menu-item .menu-item-label')].map(e => e.textContent));
const clickMenu = async label => { await page.locator('.menu-item', { hasText: label }).first().click(); await page.waitForTimeout(300); };
const blockText = id => page.locator(`.block[data-block-id="${id}"] .block-text`).first();
const caretEnd = async id => { await blockText(id).click(); await page.keyboard.press('End'); await page.waitForTimeout(150); };
const paste = text => page.evaluate(value => { const data = new DataTransfer(); data.setData('text/plain', value); document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, text);

// 1. A picture: 정렬 › 왼쪽, then the side handle makes it narrower.
await open('media');
const figure = page.locator('.block[data-block-id="img"] .image-frame').first();
await figure.hover(); await page.waitForTimeout(200);
await page.locator('.block[data-block-id="img"] .media-action[aria-label="정렬"]').click(); await page.waitForTimeout(250);
const alignItems = await menuItems();
await clickMenu('왼쪽 정렬'); await page.waitForTimeout(500);
const before = await figure.boundingBox();
await figure.hover(); await page.waitForTimeout(150);
const handle = await page.locator('.block[data-block-id="img"] .image-handle.right').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
await page.mouse.move(handle.x - 50, handle.y + handle.height / 2, { steps: 4 }); await page.mouse.move(handle.x - 100, handle.y + handle.height / 2, { steps: 4 });
await page.mouse.up(); await page.waitForTimeout(700);
const sized = await obj('img');
ok('이미지 정렬 메뉴 · 왼쪽 정렬, 옆 손잡이로 폭 줄이기', alignItems.join(',') === '왼쪽 정렬,가운데 정렬,오른쪽 정렬' && sized.align === 'left' && Math.abs(sized.width - (before.width - 100)) <= 6, `items=${alignItems} align=${sized.align} width=${sized.width} before=${before.width}`);

// 2. 자르기: the corner handle crops, a mask shape, 적용.
await figure.hover(); await page.waitForTimeout(150);
await page.locator('.block[data-block-id="img"] .media-action[aria-label="자르기"]').click(); await page.waitForTimeout(400);
const box = await page.locator('.crop-box').boundingBox(), corner = await page.locator('.crop-handle.h-se').boundingBox();
await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
await page.mouse.move(corner.x - box.width * 0.2, corner.y - box.height * 0.2, { steps: 3 }); await page.mouse.move(corner.x - box.width * 0.4, corner.y - box.height * 0.4, { steps: 3 }); await page.mouse.up();
const masks = await page.evaluate(() => [...document.querySelectorAll('.crop-mask')].map(e => e.textContent));
await page.getByRole('radio', { name: '원', exact: true }).click(); await page.waitForTimeout(150);
await page.getByRole('button', { name: '적용', exact: true }).click(); await page.waitForTimeout(700);
const cropped = await obj('img');
const masked = await page.evaluate(() => getComputedStyle(document.querySelector('.block[data-block-id="img"] .image-crop') ?? document.body).clipPath);
ok('이미지 자르기 · 마스크(원) → 저장되고 그림에 적용', cropped.mask === 'circle' && cropped.crop && Math.abs(cropped.crop.w - 0.6) < 0.05 && Math.abs(cropped.crop.h - 0.6) < 0.05 && masks.length === 7 && /circle|ellipse/.test(masked), `crop=${JSON.stringify(cropped.crop)} mask=${cropped.mask} masks=${masks} clip=${masked}`);

// 3. 링크 › 페이지에 링크… and 대체 텍스트; 전체 화면.
await figure.hover(); await page.waitForTimeout(150);
await page.locator('.block[data-block-id="img"] .media-action[aria-label="링크"]').click(); await page.waitForTimeout(300);
await page.getByRole('button', { name: '페이지에 링크…' }).click(); await page.waitForTimeout(400);
await page.keyboard.type('대상 페이지'); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
const badge = await page.locator('.block[data-block-id="img"] .image-link-badge').textContent().catch(() => '');
await figure.hover(); await page.waitForTimeout(150);
await page.locator('.block[data-block-id="img"] .media-action[aria-label="대체 텍스트"]').click(); await page.waitForTimeout(300);
await page.locator('.alt-input').fill('파란 사각형'); await page.getByRole('button', { name: '저장', exact: true }).click(); await page.waitForTimeout(600);
const described = await obj('img');
const altAttr = await page.locator('.block[data-block-id="img"] .image-crop img').getAttribute('alt');
await figure.hover(); await page.waitForTimeout(150);
await page.locator('.block[data-block-id="img"] .media-action[aria-label="전체 화면"]').click(); await page.waitForTimeout(300);
const lightbox = await page.locator('.lightbox img.lightbox-image').count();
await page.locator('.lightbox-button[aria-label="닫기"]').click(); await page.waitForTimeout(200);
ok('이미지 링크(페이지) · 대체 텍스트 · 전체 화면', described.href === '?id=target' && badge.includes('대상 페이지') && described.alt === '파란 사각형' && altAttr === '파란 사각형' && lightbox === 1 && !(await page.locator('.lightbox').count()), `href=${described.href} badge=${badge} alt=${described.alt}/${altAttr} lightbox=${lightbox}`);

// 4. PDF pages drawn in place; the embed's frame.
await page.locator('.block[data-block-id="pdf"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
const pdfInfo = await page.evaluate(() => ({ count: document.querySelector('.pdf-count')?.textContent, canvases: [...document.querySelectorAll('.pdf-pages canvas')].filter(c => c.width > 0).length, name: document.querySelector('.pdf-name')?.textContent }));
const frame = await page.locator('.block[data-block-id="emb"] iframe.html-frame').getAttribute('src').catch(() => null);
ok('PDF 블록: 쪽 수와 페이지 그림, 임베드 블록의 iframe', pdfInfo.count === '2쪽' && pdfInfo.canvases >= 1 && pdfInfo.name === 'two-pages.pdf' && frame === 'https://example.com/map', `pdf=${JSON.stringify(pdfInfo)} frame=${frame}`);

// 5. A pasted address: the menu, then 임베드 on an empty line; 멘션 inside text.
await blockText('paste-empty').click(); await page.waitForTimeout(150);
await paste('https://example.org/page'); await page.waitForTimeout(400);
const pasteItems = await menuItems();
await clickMenu('임베드'); await page.waitForTimeout(900);
const pastedEmbed = await obj('paste-empty');
await caretEnd('paste-text');
await paste('https://example.net/doc'); await page.waitForTimeout(400);
await clickMenu('멘션'); await page.waitForTimeout(2500);
const mentionRun = (await obj('paste-text')).richText.find(run => run.mention);
const mentionDom = await page.locator('.block[data-block-id="paste-text"] .link-mention').count();
ok('주소 붙여넣기 → 링크로 두기 · 멘션 · 북마크 · 임베드, 빈 줄은 임베드로, 글 안은 링크 멘션으로', pasteItems.join(',') === '링크로 두기,멘션,북마크,임베드' && pastedEmbed.blockType === 'embed' && pastedEmbed.url === 'https://example.org/page' && mentionRun?.href === 'https://example.net/doc' && mentionDom === 1, `items=${pasteItems} embed=${pastedEmbed.blockType}/${pastedEmbed.url} mention=${JSON.stringify(mentionRun)} dom=${mentionDom}`);

// 6. A date mention: @내일, then its editor sets a reminder and the ISO format.
await blockText('date-para').click(); await page.waitForTimeout(150);
await page.keyboard.type('@내일'); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
await page.locator('.block[data-block-id="date-para"] .date-mention').click(); await page.waitForTimeout(400);
const editorOpen = await page.locator('.date-mention-editor').count();
const selects = page.locator('.date-mention-editor select');
await selects.nth(1).selectOption('10'); await page.waitForTimeout(300);
await selects.nth(0).selectOption('iso'); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
const dateRun = (await obj('date-para')).richText.find(run => run.date);
const reminder = dateRun?.reminderId ? await obj(dateRun.reminderId) : null;
const dateLabel = await page.locator('.block[data-block-id="date-para"] .date-mention').textContent();
ok('날짜 멘션 @내일 → 편집기에서 10분 전 리마인드 · YYYY-MM-DD 형식', editorOpen === 1 && dateRun?.remind === 10 && dateRun?.dateFormat === 'iso' && reminder?.alive === true && reminder?.kind === 'reminder' && /^⏰ \d{4}-\d{2}-\d{2}$/.test(dateLabel), `run=${JSON.stringify(dateRun)} reminder=${reminder?.kind}/${reminder?.alive} label=${dateLabel}`);

// 7. Custom emoji: 설정 › 일반 › 사용자 지정 이모지, then :party in the text.
await page.locator('.workspace-switcher').click(); await page.waitForTimeout(200); await clickMenu('설정'); await page.waitForTimeout(400);
await page.locator('.prefs-nav-item', { hasText: '일반' }).click(); await page.waitForTimeout(300);
await page.locator('.custom-emoji-add input.prefs-input').fill('party');
await page.setInputFiles('.custom-emoji-add input[type="file"]', { name: 'party.png', mimeType: 'image/png', buffer: png(32, 32, [230, 80, 120]) }); await page.waitForTimeout(1000);
const emojiRows = await page.locator('.custom-emoji-row').count();
const stored = (await obj('workspace-emoji'))?.emoji ?? {};
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await blockText('emoji-para').click(); await page.waitForTimeout(150);
await page.keyboard.type(':party'); await page.waitForTimeout(500);
const customGroup = await page.evaluate(() => document.querySelector('.emoji-inline .emoji-group-head')?.textContent);
await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
const emojiRun = (await obj('emoji-para')).richText.find(run => run.customEmoji);
const emojiImg = await page.locator('.block[data-block-id="emoji-para"] img.custom-emoji').count();
ok('사용자 지정 이모지 추가 → :party 로 글에 넣기', emojiRows === 1 && !!stored.party && customGroup === '사용자 지정' && emojiRun?.customEmoji === stored.party && emojiImg === 1, `rows=${emojiRows} stored=${JSON.stringify(stored)} group=${customGroup} run=${JSON.stringify(emojiRun)} img=${emojiImg}`);

// 8. Table cells: ⌘D fills from above, 셀 색, 오른쪽 셀과 병합.
const cells = page.locator('.block[data-block-id="tbl"] .simple-table-text');
await cells.nth(3).click(); await page.keyboard.press('Control+d'); await page.waitForTimeout(200);
await cells.nth(0).click(); await page.waitForTimeout(600);
await cells.nth(1).click({ button: 'right' }); await page.waitForTimeout(300);
const cellItems = await menuItems();
await page.locator('.menu-item', { hasText: '셀 색' }).first().hover(); await page.waitForTimeout(400);
await clickMenu('빨간색 배경'); await page.waitForTimeout(600);
await cells.nth(2).click({ button: 'right' }); await page.waitForTimeout(300);
await clickMenu('오른쪽 셀과 병합'); await page.waitForTimeout(700);
const table = await obj('tbl');
const spans = await page.evaluate(() => [...document.querySelectorAll('.block[data-block-id="tbl"] .simple-table-cell')].map(c => c.colSpan));
const redCell = await page.locator('.block[data-block-id="tbl"] .simple-table-cell.cell-bg-red').count();
ok('표 셀: ⌘D 위 칸 채우기 · 셀 색 · 오른쪽 셀과 병합', table.cells[1][1][0]?.text === 'b' && table.cellColors?.['0:1'] === 'red_background' && redCell === 1 && JSON.stringify(table.merges) === JSON.stringify([{ row: 1, column: 0, rows: 1, columns: 2 }]) && spans.join(',') === '1,1,2' && cellItems.includes('셀 내용 지우기'), `d=${JSON.stringify(table.cells[1][1])} colors=${JSON.stringify(table.cellColors)} merges=${JSON.stringify(table.merges)} spans=${spans} items=${cellItems}`);

// 9. 텍스트 방향 › 오른쪽에서 왼쪽 from the block menu.
await page.locator('.block[data-block-id="arabic"]').hover(); await page.waitForTimeout(250);
await page.locator('.block-drag-handle').click(); await page.waitForTimeout(350);
await page.locator('.menu-item', { hasText: '텍스트 방향' }).first().hover(); await page.waitForTimeout(400);
const directionItems = await menuItems();
await clickMenu('오른쪽에서 왼쪽'); await page.waitForTimeout(800);
const dir = await page.evaluate(() => document.querySelector('.block[data-block-id="arabic"] .block-text')?.getAttribute('dir'));
ok('블록 메뉴 › 텍스트 방향 › 오른쪽에서 왼쪽', (await obj('arabic')).direction === 'rtl' && dir === 'rtl' && directionItems.includes('자동 (글자에 따라)'), `direction=${(await obj('arabic')).direction} dir=${dir} items=${directionItems.slice(-3)}`);

// 10. ⌘-click adds a block to the block selection.
const selectedFirst = await page.locator('.block-selected').count();
await blockText('para').click({ modifiers: ['Control'] }); await page.waitForTimeout(300);
const selectedIds = await page.evaluate(() => [...document.querySelectorAll('.block-selected')].map(e => e.dataset.blockId));
ok('블록 선택 중 ⌘-클릭으로 다른 블록 추가', selectedFirst === 1 && selectedIds.length === 2 && selectedIds.includes('arabic') && selectedIds.includes('para'), `first=${selectedFirst} ids=${selectedIds}`);
await page.mouse.click(5, 450); await page.waitForTimeout(200);

// 11. Callout box: the callout and its nested paragraph read as one box.
const callout = await page.evaluate(() => ({ open: !!document.querySelector('.block[data-block-id="call"].callout-open'), inside: !!document.querySelector('.block[data-block-id="call-1"].in-callout.callout-last') }));
ok('콜아웃 안 블록이 한 상자로 묶임', callout.open && callout.inside, JSON.stringify(callout));

// 12. The comments pane: open threads, the resolved filter, a reply.
await page.locator('.topbar-comments').click(); await page.waitForTimeout(500);
const openThreads = await page.evaluate(() => [...document.querySelectorAll('.comments-thread')].map(e => e.querySelectorAll('.comments-item').length));
await page.locator('.comments-pane-filters button', { hasText: '해결된 댓글' }).click(); await page.waitForTimeout(250);
const resolved = await page.evaluate(() => [...document.querySelectorAll('.comments-thread .comment-text')].map(e => e.textContent));
await page.locator('.comments-pane-filters button', { hasText: '열린 댓글' }).click(); await page.waitForTimeout(250);
await page.locator('.comments-thread .comments-thread-actions button', { hasText: '답글' }).first().click(); await page.waitForTimeout(200);
await page.keyboard.type('세 번째 답'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
const replies = (await state()).objects.filter(o => o.kind === 'comment' && o.threadId === 'c1' && o.alive !== false).map(o => o.richText[0]?.text);
const shown = await page.evaluate(() => document.querySelector('.comments-thread')?.querySelectorAll('.comments-item').length);
ok('댓글 창: 열린 스레드(답글 포함) · 해결된 댓글 · 창에서 답글', openThreads.join(',') === '2' && resolved.join(',') === '끝난 논의' && replies.join(',') === '확인했어요,세 번째 답' && shown === 3, `open=${openThreads} resolved=${resolved} replies=${replies} shown=${shown}`);
await page.keyboard.press('Escape');

// 13. A synced copy: 여기서 편집 changes the original; 동기화 해제 leaves ordinary blocks.
await open('copy');
const headerButtons = await page.evaluate(() => [...document.querySelectorAll('.synced-reference .synced-header button')].map(e => e.textContent));
await page.locator('.synced-reference .synced-header button', { hasText: '여기서 편집' }).click(); await page.waitForTimeout(800);
const editHost = page.locator('.synced-edit-host .ProseMirror .block-text', { hasText: '공유 내용' }).first();
await editHost.click(); await page.keyboard.press('End'); await page.keyboard.type(' 추가'); await page.waitForTimeout(1200);
const sourceText = (await obj('s1')).richText.map(r => r.text).join('');
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
if (await page.locator('.synced-edit-host').count()) { await page.locator('.dialog-header button[aria-label="닫기"]').last().click().catch(() => {}); await page.waitForTimeout(300); }
const mirrored = await page.locator('.synced-reference').textContent();
await page.locator('.synced-reference .synced-header button', { hasText: '동기화 해제' }).click(); await page.waitForTimeout(1000);
const copyBlocks = (await state()).objects.filter(o => o.kind === 'block' && o.parentId === 'copy' && o.alive).sort((a, b) => a.position - b.position).map(o => `${o.blockType}:${o.richText?.[0]?.text ?? ''}`);
ok('동기화 사본: 여기서 편집 → 원본 바뀜, 동기화 해제 → 일반 블록', headerButtons.join(',') === '여기서 편집,원본으로 이동,동기화 해제' && sourceText === '공유 내용 추가' && mirrored.includes('공유 내용 추가') && copyBlocks.join(',') === 'paragraph:공유 내용 추가,paragraph:사본 뒤 문단' && (await obj('ref')).alive === false, `buttons=${headerButtons} source=${sourceText} copy=${copyBlocks}`);

// 14. / 페이지 링크 makes a link-to-page block; it shows under its page in the sidebar. / 임베드 asks for an address.
await open('media');
await blockText('slash').click(); await page.waitForTimeout(150);
await page.keyboard.type('/페이지 링크'); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
await page.keyboard.type('대상 페이지'); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
const linkBlock = await obj('slash');
const linkDom = await page.locator('.block[data-block-id="slash"] .link-to-page .page-link-title').textContent().catch(() => '');
const mediaRow = page.locator('.sidebar-row[data-tree-id="media"]').first();
if ((await mediaRow.getAttribute('aria-expanded')) !== 'true') { await mediaRow.hover(); await mediaRow.locator('.sidebar-toggle').click(); await page.waitForTimeout(400); }
const sidebarLinked = await page.evaluate(() => [...document.querySelectorAll('.sidebar-linked-row .sidebar-row-label')].map(e => e.textContent));
await page.locator('.page-editor-tail').first().click(); await page.waitForTimeout(300);
await page.keyboard.type('/임베드'); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
await page.keyboard.type('https://example.com/board'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const embeds = (await state()).objects.filter(o => o.kind === 'block' && o.parentId === 'media' && o.alive && o.blockType === 'embed').map(o => o.url);
ok('/페이지 링크 → 페이지 링크 블록과 사이드바 줄, /임베드 → 주소 입력', linkBlock.blockType === 'link_to_page' && linkBlock.richText[0]?.pageId === 'target' && linkDom === '대상 페이지' && sidebarLinked.includes('대상 페이지') && embeds.includes('https://example.com/board'), `link=${linkBlock.blockType}/${linkBlock.richText[0]?.pageId} dom=${linkDom} sidebar=${sidebarLinked} embeds=${embeds}`);

ok('페이지 오류 없음', !errors.length, errors.slice(0, 3).join(' / '));
await browser.close();
server.kill();
await new Promise(resolve => setTimeout(resolve, 300));
rmSync(folder, { recursive: true, force: true });
