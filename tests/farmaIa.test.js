import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gerarAlertas, responderPergunta, detectarOportunidadesAutomacao,
  sugerirIntentsSemelhantes, criarMemoriaVazia, registarPerguntaNaoReconhecida,
  ensinarAlias, dispensarAlerta, reativarAlerta, alertaEstaDispensado,
  tentarViaRedeNeural, agruparPerguntasSemelhantes,
  LIMIAR_VALIDADE_AVISO_DIAS, LIMIAR_ROTULO_PIM_AVISO_DIAS,
  LIMIAR_PEDIDO_PARADO_AUE_DIAS, LIMIAR_PEDIDO_PARADO_MANIPULADOS_DIAS,
  LIMIAR_REPETICAO_STOCKS_LISTAS, LIMIAR_OPORTUNIDADE_OCORRENCIAS,
  LIMIAR_BACKUP_SEM_RECENTE_HORAS, LIMIAR_SILENCIAR_ALERTA_DIAS
} from "../src/farmaIa.js";
import { prepararDocumento, acrescentarAoConhecimento } from "../src/farmaLeitura.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Pesos reais treinados (ponto 42) — usados aqui para testar a rede neuronal
// integrada em farmaIa.js com o modelo que a Central realmente distribui,
// nunca uns pesos inventados só para o teste passar.
const PESOS_REDE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "farmaRedePesos.json"), "utf8"));

const AGORA = new Date("2026-09-15T12:00:00.000Z");
function isoMenosDias(dias) { return new Date(AGORA.getTime() - dias * 86400000).toISOString().slice(0, 10); }
function isoMaisDias(dias) { return new Date(AGORA.getTime() + dias * 86400000).toISOString().slice(0, 10); }

describe("farmaIa.js — gerarAlertas: robustez", () => {
  test("estado vazio/nulo não rebenta e devolve zero alertas", () => {
    assert.deepEqual(gerarAlertas(null, AGORA).alertas, []);
    assert.deepEqual(gerarAlertas(undefined, AGORA).alertas, []);
    assert.deepEqual(gerarAlertas({}, AGORA).alertas, []);
  });

  test("resumo de um estado sem alertas tem todos os contadores a zero", () => {
    const { resumo } = gerarAlertas({}, AGORA);
    assert.deepEqual(resumo, { total: 0, urgentes: 0, avisos: 0, infos: 0, porModulo: {} });
  });
});

describe("farmaIa.js — gerarAlertas: PIM (embalagens/stock)", () => {
  function estadoComEmbalagem(overrides) {
    return {
      pim: {
        pim_utentes_v1: [{ id: "u1", nome: "Ana Silva", categoria: "ativo" }],
        pim_medicamentos_v1: [{ id: "m1", utenteId: "u1", nomeComercial: "Eutirox" }],
        pim_stock_v1: [{ id: "e1", utenteId: "u1", medicamentoId: "m1", status: "em_uso", quantidadeAtual: 5, validade: isoMaisDias(10), ...overrides }]
      }
    };
  }

  test("embalagem bem dentro da validade e com stock não gera alerta", () => {
    const { alertas } = gerarAlertas(estadoComEmbalagem({ validade: isoMaisDias(90) }), AGORA);
    assert.deepEqual(alertas, []);
  });

  test(`embalagem a expirar em ${LIMIAR_VALIDADE_AVISO_DIAS} dias ou menos gera aviso "validade_perto"`, () => {
    const { alertas } = gerarAlertas(estadoComEmbalagem({ validade: isoMaisDias(LIMIAR_VALIDADE_AVISO_DIAS - 1) }), AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "validade_perto");
    assert.equal(alertas[0].severidade, "aviso");
    assert.match(alertas[0].titulo, /Eutirox/);
    assert.match(alertas[0].titulo, /Ana Silva/);
  });

  test("embalagem já expirada gera alerta urgente", () => {
    const { alertas } = gerarAlertas(estadoComEmbalagem({ validade: isoMenosDias(3) }), AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "validade_expirada");
    assert.equal(alertas[0].severidade, "urgente");
  });

  test("embalagem com quantidadeAtual=0 gera aviso de sem_stock", () => {
    const { alertas } = gerarAlertas(estadoComEmbalagem({ quantidadeAtual: 0, validade: isoMaisDias(90) }), AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "sem_stock");
  });

  test("embalagem 'esgotada' (não em_uso/reserva) não é avaliada", () => {
    const { alertas } = gerarAlertas(estadoComEmbalagem({ status: "esgotada", validade: isoMenosDias(3), quantidadeAtual: 0 }), AGORA);
    assert.deepEqual(alertas, []);
  });

  test("utente arquivado não gera alertas de embalagem, mesmo expirada/sem stock", () => {
    const estado = estadoComEmbalagem({ validade: isoMenosDias(5), quantidadeAtual: 0 });
    estado.pim.pim_utentes_v1[0].categoria = "arquivado";
    assert.deepEqual(gerarAlertas(estado, AGORA).alertas, []);
  });
});

