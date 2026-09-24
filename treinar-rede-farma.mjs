#!/usr/bin/env node
/**
 * scripts/treinar-rede-farma.mjs — ponto 42. Treina a rede neuronal de
 * `src/farmaRede.js` a partir dos exemplos em `scripts/dados-treino-farma.mjs`
 * e grava os pesos resultantes em `src/farmaRedePesos.json`.
 *
 * Corre-se UMA VEZ, offline, aqui no ambiente de desenvolvimento — nunca no
 * computador do operador (ver o cabeçalho de `src/farmaRede.js` para o
 * porquê). Repetir este script (ex.: depois de crescer o conjunto de dados
 * de treino) produz um novo `farmaRedePesos.json`, que se distribui como
 * qualquer outro ficheiro de código.
 *
 * Rede: entrada (256 dims, hashing de trigramas) -> 1 camada escondida (24
 * unidades, ReLU) -> saída (11 unidades, softmax). Backpropagation manual
 * (sem nenhuma biblioteca de ML) com Adam + regularização L2 + paragem
 * antecipada pela exatidão de validação — dataset pequeno de propósito
 * (ver nota de honestidade em dados-treino-farma.mjs), por isso a paragem
 * antecipada é o que evita decorar o conjunto de treino em vez de
 * generalizar.
 *
 * Uso: `node scripts/treinar-rede-farma.mjs`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extrairFeatures, avancar } from "../src/farmaRede.js";
import { DADOS_TREINO } from "./dados-treino-farma.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const N_DIMS = 288;
const N_ESCONDIDA = 26;
const SEMENTE = 42; // reprodutibilidade — mesmos pesos sempre que se corre com os mesmos dados
const TAXA_APRENDIZAGEM = 0.02;
const LAMBDA_L2 = 1e-4;
const MAX_EPOCAS = 4000;
const PACIENCIA = 400; // páras se a exatidão de validação não melhorar durante tantas épocas
const FRACAO_VALIDACAO = 0.2;

/** Gerador determinístico (mulberry32) — nada de Math.random() aqui, para o
 * treino ser reprodutível byte a byte entre corridas. */
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
  return Array.from({ length: linhas }, () =>
    Array.from({ length: colunas }, () => (aleatorio() * 2 - 1) * escala)
  );
}

