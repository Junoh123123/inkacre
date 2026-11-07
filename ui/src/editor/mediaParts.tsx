import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { NodeSelection } from 'prosemirror-state';
import { useWorkspace, report, workspace } from '../data/store';
import { attachFromUrl, uploadFile, type RemoteKind } from '../data/commands';
import type { AttachmentEntity, BlockEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';
import { takeAutoOpen } from './autoOpen';
import type { AtomProps } from './atoms';
import type { PageSync } from './sync';

// Pieces the media blocks share: the block from the store, selecting the block, the "saving" note, the empty
// block and the picker (업로드 · 링크 · 저장된 첨부).

export function useBlock(id: string) {
  const ws = useWorkspace();
  return ws.get<BlockEntity>(id);
}

export function selectSelf(props: AtomProps) {
  const pos = props.entry.getPos();
  if (pos === undefined) return;
  props.view.dispatch(props.view.state.tr.setSelection(NodeSelection.create(props.view.state.doc, pos)));
}

export function Pending({ label }: { label: string }) {
  return <div className="atom-pending">{t("{0} 저장 중…", [label])}</div>;
}

// Empty media block: 49 high, r10, filled
// rgba(66,35,3,.03), 25px icon at 12/12 in #8e8b86, 14px label in #7d7a75 from x 49. A click
// opens the picker under its middle: 300 wide, tabs 업로드 · 링크, a full-width blue "파일 선택".
export function EmptyMedia({ icon, label, onClick, blockId }: { icon: string; label: string; onClick: (anchor: Element) => void; blockId?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  // Made from the / menu just now: the picker opens at once.
  useEffect(() => { if (blockId && takeAutoOpen(blockId) && ref.current) onClick(ref.current); }, []);
  return (
    <button ref={ref} type="button" className="media-empty" onClick={event => onClick(event.currentTarget)}>
      <Icon name={icon} size={24} /><span>{label}</span>
    </button>
  );
}

export type PickerKind = 'image' | 'file' | 'video' | 'audio' | 'pdf';

// The picker. 링크: for a video, a YouTube or Vimeo address played in place (or an audio file's address); for an image,
// a file or a PDF, the file at that address is downloaded once by the local server and kept as an attachment.
export function AttachmentPicker({ anchor, block, kind, onClose, sync }: { anchor: Element; block: BlockEntity; kind: PickerKind; onClose: () => void; sync: PageSync }) {
  const ws = useWorkspace();
  const [tab, setTab] = useState<'upload' | 'saved' | 'link'>('upload');
  const [url, setUrl] = useState(kind === 'video' || kind === 'audio' ? block.url ?? '' : '');
  const [busy, setBusy] = useState(false);
  const accept = kind === 'image' ? 'image/png,image/jpeg,image/gif,image/webp,image/avif' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : kind === 'pdf' ? 'application/pdf,.pdf' : '';
  const saved = ws.snapshot.objects.filter(item => item.kind === 'attachment' && item.alive && (kind === 'file' || (kind === 'pdf' ? (item as AttachmentEntity).mediaType === 'application/pdf' : (item as AttachmentEntity).mediaType.startsWith(`${kind}/`)))) as AttachmentEntity[];
  const embedsLink = kind === 'video' || kind === 'audio';
  const upload = async (file: File) => {
    onClose();
    await sync.flush();
    if (kind === 'video' || kind === 'audio') {
      const result = await uploadFile(file, workspace.revision);
      await sync.command([{ type: 'block.update', id: block.id, attachmentId: result.attachmentId }]);
    } else await uploadFile(file, workspace.revision, { blockId: block.id });
  };
  const fromLink = async (address: string) => {
    setBusy(true);
    try {
      await sync.flush();
      await attachFromUrl(address, kind as RemoteKind, { blockId: block.id });
      onClose();
    } catch (error) { report(error); } finally { setBusy(false); }
  };
  return (
    <Popover anchor={anchor} placement="below-center" onClose={onClose} className="embed-popover" style={{ width: 300 }}>
      <div className="embed-tabs">
        <button type="button" className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>{t("업로드")}</button>
        <button type="button" className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>{t("링크")}</button>
        {saved.length ? <button type="button" className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>{t("저장된 첨부")}</button> : null}
      </div>
      <div className="embed-body">
        {tab === 'upload' ? (
          <label className="blue-button upload-button">{t("파일 선택")}<input type="file" accept={accept} hidden onChange={event => { const file = event.target.files?.[0]; if (file) upload(file).catch(report); }} />
          </label>
        ) : tab === 'saved' ? (
          <div className="embed-list">
            {saved.map(item => (
              <button type="button" key={item.id} className="embed-list-row" onClick={() => { onClose(); sync.command([{ type: 'block.update', id: block.id, attachmentId: item.id }]).catch(report); }}>
                <Icon name={kind === 'image' ? 'image' : 'file'} size={18} /><span>{item.name}</span>
              </button>
            ))}
          </div>
        ) : embedsLink ? (
          <form className="embed-link" onSubmit={event => { event.preventDefault(); onClose(); sync.command([{ type: 'block.update', id: block.id, url }]).catch(report); }}>
            <input className="text-input" placeholder={kind === 'audio' ? t("오디오 파일 링크를 붙여넣으세요") : t("YouTube 또는 Vimeo 링크를 붙여넣으세요")} value={url} onChange={event => setUrl(event.target.value)} autoFocus />
            <button type="submit" className="blue-button">{kind === 'audio' ? t("오디오 임베드") : t("동영상 임베드")}</button>
          </form>
        ) : (
          <form className="embed-link" onSubmit={event => { event.preventDefault(); if (url.trim()) fromLink(url.trim()).catch(report); }}>
            <input className="text-input" placeholder={kind === 'image' ? t("이미지 링크를 붙여넣으세요") : kind === 'pdf' ? t("PDF 링크를 붙여넣으세요") : t("파일 링크를 붙여넣으세요")} value={url} onChange={event => setUrl(event.target.value)} autoFocus disabled={busy} />
            <button type="submit" className="blue-button" disabled={busy || !/^https?:\/\//i.test(url.trim())}>{busy ? t("가져오는 중…") : kind === 'image' ? t("이미지 넣기") : t("파일 넣기")}</button>
            <p className="embed-note">{t("한 번 내려받아 로컬 첨부로 저장합니다. 원래 주소가 바뀌어도 그대로 보입니다.")}</p>
          </form>
        )}
        {tab !== 'link' ? <p className="embed-note">{t("16 MiB 이하 파일. 파일은 로컬 첨부로 저장됩니다.")}</p> : null}
      </div>
    </Popover>
  );
}