describe("farmaIa.js — gerarAlertas: PIM (rótulos/plano semanal)", () => {
  function estadoComRotulos(rotulos, utenteOverrides) {
    return {
      pim: {
        pim_utentes_v1: [{ id: "u1", nome: "Bruno Costa", categoria: "ativo", ...utenteOverrides }],
        pim_rotulos_v1: rotulos
      }
    };
  }

  test(`rótulo a terminar em ${LIMIAR_ROTULO_PIM_AVISO_DIAS} dias ou menos gera aviso`, () => {
    const estado = estadoComRotulos([{ id: "r1", utenteId: "u1", dataFim: isoMaisDias(2) }]);
    const { alertas } = gerarAlertas(estado, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "rotulo_a_terminar");
    assert.equal(alertas[0].severidade, "aviso");
  });

  test("rótulo já terminado (dataFim no passado) gera alerta urgente", () => {
    const estado = estadoComRotulos([{ id: "r1", utenteId: "u1", dataFim: isoMenosDias(2) }]);
    const { alertas } = gerarAlertas(estado, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "rotulo_terminado");
    assert.equal(alertas[0].severidade, "urgente");
  });

  test("só o rótulo mais recente de cada utente é avaliado (histórico antigo não gera ruído)", () => {
    const estado = estadoComRotulos([
      { id: "r-antigo", utenteId: "u1", dataFim: isoMenosDias(200) },
      { id: "r-recente", utenteId: "u1", dataFim: isoMaisDias(90) }
    ]);
    const { alertas } = gerarAlertas(estado, AGORA);
    assert.deepEqual(alertas, []); // o mais recente está bem dentro do prazo — nada a assinalar
  });

  test("utente em pausa não gera alerta de rótulo a terminar", () => {
    const estado = estadoComRotulos([{ id: "r1", utenteId: "u1", dataFim: isoMenosDias(1) }], { pausa: { ativa: true } });
    assert.deepEqual(gerarAlertas(estado, AGORA).alertas, []);
  });
});

describe("farmaIa.js — gerarAlertas: Gabinete", () => {
  function estadoComItemGabinete(overrides) {
    return { gabinete: { gabinete_stock_v1: [{ id: "g1", nome: "Álcool Gel", validade: isoMaisDias(90), quantidade: 10, quantidadeMinima: 3, ...overrides }] } };
  }

  test("item saudável não gera alerta", () => {
    assert.deepEqual(gerarAlertas(estadoComItemGabinete({}), AGORA).alertas, []);
  });

  test("item expirado gera alerta urgente", () => {
    const { alertas } = gerarAlertas(estadoComItemGabinete({ validade: isoMenosDias(1) }), AGORA);
    assert.equal(alertas.some(a => a.tipo === "validade_expirada" && a.modulo === "gabinete"), true);
  });

  test("item abaixo da quantidade mínima gera aviso", () => {
    const { alertas } = gerarAlertas(estadoComItemGabinete({ quantidade: 1, quantidadeMinima: 5 }), AGORA);
    assert.equal(alertas.some(a => a.tipo === "abaixo_minimo"), true);
  });
});

describe("farmaIa.js — gerarAlertas: Stocks Errados", () => {
  function listaComItem(id, codigo, motivo) {
    return { id, nome: "Lista " + id, criadoEm: isoMenosDias(1), items: [{ codigo, designacao: "Paracetamol 500mg", motivo }] };
  }

  test(`produto "procurei" menos de ${LIMIAR_REPETICAO_STOCKS_LISTAS} vezes não gera alerta`, () => {
    const stocksErrados = { l1: listaComItem("l1", "COD1", "procurei"), l2: listaComItem("l2", "COD1", "procurei") };
    assert.deepEqual(gerarAlertas({ stocksErrados }, AGORA).alertas, []);
  });

  test(`produto "procurei" em ${LIMIAR_REPETICAO_STOCKS_LISTAS}+ contagens diferentes gera aviso de recorrência`, () => {
    const stocksErrados = {};
    for (let i = 0; i < LIMIAR_REPETICAO_STOCKS_LISTAS; i++) stocksErrados["l" + i] = listaComItem("l" + i, "COD1", "procurei");
    const { alertas } = gerarAlertas({ stocksErrados }, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "produto_nao_localizado_recorrente");
    assert.match(alertas[0].titulo, /Paracetamol/);
  });

  test("motivo diferente de 'procurei' (ex.: 'pressa') nunca conta para a recorrência", () => {
    const stocksErrados = {};
    for (let i = 0; i < 5; i++) stocksErrados["l" + i] = listaComItem("l" + i, "COD1", "pressa");
    assert.deepEqual(gerarAlertas({ stocksErrados }, AGORA).alertas, []);
  });
});

