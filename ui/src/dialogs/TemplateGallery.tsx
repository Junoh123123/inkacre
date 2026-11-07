import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { apply } from '../data/commands';
import { navigate } from '../data/router';
import { report, setStatus } from '../data/store';
import { categoryLabels, galleryTemplates, templateOperations, type GalleryTemplate, type TemplateCategory } from '../data/templateGallery';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/overlay';

// 템플릿 (sidebar): the gallery — categories on the left, the templates as cards with what each one holds, and
// "사용" to make it as a new page (under the current page when asked, otherwise at the top of 개인 페이지).
export function TemplateGallery({ parentId = null, onClose }: { parentId?: string | null; onClose: () => void }) {
  const templates = useMemo(galleryTemplates, []);
  const labels = categoryLabels();
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  // A search looks through every template, whichever category is picked.
  const shown = templates.filter(item => needle ? `${item.name} ${item.description}`.toLowerCase().includes(needle) : category === 'all' || item.category === category);
  const use = (template: GalleryTemplate) => {
    setBusy(template.id);
    const { pageId, operations } = templateOperations(template, parentId);
    apply(operations).then(() => { onClose(); navigate(pageId); setStatus(t("{0} 템플릿으로 페이지를 만들었습니다.", [template.name])); }).catch(report).finally(() => setBusy(null));
  };
  const width = Math.min(960, window.innerWidth - 48), height = Math.min(640, window.innerHeight - 64);
  return (
    <Popover anchor={{ x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 }} placement="point" modal onClose={onClose} className="template-gallery" style={{ width, height }} label={t("템플릿")} motion="fade">
      <nav className="template-gallery-nav" aria-label={t("분류")}>
        <div className="template-gallery-title">{t("템플릿")}</div>
        <div className="settings-search"><Icon name="search" size={14} /><input value={query} placeholder={t("템플릿 검색")} aria-label={t("템플릿 검색")} onChange={event => setQuery(event.target.value)} autoFocus /></div>
        {(['all', ...Object.keys(labels)] as Array<TemplateCategory | 'all'>).map(id => (
          <button type="button" key={id} className={`template-gallery-category${category === id && !needle ? ' active' : ''}`} onClick={() => { setCategory(id); setQuery(''); }}>
            {id === 'all' ? t("모든 템플릿") : labels[id]}<span className="muted">{id === 'all' ? templates.length : templates.filter(item => item.category === id).length}</span>
          </button>
        ))}
      </nav>
      <div className="template-gallery-list">
        {shown.map(template => (
          <article key={template.id} className="template-card" data-template-id={template.id}>
            <div className="template-card-icon" aria-hidden="true">{template.icon}</div>
            <div className="template-card-body">
              <div className="template-card-name">{template.name}</div>
              <div className="template-card-text">{template.description}</div>
              <div className="template-card-category">{labels[template.category]}</div>
            </div>
            <button type="button" className="blue-button small" disabled={!!busy} onClick={() => use(template)}>{busy === template.id ? t("만드는 중…") : t("사용")}</button>
          </article>
        ))}
        {!shown.length ? <div className="settings-empty muted">{t("결과 없음")}</div> : null}
      </div>
    </Popover>
  );
}
