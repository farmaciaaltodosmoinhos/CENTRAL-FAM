import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dividirEmExcertos, prepararDocumento, acrescentarAoConhecimento, esquecerDocumento,
  listarDocumentos, pesquisarConhecimento, LIMITE_EXCERTOS_CONHECIMENTO
} from "../src/farmaLeitura.js";

const AGORA = new Date("2026-09-20T10:00:00.000Z");

describe("farmaLeitura.js — dividirEmExcertos", () => {
  test("texto vazio/só espaços devolve lista vazia", () => {
    assert.deepEqual(dividirEmExcertos(""), []);
    assert.deepEqual(dividirEmExcertos("   \n\n  "), []);
    assert.deepEqual(dividirEmExcertos(null), []);
  });

  test("texto muito curto (abaixo do mínimo) não gera nenhum excerto", () => {
    assert.deepEqual(dividirEmExcertos("Olá."), []);
  });

  test("parágrafos curtos que cabem juntos ficam no mesmo excerto", () => {
    const texto = "Primeira frase do documento aqui.\n\nSegunda frase, também curta.";
    const excertos = dividirEmExcertos(texto, 200);
    assert.equal(excertos.length, 1);
    assert.ok(excertos[0].includes("Primeira frase"));
    assert.ok(excertos[0].includes("Segunda frase"));
  });

  test("um parágrafo maior que o tamanho-alvo é dividido em mais do que um excerto", () => {
    const frase = "Esta é uma frase de exemplo com algum comprimento razoável para o teste. ";
    const paragrafo = frase.repeat(10);
    const excertos = dividirEmExcertos(paragrafo, 150);
    assert.ok(excertos.length > 1);
    excertos.forEach(e => assert.ok(e.length > 0));
  });

  test("nunca corta uma frase a meio quando consegue evitá-lo (excertos terminam em pontuação de frase)", () => {
    const paragrafo = "Frase número um aqui. Frase número dois aqui também. Frase número três, mais longa ainda, aqui.".repeat(3);
    const excertos = dividirEmExcertos(paragrafo, 80);
    excertos.forEach(e => assert.ok(/[.!?]$/.test(e.trim()) || e === excertos[excertos.length - 1]));
  });
});

describe("farmaLeitura.js — prepararDocumento", () => {
  test("gera um item por excerto, cada um com features do tamanho esperado", () => {
    const texto = "A amoxicilina é um antibiótico usado para tratar infeções bacterianas comuns em adultos e crianças.";
    const { itens, relatorio } = prepararDocumento("bula.pdf", texto, AGORA);
    assert.ok(itens.length >= 1);
    itens.forEach(item => {
      assert.equal(item.ficheiro, "bula.pdf");
      assert.equal(item.features.length, 256);
      assert.equal(item.adicionadoEm, AGORA.toISOString());
    });
    assert.equal(relatorio.ficheiro, "bula.pdf");
    assert.equal(relatorio.totalExcertos, itens.length);
  });

  test("documento vazio devolve zero itens, sem rebentar", () => {
    const { itens, relatorio } = prepararDocumento("vazio.txt", "", AGORA);
    assert.deepEqual(itens, []);
    assert.equal(relatorio.totalExcertos, 0);
  });
});

describe("farmaLeitura.js — acrescentarAoConhecimento", () => {
  test("acrescenta itens novos a uma base vazia", () => {
    const { itens } = prepararDocumento("doc1.txt", "Texto de exemplo suficientemente longo para gerar um excerto válido.", AGORA);
    const base = acrescentarAoConhecimento([], itens);
    assert.equal(base.length, itens.length);
  });

  test("não duplica o mesmo excerto do mesmo ficheiro", () => {
    const { itens } = prepararDocumento("doc1.txt", "Texto de exemplo suficientemente longo para gerar um excerto válido.", AGORA);
    let base = acrescentarAoConhecimento([], itens);
    base = acrescentarAoConhecimento(base, itens); // mesmo documento outra vez
    assert.equal(base.length, itens.length);
  });

  test("respeita o limite total, descartando os excertos mais antigos primeiro", () => {
    let base = [];
    for (let i = 0; i < 5; i++) {
      const { itens } = prepararDocumento(`doc${i}.txt`, `Conteúdo bem distinto do documento número ${i} para gerar um excerto válido e único.`, AGORA);
      base = acrescentarAoConhecimento(base, itens);
    }
    // força um limite pequeno artificialmente através de muitos documentos pequenos não é prático aqui;
    // em vez disso confirma que a função nunca excede LIMITE_EXCERTOS_CONHECIMENTO mesmo com muita entrada.
    const itensGrandes = Array.from({ length: LIMITE_EXCERTOS_CONHECIMENTO + 50 }, (_, i) => ({
      id: `x-${i}`, ficheiro: "grande.txt", texto: `Excerto único número ${i} do documento grande de teste.`,
      features: new Array(256).fill(0), adicionadoEm: AGORA.toISOString()
    }));
    const resultado = acrescentarAoConhecimento([], itensGrandes);
    assert.equal(resultado.length, LIMITE_EXCERTOS_CONHECIMENTO);
    // mantém os ÚLTIMOS (mais recentes), descarta os primeiros
    assert.equal(resultado[0].texto, itensGrandes[50].texto);
  });
});

