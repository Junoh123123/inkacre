import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, readLocal, storeLocal } from '../data/api';
import { apply, discardPending, resendOnLatest, retryPending, undoCommand, uploadFile, usePending } from '../data/commands';
import { importAccept, prepareImport } from './importConverters';
import { readArchive, sendArchive, commitArchive, cancelArchive, archiveLimits, type ArchivePlan, type ArchivePreview } from './archiveImport';
import { useSettings } from '../data/settings';
import { navigate, hrefFor, currentRoute } from '../data/router';
import { timeMachineHref } from '../data/timeMachine';
import { report, setStatus, useWorkspace, workspace } from '../data/store';
import { blockLabels, displayDate, plainText, relativeTime } from '../data/format';
import type { BlockEntity, DeliveryEntity, Entity, NotificationEntity, PageEntity, SourceEntity } from '../data/types';
import { Dialog, confirmDialog } from '../ui/primitives';
import { Popover } from '../ui/overlay';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import { EntityIcon } from '../page/EntityIcon';
import { NoteMessage, noteText } from '../shell/InboxPanel';

// Workspace-level panels: inbox, history, agent runs, pending saves, deliveries,
// import, backup, desktop notifications, trash, keyboard shortcuts.

function owningPage(id: string | null | undefined): PageEntity | undefined {
  let current = workspace.get(id ?? '');
  while (current && current.kind !== 'page') current = workspace.get(current.parentId);
  return current as PageEntity | undefined;
}

