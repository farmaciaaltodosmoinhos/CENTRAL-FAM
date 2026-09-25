/**
 * src/ui/poupanca.js — painel "Poupança & ROI" (Configurações → aba
 * "Poupança & ROI"), construído sobre o mesmo registo de uso que alimenta
 * "Dados & Estatísticas" (ver src/usoCatalogo.js e src/usoLeitura.js).
 *
 * Mostra, com base no que cada módulo regista através de
 * `window.ModuleChrome.registarUso(modulo, tarefaId, qtd)`:
 *   - tempo e € poupados hoje / esta semana / este mês / este ano / desde
 *     sempre, e para um período personalizado;
 *   - gráficos de tendência, por módulo e por tarefa (Chart.js, cdnjs);
 *   - uma tabela com todas as tarefas rastreadas, o nº de vezes no período
 *     escolhido, e as estimativas de tempo (editáveis, gravadas em
 *     `config.usoEstimativas`);
 *   - exportação do relatório completo para PDF (html2canvas + jsPDF, mesmo
 *     padrão já usado em modulos/gabinete.html).
 *
 * Todo o cálculo (tempo/€ poupados) é uma ESTIMATIVA de referência — nunca
 * uma medição cronometrada — e é sempre apresentado como tal na própria UI.
 */
import {
  carregarUsoPeriodo, calcularPoupanca, serieDiaria, agregarPorModulo, agregarPorTarefa,
  fmtDuracao, fmtEuros, isoDia, limparCacheUso
} from "../usoLeitura.js";
import { MODULOS_NOMES } from "../usoCatalogo.js";
import { escapeHtml } from "../utils.js";
import { bus } from "../events.js";

/**
 * Carrega um <script> externo, tentando cada URL de `srcs` por ordem até
 * uma funcionar. Corrigido nesta sessão: a versão fixa do Chart.js
 * (4.4.4) tinha deixado de existir no cdnjs (o cdnjs vai podando versões
 * antigas com o tempo — API confirmou "Version not found"), o que
 * rebentava o painel inteiro com "sem ligação ao CDN" mesmo com internet
 * perfeitamente normal. Para isto não voltar a acontecer da mesma forma,
 * cada biblioteca tem agora uma 2ª fonte (jsdelivr, espelho independente do
 * mesmo pacote npm) — só se AMBAS falharem é que se assume falta de
 * rede/CDN de verdade.
 */
function ensureScript(srcs, globalCheck) {
  const lista = Array.isArray(srcs) ? srcs : [srcs];
  return new Promise((resolve, reject) => {
    if (globalCheck()) { resolve(); return; }
    let i = 0;
    function tentarProxima() {
      if (i >= lista.length) { reject(new Error("Não foi possível carregar nenhuma das fontes: " + lista.join(" nem "))); return; }
      const src = lista[i++];
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); tentarProxima(); };
      document.head.appendChild(s);
    }
    tentarProxima();
  });
}
function ensureChartJs() {
  return ensureScript([
    "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js",
    "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"
  ], () => !!window.Chart);
}
function ensureHtml2Canvas() {
  return ensureScript([
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
  ], () => !!window.html2canvas);
}
function ensureJsPDF() {
  return ensureScript([
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
  ], () => !!(window.jspdf && window.jspdf.jsPDF));
}

const CORES = ["#2b7a4b", "#4f9c72", "#1f543e", "#8fc7a4", "#a8d8bd", "#6fb98d", "#c8e6d3", "#3d6b52"];

function addDiasIso(iso, delta) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return isoDia(d);
}

