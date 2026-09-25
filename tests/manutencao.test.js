import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  verificarIntegridade, repararIntegridade, podarBackups, precisaBackupAutomatico,
  calcularSaude, fmtBytes
} from "../src/manutencao.js";

describe("manutencao.js — verificarIntegridade", () => {
  test("estado vazio/nulo não rebenta e devolve zero problemas", () => {
    assert.deepEqual(verificarIntegridade(null).problemas, []);
    assert.deepEqual(verificarIntegridade(undefined).problemas, []);
    assert.deepEqual(verificarIntegridade({}).problemas, []);
  });

  test("estado limpo (tudo bem-formado) não gera nenhum problema", () => {
    const estado = {
      servicos: [{ id: "s1", nome: "A" }, { id: "s2", nome: "B" }],
      categorias: [{ id: "c1" }],
      config: {},
      pim: {
        pim_utentes_v1: [{ id: "u1", nome: "Ana" }],
        pim_medicamentos_v1: [{ id: "m1", utenteId: "u1", nomeComercial: "X" }]
      }
    };
    const { problemas } = verificarIntegridade(estado);
    assert.deepEqual(problemas, []);
  });

  test("deteta um medicamento do PIM a referenciar um utente que já não existe (referência órfã)", () => {
    const estado = {
      pim: {
        pim_utentes_v1: [{ id: "u1", nome: "Ana" }],
        pim_medicamentos_v1: [
          { id: "m1", utenteId: "u1", nomeComercial: "X" },
          { id: "m2", utenteId: "u-fantasma", nomeComercial: "Y" }
        ]
      }
    };
    const { problemas } = verificarIntegridade(estado);
    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].tipo, "referencia_orfa");
    assert.equal(problemas[0].modulo, "pim");
    assert.equal(problemas[0].reparavel, true);
    assert.equal(problemas[0].reparo.itemId, "m2");
  });

  test("deteta um registo sem id numa coleção onde a maioria já usa id", () => {
    const estado = { stocks: { itens: [{ id: "i1" }, { id: "i2" }, { nome: "sem id" }] } };
    const { problemas } = verificarIntegridade(estado);
    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].tipo, "sem_id");
    assert.equal(problemas[0].reparo.indice, 2);
  });

  test("deteta ids duplicados numa coleção", () => {
    const estado = { aue: { pedidos: [{ id: "p1" }, { id: "p2" }, { id: "p1" }] } };
    const { problemas } = verificarIntegridade(estado);
    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].tipo, "id_duplicado");
  });

  test("NÃO assinala arrays que não seguem a convenção de id (ex.: sub-objetos de posologia sem id nenhum)", () => {
    const estado = { pim: { pim_medicamentos_v1: [{ id: "m1", posologia: [{ hora: "08:00" }, { hora: "20:00" }] }] } };
    const { problemas } = verificarIntegridade(estado);
    assert.deepEqual(problemas, []);
  });

  test("resumo agrega corretamente erros/avisos/reparáveis por módulo", () => {
    const estado = {
      pim: { pim_utentes_v1: [{ id: "u1" }], pim_medicamentos_v1: [{ id: "m1", utenteId: "orfao" }] },
      aue: { pedidos: [{ id: "p1" }, { id: "p1" }] }
    };
    const { resumo } = verificarIntegridade(estado);
    assert.equal(resumo.total, 2);
    assert.equal(resumo.avisos, 1); // referência órfã
    assert.equal(resumo.erros, 1); // id duplicado
    assert.equal(resumo.reparaveis, 2);
    assert.equal(resumo.porModulo.pim, 1);
    assert.equal(resumo.porModulo.aue, 1);
  });
});

describe("manutencao.js — repararIntegridade", () => {
  test("nunca muta o estado original recebido", () => {
    const estado = { aue: { pedidos: [{ id: "p1" }, { id: "p1" }] } };
    const original = JSON.parse(JSON.stringify(estado));
    const { problemas } = verificarIntegridade(estado);
    repararIntegridade(estado, problemas);
    assert.deepEqual(estado, original);
  });

  test("remove um registo com referência órfã", () => {
    const estado = {
      pim: {
        pim_utentes_v1: [{ id: "u1" }],
        pim_medicamentos_v1: [{ id: "m1", utenteId: "u1" }, { id: "m2", utenteId: "fantasma" }]
      }
    };
    const { problemas } = verificarIntegridade(estado);
    const { estado: reparado, reparos } = repararIntegridade(estado, problemas);
    assert.equal(reparado.pim.pim_medicamentos_v1.length, 1);
    assert.equal(reparado.pim.pim_medicamentos_v1[0].id, "m1");
    assert.equal(reparos.length, 1);
  });

  test("atribui um novo id a um registo que não tinha nenhum", () => {
    const estado = { stocks: { itens: [{ id: "i1" }, { id: "i2" }, { nome: "sem id" }] } };
    const { problemas } = verificarIntegridade(estado);
    const { estado: reparado, reparos } = repararIntegridade(estado, problemas);
    assert.ok(reparado.stocks.itens[2].id);
    assert.equal(reparos.length, 1);
  });

  test("renova o id do segundo registo duplicado (o primeiro mantém o id original)", () => {
    const estado = { aue: { pedidos: [{ id: "p1", x: 1 }, { id: "p2" }, { id: "p1", x: 2 }] } };
    const { problemas } = verificarIntegridade(estado);
    const { estado: reparado } = repararIntegridade(estado, problemas);
    assert.equal(reparado.aue.pedidos[0].id, "p1");
    assert.notEqual(reparado.aue.pedidos[2].id, "p1");
    const idsFinais = reparado.aue.pedidos.map(p => p.id);
    assert.equal(new Set(idsFinais).size, 3);
  });

  test("depois de reparar, uma nova verificação não encontra mais problemas", () => {
    const estado = {
      pim: { pim_utentes_v1: [{ id: "u1" }], pim_medicamentos_v1: [{ id: "m1", utenteId: "fantasma" }] },
      aue: { pedidos: [{ id: "p1" }, { id: "p1" }] }
    };
    const { problemas } = verificarIntegridade(estado);
    const { estado: reparado } = repararIntegridade(estado, problemas);
    assert.deepEqual(verificarIntegridade(reparado).problemas, []);
  });

  test("lista vazia de problemas não altera nada", () => {
    const estado = { servicos: [{ id: "s1" }] };
    const { estado: reparado, reparos } = repararIntegridade(estado, []);
    assert.deepEqual(reparado, estado);
    assert.deepEqual(reparos, []);
  });
});

