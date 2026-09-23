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
 *
 * Ponto 50 (bloqueio otimista): cada gravação faz sempre um GET-modifica-PUT
 * no cliente (ver `fetchEstado`/`gravarXxx` em cada módulo). Sem nenhum
 * controlo de concorrência, dois separadores/dispositivos a gravar quase ao
 * mesmo tempo podiam perder-se um ao outro: o 2º a gravar lê o estado ANTES
 * da gravação do 1º, e ao gravar repõe esse instantâneo antigo por cima do
 * que o 1º acabou de gravar — incluindo campos de módulos que nem sequer
 * mexeu (o merge do PUT espalha sempre TODO o `estadoAtual` que o cliente
 * leu, não só a fatia que alterou). Cada farmácia tem agora um número de
 * revisão (`estado:<tenantId>:rev`, um inteiro simples, numa chave à parte
 * do estado em si — nunca faz parte do JSON devolvido por GET, para não
 * alterar a forma do estado que os módulos já conhecem). O GET devolve-o no
 * cabeçalho `X-Estado-Rev`; um PUT pode (deve) devolver esse mesmo valor no
 * cabeçalho `X-Estado-Rev` do pedido — só grava e avança a revisão se ainda
 * coincidir com a revisão atual no servidor; caso contrário devolve 409 sem
 * escrever nada, para o cliente voltar a ler o estado fresco e tentar de
 * novo. Um PUT sem esse cabeçalho (compatibilidade com um cliente antigo,
 * ainda não atualizado) continua a funcionar exatamente como antes — sem
 * bloqueio nenhum — para nunca partir um módulo esquecido nesta ronda.
 */
import { getStore } from "@netlify/blobs";
import { autenticarPedido } from "./_lib/auth.js";

const STORE_NAME = "central-saas";

const ESTADO_VAZIO = {
  servicos: [],
  categorias: [],
  config: {}
};

function revKey(tenantId) { return `estado:${tenantId}:rev`; }

async function lerRev(store, tenantId) {
  try {
    const v = await store.get(revKey(tenantId), { type: "text" });
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) { return 0; }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
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
      const rev = await lerRev(store, sessao.tenantId);
      return jsonResponse(estado || ESTADO_VAZIO, 200, { "x-estado-rev": String(rev) });
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
      const revEsperada = request.headers.get("x-estado-rev");
      const revAtual = await lerRev(store, sessao.tenantId);
      // Ponto 50: só quando o cliente MANDA o cabeçalho é que há bloqueio —
      // ver o comentário grande no topo do ficheiro sobre compatibilidade
      // com um cliente ainda não atualizado.
      if (revEsperada !== null && revEsperada !== "") {
        const revEsperadaNum = parseInt(revEsperada, 10);
        if (!Number.isFinite(revEsperadaNum) || revEsperadaNum !== revAtual) {
          return jsonResponse(
            { error: "Conflito de concorrência: outro dispositivo/separador gravou entretanto. Leia o estado mais recente e tente novamente.", rev: revAtual },
            409,
            { "x-estado-rev": String(revAtual) }
          );
        }
      }
      // Faz merge com o estado atual em vez de o substituir por inteiro: cada
      // módulo (ex. Manipulados) grava só a fatia que conhece — sem isto, um
      // módulo que desconheça o campo de outro (ex. o painel principal a
      // gravar servicos/categorias/config sem saber de "manipulados") apagava
      // sempre esse campo a cada gravação sua.
      const atual = (await store.get(blobKey, { type: "json" })) || ESTADO_VAZIO;
      const payload = { ...atual, ...body, servicos: body.servicos, categorias: body.categorias, config: body.config || {} };
      const revNova = revAtual + 1;
      await store.setJSON(blobKey, payload);
      await store.set(revKey(sessao.tenantId), String(revNova));
      return jsonResponse({ ok: true, rev: revNova }, 200, { "x-estado-rev": String(revNova) });
    } catch (err) {
      return jsonResponse({ error: "Falha ao gravar o estado.", detail: String(err) }, 500);
    }
  }

  return jsonResponse({ error: "Método não suportado." }, 405);
}
