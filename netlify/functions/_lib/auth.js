/**
 * netlify/functions/_lib/auth.js — autenticação partilhada entre farmácias
 * (multi-tenant), usada por auth.js, data.js e asset.js.
 *
 * Sem dependências externas: hashing de password com scrypt (nativo do
 * Node) e tokens de sessão no formato JWT (header.payload.assinatura,
 * HMAC-SHA256), assinados e verificados só por nós — não precisam de
 * interoperar com mais ninguém.
 *
 * Variável de ambiente obrigatória no Netlify: AUTH_JWT_SECRET
 * (uma string aleatória longa, definida uma única vez no painel do site —
 * Site settings → Environment variables). Sem ela, a autenticação recusa-se
 * a arrancar, para nunca cair silenciosamente num segredo previsível.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac, randomUUID } from "node:crypto";

const TOKEN_TTL_SEGUNDOS = 30 * 24 * 60 * 60; // 30 dias

export function getJwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_JWT_SECRET não está configurado (ou é demasiado curto). Defina uma variável de ambiente " +
      "AUTH_JWT_SECRET com uma string aleatória longa em Site settings → Environment variables no Netlify."
    );
  }
  return secret;
}

/* ---------- passwords ---------- */

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const hashTentativa = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashTentativa, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ---------- tokens de sessão (JWT-like, HMAC-SHA256) ---------- */

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function signToken(payload) {
  const secret = getJwtSecret();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + TOKEN_TTL_SEGUNDOS };
  const encHeader = base64url(JSON.stringify(header));
  const encBody = base64url(JSON.stringify(body));
  const assinatura = createHmac("sha256", secret).update(`${encHeader}.${encBody}`).digest("base64url");
  return `${encHeader}.${encBody}.${assinatura}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [encHeader, encBody, assinatura] = partes;
  const secret = getJwtSecret();
  const esperada = createHmac("sha256", secret).update(`${encHeader}.${encBody}`).digest("base64url");
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(Buffer.from(encBody, "base64url").toString("utf8")); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof body.exp === "number" && now > body.exp) return null;
  return body;
}

/** Extrai e valida o token Bearer de um pedido; devolve o payload (com tenantId) ou null. */
export function autenticarPedido(request) {
  const cabecalho = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!cabecalho || !cabecalho.startsWith("Bearer ")) return null;
  const token = cabecalho.slice("Bearer ".length).trim();
  return verifyToken(token);
}

export function novoTenantId() {
  return randomUUID();
}

/** Normaliza um email para usar como chave (minúsculas, sem espaços à volta). */
export function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}
