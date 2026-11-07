import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, statSync, unlinkSync, createWriteStream, createReadStream, linkSync, readdirSync, rmSync } from 'node:fs';
import { copyFile as copyFileAsync } from 'node:fs/promises';
import { once } from 'node:events';
import { createInflateRaw, crc32 as zipCrc32 } from 'node:zlib';
import path from 'node:path';
import { richText, commandSchema, recoverySchema, propertyConversionSchema, runLogSchema, runPageSchema, WorkspaceError, requireThat, viewTypes, inlineImageTypes, iconImageTypes, buttonDefinition } from './contracts.mjs';
import { compileFormula, evaluateFormula, formatFormula } from './formula.mjs';
import { isText, textValue } from './formula-values.mjs';
import { querySource, searchWorkspace, listTasks, matchesFilter, statusKind } from './query.mjs';
import { computedTypes, conversionOptions, convertValue } from './conversion.mjs';
import { taskParent, taskDescendants, taskMetadata, validateTasks, scheduleDependencies } from './tasks.mjs';
import { automationOccurrence, occurrence, plannedAutomations, scheduleEnded } from './automation.mjs';
import { exportContent, planImport, importBundle } from './exchange.mjs';
import { aggregate } from './aggregation.mjs';
import { planCapture } from './capture.mjs';
import { FileTextIndex } from './file-text-index.mjs';
// A file's SHA-256 read in pieces (large attachments never sit in memory whole).
const fileDigest = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(value).digest('hex');
export const objectId = () => randomUUID();
const clone = value => structuredClone(value);
const runCommandsSql = `WITH RECURSIVE run_commands(id,run_id) AS (
  SELECT id,json_extract(request,'$.runId') FROM commands WHERE json_type(request,'$.runId')='text'
  UNION
  SELECT c.id,r.run_id FROM commands c JOIN run_commands r ON json_extract(c.request,'$.targetCommandId')=r.id
)`;
const runEventsSql = `${runCommandsSql}, run_events AS (
  SELECT run_id,created_at,json_extract(data,'$.revision') AS revision,1 AS logs,0 AS commands FROM run_logs
  UNION ALL
  SELECT r.run_id,c.created_at,c.revision,0,1 FROM run_commands r JOIN commands c ON c.id=r.id
)`;
function runTarget(state, id, recorded = state.get(id)) {
  let target = state.get(id);
  while (target && !['page', 'source', 'view'].includes(target.kind)) target = state.get(target.parentId);
  return { id, label: recorded?.title || recorded?.name || recorded?.richText?.map(run => run.text).join('').slice(0, 100) || (recorded ? '제목 없는 항목' : '현재 없는 항목'),
    location: target && visible(state, target.id) ? `/?id=${encodeURIComponent(target.id)}` : null };
}

