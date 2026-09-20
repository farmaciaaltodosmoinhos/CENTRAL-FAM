/**
 * src/ui/farmaMiniChat.js — ponto 29 (continuação), "mini-chat" da FARMA IA na
 * página inicial da Central. Pedido do Ivo: "preciso também que na página
 * inicial da central tenha um mini chat onde posso conversar com a farma".
 *
 * Decisão de arquitetura: em vez de integrar isto no vdom/store/actions do
 * `app.js` (o "esqueleto" principal, partilhado por todos os ecrãs da
 * Central), este widget é propositadamente autónomo — o mesmo padrão de
 * DOM direto + import de `src/farmaIa.js` já usado em `modulos/farma-ia.html`,
 * só que como uma bolha flutuante fixa. Isto reduz drasticamente o risco de
 * mexer no código que TODOS os ecrãs da app dependem, à custa de não estar
 * "reativo" ao store central — o que é uma troca aceitável para uma pergunta
 * rápida sem sair da página onde se está. Continua sem nenhuma IA externa:
 * mesmo motor de regras que o módulo FARMA IA completo usa.
 */
import { makeDataStore } from "../db.js";
import { getToken } from "../authClient.js";
import { escapeHtml } from "../utils.js";
import { responderPergunta, registarPerguntaNaoReconhecida, ensinarAlias } from "../farmaIa.js";
import { carregarUsoPeriodo, isoDia } from "../usoLeitura.js";

const ESTILO = `
.farma-mini-bolha{position:fixed;right:20px;bottom:20px;width:52px;height:52px;border-radius:50%;
  background:#1f7a4d;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;
  font-size:22px;z-index:9000;display:flex;align-items:center;justify-content:center;}
.farma-mini-bolha:hover{background:#145536;}
.farma-mini-painel{position:fixed;right:20px;bottom:84px;width:320px;max-width:calc(100vw - 40px);
  max-height:440px;background:#fff;border:1px solid #d3e4da;border-radius:12px;
  box-shadow:0 8px 28px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden;z-index:9000;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;}
.farma-mini-painel.aberto{display:flex;}
.farma-mini-cabecalho{background:#145536;color:#fff;padding:10px 12px;font-size:13.5px;font-weight:600;
  display:flex;justify-content:space-between;align-items:center;}
.farma-mini-cabecalho button{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;opacity:.85;}
.farma-mini-log{flex:1;overflow-y:auto;padding:10px;font-size:13px;display:flex;flex-direction:column;gap:6px;}
.farma-mini-msg{padding:7px 10px;border-radius:8px;max-width:88%;white-space:pre-wrap;line-height:1.35;}
.farma-mini-msg.pergunta{align-self:flex-end;background:#1f7a4d;color:#fff;}
.farma-mini-msg.resposta{align-self:flex-start;background:#eef4f0;color:#1c2b24;}
.farma-mini-form{display:flex;border-top:1px solid #e2ece5;padding:8px;gap:6px;}
.farma-mini-form input{flex:1;border:1px solid #d3e4da;border-radius:6px;padding:7px 9px;font-size:13px;}
.farma-mini-form button{background:#1f7a4d;color:#fff;border:none;border-radius:6px;padding:0 12px;
  font-size:13px;cursor:pointer;font-weight:600;}
`;

function montarDom() {
  const style = document.createElement("style");
  style.textContent = ESTILO;
  document.head.appendChild(style);

  const bolha = document.createElement("button");
  bolha.className = "farma-mini-bolha";
  bolha.type = "button";
  bolha.title = "Falar com a FARMA";
  bolha.textContent = "💬";

  const painel = document.createElement("div");
  painel.className = "farma-mini-painel";
  painel.innerHTML = `
    <div class="farma-mini-cabecalho">
      <span>FARMA IA</span>
      <button type="button" data-acao="fechar" aria-label="Fechar">✕</button>
    </div>
    <div class="farma-mini-log"></div>
    <form class="farma-mini-form">
      <input type="text" placeholder="Pergunta à FARMA…" autocomplete="off" />
      <button type="submit">Enviar</button>
    </form>
  `;

  document.body.appendChild(bolha);
  document.body.appendChild(painel);
  return { bolha, painel };
}

export function initFarmaMiniChat() {
  if (!getToken()) return; // sem sessão — nada a mostrar (ecrã de login, etc.)
  if (document.querySelector(".farma-mini-bolha")) return; // já inicializado

  const dataStore = makeDataStore();
  const { bolha, painel } = montarDom();
  const log = painel.querySelector(".farma-mini-log");
  const form = painel.querySelector(".farma-mini-form");
  const input = form.querySelector("input");
  let jaCumprimentou = false;
  let diasUsoCache = null;

  function addMsg(texto, tipo) {
    const div = document.createElement("div");
    div.className = "farma-mini-msg " + tipo;
    div.textContent = texto;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  async function obterDiasUso() {
    if (diasUsoCache) return diasUsoCache;
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
    try { diasUsoCache = await carregarUsoPeriodo(dataStore, isoDia(inicio), isoDia(hoje)); }
    catch (e) { diasUsoCache = {}; }
    return diasUsoCache;
  }

  function abrir() {
    painel.classList.add("aberto");
    if (!jaCumprimentou) {
      jaCumprimentou = true;
      const cache = window.ModuleChrome && window.ModuleChrome.getCachedBranding ? window.ModuleChrome.getCachedBranding() : null;
      const nome = cache && cache.nomeFarmacia;
      addMsg(nome ? `Olá! Sou a FARMA, da ${nome}. Em que posso ajudar?` : "Olá! Sou a FARMA. Em que posso ajudar?", "resposta");
      input.focus();
    }
  }

  bolha.addEventListener("click", () => {
    if (painel.classList.contains("aberto")) painel.classList.remove("aberto");
    else abrir();
  });
  painel.querySelector('[data-acao="fechar"]').addEventListener("click", () => painel.classList.remove("aberto"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pergunta = input.value.trim();
    if (!pergunta) return;
    addMsg(pergunta, "pergunta");
    input.value = "";
    try {
      const estado = await dataStore.getEstadoCompleto();
      const memoria = estado.config?.farmaIaMemoria || null;
      const diasUso = await obterDiasUso();
      const { resposta, intentId } = responderPergunta(pergunta, estado, { diasUso, memoria });
      addMsg(resposta, "resposta");
      if (!intentId && memoria) {
        try {
          await dataStore.setConfig("farmaIaMemoria", registarPerguntaNaoReconhecida(memoria, pergunta, new Date()));
        } catch (e) { /* aprendizagem é um extra — falha aqui nunca bloqueia a resposta já dada */ }
      }
    } catch (err) {
      addMsg("Não foi possível consultar os dados neste momento. Tente novamente.", "resposta");
    }
  });
}
