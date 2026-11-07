import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {Workspace,canonical} from '../src/workspace.mjs';import {aggregate} from '../src/aggregation.mjs';import {relativeDateRange,matchesRelative} from '../src/relative-date.mjs';import {compileFormula,evaluateFormula,formatFormula} from '../src/formula.mjs';
const calc=text=>evaluateFormula(compileFormula(text,()=>null),()=>null);
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'pageyard-db-extended-')),w=new Workspace(dir);let n=0;t.after(()=>{w.close();rmSync(dir,{recursive:true,force:true})});const apply=operations=>w.execute({id:`db-${++n}`,actor:'test',expectedRevision:w.revision,operations});apply([{type:'page.create',id:'root',title:'DB 기능'},{type:'source.create',id:'work',pageId:'root',name:'업무',titlePropertyId:'name'},{type:'property.create',id:'n',sourceId:'work',name:'숫자',propertyType:'number'},{type:'property.create',id:'done',sourceId:'work',name:'완료',propertyType:'checkbox'},{type:'property.create',id:'link',sourceId:'work',name:'관계',propertyType:'relation',targetSourceId:'work',inverse:{id:'back',name:'역관계'}},...['a','b','c'].map(id=>({type:'page.create',id,sourceId:'work',title:id})),{type:'value.set',pageId:'a',propertyId:'n',value:0},{type:'value.set',pageId:'b',propertyId:'n',value:10},{type:'value.set',pageId:'b',propertyId:'done',value:true},{type:'relation.set',pageId:'a',propertyId:'link',targetIds:['b','c']}]);return {w,apply}}
test('extended aggregates preserve zero/false, calculate medians and date ranges and reject wrong input types',()=>{
  assert.equal(aggregate([0,10,null],'median'),5);assert.equal(aggregate([0,10,null],'percent_empty'),1/3);assert.equal(aggregate([false,true,null],'percent_checked'),1/3);assert.equal(aggregate([false,true,null],'count_nonempty'),2);
  assert.deepEqual(aggregate([{start:'2026-01-03'},{start:'2026-01-01',end:'2026-01-10'}],'date_range'),{start:'2026-01-01',end:'2026-01-10'});assert.throws(()=>aggregate(['0'],'sum'),{code:'ROLLUP_TYPE'});
});
test('relative dates use chosen timezone, Monday weeks, month/leap boundaries and DST day lengths',()=>{
  assert.deepEqual(relativeDateRange({period:'today',timeZone:'America/New_York'},'2026-03-08T12:00:00Z'),{from:'2026-03-08',to:'2026-03-09',start:'2026-03-08T05:00:00.000Z',end:'2026-03-09T04:00:00.000Z'});
  assert.equal(relativeDateRange({period:'this_week',timeZone:'UTC'},'2026-03-01T12:00:00Z').from,'2026-02-23');assert.equal(relativeDateRange({period:'last_month'},'2024-03-01T00:00:00Z').to,'2024-03-01');assert.throws(()=>relativeDateRange({period:'today',timeZone:'Invalid/Zone'}),{code:'FILTER_RELATIVE'});assert.equal(matchesRelative({start:'2026-03-08'},{period:'today',timeZone:'America/New_York'},'2026-03-08T12:00:00Z'),true);
});
test('single relation limits reject inverse overflows atomically, including configuration changes',t=>{
  const f=fixture(t),before=canonical(f.w.snapshot());assert.throws(()=>f.apply([{type:'property.update',id:'link',relationLimit:1}]),{code:'VALUE_TYPE'});assert.equal(canonical(f.w.snapshot()),before);
  f.apply([{type:'relation.set',pageId:'a',propertyId:'link',targetIds:['b']},{type:'property.update',id:'link',relationLimit:1,displayProperties:['name','n']}]);const snapshot=canonical(f.w.snapshot());assert.throws(()=>f.apply([{type:'relation.set',pageId:'c',propertyId:'back',targetIds:['a']}]),{code:'VALUE_TYPE'});assert.equal(canonical(f.w.snapshot()),snapshot);
});
test('related map/filter formulas bind stable property IDs, respect lexical scope, rename and independent copies',t=>{
  const f=fixture(t);f.apply([{type:'property.create',id:'f',sourceId:'work',name:'완료 관계 이름',propertyType:'formula',formula:'prop("관계").filter(current.prop("완료")).map(current.name()).join(",")'}]);assert.equal(f.w.get('a').entity.computed.f,'b');
  f.apply([{type:'property.update',id:'done',name:'마침'},{type:'value.set',pageId:'c',propertyId:'done',value:true}]);assert.equal(f.w.get('a').entity.computed.f,'b,c');const copied=f.apply([{type:'page.duplicate',id:'root',newId:'copy'}]).copies[0].idMap;assert.equal(f.w.get(copied.a).entity.computed[copied.f],'b,c');
  const bundle=f.w.export({id:'root',format:'bundle'}),preview=f.w.previewImport({format:'bundle',text:bundle.text,title:'복원'}),m=f.apply(preview.operations).copies[0].idMap;assert.equal(f.w.get(m.a).entity.computed[m.f],'b,c');
});
test('list method syntax, nested scope and calendar month arithmetic survive formatting without eval',()=>{
  const text='[1,2,3].map(let(x,current,[10,20].map(x+current+index))).flat().filter(current > 15).sort()';assert.deepEqual(calc(text),[22,23,24]);
  const ast=compileFormula('[3,1,3,2].unique().sort().reverse()',()=>null);assert.deepEqual(evaluateFormula(compileFormula(formatFormula(ast),()=>null),()=>null),[3,2,1]);
  assert.equal(calc('formatDate(dateAdd(parseDate("2026-01-31"),1,"months"),"MMMM D, YYYY")'),'February 28, 2026');
});
test('table aggregates are based on all filtered matches and do not change with pagination or hidden groups',t=>{
  const f=fixture(t);f.apply([{type:'view.create',id:'v',sourceId:'work',parentId:'root',name:'집계',config:{columnAggregations:{n:'sum'},groupBy:'done',hiddenGroups:['null'],frozenProperties:['name']}}]);const q=f.w.query({viewId:'v',limit:1});assert.equal(q.total,3);assert.equal(q.presentation.columnAggregations.n,10);assert.equal(q.presentation.groups.find(g=>g.key==='null').hidden,true);
});

test('relation group order and hidden keys remap through full page copies and exchange bundles',t=>{
 const f=fixture(t);f.apply([{type:'view.create',id:'grouped',sourceId:'work',parentId:'root',name:'관계 그룹',viewType:'board',config:{groupBy:'link',hiddenGroups:['"b"'],groupOrder:['"c"','"b"']}}]);
 const copied=f.apply([{type:'page.duplicate',id:'root',newId:'copy'}]).copies[0].idMap;assert.deepEqual(f.w.get(copied.grouped).entity.config.hiddenGroups,[JSON.stringify(copied.b)]);assert.deepEqual(f.w.get(copied.grouped).entity.config.groupOrder,[JSON.stringify(copied.c),JSON.stringify(copied.b)]);
 const bundle=f.w.export({id:'root',format:'bundle'}),preview=f.w.previewImport({format:'bundle',text:bundle.text,title:'복원'}),m=f.apply(preview.operations).copies[0].idMap;assert.deepEqual(f.w.get(m.grouped).entity.config.hiddenGroups,[JSON.stringify(m.b)]);assert.deepEqual(f.w.get(m.grouped).entity.config.groupOrder,[JSON.stringify(m.c),JSON.stringify(m.b)]);
});
