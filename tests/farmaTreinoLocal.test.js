import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { treinarLocal, verificarSanidade, LIMIAR_SANIDADE_MINIMO } from "../src/farmaTreinoLocal.js";
import { preverIntent } from "../src/farmaRede.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pesos reais de produção (ponto 42/43) — usados para confirmar que
// `verificarSanidade` reconhece um modelo bom como bom (não só que rejeita
// um mau), sem treinar nada de novo para isso (rápido).
const pesosReais = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "farmaRedePesos.json"), "utf8"));

describe("farmaTreinoLocal.js — verificarSanidade", () => {
  test("os pesos reais de produção passam claramente no limiar de sanidade", () => {
    const sanidade = verificarSanidade(pesosReais);
    assert.ok(sanidade >= LIMIAR_SANIDADE_MINIMO, `esperava sanidade >= ${LIMIAR_SANIDADE_MINIMO}, obteve ${sanidade}`);
  });

  test("um modelo sem qualquer treino (pesos a zeros) fica claramente abaixo do limiar", () => {
    const nDims = 32, nEsconida = 8;
    const intents = pesosReais.intents;
    const pesosVazios = {
      nDims, intents,
      camada1: { W: Array.from({ length: nEsconida }, () => new Array(nDims).fill(0)), b: new Array(nEsconida).fill(0) },
      camada2: { W: Array.from({ length: intents.length }, () => new Array(nEsconida).fill(0)), b: new Array(intents.length).fill(0) },
    };
    // pesos a zeros dão sempre a mesma saída (uniforme) para qualquer frase
    // — no melhor caso acerta só por sorte numa fração pequena das frases.
    const sanidade = verificarSanidade(pesosVazios);
    assert.ok(sanidade < LIMIAR_SANIDADE_MINIMO, `esperava sanidade < ${LIMIAR_SANIDADE_MINIMO}, obteve ${sanidade}`);
  });
});

describe("farmaTreinoLocal.js — treinarLocal (rejeição sem treinar)", () => {
  test("menos aliases válidos do que o mínimo é rejeitado, sem pesos", async () => {
    const r = await treinarLocal([["quantos alertas há hoje", "alertas_resumo"]]);
    assert.equal(r.aceite, false);
    assert.equal(r.pesos, null);
    assert.match(r.relatorio.motivo, /pelo menos 3/);
  });

  test("aliases com intentId desconhecido são ignorados e contam como zero válidos", async () => {
    const r = await treinarLocal([
      ["frase qualquer", "intent_que_nao_existe"],
      ["outra frase", "intent_que_nao_existe"],
      ["mais uma frase", "intent_que_nao_existe"],
    ]);
    assert.equal(r.aceite, false);
    assert.match(r.relatorio.motivo, /tem 0/);
  });

  test("lista vazia ou nula não rebenta — é tratada como zero aliases", async () => {
    const r1 = await treinarLocal([]);
    assert.equal(r1.aceite, false);
    const r2 = await treinarLocal(null);
    assert.equal(r2.aceite, false);
  });

  test("respeita um `minimoAliases` diferente do omitido por omissão", async () => {
    const r = await treinarLocal([
      ["dá-me o resumo de alertas", "alertas_resumo"],
      ["quero ver a validade dos produtos", "validade"],
    ], { minimoAliases: 2 });
    // com só 2 exigidos e 2 válidos, passa da barreira de quantidade — segue para o treino real.
    assert.notEqual(r.relatorio.motivo && r.relatorio.motivo.includes("pelo menos"), true);
  });
});