describe("farmaIa.js — gerarAlertas: AUE e Manipulados (pedidos parados)", () => {
  test(`pedido AUE não terminal sem atualização há ${LIMIAR_PEDIDO_PARADO_AUE_DIAS}+ dias gera aviso`, () => {
    const estado = { aue: { pedidos: [{ id: "p1", status: "pendente_docs", updatedAt: isoMenosDias(LIMIAR_PEDIDO_PARADO_AUE_DIAS) }] } };
    const { alertas } = gerarAlertas(estado, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].modulo, "aue");
  });

  test("pedido AUE entregue/indeferido nunca gera alerta de parado, por muito antigo que seja", () => {
    const estado = { aue: { pedidos: [{ id: "p1", status: "entregue", updatedAt: isoMenosDias(999) }] } };
    assert.deepEqual(gerarAlertas(estado, AGORA).alertas, []);
  });

  test("pedido AUE apagado (deleted) nunca gera alerta", () => {
    const estado = { aue: { pedidos: [{ id: "p1", status: "pendente_docs", updatedAt: isoMenosDias(999), deleted: true }] } };
    assert.deepEqual(gerarAlertas(estado, AGORA).alertas, []);
  });

  test(`pedido de manipulado em preparação há ${LIMIAR_PEDIDO_PARADO_MANIPULADOS_DIAS}+ dias gera aviso`, () => {
    const estado = { manipulados: [{ id: "m1", status: "preparacao", criado: isoMenosDias(LIMIAR_PEDIDO_PARADO_MANIPULADOS_DIAS), nome: "Rita" }] };
    const { alertas } = gerarAlertas(estado, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].modulo, "manipulados");
    assert.match(alertas[0].titulo, /Rita/);
  });

  test("pedido de manipulado já pronto não gera alerta de parado", () => {
    const estado = { manipulados: [{ id: "m1", status: "pronto", criado: isoMenosDias(999) }] };
    assert.deepEqual(gerarAlertas(estado, AGORA).alertas, []);
  });
});

describe("farmaIa.js — gerarAlertas: ordenação e resumo", () => {
  test("alertas vêm ordenados por gravidade: urgente antes de aviso", () => {
    const estado = {
      gabinete: { gabinete_stock_v1: [{ id: "g1", nome: "X", quantidade: 1, quantidadeMinima: 5 }] }, // aviso
      aue: { pedidos: [{ id: "p1", status: "pendente_docs", updatedAt: isoMenosDias(999) }] } // aviso (parado)
    };
    estado.gabinete.gabinete_stock_v1.push({ id: "g2", nome: "Y", validade: isoMenosDias(1) }); // urgente
    const { alertas } = gerarAlertas(estado, AGORA);
    assert.ok(alertas.length >= 2);
    assert.equal(alertas[0].severidade, "urgente");
  });

  test("resumo conta corretamente por severidade e por módulo", () => {
    const estado = {
      gabinete: { gabinete_stock_v1: [{ id: "g1", nome: "X", validade: isoMenosDias(1) }] }, // urgente, gabinete
      aue: { pedidos: [{ id: "p1", status: "pendente_docs", updatedAt: isoMenosDias(999) }] } // aviso, aue
    };
    const { resumo } = gerarAlertas(estado, AGORA);
    assert.equal(resumo.total, 2);
    assert.equal(resumo.urgentes, 1);
    assert.equal(resumo.avisos, 1);
    assert.equal(resumo.porModulo.gabinete, 1);
    assert.equal(resumo.porModulo.aue, 1);
  });
});

