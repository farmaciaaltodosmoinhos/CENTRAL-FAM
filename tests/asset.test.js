process.env.AUTH_JWT_SECRET = "segredo-de-teste-bem-comprido-0123456789";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../netlify/functions/asset.js";
import { signToken } from "../netlify/functions/_lib/auth.js";
import { fakeStoreFactory } from "./_fakeStore.js";

const tokenA = signToken({ tenantId: "tenant-A", email: "a@x.pt", nomeFarmacia: "Farmácia A" });
const tokenB = signToken({ tenantId: "tenant-B", email: "b@x.pt", nomeFarmacia: "Farmácia B" });

function req(method, key, token, body) {
  return new Request(`https://site.netlify.app/api/asset/${key}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}
const ctx = (key) => ({ params: { key } });

describe("/api/asset/:key — autenticação e isolamento", () => {
  test("sem token devolve 401", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(req("GET", "doc1", null), ctx("doc1"), getStoreImpl);
    assert.equal(res.status, 401);
  });

  test("uma farmácia não consegue ler o conteúdo gravado por outra com a mesma chave lógica", async () => {
    const { getStoreImpl, blobs } = fakeStoreFactory();
    await handleRequest(req("PUT", "servico-html:srv1", tokenA, { content: "<p>Conteúdo da farmácia A</p>" }), ctx("servico-html:srv1"), getStoreImpl);

    const resB = await handleRequest(req("GET", "servico-html:srv1", tokenB), ctx("servico-html:srv1"), getStoreImpl);
    assert.equal(resB.status, 404); // tenant B nunca gravou nada com esta chave — nem vê o da A

    const resA = await handleRequest(req("GET", "servico-html:srv1", tokenA), ctx("servico-html:srv1"), getStoreImpl);
    assert.equal(resA.status, 200);
    assert.equal((await resA.json()).content, "<p>Conteúdo da farmácia A</p>");

    assert.ok(blobs.has("asset:tenant-A:servico-html:srv1"));
    assert.ok(!blobs.has("asset:tenant-B:servico-html:srv1"));
  });

  test("DELETE remove só o conteúdo do próprio tenant", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(req("PUT", "x", tokenA, { content: "conteudo" }), ctx("x"), getStoreImpl);
    await handleRequest(req("DELETE", "x", tokenA), ctx("x"), getStoreImpl);
    const res = await handleRequest(req("GET", "x", tokenA), ctx("x"), getStoreImpl);
    assert.equal(res.status, 404);
  });

  test("sem token, o DELETE também é recusado (401)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(req("DELETE", "x", null), ctx("x"), getStoreImpl);
    assert.equal(res.status, 401);
  });
});

describe("/api/asset/:key — validação e limites", () => {
  test("rejeita corpo sem 'content' string (400)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(req("PUT", "x", tokenA, { conteudo: "campo errado" }), ctx("x"), getStoreImpl);
    assert.equal(res.status, 400);
  });

  test("rejeita conteúdo maior que o limite prático (413)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const enorme = "a".repeat(6 * 1024 * 1024); // acima do limite (90% de 6MB)
    const res = await handleRequest(req("PUT", "grande", tokenA, { content: enorme }), ctx("grande"), getStoreImpl);
    assert.equal(res.status, 413);
  });

  test("GET de uma chave nunca gravada devolve 404", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(req("GET", "nunca-existiu", tokenA), ctx("nunca-existiu"), getStoreImpl);
    assert.equal(res.status, 404);
  });

  test("chave em falta na rota devolve 400 (nunca tenta ler/gravar sem chave)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(req("GET", "", tokenA), ctx(undefined), getStoreImpl);
    assert.equal(res.status, 400);
  });

  test("método não suportado (ex.: PATCH) devolve 405", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(req("PATCH", "x", tokenA), ctx("x"), getStoreImpl);
    assert.equal(res.status, 405);
  });

  test("quando getStoreImpl falha (Blobs indisponível), devolve 500 em vez de rebentar", async () => {
    const getStoreImplQuebrado = () => { throw new Error("Blobs indisponível"); };
    const res = await handleRequest(req("GET", "x", tokenA), ctx("x"), getStoreImplQuebrado);
    assert.equal(res.status, 500);
  });
});
