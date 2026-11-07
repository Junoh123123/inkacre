import { t } from '../i18n';
import type { ReactNode } from 'react';
import type { EditorView } from 'prosemirror-view';
import { mountTransient } from '../ui/primitives';
import type { Anchor, Placement } from '../ui/overlay';
import { report } from '../data/store';
import type { PageSync } from '../editor/sync';
import type { PageEntity, ReminderEntity } from '../data/types';
import { ShortcutsWindow } from '../shell/Shortcuts';
import { DeliveriesDialog, DesktopNotificationsDialog, HistoryDialog, ImportDialog, InboxDialog, PendingDialog, RunsDialog, TrashDialog, runBackup } from './workspaceDialogs';
import { ButtonSettingsDialog, CommentDialog, ExportDialog, LinkPageDialog, LinkedViewDialog, MoveBlocksDialog, MovePageDialog, PagePicker, ReminderDialog, SyncedReferenceDialog, VersionDialog, turnIntoPage } from './pageDialogs';
import { FormQuestionsDialog } from '../database/FormView';
import { VersionHistoryDialog } from './VersionHistory';
import { NewDatabaseDialog, PropertyDialog, RecurrenceDialog, TaskSettingsDialog, SprintSettingsDialog, TemplatesDialog } from './databaseDialogs';
import { TemplateGallery } from './TemplateGallery';
import { TimeMachineDialog } from './TimeMachine';

// One entry point for every panel and dialog (sidebar, menus, slash commands, editor).

type Args = Record<string, unknown>;
type Factory = (args: Args, close: () => void) => ReactNode;

const dialogs: Record<string, Factory> = {
  inbox: (_args, close) => <InboxDialog onClose={close} />,
  history: (args, close) => <HistoryDialog onClose={close} pageId={args.pageId as string | undefined} />,
  versions: (args, close) => <VersionHistoryDialog onClose={close} pageId={args.pageId as string} revision={Number(args.revision)} />,
  'version-history': (args, close) => <VersionHistoryDialog onClose={close} pageId={args.pageId as string} sourceId={args.sourceId as string | undefined} revision={args.revision === undefined ? undefined : Number(args.revision)} />,
  runs: (_args, close) => <RunsDialog onClose={close} />,
  'time-machine': (_args, close) => <TimeMachineDialog onClose={close} />,
  pending: (_args, close) => <PendingDialog onClose={close} />,
  deliveries: (_args, close) => <DeliveriesDialog onClose={close} />,
  import: (args, close) => <ImportDialog onClose={close} parentId={(args.parentId as string | undefined) ?? null} sourceId={(args.sourceId as string | undefined) ?? null} />,
  'desktop-notifications': (_args, close) => <DesktopNotificationsDialog onClose={close} />,
  trash: (args, close) => <TrashDialog onClose={close} anchor={(args.anchor as Element | undefined) ?? document.querySelector(".sidebar:not(.closed) .sidebar-foot .sidebar-more-button")} />,
  shortcuts: (_args, close) => <ShortcutsWindow onClose={close} />,
  move: (args, close) => <MovePageDialog onClose={close} id={args.id as string} anchor={args.anchor as Anchor | undefined} placement={args.placement as Placement | undefined} />,
  'pick-page': (args, close) => <PagePicker onClose={close} title={args.title as string} placeholder={args.placeholder as string} allowRoot={!!args.allowRoot} onPick={args.onPick as (page: PageEntity | null) => Promise<void>} />,
  'move-blocks': (args, close) => <MoveBlocksDialog onClose={close} ids={args.ids as string[]} pageId={args.pageId as string} anchor={args.anchor as Anchor | undefined} placement={args.placement as Placement | undefined} />,
  'link-page': (args, close) => <LinkPageDialog onClose={close} view={args.view as EditorView} sync={args.sync as PageSync | undefined} block={!!args.block} />,
  'linked-view': (args, close) => <LinkedViewDialog onClose={close} view={args.view as EditorView} pageId={args.pageId as string} sync={args.sync as PageSync} />,
  'synced-reference': (args, close) => <SyncedReferenceDialog onClose={close} view={args.view as EditorView} pageId={args.pageId as string} sync={args.sync as PageSync} />,
  comment: (args, close) => <CommentDialog onClose={close} parentId={args.parentId as string} quote={args.quote as string | undefined} />,
  reminder: (args, close) => <ReminderDialog onClose={close} parentId={args.parentId as string} existing={args.existing as ReminderEntity | undefined} />,
  button: (args, close) => <ButtonSettingsDialog onClose={close} ownerId={args.ownerId as string} />,
  export: (args, close) => <ExportDialog onClose={close} id={args.id as string} viewId={(args.viewId as string | undefined) ?? null} />,
  property: (args, close) => <PropertyDialog onClose={close} sourceId={args.sourceId as string} propertyId={args.propertyId as string | undefined} initialType={args.type as never} onCreated={args.onCreated as ((id: string) => void) | undefined} />,
  templates: (args, close) => <TemplatesDialog onClose={close} sourceId={args.sourceId as string} />,
  recurrence: (args, close) => <RecurrenceDialog onClose={close} templateId={args.templateId as string} />,
  'task-settings': (args, close) => <TaskSettingsDialog onClose={close} sourceId={args.sourceId as string} />,
  'sprint-settings': (args, close) => <SprintSettingsDialog onClose={close} sourceId={args.sourceId as string} />,
  'form-questions': (args, close) => <FormQuestionsDialog viewId={args.viewId as string} onClose={close} />,
  'template-gallery': (args, close) => <TemplateGallery onClose={close} parentId={(args.parentId as string | null | undefined) ?? null} />,
  'new-database': (args, close) => <NewDatabaseDialog onClose={close} pageId={args.pageId as string} onCreated={args.onCreated as ((id: string) => void) | undefined} />,
};

export function openWorkspaceDialog(name: string, args: Args = {}) {
  if (name === 'backup') { runBackup().catch(report); return; }
  if (name === 'turn-into-page') {
    const view = args.view as EditorView | undefined;
    const sync = args.sync as PageSync | undefined;
    const pageId = args.pageId as string | undefined;
    const host = view?.dom.closest<HTMLElement>('[data-page-id]');
    const resolvedPage = pageId ?? host?.dataset.pageId;
    const resolvedSync = sync ?? (host as unknown as { __sync?: PageSync } | null)?.__sync;
    if (view && resolvedPage && resolvedSync) turnIntoPage(view, resolvedPage, resolvedSync).catch(report);
    return;
  }
  const factory = dialogs[name];
  if (!factory) { report(new Error(t("알 수 없는 창: {0}", [name]))); return; }
  mountTransient(close => factory(args, close));
}
