/**
 * netlify/functions/data.js — API do estado partilhado de CADA farmácia
 * (serviços, categorias, configurações), guardado no Netlify Blobs.
 *
 * Multi-farmácia: todos os pedidos têm de trazer um token de sessão válido
 * (Authorization: Bearer <token>, emitido por /api/auth/login ou
 * /api/auth/signup). O `tenantId` vem do token — nunca do pedido — por
 * isso uma farmácia nunca consegue ler ou escrever os dados de outra, seja
 * qual for o valor que envie. Uma só store ("central-saas") é partilhada
 * por todas as farmácias, com as chaves prefixadas por tenantId.
 *
 * Rota exposta: /api/data (ver `config.path` abaixo e o `netlify.toml`).
 *   GET  /api/data  -> devolve o estado atual desta farmácia em JSON
 *   PUT  /api/data  -> substitui o estado atual desta farmácia pelo corpo JSON enviado
 */
import { getStore } from "@netlify/blobs";
import { autenticarPedido } from "./_lib/auth.js";

const STORE_NAME = "central-saas";

const ESTADO_VAZIO = {
  servicos: [],
  categorias: [],
  config: {}
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (request) => {
  return handleRequest(request, getStore);
};

export const config = { path: "/api/data" };

/**
 * Lógica do pedido isolada da obtenção da store, para ser testável sem
 * depender do runtime real do Netlify (ver tests/function.test.js).
 */
export async function handleRequest(request, getStoreImpl) {
  const sessao = autenticarPedido(request);
  if (!sessao) return jsonResponse({ error: "Sessão inválida ou expirada. Inicie sessão novamente." }, 401);
  const blobKey = `estado:${sessao.tenantId}`;

  let store;
  try {
    store = getStoreImpl(STORE_NAME);
  } catch (err) {
    return jsonResponse({ error: "Netlify Blobs não está disponível neste ambiente.", detail: String(err) }, 500);
  }

  if (request.method === "GET") {
    try {
      const estado = await store.get(blobKey, { type: "json" });
      return jsonResponse(estado || ESTADO_VAZIO);
    } catch (err) {
      return jsonResponse({ error: "Falha ao ler o estado.", detail: String(err) }, 500);
    }
  }

  if (request.method === "PUT") {
    // O parsing do corpo tem o seu próprio try/catch, separado da gravação:
    // um JSON malformado é um erro do CLIENTE (400), nunca um erro do
    // servidor (500) — mesmo padrão já usado em auth.js. Antes desta
    // correção, os dois erros ficavam no mesmo catch e um corpo inválido
    // era devolvido como 500, escondendo do cliente que o problema era seu.
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Corpo inválido: JSON malformado." }, 400); }

    if (!body || typeof body !== "object" || !Array.isArray(body.servicos) || !Array.isArray(body.categorias)) {
      return jsonResponse({ error: "Corpo inválido: esperado { servicos: [], categorias: [], config: {} }." }, 400);
    }
    try {
      // Faz merge com o estado atual em vez de o substituir por inteiro: cada
      // módulo (ex. Manipulados) grava só a fatia que conhece — sem isto, um
      // módulo que desconheça o campo de outro (ex. o painel principal a
      // gravar servicos/categorias/config sem saber de "manipulados") apagava
      // sempre esse campo a cada gravação sua.
      const atual = (await store.get(blobKey, { type: "json" })) || ESTADO_VAZIO;
      const payload = { ...atual, ...body, servicos: body.servicos, categorias: body.categorias, config: body.config || {} };
      await store.setJSON(blobKey, payload);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: "Falha ao gravar o estado.", detail: String(err) }, 500);
    }
  }

  return jsonResponse({ error: "Método não suportado." }, 405);
}
