import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACOES_DISPONIVEIS, construirPromptSistema, extrairJson, interpretarRespostaLLM,
  prepararAcao, executarAcaoConfirmada, resolverComRaciocinio, construirMensagemAutoCorrecao,
} from "../src/farmaAcoes.js";

describe("farmaAcoes.js — construirPromptSistema", () => {
  test("inclui todos os ids do catálogo e pede português de Portugal", () => {
    const prompt = construirPromptSistema();
    for (const id of Object.keys(ACOES_DISPONIVEIS)) {
      assert.match(prompt, new RegExp(id.replace(".", "\\.")));
    }
    assert.match(prompt, /português de Portugal/);
    assert.match(prompt, /JSON/);
  });
});

describe("farmaAcoes.js — extrairJson", () => {
  test("texto vazio/nulo devolve null", () => {
    assert.equal(extrairJson(""), null);
    assert.equal(extrairJson(null), null);
  });
  test("JSON puro é extraído diretamente", () => {
    assert.deepEqual(extrairJson('{"tipo":"resposta","texto":"olá"}'), { tipo: "resposta", texto: "olá" });
  });
  test("JSON dentro de cercas ```json ... ``` é extraído", () => {
    const bruto = "```json\n{\"tipo\":\"resposta\",\"texto\":\"olá\"}\n```";
    assert.deepEqual(extrairJson(bruto), { tipo: "resposta", texto: "olá" });
  });
  test("JSON com texto à volta (modelo desobediente) ainda é extraído", () => {
    const bruto = 'Claro! Aqui está: {"tipo":"resposta","texto":"olá"} espero que ajude.';
    assert.deepEqual(extrairJson(bruto), { tipo: "resposta", texto: "olá" });
  });
  test("texto sem nenhum JSON devolve null em vez de rebentar", () => {
    assert.equal(extrairJson("isto não é json nenhum"), null);
  });
  test("JSON malformado devolve null em vez de rebentar", () => {
    assert.equal(extrairJson('{"tipo": "resposta", "texto": }'), null);
  });
});

describe("farmaAcoes.js — interpretarRespostaLLM", () => {
  test("resposta de texto válida", () => {
    const r = interpretarRespostaLLM('{"tipo":"resposta","texto":"Não sei responder a isso."}');
    assert.deepEqual(r, { tipo: "resposta", texto: "Não sei responder a isso." });
  });
  test("resposta de texto sem campo texto é inválida", () => {
    assert.equal(interpretarRespostaLLM('{"tipo":"resposta"}').tipo, "invalido");
  });
  test("ação válida com todos os parâmetros passa", () => {
    const r = interpretarRespostaLLM('{"tipo":"acao","acaoId":"manipulados.mudar_estado","parametros":{"identificarPedido":"Maria","novoEstado":"entregue"}}');
    assert.equal(r.tipo, "acao");
    assert.equal(r.acaoId, "manipulados.mudar_estado");
  });
  test("ação com id fora do catálogo é inválida (nunca inventa uma ação nova)", () => {
    const r = interpretarRespostaLLM('{"tipo":"acao","acaoId":"documentos.apagar_tudo","parametros":{}}');
    assert.equal(r.tipo, "invalido");
  });
  test("ação a que falta um parâmetro obrigatório é inválida", () => {
    const r = interpretarRespostaLLM('{"tipo":"acao","acaoId":"manipulados.mudar_estado","parametros":{"identificarPedido":"Maria"}}');
    assert.equal(r.tipo, "invalido");
    assert.match(r.motivo, /novoEstado/);
  });
  test("JSON totalmente fora de forma é inválido, nunca rebenta", () => {
    assert.equal(interpretarRespostaLLM("qualquer coisa aleatória").tipo, "invalido");
    assert.equal(interpretarRespostaLLM("").tipo, "invalido");
  });
  test("tipo desconhecido é inválido", () => {
    assert.equal(interpretarRespostaLLM('{"tipo":"outra_coisa"}').tipo, "invalido");
  });
});

