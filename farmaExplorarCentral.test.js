import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MODULOS_ATALHOS } from "../src/domain.js";
import { TAREFAS_CATALOGO } from "../src/usoCatalogo.js";
import {
  construirIndiceCapacidades, procurarCapacidade,
  gerarPropostas, registarPropostas, atualizarEstadoProposta, propostasPendentes,
} from "../src/farmaExplorarCentral.js";

describe("farmaExplorarCentral.js — construirIndiceCapacidades", () => {
  test("tem uma entrada por cada tarefa real do catálogo, nunca inventa nenhuma", () => {
    const idx = construirIndiceCapacidades();
    assert.equal(idx.length, TAREFAS_CATALOGO.length);
  });

  test("cada entrada resolve o nome do módulo a partir de MODULOS_ATALHOS", () => {
    const idx = construirIndiceCapacidades();
    const entradaPim = idx.find((e) => e.modulo === "pim");
    const moduloOficial = MODULOS_ATALHOS.find((m) => m.modulo === "pim");
    assert.equal(entradaPim.moduloNome, moduloOficial.nome);
  });

  test("é determinístico — chamadas repetidas dão o mesmo resultado", () => {
    assert.deepEqual(construirIndiceCapacidades(), construirIndiceCapacidades());
  });
});

describe("farmaExplorarCentral.js — procurarCapacidade", () => {
  const indice = construirIndiceCapacidades();

  test("encontra uma tarefa real por palavras do seu nome", () => {
    const r = procurarCapacidade("remover utente", 5, indice);
    assert.ok(r.some((item) => item.tarefaId === "remover_utente"));
  });

  test("consulta sem nenhuma palavra em comum com o catálogo devolve lista vazia", () => {
    const r = procurarCapacidade("xyzxyz nadadisto qwqwqw", 5, indice);
    assert.deepEqual(r, []);
  });

  test("ignora acentos e maiúsculas (usa normalizarTextoRede)", () => {
    const r1 = procurarCapacidade("RÓTULO", 5, indice);
    const r2 = procurarCapacidade("rotulo", 5, indice);
    assert.deepEqual(r1.map((i) => i.tarefaId), r2.map((i) => i.tarefaId));
    assert.ok(r1.length > 0);
  });

  test("respeita o limite pedido", () => {
    const r = procurarCapacidade("receita", 2, indice);
    assert.ok(r.length <= 2);
  });

  test("sem índice explícito, constrói um por omissão (não rebenta)", () => {
    const r = procurarCapacidade("stock");
    assert.ok(r.length > 0);
  });
});

describe("farmaExplorarCentral.js — gerarPropostas", () => {
  const oportunidade = {
    chave: "pim.criar_rotulo", modulo: "pim", tarefaId: "criar_rotulo",
    nome: "Criar Rótulo (plano semanal)", totalOcorrencias: 45, mediaDiaria: 1.5,
    segundosPoupadosJa: 3000, sugestao: "Tarefa muito repetida (45× no período).",
  };

  test("converte cada oportunidade numa proposta formal, sempre 'pendente'", () => {
    const [p] = gerarPropostas([oportunidade], new Date("2026-09-19T10:00:00Z"));
    assert.equal(p.estado, "pendente");
    assert.equal(p.origem, "explorar_central");
    assert.equal(p.modulo, "pim");
    assert.ok(p.titulo.includes("Criar Rótulo"));
    assert.ok(p.evidencia.includes("45 ocorrências"));
    assert.equal(p.criadoEm, "2026-09-19T10:00:00.000Z");
  });

  test("lista vazia/nula não rebenta", () => {
    assert.deepEqual(gerarPropostas([]), []);
    assert.deepEqual(gerarPropostas(null), []);
  });

  test("é determinístico — mesma oportunidade dá sempre o mesmo id", () => {
    const [p1] = gerarPropostas([oportunidade]);
    const [p2] = gerarPropostas([oportunidade]);
    assert.equal(p1.id, p2.id);
  });
});

describe("farmaExplorarCentral.js — registarPropostas (fila persistente, sem duplicados)", () => {
  const oportunidade = {
    chave: "pim.criar_rotulo", modulo: "pim", tarefaId: "criar_rotulo",
    nome: "Criar Rótulo (plano semanal)", totalOcorrencias: 45, mediaDiaria: 1.5,
    segundosPoupadosJa: 3000, sugestao: "Tarefa muito repetida.",
  };

  test("adiciona propostas novas a uma fila vazia", () => {
    const propostas = gerarPropostas([oportunidade]);
    const registadas = registarPropostas([], propostas);
    assert.equal(registadas.length, 1);
  });

  test("explorar outra vez com a MESMA oportunidade não duplica a proposta", () => {
    const propostas = gerarPropostas([oportunidade]);
    const registadas1 = registarPropostas([], propostas);
    const registadas2 = registarPropostas(registadas1, gerarPropostas([oportunidade]));
    assert.equal(registadas2.length, 1);
  });

  test("uma proposta já rejeitada não reaparece como pendente numa exploração seguinte", () => {
    const propostas = gerarPropostas([oportunidade]);
    let fila = registarPropostas([], propostas);
    fila = atualizarEstadoProposta(fila, propostas[0].id, "rejeitada");
    fila = registarPropostas(fila, gerarPropostas([oportunidade])); // mesma oportunidade outra vez
    assert.equal(fila.length, 1);
    assert.equal(fila[0].estado, "rejeitada");
  });
});

describe("farmaExplorarCentral.js — atualizarEstadoProposta / propostasPendentes", () => {
  test("só aceita estados válidos; um estado desconhecido não altera nada", () => {
    const propostas = gerarPropostas([{
      chave: "x", modulo: "pim", tarefaId: "x", nome: "X", totalOcorrencias: 10, mediaDiaria: 1, segundosPoupadosJa: 0, sugestao: "s",
    }]);
    const fila = registarPropostas([], propostas);
    const inalterada = atualizarEstadoProposta(fila, fila[0].id, "estado_invalido");
    assert.deepEqual(inalterada, fila);
  });

  test("'aprovar' marca aprovada_para_revisao e regista quando foi decidido, nunca implementa nada", () => {
    const propostas = gerarPropostas([{
      chave: "y", modulo: "gabinete", tarefaId: "y", nome: "Y", totalOcorrencias: 10, mediaDiaria: 1, segundosPoupadosJa: 0, sugestao: "s",
    }]);
    const fila = registarPropostas([], propostas);
    const atualizada = atualizarEstadoProposta(fila, fila[0].id, "aprovada_para_revisao", new Date("2026-09-19T12:00:00Z"));
    assert.equal(atualizada[0].estado, "aprovada_para_revisao");
    assert.equal(atualizada[0].decididoEm, "2026-09-19T12:00:00.000Z");
  });

  test("propostasPendentes filtra só as por decidir", () => {
    const propostas = gerarPropostas([
      { chave: "a", modulo: "pim", tarefaId: "a", nome: "A", totalOcorrencias: 10, mediaDiaria: 1, segundosPoupadosJa: 0, sugestao: "s" },
      { chave: "b", modulo: "pim", tarefaId: "b", nome: "B", totalOcorrencias: 20, mediaDiaria: 2, segundosPoupadosJa: 0, sugestao: "s" },
    ]);
    let fila = registarPropostas([], propostas);
    fila = atualizarEstadoProposta(fila, propostas[0].id, "rejeitada");
    const pendentes = propostasPendentes(fila);
    assert.equal(pendentes.length, 1);
    assert.equal(pendentes[0].id, propostas[1].id);
  });
});
