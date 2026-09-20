/**
 * src/farmaAprendizagemMultifarma.js — ponto 43, Função 4 da aba "Aprender"
 * ("aprendizagem multifarma"): lógica pura (sem `fetch`, sem `document`) de
 * preparação/validação dos dados que uma farmácia contribui e recebe do
 * conhecimento partilhado entre farmácias. O `fetch` real para
 * `/api/farma-aprendizagens` vive em `src/ui/farmaAprendizagemPartilhadaRede.js`
 * (browser-only) — a mesma separação pura/browser já usada por
 * `farmaLeitura.js`/`farmaLeituraFicheiros.js`.
 *
 * Desenho (decisão explícita do Ivo, ponto 43): só se contribui com (1)
 * padrões de linguagem ANÓNIMOS — vetores de características
 * (`extrairFeatures`, trigramas hash), nunca o texto literal de uma
 * pergunta — e (2) estatísticas AGREGADAS (contagens por intent), nunca
 * exemplos. A fonte dos padrões contribuídos é sempre os ALIASES que o
 * operador desta farmácia ensinou explicitamente (`ensinarAlias`) — nunca
 * perguntas reais de utentes, que podiam conter contexto sensível. Isto é
 * reforçado outra vez do lado do servidor (`netlify/functions/farma-
 * aprendizagens.js`), que nunca aceita texto livre em nenhum campo.
 *
 * Partilha é sempre OPT-IN, desligada por omissão (`partilhaAtiva`) — uma
 * farmácia só contribui/recebe se o operador ligar isto explicitamente em
 * Configurações.
 */
import { extrairFeatures } from "./farmaRede.js";

const N_DIMS = 288; // tem de bater certo com src/farmaTreinoLocal.js

/** Diz se esta farmácia ativou a aprendizagem multifarma. Desligado por
 *  omissão — nunca contribui nem recebe sem o operador ligar isto. */
export function partilhaAtiva(config) {
  return !!(config && config.farmaAprendizagemMultifarma && config.farmaAprendizagemMultifarma.ativo === true);
}

/**
 * Converte os aliases ensinados nesta farmácia (`[texto, intentId]`, de
 * `config.farmaIaMemoria.aliases`) em padrões anónimos prontos a enviar —
 * o texto é convertido em vetor AQUI, nunca sai desta função. `limite` corta
 * a lista para não enviar tudo de uma vez (o servidor também tem o seu
 * próprio limite por pedido, isto é só para não montar um pedido enorme).
 */
export function prepararPadroesParaContribuir(aliasesTexto, limite = 50) {
  return (aliasesTexto || [])
    .filter((item) => Array.isArray(item) && typeof item[0] === "string" && item[0].trim() && typeof item[1] === "string" && item[1])
    .slice(0, limite)
    .map(([texto, intentId]) => ({ intentId, features: extrairFeatures(texto, N_DIMS) }));
}

/**
 * Conta quantos aliases esta farmácia ensinou por intent — a estatística
 * agregada que acompanha a contribuição (nunca os exemplos em si).
 */
export function calcularContagensPorIntent(aliasesTexto) {
  const contagens = {};
  for (const item of aliasesTexto || []) {
    const intentId = Array.isArray(item) ? item[1] : null;
    if (typeof intentId === "string" && intentId) contagens[intentId] = (contagens[intentId] || 0) + 1;
  }
  return contagens;
}

/**
 * Monta o corpo do pedido POST /api/farma-aprendizagens a partir dos
 * aliases desta farmácia — função pura, o `fetch` fica para a camada UI.
 */
export function prepararContribuicao(aliasesTexto, opcoes = {}) {
  const limite = opcoes.limite ?? 50;
  return {
    padroes: prepararPadroesParaContribuir(aliasesTexto, limite),
    estatisticas: { contagensPorIntent: calcularContagensPorIntent(aliasesTexto) },
  };
}

/**
 * Revalida (nunca confia cegamente numa resposta de rede, mesmo vinda do
 * nosso próprio servidor) os padrões recebidos de `/api/farma-
 * aprendizagens` antes de os usar como dados de treino — ver
 * `farmaTreinoLocal.js`, que faz esta MESMA verificação outra vez por
 * segurança (defesa em profundidade, não redundância inútil).
 */
export function filtrarPadroesRecebidos(padroes, intentsConhecidos, limite = 500) {
  if (!Array.isArray(padroes)) return [];
  return padroes
    .filter(
      (p) =>
        p && typeof p === "object" &&
        typeof p.intentId === "string" && intentsConhecidos.includes(p.intentId) &&
        Array.isArray(p.features) && p.features.length === N_DIMS &&
        p.features.every((v) => typeof v === "number" && Number.isFinite(v))
    )
    .slice(-limite);
}

/**
 * Resumo legível (para a UI) do estado partilhado devolvido pelo GET
 * /api/farma-aprendizagens — nunca expõe nada além de contagens.
 */
export function resumirConhecimentoPartilhado(estadoPartilhado) {
  if (!estadoPartilhado) {
    return { totalPadroes: 0, farmaciasContribuintes: 0, intentsComMaisContribuicoes: [] };
  }
  const contagens = (estadoPartilhado.estatisticas && estadoPartilhado.estatisticas.contagensPorIntent) || {};
  const intentsComMaisContribuicoes = Object.entries(contagens)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([intentId, total]) => ({ intentId, total }));
  return {
    totalPadroes: Array.isArray(estadoPartilhado.padroes) ? estadoPartilhado.padroes.length : 0,
    farmaciasContribuintes: estadoPartilhado.farmaciasContribuintes || 0,
    intentsComMaisContribuicoes,
  };
}
