import { createStore, reducer, initialState } from "./store.js";
import { initRemote, makeDataStore, migrarDadosLocaisSeNecessario } from "./db.js";
import { createActions } from "./actions.js";
import { bus } from "./events.js";
import { debounce } from "./utils.js";
import { CATEGORIAS_PADRAO } from "./domain.js";
import { ICONS, icon } from "./icons.js";
import { renderSidebar, expandPathTo } from "./ui/sidebar.js";
import { renderMainContent, renderCrumb } from "./ui/main-content.js";
import { initToasts } from "./ui/toast.js";
import { initPalette } from "./ui/palette.js";
import { initModals } from "./ui/modals.js";
import { initPoupanca } from "./ui/poupanca.js";
import { initManutencao } from "./ui/manutencao.js";
import { isAutenticado, getPerfil, login, signup, logout, isSuperAdmin } from "./authClient.js";
import { aoExpirarSessao } from "./db.js";
import { t, aplicarTraducoes, IDIOMAS, DEFAULT_IDIOMA } from "./i18n.js";

/* ---------- preencher os placeholders de ícone estáticos do index.html ---------- */
const ICON_ELEMENT_MAP = {
  sidebarToggleIcon: "grid", topbarSearchIcon: "search", viewGridIcon: "grid", viewListIcon: "list",
  refreshIcon: "refresh", plusIcon: "plus", slidersIcon: "sliders", closeIcon1: "close", slidersIcon2: "sliders",
  imgIcon1: "image", capsuleIcon: "capsule", uploadIcon1: "upload", tagIcon1: "tag",
  searchIcon2: "search", plusIcon2: "plus", htmlIcon: "upload", arquivoIcon: "upload",
  imgIcon2: "image", tagIcon2: "tag", imgIcon3: "image", chartIcon: "chart", boxesIcon: "boxes",
  downloadIcon: "download", downloadIcon2: "download", uploadIcon3: "upload", uploadIcon4: "upload",
  alertIcon: "alertTriangle", trashIcon2: "trash", boltIcon: "bolt", logoutIcon: "logout",
  poupancaIcon1: "bolt", chartIcon2: "chart", boxesIcon2: "boxes", poupancaRefreshIcon: "refresh", poupancaPdfIcon: "download",
  manutIcon1: "gear", manutIcon2: "checkCircle", manutIcon3: "download", manutIcon4: "chart",
  idiomaIcon1: "globe", painelAdminIcon: "crown"
};
function preencherIconesEstaticos() {
  Object.entries(ICON_ELEMENT_MAP).forEach(([id, name]) => {
    const elx = document.getElementById(id);
    if (elx) elx.innerHTML = ICONS[name] || "";
  });
}
preencherIconesEstaticos();

/* ---------- store + persistência ---------- */
const store = createStore(reducer, initialState);
const dataStore = makeDataStore();
const actions = createActions(store, dataStore);

/* ---------- elementos DOM ---------- */
const appRoot = document.getElementById("appRoot");
const sidebarContainer = document.getElementById("sidebarContainer");
const sidebarToggle = document.getElementById("sidebarToggle");
const navBackdrop = document.getElementById("navBackdrop");
const crumbContainer = document.getElementById("crumbContainer");
const searchInput = document.getElementById("searchInput");
const selectSort = document.getElementById("selectSort");
const viewToggle = document.getElementById("viewToggle");
const btnRefresh = document.getElementById("btnRefresh");
const btnNovoServico = document.getElementById("btnNovoServico");
const btnAbrirConfig = document.getElementById("btnAbrirConfig");
const btnPainelAdmin = document.getElementById("btnPainelAdmin");
const contentRoot = document.getElementById("contentRoot");
const toastStack = document.getElementById("toastStack");

