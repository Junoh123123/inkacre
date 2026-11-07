import {readFileSync} from 'node:fs';
// Disposable synthetic functional handoff fixture; never opens the main data folder.
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {deflateSync} from 'node:zlib';import {Workspace} from '../src/workspace.mjs';import {createLocalServer} from '../src/server.mjs';
function png(red, green, blue) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), footer = Buffer.alloc(4); header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, footer]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(160); header.writeUInt32BE(80, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(80 * (160 * 3 + 1));
  for (let y = 0; y < 80; y++) for (let x = 0; x < 160; x++) {
    const at = y * 481 + 1 + x * 3; pixels.set([red, green, blue], at);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const directory=mkdtempSync(path.join(tmpdir(),'pageyard-handoff-ui-')),workspace=new Workspace(directory),image=workspace.putBlob(png(70,160,100));
workspace.execute({id:'handoff-fixture',actor:'fixture',expectedRevision:0,operations:[
 {type:'page.create',id:'handoff-root',title:'기능 인계 검증 · 격리 합성 자료'},
 {type:'page.create',id:'handoff-editor',parentId:'handoff-root',title:'본문 기능 검증'},
 {type:'page.create',id:'handoff-target',parentId:'handoff-root',title:'이동 대상'},
 {type:'attachment.register',id:'handoff-image',name:'생성 녹색.png',mediaType:'image/png',...image},
 {type:'page.update',id:'handoff-editor',coverAttachmentId:'handoff-image'},
 {type:'source.create',id:'handoff-work',pageId:'handoff-root',name:'합성 업무',titlePropertyId:'handoff-name'},
 {type:'property.create',id:'handoff-status',sourceId:'handoff-work',name:'상태',propertyType:'status',options:[{id:'open',name:'진행'},{id:'done',name:'완료'}]},
 {type:'property.create',id:'handoff-number',sourceId:'handoff-work',name:'수치',propertyType:'number',numberFormat:{style:'currency',currency:'KRW',digits:0}},
 {type:'property.create',id:'handoff-done',sourceId:'handoff-work',name:'체크',propertyType:'checkbox'},
 {type:'property.create',id:'handoff-date',sourceId:'handoff-work',name:'일정',propertyType:'date'},
 {type:'property.create',id:'handoff-files',sourceId:'handoff-work',name:'첨부',propertyType:'files'},
 {type:'property.create',id:'handoff-link',sourceId:'handoff-work',name:'연결',propertyType:'relation',targetSourceId:'handoff-work',inverse:{id:'handoff-back',name:'역연결'},displayProperties:['handoff-name','handoff-number']},
 {type:'property.create',id:'handoff-button',sourceId:'handoff-work',name:'완료 버튼',propertyType:'button',button:{label:'업무 완료',confirmation:'이 항목을 완료로 바꿉니다.',actions:[{action:'set_property',propertyId:'handoff-done',value:true},{action:'set_property',propertyId:'handoff-status',value:'done'},{action:'notify',message:'합성 버튼 실행 완료'}]}},
 {type:'page.create',id:'handoff-a',sourceId:'handoff-work',title:'A 설계'},
 {type:'page.create',id:'handoff-b',sourceId:'handoff-work',title:'B 제작'},
 {type:'page.create',id:'handoff-template',sourceId:'handoff-work',template:true,title:'업무 기본 템플릿'},
 {type:'block.create',id:'handoff-template-body',parentId:'handoff-template',richText:[{text:'템플릿 원문'}]},
 ...[['handoff-a','open',false,1000,'23','24'],['handoff-b','done',true,2500,'25','26']].flatMap(([pageId,status,done,number,start,end])=>[
 {type:'value.set',pageId,propertyId:'handoff-status',value:status},{type:'value.set',pageId,propertyId:'handoff-done',value:done},{type:'value.set',pageId,propertyId:'handoff-number',value:number},{type:'value.set',pageId,propertyId:'handoff-date',value:{start:`2026-10-${start}`,end:`2026-10-${end}`,timeZone:'Asia/Tokyo'}}]),
 {type:'value.set',pageId:'handoff-a',propertyId:'handoff-files',value:['handoff-image']},
 {type:'page.update',id:'handoff-a',coverAttachmentId:'handoff-image'},
 {type:'relation.set',pageId:'handoff-a',propertyId:'handoff-link',targetIds:['handoff-b']},
 {type:'view.create',id:'handoff-table',sourceId:'handoff-work',parentId:'handoff-root',name:'표 기능',config:{visibleProperties:['handoff-name','handoff-status','handoff-number','handoff-done','handoff-button'],columnAggregations:{'handoff-number':'sum','handoff-done':'percent_checked'},frozenProperties:['handoff-name']}},
 {type:'view.create',id:'handoff-board',sourceId:'handoff-work',parentId:'handoff-root',name:'보드 기능',viewType:'board',config:{groupBy:'handoff-status',subgroupBy:'handoff-done',visibleProperties:['handoff-name','handoff-number']}},
 {type:'view.create',id:'handoff-calendar',sourceId:'handoff-work',parentId:'handoff-root',name:'주 달력',viewType:'calendar',config:{datePropertyId:'handoff-date',calendarMode:'week'}},
 {type:'view.create',id:'handoff-timeline',sourceId:'handoff-work',parentId:'handoff-root',name:'일정 이동',viewType:'timeline',config:{datePropertyId:'handoff-date'}},
 {type:'view.create',id:'handoff-gallery',sourceId:'handoff-work',parentId:'handoff-root',name:'이미지 카드',viewType:'gallery',config:{galleryPreview:'files',previewPropertyId:'handoff-files',visibleProperties:['handoff-name']}},
 {type:'view.create',id:'handoff-chart',sourceId:'handoff-work',parentId:'handoff-root',name:'선 그래프',viewType:'chart',config:{chart:{groupBy:'handoff-status',aggregation:'sum',valuePropertyId:'handoff-number',type:'line'}}},
 {type:'block.create',id:'handoff-heading',parentId:'handoff-editor',blockType:'heading1',richText:[{text:'본문 기능'}]},
 {type:'block.create',id:'handoff-paragraph',parentId:'handoff-editor',richText:[{text:'원문 유지: 시작 텍스트'}]},
 {type:'block.create',id:'handoff-paste',parentId:'handoff-editor',richText:[{text:'붙여넣기 자리'}]},
 {type:'block.create',id:'handoff-simple-table',parentId:'handoff-editor',blockType:'table',cells:[[[{text:'이름'}],[{text:'값'}]],[[{text:'원문'}],[{text:'10'}]]],tableHeader:{row:true,column:false}},
 {type:'block.create',id:'handoff-columns',parentId:'handoff-editor',blockType:'columns'},
 {type:'block.create',id:'handoff-math',parentId:'handoff-editor',blockType:'math',richText:[{text:'\\frac{a}{b} = 2'}]},
 {type:'block.create',id:'handoff-toc',parentId:'handoff-editor',blockType:'toc'},
 {type:'block.create',id:'handoff-blank',parentId:'handoff-editor',richText:[]},
 {type:'block.create',id:'handoff-page-button',parentId:'handoff-editor',blockType:'button',button:{label:'본문 추가',actions:[{action:'insert_blocks',position:'below',blocks:[{blockType:'paragraph',richText:[{text:'버튼으로 추가한 실제 본문'}]}]}]}},
]});
const columns=workspace.get('handoff-columns').entity.children;
workspace.execute({id:'handoff-column-content',actor:'fixture',expectedRevision:workspace.revision,operations:columns.map((c,i)=>({type:'block.create',id:`handoff-column-${i}`,parentId:c.id,richText:[{text:`${i+1}단 원문`}]}))});
const clip=workspace.putBlob(readFileSync('verification/recovery-2026-10-23/synthetic.webm'));
workspace.execute({id:'recovery-extra',actor:'fixture',expectedRevision:workspace.revision,operations:[
 {type:'attachment.register',id:'recovery-video',name:'합성 영상.webm',mediaType:'video/webm',...clip},
 {type:'block.create',id:'recovery-video-block',parentId:'handoff-editor',blockType:'video',attachmentId:'recovery-video'},
 {type:'block.create',id:'recovery-code',parentId:'handoff-editor',blockType:'code',language:'javascript',richText:[{text:'const value = 25; // 원문'}]},
 {type:'block.create',id:'recovery-ime',parentId:'handoff-editor',richText:[]},
 {type:'property.create',id:'recovery-formula',sourceId:'handoff-work',name:'서식 수식',propertyType:'formula',formula:'style(format(prop("수치")), "b", "blue")'},
 {type:'view.update',id:'handoff-table',config:{visibleProperties:['handoff-name','handoff-status','handoff-number','handoff-button','recovery-formula']}},
]});
const server=createLocalServer(workspace);server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/?id=handoff-table`,directory,revision:workspace.revision,synthetic:true})));
const stop=()=>{server.closeEventStreams();server.close(()=>{workspace.close();rmSync(directory,{recursive:true,force:true});process.exit(0)})};process.on('SIGINT',stop);process.on('SIGTERM',stop);