describe("manutencao.js — podarBackups", () => {
  test("não poda nada se estiver dentro do limite", () => {
    const manifesto = [{ id: "b1", criadoEm: "2026-09-01T00:00:00.000Z" }];
    const { manifestoPodado, removidos } = podarBackups(manifesto, 20);
    assert.equal(manifestoPodado.length, 1);
    assert.deepEqual(removidos, []);
  });

  test("mantém só os N mais recentes e devolve os removidos (mais antigos)", () => {
    const manifesto = [
      { id: "b1", criadoEm: "2026-09-01T00:00:00.000Z" },
      { id: "b2", criadoEm: "2026-09-02T00:00:00.000Z" },
      { id: "b3", criadoEm: "2026-09-03T00:00:00.000Z" }
    ];
    const { manifestoPodado, removidos } = podarBackups(manifesto, 2);
    assert.deepEqual(manifestoPodado.map(b => b.id), ["b2", "b3"]);
    assert.deepEqual(removidos.map(b => b.id), ["b1"]);
  });

  test("manifesto vazio/indefinido não rebenta", () => {
    assert.deepEqual(podarBackups(undefined, 5).manifestoPodado, []);
    assert.deepEqual(podarBackups(null, 5).manifestoPodado, []);
  });
});

describe("manutencao.js — precisaBackupAutomatico", () => {
  test("verdadeiro quando não existe nenhum backup", () => {
    assert.equal(precisaBackupAutomatico([]), true);
    assert.equal(precisaBackupAutomatico(null), true);
  });

  test("verdadeiro quando o último backup tem mais de 24h", () => {
    const agora = new Date("2026-09-15T12:00:00.000Z");
    const manifesto = [{ id: "b1", criadoEm: "2026-09-14T00:00:00.000Z" }];
    assert.equal(precisaBackupAutomatico(manifesto, agora), true);
  });

  test("falso quando o último backup é de há poucas horas", () => {
    const agora = new Date("2026-09-15T12:00:00.000Z");
    const manifesto = [{ id: "b1", criadoEm: "2026-09-15T06:00:00.000Z" }];
    assert.equal(precisaBackupAutomatico(manifesto, agora), false);
  });

  test("respeita um intervaloHoras customizado", () => {
    const agora = new Date("2026-09-15T12:00:00.000Z");
    const manifesto = [{ id: "b1", criadoEm: "2026-09-15T10:00:00.000Z" }];
    assert.equal(precisaBackupAutomatico(manifesto, agora, 1), true);
    assert.equal(precisaBackupAutomatico(manifesto, agora, 3), false);
  });
});

describe("manutencao.js — fmtBytes", () => {
  test("formata bytes, KB, MB corretamente", () => {
    assert.equal(fmtBytes(0), "0 B");
    assert.equal(fmtBytes(512), "512 B");
    assert.equal(fmtBytes(2048), "2 KB");
    assert.equal(fmtBytes(1536), "1.5 KB");
    assert.equal(fmtBytes(5 * 1024 * 1024), "5 MB");
  });
});

describe("manutencao.js — calcularSaude", () => {
  test("conta registos por módulo e calcula um tamanho positivo", () => {
    const estado = {
      servicos: [{ id: "s1" }, { id: "s2" }],
      pim: { pim_utentes_v1: [{ id: "u1" }] }
    };
    const saude = calcularSaude(estado, []);
    assert.ok(saude.tamanhoBytes > 0);
    assert.equal(saude.contagens.servicos, 2);
    assert.equal(saude.contagens.pim, 1);
    assert.equal(saude.totalItens, 3);
    assert.equal(saude.totalBackups, 0);
    assert.equal(saude.ultimoBackup, null);
  });

  test("devolve o último backup do manifesto (o mais recentemente acrescentado)", () => {
    const manifesto = [{ id: "b1", criadoEm: "2026-09-01T00:00:00.000Z" }, { id: "b2", criadoEm: "2026-09-02T00:00:00.000Z" }];
    const saude = calcularSaude({}, manifesto);
    assert.equal(saude.totalBackups, 2);
    assert.equal(saude.ultimoBackup.id, "b2");
  });
});
