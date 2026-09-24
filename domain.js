/**
 * domain.js — regras de negócio, 100% funções puras (sem DOM, sem IndexedDB).
 * É a camada testada em `tests/domain.test.js`.
 */
import { matchesQuery } from "./utils.js";

export const CATEGORIA_INDEFINIDA_ID = "cat_indefinida";

export const CATEGORIAS_PADRAO = [
  { id: "cat_geral", nome: "Geral", cor: "#2b7a4b", imagem: null, parentId: null, ordem: 0 },
  { id: "cat_questionarios", nome: "Questionários", cor: "#3a7dbf", imagem: null, parentId: null, ordem: 1 },
  { id: "cat_rastreios", nome: "Rastreios", cor: "#c9950f", imagem: null, parentId: null, ordem: 2 },
  { id: "cat_clinicos", nome: "Serviços Clínicos", cor: "#2b7a4b", imagem: null, parentId: null, ordem: 3 },
  { id: "cat_administrativo", nome: "Administrativo", cor: "#8a6ac2", imagem: null, parentId: null, ordem: 4 }
];

/**
 * Atalhos para os módulos/ferramentas internos, apresentados como serviços
 * (cartões na grelha da Central) — ver `actions.js` -> `criarAtalhosModulos()`
 * para a criação automática (uma única vez por farmácia, na categoria
 * "Serviços Clínicos"; o utilizador pode depois mover cada um para outra
 * categoria normalmente, editando o serviço). Mantido sincronizado à mão com
 * as listas MODULOS/FERRAMENTAS de `ui/sidebar.js` (os mesmos 13 ids).
 */
export const MODULOS_ATALHOS = [
  { modulo: "manipulados", nome: "Manipulados" },
  { modulo: "documentos", nome: "Documentos" },
  { modulo: "gabinete", nome: "Gestão de Gabinete" },
  { modulo: "pim", nome: "Gestão de PIM" },
  { modulo: "aue", nome: "Pedidos AUE" },
  { modulo: "stocks", nome: "Stocks Errados" },
  { modulo: "reservas", nome: "Reservas" },
  { modulo: "medela", nome: "Aluguer Medela" },
  { modulo: "conversor-pdf", nome: "Conversor de PDF" },
  { modulo: "devolucao-frio", nome: "Devolução de Frio" },
  { modulo: "mapa-cardiovascular", nome: "Mapa Cardiovascular" },
  { modulo: "devolucoes-armazenistas", nome: "Devoluções a Armazenistas" },
  { modulo: "catalogo-produtos", nome: "Catálogo de Produtos" },
  { modulo: "farma-ia", nome: "FARMA IA" }
];

export function categoriaIndefinida() {
  return { id: CATEGORIA_INDEFINIDA_ID, nome: "Categoria Indefinida", cor: "#8a9a90", imagem: null, parentId: null, ordem: 9999, sistema: true };
}

export function findCategoria(categorias, id) {
  if (id === CATEGORIA_INDEFINIDA_ID) return categoriaIndefinida();
  return categorias.find(c => c.id === id) || null;
}

export function getCategoriaNome(categorias, id) {
  const c = findCategoria(categorias, id);
  return c ? c.nome : "Categoria Indefinida";
}

export function getFilhas(categorias, parentId) {
  return categorias.filter(c => c.parentId === parentId).sort((a, b) => a.ordem - b.ordem);
}

/** Constrói a árvore de categorias (nós de topo com `.filhos` aninhados). */
export function buildCategoryTree(categorias) {
  const porPai = new Map();
  categorias.forEach(c => {
    const pid = c.parentId || null;
    if (!porPai.has(pid)) porPai.set(pid, []);
    porPai.get(pid).push(c);
  });
  function montar(pid) {
    return (porPai.get(pid) || []).sort((a, b) => a.ordem - b.ordem).map(c => ({ ...c, filhos: montar(c.id) }));
  }
  return montar(null);
}

/** Todos os IDs desta categoria + descendentes (para filtragem "esta categoria e subcategorias"). */
export function getDescendantIds(categorias, id) {
  const result = [id];
  const filhos = categorias.filter(c => c.parentId === id);
  filhos.forEach(f => result.push(...getDescendantIds(categorias, f.id)));
  return result;
}

export function getAncestorPath(categorias, id) {
  const path = [];
  let atual = findCategoria(categorias, id);
  while (atual) {
    path.unshift(atual);
    if (!atual.parentId) break;
    atual = findCategoria(categorias, atual.parentId);
  }
  return path;
}

