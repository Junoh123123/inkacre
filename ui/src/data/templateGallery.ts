import { t } from '../i18n';
import { newId } from './commands';
import { titleNameField } from './format';
import type { Operation, RichText } from './types';

// 템플릿 갤러리 (the sidebar's Templates): ready pages — some with a database, views and a few rows — made in
// one command under the chosen place. Built here (no online marketplace); every word goes through t().

export type TemplateCategory = 'personal' | 'work' | 'school' | 'product' | 'team' | 'creative';
export interface GalleryTemplate { id: string; category: TemplateCategory; name: string; description: string; icon: string; build: (b: TemplateBuilder) => void }
export const categoryLabels = (): Record<TemplateCategory, string> => ({ personal: t("개인"), work: t("업무"), school: t("학습"), product: t("기획 · 개발"), team: t("팀 운영"), creative: t("기록 · 창작") });

// "**굵게**", "`코드`" and "*기울임*" in template text.
export function md(text: string): RichText {
  const runs: RichText = [], pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > at) runs.push({ text: text.slice(at, match.index) });
    runs.push(match[1] ? { text: match[1], bold: true } : match[2] ? { text: match[2], code: true } : { text: match[3], italic: true });
    at = match.index! + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

type PropertySpec = { key: string; name: string; type: string; options?: Array<{ name: string; color?: string; group?: 'todo' | 'in_progress' | 'complete' }>; numberFormat?: Record<string, unknown> };
type ViewSpec = { name: string; type: string; groupBy?: string; date?: string; endDate?: string; visible?: string[]; sorts?: Array<{ key: string; direction: 'asc' | 'desc' }>; extra?: Record<string, unknown> };
type RowSpec = { title: string; icon?: string; values?: Record<string, unknown>; body?: string[] };
export interface DatabaseSpec { name: string; properties: PropertySpec[]; views: ViewSpec[]; rows?: RowSpec[]; page?: { title: string; icon: string } }

export class TemplateBuilder {
  operations: Operation[] = [];
  constructor(public rootId: string) {}
  private block(parentId: string, blockType: string, extra: Record<string, unknown> = {}) { const id = newId(); this.operations.push({ type: 'block.create', id, parentId, blockType, richText: [], ...extra } as Operation); return id; }
  heading(parent: string, level: 1 | 2 | 3, text: string) { return this.block(parent, `heading${level}`, { richText: md(text) }); }
  text(parent: string, text = '') { return this.block(parent, 'paragraph', { richText: md(text) }); }
  bullet(parent: string, text = '') { return this.block(parent, 'bullet', { richText: md(text) }); }
  numbered(parent: string, text = '') { return this.block(parent, 'numbered', { richText: md(text) }); }
  todo(parent: string, text = '', checked = false) { return this.block(parent, 'todo', { richText: md(text), checked }); }
  quote(parent: string, text: string) { return this.block(parent, 'quote', { richText: md(text) }); }
  divider(parent: string) { return this.block(parent, 'divider'); }
  callout(parent: string, icon: string, text: string, color = 'gray_background') { return this.block(parent, 'callout', { richText: md(text), icon, color }); }
  toggle(parent: string, text: string, inside: (id: string) => void) { const id = this.block(parent, 'toggle', { richText: md(text) }); inside(id); return id; }
  table(parent: string, rows: string[][]) { return this.block(parent, 'table', { cells: rows.map(row => row.map(cell => md(cell))), tableHeader: { row: true, column: false } }); }
  page(parent: string, title: string, icon: string) { const id = newId(); this.operations.push({ type: 'page.create', id, title, parentId: parent }, { type: 'page.update', id, icon }); return id; }
  // A database in a page (inline) or as a page of its own (spec.page).
  database(parent: string, spec: DatabaseSpec) {
    let holder = parent;
    if (spec.page) { holder = this.page(parent, spec.page.title, spec.page.icon); this.operations.push({ type: 'page.update', id: holder, databasePage: true }); }
    const sourceId = newId(), titleId = newId(), keys = new Map<string, { id: string; spec: PropertySpec; options: Map<string, string> }>();
    this.operations.push({ type: 'source.create', id: sourceId, pageId: holder, name: spec.name, titlePropertyId: titleId, ...titleNameField() });
    keys.set('title', { id: titleId, spec: { key: 'title', name: '', type: 'title' }, options: new Map() });
    for (const property of spec.properties) {
      const id = newId(), options = new Map((property.options ?? []).map(option => [option.name, newId()]));
      keys.set(property.key, { id, spec: property, options });
      this.operations.push({ type: 'property.create', id, sourceId, name: property.name, propertyType: property.type,
        ...(property.options ? { options: property.options.map(option => ({ id: options.get(option.name)!, name: option.name, color: option.color ?? 'default', ...(option.group ? { group: option.group } : {}) })) } : {}),
        ...(property.numberFormat ? { numberFormat: property.numberFormat } : {}) } as Operation);
    }
    const ref = (key?: string) => key ? keys.get(key)?.id ?? null : null;
    for (const view of spec.views) {
      const config: Record<string, unknown> = { ...view.extra };
      if (view.groupBy) config.groupBy = ref(view.groupBy);
      if (view.date) config.datePropertyId = ref(view.date);
      if (view.endDate) config.endDatePropertyId = ref(view.endDate);
      if (view.visible) config.visibleProperties = [titleId, ...view.visible.map(ref).filter(Boolean)];
      if (view.sorts) config.sorts = view.sorts.map(sort => ({ propertyId: ref(sort.key), direction: sort.direction }));
      this.operations.push({ type: 'view.create', id: newId(), sourceId, parentId: holder, name: view.name, viewType: view.type, config } as Operation);
    }
    for (const row of spec.rows ?? []) {
      const id = newId();
      this.operations.push({ type: 'page.create', id, title: row.title, sourceId });
      if (row.icon) this.operations.push({ type: 'page.update', id, icon: row.icon });
      for (const [key, raw] of Object.entries(row.values ?? {})) {
        const property = keys.get(key); if (!property) continue;
        const type = property.spec.type;
        const value = ['select', 'status'].includes(type) ? property.options.get(String(raw)) ?? null
          : type === 'multi_select' ? (raw as string[]).map(name => property.options.get(name)).filter(Boolean)
          : type === 'date' ? (typeof raw === 'number' ? { start: day(raw) } : Array.isArray(raw) ? { start: day(raw[0] as number), end: day(raw[1] as number) } : raw)
          : type === 'person' ? (raw as string[]) : raw;
        this.operations.push({ type: 'value.set', pageId: id, propertyId: property.id, value } as Operation);
      }
      for (const line of row.body ?? []) this.text(id, line);
    }
    return { sourceId, holder };
  }
}

