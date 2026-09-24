/**
 * netlify/functions/farma-aprendizagens.js — ponto 43, Função 4 da aba
 * "Aprender" ("aprendizagem multifarma"): cada farmácia ensina coisas
 * diferentes à sua FARMA, mas todas podem partilhar o que aprenderam para
 * todas funcionarem melhor — SEM nunca revelar dados críticos.
 *
 * Decisão explícita do Ivo (ponto 43): a partilha fica limitada a (1)
 * padrões de linguagem ANÓNIMOS — vetores de características (trigramas
 * hash, ver `extrairFeatures` em src/farmaRede.js), nunca o texto literal
 * da pergunta — e (2) estatísticas AGREGADAS, nunca exemplos. Este ficheiro
 * é a fronteira que aplica essa decisão do lado do servidor, não só do
 * lado do cliente (um cliente alterado/malicioso não consegue contornar
 * isto): o `tenantId` da sessão NUNCA é guardado, cada padrão é validado
 * quanto à forma (um vetor numérico de tamanho fixo, nunca uma string
 * livre), e não há nenhum campo de texto livre aceite em lado nenhum deste
 * pedido.
 *
 * Isolamento estrutural: esta função usa uma store do Netlify Blobs
 * DIFERENTE ("central-saas-partilhado") da usada pelos dados por farmácia
 * ("central-saas", ver data.js/asset.js) — nunca há uma chave prefixada
 * por tenantId nesta store, por desenho, para ficar óbvio numa leitura
 * rápida do ficheiro que nada aqui identifica uma farmácia específica.
 *
 * Rota: /api/farma-aprendizagens (ver netlify.toml)
 *   GET  -> devolve o conhecimento partilhado atual (padrões + estatísticas)
 *   POST -> uma farmácia contribui com novos padrões/estatísticas (merge)
 */
import { getStore } from "@netlify/blobs";
import { createHmac } from "node:crypto";
import { autenticarPedido, getJwtSecret } from "./_lib/auth.js";

const STORE_NAME = "central-saas-partilhado";
const BLOB_KEY = "aprendizagens";

// Limites generosos mas finitos — protegem a store partilhada de crescer
// sem controlo (e de um único pedido abusivo inundar tudo de uma vez).
const LIMITE_PADROES = 4000;
const LIMITE_PADROES_POR_PEDIDO = 100;
const LIMITE_CONTRIBUINTES_REGISTADOS = 20000;
const N_DIMS_ESPERADO = 288; // tem de bater certo com src/farmaTreinoLocal.js
const INTENT_ID_REGEX = /^[a-z][a-z0-9_]{1,39}$/;

const ESTADO_VAZIO = {
  padroes: [],
  estatisticas: { contagensPorIntent: {}, totalContribuicoes: 0 },
  contribuintes: [],
  ultimaAtualizacao: null,
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Pseudónimo estável e não reversível do tenantId — nunca o tenantId em si.
 *  Serve só para contar quantas farmácias DIFERENTES já contribuíram, sem
 *  guardar a identidade de nenhuma. */
function pseudonimoTenant(tenantId) {
  return createHmac("sha256", getJwtSecret()).update(`aprendizagens:${tenantId}`).digest("hex");
}

function vetorValido(features) {
  return (
    Array.isArray(features) &&
    features.length === N_DIMS_ESPERADO &&
    features.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function padraoValido(p) {
  return (
    p && typeof p === "object" &&
    typeof p.intentId === "string" && INTENT_ID_REGEX.test(p.intentId) &&
    vetorValido(p.features)
  );
}

/** Só aceita contagens: { intentId: número inteiro não-negativo }. Qualquer
 *  outra forma (strings, objetos aninhados, texto livre) é ignorada. */
function contagensValidas(obj) {
  const limpo = {};
  if (!obj || typeof obj !== "object") return limpo;
  for (const [intentId, valor] of Object.entries(obj)) {
    if (INTENT_ID_REGEX.test(intentId) && Number.isInteger(valor) && valor >= 0 && valor <= 1_000_000) {
      limpo[intentId] = valor;
    }
  }
  return limpo;
}

export default async (request) => {
  return handleRequest(request, getStore);
};

export const config = { path: "/api/farma-aprendizagens" };

/** Lógica isolada da store real, para testes (ver tests/farmaAprendizagens.test.js). */
export async function handleRequest(request, getStoreImpl) {
  const sessao = autenticarPedido(request);
  if (!sessao) return jsonResponse({ error: "Sessão inválida ou expirada. Inicie sessão novamente." }, 401);

  let store;
  try {
    store = getStoreImpl(STORE_NAME);
  } catch (err) {
    return jsonResponse({ error: "Netlify Blobs não está disponível neste ambiente.", detail: String(err) }, 500);
  }

  if (request.method === "GET") {
    try {
      const estado = (await store.get(BLOB_KEY, { type: "json" })) || ESTADO_VAZIO;
      // nunca devolve `contribuintes` (pseudónimos) ao cliente — só a contagem interessa.
      const { contribuintes, ...publico } = estado;
      return jsonResponse({ ...publico, farmaciasContribuintes: (contribuintes || []).length });
    } catch (err) {
      return jsonResponse({ error: "Falha ao ler o conhecimento partilhado.", detail: String(err) }, 500);
    }
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Corpo inválido: JSON malformado." }, 400); }
    if (!body || typeof body !== "object") return jsonResponse({ error: "Corpo inválido." }, 400);

    const padroesRecebidos = Array.isArray(body.padroes) ? body.padroes.slice(0, LIMITE_PADROES_POR_PEDIDO) : [];
    const padroesValidos = padroesRecebidos.filter(padraoValido).map((p) => ({ intentId: p.intentId, features: p.features }));
    const contagensRecebidas = contagensValidas(body.estatisticas && body.estatisticas.contagensPorIntent);

    if (!padroesValidos.length && !Object.keys(contagensRecebidas).length) {
      return jsonResponse({ error: "Nada válido para contribuir: nenhum padrão nem estatística aceites." }, 400);
    }

    try {
      const atual = (await store.get(BLOB_KEY, { type: "json" })) || ESTADO_VAZIO;

      const padroesCombinados = [...(atual.padroes || []), ...padroesValidos].slice(-LIMITE_PADROES); // mais antigos saem primeiro

      const contagensPorIntent = { ...(atual.estatisticas && atual.estatisticas.contagensPorIntent) };
      for (const [intentId, valor] of Object.entries(contagensRecebidas)) {
        contagensPorIntent[intentId] = (contagensPorIntent[intentId] || 0) + valor;
      }

      const meuPseudonimo = pseudonimoTenant(sessao.tenantId);
      const contribuintes = Array.from(new Set([...(atual.contribuintes || []), meuPseudonimo])).slice(-LIMITE_CONTRIBUINTES_REGISTADOS);

      const novoEstado = {
        padroes: padroesCombinados,
        estatisticas: {
          contagensPorIntent,
          totalContribuicoes: ((atual.estatisticas && atual.estatisticas.totalContribuicoes) || 0) + 1,
        },
        contribuintes,
        ultimaAtualizacao: new Date().toISOString(),
      };

      await store.setJSON(BLOB_KEY, novoEstado);
      return jsonResponse({
        ok: true,
        padroesAceites: padroesValidos.length,
        padroesRecebidosMasInvalidos: padroesRecebidos.length - padroesValidos.length,
      });
    } catch (err) {
      return jsonResponse({ error: "Falha ao gravar a contribuição.", detail: String(err) }, 500);
    }
  }

  return jsonResponse({ error: "Método não suportado." }, 405);
}
