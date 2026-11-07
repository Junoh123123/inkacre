import { z } from 'zod';

export const id = z.string().min(1).max(200);
export const textColors=['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];
export const richText = z.array(z.object({
  text: z.string(), bold: z.boolean().optional(), italic: z.boolean().optional(),
  strike: z.boolean().optional(), code: z.boolean().optional(),
  href: z.string().optional(), pageId: id.optional(), comments: z.array(id).min(1).max(20).optional(),
  // An inline equation: the run's text is its TeX (インライン式).
  equation: z.boolean().optional(),
  underline:z.boolean().optional(),color:z.union([z.enum(textColors),z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),background:z.union([z.enum(textColors),z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  // A date mention (@날짜): the run's text is how it read when written; date is the day (or day and time), shown as
  // dateFormat says ('relative' — 오늘 · 내일 · 어제 — by default). remind: a reminder that many minutes before.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/).optional(),
  dateFormat: z.enum(['relative', 'full', 'short', 'iso']).optional(), remind: z.number().int().min(0).max(525600).optional(), reminderId: id.optional(),
  // A time chosen in another time zone: date then carries that zone's offset, and the mention reads in that zone.
  dateZone: z.string().max(64).optional(),
  // A web link mention (링크 멘션): a chip with the site's icon (a local attachment) and the page title as text.
  mention: z.boolean().optional(), iconAttachmentId: id.optional(),
  // …and what its hover card shows, kept from when it was made: the site's name and the page's description.
  linkSite: z.string().max(200).optional(), linkDescription: z.string().max(500).optional(),
  // A custom emoji (사용자 지정 이모지): an uploaded picture shown inline; the text is its :name:.
  customEmoji: id.optional(),
}).strict());
export const blockTypes = ['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'bullet', 'numbered',
  'todo', 'toggle', 'quote', 'code', 'divider', 'callout', 'bookmark', 'image', 'file',
  'synced', 'synced_reference', 'button','table','columns','column','toc','math','video','audio','breadcrumb',
  // Tabs (17차): a 'tabs' block holds 'tab' blocks; a tab's richText is its name, its icon the tab icon.
  'tabs','tab',
  // HTML (18차): an uploaded .html file shown in a sandboxed frame.
  'html',
  // 24차: a PDF shown in the page (attachment), a web page embedded by its address, and a link to another page
  // (its richText holds one page mention) that also shows under the page in the sidebar.
  'pdf', 'embed', 'link_to_page'];
const cells=z.array(z.array(richText).min(1).max(50)).min(1).max(200);
// Optional presentation fields (additive): block colour (text or background), callout icon,
// collapsible headings, column width ratio.
export const blockColors=textColors.filter(color=>color!=='default').flatMap(color=>[color,`${color}_background`]);
const lineColor=z.enum(blockColors).nullable();
// icon: an emoji; '' = no icon (a callout without one), null/absent = the default.
const blockExtras={icon:z.string().max(64).nullable().optional(),color:z.enum(blockColors).nullable().optional(),toggleable:z.boolean().optional(),listFormat:z.enum(['numbers','letters','roman']).nullable().optional(),ratio:z.number().positive().max(100).nullable().optional(),
  // Simple tables: column widths in px and one colour per row / column (null = none).
  columnWidths:z.array(z.number().min(32).max(4000)).max(200).nullable().optional(),rowColors:z.array(lineColor).max(2000).nullable().optional(),columnColors:z.array(lineColor).max(200).nullable().optional(),
  // A code block's caption (17차; media blocks keep their caption in richText as before). null = none.
  caption:richText.nullable().optional(),
  // How tall an HTML block's frame is (px; null = the default 500).
  height:z.number().int().min(80).max(4000).nullable().optional(),
  // How wide it is (px, centred in the column; null = the whole column).
  width:z.number().int().min(40).max(4000).nullable().optional(),
  // Media (24차): where it sits in the column, its alternative text, a link on the image (a web address or
  // "?id=<page>"), a crop (fractions of the picture) and a mask shape.
  align:z.enum(['left','center','right']).nullable().optional(),alt:z.string().max(1000).nullable().optional(),href:z.string().max(4000).nullable().optional(),
  crop:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().min(0.02).max(1),h:z.number().min(0.02).max(1)}).strict().nullable().optional(),
  mask:z.enum(['circle','rounded','star','heart','triangle','hexagon']).nullable().optional(),
  // Text direction of a block (오른쪽에서 왼쪽 쓰기); null = from the text.
  direction:z.enum(['ltr','rtl']).nullable().optional(),
  // Simple tables: colour of single cells ("row:column" → colour) and merged ranges.
  cellColors:z.record(z.string().regex(/^\d{1,4}:\d{1,3}$/),z.enum(blockColors)).nullable().optional(),
  merges:z.array(z.object({row:z.number().int().min(0),column:z.number().int().min(0),rows:z.number().int().min(1).max(200),columns:z.number().int().min(1).max(50)}).strict()).max(500).nullable().optional()};
// A bookmark card; the page's picture and the site's icon are kept as local attachments (fetched once).
// The extras' names, for the structure-preserving bundle (exchange.mjs) to accept them.
export const blockExtraKeys=Object.keys(blockExtras);
const bookmark=z.object({url:z.string().url(),title:z.string().max(500),description:z.string().max(2000),siteName:z.string().max(200),imageAttachmentId:id.nullable().optional(),iconAttachmentId:id.nullable().optional()}).strict().nullable();
const tableHeader=z.object({row:z.boolean(),column:z.boolean()}).strict();
export const propertyTypes = ['title', 'text', 'number', 'checkbox', 'select', 'multi_select',
  'status', 'date', 'url', 'email', 'phone', 'person', 'files', 'relation', 'formula',
  'rollup', 'place', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button'];
export const viewTypes = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed',
  'chart', 'map', 'form', 'dashboard'];
const filterRule = z.object({ propertyId: id, op: z.enum(['eq', 'neq', 'contains', 'not_contains',
  'empty', 'not_empty', 'gt', 'gte', 'lt', 'lte', 'before', 'after', 'in', 'not_in', 'starts_with', 'ends_with', 'relative', 'within']), value: z.json().optional(),
  // A date range's end instead of its start ("종료일" in a date rule).
  end: z.boolean().optional() }).strict();
export const aggregations = ['sum','average','count','count_nonempty','count_empty','min','max','values','unique','median','range','percent_empty','percent_not_empty','checked','unchecked','percent_checked','percent_unchecked','earliest_date','latest_date','date_range'];
export const filterSchema = z.lazy(() => z.union([filterRule,
  z.object({ all: z.array(filterSchema) }).strict(), z.object({ any: z.array(filterSchema) }).strict(),
  z.object({ not: filterSchema }).strict()]));
// A block a button inserts: its kind, text with formatting, the usual block fields (a picture's attachment, a table's
// cells, a callout's icon and colour …) and blocks nested under it.
const insertedBlock = z.lazy(() => z.object({ blockType: z.enum(blockTypes).default('paragraph'), richText: richText.default([]), checked: z.boolean().optional(),
  language: z.string().optional(), attachmentId: id.optional(), url: z.string().optional(), cells: cells.optional(), tableHeader: tableHeader.optional(), ...blockExtras,
  children: z.array(insertedBlock).max(100).optional() }).strict());
export const buttonActions = z.array(z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_property'), targetId: id.optional(), propertyId: id, value: z.json() }).strict(),
  z.object({ action: z.literal('add_page'), sourceId: id.optional(), parentId: id.optional(), templateId: id.optional(), title: z.string(), values: z.record(id, z.json()).optional() }).strict(),
  // pages: the pages a variable or formula gives (a relation, say) instead of every page matching the filter.
  z.object({ action: z.literal('edit_pages'), sourceId: id, filter: filterSchema, propertyId: id, value: z.json(), pages: z.union([z.object({ $variable: id }).strict(), z.object({ $formula: z.string().min(1).max(10000) }).strict()]).optional() }).strict(),
  z.object({ action: z.literal('insert_blocks'), parentId: id.optional(), position: z.enum(['above', 'below', 'first', 'last']).default('below'), blocks: z.array(insertedBlock).min(1).max(100)
    .refine(blocks => { let count = 0; const walk = (list, depth) => list.every(block => ++count <= 500 && depth <= 8 && walk(block.children ?? [], depth + 1)); return walk(blocks, 0); }, '삽입할 블록은 500개, 8단계까지입니다.') }).strict(),
  z.object({ action: z.literal('open_page'), targetId: id }).strict(),
  // "Open page or URL": a web address opens in a new browser tab when a person clicks the button.
  z.object({ action: z.literal('open_url'), url: z.string().url().regex(/^https?:\/\//i).max(4000) }).strict(),
  z.object({action:z.literal('send_webhook'),url:z.string().url(),body:z.json()}).strict(),
  z.object({action:z.literal('send_email'),to:z.string().email(),subject:z.string().max(1000),message:z.string().max(50000)}).strict(),
  z.object({ action: z.literal('notify'), message: z.string().min(1).max(10000) }).strict(),
  // 변수 정의: named values later actions use ({ $variable: id } as a value). Text may hold {{propertyId}} /
  // {{var:id}} references; a formula sees the trigger page's properties, the earlier variables and the trigger.
  z.object({ action: z.literal('define_variables'), variables: z.array(z.object({ id, name: z.string().min(1).max(100), mode: z.enum(['text', 'formula']), value: z.string().max(10000) }).strict()).min(1).max(20) }).strict(),
])).max(50);
export const buttonDefinition = z.object({ label: z.string().min(1).default('실행'), icon: z.string().max(80).nullable().optional(), confirmation: z.string().nullable().optional(), actions: buttonActions.default([]) }).strict();
export const recurrenceSchema = z.object({ enabled: z.boolean(), frequency: z.enum(['day', 'week', 'month', 'year']), interval: z.number().int().min(1).max(365), start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), timeZone: z.string() }).strict();
// Database automations (⚡): when pages are added, a property is edited or on a schedule, run actions on the page.
export const automationSchedule = z.object({ frequency: z.enum(['day', 'weekday', 'week', 'month', 'year']), interval: z.number().int().min(1).max(365),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), timeZone: z.string() }).strict();
export const automationTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page_added') }).strict(),
  z.object({ type: z.literal('any_property_edited') }).strict(),
  // condition: a filter rule on the edited property's new value (text contains …, number greater than …, date this week …).
  z.object({ type: z.literal('property_edited'), propertyId: id, values: z.array(z.json()).max(500).optional(), condition: z.object({ op: filterRule.shape.op, value: z.json().optional() }).strict().optional() }).strict(),
  z.object({ type: z.literal('recurring'), schedule: automationSchedule }).strict(),
]);
export const automationActions = buttonActions.refine(actions => actions.every(action => ['set_property', 'add_page', 'edit_pages', 'notify', 'send_webhook', 'define_variables'].includes(action.action)), '자동화에서 쓸 수 없는 작업입니다.');
export const pageLayoutSchema = z.object({
  structure: z.enum(['simple', 'tabs']).optional(),
  order: z.array(id).max(500).optional(), hidden: z.array(id).max(500).optional(), panel: z.array(id).max(500).optional(),
  comments: z.enum(['always', 'minimal']).optional(), discussion: z.boolean().optional(), propertyIcons: z.boolean().optional(),
  narrow: z.boolean().optional(), templates: z.boolean().optional(),
  // Properties pinned in the heading under the title (up to 15), and how backlinks show there.
  pinned: z.array(id).max(15).optional(), backlinks: z.enum(['always', 'expanded', 'popover', 'hover', 'off']).optional(),
  // Properties shown only when they hold a value ("Hide when empty"); `hidden` are never shown.
  hideWhenEmpty: z.array(id).max(500).optional(),
  // 탭 구조: extra tabs beside "콘텐츠", each a view of a database, narrowed to rows whose relation points at this page.
  tabs: z.array(z.object({ id, name: z.string().min(1).max(200), viewId: id, relationPropertyId: id.optional() }).strict()).max(10).optional(),
  // The page's sections in order: property groups (the first one without a list takes every property placed
  // nowhere else), single-property modules and the discussion; the content always comes last.
  sections: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('group'), id, name: z.string().max(200).optional(), properties: z.array(id).max(500).optional() }).strict(),
    z.object({ type: z.literal('property'), id, propertyId: id }).strict(),
    z.object({ type: z.literal('discussion'), id }).strict(),
  ])).max(50).optional(),
}).strict();
// Keep the wire format and ZIP marker compatible while naming the standalone file Inkacre.
export const bundleFormat = 'pageyard-bundle';
export const bundleExtension = '.inkacre.json';
export const isBundleFormat = format => format === bundleFormat;
export const isBundleFile = name => name.endsWith(bundleExtension) || name.endsWith('.pageyard.json');
export const importSchema = z.object({ format: z.enum(['csv','markdown','html','zip','bundle']), text: z.string().max(23*1024*1024), sourceId: id.optional(), parentId: id.nullable().optional(), title: z.string().default('가져온 자료') }).strict();
export const viewConfig = z.object({
  filter: filterSchema.nullable().optional(), search: z.string().optional(),
  // 조건부 색상: rows (or one property's cells) whose value meets a rule get a background colour; the first rule wins.
  conditionalColors: z.array(z.object({ id, propertyId: id, op: z.string().max(40), value: z.json().optional(), matchOption: z.boolean().optional(),
    color: z.enum(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']).optional(), applyTo: z.enum(['row', 'property']).optional() }).strict()).max(50).optional(),
  sorts: z.array(z.object({ propertyId: id, direction: z.enum(['asc', 'desc']) }).strict()).optional(),
  groupBy: id.nullable().optional(), visibleProperties: z.array(id).optional(),
  datePropertyId: id.nullable().optional(), endDatePropertyId: id.nullable().optional(), placePropertyId: id.nullable().optional(),
  chart: z.object({ groupBy: id, valuePropertyId: id.optional(), aggregation: z.enum(['count', 'sum', 'average', 'min', 'max', 'median', 'range', 'count_nonempty', 'count_empty', 'unique', 'percent_empty', 'percent_not_empty']),type:z.enum(['bar','hbar','line','donut','number']).optional(),
    // Chart options: X-axis order/hidden groups/zero values, Y-axis grouping
    // (stacked), range and reference lines, then colour and the "more style options" page.
    sort: z.enum(['manual', 'asc', 'desc', 'valueAsc', 'valueDesc']).optional(), groupOrder: z.array(z.string()).optional(), hiddenGroups: z.array(z.string()).optional(), excludeZero: z.boolean().optional(),
    stackBy: id.nullable().optional(), range: z.object({ min: z.number().nullable().optional(), max: z.number().nullable().optional() }).strict().nullable().optional(),
    referenceLines: z.array(z.object({ id, value: z.number(), label: z.string().max(200).optional(), color: z.string().max(40).optional(), dashed: z.boolean().optional() }).strict()).max(20).optional(),
    palette: z.enum(['auto', 'colorful', 'gray', 'blue', 'yellow', 'green', 'purple', 'teal', 'orange', 'pink', 'red']).optional(),
    height: z.enum(['small', 'medium', 'large', 'xlarge']).optional(), gridLines: z.enum(['none', 'horizontal', 'vertical', 'both']).optional(), axisLabels: z.enum(['none', 'x', 'y', 'both']).optional(),
    dataLabels: z.boolean().optional(), colorByValue: z.boolean().optional(), showCaption: z.boolean().optional(), caption: z.string().max(2000).nullable().optional(), smooth: z.boolean().optional(), gradient: z.boolean().optional(), showLegend: z.boolean().optional(),
    showTitle: z.boolean().optional(), title: z.string().max(200).nullable().optional(), numberFormat: z.enum(['number', 'percent', 'currency']).optional(), color: z.string().max(40).optional(),
    statusGrouping: z.enum(['group', 'option']).optional(), dateGrouping: z.enum(['relative', 'day', 'week', 'month', 'year']).optional(), cumulative: z.boolean().optional(), decimals: z.number().int().min(0).max(10).nullable().optional(),
    showValue: z.boolean().optional(), showValueLabel: z.boolean().optional(), valueLabel: z.string().max(200).nullable().optional(), hideNegative: z.boolean().optional(),
    legendPosition: z.enum(['bottom', 'right']).optional(), dataLabelFormat: z.enum(['value', 'percent', 'both']).optional(), dynamicColor: z.boolean().optional() }).strict().nullable().optional(),
  // Feed, map and form options (2026-10-24): page icons, wrapped properties, author line, load limit; the form's
  // title, description and questions (one per property, with its own title, description and "required").
  // Status properties this view shows as a checkbox.
  checkboxStatus: z.array(id).max(500).optional(),
  showPageIcon: z.boolean().optional(), tabDisplay: z.enum(['both','icon','text']).optional(), wrapProperties: z.boolean().optional(), showAuthor: z.boolean().optional(), loadLimit: z.number().int().min(1).max(500).optional(),
  form: z.object({ title: z.string().max(2000).optional(), description: z.string().max(5000).optional(), icon: z.string().max(64).nullable().optional(), coverAttachmentId: id.nullable().optional(), submitLabel: z.string().max(100).nullable().optional(), submitColor: z.enum(['blue', 'gray', 'brown', 'orange', 'yellow', 'green', 'purple', 'pink', 'red']).nullable().optional(), confirmationTitle: z.string().max(300).nullable().optional(), confirmation: z.string().max(2000).nullable().optional(), questions: z.array(z.object({ propertyId: id, title: z.string().max(2000).nullable().optional(), description: z.string().max(5000).nullable().optional(), required: z.boolean().optional(), longAnswer: z.boolean().optional(), syncName: z.boolean().optional(), optionDisplay: z.enum(['list', 'dropdown']).optional(), maxSelections: z.number().int().min(1).max(1000).nullable().optional(), logic: z.array(z.object({ value: z.json(), show: z.array(id).max(200) }).strict()).max(200).optional() }).strict()).max(200) }).strict().nullable().optional(),
  openMode: z.enum(['side', 'center', 'page']).optional(), widgets: z.array(id).optional(),
  subitems: z.object({ display: z.enum(['nested', 'flat', 'card']), include: z.enum(['parents', 'all', 'children']) }).strict().optional(),
  columnAggregations: z.record(id,z.enum(aggregations)).optional(), frozenProperties: z.array(id).optional(),
  subgroupBy: id.nullable().optional(), hiddenGroups: z.array(z.string()).optional(), groupOrder: z.array(z.string()).optional(),
  statusGrouping: z.enum(['group', 'option']).optional(), groupSort: z.enum(['manual', 'asc', 'desc']).optional(), hideEmptyGroups: z.boolean().optional(), columnBackground: z.boolean().optional(),
  calendarMode: z.enum(['month','week']).optional(), timelineZoom: z.enum(['hour','day','week','biweek','month','quarter','year']).optional(),
  mapBackground:z.boolean().optional(), advancedFilter: z.boolean().optional(),
  galleryPreview: z.enum(['none','page_cover','page_content','files']).optional(), previewPropertyId: id.nullable().optional(),
  // Card preview fit (cover crops, contain shows the whole picture) and cards without the page name.
  previewFit: z.enum(['cover', 'contain']).optional(), hideTitle: z.boolean().optional(),
  // Dashboard layout: rows of up to four widgets; filters applied to every widget of one data source.
  dashboardRows: z.array(z.array(id).min(1).max(4)).max(100).optional(), dashboardFilters: z.record(id, filterSchema).optional(),
  // One filter for every widget: written with one widget source's properties, applied to each other source through its
  // property of the same name and type (option values by name).
  dashboardShared: z.object({ sourceId: id, filter: filterSchema }).strict().nullable().optional(),
  // A widget's share of its row's width (1 = equal) and its height in pixels.
  dashboardSizes: z.record(id, z.object({ width: z.number().min(0.25).max(8).optional(), height: z.number().int().min(160).max(1200).optional() }).strict()).optional(),
  // Board and gallery cards: size (small 180 · medium 260 · large 320 wide), layout (list: a line per
  // property; compact: properties run together, those listed in fullWidthProperties on lines of their own).
  cardSize: z.enum(['small', 'medium', 'large']).optional(), cardLayout: z.enum(['list', 'compact']).optional(), fullWidthProperties: z.array(id).max(500).optional(),
}).strict();
const optionalId = id.optional();
export const attachmentReferenceSchema = z.union([
  z.object({ pageId: id, propertyId: id, attachmentIds: z.array(id) }).strict(),
  z.object({ parentId: id, blockId: id, blockType: z.enum(['file', 'image', 'pdf']), beforeId: id.optional() }).strict(),
  z.object({ blockId: id }).strict(),
]);
export const inlineImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
// Site icons and custom emoji may also be .ico files (never SVG, which can carry script).
export const iconImageTypes = [...inlineImageTypes, 'image/x-icon', 'image/vnd.microsoft.icon'];
const propertyDefinition = {
  id: optionalId, sourceId: id, name: z.string().min(1), propertyType: z.enum(propertyTypes),
  options: z.array(z.object({ id, name: z.string(), color: z.string().optional(), group: z.string().optional() }).strict()).optional(),
  formula: z.string().optional(), targetSourceId: id.optional(),
  button: buttonDefinition.optional(),
  relationLimit: z.literal(1).nullable().optional(), displayProperties: z.array(id).optional(),
  // display: "Show as" (number, bar or ring) with its colour, the value that fills it (divideBy) and whether the number shows beside it.
  numberFormat: z.object({style:z.enum(['number','percent','currency']),currency:z.string().regex(/^[A-Z]{3}$/).optional(),digits:z.number().int().min(0).max(20).optional(),grouping:z.boolean().optional(),display:z.enum(['number','bar','ring']).optional(),color:z.enum(['default','gray','brown','orange','yellow','green','blue','purple','pink','red']).optional(),divideBy:z.number().positive().max(1e12).optional(),showNumber:z.boolean().optional()}).strict().optional(),
  inverse: z.object({ id: optionalId, name: z.string().min(1) }).strict().optional(),
  // A unique ID's prefix ("TASK" → TASK-12); letters and digits only.
  idPrefix: z.string().regex(/^[\p{L}\p{N}]{1,12}$/u).nullable().optional(),
  // A date property's display: the date (full · short · month/day/year · day/month/year · year/month/day ·
  // relative) and the time (12-hour · 24-hour · hidden). Null: the app's language decides.
  dateFormat: z.enum(['full', 'short', 'mdy', 'dmy', 'ymd', 'relative']).nullable().optional(), timeFormat: z.enum(['12', '24', 'hidden']).nullable().optional(),
  rollup: z.object({ relationPropertyId: id, targetPropertyId: id,
    aggregation: z.enum(aggregations) }).strict().optional(),
};
export const propertyConversionSchema = z.object({ type: z.literal('property.convert'), id, propertyType: z.enum(propertyTypes),
  fromType: z.enum(propertyTypes).optional(), name: z.string().min(1).optional(), options: propertyDefinition.options,
  formula: propertyDefinition.formula, targetSourceId: propertyDefinition.targetSourceId, inverse: propertyDefinition.inverse, rollup: propertyDefinition.rollup,button:propertyDefinition.button,relationLimit:propertyDefinition.relationLimit,displayProperties:propertyDefinition.displayProperties,numberFormat:propertyDefinition.numberFormat,idPrefix:propertyDefinition.idPrefix }).strict();
export const operationSchema = z.discriminatedUnion('type', [
 z.object({type:z.literal('delivery.update'),id,status:z.enum(['queued','sending','sent','failed','unknown','cancelled']),receipt:z.string().max(5000).optional(),error:z.string().max(5000).optional()}).strict(),
  z.object({ type: z.literal('page.create'), id: optionalId, title: z.string(), parentId: id.nullable().optional(), sourceId: optionalId, template: z.boolean().optional(), templateId: id.nullable().optional() }).strict(),
  // archived: kept but out of the way (hidden from search and database views, links keep working); locked: read-only
  // for everyone until unlocked; wiki: the page shows 홈 · 모든 페이지 · 내 페이지 over its content.
  z.object({ type: z.literal('page.update'), id, title: z.string().optional(), icon: z.string().nullable().optional(),coverAttachmentId:id.nullable().optional(),fullWidth:z.boolean().optional(), reactions: z.array(z.string().min(1).max(80)).max(50).optional(),
    archived: z.boolean().optional(), locked: z.boolean().optional(), wiki: z.boolean().optional(),
    // A database page (a full-page database: the page is the database) or an ordinary page holding it inline;
    // null leaves it to the page's history (made together with its database → database page).
    databasePage: z.boolean().nullable().optional() }).strict(),
  // A name for one of a page's versions (버전 이름 지정); null removes it.
  z.object({ type: z.literal('version.name'), pageId: id, revision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120).nullable() }).strict(),
  z.object({ type:z.literal('navigation.set'),favorites:z.array(id).max(1000) }).strict(),
  // 사용자 지정 이모지: a name (:name:) for an uploaded picture, usable as an icon or in text; null removes it.
  z.object({ type: z.literal('emoji.set'), name: z.string().regex(/^[a-z0-9_+-]{1,40}$/), attachmentId: id.nullable() }).strict(),
  z.object({ type: z.literal('node.move'), id, parentId: id.nullable(), beforeId: optionalId }).strict(),
  z.object({ type: z.literal('node.trash'), id }).strict(),
  z.object({ type: z.literal('node.restore'), id }).strict(),
  // 영구 삭제: an item in the trash leaves it for good (it stays in the change history, where the command can be undone).
  z.object({ type: z.literal('node.purge'), id }).strict(),
  z.object({ type: z.literal('block.create'), id: optionalId, parentId: id, blockType: z.enum(blockTypes).default('paragraph'), richText: richText.default([]), checked: z.boolean().optional(), language: z.string().optional(), sourceBlockId: optionalId, attachmentId: optionalId, url: z.string().optional(), button: buttonDefinition.optional(),bookmark:bookmark.optional(),cells:cells.optional(),tableHeader:tableHeader.optional(), ...blockExtras, columnIds: z.array(id).min(2).max(10).optional(), beforeId: optionalId }).strict(),
  z.object({ type: z.literal('block.update'), id, blockType: z.enum(blockTypes).optional(), richText: richText.optional(), checked: z.boolean().optional(), language: z.string().optional(), url: z.string().optional(), attachmentId: id.nullable().optional(), button: buttonDefinition.optional(),bookmark:bookmark.optional(),cells:cells.optional(),tableHeader:tableHeader.optional(), ...blockExtras }).strict(),
  z.object({ type: z.literal('block.duplicate'), id, newId: optionalId, parentId: optionalId, beforeId: optionalId }).strict(),
  // 동기화 해제: a copy becomes ordinary blocks of its own; on the original, every copy does and the original's
  // content takes its place.
  z.object({ type: z.literal('block.unsync'), id }).strict(),
  z.object({type:z.literal('blocks.duplicate'),ids:z.array(id).min(1).max(100)}).strict(),
  z.object({ type: z.literal('comment.create'), id: optionalId, parentId: id, threadId: id.optional(), richText, reactions: z.array(z.string().min(1).max(80)).max(50).optional(),
    // A comment on one of a database page's property values (parentId is the page).
    propertyId: id.optional() }).strict(),
  z.object({ type: z.literal('comment.update'), id, richText: richText.optional(), resolved: z.boolean().optional(), reactions: z.array(z.string().min(1).max(80)).max(50).optional() }).strict(),
  z.object({ type: z.literal('source.create'), id: optionalId, pageId: id, name: z.string().min(1), titlePropertyId: optionalId, titleName: z.string().min(1).max(200).optional() }).strict(),
  // A database's name, its lock (데이터베이스 잠금) and how its pages are laid out (페이지 레이아웃 사용자 지정).
  z.object({ type: z.literal('source.update'), id, name: z.string().min(1).max(2000).optional(), locked: z.boolean().optional(), pageLayout: pageLayoutSchema.nullable().optional() }).strict()
    .refine(operation => operation.name !== undefined || operation.locked !== undefined || operation.pageLayout !== undefined, '바꿀 내용을 지정하세요.'),
  z.object({ type: z.literal('source.configure_templates'), id, defaultTemplateId: id.nullable() }).strict(),
  // An empty row page picks a template ("Enter로 빈 페이지 또는 템플릿 선택"): its content and empty values come from it.
  z.object({ type: z.literal('page.apply_template'), id, templateId: id }).strict(),
  z.object({ type: z.literal('template.configure'), id, recurrence: recurrenceSchema.nullable() }).strict(),
  z.object({ type: z.literal('button.run'), id, pageId: optionalId, confirmed: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('reminder.set'), id: optionalId, parentId: id, at: z.iso.datetime({ offset: true }).optional(), datePropertyId: optionalId, offsetMinutes: z.number().int().min(0).max(525600).default(0), message: z.string().max(10000).default('알림') }).strict(),
  z.object({ type: z.literal('notification.read'), id, read: z.boolean() }).strict(),
  z.object({ type: z.literal('notification.archive'), id, archived: z.boolean() }).strict(),
  z.object({ type: z.literal('scheduler.tick'), at: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ type: z.literal('automation.create'), id: optionalId, sourceId: id, name: z.string().max(200).default(''), enabled: z.boolean().default(true), match: z.enum(['all', 'any']).default('all'),
    viewId: id.nullable().optional(), triggers: z.array(automationTrigger).min(1).max(10), actions: automationActions.refine(actions => actions.length > 0, '실행할 작업을 추가하세요.') }).strict(),
  z.object({ type: z.literal('automation.update'), id, name: z.string().max(200).optional(), enabled: z.boolean().optional(), match: z.enum(['all', 'any']).optional(),
    viewId: id.nullable().optional(), triggers: z.array(automationTrigger).min(1).max(10).optional(), actions: automationActions.refine(actions => actions.length > 0, '실행할 작업을 추가하세요.').optional() }).strict(),
  z.object({ type: z.literal('automation.delete'), id }).strict(),
  z.object({ type: z.literal('content.import_bundle'), bundle: z.json(), idMap: z.record(id,id), parentId: id.nullable().optional() }).strict(),
  z.object({ type: z.literal('source.configure_tasks'), id,
    subitems: z.object({ enabled: z.boolean(), parentPropertyId: optionalId, childrenPropertyId: optionalId }).strict().optional(),
    dependencies: z.object({ enabled: z.boolean(), predecessorPropertyId: optionalId, successorPropertyId: optionalId,
      datePropertyId: id.nullable().optional(), mode: z.enum(['none', 'overlap', 'preserve']).optional(), avoidWeekends: z.boolean().optional() }).strict().optional(),
  }).strict().refine(value => value.subitems || value.dependencies, '업무 구조 또는 의존성 설정이 필요합니다.'),
  // 스프린트 (sprints) on a task database: a sprints database (name · dates · status 지난/현재/다음/예정) linked
  // by a "스프린트" relation, its length, first weekday, what happens to unfinished tasks, how many sprints wait ahead
  // and whether a sprint completes by itself after its last day. labels: the names to create things with.
  z.object({ type: z.literal('source.configure_sprints'), id, enabled: z.boolean(), lengthWeeks: z.number().int().min(1).max(8).optional(), startDay: z.number().int().min(0).max(6).optional(),
    unfinished: z.enum(['next', 'backlog']).optional(), upcoming: z.number().int().min(1).max(5).optional(), autoComplete: z.boolean().optional(), timeZone: z.string().min(1).max(100).optional(),
    labels: z.record(z.enum(['database', 'title', 'dates', 'status', 'tasks', 'sprint', 'past', 'current', 'next', 'future', 'sprintName', 'currentView', 'planningView', 'backlogView', 'allView']), z.string().min(1).max(200)).optional() }).strict(),
  // 스프린트 완료: the current sprint ends; the next one starts; unfinished tasks move on (or back to the backlog).
  z.object({ type: z.literal('sprint.complete'), id }).strict(),
  // The workspace's own name and icon (an emoji, icon:… or attachment:…); null clears.
  z.object({ type: z.literal('workspace.update'), name: z.string().trim().max(200).nullable().optional(), icon: z.string().max(80).nullable().optional(), capturePageId: id.nullable().optional() }).strict()
    .refine(operation => operation.name !== undefined || operation.icon !== undefined || operation.capturePageId !== undefined, '바꿀 내용을 지정하세요.'),
  z.object({ type: z.literal('property.create'), ...propertyDefinition }).strict(),
  z.object({ type: z.literal('property.update'), id, name: z.string().min(1).optional(), options: propertyDefinition.options, formula: z.string().optional(), rollup: propertyDefinition.rollup, button: buttonDefinition.optional(), relationLimit:propertyDefinition.relationLimit,displayProperties:propertyDefinition.displayProperties,numberFormat:propertyDefinition.numberFormat,idPrefix:propertyDefinition.idPrefix,dateFormat:propertyDefinition.dateFormat,timeFormat:propertyDefinition.timeFormat }).strict(),
  propertyConversionSchema,
  z.object({ type: z.literal('value.set'), pageId: id, propertyId: id, value: z.json() }).strict(),
  // Rows imported into a database (CSV, Excel, ODS, TSV): each a new page with its values, all in one operation so a
  // table of thousands of rows is still one command (importing a CSV, or merging one into a database).
  z.object({ type: z.literal('source.import_rows'), sourceId: id, rows: z.array(z.object({ id, title: z.string(), values: z.record(id, z.json()) }).strict()).min(1).max(20000) }).strict(),
  z.object({ type: z.literal('relation.set'), pageId: id, propertyId: id, targetIds: z.array(id) }).strict(),
  z.object({ type: z.literal('view.create'), id: optionalId, sourceId: id, parentId: id, name: z.string().min(1), viewType: z.enum(viewTypes).default('table'), config: viewConfig.default({}) }).strict(),
  z.object({ type: z.literal('view.update'), id, name: z.string().min(1).optional(), viewType: z.enum(viewTypes).optional(), config: viewConfig.optional() }).strict(),
  z.object({ type: z.literal('page.duplicate'), id, newId: optionalId, title: z.string().optional(), parentId: id.nullable().optional(), sourceId: optionalId, withoutRows: z.boolean().optional(), keepTemplate: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('template.instantiate'), id, newId: optionalId, title: z.string(), sourceId: id }).strict(),
  z.object({ type: z.literal('page.restore_version'), id, revision: z.number().int().nonnegative() }).strict(),
  // A database back to how it was: its rows (pages, values, content) and properties at that revision.
  z.object({ type: z.literal('source.restore_version'), id, revision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('attachment.register'), id: optionalId, name: z.string().min(1), mediaType: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(), reference: attachmentReferenceSchema.optional() }).strict(),
]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// 검색 (⌘K and workspace_search): words or "exact phrases", and the search window's filters and sort.
export const searchSchema = z.object({ query: z.string().max(2000).default(''), titleOnly: z.boolean().optional(), sourceId: id.optional(), pageId: id.optional(),
  limit: z.number().int().positive().max(200).optional(), withinIds: z.array(id).max(50).optional(), dateField: z.enum(['edited', 'created']).optional(),
  from: day.optional(), to: day.optional(), archived: z.enum(['exclude', 'include', 'only']).optional(),
  sort: z.enum(['relevance', 'edited_desc', 'edited_asc', 'created_desc', 'created_asc']).optional() }).strict();
// 내 작업: the rows of the task databases (status property or sub-item/dependency setup).
// 수식 편집기: the formula checked against a data source, with the first rows' results.
export const formulaPreviewSchema = z.object({ sourceId: id, formula: z.string().max(20000), propertyId: id.optional(), limit: z.number().int().min(1).max(10).optional() }).strict();
export const tasksSchema = z.object({ includeDone: z.boolean().optional(), assignee: z.string().max(200).nullable().optional(), sourceId: id.nullable().optional(), limit: z.number().int().positive().max(1000).optional() }).strict();
export const commandSchema = z.object({
  id, actor: z.string().min(1), expectedRevision: z.number().int().nonnegative(),
  operations: z.array(operationSchema).min(1).max(500), runId: id.optional(),
}).strict();
export const recoverySchema = z.object({
  id, actor: z.string().min(1), expectedRevision: z.number().int().nonnegative(), targetCommandId: id,
}).strict();
export const runLogSchema = z.object({ id: id.optional(), runId: id, message: z.string().max(100000), changedIds: z.array(id).default([]) }).strict();
export const runPageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().nonnegative().default(0) }).strict();
export class WorkspaceError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'WorkspaceError'; this.code = code; this.details = details; }
}
export function requireThat(condition, code, message, details) {
  if (!condition) throw new WorkspaceError(code, message, details);
}
