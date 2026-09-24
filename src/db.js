/**
 * db.js — camada de dados. Fala com a função Netlify (`/api/data`), que por
 * sua vez guarda tudo no Netlify Blobs. Isto substitui o antigo IndexedDB
 * (armazenamento local, por computador): agora todos os postos de trabalho
 * leem e escrevem o MESMO estado partilhado.
 *
 * Mantém deliberadamente a mesma "forma" de interface que a versão anterior
 * (getAll/putAll/getConfig/setConfig/clearAll) para que a camada de ações
 * (actions.js) não precise de saber de onde vêm os dados.
 */
import { getToken, limparSessao } from "./authClient.js";

const API_URL = "/api/data";
const ASSET_URL = (key) => `/api/asset/${encodeURIComponent(key)}`;
const OLD_INDEXEDDB_NAME = "FarmaciaAltoMoinhosDB";

/** Callback opcional para reagir a uma sessão expirada (ver app.js: mostra o ecrã de login outra vez). */
let onSessaoExpirada = null;
export function aoExpirarSessao(cb) { onSessaoExpirada = cb; }

function comAuth(headers = {}) {
  const token = getToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

/** fetch com Authorization automático; se o servidor disser 401, limpa a sessão local e avisa a app. */
async function fetchAutenticado(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: comAuth(opts.headers || {}) });
  if (res.status === 401) {
    limparSessao();
    if (onSessaoExpirada) onSessaoExpirada();
  }
  return res;
}

// Cada pedaço fica bem abaixo do limite de 6MB por pedido das funções do
// Netlify (mesmo com a margem do escape de JSON), para nunca ser recusado.
const TAMANHO_PEDACO = 2 * 1024 * 1024;
function metaKey(key) { return `${key}:meta`; }
function partKey(key, i) { return `${key}:part:${i}`; }

/**
 * Ponto 57 (perda de dados em gravações concorrentes — queixa direta do
 * Ivo: "crio um serviço, vejo-o durante uns 10 segundos e depois
 * desaparece"): `putAll()` recebia sempre o array COMPLETO de serviços/
 * categorias tal como este separador/computador o via localmente, e no
 * caminho de nova tentativa do `persist()` (ver acima, ponto 50) o
 * substituía diretamente pelo estado fresco relido do servidor —
 * `reaplicarMudancas(cache)` fazia `cache.servicos = items`. Como `items` é
 * um instantâneo tirado UMA VEZ no momento da chamada (o array local deste
 * separador, que nesse instante já não sabia nada de uma adição/edição feita
 * entretanto por OUTRO separador/computador), essa substituição às cegas
 * apagava silenciosamente qualquer coisa que esse outro tivesse acabado de
 * gravar — mesmo sendo um serviço completamente diferente, nunca tocado por
 * esta gravação. Isto é exatamente o que causava um serviço recém-criado a
 * desaparecer minutos depois: bastava OUTRO computador da farmácia gravar
 * qualquer coisa (até algo tão trivial como marcar um favorito) e entrar em
 * conflito de revisão (409) para essa gravação, ao repetir a tentativa,
 * varrer o serviço novo.
 *
 * `setConfig()`, ao lado, nunca teve este problema: o seu `aplicar` faz um
 * MERGE (`{ ...cache.config, [key]: value }`), nunca uma substituição total
 * — reaplicado sobre o estado fresco, só muda a chave que esta chamada quis
 * mesmo mudar. `calcularDiff`/`aplicarDiff` abaixo dão a `putAll` o mesmo
 * comportamento: em vez de substituir o array inteiro, calculam (por `id`)
 * exatamente o que ESTA chamada acrescentou, mudou ou removeu — comparando
 * o array pedido (`depois`) com o último estado conhecido ANTES desta
 * chamada (`antes`, o `cache` tal como estava mesmo antes de aplicar esta
 * gravação) — e reaplicam só essa diferença sobre o que quer que o servidor
 * tenha entretanto, preservando o que outro separador tiver acrescentado,
 * mudado ou removido no intervalo. Uma edição feita aqui e no servidor ao
 * MESMO id ao mesmo tempo continua "o último a gravar ganha" (só para esse
 * id) — não há forma de reconciliar duas edições diferentes ao mesmo campo
 * sem um utilizador a decidir; o que isto corrige é o caso, de longe mais
 * comum numa farmácia com vários postos, de dois separadores a mexerem em
 * serviços DIFERENTES ao mesmo tempo.
 */