describe("farmaIa.js — responderPergunta", () => {
  const estado = {
    servicos: [{ id: "s1" }, { id: "s2" }],
    categorias: [{ id: "c1" }],
    pim: {
      pim_utentes_v1: [{ id: "u1", nome: "Ana", categoria: "ativo" }, { id: "u2", nome: "Zé", categoria: "arquivado" }]
    },
    aue: { pedidos: [{ id: "p1", status: "pendente_docs" }, { id: "p2", status: "entregue" }] },
    manipulados: [{ id: "m1", status: "preparacao" }, { id: "m2", status: "pronto" }],
    stocksErrados: { l1: { id: "l1", items: [{ codigo: "c1" }, { codigo: "c2" }] } }
  };

  test("pergunta vazia devolve um pedido de esclarecimento, nunca rebenta", () => {
    const r = responderPergunta("", estado);
    assert.equal(r.intentId, null);
    assert.match(r.resposta, /pergunta/i);
  });

  test("pergunta sobre utentes reconhece a intenção e conta só os ativos à parte do total", () => {
    const r = responderPergunta("Quantos utentes tenho no PIM?", estado);
    assert.equal(r.intentId, "utentes");
    assert.match(r.resposta, /1 utente/);
    assert.match(r.resposta, /total de 2/);
  });

  test("pergunta é insensível a maiúsculas/acentos (normalização)", () => {
    const r1 = responderPergunta("QUANTOS UTENTES TENHO?", estado);
    const r2 = responderPergunta("quantos utentes tenho?", estado);
    assert.equal(r1.intentId, r2.intentId);
  });

  test("pergunta sobre pedidos AUE conta só os não-terminais", () => {
    const r = responderPergunta("Quantos pedidos AUE estão pendentes?", estado);
    assert.equal(r.intentId, "pedidos_aue");
    assert.match(r.resposta, /1 pedido/);
  });

  test("pergunta sobre manipulados conta só os em curso", () => {
    const r = responderPergunta("Há manipulados em preparação?", estado);
    assert.equal(r.intentId, "pedidos_manipulados");
    assert.match(r.resposta, /1 pedido/);
  });

  test("pergunta sobre stocks errados soma as divergências de todas as listas", () => {
    const r = responderPergunta("Quantas divergências de stock tenho?", estado);
    assert.equal(r.intentId, "stocks_errados");
    assert.match(r.resposta, /2 divergência/);
  });

  test("pergunta sobre serviços responde com contagem de serviços/categorias", () => {
    const r = responderPergunta("Quantos serviços tenho?", estado);
    assert.equal(r.intentId, "servicos");
    assert.match(r.resposta, /2 serviço/);
    assert.match(r.resposta, /1 categoria/);
  });

  test("pergunta sobre alertas resume por gravidade", () => {
    const r = responderPergunta("Quantos alertas tenho?", estado);
    assert.equal(r.intentId, "alertas_resumo");
  });

  test("pergunta sobre validade responde 'nada a assinalar' quando não há alertas de validade", () => {
    const r = responderPergunta("Há medicamentos perto da validade?", estado);
    assert.equal(r.intentId, "validade");
    assert.match(r.resposta, /Não há/);
  });

  test("pergunta sobre poupança sem contexto.diasUso não inventa um número", () => {
    const r = responderPergunta("Quanto já poupei?", estado);
    assert.equal(r.intentId, "poupanca");
    assert.doesNotMatch(r.resposta, /\d/); // sem dígitos: nenhuma cifra inventada
  });

  test("pergunta sobre poupança com contexto.diasUso calcula a partir de uso real", () => {
    const diasUso = { "2026-09-01": { "pim.criar_utente": 3 } };
    const r = responderPergunta("Quanto já poupei?", estado, { diasUso });
    assert.equal(r.intentId, "poupanca");
    assert.match(r.resposta, /poupou/);
  });

  test("pergunta não reconhecida devolve intentId nulo com sugestões de perguntas", () => {
    const r = responderPergunta("qual é a capital de Portugal", estado);
    assert.equal(r.intentId, null);
    assert.match(r.resposta, /Não percebi/);
  });
});

describe("farmaIa.js — detectarOportunidadesAutomacao", () => {
  test("uso vazio/nulo não rebenta e devolve lista vazia", () => {
    assert.deepEqual(detectarOportunidadesAutomacao(null), []);
    assert.deepEqual(detectarOportunidadesAutomacao({}), []);
  });

  test(`tarefa repetida abaixo do limiar (${LIMIAR_OPORTUNIDADE_OCORRENCIAS}) não aparece como oportunidade`, () => {
    const diasUso = { "2026-09-01": { "pim.criar_utente": LIMIAR_OPORTUNIDADE_OCORRENCIAS - 1 } };
    assert.deepEqual(detectarOportunidadesAutomacao(diasUso), []);
  });

  test(`tarefa repetida ${LIMIAR_OPORTUNIDADE_OCORRENCIAS}+ vezes no período aparece como oportunidade`, () => {
    const diasUso = { "2026-09-01": { "pim.criar_utente": LIMIAR_OPORTUNIDADE_OCORRENCIAS } };
    const oportunidades = detectarOportunidadesAutomacao(diasUso);
    assert.equal(oportunidades.length, 1);
    assert.equal(oportunidades[0].chave, "pim.criar_utente");
    assert.equal(oportunidades[0].totalOcorrencias, LIMIAR_OPORTUNIDADE_OCORRENCIAS);
    assert.match(oportunidades[0].sugestao, /repetid/i);
  });

  test("oportunidades vêm ordenadas por total de ocorrências, da mais repetida para a menos", () => {
    const diasUso = {
      "2026-09-01": { "pim.criar_utente": LIMIAR_OPORTUNIDADE_OCORRENCIAS, "stocks.registar_item": LIMIAR_OPORTUNIDADE_OCORRENCIAS * 5 }
    };
    const oportunidades = detectarOportunidadesAutomacao(diasUso);
    assert.equal(oportunidades.length, 2);
    assert.equal(oportunidades[0].chave, "stocks.registar_item");
    assert.ok(oportunidades[0].totalOcorrencias > oportunidades[1].totalOcorrencias);
  });

  test("frequência muito acima do limiar (3x+) recebe a sugestão de 'forte candidata'", () => {
    const diasUso = { "2026-09-01": { "pim.criar_utente": LIMIAR_OPORTUNIDADE_OCORRENCIAS * 3 } };
    const oportunidades = detectarOportunidadesAutomacao(diasUso);
    assert.match(oportunidades[0].sugestao, /forte candidata/);
  });

  test("respeita um limiarOcorrencias personalizado passado em opts", () => {
    const diasUso = { "2026-09-01": { "pim.criar_utente": 5 } };
    assert.deepEqual(detectarOportunidadesAutomacao(diasUso, { limiarOcorrencias: 10 }), []);
    assert.equal(detectarOportunidadesAutomacao(diasUso, { limiarOcorrencias: 5 }).length, 1);
  });
});

