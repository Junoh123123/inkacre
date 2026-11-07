// Real SDK exercise restricted to the disposable handoff fixture.
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import path from 'node:path';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const [origin,output]=process.argv.slice(2);assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)&&output);
const initial=await fetch(origin+'/api/state').then(r=>r.json());assert.equal(initial.objects.find(o=>o.id==='handoff-root')?.title,'기능 인계 검증 · 격리 합성 자료');
const client=new Client({name:'handoff-functional-verifier',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/mcp.mjs')],env:{...process.env,LOCAL_WORKSPACE_URL:origin},stderr:'pipe'}));
const evidence={recordedAt:new Date().toISOString(),synthetic:true,origin,initialRevision:initial.revision,calls:[]},prefix=`handoff-${randomUUID()}`;
const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args}),result={isError:response.isError??false,...response.structuredContent};evidence.calls.push({name,args,result});return result};
try{
 evidence.tools=(await client.listTools()).tools.map(t=>t.name);assert.equal(evidence.tools.length,17);
 const schema=await call('workspace_command_schema');assert.equal(schema.isError,false);assert.match(JSON.stringify(schema),/content.import_bundle/);
 const command={id:`${prefix}-button`,runId:'handoff-agent-run',expectedRevision:initial.revision,operations:[{type:'button.run',id:'handoff-button',pageId:'handoff-a',confirmed:true}]},changed=await call('workspace_apply',command);assert.equal(changed.isError,false);assert.equal((await call('workspace_apply',command)).replayed,true);assert.equal((await call('workspace_get',{id:'handoff-a'})).entity.values['handoff-done'],true);
 assert.equal((await call('workspace_apply',{...command,id:`${prefix}-stale`})).error.code,'REVISION_CONFLICT');evidence.undoHandle=changed.commandId;
 const exported=await call('workspace_export',{id:'handoff-root',format:'bundle'});assert.equal(exported.isError,false);
 const preview=await call('workspace_import_preview',{format:'bundle',text:exported.text,title:'같은 구조 미리보기'});assert.equal(preview.isError,false);assert.ok(preview.changes.length>10);assert.equal((await call('workspace_status')).revision,changed.revision);
 const tick=await call('workspace_apply',{id:`${prefix}-tick`,expectedRevision:changed.revision,operations:[{type:'scheduler.tick',at:'2030-01-01T00:00:00Z'}]});assert.equal(tick.isError,false);evidence.tickCommand=tick.commandId;
 const body=(await call('workspace_get',{id:'handoff-paragraph'})).entity;assert.equal(body.richText.map(r=>r.text).join(''),'원문 유지: 시작 텍스트');assert.equal(body.richText[0].underline,true);assert.equal(body.richText[0].color,'blue');assert.equal(body.richText[0].background,'yellow');
 const table=(await call('workspace_get',{id:'handoff-simple-table'})).entity;assert.equal(table.cells[1][1][0].text,'25');assert.equal(table.cells[1][0][0].text,'표 원문 보존');
 await call('workspace_run_log',{id:`${prefix}-log`,runId:'handoff-agent-run',message:'합성 버튼과 실제 알림을 검증했습니다. 처리 설명은 별도 실행 기록입니다.',changedIds:['handoff-a']});assert.equal((await call('workspace_search',{query:'처리 설명은 별도 실행 기록입니다'})).total,0);
 const final=await fetch(origin+'/api/state').then(r=>r.json());evidence.finalRevision=final.revision;evidence.notifications=final.objects.filter(o=>o.kind==='notification').map(({id,parentId,message,read})=>({id,parentId,message,read}));evidence.passed=true;
}finally{await client.close();writeFileSync(output,JSON.stringify(evidence,null,2)+'\n')}
console.log(JSON.stringify({passed:evidence.passed,revision:evidence.finalRevision,notifications:evidence.notifications?.length,tools:evidence.tools?.length,output}));
