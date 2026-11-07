import { t } from '../i18n';
import { xlsRows } from './xls';
// Files the server's importers don't read directly are turned into HTML, Markdown or CSV here, in the browser:
// Word (.docx, through mammoth), PDF (text through pdf.js), Excel (.xlsx and .xls, the first sheet), OpenDocument
// spreadsheets (.ods, the first sheet), tab- or otherwise delimited text (.tsv, .dsv), OPML outlines, EPUB books
// and plain text. Both libraries are vendored and served by the app (/vendor/…), so nothing leaves the computer.
// Pictures inside a Word file or an EPUB are uploaded as attachments first and referenced as /api/attachments/<id>.

export type ImportFormat = 'markdown' | 'html' | 'csv' | 'bundle' | 'zip';
export interface Prepared { format: ImportFormat; text: string; title: string; note?: string }
type Upload = (file: File) => Promise<string>;

export const importAccept = '.csv,.tsv,.dsv,.md,.markdown,.txt,.html,.htm,.zip,.json,.docx,.pdf,.xlsx,.xls,.ods,.opml,.epub';

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

export async function prepareImport(file: File, upload: Upload): Promise<Prepared> {
  const name = file.name, title = baseName(name), lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return { format: 'zip', text: base64(await convertZip(new Uint8Array(await file.arrayBuffer()), upload)), title };
  if (lower.endsWith('.csv')) return { format: 'csv', text: await file.text(), title };
  if (/\.html?$/.test(lower)) return { format: 'html', text: await file.text(), title };
  if (lower.endsWith('.json')) return { format: 'bundle', text: await file.text(), title };
  if (/\.(md|markdown)$/.test(lower)) return { format: 'markdown', text: await file.text(), title };
  if (lower.endsWith('.txt')) return { format: 'html', text: textToHtml(await file.text()), title };
  if (lower.endsWith('.docx')) return { format: 'html', text: await docxToHtml(file, upload), title };
  if (lower.endsWith('.pdf')) return { format: 'html', text: await pdfToHtml(file), title, note: t("PDF는 글과 표를 가져옵니다(그림과 배치는 빠집니다).") };
  if (lower.endsWith('.xlsx')) return { format: 'csv', text: await xlsxToCsv(file), title, note: t("엑셀 파일은 첫 번째 시트를 데이터베이스로 가져옵니다.") };
  if (lower.endsWith('.xls')) return { format: 'csv', text: rowsToCsv(xlsRows(new Uint8Array(await file.arrayBuffer()))), title, note: t("엑셀 파일은 첫 번째 시트를 데이터베이스로 가져옵니다.") };
  if (lower.endsWith('.ods')) return { format: 'csv', text: await odsToCsv(file), title, note: t("스프레드시트는 첫 번째 시트를 데이터베이스로 가져옵니다.") };
  if (/\.(tsv|dsv)$/.test(lower)) return { format: 'csv', text: rowsToCsv(delimitedRows(await file.text(), lower.endsWith('.tsv') ? '\t' : null)), title };
  if (lower.endsWith('.opml')) return { format: 'html', text: opmlToHtml(await file.text()), title };
  if (lower.endsWith('.epub')) return { format: 'html', text: await epubToHtml(file, upload), title };
  throw new Error(t("가져올 수 없는 파일 형식입니다: {0}", [name]));
}

