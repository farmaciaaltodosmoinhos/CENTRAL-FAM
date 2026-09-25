/**
 * src/farmaLeitura.js — ponto 43, Função 3 da aba "Aprender": "aprender por
 * leitura". Lógica pura (sem nenhum acesso a DOM/rede/ficheiros) para
 * transformar o TEXTO já extraído de um documento (Word, PDF, Excel, HTML,
 * texto simples — a extração em si, específica de cada formato, vive em
 * `src/ui/farmaLeituraFicheiros.js`, que só corre no browser) numa pequena
 * base de conhecimento local pesquisável.
 *
 * Honestidade sobre o que isto é e não é: NÃO é compreensão de linguagem
 * natural (não há nenhuma IA externa nem nenhum resumo "inteligente" sem o
 * "cérebro" local opcional, ponto 30). O que há é pesquisa por semelhança
 * lexical — o mesmo hashing de trigramas de `src/farmaRede.js`
 * (`extrairFeatures`), aplicado ao texto do documento em vez de a uma
 * pergunta — que encontra o excerto mais parecido com a pergunta feita.
 * É uma forma simples e 100% local de "procurar no que já li", não de
 * "perceber o que li". Quando o "cérebro" local (WebLLM) está ativo, o
 * excerto encontrado pode servir-lhe de contexto para uma resposta mais
 * fluida — mas nunca ao contrário: esta pesquisa nunca depende do cérebro
 * local para funcionar.
 *
 * Nunca envia o conteúdo do documento para fora do computador da farmácia —
 * tudo aqui é cálculo local sobre texto já em memória.
 */
import { extrairFeatures, similaridadeCosseno, normalizarTextoRede } from "./farmaRede.js";

/** Tamanho-alvo de cada excerto (caracteres) — pequeno o suficiente para uma
 *  resposta não citar um "muro de texto", grande o suficiente para manter
 *  contexto (uma frase isolada perde demasiado sentido). */
const TAMANHO_ALVO_EXCERTO = 480;
const MIN_TAMANHO_EXCERTO = 40; // excertos mais curtos que isto (ex.: um título solto) não valem a pena guardar
const N_DIMS_CONHECIMENTO = 256;

/**
 * Divide texto livre em excertos de tamanho manejável, respeitando
 * parágrafos/frases sempre que possível (nunca corta uma frase a meio se
 * conseguir evitá-lo). Texto vazio/só espaços devolve lista vazia.
 */
