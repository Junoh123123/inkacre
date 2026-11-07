import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Workspace,canonical} from '../src/workspace.mjs';
import {occurrence} from '../src/automation.mjs';
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'pageyard-automation-'));let w=new Workspace(directory),i=0;
  const apply=operations=>w.execute({id:`auto-${++i}`,actor:'test',expectedRevision:w.revision,operations});
  const undo=result=>w.undo({id:`undo-${++i}`,actor:'test',expectedRevision:w.revision,targetCommandId:result.commandId});
  t.after(()=>{w.close();rmSync(directory,{recursive:true,force:true})});
  apply([{type:'page.create',id:'root',title:'합성 자동화'},{type:'source.create',id:'work',pageId:'root',name:'업무',titlePropertyId:'name'},
    {type:'property.create',id:'done',sourceId:'work',name:'완료',propertyType:'checkbox'},
    {type:'property.create',id:'due',sourceId:'work',name:'일정',propertyType:'date'},
    {type:'page.create',id:'a',sourceId:'work',title:'A'},{type:'page.create',id:'b',sourceId:'work',title:'B'},
    {type:'page.create',id:'template',sourceId:'work',title:'반복 원본',template:true},
    {type:'block.create',id:'original',parentId:'template',richText:[{text:'원문'}]}]);
  return {get w(){return w},apply,undo,reopen(){w.close();w=new Workspace(directory)}};
}
test('button confirmation, multi-action creation, replay and undo are one atomic command',t=>{
  const f=fixture(t);f.apply([{type:'property.create',id:'button',sourceId:'work',name:'완료 후 추가',propertyType:'button',button:{label:'실행',confirmation:'진행할까요?',actions:[
    {action:'set_property',propertyId:'done',value:true},{action:'add_page',sourceId:'work',title:'후속'},
    {action:'set_property',targetId:'$created',propertyId:'due',value:'$today'},{action:'notify',message:'실제 변경 완료'},{action:'open_page',targetId:'$created'}]}}]);
  const before=canonical(f.w.snapshot());assert.throws(()=>f.apply([{type:'button.run',id:'button',pageId:'a'}]),{code:'BUTTON_CONFIRMATION'});assert.equal(canonical(f.w.snapshot()),before);
  const cmd={id:'click',actor:'agent',expectedRevision:f.w.revision,operations:[{type:'button.run',id:'button',pageId:'a',confirmed:true}]},r=f.w.execute(cmd);
  assert.equal(f.w.get('a').entity.values.done,true);assert.equal(r.opens.length,1);assert.equal(f.w.get(r.opens[0]).entity.title,'후속');
  assert.equal(f.w.execute(cmd).replayed,true);assert.equal(f.w.search({query:'실제 변경 완료'}).total,0);
  f.undo(r);assert.equal(f.w.get('a').entity.values.done,undefined);assert.throws(()=>f.w.get(r.opens[0]),{code:'NOT_FOUND'});
});
test('button late failure rolls back earlier edits; filtered edits and block insertion preserve originals',t=>{
  const f=fixture(t);f.apply([{type:'block.create',id:'button',parentId:'root',blockType:'button',button:{label:'실행',actions:[{action:'set_property',targetId:'a',propertyId:'done',value:true},{action:'set_property',targetId:'b',propertyId:'due',value:'wrong'}]}}]);
  const before=canonical(f.w.snapshot());assert.throws(()=>f.apply([{type:'button.run',id:'button'}]),{code:'VALUE_TYPE'});assert.equal(canonical(f.w.snapshot()),before);
  f.apply([{type:'block.update',id:'button',button:{label:'생성',actions:[{action:'edit_pages',sourceId:'work',filter:{propertyId:'name',op:'eq',value:'B'},propertyId:'done',value:true},{action:'insert_blocks',position:'above',blocks:[{blockType:'heading2',richText:[{text:'새 본문'}]}]}]} }]);
  f.apply([{type:'button.run',id:'button'}]);assert.equal(f.w.get('b').entity.values.done,true);assert.equal(f.w.get('a').entity.values.done,undefined);assert.equal(f.w.get('root').entity.children.filter(c=>c.kind==='block')[0].blockType,'heading2');
});
test('default templates copy body independently and explicit null opts out',t=>{
  const f=fixture(t);f.apply([{type:'value.set',pageId:'template',propertyId:'done',value:true},{type:'source.configure_templates',id:'work',defaultTemplateId:'template'},{type:'page.create',id:'new',sourceId:'work',title:'새 업무'},{type:'page.create',id:'blank',sourceId:'work',title:'빈 업무',templateId:null}]);
  assert.equal(f.w.get('new').entity.values.done,true);assert.equal(f.w.get('new').entity.children[0].richText[0].text,'원문');assert.equal(f.w.get('blank').entity.children.length,0);
  f.apply([{type:'block.update',id:f.w.get('new').entity.children[0].id,richText:[{text:'독립 변경'}]}]);assert.equal(f.w.get('original').entity.richText[0].text,'원문');
});
test('monthly recurrence clamps from the anchor and ticks are durable, bounded, deduplicated and undoable',t=>{
  const f=fixture(t),rule={enabled:true,frequency:'month',interval:1,start:'2026-01-31T09:00',timeZone:'Asia/Tokyo'};
  assert.equal(occurrence(rule,1),'2026-02-28T00:00:00.000Z');assert.equal(occurrence(rule,2),'2026-03-31T00:00:00.000Z');
  f.apply([{type:'template.configure',id:'template',recurrence:rule}]);const r=f.w.tick('2026-03-31T01:00:00Z');
  assert.equal(f.w.query({sourceId:'work'}).total,5);assert.equal(f.w.tick('2026-03-31T01:00:00Z'),null);
  f.reopen();assert.equal(f.w.tick('2026-03-31T01:00:00Z'),null);const u=f.undo(r);assert.equal(f.w.query({sourceId:'work'}).total,2);f.undo(u);assert.equal(f.w.query({sourceId:'work'}).total,5);
  f.apply([{type:'page.duplicate',id:'root',newId:'copy'}]);const copied=f.w.snapshot().objects.find(o=>o.template&&o.id!=='template');assert.equal(copied.recurrence.enabled,false);
});
test('recurrence keeps local time across DST, clamps leap years and rejects invalid initial dates',()=>{
  const rule={enabled:true,frequency:'day',interval:1,start:'2026-03-07T02:30',timeZone:'America/New_York'};
  assert.equal(occurrence(rule,0),'2026-03-07T07:30:00.000Z');assert.equal(occurrence(rule,1),'2026-03-08T07:30:00.000Z');assert.equal(occurrence(rule,2),'2026-03-09T06:30:00.000Z');
  assert.equal(occurrence({...rule,frequency:'year',start:'2024-02-29T09:00',timeZone:'UTC'},1),'2025-02-28T09:00:00.000Z');
  assert.throws(()=>occurrence({...rule,start:'2026-02-30T09:00'},0),{code:'SCHEDULE_DATE'});
});
test('date-linked and inline reminders deliver once, follow edited dates, survive restart and stay out of body search',t=>{
  const f=fixture(t);f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-23',timeZone:'Asia/Tokyo'}},{type:'reminder.set',id:'rem',parentId:'a',datePropertyId:'due',offsetMinutes:30,message:'날짜 알림'},{type:'reminder.set',id:'inline',parentId:'original',at:'2026-10-23T00:00:00Z',message:'본문 별도 알림'}]);
  f.w.tick('2026-10-23T00:00:00Z');let notes=f.w.snapshot().objects.filter(o=>o.kind==='notification');assert.equal(notes.length,2);assert.equal(f.w.tick('2026-10-23T00:00:00Z'),null);
  f.reopen();assert.equal(f.w.tick('2026-10-23T00:00:00Z'),null);assert.equal(f.w.search({query:'본문 별도 알림'}).total,0);assert.equal(f.w.get('original').entity.richText[0].text,'원문');
  f.apply([{type:'notification.read',id:notes[0].id,read:true},{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-24',timeZone:'Asia/Tokyo'}}]);
  f.w.tick('2026-10-24T00:00:00Z');assert.equal(f.w.snapshot().objects.filter(o=>o.kind==='notification').length,3);
});

test('trashing a default template leaves new rows usable and undo restores the setting',t=>{
 const f=fixture(t);f.apply([{type:'source.configure_templates',id:'work',defaultTemplateId:'template'}]);const trashed=f.apply([{type:'node.trash',id:'template'}]);assert.equal(f.w.get('work').entity.defaultTemplateId,null);f.undo(trashed);assert.equal(f.w.get('work').entity.defaultTemplateId,'template');f.apply([{type:'node.trash',id:'template'},{type:'page.create',id:'blank-after-trash',sourceId:'work',title:'빈 항목'}]);assert.equal(f.w.get('blank-after-trash').entity.children.length,0);
});
