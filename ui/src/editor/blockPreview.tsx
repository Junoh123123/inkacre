import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../i18n';
import { blockLabels } from '../data/format';
import { renderTex } from './katex';

// The picture in a 전환 item's preview card: a small drawing of that kind of block, made here
// (grey lines stand in for text).

const lines = (count: number, widths = [100, 86, 94, 62]) => Array.from({ length: count }, (_, index) => (
  <span key={index} className="bp-line" style={{ width: `${widths[index % widths.length]}%` }} />
));

function listRows(marker: (index: number) => ReactNode) {
  return [0, 1, 2].map(index => (
    <span key={index} className="bp-row">{marker(index)}<span className="bp-line" style={{ width: `${[78, 64, 70][index]}%` }} /></span>
  ));
}

function heading(size: number, label: string, toggle = false) {
  return (
    <>
      <span className="bp-heading" style={{ fontSize: size }}>{toggle ? <span className="bp-triangle">▸</span> : null}{label}</span>
      {lines(2)}
    </>
  );
}

const descriptions: Record<string, () => string> = {
  paragraph: () => t("preview|일반 텍스트로 바로 글쓰기를 시작합니다"),
  heading1: () => t("preview|큰 섹션 제목"),
  heading2: () => t("preview|중간 섹션 제목"),
  heading3: () => t("preview|작은 섹션 제목"),
  heading4: () => t("preview|작은 섹션 제목"),
  page: () => t("preview|이 페이지 안에 하위 페이지를 넣습니다"),
  bullet: () => t("preview|간단한 글머리 기호 목록을 만듭니다"),
  numbered: () => t("preview|번호 매기기 목록을 만듭니다"),
  todo: () => t("preview|할 일 목록으로 작업을 추적합니다"),
  toggle: () => t("preview|토글로 안의 내용을 숨기거나 보여 줍니다"),
  code: () => t("preview|코드 조각을 입력합니다"),
  quote: () => t("preview|인용문을 입력합니다"),
  callout: () => t("preview|글을 눈에 띄게 합니다"),
  math: () => t("preview|독립된 블록에 수식을 표시합니다"),
  synced: () => t("preview|여러 페이지에서 내용을 동기화합니다"),
  'toggle-h1': () => t("preview|큰 제목 안의 내용을 숨깁니다"),
  'toggle-h2': () => t("preview|중간 제목 안의 내용을 숨깁니다"),
  'toggle-h3': () => t("preview|작은 제목 안의 내용을 숨깁니다"),
  'toggle-h4': () => t("preview|작은 제목 안의 내용을 숨깁니다"),
  // Slash menu items (shown for the item picked with the arrow keys).
  table: () => t("preview|페이지에 간단한 표를 추가합니다"),
  divider: () => t("preview|블록을 눈으로 나눕니다"),
  'link-page': () => t("preview|기존 페이지에 링크합니다"),
  image: () => t("preview|업로드하거나 링크로 넣습니다"),
  file: () => t("preview|업로드하거나 링크로 넣습니다"),
  video: () => t("preview|YouTube, Vimeo에서 넣습니다…"),
  bookmark: () => t("preview|링크를 시각적인 북마크로 저장합니다"),
  'db-table': () => t("preview|새 데이터 소스나 기존 데이터 소스에 표 보기를 추가합니다"),
  'db-board': () => t("preview|칸반 보드 형식의 데이터베이스 보기를 만듭니다"),
  'db-gallery': () => t("preview|갤러리 형식의 데이터베이스 보기를 만듭니다"),
  'db-list': () => t("preview|목록 형식의 데이터베이스 보기를 만듭니다"),
  'db-feed': () => t("preview|피드 형식의 데이터베이스 보기를 만듭니다"),
  'db-dashboard': () => t("preview|대시보드 데이터베이스 보기를 만듭니다"),
  'db-calendar': () => t("preview|캘린더 형식의 데이터베이스 보기를 만듭니다"),
  'db-timeline': () => t("preview|타임라인 형식의 데이터베이스 보기를 만듭니다"),
  'db-map': () => t("preview|지도 형식의 데이터베이스 보기를 만듭니다"),
  'db-chart-bar': () => t("preview|데이터베이스 값으로 세로 막대형 차트를 만듭니다"),
  'db-chart-hbar': () => t("preview|데이터베이스 값으로 가로 막대형 차트를 만듭니다"),
  'db-chart-line': () => t("preview|데이터베이스 값으로 꺾은선형 차트를 만듭니다"),
  'db-chart-donut': () => t("preview|데이터베이스 값으로 도넛형 차트를 만듭니다"),
  'db-chart-number': () => t("preview|데이터베이스 값으로 숫자 차트를 만듭니다"),
  'db-form': () => t("preview|양식을 처음부터 만듭니다"),
  'db-inline': () => t("preview|이 페이지에 인라인 새 데이터베이스를 추가합니다"),
  'db-page': () => t("preview|하위 페이지로 새 데이터베이스를 추가합니다"),
  'db-linked': () => t("preview|이 페이지에 기존 데이터 소스의 보기를 추가합니다"),
  toc: () => t("preview|페이지 개요를 보여 줍니다"),
  button: () => t("preview|한 번 눌러 자동화를 실행합니다"),
  breadcrumb: () => t("preview|현재 페이지의 위치를 보여 줍니다"),
  tabs: () => t("preview|탭으로 내용을 정리합니다"),
  mermaid: () => t("preview|코드를 써서 다이어그램을 만듭니다"),
  'mention-page': () => t("preview|페이지나 데이터 소스를 멘션해 글 속에 넣습니다"),
  reminder: () => t("preview|글에 날짜나 리마인더를 넣습니다"),
  emoji: () => t("preview|글에 넣을 이모지를 찾습니다"),
  equation: () => t("preview|글에 수학 기호를 넣습니다"),
  // Text only (no picture for these).
  audio: () => t("preview|업로드하거나 링크로 넣습니다"),
  html: () => t("preview|HTML 파일을 올립니다"),
};
const textOnly = new Set(['audio', 'html']);

