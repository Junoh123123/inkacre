// Shapes of the objects returned by GET /api/state. They mirror src/contracts.mjs and
// src/workspace.mjs; the UI never invents fields that the engine does not store.

export type TextColor = 'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

export interface RichRun {
  text: string;
  /** Discussion threads (first comment ids) this text belongs to. */
  comments?: string[];
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  underline?: boolean;
  href?: string;
  pageId?: string;
  /** An inline equation: the text is its TeX. */
  equation?: boolean;
  color?: string;
  background?: string;
  /** A date mention: the day (or day and time), how it reads, and a reminder that many minutes before. */
  date?: string; dateFormat?: 'relative' | 'full' | 'short' | 'iso'; remind?: number; reminderId?: string;
  /** A web link mention (href + title as text) with the site's icon kept as an attachment. */
  mention?: boolean; iconAttachmentId?: string; linkSite?: string; linkDescription?: string; dateZone?: string;
  /** A custom emoji (an uploaded picture); the text is its :name:. */
  customEmoji?: string;
}
export type RichText = RichRun[];

export interface BaseEntity {
  id: string;
  kind: string;
  parentId: string | null;
  alive: boolean;
  /** When it went to the trash, and whether it was then deleted for good (영구 삭제). */
  trashedAt?: string; purged?: boolean;
  version: number;
  position: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface PageEntity extends BaseEntity {
  kind: 'page';
  title: string;
  sourceId: string | null;
  values: Record<string, unknown>;
  template: boolean;
  uniqueId: number | null;
  icon?: string | null;
  coverAttachmentId?: string | null;
  fullWidth?: boolean;
  /** Emoji reactions (one person, so each is on or off). */
  reactions?: string[];
  /** 보관됨 (kept, out of search and views), 페이지 잠금 (read-only until unlocked), 위키 (홈 · 모든 페이지 · 내 페이지). */
  archived?: boolean; archivedAt?: string; locked?: boolean; wiki?: boolean;
  /** A database page (true) or an ordinary page with the database inline (false); absent: by its history. */
  databasePage?: boolean;
  /** Names given to versions, by revision (버전 이름 지정). */
  versionNames?: Record<string, string>;
  recurrence?: { enabled: boolean; frequency: string; interval: number; start: string; timeZone: string } | null;
}

export type BlockType =
  | 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'bullet' | 'numbered' | 'todo' | 'toggle'
  | 'quote' | 'code' | 'divider' | 'callout' | 'bookmark' | 'image' | 'file' | 'synced' | 'synced_reference'
  | 'button' | 'table' | 'columns' | 'column' | 'toc' | 'math' | 'video' | 'audio' | 'breadcrumb' | 'tabs' | 'tab' | 'html'
  | 'pdf' | 'embed' | 'link_to_page';

export interface ButtonDefinition {
  label: string;
  icon?: string | null;
  confirmation?: string | null;
  actions: Array<Record<string, unknown> & { action: string }>;
}

export interface BlockEntity extends BaseEntity {
  kind: 'block';
  blockType: BlockType;
  richText: RichText;
  checked?: boolean;
  language?: string;
  caption?: RichText; height?: number; width?: number;
  url?: string;
  attachmentId?: string | null;
  sourceBlockId?: string;
  button?: ButtonDefinition;
  bookmark?: { url: string; title: string; description: string; siteName: string; imageAttachmentId?: string | null; iconAttachmentId?: string | null } | null;
  cells?: RichText[][];
  tableHeader?: { row: boolean; column: boolean };
  columnWidths?: number[];
  rowColors?: Array<string | null>;
  columnColors?: Array<string | null>;
  /** Optional presentation fields: callout icon, block colour (`red`, `red_background`…), collapsible heading, column width ratio. */
  icon?: string;
  color?: string;
  toggleable?: boolean;
  listFormat?: 'numbers' | 'letters' | 'roman' | null;
  ratio?: number;
  /** Media: placement, alternative text, a link on the picture, a crop (fractions) and a mask shape. */
  align?: 'left' | 'center' | 'right' | null; alt?: string | null; href?: string | null;
  crop?: { x: number; y: number; w: number; h: number } | null; mask?: MaskShape | null;
  /** Text direction (right-to-left writing); absent = from the text. */
  direction?: 'ltr' | 'rtl' | null;
  /** Simple tables: single cell colours ("row:column") and merged ranges. */
  cellColors?: Record<string, string> | null;
  merges?: Array<{ row: number; column: number; rows: number; columns: number }> | null;
}
export type MaskShape = 'circle' | 'rounded' | 'star' | 'heart' | 'triangle' | 'hexagon';

/** 페이지 레이아웃 사용자 지정: how the pages of a database are laid out. */
export type LayoutSection = { type: 'group'; id: string; name?: string; properties?: string[] } | { type: 'property'; id: string; propertyId: string } | { type: 'discussion'; id: string };
/** 탭 구조: a tab showing a view of a database, narrowed to rows whose relation points at the open page. */
export interface LayoutTab { id: string; name: string; viewId: string; relationPropertyId?: string }
export interface PageLayout {
  structure?: 'simple' | 'tabs'; order?: string[]; hidden?: string[]; panel?: string[]; sections?: LayoutSection[];
  comments?: 'always' | 'minimal'; discussion?: boolean; propertyIcons?: boolean; narrow?: boolean; templates?: boolean;
  /** Properties pinned in the heading (up to 15) and how backlinks show there. */
  pinned?: string[]; backlinks?: 'always' | 'expanded' | 'popover' | 'hover' | 'off'; tabs?: LayoutTab[];
  hideWhenEmpty?: string[];
}
export interface SourceEntity extends BaseEntity {
  kind: 'source';
  name: string;
  counter: number;
  /** 데이터베이스 잠금: properties and views can't be changed until unlocked. */
  locked?: boolean;
  pageLayout?: PageLayout;
  defaultTemplateId?: string | null;
  tasks?: {
    subitems?: { enabled: boolean; parentPropertyId?: string; childrenPropertyId?: string };
    dependencies?: { enabled: boolean; predecessorPropertyId?: string; successorPropertyId?: string; datePropertyId?: string | null; mode?: string; avoidWeekends?: boolean };
    sprints?: SprintConfig;
  };
}

export interface SprintConfig {
  enabled: boolean; lengthWeeks: number; startDay: number; unfinished: 'next' | 'backlog'; upcoming: number; autoComplete: boolean; timeZone: string;
  pageId?: string; sourceId?: string; relationPropertyId?: string; datePropertyId?: string; statusPropertyId?: string; tasksPropertyId?: string;
  statusOptions?: { past: string; current: string; next: string; future: string };
}

export type PropertyType =
  | 'title' | 'text' | 'number' | 'checkbox' | 'select' | 'multi_select' | 'status' | 'date' | 'url' | 'email' | 'phone'
  | 'person' | 'files' | 'relation' | 'formula' | 'rollup' | 'place' | 'created_time' | 'last_edited_time' | 'created_by'
  | 'last_edited_by' | 'unique_id' | 'button';

export interface SelectOption { id: string; name: string; color?: string; group?: string }

export interface NumberFormat { style: 'number' | 'percent' | 'currency'; currency?: string; digits?: number; grouping?: boolean; display?: 'number' | 'bar' | 'ring'; color?: string; divideBy?: number; showNumber?: boolean }

export interface PropertyEntity extends BaseEntity {
  kind: 'property';
  type: PropertyType;
  sourceId: string;
  name: string;
  options?: SelectOption[];
  formula?: string;
  targetSourceId?: string;
  inversePropertyId?: string;
  button?: ButtonDefinition;
  relationLimit?: 1 | null;
  displayProperties?: string[];
  numberFormat?: NumberFormat;
  idPrefix?: string;
  dateFormat?: 'full' | 'short' | 'mdy' | 'dmy' | 'ymd' | 'relative';
  timeFormat?: '12' | '24' | 'hidden';
  rollup?: { relationPropertyId: string; targetPropertyId: string; aggregation: string };
  // UI only: a column that is not a database property (the library's) names its own icon.
  icon?: string;
}

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'feed' | 'chart' | 'map' | 'form' | 'dashboard';

export type Filter =
  | { propertyId: string; op: string; value?: unknown }
  | { all: Filter[] }
  | { any: Filter[] }
  | { not: Filter };

export type ChartType = 'bar' | 'hbar' | 'line' | 'donut' | 'number';
export type ChartPalette = 'auto' | 'colorful' | 'gray' | 'blue' | 'yellow' | 'green' | 'purple' | 'teal' | 'orange' | 'pink' | 'red';
export interface ChartConfig {
  groupBy: string;
  valuePropertyId?: string;
  aggregation: string;
  type?: ChartType;
  sort?: 'manual' | 'asc' | 'desc' | 'valueAsc' | 'valueDesc';
  groupOrder?: string[];
  hiddenGroups?: string[];
  excludeZero?: boolean;
  stackBy?: string | null;
  range?: { min?: number | null; max?: number | null } | null;
  referenceLines?: Array<{ id: string; value: number; label?: string; color?: string; dashed?: boolean }>;
  palette?: ChartPalette;
  height?: 'small' | 'medium' | 'large' | 'xlarge';
  gridLines?: 'none' | 'horizontal' | 'vertical' | 'both';
  axisLabels?: 'none' | 'x' | 'y' | 'both';
  dataLabels?: boolean;
  colorByValue?: boolean;
  showCaption?: boolean;
  caption?: string | null;
  smooth?: boolean;
  gradient?: boolean;
  showLegend?: boolean;
  showTitle?: boolean;
  title?: string | null;
  numberFormat?: 'number' | 'percent' | 'currency';
  color?: string;
  statusGrouping?: 'group' | 'option';
  dateGrouping?: 'relative' | 'day' | 'week' | 'month' | 'year';
  cumulative?: boolean;
  decimals?: number | null;
  showValue?: boolean;
  showValueLabel?: boolean;
  valueLabel?: string | null;
  hideNegative?: boolean;
  legendPosition?: 'bottom' | 'right';
  dataLabelFormat?: 'value' | 'percent' | 'both';
  dynamicColor?: boolean;
}
export interface FormQuestion { propertyId: string; title?: string | null; description?: string | null; required?: boolean; longAnswer?: boolean; syncName?: boolean; optionDisplay?: 'list' | 'dropdown'; maxSelections?: number | null; /** 조건부 로직: answering `value` shows the listed questions (hidden until then). */ logic?: Array<{ value: unknown; show: string[] }> }
export interface FormConfig { title?: string; description?: string; icon?: string | null; coverAttachmentId?: string | null; submitLabel?: string | null; submitColor?: string | null; confirmationTitle?: string | null; confirmation?: string | null; questions: FormQuestion[] }

export interface ConditionalColorRule { id: string; propertyId: string; op: string; value?: unknown; matchOption?: boolean; color?: string; applyTo?: 'row' | 'property' }

export interface ViewConfig {
  conditionalColors?: ConditionalColorRule[];
  filter?: Filter | null;
  // The filter is the view's one advanced filter (a single "규칙 N개" chip) rather than simple chips.
  advancedFilter?: boolean;
  search?: string;
  sorts?: Array<{ propertyId: string; direction: 'asc' | 'desc' }>;
  groupBy?: string | null;
  visibleProperties?: string[];
  datePropertyId?: string | null;
  endDatePropertyId?: string | null;
  placePropertyId?: string | null;
  chart?: ChartConfig | null;
  showPageIcon?: boolean;
  tabDisplay?: 'both' | 'icon' | 'text';
  /** Status properties shown as a checkbox in this view (done = the complete group). */
  checkboxStatus?: string[];
  wrapProperties?: boolean;
  showAuthor?: boolean;
  loadLimit?: number;
  form?: FormConfig | null;
  openMode?: 'side' | 'center' | 'page';
  widgets?: string[];
  // Dashboard layout (rows of up to four widgets) and filters applied to the widgets of one data source.
  dashboardRows?: string[][];
  dashboardFilters?: Record<string, Filter>;
  dashboardShared?: { sourceId: string; filter: Filter } | null;
  dashboardSizes?: Record<string, { width?: number; height?: number }>;
  subitems?: { display: 'nested' | 'flat' | 'card'; include: 'parents' | 'all' | 'children' };
  columnAggregations?: Record<string, string>;
  frozenProperties?: string[];
  subgroupBy?: string | null;
  hiddenGroups?: string[];
  groupOrder?: string[];
  /** Status columns: one per status group (default) or one per option. */
  statusGrouping?: 'group' | 'option';
  groupSort?: 'manual' | 'asc' | 'desc';
  hideEmptyGroups?: boolean;
  /** Board column tints (default on). */
  columnBackground?: boolean;
  calendarMode?: 'month' | 'week';
  timelineZoom?: 'hour' | 'day' | 'week' | 'biweek' | 'month' | 'quarter' | 'year';
  mapBackground?: boolean;
  galleryPreview?: 'none' | 'page_cover' | 'page_content' | 'files';
  previewFit?: 'cover' | 'contain';
  hideTitle?: boolean;
  cardSize?: 'small' | 'medium' | 'large';
  cardLayout?: 'list' | 'compact';
  fullWidthProperties?: string[];
  previewPropertyId?: string | null;
}

export interface ViewEntity extends BaseEntity {
  kind: 'view';
  sourceId: string;
  name: string;
  viewType: ViewType;
  config: ViewConfig;
}

export interface AttachmentEntity extends BaseEntity {
  kind: 'attachment';
  name: string;
  mediaType: string;
  sha256: string;
  bytes: number;
}

export interface CommentEntity extends BaseEntity { kind: 'comment'; richText: RichText; resolved: boolean; threadId?: string; reactions?: string[]; propertyId?: string }
export interface NotificationEntity extends BaseEntity { kind: 'notification'; message: string; read: boolean; source?: 'reminder' | 'automation' | 'error' | 'comment'; archived?: boolean }
export interface ReminderEntity extends BaseEntity { kind: 'reminder'; at?: string; datePropertyId?: string; offsetMinutes: number; message: string }
export interface NavigationEntity extends BaseEntity { kind: 'navigation'; favorites: string[] }
export interface DeliveryEntity extends BaseEntity { kind: 'delivery'; channel: string; status: string; url?: string; to?: string; error?: string; receipt?: string }

/** A database automation (⚡): triggers and actions on its data source's pages. */
export interface AutomationEntity extends BaseEntity {
  kind: 'automation'; sourceId: string; name: string; enabled: boolean; match: 'all' | 'any'; viewId: string | null;
  triggers: Array<Record<string, unknown> & { type: string }>; actions: Array<Record<string, unknown> & { action: string }>;
  schedule?: { index: number; nextAt: string | null } | null;
}

export type Entity =
  | PageEntity | BlockEntity | SourceEntity | PropertyEntity | ViewEntity | AttachmentEntity
  | CommentEntity | NotificationEntity | ReminderEntity | NavigationEntity | DeliveryEntity | AutomationEntity
  | (BaseEntity & Record<string, unknown>);

export interface Snapshot { revision: number; objects: Entity[] }

export type Operation = Record<string, unknown> & { type: string };

export interface CommandResult {
  revision: number;
  undoHandle?: string;
  changes?: unknown[];
  opens?: string[];
  openUrls?: string[];
  copies?: Array<{ copyId: string; idMap?: Record<string, string> }>;
  [key: string]: unknown;
}

export interface QueryRow {
  id: string;
  title: string;
  version: number;
  position: number;
  coverAttachmentId?: string | null;
  values: Record<string, unknown>;
  relationDisplay?: Record<string, Array<{ id: string; title: string; fields: Array<{ propertyId: string; name: string; value: unknown }> }>>;
  /** Formatted text values (their runs); `values` holds the plain words. */
  rich?: Record<string, RichText>;
  task?: { parentId?: string | null; children?: Array<{ id: string; title: string }>; predecessors: Array<{ id: string; title: string }>; successors: Array<{ id: string; title: string }> };
  children?: QueryRow[];
  /** 조건부 색상 for this row: the whole row and/or single cells (colour names). */
  colors?: { row?: string; cells?: Record<string, string> };
}

export interface QueryGroup { key: string; value: unknown; rowIds: string[]; hidden?: boolean; subgroups?: QueryGroup[]; /** Set on merged status-group columns. */ statusGroup?: string }

/** One X-axis group of a chart: `group` is the group's value, `value` the measured one (a number, or `{ error }`). */
export interface ChartBar { key: string; group: unknown; value: unknown; count: number; rowIds: string[]; errors: string[]; hidden?: boolean; drilldown: Filter | null; stacks?: Array<{ key: string; group: unknown; value: unknown; rowIds: string[] }> }

export interface QueryResult {
  /** UI only: values new rows start with in this frame (see DatabaseFrame's newRowValues). */
  defaults?: Record<string, unknown>;
  revision: number;
  source: SourceEntity;
  view: ViewEntity | null;
  properties: PropertyEntity[];
  visibleProperties: string[];
  rows: QueryRow[];
  total: number;
  offset: number;
  hasMore: boolean;
  presentation: {
    type: ViewType;
    columnAggregations?: Record<string, unknown>;
    groupPropertyId?: string | null;
    groups?: QueryGroup[];
    datePropertyId?: string | null;
    items?: Array<{ rowId: string; start: string; end?: string; timeZone?: string }>;
    undated?: string[];
    bars?: ChartBar[];
    total?: unknown;
    points?: Array<{ rowId: string; name: string; latitude?: number; longitude?: number }>;
    unlocated?: string[];
    basemap?: string;
    fields?: PropertyEntity[];
    widgets?: string[];
    subitems?: { display: string; include: string };
    dependencies?: Array<{ predecessorId: string; successorId: string; predecessorTitle: string; successorTitle: string }>;
  };
}