const statusTodo = () => [{ name: t("시작 전"), color: 'gray', group: 'todo' as const }, { name: t("진행 중"), color: 'blue', group: 'in_progress' as const }, { name: t("완료"), color: 'green', group: 'complete' as const }];

export const galleryTemplates = (): GalleryTemplate[] => [
  // ----- 개인 -----
  { id: 'journal', category: 'personal', icon: '📓', name: t("일기"), description: t("하루를 돌아보는 짧은 기록과 감사 일기"), build: b => {
    const r = b.rootId;
    b.callout(r, '🌤️', t("**오늘의 한 줄** — 오늘을 한 문장으로 적어 보세요."), 'yellow_background');
    b.heading(r, 2, t("있었던 일")); b.text(r);
    b.heading(r, 2, t("감사한 일")); b.numbered(r); b.numbered(r); b.numbered(r);
    b.heading(r, 2, t("배운 것")); b.bullet(r);
    b.heading(r, 2, t("내일 할 일")); b.todo(r); b.todo(r);
  } },
  { id: 'habits', category: 'personal', icon: '🌱', name: t("습관 기록"), description: t("날마다 습관을 체크하고 달력으로 돌아보기"), build: b => {
    b.text(b.rootId, t("매일 한 줄씩 추가하고 해낸 습관에 체크하세요."));
    b.database(b.rootId, { name: t("습관 기록"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'workout', name: t("운동"), type: 'checkbox' }, { key: 'read', name: t("독서"), type: 'checkbox' },
      { key: 'water', name: t("물 2L"), type: 'checkbox' }, { key: 'sleep', name: t("수면 시간"), type: 'number' }, { key: 'note', name: t("메모"), type: 'text' },
    ], views: [{ name: t("표"), type: 'table', sorts: [{ key: 'date', direction: 'desc' }] }, { name: t("달력"), type: 'calendar', date: 'date' }],
    rows: [-2, -1, 0].map(offset => ({ title: day(offset), values: { date: offset, workout: offset !== -1, read: true, water: offset === 0, sleep: 7 + (offset + 2) * 0.5 } })) });
  } },
  { id: 'reading', category: 'personal', icon: '📚', name: t("독서 목록"), description: t("읽을 책, 읽는 책, 다 읽은 책과 별점"), build: b => {
    b.database(b.rootId, { name: t("독서 목록"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: [{ name: t("읽을 예정"), color: 'gray', group: 'todo' }, { name: t("읽는 중"), color: 'blue', group: 'in_progress' }, { name: t("완독"), color: 'green', group: 'complete' }] },
      { key: 'author', name: t("저자"), type: 'text' }, { key: 'genre', name: t("분야"), type: 'multi_select', options: [{ name: t("소설"), color: 'purple' }, { name: t("에세이"), color: 'pink' }, { name: t("경제"), color: 'green' }, { name: t("과학"), color: 'blue' }] },
      { key: 'rating', name: t("별점"), type: 'select', options: ['★★★★★', '★★★★', '★★★', '★★', '★'].map(name => ({ name, color: 'yellow' })) }, { key: 'done', name: t("다 읽은 날"), type: 'date' },
    ], views: [{ name: t("서재"), type: 'gallery', extra: { galleryPreview: 'page_content', cardSize: 'medium' } }, { name: t("상태별"), type: 'board', groupBy: 'status' }, { name: t("표"), type: 'table' }],
    rows: [
      { title: t("예시: 첫 번째 책"), icon: '📕', values: { status: t("읽는 중"), author: t("저자 이름"), genre: [t("소설")] }, body: [t("인상 깊은 구절이나 생각을 적어 두세요.")] },
      { title: t("예시: 두 번째 책"), icon: '📗', values: { status: t("완독"), genre: [t("에세이")], rating: '★★★★', done: -5 } },
      { title: t("예시: 세 번째 책"), icon: '📘', values: { status: t("읽을 예정"), genre: [t("과학")] } },
    ] });
  } },
  { id: 'travel', category: 'personal', icon: '🧳', name: t("여행 계획"), description: t("일정, 준비물, 예산을 한 페이지에"), build: b => {
    const r = b.rootId;
    b.callout(r, '✈️', t("**여행지** · **기간** · **함께 가는 사람**을 적어 두세요."), 'blue_background');
    b.heading(r, 2, t("일정"));
    for (const n of [1, 2, 3]) b.toggle(r, t("{0}일차", [n]), id => { b.bullet(id, t("오전")); b.bullet(id, t("오후")); b.bullet(id, t("저녁")); });
    b.heading(r, 2, t("준비물"));
    for (const item of [t("여권 · 신분증"), t("충전기"), t("상비약"), t("옷"), t("세면도구")]) b.todo(r, item);
    b.heading(r, 2, t("예산"));
    b.table(r, [[t("항목"), t("예상"), t("실제")], [t("교통"), '', ''], [t("숙소"), '', ''], [t("식비"), '', ''], [t("합계"), '', '']]);
  } },
  { id: 'goals', category: 'personal', icon: '🎯', name: t("목표"), description: t("올해 목표와 진행률 막대"), build: b => {
    b.quote(b.rootId, t("크게 생각하고, 작게 시작하세요."));
    b.database(b.rootId, { name: t("목표"), properties: [
      { key: 'area', name: t("영역"), type: 'select', options: [{ name: t("건강"), color: 'green' }, { name: t("일"), color: 'blue' }, { name: t("배움"), color: 'purple' }, { name: t("관계"), color: 'pink' }] },
      { key: 'progress', name: t("진행률"), type: 'number', numberFormat: { style: 'percent', display: 'bar', color: 'green', divideBy: 1 } },
      { key: 'due', name: t("목표일"), type: 'date' }, { key: 'status', name: t("상태"), type: 'status', options: statusTodo() },
    ], views: [{ name: t("모든 목표"), type: 'table' }, { name: t("영역별"), type: 'board', groupBy: 'area' }],
    rows: [
      { title: t("예시: 하프 마라톤 완주"), values: { area: t("건강"), progress: 0.4, due: 120, status: t("진행 중") } },
      { title: t("예시: 책 24권 읽기"), values: { area: t("배움"), progress: 0.25, due: 300, status: t("진행 중") } },
    ] });
  } },
  // ----- 업무 -----
  { id: 'meetings', category: 'work', icon: '🗓️', name: t("회의록"), description: t("회의마다 안건 · 결정 · 할 일을 같은 형식으로"), build: b => {
    const { sourceId } = b.database(b.rootId, { name: t("회의록"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'kind', name: t("종류"), type: 'select', options: [{ name: t("정기 회의"), color: 'blue' }, { name: t("기획"), color: 'purple' }, { name: t("회고"), color: 'orange' }] },
      { key: 'people', name: t("참석자"), type: 'person' },
    ], views: [{ name: t("모든 회의"), type: 'table', sorts: [{ key: 'date', direction: 'desc' }] }, { name: t("달력"), type: 'calendar', date: 'date' }],
    rows: [{ title: t("예시: 주간 정기 회의"), values: { date: 0, kind: t("정기 회의") }, body: [t("안건과 결정 사항을 적어 두세요.")] }] });
    void sourceId;
  } },
  { id: 'projects', category: 'work', icon: '🗂️', name: t("프로젝트 관리"), description: t("담당 · 우선순위 · 마감과 보드 · 타임라인 보기"), build: b => {
    b.database(b.rootId, { name: t("프로젝트"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: statusTodo() }, { key: 'owner', name: t("담당자"), type: 'person' },
      { key: 'priority', name: t("우선순위"), type: 'select', options: [{ name: t("높음"), color: 'red' }, { name: t("중간"), color: 'yellow' }, { name: t("낮음"), color: 'green' }] },
      { key: 'dates', name: t("기간"), type: 'date' },
    ], views: [{ name: t("보드"), type: 'board', groupBy: 'status' }, { name: t("타임라인"), type: 'timeline', date: 'dates' }, { name: t("표"), type: 'table' }],
    rows: [
      { title: t("예시: 출시 준비"), values: { status: t("진행 중"), priority: t("높음"), dates: [-3, 10] } },
      { title: t("예시: 사용자 조사"), values: { status: t("완료"), priority: t("중간"), dates: [-14, -4] } },
      { title: t("예시: 다음 분기 계획"), values: { status: t("시작 전"), priority: t("낮음"), dates: [12, 30] } },
    ] });
  } },
  { id: 'tasks', category: 'work', icon: '✅', name: t("작업 보드"), description: t("할 일 · 진행 중 · 완료 칸반 보드"), build: b => {
    b.database(b.rootId, { name: t("작업"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: statusTodo() }, { key: 'owner', name: t("담당자"), type: 'person' }, { key: 'due', name: t("마감일"), type: 'date' },
      { key: 'tag', name: t("분류"), type: 'multi_select', options: [{ name: t("버그"), color: 'red' }, { name: t("기능"), color: 'blue' }, { name: t("문서"), color: 'gray' }] },
    ], views: [{ name: t("보드"), type: 'board', groupBy: 'status' }, { name: t("내 작업"), type: 'table', sorts: [{ key: 'due', direction: 'asc' }] }],
    rows: [{ title: t("예시: 첫 작업"), values: { status: t("시작 전"), due: 2, tag: [t("기능")] } }, { title: t("예시: 검토 요청"), values: { status: t("진행 중"), due: 1, tag: [t("문서")] } }] });
  } },
  { id: 'okr', category: 'work', icon: '📈', name: t("OKR"), description: t("분기 목표와 핵심 결과의 진행률"), build: b => {
    b.callout(b.rootId, '💡', t("목표(O)는 방향, 핵심 결과(KR)는 숫자로 잴 수 있게 적으세요."), 'yellow_background');
    b.database(b.rootId, { name: t("OKR"), properties: [
      { key: 'quarter', name: t("분기"), type: 'select', options: ['Q1', 'Q2', 'Q3', 'Q4'].map(name => ({ name, color: 'blue' })) },
      { key: 'kind', name: t("구분"), type: 'select', options: [{ name: t("목표"), color: 'purple' }, { name: t("핵심 결과"), color: 'green' }] },
      { key: 'progress', name: t("진행률"), type: 'number', numberFormat: { style: 'percent', display: 'ring', color: 'blue', divideBy: 1 } },
    ], views: [{ name: t("분기별"), type: 'board', groupBy: 'quarter' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 고객 만족도 높이기"), values: { quarter: 'Q1', kind: t("목표"), progress: 0.5 } }, { title: t("예시: 응답 시간 24시간 이내"), values: { quarter: 'Q1', kind: t("핵심 결과"), progress: 0.7 } }] });
  } },
  { id: 'wiki', category: 'work', icon: '📖', name: t("팀 위키"), description: t("팀의 문서를 모아 두는 위키"), build: b => {
    const r = b.rootId;
    b.operations.push({ type: 'page.update', id: r, wiki: true });
    b.text(r, t("팀이 함께 보는 문서를 이 아래에 모으세요."));
    const start = b.page(r, t("시작하기"), '👋'); b.heading(start, 2, t("처음 오셨나요?")); b.bullet(start, t("팀 소개")); b.bullet(start, t("자주 쓰는 도구")); b.bullet(start, t("연락 방법"));
    const how = b.page(r, t("일하는 방식"), '🛠️'); b.heading(how, 2, t("회의")); b.text(how); b.heading(how, 2, t("문서 작성")); b.text(how);
    const faq = b.page(r, t("자주 묻는 질문"), '❓'); b.toggle(faq, t("질문을 적고 펼쳐서 답을 적으세요."), id => b.text(id, t("답변")));
  } },
  // ----- 학습 -----
  { id: 'study', category: 'school', icon: '🎓', name: t("공부 계획"), description: t("과목별 일정과 진도를 타임라인으로"), build: b => {
    b.database(b.rootId, { name: t("공부 계획"), properties: [
      { key: 'subject', name: t("과목"), type: 'select', options: [{ name: t("수학"), color: 'blue' }, { name: t("영어"), color: 'green' }, { name: t("과학"), color: 'purple' }] },
      { key: 'dates', name: t("기간"), type: 'date' }, { key: 'status', name: t("상태"), type: 'status', options: statusTodo() }, { key: 'done', name: t("진도"), type: 'number', numberFormat: { style: 'percent', display: 'bar', color: 'blue', divideBy: 1 } },
    ], views: [{ name: t("타임라인"), type: 'timeline', date: 'dates' }, { name: t("과목별"), type: 'board', groupBy: 'subject' }],
    rows: [{ title: t("예시: 미적분 1단원"), values: { subject: t("수학"), dates: [0, 6], status: t("진행 중"), done: 0.3 } }, { title: t("예시: 단어 300개"), values: { subject: t("영어"), dates: [2, 12], status: t("시작 전"), done: 0 } }] });
  } },
  { id: 'notes', category: 'school', icon: '📝', name: t("강의 노트"), description: t("강의별 노트와 복습할 내용"), build: b => {
    b.database(b.rootId, { name: t("강의 노트"), properties: [
      { key: 'course', name: t("과목"), type: 'select', options: [{ name: t("과목 A"), color: 'blue' }, { name: t("과목 B"), color: 'orange' }] },
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'review', name: t("복습 완료"), type: 'checkbox' },
    ], views: [{ name: t("모든 노트"), type: 'table', sorts: [{ key: 'date', direction: 'desc' }] }, { name: t("과목별"), type: 'board', groupBy: 'course' }],
    rows: [{ title: t("예시: 1주차 강의"), values: { course: t("과목 A"), date: -1 }, body: [t("핵심 개념"), t("질문할 것")] }] });
  } },
  // ----- 기획 · 개발 -----
  { id: 'prd', category: 'product', icon: '🧩', name: t("제품 요구사항 문서"), description: t("문제 · 목표 · 요구사항 · 일정을 정리하는 PRD"), build: b => {
    const r = b.rootId;
    b.callout(r, '📌', t("**상태**: 초안 · **담당**: · **마지막 검토**:"), 'gray_background');
    b.heading(r, 2, t("문제")); b.text(r, t("누구의 어떤 문제를 푸나요?"));
    b.heading(r, 2, t("목표와 지표")); b.bullet(r, t("목표")); b.bullet(r, t("성공 지표"));
    b.heading(r, 2, t("요구사항"));
    b.table(r, [[t("요구사항"), t("우선순위"), t("메모")], ['', 'P0', ''], ['', 'P1', ''], ['', 'P2', '']]);
    b.heading(r, 2, t("범위 밖")); b.bullet(r);
    b.heading(r, 2, t("일정")); b.todo(r, t("설계 검토")); b.todo(r, t("개발")); b.todo(r, t("출시"));
  } },
  { id: 'content', category: 'product', icon: '📣', name: t("콘텐츠 캘린더"), description: t("채널별 게시 일정과 상태"), build: b => {
    b.database(b.rootId, { name: t("콘텐츠"), properties: [
      { key: 'date', name: t("게시일"), type: 'date' }, { key: 'channel', name: t("채널"), type: 'select', options: [{ name: t("블로그"), color: 'green' }, { name: t("뉴스레터"), color: 'purple' }, { name: t("SNS"), color: 'blue' }] },
      { key: 'status', name: t("상태"), type: 'status', options: [{ name: t("아이디어"), color: 'gray', group: 'todo' }, { name: t("작성 중"), color: 'blue', group: 'in_progress' }, { name: t("게시됨"), color: 'green', group: 'complete' }] },
    ], views: [{ name: t("달력"), type: 'calendar', date: 'date' }, { name: t("상태별"), type: 'board', groupBy: 'status' }],
    rows: [{ title: t("예시: 신제품 소개 글"), values: { date: 3, channel: t("블로그"), status: t("작성 중") } }, { title: t("예시: 월간 소식"), values: { date: 9, channel: t("뉴스레터"), status: t("아이디어") } }] });
  } },
  { id: 'bugs', category: 'product', icon: '🐞', name: t("버그 트래커"), description: t("심각도 · 상태 · 담당자로 버그 관리"), build: b => {
    b.database(b.rootId, { name: t("버그"), properties: [
      { key: 'severity', name: t("심각도"), type: 'select', options: [{ name: t("치명적"), color: 'red' }, { name: t("높음"), color: 'orange' }, { name: t("보통"), color: 'yellow' }, { name: t("낮음"), color: 'gray' }] },
      { key: 'status', name: t("상태"), type: 'status', options: [{ name: t("신규"), color: 'gray', group: 'todo' }, { name: t("수정 중"), color: 'blue', group: 'in_progress' }, { name: t("해결"), color: 'green', group: 'complete' }] },
      { key: 'owner', name: t("담당자"), type: 'person' }, { key: 'reported', name: t("보고일"), type: 'date' },
    ], views: [{ name: t("보드"), type: 'board', groupBy: 'status' }, { name: t("심각도별"), type: 'table', groupBy: 'severity' }],
    rows: [{ title: t("예시: 저장 버튼이 두 번 눌림"), values: { severity: t("높음"), status: t("수정 중"), reported: -2 }, body: [t("재현 방법"), t("기대 결과"), t("실제 결과")] }] });
  } },
  // ----- 개인 (more) -----
  { id: 'budget', category: 'personal', icon: '💰', name: t("가계부"), description: t("수입과 지출을 분류별로 기록"), build: b => {
    b.callout(b.rootId, '💡', t("쓸 때마다 한 줄씩 적고, 분류별 보기로 어디에 많이 썼는지 확인하세요."), 'green_background');
    b.database(b.rootId, { name: t("가계부"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'kind', name: t("구분"), type: 'select', options: [{ name: t("지출"), color: 'red' }, { name: t("수입"), color: 'green' }] },
      { key: 'category', name: t("분류"), type: 'select', options: [{ name: t("식비"), color: 'orange' }, { name: t("교통"), color: 'blue' }, { name: t("주거"), color: 'brown' }, { name: t("여가"), color: 'purple' }, { name: t("기타"), color: 'gray' }] },
      { key: 'amount', name: t("금액"), type: 'number' }, { key: 'note', name: t("메모"), type: 'text' },
    ], views: [{ name: t("표"), type: 'table', sorts: [{ key: 'date', direction: 'desc' }] }, { name: t("분류별"), type: 'board', groupBy: 'category' }],
    rows: [{ title: t("점심"), values: { date: 0, kind: t("지출"), category: t("식비"), amount: 9000 } }, { title: t("교통카드 충전"), values: { date: -1, kind: t("지출"), category: t("교통"), amount: 30000 } }] });
  } },
  { id: 'meals', category: 'personal', icon: '🥗', name: t("식단 계획"), description: t("끼니별 메뉴를 달력으로 계획"), build: b => {
    b.database(b.rootId, { name: t("식단"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'meal', name: t("끼니"), type: 'select', options: [{ name: t("아침"), color: 'yellow' }, { name: t("점심"), color: 'orange' }, { name: t("저녁"), color: 'blue' }] },
      { key: 'shop', name: t("장볼 것"), type: 'text' },
    ], views: [{ name: t("달력"), type: 'calendar', date: 'date' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 현미밥과 된장국"), values: { date: 0, meal: t("저녁"), shop: t("두부, 애호박") } }] });
  } },
  { id: 'recipes', category: 'personal', icon: '🍳', name: t("레시피 모음"), description: t("만들어 본 요리와 재료, 조리 시간"), build: b => {
    b.database(b.rootId, { name: t("레시피"), properties: [
      { key: 'kind', name: t("종류"), type: 'select', options: [{ name: t("한식"), color: 'red' }, { name: t("양식"), color: 'blue' }, { name: t("디저트"), color: 'pink' }, { name: t("간단 요리"), color: 'green' }] },
      { key: 'minutes', name: t("조리 시간(분)"), type: 'number' }, { key: 'made', name: t("만들어 봄"), type: 'checkbox' },
    ], views: [{ name: t("갤러리"), type: 'gallery', extra: { galleryPreview: 'page_content', cardSize: 'medium' } }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 김치볶음밥"), icon: '🍚', values: { kind: t("한식"), minutes: 15, made: true }, body: [t("**재료** — 밥, 김치, 대파, 달걀"), t("**만드는 법** — 대파를 볶다가 김치와 밥을 넣고 볶은 뒤 달걀을 올립니다.")] }] });
  } },
  { id: 'workout', category: 'personal', icon: '🏃', name: t("운동 기록"), description: t("운동 종류와 시간을 날마다 기록"), build: b => {
    b.database(b.rootId, { name: t("운동 기록"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'kind', name: t("종류"), type: 'select', options: [{ name: t("달리기"), color: 'blue' }, { name: t("근력"), color: 'red' }, { name: t("요가"), color: 'green' }, { name: t("자전거"), color: 'orange' }] },
      { key: 'minutes', name: t("시간(분)"), type: 'number' }, { key: 'note', name: t("메모"), type: 'text' },
    ], views: [{ name: t("달력"), type: 'calendar', date: 'date' }, { name: t("표"), type: 'table', sorts: [{ key: 'date', direction: 'desc' }] }],
    rows: [{ title: t("아침 달리기"), values: { date: 0, kind: t("달리기"), minutes: 30 } }] });
  } },
  { id: 'watchlist', category: 'personal', icon: '🎬', name: t("영화 · 드라마 목록"), description: t("보고 싶은 작품과 본 작품, 별점"), build: b => {
    b.database(b.rootId, { name: t("볼 목록"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: [{ name: t("보고 싶음"), color: 'gray', group: 'todo' }, { name: t("보는 중"), color: 'blue', group: 'in_progress' }, { name: t("다 봄"), color: 'green', group: 'complete' }] },
      { key: 'kind', name: t("종류"), type: 'select', options: [{ name: t("영화"), color: 'purple' }, { name: t("드라마"), color: 'pink' }, { name: t("다큐멘터리"), color: 'blue' }] },
      { key: 'rating', name: t("별점"), type: 'select', options: ['★★★★★', '★★★★', '★★★', '★★', '★'].map(name => ({ name, color: 'yellow' })) },
    ], views: [{ name: t("상태별"), type: 'board', groupBy: 'status' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 보고 싶은 영화"), values: { status: t("보고 싶음"), kind: t("영화") } }] });
  } },
  { id: 'weekly', category: 'personal', icon: '🗓️', name: t("주간 계획"), description: t("요일별 할 일과 이번 주 목표"), build: b => {
    const r = b.rootId;
    b.callout(r, '🎯', t("**이번 주 목표** — 꼭 해낼 세 가지를 적어 보세요."), 'purple_background');
    for (const name of [t("월요일"), t("화요일"), t("수요일"), t("목요일"), t("금요일"), t("주말")]) b.toggle(r, name, id => { b.todo(id); b.todo(id); });
    b.heading(r, 2, t("돌아보기")); b.text(r);
  } },
  { id: 'moving', category: 'personal', icon: '📦', name: t("이사 체크리스트"), description: t("한 달 전부터 이사 당일까지 할 일"), build: b => {
    const r = b.rootId;
    b.heading(r, 2, t("한 달 전")); for (const item of [t("이사 업체 견적 받기"), t("버릴 물건 정리"), t("전입 신고 서류 확인")]) b.todo(r, item);
    b.heading(r, 2, t("일주일 전")); for (const item of [t("짐 싸기 시작"), t("공과금 정산 신청"), t("주소 변경 알리기")]) b.todo(r, item);
    b.heading(r, 2, t("이사 당일")); for (const item of [t("계량기 확인"), t("열쇠 받기"), t("파손된 짐 확인")]) b.todo(r, item);
  } },
  { id: 'gifts', category: 'personal', icon: '🎁', name: t("선물 아이디어"), description: t("받을 사람과 때, 예산을 정리"), build: b => {
    b.database(b.rootId, { name: t("선물 아이디어"), properties: [
      { key: 'who', name: t("받는 사람"), type: 'text' }, { key: 'when', name: t("때"), type: 'select', options: [{ name: t("생일"), color: 'pink' }, { name: t("기념일"), color: 'red' }, { name: t("명절"), color: 'orange' }] },
      { key: 'price', name: t("가격"), type: 'number' }, { key: 'bought', name: t("샀음"), type: 'checkbox' }, { key: 'link', name: t("링크"), type: 'url' },
    ], views: [{ name: t("표"), type: 'table' }, { name: t("때별"), type: 'board', groupBy: 'when' }],
    rows: [{ title: t("예시: 향초"), values: { who: t("친구"), when: t("생일"), price: 25000 } }] });
  } },
  // ----- 업무 (more) -----
  { id: 'crm', category: 'work', icon: '🤝', name: t("고객 관리"), description: t("고객사와 단계, 다음 연락일"), build: b => {
    b.database(b.rootId, { name: t("고객"), properties: [
      { key: 'stage', name: t("단계"), type: 'status', options: [{ name: t("잠재 고객"), color: 'gray', group: 'todo' }, { name: t("상담 중"), color: 'blue', group: 'in_progress' }, { name: t("제안"), color: 'purple', group: 'in_progress' }, { name: t("계약"), color: 'green', group: 'complete' }] },
      { key: 'email', name: t("이메일"), type: 'email' }, { key: 'phone', name: t("전화"), type: 'phone' }, { key: 'next', name: t("다음 연락일"), type: 'date' }, { key: 'value', name: t("예상 금액"), type: 'number' },
    ], views: [{ name: t("단계별"), type: 'board', groupBy: 'stage' }, { name: t("표"), type: 'table', sorts: [{ key: 'next', direction: 'asc' }] }],
    rows: [{ title: t("예시: 가나다 상사"), values: { stage: t("상담 중"), next: 3, value: 5000000 } }] });
  } },
  { id: 'hiring', category: 'work', icon: '🧑‍💼', name: t("채용 관리"), description: t("지원자를 단계별 보드로 관리"), build: b => {
    b.database(b.rootId, { name: t("지원자"), properties: [
      { key: 'stage', name: t("단계"), type: 'status', options: [{ name: t("서류 검토"), color: 'gray', group: 'todo' }, { name: t("면접"), color: 'blue', group: 'in_progress' }, { name: t("처우 협의"), color: 'purple', group: 'in_progress' }, { name: t("합격"), color: 'green', group: 'complete' }, { name: t("불합격"), color: 'red', group: 'complete' }] },
      { key: 'role', name: t("지원 직무"), type: 'select', options: [{ name: t("개발"), color: 'blue' }, { name: t("디자인"), color: 'pink' }, { name: t("마케팅"), color: 'orange' }] },
      { key: 'applied', name: t("지원일"), type: 'date' }, { key: 'email', name: t("이메일"), type: 'email' },
    ], views: [{ name: t("단계별"), type: 'board', groupBy: 'stage' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 지원자 A"), values: { stage: t("면접"), role: t("개발"), applied: -4 }, body: [t("면접 메모")] }] });
  } },
  { id: 'onboarding', category: 'work', icon: '👋', name: t("신규 입사자 온보딩"), description: t("첫날, 첫 주, 첫 달에 할 일"), build: b => {
    const r = b.rootId;
    b.callout(r, '🙌', t("환영합니다! 아래 순서대로 하나씩 체크해 보세요."), 'blue_background');
    b.heading(r, 2, t("첫날")); for (const item of [t("계정과 장비 받기"), t("팀원과 인사하기"), t("팀 위키 읽기")]) b.todo(r, item);
    b.heading(r, 2, t("첫 주")); for (const item of [t("주요 문서 읽기"), t("첫 작업 맡기"), t("멘토와 1:1")]) b.todo(r, item);
    b.heading(r, 2, t("첫 달")); for (const item of [t("첫 결과물 공유"), t("궁금한 점 정리"), t("한 달 회고")]) b.todo(r, item);
  } },
  { id: 'oneonone', category: 'work', icon: '💬', name: t("1:1 미팅"), description: t("매번 같은 순서로 나누는 1:1 기록"), build: b => {
    const r = b.rootId;
    b.heading(r, 2, t("지난번 할 일 확인")); b.todo(r);
    b.heading(r, 2, t("이야기할 것")); b.bullet(r);
    b.heading(r, 2, t("피드백")); b.bullet(r);
    b.heading(r, 2, t("다음 할 일")); b.todo(r);
  } },
  { id: 'standup', category: 'work', icon: '☀️', name: t("데일리 스탠드업"), description: t("어제 한 일, 오늘 할 일, 막힌 점"), build: b => {
    b.database(b.rootId, { name: t("스탠드업"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'yesterday', name: t("어제 한 일"), type: 'text' }, { key: 'today', name: t("오늘 할 일"), type: 'text' }, { key: 'blocker', name: t("막힌 점"), type: 'text' },
    ], views: [{ name: t("표"), type: 'table', sorts: [{ key: 'date', direction: 'desc' }] }],
    rows: [{ title: day(0), values: { date: 0, today: t("예시: 리뷰 반영") } }] });
  } },
  { id: 'roadmap', category: 'work', icon: '🛣️', name: t("로드맵"), description: t("분기별 계획을 타임라인으로"), build: b => {
    b.database(b.rootId, { name: t("로드맵"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: statusTodo() }, { key: 'when', name: t("기간"), type: 'date' },
      { key: 'quarter', name: t("분기"), type: 'select', options: ['Q1', 'Q2', 'Q3', 'Q4'].map(name => ({ name, color: 'blue' })) },
    ], views: [{ name: t("타임라인"), type: 'timeline', date: 'when' }, { name: t("분기별"), type: 'board', groupBy: 'quarter' }],
    rows: [{ title: t("예시: 새 기능 출시"), values: { status: t("진행 중"), when: [0, 30], quarter: 'Q4' } }, { title: t("예시: 성능 개선"), values: { status: t("시작 전"), when: [20, 60], quarter: 'Q1' } }] });
  } },
  { id: 'docs', category: 'work', icon: '🗃️', name: t("문서 허브"), description: t("가이드 · 정책 · 회의 문서를 한곳에"), build: b => {
    b.database(b.rootId, { name: t("문서"), properties: [
      { key: 'kind', name: t("분류"), type: 'select', options: [{ name: t("가이드"), color: 'blue' }, { name: t("정책"), color: 'red' }, { name: t("회의"), color: 'green' }, { name: t("기타"), color: 'gray' }] },
      { key: 'owner', name: t("담당자"), type: 'person' }, { key: 'reviewed', name: t("마지막 검토"), type: 'date' },
    ], views: [{ name: t("목록"), type: 'list' }, { name: t("분류별"), type: 'table', groupBy: 'kind' }],
    rows: [{ title: t("예시: 휴가 사용 안내"), values: { kind: t("정책"), reviewed: -10 } }] });
  } },
  { id: 'vendors', category: 'work', icon: '📇', name: t("거래처 목록"), description: t("분야와 연락처를 정리한 거래처 목록"), build: b => {
    b.database(b.rootId, { name: t("거래처"), properties: [
      { key: 'kind', name: t("분야"), type: 'select', options: [{ name: t("인쇄"), color: 'blue' }, { name: t("물류"), color: 'orange' }, { name: t("디자인"), color: 'pink' }] },
      { key: 'phone', name: t("전화"), type: 'phone' }, { key: 'email', name: t("이메일"), type: 'email' }, { key: 'site', name: t("웹사이트"), type: 'url' }, { key: 'note', name: t("메모"), type: 'text' },
    ], views: [{ name: t("표"), type: 'table' }], rows: [{ title: t("예시: 가나 인쇄소"), values: { kind: t("인쇄") } }] });
  } },
  // ----- 학습 (more) -----
  { id: 'assignments', category: 'school', icon: '📝', name: t("과제 관리"), description: t("과목별 과제와 마감일"), build: b => {
    b.database(b.rootId, { name: t("과제"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: statusTodo() }, { key: 'due', name: t("마감"), type: 'date' },
      { key: 'subject', name: t("과목"), type: 'select', options: [{ name: t("수학"), color: 'blue' }, { name: t("영어"), color: 'green' }, { name: t("과학"), color: 'purple' }] },
    ], views: [{ name: t("보드"), type: 'board', groupBy: 'status' }, { name: t("달력"), type: 'calendar', date: 'due' }],
    rows: [{ title: t("예시: 보고서 제출"), values: { status: t("진행 중"), due: 3, subject: t("과학") } }] });
  } },
  { id: 'timetable', category: 'school', icon: '⏰', name: t("시간표"), description: t("요일과 교시별 시간표"), build: b => {
    b.table(b.rootId, [['', t("월요일"), t("화요일"), t("수요일"), t("목요일"), t("금요일")], ...[1, 2, 3, 4, 5, 6].map(n => [t("{0}교시", [n]), '', '', '', '', ''])]);
    b.text(b.rootId, t("빈칸에 과목과 강의실을 적으세요."));
  } },
  { id: 'vocab', category: 'school', icon: '🔤', name: t("단어장"), description: t("단어와 뜻, 예문, 외운 단어 체크"), build: b => {
    b.database(b.rootId, { name: t("단어장"), properties: [
      { key: 'meaning', name: t("뜻"), type: 'text' }, { key: 'example', name: t("예문"), type: 'text' }, { key: 'known', name: t("외움"), type: 'checkbox' },
    ], views: [{ name: t("표"), type: 'table' }], rows: [{ title: 'serendipity', values: { meaning: t("뜻밖의 행운") } }] });
  } },
  { id: 'research', category: 'school', icon: '🔬', name: t("연구 노트"), description: t("읽은 자료와 요약, 출처"), build: b => {
    b.database(b.rootId, { name: t("자료"), properties: [
      { key: 'source', name: t("출처"), type: 'url' }, { key: 'summary', name: t("요약"), type: 'text' },
      { key: 'tags', name: t("태그"), type: 'multi_select', options: [{ name: t("이론"), color: 'blue' }, { name: t("방법"), color: 'green' }, { name: t("사례"), color: 'orange' }] },
    ], views: [{ name: t("표"), type: 'table' }, { name: t("갤러리"), type: 'gallery', extra: { galleryPreview: 'page_content' } }],
    rows: [{ title: t("예시: 읽은 논문"), values: { tags: [t("이론")] }, body: [t("핵심 주장"), t("내 생각")] }] });
  } },
  { id: 'exam', category: 'school', icon: '📖', name: t("시험 준비"), description: t("시험 범위와 공부 일정, 오답 노트"), build: b => {
    const r = b.rootId;
    b.heading(r, 2, t("시험 범위")); b.todo(r); b.todo(r);
    b.heading(r, 2, t("공부 일정")); b.table(r, [[t("날짜"), t("할 일"), t("완료")], ['', '', ''], ['', '', '']]);
    b.heading(r, 2, t("오답 노트")); b.toggle(r, t("틀린 문제"), id => { b.text(id, t("왜 틀렸는지 적어 보세요.")); });
  } },
  { id: 'thesis', category: 'school', icon: '🎓', name: t("논문 작성"), description: t("장별 진행 상황을 한 페이지에"), build: b => {
    const r = b.rootId;
    for (const name of [t("서론"), t("관련 연구"), t("연구 방법"), t("결과"), t("결론")]) b.toggle(r, name, id => { b.todo(id, t("초안")); b.todo(id, t("검토")); });
    b.heading(r, 2, t("참고 문헌")); b.numbered(r);
  } },
  // ----- 기획 · 개발 (more) -----
  { id: 'sprint', category: 'product', icon: '🏃‍♀️', name: t("스프린트 보드"), description: t("작업과 스토리 포인트를 보드로"), build: b => {
    b.database(b.rootId, { name: t("스프린트 작업"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: statusTodo() }, { key: 'points', name: t("스토리 포인트"), type: 'number' },
      { key: 'owner', name: t("담당자"), type: 'person' }, { key: 'due', name: t("마감"), type: 'date' },
    ], views: [{ name: t("보드"), type: 'board', groupBy: 'status' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 로그인 화면"), values: { status: t("진행 중"), points: 3 } }, { title: t("예시: 결제 연동"), values: { status: t("시작 전"), points: 5 } }] });
  } },
  { id: 'release', category: 'product', icon: '🚀', name: t("릴리스 노트"), description: t("버전마다 새 기능 · 개선 · 수정"), build: b => {
    const r = b.rootId;
    b.heading(r, 1, 'v1.0.0');
    b.heading(r, 3, t("새 기능")); b.bullet(r);
    b.heading(r, 3, t("개선")); b.bullet(r);
    b.heading(r, 3, t("버그 수정")); b.bullet(r);
    b.divider(r);
  } },
  { id: 'decision', category: 'product', icon: '⚖️', name: t("의사결정 기록"), description: t("배경 · 선택지 · 결정 · 영향을 남기기"), build: b => {
    const r = b.rootId;
    b.callout(r, '📌', t("**상태**: 논의 중 · **결정한 날**:"), 'gray_background');
    b.heading(r, 2, t("배경")); b.text(r);
    b.heading(r, 2, t("선택지")); b.table(r, [[t("선택지"), t("장점"), t("단점")], ['A', '', ''], ['B', '', '']]);
    b.heading(r, 2, t("결정")); b.text(r);
    b.heading(r, 2, t("영향")); b.bullet(r);
  } },
  { id: 'retro', category: 'product', icon: '🔁', name: t("회고"), description: t("좋았던 점 · 아쉬운 점 · 시도할 것"), build: b => {
    const r = b.rootId;
    b.heading(r, 2, t("좋았던 점")); b.bullet(r);
    b.heading(r, 2, t("아쉬운 점")); b.bullet(r);
    b.heading(r, 2, t("시도할 것")); b.todo(r);
  } },
  { id: 'feedback', category: 'product', icon: '📣', name: t("사용자 피드백"), description: t("들어온 의견을 출처와 중요도로 분류"), build: b => {
    b.database(b.rootId, { name: t("피드백"), properties: [
      { key: 'source', name: t("출처"), type: 'select', options: [{ name: t("인터뷰"), color: 'blue' }, { name: t("설문"), color: 'green' }, { name: t("문의"), color: 'orange' }] },
      { key: 'priority', name: t("중요도"), type: 'select', options: [{ name: t("높음"), color: 'red' }, { name: t("보통"), color: 'yellow' }, { name: t("낮음"), color: 'gray' }] },
      { key: 'status', name: t("상태"), type: 'status', options: statusTodo() },
    ], views: [{ name: t("중요도별"), type: 'board', groupBy: 'priority' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 검색이 느려요"), values: { source: t("문의"), priority: t("높음"), status: t("시작 전") } }] });
  } },
  { id: 'designsys', category: 'product', icon: '🎨', name: t("디자인 가이드"), description: t("색, 글꼴, 컴포넌트 규칙"), build: b => {
    const r = b.rootId;
    b.heading(r, 2, t("색")); b.table(r, [[t("이름"), t("값"), t("쓰는 곳")], [t("기본"), '#2383E2', ''], [t("배경"), '#FFFFFF', '']]);
    b.heading(r, 2, t("글꼴")); b.table(r, [[t("용도"), t("크기"), t("굵기")], [t("제목"), '24', '700'], [t("본문"), '16', '400']]);
    b.heading(r, 2, t("컴포넌트")); b.bullet(r, t("버튼")); b.bullet(r, t("입력창"));
  } },
  // ----- 팀 운영 -----
  { id: 'teamcal', category: 'team', icon: '📆', name: t("팀 일정"), description: t("회의 · 마감 · 휴가를 한 달력에"), build: b => {
    b.database(b.rootId, { name: t("팀 일정"), properties: [
      { key: 'date', name: t("날짜"), type: 'date' }, { key: 'kind', name: t("종류"), type: 'select', options: [{ name: t("회의"), color: 'blue' }, { name: t("마감"), color: 'red' }, { name: t("휴가"), color: 'green' }] },
      { key: 'who', name: t("담당자"), type: 'person' },
    ], views: [{ name: t("달력"), type: 'calendar', date: 'date' }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 월간 회의"), values: { date: 2, kind: t("회의") } }] });
  } },
  { id: 'handbook', category: 'team', icon: '📘', name: t("팀 핸드북"), description: t("팀 규칙과 자주 쓰는 안내를 한곳에"), build: b => {
    const r = b.rootId;
    for (const name of [t("우리 팀 소개"), t("일하는 방식"), t("휴가와 근무"), t("자주 묻는 질문")]) b.toggle(r, name, id => { b.text(id); });
  } },
  { id: 'event', category: 'team', icon: '🎉', name: t("행사 준비"), description: t("행사 개요, 할 일, 예산, 연락처"), build: b => {
    const r = b.rootId;
    b.callout(r, '📍', t("**일시** · **장소** · **인원**을 적어 두세요."), 'orange_background');
    b.heading(r, 2, t("할 일")); for (const item of [t("장소 예약"), t("초대장 보내기"), t("다과 준비")]) b.todo(r, item);
    b.heading(r, 2, t("예산")); b.table(r, [[t("항목"), t("예상"), t("실제")], [t("장소"), '', ''], [t("음식"), '', '']]);
    b.heading(r, 2, t("연락처")); b.bullet(r);
  } },
  { id: 'inventory', category: 'team', icon: '🧰', name: t("비품 관리"), description: t("수량과 위치, 다시 살 것"), build: b => {
    b.database(b.rootId, { name: t("비품"), properties: [
      { key: 'count', name: t("수량"), type: 'number' }, { key: 'place', name: t("위치"), type: 'text' }, { key: 'reorder', name: t("다시 주문"), type: 'checkbox' },
    ], views: [{ name: t("표"), type: 'table' }], rows: [{ title: t("예시: A4 용지"), values: { count: 3, place: t("사무실 선반"), reorder: true } }] });
  } },
  // ----- 기록 · 창작 -----
  { id: 'blog', category: 'creative', icon: '✍️', name: t("블로그 글 계획"), description: t("글감부터 게시까지 상태별로"), build: b => {
    b.database(b.rootId, { name: t("글"), properties: [
      { key: 'status', name: t("상태"), type: 'status', options: [{ name: t("아이디어"), color: 'gray', group: 'todo' }, { name: t("작성 중"), color: 'blue', group: 'in_progress' }, { name: t("게시됨"), color: 'green', group: 'complete' }] },
      { key: 'tags', name: t("태그"), type: 'multi_select', options: [{ name: t("일상"), color: 'pink' }, { name: t("기술"), color: 'blue' }, { name: t("여행"), color: 'green' }] },
      { key: 'date', name: t("게시일"), type: 'date' },
    ], views: [{ name: t("상태별"), type: 'board', groupBy: 'status' }, { name: t("달력"), type: 'calendar', date: 'date' }],
    rows: [{ title: t("예시: 첫 번째 글"), values: { status: t("작성 중"), tags: [t("일상")] } }] });
  } },
  { id: 'ideas', category: 'creative', icon: '💡', name: t("아이디어 메모"), description: t("떠오른 생각을 모아 두고 고르기"), build: b => {
    b.database(b.rootId, { name: t("아이디어"), properties: [
      { key: 'kind', name: t("분류"), type: 'select', options: [{ name: t("일"), color: 'blue' }, { name: t("취미"), color: 'green' }, { name: t("사업"), color: 'orange' }] },
      { key: 'score', name: t("평가"), type: 'select', options: ['★★★', '★★', '★'].map(name => ({ name, color: 'yellow' })) },
    ], views: [{ name: t("갤러리"), type: 'gallery', extra: { galleryPreview: 'page_content' } }, { name: t("표"), type: 'table' }],
    rows: [{ title: t("예시: 주말 플리마켓"), values: { kind: t("취미"), score: '★★' } }] });
  } },
  { id: 'portfolio', category: 'creative', icon: '🖼️', name: t("포트폴리오"), description: t("작업물을 분야와 연도별로 정리"), build: b => {
    b.database(b.rootId, { name: t("작업물"), properties: [
      { key: 'kind', name: t("분야"), type: 'select', options: [{ name: t("디자인"), color: 'pink' }, { name: t("사진"), color: 'blue' }, { name: t("글"), color: 'green' }] },
      { key: 'year', name: t("연도"), type: 'number' }, { key: 'link', name: t("링크"), type: 'url' },
    ], views: [{ name: t("갤러리"), type: 'gallery', extra: { galleryPreview: 'page_content', cardSize: 'large' } }],
    rows: [{ title: t("예시: 포스터 디자인"), values: { kind: t("디자인"), year: new Date().getFullYear() } }] });
  } },
  { id: 'novel', category: 'creative', icon: '📜', name: t("소설 구상"), description: t("등장인물 · 줄거리 · 설정"), build: b => {
    const r = b.rootId;
    b.heading(r, 2, t("등장인물")); b.table(r, [[t("이름"), t("역할"), t("특징")], ['', '', ''], ['', '', '']]);
    b.heading(r, 2, t("줄거리")); for (const name of [t("발단"), t("전개"), t("위기"), t("절정"), t("결말")]) b.toggle(r, name, id => { b.text(id); });
    b.heading(r, 2, t("세계관 설정")); b.bullet(r);
  } },
];

// The template as one command under parentId (null: the top of the sidebar).
export function templateOperations(template: GalleryTemplate, parentId: string | null): { pageId: string; operations: Operation[] } {
  const pageId = newId();
  const builder = new TemplateBuilder(pageId);
  builder.operations.push({ type: 'page.create', id: pageId, title: template.name, parentId }, { type: 'page.update', id: pageId, icon: template.icon });
  template.build(builder);
  return { pageId, operations: builder.operations };
}
