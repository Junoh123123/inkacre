import { t, tx } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apply, newId } from '../data/commands';
import { report, setStatus, showToast, useWorkspace } from '../data/store';
import type { LayoutSection, LayoutTab, PageEntity, PageLayout, PropertyEntity, PropertyType, SourceEntity, ViewEntity } from '../data/types';
import { Icon, viewIcon } from '../ui/Icon';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Popover } from '../ui/overlay';
import { Switch, confirmSmall, mountTransient } from '../ui/primitives';
import { ValueView } from './values';
import { propertyLabels } from '../data/format';
import { createDragGhost, pastThreshold, type DragGhost } from '../ui/drag';


// 페이지 레이아웃 사용자 지정 (view settings › 기타 설정): a full-window editor
// on rgb(249,248,247) — at the top the database's name over "미리 보기: <page> ⌄", "× 취소" and a blue
// "✓ 모든 페이지에 적용" with ⌄ (원래 페이지 레이아웃으로 재설정); on the left a white canvas (24 in, 60 down, r12
// 12 0 0, ringed) showing a page of the database as sections — 헤더, 속성 그룹, "+", 페이지 토론, 콘텐츠 — boxed (r8,
// ringed rgb(182,212,243), a 32-high rgba(35,131,226,.07) strip with the name 14/500 rgb(39,131,222) and ⠿ to drag);
// beside it the side panel ("≫", "+ 패널에 추가"); on the right "페이지 설정" (250 wide): 구조 (단순 · 탭) and 옵션 —
// 댓글(페이지 내) 항상 표시 | 최소화, 페이지 토론, 속성 아이콘, 좌우 여백 줄이기, 데이터베이스 템플릿.
// "+" between sections adds a property as its own section (or a new property); a group's window adds a section.
export const defaultLayout: Required<Pick<PageLayout, 'structure' | 'comments' | 'discussion' | 'propertyIcons' | 'narrow' | 'templates'>> = { structure: 'simple', comments: 'always', discussion: true, propertyIcons: true, narrow: false, templates: true };
export const defaultSections = (): LayoutSection[] => [{ type: 'group', id: 'main' }, { type: 'discussion', id: 'discussion' }];
const layoutKey = (layout: PageLayout) => JSON.stringify({ ...defaultLayout, hidden: [], panel: [], sections: defaultSections(), ...layout });

type BacklinkMode = 'always' | 'expanded' | 'popover' | 'hover' | 'off';
const backlinkLabel = (mode: BacklinkMode) => mode === 'always' ? t("항상 표시") : mode === 'expanded' ? t("펼쳐서 표시") : mode === 'popover' ? t("팝오버로 표시") : mode === 'hover' ? t("마우스를 올릴 때") : t("끄기");

export function openPageLayoutEditor(sourceId: string) {
  mountTransient(close => <PageLayoutEditor sourceId={sourceId} onClose={close} />);
}

export type PlannedSection =
  | { type: 'group'; id: string; name?: string; main: boolean; properties: PropertyEntity[] }
  | { type: 'property'; id: string; property: PropertyEntity }
  | { type: 'discussion'; id: string };

// Where the layout puts each property: groups (the main one takes every property placed nowhere else, in the
// stored order), single-property sections, the side panel; hidden ones nowhere. The title is the header's.
export function layoutPlan(schema: PropertyEntity[], layout: PageLayout | undefined) {
  const rest = schema.filter(property => property.type !== 'title');
  const byId = new Map(rest.map(property => [property.id, property]));
  const hidden = new Set(layout?.hidden ?? []);
  let sections = layout?.sections?.length ? layout.sections : defaultSections();
  if (!sections.some(section => section.type === 'group' && !section.properties)) sections = [{ type: 'group', id: 'main' }, ...sections];
  const panelIds = (layout?.panel ?? []).filter(id => byId.has(id));
  const pinnedIds = (layout?.pinned ?? []).filter(id => byId.has(id));
  const taken = new Set([...panelIds, ...pinnedIds, ...sections.flatMap(section => section.type === 'property' ? [section.propertyId] : section.type === 'group' && section.properties ? section.properties : [])]);
  const order = layout?.order ?? [];
  const rank = (property: PropertyEntity) => order.includes(property.id) ? order.indexOf(property.id) : order.length + rest.indexOf(property);
  const mainId = sections.find(section => section.type === 'group' && !section.properties)!.id;
  const planned: PlannedSection[] = sections.flatMap((section): PlannedSection[] => {
    if (section.type === 'group') {
      const list = section.properties ? section.properties.map(id => byId.get(id)).filter((property): property is PropertyEntity => !!property) : rest.filter(property => !taken.has(property.id)).sort((a, b) => rank(a) - rank(b));
      return [{ type: 'group', id: section.id, name: section.name, main: section.id === mainId, properties: list.filter(property => !hidden.has(property.id)) }];
    }
    if (section.type === 'property') { const property = byId.get(section.propertyId); return property && !hidden.has(property.id) ? [{ type: 'property', id: section.id, property }] : []; }
    return [section];
  });
  return { sections: planned, panel: panelIds.map(id => byId.get(id)!).filter(property => !hidden.has(property.id)), pinned: pinnedIds.map(id => byId.get(id)!).filter(property => !hidden.has(property.id)), hidden: rest.filter(property => hidden.has(property.id)) };
}
/** The main group and the panel (what most callers want). */
export function layoutProperties(schema: PropertyEntity[], layout: PageLayout | undefined) {
  const plan = layoutPlan(schema, layout);
  const main = plan.sections.find(section => section.type === 'group' && section.main) as Extract<PlannedSection, { type: 'group' }> | undefined;
  return { group: main?.properties ?? [], panel: plan.panel, hidden: plan.hidden };
}