describe("farmaAcoes.js — prepararAcao", () => {
  const estado = {
    manipulados: [
      { id: "1", nome: "Maria Silva", medicamento: "Creme X", status: "preparacao" },
      { id: "2", nome: "João Costa", medicamento: "Pomada Y", status: "pendente_utente" },
      { id: "3", nome: "Maria Fernandes", medicamento: "Creme Z", status: "pronto" },
    ],
  };
  test("encontra exatamente um pedido e prepara o plano com resumo humano", () => {
    const r = prepararAcao("manipulados.mudar_estado", { identificarPedido: "João", novoEstado: "entregue" }, estado);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /João Costa/);
    assert.match(r.resumo, /Entregue/);
    assert.deepEqual(r.plano, { tipo: "manipulados.mudar_estado", pedidoId: "2", novoEstado: "entregue" });
  });
  test("nenhuma correspondência devolve motivo claro, não inventa", () => {
    const r = prepararAcao("manipulados.mudar_estado", { identificarPedido: "Ninguém", novoEstado: "entregue" }, estado);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
  test("várias correspondências pede para ser mais específico, nunca escolhe sozinha", () => {
    const r = prepararAcao("manipulados.mudar_estado", { identificarPedido: "Maria", novoEstado: "entregue" }, estado);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /mais do que um/);
  });
  test("estado inválido é recusado", () => {
    const r = prepararAcao("manipulados.mudar_estado", { identificarPedido: "João", novoEstado: "inventado" }, estado);
    assert.equal(r.ok, false);
  });
  test("ação desconhecida é recusada", () => {
    const r = prepararAcao("outra.coisa", {}, estado);
    assert.equal(r.ok, false);
  });
  test("estado sem manipulados não rebenta", () => {
    const r = prepararAcao("manipulados.mudar_estado", { identificarPedido: "João", novoEstado: "entregue" }, {});
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada", () => {
  function fakeDataStore(estadoInicial) {
    let gravado = null;
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      _gravado: () => gravado,
    };
  }

  test("executa a mudança de estado, grava, e credita o uso", async () => {
    const estado = { config: { logo: "base64grande", nome: "Teste" }, manipulados: [{ id: "1", nome: "Maria", status: "preparacao" }] };
    const ds = fakeDataStore(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "manipulados.mudar_estado", pedidoId: "1", novoEstado: "entregue" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.match(r.mensagem, /Entregue/);
    assert.deepEqual(usos, [["manipulados", "marcar_entregue"]]);
    assert.equal(ds._gravado().manipulados[0].status, "entregue");
    assert.equal(ds._gravado().config.logo, undefined, "o logo nunca deve ser reenviado");
  });

  test("pedido inexistente devolve erro claro sem gravar nada", async () => {
    const estado = { manipulados: [] };
    const ds = fakeDataStore(estado);
    const r = await executarAcaoConfirmada({ tipo: "manipulados.mudar_estado", pedidoId: "999", novoEstado: "entregue" }, { dataStore: ds });
    assert.equal(r.ok, false);
    assert.equal(ds._gravado(), null);
  });

  test("falha de rede vira mensagem clara, nunca rebenta", async () => {
    const dsQueFalha = { async getEstadoCompleto() { throw new Error("rede em baixo"); } };
    const r = await executarAcaoConfirmada({ tipo: "manipulados.mudar_estado", pedidoId: "1", novoEstado: "entregue" }, { dataStore: dsQueFalha });
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /Não foi possível/);
  });

  test("ação desconhecida devolve mensagem clara", async () => {
    const r = await executarAcaoConfirmada({ tipo: "algo.inventado" }, {});
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — interpretarRespostaLLM (parâmetros opcionais, ponto 31)", () => {
  test("ação com parâmetros opcionais em falta ainda é válida (ficam \"\")", () => {
    const r = interpretarRespostaLLM('{"tipo":"acao","acaoId":"catalogo.adicionar_produto","parametros":{"nome":"Creme X"}}');
    assert.equal(r.tipo, "acao");
    assert.deepEqual(r.parametros, { nome: "Creme X", codigo: "" });
  });
  test("ação com parâmetro obrigatório em falta continua inválida mesmo tendo opcionais", () => {
    const r = interpretarRespostaLLM('{"tipo":"acao","acaoId":"catalogo.adicionar_produto","parametros":{"codigo":"123"}}');
    assert.equal(r.tipo, "invalido");
    assert.match(r.motivo, /nome/);
  });
  test("ação sem nenhum parâmetro opcional definido (manipulados) continua igual a antes", () => {
    const r = interpretarRespostaLLM('{"tipo":"acao","acaoId":"manipulados.mudar_estado","parametros":{"identificarPedido":"Maria","novoEstado":"entregue"}}');
    assert.deepEqual(r.parametros, { identificarPedido: "Maria", novoEstado: "entregue" });
  });
});

describe("farmaAcoes.js — prepararAcao (criar pedido de manipulado e email, ponto 32)", () => {
  test("criar_pedido: campos mínimos, resumo avisa do que falta", () => {
    const r = prepararAcao("manipulados.criar_pedido", { nome: "Ana Costa", medicamento: "Creme Y" }, {});
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Ana Costa/);
    assert.match(r.resumo, /telefone/);
    assert.equal(r.plano.dados.tipoPrescricao, "Uso Humano");
  });
  test("criar_pedido: sem nome é recusado", () => {
    const r = prepararAcao("manipulados.criar_pedido", { nome: "", medicamento: "Creme Y" }, {});
    assert.equal(r.ok, false);
  });
  test("criar_pedido: sem medicamento é recusado", () => {
    const r = prepararAcao("manipulados.criar_pedido", { nome: "Ana", medicamento: "" }, {});
    assert.equal(r.ok, false);
  });
  test("criar_pedido: uso veterinário sem nome do animal é recusado (nunca inventa)", () => {
    const r = prepararAcao("manipulados.criar_pedido", { nome: "Dono", medicamento: "Pomada", tipoPrescricao: "Uso Veterinário", animal: "" }, {});
    assert.equal(r.ok, false);
    assert.match(r.motivo, /animal/);
  });
  test("criar_pedido: uso veterinário com animal, ok, resumo menciona o animal", () => {
    const r = prepararAcao("manipulados.criar_pedido", { nome: "Dono", medicamento: "Pomada", tipoPrescricao: "Uso Veterinário", animal: "Rex" }, {});
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Rex/);
    assert.equal(r.plano.dados.animal, "Rex");
  });
  test("criar_pedido: com todos os campos, resumo não avisa de nada em falta", () => {
    const r = prepararAcao("manipulados.criar_pedido", {
      nome: "Ana Costa", medicamento: "Creme Y", telefone: "912345678", nif: "123456789", receita: "R1", comentarios: "",
    }, {});
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.resumo, /por preencher/);
  });

  const estadoComPedidos = {
    manipulados: [
      { id: "1", nome: "Maria Silva", medicamento: "Creme X", status: "preparacao" },
      { id: "2", nome: "João Costa", medicamento: "Pomada Y", status: "pendente_utente" },
    ],
  };
  test("preparar_email_orcamento: encontra o pedido certo", () => {
    const r = prepararAcao("manipulados.preparar_email_orcamento", { identificarPedido: "João" }, estadoComPedidos);
    assert.equal(r.ok, true);
    assert.equal(r.plano.pedidoId, "2");
  });
  test("preparar_email_orcamento: nenhuma correspondência devolve motivo claro", () => {
    const r = prepararAcao("manipulados.preparar_email_orcamento", { identificarPedido: "Ninguém" }, estadoComPedidos);
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada (criar pedido e email, ponto 32)", () => {
  function fakeDataStore(estadoInicial) {
    let gravado = null;
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      _gravado: () => gravado,
    };
  }

  test("criar_pedido: adiciona ao início da lista, credita o uso, não reenvia o logo", async () => {
    const estado = { config: { logo: "xxx", nomeFarmacia: "Farmácia Teste" }, manipulados: [{ id: "0", nome: "Antigo" }] };
    const ds = fakeDataStore(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "manipulados.criar_pedido", dados: { nome: "Ana Costa", medicamento: "Creme Y", tipoPrescricao: "Uso Humano", animal: "", telefone: "", nif: "", receita: "", comentarios: "" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["manipulados", "criar_pedido"]]);
    const gravado = ds._gravado();
    assert.equal(gravado.manipulados[0].nome, "Ana Costa");
    assert.equal(gravado.manipulados[0].status, "pendente_utente");
    assert.equal(gravado.manipulados.length, 2, "não apaga os pedidos existentes");
    assert.equal(gravado.config.logo, undefined);
  });

  test("preparar_email_orcamento: devolve o conteúdo do email com o destino configurado", async () => {
    const estado = {
      config: { nomeFarmacia: "Farmácia Teste" },
      manipulados: [{ id: "1", nome: "Maria Silva", medicamento: "Creme X", tipoPrescricao: "Uso Humano", telefone: "912345678", receita: "R1" }],
    };
    const ds = fakeDataStore(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "manipulados.preparar_email_orcamento", pedidoId: "1" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]), emailDestinoOrcamento: "lab@exemplo.pt" }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["manipulados", "enviar_orcamento"]]);
    assert.equal(r.abrirEmail.to, "lab@exemplo.pt");
    assert.match(r.abrirEmail.subject, /Creme X/);
    assert.match(r.abrirEmail.body, /Maria Silva/);
  });

  test("preparar_email_orcamento: sem destino predefinido, ainda devolve o conteúdo (to vazio)", async () => {
    const estado = { config: {}, manipulados: [{ id: "1", nome: "Maria Silva", medicamento: "Creme X" }] };
    const ds = fakeDataStore(estado);
    const r = await executarAcaoConfirmada({ tipo: "manipulados.preparar_email_orcamento", pedidoId: "1" }, { dataStore: ds });
    assert.equal(r.ok, true);
    assert.equal(r.abrirEmail.to, "");
  });

  test("preparar_email_orcamento: pedido inexistente devolve erro claro", async () => {
    const ds = fakeDataStore({ manipulados: [] });
    const r = await executarAcaoConfirmada({ tipo: "manipulados.preparar_email_orcamento", pedidoId: "999" }, { dataStore: ds });
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — prepararAcao (criar pedido de AUE e email ao armazenista, ponto 33)", () => {
  test("criar_pedido: campos mínimos com armazenista válido, resumo avisa do que falta", () => {
    const r = prepararAcao("aue.criar_pedido", { nome: "Ana Costa", medicamento: "Med X", armazenista: "OCP" }, {});
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Ana Costa/);
    assert.match(r.resumo, /OCP/);
    assert.match(r.resumo, /telefone/);
    assert.equal(r.plano.dados.armazenista, "OCP");
  });
  test("criar_pedido: armazenista aceite sem distinguir maiúsculas/minúsculas", () => {
    const r = prepararAcao("aue.criar_pedido", { nome: "Ana", medicamento: "Med X", armazenista: "alliance healthcare" }, {});
    assert.equal(r.ok, true);
    assert.equal(r.plano.dados.armazenista, "Alliance Healthcare");
  });
  test("criar_pedido: armazenista inválido é recusado, nunca inventa um novo", () => {
    const r = prepararAcao("aue.criar_pedido", { nome: "Ana", medicamento: "Med X", armazenista: "Farmácia Qualquer" }, {});
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não é um armazenista válido/);
  });
  test("criar_pedido: sem nome é recusado", () => {
    const r = prepararAcao("aue.criar_pedido", { nome: "", medicamento: "Med X", armazenista: "OCP" }, {});
    assert.equal(r.ok, false);
  });
  test("criar_pedido: sem medicamento é recusado", () => {
    const r = prepararAcao("aue.criar_pedido", { nome: "Ana", medicamento: "", armazenista: "OCP" }, {});
    assert.equal(r.ok, false);
  });
  test("criar_pedido: com todos os campos, resumo não avisa de nada em falta", () => {
    const r = prepararAcao("aue.criar_pedido", {
      nome: "Ana Costa", medicamento: "Med X", armazenista: "Plural", telefone: "912345678", nif: "123456789", medico: "Dr. Silva",
    }, {});
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.resumo, /por preencher/);
  });

  const estadoComPedidosAue = {
    aue: { pedidos: [
      { id: "1", nome: "Maria Silva", medicamento: "Med A", armazenista: "OCP" },
      { id: "2", nome: "João Costa", medicamento: "Med B", armazenista: "Empifarma" },
    ] },
  };
  test("preparar_email_armazenista: encontra o pedido certo", () => {
    const r = prepararAcao("aue.preparar_email_armazenista", { identificarPedido: "João" }, estadoComPedidosAue);
    assert.equal(r.ok, true);
    assert.equal(r.plano.pedidoId, "2");
  });
  test("preparar_email_armazenista: nenhuma correspondência devolve motivo claro", () => {
    const r = prepararAcao("aue.preparar_email_armazenista", { identificarPedido: "Ninguém" }, estadoComPedidosAue);
    assert.equal(r.ok, false);
  });
  test("preparar_email_armazenista: estado sem aue não rebenta", () => {
    const r = prepararAcao("aue.preparar_email_armazenista", { identificarPedido: "João" }, {});
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada (AUE, ponto 33)", () => {
  function fakeDataStore(estadoInicial) {
    let gravado = null;
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      _gravado: () => gravado,
    };
  }

  test("criar_pedido: adiciona a estado.aue.pedidos, credita o uso, não reenvia o logo", async () => {
    const estado = { config: { logo: "xxx", nomeFarmacia: "Farmácia Teste" }, aue: { pedidos: [{ id: "0", nome: "Antigo" }] } };
    const ds = fakeDataStore(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "aue.criar_pedido", dados: { nome: "Ana Costa", medicamento: "Med X", armazenista: "OCP", telefone: "", nif: "", medico: "", comercial: "", receita: "", comentarios: "" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["aue", "criar_pedido"]]);
    const gravado = ds._gravado();
    assert.equal(gravado.aue.pedidos[0].nome, "Ana Costa");
    assert.equal(gravado.aue.pedidos[0].status, "pendente_docs");
    assert.equal(gravado.aue.pedidos.length, 2, "não apaga os pedidos existentes");
    assert.equal(gravado.config.logo, undefined);
  });

  test("criar_pedido: estado sem aue prévio não rebenta (primeira vez)", async () => {
    const ds = fakeDataStore({ config: {} });
    const r = await executarAcaoConfirmada(
      { tipo: "aue.criar_pedido", dados: { nome: "Ana", medicamento: "Med X", armazenista: "OCP", telefone: "", nif: "", medico: "", comercial: "", receita: "", comentarios: "" } },
      { dataStore: ds }
    );
    assert.equal(r.ok, true);
    assert.equal(ds._gravado().aue.pedidos.length, 1);
  });

  test("preparar_email_armazenista: devolve o conteúdo do email com o contacto configurado (to + cc)", async () => {
    const estado = {
      config: { nomeFarmacia: "Farmácia Teste" },
      aue: { pedidos: [{ id: "1", nome: "Maria Silva", medicamento: "Med A", armazenista: "Alliance Healthcare", telefone: "912345678", receita: "R1" }] },
    };
    const ds = fakeDataStore(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "aue.preparar_email_armazenista", pedidoId: "1" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]), contactosArmazenista: { "Alliance Healthcare": { to: "apoio@alliance.pt", cc: "gestor@farmacia.pt" } } }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["aue", "enviar_email_armazenista"]]);
    assert.equal(r.abrirEmail.to, "apoio@alliance.pt");
    assert.equal(r.abrirEmail.cc, "gestor@farmacia.pt");
    assert.match(r.abrirEmail.subject, /Med A/);
    assert.match(r.abrirEmail.body, /Maria Silva/);
    assert.match(r.mensagem, /anexar os 3 documentos/);
  });

  test("preparar_email_armazenista: sem contacto predefinido, ainda devolve o conteúdo (to vazio)", async () => {
    const estado = { config: {}, aue: { pedidos: [{ id: "1", nome: "Maria Silva", medicamento: "Med A", armazenista: "Plural" }] } };
    const ds = fakeDataStore(estado);
    const r = await executarAcaoConfirmada({ tipo: "aue.preparar_email_armazenista", pedidoId: "1" }, { dataStore: ds });
    assert.equal(r.ok, true);
    assert.equal(r.abrirEmail.to, "");
  });

  test("preparar_email_armazenista: pedido inexistente devolve erro claro", async () => {
    const ds = fakeDataStore({ aue: { pedidos: [] } });
    const r = await executarAcaoConfirmada({ tipo: "aue.preparar_email_armazenista", pedidoId: "999" }, { dataStore: ds });
    assert.equal(r.ok, false);
  });

  test("falha de rede ao criar pedido de AUE vira mensagem clara, nunca rebenta", async () => {
    const dsQueFalha = { async getEstadoCompleto() { throw new Error("rede em baixo"); } };
    const r = await executarAcaoConfirmada({ tipo: "aue.criar_pedido", dados: { nome: "A", medicamento: "B", armazenista: "OCP" } }, { dataStore: dsQueFalha });
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — prepararAcao (catálogo de produtos, ponto 31)", () => {
  const estado = {
    catalogoProdutos: [
      ["Creme Hidratante X", "1001", 2],
      ["Creme Reparador Y", "1002", 2],
      ["Xarope Z", "2001", 0],
    ],
  };
  test("adicionar_produto: nome novo sem código, ok", () => {
    const r = prepararAcao("catalogo.adicionar_produto", { nome: "Pomada Nova", codigo: "" }, estado);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Pomada Nova/);
    assert.deepEqual(r.plano, { tipo: "catalogo.adicionar_produto", nome: "Pomada Nova", codigo: "" });
  });
  test("adicionar_produto: código já existente é recusado, nunca duplica", () => {
    const r = prepararAcao("catalogo.adicionar_produto", { nome: "Outra Designação", codigo: "1001" }, estado);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Já existe/);
  });
  test("adicionar_produto: sem nome é recusado", () => {
    const r = prepararAcao("catalogo.adicionar_produto", { nome: "", codigo: "" }, estado);
    assert.equal(r.ok, false);
  });
  test("editar_produto: encontra por código exato e muda o nome", () => {
    const r = prepararAcao("catalogo.editar_produto", { identificarProduto: "1001", novoNome: "Creme Hidratante Reformulado", novoCodigo: "" }, estado);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, { tipo: "catalogo.editar_produto", codigoAtual: "1001", produtoEditado: ["Creme Hidratante Reformulado", "1001", 2] });
  });
  test("editar_produto: nenhuma correspondência devolve motivo claro", () => {
    const r = prepararAcao("catalogo.editar_produto", { identificarProduto: "não existe nada assim", novoNome: "X", novoCodigo: "" }, estado);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
  test("editar_produto: várias correspondências pede para ser mais específico", () => {
    const r = prepararAcao("catalogo.editar_produto", { identificarProduto: "creme", novoNome: "X", novoCodigo: "" }, estado);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /mais do que um/);
  });
  test("editar_produto: sem novo nome nem novo código é recusado, nada para fazer", () => {
    const r = prepararAcao("catalogo.editar_produto", { identificarProduto: "1001", novoNome: "", novoCodigo: "" }, estado);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não indicaste/i);
  });
  test("catálogo em falta (estado sem catalogoProdutos) não rebenta", () => {
    const r = prepararAcao("catalogo.editar_produto", { identificarProduto: "1001", novoNome: "X", novoCodigo: "" }, {});
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — prepararAcao (etiquetas, ponto 31)", () => {
  test("tipo domicílio com nome e morada, resumo inclui ambos", () => {
    const r = prepararAcao("documentos.preparar_etiqueta", {
      tipo: "domicilio", nome: "Maria Silva", morada: "Rua das Flores 12", telefone: "", dataEntrega: "",
      produtoTester: "", lote: "", validade: "", produtoNome: "", dosagem: "", posologia: "", quantidade: "",
    }, {});
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Maria Silva/);
    assert.match(r.resumo, /Rua das Flores 12/);
    assert.equal(r.plano.dados.tipo, "domicilio");
  });
  test("tipo inválido é recusado", () => {
    const r = prepararAcao("documentos.preparar_etiqueta", { tipo: "outra_coisa" }, {});
    assert.equal(r.ok, false);
  });
  test("tipo medicamento com quantidade numérica válida", () => {
    const r = prepararAcao("documentos.preparar_etiqueta", { tipo: "medicamento", produtoNome: "Ben-u-ron", quantidade: "10" }, {});
    assert.equal(r.ok, true);
    assert.equal(r.plano.dados.quantidade, 10);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada (catálogo e etiquetas, ponto 31)", () => {
  function fakeDataStoreCompleto(estadoInicial) {
    let gravado = null;
    const assets = {};
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      async getAsset(key) { return assets[key] || null; },
      async setAsset(key, val) { assets[key] = val; },
      _gravado: () => gravado,
      _assets: () => assets,
    };
  }

  test("catalogo.adicionar_produto grava no overlay e credita o uso", async () => {
    const ds = fakeDataStoreCompleto({});
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "catalogo.adicionar_produto", nome: "Pomada Nova", codigo: "9999" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["catalogo-produtos", "adicionar_produto"]]);
    const overlay = JSON.parse(ds._assets().catalogoProdutos);
    assert.equal(overlay.adicionados[0][0], "Pomada Nova");
    assert.equal(overlay.adicionados[0][1], "9999");
  });

  test("catalogo.adicionar_produto com código já usado no overlay não duplica", async () => {
    const ds = fakeDataStoreCompleto({});
    await executarAcaoConfirmada({ tipo: "catalogo.adicionar_produto", nome: "Primeiro", codigo: "5555" }, { dataStore: ds });
    const r2 = await executarAcaoConfirmada({ tipo: "catalogo.adicionar_produto", nome: "Segundo", codigo: "5555" }, { dataStore: ds });
    assert.equal(r2.ok, false);
    const overlay = JSON.parse(ds._assets().catalogoProdutos);
    assert.equal(overlay.adicionados.length, 1);
  });

  test("catalogo.editar_produto grava a edição no overlay e credita o uso", async () => {
    const ds = fakeDataStoreCompleto({});
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "catalogo.editar_produto", codigoAtual: "1001", produtoEditado: ["Novo Nome", "1001", 2] },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["catalogo-produtos", "editar_produto"]]);
    const overlay = JSON.parse(ds._assets().catalogoProdutos);
    assert.equal(overlay.editados["1001"][0], "Novo Nome");
  });

  test("documentos.preparar_etiqueta grava em config.farmaEtiquetaPendente, omite logo, credita o uso", async () => {
    const estado = { config: { logo: "base64grande", nome: "Teste" } };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "documentos.preparar_etiqueta", dados: { tipo: "tester", produtoTester: "Creme X" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["documentos", "gerar_etiqueta"]]);
    assert.equal(ds._gravado().config.farmaEtiquetaPendente.produtoTester, "Creme X");
    assert.equal(ds._gravado().config.logo, undefined, "o logo nunca deve ser reenviado");
  });

  test("falha de rede ao preparar etiqueta vira mensagem clara, nunca rebenta", async () => {
    const dsQueFalha = { async getEstadoCompleto() { throw new Error("rede em baixo"); } };
    const r = await executarAcaoConfirmada({ tipo: "documentos.preparar_etiqueta", dados: { tipo: "tester" } }, { dataStore: dsQueFalha });
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — prepararAcao (Gestão de Gabinete, ponto 34)", () => {
  const estadoGabinete = {
    gabinete: {
      gabinete_checklist_sections_v1: [
        { id: "sec1", titulo: "Emergência", ordem: 0 },
        { id: "controlo-avulso", titulo: "Lista de Controlo (produtos avulsos)", ordem: 1 },
      ],
      gabinete_checklist_items_v1: [
        { id: "it1", sectionId: "sec1", nome: "Adrenalina", cnp: "123456", qv: true, ativo: true, quantidade: 5, quantidadeMinima: 2, validade: "2026-01-01" },
        { id: "it2", sectionId: "controlo-avulso", nome: "Compressas esterilizadas", cnp: "", qv: true, ativo: true, quantidade: 10 },
        { id: "it5", sectionId: "controlo-avulso", nome: "Compressas de gaze", cnp: "", qv: true, ativo: true, quantidade: 3 },
        { id: "it3", sectionId: "sec1", nome: "Livro de registo", qv: false, dateOnly: false, options: ["Sim", "Não"], ativo: true },
        { id: "it4", sectionId: "sec1", nome: "Item removido antigo", qv: true, ativo: false, quantidade: 1 },
      ],
    },
  };

  test("adicionar_item_stock: nome novo, sem opcionais, ok", () => {
    const r = prepararAcao("gabinete.adicionar_item_stock", { nome: "Luvas descartáveis" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Luvas descartáveis/);
    assert.deepEqual(r.plano.dados, { nome: "Luvas descartáveis", cnp: "", lote: "", validade: "", quantidade: 0, quantidadeMinima: "", notas: "" });
  });
  test("adicionar_item_stock: com quantidade e validade válidas, resumo inclui ambas", () => {
    const r = prepararAcao("gabinete.adicionar_item_stock", { nome: "Soro fisiológico", quantidade: "12", validade: "2027-03-01" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /quantidade 12/);
    assert.match(r.resumo, /validade 2027-03-01/);
    assert.equal(r.plano.dados.quantidade, 12);
  });
  test("adicionar_item_stock: validade em formato errado é recusada", () => {
    const r = prepararAcao("gabinete.adicionar_item_stock", { nome: "Soro", validade: "01/03/2027" }, estadoGabinete);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /validade inválida/i);
  });
  test("adicionar_item_stock: sem nome é recusado", () => {
    const r = prepararAcao("gabinete.adicionar_item_stock", { nome: "" }, estadoGabinete);
    assert.equal(r.ok, false);
  });

  test("remover_item_stock: encontra item ativo por nome (substring)", () => {
    const r = prepararAcao("gabinete.remover_item_stock", { identificarItem: "adrenalina" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, { tipo: "gabinete.remover_item_stock", itemId: "it1", nome: "Adrenalina" });
  });
  test("remover_item_stock: encontra por CNP exato", () => {
    const r = prepararAcao("gabinete.remover_item_stock", { identificarItem: "123456" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.equal(r.plano.itemId, "it1");
  });
  test("remover_item_stock: também encontra um item que não é de stock (qv:false) — cobre Itens do Gabinete", () => {
    const r = prepararAcao("gabinete.remover_item_stock", { identificarItem: "livro de registo" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.equal(r.plano.itemId, "it3");
  });
  test("remover_item_stock: item já inativo não é encontrado (não há duas vezes o mesmo removido)", () => {
    const r = prepararAcao("gabinete.remover_item_stock", { identificarItem: "removido" }, estadoGabinete);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
  test("remover_item_stock: mais do que uma correspondência pede para ser mais específico", () => {
    const r = prepararAcao("gabinete.remover_item_stock", { identificarItem: "compressas" }, estadoGabinete);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /mais do que um/);
  });

  test("atualizar_stock: muda quantidade e validade de um produto existente", () => {
    const r = prepararAcao("gabinete.atualizar_stock", { identificarItem: "adrenalina", quantidade: "8", validade: "2027-06-01" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, { tipo: "gabinete.atualizar_stock", itemId: "it1", alteracoes: { quantidade: 8, validade: "2027-06-01" } });
  });
  test("atualizar_stock: sem nenhuma alteração indicada é recusado", () => {
    const r = prepararAcao("gabinete.atualizar_stock", { identificarItem: "adrenalina" }, estadoGabinete);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não indicaste/i);
  });
  test("atualizar_stock: recusa um item que não é de stock (qv:false) — usa gabinete.remover_item_stock para esses, não este", () => {
    const r = prepararAcao("gabinete.atualizar_stock", { identificarItem: "livro de registo", quantidade: "1" }, estadoGabinete);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
  test("atualizar_stock: validade inválida é recusada", () => {
    const r = prepararAcao("gabinete.atualizar_stock", { identificarItem: "adrenalina", validade: "não é uma data" }, estadoGabinete);
    assert.equal(r.ok, false);
  });
  test("atualizar_stock: quantidade não numérica é recusada", () => {
    const r = prepararAcao("gabinete.atualizar_stock", { identificarItem: "adrenalina", quantidade: "muitas" }, estadoGabinete);
    assert.equal(r.ok, false);
  });

  test("criar_relatorio: sem parâmetros usa a data de hoje", () => {
    const r = prepararAcao("gabinete.criar_relatorio", {}, estadoGabinete);
    assert.equal(r.ok, true);
    assert.equal(r.plano.data, new Date().toISOString().slice(0, 10));
    assert.equal(r.plano.farmaceutico, "");
  });
  test("criar_relatorio: com data e farmacêutico válidos", () => {
    const r = prepararAcao("gabinete.criar_relatorio", { data: "2026-09-16", farmaceutico: "Ana Rocha" }, estadoGabinete);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /2026-09-16/);
    assert.match(r.resumo, /Ana Rocha/);
    assert.match(r.resumo, /não inventa/);
  });
  test("criar_relatorio: data inválida é recusada", () => {
    const r = prepararAcao("gabinete.criar_relatorio", { data: "16-09-2026" }, estadoGabinete);
    assert.equal(r.ok, false);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada (Gestão de Gabinete, ponto 34)", () => {
  function fakeDataStoreCompleto(estadoInicial) {
    let gravado = null;
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      _gravado: () => gravado,
    };
  }

  test("adicionar_item_stock: cria a secção avulso (1ª vez) e adiciona o item, credita atualizar_stock, omite o logo", async () => {
    const estado = { config: { logo: "xxx" }, gabinete: {} };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "gabinete.adicionar_item_stock", dados: { nome: "Soro fisiológico", cnp: "", lote: "", validade: "2027-01-01", quantidade: 5, quantidadeMinima: "", notas: "" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["gabinete", "atualizar_stock"]]);
    const gravado = ds._gravado();
    assert.equal(gravado.config.logo, undefined);
    const secoes = gravado.gabinete.gabinete_checklist_sections_v1;
    assert.equal(secoes.length, 1);
    assert.equal(secoes[0].id, "controlo-avulso");
    const itens = gravado.gabinete.gabinete_checklist_items_v1;
    assert.equal(itens.length, 1);
    assert.equal(itens[0].nome, "Soro fisiológico");
    assert.equal(itens[0].qv, true);
    assert.equal(itens[0].ativo, true);
    assert.equal(itens[0].sectionId, "controlo-avulso");
  });

  test("adicionar_item_stock: reaproveita a secção avulso já existente (não duplica) e preserva outros itens", async () => {
    const estado = {
      config: {},
      gabinete: {
        gabinete_checklist_sections_v1: [{ id: "controlo-avulso", titulo: "Lista de Controlo (produtos avulsos)", ordem: 0 }],
        gabinete_checklist_items_v1: [{ id: "it1", sectionId: "controlo-avulso", nome: "Já existente", qv: true, ativo: true }],
      },
    };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada(
      { tipo: "gabinete.adicionar_item_stock", dados: { nome: "Novo produto", cnp: "", lote: "", validade: "", quantidade: 0, quantidadeMinima: "", notas: "" } },
      { dataStore: ds }
    );
    assert.equal(r.ok, true);
    const gravado = ds._gravado();
    assert.equal(gravado.gabinete.gabinete_checklist_sections_v1.length, 1, "não duplica a secção avulso");
    assert.equal(gravado.gabinete.gabinete_checklist_items_v1.length, 2);
    assert.equal(gravado.gabinete.gabinete_checklist_items_v1[0].nome, "Já existente", "preserva o item já existente");
  });

  test("remover_item_stock: marca ativo:false sem apagar o item, credita remover_stock", async () => {
    const estado = { config: {}, gabinete: { gabinete_checklist_items_v1: [{ id: "it1", nome: "Adrenalina", qv: true, ativo: true }] } };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "gabinete.remover_item_stock", itemId: "it1", nome: "Adrenalina" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["gabinete", "remover_stock"]]);
    const itens = ds._gravado().gabinete.gabinete_checklist_items_v1;
    assert.equal(itens.length, 1, "o item continua no array, só desativado");
    assert.equal(itens[0].ativo, false);
  });
  test("remover_item_stock: item inexistente devolve erro claro", async () => {
    const ds = fakeDataStoreCompleto({ gabinete: { gabinete_checklist_items_v1: [] } });
    const r = await executarAcaoConfirmada({ tipo: "gabinete.remover_item_stock", itemId: "não-existe", nome: "X" }, { dataStore: ds });
    assert.equal(r.ok, false);
  });

  test("atualizar_stock: aplica as alterações mantendo o resto do item intacto", async () => {
    const estado = {
      config: {},
      gabinete: { gabinete_checklist_items_v1: [{ id: "it1", nome: "Adrenalina", qv: true, ativo: true, quantidade: 5, validade: "2026-01-01", lote: "L1" }] },
    };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "gabinete.atualizar_stock", itemId: "it1", alteracoes: { quantidade: 9, validade: "2027-01-01" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["gabinete", "atualizar_stock"]]);
    const item = ds._gravado().gabinete.gabinete_checklist_items_v1[0];
    assert.equal(item.quantidade, 9);
    assert.equal(item.validade, "2027-01-01");
    assert.equal(item.lote, "L1", "campos não alterados mantêm-se");
  });
  test("atualizar_stock: item inexistente devolve erro claro", async () => {
    const ds = fakeDataStoreCompleto({ gabinete: { gabinete_checklist_items_v1: [] } });
    const r = await executarAcaoConfirmada({ tipo: "gabinete.atualizar_stock", itemId: "não-existe", alteracoes: { quantidade: 1 } }, { dataStore: ds });
    assert.equal(r.ok, false);
  });

  test("criar_relatorio: grava um relatório vazio com a estrutura ativa (fotografia), credita criar_relatorio", async () => {
    const estado = {
      config: {},
      gabinete: {
        gabinete_checklist_sections_v1: [{ id: "sec1", titulo: "Emergência", ordem: 0 }],
        gabinete_checklist_items_v1: [
          { id: "it1", sectionId: "sec1", nome: "Adrenalina", qv: true, ativo: true, options: ["PEDIR"] },
          { id: "it4", sectionId: "sec1", nome: "Item inativo", qv: true, ativo: false, options: ["PEDIR"] },
        ],
        gabinete_reports_v1: [{ id: "antigo", data: "2026-01-01", respostas: {}, estrutura: [] }],
      },
    };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "gabinete.criar_relatorio", data: "2026-09-16", farmaceutico: "Ana Rocha" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["gabinete", "criar_relatorio"]]);
    const relatorios = ds._gravado().gabinete.gabinete_reports_v1;
    assert.equal(relatorios.length, 2, "não apaga relatórios já guardados");
    const novo = relatorios[0];
    assert.equal(novo.data, "2026-09-16");
    assert.equal(novo.farmaceutico, "Ana Rocha");
    assert.deepEqual(novo.respostas, {}, "nunca inventa respostas");
    assert.equal(novo.estrutura.length, 1);
    assert.equal(novo.estrutura[0].items.length, 1, "só inclui o item ativo, o inativo fica de fora");
    assert.equal(novo.estrutura[0].items[0].nome, "Adrenalina");
  });
  test("criar_relatorio: estado.gabinete vazio (farmácia nova) não rebenta", async () => {
    const ds = fakeDataStoreCompleto({ config: {}, gabinete: {} });
    const r = await executarAcaoConfirmada({ tipo: "gabinete.criar_relatorio", data: "2026-09-16", farmaceutico: "" }, { dataStore: ds });
    assert.equal(r.ok, true);
    assert.equal(ds._gravado().gabinete.gabinete_reports_v1.length, 1);
  });

  test("falha de rede em qualquer ação de gabinete vira mensagem clara, nunca rebenta", async () => {
    const dsQueFalha = { async getEstadoCompleto() { throw new Error("rede em baixo"); } };
    const r1 = await executarAcaoConfirmada({ tipo: "gabinete.adicionar_item_stock", dados: { nome: "X" } }, { dataStore: dsQueFalha });
    const r2 = await executarAcaoConfirmada({ tipo: "gabinete.criar_relatorio", data: "2026-09-16", farmaceutico: "" }, { dataStore: dsQueFalha });
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
  });
});

describe("farmaAcoes.js — prepararAcao (Stocks Errados, ponto 38)", () => {
  const estadoUmaLista = {
    stocksErrados: {
      lst1: {
        id: "lst1", nome: "19-09-2026", operador: "Ana", criadoEm: "2026-09-19T09:00:00.000Z", atualizadoEm: "2026-09-19T09:00:00.000Z",
        items: [
          { codigo: "123456", designacao: "Paracetamol 500mg", stockSistema: 10, stockContado: 8, motivo: "", motivoOutros: "", manual: false },
          { codigo: "", designacao: "Compressas esterilizadas", stockSistema: 5, stockContado: 5, motivo: "", motivoOutros: "", manual: true },
        ],
      },
    },
  };
  const estadoDuasListas = {
    stocksErrados: {
      lst1: { id: "lst1", nome: "Contagem Manhã", operador: "", criadoEm: "x", atualizadoEm: "x", items: [] },
      lst2: { id: "lst2", nome: "Contagem Tarde", operador: "", criadoEm: "x", atualizadoEm: "x", items: [] },
    },
  };
  const estadoSemListas = { stocksErrados: {} };

  test("criar_lista: sem parâmetros usa a data de hoje como nome (mesmo formato de todayLabel em stocks.html)", () => {
    const r = prepararAcao("stocks.criar_lista", {}, estadoSemListas);
    assert.equal(r.ok, true);
    const hoje = new Date();
    const esperado = `${String(hoje.getDate()).padStart(2, "0")}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${hoje.getFullYear()}`;
    assert.equal(r.plano.nome, esperado);
    assert.equal(r.plano.operador, "");
  });
  test("criar_lista: com nome e operador dados", () => {
    const r = prepararAcao("stocks.criar_lista", { nome: "Contagem extra", operador: "Rui" }, estadoSemListas);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Contagem extra/);
    assert.match(r.resumo, /Rui/);
    assert.deepEqual(r.plano, { tipo: "stocks.criar_lista", nome: "Contagem extra", operador: "Rui" });
  });

  test("apagar_lista: encontra por nome (substring) e avisa quantos produtos tem", () => {
    const r = prepararAcao("stocks.apagar_lista", { identificarLista: "19-09" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /2 produtos/);
    assert.deepEqual(r.plano, { tipo: "stocks.apagar_lista", listaId: "lst1", nome: "19-09-2026" });
  });
  test("apagar_lista: nenhuma lista a corresponder é recusado", () => {
    const r = prepararAcao("stocks.apagar_lista", { identificarLista: "não existe" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
  test("apagar_lista: mais do que uma correspondência pede para ser mais específico", () => {
    const r = prepararAcao("stocks.apagar_lista", { identificarLista: "Contagem" }, estadoDuasListas);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /mais do que uma/);
  });

  test("adicionar_produto: com exatamente uma lista criada, não exige identificarLista", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "Ibuprofeno 400mg" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, {
      tipo: "stocks.adicionar_produto", listaId: "lst1",
      item: { codigo: "", designacao: "Ibuprofeno 400mg", stockSistema: "", stockContado: "" },
    });
  });
  test("adicionar_produto: com código e stocks indicados", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "Aspirina", codigo: "999999", stockSistema: "3", stockContado: "1" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /sistema 3/);
    assert.match(r.resumo, /contado 1/);
    assert.equal(r.plano.item.stockSistema, 3);
    assert.equal(r.plano.item.stockContado, 1);
  });
  test("adicionar_produto: código já registado na lista é recusado (evita duplicar)", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "Paracetamol", codigo: "123456" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /já há um produto/i);
  });
  test("adicionar_produto: sem nome do produto é recusado", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "" }, estadoUmaLista);
    assert.equal(r.ok, false);
  });
  test("adicionar_produto: com duas listas e sem identificarLista, pede para ser específico (nunca adivinha)", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "Ibuprofeno" }, estadoDuasListas);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Há 2 listas/);
  });
  test("adicionar_produto: com duas listas mas identificarLista dado, resolve certo", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "Ibuprofeno", identificarLista: "Tarde" }, estadoDuasListas);
    assert.equal(r.ok, true);
    assert.equal(r.plano.listaId, "lst2");
  });
  test("adicionar_produto: sem nenhuma lista criada, pede para criar uma primeiro", () => {
    const r = prepararAcao("stocks.adicionar_produto", { nome: "Ibuprofeno" }, estadoSemListas);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /cria uma primeiro/);
  });

  test("remover_produto: encontra por nome (substring)", () => {
    const r = prepararAcao("stocks.remover_produto", { identificarProduto: "paracetamol" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, { tipo: "stocks.remover_produto", listaId: "lst1", codigo: "123456", designacao: "Paracetamol 500mg" });
  });
  test("remover_produto: encontra por código exato", () => {
    const r = prepararAcao("stocks.remover_produto", { identificarProduto: "123456" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.equal(r.plano.designacao, "Paracetamol 500mg");
  });
  test("remover_produto: também encontra um produto manual (sem código)", () => {
    const r = prepararAcao("stocks.remover_produto", { identificarProduto: "compressas" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.equal(r.plano.codigo, "");
    assert.equal(r.plano.designacao, "Compressas esterilizadas");
  });
  test("remover_produto: nenhuma correspondência é recusada", () => {
    const r = prepararAcao("stocks.remover_produto", { identificarProduto: "não existe" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada (Stocks Errados, ponto 38)", () => {
  function fakeDataStoreCompleto(estadoInicial) {
    let gravado = null;
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      _gravado: () => gravado,
    };
  }

  test("criar_lista: cria a lista quando ainda não há nenhuma (estado.stocksErrados em falta), credita criar_lista, omite o logo", async () => {
    const estado = { config: { logo: "xxx" } };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.criar_lista", nome: "19-09-2026", operador: "Ana" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["stocks", "criar_lista"]]);
    const gravado = ds._gravado();
    assert.equal(gravado.config.logo, undefined);
    const listas = Object.values(gravado.stocksErrados);
    assert.equal(listas.length, 1);
    assert.equal(listas[0].nome, "19-09-2026");
    assert.equal(listas[0].operador, "Ana");
    assert.deepEqual(listas[0].items, []);
  });

  test("criar_lista: preserva listas já existentes (não substitui)", async () => {
    const estado = { config: {}, stocksErrados: { lst1: { id: "lst1", nome: "Antiga", items: [] } } };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada({ tipo: "stocks.criar_lista", nome: "Nova", operador: "" }, { dataStore: ds });
    assert.equal(r.ok, true);
    const listas = ds._gravado().stocksErrados;
    assert.equal(Object.keys(listas).length, 2);
    assert.equal(listas.lst1.nome, "Antiga");
  });

  test("apagar_lista: remove a lista indicada, preserva as outras, credita apagar_lista", async () => {
    const estado = { config: {}, stocksErrados: { lst1: { id: "lst1", nome: "A", items: [] }, lst2: { id: "lst2", nome: "B", items: [] } } };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.apagar_lista", listaId: "lst1", nome: "A" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["stocks", "apagar_lista"]]);
    const listas = ds._gravado().stocksErrados;
    assert.equal(Object.keys(listas).length, 1);
    assert.ok(!listas.lst1);
    assert.ok(listas.lst2);
  });
  test("apagar_lista: lista já não existe devolve erro claro, não rebenta", async () => {
    const ds = fakeDataStoreCompleto({ config: {}, stocksErrados: {} });
    const r = await executarAcaoConfirmada({ tipo: "stocks.apagar_lista", listaId: "não-existe", nome: "X" }, { dataStore: ds });
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já não existe/);
  });

  test("adicionar_produto: regista o item como manual, no topo da lista, credita registar_item", async () => {
    const estado = { config: {}, stocksErrados: { lst1: { id: "lst1", nome: "A", items: [{ codigo: "111", designacao: "Já existente" }] } } };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.adicionar_produto", listaId: "lst1", item: { codigo: "222", designacao: "Novo produto", stockSistema: 4, stockContado: 2 } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["stocks", "registar_item"]]);
    const itens = ds._gravado().stocksErrados.lst1.items;
    assert.equal(itens.length, 2);
    assert.equal(itens[0].designacao, "Novo produto", "novo item fica no topo, como no módulo manual (unshift)");
    assert.equal(itens[0].manual, true);
    assert.equal(itens[0].stockSistema, 4);
    assert.equal(itens[1].designacao, "Já existente", "preserva o item já existente");
  });
  test("adicionar_produto: lista já não existe devolve erro claro", async () => {
    const ds = fakeDataStoreCompleto({ config: {}, stocksErrados: {} });
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.adicionar_produto", listaId: "não-existe", item: { codigo: "", designacao: "X", stockSistema: "", stockContado: "" } },
      { dataStore: ds }
    );
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já não existe/);
  });

  test("remover_produto: remove por código, preserva os outros itens, credita remover_item", async () => {
    const estado = {
      config: {},
      stocksErrados: { lst1: { id: "lst1", nome: "A", items: [{ codigo: "111", designacao: "Um" }, { codigo: "222", designacao: "Dois" }] } },
    };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.remover_produto", listaId: "lst1", codigo: "111", designacao: "Um" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["stocks", "remover_item"]]);
    const itens = ds._gravado().stocksErrados.lst1.items;
    assert.equal(itens.length, 1);
    assert.equal(itens[0].designacao, "Dois");
  });
  test("remover_produto: remove por designação quando não há código (produto manual)", async () => {
    const estado = { config: {}, stocksErrados: { lst1: { id: "lst1", nome: "A", items: [{ codigo: "", designacao: "Manual" }] } } };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.remover_produto", listaId: "lst1", codigo: "", designacao: "Manual" },
      { dataStore: ds }
    );
    assert.equal(r.ok, true);
    assert.equal(ds._gravado().stocksErrados.lst1.items.length, 0);
  });
  test("remover_produto: produto já não está na lista devolve erro claro", async () => {
    const ds = fakeDataStoreCompleto({ config: {}, stocksErrados: { lst1: { id: "lst1", nome: "A", items: [] } } });
    const r = await executarAcaoConfirmada(
      { tipo: "stocks.remover_produto", listaId: "lst1", codigo: "111", designacao: "X" },
      { dataStore: ds }
    );
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já não está/);
  });

  test("falha de rede em qualquer ação de stocks vira mensagem clara, nunca rebenta", async () => {
    const dsQueFalha = { async getEstadoCompleto() { throw new Error("rede em baixo"); } };
    const r1 = await executarAcaoConfirmada({ tipo: "stocks.criar_lista", nome: "X", operador: "" }, { dataStore: dsQueFalha });
    const r2 = await executarAcaoConfirmada({ tipo: "stocks.apagar_lista", listaId: "x", nome: "X" }, { dataStore: dsQueFalha });
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
  });
});

describe("farmaAcoes.js — prepararAcao (Listas de Inscrição, ponto 40)", () => {
  const estadoUmaLista = {
    documentos: {
      cdocs_listas_v1: {
        lst1: {
          id: "lst1", tipo: "minifaciais", nome: "Sessão de Minifaciais", data: "2026-10-01",
          inicio: "09:00", fim: "09:40", duracao: 20, responsavel: "", responsavelContacto: "",
          slots: [
            { id: "s1", horario: "09:00 – 09:20", utente: "", contacto: "", obs: "", bloqueado: false, extra: false },
            { id: "s2", horario: "09:20 – 09:40", utente: "Maria Silva", contacto: "912345678", obs: "", bloqueado: false, extra: false },
          ],
        },
      },
    },
  };
  const estadoDuasListas = {
    documentos: {
      cdocs_listas_v1: {
        lst1: { id: "lst1", tipo: "minifaciais", nome: "Sessão de Outubro", slots: [] },
        lst2: { id: "lst2", tipo: "formacao", nome: "Sessão de Novembro", slots: [] },
      },
    },
  };
  const estadoSemListas = { documentos: {} };

  test("criar_lista: sem parâmetros usa os valores por omissão (mesmos de createLista() em documentos.html)", () => {
    const r = prepararAcao("listas.criar_lista", {}, estadoSemListas);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano.dados, {
      tipo: "minifaciais", nome: "Sessão de Minifaciais", data: new Date().toISOString().slice(0, 10),
      inicio: "09:00", fim: "13:00", duracao: 20, responsavel: "", responsavelContacto: "",
    });
    assert.match(r.resumo, /12 horários/);
  });
  test("criar_lista: com valores dados, calcula o número de horários certo", () => {
    const r = prepararAcao("listas.criar_lista", { nome: "Workshop", tipo: "formacao", data: "2026-11-01", inicio: "10:00", fim: "11:00", duracao: 15, responsavel: "Dr. Costa" }, estadoSemListas);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /Workshop/);
    assert.match(r.resumo, /Formação/);
    assert.match(r.resumo, /4 horários/);
    assert.match(r.resumo, /Dr\. Costa/);
  });
  test("criar_lista: data inválida é recusada", () => {
    const r = prepararAcao("listas.criar_lista", { data: "01-11-2026" }, estadoSemListas);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Data inválida/);
  });
  test("criar_lista: hora de início depois da hora de fim é recusada", () => {
    const r = prepararAcao("listas.criar_lista", { inicio: "14:00", fim: "10:00" }, estadoSemListas);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /tem de ser antes/);
  });
  test("criar_lista: tipo desconhecido cai para minifaciais em vez de rebentar", () => {
    const r = prepararAcao("listas.criar_lista", { tipo: "disco-voador" }, estadoSemListas);
    assert.equal(r.ok, true);
    assert.equal(r.plano.dados.tipo, "minifaciais");
  });

  test("apagar_lista: encontra por nome (substring) e avisa quantas inscrições tem", () => {
    const r = prepararAcao("listas.apagar_lista", { identificarLista: "Minifaciais" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.match(r.resumo, /1 inscrição já registada/);
    assert.deepEqual(r.plano, { tipo: "listas.apagar_lista", listaId: "lst1", nome: "Sessão de Minifaciais" });
  });
  test("apagar_lista: nenhuma correspondência é recusada", () => {
    const r = prepararAcao("listas.apagar_lista", { identificarLista: "não existe" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
  test("apagar_lista: mais do que uma correspondência pede para ser mais específico", () => {
    const r = prepararAcao("listas.apagar_lista", { identificarLista: "Sessão" }, estadoDuasListas);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /mais do que uma/);
  });

  test("inscrever: sem indicar o horário, devolve os horários livres na própria mensagem (consulta primeiro, depois pergunta)", () => {
    const r = prepararAcao("listas.inscrever", { identificarLista: "Minifaciais", nome: "João Costa" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /09:00 – 09:20/, "só o horário livre (09:00–09:20) deve aparecer, não o já ocupado 09:20–09:40");
    assert.doesNotMatch(r.motivo, /09:20 – 09:40/);
    assert.match(r.motivo, /João Costa/);
  });
  test("inscrever: com o horário escolhido (resposta à pergunta anterior), prepara o plano certo", () => {
    const r = prepararAcao("listas.inscrever", { identificarLista: "Minifaciais", nome: "João Costa", horario: "09:00 – 09:20", contacto: "911111111" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, {
      tipo: "listas.inscrever", listaId: "lst1", slotId: "s1",
      dados: { utente: "João Costa", contacto: "911111111", obs: "" },
    });
  });
  test("inscrever: horário indicado só com a hora de início (sem o \"– fim\") também resolve", () => {
    const r = prepararAcao("listas.inscrever", { identificarLista: "Minifaciais", nome: "João Costa", horario: "09:00" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.equal(r.plano.slotId, "s1");
  });
  test("inscrever: horário indicado que já está ocupado é recusado, com a lista de horários livres", () => {
    const r = prepararAcao("listas.inscrever", { identificarLista: "Minifaciais", nome: "João Costa", horario: "09:20 – 09:40" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não é um horário livre/);
  });
  test("inscrever: sem nome do utente é recusado", () => {
    const r = prepararAcao("listas.inscrever", { identificarLista: "Minifaciais" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /nome do utente/);
  });
  test("inscrever: lista sem nenhum horário livre é recusado", () => {
    const estadoLotada = {
      documentos: { cdocs_listas_v1: { lst1: { id: "lst1", nome: "Cheia", slots: [{ id: "s1", horario: "09:00 – 09:20", utente: "X", bloqueado: false }] } } },
    };
    const r = prepararAcao("listas.inscrever", { identificarLista: "Cheia", nome: "Y" }, estadoLotada);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não há horários livres/);
  });

  test("remover_inscricao: encontra por nome (substring)", () => {
    const r = prepararAcao("listas.remover_inscricao", { identificarLista: "Minifaciais", identificarUtente: "Maria" }, estadoUmaLista);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plano, { tipo: "listas.remover_inscricao", listaId: "lst1", slotId: "s2", utente: "Maria Silva" });
  });
  test("remover_inscricao: nenhuma inscrição a corresponder é recusada", () => {
    const r = prepararAcao("listas.remover_inscricao", { identificarLista: "Minifaciais", identificarUtente: "não existe" }, estadoUmaLista);
    assert.equal(r.ok, false);
    assert.match(r.motivo, /Não encontrei/);
  });
});

describe("farmaAcoes.js — executarAcaoConfirmada (Listas de Inscrição, ponto 40)", () => {
  function fakeDataStoreCompleto(estadoInicial) {
    let gravado = null;
    return {
      async getEstadoCompleto() { return estadoInicial; },
      async gravarEstadoCompleto(novoEstado) { gravado = novoEstado; },
      _gravado: () => gravado,
    };
  }

  test("criar_lista: cria a lista com os horários gerados, credita gerar_lista_inscricao, omite o logo", async () => {
    const estado = { config: { logo: "xxx" }, documentos: {} };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "listas.criar_lista", dados: { tipo: "minifaciais", nome: "Sessão A", data: "2026-10-01", inicio: "09:00", fim: "09:40", duracao: 20, responsavel: "", responsavelContacto: "" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["documentos", "gerar_lista_inscricao"]]);
    const gravado = ds._gravado();
    assert.equal(gravado.config.logo, undefined);
    const listas = Object.values(gravado.documentos.cdocs_listas_v1);
    assert.equal(listas.length, 1);
    assert.equal(listas[0].nome, "Sessão A");
    assert.equal(listas[0].slots.length, 2);
    assert.equal(listas[0].slots[0].horario, "09:00 – 09:20");
  });
  test("criar_lista: preserva listas já existentes e as restantes chaves de documentos (não substitui)", async () => {
    const estado = { config: {}, documentos: { cdocs_listas_v1: { lst1: { id: "lst1", nome: "Antiga", slots: [] } }, cdocs_folders_v1: { fx: "manter" } } };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada(
      { tipo: "listas.criar_lista", dados: { tipo: "minifaciais", nome: "Nova", data: "2026-10-01", inicio: "09:00", fim: "09:20", duracao: 20, responsavel: "", responsavelContacto: "" } },
      { dataStore: ds }
    );
    assert.equal(r.ok, true);
    const gravado = ds._gravado();
    assert.equal(Object.keys(gravado.documentos.cdocs_listas_v1).length, 2);
    assert.equal(gravado.documentos.cdocs_listas_v1.lst1.nome, "Antiga");
    assert.deepEqual(gravado.documentos.cdocs_folders_v1, { fx: "manter" }, "outras chaves de documentos têm de ficar intactas");
  });

  test("apagar_lista: remove a lista indicada, preserva as outras, credita eliminar_lista_inscricao", async () => {
    const estado = { config: {}, documentos: { cdocs_listas_v1: { lst1: { id: "lst1", nome: "A", slots: [] }, lst2: { id: "lst2", nome: "B", slots: [] } } } };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "listas.apagar_lista", listaId: "lst1", nome: "A" },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [["documentos", "eliminar_lista_inscricao"]]);
    const listas = ds._gravado().documentos.cdocs_listas_v1;
    assert.equal(Object.keys(listas).length, 1);
    assert.ok(!listas.lst1);
    assert.ok(listas.lst2);
  });
  test("apagar_lista: lista já não existe devolve erro claro, não rebenta", async () => {
    const ds = fakeDataStoreCompleto({ config: {}, documentos: { cdocs_listas_v1: {} } });
    const r = await executarAcaoConfirmada({ tipo: "listas.apagar_lista", listaId: "não-existe", nome: "X" }, { dataStore: ds });
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já não existe/);
  });

  test("inscrever: preenche o slot com os dados do utente, NÃO credita registarUso (espelha updateSlot() no módulo)", async () => {
    const estado = {
      config: {},
      documentos: { cdocs_listas_v1: { lst1: { id: "lst1", nome: "A", slots: [{ id: "s1", horario: "09:00 – 09:20", utente: "", contacto: "", obs: "", bloqueado: false }] } } },
    };
    const ds = fakeDataStoreCompleto(estado);
    const usos = [];
    const r = await executarAcaoConfirmada(
      { tipo: "listas.inscrever", listaId: "lst1", slotId: "s1", dados: { utente: "João Costa", contacto: "911111111", obs: "" } },
      { dataStore: ds, registarUso: (mod, tarefa) => usos.push([mod, tarefa]) }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(usos, [], "listas.inscrever não deve chamar registarUso, tal como updateSlot() em documentos.html");
    const slot = ds._gravado().documentos.cdocs_listas_v1.lst1.slots[0];
    assert.equal(slot.utente, "João Costa");
    assert.equal(slot.contacto, "911111111");
  });
  test("inscrever: horário já ocupado entretanto (corrida) devolve erro claro em vez de sobrescrever", async () => {
    const estado = {
      config: {},
      documentos: { cdocs_listas_v1: { lst1: { id: "lst1", nome: "A", slots: [{ id: "s1", horario: "09:00 – 09:20", utente: "Outra Pessoa", contacto: "", obs: "", bloqueado: false }] } } },
    };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada(
      { tipo: "listas.inscrever", listaId: "lst1", slotId: "s1", dados: { utente: "João Costa", contacto: "", obs: "" } },
      { dataStore: ds }
    );
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já foi ocupado/);
  });
  test("inscrever: lista já não existe devolve erro claro", async () => {
    const ds = fakeDataStoreCompleto({ config: {}, documentos: { cdocs_listas_v1: {} } });
    const r = await executarAcaoConfirmada(
      { tipo: "listas.inscrever", listaId: "não-existe", slotId: "s1", dados: { utente: "X", contacto: "", obs: "" } },
      { dataStore: ds }
    );
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já não existe/);
  });

  test("remover_inscricao: liberta o slot (fica sem utente), preserva os outros", async () => {
    const estado = {
      config: {},
      documentos: {
        cdocs_listas_v1: {
          lst1: {
            id: "lst1", nome: "A",
            slots: [
              { id: "s1", horario: "09:00 – 09:20", utente: "Maria Silva", contacto: "912345678", obs: "nota", bloqueado: false },
              { id: "s2", horario: "09:20 – 09:40", utente: "Outro", contacto: "", obs: "", bloqueado: false },
            ],
          },
        },
      },
    };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada({ tipo: "listas.remover_inscricao", listaId: "lst1", slotId: "s1", utente: "Maria Silva" }, { dataStore: ds });
    assert.equal(r.ok, true);
    const slots = ds._gravado().documentos.cdocs_listas_v1.lst1.slots;
    assert.equal(slots[0].utente, "");
    assert.equal(slots[0].contacto, "");
    assert.equal(slots[1].utente, "Outro", "o outro slot preservado intacto");
  });
  test("remover_inscricao: horário já estava livre entretanto devolve erro claro", async () => {
    const estado = { config: {}, documentos: { cdocs_listas_v1: { lst1: { id: "lst1", nome: "A", slots: [{ id: "s1", horario: "09:00 – 09:20", utente: "", bloqueado: false }] } } } };
    const ds = fakeDataStoreCompleto(estado);
    const r = await executarAcaoConfirmada({ tipo: "listas.remover_inscricao", listaId: "lst1", slotId: "s1", utente: "Alguém" }, { dataStore: ds });
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /já não tinha ninguém/);
  });

  test("falha de rede em qualquer ação de listas vira mensagem clara, nunca rebenta", async () => {
    const dsQueFalha = { async getEstadoCompleto() { throw new Error("rede em baixo"); } };
    const r1 = await executarAcaoConfirmada({ tipo: "listas.criar_lista", dados: { tipo: "minifaciais", nome: "X", data: "2026-10-01", inicio: "09:00", fim: "09:20", duracao: 20, responsavel: "", responsavelContacto: "" } }, { dataStore: dsQueFalha });
    const r2 = await executarAcaoConfirmada({ tipo: "listas.apagar_lista", listaId: "x", nome: "X" }, { dataStore: dsQueFalha });
    const r3 = await executarAcaoConfirmada({ tipo: "listas.inscrever", listaId: "x", slotId: "s1", dados: { utente: "X", contacto: "", obs: "" } }, { dataStore: dsQueFalha });
    const r4 = await executarAcaoConfirmada({ tipo: "listas.remover_inscricao", listaId: "x", slotId: "s1", utente: "X" }, { dataStore: dsQueFalha });
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    assert.equal(r3.ok, false);
    assert.equal(r4.ok, false);
  });
});

describe("farmaAcoes.js — construirMensagemAutoCorrecao (ponto 41)", () => {
  test("inclui o motivo original, para o modelo saber exatamente o que corrigir", () => {
    const msg = construirMensagemAutoCorrecao('Há 2 listas de Stocks Errados criadas — diz o nome da lista onde queres isto.');
    assert.match(msg, /Há 2 listas de Stocks Errados criadas/);
  });
});

describe("farmaAcoes.js — resolverComRaciocinio (ponto 41, raciocínio em vários passos)", () => {
  /** Fila de respostas predefinidas, uma por chamada — simula o "cérebro"
   * (WebLLM) sem precisar de um motor real. Regista as chamadas feitas
   * (pergunta + tamanho do histórico recebido) para os testes conseguirem
   * confirmar que o contexto cresce corretamente a cada tentativa. */
  function fakeCerebro(respostas) {
    const chamadas = [];
    let i = 0;
    return {
      chamadas,
      perguntarFn: async (pergunta, historico) => {
        chamadas.push({ pergunta, tamanhoHistorico: historico.length });
        const r = respostas[i];
        i++;
        return r;
      },
    };
  }

  const estadoDuasListasStocks = {
    stocksErrados: {
      lst1: { id: "lst1", nome: "Contagem Manhã", items: [] },
      lst2: { id: "lst2", nome: "Contagem Tarde", items: [] },
    },
  };

  test("sucesso à primeira tentativa: não chama o modelo uma segunda vez", async () => {
    const { perguntarFn, chamadas } = fakeCerebro([
      '{"tipo":"acao","acaoId":"stocks.apagar_lista","parametros":{"identificarLista":"Manhã"}}',
    ]);
    const r = await resolverComRaciocinio("apaga a lista da manhã", { perguntarFn, estado: estadoDuasListasStocks });
    assert.equal(r.tipo, "acao");
    assert.equal(r.plano.listaId, "lst1");
    assert.equal(r.tentativas, 1);
    assert.equal(chamadas.length, 1);
  });

  test("auto-corrige sozinha: 1ª tentativa ambígua, 2ª já específica, resolve sem incomodar o operador", async () => {
    // identificarLista é OPCIONAL em stocks.adicionar_produto — passa a validação de
    // interpretarRespostaLLM mesmo em falta, e é só prepararAcao que recusa por
    // ambiguidade (ao contrário de stocks.apagar_lista, onde identificarLista é
    // obrigatório e o pedido nem chegaria a ser interpretado como "acao").
    const { perguntarFn, chamadas } = fakeCerebro([
      '{"tipo":"acao","acaoId":"stocks.adicionar_produto","parametros":{"nome":"Ibuprofeno 400mg"}}', // sem identificarLista -> ambíguo (2 listas)
      '{"tipo":"acao","acaoId":"stocks.adicionar_produto","parametros":{"nome":"Ibuprofeno 400mg","identificarLista":"Tarde"}}',
    ]);
    const r = await resolverComRaciocinio("regista Ibuprofeno na lista de stocks", { perguntarFn, estado: estadoDuasListasStocks });
    assert.equal(r.tipo, "acao");
    assert.equal(r.plano.listaId, "lst2");
    assert.equal(r.tentativas, 2);
    assert.equal(chamadas.length, 2);
    // a 2ª chamada tem de trazer o motivo da recusa, para o modelo saber o que corrigir
    assert.match(chamadas[1].pergunta, /Há 2 listas/);
    // e o histórico enviado na 2ª chamada já inclui a pergunta original + a resposta (falhada) da 1ª
    assert.ok(chamadas[1].tamanhoHistorico >= 2, "histórico da 2ª tentativa tem de incluir a 1ª troca");
  });

  test("esgota as tentativas: devolve o último motivo como texto, tal como acontecia antes desta peça", async () => {
    const { perguntarFn, chamadas } = fakeCerebro([
      '{"tipo":"acao","acaoId":"stocks.adicionar_produto","parametros":{"nome":"Ibuprofeno"}}',
      '{"tipo":"acao","acaoId":"stocks.adicionar_produto","parametros":{"nome":"Ibuprofeno"}}',
      '{"tipo":"acao","acaoId":"stocks.adicionar_produto","parametros":{"nome":"Ibuprofeno"}}',
    ]);
    const r = await resolverComRaciocinio("regista Ibuprofeno na lista de stocks", { perguntarFn, estado: estadoDuasListasStocks, maxTentativas: 3 });
    assert.equal(r.tipo, "resposta");
    assert.match(r.texto, /Há 2 listas/);
    assert.equal(r.tentativas, 3);
    assert.equal(chamadas.length, 3);
  });

  test("resposta em texto logo à primeira tentativa não entra no ciclo de correção", async () => {
    const { perguntarFn, chamadas } = fakeCerebro([
      '{"tipo":"resposta","texto":"Não sei fazer isso."}',
    ]);
    const r = await resolverComRaciocinio("faz-me um café", { perguntarFn, estado: {} });
    assert.equal(r.tipo, "resposta");
    assert.equal(r.texto, "Não sei fazer isso.");
    assert.equal(chamadas.length, 1);
  });

  test("formato inválido (sem JSON reconhecível) também é corrigido automaticamente", async () => {
    const { perguntarFn, chamadas } = fakeCerebro([
      "desculpe, não percebi bem a pergunta", // sem JSON nenhum
      '{"tipo":"resposta","texto":"Agora sim, não sei fazer isso."}',
    ]);
    const r = await resolverComRaciocinio("apaga a lista de stocks", { perguntarFn, estado: {} });
    assert.equal(r.tipo, "resposta");
    assert.equal(r.texto, "Agora sim, não sei fazer isso.");
    assert.equal(chamadas.length, 2);
    assert.match(chamadas[1].pergunta, /formato esperado/);
  });

  test("formato inválido esgota as tentativas devolve tipo \"invalido\" (sem inventar resposta)", async () => {
    const { perguntarFn } = fakeCerebro([
      "isto não é JSON",
      "isto continua a não ser JSON",
    ]);
    const r = await resolverComRaciocinio("apaga a lista de stocks", { perguntarFn, estado: {}, maxTentativas: 2 });
    assert.equal(r.tipo, "invalido");
    assert.equal(r.tentativas, 2);
  });

  test("onTentativa é chamado antes de cada pedido ao modelo, incluindo a 1ª tentativa", async () => {
    const { perguntarFn } = fakeCerebro([
      '{"tipo":"acao","acaoId":"stocks.apagar_lista","parametros":{}}',
      '{"tipo":"acao","acaoId":"stocks.apagar_lista","parametros":{"identificarLista":"Tarde"}}',
    ]);
    const tentativasVistas = [];
    await resolverComRaciocinio("apaga a lista de stocks", {
      perguntarFn, estado: estadoDuasListasStocks,
      onTentativa: (tentativa, max) => tentativasVistas.push([tentativa, max]),
    });
    assert.deepEqual(tentativasVistas, [[1, 3], [2, 3]]);
  });

  test("carregarEstadoParaAcao é chamado com o acaoId, para ações que precisam de dados extra (ex.: catálogo)", async () => {
    const { perguntarFn } = fakeCerebro([
      '{"tipo":"acao","acaoId":"catalogo.adicionar_produto","parametros":{"nome":"Creme X"}}',
    ]);
    const chamadasCarregar = [];
    const r = await resolverComRaciocinio("adiciona o produto Creme X ao catálogo", {
      perguntarFn, estado: { catalogoProdutos: [] },
      carregarEstadoParaAcao: async (acaoId, estado) => { chamadasCarregar.push(acaoId); return estado; },
    });
    assert.equal(r.tipo, "acao");
    assert.deepEqual(chamadasCarregar, ["catalogo.adicionar_produto"]);
  });

  test("brutoFinal devolve sempre a última resposta bruta do modelo (para gravar no histórico de longo prazo)", async () => {
    const { perguntarFn } = fakeCerebro([
      '{"tipo":"acao","acaoId":"stocks.apagar_lista","parametros":{}}',
      '{"tipo":"acao","acaoId":"stocks.apagar_lista","parametros":{"identificarLista":"Tarde"}}',
    ]);
    const r = await resolverComRaciocinio("apaga a lista de stocks", { perguntarFn, estado: estadoDuasListasStocks });
    assert.equal(r.brutoFinal, '{"tipo":"acao","acaoId":"stocks.apagar_lista","parametros":{"identificarLista":"Tarde"}}');
  });
});
