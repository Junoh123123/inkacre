// 첨부 파일 내용 검색: the text inside an attached file, so search finds a page by what its files say. PDF (src/
// pdf-text.mjs), Word, PowerPoint, Excel, OpenDocument, 한글 (HWPX), HTML and plain text files of any common encoding.
// Pictures, audio and video have no text to read here (no OCR). Runs in a worker (src/file-text-worker.mjs).
import { unzipSync, strFromU8 } from 'fflate';
import { pdfText } from './pdf-text.mjs';

// Bump when an extractor reads more or better: files read by an older one are read again.
export const EXTRACTOR_VERSION = 1;
export const TEXT_LIMIT = 2_000_000;
const MAX_BYTES = { pdf: 300 * 1024 ** 2, office: 200 * 1024 ** 2, text: 50 * 1024 ** 2 };
// The largest file of a kind that is read (bigger ones are left unread without opening them).
export const sizeLimit = kind => kind === 'pdf' ? MAX_BYTES.pdf : kind === 'text' || kind === 'html' ? MAX_BYTES.text : MAX_BYTES.office;
// A ZIP part is unpacked only up to this size (its declared size bounds what fflate allocates).
const PART_LIMIT = 128 * 1024 ** 2;

const TEXT_EXTENSIONS = new Set(['txt', 'text', 'md', 'markdown', 'mdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'tex', 'bib', 'srt', 'vtt', 'sql', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'css', 'scss', 'svg', 'org', 'rst', 'adoc', 'properties', 'env']);
const extension = name => /\.([^./\\]+)$/.exec(String(name ?? ''))?.[1]?.toLowerCase() ?? '';

// What kind of file this is, for reading (null: nothing to read).
export function textKind(name, mediaType = '') {
  const ext = extension(name), type = String(mediaType).toLowerCase();
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (['docx', 'docm', 'dotx'].includes(ext) || type.includes('wordprocessingml')) return 'docx';
  if (['pptx', 'pptm', 'ppsx', 'potx'].includes(ext) || type.includes('presentationml')) return 'pptx';
  if (['xlsx', 'xlsm', 'xltx'].includes(ext) || type.includes('spreadsheetml')) return 'xlsx';
  if (['odt', 'ods', 'odp', 'ott', 'ots', 'otp'].includes(ext) || type.startsWith('application/vnd.oasis.opendocument')) return 'odf';
  if (ext === 'hwpx' || type === 'application/hwp+zip' || type === 'application/haansofthwpx') return 'hwpx';
  if (['html', 'htm', 'xhtml'].includes(ext) || type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (TEXT_EXTENSIONS.has(ext) || type.startsWith('text/') || ['application/json', 'application/xml', 'application/x-yaml', 'application/sql', 'application/javascript'].includes(type)) return 'text';
  return null;
}

// Plain text in whatever encoding it came: a BOM, UTF-8, or the legacy encoding that decodes most cleanly.
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not UTF-8 */ }
  let best = null, bestBad = Infinity;
  for (const label of ['euc-kr', 'shift_jis', 'gbk', 'big5', 'windows-1252']) {
    let text; try { text = new TextDecoder(label).decode(bytes); } catch { continue; }
    const bad = (text.match(/�/g) ?? []).length;
    if (bad < bestBad) { best = text; bestBad = bad; if (!bad) break; }
  }
  return best ?? '';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™' };
const entities = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => name[0] === '#' ? (() => { try { return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))); } catch { return whole; } })() : ENTITIES[name.toLowerCase()] ?? whole);