describe("farmaIa.js — gerarAlertas: backup (ponto 26, cruza com src/manutencao.js)", () => {
  test("estado sem a chave config.manutBackups (conta nova, Central ainda não correu) não gera alerta — não é um problema, é transitório", () => {
    assert.deepEqual(gerarAlertas({ config: {} }, AGORA).alertas, []);
    assert.deepEqual(gerarAlertas({}, AGORA).alertas, []);
  });

  test("config.manutBackups vazio (sistema inicializado, zero backups feitos) gera aviso", () => {
    const { alertas } = gerarAlertas({ config: { manutBackups: [] } }, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "sem_backup_recente");
    assert.equal(alertas[0].modulo, "manutencao");
    assert.equal(alertas[0].severidade, "aviso");
  });

  test("último backup recente (dentro do limiar) não gera alerta", () => {
    const manutBackups = [{ id: "b1", criadoEm: new Date(AGORA.getTime() - 3600 * 1000).toISOString() }];
    assert.deepEqual(gerarAlertas({ config: { manutBackups } }, AGORA).alertas, []);
  });

  test(`último backup há mais de ${LIMIAR_BACKUP_SEM_RECENTE_HORAS / 24} dias gera aviso`, () => {
    const manutBackups = [{ id: "b1", criadoEm: new Date(AGORA.getTime() - (LIMIAR_BACKUP_SEM_RECENTE_HORAS + 1) * 3600 * 1000).toISOString() }];
    const { alertas } = gerarAlertas({ config: { manutBackups } }, AGORA);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "sem_backup_recente");
  });
});

describe("farmaIa.js — responderPergunta: sinónimos alargados (aceleração de aprendizagem)", () => {
  const estado = { pim: { pim_utentes_v1: [{ id: "u1", nome: "Ana", categoria: "ativo" }] } };

  test("aceita 'cliente' como sinónimo de 'utente'", () => {
    assert.equal(responderPergunta("quantos clientes tenho?", estado).intentId, "utentes");
  });

  test("aceita 'estoque' (PT-BR) como sinónimo de 'stock'", () => {
    assert.equal(responderPergunta("há alguma divergência de estoque?", estado).intentId, "stocks_errados");
  });

  test("novo intent 'backup' reconhece perguntas sobre cópias de segurança", () => {
    const r = responderPergunta("as cópias de segurança estão em dia?", { config: {} });
    assert.equal(r.intentId, "backup");
    assert.match(r.resposta, /em dia/);
  });

  test("novo intent 'oportunidades' responde sobre automação, com e sem dados de uso", () => {
    const semUso = responderPergunta("há alguma oportunidade de automação?", {});
    assert.equal(semUso.intentId, "oportunidades");
    assert.doesNotMatch(semUso.resposta, /\d/);

    const diasUso = { "2026-09-01": { "pim.criar_utente": LIMIAR_OPORTUNIDADE_OCORRENCIAS } };
    const comUso = responderPergunta("há alguma oportunidade de automação?", {}, { diasUso });
    assert.equal(comUso.intentId, "oportunidades");
    assert.match(comUso.resposta, /oportunidade/);
  });

  test("novo intent 'ajuda' explica o que a FARMA IA faz", () => {
    const r = responderPergunta("o que sabes fazer?", {});
    assert.equal(r.intentId, "ajuda");
    assert.match(r.resposta, /FARMA IA/);
  });
});

describe("farmaIa.js — sugerirIntentsSemelhantes", () => {
  test("pergunta vazia não sugere nada", () => {
    assert.deepEqual(sugerirIntentsSemelhantes(""), []);
  });

  test("pergunta completamente fora do domínio não sugere nada às cegas", () => {
    assert.deepEqual(sugerirIntentsSemelhantes("qual é a capital de Portugal"), []);
  });

  test("pequeno erro de escrita ainda sugere o intent correto (distância de edição)", () => {
    const comErro = sugerirIntentsSemelhantes("quantos utentss tenho");
    assert.ok(comErro.some(s => s.intentId === "utentes"), JSON.stringify(comErro));
  });

  test("sugestões incluem o exemplo de pergunta do intent", () => {
    const sugestoes = sugerirIntentsSemelhantes("tenho validadde perto?");
    assert.ok(sugestoes.some(s => s.intentId === "validade" && s.exemplo));
  });

  test("responderPergunta devolve sugestões quando não reconhece nada", () => {
    const r = responderPergunta("quantos utentss tenho registados", {});
    assert.equal(r.intentId, null);
    assert.ok(Array.isArray(r.sugestoes) && r.sugestoes.length > 0);
  });
});