export class Workspace {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.blobDirectory = path.join(this.directory, 'blobs');
    this.commitListeners = new Set();
    mkdirSync(this.blobDirectory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.directory, 'workspace.sqlite'), { timeout: 10000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT OR IGNORE INTO meta VALUES ('revision','0'),('schema_version','1');
      CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, digest TEXT NOT NULL, revision INTEGER NOT NULL UNIQUE,
        actor TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, request TEXT NOT NULL,
        result TEXT NOT NULL, changes TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS run_logs(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL) STRICT;`);
    requireThat(this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value === '1', 'SCHEMA_VERSION', '지원하지 않는 저장소 버전입니다.');
  }
  close() { if (this.closed) return; this.closed = true; this.fileIndex?.close(); this.fileIndex = null; this.commitListeners.clear(); this.db.close(); }
  // After each saved change (the file index, the Markdown mirror): returns a function that stops listening.
  onCommit(listener) { this.commitListeners.add(listener); return () => this.commitListeners.delete(listener); }
  // 첨부 파일 내용 검색 (src/file-text-index.mjs): started by the server; search then reads what attached files say.
  startFileIndex(options) { this.fileIndex ??= new FileTextIndex(this, options); this.fileIndex.schedule(0); return this.fileIndex; }
  searchOptions() { return this.fileIndex ? { fileText: sha256 => this.fileIndex.lookup(sha256) } : {}; }
  fileTextStatus() { return this.fileIndex ? this.fileIndex.status() : null; }
  get revision() { return Number(this.db.prepare("SELECT value FROM meta WHERE key='revision'").get().value); }
  load() { return new Map(this.db.prepare('SELECT id,data FROM objects').all().map(row => [row.id, JSON.parse(row.data)])); }
  read(project) {
    this.db.exec('BEGIN DEFERRED');
    try {
      const revision = this.revision, state = this.load(), result = project(state, revision);
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  snapshot() { return this.read((state, revision) => ({ revision, objects: [...state.values()] })); }
  get(id) {
    return this.read((state, revision) => {
    const entity = state.get(id);
    requireThat(entity, 'NOT_FOUND', '항목을 찾을 수 없습니다.', { id });
    const result = clone(entity);
    result.visible = visible(state, id);
    if (entity.kind === 'page' && entity.sourceId) {
      const read = createReader(state); result.computed = {};
      for (const p of properties(state, entity.sourceId)) result.computed[p.id] = read(entity.id, p.id);
      result.relationDisplay=relationDisplay(state,entity,read);
      result.task = taskMetadata(state, entity, visible);
    }
    if (entity.kind === 'page' || entity.kind === 'block') {
      const parent = entity.blockType === 'synced_reference' ? entity.sourceBlockId : id;
      result.children = children(state, parent).filter(child => child.alive);
      const targets = new Set([id, ...pageBody(state, id).map(block => block.id)]);
      result.comments = [...state.values()].filter(item => item.kind === 'comment' && targets.has(item.parentId) && visible(state, item.id));
    }
    if (entity.kind === 'page') result.backlinks = pageBacklinks(state, id);
    return { revision, entity: result };
    });
  }
  query(input) { return this.read((state, revision) => ({ revision, ...querySource(state, input) })); }
  search(input) { return this.read((state, revision) => ({ revision, ...searchWorkspace(state, input, this.searchOptions()) })); }
  tasks(input = {}) { return this.read((state, revision) => ({ revision, ...listTasks(state, input) })); }
  // The workspace's name and icon, read without loading everything (the workspace list asks every workspace).
  settingsInfo() {
    const row = this.db.prepare("SELECT data FROM objects WHERE id='workspace-settings'").get();
    if (!row) return {};
    const data = JSON.parse(row.data);
    return data.alive === false ? {} : { name: data.name ?? null, icon: data.icon ?? null };
  }
  previewFormula(input) { return this.read((state, revision) => ({ revision, ...previewFormula(state, input) })); }
  export(input) { return this.read((state,revision)=>({revision,...exportContent(this,state,input)})); }
  // What a planned import would make (a large ZIP's: only the count and the first names go back, not its objects).
  previewBundle(operations, warnings = []) {
    return this.read((state, revision) => {
      const before = clone(state), command = commandSchema.parse({ id: objectId(), actor: 'preview', expectedRevision: revision, operations }), context = { actor: 'preview', now: new Date().toISOString(), workspace: this, copies: [], opens: [], preview: true };
      for (const operation of command.operations) applyOperation(state, operation, context);
      validateState(state);
      const changes = [...state.values()].filter(item => canonical(item) !== canonical(before.get(item.id)));
      return { revision, warnings, count: changes.length, pages: changes.filter(item => item.kind === 'page' && !item.sourceId).length, rows: changes.filter(item => item.kind === 'page' && item.sourceId).length, attachments: changes.filter(item => item.kind === 'attachment').length, changes: changes.filter(item => item.kind === 'page' || item.kind === 'source').slice(0, 50).map(({ id, kind, title, name }) => ({ id, kind, title, name })) };
    });
  }
  previewImport(input) {
    return this.read((state,revision)=>{
      const before=clone(state),plan=planImport(state,input);requireThat(Buffer.byteLength(JSON.stringify(plan.operations))<=22*1024*1024,'IMPORT_LIMIT','적용할 자료가 너무 큽니다. 나눠서 가져오세요.');const command=commandSchema.parse({id:objectId(),actor:'preview',expectedRevision:revision,operations:plan.operations}),context={actor:'preview',now:new Date().toISOString(),workspace:this,copies:[],opens:[],preview:true};
      for(const operation of command.operations)applyOperation(state,operation,context);
      validateState(state);scheduleDependencies(state,before,visible);validateState(state);
      return {revision,operations:command.operations,warnings:plan.warnings,changes:[...state.values()].filter(item=>canonical(item)!==canonical(before.get(item.id))).map(({id,kind,title,name})=>({id,kind,title,name})),copies:context.copies};
    });
  }
  previewPropertyConversion(input) {
    const operation = propertyConversionSchema.parse(input);
    return this.read((state, revision) => {
      const before = clone(state), original = getEntity(before, operation.id, 'property');
      try {
        const normalized = convertProperty(state, operation, { actor: 'preview', now: new Date().toISOString() });
        validateState(state);
        const oldRead = createReader(before, { includeTrashed: true }), newRead = createReader(state, { includeTrashed: true });
        const changes = [...state.values()].filter(item => item.kind === 'page' && item.sourceId === original.sourceId).map(page => ({ pageId: page.id, title: page.title,
          before: oldRead(page.id, original.id), after: newRead(page.id, original.id), visible: visible(state, page.id) }));
        const effects = [];
        for (const page of state.values()) if (page.kind === 'page' && page.sourceId) {
          for (const property of properties(state, page.sourceId).filter(item => ['formula', 'rollup'].includes(item.type) && item.id !== original.id)) {
            const from = oldRead(page.id, property.id), to = newRead(page.id, property.id);
            if (canonical(from) !== canonical(to)) effects.push({ pageId: page.id, title: page.title, propertyId: property.id, name: property.name, before: from, after: to });
          }
        }
        const chartEffects = [];
        const chartBars = (snapshot, viewId) => {
          try { return querySource(snapshot, { viewId }).presentation.bars; }
          catch (error) {
            if (!(error instanceof WorkspaceError)) throw error;
            return [{ key: 'null', rowIds: [], errors: [], value: { error: { code: error.code, message: error.message } } }];
          }
        };
        for (const view of state.values()) if (view.kind === 'view' && view.viewType === 'chart' && visible(state, view.id)) {
          const from = chartBars(before, view.id), to = chartBars(state, view.id);
          if (canonical(from) !== canonical(to)) chartEffects.push({ viewId: view.id, name: view.name, before: from, after: to });
        }
        return { revision, allowed: true, operation: normalized, property: { before: original, after: clone(state.get(original.id)) }, changes, effects, chartEffects,
          viewChanges: [...state.values()].filter(item => item.kind === 'view' && canonical(item.config) !== canonical(before.get(item.id)?.config)).map(item => ({ id: item.id, name: item.name, before: before.get(item.id).config, after: item.config })),
          notes: original.inversePropertyId ? ['기존 반대쪽 관계는 단방향 관계로 유지합니다.'] : [] };
      } catch (error) {
        if (!(error instanceof WorkspaceError)) throw error;
        return { revision, allowed: false, error: { code: error.code, message: error.message, details: error.details } };
      }
    });
  }
  stateAt(revision, currentState = this.load(), currentRevision = this.revision) {
    requireThat(Number.isInteger(revision) && revision >= 0 && revision <= currentRevision, 'HISTORY_REVISION', '저장된 revision 범위에서 선택하세요.');
    const state = clone(currentState);
    for (const row of this.db.prepare('SELECT changes FROM commands WHERE revision>? ORDER BY revision DESC').iterate(revision)) {
      for (const change of JSON.parse(row.changes)) {
        if (change.before === null) state.delete(change.id); else state.set(change.id, change.before);
      }
    }
    return state;
  }
  // 타임머신: the whole workspace as it was after a revision (its window reads pages, views and search from it).
  // The rebuilt state is kept for the next read of the same moment, as long as nothing new happened.
  pastState(at, current, currentRevision) {
    const key = `${at}:${currentRevision}`;
    if (this.past?.key !== key) this.past = { key, state: this.stateAt(at, current, currentRevision) };
    return this.past.state;
  }
  readAt(at, project) {
    if (at == null) return this.read(project);
    return this.read((current, revision) => project(this.pastState(at, current, revision), at, revision));
  }
  revisionTime(revision) { return this.db.prepare('SELECT created_at FROM commands WHERE revision=?').get(revision)?.created_at ?? null; }
  snapshotAt(at) {
    return this.readAt(at, (state, revision, currentRevision) => ({ revision, currentRevision, at: this.revisionTime(revision), objects: [...state.values()] }));
  }
  // The last revision made at or before a moment, and what it was (for choosing a moment in the time machine).
  revisionAt(time) {
    const moment = new Date(time);
    requireThat(!Number.isNaN(moment.getTime()), 'HISTORY_TIME', '날짜와 시각을 확인하세요.');
    const row = this.db.prepare('SELECT revision, created_at, actor, kind FROM commands WHERE created_at<=? ORDER BY revision DESC LIMIT 1').get(moment.toISOString());
    const first = this.db.prepare('SELECT created_at FROM commands ORDER BY revision ASC LIMIT 1').get();
    return { revision: row?.revision ?? 0, at: row?.created_at ?? null, actor: row?.actor ?? null, kind: row?.kind ?? null, currentRevision: this.revision, first: first?.created_at ?? null };
  }
  revisionInfo(revision) {
    const current = this.revision;
    requireThat(Number.isInteger(revision) && revision >= 0 && revision <= current, 'HISTORY_REVISION', '저장된 revision 범위에서 선택하세요.');
    const row = this.db.prepare('SELECT created_at, actor, kind FROM commands WHERE revision=?').get(revision);
    return { revision, at: row?.created_at ?? null, actor: row?.actor ?? null, kind: row?.kind ?? null, currentRevision: current };
  }
  // 빠른 기록 (src/capture.mjs): a line, to-do or bullet on a page, or a row in a database, from outside the app.
  capture(input) {
    const plan = this.read(state => planCapture(state, input));
    const source = typeof input?.source === 'string' && /^[\w .-]{1,40}$/.test(input.source.trim()) ? input.source.trim() : null;
    const result = this.execute({ id: objectId(), actor: source ? `capture:${source}` : 'capture', expectedRevision: this.revision, operations: plan.operations });
    return { revision: result.revision, commandId: result.commandId, pageId: plan.pageId, title: plan.title, ...(plan.blockIds ? { blockIds: plan.blockIds } : {}), ...(plan.sourceId ? { sourceId: plan.sourceId } : {}) };
  }
  // A page from the time machine brought back: its content as it was (and its databases' rows) when it still exists or
  // sits in the trash; otherwise — or when asked — a copy of it and everything under it, as a new page beside it.
  restoreFromPast(input) {
    const plan = this.read((current, currentRevision) => {
      const past = this.pastState(input.revision, current, currentRevision), then = past.get(input.pageId), now = current.get(input.pageId);
      requireThat(then?.kind === 'page' && visible(past, then.id), 'RESTORE_PAGE', '그 시점에는 이 페이지가 없었습니다.');
      const inTrash = now?.kind === 'page' && !now.alive && !now.purged && (now.parentId == null || visible(current, now.parentId) || !!now.sourceId);
      if (input.mode === 'restore' && now?.kind === 'page' && (visible(current, now.id) || inTrash)) {
        const operations = inTrash ? [{ type: 'node.restore', id: now.id }] : [];
        operations.push({ type: 'page.restore_version', id: now.id, revision: input.revision });
        for (const source of children(past, then.id)) if (source.kind === 'source' && visible(past, source.id) && current.get(source.id)?.kind === 'source' && current.get(source.id).alive) operations.push({ type: 'source.restore_version', id: source.id, revision: input.revision });
        return { operations, pageId: now.id, mode: 'restore' };
      }
      requireThat(!then.sourceId, 'RESTORE_ROW', '지금은 없는 데이터베이스 행은 되살릴 수 없습니다. 데이터베이스 페이지를 되살리세요.');
      const bundle = JSON.parse(exportContent(this, past, { id: then.id, format: 'bundle' }).text);
      const root = bundle.objects.find(item => item.id === bundle.rootId);
      root.title = input.title ?? `${then.title || ''} (${String(this.revisionTime(input.revision) ?? '').slice(0, 16).replace('T', ' ')})`.trim();
      const parentId = then.parentId && current.get(then.parentId)?.kind === 'page' && visible(current, then.parentId) ? then.parentId : null;
      const imported = planImport(current, { format: 'bundle', text: JSON.stringify(bundle), parentId, title: root.title });
      return { operations: imported.operations, pageId: imported.operations[0].idMap[bundle.rootId], mode: 'copy' };
    });
    const result = this.execute({ id: input.commandId, actor: input.actor, expectedRevision: input.expectedRevision, operations: plan.operations });
    return { ...result, pageId: plan.pageId, mode: plan.mode };
  }
  pageVersion(pageId, revision) {
    return this.read((current, currentRevision) => {
      const state = this.stateAt(revision, current, currentRevision), page = getEntity(state, pageId, 'page');
      const read = createReader(state);
      return { revision, currentRevision, entity: clone(page), blocks: pageBody(state, pageId),
        properties: page.sourceId ? properties(state, page.sourceId).map(property => ({ ...property, value: read(page.id, property.id) })) : [],
        scope: 'page-title-icon-values-and-owned-blocks; parent/source/schema/comments unchanged on restore' };
    });
  }
  // A database at an earlier revision: its properties and rows (the first 200), for 버전 기록 before a restore.
  sourceVersion(sourceId, revision) {
    return this.read((current, currentRevision) => {
      const state = this.stateAt(revision, current, currentRevision), source = getEntity(state, sourceId, 'source', true), read = createReader(state);
      const schema = properties(state, sourceId), rows = [...state.values()].filter(item => item.kind === 'page' && item.sourceId === sourceId && !item.template && item.alive).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      return { revision, currentRevision, source: { id: source.id, name: source.name }, properties: schema.map(property => ({ id: property.id, name: property.name, type: property.type, options: property.options })),
        total: rows.length, rows: rows.slice(0, 200).map(row => ({ id: row.id, title: row.title, icon: row.icon ?? null, values: Object.fromEntries(schema.map(property => [property.id, read(row.id, property.id)])) })) };
    });
  }
  history(limit = 50, pageId, sourceId) {
    limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    // A database's versions: commands that touched its rows (and their content) or its properties.
    if (sourceId) return this.read(state => {
      getEntity(state, sourceId, 'source', true);
      const owner = (current, entity) => { let item = entity; while (item && item.kind === 'block') item = current.get(item.parentId); return item; };
      const touches = (current, entity) => !!entity && (entity.id === sourceId || entity.sourceId === sourceId && ['page', 'property'].includes(entity.kind) || entity.kind === 'block' && owner(current, entity)?.sourceId === sourceId);
      const result = [];
      for (const row of this.db.prepare('SELECT id,revision,actor,kind,created_at,result,changes FROM commands ORDER BY revision DESC').iterate()) {
        const changes = JSON.parse(row.changes);
        let affected = changes.some(change => touches(state, change.after ?? change.before));
        for (const change of changes) { if (change.before === null) state.delete(change.id); else state.set(change.id, change.before); }
        affected ||= changes.some(change => touches(state, change.before ?? change.after));
        if (affected) { const { changes: ignored, ...entry } = row; result.push({ ...entry, result: JSON.parse(row.result) }); }
        if (result.length === limit) break;
      }
      return result;
    });
    if (!pageId) return this.db.prepare('SELECT id,revision,actor,kind,created_at,result FROM commands ORDER BY revision DESC LIMIT ?').all(limit).map(row => ({ ...row, result: JSON.parse(row.result) }));
    return this.read(state => {
      getEntity(state, pageId, 'page', true);
      const result = [];
      for (const row of this.db.prepare('SELECT id,revision,actor,kind,created_at,result,changes FROM commands ORDER BY revision DESC').iterate()) {
        const changes = JSON.parse(row.changes);
        // Naming a version, locking or archiving the page is not a version of its content.
        const metaOnly = change => change.before && change.after && Object.keys({ ...change.before, ...change.after }).every(key => ['versionNames', 'locked', 'archived', 'archivedAt', 'wiki', 'version', 'updatedAt', 'updatedBy'].includes(key) || canonical(change.before[key]) === canonical(change.after[key]));
        const touches = change => change.id === pageId && !metaOnly(change) || (change.after ?? change.before)?.kind === 'block' && belongsToPage(state, change.id, pageId);
        let affected = changes.some(touches);
        for (const change of changes) { if (change.before === null) state.delete(change.id); else state.set(change.id, change.before); }
        affected ||= changes.some(touches);
        if (affected) { const { changes: ignored, ...entry } = row; result.push({ ...entry, result: JSON.parse(row.result) }); }
        if (result.length === limit) break;
      }
      return result;
    });
  }
  // 업데이트 목록 (page ⋯ › 업데이트 및 분석): the page's edits newest first — runs of one actor's commands within ten
  // minutes merge into one entry (title, property values before → after, blocks added / removed / changed), and each
  // new comment on the page or one of its blocks is an entry of its own.
  updates(pageId, limit = 30) {
    limit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const WINDOW = 10 * 60 * 1000, same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
    return this.read(state => {
      getEntity(state, pageId, 'page', true);
      const entries = [], order = new Map(pageBody(state, pageId).map((block, index) => [block.id, index]));
      let group = null;
      const flush = () => { if (group && (group.title || group.values.size || group.blocks.size || group.created)) entries.push(group); group = null; };
      const onPage = (current, entity) => entity && (entity.kind === 'block' ? belongsToPage(current, entity.id, pageId) : entity.kind === 'comment' ? belongsToPage(current, entity.parentId, pageId) : false);
      for (const row of this.db.prepare('SELECT revision,actor,created_at,changes FROM commands ORDER BY revision DESC').iterate()) {
        if (entries.length >= limit) break;
        const changes = JSON.parse(row.changes);
        const after = new Set(changes.filter(change => change.id === pageId || onPage(state, change.after ?? change.before)).map(change => change.id));
        for (const change of changes) { if (change.before === null) state.delete(change.id); else state.set(change.id, change.before); }
        for (const change of changes) if (change.id === pageId || onPage(state, change.before ?? change.after)) after.add(change.id);
        const relevant = changes.filter(change => after.has(change.id));
        if (!relevant.length) continue;
        const at = Date.parse(row.created_at);
        for (const change of relevant) {
          const entity = change.after ?? change.before;
          if (entity.kind === 'comment' && change.before === null) {
            flush();
            entries.push({ kind: 'comment', actor: row.actor, at: row.created_at, revision: row.revision, commentId: change.id });
          }
        }
        const edits = relevant.filter(change => { const entity = change.after ?? change.before; return entity.kind !== 'comment'; });
        if (!edits.length) continue;
        if (!group || group.actor !== row.actor || Date.parse(group.since) - at > WINDOW) { flush(); group = { kind: 'edit', actor: row.actor, at: row.created_at, since: row.created_at, revision: row.revision, firstRevision: row.revision, title: null, values: new Map(), blocks: new Map(), created: false }; }
        group.since = row.created_at; group.firstRevision = row.revision;
        for (const change of edits) {
          const entity = change.after ?? change.before;
          if (change.id === pageId) {
            if (!change.before) { group.created = true; group.kind = 'create'; }
            const beforeTitle = change.before?.title ?? '', afterTitle = change.after?.title ?? '';
            if (beforeTitle !== afterTitle) group.title = { before: beforeTitle, after: group.title ? group.title.after : afterTitle };
            for (const key of new Set([...Object.keys(change.before?.values ?? {}), ...Object.keys(change.after?.values ?? {})])) {
              const was = change.before?.values?.[key] ?? null, now = change.after?.values?.[key] ?? null;
              if (same(was, now)) continue;
              const known = group.values.get(key);
              group.values.set(key, { propertyId: key, before: was, after: known ? known.after : now });
            }
          } else if (entity.kind === 'block') {
            const known = group.blocks.get(change.id);
            group.blocks.set(change.id, { before: change.before && change.before.alive ? change.before : null, after: known ? known.after : change.after && change.after.alive ? change.after : null });
          }
        }
      }
      flush();
      const current = this.load();
      return entries.slice(0, limit).map(entry => {
        if (entry.kind === 'comment') {
          const comment = current.get(entry.commentId);
          const anchor = comment && current.get(comment.parentId)?.kind === 'block' ? (current.get(comment.parentId).richText ?? []).filter(run => run.comments?.includes(comment.threadId ?? comment.id)) : [];
          return { ...entry, comment: comment ? { id: comment.id, threadId: comment.threadId ?? null, parentId: comment.parentId, richText: comment.richText, alive: comment.alive, resolved: !!comment.resolved, edited: !comment.resolved && comment.updatedAt !== comment.createdAt, anchor: anchor.map(run => ({ text: run.text })) } : null };
        }
        const values = [...entry.values.values()].filter(value => current.get(value.propertyId)?.kind === 'property' && current.get(value.propertyId).alive);
        const blocks = [...entry.blocks.entries()].flatMap(([id, { before, after }]) => {
          if (!before && !after) return [];
          if (before && after && same(before.richText, after.richText) && before.blockType === after.blockType && same(before.checked, after.checked)) return [];
          const change = !before ? 'added' : !after ? 'removed' : 'edited';
          const block = after ?? before;
          return [{ id, change, blockType: block.blockType, checked: block.checked ?? null, richText: block.richText ?? [], beforeRichText: change === 'edited' ? before.richText ?? [] : null, depth: 0 }];
        }).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
        const { values: ignored, blocks: ignoredBlocks, created, ...rest } = entry;
        return { ...rest, properties: values, blocks };
      }).filter(entry => entry.kind === 'comment' ? entry.comment : entry.title || entry.properties.length || entry.blocks.length || entry.kind === 'create');
    });
  }
  recordRun(input) {
    const { id = objectId(), ...fields } = runLogSchema.parse(input), request = { id, ...fields };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT data,created_at FROM run_logs WHERE id=?').get(id);
      let data;
      if (previous) {
        data = { ...JSON.parse(previous.data), createdAt: previous.created_at };
        const { revision, createdAt, ...original } = data;
        requireThat(canonical(original) === canonical(request), 'RUN_LOG_ID_REUSED', '같은 기록 ID에 다른 내용을 사용할 수 없습니다.');
      } else {
        data = { ...request, revision: this.revision, createdAt: new Date().toISOString() };
        this.db.prepare('INSERT INTO run_logs VALUES (?,?,?,?)').run(id, data.runId, data.createdAt, JSON.stringify(data));
      }
      this.db.exec('COMMIT'); return data;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  runs(runId) { return this.db.prepare('SELECT data,created_at FROM run_logs WHERE run_id=? ORDER BY created_at,id').all(runId).map(row => ({ ...JSON.parse(row.data), createdAt: row.created_at })); }
  listRuns(input = {}) {
    const { limit, offset } = runPageSchema.parse(input);
    return this.read((state, revision) => {
      const total = this.db.prepare(`${runEventsSql} SELECT COUNT(DISTINCT run_id) AS total FROM run_events`).get().total;
      const runs = this.db.prepare(`${runEventsSql} SELECT run_id AS runId,MIN(created_at) AS createdAt,MAX(created_at) AS updatedAt,
        MAX(revision) AS lastRevision,SUM(logs) AS logCount,SUM(commands) AS commandCount,
        (SELECT substr(json_extract(data,'$.message'),1,120) FROM run_logs l WHERE l.run_id=e.run_id ORDER BY created_at DESC,id DESC LIMIT 1) AS summary
        FROM run_events e GROUP BY run_id ORDER BY updatedAt DESC,lastRevision DESC,runId LIMIT ? OFFSET ?`).all(limit, offset);
      return { revision, runs, total, offset, hasMore: offset + runs.length < total };
    });
  }
  runDetail(runId, input = {}) {
    const { limit, offset } = runPageSchema.parse(input);
    return this.read((state, revision) => {
      const logs = this.runs(runId).map(log => ({ ...log, targets: log.changedIds.map(id => runTarget(state, id)) }));
      const commandTotal = this.db.prepare(`${runCommandsSql} SELECT COUNT(*) AS total FROM run_commands WHERE run_id=?`).get(runId).total;
      requireThat(logs.length || commandTotal, 'NOT_FOUND', '실행 기록을 찾을 수 없습니다.');
      const commands = this.db.prepare(`${runCommandsSql} SELECT c.id,c.revision,c.actor,c.kind,c.created_at,c.result,c.changes
        FROM commands c JOIN run_commands r ON c.id=r.id WHERE r.run_id=? ORDER BY c.revision DESC LIMIT ? OFFSET ?`).all(runId, limit, offset)
        .map(({ result, changes, ...row }) => ({ ...row, result: JSON.parse(result), changes: JSON.parse(changes).map(change => runTarget(state, change.id, change.after ?? change.before)) }));
      return { revision, runId, logs, commands, commandTotal, offset, hasMore: offset + commands.length < commandTotal };
    });
  }
  execute(input) {
    const command = commandSchema.parse(input);
    return this.commit(command, 'apply', (state, context) => {
      const watch = automationWatch(state);
      context.automated = new Set();
      for (const operation of command.operations) applyOperation(state, operation, context);
      if (watch) runAutomations(state, watch, context);
    });
  }
  tick(at = new Date().toISOString()) {
    const jobs = this.read((state, revision) => ({ revision, jobs: plannedAutomations(state, at, visible) }));
    return jobs.jobs.length ? this.execute({ id: `scheduler:${objectId()}`, actor: 'scheduler', expectedRevision: jobs.revision, operations: [{ type: 'scheduler.tick', at }] }) : null;
  }
  undo(input) {
    const command = recoverySchema.parse(input);
    return this.commit(command, 'undo', state => {
      const target = this.db.prepare('SELECT changes FROM commands WHERE id=?').get(command.targetCommandId);
      requireThat(target, 'NOT_FOUND', '복구할 명령을 찾을 수 없습니다.');
      const changes = JSON.parse(target.changes);
      const conflicts = changes.filter(change => canonical(state.get(change.id) ?? null) !== canonical(change.after)).map(change => ({ id: change.id, current: state.get(change.id) ?? null, expected: change.after }));
      requireThat(!conflicts.length, 'UNDO_CONFLICT', '이후 수정된 항목이 있어 자동으로 되돌릴 수 없습니다.', { conflicts });
      for (const change of changes) {
        if (change.before === null) state.delete(change.id);
        else state.set(change.id, clone(change.before));
      }
    });
  }
  commit(command, kind, mutate) {
    const requestDigest = digest(canonical({ kind, command }));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT digest,result FROM commands WHERE id=?').get(command.id);
      if (previous) {
        requireThat(previous.digest === requestDigest, 'COMMAND_ID_REUSED', '같은 명령 ID에 다른 내용을 사용할 수 없습니다.');
        this.db.exec('COMMIT'); return { ...JSON.parse(previous.result), replayed: true };
      }
      const revision = this.revision;
      requireThat(command.expectedRevision === revision, 'REVISION_CONFLICT', '다른 변경이 저장됐습니다. 최신 상태를 확인하세요.', { expectedRevision: command.expectedRevision, currentRevision: revision });
      const state = this.load(), before = clone(state), now = new Date().toISOString();
      const context = { actor: command.actor, now, workspace: this, copies: [], opens: [], commandId: command.id };
      mutate(state, context);
      validateState(state);
      if (kind === 'apply') { scheduleDependencies(state, before, visible); validateState(state); }
      const changes = [];
      for (const id of new Set([...before.keys(), ...state.keys()])) {
        const old = before.get(id) ?? null, next = state.get(id) ?? null;
        if (canonical(old) === canonical(next)) continue;
        if (next) { next.version = revision + 1; next.updatedAt = now; next.updatedBy = command.actor; }
        changes.push({ id, before: old, after: next });
      }
      const upsert = this.db.prepare('INSERT INTO objects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data');
      for (const change of changes) {
        if (change.after) upsert.run(change.id, change.after.kind, JSON.stringify(change.after));
        else this.db.prepare('DELETE FROM objects WHERE id=?').run(change.id);
      }
      const result = {
        commandId: command.id, revision: revision + 1, replayed: false, undoHandle: command.id,
        changes: changes.map(change => ({ id: change.id, kind: (change.after ?? change.before).kind,
          fields: [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])].filter(key => canonical(change.before?.[key]) !== canonical(change.after?.[key])),
          alive: change.after?.alive ?? false, location: `/?id=${encodeURIComponent(change.id)}` })),
        derived: { revision: revision + 1, strategy: 'computed-on-read' },
        ...(context.copies.length ? { copies: context.copies } : {}),
        ...(context.opens.length ? { opens: context.opens } : {}),
        ...(context.openUrls?.length ? { openUrls: context.openUrls } : {}),
      };
      this.db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(result.revision));
      this.db.prepare('INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?)').run(command.id, requestDigest, result.revision, command.actor, kind, now, JSON.stringify(command), JSON.stringify(result), JSON.stringify(changes));
      this.db.exec('COMMIT');
      for (const listener of this.commitListeners) { try { listener(changes, result); } catch { /* a listener never undoes a saved change */ } }
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  putBlob(bytes) {
    const sha256 = digest(bytes), destination = path.join(this.blobDirectory, sha256);
    if (!existsSync(destination)) {
      const temporary = `${destination}.${objectId()}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temporary, destination);
    }
    requireThat(digest(readFileSync(destination)) === sha256, 'BLOB_INTEGRITY', '첨부 파일 해시가 일치하지 않습니다.');
    return { sha256, bytes: bytes.length };
  }
  // A blob already in the store with this hash and size (a large import's files arrive before its pages).
  hasBlob(sha256, bytes) {
    if (!/^[a-f0-9]{64}$/.test(String(sha256))) return false;
    try { return statSync(path.join(this.blobDirectory, sha256)).size === bytes; } catch { return false; }
  }
  // Bytes streamed in (a ZIP entry as stored, or deflated: method 8), written to the store as they come with their
  // SHA-256 counted on the way; the declared size and CRC-32 must match, so a damaged or swollen entry is refused.
  async putBlobStream(source, { method = 0, size, crc = null, limit = 2 * 1024 ** 3 }) {
    requireThat(Number.isSafeInteger(size) && size >= 0 && size <= limit && [0, 8].includes(method), 'ZIP_LIMIT', '파일이 너무 크거나 압축 방식을 지원하지 않습니다.');
    mkdirSync(this.blobDirectory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.blobDirectory, `upload.${objectId()}.tmp`), out = createWriteStream(temporary, { mode: 0o600, flags: 'wx' });
    let stream = source;
    if (method === 8) { stream = createInflateRaw(); source.on('error', error => stream.destroy(error)); source.pipe(stream); }
    const hash = createHash('sha256'); let written = 0, check = 0;
    try {
      for await (const chunk of stream) {
        written += chunk.length;
        requireThat(written <= size, 'ZIP_DATA', 'ZIP 파일 크기/CRC가 맞지 않습니다.');
        hash.update(chunk); check = zipCrc32(chunk, check);
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end(); await once(out, 'finish');
      requireThat(written === size && (crc == null || check === crc), 'ZIP_DATA', 'ZIP 파일 크기/CRC가 맞지 않습니다.');
      const sha256 = hash.digest('hex'), destination = path.join(this.blobDirectory, sha256);
      if (existsSync(destination)) unlinkSync(temporary); else renameSync(temporary, destination);
      return { sha256, bytes: written };
    } catch (error) {
      out.destroy(); if (method === 8) stream.destroy();
      try { unlinkSync(temporary); } catch { /* not written */ }
      if (error.code && !String(error.code).startsWith('Z_') && !String(error.code).startsWith('ERR_')) throw error;
      throw new WorkspaceError('ZIP_DATA', '압축 해제에 실패했습니다.');
    }
  }
  // A large attachment is sent from its file in pieces (a range when asked, as video players do) instead of read whole.
  attachmentFile(id) {
    const entity = this.load().get(id);
    requireThat(entity?.kind === 'attachment' && entity.alive, 'NOT_FOUND', '첨부 파일을 찾을 수 없습니다.');
    const file = path.join(this.blobDirectory, entity.sha256);
    requireThat(existsSync(file) && statSync(file).size === entity.bytes, 'BLOB_INTEGRITY', '첨부 파일 내용이 손상됐습니다.');
    return { entity, file };
  }
  attachmentBytes(id) {
    const entity = this.load().get(id);
    requireThat(entity?.kind === 'attachment' && entity.alive, 'NOT_FOUND', '첨부 파일을 찾을 수 없습니다.');
    const bytes = readFileSync(path.join(this.blobDirectory, entity.sha256));
    requireThat(bytes.length === entity.bytes && digest(bytes) === entity.sha256, 'BLOB_INTEGRITY', '첨부 파일 내용이 손상됐습니다.');
    return { entity, bytes };
  }
  // A backup: the SQLite file as of now (the online backup API), every attachment any revision still refers to, and a
  // manifest with their hashes. Each blob comes from the previous backup in the same place when it is there (a hard
  // link: no extra space, checked when that backup was made); otherwise the live file is hashed and copied — never
  // linked, so nothing done to a backup can touch the workspace's own files. root: where backups go (default
  // <data>/backups); auto: made on a schedule (only those are pruned).
  async createBackup({ root = path.join(this.directory, 'backups'), auto = false, previous = null, workspaceKey = null } = {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let destination = path.join(root, `${stamp}-${auto ? 'auto' : 'manual'}`);
    for (let n = 2; existsSync(destination) || existsSync(`${destination}.partial`); n++) destination = path.join(root, `${stamp}-${auto ? 'auto' : 'manual'}-${n}`);
    // Made in a ".partial" folder and renamed when complete; a failed one is removed, so nothing half-made is ever
    // listed, used as the previous backup, or left filling the disk.
    const final = destination;
    destination = `${final}.partial`;
    mkdirSync(path.join(destination, 'blobs'), { recursive: true, mode: 0o700 });
    let copiedDb = null;
    try {
      await backup(this.db, path.join(destination, 'workspace.sqlite'));
      copiedDb = new DatabaseSync(path.join(destination, 'workspace.sqlite'), { readOnly: true });
      const revision = Number(copiedDb.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
      const retained = new Map();
      const retain = file => { if (file?.kind === 'attachment') retained.set(`${file.id}:${file.sha256}`, file); };
      copiedDb.prepare("SELECT data FROM objects WHERE kind='attachment'").all().forEach(row => retain(JSON.parse(row.data)));
      for (const row of copiedDb.prepare('SELECT changes FROM commands').all()) {
        for (const change of JSON.parse(row.changes)) { retain(change.before); retain(change.after); }
      }
      const name = JSON.parse(copiedDb.prepare("SELECT data FROM objects WHERE id='workspace-settings'").get()?.data ?? '{}').name ?? null;
      const files = [...retained.values()], placed = new Map();
      for (const file of files) {
        if (placed.has(file.sha256)) continue;
        const target = path.join(destination, 'blobs', file.sha256), earlier = previous && path.join(previous, 'blobs', file.sha256);
        // From the previous backup only when its copy still has the right content (one damaged copy never spreads).
        if (earlier && statSync(earlier, { throwIfNoEntry: false })?.size === file.bytes && await fileDigest(earlier) === file.sha256) {
          try { linkSync(earlier, target); placed.set(file.sha256, true); continue; } catch { /* another disk: copied below */ }
        }
        const source = path.join(this.blobDirectory, file.sha256);
        // A damaged or missing attachment is recorded and left out; the rest is still backed up.
        if (statSync(source, { throwIfNoEntry: false })?.size !== file.bytes || await fileDigest(source) !== file.sha256) { placed.set(file.sha256, false); continue; }
        await copyFileAsync(source, target);
        placed.set(file.sha256, true);
      }
      const damaged = files.filter(file => placed.get(file.sha256) === false).map(file => ({ id: file.id, sha256: file.sha256, bytes: file.bytes }));
      const manifest = { schemaVersion: 1, revision, sqliteSha256: digest(readFileSync(path.join(destination, 'workspace.sqlite'))), attachments: files.filter(file => placed.get(file.sha256)).map(file => ({ id: file.id, sha256: file.sha256, bytes: file.bytes })), completedAt: new Date().toISOString(),
        auto, ...(workspaceKey ? { workspace: workspaceKey } : {}), ...(name ? { workspaceName: name } : {}), ...(damaged.length ? { damaged } : {}) };
      writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      copiedDb.close(); copiedDb = null;
      renameSync(destination, final);
      return { destination: final, ...manifest };
    } catch (error) {
      try { copiedDb?.close(); } catch { /* closed */ }
      rmSync(destination, { recursive: true, force: true });
      throw error;
    } finally { try { copiedDb?.close(); } catch { /* closed */ } }
  }
  // A backup checked whole: the manifest, the SQLite file's hash, integrity and revision, every attachment's hash.
  static async verifyBackup(backupDirectory) {
    const source = path.resolve(backupDirectory);
    const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    requireThat(manifest.schemaVersion === 1 && Array.isArray(manifest.attachments), 'BACKUP_MANIFEST', '지원하지 않는 백업 manifest입니다.');
    requireThat(digest(readFileSync(path.join(source, 'workspace.sqlite'))) === manifest.sqliteSha256, 'BACKUP_INTEGRITY', 'SQLite 백업 해시가 일치하지 않습니다.');
    for (const file of manifest.attachments) {
      requireThat(/^[a-f0-9]{64}$/.test(file.sha256), 'BACKUP_MANIFEST', '첨부 해시 형식을 확인하세요.');
      const blob = path.join(source, 'blobs', file.sha256);
      requireThat(statSync(blob, { throwIfNoEntry: false })?.size === file.bytes && await fileDigest(blob) === file.sha256, 'BACKUP_INTEGRITY', '첨부 백업 해시가 일치하지 않습니다.');
    }
    const checked = new DatabaseSync(path.join(source, 'workspace.sqlite'), { readOnly: true });
    try {
      requireThat(Object.values(checked.prepare('PRAGMA quick_check').get())[0] === 'ok', 'BACKUP_INTEGRITY', 'SQLite 백업이 손상됐습니다.');
      requireThat(Number(checked.prepare("SELECT value FROM meta WHERE key='revision'").get().value) === manifest.revision, 'BACKUP_INTEGRITY', '백업 revision이 일치하지 않습니다.');
    } finally { checked.close(); }
    return manifest;
  }
  // Into a new folder (or an empty one made for it, as a new workspace is), never over existing data.
  static restoreBackup(backupDirectory, newDirectory, { emptyFolder = false } = {}) {
    const source = path.resolve(backupDirectory), target = path.resolve(newDirectory);
    requireThat(!existsSync(target) || emptyFolder && readdirSync(target).length === 0, 'RESTORE_TARGET_EXISTS', '기존 자료를 덮어쓰지 않습니다. 새 복원 폴더를 지정하세요.');
    const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    requireThat(manifest.schemaVersion === 1 && Array.isArray(manifest.attachments), 'BACKUP_MANIFEST', '지원하지 않는 백업 manifest입니다.');
    requireThat(digest(readFileSync(path.join(source, 'workspace.sqlite'))) === manifest.sqliteSha256, 'BACKUP_INTEGRITY', 'SQLite 백업 해시가 일치하지 않습니다.');
    for (const file of manifest.attachments) {
      requireThat(/^[a-f0-9]{64}$/.test(file.sha256), 'BACKUP_MANIFEST', '첨부 해시 형식을 확인하세요.');
      const bytes = readFileSync(path.join(source, 'blobs', file.sha256));
      requireThat(bytes.length === file.bytes && digest(bytes) === file.sha256, 'BACKUP_INTEGRITY', '첨부 백업 해시가 일치하지 않습니다.');
    }
    const checked = new DatabaseSync(path.join(source, 'workspace.sqlite'), { readOnly: true });
    try {
      requireThat(Object.values(checked.prepare('PRAGMA quick_check').get())[0] === 'ok', 'BACKUP_INTEGRITY', 'SQLite 백업이 손상됐습니다.');
      requireThat(Number(checked.prepare("SELECT value FROM meta WHERE key='revision'").get().value) === manifest.revision, 'BACKUP_INTEGRITY', '백업 revision이 일치하지 않습니다.');
    } finally { checked.close(); }
    mkdirSync(path.join(target, 'blobs'), { recursive: true, mode: 0o700 });
    copyFileSync(path.join(source, 'workspace.sqlite'), path.join(target, 'workspace.sqlite'));
    for (const file of manifest.attachments) { const to = path.join(target, 'blobs', file.sha256); if (!existsSync(to)) copyFileSync(path.join(source, 'blobs', file.sha256), to); }
    writeFileSync(path.join(target, 'restored-from.json'), JSON.stringify({ source, revision: manifest.revision, restoredAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return { destination: target, revision: manifest.revision };
  }
}

export function children(state, parentId) { return [...state.values()].filter(entity => entity.parentId === parentId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)); }
export function properties(state, sourceId) { return [...state.values()].filter(entity => entity.kind === 'property' && entity.sourceId === sourceId && entity.alive).sort((a, b) => a.position - b.position); }
export function relationDisplay(state,page,read=createReader(state)) {return Object.fromEntries(properties(state,page.sourceId).filter(p=>p.type==='relation'&&p.displayProperties?.length).map(p=>[p.id,(read(page.id,p.id)??[]).map(id=>({id,title:state.get(id).title,fields:p.displayProperties.map(propertyId=>({propertyId,name:state.get(propertyId)?.name,value:read(id,propertyId)}))}))]));}
function belongsToPage(state, id, pageId) {
  let item = state.get(id);
  while (item) { if (item.id === pageId) return true; if (item.kind === 'page') return false; item = state.get(item.parentId); }
  return false;
}
function pageBody(state, parentId) {
  return children(state, parentId).filter(item => item.kind === 'block' && item.alive).flatMap(item => [clone(item), ...pageBody(state, item.id)]);
}
function copyBlocks(state, originals, roots, parentId, context, rootId) {
  const mapping = new Map(), copies = [];
  function copy(block, parent) {
    const id = rootId && copies.length === 0 ? rootId : objectId(); mapping.set(block.id, id);
    const next = add(state, { ...clone(block), id, parentId: parent, createdAt: context.now, createdBy: context.actor }, context); copies.push(next);
    if (next.richText?.some(run => run.comments)) next.richText = next.richText.map(({ comments, ...run }) => run);
    for (const child of children(originals, block.id).filter(child => child.kind === 'block' && child.alive)) copy(child, id);
  }
  roots.forEach(block => copy(block, typeof parentId==='function'?parentId(block):parentId));
  for (const block of copies) { if (mapping.has(block.sourceBlockId)) block.sourceBlockId = mapping.get(block.sourceBlockId); if(block.button)block.button=remapButton(block.button,id=>mapping.get(id)??id,originals); }
  context.copies.push({originalId:roots[0].id,copyId:mapping.get(roots[0].id),idMap:Object.fromEntries(mapping)});return copies;
}
function copyPage(state, original, operation, context) {
  const originals = clone(state), mapping = new Map(), owned = [];
  const sourceId = operation.sourceId ?? original.sourceId;
  requireThat(!original.sourceId || sourceId === original.sourceId, 'COPY_SOURCE', 'DB 행은 같은 데이터베이스 안에 복제하세요.');
  const parentId = sourceId ?? (Object.hasOwn(operation, 'parentId') ? operation.parentId : original.parentId);
  if (parentId) requireThat(['page', 'source'].includes(getEntity(state, parentId).kind), 'INVALID_PARENT', '복제할 위치를 확인하세요.');
  function collect(item) {
    if (mapping.has(item.id)) return;
    mapping.set(item.id, item.id === original.id ? operation.newId ?? objectId() : objectId()); owned.push(item);
    for (const child of children(originals, item.id)) {
      if (['comment','notification','delivery'].includes(child.kind)) continue;
      // "데이터 없이 복제" keeps a database's properties, views and templates but none of its rows.
      if (operation.withoutRows && child.kind === 'page' && child.sourceId && !child.template && item.kind === 'source') continue;
      collect(child);
    }
    if (item.kind === 'page' && item.sourceId) for (const child of taskDescendants(originals, item)) collect(child);
  }
  collect(original);
  // A copied relation to an external source needs its own inverse definition there.
  const externalInverses = [];
  for (const item of owned) if (item.kind === 'property' && item.inversePropertyId && !mapping.has(item.inversePropertyId)) {
    const inverse = originals.get(item.inversePropertyId); mapping.set(inverse.id, objectId()); externalInverses.push(inverse);
  }
  const mapped = id => mapping.get(id) ?? id;
  function ast(node) {
    if (Array.isArray(node)) return node.map(ast);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === 'propertyId' ? mapped(value) : ast(value)]));
  }
  function filter(node) {
    if (!node) return node;
    if (node.all || node.any) return Object.fromEntries(Object.entries(node).map(([key, list]) => [key, list.map(filter)]));
    if (node.not) return { not: filter(node.not) };
    const relation = originals.get(node.propertyId)?.type === 'relation';
    return { ...node, propertyId: mapped(node.propertyId), ...(relation && 'value' in node ? { value: Array.isArray(node.value) ? node.value.map(mapped) : mapped(node.value) } : {}) };
  }
  for (const item of [...owned, ...externalInverses]) {
    const copy = clone(item), external = externalInverses.includes(item);
    copy.id = mapped(item.id);
    for (const key of ['parentId', 'sourceId', 'targetSourceId', 'inversePropertyId', 'sourceBlockId', ...(copy.kind === 'comment' ? ['propertyId'] : [])]) if (copy[key] != null) copy[key] = mapped(copy[key]);
    if (item.id === original.id) {
      // A template duplicated as a template (the template's ⋯ › 복제) stays one in the same database.
      copy.parentId = parentId; copy.sourceId = sourceId ?? null; copy.template = !!(operation.keepTemplate && original.template && sourceId === original.sourceId);
      copy.title = operation.title ?? `${original.title} 사본`; copy.position = children(state, parentId).length;
      const source = sourceId ? getEntity(state, sourceId, 'source') : null;
      copy.uniqueId = source ? ++source.counter : null;
    }
    if (external) { copy.name = `${item.name} · ${operation.title ?? `${original.title} 사본`}`; copy.position = children(state, copy.parentId).length; }
    // Copies don't take the original's discussions with them.
    if (copy.richText) copy.richText = copy.richText.map(({ comments, ...run }) => ({ ...run, ...(run.pageId ? { pageId: mapped(run.pageId) } : {}) }));
    if(copy.cells)copy.cells=copy.cells.map(row=>row.map(cell=>cell.map(run=>({...run,...(run.pageId?{pageId:mapped(run.pageId)}:{})}))));
    if (copy.ast) { copy.ast = ast(copy.ast); copy.formula = formatFormula(copy.ast); }
    if (copy.rollup) copy.rollup = { ...copy.rollup, relationPropertyId: mapped(copy.rollup.relationPropertyId), targetPropertyId: mapped(copy.rollup.targetPropertyId) };
    if(copy.displayProperties)copy.displayProperties=copy.displayProperties.map(mapped);
    if (copy.kind === 'page') copy.values = {};
    if (copy.kind === 'page' && copy.sourceId && item.id !== original.id && !mapping.has(item.sourceId)) copy.uniqueId = ++state.get(copy.sourceId).counter;
    // A copied database starts without sprints (the sprints database belongs to the original).
    if (copy.kind === 'source' && copy.tasks?.sprints) delete copy.tasks.sprints;
    if (copy.kind === 'source' && copy.tasks) for (const config of Object.values(copy.tasks)) for (const key of ['parentPropertyId', 'childrenPropertyId', 'predecessorPropertyId', 'successorPropertyId', 'datePropertyId']) if (config[key]) config[key] = mapped(config[key]);
    if (copy.defaultTemplateId) copy.defaultTemplateId = mapped(copy.defaultTemplateId);
    if (copy.kind === 'reminder') { if (copy.datePropertyId) copy.datePropertyId = mapped(copy.datePropertyId); copy.deliveredFor = null; }
    if (copy.recurrence) { if (copy.template) copy.recurrence.enabled = false; else delete copy.recurrence; }
    if (copy.button) copy.button = remapButton(copy.button, mapped, originals);
    if (copy.taskTrashRootId) copy.taskTrashRootId = mapped(copy.taskTrashRootId);
    if (copy.kind === 'view') {
      copy.config = clone(item.config);
      if(['relation','person','files'].includes(originals.get(item.config.groupBy)?.type))for(const key of ['hiddenGroups','groupOrder'])if(copy.config[key])copy.config[key]=copy.config[key].map(key=>JSON.stringify(JSON.parse(key)==null?null:mapped(JSON.parse(key))));
      if (mapping.has(item.sourceId)) {
        for (const key of ['groupBy', 'subgroupBy', 'datePropertyId', 'endDatePropertyId', 'placePropertyId', 'previewPropertyId']) if (copy.config[key]) copy.config[key] = mapped(copy.config[key]);
        for(const key of ['visibleProperties','frozenProperties'])if(copy.config[key])copy.config[key]=copy.config[key].map(mapped);
        if(copy.config.columnAggregations)copy.config.columnAggregations=Object.fromEntries(Object.entries(copy.config.columnAggregations).map(([id,op])=>[mapped(id),op]));
        if (copy.config.sorts) copy.config.sorts = copy.config.sorts.map(sort => ({ ...sort, propertyId: mapped(sort.propertyId) }));
        if (copy.config.chart) copy.config.chart = { ...copy.config.chart, groupBy: mapped(copy.config.chart.groupBy), ...(copy.config.chart.valuePropertyId ? { valuePropertyId: mapped(copy.config.chart.valuePropertyId) } : {}) };
        copy.config.filter = filter(copy.config.filter);
      }
      if (copy.config.widgets) copy.config.widgets = copy.config.widgets.map(mapped);
      if (copy.config.dashboardRows) copy.config.dashboardRows = copy.config.dashboardRows.map(row => row.map(mapped));
      if (copy.config.dashboardFilters) copy.config.dashboardFilters = Object.fromEntries(Object.entries(copy.config.dashboardFilters).map(([sourceId, node]) => [mapped(sourceId), filter(node)]));
      if (copy.config.dashboardShared) copy.config.dashboardShared = { sourceId: mapped(copy.config.dashboardShared.sourceId), filter: filter(copy.config.dashboardShared.filter) };
      if (copy.config.dashboardSizes) copy.config.dashboardSizes = Object.fromEntries(Object.entries(copy.config.dashboardSizes).map(([widget, size]) => [mapped(widget), size]));
    }
    const added = add(state, { ...copy, createdAt: context.now, createdBy: context.actor }, context);
    added.alive = item.alive;
  }
  for (const item of owned.filter(item => item.kind === 'page')) {
    const copy = state.get(mapped(item.id));
    for (const [id, value] of Object.entries(item.values)) {
      const property = state.get(mapped(id));
      copy.values[mapped(id)] = property.type === 'relation' && Array.isArray(value) ? value.map(targetId => state.get(mapped(targetId))?.sourceId === property.targetSourceId ? mapped(targetId) : targetId) : clone(value);
    }
  }
  for (const item of owned.filter(item => item.kind === 'page')) {
    const page = state.get(mapped(item.id));
    for (const [id, value] of Object.entries(page.values)) {
      const property = state.get(id);
      if (property.type !== 'relation' || !property.inversePropertyId) continue;
      for (const targetId of value ?? []) {
        const target = state.get(targetId), ids = target.values[property.inversePropertyId] ?? [];
        if (!ids.includes(page.id)) target.values[property.inversePropertyId] = [...ids, page.id];
      }
    }
  }
  context.copies.push({ originalId: original.id, copyId: mapped(original.id), idMap: Object.fromEntries(mapping) });
}
export function visible(state, id, visited = new Set()) {
  const entity = state.get(id);
  if (!entity || !entity.alive || visited.has(id)) return false;
  const next = new Set(visited); next.add(id);
  if (entity.parentId != null && !visible(state, entity.parentId, next)) return false;
  const parent = entity.kind === 'page' && entity.sourceId ? taskParent(state, entity) : null;
  return !parent || visible(state, parent, next);
}
function getEntity(state, id, kind, allowDead = false) {
  const entity = state.get(id);
  requireThat(entity && (!kind || entity.kind === kind) && (allowDead || visible(state, id)), 'NOT_FOUND', '대상 항목을 찾을 수 없습니다.', { id, kind });
  return entity;
}
function add(state, input, context) {
  const id = input.id ?? objectId();
  requireThat(!state.has(id), 'ID_EXISTS', '이미 사용 중인 항목 ID입니다.', { id });
  const entity = { ...input, id, alive: true, version: 0, position: input.position ?? children(state, input.parentId ?? null).length,
    createdAt: context.now, updatedAt: context.now, createdBy: context.actor, updatedBy: context.actor };
  state.set(id, entity); return entity;
}
function move(state, entity, parentId, beforeId) {
  if (parentId !== null) {
    const parent = getEntity(state, parentId);
    requireThat(['page', 'block', 'source'].includes(parent.kind), 'INVALID_PARENT', '이 항목 아래로 옮길 수 없습니다.');
    if (entity.kind === 'page' && entity.sourceId) requireThat(parent.id === entity.sourceId, 'ROW_SOURCE', 'DB 행은 소스 사이에서 직접 이동할 수 없습니다.');
    if (entity.kind === 'block') requireThat(['page', 'block'].includes(parent.kind) && parent.blockType !== 'synced_reference', 'INVALID_PARENT', '블록의 부모를 확인하세요.');
  } else requireThat(entity.kind === 'page', 'INVALID_PARENT', '루트에는 페이지만 둘 수 있습니다.');
  const oldParent = entity.parentId, siblings = children(state, parentId).filter(item => item.id !== entity.id);
  const index = beforeId ? siblings.findIndex(item => item.id === beforeId) : siblings.length;
  requireThat(index >= 0, 'INVALID_POSITION', '같은 부모 안의 항목 앞에만 놓을 수 있습니다.');
  siblings.splice(index, 0, entity); entity.parentId = parentId;
  siblings.forEach((item, position) => { item.position = position; });
  if (oldParent !== parentId) children(state, oldParent).forEach((item, position) => { item.position = position; });
}
function compileProperty(state, property) {
  if (property.type === 'formula') {
    requireThat(typeof property.formula === 'string', 'FORMULA_REQUIRED', '수식 정의가 필요합니다.');
    property.ast = compileFormula(property.formula, value => {
      const candidates = properties(state, property.sourceId).filter(p => p.id === value || p.name === value);
      requireThat(candidates.length <= 1, 'FORMULA_REF', '이름이 겹치는 속성은 ID로 참조하세요.');
      return candidates[0]?.id;
    },(relationId,value)=>{const relation=state.get(relationId),candidates=properties(state,relation?.targetSourceId).filter(p=>p.id===value||p.name===value);return candidates.length===1?candidates[0].id:null;});
  }
}
function configureTasks(state, operation, context) {
  const source = getEntity(state, operation.id, 'source'); source.tasks ??= {};
  for (const [key, first, second, firstName, secondName] of [
    ['subitems', 'parentPropertyId', 'childrenPropertyId', '상위 항목', '하위 항목'],
    ['dependencies', 'predecessorPropertyId', 'successorPropertyId', '선행 업무', '후행 업무'],
  ]) {
    const input = operation[key]; if (!input) continue;
    const config = { ...(key === 'dependencies' ? { mode: 'none', avoidWeekends: false, datePropertyId: null } : {}), ...source.tasks[key], ...input };
    if (config.enabled) {
      config[first] ??= objectId(); config[second] ??= objectId();
      if (!state.has(config[first]) && !state.has(config[second])) applyOperation(state, { type: 'property.create', id: config[first], sourceId: source.id, name: firstName, propertyType: 'relation', targetSourceId: source.id, inverse: { id: config[second], name: secondName } }, context);
    }
    source.tasks[key] = config;
  }
}
// ----- sprints -----
const sprintDefaults = { database: '스프린트', title: '스프린트 이름', dates: '날짜', status: '스프린트 상태', tasks: '작업', sprint: '스프린트', past: '지난', current: '현재', next: '다음', future: '예정',
  sprintName: '스프린트 {0}', currentView: '현재 스프린트', planningView: '스프린트 계획', backlogView: '백로그', allView: '모든 스프린트' };
const localDay = (at, timeZone) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)); } catch { return String(at).slice(0, 10); } };
const addDays = (day, n) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); };
function sprintPages(state, config) {
  return [...state.values()].filter(item => item.kind === 'page' && item.sourceId === config.sourceId && !item.template && visible(state, item.id))
    .sort((a, b) => String(a.values?.[config.datePropertyId]?.start ?? '').localeCompare(String(b.values?.[config.datePropertyId]?.start ?? '')));
}
function addSprint(state, config, start, status, context) {
  config.counter = (config.counter ?? 0) + 1;
  const id = objectId();
  applyOperation(state, { type: 'page.create', id, title: config.labels.sprintName.replace('{0}', String(config.counter)), sourceId: config.sourceId }, context);
  setValue(state, id, config.datePropertyId, { start, end: addDays(start, config.lengthWeeks * 7 - 1) });
  setValue(state, id, config.statusPropertyId, config.statusOptions[status]);
  return id;
}
function configureSprints(state, operation, context) {
  const source = getEntity(state, operation.id, 'source'); source.tasks ??= {};
  const old = source.tasks.sprints ?? {};
  const config = { lengthWeeks: 2, startDay: 1, unfinished: 'next', upcoming: 2, autoComplete: false, timeZone: 'UTC', ...old };
  for (const key of ['lengthWeeks', 'startDay', 'unfinished', 'upcoming', 'autoComplete', 'timeZone']) if (operation[key] !== undefined) config[key] = operation[key];
  try { new Intl.DateTimeFormat('en', { timeZone: config.timeZone }); } catch { requireThat(false, 'SPRINT_TIMEZONE', '시간대를 확인하세요.'); }
  config.enabled = operation.enabled;
  if (config.enabled && !(config.sourceId && state.get(config.sourceId)?.alive)) {
    const labels = config.labels = { ...sprintDefaults, ...operation.labels };
    const holder = state.get(source.parentId);
    const pageId = objectId(), sprintSourceId = objectId(), relationId = objectId();
    config.statusOptions = { past: objectId(), current: objectId(), next: objectId(), future: objectId() };
    Object.assign(config, { pageId, sourceId: sprintSourceId, relationPropertyId: relationId, datePropertyId: objectId(), statusPropertyId: objectId(), tasksPropertyId: objectId(), counter: 0 });
    applyOperation(state, { type: 'page.create', id: pageId, title: labels.database, parentId: holder?.kind === 'page' ? holder.parentId ?? null : null }, context);
    state.get(pageId).databasePage = true;
    applyOperation(state, { type: 'source.create', id: sprintSourceId, pageId, name: labels.database, titlePropertyId: objectId(), titleName: labels.title }, context);
    applyOperation(state, { type: 'property.create', id: config.datePropertyId, sourceId: sprintSourceId, name: labels.dates, propertyType: 'date' }, context);
    applyOperation(state, { type: 'property.create', id: config.statusPropertyId, sourceId: sprintSourceId, name: labels.status, propertyType: 'status', options: [
      { id: config.statusOptions.future, name: labels.future, color: 'default', group: 'todo' }, { id: config.statusOptions.next, name: labels.next, color: 'purple', group: 'todo' },
      { id: config.statusOptions.current, name: labels.current, color: 'blue', group: 'in_progress' }, { id: config.statusOptions.past, name: labels.past, color: 'green', group: 'complete' }] }, context);
    applyOperation(state, { type: 'property.create', id: relationId, sourceId: source.id, name: labels.sprint, propertyType: 'relation', targetSourceId: sprintSourceId, relationLimit: 1, inverse: { id: config.tasksPropertyId, name: labels.tasks } }, context);
    applyOperation(state, { type: 'view.create', id: objectId(), sourceId: sprintSourceId, parentId: pageId, name: labels.allView, viewType: 'table', config: { sorts: [{ propertyId: config.datePropertyId, direction: 'asc' }] } }, context);
    if (holder?.kind === 'page') {
      const status = properties(state, source.id).find(property => property.type === 'status');
      applyOperation(state, { type: 'view.create', id: objectId(), sourceId: source.id, parentId: holder.id, name: labels.currentView, viewType: 'board', config: { groupBy: status?.id ?? null, filter: { propertyId: relationId, op: 'contains', value: '$currentSprint' } } }, context);
      applyOperation(state, { type: 'view.create', id: objectId(), sourceId: source.id, parentId: holder.id, name: labels.planningView, viewType: 'table', config: { groupBy: relationId } }, context);
      applyOperation(state, { type: 'view.create', id: objectId(), sourceId: source.id, parentId: holder.id, name: labels.backlogView, viewType: 'table', config: { filter: { propertyId: relationId, op: 'empty' } } }, context);
    }
    // The first sprint starts on the latest start weekday up to today; the ones ahead follow.
    const today = localDay(context.now, config.timeZone), weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    let start = addDays(today, -((weekday - config.startDay + 7) % 7));
    addSprint(state, config, start, 'current', context);
    for (let i = 0; i < config.upcoming; i++) { start = addDays(start, config.lengthWeeks * 7); addSprint(state, config, start, i === 0 ? 'next' : 'future', context); }
  }
  source.tasks.sprints = config;
}
function completeSprint(state, source, context) {
  const config = source.tasks?.sprints;
  requireThat(config?.enabled && state.get(config.sourceId)?.alive, 'SPRINTS_OFF', '이 데이터베이스는 스프린트를 쓰지 않습니다.');
  const pages = sprintPages(state, config), status = page => page.values?.[config.statusPropertyId];
  const current = pages.find(page => status(page) === config.statusOptions.current);
  requireThat(current, 'SPRINT_CURRENT', '현재 스프린트가 없습니다.');
  let next = pages.find(page => status(page) === config.statusOptions.next);
  const last = pages.at(-1), lastStart = last?.values?.[config.datePropertyId]?.start?.slice(0, 10) ?? localDay(context.now, config.timeZone);
  if (!next) next = state.get(addSprint(state, config, addDays(lastStart, config.lengthWeeks * 7), 'next', context));
  setValue(state, current.id, config.statusPropertyId, config.statusOptions.past);
  setValue(state, next.id, config.statusPropertyId, config.statusOptions.current);
  const future = sprintPages(state, config).filter(page => status(page) === config.statusOptions.future);
  if (future[0]) setValue(state, future[0].id, config.statusPropertyId, config.statusOptions.next);
  // Keep `upcoming` sprints ahead of the current one.
  for (let ahead = future.length; ahead < config.upcoming; ahead++) {
    const end = sprintPages(state, config).at(-1)?.values?.[config.datePropertyId]?.start?.slice(0, 10) ?? lastStart;
    addSprint(state, config, addDays(end, config.lengthWeeks * 7), ahead === 0 && !future[0] ? 'next' : 'future', context);
  }
  // Unfinished tasks of the finished sprint go on to the new one (or back to the backlog).
  const statusProperty = properties(state, source.id).find(property => property.type === 'status');
  for (const task of [...state.values()].filter(item => item.kind === 'page' && item.sourceId === source.id && !item.template && visible(state, item.id) && (item.values?.[config.relationPropertyId] ?? []).includes(current.id))) {
    const option = statusProperty?.options?.find(item => item.id === task.values?.[statusProperty.id]);
    if (option && statusKind(option) === 'complete') continue;
    setValue(state, task.id, config.relationPropertyId, config.unfinished === 'next' ? [next.id] : []);
  }
  return next.id;
}
// The views' "$currentSprint" / "$nextSprint" stand for whichever sprint has that status now.
export function sprintToken(state, sourceId, token) {
  const config = state.get(sourceId)?.tasks?.sprints;
  if (!config?.enabled) return null;
  const want = token === '$currentSprint' ? config.statusOptions?.current : token === '$nextSprint' ? config.statusOptions?.next : null;
  return want ? sprintPages(state, config).find(page => page.values?.[config.statusPropertyId] === want)?.id ?? null : null;
}
function convertProperty(state, operation, context) {
  const property = getEntity(state, operation.id, 'property'), original = clone(property), type = operation.propertyType;
  requireThat(original.type !== 'title' && type !== 'title', 'TITLE_PROPERTY', '제목 속성은 유형을 변경할 수 없습니다.');
  requireThat(!operation.fromType || original.type === operation.fromType, 'CONVERSION_STALE', '속성 유형이 달라졌습니다. 변환 결과를 다시 확인하세요.');
  requireThat(type !== original.type, 'PROPERTY_TYPE_SAME', '현재 유형과 다른 유형을 선택하세요.');
  if (type !== 'relation') {
    const dependencies = [...state.values()].filter(item => item.kind === 'property' && item.type === 'rollup' && item.rollup?.relationPropertyId === property.id);
    requireThat(!dependencies.length, 'CONVERSION_DEPENDENCY', '이 관계를 사용하는 롤업 정의를 먼저 변경하세요.', { properties: dependencies.map(({ id, name }) => ({ id, name })) });
  }
  const pages = [...state.values()].filter(item => item.kind === 'page' && item.sourceId === property.sourceId), read = createReader(state, { includeTrashed: true });
  const values = pages.map(page => ({ page, value: computedTypes.has(original.type) ? read(page.id, original.id) : clone(page.values[original.id] ?? null) }));
  const next = { ...original, type, name: operation.name ?? original.name };
  for (const key of ['options', 'formula', 'ast', 'rollup', 'targetSourceId', 'inversePropertyId', 'button', 'relationLimit', 'displayProperties', 'numberFormat']) delete next[key];
  if (['select', 'multi_select', 'status'].includes(type)) next.options = conversionOptions(original, type, values.map(item => item.value), operation.options);
  if (type === 'formula') { next.formula = operation.formula; compileProperty(state, next); }
  if (type === 'rollup') next.rollup = clone(operation.rollup);
  if (type === 'relation') { getEntity(state, operation.targetSourceId, 'source'); next.targetSourceId = operation.targetSourceId; }
  for(const key of ['button','relationLimit','displayProperties','numberFormat'])if(operation[key]!==undefined)next[key]=clone(operation[key]);
  const failures = [];
  for (const item of values) {
    try {
      item.converted = computedTypes.has(type) ? undefined : convertValue(state, original, next, item.value);
      if (!computedTypes.has(type)) validateValue(state, next, item.converted, true);
    } catch (error) {
      if (!(error instanceof WorkspaceError)) throw error;
      failures.push({ pageId: item.page.id, title: item.page.title, value: item.value, message: error.message });
    }
  }
  requireThat(!failures.length, 'PROPERTY_CONVERSION', '변환할 수 없는 값이 있어 원본을 유지했습니다.', { rows: failures });
  if (original.inversePropertyId) delete state.get(original.inversePropertyId).inversePropertyId;
  state.set(next.id, next);
  const normalized = { ...operation, fromType: original.type, ...(next.options ? { options: clone(next.options) } : {}) };
  if (type === 'relation' && operation.inverse) {
    const inverse = add(state, { id: operation.inverse.id, kind: 'property', type: 'relation', name: operation.inverse.name, parentId: next.targetSourceId, sourceId: next.targetSourceId, targetSourceId: next.sourceId, inversePropertyId: next.id }, context);
    next.inversePropertyId = inverse.id; normalized.inverse = { ...operation.inverse, id: inverse.id };
  } else if (type === 'relation' && next.targetSourceId === next.sourceId) next.inversePropertyId = next.id;
  for (const { page, converted } of values) {
    if (computedTypes.has(type)) delete page.values[next.id]; else page.values[next.id] = converted;
  }
  for (const { page, converted } of values) {
    if (next.inversePropertyId) for (const targetId of converted ?? []) {
      const target = state.get(targetId), ids = target.values[next.inversePropertyId] ?? [];
      if (!ids.includes(page.id)) target.values[next.inversePropertyId] = [...ids, page.id];
    }
  }
  for (const view of state.values()) if (view.kind === 'view') {
    for (const key of ['datePropertyId', 'endDatePropertyId']) if (view.config[key] === next.id && type !== 'date') view.config[key] = null;
    if (view.config.placePropertyId === next.id && type !== 'place') view.config.placePropertyId = null;
    function updateFilter(node) {
      if (!node) return;
      if (node.all || node.any) { (node.all ?? node.any).forEach(updateFilter); return; }
      if (node.not) { updateFilter(node.not); return; }
      if (node.propertyId !== next.id || !('value' in node) || computedTypes.has(type)) return;
      requireThat(!(original.type === 'date' && type === 'text' && ['eq', 'neq'].includes(node.op) && typeof node.value === 'string'), 'CONVERSION_FILTER', `${view.name} 보기의 날짜 필터를 먼저 변경하세요.`, { viewId: view.id });
      const operand = value => {
        if (['contains', 'not_contains'].includes(node.op) && ['multi_select', 'relation', 'files', 'person'].includes(original.type) && type === 'text') {
          return original.options?.find(option => option.id === value)?.name ?? String(value ?? '');
        }
        const result = convertValue(state, original, next, value);
        return ['contains', 'not_contains'].includes(node.op) && Array.isArray(result) ? result[0] ?? null : result;
      };
      try { node.value = node.op === 'in' && Array.isArray(node.value) ? node.value.map(operand) : operand(node.value); }
      catch (error) { throw new WorkspaceError('CONVERSION_FILTER', `${view.name} 보기의 필터 값을 먼저 변경하세요.`, { viewId: view.id, message: error.message }); }
    }
    updateFilter(view.config.filter);
  }
  return normalized;
}
// A page's title, icon, property values and content as they were in an earlier state (버전 복원).
function restorePageFrom(state, past, pageId) {
  const page = getEntity(state, pageId, 'page'), original = getEntity(past, pageId, 'page', true);
  requireThat(page.sourceId === original.sourceId, 'RESTORE_SOURCE', '과거 페이지와 현재 데이터 소스가 다릅니다.');
  const blocks = pageBody(past, page.id), currentBlocks = pageBody(state, page.id), retained = new Set(blocks.map(block => block.id));
  for (const block of blocks) requireThat(!state.has(block.id) || belongsToPage(state, block.id, page.id), 'RESTORE_CONFLICT', '과거 블록이 다른 페이지로 이동했습니다. 해당 블록을 먼저 확인하세요.', { id: block.id });
  page.title = original.title;
  if (original.icon === undefined) delete page.icon; else page.icon = original.icon;
  for (const property of properties(state, page.sourceId)) {
    if (['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button'].includes(property.type)) continue;
    setValue(state, page.id, property.id, original.values[property.id] ?? null);
    if (!(property.id in original.values)) delete page.values[property.id];
  }
  for (const block of currentBlocks) if (!retained.has(block.id)) state.get(block.id).alive = false;
  for (const block of blocks) state.set(block.id, block);
}
// Archived (보관됨): the page or a page above it was archived.
export function isArchived(state, id) {
  const seen = new Set();
  for (let item = state.get(id); item && !seen.has(item.id); item = item.parentId ? state.get(item.parentId) : null) {
    seen.add(item.id);
    if (item.kind === 'page' && item.archived) return true;
  }
  return false;
}
function setValue(state, pageId, propertyId, value) {
  const page = getEntity(state, pageId, 'page'), property = getEntity(state, propertyId, 'property');
  requireThat(page.sourceId === property.sourceId, 'PROPERTY_SOURCE', '행과 속성의 데이터 소스가 다릅니다.');
  requireThat(!['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button'].includes(property.type), 'READ_ONLY_PROPERTY', '파생 속성과 버튼에는 직접 값을 쓸 수 없습니다.');
  validateValue(state, property, value);
  // A text value with formatting is kept as rich text runs; without any it is plain text again (or empty).
  if (property.type === 'text' && Array.isArray(value)) { value = value.filter(run => run.text !== ''); value = !value.length ? null : value.every(run => Object.keys(run).every(key => key === 'text')) ? value.map(run => run.text).join('') : value; }
  if (property.type === 'title') { page.title = value ?? ''; return; }
  if (property.type === 'relation') {
    const oldIds = page.values[propertyId] ?? [], newIds = value ?? [];
    if (property.inversePropertyId) {
      for (const targetId of new Set([...oldIds, ...newIds])) {
        const target = getEntity(state, targetId, 'page', true), old = target.values[property.inversePropertyId] ?? [];
        const next = old.filter(id => id !== page.id);
        if (newIds.includes(targetId)) next.push(page.id);
        target.values = { ...target.values, [property.inversePropertyId]: next };
      }
    }
  }
  page.values = { ...page.values, [propertyId]: clone(value) };
}
const dateTypes = new Set(['date', 'created_time', 'last_edited_time']);
function validateValue(state, property, value, allowTrashedRelations = false) {
  if (value === null) return;
  let valid = true;
  switch (property.type) {
    case 'title': case 'phone': valid = typeof value === 'string'; break;
    // Text may carry formatting: bold, links, mentions … as rich text runs (a formatted text property).
    case 'text': valid = typeof value === 'string' || (Array.isArray(value) && value.length <= 2000 && richText.safeParse(value).success); break;
    case 'number': valid = typeof value === 'number' && Number.isFinite(value); break;
    case 'checkbox': valid = typeof value === 'boolean'; break;
    case 'email': valid = typeof value === 'string' && (!value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)); break;
    case 'url': valid = typeof value === 'string' && (!value || safeUrl(value)); break;
    case 'select': case 'status': valid = typeof value === 'string' && (property.options ?? []).some(option => option.id === value); break;
    case 'multi_select': valid = Array.isArray(value) && new Set(value).size === value.length && value.every(id => (property.options ?? []).some(option => option.id === id)); break;
    case 'person': valid = Array.isArray(value) && value.every(item => typeof item === 'string'); break;
    case 'files': valid = Array.isArray(value) && new Set(value).size === value.length && value.every(id => state.get(id)?.kind === 'attachment' && state.get(id).alive); break;
    case 'relation': valid = Array.isArray(value) && (property.relationLimit!==1||value.length<=1) && new Set(value).size === value.length && value.every(id => state.get(id)?.kind === 'page' && state.get(id).sourceId === property.targetSourceId && (allowTrashedRelations || visible(state, id))); break;
    case 'date': {
      const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && Number.isFinite(Date.parse(v)) && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v).toISOString().slice(0, 10) === v);
      valid = value && typeof value === 'object' && !Array.isArray(value) && date(value.start) && (value.end == null || date(value.end) && Date.parse(value.end) >= Date.parse(value.start)) && (value.timeZone == null || typeof value.timeZone === 'string');
      if (valid && value.timeZone) { try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); } catch { valid = false; } }
      break;
    }
    case 'place': valid = value && typeof value === 'object' && typeof value.name === 'string' && (value.latitude == null || typeof value.latitude === 'number' && Math.abs(value.latitude) <= 90) && (value.longitude == null || typeof value.longitude === 'number' && Math.abs(value.longitude) <= 180); break;
  }
  requireThat(valid, 'VALUE_TYPE', `${property.name} 속성의 값 형식이 맞지 않습니다.`, { propertyId: property.id, type: property.type });
}
function safeUrl(value) { try { return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; } }

