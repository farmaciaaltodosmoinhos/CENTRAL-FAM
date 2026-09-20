import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { initialState, reducer, createStore } from "../src/store.js";
import { CATEGORIA_INDEFINIDA_ID } from "../src/domain.js";

describe("store.js — initialState", () => {
  test("começa com listas vazias e pronto:false", () => {
    assert.deepEqual(initialState.servicos, []);
    assert.deepEqual(initialState.categorias, []);
    assert.equal(initialState.pronto, false);
  });

  test("initialState está congelado (imutável desde a origem)", () => {
    assert.throws(() => { initialState.nomeFarmacia = "outra coisa"; }, TypeError);
  });
});

describe("store.js — reducer: nunca muta o estado recebido, devolve sempre um objeto novo", () => {
  test("uma ação reconhecida devolve uma referência de estado DIFERENTE", () => {
    const next = reducer(initialState, { type: "SET_SEARCH", query: "abc" });
    assert.notEqual(next, initialState);
  });

  test("o estado anterior nunca é alterado (o valor antigo de searchQuery mantém-se)", () => {
    const antes = { ...initialState, searchQuery: "" };
    reducer(antes, { type: "SET_SEARCH", query: "mudou" });
    assert.equal(antes.searchQuery, "");
  });

  test("uma ação desconhecida devolve a MESMA referência (não cria estado novo à toa)", () => {
    const next = reducer(initialState, { type: "ACAO_QUE_NAO_EXISTE" });
    assert.equal(next, initialState);
  });
});

describe("store.js — reducer: ações simples de campo único", () => {
  test("INIT_STATE espalha o payload e marca pronto:true", () => {
    const next = reducer(initialState, { type: "INIT_STATE", payload: { nomeFarmacia: "Farmácia X" } });
    assert.equal(next.nomeFarmacia, "Farmácia X");
    assert.equal(next.pronto, true);
  });

  test("SET_SEARCH", () => {
    assert.equal(reducer(initialState, { type: "SET_SEARCH", query: "paracetamol" }).searchQuery, "paracetamol");
  });

  test("SET_SCOPE", () => {
    const scope = { tipo: "favoritos" };
    assert.deepEqual(reducer(initialState, { type: "SET_SCOPE", scope }).scope, scope);
  });

  test("SET_SORT", () => {
    assert.equal(reducer(initialState, { type: "SET_SORT", sortBy: "nome" }).sortBy, "nome");
  });

  test("SET_VIEWMODE", () => {
    assert.equal(reducer(initialState, { type: "SET_VIEWMODE", viewMode: "lista" }).viewMode, "lista");
  });

  test("SET_SYNC_STATUS", () => {
    assert.equal(reducer(initialState, { type: "SET_SYNC_STATUS", status: "a-sincronizar" }).syncStatus, "a-sincronizar");
  });

  test("SET_LOGO", () => {
    assert.equal(reducer(initialState, { type: "SET_LOGO", logoBase64: "data:xyz" }).logoBase64, "data:xyz");
  });

  test("SET_NOME_FARMACIA", () => {
    assert.equal(reducer(initialState, { type: "SET_NOME_FARMACIA", nome: "Nova Farmácia" }).nomeFarmacia, "Nova Farmácia");
  });

  test("SET_MORADA / SET_CIDADE / SET_EMAIL_CONTACTO / SET_TELEFONE_CONTACTO", () => {
    assert.equal(reducer(initialState, { type: "SET_MORADA", valor: "Rua X" }).morada, "Rua X");
    assert.equal(reducer(initialState, { type: "SET_CIDADE", valor: "Lisboa" }).cidade, "Lisboa");
    assert.equal(reducer(initialState, { type: "SET_EMAIL_CONTACTO", valor: "a@b.pt" }).emailContacto, "a@b.pt");
    assert.equal(reducer(initialState, { type: "SET_TELEFONE_CONTACTO", valor: "912345678" }).telefoneContacto, "912345678");
  });
});

