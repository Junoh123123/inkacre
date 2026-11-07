import {WorkspaceError} from './contracts.mjs';
export const extraFunctions=['style','unstyle','link','repeat','padStart','padEnd','match','replace','replaceAll','test','median','mean','ln','log10','log2','exp','cbrt','sign','pi','e','add','subtract','multiply','divide','equal','unequal','larger','largerEq','smaller','smallerEq','and','or','not','date','day','week','month','year','hour','minute','dateRange','timestamp','fromTimestamp','email','formatNumber'];
export const isText=value=>value?.type==='formatted_text'&&Array.isArray(value.richText);
export const textValue=value=>isText(value)?value.richText.map(run=>run.text).join(''):String(value??'');
const fail=(code,message)=>{throw new WorkspaceError(code,message)};
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:fail('FORMULA_TYPE','숫자 값이 필요합니다.');
const styles={b:'bold',u:'underline',i:'italic',c:'code',s:'strike'};
const colors=new Set(['gray','brown','orange','yellow','green','blue','purple','pink','red']);
function formatted(value){return isText(value)?structuredClone(value):{type:'formatted_text',richText:[{text:textValue(value)}]}}
function regex(pattern,global=false){pattern=textValue(pattern);if(pattern.length>256||(pattern.match(/(?<!\\)[+*]/g)??[]).length>1)fail('FORMULA_LIMIT','정규식이 너무 깁니다.');if(/\\[1-9]|\(\?[<!=]|\([^)]*\)[+*{]|(?:\*|\+|\{\d+,?\d*\})\s*(?:\*|\+|\{)/.test(pattern))fail('FORMULA_REGEX','재귀·역참조·중첩 반복 정규식은 지원하지 않습니다.');try{return new RegExp(pattern,global?'g':'')}catch{fail('FORMULA_REGEX','정규식을 확인하세요.')}}
export function formulaExtra(name,args){
  if(!extraFunctions.includes(name))return {handled:false};let result;const a=args[0],b=args[1],flat=args.flat();
  if(['style','unstyle','link'].includes(name)){
    const value=formatted(a);
    if(name==='link'){const url=textValue(b);let valid=false;try{valid=['https:','http:','mailto:','tel:'].includes(new URL(url).protocol)}catch{}if(!valid)fail('FORMULA_URL','안전한 링크 주소가 필요합니다.');value.richText=value.richText.map(run=>({...run,href:url}));}
    else {const marks=args.slice(1).flat().map(textValue);for(const mark of marks)if(!styles[mark]&&!colors.has(mark)&&!colors.has(mark.replace(/_background$/,'')))fail('FORMULA_STYLE','알 수 없는 서식 또는 색입니다.');value.richText=value.richText.map(run=>{const next={...run};if(name==='unstyle'&&!marks.length){for(const key of [...Object.values(styles),'color','background'])delete next[key]}for(const mark of marks){const key=styles[mark]??(mark.endsWith('_background')?'background':'color');if(name==='style')next[key]=styles[mark]?true:mark.replace(/_background$/,'');else if(styles[mark]||next[key]===mark.replace(/_background$/,''))delete next[key];}return next});}
    result=value.richText.every(run=>Object.keys(run).length===1)?textValue(value):value;
  }else if(['replace','replaceAll','test','match'].includes(name)){
    const input=textValue(a);if(input.length>16384)fail('FORMULA_LIMIT','정규식 입력이 너무 깁니다.');const r=regex(b,['match','replaceAll'].includes(name));result=name==='test'?r.test(input):name==='match'?(input.match(r)??[]):input.replace(r,textValue(args[2]));
  }else if(['repeat','padStart','padEnd'].includes(name)){
    const count=Math.trunc(numeric(b));if(count<0||count>100000||textValue(a).length*Math.max(1,count)>1000000)fail('FORMULA_LIMIT','문자열 결과가 너무 깁니다.');result=name==='repeat'?textValue(a).repeat(count):textValue(a)[name](count,textValue(args[2]??' '));
  }else if(['mean','median'].includes(name)){const list=flat.map(numeric).sort((a,b)=>a-b);result=!list.length?null:name==='mean'?list.reduce((sum,x)=>sum+x,0)/list.length:list.length%2?list[Math.floor(list.length/2)]:(list[list.length/2-1]+list[list.length/2])/2;
  }else if(['ln','log10','log2','exp','cbrt','sign'].includes(name))result=Math[name==='ln'?'log':name](numeric(a));
  else if(name==='pi'||name==='e')result=name==='pi'?Math.PI:Math.E;
  else if(['add','subtract','multiply','divide'].includes(name)){const x=numeric(a),y=numeric(b);if(name==='divide'&&!y)fail('FORMULA_DIV0','0으로 나눌 수 없습니다.');result=name==='add'?x+y:name==='subtract'?x-y:name==='multiply'?x*y:x/y;}
  else if(['equal','unequal','larger','largerEq','smaller','smallerEq'].includes(name)){result=name==='equal'?JSON.stringify(a)===JSON.stringify(b):name==='unequal'?JSON.stringify(a)!==JSON.stringify(b):name==='larger'?a>b:name==='largerEq'?a>=b:name==='smaller'?a<b:a<=b;}
  else if(['and','or','not'].includes(name))result=name==='and'?args.every(Boolean):name==='or'?args.some(Boolean):!a;
  else if(name==='email'){const email=textValue(a).match(/(?:<)?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)(?:>)?/);result=email?.[1]??'';}
  else if(name==='formatNumber'){const style=textValue(b??'number'),digits=args[2]===undefined?undefined:Math.trunc(numeric(args[2]));if(digits!==undefined&&(digits<0||digits>20))fail('FORMULA_TYPE','표시 자릿수는0~20입니다.');const currency=/^[a-z]{3}$/i.test(style)&&!['num'].includes(style)?style.toUpperCase():null;try{result=new Intl.NumberFormat('en-US',{...(style==='percent'?{style:'percent'}:currency?{style:'currency',currency}:{}),...(digits!==undefined?{minimumFractionDigits:digits,maximumFractionDigits:digits}:{})}).format(numeric(a))}catch{fail('FORMULA_TYPE','숫자 형식을 확인하세요.')}}
  else {
    if(!a?.start||!Number.isFinite(Date.parse(a.start)))fail('FORMULA_DATE','유효한 날짜가 필요합니다.');const d=new Date(a.start),zone=a.start.length===10?'UTC':a.timeZone??'UTC';
    if(name==='dateRange'){if(!b?.start||Date.parse(b.start)<d.getTime())fail('FORMULA_DATE','종료 날짜를 확인하세요.');result={...a,end:b.start};}
    else if(name==='timestamp')result=d.getTime();
    else if(name==='fromTimestamp')fail('FORMULA_TYPE','timestamp 숫자가 필요합니다.');
    else {const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));const local=new Date(Date.UTC(+p.year,+p.month-1,+p.day));if(name==='week'){local.setUTCDate(local.getUTCDate()+4-(local.getUTCDay()||7));result=Math.ceil(((local-new Date(Date.UTC(local.getUTCFullYear(),0,1)))/86400000+1)/7)}else result=name==='day'?(local.getUTCDay()||7):Number(p[name==='date'?'day':name]);}
  }
  return {handled:true,value:result};
}