function remapButton(definition, mapped, originals) {
  const value=(id,v)=>originals?.get(id)?.type==='relation'&&Array.isArray(v)?v.map(mapped):clone(v);
  const filter=node=>!node?node:node.all?{all:node.all.map(filter)}:node.any?{any:node.any.map(filter)}:node.not?{not:filter(node.not)}:{...node,propertyId:mapped(node.propertyId),...('value'in node?{value:value(node.propertyId,node.value)}:{})};
  return {...clone(definition),actions:definition.actions.map(action=>{
    const next=clone(action);for(const key of ['targetId','propertyId','sourceId','parentId','templateId'])if(next[key])next[key]=mapped(next[key]);
    if('value'in action)next.value=value(action.propertyId,action.value);if(action.values)next.values=Object.fromEntries(Object.entries(action.values).map(([id,v])=>[mapped(id),value(id,v)]));
    if(action.filter)next.filter=filter(action.filter);if(action.blocks){const runs=list=>(list??[]).map(r=>({...r,...(r.pageId?{pageId:mapped(r.pageId)}:{}),...(r.iconAttachmentId?{iconAttachmentId:mapped(r.iconAttachmentId)}:{}),...(r.customEmoji?{customEmoji:mapped(r.customEmoji)}:{})}));const blocks=list=>list.map(b=>({...b,richText:runs(b.richText),...(b.attachmentId?{attachmentId:mapped(b.attachmentId)}:{}),...(b.cells?{cells:b.cells.map(row=>row.map(runs))}:{}),...(b.children?{children:blocks(b.children)}:{})}));next.blocks=blocks(action.blocks);}return next;
  })};
}
// source: what sent it (reminder · automation · error) — the inbox filters by it.
function notify(state, parentId, message, context, id = objectId(), source = 'automation') {
  if (!state.has(id)) add(state, { id, kind: 'notification', parentId, message, read: false, source }, context);
}
function runButton(state, operation, context) {
  const owner = getEntity(state, operation.id);
  requireThat(owner.kind === 'property' && owner.type === 'button' || owner.kind === 'block' && owner.blockType === 'button', 'BUTTON_TARGET', '버튼을 선택하세요.');
  let page = owner.kind === 'property' ? getEntity(state, operation.pageId, 'page') : state.get(owner.parentId);
  while (page && page.kind !== 'page') page = state.get(page.parentId);
  requireThat(page && (owner.kind !== 'property' || page.sourceId === owner.sourceId), 'BUTTON_TARGET', '버튼을 실행할 행을 확인하세요.');
  const definition = buttonDefinition.parse(owner.button ?? {});
  requireThat(!(definition.confirmation||definition.actions.some(a=>['send_email','send_webhook'].includes(a.action))) || operation.confirmed, 'BUTTON_CONFIRMATION', definition.confirmation || '실행을 확인하세요.');
  requireThat(definition.actions.length, 'BUTTON_EMPTY', '버튼에 실행할 작업을 추가하세요.');
  performActions(state, definition.actions, page, owner, context);
}
// The actions of a button or an automation, on its page (null for a scheduled automation: then the notes and
// deliveries go to the database page).
// 변수 정의 (automations): the names a variable formula can use besides the database's properties.
const triggerNames = { '트리거한 사용자': '$actor', '페이지 작성자': '$author', '트리거된 시간': '$now', '트리거된 날짜': '$today', '트리거 페이지': '$page' };
function variableValues(state, variables, page, sourceId, vars, context) {
  const read = createReader(state);
  const input = id => {
    if (id.startsWith('$var:')) return vars.get(id.slice(5))?.value ?? null;
    if (id === '$actor') return context.actor; if (id === '$now') return context.now; if (id === '$today') return context.now.slice(0, 10);
    if (id === '$page') return page?.id ?? null; if (id === '$author') return page?.createdBy ?? null;
    requireThat(page, 'AUTOMATION_PAGE', '속성 값은 페이지가 있는 트리거에서만 읽을 수 있습니다.');
    const raw = read(page.id, id), property = state.get(id), label = optionId => property.options?.find(option => option.id === optionId)?.name ?? '';
    return ['select', 'status'].includes(property.type) ? raw == null ? '' : label(raw) : property.type === 'multi_select' ? (raw ?? []).map(label) : raw;
  };
  const plain = value => value == null ? '' : isText(value) ? textValue(value) : Array.isArray(value) ? value.map(plain).join(', ') : typeof value === 'object' ? value.start ?? JSON.stringify(value) : String(value);
  for (const variable of variables) {
    let value;
    if (variable.mode === 'formula') {
      const ast = compileVariable(state, variable.value, sourceId, [...vars.entries()].map(([id, item]) => ({ id, name: item.name })));
      value = evaluateFormula(ast, input, { now: context.now, pageId: page?.id, readRelated: (target, ref) => ref === '$title' ? state.get(target)?.title ?? String(target ?? '') : read(target, ref) });
    } else value = variable.value.replace(/\{\{(var:)?([^{}]+)\}\}/g, (_, isVar, ref) => {
      if (isVar) return plain(input(`$var:${ref}`));
      if (ref === '$page') return page?.title ?? '';
      // @ a page anywhere (its title), @ a chosen date, and Σ a formula worked out where it stands.
      if (ref.startsWith('page:')) { const target = state.get(ref.slice(5)); return target?.kind === 'page' && target.alive !== false ? target.title ?? '' : ''; }
      if (ref.startsWith('date:')) return ref.slice(5);
      if (ref.startsWith('=')) {
        const ast = compileVariable(state, ref.slice(1), sourceId, [...vars.entries()].map(([id, item]) => ({ id, name: item.name })));
        return plain(evaluateFormula(ast, input, { now: context.now, pageId: page?.id, readRelated: (target, key) => key === '$title' ? state.get(target)?.title ?? String(target ?? '') : read(target, key) }));
      }
      return plain(input(ref));
    });
    vars.set(variable.id, { name: variable.name, value });
  }
}
// The formula editor's check: compiled as a property of this source would be (a formula property cannot read
// itself), then worked out for the first rows. A compile error is the answer, not a failure.
function previewFormula(state, { sourceId, formula, propertyId, limit = 3 }) {
  getEntity(state, sourceId, 'source');
  let ast;
  try {
    ast = compileFormula(formula, value => {
      const candidates = properties(state, sourceId).filter(p => p.id !== propertyId && (p.id === value || p.name === value));
      requireThat(candidates.length <= 1, 'FORMULA_REF', '이름이 겹치는 속성은 ID로 참조하세요.');
      return candidates[0]?.id;
    }, (relationId, value) => { const relation = state.get(relationId), candidates = properties(state, relation?.targetSourceId).filter(p => p.id === value || p.name === value); return candidates.length === 1 ? candidates[0].id : null; });
  } catch (error) { if (error instanceof WorkspaceError) return { ok: false, code: error.code, message: error.message }; throw error; }
  const read = createReader(state);
  const input = (pageId, id) => {
    const raw = read(pageId, id), property = state.get(id), label = optionId => property?.options?.find(option => option.id === optionId)?.name ?? '';
    return ['select', 'status'].includes(property?.type) ? raw == null ? '' : label(raw) : property?.type === 'multi_select' ? (raw ?? []).map(label) : raw;
  };
  const rows = querySource(state, { sourceId, limit }).rows.filter(row => !row.contextOnly).slice(0, limit).map(row => {
    let value;
    try { value = evaluateFormula(ast, id => input(row.id, id), { pageId: row.id, readRelated: (target, ref) => ref === '$title' ? state.get(target)?.title ?? String(target ?? '') : input(target, ref) }); }
    catch (error) { value = { error: { code: error.code ?? 'FORMULA', message: error.message } }; }
    return { id: row.id, title: state.get(row.id)?.title ?? '', value };
  });
  return { ok: true, rows };
}
function compileVariable(state, text, sourceId, earlier) {
  return compileFormula(text, name => {
    const variable = earlier.find(item => item.id === name || item.name === name);
    if (variable) return `$var:${variable.id}`;
    if (triggerNames[name]) return triggerNames[name];
    if (Object.values(triggerNames).includes(name)) return name; // the same values by token ($now …), as other interface languages write them
    const candidates = sourceId ? properties(state, sourceId).filter(p => p.id === name || p.name === name) : [];
    requireThat(candidates.length <= 1, 'FORMULA_REF', '이름이 겹치는 속성은 ID로 참조하세요.');
    return candidates[0]?.id;
  }, (relationId, value) => { const relation = state.get(relationId), candidates = properties(state, relation?.targetSourceId).filter(p => p.id === value || p.name === value); return candidates.length === 1 ? candidates[0].id : null; });
}
// A variable's value made to fit the property it is written to.
function fitValue(state, propertyId, value) {
  const property = state.get(propertyId);
  if (!property || value == null) return value ?? null;
  const plain = item => item == null ? '' : isText(item) ? textValue(item) : Array.isArray(item) ? item.map(plain).join(', ') : typeof item === 'object' ? item.start ?? JSON.stringify(item) : String(item);
  const option = item => property.options?.find(entry => entry.id === item || entry.name === plain(item))?.id ?? null;
  switch (property.type) {
    case 'number': { const number = typeof value === 'number' ? value : Number(plain(value).replace(/,/g, '')); return plain(value) !== '' && Number.isFinite(number) ? number : null; }
    case 'checkbox': return typeof value === 'boolean' ? value : ['true', '1', 'yes', '예'].includes(plain(value).trim().toLowerCase());
    case 'title': case 'text': case 'url': case 'email': case 'phone': return plain(value);
    case 'date': return typeof value === 'object' && !Array.isArray(value) && value.start ? value : plain(value) ? { start: plain(value) } : null;
    case 'select': case 'status': return option(Array.isArray(value) ? value[0] : value);
    case 'multi_select': return (Array.isArray(value) ? value : plain(value).split(',').map(item => item.trim()).filter(Boolean)).map(option).filter(Boolean);
    case 'person': case 'relation': return (Array.isArray(value) ? value : [value]).map(plain).filter(Boolean);
    default: return value;
  }
}

