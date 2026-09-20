import { h, render } from "../vdom.js";
import { escapeHtml, highlight, relTime, placeholderImg, readableTextColor, shade } from "../utils.js";
import { icon } from "../icons.js";
import {
  getCategoriasRaiz, getFilhas, findCategoria, getAncestorPath, getCategoriaNome,
  contarServicosNaCategoria, filtrarServicos, CATEGORIA_INDEFINIDA_ID
} from "../domain.js";
import { t, DEFAULT_IDIOMA } from "../i18n.js";

/* ---------- cartão de categoria (pasta) ---------- */
function catCardVNode(cat, count, onOpen, dragHandlers) {
  const cor = cat.cor || "#8a9a90";
  const style = cat.imagem
    ? { backgroundImage: `linear-gradient(160deg, ${shade(cor, -0.1)}cc, ${shade(cor, 0.05)}cc), url(${cat.imagem})`, color: readableTextColor(cor) }
    : { background: `linear-gradient(155deg, ${shade(cor, 0.12)}, ${shade(cor, -0.16)})`, color: readableTextColor(cor) };
  const props = { class: "cat-card", key: "cat-" + cat.id, style, onClick: onOpen };
  if (dragHandlers) {
    Object.assign(props, {
      draggable: true,
      ondragstart: (e) => dragHandlers.onDragStart(e, cat.id),
      ondragover: (e) => e.preventDefault(),
      ondrop: (e) => { e.preventDefault(); dragHandlers.onDrop(cat.id); },
      ondragend: () => dragHandlers.onDragEnd()
    });
  }
  return h("div", props,
    h("div", { class: "cat-card-icon", key: "icon" }, h("span", { html: icon("folder"), key: "icon-svg" })),
    h("div", { class: "cat-card-body", key: "body" },
      h("div", { class: "cat-card-name", key: "name" }, cat.nome),
      h("div", { class: "cat-card-meta", key: "meta" }, h("span", { html: icon("boxes"), key: "meta-icon" }), `${count} serviço${count !== 1 ? "s" : ""}`)
    )
  );
}

function verTudoCardVNode(total, onOpen) {
  return h("div", { class: "cat-card special", key: "cat-vertudo", onClick: onOpen },
    h("div", { class: "cat-card-icon", key: "icon" }, h("span", { html: icon("layers"), key: "icon-svg" })),
    h("div", { class: "cat-card-body", key: "body" },
      h("div", { class: "cat-card-name", key: "name" }, "Ver tudo"),
      h("div", { class: "cat-card-meta", key: "meta" }, h("span", { html: icon("boxes"), key: "meta-icon" }), `${total} serviço${total !== 1 ? "s" : ""}`)
    )
  );
}

function indefinidaCardVNode(cat, count, onOpen) {
  return h("div", { class: "cat-card indefinida", key: "cat-" + cat.id, onClick: onOpen },
    h("div", { class: "cat-card-icon", key: "icon" }, h("span", { html: icon("tag"), key: "icon-svg" })),
    h("div", { class: "cat-card-body", key: "body" },
      h("div", { class: "cat-card-name", key: "name" }, cat.nome),
      h("div", { class: "cat-card-meta", key: "meta" }, h("span", { html: icon("boxes"), key: "meta-icon" }), `${count} serviço${count !== 1 ? "s" : ""}`)
    )
  );
}

