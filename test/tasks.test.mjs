import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace, canonical } from '../src/workspace.mjs';

function fixture(t, mode = 'none', avoidWeekends = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'pageyard-task-graph-'));
  let workspace = new Workspace(directory), sequence = 0;
  const apply = operations => workspace.execute({ id: `tasks-${++sequence}`, actor: 'test', expectedRevision: workspace.revision, operations });
  t.after(() => { workspace.close(); rmSync(directory, { recursive: true, force: true }); });
  apply([{ type: 'page.create', id: 'root', title: '합성 업무 구조' }, { type: 'source.create', id: 'work', pageId: 'root', name: '업무', titlePropertyId: 'name' },
    { type: 'property.create', id: 'due', sourceId: 'work', name: '일정', propertyType: 'date' },
    { type: 'property.create', id: 'cost', sourceId: 'work', name: '비용', propertyType: 'number' },
    { type: 'source.configure_tasks', id: 'work', subitems: { enabled: true, parentPropertyId: 'parent', childrenPropertyId: 'sub' }, dependencies: { enabled: true, predecessorPropertyId: 'before', successorPropertyId: 'after', datePropertyId: 'due', mode, avoidWeekends } },
    ...['a', 'b', 'c', 'd'].map(id => ({ type: 'page.create', id, title: id.toUpperCase(), sourceId: 'work' })),
    ...[['19','20'],['22','23'],['26','27'],['29','30']].map(([start,end],index)=>({type:'value.set',pageId:['a','b','c','d'][index],propertyId:'due',value:{start:`2026-10-${start}`,end:`2026-10-${end}`,timeZone:'Asia/Tokyo'}})),
    { type: 'relation.set', pageId: 'b', propertyId: 'before', targetIds: ['a'] }, { type: 'relation.set', pageId: 'c', propertyId: 'before', targetIds: ['b'] },
    { type: 'block.create', id: 'body-b', parentId: 'b', richText: [{ text: '업무 원문', bold: true }] },
    { type: 'view.create', id: 'tree', sourceId: 'work', parentId: 'root', name: '계층 보기' }]);
  const undo = command => workspace.undo({ id: `undo-${++sequence}`, actor: 'test', expectedRevision: workspace.revision, targetCommandId: command.commandId });
  return { get workspace() { return workspace; }, apply, undo, reopen() { workspace.close(); workspace = new Workspace(directory); } };
}
const dates = f => ['a','b','c','d'].map(id=>f.workspace.get(id).entity.values.due?.start ?? null);
const nested = f => f.apply([{type:'relation.set',pageId:'b',propertyId:'parent',targetIds:['a']},{type:'relation.set',pageId:'c',propertyId:'parent',targetIds:['b']}]);

test('task relations reparent without changing row identity/body and reject cycles through either inverse', t => {
  const f = fixture(t); nested(f);
  assert.deepEqual(f.workspace.get('a').entity.values.sub, ['b']);
  assert.deepEqual(f.workspace.get('c').entity.task.ancestors, ['b','a']);
  f.apply([{type:'relation.set',pageId:'b',propertyId:'parent',targetIds:['d']}]);
  assert.deepEqual(f.workspace.get('a').entity.values.sub, []);
  assert.deepEqual(f.workspace.get('d').entity.values.sub, ['b']);
  assert.equal(f.workspace.get('b').entity.sourceId, 'work');
  assert.equal(f.workspace.get('body-b').entity.richText[0].text, '업무 원문');
  const snapshot = canonical(f.workspace.snapshot());
  assert.throws(()=>f.apply([{type:'relation.set',pageId:'d',propertyId:'parent',targetIds:['c']}]),{code:'TASK_PARENT_CYCLE'});
  assert.throws(()=>f.apply([{type:'relation.set',pageId:'c',propertyId:'sub',targetIds:['d']}]),{code:'TASK_PARENT_CYCLE'});
  assert.throws(()=>f.apply([{type:'relation.set',pageId:'b',propertyId:'parent',targetIds:['a','d']}]),{code:'TASK_PARENT_LIMIT'});
  assert.equal(canonical(f.workspace.snapshot()), snapshot);
});

