/**
 * src/farmaTreinoLocal.js — ponto 43, Função 2 da aba "Aprender" ("treino
 * intensivo"). Treino incremental 100% LOCAL, por farmácia — nunca
 * substitui os pesos partilhados (`src/farmaRedePesos.json`, o mesmo
 * ficheiro para todas as farmácias, distribuído como qualquer código); o
 * resultado fica guardado à parte (`config.farmaTreinoLocal`, ver
 * `modulos/farma-ia.html`) e só é usado nesta farmácia, como uma camada
 * extra em cima do modelo de base.
 *
 * Desenho deliberado para evitar "esquecimento catastrófico": treinar só
 * com os poucos aliases que uma farmácia ensinou (talvez 5, 10 exemplos)
 * por cima dos pesos já treinados destruiria a generalização que o modelo
 * já tinha para tudo o resto — um risco real de "fine-tuning" ingénuo. Por
 * isso este módulo não ajusta os pesos existentes: treina um modelo NOVO,
 * do zero, com o conjunto de dados sintético completo
 * (`scripts/dados-treino-farma.mjs`, o mesmo do treino offline) MAIS os
 * aliases desta farmácia — mais exemplos reais, nunca menos generalização.
 * Corre inteiramente no browser, sem rede (o conjunto de dados sintético já
 * está no código, servido como qualquer outro ficheiro estático).
 *
 * Depois de treinado, o resultado passa por uma verificação de regressão
 * simples (`FRASES_SANIDADE`) antes de ser aceite — se o modelo novo piorar
 * claramente em frases-âncora conhecidas, o treino é descartado e mantém-se
 * o que já havia, em vez de arriscar uma farmácia ficar com um modelo pior
 * do que tinha antes.
 */
import { extrairFeatures, avancar } from "./farmaRede.js";

const N_DIMS = 288;
const N_ESCONDIDA = 26;
const TAXA_APRENDIZAGEM = 0.02;
const LAMBDA_L2 = 1e-4;
const EPOCAS = 150; // orçamento fixo e curto de propósito — isto corre no browser do operador, nunca deve travar a UI por muito tempo
const FRACAO_VALIDACAO = 0.15;