describe("farmaLeitura.js — esquecerDocumento", () => {
  test("remove só os excertos do ficheiro indicado, mantém os outros", () => {
    const doc1 = prepararDocumento("doc1.txt", "Conteúdo do primeiro documento com texto suficiente para um excerto.", AGORA).itens;
    const doc2 = prepararDocumento("doc2.txt", "Conteúdo do segundo documento com texto suficiente para outro excerto.", AGORA).itens;
    let base = acrescentarAoConhecimento([], [...doc1, ...doc2]);
    base = esquecerDocumento(base, "doc1.txt");
    assert.ok(base.every(i => i.ficheiro === "doc2.txt"));
    assert.equal(base.length, doc2.length);
  });
});

describe("farmaLeitura.js — listarDocumentos", () => {
  test("agrupa por ficheiro com a contagem certa de excertos", () => {
    const doc1 = prepararDocumento("doc1.txt", "Conteúdo do primeiro documento com texto suficiente para gerar excerto.", AGORA).itens;
    const doc2 = prepararDocumento("doc2.txt", "Conteúdo do segundo documento, também com texto suficiente para excerto.", AGORA).itens;
    const base = acrescentarAoConhecimento([], [...doc1, ...doc2]);
    const lista = listarDocumentos(base);
    assert.equal(lista.length, 2);
    const nomes = lista.map(d => d.ficheiro).sort();
    assert.deepEqual(nomes, ["doc1.txt", "doc2.txt"]);
  });

  test("base vazia devolve lista vazia", () => {
    assert.deepEqual(listarDocumentos([]), []);
    assert.deepEqual(listarDocumentos(null), []);
  });
});

describe("farmaLeitura.js — pesquisarConhecimento", () => {
  const TEXTO_BULA = "A amoxicilina é um antibiótico da classe das penicilinas, usado para tratar infeções bacterianas. " +
    "A dose habitual em adultos é de 500mg a cada 8 horas, podendo variar conforme a indicação clínica. " +
    "Deve ser evitada em doentes com alergia conhecida a penicilinas, pelo risco de reação anafilática.";

  test("base vazia devolve lista vazia, sem rebentar", () => {
    assert.deepEqual(pesquisarConhecimento("qualquer pergunta", []), []);
    assert.deepEqual(pesquisarConhecimento("qualquer pergunta", null), []);
  });

  test("pergunta vazia devolve lista vazia", () => {
    const { itens } = prepararDocumento("bula.pdf", TEXTO_BULA, AGORA);
    const base = acrescentarAoConhecimento([], itens);
    assert.deepEqual(pesquisarConhecimento("", base), []);
  });

  test("encontra o excerto relevante para uma pergunta sobre o mesmo assunto", () => {
    const { itens } = prepararDocumento("bula.pdf", TEXTO_BULA, AGORA);
    const base = acrescentarAoConhecimento([], itens);
    const resultados = pesquisarConhecimento("qual a dose de amoxicilina para adultos", base);
    assert.ok(resultados.length >= 1);
    assert.equal(resultados[0].ficheiro, "bula.pdf");
    assert.ok(resultados[0].texto.includes("amoxicilina"));
  });

  test("uma pergunta completamente sem relação não devolve nada", () => {
    const { itens } = prepararDocumento("bula.pdf", TEXTO_BULA, AGORA);
    const base = acrescentarAoConhecimento([], itens);
    assert.deepEqual(pesquisarConhecimento("qual é a capital de portugal", base), []);
    assert.deepEqual(pesquisarConhecimento("quantos utentes tenho registados", base), []);
  });

  test("os resultados nunca incluem o vetor de features (só os dados de apresentação)", () => {
    const { itens } = prepararDocumento("bula.pdf", TEXTO_BULA, AGORA);
    const base = acrescentarAoConhecimento([], itens);
    const resultados = pesquisarConhecimento("qual a dose de amoxicilina para adultos", base);
    resultados.forEach(r => assert.equal(r.features, undefined));
  });
});
