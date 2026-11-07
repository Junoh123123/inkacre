import { t, language, translateServerMessage } from '../i18n';
import { api, ApiError } from '../data/api';
import { refresh } from '../data/store';
import { crc32, prepareImport, textToHtml, rowsToCsv, delimitedRows } from './importConverters';

// 큰 ZIP 가져오기 (up to 5 GB): the archive is read from the chosen file in pieces — its
// directory at the end (ZIP64 too), then each entry's bytes — and never whole. Documents are converted here as they
// would be on their own and go to the app as text; every other file goes as its bytes from the ZIP, which the app
// unpacks straight into storage (src/archive-import.mjs). Hidden files (.DS_Store, __MACOSX) are left out. The pages
// are made by one command once everything is in, after a preview.

export const archiveLimits = { zipBytes: 5 * 1024 ** 3, files: 10000, fileBytes: 2 * 1024 ** 3, documentBytes: 50 * 1024 * 1024 };
export interface ZipEntry { name: string; method: number; compressed: number; size: number; crc: number; offset: number; flags: number; link: boolean }
export interface ArchivePreview { revision: number; warnings: string[]; count: number; pages: number; rows: number; attachments: number; documents: number; files: number; changes: Array<{ id: string; kind: string; title?: string; name?: string }> }
export interface ArchiveProgress { done: number; total: number; current: string }

