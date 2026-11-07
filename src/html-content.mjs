import {parseFragment} from 'parse5';
import MarkdownIt from 'markdown-it';
import {randomUUID} from 'node:crypto';
import {requireThat} from './contracts.mjs';
const md=new MarkdownIt({html:true,breaks:true,linkify:false});
const attrs=node=>Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));
const text=node=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(text).join('');
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const safeUrl=value=>/^(https?:|mailto:|tel:)/i.test(value??'');
const skip=new Set(['script','style','noscript','iframe','object','embed','meta','link','head','title']);
const color=value=>/^(gray|brown|orange|yellow|green|blue|purple|pink|red|#[0-9a-fA-F]{6})$/.test(value??'')?value:undefined;
export function htmlRuns(node,resolve=()=>null,marks={}){
  if(node.nodeName==='#text')return node.value?[{text:node.value,...marks}]:[];
  if(skip.has(node.tagName))return [];if(node.tagName==='br')return [{text:'\n',...marks}];
  const next={...marks},a=attrs(node),tag=node.tagName;
  if(['strong','b'].includes(tag))next.bold=true;if(['em','i'].includes(tag))next.italic=true;if(['s','del','strike'].includes(tag))next.strike=true;if(tag==='code')next.code=true;if(tag==='u')next.underline=true;
  if(tag==='a'){const ref=resolve(a.href);if(ref?.pageId)next.pageId=ref.pageId;else if(safeUrl(a.href))next.href=a.href;}
  const style=Object.fromEntries((a.style??'').split(';').map(x=>x.split(':').map(s=>s.trim())));if(color(style.color))next.color=style.color;if(color(style['background-color']))next.background=style['background-color'];
  return (node.childNodes??[]).flatMap(n=>htmlRuns(n,resolve,next));
}
export function htmlOperations(html,parentId,resolve=()=>null){
  requireThat(typeof html==='string'&&html.length<=23*1024*1024,'IMPORT_HTML','HTML 크기를 확인하세요.');const root=parseFragment(html),operations=[];let nodes=0;
  const add=(parentId,blockType,richText=[],extra={})=>{requireThat(++nodes<=10000,'IMPORT_LIMIT','HTML 블록이 너무 많습니다.');const id=randomUUID();operations.push({type:'block.create',id,parentId,blockType,richText,...extra});return id};
  const visit=(node,parent,depth=0)=>{
    requireThat(depth<=100,'IMPORT_DEPTH','HTML 중첩이 너무 깊습니다.');if(skip.has(node.tagName))return;
    if(node.nodeName==='#text'){if(node.value.trim())add(parent,'paragraph',[{text:node.value}]);return;}
    const tag=node.tagName,a=attrs(node),children=node.childNodes??[];
    if(tag==='table'){
      const trs=[];const rows=n=>{for(const c of n.childNodes??[]){if(c.tagName==='tr')trs.push(c);else if(c.tagName!=='table')rows(c)}};rows(node);
      const cells=trs.map(tr=>(tr.childNodes??[]).filter(c=>['td','th'].includes(c.tagName)).flatMap(c=>{const count=Math.max(1,Math.min(50,Number(attrs(c).colspan)||1));return [htmlRuns(c,resolve),...Array.from({length:count-1},()=>[])]}));
      const width=Math.max(0,...cells.map(row=>row.length));requireThat(cells.length<=200&&width<=50,'IMPORT_TABLE','표는200행50열 이하여야 합니다.');if(width)add(parent,'table',[],{cells:cells.map(row=>[...row,...Array.from({length:width-row.length},()=>[])]),tableHeader:{row:(trs[0]?.childNodes??[]).some(c=>c.tagName==='th'),column:trs.length>0&&trs.every(tr=>(tr.childNodes??[]).find(c=>['td','th'].includes(c.tagName))?.tagName==='th')}});return;
    }
    if(['ul','ol'].includes(tag)){for(const li of children.filter(c=>c.tagName==='li')){const inlineChildren=(li.childNodes??[]).filter(c=>!['ul','ol'].includes(c.tagName)),container={childNodes:inlineChildren},runs=htmlRuns(container,resolve),plain=runs.map(r=>r.text).join(''),task=plain.match(/^\s*\[([ xX])\]\s*/);let rich=runs;if(task){let remove=task[0].length;rich=runs.flatMap(run=>{const n=Math.min(remove,run.text.length);remove-=n;return run.text.length>n?[{...run,text:run.text.slice(n)}]:[]})}const id=add(parent,task?'todo':tag==='ol'?'numbered':'bullet',rich,task?{checked:task[1].toLowerCase()==='x'}:{});for(const list of (li.childNodes??[]).filter(c=>['ul','ol'].includes(c.tagName)))visit(list,id,depth+1);}return;}
    if(tag==='pre'){const code=children.find(c=>c.tagName==='code'),language=(attrs(code??{}).class??'').match(/(?:language-|lang-)([\w+-]+)/)?.[1]??'';add(parent,'code',[{text:text(node).replace(/\n$/,'')}],{language});return;}
    if(tag==='hr'){add(parent,'divider');return;}
    if(['img','video','audio','a'].includes(tag)){
      const target=a.src??a.href,ref=resolve(target);if(ref?.attachmentId){add(parent,tag==='img'&&(!ref.mediaType||['image/png','image/jpeg','image/gif','image/webp','image/avif'].includes(ref.mediaType))?'image':tag==='video'?'video':tag==='audio'?'audio':'file',[{text:a.alt??a.title??text(node)}],{attachmentId:ref.attachmentId});return;}
      if(['img','video','audio'].includes(tag)){add(parent,'paragraph',[{text:a.alt??a.title??target??'',...(safeUrl(target)?{href:target}:{})}]);return;}
    }
    if(tag==='p'&&children.some(c=>c.tagName==='img'||c.tagName==='a'&&resolve(attrs(c).href)?.attachmentId)){
      let pending=[];const flush=()=>{if(pending.length)add(parent,'paragraph',pending);pending=[]};for(const c of children){if(c.tagName==='img'||c.tagName==='a'&&resolve(attrs(c).href)?.attachmentId){flush();visit(c,parent,depth+1)}else pending.push(...htmlRuns(c,resolve))}flush();return;
    }
    const block=['p','h1','h2','h3','h4','h5','h6','blockquote','summary'].includes(tag),inlineOnly=children.every(n=>!['p','div','ul','ol','table','pre','blockquote','section','article'].includes(n.tagName));
    if(block||tag==='div'&&inlineOnly){const type=/^h[1-6]$/.test(tag)?`heading${Math.min(3,Number(tag[1]))}`:tag==='blockquote'?'quote':tag==='summary'?'toggle':'paragraph';const runs=htmlRuns(node,resolve);if(runs.length)add(parent,type,runs);return;}
    for(const child of children)visit(child,parent,depth+1);
  };
  for(const node of root.childNodes??[])visit(node,parentId);return operations;
}
export function richHtml(runs){return (runs??[]).map(run=>{let out=escape(run.text).replaceAll('\n','<br>');for(const [key,tag]of [['code','code'],['bold','strong'],['italic','em'],['strike','s'],['underline','u']])if(run[key])out=`<${tag}>${out}</${tag}>`;const style=[color(run.color)&&`color:${run.color}`,color(run.background)&&`background-color:${run.background}`].filter(Boolean).join(';');if(style)out=`<span style="${style}">${out}</span>`;const url=run.href??(run.pageId?`page-${encodeURIComponent(run.pageId)}.md`:null);if(url)out=`<a href="${escape(url)}">${out}</a>`;return out}).join('')}
export function markdownImport(text,parentId,resolve){
  let fence=null;for(const line of text.replaceAll('\r\n','\n').split('\n')){const match=line.match(/^\s*(`{3,}|~{3,})(.*)$/);if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length&&!match[2].trim())fence=null;}}
  requireThat(!fence,'MARKDOWN_FENCE','닫히지 않은 코드 블록이 있습니다.');
  // Invalid remote protocols remain literal rather than executable links.
  return htmlOperations(md.render(text),parentId,resolve);
}
export function pageHtml(state,page,children){
  const visit=(id,seen=new Set())=>{if(seen.has(id))return '';seen=new Set([...seen,id]);return children(state,id).filter(b=>b.kind==='block'&&b.alive).map(b=>{const content=richHtml(b.richText),nested=visit(b.blockType==='synced_reference'?b.sourceBlockId:b.id,seen);if(b.blockType==='table')return `<table>${b.cells.map((row,r)=>`<tr>${row.map((cell,c)=>{const tag=b.tableHeader?.row&&r===0||b.tableHeader?.column&&c===0?'th':'td';return `<${tag}>${richHtml(cell)}</${tag}>`}).join('')}</tr>`).join('')}</table>`;if(b.blockType==='code')return `<pre><code class="language-${escape(b.language??'')}">${escape((b.richText??[]).map(r=>r.text).join(''))}</code></pre>`;if(b.blockType==='divider')return '<hr>';if(b.attachmentId){const file=state.get(b.attachmentId),url=`attachment-${b.attachmentId}`;return b.blockType==='image'?`<img src="${url}" alt="${escape(file?.name)}">`:b.blockType==='video'?`<video controls src="${url}"></video>`:b.blockType==='audio'?`<audio controls src="${url}"></audio>`:`<p><a href="${url}">${escape(file?.name)}</a></p>`}if(b.blockType==='breadcrumb')return '';if(b.blockType==='tabs'||b.blockType==='columns'||b.blockType==='column')return nested;if(b.blockType==='tab')return `<p><strong>${content}</strong></p>${nested}`;if(b.blockType==='bookmark'||b.blockType==='video'||b.blockType==='audio'||b.blockType==='embed')return b.url?`<p><a href="${escape(b.url)}">${content||escape(b.bookmark?.title??b.url)}</a></p>`:'';if(b.blockType==='toggle'||b.toggleable)return `<details open><summary>${content}</summary>${nested}</details>`;if(b.blockType==='callout')return `<aside class="callout">${b.icon&&!String(b.icon).startsWith('icon:')?escape(b.icon)+' ':''}${content}${nested}</aside>`;if(b.blockType==='math')return `<div class="math">${escape((b.richText??[]).map(r=>r.text).join(''))}</div>`;const tag={heading1:'h1',heading2:'h2',heading3:'h3',heading4:'h4',quote:'blockquote',code:'pre'}[b.blockType]??'p';if(['bullet','numbered','todo'].includes(b.blockType))return `<${b.blockType==='numbered'?'ol':'ul'}${b.blockType==='todo'?' class="todo"':''}><li>${b.blockType==='todo'?`<input type="checkbox" disabled${b.checked?' checked':''}> `:''}${content}${nested}</li></${b.blockType==='numbered'?'ol':'ul'}>`;return `<${tag}>${content}</${tag}>${nested}`}).join('\n')};
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(page.title)}</title></head><body><h1>${escape(page.title)}</h1>${visit(page.id)}</body></html>`;
}
