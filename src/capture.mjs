// 빠른 기록: one call from anything on this computer (Apple Shortcuts, Raycast, a script, `inkacre capture`) adds a
// line — or a to-do, or a bullet — to a page, or a row to a database by its name and its properties' names. The page
// is the one named (by id or exact title) or the workspace's capture page (설정 › 빠른 기록). It is an ordinary
// command (actor "capture"), so it shows in the change history and undoes like any other change.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireThat } from './contracts.mjs';
import { properties, visible } from './workspace.mjs';
import { computedTypes, convertValue } from './conversion.mjs';

export const captureSchema = z.object({
  text: z.string().max(20000).default(''),
  to: z.string().trim().max(500).optional(),
  as: z.enum(['text', 'todo', 'bullet']).default('text'),
  database: z.string().trim().max(500).optional(),
  title: z.string().max(2000).optional(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  source: z.string().trim().regex(/^[\w .-]{1,40}$/).optional(),
}).strict();

const same = (a, b) => String(a ?? '').trim().toLocaleLowerCase() === String(b ?? '').trim().toLocaleLowerCase();
function unique(list, message) {
  requireThat(list.length > 0, 'CAPTURE_TARGET', message);
  requireThat(list.length === 1, 'CAPTURE_TARGET', '같은 이름이 여러 개입니다. ID로 지정하세요.', { ids: list.map(item => item.id) });
  return list[0];
}

export function planCapture(state, raw) {
  const input = captureSchema.parse(raw);
  const lines = input.text.replaceAll('\r\n', '\n').split('\n');
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const operations = [];
  if (input.database) {
    const sources = [...state.values()].filter(item => item.kind === 'source' && visible(state, item.id));
    const source = unique(sources.filter(item => item.id === input.database).length ? sources.filter(item => item.id === input.database) : sources.filter(item => same(item.name, input.database)), '그 이름의 데이터베이스를 찾을 수 없습니다.');
    const title = input.title ?? lines.shift() ?? '';
    requireThat(title.trim(), 'CAPTURE_EMPTY', '추가할 제목이나 내용을 주세요.');
    const id = randomUUID(), schema = properties(state, source.id);
    operations.push({ type: 'page.create', id, sourceId: source.id, title });
    for (const [name, value] of Object.entries(input.properties ?? {})) {
      const property = unique(schema.filter(item => item.id === name || same(item.name, name)), `${name} 속성을 찾을 수 없습니다.`);
      requireThat(!computedTypes.has(property.type) && !['button', 'title'].includes(property.type), 'CAPTURE_PROPERTY', `${property.name} 속성은 값을 넣을 수 없습니다.`);
      let converted = null;
      if (value !== null && value !== '') {
        if (property.type === 'relation') converted = String(value).split(',').map(name => unique([...state.values()].filter(row => row.kind === 'page' && row.sourceId === property.targetSourceId && visible(state, row.id) && (row.id === name.trim() || same(row.title, name))), `${name} 관계 대상을 유일하게 찾을 수 없습니다.`).id);
        else converted = convertValue(state, { type: 'text' }, property, String(value));
      }
      operations.push({ type: 'value.set', pageId: id, propertyId: property.id, value: converted });
    }
    for (const line of lines) operations.push({ type: 'block.create', id: randomUUID(), parentId: id, blockType: 'paragraph', richText: line ? [{ text: line }] : [] });
    return { operations, pageId: id, title: title.trim(), sourceId: source.id };
  }
  const pages = [...state.values()].filter(item => item.kind === 'page' && !item.template && visible(state, item.id));
  let target;
  if (input.to) target = unique(pages.filter(item => item.id === input.to).length ? pages.filter(item => item.id === input.to) : pages.filter(item => !item.sourceId && same(item.title, input.to)), '그 제목의 페이지를 찾을 수 없습니다.');
  else {
    const chosen = state.get('workspace-settings')?.capturePageId;
    target = pages.find(item => item.id === chosen);
    requireThat(target, 'CAPTURE_TARGET', '기록할 페이지가 없습니다. 설정 › 빠른 기록에서 기본 페이지를 정하거나 to로 페이지를 주세요.');
  }
  requireThat(lines.some(line => line.trim()), 'CAPTURE_EMPTY', '추가할 내용을 주세요.');
  requireThat(lines.length <= 200, 'CAPTURE_LIMIT', '한 번에 200줄까지 추가할 수 있습니다.');
  const blockType = input.as === 'todo' ? 'todo' : input.as === 'bullet' ? 'bullet' : 'paragraph';
  const blockIds = [];
  for (const line of lines) { const id = randomUUID(); blockIds.push(id); operations.push({ type: 'block.create', id, parentId: target.id, blockType, richText: line ? [{ text: line }] : [] }); }
  return { operations, pageId: target.id, title: target.title, blockIds };
}
