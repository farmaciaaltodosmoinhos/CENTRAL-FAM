import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isoDia, mesDeIso, carregarUsoPeriodo, primeiroDiaComUso, limparCacheUso,
  calcularPoupanca, serieDiaria, agregarPorModulo, agregarPorTarefa, fmtDuracao, fmtEuros
} from "../src/usoLeitura.js";
import { TAREFAS_CATALOGO } from "../src/usoCatalogo.js";

/** dataStore falso: recebe os dados já organizados por dia (ISO) e responde
 *  a getAsset("uso-AAAA-MM") reagrupando-os no mês certo — isola cada teste
 *  do mês "real" em que a bateria acontece de correr. */
function fakeDataStoreComDias(diasData) {
  const porMes = {};
  Object.entries(diasData).forEach(([dia, registos]) => {
    const mes = mesDeIso(dia);
    if (!porMes[mes]) porMes[mes] = {};
    porMes[mes][dia] = registos;
  });
  return {
    async getAsset(key) {
      const mes = key.replace("uso-", "");
      if (!porMes[mes]) return null;
      return JSON.stringify({ dias: porMes[mes] });
    }
  };
}

describe("usoLeitura.js — isoDia / mesDeIso", () => {
  test("isoDia formata ano-mês-dia com zeros à esquerda", () => {
    assert.equal(isoDia(new Date(2026, 0, 5)), "2026-01-05"); // janeiro (mês 0) dia 5
  });

  test("isoDia com mês/dia de 2 dígitos", () => {
    assert.equal(isoDia(new Date(2026, 8, 23)), "2026-09-23"); // setembro (mês 8) dia 23
  });

  test("mesDeIso extrai só 'AAAA-MM' de um dia completo", () => {
    assert.equal(mesDeIso("2026-09-23"), "2026-09");
  });
});

describe("usoLeitura.js — carregarUsoPeriodo", () => {
  test("carrega e junta os dias de um único mês dentro do intervalo pedido", async () => {
    limparCacheUso();
    const ds = fakeDataStoreComDias({
      "2024-03-01": { "pim.criar_utente": 2 },
      "2024-03-15": { "pim.criar_utente": 1 },
      "2024-03-31": { "gabinete.criar_relatorio": 3 }
    });
    const dias = await carregarUsoPeriodo(ds, "2024-03-01", "2024-03-31");
    assert.deepEqual(Object.keys(dias).sort(), ["2024-03-01", "2024-03-15", "2024-03-31"]);
  });

  test("exclui dias fora do intervalo pedido, mesmo estando no mesmo mês carregado", async () => {
    limparCacheUso();
    const ds = fakeDataStoreComDias({
      "2024-04-01": { "pim.criar_utente": 1 },
      "2024-04-10": { "pim.criar_utente": 1 },
      "2024-04-20": { "pim.criar_utente": 1 }
    });
    const dias = await carregarUsoPeriodo(ds, "2024-04-05", "2024-04-15");
    assert.deepEqual(Object.keys(dias), ["2024-04-10"]);
  });

  test("junta corretamente dias que atravessam a fronteira de 2 meses", async () => {
    limparCacheUso();
    const ds = fakeDataStoreComDias({
      "2024-05-30": { "pim.criar_utente": 1 },
      "2024-05-31": { "pim.criar_utente": 1 },
      "2024-06-01": { "pim.criar_utente": 1 },
      "2024-06-02": { "pim.criar_utente": 1 }
    });
    const dias = await carregarUsoPeriodo(ds, "2024-05-31", "2024-06-01");
    assert.deepEqual(Object.keys(dias).sort(), ["2024-05-31", "2024-06-01"]);
  });

  test("junta corretamente dias que atravessam a fronteira de um ANO", async () => {
    limparCacheUso();
    const ds = fakeDataStoreComDias({
      "2024-12-31": { "pim.criar_utente": 1 },
      "2025-01-01": { "pim.criar_utente": 1 }
    });
    const dias = await carregarUsoPeriodo(ds, "2024-12-31", "2025-01-01");
    assert.deepEqual(Object.keys(dias).sort(), ["2024-12-31", "2025-01-01"]);
  });

  test("um mês sem nenhum blob gravado (farmácia ainda sem uso nesse mês) não rebenta — devolve {} para esse mês", async () => {
    limparCacheUso();
    const ds = fakeDataStoreComDias({});
    const dias = await carregarUsoPeriodo(ds, "2030-01-01", "2030-01-31");
    assert.deepEqual(dias, {});
  });

  test("um blob corrompido (JSON inválido) nunca rebenta a leitura — trata como mês vazio", async () => {
    limparCacheUso();
    const ds = { async getAsset() { return "{ isto não é json"; } };
    const dias = await carregarUsoPeriodo(ds, "2024-07-01", "2024-07-31");
    assert.deepEqual(dias, {});
  });
});

