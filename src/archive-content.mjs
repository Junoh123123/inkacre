// ZIP inputs are parsed in memory. Paths are never extracted to the filesystem.
import {inflateRawSync} from 'node:zlib';import {createHash,randomUUID} from 'node:crypto';import {zipSync} from 'fflate';import path from 'node:path';
import {requireThat,inlineImageTypes,bundleFormat,isBundleFile} from './contracts.mjs';
export const importObjectLimit=100000;import {markdownImport,htmlOperations} from './html-content.mjs';
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}return (crc^0xffffffff)>>>0}
export function normalized(name){name=name.replaceAll('\\','/');requireThat(name&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.split('/').includes('..')&&!name.includes('\0'),'ZIP_PATH','ZIP 경로가 안전하지 않습니다.');return path.posix.normalize(name)}
export function readZip(base64){
 const bytes=Buffer.from(base64,'base64');requireThat(bytes.toString('base64')===base64&&bytes.length<=16*1024*1024,'ZIP_INPUT','16MiB 이하의 ZIP base64가 필요합니다.');let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break}
 requireThat(end>=0,'ZIP_FORMAT','ZIP 종료 정보를 찾을 수 없습니다.');const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 requireThat(bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&count<=2000&&count===bytes.readUInt16LE(end+8)&&offset+size<=end,'ZIP_LIMIT','다중 디스크/ZIP64 또는 너무 큰 ZIP은 지원하지 않습니다.');
 const files=new Map();let pos=offset,total=0;
 for(let i=0;i<count;i++){
  requireThat(pos+46<=bytes.length&&bytes.readUInt32LE(pos)===0x02014b50,'ZIP_FORMAT','ZIP 파일 목록이 잘못됐습니다.');const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),crc=bytes.readUInt32LE(pos+16),compressed=bytes.readUInt32LE(pos+20),length=bytes.readUInt32LE(pos+24),nameLength=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),local=bytes.readUInt32LE(pos+42);total+=length;
  requireThat(!(flags&1)&&[0,8].includes(method)&&length<=16*1024*1024&&total<=32*1024*1024&&pos+46+nameLength+extra+comment<=bytes.length,'ZIP_LIMIT','암호화·압축 방식 또는 압축 해제 크기 제한을 확인하세요.');
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+nameLength))}catch{requireThat(false,'ZIP_ENCODING','UTF-8 파일명이 필요합니다.')}name=normalized(name);pos+=46+nameLength+extra+comment;if(name.endsWith('/'))continue;
  requireThat(!files.has(name)&&((bytes.readUInt32LE(pos-(46+nameLength+extra+comment)+38)>>>16)&0xf000)!==0xa000,'ZIP_PATH','중복 경로/심볼릭 링크는 허용하지 않습니다.');
  requireThat(local+30<=offset&&bytes.readUInt32LE(local)===0x04034b50,'ZIP_FORMAT','ZIP 파일 헤더를 확인하세요.');const dataStart=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);requireThat(dataStart+compressed<=offset,'ZIP_FORMAT','ZIP 파일 범위를 확인하세요.');let data;
  try{data=method===0?bytes.subarray(dataStart,dataStart+compressed):inflateRawSync(bytes.subarray(dataStart,dataStart+compressed),{maxOutputLength:Math.min(length+1,16*1024*1024+1)})}catch{requireThat(false,'ZIP_DATA','압축 해제에 실패했습니다.')}
  requireThat(data.length===length&&crc32(data)===crc,'ZIP_DATA','ZIP 파일 크기/CRC가 맞지 않습니다.');files.set(name,Buffer.from(data));
 }
 return files;
}
const mime=name=>({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',pdf:'application/pdf',txt:'text/plain',svg:'image/svg+xml',csv:'text/csv',json:'application/json'})[name.split('.').at(-1).toLowerCase()]??'application/octet-stream';
export function planArchive(base64,title,parseCsv,uploaded=()=>null){
 const files=readZip(base64),exact=[...files].find(([name])=>isBundleFile(name));
 if(exact){let bundle;try{bundle=JSON.parse(exact[1].toString('utf8'))}catch{requireThat(false,'IMPORT_JSON','묶음 JSON 형식을 확인하세요.')}return {bundle,warnings:['구조 보존 묶음으로 복원합니다. 반복 템플릿은 일시 중지합니다.']}}
 const documents=new Map(),attachments=new Map();
 for(const [name,data]of files){if(isDocument(name))documents.set(name,data.toString('utf8'));else attachments.set(name,{data,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length})}
 return planArchiveFiles({documents,attachments,title,parseCsv,uploaded});
}
export const isDocument=name=>/\.(?:md|markdown|html?|csv)$/i.test(name);
// The pages of an archive: each Markdown, HTML or CSV document a page (a CSV a database), a document's folder of the
// same name its subpages, links between documents and to files kept as page links and attachments. Files no document
// shows go on the page of their folder (a folder with no document of its name becomes a page of its own), as image,
// video, audio, PDF or file blocks. attachments: path → { data?, sha256, bytes, mediaType? } — without data, the
// bytes are already in the blob store (a large ZIP, unpacked file by file).
export function planArchiveFiles({documents,attachments,title,parseCsv,uploaded=()=>null}){
 const rootId=randomUUID(),objects=[{id:rootId,kind:'page',title,parentId:null,sourceId:null,values:{},template:false}],pages=new Map(),attachmentIds=new Map(),blobs={},operations=[],used=new Set(),folders=new Map();
 const titleOf=name=>path.posix.basename(name).replace(/\.(?:md|markdown|html?|csv)$/i,'').replace(/ [a-f0-9]{32}$/i,'');
 for(const [name,file]of attachments){const id=randomUUID();attachmentIds.set(name,id);if(file.data)blobs[file.sha256]=Buffer.from(file.data).toString('base64');objects.push({id,kind:'attachment',name:path.posix.basename(name),mediaType:file.mediaType??mime(name),sha256:file.sha256,bytes:file.bytes})}
 for(const name of documents.keys())pages.set(name,randomUUID());
 const documentOf=dir=>{for(const ext of ['.md','.markdown','.html','.htm','.csv'])if(pages.has(dir+ext))return pages.get(dir+ext);return null};
 // A folder's page: the document of its name, or a page made for the folder (inside its own parent's).
 const folderPage=dir=>{if(dir==='.'||dir==='')return rootId;const own=documentOf(dir);if(own)return own;if(folders.has(dir))return folders.get(dir);const id=randomUUID();folders.set(dir,id);objects.push({id,kind:'page',title:path.posix.basename(dir),parentId:folderPage(path.posix.dirname(dir)),sourceId:null,values:{},template:false});return id};
 const parentOf=name=>folderPage(path.posix.dirname(name));
 const resolve=(file,url)=>{if(!url)return null;if(/^\/api\/attachments\//.test(url))return uploaded(url);let value;try{value=decodeURIComponent(url.split('#')[0])}catch{return null}if(/^[a-z][a-z\d+.-]*:/i.test(value))return null;const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),value));if(pages.has(target))return {pageId:pages.get(target)};if(attachmentIds.has(target)){used.add(target);return {attachmentId:attachmentIds.get(target),mediaType:attachments.get(target).mediaType??mime(target)}}return null};
 for(const [name,id]of pages){const data=documents.get(name),parentId=parentOf(name);objects.push({id,kind:'page',title:titleOf(name),parentId,sourceId:null,values:{},template:false});
  if(/\.csv$/i.test(name)){const [headers=[],...rows]=parseCsv(data),sourceId=randomUUID(),schema=(headers.length?headers:['Name']).map((name,i)=>({id:randomUUID(),kind:'property',name:name||`Column ${i+1}`,type:i?'text':'title',sourceId,parentId:sourceId}));objects.push({id:sourceId,kind:'source',name:titleOf(name),parentId:id,counter:rows.length},...schema);rows.forEach((row,index)=>objects.push({id:randomUUID(),kind:'page',title:row[0]??'',parentId:sourceId,sourceId,values:Object.fromEntries(schema.slice(1).map((p,i)=>[p.id,row[i+1]??''])),template:false,uniqueId:index+1}));}
  else operations.push(...(/\.html?$/i.test(name)?htmlOperations(data,id,url=>resolve(name,url)):markdownImport(data,id,url=>resolve(name,url))));
 }
 const kindOf=type=>inlineImageTypes.includes(type)?'image':type?.startsWith('video/')?'video':type?.startsWith('audio/')?'audio':type==='application/pdf'?'pdf':'file';
 for(const [name,file]of attachments)if(!used.has(name))operations.push({type:'block.create',id:randomUUID(),parentId:parentOf(name),blockType:kindOf(file.mediaType??mime(name)),richText:[],attachmentId:attachmentIds.get(name)});
 const positions=new Map();for(const operation of operations){const {type,...block}=operation,position=positions.get(block.parentId)??0;positions.set(block.parentId,position+1);objects.push({...block,kind:'block',position})}
 requireThat(objects.length>1,'IMPORT_EMPTY','가져올 문서나 파일이 없는 ZIP입니다.');requireThat(objects.length<=importObjectLimit,'IMPORT_LIMIT','한 번에 가져오기에는 항목이 너무 많습니다. ZIP을 나눠 주세요.');
 return {bundle:{format:bundleFormat,version:1,rootId,objects,blobs},warnings:['ZIP의 본문·표·페이지 연결·첨부를 가져옵니다. CSV의 원래 속성 유형/수식/관계 정의는 파일에 없으므로 제목/텍스트로 보존합니다. DB 설정을 임의로 추정하지 않습니다.']};
}
export function zipBundle(bundle){const files={'workspace.pageyard.json':Buffer.from(JSON.stringify(bundle))};for(const item of bundle.readable??[])files[`page-${item.name}`]=Buffer.from(item.text);for(const file of bundle.objects.filter(o=>o.kind==='attachment'))files[`attachment-${file.id}`]=Buffer.from(bundle.blobs[file.sha256],'base64');return Buffer.from(zipSync(files,{level:6})).toString('base64')}
