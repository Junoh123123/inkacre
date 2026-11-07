// Mermaid diagrams for code blocks in the "mermaid" language (코드: Mermaid). The library (web/vendor,
// MIT) runs in a hidden frame of its own (/mermaid-frame.html) because the app's page refuses the inline
// styles Mermaid uses while laying a diagram out. The SVG it sends back is rebuilt here: its <style>
// becomes a constructed style sheet and every style attribute is applied through the CSSOM.
type Result = { svg?: string; css?: string; styles?: string[]; error?: string };
type Pending = { resolve: (value: Result) => void };
let frame: Promise<Window> | null = null;
const pending = new Map<number, Pending>();
function mermaidFrame(): Promise<Window> {
  frame ??= new Promise((resolve, reject) => {
    const element = document.createElement('iframe');
    element.src = '/mermaid-frame.html';
    element.title = 'Mermaid';
    element.setAttribute('aria-hidden', 'true');
    element.tabIndex = -1;
    element.className = 'mermaid-frame';
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== element.contentWindow) return;
      if (event.data?.type === 'mermaid-ready') resolve(element.contentWindow!);
      if (event.data?.type === 'mermaid-result') { pending.get(event.data.id)?.resolve(event.data); pending.delete(event.data.id); }
    };
    window.addEventListener('message', onMessage);
    element.onerror = () => { frame = null; reject(new Error('mermaid')); };
    window.setTimeout(() => reject(new Error('mermaid')), 20000);
    document.body.append(element);
  });
  return frame;
}

const sheets = new Map<string, CSSStyleSheet>();
function adoptStyles(id: string, css: string) {
  let sheet = sheets.get(id);
  if (!sheet) { sheet = new CSSStyleSheet(); sheets.set(id, sheet); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
  try { sheet.replaceSync(css); } catch { /* ignore a rule the browser cannot read */ }
}
export function releaseStyles(id: string) {
  const sheet = sheets.get(id);
  if (!sheet) return;
  sheets.delete(id);
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet);
}

function safeSvg(markup: string, css: string, styles: string[], id: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement as unknown as SVGSVGElement;
  if (!root || root.nodeName !== 'svg') return null;
  root.querySelectorAll('script, style').forEach(node => node.remove());
  const svg = document.importNode(root, true);
  for (const element of [svg, ...svg.querySelectorAll('[data-mermaid-style]')] as Array<SVGElement | HTMLElement>) {
    const index = Number(element.getAttribute('data-mermaid-style'));
    if (element.hasAttribute('data-mermaid-style') && !Number.isNaN(index)) element.style.cssText = styles[index] ?? '';
    element.removeAttribute('data-mermaid-style');
  }
  adoptStyles(id, css);
  return svg;
}

let counter = 0;
const fontFamily = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
export async function renderMermaid(code: string, dark: boolean): Promise<{ svg: SVGSVGElement | null; id: string; error?: string }> {
  const target = await mermaidFrame();
  const number = ++counter;
  const id = `mermaid-diagram-${number}`;
  const result = await new Promise<Result>(resolve => {
    pending.set(number, { resolve });
    target.postMessage({ type: 'mermaid-render', id: number, code, dark, font: fontFamily }, location.origin);
  });
  if (!result.svg) return { svg: null, id, error: result.error };
  return { svg: safeSvg(result.svg, result.css ?? '', result.styles ?? [], id), id };
}

// Saves the diagram as a JPEG (white or dark page colour behind it).
export async function downloadDiagram(svg: SVGSVGElement, name: string, dark: boolean) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width)), height = Math.max(1, Math.round(box.height));
  clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height));
  const sources = [svg, ...svg.querySelectorAll('*')];
  [clone, ...clone.querySelectorAll('*')].forEach((element, index) => {
    const css = (sources[index] as SVGElement | undefined)?.style?.cssText;
    if (css) element.setAttribute('style', css);
  });
  // Carry the adopted rules into the file so the picture keeps its look.
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = [...sheets.values()].map(sheet => [...sheet.cssRules].map(rule => rule.cssText).join('\n')).join('\n');
  clone.prepend(style);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = dark ? '#191919' : '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/jpeg', 0.92);
  link.download = `${name || 'diagram'}.jpg`;
  link.click();
}
