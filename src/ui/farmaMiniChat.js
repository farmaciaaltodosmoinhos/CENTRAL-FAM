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
// ponto 46: o mini-chat passa a saber EXECUTAR ações, não só responder
// perguntas — pedido explícito do Ivo ("liga directamente o motor de ações
// da farma"). Antes desta peça, o mini-chat nunca importava nada de
// farmaAcoes.js: um pedido de ação escrito na bolha era estruturalmente
// impossível de cumprir, fosse qual fosse o estado do resto da app (ver
// arquitetura-decisoes.md, ponto 46, para a investigação completa). Reusa
// exatamente o mesmo motor já testado do módulo FARMA IA completo — nunca
// duplica a lógica de validação/execução, só o reconhecimento do pedido
// (farmaAcoesIntent.js, sem IA nenhuma) e o cartão de confirmação.
import { prepararAcao, executarAcaoConfirmada } from "../farmaAcoes.js";
import { reconhecerAcaoDeterministica } from "../farmaAcoesIntent.js";
import { carregarCatalogoEfetivo } from "../produtosCatalogo.js";

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
.farma-mini-acao{align-self:flex-start;max-width:92%;background:#fff;border:1px solid #cfe0d7;border-radius:8px;
  padding:8px 10px;font-size:12.5px;line-height:1.35;}
