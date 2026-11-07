import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { api } from '../data/api';
import { attachFromUrl } from '../data/commands';
import { Popover } from '../ui/overlay';
import { Menu } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { Switch } from '../ui/primitives';
import { zonedMentionLabel } from './views';
import { zonedIso } from '../database/values';
import { displayTimeZone } from '../data/settings';

// Small editors for inline content (24차): a date mention's day, time, format and reminder; the menu that follows a
// pasted web address (링크 · 멘션 · 북마크 · 임베드); and the fetches behind link mentions and bookmarks — done once,
// with the site's icon and the page's picture kept as local attachments.

export interface Preview { url: string; title: string; description: string; siteName: string; image?: string | null; icon?: string | null }
export async function fetchPreview(url: string) { return api<Preview>('/api/bookmark-preview', { url }); }
const keep = (address: string | null | undefined, kind: 'image' | 'icon') => address ? attachFromUrl(address, kind).then(result => result.attachmentId).catch(() => null) : Promise.resolve(null);
// A link mention's title and icon.
export async function linkMention(url: string): Promise<{ title: string; icon: string | null; site: string | null; description: string | null }> {
  const preview = await fetchPreview(url).catch(() => null);
  const icon = await keep(preview?.icon, 'icon');
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep */ }
  return { title: preview?.title || host, icon, site: preview?.siteName?.trim() || null, description: preview?.description?.trim() || null };
}
// A bookmark's card: title, description, site, picture and icon.
export async function bookmarkFor(url: string) {
  const preview = await fetchPreview(url);
  const [imageAttachmentId, iconAttachmentId] = await Promise.all([keep(preview.image, 'image'), keep(preview.icon, 'icon')]);
  const { image: _image, icon: _icon, ...rest } = preview;
  return { ...rest, ...(imageAttachmentId ? { imageAttachmentId } : {}), ...(iconAttachmentId ? { iconAttachmentId } : {}) };
}

export type PasteChoice = 'link' | 'mention' | 'bookmark' | 'embed';
export function PasteUrlMenu({ anchor, onChoose, onClose }: { anchor: { x: number; y: number }; onChoose: (choice: PasteChoice) => void; onClose: () => void }) {
  return (
    <Menu anchor={anchor} placement="below-start" width={220} label={t("붙여넣기 방식")} onClose={onClose} className="paste-url-menu" entries={[
      { kind: 'section', label: t("붙여넣기 방식") },
      { label: t("링크로 두기"), icon: 'link', onSelect: () => onChoose('link') },
      { label: t("멘션"), icon: 'mention', hint: t("사이트 아이콘과 제목"), onSelect: () => onChoose('mention') },
      { label: t("북마크"), icon: 'bookmark', onSelect: () => onChoose('bookmark') },
      { label: t("임베드"), icon: 'embed', onSelect: () => onChoose('embed') },
    ]} />
  );
}

export interface DateAttrs { date: string; format: string | null; remind: number | null; zone: string | null }
const formats: Array<{ id: string | null; label: string }> = [
  { id: null, label: t("상대 날짜 (오늘 · 내일)") }, { id: 'full', label: t("전체 날짜") }, { id: 'short', label: t("짧은 날짜") }, { id: 'iso', label: 'YYYY-MM-DD' },
];
export const remindOptions: Array<{ minutes: number | null; label: string }> = [
  { minutes: null, label: t("없음") }, { minutes: 0, label: t("그 시각") }, { minutes: 5, label: t("5분 전") }, { minutes: 10, label: t("10분 전") }, { minutes: 30, label: t("30분 전") },
  { minutes: 60, label: t("1시간 전") }, { minutes: 1440, label: t("1일 전") }, { minutes: 2880, label: t("2일 전") }, { minutes: 10080, label: t("1주 전") },
];
const pad = (value: number) => String(value).padStart(2, '0');