describe("farmaIa.js — memória: perguntas não reconhecidas e aliases ensinados", () => {
  test("criarMemoriaVazia devolve a forma esperada", () => {
    assert.deepEqual(criarMemoriaVazia(), { perguntasNaoReconhecidas: [], aliases: {}, alertasDispensados: {} });
  });

  test("registarPerguntaNaoReconhecida acumula, sem duplicar a mesma pergunta normalizada", () => {
    let m = criarMemoriaVazia();
    m = registarPerguntaNaoReconhecida(m, "Quantos ossos tem o corpo?", AGORA);
    assert.equal(m.perguntasNaoReconhecidas.length, 1);
    assert.equal(m.perguntasNaoReconhecidas[0].ocorrencias, 1);
    m = registarPerguntaNaoReconhecida(m, "quantos ossos tem o corpo?", new Date(AGORA.getTime() + 1000));
    assert.equal(m.perguntasNaoReconhecidas.length, 1); // mesma pergunta normalizada — não duplica
    assert.equal(m.perguntasNaoReconhecidas[0].ocorrencias, 2);
  });

  test("registarPerguntaNaoReconhecida com pergunta vazia não altera a memória", () => {
    const m = criarMemoriaVazia();
    assert.deepEqual(registarPerguntaNaoReconhecida(m, "   ", AGORA), m);
  });

  test("ensinarAlias grava a correspondência e remove a pergunta da lista de não-reconhecidas", () => {
    let m = criarMemoriaVazia();
    m = registarPerguntaNaoReconhecida(m, "quantos ossos tem o corpo?", AGORA);
    m = ensinarAlias(m, "quantos ossos tem o corpo?", "utentes");
    assert.equal(m.aliases["quantos ossos tem o corpo?"], "utentes");
    assert.equal(m.perguntasNaoReconhecidas.length, 0);
  });

  test("ensinarAlias ignora um intentId que não existe (nunca aprende um destino inválido)", () => {
    const m = criarMemoriaVazia();
    assert.deepEqual(ensinarAlias(m, "pergunta qualquer", "intent_que_nao_existe"), m);
  });

  test("responderPergunta usa um alias aprendido em vez de tentar reconhecer de novo", () => {
    let m = criarMemoriaVazia();
    m = ensinarAlias(m, "isto está tudo bem?", "alertas_resumo");
    const r = responderPergunta("isto está tudo bem?", {}, { memoria: m });
    assert.equal(r.intentId, "alertas_resumo");
    assert.equal(r.viaAprendizagem, true);
  });

  test("responderPergunta sem alias correspondente segue o motor de regras normal (viaAprendizagem false)", () => {
    const estado = { pim: { pim_utentes_v1: [{ id: "u1", categoria: "ativo" }] } };
    const r = responderPergunta("quantos utentes tenho?", estado, { memoria: criarMemoriaVazia() });
    assert.equal(r.intentId, "utentes");
    assert.equal(r.viaAprendizagem, false);
  });
});

describe("farmaIa.js — memória: alertas dispensados (silenciados, nunca para sempre)", () => {
  const estado = { gabinete: { gabinete_stock_v1: [{ id: "g1", nome: "X", quantidade: 1, quantidadeMinima: 5 }] } };

  test("alertaEstaDispensado é false para memória nula/vazia", () => {
    assert.equal(alertaEstaDispensado(null, "qualquer-id"), false);
    assert.equal(alertaEstaDispensado(criarMemoriaVazia(), "qualquer-id"), false);
  });

  test("dispensarAlerta remove o alerta da lista enquanto o silêncio decorre", () => {
    const { alertas: antes } = gerarAlertas(estado, AGORA);
    assert.equal(antes.length, 1);
    const alertaId = antes[0].id;
    const memoria = dispensarAlerta(criarMemoriaVazia(), alertaId, AGORA);
    const { alertas: depois, totalDispensados } = gerarAlertas(estado, AGORA, memoria);
    assert.equal(depois.length, 0);
    assert.equal(totalDispensados, 1);
  });

  test(`dispensarAlerta expira ao fim de ${LIMIAR_SILENCIAR_ALERTA_DIAS} dias por omissão — o alerta volta a aparecer sozinho`, () => {
    const { alertas: antes } = gerarAlertas(estado, AGORA);
    const alertaId = antes[0].id;
    const memoria = dispensarAlerta(criarMemoriaVazia(), alertaId, AGORA);
    const maisTarde = new Date(AGORA.getTime() + (LIMIAR_SILENCIAR_ALERTA_DIAS + 1) * 86400000);
    const { alertas: depois } = gerarAlertas(estado, maisTarde, memoria);
    assert.equal(depois.length, 1); // o silêncio já expirou — a condição de origem continua a existir
  });

  test("reativarAlerta cancela um silêncio antes do prazo", () => {
    const { alertas: antes } = gerarAlertas(estado, AGORA);
    const alertaId = antes[0].id;
    let memoria = dispensarAlerta(criarMemoriaVazia(), alertaId, AGORA);
    assert.equal(alertaEstaDispensado(memoria, alertaId, AGORA), true);
    memoria = reativarAlerta(memoria, alertaId);
    assert.equal(alertaEstaDispensado(memoria, alertaId, AGORA), false);
    assert.equal(gerarAlertas(estado, AGORA, memoria).alertas.length, 1);
  });

  test("reativarAlerta sem esse alerta dispensado não altera a memória", () => {
    const m = criarMemoriaVazia();
    assert.deepEqual(reativarAlerta(m, "id-inexistente"), m);
  });
});

