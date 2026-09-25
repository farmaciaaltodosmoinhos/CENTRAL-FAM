/**
 * src/ui/farmaCerebro.js — ponto 30. Carregamento do "cérebro" local da
 * FARMA: um modelo de IA pequeno a correr 100% dentro do browser via
 * WebLLM/WebGPU (mlc-ai/web-llm), sem nenhuma API externa e sem nada a sair
 * do computador da farmácia — decisão do Ivo, ver arquitetura-decisoes.md
 * ponto 29. Cada computador que usa a Central descarrega e corre a sua
 * própria cópia; nunca fica dependente de um único PC.
 *
 * Validado num protótipo isolado nesta sessão antes de entrar aqui: o
 * padrão de múltiplas fontes com timeout (uma CDN pode ter uma versão em
 * falta ou estar em baixo — mesma lição do bug do Chart.js, ponto 28), e a
 * necessidade de excluir modelos de "embedding" da lista (servem para
 * pesquisa semântica, não para conversar — rebentam com um erro claro se
 * usados aqui).
 *
 * Fica registado um risco real ainda por resolver: no protótipo, o
 * download de um modelo funcionou uma vez e falhou noutra por erro de rede,
 * no mesmo PC/sessão — carregarModeloLocal() propaga esse erro tal como
 * veio (a UI que chama é responsável por mostrar uma mensagem clara e
 * permitir tentar de novo; não há aqui nenhuma lógica de novas tentativas
 * automáticas ainda).
 */

const FONTES_WEBLLM = [
  "https://esm.run/@mlc-ai/web-llm",
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm",
];
const TIMEOUT_POR_FONTE_MS = 20000;

let webllmCache = null;

function comTimeout(promessa, ms, rotulo) {
  return Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`"${rotulo}" não respondeu em ${ms / 1000}s (timeout)`)), ms)),
  ]);
}

async function carregarBibliotecaWebLLM() {
  if (webllmCache) return webllmCache;
  let ultimoErro = null;
  for (const url of FONTES_WEBLLM) {
    try {
      webllmCache = await comTimeout(import(/* @vite-ignore */ url), TIMEOUT_POR_FONTE_MS, url);
      return webllmCache;
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro || new Error("Não foi possível carregar a biblioteca WebLLM de nenhuma fonte.");
}

function naoEhModeloDeConversa(webllm, m) {
  const id = (m.model_id || "").toLowerCase();
  const pareceEmbedding = /embed|bge-|gte-|e5-/.test(id);
  const tipoEmbedding = webllm.ModelType && m.model_type === webllm.ModelType.embedding;
  return pareceEmbedding || tipoEmbedding;
}

/** Lista os modelos de conversa disponíveis (exclui embeddings), do mais
 * pequeno/rápido para o maior, com o tamanho aproximado em GB. */
export async function listarModelosDisponiveis() {
  const webllm = await carregarBibliotecaWebLLM();
  const lista = webllm.prebuiltAppConfig.model_list
    .filter(m => typeof m.vram_required_MB === "number" && m.vram_required_MB <= 3600 && !naoEhModeloDeConversa(webllm, m))
    .sort((a, b) => a.vram_required_MB - b.vram_required_MB)
    .map(m => ({ id: m.model_id, tamanhoGB: +(m.vram_required_MB / 1024).toFixed(1) }));
  return lista.length ? lista : webllm.prebuiltAppConfig.model_list
    .filter(m => !naoEhModeloDeConversa(webllm, m)).slice(0, 10)
    .map(m => ({ id: m.model_id, tamanhoGB: null }));
}

/** Carrega (descarrega, se for a 1ª vez neste browser) e inicializa o
 * modelo escolhido. `onProgress(texto, fracao01)` é chamado várias vezes
 * durante o download/compilação, para a UI mostrar uma barra de progresso. */
export async function carregarModeloLocal(modeloId, onProgress) {
  const webllm = await carregarBibliotecaWebLLM();
  return webllm.CreateMLCEngine(modeloId, {
    initProgressCallback: (report) => {
      if (onProgress) onProgress(report.text || "", report.progress || 0);
    },
  });
}

/** Uma pergunta ao motor já carregado (sem streaming — precisamos da
 * resposta completa antes de a poder interpretar como JSON).
 *
 * `historico` (opcional, ponto 32) — mensagens anteriores desta conversa
 * `[{role:"user"|"assistant", content}, ...]`, para a FARMA conseguir
 * "perguntar quando falta informação" e usar a resposta seguinte: sem
 * histórico, cada pergunta era interpretada isolada, por isso uma resposta
 * como "912345678" a seguir a "falta o telefone, qual é?" não tinha
 * contexto nenhum. Quem chama é responsável por limitar o tamanho do
 * histórico (ver farma-ia.html) — modelos pequenos têm uma janela de
 * contexto reduzida. */
export async function perguntarAoCerebro(engine, promptSistema, pergunta, historico = []) {
  const resposta = await engine.chat.completions.create({
    messages: [
      { role: "system", content: promptSistema },
      ...historico,
      { role: "user", content: pergunta },
    ],
  });
  return resposta.choices?.[0]?.message?.content || "";
}