// A ZIP with Word, PDF, Excel, OPML, EPUB or text files in it: each of those becomes the HTML or CSV page it would
// be on its own (pictures uploaded as attachments), then the archive goes to the server's ZIP import as usual.
const convertible = /\.(docx|pdf|xlsx|opml|epub|txt)$/i;
async function convertZip(bytes: Uint8Array, upload: Upload): Promise<Uint8Array> {
  let files: Map<string, Uint8Array>;
  try { files = await readZip(bytes); } catch { return bytes; }
  if (![...files.keys()].some(name => convertible.test(name) && !name.startsWith('__MACOSX/'))) return bytes;
  const out = new Map<string, Uint8Array>(), encoder = new TextEncoder();
  for (const [name, data] of files) {
    if (name.startsWith('__MACOSX/')) continue;
    if (!convertible.test(name)) { out.set(name, data); continue; }
    const prepared = await prepareImport(new File([data as Uint8Array<ArrayBuffer>], name.split('/').pop()!), upload).catch(() => null);
    if (!prepared) { out.set(name, data); continue; }
    const stem = name.replace(/\.[^./]+$/, '');
    out.set(`${stem}.${prepared.format === 'csv' ? 'csv' : 'html'}`, encoder.encode(prepared.text));
  }
  return writeZip(out);
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// A ZIP (deflated) with UTF-8 names.
const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
export function crc32(data: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function writeZip(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const encoder = new TextEncoder(), locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, raw] of files) {
    const nameBytes = encoder.encode(name), crc = crc32(raw), data = await deflate(raw);
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, data); centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.size, true); ev.setUint16(10, files.size, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { result.set(part, at); at += part.length; }
  return result;
}

// Plain text: one paragraph per line (Markdown would read "# " or "1. " as structure).
export function textToHtml(text: string) {
  return text.replaceAll('\r\n', '\n').split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('\n');
}

// ----- Word -----
interface Mammoth { convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>): Promise<{ value: string; messages: unknown[] }>; images: { imgElement(read: (image: { contentType: string; readAsArrayBuffer(): Promise<ArrayBuffer> }) => Promise<{ src: string; alt?: string }>): unknown } }
let mammothLoad: Promise<Mammoth> | null = null;
function loadMammoth(): Promise<Mammoth> {
  mammothLoad ??= new Promise((resolve, reject) => {
    const existing = (window as unknown as { mammoth?: Mammoth }).mammoth;
    if (existing) { resolve(existing); return; }
    const script = document.createElement('script');
    script.src = '/vendor/mammoth.browser.min.js';
    script.onload = () => { const loaded = (window as unknown as { mammoth?: Mammoth }).mammoth; if (loaded) resolve(loaded); else reject(new Error(t("Word 변환기를 불러오지 못했습니다."))); };
    script.onerror = () => { mammothLoad = null; reject(new Error(t("Word 변환기를 불러오지 못했습니다."))); };
    document.head.append(script);
  });
  return mammothLoad;
}

export async function docxToHtml(file: File, upload: Upload) {
  const mammoth = await loadMammoth();
  let count = 0;
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
    convertImage: mammoth.images.imgElement(async image => {
      const extension = (image.contentType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
      const id = await upload(new File([await image.readAsArrayBuffer()], `${baseName(file.name)}-${++count}.${extension}`, { type: image.contentType }));
      return { src: `/api/attachments/${encodeURIComponent(id)}` };
    }),
  });
  return result.value;
}

