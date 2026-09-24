import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_MANIPULADOS, tarefaTransicaoEstado, encontrarPedidosPorTexto, mudarEstadoPedido
} from "../src/manipuladosCore.js";

describe("manipuladosCore.js — tarefaTransicaoEstado", () => {
  test("sem mudança real (mesmo estado) não gera tarefa", () => {
    assert.equal(tarefaTransicaoEstado("pendente_utente", "pendente_utente"), null);
  });
  test("sem novo estado não gera tarefa", () => {
    assert.equal(tarefaTransicaoEstado("pendente_utente", null), null);
  });
  test("cada transição normal mapeia para a tarefa certa", () => {
    assert.equal(tarefaTransicaoEstado("pendente_utente", "pendente_farmacia"), "mudar_pendente_farmacia");
    assert.equal(tarefaTransicaoEstado("preparacao", "pronto"), "mudar_pronto");
    assert.equal(tarefaTransicaoEstado("pronto", "entregue"), "marcar_entregue");
    assert.equal(tarefaTransicaoEstado("preparacao", "cancelado"), "mudar_cancelado");
  });
  test("reabrir um pedido fechado (entregue/cancelado) para um estado aberto conta como reabrir_pedido", () => {
    assert.equal(tarefaTransicaoEstado("entregue", "pendente_farmacia"), "reabrir_pedido");
    assert.equal(tarefaTransicaoEstado("cancelado", "preparacao"), "reabrir_pedido");
  });
  test("mudar entre entregue e cancelado (ambos fechados) não é 'reabrir', é a tarefa normal", () => {
    assert.equal(tarefaTransicaoEstado("entregue", "cancelado"), "mudar_cancelado");
  });
});

describe("manipuladosCore.js — encontrarPedidosPorTexto", () => {
  const pedidos = [
    { id: "1", nome: "Maria Silva", medicamento: "Creme X" },
    { id: "2", nome: "João Costa", medicamento: "Pomada Y" },
    { id: "3", nome: "Maria Fernandes", medicamento: "Creme Z" },
  ];
  test("texto vazio devolve nada", () => {
    assert.deepEqual(encontrarPedidosPorTexto(pedidos, ""), []);
    assert.deepEqual(encontrarPedidosPorTexto(pedidos, "   "), []);
  });
  test("procura por nome do utente, sem distinguir maiúsculas", () => {
    const r = encontrarPedidosPorTexto(pedidos, "joão");
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "2");
  });
  test("procura por nome do medicamento também encontra", () => {
    const r = encontrarPedidosPorTexto(pedidos, "pomada");
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "2");
  });
  test("várias correspondências são todas devolvidas (quem chama decide, nunca adivinha)", () => {
    const r = encontrarPedidosPorTexto(pedidos, "maria");
    assert.equal(r.length, 2);
  });
  test("lista nula/undefined não rebenta", () => {
    assert.deepEqual(encontrarPedidosPorTexto(null, "x"), []);
    assert.deepEqual(encontrarPedidosPorTexto(undefined, "x"), []);
  });
  test("procura também pelo nome do animal, para prescrições veterinárias (ponto 32)", () => {
    const comAnimal = [...pedidos, { id: "4", nome: "Sr. Antunes", medicamento: "Solução otológica", animal: "Bolinha" }];
    const r = encontrarPedidosPorTexto(comAnimal, "bolinha");
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "4");
  });
  test("pedido sem animal não rebenta a procurar por animal", () => {
    const r = encontrarPedidosPorTexto(pedidos, "bolinha");
    assert.equal(r.length, 0);
  });
});

describe("manipuladosCore.js — mudarEstadoPedido", () => {
  const base = () => ([
    { id: "1", nome: "Maria Silva", status: "pendente_utente" },
    { id: "2", nome: "João Costa", status: "preparacao" },
  ]);

  test("muda o estado do pedido certo e devolve a tarefa correspondente", () => {
    const r = mudarEstadoPedido(base(), "2", "pronto");
    assert.equal(r.ok, true);
    assert.equal(r.estadoAnterior, "preparacao");
    assert.equal(r.tarefa, "mudar_pronto");
    assert.equal(r.pedidos.find(p => p.id === "2").status, "pronto");
  });

  test("não muta a lista original (devolve sempre uma lista nova)", () => {
    const original = base();
    const copiaOriginal = JSON.parse(JSON.stringify(original));
    mudarEstadoPedido(original, "1", "entregue");
    assert.deepEqual(original, copiaOriginal);
  });

  test("estado desconhecido é recusado com motivo claro", () => {
    const r = mudarEstadoPedido(base(), "1", "estado_inventado");
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não existe/);
  });

  test("id inexistente é recusado com motivo claro", () => {
    const r = mudarEstadoPedido(base(), "999", "entregue");
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não encontrado/);
  });

  test("todos os estados do catálogo STATUS_MANIPULADOS são aceites", () => {
    for (const estado of Object.keys(STATUS_MANIPULADOS)) {
      const r = mudarEstadoPedido(base(), "1", estado);
      assert.equal(r.ok, true, `estado "${estado}" devia ser aceite`);
    }
  });
});
