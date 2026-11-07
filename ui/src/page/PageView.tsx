import { t, tx } from '../i18n';
import { inTimeMachine } from '../data/timeMachine';
import { TocRail } from './TocRail';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { apply, attachFromUrl, titleDraftKey, uploadFile } from '../data/commands';
import { readLocal, storeLocal } from '../data/api';
import { report, useWorkspace, workspace, setStatus } from '../data/store';
import { usePageDetail } from '../data/hooks';
import { navigate, openPeek, hrefFor, currentRoute } from '../data/router';
import { displayDate, plainText, propertyLabels, relativeTime, avatarLetter } from '../data/format';
import type { AttachmentEntity, CommentEntity, PageEntity, PropertyEntity, ReminderEntity, SourceEntity, ViewEntity } from '../data/types';
import { Icon, iconNames, viewIcon } from '../ui/Icon';
import { Popover, type Anchor, type Placement } from '../ui/overlay';
import { Menu, type MenuEntry } from '../ui/Menu';
import { applyStartTemplate, startTemplates } from './startTemplates';
import { layoutPlan } from '../database/PageLayoutEditor';
import { DatabaseFrame } from '../database/DatabaseFrame';
import { useLocalPreference } from '../data/hooks';
import { recordPageView } from './UpdatesPanel';
import { isDatabaseLocked } from '../database/shared';
import { PageEditor, type PageEditorHandle } from '../editor/PageEditor';
import { blockAt } from '../editor/blocks';
import { Presentation, presentationEvent, slideOf } from './Presentation';
import { EditableValue, propertyIcon } from '../database/values';
import { EntityIcon } from './EntityIcon';
import { emojiGroups, randomEmoji, withSkin } from './emoji';
export { withSkin };
import { openWorkspaceDialog } from '../dialogs/registry';
import { createDatabase, createRow, createTemplate } from './actions';
import { WikiPages, WikiTabs, useWikiTab } from './Wiki';
import { PropertyComments } from './PropertyComments';

// ---------- per-viewer page style (font, small text, lock) — the engine does not store these ----------

export interface PageStyle { font: 'default' | 'serif' | 'mono'; small: boolean; locked: boolean; toc?: boolean; topComments?: boolean; /** "댓글(페이지 내)": cards in the margin, minimised to bubbles, or hidden. */ inlineComments?: 'default' | 'minimal' | 'off' }
const styleKey = (id: string) => `pageyard-page-style:${id}`;
const styleListeners = new Set<() => void>();
const styleVersion = { value: 0 };
export function getPageStyle(id: string): PageStyle { return { font: 'default', small: false, locked: false, ...readLocal<Partial<PageStyle>>(styleKey(id), {}) }; }
export function setPageStyle(id: string, patch: Partial<PageStyle>) {
  storeLocal(styleKey(id), JSON.stringify({ ...getPageStyle(id), ...patch }));
  styleVersion.value++;
  for (const listener of styleListeners) listener();
}
export function usePageStyle(id: string): PageStyle {
  useSyncExternalStore(listener => { styleListeners.add(listener); return () => styleListeners.delete(listener); }, () => styleVersion.value);
  return getPageStyle(id);
}

// 페이지 잠금 is stored on the page (page.update locked) so every browser and agent sees it; "이번만 편집" unlocks it
// for this window only (until reload). Locks kept in this browser by earlier versions still count.
const unlockedPages = new Set<string>();
export function pageLockStored(page: PageEntity) { return !!page.locked || getPageStyle(page.id).locked; }
export function isPageLocked(page: PageEntity) { return inTimeMachine() || (pageLockStored(page) && !unlockedPages.has(page.id)); }
export function setPageLock(page: PageEntity, locked: boolean) {
  unlockedPages.delete(page.id);
  if (getPageStyle(page.id).locked) setPageStyle(page.id, { locked: false }); else { styleVersion.value++; styleListeners.forEach(listener => listener()); }
  return apply([{ type: 'page.update', id: page.id, locked }]).then(() => setStatus(locked ? t("페이지를 잠갔습니다.") : t("페이지 잠금을 해제했습니다."))).catch(report);
}
export function unlockPageForNow(id: string, unlock = true) {
  if (unlock) unlockedPages.add(id); else unlockedPages.delete(id);
  styleVersion.value++; styleListeners.forEach(listener => listener());
}

// The first page or item up the chain that is in the trash (the one 복원 brings back), if any.
export function trashRoot(id: string): { id: string; purged: boolean } | null {
  const seen = new Set<string>();
  for (let item = workspace.get(id); item && !seen.has(item.id); item = workspace.get(item.parentId)) {
    seen.add(item.id);
    if (item.purged) return { id: item.id, purged: true };
    if (!item.alive) return { id: item.id, purged: false };
  }
  return null;
}
// The archived page this one is (or sits under), if any.
export function archivedRoot(id: string): PageEntity | null {
  const seen = new Set<string>();
  for (let item = workspace.get(id); item && !seen.has(item.id); item = workspace.get(item.parentId)) {
    seen.add(item.id);
    if (item.kind === 'page' && (item as PageEntity).archived) return item as PageEntity;
  }
  return null;
}

// ---------- emoji picker ----------

const recentEmojiKey = 'pageyard-recent-emoji';

// Icon picker (408 wide): tabs 이모지 | 아이콘 (14/400, the current one
// underlined) with 제거 on the right when there is an icon; a search box with a blue ring, then
// 무작위 (28, outlined) and — on the emoji tab — the skin tone; 12 columns of 32px cells (24px
// emoji) under 12px group heads; along the bottom a bar of 32×32 group buttons that jump to each
// group (the one in view tinted). The 아이콘 tab lists line icons, coloured by the circle button.
const iconColors = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
const pickerIconNames = iconNames.filter(name => !/^(type-|status-|insert-|table-header|double-|triangle-|chevron-|peek-|sidebar|clear-|bold|italic|underline|strike)/.test(name));

// Skin tones for emoji that take them (the hand button beside 무작위); the choice is remembered.
const skinKey = 'pageyard-emoji-skin';
const skinTones = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const skinNames = [t("기본"), t("밝은 피부색"), t("중간 밝은 피부색"), t("중간 피부색"), t("중간 어두운 피부색"), t("어두운 피부색")];

