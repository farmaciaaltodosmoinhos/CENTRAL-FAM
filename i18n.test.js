import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  IDIOMAS, DEFAULT_IDIOMA, idiomaValido, normalizarIdioma,
  t, ehRtl, chavesEmFalta, todasAsChaves
} from "../src/i18n.js";

describe("i18n.js — IDIOMAS / DEFAULT_IDIOMA", () => {
  test("tem exatamente 15 idiomas", () => {
    assert.equal(IDIOMAS.length, 15);
  });

  test("todos os códigos são únicos", () => {
    const codigos = IDIOMAS.map(i => i.codigo);
    assert.equal(new Set(codigos).size, codigos.length);
  });

  test("pt é o idioma por omissão e está na lista", () => {
    assert.equal(DEFAULT_IDIOMA, "pt");
    assert.ok(IDIOMAS.some(i => i.codigo === "pt"));
  });

  test("árabe (ar) está marcado como rtl; português não está", () => {
    assert.equal(IDIOMAS.find(i => i.codigo === "ar").rtl, true);
    assert.ok(!IDIOMAS.find(i => i.codigo === "pt").rtl);
  });
});

describe("i18n.js — idiomaValido / normalizarIdioma", () => {
  test("aceita todos os 15 códigos da lista IDIOMAS", () => {
    IDIOMAS.forEach(i => assert.ok(idiomaValido(i.codigo), `${i.codigo} devia ser válido`));
  });

  test("rejeita código desconhecido, vazio ou undefined", () => {
    assert.equal(idiomaValido("xx"), false);
    assert.equal(idiomaValido(""), false);
    assert.equal(idiomaValido(undefined), false);
  });

  test("normalizarIdioma devolve o próprio código quando válido", () => {
    assert.equal(normalizarIdioma("en"), "en");
    assert.equal(normalizarIdioma("ar"), "ar");
  });

  test("normalizarIdioma cai para pt em código inválido/em falta", () => {
    assert.equal(normalizarIdioma("xx"), "pt");
    assert.equal(normalizarIdioma(""), "pt");
    assert.equal(normalizarIdioma(undefined), "pt");
    assert.equal(normalizarIdioma(null), "pt");
  });
});

describe("i18n.js — t() — tradução, fallback e interpolação", () => {
  test("traduz uma chave conhecida para um idioma não-pt", () => {
    assert.equal(t("nav.inicio", "en"), "Home");
    assert.equal(t("nav.inicio", "es"), "Inicio");
  });

  test("usa pt por omissão quando nenhum idioma é passado", () => {
    assert.equal(t("nav.inicio"), t("nav.inicio", "pt"));
  });

  test("cai para pt quando a chave existe mas falta a tradução para o idioma pedido", () => {
    // Chave real com todas as traduções: simula uma "falta" com um idioma inválido
    // que t() trata como ausência de entrada[idioma] (não passa por normalizarIdioma).
    const chave = "nav.inicio";
    const pt = t(chave, "pt");
    assert.equal(t(chave, "codigo-que-nao-existe"), pt);
  });

  test("cai para a própria chave quando a chave não existe no dicionário", () => {
    assert.equal(t("chave.que.nao.existe.de.todo"), "chave.que.nao.existe.de.todo");
  });

  test("interpola variáveis {{var}} no texto traduzido", () => {
    const resultado = t("nav.resultados_para", "pt", { query: "paracetamol" });
    assert.match(resultado, /paracetamol/);
    assert.ok(!resultado.includes("{{query}}"));
  });

  test("interpola em todos os idiomas sem deixar placeholders por substituir", () => {
    IDIOMAS.forEach(i => {
      const resultado = t("nav.resultados_para", i.codigo, { query: "teste" });
      assert.ok(!resultado.includes("{{query}}"), `idioma ${i.codigo} deixou {{query}} por substituir`);
    });
  });

  test("suporta múltiplas variáveis na mesma chave", () => {
    const resultado = t("nav.servicos_em", "pt", { categoria: "Higiene Oral" });
    assert.match(resultado, /Higiene Oral/);
  });
});

describe("i18n.js — ehRtl", () => {
  test("árabe é rtl", () => {
    assert.equal(ehRtl("ar"), true);
  });

  test("português e inglês não são rtl", () => {
    assert.equal(ehRtl("pt"), false);
    assert.equal(ehRtl("en"), false);
  });

  test("código desconhecido não é rtl", () => {
    assert.equal(ehRtl("xx"), false);
  });
});

describe("i18n.js — completude do dicionário (todasAsChaves / chavesEmFalta)", () => {
  test("todasAsChaves() devolve uma lista não vazia", () => {
    const chaves = todasAsChaves();
    assert.ok(Array.isArray(chaves));
    assert.ok(chaves.length > 100, "esperava um dicionário com mais de 100 chaves");
  });

  test("nenhum dos 15 idiomas tem chaves em falta", () => {
    IDIOMAS.forEach(i => {
      const emFalta = chavesEmFalta(i.codigo);
      assert.deepEqual(emFalta, [], `idioma ${i.codigo} tem chaves sem tradução: ${emFalta.join(", ")}`);
    });
  });

  test("chavesEmFalta() de um idioma inexistente devolve todas as chaves", () => {
    const emFalta = chavesEmFalta("xx-nao-existe");
    assert.equal(emFalta.length, todasAsChaves().length);
  });
});
