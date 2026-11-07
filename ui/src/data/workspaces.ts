import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { api, readLocal } from './api';
import { apply } from './commands';
import { useWorkspace } from './store';

// 워크스페이스: this workspace's name and icon (kept in its own data, entity "workspace-settings"), and the other
// workspaces on this computer — each its own data folder and local address (src/workspaces.mjs).

export interface WorkspaceInfo { id: string; name: string | null; icon: string | null; url: string | null; current: boolean }
interface SettingsEntity { id: string; kind: 'settings'; name?: string | null; icon?: string | null }

// Before names lived in the data, each browser kept its own; that name still shows until one is saved.
const legacyName = () => readLocal<string>('pageyard-workspace-name', '') || '';
export const defaultWorkspaceName = () => t("내 워크스페이스");

export function useWorkspaceIdentity(): { name: string; icon: string | null } {
  const ws = useWorkspace();
  const entity = ws.get('workspace-settings') as unknown as SettingsEntity | undefined;
  return { name: entity?.name || legacyName() || defaultWorkspaceName(), icon: entity?.icon ?? null };
}
export function setWorkspaceIdentity(patch: { name?: string | null; icon?: string | null }) {
  return apply([{ type: 'workspace.update', ...patch }]);
}

export function useWorkspaceList(open = true): WorkspaceInfo[] | null {
  const [list, setList] = useState<WorkspaceInfo[] | null>(null);
  const ws = useWorkspace();
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/workspaces').then(response => response.ok ? response.json() : { workspaces: [] }).then(data => { if (!cancelled) setList((data.workspaces ?? []) as WorkspaceInfo[]); }).catch(() => { if (!cancelled) setList([]); });
    return () => { cancelled = true; };
  }, [open, ws.version]);
  return list;
}

export async function createWorkspace(name: string) {
  const result = await api<{ id: string; url: string }>('/api/workspaces/create', { name: name.trim() || t("새 워크스페이스") });
  location.href = result.url;
}
export async function copyToWorkspace(pageId: string, targetId: string, move = false) {
  return api<{ pageId: string; url: string }>('/api/workspaces/copy', { pageId, targetId, move });
}