export function InboxDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const notes = (ws.snapshot.objects.filter(item => item.kind === 'notification' && ws.visible(item.id)) as NotificationEntity[])
    .filter(note => tab === 'all' || !note.read)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Dialog title={t("받은 알림")} onClose={onClose} width={480}>
      <div className="tabs-row">
        <button type="button" className={`tab-pill${tab === 'unread' ? ' active' : ''}`} onClick={() => setTab('unread')}>{t("읽지 않음")}</button>
        <button type="button" className={`tab-pill${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>{t("전체")}</button>
        <span className="spacer" />
        {notes.some(note => !note.read) ? <button type="button" className="text-button small" onClick={() => apply(notes.filter(note => !note.read).map(note => ({ type: 'notification.read', id: note.id, read: true }))).catch(report)}>{t("모두 읽음으로 표시")}</button> : null}
      </div>
      <div className="inbox-list">
        {notes.map(note => {
          const page = owningPage(note.parentId);
          return (
            <div key={note.id} className={`inbox-item${note.read ? ' read' : ''}`}>
              <span className="inbox-dot" aria-hidden="true" />
              <div className="inbox-body">
                <div className="inbox-message"><NoteMessage message={note.message} /></div>
                <div className="inbox-meta">
                  {page ? <a href={hrefFor(page.id)} onClick={event => { event.preventDefault(); onClose(); navigate(page.id); setTimeout(() => document.querySelector(`[data-block-id="${CSS.escape(note.parentId ?? '')}"]`)?.scrollIntoView({ block: 'center' }), 200); }}><EntityIcon item={page} size={14} />{page.title || t("새 페이지")}</a> : null}
                  <span>{relativeTime(note.createdAt)}</span>
                </div>
              </div>
              <button type="button" className="text-button small" onClick={() => apply([{ type: 'notification.read', id: note.id, read: !note.read }]).catch(report)}>{note.read ? t("읽지 않음") : t("읽음")}</button>
            </div>
          );
        })}
        {!notes.length ? <div className="empty-state"><Icon name="inbox" size={28} /><p>{tab === 'unread' ? t("읽지 않은 알림이 없습니다.") : t("받은 알림이 없습니다.")}</p></div> : null}
      </div>
    </Dialog>
  );
}

interface HistoryCommand { id: string; revision: number; actor: string; kind: string; created_at: string; result?: { changes?: Array<{ id: string }> } }

export function HistoryDialog({ onClose, pageId }: { onClose: () => void; pageId?: string }) {
  const [commands, setCommands] = useState<HistoryCommand[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api<{ commands: HistoryCommand[] }>(`/api/history?limit=100${pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''}`).then(data => setCommands(data.commands)).catch(failure => setError(failure.message));
  useEffect(() => { load(); }, [pageId]);
  return (
    <Dialog title={pageId ? t("페이지 기록") : t("변경 기록")} onClose={onClose} width={560}>
      {error ? <p className="error-text">{error}</p> : null}
      {!commands ? <p className="muted">{t("불러오는 중…")}</p> : null}
      <div className="history-list">
        {commands?.map(command => (
          <div key={command.id} className="history-item">
            <div className="history-main">
              <div className="history-title">{t("{0} · 버전 {1}", [command.kind === 'undo' ? t("되돌림") : t("변경"), command.revision])}</div>
              <div className="history-meta">{displayDate(command.created_at)} · {command.actor === 'user' ? t("나") : command.actor}</div>
            </div>
            <div className="history-actions">
              {pageId ? <button type="button" className="text-button small" onClick={() => { onClose(); import('./registry').then(module => module.openWorkspaceDialog('versions', { pageId, revision: command.revision })); }}>{t("이 시점 보기")}</button> : null}
              {/* 타임머신: the whole workspace right after this change, in a tab of its own. */}
              <a className="text-button small history-moment" href={timeMachineHref(command.revision, pageId ?? currentRoute().id)} target="_blank" rel="noopener">{t("이 시점 열기")}</a>
              <button type="button" className="text-button small" onClick={async () => {
                if (!(await confirmDialog(t("이 변경 되돌리기"), t("이 변경을 되돌리는 새 변경을 저장합니다. 이후 변경과 충돌하면 저장하지 않습니다."), { confirmLabel: t("되돌리기") }))) return;
                try { await undoCommand(command.id); setStatus(t("되돌렸습니다.")); load(); } catch (failure) { report(failure); }
              }}>{t("되돌리기")}</button>
            </div>
          </div>
        ))}
        {commands && !commands.length ? <p className="muted">{t("기록이 없습니다.")}</p> : null}
      </div>
    </Dialog>
  );
}

interface RunSummary { runId: string; updatedAt: string; commandCount: number; logCount: number; summary?: string }
interface RunTarget { label: string; location?: string }
interface RunDetail { revision: number; commandTotal: number; hasMore: boolean; commands: Array<{ id: string; kind: string; revision: number; created_at: string; changes: RunTarget[] }>; logs: Array<{ createdAt: string; message: string; targets: RunTarget[] }> }

export function RunsDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<{ total: number; hasMore: boolean; runs: RunSummary[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const load = (at = offset) => api<{ total: number; hasMore: boolean; runs: RunSummary[] }>(`/api/runs?limit=20&offset=${at}`).then(setPage).catch(report);
  useEffect(() => { load(offset); }, [offset]);
  if (detail) return <RunDetailView runId={detail} onBack={() => { setDetail(null); load(); }} onClose={onClose} />;
  return (
    <Dialog title={t("에이전트 실행 기록")} onClose={onClose} width={560}>
      <div className="tabs-row"><span className="muted">{t("작업 {0}건", [page?.total ?? 0])}</span><span className="spacer" /><button type="button" className="text-button small" onClick={() => load()}>{t("새로 읽기")}</button></div>
      <div className="history-list">
        {page?.runs.map(run => (
          <button type="button" key={run.runId} className="history-item clickable" onClick={() => setDetail(run.runId)}>
            <div className="history-main">
              <div className="history-title">{run.summary ?? t("설명 없이 저장된 변경")}</div>
              <div className="history-meta">{t("{0} · 저장된 변경 {1}건 · 설명 {2}건", [displayDate(run.updatedAt), run.commandCount, run.logCount])}</div>
            </div>
            <Icon name="chevron-right" size={16} />
          </button>
        ))}
        {page && !page.total ? <p className="muted">{t("기록된 에이전트 작업이 없습니다.")}</p> : null}
      </div>
      <div className="pager">
        <button type="button" className="outline-button small" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("이전")}</button>
        <button type="button" className="outline-button small" disabled={!page?.hasMore} onClick={() => setOffset(offset + 20)}>{t("다음")}</button>
      </div>
    </Dialog>
  );
}

function RunTargetLink({ target, onLeave }: { target: RunTarget; onLeave: () => void }) {
  if (!target.location) return <span className="muted">{t("{0} · 현재 열 수 없음", [target.label])}</span>;
  return <a href={target.location} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); onLeave(); const id = new URL(target.location!, location.href).searchParams.get('id'); if (id) navigate(id); }}>{target.label}</a>;
}

function RunDetailView({ runId, onBack, onClose }: { runId: string; onBack: () => void; onClose: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const load = () => api<RunDetail>(`/api/runs/${encodeURIComponent(runId)}?limit=20&offset=${offset}`).then(data => { setDetail(data); setError(''); }).catch(failure => setError(failure.message));
  useEffect(() => { load(); }, [offset]);
  return (
    <Dialog title={t("에이전트 작업 상세")} onClose={onClose} width={600} footer={<button type="button" className="text-button" onClick={onBack}><Icon name="arrow-left" size={14} />{t("목록")}</button>}>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <h3 className="dialog-subtitle">{t("실제 저장된 변경 · {0}건", [detail?.commandTotal ?? 0])}</h3>
      {detail?.commands.map(command => (
        <div key={command.id} className="run-command">
          <div className="history-title">{t("{0} · 버전 {1} · {2}", [command.kind === 'undo' ? t("복구") : t("변경"), command.revision, displayDate(command.created_at)])}</div>
          <ul>{command.changes.map((target, index) => <li key={index}><RunTargetLink target={target} onLeave={onClose} /></li>)}</ul>
          <button type="button" className="text-button small" onClick={async () => {
            try { await undoCommand(command.id, detail.revision); load(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
          }}>{t("이 변경 되돌리기")}</button>
        </div>
      ))}
      <div className="pager">
        <button type="button" className="outline-button small" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("이전 변경")}</button>
        <button type="button" className="outline-button small" disabled={!detail?.hasMore} onClick={() => setOffset(offset + 20)}>{t("다음 변경")}</button>
      </div>
      <h3 className="dialog-subtitle">{t("별도 처리 설명")}</h3>
      {detail && !detail.logs.length ? <p className="muted">{t("저장된 설명이 없습니다.")}</p> : null}
      {detail?.logs.map((log, index) => (
        <div key={index} className="run-log">
          <div className="history-meta">{displayDate(log.createdAt)}</div>
          <pre className="run-message">{log.message}</pre>
          {log.targets.length ? <ul>{log.targets.map((target, i) => <li key={i}><RunTargetLink target={target} onLeave={onClose} /></li>)}</ul> : null}
        </div>
      ))}
    </Dialog>
  );
}

export function PendingDialog({ onClose }: { onClose: () => void }) {
  const pending = usePending();
  const entries = pending.map(entry => [entry.command.id, entry] as const);
  return (
    <Dialog title={t("보류한 저장")} onClose={onClose} width={560}>
      <p className="muted">{t("이 브라우저가 아직 저장하지 못한 변경입니다. 충돌한 변경은 최신 상태를 확인한 뒤 다시 적용하거나 버릴 수 있습니다.")}</p>
      <div className="history-list">
        {entries.map(([id, entry]) => (
          <div key={id} className="history-item">
            <div className="history-main">
              <div className="history-title">{entry.route === '/api/attachments' ? t("첨부 올리기 · {0}", [String((entry.command as { name?: string }).name ?? '')]) : t("{0}개 작업", [entry.command.operations?.length ?? 0])}</div>
              <div className="history-meta">{t("{0} · 기준 버전 {1}", [entry.error ? entry.error.message : t("대기 중"), entry.command.expectedRevision])}</div>
            </div>
            <div className="history-actions">
              {entry.error?.code === 'REVISION_CONFLICT' && entry.route === '/api/commands' ? <button type="button" className="text-button small" onClick={() => resendOnLatest(id).catch(report)}>{t("최신 상태에 다시 적용")}</button> : <button type="button" className="text-button small" onClick={() => retryPending(id).catch(report)}>{t("다시 시도")}</button>}
              <button type="button" className="text-button small danger" onClick={async () => { if (await confirmDialog(t("보류한 저장 버리기"), t("이 변경과 관련 입력을 이 브라우저에서 지웁니다."), { confirmLabel: t("버리기"), danger: true })) discardPending(id); }}>{t("버리기")}</button>
            </div>
          </div>
        ))}
        {!entries.length ? <p className="muted">{t("보류한 저장이 없습니다.")}</p> : null}
      </div>
    </Dialog>
  );
}

export function DeliveriesDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const jobs = ws.snapshot.objects.filter(item => item.kind === 'delivery' && ws.visible(item.id)) as DeliveryEntity[];
  const statusText: Record<string, string> = { queued: t("대기"), sending: t("보내는 중"), sent: t("보냄"), failed: t("실패"), unknown: t("결과 불명"), cancelled: t("취소됨") };
  return (
    <Dialog title={t("외부 전송 기록")} onClose={onClose} width={560}>
      <div className="history-list">
        {jobs.map(job => (
          <div key={job.id} className="history-item">
            <div className="history-main">
              <div className="history-title">{job.channel === 'email' ? job.to : job.url} · {statusText[job.status] ?? job.status}</div>
              <div className="history-meta">{job.error ?? job.receipt ?? ''}</div>
            </div>
            <div className="history-actions">
              {['failed', 'unknown'].includes(job.status) ? <button type="button" className="text-button small" onClick={async () => { if (await confirmDialog(t("다시 보내기"), t("수신처에서 이미 처리했을 수 있습니다. 실제 수신 결과를 확인한 뒤 다시 보내세요."), { confirmLabel: t("다시 보내기") })) apply([{ type: 'delivery.update', id: job.id, status: 'queued' }]).catch(report); }}>{t("다시 보내기")}</button> : null}
              {['queued', 'failed', 'unknown'].includes(job.status) ? <button type="button" className="text-button small" onClick={() => apply([{ type: 'delivery.update', id: job.id, status: 'cancelled' }]).catch(report)}>{t("취소")}</button> : null}
            </div>
          </div>
        ))}
        {!jobs.length ? <p className="muted">{t("전송 기록이 없습니다.")}</p> : null}
      </div>
    </Dialog>
  );
}

const importFormats = [
  { id: 'csv', name: 'CSV' }, { id: 'markdown', name: 'Markdown' }, { id: 'html', name: 'HTML' }, { id: 'zip', name: t("ZIP 압축 파일") }, { id: 'bundle', name: t("구조·첨부 보존 묶음 (JSON)") },
];

export function ImportDialog({ onClose, parentId = null, sourceId = null }: { onClose: () => void; parentId?: string | null; sourceId?: string | null }) {
  const ws = useWorkspace();
  const [format, setFormat] = useState('markdown');
  const [title, setTitle] = useState(t("가져온 자료"));
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(sourceId ?? '');
  const [preview, setPreview] = useState<{ revision: number; operations: unknown[]; warnings: string[]; changes: Array<{ id: string; kind: string; title?: string; name?: string }> } | null>(null);
  // A ZIP is read from the file in pieces and sent entry by entry (archiveImport.ts), up to 5 GB.
  const [archive, setArchive] = useState<{ file: File; plan: ArchivePlan } | null>(null);
  const [archived, setArchived] = useState<{ id: string; preview: ArchivePreview } | null>(null);
  const reading = useRef<AbortController | null>(null), session = useRef<string | null>(null);
  const close = () => { reading.current?.abort(); if (session.current) cancelArchive(session.current); session.current = null; onClose(); };
  const sendZip = async (file: File, plan: ArchivePlan, zipTitle: string) => {
    const controller = new AbortController(); reading.current = controller;
    try { return await sendArchive(file, plan, { title: zipTitle, parentId, upload, signal: controller.signal, onProgress: setProgress }); }
    finally { reading.current = null; }
  };
  const upload = async (file: File) => (await uploadFile(file, workspace.revision)).attachmentId;
  const isZip = (file: File) => file.name.toLowerCase().endsWith('.zip');
  const pick = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (!chosen.length) return;
    const large = chosen.find(file => isZip(file) ? file.size > archiveLimits.zipBytes : file.size > 16 * 1024 * 1024);
    if (large) { report(new Error(isZip(large) ? t("ZIP 파일은 5 GB까지 가져올 수 있습니다.") : t("16 MiB 이하 파일을 선택하세요."))); return; }
    setArchive(null);
    if (chosen.length > 1) { setFiles(chosen); setFileName(t("{0}개 파일", [chosen.length])); setNote(''); return; }
    setFiles([]); setFileName(chosen[0].name); setBusy(true);
    try {
      if (isZip(chosen[0])) {
        const plan = await readArchive(chosen[0]);
        // An Inkacre bundle saved as a ZIP keeps its own (small) import.
        if (!plan.bundle) {
          setArchive({ file: chosen[0], plan }); setFormat('zip'); setText(''); setTitle(chosen[0].name.replace(/\.zip$/i, ''));
          setFileName(`${chosen[0].name} · ${t("{0}개 파일", [plan.entries.length])}`);
          setNote(plan.skipped.slice(0, 5).join('\n'));
          return;
        }
        if (chosen[0].size > 16 * 1024 * 1024) throw new Error(t("16 MiB 이하 파일을 선택하세요."));
      }
      const prepared = await prepareImport(chosen[0], upload);
      setFormat(prepared.format); setText(prepared.text); setTitle(prepared.title); setNote(prepared.note ?? '');
    } catch (error) { report(error); } finally { setBusy(false); }
  };
  // Several files: each becomes its own page (or database), one after another, with a progress line.
  const importAll = async () => {
    let last: string | undefined;
    const failed: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress({ done: index, total: files.length, current: file.name });
      try {
        if (isZip(file)) {
          const plan = await readArchive(file);
          if (!plan.bundle) {
            const sent = await sendZip(file, plan, file.name.replace(/\.zip$/i, ''));
            session.current = sent.id;
            const result = await commitArchive(sent.id, workspace.revision);
            session.current = null; last = result.pageId ?? last;
            setProgress({ done: index, total: files.length, current: file.name });
            continue;
          }
        }
        const prepared = await prepareImport(file, upload);
        const plan = await api<NonNullable<typeof preview>>('/api/import/preview', { format: prepared.format, text: prepared.text, title: prepared.title, ...(parentId ? { parentId } : {}) });
        const result = await apply(plan.operations as never, { revision: plan.revision });
        last = result.copies?.[0]?.copyId ?? (plan.operations as Array<{ type: string; id?: string }>).find(operation => operation.type === 'page.create')?.id ?? last;
      } catch (error) { failed.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    setProgress({ done: files.length, total: files.length, current: '' });
    if (failed.length) { report(new Error(failed.join('\n'))); return false; }
    setStatus(t("{0}개 파일을 가져왔습니다.", [files.length]));
    if (last) navigate(last);
    return undefined;
  };
  if (archived) {
    const shown = archived.preview.warnings.slice(0, 12);
    return (
      <Dialog title={t("가져오기 미리보기")} onClose={close} width={520} submitLabel={t("가져오기")} onSubmit={async () => {
        const result = await commitArchive(archived.id, workspace.revision);
        session.current = null;
        if (result.pageId) navigate(result.pageId);
      }} footer={<button type="button" className="text-button" onClick={() => { cancelArchive(archived.id); session.current = null; setArchived(null); setProgress(null); }}>{t("뒤로")}</button>}>
        <p>{t("{0}개 항목을 만들거나 바꿉니다.", [archived.preview.count])}</p>
        <p className="muted small archive-summary">{t("페이지 {0}개 · 데이터베이스 행 {1}개 · 파일 {2}개", [archived.preview.pages, archived.preview.rows, archived.preview.attachments])}</p>
        {shown.map((warning, index) => <p key={index} className="warning-text">{warning}</p>)}
        {archived.preview.warnings.length > shown.length ? <p className="muted small">{t("그 밖의 안내 {0}개", [archived.preview.warnings.length - shown.length])}</p> : null}
        <ul className="import-preview">{archived.preview.changes.map(item => <li key={item.id}>{item.title || item.name || item.kind}</li>)}</ul>
      </Dialog>
    );
  }
  if (preview) {
    return (
      <Dialog title={t("가져오기 미리보기")} onClose={onClose} width={520} submitLabel={t("가져오기")} onSubmit={async () => {
        setProgress({ done: 0, total: 1, current: fileName || title });
        const result = await apply(preview.operations as never, { revision: preview.revision });
        const copy = result.copies?.[0]?.copyId ?? (preview.operations as Array<{ type: string; id?: string; parentId?: string | null }>).find(operation => operation.type === 'page.create' && !operation.parentId)?.id;
        if (copy) navigate(copy);
      }} footer={<button type="button" className="text-button" onClick={() => setPreview(null)}>{t("뒤로")}</button>}>
        <p>{t("{0}개 항목을 만들거나 바꿉니다.", [preview.changes.length])}</p>
        {preview.warnings.map((warning, index) => <p key={index} className="warning-text">{warning}</p>)}
        <ul className="import-preview">{preview.changes.slice(0, 50).map(item => <li key={item.id}>{item.title || item.name || item.kind}</li>)}</ul>
      </Dialog>
    );
  }
  return (
    <Dialog title={t("가져오기")} onClose={close} width={560} submitLabel={files.length > 1 ? t("{0}개 가져오기", [files.length]) : t("미리보기")} onSubmit={async () => {
      if (files.length > 1) return importAll();
      if (busy) throw new Error(t("파일을 읽는 중입니다. 잠시 뒤 다시 누르세요."));
      if (archive && format === 'zip') {
        const sent = await sendZip(archive.file, archive.plan, title.trim() || archive.file.name);
        session.current = sent.id; setArchived(sent);
        return false;
      }
      if (!text) throw new Error(t("가져올 파일을 고르거나 내용을 붙여넣으세요."));
      const result = await api<NonNullable<typeof preview>>('/api/import/preview', { format, text, title, ...(parentId ? { parentId } : {}), ...(format === 'csv' && target ? { sourceId: target } : {}) });
      setPreview(result);
      return false;
    }}>
      {files.length <= 1 ? (
        <div className="import-formats">
          {importFormats.map(item => <button type="button" key={item.id} className={`import-format${format === item.id ? ' active' : ''}`} onClick={() => setFormat(item.id)}>{item.name}</button>)}
        </div>
      ) : null}
      <label className="field"><span>{t("파일")}</span><input type="file" multiple accept={importAccept} onChange={event => pick(event.target.files)} />{fileName ? <span className="muted">{busy ? t("{0} 읽는 중…", [fileName]) : fileName}</span> : null}</label>
      <p className="muted small import-kinds">{t("Markdown · 텍스트 · HTML · CSV · TSV · Word(.docx) · PDF · Excel(.xlsx · .xls) · OpenDocument(.ods) · OPML · EPUB · ZIP(5 GB까지, 다른 앱에서 내보낸 것 포함) · 묶음(JSON), 여러 개를 한 번에 고를 수 있습니다.")}</p>
      {note ? <p className="warning-text import-note">{note}</p> : null}
      {files.length > 1 ? (
        <ul className="import-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`} className={progress && index < progress.done ? 'done' : progress && index === progress.done ? 'current' : ''}>{progress && index < progress.done ? <Icon name="check" size={14} /> : <Icon name="file" size={14} />}<span>{file.name}</span></li>)}</ul>
      ) : (
        <>
          <label className="field"><span>{t("제목")}</span><input className="text-input" value={title} onChange={event => setTitle(event.target.value)} /></label>
          {format === 'csv' ? (
            <label className="field"><span>{t("CSV를 추가할 데이터베이스")}</span>
              <select className="text-input" value={target} onChange={event => setTarget(event.target.value)}>
                <option value="">{t("새 데이터베이스")}</option>
                {(ws.sources() as SourceEntity[]).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
            </label>
          ) : null}
          {format !== 'zip' ? <label className="field"><span>{t("또는 내용을 붙여넣기")}</span><textarea className="text-input" rows={8} value={text} onChange={event => setText(event.target.value)} /></label> : null}
        </>
      )}
      {progress ? <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><div className="import-progress-bar" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /><span>{progress.done < progress.total ? t("{0}/{1} 가져오는 중 · {2}", [progress.done + 1, progress.total, progress.current]) : t("완료")}</span></div> : null}
    </Dialog>
  );
}

