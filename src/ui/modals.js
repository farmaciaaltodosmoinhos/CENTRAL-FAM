import { escapeHtml, debounce, placeholderImg, deveAdiarRenderizacao } from "../utils.js";
import { icon } from "../icons.js";
import { buildCategoryTree, getCategoriaNome, getMaisUsados, podeSerPai, CATEGORIA_INDEFINIDA_ID } from "../domain.js";
import { bus } from "../events.js";
import { t, DEFAULT_IDIOMA } from "../i18n.js";

function lerArquivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Nenhum arquivo fornecido"));
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Erro ao ler o ficheiro."));
    reader.readAsDataURL(file);
  });
}
function lerArquivoComoTexto(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Nenhum arquivo fornecido"));
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Erro ao ler HTML."));
    reader.readAsText(file, "UTF-8");
  });
}

/**
 * As imagens (logótipo, botão de serviço, imagem de categoria) ficam
 * embutidas em base64 dentro do estado geral — ao contrário do conteúdo
 * HTML, não têm um blob próprio. Um limite generoso aqui evita que uma
 * fotografia grande, sem querer, comece a aproximar o estado geral do
 * limite de tamanho do pedido (o mesmo problema que afetava os HTML antes
 * de terem passado a ter um blob próprio).
 */
const LIMITE_IMAGEM_KB = 700;
function validarTamanhoImagem(file) {
  const tamanhoKB = file.size / 1024;
  if (tamanhoKB > LIMITE_IMAGEM_KB) {
    throw new Error(`Imagem demasiado grande (${(tamanhoKB / 1024).toFixed(1)}MB). Use uma imagem até ${(LIMITE_IMAGEM_KB / 1024).toFixed(1)}MB (ex.: redimensione ou comprima antes de carregar).`);
  }
}

