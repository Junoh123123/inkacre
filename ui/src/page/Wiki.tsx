import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { useLocalPreference } from '../data/hooks';
import { relativeTime } from '../data/format';
import { hrefFor, navigate } from '../data/router';
import { useWorkspace, workspace } from '../data/store';
import type { PageEntity } from '../data/types';
import { Icon } from '../ui/Icon';
import { EntityIcon } from './EntityIcon';

// 위키 (turn into wiki — the page gets 홈, 모든 페이지 and 내 페이지): 홈 is the page's own content; 모든 페이지
// lists every page under it (sub-pages at any depth, database pages and their rows' parents are not repeated), with
// who made it and when it was last edited; 내 페이지 keeps those you made yourself (not an agent or automation).

export type WikiTab = 'home' | 'all' | 'mine';
const actorName = (actor: string) => actor === 'user' ? t("나") : actor === 'agent' ? t("에이전트") : actor === 'automation' ? t("자동화") : actor;

export function useWikiTab(pageId: string) {
  return useLocalPreference<WikiTab>(`pageyard-wiki-tab:${pageId}`, 'home');
}

export function WikiTabs({ active, onPick }: { active: WikiTab; onPick: (tab: WikiTab) => void }) {
  const tabs: Array<{ id: WikiTab; label: string; icon: string }> = [
    { id: 'home', label: t("홈"), icon: 'home' }, { id: 'all', label: t("모든 페이지"), icon: 'list' }, { id: 'mine', label: t("내 페이지"), icon: 'people' },
  ];
  return (
    <div className="wiki-tabs" role="tablist" aria-label={t("위키")}>
      <span className="wiki-badge"><Icon name="library" size={14} />{t("위키")}</span>
      {tabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={`wiki-tab${active === tab.id ? ' selected' : ''}`} onClick={() => onPick(tab.id)}><Icon name={tab.icon} size={14} />{tab.label}</button>)}
    </div>
  );
}

function descendants(rootId: string): Array<{ page: PageEntity; path: string }> {
  const out: Array<{ page: PageEntity; path: string }> = [];
  const visit = (id: string, path: string[]) => {
    for (const child of workspace.children(id)) {
      if (child.kind === 'page') {
        const page = child as PageEntity;
        if (page.template || page.sourceId || !workspace.visible(page.id) || page.archived) continue;
        out.push({ page, path: path.join(' / ') });
        visit(page.id, [...path, page.title || t("새 페이지")]);
      }
    }
  };
  visit(rootId, []);
  return out;
}

export function WikiPages({ pageId, mine }: { pageId: string; mine: boolean }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'edited' | 'title'>('edited');
  const rows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return descendants(pageId)
      .filter(row => !mine || row.page.createdBy === 'user')
      .filter(row => !text || (row.page.title || '').toLocaleLowerCase().includes(text))
      .sort((a, b) => sort === 'title' ? (a.page.title || '').localeCompare(b.page.title || '', 'ko') : b.page.updatedAt.localeCompare(a.page.updatedAt));
  }, [ws.version, pageId, mine, query, sort]);
  return (
    <div className="wiki-pages">
      <div className="wiki-pages-tools">
        <input className="text-input wiki-search" placeholder={t("페이지 검색…")} aria-label={t("페이지 검색")} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" className="filter-chip" onClick={() => setSort(sort === 'edited' ? 'title' : 'edited')}><Icon name="sort" size={14} /><span>{sort === 'edited' ? t("최종 편집 일시") : t("이름")}</span></button>
        <span className="muted wiki-count">{t("페이지 {0}개", [rows.length])}</span>
      </div>
      <div className="wiki-table" role="table">
        <div className="wiki-row head" role="row"><span role="columnheader">{t("페이지")}</span><span role="columnheader">{t("소유자")}</span><span role="columnheader">{t("최종 편집 일시")}</span></div>
        {rows.map(({ page, path }) => (
          <a key={page.id} role="row" className="wiki-row" href={hrefFor(page.id)} onClick={event => { event.preventDefault(); navigate(page.id); }}>
            <span className="wiki-name" role="cell"><EntityIcon item={page} size={18} /><span className="wiki-title">{page.title || t("새 페이지")}</span>{path ? <span className="wiki-path">{path}</span> : null}</span>
            <span role="cell" className="wiki-owner">{actorName(page.createdBy)}</span>
            <span role="cell" className="wiki-edited">{relativeTime(page.updatedAt)}</span>
          </a>
        ))}
        {!rows.length ? <p className="muted wiki-empty">{mine ? t("내가 만든 하위 페이지가 없습니다.") : t("하위 페이지가 없습니다.")}</p> : null}
      </div>
    </div>
  );
}
