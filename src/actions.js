/**
 * actions.js — única camada autorizada a misturar "store puro" com efeitos
 * assíncronos (chamadas à API partilhada, notificações). Os componentes de
 * UI nunca tocam em `dataStore` diretamente: chamam sempre uma função daqui.
 *
 * Estratégia de sincronização (cache inteligente):
 *  - toda a escrita atualiza primeiro o estado em memória (otimista);
 *  - a persistência real (para o servidor/Netlify Blobs, partilhado por
 *    todos os computadores) é "debounced" (350ms) para agrupar escritas
 *    rápidas consecutivas num só pedido à API;
 *  - o estado de sincronização (`syncStatus`) fica visível na sidebar;
 *  - `flushSync()` é forçado em `visibilitychange`/`beforeunload` para
 *    nunca perder a última alteração ao fechar ou trocar de separador;
 *  - `recarregarDoServidor()` vai buscar as alterações feitas por OUTROS
 *    computadores (chamado no arranque, ao voltar à aba, periodicamente,
 *    e no botão "Atualizar").
 */
import { bus } from "./events.js";
import { nowTs, uid } from "./utils.js";
import { CATEGORIA_INDEFINIDA_ID, CATEGORIAS_PADRAO, MODULOS_ATALHOS } from "./domain.js";
import { getPerfil } from "./authClient.js";
import { cacheBrandingLocal } from "./db.js";
import { t, normalizarIdioma, DEFAULT_IDIOMA } from "./i18n.js";

function stripTransient(s) {
  // `htmlContent`/`arquivoBase64` NUNCA vão no payload do estado geral: vivem
  // no seu próprio blob (ver `chaveConteudoServico` via dataStore.setAsset/
  // getAsset), para que o pedido de gravação do estado se mantenha sempre
  // leve, por muitos ou grandes que sejam os documentos já carregados. Ver
  // `abrirEmNovaAba` para o fallback que vai buscar o conteúdo quando não
  // está em memória.
  const { blobUrl, htmlContent, arquivoBase64, ...rest } = s;
  return rest;
}
function chaveConteudoServico(id) { return `servico-conteudo:${id}`; }

/**
 * Cria um "serviço" de atalho (tipo "modulo") para cada módulo/ferramenta
 * interno que ainda não tenha um — abre o módulo dentro da própria Central
 * (ver `abrirEmNovaAba`), tal como um clique na barra lateral. Chamado uma
 * única vez por farmácia (ver a flag "atalhosModulosCriados" em `iniciar()`);
 * se o utilizador apagar algum destes atalhos depois, não volta a aparecer
 * sozinho. Garante também que a categoria "Serviços Clínicos" (cat_clinicos)
 * existe, recriando-a se tiver sido apagada — devolve `null` se não houver
 * nada a fazer (todos os atalhos já existem).
 */
function criarAtalhosModulos(servicosAtuais, categoriasAtuais) {
  const jaTem = new Set(servicosAtuais.filter(s => s.tipo === "modulo").map(s => s.modulo));
  const faltam = MODULOS_ATALHOS.filter(m => !jaTem.has(m.modulo));
  if (!faltam.length) return null;

  let categoriaClinicos = categoriasAtuais.find(c => c.id === "cat_clinicos");
  let categoriasFinal = categoriasAtuais;
  if (!categoriaClinicos) {
    categoriaClinicos = { id: "cat_clinicos", nome: "Serviços Clínicos", cor: "#2b7a4b", imagem: null, parentId: null, ordem: categoriasAtuais.length };
    categoriasFinal = [...categoriasAtuais, categoriaClinicos];
  }

  const maxOrdem = servicosAtuais.reduce((m, s) => Math.max(m, s.ordem || 0), -1);
  const novosServicos = faltam.map((m, i) => ({
    id: uid("srv"), nome: m.nome, descricao: "", tipo: "modulo", modulo: m.modulo,
    url: null, htmlContent: null, arquivoBase64: null, arquivoNome: null,
    imagemBase64: null, imagemUrl: null,
    categoriaId: categoriaClinicos.id,
    tags: ["módulo"], favorito: false, status: "ativo",
    ordem: maxOrdem + 1 + i, criadoEm: nowTs(), atualizadoEm: nowTs(), ultimoAcesso: null, contadorAcessos: 0
  }));

  return { servicos: [...servicosAtuais, ...novosServicos], categorias: categoriasFinal };
}

