import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useRoute, navigate, currentRoute, hrefFor } from '../data/router';
import { openWorkspaceDialog } from '../dialogs/registry';
import { useWorkspace, report, setStatus, workspace } from '../data/store';
import { getSettings, resolvedTheme, updateSettings, useSettings } from '../data/settings';
import { expiredTrash } from '../dialogs/workspaceDialogs';
import { apply } from '../data/commands';
import { redoLast, undoLast } from '../data/commands';
import { Sidebar } from './Sidebar';
import { TooltipLayer } from '../ui/Tooltip';
import { HtmlFullscreen } from '../editor/HtmlBlock';
import { Topbar } from './Topbar';
import { UpdatesPanel, useUpdatesPanel } from '../page/UpdatesPanel';
import { SearchModal } from './SearchModal';
import { Toast } from './Toast';
import { InboxPanel } from './InboxPanel';
import { SettingsHost } from './SettingsModal';
import { MainView } from './MainView';
import { Peek } from '../page/Peek';
import { createPage, settleFreshPage } from '../page/actions';
import { readLocal, storeLocal } from '../data/api';
import { openLayerCount } from '../ui/overlay';
import { Welcome, welcomedKey } from './Welcome';
import { TimeMachineBar } from '../dialogs/TimeMachine';
import { inTimeMachine } from '../data/timeMachine';
import { FindInPage, openFindInPage } from '../page/FindInPage';

const sidebarKey = 'pageyard-sidebar-open';

// Switching between views of one database keeps the page mounted (scroll, panels).
function mainKey(id: string | null) {
  const item = id ? workspace.get(id) : undefined;
  if (item?.kind === 'view') return `source:${(item as { sourceId: string }).sourceId}`;
  return id ?? 'home';
}