export async function runBackup() {
  try {
    const result = await api<{ destination: string }>('/api/backups', {});
    setStatus(t("백업을 저장했습니다: {0}", [result.destination]));
  } catch (error) { report(error); }
}

// ----- desktop notifications (opt-in per browser) -----
const desktopKey = 'pageyard-desktop-notifications';
const seenKey = 'pageyard-notifications-seen';

export function deliverDesktopNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem(desktopKey) !== 'on') return;
  const seen = new Set(readLocal<string[]>(seenKey, []));
  for (const note of workspace.snapshot.objects.filter(item => item.kind === 'notification' && !(item as NotificationEntity).read && workspace.visible(item.id)) as NotificationEntity[]) {
    if (seen.has(note.id)) continue;
    const notification = new Notification(__APP_NAME__, { body: noteText(note.message), tag: note.id });
    notification.onclick = () => { const page = owningPage(note.parentId); if (page) navigate(page.id); notification.close(); window.focus(); };
    seen.add(note.id);
  }
  storeLocal(seenKey, JSON.stringify([...seen].slice(-1000)));
}

export const desktopNotificationsOn = () => localStorage.getItem(desktopKey) === 'on';
// Turns this browser's desktop notifications on (asking for permission) or off.
export async function setDesktopNotifications(on: boolean) {
  if (!on) { localStorage.removeItem(desktopKey); return; }
  if (!('Notification' in window)) throw new Error(t("이 브라우저는 데스크톱 알림을 지원하지 않습니다."));
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t("알림 권한이 허용되지 않았습니다. 받은 알림에서는 계속 확인할 수 있습니다."));
  storeLocal(desktopKey, 'on');
  seedSeen();
}