describe("farmaIa.js — tentarViaRedeNeural (ponto 42, fase 2; com os pesos reais treinados)", () => {
  test("sem pesosRede é sempre uma no-op — devolve null", () => {
    assert.equal(tentarViaRedeNeural("há algo a precisar de atenção", null), null);
    assert.equal(tentarViaRedeNeural("há algo a precisar de atenção", undefined), null);
  });

  test("texto vazio devolve null mesmo com pesosRede", () => {
    assert.equal(tentarViaRedeNeural("", PESOS_REDE), null);
    assert.equal(tentarViaRedeNeural(null, PESOS_REDE), null);
  });

  test("aceita uma paráfrase confiante e com margem clara sobre a 2ª hipótese", () => {
    const r = tentarViaRedeNeural("está tudo bem por aqui ou há algo a rever", PESOS_REDE);
    assert.equal(r.intentId, "alertas_resumo");
    assert.ok(r.confianca > 0.85);
  });

  test("nunca aceita quando a confiança fica abaixo do limiar", () => {
    assert.equal(tentarViaRedeNeural("isto aqui está complicado", PESOS_REDE), null);
  });

  test("texto completamente fora do âmbito é reconhecido como fora_do_ambito (não é um dos intents reais)", () => {
    const r = tentarViaRedeNeural("xyz abc 123 lorem ipsum", PESOS_REDE);
    assert.equal(r.intentId, "fora_do_ambito");
  });
});

describe("farmaIa.js — sugerirIntentsSemelhantes com o sinal da rede (ponto 42, fase 3)", () => {
  test("sem pesosRede, o comportamento fica igual ao de sempre (só palavras-chave/distância de edição)", () => {
    const semRede = sugerirIntentsSemelhantes("está tudo bem por aqui ou há algo a rever", 3);
    assert.ok(!semRede.some(s => s.intentId === "alertas_resumo"));
  });

  test("com pesosRede, passa a sugerir um intent que a distância de edição sozinha não via (paráfrase sem nenhuma palavra-chave)", () => {
    const comRede = sugerirIntentsSemelhantes("está tudo bem por aqui ou há algo a rever", 3, PESOS_REDE);
    assert.ok(comRede.some(s => s.intentId === "alertas_resumo"));
  });

  test("pergunta vazia continua a devolver lista vazia, com ou sem pesosRede", () => {
    assert.deepEqual(sugerirIntentsSemelhantes("", 3, PESOS_REDE), []);
  });
});

describe("farmaIa.js — agruparPerguntasSemelhantes (ponto 42, fase 3)", () => {
  function pergunta(texto, ocorrencias, ultimaVez) {
    return { pergunta: texto, texto, ocorrencias, ultimaVez };
  }

  test("sem pesosRede, devolve a lista tal como veio — cada pergunta na sua própria entrada", () => {
    const lista = [pergunta("quantos pedidos aue tenho pendentes", 3, "2026-09-01"), pergunta("quantos pedidos de aue eu tenho", 2, "2026-09-02")];
    const r = agruparPerguntasSemelhantes(lista, null);
    assert.equal(r.length, 2);
    assert.deepEqual(r[0].variantes, [lista[0].pergunta]);
  });

  test("lista com menos de 2 perguntas não tenta agrupar, mesmo com pesosRede", () => {
    const lista = [pergunta("uma pergunta qualquer", 1, "2026-09-01")];
    const r = agruparPerguntasSemelhantes(lista, PESOS_REDE);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].variantes, ["uma pergunta qualquer"]);
  });

  test("com pesosRede, junta duas formulações quase-duplicadas da mesma pergunta numa só entrada", () => {
    const lista = [
      pergunta("quantos pedidos aue tenho pendentes", 3, "2026-09-01"),
      pergunta("quantos pedidos de aue eu tenho", 2, "2026-09-05"),
    ];
    const r = agruparPerguntasSemelhantes(lista, PESOS_REDE);
    assert.equal(r.length, 1);
    assert.equal(r[0].ocorrencias, 5); // soma das duas
    assert.equal(r[0].variantes.length, 2);
    assert.equal(r[0].ultimaVez, "2026-09-05"); // fica a mais recente das duas
  });

  test("com pesosRede, NÃO junta perguntas sobre assuntos claramente diferentes", () => {
    const lista = [
      pergunta("quantos pedidos aue tenho pendentes", 3, "2026-09-01"),
      pergunta("as cópias de segurança estão em dia", 2, "2026-09-02"),
    ];
    const r = agruparPerguntasSemelhantes(lista, PESOS_REDE);
    assert.equal(r.length, 2);
  });

  test("nunca altera a memória original — é só apresentação (a lista de entrada fica intocada)", () => {
    const lista = [pergunta("quantos pedidos aue tenho pendentes", 3, "2026-09-01"), pergunta("quantos pedidos de aue eu tenho", 2, "2026-09-05")];
    const copia = JSON.parse(JSON.stringify(lista));
    agruparPerguntasSemelhantes(lista, PESOS_REDE);
    assert.deepEqual(lista, copia);
  });
});

