process.env.AUTH_JWT_SECRET = "segredo-de-teste-bem-comprido-0123456789";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../netlify/functions/auth.js";
import { fakeStoreFactory } from "./_fakeStore.js";

function reqSignup(body) {
  return new Request("https://site.netlify.app/api/auth/signup", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
}
function reqLogin(body) {
  return new Request("https://site.netlify.app/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
}
function reqMe(token) {
  return new Request("https://site.netlify.app/api/auth/me", {
    method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}
const ctx = (acao) => ({ params: { acao } });

describe("signup", () => {
  test("cria conta nova e devolve token", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqSignup({ nomeFarmacia: "Farmácia Teste", email: "A@Teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.token);
    assert.ok(json.tenantId);
    assert.equal(json.email, "a@teste.pt"); // normalizado em minúsculas
  });

  test("rejeita email duplicado (409)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(reqSignup({ nomeFarmacia: "F1", email: "dup@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    const res2 = await handleRequest(reqSignup({ nomeFarmacia: "F2", email: "dup@teste.pt", password: "outrapass123" }), ctx("signup"), getStoreImpl);
    assert.equal(res2.status, 409);
  });

  test("rejeita palavra-passe curta (400)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqSignup({ nomeFarmacia: "F", email: "x@teste.pt", password: "curta" }), ctx("signup"), getStoreImpl);
    assert.equal(res.status, 400);
  });
});

describe("login", () => {
  test("autentica com password correta e devolve o mesmo tenantId do signup", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const s = await handleRequest(reqSignup({ nomeFarmacia: "F", email: "login@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    const { tenantId } = await s.json();
    const res = await handleRequest(reqLogin({ email: "login@teste.pt", password: "palavrapasse123" }), ctx("login"), getStoreImpl);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.tenantId, tenantId);
  });

  test("rejeita password errada (401)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(reqSignup({ nomeFarmacia: "F", email: "b@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    const res = await handleRequest(reqLogin({ email: "b@teste.pt", password: "errada1234" }), ctx("login"), getStoreImpl);
    assert.equal(res.status, 401);
  });

  test("rejeita email inexistente (401, sem revelar que a conta não existe)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqLogin({ email: "naoexiste@teste.pt", password: "qualquercoisa123" }), ctx("login"), getStoreImpl);
    assert.equal(res.status, 401);
  });
});

describe("signup — validação de campos", () => {
  test("rejeita nome de farmácia vazio (400)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqSignup({ nomeFarmacia: "   ", email: "semnome@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    assert.equal(res.status, 400);
  });

  test("rejeita email sem '@' (400)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqSignup({ nomeFarmacia: "F", email: "naoeemail", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    assert.equal(res.status, 400);
  });

  test("normaliza o email em minúsculas ao gravar (login com o mesmo email em maiúsculas funciona)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    await handleRequest(reqSignup({ nomeFarmacia: "F", email: "Maiusculo@Teste.PT", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    const res = await handleRequest(reqLogin({ email: "MAIUSCULO@TESTE.PT", password: "palavrapasse123" }), ctx("login"), getStoreImpl);
    assert.equal(res.status, 200);
  });

  test("corpo não-JSON devolve 400 em vez de rebentar", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const req = new Request("https://site.netlify.app/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: "isto não é json" });
    const res = await handleRequest(req, ctx("signup"), getStoreImpl);
    assert.equal(res.status, 400);
  });

  test("quando getStoreImpl falha (Blobs indisponível), devolve 500 em vez de rebentar", async () => {
    const getStoreImplQuebrado = () => { throw new Error("Blobs indisponível neste ambiente"); };
    const res = await handleRequest(reqSignup({ nomeFarmacia: "F", email: "x@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImplQuebrado);
    assert.equal(res.status, 500);
  });
});

describe("login — validação de campos", () => {
  test("rejeita pedido sem palavra-passe (400)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqLogin({ email: "x@teste.pt" }), ctx("login"), getStoreImpl);
    assert.equal(res.status, 400);
  });

  test("rejeita pedido sem email (400)", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqLogin({ password: "algumapass123" }), ctx("login"), getStoreImpl);
    assert.equal(res.status, 400);
  });
});

describe("rotas/métodos não suportados", () => {
  test("uma ação desconhecida devolve 404", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqSignup({}), ctx("acao-inexistente"), getStoreImpl);
    assert.equal(res.status, 404);
  });

  test("GET em /signup (método errado para esta ação) devolve 404", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const req = new Request("https://site.netlify.app/api/auth/signup", { method: "GET" });
    const res = await handleRequest(req, ctx("signup"), getStoreImpl);
    assert.equal(res.status, 404);
  });
});

describe("me", () => {
  test("token válido devolve os dados da sessão", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const s = await handleRequest(reqSignup({ nomeFarmacia: "F", email: "me@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    const { token, tenantId } = await s.json();
    const res = await handleRequest(reqMe(token), ctx("me"), getStoreImpl);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.tenantId, tenantId);
  });

  test("sem token devolve 401", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const res = await handleRequest(reqMe(null), ctx("me"), getStoreImpl);
    assert.equal(res.status, 401);
  });

  test("token adulterado devolve 401", async () => {
    const { getStoreImpl } = fakeStoreFactory();
    const s = await handleRequest(reqSignup({ nomeFarmacia: "F", email: "adult@teste.pt", password: "palavrapasse123" }), ctx("signup"), getStoreImpl);
    const { token } = await s.json();
    const adulterado = token.slice(0, -2) + "xx";
    const res = await handleRequest(reqMe(adulterado), ctx("me"), getStoreImpl);
    assert.equal(res.status, 401);
  });
});