export function App() {
  const route = useRoute();
  const ws = useWorkspace();
  // A new display time zone shows every time on the page again (rows and cells keep their own memo).
  const timeZone = useSettings().timeZone ?? '';
  const [sidebarOpen, setSidebarOpen] = useState(() => readLocal(sidebarKey, true));
  const [searchOpen, setSearchOpen] = useState(false);
  // First run: an empty workspace that nobody has started in this browser yet.
  const [welcomed, setWelcomed] = useState(() => readLocal(welcomedKey, false));
  useEffect(() => { storeLocal(sidebarKey, JSON.stringify(sidebarOpen)); }, [sidebarOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      // Keys an editor or menu already handled (⌘K on selected text adds a link, not search).
      if (!mod || event.isComposing || event.defaultPrevented) return;
      if (event.ctrlKey && event.shiftKey && !event.metaKey && (event.code === 'KeyK' || event.code === 'KeyJ')) return; // peek previous / next
      const key = event.key.toLowerCase();
      const editing = (document.activeElement as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      const pageId = () => { const id = currentRoute().peek ?? currentRoute().id; return id && workspace.get(id)?.kind === 'page' ? id : null; };
      // The shortcuts listed in the keyboard shortcuts window (⌘⌥/).
      if (event.altKey && event.code === 'Slash') { event.preventDefault(); openWorkspaceDialog('shortcuts'); return; }
      if (event.code === 'KeyL' && event.shiftKey && !event.altKey) { event.preventDefault(); updateSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }); return; }
      if (event.code === 'KeyL' && !event.shiftKey && !event.altKey) {
        const id = pageId();
        if (id) { event.preventDefault(); navigator.clipboard.writeText(new URL(hrefFor(id), location.href).href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report); }
        return;
      }
      if ((event.code === 'BracketLeft' || event.code === 'BracketRight') && !event.shiftKey && !event.altKey && !editing) { event.preventDefault(); if (event.code === 'BracketLeft') history.back(); else history.forward(); return; }
      if (event.code === 'KeyU' && event.shiftKey && !event.altKey) {
        // ⌘⇧U: the page this one sits in (a database row goes to the page holding its database).
        const id = pageId();
        let parent = id ? workspace.get(workspace.get(id)!.parentId) : undefined;
        while (parent && parent.kind !== 'page') parent = workspace.get(parent.parentId);
        event.preventDefault();
        if (parent) navigate(parent.id);
        return;
      }
      // ⌘⇧P moves the open page (as listed in the page menus); ⌘P / ⌘K search.
      if (key === 'p' && event.shiftKey) {
        const id = currentRoute().peek ?? currentRoute().id;
        if (id && workspace.get(id)?.kind === 'page') { event.preventDefault(); openWorkspaceDialog('move', { id }); }
        return;
      }
      // ⌘F: find in the open page (or peek); the library and dialogs keep the browser's own find.
      if (key === 'f' && !event.shiftKey && !event.altKey && (currentRoute().id || currentRoute().peek) && !openLayerCount()) { event.preventDefault(); openFindInPage(); return; }
      if ((key === 'k' || key === 'p') && !event.altKey) { event.preventDefault(); setSearchOpen(open => !open); return; }
      if (key === '\\') { event.preventDefault(); setSidebarOpen(open => !open); return; }
      if (key === 'n' && !event.shiftKey && !event.altKey) { event.preventDefault(); createPage({ parentId: null }).catch(report); return; }
      if (key === 'z' && !editing && !openLayerCount()) {
        event.preventDefault();
        (event.shiftKey ? redoLast() : undoLast()).catch(report);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 설정 › 휴지통 자동 비우기: once per opening, items trashed more than 30 days ago are purged.
  const purged = useRef(false);
  useEffect(() => {
    if (!ws.loaded || purged.current || !getSettings().trashAutoPurge) return;
    purged.current = true;
    const expired = expiredTrash().slice(0, 500);
    if (expired.length) apply(expired.map(item => ({ type: 'node.purge', id: item.id }))).then(() => setStatus(t("휴지통에서 30일이 지난 항목 {0}개를 영구 삭제했습니다.", [expired.length]))).catch(report);
  }, [ws.loaded]);

  useEffect(() => {
    const current = route.id ? ws.get(route.id) : undefined;
    document.title = current ? `${ws.title(current) || t("새 페이지")} · ${__APP_NAME__}` : __APP_NAME__;
  }, [route.id, ws.version]);

  // Typing hides the top bar (and hover handles) at once; moving the mouse brings it back with
  // a 700ms fade.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!(event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter' || event.key === 'Process')) return;
      if (!(event.target as HTMLElement | null)?.closest?.('.page-editor, .page-title')) return;
      setTyping(true);
    };
    const onMove = () => setTyping(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousemove', onMove); };
  }, []);

  // With the sidebar closed, resting on its button (or on the panel itself) slides the sidebar in
  // as a floating panel; leaving both slides it out again (200ms ease).
  const [floating, setFloating] = useState<'off' | 'in' | 'out'>('off');
  const floatTimer = useRef(0);
  const onFloatHover = (inside: boolean) => {
    window.clearTimeout(floatTimer.current);
    if (inside) { setFloating('in'); return; }
    floatTimer.current = window.setTimeout(() => {
      setFloating(current => (current === 'in' ? 'out' : current));
      floatTimer.current = window.setTimeout(() => setFloating(current => (current === 'out' ? 'off' : current)), 220);
    }, 150);
  };
  useEffect(() => { if (sidebarOpen) { window.clearTimeout(floatTimer.current); setFloating('off'); } }, [sidebarOpen]);

  // A closing side peek slides out (200ms ease) before it goes away.
  const [leaving, setLeaving] = useState<{ id: string; mode: 'side' | 'center' } | null>(null);
  const lastPeek = useRef<{ id: string; mode: 'side' | 'center' } | null>(null);
  useEffect(() => {
    const previous = lastPeek.current;
    lastPeek.current = route.peek ? { id: route.peek, mode: route.peekMode } : null;
    if (previous && previous.id !== route.peek) settleFreshPage(previous.id);
    if (route.peek) { setLeaving(null); return; }
    if (previous?.mode !== 'side') return;
    setLeaving(previous);
    const timer = window.setTimeout(() => setLeaving(null), 200);
    return () => window.clearTimeout(timer);
  }, [route.peek, route.peekMode]);
  const peekId = route.peek ?? leaving?.id ?? null;
  const updates = useUpdatesPanel();

  return (
    <div className={`app${updates.open ? ' updates-open' : ''}${typing ? ' typing' : ''}${sidebarOpen ? ' sidebar-open' : ' sidebar-closed'}${route.peek && route.peekMode === 'side' ? ' peek-open' : ''}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onSearch={() => setSearchOpen(true)} floating={floating} onFloatHover={onFloatHover} />
      <main className="main-frame">
        {inTimeMachine() ? <TimeMachineBar /> : null}
        <Topbar sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} onFloatHover={onFloatHover} />
        <MainView key={`${mainKey(route.id)}|${timeZone}`} />
        <UpdatesPanel />
      </main>
      {peekId ? <Peek rowId={peekId} mode={route.peek ? route.peekMode : leaving?.mode ?? 'side'} closing={!route.peek} /> : null}
      {searchOpen ? <SearchModal onClose={() => setSearchOpen(false)} onOpen={id => { setSearchOpen(false); navigate(id); }} /> : null}
      <InboxPanel />
      <FindInPage />
      <SettingsHost />
      <Toast />
      <TooltipLayer />
      <HtmlFullscreen />
      {ws.loaded && ws.revision === 0 && !welcomed && !inTimeMachine() ? <Welcome onDone={() => setWelcomed(true)} /> : null}
    </div>
  );
}