function main() {
  const intents = [...new Set(DADOS_TREINO.map(([, id]) => id))].sort();
  console.log(`Intents: ${intents.length} (${intents.join(", ")})`);
  console.log(`Exemplos de treino: ${DADOS_TREINO.length}`);

  const aleatorio = criarGeradorAleatorio(SEMENTE);
  const dadosEmbaralhados = embaralhar(DADOS_TREINO, aleatorio);
  const nValidacao = Math.round(dadosEmbaralhados.length * FRACAO_VALIDACAO);
  const validacao = dadosEmbaralhados.slice(0, nValidacao);
  const treino = dadosEmbaralhados.slice(nValidacao);
  console.log(`Treino: ${treino.length} exemplos · Validação: ${validacao.length} exemplos`);

  const prepararExemplo = ([texto, intentId]) => ({
    features: extrairFeatures(texto, N_DIMS),
    alvo: intents.indexOf(intentId),
    texto, intentId,
  });
  const treinoPreparado = treino.map(prepararExemplo);
  const validacaoPreparada = validacao.map(prepararExemplo);

  // Xavier/Glorot simplificado — escala pelo tamanho da camada anterior,
  // para os valores iniciais não saturarem nem desaparecerem no ReLU.
  const escala1 = Math.sqrt(2 / N_DIMS);
  const escala2 = Math.sqrt(2 / N_ESCONDIDA);
  let pesos = {
    nDims: N_DIMS,
    intents,
    camada1: { W: criarMatriz(N_ESCONDIDA, N_DIMS, aleatorio, escala1), b: new Array(N_ESCONDIDA).fill(0) },
    camada2: { W: criarMatriz(intents.length, N_ESCONDIDA, aleatorio, escala2), b: new Array(intents.length).fill(0) },
  };

  // Estado do Adam (1º e 2º momentos) para cada tensor.
  function estadoAdamPara(W, b) {
    return {
      mW: W.map(linha => linha.map(() => 0)), vW: W.map(linha => linha.map(() => 0)),
      mb: b.map(() => 0), vb: b.map(() => 0),
    };
  }
  const adam1 = estadoAdamPara(pesos.camada1.W, pesos.camada1.b);
  const adam2 = estadoAdamPara(pesos.camada2.W, pesos.camada2.b);
  const BETA1 = 0.9, BETA2 = 0.999, EPS = 1e-8;
  let passoAdam = 0;

  function aplicarAdam(W, b, gW, gb, estado) {
    passoAdam++;
    const correcao1 = 1 - Math.pow(BETA1, passoAdam);
    const correcao2 = 1 - Math.pow(BETA2, passoAdam);
    for (let i = 0; i < W.length; i++) {
      for (let j = 0; j < W[i].length; j++) {
        const g = gW[i][j] + LAMBDA_L2 * W[i][j]; // regularização L2
        estado.mW[i][j] = BETA1 * estado.mW[i][j] + (1 - BETA1) * g;
        estado.vW[i][j] = BETA2 * estado.vW[i][j] + (1 - BETA2) * g * g;
        const mChapeu = estado.mW[i][j] / correcao1;
        const vChapeu = estado.vW[i][j] / correcao2;
        W[i][j] -= TAXA_APRENDIZAGEM * mChapeu / (Math.sqrt(vChapeu) + EPS);
      }
      const g = gb[i];
      estado.mb[i] = BETA1 * estado.mb[i] + (1 - BETA1) * g;
      estado.vb[i] = BETA2 * estado.vb[i] + (1 - BETA2) * g * g;
      const mChapeu = estado.mb[i] / correcao1;
      const vChapeu = estado.vb[i] / correcao2;
      b[i] -= TAXA_APRENDIZAGEM * mChapeu / (Math.sqrt(vChapeu) + EPS);
    }
  }

  function treinarUmExemplo(exemplo) {
    const { escondida, saida } = avancar(exemplo.features, pesos);
    // gradiente softmax+entropia cruzada: saida - onehot(alvo)
    const dz2 = saida.map((s, i) => s - (i === exemplo.alvo ? 1 : 0));
    const gW2 = dz2.map(d => escondida.map(h => d * h));
    const gb2 = dz2;
    const dEscondida = new Array(escondida.length).fill(0);
    for (let j = 0; j < escondida.length; j++) {
      let soma = 0;
      for (let i = 0; i < dz2.length; i++) soma += dz2[i] * pesos.camada2.W[i][j];
      dEscondida[j] = soma;
    }
    const dz1 = dEscondida.map((d, j) => (escondida[j] > 0 ? d : 0)); // derivada do ReLU
    const gW1 = dz1.map(d => exemplo.features.map(f => d * f));
    const gb1 = dz1;
    aplicarAdam(pesos.camada2.W, pesos.camada2.b, gW2, gb2, adam2);
    aplicarAdam(pesos.camada1.W, pesos.camada1.b, gW1, gb1, adam1);
    return saida[exemplo.alvo]; // probabilidade dada ao alvo certo — só para logging
  }

  function exatidao(exemplos) {
    let certos = 0;
    for (const ex of exemplos) {
      const { saida } = avancar(ex.features, pesos);
      const previsto = saida.indexOf(Math.max(...saida));
      if (previsto === ex.alvo) certos++;
    }
    return exemplos.length ? certos / exemplos.length : 0;
  }

  function clonarPesos(p) {
    return JSON.parse(JSON.stringify(p));
  }

  let melhorExatidaoValidacao = -1;
  let melhoresPesos = clonarPesos(pesos);
  let epocasSemMelhoria = 0;
  let epocaFinal = 0;

  for (let epoca = 1; epoca <= MAX_EPOCAS; epoca++) {
    const ordemEpoca = embaralhar(treinoPreparado, aleatorio);
    for (const exemplo of ordemEpoca) treinarUmExemplo(exemplo);

    if (epoca % 10 === 0 || epoca === MAX_EPOCAS) {
      const exatidaoValidacao = exatidao(validacaoPreparada);
      if (exatidaoValidacao > melhorExatidaoValidacao) {
        melhorExatidaoValidacao = exatidaoValidacao;
        melhoresPesos = clonarPesos(pesos);
        epocasSemMelhoria = 0;
      } else {
        epocasSemMelhoria += 10;
      }
      if (epoca % 200 === 0) {
        console.log(`Época ${epoca}: exatidão treino=${(exatidao(treinoPreparado) * 100).toFixed(1)}% validação=${(exatidaoValidacao * 100).toFixed(1)}% (melhor até agora: ${(melhorExatidaoValidacao * 100).toFixed(1)}%)`);
      }
      if (epocasSemMelhoria >= PACIENCIA) {
        console.log(`Sem melhoria na validação há ${PACIENCIA} épocas — a parar na época ${epoca}.`);
        epocaFinal = epoca;
        break;
      }
    }
    epocaFinal = epoca;
  }

  pesos = melhoresPesos;
  const exatidaoTreinoFinal = exatidao(treinoPreparado);
  const exatidaoValidacaoFinal = exatidao(validacaoPreparada);
  console.log(`\nTreino terminado na época ${epocaFinal}.`);
  console.log(`Exatidão final — treino: ${(exatidaoTreinoFinal * 100).toFixed(1)}% · validação: ${(exatidaoValidacaoFinal * 100).toFixed(1)}%`);

  // Matriz de confusão da validação — para saber exatamente ONDE a rede erra,
  // nunca esconder isto (mesma disciplina de honestidade do resto da sessão).
  const erros = [];
  for (const ex of validacaoPreparada) {
    const { saida } = avancar(ex.features, pesos);
    const previsto = intents[saida.indexOf(Math.max(...saida))];
    if (previsto !== ex.intentId) erros.push({ texto: ex.texto, esperado: ex.intentId, previsto, confianca: Math.max(...saida) });
  }
  if (erros.length) {
    console.log(`\n${erros.length} erro(s) na validação:`);
    erros.forEach(e => console.log(`  "${e.texto}" — esperado "${e.esperado}", previsto "${e.previsto}" (confiança ${(e.confianca * 100).toFixed(0)}%)`));
  } else {
    console.log("\nSem nenhum erro na validação.");
  }

  // Arredonda a 5 casas decimais antes de gravar — a precisão total de
  // ponto flutuante não ajuda em nada aqui (o ruído do treino já é maior do
  // que isto) e o ficheiro de texto fica bem mais pequeno.
  function arredondar(x) { return Math.round(x * 1e5) / 1e5; }
  const pesosCompactos = {
    ...pesos,
    camada1: { W: pesos.camada1.W.map(l => l.map(arredondar)), b: pesos.camada1.b.map(arredondar) },
    camada2: { W: pesos.camada2.W.map(l => l.map(arredondar)), b: pesos.camada2.b.map(arredondar) },
  };
  const destino = path.join(__dirname, "..", "src", "farmaRedePesos.json");
  fs.writeFileSync(destino, JSON.stringify(pesosCompactos));
  console.log(`\nPesos gravados em ${destino} (${fs.statSync(destino).size} bytes).`);
}

main();