function performActions(state, actions, page, owner, context) {
  let created; const vars = new Map();
  const sourceId = owner.kind === 'automation' ? owner.sourceId : page?.sourceId;
  const home = page?.id ?? (owner.kind === 'automation' ? state.get(owner.sourceId)?.parentId : null);
  const target = value => value === '$this' || value == null ? (requireThat(page, 'AUTOMATION_PAGE', '이 작업은 페이지가 있는 트리거에서만 쓸 수 있습니다.'), page.id) : value === '$created' ? (requireThat(created, 'BUTTON_CREATED', '먼저 새 페이지를 만드는 액션을 추가하세요.'), created) : value;
  const resolve = value => Array.isArray(value) ? value.map(resolve) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item)])) : value === '$this' || value === '$created' ? target(value) : value === '$now' ? context.now : value === '$today' ? context.now.slice(0,10) : value;
  const reference = raw => raw && typeof raw === 'object' && !Array.isArray(raw) && (typeof raw.$variable === 'string' || typeof raw.$formula === 'string');
  const referenced = (propertyId, raw) => {
    if (raw.$variable != null) { requireThat(vars.has(raw.$variable), 'AUTOMATION_VARIABLE', '정의되지 않은 변수를 쓰고 있습니다. 변수 정의를 먼저 두세요.'); return fitValue(state, propertyId, vars.get(raw.$variable).value); }
    const scratch = new Map(vars); variableValues(state, [{ id: '$formula', name: '$formula', mode: 'formula', value: raw.$formula }], page, sourceId, scratch, context);
    return fitValue(state, propertyId, scratch.get('$formula').value);
  };
  // A text value written with @ mentions or Σ ({{…}}) is filled in when the action runs.
  const set = (pageId, propertyId, raw) => setValue(state, pageId, propertyId, reference(raw) ? referenced(propertyId, raw) : state.get(propertyId)?.type === 'date' && ['$now','$today'].includes(raw) ? { start: resolve(raw) }
    : typeof raw === 'string' && /\{\{[^{}]+\}\}/.test(raw) && ['title', 'text', 'url', 'email', 'phone'].includes(state.get(propertyId)?.type) ? (state.get(propertyId).type === 'text' ? textRuns(raw) : text(raw)) : resolve(raw));
  // Text with {{propertyId}} (the trigger page's value), {{$now}} and the like, and {{var:id}} (an earlier variable).
  // links: a page named with @ stays a link ([[page:<id>]], shown as the page by the inbox) instead of its title.
  const text = (template, { links = false } = {}) => {
    if (!/\{\{[^{}]+\}\}/.test(template)) return template;
    const scratch = new Map(vars); variableValues(state, [{ id: '$text', name: '$text', mode: 'text', value: links ? template.replace(/\{\{page:([^{}]+)\}\}/g, (_, id) => `\u0000page:${id}\u0000`) : template }], page, sourceId, scratch, context);
    return String(scratch.get('$text').value ?? '').replace(/\u0000page:([^\u0000]+)\u0000/g, (_, id) => state.get(id)?.kind === 'page' ? `[[page:${id}]]` : '');
  };
  // A text property's value: the words, with a page named (@) kept as a page mention.
  const textRuns = template => {
    const linked = text(template, { links: true });
    if (!linked.includes('[[page:')) return linked;
    return linked.split(/(\[\[page:[^\]]+\]\])/).filter(Boolean).map(part => { const id = /^\[\[page:([^\]]+)\]\]$/.exec(part)?.[1]; return id ? { text: state.get(id)?.title || '페이지', pageId: id } : { text: part }; });
  };
  for (const action of actions) {
    if (action.action === 'define_variables') variableValues(state, action.variables, page, sourceId, vars, context);
    if (action.action === 'set_property') set(target(action.targetId), action.propertyId, action.value);
    if (action.action === 'add_page') {
      created = objectId(); applyOperation(state, { type: 'page.create', id: created, sourceId: action.sourceId, parentId: action.parentId, templateId: action.templateId, title: text(action.title) }, context);
      context.automated?.add(created);
      for (const [id,value] of Object.entries(action.values ?? {})) set(created,id,value);
    }
    if (action.action === 'edit_pages') {
      const result = querySource(state, { sourceId: action.sourceId, filter: action.filter, limit: 500 });
      requireThat(!result.hasMore, 'BUTTON_LIMIT', '한 번에 변경할 수 있는 항목은 500개입니다. 필터를 좁히세요.');
      let rows = result.rows.filter(row=>!row.contextOnly).map(row => row.id);
      // Only the pages a variable or formula gives (a relation's pages, the trigger page…), among those matching.
      if (action.pages) {
        let raw;
        if (action.pages.$variable != null) { requireThat(vars.has(action.pages.$variable), 'AUTOMATION_VARIABLE', '정의되지 않은 변수를 쓰고 있습니다. 변수 정의를 먼저 두세요.'); raw = vars.get(action.pages.$variable).value; }
        else { const scratch = new Map(vars); variableValues(state, [{ id: '$pages', name: '$pages', mode: 'formula', value: action.pages.$formula }], page, sourceId, scratch, context); raw = scratch.get('$pages').value; }
        const wanted = new Set([raw].flat(3).map(item => typeof item === 'string' ? item : item?.id).filter(Boolean));
        rows = rows.filter(id => wanted.has(id));
      }
      for (const id of rows) set(id, action.propertyId, action.value);
    }
    if (action.action === 'insert_blocks') {
      const parentId = action.parentId ? target(action.parentId) : owner.kind === 'block' ? owner.parentId : page.id;
      const siblings = children(state,parentId).filter(item=>item.kind==='block'&&item.alive);
      const beforeId = action.position === 'first' ? siblings[0]?.id : action.position === 'above' && owner.parentId === parentId ? owner.id : action.position === 'below' && owner.parentId === parentId ? siblings[siblings.findIndex(item=>item.id===owner.id)+1]?.id : undefined;
      const insert = (blocks, parent, before) => { for (const { children: nested, ...block } of blocks) { const id = objectId(); applyOperation(state, { type: 'block.create', ...block, id, parentId: parent, ...(before ? { beforeId: before } : {}) }, context); if (nested?.length) insert(nested, id, null); } };
      insert(action.blocks, parentId, beforeId);
    }
    if (action.action === 'open_page') { const id = target(action.targetId); getEntity(state,id,'page'); context.opens.push(id); }
    if (action.action === 'open_url') (context.openUrls ??= []).push(action.url);
    // A webhook's strings take {{…}} values (the trigger page's properties, the time, variables) like a notice does.
    const fill=value=>typeof value==='string'?text(value):Array.isArray(value)?value.map(fill):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,fill(item)])):value;
    if(['send_webhook','send_email'].includes(action.action)){const {action:kind,...rest}=action;const payload=kind==='send_webhook'?{...rest,body:fill(rest.body)}:{...rest,subject:fill(rest.subject),message:fill(rest.message)};add(state,{kind:'delivery',parentId:home,channel:kind==='send_email'?'email':'webhook',...resolve(payload),status:'queued',originCommandId:context.commandId},context);}
    if (action.action === 'notify') notify(state, home, text(action.message, { links: true }), context);
  }
}