const modalEls = {
  modalConfig: document.getElementById("modalConfig"),
  btnFecharConfig: document.getElementById("btnFecharConfig"),
  btnFecharConfigX: document.getElementById("btnFecharConfigX"),
  nomeFarmaciaInput: document.getElementById("nomeFarmaciaInput"),
  moradaInput: document.getElementById("moradaInput"),
  cidadeInput: document.getElementById("cidadeInput"),
  emailContactoInput: document.getElementById("emailContactoInput"),
  telefoneContactoInput: document.getElementById("telefoneContactoInput"),
  modalLogoUpload: document.getElementById("modalLogoUpload"),
  modalLogoImg: document.getElementById("modalLogoImg"),
  modalLogoPlaceholder: document.getElementById("modalLogoPlaceholder"),
  servicosListaGestao: document.getElementById("servicosListaGestao"),
  gestaoSearchInput: document.getElementById("gestaoSearchInput"),
  servicoCategoria: document.getElementById("servicoCategoria"),
  btnMostrarFormAdd: document.getElementById("btnMostrarFormAdd"),
  formAddServico: document.getElementById("formAddServico"),
  formTitulo: document.getElementById("formTitulo"),
  servicoNome: document.getElementById("servicoNome"),
  servicoDescricao: document.getElementById("servicoDescricao"),
  servicoUrl: document.getElementById("servicoUrl"),
  htmlFileInput: document.getElementById("htmlFileInput"),
  arquivoFileInput: document.getElementById("arquivoFileInput"),
  imgFileInput: document.getElementById("imgFileInput"),
  imgUrlInput: document.getElementById("imgUrlInput"),
  htmlFileName: document.getElementById("htmlFileName"),
  arquivoFileName: document.getElementById("arquivoFileName"),
  imgFileName: document.getElementById("imgFileName"),
  servicoStatus: document.getElementById("servicoStatus"),
  servicoFavorito: document.getElementById("servicoFavorito"),
  tagsInput: document.getElementById("tagsInput"),
  tagsShell: document.getElementById("tagsShell"),
  formFeedback: document.getElementById("formFeedback"),
  btnCancelarForm: document.getElementById("btnCancelarForm"),
  btnSalvarServico: document.getElementById("btnSalvarServico"),
  categoriasLista: document.getElementById("categoriasLista"),
  novaCategoriaNome: document.getElementById("novaCategoriaNome"),
  novaCategoriaParent: document.getElementById("novaCategoriaParent"),
  novaCategoriaCor: document.getElementById("novaCategoriaCor"),
  novaCategoriaImg: document.getElementById("novaCategoriaImg"),
  novaCategoriaImgNome: document.getElementById("novaCategoriaImgNome"),
  btnAddCategoria: document.getElementById("btnAddCategoria"),
  usageStatsList: document.getElementById("usageStatsList"),
  btnExportar: document.getElementById("btnExportar"),
  inputImportar: document.getElementById("inputImportar"),
  btnResetTudo: document.getElementById("btnResetTudo"),
  idiomaSelect: document.getElementById("idiomaSelect")
};
const modals = initModals(modalEls, store, actions);
initToasts(toastStack, bus);

/* ---------- multi-idioma (ponto 24) ----------
   Os dois seletores (Configurações → Geral, e o do ecrã de "Criar conta")
   são preenchidos uma única vez com a lista fixa de 15 idiomas — cada
   opção mostra o nome do idioma no PRÓPRIO idioma (nomeNativo), para ser
   reconhecível mesmo por quem ainda não percebe o idioma atual da app. */
const signupIdiomaSelect = document.getElementById("signupIdioma");
function preencherSeletorIdiomas(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = IDIOMAS.map(i => `<option value="${i.codigo}">${i.nome}</option>`).join("");
}
preencherSeletorIdiomas(modalEls.idiomaSelect);
preencherSeletorIdiomas(signupIdiomaSelect);
if (signupIdiomaSelect) signupIdiomaSelect.value = DEFAULT_IDIOMA;
modalEls.idiomaSelect?.addEventListener("change", (e) => actions.setIdioma(e.target.value));

/* ---------- painel "Poupança & ROI" ---------- */
const poupancaEls = {
  poupValorHoraInput: document.getElementById("poupValorHoraInput"),
  poupPeriodoInicio: document.getElementById("poupPeriodoInicio"),
  poupPeriodoFim: document.getElementById("poupPeriodoFim"),
  btnPoupAtualizar: document.getElementById("btnPoupAtualizar"),
  poupResumoGrid: document.getElementById("poupResumoGrid"),
  poupCustomResumo: document.getElementById("poupCustomResumo"),
  poupChartTendencia: document.getElementById("poupChartTendencia"),
  poupChartModulos: document.getElementById("poupChartModulos"),
  poupChartTarefas: document.getElementById("poupChartTarefas"),
  poupChartsPeriodo: document.getElementById("poupChartsPeriodo"),
  poupChartTendGranularidade: document.getElementById("poupChartTendGranularidade"),
  poupChartModulosMetrica: document.getElementById("poupChartModulosMetrica"),
  poupChartTarefasMetrica: document.getElementById("poupChartTarefasMetrica"),
  btnPoupExportarPdf: document.getElementById("btnPoupExportarPdf"),
  poupTabelaTarefasBody: document.getElementById("poupTabelaTarefasBody")
};
const poupanca = initPoupanca(poupancaEls, dataStore);
let poupancaCarregadaUmaVez = false;
document.querySelector('#modalConfig .modal-tab[data-tab="poupanca"]')?.addEventListener("click", () => {
  // só recarrega dados do servidor da primeira vez que a aba é aberta nesta
  // sessão — trocar de aba dentro do mesmo modal não deve refazer pedidos.
  if (!poupancaCarregadaUmaVez) { poupancaCarregadaUmaVez = true; poupanca.refrescarTudo(); }
});