.farma-mini-acao-botoes{display:flex;gap:6px;margin-top:8px;}
.farma-mini-acao-botoes button{border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:600;}
.farma-mini-acao-botoes .confirmar{background:#1f7a4d;color:#fff;}
.farma-mini-acao-botoes .cancelar{background:#eee;color:#333;}
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
      <span class="farma-mini-nome">FARMA IA</span>
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
  let nomeAssistenteCache = null; // ponto 46 — mesma config lida pelo módulo FARMA IA completo (config.farmaNomeAssistente)

  function addMsg(texto, tipo) {
    const div = document.createElement("div");
    div.className = "farma-mini-msg " + tipo;
    div.textContent = texto;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  // Mesmas chaves de localStorage já usadas pelos botões manuais de
  // Manipulados/AUE (ver modulos/manipulados.html `getEmailSettings`,
  // modulos/aue.html) — localStorage é partilhado por toda a origem, por
  // isso é seguro lê-las diretamente daqui, sem duplicar a escrita.
  function obterEmailDestinoOrcamentoLocal() {
    try { return (JSON.parse(localStorage.getItem("famam_email_settings")) || {}).dest || ""; }
    catch (e) { return ""; }
  }
  function obterContactosArmazenistaLocal() {
    try { return (JSON.parse(localStorage.getItem("aue_email_settings")) || {}).armazenistaContacts || {}; }
    catch (e) { return {}; }
  }

  // ponto 46 — mesmo cartão "Confirmar/Cancelar" de sempre (farma-ia.html),
  // versão compacta para caber na bolha. Nunca executa nada sozinho.
  function mostrarCartaoAcao(resumo, plano) {
    const card = document.createElement("div");
    card.className = "farma-mini-acao";
    card.innerHTML = `<div>${escapeHtml(resumo)}</div><div class="farma-mini-acao-botoes">
      <button type="button" class="confirmar">Confirmar</button>
      <button type="button" class="cancelar">Cancelar</button></div>`;
    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
    card.querySelector(".cancelar").addEventListener("click", () => card.remove());
    card.querySelector(".confirmar").addEventListener("click", async () => {
      card.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const r = await executarAcaoConfirmada(plano, {
          dataStore,
          registarUso: window.ModuleChrome && window.ModuleChrome.registarUso ? window.ModuleChrome.registarUso : () => {},
          emailDestinoOrcamento: obterEmailDestinoOrcamentoLocal(),
          contactosArmazenista: obterContactosArmazenistaLocal(),
        });
        card.remove();
        addMsg(r.mensagem, "resposta");
        if (r.abrirEmail) {
          // nunca enviado sozinho pela FARMA — só abre o programa de email
          // do operador já preenchido, exatamente como em farma-ia.html.
          let mailto = `mailto:${encodeURIComponent(r.abrirEmail.to)}?subject=${encodeURIComponent(r.abrirEmail.subject)}&body=${encodeURIComponent(r.abrirEmail.body)}`;
          if (r.abrirEmail.cc) mailto += `&cc=${encodeURIComponent(r.abrirEmail.cc)}`;
          window.open(mailto, "_blank");
        }
      } catch (e) {
        console.error("FARMA (mini-chat) — falha ao executar ação confirmada:", e);
        card.remove();
        addMsg("Não foi possível concluir a ação agora. Tente novamente.", "resposta");
      }
    });
  }

  async function obterDiasUso() {
    if (diasUsoCache) return diasUsoCache;
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
    try { diasUsoCache = await carregarUsoPeriodo(dataStore, isoDia(inicio), isoDia(hoje)); }
    catch (e) { diasUsoCache = {}; }
    return diasUsoCache;
  }

  // ponto 46 — nome personalizado da assistente (config.farmaNomeAssistente,
  // a mesma configuração definida no módulo FARMA IA completo, "✏️ Nome").
  async function obterNomeAssistente() {
    if (nomeAssistenteCache) return nomeAssistenteCache;
    try {
      const estado = await dataStore.getEstadoCompleto();
      nomeAssistenteCache = (estado && estado.config && estado.config.farmaNomeAssistente) || "FARMA";
    } catch (e) { nomeAssistenteCache = "FARMA"; }
    return nomeAssistenteCache;
  }

  async function abrir() {
    painel.classList.add("aberto");
    const nomeAssistente = await obterNomeAssistente();
    painel.querySelector(".farma-mini-nome").textContent = nomeAssistente + " IA";
    bolha.title = "Falar com a " + nomeAssistente;
    if (!jaCumprimentou) {
      jaCumprimentou = true;
      const cache = window.ModuleChrome && window.ModuleChrome.getCachedBranding ? window.ModuleChrome.getCachedBranding() : null;
      const nome = cache && cache.nomeFarmacia;
      addMsg(nome ? `Olá! Sou a ${nomeAssistente}, da ${nome}. Em que posso ajudar?` : `Olá! Sou a ${nomeAssistente}. Em que posso ajudar?`, "resposta");
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
      const nomeAssistente = await obterNomeAssistente();

      // ponto 46: reconhecimento de ações corre ANTES do motor de
      // perguntas/respostas, de propósito — não "só depois de o motor de
      // perguntas não reconhecer nada" como dizia este comentário antes.
      // Descoberto durante os testes desta peça: o motor de perguntas
      // (responderPergunta/corresponde em farmaIa.js) casa por qualquer
      // palavra-chave isolada em qualquer posição do texto, e o vocabulário
      // de domínio das ações ("manipulado", "aue", "catalogo", ...)
      // sobrepõe-se ao de várias intents de pergunta — por isso, com a
      // ordem antiga, um pedido como "cria um pedido de manipulado para a
      // Ana Costa..." era sempre intercetado pelo motor de perguntas (que
      // respondia com uma frase enlatada tipo "Ainda não há nenhum pedido
      // de manipulado registado") e o cartão de ação nunca chegava a
      // aparecer. Os gatilhos deste reconhecimento exigem sempre um verbo
      // de ação explícito (cria, marca, adiciona, remove, ...) além da
      // âncora de domínio, pelo que perguntas genuínas (interrogativas, sem
      // esse verbo) nunca são afetadas por correr primeiro — ver
      // tests/farmaAcoesIntent.test.js, casos de controlo negativo.
      const reconhecimento = reconhecerAcaoDeterministica(pergunta);
      if (reconhecimento) {
        if (reconhecimento.tipo === "incompleta") {
          addMsg(reconhecimento.motivo, "resposta");
          return;
        }
        try {
          let estadoParaAcao = estado;
          if (reconhecimento.acaoId.startsWith("catalogo.")) {
            const catalogo = await carregarCatalogoEfetivo(dataStore);
            estadoParaAcao = { ...estado, catalogoProdutos: catalogo.products };
          }
          const preparado = prepararAcao(reconhecimento.acaoId, reconhecimento.parametros, estadoParaAcao);
          if (preparado.ok) mostrarCartaoAcao(preparado.resumo, preparado.plano);
          else addMsg(preparado.motivo, "resposta");
        } catch (e) {
          console.error("FARMA (mini-chat) — falha ao preparar ação reconhecida:", e);
          addMsg("Percebi o que queria fazer, mas não consegui preparar a ação agora. Tente outra vez.", "resposta");
        }
        return;
      }

      const { resposta, intentId } = responderPergunta(pergunta, estado, { diasUso, memoria, nomeAssistente });
      if (intentId) {
        addMsg(resposta, "resposta");
        return;
      }
      if (memoria) {
        try {
          await dataStore.setConfig("farmaIaMemoria", registarPerguntaNaoReconhecida(memoria, pergunta, new Date()));
        } catch (e) { /* aprendizagem é um extra — falha aqui nunca bloqueia a resposta já dada */ }
      }
      addMsg(resposta, "resposta"); // "não percebi…" — fallback de sempre
    } catch (err) {
      addMsg("Não foi possível consultar os dados neste momento. Tente novamente.", "resposta");
    }
  });
}
