import { t, translateServerMessage } from '../i18n';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { relativeTime } from '../data/format';
import { api } from '../data/api';
import { apply, newId } from '../data/commands';
import { report, setStatus, useWorkspace } from '../data/store';
import type { PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';

// 설정 › 빠른 기록: where captures land when they name no page, the address other tools call, ready-to-copy calls
// (terminal, curl, a database row, Apple Shortcuts) and a box to try one. The calls go to this computer only.
interface SettingsEntity { id: string; kind: 'settings'; capturePageId?: string }

interface InboxStatus { off?: boolean; folder: string | null; after: 'keep' | 'move'; home?: string; target: { id: string; title: string } | null; waiting: number; skipped: string[]; last: { at: string; count: number; names: string[] } | null; error: { code: string; message: string } | null }
const shortPath = (folder: string, home?: string) => home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;

// 받은 파일 폴더 (src/inbox-folder.mjs): new files in a folder on this computer land on the same page.
function InboxSettings({ Row }: { Row: (props: { label: ReactNode; note?: ReactNode; children?: ReactNode }) => ReactNode }) {
  const ws = useWorkspace();
  const [status, setInbox] = useState<InboxStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => { api<InboxStatus>('/api/inbox').then(setInbox).catch(() => undefined); }, [ws.revision]);
  const change = async (body: Record<string, unknown>) => {
    setBusy(true); setProblem('');
    try { setInbox(await api<InboxStatus>('/api/inbox', body)); setDraft(''); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!status || status.off) return null;
  const on = !!status.folder;
  return (
    <>
      <h2 className="prefs-section">{t("받은 파일 폴더")}</h2>
      <p className="prefs-row-note capture-lead">{t("이 폴더에 새로 들어온 파일(스캔, 스크린샷, 다운로드)을 위 페이지 끝에 붙입니다. 폴더를 고를 때 이미 있던 파일은 가져오지 않으며, 파일을 지우지 않습니다.")}</p>
      <Row label={t("폴더")} note={on ? (status.last ? t("{0} · 파일 {1}개를 가져왔습니다", [relativeTime(status.last.at), status.last.count]) : status.waiting ? t("{0}개가 다 들어오기를 기다리는 중", [status.waiting]) : t("새 파일을 기다리는 중")) : undefined}>
        {on ? (
          <span className="mirror-target">
            <code className="mirror-folder" title={status.folder!}>{shortPath(status.folder!, status.home)}</code>
            <button type="button" className="prefs-choice" disabled={busy} onClick={() => change({ folder: null })}>{t("끄기")}</button>
          </span>
        ) : (
          <span className="mirror-target">
            <input className="prefs-input" value={draft} placeholder="~/Documents/Inkacre Inbox" aria-label={t("받은 파일 폴더")} spellCheck={false}
              onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && draft.trim()) change({ folder: draft }); }} />
            <button type="button" className="prefs-choice" disabled={busy || !draft.trim()} onClick={() => change({ folder: draft })}>{t("켜기")}</button>
          </span>
        )}
      </Row>
      {problem || status.error ? <p className="error-text mirror-error">{problem || translateServerMessage(status.error!.message)}</p> : null}
      <Row label={t("가져온 뒤")} note={t("옮기기를 고르면 가져온 파일을 그 폴더 안의 Imported 폴더로 옮깁니다.")}>
        <select className="prefs-select" value={status.after} aria-label={t("가져온 뒤")} disabled={busy} onChange={event => change({ after: event.target.value })}>
          <option value="keep">{t("그대로 두기")}</option>
          <option value="move">{t("Imported 폴더로 옮기기")}</option>
        </select>
      </Row>
      {status.skipped.length ? <p className="prefs-row-note">{t("너무 커서 가져오지 않은 파일: {0}", [status.skipped.join(', ')])}</p> : null}
    </>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const copy = () => navigator.clipboard.writeText(code).then(() => setStatus(t("복사했습니다."))).catch(report);
  return (
    <div className="capture-snippet">
      <div className="capture-snippet-head"><span>{label}</span><button type="button" className="text-button small" onClick={copy}><Icon name="copy" size={14} />{t("복사")}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export function CaptureSettings({ Row }: { Row: (props: { label: ReactNode; note?: ReactNode; children?: ReactNode }) => ReactNode }) {
  const ws = useWorkspace();
  const settings = ws.get('workspace-settings') as unknown as SettingsEntity | undefined;
  const pages = useMemo(() => ws.snapshot.objects.filter(item => item.kind === 'page' && !(item as PageEntity).sourceId && !(item as PageEntity).template && ws.visible(item.id)) as PageEntity[], [ws.revision]);
  const chosen = settings?.capturePageId && pages.some(page => page.id === settings.capturePageId) ? settings.capturePageId : '';
  const [trial, setTrial] = useState('');
  const origin = location.origin, address = `${origin}/api/capture`, port = location.port ? ` --port ${location.port}` : '';
  const choose = (pageId: string | null) => apply([{ type: 'workspace.update', capturePageId: pageId }]).catch(report);
  const create = async () => {
    const id = newId();
    await apply([{ type: 'page.create', id, title: t("빠른 기록"), parentId: null }, { type: 'workspace.update', capturePageId: id }]).catch(report);
  };
  const send = async () => {
    if (!trial.trim()) return;
    try {
      const result = await api<{ title: string }>('/api/capture', { text: trial, source: 'settings' });
      setTrial(''); setStatus(t("기록했습니다 → {0}", [result.title || t("새 페이지")]));
    } catch (error) { report(error); }
  };
  const sample = t("우유 사기");
  return (
    <>
      <h1 className="prefs-title">{t("빠른 기록")}</h1>
      <p className="prefs-lead">{t("단축어, Raycast, 터미널처럼 이 컴퓨터의 다른 도구에서 호출 한 번으로 페이지에 한 줄을 붙이거나 데이터베이스에 항목을 추가합니다.")}</p>
      <h2 className="prefs-section">{t("기본 페이지")}</h2>
      <Row label={t("기록이 들어갈 페이지")} note={t("페이지를 정하지 않은 기록이 이 페이지 끝에 붙습니다")}>
        <span className="capture-target">
          <select className="prefs-select" value={chosen} aria-label={t("기록이 들어갈 페이지")} onChange={event => choose(event.target.value || null)}>
            <option value="">{t("정하지 않음")}</option>
            {pages.map(page => <option key={page.id} value={page.id}>{page.title || t("새 페이지")}</option>)}
          </select>
          {!chosen ? <button type="button" className="prefs-choice" onClick={create}>{t("새로 만들기")}</button> : null}
        </span>
      </Row>
      <Row label={t("시험 삼아 보내기")} note={t("여기서 보낸 줄도 다른 도구에서 보낸 것과 똑같이 기록됩니다")}>
        <span className="capture-target">
          <input className="prefs-input" value={trial} placeholder={sample} aria-label={t("시험 삼아 보내기")} onChange={event => setTrial(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) send(); }} />
          <button type="button" className="prefs-choice" disabled={!chosen || !trial.trim()} onClick={send}>{t("보내기")}</button>
        </span>
      </Row>
      <h2 className="prefs-section">{t("호출하는 방법")}</h2>
      <p className="prefs-row-note capture-lead">{t("주소 {0} 로 JSON을 POST 합니다. text(내용), to(페이지 제목이나 ID), as(text · todo · bullet), database(데이터베이스 이름)와 properties(속성 이름: 값)를 쓸 수 있습니다. 이 컴퓨터에서 보낸 요청만 받습니다.", [address])}</p>
      <Snippet label={t("터미널")} code={`inkacre capture${port} --todo "${sample}"`} />
      <Snippet label={t("데이터베이스에 항목 추가")} code={`inkacre capture${port} --db "${t("할 일")}" --prop "${t("마감")}=2026-11-01" "${t("보고서 제출")}"`} />
      <Snippet label="curl" code={`curl -X POST ${address} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"text": "${sample}", "as": "todo"}'`} />
      <Snippet label={t("Apple 단축어")} code={t("\"URL의 콘텐츠 가져오기\" 동작 하나\n  URL: {0}\n  방법: POST · 요청 본문: JSON\n  필드 text: 단축어 입력(또는 \"입력 요청\"의 결과)", [address])} />
      <InboxSettings Row={Row} />
    </>
  );
}
