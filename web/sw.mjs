const shell = 'pageyard-shell-v38';
const assets = ['/map-layout.mjs','/code-highlight.mjs','/highlight.mjs','/highlight.css',...['javascript','typescript','python','json','sql','xml','css','bash','markdown'].map(n=>`/highlight-languages/${n}.js`),'/fonts/KaTeX_Typewriter-Regular.woff2','/fonts/KaTeX_AMS-Regular.woff2','/fonts/KaTeX_Size3-Regular.woff2','/fonts/KaTeX_Main-Regular.woff2','/fonts/KaTeX_Caligraphic-Bold.woff2','/fonts/KaTeX_SansSerif-Bold.woff2','/fonts/KaTeX_Math-Italic.woff2','/fonts/KaTeX_Size4-Regular.woff2','/fonts/KaTeX_Fraktur-Bold.woff2','/fonts/KaTeX_SansSerif-Italic.woff2','/fonts/KaTeX_Main-Bold.woff2','/fonts/KaTeX_SansSerif-Regular.woff2','/fonts/KaTeX_Main-BoldItalic.woff2','/fonts/KaTeX_Fraktur-Regular.woff2','/fonts/KaTeX_Script-Regular.woff2','/fonts/KaTeX_Math-BoldItalic.woff2','/fonts/KaTeX_Main-Italic.woff2','/fonts/KaTeX_Size1-Regular.woff2','/fonts/KaTeX_Size2-Regular.woff2','/fonts/KaTeX_Caligraphic-Regular.woff2','/', '/classic', '/app/app.js', '/app/app.css', '/app/world-50m.json', '/app/favicon.svg', '/app.mjs', '/table-grid.mjs', '/paste-blocks.mjs', '/katex.mjs', '/katex-contrib/mhchem.mjs', '/katex.min.css', '/mermaid-frame.html', '/mermaid-frame.mjs', '/vendor/mermaid.min.js', '/rich-text.mjs', '/view-layout.mjs', '/style.css'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(shell); await cache.addAll(assets); await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('pageyard-shell-') && name !== shell) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Only the app's own page is a navigation to the shell; a frame (the Mermaid frame) is cached by its path.
  const page = event.request.mode === 'navigate' && event.request.destination !== 'iframe';
  if (!page && !assets.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(shell), key = page ? (url.pathname === '/classic' ? '/classic' : '/') : url.pathname;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch { return await cache.match(key) ?? Response.error(); }
  })());
});