export function EmojiPicker({ anchor, onPick, onRemove, onClose, upload = false, emojiOnly = false, customReactions = false, placement = 'below-center' }: { anchor: Anchor; onPick: (emoji: string) => void; onRemove?: () => void; onClose: () => void; upload?: boolean; emojiOnly?: boolean; customReactions?: boolean; placement?: Placement }) {
  const [tab, setTab] = useState<'emoji' | 'icon' | 'upload'>('emoji');
  const [skin, setSkin] = useState(() => readLocal<number>(skinKey, 0));
  const [skinMenu, setSkinMenu] = useState<Element | null>(null);
  const [busy, setBusy] = useState(false);
  const tone = skinTones[skin] ?? '';
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<(typeof iconColors)[number]>('gray');
  const [colorMenu, setColorMenu] = useState<Element | null>(null);
  const [current, setCurrent] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const recent = readLocal<string[]>(recentEmojiKey, []);
  const needle = query.trim().toLocaleLowerCase();
  // 사용자 지정 이모지 come first for icons (picked as the picture, "attachment:<id>"); reactions keep plain emoji.
  const customEmoji = emojiOnly && !customReactions ? [] : Object.entries(workspace.customEmoji()).sort(([a], [b]) => a.localeCompare(b)).map(([name, id]) => ({ emoji: `attachment:${id}`, words: name }));
  const groups = needle
    ? [{ name: t("검색 결과"), items: [...customEmoji, ...emojiGroups.flatMap(group => group.items)].filter(item => item.words.toLocaleLowerCase().includes(needle) || item.emoji === needle) }]
    : [...(customEmoji.length ? [{ name: t("사용자 지정"), items: customEmoji }] : []), ...(recent.length ? [{ name: t("최근 사용"), items: recent.filter(emoji => !emoji.startsWith('icon:') && !emoji.startsWith('attachment:')).map(emoji => ({ emoji, words: '' })) }] : []), ...emojiGroups];
  const icons = pickerIconNames.filter(name => !needle || name.includes(needle));
  const pick = (raw: string) => {
    const emoji = raw.startsWith('icon:') || raw.startsWith('attachment:') ? raw : withSkin(raw, tone);
    if (!raw.startsWith('attachment:')) storeLocal(recentEmojiKey, JSON.stringify([emoji, ...recent.filter(item => item !== emoji)].slice(0, 18)));
    onPick(emoji);
    onClose();
  };
  const useFile = async (file: File) => {
    setBusy(true);
    try { const result = await uploadFile(file, workspace.revision); pick(`attachment:${result.attachmentId}`); } catch (error) { report(error); } finally { setBusy(false); }
  };
  const jump = (index: number) => {
    const target = scrollerRef.current?.querySelectorAll<HTMLElement>('.emoji-group')[index];
    if (target && scrollerRef.current) scrollerRef.current.scrollTop = target.offsetTop - scrollerRef.current.offsetTop;
  };
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const heads = [...scroller.querySelectorAll<HTMLElement>('.emoji-group')];
    let index = 0;
    heads.forEach((head, i) => { if (head.offsetTop - scroller.offsetTop <= scroller.scrollTop + 4) index = i; });
    setCurrent(index);
  };
  return (
    <Popover anchor={anchor} placement={placement} onClose={onClose} className={`emoji-picker${emojiOnly ? ' emoji-only' : ''}`} style={{ width: 408 }} label={emojiOnly ? t("반응") : t("아이콘")} motion="fade">
      {emojiOnly ? null : <div className="emoji-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'emoji'} className={`emoji-tab${tab === 'emoji' ? ' active' : ''}`} onClick={() => { setTab('emoji'); setQuery(''); }}>{t("이모지")}</button>
        <button type="button" role="tab" aria-selected={tab === 'icon'} className={`emoji-tab${tab === 'icon' ? ' active' : ''}`} onClick={() => { setTab('icon'); setQuery(''); }}>{t("아이콘")}</button>
        {upload ? <button type="button" role="tab" aria-selected={tab === 'upload'} className={`emoji-tab${tab === 'upload' ? ' active' : ''}`} onClick={() => { setTab('upload'); setQuery(''); }}>{t("업로드")}</button> : null}
        <span className="spacer" />
        {onRemove ? <button type="button" className="emoji-remove" onClick={() => { onRemove(); onClose(); }}>{t("제거")}</button> : null}
      </div>}
      {tab === 'upload' ? (
        <div className="emoji-upload">
          <label className="blue-button upload-button">{busy ? t("올리는 중…") : t("파일 업로드")}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={event => { const file = event.target.files?.[0]; if (file) useFile(file).catch(report); }} /></label>
          <div className="emoji-upload-note">{t("권장 크기는 280×280픽셀입니다.")}</div>
        </div>
      ) : <>
      <div className="emoji-search-row">
        <span className="emoji-search"><Icon name="search" size={16} /><input autoFocus placeholder={t("검색…")} value={query} onChange={event => setQuery(event.target.value)} aria-label={t("검색")}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (tab === 'icon') { if (icons[0]) pick(`icon:${icons[0]}:${color}`); return; }
            const first = groups.find(group => group.items.length)?.items[0];
            if (first) pick(first.emoji); else if (/\p{Extended_Pictographic}/u.test(query)) pick(query.trim());
          }} /></span>
        {emojiOnly ? null : <button type="button" className="emoji-square" title={t("무작위")} aria-label={t("무작위")} onClick={() => pick(tab === 'icon' ? `icon:${pickerIconNames[Math.floor(Math.random() * pickerIconNames.length)]}:${color}` : randomEmoji())}><Icon name="repeat" size={16} /></button>}
        {tab === 'icon' ? <button type="button" className="emoji-square plain" title={t("색")} aria-label={t("아이콘 색")} onClick={event => setColorMenu(event.currentTarget)}><span className={`emoji-color-dot color-dot-${color}`} /></button> : null}
        {tab === 'emoji' ? <button type="button" className="emoji-square plain" title={t("피부색")} aria-label={t("피부색")} onClick={event => setSkinMenu(event.currentTarget)}><span className="emoji-skin">{withSkin('✋', tone)}</span></button> : null}
      </div>
      {tab === 'emoji' ? (
        <>
          <div className="emoji-scroller" ref={scrollerRef} onScroll={onScroll}>
            {groups.map(group => group.items.length ? (
              <div key={group.name} className="emoji-group">
                <div className="emoji-group-head">{group.name}</div>
                <div className="emoji-grid">{group.items.map((item, index) => <button type="button" key={`${item.emoji}-${index}`} className="emoji-cell" title={item.emoji.startsWith('attachment:') ? `:${item.words}:` : item.words.split(' ')[0] || item.emoji} onClick={() => pick(item.emoji)}>{item.emoji.startsWith('attachment:') ? <img className="custom-emoji-cell" src={`/api/attachments/${encodeURIComponent(item.emoji.slice(11))}`} alt={`:${item.words}:`} width={22} height={22} /> : withSkin(item.emoji, tone)}</button>)}</div>
              </div>
            ) : null)}
            {needle && !groups[0].items.length ? <div className="menu-empty">{t("결과 없음{0}", [/\p{Extended_Pictographic}/u.test(query) ? t(" · Enter로 입력한 이모지 사용") : ''])}</div> : null}
          </div>
          {!needle ? (
            <div className="emoji-categories">
              {groups.filter(group => group.items.length).map((group, index) => (
                <button type="button" key={group.name} className={`emoji-category${index === current ? ' active' : ''}`} title={group.name} aria-label={t("분류로 이동: {0}", [group.name])} onClick={() => jump(index)}>
                  {group.name === t("최근 사용") ? <Icon name="clock" size={18} /> : group.items[0].emoji.startsWith('attachment:') ? <Icon name="emoji" size={18} /> : <span className="emoji-category-glyph">{group.items[0].emoji}</span>}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="emoji-scroller icons">
          <div className="emoji-group">
            <div className="emoji-group-head">{t("아이콘")}</div>
            <div className="emoji-grid">{icons.map(name => <button type="button" key={name} className={`emoji-cell icon-cell color-${color}`} title={name} onClick={() => pick(`icon:${name}:${color}`)}><Icon name={name} size={20} /></button>)}</div>
            {!icons.length ? <div className="menu-empty">{t("결과 없음")}</div> : null}
          </div>
        </div>
      )}
      </>}
      {skinMenu ? <Menu anchor={skinMenu} placement="below-end" width={220} onClose={() => setSkinMenu(null)} entries={skinTones.map((value, index) => ({ label: skinNames[index], icon: <span className="emoji-skin">{withSkin('✋', value)}</span>, checked: skin === index, onSelect: () => { setSkin(index); storeLocal(skinKey, JSON.stringify(index)); } }))} /> : null}
      {colorMenu ? <Menu anchor={colorMenu} placement="below-end" width={180} onClose={() => setColorMenu(null)} entries={iconColors.map(name => ({ label: colorNames[name], icon: <span className={`emoji-color-dot color-dot-${name}`} />, checked: color === name, onSelect: () => setColor(name) }))} /> : null}
    </Popover>
  );
}

const colorNames: Record<string, string> = { gray: t("회색"), brown: t("갈색"), orange: t("주황색"), yellow: t("노란색"), green: t("초록색"), blue: t("파란색"), purple: t("보라색"), pink: t("분홍색"), red: t("빨간색") };

// A page icon is an emoji, or "icon:<name>:<colour>" picked from the 아이콘 tab.
export function PageIconGlyph({ icon, size }: { icon: string; size: number }) {
  if (icon.startsWith('attachment:')) return <img className="page-icon-image" src={`/api/attachments/${encodeURIComponent(icon.slice(11))}`} width={size} height={size} alt="" draggable={false} />;
  if (icon.startsWith('icon:')) {
    const [, name, color = 'gray'] = icon.split(':');
    return <span className={`page-icon-glyph color-${color}`}><Icon name={name} size={size} /></span>;
  }
  return <>{icon}</>;
}

// ---------- cover picker ----------

const gradients: Array<[string, string, string]> = [
  [t("노을"), '#f6d365', '#fda085'], [t("바다"), '#89f7fe', '#66a6ff'], [t("숲"), '#d4fc79', '#96e6a1'], [t("라벤더"), '#e0c3fc', '#8ec5fc'],
  [t("복숭아"), '#ffecd2', '#fcb69f'], [t("밤하늘"), '#30cfd0', '#330867'], [t("장미"), '#ff9a9e', '#fecfef'], [t("모래"), '#e6dada', '#274046'],
];

async function gradientFile(name: string, from: string, to: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1500; canvas.height = 600;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 1500, 600);
  gradient.addColorStop(0, from); gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1500, 600);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(t("이미지를 만들지 못했습니다."))), 'image/png'));
  return new File([blob], t("커버-{0}.png", [name]), { type: 'image/png' });
}