function criarGeradorAleatorio(semente) {
  let s = semente >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar(array, aleatorio) {
  const copia = array.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function criarMatriz(linhas, colunas, aleatorio, escala) {
  return Array.from({ length: linhas }, () => Array.from({ length: colunas }, () => (aleatorio() * 2 - 1) * escala));
}

// Frases-âncora, uma por intent real (nunca "fora_do_ambito" — essa é sobre
// TUDO o resto, não tem uma frase-âncora única representativa). Servem só
// para a verificação de regressão pós-treino, nunca para treinar.
const FRASES_SANIDADE = [
  ["quantos alertas tenho", "alertas_resumo"],
  ["há medicamentos perto da validade", "validade"],
  ["quantos utentes tenho no pim", "utentes"],
  ["quantos pedidos aue estão pendentes", "pedidos_aue"],
  ["tenho manipulados pendentes", "pedidos_manipulados"],
  ["quantas divergências de stock tenho", "stocks_errados"],
  ["quantos serviços tenho organizados", "servicos"],
  ["quanto tempo já poupei", "poupanca"],
  ["as cópias de segurança estão em dia", "backup"],
  ["há alguma oportunidade de automação", "oportunidades"],
  ["o que sabes fazer", "ajuda"],
];

function treinarRede(dados, intents, semente) {
  const aleatorio = criarGeradorAleatorio(semente);
  const dadosEmbaralhados = embaralhar(dados, aleatorio);
  const nValidacao = Math.max(1, Math.round(dadosEmbaralhados.length * FRACAO_VALIDACAO));
  const validacao = dadosEmbaralhados.slice(0, nValidacao);
  const treino = dadosEmbaralhados.slice(nValidacao);

  // Cada item vem em 2 formas possíveis: `[texto, intentId]` (dados
  // sintéticos + aliases desta farmácia — texto local, nunca sai do
  // computador) OU `{ intentId, features }` já vetorizado (padrões
  // partilhados de OUTRAS farmácias, ponto 43 Função 4 — chegam já como
  // vetor, nunca como texto, porque o servidor nunca guarda/devolve texto).
  const preparar = (item) => {
    if (Array.isArray(item)) {
      const [texto, intentId] = item;
      return { features: extrairFeatures(texto, N_DIMS), alvo: intents.indexOf(intentId) };
    }
    return { features: item.features, alvo: intents.indexOf(item.intentId) };
  };
  const treinoPreparado = treino.map(preparar);
  const validacaoPreparada = validacao.map(preparar);

  const escala1 = Math.sqrt(2 / N_DIMS);
  const escala2 = Math.sqrt(2 / N_ESCONDIDA);
  const pesos = {
    nDims: N_DIMS, intents,
    camada1: { W: criarMatriz(N_ESCONDIDA, N_DIMS, aleatorio, escala1), b: new Array(N_ESCONDIDA).fill(0) },
    camada2: { W: criarMatriz(intents.length, N_ESCONDIDA, aleatorio, escala2), b: new Array(intents.length).fill(0) },
  };

  function estadoAdamPara(W, b) {
    return { mW: W.map(l => l.map(() => 0)), vW: W.map(l => l.map(() => 0)), mb: b.map(() => 0), vb: b.map(() => 0) };
  }
  const adam1 = estadoAdamPara(pesos.camada1.W, pesos.camada1.b);
  const adam2 = estadoAdamPara(pesos.camada2.W, pesos.camada2.b);
  const BETA1 = 0.9, BETA2 = 0.999, EPS = 1e-8;
  let passoAdam = 0;

  function aplicarAdam(W, b, gW, gb, estado) {
    passoAdam++;
    const c1 = 1 - Math.pow(BETA1, passoAdam), c2 = 1 - Math.pow(BETA2, passoAdam);
    for (let i = 0; i < W.length; i++) {
      for (let j = 0; j < W[i].length; j++) {
        const g = gW[i][j] + LAMBDA_L2 * W[i][j];
        estado.mW[i][j] = BETA1 * estado.mW[i][j] + (1 - BETA1) * g;
        estado.vW[i][j] = BETA2 * estado.vW[i][j] + (1 - BETA2) * g * g;
        W[i][j] -= TAXA_APRENDIZAGEM * (estado.mW[i][j] / c1) / (Math.sqrt(estado.vW[i][j] / c2) + EPS);
      }
      const g = gb[i];
      estado.mb[i] = BETA1 * estado.mb[i] + (1 - BETA1) * g;
      estado.vb[i] = BETA2 * estado.vb[i] + (1 - BETA2) * g * g;
      b[i] -= TAXA_APRENDIZAGEM * (estado.mb[i] / c1) / (Math.sqrt(estado.vb[i] / c2) + EPS);
    }
  }

  function treinarUmExemplo(exemplo) {
    const { escondida, saida } = avancar(exemplo.features, pesos);
    const dz2 = saida.map((s, i) => s - (i === exemplo.alvo ? 1 : 0));
    const gW2 = dz2.map(d => escondida.map(h => d * h));
    const dEscondida = new Array(escondida.length).fill(0);
    for (let j = 0; j < escondida.length; j++) {
      let soma = 0;
      for (let i = 0; i < dz2.length; i++) soma += dz2[i] * pesos.camada2.W[i][j];
      dEscondida[j] = soma;
    }
    const dz1 = dEscondida.map((d, j) => (escondida[j] > 0 ? d : 0));
    const gW1 = dz1.map(d => exemplo.features.map(f => d * f));
    aplicarAdam(pesos.camada2.W, pesos.camada2.b, gW2, dz2, adam2);
    aplicarAdam(pesos.camada1.W, pesos.camada1.b, gW1, dz1, adam1);
  }

  function exatidao(exemplos) {
    if (!exemplos.length) return 0;
    let certos = 0;
    for (const ex of exemplos) {
      const { saida } = avancar(ex.features, pesos);
      if (saida.indexOf(Math.max(...saida)) === ex.alvo) certos++;
    }
    return certos / exemplos.length;
  }

  for (let epoca = 1; epoca <= EPOCAS; epoca++) {
    for (const exemplo of embaralhar(treinoPreparado, aleatorio)) treinarUmExemplo(exemplo);
  }

  return { pesos, exatidaoValidacao: exatidao(validacaoPreparada) };
}

/**
 * Verifica se `pesosNovos` continua a reconhecer razoavelmente as frases de
 * sanidade — devolve a fração correta (0 a 1). Usado para decidir se um
 * treino local vale a pena aceitar.
 */
export function verificarSanidade(pesosNovos) {
  let certos = 0;
  for (const [texto, intentId] of FRASES_SANIDADE) {
    const features = extrairFeatures(texto, pesosNovos.nDims);
    const { saida } = avancar(features, pesosNovos);
    const previsto = pesosNovos.intents[saida.indexOf(Math.max(...saida))];
    if (previsto === intentId) certos++;
  }
  return certos / FRASES_SANIDADE.length;
}

/** Fração mínima de frases-âncora que o modelo local tem de continuar a
 *  acertar para o treino ser aceite — abaixo disto, o resultado é
 *  descartado e mantém-se o que já havia (nunca piora a farmácia). */
export const LIMIAR_SANIDADE_MINIMO = 0.7;

/**
 * Treina um modelo novo (dados sintéticos + os aliases desta farmácia),
 * verifica a sua sanidade, e devolve `{ aceite, pesos, relatorio }`.
 * `aceite: false` quando a verificação de sanidade falha — nesse caso
 * `pesos` vem `null` e quem chama deve manter o que já tinha.
 *
 * `aliasesTexto` — pares `[texto, intentId]` já ensinados nesta farmácia
 * (de `config.farmaIaMemoria.aliases`); intentIds desconhecidos são
 * ignorados silenciosamente (a mesma garantia que `ensinarAlias` já dá,
 * verificada aqui outra vez por segurança). Exige pelo menos
 * `minimoAliases` para sequer tentar — poucos exemplos não valem o custo de
 * um treino completo.
 *
 * `opcoes.padroesPartilhados` (opcional, ponto 43 Função 4) — padrões de
 * OUTRAS farmácias, já vetorizados (`{ intentId, features }`, nunca texto),
 * obtidos de `/api/farma-aprendizagens`. São revalidados aqui outra vez
 * (tamanho do vetor, intentId conhecido) antes de entrarem no treino —
 * nunca confiar cegamente em dados vindos da rede, mesmo já validados pelo
 * servidor. Um padrão inválido/malicioso não consegue, no pior caso, fazer
 * mais do que baixar a exatidão — e mesmo isso fica protegido pela
 * verificação de sanidade a seguir, que recusa o modelo inteiro se a
 * combinação ficar pior do que o esperado.
 */
export async function treinarLocal(aliasesTexto, opcoes = {}) {
  const minimoAliases = opcoes.minimoAliases ?? 3;
  const semente = opcoes.semente ?? Date.now();
  const { DADOS_TREINO } = await import(/* @vite-ignore */ opcoes.dadosTreinoUrl || "../scripts/dados-treino-farma.mjs");
  const intents = [...new Set(DADOS_TREINO.map(([, id]) => id))].sort();

  const aliasesValidos = (aliasesTexto || []).filter(([, id]) => intents.includes(id));
  if (aliasesValidos.length < minimoAliases) {
    return { aceite: false, pesos: null, relatorio: { motivo: `precisa de pelo menos ${minimoAliases} perguntas ensinadas (tem ${aliasesValidos.length}).` } };
  }

  const padroesPartilhadosValidos = (opcoes.padroesPartilhados || []).filter(
    (p) => p && typeof p.intentId === "string" && intents.includes(p.intentId) &&
      Array.isArray(p.features) && p.features.length === N_DIMS && p.features.every((v) => typeof v === "number" && Number.isFinite(v))
  );

  const dadosCombinados = [...DADOS_TREINO, ...aliasesValidos, ...padroesPartilhadosValidos];
  const { pesos, exatidaoValidacao } = treinarRede(dadosCombinados, intents, semente);
  const sanidade = verificarSanidade(pesos);

  if (sanidade < LIMIAR_SANIDADE_MINIMO) {
    return {
      aceite: false, pesos: null,
      relatorio: { motivo: "o modelo treinado não passou na verificação de sanidade — mantidos os pesos anteriores.", sanidade, exatidaoValidacao },
    };
  }

  return {
    aceite: true, pesos,
    relatorio: {
      totalExemplos: dadosCombinados.length, aliasesIncluidos: aliasesValidos.length,
      padroesPartilhadosIncluidos: padroesPartilhadosValidos.length,
      exatidaoValidacao, sanidade, treinadoEm: new Date().toISOString(),
    },
  };
}