// XML to text: character data inside the text elements; line breaks at paragraphs and rows; tabs at cells.
function xmlText(xml, { text, block, tab = [], br = [], skip = [], cell = [] }) {
  const out = [];
  let inside = 0, skipping = 0;
  const pattern = /<(\/?)([\w.:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let match;
  while ((match = pattern.exec(xml))) {
    const [, closing, tag, attrs, selfClosing, data] = match;
    if (data !== undefined) { if (inside > 0 && !skipping) out.push(entities(data)); continue; }
    const name = tag;
    if (skip.includes(name)) { if (closing) skipping = Math.max(0, skipping - 1); else if (!selfClosing) skipping++; continue; }
    if (skipping) continue;
    if (text.includes(name)) { if (closing) inside = Math.max(0, inside - 1); else if (!selfClosing) inside++; if (!block.includes(name)) continue; }
    if (tab.includes(name) && !closing) { out.push('\t'); continue; }
    if (br.includes(name) && !closing) { out.push('\n'); continue; }
    if (cell.includes(name) && closing) { while (out.at(-1) === '\n') out.pop(); out.push('\t'); continue; }
    if (block.includes(name) && (closing || selfClosing)) { out.push('\n'); continue; }
    if (name === 'text:s' && !closing) { const count = Number(/c="(\d+)"/.exec(attrs)?.[1] ?? 1); out.push(' '.repeat(Math.min(count, 50))); }
  }
  return out.join('');
}
const tidy = text => text.replace(/\r\n?/g, '\n').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const numbered = (files, pattern) => Object.keys(files).filter(name => pattern.test(name)).sort((a, b) => Number(pattern.exec(a)[1]) - Number(pattern.exec(b)[1]));
const unzip = (bytes, wanted) => { let total = 0; return unzipSync(bytes, { filter: file => wanted(file.name) && file.originalSize <= PART_LIMIT && (total += file.originalSize) <= 4 * PART_LIMIT }); };

function docxText(bytes) {
  const files = unzip(bytes, name => /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(name));
  const order = ['word/document.xml', ...Object.keys(files).filter(name => /header|footer/.test(name)).sort(), 'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'];
  return order.filter(name => files[name]).map(name => xmlText(strFromU8(files[name]), { text: ['w:t', 'w:delText'], block: ['w:p', 'w:tr'], tab: ['w:tab'], br: ['w:br', 'w:cr'], cell: ['w:tc'], skip: ['w:instrText'] })).join('\n');
}
function pptxText(bytes) {
  const files = unzip(bytes, name => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name));
  const slides = numbered(files, /^ppt\/slides\/slide(\d+)\.xml$/), notes = numbered(files, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
  return [...slides, ...notes].map(name => xmlText(strFromU8(files[name]), { text: ['a:t'], block: ['a:p', 'a:tr'], br: ['a:br'], cell: ['a:tc'] })).join('\n\n');
}
function xlsxText(bytes) {
  const files = unzip(bytes, name => name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const shared = [];
  if (files['xl/sharedStrings.xml']) for (const item of strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(item[1].replace(/<rPh[\s\S]*?<\/rPh>/g, ''), { text: ['t'], block: [] }));
  // Sheets in the workbook's order, each under its name.
  const attribute = (tag, key) => new RegExp(`\\s${key}="([^"]*)"`).exec(tag)?.[1];
  const rels = files['xl/_rels/workbook.xml.rels'] ? Object.fromEntries([...strFromU8(files['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [attribute(tag, 'Id'), (attribute(tag, 'Target') ?? '').replace(/^\/?(xl\/)?/, 'xl/')])) : {};
  const sheets = files['xl/workbook.xml'] ? [...strFromU8(files['xl/workbook.xml']).matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => ({ name: entities(attribute(tag, 'name') ?? ''), file: rels[attribute(tag, 'r:id')] })) : [];
  const known = new Set(sheets.map(sheet => sheet.file));
  for (const name of numbered(files, /^xl\/worksheets\/sheet(\d+)\.xml$/)) if (!known.has(name)) sheets.push({ name: '', file: name });
  const parts = [];
  for (const sheet of sheets) {
    const xml = files[sheet.file] ? strFromU8(files[sheet.file]) : '';
    if (!xml) continue;
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?<!\/)>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /\bt="(\w+)"/.exec(cell[1])?.[1], body = cell[2] ?? '';
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (type === 's') cells.push(shared[Number(value)] ?? '');
        else if (type === 'inlineStr') cells.push(xmlText(body, { text: ['t'], block: [] }));
        else if (value !== undefined) cells.push(entities(value));
      }
      if (cells.some(Boolean)) rows.push(cells.join('\t'));
    }
    parts.push([sheet.name, ...rows].filter(Boolean).join('\n'));
  }
  return parts.join('\n\n');
}
function odfText(bytes) {
  const files = unzip(bytes, name => name === 'content.xml');
  return files['content.xml'] ? xmlText(strFromU8(files['content.xml']), { text: ['text:p', 'text:h'], block: ['text:p', 'text:h', 'table:table-row', 'draw:page'], tab: ['text:tab'], br: ['text:line-break'], cell: ['table:table-cell'], skip: ['office:annotation', 'text:page-number', 'text:date', 'text:time'] }) : '';
}
function hwpxText(bytes) {
  const files = unzip(bytes, name => /^Contents\/section\d+\.xml$/.test(name));
  return numbered(files, /^Contents\/section(\d+)\.xml$/).map(name => xmlText(strFromU8(files[name]), { text: ['hp:t'], block: ['hp:p', 'hp:tr'], tab: ['hp:tab'], br: ['hp:lineBreak'], cell: ['hp:tc'] })).join('');
}
function htmlText(bytes) {
  const html = decodeText(bytes).replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  return entities(html.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table|hr)\b[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]+>/g, ''));
}

// { status: 'ok', text } | { status: 'unsupported' | 'encrypted' | 'failed', error }
export function extractFileText(bytes, { name, mediaType } = {}) {
  const kind = textKind(name, mediaType);
  if (!kind) return { status: 'unsupported', error: 'type' };
  if (bytes.length > sizeLimit(kind)) return { status: 'unsupported', error: 'size' };
  try {
    const text = kind === 'pdf' ? pdfText(bytes, { limit: TEXT_LIMIT }) : kind === 'docx' ? docxText(bytes) : kind === 'pptx' ? pptxText(bytes) : kind === 'xlsx' ? xlsxText(bytes)
      : kind === 'odf' ? odfText(bytes) : kind === 'hwpx' ? hwpxText(bytes) : kind === 'html' ? htmlText(bytes) : decodeText(bytes);
    return { status: 'ok', text: tidy(text).slice(0, TEXT_LIMIT) };
  } catch (error) {
    if (error?.code === 'PDF_ENCRYPTED') return { status: 'encrypted', error: error.message };
    return { status: 'failed', error: String(error?.message ?? error).slice(0, 200) };
  }
}
