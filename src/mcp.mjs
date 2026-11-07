import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { id, operationSchema, filterSchema, attachmentReferenceSchema, propertyConversionSchema, runLogSchema, runPageSchema, importSchema, searchSchema, tasksSchema } from './contracts.mjs';
import { APP } from './app-info.mjs';

export function createWorkspaceMcp(baseUrl = process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141') {
  let origin = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('MCP can only connect to the local workspace service.');
  const server = new McpServer({ name: APP.id, title: APP.name, version: '0.1.0' }, {
    instructions: 'A personal, local workspace app (pages, blocks and databases). First read real IDs and the latest revision with workspace_status/get/query. Change items, relations and views with workspace_apply, giving a unique id, the expectedRevision and the operations. Record notes about your work only with workspace_run_log; do not add plans or explanations to pages unless the user asked for that content. On a revision conflict, compare the latest state with your input and apply a new command; if a result is unclear, retry with the same id and content to confirm it. Never overwrite formula or rollup results; change their inputs or definitions. Read the result back and report where things changed and the undo handle. SERVICE_UNAVAILABLE means the app must be started with ./app-local server in this project.',
  });
  async function call(route, body) {
    const response = await fetch(new URL(route, origin), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error.message); error.data = data; throw error; }
    return data;
  }
  function tool(name, description, inputSchema, action, readOnly = false) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false } }, async input => {
      try {
        const result = await action(input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const result = error.data ?? { error: { code: 'SERVICE_UNAVAILABLE', message: 'Start the local app service and check the connection.', details: {} } };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true };
      }
    });
  }
  // Several workspaces on this computer: list them, then point this session at one (each has its own address).
  tool('workspace_list', 'Lists the workspaces on this computer (each its own data) with their names and which one this session uses. Switch with workspace_use.', {}, async () => {
    const data = await call('/api/workspaces');
    return { workspaces: data.workspaces.map(item => ({ ...item, current: new URL(item.url ?? 'http://0').port === origin.port })) };
  }, true);
  tool('workspace_use', 'Makes the following tool calls of this session read and write another workspace on this computer (an id from workspace_list).', { workspaceId: z.string().min(1) }, async ({ workspaceId }) => {
    const data = await call('/api/workspaces');
    const target = data.workspaces.find(item => item.id === workspaceId);
    if (!target?.url) { const error = new Error('Unknown workspace'); error.data = { error: { code: 'WORKSPACE_TARGET', message: 'Choose a workspace from workspace_list.', details: {} } }; throw error; }
    const next = new URL(target.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(next.hostname) || next.protocol !== 'http:') throw new Error('MCP can only connect to a local workspace.');
    origin = next;
    return { workspaceId, name: target.name, url: target.url };
  });
  tool('workspace_status', 'Reads the current revision and the IDs of pages, data sources, properties and views. Check the latest revision and the items you need before writing.', {}, async () => {
    const state = await call('/api/state');
    return { revision: state.revision, objects: state.objects.filter(object => ['page', 'source', 'property', 'view', 'reminder', 'notification', 'delivery','navigation'].includes(object.kind)).map(({ id, kind, title, name, sourceId, parentId, alive, version, type, read, at }) => ({ id, kind, title, name, sourceId, parentId, alive, version, type, read, at })) };
  }, true);
  tool('workspace_get', 'Reads an item with its children, stored property values and computed results. source.tasks holds the sub-item/dependency settings; a database row\'s task lists its parent, sub-items, predecessors and successors.', { id }, ({ id }) => call(`/api/objects/${encodeURIComponent(id)}`), true);
  tool('workspace_command_schema', 'Reads the exact JSON schema of the page, block, property, relation, view and template commands, and the recovery rules.', {}, () => call('/api/schema'), true);
  tool('workspace_preview_property_conversion', 'Previews how changing a property\'s type (keeping its ID) affects every row, calculation and view. If allowed, run workspace_apply with the returned operation and revision. The preview saves nothing.', propertyConversionSchema.shape, input => call('/api/property-conversion/preview', input), true);
  tool('workspace_query', 'Queries a saved view or a data source. An extra filter and search are combined (AND) with the saved filter. contextOnly rows in nested sub-items are parents shown for structure and are not counted in the matching total.', { sourceId: id.optional(), viewId: id.optional(), filter: filterSchema.optional(), search: z.string().optional(), limit: z.number().int().positive().max(500).optional(), offset: z.number().int().nonnegative().optional() }, input => call('/api/query', input), true);
  tool('workspace_search', 'Searches page titles, content and property values — and the text of files attached to a page (PDF, Word, Excel, PowerPoint, HWPX, OpenDocument, text), listed per result in files[] with the file and a line of it: every word must appear; "quoted text" matches that exact phrase. Filters: withinIds (those pages and everything under them), a created or edited date range (from/to as YYYY-MM-DD), archived pages (excluded by default). Sort by best match or by edited/created time. With filters the query may be empty. Run logs are not included in search.', searchSchema.shape, input => call('/api/search', input), true);
  tool('workspace_capture', 'Quick capture: appends lines (as text, to-dos or bullets) to a page given by id or exact title — or, without "to", to the workspace\'s capture page — or adds a row to a database given by id or name, with property values by property name (converted like a CSV import). One call, no revision needed; it lands as its own command in the change history.', { text: z.string().max(20000).optional(), to: z.string().max(500).optional(), as: z.enum(['text', 'todo', 'bullet']).optional(), database: z.string().max(500).optional(), title: z.string().max(2000).optional(), properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() }, input => call('/api/capture', { ...input, text: input.text ?? '', source: 'mcp' }));
  tool('workspace_tasks', 'Lists the rows of the task databases (a status property, or sub-item/dependency setup) by due date: status with its group (todo, in_progress, complete), due date, assignees and the database. Done tasks are left out unless includeDone.', tasksSchema.shape, input => call('/api/tasks', input), true);
  tool('workspace_apply', 'Changes data in one atomic batch. Give the run\'s runId to see the saved commands in its run log. Retrying with the same id and content does not apply twice. On a revision conflict, read the latest state again. Formula results cannot be written. Keep notes about your work in workspace_run_log, not in pages.', { id, expectedRevision: z.number().int().nonnegative(), operations: z.array(operationSchema).min(1).max(500), runId: id.optional() }, input => call('/api/commands', { ...input, actor: 'agent' }));
  tool('workspace_undo', 'Undoes a command\'s changes; refused if later edits conflict. Undoing that undo command redoes the change.', { id, expectedRevision: z.number().int().nonnegative(), targetCommandId: id }, input => call('/api/undo', { ...input, actor: 'agent' }));
  tool('workspace_history', 'Reads changes: IDs, fields, revisions and undo handles. With pageId, only changes to that page and its blocks; with sourceId, changes to that database\'s rows, their content and its properties (restore one with source.restore_version).', { limit: z.number().int().positive().max(200).optional(), pageId: id.optional(), sourceId: id.optional() }, ({ limit, pageId, sourceId }) => call(`/api/history?limit=${limit ?? 50}${pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''}${sourceId ? `&sourceId=${encodeURIComponent(sourceId)}` : ''}`), true);
  tool('workspace_page_version', 'Reads a page\'s title, properties and blocks at an earlier revision. After comparing with the current state you can restore it with the page.restore_version command. Data sources, schema, parent and comments are not part of a restore.', { pageId: id, revision: z.number().int().nonnegative() }, ({ pageId, revision }) => call(`/api/versions/${encodeURIComponent(pageId)}?revision=${revision}`), true);
  tool('workspace_run_log', 'Stores notes about your work separately from the workspace data. With an id, retrying the same content returns the original record and different content is refused. Link the actual changes through workspace_apply\'s runId. Changes no pages or blocks.', runLogSchema.shape, input => call('/api/runs', input));
  tool('workspace_run_list', 'Lists agent runs, separating note-only records from the number of saved commands linked by runId; undo and redo are linked to their original run.', runPageSchema.shape, input => call(`/api/runs?${new URLSearchParams(input)}`), true);
  tool('workspace_run_read', 'Reads a run\'s notes and its saved commands, changed items and undo handles. Commands come newest first; if hasMore, read the next batch with a larger offset. Do not infer what was saved from the notes alone.', { runId: id, ...runPageSchema.shape }, ({ runId, ...page }) => call(`/api/runs/${encodeURIComponent(runId)}?${new URLSearchParams(page)}`), true);
  tool('workspace_attachment_put', 'Stores the given bytes as a local blob. reference is one of: a files property {pageId,propertyId,attachmentIds}, a new block {parentId,blockId,blockType,beforeId?}, or replacing existing media {blockId}; the upload and the reference are saved in one command. Without it, reference the returned attachmentId in a separate command. Never reads arbitrary local paths.', { commandId: id, expectedRevision: z.number().int().nonnegative(), name: z.string().min(1), mediaType: z.string(), base64: z.string(),
    reference: attachmentReferenceSchema.optional() }, input => call('/api/attachments', { ...input, actor: 'agent' }));
  tool('workspace_export', 'Exports a page or database as Markdown, CSV, HTML, ZIP, or a local JSON bundle that keeps relations, formatting and attachment bytes. Check the loss warnings of the plain-text formats.', {id,format:z.enum(['markdown','csv','html','zip','bundle'])}, input=>call('/api/export',input),true);
  tool('workspace_import_preview', 'Reads CSV, Markdown or a local JSON bundle and previews the operations to apply, with the revision and the list of changes. Saves nothing; after checking, run the returned operations with workspace_apply.',importSchema.shape,input=>call('/api/import/preview',input),true);
  tool('workspace_backup', 'Makes a consistent SQLite copy plus attachment bytes and a hash manifest in the local backups folder.', {}, () => call('/api/backups', {}));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createWorkspaceMcp().connect(new StdioServerTransport());
}
