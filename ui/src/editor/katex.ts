// KaTeX is served by the app (/katex.mjs) and loaded the first time an equation is drawn.
type Katex = { default: { render: (tex: string, element: HTMLElement, options: Record<string, unknown>) => void } };
let katexModule: Promise<Katex> | null = null;
export function loadKatex() {
  // mhchem (\ce, \pu chemistry) registers its macros on the same KaTeX instance; it imports '../katex.mjs'.
  katexModule ??= (import(/* @vite-ignore */ '/katex.mjs' as string) as Promise<Katex>).then(async module => {
    await import(/* @vite-ignore */ '/katex-contrib/mhchem.mjs' as string).catch(() => undefined);
    return module;
  });
  return katexModule;
}

// Draws TeX into an element (inline or display); on an error the TeX itself is shown, marked.
export function renderTex(target: HTMLElement, tex: string, displayMode: boolean) {
  return loadKatex().then(module => {
    try { module.default.render(tex, target, { displayMode, throwOnError: true, trust: false, maxExpand: 1000, maxSize: 10 }); target.classList.remove('math-error'); }
    catch { target.textContent = tex; target.classList.add('math-error'); }
  }).catch(() => { target.textContent = tex; });
}
