import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/workspace.mjs';

// Fields and block types added 2026-10-24: audio and breadcrumb blocks,
// a button's icon, and a view's "advanced filter" mode. All are additive and undo like the rest.
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'pageyard-additions-'));const w=new Workspace(directory);let i=0;
  const apply=operations=>w.execute({id:`add-${++i}`,actor:'test',expectedRevision:w.revision,operations});
  const undo=result=>w.undo({id:`undo-${++i}`,actor:'test',expectedRevision:w.revision,targetCommandId:result.commandId});
  t.after(()=>{w.close();rmSync(directory,{recursive:true,force:true})});
  apply([{type:'page.create',id:'root',title:'추가 기능'}]);
  return {w,apply,undo};
}

test('audio and breadcrumb blocks are created, checked and undone',t=>{
  const f=fixture(t);
  const r=f.apply([{type:'block.create',id:'crumb',parentId:'root',blockType:'breadcrumb'}]);
  assert.equal(f.w.get('crumb').entity.blockType,'breadcrumb');
  f.undo(r);
  assert.throws(()=>f.w.get('crumb'),{code:'NOT_FOUND'});
  f.apply([{type:'block.create',id:'sound',parentId:'root',blockType:'audio'}]);
  assert.equal(f.w.get('sound').entity.blockType,'audio');
  const blob=f.w.putBlob(Buffer.from('not really an image'));
  f.apply([{type:'attachment.register',id:'clip',name:'clip.mp3',mediaType:'audio/mpeg',...blob}]);
  f.apply([{type:'block.update',id:'sound',attachmentId:'clip'}]);
  assert.equal(f.w.get('sound').entity.attachmentId,'clip');
  f.apply([{type:'attachment.register',id:'pic',name:'a.txt',mediaType:'text/plain',...f.w.putBlob(Buffer.from('x'))}]);
  assert.throws(()=>f.apply([{type:'block.update',id:'sound',attachmentId:'pic'}]),{code:'AUDIO_MEDIA_TYPE'});
});

test('a button keeps its icon and a view its advanced filter mode',t=>{
  const f=fixture(t);
  f.apply([{type:'block.create',id:'btn',parentId:'root',blockType:'button',button:{label:'할 일 만들기',icon:'✅',actions:[]}}]);
  assert.equal(f.w.get('btn').entity.button.icon,'✅');
  f.apply([{type:'source.create',id:'db',pageId:'root',name:'목록',titlePropertyId:'name'},{type:'view.create',id:'v',sourceId:'db',parentId:'root',name:'표',viewType:'table',config:{}}]);
  const r=f.apply([{type:'view.update',id:'v',config:{filter:{all:[{propertyId:'name',op:'contains',value:'a'}]},advancedFilter:true}}]);
  assert.equal(f.w.get('v').entity.config.advancedFilter,true);
  f.undo(r);
  assert.equal(f.w.get('v').entity.config.advancedFilter,undefined);
});

test('a filter rule without a value hides nothing until a value is chosen',t=>{
  const f=fixture(t);
  f.apply([{type:'source.create',id:'db',pageId:'root',name:'목록',titlePropertyId:'name'},
    {type:'property.create',id:'state',sourceId:'db',name:'상태',propertyType:'select',options:[{id:'open',name:'진행'},{id:'done',name:'완료'}]},
    {type:'page.create',id:'a',sourceId:'db',title:'A'},{type:'page.create',id:'b',sourceId:'db',title:'B'},
    {type:'value.set',pageId:'a',propertyId:'state',value:'open'},
    {type:'view.create',id:'v',sourceId:'db',parentId:'root',name:'표',viewType:'table',config:{filter:{all:[{propertyId:'state',op:'eq'},{propertyId:'name',op:'contains',value:''}]}}}]);
  assert.equal(f.w.query({viewId:'v'}).rows.length,2);
  f.apply([{type:'view.update',id:'v',config:{filter:{all:[{propertyId:'state',op:'eq',value:'open'}]}}}]);
  assert.deepEqual(f.w.query({viewId:'v'}).rows.map(row=>row.id),['a']);
  f.apply([{type:'view.update',id:'v',config:{filter:{all:[{propertyId:'state',op:'empty'}]}}}]);
  assert.deepEqual(f.w.query({viewId:'v'}).rows.map(row=>row.id),['b']);
});