describe("store.js — reducer: CRUD de serviços", () => {
  const comServico = { ...initialState, servicos: [{ id: "s1", nome: "Vacina", favorito: false, contadorAcessos: 0 }] };

  test("ADD_SERVICO acrescenta ao fim da lista", () => {
    const next = reducer(initialState, { type: "ADD_SERVICO", servico: { id: "s1", nome: "Vacina" } });
    assert.equal(next.servicos.length, 1);
  });

  test("UPDATE_SERVICO faz merge dos campos dados, mantendo os restantes", () => {
    const next = reducer(comServico, { type: "UPDATE_SERVICO", id: "s1", dados: { nome: "Vacina Editada" } });
    assert.equal(next.servicos[0].nome, "Vacina Editada");
    assert.equal(next.servicos[0].favorito, false);
  });

  test("REMOVE_SERVICO remove só o serviço com aquele id", () => {
    const next = reducer(comServico, { type: "REMOVE_SERVICO", id: "s1" });
    assert.deepEqual(next.servicos, []);
  });

  test("TOGGLE_FAVORITO inverte o valor de favorito e atualiza atualizadoEm", () => {
    const next = reducer(comServico, { type: "TOGGLE_FAVORITO", id: "s1" });
    assert.equal(next.servicos[0].favorito, true);
    assert.ok(next.servicos[0].atualizadoEm);
  });

  test("REGISTER_ACESSO incrementa contadorAcessos e atualiza ultimoAcesso", () => {
    const next = reducer(comServico, { type: "REGISTER_ACESSO", id: "s1" });
    assert.equal(next.servicos[0].contadorAcessos, 1);
    assert.ok(next.servicos[0].ultimoAcesso);
  });

  test("REORDER_SERVICOS move o serviço e reindexa 'ordem' de todos", () => {
    const tres = { ...initialState, servicos: [{ id: "a", ordem: 0 }, { id: "b", ordem: 1 }, { id: "c", ordem: 2 }] };
    const next = reducer(tres, { type: "REORDER_SERVICOS", fromId: "a", toId: "c" });
    assert.deepEqual(next.servicos.map(s => s.id), ["b", "c", "a"]);
    assert.deepEqual(next.servicos.map(s => s.ordem), [0, 1, 2]);
  });

  test("REORDER_SERVICOS com um id inexistente devolve o estado inalterado", () => {
    const next = reducer(comServico, { type: "REORDER_SERVICOS", fromId: "nao-existe", toId: "s1" });
    assert.equal(next, comServico);
  });

  test("SET_SERVICOS substitui a lista inteira", () => {
    const next = reducer(comServico, { type: "SET_SERVICOS", servicos: [] });
    assert.deepEqual(next.servicos, []);
  });
});

describe("store.js — reducer: categorias", () => {
  const comCategorias = {
    ...initialState,
    categorias: [
      { id: "a", parentId: null, ordem: 0 },
      { id: "b", parentId: null, ordem: 1 },
      { id: "filha", parentId: "a", ordem: 0 }
    ]
  };

  test("ADD_CATEGORIA acrescenta à lista", () => {
    const next = reducer(initialState, { type: "ADD_CATEGORIA", categoria: { id: "nova" } });
    assert.equal(next.categorias.length, 1);
  });

  test("UPDATE_CATEGORIA faz merge dos campos dados", () => {
    const next = reducer(comCategorias, { type: "UPDATE_CATEGORIA", id: "a", dados: { nome: "Editada" } });
    assert.equal(next.categorias.find(c => c.id === "a").nome, "Editada");
  });

  test("REORDER_CATEGORIAS troca a ordem entre irmãs do mesmo nível", () => {
    const next = reducer(comCategorias, { type: "REORDER_CATEGORIAS", fromId: "a", toId: "b" });
    const porOrdem = next.categorias.filter(c => c.parentId === null).sort((x, y) => x.ordem - y.ordem);
    assert.deepEqual(porOrdem.map(c => c.id), ["b", "a"]);
  });

  test("REORDER_CATEGORIAS entre categorias de níveis diferentes não faz nada (devolve o mesmo estado)", () => {
    const next = reducer(comCategorias, { type: "REORDER_CATEGORIAS", fromId: "a", toId: "filha" });
    assert.equal(next, comCategorias);
  });

  test("REMOVE_CATEGORIA nunca elimina a Categoria Indefinida", () => {
    const next = reducer(comCategorias, { type: "REMOVE_CATEGORIA", id: CATEGORIA_INDEFINIDA_ID });
    assert.equal(next, comCategorias);
  });

  test("REMOVE_CATEGORIA repõe o scope para 'home' se apontava para a categoria eliminada", () => {
    const comScope = { ...comCategorias, scope: { tipo: "categoria", categoriaId: "a" } };
    const next = reducer(comScope, { type: "REMOVE_CATEGORIA", id: "a" });
    assert.deepEqual(next.scope, { tipo: "home" });
  });

  test("SET_CATEGORIAS substitui a lista inteira", () => {
    const next = reducer(comCategorias, { type: "SET_CATEGORIAS", categorias: [] });
    assert.deepEqual(next.categorias, []);
  });
});