// A page's cover, or any other picture kept as an attachment (a form's cover): `current` and `onSet` say which.
export function CoverPicker({ anchor, page, current, onSet, onClose }: { anchor: Anchor; page?: PageEntity; current?: string | null; onSet?: (attachmentId: string | null) => Promise<unknown>; onClose: () => void }) {
  const ws = useWorkspace();
  const [tab, setTab] = useState<'gallery' | 'upload' | 'link' | 'saved'>('gallery');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const images = ws.snapshot.objects.filter(item => item.kind === 'attachment' && item.alive && (item as AttachmentEntity).mediaType.startsWith('image/')) as AttachmentEntity[];
  const setCover = (attachmentId: string | null) => onSet ? onSet(attachmentId) : apply([{ type: 'page.update', id: page!.id, coverAttachmentId: attachmentId }]);
  const currentCover = onSet ? current : page?.coverAttachmentId;
  const useFile = async (file: File) => {
    setBusy(true);
    try { const result = await uploadFile(file, workspace.revision); await setCover(result.attachmentId); onClose(); } catch (error) { report(error); } finally { setBusy(false); }
  };
  // 링크: the picture at that address is downloaded once and kept as an attachment.
  const useLink = async (address: string) => {
    setBusy(true);
    try { const result = await attachFromUrl(address, 'image'); await setCover(result.attachmentId); onClose(); } catch (error) { report(error); } finally { setBusy(false); }
  };
  return (
    <Popover anchor={anchor} placement="below-end" onClose={onClose} className="cover-picker" style={{ width: 540 }} label={t("커버")}>
      <div className="emoji-tabs">
        {(['gallery', 'upload', 'link', 'saved'] as const).map(id => <button type="button" key={id} className={`emoji-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{id === 'gallery' ? t("갤러리") : id === 'upload' ? t("업로드") : id === 'link' ? t("링크") : t("저장된 이미지")}</button>)}
        <span className="spacer" />
        {currentCover ? <button type="button" className="text-button small" onClick={() => { setCover(null).catch(report); onClose(); }}>{t("제거")}</button> : null}
      </div>
      <div className="cover-body">
        {tab === 'gallery' ? (
          <div className="cover-grid">
            {gradients.map(([name, from, to]) => <button type="button" key={name} disabled={busy} className="cover-swatch" style={{ background: `linear-gradient(120deg, ${from}, ${to})` }} title={name} onClick={async () => useFile(await gradientFile(name, from, to))} />)}
          </div>
        ) : tab === 'link' ? (
          <form className="cover-link" onSubmit={event => { event.preventDefault(); if (/^https?:\/\//i.test(link.trim())) useLink(link.trim()); }}>
            <input className="text-input" autoFocus placeholder={t("이미지 링크를 붙여넣으세요")} value={link} onChange={event => setLink(event.target.value)} disabled={busy} />
            <button type="submit" className="blue-button" disabled={busy || !/^https?:\/\//i.test(link.trim())}>{busy ? t("가져오는 중…") : t("링크 제출")}</button>
          </form>
        ) : tab === 'upload' ? (
          <label className="blue-button upload-button">{busy ? t("올리는 중…") : t("파일 업로드")}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={event => { const file = event.target.files?.[0]; if (file) useFile(file); }} /></label>
        ) : (
          <div className="cover-grid">
            {images.map(image => <button type="button" key={image.id} className="cover-swatch image" style={{ backgroundImage: `url(/api/attachments/${encodeURIComponent(image.id)})` }} title={image.name} onClick={() => { setCover(image.id).catch(report); onClose(); }} />)}
            {!images.length ? <p className="muted">{t("저장된 이미지가 없습니다.")}</p> : null}
          </div>
        )}
        <p className="muted small">{t("이미지는 이 컴퓨터의 로컬 첨부로 저장됩니다. 가로 1500px 이상을 권장합니다.")}</p>
      </div>
    </Popover>
  );
}

// ---------- title ----------

function PageTitle({ page, onEnter, onArrowDown, readOnly, small }: { page: PageEntity; onEnter: (rest: string) => void; onArrowDown: () => void; readOnly: boolean; small?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const composing = useRef(false);
  const timer = useRef(0);
  const base = useRef<number | null>(null);
  const draft = readLocal<{ value: string; baseRevision: number } | null>(titleDraftKey(page.id), null);
  const shown = draft && draft.value !== page.title ? draft.value : page.title;
  if (draft && draft.value === page.title) localStorage.removeItem(titleDraftKey(page.id));

  // Keep DOM in sync with the stored title unless the user is typing in it.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (document.activeElement === element) return;
    if (element.textContent !== shown) element.textContent = shown;
  }, [shown, page.id]);

  const typed = useRef<string | null>(null);
  const save = () => {
    window.clearTimeout(timer.current);
    const element = ref.current;
    if (!element) return;
    typed.current = null;
    const value = (element.textContent ?? '').replace(/\n/g, ' ');
    const current = workspace.get<PageEntity>(page.id);
    if (!current || value === current.title) { localStorage.removeItem(titleDraftKey(page.id)); base.current = null; return; }
    const revision = base.current ?? workspace.revision;
    apply([{ type: 'page.update', id: page.id, title: value }], { revision }).then(() => { base.current = null; }).catch(report);
  };
  const changed = () => {
    if (composing.current) return;
    const element = ref.current;
    if (!element) return;
    if (base.current === null) base.current = draft?.baseRevision ?? workspace.revision;
    storeLocal(titleDraftKey(page.id), JSON.stringify({ value: element.textContent ?? '', baseRevision: base.current }));
    typed.current = element.textContent ?? '';
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 600);
  };
  // Closing the page (a peek's Esc) right after typing still saves what was typed.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    const value = typed.current?.replace(/\n/g, ' ');
    const current = workspace.get<PageEntity>(page.id);
    if (value == null || !current || value === current.title) return;
    apply([{ type: 'page.update', id: page.id, title: value }], { revision: base.current ?? workspace.revision }).catch(report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <h1 ref={ref} className={`page-title${small ? ' small' : ''}`} contentEditable={!readOnly} suppressContentEditableWarning spellCheck data-placeholder={t("새 페이지")} aria-label={t("페이지 제목")} role="textbox"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; changed(); }}
      onInput={changed}
      onBlur={save}
      onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '); document.execCommand('insertText', false, text); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          const selection = window.getSelection();
          const element = ref.current!;
          let rest = '';
          if (selection && selection.rangeCount && element.contains(selection.anchorNode)) {
            const range = selection.getRangeAt(0);
            const after = document.createRange();
            after.selectNodeContents(element);
            after.setStart(range.endContainer, range.endOffset);
            rest = after.toString();
            if (rest) { after.deleteContents(); range.deleteContents(); }
          }
          save();
          onEnter(rest);
        } else if (event.key === 'ArrowDown' || (event.key === 'ArrowRight' && caretAtEnd(ref.current!))) {
          if (event.key === 'ArrowDown' && !caretOnLastLine(ref.current!)) return;
          event.preventDefault();
          save();
          onArrowDown();
        } else if (event.key === 'Tab') event.preventDefault();
      }} />
  );
}

function caretAtEnd(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setStart(selection.focusNode!, selection.focusOffset);
  return range.toString().length === 0;
}
function caretOnLastLine(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return true;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return !rect.height || rect.bottom > box.bottom - 30;
}

// ---------- properties (database rows) ----------

// 페이지 레이아웃: a database page's properties sit in groups (the main one also carries 하위 항목 · 종속성 and
// "속성 추가"), as single-property sections, or in the side panel; hidden ones stay off the page.
function PropertyRows({ page, detail, list, main = false, panel = false }: { page: PageEntity; detail: ReturnType<typeof usePageDetail>['detail']; list: PropertyEntity[]; main?: boolean; panel?: boolean }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(page.sourceId ?? '');
  const schema = list;
  const icons = source?.pageLayout?.propertyIcons !== false;
  const [menu, setMenu] = useState<{ anchor: Element; property: PropertyEntity } | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const computed = detail?.entity.computed ?? {};
  const valueOf = (property: PropertyEntity) => property.id in computed ? computed[property.id] : page.values?.[property.id];
  const hideEmptyKey = `pageyard-hide-empty:${page.sourceId}`;
  const [hideEmpty, setHideEmpty] = useState(() => readLocal(hideEmptyKey, false));
  const isEmpty = (value: unknown) => value == null || value === '' || (Array.isArray(value) && !value.length) || value === false;
  // A property set to "비어 있으면 숨기기" (pageLayout.hideWhenEmpty) shows only with a value; so does every property
  // while this browser hides empty ones.
  const hideWhenEmpty = new Set(source?.pageLayout?.hideWhenEmpty ?? []);
  const shown = hiddenOpen ? schema : schema.filter(property => !((hideEmpty || hideWhenEmpty.has(property.id)) && isEmpty(valueOf(property))));
  const hiddenCount = schema.length - shown.length;
  const task = detail?.entity.task;
  const [commentsFor, setCommentsFor] = useState<{ anchor: Element; property: PropertyEntity } | null>(null);
  const comments = (detail?.entity.comments ?? []).filter(comment => comment.alive !== false);
  const openCount = (propertyId: string) => comments.filter(comment => comment.propertyId === propertyId && !comment.threadId && !comment.resolved).length;
  // 표시 방식: always shown, shown when it has a value, or never (the layout's hidden list).
  const setVisibility = (property: PropertyEntity, mode: 'show' | 'empty' | 'hide') => {
    if (!source || isDatabaseLocked(source.id)) return;
    const layout = source.pageLayout ?? {};
    const without = (list: string[] | undefined) => (list ?? []).filter(id => id !== property.id);
    apply([{ type: 'source.update', id: source.id, pageLayout: { ...layout, hideWhenEmpty: mode === 'empty' ? [...without(layout.hideWhenEmpty), property.id] : without(layout.hideWhenEmpty), hidden: mode === 'hide' ? [...without(layout.hidden), property.id] : without(layout.hidden) } }]).catch(report);
  };
  const visibility = (property: PropertyEntity) => source?.pageLayout?.hidden?.includes(property.id) ? 'hide' : hideWhenEmpty.has(property.id) ? 'empty' : 'show';
  const entries = (property: PropertyEntity): MenuEntry[] => [
    { label: t("속성 편집"), icon: 'settings', onSelect: () => openWorkspaceDialog('property', { sourceId: property.sourceId, propertyId: property.id }) },
    { label: t("댓글"), icon: 'comment', onSelect: () => setCommentsFor({ anchor: menu!.anchor, property }) },
    { label: t("표시 방식"), icon: 'eye', submenuWidth: 220, disabled: isDatabaseLocked(page.sourceId), submenu: () => ([['show', t("항상 표시")], ['empty', t("비어 있으면 숨기기")], ['hide', t("항상 숨기기")]] as const).map(([mode, label]) => ({ label, checked: visibility(property) === mode, onSelect: () => setVisibility(property, mode) }) as MenuEntry) },
    { label: hideEmpty ? t("빈 속성 표시") : t("빈 속성 숨기기"), icon: hideEmpty ? 'eye' : 'eye-off', onSelect: () => { setHideEmpty(!hideEmpty); storeLocal(hideEmptyKey, JSON.stringify(!hideEmpty)); } },
    { kind: 'separator' },
    { label: t("속성 삭제"), icon: 'trash', danger: true, onSelect: () => openWorkspaceDialog('property', { sourceId: property.sourceId, propertyId: property.id }) },
  ];
  // In the side panel, a property's row can be dragged up or down: the panel keeps that order (pageLayout.panel).
  const [dragging, setDragging] = useState<string | null>(null);
  const reorderPanel = (id: string, beforeId: string) => {
    const layout = source?.pageLayout;
    if (!layout?.panel || id === beforeId || isDatabaseLocked(page.sourceId)) return;
    const order = layout.panel.filter(item => item !== id);
    order.splice(order.indexOf(beforeId), 0, id);
    apply([{ type: 'source.update', id: source!.id, pageLayout: { ...layout, panel: order } }]).catch(report);
  };
  return (
    <section className={`page-properties${icons ? '' : ' no-icons'}${panel ? ' in-panel' : ''}`} aria-label={panel ? t("패널 속성") : t("속성")}>
      {shown.map(property => (
        <div key={property.id} className={`property-row${dragging === property.id ? ' dragging' : ''}`} data-type={property.type} data-property-id={property.id}
          {...(panel ? {
            draggable: true,
            onDragStart: (event: ReactDragEvent) => { event.dataTransfer.setData('application/x-pageyard-panel', property.id); event.dataTransfer.effectAllowed = 'move'; setDragging(property.id); },
            onDragEnd: () => setDragging(null),
            onDragOver: (event: ReactDragEvent) => { if (event.dataTransfer.types.includes('application/x-pageyard-panel')) event.preventDefault(); },
            onDrop: (event: ReactDragEvent) => { const id = event.dataTransfer.getData('application/x-pageyard-panel'); if (id) { event.preventDefault(); reorderPanel(id, property.id); } setDragging(null); },
          } : {})}>
          <button type="button" className="property-name" onClick={event => setMenu({ anchor: event.currentTarget, property })} title={propertyLabels[property.type]}>
            <Icon name={propertyIcon(property.type)} size={16} /><span>{property.name}</span>
          </button>
          <EditableValue pageId={page.id} property={property} value={valueOf(property)} row={detail ? { id: page.id, title: page.title, version: page.version, position: page.position, values: computed, relationDisplay: detail.entity.relationDisplay } : undefined} placeholder={t("비어 있음")} className="property-value" />
          {/* 💬 on hover (always when the value has open comments): the property's discussion. */}
          <button type="button" className={`property-comment-button${openCount(property.id) ? ' has' : ''}`} aria-label={t("{0} 댓글", [property.name])} title={t("댓글")} onClick={event => setCommentsFor({ anchor: event.currentTarget, property })}>
            <Icon name="comment" size={14} />{openCount(property.id) ? <span>{openCount(property.id)}</span> : null}
          </button>
        </div>
      ))}
      {source?.tasks?.subitems?.enabled && !page.template && main ? (
        <div className="property-row task-row">
          <span className="property-name static"><Icon name="tasks" size={16} /><span>{t("하위 항목")}</span></span>
          <div className="property-value task-value">
            {task?.parentId ? <span className="task-parent">{tx("상위: {0}", [<a href={hrefFor(task.parentId)} onClick={event => { event.preventDefault(); openPeek(task.parentId!, 'side'); }}>{ws.get<PageEntity>(task.parentId)?.title || t("새 페이지")}</a>])}</span> : null}
            {task?.children?.map(child => <a key={child.id} className="relation-chip" href={hrefFor(child.id)} onClick={event => { event.preventDefault(); openPeek(child.id, 'side'); }}><EntityIcon item={ws.get(child.id)} size={16} />{child.title || t("새 페이지")}</a>)}
            <button type="button" className="text-button small" onClick={() => createRow(page.sourceId!, { parentTaskId: page.id, open: 'side' }).catch(report)}><Icon name="plus" size={14} />{t("하위 항목 추가")}</button>
          </div>
        </div>
      ) : null}
      {source?.tasks?.dependencies?.enabled && !page.template && main ? (
        <div className="property-row task-row">
          <span className="property-name static"><Icon name="dependency" size={16} /><span>{t("종속성")}</span></span>
          <div className="property-value task-value">
            <span>{tx("선행: {0}", [task?.predecessors.length ? task.predecessors.map(item => <a key={item.id} href={hrefFor(item.id)} onClick={event => { event.preventDefault(); openPeek(item.id, 'side'); }}>{item.title || t("새 페이지")} </a>) : t("없음")])}</span>
            <span>{tx("후행: {0}", [task?.successors.length ? task.successors.map(item => <a key={item.id} href={hrefFor(item.id)} onClick={event => { event.preventDefault(); openPeek(item.id, 'side'); }}>{item.title || t("새 페이지")} </a>) : t("없음")])}</span>
          </div>
        </div>
      ) : null}
      {hiddenCount > 0 ? <button type="button" className="property-more" onClick={() => setHiddenOpen(true)}><Icon name="chevron-down" size={14} />{t("빈 속성 {0}개 더 보기", [hiddenCount])}</button> : null}
      {main && !isDatabaseLocked(page.sourceId) ? <button type="button" className="property-add" onClick={() => openWorkspaceDialog('property', { sourceId: page.sourceId })}><Icon name="plus" size={16} />{t("속성 추가")}</button> : null}
      {menu ? <Menu anchor={menu.anchor} entries={entries(menu.property)} onClose={() => setMenu(null)} width={240} /> : null}
      {commentsFor ? <PropertyComments anchor={commentsFor.anchor} pageId={page.id} property={commentsFor.property} comments={comments} onClose={() => setCommentsFor(null)} /> : null}
    </section>
  );
}

// A property placed as its own section: its name over a full-width value.
function PropertyModule({ page, detail, property }: { page: PageEntity; detail: ReturnType<typeof usePageDetail>['detail']; property: PropertyEntity }) {
  const ws = useWorkspace();
  const icons = ws.get<SourceEntity>(page.sourceId ?? '')?.pageLayout?.propertyIcons !== false;
  const computed = detail?.entity.computed ?? {};
  const value = property.id in computed ? computed[property.id] : page.values?.[property.id];
  return (
    <section className="property-module" data-type={property.type} aria-label={property.name}>
      <div className="property-module-name">{icons ? <Icon name={propertyIcon(property.type)} size={16} /> : null}<span>{property.name}</span></div>
      <EditableValue pageId={page.id} property={property} value={value} row={detail ? { id: page.id, title: page.title, version: page.version, position: page.position, values: computed, relationDisplay: detail.entity.relationDisplay } : undefined} placeholder={t("비어 있음")} className="property-value property-module-value" />
    </section>
  );
}

// 페이지 레이아웃 › 헤더: properties pinned under the page's name, each as its icon and value (the name on hover);
// a long row scrolls sideways.
function PinnedProperties({ page, detail }: { page: PageEntity; detail: ReturnType<typeof usePageDetail>['detail'] }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(page.sourceId ?? '');
  const pinned = layoutPlan(ws.schema(page.sourceId), source?.pageLayout).pinned;
  if (!pinned.length) return null;
  const computed = detail?.entity.computed ?? {};
  const icons = source?.pageLayout?.propertyIcons !== false;
  return (
    <div className="page-pinned" aria-label={t("고정된 속성")}>
      {pinned.map(property => (
        <div key={property.id} className="pinned-property" data-type={property.type} title={property.name}>
          {icons ? <Icon name={propertyIcon(property.type)} size={14} /> : null}
          <EditableValue pageId={page.id} property={property} value={property.id in computed ? computed[property.id] : page.values?.[property.id]} row={detail ? { id: page.id, title: page.title, version: page.version, position: page.position, values: computed, relationDisplay: detail.entity.relationDisplay } : undefined} placeholder={property.name} className="pinned-value" />
        </div>
      ))}
    </div>
  );
}

// 탭 구조: "콘텐츠" (the page body) and the layout's tabs, each another database's view narrowed to the rows whose
// relation points at this page. The chosen tab is remembered per database in this browser.
function PageTabs({ page, active, onPick }: { page: PageEntity; active: string | null; onPick: (id: string | null) => void }) {
  const ws = useWorkspace();
  const tabs = (ws.get<SourceEntity>(page.sourceId ?? '')?.pageLayout?.tabs ?? []).filter(tab => ws.get<ViewEntity>(tab.viewId)?.alive !== false && ws.get(tab.viewId));
  return (
    <div className="page-tabs" role="tablist">
      <button type="button" className={`page-tab${active ? '' : ' active'}`} role="tab" aria-selected={!active} onClick={() => onPick(null)}><Icon name="page" size={14} />{t("콘텐츠")}</button>
      {tabs.map(tab => <button type="button" key={tab.id} className={`page-tab${active === tab.id ? ' active' : ''}`} role="tab" aria-selected={active === tab.id} onClick={() => onPick(tab.id)}><Icon name={viewIcon[ws.get<ViewEntity>(tab.viewId)!.viewType] ?? 'table'} size={14} />{tab.name}</button>)}
    </div>
  );
}
function TabDatabase({ page, tabId }: { page: PageEntity; tabId: string }) {
  const ws = useWorkspace();
  const tab = ws.get<SourceEntity>(page.sourceId ?? '')?.pageLayout?.tabs?.find(item => item.id === tabId);
  const view = tab ? ws.get<ViewEntity>(tab.viewId) : undefined;
  if (!tab || !view) return null;
  return (
    <div className="page-tab-database">
      <DatabaseFrame sourceId={view.sourceId} viewIds={[view.id]} pageId={page.id} inline linked compact
        extraFilter={tab.relationPropertyId ? { propertyId: tab.relationPropertyId, op: 'contains', value: page.id } : undefined}
        newRowValues={tab.relationPropertyId ? { [tab.relationPropertyId]: [page.id] } : undefined} />
    </div>
  );
}

function LayoutSections({ page, detail, comments, showComments }: { page: PageEntity; detail: ReturnType<typeof usePageDetail>['detail']; comments: CommentEntity[]; showComments: boolean }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(page.sourceId ?? '');
  const plan = layoutPlan(ws.schema(page.sourceId), source?.pageLayout);
  return (
    <>
      {plan.sections.map(section => {
        if (section.type === 'group' && section.main) {
          const mode = source?.pageLayout?.backlinks ?? 'always';
          const backlinks = mode === 'off' ? null : <Backlinks links={detail?.entity.backlinks ?? []} mode={mode === 'expanded' || mode === 'popover' ? mode : 'always'} />;
          return <Fragment key={section.id}><PropertyRows page={page} detail={detail} list={section.properties} main /><RemindersRow page={page} />{mode === 'hover' ? <div className="backlinks-on-hover">{backlinks}</div> : backlinks}</Fragment>;
        }
        if (section.type === 'group') return section.properties.length ? <div key={section.id} className="property-group"><div className="property-group-name">{section.name || t("속성 그룹")}</div><PropertyRows page={page} detail={detail} list={section.properties} /></div> : null;
        if (section.type === 'property') return <PropertyModule key={section.id} page={page} detail={detail} property={section.property} />;
        return showComments && source?.pageLayout?.discussion !== false ? <CommentsSection key={section.id} page={page} comments={comments} /> : null;
      })}
    </>
  );
}

// ---------- an empty database row: start empty or from a template ----------
// 16 under the comments' line, padding 8 0 24 8, 16px rgb(161,158,153) — "Enter 키를 눌러 빈
// 페이지로 시작하거나 템플릿을 선택하세요(↑, ↓로 선택)" over 32-high r4 rows (padding 3 2 3 8, page icon, 16px #7d7a75):
// the templates, "빈 페이지", "+ 새 템플릿"; with no templates the line ends "템플릿을 만드세요" (underlined).
function RowTemplatePrompt({ page }: { page: PageEntity }) {
  const ws = useWorkspace();
  const templates = (ws.children(page.sourceId ?? '').filter(item => item.kind === 'page' && (item as PageEntity).template && ws.visible(item.id)) as PageEntity[]);
  const [selected, setSelected] = useState(-1);
  const items = [...templates.map(template => ({ id: template.id, label: template.title || t("제목 없는 템플릿"), icon: template.icon })), { id: '$empty', label: t("빈 페이지"), icon: null }];
  const pick = (id: string) => {
    if (id === '$empty') { document.querySelector<HTMLElement>('.page-scroller .ProseMirror')?.focus(); return; }
    apply([{ type: 'page.apply_template', id: page.id, templateId: id }]).catch(report);
  };
  useEffect(() => {
    if (!templates.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.target as Element | null)?.closest?.('.page-title')) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1 + (index < 0 ? 1 : 0))) % items.length); }
      else if (event.key === 'Enter' && selected >= 0 && !event.isComposing) { event.preventDefault(); event.stopPropagation(); pick(items[selected].id); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
  if (!templates.length) {
    return <div className="row-template-prompt"><div className="row-template-text">{tx("Enter 키를 눌러 빈 페이지로 시작하거나 {0}", [<button type="button" className="row-template-link" onClick={() => createTemplate(page.sourceId!).catch(report)}>{t("템플릿을 만드세요")}</button>])}</div></div>;
  }
  return (
    <div className="row-template-prompt">
      <div className="row-template-text">{t("Enter 키를 눌러 빈 페이지로 시작하거나 템플릿을 선택하세요(↑, ↓로 선택)")}</div>
      <div className="row-template-list" role="listbox" aria-label={t("템플릿")}>
        {items.map((item, index) => (
          <button type="button" key={item.id} role="option" aria-selected={index === selected} className={`row-template-row${index === selected ? ' selected' : ''}`} onMouseEnter={() => setSelected(index)} onClick={() => pick(item.id)}>
            {item.icon ? <PageIconGlyph icon={item.icon} size={20} /> : <Icon name="page" size={20} />}<span>{item.label}</span>
          </button>
        ))}
        <button type="button" className="row-template-row" onClick={() => createTemplate(page.sourceId!).catch(report)}><Icon name="plus" size={20} /><span>{t("새 템플릿")}</span></button>
      </div>
    </div>
  );
}

// ---------- comments, reminders, backlinks ----------

function CommentsSection({ page, comments }: { page: PageEntity; comments: CommentEntity[] }) {
  const ws = useWorkspace();
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  // Comments on the page itself live here; discussions on blocks sit next to their blocks
  // and only show up here once resolved (so they can be reopened). Replies sit under the comment they answer.
  const pageLevel = comments.filter(comment => comment.parentId === page.id && !comment.threadId && !comment.propertyId);
  const open = pageLevel.filter(comment => !comment.resolved);
  const resolved = comments.filter(comment => comment.resolved && !comment.threadId);
  const roots = showResolved ? [...open, ...resolved] : open;
  const list = roots.flatMap(root => [root, ...comments.filter(comment => comment.threadId === root.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))]);
  const sendReply = (root: CommentEntity) => {
    const text = reply.trim();
    if (text) apply([{ type: 'comment.create', parentId: root.parentId!, threadId: root.id, richText: [{ text }] }]).then(() => { setReply(''); setReplying(null); }).catch(report);
  };
  // Database rows always show the comment area under the properties.
  const isRow = !!page.sourceId;
  if (!open.length && !(showResolved && resolved.length) && !isRow) return resolved.length ? <section className="page-comments resolved-only"><button type="button" className="text-button small" onClick={() => setShowResolved(true)}>{t("해결된 댓글 {0}개 보기", [resolved.length])}</button></section> : null;
  return (
    <section className={`page-comments${isRow ? ' row-comments' : ''}`} aria-label={t("댓글")}>
      {isRow ? <div className="page-comments-title">{t("댓글")}</div> : null}
      {list.map(comment => (
        <Fragment key={comment.id}>
        <div className={`comment${comment.resolved ? ' resolved' : ''}${comment.threadId ? ' reply' : ''}`} data-comment-id={comment.id}>
          <span className="avatar">{comment.createdBy === 'user' ? t("avatar|나") : avatarLetter(comment.createdBy)}</span>
          <div className="comment-body">
            <div className="comment-meta">
              <strong>{comment.createdBy === 'user' ? t("나") : comment.createdBy}</strong>
              <span>{relativeTime(comment.createdAt)}</span>
              {comment.propertyId ? <span className="comment-block-link">{t("속성 댓글 · {0}", [ws.get<PropertyEntity>(comment.propertyId)?.name ?? t("삭제된 속성")])}</span> : null}
              {comment.parentId !== page.id ? <button type="button" className="comment-block-link" onClick={() => { const element = document.querySelector(`[data-block-id="${CSS.escape(comment.parentId ?? '')}"]`); element?.scrollIntoView({ block: 'center' }); }}>{tx("블록 댓글 · {0}", [plainText((ws.get(comment.parentId) as { richText?: Array<{ text: string }> } | undefined)?.richText).slice(0, 30) || t("블록")])}</button> : null}
            </div>
            {editing === comment.id ? (
              <div className="comment-edit">
                <textarea className="text-input" rows={2} value={text} autoFocus onChange={event => setText(event.target.value)} />
                <div className="comment-edit-actions">
                  <button type="button" className="outline-button small" onClick={() => setEditing(null)}>{t("취소")}</button>
                  <button type="button" className="blue-button small" onClick={() => { apply([{ type: 'comment.update', id: comment.id, richText: [{ text }] }]).catch(report); setEditing(null); }}>{t("저장")}</button>
                </div>
              </div>
            ) : <div className="comment-text">{comment.richText.map((run, index) => <span key={index} className={run.italic ? 'italic' : undefined}>{run.text}</span>)}</div>}
          </div>
          <div className="comment-actions">
            {!comment.threadId ? <button type="button" className="icon-button small" title={t("답글")} aria-label={t("답글")} onClick={() => { setReplying(comment.id); setReply(''); }}><Icon name="comment" size={16} /></button> : null}
            {!comment.threadId ? <button type="button" className="icon-button small" title={comment.resolved ? t("다시 열기") : t("해결")} aria-label={comment.resolved ? t("다시 열기") : t("해결")} onClick={() => apply([{ type: 'comment.update', id: comment.id, resolved: !comment.resolved }]).catch(report)}><Icon name={comment.resolved ? 'undo' : 'check'} size={16} /></button> : null}
            <button type="button" className="icon-button small" title={t("편집")} aria-label={t("편집")} onClick={() => { setEditing(comment.id); setText(plainText(comment.richText)); }}><Icon name="pencil" size={16} /></button>
            <button type="button" className="icon-button small" title={t("삭제")} aria-label={t("삭제")} onClick={() => apply([{ type: 'node.trash', id: comment.id }]).catch(report)}><Icon name="trash" size={16} /></button>
          </div>
        </div>
        {replying && (comment.threadId ?? comment.id) === replying && list.filter(item => (item.threadId ?? item.id) === replying).at(-1)?.id === comment.id ? (
          <div className="comment-new comment-reply-new">
            <span className="avatar">{t("avatar|나")}</span>
            <input className="comment-input" autoFocus placeholder={t("답글 달기…")} value={reply} onChange={event => setReply(event.target.value)}
              onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); const root = list.find(item => item.id === replying); if (root) sendReply(root); } else if (event.key === 'Escape') setReplying(null); }} />
          </div>
        ) : null}
        </Fragment>
      ))}
      <div className="comment-new">
        <span className="avatar">{t("avatar|나")}</span>
        <input className="comment-input" placeholder={t("댓글 추가…")} value={draft} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && draft.trim()) { event.preventDefault(); apply([{ type: 'comment.create', parentId: page.id, richText: [{ text: draft.trim() }] }]).then(() => setDraft('')).catch(report); } }} />
      </div>
      {resolved.length ? <button type="button" className="text-button small" onClick={() => setShowResolved(!showResolved)}>{showResolved ? t("해결된 댓글 숨기기") : t("해결된 댓글 {0}개 보기", [resolved.length])}</button> : null}
    </section>
  );
}

function RemindersRow({ page }: { page: PageEntity }) {
  const ws = useWorkspace();
  const reminders = ws.children(page.id).filter(item => item.kind === 'reminder') as ReminderEntity[];
  if (!reminders.length) return null;
  return (
    <div className="page-reminders">
      {reminders.map(reminder => (
        <span key={reminder.id} className="reminder-chip">
          <button type="button" onClick={() => openWorkspaceDialog('reminder', { parentId: page.id, existing: reminder })}><Icon name="bell" size={14} />{reminder.message}{reminder.at ? ` · ${displayDate(reminder.at)}` : ''}</button>
          <button type="button" className="reminder-remove" aria-label={t("알림 취소")} onClick={() => apply([{ type: 'node.trash', id: reminder.id }]).catch(report)}><Icon name="close" size={12} /></button>
        </span>
      ))}
    </div>
  );
}

// Backlinks (pages that link here): a toggle that opens the list, the list already open ('expanded'), or a popover.
function Backlinks({ links, mode = 'always' }: { links: Array<{ id: string; title: string; icon?: string | null }>; mode?: 'always' | 'expanded' | 'popover' }) {
  const [open, setOpen] = useState(mode === 'expanded');
  const [popover, setPopover] = useState<Element | null>(null);
  if (!links.length) return null;
  const list = <div className="backlinks-list">{links.map(link => <a key={link.id} href={hrefFor(link.id)} className="backlink" onClick={event => { event.preventDefault(); setPopover(null); navigate(link.id); }}><EntityIcon item={workspace.get(link.id)} size={18} />{link.title || t("새 페이지")}</a>)}</div>;
  return (
    <div className={`backlinks mode-${mode}`}>
      <button type="button" className="backlinks-toggle" aria-expanded={mode === 'popover' ? !!popover : open} onClick={event => { if (mode === 'popover') setPopover(popover ? null : event.currentTarget); else setOpen(!open); }}><Icon name="arrow-up-right" size={14} />{t("{0}개 백링크", [links.length])}</button>
      {mode !== 'popover' && open ? list : null}
      {popover ? <Popover anchor={popover} placement="below-start" onClose={() => setPopover(null)} className="backlinks-popover" label={t("백링크")}>{list}</Popover> : null}
    </div>
  );
}

// ---------- page ----------

// "여기서 시작" under an empty page (the new-page window and empty pages): a
// 12/500 #a19e99 label 28px above a row of chips (32 high, r100, rgba(42,28,0,.07), 14/500, icon +
// 8, padding 6 14 6 10, 8 apart) whose bottom sits 40px above the window's. 데이터베이스 and 양식
// turn the page into a database; 템플릿 offers page outlines; ⋯ offers the other database layouts and
// 가져오기 (menu 200 wide, above the button).
function StartChips({ page }: { page: PageEntity }) {
  const [more, setMore] = useState<Element | null>(null);
  const [templates, setTemplates] = useState<Element | null>(null);
  const toDatabase = (viewType: string) => createDatabase(page.id, { name: page.title || t("새 데이터베이스"), viewType })
    .then(() => { if (currentRoute().peek === page.id) openPeek(null); navigate(page.id); })
    .catch(report);
  return (
    <div className="page-start">
      <div className="page-start-label">{t("여기서 시작")}</div>
      <div className="page-start-chips">
        <button type="button" className="page-start-chip" onClick={() => toDatabase('table')}><Icon name="table" size={16} /><span>{t("데이터베이스")}</span></button>
        <button type="button" className="page-start-chip" onClick={() => toDatabase('form')}><Icon name="form" size={16} /><span>{t("양식")}</span></button>
        <button type="button" className="page-start-chip" onClick={event => setTemplates(event.currentTarget)}><Icon name="template" size={16} className="page-start-template-icon" /><span>{t("템플릿")}</span></button>
        <button type="button" className="page-start-chip more" aria-label={t("더 보기")} onClick={event => setMore(event.currentTarget)}><Icon name="more" size={16} /></button>
      </div>
      {templates ? <Menu anchor={templates} placement="above-start" width={240} onClose={() => setTemplates(null)} label={t("템플릿")} entries={[
        { kind: 'section', label: t("템플릿") },
        ...startTemplates.map(template => ({ label: template.name, icon: <span className="menu-emoji">{template.icon}</span>, keywords: template.name, onSelect: () => applyStartTemplate(page, template).catch(report) }) as MenuEntry),
      ]} /> : null}
      {more ? (
        <Menu anchor={more} placement="above-start" width={200} onClose={() => setMore(null)} entries={[
          { label: t("표"), icon: 'table', onSelect: () => toDatabase('table') },
          { label: t("보드"), icon: 'board', onSelect: () => toDatabase('board') },
          { label: t("리스트"), icon: 'list', onSelect: () => toDatabase('list') },
          { label: t("타임라인"), icon: 'timeline', onSelect: () => toDatabase('timeline') },
          { label: t("캘린더"), icon: 'calendar', onSelect: () => toDatabase('calendar') },
          { label: t("갤러리"), icon: 'gallery', onSelect: () => toDatabase('gallery') },
          { kind: 'separator' },
          { label: t("가져오기"), icon: 'import', onSelect: () => openWorkspaceDialog('import', { parentId: page.id }) },
        ]} />
      ) : null}
    </div>
  );
}

// Over a page opened from the trash: "이 페이지는 휴지통에 있습니다" — 페이지 복원 · 영구 삭제.
function TrashBanner({ pageId, rootId }: { pageId: string; rootId: string }) {
  const root = workspace.get(rootId);
  return (
    <div className="trash-banner" role="status">
      <span>{rootId === pageId ? t("이 페이지는 휴지통에 있습니다.") : t("이 페이지는 휴지통에 있는 “{0}” 안에 있습니다.", [workspace.title(root) || t("새 페이지")])}</span>
      <button type="button" className="trash-banner-button" onClick={() => apply([{ type: 'node.restore', id: rootId }]).then(() => setStatus(t("복원했습니다."))).catch(report)}>{t("페이지 복원")}</button>
      <button type="button" className="trash-banner-button danger" onClick={() => { if (root) import('../dialogs/workspaceDialogs').then(module => module.purgeFromTrash([root])).then(done => { if (done) navigate(null); }).catch(report); }}>{t("영구 삭제")}</button>
    </div>
  );
}

export function PageView({ page, variant = 'full' }: { page: PageEntity; variant?: 'full' | 'peek' | 'center' | 'print' }) {
  const ws = useWorkspace();
  const live = ws.get<PageEntity>(page.id) ?? page;
  const { detail } = usePageDetail(live.id);
  const style = usePageStyle(live.id);
  const editorRef = useRef<PageEditorHandle>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [emoji, setEmoji] = useState<Element | null>(null);
  const [cover, setCover] = useState<Element | null>(null);
  const comments = useMemo(() => (detail?.entity.comments ?? []).filter(comment => comment.alive !== false), [detail]);
  const source = live.sourceId ? ws.get<SourceEntity>(live.sourceId) : undefined;
  // Printing (PDF export) shows the page as it reads: nothing to click, no lock note.
  const printing = variant === 'print';
  // A page opened from the trash reads as it was, with 복원 · 영구 삭제 over it.
  const trashed = ws.loaded && !ws.visible(live.id) ? trashRoot(live.id) : null;
  const archived = archivedRoot(live.id);
  const locked = isPageLocked(live), lockStored = pageLockStored(live);
  const [storedWikiTab, setWikiTab] = useWikiTab(live.id);
  const wikiTab = live.wiki && !printing ? storedWikiTab : 'home';
  const readOnly = locked || printing || !!trashed;
  const wide = !!live.fullWidth && variant === 'full';
  const layout = source?.pageLayout;
  const panelShown = !!layout?.panel?.length && variant !== 'peek' && !live.template;
  // The side panel folds to a slim rail (per database, in this browser).
  const [panelCollapsed, setPanelCollapsed] = useLocalPreference<boolean>(`pageyard-panel-collapsed:${live.sourceId ?? ''}`, false);
  const [storedTab, setActiveTab] = useLocalPreference<string | null>(`pageyard-page-tab:${live.sourceId ?? ''}`, null);
  const activeTab = layout?.structure === 'tabs' && storedTab && layout.tabs?.some(tab => tab.id === storedTab) ? storedTab : null;
  const coverUrl = live.coverAttachmentId ? `/api/attachments/${encodeURIComponent(live.coverAttachmentId)}` : null;

  // "아이콘 추가" puts a random emoji on the page at once and opens the picker
  // under it so it can be changed straight away.
  const addIcon = () => apply([{ type: 'page.update', id: live.id, icon: randomEmoji() }]).then(() => {
    requestAnimationFrame(() => { const icon = scroller?.querySelector<HTMLElement>('.page-icon'); if (icon) setEmoji(icon); });
  }).catch(report);

  // Presentation mode: "프레젠테이션" in the page's 더 보기 menu, "여기서 프레젠테이션 시작" in a block menu, ⌘⌥P
  // (from the caret's slide), or a slide link (?present=N).
  const [presenting, setPresenting] = useState<number | null>(() => {
    if (variant !== 'full') return null;
    const value = new URLSearchParams(location.search).get('present');
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  });
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ pageId: string; blockId: string | null; handled?: boolean }>).detail;
      if (detail.pageId !== live.id || detail.handled) return;
      detail.handled = true;
      setPresenting(slideOf(live.id, detail.blockId));
    };
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey || event.code !== 'KeyP' || variant !== 'full') return;
      event.preventDefault();
      const editor = editorRef.current?.view();
      const info = editor && editor.hasFocus() ? blockAt(editor.state.selection.$from) : null;
      setPresenting(slideOf(live.id, info?.node.attrs.id ?? null));
    };
    window.addEventListener(presentationEvent, onOpen);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(presentationEvent, onOpen); window.removeEventListener('keydown', onKey); };
  }, [live.id, variant]);
  const endPresentation = (firstId: string | null) => {
    setPresenting(null);
    if (firstId) requestAnimationFrame(() => scroller?.querySelector<HTMLElement>(`.page-editor [data-block-id="${CSS.escape(firstId)}"]`)?.scrollIntoView({ block: 'start' }));
  };

  // 분석 counts each time a page is opened (here, in this browser).
  useEffect(() => { if (!live.template && !printing) recordPageView(live.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [live.id]);

  // A page that was just created opens with the caret in its title.
  useEffect(() => {
    if (readOnly || live.title || Date.now() - Date.parse(live.createdAt) > 30000) return;
    if (ws.children(live.id).some(child => child.kind === 'block')) return;
    const title = scroller?.querySelector<HTMLElement>('.page-title');
    if (title && document.activeElement !== title) title.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.id, scroller]);

  return (
    <div ref={setScroller} className={`frame-scroller view-scroller page-scroller variant-${variant}`}>
      {trashed && !printing ? <TrashBanner pageId={live.id} rootId={trashed.id} /> : null}
      <div className={`page${wide ? ' full-width' : ''}${layout?.narrow ? ' narrow-margins' : ''} font-${style.font}${style.small ? ' small-text' : ''}${coverUrl ? ' has-cover' : ''}${live.icon ? ' has-icon' : ''}`}>
        {coverUrl ? (
          <div className="page-cover">
            <img src={coverUrl} alt="" draggable={false} />
            {!readOnly ? <div className="page-cover-actions"><button type="button" onClick={event => setCover(event.currentTarget)}>{t("커버 변경")}</button><button type="button" onClick={() => apply([{ type: 'page.update', id: live.id, coverAttachmentId: null }]).catch(report)}>{t("제거")}</button></div> : null}
          </div>
        ) : null}
        <div className={panelShown ? `page-columns${panelCollapsed ? ' panel-collapsed' : ''}` : 'page-single'}>
        <div className="page-body">
          <header className="page-header">
            {live.icon ? <button type="button" className={`page-icon${live.icon.startsWith('icon:') ? ' is-glyph' : ''}`} aria-label={t("아이콘 변경")} disabled={readOnly} onClick={event => setEmoji(event.currentTarget)}><PageIconGlyph icon={live.icon} size={variant === 'full' ? 64 : 48} /></button> : null}
            {!readOnly ? (
              <div className="page-controls">
                {!live.icon ? <button type="button" className="page-control" onClick={addIcon}><Icon name="emoji" size={14} />{t("아이콘 추가")}</button> : null}
                {!coverUrl ? <button type="button" className="page-control" onClick={event => setCover(event.currentTarget)}><Icon name="image" size={14} />{t("커버 추가")}</button> : null}
                {!comments.some(comment => comment.parentId === live.id && !comment.propertyId && !comment.resolved) ? <button type="button" className="page-control" onClick={() => openWorkspaceDialog('comment', { parentId: live.id })}><Icon name="comment" size={14} />{t("댓글 추가")}</button> : null}
              </div>
            ) : null}
            {live.template ? <div className="template-banner"><Icon name="template" size={16} /><span>{t("{0}의 템플릿을 편집하고 있습니다.", [source?.name ?? t("데이터베이스")])}</span><button type="button" className="text-button small" onClick={() => openWorkspaceDialog('recurrence', { templateId: live.id })}>{t("반복 설정")}</button></div> : null}
            <PageTitle page={live} readOnly={readOnly} small={variant === 'peek'}
              onEnter={rest => {
                const handle = editorRef.current;
                if (!handle) return;
                handle.focusStart(true);
                if (rest) handle.view()?.dispatch(handle.view()!.state.tr.insertText(rest));
              }}
              onArrowDown={() => editorRef.current?.focusStart(false)} />
            {live.sourceId ? <PinnedProperties page={live} detail={detail} /> : null}
            {live.sourceId ? <LayoutSections page={live} detail={detail} comments={comments} showComments={style.topComments !== false} /> : <>
              <RemindersRow page={live} />
              <Backlinks links={detail?.entity.backlinks ?? []} />
              {style.topComments !== false ? <CommentsSection page={live} comments={comments} /> : null}
            </>}
            {live.sourceId && layout?.structure === 'tabs' ? <PageTabs page={live} active={activeTab} onPick={setActiveTab} /> : null}
            {live.sourceId && !live.template && !readOnly && !activeTab && layout?.templates !== false && ws.loaded && !ws.children(live.id).some(child => child.kind === 'block') ? <RowTemplatePrompt page={live} /> : null}
            {locked && !printing && !trashed && !inTimeMachine() ? <div className="lock-banner"><Icon name="lock" size={14} /><span>{t("잠긴 페이지")}</span>
              <button type="button" className="text-button small" onClick={() => unlockPageForNow(live.id)} title={t("이 창에서만 잠금을 풀고 편집합니다")}>{t("이번만 편집")}</button>
              <button type="button" className="text-button small" onClick={() => setPageLock(live, false)}>{t("잠금 해제")}</button></div> : null}
            {!locked && lockStored && !printing && !trashed ? <div className="lock-banner unlocked"><Icon name="unlock" size={14} /><span>{t("잠긴 페이지를 편집하는 중")}</span>
              <button type="button" className="text-button small" onClick={() => unlockPageForNow(live.id, false)}>{t("다시 잠그기")}</button></div> : null}
            {archived && !printing && !trashed ? <div className="archive-banner"><Icon name="library" size={14} /><span>{archived.id === live.id ? t("보관된 페이지입니다. 검색과 데이터베이스 보기에 나타나지 않습니다.") : t("보관된 페이지 “{0}” 안에 있습니다.", [archived.title || t("새 페이지")])}</span>
              <button type="button" className="text-button small" onClick={() => apply([{ type: 'page.update', id: archived.id, archived: false }]).then(() => setStatus(t("보관을 해제했습니다."))).catch(report)}>{t("보관 해제")}</button></div> : null}
            {live.wiki && !printing ? <WikiTabs active={wikiTab} onPick={setWikiTab} /> : null}
          </header>
          {activeTab ? <TabDatabase page={live} tabId={activeTab} /> : null}
          {wikiTab !== 'home' ? <WikiPages pageId={live.id} mine={wikiTab === 'mine'} /> : null}
          <div className="page-content-tab" hidden={!!activeTab || wikiTab !== 'home'}>
          <PageEditor ref={editorRef} pageId={live.id} scroller={scroller} readOnly={readOnly} onExitTop={() => {
            const title = scroller?.querySelector<HTMLElement>('.page-title');
            if (!title) return;
            title.focus();
            const range = document.createRange();
            range.selectNodeContents(title); range.collapse(false);
            const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
          }} />
          </div>
        </div>
        {panelShown ? (panelCollapsed
          ? <aside className="page-panel collapsed" aria-label={t("패널")}><button type="button" className="icon-button page-panel-toggle" aria-label={t("패널 펼치기")} title={t("패널 펼치기")} onClick={() => setPanelCollapsed(false)}><Icon name="chevron-left" size={16} /></button></aside>
          : <aside className="page-panel" aria-label={t("패널")}>
              <div className="page-panel-head"><span>{t("세부 정보")}</span><button type="button" className="icon-button tiny page-panel-toggle" aria-label={t("패널 접기")} title={t("패널 접기")} onClick={() => setPanelCollapsed(true)}><Icon name="chevron-right" size={14} /></button></div>
              <PropertyRows page={live} detail={detail} list={layoutPlan(ws.schema(live.sourceId), layout).panel} panel />
            </aside>) : null}
        </div>
      </div>
      {!readOnly && variant !== 'peek' && !live.sourceId && !live.template && ws.loaded && !ws.children(live.id).some(child => child.kind === 'block' || child.kind === 'source' || child.kind === 'page') ? <StartChips page={live} /> : null}
      {variant === 'full' && style.toc !== false ? <TocRail scroller={scroller} /> : null}
      {emoji ? <EmojiPicker anchor={emoji} upload onClose={() => setEmoji(null)} onPick={value => apply([{ type: 'page.update', id: live.id, icon: value }]).catch(report)} onRemove={() => apply([{ type: 'page.update', id: live.id, icon: null }]).catch(report)} /> : null}
      {cover ? <CoverPicker anchor={cover} page={live} onClose={() => setCover(null)} /> : null}
      {presenting !== null ? <Presentation pageId={live.id} start={presenting} onClose={endPresentation} /> : null}
    </div>
  );
}