function TeX({ tex }: { tex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current) renderTex(ref.current, tex, false); }, [tex]);
  return <span ref={ref} />;
}

function picture(kind: string): ReactNode {
  const label = (type: string) => (blockLabels as Record<string, string>)[type] ?? '';
  switch (kind) {
    case 'paragraph': return <div className="bp bp-text">{lines(5, [100, 92, 97, 88, 54])}</div>;
    case 'heading1': return <div className="bp">{heading(20, label('heading1'))}</div>;
    case 'heading2': return <div className="bp">{heading(16, label('heading2'))}</div>;
    case 'heading3': return <div className="bp">{heading(13, label('heading3'))}</div>;
    case 'heading4': return <div className="bp">{heading(11.5, label('heading4'))}</div>;
    case 'toggle-h1': return <div className="bp">{heading(18, label('heading1'), true)}</div>;
    case 'toggle-h2': return <div className="bp">{heading(15, label('heading2'), true)}</div>;
    case 'toggle-h3': return <div className="bp">{heading(12.5, label('heading3'), true)}</div>;
    case 'toggle-h4': return <div className="bp">{heading(11.5, label('heading4'), true)}</div>;
    case 'page': return (
      <div className="bp">
        <span className="bp-row bp-page"><svg viewBox="0 0 20 20" width="13" height="13"><path d="M5.5 3.8h6l3 3v9.2c0 .3-.3.6-.6.6H5.5c-.3 0-.6-.3-.6-.6V4.4c0-.3.3-.6.6-.6z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg><span className="bp-page-title">{t("제목 없음")}</span></span>
        {lines(3)}
      </div>
    );
    case 'bullet': return <div className="bp">{listRows(() => <span className="bp-dot" />)}</div>;
    case 'numbered': return <div className="bp">{listRows(index => <span className="bp-number">{index + 1}.</span>)}</div>;
    case 'todo': return <div className="bp">{listRows(index => <span className={`bp-check${index === 0 ? ' done' : ''}`} />)}</div>;
    case 'toggle': return <div className="bp">{listRows(index => <span className="bp-triangle">{index === 0 ? '▾' : '▸'}</span>)}</div>;
    case 'code': return (
      <div className="bp"><div className="bp-code">
        <span><b className="bp-k">function</b> <i className="bp-f">greet</i>(name) {'{'}</span>
        <span>&nbsp;&nbsp;<b className="bp-k">return</b> <i className="bp-s">'hi '</i> + name;</span>
        <span>{'}'}</span>
      </div></div>
    );
    case 'quote': return <div className="bp"><div className="bp-quote">{lines(3)}</div></div>;
    case 'callout': return <div className="bp"><div className="bp-callout"><span className="bp-callout-icon">💡</span><span className="bp-callout-lines">{lines(2)}</span></div></div>;
    case 'math': return <div className="bp bp-math"><TeX tex={'e^{i\\pi} + 1 = 0'} /></div>;
    case 'synced': return <div className="bp"><div className="bp-synced">{lines(2)}</div><div className="bp-synced">{lines(2)}</div></div>;
    case 'table': case 'db-table': case 'db-inline': case 'db-linked': return (
      <div className="bp">{kind !== 'table' ? <span className="bp-heading" style={{ fontSize: 11 }}>{t("새 데이터베이스")}</span> : null}
        <div className="bp-grid">{Array.from({ length: kind === 'table' ? 9 : 12 }, (_, index) => <span key={index} className={`bp-cell${index < 3 ? ' head' : ''}`} />)}</div></div>
    );
    case 'db-page': return <div className="bp"><span className="bp-row bp-page"><svg viewBox="0 0 20 20" width="13" height="13"><rect x="3.5" y="4.5" width="13" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3.5 8.5h13M8.5 8.5v7" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg><span className="bp-page-title">{t("새 데이터베이스")}</span></span>{lines(3)}</div>;
    case 'divider': return <div className="bp">{lines(2)}<span className="bp-divider" />{lines(2)}</div>;
    case 'link-page': return <div className="bp">{lines(1)}<span className="bp-row bp-page"><span className="bp-arrow">↗</span><span className="bp-page-title">{t("제목 없음")}</span></span>{lines(2)}</div>;
    case 'image': return <div className="bp"><div className="bp-image"><span className="bp-sun" /><span className="bp-hill" /></div></div>;
    case 'video': return <div className="bp"><div className="bp-image dark"><span className="bp-play">▶</span></div></div>;
    case 'file': return <div className="bp"><span className="bp-file"><span className="bp-clip">📎</span><span className="bp-line" style={{ width: '60%' }} /></span>{lines(2)}</div>;
    case 'bookmark': return <div className="bp"><div className="bp-bookmark"><span className="bp-bookmark-text">{lines(3, [70, 90, 50])}</span><span className="bp-bookmark-thumb" /></div></div>;
    case 'db-board': return <div className="bp bp-columns bp-board">{[3, 2, 1].map((count, index) => <span key={index} className="bp-column">{Array.from({ length: count }, (_, card) => <span key={card} className="bp-card" />)}</span>)}</div>;
    case 'db-gallery': return <div className="bp"><div className="bp-gallery">{Array.from({ length: 4 }, (_, index) => <span key={index} className="bp-gallery-card"><span className="bp-gallery-cover" /><span className="bp-line" style={{ width: '70%' }} /></span>)}</div></div>;
    case 'db-list': return <div className="bp">{[0, 1, 2, 3].map(index => <span key={index} className="bp-row bp-list-row"><span className="bp-dot square" /><span className="bp-line" style={{ width: `${[64, 52, 70, 46][index]}%` }} /><span className="bp-chip" /></span>)}</div>;
    case 'db-feed': return <div className="bp">{[0, 1].map(index => <div key={index} className="bp-post"><span className="bp-row"><span className="bp-avatar" /><span className="bp-line" style={{ width: '40%' }} /></span>{lines(2, [96, 70])}</div>)}</div>;
    case 'db-dashboard': return <div className="bp"><div className="bp-dashboard"><span className="bp-tile"><b>12</b></span><span className="bp-tile"><span className="bp-mini-bars">{[5, 9, 7, 12].map((h, i) => <i key={i} style={{ height: h * 2 }} />)}</span></span><span className="bp-tile wide">{lines(2)}</span></div></div>;
    case 'db-calendar': return <div className="bp"><div className="bp-calendar">{Array.from({ length: 21 }, (_, index) => <span key={index} className={`bp-day${index === 9 ? ' event' : ''}`} />)}</div></div>;
    case 'db-timeline': return <div className="bp bp-timeline">{[[0, 55], [25, 45], [45, 40], [15, 30]].map(([left, width], index) => <span key={index} className="bp-bar" style={{ marginLeft: `${left}%`, width: `${width}%` }} />)}</div>;
    case 'db-map': return <div className="bp"><div className="bp-map"><span className="bp-pin" style={{ left: '30%', top: '35%' }} /><span className="bp-pin" style={{ left: '62%', top: '55%' }} /></div></div>;
    case 'db-chart-bar': return <div className="bp bp-chart">{[40, 70, 55, 85, 30].map((h, i) => <span key={i} className="bp-vbar" style={{ height: `${h}%` }} />)}</div>;
    case 'db-chart-hbar': return <div className="bp bp-hchart">{[70, 45, 85, 30].map((w, i) => <span key={i} className="bp-hbar" style={{ width: `${w}%` }} />)}</div>;
    case 'db-chart-line': return <div className="bp bp-chart"><svg viewBox="0 0 116 70" className="bp-svg"><polyline points="2,58 26,40 50,46 74,20 98,28 114,10" fill="none" stroke="#2383e2" strokeWidth="2.5" strokeLinejoin="round" /></svg></div>;
    case 'db-chart-donut': return <div className="bp bp-math"><svg viewBox="0 0 40 40" width="64" height="64"><circle cx="20" cy="20" r="14" fill="none" stroke="#e6e5e3" strokeWidth="7" /><circle cx="20" cy="20" r="14" fill="none" stroke="#2383e2" strokeWidth="7" strokeDasharray="55 88" transform="rotate(-90 20 20)" /></svg></div>;
    case 'db-chart-number': return <div className="bp bp-math"><span className="bp-number-big">128</span></div>;
    case 'db-form': return <div className="bp">{[0, 1].map(index => <span key={index} className="bp-field"><span className="bp-line" style={{ width: '35%' }} /><span className="bp-input" /></span>)}<span className="bp-submit" /></div>;
    case 'toc': return <div className="bp">{[0, 1, 1, 0, 1].map((indent, index) => <span key={index} className="bp-line bp-toc" style={{ marginLeft: indent * 10, width: `${[60, 48, 54, 62, 40][index]}%` }} />)}</div>;
    case 'button': return <div className="bp bp-math"><span className="bp-button">{t("버튼")}</span></div>;
    case 'breadcrumb': return <div className="bp"><span className="bp-row bp-crumbs"><span className="bp-line" style={{ width: 22 }} />/<span className="bp-line" style={{ width: 26 }} />/<span className="bp-line" style={{ width: 30 }} /></span>{lines(3)}</div>;
    case 'tabs': return <div className="bp"><div className="bp-tabs"><span className="bp-tab active" /><span className="bp-tab" /><span className="bp-tab" /></div>{lines(3)}</div>;
    case 'mermaid': return <div className="bp bp-math"><svg viewBox="0 0 116 60" className="bp-svg"><rect x="34" y="4" width="48" height="16" rx="2" fill="#eee" stroke="#999" /><rect x="34" y="40" width="48" height="16" rx="2" fill="#eee" stroke="#999" /><path d="M58 20v18m-3-4 3 4 3-4" fill="none" stroke="#666" strokeWidth="1.2" /></svg></div>;
    case 'mention-page': return <div className="bp bp-text"><span className="bp-row"><span className="bp-line" style={{ width: '22%' }} /><span className="bp-mention">↗ {t("제목 없음")}</span><span className="bp-line" style={{ width: '20%' }} /></span>{lines(3)}</div>;
    case 'reminder': return <div className="bp bp-text"><span className="bp-row"><span className="bp-line" style={{ width: '22%' }} /><span className="bp-mention date">@{new Date(2026, 9, 26).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span className="bp-line" style={{ width: '20%' }} /></span>{lines(3)}</div>;
    case 'emoji': return <div className="bp bp-math"><span className="bp-emoji">😀 🎉 👍</span></div>;
    case 'equation': return <div className="bp bp-text"><span className="bp-row"><span className="bp-line" style={{ width: '24%' }} /><span className="bp-inline-math"><TeX tex={'x^2+y^2'} /></span><span className="bp-line" style={{ width: '24%' }} /></span>{lines(3)}</div>;
  }
  const columns = /^columns-(\d)$/.exec(kind);
  if (columns) {
    const count = Number(columns[1]);
    return <div className="bp bp-columns">{Array.from({ length: count }, (_, index) => <span key={index} className="bp-column">{lines(4, [100, 80, 92, 60])}</span>)}</div>;
  }
  return null;
}

export function blockPreview(kind: string): { image?: ReactNode; text: string } | undefined {
  const columns = /^columns-(\d)$/.exec(kind);
  const text = columns ? t("preview|{0}개의 열로 된 블록을 만듭니다", [Number(columns[1])]) : descriptions[kind]?.();
  if (text && textOnly.has(kind)) return { text };
  const image = picture(kind);
  return text && image ? { image, text } : undefined;
}

// A slash item's preview: its block kind (toggle headings and paragraph ids differ from block types).
export function slashPreview(id: string) {
  const base = id.replace(/^suggested-/, '');
  const kind = /^toggle-heading(\d)$/.test(base) ? `toggle-h${base.slice(-1)}` : base;
  return blockPreview(kind);
}
