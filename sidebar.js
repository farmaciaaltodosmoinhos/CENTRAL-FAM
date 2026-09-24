import { escapeHtml } from "../utils.js";
import { icon } from "../icons.js";
import { buildCategoryTree, contarServicosNaCategoria, getStats, CATEGORIA_INDEFINIDA_ID } from "../domain.js";
import { t, DEFAULT_IDIOMA } from "../i18n.js";

const expandedIds = new Set();

function nodeIsActive(scope, catId) {
  return (scope.tipo === "categoria" || scope.tipo === "categoria-direta") && scope.categoriaId === catId;
}

function renderNode(node, state, depth = 0, forceOpen = false) {
  const temFilhos = node.filhos && node.filhos.length > 0;
  const expandido = forceOpen || expandedIds.has(node.id);
  const count = contarServicosNaCategoria(state.servicos, state.categorias, node.id, true);
  const active = nodeIsActive(state.scope, node.id);
  return `
    <div class="cat-node" data-catnode="${node.id}">
      <div class="cat-node-row ${active ? "active" : ""}">
        ${temFilhos
          ? `<button class="cat-toggle ${expandido ? "expanded" : ""}" data-toggle="${node.id}">${icon("chevronRight")}</button>`
          : `<span class="cat-toggle spacer">${icon("chevronRight")}</span>`}
        <button class="cat-node-btn" data-select-cat="${node.id}">
          <span class="cat-dot" style="background:${node.cor || "#8a9a90"};"></span>
          <span class="cat-name">${escapeHtml(node.nome)}</span>
          <span class="cat-count">${count}</span>
        </button>
      </div>
      ${temFilhos ? `<div class="cat-children" style="display:${expandido ? "flex" : "none"};">
          ${node.filhos.map(f => renderNode(f, state, depth + 1, forceOpen)).join("")}
        </div>` : ""}
    </div>`;
}

/* Filtra a árvore de categorias pela pesquisa da topbar: mantém um nó se o
   próprio nome corresponde OU se algum descendente corresponde (nesse caso
   os filhos ficam sempre expandidos, para o resultado ser visível). */
function filterTree(nodes, ql) {
  if (!ql) return nodes;
  const walk = (n) => {
    const filhos = (n.filhos || []).map(walk).filter(Boolean);
    const selfMatch = n.nome.toLowerCase().includes(ql);
    if (!selfMatch && !filhos.length) return null;
    return { ...n, filhos };
  };
  return nodes.map(walk).filter(Boolean);
}

const MODULOS = [
  { id: "farma-ia", icon: "spark", label: "FARMA IA" },
  { id: "manipulados", icon: "capsule", label: "Manipulados" },
  { id: "documentos", icon: "folder", label: "Documentos" },
  { id: "gabinete", icon: "boxes", label: "Gestão de Gabinete" },
  { id: "pim", icon: "checkCircle", label: "Gestão de PIM" },
  { id: "aue", icon: "tag", label: "Pedidos AUE" },
  { id: "stocks", icon: "chart", label: "Stocks Errados" }
];
const FERRAMENTAS = [
  { id: "reservas", icon: "list", label: "Reservas" },
  { id: "medela", icon: "edit", label: "Aluguer Medela" },
  { id: "conversor-pdf", icon: "refresh", label: "Conversor de PDF" },
  { id: "devolucao-frio", icon: "alertTriangle", label: "Devolução de Frio" },
  { id: "mapa-cardiovascular", icon: "bolt", label: "Mapa Cardiovascular" },
  { id: "devolucoes-armazenistas", icon: "download", label: "Devoluções a Armazenistas" },
  { id: "catalogo-produtos", icon: "grid", label: "Catálogo de Produtos" }
];

function moduloBtn(item, state, ql) {
  const active = state.scope.tipo === "modulo" && state.scope.modulo === item.id;
  const noMatch = ql && !item.label.toLowerCase().includes(ql) ? "no-match" : "";
  return `<button class="nav-item ${active ? "active" : ""} ${noMatch}" data-modulo="${item.id}">${icon(item.icon)} ${item.label}</button>`;
}

