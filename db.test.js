/**
 * tests/db.test.js — Ponto 57: gravações concorrentes de duas
 * abas/computadores não se devem apagar uma à outra.
 *
 * Reproduz em Node (sem browser) exatamente o que o Playwright confirmou
 * manualmente durante a investigação: duas "abas" independentes (dois
 * módulos src/db.js importados à parte, para cada uma ter o seu próprio
 * cache em memória — em produção seria cada separador/computador) a falar
 * com o MESMO servidor (aqui, a lógica real de netlify/functions/data.js,
 * tal como tests/data.test.js já usa, contra um blob store falso).
 */
process.env.AUTH_JWT_SECRET = "segredo-de-teste-bem-comprido-0123456789";

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../netlify/functions/data.js";
import { signToken } from "../netlify/functions/_lib/auth.js";
import { fakeStoreFactory } from "./_fakeStore.js";
import { __calcularDiffParaTeste as calcularDiff, __aplicarDiffParaTeste as aplicarDiff } from "../src/db.js";

const token = signToken({ tenantId: "tenant-conc", email: "x@x.pt", nomeFarmacia: "Farmácia Concorrência" });

/** Polyfill mínimo de localStorage (Node não tem um global) — só o que authClient.js usa. */
class FakeLocalStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

let contadorImport = 0;
/** Cada chamada devolve uma instância NOVA do módulo db.js (cache module-level próprio) — simula uma aba/computador novo. */
async function novaAba() {
  contadorImport++;
  return import(`../src/db.js?dbtest=${contadorImport}`);
}

function instalarFetchFalso(getStoreImpl) {
  global.fetch = async (url, opts = {}) => {
    const req = new Request(new URL(String(url), "https://site.netlify.app"), opts);
    return handleRequest(req, getStoreImpl);
  };
}

describe("db.js — calcularDiff/aplicarDiff (ponto 57, funções puras)", () => {
  test("nenhuma alteração -> nenhuma diferença", () => {
    const antes = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }];
    const depois = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }];
    const diff = calcularDiff(antes, depois);
    assert.deepEqual(diff, { adicionados: [], atualizados: [], removidosIds: [] });
  });

  test("um item novo -> só ele entra em adicionados", () => {
    const antes = [{ id: "a", nome: "A" }];
    const depois = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }];
    const diff = calcularDiff(antes, depois);
    assert.deepEqual(diff.adicionados, [{ id: "b", nome: "B" }]);
    assert.deepEqual(diff.atualizados, []);
    assert.deepEqual(diff.removidosIds, []);
  });

  test("um item removido -> só o seu id entra em removidosIds", () => {
    const antes = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }];
    const depois = [{ id: "a", nome: "A" }];
    const diff = calcularDiff(antes, depois);
    assert.deepEqual(diff.removidosIds, ["b"]);
    assert.deepEqual(diff.adicionados, []);
    assert.deepEqual(diff.atualizados, []);
  });

  test("um item com conteúdo diferente -> entra em atualizados (não em adicionados)", () => {
    const antes = [{ id: "a", nome: "A" }];
    const depois = [{ id: "a", nome: "A renomeado" }];
    const diff = calcularDiff(antes, depois);
    assert.deepEqual(diff.atualizados, [{ id: "a", nome: "A renomeado" }]);
    assert.deepEqual(diff.adicionados, []);
  });

  test("aplicarDiff sobre uma lista fresca preserva itens não tocados pela diferença", () => {
    const fresca = [{ id: "a", nome: "A" }, { id: "x", nome: "Feito por outra aba" }];
    const diff = { adicionados: [{ id: "b", nome: "B" }], atualizados: [], removidosIds: [] };
    const resultado = aplicarDiff(fresca, diff);
    const porId = Object.fromEntries(resultado.map(i => [i.id, i]));
    assert.ok(porId.x, "o item 'x', que esta diferença nunca tocou, tem de sobreviver");
    assert.ok(porId.a);
    assert.ok(porId.b);
  });

  test("aplicarDiff remove exatamente os ids marcados, mesmo que a lista fresca tenha outros itens novos", () => {
    const fresca = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }, { id: "novo-de-outra-aba", nome: "Novo" }];
    const diff = { adicionados: [], atualizados: [], removidosIds: ["b"] };
    const resultado = aplicarDiff(fresca, diff);
    const ids = resultado.map(i => i.id).sort();
    assert.deepEqual(ids, ["a", "novo-de-outra-aba"]);
  });
});

