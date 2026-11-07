// Read back actual UI writes, then exercise remaining core flows only in the owned synthetic fixture.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const [origin,output]=process.argv.slice(2);assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)&&output);
const initial=await fetch(origin+'/api/state').then(r=>r.json());assert.equal(initial.objects.find(o=>o.id==='handoff-root')?.title,'기능 인계 검증 · 격리 합성 자료');
const client=new Client({name:'handoff-final-verifier',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/mcp.mjs')],env:{...process.env,LOCAL_WORKSPACE_URL:origin},stderr:'pipe'}));
const evidence={recordedAt:new Date().toISOString(),synthetic:true,origin,initialRevision:initial.revision,checks:[],calls:[]};let revision=initial.revision,seq=0;
const prefix=`handoff-final-${Date.now()}`;
const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args}),result={isError:response.isError??false,...response.structuredContent};evidence.calls.push({name,...(result.error?{error:result.error}:{}),revision:result.revision,commandId:result.commandId,replayed:result.replayed});assert.equal(result.isError,false,JSON.stringify(result.error));return result};
const apply=async operations=>{const result=await call('workspace_apply',{id:`${prefix}-${++seq}`,runId:prefix,expectedRevision:revision,operations});revision=result.revision;return result};
const get=async id=>(await call('workspace_get',{id})).entity;
const check=(name,fn)=>{fn();evidence.checks.push(name)};
try{
 evidence.tools=(await client.listTools()).tools.map(t=>t.name);assert.equal(evidence.tools.length,17);
 const o=new Map(initial.objects.map(o=>[o.id,o]));
 check('UI partial marks preserve original text',()=>assert.deepEqual(o.get('handoff-paragraph').richText,[{text:'원문 유지: 시작 텍스트',underline:true,color:'blue',background:'yellow'}]));
 check('UI table sequential saves and actual math expression',()=>{assert.equal(o.get('handoff-simple-table').cells[1][0][0].text,'표 원문 보존');assert.equal(o.get('handoff-simple-table').cells[1][1][0].text,'25');assert.equal(o.get('handoff-math').richText[0].text,'x^2 + y^2 = z^2')});
 check('HTML clipboard became nested blocks and a second table',()=>{assert.ok(initial.objects.some(b=>b.alive&&b.blockType==='heading2'&&b.richText?.some(r=>r.text==='붙여넣은 제목')));assert.ok(initial.objects.filter(b=>b.alive&&b.blockType==='table').length>=2);const child=initial.objects.find(b=>b.alive&&b.richText?.some(r=>r.text==='하위 항목'));assert.equal(o.get(child.parentId).blockType,'bullet')});
 check('UI favorite, default template, monthly recurrence persisted',()=>{assert.ok(initial.objects.some(x=>x.kind==='navigation'&&x.favorites.includes('handoff-table')));assert.equal(o.get('handoff-work').defaultTemplateId,'handoff-template');assert.equal(o.get('handoff-template').recurrence.frequency,'month');assert.equal(o.get('handoff-template').recurrence.start,'2030-01-31T09:00');const row=initial.objects.find(x=>x.title==='UI 기본 템플릿 생성');assert.ok(initial.objects.some(b=>b.parentId===row.id&&b.richText?.[0]?.text==='템플릿 원문'))});
 check('UI board, calendar resize, timeline undo/zoom, chart kind',()=>{assert.equal(o.get('handoff-a').values['handoff-status'],'open');assert.equal(o.get('handoff-a').values['handoff-date'].start,'2026-10-23');assert.equal(o.get('handoff-a').values['handoff-date'].end,'2026-10-26');assert.deepEqual(o.get('handoff-board').config.groupOrder.slice(0,2),['"done"','"open"']);assert.equal(o.get('handoff-timeline').config.timelineZoom,'hour');assert.equal(o.get('handoff-chart').config.chart.type,'donut')});
 check('UI CSV uses real typed zero and false; inbox read separate from body',()=>{const row=initial.objects.find(x=>x.title==='CSV, 합성');assert.equal(row.values['handoff-number'],0);assert.equal(row.values['handoff-done'],false);assert.ok(initial.objects.some(x=>x.kind==='notification'&&x.message==='UI 본문 알림 검증'&&x.read))});
 const originalButton=o.get('handoff-button').button;
 const configured=await apply([{type:'property.update',id:'handoff-button',button:{label:'실제 업무 갱신',confirmation:'합성 확인',actions:[{action:'set_property',propertyId:'handoff-number',value:0},{action:'set_property',propertyId:'handoff-status',value:'done'},{action:'notify',message:'별도 받은 알림'}]}}]);
 const executed=await apply([{type:'button.run',id:'handoff-button',pageId:'handoff-a',confirmed:true}]);assert.equal((await get('handoff-a')).values['handoff-number'],0);
 let undone=await call('workspace_undo',{id:`${prefix}-undo-button`,expectedRevision:revision,targetCommandId:executed.commandId});revision=undone.revision;assert.equal((await get('handoff-a')).values['handoff-number'],1000);
 undone=await call('workspace_undo',{id:`${prefix}-undo-config`,expectedRevision:revision,targetCommandId:configured.commandId});revision=undone.revision;assert.deepEqual((await get('handoff-button')).button,originalButton);evidence.checks.push('MCP configure and execute multi-action button; atomic undo restores original config and values');
 const tick=await apply([{type:'scheduler.tick',at:'2030-03-31T01:00:00Z'}]);assert.equal((await get('handoff-template')).recurrence.index,3);const afterTick=await fetch(origin+'/api/state').then(r=>r.json()),count=afterTick.objects.filter(x=>x.kind==='page'&&x.alive).length;
 await apply([{type:'scheduler.tick',at:'2030-03-31T01:00:00Z'}]);assert.equal((await fetch(origin+'/api/state').then(r=>r.json())).objects.filter(x=>x.kind==='page'&&x.alive).length,count);evidence.scheduler={commandId:tick.commandId,index:3,nextAt:(await get('handoff-template')).recurrence.nextAt};evidence.checks.push('UI recurrence rule executes Jan31/Feb28/Mar31 once each; separate ticks do not duplicate');
 const exported=await call('workspace_export',{id:'handoff-root',format:'bundle'}),preview=await call('workspace_import_preview',{format:'bundle',text:exported.text,title:'왕복 검증'});assert.equal((await call('workspace_status')).revision,revision);
 const imported=await apply(preview.operations),map=imported.copies[0].idMap;assert.deepEqual((await get(map['handoff-simple-table'])).cells,o.get('handoff-simple-table').cells);assert.equal((await get(map['handoff-work'])).defaultTemplateId,map['handoff-template']);assert.equal((await get(map['handoff-template'])).recurrence.enabled,false);assert.equal((await get(map['handoff-image'])).sha256,o.get('handoff-image').sha256);
 const a=await fetch(origin+'/api/attachments/handoff-image').then(r=>r.arrayBuffer()),b=await fetch(origin+'/api/attachments/'+map['handoff-image']).then(r=>r.arrayBuffer());assert.deepEqual(Buffer.from(a),Buffer.from(b));
 undone=await call('workspace_undo',{id:`${prefix}-undo-import`,expectedRevision:revision,targetCommandId:imported.commandId});revision=undone.revision;evidence.checks.push('MCP export -> side-effect-free preview -> real bundle import -> rich cells/default refs/blob bytes -> atomic undo');
 await call('workspace_run_log',{id:`${prefix}-log`,runId:prefix,message:'인계 검증 실행 설명은 업무 본문과 분리한다.',changedIds:['handoff-a']});assert.equal((await call('workspace_search',{query:'인계 검증 실행 설명은 업무 본문과 분리한다.'})).total,0);evidence.checks.push('agent explanation is absent from business search');
 evidence.finalRevision=revision;evidence.passed=true;
}catch(error){evidence.failure={message:error.message,stack:error.stack};throw error;}finally{await client.close();writeFileSync(output,JSON.stringify(evidence,null,2)+'\n')}
console.log(JSON.stringify({passed:evidence.passed,checks:evidence.checks.length,revision,output}));
