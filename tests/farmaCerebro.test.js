import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { perguntarAoCerebro } from "../src/ui/farmaCerebro.js";

/** Só testamos `perguntarAoCerebro` aqui — o resto de farmaCerebro.js
 * (carregarBibliotecaWebLLM/listarModelosDisponiveis/carregarModeloLocal)
 * depende de WebGPU/rede reais (WebLLM), por isso foi validado manualmente
 * num protótipo isolado e ao vivo no PC do Ivo (ver arquitetura-decisoes.md,
 * pontos 29/30), não por teste automatizado. `perguntarAoCerebro` em si é
 * só construção da lista de mensagens — isso sim é puro e testável com um
 * `engine` falso. */
function fakeEngine(respostaTexto) {
  const chamadas = [];
  return {
    chat: {
      completions: {
        create: async (args) => {
          chamadas.push(args);
          return { choices: [{ message: { content: respostaTexto } }] };
        },
      },
    },
    _chamadas: () => chamadas,
  };
}

describe("farmaCerebro.js — perguntarAoCerebro (histórico, ponto 32)", () => {
  test("sem histórico, só manda a mensagem de sistema e a pergunta", async () => {
    const engine = fakeEngine('{"tipo":"resposta","texto":"ok"}');
    await perguntarAoCerebro(engine, "SISTEMA", "olá");
    const [args] = engine._chamadas();
    assert.deepEqual(args.messages, [
      { role: "system", content: "SISTEMA" },
      { role: "user", content: "olá" },
    ]);
  });

  test("com histórico, as mensagens anteriores entram entre o sistema e a pergunta atual", async () => {
    const engine = fakeEngine('{"tipo":"resposta","texto":"ok"}');
    const historico = [
      { role: "user", content: "cria um pedido para a Ana" },
      { role: "assistant", content: '{"tipo":"resposta","texto":"Falta o medicamento, qual é?"}' },
    ];
    await perguntarAoCerebro(engine, "SISTEMA", "Creme X", historico);
    const [args] = engine._chamadas();
    assert.deepEqual(args.messages, [
      { role: "system", content: "SISTEMA" },
      { role: "user", content: "cria um pedido para a Ana" },
      { role: "assistant", content: '{"tipo":"resposta","texto":"Falta o medicamento, qual é?"}' },
      { role: "user", content: "Creme X" },
    ]);
  });

  test("devolve o texto da resposta, ou \"\" se vier vazio", async () => {
    const engine = fakeEngine("resposta qualquer");
    const r = await perguntarAoCerebro(engine, "SISTEMA", "pergunta");
    assert.equal(r, "resposta qualquer");
    const engineVazio = { chat: { completions: { create: async () => ({ choices: [] }) } } };
    const r2 = await perguntarAoCerebro(engineVazio, "SISTEMA", "pergunta");
    assert.equal(r2, "");
  });
});