/** data:mime;base64,XXXX -> Blob binário, para abrir PDFs/imagens/documentos corretamente. */
function dataUrlParaBlob(dataUrl) {
  const virgula = dataUrl.indexOf(",");
  const cabecalho = dataUrl.slice(0, virgula);
  const base64 = dataUrl.slice(virgula + 1);
  const mimeMatch = cabecalho.match(/data:(.*?)(;base64)?$/);
  const mime = (mimeMatch && mimeMatch[1]) || "application/octet-stream";
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function createActions(store, dataStore) {
  let syncTimer = null;

  // Tradução das mensagens/toasts centrais (ponto 24, multi-idioma) — lê
  // sempre o idioma atual do estado, para que uma mudança de idioma a meio
  // da sessão se reflita de imediato em qualquer ação seguinte.
  function tc(chave, vars) { return t(chave, store.getState().idioma || DEFAULT_IDIOMA, vars); }

  async function flushSync(reason) {
    clearTimeout(syncTimer);
    try {
      const st = store.getState();
      await dataStore.putAll("servicos", st.servicos.map(stripTransient));
      await dataStore.putAll("categorias", st.categorias);
      store.dispatch({ type: "SET_SYNC_STATUS", status: "synced" });
      bus.emit("sync:done", { reason });
    } catch (err) {
      console.error("Erro ao sincronizar dados:", err);
      store.dispatch({ type: "SET_SYNC_STATUS", status: "error" });
      bus.emit("toast:show", { type: "err", msg: tc("toast.erro_sync") });
    }
  }
  function scheduleSync(reason) {
    store.dispatch({ type: "SET_SYNC_STATUS", status: "syncing" });
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => flushSync(reason), 350);
  }

  const actions = {
    async iniciar() {
      const [servicos, categorias, logoAsset, logoConfigAntigo, nomeFarmaciaConfig, morada, cidade, emailContacto, telefoneContacto, idiomaConfig, atalhosCriados] = await Promise.all([
        dataStore.getAll("servicos"),
        dataStore.getAll("categorias"),
        // O logótipo vive no seu próprio blob (getAsset), separado do resto
        // do estado — ver nota em setLogo(). `getConfig("logo")` só serve de
        // recurso para farmácias com um logótipo gravado antes desta
        // mudança, que ainda não voltaram a carregar um novo.
        dataStore.getAsset("branding-logo"),
        dataStore.getConfig("logo"),
        dataStore.getConfig("nomeFarmacia"),
        dataStore.getConfig("morada"),
        dataStore.getConfig("cidade"),
        dataStore.getConfig("emailContacto"),
        dataStore.getConfig("telefoneContacto"),
        dataStore.getConfig("idioma"),
        dataStore.getConfig("atalhosModulosCriados")
      ]);
      const logoBase64 = logoAsset || logoConfigAntigo || null;
      cacheBrandingLocal(nomeFarmaciaConfig || getPerfil()?.nomeFarmacia, logoBase64);
      // Fonte única de verdade do nome da farmácia: `config.nomeFarmacia`
      // (editável em Configurações, é o que TODOS os módulos/ferramentas
      // devem mostrar). Antes desse campo alguma vez ser gravado (ex.: uma
      // farmácia recém-registada que ainda não abriu Configurações), cai
      // para o nome dado no registo (getPerfil()) em vez de um nome de
      // farmácia genérico de exemplo — e grava-o já em config.nomeFarmacia
      // (best-effort, silencioso) para que a partir daqui todos os locais
      // que leem o estado partilhado (incluindo os módulos) vejam o mesmo
      // valor sem terem de conhecer este fallback.
      const nomeFarmacia = nomeFarmaciaConfig || getPerfil()?.nomeFarmacia || "Farmácia";
      if (!nomeFarmaciaConfig && nomeFarmacia !== "Farmácia") {
        dataStore.setConfig("nomeFarmacia", nomeFarmacia).catch(() => {});
      }

      // Atalhos para os módulos/ferramentas, como serviços na categoria
      // "Serviços Clínicos" (ver criarAtalhosModulos) — criados uma única
      // vez por farmácia; a flag "atalhosModulosCriados" evita recriá-los
      // se o utilizador os apagar depois. Gravação best-effort, em segundo
      // plano: não atrasa o arranque da Central.
      const categoriasBase = categorias.length ? categorias : CATEGORIAS_PADRAO.slice();
      let servicosFinal = servicos;
      let categoriasFinal = categoriasBase;
      if (!atalhosCriados) {
        const resultado = criarAtalhosModulos(servicos, categoriasBase);
        if (resultado) { servicosFinal = resultado.servicos; categoriasFinal = resultado.categorias; }
        const categoriasMudaram = categoriasFinal !== categoriasBase;
        (async () => {
          try {
            if (categoriasMudaram) await dataStore.putAll("categorias", categoriasFinal);
            if (resultado) await dataStore.putAll("servicos", servicosFinal.map(stripTransient));
            await dataStore.setConfig("atalhosModulosCriados", true);
          } catch (err) {
            console.error("Erro ao gravar os atalhos dos módulos:", err);
          }
        })();
      }

      store.dispatch({
        type: "INIT_STATE",
        payload: {
          servicos: servicosFinal.map(s => ({ ...s, blobUrl: null })),
          categorias: categoriasFinal,
          logoBase64: logoBase64 || null,
          nomeFarmacia,
          morada: morada || "",
          cidade: cidade || "",
          emailContacto: emailContacto || "",
          telefoneContacto: telefoneContacto || "",
          idioma: normalizarIdioma(idiomaConfig)
        }
      });
    },

    /**
     * Vai buscar o estado mais recente ao servidor e substitui o estado local
     * — usado para trazer alterações feitas noutros computadores. Só é
     * chamado quando é seguro (sem escrita pendente e fora do modal de
     * configurações), para nunca pisar uma edição a meio.
     */
    async recarregarDoServidor() {
      try {
        await dataStore.refresh();
        await actions.iniciar();
        bus.emit("sync:remote-refresh", {});
      } catch (err) {
        console.error("Erro ao atualizar a partir do servidor:", err);
        bus.emit("toast:show", { type: "err", msg: tc("toast.erro_contactar_servidor") });
      }
    },

    setSearch(query) { store.dispatch({ type: "SET_SEARCH", query }); },
    setScope(scope) { store.dispatch({ type: "SET_SCOPE", scope }); },
    setSort(sortBy) { store.dispatch({ type: "SET_SORT", sortBy }); },
    setViewMode(viewMode) { store.dispatch({ type: "SET_VIEWMODE", viewMode }); },

    async setLogo(base64) {
      store.dispatch({ type: "SET_LOGO", logoBase64: base64 });
      // Guardado no seu próprio blob (não em config.logo): o logótipo pode
      // pesar centenas de KB, e config é lido/reenviado por inteiro em TODOS
      // os módulos a cada carregamento e a cada gravação — mantê-lo à parte
      // é o que torna essas operações rápidas independentemente do tamanho
      // da imagem escolhida.
      await dataStore.setAsset("branding-logo", base64);
      cacheBrandingLocal(store.getState().nomeFarmacia, base64);
      bus.emit("toast:show", { type: "ok", msg: tc("toast.logotipo_atualizado") });
    },
    async setNomeFarmacia(nome) {
      store.dispatch({ type: "SET_NOME_FARMACIA", nome });
      await dataStore.setConfig("nomeFarmacia", nome);
    },
    async setMorada(valor) {
      store.dispatch({ type: "SET_MORADA", valor });
      await dataStore.setConfig("morada", valor);
    },
    async setCidade(valor) {
      store.dispatch({ type: "SET_CIDADE", valor });
      await dataStore.setConfig("cidade", valor);
    },
    async setEmailContacto(valor) {
      store.dispatch({ type: "SET_EMAIL_CONTACTO", valor });
      await dataStore.setConfig("emailContacto", valor);
    },
    async setTelefoneContacto(valor) {
      store.dispatch({ type: "SET_TELEFONE_CONTACTO", valor });
      await dataStore.setConfig("telefoneContacto", valor);
    },
    /**
     * Muda o idioma da Central (ponto 24, multi-idioma) — persistido em
     * config.idioma, aplicado de imediato (o subscritor do store em app.js
     * chama aplicarTraducoes() sempre que este valor muda no estado).
     * `codigo` desconhecido cai para pt (normalizarIdioma), nunca guarda um
     * valor inválido.
     */
    async setIdioma(codigo) {
      const idioma = normalizarIdioma(codigo);
      store.dispatch({ type: "SET_IDIOMA", idioma });
      await dataStore.setConfig("idioma", idioma);
    },

    async criarServico(dados, onProgress) {
      const st = store.getState();
      const maxOrdem = st.servicos.reduce((m, s) => Math.max(m, s.ordem || 0), -1);
      const conteudoParaGuardar = dados.tipo === "html" ? dados.htmlContent : dados.tipo === "arquivo" ? dados.arquivoBase64 : null;
      const novo = {
        id: uid("srv"),
        nome: dados.nome, descricao: dados.descricao || "",
        tipo: dados.tipo, url: dados.tipo === "url" ? dados.url : null,
        modulo: dados.tipo === "modulo" ? dados.modulo : null,
        htmlContent: dados.tipo === "html" ? dados.htmlContent : null,
        arquivoBase64: dados.tipo === "arquivo" ? dados.arquivoBase64 : null,
        arquivoNome: dados.tipo === "arquivo" ? (dados.arquivoNome || null) : null,
        imagemBase64: dados.imagemBase64 || null, imagemUrl: dados.imagemUrl || null,
        categoriaId: dados.categoriaId || CATEGORIA_INDEFINIDA_ID,
        tags: dados.tags || [], favorito: !!dados.favorito, status: dados.status || "ativo",
        ordem: maxOrdem + 1, criadoEm: nowTs(), atualizadoEm: nowTs(), ultimoAcesso: null, contadorAcessos: 0
      };
      store.dispatch({ type: "ADD_SERVICO", servico: novo });
      scheduleSync("criar-servico");
      if (conteudoParaGuardar) {
        try {
          await dataStore.setAsset(chaveConteudoServico(novo.id), conteudoParaGuardar, onProgress);
        } catch (err) {
          console.error("Erro ao guardar o conteúdo do serviço:", err);
          bus.emit("toast:show", { type: "err", msg: `Serviço "${novo.nome}" criado, mas o ficheiro não foi guardado no servidor: ${err.message}` });
          return novo;
        }
      }
      bus.emit("toast:show", { type: "ok", msg: tc("toast.servico_adicionado", { nome: novo.nome }) });
      return novo;
    },

    async atualizarServico(id, dados, onProgress) {
      store.dispatch({ type: "UPDATE_SERVICO", id, dados: { ...dados, atualizadoEm: nowTs() } });
      scheduleSync("atualizar-servico");
      const atualizado = store.getState().servicos.find(s => s.id === id);
      // `dados.htmlContent`/`dados.arquivoBase64` só vêm preenchidos quando o
      // utilizador carregou um NOVO ficheiro nesta edição — se não vieram, o
      // conteúdo existente no servidor mantém-se intocado (nada a gravar aqui).
      const conteudoParaGuardar = dados.tipo === "html" && typeof dados.htmlContent === "string" && dados.htmlContent
        ? dados.htmlContent
        : dados.tipo === "arquivo" && typeof dados.arquivoBase64 === "string" && dados.arquivoBase64
        ? dados.arquivoBase64
        : null;
      if (conteudoParaGuardar) {
        try {
          await dataStore.setAsset(chaveConteudoServico(id), conteudoParaGuardar, onProgress);
        } catch (err) {
          console.error("Erro ao guardar o conteúdo do serviço:", err);
          bus.emit("toast:show", { type: "err", msg: `Serviço "${atualizado?.nome || ""}" atualizado, mas o novo ficheiro não foi guardado no servidor: ${err.message}` });
          return atualizado;
        }
      }
      if (atualizado) bus.emit("toast:show", { type: "ok", msg: tc("toast.servico_atualizado", { nome: atualizado.nome }) });
      return atualizado;
    },

    async removerServico(id) {
      const alvo = store.getState().servicos.find(s => s.id === id);
      store.dispatch({ type: "REMOVE_SERVICO", id });
      scheduleSync("remover-servico");
      if (alvo?.tipo === "html" || alvo?.tipo === "arquivo") dataStore.deleteAsset(chaveConteudoServico(id));
      if (alvo) bus.emit("toast:show", { type: "warn", msg: tc("toast.servico_removido", { nome: alvo.nome }) });
    },

    async alternarFavorito(id) {
      store.dispatch({ type: "TOGGLE_FAVORITO", id });
      scheduleSync("favorito");
    },

    async reordenarServicos(fromId, toId) {
      store.dispatch({ type: "REORDER_SERVICOS", fromId, toId });
      scheduleSync("reordenar");
    },

    async registarAcesso(id) {
      store.dispatch({ type: "REGISTER_ACESSO", id });
      scheduleSync("acesso");
    },

    /**
     * Abre o serviço. Para os atalhos de módulo (tipo "modulo", criados por
     * `criarAtalhosModulos`) navega dentro da própria Central — exatamente
     * como um clique no módulo na barra lateral — em vez de abrir uma nova
     * aba. Para os restantes tipos (url/html/arquivo) abre numa nova aba:
     * se o conteúdo HTML/ficheiro já está em memória (criado/editado nesta
     * mesma sessão), abre de imediato; caso contrário (carregado noutra
     * sessão/computador, onde o estado geral nunca inclui o conteúdo
     * completo), vai buscar o conteúdo ao seu blob próprio primeiro. Abre a
     * aba em branco de imediato (dentro do mesmo gesto do utilizador) e só
     * depois navega para o conteúdo, para não ser bloqueado como pop-up
     * pelo browser.
     */
    abrirEmNovaAba(id) {
      const st = store.getState();
      const serv = st.servicos.find(s => s.id === id);
      if (!serv) return;

      if (serv.tipo === "modulo" && serv.modulo) {
        actions.setScope({ tipo: "modulo", modulo: serv.modulo });
        actions.setSearch("");
        actions.registarAcesso(id);
        return;
      }

      if (serv.tipo === "url" && serv.url) {
        const url = /^https?:\/\//i.test(serv.url) ? serv.url : "https://" + serv.url;
        window.open(url, "_blank");
        actions.registarAcesso(id);
        return;
      }

      if (serv.tipo === "html" && serv.htmlContent) {
        const blob = new Blob([serv.htmlContent], { type: "text/html" });
        window.open(URL.createObjectURL(blob), "_blank");
        actions.registarAcesso(id);
        return;
      }

      if (serv.tipo === "arquivo" && serv.arquivoBase64) {
        const blob = dataUrlParaBlob(serv.arquivoBase64);
        window.open(URL.createObjectURL(blob), "_blank");
        actions.registarAcesso(id);
        return;
      }

      if (serv.tipo === "html" || serv.tipo === "arquivo") {
        const janela = window.open("", "_blank");
        dataStore.getAsset(chaveConteudoServico(id)).then(content => {
          if (!content) {
            bus.emit("toast:show", { type: "err", msg: tc("toast.conteudo_nao_encontrado") });
            if (janela) janela.close();
            return;
          }
          const blob = serv.tipo === "html" ? new Blob([content], { type: "text/html" }) : dataUrlParaBlob(content);
          if (janela) janela.location.href = URL.createObjectURL(blob);
          actions.registarAcesso(id);
        }).catch(err => {
          console.error("Erro ao carregar conteúdo do serviço:", err);
          bus.emit("toast:show", { type: "err", msg: "Erro ao carregar o conteúdo deste serviço: " + err.message });
          if (janela) janela.close();
        });
        return;
      }

      bus.emit("toast:show", { type: "err", msg: tc("toast.sem_conteudo_valido") });
    },

    async criarCategoria(nome, cor, parentId = null, imagem = null) {
      const st = store.getState();
      const irmas = st.categorias.filter(c => c.parentId === parentId);
      const nova = { id: uid("cat"), nome, cor: cor || "#2b7a4b", imagem, parentId, ordem: irmas.length };
      store.dispatch({ type: "ADD_CATEGORIA", categoria: nova });
      scheduleSync("categoria-criada");
      bus.emit("toast:show", { type: "ok", msg: tc("toast.categoria_criada", { nome }) });
      return nova;
    },
    async atualizarCategoria(id, dados) {
      store.dispatch({ type: "UPDATE_CATEGORIA", id, dados });
      scheduleSync("categoria-atualizada");
    },
    async removerCategoria(id) {
      store.dispatch({ type: "REMOVE_CATEGORIA", id });
      scheduleSync("categoria-removida");
      bus.emit("toast:show", { type: "warn", msg: tc("toast.categoria_removida") });
    },
    async reordenarCategorias(fromId, toId) {
      store.dispatch({ type: "REORDER_CATEGORIAS", fromId, toId });
      scheduleSync("categoria-reordenada");
    },

    async exportarDados() {
      const st = store.getState();
      bus.emit("toast:show", { type: "ok", msg: tc("toast.backup_preparando") });
      let servicosCompletos;
      try {
        servicosCompletos = await Promise.all(st.servicos.map(async (s) => {
          const limpo = stripTransient(s);
          if (s.tipo === "html" || s.tipo === "arquivo") {
            let conteudo = s.tipo === "html" ? s.htmlContent : s.arquivoBase64;
            if (!conteudo) {
              try { conteudo = await dataStore.getAsset(chaveConteudoServico(s.id)); }
              catch (err) { console.error(`Erro ao obter o conteúdo de "${s.nome}" para a exportação:`, err); }
            }
            if (s.tipo === "html") limpo.htmlContent = conteudo || null;
            else limpo.arquivoBase64 = conteudo || null;
          }
          return limpo;
        }));
      } catch (err) {
        console.error("Erro ao preparar a exportação:", err);
        bus.emit("toast:show", { type: "err", msg: "Erro ao preparar a cópia de segurança: " + err.message });
        return;
      }
      const payload = {
        versao: 4, exportadoEm: new Date().toISOString(),
        nomeFarmacia: st.nomeFarmacia, logoBase64: st.logoBase64,
        morada: st.morada, emailContacto: st.emailContacto, telefoneContacto: st.telefoneContacto,
        categorias: st.categorias, servicos: servicosCompletos
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `central-farmacia-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      bus.emit("toast:show", { type: "ok", msg: tc("toast.backup_exportado") });
    },

    async importarDados(file) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.servicos)) throw new Error("Ficheiro inválido.");

        // O conteúdo pesado de cada serviço (HTML ou ficheiro) vai para o seu
        // próprio blob antes de gravar o estado geral — senão importar um
        // backup com documentos grandes voltaria a ultrapassar o limite de
        // tamanho do pedido.
        const servicosLeves = [];
        for (const s of data.servicos) {
          const { htmlContent, arquivoBase64, ...leve } = s;
          servicosLeves.push(leve);
          const conteudo = s.tipo === "html" ? htmlContent : s.tipo === "arquivo" ? arquivoBase64 : null;
          if (conteudo) {
            try { await dataStore.setAsset(chaveConteudoServico(s.id), conteudo); }
            catch (err) { console.error(`Erro ao importar o conteúdo de "${s.nome}":`, err); }
          }
        }

        const payload = {
          servicos: servicosLeves,
          categorias: Array.isArray(data.categorias) && data.categorias.length ? data.categorias : store.getState().categorias,
          logoBase64: data.logoBase64 || store.getState().logoBase64,
          nomeFarmacia: data.nomeFarmacia || store.getState().nomeFarmacia,
          morada: data.morada ?? store.getState().morada,
          emailContacto: data.emailContacto ?? store.getState().emailContacto,
          telefoneContacto: data.telefoneContacto ?? store.getState().telefoneContacto
        };
        // No estado em memória (esta sessão) mantemos o conteúdo completo,
        // para "abrir" funcionar de imediato sem precisar de ir já buscá-lo.
        store.dispatch({ type: "IMPORT_DADOS", payload: { ...payload, servicos: data.servicos } });
        await Promise.all([
          dataStore.putAll("servicos", servicosLeves),
          dataStore.putAll("categorias", payload.categorias),
          dataStore.setConfig("logo", payload.logoBase64),
          dataStore.setConfig("nomeFarmacia", payload.nomeFarmacia),
          dataStore.setConfig("morada", payload.morada),
          dataStore.setConfig("emailContacto", payload.emailContacto),
          dataStore.setConfig("telefoneContacto", payload.telefoneContacto)
        ]);
        bus.emit("toast:show", { type: "ok", msg: tc("toast.dados_importados") });
      } catch (err) {
        console.error("Erro ao importar:", err);
        bus.emit("toast:show", { type: "err", msg: "Erro ao importar ficheiro: " + err.message });
      }
    },

    async resetTudo() {
      await dataStore.clearAll();
      await dataStore.putAll("categorias", CATEGORIAS_PADRAO);
      store.dispatch({ type: "RESET_TUDO", categoriasPadrao: CATEGORIAS_PADRAO.slice() });
      bus.emit("toast:show", { type: "warn", msg: tc("toast.dados_repostos") });
    },

    flushSync
  };

  if (typeof window !== "undefined") {
    window.addEventListener("visibilitychange", () => { if (document.hidden && store.getState().syncStatus === "syncing") flushSync("visibilitychange"); });
    window.addEventListener("beforeunload", () => { if (store.getState().syncStatus === "syncing") flushSync("beforeunload"); });
  }

  return actions;
}