export function initModals(el, store, actions) {
  let editandoId = null;
  let editandoTipoOriginal = null;
  let tagsAtuais = [];
  let categoriaImagemPendente = null;

  function st() { return store.getState(); }
  function tm(chave, vars) { return t(chave, st().idioma || DEFAULT_IDIOMA, vars); }

  /* ---------------- abrir/fechar ---------------- */
  function abrirConfig(tab = "geral") {
    el.nomeFarmaciaInput.value = st().nomeFarmacia || "";
    el.moradaInput.value = st().morada || "";
    el.cidadeInput.value = st().cidade || "";
    el.emailContactoInput.value = st().emailContacto || "";
    el.telefoneContactoInput.value = st().telefoneContacto || "";
    if (el.idiomaSelect) el.idiomaSelect.value = st().idioma || "pt";
    renderServicosGestao("");
    renderCategoriasGestao();
    renderUsageStats();
    resetForm();
    mudarTab(tab);
    el.modalConfig.classList.add("active");
  }
  function fecharConfig() { el.modalConfig.classList.remove("active"); }
  function mudarTab(tab) {
    el.modalConfig.querySelectorAll(".modal-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    el.modalConfig.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + tab));
  }
  el.modalConfig.querySelectorAll(".modal-tab").forEach(t => t.addEventListener("click", () => mudarTab(t.dataset.tab)));
  el.btnFecharConfig.addEventListener("click", fecharConfig);
  el.btnFecharConfigX.addEventListener("click", fecharConfig);
  el.modalConfig.addEventListener("click", (e) => { if (e.target === el.modalConfig) fecharConfig(); });

  /* ---------------- geral ---------------- */
  el.nomeFarmaciaInput.addEventListener("change", (e) => actions.setNomeFarmacia(e.target.value.trim() || "Farmácia"));
  el.moradaInput.addEventListener("change", (e) => actions.setMorada(e.target.value.trim()));
  el.cidadeInput.addEventListener("change", (e) => actions.setCidade(e.target.value.trim()));
  el.emailContactoInput.addEventListener("change", (e) => actions.setEmailContacto(e.target.value.trim()));
  el.telefoneContactoInput.addEventListener("change", (e) => actions.setTelefoneContacto(e.target.value.trim()));
  el.modalLogoUpload.addEventListener("change", async (e) => {
    if (!e.target.files.length) return;
    try {
      validarTamanhoImagem(e.target.files[0]);
      await actions.setLogo(await lerArquivoComoBase64(e.target.files[0]));
      renderLogoPreviewModal();
    }
    catch (err) { bus.emit("toast:show", { type: "err", msg: "Erro ao alterar logótipo: " + err.message }); }
  });
  function renderLogoPreviewModal() {
    const s = st();
    if (s.logoBase64) { el.modalLogoImg.src = s.logoBase64; el.modalLogoImg.style.display = "block"; el.modalLogoPlaceholder.style.display = "none"; }
  }

  /* ---------------- gestão de serviços ---------------- */
  el.gestaoSearchInput.addEventListener("input", debounce((e) => renderServicosGestao(e.target.value), 120));

  function renderServicosGestao(filtro) {
    const q = (filtro || "").toLowerCase();
    const lista = st().servicos.filter(s => !q || s.nome.toLowerCase().includes(q));
    if (!lista.length) { el.servicosListaGestao.innerHTML = `<div style='padding:14px;text-align:center;color:var(--text-soft);'>${escapeHtml(tm("config.servicos.sem_resultados"))}</div>`; return; }
    el.servicosListaGestao.innerHTML = lista.slice().sort((a, b) => a.ordem - b.ordem).map(s => {
      const img = s.imagemBase64 || s.imagemUrl || placeholderImg(s.nome);
      const catNome = getCategoriaNome(st().categorias, s.categoriaId || CATEGORIA_INDEFINIDA_ID);
      const badgeStatus = s.status !== "ativo" ? `<span class="mini-badge status-${s.status}">${s.status}</span>` : "";
      const badgeTipo = s.tipo === "arquivo" ? `<span class="mini-badge" title="${escapeHtml(s.arquivoNome || "")}">${icon("upload")} ${escapeHtml(s.arquivoNome || "ficheiro")}</span>` : "";
      return `<div class="servico-item" data-id="${s.id}">
          <div class="servico-info">
            <img src="${img}" onerror="this.src='${placeholderImg(s.nome)}'">
            <div class="servico-info-text">
              <span class="si-nome">${escapeHtml(s.nome)}</span>
              <span class="si-meta"><span class="mini-badge">${escapeHtml(catNome)}</span> ${badgeStatus} ${badgeTipo} ${s.contadorAcessos ? s.contadorAcessos + "× usado" : ""}</span>
            </div>
          </div>
          <div class="servico-actions">
            <button class="btn-edit-servico" data-id="${s.id}" title="${escapeHtml(tm("config.servicos.editar_title"))}">${icon("edit")}</button>
            <button class="btn-delete btn-delete-servico" data-id="${s.id}" title="${escapeHtml(tm("config.servicos.excluir_title"))}">${icon("trash")}</button>
          </div>
        </div>`;
    }).join("");
    el.servicosListaGestao.querySelectorAll(".btn-edit-servico").forEach(btn => btn.addEventListener("click", () => editarServico(btn.dataset.id)));
    el.servicosListaGestao.querySelectorAll(".btn-delete-servico").forEach(btn => btn.addEventListener("click", () => {
      if (confirm(tm("config.servicos.confirmar_excluir"))) { actions.removerServico(btn.dataset.id); renderServicosGestao(el.gestaoSearchInput.value); }
    }));
  }

  function renderCategoriaSelect() {
    const cats = st().categorias.slice().sort((a, b) => a.ordem - b.ordem);
    el.servicoCategoria.innerHTML = cats.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("")
      + `<option value="${CATEGORIA_INDEFINIDA_ID}">Categoria Indefinida</option>`;
  }

  el.btnMostrarFormAdd.addEventListener("click", mostrarFormAdd);
  function mostrarFormAdd() { resetForm(); el.formAddServico.style.display = "block"; el.btnMostrarFormAdd.style.display = "none"; el.servicoNome.focus(); }
  el.btnCancelarForm.addEventListener("click", resetForm);

  function resetForm() {
    editandoId = null; editandoTipoOriginal = null; tagsAtuais = [];
    el.formTitulo.innerText = tm("config.servicos.form_titulo_adicionar");
    el.servicoNome.value = ""; el.servicoDescricao.value = ""; el.servicoUrl.value = "";
    el.htmlFileInput.value = ""; el.arquivoFileInput.value = ""; el.imgFileInput.value = ""; el.imgUrlInput.value = "";
    el.htmlFileName.innerText = ""; el.arquivoFileName.innerText = ""; el.imgFileName.innerText = "";
    el.servicoStatus.value = "ativo"; el.servicoFavorito.checked = false; el.tagsInput.value = "";
    renderCategoriaSelect();
    if (el.servicoCategoria.options.length) el.servicoCategoria.value = st().categorias[0] ? st().categorias[0].id : CATEGORIA_INDEFINIDA_ID;
    renderTags();
    el.formFeedback.innerText = ""; el.formFeedback.className = "feedback";
    el.formAddServico.style.display = "none"; el.btnMostrarFormAdd.style.display = "inline-flex";
  }

  function renderTags() {
    el.tagsShell.querySelectorAll(".tag-pill").forEach(p => p.remove());
    tagsAtuais.forEach((tag, i) => {
      const pill = document.createElement("span");
      pill.className = "tag-pill";
      pill.innerHTML = `${escapeHtml(tag)} <button type="button" data-i="${i}">${icon("x")}</button>`;
      el.tagsShell.insertBefore(pill, el.tagsInput);
    });
    el.tagsShell.querySelectorAll("[data-i]").forEach(btn => btn.addEventListener("click", () => { tagsAtuais.splice(parseInt(btn.dataset.i), 1); renderTags(); }));
  }
  el.tagsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = e.target.value.trim().replace(/,$/, "");
      if (v && !tagsAtuais.includes(v)) { tagsAtuais.push(v); renderTags(); }
      e.target.value = "";
    } else if (e.key === "Backspace" && !e.target.value && tagsAtuais.length) { tagsAtuais.pop(); renderTags(); }
  });

  function editarServico(id) {
    const serv = st().servicos.find(s => s.id === id);
    if (!serv) return;
    editandoId = id; editandoTipoOriginal = serv.tipo; tagsAtuais = (serv.tags || []).slice();
    el.formTitulo.innerText = tm("config.servicos.form_titulo_editar");
    el.servicoNome.value = serv.nome; el.servicoDescricao.value = serv.descricao || "";
    el.servicoUrl.value = serv.tipo === "url" ? (serv.url || "") : "";
    el.imgUrlInput.value = serv.imagemUrl || "";
    el.htmlFileInput.value = ""; el.arquivoFileInput.value = ""; el.imgFileInput.value = "";
    el.htmlFileName.innerText = serv.tipo === "html" ? "Conteúdo HTML atual (substitui se enviar novo)" : "";
    el.arquivoFileName.innerText = serv.tipo === "arquivo" ? `Ficheiro atual: ${serv.arquivoNome || "sem nome"} (substitui se enviar novo)` : "";
    el.imgFileName.innerText = "";
    el.servicoStatus.value = serv.status || "ativo"; el.servicoFavorito.checked = !!serv.favorito;
    renderCategoriaSelect();
    el.servicoCategoria.value = serv.categoriaId || CATEGORIA_INDEFINIDA_ID;
    renderTags();
    el.formFeedback.innerText = "";
    el.formAddServico.style.display = "block"; el.btnMostrarFormAdd.style.display = "none";
    el.formAddServico.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  window.__editarServicoViaSidebarOuGrid = editarServico;

  el.htmlFileInput.addEventListener("change", (e) => { el.htmlFileName.innerText = e.target.files.length ? `Ficheiro: ${e.target.files[0].name}` : ""; });
  el.arquivoFileInput.addEventListener("change", (e) => { el.arquivoFileName.innerText = e.target.files.length ? `Ficheiro: ${e.target.files[0].name}` : ""; });
  el.imgFileInput.addEventListener("change", (e) => { el.imgFileName.innerText = e.target.files.length ? `Imagem: ${e.target.files[0].name}` : ""; });

  let salvando = false;
  el.btnSalvarServico.addEventListener("click", async () => {
    if (salvando) { el.formFeedback.textContent = "A guardar, aguarde..."; el.formFeedback.className = "feedback warn"; return; }
    salvando = true;
    const originalHtml = el.btnSalvarServico.innerHTML;
    el.btnSalvarServico.innerHTML = "A guardar...";
    el.btnSalvarServico.disabled = true;
    try {
      const nome = el.servicoNome.value.trim();
      if (!nome) { el.formFeedback.textContent = tm("config.servicos.nome_obrigatorio"); el.formFeedback.className = "feedback err"; return; }

      let imagemBase64 = null, imagemUrl = el.imgUrlInput.value.trim() || null;
      if (el.imgFileInput.files.length > 0) {
        try {
          validarTamanhoImagem(el.imgFileInput.files[0]);
          imagemBase64 = await lerArquivoComoBase64(el.imgFileInput.files[0]);
          imagemUrl = null;
        } catch (err) {
          el.formFeedback.textContent = err.message;
          el.formFeedback.className = "feedback err";
          return;
        }
      }

      // Resolução do tipo do serviço: um novo ficheiro (HTML ou genérico) ou
      // uma URL preenchida têm sempre prioridade (o utilizador escolheu
      // ativamente mudar o conteúdo). Se estivermos a EDITAR um serviço que
      // já era do tipo HTML/ficheiro e nada disto foi fornecido, o tipo e o
      // conteúdo existentes mantêm-se — sem isto, guardar qualquer alteração
      // (ex.: só o nome) sem voltar a carregar o ficheiro transformava-o
      // silenciosamente num serviço "URL" vazio e partido.
      let tipo, urlFinal = el.servicoUrl.value.trim(), htmlContent, arquivoBase64, arquivoNome;
      const novoFicheiroHtml = el.htmlFileInput.files.length > 0;
      const novoArquivoGenerico = el.arquivoFileInput.files.length > 0;

      if (novoFicheiroHtml) {
        try { htmlContent = await lerArquivoComoTexto(el.htmlFileInput.files[0]); }
        catch (err) { el.formFeedback.textContent = err.message; el.formFeedback.className = "feedback err"; return; }
        tipo = "html"; urlFinal = null;
      } else if (novoArquivoGenerico) {
        try {
          arquivoBase64 = await lerArquivoComoBase64(el.arquivoFileInput.files[0]);
          arquivoNome = el.arquivoFileInput.files[0].name;
        } catch (err) { el.formFeedback.textContent = err.message; el.formFeedback.className = "feedback err"; return; }
        tipo = "arquivo"; urlFinal = null;
      } else if (urlFinal) {
        tipo = "url"; htmlContent = null; arquivoBase64 = null;
      } else if (editandoId !== null && editandoTipoOriginal === "html") {
        tipo = "html"; htmlContent = undefined; // undefined = não mexer no conteúdo já guardado
      } else if (editandoId !== null && editandoTipoOriginal === "arquivo") {
        tipo = "arquivo"; arquivoBase64 = undefined; arquivoNome = undefined; // idem
      } else if (editandoId === null) {
        el.formFeedback.textContent = "Forneça uma URL ou carregue um ficheiro (HTML, PDF, Word, Excel...).";
        el.formFeedback.className = "feedback err";
        return;
      } else {
        tipo = editandoTipoOriginal || "url"; // outros casos de edição: preserva o tipo atual
        htmlContent = undefined; arquivoBase64 = undefined;
      }

      const dados = {
        nome, descricao: el.servicoDescricao.value.trim(), tipo, url: urlFinal,
        imagemBase64, imagemUrl, categoriaId: el.servicoCategoria.value, tags: tagsAtuais.slice(),
        favorito: el.servicoFavorito.checked, status: el.servicoStatus.value
      };
      if (htmlContent !== undefined) dados.htmlContent = htmlContent;
      if (arquivoBase64 !== undefined) dados.arquivoBase64 = arquivoBase64;
      if (arquivoNome !== undefined) dados.arquivoNome = arquivoNome;
      const aoProgredir = (parte, total) => {
        el.formFeedback.textContent = `A enviar ficheiro grande: parte ${parte} de ${total}...`;
        el.formFeedback.className = "feedback warn";
      };
      if (editandoId !== null) await actions.atualizarServico(editandoId, dados, aoProgredir);
      else await actions.criarServico(dados, aoProgredir);

      renderServicosGestao(el.gestaoSearchInput.value);
      resetForm();
      el.formFeedback.textContent = "";
      el.formFeedback.className = "feedback ok";
    } catch (err) {
      console.error("Erro inesperado ao guardar:", err);
      el.formFeedback.textContent = "Erro inesperado: " + err.message;
      el.formFeedback.className = "feedback err";
    } finally {
      salvando = false; el.btnSalvarServico.innerHTML = originalHtml; el.btnSalvarServico.disabled = false;
    }
  });

  /* ---------------- categorias (com subcategorias) ---------------- */
  function renderCategoriasGestao() {
    const tree = buildCategoryTree(st().categorias);
    const rows = [];
    function walk(nodes, depth) {
      nodes.forEach(c => {
        const usados = st().servicos.filter(s => s.categoriaId === c.id).length;
        rows.push({ c, depth, usados });
        walk(c.filhos, depth + 1);
      });
    }
    walk(tree, 0);
    el.categoriasLista.innerHTML = rows.map(({ c, depth, usados }) => `
      <div class="category-editor-row" data-cat="${c.id}">
        ${depth > 0 ? `<span class="indent">${"— ".repeat(depth)}</span>` : ""}
        <input type="color" value="${c.cor}" data-cat-color="${c.id}">
        <input type="text" value="${escapeHtml(c.nome)}" data-cat-nome="${c.id}">
        <select data-cat-parent="${c.id}"></select>
        <button class="cat-img-btn" data-cat-img="${c.id}" title="${escapeHtml(tm("config.categorias.imagem_title"))}">${icon("image")}</button>
        <span class="mini-badge">${usados} serviço${usados !== 1 ? "s" : ""}</span>
        <button data-cat-del="${c.id}" title="${escapeHtml(tm("config.categorias.remover_title"))}" style="background:none;border:none;color:var(--danger);">${icon("trash")}</button>
      </div>`).join("") || "<p style='font-size:.8rem;color:var(--text-soft);'>Ainda não existem categorias.</p>";

    // popular selects de "categoria-mãe" evitando ciclos
    el.categoriasLista.querySelectorAll("[data-cat-parent]").forEach(sel => {
      const catId = sel.dataset.catParent;
      const opts = [`<option value="">— Categoria de topo —</option>`];
      st().categorias.forEach(c => { if (podeSerPai(st().categorias, catId, c.id)) opts.push(`<option value="${c.id}">${escapeHtml(c.nome)}</option>`); });
      sel.innerHTML = opts.join("");
      const atual = st().categorias.find(c => c.id === catId);
      sel.value = atual && atual.parentId ? atual.parentId : "";
      sel.addEventListener("change", () => actions.atualizarCategoria(catId, { parentId: sel.value || null }));
    });
    el.categoriasLista.querySelectorAll("[data-cat-nome]").forEach(inp => inp.addEventListener("change", () => actions.atualizarCategoria(inp.dataset.catNome, { nome: inp.value.trim() || "Sem nome" })));
    // 'change' (não 'input'): o seletor nativo de cor dispara "input" a cada
    // movimento dentro da roda de cores. Se atualizássemos o estado nessa
    // altura, a lista de categorias era reconstruída a meio da escolha e o
    // seletor fechava sozinho — obrigando a reabri-lo várias vezes até
    // acertar na cor. Com "change", só atualiza quando a escolha é finalizada.
    el.categoriasLista.querySelectorAll("[data-cat-color]").forEach(inp => inp.addEventListener("change", () => actions.atualizarCategoria(inp.dataset.catColor, { cor: inp.value })));
    el.categoriasLista.querySelectorAll("[data-cat-del]").forEach(btn => btn.addEventListener("click", () => {
      if (confirm("Remover esta categoria? Os serviços ficam com 'Categoria Indefinida' e as subcategorias sobem de nível.")) actions.removerCategoria(btn.dataset.catDel);
    }));
    el.categoriasLista.querySelectorAll("[data-cat-img]").forEach(btn => btn.addEventListener("click", () => {
      const catId = btn.dataset.catImg;
      const fileInput = document.createElement("input");
      fileInput.type = "file"; fileInput.accept = "image/*";
      fileInput.addEventListener("change", async () => {
        if (!fileInput.files.length) return;
        try {
          validarTamanhoImagem(fileInput.files[0]);
          const b64 = await lerArquivoComoBase64(fileInput.files[0]);
          await actions.atualizarCategoria(catId, { imagem: b64 });
          bus.emit("toast:show", { type: "ok", msg: tm("toast.imagem_categoria_atualizada") });
        }
        catch (err) { bus.emit("toast:show", { type: "err", msg: "Erro ao carregar imagem: " + err.message }); }
      });
      fileInput.click();
    }));
  }

  el.btnAddCategoria.addEventListener("click", async () => {
    const nome = el.novaCategoriaNome.value.trim();
    if (!nome) { bus.emit("toast:show", { type: "err", msg: tm("config.categorias.nome_obrigatorio") }); return; }
    const parentId = el.novaCategoriaParent.value || null;
    let imagem = null;
    if (categoriaImagemPendente) {
      try { validarTamanhoImagem(categoriaImagemPendente); imagem = await lerArquivoComoBase64(categoriaImagemPendente); }
      catch (err) { bus.emit("toast:show", { type: "err", msg: err.message }); return; }
    }
    await actions.criarCategoria(nome, el.novaCategoriaCor.value, parentId, imagem);
    el.novaCategoriaNome.value = ""; categoriaImagemPendente = null; el.novaCategoriaImgNome.innerText = "";
    renderCategoriasGestao();
    popularNovaCategoriaParentSelect();
  });
  el.novaCategoriaImg.addEventListener("change", (e) => { categoriaImagemPendente = e.target.files[0] || null; el.novaCategoriaImgNome.innerText = categoriaImagemPendente ? categoriaImagemPendente.name : ""; });
  function popularNovaCategoriaParentSelect() {
    const valorAnterior = el.novaCategoriaParent.value;
    const opts = [`<option value="">— Categoria de topo —</option>`];
    st().categorias.forEach(c => opts.push(`<option value="${c.id}">${escapeHtml(c.nome)}</option>`));
    el.novaCategoriaParent.innerHTML = opts.join("");
    if ([...el.novaCategoriaParent.options].some(o => o.value === valorAnterior)) el.novaCategoriaParent.value = valorAnterior;
  }

  /* ---------------- dados ---------------- */
  function renderUsageStats() {
    const top = getMaisUsados(st().servicos, 8).filter(s => s.contadorAcessos > 0);
    if (!top.length) { el.usageStatsList.innerHTML = "<p style='color:var(--text-soft);font-size:.8rem;'>Ainda não há dados de utilização.</p>"; return; }
    const max = Math.max(...top.map(s => s.contadorAcessos));
    el.usageStatsList.innerHTML = top.map(s => `
      <div class="usage-bar-row">
        <span class="ubr-label">${escapeHtml(s.nome)}</span>
        <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${(s.contadorAcessos / max * 100).toFixed(0)}%;"></div></div>
        <span class="ubr-count">${s.contadorAcessos}</span>
      </div>`).join("");
  }
  el.btnExportar.addEventListener("click", () => actions.exportarDados());
  el.inputImportar.addEventListener("change", async (e) => {
    if (e.target.files.length) { await actions.importarDados(e.target.files[0]); e.target.value = ""; renderServicosGestao(""); renderCategoriasGestao(); popularNovaCategoriaParentSelect(); }
  });
  el.btnResetTudo.addEventListener("click", async () => {
    if (confirm("Isto vai apagar TODOS os serviços, categorias e o logótipo desta central. Continuar?")) {
      await actions.resetTudo(); renderServicosGestao(""); renderCategoriasGestao(); popularNovaCategoriaParentSelect();
    }
  });

  popularNovaCategoriaParentSelect();

  return {
    abrirConfig, fecharConfig, mudarTab, mostrarFormAdd, editarServico,
    refreshOnStateChange() {
      if (el.modalConfig.classList.contains("active")) {
        // Só adia a reconstrução da lista quando o utilizador está mesmo a
        // escrever num campo de texto (perderia o cursor a meio da escrita).
        // Um botão focado (ex.: depois de clicar em "editar"/"eliminar") NÃO
        // deve bloquear o refresh, senão ações como eliminar uma categoria
        // pareciam não fazer nada.
        const activo = document.activeElement;
        if (!deveAdiarRenderizacao(activo, el.servicosListaGestao)) renderServicosGestao(el.gestaoSearchInput.value);
        if (!deveAdiarRenderizacao(activo, el.categoriasLista)) renderCategoriasGestao();
        renderUsageStats();
        if (activo !== el.novaCategoriaParent) popularNovaCategoriaParentSelect();
        renderLogoPreviewModal();
      }
    }
  };
}
