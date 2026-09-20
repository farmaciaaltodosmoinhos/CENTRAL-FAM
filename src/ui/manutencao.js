/**
 * src/ui/manutencao.js — painel "Auto-manutenção" (Configurações → aba
 * "Auto-manutenção", ponto 21/22): liga a lógica pura de
 * src/manutencao.js ao servidor (via dataStore.getEstadoCompleto()/
 * gravarEstadoCompleto()/setAsset()/getAsset()) e ao DOM.
 *
 * As 3 partes pedidas pelo Ivo ("Todos"):
 *   1. Verificação/reparação de integridade de dados.
 *   2. Cópias de segurança automáticas (uma vez por dia, silenciosa) +
 *      manuais, com restauro.
 *   3. Painel de saúde/desempenho.
 */
import {
  verificarIntegridade, repararIntegridade, podarBackups, precisaBackupAutomatico,
  calcularSaude, fmtBytes
} from "../manutencao.js";
import { escapeHtml } from "../utils.js";
import { bus } from "../events.js";

const MAX_BACKUPS = 20;

function fmtDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT") + " " + d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

export function initManutencao(el, dataStore) {
  let ultimaVerificacao = null; // { problemas, resumo }
  let backupEmCurso = false;

  /* ---------------- verificação/reparação de integridade ---------------- */

  function renderResultadoIntegridade() {
    if (!ultimaVerificacao) {
      el.manutIntegridadeResultado.innerHTML = `<p style="font-size:.78rem;color:var(--text-soft);">Ainda não foi feita nenhuma verificação nesta sessão.</p>`;
      el.btnManutReparar.disabled = true;
      return;
    }
    const { problemas, resumo } = ultimaVerificacao;
    if (!problemas.length) {
      el.manutIntegridadeResultado.innerHTML = `<div class="data-action-card" style="border-color:var(--primary);"><h4 style="color:var(--primary);">✓ Tudo em ordem</h4><p>Não foi encontrado nenhum problema de integridade nos dados desta farmácia.</p></div>`;
      el.btnManutReparar.disabled = true;
      return;
    }
    const linhas = problemas.map(p => `
      <tr>
        <td>${escapeHtml(p.modulo)}</td>
        <td><span style="font-weight:700;color:${p.severidade === "erro" ? "var(--danger,#c0433b)" : "var(--text-soft)"};">${p.severidade === "erro" ? "Erro" : "Aviso"}</span></td>
        <td>${escapeHtml(p.descricao)}</td>
        <td>${p.reparavel ? "Sim" : "Não"}</td>
      </tr>`).join("");
    el.manutIntegridadeResultado.innerHTML = `
      <p style="font-size:.78rem;color:var(--text-soft);margin:0 0 10px;">
        <b>${resumo.total}</b> problema${resumo.total === 1 ? "" : "s"} encontrado${resumo.total === 1 ? "" : "s"}
        (${resumo.erros} erro${resumo.erros === 1 ? "" : "s"}, ${resumo.avisos} aviso${resumo.avisos === 1 ? "" : "s"}) —
        <b>${resumo.reparaveis}</b> reparável${resumo.reparaveis === 1 ? "" : "eis"} automaticamente.
      </p>
      <div class="poup-table-wrap">
        <table class="poup-table">
          <thead><tr><th>Módulo</th><th>Gravidade</th><th>Descrição</th><th>Reparável</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
    el.btnManutReparar.disabled = resumo.reparaveis === 0;
  }

  async function verificarAgora() {
    el.btnManutVerificar.disabled = true;
    const textoOriginal = el.btnManutVerificar.textContent;
    el.btnManutVerificar.textContent = "A verificar...";
    try {
      const estado = await dataStore.getEstadoCompleto();
      ultimaVerificacao = verificarIntegridade(estado);
      renderResultadoIntegridade();
      await renderSaude(estado);
      bus.emit("toast:show", { type: "ok", msg: ultimaVerificacao.problemas.length ? `Verificação concluída: ${ultimaVerificacao.problemas.length} problema(s) encontrado(s).` : "Verificação concluída: tudo em ordem." });
    } catch (err) {
      bus.emit("toast:show", { type: "err", msg: "Não foi possível verificar a integridade: " + err.message });
    } finally {
      el.btnManutVerificar.disabled = false;
      el.btnManutVerificar.textContent = textoOriginal;
    }
  }

  async function repararAgora() {
    if (!ultimaVerificacao || !ultimaVerificacao.resumo.reparaveis) return;
    el.btnManutReparar.disabled = true;
    const textoOriginal = el.btnManutReparar.textContent;
    el.btnManutReparar.textContent = "A reparar...";
    try {
      // Volta a ler e a verificar em cima do estado mais recente (pode ter
      // mudado desde a última verificação) antes de reparar, para nunca
      // reparar com base em dados desatualizados.
      const estadoAtual = await dataStore.getEstadoCompleto();
      const { problemas } = verificarIntegridade(estadoAtual);
      const { estado: estadoReparado, reparos } = repararIntegridade(estadoAtual, problemas);
      if (reparos.length) await dataStore.gravarEstadoCompleto(estadoReparado);
      ultimaVerificacao = verificarIntegridade(estadoReparado);
      renderResultadoIntegridade();
      await renderSaude(estadoReparado);
      bus.emit("toast:show", { type: "ok", msg: `${reparos.length} problema(s) reparado(s) automaticamente.` });
    } catch (err) {
      bus.emit("toast:show", { type: "err", msg: "Não foi possível reparar: " + err.message });
    } finally {
      el.btnManutReparar.disabled = !ultimaVerificacao || ultimaVerificacao.resumo.reparaveis === 0;
      el.btnManutReparar.textContent = textoOriginal;
    }
  }

  /* ---------------- cópias de segurança ---------------- */

  function renderBackupsLista(manifesto) {
    const lista = (Array.isArray(manifesto) ? [...manifesto] : []).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    if (!lista.length) {
      el.manutBackupsLista.innerHTML = `<p style="font-size:.78rem;color:var(--text-soft);">Ainda não existe nenhuma cópia de segurança.</p>`;
      return;
    }
    const linhas = lista.map(b => `
      <tr>
        <td>${fmtDataHora(b.criadoEm)}</td>
        <td>${b.manual ? "Manual" : "Automática"}</td>
        <td>${fmtBytes(b.tamanhoBytes)}</td>
        <td><button type="button" class="btn-secondary manut-restaurar-btn" data-id="${escapeHtml(b.id)}" style="padding:5px 12px;font-size:.72rem;">Restaurar</button></td>
      </tr>`).join("");
    el.manutBackupsLista.innerHTML = `
      <div class="poup-table-wrap">
        <table class="poup-table">
          <thead><tr><th>Criada em</th><th>Tipo</th><th>Tamanho</th><th></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  async function obterManifesto() {
    const m = await dataStore.getConfig("manutBackups");
    return Array.isArray(m) ? m : [];
  }

  async function criarBackupAgora({ manual = true } = {}) {
    if (backupEmCurso) return;
    backupEmCurso = true;
    try {
      const estado = await dataStore.getEstadoCompleto();
      const conteudo = JSON.stringify(estado);
      const id = "backup-" + new Date().toISOString().replace(/[:.]/g, "-");
      await dataStore.setAsset(id, conteudo);
      const manifestoAtual = await obterManifesto();
      const novoManifesto = [...manifestoAtual, { id, criadoEm: new Date().toISOString(), tamanhoBytes: conteudo.length, manual }];
      const { manifestoPodado, removidos } = podarBackups(novoManifesto, MAX_BACKUPS);
      await dataStore.setConfig("manutBackups", manifestoPodado);
      // limpeza best-effort dos backups mais antigos removidos pela poda
      removidos.forEach(r => dataStore.deleteAsset(r.id).catch(() => {}));
      renderBackupsLista(manifestoPodado);
      await renderSaude(estado, manifestoPodado);
      if (manual) bus.emit("toast:show", { type: "ok", msg: "Cópia de segurança criada." });
      return { id, manifestoPodado };
    } catch (err) {
      if (manual) bus.emit("toast:show", { type: "err", msg: "Não foi possível criar a cópia de segurança: " + err.message });
      throw err;
    } finally {
      backupEmCurso = false;
    }
  }

  async function restaurarBackup(id) {
    if (!id) return;
    if (!window.confirm("Restaurar esta cópia de segurança? Os dados atuais desta farmácia serão substituídos pelos da cópia. Esta ação não pode ser desfeita.")) return;
    try {
      const conteudo = await dataStore.getAsset(id);
      if (conteudo == null) throw new Error("Cópia de segurança não encontrada.");
      const estadoBackup = JSON.parse(conteudo);
      await dataStore.gravarEstadoCompleto(estadoBackup);
      bus.emit("toast:show", { type: "ok", msg: "Cópia restaurada. A recarregar a Central..." });
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      bus.emit("toast:show", { type: "err", msg: "Não foi possível restaurar: " + err.message });
    }
  }

  el.manutBackupsLista.addEventListener("click", (e) => {
    const btn = e.target.closest(".manut-restaurar-btn");
    if (btn) restaurarBackup(btn.dataset.id);
  });

  /**
   * Corre uma vez por dia (silenciosamente, sem toast) sempre que a Central
   * arranca — chamado a partir de app.js, não depende de a aba estar
   * aberta. Nunca bloqueia nem trava o arranque da app: falhas são
   * ignoradas (best-effort), e nunca corre duas vezes ao mesmo tempo.
   */
  async function iniciarBackupAutomatico() {
    try {
      const manifesto = await obterManifesto();
      if (!precisaBackupAutomatico(manifesto)) return;
      await criarBackupAgora({ manual: false });
    } catch (e) { /* best-effort — nunca interrompe o arranque da app */ }
  }

  /* ---------------- painel de saúde ---------------- */

  async function renderSaude(estadoJaCarregado, manifestoJaCarregado) {
    const estado = estadoJaCarregado || await dataStore.getEstadoCompleto();
    const manifesto = manifestoJaCarregado || await obterManifesto();
    const saude = calcularSaude(estado, manifesto);
    const cartoes = [
      { label: "Tamanho do estado partilhado", valor: fmtBytes(saude.tamanhoBytes) },
      { label: "Total de registos", valor: String(saude.totalItens) },
      { label: "Cópias de segurança guardadas", valor: String(saude.totalBackups) },
      { label: "Última cópia de segurança", valor: saude.ultimoBackup ? fmtDataHora(saude.ultimoBackup.criadoEm) : "Nenhuma ainda" },
    ];
    el.manutSaudeGrid.innerHTML = cartoes.map(c => `
      <div class="poup-resumo-card">
        <div class="prc-label">${escapeHtml(c.label)}</div>
        <div class="prc-tempo" style="font-size:1.05rem;">${escapeHtml(c.valor)}</div>
      </div>`).join("");
  }

  /* ---------------- interação ---------------- */
  el.btnManutVerificar.addEventListener("click", verificarAgora);
  el.btnManutReparar.addEventListener("click", repararAgora);
  el.btnManutBackupAgora.addEventListener("click", () => criarBackupAgora({ manual: true }));

  async function refrescarTudo() {
    renderResultadoIntegridade();
    const manifesto = await obterManifesto();
    renderBackupsLista(manifesto);
    await renderSaude(null, manifesto);
  }

  return { refrescarTudo, iniciarBackupAutomatico, verificarAgora, repararAgora, criarBackupAgora, restaurarBackup };
}
