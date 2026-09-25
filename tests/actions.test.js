/**
 * tests/actions.test.js — Ponto 58: "Atualizar" (recarregarDoServidor) não
 * pode apagar uma criação/edição que ainda não chegou ao servidor.
 *
 * Contexto: depois do ponto 57 (gravações concorrentes entre ABAS/
 * computadores diferentes) estar corrigido e confirmado em produção, o Ivo
 * continuou a reportar "crio um serviço, vejo-o uns segundos e depois
 * desaparece" — desta vez reproduzido numa ÚNICA aba, sem nenhuma
 * concorrência entre separadores. Causa: `criarServico()` despacha a
 * alteração no store LOCAL de imediato (otimista) mas só a grava no
 * servidor 350ms depois (debounce, para agrupar escritas rápidas). Se
 * `recarregarDoServidor()` — chamado pelo botão "Atualizar" da sidebar, que
 * nunca teve NENHUMA proteção de syncStatus — corresse nessa janela de
 * 350ms, ia buscar ao servidor um estado que ainda não tinha o serviço
 * novo e SUBSTITUÍA o store inteiro por ele, fazendo o serviço desaparecer
 * da UI; a gravação agendada, ao disparar depois, gravava então o estado
 * já sem o serviço — perdendo-o também no servidor.
 *
 * Este ficheiro testa `createActions()` diretamente (sem browser), com um
 * `dataStore` falso cujo relógio controlamos nós: cria-se um serviço,
 * confirma-se que o `putAll` da gravação ainda não correu, e só depois se
 * chama `recarregarDoServidor()` — exatamente a janela que o bug explorava.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, reducer, initialState } from "../src/store.js";
import { createActions } from "../src/actions.js";
import { MODULOS_ATALHOS } from "../src/domain.js";

/** Polyfill mínimo de localStorage (Node não tem um global) — authClient.js/db.js usam-no. */
class FakeLocalStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
if (typeof globalThis.localStorage === "undefined") globalThis.localStorage = new FakeLocalStorage();

/**
 * dataStore falso: mantém o seu próprio "servidor" em memória e deixa o
 * teste controlar exatamente quando cada putAll/getAll resolve — para
 * conseguir colocar deliberadamente uma chamada a meio de outra, tal como
 * dois pedidos de rede reais se podem cruzar.
 */
function fakeDataStore({ servicos = [], categorias = [], config = {} } = {}) {
  const servidor = { servicos: servicos.slice(), categorias: categorias.slice(), config: { ...config } };
  const chamadas = [];
  return {
    servidor,
    chamadas,
    async getAll(nome) {
      chamadas.push({ op: "getAll", nome });
      return nome === "servicos" ? servidor.servicos.slice() : nome === "categorias" ? servidor.categorias.slice() : [];
    },
    async putAll(nome, items) {
      chamadas.push({ op: "putAll", nome, items });
      if (nome === "servicos") servidor.servicos = items.slice();
      else if (nome === "categorias") servidor.categorias = items.slice();
    },
    async getConfig(key) { return key in servidor.config ? servidor.config[key] : null; },
    async setConfig(key, value) { servidor.config[key] = value; },
    async getAsset() { return null; },
    async setAsset() {},
    async refresh() { chamadas.push({ op: "refresh" }); }
  };
}

function novoStore() { return createStore(reducer, initialState); }