test('active graph schema and dependency cycles are guarded atomically, including conversion preview', t => {
  const f = fixture(t), snapshot = canonical(f.workspace.snapshot());
  assert.throws(()=>f.apply([{type:'relation.set',pageId:'a',propertyId:'before',targetIds:['c']}]),{code:'TASK_DEPENDENCY_CYCLE'});
  assert.throws(()=>f.apply([{type:'node.trash',id:'parent'}]),{code:'TASK_SCHEMA'});
  assert.equal(f.workspace.previewPropertyConversion({type:'property.convert',id:'parent',propertyType:'text'}).allowed,false);
  assert.equal(canonical(f.workspace.snapshot()),snapshot);
  f.apply([{type:'source.configure_tasks',id:'work',subitems:{enabled:false}},{type:'property.convert',id:'parent',propertyType:'text'}]);
  assert.equal(f.workspace.get('parent').entity.type,'text');
});

test('parent Trash/restore only restores descendants deleted with that parent and undo preserves originals', t => {
  const f=fixture(t);nested(f);
  f.apply([{type:'node.trash',id:'c'}]);
  const trash=f.apply([{type:'node.trash',id:'a'}]);
  assert.equal(f.workspace.get('b').entity.alive,false);
  assert.equal(f.workspace.get('body-b').entity.visible,false);
  assert.throws(()=>f.apply([{type:'node.restore',id:'b'}]),{code:'PARENT_IN_TRASH'});
  f.undo(trash);assert.equal(f.workspace.get('b').entity.alive,true);assert.equal(f.workspace.get('c').entity.alive,false);
  f.apply([{type:'node.trash',id:'a'}]);f.reopen();f.apply([{type:'node.restore',id:'a'}]);
  assert.equal(f.workspace.get('b').entity.alive,true);assert.equal(f.workspace.get('c').entity.alive,false);
  assert.equal(f.workspace.get('body-b').entity.richText[0].text,'업무 원문');
});

test('task subtree and whole database copies remap graph/schema while keeping originals independent', t => {
  const f=fixture(t);nested(f);
  const copy=f.apply([{type:'page.duplicate',id:'a',newId:'a-copy'}]),ids=copy.copies[0].idMap;
  assert.notEqual(ids.b,'b');assert.notEqual(ids.c,'c');
  assert.deepEqual(f.workspace.get(ids.b).entity.values.parent,['a-copy']);
  assert.deepEqual(f.workspace.get(ids.c).entity.values.before,[ids.b]);
  assert.deepEqual(f.workspace.get('a').entity.values.sub,['b']);
  assert.notEqual(f.workspace.get(ids.b).entity.uniqueId,f.workspace.get('b').entity.uniqueId);
  const full=f.apply([{type:'page.duplicate',id:'root',newId:'root-copy'}]),map=full.copies[0].idMap;
  assert.equal(f.workspace.get(map.work).entity.tasks.subitems.parentPropertyId,map.parent);
  assert.equal(f.workspace.get(map.work).entity.tasks.dependencies.datePropertyId,map.due);
  assert.deepEqual(f.workspace.get(map.b).entity.values[map.parent],[map.a]);
});

test('nested filtering retains ancestor context, counts matches and paginates matches without loss', t => {
  const f=fixture(t);nested(f);
  const query=f.workspace.query({viewId:'tree',filter:{propertyId:'name',op:'eq',value:'C'},limit:1});
  assert.equal(query.total,1);assert.equal(query.hasMore,false);
  assert.deepEqual(query.rows.map(row=>[row.id,row.depth,!!row.contextOnly]),[['a',0,true],['b',1,true],['c',2,false]]);
  f.apply([{type:'view.update',id:'tree',config:{subitems:{display:'flat',include:'parents'}}}]);
  assert.deepEqual(f.workspace.query({viewId:'tree'}).rows.map(row=>row.id),['a','d']);
  f.apply([{type:'view.update',id:'tree',config:{subitems:{display:'nested',include:'children'}}}]);
  const one=f.workspace.query({viewId:'tree',limit:1}),two=f.workspace.query({viewId:'tree',offset:1,limit:1});
  assert.equal(one.hasMore,true);assert.deepEqual([...one.rows,...two.rows].filter(row=>!row.contextOnly).map(row=>row.id),['b','c']);
  f.apply([{type:'view.update',id:'tree',viewType:'timeline',config:{datePropertyId:'due',filter:{propertyId:'name',op:'eq',value:'C'}}}]);
  const timeline=f.workspace.query({viewId:'tree'});
  assert.equal(timeline.total,1); assert.deepEqual(timeline.presentation.items.map(item=>item.rowId),['a','b','c']);
  assert.equal(timeline.presentation.dependencies.length,2);
});

