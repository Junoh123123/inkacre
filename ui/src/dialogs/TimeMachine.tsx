import { t } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../data/api';
import { displayDateTime } from '../data/format';
import { currentRoute, useRoute } from '../data/router';
import { report, useWorkspace, workspace } from '../data/store';
import type { PageEntity } from '../data/types';
import { timeMachineHref, timeMachineRevision } from '../data/timeMachine';
import { Dialog, confirmDialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { openWorkspaceDialog } from './registry';

// 타임머신 (31차 다음): pick a moment and open the whole workspace as it was then, read-only, in a tab of its own.
// The moment resolves to the last change made at or before it (GET /api/time-machine?time=…).
interface Moment { revision: number; at: string | null; currentRevision: number; first?: string | null }

const localInput = (date: Date) => { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); };

export function TimeMachineDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(() => localInput(new Date(Date.now() - 24 * 3600 * 1000)));
  const [moment, setMoment] = useState<Moment | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) { setMoment(null); return; }
    let cancelled = false;
    api<Moment>(`/api/time-machine?time=${encodeURIComponent(date.toISOString())}`).then(result => { if (!cancelled) { setMoment(result); setError(''); } }).catch(failure => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, [value]);
  const quick = (label: string, ms: number) => <button type="button" className="text-button small" onClick={() => setValue(localInput(new Date(Date.now() - ms)))}>{label}</button>;
  const page = currentRoute().id;
  const empty = moment ? moment.revision === 0 : false;
  return (
    <Dialog title={t("타임머신")} onClose={onClose} width={460} submitLabel={t("이 시점 열기")} onSubmit={async () => {
      if (!moment || empty) throw new Error(t("그 시점에는 아직 아무것도 없었습니다."));
      const href = timeMachineHref(moment.revision, page && workspace.get(page) ? page : null);
      if (timeMachineRevision !== null) location.href = href; else window.open(href, '_blank', 'noopener');
      return undefined;
    }}>
      <p className="muted small">{t("고른 시점의 워크스페이스 전체를 새 탭에서 읽기 전용으로 엽니다. 페이지는 그곳에서 지금으로 되살리거나 복사본으로 꺼낼 수 있습니다.")}</p>
      <label className="field"><span>{t("날짜와 시각")}</span><input className="text-input time-machine-input" type="datetime-local" value={value} max={localInput(new Date())} onChange={event => setValue(event.target.value)} /></label>
      <div className="time-machine-quick">{quick(t("1시간 전"), 3600e3)}{quick(t("어제 이맘때"), 86400e3)}{quick(t("일주일 전"), 7 * 86400e3)}{quick(t("한 달 전"), 30 * 86400e3)}</div>
      {error ? <p className="error-text">{error}</p> : null}
      {moment ? <p className="time-machine-moment">{empty ? t("그 시점에는 아직 아무것도 없었습니다.") : t("그때의 마지막 변경: {0} · 버전 {1} (지금은 버전 {2})", [moment.at ? displayDateTime(moment.at) : '—', moment.revision, moment.currentRevision])}</p> : null}
    </Dialog>
  );
}

// The bar over the app in the time machine: the moment, and for the open page 지금으로 되살리기 (its content as it was,
// or the page back from the trash) and 복사본으로 꺼내기 (a copy of it and everything under it, beside it now).
export function TimeMachineBar() {
  const ws = useWorkspace();
  const route = useRoute();
  const [moment, setMoment] = useState<Moment | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Moment>(`/api/time-machine?revision=${timeMachineRevision}`).then(setMoment).catch(report); }, []);
  const page = useMemo(() => { const id = route.peek ?? route.id; const item = id ? ws.get<PageEntity>(id) : undefined; return item?.kind === 'page' ? item : null; }, [route.id, route.peek, ws.revision]);
  useEffect(() => { document.title = `${t("타임머신")} · ${moment?.at ? displayDateTime(moment.at) : ''}`; }, [moment?.at, page?.id]);
  const when = moment?.at ? displayDateTime(moment.at) : '…';
  const bringBack = async (mode: 'restore' | 'copy') => {
    if (!page || timeMachineRevision === null) return;
    const name = page.title || t("새 페이지");
    const question = mode === 'restore'
      ? t("“{0}”의 내용을 {1} 시점으로 되돌립니다. 지금 내용은 변경 기록에 남아 다시 되돌릴 수 있습니다.", [name, when])
      : t("{1} 시점의 “{0}”과(와) 그 아래 페이지를 복사본으로 꺼냅니다.", [name, when]);
    if (!(await confirmDialog(mode === 'restore' ? t("지금으로 되살리기") : t("복사본으로 꺼내기"), question, { confirmLabel: mode === 'restore' ? t("되살리기") : t("꺼내기") }))) return;
    setBusy(true);
    try {
      const now = await api<Moment>(`/api/time-machine?revision=${timeMachineRevision}`);
      const result = await api<{ pageId: string; mode: string }>('/api/time-machine/restore', { pageId: page.id, revision: timeMachineRevision, mode, title: `${name} (${when})`, commandId: crypto.randomUUID(), actor: 'user', expectedRevision: now.currentRevision });
      location.href = `/?id=${encodeURIComponent(result.pageId)}`;
    } catch (error) { report(error); setBusy(false); }
  };
  return (
    <div className="time-machine-bar" role="status">
      <Icon name="clock" size={16} />
      <span className="time-machine-when">{t("{0} 시점의 워크스페이스 · 읽기 전용", [when])}</span>
      <span className="time-machine-space" />
      {page ? <button type="button" className="time-machine-button primary" disabled={busy} onClick={() => bringBack('restore')}>{t("지금으로 되살리기")}</button> : null}
      {page && !page.sourceId ? <button type="button" className="time-machine-button" disabled={busy} onClick={() => bringBack('copy')}>{t("복사본으로 꺼내기")}</button> : null}
      <button type="button" className="time-machine-button" onClick={() => openWorkspaceDialog('time-machine')}>{t("다른 시점")}</button>
      <a className="time-machine-button" href={page ? `/?id=${encodeURIComponent(page.id)}` : '/'}>{t("지금으로 돌아가기")}</a>
    </div>
  );
}