describe("actions.js — recarregarDoServidor() não apaga uma escrita ainda pendente (ponto 58)", () => {
  test("criar um serviço e logo a seguir chamar recarregarDoServidor() (equivalente ao botão \"Atualizar\" clicado imediatamente) mantém o serviço", async () => {
    const dataStore = fakeDataStore({
      categorias: [{ id: "cat_indefinida", nome: "Categoria Indefinida", sistema: true, ordem: 9999 }],
      config: { atalhosModulosCriados: true } // já feito, para o teste focar só no bug do ponto 58
    });
    const store = novoStore();
    const actions = createActions(store, dataStore);

    await actions.iniciar();
    assert.equal(store.getState().servicos.length, 0);

    // cria o serviço: o dispatch otimista (ADD_SERVICO) é síncrono, mas a
    // gravação real (scheduleSync -> flushSync) só está AGENDADA para
    // daqui a 350ms — ainda não aconteceu quando `criarServico` resolve.
    await actions.criarServico({ nome: "Serviço Novo", tipo: "url", url: "https://exemplo.pt" });
    assert.equal(store.getState().servicos.length, 1, "o dispatch otimista já devia ter colocado o serviço no store local");
    assert.equal(dataStore.servidor.servicos.length, 0, "a gravação real ainda não devia ter corrido (está em debounce)");

    // clica em "Atualizar" NESSA JANELA — exatamente o cenário do bug.
    await actions.recarregarDoServidor();

    assert.equal(
      store.getState().servicos.length, 1,
      "o serviço acabado de criar não pode desaparecer da UI só por se ter clicado em \"Atualizar\" durante a gravação pendente"
    );
    assert.equal(store.getState().servicos[0].nome, "Serviço Novo");

    // e a gravação (agora já forçada por garantirEstadoLocalGravado, antes
    // do refresh) tem de ter mesmo chegado ao servidor — não só ficado
    // "escondida" no store local para reaparecer e voltar a desaparecer.
    assert.equal(dataStore.servidor.servicos.length, 1, "o serviço tem de já ter sido gravado no servidor antes do refresh substituir o estado");
    assert.equal(dataStore.servidor.servicos[0].nome, "Serviço Novo");
  });

  test("se a gravação forçada falhar (ex.: erro de rede momentâneo só na escrita), o refresh ABORTA em vez de apagar a alteração local ainda não confirmada", async () => {
    const dataStore = fakeDataStore({
      categorias: [{ id: "cat_indefinida", nome: "Categoria Indefinida", sistema: true, ordem: 9999 }],
      config: { atalhosModulosCriados: true }
    });
    const store = novoStore();
    const actions = createActions(store, dataStore);
    await actions.iniciar();

    await actions.criarServico({ nome: "Serviço Frágil", tipo: "url", url: "https://x.pt" });
    assert.equal(store.getState().servicos.length, 1, "o dispatch otimista já devia ter colocado o serviço no store local");

    // simula a gravação a falhar (ex.: um erro de rede momentâneo só no
    // pedido de escrita) — flushSyncInterno apanha isto sozinho e só marca
    // syncStatus:"error", nunca rejeita, por isso é preciso simular
    // exatamente essa falha silenciosa para testar a proteção extra.
    dataStore.putAll = async () => { throw new Error("falha de rede simulada, só na escrita"); };

    dataStore.chamadas.length = 0;
    await actions.recarregarDoServidor(); // nunca rejeita (o próprio recarregarDoServidor apanha o erro), mas não pode ter avançado para o refresh

    assert.equal(store.getState().syncStatus, "error", "o estado de sincronização tem de refletir a falha");
    assert.equal(
      store.getState().servicos.length, 1,
      "o serviço criado NÃO pode desaparecer da UI só porque a gravação falhou e um refresh foi tentado a seguir"
    );
    assert.equal(store.getState().servicos[0].nome, "Serviço Frágil");
    const chegouARefrescar = dataStore.chamadas.some((c) => c.op === "refresh" || c.op === "getAll");
    assert.equal(chegouARefrescar, false, "o refresh tem de abortar ANTES de ir buscar o estado ao servidor, nunca substituir a UI por um retrato sem a alteração falhada");
  });

  test("sem nenhuma escrita pendente, recarregarDoServidor() não faz nenhuma gravação extra (continua \"barato\")", async () => {
    const dataStore = fakeDataStore({
      categorias: [{ id: "cat_indefinida", nome: "Categoria Indefinida", sistema: true, ordem: 9999 }],
      config: { atalhosModulosCriados: true }
    });
    const store = novoStore();
    const actions = createActions(store, dataStore);
    await actions.iniciar();

    dataStore.chamadas.length = 0;
    await actions.recarregarDoServidor();

    const putAlls = dataStore.chamadas.filter(c => c.op === "putAll");
    assert.equal(putAlls.length, 0, "sem nada pendente, o refresh não devia disparar nenhum putAll (só o getAll normal do iniciar())");
  });

  test("duas criações seguidas (o debounce agrupa-as) e um refresh a seguir preservam AMBAS", async () => {
    const dataStore = fakeDataStore({
      categorias: [{ id: "cat_indefinida", nome: "Categoria Indefinida", sistema: true, ordem: 9999 }],
      config: { atalhosModulosCriados: true }
    });
    const store = novoStore();
    const actions = createActions(store, dataStore);
    await actions.iniciar();

    await actions.criarServico({ nome: "Primeiro", tipo: "url", url: "https://a.pt" });
    await actions.criarServico({ nome: "Segundo", tipo: "url", url: "https://b.pt" });
    assert.equal(store.getState().servicos.length, 2);
    assert.equal(dataStore.servidor.servicos.length, 0, "ainda nenhuma das duas devia ter sido gravada (debounce agrupa-as numa só)");

    await actions.recarregarDoServidor();

    const nomes = store.getState().servicos.map(s => s.nome).sort();
    assert.deepEqual(nomes, ["Primeiro", "Segundo"]);
    assert.equal(dataStore.servidor.servicos.length, 2);
  });

  test("farmácia recém-criada: recarregarDoServidor() espera pelo \"seeding\" dos atalhos dos módulos em fundo antes de ir ao servidor (garantirEstadoLocalGravado)", async () => {
    // config vazio -> atalhosModulosCriados por definir -> iniciar() dispara
    // o seeding em fundo (ver criarAtalhosModulos), tal como acontece no
    // primeiro arranque de uma farmácia nova/de teste. Gate manual (em vez
    // de setImmediate/temporizadores, que dependem da ordem exata das
    // microtasks internas de iniciar() e são frágeis) — só deixa o putAll
    // da gravação dos atalhos terminar quando o teste mandar.
    const dataStore = fakeDataStore({ categorias: [], config: {} });
    let liberarSeedingServicos;
    const gateSeedingServicos = new Promise((resolve) => { liberarSeedingServicos = resolve; });
    const putAllOriginal = dataStore.putAll.bind(dataStore);
    let primeiraGravacaoServicos = true;
    dataStore.putAll = async (nome, items) => {
      if (nome === "servicos" && primeiraGravacaoServicos) {
        primeiraGravacaoServicos = false;
        await gateSeedingServicos; // só continua quando o teste libertar
      }
      return putAllOriginal(nome, items);
    };

    const store = novoStore();
    const actions = createActions(store, dataStore);

    await actions.iniciar();
    assert.ok(store.getState().servicos.some((s) => s.tipo === "modulo"), "os atalhos dos módulos já deviam estar no store local (otimista)");
    // neste ponto o "seeding" em fundo está preso no putAll("servicos",...) —
    // ainda não gravou nada no servidor nem chegou ao setConfig final.
    assert.equal(dataStore.servidor.servicos.length, 0, "a gravação de fundo dos atalhos ainda não devia ter chegado ao servidor");

    const chamadasAntesDoRefresh = dataStore.chamadas.length;
    const promessaRefresh = actions.recarregarDoServidor();
    // dá uma oportunidade a qualquer microtask síncrona de recarregarDoServidor
    // correr — se NÃO estiver a respeitar o gate, o refresh().getAll já
    // teria sido registado em `chamadas` neste ponto, antes de libertarmos o seeding.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const refreshJaFezChamadasAoServidor = dataStore.chamadas.slice(chamadasAntesDoRefresh).some((c) => c.op === "refresh" || c.op === "getAll");
    assert.equal(refreshJaFezChamadasAoServidor, false,
      "recarregarDoServidor() não pode ir ao servidor enquanto o seeding dos atalhos ainda estiver em curso (tem de esperar por atalhosSeedEmCurso)");

    liberarSeedingServicos();
    await promessaRefresh;

    // Depois de tudo assentar: nem desaparecem, nem duplicam (duplicavam-se
    // se o 2º iniciar(), chamado de dentro do refresh, visse
    // "atalhosModulosCriados" ainda por gravar e voltasse a semeá-los do
    // zero, com ids novos).
    const atalhosNoStore = store.getState().servicos.filter((s) => s.tipo === "modulo");
    assert.equal(atalhosNoStore.length, MODULOS_ATALHOS.length, "os atalhos dos módulos não podem desaparecer NEM duplicar-se por causa do refresh");
    const atalhosNoServidor = dataStore.servidor.servicos.filter((s) => s.tipo === "modulo");
    assert.equal(atalhosNoServidor.length, MODULOS_ATALHOS.length, "o servidor também não pode acabar com atalhos duplicados");
  });
});