test('text filters can match the start or end, and option filters can exclude several',t=>{
  const f=fixture(t);
  f.apply([{type:'source.create',id:'db',pageId:'root',name:'목록',titlePropertyId:'name'},
    {type:'property.create',id:'state',sourceId:'db',name:'상태',propertyType:'select',options:[{id:'open',name:'진행'},{id:'done',name:'완료'},{id:'hold',name:'보류'}]},
    {type:'page.create',id:'a',sourceId:'db',title:'Alpha task'},{type:'page.create',id:'b',sourceId:'db',title:'Beta plan'},{type:'page.create',id:'c',sourceId:'db',title:'Gamma task'},
    {type:'value.set',pageId:'a',propertyId:'state',value:'open'},{type:'value.set',pageId:'b',propertyId:'state',value:'done'},{type:'value.set',pageId:'c',propertyId:'state',value:'hold'},
    {type:'view.create',id:'v',sourceId:'db',parentId:'root',name:'표',viewType:'table',config:{filter:{propertyId:'name',op:'starts_with',value:'alp'}}}]);
  const ids=()=>f.w.query({viewId:'v'}).rows.map(row=>row.id).sort();
  assert.deepEqual(ids(),['a']);
  f.apply([{type:'view.update',id:'v',config:{filter:{propertyId:'name',op:'ends_with',value:'TASK'}}}]);
  assert.deepEqual(ids(),['a','c']);
  f.apply([{type:'view.update',id:'v',config:{filter:{propertyId:'state',op:'not_in',value:['open','hold']}}}]);
  assert.deepEqual(ids(),['b']);
});

test('chart groups follow option order, sort by value, stack, hide and total (2026-10-24 chart options)',t=>{
  const f=fixture(t);
  f.apply([{type:'source.create',id:'db',pageId:'root',name:'목록',titlePropertyId:'name'},
    {type:'property.create',id:'state',sourceId:'db',name:'상태',propertyType:'select',options:[{id:'todo',name:'할 일'},{id:'doing',name:'진행'},{id:'done',name:'완료'}]},
    {type:'property.create',id:'size',sourceId:'db',name:'크기',propertyType:'select',options:[{id:'s',name:'작음'},{id:'l',name:'큼'}]},
    {type:'property.create',id:'amount',sourceId:'db',name:'금액',propertyType:'number'},
    ...[['a','done','s',5],['b','doing','l',7],['c','doing','s',1],['d',null,'l',2]].flatMap(([id,state,size,amount])=>[{type:'page.create',id,sourceId:'db',title:id},...(state?[{type:'value.set',pageId:id,propertyId:'state',value:state}]:[]),{type:'value.set',pageId:id,propertyId:'size',value:size},{type:'value.set',pageId:id,propertyId:'amount',value:amount}]),
    {type:'view.create',id:'v',sourceId:'db',parentId:'root',name:'차트',viewType:'chart',config:{chart:{groupBy:'state',aggregation:'count',type:'bar'}}}]);
  const bars=()=>f.w.query({viewId:'v'}).presentation.bars;
  assert.deepEqual(bars().map(bar=>[bar.group,bar.value]),[[null,1],['doing',2],['done',1]]);
  f.apply([{type:'view.update',id:'v',config:{chart:{groupBy:'state',aggregation:'sum',valuePropertyId:'amount',type:'bar',sort:'valueDesc',stackBy:'size',hiddenGroups:['null']}}}]);
  const sorted=bars();
  assert.deepEqual(sorted.map(bar=>[bar.group,bar.value,bar.hidden]),[['doing',8,false],['done',5,false],[null,2,true]]);
  assert.deepEqual(sorted[0].stacks.map(stack=>[stack.group,stack.value]),[['s',1],['l',7]]);
  assert.equal(f.w.query({viewId:'v'}).presentation.total,15);
  f.apply([{type:'view.update',id:'v',config:{chart:{groupBy:'state',aggregation:'count_nonempty',valuePropertyId:'state',type:'number'}}}]);
  assert.equal(f.w.query({viewId:'v'}).presentation.total,3);
  assert.throws(()=>f.apply([{type:'view.update',id:'v',config:{chart:{groupBy:'state',aggregation:'count',type:'pie'}}}]));
});