const newPropertyTypes: Array<{ type: PropertyType; label: string }> = [
  { type: 'text', label: t("텍스트") }, { type: 'number', label: t("숫자") }, { type: 'select', label: t("선택") }, { type: 'multi_select', label: t("다중 선택") },
  { type: 'status', label: t("상태") }, { type: 'date', label: t("날짜") }, { type: 'person', label: t("사람") }, { type: 'files', label: t("파일과 미디어") },
  { type: 'checkbox', label: t("체크박스") }, { type: 'url', label: 'URL' }, { type: 'email', label: t("이메일") }, { type: 'phone', label: t("전화번호") },
];

function PageLayoutEditor({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const source = ws.get<SourceEntity>(sourceId);
  const schema = ws.schema(sourceId);
  const pages = useMemo(() => ws.children(sourceId).filter(item => item.kind === 'page' && !(item as PageEntity).template && ws.visible(item.id)) as PageEntity[], [ws.version, sourceId]);
  // Relations can't sit in the side panel (older layouts may still have one there).
  const initial = useMemo<PageLayout>(() => {
    const stored = source?.pageLayout ?? {};
    const relations = new Set(schema.filter(property => property.type === 'relation').map(property => property.id));
    return stored.panel?.some(id => relations.has(id)) ? { ...stored, panel: stored.panel.filter(id => !relations.has(id)) } : stored;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draft, setDraft] = useState<PageLayout>(initial);
  const [previewId, setPreviewId] = useState<string | null>(pages[0]?.id ?? null);
  const [menu, setMenu] = useState<{ kind: 'preview' | 'apply' | 'comments' | 'panel' | 'page' | 'section' | 'pin' | 'backlinks' | 'tab-add' | 'tab'; anchor: Element; index?: number; sectionId?: string; tabId?: string } | null>(null);
  const [propertyDrag, setPropertyDrag] = useState<{ id: string; over: string | null } | null>(null);
  const [groupFor, setGroupFor] = useState<{ anchor: Element; id: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const preview = pages.find(item => item.id === previewId) ?? null;
  const layout = { ...defaultLayout, ...draft };
  const plan = layoutPlan(schema, draft);
  const dirty = layoutKey(draft) !== layoutKey(initial);
  const set = (patch: Partial<PageLayout>) => setDraft(current => ({ ...current, ...patch }));
  const sections = (): LayoutSection[] => draft.sections?.length ? draft.sections : defaultSections();
  const cancel = async () => { if (!dirty || await confirmSmall(t("모든 레이아웃 변경 사항을 삭제할까요?"), t("삭제"))) onClose(); };
  const save = () => apply([{ type: 'source.update', id: sourceId, pageLayout: layoutKey(draft) === layoutKey({}) ? null : draft }]).then(() => { setStatus(t("페이지 레이아웃을 모든 페이지에 적용했습니다.")); onClose(); }).catch(report);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.overlay-layer .menu-panel, .overlay-layer .layout-group-pop')) { event.preventDefault(); cancel().catch(report); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Placing a property somewhere takes it out of everywhere else first.
  const unplace = (layoutValue: PageLayout, propertyId: string): PageLayout => ({
    ...layoutValue,
    panel: (layoutValue.panel ?? []).filter(id => id !== propertyId),
    pinned: (layoutValue.pinned ?? []).filter(id => id !== propertyId),
    hidden: (layoutValue.hidden ?? []).filter(id => id !== propertyId),
    sections: (layoutValue.sections?.length ? layoutValue.sections : defaultSections())
      .filter(section => !(section.type === 'property' && section.propertyId === propertyId))
      .map(section => section.type === 'group' && section.properties ? { ...section, properties: section.properties.filter(id => id !== propertyId) } : section),
  });
  const isRelation = (id: string) => schema.find(property => property.id === id)?.type === 'relation';
  const toPanel = (all: string[]) => {
    const ids = all.filter(id => !isRelation(id));
    if (ids.length < all.length) showToast(t("관계형 속성은 패널에 넣을 수 없습니다."));
    if (ids.length) setDraft(current => { let next = current; for (const id of ids) next = unplace(next, id); return { ...next, panel: [...(next.panel ?? []), ...ids] }; });
  };
  // Pinned in the heading, under the page's name (up to 15).
  const toPin = (id: string) => {
    if ((draft.pinned ?? []).filter(item => item !== id).length >= 15) { showToast(t("속성은 15개까지 고정할 수 있습니다.")); return; }
    setDraft(current => { const next = unplace(current, id); return { ...next, pinned: [...(next.pinned ?? []), id] }; });
  };
  const moveSection = (id: string, delta: number) => setDraft(current => {
    const list = [...(current.sections?.length ? current.sections : defaultSections())];
    const from = list.findIndex(section => section.id === id), to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return current;
    const [item] = list.splice(from, 1); list.splice(to, 0, item);
    return { ...current, sections: list };
  });
  // Tabs (탭 구조): another database's view, narrowed by its relation to this database when it has one.
  const otherViews = useMemo(() => ws.snapshot.objects.filter(item => item.kind === 'view' && (item as ViewEntity).sourceId !== sourceId && ws.visible(item.id)) as ViewEntity[], [ws.version, sourceId]);
  const addTab = (view: ViewEntity) => {
    const relation = ws.schema(view.sourceId).find(property => property.type === 'relation' && (property as PropertyEntity & { targetSourceId?: string }).targetSourceId === sourceId);
    const name = ws.get<SourceEntity>(view.sourceId)?.name || view.name;
    setDraft(current => ({ ...current, structure: 'tabs', tabs: [...(current.tabs ?? []), { id: newId(), name, viewId: view.id, ...(relation ? { relationPropertyId: relation.id } : {}) }] }));
  };
  const renameTab = (id: string, name: string) => setDraft(current => ({ ...current, tabs: (current.tabs ?? []).map(tab => tab.id === id ? { ...tab, name } : tab) }));
  const removeTab = (id: string) => setDraft(current => ({ ...current, tabs: (current.tabs ?? []).filter(tab => tab.id !== id) }));
  const renameProperty = (id: string, name: string) => { const property = schema.find(item => item.id === id); if (property && name && name !== property.name) apply([{ type: 'property.update', id, name }]).catch(report); };

  // Dragging a property (a row of a group or the panel, or a pinned one) to another group, the panel or the heading.
  const startPropertyDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const startX = event.clientX, startY = event.clientY;
    let ghost: DragGhost | null = null, over: string | null = null;
    const zoneAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]')?.dataset.drop ?? null;
    const move = (moveEvent: PointerEvent) => {
      if (!ghost && !pastThreshold(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
      if (!ghost) ghost = createDragGhost([element], startX, startY);
      ghost.move(moveEvent.clientX, moveEvent.clientY);
      over = zoneAt(moveEvent.clientX, moveEvent.clientY);
      setPropertyDrag({ id, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const dragged = !!ghost;
      ghost?.remove(); setPropertyDrag(null);
      if (!dragged) return;
      // The click that ends a drag must not open the group's window.
      const swallow = (clickEvent: MouseEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      if (!over) return;
      if (over === 'panel') toPanel([id]);
      else if (over === 'pinned') toPin(id);
      else if (over.startsWith('group:')) {
        const groupId = over.slice(6);
        const main = plan.sections.find(section => section.type === 'group' && section.main);
        if (main?.id === groupId) toMain(id); else toGroup(groupId, id);
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const dropClass = (zone: string) => propertyDrag?.over === zone ? ' drop-over' : '';
  const toMain = (id: string) => setDraft(current => unplace(current, id));
  const toModule = (index: number, id: string) => setDraft(current => { const next = unplace(current, id); const list = [...(next.sections ?? defaultSections())]; list.splice(index, 0, { type: 'property', id: newId(), propertyId: id }); return { ...next, sections: list }; });
  const toGroup = (groupId: string, id: string) => setDraft(current => { const next = unplace(current, id); return { ...next, sections: (next.sections ?? defaultSections()).map(section => section.type === 'group' && section.id === groupId ? (section.properties ? { ...section, properties: [...section.properties, id] } : section) : section) }; });
  const addGroupAfter = (id: string) => setDraft(current => {
    const list = [...(current.sections?.length ? current.sections : defaultSections())];
    const index = list.findIndex(section => section.id === id);
    const count = list.filter(section => section.type === 'group').length + 1;
    list.splice(index + 1, 0, { type: 'group', id: newId(), name: t("속성 그룹 {0}", [count]), properties: [] });
    return { ...current, sections: list };
  });
  const removeSection = (id: string) => setDraft(current => ({ ...current, sections: (current.sections ?? defaultSections()).filter(section => section.id !== id) }));
  const renameGroup = (id: string, name: string) => setDraft(current => ({ ...current, sections: (current.sections ?? defaultSections()).map(section => section.type === 'group' && section.id === id ? { ...section, name } : section) }));
  const createProperty = (type: PropertyType, place: (id: string) => void) => {
    const id = newId(), label = newPropertyTypes.find(item => item.type === type)?.label ?? propertyLabels[type];
    let name = label, n = 2; while (schema.some(property => property.name === name)) name = `${label} ${n++}`;
    apply([{ type: 'property.create', id, sourceId, name, propertyType: type, ...(type === 'status' ? { options: [{ id: newId(), name: t("시작 전"), group: 'todo', color: 'gray' }, { id: newId(), name: t("진행 중"), group: 'in_progress', color: 'blue' }, { id: newId(), name: t("완료"), group: 'complete', color: 'green' }] } : {}) }]).then(() => place(id)).catch(report);
  };

  // Dragging a section by its ⠿ (the header and the content stay put).
  const startDrag = (event: React.PointerEvent, id: string) => {
    event.preventDefault();
    const list = sections(); const from = list.findIndex(section => section.id === id);
    const target = (y: number) => {
      const boxes = [...(mainRef.current?.querySelectorAll<HTMLElement>('[data-section-id]') ?? [])].map(element => element.getBoundingClientRect());
      let index = boxes.findIndex(box => y < box.top + box.height / 2);
      if (index < 0) index = boxes.length;
      return index;
    };
    setDrag({ id, over: from });
    const move = (e: PointerEvent) => setDrag({ id, over: target(e.clientY) });
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const to = target(e.clientY); setDrag(null);
      if (to === from || to === from + 1) return;
      setDraft(current => { const next = [...(current.sections?.length ? current.sections : defaultSections())]; const [item] = next.splice(from, 1); next.splice(to > from ? to - 1 : to, 0, item); return { ...current, sections: next }; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const pickable = (where: 'panel' | 'page' | 'pin'): MenuEntry[] => {
    const inPanel = new Set(draft.panel ?? []), pinned = new Set(draft.pinned ?? []);
    const modules = new Set(sections().flatMap(section => section.type === 'property' ? [section.propertyId] : []));
    const candidates = schema.filter(property => property.type !== 'title' && (where === 'panel' ? !inPanel.has(property.id) && property.type !== 'relation' : where === 'pin' ? !pinned.has(property.id) : !modules.has(property.id)));
    const place = (id: string) => where === 'panel' ? toPanel([id]) : where === 'pin' ? toPin(id) : toModule(menu?.index ?? sections().length, id);
    return [
      { kind: 'section', label: t("기존 속성 사용") },
      ...(candidates.length ? candidates.map(property => ({ label: property.name, hint: propertyLabels[property.type], icon: `type-${property.type}`, keywords: property.name, onSelect: () => place(property.id) }) as MenuEntry) : [{ label: t("쓸 수 있는 속성이 없습니다"), disabled: true } as MenuEntry]),
      { kind: 'separator' },
      { kind: 'section', label: t("새 속성 만들기") },
      ...newPropertyTypes.map(item => ({ label: item.label, icon: `type-${item.type}`, keywords: item.label, onSelect: () => createProperty(item.type, place) }) as MenuEntry),
    ];
  };
  const valueOf = (property: PropertyEntity) => preview && preview.values?.[property.id] != null && preview.values[property.id] !== '' ? <ValueView property={property} value={preview.values[property.id]} mode="card" /> : <span className="layout-empty">{t("비어 있음")}</span>;
  const row = (property: PropertyEntity, removable?: boolean) => (
    <div key={property.id} className={`layout-property${propertyDrag?.id === property.id ? ' dragging' : ''}`} onPointerDown={event => startPropertyDrag(event, property.id)}>
      <span className="layout-property-name">{layout.propertyIcons ? <Icon name={`type-${property.type}`} size={16} /> : null}<span>{property.name}</span></span>
      <span className="layout-property-value">{valueOf(property)}</span>
      {removable ? <button type="button" className="layout-remove" aria-label={t("{0} 패널에서 빼기", [property.name])} title={t("패널에서 빼기")} onClick={() => toMain(property.id)}><Icon name="close" size={12} /></button> : null}
    </div>
  );
  const head = (section: PlannedSection, label: string) => (
    <div className="layout-section-head">
      <span className="layout-drag" role="button" aria-label={t("끌어서 옮기기")} title={t("끌어서 옮기기")} onPointerDown={event => startDrag(event, section.id)}><Icon name="drag" size={12} /></span>
      <span className="layout-section-label">{label}</span>
      {section.type !== 'discussion' ? <button type="button" className="layout-section-more" aria-label={t("섹션 옵션")} onClick={event => { event.stopPropagation(); setMenu({ kind: 'section', anchor: event.currentTarget, sectionId: section.id }); }}><Icon name="more" size={14} /></button> : null}
    </div>
  );
  // A section's ⋯: 위로 · 아래로 이동, 패널로 이동, and taking it off the layout (a property goes back to the main
  // group; an added group's properties do too). The main group can move but not go.
  const sectionEntries = (id: string): MenuEntry[] => {
    const list = sections(), index = list.findIndex(section => section.id === id), section = list[index];
    if (!section) return [];
    const planned = plan.sections.find(item => item.id === id);
    const main = planned?.type === 'group' && planned.main;
    const entries: MenuEntry[] = [];
    if (section.type === 'group' && !main) entries.push({ kind: 'custom', render: (close: () => void) => <input className="layout-rename" autoFocus aria-label={t("그룹 이름")} defaultValue={section.name ?? ''} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { renameGroup(id, (event.target as HTMLInputElement).value.trim() || t("속성 그룹")); close(); } }} onBlur={event => renameGroup(id, event.target.value.trim() || t("속성 그룹"))} /> } as MenuEntry, { kind: 'separator' });
    entries.push(
      { label: t("위로 이동"), icon: 'arrow-up', disabled: index <= 0, onSelect: () => moveSection(id, -1) },
      { label: t("아래로 이동"), icon: 'arrow-down', disabled: index >= list.length - 1, onSelect: () => moveSection(id, 1) },
      { label: t("패널로 이동"), icon: 'arrow-right', onSelect: () => toPanel(section.type === 'property' ? [section.propertyId] : planned?.type === 'group' ? planned.properties.map(property => property.id) : []) },
    );
    if (!main) entries.push({ kind: 'separator' }, section.type === 'property'
      ? { label: t("레이아웃에서 제거"), icon: 'close', onSelect: () => toMain(section.propertyId) }
      : { label: t("섹션 삭제"), icon: 'trash', onSelect: () => removeSection(id) });
    return entries;
  };
  const visibleSections = plan.sections.filter(section => section.type !== 'discussion' || layout.discussion);
  const order = sections();
  const addButton = (index: number) => <button type="button" key={`add-${index}`} className="layout-add" aria-label={t("페이지에 추가")} title={t("페이지에 추가")} onClick={event => setMenu({ kind: 'page', anchor: event.currentTarget, index })}><Icon name="plus" size={14} /></button>;
  return (
    <div className="layout-editor" role="dialog" aria-label={t("페이지 레이아웃 사용자 지정")}>
      <div className="layout-top">
        <div className="layout-title">
          <div className="layout-db"><Icon name="database" size={16} /><span>{source?.name}</span></div>
          <button type="button" className="layout-preview-pick" onClick={event => setMenu({ kind: 'preview', anchor: event.currentTarget })}>{t("미리 보기: {0}", [preview ? preview.title || t("새 페이지") : t("페이지 없음")])}<Icon name="chevron-down" size={10} /></button>
        </div>
        <div className="layout-actions">
          <button type="button" className="layout-cancel" onClick={() => { cancel().catch(report); }}><Icon name="close" size={12} /><span>{t("취소")}</span></button>
          <span className="layout-apply"><button type="button" className="layout-apply-main" onClick={save}><Icon name="check" size={14} /><span>{t("모든 페이지에 적용")}</span></button><button type="button" className="layout-apply-more" aria-label={t("레이아웃 옵션")} onClick={event => setMenu({ kind: 'apply', anchor: event.currentTarget })}><Icon name="chevron-down" size={12} /></button></span>
        </div>
      </div>
      <div className="layout-canvas">
        <div ref={mainRef} className={`layout-main${layout.narrow ? ' narrow' : ''}`}>
          <section className={`layout-section fixed${dropClass('pinned')}`} data-drop="pinned">
            <div className="layout-section-head"><span className="layout-section-label">{t("헤더")}</span>
              <button type="button" className="layout-head-option" onClick={event => setMenu({ kind: 'backlinks', anchor: event.currentTarget })}>{t("백링크")}: {backlinkLabel(draft.backlinks ?? 'always')}<Icon name="chevron-down" size={10} /></button></div>
            <div className="layout-header">
              {(draft.backlinks ?? 'always') !== 'off' ? <div className={`layout-backlinks${draft.backlinks === 'hover' ? ' on-hover' : ''}`}><Icon name="arrow-up-right" size={12} />{t("백링크 없음")}</div> : null}
              <div className="layout-page-title">{preview?.title || t("새 페이지")}</div>
              <div className="layout-pinned">
                {plan.pinned.map(property => (
                  <span key={property.id} className={`layout-pin${propertyDrag?.id === property.id ? ' dragging' : ''}`} onPointerDown={event => startPropertyDrag(event, property.id)} title={property.name}>
                    {layout.propertyIcons ? <Icon name={`type-${property.type}`} size={14} /> : null}<span className="layout-pin-value">{valueOf(property)}</span>
                    <button type="button" className="layout-pin-remove" aria-label={t("{0} 고정 해제", [property.name])} onPointerDown={event => event.stopPropagation()} onClick={() => toMain(property.id)}><Icon name="close" size={10} /></button>
                  </span>
                ))}
                <button type="button" className="layout-pin-add" onClick={event => setMenu({ kind: 'pin', anchor: event.currentTarget })}><Icon name="pin" size={12} />{t("속성 고정")}</button>
              </div>
            </div>
          </section>
          {layout.structure === 'tabs' ? (
            <div className="layout-tabs">
              <span className="layout-tab"><Icon name="page" size={14} />{t("콘텐츠")}</span>
              {(draft.tabs ?? []).map(tab => {
                const view = ws.get<ViewEntity>(tab.viewId);
                return <button type="button" key={tab.id} className="layout-tab" onClick={event => setMenu({ kind: 'tab', anchor: event.currentTarget, tabId: tab.id })}><Icon name={viewIcon[view?.viewType ?? 'table'] ?? 'table'} size={14} />{tab.name}</button>;
              })}
              <button type="button" className="layout-tab-add" aria-label={t("탭 추가")} title={t("탭 추가")} onClick={event => setMenu({ kind: 'tab-add', anchor: event.currentTarget })}><Icon name="plus" size={14} /></button>
            </div>
          ) : null}
          {visibleSections.map(section => {
            const index = order.findIndex(item => item.id === section.id);
            const indicator = drag && drag.id !== section.id && drag.over === visibleSections.indexOf(section) ? <div className="layout-drop-line" /> : null;
            let body;
            if (section.type === 'group') {
              body = (
                <section data-section-id={section.id} data-drop={`group:${section.id}`} className={`layout-section clickable${drag?.id === section.id ? ' dragging' : ''}${dropClass(`group:${section.id}`)}`} onClick={event => { if (!(event.target as Element).closest('button, [role="button"]')) setGroupFor({ anchor: event.currentTarget, id: section.id }); }}>
                  {head(section, section.main ? t("속성 그룹") : section.name || t("속성 그룹"))}
                  <div className="layout-properties">{section.properties.length ? section.properties.map(property => row(property)) : <div className="layout-empty pad">{section.main ? t("표시할 속성이 없습니다") : t("이 그룹에 넣을 속성을 고르세요")}</div>}</div>
                </section>
              );
            } else if (section.type === 'property') {
              body = (
                <section data-section-id={section.id} className={`layout-section${drag?.id === section.id ? ' dragging' : ''}`}>
                  {head(section, section.property.name)}
                  <div className="layout-module"><span className="layout-module-name">{layout.propertyIcons ? <Icon name={`type-${section.property.type}`} size={16} /> : null}{section.property.name}</span><div className="layout-module-value">{valueOf(section.property)}</div></div>
                </section>
              );
            } else {
              body = (
                <section data-section-id={section.id} className={`layout-section${drag?.id === section.id ? ' dragging' : ''}`}>
                  {head(section, t("페이지 토론"))}
                  <div className="layout-discussion"><div className="layout-discussion-title">{t("댓글")}</div><div className="layout-discussion-add">{tx("{0}댓글 추가…", [<span className="avatar tiny">{t("avatar|나")}</span>])}</div></div>
                </section>
              );
            }
            return <div key={section.id}>{indicator}{body}{section.type !== 'discussion' ? addButton(index + 1) : null}</div>;
          })}
          {drag && drag.over >= visibleSections.length ? <div className="layout-drop-line" /> : null}
          <section className="layout-section fixed">
            <div className="layout-section-head"><span className="layout-section-label">{t("콘텐츠")}</span></div>
            <div className="layout-content">{t("미설정")}</div>
          </section>
        </div>
        <div className={`layout-panel${dropClass('panel')}`} data-drop="panel">
          <Icon name="double-chevron-right" size={16} className="layout-panel-collapse" />
          {plan.panel.length ? <section className="layout-section"><div className="layout-section-head"><span className="layout-section-label">{t("패널")}</span></div><div className="layout-properties">{plan.panel.map(property => row(property, true))}</div></section> : null}
          <button type="button" className="layout-panel-add" onClick={event => setMenu({ kind: 'panel', anchor: event.currentTarget })}><Icon name="plus" size={14} /><span>{t("패널에 추가")}</span></button>
        </div>
      </div>
      <aside className="layout-settings">
        <div className="layout-settings-title">{t("페이지 설정")}</div>
        <div className="layout-settings-label">{t("구조")}</div>
        <div className="layout-structures">
          {(['simple', 'tabs'] as const).map(structure => (
            <button type="button" key={structure} className={`layout-structure${layout.structure === structure ? ' active' : ''}`} onClick={() => set({ structure })}>
              <span className={`layout-structure-art ${structure}`}><span /><span /><span /></span>
              <span className="layout-structure-label">{structure === 'simple' ? t("단순") : t("탭")}</span>
            </button>
          ))}
        </div>
        <div className="layout-settings-label">{t("옵션")}</div>
        <button type="button" className="layout-option" onClick={event => setMenu({ kind: 'comments', anchor: event.currentTarget })}><span>{t("댓글(페이지 내)")}</span><span className="layout-option-value">{layout.comments === 'minimal' ? t("최소화") : t("항상 표시")}<Icon name="chevron-right" size={12} /></span></button>
        {([['discussion', t("페이지 토론"), ''], ['propertyIcons', t("속성 아이콘"), ''], ['narrow', t("좌우 여백 줄이기"), t("페이지 내용을 창 너비에 맞춰 넓게 씁니다.")], ['templates', t("데이터베이스 템플릿"), t("끄면 새 페이지에 기본 템플릿을 적용하지 않고 템플릿 고르기도 보이지 않습니다.")]] as const).map(([key, label, help]) => (
          <label key={key} className="layout-option">
            <span>{label}{help ? <span className="layout-help" title={help}><Icon name="info" size={12} /></span> : null}</span>
            <Switch checked={!!layout[key]} onChange={value => set({ [key]: value })} label={label} />
          </label>
        ))}
      </aside>
      {menu?.kind === 'preview' ? <Menu anchor={menu.anchor} placement="below-center" width={260} search={t("페이지 검색…")} onClose={() => setMenu(null)}
        entries={pages.length ? pages.slice(0, 200).map(item => ({ label: item.title || t("새 페이지"), icon: 'page', checked: item.id === previewId, keywords: item.title, onSelect: () => setPreviewId(item.id) }) as MenuEntry) : [{ label: t("페이지가 없습니다"), disabled: true }]} /> : null}
      {menu?.kind === 'apply' ? <Menu anchor={menu.anchor} placement="below-end" width={260} onClose={() => setMenu(null)}
        entries={[{ label: t("원래 페이지 레이아웃으로 재설정"), hint: t("속성은 삭제되지 않습니다"), icon: 'undo', onSelect: () => setDraft({}) }]} /> : null}
      {menu?.kind === 'comments' ? <Menu anchor={menu.anchor} placement="below-end" width={200} onClose={() => setMenu(null)}
        entries={(['always', 'minimal'] as const).map(mode => ({ label: mode === 'always' ? t("항상 표시") : t("최소화"), checked: layout.comments === mode, onSelect: () => set({ comments: mode }) }))} /> : null}
      {menu?.kind === 'panel' ? <Menu anchor={menu.anchor} placement="below-center" width={280} search={t("검색…")} onClose={() => setMenu(null)} label={t("패널에 추가")} entries={pickable('panel')} /> : null}
      {menu?.kind === 'page' ? <Menu anchor={menu.anchor} placement="right-start" width={280} search={t("검색…")} onClose={() => setMenu(null)} label={t("페이지에 추가")} entries={pickable('page')} /> : null}
      {menu?.kind === 'section' && menu.sectionId ? <Menu anchor={menu.anchor} placement="below-end" width={220} onClose={() => setMenu(null)} entries={sectionEntries(menu.sectionId)} /> : null}
      {menu?.kind === 'pin' ? <Menu anchor={menu.anchor} placement="below-start" width={280} search={t("검색…")} onClose={() => setMenu(null)} label={t("속성 고정")} entries={pickable('pin')} /> : null}
      {menu?.kind === 'backlinks' ? <Menu anchor={menu.anchor} placement="below-end" width={220} onClose={() => setMenu(null)}
        entries={(['always', 'expanded', 'popover', 'hover', 'off'] as const).map(mode => ({ label: backlinkLabel(mode), checked: (draft.backlinks ?? 'always') === mode, onSelect: () => set({ backlinks: mode }) }))} /> : null}
      {menu?.kind === 'tab-add' ? <Menu anchor={menu.anchor} placement="below-start" width={300} search={t("보기 검색…")} onClose={() => setMenu(null)} label={t("탭 추가")}
        entries={otherViews.length ? otherViews.map(view => {
          const related = ws.schema(view.sourceId).some(property => property.type === 'relation' && (property as PropertyEntity & { targetSourceId?: string }).targetSourceId === sourceId);
          const sourceName = ws.get<SourceEntity>(view.sourceId)?.name ?? '';
          return { label: `${sourceName} · ${view.name}`, icon: viewIcon[view.viewType] ?? 'table', hint: related ? t("관련 항목만") : undefined, keywords: `${sourceName} ${view.name}`, onSelect: () => addTab(view) } as MenuEntry;
        }) : [{ label: t("다른 데이터베이스의 보기가 없습니다"), disabled: true }]} /> : null}
      {menu?.kind === 'tab' && menu.tabId ? <Menu anchor={menu.anchor} placement="below-start" width={220} onClose={() => setMenu(null)} entries={[
        { kind: 'custom', render: (close: () => void) => <input className="layout-rename" autoFocus aria-label={t("탭 이름")} defaultValue={(draft.tabs ?? []).find(tab => tab.id === menu.tabId)?.name ?? ''} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { const value = (event.target as HTMLInputElement).value.trim(); if (value) renameTab(menu.tabId!, value); close(); } }} onBlur={event => { const value = event.target.value.trim(); if (value) renameTab(menu.tabId!, value); }} /> } as MenuEntry,
        { kind: 'separator' },
        { label: t("탭 삭제"), icon: 'trash', onSelect: () => removeTab(menu.tabId!) },
      ]} /> : null}
      {groupFor ? (() => {
        const section = plan.sections.find(item => item.id === groupFor.id && item.type === 'group') as Extract<PlannedSection, { type: 'group' }> | undefined;
        if (!section) return null;
        return <GroupPopover anchor={groupFor.anchor} schema={schema} layout={draft} section={section}
          onHide={(id, hide) => set({ hidden: hide ? [...(draft.hidden ?? []), id] : (draft.hidden ?? []).filter(item => item !== id) })}
          onRename={renameProperty}
          onAdd={id => toGroup(section.id, id)} onRemove={id => toMain(id)}
          onAddSection={() => { addGroupAfter(section.id); setGroupFor(null); }}
          onToPanel={() => { toPanel(section.properties.map(property => property.id)); setGroupFor(null); }} onClose={() => setGroupFor(null)} />;
      })() : null}
    </div>
  );
}

// Clicking a property group: "+ 섹션 추가", its properties with an eye each (shown / hidden), properties to bring
// in (other groups), and "패널로 이동".
function GroupPopover({ anchor, schema, layout, section, onHide, onRename, onAdd, onRemove, onAddSection, onToPanel, onClose }: {
  anchor: Element; schema: PropertyEntity[]; layout: PageLayout; section: Extract<PlannedSection, { type: 'group' }>;
  onHide: (id: string, hide: boolean) => void; onRename: (id: string, name: string) => void; onAdd: (id: string) => void; onRemove: (id: string) => void; onAddSection: () => void; onToPanel: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const hidden = new Set(layout.hidden ?? []);
  const plan = layoutPlan(schema, layout);
  const match = (property: PropertyEntity) => !query.trim() || property.name.toLowerCase().includes(query.trim().toLowerCase());
  const own = [...section.properties, ...(section.main ? plan.hidden : [])].filter(match);
  const elsewhere = section.main ? [] : plan.sections.flatMap(item => item.type === 'group' && item.id !== section.id ? item.properties : []).filter(match);
  const rect = anchor.getBoundingClientRect();
  return (
    <Popover anchor={{ x: rect.right + 8, y: rect.top }} placement="point" onClose={onClose} className="layout-group-pop" style={{ width: 290 }} label={t("속성 그룹")}>
      <div className="layout-group-head"><span>{section.main ? t("속성 그룹") : section.name || t("속성 그룹")}</span><button type="button" className="layout-group-add" onClick={onAddSection}><Icon name="plus" size={12} />{t("섹션 추가")}</button></div>
      <input className="layout-group-search" value={query} placeholder={t("속성 검색…")} aria-label={t("속성 검색")} autoFocus onChange={event => setQuery(event.target.value)} />
      <div className="layout-group-list">
        {own.map(property => (
          <div key={property.id} className={`layout-group-row${hidden.has(property.id) ? ' hidden' : ''}`}>
            <Icon name={`type-${property.type}`} size={16} />
            {renaming === property.id
              ? <input className="layout-property-rename" autoFocus defaultValue={property.name} aria-label={t("속성 이름")}
                  onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { onRename(property.id, (event.target as HTMLInputElement).value.trim()); setRenaming(null); } else if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); } }}
                  onBlur={event => { onRename(property.id, event.target.value.trim()); setRenaming(null); }} />
              : <span className="layout-property-label" title={t("두 번 눌러 이름 바꾸기")} onDoubleClick={() => setRenaming(property.id)}>{property.name}</span>}
            {!section.main ? <button type="button" className="layout-eye" aria-label={t("{0} 그룹에서 빼기", [property.name])} title={t("그룹에서 빼기")} onClick={() => onRemove(property.id)}><Icon name="close" size={12} /></button> : null}
            <button type="button" className="layout-eye" aria-label={hidden.has(property.id) ? t("{0} 표시", [property.name]) : t("{0} 숨기기", [property.name])} onClick={() => onHide(property.id, !hidden.has(property.id))}><Icon name={hidden.has(property.id) ? 'eye-off' : 'eye'} size={16} /></button>
          </div>
        ))}
        {elsewhere.length ? <div className="layout-group-sub">{t("다른 그룹의 속성")}</div> : null}
        {elsewhere.map(property => (
          <button type="button" key={property.id} className="layout-group-row add" onClick={() => onAdd(property.id)}><Icon name={`type-${property.type}`} size={16} /><span>{property.name}</span><Icon name="plus" size={14} /></button>
        ))}
      </div>
      {section.properties.length ? <button type="button" className="layout-group-move" onClick={onToPanel}><Icon name="arrow-right" size={16} /><span>{t("패널로 이동")}</span></button> : null}
    </Popover>
  );
}
