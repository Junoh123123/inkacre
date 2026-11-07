const dayMs = 86400000;
export function formatNumber(value,definition={},locale='ko-KR') {return new Intl.NumberFormat(locale,{style:definition.style==='number'?'decimal':definition.style??'decimal',...(definition.style==='currency'?{currency:definition.currency??'KRW'}:{}),...(definition.digits===undefined?{}:{minimumFractionDigits:definition.digits,maximumFractionDigits:definition.digits}),useGrouping:definition.grouping??true}).format(value);}
export function displayDay(value, timeZone = 'UTC') {
  if (!value?.includes('T') || !/(Z|[+-]\d\d:\d\d)$/.test(value)) return value?.slice(0, 10);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function monthDays(month) {
  const first = new Date(`${month}-01T00:00:00Z`), start = first.getTime() - first.getUTCDay() * dayMs;
  return Array.from({ length: 42 }, (_, index) => new Date(start + index * dayMs).toISOString().slice(0, 10));
}
export function shiftMonth(month, delta) {
  const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); return date.toISOString().slice(0, 7);
}
export function onCalendarDay(item, day) {
  return displayDay(item.start, item.timeZone) <= day && displayDay(item.end ?? item.start, item.timeZone) >= day;
}
export function weekDays(date) {const first=new Date(`${date}T00:00:00Z`);first.setUTCDate(first.getUTCDate()-first.getUTCDay());return Array.from({length:7},(_,i)=>new Date(first.getTime()+i*dayMs).toISOString().slice(0,10));}
export function shiftDay(date,days){return new Date(Date.parse(date.slice(0,10))+days*dayMs).toISOString().slice(0,10);}
export function moveDateToDay(value,targetDay) {
  const zone=value.timeZone??'UTC',delta=Date.parse(targetDay)-Date.parse(displayDay(value.start,zone));
  const move=text=>{if(!text.includes('T'))return new Date(Date.parse(text)+delta).toISOString().slice(0,10);
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),p=Object.fromEntries(formatter.formatToParts(new Date(text)).map(p=>[p.type,p.value])),day=new Date(Date.parse(`${p.year}-${p.month}-${p.day}`)+delta).toISOString().slice(0,10),wanted=Date.parse(`${day}T${p.hour}:${p.minute}:${p.second}Z`);let instant=wanted,attempted=[];
    for(let i=0;i<5;i++){attempted.push(instant);const q=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value])),shown=Date.parse(`${q.year}-${q.month}-${q.day}T${q.hour}:${q.minute}:${q.second}Z`),difference=wanted-shown;if(!difference)return new Date(instant).toISOString();instant+=difference}return new Date(Math.max(...attempted.slice(-2))).toISOString();};
  return {...value,start:move(value.start),...(value.end?{end:move(value.end)}:{})};
}
export function shiftDateRange(value,amount,unit='day') {if(unit==='hour'){const move=text=>new Date(Date.parse(text)+amount*3600000).toISOString();return {...value,start:move(value.start),...(value.end?{end:move(value.end)}:{})};}return moveDateToDay(value,shiftDay(displayDay(value.start,value.timeZone),amount));}
export function timelineLayout(items,zoom='day') {
  const rows = items.map(item => ({ ...item, from: displayDay(item.start, item.timeZone), to: displayDay(item.end ?? item.start, item.timeZone) }));
  if (!rows.length) return { from: null, to: null, rows: [] };
  const first = rows.map(row => row.from).sort()[0], last = rows.map(row => row.to).sort().at(-1);
  const from = Date.parse(first), to = Date.parse(last) + dayMs, span = Math.max(to - from, dayMs);
  if(zoom==='hour'){const start=Math.floor(Math.min(...rows.map(row=>Date.parse(row.start)))/3600000)*3600000,end=Math.ceil(Math.max(...rows.map(row=>Date.parse(row.end??row.start)))/3600000)*3600000+3600000,span=end-start;return {from:first,to:last,fromMillis:start,spanMs:span,rows:rows.map(row=>({...row,start:(Date.parse(row.start)-start)/span,width:Math.max(3600000,Date.parse(row.end??row.start)-Date.parse(row.start))/span}))};}
  return { from: first, to: last,fromMillis:from,spanMs:span,rows: rows.map(row => ({ ...row, start: (Date.parse(row.from) - from) / span, width: Math.max(dayMs, Date.parse(row.to) + dayMs - Date.parse(row.from)) / span })) };
}
export function chartScale(values) {
  const finite = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  const min = Math.min(0, ...finite), max = Math.max(0, ...finite), span = max - min || 1;
  const zero = -min / span;
  return { min, max, zero, bars: values.map(value => typeof value === 'number' && Number.isFinite(value) ? { start: (Math.min(value, 0) - min) / span, width: Math.abs(value) / span } : null) };
}
export function projectPlace(point, viewport = { longitude: 0, latitude: 0, span: 360 }) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  let longitude = point.longitude - viewport.longitude;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  const x = .5 + longitude / viewport.span, y = .5 - (point.latitude - viewport.latitude) / (viewport.span / 2);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
export function moveMap(viewport, longitude = 0, latitude = 0, zoom = 1) {
  const span = Math.min(360, Math.max(1, viewport.span * zoom));
  let center = viewport.longitude + longitude; while (center > 180) center -= 360; while (center < -180) center += 360;
  return { longitude: center, latitude: Math.max(-90 + span / 4, Math.min(90 - span / 4, viewport.latitude + latitude)), span };
}
