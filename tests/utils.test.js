import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  debounce,
  uid,
  nowTs,
  relTime,
  highlight,
  matchesQuery,
  normalizeUrl,
  deepFreeze,
  readableTextColor,
  shade,
  placeholderImg,
  deveAdiarRenderizacao,
  validarNif,
  validarEmail,
  validarTelefone
} from "../src/utils.js";

describe("utils.js — escapeHtml", () => {
  test("escapa os 5 caracteres perigosos de HTML", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  test("texto sem caracteres especiais fica inalterado", () => {
    assert.equal(escapeHtml("Paracetamol 500mg"), "Paracetamol 500mg");
  });

  test("valores falsy (null/undefined/'') devolvem string vazia, nunca rebentam", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(""), "");
  });

  test("aceita números sem rebentar (converte para string)", () => {
    assert.equal(escapeHtml(42), "42");
  });
});

describe("utils.js — debounce", () => {
  test("só chama a função uma vez, com os últimos argumentos, depois do período de silêncio", async () => {
    const chamadas = [];
    const debounced = debounce((...args) => chamadas.push(args), 30);
    debounced("primeira");
    debounced("segunda");
    debounced("terceira");
    await new Promise(r => setTimeout(r, 80));
    assert.deepEqual(chamadas, [["terceira"]]);
  });

  test("chamadas espaçadas mais que o período disparam a função múltiplas vezes", async () => {
    const chamadas = [];
    const debounced = debounce(() => chamadas.push(1), 20);
    debounced();
    await new Promise(r => setTimeout(r, 50));
    debounced();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(chamadas.length, 2);
  });
});

describe("utils.js — uid / nowTs", () => {
  test("uid() usa o prefixo dado", () => {
    assert.ok(uid("tarefa").startsWith("tarefa_"));
  });

  test("uid() usa 'id' como prefixo por omissão", () => {
    assert.ok(uid().startsWith("id_"));
  });

  test("duas chamadas a uid() nunca colidem", () => {
    const ids = new Set(Array.from({ length: 50 }, () => uid()));
    assert.equal(ids.size, 50);
  });

  test("nowTs() devolve um timestamp próximo de Date.now()", () => {
    assert.ok(Math.abs(nowTs() - Date.now()) < 1000);
  });
});

describe("utils.js — relTime", () => {
  test("timestamp falsy devolve 'nunca'", () => {
    assert.equal(relTime(0), "nunca");
    assert.equal(relTime(null), "nunca");
  });

  test("menos de 1 minuto devolve 'agora mesmo'", () => {
    assert.equal(relTime(Date.now() - 5000), "agora mesmo");
  });

  test("dentro da última hora devolve minutos", () => {
    assert.equal(relTime(Date.now() - 10 * 60000), "há 10 min");
  });

  test("dentro do último dia devolve horas", () => {
    assert.equal(relTime(Date.now() - 5 * 3600000), "há 5h");
  });

  test("dentro do último mês devolve dias", () => {
    assert.equal(relTime(Date.now() - 10 * 86400000), "há 10d");
  });

  test("mais de 30 dias devolve meses, com plural correto", () => {
    assert.equal(relTime(Date.now() - 35 * 86400000), "há 1 mês");
    assert.equal(relTime(Date.now() - 70 * 86400000), "há 2 meses");
  });

  test("um timestamp no futuro nunca dá negativo (fica em 'agora mesmo')", () => {
    assert.equal(relTime(Date.now() + 100000), "agora mesmo");
  });
});

describe("utils.js — highlight", () => {
  test("envolve a correspondência em <mark>, preservando o texto original escapado", () => {
    assert.equal(highlight("Paracetamol", "aceta"), "Par<mark>aceta</mark>mol");
  });

  test("é case-insensitive", () => {
    assert.equal(highlight("Paracetamol", "PARACETAMOL"), "<mark>Paracetamol</mark>");
  });

  test("sem query devolve o texto só escapado, sem <mark>", () => {
    assert.equal(highlight("<script>", ""), "&lt;script&gt;");
  });

  test("uma query com caracteres especiais de regex não rebenta (escapada internamente)", () => {
    assert.doesNotThrow(() => highlight("Preço: 10€ (unidade)", "10€ ("));
  });
});

