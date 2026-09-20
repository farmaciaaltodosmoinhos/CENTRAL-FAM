/**
 * src/farmaExplorarCentral.js — ponto 43, Função 1 da aba "Aprender"
 * ("explorar central"): a FARMA "conhece" a Central inteira a partir do
 * catálogo REAL já existente — `MODULOS_ATALHOS` (src/domain.js, a lista
 * oficial dos 14 módulos) e `TAREFAS_CATALOGO` (src/usoCatalogo.js, o
 * catálogo real de ações rastreáveis de cada módulo, já usado pelo painel
 * de Poupança & ROI). Isto é deliberado: em vez de fingir que a FARMA "lê e
 * entende" o código-fonte (o que exigiria mesmo uma IA a interpretar
 * código, algo que a Central nunca faz — ponto 29, sem IA externa), o seu
 * "conhecimento da Central" é honesto e verificável — um índice construído
 * a partir dos mesmos dados que já orientam o resto da app.
 *
 * Duas capacidades:
 *
 *  1. ÍNDICE DE CAPACIDADES (`construirIndiceCapacidades`/`procurarCapacidade`)
 *     — permite, no futuro, responder "como faço X" mesmo para ações sem
 *     uma regra dedicada em `farmaIa.js`, procurando no catálogo real de
 *     tarefas por semelhança de texto.
 *
 *  2. PROPOSTAS (`gerarPropostas`/`registarPropostas`/`atualizarEstadoProposta`)
 *     — reaproveita `detectarOportunidadesAutomacao` (já existente, ponto
 *     17/aba "Oportunidades") mas guarda-as como uma FILA PERSISTENTE com
 *     estado (`pendente` → `aprovada_para_revisao` | `rejeitada`), em vez
 *     de uma lista recalculada e esquecida a cada visita. "Aprovar" aqui
 *     NUNCA implementa nada sozinho — só sinaliza que a farmácia quer que
 *     aquilo seja avaliado numa sessão futura com o Claude e o Ivo (decisão
 *     explícita do Ivo, ponto 43: "sempre revistas por ti"). A FARMA nunca
 *     escreve nem executa código a partir disto.
 */
import { MODULOS_ATALHOS } from "./domain.js";
import { TAREFAS_CATALOGO } from "./usoCatalogo.js";
import { normalizarTextoRede } from "./farmaRede.js";

const LIMITE_PROPOSTAS = 200;

/* ---------------------------------------------------------------- índice */

/**
 * Constrói o índice de capacidades — uma entrada por tarefa do catálogo,
 * com o nome do módulo já resolvido. Puro e determinístico: a mesma
 * chamada dá sempre o mesmo resultado, porque vem só dos catálogos
 * estáticos já existentes.
 */
export function construirIndiceCapacidades() {
  const nomesPorModulo = Object.fromEntries(MODULOS_ATALHOS.map((m) => [m.modulo, m.nome]));
  return TAREFAS_CATALOGO.map((t) => ({
    modulo: t.modulo,
    moduloNome: nomesPorModulo[t.modulo] || t.modulo,
    tarefaId: t.tarefaId,
    nome: t.nome,
  }));
}

function palavras(texto) {
  return normalizarTextoRede(texto).split(/\s+/).filter((p) => p.length >= 3);
}

/**
 * Procura no índice por sobreposição de palavras (normalizadas, sem
 * acentos) entre a consulta e o nome da tarefa/módulo — suficiente para
 * nomes curtos e descritivos como os do catálogo, sem precisar da rede
 * neuronal (essa está otimizada para separar os 12 intents da aba
 * "Perguntar", não para uma pesquisa de texto livre sobre centenas de
 * tarefas). Devolve só resultados com pelo menos uma palavra em comum,
 * ordenados por nº de palavras coincidentes.
 */
