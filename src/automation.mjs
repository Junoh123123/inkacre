import { requireThat } from './contracts.mjs';

export function zonedInstant(local, timeZone, allowGap = false) {
  let result = Date.parse(`${local}:00Z`);
  const attempted = [];
  requireThat(Number.isFinite(result), 'SCHEDULE_DATE', '유효한 반복 시작 날짜·시각을 입력하세요.');
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 5; i++) {
    attempted.push(result);
    const p = Object.fromEntries(format.formatToParts(new Date(result)).map(part => [part.type, part.value]));
    const shown = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, delta = Date.parse(`${local}:00Z`) - Date.parse(`${shown}:00Z`);
    if (!delta) return new Date(result).toISOString();
    result += delta;
  }
  if (allowGap) return new Date(Math.max(...attempted.slice(-2))).toISOString();
  requireThat(false, 'SCHEDULE_DST_GAP', '이 시간대에 존재하지 않는 시각입니다. 다른 시작 시각을 선택하세요.');
}
export function occurrence(rule, index) {
  const original = new Date(`${rule.start}:00Z`), next = new Date(original), step = rule.interval * index;
  requireThat(Number.isFinite(original.getTime()), 'SCHEDULE_DATE', '존재하는 반복 시작 날짜를 입력하세요.');
  requireThat(original.toISOString().slice(0,16) === rule.start, 'SCHEDULE_DATE', '존재하는 반복 시작 날짜를 입력하세요.');
  if (rule.frequency === 'day' || rule.frequency === 'week') next.setUTCDate(next.getUTCDate() + step * (rule.frequency === 'week' ? 7 : 1));
  else {
    next.setUTCDate(1);
    if (rule.frequency === 'month') next.setUTCMonth(next.getUTCMonth() + step); else next.setUTCFullYear(next.getUTCFullYear() + step);
    const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(original.getUTCDate(), last));
  }
  return zonedInstant(next.toISOString().slice(0,16), rule.timeZone, index > 0);
}
export function reminderDue(state, reminder) {
  if (!reminder.datePropertyId) return reminder.at;
  if (!state.get(reminder.datePropertyId)?.alive) return null;
  const value = state.get(reminder.parentId)?.values?.[reminder.datePropertyId]; if (!value) return null;
  const at = value.start.length === 10 ? zonedInstant(`${value.start}T09:00`, value.timeZone ?? 'UTC') : value.start;
  return new Date(Date.parse(at) - reminder.offsetMinutes * 60000).toISOString();
}
export function plannedAutomations(state, at, isVisible) {
  const jobs = [];
  for (const item of state.values()) {
    if (!isVisible(state, item.id)) continue;
    if (item.kind === 'page' && item.template && item.recurrence?.enabled && Date.parse(item.recurrence.nextAt) <= Date.parse(at)) jobs.push({ type: 'repeat', id: item.id });
    if (item.kind === 'automation' && item.enabled && item.schedule?.nextAt && Date.parse(item.schedule.nextAt) <= Date.parse(at)) jobs.push({ type: 'automation', id: item.id });
    if (item.kind === 'reminder') {
      const due = reminderDue(state, item);
      if (due && Date.parse(due) <= Date.parse(at) && item.deliveredFor !== due) jobs.push({ type: 'reminder', id: item.id, due });
    }
  }
  return jobs;
}

// Automation schedules: every N days · weekdays · weeks · months · years from the start, local to the time zone,
// until the end date (inclusive) if there is one.
const weekdayOf = (at, timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(at));
export function automationOccurrence(schedule, index) {
  const rule = { frequency: schedule.frequency === 'weekday' ? 'day' : schedule.frequency, interval: schedule.frequency === 'weekday' ? 1 : schedule.interval, start: schedule.start, timeZone: schedule.timeZone };
  if (schedule.frequency !== 'weekday') return occurrence(rule, index);
  let day = 0, seen = -1, at = occurrence(rule, 0);
  for (; day < 100000; day++) { at = occurrence(rule, day); if (!['Sat', 'Sun'].includes(weekdayOf(at, schedule.timeZone)) && ++seen === index) break; }
  return at;
}
export function scheduleEnded(schedule, at) {
  if (!schedule.end || !at) return false;
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  return local > schedule.end;
}