/* ---------- cartão de serviço ---------- */
function servicoCardVNode(s, categorias, query, viewMode, handlers, idioma) {
  const cat = findCategoria(categorias, s.categoriaId || CATEGORIA_INDEFINIDA_ID) || findCategoria(categorias, CATEGORIA_INDEFINIDA_ID);
  const cor = cat ? cat.cor : "#8a9a90";
  const textColor = readableTextColor(cor);
  const style = { background: `linear-gradient(155deg, ${shade(cor, 0.16)}, ${shade(cor, -0.08)})`, color: textColor };
  const img = s.imagemBase64 || s.imagemUrl || placeholderImg(s.nome);
  const uso = s.contadorAcessos
    ? h("div", { class: "uso-info", key: "uso" }, h("span", { html: icon("arrowUpRight"), key: "uso-icon" }), ` ${s.contadorAcessos}× · ${relTime(s.ultimoAcesso)}`)
    : h("div", { class: "uso-info", key: "uso" }, t("main.ainda_nao_acedido", idioma));

  const abrir = (e) => { e.stopPropagation(); handlers.onAbrir(s.id); };
  const fav = (e) => { e.stopPropagation(); handlers.onFavorito(s.id); };
  const clickCard = () => handlers.onAbrir(s.id);

  // Todos os filhos, a todos os níveis, têm `key` explícita e estável (nome do
  // campo, não a posição). Isto garante que o motor de diffing nunca troca ou
  // "perde" um nó por engano quando um irmão condicional (ex.: descrição)
  // aparece/desaparece — cada elemento é sempre reencontrado pela sua própria
  // identidade, nunca pelo índice em que calhou de ficar.
  return h("div", {
    class: "card-servico", key: "srv-" + s.id, style, draggable: true,
    dataset: { id: String(s.id) },
    onClick: clickCard,
    ondragstart: (e) => handlers.onDragStart(e, s.id),
    ondragover: (e) => { e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); handlers.onDrop(s.id); },
    ondragend: () => handlers.onDragEnd()
  },
    h("div", { class: "card-top-row", key: "top-row" },
      h("span", { class: `status-dot ${s.status}`, title: s.status, key: "status" }),
      h("button", { class: `btn-fav ${s.favorito ? "is-fav" : ""}`, onClick: fav, title: t("main.favorito_title", idioma), html: s.favorito ? icon("starFilled") : icon("star"), key: "fav" })
    ),
    h("img", { class: "img-botao", src: img, onerror: `this.src='${placeholderImg(s.nome)}'`, key: "img" }),
    h("div", { class: "card-body", key: "body" },
      h("span", { class: "cat-tag", key: "tag" }, cat ? cat.nome : "Categoria Indefinida"),
      h("div", { class: "nome-servico", html: highlight(s.nome, query), key: "nome" }),
      h("div", { class: "servico-desc", html: s.descricao ? highlight(s.descricao, query) : "", style: { display: s.descricao ? "block" : "none" }, key: "desc" }),
      uso
    ),
    h("button", { class: "btn-abrir", onClick: abrir, key: "abrir" }, h("span", { html: icon("externalLink"), key: "abrir-icon" }), " Abrir serviço")
  );
}

function emptyStateVNode(vazio, onAction, idioma) {
  return h("div", { class: "empty-state" },
    h("span", { class: "icon", html: vazio ? icon("folder") : icon("search") }),
    h("br"),
    vazio ? t("main.vazio_secao", idioma) : t("main.sem_resultados", idioma),
    h("br"),
    h("button", { class: "btn-primary empty-cta", onClick: onAction }, vazio ? t("main.adicionar_primeiro", idioma) : t("main.limpar_filtros", idioma))
  );
}

/* ---------- breadcrumb + cabeçalho de secção ---------- */
function renderCrumb(container, state, handlers) {
  const idioma = state.idioma || DEFAULT_IDIOMA;
  let parts = [];
  const goHome = () => handlers.onNav("home");
  if (state.searchQuery.trim()) {
    parts = [{ label: t("nav.inicio", idioma), onClick: goHome }, { label: t("nav.resultados_para", idioma, { query: state.searchQuery.trim() }), current: true }];
  } else if (state.scope.tipo === "home") {
    parts = [{ label: t("nav.inicio", idioma), current: true }];
  } else if (state.scope.tipo === "favoritos") {
    parts = [{ label: t("nav.inicio", idioma), onClick: goHome }, { label: t("nav.favoritos", idioma), current: true }];
  } else if (state.scope.tipo === "tudo") {
    parts = [{ label: t("nav.inicio", idioma), onClick: goHome }, { label: t("nav.ver_tudo", idioma), current: true }];
  } else if (state.scope.tipo === "modulo") {
    const nomes = { "farma-ia": "FARMA IA", manipulados: "Manipulados", documentos: "Documentos", gabinete: "Gestão de Gabinete", pim: "Gestão de PIM", aue: "Pedidos AUE", stocks: "Stocks Errados", reservas: "Reservas", medela: "Aluguer Medela", "conversor-pdf": "Conversor de PDF", "devolucao-frio": "Devolução de Frio", "mapa-cardiovascular": "Mapa Cardiovascular", "devolucoes-armazenistas": "Devoluções a Armazenistas", "catalogo-produtos": "Catálogo de Produtos" };
    parts = [{ label: t("nav.inicio", idioma), onClick: goHome }, { label: nomes[state.scope.modulo] || state.scope.modulo, current: true }];
  } else {
    const path = getAncestorPath(state.categorias, state.scope.categoriaId);
    parts = [{ label: t("nav.inicio", idioma), onClick: goHome }, ...path.map((c, i) => ({
      label: c.nome,
      current: i === path.length - 1,
      onClick: i === path.length - 1 ? null : () => handlers.onSelectCategory(c.id)
    }))];
  }
  container.innerHTML = parts.map((p, i) => `${i > 0 ? '<span class="crumb-sep">/</span>' : ""}<button class="${p.current ? "current" : ""}" data-crumb-i="${i}">${escapeHtml(p.label)}</button>`).join("");
  parts.forEach((p, i) => {
    if (p.onClick) container.querySelector(`[data-crumb-i="${i}"]`).addEventListener("click", p.onClick);
  });
}