function calcularDiff(antes, depois) {
  const antesPorId = new Map((antes || []).map(item => [item.id, item]));
  const depoisPorId = new Map((depois || []).map(item => [item.id, item]));
  const adicionados = [];
  const atualizados = [];
  for (const [id, item] of depoisPorId) {
    if (!antesPorId.has(id)) { adicionados.push(item); continue; }
    if (JSON.stringify(antesPorId.get(id)) !== JSON.stringify(item)) atualizados.push(item);
  }
  const removidosIds = [];
  for (const id of antesPorId.keys()) if (!depoisPorId.has(id)) removidosIds.push(id);
  return { adicionados, atualizados, removidosIds };
}

function aplicarDiff(lista, diff) {
  const porId = new Map((lista || []).map(item => [item.id, item]));
  for (const id of diff.removidosIds) porId.delete(id);
  for (const item of diff.adicionados) porId.set(item.id, item);
  for (const item of diff.atualizados) porId.set(item.id, item);
  return [...porId.values()];
}

let cache = null;
let cacheLoaded = false;
// Ponto 50 (bloqueio otimista): revisão do estado tal como o servidor a
// devolveu na última leitura (cabeçalho X-Estado-Rev, nunca no corpo — ver
// netlify/functions/data.js). Enviada de volta em cada PUT para o servidor
// poder recusar (409) uma gravação baseada num instantâneo já ultrapassado
// por outro separador/dispositivo, em vez de a deixar apagar em silêncio o
// que esse outro gravou entretanto.
let estadoRev = null;

// Ponto 56 (continuação do ponto 55, agora do lado do GET): o shell só lê
// servicos/categorias/config do estado partilhado (nunca aue/manipulados/
// etc., que só os módulos usam) — mas até aqui `ensureLoaded()` pedia
// sempre o estado INTEIRO, tanto no arranque como na atualização periódica
// de fundo a cada 25s (ver `recarregarDoServidor()` em actions.js). Como
// isto é o pedido mais frequente de toda a app (todas as abas abertas, a
// cada 25s), pedir só estas 3 chaves é o que mais reduz o tráfego de fundo
// à medida que a farmácia acumula dados nos módulos.
const CAMPOS_SHELL = "servicos,categorias,config";

async function ensureLoaded() {
  if (cacheLoaded) return cache;
  const res = await fetchAutenticado(`${API_URL}?campos=${CAMPOS_SHELL}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Não foi possível ler os dados do servidor (HTTP ${res.status}).`);
  estadoRev = res.headers.get("x-estado-rev");
  const data = await res.json();
  cache = { servicos: data.servicos || [], categorias: data.categorias || [], config: data.config || {} };
  cacheLoaded = true;
  return cache;
}

async function persistUmaVez() {
  // O logótipo já não é gravado aqui (ver getAsset/setAsset "branding-logo"
  // mais abaixo) — só ainda pode estar presente em `cache.config.logo` por
  // termos lido uma conta antiga, de antes desta mudança. Omitimo-lo
  // deliberadamente do que é reenviado (sem apagar `cache.config.logo` da
  // cópia em memória, que continua a servir de recurso de recurso a
  // `getConfig("logo")`) para que o servidor deixe de o guardar já a partir
  // desta gravação — sem precisar de nenhum passo de migração à parte.
  const configParaEnviar = { ...(cache.config || {}) };
  delete configParaEnviar.logo;
  const headers = { "Content-Type": "application/json" };
  if (estadoRev != null) headers["X-Estado-Rev"] = estadoRev;
  return fetchAutenticado(API_URL, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...cache, config: configParaEnviar })
  });
}

