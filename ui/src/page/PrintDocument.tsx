import { t } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../data/store';
import type { PageEntity } from '../data/types';
import { PageView } from './PageView';

// "PDF로 내보내기" (include content, page format, scale, include subpages): the pages are
// laid out in a window of their own with print styles, and the browser's print dialog saves the PDF ("PDF로 저장"),
// so nothing is sent anywhere. Address: /?print=<page>&sub=1&files=0&size=A4&scale=90. With noprint=1 (the PDF files
// the app makes through a headless browser, src/pdf-export.mjs) nothing opens the dialog; data-print-state says when a
// page is drawn, and window.pageyardPrintPage(id) shows another page in place, so the app loads once for many PDFs.
export const printSizes = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'] as const;
export type PrintSize = typeof printSizes[number];

export interface PrintOptions { subpages: boolean; files: boolean; size: PrintSize; scale: number }

export function printUrl(pageId: string, options: PrintOptions) {
  const params = new URLSearchParams({ print: pageId, sub: options.subpages ? '1' : '0', files: options.files ? '1' : '0', size: options.size, scale: String(Math.round(options.scale)) });
  return `/?${params.toString()}`;
}

export function openPrint(pageId: string, options: PrintOptions) {
  window.open(printUrl(pageId, options), '_blank');
}

export function isPrintAddress() {
  return new URLSearchParams(location.search).has('print');
}

export function PrintDocument() {
  const ws = useWorkspace();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [rootId, setRootId] = useState(params.get('print') ?? '');
  const subpages = params.get('sub') === '1', files = params.get('files') !== '0';
  const size = (printSizes as readonly string[]).includes(params.get('size') ?? '') ? params.get('size')! : 'A4';
  const scale = Math.max(25, Math.min(200, Number(params.get('scale')) || 100));
  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    if (params.get('noprint') !== '1') return;
    const switchTo = (id: string) => { setPrinted(false); setRootId(id); };
    (window as unknown as { pageyardPrintPage?: (id: string) => void }).pageyardPrintPage = switchTo;
  }, [params]);

  // The page, then (when asked) every page under it, depth first, as the sidebar lists them.
  const pages = useMemo(() => {
    if (!ws.loaded) return [];
    const root = ws.get<PageEntity>(rootId);
    if (!root || root.kind !== 'page' || !ws.visible(root.id)) return [];
    const out: PageEntity[] = [root];
    const visit = (id: string) => {
      for (const child of ws.children(id)) {
        if (child.kind !== 'page' || (child as PageEntity).template || !ws.visible(child.id)) continue;
        out.push(child as PageEntity);
        visit(child.id);
      }
    };
    if (subpages) visit(root.id);
    return out;
  }, [ws.loaded, ws.revision, rootId, subpages]);

  useEffect(() => {
    if (pages[0]) document.title = pages[0].title || t("제목 없음");
  }, [pages]);

  // Print once the pages (and their pictures and equations) have been drawn; close the window afterwards.
  useEffect(() => {
    if (!pages.length || printed) return;
    let cancelled = false;
    const run = async () => {
      await new Promise(resolve => setTimeout(resolve, params.get('noprint') === '1' ? 500 : 900));
      const images = [...document.querySelectorAll<HTMLImageElement>('.print-document img')].filter(image => !image.complete);
      await Promise.race([Promise.all(images.map(image => new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); }))), new Promise(resolve => setTimeout(resolve, 4000))]);
      await document.fonts?.ready;
      if (cancelled) return;
      setPrinted(true);
      window.addEventListener('afterprint', () => { if (params.get('stay') !== '1') window.close(); }, { once: true });
      if (params.get('noprint') !== '1') window.print();
    };
    run();
    return () => { cancelled = true; };
  }, [pages, printed, params, rootId]);

  if (!ws.loaded) return <div className="print-loading" data-print-state="loading" data-page-id={rootId}>{t("불러오는 중…")}</div>;
  if (!pages.length) return <div className="print-loading" data-print-state="missing" data-page-id={rootId}>{t("이 페이지를 찾을 수 없습니다")}</div>;
  return (
    <>
      <style>{`@page { size: ${size}; margin: 16mm 14mm; }`}</style>
      <div className={`print-document${files ? '' : ' no-files'}`} style={{ zoom: scale / 100 }} data-printed={printed ? 'true' : undefined} data-print-state={printed ? 'ready' : 'drawing'} data-page-id={rootId}>
        {pages.map(page => <section key={page.id} className="print-page" data-page-id={page.id}><PageView page={page} variant="print" /></section>)}
      </div>
    </>
  );
}