/* ---------- painel "Auto-manutenção" (ponto 21/22) ---------- */
const manutencaoEls = {
  btnManutVerificar: document.getElementById("btnManutVerificar"),
  btnManutReparar: document.getElementById("btnManutReparar"),
  manutIntegridadeResultado: document.getElementById("manutIntegridadeResultado"),
  btnManutBackupAgora: document.getElementById("btnManutBackupAgora"),
  manutBackupsLista: document.getElementById("manutBackupsLista"),
  manutSaudeGrid: document.getElementById("manutSaudeGrid")
};
const manutencao = initManutencao(manutencaoEls, dataStore);
let manutencaoCarregadaUmaVez = false;
document.querySelector('#modalConfig .modal-tab[data-tab="manutencao"]')?.addEventListener("click", () => {
  if (!manutencaoCarregadaUmaVez) { manutencaoCarregadaUmaVez = true; manutencao.refrescarTudo(); }
});

/* ---------- paleta de comandos ---------- */
const palette = initPalette(
  { overlay: document.getElementById("paletteOverlay"), input: document.getElementById("paletteInput"), results: document.getElementById("paletteResults") },
  store, actions,
  (q) => {
    const idioma = store.getState().idioma || DEFAULT_IDIOMA;
    const acoes = [
      { tipo: "acao", nome: t("palette.acao_add_servico", idioma), icon: "plus", run: () => { modals.abrirConfig("servicos"); modals.mostrarFormAdd(); } },
      { tipo: "acao", nome: t("palette.acao_abrir_config", idioma), icon: "sliders", run: () => modals.abrirConfig("geral") },
      { tipo: "acao", nome: t("palette.acao_exportar", idioma), icon: "download", run: () => actions.exportarDados() },
      { tipo: "acao", nome: t("palette.acao_alternar_vista", idioma), icon: "grid", run: () => actions.setViewMode(store.getState().viewMode === "grid" ? "list" : "grid") },
      { tipo: "acao", nome: t("palette.acao_ir_inicio", idioma), icon: "home", run: () => actions.setScope({ tipo: "home" }) }
    ];
    return q ? acoes.filter(a => a.nome.toLowerCase().includes(q)) : acoes;
  }
);

/* ---------- painel de navegação (Módulos & Categorias) — agora um overlay,
   não uma coluna sempre visível; abre/fecha em vez de "encolher" ---------- */
function toggleNav(force) {
  const open = typeof force === "boolean" ? force : !appRoot.classList.contains("nav-open");
  appRoot.classList.toggle("nav-open", open);
}
sidebarToggle.addEventListener("click", () => toggleNav());
navBackdrop.addEventListener("click", () => toggleNav(false));
// delegado (o conteúdo de sidebarContainer é substituído a cada render) —
// qualquer elemento com data-close-sidebar fecha o painel.
sidebarContainer.addEventListener("click", (e) => { if (e.target.closest("[data-close-sidebar]")) toggleNav(false); });

/* ---------- handlers partilhados entre a sidebar, a barra de navegação (crumb) e a grelha principal ---------- */
let dragSrcId = null;
let catDragSrcId = null;
const handlers = {
  onSearch: debounce((v) => actions.setSearch(v), 120),
  onNav: (tipo) => { actions.setScope({ tipo }); toggleNav(false); },
  onAbrirModulo: (modulo) => {
    actions.setSearch("");
    searchInput.value = "";
    actions.setScope({ tipo: "modulo", modulo });
    toggleNav(false);
  },
  onSelectCategory: (categoriaId) => {
    expandPathTo(store.getState().categorias, categoriaId);
    actions.setSearch("");
    searchInput.value = "";
    actions.setScope({ tipo: "categoria-direta", categoriaId });
    toggleNav(false);
  },
  onAddCategory: () => modals.abrirConfig("categorias"),
  onAbrir: (id) => actions.abrirEmNovaAba(id),
  onFavorito: (id) => actions.alternarFavorito(id),
  onDragStart: (e, id) => { dragSrcId = id; e.currentTarget.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; },
  onDrop: (id) => { if (dragSrcId !== null && dragSrcId !== id) { actions.reordenarServicos(dragSrcId, id); if (store.getState().sortBy !== "ordem") actions.setSort("ordem"); } },
  onDragEnd: () => { document.querySelectorAll(".card-servico.dragging").forEach(c => c.classList.remove("dragging")); dragSrcId = null; },
  onCategoriaDragStart: (e, id) => { catDragSrcId = id; e.currentTarget.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; },
  onCategoriaDrop: (id) => { if (catDragSrcId !== null && catDragSrcId !== id) actions.reordenarCategorias(catDragSrcId, id); },
  onCategoriaDragEnd: () => { document.querySelectorAll(".cat-card.dragging").forEach(c => c.classList.remove("dragging")); catDragSrcId = null; },
  onEmptyAction: () => {
    if (store.getState().servicos.length === 0) { modals.abrirConfig("servicos"); modals.mostrarFormAdd(); }
    else { searchInput.value = ""; actions.setSearch(""); actions.setScope({ tipo: "home" }); }
  }
};