describe("db.js — putAll(), duas abas concorrentes (ponto 57, integração com o servidor real)", () => {
  beforeEach(() => {
    global.localStorage = new FakeLocalStorage();
    global.localStorage.setItem("central_saas_token", token);
  });

  test("B cria o seu serviço depois de A (com 409 pelo meio) sem apagar o serviço de A", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    instalarFetchFalso(getStoreImpl);

    const dbA = (await novaAba()).makeDataStore();
    const dbB = (await novaAba()).makeDataStore();

    // as duas abas arrancam do mesmo estado vazio (cada uma com o seu próprio cache local)
    await dbA.getAll("servicos");
    await dbB.getAll("servicos");

    // A cria e grava o seu serviço com sucesso
    await dbA.putAll("servicos", [{ id: "srv-a", nome: "Serviço A", ordem: 0 }]);

    // B, com a cache desatualizada (nunca viu o de A), cria o SEU e grava —
    // isto tem de entrar em conflito de revisão (409) e recuperar sozinho
    await dbB.putAll("servicos", [{ id: "srv-b", nome: "Serviço B", ordem: 0 }]);

    const resFinal = await handleRequest(
      new Request("https://site.netlify.app/api/data", { headers: { authorization: `Bearer ${token}` } }),
      getStoreImpl
    );
    const estadoFinal = await resFinal.json();
    const ids = estadoFinal.servicos.map(s => s.id).sort();
    assert.deepEqual(ids, ["srv-a", "srv-b"], "os DOIS serviços, criados por abas diferentes, têm de sobreviver");
  });

  test("uma remoção feita por B é respeitada, e uma adição feita por A não é anulada, mesmo em conflito", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    instalarFetchFalso(getStoreImpl);

    // estado inicial: 2 serviços já gravados
    const dbSeed = (await novaAba()).makeDataStore();
    await dbSeed.getAll("servicos");
    await dbSeed.putAll("servicos", [
      { id: "s1", nome: "Serviço 1", ordem: 0 },
      { id: "s2", nome: "Serviço 2", ordem: 1 }
    ]);

    // A e B arrancam cada uma do mesmo estado (s1, s2)
    const dbA = (await novaAba()).makeDataStore();
    const dbB = (await novaAba()).makeDataStore();
    await dbA.getAll("servicos");
    await dbB.getAll("servicos");

    // A acrescenta um 3º serviço e grava com sucesso
    await dbA.putAll("servicos", [
      { id: "s1", nome: "Serviço 1", ordem: 0 },
      { id: "s2", nome: "Serviço 2", ordem: 1 },
      { id: "s3", nome: "Serviço 3 (criado por A)", ordem: 2 }
    ]);

    // B, sem saber do s3, remove o s2 localmente e grava — entra em conflito (409) e recupera
    await dbB.putAll("servicos", [
      { id: "s1", nome: "Serviço 1", ordem: 0 }
    ]);

    const resFinal = await handleRequest(
      new Request("https://site.netlify.app/api/data", { headers: { authorization: `Bearer ${token}` } }),
      getStoreImpl
    );
    const estadoFinal = await resFinal.json();
    const ids = estadoFinal.servicos.map(s => s.id).sort();
    // s2 foi mesmo removido (o que B pediu) e s3 sobreviveu (o que A acrescentou, e que B nunca tocou)
    assert.deepEqual(ids, ["s1", "s3"]);
  });

  test("a mesma proteção aplica-se a 'categorias' (não só a 'servicos')", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    instalarFetchFalso(getStoreImpl);

    const dbA = (await novaAba()).makeDataStore();
    const dbB = (await novaAba()).makeDataStore();
    await dbA.getAll("categorias");
    await dbB.getAll("categorias");

    await dbA.putAll("categorias", [{ id: "cat-a", nome: "Categoria A", ordem: 0 }]);
    // B, com cache desatualizada, cria a SUA categoria — tem de entrar em conflito e recuperar sozinho
    await dbB.putAll("categorias", [{ id: "cat-b", nome: "Categoria B", ordem: 0 }]);

    const resFinal = await handleRequest(
      new Request("https://site.netlify.app/api/data", { headers: { authorization: `Bearer ${token}` } }),
      getStoreImpl
    );
    const estadoFinal = await resFinal.json();
    const ids = estadoFinal.categorias.map(c => c.id).sort();
    assert.deepEqual(ids, ["cat-a", "cat-b"]);
  });

  test("reordenar serviços existentes (que muda 'ordem' em todos) não apaga um serviço acrescentado por outra aba", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    instalarFetchFalso(getStoreImpl);

    const dbSeed = (await novaAba()).makeDataStore();
    await dbSeed.getAll("servicos");
    await dbSeed.putAll("servicos", [
      { id: "s1", nome: "Serviço 1", ordem: 0 },
      { id: "s2", nome: "Serviço 2", ordem: 1 },
      { id: "s3", nome: "Serviço 3", ordem: 2 }
    ]);

    const dbA = (await novaAba()).makeDataStore(); // vai reordenar
    const dbB = (await novaAba()).makeDataStore(); // vai acrescentar um novo serviço
    await dbA.getAll("servicos");
    await dbB.getAll("servicos");

    // B acrescenta um 4º serviço e grava primeiro, com sucesso
    await dbB.putAll("servicos", [
      { id: "s1", nome: "Serviço 1", ordem: 0 },
      { id: "s2", nome: "Serviço 2", ordem: 1 },
      { id: "s3", nome: "Serviço 3", ordem: 2 },
      { id: "s4", nome: "Serviço 4 (criado por B)", ordem: 3 }
    ]);

    // A, sem saber do s4, reordena os 3 que conhecia (s1 passa a ser o último) — conflito, recupera sozinho
    await dbA.putAll("servicos", [
      { id: "s2", nome: "Serviço 2", ordem: 0 },
      { id: "s3", nome: "Serviço 3", ordem: 1 },
      { id: "s1", nome: "Serviço 1", ordem: 2 }
    ]);

    const resFinal = await handleRequest(
      new Request("https://site.netlify.app/api/data", { headers: { authorization: `Bearer ${token}` } }),
      getStoreImpl
    );
    const estadoFinal = await resFinal.json();
    const porId = Object.fromEntries(estadoFinal.servicos.map(s => [s.id, s]));
    // s4, criado por B e nunca tocado pela reordenação de A, tem de sobreviver
    assert.ok(porId.s4, "o serviço criado por B tem de sobreviver a uma reordenação feita por A");
    // a nova ordem de A (s2=0, s3=1, s1=2) tem de ter sido aplicada aos 3 que ela reordenou
    assert.equal(porId.s2.ordem, 0);
    assert.equal(porId.s3.ordem, 1);
    assert.equal(porId.s1.ordem, 2);
  });

  test("três abas a criar serviços diferentes ao mesmo tempo — nenhuma apaga as outras", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    instalarFetchFalso(getStoreImpl);

    const dbA = (await novaAba()).makeDataStore();
    const dbB = (await novaAba()).makeDataStore();
    const dbC = (await novaAba()).makeDataStore();
    await dbA.getAll("servicos");
    await dbB.getAll("servicos");
    await dbC.getAll("servicos");

    // as três partem todas do mesmo estado vazio, e gravam em sequência — cada uma
    // (exceto a primeira) tem de reagir a pelo menos um conflito de revisão
    await dbA.putAll("servicos", [{ id: "srv-a", nome: "Serviço A", ordem: 0 }]);
    await dbB.putAll("servicos", [{ id: "srv-b", nome: "Serviço B", ordem: 0 }]);
    await dbC.putAll("servicos", [{ id: "srv-c", nome: "Serviço C", ordem: 0 }]);

    const resFinal = await handleRequest(
      new Request("https://site.netlify.app/api/data", { headers: { authorization: `Bearer ${token}` } }),
      getStoreImpl
    );
    const estadoFinal = await resFinal.json();
    const ids = estadoFinal.servicos.map(s => s.id).sort();
    assert.deepEqual(ids, ["srv-a", "srv-b", "srv-c"]);
  });
});
