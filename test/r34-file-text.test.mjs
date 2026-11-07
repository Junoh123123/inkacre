import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { deflateSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import { Workspace } from '../src/workspace.mjs';
import { createLocalServer } from '../src/server.mjs';
import { extractFileText, decodeText, textKind } from '../src/file-text.mjs';
import { pdfText } from '../src/pdf-text.mjs';

// r34 (33차): 첨부 파일 내용 검색 — the text of attached PDFs, Office, OpenDocument, HWPX, HTML and text files, read in
// a worker into file-text.sqlite and found by search under the page that holds the file.
const fixture = name => readFileSync(new URL(`./fixtures/file-text/${name}`, import.meta.url));
const zip = files => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));

// A small PDF built by hand: a simple font with /Differences and kerning in TJ, and a Type0 font with a ToUnicode
// CMap (compressed), on two pages.
function handmadePdf({ truncateFlate = false } = {}) {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const stream = (dict, data, compress = false) => {
    let bytes = compress ? deflateSync(data) : Buffer.from(data, 'latin1');
    if (compress && truncateFlate) bytes = bytes.subarray(0, -4);
    return Buffer.concat([Buffer.from(`<< ${dict} /Length ${bytes.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'), bytes, Buffer.from('\nendstream', 'latin1')]);
  };
  const hex = text => Buffer.from(text, 'utf16le').swap16().toString('hex').toUpperCase();
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Test def
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0001> <${hex('첨')}> <0002> <${hex('부')}> endbfchar
1 beginbfrange <0010> <0012> <${hex('가')}> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /uni00E9 /Euro] >> >>');
  add('<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /ToUnicode 9 0 R /DescendantFonts [10 0 R] >>');
  add(stream('', 'BT /F1 12 Tf 14 TL 72 720 Td (Hello) Tj ( world) Tj 0 -14 Td [(Ker) 120 (ning) -900 (apart)] TJ T* (caf) Tj (A) Tj ET'));
  add(stream('', 'q 1 0 0 1 0 0 cm BT /F2 14 Tf 72 700 Td <00010002> Tj 0 -20 Td <001000110012> Tj ET Q', true));
  add(stream('', cmap, true));
  add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>');
  const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
  objects.forEach((body, i) => { offsets.push(parts.reduce((sum, part) => sum + part.length, 0)); parts.push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')); });
  const xref = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

test('PDF text: simple and CID fonts, ToUnicode and predefined CMaps, object streams, and files locked only against changes', () => {
  const expected = 'Hello world\nKerning apart\ncafé\n\n첨부\n가각갂';
  assert.equal(pdfText(handmadePdf()), expected);
  assert.equal(pdfText(handmadePdf({ truncateFlate: true })), expected, 'recover streams without their zlib checksum');
  const chromium = pdfText(fixture('chromium.pdf'));
  for (const line of ['견적서 Estimate', '프로젝트 예산은 삼천만 원이며 일정은 두 달입니다.', 'ligatures: office efficient.', '개발 2,000,000', '日本語の文章もあります。']) assert.ok(chromium.includes(line), line);
  // UniKS-UCS2-H (no ToUnicode), behind AES-256 and RC4-128 with an empty open password.
  for (const name of ['cid-aes256.pdf', 'cid-rc4.pdf']) {
    const text = pdfText(fixture(name));
    assert.ok(text.includes('분기 보고서 — 매출이 증가했습니다'), name);
    assert.ok(text.includes('Quarterly report: revenue grew 12% (Helvetica)'), name);
    assert.ok(/증가했습니다\n두 번째 줄의 한국어 문장\n\nSecond page/.test(text), 'pages apart by a blank line');
  }
  assert.equal(pdfText(fixture('ttf-aes128-objstm.pdf')), 'Embedded subset font: café naïve “quotes” — dash\nLine one of a text object\nLine two after T*');
  assert.throws(() => pdfText(fixture('cid-password.pdf')), error => error.code === 'PDF_ENCRYPTED');
  assert.throws(() => pdfText(Buffer.from('not a pdf')), error => error.code === 'PDF_FORMAT');
  assert.equal(pdfText(handmadePdf(), { limit: 8 }).length <= 8, true);
});

test('Office, OpenDocument, HWPX, HTML and text files: their words in reading order, tables as rows', () => {
  const docx = zip({
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>회의록</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">참석 </w:t></w:r><w:r><w:t>다섯 명</w:t></w:r><w:r><w:tab/><w:t>&amp; 손님</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>담당</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:body></w:document>',
    'word/footer1.xml': '<w:ftr><w:p><w:r><w:t>바닥글</w:t></w:r></w:p></w:ftr>',
  });
  assert.deepEqual(extractFileText(docx, { name: '회의.docx' }), { status: 'ok', text: '회의록\n참석 다섯 명\t& 손님\n항목\t담당\n\n바닥글' });
  const pptx = zip({
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>둘째 장</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>열째 장</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>첫 장</a:t></a:r><a:br/><a:r><a:t>둘째 줄</a:t></a:r></a:p></p:sld>',
    'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:r><a:t>메모</a:t></a:r></a:p></p:notes>',
  });
  assert.equal(extractFileText(pptx, { name: 'deck.pptx' }).text, '첫 장\n둘째 줄\n\n둘째 장\n\n열째 장\n\n메모');
  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="메모" sheetId="2" r:id="rId2"/><sheet name="예산 &amp; 비용" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="x"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>항목</t></si><si><r><t>서버</t></r><r><t> 비용</t></r><rPh><t>ルビ</t></rPh></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>금액</t></is></c></row><row r="2"/><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>120000</v></c><c r="C3"/></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c t="str"><f>A1</f><v>계산된 글</v></c></row></sheetData></worksheet>',
  });
  assert.equal(extractFileText(xlsx, { name: 'budget.xlsx' }).text, '메모\n계산된 글\n\n예산 & 비용\n항목\t금액\n서버 비용\t120000');
  const odt = zip({ 'content.xml': '<office:document-content><office:body><office:text><text:h>제목</text:h><text:p>본문<text:s text:c="2"/>띄움<text:tab/>탭<office:annotation><text:p>주석</text:p></office:annotation></text:p><table:table><table:table-row><table:table-cell><text:p>칸1</text:p></table:table-cell><table:table-cell><text:p>칸2</text:p></table:table-cell></table:table-row></table:table><text:p>쪽 <text:page-number>3</text:page-number></text:p></office:text></office:body></office:document-content>' });
  assert.equal(extractFileText(odt, { name: 'doc.odt' }).text, '제목\n본문  띄움\t탭\n칸1\t칸2\n쪽');
  const hwpx = zip({ 'Contents/section0.xml': '<hs:sec><hp:p><hp:run><hp:t>한글 문서</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>둘째</hp:t><hp:t><hp:tab/>문단</hp:t></hp:run></hp:p></hs:sec>', 'Contents/section1.xml': '<hs:sec><hp:p><hp:run><hp:t>다음 구역</hp:t></hp:run></hp:p></hs:sec>' });
  assert.equal(extractFileText(hwpx, { name: '보고.hwpx' }).text, '한글 문서\n둘째\t문단\n다음 구역');
  const html = Buffer.from('<html><head><style>p{}</style><script>var x = "숨김";</script></head><body><h1>제목 &amp; 부제</h1><p>첫&nbsp;문단<br>둘째 줄</p><table><tr><td>가</td><td>나</td></tr></table></body></html>');
  assert.equal(extractFileText(html, { name: 'page.html' }).text, '제목 & 부제\n첫 문단\n둘째 줄\n가\t나');
  // Text in any common encoding.
  assert.equal(extractFileText(Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0x41]), { name: 'memo.txt' }).text, '한글 A', 'EUC-KR');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('메모', 'utf16le')])), '메모');
  assert.equal(decodeText(Buffer.from('﻿첫 줄', 'utf8')), '첫 줄');
  assert.equal(extractFileText(Buffer.from('a,b\n1,2'), { name: 'data.csv' }).text, 'a,b\n1,2');
  // Nothing to read, and files that can't be read.
  assert.equal(textKind('photo.png', 'image/png'), null);
  assert.equal(extractFileText(Buffer.from('x'), { name: 'clip.mp4', mediaType: 'video/mp4' }).status, 'unsupported');
  assert.equal(extractFileText(fixture('cid-password.pdf'), { name: 'locked.pdf' }).status, 'encrypted');
  assert.equal(extractFileText(Buffer.from('broken'), { name: 'broken.docx' }).status, 'failed');
  assert.equal(textKind('보고서', 'application/pdf'), 'pdf');
  assert.equal(textKind('x.bin', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
});

function fixtureWorkspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-r34f-'));
  const w = new Workspace(directory); let i = 0;
  const apply = operations => w.execute({ id: `r34f-${++i}`, actor: 'user', expectedRevision: w.revision, operations });
  t.after(() => { w.close(); rmSync(directory, { recursive: true, force: true }); });
  const attach = (id, name, bytes, mediaType = 'application/octet-stream') => ({ type: 'attachment.register', id, name, mediaType, ...w.putBlob(bytes) });
  return { w, apply, attach, directory };
}
const settle = async index => { await new Promise(resolve => setTimeout(resolve, 30)); await index.idle(); };

test('the index reads new attachments in a worker; search finds a page by its files and says which file and where', async t => {
  const { w, apply, attach, directory } = fixtureWorkspace(t);
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>계약 기간은 2026년 12월까지이며 해지는 30일 전에 알린다.</w:t></w:r></w:p></w:body></w:document>' });
  apply([
    { type: 'page.create', id: 'docs', title: '자료실' },
    { type: 'page.create', id: 'other', title: '다른 페이지' },
    { type: 'block.create', id: 'toggle', parentId: 'docs', blockType: 'toggle', richText: [{ text: '계약서 묶음' }] },
    attach('contract', '계약서.docx', docx),
    { type: 'block.create', id: 'file-block', parentId: 'toggle', blockType: 'file', attachmentId: 'contract' },
    attach('estimate', '견적.pdf', fixture('chromium.pdf'), 'application/pdf'),
    { type: 'block.create', id: 'pdf-block', parentId: 'docs', blockType: 'pdf', attachmentId: 'estimate' },
    attach('photo', 'photo.png', Buffer.from('89504e47', 'hex'), 'image/png'),
    { type: 'block.create', id: 'img', parentId: 'other', blockType: 'image', attachmentId: 'photo' },
    attach('locked', '잠긴.pdf', fixture('cid-password.pdf'), 'application/pdf'),
    { type: 'block.create', id: 'locked-block', parentId: 'other', blockType: 'pdf', attachmentId: 'locked' },
  ]);
  assert.equal(w.fileTextStatus(), null, 'off until the server starts it');
  assert.equal(w.search({ query: '해지는' }).total, 0);
  const index = w.startFileIndex({ delay: 0 });
  await settle(index);
  assert.deepEqual(w.fileTextStatus(), { files: 4, readable: 3, indexed: 2, pending: 0, failed: 0, encrypted: 1, unsupported: 1, reading: false });

  const found = w.search({ query: '해지는 30일' });
  assert.equal(found.total, 1);
  assert.equal(found.results[0].id, 'docs');
  assert.deepEqual(found.results[0].files.map(file => [file.id, file.name, file.blockId]), [['contract', '계약서.docx', 'file-block']]);
  assert.match(found.results[0].files[0].excerpt, /해지는 30일 전에 알린다/);
  // Words split between the page and its file; a phrase only in the PDF; nothing in titles-only search.
  assert.equal(w.search({ query: '묶음 삼천만' }).results[0]?.files?.[0]?.name, '견적.pdf');
  assert.equal(w.search({ query: '"두 달입니다"' }).results[0]?.files?.[0]?.blockId, 'pdf-block');
  assert.equal(w.search({ query: '해지는', titleOnly: true }).total, 0);

  // A new file is read shortly after it arrives — here in a database row's file property.
  apply([
    { type: 'page.create', id: 'db', title: '서류함' },
    { type: 'source.create', id: 's', pageId: 'db', name: '서류', titlePropertyId: 'title' },
    { type: 'property.create', id: 'files', sourceId: 's', name: '파일', propertyType: 'files' },
    { type: 'page.create', id: 'row', title: '영수증', sourceId: 's' },
    attach('receipt', 'receipt.txt', Buffer.from('합계 금액 48,000원\n카드 결제')),
    { type: 'value.set', pageId: 'row', propertyId: 'files', value: ['receipt'] },
  ]);
  await settle(index);
  const row = w.search({ query: '48,000원' }).results[0];
  assert.equal(row?.id, 'row');
  assert.deepEqual(row.files.map(file => [file.name, file.blockId]), [['receipt.txt', null]]);
  // The same content attached twice is read once; the text survives a restart without being read again.
  apply([attach('copy', '사본.docx', docx), { type: 'block.create', id: 'copy-block', parentId: 'other', blockType: 'file', attachmentId: 'copy' }]);
  await settle(index);
  assert.equal(w.search({ query: '해지는' }).total, 2);
  w.close();
  const again = new Workspace(directory);
  t.after(() => again.close());
  const reopened = again.startFileIndex({ delay: 0 });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reopened.worker, null, 'nothing to read again');
  assert.equal(again.search({ query: '48,000원' }).results[0]?.id, 'row');
  assert.equal(again.fileTextStatus().indexed, 3, 'the copy is the same file');
});

test('the server starts the index and reports it; the time machine finds files where they were then', async t => {
  const { w, apply, attach } = fixtureWorkspace(t);
  apply([{ type: 'page.create', id: 'p', title: '보관' }, attach('a', 'note.md', Buffer.from('# 제목\n오래된 메모의 열쇠말 zebra')), { type: 'block.create', id: 'b', parentId: 'p', blockType: 'file', attachmentId: 'a' }]);
  const then = w.revision;
  apply([{ type: 'node.trash', id: 'b' }]);
  const server = createLocalServer(w, { fileIndex: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeEventStreams?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const search = async (query, at) => (await (await fetch(`${base}/api/search${at ? `?at=${at}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json()).results;
  await settle(w.fileIndex);
  const status = await (await fetch(`${base}/api/file-text`)).json();
  assert.equal(status.indexed, 1);
  assert.equal(status.pending, 0);
  assert.deepEqual(await search('zebra'), [], 'the block is gone now');
  const past = await search('zebra', then);
  assert.equal(past[0]?.id, 'p');
  assert.equal(past[0].files[0].name, 'note.md');
  assert.match(past[0].files[0].excerpt, /열쇠말 zebra/);
});

test('limits: a small file that expands to a huge one is cut short; a file that brought the app down is not read again', async t => {
  // A PDF whose one content stream would expand to 80 MB: that stream is skipped, memory stays small.
  const bomb = deflateSync(Buffer.alloc(80 * 1024 ** 2, 0x20));
  const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length ${bomb.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), bomb, Buffer.from('\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF', 'latin1')]);
  const before = process.memoryUsage().rss;
  assert.equal(pdfText(pdf), '');
  assert.ok(process.memoryUsage().rss - before < 60 * 1024 ** 2, 'the stream was never expanded');
  // An index whose last run stopped while reading a file: that file stays unread; a missing blob is read once back.
  const { w, apply, attach } = fixtureWorkspace(t);
  const crashed = Buffer.from('읽다가 멈춘 파일'), missing = Buffer.from('잠시 사라진 파일 내용');
  apply([{ type: 'page.create', id: 'p', title: '페이지' }, attach('x', 'crash.txt', crashed), { type: 'block.create', id: 'bx', parentId: 'p', blockType: 'file', attachmentId: 'x' }, attach('y', 'later.txt', missing), { type: 'block.create', id: 'by', parentId: 'p', blockType: 'file', attachmentId: 'y' }]);
  const index = w.startFileIndex({ delay: 10_000 });
  index.record(w.snapshot().objects.find(item => item.id === 'x').sha256, { status: 'reading' });
  const blob = path.join(w.blobDirectory, w.snapshot().objects.find(item => item.id === 'y').sha256);
  const { renameSync } = await import('node:fs');
  renameSync(blob, `${blob}.aside`);
  index.sync(); await settle(index);
  assert.deepEqual(w.fileTextStatus(), { files: 2, readable: 2, indexed: 0, pending: 0, failed: 2, encrypted: 0, unsupported: 0, reading: false });
  renameSync(`${blob}.aside`, blob);
  index.sync(); await settle(index);
  assert.equal(w.fileTextStatus().indexed, 1);
  assert.equal(w.search({ query: '사라진' }).total, 1);
  assert.equal(w.search({ query: '멈춘' }).total, 0, 'not read again');
});
