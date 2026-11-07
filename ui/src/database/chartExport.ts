import { t } from '../i18n';
// "다른 이름으로 차트 저장…": the chart as it is drawn, saved as a PNG (twice the size) or an SVG. Text styles come
// from the stylesheet, so they are copied onto the elements of a standalone copy first.
const styleProps = ['font-size', 'font-weight', 'font-family', 'fill', 'stroke', 'opacity'];

export type ChartBackground = 'white' | 'none' | 'dark';
const backgroundFill: Record<ChartBackground, string | null> = { white: '#ffffff', none: null, dark: '#191919' };

function standalone(svg: SVGSVGElement, background: ChartBackground = 'white'): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll('*')];
  const target = [copy, ...copy.querySelectorAll('*')];
  source.forEach((element, index) => {
    if (!(element instanceof SVGTextElement)) return;
    const style = getComputedStyle(element);
    for (const property of styleProps) (target[index] as SVGElement).setAttribute(property, style.getPropertyValue(property));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(svg.clientWidth));
  copy.setAttribute('height', String(svg.clientHeight));
  const fill = backgroundFill[background];
  if (fill) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', fill);
    copy.insertBefore(rect, copy.firstChild);
  }
  // On a dark background the text turns light, as on the dark page.
  if (background === 'dark') for (const text of copy.querySelectorAll('text')) if (text.getAttribute('fill') && /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.test(text.getAttribute('fill')!)) { const [r, g, b] = text.getAttribute('fill')!.match(/\d+/g)!.map(Number); if (r + g + b < 384) text.setAttribute('fill', 'rgba(255,255,255,0.81)'); }
  return new XMLSerializer().serializeToString(copy);
}

function download(href: string, name: string) {
  const link = document.createElement('a');
  link.href = href; link.download = name;
  document.body.append(link); link.click(); link.remove();
}

async function pngBlob(svg: SVGSVGElement, background: ChartBackground): Promise<Blob> {
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(standalone(svg, background))))}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(t("차트를 그림으로 바꾸지 못했습니다."))); image.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = svg.clientWidth * 2; canvas.height = svg.clientHeight * 2;
  const context = canvas.getContext('2d')!;
  context.scale(2, 2);
  context.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t("차트를 그림으로 바꾸지 못했습니다."))), 'image/png'));
}

export async function saveChart(svg: SVGSVGElement | null, name: string, format: 'png' | 'svg', background: ChartBackground = 'white') {
  if (!svg) throw new Error(t("저장할 차트가 없습니다."));
  const file = `${name || t("차트")}.${format}`;
  if (format === 'svg') { download(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(standalone(svg, background))))}`, file); return; }
  const blob = await pngBlob(svg, background);
  const href = URL.createObjectURL(blob);
  download(href, file);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// "PNG로 복사": the picture onto the clipboard (the browser asks for permission the first time).
export async function copyChart(svg: SVGSVGElement | null, background: ChartBackground = 'white') {
  if (!svg) throw new Error(t("저장할 차트가 없습니다."));
  const blob = await pngBlob(svg, background);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
