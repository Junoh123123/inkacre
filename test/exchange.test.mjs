import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {Workspace,canonical} from '../src/workspace.mjs';import {parseCsv,writeCsv} from '../src/exchange.mjs';
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'pageyard-exchange-')),w=new Workspace(dir);let n=0;t.after(()=>{w.close();rmSync(dir,{recursive:true,force:true})});const apply=operations=>w.execute({id:`exchange-${++n}`,actor:'test',expectedRevision:w.revision,operations});return {w,apply,dir}}
test('CSV quotes, multiline Unicode and CRLF round-trip; malformed rows never write',t=>{
  const data=[['이름','메모'],['A, B','줄1\n"인용"'],['😀','']],text=writeCsv(data);assert.deepEqual(parseCsv(text),data);
  const f=fixture(t),before=canonical(f.w.snapshot()),preview=f.w.previewImport({format:'csv',text,title:'CSV'});assert.equal(canonical(f.w.snapshot()),before);f.apply(preview.operations);
  const source=f.w.snapshot().objects.find(o=>o.kind==='source');assert.equal(f.w.query({sourceId:source.id}).total,2);assert.deepEqual(parseCsv(f.w.export({id:source.id,format:'csv'}).text),data);
  const snapshot=canonical(f.w.snapshot());assert.throws(()=>f.w.previewImport({format:'csv',text:'a,b\n"x',title:'bad'}),{code:'CSV_SYNTAX'});assert.throws(()=>f.w.previewImport({format:'csv',text:'a,a\n1,2',title:'bad'}),{code:'CSV_HEADER'});assert.equal(canonical(f.w.snapshot()),snapshot);
});
test('Markdown import keeps nested tasks, inline marks, code language and literal unsafe links',t=>{
  const f=fixture(t),preview=f.w.previewImport({format:'markdown',title:'MD',text:'# 제목\n\n- [x] **완료**\n  - 하위\n\n```js\nconst a = 1;\n```\n[원문](javascript:alert(1))'});f.apply(preview.operations);
  const objects=f.w.snapshot().objects,task=objects.find(o=>o.blockType==='todo');assert.equal(task.checked,true);assert.equal(task.richText[0].bold,true);assert.equal(objects.find(o=>o.richText?.[0]?.text==='하위').parentId,task.id);assert.equal(objects.find(o=>o.blockType==='code').language,'js');
  const output=f.w.export({id:objects.find(o=>o.kind==='page').id,format:'markdown'}).text;assert.match(output,/- \[x\] \*\*완료\*\*/);assert.match(output,/const a = 1/);assert.match(output,/javascript:alert/);
});
test('structure bundle preview is read-only; import remaps formulas, inverse relations and button targets and preserves bytes',t=>{
  const f=fixture(t),bytes=Buffer.from('generated exchange bytes'),blob=f.w.putBlob(bytes);
  f.apply([{type:'page.create',id:'root',title:'자료'},{type:'source.create',id:'work',pageId:'root',name:'업무',titlePropertyId:'name'},{type:'property.create',id:'done',sourceId:'work',name:'완료',propertyType:'checkbox'},{type:'property.create',id:'formula',sourceId:'work',name:'점수',propertyType:'formula',formula:'if(prop("완료"), 1, 0)'},{type:'property.create',id:'rel',sourceId:'work',name:'관계',propertyType:'relation',targetSourceId:'work',inverse:{id:'inverse',name:'역관계'}},{type:'page.create',id:'a',sourceId:'work',title:'A'},{type:'page.create',id:'b',sourceId:'work',title:'B'},{type:'value.set',pageId:'a',propertyId:'done',value:true},{type:'relation.set',pageId:'a',propertyId:'rel',targetIds:['b']},{type:'attachment.register',id:'file',name:'합성.txt',mediaType:'text/plain',...blob},{type:'block.create',id:'body',parentId:'a',richText:[{text:'강조',bold:true,pageId:'b'}]},{type:'block.create',id:'media',parentId:'a',blockType:'file',attachmentId:'file'},{type:'property.create',id:'button',sourceId:'work',name:'설정',propertyType:'button',button:{label:'설정',actions:[{action:'set_property',targetId:'b',propertyId:'done',value:true}]}}]);
  const exported=f.w.export({id:'root',format:'bundle'}),g=fixture(t),before=canonical(g.w.snapshot()),preview=g.w.previewImport({format:'bundle',text:exported.text,title:'묶음'});
  assert.equal(canonical(g.w.snapshot()),before);assert.deepEqual(readdirSync(g.w.blobDirectory),[]);const r=g.apply(preview.operations),m=r.copies[0].idMap;
  assert.equal(g.w.get(m.a).entity.computed[m.formula],1);assert.deepEqual(g.w.get(m.b).entity.values[m.inverse],[m.a]);assert.deepEqual(g.w.attachmentBytes(m.file).bytes,bytes);assert.equal(g.w.get(m.body).entity.richText[0].pageId,m.b);assert.equal(g.w.get(m.button).entity.button.actions[0].targetId,m.b);
  g.apply([{type:'button.run',id:m.button,pageId:m.a}]);assert.equal(g.w.get(m.b).entity.values[m.done],true);
});
test('bundle corruption or unresolved external mentions reject the whole preview without discarding data',t=>{
  const f=fixture(t);f.apply([{type:'page.create',id:'root',title:'자료'},{type:'page.create',id:'external',title:'외부'},{type:'block.create',id:'mention',parentId:'root',richText:[{text:'외부',pageId:'external'}]}]);
  const text=f.w.export({id:'root',format:'bundle'}).text,g=fixture(t),before=canonical(g.w.snapshot());assert.throws(()=>g.w.previewImport({format:'bundle',text,title:'외부'}),{code:'IMPORT_EXTERNAL'});assert.equal(canonical(g.w.snapshot()),before);
  const bundle=JSON.parse(text);bundle.objects[1].unknown='must not lose';assert.throws(()=>g.w.previewImport({format:'bundle',text:JSON.stringify(bundle),title:'잘못된 필드'}),{code:'IMPORT_FIELDS'});
});

