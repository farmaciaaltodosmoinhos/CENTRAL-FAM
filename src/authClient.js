/**
 * src/authClient.js — sessão da farmácia neste dispositivo/browser.
 *
 * O token (JWT emitido por /api/auth/login ou /api/auth/signup) fica em
 * localStorage: cada farmácia só tem os seus próprios dados porque o
 * `tenantId` está embutido e assinado dentro do token — o servidor nunca
 * confia em nada que venha do pedido além disso (ver netlify/functions/_lib/auth.js).
 */
const TOKEN_KEY = "central_saas_token";
const PERFIL_KEY = "central_saas_perfil"; // { tenantId, email, nomeFarmacia } — só para mostrar na UI sem esperar por /api/auth/me

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getPerfil() {
  try { return JSON.parse(localStorage.getItem(PERFIL_KEY) || "null"); } catch { return null; }
}

function guardarSessao({ token, tenantId, email, nomeFarmacia }) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(PERFIL_KEY, JSON.stringify({ tenantId, email, nomeFarmacia }));
  } catch { /* localStorage indisponível (modo privado, etc.) — a sessão só dura esta aba */ }
}

export function limparSessao() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(PERFIL_KEY); } catch {}
}

export function isAutenticado() {
  return !!getToken();
}

async function pedido(caminho, body) {
  const res = await fetch(`/api/auth/${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.error || `Falha no pedido (HTTP ${res.status}).`);
  return dados;
}

export async function signup({ nomeFarmacia, email, password }) {
  const dados = await pedido("signup", { nomeFarmacia, email, password });
  guardarSessao(dados);
  return dados;
}

export async function login({ email, password }) {
  const dados = await pedido("login", { email, password });
  guardarSessao(dados);
  return dados;
}

export function logout() {
  limparSessao();
}