const slice = async (file: Blob, start: number, end: number) => new Uint8Array(await file.slice(start, end).arrayBuffer());
const legacy: Record<string, string> = { ko: 'euc-kr', ja: 'shift_jis', 'zh-CN': 'gbk', 'zh-TW': 'big5' };
// Names: UTF-8 when marked so or when they read as UTF-8 (macOS writes them unmarked); otherwise the older encoding
// of the interface's language (Windows writes Korean names in EUC-KR/CP949, Japanese in Shift_JIS and so on).
function entryName(bytes: Uint8Array, flags: number) {
  if (flags & 0x800) return new TextDecoder().decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* an older encoding */ }
  try { return new TextDecoder(legacy[language] ?? 'windows-1252').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

export async function zipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - (65557 + 20)), tail = await slice(file, tailStart, file.size), view = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
  let count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
    const at = Number(view.getBigUint64(locator + 8, true)), record = await slice(file, at, at + 56), rv = new DataView(record.buffer);
    if (rv.getUint32(0, true) !== 0x06064b50) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
    count = Number(rv.getBigUint64(32, true)); size = Number(rv.getBigUint64(40, true)); offset = Number(rv.getBigUint64(48, true));
  }
  if (size > 512 * 1024 * 1024 || offset + size > file.size) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
  const directory = await slice(file, offset, offset + size), dv = new DataView(directory.buffer), entries: ZipEntry[] = [];
  for (let i = 0, pos = 0; i < count && pos + 46 <= directory.length; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
    const flags = dv.getUint16(pos + 8, true), method = dv.getUint16(pos + 10, true), crc = dv.getUint32(pos + 16, true);
    let compressed = dv.getUint32(pos + 20, true), length = dv.getUint32(pos + 24, true), local = dv.getUint32(pos + 42, true);
    const nameLength = dv.getUint16(pos + 28, true), extraLength = dv.getUint16(pos + 30, true), commentLength = dv.getUint16(pos + 32, true), external = dv.getUint32(pos + 38, true);
    for (let at = pos + 46 + nameLength, stop = at + extraLength; at + 4 <= stop;) {
      const id = dv.getUint16(at, true), fieldLength = dv.getUint16(at + 2, true);
      if (id === 0x0001) {
        let field = at + 4;
        if (length === 0xffffffff) { length = Number(dv.getBigUint64(field, true)); field += 8; }
        if (compressed === 0xffffffff) { compressed = Number(dv.getBigUint64(field, true)); field += 8; }
        if (local === 0xffffffff) local = Number(dv.getBigUint64(field, true));
      }
      at += 4 + fieldLength;
    }
    entries.push({ name: entryName(directory.subarray(pos + 46, pos + 46 + nameLength), flags).replaceAll('\\', '/'), method, compressed, size: length, crc, offset: local, flags, link: ((external >>> 16) & 0xf000) === 0xa000 });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// An entry's bytes as stored in the ZIP (still compressed), as a piece of the file.
async function entryData(file: Blob, entry: ZipEntry): Promise<Blob> {
  const header = await slice(file, entry.offset, entry.offset + 30), hv = new DataView(header.buffer);
  if (header.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new Error(t("ZIP 파일을 읽지 못했습니다."));
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  return file.slice(start, start + entry.compressed);
}
async function entryBytes(file: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const data = await entryData(file, entry);
  const bytes = entry.method === 0 ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error(t("ZIP 안의 {0} 파일이 손상됐습니다.", [entry.name]));
  return bytes;
}

const documents = /\.(md|markdown|html?|csv|tsv|dsv|txt|docx|pdf|xlsx|xls|ods|opml|epub)$/i;
const mediaTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', heic: 'image/heic', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', pdf: 'application/pdf', txt: 'text/plain', json: 'application/json', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', key: 'application/octet-stream', csv: 'text/csv' };
const typeOf = (name: string) => mediaTypes[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
const hidden = (name: string) => name.startsWith('__MACOSX/') || name.split('/').some(part => part.startsWith('.'));

// What the import window shows before reading: the entries to bring in and why any are left out.
export interface ArchivePlan { entries: ZipEntry[]; bundle: boolean; skipped: string[] }
export async function readArchive(file: File): Promise<ArchivePlan> {
  if (file.size > archiveLimits.zipBytes) throw new Error(t("ZIP 파일은 5 GB까지 가져올 수 있습니다."));
  const all = await zipEntries(file), skipped: string[] = [];
  const entries = all.filter(entry => {
    if (entry.name.endsWith('/') || hidden(entry.name)) return false;
    if (entry.link) { skipped.push(t("{0}: 바로 가기(링크)는 가져오지 않습니다.", [entry.name])); return false; }
    if (entry.flags & 0x01) { skipped.push(t("{0}: 암호가 걸린 파일은 가져올 수 없습니다.", [entry.name])); return false; }
    if (![0, 8].includes(entry.method)) { skipped.push(t("{0}: 지원하지 않는 압축 방식입니다.", [entry.name])); return false; }
    if (entry.size > archiveLimits.fileBytes) { skipped.push(t("{0}: 2 GiB보다 큰 파일은 가져올 수 없습니다.", [entry.name])); return false; }
    return true;
  });
  if (entries.length > archiveLimits.files) throw new Error(t("ZIP 하나에 파일은 10,000개까지 가져올 수 있습니다. ZIP을 나눠 주세요."));
  return { entries, bundle: entries.some(entry => /\.(inkacre|pageyard)\.json$/.test(entry.name)), skipped };
}

// Reads every entry into an import on the app (documents as text, in batches; other files one by one) and returns its
// id and a preview. upload: a picture inside a Word file or an EPUB, kept as an attachment as when imported alone.
export async function sendArchive(file: File, plan: ArchivePlan, options: { title: string; parentId?: string | null; upload: (file: File) => Promise<string>; onProgress: (progress: ArchiveProgress) => void; signal: AbortSignal }): Promise<{ id: string; preview: ArchivePreview }> {
  const { id } = await api<{ id: string }>('/api/import/archive', { title: options.title, ...(options.parentId ? { parentId: options.parentId } : {}) });
  const warnings: string[] = [...plan.skipped];
  try {
    const claimed = new Set<string>();
    const claim = (path: string) => { let candidate = path, n = 2; const dot = path.lastIndexOf('.'); while (claimed.has(candidate.toLowerCase())) candidate = `${path.slice(0, dot)} ${n++}${path.slice(dot)}`; claimed.add(candidate.toLowerCase()); return candidate; };
    let batch: Array<{ path: string; text: string }> = [], batchSize = 0;
    const flush = async () => { if (!batch.length) return; await api(`/api/import/archive/${id}/documents`, { documents: batch }); batch = []; batchSize = 0; };
    const sendFile = async (entry: ZipEntry) => {
      const params = new URLSearchParams({ path: claim(entry.name), method: String(entry.method), size: String(entry.size), crc: String(entry.crc), type: typeOf(entry.name) });
      const response = await fetch(`/api/import/archive/${id}/file?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await entryData(file, entry), signal: options.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new ApiError(data.error?.message ? translateServerMessage(data.error.message) : t("요청을 처리하지 못했습니다."), data.error?.code); }
    };
    for (const [index, entry] of plan.entries.entries()) {
      if (options.signal.aborted) throw new DOMException('aborted', 'AbortError');
      options.onProgress({ done: index, total: plan.entries.length, current: entry.name });
      const lower = entry.name.toLowerCase(), stem = entry.name.replace(/\.[^./]+$/, '');
      if (!documents.test(lower) || entry.size > archiveLimits.documentBytes) {
        if (documents.test(lower)) warnings.push(t("{0}: 50 MB보다 큰 문서는 파일로 가져옵니다.", [entry.name]));
        await sendFile(entry); continue;
      }
      const bytes = await entryBytes(file, entry);
      let converted: { path: string; text: string } | null = null;
      try {
        const text = () => new TextDecoder().decode(bytes).replace(/^﻿/, '');
        if (/\.(md|markdown|html?|csv)$/.test(lower)) converted = { path: entry.name, text: text() };
        else if (lower.endsWith('.txt')) converted = { path: `${stem}.html`, text: textToHtml(text()) };
        else if (/\.(tsv|dsv)$/.test(lower)) converted = { path: `${stem}.csv`, text: rowsToCsv(delimitedRows(text(), lower.endsWith('.tsv') ? '\t' : null)) };
        else {
          const prepared = await prepareImport(new File([bytes as Uint8Array<ArrayBuffer>], entry.name.split('/').pop()!), options.upload);
          if (['html', 'markdown', 'csv'].includes(prepared.format)) converted = { path: `${stem}.${prepared.format === 'csv' ? 'csv' : prepared.format === 'markdown' ? 'md' : 'html'}`, text: prepared.text };
        }
      } catch (error) { warnings.push(t("{0}: 문서로 읽지 못해 파일로 가져옵니다. ({1})", [entry.name, error instanceof Error ? error.message : String(error)])); }
      if (!converted) { await sendFile(entry); continue; }
      batch.push({ path: claim(converted.path), text: converted.text }); batchSize += converted.text.length;
      if (batchSize > 4 * 1024 * 1024 || batch.length >= 500) await flush();
    }
    await flush();
    options.onProgress({ done: plan.entries.length, total: plan.entries.length, current: '' });
    const preview = await api<ArchivePreview>(`/api/import/archive/${id}/preview`, {});
    return { id, preview: { ...preview, warnings: [...warnings, ...preview.warnings] } };
  } catch (error) {
    api(`/api/import/archive/${id}/cancel`, {}).catch(() => undefined);
    throw error;
  }
}

export const cancelArchive = (id: string) => api(`/api/import/archive/${id}/cancel`, {}).catch(() => undefined);
export async function commitArchive(id: string, revision: number) {
  const result = await api<{ revision: number; pageId: string }>(`/api/import/archive/${id}/commit`, { commandId: crypto.randomUUID(), actor: 'user', expectedRevision: revision });
  await refresh();
  return result;
}
