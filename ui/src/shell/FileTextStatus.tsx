import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { api } from '../data/api';
import { useWorkspace } from '../data/store';

// 설정 › 일반 › 첨부 파일 내용 검색: how many attached files have been read for search, refreshed while some still wait.
interface Status { off?: boolean; files: number; readable: number; indexed: number; pending: number; failed: number; encrypted: number; unsupported: number; reading: boolean }

export function FileTextStatus() {
  const ws = useWorkspace();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let cancelled = false, timer = 0;
    const load = () => api<Status>('/api/file-text').then(next => {
      if (cancelled) return;
      setStatus(next);
      if (!next.off && next.pending > 0) timer = window.setTimeout(load, 1500);
    }).catch(() => undefined);
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ws.revision]);
  if (!status) return <span className="prefs-row-note">…</span>;
  if (status.off) return <span className="prefs-row-note">{t("꺼져 있음")}</span>;
  const parts = [t("읽을 수 있는 파일 {0}개 중 {1}개 색인됨", [status.readable, status.indexed])];
  if (status.pending) parts.push(t("{0}개 읽는 중", [status.pending]));
  if (status.encrypted) parts.push(t("암호가 걸린 파일 {0}개", [status.encrypted]));
  if (status.failed) parts.push(t("읽지 못한 파일 {0}개", [status.failed]));
  return <span className="file-text-status" data-pending={status.pending || undefined}>{parts.join(' · ')}</span>;
}
