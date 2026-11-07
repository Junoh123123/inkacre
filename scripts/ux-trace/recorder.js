// Motion recorder: input stamps, probe state per frame, running animations and layout shifts, for about a second after an input.
window.__rec2 = (probe, ms = 2500, startTypes = ['pointerdown', 'keydown'], root = '#root') => {
  const out = { trace: [], anims: {}, shifts: [] }; window.__out = out; let t0 = null, last = '';
  const now = () => Math.round(performance.now() - t0);
  const types = [...new Set(['pointerdown', 'pointerup', 'click', 'keydown', ...startTypes])];
  const handlers = types.map(type => { const f = e => { if (t0 === null && startTypes.includes(type)) { t0 = performance.now(); out.trace.push([0, 'start:' + type]); } if (t0 !== null && type !== 'pointerover' && type !== 'pointermove') out.trace.push([now(), type + (e.key ? ':' + e.key : '')]); }; window.addEventListener(type, f, true); return [type, f]; });
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (t0 !== null) out.shifts.push([Math.round(e.startTime - t0), +e.value.toFixed(4)]); }).observe({ type: 'layout-shift' }); } catch (e) {}
  window.__startRec = () => { if (t0 === null) { t0 = performance.now(); out.trace.push([0, 'start:manual']); } };
  const start = performance.now();
  const tick = () => {
    const at = performance.now();
    if (t0 === null && at - start > 30000) return;
    let s; try { s = JSON.stringify(probe()); } catch (e) { s = 'ERR ' + e.message; }
    if (s !== last) { out.trace.push([t0 === null ? -1 : now(), s]); last = s; }
    if (t0 !== null) for (const a of document.getAnimations()) {
      if (!a.effect?.target?.closest?.(root)) continue;
      const timing = a.effect?.getTiming?.(); const target = a.effect?.target;
      const cls = target?.className?.baseVal ?? target?.className?.toString?.();
      const key = (a.transitionProperty || a.animationName || 'waapi') + '@' + ((cls || '').split(' ').slice(0, 2).join('.') || target?.tagName || '?');
      if (!out.anims[key]) out.anims[key] = { first: now(), duration: timing?.duration, easing: timing?.easing, delay: timing?.delay };
    }
    if (t0 === null || at - t0 < ms) requestAnimationFrame(tick); else handlers.forEach(([type, f]) => window.removeEventListener(type, f, true));
  };
  requestAnimationFrame(tick); return 'armed';
};