// ----- database automations -----
// Pages of the databases that have live, enabled automations, as they were before the command (to tell
// which pages the command added and which properties it changed).
function automationWatch(state) {
  const automations = [...state.values()].filter(item => item.kind === 'automation' && item.alive && item.enabled && visible(state, item.id) && item.triggers.some(trigger => trigger.type !== 'recurring'));
  if (!automations.length) return null;
  const sources = new Set(automations.map(item => item.sourceId)), pages = new Map();
  for (const item of state.values()) if (item.kind === 'page' && sources.has(item.sourceId) && !item.template) pages.set(item.id, { title: item.title, values: clone(item.values ?? {}) });
  return { automations: automations.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt))), pages };
}
const triggerMatches = (state, trigger, page, now) => {
  // A condition on the new value: the same rule as a view filter, on the value as the page now reads.
  if (trigger.condition) return matchesFilter({ propertyId: trigger.propertyId, ...trigger.condition }, { [trigger.propertyId]: createReader(state)(page.id, trigger.propertyId) }, now);
  if (!trigger.values?.length) return true;
  const value = page.values?.[trigger.propertyId];
  return Array.isArray(value) ? value.some(item => trigger.values.some(wanted => canonical(wanted) === canonical(item))) : trigger.values.some(wanted => canonical(wanted) === canonical(value ?? null));
};
function inScope(state, automation, page) {
  if (!automation.viewId) return true;
  const view = state.get(automation.viewId);
  if (!view?.alive) return false;
  if (!view.config?.filter) return true;
  return querySource(state, { sourceId: automation.sourceId, filter: view.config.filter, limit: 10000 }).rows.some(row => row.id === page.id);
}
const titleProperty = (state, sourceId) => [...state.values()].find(item => item.kind === 'property' && item.sourceId === sourceId && item.type === 'title' && item.alive);
// Runs each automation whose triggers the command met. Its changes are part of the same command (one undo),
// do not set off other automations, and a failing automation is skipped with a note instead of rejecting
// the edit that triggered it.
function runAutomations(state, watch, context) {
  const events = new Map();
  for (const item of state.values()) {
    if (item.kind !== 'page' || item.template || !visible(state, item.id) || context.automated.has(item.id)) continue;
    const sourceAutomations = watch.automations.filter(automation => automation.sourceId === item.sourceId);
    if (!sourceAutomations.length) continue;
    const before = watch.pages.get(item.id);
    if (!before) { events.set(item.id, { added: true, edited: new Set() }); continue; }
    const edited = new Set();
    if (before.title !== item.title) { const title = titleProperty(state, item.sourceId); if (title) edited.add(title.id); }
    for (const key of new Set([...Object.keys(before.values), ...Object.keys(item.values ?? {})])) if (canonical(before.values[key] ?? null) !== canonical(item.values?.[key] ?? null)) edited.add(key);
    if (edited.size) events.set(item.id, { added: false, edited });
  }
  for (const [pageId, event] of events) {
    for (const automation of watch.automations) {
      const page = state.get(pageId);
      if (!page || automation.sourceId !== page.sourceId || !state.get(automation.id)?.alive) continue;
      const fired = trigger => trigger.type === 'page_added' ? event.added : trigger.type === 'any_property_edited' ? !event.added && event.edited.size > 0
        : trigger.type === 'property_edited' ? event.edited.has(trigger.propertyId) && triggerMatches(state, trigger, page, context.now) : false;
      const holds = trigger => trigger.type === 'property_edited' ? triggerMatches(state, trigger, page, context.now) : fired(trigger);
      const go = automation.match === 'any' ? automation.triggers.some(fired) : automation.triggers.some(fired) && automation.triggers.every(holds);
      if (go && inScope(state, automation, page)) runAutomation(state, automation, page, context);
    }
  }
}
function runAutomation(state, automation, page, context) {
  const backup = new Map([...state].map(([key, value]) => [key, clone(value)]));
  try { performActions(state, automation.actions, page, automation, context); }
  catch (error) {
    state.clear(); for (const [key, value] of backup) state.set(key, value);
    const home = page?.id ?? state.get(automation.sourceId)?.parentId;
    if (home) notify(state, home, `자동화 "${automation.name || '이름 없는 자동화'}"을(를) 실행하지 못했습니다: ${error.message}`, context, undefined, 'error');
  }
}
function validateAutomation(state, sourceId, triggers, actions) {
  const recurring = triggers.some(trigger => trigger.type === 'recurring');
  requireThat(!recurring || triggers.length === 1, 'AUTOMATION_TRIGGER', '반복 트리거는 다른 트리거와 함께 쓸 수 없습니다.');
  for (const trigger of triggers) if (trigger.type === 'property_edited') { const property = getEntity(state, trigger.propertyId, 'property'); requireThat(property.sourceId === sourceId, 'AUTOMATION_PROPERTY', '같은 데이터베이스의 속성을 선택하세요.'); }
  const defined = [];
  const checkReference = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (value.$variable != null) requireThat(defined.some(item => item.id === value.$variable), 'AUTOMATION_VARIABLE', '변수는 정의한 다음 작업에서만 쓸 수 있습니다.');
    if (typeof value.$formula === 'string') compileVariable(state, value.$formula, sourceId, defined);
  };
  for (const action of actions) {
    if (action.action === 'define_variables') for (const variable of action.variables) {
      requireThat(!defined.some(item => item.name === variable.name), 'AUTOMATION_VARIABLE', `같은 이름의 변수가 있습니다: ${variable.name}`);
      if (variable.mode === 'formula') compileVariable(state, variable.value, sourceId, defined);
      defined.push({ id: variable.id, name: variable.name });
    }
    checkReference(action.value); for (const value of Object.values(action.values ?? {})) checkReference(value);
    if (action.propertyId && action.action === 'set_property') { const property = getEntity(state, action.propertyId, 'property'); requireThat(property.sourceId === sourceId || action.targetId && action.targetId !== '$this', 'AUTOMATION_PROPERTY', '같은 데이터베이스의 속성을 선택하세요.'); }
    if (recurring) requireThat(action.action !== 'set_property' || (action.targetId && !['$this', '$created'].includes(action.targetId)), 'AUTOMATION_PAGE', '반복 트리거에서는 페이지 속성을 바로 바꿀 수 없습니다. 페이지 추가나 페이지 편집을 쓰세요.');
  }
}
function automationSchedule(triggers, now) {
  const trigger = triggers.find(item => item.type === 'recurring');
  if (!trigger) return null;
  let index = 0, nextAt = automationOccurrence(trigger.schedule, 0);
  while (Date.parse(nextAt) <= Date.parse(now) && index < 100000) nextAt = automationOccurrence(trigger.schedule, ++index);
  return { index, nextAt: scheduleEnded(trigger.schedule, nextAt) ? null : nextAt };
}
function runSchedules(state, at, context) {
  let count = 0;
  // Sprints set to complete by themselves: once the current sprint's last day has passed.
  for (const source of [...state.values()].filter(item => item.kind === 'source' && item.alive && item.tasks?.sprints?.enabled && item.tasks.sprints.autoComplete && visible(state, item.id))) {
    const config = source.tasks.sprints;
    for (let guard = 0; guard < 10; guard++) {
      const current = sprintPages(state, config).find(page => page.values?.[config.statusPropertyId] === config.statusOptions.current);
      const end = current?.values?.[config.datePropertyId]?.end ?? current?.values?.[config.datePropertyId]?.start;
      if (!end || String(end).slice(0, 10) >= localDay(at, config.timeZone)) break;
      completeSprint(state, source, context);
    }
  }
  for (const job of plannedAutomations(state, at, visible)) {
    const item = state.get(job.id);
    if (job.type === 'reminder') {
      notify(state,item.parentId,item.message,context,`notification:${digest(`${item.id}:${job.due}`).slice(0,40)}`,'reminder'); item.deliveredFor = job.due;
    } else if (job.type === 'automation') {
      const trigger = item.triggers.find(entry => entry.type === 'recurring');
      while (item.schedule?.nextAt && Date.parse(item.schedule.nextAt) <= Date.parse(at) && count < 100) {
        runAutomation(state, item, null, context); count++;
        const live = state.get(item.id); // a failed run restores the state, so read the automation again
        const index = live.schedule.index + 1, nextAt = automationOccurrence(trigger.schedule, index);
        live.schedule = { index, nextAt: scheduleEnded(trigger.schedule, nextAt) ? null : nextAt };
        if (live !== item) break;
      }
    } else while (Date.parse(item.recurrence.nextAt) <= Date.parse(at) && count < 100) {
      const rule = item.recurrence, id = `repeat:${digest(`${item.id}:${rule.nextAt}`).slice(0,40)}`;
      if (!state.has(id)) copyPage(state,item,{newId:id,title:item.title,sourceId:item.sourceId},context);
      rule.index++; rule.nextAt = occurrence(rule,rule.index); count++;
    }
  }
}

