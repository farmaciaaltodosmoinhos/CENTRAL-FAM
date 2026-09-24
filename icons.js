/**
 * icons.js — pequeno conjunto de ícones SVG desenhados de raiz (linhas
 * simples, stroke currentColor). Substitui a antiga dependência do
 * Font Awesome via CDN: menos um pedido de rede, zero FOUC de ícones,
 * funciona 100% offline.
 */
const svg = (inner, vb = "0 0 24 24") =>
  `<svg viewBox="${vb}" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  search: svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>'),
  star: svg('<polygon points="12,2.5 15,9.2 22,10 16.7,14.7 18.2,21.5 12,17.9 5.8,21.5 7.3,14.7 2,10 9,9.2"/>'),
  starFilled: svg('<polygon points="12,2.5 15,9.2 22,10 16.7,14.7 18.2,21.5 12,17.9 5.8,21.5 7.3,14.7 2,10 9,9.2" fill="currentColor"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  list: svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>'),
  sliders: svg('<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><polyline points="21 3 21 9 15 9"/>'),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  folder: svg('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5H19.5A1.5 1.5 0 0 1 21 9v8.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>'),
  folderOpen: svg('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9a1 1 0 0 1 .97 1.24l-1.6 6.5a1.5 1.5 0 0 1-1.46 1.14H5.2a1.5 1.5 0 0 1-1.48-1.28z"/>'),
  chevronRight: svg('<polyline points="9 6 15 12 9 18"/>'),
  chevronDown: svg('<polyline points="6 9 12 15 18 9"/>'),
  home: svg('<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9.5a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1V10"/>'),
  layers: svg('<polygon points="12,3 21,8 12,13 3,8"/><polyline points="3,13.5 12,18.5 21,13.5"/>'),
  tag: svg('<path d="M3 11.5V5a1 1 0 0 1 1-1h6.5L21 12.5 12.5 21 3 11.5Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>'),
  trash: svg('<polyline points="4 7 20 7"/><path d="M6 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2"/><path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"/>'),
  edit: svg('<path d="M4 20h4L18.5 9.5a2 2 0 0 0-4-4L4 16z"/>'),
  close: svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
  upload: svg('<path d="M12 16V4"/><polyline points="7 8 12 3 17 8"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>'),
  download: svg('<path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3L16 9.5"/>'),
  alertTriangle: svg('<path d="M12 4 21.5 20h-19z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r="0.7" fill="currentColor" stroke="none"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.6" r="0.8" fill="currentColor" stroke="none"/>'),
  externalLink: svg('<path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V14"/><path d="M14 4h6v6"/><line x1="10.5" y1="13.5" x2="20" y2="4"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/>'),
  bolt: svg('<polygon points="13,2 4,14 11,14 10,22 20,9 13,9"/>'),
  arrowUpRight: svg('<line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/>'),
  capsule: svg('<rect x="3" y="10.5" width="18" height="6.5" rx="3.25" transform="rotate(-32 12 12)"/><line x1="10.7" y1="8.5" x2="13.3" y2="15.5" transform="rotate(-32 12 12)"/>'),
  x: svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.6 6.6l1.7 1.7M17.7 15.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 17.4l1.7-1.7M17.7 8.3l1.7-1.7"/>'),
  crown: svg('<path d="M3 8l4 3 5-6 5 6 4-3-2 11H5z"/>'),
  boxes: svg('<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4"/><line x1="12" y1="11" x2="12" y2="21"/>'),
  chart: svg('<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="12" width="3" height="7"/><rect x="11" y="8" width="3" height="11"/><rect x="16" y="4" width="3" height="15"/>'),
  logout: svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><polyline points="14 8 19 12 14 16"/><line x1="19" y1="12" x2="9" y2="12"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M4.5 7.5h15M4.5 16.5h15"/>'),
  spark: svg('<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3 3M15.4 15.4l3 3M18.4 5.6l-3 3M8.6 15.4l-3 3"/>')
};

export function icon(name, extraClass = "") {
  return `<span class="icon ${extraClass}">${ICONS[name] || ""}</span>`;
}