// ----- PDF -----
interface TextItem { str: string; transform: number[]; height: number; width?: number; hasEOL?: boolean }
export interface PdfJs { GlobalWorkerOptions: { workerSrc: string }; getDocument(options: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }> }> } }
let pdfLoad: Promise<PdfJs> | null = null;
export function loadPdf(): Promise<PdfJs> {
  pdfLoad ??= (import(/* @vite-ignore */ '/vendor/pdf.min.mjs' as string) as Promise<PdfJs>).then(module => { module.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs'; return module; });
  return pdfLoad;
}

// Lines are rebuilt from the text pieces' positions; a gap wider than a line starts a paragraph, and a line set
// clearly larger than the body text becomes a heading.
// Text lines keep their pieces' positions: a wide gap between pieces splits a line into cells, and two or more
// following lines with the same number of cells whose columns line up become a simple table.
interface PdfLine { text: string; size: number; y: number; page: number; cells: Array<{ x: number; end: number; text: string }> }
export async function pdfToHtml(file: File) {
  const pdf = await loadPdf();
  const document_ = await pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/vendor/pdfjs-cmaps/', cMapPacked: true, isEvalSupported: false, useSystemFonts: false }).promise;
  const lines: PdfLine[] = [];
  for (let n = 1; n <= document_.numPages; n++) {
    const content = await (await document_.getPage(n)).getTextContent();
    let current: PdfLine | null = null;
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const y = Math.round(item.transform[5]), size = Math.round(Math.abs(item.transform[3]) || item.height || 10);
      const x = item.transform[4] ?? 0, end = x + (item.width ?? 0);
      if (current && Math.abs(current.y - y) <= Math.max(2, size * 0.4)) {
        const last = current.cells[current.cells.length - 1];
        // A gap wider than about two letters starts a new cell; spaces in between only space out the text.
        if (!item.str.trim()) { if (last) last.text += ' '; }
        else if (last && x - last.end > Math.max(6, size * 0.6)) current.cells.push({ x, end, text: item.str });
        else if (last) { last.text += item.str; last.end = Math.max(last.end, end); }
        else current.cells.push({ x, end, text: item.str });
        current.text += (last && x - last.end > size * 0.25 && !/\s$/.test(current.text) && !/^\s/.test(item.str) ? ' ' : '') + item.str;
        current.size = Math.max(current.size, size);
      } else { if (current?.text.trim()) lines.push(current); current = { text: item.str, size, y, page: n, cells: item.str.trim() ? [{ x, end, text: item.str }] : [] }; }
      if (item.hasEOL && current) { if (current.text.trim()) lines.push(current); current = null; }
    }
    if (current?.text.trim()) lines.push(current);
  }
  if (!lines.length) throw new Error(t("PDF에서 글을 찾지 못했습니다(스캔한 그림 PDF일 수 있습니다)."));
  for (const line of lines) line.cells = line.cells.map(cell => ({ ...cell, text: cell.text.trim() })).filter(cell => cell.text);
  const sizes = lines.map(line => line.size).sort((a, b) => a - b), body = sizes[Math.floor(sizes.length / 2)] || 10;
  // Rows of a table: same page, close together, the same cell count (2+), each cell starting near the one above.
  const aligned = (a: PdfLine, b: PdfLine) => a.page === b.page && a.cells.length >= 2 && a.cells.length === b.cells.length && a.y - b.y <= Math.max(a.size, b.size) * 3
    && a.cells.every((cell, i) => Math.abs(cell.x - b.cells[i].x) <= Math.max(14, body * 1.5) || Math.abs(cell.end - b.cells[i].end) <= Math.max(14, body * 1.5));
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) out.push(`<p>${escapeHtml(paragraph.join(' ').replace(/\s+/g, ' ').trim())}</p>`); paragraph = []; };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], previous = lines[index - 1];
    let last = index;
    while (last + 1 < lines.length && aligned(lines[last], lines[last + 1]) && last - index < 199) last++;
    if (last > index) {
      flush();
      const rows = lines.slice(index, last + 1).map(row => `<tr>${row.cells.map(cell => `<td>${escapeHtml(cell.text)}</td>`).join('')}</tr>`);
      out.push(`<table>${rows.join('')}</table>`);
      index = last;
      continue;
    }
    if (line.size >= body * 1.35 && line.text.trim().length <= 120) { flush(); out.push(`<h${line.size >= body * 1.8 ? 1 : 2}>${escapeHtml(line.text.trim())}</h${line.size >= body * 1.8 ? 1 : 2}>`); continue; }
    if (previous && (previous.page !== line.page || previous.y - line.y > line.size * 1.8)) flush();
    paragraph.push(line.text.trim());
  }
  flush();
  return out.join('\n');
}

// ----- ZIP (xlsx, epub) -----
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (!name.endsWith('/')) files.set(name, method === 0 ? raw : method === 8 ? await inflate(raw) : new Uint8Array());
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const xml = (bytes: Uint8Array | undefined) => new DOMParser().parseFromString(new TextDecoder().decode(bytes ?? new Uint8Array()), 'application/xml');
const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

