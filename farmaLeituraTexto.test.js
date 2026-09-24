import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extensaoDe, textoDeHtml, textoDeCsv, tipoSuportado, TIPOS_SUPORTADOS } from "../src/farmaLeituraTexto.js";

describe("farmaLeituraTexto.js — extensaoDe", () => {
  test("extrai a extensão em minúsculas, sem o ponto", () => {
    assert.equal(extensaoDe("bula.PDF"), "pdf");
    assert.equal(extensaoDe("relatorio.final.xlsx"), "xlsx");
  });
  test("nome sem extensão ou terminado em ponto devolve string vazia", () => {
    assert.equal(extensaoDe("semextensao"), "");
    assert.equal(extensaoDe("nome."), "");
    assert.equal(extensaoDe(""), "");
    assert.equal(extensaoDe(null), "");
  });
});

describe("farmaLeituraTexto.js — textoDeHtml", () => {
  test("remove tags e mantém o texto visível", () => {
    const r = textoDeHtml("<html><body><h1>Título</h1><p>Um parágrafo.</p></body></html>");
    assert.ok(r.includes("Título"));
    assert.ok(r.includes("Um parágrafo."));
    assert.ok(!r.includes("<h1>"));
  });

  test("descarta o conteúdo de <script> e <style> por inteiro", () => {
    const r = textoDeHtml("<p>Visível</p><script>alert('não deveria aparecer')</script><style>.x{color:red}</style>");
    assert.ok(r.includes("Visível"));
    assert.ok(!r.includes("alert"));
    assert.ok(!r.includes("color:red"));
  });

  test("descodifica entidades comuns, incluindo acentuação portuguesa", () => {
    assert.equal(textoDeHtml("<p>Pre&ccedil;o &eacute; import&acirc;nte, n&atilde;o &eacute;?</p>"), "Preço é importânte, não é?");
    assert.equal(textoDeHtml("A &amp; B &lt; C"), "A & B < C");
  });

  test("descodifica entidades numéricas", () => {
    assert.equal(textoDeHtml("caf&#233;"), "café");
    assert.equal(textoDeHtml("caf&#xe9;"), "café");
  });

  test("blocos de parágrafo/div/br viram quebras de linha, para não colar tudo", () => {
    const r = textoDeHtml("<p>Primeiro</p><p>Segundo</p>");
    assert.ok(r.includes("Primeiro\n\nSegundo") || (r.includes("Primeiro") && r.includes("Segundo") && r.indexOf("Primeiro") < r.indexOf("Segundo")));
  });

  test("entrada vazia/nula não rebenta", () => {
    assert.equal(textoDeHtml(""), "");
    assert.equal(textoDeHtml(null), "");
  });
});

describe("farmaLeituraTexto.js — textoDeCsv", () => {
  test("converte linhas em frases legíveis 'coluna: valor'", () => {
    const r = textoDeCsv("nome,idade\nAna,30\nBruno,25");
    assert.ok(r.includes("nome: Ana"));
    assert.ok(r.includes("idade: 30"));
    assert.ok(r.includes("nome: Bruno"));
  });

  test("deteta o separador ; quando é o mais frequente na 1ª linha", () => {
    const r = textoDeCsv("nome;idade\nAna;30");
    assert.ok(r.includes("nome: Ana"));
    assert.ok(r.includes("idade: 30"));
  });

  test("linhas completamente vazias são ignoradas", () => {
    const r = textoDeCsv("nome,idade\nAna,30\n,\nBruno,25");
    const blocos = r.split("\n\n").filter(Boolean);
    assert.equal(blocos.length, 2);
  });

  test("csv vazio devolve string vazia", () => {
    assert.equal(textoDeCsv(""), "");
    assert.equal(textoDeCsv(null), "");
  });

  test("nomeColunas explícito ignora a 1ª linha como cabeçalho", () => {
    const r = textoDeCsv("Ana,30\nBruno,25", ["nome", "idade"]);
    assert.ok(r.includes("nome: Ana"));
    assert.ok(r.includes("nome: Bruno"));
  });
});

describe("farmaLeituraTexto.js — tipoSuportado / TIPOS_SUPORTADOS", () => {
  test("reconhece todos os tipos anunciados", () => {
    for (const ext of Object.keys(TIPOS_SUPORTADOS)) {
      assert.equal(tipoSuportado(`ficheiro.${ext}`), TIPOS_SUPORTADOS[ext]);
    }
  });

  test("um formato desconhecido devolve null", () => {
    assert.equal(tipoSuportado("imagem.png"), null);
    assert.equal(tipoSuportado("sem-extensao"), null);
  });
});
