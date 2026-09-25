/**
 * netlify/functions/asset.js — API para "conteúdos pesados" individuais
 * (o HTML completo de um serviço do tipo "html", por exemplo), por farmácia.
 *
 * Mesmo princípio de isolamento do data.js: o `tenantId` vem sempre do
 * token de sessão validado (Authorization: Bearer <token>), nunca do
 * pedido, e é usado para prefixar a chave do blob — uma farmácia nunca
 * consegue ler, escrever ou apagar o conteúdo de outra.
 *
 * Rota: /api/asset/:key
 *   GET    -> devolve { content: "..." } ou 404 se não existir
 *   PUT    -> grava o corpo { content: "..." }
 *   DELETE -> remove (usado quando um serviço/categoria é eliminado)
 */
import { getStore } from "@netlify/blobs";
import { autenticarPedido } from "./_lib/auth.js";

const STORE_NAME = "central-saas";
const LIMITE_BYTES = 6 * 1024 * 1024 * 0.9; // margem de segurança abaixo do limite de 6MB do Netlify

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (request, context) => {
  return handleRequest(request, context, getStore);
};

export const config = { path: "/api/asset/:key" };

export async function handleRequest(request, context, getStoreImpl) {
  const sessao = autenticarPedido(request);
  if (!sessao) return jsonResponse({ error: "Sessão inválida ou expirada. Inicie sessão novamente." }, 401);

  const key = context?.params?.key;
  if (!key) return jsonResponse({ error: "Chave do conteúdo em falta na rota." }, 400);

  let store;
  try {
    store = getStoreImpl(STORE_NAME);
  } catch (err) {
    return jsonResponse({ error: "Netlify Blobs não está disponível neste ambiente.", detail: String(err) }, 500);
  }

  const blobKey = `asset:${sessao.tenantId}:${key}`;

  if (request.method === "GET") {
    try {
      const content = await store.get(blobKey, { type: "text" });
      if (content == null) return jsonResponse({ error: "Não encontrado." }, 404);
      return jsonResponse({ content });
    } catch (err) {
      return jsonResponse({ error: "Falha ao ler o conteúdo.", detail: String(err) }, 500);
    }
  }

  if (request.method === "PUT") {
    try {
      const body = await request.json();
      if (typeof body?.content !== "string") {
        return jsonResponse({ error: "Corpo inválido: esperado { content: '...' }." }, 400);
      }
      if (body.content.length > LIMITE_BYTES) {
        return jsonResponse({ error: `Ficheiro demasiado grande (${(body.content.length / 1024 / 1024).toFixed(1)}MB). O limite prático é de cerca de ${(LIMITE_BYTES / 1024 / 1024).toFixed(1)}MB.` }, 413);
      }
      await store.set(blobKey, body.content);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: "Falha ao gravar o conteúdo.", detail: String(err) }, 500);
    }
  }

  if (request.method === "DELETE") {
    try {
      await store.delete(blobKey);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: "Falha ao apagar o conteúdo.", detail: String(err) }, 500);
    }
  }

  return jsonResponse({ error: "Método não suportado." }, 405);
}