/* ---------- render principal ---------- */
let dragSrcId = null;

export function renderMainContent(vdomRoot, state, handlers) {
  const idioma = state.idioma || DEFAULT_IDIOMA;
  if (state.scope.tipo === "modulo") {
    render(h("div", { class: "modulo-wrap" },
      h("iframe", {
        class: "modulo-iframe",
        src: `/modulos/${state.scope.modulo}.html`,
        title: `Módulo: ${state.scope.modulo}`
      })
    ), vdomRoot);
    return;
  }

  const query = state.searchQuery.trim();
  const isSearching = !!query;
  const children = [];

  if (isSearching) {
    const lista = filtrarServicos(state);
    children.push(sectionTitle(t("nav.resultados_pesquisa", idioma)));
    children.push(serviceGrid(lista, state, query, handlers, idioma));
  } else if (state.scope.tipo === "home") {
    const raiz = getCategoriasRaiz(state.categorias, state.servicos);
    const total = state.servicos.length;
    children.push(sectionTitle(t("nav.categorias", idioma)));
    const cards = [verTudoCardVNode(total, () => handlers.onNav("tudo"))];
    raiz.forEach(cat => {
      const count = contarServicosNaCategoria(state.servicos, state.categorias, cat.id, true);
      if (cat.id === CATEGORIA_INDEFINIDA_ID) cards.push(indefinidaCardVNode(cat, count, () => handlers.onSelectCategory(cat.id)));
      else cards.push(catCardVNode(cat, count, () => handlers.onSelectCategory(cat.id), categoriaDragHandlers(handlers)));
    });
    children.push(h("div", { class: "grid-categorias" }, cards));
    if (!raiz.length) {
      children.push(h("p", { style: { color: "var(--text-soft)", fontSize: ".85rem", margin: "-14px 0 20px 4px" } }, t("nav.sem_categorias_ainda", idioma)));
    }
  } else if (state.scope.tipo === "categoria-direta") {
    const cat = findCategoria(state.categorias, state.scope.categoriaId);
    const filhas = getFilhas(state.categorias, state.scope.categoriaId);
    if (filhas.length) {
      children.push(sectionTitle(t("nav.subcategorias", idioma)));
      children.push(h("div", { class: "grid-categorias" }, filhas.map(f => {
        const count = contarServicosNaCategoria(state.servicos, state.categorias, f.id, true);
        return catCardVNode(f, count, () => handlers.onSelectCategory(f.id), categoriaDragHandlers(handlers));
      })));
    }
    const lista = filtrarServicos(state);
    children.push(sectionTitle(cat ? t("nav.servicos_em", idioma, { categoria: cat.nome }) : t("nav.servicos", idioma)));
    children.push(serviceGrid(lista, state, query, handlers, idioma));
  } else {
    // 'categoria' (com subcategorias incluídas), 'favoritos', 'tudo'
    const lista = filtrarServicos(state);
    const titulo = state.scope.tipo === "favoritos" ? t("nav.favoritos", idioma) : state.scope.tipo === "tudo" ? t("nav.todos_servicos", idioma) : t("nav.servicos", idioma);
    children.push(sectionTitle(titulo));
    children.push(serviceGrid(lista, state, query, handlers, idioma));
  }

  render(h("div", {}, children), vdomRoot);
}

function sectionTitle(text) {
  return h("div", { class: "section-title" }, text);
}

function categoriaDragHandlers(handlers) {
  return {
    onDragStart: (e, id) => handlers.onCategoriaDragStart(e, id),
    onDrop: (id) => handlers.onCategoriaDrop(id),
    onDragEnd: () => handlers.onCategoriaDragEnd()
  };
}

function serviceGrid(lista, state, query, handlers, idioma) {
  const idiomaAtual = idioma || state.idioma || DEFAULT_IDIOMA;
  if (!lista.length) {
    const vazio = state.servicos.length === 0 || (state.scope.tipo !== "home" && !isSearchingScope(state));
    return h("div", { class: `grid-servicos ${state.viewMode === "list" ? "list-mode" : ""}` },
      emptyStateVNode(state.servicos.length === 0, handlers.onEmptyAction, idiomaAtual));
  }
  return h("div", { class: `grid-servicos ${state.viewMode === "list" ? "list-mode" : ""}` },
    lista.map(s => servicoCardVNode(s, state.categorias, query, state.viewMode, handlers, idiomaAtual)));
}
function isSearchingScope(state) { return !!state.searchQuery.trim(); }

export { renderCrumb };
