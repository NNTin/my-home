// Sakuga icons: the HUD's ink-line icons (my-home, docs/design/hud.md §3.2). Not from upstream.
// Each is drawn in the art style: one flat light tone (the paper, --sk-card), one flat shadow tone (--sk-soft, offset down and
// right like the cards' hard shadow) and an ink line (currentColor). No gradients, no emoji.
//
// One file, no dependencies, loaded after a component file (it needs window.SakugaFX). Then SakugaFX.icon('walk') is the
// SVG markup of an icon (aria-hidden: the control that holds it has the name), SakugaFX.icons the names. The app's build puts it
// in sakuga-hud with the elements.
(() => {
'use strict';
const fx = window.SakugaFX; if (!fx || fx.icon) return;
// [shape, line]: the shape gets the paper and the shadow, the line is ink only. Drawn on a 24 px grid.
const circle = (x, y, r) => `M${x + r} ${y}a${r} ${r} 0 1 1-${2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0Z`;
const I = {
  walk: [circle(14.5, 4.6, 2.2), 'M13 8.6l-2.3 5.2 3.2 2.6-1.1 4.6M13 8.6l2.2 4.6 3.2 1.1M10.7 13.8l-1.5 2.4-3.4.9M13.9 16.4l2.8 4.1M13 8.6l-3.6 1.6-1.6 3'],
  photos: ['M3.5 8h13v11.5h-13Z', 'M7 8V4.5h13.5V16H16.5M3.5 17l4-4 3 3 2-2 4 4M12.5 11.2v.1'],
  catalogue: ['M5 4h11.5a2.5 2.5 0 0 1 2.5 2.5V20H7.5A2.5 2.5 0 0 1 5 17.5Z', 'M5 17.5A2.5 2.5 0 0 1 7.5 15H19M9 8h6M9 11h4'],
  edit: ['M15.5 3.8l4.7 4.7L9 19.7l-5.6 1 1-5.6Z', 'M13.2 6.1l4.7 4.7M4.4 15.1l4.5 4.5'],
  view: ['M2.5 12C5.3 7.2 8.4 5 12 5s6.7 2.2 9.5 7c-2.8 4.8-5.9 7-9.5 7s-6.7-2.2-9.5-7Z', circle(12, 12, 3.2) + 'M12 11v.1'],
  furniture: ['M3.5 11a2 2 0 0 1 4 0v2h9v-2a2 2 0 0 1 4 0v7h-17Z', 'M6 11V7.5A2.5 2.5 0 0 1 8.5 5h7A2.5 2.5 0 0 1 18 7.5V11M5.5 18v2.5M18.5 18v2.5M7.5 15h9'],
  requests: ['M4 4.5h16v11.5h-8.5l-4.5 4v-4H4Z', 'M9.8 8.6a2.3 2.3 0 1 1 3.3 2c-.7.4-1.1.9-1.1 1.7M12 14.2v.1'],
  reset: ['M3.5 3.8v5.7h5.7Z', 'M5.2 8.5a7.8 7.8 0 1 1-.9 6.2'],
  'rotate-left': ['M3 4.5l1.2 6 5.6-2.6Z', 'M6.4 9a7.5 7.5 0 1 1 .2 8.3'],
  'rotate-right': ['M21 4.5l-1.2 6-5.6-2.6Z', 'M17.6 9a7.5 7.5 0 1 0-.2 8.3'],
  up: ['M12 4.5l8 13.5H4Z', ''],
  down: ['M12 19.5L20 6H4Z', ''],
  'chevron-up': ['', 'M5.5 15l6.5-6.5 6.5 6.5'],
  'chevron-down': ['', 'M5.5 9l6.5 6.5L18.5 9'],
  'chevron-left': ['', 'M15 5.5L8.5 12l6.5 6.5'],
  'chevron-right': ['', 'M9 5.5l6.5 6.5L9 18.5'],
  duplicate: ['M8.5 8.5h11v11h-11Z', 'M5 15.5V4.5h11M14 11.5v5M11.5 14h5'],
  delete: ['M5.8 7h12.4l-1.1 13.5H6.9Z', 'M3.8 7h16.4M9 7V4h6v3M10 10.5v6.5M14 10.5v6.5'],
  info: [circle(12, 12, 9), 'M12 11v6M12 7.6v.1'],
  more: [circle(5.5, 12, 1.9) + circle(12, 12, 1.9) + circle(18.5, 12, 1.9), ''],
  tools: ['M21 5.5a5.5 5.5 0 0 1-7.2 7.2l-8.4 8.4a2.4 2.4 0 0 1-3.4-3.4l8.4-8.4A5.5 5.5 0 0 1 17.6 2l-3.3 3.3.7 2.6 2.6.7Z', 'M21 5.5a5.5 5.5 0 0 1-7.2 7.2l-8.4 8.4a2.4 2.4 0 0 1-3.4-3.4l8.4-8.4A5.5 5.5 0 0 1 17.6 2l-3.3 3.3.7 2.6 2.6.7Z'],
  close: ['', 'M6 6l12 12M18 6L6 18'],
  camera: ['M3 8h4.2l1.9-3h5.8l1.9 3H21v11.5H3Z', circle(12, 13.2, 3.6) + 'M17.8 10.6v.1'],
  gallery: ['M3 5h18v14H3Z', 'M3 16l5-5 4.5 4.5 3-3L21 18M16 8.8v.1'],
  map: ['M3 6.2l6-2.2 6 2.2 6-2.2v13.8l-6 2.2-6-2.2-6 2.2Z', 'M9 4v13.8M15 6.2V20'],
  expand: ['', 'M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5'],
  collapse: ['', 'M13.5 4.5v6h6M20 4l-6.5 6.5M10.5 19.5v-6h-6M4 20l6.5-6.5'],
};
const svg = ([shape, line]) => '<svg class="sk-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + (shape ? `<path d="${shape}" fill="var(--sk-soft, #b8b3ff)" stroke="none" transform="translate(1.4 1.6)"/><path d="${shape}" fill="var(--sk-card, #fff)"/>` : '')
  + (line ? `<path d="${line}"/>` : '') + '</svg>';
const made = {};
fx.icons = Object.keys(I);
fx.icon = (name) => (I[name] ? (made[name] ||= svg(I[name])) : '');
})();