describe("utils.js — matchesQuery", () => {
  const servico = { nome: "Vacina da Gripe", descricao: "Sazonal", tags: ["inverno", "prevenção"] };

  test("sem query, corresponde sempre", () => {
    assert.equal(matchesQuery(servico, "Geral", ""), true);
  });

  test("corresponde pelo nome, case-insensitive", () => {
    assert.equal(matchesQuery(servico, "Geral", "GRIPE"), true);
  });

  test("corresponde pela descrição", () => {
    assert.equal(matchesQuery(servico, "Geral", "sazonal"), true);
  });

  test("corresponde pelo nome da categoria", () => {
    assert.equal(matchesQuery(servico, "Rastreios Cardiovasculares", "cardiovascular"), true);
  });

  test("corresponde por uma tag", () => {
    assert.equal(matchesQuery(servico, "Geral", "prevenção"), true);
  });

  test("não corresponde quando nada bate certo", () => {
    assert.equal(matchesQuery(servico, "Geral", "manipulados"), false);
  });
});

describe("utils.js — normalizeUrl", () => {
  test("acrescenta https:// a um domínio sem protocolo", () => {
    assert.equal(normalizeUrl("exemplo.pt"), "https://exemplo.pt");
  });

  test("não mexe num URL que já tem http://", () => {
    assert.equal(normalizeUrl("http://exemplo.pt"), "http://exemplo.pt");
  });

  test("não mexe num URL que já tem https://", () => {
    assert.equal(normalizeUrl("https://exemplo.pt"), "https://exemplo.pt");
  });

  test("valores falsy passam através sem rebentar", () => {
    assert.equal(normalizeUrl(""), "");
    assert.equal(normalizeUrl(null), null);
  });
});

describe("utils.js — deepFreeze", () => {
  test("congela o objeto de topo", () => {
    const obj = deepFreeze({ a: 1 });
    assert.throws(() => { obj.a = 2; }, TypeError);
  });

  test("congela também objetos aninhados (profundamente)", () => {
    const obj = deepFreeze({ a: { b: { c: 1 } } });
    assert.throws(() => { obj.a.b.c = 2; }, TypeError);
  });

  test("congela arrays aninhados", () => {
    const obj = deepFreeze({ lista: [1, 2, 3] });
    assert.throws(() => { obj.lista.push(4); }, TypeError);
  });

  test("aceita null sem rebentar", () => {
    assert.equal(deepFreeze(null), null);
  });
});

describe("utils.js — readableTextColor", () => {
  test("fundo branco pede texto escuro", () => {
    assert.equal(readableTextColor("#ffffff"), "#173226");
  });

  test("fundo preto pede texto claro (branco)", () => {
    assert.equal(readableTextColor("#000000"), "#ffffff");
  });

  test("hex inválido cai para o valor escuro por omissão", () => {
    assert.equal(readableTextColor("#zzzzzz"), "#173226");
  });

  test("hex falsy cai para o valor escuro por omissão", () => {
    assert.equal(readableTextColor(null), "#173226");
  });

  test("aceita tons claros/escuros de reserva personalizados", () => {
    assert.equal(readableTextColor("#000000", "#111111", "#eeeeee"), "#eeeeee");
  });
});

describe("utils.js — shade", () => {
  test("percent positivo clareia em direção ao branco", () => {
    assert.equal(shade("#000000", 0.5), "#808080");
  });

  test("percent negativo escurece em direção ao preto", () => {
    assert.equal(shade("#ffffff", -0.5), "#808080");
  });

  test("percent 0 devolve a cor inalterada", () => {
    assert.equal(shade("#2b7a4b", 0), "#2b7a4b");
  });

  test("hex falsy/inválido devolve o valor de entrada sem rebentar", () => {
    assert.equal(shade(null, 0.5), null);
    assert.equal(shade("#zzzzzz", 0.5), "#zzzzzz");
  });
});

describe("utils.js — placeholderImg", () => {
  test("usa a primeira letra do nome, em maiúscula", () => {
    const svg = decodeURIComponent(placeholderImg("ana"));
    assert.ok(svg.includes(">A<"));
  });

  test("nome vazio/omitido cai para '?'", () => {
    const svg = decodeURIComponent(placeholderImg(""));
    assert.ok(svg.includes(">?<"));
  });

  test("ignora espaços em branco à volta do nome", () => {
    const svg = decodeURIComponent(placeholderImg("  maria"));
    assert.ok(svg.includes(">M<"));
  });
});

