/**
 * src/ui/farmaAprendizagemRede.js — ponto 43, Função 4 ("aprendizagem
 * multifarma"). Só corre no browser (usa `fetch`/`getToken`) — a ponte
 * entre a lógica pura de `src/farmaAprendizagemMultifarma.js` e o endpoint
 * `/api/farma-aprendizagens` (ver `netlify/functions/farma-aprendizagens.js`).
 * Mesma separação pura/browser já usada por `farmaLeitura.js`/
 * `farmaLeituraFicheiros.js` e o mesmo padrão de autenticação de `db.js`
 * (Authorization: Bearer <token>, token de `authClient.js`).
 */
import { getToken } from "../authClient.js";

const API_URL = "/api/farma-aprendizagens";

function comAuth(headers = {}) {
  const token = getToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

/** Vai buscar o conhecimento partilhado atual — padrões + estatísticas
 *  agregadas, nunca dados por farmácia (ver a função do servidor). */
export async function obterConhecimentoPartilhado() {
  const res = await fetch(API_URL, { headers: comAuth({ Accept: "application/json" }) });
  if (!res.ok) throw new Error(`Não foi possível obter o conhecimento partilhado (HTTP ${res.status}).`);
  return res.json();
}

/** Envia a contribuição desta farmácia (padrões anónimos + estatísticas
 *  agregadas — ver `prepararContribuicao` em farmaAprendizagemMultifarma.js). */
export async function contribuirConhecimento(contribuicao) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: comAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(contribuicao),
  });
  if (!res.ok) {
    let detalhe = "";
    try { detalhe = (await res.json()).error || ""; } catch { /* ignora corpo não-JSON */ }
    throw new Error(`Não foi possível contribuir o conhecimento (HTTP ${res.status}).${detalhe ? " " + detalhe : ""}`);
  }
  return res.json();
}
