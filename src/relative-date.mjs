import {requireThat} from './contracts.mjs';import {zonedInstant} from './automation.mjs';
export function relativeDateRange(value,now=new Date().toISOString()) {
  requireThat(value&&typeof value==='object'&&['today','yesterday','tomorrow','this_week','last_week','next_week','this_month','last_month','next_month','past_days','next_days','this','past','next'].includes(value.period),'FILTER_RELATIVE','상대 날짜 기간을 확인하세요.');
  // "오늘 기준 상대 날짜": 이번 · 지난 · 다음 + 일 · 주 · 월 · 년 (지난/다음 with a count).
  // 이번 주 starts on the chosen week start (weekStart 0 = Sunday, 1 = Monday); 지난 N 주 runs from N weeks ago to today,
  // 다음 N 주 from today to N weeks ahead — both ends included.
  if(['this','past','next'].includes(value.period)){requireThat(['day','week','month','year'].includes(value.unit),'FILTER_RELATIVE','상대 날짜 단위를 확인하세요.');if(value.period!=='this')requireThat(Number.isInteger(value.amount)&&value.amount>=1&&value.amount<=36500,'FILTER_RELATIVE','기간 수는 1 이상이어야 합니다.');requireThat(value.weekStart===undefined||value.weekStart===0||value.weekStart===1,'FILTER_RELATIVE','주 시작 요일을 확인하세요.');}
  const zone=value.timeZone??'UTC';try{new Intl.DateTimeFormat('en',{timeZone:zone}).format(new Date(now));}catch{requireThat(false,'FILTER_RELATIVE','유효한 날짜와 IANA 시간대를 지정하세요.');}const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  let start=new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`),end=new Date(start);const period=value.period;
  const shift=(date,unit,count)=>{if(unit==='day')date.setUTCDate(date.getUTCDate()+count);else if(unit==='week')date.setUTCDate(date.getUTCDate()+7*count);else if(unit==='month')date.setUTCMonth(date.getUTCMonth()+count);else date.setUTCFullYear(date.getUTCFullYear()+count);};
  if(period==='this'){const unit=value.unit;if(unit==='week'){const offset=value.weekStart===0?start.getUTCDay():(start.getUTCDay()+6)%7;start.setUTCDate(start.getUTCDate()-offset);}else if(unit==='month')start.setUTCDate(1);else if(unit==='year'){start.setUTCMonth(0,1);}end=new Date(start);shift(end,unit,1);}
  else if(period==='past'){end.setUTCDate(end.getUTCDate()+1);shift(start,value.unit,-value.amount);}
  else if(period==='next'){shift(end,value.unit,value.amount);end.setUTCDate(end.getUTCDate()+1);}
  else if(period.includes('week')){const monday=(start.getUTCDay()+6)%7;start.setUTCDate(start.getUTCDate()-monday+(period==='last_week'?-7:period==='next_week'?7:0));end=new Date(start);end.setUTCDate(end.getUTCDate()+7);}
  else if(period.includes('month')){start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()+(period==='last_month'?-1:period==='next_month'?1:0));end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);}
  else if(period.endsWith('days')){requireThat(Number.isInteger(value.amount)&&value.amount>=1&&value.amount<=36500,'FILTER_RELATIVE','기간 일수는 1 이상이어야 합니다.');if(period==='past_days')start.setUTCDate(start.getUTCDate()-value.amount+1);end.setUTCDate(end.getUTCDate()+(period==='next_days'?value.amount:1));}
  else {const delta=period==='yesterday'?-1:period==='tomorrow'?1:0;start.setUTCDate(start.getUTCDate()+delta);end=new Date(start);end.setUTCDate(end.getUTCDate()+1);}
  const from=start.toISOString().slice(0,10),to=end.toISOString().slice(0,10);return {from,to,start:zonedInstant(`${from}T00:00`,zone,true),end:zonedInstant(`${to}T00:00`,zone,true)};
}
export function matchesRelative(current,rule,now) {
  if(!current?.start)return false;const range=relativeDateRange(rule,now);return current.start.length===10?(current.end??current.start)>=range.from&&current.start<range.to:Date.parse(current.end??current.start)>=Date.parse(range.start)&&Date.parse(current.start)<Date.parse(range.end);
}