/** Contagem de serviços diretos + de todas as subcategorias. */
export function contarServicosNaCategoria(servicos, categorias, categoriaId, incluirDescendentes = true) {
  if (!incluirDescendentes) return servicos.filter(s => (s.categoriaId || CATEGORIA_INDEFINIDA_ID) === categoriaId).length;
  const ids = new Set(getDescendantIds(categorias, categoriaId));
  return servicos.filter(s => ids.has(s.categoriaId || CATEGORIA_INDEFINIDA_ID)).length;
}

/** Categorias de topo a apresentar na página de entrada (só as que têm conteúdo ou são reais, exclui Indefinida vazia). */
export function getCategoriasRaiz(categorias, servicos) {
  const raiz = getFilhas(categorias, null);
  const contagemIndef = servicos.filter(s => !s.categoriaId || s.categoriaId === CATEGORIA_INDEFINIDA_ID).length;
  if (contagemIndef > 0) raiz.push(categoriaIndefinida());
  return raiz;
}

/** Aplica pesquisa + filtro de categoria/âmbito + favoritos + ordenação. */
export function filtrarServicos(state) {
  const { servicos, categorias, searchQuery, scope, sortBy } = state;
  let lista = servicos.slice();

  if (searchQuery && searchQuery.trim()) {
    // A pesquisa é sempre global: ignora o âmbito de navegação atual.
    lista = lista.filter(s => matchesQuery(s, getCategoriaNome(categorias, s.categoriaId || CATEGORIA_INDEFINIDA_ID), searchQuery));
  } else if (scope.tipo === "categoria") {
    const ids = new Set(getDescendantIds(categorias, scope.categoriaId));
    lista = lista.filter(s => ids.has(s.categoriaId || CATEGORIA_INDEFINIDA_ID));
  } else if (scope.tipo === "favoritos") {
    lista = lista.filter(s => s.favorito);
  } else if (scope.tipo === "categoria-direta") {
    lista = lista.filter(s => (s.categoriaId || CATEGORIA_INDEFINIDA_ID) === scope.categoriaId);
  }
  // scope.tipo === "tudo" | "home" -> sem filtro adicional

  return ordenarServicos(lista, sortBy);
}

export function ordenarServicos(lista, sortBy) {
  const copia = lista.slice();
  switch (sortBy) {
    case "nome": return copia.sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
    case "uso": return copia.sort((a, b) => (b.contadorAcessos || 0) - (a.contadorAcessos || 0));
    case "recente": return copia.sort((a, b) => (b.ultimoAcesso || 0) - (a.ultimoAcesso || 0));
    case "criado": return copia.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    default: return copia.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }
}

export function getStats(state) {
  const { servicos, categorias } = state;
  const total = servicos.length;
  const favoritos = servicos.filter(s => s.favorito).length;
  const ativos = servicos.filter(s => s.status === "ativo").length;
  const categoriasEmUso = new Set(servicos.map(s => s.categoriaId || CATEGORIA_INDEFINIDA_ID)).size;
  return { total, favoritos, ativos, categoriasEmUso };
}

export function getMaisUsados(servicos, limit = 8) {
  return servicos.slice().sort((a, b) => (b.contadorAcessos || 0) - (a.contadorAcessos || 0)).slice(0, limit);
}

/**
 * Ao eliminar uma categoria: os seus filhos diretos "sobem" para o avô
 * (mantendo a hierarquia coerente) e os serviços que lá estavam passam
 * a "Categoria Indefinida".
 */
export function reatribuirAoEliminarCategoria(categorias, servicos, categoriaId) {
  const alvo = categorias.find(c => c.id === categoriaId);
  const avoId = alvo ? alvo.parentId : null;
  const novasCategorias = categorias
    .filter(c => c.id !== categoriaId)
    .map(c => c.parentId === categoriaId ? { ...c, parentId: avoId } : c);
  const novosServicos = servicos.map(s => (s.categoriaId === categoriaId) ? { ...s, categoriaId: CATEGORIA_INDEFINIDA_ID, atualizadoEm: Date.now() } : s);
  return { categorias: novasCategorias, servicos: novosServicos };
}

/** Impede ciclos: uma categoria não pode tornar-se filha de si própria ou de um descendente seu. */
export function podeSerPai(categorias, categoriaId, candidatoPaiId) {
  if (!candidatoPaiId) return true;
  if (candidatoPaiId === categoriaId) return false;
  const descendentes = new Set(getDescendantIds(categorias, categoriaId));
  return !descendentes.has(candidatoPaiId);
}
