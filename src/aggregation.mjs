import {requireThat} from './contracts.mjs';
import {isEmpty} from './formula.mjs';
export function aggregate(values,operation) {
  const present=values.filter(v=>!isEmpty(v)),total=values.length;
  requireThat(!values.some(v=>v?.error),'AGGREGATE_INPUT','집계 입력에 계산 오류가 있습니다.');
  if(operation==='values')return values;
  if(operation==='unique')return [...new Map(values.map(v=>[JSON.stringify(v),v])).values()];
  if(operation==='count')return total;
  if(operation==='count_nonempty')return present.length;
  if(operation==='count_empty')return total-present.length;
  if(operation==='percent_empty')return total?(total-present.length)/total:0;
  if(operation==='percent_not_empty')return total?present.length/total:0;
  if(['checked','unchecked','percent_checked','percent_unchecked'].includes(operation)){
    requireThat(present.every(v=>typeof v==='boolean'),'ROLLUP_TYPE','체크박스 집계에는 체크박스 값이 필요합니다.');const checked=present.filter(v=>v===true).length,count=operation.includes('unchecked')?total-checked:checked;return operation.startsWith('percent_')?total?count/total:0:count;
  }
  if(['earliest_date','latest_date','date_range'].includes(operation)){
    requireThat(present.every(v=>typeof v?.start==='string'&&Number.isFinite(Date.parse(v.start))),'ROLLUP_TYPE','날짜 집계에는 날짜 값이 필요합니다.');if(!present.length)return null;
    const first=[...present].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0],last=[...present].sort((a,b)=>Date.parse(b.end??b.start)-Date.parse(a.end??a.start))[0];
    return operation==='earliest_date'?{start:first.start}:operation==='latest_date'?{start:last.end??last.start}:{start:first.start,end:last.end??last.start};
  }
  requireThat(present.every(v=>typeof v==='number'&&Number.isFinite(v)),'ROLLUP_TYPE','숫자 집계에는 숫자 값이 필요합니다.');
  const sum=present.reduce((a,b)=>a+b,0);if(operation==='sum')return sum;if(operation==='average')return present.length?sum/present.length:null;if(!present.length)return null;
  if(operation==='range')return Math.max(...present)-Math.min(...present);
  if(operation==='median'){const a=[...present].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;}
  return operation==='min'?Math.min(...present):Math.max(...present);
}
