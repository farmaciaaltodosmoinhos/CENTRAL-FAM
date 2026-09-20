/** utils.js — funções puras e reutilizáveis, sem efeitos secundários. */

export function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

export function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowTs() { return Date.now(); }

export function relTime(ts) {
  if (!ts) return "nunca";
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  const mo = Math.floor(d / 30);
  return mo > 1 ? `há ${mo} meses` : `há ${mo} mês`;
}

export function highlight(text, query) {
  const safe = escapeHtml(text || "");
  if (!query) return safe;
  try {
    const re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    return safe.replace(re, "<mark>$1</mark>");
  } catch (e) { return safe; }
}

export function matchesQuery(servico, categoriaNome, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystacks = [servico.nome, servico.descricao, categoriaNome, (servico.tags || []).join(" ")];
  return haystacks.some(h => (h || "").toLowerCase().includes(q));
}

export function normalizeUrl(u) {
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) return "https://" + u;
  return u;
}

/** Congela profundamente um objeto/array para garantir imutabilidade do estado. */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.getOwnPropertyNames(obj).forEach(key => deepFreeze(obj[key]));
  return Object.freeze(obj);
}

/** Devolve branco ou o tom escuro de texto da app consoante o contraste com `hex`. */
export function readableTextColor(hex, dark = "#173226", light = "#ffffff") {
  if (!hex) return dark;
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return dark;
  // luminância relativa (WCAG simplificada)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? dark : light;
}

/** Mistura uma cor com branco/preto para obter uma variante mais clara/escura (para gradientes de cartão). */
export function shade(hex, percent) {
  if (!hex) return hex;
  const c = hex.replace("#", "");
  let r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  r = Math.round((t - r) * p) + r;
  g = Math.round((t - g) * p) + g;
  b = Math.round((t - b) * p) + b;
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

export function placeholderImg(nome) {
  const letra = (nome || "?").trim().charAt(0).toUpperCase();
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="85" height="85"><rect width="100%" height="100%" rx="43" fill="%23eef3ea"/><text x="50%" y="56%" font-size="34" text-anchor="middle" fill="%232b7a4b" font-family="sans-serif">${letra}</text></svg>`)}`;
}

/**
 * Decide se uma lista dentro de um painel deve ser reconstruída agora ou
 * adiada. Só adia quando o elemento focado é um campo em que o utilizador
 * está mesmo "a meio" de uma escolha — um campo de texto a ser escrito, ou
 * um seletor de cor nativo aberto — porque reconstruir o DOM nesse momento
 * interrompe a interação (perde o cursor, ou fecha o seletor de cor). Um
 * botão focado (ex.: acabado de clicar em "editar"/"eliminar") NÃO conta,
 * senão a ação parece não ter efeito nenhum.
 *
 * Bugs reais que isto corrige:
 *  1. Eliminar uma categoria não fazia nada visível porque o botão
 *     "eliminar", ainda focado depois do clique + confirm(), era tratado
 *     como "utilizador a editar" e o refresh ficava bloqueado.
 *  2. O seletor de cor de categoria fechava-se sozinho a cada movimento
 *     dentro da roda de cores (ver também a mudança de "input" para
 *     "change" em modals.js — isto é uma proteção adicional para o caso
 *     raro de uma sincronização em fundo terminar enquanto o seletor está
 *     aberto mas ainda por confirmar).
 */
export function deveAdiarRenderizacao(activeElement, container) {
  if (!activeElement || !container || !container.contains(activeElement)) return false;
  if (activeElement.tagName !== "INPUT") return false;
  const tipo = activeElement.type;
  return tipo === "text" || tipo === "" || tipo === "color";
}