describe("farmaIa.js — responderPergunta com contexto.pesosRede (ponto 42, fases 2/3, integração ponta-a-ponta)", () => {
  test("uma correspondência de regras/palavras-chave continua sempre a ganhar à rede neuronal", () => {
    const r = responderPergunta("Quantos utentes tenho no PIM?", {}, { pesosRede: PESOS_REDE });
    assert.equal(r.intentId, "utentes");
    assert.ok(!r.viaRedeNeural);
  });

  test("uma paráfrase sem nenhuma palavra-chave, mas reconhecida com confiança pela rede, responde via rede neuronal", () => {
    const r = responderPergunta("está tudo bem por aqui ou há algo a rever", {}, { pesosRede: PESOS_REDE });
    assert.equal(r.intentId, "alertas_resumo");
    assert.equal(r.viaRedeNeural, true);
    assert.ok(typeof r.resposta === "string" && r.resposta.length > 0);
  });

  test("sem contexto.pesosRede, a mesma paráfrase cai no fallback de sempre (não percebi + sugestões)", () => {
    const r = responderPergunta("está tudo bem por aqui ou há algo a rever", {});
    assert.equal(r.intentId, null);
    assert.ok(Array.isArray(r.sugestoes));
  });

  test("texto fora do âmbito nunca é respondido como se fosse um intent real, mesmo com a rede confiante", () => {
    const r = responderPergunta("xyz abc 123 lorem ipsum", {}, { pesosRede: PESOS_REDE });
    assert.equal(r.intentId, null);
    assert.ok(!r.viaRedeNeural);
    assert.ok(Array.isArray(r.sugestoes));
  });

  test("um alias já ensinado continua a ganhar à rede neuronal (memória > rede)", () => {
    let m = criarMemoriaVazia();
    m = registarPerguntaNaoReconhecida(m, "está tudo bem por aqui ou há algo a rever", AGORA);
    m = ensinarAlias(m, "está tudo bem por aqui ou há algo a rever", "validade");
    const r = responderPergunta("está tudo bem por aqui ou há algo a rever", {}, { memoria: m, pesosRede: PESOS_REDE });
    assert.equal(r.intentId, "validade");
    assert.equal(r.viaAprendizagem, true);
    assert.ok(!r.viaRedeNeural);
  });
});

describe("farmaIa.js — responderPergunta com contexto.baseConhecimento (ponto 43, Função 3 'aprender por leitura')", () => {
  const TEXTO_BULA = "A amoxicilina é um antibiótico da classe das penicilinas, usado para tratar infeções bacterianas. " +
    "A dose habitual em adultos é de 500mg a cada 8 horas, podendo variar conforme a indicação clínica.";

  function baseComBula() {
    const { itens } = prepararDocumento("bula-amoxicilina.pdf", TEXTO_BULA, AGORA);
    return acrescentarAoConhecimento([], itens);
  }

  test("uma correspondência de regras continua a ganhar à base de conhecimento", () => {
    const base = baseComBula();
    const r = responderPergunta("Quantos utentes tenho no PIM?", {}, { baseConhecimento: base });
    assert.equal(r.intentId, "utentes");
    assert.ok(!r.viaConhecimento);
  });

  test("sem correspondência de regras/rede, encontra e cita o excerto relevante do documento", () => {
    const base = baseComBula();
    const r = responderPergunta("qual a dose de amoxicilina para adultos", {}, { baseConhecimento: base });
    assert.equal(r.viaConhecimento, true);
    assert.equal(r.documentoFonte, "bula-amoxicilina.pdf");
    assert.equal(r.intentId, null);
    assert.ok(r.resposta.includes("amoxicilina"));
    assert.ok(r.resposta.includes("bula-amoxicilina.pdf"));
  });

  test("sem contexto.baseConhecimento, o comportamento fica igual ao de sempre (não percebi + sugestões)", () => {
    const r = responderPergunta("qual a dose de amoxicilina para adultos", {});
    assert.equal(r.intentId, null);
    assert.ok(!r.viaConhecimento);
    assert.ok(Array.isArray(r.sugestoes));
  });

  test("uma pergunta sem nenhuma relação com os documentos cai no fallback normal, nunca força uma resposta fraca", () => {
    const base = baseComBula();
    const r = responderPergunta("qual é a capital de portugal", {}, { baseConhecimento: base });
    assert.ok(!r.viaConhecimento);
    assert.equal(r.intentId, null);
  });
});