function applyOperation(state, operation, context) {
  switch (operation.type) {
    case 'delivery.update':{const item=getEntity(state,operation.id,'delivery');const allowed={queued:['sending','cancelled'],sending:['sent','failed','unknown'],failed:['queued','cancelled'],unknown:['queued','cancelled'],sent:[],cancelled:[]};requireThat(allowed[item.status]?.includes(operation.status),'DELIVERY_STATE','전송 상태를 확인하세요.');item.status=operation.status;item.lastAttemptAt=context.now;for(const key of ['receipt','error'])if(operation[key]!==undefined)item[key]=operation[key];break;}
    case 'source.import_rows': {
      getEntity(state, operation.sourceId, 'source');
      for (const row of operation.rows) {
        applyOperation(state, { type: 'page.create', id: row.id, sourceId: operation.sourceId, title: row.title, templateId: null }, context);
        for (const [propertyId, value] of Object.entries(row.values)) applyOperation(state, { type: 'value.set', pageId: row.id, propertyId, value }, context);
      }
      break;
    }
    case 'page.create': {
      const source = operation.sourceId ? getEntity(state, operation.sourceId, 'source') : null;
      const templateId = operation.templateId === null ? null : operation.templateId ?? (!operation.template && source?.defaultTemplateId);
      if (templateId) {
        const template = getEntity(state, templateId, 'page');
        requireThat(template.template && template.sourceId === source?.id, 'TEMPLATE_SOURCE', '같은 데이터베이스의 템플릿을 선택하세요.');
        copyPage(state, template, { newId: operation.id, title: operation.title, sourceId: source.id }, context); break;
      }
      const parentId = source?.id ?? operation.parentId ?? null;
      if (parentId) requireThat(['page', 'source'].includes(getEntity(state, parentId).kind), 'INVALID_PARENT', '페이지의 부모를 확인하세요.');
      if (source) source.counter = (source.counter ?? 0) + 1;
      add(state, { id: operation.id, kind: 'page', title: operation.title, parentId, sourceId: source?.id ?? null, values: {}, template: operation.template ?? false, uniqueId: source?.counter ?? null }, context); break;
    }
    case 'page.apply_template': {
      const page = getEntity(state, operation.id, 'page'), template = getEntity(state, operation.templateId, 'page');
      requireThat(template.template && template.sourceId && template.sourceId === page.sourceId && !page.template, 'TEMPLATE_SOURCE', '같은 데이터베이스의 템플릿을 선택하세요.');
      const source = getEntity(state, page.sourceId, 'source'), counter = source.counter, temporary = objectId(), copiesBefore = context.copies.length;
      // Copy the template as a scratch page, hand its content and values to this page, then drop the scratch.
      copyPage(state, template, { newId: temporary, title: template.title, sourceId: source.id }, context);
      source.counter = counter; context.copies.length = copiesBefore;
      const scratch = state.get(temporary);
      let position = children(state, page.id).length;
      for (const child of children(state, temporary)) { child.parentId = page.id; child.position = position++; }
      const empty = value => value == null || value === '' || (Array.isArray(value) && !value.length);
      for (const [propertyId, value] of Object.entries(scratch.values ?? {})) if (empty(page.values?.[propertyId])) { page.values ??= {}; page.values[propertyId] = value; }
      if (!page.title) page.title = template.title;
      for (const key of ['icon', 'coverAttachmentId']) if (!page[key] && scratch[key]) page[key] = scratch[key];
      for (const item of state.values()) if (item.kind === 'page' && item.values) for (const [key, value] of Object.entries(item.values)) if (Array.isArray(value) && value.includes(temporary)) item.values[key] = value.map(id => id === temporary ? page.id : id);
      state.delete(temporary);
      break;
    }
    case 'page.update': {
      const page = getEntity(state, operation.id, 'page');
      if (operation.title !== undefined) page.title = operation.title;
      if (operation.icon !== undefined) page.icon = operation.icon;
      for(const key of ['coverAttachmentId','fullWidth'])if(operation[key]!==undefined)page[key]=operation[key];
      // Emoji reactions on the page (the feed's smiley button); one person, so each emoji is on or off.
      if(operation.reactions!==undefined){requireThat(new Set(operation.reactions).size===operation.reactions.length,'REACTION_DUPLICATE','같은 반응이 두 번 있습니다.');page.reactions=operation.reactions;}
      // 보관 · 페이지 잠금 · 위키: flags that are absent when off.
      for (const key of ['archived', 'locked', 'wiki']) if (operation[key] !== undefined) { if (operation[key]) page[key] = true; else delete page[key]; }
      if (operation.archived) page.archivedAt = context.now; else if (operation.archived === false) delete page.archivedAt;
      if (operation.databasePage === null) delete page.databasePage; else if (operation.databasePage !== undefined) page.databasePage = operation.databasePage;
      break;
    }
    case 'version.name': {
      const page = getEntity(state, operation.pageId, 'page');
      requireThat(operation.revision <= context.workspace.revision, 'HISTORY_REVISION', '저장된 revision 범위에서 선택하세요.');
      const names = { ...(page.versionNames ?? {}) };
      if (operation.name === null) delete names[operation.revision]; else names[operation.revision] = operation.name;
      if (Object.keys(names).length) page.versionNames = names; else delete page.versionNames;
      break;
    }
    case 'navigation.set': {
      requireThat(new Set(operation.favorites).size===operation.favorites.length,'NAVIGATION_DUPLICATE','즐겨찾기 ID가 중복됩니다.');for(const id of operation.favorites)requireThat(['page','source','view'].includes(getEntity(state,id).kind),'NAVIGATION_TARGET','페이지 또는 보기를 선택하세요.');
      const current=state.get('workspace-navigation');if(current)current.favorites=operation.favorites;else add(state,{id:'workspace-navigation',kind:'navigation',parentId:null,favorites:operation.favorites},context);break;
    }
    case 'workspace.update': {
      if (operation.icon?.startsWith('attachment:')) requireThat(state.get(operation.icon.slice(11))?.kind === 'attachment' && iconImageTypes.includes(state.get(operation.icon.slice(11)).mediaType), 'ATTACHMENT_REF', '아이콘으로 쓸 이미지를 찾을 수 없습니다.');
      let settings = state.get('workspace-settings');
      if (!settings) settings = add(state, { id: 'workspace-settings', kind: 'settings', parentId: null }, context);
      // 빠른 기록's page: where a capture lands when it names none.
      if (operation.capturePageId) requireThat(state.get(operation.capturePageId)?.kind === 'page' && visible(state, operation.capturePageId), 'CAPTURE_TARGET', '빠른 기록 페이지를 찾을 수 없습니다.');
      for (const key of ['name', 'icon', 'capturePageId']) if (operation[key] !== undefined) { if (operation[key] === null || operation[key] === '') delete settings[key]; else settings[key] = operation[key]; }
      break;
    }
    case 'emoji.set': {
      if (operation.attachmentId) requireThat(state.get(operation.attachmentId)?.kind === 'attachment' && iconImageTypes.includes(state.get(operation.attachmentId).mediaType), 'ATTACHMENT_REF', '이모지로 쓸 이미지를 찾을 수 없습니다.');
      let registry = state.get('workspace-emoji');
      if (!registry) registry = add(state, { id: 'workspace-emoji', kind: 'emoji', parentId: null, emoji: {} }, context);
      const emoji = { ...(registry.emoji ?? {}) };
      if (operation.attachmentId) emoji[operation.name] = operation.attachmentId; else delete emoji[operation.name];
      registry.emoji = emoji;
      break;
    }
    case 'node.move': {
      const node = getEntity(state, operation.id);
      requireThat(['page', 'block', 'view', 'source'].includes(node.kind), 'INVALID_MOVE', '페이지·블록·보기·데이터 소스만 이동할 수 있습니다.');
      if (node.kind === 'source') {
        // A data source goes to another page (inline there, or one more source of a database page) — never under itself.
        const target = getEntity(state, operation.parentId, 'page');
        requireThat(!target.sourceId && !target.template, 'INVALID_PARENT', '데이터 소스는 일반 페이지나 데이터베이스 페이지로만 옮길 수 있습니다.');
        for (let at = target; at; at = at.parentId ? state.get(at.parentId) : null) requireThat(at.id !== node.id, 'INVALID_PARENT', '데이터 소스를 자기 안으로 옮길 수 없습니다.');
      }
      move(state, node, operation.parentId, operation.beforeId); break;
    }
    case 'node.trash': {
      const node = getEntity(state, operation.id);
      requireThat(!['attachment'].includes(node.kind), 'ATTACHMENT_RETENTION', '첨부 bytes는 참조 해제 후에도 복구를 위해 보존됩니다.');
      node.alive = false; node.trashedAt = context.now;
      if(node.template&&node.sourceId&&state.get(node.sourceId)?.defaultTemplateId===node.id)state.get(node.sourceId).defaultTemplateId=null;
      if (node.kind === 'page' && node.sourceId) for (const child of taskDescendants(state, node)) if (child.alive) { child.alive = false; child.taskTrashRootId = node.id; }
      if (node.kind === 'property' && node.inversePropertyId) state.get(node.inversePropertyId).alive = false;
      break;
    }
    case 'node.purge': {
      const node = getEntity(state, operation.id, null, true);
      requireThat(!node.alive && !node.purged, 'PURGE_TARGET', '휴지통에 있는 항목만 영구 삭제할 수 있습니다.', { id: node.id });
      requireThat(!['attachment', 'notification', 'navigation'].includes(node.kind), 'PURGE_TARGET', '이 항목은 영구 삭제할 수 없습니다.', { id: node.id });
      node.purged = true; node.purgedAt = context.now;
      for (const child of state.values()) if (child.taskTrashRootId === node.id) { child.purged = true; child.purgedAt = context.now; }
      break;
    }
    case 'node.restore': {
      const node = getEntity(state, operation.id, null, true);
      requireThat(!node.purged, 'PURGED', '영구 삭제한 항목은 복원할 수 없습니다. 변경 기록에서 그 작업을 취소하세요.', { id: node.id });
      node.alive = true; delete node.trashedAt;
      requireThat(node.parentId === null || visible(state, node.parentId), 'PARENT_IN_TRASH', '부모 항목을 먼저 복원하세요.');
      if (node.kind === 'page' && node.sourceId) {
        const parent = taskParent(state, node);
        requireThat(!parent || visible(state, parent), 'PARENT_IN_TRASH', '상위 업무를 먼저 복원하세요.');
        delete node.taskTrashRootId;
        for (const child of state.values()) if (child.taskTrashRootId === node.id) { child.alive = true; delete child.taskTrashRootId; }
      }
      if (node.kind === 'property' && node.inversePropertyId) {
        const inverse = state.get(node.inversePropertyId);
        requireThat(visible(state, inverse.parentId), 'PARENT_IN_TRASH', '역관계의 부모 소스를 먼저 복원하세요.'); inverse.alive = true;
      }
      break;
    }
    case 'block.create': {
      const parent = getEntity(state, operation.parentId);
      requireThat(['page', 'block'].includes(parent.kind) && parent.blockType !== 'synced_reference', 'INVALID_PARENT', '블록을 추가할 위치를 확인하세요.');
      const { type, beforeId, columnIds, ...data } = operation;
      requireThat(!columnIds || data.blockType === 'columns', 'COLUMN_IDS', '단 ID는 다단 블록을 만들 때만 지정할 수 있습니다.');
      for (const key of ['icon', 'color', 'ratio', 'columnWidths', 'rowColors', 'columnColors', 'caption', 'height', 'width', 'listFormat']) if (data[key] === null) delete data[key];
      if (data.listFormat && data.blockType !== 'numbered') delete data.listFormat;
      const block = add(state, { ...data, kind: 'block' }, context);
      if(block.blockType==='columns')for(const columnId of columnIds??[undefined,undefined])add(state,{...(columnId?{id:columnId}:{}),kind:'block',blockType:'column',parentId:block.id,richText:[]},context);
      if (beforeId) move(state, block, operation.parentId, beforeId);
      break;
    }
    case 'block.update': {
      const block = getEntity(state, operation.id, 'block');
      requireThat(block.blockType !== 'synced_reference', 'SYNCED_REFERENCE', '참조에 표시된 공유 원본 블록을 편집하세요.');
      for (const key of ['blockType', 'richText', 'checked', 'language', 'url', 'attachmentId', 'button','bookmark','cells','tableHeader','toggleable']) if (operation[key] !== undefined) block[key] = clone(operation[key]);
      for (const key of ['icon', 'color', 'ratio', 'columnWidths', 'rowColors', 'columnColors', 'caption', 'height', 'width', 'listFormat', 'align', 'alt', 'href', 'crop', 'mask', 'direction', 'cellColors', 'merges']) if (operation[key] === null) delete block[key]; else if (operation[key] !== undefined) block[key] = clone(operation[key]);
      if (block.listFormat && block.blockType !== 'numbered') delete block.listFormat;
      if (block.toggleable && !/^heading[1-4]$/.test(block.blockType)) delete block.toggleable;
      if(operation.url!==undefined&&block.bookmark?.url!==operation.url)delete block.bookmark;
      if(block.blockType==='table'&&!block.cells)block.cells=[[clone(block.richText??[]),[]],[[],[]]];
      if(block.blockType==='columns'&&!children(state,block.id).length)for(let i=0;i<2;i++){const column=add(state,{kind:'block',blockType:'column',parentId:block.id,richText:[]},context);if(i===0&&block.richText?.length)add(state,{kind:'block',blockType:'paragraph',parentId:column.id,richText:block.richText},context);}if(block.blockType==='columns')block.richText=[];
      break;
    }
    case 'block.unsync': {
      // A copy (synced_reference) becomes a plain copy of the original's content where it stands; the original
      // (synced) turns every copy into its own blocks and then gives way to its content.
      const block = getEntity(state, operation.id, 'block');
      requireThat(['synced', 'synced_reference'].includes(block.blockType), 'UNSYNC_TARGET', '동기화 블록이나 그 사본을 선택하세요.');
      const detach = reference => {
        const source = state.get(reference.sourceBlockId), originals = clone(state);
        const content = source ? children(originals, source.id).filter(child => child.kind === 'block' && child.alive) : [];
        const siblings = children(state, reference.parentId), after = siblings[siblings.findIndex(item => item.id === reference.id) + 1];
        if (content.length) {
          const before = context.copies.length;
          copyBlocks(state, originals, content, reference.parentId, context);
          const map = context.copies[before].idMap;
          for (const item of content) move(state, state.get(map[item.id]), reference.parentId, after?.id);
          context.copies.splice(before, 1);
        }
        reference.alive = false; reference.trashedAt = context.now;
      };
      if (block.blockType === 'synced_reference') detach(block);
      else {
        for (const reference of [...state.values()].filter(item => item.kind === 'block' && item.blockType === 'synced_reference' && item.sourceBlockId === block.id && item.alive)) detach(reference);
        const siblings = children(state, block.parentId), after = siblings[siblings.findIndex(item => item.id === block.id) + 1];
        for (const child of children(state, block.id).filter(child => child.kind === 'block')) move(state, child, block.parentId, after?.id);
        block.alive = false; block.trashedAt = context.now;
      }
      break;
    }
    case 'block.duplicate': {
      const original = getEntity(state, operation.id, 'block'), parentId = operation.parentId ?? original.parentId;
      const originals = clone(state), [copy] = copyBlocks(state, originals, [original], parentId, context, operation.newId);
      move(state, copy, parentId, operation.beforeId); break;
    }
    case 'blocks.duplicate': {
      requireThat(new Set(operation.ids).size===operation.ids.length,'DUPLICATE_ROOT','복제할 블록 ID가 중복됩니다.');const originals=clone(state),roots=operation.ids.map(id=>getEntity(state,id,'block'));
      for(const root of roots){let parent=originals.get(root.parentId);while(parent?.kind==='block'){requireThat(!operation.ids.includes(parent.id),'DUPLICATE_ROOT','부모와 그 자식을 동시에 선택하지 마세요.');parent=originals.get(parent.parentId)}}
      copyBlocks(state,originals,roots,block=>block.parentId,context);const map=context.copies.at(-1).idMap;for(const root of roots){const siblings=children(originals,root.parentId),next=siblings[siblings.findIndex(x=>x.id===root.id)+1];move(state,state.get(map[root.id]),root.parentId,next?.id)}break;
    }
    case 'comment.create': {
      const parent = getEntity(state, operation.parentId);
      requireThat(['page', 'block'].includes(parent.kind), 'COMMENT_TARGET', '페이지나 블록에 주석을 남길 수 있습니다.');
      if (operation.propertyId) requireThat(parent.kind === 'page' && parent.sourceId && getEntity(state, operation.propertyId, 'property').sourceId === parent.sourceId, 'COMMENT_PROPERTY', '이 페이지의 데이터베이스 속성에만 댓글을 달 수 있습니다.');
      if (operation.threadId) {
        const root = getEntity(state, operation.threadId, 'comment');
        requireThat(root.parentId === parent.id && !root.threadId && (root.propertyId ?? null) === (operation.propertyId ?? null), 'COMMENT_THREAD', '답글은 같은 대상의 첫 댓글에 이어서 달 수 있습니다.');
      }
      // Emoji reactions (18차, "고른 글에 반응"): one person, so each emoji is on or off. A thread made from a
      // reaction alone has no text.
      if (operation.reactions) requireThat(new Set(operation.reactions).size === operation.reactions.length, 'REACTION_DUPLICATE', '같은 반응이 두 번 있습니다.');
      requireThat(operation.richText.length || operation.reactions?.length, 'COMMENT_EMPTY', '댓글 내용이나 반응이 필요합니다.');
      const { type, ...data } = operation; const comment = add(state, { ...data, kind: 'comment', resolved: false }, context);
      if (context.actor !== 'user' && !['scheduler', 'preview'].includes(context.actor)) {
        let page = parent; while (page && page.kind !== 'page') page = state.get(page.parentId);
        const words = operation.richText.map(run => run.text).join('').slice(0, 200) || (operation.reactions ?? []).join(' ');
        notify(state, page?.id ?? parent.id, `${context.actor}: ${words}`, context, objectId(), 'comment');
      }
      void comment; break;
    }
    case 'comment.update': {
      const comment = getEntity(state, operation.id, 'comment');
      if (operation.reactions) requireThat(new Set(operation.reactions).size === operation.reactions.length, 'REACTION_DUPLICATE', '같은 반응이 두 번 있습니다.');
      for (const key of ['richText', 'resolved', 'reactions']) if (operation[key] !== undefined) comment[key] = clone(operation[key]);
      break;
    }
    case 'source.create': {
      getEntity(state, operation.pageId, 'page');
      const source = add(state, { id: operation.id, kind: 'source', parentId: operation.pageId, name: operation.name, counter: 0 }, context);
      add(state, { id: operation.titlePropertyId, kind: 'property', type: 'title', sourceId: source.id, parentId: source.id, name: operation.titleName ?? '이름' }, context); break;
    }
    case 'source.update': {
      const source = getEntity(state, operation.id, 'source');
      if (operation.name !== undefined) source.name = operation.name;
      if (operation.locked !== undefined) { if (operation.locked) source.locked = true; else delete source.locked; }
      if (operation.pageLayout !== undefined) {
        if (operation.pageLayout === null) delete source.pageLayout;
        else {
          const own = propertyId => requireThat(state.get(propertyId)?.kind === 'property' && state.get(propertyId).sourceId === source.id, 'LAYOUT_PROPERTY', '이 데이터베이스의 속성만 배치할 수 있습니다.');
          for (const key of ['order', 'hidden', 'panel', 'pinned', 'hideWhenEmpty']) for (const propertyId of operation.pageLayout[key] ?? []) own(propertyId);
          // Relations open as lists of pages and don't fit the side panel.
          for (const propertyId of operation.pageLayout.panel ?? []) requireThat(state.get(propertyId).type !== 'relation', 'LAYOUT_PANEL', '관계형 속성은 패널에 넣을 수 없습니다.');
          for (const tab of operation.pageLayout.tabs ?? []) {
            const view = state.get(tab.viewId);
            requireThat(view?.kind === 'view', 'LAYOUT_TAB', '탭에 넣을 보기를 찾을 수 없습니다.');
            if (tab.relationPropertyId) { const relation = state.get(tab.relationPropertyId); requireThat(relation?.kind === 'property' && relation.type === 'relation' && relation.sourceId === view.sourceId && relation.targetSourceId === source.id, 'LAYOUT_TAB', '탭의 관계형 속성은 이 데이터베이스를 가리켜야 합니다.'); }
          }
          requireThat(new Set((operation.pageLayout.tabs ?? []).map(tab => tab.id)).size === (operation.pageLayout.tabs ?? []).length, 'LAYOUT_TAB', '탭 ID가 겹칩니다.');
          for (const section of operation.pageLayout.sections ?? []) { if (section.type === 'property') own(section.propertyId); for (const propertyId of section.properties ?? []) own(propertyId); }
          requireThat(new Set((operation.pageLayout.sections ?? []).map(section => section.id)).size === (operation.pageLayout.sections ?? []).length, 'LAYOUT_SECTION', '섹션 ID가 겹칩니다.');
          source.pageLayout = clone(operation.pageLayout);
        }
      }
      break;
    }
    case 'source.configure_tasks': configureTasks(state, operation, context); break;
    case 'source.configure_sprints': configureSprints(state, operation, context); break;
    case 'sprint.complete': completeSprint(state, getEntity(state, operation.id, 'source'), context); break;
    case 'source.configure_templates': {
      const source = getEntity(state, operation.id, 'source');
      if (operation.defaultTemplateId) { const template = getEntity(state, operation.defaultTemplateId, 'page'); requireThat(template.template && template.sourceId === source.id, 'TEMPLATE_SOURCE', '같은 데이터베이스의 템플릿을 선택하세요.'); }
      source.defaultTemplateId = operation.defaultTemplateId; break;
    }
    case 'template.configure': {
      const template = getEntity(state, operation.id, 'page'); requireThat(template.template && template.sourceId, 'TEMPLATE_SOURCE', 'DB 템플릿만 반복할 수 있습니다.');
      template.recurrence = operation.recurrence ? { ...operation.recurrence, index: 0, nextAt: occurrence(operation.recurrence, 0) } : null; break;
    }
    case 'button.run': runButton(state, operation, context); break;
    case 'reminder.set': {
      const parent = getEntity(state, operation.parentId);
      requireThat(['page','block'].includes(parent.kind), 'REMINDER_TARGET', '페이지 또는 본문 블록을 선택하세요.');
      if (operation.datePropertyId) requireThat(parent.kind === 'page' && state.get(operation.datePropertyId)?.sourceId === parent.sourceId && state.get(operation.datePropertyId)?.type === 'date', 'REMINDER_PROPERTY', '해당 행의 날짜 속성을 선택하세요.');
      else requireThat(operation.at, 'REMINDER_DATE', '알림 시각을 지정하세요.');
      const { type, ...data } = operation, existing = data.id && state.get(data.id);
      if (existing) { requireThat(existing.kind === 'reminder', 'REMINDER_TARGET', '알림 ID를 확인하세요.'); Object.assign(existing, data, { deliveredFor: null, alive: true }); if (!data.datePropertyId) delete existing.datePropertyId; }
      else add(state, { ...data, kind: 'reminder', deliveredFor: null }, context);
      break;
    }
    case 'notification.read': getEntity(state, operation.id, 'notification').read = operation.read; break;
    case 'notification.archive': { const note = getEntity(state, operation.id, 'notification'); if (operation.archived) { note.archived = true; note.read = true; } else delete note.archived; break; }
    case 'scheduler.tick': runSchedules(state, operation.at, context); break;
    case 'automation.create': {
      const source = getEntity(state, operation.sourceId, 'source');
      if (operation.viewId) requireThat(getEntity(state, operation.viewId, 'view').sourceId === source.id, 'AUTOMATION_VIEW', '같은 데이터베이스의 보기를 선택하세요.');
      validateAutomation(state, source.id, operation.triggers, operation.actions);
      const { type, ...data } = operation;
      add(state, { ...clone(data), kind: 'automation', parentId: source.id, viewId: operation.viewId ?? null, schedule: automationSchedule(operation.triggers, context.now) }, context); break;
    }
    case 'automation.update': {
      const item = getEntity(state, operation.id, 'automation');
      for (const key of ['name', 'enabled', 'match', 'viewId', 'triggers', 'actions']) if (operation[key] !== undefined) item[key] = clone(operation[key]);
      if (item.viewId) requireThat(getEntity(state, item.viewId, 'view').sourceId === item.sourceId, 'AUTOMATION_VIEW', '같은 데이터베이스의 보기를 선택하세요.');
      validateAutomation(state, item.sourceId, item.triggers, item.actions);
      if (operation.triggers || operation.enabled) item.schedule = automationSchedule(item.triggers, context.now);
      break;
    }
    case 'automation.delete': getEntity(state, operation.id, 'automation').alive = false; break;
    case 'content.import_bundle': importBundle(state,operation,context,{add,remapButton}); break;
    case 'property.create': {
      getEntity(state, operation.sourceId, 'source');
      const { type: commandType, propertyType, inverse, ...data } = operation;
      if (data.dateFormat != null || data.timeFormat != null) requireThat(dateTypes.has(propertyType), 'PROPERTY_TYPE', '날짜 속성에만 날짜 형식을 지정할 수 있습니다.');
      for (const key of ['dateFormat', 'timeFormat']) if (data[key] == null) delete data[key];
      const property = add(state, { ...data, type: propertyType, kind: 'property', parentId: operation.sourceId }, context);
      if (property.type === 'relation' && inverse) {
        getEntity(state, property.targetSourceId, 'source');
        const reverse = add(state, { id: inverse.id, kind: 'property', name: inverse.name, type: 'relation', parentId: property.targetSourceId, sourceId: property.targetSourceId, targetSourceId: property.sourceId, inversePropertyId: property.id }, context);
        property.inversePropertyId = reverse.id;
      } else if (property.type === 'relation' && property.targetSourceId === property.sourceId) property.inversePropertyId = property.id;
      compileProperty(state, property); break;
    }
    case 'property.update': {
      const property = getEntity(state, operation.id, 'property');
      if (operation.rollup) requireThat(property.type === 'rollup', 'PROPERTY_TYPE', '롤업 속성에만 집계 정의를 지정할 수 있습니다.');
      if (operation.formula !== undefined) requireThat(property.type === 'formula', 'PROPERTY_TYPE', '수식 속성에만 식을 지정할 수 있습니다.');
      if (operation.idPrefix !== undefined) requireThat(property.type === 'unique_id', 'PROPERTY_TYPE', 'ID 속성에만 접두사를 지정할 수 있습니다.');
      for (const key of ['name', 'options', 'formula', 'rollup', 'button','relationLimit','displayProperties','numberFormat']) if (operation[key] !== undefined) property[key] = clone(operation[key]);
      if (operation.idPrefix === null || operation.idPrefix === '') delete property.idPrefix; else if (operation.idPrefix !== undefined) property.idPrefix = operation.idPrefix;
      for (const key of ['dateFormat', 'timeFormat']) {
        if (operation[key] == null) { if (operation[key] === null) delete property[key]; continue; }
        requireThat(dateTypes.has(property.type), 'PROPERTY_TYPE', '날짜 속성에만 날짜 형식을 지정할 수 있습니다.'); property[key] = operation[key];
      }
      if (operation.formula !== undefined) compileProperty(state, property); break;
    }
    case 'property.convert': convertProperty(state, operation, context); break;
    case 'value.set': setValue(state, operation.pageId, operation.propertyId, operation.value); break;
    case 'relation.set': {
      requireThat(getEntity(state, operation.propertyId, 'property').type === 'relation', 'PROPERTY_TYPE', '관계 속성이 필요합니다.');
      setValue(state, operation.pageId, operation.propertyId, operation.targetIds); break;
    }
    case 'view.create': {
      getEntity(state, operation.sourceId, 'source'); getEntity(state, operation.parentId, 'page');
      const { type, ...data } = operation; add(state, { ...data, kind: 'view' }, context); break;
    }
    case 'view.update': {
      const view = getEntity(state, operation.id, 'view');
      for (const key of ['name', 'viewType']) if (operation[key] !== undefined) view[key] = operation[key];
      if (operation.config) view.config = { ...view.config, ...clone(operation.config) };
      break;
    }
    case 'page.duplicate': case 'template.instantiate': {
      const original = getEntity(state, operation.id, 'page');
      if (operation.type === 'template.instantiate') requireThat(original.template, 'NOT_TEMPLATE', '템플릿 페이지가 필요합니다.');
      const sourceId = operation.sourceId ?? original.sourceId;
      if (operation.type === 'template.instantiate') requireThat(original.sourceId === sourceId, 'TEMPLATE_SOURCE', '같은 소스의 템플릿을 사용하세요.');
      copyPage(state, original, operation, context); break;
    }
    case 'page.restore_version': {
      const page = getEntity(state, operation.id, 'page'), past = context.workspace.stateAt(operation.revision);
      restorePageFrom(state, past, page.id);
      break;
    }
    case 'source.restore_version': {
      // The rows and properties as they were: rows made since go to the trash, rows trashed since come back, and every
      // row of then gets its title, icon, values and content back. Views and the database's place stay as they are.
      const source = getEntity(state, operation.id, 'source'), past = context.workspace.stateAt(operation.revision);
      requireThat(past.get(source.id)?.kind === 'source', 'RESTORE_SOURCE', '그 시점에는 이 데이터베이스가 없었습니다.');
      const pastProperties = [...past.values()].filter(item => item.kind === 'property' && item.sourceId === source.id);
      const pastAlive = new Set(pastProperties.filter(item => item.alive).map(item => item.id));
      for (const property of [...state.values()].filter(item => item.kind === 'property' && item.sourceId === source.id)) {
        if (property.type === 'title') continue;
        if (property.alive && !pastAlive.has(property.id)) { property.alive = false; property.trashedAt = context.now; if (property.inversePropertyId && state.get(property.inversePropertyId)) state.get(property.inversePropertyId).alive = false; }
      }
      for (const original of pastProperties) {
        if (!original.alive) continue;
        const { version, updatedAt, updatedBy, ...definition } = clone(original);
        state.set(original.id, { ...(state.get(original.id) ?? {}), ...definition, alive: true });
        delete state.get(original.id).trashedAt;
        const inverse = original.inversePropertyId ? state.get(original.inversePropertyId) : null;
        if (inverse && past.get(inverse.id)?.alive) inverse.alive = true;
      }
      const rowsThen = [...past.values()].filter(item => item.kind === 'page' && item.sourceId === source.id && !item.template && item.alive);
      const keep = new Set(rowsThen.map(row => row.id));
      for (const row of [...state.values()].filter(item => item.kind === 'page' && item.sourceId === source.id && !item.template && item.alive))
        if (!keep.has(row.id)) { row.alive = false; row.trashedAt = context.now; }
      for (const original of rowsThen) {
        const row = state.get(original.id);
        if (!row) { state.set(original.id, clone(original)); continue; }
        requireThat(!row.purged, 'PURGED', '영구 삭제한 행이 있어 복원할 수 없습니다.', { id: row.id });
        row.alive = true; delete row.trashedAt; delete row.taskTrashRootId;
        if (original.archived) row.archived = true; else delete row.archived;
      }
      for (const original of rowsThen) restorePageFrom(state, past, original.id);
      break;
    }
    case 'attachment.register': {
      // A stored blob is named by its hash when it is written (putBlob, putBlobStream); a small one is hashed again here,
      // a large one (that would not fit in memory) is checked by its size.
      const blob = path.join(context.workspace.blobDirectory, operation.sha256), size = statSync(blob, { throwIfNoEntry: false })?.size;
      requireThat(size === operation.bytes && (size > 64 * 1024 ** 2 || digest(readFileSync(blob)) === operation.sha256), 'BLOB_INTEGRITY', '저장된 bytes를 먼저 확인해야 합니다.');
      const { type, reference, ...data } = operation, attachment = add(state, { ...data, kind: 'attachment', parentId: null }, context);
      if (reference?.propertyId) {
        requireThat(getEntity(state, reference.propertyId, 'property').type === 'files', 'ATTACHMENT_PROPERTY', '파일 속성에 첨부하세요.');
        setValue(state, reference.pageId, reference.propertyId, [...reference.attachmentIds, attachment.id]);
      } else if (reference?.parentId) {
        const { blockId, ...position } = reference;
        applyOperation(state, { type: 'block.create', id: blockId, ...position, attachmentId: attachment.id, richText: [] }, context);
      } else if (reference) {
        const block = getEntity(state, reference.blockId, 'block');
        requireThat(['file', 'image', 'html', 'pdf', 'video', 'audio'].includes(block.blockType), 'ATTACHMENT_BLOCK', '파일, 이미지, PDF, 동영상, 오디오, HTML 블록에 첨부하세요.');
        block.attachmentId = attachment.id;
      }
      break;
    }
  }
}

