// Readable exports (Markdown & CSV or HTML): a page's file, its subpages beside it in a folder
// of the page's name (or all in one folder), a database as a CSV of the chosen view with its rows' pages in a folder,
// attachments in a files/ folder, links between pages and to files rewritten as relative paths. Comments can be added
// to HTML pages. The whole workspace exports the same way, every top-level page in turn. Everything is one ZIP.
import { zipSync, strToU8 } from 'fflate';
import { children, properties, createReader, visible } from './workspace.mjs';
import { querySource } from './query.mjs';
import { isText, textValue } from './formula-values.mjs';

const unsafe = /[\\/:*?"<>|\u0000-\u001f]/g;
const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
// A file or folder name from a title that works on every system: no path characters, no leading dots (hidden, "." and
// "..") or trailing dots and spaces (Windows), no reserved device names, and at most 150 bytes of UTF-8.
export const fileStem = (name, fallback) => {
  let stem = '', bytes = 0;
  for (const char of String(name ?? '').replace(unsafe, ' ').replace(/\s+/g, ' ').trim()) { bytes += Buffer.byteLength(char); if (bytes > 150) break; stem += char; }
  stem = stem.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!stem) return fallback;
  return reserved.test(stem) ? `${stem}_` : stem;
};
// A path not yet used in the archive (names compared without case or Unicode form, as Windows and macOS do):
// "Name 2.ext" and on.
export function uniquePath(taken, folder, stem, extension) {
  const key = value => value.normalize('NFC').toLowerCase();
  let candidate = `${folder}${stem}.${extension}`, n = 2;
  while (taken.has(key(candidate))) candidate = `${folder}${stem} ${n++}.${extension}`;
  taken.add(key(candidate)); return candidate;
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

const htmlStyle = `<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#2c2c2b;line-height:1.5}
h1{font-size:2em;margin:.6em 0 .4em}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #e3e2e0;padding:4px 8px;vertical-align:top}th{background:#f7f6f3}
pre{background:#f7f6f3;padding:12px;border-radius:4px;overflow:auto}code{font-family:SFMono-Regular,Menlo,Consolas,monospace}blockquote{border-left:3px solid currentColor;margin:4px 0;padding-left:14px}
img{max-width:100%}.properties{border-collapse:collapse;margin:0 0 20px}.properties th{background:none;text-align:left;color:#7d7a75;font-weight:400;border:0;padding:3px 16px 3px 0}.properties td{border:0;padding:3px 0}
.comments{margin-top:32px;border-top:1px solid #e3e2e0;padding-top:12px}.comment{margin:8px 0}.callout{display:block;background:#f1f1ef;border-radius:4px;padding:12px 16px;margin:4px 0}details>summary{cursor:pointer}ul.todo{list-style:none;padding-left:4px}.math{font-family:SFMono-Regular,Menlo,monospace;background:#f7f6f3;padding:8px 12px;margin:4px 0}.comment .meta{color:#7d7a75;font-size:12px}.comment.resolved{opacity:.6}
</style>`;

function csvValue(state, property, value) {
  if (value == null || value?.error) return '';
  if (isText(value)) return textValue(value);
  if (property.type === 'relation') return value.map(id => state.get(id)?.title ?? id).join(', ');
  if (['select', 'multi_select', 'status'].includes(property.type)) return (Array.isArray(value) ? value : [value]).map(id => property.options?.find(option => option.id === id)?.name ?? id).join(', ');
  if (property.type === 'files') return value.map(id => state.get(id)?.name ?? id).join(', ');
  if (property.type === 'unique_id' && property.idPrefix) return `${property.idPrefix}-${value}`;
  if (typeof value === 'object' && value.start) return value.end ? `${value.start} → ${value.end}` : value.start;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
const csvText = rows => rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';

// Rows and columns of a database: the view's (its filter, sort and shown properties) or every row and property.
function databaseTable(state, source, viewId) {
  const schema = properties(state, source.id), read = createReader(state);
  const view = viewId ? state.get(viewId) : null;
  if (view?.kind === 'view' && view.sourceId === source.id && visible(state, view.id)) {
    const first = querySource(state, { viewId, limit: 500 }), all = [...first.rows];
    for (let offset = 500, more = first.hasMore; more; offset += 500) { const next = querySource(state, { viewId, limit: 500, offset }); all.push(...next.rows); more = next.hasMore; }
    const result = { ...first, rows: all };
    const columns = result.visibleProperties.map(id => schema.find(property => property.id === id)).filter(Boolean);
    const title = schema.find(property => property.type === 'title');
    const shown = title && !columns.includes(title) ? [title, ...columns] : columns;
    return { columns: shown, rows: result.rows.map(row => state.get(row.id)).filter(Boolean), read };
  }
  const rows = [...state.values()].filter(page => page.kind === 'page' && page.sourceId === source.id && !page.template && visible(state, page.id)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return { columns: schema, rows, read };
}

function pageComments(state, page) {
  const inside = new Set([page.id]);
  const walk = id => { for (const child of children(state, id)) if (child.kind === 'block') { inside.add(child.id); walk(child.id); } };
  walk(page.id);
  return [...state.values()].filter(item => item.kind === 'comment' && item.alive !== false && inside.has(item.parentId)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// collect: the files as a Map (path → text, or { attachmentId, sha256, bytes } for an attachment) instead of a ZIP —
// for the Markdown folder mirror (src/mirror.mjs), which copies attachments itself when they change.
export function exportTree({ workspace, state, rootIds, format, files = true, subpages = true, folders = true, comments = false, viewId = null, markdownPage, pageHtml, name, collect = false }) {
  const ext = format === 'html' ? 'html' : 'md';
  const out = new Map(); // path → text | Uint8Array
  const pathOf = new Map(); // page id → path
  const attachments = new Map(); // attachment id → path
  const taken = new Set();
  const unique = (folder, stem, extension) => uniquePath(taken, folder, stem, extension);
  const pending = []; // [path, page] written once every path is known

  const addPage = (page, folder, deep) => {
    // A full-page database (a page holding only its database) is its CSV.
    const own = children(state, page.id).filter(child => visible(state, child.id));
    const sources = own.filter(child => child.kind === 'source');
    if (sources.length === 1 && !own.some(child => child.kind === 'block' || child.kind === 'page') && !page.sourceId) { addDatabase(sources[0], folder, page.id); return; }
    const stem = fileStem(page.title, 'Untitled');
    const file = unique(folder, stem, ext);
    pathOf.set(page.id, file);
    pending.push([file, page]);
    if (!deep) return;
    const inner = folders ? `${file.slice(0, -(ext.length + 1))}/` : folder;
    for (const child of children(state, page.id)) {
      if (!visible(state, child.id)) continue;
      if (child.kind === 'page' && !child.template) addPage(child, inner, true);
      if (child.kind === 'source') addDatabase(child, inner);
    }
  };
  const addDatabase = (source, folder, pageId = null) => {
    const stem = fileStem(source.name, 'Database');
    const { columns, rows, read } = databaseTable(state, source, viewId);
    const file = unique(folder, stem, 'csv');
    if (pageId) pathOf.set(pageId, file);
    out.set(file, '﻿' + csvText([columns.map(property => property.name), ...rows.map(row => columns.map(property => csvValue(state, property, read(row.id, property.id))))]));
    const inner = folders ? `${file.slice(0, -4)}/` : folder;
    for (const row of rows) addPage(row, inner, true);
  };

  for (const id of rootIds) {
    const root = state.get(id);
    if (!root || !visible(state, id)) continue;
    if (root.kind === 'source') addDatabase(root, '');
    else addPage(root, '', subpages || rootIds.length > 1);
    // A database page's own database comes with it even without subpages.
    if (root.kind === 'page' && !subpages && rootIds.length === 1) for (const child of children(state, root.id)) if (child.kind === 'source' && visible(state, child.id)) addDatabase(child, folders ? `${pathOf.get(root.id).slice(0, -(ext.length + 1))}/` : '');
  }

  const relative = (from, to) => {
    const a = from.split('/').slice(0, -1), b = to.split('/');
    let i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => '..'), ...b.slice(i)].map(part => encodeURIComponent(part)).join('/');
  };
  const attachmentPath = id => {
    if (attachments.has(id)) return attachments.get(id);
    const file = state.get(id);
    if (!file || file.kind !== 'attachment') return null;
    const dot = file.name?.lastIndexOf('.') ?? -1;
    const stem = fileStem(dot > 0 ? file.name.slice(0, dot) : file.name, 'file'), extension = dot > 0 ? file.name.slice(dot + 1).replace(unsafe, '') || 'bin' : 'bin';
    const path = unique('files/', stem, extension);
    attachments.set(id, path);
    out.set(path, collect ? { attachmentId: id, sha256: file.sha256, bytes: file.bytes } : workspace.attachmentBytes(id).bytes);
    return path;
  };

  for (const [file, page] of pending) {
    let text = format === 'html' ? pageHtml(state, page, children) : markdownPage(state, page);
    // Database rows lead with their properties, under the title.
    if (page.sourceId) {
      const schema = properties(state, page.sourceId).filter(property => property.type !== 'title'), read = createReader(state);
      const pairs = schema.map(property => [property.name, csvValue(state, property, read(page.id, property.id))]).filter(([, value]) => value !== '');
      if (pairs.length) text = format === 'html'
        ? text.replace(/(<h1>.*?<\/h1>)/s, `$1<table class="properties">${pairs.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`)
        : text.replace(/^(# .*\n)/, `$1\n${pairs.map(([key, value]) => `${key}: ${value}`).join('  \n')}\n`);
    }
    // Links to exported pages become relative paths; links to pages left out keep only their words.
    const target = encoded => { const id = decodeURIComponent(encoded); return pathOf.has(id) ? relative(file, pathOf.get(id)) : null; };
    text = format === 'html'
      ? text.replace(/<a href="page-([\w:%.-]+?)\.md">(.*?)<\/a>/g, (match, encoded, words) => { const path = target(encoded); return path ? `<a href="${path}">${words}</a>` : words; })
      : text.replace(/\[([^\]]*)\]\(page-([\w:%.-]+?)\.md\)/g, (match, words, encoded) => { const path = target(encoded); return path ? `[${words}](${path})` : words; });
    if (files) text = text.replace(/attachment-(attachment:[\w-]+|[\w:-]+)/g, (match, id) => { const path = attachmentPath(id); return path ? relative(file, path) : match; });
    else text = format === 'html'
      ? text.replace(/<(img|video|audio)\b[^>]*src="attachment-[^"]*"[^>]*>(<\/\1>)?/g, '').replace(/<p><a href="attachment-[^"]*">.*?<\/a><\/p>/g, '')
      : text.replace(/^!?\[[^\]]*\]\(attachment-[^)]*\)\s*$/gm, '');
    if (format === 'html') {
      text = text.replace('</head>', `${htmlStyle}</head>`);
      if (page.coverAttachmentId && files) { const cover = attachmentPath(page.coverAttachmentId); if (cover) text = text.replace('<body>', `<body><img class="cover" src="${relative(file, cover)}" alt="" style="width:100%;max-height:280px;object-fit:cover">`); }
      if (comments) {
        const list = pageComments(state, page);
        // Language-neutral marks (the export is made by the server, which has no interface language): 💬 and ✓.
        if (list.length) text = text.replace('</body>', `<section class="comments"><h2>💬</h2>${list.map(comment => `<div class="comment${comment.resolved ? ' resolved' : ''}"><div class="meta">${comment.createdBy && comment.createdBy !== 'user' ? `${escapeHtml(comment.createdBy)} · ` : ''}${escapeHtml(String(comment.createdAt ?? '').slice(0, 16).replace('T', ' '))}${comment.resolved ? ' ✓' : ''}</div><div>${escapeHtml((comment.richText ?? []).map(run => run.text).join(''))}</div></div>`).join('')}</section></body>`);
      }
    }
    out.set(file, text);
  }

  if (collect) return { entries: out };
  const entries = [...out];
  if (entries.length === 1 && !(entries[0][1] instanceof Uint8Array)) {
    const [file, text] = entries[0];
    const csv = file.endsWith('.csv');
    return { format, filename: file.split('/').pop(), mediaType: csv ? 'text/csv' : format === 'html' ? 'text/html' : 'text/markdown', text, warnings: [] };
  }
  const zip = zipSync(Object.fromEntries(entries.map(([path, value]) => [path, value instanceof Uint8Array ? value : strToU8(value)])), { level: 6 });
  return { format: 'zip', filename: `${fileStem(name, 'Export')}.zip`, mediaType: 'application/zip', encoding: 'base64', text: Buffer.from(zip).toString('base64'), warnings: [] };
}