test('a page keeps emoji reactions and a form view its questions',t=>{
  const f=fixture(t);
  const r=f.apply([{type:'page.update',id:'root',reactions:['👍','🎉']}]);
  assert.deepEqual(f.w.get('root').entity.reactions,['👍','🎉']);
  assert.throws(()=>f.apply([{type:'page.update',id:'root',reactions:['👍','👍']}]),{code:'REACTION_DUPLICATE'});
  f.undo(r);
  assert.equal(f.w.get('root').entity.reactions,undefined);
  f.apply([{type:'source.create',id:'db',pageId:'root',name:'목록',titlePropertyId:'name'},{type:'view.create',id:'form',sourceId:'db',parentId:'root',name:'양식',viewType:'form',config:{form:{title:'신청',description:'',questions:[{propertyId:'name',title:'이름을 적어 주세요',required:true}]}}}]);
  assert.equal(f.w.get('form').entity.config.form.questions[0].required,true);
  f.apply([{type:'view.update',id:'form',config:{showPageIcon:false,showAuthor:false,wrapProperties:true,loadLimit:25}}]);
  assert.equal(f.w.get('form').entity.config.loadLimit,25);
});

test('a chart axis can bucket status by group and dates by month, and add up cumulatively',t=>{
  const f=fixture(t);
  f.apply([{type:'source.create',id:'db',pageId:'root',name:'목록',titlePropertyId:'name'},
    {type:'property.create',id:'state',sourceId:'db',name:'상태',propertyType:'status',options:[{id:'s1',name:'시작 전',group:'할 일'},{id:'s2',name:'검토',group:'진행 중'},{id:'s3',name:'작업',group:'진행 중'},{id:'s4',name:'끝',group:'완료'}]},
    {type:'property.create',id:'day',sourceId:'db',name:'날짜',propertyType:'date'},
    ...[['a','s2','2026-01-05'],['b','s3','2026-01-20'],['c','s4','2026-03-02'],['d','s1','2026-03-31']].flatMap(([id,state,day])=>[{type:'page.create',id,sourceId:'db',title:id},{type:'value.set',pageId:id,propertyId:'state',value:state},{type:'value.set',pageId:id,propertyId:'day',value:{start:day}}]),
    {type:'view.create',id:'v',sourceId:'db',parentId:'root',name:'차트',viewType:'chart',config:{chart:{groupBy:'state',aggregation:'count',type:'bar',statusGrouping:'group'}}}]);
  const bars=()=>f.w.query({viewId:'v'}).presentation.bars;
  assert.deepEqual(bars().map(bar=>[bar.group,bar.value]),[['todo',1],['in_progress',2],['complete',1]]);
  const doing=bars()[1].drilldown;
  assert.deepEqual(f.w.query({sourceId:'db',filter:doing}).rows.map(row=>row.id).sort(),['a','b']);
  f.apply([{type:'view.update',id:'v',config:{chart:{groupBy:'day',aggregation:'count',type:'line',dateGrouping:'month',cumulative:true}}}]);
  assert.deepEqual(bars().map(bar=>[bar.group,bar.value]),[['2026-01',2],['2026-03',4]]);
  assert.deepEqual(f.w.query({sourceId:'db',filter:bars()[1].drilldown}).rows.map(row=>row.id).sort(),['c','d']);
});
