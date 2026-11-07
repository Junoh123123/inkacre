// 큰 ZIP 가져오기 (up to 5 GB per ZIP; Markdown, HTML, CSV, Word, Excel, TSV/DSV, ODS, text,
// EPUB and OPML inside). The import window reads the chosen file in pieces: documents arrive here as the text they
// convert to (Markdown, HTML or CSV), every other file as its own stream of bytes, unpacked straight into the blob
// store. Nothing is held whole in memory and no path is extracted; the pages are made by one command at the end
// (planArchiveFiles), so the import undoes as one. Sessions left alone for an hour are dropped.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireThat } from './contracts.mjs';
import { planArchiveFiles, normalized, isDocument } from './archive-content.mjs';
import { parseCsv } from './exchange.mjs';

export const archiveLimits = { zipBytes: 5 * 1024 ** 3, fileBytes: 2 * 1024 ** 3, files: 10000, totalBytes: 20 * 1024 ** 3, textBytes: 512 * 1024 * 1024 };
const mediaType = z.string().regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/);
const startSchema = z.object({ title: z.string().trim().min(1).max(500), parentId: z.string().min(1).nullable().optional() }).strict();
const documentsSchema = z.object({ documents: z.array(z.object({ path: z.string().min(1).max(1000), text: z.string() }).strict()).max(2000) }).strict();
const commitSchema = z.object({ commandId: z.string().min(1), actor: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict();

export class ArchiveImports {
  constructor(workspace) { this.workspace = workspace; this.sessions = new Map(); }
  sweep() { for (const [id, session] of this.sessions) if (Date.now() - session.touched > 60 * 60 * 1000) this.sessions.delete(id); }
  start(body) {
    this.sweep();
    const input = startSchema.parse(body), id = randomUUID();
    this.sessions.set(id, { id, title: input.title, parentId: input.parentId ?? null, documents: new Map(), attachments: new Map(), files: 0, bytes: 0, text: 0, touched: Date.now() });
    return { id, limits: archiveLimits };
  }
  get(id) { const session = this.sessions.get(id); requireThat(session, 'NOT_FOUND', '가져오기 작업을 찾을 수 없습니다. 처음부터 다시 가져오세요.'); session.touched = Date.now(); return session; }
  claim(session, name) {
    const file = normalized(name);
    requireThat(!session.documents.has(file) && !session.attachments.has(file), 'ZIP_PATH', '중복 경로/심볼릭 링크는 허용하지 않습니다.');
    requireThat(++session.files <= archiveLimits.files, 'ZIP_LIMIT', 'ZIP 하나에 파일은 10,000개까지 가져올 수 있습니다. ZIP을 나눠 주세요.');
    return file;
  }
  // Documents as text: .md/.markdown, .html/.htm or .csv by their (converted) names.
  addDocuments(id, body) {
    const session = this.get(id), { documents } = documentsSchema.parse(body);
    for (const item of documents) {
      const file = this.claim(session, item.path);
      requireThat(isDocument(file), 'IMPORT_FORMAT', 'Markdown · HTML · CSV 문서만 글로 보낼 수 있습니다.');
      session.text += Buffer.byteLength(item.text);
      requireThat(session.text <= archiveLimits.textBytes, 'IMPORT_LIMIT', '한 번에 가져오기에는 항목이 너무 많습니다. ZIP을 나눠 주세요.');
      session.documents.set(file, item.text);
    }
    return { documents: session.documents.size, files: session.attachments.size };
  }
  // One file's bytes as they sit in the ZIP (method 0 stored, 8 deflated), checked against its size and CRC-32.
  async addFile(id, query, stream) {
    const session = this.get(id);
    const input = z.object({ path: z.string().min(1).max(1000), method: z.coerce.number().int(), size: z.coerce.number().int().nonnegative(), crc: z.coerce.number().int().nonnegative().optional(), type: mediaType.optional() }).strict().parse(query);
    const file = this.claim(session, input.path);
    requireThat(input.size <= archiveLimits.fileBytes, 'ZIP_LIMIT', '2 GiB보다 큰 파일은 가져올 수 없습니다.');
    requireThat(session.bytes + input.size <= archiveLimits.totalBytes, 'ZIP_LIMIT', '압축을 푼 크기가 너무 큽니다. ZIP을 나눠 주세요.');
    const blob = await this.workspace.putBlobStream(stream, { method: input.method, size: input.size, crc: input.crc ?? null, limit: archiveLimits.fileBytes });
    session.bytes += blob.bytes; session.touched = Date.now();
    session.attachments.set(file, { ...blob, ...(input.type ? { mediaType: input.type } : {}) });
    return { path: file, ...blob };
  }
  plan(session) {
    return planArchiveFiles({ documents: session.documents, attachments: session.attachments, title: session.title, parseCsv, uploaded: url => {
      const match = /^\/api\/attachments\/([^?#]+)$/.exec(url ?? '');
      if (!match) return null;
      const attachment = this.workspace.load().get(decodeURIComponent(match[1]));
      return attachment?.kind === 'attachment' ? { attachmentId: attachment.id, mediaType: attachment.mediaType } : null;
    } });
  }
  operations(session) {
    const { bundle, warnings } = this.plan(session);
    const idMap = Object.fromEntries(bundle.objects.map(object => [object.id, randomUUID()]));
    return { operations: [{ type: 'content.import_bundle', bundle, idMap, ...(session.parentId ? { parentId: session.parentId } : {}) }], warnings, rootId: idMap[bundle.rootId] };
  }
  preview(id) {
    const session = this.get(id), { operations, warnings } = this.operations(session);
    return { ...this.workspace.previewBundle(operations, warnings), documents: session.documents.size, files: session.attachments.size };
  }
  commit(id, body) {
    const session = this.get(id), input = commitSchema.parse(body), { operations, rootId } = this.operations(session);
    const result = this.workspace.execute({ id: input.commandId, actor: input.actor, expectedRevision: input.expectedRevision, operations });
    this.sessions.delete(id);
    return { ...result, pageId: rootId };
  }
  cancel(id) { this.sessions.delete(id); return { cancelled: true }; }
}