// ----- Excel: the first sheet as CSV (shared strings, inline strings, numbers and booleans) -----
export async function xlsxToCsv(file: File) {
  const files = await readZip(new Uint8Array(await file.arrayBuffer()));
  const shared = [...xml(files.get('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(node => node.textContent ?? '').join(''));
  const workbook = xml(files.get('xl/workbook.xml'));
  const relations = xml(files.get('xl/_rels/workbook.xml.rels'));
  const firstSheet = workbook.getElementsByTagName('sheet')[0];
  const relationId = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = [...relations.getElementsByTagName('Relationship')].find(item => item.getAttribute('Id') === relationId)?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  const sheet = xml(files.get(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`));
  const column = (reference: string) => [...reference.replace(/\d+$/, '')].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const cells: string[] = [];
    for (const cell of row.getElementsByTagName('c')) {
      const at = column(cell.getAttribute('r') ?? 'A1'), type = cell.getAttribute('t');
      const value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      cells[at] = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? [...cell.getElementsByTagName('t')].map(node => node.textContent ?? '').join('') : type === 'b' ? (value === '1' ? 'true' : 'false') : value;
    }
    rows.push(Array.from(cells, value => value ?? ''));
  }
  return rowsToCsv(rows);
}

// Rows of a sheet as CSV for a new database: trailing empty rows dropped, empty headings named "열 n".
export function rowsToCsv(rows: string[][]) {
  rows = rows.map(row => Array.from(row ?? [], value => value ?? ''));
  while (rows.length && rows[rows.length - 1].every(value => !value)) rows.pop();
  if (!rows.length) throw new Error(t("시트가 비어 있습니다."));
  const width = Math.max(...rows.map(row => row.length));
  const header = Array.from({ length: width }, (_, i) => rows[0][i] || t("열 {0}", [i + 1]));
  return [header, ...rows.slice(1)].map(row => Array.from({ length: width }, (_, i) => csvCell(row[i] ?? '')).join(',')).join('\n');
}

// ----- OpenDocument spreadsheet (.ods): the first sheet's cells (numbers, dates, times, booleans as stored) -----
export async function odsToCsv(file: File) {
  const files = await readZip(new Uint8Array(await file.arrayBuffer()));
  const content = xml(files.get('content.xml'));
  const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const table = content.getElementsByTagNameNS(TABLE, 'table')[0];
  if (!table) throw new Error(t("시트가 비어 있습니다."));
  // A paragraph's words with its runs of spaces (text:s), tabs and line breaks.
  const words = (node: Node): string => [...node.childNodes].map(child => child.nodeType === 3 ? child.nodeValue ?? '' : child instanceof Element ? child.namespaceURI === TEXT && child.localName === 's' ? ' '.repeat(Number(child.getAttributeNS(TEXT, 'c') ?? 1) || 1) : child.namespaceURI === TEXT && child.localName === 'tab' ? '\t' : child.namespaceURI === TEXT && child.localName === 'line-break' ? '\n' : words(child) : '').join('');
  const value = (cell: Element) => {
    const type = cell.getAttributeNS(OFFICE, 'value-type');
    if (type === 'float' || type === 'percentage' || type === 'currency') return cell.getAttributeNS(OFFICE, 'value') ?? '';
    if (type === 'date') return cell.getAttributeNS(OFFICE, 'date-value') ?? '';
    if (type === 'time') return cell.getAttributeNS(OFFICE, 'time-value') ?? '';
    if (type === 'boolean') return cell.getAttributeNS(OFFICE, 'boolean-value') ?? '';
    return [...cell.getElementsByTagNameNS(TEXT, 'p')].map(words).join('\n');
  };
  const rows: string[][] = [];
  for (const row of table.getElementsByTagNameNS(TABLE, 'table-row')) {
    if (rows.length > 200000) break;
    const cells: string[] = [];
    for (const cell of row.children) {
      if (cell.namespaceURI !== TABLE || !['table-cell', 'covered-table-cell'].includes(cell.localName)) continue;
      const text = value(cell), repeat = Math.max(1, Number(cell.getAttributeNS(TABLE, 'number-columns-repeated') ?? 1) || 1);
      // Spreadsheets pad their rows with thousands of repeated empty cells; those stay one.
      for (let i = 0; i < (text ? Math.min(repeat, 1024) : Math.min(repeat, 1)); i++) cells.push(text);
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    const repeat = Math.max(1, Number(row.getAttributeNS(TABLE, 'number-rows-repeated') ?? 1) || 1);
    for (let i = 0; i < (cells.length ? Math.min(repeat, 10000) : Math.min(repeat, 1)); i++) rows.push([...cells]);
  }
  return rowsToCsv(rows);
}

// ----- Delimited text (.tsv, .dsv): tabs, or for .dsv the most used of , ; | and tab in the first line -----
export function delimitedRows(text: string, delimiter: string | null) {
  text = text.replace(/^\uFEFF/, '');
  if (!delimiter) {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    delimiter = [',', ';', '\t', '|'].map(mark => [mark, firstLine.split(mark).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; continue; }
    if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ----- OPML (Workflowy, Dynalist and other outliners): nested bullets, notes as paragraphs -----
export function opmlToHtml(text: string) {
  const document_ = new DOMParser().parseFromString(text, 'application/xml');
  const body = document_.getElementsByTagName('body')[0];
  if (!body) throw new Error(t("OPML 파일을 읽지 못했습니다."));
  const list = (parent: Element): string => {
    const items = [...parent.children].filter(child => child.tagName === 'outline');
    if (!items.length) return '';
    return `<ul>${items.map(item => `<li>${escapeHtml(item.getAttribute('text') ?? item.getAttribute('title') ?? '')}${item.getAttribute('_note') ? `<p>${escapeHtml(item.getAttribute('_note')!)}</p>` : ''}${list(item)}</li>`).join('')}</ul>`;
  };
  return list(body);
}

// ----- EPUB: the chapters in reading order, one after another -----
export async function epubToHtml(file: File, upload: Upload) {
  const files = await readZip(new Uint8Array(await file.arrayBuffer()));
  const container = xml(files.get('META-INF/container.xml'));
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error(t("EPUB 파일을 읽지 못했습니다."));
  const folder = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = xml(files.get(opfPath));
  const manifest = new Map([...opf.getElementsByTagName('item')].map(item => [item.getAttribute('id'), { href: item.getAttribute('href') ?? '', type: item.getAttribute('media-type') ?? '' }]));
  const resolvePath = (base: string, href: string) => { const parts = (base + decodeURIComponent(href.split('#')[0])).split('/'); const out: string[] = []; for (const part of parts) { if (part === '..') out.pop(); else if (part !== '.') out.push(part); } return out.join('/'); };
  const uploaded = new Map<string, string>();
  const chapters: string[] = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    const entry = manifest.get(ref.getAttribute('idref'));
    if (!entry || !/html/.test(entry.type)) continue;
    const path = resolvePath(folder, entry.href);
    const page = new DOMParser().parseFromString(new TextDecoder().decode(files.get(path) ?? new Uint8Array()), 'application/xhtml+xml');
    const body = page.getElementsByTagName('body')[0];
    if (!body) continue;
    const chapterFolder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    for (const image of [...body.getElementsByTagName('img')]) {
      const src = image.getAttribute('src');
      if (!src || /^[a-z]+:/i.test(src)) continue;
      const imagePath = resolvePath(chapterFolder, src), bytes = files.get(imagePath);
      if (!bytes) { image.remove(); continue; }
      if (!uploaded.has(imagePath)) {
        const type = /\.png$/i.test(imagePath) ? 'image/png' : /\.gif$/i.test(imagePath) ? 'image/gif' : /\.webp$/i.test(imagePath) ? 'image/webp' : 'image/jpeg';
        uploaded.set(imagePath, await upload(new File([bytes as Uint8Array<ArrayBuffer>], imagePath.split('/').pop()!, { type })));
      }
      image.setAttribute('src', `/api/attachments/${encodeURIComponent(uploaded.get(imagePath)!)}`);
    }
    chapters.push(new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>|<\/body>$/g, ''));
  }
  if (!chapters.length) throw new Error(t("EPUB에서 본문을 찾지 못했습니다."));
  return chapters.join('\n<hr/>\n');
}
