/**
 * src/usoLeitura.js — leitura e agregação dos dados de uso registados pelos
 * módulos (ver assets/module-chrome.js: registarUso) para o painel de
 * Poupança & ROI (src/ui/poupanca.js).
 *
 * Armazenamento: um blob por mês, `uso-AAAA-MM`, no asset store por tenant
 * (dataStore.getAsset/setAsset — nunca no /api/data principal, mesmo
 * princípio do ponto 5/15 da arquitetura: um log que cresce ao longo do
 * tempo não pode viver dentro do estado partilhado gravado a cada alteração
 * de qualquer módulo). Cada blob tem a forma:
 *   { dias: { "AAAA-MM-DD": { "modulo.tarefaId": contagem, ... }, ... } }
 */

import { chaveTarefa, estimativaEfetiva, TAREFAS_CATALOGO } from "./usoCatalogo.js";

function pad2(n) { return String(n).padStart(2, "0"); }
export function isoDia(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
export function mesDeIso(iso) { return iso.slice(0, 7); }

function listaMesesEntre(inicioIso, fimIso) {
  const meses = [];
  let [ay, am] = inicioIso.slice(0, 7).split("-").map(Number);
  const [by, bm] = fimIso.slice(0, 7).split("-").map(Number);
  while (ay < by || (ay === by && am <= bm)) {
    meses.push(ay + "-" + pad2(am));
    am++; if (am > 12) { am = 1; ay++; }
  }
  return meses;
}

const cacheMeses = new Map(); // "AAAA-MM" -> { dias: {...} } | Promise

async function carregarMes(dataStore, mesChave) {
  if (cacheMeses.has(mesChave)) return cacheMeses.get(mesChave);
  const p = (async () => {
    try {
      const raw = await dataStore.getAsset("uso-" + mesChave);
      if (!raw) return { dias: {} };
      const parsed = JSON.parse(raw);
      return { dias: (parsed && typeof parsed.dias === "object" && parsed.dias) || {} };
    } catch (e) {
      return { dias: {} };
    }
  })();
  cacheMeses.set(mesChave, p);
  const resolvido = await p;
  cacheMeses.set(mesChave, resolvido);
  return resolvido;
}

/** Limpa a cache em memória de meses já lidos (usar depois de o próprio
 *  utilizador editar estimativas não é necessário — só se se quiser forçar
 *  reler os dados do servidor, ex.: botão "atualizar"). */
export function limparCacheUso() { cacheMeses.clear(); }

/**
 * Carrega e devolve os registos diários dentro de [inicioIso, fimIso]
 * (strings "AAAA-MM-DD", inclusive), juntando os meses necessários.
 * Devolve: { "AAAA-MM-DD": { "modulo.tarefaId": contagem } }
 */
export async function carregarUsoPeriodo(dataStore, inicioIso, fimIso) {
  const meses = listaMesesEntre(inicioIso, fimIso);
  const blobs = await Promise.all(meses.map(m => carregarMes(dataStore, m)));
  const dias = {};
  blobs.forEach(b => {
    Object.keys(b.dias).forEach(dia => {
      if (dia >= inicioIso && dia <= fimIso) dias[dia] = b.dias[dia];
    });
  });
  return dias;
}

/** Primeiro dia com QUALQUER registo, entre os meses fornecidos (varre desde
 *  o mês de início da farmácia, guardado em config.usoInicioEm, até hoje). */
export async function primeiroDiaComUso(dataStore, inicioIsoConhecido) {
  const hoje = isoDia(new Date());
  const inicio = inicioIsoConhecido || hoje;
  const dias = await carregarUsoPeriodo(dataStore, inicio, hoje);
  const chaves = Object.keys(dias).sort();
  return chaves.length ? chaves[0] : null;
}

/** Segundos manuais/central/poupados para um conjunto de registos diários,
 *  usando as estimativas efetivas (catálogo + overrides). */
export function calcularPoupanca(dias, overrides) {
  let segundosManual = 0, segundosCentral = 0, totalOcorrencias = 0;
  Object.keys(dias).forEach(dia => {
    const registos = dias[dia];
    Object.keys(registos).forEach(chave => {
      const qtd = registos[chave] || 0;
      const est = estimativaEfetiva(chave, overrides);
      if (!est) return; // tarefa desconhecida (catálogo desatualizado) — ignora em vez de rebentar
      segundosManual += est.tempoManualSeg * qtd;
      segundosCentral += est.tempoCentralSeg * qtd;
      totalOcorrencias += qtd;
    });
  });
  return {
    segundosManual, segundosCentral,
    segundosPoupados: Math.max(0, segundosManual - segundosCentral),
    totalOcorrencias
  };
}

/** Série diária ordenada de segundos poupados — para o gráfico de tendência. */
export function serieDiaria(dias, overrides) {
  return Object.keys(dias).sort().map(dia => ({
    dia, ...calcularPoupanca({ [dia]: dias[dia] }, overrides)
  }));
}

/** Agregado por módulo (para o gráfico de distribuição). */
export function agregarPorModulo(dias, overrides) {
  const porModulo = {};
  Object.keys(dias).forEach(dia => {
    Object.keys(dias[dia]).forEach(chave => {
      const qtd = dias[dia][chave] || 0;
      const est = estimativaEfetiva(chave, overrides);
      if (!est) return;
      if (!porModulo[est.modulo]) porModulo[est.modulo] = { segundosManual: 0, segundosCentral: 0, totalOcorrencias: 0 };
      porModulo[est.modulo].segundosManual += est.tempoManualSeg * qtd;
      porModulo[est.modulo].segundosCentral += est.tempoCentralSeg * qtd;
      porModulo[est.modulo].totalOcorrencias += qtd;
    });
  });
  Object.values(porModulo).forEach(v => { v.segundosPoupados = Math.max(0, v.segundosManual - v.segundosCentral); });
  return porModulo;
}

/** Agregado por tarefa (para a tabela detalhada / gestão de estimativas). */
export function agregarPorTarefa(dias, overrides) {
  const porTarefa = {};
  Object.keys(dias).forEach(dia => {
    Object.keys(dias[dia]).forEach(chave => {
      const qtd = dias[dia][chave] || 0;
      if (!porTarefa[chave]) porTarefa[chave] = 0;
      porTarefa[chave] += qtd;
    });
  });
  return TAREFAS_CATALOGO.map(t => {
    const chave = chaveTarefa(t.modulo, t.tarefaId);
    const est = estimativaEfetiva(chave, overrides);
    const qtd = porTarefa[chave] || 0;
    return {
      chave, modulo: t.modulo, tarefaId: t.tarefaId, nome: t.nome,
      tempoManualSeg: est.tempoManualSeg, tempoCentralSeg: est.tempoCentralSeg,
      totalOcorrencias: qtd,
      segundosPoupados: Math.max(0, (est.tempoManualSeg - est.tempoCentralSeg) * qtd)
    };
  });
}

export function fmtDuracao(segundos) {
  segundos = Math.round(segundos || 0);
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${segundos}s`;
}

export function fmtEuros(valor) {
  return (valor || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
