import { t } from '../i18n';
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { report, setStatus } from '../data/store';
import { hrefFor } from '../data/router';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { EmojiPicker, PageIconGlyph } from '../page/PageView';
import type { AtomProps } from './atoms';
import { activeTabId, addTab, deleteTab, updateTab, writeSelectedTab } from './tabs';

// The tab bar of a tabs block: pills 32 high (r9999, 14/500), the shown
// one on a light wash; clicking the shown tab opens 이름 바꾸기 · 아이콘 편집 · 링크 복사 · 삭제
// (180 wide, 4 below). "+" (shown while the bar is hovered) adds 탭N and starts renaming it.

interface TabItem { id: string; title: string; icon: string | null }

export function TabsHeader({ entry, view, pageId }: AtomProps) {
  const tabs = entry.node;
  const tabsId = tabs.attrs.id as string;
  const active = activeTabId(tabs);
  const [menu, setMenu] = useState<{ anchor: Element; tabId: string } | null>(null);
  const [picker, setPicker] = useState<{ anchor: Element; tabId: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const items: TabItem[] = [];
  tabs.forEach(tab => items.push({ id: tab.attrs.id, title: tab.attrs.title, icon: tab.attrs.icon }));
  const editable = view.editable;
  const pillOf = (id: string) => barRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`) ?? null;

  const choose = (id: string, anchor: Element) => {
    if (id !== active) { writeSelectedTab(tabsId, id); return; }
    if (editable) setMenu({ anchor, tabId: id });
  };
  const onKey = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
      writeSelectedTab(tabsId, next.id);
      requestAnimationFrame(() => pillOf(next.id)?.focus());
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(items[index].id, event.currentTarget);
    }
  };
  const finishRename = (id: string, title: string) => {
    setRenaming(null);
    updateTab(view, id, { title: title.replace(/\s*\n\s*/g, ' ') });
  };

  return (
    <>
      <div className="tabs-bar" role="tablist" aria-label={t("탭 블록")} ref={barRef}>
        {items.map((item, index) => item.id === renaming ? (
          <TabRename key={item.id} item={item} onDone={title => finishRename(item.id, title)} />
        ) : (
          <div key={item.id} data-tab={item.id} role="tab" tabIndex={item.id === active ? 0 : -1} aria-selected={item.id === active}
            className={`tab-pill${item.id === active ? ' active' : ''}`}
            onClick={event => choose(item.id, event.currentTarget)} onKeyDown={event => onKey(event, index)}>
            {item.icon ? <span className="tab-icon"><PageIconGlyph icon={item.icon} size={18} /></span> : null}
            <span className="tab-title">{item.title || t("tabs|새 탭")}</span>
          </div>
        ))}
      </div>
      {editable ? (
        <div className="tabs-add-wrap">
          <button type="button" className="tabs-add" aria-label={t("탭 추가")} onMouseDown={event => event.preventDefault()}
            onClick={() => { const id = addTab(view, tabsId); if (id) setRenaming(id); }}>
            <Icon name="plus" size={20} />
          </button>
        </div>
      ) : null}
      {menu ? (
        <Menu anchor={menu.anchor} placement="below-start" offset={4} width={180} label={t("탭")} onClose={() => setMenu(null)} entries={[
          { label: t("tab-menu|이름 바꾸기"), icon: 'pencil', onSelect: () => setRenaming(menu.tabId) },
          { label: t("아이콘 편집"), icon: 'emoji', onSelect: () => { const anchor = pillOf(menu.tabId); if (anchor) setPicker({ anchor, tabId: menu.tabId }); } },
          { label: t("tab-menu|링크 복사"), icon: 'link', onSelect: () => {
            const url = new URL(hrefFor(pageId), location.href); url.hash = menu.tabId;
            navigator.clipboard.writeText(url.href).then(() => setStatus(t("링크를 복사했습니다."))).catch(report);
          } },
          { label: t("tab-menu|삭제"), icon: 'trash', onSelect: () => deleteTab(view, tabsId, menu.tabId) },
        ]} />
      ) : null}
      {picker ? (
        <EmojiPicker anchor={picker.anchor} onClose={() => setPicker(null)} onPick={icon => updateTab(view, picker.tabId, { icon })}
          onRemove={items.find(item => item.id === picker.tabId)?.icon ? () => updateTab(view, picker.tabId, { icon: null }) : undefined} />
      ) : null}
    </>
  );
}

// 이름 바꾸기: the name becomes editable in place, all of it selected (placeholder 새 탭);
// Enter, Esc or leaving it keeps what was typed.
function TabRename({ item, onDone }: { item: TabItem; onDone: (title: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.textContent = item.title;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(ref.current?.textContent ?? '');
  };
  return (
    <div role="tab" aria-selected className="tab-pill active renaming">
      {item.icon ? <span className="tab-icon"><PageIconGlyph icon={item.icon} size={18} /></span> : null}
      <span ref={ref} className="tab-title-input" role="textbox" contentEditable="plaintext-only" suppressContentEditableWarning data-placeholder={t("tabs|새 탭")}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(); (event.currentTarget as HTMLElement).blur(); }
        }}
        onBlur={finish} />
    </div>
  );
}