export function DesktopNotificationsDialog({ onClose }: { onClose: () => void }) {
  const supported = 'Notification' in window;
  const [on, setOn] = useState(() => localStorage.getItem(desktopKey) === 'on');
  return (
    <Dialog title={t("데스크톱 알림")} onClose={onClose} width={440} submitLabel={on ? t("끄기") : t("켜기")} onSubmit={async () => {
      if (!supported) throw new Error(t("이 브라우저는 데스크톱 알림을 지원하지 않습니다."));
      if (on) { localStorage.removeItem(desktopKey); setOn(false); setStatus(t("데스크톱 알림을 껐습니다.")); return; }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t("알림 권한이 허용되지 않았습니다. 받은 알림에서는 계속 확인할 수 있습니다."));
      storeLocal(desktopKey, 'on');
      setOn(true);
      seedSeen();
      setStatus(t("데스크톱 알림을 켰습니다."));
    }}>
      <p>{supported ? t("이 브라우저에서 새 알림을 데스크톱 알림으로 보여 줍니다. 현재 {0}.", [on ? t("켜짐") : t("꺼짐")]) : t("이 브라우저는 데스크톱 알림을 지원하지 않습니다.")}</p>
    </Dialog>
  );
}
function seedSeen() {
  storeLocal(seenKey, JSON.stringify(workspace.snapshot.objects.filter(item => item.kind === 'notification').map(item => item.id).slice(-1000)));
}

