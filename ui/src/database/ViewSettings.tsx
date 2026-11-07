import { t } from '../i18n';
import { useRef, useState, type ReactNode } from 'react';
import { apply } from '../data/commands';
import { report, setStatus, useWorkspace } from '../data/store';
import { useLocalPreference } from '../data/hooks';
import { hrefFor } from '../data/router';
import { propertyLabels } from '../data/format';
import type { Filter, PropertyEntity, QueryResult, SourceEntity, ViewEntity, ViewType } from '../data/types';
import { Icon, viewIcon } from '../ui/Icon';
import { Switch } from '../ui/primitives';
import { FilterEditor } from '../dialogs/filters';
import { openWorkspaceDialog } from '../dialogs/registry';
import { defaultOpenMode, filterRules, layoutOrder, setDatabaseLock, shownProperties, updateView, useDatabaseLock, viewTypeLabels } from './shared';
import { openPageLayoutEditor } from './PageLayoutEditor';
import { FilterRuleList } from './FilterSortBar';
import { NewPropertyMenu } from './PropertyMenus';
import { GroupTitle } from './BoardView';
import { Menu, type MenuEntry } from '../ui/Menu';
import { useLayer } from '../ui/overlay';
import { displayGroups } from './shared';
import { PickRow, Row, SwitchRow, ValueRow } from './settingsRows';
import { ChartSettings, defaultChart } from './ChartSettings';
import { copyChart, saveChart, type ChartBackground } from './chartExport';
import { AutomationsPanel } from './Automations';
import { ConditionalColorsPage } from './ConditionalColors';
import { DataSourcesPage, NewSourcePage, convertToTaskDatabase } from './DataSources';

type Page = string;