export function procurarCapacidade(consulta, limite = 5, indice = null) {
  const idx = indice || construirIndiceCapacidades();
  const palavrasConsulta = new Set(palavras(consulta));
  if (!palavrasConsulta.size) return [];

  const pontuados = idx
    .map((item) => {
      const palavrasItem = new Set([...palavras(item.nome), ...palavras(item.moduloNome)]);
      let comuns = 0;
      for (const p of palavrasConsulta) if (palavrasItem.has(p)) comuns++;
      return { item, comuns };
    })
    .filter((p) => p.comuns > 0)
    .sort((a, b) => b.comuns - a.comuns);

  return pontuados.slice(0, limite).map((p) => p.item);
}

/* -------------------------------------------------------------- propostas */

/** Hash simples e estável (não criptográfico — só para deduplicar
 *  propostas com o mesmo conteúdo) via djb2. */
function hashEstavel(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = (h * 33) ^ texto.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/**
 * Converte oportunidades já detetadas (`detectarOportunidadesAutomacao`,
 * passada como `oportunidades` — este módulo não recalcula, para não
 * duplicar/desalinhar a lógica já testada em farmaIa.js) em propostas
 * formais, com um id determinístico (mesma tarefa + mesma ordem de
 * grandeza de ocorrências => mesmo id, para não gerar duplicados a cada
 * exploração).
 */
export function gerarPropostas(oportunidades, agora = new Date()) {
  return (oportunidades || []).map((o) => {
    const grandeza = Math.floor(Math.log10(Math.max(1, o.totalOcorrencias)));
    const id = `explorar:${o.chave}:${grandeza}`;
    return {
      id,
      origem: "explorar_central",
      modulo: o.modulo,
      tarefaId: o.tarefaId,
      titulo: `Automatizar "${o.nome}"`,
      descricao: o.sugestao,
      evidencia: `${o.totalOcorrencias} ocorrências registadas (≈${o.mediaDiaria}/dia) no módulo ${o.modulo}.`,
      estado: "pendente",
      criadoEm: agora.toISOString(),
    };
  });
}

/**
 * Junta propostas recém-geradas à fila persistida, sem duplicar (por id) e
 * sem nunca reabrir uma proposta já decidida (aprovada/rejeitada) — se o
 * operador já decidiu, essa decisão fica, mesmo que o padrão continue a
 * repetir-se em explorações seguintes. Aplica o limite máximo, descartando
 * as mais antigas já decididas primeiro (nunca uma pendente por decidir).
 */
export function registarPropostas(propostasAtuais, novasPropostas) {
  const atuais = propostasAtuais || [];
  const idsExistentes = new Set(atuais.map((p) => p.id));
  const aAdicionar = (novasPropostas || []).filter((p) => !idsExistentes.has(p.id));
  let combinadas = [...atuais, ...aAdicionar];

  if (combinadas.length > LIMITE_PROPOSTAS) {
    const excesso = combinadas.length - LIMITE_PROPOSTAS;
    const decididas = combinadas.filter((p) => p.estado !== "pendente").sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const idsParaRemover = new Set(decididas.slice(0, excesso).map((p) => p.id));
    combinadas = combinadas.filter((p) => !idsParaRemover.has(p.id));
  }
  return combinadas;
}

/**
 * Atualiza o estado de uma proposta (`pendente` -> `aprovada_para_revisao`
 * | `rejeitada`). "Aprovar" só marca a proposta para ser trazida a uma
 * sessão futura com o Claude — nunca implementa nada sozinha.
 */
export function atualizarEstadoProposta(propostas, id, novoEstado, agora = new Date()) {
  const estadosValidos = ["pendente", "aprovada_para_revisao", "rejeitada"];
  if (!estadosValidos.includes(novoEstado)) return propostas;
  return (propostas || []).map((p) => (p.id === id ? { ...p, estado: novoEstado, decididoEm: agora.toISOString() } : p));
}

/** Só as propostas ainda por decidir — o que a UI mostra por omissão. */
export function propostasPendentes(propostas) {
  return (propostas || []).filter((p) => p.estado === "pendente");
}