describe("usoLeitura.js — primeiroDiaComUso", () => {
  test("devolve o primeiro dia (ordenado) com qualquer registo, dentro da janela conhecida", async () => {
    limparCacheUso();
    const hojeIso = isoDia(new Date());
    const mesAtras = new Date(); mesAtras.setDate(mesAtras.getDate() - 20);
    const inicioIso = isoDia(mesAtras);
    const diaComUso = new Date(); diaComUso.setDate(diaComUso.getDate() - 10);
    const diaComUsoIso = isoDia(diaComUso);

    const ds = fakeDataStoreComDias({ [diaComUsoIso]: { "pim.criar_utente": 1 } });
    const primeiro = await primeiroDiaComUso(ds, inicioIso);
    assert.equal(primeiro, diaComUsoIso);
  });

  test("sem nenhum registo em toda a janela, devolve null", async () => {
    limparCacheUso();
    const hojeIso = isoDia(new Date());
    const ds = fakeDataStoreComDias({});
    const primeiro = await primeiroDiaComUso(ds, hojeIso);
    assert.equal(primeiro, null);
  });

  test("sem 'inicioIsoConhecido', usa hoje como início (janela de 1 dia)", async () => {
    limparCacheUso();
    const hojeIso = isoDia(new Date());
    const ds = fakeDataStoreComDias({ [hojeIso]: { "pim.criar_utente": 1 } });
    const primeiro = await primeiroDiaComUso(ds, null);
    assert.equal(primeiro, hojeIso);
  });
});

describe("usoLeitura.js — calcularPoupanca", () => {
  test("soma tempo manual/central/poupado e ocorrências para uma única tarefa conhecida", () => {
    // pim.criar_utente: tempoManualSeg=240, tempoCentralSeg=40 (catálogo atual)
    const r = calcularPoupanca({ "2024-03-01": { "pim.criar_utente": 2 } }, undefined);
    assert.equal(r.segundosManual, 480);
    assert.equal(r.segundosCentral, 80);
    assert.equal(r.segundosPoupados, 400);
    assert.equal(r.totalOcorrencias, 2);
  });

  test("soma corretamente através de vários dias e várias tarefas", () => {
    const r = calcularPoupanca({
      "2024-03-01": { "pim.criar_utente": 1 },
      "2024-03-02": { "pim.criar_utente": 1, "pim.reimprimir_rotulo": 2 }
    }, undefined);
    // pim.reimprimir_rotulo: 360/15 seg
    assert.equal(r.totalOcorrencias, 4);
    assert.equal(r.segundosManual, 240 * 2 + 360 * 2);
    assert.equal(r.segundosCentral, 40 * 2 + 15 * 2);
  });

  test("uma tarefa desconhecida (catálogo desatualizado) é ignorada, não rebenta", () => {
    const r = calcularPoupanca({ "2024-03-01": { "modulo-fantasma.tarefa-x": 5 } }, undefined);
    assert.equal(r.totalOcorrencias, 0);
    assert.equal(r.segundosManual, 0);
  });

  test("respeita overrides de estimativa passados", () => {
    const r = calcularPoupanca({ "2024-03-01": { "pim.criar_utente": 1 } }, { "pim.criar_utente": { tempoManualSeg: 1000, tempoCentralSeg: 0 } });
    assert.equal(r.segundosManual, 1000);
    assert.equal(r.segundosPoupados, 1000);
  });

  test("dias vazios ({}) devolvem tudo a zero", () => {
    assert.deepEqual(calcularPoupanca({}, undefined), { segundosManual: 0, segundosCentral: 0, segundosPoupados: 0, totalOcorrencias: 0 });
  });
});

