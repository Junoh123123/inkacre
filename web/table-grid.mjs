export function cellRange(rows,columns,start,end) {
  const [r1,c1]=start,[r2,c2]=end,a=rows.indexOf(r1),b=rows.indexOf(r2),x=columns.indexOf(c1),y=columns.indexOf(c2);
  if([a,b,x,y].some(i=>i<0))throw new Error('표에서 선택한 범위를 찾을 수 없습니다.');
  return rows.slice(Math.min(a,b),Math.max(a,b)+1).flatMap(row=>columns.slice(Math.min(x,y),Math.max(x,y)+1).map(column=>JSON.stringify([row,column])));
}
export function clipboardRows(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c;continue}if(c==='"'&&!cell){quoted=true;continue}if(c==='\t'){row.push(cell);cell=''}else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;rows.push([...row,cell]);row=[];cell=''}else cell+=c}
  if(quoted)throw new Error('붙여넣을 셀의 따옴표를 확인하세요.');if(cell||row.length)rows.push([...row,cell]);return rows;
}
export function pastedValue(text,property,objects=new Map()) {
  if(['title','text','url','email','phone'].includes(property.type))return text;
  if(text==='')return null;
  if(property.type==='number'){const value=Number(text.replaceAll(',','').replace(/^[₩$€£¥]\s*/,''));if(!Number.isFinite(value))throw new Error(`${property.name}: 숫자를 입력하세요.`);return value;}
  if(property.type==='checkbox'){if(!['true','false','1','0','yes','no','예','아니요'].includes(text.toLowerCase()))throw new Error(`${property.name}: 체크 값을 확인하세요.`);return ['true','1','yes','예'].includes(text.toLowerCase());}
  if(property.type==='date'){try{const parsed=JSON.parse(text);if(parsed?.start)return parsed}catch{}if(!Number.isFinite(Date.parse(text)))throw new Error(`${property.name}: 날짜를 확인하세요.`);return {start:text};}
  if(['select','status','multi_select','relation','person'].includes(property.type)){
    const values=text.split(',').map(s=>s.trim());if(property.type==='person')return values;
    const options=property.type==='relation'?[...objects.values()].filter(o=>o.kind==='page'&&o.alive&&!o.template&&o.sourceId===property.targetSourceId).map(o=>({id:o.id,name:o.title})):property.options??[];
    const ids=values.map(value=>{const matches=options.filter(o=>o.id===value||o.name===value);if(matches.length!==1)throw new Error(`${property.name}: ${value} 값을 유일하게 찾을 수 없습니다.`);return matches[0].id});return ['select','status'].includes(property.type)?ids[0]:ids;
  }
  throw new Error(`${property.name} 속성은 범위 붙여넣기를 지원하지 않습니다.`);
}