// ----- trash -----
function trashLabel(item: Entity): string {
  if (item.kind === 'page') return (item as PageEntity).title || t("새 페이지");
  if (item.kind === 'block') return plainText((item as BlockEntity).richText).slice(0, 60) || blockLabels[(item as BlockEntity).blockType] || t("블록");
  return workspace.title(item) || item.kind;
}

// 휴지통 as it opens from the sidebar's "…": a 414-wide panel
// (r10, menu shadow) just above that button — a search box with a blue ring, filter chips (24 high,
// r32), then rows 46 apart: icon, the name 14px and its location 12px #a19e99 beneath, restore on
// the right — and a note at the bottom. Items whose parent is also in the trash come back with it.
// Clicking a row opens the item as it was (read-only, with 복원 · 영구 삭제 over it). "영구 삭제" takes an item out of
// the trash for good (node.purge); like every change it stays in 변경 기록, where it can still be undone. With
// 설정 › 휴지통 자동 비우기 on, items trashed more than 30 days ago are purged when the app opens.
export function purgeFromTrash(items: Entity[]) {
  if (!items.length) return Promise.resolve(false);
  const label = items.length === 1 ? trashLabel(items[0]) : t("{0}개 항목", [items.length]);
  return confirmDialog(t("영구 삭제"), t("“{0}”을(를) 휴지통에서 완전히 지웁니다. 다시 열거나 복원할 수 없으며, 되돌리려면 변경 기록에서 이 작업을 취소해야 합니다.", [label]), { confirmLabel: t("영구 삭제"), danger: true })
    .then(confirmed => confirmed ? apply(items.map(item => ({ type: 'node.purge', id: item.id }))).then(() => { setStatus(t("영구 삭제했습니다.")); return true; }) : false);
}
export const TRASH_DAYS = 30;
export function trashedAt(item: Entity): string { return (item as Entity & { trashedAt?: string }).trashedAt ?? item.updatedAt; }
/** Trash roots older than 30 days (설정 › 휴지통 자동 비우기). */
export function expiredTrash(now = Date.now()): Entity[] {
  return workspace.snapshot.objects.filter(item => !item.alive && !(item as { purged?: boolean }).purged && !['notification', 'reminder', 'delivery', 'navigation', 'automation', 'attachment'].includes(item.kind))
    .filter(item => !item.parentId || workspace.get(item.parentId)?.alive !== false)
    .filter(item => now - Date.parse(trashedAt(item)) > TRASH_DAYS * 86400000);
}
function trashPath(item: Entity): string {
  const names: string[] = [];
  let current = workspace.get(item.parentId ?? '');
  while (current && names.length < 6) {
    if (current.kind === 'page' || current.kind === 'source') names.unshift(workspace.title(current) || t("새 페이지"));
    current = workspace.get(current.parentId ?? '');
  }
  if (names.length > 2) return `${names[0]} / … / ${names[names.length - 1]}`;
  return names.join(' / ');
}