export function renderSidebar(container, state, handlers) {
  const idioma = state.idioma || DEFAULT_IDIOMA;
  const tr = (chave) => t(chave, idioma);
  const stats = getStats(state);
  const ql = (state.searchQuery || "").trim().toLowerCase();
  const tree = filterTree(buildCategoryTree(state.categorias), ql);
  const indefCount = state.servicos.filter(s => (s.categoriaId || CATEGORIA_INDEFINIDA_ID) === CATEGORIA_INDEFINIDA_ID).length;
  const indefMatch = !ql || "categoria indefinida".includes(ql);
  const modulosMatch = !ql || MODULOS.some(m => m.label.toLowerCase().includes(ql));
  const ferramentasMatch = !ql || FERRAMENTAS.some(m => m.label.toLowerCase().includes(ql));
  const modulosHtml = MODULOS.map(m => moduloBtn(m, state, ql)).join("");
  const ferramentasHtml = FERRAMENTAS.map(m => moduloBtn(m, state, ql)).join("");
  const nadaEncontrado = ql && MODULOS.every(m => !m.label.toLowerCase().includes(ql))
    && FERRAMENTAS.every(m => !m.label.toLowerCase().includes(ql))
    && !tree.length && !indefMatch;

  container.innerHTML = `
    <div class="sidebar-head">
      <span>Navegação</span>
      <button class="sidebar-close" data-close-sidebar title="${escapeHtml(tr("nav.fechar_title"))}">${icon("close")}</button>
    </div>

    <div class="brand">
      ${state.logoBase64
        ? `<img class="brand-logo" src="${state.logoBase64}" alt="Logótipo">`
        : `<div class="brand-logo-placeholder">${icon("capsule")}</div>`}
      <div class="brand-text">
        <h1>Central Operacional</h1>
        <p>${escapeHtml(state.nomeFarmacia)}</p>
      </div>
    </div>

    <div>
      <div class="nav-label" style="margin-bottom:8px;">Visão geral</div>
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-value">${stats.total}</div><div class="stat-label">Serviços totais</div></div>
        <div class="stat-tile"><div class="stat-value">${stats.favoritos}</div><div class="stat-label">Favoritos</div></div>
        <div class="stat-tile"><div class="stat-value">${stats.ativos}</div><div class="stat-label">Serviços ativos</div></div>
        <div class="stat-tile"><div class="stat-value">${stats.categoriasEmUso}</div><div class="stat-label">Categorias em uso</div></div>
      </div>
    </div>

    <div class="nav-flat">
      <button class="nav-item ${state.scope.tipo === "home" ? "active" : ""}" data-nav="home">${icon("home")} ${escapeHtml(tr("nav.inicio"))}</button>
      <button class="nav-item ${state.scope.tipo === "favoritos" ? "active" : ""}" data-nav="favoritos">${icon("star")} ${escapeHtml(tr("nav.favoritos"))} <span class="nav-count">${stats.favoritos}</span></button>
      <button class="nav-item ${state.scope.tipo === "tudo" ? "active" : ""}" data-nav="tudo">${icon("layers")} ${escapeHtml(tr("nav.ver_tudo"))} <span class="nav-count">${stats.total}</span></button>
    </div>

    ${nadaEncontrado ? `<p style="font-size:.74rem;color:#a9cdb8;padding:4px;">Sem resultados para "${escapeHtml(state.searchQuery.trim())}" nos módulos, ferramentas ou categorias.</p>` : ""}

    ${modulosMatch ? `<div class="nav-flat">
      <div class="nav-label" style="margin-bottom:4px;">Módulos</div>
      ${modulosHtml}
    </div>` : ""}

    ${ferramentasMatch ? `<div class="nav-flat">
      <div class="nav-label" style="margin-bottom:4px;">Ferramentas</div>
      ${ferramentasHtml}
    </div>` : ""}

    <div class="sidebar-section-categorias">
      <div class="nav-label">
        <span>${escapeHtml(tr("nav.categorias"))}</span>
        <button data-add-cat title="${escapeHtml(tr("nav.nova_categoria_title"))}" style="background:none;border:none;color:#cdeada;">${icon("plus")}</button>
      </div>
      <div class="category-tree" id="categoryTree">
        ${tree.map(n => renderNode(n, state, 0, !!ql)).join("") || `<p style="font-size:.72rem;color:#a9cdb8;padding:6px 4px;">${ql ? escapeHtml(tr("nav.sem_categorias_correspondentes")) : escapeHtml(tr("nav.sem_categorias"))}</p>`}
        ${indefCount > 0 && indefMatch ? `
          <div class="cat-node">
            <div class="cat-node-row ${state.scope.categoriaId === "cat_indefinida" ? "active" : ""}">
              <span class="cat-toggle spacer">${icon("chevronRight")}</span>
              <button class="cat-node-btn" data-select-cat="cat_indefinida">
                <span class="cat-dot" style="background:#8a9a90;"></span>
                <span class="cat-name">Categoria Indefinida</span>
                <span class="cat-count">${indefCount}</span>
              </button>
            </div>
          </div>` : ""}
      </div>
      <button class="ghost-btn" data-add-cat>${icon("plus")} ${escapeHtml(tr("nav.nova_categoria_title"))}</button>
    </div>

    <div class="sidebar-foot">
      <div class="sidebar-sync ${state.syncStatus}">
        <span class="dot"></span>
        <span>${state.syncStatus === "synced" ? escapeHtml(tr("sync.sincronizado")) : state.syncStatus === "syncing" ? escapeHtml(tr("sync.a_sincronizar")) : escapeHtml(tr("sync.erro"))}</span>
      </div>
      <a class="dev-badge" href="tel:+351963257770" title="Contacto: +351 963 257 770">
        <img src="assets/dev-logo.png" alt="Ivo Batalha Software Development" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="dev-icon" style="display:none;">👨‍💻</div>
        <div class="dev-text">
          <small>Desenvolvido por</small>
          <span>Ivo Batalha</span>
          <span class="dev-sub">Software Development</span>
          <span class="dev-contacto">+351 963 257 770</span>
        </div>
      </a>
    </div>
  `;

  container.querySelectorAll("[data-nav]").forEach(btn => btn.addEventListener("click", () => handlers.onNav(btn.dataset.nav)));
  container.querySelectorAll("[data-modulo]").forEach(btn => btn.addEventListener("click", () => handlers.onAbrirModulo(btn.dataset.modulo)));
  container.querySelectorAll("[data-select-cat]").forEach(btn => btn.addEventListener("click", () => handlers.onSelectCategory(btn.dataset.selectCat)));
  container.querySelectorAll("[data-toggle]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = btn.dataset.toggle;
    if (expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
    renderSidebar(container, state, handlers);
  }));
  container.querySelectorAll("[data-add-cat]").forEach(btn => btn.addEventListener("click", () => handlers.onAddCategory()));
}

export function expandPathTo(categorias, categoriaId) {
  let atual = categorias.find(c => c.id === categoriaId);
  while (atual && atual.parentId) {
    expandedIds.add(atual.parentId);
    atual = categorias.find(c => c.id === atual.parentId);
  }
}
