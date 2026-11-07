// Checks a migrated workspace folder against the current engine and contracts without
// touching it: every page/view is read and queried, every page exported, and every block /
// view is re-saved the way the UI saves it — on a throwaway clone of the folder. The report
// holds counts, error codes and object IDs only (no titles or text).
//
//   node scripts/verify-live-copy.mjs --data data-live --output verification/migration-2026-10-24
import { parseArgs } from 'node:util';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from '../src/workspace.mjs';
import { operationSchema, viewConfig } from '../src/contracts.mjs';

const { values } = parseArgs({ options: { data: { type: 'string' }, output: { type: 'string' } } });
if (!values.data || !values.output) throw new Error('사용법: node scripts/verify-live-copy.mjs --data 폴더 --output 보고서폴더');
const data = path.resolve(values.data), output = path.resolve(values.output);
const failures = [];
const fail = (stage, id, error) => failures.push({ stage, id, code: error?.code ?? error?.issues?.[0]?.code ?? error?.name ?? 'ERROR', path: error?.issues?.[0]?.path?.join('.') });
const tally = list => list.reduce((acc, item) => { acc[item] = (acc[item] ?? 0) + 1; return acc; }, {});

// Read-only pass on a clone so even SQLite housekeeping never touches the folder itself.
const clone = mkdtempSync(path.join(tmpdir(), 'pageyard-live-verify-'));
try {
  copyFileSync(path.join(data, 'workspace.sqlite'), path.join(clone, 'workspace.sqlite'));
  mkdirSync(path.join(clone, 'blobs'));
  if (existsSync(path.join(data, 'blobs'))) for (const name of readdirSync(path.join(data, 'blobs'))) copyFileSync(path.join(data, 'blobs', name), path.join(clone, 'blobs', name));
  const raw = new DatabaseSync(path.join(clone, 'workspace.sqlite'), { readOnly: true });
  const integrity = Object.values(raw.prepare('PRAGMA integrity_check').get())[0];
  const commands = raw.prepare('SELECT COUNT(*) AS n, MAX(revision) AS max FROM commands').get();
  raw.close();

  const workspace = new Workspace(clone);
  const { revision, objects } = workspace.snapshot();
  const alive = objects.filter(item => item.alive);
  const kinds = tally(alive.map(item => item.kind));
  const trashed = tally(objects.filter(item => !item.alive).map(item => item.kind));
  const pages = alive.filter(item => item.kind === 'page');
  const views = alive.filter(item => item.kind === 'view');
  const blocks = alive.filter(item => item.kind === 'block');

  for (const page of pages) { try { workspace.get(page.id); } catch (error) { fail('page.get', page.id, error); } }
  for (const view of views) {
    try { workspace.query({ viewId: view.id, limit: 500 }); } catch (error) { fail('view.query', view.id, error); }
    const parsed = viewConfig.safeParse(view.config ?? {});
    if (!parsed.success) fail('view.config-schema', view.id, parsed.error);
  }
  for (const page of pages.filter(item => !item.sourceId)) { try { workspace.export({ id: page.id, format: 'markdown' }); } catch (error) { fail('page.export', page.id, error); } }

  // Re-save as the UI does (block text/fields unchanged, a view setting toggled) — on the clone.
  let sequence = 0;
  const save = (stage, id, operations) => {
    for (const operation of operations) { const parsed = operationSchema.safeParse(operation); if (!parsed.success) { fail(`${stage}-schema`, id, parsed.error); return; } }
    try { workspace.execute({ id: `verify-${++sequence}`, actor: 'live-copy-verifier', expectedRevision: workspace.revision, operations }); }
    catch (error) { fail(stage, id, error); }
  };
  // Synced references are read-only views of their source block; the UI never updates them.
  for (const block of blocks.filter(item => item.blockType !== 'synced_reference')) {
    const operation = { type: 'block.update', id: block.id, ...(block.richText ? { richText: block.richText } : {}) };
    for (const key of ['icon', 'color', 'toggleable', 'ratio', 'cells', 'tableHeader', 'columnWidths', 'rowColors', 'columnColors']) if (block[key] !== undefined) operation[key] = block[key];
    if (block.blockType === 'columns' || block.blockType === 'column') delete operation.richText;
    save('block.resave', block.id, [operation]);
  }
  for (const view of views) save('view.resave', view.id, [{ type: 'view.update', id: view.id, config: { hideEmptyGroups: !!view.config?.hideEmptyGroups } }]);
  workspace.close();

  const scheduler = {
    deliveriesQueued: alive.filter(item => item.kind === 'delivery' && ['queued', 'sending', 'unknown'].includes(item.status)).length,
    reminders: alive.filter(item => item.kind === 'reminder').length,
    recurringTemplates: alive.filter(item => item.kind === 'page' && item.recurrence?.enabled).length,
  };
  const report = {
    checkedAt: new Date().toISOString(), scope: 'migrated copy: integrity, reads, queries, exports and UI-style re-saves on a throwaway clone; no titles or text recorded',
    integrity, revision, commands: commands.n, lastCommandRevision: commands.max, aliveByKind: kinds, trashedByKind: trashed, attachments: kinds.attachment ?? 0, scheduler,
    checks: { pagesRead: pages.length, viewsQueried: views.length, pagesExported: pages.filter(item => !item.sourceId).length, blocksResaved: blocks.filter(item => item.blockType !== 'synced_reference').length, viewsResaved: views.length },
    failures: failures.length, failuresByStage: tally(failures.map(item => `${item.stage}:${item.code}`)), failureDetails: failures.slice(0, 200),
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'live-copy-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ integrity, revision, aliveByKind: kinds, checks: report.checks, scheduler, failures: report.failures, failuresByStage: report.failuresByStage }, null, 2));
} finally {
  rmSync(clone, { recursive: true, force: true });
}