/* ---------- ligação da topbar ---------- */
searchInput.addEventListener("input", debounce((e) => actions.setSearch(e.target.value), 120));
selectSort.addEventListener("change", () => actions.setSort(selectSort.value));
viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  viewToggle.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  actions.setViewMode(btn.dataset.view);
});
btnRefresh.addEventListener("click", async () => {
  btnRefresh.classList.add("spin-once");
  await actions.recarregarDoServidor();
  setTimeout(() => btnRefresh.classList.remove("spin-once"), 500);
  bus.emit("toast:show", { type: "ok", msg: t("toast.dados_atualizados", store.getState().idioma || DEFAULT_IDIOMA) });
});
btnNovoServico.addEventListener("click", () => { modals.abrirConfig("servicos"); modals.mostrarFormAdd(); });
btnAbrirConfig.addEventListener("click", () => modals.abrirConfig("geral"));

/* ---------- atalhos de teclado ---------- */
document.addEventListener("keydown", (e) => {
  const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette.open(); return; }
  if (e.key === "/" && !isTyping) { e.preventDefault(); searchInput.focus(); return; }
  if (e.key === "Escape") {
    if (palette.isOpen()) palette.close();
    else if (modalEls.modalConfig.classList.contains("active")) modals.fecharConfig();
    else if (appRoot.classList.contains("nav-open")) toggleNav(false);
  }
});

/* ---------- render orquestrado a partir do estado ---------- */
// Só reaplica as traduções ao DOM estático quando o idioma efetivamente
// muda (não em cada render) — aplicarTraducoes() percorre todo o
// document.querySelectorAll("[data-i18n*]"), desnecessário chamar a cada
// tecla premida na pesquisa, por exemplo.
let idiomaAplicado = null;
function renderAll(state) {
  if (!state.pronto) return;
  const idiomaAtual = state.idioma || DEFAULT_IDIOMA;
  if (idiomaAtual !== idiomaAplicado) {
    idiomaAplicado = idiomaAtual;
    aplicarTraducoes(idiomaAtual);
    if (modalEls.idiomaSelect) modalEls.idiomaSelect.value = idiomaAtual;
  }
  renderSidebar(sidebarContainer, state, handlers);
  renderCrumb(crumbContainer, state, handlers);
  renderMainContent(contentRoot, state, handlers);
  searchInput.value = state.searchQuery;
  selectSort.value = state.sortBy;
  viewToggle.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === state.viewMode));
  modals.refreshOnStateChange();
}
store.subscribe(renderAll);

/* ---------- entrada (login / criar conta por farmácia) ---------- */
const loginGate = document.getElementById("loginGate");
const loginTabs = document.getElementById("loginTabs");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginStatusText = document.getElementById("loginStatusText");
const farmaciaLabel = document.getElementById("farmaciaLabel");
const btnLogout = document.getElementById("btnLogout");

function mostrarErroLogin(msg) {
  loginStatusText.textContent = msg;
  loginStatusText.classList.remove("ok");
}

loginTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".login-tab");
  if (!btn) return;
  loginTabs.querySelectorAll(".login-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const isSignup = btn.dataset.tab === "signup";
  loginForm.hidden = isSignup;
  signupForm.hidden = !isSignup;
  loginStatusText.textContent = "";
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("loginSubmit");
  btn.disabled = true;
  try {
    const perfil = await login({ email: document.getElementById("loginEmail").value, password: document.getElementById("loginPassword").value });
    await entrarNaApp(perfil);
  } catch (err) {
    mostrarErroLogin(err.message || "Não foi possível iniciar sessão.");
  } finally { btn.disabled = false; }
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("signupSubmit");
  btn.disabled = true;
  try {
    const perfil = await signup({
      nomeFarmacia: document.getElementById("signupNomeFarmacia").value,
      email: document.getElementById("signupEmail").value,
      password: document.getElementById("signupPassword").value
    });
    await entrarNaApp(perfil, signupIdiomaSelect ? signupIdiomaSelect.value : null);
  } catch (err) {
    mostrarErroLogin(err.message || "Não foi possível criar a conta.");
  } finally { btn.disabled = false; }
});

