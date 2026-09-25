import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  partilhaAtiva, prepararPadroesParaContribuir, calcularContagensPorIntent,
  prepararContribuicao, filtrarPadroesRecebidos, resumirConhecimentoPartilhado,
} from "../src/farmaAprendizagemMultifarma.js";

const N_DIMS = 288;

describe("farmaAprendizagemMultifarma.js — partilhaAtiva", () => {
  test("desligada por omissão (config vazia, ausente, ou sem o campo)", () => {
    assert.equal(partilhaAtiva(undefined), false);
    assert.equal(partilhaAtiva({}), false);
    assert.equal(partilhaAtiva({ farmaAprendizagemMultifarma: {} }), false);
    assert.equal(partilhaAtiva({ farmaAprendizagemMultifarma: { ativo: false } }), false);
  });
  test("só fica ativa com ativo === true explícito", () => {
    assert.equal(partilhaAtiva({ farmaAprendizagemMultifarma: { ativo: true } }), true);
  });
});

describe("farmaAprendizagemMultifarma.js — prepararPadroesParaContribuir", () => {
  test("converte aliases [texto, intentId] em padrões {intentId, features}, nunca com o texto", () => {
    const aliases = [["dá-me o resumo de alertas", "alertas_resumo"], ["quero ver a validade", "validade"]];
    const padroes = prepararPadroesParaContribuir(aliases);
    assert.equal(padroes.length, 2);
    for (const p of padroes) {
      assert.equal(typeof p.intentId, "string");
      assert.equal(p.features.length, N_DIMS);
      assert.ok(!("texto" in p));
      assert.ok(JSON.stringify(p).indexOf("resumo de alertas") === -1); // o texto literal nunca aparece no padrão
    }
  });

  test("ignora entradas malformadas (texto vazio, intentId em falta) sem rebentar", () => {
    const aliases = [["", "alertas_resumo"], ["texto ok", ""], ["texto bom", "validade"], null];
    const padroes = prepararPadroesParaContribuir(aliases);
    assert.equal(padroes.length, 1);
    assert.equal(padroes[0].intentId, "validade");
  });

  test("respeita o limite passado, cortando a lista", () => {
    const aliases = Array.from({ length: 10 }, (_, i) => [`frase ${i}`, "ajuda"]);
    assert.equal(prepararPadroesParaContribuir(aliases, 3).length, 3);
  });

  test("lista vazia/nula devolve lista vazia", () => {
    assert.deepEqual(prepararPadroesParaContribuir([]), []);
    assert.deepEqual(prepararPadroesParaContribuir(null), []);
  });
});

describe("farmaAprendizagemMultifarma.js — calcularContagensPorIntent", () => {
  test("conta corretamente por intent, nunca guarda o texto", () => {
    const aliases = [["a", "validade"], ["b", "validade"], ["c", "alertas_resumo"]];
    assert.deepEqual(calcularContagensPorIntent(aliases), { validade: 2, alertas_resumo: 1 });
  });
  test("lista vazia dá objeto vazio", () => {
    assert.deepEqual(calcularContagensPorIntent([]), {});
  });
});

describe("farmaAprendizagemMultifarma.js — prepararContribuicao", () => {
  test("monta o corpo completo do pedido (padrões + estatísticas)", () => {
    const aliases = [["dá-me o resumo", "alertas_resumo"], ["outra frase", "alertas_resumo"]];
    const corpo = prepararContribuicao(aliases);
    assert.equal(corpo.padroes.length, 2);
    assert.deepEqual(corpo.estatisticas.contagensPorIntent, { alertas_resumo: 2 });
  });
});

describe("farmaAprendizagemMultifarma.js — filtrarPadroesRecebidos (nunca confia cegamente na rede)", () => {
  const intentsConhecidos = ["alertas_resumo", "validade"];
  function vetorOk() { return new Array(N_DIMS).fill(0.01); }

  test("aceita só padrões com forma válida e intentId conhecido", () => {
    const recebidos = [
      { intentId: "validade", features: vetorOk() },
      { intentId: "intent_desconhecido", features: vetorOk() },
      { intentId: "alertas_resumo", features: [1, 2, 3] }, // tamanho errado
      { intentId: "alertas_resumo", texto: "isto não devia vir" }, // sem features
      null,
    ];
    const filtrados = filtrarPadroesRecebidos(recebidos, intentsConhecidos);
    assert.equal(filtrados.length, 1);
    assert.equal(filtrados[0].intentId, "validade");
  });

  test("entrada não-array devolve lista vazia sem rebentar", () => {
    assert.deepEqual(filtrarPadroesRecebidos(null, intentsConhecidos), []);
    assert.deepEqual(filtrarPadroesRecebidos(undefined, intentsConhecidos), []);
    assert.deepEqual(filtrarPadroesRecebidos("não é lista", intentsConhecidos), []);
  });

  test("respeita o limite, mantendo os mais recentes (últimos da lista)", () => {
    const recebidos = Array.from({ length: 10 }, (_, i) => ({ intentId: "validade", features: vetorOk(), marca: i }));
    const filtrados = filtrarPadroesRecebidos(recebidos, intentsConhecidos, 3);
    assert.equal(filtrados.length, 3);
    assert.deepEqual(filtrados.map((p) => p.marca), [7, 8, 9]);
  });
});

describe("farmaAprendizagemMultifarma.js — resumirConhecimentoPartilhado", () => {
  test("estado ausente/nulo devolve um resumo vazio coerente, sem rebentar", () => {
    assert.deepEqual(resumirConhecimentoPartilhado(null), { totalPadroes: 0, farmaciasContribuintes: 0, intentsComMaisContribuicoes: [] });
  });

  test("resume corretamente um estado real vindo do servidor", () => {
    const estado = {
      padroes: [{}, {}, {}],
      farmaciasContribuintes: 4,
      estatisticas: { contagensPorIntent: { validade: 10, alertas_resumo: 25, ajuda: 3 } },
    };
    const resumo = resumirConhecimentoPartilhado(estado);
    assert.equal(resumo.totalPadroes, 3);
    assert.equal(resumo.farmaciasContribuintes, 4);
    assert.deepEqual(resumo.intentsComMaisContribuicoes[0], { intentId: "alertas_resumo", total: 25 });
  });
});