describe("store.js — reducer: IMPORT_DADOS / RESET_TUDO", () => {
  test("IMPORT_DADOS espalha o payload por cima do estado atual", () => {
    const next = reducer(initialState, { type: "IMPORT_DADOS", payload: { nomeFarmacia: "Importada", servicos: [{ id: "x" }] } });
    assert.equal(next.nomeFarmacia, "Importada");
    assert.equal(next.servicos.length, 1);
  });

  test("RESET_TUDO repõe o estado inicial, com as categorias padrão dadas e pronto:true", () => {
    const sujo = { ...initialState, servicos: [{ id: "x" }], searchQuery: "algo" };
    const padrao = [{ id: "cat1" }];
    const next = reducer(sujo, { type: "RESET_TUDO", categoriasPadrao: padrao });
    assert.deepEqual(next.servicos, []);
    assert.equal(next.searchQuery, "");
    assert.deepEqual(next.categorias, padrao);
    assert.equal(next.pronto, true);
  });
});

describe("store.js — createStore", () => {
  test("getState() devolve o estado inicial dado, já congelado", () => {
    const store = createStore(reducer, initialState);
    assert.equal(store.getState(), initialState);
  });

  test("dispatch() atualiza o estado e devolve-o", () => {
    const store = createStore(reducer, initialState);
    const novo = store.dispatch({ type: "SET_SEARCH", query: "x" });
    assert.equal(novo.searchQuery, "x");
    assert.equal(store.getState().searchQuery, "x");
  });

  test("cada novo estado despachado fica congelado (imutabilidade mantida ao longo do tempo)", () => {
    const store = createStore(reducer, initialState);
    store.dispatch({ type: "SET_SEARCH", query: "x" });
    assert.throws(() => { store.getState().searchQuery = "outra"; }, TypeError);
  });

  test("subscribe() é chamado com o novo estado sempre que dispatch muda algo", () => {
    const store = createStore(reducer, initialState);
    const recebidos = [];
    store.subscribe((estado) => recebidos.push(estado.searchQuery));
    store.dispatch({ type: "SET_SEARCH", query: "abc" });
    assert.deepEqual(recebidos, ["abc"]);
  });

  test("subscribe() NÃO é chamado quando a ação não muda o estado (ex.: ação desconhecida)", () => {
    const store = createStore(reducer, initialState);
    let chamadas = 0;
    store.subscribe(() => chamadas++);
    store.dispatch({ type: "ACAO_INEXISTENTE" });
    assert.equal(chamadas, 0);
  });

  test("a função devolvida por subscribe() cancela a subscrição", () => {
    const store = createStore(reducer, initialState);
    let chamadas = 0;
    const cancelar = store.subscribe(() => chamadas++);
    cancelar();
    store.dispatch({ type: "SET_SEARCH", query: "x" });
    assert.equal(chamadas, 0);
  });

  test("um erro num subscritor não impede os outros subscritores de serem chamados", () => {
    const store = createStore(reducer, initialState);
    let segundoChamado = false;
    store.subscribe(() => { throw new Error("subscritor com bug"); });
    store.subscribe(() => { segundoChamado = true; });
    assert.doesNotThrow(() => store.dispatch({ type: "SET_SEARCH", query: "x" }));
    assert.equal(segundoChamado, true);
  });
});
