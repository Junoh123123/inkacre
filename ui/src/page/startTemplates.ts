import { t } from '../i18n';
import { apply, newId } from '../data/commands';
import type { Operation, PageEntity } from '../data/types';

// "템플릿" under an empty page: a few page outlines to start from (title and icon too when the page has none).
type Line = [blockType: string, text?: string];
export interface StartTemplate { id: string; name: string; icon: string; lines: Line[] }
const h = (text: string): Line => ['heading2', text];
export const startTemplates: StartTemplate[] = [
  { id: 'meeting', name: t("회의록"), icon: '📝', lines: [h(t("참석자")), ['bullet'], h(t("안건")), ['numbered'], h(t("논의 내용")), ['paragraph'], h(t("결정 사항")), ['bullet'], h(t("할 일")), ['todo']] },
  { id: 'todo', name: t("할 일 목록"), icon: '✅', lines: [h(t("오늘")), ['todo'], ['todo'], ['todo'], h(t("이번 주")), ['todo'], ['todo']] },
  { id: 'project', name: t("프로젝트 계획"), icon: '🗂️', lines: [['quote', t("이 프로젝트를 한 문장으로 설명하세요.")], h(t("목표")), ['bullet'], h(t("scope|범위")), ['bullet'], h(t("일정")), ['numbered'], h(t("위험 요소")), ['bullet']] },
  { id: 'week', name: t("주간 계획"), icon: '📅', lines: [t("월요일"), t("화요일"), t("수요일"), t("목요일"), t("금요일"), t("토요일"), t("일요일")].flatMap(day => [['heading3', day], ['todo']] as Line[]) },
  { id: 'journal', name: t("일기"), icon: '📓', lines: [h(t("오늘의 기록")), ['paragraph'], h(t("감사한 일")), ['bullet'], h(t("내일 할 일")), ['todo']] },
];

export function applyStartTemplate(page: PageEntity, template: StartTemplate) {
  const operations: Operation[] = [];
  if (!page.title || !page.icon) operations.push({ type: 'page.update', id: page.id, ...(page.title ? {} : { title: template.name }), ...(page.icon ? {} : { icon: template.icon }) });
  for (const [blockType, text] of template.lines) operations.push({ type: 'block.create', id: newId(), parentId: page.id, blockType, richText: text ? [{ text }] : [] });
  return apply(operations);
}