btnLogout.addEventListener("click", () => {
  logout();
  location.reload();
});

// Ponto 54 — Painel Developer/Super-Admin: o botão só aparece para a(s)
// conta(s) cujo email está em SUPER_ADMIN_EMAILS (ver _lib/auth.js). A
// própria página do painel volta a verificar isto junto do servidor —
// isto aqui é só para não mostrar o botão a quem não vai poder usá-lo.
if (btnPainelAdmin) {
  if (isSuperAdmin()) btnPainelAdmin.hidden = false;
  btnPainelAdmin.addEventListener("click", () => { location.href = "modulos/admin-central.html"; });
}

// se o servidor recusar o token (expirado/inválido) a meio da sessão, volta ao ecrã de entrada
aoExpirarSessao(() => {
  bus.emit("toast:show", { type: "err", msg: t("toast.sessao_expirada", store.getState().idioma || DEFAULT_IDIOMA) });
  setTimeout(() => location.reload(), 600);
});

async function entrarNaApp(perfil, idiomaEscolhidoNoRegisto) {
  loginStatusText.textContent = "";
  loginGate.hidden = true;
  appRoot.hidden = false;
  farmaciaLabel.textContent = perfil?.nomeFarmacia || getPerfil()?.nomeFarmacia || "";
  await arrancarCentral();
  // Idioma escolhido no ato de criação de conta (ponto 24) — gravado depois
  // de iniciar() para garantir que fica com precedência sobre o "pt" por
  // omissão que iniciar() usaria para uma conta ainda sem config.idioma.
  if (idiomaEscolhidoNoRegisto) await actions.setIdioma(idiomaEscolhidoNoRegisto);
}

async function arrancarCentral() {
  try {
    await initRemote();
    await migrarDadosLocaisSeNecessario(dataStore, CATEGORIAS_PADRAO);
    await actions.iniciar();
    // Cópia de segurança automática diária (ponto 21/22) — silenciosa,
    // best-effort, nunca bloqueia o arranque da app.
    manutencao.iniciarBackupAutomatico();
  } catch (err) {
    console.error("Falha ao iniciar a Central:", err);
    bus.emit("toast:show", { type: "err", msg: t("toast.erro_arrancar", store.getState().idioma || DEFAULT_IDIOMA) });
  }
}

/* ---------- arranque ---------- */
if (isAutenticado()) {
  loginGate.hidden = true;
  appRoot.hidden = false;
  farmaciaLabel.textContent = getPerfil()?.nomeFarmacia || "";
  arrancarCentral();
} else {
  loginGate.hidden = false;
  appRoot.hidden = true;
}

// Ponto 52 — sinal de "app pronta" para o fallback de arranque definido em
// index.html: confirma que este módulo (e todos os que importa) carregou e
// executou até ao fim sem exceções. Não espera pelo carregamento assíncrono
// dos dados (initRemote/actions.iniciar) — esses erros já têm o seu próprio
// tratamento (try/catch + toast em arrancarCentral()); este sinal cobre
// apenas o caso "ficheiro em falta / script partido", que antes deixava um
// ecrã em branco sem qualquer pista.
if (typeof window !== "undefined") window.__centralAppReady = true;

/* ---------- sincronização entre computadores -----------
   A app grava sempre no servidor partilhado (Netlify Blobs), mas outros
   computadores só veem as alterações quando voltam a pedir os dados. Para
   isso acontecer sem esforço manual: */
// 1) ao voltar a esta aba depois de estar em segundo plano
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && store.getState().pronto && store.getState().syncStatus === "synced" && !modalEls.modalConfig.classList.contains("active")) {
    actions.recarregarDoServidor();
  }
});
// 2) periodicamente, em fundo, sem incomodar quem está a editar
setInterval(() => {
  if (!document.hidden && store.getState().pronto && store.getState().syncStatus === "synced" && !modalEls.modalConfig.classList.contains("active") && !palette.isOpen()) {
    actions.recarregarDoServidor();
  }
}, 25000);

/* ---------- service worker (carregamentos instantâneos em visitas repetidas) ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker não registado:", err));
  });
}
