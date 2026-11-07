import { t } from '../i18n';
import { useMemo, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/Icon';
import { workspace } from '../data/store';
import { EntityIcon } from '../page/EntityIcon';
import { schema } from './schema';
import type { PageEntity } from '../data/types';

function currentHref(view: EditorView): string {
  const { from, to } = view.state.selection;
  let href = '';
  view.state.doc.nodesBetween(from, Math.max(to, from + 1), node => {
    const mark = schema.marks.link.isInSet(node.marks);
    if (mark) href = mark.attrs.href;
  });
  return href;
}

export function LinkPopover({ view, anchor, onClose }: { view: EditorView; anchor: { x: number; y: number }; onClose: () => void }) {
  const [value, setValue] = useState(() => currentHref(view));
  const [active, setActive] = useState(0);
  const pages = useMemo(() => {
    const needle = value.trim().toLocaleLowerCase();
    if (!needle || /^https?:|^mailto:|^www\./.test(needle)) return [];
    return workspace.snapshot.objects.filter(item => item.kind === 'page' && !(item as PageEntity).template && workspace.visible(item.id) && ((item as PageEntity).title || '').toLocaleLowerCase().includes(needle)).slice(0, 6) as PageEntity[];
  }, [value]);
  const close = () => { onClose(); view.focus(); };
  const setLink = (href: string) => {
    const { from, to } = view.state.selection;
    const tr = view.state.tr.removeMark(from, to, schema.marks.link);
    if (href) tr.addMark(from, to, schema.marks.link.create({ href }));
    view.dispatch(tr);
    close();
  };
  const linkPage = (page: PageEntity) => {
    const { from, to } = view.state.selection;
    const text = view.state.doc.textBetween(from, to) || page.title || t("새 페이지");
    view.dispatch(view.state.tr.replaceWith(from, to, schema.nodes.mention.create({ pageId: page.id, text })));
    close();
  };
  const submit = () => {
    if (pages[active] && !/^https?:|^www\./.test(value)) return linkPage(pages[active]);
    const text = value.trim();
    if (!text) return setLink('');
    setLink(/^[a-z][\w+.-]*:/i.test(text) ? text : `https://${text}`);
  };
  return (
    <Popover anchor={{ x: anchor.x, y: anchor.y }} placement="point" onClose={close} className="link-popover" style={{ width: 360 }} label={t("링크")}>
      <div className="link-editor">
        <input className="text-input" autoFocus placeholder={t("링크를 붙여넣거나 페이지를 검색하세요")} value={value}
          onChange={event => { setValue(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(pages.length - 1, index + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
          }} />
        {pages.length ? (
          <div className="link-results">
            <div className="menu-heading">{t("페이지 링크")}</div>
            {pages.map((page, index) => (
              <div key={page.id} className={`menu-item${index === active ? ' active' : ''}`} onPointerMove={() => setActive(index)} onMouseDown={event => { event.preventDefault(); linkPage(page); }}>
                <span className="menu-item-icon"><EntityIcon item={page} /></span><span className="menu-item-label">{page.title || t("새 페이지")}</span>
              </div>
            ))}
          </div>
        ) : null}
        {currentHref(view) ? (
          <div className="menu-group">
            <div className="menu-item" onMouseDown={event => { event.preventDefault(); window.open(currentHref(view), '_blank', 'noopener'); }}><span className="menu-item-icon"><Icon name="arrow-up-right" /></span><span className="menu-item-label">{t("링크 열기")}</span></div>
            <div className="menu-item" onMouseDown={event => { event.preventDefault(); setLink(''); }}><span className="menu-item-icon"><Icon name="trash" /></span><span className="menu-item-label">{t("링크 제거")}</span></div>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