describe("usoLeitura.js — serieDiaria", () => {
  test("devolve uma entrada por dia, ordenada cronologicamente", () => {
    const serie = serieDiaria({
      "2024-03-02": { "pim.criar_utente": 1 },
      "2024-03-01": { "pim.criar_utente": 1 }
    }, undefined);
    assert.deepEqual(serie.map(d => d.dia), ["2024-03-01", "2024-03-02"]);
  });

  test("cada entrada tem os totais calculados só para o seu próprio dia", () => {
    const serie = serieDiaria({ "2024-03-01": { "pim.criar_utente": 3 } }, undefined);
    assert.equal(serie[0].totalOcorrencias, 3);
  });
});

describe("usoLeitura.js — agregarPorModulo", () => {
  test("agrupa corretamente tarefas de módulos diferentes", () => {
    const agregado = agregarPorModulo({
      "2024-03-01": { "pim.criar_utente": 1, "gabinete.criar_relatorio": 1 }
    }, undefined);
    assert.ok(agregado.pim);
    assert.ok(agregado.gabinete);
    assert.equal(agregado.pim.totalOcorrencias, 1);
  });

  test("soma tarefas diferentes do MESMO módulo no total desse módulo", () => {
    const agregado = agregarPorModulo({
      "2024-03-01": { "pim.criar_utente": 1, "pim.reimprimir_rotulo": 1 }
    }, undefined);
    assert.equal(agregado.pim.totalOcorrencias, 2);
  });

  test("cada módulo tem segundosPoupados = max(0, manual-central)", () => {
    const agregado = agregarPorModulo({ "2024-03-01": { "pim.criar_utente": 1 } }, undefined);
    assert.equal(agregado.pim.segundosPoupados, agregado.pim.segundosManual - agregado.pim.segundosCentral);
  });
});

describe("usoLeitura.js — agregarPorTarefa", () => {
  test("devolve uma linha por CADA tarefa do catálogo (mesmo sem nenhuma ocorrência) — é a base da tabela completa do painel", () => {
    const linhas = agregarPorTarefa({}, undefined);
    assert.equal(linhas.length, TAREFAS_CATALOGO.length);
    assert.ok(linhas.every(l => l.totalOcorrencias === 0));
  });

  test("uma tarefa com ocorrências mostra a contagem certa e segundosPoupados coerente", () => {
    const linhas = agregarPorTarefa({ "2024-03-01": { "pim.criar_utente": 4 } }, undefined);
    const linha = linhas.find(l => l.chave === "pim.criar_utente");
    assert.equal(linha.totalOcorrencias, 4);
    assert.equal(linha.segundosPoupados, (linha.tempoManualSeg - linha.tempoCentralSeg) * 4);
  });
});

describe("usoLeitura.js — fmtDuracao", () => {
  test("segundos: menos de 1 minuto", () => {
    assert.equal(fmtDuracao(45), "45s");
  });

  test("minutos: sem horas", () => {
    assert.equal(fmtDuracao(125), "2min");
  });

  test("horas + minutos", () => {
    assert.equal(fmtDuracao(3661), "1h 1min");
  });

  test("zero/negativo/undefined nunca rebenta, cai em '0s'", () => {
    assert.equal(fmtDuracao(0), "0s");
    assert.equal(fmtDuracao(undefined), "0s");
  });
});

describe("usoLeitura.js — fmtEuros", () => {
  // nota: toLocaleString('pt-PT', {style:'currency',...}) usa um espaço
  // inseparável (U+00A0) antes do símbolo, não um espaço normal — as
  // asserções normalizam esse espaço para evitar um falso negativo.
  const semNbsp = (s) => s.replace(/ /g, " ");

  test("formata em euros no formato português (vírgula decimal + símbolo)", () => {
    assert.equal(semNbsp(fmtEuros(12.5)), "12,50 €");
  });

  test("zero/omitido formata como 0,00 €", () => {
    assert.equal(semNbsp(fmtEuros(0)), "0,00 €");
    assert.equal(semNbsp(fmtEuros(undefined)), "0,00 €");
  });
});
