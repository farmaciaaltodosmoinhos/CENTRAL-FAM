process.env.AUTH_JWT_SECRET = "segredo-de-teste-bem-comprido-0123456789";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  hashPassword, verifyPassword, signToken, verifyToken, autenticarPedido,
  novoTenantId, normalizarEmail, getJwtSecret
} from "../netlify/functions/_lib/auth.js";

describe("_lib/auth.js — hashPassword / verifyPassword", () => {
  test("uma palavra-passe correta verifica com sucesso contra o seu próprio hash", () => {
    const hash = hashPassword("palavrapasse123");
    assert.equal(verifyPassword("palavrapasse123", hash), true);
  });

  test("uma palavra-passe errada nunca verifica", () => {
    const hash = hashPassword("palavrapasse123");
    assert.equal(verifyPassword("outra-coisa-qualquer", hash), false);
  });

  test("dois hashes da MESMA palavra-passe são diferentes (salt aleatório por chamada)", () => {
    assert.notEqual(hashPassword("igual123"), hashPassword("igual123"));
  });

  test("um valor armazenado corrompido/vazio nunca rebenta, só devolve false", () => {
    assert.equal(verifyPassword("qualquer", ""), false);
    assert.equal(verifyPassword("qualquer", null), false);
    assert.equal(verifyPassword("qualquer", "sem-dois-pontos"), false);
  });
});

describe("_lib/auth.js — signToken / verifyToken", () => {
  test("um token recém-assinado verifica com sucesso e devolve o payload original", () => {
    const token = signToken({ tenantId: "t1", email: "a@x.pt", nomeFarmacia: "F" });
    const payload = verifyToken(token);
    assert.equal(payload.tenantId, "t1");
    assert.equal(payload.email, "a@x.pt");
  });

  test("o token inclui 'iat' e 'exp' automaticamente", () => {
    const token = signToken({ tenantId: "t1" });
    const payload = verifyToken(token);
    assert.ok(typeof payload.iat === "number");
    assert.ok(typeof payload.exp === "number");
    assert.ok(payload.exp > payload.iat);
  });

  test("um token com a assinatura adulterada é rejeitado", () => {
    const token = signToken({ tenantId: "t1" });
    const partes = token.split(".");
    const adulterado = `${partes[0]}.${partes[1]}.assinaturaFalsa`;
    assert.equal(verifyToken(adulterado), null);
  });

  test("um token com o corpo (payload) adulterado é rejeitado (a assinatura deixa de bater certo)", () => {
    const token = signToken({ tenantId: "t1" });
    const partes = token.split(".");
    const corpoFalso = Buffer.from(JSON.stringify({ tenantId: "t2-hackeado" })).toString("base64url");
    assert.equal(verifyToken(`${partes[0]}.${corpoFalso}.${partes[2]}`), null);
  });

  test("um token expirado é rejeitado", () => {
    // Assina manualmente um token já expirado (exp no passado), sem esperar 30 dias de verdade.
    const secret = "segredo-de-teste-bem-comprido-0123456789";
    const header = { alg: "HS256", typ: "JWT" };
    const body = { tenantId: "t1", iat: 1000, exp: 1000 }; // expirou no passado distante
    const encHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encBody = Buffer.from(JSON.stringify(body)).toString("base64url");
    const assinatura = createHmac("sha256", secret).update(`${encHeader}.${encBody}`).digest("base64url");
    assert.equal(verifyToken(`${encHeader}.${encBody}.${assinatura}`), null);
  });

  test("valores claramente inválidos (vazio, sem pontos, null) nunca rebentam, só devolvem null", () => {
    assert.equal(verifyToken(""), null);
    assert.equal(verifyToken(null), null);
    assert.equal(verifyToken("sem-pontos-aqui"), null);
    assert.equal(verifyToken("so.duas.partes.demais"), null);
  });
});

describe("_lib/auth.js — autenticarPedido", () => {
  function reqComAuth(valor) {
    return new Request("https://site.netlify.app/api/data", { headers: valor ? { authorization: valor } : {} });
  }

  test("extrai e valida corretamente um cabeçalho 'Bearer <token>' válido", () => {
    const token = signToken({ tenantId: "t1" });
    const payload = autenticarPedido(reqComAuth(`Bearer ${token}`));
    assert.equal(payload.tenantId, "t1");
  });

  test("sem cabeçalho Authorization, devolve null", () => {
    assert.equal(autenticarPedido(reqComAuth(null)), null);
  });

  test("um cabeçalho sem o prefixo 'Bearer ' é rejeitado", () => {
    const token = signToken({ tenantId: "t1" });
    assert.equal(autenticarPedido(reqComAuth(token)), null);
  });
});

describe("_lib/auth.js — novoTenantId / normalizarEmail / getJwtSecret", () => {
  test("novoTenantId() gera um UUID v4 válido", () => {
    const id = novoTenantId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("novoTenantId() nunca repete entre chamadas", () => {
    const ids = new Set(Array.from({ length: 20 }, () => novoTenantId()));
    assert.equal(ids.size, 20);
  });

  test("normalizarEmail remove espaços e converte para minúsculas", () => {
    assert.equal(normalizarEmail("  Ana@Exemplo.PT  "), "ana@exemplo.pt");
  });

  test("normalizarEmail de um valor vazio/undefined devolve string vazia, nunca rebenta", () => {
    assert.equal(normalizarEmail(undefined), "");
    assert.equal(normalizarEmail(null), "");
  });

  test("getJwtSecret() devolve o segredo configurado no ambiente", () => {
    assert.equal(getJwtSecret(), "segredo-de-teste-bem-comprido-0123456789");
  });

  test("getJwtSecret() rejeita um segredo demasiado curto ou em falta", () => {
    const original = process.env.AUTH_JWT_SECRET;
    try {
      process.env.AUTH_JWT_SECRET = "curto";
      assert.throws(() => getJwtSecret());
      delete process.env.AUTH_JWT_SECRET;
      assert.throws(() => getJwtSecret());
    } finally {
      process.env.AUTH_JWT_SECRET = original;
    }
  });
});
