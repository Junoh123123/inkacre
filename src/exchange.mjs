import {isText,textValue} from './formula-values.mjs';
import {planArchive,zipBundle,importObjectLimit} from './archive-content.mjs';
import {markdownImport,htmlOperations,pageHtml} from './html-content.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {requireThat,importSchema,bundleFormat,bundleExtension,isBundleFormat,blockTypes,propertyTypes,richText,buttonDefinition,viewConfig,blockExtraKeys} from './contracts.mjs';
import {compileFormula,formatFormula} from './formula.mjs';
import {children,properties,createReader,visible} from './workspace.mjs';
import {computedTypes,convertValue} from './conversion.mjs';
import {exportTree} from './export-tree.mjs';

export function parseCsv(text) {
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"'){quoted=false;closed=true}else cell+=c;continue}
    if(c==='"'){requireThat(!cell&&!closed,'CSV_SYNTAX','따옴표는 셀의 시작에만 사용할 수 있습니다.');quoted=true;continue}
    if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[]}continue}
    requireThat(!closed,'CSV_SYNTAX','닫는 따옴표 뒤에 잘못된 문자가 있습니다.');cell+=c;
  }
  requireThat(!quoted,'CSV_SYNTAX','닫히지 않은 CSV 따옴표가 있습니다.');if(cell||row.length||closed)rows.push([...row,cell]);
  requireThat(rows.length&&rows[0].length&&new Set(rows[0]).size===rows[0].length,'CSV_HEADER','중복되지 않는 열 이름이 필요합니다.');
  requireThat(rows.every(row=>row.length===rows[0].length),'CSV_COLUMNS','행마다 열 개수가 같아야 합니다.');return rows;
}
export const writeCsv = rows => rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n';
function inline(text) {
  const runs=[],pattern=/\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*/g;let offset=0;
  for(const match of text.matchAll(pattern)){if(match.index>offset)runs.push({text:text.slice(offset,match.index)});const [raw,caption,url,bold,strike,code,italic]=match;if(caption&&/^(https?:|mailto:)/.test(url))runs.push({text:caption,href:url});else if(caption)runs.push({text:raw});else runs.push({text:bold??strike??code??italic,...(bold?{bold:true}:strike?{strike:true}:code?{code:true}:{italic:true})});offset=match.index+raw.length}
  if(offset<text.length)runs.push({text:text.slice(offset)});return runs;
}
export const markdownOperations=(text,parentId)=>markdownImport(text,parentId);
function markdownRuns(runs) {return (runs??[]).map(run=>{let s=run.text;if(run.equation)return '$'+s+'$';if(run.code)s='`'+s+'`';if(run.bold)s='**'+s+'**';if(run.italic)s='*'+s+'*';if(run.strike)s='~~'+s+'~~';if(run.href)s=`[${s}](${run.href})`;if(run.pageId)s=`[${s}](page-${encodeURIComponent(run.pageId)}.md)`;return s}).join('')}
function markdownTable(block) {
  const rows=block.cells.map(row=>row.map(cell=>markdownRuns(cell).replaceAll('\\','\\\\').replaceAll('|','\\|').replace(/\r?\n/g,'<br>'))),width=rows[0].length;
  const line=row=>'| '+row.join(' | ')+' |',header=block.tableHeader?.row?rows.shift():Array(width).fill('');
  return [line(header),line(Array(width).fill('---')),...rows.map(line)].join('\n');
}
export function markdownPage(state,page) {
  const lines=[`# ${page.title}`,''];
  const visit=(parent,depth=0,seen=new Set())=>{if(seen.has(parent))return;seen=new Set([...seen,parent]);let ordinal=0;
    for(const b of children(state,parent).filter(x=>x.kind==='block'&&x.alive)){
      const text=markdownRuns(b.richText);ordinal=b.blockType==='numbered'?ordinal+1:0;const prefix={heading1:'# ',heading2:'## ',heading3:'### ',heading4:'#### ',bullet:'- ',numbered:`${ordinal}. `,todo:`- [${b.checked?'x':' '}] `,quote:'> ',callout:'> ',toggle:'- '}[b.blockType]??'';
      if(b.blockType==='table')lines.push(markdownTable(b));
      else if(b.blockType==='code'){lines.push('```'+(b.language??''),(b.richText??[]).map(r=>r.text).join(''),'```');if(b.caption?.length)lines.push('*'+markdownRuns(b.caption)+'*');}
      else if(b.blockType==='divider')lines.push('---');else if(b.attachmentId)lines.push(`${b.blockType==='image'?'!':''}[${text||state.get(b.attachmentId)?.name||'첨부'}](attachment-${b.attachmentId})`);
      else if(b.blockType==='bookmark'||b.blockType==='embed'&&b.url)lines.push(`[${text||b.bookmark?.title||b.url}](${b.url})`);else if(b.blockType==='tab')lines.push('  '.repeat(depth)+`**${text}**`);else if(b.blockType==='button')lines.push(`<!-- button: ${b.button?.label??'실행'}; preserved in bundle -->`);
      else lines.push('  '.repeat(depth)+prefix+text);visit(b.blockType==='synced_reference'?b.sourceBlockId:b.id,depth+(['bullet','numbered','todo','toggle'].includes(b.blockType)?1:0),seen);lines.push('');
    }};visit(page.id);return lines.join('\n');
}
export function exportContent(workspace,state,input) {
  const {id,format='bundle'}=input;
  // The readable export (Markdown & CSV / HTML with its options), or the whole workspace (id "*").
  if(id==='*'||input.subpages!==undefined||input.files!==undefined||input.viewId){
    requireThat(['markdown','html','csv'].includes(format),'EXPORT_FORMAT','Markdown·CSV 또는 HTML을 고르세요.');
    const rootIds=id==='*'?children(state,null).filter(item=>item.kind==='page'&&!item.template&&!item.sourceId&&visible(state,item.id)).map(item=>item.id):[id];
    if(id!=='*'){const root=state.get(id);requireThat(root&&visible(state,id)&&['page','source'].includes(root.kind),'EXPORT_TARGET','페이지 또는 데이터베이스를 선택하세요.');}
    requireThat(rootIds.length>0,'EXPORT_TARGET','내보낼 페이지가 없습니다.');
    return exportTree({workspace,state,rootIds,format:format==='html'?'html':'markdown',files:input.files!==false,subpages:id==='*'||!!input.subpages,folders:input.folders!==false,comments:!!input.comments,viewId:input.viewId??null,markdownPage,pageHtml,name:id==='*'?'workspace':state.get(id)?.title??state.get(id)?.name});
  }
  const root=state.get(id);requireThat(root&&visible(state,id)&&['page','source'].includes(root.kind),'EXPORT_TARGET','페이지 또는 데이터베이스를 선택하세요.');
  const read=createReader(state),csv=source=>{const schema=properties(state,source.id);return writeCsv([schema.map(p=>p.name),...[...state.values()].filter(p=>p.kind==='page'&&p.sourceId===source.id&&!p.template&&visible(state,p.id)).map(page=>schema.map(p=>{const value=read(page.id,p.id);if(value==null)return '';if(isText(value))return textValue(value);if(p.type==='relation')return value.map(id=>state.get(id)?.title??id).join(', ');if(['select','multi_select','status'].includes(p.type))return (Array.isArray(value)?value:[value]).map(id=>p.options?.find(o=>o.id===id)?.name??id).join(', ');return typeof value==='object'?JSON.stringify(value):String(value)}))])};
  requireThat(['csv','markdown','html','bundle','zip'].includes(format),'EXPORT_FORMAT','지원하는 내보내기 형식을 선택하세요.');
  if(format==='html'){requireThat(root.kind==='page','EXPORT_TARGET','HTML은 페이지에서 내보내세요.');return {format,filename:`${root.title}.html`,mediaType:'text/html',text:pageHtml(state,root,children),warnings:['실행 가능한 코드는 내보내지 않습니다. 관계·보기·첨부 bytes는 구조 보존 묶음에 보존하세요.']};}
  if(format==='csv'){requireThat(root.kind==='source','EXPORT_TARGET','CSV는 데이터베이스에서 내보내세요.');return {format,filename:`${root.name}.csv`,mediaType:'text/csv',text:csv(root),warnings:['CSV만으로는 본문·서식·관계 ID·첨부 bytes를 보존하지 않습니다. 구조 보존 묶음을 함께 내보내세요.']}}
  if(format==='markdown'){requireThat(root.kind==='page','EXPORT_TARGET','Markdown은 페이지에서 내보내세요.');return {format,filename:`${root.title}.md`,mediaType:'text/markdown',text:markdownPage(state,root),warnings:['표의 셀 내용은 내보냅니다. 열 머리글 강조·색상·다단 배치·버튼·보기·관계 ID·첨부 bytes의 완전 보존에는 구조 보존 묶음을 사용하세요.']}}
  // Automations stay out of the bundle (their rules point at this workspace's people, pages and services).
  const owned=new Map();const collect=id=>{if(owned.has(id))return;const item=state.get(id);if(!item||['notification','delivery','automation'].includes(item.kind)||item.purged)return;owned.set(id,item);for(const child of children(state,id))collect(child.id)};collect(id);
  if(root.sourceId){const source=state.get(root.sourceId);owned.set(source.id,source);for(const p of properties(state,source.id))owned.set(p.id,p)}
  const referenced=new Set();const runRefs=runs=>{for(const run of runs??[])for(const key of ['iconAttachmentId','customEmoji'])if(run[key]&&state.get(run[key]))referenced.add(run[key])};
  // A button's inserted blocks may show pictures (and emoji) of their own.
  const buttonRefs=list=>{for(const block of list??[]){runRefs(block.richText);if(block.attachmentId&&state.get(block.attachmentId))referenced.add(block.attachmentId);for(const row of block.cells??[])for(const cell of row)runRefs(cell);buttonRefs(block.children)}};
  for(const item of owned.values())for(const action of item.button?.actions??[])buttonRefs(action.blocks);
  // Custom emoji used as reactions ("attachment:<id>") travel with their pictures.
  for(const item of owned.values())for(const reaction of item.reactions??[])if(typeof reaction==='string'&&reaction.startsWith('attachment:')&&state.get(reaction.slice(11))?.kind==='attachment')referenced.add(reaction.slice(11));
  for(const item of owned.values()){runRefs(item.richText);for(const row of item.cells??[])for(const cell of row)runRefs(cell);for(const key of ['imageAttachmentId','iconAttachmentId'])if(item.bookmark?.[key]&&state.get(item.bookmark[key]))referenced.add(item.bookmark[key]);}
  for(const item of owned.values()){if(item.attachmentId)referenced.add(item.attachmentId);if(item.coverAttachmentId)referenced.add(item.coverAttachmentId);if(item.kind==='view'&&item.config?.form?.coverAttachmentId&&state.get(item.config.form.coverAttachmentId))referenced.add(item.config.form.coverAttachmentId);if(item.kind==='page')for(const [key,value]of Object.entries(item.values))if(state.get(key)?.type==='files')for(const ref of value??[])referenced.add(ref)}
  const blobs={};for(const ref of referenced){const file=state.get(ref);owned.set(ref,file);blobs[file.sha256]=workspace.attachmentBytes(ref).bytes.toString('base64')}
  const bundle={format:bundleFormat,version:1,rootId:id,objects:[...owned.values()].map(item=>item.kind==='property'&&item.type==='formula'?{...item,formula:formatFormula(item.ast)}:item),blobs,readable:[...owned.values()].filter(x=>x.kind==='page'||x.kind==='source').map(x=>({name:`${x.id}.${x.kind==='page'?'md':'csv'}`,text:x.kind==='page'?markdownPage(state,x):csv(x)}))};
  if(format==='zip')return {format:'zip',filename:`${root.title??root.name}.zip`,mediaType:'application/zip',encoding:'base64',text:zipBundle(bundle),warnings:['ZIP에 읽기용 Markdown/CSV·첨부와 완전 복원용 JSON을 포함합니다.']};
  return {format:'bundle',filename:`${root.title??root.name}${bundleExtension}`,mediaType:'application/json',text:JSON.stringify(bundle,null,2),warnings:[]};
}
export function planImport(state,input) {
  input=importSchema.parse(input);const operations=[],warnings=[];
  // Pictures the import window already uploaded (Word, EPUB — on their own or inside a ZIP) are /api/attachments/<id>.
  const uploaded=url=>{const match=/^\/api\/attachments\/([^?#]+)$/.exec(url??'');if(!match)return null;const attachment=state.get(decodeURIComponent(match[1]));return attachment?.kind==='attachment'?{attachmentId:attachment.id,mediaType:attachment.mediaType}:null};
  if(input.format==='zip'){const archive=planArchive(input.text,input.title,parseCsv,uploaded),bundle=archive.bundle,idMap=Object.fromEntries(bundle.objects.map(o=>[o.id,randomUUID()]));return {operations:[{type:'content.import_bundle',bundle,idMap,...(input.parentId!==undefined?{parentId:input.parentId}:{})}],warnings:archive.warnings};}
  if(input.format==='bundle'){
    let bundle;try{bundle=JSON.parse(input.text)}catch{requireThat(false,'IMPORT_JSON','구조 보존 묶음의 JSON 형식을 확인하세요.')}
    requireThat(isBundleFormat(bundle.format)&&bundle.version===1&&Array.isArray(bundle.objects)&&bundle.objects.length<=importObjectLimit,'IMPORT_BUNDLE','지원하는 구조 보존 묶음이 아닙니다.');
    const idMap=Object.fromEntries(bundle.objects.map(o=>[o.id,randomUUID()]));requireThat(Object.keys(idMap).length===bundle.objects.length,'IMPORT_ID','묶음의 ID가 중복됩니다.');
    return {operations:[{type:'content.import_bundle',bundle,idMap,...(input.parentId!==undefined?{parentId:input.parentId}:{})}],warnings:['반복 템플릿은 중복 실행을 막기 위해 일시 중지된 상태로 가져옵니다.']};
  }
  if(['markdown','html'].includes(input.format)) {const id=randomUUID();// Pictures already uploaded by the import window (Word, EPUB) are referenced as /api/attachments/<id>.
    const local=url=>{const match=/^\/api\/attachments\/([^?#]+)$/.exec(url??'');if(!match)return null;const attachment=state.get(decodeURIComponent(match[1]));return attachment?.kind==='attachment'?{attachmentId:attachment.id,mediaType:attachment.mediaType}:null};
    operations.push({type:'page.create',id,title:input.title,parentId:input.parentId??null},...(input.format==='html'?htmlOperations(input.text,id,local):markdownOperations(input.text,id)));warnings.push('외부 이미지/상대 링크는 다운로드하지 않고 원문 링크로 보존합니다. 구조 보존 묶음은 추가 서식·관계를 보존합니다.');}
  else {
    const [headers,...rows]=parseCsv(input.text);let sourceId=input.sourceId,schema=sourceId?properties(state,sourceId):null;
    if(!sourceId){const pageId=randomUUID();operations.push({type:'page.create',id:pageId,title:input.title,parentId:input.parentId??null});sourceId=randomUUID();const titleId=randomUUID();operations.push({type:'source.create',id:sourceId,pageId,name:input.title,titlePropertyId:titleId},{type:'property.update',id:titleId,name:headers[0]});schema=headers.map((name,i)=>({id:i?randomUUID():titleId,name,type:i?'text':'title',sourceId}));for(const p of schema.slice(1))operations.push({type:'property.create',id:p.id,sourceId,name:p.name,propertyType:'text'});}
    const columns=headers.map(name=>{const candidates=schema.filter(p=>p.name===name||p.id===name);requireThat(candidates.length===1,'CSV_PROPERTY',`${name} 열에 대응하는 속성이 하나여야 합니다.`);requireThat(!computedTypes.has(candidates[0].type)&&candidates[0].type!=='button','CSV_READ_ONLY',`${name} 계산/버튼 열은 가져올 수 없습니다.`);return candidates[0]});
    // Every row in one operation (source.import_rows), so a large table stays one command.
    requireThat(rows.length<=20000,'IMPORT_LIMIT','한 번에 가져올 수 있는 행은 20,000개까지입니다. 파일을 나눠 주세요.');
    const imported=[];
    for(const row of rows){const id=randomUUID(),titleIndex=columns.findIndex(p=>p.type==='title'),values={};for(let i=0;i<row.length&&i<columns.length;i++)if(columns[i].type!=='title'){
      const p=columns[i],text=row[i];let value;
      if(p.type==='relation'){value=text?text.split(',').map(name=>{const matches=[...state.values()].filter(o=>o.kind==='page'&&o.sourceId===p.targetSourceId&&visible(state,o.id)&&(o.title===name.trim()||o.id===name.trim()));requireThat(matches.length===1,'CSV_RELATION',`${name} 관계 대상을 유일하게 찾을 수 없습니다.`);return matches[0].id}):[];}
      else value=text===''?null:convertValue(state,{type:'text'},p,text);values[p.id]=value;
    }imported.push({id,title:titleIndex<0?'가져온 항목':row[titleIndex]??'',values})}
    if(imported.length)operations.push({type:'source.import_rows',sourceId,rows:imported});
    warnings.push('기존 자료는 변경하지 않고 새 행을 추가합니다. 새 DB의 CSV 열은 제목/텍스트로 시작합니다.');
  }
  requireThat(operations.length<=500,'IMPORT_LIMIT','한 번의 가져오기는 명령 500개 이하여야 합니다. 자료를 나눠 주세요.');return {operations,warnings};
}

export function importBundle(state,operation,context,{add,remapButton}) {
  const {bundle,idMap}=operation;
  requireThat(isBundleFormat(bundle?.format)&&bundle.version===1&&Array.isArray(bundle.objects)&&bundle.objects.length<=importObjectLimit,'IMPORT_BUNDLE','지원하는 구조 보존 묶음이 아닙니다.');
  const originals=new Map(bundle.objects.map(o=>[o.id,o]));
  requireThat(originals.size===bundle.objects.length&&Object.keys(idMap).length===originals.size&&new Set(Object.values(idMap)).size===originals.size,'IMPORT_ID','묶음 ID와 새 ID가 유일해야 합니다.');
  requireThat([...originals.keys()].every(id=>typeof id==='string'&&idMap[id]&&!state.has(idMap[id])),'IMPORT_ID','모든 항목에 사용하지 않은 새 ID가 필요합니다.');
  const mapped=id=>id==null?id:Object.hasOwn(idMap,id)?idMap[id]:(requireThat(state.has(id),'IMPORT_EXTERNAL','묶음 외부 참조가 현재 워크스페이스에 없습니다.',{id}),id);
  const trash=['trashedAt','purged','purgedAt'];
  const allowed={page:['title','parentId','sourceId','values','template','icon','uniqueId','recurrence','taskTrashRootId','coverAttachmentId','fullWidth','reactions','archived','archivedAt','locked','wiki','versionNames','databasePage',...trash],source:['name','parentId','counter','tasks','defaultTemplateId','locked','pageLayout',...trash],property:['name','parentId','sourceId','type','options','formula','ast','targetSourceId','inversePropertyId','rollup','button','relationLimit','displayProperties','numberFormat','idPrefix','dateFormat','timeFormat',...trash],block:['parentId','blockType','richText','checked','language','sourceBlockId','attachmentId','url','button','bookmark','cells','tableHeader',...blockExtraKeys,...trash],view:['parentId','sourceId','name','viewType','config',...trash],attachment:['name','mediaType','sha256','bytes'],comment:['parentId','richText','resolved','threadId','reactions','propertyId',...trash],reminder:['parentId','at','datePropertyId','offsetMinutes','message','deliveredFor',...trash]};
  let wrapper=operation.parentId??null;
  if(bundle.objects.some(o=>o.kind==='source'&&!originals.has(o.parentId))&&!wrapper){wrapper=randomUUID();add(state,{id:wrapper,kind:'page',title:'가져온 데이터베이스',parentId:null,sourceId:null,values:{},template:false,uniqueId:null},context);}
  const common=['id','kind','parentId','alive','version','position','createdAt','updatedAt','createdBy','updatedBy'];
  for(const old of bundle.objects){
    requireThat(allowed[old.kind]&&Object.keys(old).every(key=>common.includes(key)||allowed[old.kind].includes(key)),'IMPORT_FIELDS','알 수 없는 항목/필드가 있습니다. 자료를 임의로 버리지 않습니다.',{id:old.id,kind:old.kind});
    requireThat(!old.type||propertyTypes.includes(old.type),'PROPERTY_TYPE','속성 유형을 확인하세요.');requireThat(!old.blockType||blockTypes.includes(old.blockType),'BLOCK_TYPE','블록 유형을 확인하세요.');
    if(old.richText)richText.parse(old.richText);if(old.cells)for(const row of old.cells)for(const cell of row)richText.parse(cell);if(old.button)buttonDefinition.parse(old.button);if(old.config)viewConfig.parse(old.config);
    const next=structuredClone(old);next.id=idMap[old.id];
    if(old.id===bundle.rootId&&old.kind==='page'&&!old.sourceId)next.parentId=operation.parentId??null;
    if(next.parentId!=null)next.parentId=originals.has(old.parentId)?mapped(old.parentId):old.kind==='source'||old.kind==='view'?wrapper:old.id===bundle.rootId?operation.parentId??null:mapped(old.parentId);
    for(const key of ['sourceId','targetSourceId','sourceBlockId','attachmentId','coverAttachmentId','taskTrashRootId','defaultTemplateId','datePropertyId'])if(next[key])next[key]=mapped(next[key]);
    if(next.inversePropertyId){
      if(idMap[next.inversePropertyId])next.inversePropertyId=mapped(next.inversePropertyId);
      else {const inverseId=randomUUID();add(state,{id:inverseId,kind:'property',type:'relation',name:`${old.name} · 가져온 역관계`,parentId:next.targetSourceId,sourceId:next.targetSourceId,targetSourceId:next.sourceId,inversePropertyId:next.id},context);next.inversePropertyId=inverseId;}
    }
    // References inside text (page mentions, link-mention icons, custom emoji), on bookmarks and on picture links.
    const remapRun=run=>({...run,...(run.pageId?{pageId:mapped(run.pageId)}:{}),...(run.iconAttachmentId?{iconAttachmentId:mapped(run.iconAttachmentId)}:{}),...(run.customEmoji?{customEmoji:mapped(run.customEmoji)}:{})});
    if(next.richText)next.richText=next.richText.map(remapRun);
    if(next.cells)next.cells=next.cells.map(row=>row.map(cell=>cell.map(remapRun)));
    if(next.bookmark)for(const key of ['imageAttachmentId','iconAttachmentId'])if(next.bookmark[key])next.bookmark[key]=originals.has(next.bookmark[key])?mapped(next.bookmark[key]):null;
    if(typeof next.href==='string'&&next.href.startsWith('?id=')){const target=decodeURIComponent(next.href.slice(4));next.href=Object.hasOwn(idMap,target)?`?id=${encodeURIComponent(idMap[target])}`:state.has(target)?next.href:null;if(!next.href)delete next.href;}
    if(next.threadId)next.threadId=mapped(next.threadId);if(next.propertyId)next.propertyId=mapped(next.propertyId);
    if(Array.isArray(next.reactions))next.reactions=next.reactions.map(reaction=>typeof reaction==='string'&&reaction.startsWith('attachment:')&&originals.has(reaction.slice(11))?`attachment:${mapped(reaction.slice(11))}`:reaction);
    // Versions belong to this workspace's history; their names do not travel.
    delete next.versionNames;
    if(next.values)next.values=Object.fromEntries(Object.entries(old.values).map(([id,value])=>[mapped(id),['relation','files'].includes(originals.get(id)?.type??state.get(id)?.type)?value==null?null:value.map(mapped):(originals.get(id)?.type??state.get(id)?.type)==='text'&&Array.isArray(value)?value.map(remapRun):structuredClone(value)]));
    if(next.displayProperties)next.displayProperties=next.displayProperties.map(mapped);
    if(next.rollup)next.rollup={...next.rollup,relationPropertyId:mapped(next.rollup.relationPropertyId),targetPropertyId:mapped(next.rollup.targetPropertyId)};
    if(next.button)next.button=remapButton(next.button,id=>Object.hasOwn(idMap,id)?idMap[id]:id,originals);
    if(next.tasks?.sprints)delete next.tasks.sprints;if(next.tasks)for(const config of Object.values(next.tasks))for(const key of ['parentPropertyId','childrenPropertyId','predecessorPropertyId','successorPropertyId','datePropertyId'])if(config[key])config[key]=mapped(config[key]);
    if(next.kind==='view'){
      if(['relation','person','files'].includes(originals.get(old.config.groupBy)?.type))for(const key of ['hiddenGroups','groupOrder'])if(next.config[key])next.config[key]=next.config[key].map(key=>JSON.stringify(JSON.parse(key)==null?null:mapped(JSON.parse(key))));
      for(const key of ['groupBy','subgroupBy','datePropertyId','endDatePropertyId','placePropertyId','previewPropertyId'])if(next.config[key])next.config[key]=mapped(next.config[key]);
      for(const key of ['visibleProperties','frozenProperties','widgets'])if(next.config[key])next.config[key]=next.config[key].map(mapped);
      if(next.config.columnAggregations)next.config.columnAggregations=Object.fromEntries(Object.entries(next.config.columnAggregations).map(([id,op])=>[mapped(id),op]));
      if(next.config.sorts)next.config.sorts=next.config.sorts.map(s=>({...s,propertyId:mapped(s.propertyId)}));
      if(next.config.form?.coverAttachmentId)next.config.form.coverAttachmentId=originals.has(next.config.form.coverAttachmentId)?mapped(next.config.form.coverAttachmentId):null;
      if(next.config.chart){next.config.chart.groupBy=mapped(next.config.chart.groupBy);if(next.config.chart.valuePropertyId)next.config.chart.valuePropertyId=mapped(next.config.chart.valuePropertyId);}
      const filter=node=>{if(!node)return;if(node.all||node.any)(node.all??node.any).forEach(filter);else if(node.not)filter(node.not);else{if(originals.get(node.propertyId)?.type==='relation'&&node.value!=null)node.value=Array.isArray(node.value)?node.value.map(mapped):mapped(node.value);node.propertyId=mapped(node.propertyId)}};filter(next.config.filter);
      // Dashboards: their rows of widgets, per-source filters and the shared filter.
      if(next.config.dashboardRows)next.config.dashboardRows=next.config.dashboardRows.map(row=>row.map(mapped));
      if(next.config.dashboardFilters)next.config.dashboardFilters=Object.fromEntries(Object.entries(next.config.dashboardFilters).map(([sourceId,node])=>{filter(node);return[mapped(sourceId),node]}));
      if(next.config.dashboardShared){filter(next.config.dashboardShared.filter);next.config.dashboardShared.sourceId=mapped(next.config.dashboardShared.sourceId);}
      if(next.config.dashboardSizes)next.config.dashboardSizes=Object.fromEntries(Object.entries(next.config.dashboardSizes).map(([widget,size])=>[mapped(widget),size]));
    }
    if(next.recurrence)next.recurrence.enabled=false;
    if(next.kind==='attachment'){
      const raw=bundle.blobs?.[next.sha256],bytes=typeof raw==='string'?Buffer.from(raw,'base64'):null;
      // A large ZIP's files were unpacked into the blob store one by one before the pages were made (archive-import.mjs).
      if(raw===undefined&&context.workspace?.hasBlob(next.sha256,next.bytes)){}
      else {requireThat(bytes&&bytes.toString('base64')===raw&&bytes.length===next.bytes&&createHash('sha256').update(bytes).digest('hex')===next.sha256,'IMPORT_ATTACHMENT','첨부 bytes 또는 해시가 맞지 않습니다.');if(!context.preview)context.workspace.putBlob(bytes);}
    }
    const added=add(state,next,context);added.alive=old.alive!==false;
  }
  for(const old of bundle.objects)if(old.kind==='property'&&old.type==='formula'){
    const property=state.get(mapped(old.id));property.ast=compileFormula(old.formula,ref=>{const candidates=bundle.objects.filter(o=>o.kind==='property'&&o.sourceId===old.sourceId&&(o.id===ref||o.name===ref));return candidates.length===1?mapped(candidates[0].id):null},(relationId,ref)=>{const candidates=properties(state,state.get(relationId)?.targetSourceId).filter(p=>p.id===(Object.hasOwn(idMap,ref)?idMap[ref]:ref)||p.name===ref);return candidates.length===1?candidates[0].id:null});property.formula=formatFormula(property.ast);
  }
  for(const old of bundle.objects)if(old.kind==='page')for(const [key,values]of Object.entries(state.get(mapped(old.id)).values)){const property=state.get(key);if(property?.type==='relation'&&property.inversePropertyId)for(const targetId of values??[]){const target=state.get(targetId);requireThat(target?.kind==='page','IMPORT_EXTERNAL','관계 대상이 없습니다.');target.values[property.inversePropertyId]=[...new Set([...(target.values[property.inversePropertyId]??[]),mapped(old.id)])]}}
  context.copies.push({originalId:bundle.rootId,copyId:mapped(bundle.rootId),idMap});
}