test('preserve mode shifts a chain both ways; undo/redo and restart restore the entire atomic schedule', t => {
  const f=fixture(t,'preserve');
  const moved=f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-22',end:'2026-10-23',timeZone:'Asia/Tokyo'}}]);
  assert.deepEqual(dates(f),['2026-10-22','2026-10-25','2026-10-29','2026-10-29']);
  assert.equal(f.workspace.get('b').entity.values.due.timeZone,'Asia/Tokyo');
  const undo=f.undo(moved);assert.deepEqual(dates(f),['2026-10-19','2026-10-22','2026-10-26','2026-10-29']);
  f.undo(undo);f.reopen();assert.equal(dates(f)[2],'2026-10-29');
  f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-17',end:'2026-10-18'}}]);
  assert.deepEqual(dates(f).slice(0,3),['2026-10-17','2026-10-20','2026-10-24']);
});

test('overlap mode only pushes conflicting dates; none leaves dates alone', t => {
  const f=fixture(t,'overlap');
  f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-22',end:'2026-10-23'}}]);
  assert.deepEqual(dates(f).slice(0,3),['2026-10-22','2026-10-24','2026-10-26']);
  f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-17',end:'2026-10-18'}}]);
  assert.equal(dates(f)[1],'2026-10-24');
  f.apply([{type:'source.configure_tasks',id:'work',dependencies:{enabled:true,mode:'none'}},{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-11-01',end:'2026-11-10'}}]);
  assert.equal(dates(f)[1],'2026-10-24');
});

test('weekend avoidance preserves duration; missing dates are not invented; mixed precision rejects whole batch', t => {
  const f=fixture(t,'overlap',true);
  f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-22',end:'2026-10-23'}}]);
  assert.deepEqual(f.workspace.get('b').entity.values.due,{start:'2026-10-26',end:'2026-10-27',timeZone:'Asia/Tokyo'});
  assert.equal(dates(f)[2],'2026-10-28');
  f.apply([{type:'value.set',pageId:'b',propertyId:'due',value:null},{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-11-01',end:'2026-11-10'}}]);
  assert.equal(dates(f)[1],null);assert.equal(dates(f)[2],'2026-10-28');
  const before=canonical(f.workspace.snapshot());
  assert.throws(()=>f.apply([{type:'value.set',pageId:'b',propertyId:'due',value:{start:'2026-11-11T00:00:00Z'}}]),{code:'TASK_DATE_PRECISION'});
  assert.equal(canonical(f.workspace.snapshot()),before);
});

test('multiple predecessors and explicit successor edits propagate once and stale writers cannot overwrite', t => {
  const f=fixture(t,'preserve');f.apply([{type:'relation.set',pageId:'d',propertyId:'before',targetIds:['a','c']}]);
  f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-22',end:'2026-10-23'}},{type:'value.set',pageId:'b',propertyId:'due',value:{start:'2026-10-30',end:'2026-10-31'}}]);
  assert.deepEqual(dates(f),['2026-10-22','2026-10-30','2026-11-03','2026-11-06']);
  const revision=f.workspace.revision;
  assert.throws(()=>f.workspace.execute({id:'stale-task',actor:'agent',expectedRevision:revision-1,operations:[{type:'value.set',pageId:'a',propertyId:'due',value:null}]}),{code:'REVISION_CONFLICT'});
  assert.equal(f.workspace.revision,revision);
});

test('timestamp dependency shifts preserve elapsed duration and reject naive linked times atomically', t => {
  const f=fixture(t);
  f.apply(['a','b','c'].map((pageId,index)=>({type:'value.set',pageId,propertyId:'due',value:{start:`2026-10-${[19,22,26][index]}T09:00:00+09:00`,end:`2026-10-${[19,22,26][index]}T11:00:00+09:00`,timeZone:'Asia/Tokyo'}})));
  f.apply([{type:'source.configure_tasks',id:'work',dependencies:{enabled:true,mode:'preserve'}}]);
  f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-22T09:00:00+09:00',end:'2026-10-22T11:00:00+09:00',timeZone:'Asia/Tokyo'}}]);
  assert.deepEqual(f.workspace.get('b').entity.values.due,{start:'2026-10-25T00:00:00.000Z',end:'2026-10-25T02:00:00.000Z',timeZone:'Asia/Tokyo'});
  assert.equal(f.workspace.get('c').entity.values.due.start,'2026-10-29T00:00:00.000Z');
  const before=canonical(f.workspace.snapshot());
  assert.throws(()=>f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-23T09:00:00',end:'2026-10-23T11:00:00'}}]),{code:'TASK_DATE_VALUE'});
  assert.equal(canonical(f.workspace.snapshot()),before);
});

test('existing inverse relations can become the hierarchy; disabling preserves links and re-enabling validates them', t => {
  const f=fixture(t);
  f.apply([{type:'property.create',id:'existing-parent',sourceId:'work',name:'기존 상위',propertyType:'relation',targetSourceId:'work',inverse:{id:'existing-child',name:'기존 하위'}},
    {type:'relation.set',pageId:'b',propertyId:'existing-parent',targetIds:['a']},
    {type:'source.configure_tasks',id:'work',subitems:{enabled:true,parentPropertyId:'existing-parent',childrenPropertyId:'existing-child'}}]);
  assert.equal(f.workspace.get('b').entity.task.parentId,'a');
  f.apply([{type:'source.configure_tasks',id:'work',subitems:{enabled:false}}]);
  assert.equal(f.workspace.get('b').entity.task.parentId,null); assert.deepEqual(f.workspace.get('b').entity.values['existing-parent'],['a']);
  f.apply([{type:'relation.set',pageId:'a',propertyId:'existing-parent',targetIds:['b']}]);
  const before=canonical(f.workspace.snapshot());
  assert.throws(()=>f.apply([{type:'source.configure_tasks',id:'work',subitems:{enabled:true}}]),{code:'TASK_PARENT_CYCLE'});
  assert.equal(canonical(f.workspace.snapshot()),before);
});

test('backup restore retains hierarchy configuration, scheduled dates and the schedule undo handle', async t => {
  const f=fixture(t,'preserve'); nested(f);
  const moved=f.apply([{type:'value.set',pageId:'a',propertyId:'due',value:{start:'2026-10-22',end:'2026-10-23'}}]);
  const saved=await f.workspace.createBackup(), parent=mkdtempSync(path.join(tmpdir(),'pageyard-task-restore-')), destination=path.join(parent,'restored');
  t.after(()=>rmSync(parent,{recursive:true,force:true})); Workspace.restoreBackup(saved.destination,destination);
  const restored=new Workspace(destination);
  try {
    assert.deepEqual(restored.get('work').entity.tasks,f.workspace.get('work').entity.tasks);
    assert.deepEqual(restored.get('c').entity.task.ancestors,['b','a']); assert.equal(restored.get('c').entity.values.due.start,'2026-10-29');
    restored.undo({id:'restored-schedule-undo',actor:'test',expectedRevision:restored.revision,targetCommandId:moved.commandId});
    assert.equal(restored.get('c').entity.values.due.start,'2026-10-26'); assert.equal(restored.get('body-b').entity.richText[0].text,'업무 원문');
  } finally { restored.close(); }
});