/**
 * Ponto 50: grava com bloqueio otimista. Se o servidor recusar por conflito
 * (409 — outro separador/dispositivo gravou entretanto), relê o estado
 * fresco, reaplica as MESMAS mudanças que esta chamada já tinha feito no
 * cache local (guardadas em `reaplicarMudancas`, chamada de novo sobre o
 * estado fresco) e tenta gravar outra vez — no máximo 3 vezes, para nunca
 * ficar preso num ciclo infinito se algo estiver mesmo mal.
 */
async function persist(reaplicarMudancas) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const res = await persistUmaVez();
    if (res.ok) {
      estadoRev = res.headers.get("x-estado-rev") || estadoRev;
      return;
    }
    if (res.status === 409 && reaplicarMudancas) {
      cacheLoaded = false;
      await ensureLoaded(); // relê o estado fresco e a revisão nova
      reaplicarMudancas(cache);
      continue;
    }
    throw new Error(`Não foi possível gravar os dados no servidor (HTTP ${res.status}).`);
  }
  throw new Error("Não foi possível gravar os dados no servidor: conflito de gravação persistente (demasiadas tentativas).");
}

export function makeDataStore() {
  return {
    async getAll(storeName) {
      const c = await ensureLoaded();
      if (storeName === "servicos") return c.servicos;
      if (storeName === "categorias") return c.categorias;
      return [];
    },
    async putAll(storeName, items) {
      await ensureLoaded();
      // Ponto 57: a diferença é calculada UMA VEZ aqui, contra o estado tal
      // como estava mesmo antes desta chamada — e reaplicada (nunca
      // substituída às cegas) tanto na primeira tentativa como, sobre o
      // estado fresco relido, em cada nova tentativa depois de um 409.
      const atual = storeName === "servicos" ? cache.servicos : storeName === "categorias" ? cache.categorias : [];
      const diff = calcularDiff(atual, items);
      const aplicar = (c) => {
        if (storeName === "servicos") c.servicos = aplicarDiff(c.servicos, diff);
        else if (storeName === "categorias") c.categorias = aplicarDiff(c.categorias, diff);
      };
      aplicar(cache);
      await persist(aplicar);
    },
    async put() { /* "activity" deixou de ser persistida remotamente — ninguém a lê de volta */ },
    async delete() { /* idem */ },
    async getConfig(key) {
      const c = await ensureLoaded();
      return c.config && key in c.config ? c.config[key] : null;
    },
    async setConfig(key, value) {
      await ensureLoaded();
      const aplicar = (c) => { c.config = { ...(c.config || {}), [key]: value }; };
      aplicar(cache);
      await persist(aplicar);
    },
    async clearAll() {
      const aplicar = (c) => { c.servicos = []; c.categorias = []; c.config = {}; };
      cache = { servicos: [], categorias: [], config: {} };
      cacheLoaded = true;
      await persist(aplicar);
    },
    /** Força ir novamente ao servidor buscar o estado mais recente (usado no refresh manual e no polling). */
    async refresh() {
      cacheLoaded = false;
      return ensureLoaded();
    },

    /**
     * Lê o estado COMPLETO desta farmácia diretamente do servidor — ao
     * contrário de getAll()/getConfig(), que só conhecem { servicos,
     * categorias, config } (o que este painel principal grava), devolve
     * também as fatias próprias de cada módulo (pim, documentos, aue,
     * stocks, etc.), tal como cada módulo as gravou no seu próprio
     * /api/data partilhado. Usado pela Auto-manutenção (ponto 21/22:
     * verificação de integridade, cópias de segurança) — nunca cacheado,
     * para nunca verificar/fazer backup de dados desatualizados.
     */
    async getEstadoCompleto() {
      const res = await fetchAutenticado(API_URL, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Não foi possível ler o estado completo do servidor (HTTP ${res.status}).`);
      estadoRev = res.headers.get("x-estado-rev");
      return res.json();
    },

    /**
     * Grava um estado COMPLETO (todas as chaves de nível de topo, incluindo
     * as de outros módulos) diretamente no servidor — usado para restaurar
     * uma cópia de segurança e para aplicar reparações de integridade.
     * O servidor faz merge (ver netlify/functions/data.js): qualquer chave
     * de módulo ausente do `estadoCompleto` dado fica tal como estava (não
     * é apagada) — uma reparação/restauro nunca apaga um módulo que essa
     * cópia desconhecesse. Invalida a cache local de servicos/categorias/
     * config, para que a próxima leitura reflita sempre o que acabou de
     * ser gravado.
     */
    async gravarEstadoCompleto(estadoCompleto) {
      // Ponto 50: tenta com a revisão já conhecida (da última leitura feita
      // por getEstadoCompleto/ensureLoaded); se entretanto outra gravação
      // mudou a revisão no servidor (409), relê só a revisão nova e volta a
      // tentar com o MESMO conteúdo (uma restauração/reparação é, por
      // natureza, escrever exatamente isto — não faz sentido "reaplicar uma
      // mudança" como nas gravações incrementais de putAll/setConfig acima).
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        const headers = { "Content-Type": "application/json" };
        if (estadoRev != null) headers["X-Estado-Rev"] = estadoRev;
        const res = await fetchAutenticado(API_URL, { method: "PUT", headers, body: JSON.stringify(estadoCompleto) });
        if (res.ok) {
          estadoRev = res.headers.get("x-estado-rev") || estadoRev;
          cache = null;
          cacheLoaded = false;
          return;
        }
        if (res.status === 409) {
          const corpoConflito = await res.json().catch(() => ({}));
          estadoRev = corpoConflito.rev != null ? String(corpoConflito.rev) : res.headers.get("x-estado-rev");
          continue;
        }
        const corpo = await res.json().catch(() => ({}));
        throw new Error(corpo.error || `Não foi possível gravar o estado completo (HTTP ${res.status}).`);
      }
      throw new Error("Não foi possível gravar o estado completo: conflito de gravação persistente (demasiadas tentativas).");
    },

    /**
     * Conteúdos pesados individuais (o HTML completo de um serviço, por
     * exemplo) vivem no seu próprio blob — nunca fazem parte do `putAll`
     * principal, para que o pedido de gravação do estado geral se mantenha
     * sempre pequeno e rápido, independentemente de quantos/quão grandes
     * sejam os documentos já carregados.
     *
     * Sem limite de tamanho: ficheiros maiores do que o limite de 6MB por
     * pedido das funções do Netlify são automaticamente divididos em
     * pedaços mais pequenos (ver `guardarConteudoFragmentado`), cada um
     * gravado no seu próprio blob e depois remontados na leitura. O
     * utilizador nunca vê esta divisão — só o servidor, através das chaves
     * "...:part:N" e "...:meta".
     */
    async getAsset(key) {
      const res = await fetchAutenticado(ASSET_URL(key), { headers: { Accept: "application/json" } });
      if (res.ok) { const data = await res.json(); return data.content; }
      if (res.status !== 404) {
        const corpo = await res.json().catch(() => ({}));
        throw new Error(corpo.error || `Não foi possível ler o conteúdo do servidor (HTTP ${res.status}).`);
      }
      // não existe no caminho "simples": pode estar guardado em pedaços
      const metaRes = await fetchAutenticado(ASSET_URL(metaKey(key)), { headers: { Accept: "application/json" } });
      if (metaRes.status === 404) return null;
      if (!metaRes.ok) {
        const corpo = await metaRes.json().catch(() => ({}));
        throw new Error(corpo.error || `Não foi possível ler o índice do conteúdo (HTTP ${metaRes.status}).`);
      }
      const metaData = await metaRes.json();
      const meta = JSON.parse(metaData.content);
      const partes = [];
      for (let i = 0; i < meta.totalParts; i++) {
        const partRes = await fetchAutenticado(ASSET_URL(partKey(key, i)), { headers: { Accept: "application/json" } });
        if (!partRes.ok) {
          const corpo = await partRes.json().catch(() => ({}));
          throw new Error(corpo.error || `Falha ao obter a parte ${i + 1}/${meta.totalParts} do conteúdo.`);
        }
        const partData = await partRes.json();
        partes.push(partData.content);
      }
      return partes.join("");
    },

    async setAsset(key, content, onProgress) {
      // regista quantos pedaços existiam antes desta gravação, para limpar
      // sobras a seguir (ex.: se o novo ficheiro precisa de menos pedaços).
      let totalPartsAntigo = 0;
      try {
        const metaRes = await fetchAutenticado(ASSET_URL(metaKey(key)), { headers: { Accept: "application/json" } });
        if (metaRes.ok) { const d = await metaRes.json(); totalPartsAntigo = JSON.parse(d.content).totalParts || 0; }
      } catch (e) { /* sem manifesto anterior: assume 0 partes */ }

      let totalPartsNovo = 0;
      if (content.length <= TAMANHO_PEDACO) {
        const res = await fetchAutenticado(ASSET_URL(key), {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content })
        });
        if (!res.ok) {
          const corpo = await res.json().catch(() => ({}));
          throw new Error(corpo.error || `Não foi possível gravar o conteúdo no servidor (HTTP ${res.status}).`);
        }
      } else {
        totalPartsNovo = Math.ceil(content.length / TAMANHO_PEDACO);
        for (let i = 0; i < totalPartsNovo; i++) {
          const pedaco = content.slice(i * TAMANHO_PEDACO, (i + 1) * TAMANHO_PEDACO);
          const res = await fetchAutenticado(ASSET_URL(partKey(key, i)), {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: pedaco })
          });
          if (!res.ok) {
            const corpo = await res.json().catch(() => ({}));
            throw new Error(corpo.error || `Falha ao enviar a parte ${i + 1}/${totalPartsNovo} do ficheiro.`);
          }
          if (onProgress) onProgress(i + 1, totalPartsNovo);
        }
        const resMeta = await fetchAutenticado(ASSET_URL(metaKey(key)), {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: JSON.stringify({ totalParts: totalPartsNovo }) })
        });
        if (!resMeta.ok) {
          const corpo = await resMeta.json().catch(() => ({}));
          throw new Error(corpo.error || "Falha ao gravar o índice do conteúdo fragmentado.");
        }
        fetchAutenticado(ASSET_URL(key), { method: "DELETE" }).catch(() => {}); // limpa um eventual conteúdo "simples" de uma gravação anterior
      }

      // limpeza best-effort de pedaços que já não são precisos
      if (totalPartsNovo === 0 && totalPartsAntigo > 0) fetchAutenticado(ASSET_URL(metaKey(key)), { method: "DELETE" }).catch(() => {});
      for (let i = totalPartsNovo; i < totalPartsAntigo; i++) fetchAutenticado(ASSET_URL(partKey(key, i)), { method: "DELETE" }).catch(() => {});
    },

    async deleteAsset(key) {
      try {
        await fetchAutenticado(ASSET_URL(key), { method: "DELETE" });
        const metaRes = await fetchAutenticado(ASSET_URL(metaKey(key)));
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          const meta = JSON.parse(metaData.content);
          await fetchAutenticado(ASSET_URL(metaKey(key)), { method: "DELETE" }).catch(() => {});
          for (let i = 0; i < meta.totalParts; i++) fetchAutenticado(ASSET_URL(partKey(key, i)), { method: "DELETE" }).catch(() => {});
        }
      } catch (e) { /* limpeza best-effort — não bloqueia o resto do fluxo */ }
    }
  };
}

/** Liga-se ao servidor pela primeira vez (equivalente ao antigo "abrir a base de dados"). */
export async function initRemote() {
  await ensureLoaded();
}

/**
 * Cache local (mesma chave usada por assets/module-chrome.js) do nome e
 * logótipo da farmácia — permite que os módulos (abertos num <iframe> da
 * mesma origem) pintem instantaneamente o cabeçalho, sem esperar pela sua
 * própria chamada de rede, assim que a Central os tiver carregado alguma
 * vez nesta sessão de navegador.
 */
const BRANDING_CACHE_KEY = "central_saas_branding_cache_v1";
export function cacheBrandingLocal(nomeFarmacia, logo) {
  try {
    localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify({ nomeFarmacia: nomeFarmacia || null, logo: logo || null, ts: Date.now() }));
  } catch (e) { /* localStorage indisponível — não é crítico */ }
}

/** Usado apenas pelos testes automatizados, para isolar o cache do módulo entre casos de teste. */
export function __resetCacheForTests() {
  cache = null;
  cacheLoaded = false;
}

/** Ponto 57 — expostas só para teste unitário direto do merge por diferença (ver tests/db.test.js). */
export function __calcularDiffParaTeste(antes, depois) { return calcularDiff(antes, depois); }
export function __aplicarDiffParaTeste(lista, diff) { return aplicarDiff(lista, diff); }

/**
 * Prepara o estado inicial do servidor, caso ainda esteja vazio:
 *  1. Se este computador tiver dados antigos no IndexedDB local (de uma
 *     versão anterior), são enviados uma única vez para o servidor.
 *  2. Caso contrário, e se o servidor não tiver NENHUMA categoria, semeia as
 *     categorias por omissão — assim todos os computadores partem do mesmo
 *     ponto, não apenas o primeiro a abrir a aplicação.
 */
export async function migrarDadosLocaisSeNecessario(dataStore, categoriasPadrao) {
  const remoto = await dataStore.getAll("servicos");
  const remotoCategorias = await dataStore.getAll("categorias");
  if (remoto.length > 0 || remotoCategorias.length > 0) return { migrado: false };

  const local = await lerIndexedDBAntigoSeExistir();
  if (local && (local.servicos.length || local.categorias.length)) {
    if (local.categorias.length) await dataStore.putAll("categorias", local.categorias);
    if (local.servicos.length) await dataStore.putAll("servicos", local.servicos);
    if (local.config.logo) await dataStore.setConfig("logo", local.config.logo);
    if (local.config.nomeFarmacia) await dataStore.setConfig("nomeFarmacia", local.config.nomeFarmacia);
    return { migrado: true, total: local.servicos.length };
  }

  if (categoriasPadrao && categoriasPadrao.length) await dataStore.putAll("categorias", categoriasPadrao);
  return { migrado: false, semeado: true };
}

function lerIndexedDBAntigoSeExistir() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolveOuter) => {
    (async () => {
      try {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          if (!dbs.some(d => d.name === OLD_INDEXEDDB_NAME)) { resolveOuter(null); return; }
        }
      } catch (e) { /* API não suportada neste browser; tenta mesmo assim abrir */ }

      let resolved = false;
      const done = (val) => { if (!resolved) { resolved = true; resolveOuter(val); } };
      let req;
      try { req = indexedDB.open(OLD_INDEXEDDB_NAME); } catch (e) { done(null); return; }
      req.onerror = () => done(null);
      req.onupgradeneeded = () => { done(null); }; // base inexistente: não criar nada, abortar
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("servicos")) { db.close(); done(null); return; }
        try {
          const stores = ["servicos"];
          if (db.objectStoreNames.contains("categorias")) stores.push("categorias");
          if (db.objectStoreNames.contains("config")) stores.push("config");
          const tx = db.transaction(stores, "readonly");
          const reqS = tx.objectStore("servicos").getAll();
          const reqC = db.objectStoreNames.contains("categorias") ? tx.objectStore("categorias").getAll() : null;
          const reqCfg = db.objectStoreNames.contains("config") ? tx.objectStore("config").getAll() : null;
          tx.oncomplete = () => {
            const config = {};
            (reqCfg?.result || []).forEach(c => { config[c.key] = c.value; });
            db.close();
            done({ servicos: reqS.result || [], categorias: reqC?.result || [], config });
          };
          tx.onerror = () => { db.close(); done(null); };
        } catch (e) { db.close(); done(null); }
      };
    })();
  });
}