export function ViewSettingsPanel({ view, result, sourceId, page, onPage, onClose, inline, anchor }: { view: ViewEntity; result: QueryResult; sourceId: string; page: Page; onPage: (page: Page) => void; onClose: () => void; inline: boolean; anchor?: () => Element | null }) {
  const ws = useWorkspace();
  // Closes on a press outside it or Escape.
  const panelRef = useRef<HTMLElement>(null);
  useLayer(panelRef, onClose, anchor);
  const live = ws.get<ViewEntity>(view.id) ?? view;
  const config = live.config;
  const source = ws.get<SourceEntity>(sourceId);
  const schema = result.properties;
  const { locked } = useDatabaseLock(sourceId);
  const [name, setName] = useState(live.name);
  const [newProperty, setNewProperty] = useState<Element | null>(null);
  const [saveMenu, setSaveMenu] = useState<HTMLElement | null>(null);
  const [propertyQuery, setPropertyQuery] = useState('');
  const [chartBackground, setChartBackground] = useLocalPreference<ChartBackground>('pageyard-chart-background', 'white');
  const chartSvg = () => panelRef.current?.closest('.database-block')?.querySelector<SVGSVGElement>('.chart-svg') ?? null;
  const [filter, setFilter] = useState<Filter | null>(config.filter ?? null);
  const [open, setOpen] = useState<{ kind: 'convert' | 'more'; anchor: Element } | null>(null);
  const option = (property: PropertyEntity) => ({ id: property.id, name: property.name });
  const none = { id: '', name: t("없음") };
  const header = (title: string, back = true, backTo = 'main') => (
    <div className="settings-head">
      {back ? <button type="button" className="icon-button tiny" aria-label={t("뒤로")} onClick={() => onPage(backTo)}><Icon name="arrow-left" size={16} /></button> : null}
      <span className="settings-title">{title}</span>
      <span className="spacer" />
      <button type="button" className="settings-close" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={12} /></button>
    </div>
  );

  let body: ReactNode;
  const type = live.viewType;
  const dates = schema.filter(property => property.type === 'date');
  const layoutTiles = (
    <div className="layout-grid">
          {/* The layout page offers nine layouts; a form or dashboard is made from "+". */}
          {layoutOrder.filter(item => (item !== 'form' && item !== 'dashboard') || item === type).map(item => (
            <button type="button" key={item} className={`layout-tile${item === type ? ' active' : ''}`} onClick={() => {
              const patch: Record<string, unknown> = {};
              if (item === 'board' && !config.groupBy) patch.groupBy = schema.find(property => property.type === 'status')?.id ?? schema.find(property => property.type === 'select')?.id ?? null;
              if ((item === 'calendar' || item === 'timeline') && !config.datePropertyId) patch.datePropertyId = dates[0]?.id ?? null;
              if (item === 'chart' && !config.chart) patch.chart = defaultChart(schema);
              const rename = page === 'new' && name === viewTypeLabels[live.viewType] ? viewTypeLabels[item as ViewType] : undefined;
              if (rename) setName(rename);
              updateView(live, patch, { viewType: item as ViewType, ...(rename ? { name: rename } : {}) });
            }}>
              <Icon name={viewIcon[item] ?? 'table'} size={20} /><span>{viewTypeLabels[item as ViewType]}</span>
            </button>
          ))}
        </div>
  );
  // Board and gallery: 페이지 아이콘 표시 · 모든 콘텐츠 줄바꿈 · (보드: 그룹화 › · 열 배경색) ·
  // 페이지 열기 방식 | 카드 미리보기 · 카드 크기 (작게 180 · 중간 260 · 크게 320) | a grey "카드 레이아웃" box with two
  // pictures, 작게 (compact, then "압축 카드 설정 ›") and 목록.
  const groupProperty = schema.find(property => property.id === config.groupBy);
  // 하위 항목 (sub-item display per view): nested under their parent, a flat list or inside the parent's
  // card, and which items to show — the engine's view config `subitems` (defaults by layout in tasks.mjs).
  const subitemDefault = ['table', 'list', 'timeline'].includes(type) ? { display: 'nested', include: 'all' } : ['board', 'calendar', 'gallery'].includes(type) ? { display: 'card', include: 'parents' } : { display: 'flat', include: 'all' };
  const subitems = (config.subitems ?? subitemDefault) as NonNullable<typeof config.subitems>;
  const subitemRows = source?.tasks?.subitems?.enabled && !['chart', 'form', 'dashboard', 'map'].includes(type) ? (
    <>
      <PickRow label={t("하위 항목 표시")} value={subitems.display} options={[
        ...(['table', 'list', 'timeline'].includes(type) ? [{ id: 'nested', name: t("상위 항목 아래 중첩") }] : []),
        { id: 'flat', name: t("평면 목록") },
        ...(['board', 'calendar', 'gallery'].includes(type) ? [{ id: 'card', name: t("상위 카드 안에") }] : []),
      ]} onChange={value => updateView(live, { subitems: { ...subitems, display: value as typeof subitems.display } })} />
      <PickRow label={t("표시할 항목")} value={subitems.include} options={[{ id: 'all', name: t("상위 · 하위 항목 모두") }, { id: 'parents', name: t("상위 항목만") }, { id: 'children', name: t("하위 항목만") }]}
        onChange={value => updateView(live, { subitems: { ...subitems, include: value as typeof subitems.include } })} />
    </>
  ) : null;
  const cardLayout = config.cardLayout ?? 'list';
  const cardOptions = (
    <>
      <div className="settings-section">
        <SwitchRow label={t("페이지 아이콘 표시")} checked={config.showPageIcon !== false} onChange={value => updateView(live, { showPageIcon: value })} />
        <SwitchRow label={t("모든 콘텐츠 줄바꿈")} checked={config.wrapProperties ?? type === 'board'} onChange={value => updateView(live, { wrapProperties: value })} />
        {type === 'board' ? <ValueRow label={t("그룹화")} value={groupProperty?.name ?? t("없음")} onClick={() => onPage('group')} /> : null}
        {type === 'board' && groupProperty ? <SwitchRow label={t("열 배경색")} checked={config.columnBackground !== false} onChange={value => updateView(live, { columnBackground: value })} /> : null}
        {type === 'board' ? <PickRow label={t("하위 그룹")} value={config.subgroupBy ?? ''} options={[none, ...schema.filter(property => ['select', 'status', 'multi_select', 'checkbox', 'person'].includes(property.type)).map(option)]} onChange={value => updateView(live, { subgroupBy: value || null })} /> : null}
        <PickRow label={t("페이지 열기 방식")} value={config.openMode ?? defaultOpenMode(type)} options={[{ id: 'side', name: t("사이드 보기") }, { id: 'center', name: t("중앙에서 보기") }, { id: 'page', name: t("전체 페이지") }]} onChange={value => updateView(live, { openMode: value as 'side' | 'center' | 'page' })} />
      </div>
      <div className="settings-section">
        <PickRow label={t("카드 미리보기")} value={config.galleryPreview ?? (type === 'gallery' ? 'page_cover' : 'none')} options={[{ id: 'none', name: t("없음") }, { id: 'page_cover', name: t("페이지 커버") }, { id: 'page_content', name: t("페이지 콘텐츠") }, { id: 'files', name: t("파일과 미디어") }]} onChange={value => updateView(live, { galleryPreview: value as 'none' | 'page_cover' | 'page_content' | 'files' })} />
        {['page_cover', 'files'].includes(config.galleryPreview ?? (type === 'gallery' ? 'page_cover' : 'none')) ? <SwitchRow label={t("이미지 맞춤")} checked={config.previewFit === 'contain'} onChange={value => updateView(live, { previewFit: value ? 'contain' : 'cover' })} /> : null}
        <SwitchRow label={t("페이지 이름 표시")} checked={!config.hideTitle} onChange={value => updateView(live, { hideTitle: !value })} />
        {config.galleryPreview === 'files' ? <PickRow label={t("미리보기 속성")} value={config.previewPropertyId ?? ''} options={[{ id: '', name: t("첫 파일 속성") }, ...schema.filter(property => property.type === 'files').map(option)]} onChange={value => updateView(live, { previewPropertyId: value || null })} /> : null}
        {subitemRows}
        <PickRow label={t("카드 크기")} value={config.cardSize ?? 'medium'} options={[{ id: 'small', name: t("작게") }, { id: 'medium', name: t("중간") }, { id: 'large', name: t("크게") }]} onChange={value => updateView(live, { cardSize: value as 'small' | 'medium' | 'large' })} />
      </div>
      <div className="card-layout-box">
        <div className="card-layout-title">{t("카드 레이아웃")}</div>
        <div className="card-layout-tiles">
          {([['compact', t("작게")], ['list', t("목록")]] as const).map(([id, label]) => (
            <button type="button" key={id} className={`card-layout-tile${cardLayout === id ? ' active' : ''}`} aria-pressed={cardLayout === id} onClick={() => updateView(live, { cardLayout: id })}>
              <span className={`card-layout-art ${id}`}><span className="art-head" /><span className="art-dot" /><span className="art-line a" /><span className="art-line b" /><span className="art-line c" /></span>
              <span className="card-layout-label">{label}</span>
            </button>
          ))}
        </div>
        {cardLayout === 'compact' ? <button type="button" className="settings-row card-layout-more" onClick={() => onPage('compact-cards')}><span className="settings-row-label">{t("압축 카드 설정")}</span><Icon name="chevron-right" size={14} className="settings-row-chevron" /></button> : null}
      </div>
    </>
  );
  const layoutOptions = type === 'chart' || type === 'form' ? null : type === 'board' || type === 'gallery' ? cardOptions : (
        <div className="settings-section">
          {type === 'table' || type === 'list' ? <PickRow label={t("그룹화 기준")} value={config.groupBy ?? ''} options={[none, ...schema.filter(property => ['select', 'status', 'multi_select', 'checkbox', 'person', 'relation', 'text', 'number', 'date'].includes(property.type)).map(option)]} onChange={value => updateView(live, { groupBy: value || null })} /> : null}
          {type === 'calendar' || type === 'timeline' ? (
            <>
              <PickRow label={type === 'calendar' ? t("캘린더 표시 기준") : t("시작 날짜")} value={config.datePropertyId ?? ''} options={[none, ...dates.map(option)]} onChange={value => updateView(live, { datePropertyId: value || null })} />
              <PickRow label={t("종료 날짜")} value={config.endDatePropertyId ?? ''} options={[{ id: '', name: t("같은 속성") }, ...dates.map(option)]} onChange={value => updateView(live, { endDatePropertyId: value || null })} />
            </>
          ) : null}
          {type === 'calendar' ? <PickRow label={t("표시 단위")} value={config.calendarMode ?? 'month'} options={[{ id: 'month', name: t("월") }, { id: 'week', name: t("주") }]} onChange={value => updateView(live, { calendarMode: value as 'month' | 'week' })} /> : null}
          {type === 'timeline' ? <PickRow label={t("확대")} value={config.timelineZoom ?? 'month'} options={[{ id: 'hour', name: t("zoom|시간") }, { id: 'day', name: t("일") }, { id: 'week', name: t("주") }, { id: 'biweek', name: t("zoom|2주") }, { id: 'month', name: t("월") }, { id: 'quarter', name: t("zoom|분기") }, { id: 'year', name: t("zoom|연") }]} onChange={value => updateView(live, { timelineZoom: value as NonNullable<typeof config.timelineZoom> })} /> : null}
          {type === 'feed' || type === 'map' ? <SwitchRow label={t("페이지 아이콘 표시")} checked={config.showPageIcon !== false} onChange={value => updateView(live, { showPageIcon: value })} /> : null}
          {type === 'feed' ? <SwitchRow label={t("속성 줄바꿈")} checked={!!config.wrapProperties} onChange={value => updateView(live, { wrapProperties: value })} /> : null}
          {type === 'feed' ? <SwitchRow label={t("작성자 표시")} checked={config.showAuthor !== false} onChange={value => updateView(live, { showAuthor: value })} /> : null}
          {type === 'map' ? <PickRow label={t("매핑")} value={config.placePropertyId ?? ''} options={[none, ...schema.filter(property => property.type === 'place').map(option)]} onChange={value => updateView(live, { placePropertyId: value || null })} /> : null}
          {type === 'dashboard' ? (
            <div className="settings-list">
              <div className="menu-heading">{t("대시보드에 넣을 보기")}</div>
              {ws.snapshot.objects.filter(item => item.kind === 'view' && (item as ViewEntity).viewType !== 'dashboard' && ws.visible(item.id)).map(item => {
                const widgets = config.widgets ?? [];
                return <SwitchRow key={item.id} label={`${(item as ViewEntity).name} · ${ws.get<SourceEntity>((item as ViewEntity).sourceId)?.name ?? ''}`} checked={widgets.includes(item.id)} onChange={on => updateView(live, { widgets: on ? [...widgets, item.id] : widgets.filter(id => id !== item.id) })} />;
              })}
            </div>
          ) : null}
          <PickRow label={t("페이지 열기 방식")} value={config.openMode ?? defaultOpenMode(type)} options={[{ id: 'side', name: t("사이드 보기") }, { id: 'center', name: t("중앙에서 보기") }, { id: 'page', name: t("전체 페이지") }]} onChange={value => updateView(live, { openMode: value as 'side' | 'center' | 'page' })} />
          {subitemRows}
          {type === 'feed' || type === 'timeline' ? <PickRow label={t("불러오기 제한")} value={String(config.loadLimit ?? (type === 'feed' ? 10 : 50))} options={[10, 25, 50, 100].map(n => ({ id: String(n), name: t("{0}개 페이지", [n]) }))} onChange={value => updateView(live, { loadLimit: Number(value) })} /> : null}
        </div>
  );
  if (page === 'compact-cards') {
    // 압축 카드 설정: a picture, a note, "전체 행 표시" with a switch per shown property (the
    // title always on), then "속성 표시".
    const visible = shownProperties(result);
    const full = new Set(config.fullWidthProperties ?? []);
    body = (
      <>
        {header(t("압축 카드 설정"), true, 'layout')}
        <div className="compact-preview"><span className="compact-preview-switch" /><span className="compact-preview-card"><span className="cp-id">TASK-123456</span><span className="cp-dot" /><span className="cp-bar" /><span className="cp-row"><span className="cp-dot" /><span className="cp-bar short" /></span></span></div>
        <p className="compact-note">{t("켜 둔 속성은 다른 속성과 한 줄에 섞이지 않고 자기 줄에 표시됩니다.")}</p>
        <div className="settings-list">
          <div className="settings-subhead"><span>{t("전체 행 표시")}</span></div>
          {visible.map(property => (
            <SwitchRow key={property.id} icon={`type-${property.type}`} label={property.name} checked={property.type === 'title' || full.has(property.id)}
              onChange={value => { if (property.type === 'title') return; const next = new Set(full); if (value) next.add(property.id); else next.delete(property.id); updateView(live, { fullWidthProperties: [...next] }); }} />
          ))}
          <button type="button" className="settings-row add" onClick={() => onPage('properties')}><Icon name="eye" size={16} /><span className="settings-row-label">{t("속성 표시")}</span></button>
        </div>
      </>
    );
  } else if (page === 'layout') {
    body = (
      <>
        {header(t("레이아웃"))}
        {layoutTiles}
        {layoutOptions}
      </>
    );
  } else if (page === 'new') {
    // "새 보기": docked like the settings, name field focused, the layout tiles,
    // the layout's own options, the source, then a blue "완료" ("차트 편집" for a chart).
    body = (
      <>
        <div className="settings-head"><span className="settings-title new-view-title">{t("새 보기")}</span><span className="spacer" /><button type="button" className="settings-close" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={12} /></button></div>
        <div className="settings-name">
          <span className="property-type-box"><Icon name={viewIcon[live.viewType] ?? 'table'} size={18} /></span>
          <input className="text-input" autoFocus value={name} placeholder={t("보기 이름")} aria-label={t("보기 이름")} onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)}
            onBlur={() => { if (name.trim() && name !== live.name) updateView(live, {}, { name: name.trim() }); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); }} />
        </div>
        {layoutTiles}
        {layoutOptions}
        <div className="settings-section">
          <Row icon="database" label={t("소스")} value={source?.name} onClick={() => undefined} />
        </div>
        <div className="new-view-done">
          <button type="button" className="blue-button" onClick={() => { if (name.trim() && name !== live.name) updateView(live, {}, { name: name.trim() }); if (type === 'chart') onPage('main'); else onClose(); }}>{type === 'chart' ? t("차트 편집") : t("완료")}</button>
        </div>
      </>
    );
  } else if (page === 'properties') {
    // A search box filters both lists ("Search for a property").
    const needle = propertyQuery.trim().toLocaleLowerCase();
    const matches = (property: PropertyEntity) => !needle || property.name.toLocaleLowerCase().includes(needle);
    const allVisible = shownProperties(result);
    const visible = allVisible.filter(matches);
    const hidden = schema.filter(property => !allVisible.includes(property)).filter(matches);
    const order = config.visibleProperties ?? result.visibleProperties;
    const set = (ids: string[]) => updateView(live, { visibleProperties: ids });
    body = (
      <>
        {header(t("속성"))}
        <div className="settings-search"><Icon name="search" size={14} /><input value={propertyQuery} placeholder={t("속성 검색…")} aria-label={t("속성 검색")} onChange={event => setPropertyQuery(event.target.value)} /></div>
        <div className="settings-list">
          <div className="settings-subhead"><span>{t("표시")}</span><button type="button" className="text-button small" onClick={() => set(schema.filter(property => property.type === 'title').map(property => property.id))}>{t("모두 숨기기")}</button></div>
          {visible.map((property, index) => (
            <div key={property.id} className="settings-row property-toggle" draggable={property.type !== 'title'}
              onDragStart={event => event.dataTransfer.setData('text/plain', property.id)} onDragOver={event => event.preventDefault()}
              onDrop={event => { const id = event.dataTransfer.getData('text/plain'); if (!id || id === property.id) return; const next = order.filter(item => item !== id); next.splice(next.indexOf(property.id) + (index === 0 ? 1 : 0), 0, id); set(next); }}>
              <Icon name="drag" size={16} className="option-handle" />
              <Icon name={`type-${property.type}`} size={16} />
              <span className="settings-row-label">{property.name}</span>
              {property.type !== 'title' ? <button type="button" className="icon-button tiny" aria-label={t("{0} 숨기기", [property.name])} onClick={() => set(order.filter(id => id !== property.id))}><Icon name="eye" size={16} /></button> : <span className="muted small">{t("제목")}</span>}
            </div>
          ))}
          {needle && !visible.length && !hidden.length ? <div className="settings-empty muted">{t("결과 없음")}</div> : null}
          {hidden.length ? <div className="settings-subhead"><span>{t("숨김")}</span><button type="button" className="text-button small" onClick={() => set([...order, ...hidden.map(property => property.id)])}>{t("모두 표시")}</button></div> : null}
          {hidden.map(property => (
            <div key={property.id} className="settings-row property-toggle hidden-property">
              <Icon name={`type-${property.type}`} size={16} />
              <span className="settings-row-label">{property.name}</span>
              <button type="button" className="icon-button tiny" aria-label={t("{0} 표시", [property.name])} onClick={() => set([...order.filter(id => id !== property.id), property.id])}><Icon name="eye-off" size={16} /></button>
            </div>
          ))}
          <button type="button" className="settings-row add" onClick={event => setNewProperty(event.currentTarget)}><Icon name="plus" size={16} /><span className="settings-row-label">{t("새 속성")}</span></button>
        </div>
        {newProperty ? <NewPropertyMenu anchor={newProperty} sourceId={sourceId} view={live} result={result} onClose={() => setNewProperty(null)} placement="below-start" /> : null}
      </>
    );
  } else if (page === 'filter' || page === 'filter-only') {
    // 필터: the rules as chips behind drag handles, then "+ 필터 추가"; changes apply
    // as they are made. Opened from an empty filtered table ("필터 편집") it has no way back.
    const rules = config.advancedFilter && config.filter ? null : filterRules(config.filter);
    body = (
      <>
        {header(t("필터"), page === 'filter')}
        {rules ? (
          <FilterRuleList rules={rules} properties={schema} onChange={next => updateView(live, { filter: next.length ? { all: next } : null })}
            onAdvanced={() => updateView(live, { filter: rules.length ? { all: rules } : null, advancedFilter: true })} />
        ) : (
          <div className="settings-filter">
            <FilterEditor sourceId={sourceId} value={filter} onChange={next => { setFilter(next); updateView(live, { filter: next, advancedFilter: true }); }}
              onDeleteAll={() => { setFilter(null); updateView(live, { filter: null, advancedFilter: false }); }} />
          </div>
        )}
      </>
    );
  } else if (page === 'group') {
    body = <>{header(t("그룹"))}<GroupSettings view={live} result={result} /></>;
  } else if (page === 'colors') {
    body = <>{header(t("조건부 색상"))}<ConditionalColorsPage view={live} result={result} /></>;
  } else if (page === 'automations') {
    body = (
      <>
        <div className="settings-head">
          <span className="settings-title">{t("자동화")}</span><Icon name="question" size={16} className="settings-title-help" />
          <span className="spacer" />
          <button type="button" className="settings-close" aria-label={t("닫기")} onClick={onClose}><Icon name="close" size={12} /></button>
        </div>
        <AutomationsPanel sourceId={sourceId} />
      </>
    );
  } else if (page === 'new-source') {
    body = <>{header(t("새 데이터 소스"), false)}<NewSourcePage view={live} sourceId={sourceId} onClose={onClose} /></>;
  } else if (page === 'sources') {
    body = <>{header(t("데이터 소스 관리"))}<DataSourcesPage view={live} sourceId={sourceId} onClose={onClose} /></>;
  } else if (page === 'source') {
    body = (
      <>
        {header(t("속성 편집"))}
        <div className="settings-list">
          {schema.map(property => (
            <button type="button" key={property.id} className="settings-row" onClick={() => openWorkspaceDialog('property', { sourceId, propertyId: property.id })}>
              <Icon name={`type-${property.type}`} size={16} /><span className="settings-row-label">{property.name}</span><span className="settings-row-value">{propertyLabels[property.type]}</span><Icon name="chevron-right" size={14} className="settings-row-chevron" />
            </button>
          ))}
          <button type="button" className="settings-row add" onClick={event => setNewProperty(event.currentTarget)}><Icon name="plus" size={16} /><span className="settings-row-label">{t("새 속성")}</span></button>
        </div>
        {newProperty ? <NewPropertyMenu anchor={newProperty} sourceId={sourceId} view={live} result={result} onClose={() => setNewProperty(null)} placement="below-start" /> : null}
      </>
    );
  } else {
    const filterCount = config.filter ? ('all' in config.filter ? config.filter.all.length : 1) : 0;
    body = (
      <>
        {header(t("보기 설정"), false)}
        <div className="settings-name">
          <span className="property-type-box"><Icon name={viewIcon[live.viewType] ?? 'table'} size={18} /></span>
          <input className="text-input" value={name} aria-label={t("보기 이름")} disabled={locked} onChange={event => setName(event.target.value)}
            onBlur={() => { if (name.trim() && name !== live.name) updateView(live, {}, { name: name.trim() }); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) (event.target as HTMLInputElement).blur(); }} />
        </div>
        {live.viewType === 'chart' ? (
          // A chart: 레이아웃 / the chart's own settings / 소스 · 필터 / 차트 저장 · 보기 링크 복사.
          <>
            <div className="settings-section">
              <Row icon={viewIcon.chart} label={t("레이아웃")} value={viewTypeLabels.chart} onClick={() => onPage('layout')} />
            </div>
            <ChartSettings view={live} result={result} />
            <div className="settings-section">
              <Row icon="swap" label={t("소스")} value={source?.name} onClick={() => onPage('source')} />
              <Row icon="filter" label={t("필터")} value={filterCount ? t("{0}개", [filterCount]) : undefined} onClick={() => onPage('filter')} />
            </div>
            <div className="settings-section">
              {config.chart?.type !== 'number' ? <Row icon="download" label={t("다른 이름으로 차트 저장…")} onClick={anchor => setSaveMenu(anchor)} /> : null}
              <button type="button" className="settings-row" onClick={() => navigator.clipboard.writeText(new URL(hrefFor(live.id), location.href).href).then(() => setStatus(t("보기 링크를 복사했습니다."))).catch(report)}><Icon name="link" size={20} /><span className="settings-row-label">{t("보기 링크 복사")}</span></button>
            </div>
          </>
        ) : (
          <div className="settings-section">
            <Row icon={viewIcon[live.viewType] ?? 'table'} label={t("레이아웃")} value={viewTypeLabels[live.viewType]} onClick={() => onPage('layout')} />
            <Row icon="eye" label={t("속성 표시 여부")} value={`${shownProperties(result).length}`} onClick={() => onPage('properties')} />
            <Row icon="filter" label={t("필터")} value={filterCount ? t("{0}개", [filterCount]) : undefined} onClick={() => onPage('filter')} />
            <Row icon="sort" label={t("정렬")} value={config.sorts?.length ? t("{0}개", [config.sorts.length]) : undefined} onClick={() => onPage('sort')} />
            {['table', 'board', 'list', 'gallery'].includes(live.viewType) ? <Row icon="group" label={t("그룹")} value={config.groupBy ? schema.find(property => property.id === config.groupBy)?.name : undefined} disabled={locked} onClick={() => onPage('group')} /> : null}
            {['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(live.viewType) ? <Row icon="brush" label={t("조건부 색상")} value={config.conditionalColors?.length ? t("{0}개", [config.conditionalColors.length]) : undefined} disabled={locked} onClick={() => onPage('colors')} /> : null}
            <button type="button" className="settings-row" onClick={() => navigator.clipboard.writeText(new URL(hrefFor(live.id), location.href).href).then(() => setStatus(t("보기 링크를 복사했습니다."))).catch(report)}><Icon name="link" size={20} /><span className="settings-row-label">{t("보기 링크 복사")}</span></button>
          </div>
        )}
        {saveMenu ? <Menu anchor={saveMenu} placement="below-end" width={220} onClose={() => setSaveMenu(null)} entries={[
          { label: t("PNG로 복사"), icon: 'copy', onSelect: () => copyChart(chartSvg(), chartBackground).then(() => setStatus(t("차트를 복사했습니다."))).catch(report) },
          ...(['png', 'svg'] as const).map(format => ({ label: format === 'png' ? t("PNG 다운로드") : t("SVG 다운로드"), icon: 'download', onSelect: () => saveChart(chartSvg(), live.name, format, chartBackground).catch(report) }) as MenuEntry),
          { kind: 'separator' },
          { label: t("배경"), icon: 'palette', hint: chartBackground === 'none' ? t("없음") : chartBackground === 'dark' ? t("어둡게") : t("흰색"), submenuWidth: 160, submenu: () => (['white', 'dark', 'none'] as const).map(mode => ({ label: mode === 'none' ? t("없음") : mode === 'dark' ? t("어둡게") : t("흰색"), checked: chartBackground === mode, onSelect: () => setChartBackground(mode) }) as MenuEntry) },
        ]} /> : null}
        {/* 데이터 소스 설정: 소스 · 속성 편집 · 자동화 · 변환 ∨ · 기타 설정 ∨, then 데이터 소스 관리. */}
        <div className="settings-section">
          <div className="settings-subhead"><span>{t("데이터 소스 설정")}</span></div>
          <Row icon="swap" label={t("소스")} value={source?.name} disabled={locked} onClick={() => onPage('sources')} />
          <Row icon="property-edit" label={t("속성 편집")} disabled={locked} onClick={() => onPage('source')} />
          <Row icon="lightning" label={t("자동화")} onClick={() => onPage('automations')} />
          <button type="button" className={`settings-row${open?.kind === 'convert' ? ' open' : ''}${locked ? ' disabled' : ''}`} disabled={locked} onClick={event => setOpen(open?.kind === 'convert' ? null : { kind: 'convert', anchor: event.currentTarget })}><Icon name="repeat" size={20} /><span className="settings-row-label">{t("변환")}</span>{locked ? null : <Icon name={open?.kind === 'convert' ? 'chevron-down' : 'chevron-right'} size={14} className="settings-row-chevron" />}</button>
          <button type="button" className={`settings-row${open?.kind === 'more' ? ' open' : ''}${locked ? ' disabled' : ''}`} disabled={locked} onClick={event => setOpen(open?.kind === 'more' ? null : { kind: 'more', anchor: event.currentTarget })}><Icon name="more" size={20} /><span className="settings-row-label">{t("기타 설정")}</span>{locked ? null : <Icon name={open?.kind === 'more' ? 'chevron-down' : 'chevron-right'} size={14} className="settings-row-chevron" />}</button>
          {/* Both open a menu under the row (변환 › 작업 데이터베이스로 변환; 기타 설정 › 하위 항목 · 종속성 ·
              (연결 — integrations, not part of this app) · 페이지 레이아웃 사용자 지정). */}
          {open ? <Menu anchor={open.anchor} placement="below-end" offset={2} width={250} onClose={() => setOpen(null)} entries={open.kind === 'convert'
            ? [{ label: t("작업 데이터베이스로 변환"), icon: 'tasks', onSelect: () => { convertToTaskDatabase(sourceId).then(() => openWorkspaceDialog('task-settings', { sourceId })).catch(report); } },
               { label: source?.tasks?.sprints?.enabled ? t("스프린트 설정") : t("스프린트 사용"), icon: 'repeat', onSelect: () => openWorkspaceDialog('sprint-settings', { sourceId }) }]
            : [{ label: t("하위 항목"), icon: 'tasks', right: <Icon name="chevron-right" size={14} />, onSelect: () => openWorkspaceDialog('task-settings', { sourceId }) },
               { label: t("종속성"), icon: 'dependency', right: <Icon name="chevron-right" size={14} />, onSelect: () => openWorkspaceDialog('task-settings', { sourceId }) },
               { label: t("스프린트"), icon: 'repeat', right: <Icon name="chevron-right" size={14} />, onSelect: () => openWorkspaceDialog('sprint-settings', { sourceId }) },
               { label: t("페이지 레이아웃 사용자 지정"), icon: 'page-layout', right: <Icon name="chevron-right" size={14} />, onSelect: () => { onClose(); openPageLayoutEditor(sourceId); } }]} /> : null}
        </div>
        <div className="settings-section">
          <Row icon="database" label={t("데이터 소스 관리")} onClick={() => onPage('sources')} />
          <Row icon={locked ? 'unlock' : 'lock'} label={locked ? t("데이터베이스 잠금 해제") : t("데이터베이스 잠금")} chevron={false} onClick={() => setDatabaseLock(sourceId, !locked)} />
        </div>
      </>
    );
  }
  if (page === 'sort') {
    const sorts = config.sorts ?? [];
    body = (
      <>
        {header(t("정렬"))}
        <div className="settings-list">
          {sorts.map((sort, index) => (
            <div key={`${sort.propertyId}-${index}`} className="sort-row">
              <select className="text-input" value={sort.propertyId} onChange={event => updateView(live, { sorts: sorts.map((item, i) => i === index ? { ...item, propertyId: event.target.value } : item) })}>{schema.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select>
              <select className="text-input" value={sort.direction} onChange={event => updateView(live, { sorts: sorts.map((item, i) => i === index ? { ...item, direction: event.target.value as 'asc' | 'desc' } : item) })}><option value="asc">{t("오름차순")}</option><option value="desc">{t("내림차순")}</option></select>
              <button type="button" className="icon-button small" aria-label={t("정렬 삭제")} onClick={() => updateView(live, { sorts: sorts.filter((_, i) => i !== index) })}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button type="button" className="settings-row add" onClick={() => { const next = schema.find(property => !sorts.some(sort => sort.propertyId === property.id)); if (next) updateView(live, { sorts: [...sorts, { propertyId: next.id, direction: 'asc' }] }); }}><Icon name="plus" size={16} /><span className="settings-row-label">{t("정렬 추가")}</span></button>
        </div>
      </>
    );
  }
  return <aside ref={panelRef} className={`view-settings${inline ? ' inline' : ''}`} aria-label={t("보기 설정")}>{body}</aside>;
}

// ---------- group settings (그룹화 / 상태 그룹·옵션 / 정렬 / 빈 그룹 숨기기 /
// 열 배경색, then the groups with drag handles and eye toggles) ----------

const groupableTypes = ['select', 'status', 'multi_select', 'checkbox', 'person', 'relation', 'text', 'number', 'date', 'url', 'email', 'phone', 'created_by', 'last_edited_by', 'created_time', 'last_edited_time', 'formula'];
const sortLabels = { manual: t("수동"), asc: t("오름차순"), desc: t("내림차순") } as const;

function GroupSettings({ view, result }: { view: ViewEntity; result: QueryResult }) {
  const config = view.config;
  const schema = result.properties;
  const property = schema.find(item => item.id === (config.groupBy ?? result.presentation.groupPropertyId));
  const [menu, setMenu] = useState<{ kind: 'property' | 'status' | 'sort'; anchor: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ key: string; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = property ? displayGroups(result, { ...config, hideEmptyGroups: false }, property) : [];
  const hidden = new Set(config.hiddenGroups ?? []);
  const allHidden = groups.length > 0 && groups.every(group => hidden.has(group.key));
  const sort = config.groupSort ?? (config.groupOrder?.length ? 'manual' : 'asc');
  const toggle = (key: string) => updateView(view, { hiddenGroups: hidden.has(key) ? [...hidden].filter(item => item !== key) : [...hidden, key] });

  const startDrag = (event: React.PointerEvent, key: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.settings-group-row') ?? [])];
    let over = groups.findIndex(group => group.key === key);
    setDrag({ key, over });
    const move = (moveEvent: PointerEvent) => {
      const index = rows.findIndex(row => moveEvent.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
      over = index < 0 ? rows.length : index;
      setDrag({ key, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const keys = groups.map(group => group.key);
      const from = keys.indexOf(key);
      const to = over > from ? over - 1 : over;
      if (from < 0 || to === from) return;
      keys.splice(from, 1);
      keys.splice(to, 0, key);
      updateView(view, { groupSort: 'manual', groupOrder: keys });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const menuEntries = (): MenuEntry[] => {
    if (menu?.kind === 'status') return (['group', 'option'] as const).map(mode => ({ label: mode === 'group' ? t("그룹") : t("옵션"), checked: (config.statusGrouping ?? 'group') === mode, onSelect: () => updateView(view, { statusGrouping: mode, hiddenGroups: [], groupOrder: [] }) }));
    if (menu?.kind === 'sort') return (['manual', 'asc', 'desc'] as const).map(mode => ({ label: sortLabels[mode], checked: sort === mode, onSelect: () => updateView(view, { groupSort: mode, ...(mode === 'manual' && !config.groupOrder?.length ? { groupOrder: groups.map(group => group.key) } : {}) }) }));
    return [
      ...schema.filter(item => groupableTypes.includes(item.type)).map(item => ({ label: item.name, icon: `type-${item.type}`, keywords: item.name, checked: item.id === property?.id, onSelect: () => updateView(view, { groupBy: item.id, groupOrder: [], hiddenGroups: [], groupSort: 'asc', statusGrouping: 'group' }) } as MenuEntry)),
      ...(view.viewType !== 'board' && property ? [{ kind: 'separator' } as MenuEntry, { label: t("그룹 해제"), icon: 'close', onSelect: () => updateView(view, { groupBy: null, groupOrder: [], hiddenGroups: [] }) } as MenuEntry] : []),
    ];
  };

  return (
    <>
      <div className="settings-section">
        <ValueRow label={t("그룹화")} value={property?.name ?? t("없음")} open={menu?.kind === 'property'} onClick={anchor => setMenu({ kind: 'property', anchor })} />
        {property?.type === 'status' ? <ValueRow label={t("상태")} value={(config.statusGrouping ?? 'group') === 'group' ? t("그룹") : t("옵션")} open={menu?.kind === 'status'} onClick={anchor => setMenu({ kind: 'status', anchor })} /> : null}
        {property ? <ValueRow label={t("정렬")} value={sortLabels[sort]} open={menu?.kind === 'sort'} onClick={anchor => setMenu({ kind: 'sort', anchor })} /> : null}
        {property ? <SwitchRow label={t("빈 그룹 숨기기")} checked={!!config.hideEmptyGroups} onChange={value => updateView(view, { hideEmptyGroups: value })} /> : null}
        {property && view.viewType === 'board' ? <SwitchRow label={t("열 배경색")} checked={config.columnBackground !== false} onChange={value => updateView(view, { columnBackground: value })} /> : null}
      </div>
      {property && groups.length ? (
        <div className="settings-section settings-groups" ref={listRef}>
          <div className="settings-group-head">
            <span>{t("그룹")}</span>
            <button type="button" className="settings-link" onClick={() => updateView(view, { hiddenGroups: allHidden ? [] : groups.map(group => group.key) })}>{allHidden ? t("모두 표시") : t("모두 숨기기")}</button>
          </div>
          {groups.map((group, index) => (
            <div key={group.key} className={`settings-group-row${drag?.key === group.key ? ' dragging' : ''}${drag && drag.over === index ? ' drop-before' : ''}${drag && index === groups.length - 1 && drag.over === groups.length ? ' drop-after' : ''}${hidden.has(group.key) ? ' is-hidden' : ''}`}>
              <span className="settings-group-handle" aria-label={t("그룹 순서 바꾸기")} onPointerDown={event => startDrag(event, group.key)}><Icon name="drag" size={16} /></span>
              <span className="settings-group-title"><GroupTitle property={property} group={group} /></span>
              <button type="button" className="icon-button tiny" aria-label={hidden.has(group.key) ? t("그룹 표시") : t("그룹 숨기기")} title={hidden.has(group.key) ? t("그룹 표시") : t("그룹 숨기기")} onClick={() => toggle(group.key)}><Icon name={hidden.has(group.key) ? 'eye-off' : 'eye'} size={16} /></button>
            </div>
          ))}
        </div>
      ) : null}
      {menu ? <Menu anchor={menu.anchor} placement="below-end" width={menu.kind === 'property' ? 260 : 240} search={menu.kind === 'property' ? t("속성 검색…") : false} entries={menuEntries()} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