// The date mention's editor: the day, an optional time, how it reads and a reminder ("리마인드").
export function DateMentionEditor({ anchor, attrs, onChange, onRemove, onClose }: { anchor: DOMRect; attrs: DateAttrs; onChange: (next: DateAttrs) => void; onRemove: () => void; onClose: () => void }) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(attrs.date);
  const [day, setDay] = useState(match?.[1] ?? '');
  const [time, setTime] = useState(match?.[2] ?? '');
  const [withTime, setWithTime] = useState(!!match?.[2]);
  const [format, setFormat] = useState<string | null>(attrs.format);
  const [remind, setRemind] = useState<number | null>(attrs.remind);
  // 시간대: empty follows this computer (the date is the wall time here); a zone keeps that zone's offset with it.
  const [zone, setZone] = useState<string>(attrs.zone ?? '');
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { return []; } }, []);
  const commit = (patch: Partial<{ day: string; time: string; withTime: boolean; format: string | null; remind: number | null; zone: string }>) => {
    const next = { day, time, withTime, format, remind, zone, ...patch };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.day)) return;
    const clock = next.withTime ? (next.time || `${pad(new Date().getHours())}:00`) : '';
    const zoned = clock && next.zone ? next.zone : null;
    onChange({ date: clock ? (zoned ? zonedIso(next.day, clock, zoned) : `${next.day}T${clock}`) : next.day, format: next.format, remind: next.remind, zone: zoned });
  };
  return (
    <Popover anchor={anchor} placement="below-start" onClose={onClose} className="date-mention-editor" style={{ width: 290 }} label={t("날짜")}>
      <div className="date-mention-body">
        <div className="date-mention-preview">{zonedMentionLabel(withTime && time ? (zone ? zonedIso(day, time, zone) : `${day}T${time}`) : day, format, withTime ? zone || null : null)}</div>
        <label className="date-mention-row"><span>{t("날짜")}</span><input type="date" className="text-input" value={day} onChange={event => { setDay(event.target.value); commit({ day: event.target.value }); }} /></label>
        <label className="date-mention-row"><span>{t("시간 포함")}</span><Switch checked={withTime} onChange={value => { setWithTime(value); const next = value ? (time || `${pad(new Date().getHours())}:00`) : time; setTime(next); commit({ withTime: value, time: next }); }} label={t("시간 포함")} /></label>
        {withTime ? <label className="date-mention-row"><span>{t("시간")}</span><input type="time" className="text-input" value={time} onChange={event => { setTime(event.target.value); commit({ time: event.target.value }); }} /></label> : null}
        <label className="date-mention-row"><span>{t("날짜 형식")}</span>
          <select className="text-input" value={format ?? ''} onChange={event => { const value = event.target.value || null; setFormat(value); commit({ format: value }); }}>
            {formats.map(item => <option key={item.id ?? 'relative'} value={item.id ?? ''}>{item.label}</option>)}
          </select>
        </label>
        <label className="date-mention-row"><span><Icon name="alarm" size={14} /> {t("리마인드")}</span>
          <select className="text-input" value={remind === null ? '' : String(remind)} onChange={event => { const value = event.target.value === '' ? null : Number(event.target.value); setRemind(value); commit({ remind: value }); }}>
            {remindOptions.map(item => <option key={item.label} value={item.minutes === null ? '' : String(item.minutes)}>{item.label}</option>)}
          </select>
        </label>
        {withTime ? <label className="date-mention-row"><span>{t("시간대")}</span>
          <select className="text-input" aria-label={t("시간대")} value={zone} onChange={event => { setZone(event.target.value); commit({ zone: event.target.value }); }}>
            <option value="">{t("자동 ({0})", [displayTimeZone()])}</option>
            {zones.map(item => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
          </select>
        </label> : null}
        <button type="button" className="text-button danger" onClick={() => { onRemove(); onClose(); }}>{t("날짜 멘션 지우기")}</button>
      </div>
    </Popover>
  );
}

// "@remind 7pm", "@remind tomorrow 3:30pm", "@리마인드 금요일 오후 2시", "@remind 11/3 9:00": the day and time a reminder
// typed after @ names. A time alone is today (tomorrow once it has passed); a day alone is 9:00 that day.
const weekdays: Array<[RegExp, number]> = [[/^(sun(day)?|일요일)$/i, 0], [/^(mon(day)?|월요일)$/i, 1], [/^(tue(s(day)?)?|화요일)$/i, 2], [/^(wed(nesday)?|수요일)$/i, 3], [/^(thu(rs(day)?)?|목요일)$/i, 4], [/^(fri(day)?|금요일)$/i, 5], [/^(sat(urday)?|토요일)$/i, 6]];
export function parseRemind(query: string, now = new Date()): { day: string; time: string } | null {
  const match = /^(?:remind(?:er)?|리마인드|알림)\s+(.+)$/i.exec(query.trim());
  if (!match) return null;
  let rest = match[1].trim().toLocaleLowerCase(), day: string | null = null, time: string | null = null;
  const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const shift = (days: number) => { const date = new Date(now); date.setDate(date.getDate() + days); return iso(date); };
  // The time: 7pm · 7:30 pm · 19:00 · 오후 7시 30분 · 7시.
  const clock = /(?:^|\s)(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|시)?(?:\s*(\d{1,2})분)?$/.exec(rest);
  if (clock && (clock[1] || clock[3] || clock[4])) {
    let hour = Number(clock[2]); const minute = Number(clock[3] ?? clock[5] ?? 0);
    const pm = clock[4] === 'pm' || clock[1] === '오후', am = clock[4] === 'am' || clock[1] === '오전';
    if (pm && hour < 12) hour += 12; if (am && hour === 12) hour = 0;
    // "3시" with neither 오전 nor 오후 reads as the afternoon (1–6시), as people say it.
    if (!pm && !am && clock[4] === '시' && hour >= 1 && hour <= 6) hour += 12;
    if (hour <= 23 && minute <= 59) { time = `${pad(hour)}:${pad(minute)}`; rest = rest.slice(0, clock.index).trim(); }
  }
  if (rest) {
    if (/^(today|오늘)$/.test(rest)) day = shift(0);
    else if (/^(tomorrow|tmr|내일)$/.test(rest)) day = shift(1);
    else if (/^(모레)$/.test(rest)) day = shift(2);
    else {
      const weekday = weekdays.find(([pattern]) => pattern.test(rest.replace(/^(next|다음 주?)\s*/, '')));
      if (weekday) { let ahead = (weekday[1] - now.getDay() + 7) % 7; if (ahead === 0 || /^(next|다음)/.test(rest)) ahead += ahead === 0 ? 7 : 0; day = shift(ahead || 7); }
      else day = parseTypedDate(rest, now);
    }
    if (!day) return null;
  }
  if (!day && !time) return null;
  if (!day) { const [h, m] = time!.split(':').map(Number); day = h * 60 + m > now.getHours() * 60 + now.getMinutes() ? shift(0) : shift(1); }
  return { day: day!, time: time ?? '09:00' };
}

// Days typed after @ ("2026-11-03", "11/3", "11월 3일", "3일"): the date it names, if any.
export function parseTypedDate(query: string, now = new Date()): string | null {
  const text = query.trim();
  let match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text);
  if (match) return `${match[1]}-${pad(Number(match[2]))}-${pad(Number(match[3]))}`;
  match = /^(\d{1,2})[/.](\d{1,2})$/.exec(text) ?? /^(\d{1,2})월\s*(\d{1,2})일?$/.exec(text);
  if (match) { const month = Number(match[1]), date = Number(match[2]); if (month >= 1 && month <= 12 && date >= 1 && date <= 31) return `${now.getFullYear()}-${pad(month)}-${pad(date)}`; }
  match = /^(\d{1,2})일$/.exec(text);
  if (match) { const date = Number(match[1]); if (date >= 1 && date <= 31) return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(date)}`; }
  return null;
}
