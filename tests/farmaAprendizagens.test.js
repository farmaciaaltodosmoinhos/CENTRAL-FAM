process.env.AUTH_JWT_SECRET = "segredo-de-teste-bem-comprido-0123456789";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../netlify/functions/farma-aprendizagens.js";
import { signToken } from "../netlify/functions/_lib/auth.js";
import { fakeStoreFactory } from "./_fakeStore.js";

const N_DIMS = 288;
function vetor(seed) {
  // vetor determinístico só para os testes, não precisa de vir de extrairFeatures real.
  return Array.from({ length: N_DIMS }, (_, i) => Math.sin(seed + i) * 0.01);
}

const tokenA = signToken({ tenantId: "tenant-A", email: "a@x.pt", nomeFarmacia: "Farmácia A" });
const tokenB = signToken({ tenantId: "tenant-B", email: "b@x.pt", nomeFarmacia: "Farmácia B" });

function reqGet(token) {
  return new Request("https://site.netlify.app/api/farma-aprendizagens", {
    method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
function reqPost(token, body) {
  return new Request("https://site.netlify.app/api/farma-aprendizagens", {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe("/api/farma-aprendizagens — autenticação", () => {
  test("sem token devolve 401, tanto em GET como em POST", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    assert.equal((await handleRequest(reqGet(null), getStoreImpl)).status, 401);
    assert.equal((await handleRequest(reqPost(null, { padroes: [] }), getStoreImpl)).status, 401);
  });
});

describe("/api/farma-aprendizagens — GET devolve estado vazio por omissão", () => {
  test("sem nenhuma contribuição ainda, devolve listas vazias e contagem zero", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqGet(tokenA), getStoreImpl);
    const corpo = await res.json();
    assert.deepEqual(corpo.padroes, []);
    assert.equal(corpo.farmaciasContribuintes, 0);
    assert.equal(corpo.estatisticas.totalContribuicoes, 0);
  });
});

describe("/api/farma-aprendizagens — contribuição válida", () => {
  test("um padrão válido (intentId + vetor do tamanho certo) é aceite e aparece no GET seguinte", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const resPost = await handleRequest(
      reqPost(tokenA, { padroes: [{ intentId: "alertas_resumo", features: vetor(1) }] }),
      getStoreImpl
    );
    assert.equal(resPost.status, 200);
    const corpoPost = await resPost.json();
    assert.equal(corpoPost.padroesAceites, 1);

    const corpoGet = await (await handleRequest(reqGet(tokenA), getStoreImpl)).json();
    assert.equal(corpoGet.padroes.length, 1);
    assert.equal(corpoGet.padroes[0].intentId, "alertas_resumo");
    assert.equal(corpoGet.padroes[0].features.length, N_DIMS);
  });

  test("estatísticas agregadas (contagens por intent) somam-se ao longo de várias contribuições", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(reqPost(tokenA, { estatisticas: { contagensPorIntent: { validade: 3, alertas_resumo: 1 } } }), getStoreImpl);
    await handleRequest(reqPost(tokenB, { estatisticas: { contagensPorIntent: { validade: 2 } } }), getStoreImpl);

    const corpo = await (await handleRequest(reqGet(tokenA), getStoreImpl)).json();
    assert.equal(corpo.estatisticas.contagensPorIntent.validade, 5);
    assert.equal(corpo.estatisticas.contagensPorIntent.alertas_resumo, 1);
    assert.equal(corpo.estatisticas.totalContribuicoes, 2);
  });

  test("duas farmácias diferentes contam como 2 contribuintes; a mesma farmácia repetida conta 1 só vez", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(reqPost(tokenA, { padroes: [{ intentId: "validade", features: vetor(2) }] }), getStoreImpl);
    await handleRequest(reqPost(tokenA, { padroes: [{ intentId: "validade", features: vetor(3) }] }), getStoreImpl);
    await handleRequest(reqPost(tokenB, { padroes: [{ intentId: "validade", features: vetor(4) }] }), getStoreImpl);

    const corpo = await (await handleRequest(reqGet(tokenA), getStoreImpl)).json();
    assert.equal(corpo.farmaciasContribuintes, 2);
  });
});

