import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '../ui/overlay';
import { Menu } from '../ui/Menu';
import { Icon } from '../ui/Icon';

// The keyboard shortcuts window: 960×700, centred, r12, modal shadow. Title 32/700 (line 48) from 24/32; a row of
// pill tabs (32 high, r16, 14px, the section in view filled rgba(33,27,23,.05)) at y 88 with a search button at the
// right end that opens a search field; the list scrolls from y 136: section heads 24/600 (line 36, 8 under), rows 44
// high over a 1px line (label 14px, keys as 20-high r6 caps, 4 apart, filled rgba(55,53,47,.06)), 48 between
// sections. Tabs that don't fit go under "기타…".

type Row = [label: string, keys: string];
interface Section { id: string; tab: string; title: string; icon: string; rows: Row[] }

const sections: Section[] = [
  { id: 'popular', tab: t("인기"), title: t("인기"), icon: 'star', rows: [
    [t("현재 페이지에서 찾기"), 'Cmd F'],
    [t("검색을 열거나 최근에 본 페이지로 이동"), 'Cmd P'],
    [t("선택한 텍스트에 링크 추가"), 'Cmd K'],
    [t("페이지 URL 복사"), 'Cmd L'],
    [t("이전 페이지로 돌아가기"), 'Cmd ['],
    [t("다음 페이지로 이동"), 'Cmd ]'],
    [t("위 항목 미리 보기"), 'Ctrl Shift K'],
    [t("아래 항목 미리 보기"), 'Ctrl Shift J'],
    [t("다크 모드 전환"), 'Cmd Shift L'],
    [t("사이드바 탭 열기"), 'Ctrl 1…6'],
    [t("워크스페이스 전환"), 'Ctrl Shift 1…9'],
  ] },
  { id: 'create', tab: t("작성 및 서식"), title: t("작성 및 서식"), icon: 'pencil', rows: [
    [t("텍스트 줄 삽입"), 'Enter'],
    [t("텍스트 블록 안에서 줄 바꾸기"), 'Shift Enter'],
    [t("댓글 만들기"), 'Cmd Shift M'],
    [t("선택한 텍스트 굵게"), 'Cmd B'],
    [t("선택한 텍스트 기울임꼴"), 'Cmd I'],
    [t("선택한 텍스트에 밑줄"), 'Cmd U'],
    [t("선택한 텍스트에 취소선"), 'Cmd Shift X'],
    [t("선택한 텍스트에 링크 추가"), 'Cmd K'],
    [t("인라인 코드 만들기"), 'Cmd E'],
    [t("선택한 텍스트의 서식 지우기"), 'Cmd Option \\'],
    [t("콘텐츠 들여쓰기"), 'Tab'],
    [t("콘텐츠 내어쓰기"), 'Shift Tab'],
    [t("블록을 다른 유형으로 전환"), 'Cmd Option 0'],
    [t("확대"), 'Cmd ='],
    [t("축소"), 'Cmd -'],
    [t("상위 페이지로 이동"), 'Cmd Shift U'],
    [t("선택한 블록 복제"), 'Cmd D'],
  ] },
  { id: 'edit', tab: t("편집 및 이동"), title: t("편집 및 이동"), icon: 'duplicate', rows: [
    [t("현재 블록 선택"), 'Esc'],
    [t("커서가 있는 블록 선택"), 'Cmd A'],
    [t("공백 문자 넣기"), 'Space'],
    [t("커서를 왼쪽으로 옮기거나 다른 블록 선택"), 'Left'],
    [t("커서를 오른쪽으로 옮기거나 다른 블록 선택"), 'Right'],
    [t("커서를 위로 옮기거나 다른 블록 선택"), 'Up'],
    [t("커서를 아래로 옮기거나 다른 블록 선택"), 'Down'],
    [t("선택한 블록 삭제"), 'Backspace'],
    [t("선택한 콘텐츠 삭제"), 'Delete'],
    [t("선택한 블록 복제"), 'Cmd D'],
    [t("텍스트 줄 삽입"), 'Enter'],
    [t("선택한 블록 편집/변경"), 'Cmd /'],
    [t("선택한 블록을 위로 옮기기"), 'Cmd Shift Up'],
    [t("선택한 블록을 아래로 옮기기"), 'Cmd Shift Down'],
    [t("모든 토글 펼치기/접기"), 'Cmd Option T'],
    [t("선택한 텍스트 강조 표시"), 'Cmd Shift H'],
  ] },
  { id: 'markdown', tab: t("마크다운"), title: t("마크다운 문법"), icon: 'code', rows: [
    [t("굵은 텍스트(**로 감싸기)"), '**text**'],
    [t("기울임꼴 텍스트(*로 감싸기)"), '*text*'],
    [t("인라인 코드(`로 감싸기)"), '`code`'],
    [t("취소선(~로 감싸기)"), '~text~'],
    [t("제목1 만들기"), '# Space'],
    [t("제목2 만들기"), '## Space'],
    [t("제목3 만들기"), '### Space'],
    [t("글머리 기호 목록 만들기"), '- / * / • Space'],
    [t("번호 매기기 목록 만들기"), '1. Space'],
    [t("할 일 체크박스 만들기"), '[] Space'],
    [t("토글 목록 만들기"), '> Space'],
    [t("인용 블록 만들기"), '" Space'],
  ] },
  { id: 'commands', tab: t("명령어"), title: t("명령어"), icon: 'command', rows: [
    [t("페이지 멘션"), '@page'],
    [t("날짜 멘션"), '@date'],
    [t("리마인더 추가"), '@remind'],
    [t("하위 페이지 만들기"), '+sub-page name'],
    [t("다른 위치에 새 페이지 만들기"), '+new page name'],
    [t("페이지 링크"), '+page name'],
    [t("페이지 링크"), '[[page name'],
    [t("하위 페이지 만들기"), '[[sub-page name'],
    [t("다른 위치에 새 페이지 만들기"), '[[new page name'],
  ] },
  { id: 'slash', tab: t("슬래시 명령어"), title: t("슬래시 명령어"), icon: 'slash', rows: [
    [t("텍스트 블록 만들기"), '/text'],
    [t("새 페이지 만들기"), '/page'],
    [t("글머리 기호 목록 만들기"), '/bullet'],
    [t("번호 매기기 목록 만들기"), '/num'],
    [t("할 일 목록 만들기"), '/todo'],
    [t("토글 목록 만들기"), '/toggle'],
    [t("구분선 만들기"), '/div'],
    [t("인용 블록 만들기"), '/quote'],
    [t("제목1 만들기"), '/h1'],
    [t("제목2 만들기"), '/h2'],
    [t("제목3 만들기"), '/h3'],
    [t("페이지 링크 만들기"), '/link'],
    [t("페이지 멘션"), '/mention'],
    [t("날짜 또는 리마인더 추가"), '/date'],
    [t("TeX 수식 추가"), '/equation'],
    [t("이모지 선택기 열기"), '/emoji'],
    [t("이미지 업로드 또는 삽입"), '/image'],
    [t("PDF 업로드"), '/pdf'],
    [t("웹 북마크 만들기"), '/book'],
    [t("동영상 업로드 또는 삽입"), '/video'],
    [t("오디오 업로드 또는 삽입"), '/audio'],
    [t("코드 블록 만들기"), '/code'],
    [t("파일 업로드"), '/file'],
    [t("현재 블록 복제"), '/duplicate'],
    [t("블록을 다른 페이지로 옮기기"), '/moveto'],
    [t("현재 블록 삭제"), '/delete'],
    [t("목차 만들기"), '/toc'],
    [t("버튼 만들기"), '/button'],
    [t("이동 경로 넣기"), '/bread'],
    [t("수식 블록 추가"), '/math'],
  ] },
];

