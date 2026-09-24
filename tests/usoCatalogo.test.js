import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TAREFAS_CATALOGO, MODULOS_NOMES, chaveTarefa, estimativaEfetiva, todasEstimativas } from "../src/usoCatalogo.js";
import { MODULOS_ATALHOS } from "../src/domain.js";

describe("usoCatalogo.js — integridade do catálogo de tarefas", () => {
  test("o catálogo tem 153 tarefas (154 anteriores − 1: ponto 44/45 removeu 'auto_preencher_ia' de devolucao-frio ao remover a chamada direta à API da Anthropic no browser)", () => {
    assert.equal(TAREFAS_CATALOGO.length, 153);
  });

  test("nenhuma chave 'modulo.tarefaId' está duplicada", () => {
    const chaves = TAREFAS_CATALOGO.map(t => chaveTarefa(t.modulo, t.tarefaId));
    assert.equal(new Set(chaves).size, chaves.length);
  });

  test("todas as tarefas têm um nome não vazio", () => {
    assert.ok(TAREFAS_CATALOGO.every(t => typeof t.nome === "string" && t.nome.trim().length > 0));
  });

  test("todas as tarefas têm tempoManualSeg e tempoCentralSeg numéricos e não-negativos", () => {
    assert.ok(TAREFAS_CATALOGO.every(t =>
      typeof t.tempoManualSeg === "number" && t.tempoManualSeg >= 0 &&
      typeof t.tempoCentralSeg === "number" && t.tempoCentralSeg >= 0
    ));
  });

  test("em toda a tarefa, o tempo manual é maior ou igual ao tempo com a Central (nunca é mais lento usar a Central)", () => {
    const piores = TAREFAS_CATALOGO.filter(t => t.tempoManualSeg < t.tempoCentralSeg);
    assert.deepEqual(piores, []);
  });

  test("todos os módulos usados no catálogo existem em MODULOS_NOMES (nenhuma tarefa 'órfã' de um módulo desconhecido)", () => {
    const modulosDesconhecidos = TAREFAS_CATALOGO.filter(t => !MODULOS_NOMES[t.modulo]);
    assert.deepEqual(modulosDesconhecidos.map(t => t.modulo), []);
  });

  test("MODULOS_NOMES tem exatamente as mesmas chaves que MODULOS_ATALHOS (catálogo e atalhos alinhados)", () => {
    const modulosCatalogo = new Set(Object.keys(MODULOS_NOMES));
    const modulosAtalhos = new Set(MODULOS_ATALHOS.map(m => m.modulo));
    assert.deepEqual(modulosCatalogo, modulosAtalhos);
  });

  test("cada módulo de MODULOS_ATALHOS tem pelo menos 1 tarefa rastreável no catálogo", () => {
    const presentes = new Set(TAREFAS_CATALOGO.map(t => t.modulo));
    const emFalta = MODULOS_ATALHOS.map(m => m.modulo).filter(m => !presentes.has(m));
    assert.deepEqual(emFalta, []);
  });

  test("distribuição honesta: PIM, Documentos e Gabinete são os módulos com mais tarefas catalogadas (os mais ricos em funcionalidade)", () => {
    const contagens = {};
    TAREFAS_CATALOGO.forEach(t => { contagens[t.modulo] = (contagens[t.modulo] || 0) + 1; });
    const top3 = Object.entries(contagens).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);
    assert.ok(top3.includes("pim"));
    assert.ok(top3.includes("documentos"));
    assert.ok(top3.includes("gabinete"));
  });
});

describe("usoCatalogo.js — chaveTarefa", () => {
  test("junta módulo e tarefaId com um ponto", () => {
    assert.equal(chaveTarefa("pim", "criar_utente"), "pim.criar_utente");
  });

  test("é consistente com o formato usado internamente no próprio catálogo", () => {
    const t = TAREFAS_CATALOGO[0];
    assert.equal(chaveTarefa(t.modulo, t.tarefaId), `${t.modulo}.${t.tarefaId}`);
  });
});

describe("usoCatalogo.js — estimativaEfetiva", () => {
  const t0 = TAREFAS_CATALOGO[0];
  const chave0 = chaveTarefa(t0.modulo, t0.tarefaId);

  test("sem overrides, devolve exatamente os valores do catálogo base", () => {
    const est = estimativaEfetiva(chave0, undefined);
    assert.equal(est.tempoManualSeg, t0.tempoManualSeg);
    assert.equal(est.tempoCentralSeg, t0.tempoCentralSeg);
    assert.equal(est.nome, t0.nome);
  });

  test("um override parcial (só tempoManualSeg) mantém o tempoCentralSeg do catálogo", () => {
    const est = estimativaEfetiva(chave0, { [chave0]: { tempoManualSeg: 9999 } });
    assert.equal(est.tempoManualSeg, 9999);
    assert.equal(est.tempoCentralSeg, t0.tempoCentralSeg);
  });

  test("um override completo substitui os dois tempos", () => {
    const est = estimativaEfetiva(chave0, { [chave0]: { tempoManualSeg: 111, tempoCentralSeg: 22 } });
    assert.equal(est.tempoManualSeg, 111);
    assert.equal(est.tempoCentralSeg, 22);
  });

  test("um override para OUTRA chave não afeta esta tarefa", () => {
    const est = estimativaEfetiva(chave0, { "modulo-inventado.tarefa-x": { tempoManualSeg: 1 } });
    assert.equal(est.tempoManualSeg, t0.tempoManualSeg);
  });

  test("uma chave desconhecida (tarefa que já não existe no catálogo) devolve null, nunca rebenta", () => {
    assert.equal(estimativaEfetiva("modulo-fantasma.tarefa-fantasma", {}), null);
  });

  test("overrides undefined/null não rebentam (tratados como objeto vazio)", () => {
    assert.doesNotThrow(() => estimativaEfetiva(chave0, null));
    assert.doesNotThrow(() => estimativaEfetiva(chave0, undefined));
  });
});

describe("usoCatalogo.js — todasEstimativas", () => {
  test("devolve exatamente uma entrada por tarefa do catálogo", () => {
    assert.equal(todasEstimativas({}).length, TAREFAS_CATALOGO.length);
  });

  test("aplica os overrides dados a todas as tarefas relevantes", () => {
    const t0 = TAREFAS_CATALOGO[0];
    const chave0 = chaveTarefa(t0.modulo, t0.tarefaId);
    const lista = todasEstimativas({ [chave0]: { tempoManualSeg: 555 } });
    const editada = lista.find(e => e.modulo === t0.modulo && e.tarefaId === t0.tarefaId);
    assert.equal(editada.tempoManualSeg, 555);
  });
});