export function dividirEmExcertos(texto, tamanhoAlvo = TAMANHO_ALVO_EXCERTO) {
  const limpo = String(texto || "").replace(/\r\n/g, "\n").trim();
  if (!limpo) return [];
  // parágrafos primeiro (linhas em branco a separar) — a unidade natural da
  // maioria dos documentos (Word, PDF extraído, HTML convertido a texto).
  const paragrafos = limpo.split(/\n\s*\n+/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const excertos = [];
  let atual = "";
  for (const paragrafo of paragrafos) {
    if (paragrafo.length > tamanhoAlvo * 1.5) {
      // parágrafo demasiado grande sozinho — parte por frases.
      if (atual) { excertos.push(atual); atual = ""; }
      const frases = paragrafo.split(/(?<=[.!?])\s+/);
      let bloco = "";
      for (const frase of frases) {
        if (bloco && (bloco.length + frase.length + 1) > tamanhoAlvo) { excertos.push(bloco); bloco = frase; }
        else bloco = bloco ? `${bloco} ${frase}` : frase;
      }
      if (bloco) excertos.push(bloco);
      continue;
    }
    if (atual && (atual.length + paragrafo.length + 1) > tamanhoAlvo) { excertos.push(atual); atual = paragrafo; }
    else atual = atual ? `${atual} ${paragrafo}` : paragrafo;
  }
  if (atual) excertos.push(atual);
  return excertos.map(e => e.trim()).filter(e => e.length >= MIN_TAMANHO_EXCERTO);
}

/**
 * Prepara um documento já convertido em texto para entrar na base de
 * conhecimento: divide em excertos e calcula o vetor de features (hashing
 * de trigramas, `src/farmaRede.js`) de cada um. Os vetores vêm arredondados
 * a 4 casas decimais — o mesmo motivo do treino da rede (ver
 * `scripts/treinar-rede-farma.mjs`): a precisão total não ajuda em nada e o
 * JSON gravado fica bem mais pequeno.
 */
export function prepararDocumento(nomeFicheiro, texto, agora = new Date()) {
  const excertos = dividirEmExcertos(texto);
  const itens = excertos.map((excerto, i) => ({
    id: `${normalizarTextoRede(nomeFicheiro).replace(/[^a-z0-9]+/g, "-")}-${i}`,
    ficheiro: nomeFicheiro,
    texto: excerto,
    features: extrairFeatures(excerto, N_DIMS_CONHECIMENTO).map(v => Math.round(v * 1e4) / 1e4),
    adicionadoEm: agora.toISOString(),
  }));
  return {
    relatorio: {
      ficheiro: nomeFicheiro,
      totalExcertos: itens.length,
      amostra: itens.slice(0, 3).map(i => i.texto.slice(0, 160)),
      adicionadoEm: agora.toISOString(),
    },
    itens,
  };
}

/** Limite total de excertos guardados na base de conhecimento — evita
 *  crescimento sem fim (cada excerto carrega um vetor de 256 números).
 *  Ao ultrapassar, os excertos mais antigos são descartados primeiro. */
export const LIMITE_EXCERTOS_CONHECIMENTO = 400;

/**
 * Acrescenta os itens de um documento recém-processado à base de
 * conhecimento existente (array de itens, ver `prepararDocumento`), sem
 * duplicar excertos idênticos ao mesmo ficheiro e respeitando o limite
 * total (`LIMITE_EXCERTOS_CONHECIMENTO`, descartando os mais antigos).
 */
export function acrescentarAoConhecimento(baseAtual, novosItens) {
  const base = Array.isArray(baseAtual) ? baseAtual : [];
  const existentes = new Set(base.map(i => `${i.ficheiro}::${i.texto}`));
  const aAcrescentar = novosItens.filter(i => !existentes.has(`${i.ficheiro}::${i.texto}`));
  const combinado = [...base, ...aAcrescentar];
  if (combinado.length <= LIMITE_EXCERTOS_CONHECIMENTO) return combinado;
  return combinado.slice(combinado.length - LIMITE_EXCERTOS_CONHECIMENTO);
}

/** Remove todos os excertos de um ficheiro específico (esquecer um documento). */
export function esquecerDocumento(baseAtual, nomeFicheiro) {
  const base = Array.isArray(baseAtual) ? baseAtual : [];
  return base.filter(i => i.ficheiro !== nomeFicheiro);
}

/** Lista os documentos já "lidos", com o total de excertos de cada um. */
export function listarDocumentos(baseAtual) {
  const base = Array.isArray(baseAtual) ? baseAtual : [];
  const porFicheiro = new Map();
  for (const item of base) {
    const atual = porFicheiro.get(item.ficheiro) || { ficheiro: item.ficheiro, totalExcertos: 0, adicionadoEm: item.adicionadoEm };
    atual.totalExcertos++;
    if (new Date(item.adicionadoEm).getTime() > new Date(atual.adicionadoEm).getTime()) atual.adicionadoEm = item.adicionadoEm;
    porFicheiro.set(item.ficheiro, atual);
  }
  return [...porFicheiro.values()].sort((a, b) => new Date(b.adicionadoEm) - new Date(a.adicionadoEm));
}

// Calibrado por inspeção manual contra pares pergunta/excerto reais e
// disparatados (ver ponto 43) — a sobreposição de trigramas entre uma
// pergunta curta e um excerto mais longo nunca chega perto de 1 mesmo
// quando são claramente sobre o mesmo assunto (frases partilham sobretudo
// palavras funcionais, não o vocabulário todo), por isso o limiar fica bem
// mais baixo do que pareceria intuitivo. Isto é pesquisa por semelhança
// lexical aproximada, não compreensão — um resultado abaixo disto é
// tratado como "não encontrei nada relevante", nunca forçado.
const LIMIAR_SIMILARIDADE_CONHECIMENTO = 0.42;

/**
 * Procura, na base de conhecimento, o(s) excerto(s) mais parecido(s) com a
 * pergunta (por similaridade de cosseno entre vetores de trigramas — nunca
 * usa a rede de classificação de intents, propositadamente: essa rede está
 * treinada para separar as 11+1 categorias conhecidas, não para pesquisa
 * livre sobre texto arbitrário). Devolve `null` sem nenhum excerto acima do
 * limiar — nunca força uma resposta fraca.
 */
export function pesquisarConhecimento(pergunta, baseAtual, limite = 2) {
  const base = Array.isArray(baseAtual) ? baseAtual : [];
  if (!base.length || !pergunta) return [];
  const featuresPergunta = extrairFeatures(pergunta, N_DIMS_CONHECIMENTO);
  const pontuados = base
    .map(item => ({ ...item, similaridade: similaridadeCosseno(featuresPergunta, item.features) }))
    .filter(item => item.similaridade >= LIMIAR_SIMILARIDADE_CONHECIMENTO)
    .sort((a, b) => b.similaridade - a.similaridade);
  return pontuados.slice(0, limite).map(({ features, ...resto }) => resto);
}