// The first five sections get a tab; the rest sit under "기타…".
const tabCount = 5;

export function ShortcutsWindow({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState(sections[0].id);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [overflow, setOverflow] = useState<Element | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const width = Math.min(960, window.innerWidth - 32), height = Math.min(700, window.innerHeight - 32);
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(() => sections.map(section => ({ ...section, rows: section.rows.filter(([label, keys]) => !needle || label.toLocaleLowerCase().includes(needle) || keys.toLocaleLowerCase().includes(needle)) })).filter(section => section.rows.length), [needle]);
  const visibleTabs = sections.slice(0, searching ? tabCount - 1 : tabCount);
  const moreTabs = sections.slice(visibleTabs.length);

  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);
  // The tab of the section at the top of the list is the filled one.
  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top + 8;
    let id = sections[0].id;
    for (const head of box.querySelectorAll<HTMLElement>('[data-section]')) if (head.getBoundingClientRect().top <= top) id = head.dataset.section!;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) id = shown.at(-1)?.id ?? id;
    setCurrent(id);
  };
  const jump = (id: string) => {
    if (query) setQuery('');
    requestAnimationFrame(() => {
      const box = scrollRef.current;
      const head = box?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (box && head) box.scrollTo({ top: head.offsetTop - box.offsetTop, behavior: 'smooth' });
      setCurrent(id);
    });
  };

  return (
    <Popover anchor={{ x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 }} placement="point" modal onClose={onClose} className="shortcuts-modal" style={{ width, height }} label={t("키보드 단축키")} motion="fade">
      <h1 className="shortcuts-title">{t("키보드 단축키")}</h1>
      <div className="shortcuts-bar">
        {needle ? <span className="shortcuts-bar-space" /> : (
          <div className="shortcuts-tabs" role="tablist">
            {visibleTabs.map(section => (
              <button key={section.id} type="button" role="tab" aria-selected={current === section.id} className={`shortcuts-tab${current === section.id ? ' selected' : ''}`} onClick={() => jump(section.id)}>
                <Icon name={section.icon} size={16} /><span>{section.tab}</span>
              </button>
            ))}
            {moreTabs.length ? <button type="button" className={`shortcuts-tab${moreTabs.some(section => section.id === current) ? ' selected' : ''}`} aria-haspopup="menu" onClick={event => setOverflow(event.currentTarget)}><span>{t("기타…")}</span></button> : null}
          </div>
        )}
        {searching ? (
          <div className="shortcuts-search">
            <Icon name="search" size={16} />
            <input ref={searchRef} value={query} placeholder={t("검색…")} aria-label={t("단축키 검색")} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery(''); } }} />
            <button type="button" className="shortcuts-clear" aria-label={t("입력 지우기")} title={t("입력 지우기")} onMouseDown={event => event.preventDefault()} onClick={() => { if (query) setQuery(''); else setSearching(false); }}><Icon name="close" size={10} /></button>
          </div>
        ) : (
          <button type="button" className="shortcuts-search-button icon-button" aria-label={t("단축키 검색")} title={t("검색")} onClick={() => setSearching(true)}><Icon name="search" size={16} /></button>
        )}
      </div>
      <div className="shortcuts-list" ref={scrollRef} onScroll={onScroll}>
        {shown.length ? shown.map(section => (
          <section key={section.id} className="shortcuts-section">
            <h2 className="shortcuts-section-title" data-section={section.id}>{section.title}</h2>
            {section.rows.map(([label, keys], index) => (
              <div key={`${label}-${index}`} className="shortcuts-row">
                <span className="shortcuts-label">{label}</span>
                <span className="shortcuts-keys">{keys.split(' ').map((key, i) => <code key={i} className="shortcuts-key">{key}</code>)}</span>
              </div>
            ))}
          </section>
        )) : (
          <div className="shortcuts-empty">
            <div className="shortcuts-empty-title">{t("검색 결과 없음")}</div>
            <div className="shortcuts-empty-note">{t("다른 키워드로 검색하거나 위의 카테고리를 둘러보세요.")}</div>
          </div>
        )}
      </div>
      {overflow ? <Menu anchor={overflow} placement="below-start" width={200} onClose={() => setOverflow(null)} entries={moreTabs.map(section => ({ label: section.tab, icon: section.icon, onSelect: () => jump(section.id) }))} label={t("기타 단축키")} /> : null}
    </Popover>
  );
}
