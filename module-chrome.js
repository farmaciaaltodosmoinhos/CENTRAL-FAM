/* =====================================================================
   MODULE CHROME (JS) — ver assets/module-chrome.css para o contexto.
   Sem dependências, sem módulos ES — carregado com <script defer> em
   cada modulos/*.html, antes do script próprio do módulo.
   ===================================================================== */
(function () {
  "use strict";

  function embedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  // O link antigo "← Voltar à Central" (.module-back) só faz sentido quando
  // o módulo é aberto sozinho (fora da Central) — dentro do <iframe> da
  // Central, o "Início" já está sempre visível por cima, por isso o link
  // ficava redundante e, em alguns módulos, sobreposto a outros elementos.
  function initStandaloneBar() {
    var legacyBack = document.querySelector(".module-back");
    if (legacyBack) legacyBack.style.display = "none";
    if (!embedded()) {
      var bar = document.getElementById("mcStandaloneBar");
      if (bar) bar.classList.add("mc-show");
    }
  }

  // Monta (uma vez) a barra inferior fixa com a navegação interna do
  // módulo. `items`: [{id, icon, label, onSelect}]. `opts.onBack`, se
  // definido, mostra também um botão "‹ Voltar" à esquerda (para navegação
  // dentro do próprio módulo, ex.: sair do detalhe de um utente).
  function mountBottomBar(items, opts) {
    opts = opts || {};
    var bar = document.getElementById("mcBottomBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "mc-bottom-bar";
      bar.id = "mcBottomBar";
      document.body.appendChild(bar);
    }
    document.body.classList.add("mc-has-bottom-bar");

    function render(activeId) {
      bar.innerHTML = "";
      if (opts.onBack) {
        var back = document.createElement("button");
        back.type = "button";
        back.className = "mc-bb-back";
        back.textContent = "‹ Voltar";
        back.addEventListener("click", opts.onBack);
        bar.appendChild(back);
      }
      items.forEach(function (it) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mc-bb-item" + (it.id === activeId ? " active" : "");
        btn.innerHTML = '<span class="mc-bb-icon">' + (it.icon || "•") + "</span><span>" + it.label + "</span>";
        btn.addEventListener("click", function () { if (it.onSelect) it.onSelect(); });
        bar.appendChild(btn);
      });
    }
    render(opts.activeId);
    return { setActive: function (id) { render(id); } };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initStandaloneBar);
  else initStandaloneBar();

  /* =====================================================================
     BRANDING (nome + logótipo da farmácia) — cache local + carregamento
     desacoplado do estado geral.

     Antes, cada módulo lia `config.logo` (base64, até ~930KB) de dentro do
     MESMO JSON devolvido por GET /api/data — o mesmo pedido que traz
     serviços, categorias e os dados do próprio módulo. Isso significava
     transferir quase 1MB extra em TODAS as páginas/módulos só para mostrar
     o logótipo, e outra vez em cada gravação (o "gravarX" de cada módulo
     reenvia o `config` completo para não apagar outros campos).

     Agora o logótipo vive no seu próprio blob (/api/asset/branding-logo,
     já suportado pelo servidor, isolado da junção de `config`) e o cliente
     guarda uma cópia em localStorage: a primeira pintura do cabeçalho é
     instantânea (0ms, sem rede) e só depois é confirmada/atualizada a
     partir do servidor. */
  var BRANDING_CACHE_KEY = "central_saas_branding_cache_v1";

  /** Lê a cache sem tocar no DOM — para módulos cujo aplicarBrandingFarmacia()
   *  próprio já sabe tratar de tudo (ex.: atualizar FARMACIA_LOGO_SRC,
   *  mostrar/esconder um emblema, avisar a exportação Excel/PDF). */
  function getCachedBranding() {
    try {
      var raw = localStorage.getItem(BRANDING_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function paintCachedBranding(logoImgId, nameElId) {
    try {
      var raw = localStorage.getItem(BRANDING_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (logoImgId && cached.logo) {
        var img = document.getElementById(logoImgId);
        if (img) img.src = cached.logo;
      }
      if (nameElId && cached.nomeFarmacia) {
        var el = document.getElementById(nameElId);
        if (el) el.textContent = cached.nomeFarmacia;
      }
      return cached;
    } catch (e) { return null; }
  }

  function cacheBranding(nomeFarmacia, logo) {
    try {
      localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify({ nomeFarmacia: nomeFarmacia || null, logo: logo || null, ts: Date.now() }));
    } catch (e) { /* localStorage indisponível (modo privado, quota) — ignora, não é crítico */ }
  }

  /** Vai buscar só o logótipo (blob próprio, nunca o resto do estado). Devolve null em caso de erro/404. */
  async function fetchLogoAsset(token) {
    try {
      var res = await fetch("/api/asset/branding-logo", { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
      if (!res.ok) return null;
      var data = await res.json();
      return data.content || null;
    } catch (e) { return null; }
  }

  /* =====================================================================
     REGISTO DE USO (módulo de Poupança & ROI) — cada módulo chama
     `window.ModuleChrome.registarUso(modulo, tarefaId, qtd)` sempre que
     conclui uma tarefa rastreável (ver src/usoCatalogo.js para o catálogo
     de tarefas e as estimativas de tempo poupado).

     Para não fazer um pedido à rede por cada clique, as contagens ficam em
     memória e só são enviadas (mescladas com o que já estiver gravado) de
     4 em 4 segundos após o último registo, e ainda de propósito quando a
     página fica escondida/fecha — nunca bloqueia a interação do utilizador.
     Guardado num blob por mês (`uso-AAAA-MM`) no asset store próprio desta
     farmácia, nunca no estado geral (`/api/data`) — o mesmo princípio do
     logótipo (ver ponto 15 da arquitetura): um registo que cresce todos os
     dias não pode viver dentro do JSON que é relido/reenviado a cada
     gravação de qualquer outro módulo. */
  var TOKEN_KEY = "central_saas_token";
  function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function usoMesChave(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }
  function usoDiaChave(d) { return usoMesChave(d) + "-" + pad2(d.getDate()); }

  var USO_PENDENTES = {}; // { "AAAA-MM": { "AAAA-MM-DD": { "modulo.tarefa": qtd } } }
  var USO_FLUSH_TIMER = null;
  var USO_FLUSH_EM_CURSO = false;

  function usoMesclarDias(destino, origem) {
    Object.keys(origem).forEach(function (dia) {
      var atual = destino[dia] || {};
      var novo = origem[dia];
      Object.keys(novo).forEach(function (chave) { atual[chave] = (atual[chave] || 0) + novo[chave]; });
      destino[dia] = atual;
    });
    return destino;
  }

  function registarUso(modulo, tarefaId, qtd) {
    qtd = qtd || 1;
    if (!modulo || !tarefaId || qtd <= 0) return;
    var agora = new Date();
    var mesChave = usoMesChave(agora), diaChave = usoDiaChave(agora);
    var chaveTarefa = modulo + "." + tarefaId;
    if (!USO_PENDENTES[mesChave]) USO_PENDENTES[mesChave] = {};
    if (!USO_PENDENTES[mesChave][diaChave]) USO_PENDENTES[mesChave][diaChave] = {};
    USO_PENDENTES[mesChave][diaChave][chaveTarefa] = (USO_PENDENTES[mesChave][diaChave][chaveTarefa] || 0) + qtd;
    agendarFlushUso();
  }

  function agendarFlushUso() {
    if (USO_FLUSH_TIMER) return;
    // 2s (não 4s): testado empiricamente que o fetch do flush no 'pagehide'
    // (ao navegar para fora do módulo) pode ser abortado pelo próprio browser
    // a meio do GET, mesmo com keepalive:true — nesse caso o delta fica
    // reposto em USO_PENDENTES para nova tentativa (nunca perde dados já
    // gravados), mas se a página for fechada/navegada ANTES do próximo
    // flush, essa última ação em concreto pode não chegar a ser contada.
    // Encurtar a janela de debounce reduz (não elimina) esse risco.
    USO_FLUSH_TIMER = setTimeout(function () { USO_FLUSH_TIMER = null; flushUso(); }, 2000);
  }

  async function flushUso() {
    if (USO_FLUSH_EM_CURSO) { agendarFlushUso(); return; }
    var mesesPendentes = Object.keys(USO_PENDENTES);
    if (!mesesPendentes.length) return;
    var token = getToken();
    if (!token) { USO_PENDENTES = {}; return; } // sem sessão (ex.: módulo aberto standalone sem login) — não há onde gravar
    USO_FLUSH_EM_CURSO = true;
    try {
      for (var i = 0; i < mesesPendentes.length; i++) {
        var mesChave = mesesPendentes[i];
        var deltaDias = USO_PENDENTES[mesChave];
        delete USO_PENDENTES[mesChave];
        try {
          var chaveAsset = "uso-" + mesChave;
          var atual = { dias: {} };
          // keepalive:true no GET (além do PUT) porque este flush corre muitas
          // vezes a partir de 'pagehide' (o utilizador a navegar para fora do
          // módulo) — sem keepalive, o browser pode abortar o GET a meio por
          // causa do descarregamento da página, e sem isto o código cairia no
          // catch de baixo a assumir "vazio", perdendo no PUT seguinte tudo o
          // que já tinha sido gravado neste mês por flushes anteriores.
          var res = await fetch("/api/asset/" + encodeURIComponent(chaveAsset), { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, keepalive: true });
          if (res.ok) {
            var data = await res.json();
            if (data && data.content) atual = JSON.parse(data.content);
          } else if (res.status !== 404) {
            // qualquer erro que não seja "ainda não existe" (ex.: rede caiu a
            // meio, 401/500) não deve resultar numa gravação a partir de uma
            // base vazia — melhor reagendar e tentar de novo do que arriscar
            // apagar dados de uso já persistidos.
            throw new Error("GET do blob de uso respondeu com estado " + res.status);
          }
          if (!atual || typeof atual !== "object") atual = { dias: {} };
          if (!atual.dias || typeof atual.dias !== "object") atual.dias = {};
          usoMesclarDias(atual.dias, deltaDias);
          await fetch("/api/asset/" + encodeURIComponent(chaveAsset), {
            method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ content: JSON.stringify(atual) }),
            keepalive: true
          });
        } catch (e) {
          // falhou a gravar este mês — repõe o delta para tentar de novo depois
          USO_PENDENTES[mesChave] = usoMesclarDias(USO_PENDENTES[mesChave] || {}, deltaDias);
        }
      }
    } finally {
      USO_FLUSH_EM_CURSO = false;
      if (Object.keys(USO_PENDENTES).length) agendarFlushUso();
    }
  }

  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushUso(); });
  window.addEventListener("pagehide", function () { flushUso(); });

  /* =====================================================================
     LEITURA DE CÓDIGOS DE BARRAS (câmara) — DataMatrix + QR, partilhado
     entre a Gestão de Gabinete (leitor GS1) e a Gestão de PIM (leitor GS1
     + scan de embalagem para pré-preencher o formulário de Medicamento) —
     os 3 pontos da Central que abrem a câmara para ler um código.

     Até aqui as 3 câmaras usavam só `jsQR`, que lê exclusivamente QR — mas
     a esmagadora maioria das embalagens reais de medicamentos (norma
     europeia EU-FMD) usa a simbologia **DataMatrix**, que o jsQR não
     consegue ler de todo (limitação identificada e documentada, não
     corrigida, no ponto 16/17 da arquitetura). Este bloco resolve isso:

     1. Tenta primeiro a API nativa do browser (`BarcodeDetector`), quando
        disponível E com suporte a `data_matrix` — mais rápida por correr
        no motor do próprio SO, sem carregar nem executar WebAssembly.
        Só existe em macOS/ChromeOS/Android com Google Play Services;
        **não existe no Windows** (o SO mais comum nas farmácias), por
        isso não pode ser a única via.
     2. Sempre que a via nativa não está disponível (ou não encontra nada
        nesta frame), cai para `zxing-wasm` — porto WebAssembly do
        zxing-cpp (o motor de referência), que lê DataMatrix e QR na
        mesma chamada com muito mais precisão do que qualquer porto
        puro-JS antigo (jsQR/zxing-js). Único ponto deste projeto servido
        do jsDelivr em vez do cdnjs (não está publicado no cdnjs); o CSP
        do site já permite qualquer CDN por https, não só o cdnjs (ver
        `script-src` em netlify.toml), por isso isto funciona em produção
        tal como todos os outros `ensureXxx` deste ficheiro.

     Por omissão, o zxing-wasm devolve o texto já em modo "HRI" (Human
     Readable Interpretation) para códigos GS1 — cada elemento aparece
     entre parênteses, ex. "(01)...(17)...(10)...(714)...", já sem
     ambiguidade nenhuma de onde começa/acaba cada campo. `parseGS1`
     (gabinete.html/pim.html) tira partido disto: tenta primeiro este
     formato (inequívoco) e só cai para a heurística antiga (por posição/
     comprimento) quando o texto não vem entre parênteses — ex. colado à
     mão, ou vindo de um QR gerado sem essa formatação. */
  var ZXING_CDN = "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/iife/reader/index.js";
  function ensureBarcodeLib(cb, errCb) {
    if (window.ZXingWASM) { cb(); return; }
    var s = document.createElement("script");
    s.src = ZXING_CDN;
    s.onload = cb;
    s.onerror = function () { if (errCb) errCb(); };
    document.head.appendChild(s);
  }

  var NATIVE_BC_FORMATOS = null; // null=por verificar, false=indisponível, array=formatos suportados
  async function formatosNativosSuportados() {
    if (NATIVE_BC_FORMATOS !== null) return NATIVE_BC_FORMATOS;
    try {
      if (!("BarcodeDetector" in window)) { NATIVE_BC_FORMATOS = false; return false; }
      var suportados = await window.BarcodeDetector.getSupportedFormats();
      NATIVE_BC_FORMATOS = (suportados.indexOf("data_matrix") !== -1) ? suportados : false;
    } catch (e) { NATIVE_BC_FORMATOS = false; }
    return NATIVE_BC_FORMATOS;
  }

  /** Tenta descodificar um DataMatrix/QR a partir de uma frame já desenhada
   *  num <canvas>: `canvas` serve a API nativa (aceita qualquer
   *  ImageBitmapSource), `imageData` (o mesmo frame, via
   *  ctx.getImageData) serve o zxing-wasm. Devolve uma Promise que
   *  resolve para o texto lido, ou null se esta frame não tinha nenhum
   *  código legível — nunca rejeita (é normal falhar em quase todas as
   *  frames até o utilizador enquadrar bem o código). */
  async function decodeBarcodeFrame(canvas, imageData) {
    var formatos = await formatosNativosSuportados();
    if (formatos) {
      try {
        var det = new window.BarcodeDetector({ formats: formatos.filter(function (f) { return f === "data_matrix" || f === "qr_code"; }) });
        var resultados = await det.detect(canvas);
        if (resultados && resultados.length && resultados[0].rawValue) return resultados[0].rawValue;
      } catch (e) { /* cai para o zxing-wasm abaixo */ }
    }
    if (window.ZXingWASM) {
      try {
        var out = await window.ZXingWASM.readBarcodesFromImageData(imageData, {
          formats: ["DataMatrix", "QRCode"], tryHarder: true, maxNumberOfSymbols: 1, textMode: "HRI"
        });
        if (out && out.length && out[0].isValid && out[0].text) return out[0].text;
      } catch (e) { /* nenhum código nesta frame — normal, tenta-se de novo na próxima */ }
    }
    return null;
  }

  window.ModuleChrome = {
    mountBottomBar: mountBottomBar,
    embedded: embedded,
    paintCachedBranding: paintCachedBranding,
    getCachedBranding: getCachedBranding,
    cacheBranding: cacheBranding,
    fetchLogoAsset: fetchLogoAsset,
    registarUso: registarUso,
    ensureBarcodeLib: ensureBarcodeLib,
    decodeBarcodeFrame: decodeBarcodeFrame
  };
})();
