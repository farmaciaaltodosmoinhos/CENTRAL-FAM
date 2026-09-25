import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIA_INDEFINIDA_ID,
  CATEGORIAS_PADRAO,
  MODULOS_ATALHOS,
  categoriaIndefinida,
  findCategoria,
  getCategoriaNome,
  getFilhas,
  buildCategoryTree,
  getDescendantIds,
  getAncestorPath,
  contarServicosNaCategoria,
  getCategoriasRaiz,
  filtrarServicos,
  ordenarServicos,
  getStats,
  getMaisUsados,
  reatribuirAoEliminarCategoria,
  podeSerPai
} from "../src/domain.js";

function categorias() {
  return [
    { id: "geral", nome: "Geral", parentId: null, ordem: 0 },
    { id: "vacinacao", nome: "Vacinação", parentId: "geral", ordem: 0 },
    { id: "gripe", nome: "Gripe Sazonal", parentId: "vacinacao", ordem: 0 },
    { id: "rastreios", nome: "Rastreios", parentId: null, ordem: 1 }
  ];
}

describe("domain.js — CATEGORIAS_PADRAO / MODULOS_ATALHOS (constantes)", () => {
  test("CATEGORIAS_PADRAO inclui a categoria 'Serviços Clínicos' (cat_clinicos), usada pelos atalhos de módulos", () => {
    assert.ok(CATEGORIAS_PADRAO.some(c => c.id === "cat_clinicos"));
  });

  test("CATEGORIAS_PADRAO não tem ids repetidos", () => {
    const ids = CATEGORIAS_PADRAO.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("MODULOS_ATALHOS tem exatamente 14 entradas (um atalho por módulo/ferramenta da Central, incluindo FARMA IA — ponto 25)", () => {
    assert.equal(MODULOS_ATALHOS.length, 14);
  });

  test("MODULOS_ATALHOS não tem módulos repetidos", () => {
    const modulos = MODULOS_ATALHOS.map(m => m.modulo);
    assert.equal(new Set(modulos).size, modulos.length);
  });

  test("todas as entradas de MODULOS_ATALHOS têm nome não vazio", () => {
    assert.ok(MODULOS_ATALHOS.every(m => typeof m.nome === "string" && m.nome.trim().length > 0));
  });
});

describe("domain.js — categoriaIndefinida / findCategoria / getCategoriaNome", () => {
  test("categoriaIndefinida() devolve sempre o mesmo id conhecido", () => {
    assert.equal(categoriaIndefinida().id, CATEGORIA_INDEFINIDA_ID);
  });

  test("findCategoria encontra uma categoria real pelo id", () => {
    const c = findCategoria(categorias(), "vacinacao");
    assert.equal(c.nome, "Vacinação");
  });

  test("findCategoria devolve null para um id inexistente", () => {
    assert.equal(findCategoria(categorias(), "nao-existe"), null);
  });

  test("findCategoria(CATEGORIA_INDEFINIDA_ID) devolve a categoria indefinida mesmo sem estar na lista", () => {
    const c = findCategoria(categorias(), CATEGORIA_INDEFINIDA_ID);
    assert.equal(c.id, CATEGORIA_INDEFINIDA_ID);
  });

  test("getCategoriaNome devolve 'Categoria Indefinida' para um id que não existe", () => {
    assert.equal(getCategoriaNome(categorias(), "id-fantasma"), "Categoria Indefinida");
  });

  test("getCategoriaNome devolve o nome real para um id existente", () => {
    assert.equal(getCategoriaNome(categorias(), "gripe"), "Gripe Sazonal");
  });
});

describe("domain.js — getFilhas / buildCategoryTree / getDescendantIds / getAncestorPath", () => {
  test("getFilhas devolve só os filhos diretos, ordenados por 'ordem'", () => {
    const raiz = getFilhas(categorias(), null);
    assert.deepEqual(raiz.map(c => c.id), ["geral", "rastreios"]);
  });

  test("getFilhas de uma categoria sem filhos devolve array vazio", () => {
    assert.deepEqual(getFilhas(categorias(), "gripe"), []);
  });

  test("buildCategoryTree aninha corretamente 3 níveis de profundidade", () => {
    const arvore = buildCategoryTree(categorias());
    const geral = arvore.find(c => c.id === "geral");
    assert.equal(geral.filhos.length, 1);
    assert.equal(geral.filhos[0].id, "vacinacao");
    assert.equal(geral.filhos[0].filhos[0].id, "gripe");
  });

  test("buildCategoryTree: uma folha tem 'filhos' vazio, não undefined", () => {
    const arvore = buildCategoryTree(categorias());
    const rastreios = arvore.find(c => c.id === "rastreios");
    assert.deepEqual(rastreios.filhos, []);
  });

  test("getDescendantIds inclui o próprio id + todos os descendentes", () => {
    const ids = getDescendantIds(categorias(), "geral");
    assert.deepEqual(new Set(ids), new Set(["geral", "vacinacao", "gripe"]));
  });

  test("getDescendantIds de uma folha devolve só o próprio id", () => {
    assert.deepEqual(getDescendantIds(categorias(), "gripe"), ["gripe"]);
  });

  test("getAncestorPath devolve o caminho da raiz até à própria categoria", () => {
    const path = getAncestorPath(categorias(), "gripe").map(c => c.id);
    assert.deepEqual(path, ["geral", "vacinacao", "gripe"]);
  });

  test("getAncestorPath de uma categoria de topo devolve só ela própria", () => {
    const path = getAncestorPath(categorias(), "geral").map(c => c.id);
    assert.deepEqual(path, ["geral"]);
  });
});

describe("domain.js — contarServicosNaCategoria / getCategoriasRaiz", () => {
  const servicos = [
    { id: "s1", categoriaId: "gripe" },
    { id: "s2", categoriaId: "vacinacao" },
    { id: "s3", categoriaId: "rastreios" },
    { id: "s4", categoriaId: null }
  ];

  test("contarServicosNaCategoria, com descendentes, conta a categoria + subcategorias", () => {
    assert.equal(contarServicosNaCategoria(servicos, categorias(), "geral", true), 2);
  });

  test("contarServicosNaCategoria, sem descendentes, conta só a própria categoria", () => {
    assert.equal(contarServicosNaCategoria(servicos, categorias(), "vacinacao", false), 1);
  });

  test("getCategoriasRaiz acrescenta 'Categoria Indefinida' só quando há serviços sem categoria", () => {
    const raiz = getCategoriasRaiz(categorias(), servicos);
    assert.ok(raiz.some(c => c.id === CATEGORIA_INDEFINIDA_ID));
  });

  test("getCategoriasRaiz NÃO acrescenta 'Categoria Indefinida' quando todos os serviços têm categoria", () => {
    const semOrfaos = servicos.filter(s => s.categoriaId);
    const raiz = getCategoriasRaiz(categorias(), semOrfaos);
    assert.ok(!raiz.some(c => c.id === CATEGORIA_INDEFINIDA_ID));
  });
});

describe("domain.js — filtrarServicos", () => {
  const cats = categorias();
  const servicos = [
    { id: "s1", nome: "Vacina da Gripe", categoriaId: "gripe", favorito: true, ordem: 2 },
    { id: "s2", nome: "Rastreio Cardiovascular", categoriaId: "rastreios", favorito: false, ordem: 0 },
    { id: "s3", nome: "Vacina do Tétano", categoriaId: "vacinacao", favorito: false, ordem: 1 }
  ];

  test("pesquisa (searchQuery) é sempre global, ignora o âmbito de navegação atual", () => {
    const state = { servicos, categorias: cats, searchQuery: "vacina", scope: { tipo: "categoria-direta", categoriaId: "rastreios" }, sortBy: "ordem" };
    const resultado = filtrarServicos(state);
    assert.deepEqual(resultado.map(s => s.id).sort(), ["s1", "s3"]);
  });

  test("scope 'categoria' inclui a própria categoria + subcategorias", () => {
    const state = { servicos, categorias: cats, searchQuery: "", scope: { tipo: "categoria", categoriaId: "geral" }, sortBy: "ordem" };
    const resultado = filtrarServicos(state);
    assert.deepEqual(resultado.map(s => s.id).sort(), ["s1", "s3"]);
  });

  test("scope 'categoria-direta' inclui só essa categoria, não as subcategorias", () => {
    const state = { servicos, categorias: cats, searchQuery: "", scope: { tipo: "categoria-direta", categoriaId: "geral" }, sortBy: "ordem" };
    assert.deepEqual(filtrarServicos(state), []);
  });

  test("scope 'favoritos' filtra só os marcados como favorito", () => {
    const state = { servicos, categorias: cats, searchQuery: "", scope: { tipo: "favoritos" }, sortBy: "ordem" };
    const resultado = filtrarServicos(state);
    assert.deepEqual(resultado.map(s => s.id), ["s1"]);
  });

  test("scope 'tudo'/'home' não filtra nada", () => {
    const state = { servicos, categorias: cats, searchQuery: "", scope: { tipo: "tudo" }, sortBy: "ordem" };
    assert.equal(filtrarServicos(state).length, 3);
  });
});

describe("domain.js — ordenarServicos", () => {
  const lista = [
    { id: "a", nome: "Zebra", contadorAcessos: 1, ultimoAcesso: 100, criadoEm: 300 },
    { id: "b", nome: "Abelha", contadorAcessos: 9, ultimoAcesso: 300, criadoEm: 100 },
    { id: "c", nome: "Melro", contadorAcessos: 5, ultimoAcesso: 200, criadoEm: 200 }
  ];

  test("'nome' ordena alfabeticamente (locale pt)", () => {
    assert.deepEqual(ordenarServicos(lista, "nome").map(s => s.id), ["b", "c", "a"]);
  });

  test("'uso' ordena por contadorAcessos decrescente", () => {
    assert.deepEqual(ordenarServicos(lista, "uso").map(s => s.id), ["b", "c", "a"]);
  });

  test("'recente' ordena por ultimoAcesso decrescente", () => {
    assert.deepEqual(ordenarServicos(lista, "recente").map(s => s.id), ["b", "c", "a"]);
  });

  test("'criado' ordena por criadoEm decrescente", () => {
    assert.deepEqual(ordenarServicos(lista, "criado").map(s => s.id), ["a", "c", "b"]);
  });

  test("ordenarServicos nunca muta o array original", () => {
    const copia = lista.slice();
    ordenarServicos(lista, "nome");
    assert.deepEqual(lista, copia);
  });
});

describe("domain.js — getStats / getMaisUsados", () => {
  test("getStats conta total, favoritos, ativos e categorias em uso", () => {
    const servicos = [
      { id: "1", categoriaId: "a", favorito: true, status: "ativo" },
      { id: "2", categoriaId: "a", favorito: false, status: "inativo" },
      { id: "3", categoriaId: "b", favorito: true, status: "ativo" }
    ];
    const stats = getStats({ servicos, categorias: [] });
    assert.deepEqual(stats, { total: 3, favoritos: 2, ativos: 2, categoriasEmUso: 2 });
  });

  test("getMaisUsados devolve os N com mais contadorAcessos, por omissão limite 8", () => {
    const servicos = Array.from({ length: 10 }, (_, i) => ({ id: String(i), contadorAcessos: i }));
    const top = getMaisUsados(servicos);
    assert.equal(top.length, 8);
    assert.equal(top[0].id, "9");
  });

  test("getMaisUsados respeita um limite explícito", () => {
    const servicos = [{ id: "1", contadorAcessos: 5 }, { id: "2", contadorAcessos: 1 }];
    assert.equal(getMaisUsados(servicos, 1)[0].id, "1");
  });
});

describe("domain.js — reatribuirAoEliminarCategoria", () => {
  test("os filhos diretos 'sobem' para o avô ao eliminar a categoria intermédia", () => {
    const { categorias: novas } = reatribuirAoEliminarCategoria(categorias(), [], "vacinacao");
    const gripe = novas.find(c => c.id === "gripe");
    assert.equal(gripe.parentId, "geral"); // subiu de "vacinacao" para "geral"
  });

  test("os serviços da categoria eliminada passam a Categoria Indefinida", () => {
    const servicos = [{ id: "s1", categoriaId: "vacinacao" }];
    const { servicos: novos } = reatribuirAoEliminarCategoria(categorias(), servicos, "vacinacao");
    assert.equal(novos[0].categoriaId, CATEGORIA_INDEFINIDA_ID);
  });

  test("a categoria eliminada deixa de existir na lista resultante", () => {
    const { categorias: novas } = reatribuirAoEliminarCategoria(categorias(), [], "vacinacao");
    assert.ok(!novas.some(c => c.id === "vacinacao"));
  });

  test("serviços de outras categorias não são afetados", () => {
    const servicos = [{ id: "s1", categoriaId: "rastreios" }];
    const { servicos: novos } = reatribuirAoEliminarCategoria(categorias(), servicos, "vacinacao");
    assert.equal(novos[0].categoriaId, "rastreios");
  });
});

describe("domain.js — podeSerPai (prevenção de ciclos na árvore de categorias)", () => {
  test("uma categoria não pode ser pai de si própria", () => {
    assert.equal(podeSerPai(categorias(), "geral", "geral"), false);
  });

  test("uma categoria não pode ser filha de um dos seus próprios descendentes", () => {
    assert.equal(podeSerPai(categorias(), "geral", "gripe"), false);
  });

  test("mover para um pai não relacionado é permitido", () => {
    assert.equal(podeSerPai(categorias(), "gripe", "rastreios"), true);
  });

  test("mover para 'sem pai' (raiz) é sempre permitido", () => {
    assert.equal(podeSerPai(categorias(), "vacinacao", null), true);
  });
});