describe("farmaTreinoLocal.js — treinarLocal (treino real, mais lento)", () => {
  test("com aliases suficientes e válidos, treina, passa a sanidade e devolve pesos utilizáveis", async () => {
    const aliasesReais = [
      ["dá-me o resumo de alertas da farmácia", "alertas_resumo"],
      ["quero ver os medicamentos a validar em breve", "validade"],
      ["mostra-me a lista de utentes cadastrados", "utentes"],
      ["há novidades nos pedidos de aue", "pedidos_aue"],
      ["preciso de ver os manipulados em curso", "pedidos_manipulados"],
    ];
    const r = await treinarLocal(aliasesReais, { semente: 42 });

    assert.equal(r.aceite, true);
    assert.ok(r.pesos);
    assert.equal(r.pesos.intents.length, pesosReais.intents.length);
    assert.ok(r.relatorio.sanidade >= LIMIAR_SANIDADE_MINIMO);
    assert.ok(r.relatorio.exatidaoValidacao > 0 && r.relatorio.exatidaoValidacao <= 1);
    assert.equal(r.relatorio.aliasesIncluidos, 5);
    assert.ok(r.relatorio.totalExemplos > 290); // dataset base (298) + 5 aliases, menos o corte de validação não conta aqui
    assert.ok(r.relatorio.treinadoEm);

    // os pesos devolvidos são um modelo de verdade, usável por preverIntent —
    // não só um objeto com a forma certa.
    const { previsoes } = preverIntent("dá-me o resumo de alertas da farmácia", r.pesos);
    assert.equal(previsoes[0].intentId, "alertas_resumo");
  });

  test("aceita padrões partilhados de outras farmácias (ponto 43, Função 4) já vetorizados, sem texto", async () => {
    const aliasesReais = [
      ["dá-me o resumo de alertas da farmácia", "alertas_resumo"],
      ["quero ver os medicamentos a validar em breve", "validade"],
      ["mostra-me a lista de utentes cadastrados", "utentes"],
    ];
    // simula padrões vindos de /api/farma-aprendizagens — já vetores, nunca texto.
    const padroesPartilhados = [
      { intentId: "pedidos_aue", features: new Array(288).fill(0).map((_, i) => Math.sin(i) * 0.02) },
      { intentId: "backup", features: new Array(288).fill(0).map((_, i) => Math.cos(i) * 0.02) },
    ];
    const r = await treinarLocal(aliasesReais, { semente: 11, padroesPartilhados });
    assert.equal(r.aceite, true);
    assert.equal(r.relatorio.padroesPartilhadosIncluidos, 2);
    assert.ok(r.relatorio.totalExemplos > 300); // dataset base + 3 aliases + 2 padrões partilhados
  });

  test("padrões partilhados com forma inválida (vetor de tamanho errado, intentId desconhecido) são ignorados, nunca rebentam o treino", async () => {
    const aliasesReais = [
      ["dá-me o resumo de alertas", "alertas_resumo"],
      ["quero ver a validade", "validade"],
      ["utentes cadastrados", "utentes"],
    ];
    const padroesInvalidos = [
      { intentId: "pedidos_aue", features: [1, 2, 3] }, // tamanho errado
      { intentId: "intent_que_nao_existe", features: new Array(288).fill(0.01) },
      { intentId: "backup" }, // sem features
      null,
    ];
    const r = await treinarLocal(aliasesReais, { semente: 12, padroesPartilhados: padroesInvalidos });
    assert.equal(r.aceite, true);
    assert.equal(r.relatorio.padroesPartilhadosIncluidos, 0);
  });

  test("é determinístico para a mesma semente — mesmos aliases, mesmo resultado", async () => {
    const aliases = [
      ["quero saber quantos alertas tenho agora", "alertas_resumo"],
      ["há stock com validade a aproximar-se", "validade"],
      ["quantos utentes estão registados", "utentes"],
      ["algum pedido aue novo", "pedidos_aue"],
    ];
    const r1 = await treinarLocal(aliases, { semente: 7 });
    const r2 = await treinarLocal(aliases, { semente: 7 });
    assert.equal(r1.relatorio.exatidaoValidacao, r2.relatorio.exatidaoValidacao);
    assert.deepEqual(r1.pesos.camada1.W[0], r2.pesos.camada1.W[0]);
  });
});
