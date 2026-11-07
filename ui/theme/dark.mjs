// Dark theme for the built stylesheet.
//
// The palette has one set of named colours per theme. Our CSS uses design tokens (dark values
// live in tokens.css) and, in places, literal light colours. This
// build step finds every declaration with a literal colour and adds the same rule under
// `:root[data-theme="dark"]` with the dark pair of that light value in that role
// (background, text/icon, line, shadow). Literals it does not know are left alone.
import postcss from 'postcss';

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

function parse(text) {
  if (text.startsWith('#')) {
    let hex = text.slice(1);
    if (hex.length <= 4) hex = hex.split('').map(c => c + c).join('');
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [...rgb, a];
  }
  const parts = text.replace(/rgba?\(|\)/g, '').split(',').map(part => Number(part.trim()));
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}
const rgba = (r, g, b, a) => (a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`);
const hexa = hex => { const [r, g, b, a] = parse(hex); return rgba(r, g, b, a); };
const key = ([r, g, b, a]) => `${r},${g},${b},${Math.round(a * 1000) / 1000}`;

// Opaque light → dark pairs by role (light value → dark value).
const solid = {
  bg: {
    '255,255,255,1': '#211a2a', // page background (popovers are handled by selector, below)
    '249,248,247,1': '#2e233b', // secondary background (sidebar)
    '251,250,249,1': '#202020', '253,253,253,1': '#202020', '249,249,248,1': '#202020', '247,247,245,1': '#202020', '247,247,247,1': '#232323',
    '247,246,243,1': '#272727', // code block / table header
    '240,239,237,1': '#383836', // tertiary background, grey fills
    '241,241,239,1': '#2f2f2f', '243,243,242,1': '#262626', '244,243,243,1': '#262626', // interactive background
    '230,229,227,1': '#383836', '227,226,224,1': '#383836', '211,209,203,1': '#5f5e59', '212,211,207,1': '#5f5e59',
    '44,44,43,1': '#2c2c2b', '0,0,0,1': '#000000', '50,48,44,1': '#e6e5e3',
    // block / tag backgrounds per colour
    '252,233,231,1': '#502c29', '251,235,222,1': '#53361f', '250,233,241,1': '#4e2b3c', '249,243,220,1': '#504425', '245,237,233,1': '#45362d',
    '243,235,249,1': '#3c2d47', '232,241,236,1': '#263d30', '229,242,252,1': '#233850', '243,249,253,1': '#1a2027', '253,246,246,1': '#241d1d',
    '253,236,234,1': '#502c29', '253,245,221,1': '#504425', '238,243,246,1': '#1a2027',
  },
  text: {
    '44,44,43,1': '#f0efed', '55,53,47,1': '#f0efed', '73,72,70,1': '#f0efed', '95,94,89,1': '#bcbab6', '125,122,117,1': '#ada9a3',
    '161,158,153,1': '#7d7a75', '142,139,134,1': '#ada9a3', '173,169,163,1': '#7d7a75', '188,186,182,1': '#5f5e59', '145,145,142,1': '#9b9b9b',
    '56,56,54,1': '#e6e5e3', '50,48,44,1': '#e6e5e3', '0,0,0,1': '#ffffff', '120,119,116,1': '#ada9a3', '153,153,153,1': '#7d7a75',
    '174,172,166,1': '#7d7a75', '184,181,174,1': '#7d7a75', '230,229,227,1': '#383836',
    // tag text per colour
    '109,53,49,1': '#fce9e7', '104,53,78,1': '#fae9f1', '101,81,33,1': '#f9f3dc', '106,66,34,1': '#fbebde', '111,65,32,1': '#fbebde',
    '88,68,55,1': '#f5ede9', '92,65,48,1': '#f5ede9', '85,59,105,1': '#f3ebf9', '86,60,104,1': '#f3ebf9', '42,83,60,1': '#e8f1ec', '38,74,114,1': '#e5f2fc',
    // coloured text that the dark theme lightens
    '203,148,52,1': '#cb9434',
  },
  line: {
    '243,221,203,1': '#5c3b23', '230,229,227,1': '#383836', '240,239,237,1': '#2c2c2b', '211,209,203,1': '#5f5e59', '212,211,207,1': '#5f5e59', '227,226,224,1': '#383836',
    '255,255,255,1': '#191919', '249,248,247,1': '#202020',
  },
};
solid.bg['173,169,163,1'] = '#5f5e59'; // table grip
solid.bg['120,119,116,1'] = '#7d7a75';
// Additions for the card-layout art, feed and form styles.
solid.bg['235,234,232,1'] = '#383836'; // art lines, compact preview bars
solid.bg['241,240,239,1'] = '#2f2f2f'; // feed reaction hover
solid.text['95,94,91,1'] = '#bcbab6'; // secondary dark grey text (feed ⋯, form notes, map pin)
solid.text['211,209,203,1'] = '#5f5e59'; // form placeholder
// The form cards' blue ring (and the layout editor's section rings).
solid.line['182,212,243,1'] = '#355f8b';
solid.bg['182,212,243,1'] = '#355f8b';

// Alpha "ink" colours (the light theme darkens with a brownish black at low opacity). The dark
// theme lightens with near-white instead; pairs: .03 → .03, .051 → .055, .07 → .082,
// .1 → .13, .11 (line) → .1, .19 → .306, .286 (text) → .306.
function inkTo(a, role) {
  if (role === 'line') return a <= 0.08 ? rgba(255, 255, 243, 0.082) : a <= 0.13 ? rgba(255, 255, 235, 0.1) : rgba(255, 252, 235, 0.306);
  if (role === 'text') return rgba(255, 252, 235, Math.min(0.6, a <= 0.3 ? 0.306 : a * 0.75));
  if (a <= 0.035) return rgba(252, 252, 252, 0.03);
  if (a <= 0.06) return rgba(255, 255, 255, 0.055);
  if (a <= 0.09) return rgba(255, 255, 243, 0.082);
  if (a <= 0.12) return rgba(255, 255, 255, 0.094);
  if (a <= 0.17) return rgba(255, 255, 255, 0.13);
  return rgba(255, 252, 235, Math.min(0.5, a * 1.4));
}
const isInk = ([r, g, b]) => Math.max(r, g, b) <= 90 && Math.max(r, g, b) - Math.min(r, g, b) <= 70;

// Coloured translucent fills (tag, column, inline highlight) per family: light → dark.
const tint = {
  '0,118,217,0.204': '#51a6ff7e', '206,24,0,0.165': '#ff746986', '196,88,0,0.204': '#ff8f477b', '183,0,78,0.153': '#ff85c06d', '209,156,0,0.282': '#ffbc3575',
  '127,51,0,0.157': '#ffb8845d', '0,96,38,0.157': '#71ffaf56', '92,0,163,0.14': '#d093ff6d',
  '0,128,213,0.047': '#298bfd10', '3,87,31,0.035': '#53ff8c09', '115,59,3,0.035': '#fd9e650d', '186,72,3,0.043': '#fe8b470b', '207,175,0,0.063': '#ffe8300b',
  '98,3,161,0.031': '#c465fd0d', '161,3,66,0.031': '#ff4e950e', '199,3,3,0.035': '#fb6b6b0c',
  '0,124,215,0.094': '#439bff3d', '223,22,0,0.094': '#ff685c3d', '224,101,1,0.129': '#ff934b47', '211,168,0,0.137': '#ffcd4b3d', '0,100,45,0.09': '#6cffac28',
  '135,131,120,0.302': '#78818766', // switch off (swiTogDesTraBg)
  '242,241,238,0.6': '#ffffff0e', // filter value field
  '139,46,0,0.086': '#ffb18131', '102,0,178,0.078': '#c87dff33', '197,0,93,0.086': '#ff67b13b',
};

function mapColor(text, role, popover, hover = false) {
  const value = parse(text);
  const [r, g, b, a] = value;
  if (role === 'shadow') {
    // Drop shadows get deeper; the 1px outline rings become the dark line colour.
    if (isInk(value) && a < 1) return null; // decided per shadow layer in mapShadow
    return null;
  }
  if (a >= 1) {
    if (role === 'bg' && popover && hover && r >= 240 && g >= 240 && b >= 240) return '#3a2c46'; // lighter on hover
    if (role === 'bg' && popover && r === 255 && g === 255 && b === 255) return '#30243b'; // popover background
    const table = solid[role] ?? {};
    const hit = table[key(value)];
    return hit ? hexa(hit) : null;
  }
  const tinted = tint[key(value)];
  if (tinted) return hexa(tinted);
  if (r === 255 && g === 255 && b === 255) return role === 'bg' ? rgba(25, 25, 25, a) : null; // white glass → dark glass
  if (r === 15 && g === 15 && b === 15) return rgba(15, 15, 15, Math.min(0.8, a + 0.2)); // backdrop (oveSmo .6 → .8)
  if (r === 35 && g === 131 && b === 226) return null; // selection blue is the same in both themes
  if (isInk(value)) return inkTo(a, role);
  return null;
}

// Box shadows: drop layers deepen (.05 → .2, .027 → .118), 1px rings become #383836
// outside and a light ink line inside.
function mapShadow(valueText) {
  let changed = false;
  const layers = valueText.split(/,(?![^(]*\))/).map(layer => {
    const colors = layer.match(COLOR);
    if (!colors) return layer;
    const [r, g, b, a] = parse(colors[0]);
    const ring = /\b0(px)?\s+0(px)?\s+0(px)?\s+[0-9.]+px\b/.test(layer.trim());
    let next = null;
    if (/inset/.test(layer) && isInk([r, g, b]) && a < 0.6) next = rgba(255, 255, 235, 0.1);
    else if (ring && isInk([r, g, b]) && a < 0.3) next = '#383836';
    else if (ring && r === 255 && g === 255 && b === 255) next = '#191919';
    else if (ring && a >= 1 && solid.line[key([r, g, b, a])]) next = hexa(solid.line[key([r, g, b, a])]); // opaque grey rings (form boxes)
    else if (!ring && (r <= 30 && g <= 30 && b <= 30) && a < 1) next = rgba(r, g, b, Math.min(0.64, a * 4));
    if (!next) return layer;
    changed = true;
    return layer.replace(colors[0], next);
  });
  return changed ? layers.join(',') : null;
}

const roleOf = prop => {
  if (/^(background|background-color|background-image)$/.test(prop)) return 'bg';
  if (/^(color|fill|stroke|caret-color|-webkit-text-fill-color|text-decoration-color|accent-color)$/.test(prop)) return 'text';
  if (/^(border|outline|column-rule)/.test(prop) || prop === 'text-decoration') return 'line';
  if (prop === 'box-shadow') return 'shadow';
  return null;
};
const popoverSelector = /popover|menu|dialog|modal|panel|tooltip|toast|picker|card|peek-center|search-modal|inbox|trash|rename|value-|selection-bar|toc-card|calendar-event|sheet|actions|toolbar|tools|controls|timeline-bar/;

export function darkCss(css) {
  const root = postcss.parse(css);
  const out = postcss.root();
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    if (rule.selector.includes('[data-theme')) return;
    // The same in both themes: tooltips (dark bubble) and switch knobs (white).
    // Tooltips keep their own colours; so do the preview pictures in them (the same light picture in
    // both themes).
    if (/tooltip|switch-knob|menu-preview|\.bp(\b|-)/.test(rule.selector)) return;
    const decls = [];
    rule.walkDecls(decl => {
      if (decl.prop.startsWith('--')) return;
      const role = roleOf(decl.prop);
      if (!role || !COLOR.test(decl.value)) { COLOR.lastIndex = 0; return; }
      COLOR.lastIndex = 0;
      let next = null;
      if (role === 'shadow') next = mapShadow(decl.value);
      else {
        let changed = false;
        const popover = popoverSelector.test(rule.selector);
        const value = decl.value.replace(COLOR, match => { const mapped = mapColor(match, role, popover, /:hover/.test(rule.selector)); if (mapped) { changed = true; return mapped; } return match; });
        next = changed ? value : null;
      }
      if (next) decls.push(postcss.decl({ prop: decl.prop, value: next, important: decl.important }));
    });
    if (!decls.length) return;
    const selector = rule.selectors.map(selector => (selector.startsWith(':root') ? selector.replace(':root', ':root[data-theme="dark"]') : `:root[data-theme="dark"] ${selector}`)).join(', ');
    let target = out;
    // Keep media queries around rules that sit in them.
    if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
      target = postcss.atRule({ name: 'media', params: rule.parent.params });
      out.append(target);
    }
    target.append(postcss.rule({ selector, nodes: decls }));
  });
  return out.toString();
}

export function darkThemePlugin() {
  let outDir = '';
  return {
    name: 'dark-theme',
    enforce: 'post',
    configResolved(config) { outDir = config.build.outDir; },
    // After the files are written (the stylesheet is emitted late by Vite's own CSS step).
    async writeBundle(_options, bundle) {
      const { readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      for (const asset of Object.values(bundle)) {
        if (!asset.fileName.endsWith('.css')) continue;
        const file = join(outDir, asset.fileName);
        const source = await readFile(file, 'utf8');
        if (source.includes('/* dark theme (generated')) continue;
        await writeFile(file, `${source}\n/* dark theme (generated by theme/dark.mjs) */\n${darkCss(source)}`);
      }
    },
  };
}

// Lists declarations with literal colours that got no dark pair (for checking new styles).
export function unmapped(css) {
  const root = postcss.parse(css);
  const misses = [];
  root.walkDecls(decl => {
    if (decl.prop.startsWith('--')) return;
    const role = roleOf(decl.prop);
    if (!role || role === 'shadow') return;
    const rule = decl.parent;
    if (!rule?.selector || rule.selector.includes('[data-theme') || /tooltip|switch-knob/.test(rule.selector)) return;
    for (const match of decl.value.match(COLOR) ?? []) {
      if (!mapColor(match, role, popoverSelector.test(rule.selector), /:hover/.test(rule.selector))) misses.push(`${rule.selector.slice(0, 70)} | ${decl.prop}: ${match}`);
    }
  });
  return misses;
}
