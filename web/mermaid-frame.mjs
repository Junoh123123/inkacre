// Draws Mermaid diagrams for the app in a frame of its own (the app's page refuses inline styles,
// which Mermaid relies on while laying a diagram out). The app posts {id, code, theme, font}; the
// frame answers {id, svg} or {id, error}.
const mermaid = globalThis.mermaid;
let theme = '';
addEventListener('message', async event => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'mermaid-render') return;
  const { id, code, dark, font } = event.data;
  const next = dark ? 'dark' : 'neutral';
  if (next !== theme) { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: next, look: 'classic', fontFamily: font, themeVariables: { fontFamily: font } }); theme = next; }
  try {
    const { svg } = await mermaid.render(`mermaid-diagram-${id}`, code);
    // Inline styles are taken out here (the app's page may not parse them): the style sheet text and
    // each element's style travel beside markup that has none.
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    let css = '';
    for (const style of [...root.querySelectorAll('style')]) { css += style.textContent; style.remove(); }
    const styles = [];
    for (const element of [root, ...root.querySelectorAll('[style]')]) {
      if (!element.hasAttribute('style')) continue;
      styles.push(element.getAttribute('style'));
      element.setAttribute('data-mermaid-style', String(styles.length - 1));
      element.removeAttribute('style');
    }
    event.source.postMessage({ type: 'mermaid-result', id, svg: new XMLSerializer().serializeToString(root), css, styles }, event.origin);
  } catch (error) {
    document.getElementById(`dmermaid-diagram-${id}`)?.remove();
    event.source.postMessage({ type: 'mermaid-result', id, error: String(error?.message ?? error) }, event.origin);
  }
});
parent.postMessage({ type: 'mermaid-ready' }, location.origin);