export function TrashDialog({ onClose, anchor }: { onClose: () => void; anchor?: Element | null }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<string | null>(null);
  const [placeMenu, setPlaceMenu] = useState<Element | null>(null);
  const settings = useSettings();
  const roots = useMemo(() => ws.snapshot.objects
    .filter(item => !item.alive && !(item as { purged?: boolean }).purged && !['notification', 'reminder', 'delivery', 'navigation', 'automation', 'attachment'].includes(item.kind))
    // Only roots: items whose parent is alive (children come back with their parent).
    .filter(item => !item.parentId || ws.get(item.parentId)?.alive !== false)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [ws.version]);
  const places = useMemo(() => {
    const seen = new Map<string, PageEntity>();
    for (const item of roots) { const page = owningPage(item.parentId); if (page && !seen.has(page.id)) seen.set(page.id, page); }
    return [...seen.values()];
  }, [roots]);
  const items = roots
    .filter(item => !place || owningPage(item.parentId)?.id === place)
    .filter(item => !query.trim() || trashLabel(item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const placePage = place ? ws.get<PageEntity>(place) : null;
  const restore = (item: Entity) => apply([{ type: 'node.restore', id: item.id }]).then(() => setStatus(t("복원했습니다."))).catch(report);
  return (
    <Popover anchor={anchor ?? { x: window.innerWidth / 2 - 207, y: 120 }} placement={anchor ? 'above-start' : 'point'} offset={6} onClose={onClose} className="trash-panel" label={t("휴지통")}>
      <div className="trash-search"><input className="trash-search-input" autoFocus placeholder={t("휴지통에서 검색")} value={query} onChange={event => setQuery(event.target.value)} aria-label={t("휴지통에서 검색")} /></div>
      <div className="trash-filters">
        <button type="button" className={`trash-chip${place ? ' active' : ''}`} onClick={event => setPlaceMenu(event.currentTarget)}>
          <Icon name="page" size={14} /><span>{placePage ? (placePage.title || t("새 페이지")) : t("page-location|위치")}</span><Icon name="chevron-down" size={12} />
        </button>
      </div>
      <div className="trash-list" role="list">
        {items.map(item => (
          <div key={item.id} className={`trash-row${item.kind === 'page' ? ' openable' : ''}`} role="listitem" data-id={item.id}
            onClick={() => { const target = item.kind === 'page' ? item.id : owningPage(item.parentId)?.id; if (target && item.kind === 'page') { onClose(); navigate(target); } }}>
            <span className="trash-row-icon"><EntityIcon item={item} size={18} /></span>
            <div className="trash-main">
              <div className="trash-title">{trashLabel(item)}</div>
              {trashPath(item) ? <div className="trash-path">{trashPath(item)}</div> : null}
            </div>
            <button type="button" className="trash-action" title={t("페이지 복원")} aria-label={t("페이지 복원")} onClick={event => { event.stopPropagation(); restore(item); }}><Icon name="undo" size={16} /></button>
            <button type="button" className="trash-action danger" title={t("영구 삭제")} aria-label={t("영구 삭제")} onClick={event => { event.stopPropagation(); purgeFromTrash([item]).catch(report); }}><Icon name="trash" size={16} /></button>
          </div>
        ))}
        {!items.length ? <div className="trash-empty"><Icon name="trash" size={28} /><p>{query || place ? t("결과 없음") : t("휴지통이 비어 있습니다.")}</p></div> : null}
      </div>
      <div className="trash-foot"><span>{settings.trashAutoPurge ? t("휴지통에 30일 넘게 있는 페이지는 자동으로 영구 삭제됩니다.") : t("휴지통의 페이지는 직접 영구 삭제할 때까지 복원할 수 있습니다.")}</span><Icon name="question" size={16} /></div>
      {placeMenu ? (
        <Menu anchor={placeMenu} placement="below-start" width={240} search={t("페이지 검색…")} onClose={() => setPlaceMenu(null)} entries={[
          { label: t("모든 위치"), checked: !place, onSelect: () => setPlace(null) },
          ...places.map(page => ({ label: page.title || t("새 페이지"), icon: <EntityIcon item={page} size={18} />, checked: place === page.id, onSelect: () => setPlace(page.id) } as MenuEntry)),
        ]} />
      ) : null}
    </Popover>
  );
}