function validateState(state) {
  const childIndex = new Map();
  for (const entity of state.values()) {
    if (!childIndex.has(entity.parentId)) childIndex.set(entity.parentId, []);
    childIndex.get(entity.parentId).push(entity.id);
  }
  for (const entity of state.values()) {
    requireThat(entity.parentId == null || state.has(entity.parentId), 'MISSING_PARENT', '부모 항목이 존재하지 않습니다.', { id: entity.id });
    if (entity.kind === 'block') {
      for (const run of [...entity.richText ?? [],...entity.cells?.flat(2)??[],...entity.caption??[]]) {
        if (run.href) requireThat(safeUrl(run.href), 'UNSAFE_LINK', '허용하지 않는 링크 형식입니다.');
        if (run.pageId) requireThat(state.get(run.pageId)?.kind === 'page', 'PAGE_REFERENCE', '참조할 페이지를 찾을 수 없습니다.');
        if (run.mention) requireThat(!!run.href, 'LINK_MENTION', '링크 멘션에는 주소가 필요합니다.');
        for (const key of ['iconAttachmentId', 'customEmoji']) if (run[key]) requireThat(state.get(run[key])?.kind === 'attachment' && iconImageTypes.includes(state.get(run[key]).mediaType), 'ATTACHMENT_REF', '첨부 이미지를 찾을 수 없습니다.');
      }
      if (entity.href) requireThat(safeUrl(entity.href) || /^\?id=[^&]+$/.test(entity.href), 'UNSAFE_LINK', '허용하지 않는 링크 형식입니다.');
      for (const key of ['imageAttachmentId', 'iconAttachmentId']) if (entity.bookmark?.[key]) requireThat(state.get(entity.bookmark[key])?.kind === 'attachment', 'ATTACHMENT_REF', '첨부 파일을 찾을 수 없습니다.');
      if (entity.blockType === 'link_to_page') requireThat(entity.richText?.length === 1 && !!entity.richText[0].pageId, 'LINK_TO_PAGE', '연결할 페이지를 하나 지정하세요.');
      if (entity.blockType === 'embed' && entity.url) requireThat(/^https?:\/\//i.test(entity.url) && safeUrl(entity.url), 'UNSAFE_LINK', '허용하지 않는 링크 형식입니다.');
      if (entity.url) requireThat(safeUrl(entity.url), 'UNSAFE_LINK', '허용하지 않는 링크 형식입니다.');
      if(entity.blockType==='column')requireThat(state.get(entity.parentId)?.blockType==='columns','COLUMN_PARENT','단은 다단 블록 안에 있어야 합니다.');
      if(state.get(entity.parentId)?.blockType==='columns')requireThat(entity.blockType==='column','COLUMN_CHILD','다단 블록 안에는 단을 넣으세요.');
      if(entity.blockType==='tab')requireThat(state.get(entity.parentId)?.blockType==='tabs','TAB_PARENT','탭은 탭 블록 안에 있어야 합니다.');
      if(state.get(entity.parentId)?.blockType==='tabs')requireThat(entity.blockType==='tab','TAB_CHILD','탭 블록 안에는 탭을 넣으세요.');
      if(entity.cells)requireThat(entity.cells.length>0&&entity.cells.every(row=>row.length===entity.cells[0].length),'TABLE_CELLS','표의 각 행에 같은 개수의 셀이 필요합니다.');
      if (entity.blockType === 'synced_reference') {
        requireThat(state.get(entity.sourceBlockId)?.blockType === 'synced', 'SYNCED_SOURCE', '동기화 원본이 필요합니다.');
        if (visible(state, entity.id)) requireThat(visible(state, entity.sourceBlockId), 'SHARED_SOURCE_IN_USE', '공유 참조가 남아 있습니다. 참조를 먼저 제거한 뒤 원본을 휴지통으로 옮기세요.');
      }
      if (entity.attachmentId) {
        const attachment = state.get(entity.attachmentId);
        requireThat(attachment?.kind === 'attachment', 'ATTACHMENT_REF', '첨부 파일을 찾을 수 없습니다.');
        if (entity.blockType === 'image') requireThat(inlineImageTypes.includes(attachment.mediaType), 'IMAGE_MEDIA_TYPE', '이미지는 PNG, JPEG, GIF, WebP, AVIF 파일을 사용하세요.');
        if(entity.blockType==='video')requireThat(attachment.mediaType.startsWith('video/'),'VIDEO_MEDIA_TYPE','동영상 첨부를 선택하세요.');
        if(entity.blockType==='audio')requireThat(attachment.mediaType.startsWith('audio/'),'AUDIO_MEDIA_TYPE','오디오 첨부를 선택하세요.');
        if(entity.blockType==='html')requireThat(attachment.mediaType==='text/html','HTML_MEDIA_TYPE','HTML 파일(.html)을 선택하세요.');
        if(entity.blockType==='pdf')requireThat(attachment.mediaType==='application/pdf','PDF_MEDIA_TYPE','PDF 파일을 선택하세요.');
      }
    }
    if (entity.kind === 'comment') {
      requireThat(['page', 'block'].includes(state.get(entity.parentId)?.kind), 'COMMENT_TARGET', '주석의 대상이 존재해야 합니다.');
      for (const run of entity.richText) if (run.href) requireThat(safeUrl(run.href), 'UNSAFE_LINK', '허용하지 않는 링크 형식입니다.');
    }
    if (entity.kind === 'page' && entity.sourceId) {
      requireThat(state.get(entity.sourceId)?.kind === 'source' && entity.parentId === entity.sourceId, 'ROW_SOURCE', '행의 소스와 부모가 일치해야 합니다.');
      for (const [id, value] of Object.entries(entity.values)) {
        const property = state.get(id);
        requireThat(property?.kind === 'property' && property.sourceId === entity.sourceId, 'PROPERTY_SOURCE', '행 속성의 소스가 일치하지 않습니다.');
        if (property.alive) validateValue(state, property, value, true);
      }
    }
    if(entity.kind==='page'&&entity.coverAttachmentId)requireThat(state.get(entity.coverAttachmentId)?.kind==='attachment'&&inlineImageTypes.includes(state.get(entity.coverAttachmentId).mediaType),'PAGE_COVER','커버는 저장된 이미지 첨부를 사용하세요.');
    if (entity.kind === 'property') {
      if (entity.button) { requireThat(entity.type === 'button', 'BUTTON_SCHEMA', '버튼 설정은 버튼 속성에만 저장하세요.'); buttonDefinition.parse(entity.button); }
      requireThat(state.get(entity.sourceId)?.kind === 'source', 'PROPERTY_SOURCE', '속성 소스를 찾을 수 없습니다.');
      if (entity.type === 'title') requireThat(properties(state, entity.sourceId).filter(p => p.type === 'title').length === 1, 'TITLE_PROPERTY', '소스에는 제목 속성이 하나 있어야 합니다.');
      if (entity.type === 'relation') {
        for(const id of entity.displayProperties??[])requireThat(state.get(id)?.sourceId===entity.targetSourceId,'RELATION_DISPLAY','표시 속성은 관계 대상 DB의 속성이어야 합니다.');
        requireThat(state.get(entity.targetSourceId)?.kind === 'source', 'RELATION_SOURCE', '관계 대상 소스가 필요합니다.');
        if (entity.inversePropertyId) {
          const inverse = state.get(entity.inversePropertyId);
          requireThat(inverse?.type === 'relation' && inverse.sourceId === entity.targetSourceId && inverse.targetSourceId === entity.sourceId && inverse.inversePropertyId === entity.id, 'INVERSE_SCHEMA', '양방향 관계 정의가 일치하지 않습니다.');
        }
      }
      if (entity.type === 'rollup') {
        const relation = state.get(entity.rollup?.relationPropertyId), target = state.get(entity.rollup?.targetPropertyId);
        requireThat(relation?.type === 'relation' && relation.sourceId === entity.sourceId && target?.sourceId === relation.targetSourceId, 'ROLLUP_SCHEMA', '롤업의 관계/대상 속성을 확인하세요.');
      }
      requireThat(new Set((entity.options ?? []).map(option => option.id)).size === (entity.options ?? []).length, 'DUPLICATE_OPTION', '선택 옵션 ID가 겹칩니다.');
    }
    if (entity.kind === 'source' && entity.alive) requireThat(properties(state, entity.id).filter(p => p.type === 'title').length === 1, 'TITLE_PROPERTY', '소스의 제목 속성을 보존해야 합니다.');
    if (entity.kind === 'view') validateView(state, entity);
  }
  const done = new Set(), visiting = new Set();
  function visit(id) {
    if (done.has(id)) return;
    requireThat(!visiting.has(id), 'PARENT_CYCLE', '부모 또는 동기화 참조가 순환합니다.', { id });
    visiting.add(id);
    const entity = state.get(id);
    for (const childId of childIndex.get(id) ?? []) visit(childId);
    if (entity.blockType === 'synced_reference') visit(entity.sourceBlockId);
    visiting.delete(id); done.add(id);
  }
  for (const id of state.keys()) visit(id);
  validateTasks(state);
}
function pageBacklinks(state, targetId) {
  const result = new Map(), schemaCache = new Map();
  function mention(page, type) {
    if (!page || page.id === targetId || !visible(state, page.id)) return;
    if (!result.has(page.id)) result.set(page.id, { id: page.id, title: page.title, types: [] });
    const entry = result.get(page.id); if (!entry.types.includes(type)) entry.types.push(type);
  }
  for (const entity of state.values()) {
    if (!visible(state, entity.id)) continue;
    if (entity.kind === 'page' && entity.sourceId) {
      if (!schemaCache.has(entity.sourceId)) schemaCache.set(entity.sourceId, properties(state, entity.sourceId).filter(property => property.type === 'relation'));
      if (schemaCache.get(entity.sourceId).some(property => entity.values[property.id]?.includes(targetId))) mention(entity, 'relation');
    }
    if (entity.kind === 'block' && [...entity.richText??[],...entity.cells?.flat(2)??[]].some(run => run.pageId === targetId)) {
      let parent = state.get(entity.parentId);
      while (parent && parent.kind !== 'page') parent = state.get(parent.parentId);
      mention(parent, 'page-mention');
    }
  }
  return [...result.values()];
}
function validateView(state, view) {
  requireThat(state.get(view.sourceId)?.kind === 'source' && viewTypes.includes(view.viewType), 'VIEW_SOURCE', '보기의 소스/유형을 확인하세요.');
  const config = view.config;
  const check = id => requireThat(state.get(id)?.kind === 'property' && state.get(id).sourceId === view.sourceId, 'VIEW_PROPERTY', '다른 소스의 속성을 보기에 사용할 수 없습니다.', { id });
  const filters = filter => {
    if (!filter) return;
    if (filter.all || filter.any) (filter.all ?? filter.any).forEach(filters);
    else if (filter.not) filters(filter.not); else check(filter.propertyId);
  };
  filters(config.filter);
  for (const sort of config.sorts ?? []) check(sort.propertyId);
  for (const id of [...config.visibleProperties ?? [],...config.frozenProperties ?? [],...Object.keys(config.columnAggregations??{})]) check(id);
  requireThat(new Set(config.visibleProperties ?? []).size === (config.visibleProperties ?? []).length, 'VIEW_COLUMNS', '같은 표시 속성을 여러 번 넣을 수 없습니다.');
  for (const key of ['groupBy', 'subgroupBy', 'datePropertyId', 'endDatePropertyId', 'placePropertyId', 'previewPropertyId']) if (config[key]) check(config[key]);
  for (const key of ['datePropertyId', 'endDatePropertyId']) if (config[key]) requireThat(state.get(config[key]).type === 'date', 'VIEW_PROPERTY_TYPE', '달력·타임라인에는 날짜 속성이 필요합니다.');
  if (config.placePropertyId) requireThat(state.get(config.placePropertyId).type === 'place', 'VIEW_PROPERTY_TYPE', '지도에는 장소 속성이 필요합니다.');
  if (config.chart) { check(config.chart.groupBy); if (config.chart.valuePropertyId) check(config.chart.valuePropertyId); }
  if(config.previewPropertyId)requireThat(state.get(config.previewPropertyId).type==='files','VIEW_PROPERTY_TYPE','카드 미리보기에는 파일 속성이 필요합니다.');
  for(const key of [...config.hiddenGroups??[],...config.groupOrder??[]]){try{JSON.parse(key)}catch{requireThat(false,'VIEW_GROUP','그룹 결과의 key를 사용하세요.')}}
  for (const widget of config.widgets ?? []) requireThat(state.get(widget)?.kind === 'view' && widget !== view.id && state.get(widget).viewType !== 'dashboard', 'DASHBOARD_WIDGET', '대시보드에는 일반 보기를 연결하세요.');
  // Dashboard rows hold its widgets (each once); its filters name a data source of a widget and that source's properties.
  const rowIds = (config.dashboardRows ?? []).flat();
  requireThat(new Set(rowIds).size === rowIds.length && rowIds.every(id => (config.widgets ?? []).includes(id)), 'DASHBOARD_LAYOUT', '대시보드 줄에는 연결한 위젯을 한 번씩만 넣으세요.');
  for (const [sourceId, filter] of Object.entries(config.dashboardFilters ?? {})) {
    requireThat((config.widgets ?? []).some(id => state.get(id)?.sourceId === sourceId), 'DASHBOARD_FILTER', '대시보드 필터는 위젯의 데이터 소스에 지정하세요.');
    const walk = node => { if (!node) return; if (node.propertyId) requireThat(state.get(node.propertyId)?.kind === 'property' && state.get(node.propertyId).sourceId === sourceId, 'DASHBOARD_FILTER', '대시보드 필터에는 그 데이터 소스의 속성을 쓰세요.'); for (const child of node.all ?? node.any ?? []) walk(child); if (node.not) walk(node.not); };
    walk(filter);
  }
  for (const id of Object.keys(config.dashboardSizes ?? {})) requireThat((config.widgets ?? []).includes(id), 'DASHBOARD_LAYOUT', '대시보드 크기는 연결한 위젯에만 지정하세요.');
  if (config.dashboardShared) {
    const { sourceId, filter } = config.dashboardShared;
    requireThat((config.widgets ?? []).some(id => state.get(id)?.sourceId === sourceId), 'DASHBOARD_FILTER', '대시보드 필터는 위젯의 데이터 소스에 지정하세요.');
    const walk = node => { if (!node) return; if (node.propertyId) requireThat(state.get(node.propertyId)?.kind === 'property' && state.get(node.propertyId).sourceId === sourceId, 'DASHBOARD_FILTER', '대시보드 필터에는 그 데이터 소스의 속성을 쓰세요.'); for (const child of node.all ?? node.any ?? []) walk(child); if (node.not) walk(node.not); };
    walk(filter);
  }
}

export function createReader(state, { includeTrashed = false } = {}) {
  const cache = new Map(), evaluating = new Set();
  function formulaInput(pageId,id){const raw=readRaw(pageId,id),input=state.get(id),label=optionId=>input.options?.find(o=>o.id===optionId)?.name??'';return ['select','status'].includes(input.type)?raw==null?'':label(raw):input.type==='multi_select'?(raw??[]).map(label):raw;}
  function readRaw(pageId, propertyId) {
    const key = `${pageId}\0${propertyId}`;
    if (cache.has(key)) return cache.get(key);
    requireThat(!evaluating.has(key), 'FORMULA_CYCLE', '계산 속성 참조가 순환합니다.');
    evaluating.add(key);
    try {
      const page = getEntity(state, pageId, 'page', includeTrashed), property = getEntity(state, propertyId, 'property', includeTrashed);
      requireThat(page.sourceId === property.sourceId, 'PROPERTY_SOURCE', '다른 소스의 속성을 읽을 수 없습니다.');
      let value;
      if (property.type === 'title') value = page.title;
      else if (property.type === 'formula') value = evaluateFormula(property.ast,id=>formulaInput(pageId,id),{pageId,readRelated:(target,ref)=>ref==='$title'?state.get(target)?.title??String(target??''):formulaInput(target,ref)});
      else if (property.type === 'rollup') {
        const definition = property.rollup, ids = readRaw(pageId, definition.relationPropertyId) ?? [];
        const values = ids.map(id => readRaw(id, definition.targetPropertyId));
        value = aggregate(values,definition.aggregation);
      } else if (property.type === 'created_time') value = page.createdAt;
      else if (property.type === 'last_edited_time') value = page.updatedAt;
      else if (property.type === 'created_by') value = page.createdBy;
      else if (property.type === 'last_edited_by') value = page.updatedBy;
      else if (property.type === 'unique_id') value = page.uniqueId;
      else if (property.type === 'relation') value = (page.values[propertyId] ?? []).filter(id => visible(state, id));
      else value = page.values[propertyId] ?? null;
      // Filters, sorting, formulas and exports read formatted text as its plain words.
      if (property.type === 'text' && Array.isArray(value)) value = value.map(run => run.text).join('');
      cache.set(key, value); return value;
    } finally { evaluating.delete(key); }
  }
  return (pageId, propertyId) => {
    try { return readRaw(pageId, propertyId); }
    catch (error) { if (error instanceof WorkspaceError) return { error: { code: error.code, message: error.message } }; throw error; }
  };
}
