// Read-only MCP verification of direct edits made in the browser UI.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pageId = 'e09b9711-43d1-4147-bcfd-8283200a9179', textId = '7403bb69-eca5-4a96-aeab-0a9f20e75a95', bookmarkId = 'e1372af6-e948-466a-9f0b-374e0e0ac738';
const client = new Client({ name: 'direct-editor-reader', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'], env: { ...process.env, LOCAL_WORKSPACE_URL: process.env.LOCAL_WORKSPACE_URL ?? 'http://127.0.0.1:4141' }, stderr: 'pipe' }));
try {
  const call = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError); return result.structuredContent; };
  const get = async id => (await call('workspace_get', { id })).entity, status = await call('workspace_status');
  const body = await get(textId), bookmark = await get(bookmarkId);
  const marked = body.richText.find(run => run.text === 'DIRECT7381'); assert.equal(marked.bold, true); assert.equal(marked.italic, true);
  assert.equal(body.richText.find(run => run.text === '링크').href, 'https://example.com/direct');
  assert.equal(body.richText.find(run => run.text === '대상').pageId, 'lab-a2');
  assert.ok(body.richText.map(run => run.text).join('').endsWith('AGENT7381'));
  assert.ok((await get('lab-a2')).backlinks.some(item => item.id === pageId));
  assert.equal(bookmark.url, 'https://example.com/bookmark');
  const at = async revision => (await call('workspace_page_version', { pageId, revision })).blocks;
  const revisions = [];
  for (const revision of [39, 40, 41, 45, 46, 47, 48, 49, 50, 51, 52, 57, 58, 59, 60, 61, 62]) {
    const blocks = await at(revision), richText = blocks.find(block => block.id === textId).richText, url = blocks.find(block => block.id === bookmarkId)?.url;
    revisions.push({ revision, text: richText.map(run => run.text).join(''), mention: richText.some(run => run.pageId === 'lab-a2'), italic: !!richText.find(run => run.text === 'DIRECT7381')?.italic, strike: !!richText.find(run => run.text === 'DIRECT7381')?.strike, url });
  }
  assert.equal(revisions.find(row => row.revision === 40).mention, false); assert.equal(revisions.find(row => row.revision === 41).mention, true);
  assert.equal(revisions.find(row => row.revision === 45).url, 'https://example.com/agent');
  assert.equal(revisions.find(row => row.revision === 46).url, 'https://example.com/user-draft');
  assert.equal(revisions.find(row => row.revision === 47).url, 'https://example.com/agent');
  assert.ok(revisions.find(row => row.revision === 49).text.endsWith('AGENT7381'));
  assert.equal(revisions.find(row => row.revision === 50).italic, true); assert.equal(revisions.find(row => row.revision === 50).text.endsWith('AGENT7381'), false);
  assert.ok(revisions.find(row => row.revision === 51).text.endsWith('AGENT7381')); assert.equal(revisions.find(row => row.revision === 51).italic, false);
  assert.equal(revisions.find(row => row.revision === 57).strike, true); assert.equal(revisions.find(row => row.revision === 58).strike, false);
  assert.equal(revisions.find(row => row.revision === 59).url, 'https://example.com/same-user');
  assert.equal(revisions.find(row => row.revision === 60).url, 'https://example.com/bookmark');
  assert.equal(revisions.find(row => row.revision === 61).url, 'https://example.com/agent-protected');
  assert.equal(revisions.find(row => row.revision === 62).url, 'https://example.com/bookmark');
  assert.deepEqual((await get('lab-body')).richText, [{ text: '확인한 동작을 로컬 데이터로 검증합니다. ' }, { text: '이 문단은 합성 자료입니다.', bold: true }]);
  assert.equal((await call('workspace_status')).revision, status.revision);
  const report = { recordedAt: new Date().toISOString(), revision: status.revision, pageId, textId, bookmarkId, richText: body.richText, bookmarkUrl: bookmark.url, historicalReadback: revisions,
    browserEvidence: { source: 'browser checks of the running app', partialBoldLinkMentionSaved: true, mentionUnlinkUndoMatched: true, bookmarkStaleWriteRejected: true, richTextStaleWriteRejected: true, draftSurvivedReload: true, explicitCompareReapplyUndoMatched: true, sameUserSequentialEditSucceededAfterFix: true, postFixAgentConflictStillRejected: true },
    restartReadbackMatched: true, originalLabBodyUnchanged: true, modifiedByVerifier: false, browserUploadTested: false, physicalImeTested: false, screenshot: 'verification/screenshots/local-editor-conflict-2026-10-21.jpg' };
  writeFileSync('verification/ui-direct-editor.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ revision: report.revision, pageId, historicalRevisionsChecked: revisions.length, marked, mentionTarget: 'lab-a2', bookmarkUrl: bookmark.url, modifiedByVerifier: false }));
} finally { await client.close(); }
