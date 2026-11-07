import { t, translateServerMessage } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../data/api';
import { relativeTime } from '../data/format';
import { report, useWorkspace } from '../data/store';

// 설정 › 폴더 미러: the folder on this computer that keeps the workspace as Markdown and CSV files, one way, a few
// seconds after each change (src/mirror.mjs).
interface MirrorStatus {
  off?: boolean; folder: string | null; home?: string;
  last: { at: string; files: number; written: number; removed: number; changedOutside: string[]; changedOutsideCount: number; failed?: Array<{ path: string; message: string }>; failedCount?: number } | null;
  error: { code: string; message: string } | null;
}
const shortPath = (folder: string, home?: string) => home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;

export function MirrorSettings({ Row }: { Row: (props: { label: ReactNode; note?: ReactNode; children?: ReactNode }) => ReactNode }) {
  const ws = useWorkspace();
  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = () => api<MirrorStatus>('/api/mirror').then(next => { if (!cancelled) setStatus(next); }).catch(() => undefined);
    load();
    // The mirror writes a moment after a change: look again once it has.
    const timer = window.setTimeout(load, 3500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ws.revision]);
  const send = async (route: string, body: unknown) => {
    setBusy(true); setProblem('');
    try { setStatus(await api<MirrorStatus>(route, body)); setDraft(''); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const on = !!status?.folder;
  const last = status?.last;
  return (
    <>
      <h1 className="prefs-title">{t("폴더 미러")}</h1>
      <p className="prefs-lead">{t("워크스페이스 전체를 이 컴퓨터의 폴더에 Markdown과 CSV 파일로 계속 내보냅니다. Obsidian, VS Code, Spotlight, git이나 백업 도구에서 그대로 열 수 있습니다.")}</p>
      <h2 className="prefs-section">{t("미러 폴더")}</h2>
      {status?.off ? <p className="prefs-row-note">{t("이 서버에서는 폴더 미러를 쓸 수 없습니다.")}</p> : (
        <>
          <Row label={t("폴더")} note={t("바꾼 뒤 몇 초 안에 달라진 파일만 다시 씁니다. 한 방향이라 폴더에서 고친 내용은 앱으로 돌아오지 않습니다.")}>
            {on ? (
              <span className="mirror-target">
                <code className="mirror-folder" title={status!.folder!}>{shortPath(status!.folder!, status!.home)}</code>
                <button type="button" className="prefs-choice" disabled={busy} onClick={() => send('/api/mirror', { folder: null })}>{t("끄기")}</button>
              </span>
            ) : (
              <span className="mirror-target">
                <input className="prefs-input" value={draft} placeholder="~/Documents/Inkacre" aria-label={t("폴더")} spellCheck={false}
                  onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && draft.trim()) send('/api/mirror', { folder: draft }); }} />
                <button type="button" className="prefs-choice" disabled={busy || !draft.trim()} onClick={() => send('/api/mirror', { folder: draft })}>{t("켜기")}</button>
              </span>
            )}
          </Row>
          {problem || status?.error ? <p className="error-text mirror-error">{problem || translateServerMessage(status!.error!.message)}</p> : null}
          {on ? (
            <Row label={t("마지막 반영")} note={last ? t("{0} · 파일 {1}개", [relativeTime(last.at), last.files]) : t("아직 반영하지 않았습니다")}>
              <button type="button" className="prefs-choice" disabled={busy} onClick={() => send('/api/mirror/run', {}).catch(report)}>{t("지금 반영")}</button>
            </Row>
          ) : null}
          {on && last?.changedOutsideCount ? (
            <div className="mirror-outside">
              <p className="prefs-row-note">{t("폴더에서 바뀐 파일 {0}개는 덮어쓰지 않고 그대로 두었습니다. 그 파일을 지우면 다음 반영 때 다시 씁니다.", [last.changedOutsideCount])}</p>
              <ul>{last.changedOutside.map(file => <li key={file}><code>{file}</code></li>)}</ul>
            </div>
          ) : null}
          {on && last?.failedCount ? (
            <div className="mirror-outside">
              <p className="prefs-row-note">{t("쓰지 못한 파일 {0}개는 건너뛰었습니다. 나머지는 반영했습니다.", [last.failedCount])}</p>
              <ul>{last.failed!.map(item => <li key={item.path}><code>{item.path}</code> — {translateServerMessage(item.message)}</li>)}</ul>
            </div>
          ) : null}
          <h2 className="prefs-section">{t("폴더에 쓰는 것")}</h2>
          <ul className="mirror-rules prefs-row-note">
            <li>{t("페이지는 .md 파일로, 하위 페이지는 페이지 이름의 폴더에 씁니다.")}</li>
            <li>{t("데이터베이스는 .csv 파일과 행 페이지 폴더로, 첨부 파일은 files 폴더에 씁니다.")}</li>
            <li>{t("처음 고르는 폴더는 비어 있어야 하며, Inkacre가 쓴 파일만 바꾸거나 지웁니다.")}</li>
          </ul>
        </>
      )}
    </>
  );
}
