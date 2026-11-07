import { t, translateServerMessage } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../data/api';
import { displayDateTime, relativeTime } from '../data/format';
import { report, setStatus, useWorkspace } from '../data/store';

// 설정 › 백업: when the workspace is backed up on its own, how many scheduled backups are kept, where they go, and the
// backups there — each can be checked whole or opened as a new workspace beside this one (src/backups.mjs).
interface BackupItem { name: string; path: string; revision: number; completedAt: string; auto: boolean; attachments: number; damaged?: number }
interface BackupStatus {
  off?: boolean; every: 'off' | 'hourly' | 'daily' | 'weekly'; keep: number; folder: string | null; root: string; home?: string; sameDisk: boolean;
  running: boolean; error: { code: string; message: string; count?: number } | null; latest: BackupItem | null; changedSince: boolean; next: string | null; backups: BackupItem[];
}
type Row = (props: { label: ReactNode; note?: ReactNode; children?: ReactNode }) => ReactNode;
const shortPath = (folder: string, home?: string) => home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;

export function BackupSettings({ Row }: { Row: Row }) {
  const ws = useWorkspace();
  const [status, setStatusInfo] = useState<BackupStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [checks, setChecks] = useState<Record<string, 'checking' | 'ok' | string>>({});
  const load = () => api<BackupStatus>('/api/backups').then(setStatusInfo).catch(() => undefined);
  useEffect(() => { load(); }, [ws.revision]);
  useEffect(() => { if (!status?.running) return; const timer = window.setTimeout(load, 1000); return () => window.clearTimeout(timer); }, [status]);
  const change = async (body: Record<string, unknown>) => {
    setBusy(true); setProblem('');
    try { setStatusInfo(await api<BackupStatus>('/api/backups/settings', body)); setEditing(false); setDraft(''); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const backupNow = async () => {
    setBusy(true); setProblem('');
    try { await api('/api/backups', {}); setStatus(t("백업을 만들었습니다.")); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); load(); }
  };
  const check = async (item: BackupItem) => {
    setChecks(current => ({ ...current, [item.name]: 'checking' }));
    try { await api('/api/backups/verify', { name: item.name }); setChecks(current => ({ ...current, [item.name]: 'ok' })); }
    catch (error) { setChecks(current => ({ ...current, [item.name]: error instanceof Error ? error.message : String(error) })); }
  };
  const openAsWorkspace = async (item: BackupItem) => {
    const name = (ws.get('workspace-settings') as { name?: string } | undefined)?.name || t("내 워크스페이스");
    try {
      const opened = await api<{ url: string }>('/api/backups/open', { name: item.name, title: t("{0} (백업 {1})", [name, displayDateTime(item.completedAt)]) });
      window.open(opened.url, '_blank', 'noopener');
    } catch (error) { report(error); }
  };
  if (!status) return <h1 className="prefs-title">{t("백업")}</h1>;
  if (status.off) return <><h1 className="prefs-title">{t("백업")}</h1><p className="prefs-row-note">{t("이 서버에서는 백업 설정을 쓸 수 없습니다.")}</p></>;
  const periods: Array<[BackupStatus['every'], string]> = [['off', t("끄기")], ['hourly', t("매시간")], ['daily', t("매일")], ['weekly', t("매주")]];
  return (
    <>
      <h1 className="prefs-title">{t("백업")}</h1>
      <p className="prefs-lead">{t("워크스페이스 전체(페이지, 데이터베이스, 첨부 파일, 변경 기록)를 정해 둔 주기로 백업합니다. 지난 백업 뒤로 바뀐 것이 없으면 건너뜁니다.")}</p>
      <h2 className="prefs-section">{t("자동 백업")}</h2>
      <Row label={t("주기")} note={status.every !== 'off' && status.next ? t("다음 백업: {0} 이후 바뀐 내용이 있을 때", [displayDateTime(status.next)]) : undefined}>
        <select className="prefs-select" value={status.every} aria-label={t("주기")} disabled={busy} onChange={event => change({ every: event.target.value })}>
          {periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Row>
      <Row label={t("보관 개수")} note={t("자동 백업은 이 개수만 남기고 오래된 것부터 지웁니다. 직접 만든 백업은 지우지 않습니다.")}>
        <select className="prefs-select" value={status.keep} aria-label={t("보관 개수")} disabled={busy} onChange={event => change({ keep: Number(event.target.value) })}>
          {[3, 7, 14, 30, 90].map(count => <option key={count} value={count}>{t("{0}개", [count])}</option>)}
        </select>
      </Row>
      <Row label={t("백업 폴더")} note={status.sameDisk ? t("지금은 데이터 폴더 안에 있어 디스크가 고장 나면 함께 잃습니다. 외장 디스크나 다른 드라이브의 폴더를 고르세요.") : t("선택한 위치 안에 이 워크스페이스의 백업 폴더를 만듭니다.")}>
        {editing ? (
          <span className="mirror-target">
            <input className="prefs-input" value={draft} autoFocus placeholder="/Volumes/Backup" aria-label={t("백업 폴더")} spellCheck={false}
              onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && draft.trim()) change({ folder: draft }); if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); } }} />
            <button type="button" className="prefs-choice" disabled={busy || !draft.trim()} onClick={() => change({ folder: draft })}>{t("저장")}</button>
          </span>
        ) : (
          <span className="mirror-target">
            <code className={`mirror-folder${status.folder ? '' : ' plain'}`} title={status.root}>{status.folder ? shortPath(status.folder, status.home) : t("데이터 폴더 안")}</code>
            <button type="button" className="prefs-choice" onClick={() => { setEditing(true); setDraft(status.folder ?? ''); }}>{t("바꾸기")}</button>
            {status.folder ? <button type="button" className="prefs-choice" disabled={busy} onClick={() => change({ folder: null })}>{t("기본 위치로")}</button> : null}
          </span>
        )}
      </Row>
      {problem || status.error ? <p className="error-text mirror-error">{problem || (status.error!.code === 'BACKUP_DAMAGED' ? t("손상된 첨부 파일 {0}개는 백업하지 못했습니다.", [status.error!.count ?? 0]) : translateServerMessage(status.error!.message))}</p> : null}
      <Row label={t("마지막 백업")} note={status.latest ? `${relativeTime(status.latest.completedAt)} · ${status.changedSince ? t("그 뒤로 바뀐 내용이 있습니다") : t("그 뒤로 바뀐 내용이 없습니다")}` : t("아직 없습니다")}>
        <button type="button" className="prefs-choice" disabled={busy || status.running} onClick={backupNow}>{status.running ? t("백업하는 중…") : t("지금 백업")}</button>
      </Row>
      <h2 className="prefs-section">{t("백업 목록")}</h2>
      {status.backups.length ? (
        <ul className="backup-list">
          {status.backups.map(item => (
            <li key={item.name} className="backup-item">
              <span className="backup-when">{displayDateTime(item.completedAt)}</span>
              <span className="backup-kind">{item.auto ? t("자동") : t("직접")} · {t("첨부 {0}개", [item.attachments])}{item.damaged ? ` · ${t("손상 {0}개 빠짐", [item.damaged])}` : ''}</span>
              <span className="backup-check" data-state={checks[item.name] === 'ok' ? 'ok' : checks[item.name] && checks[item.name] !== 'checking' ? 'bad' : undefined}>
                {checks[item.name] === 'checking' ? t("점검하는 중…") : checks[item.name] === 'ok' ? t("이상 없음") : checks[item.name] ? translateServerMessage(checks[item.name]) : null}
              </span>
              <button type="button" className="text-button small" onClick={() => check(item)}>{t("점검")}</button>
              <button type="button" className="text-button small" onClick={() => openAsWorkspace(item)}>{t("새 워크스페이스로 열기")}</button>
            </li>
          ))}
        </ul>
      ) : <p className="prefs-row-note">{t("아직 백업이 없습니다.")}</p>}
      <p className="prefs-row-note backup-help">{t("새 워크스페이스로 열면 그 백업의 사본이 옆에 생기고, 지금 워크스페이스는 그대로입니다. 명령줄 복원: inkacre restore --from <백업 폴더> --to <새 폴더>")}</p>
    </>
  );
}
