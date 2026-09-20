/**
 * src/farmaRede.js — ponto 42 (fase 2 do plano "FARMA aprende a pensar",
 * ver ponto 41). Uma rede neuronal pequena para reconhecer a INTENÇÃO de
 * uma pergunta feita à FARMA (a camada de perguntas e respostas de
 * `src/farmaIa.js`, `responderPergunta`) — com tolerância real a paráfrases
 * e erros de escrita, ao contrário do casamento por palavras-chave exatas
 * já existente (`corresponde()`, que só reconhece a pergunta se uma palavra
 * da lista aparecer literalmente no texto: "caduca" não batia com nenhuma
 * das palavras de "validade" antes desta peça).
 *
 * Deliberadamente pequena e sem NENHUMA dependência externa (nem
 * TensorFlow.js nem equivalente) — os pesos treinados (poucas dezenas de
 * KB, ver `src/farmaRedePesos.json`) e este ficheiro de inferência correm
 * 100% no browser, sem GPU, tal como o resto da Central. O treino em si
 * corre à parte (`scripts/treinar-rede-farma.mjs`), UMA VEZ, offline, não no
 * computador do operador — os pesos resultantes são um ficheiro estático
 * distribuído com o código, exatamente como qualquer outro ficheiro do
 * módulo. Nunca é treinado por farmácia nem depende de um único computador;
 * uma eventual atualização do modelo distribui-se como qualquer outra
 * atualização de código (sincronizada para a pasta do Ivo como sempre).
 *
 * Arquitetura: entrada (hashing de trigramas de caracteres, tamanho fixo)
 * -> 1 camada escondida (ReLU) -> camada de saída (softmax, 1 unidade por
 * intent). A camada escondida também serve de "embedding" compacto de uma
 * frase — reutilizado na fase 3 (`src/farmaIa.js`, memória que generaliza)
 * para comparar semelhança entre perguntas sem ter de correr a rede duas
 * vezes.
 */

/** Mesma normalização de `src/farmaIa.js` (`normalizarTexto`), duplicada
 * aqui de propósito — evita um import circular entre os dois ficheiros
 * (farmaIa.js importa desta peça; se esta peça importasse de lá também,
 * ficaria um ciclo). É uma função pura de 4 linhas; manter os dois textos
 * iguais é o único cuidado que isto pede. */
export function normalizarTextoRede(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}

/** Hash simples (FNV-1a de 32 bits) — determinístico, sem dependências,
 * suficiente para distribuir trigramas por um vetor de tamanho fixo sem
 * precisar de guardar um vocabulário explícito (a técnica de "hashing
 * trick"). Não precisa de ser criptográfico, só de ter poucas colisões. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Extrai um vetor de features de tamanho fixo (`nDims`) a partir de trigramas
 * de caracteres do texto normalizado, com padding de espaços nas pontas
 * (` texto ` em vez de `texto`) para os trigramas das bordas contarem tanto
 * como os do meio. Cada trigrama incrementa a posição `hash(trigrama) %
 * nDims` do vetor; no fim, o vetor é normalizado (norma L2) para o
 * comprimento da frase não influenciar a escala — sem isto, uma pergunta
 * longa "dominava" a rede só por ter mais trigramas, não por ser mais
 * parecida com um intent.
 *
 * Trigramas de caracteres (em vez de palavras inteiras) tornam isto
 * tolerante a variações de forma verbal e pequenos erros de escrita:
 * "caduca"/"caducar"/"caducado" partilham vários trigramas entre si, e
 * "validade"/"validae" (erro de escrita) também.
 */
export function extrairFeatures(texto, nDims = 256) {
  const normalizado = normalizarTextoRede(texto);
  const vetor = new Array(nDims).fill(0);
  if (!normalizado) return vetor;
  const comPadding = ` ${normalizado.replace(/\s+/g, " ")} `;
  for (let i = 0; i <= comPadding.length - 3; i++) {
    const trigrama = comPadding.slice(i, i + 3);
    vetor[fnv1a(trigrama) % nDims]++;
  }
  let normaQuadrada = 0;
  for (let i = 0; i < nDims; i++) normaQuadrada += vetor[i] * vetor[i];
  if (normaQuadrada === 0) return vetor;
  const norma = Math.sqrt(normaQuadrada);
  for (let i = 0; i < nDims; i++) vetor[i] /= norma;
  return vetor;
}

function multiplicarMatrizVetor(W, b, x) {
  // W: array de linhas (uma por unidade de saída), cada linha com o mesmo
  // comprimento de x. b: um valor por linha. Devolve W·x + b.
  const saida = new Array(W.length);
  for (let i = 0; i < W.length; i++) {
    const linha = W[i];
    let soma = b[i];
    for (let j = 0; j < linha.length; j++) soma += linha[j] * x[j];
    saida[i] = soma;
  }
  return saida;
}

function relu(v) {
  return v.map(x => (x > 0 ? x : 0));
}

function softmax(v) {
  const max = Math.max(...v);
  const exps = v.map(x => Math.exp(x - max));
  const soma = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / soma);
}

/**
 * Passagem para a frente pura (sem efeitos, testável sem os pesos reais).
 * Devolve `{ escondida, saida }` — `saida` já com softmax aplicado (soma 1,
 * cada posição corresponde a `pesos.intents[i]`), `escondida` é o vetor
 * depois do ReLU (o "embedding" reutilizado na fase 3).
 */
export function avancar(features, pesos) {
  const z1 = multiplicarMatrizVetor(pesos.camada1.W, pesos.camada1.b, features);
  const escondida = relu(z1);
  const z2 = multiplicarMatrizVetor(pesos.camada2.W, pesos.camada2.b, escondida);
  const saida = softmax(z2);
  return { escondida, saida };
}

/**
 * Interpreta uma pergunta em texto livre com a rede treinada — função de
 * alto nível usada em produção (`src/farmaIa.js`). Devolve os intents
 * ordenados por confiança (probabilidade do softmax, entre 0 e 1) e o
 * embedding da frase (para a fase 3). Nunca decide sozinha um limiar de
 * confiança — isso é responsabilidade de quem chama (`responderPergunta`),
 * que decide quando confiar o suficiente para responder sem perguntar.
 */
export function preverIntent(texto, pesos) {
  const features = extrairFeatures(texto, pesos.nDims);
  const { escondida, saida } = avancar(features, pesos);
  const previsoes = pesos.intents
    .map((intentId, i) => ({ intentId, confianca: saida[i] }))
    .sort((a, b) => b.confianca - a.confianca);
  return { previsoes, embedding: escondida };
}

/** Similaridade de cosseno entre dois embeddings (vetores da camada
 * escondida) — usada na fase 3 para detetar perguntas semelhantes sem
 * precisar de as classificar num intent específico primeiro. Devolve um
 * valor entre -1 e 1 (1 = idênticos); 0 quando algum vetor é todo zeros
 * (nunca rebenta com divisão por zero). */
export function similaridadeCosseno(a, b) {
  let produto = 0, normaA = 0, normaB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    produto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}