describe("utils.js — deveAdiarRenderizacao", () => {
  function inputFalso(tagName, type) { return { tagName, type }; }
  function containerComElemento(elemento) { return { contains: (el) => el === elemento }; }

  test("sem elemento focado, nunca adia", () => {
    assert.equal(deveAdiarRenderizacao(null, {}), false);
  });

  test("elemento focado fora do container, nunca adia", () => {
    const el = inputFalso("INPUT", "text");
    assert.equal(deveAdiarRenderizacao(el, containerComElemento({})), false);
  });

  test("um botão focado (mesmo dentro do container) nunca adia", () => {
    const btn = { tagName: "BUTTON" };
    assert.equal(deveAdiarRenderizacao(btn, containerComElemento(btn)), false);
  });

  test("um <input type=text> focado dentro do container adia", () => {
    const el = inputFalso("INPUT", "text");
    assert.equal(deveAdiarRenderizacao(el, containerComElemento(el)), true);
  });

  test("um seletor de cor nativo (<input type=color>) aberto adia", () => {
    const el = inputFalso("INPUT", "color");
    assert.equal(deveAdiarRenderizacao(el, containerComElemento(el)), true);
  });

  test("um <input type=checkbox> focado NÃO adia (só texto/color contam)", () => {
    const el = inputFalso("INPUT", "checkbox");
    assert.equal(deveAdiarRenderizacao(el, containerComElemento(el)), false);
  });
});

describe("utils.js — validarNif", () => {
  test("aceita NIFs reais com o dígito de controlo correto", () => {
    assert.equal(validarNif("123456789"), true);
    assert.equal(validarNif("500000000"), true);
    assert.equal(validarNif("190000007"), true);
    assert.equal(validarNif("234567899"), true);
  });
  test("rejeita um NIF com o dígito de controlo errado (erro mais comum ao copiar)", () => {
    assert.equal(validarNif("123456788"), false);
  });
  test("aceita com espaços/pontos, formato comum ao copiar do cartão de cidadão", () => {
    assert.equal(validarNif("123 456 789"), true);
    assert.equal(validarNif("123.456.789"), true);
  });
  test("rejeita comprimento errado (curto ou longo)", () => {
    assert.equal(validarNif("12345678"), false);
    assert.equal(validarNif("1234567890"), false);
  });
  test("rejeita não-dígitos", () => {
    assert.equal(validarNif("12345678A"), false);
  });
  test("rejeita vazio/omitido", () => {
    assert.equal(validarNif(""), false);
    assert.equal(validarNif(undefined), false);
    assert.equal(validarNif(null), false);
  });
});

describe("utils.js — validarEmail", () => {
  test("aceita emails com formato válido", () => {
    assert.equal(validarEmail("ana@farmacia.pt"), true);
    assert.equal(validarEmail("ana.costa+aue@sub.dominio.com"), true);
  });
  test("rejeita sem @, sem domínio ou com espaços", () => {
    assert.equal(validarEmail("anafarmacia.pt"), false);
    assert.equal(validarEmail("ana@farmacia"), false);
    assert.equal(validarEmail("ana @farmacia.pt"), false);
    assert.equal(validarEmail("ana@ farmacia.pt"), false);
  });
  test("aceita com espaços à volta (aparados antes de validar)", () => {
    assert.equal(validarEmail("  ana@farmacia.pt  "), true);
  });
  test("rejeita vazio/omitido", () => {
    assert.equal(validarEmail(""), false);
    assert.equal(validarEmail(undefined), false);
  });
});

describe("utils.js — validarTelefone", () => {
  test("aceita telemóvel e fixo portugueses válidos (9 dígitos)", () => {
    assert.equal(validarTelefone("912345678"), true); // telemóvel
    assert.equal(validarTelefone("213456789"), true); // fixo Lisboa
    assert.equal(validarTelefone("800123456"), true); // linha gratuita
  });
  test("aceita com espaços/traços e indicativo +351 ou 00351", () => {
    assert.equal(validarTelefone("912 345 678"), true);
    assert.equal(validarTelefone("912-345-678"), true);
    assert.equal(validarTelefone("+351 912345678"), true);
    assert.equal(validarTelefone("00351912345678"), true);
  });
  test("rejeita um primeiro dígito fora do plano de numeração português (0, 1, 4, 5)", () => {
    assert.equal(validarTelefone("012345678"), false);
    assert.equal(validarTelefone("112345678"), false);
    assert.equal(validarTelefone("412345678"), false);
    assert.equal(validarTelefone("512345678"), false);
  });
  test("rejeita comprimento errado (a mais ou a menos um dígito)", () => {
    assert.equal(validarTelefone("91234567"), false);
    assert.equal(validarTelefone("9123456789"), false);
  });
  test("rejeita vazio/omitido", () => {
    assert.equal(validarTelefone(""), false);
    assert.equal(validarTelefone(undefined), false);
  });
});