export function initPoupanca(el, dataStore) {
  let overrides = {};
  let valorHora = 0;
  let usoInicioEm = null;
  let carregado = false;
  let graficos = { tendencia: null, modulos: null, tarefas: null };
  // Estado dos "vistas diferentes / seleção de período" dos gráficos — os
  // gráficos, ao contrário dos cartões-resumo, viviam sempre presos a um
  // período fixo (últimos 30 dias / desde sempre) e nunca refletiam o
  // período personalizado escolhido acima, o que na prática parecia aos
  // olhos de quem usa a app que "os gráficos não funcionam". Agora os 3
  // gráficos partilham um preset de período (independente dos cartões-
  // resumo) e cada um tem a sua própria vista.
  let chartsPeriodoPreset = "30"; // '7' | '30' | '90' | '365' | 'tudo' | 'custom'
  let chartTendGranularidade = "dia"; // 'dia' | 'semana' | 'mes'
  let chartModulosMetrica = "tempo"; // 'tempo' | 'ocorrencias'
  let chartTarefasMetrica = "ocorrencias"; // 'ocorrencias' | 'tempo'

  function inicioSemanaIso(iso) {
    // segunda-feira da semana ISO a que "iso" pertence
    const d = new Date(iso + "T00:00:00");
    const diaSemana = (d.getDay() + 6) % 7; // 0=segunda ... 6=domingo
    d.setDate(d.getDate() - diaSemana);
    return isoDia(d);
  }

  function filtrarDiasPorPresetPeriodo(diasTudo) {
    const hoje = isoDia(new Date());
    if (chartsPeriodoPreset === "tudo") return diasTudo;
    if (chartsPeriodoPreset === "custom") {
      const ini = el.poupPeriodoInicio.value, fim = el.poupPeriodoFim.value;
      if (!ini || !fim || ini > fim) return diasTudo; // período personalizado ainda não escolhido — mostra tudo em vez de nada
      const filtrado = {};
      Object.keys(diasTudo).forEach(d => { if (d >= ini && d <= fim) filtrado[d] = diasTudo[d]; });
      return filtrado;
    }
    const inicio = addDiasIso(hoje, -(parseInt(chartsPeriodoPreset, 10) - 1));
    const filtrado = {};
    Object.keys(diasTudo).forEach(d => { if (d >= inicio && d <= hoje) filtrado[d] = diasTudo[d]; });
    return filtrado;
  }

  function bucketsTendencia(diasFiltrados, granularidade) {
    const serie = serieDiaria(diasFiltrados, overrides);
    if (granularidade === "dia") {
      const chaves = Object.keys(diasFiltrados).sort();
      if (!chaves.length) return { labels: [], valores: [] };
      const porDia = new Map(serie.map(s => [s.dia, s]));
      const labels = [], valores = [];
      for (let d = chaves[0]; d <= chaves[chaves.length - 1]; d = addDiasIso(d, 1)) {
        const s = porDia.get(d);
        labels.push(d.slice(5).split("-").reverse().join("/"));
        valores.push(s ? +(s.segundosPoupados / 3600).toFixed(2) : 0);
      }
      return { labels, valores };
    }
    // semana / mês: agrega os dias em baldes (soma dos segundos poupados)
    const buckets = new Map();
    serie.forEach(s => {
      const chave = granularidade === "mes" ? s.dia.slice(0, 7) : inicioSemanaIso(s.dia);
      buckets.set(chave, (buckets.get(chave) || 0) + s.segundosPoupados);
    });
    const chaves = [...buckets.keys()].sort();
    const labels = chaves.map(c => granularidade === "mes"
      ? c.slice(5, 7) + "/" + c.slice(0, 4)
      : "sem. " + c.slice(8, 10) + "/" + c.slice(5, 7));
    const valores = chaves.map(c => +(buckets.get(c) / 3600).toFixed(2));
    return { labels, valores };
  }

  async function obterDiasTudo() {
    const hoje = isoDia(new Date());
    const inicioTudo = await garantirInicioConhecido();
    return carregarUsoPeriodo(dataStore, inicioTudo, hoje);
  }

  function ativarChip(grupoEl, atributo, valor) {
    if (!grupoEl) return;
    grupoEl.querySelectorAll(".poup-chip").forEach(b => b.classList.toggle("active", b.dataset[atributo] === valor));
  }

  async function garantirConfigCarregada() {
    if (carregado) return;
    const [ov, vh, inicio] = await Promise.all([
      dataStore.getConfig("usoEstimativas"),
      dataStore.getConfig("valorHoraPoupanca"),
      dataStore.getConfig("usoInicioEm")
    ]);
    overrides = (ov && typeof ov === "object") ? ov : {};
    valorHora = typeof vh === "number" ? vh : 0;
    usoInicioEm = inicio || null;
    el.poupValorHoraInput.value = valorHora || "";
    carregado = true;
  }

  async function garantirInicioConhecido() {
    if (usoInicioEm) return usoInicioEm;
    // Ainda não sabemos quando esta farmácia começou a usar a Central — varre
    // até 24 meses para trás à procura do primeiro dia com algum registo, e
    // guarda o resultado (best-effort) para não repetir esta varredura.
    const hoje = isoDia(new Date());
    const desde = addDiasIso(hoje, -730);
    const dias = await carregarUsoPeriodo(dataStore, desde, hoje);
    const chaves = Object.keys(dias).sort();
    usoInicioEm = chaves.length ? chaves[0] : hoje;
    dataStore.setConfig("usoInicioEm", usoInicioEm).catch(() => {});
    return usoInicioEm;
  }

  function cartaoResumo(label, calc, sub) {
    return `<div class="poup-resumo-card">
      <div class="prc-label">${escapeHtml(label)}</div>
      <div class="prc-tempo">${fmtDuracao(calc.segundosPoupados)}</div>
      <div class="prc-euros">${fmtEuros((calc.segundosPoupados / 3600) * valorHora)}</div>
      <div class="prc-sub">${sub || (calc.totalOcorrencias + " tarefa" + (calc.totalOcorrencias === 1 ? "" : "s") + " realizadas")}</div>
    </div>`;
  }

  async function renderResumos() {
    const hoje = isoDia(new Date());
    const inicioSemana = addDiasIso(hoje, -6);
    const inicioMesCalendario = hoje.slice(0, 8) + "01";
    const inicioAnoCalendario = hoje.slice(0, 4) + "-01-01";
    const inicioTudo = await garantirInicioConhecido();

    const [diasHoje, diasSemana, diasMes, diasAno, diasTudo] = await Promise.all([
      carregarUsoPeriodo(dataStore, hoje, hoje),
      carregarUsoPeriodo(dataStore, inicioSemana, hoje),
      carregarUsoPeriodo(dataStore, inicioMesCalendario, hoje),
      carregarUsoPeriodo(dataStore, inicioAnoCalendario, hoje),
      carregarUsoPeriodo(dataStore, inicioTudo, hoje)
    ]);

    el.poupResumoGrid.innerHTML = [
      cartaoResumo("Hoje", calcularPoupanca(diasHoje, overrides)),
      cartaoResumo("Últimos 7 dias", calcularPoupanca(diasSemana, overrides)),
      cartaoResumo("Este mês", calcularPoupanca(diasMes, overrides)),
      cartaoResumo("Este ano", calcularPoupanca(diasAno, overrides)),
      cartaoResumo("Desde que usa a Central", calcularPoupanca(diasTudo, overrides), "a usar desde " + inicioTudo.split("-").reverse().join("/"))
    ].join("");

    return diasTudo;
  }

  async function renderPeriodoPersonalizado() {
    const ini = el.poupPeriodoInicio.value, fim = el.poupPeriodoFim.value;
    if (!ini || !fim || ini > fim) { el.poupCustomResumo.style.display = "none"; return; }
    const dias = await carregarUsoPeriodo(dataStore, ini, fim);
    const calc = calcularPoupanca(dias, overrides);
    el.poupCustomResumo.style.display = "flex";
    el.poupCustomResumo.innerHTML = `
      <div class="pcc-item"><div class="prc-label">Período personalizado</div><div style="font-size:.78rem;color:var(--text-soft);">${ini.split("-").reverse().join("/")} a ${fim.split("-").reverse().join("/")}</div></div>
      <div class="pcc-item"><div class="prc-label">Tempo poupado</div><div class="prc-tempo">${fmtDuracao(calc.segundosPoupados)}</div></div>
      <div class="pcc-item"><div class="prc-label">Valor poupado</div><div class="prc-euros">${fmtEuros((calc.segundosPoupados / 3600) * valorHora)}</div></div>
      <div class="pcc-item"><div class="prc-label">Tarefas realizadas</div><div class="prc-tempo">${calc.totalOcorrencias}</div></div>`;
  }

  async function renderGraficos(diasTudo) {
    // A ausência de rede/CDN (ex.: firewall da farmácia a bloquear
    // cdnjs.cloudflare.com) nunca deve impedir o resto do painel — os
    // resumos e a tabela de tarefas continuam úteis mesmo sem gráficos.
    try {
      await ensureChartJs();
    } catch (err) {
      if (!avisoChartJsMostrado) {
        avisoChartJsMostrado = true;
        bus.emit("toast:show", { type: "err", msg: "Não foi possível carregar os gráficos (sem ligação ao CDN). Os resumos e a tabela continuam corretos." });
      }
      return;
    }
    const Chart = window.Chart;
    const diasFiltrados = filtrarDiasPorPresetPeriodo(diasTudo);

    const { labels, valores } = bucketsTendencia(diasFiltrados, chartTendGranularidade);
    if (graficos.tendencia) graficos.tendencia.destroy();
    graficos.tendencia = new Chart(el.poupChartTendencia.getContext("2d"), {
      type: "line",
      data: { labels, datasets: [{ label: "Horas poupadas", data: valores, borderColor: CORES[0], backgroundColor: "rgba(43,122,75,.12)", fill: true, tension: .25, pointRadius: labels.length > 60 ? 0 : 2 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + "h" } } } }
    });

    const porModulo = agregarPorModulo(diasFiltrados, overrides);
    const modulosOrdenados = Object.entries(porModulo).sort((a, b) => chartModulosMetrica === "tempo"
      ? b[1].segundosPoupados - a[1].segundosPoupados
      : b[1].totalOcorrencias - a[1].totalOcorrencias);
    if (graficos.modulos) graficos.modulos.destroy();
    graficos.modulos = new Chart(el.poupChartModulos.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: modulosOrdenados.map(([m]) => MODULOS_NOMES[m] || m),
        datasets: [{
          data: modulosOrdenados.map(([, v]) => chartModulosMetrica === "tempo" ? +(v.segundosPoupados / 3600).toFixed(2) : v.totalOcorrencias),
          backgroundColor: CORES
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (ctx) => ctx.label + ": " + (chartModulosMetrica === "tempo" ? ctx.parsed + "h poupadas" : ctx.parsed + "x") } }
        }
      }
    });

    const porTarefa = agregarPorTarefa(diasFiltrados, overrides).filter(t => t.totalOcorrencias > 0)
      .sort((a, b) => chartTarefasMetrica === "tempo" ? b.segundosPoupados - a.segundosPoupados : b.totalOcorrencias - a.totalOcorrencias)
      .slice(0, 8);
    if (graficos.tarefas) graficos.tarefas.destroy();
    graficos.tarefas = new Chart(el.poupChartTarefas.getContext("2d"), {
      type: "bar",
      data: {
        labels: porTarefa.map(t => t.nome),
        datasets: [{
          label: chartTarefasMetrica === "tempo" ? "Horas poupadas" : "Nº de vezes",
          data: porTarefa.map(t => chartTarefasMetrica === "tempo" ? +(t.segundosPoupados / 3600).toFixed(2) : t.totalOcorrencias),
          backgroundColor: CORES[0]
        }]
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: chartTarefasMetrica === "tempo" ? 1 : 0 } } } }
    });
  }

  async function renderTabela(diasTudo) {
    const linhas = agregarPorTarefa(diasTudo, overrides);
    el.poupTabelaTarefasBody.innerHTML = linhas.map(t => `
      <tr data-chave="${escapeHtml(t.chave)}">
        <td>${escapeHtml(MODULOS_NOMES[t.modulo] || t.modulo)}</td>
        <td>${escapeHtml(t.nome)}</td>
        <td class="pt-num">${t.totalOcorrencias}</td>
        <td><input type="number" class="pt-est" data-campo="tempoManualSeg" min="0" value="${t.tempoManualSeg}"></td>
        <td><input type="number" class="pt-est" data-campo="tempoCentralSeg" min="0" value="${t.tempoCentralSeg}"></td>
        <td class="pt-poupado">${fmtDuracao(t.segundosPoupados)}</td>
      </tr>`).join("");
  }

  let avisoChartJsMostrado = false;
  let refreshEmCurso = null;
  async function refrescarTudo() {
    if (refreshEmCurso) return refreshEmCurso;
    refreshEmCurso = (async () => {
      await garantirConfigCarregada();
      const diasTudo = await renderResumos();
      await renderPeriodoPersonalizado();
      await renderGraficos(diasTudo);
      await renderTabela(diasTudo);
    })();
    try { await refreshEmCurso; } finally { refreshEmCurso = null; }
  }

  // -------- interação --------
  el.poupValorHoraInput.addEventListener("change", async () => {
    const v = parseFloat(el.poupValorHoraInput.value.replace(",", ".")) || 0;
    valorHora = v;
    await dataStore.setConfig("valorHoraPoupanca", v);
    await renderResumos();
    await renderPeriodoPersonalizado();
  });
  el.poupPeriodoInicio.addEventListener("change", async () => {
    await renderPeriodoPersonalizado();
    // se os gráficos estiverem a usar o período personalizado, seguem-no também
    if (chartsPeriodoPreset === "custom") await renderGraficos(await obterDiasTudo());
  });
  el.poupPeriodoFim.addEventListener("change", async () => {
    await renderPeriodoPersonalizado();
    if (chartsPeriodoPreset === "custom") await renderGraficos(await obterDiasTudo());
  });
  el.btnPoupAtualizar.addEventListener("click", () => { limparCacheUso(); refrescarTudo(); });

  // -------- vistas/período dos gráficos --------
  el.poupChartsPeriodo?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".poup-chip[data-periodo]");
    if (!btn) return;
    chartsPeriodoPreset = btn.dataset.periodo;
    ativarChip(el.poupChartsPeriodo, "periodo", chartsPeriodoPreset);
    await renderGraficos(await obterDiasTudo());
  });
  el.poupChartTendGranularidade?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".poup-chip[data-gran]");
    if (!btn) return;
    chartTendGranularidade = btn.dataset.gran;
    ativarChip(el.poupChartTendGranularidade, "gran", chartTendGranularidade);
    await renderGraficos(await obterDiasTudo());
  });
  el.poupChartModulosMetrica?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".poup-chip[data-metrica]");
    if (!btn) return;
    chartModulosMetrica = btn.dataset.metrica;
    ativarChip(el.poupChartModulosMetrica, "metrica", chartModulosMetrica);
    await renderGraficos(await obterDiasTudo());
  });
  el.poupChartTarefasMetrica?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".poup-chip[data-metrica]");
    if (!btn) return;
    chartTarefasMetrica = btn.dataset.metrica;
    ativarChip(el.poupChartTarefasMetrica, "metrica", chartTarefasMetrica);
    await renderGraficos(await obterDiasTudo());
  });

  el.poupTabelaTarefasBody.addEventListener("change", async (e) => {
    const input = e.target.closest("input.pt-est");
    if (!input) return;
    const tr = input.closest("tr");
    const chave = tr.dataset.chave;
    const campo = input.dataset.campo;
    const valor = Math.max(0, parseInt(input.value, 10) || 0);
    overrides = { ...overrides, [chave]: { ...(overrides[chave] || {}), [campo]: valor } };
    await dataStore.setConfig("usoEstimativas", overrides);
    bus.emit("toast:show", { type: "ok", msg: "Estimativa atualizada." });
    // recalcula tudo com a nova estimativa, sem tornar a ir ao servidor
    const diasTudo = await obterDiasTudo();
    await renderResumos();
    await renderPeriodoPersonalizado();
    await renderGraficos(diasTudo);
    await renderTabela(diasTudo);
  });

  el.btnPoupExportarPdf.addEventListener("click", async () => {
    el.btnPoupExportarPdf.disabled = true;
    const textoOriginal = el.btnPoupExportarPdf.innerHTML;
    el.btnPoupExportarPdf.innerHTML = "A gerar PDF...";
    let holder = null;
    try {
      await ensureHtml2Canvas();
      await ensureJsPDF();
      const painel = document.getElementById("tab-poupanca");
      // Bug corrigido: capturar o painel ao vivo com html2canvas cortava o
      // PDF a meio, porque #tab-poupanca vive dentro de .modal-container
      // (max-height:88vh; overflow-y:auto) — o html2canvas só rasteriza a
      // parte do DOM que esse ancestor deixa "visível" no momento da
      // captura, tal como o mesmo bug já resolvido antes em
      // modulos/gabinete.html. A correção segue o mesmo padrão: clonar o
      // painel para um "holder" destacado, anexado diretamente a
      // document.body (fora de qualquer ancestor com scroll/clip), com
      // largura fixa e fora do ecrã visível para não "piscar" para o
      // utilizador.
      holder = document.createElement("div");
      const largura = painel.offsetWidth || 900;
      holder.style.cssText = `position:fixed;left:-9999px;top:0;width:${largura}px;background:#fff;max-height:none;overflow:visible;`;
      const clone = painel.cloneNode(true);
      clone.style.maxHeight = "none";
      clone.style.overflow = "visible";
      clone.style.display = "block";
      holder.appendChild(clone);
      document.body.appendChild(holder);

      // cloneNode não copia: (a) o desenho já feito num <canvas> — só o
      // elemento fica vazio — nem (b) valores de <input>/<select> que foram
      // postos por JS (ex.: poupValorHoraInput.value = ...) em vez de por
      // atributo HTML. Sem isto o PDF sairia com os gráficos em branco e o
      // valor/hora e período personalizado vazios.
      const canvaisOriginais = painel.querySelectorAll("canvas");
      const canvaisClone = clone.querySelectorAll("canvas");
      canvaisOriginais.forEach((origCanvas, i) => {
        const cloneCanvas = canvaisClone[i];
        if (!cloneCanvas || !origCanvas.width || !origCanvas.height) return;
        const img = document.createElement("img");
        img.src = origCanvas.toDataURL("image/png");
        img.style.width = origCanvas.offsetWidth + "px";
        img.style.height = origCanvas.offsetHeight + "px";
        cloneCanvas.replaceWith(img);
      });
      const camposOriginais = painel.querySelectorAll("input,select,textarea");
      const camposClone = clone.querySelectorAll("input,select,textarea");
      camposOriginais.forEach((orig, i) => {
        const c = camposClone[i];
        if (!c) return;
        if (orig.type === "checkbox" || orig.type === "radio") c.checked = orig.checked;
        else c.value = orig.value;
      });

      const canvas = await window.html2canvas(clone, { scale: 2, backgroundColor: "#ffffff", useCORS: true, allowTaint: true });
      document.body.removeChild(holder);
      holder = null;
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/png");
      const imgW = pageWidth;
      const imgH = canvas.height * (imgW / canvas.width);
      let heightLeft = imgH, y = 0;
      pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        y = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
        heightLeft -= pageHeight;
      }
      pdf.save(`poupanca-central-${isoDia(new Date())}.pdf`);
      bus.emit("toast:show", { type: "ok", msg: "PDF exportado." });
    } catch (err) {
      bus.emit("toast:show", { type: "err", msg: "Não foi possível gerar o PDF: " + err.message });
    } finally {
      if (holder && holder.parentNode) document.body.removeChild(holder);
      el.btnPoupExportarPdf.disabled = false;
      el.btnPoupExportarPdf.innerHTML = textoOriginal;
    }
  });

  return { refrescarTudo };
}
