import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconhecerAcaoDeterministica } from "../src/farmaAcoesIntent.js";
import { ACOES_DISPONIVEIS } from "../src/farmaAcoes.js";

describe("farmaAcoesIntent.js — ponto 46, reconhecimento de ações sem IA nenhuma", () => {
  test("perguntas normais (Q&A) nunca são confundidas com um pedido de ação", () => {
    const perguntas = [
      "quantos alertas tenho", "há medicamentos perto da validade", "quantos utentes tenho no pim",
      "quantos pedidos aue estao pendentes", "tenho manipulados pendentes",
      "quantas divergencias de stock tenho", "quanto tempo ja poupei",
      "as copias de seguranca estao em dia", "ha alguma oportunidade de automacao",
      "o que sabes fazer", "ola bom dia", "que horas sao", "",
    ];
    for (const p of perguntas) assert.equal(reconhecerAcaoDeterministica(p), null, p);
  });

  test("manipulados.criar_pedido — reconhece e extrai nome e medicamento", () => {
    const r = reconhecerAcaoDeterministica("cria um pedido de manipulado para a Ana Costa, medicamento minoxidil 5%, telefone 912345678");
    assert.equal(r.tipo, "pronta");
    assert.equal(r.acaoId, "manipulados.criar_pedido");
    assert.equal(r.parametros.nome, "Ana Costa");
    assert.equal(r.parametros.medicamento, "minoxidil 5%");
    assert.equal(r.parametros.telefone, "912345678");
  });

  test("manipulados.criar_pedido — falta o medicamento, pede esclarecimento em vez de adivinhar", () => {
    const r = reconhecerAcaoDeterministica("cria um pedido de manipulado para a Ana Costa");
    assert.equal(r.tipo, "incompleta");
    assert.equal(r.acaoId, "manipulados.criar_pedido");
    assert.deepEqual(r.faltam, ["medicamento"]);
    assert.match(r.motivo, /manipulado pedido/);
  });

  test("manipulados.mudar_estado — reconhece o novo estado a partir de linguagem natural", () => {
    const r = reconhecerAcaoDeterministica("marca o manipulado da Maria Silva como entregue");
    assert.equal(r.tipo, "pronta");
    assert.equal(r.acaoId, "manipulados.mudar_estado");
    assert.equal(r.parametros.identificarPedido, "Maria Silva");
    assert.equal(r.parametros.novoEstado, "entregue");
  });

  test("manipulados.criar_pedido nunca é confundido com manipulados.mudar_estado (verbos distintos)", () => {
    const r1 = reconhecerAcaoDeterministica("cria um pedido de manipulado para a Ana Costa, medicamento minoxidil");
    assert.equal(r1.acaoId, "manipulados.criar_pedido");
    const r2 = reconhecerAcaoDeterministica("cancela o manipulado da Ana Costa");
    assert.equal(r2.acaoId, "manipulados.mudar_estado");
  });

  test("aue.criar_pedido — reconhece nome, medicamento e o armazenista exato do catálogo", () => {
    const r = reconhecerAcaoDeterministica("cria um pedido de aue para a Rita Lopes, medicamento Wegovy, armazenista OCP");
    assert.equal(r.tipo, "pronta");
    assert.equal(r.parametros.nome, "Rita Lopes");
    assert.equal(r.parametros.medicamento, "Wegovy");
    assert.equal(r.parametros.armazenista, "OCP");
  });

  test("aue.criar_pedido — sem armazenista reconhecível, pede esclarecimento (nunca inventa um armazenista)", () => {
    const r = reconhecerAcaoDeterministica("cria um pedido de aue para a Rita Lopes, medicamento Wegovy");
    assert.equal(r.tipo, "incompleta");
    assert.ok(r.faltam.includes("armazenista"));
  });

  test("catalogo.adicionar_produto — texto entre aspas é o nome do produto", () => {
    const r = reconhecerAcaoDeterministica('adiciona o produto "Nurofen 400" ao catalogo');
    assert.equal(r.tipo, "pronta");
    assert.equal(r.parametros.nome, "Nurofen 400");
  });

  test("listas.criar_lista NUNCA é confundida com listas.inscrever, mesmo contendo a palavra 'inscrição'", () => {
    // Regressão de um bug real encontrado durante o desenvolvimento: "lista
    // de inscrição" (nome genérico do tipo de lista) contém a raiz do verbo
    // "inscrever" — sem a ordem/exclusão certas, isto era mal interpretado
    // como um pedido para inscrever alguém chamado "Formação Outono".
    const r = reconhecerAcaoDeterministica("cria uma lista de inscrição chamada Formação Outono, tipo formacao");
    assert.equal(r.acaoId, "listas.criar_lista");
    assert.equal(r.parametros.nome, "Formação Outono");
  });

  test("listas.inscrever — reconhece o padrão comum 'inscreve X na lista'", () => {
    const r = reconhecerAcaoDeterministica("inscreve a Maria na lista de minifaciais às 09:20");
    assert.equal(r.tipo, "pronta");
    assert.equal(r.acaoId, "listas.inscrever");
    assert.equal(r.parametros.nome, "Maria");
    assert.equal(r.parametros.horario, "09:20");
  });

  test("gabinete.criar_relatorio — nenhum parâmetro obrigatório, fica sempre pronta quando o padrão bate certo", () => {
    const r = reconhecerAcaoDeterministica("cria um relatorio de gabinete");
    assert.equal(r.tipo, "pronta");
    assert.equal(r.acaoId, "gabinete.criar_relatorio");
  });

  test("uma âncora curta nunca casa a meio de outra palavra (ex.: 'a lista' dentro de 'umA LISTA')", () => {
    // Regressão de um bug real: capturarApos usava indexOf sem fronteira de
    // palavra, por isso "a lista" "encontrava-se" dentro de "uma lista" e
    // roubava as duas letras finais de "uma" para o valor capturado.
    const r = reconhecerAcaoDeterministica("cria uma lista de stocks errados");
    assert.equal(r.acaoId, "stocks.criar_lista");
    assert.ok(!r.parametros.nome || !r.parametros.nome.startsWith("a "), JSON.stringify(r.parametros));
  });

  test("todas as ações que o reconhecedor produz existem mesmo no catálogo ACOES_DISPONIVEIS", () => {
    const frases = [
      "cria um pedido de manipulado para a Ana Costa, medicamento minoxidil 5%",
      "marca o manipulado da Ana Costa como entregue",
      "cria um pedido de aue para a Rita Lopes, medicamento Wegovy, armazenista OCP",
      'adiciona o produto "Nurofen 400" ao catalogo',
      "cria um relatorio de gabinete",
      "inscreve a Maria na lista de minifaciais",
    ];
    for (const f of frases) {
      const r = reconhecerAcaoDeterministica(f);
      assert.ok(r, f);
      assert.ok(ACOES_DISPONIVEIS[r.acaoId], `ação desconhecida: ${r.acaoId}`);
    }
  });

  test("uma ação 'incompleta' nunca devolve parametros — só o motivo da pergunta", () => {
    const r = reconhecerAcaoDeterministica("cria um pedido de manipulado para a Ana Costa");
    assert.equal(r.tipo, "incompleta");
    assert.equal(r.parametros, undefined);
    assert.equal(typeof r.motivo, "string");
    assert.ok(r.motivo.length > 0);
  });
});
