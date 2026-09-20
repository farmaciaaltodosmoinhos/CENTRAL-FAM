/**
 * netlify/functions/auth.js — conta e sessão de cada farmácia (multi-tenant).
 *
 * Rotas (ver netlify.toml):
 *   POST /api/auth/signup  { nomeFarmacia, email, password } -> cria a conta, devolve { token, tenantId, nomeFarmacia, email }
 *   POST /api/auth/login   { email, password }                -> valida, devolve { token, tenantId, nomeFarmacia, email }
 *   GET  /api/auth/me      (Authorization: Bearer <token>)     -> devolve { tenantId, nomeFarmacia, email } ou 401
 *
 * As contas ficam num blob à parte (store "central-saas-contas"), uma por
 * email normalizado — nunca no mesmo blob dos dados de cada farmácia
 * ("central-saas", ver data.js/asset.js), para que a lista de contas nunca
 * seja exposta por engano pelas rotas de dados.
 */
import { getStore } from "@netlify/blobs";
import { hashPassword, verifyPassword, signToken, autenticarPedido, novoTenantId, normalizarEmail } from "./_lib/auth.js";

const STORE_NAME = "central-saas-contas";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (request, context) => {
  return handleRequest(request, context, getStore);
};

export const config = { path: "/api/auth/:acao" };

export async function handleRequest(request, context, getStoreImpl) {
  const acao = context?.params?.acao;
  let store;
  try {
    store = getStoreImpl(STORE_NAME);
  } catch (err) {
    return jsonResponse({ error: "Netlify Blobs não está disponível neste ambiente.", detail: String(err) }, 500);
  }

  if (acao === "signup" && request.method === "POST") return signup(request, store);
  if (acao === "login" && request.method === "POST") return login(request, store);
  if (acao === "me" && request.method === "GET") return me(request, store);

  return jsonResponse({ error: "Rota ou método não suportado." }, 404);
}

async function signup(request, store) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Corpo inválido." }, 400); }

  const email = normalizarEmail(body?.email);
  const password = String(body?.password || "");
  const nomeFarmacia = String(body?.nomeFarmacia || "").trim();

  if (!email || !email.includes("@")) return jsonResponse({ error: "Email inválido." }, 400);
  if (password.length < 8) return jsonResponse({ error: "A palavra-passe tem de ter pelo menos 8 caracteres." }, 400);
  if (!nomeFarmacia) return jsonResponse({ error: "Indique o nome da farmácia." }, 400);

  let jwtSecretOk = true;
  try {
    const existente = await store.get(`conta:${email}`, { type: "json" });
    if (existente) return jsonResponse({ error: "Já existe uma conta com este email." }, 409);

    const tenantId = novoTenantId();
    const conta = {
      tenantId, email, nomeFarmacia,
      passwordHash: hashPassword(password),
      criadoEm: new Date().toISOString()
    };
    await store.setJSON(`conta:${email}`, conta);

    const token = signToken({ tenantId, email, nomeFarmacia });
    return jsonResponse({ token, tenantId, email, nomeFarmacia });
  } catch (err) {
    if (String(err.message || "").includes("AUTH_JWT_SECRET")) jwtSecretOk = false;
    return jsonResponse({ error: jwtSecretOk ? "Falha ao criar a conta." : String(err.message), detail: String(err) }, 500);
  }
}

async function login(request, store) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Corpo inválido." }, 400); }

  const email = normalizarEmail(body?.email);
  const password = String(body?.password || "");
  if (!email || !password) return jsonResponse({ error: "Indique email e palavra-passe." }, 400);

  try {
    const conta = await store.get(`conta:${email}`, { type: "json" });
    if (!conta || !verifyPassword(password, conta.passwordHash)) {
      return jsonResponse({ error: "Email ou palavra-passe incorretos." }, 401);
    }
    const token = signToken({ tenantId: conta.tenantId, email: conta.email, nomeFarmacia: conta.nomeFarmacia });
    return jsonResponse({ token, tenantId: conta.tenantId, email: conta.email, nomeFarmacia: conta.nomeFarmacia });
  } catch (err) {
    return jsonResponse({ error: "Falha ao autenticar.", detail: String(err) }, 500);
  }
}

async function me(request) {
  const payload = autenticarPedido(request);
  if (!payload) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
  return jsonResponse({ tenantId: payload.tenantId, email: payload.email, nomeFarmacia: payload.nomeFarmacia });
}
