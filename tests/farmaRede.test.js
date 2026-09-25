import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizarTextoRede, extrairFeatures, avancar, preverIntent, similaridadeCosseno
} from "../src/farmaRede.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pesos reais treinados (ponto 42) — os mesmos que a Central distribui e
// carrega em produção, nunca uns pesos inventados só para o teste. Isto
// significa que estes testes também servem de "prova de fumo" do modelo:
// se alguém regenerar os pesos e a rede deixar de reconhecer o essencial,
// estes testes acusam.
const pesos = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "farmaRedePesos.json"), "utf8"));

describe("farmaRede.js — normalizarTextoRede", () => {
  test("baixa para minúsculas, remove acentos e espaços nas pontas", () => {
    assert.equal(normalizarTextoRede("  Há Validade Próxima  "), "ha validade proxima");
  });

  test("nulo/indefinido/vazio devolvem string vazia", () => {
    assert.equal(normalizarTextoRede(null), "");
    assert.equal(normalizarTextoRede(undefined), "");
    assert.equal(normalizarTextoRede(""), "");
  });
});

describe("farmaRede.js — extrairFeatures", () => {
  test("devolve sempre um vetor do tamanho pedido, mesmo para texto vazio", () => {
    assert.equal(extrairFeatures("qualquer coisa", 256).length, 256);
    assert.equal(extrairFeatures("", 256).length, 256);
    assert.equal(extrairFeatures("x", 64).length, 64);
  });

  test("texto vazio/só espaços dá o vetor todo a zeros", () => {
    assert.ok(extrairFeatures("", 32).every(v => v === 0));
    assert.ok(extrairFeatures("   ", 32).every(v => v === 0));
  });

  test("texto não vazio tem norma L2 igual a 1 (não depende do comprimento da frase)", () => {
    function normaL2(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
    assert.ok(Math.abs(normaL2(extrairFeatures("validade", 256)) - 1) < 1e-9);
    assert.ok(Math.abs(normaL2(extrairFeatures("uma frase bem mais comprida do que a outra para testar", 256)) - 1) < 1e-9);
  });

  test("é determinístico — mesma entrada, mesmo vetor sempre", () => {
    assert.deepEqual(extrairFeatures("caduca em breve", 256), extrairFeatures("caduca em breve", 256));
  });

  test("maiúsculas/acentuação não mudam o vetor (usa a mesma normalização)", () => {
    assert.deepEqual(extrairFeatures("Validade Próxima", 256), extrairFeatures("validade proxima", 256));
  });
});

describe("farmaRede.js — avancar (passagem para a frente)", () => {
  test("a saída tem um valor por intent e soma 1 (softmax válido)", () => {
    const features = extrairFeatures("há alertas por rever", pesos.nDims);
    const { saida } = avancar(features, pesos);
    assert.equal(saida.length, pesos.intents.length);
    const soma = saida.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(soma - 1) < 1e-6);
    assert.ok(saida.every(v => v >= 0 && v <= 1));
  });

  test("a camada escondida (embedding) nunca tem valores negativos (ReLU)", () => {
    const features = extrairFeatures("quantos utentes tenho", pesos.nDims);
    const { escondida } = avancar(features, pesos);
    assert.ok(escondida.every(v => v >= 0));
  });
});

describe("farmaRede.js — preverIntent (com os pesos reais treinados)", () => {
  test("reconhece uma paráfrase genuína, sem nenhuma palavra-chave literal, com confiança alta", () => {
    // Frase que não existe em scripts/dados-treino-farma.mjs — testa
    // generalização real, não decorar exemplos de treino.
    const { previsoes } = preverIntent("há algo a precisar de atenção neste momento", pesos);
    assert.equal(previsoes[0].intentId, "alertas_resumo");
    assert.ok(previsoes[0].confianca > 0.85);
  });

  test("texto sem qualquer relação com a farmácia é reconhecido como fora_do_ambito", () => {
    const { previsoes } = preverIntent("xyz abc 123 lorem ipsum", pesos);
    assert.equal(previsoes[0].intentId, "fora_do_ambito");
  });

  test("previsões vêm sempre ordenadas da maior para a menor confiança", () => {
    const { previsoes } = preverIntent("tenho medicamentos quase a expirar", pesos);
    for (let i = 1; i < previsoes.length; i++) {
      assert.ok(previsoes[i - 1].confianca >= previsoes[i].confianca);
    }
  });

  test("devolve um embedding (camada escondida) do tamanho da camada escondida do modelo", () => {
    const { embedding } = preverIntent("qualquer pergunta", pesos);
    assert.equal(embedding.length, pesos.camada1.b.length);
  });
});

describe("farmaRede.js — similaridadeCosseno", () => {
  test("um vetor comparado consigo mesmo dá 1", () => {
    const v = [0.5, 0.2, -0.3, 0.1];
    assert.ok(Math.abs(similaridadeCosseno(v, v) - 1) < 1e-9);
  });

  test("vetores ortogonais dão 0", () => {
    assert.ok(Math.abs(similaridadeCosseno([1, 0], [0, 1])) < 1e-9);
  });

  test("vetores opostos dão -1", () => {
    assert.ok(Math.abs(similaridadeCosseno([1, 2, 3], [-1, -2, -3]) - -1) < 1e-9);
  });

  test("um vetor todo a zeros nunca rebenta com divisão por zero — devolve 0", () => {
    assert.equal(similaridadeCosseno([0, 0, 0], [1, 2, 3]), 0);
    assert.equal(similaridadeCosseno([0, 0], [0, 0]), 0);
  });

  test("duas frases com o mesmo sentido têm embeddings mais parecidos entre si do que com uma frase de outro intent", () => {
    const a = preverIntent("quantos pedidos aue tenho pendentes", pesos).embedding;
    const b = preverIntent("quantos pedidos de aue eu tenho", pesos).embedding;
    const c = preverIntent("as cópias de segurança estão em dia", pesos).embedding;
    const simParecidas = similaridadeCosseno(a, b);
    const simDiferentes = similaridadeCosseno(a, c);
    assert.ok(simParecidas > simDiferentes);
  });
});
