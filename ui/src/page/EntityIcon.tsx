import { Icon, viewIcon } from '../ui/Icon';
import { workspace } from '../data/store';
import type { Entity, PageEntity, ViewEntity } from '../data/types';

export function hasBody(page: PageEntity) {
  return workspace.children(page.id).some(child => child.kind === 'block');
}

export function EntityIcon({ item, size = 20, className }: { item: Entity | undefined; size?: number; className?: string }) {
  if (!item) return <Icon name="page" size={size} className={className} />;
  if (item.kind === 'page') {
    const page = item as PageEntity;
    if (page.icon?.startsWith('attachment:')) return <img className={`emoji-icon image${className ? ` ${className}` : ''}`} src={`/api/attachments/${encodeURIComponent(page.icon.slice(11))}`} width={size} height={size} alt="" draggable={false} />;
    if (page.icon?.startsWith('icon:')) {
      const [, name, color = 'gray'] = page.icon.split(':');
      return <span className={`page-icon-glyph color-${color}${className ? ` ${className}` : ''}`}><Icon name={name} size={size} /></span>;
    }
    if (page.icon) return <span className={`emoji-icon${className ? ` ${className}` : ''}`} style={{ fontSize: Math.round(size * 0.86), width: size, height: size, lineHeight: `${size}px` }}>{page.icon}</span>;
    const children = workspace.children(page.id);
    const sources = children.filter(child => child.kind === 'source');
    const holdsDatabase = sources.length === 1 && !hasBody(page) && !children.some(child => child.kind === 'page' && !(child as PageEntity).sourceId) && Math.abs(Date.parse(sources[0].createdAt) - Date.parse(page.createdAt)) < 5000;
    return <Icon name={holdsDatabase ? 'database' : hasBody(page) ? 'page-filled' : 'page'} size={size} className={className} />;
  }
  if (item.kind === 'source') return <Icon name="database" size={size} className={className} />;
  if (item.kind === 'view') return <Icon name={viewIcon[(item as ViewEntity).viewType] ?? 'table'} size={size} className={className} />;
  return <Icon name="page" size={size} className={className} />;
}