test('F01 Markdown export keeps simple table cells, empty values, marks and delimiter characters without writing',t=>{
  const f=fixture(t);f.apply([{type:'page.create',id:'doc',title:'표 내보내기'},{type:'block.create',id:'table',parentId:'doc',blockType:'table',tableHeader:{row:true,column:true},cells:[[[{text:'이름'}],[{text:'값'}],[{text:'빈 값'}]],[[{text:'표 원문 | 경로\\내용\n다음 줄',bold:true}],[{text:'25'}],[]]]}]);
  const before=canonical(f.w.snapshot()),out=f.w.export({id:'doc',format:'markdown'});assert.match(out.text,/표 원문/);assert.match(out.text,/\\\|/);assert.match(out.text,/경로\\\\내용/);assert.match(out.text,/<br>/);assert.match(out.text,/\*\*표 원문/);assert.match(out.text,/\| 25 \|  \|/);assert.equal(canonical(f.w.snapshot()),before);assert.match(f.w.export({id:'doc',format:'bundle'}).text,/표 원문/);
});
test('F01 table without a header keeps its first data row and every subsequent row',t=>{
  const f=fixture(t);f.apply([{type:'page.create',id:'doc',title:'머리글 없음'},{type:'block.create',id:'table',parentId:'doc',blockType:'table',tableHeader:{row:false,column:false},cells:[[[{text:'첫 행'}],[{text:'0'}]],[[{text:'둘째 행'}],[{text:'false'}]]]}]);
  const text=f.w.export({id:'doc',format:'markdown'}).text;assert.match(text,/첫 행/);assert.match(text,/둘째 행/);assert.match(text,/\| 0 \|/);assert.match(text,/\| false \|/);
});