describe("/api/farma-aprendizagens — nunca guarda nem devolve dados identificáveis", () => {
  test("a resposta do GET nunca contém tenantId, email ou 'contribuintes'", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(reqPost(tokenA, { padroes: [{ intentId: "validade", features: vetor(5) }] }), getStoreImpl);
    const texto = JSON.stringify(await (await handleRequest(reqGet(tokenA), getStoreImpl)).json());
    assert.ok(!texto.includes("tenant-A"));
    assert.ok(!texto.includes("a@x.pt"));
    assert.ok(!texto.includes("contribuintes"));
  });

  test("a store subjacente nunca tem uma chave prefixada por tenantId (ao contrário de /api/data)", async () => {
    const { getStoreImpl, blobs } = fakeStoreFactory();
    await handleRequest(reqPost(tokenA, { padroes: [{ intentId: "validade", features: vetor(6) }] }), getStoreImpl);
    for (const chave of blobs.keys()) {
      assert.ok(!chave.includes("tenant-A"));
    }
  });

  test("o pseudónimo de farmácia guardado no lado do servidor não é o tenantId nem um hash previsível óbvio", async () => {
    const { getStoreImpl, blobs } = fakeStoreFactory();
    await handleRequest(reqPost(tokenA, { padroes: [{ intentId: "validade", features: vetor(7) }] }), getStoreImpl);
    const estadoGuardado = blobs.get("aprendizagens");
    assert.equal(estadoGuardado.contribuintes.length, 1);
    assert.notEqual(estadoGuardado.contribuintes[0], "tenant-A");
    assert.equal(estadoGuardado.contribuintes[0].length, 64); // hex de sha256
  });
});

describe("/api/farma-aprendizagens — validação recusa texto livre e formas inválidas", () => {
  test("um 'padrão' com texto em vez de vetor de features é rejeitado (nunca guardado)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(
      reqPost(tokenA, { padroes: [{ intentId: "validade", texto: "isto é uma pergunta real do utilizador" }] }),
      getStoreImpl
    );
    assert.equal(res.status, 400); // nada válido sobrou
  });

  test("um vetor de tamanho errado é filtrado, o resto do pedido continua a funcionar", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(
      reqPost(tokenA, {
        padroes: [
          { intentId: "validade", features: vetor(8) },
          { intentId: "validade", features: [1, 2, 3] }, // tamanho errado
        ],
      }),
      getStoreImpl
    );
    const corpo = await res.json();
    assert.equal(corpo.padroesAceites, 1);
    assert.equal(corpo.padroesRecebidosMasInvalidos, 1);
  });

  test("um intentId com formato estranho (maiúsculas, espaços, símbolos) é rejeitado", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(
      reqPost(tokenA, { padroes: [{ intentId: "Bloco de Notas <script>", features: vetor(9) }] }),
      getStoreImpl
    );
    assert.equal(res.status, 400);
  });

  test("estatísticas com valores não-inteiros ou negativos são descartadas silenciosamente", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(
      reqPost(tokenA, { estatisticas: { contagensPorIntent: { validade: -5, alertas_resumo: 3.5, utentes: "muitas" } } }),
      getStoreImpl
    );
    assert.equal(res.status, 400); // nada sobrou de válido
  });

  test("corpo não-JSON devolve 400, nunca 500", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const req = new Request("https://site.netlify.app/api/farma-aprendizagens", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenA}` }, body: "{ não é json",
    });
    assert.equal((await handleRequest(req, getStoreImpl)).status, 400);
  });

  test("mais de 100 padrões num único pedido são cortados ao limite, nunca aceites todos de uma vez", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const muitos = Array.from({ length: 250 }, (_, i) => ({ intentId: "validade", features: vetor(100 + i) }));
    const res = await handleRequest(reqPost(tokenA, { padroes: muitos }), getStoreImpl);
    const corpo = await res.json();
    assert.equal(corpo.padroesAceites, 100);
  });

  test("método não suportado devolve 405", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const req = new Request("https://site.netlify.app/api/farma-aprendizagens", { method: "DELETE", headers: { authorization: `Bearer ${tokenA}` } });
    assert.equal((await handleRequest(req, getStoreImpl)).status, 405);
  });

  test("quando getStoreImpl falha (Blobs indisponível), devolve 500 em vez de rebentar", async () => {
    const getStoreImplQuebrado = () => { throw new Error("Blobs indisponível"); };
    const res = await handleRequest(reqGet(tokenA), getStoreImplQuebrado);
    assert.equal(res.status, 500);
  });
});

describe("/api/farma-aprendizagens — limite total de padrões guardados", () => {
  test("acima do limite, os padrões mais antigos saem para dar lugar aos novos", async () => {
    const { getStoreImpl, blobs } = fakeStoreFactory({
      aprendizagens: {
        padroes: Array.from({ length: 4000 }, (_, i) => ({ intentId: "validade", features: vetor(i) })),
        estatisticas: { contagensPorIntent: {}, totalContribuicoes: 0 },
        contribuintes: [],
        ultimaAtualizacao: null,
      },
    });
    await handleRequest(reqPost(tokenA, { padroes: [{ intentId: "alertas_resumo", features: vetor(9999) }] }), getStoreImpl);
    const estado = blobs.get("aprendizagens");
    assert.equal(estado.padroes.length, 4000); // continua no limite, não cresce sem parar
    assert.equal(estado.padroes[estado.padroes.length - 1].intentId, "alertas_resumo"); // o novo entrou
  });
});
