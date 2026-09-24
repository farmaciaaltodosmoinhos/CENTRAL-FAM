/**
 * src/produtosCatalogo.js — catálogo de produtos/medicamentos partilhado.
 *
 * Antes desta peça, a Gestão de Gabinete, a Gestão de PIM e os Stocks
 * Errados traziam cada uma a sua PRÓPRIA cópia embutida do catálogo
 * (~1.6MB de JSON, ~29 mil produtos) — as três cópias eram byte-a-byte
 * idênticas. Isto tinha dois problemas: a app ficava mais pesada (o mesmo
 * catálogo descarregado 3 vezes) e não havia forma de editar/adicionar
 * produtos num sítio só e ver o resultado em todo o lado.
 *
 * Arquitetura nova, pensada para escalar a milhares de farmácias sem
 * multiplicar armazenamento:
 *
 *  1. CATÁLOGO BASE — o catálogo oficial (~29 mil produtos), igual para
 *     todas as farmácias. Vive num único ficheiro estático
 *     (`/assets/catalogo-base.json`), servido pelo CDN do Netlify e
 *     cacheado pelo browser — nunca replicado por farmácia.
 *
 *  2. "OVERLAY" por farmácia — só as DIFERENÇAS desta farmácia em relação
 *     ao catálogo base: produtos que adicionou, produtos que editou,
 *     códigos que removeu/ocultou. Isto é tipicamente pequeno (dezenas a
 *     milhares de entradas, não dezenas de milhares), por isso vive no
 *     "asset store" já existente (mesmo mecanismo usado para anexos
 *     pesados — ver src/db.js), isolado por tenantId como tudo o resto,
 *     e completamente à parte do estado geral (`/api/data`) para nunca
 *     tornar mais lenta uma gravação que não tenha nada a ver com produtos
 *     (ex.: marcar um serviço como favorito).
 *
 *  3. CATÁLOGO EFETIVO — o que cada módulo/ferramenta realmente usa:
 *     catálogo base menos os códigos removidos, com as edições aplicadas,
 *     mais os produtos adicionados por esta farmácia. Calculado em memória,
 *     nunca gravado por inteiro.
 *
 * Formato de cada produto: tupla `[designacao, codigo, familiaIndex]` —
 * mantido igual ao formato antigo para os três módulos que já o liam não
 * precisarem de mudar a forma como pesquisam/mostram produtos.
 */

const BASE_URL = "/assets/catalogo-base.json";
const OVERLAY_ASSET_KEY = "catalogoProdutos";

let baseCache = null;
let baseCachePromise = null;

/** Vai buscar o catálogo base (uma só vez por sessão de página — fica em
 *  cache em memória; o browser também cacheia o próprio pedido HTTP). */
export async function carregarBase() {
  if (baseCache) return baseCache;
  if (!baseCachePromise) {
    baseCachePromise = fetch(BASE_URL, { headers: { Accept: "application/json" } })
      .then(res => {
        if (!res.ok) throw new Error("Não foi possível obter o catálogo base (HTTP " + res.status + ").");
        return res.json();
      })
      .then(data => {
        baseCache = {
          famNames: Array.isArray(data.famNames) ? data.famNames : [],
          products: Array.isArray(data.products) ? data.products : []
        };
        return baseCache;
      })
      .catch(err => { baseCachePromise = null; throw err; });
  }
  return baseCachePromise;
}

function overlayVazio() {
  return { adicionados: [], removidosCodigos: [], editados: {} };
}

/** Lê o overlay (diferenças) desta farmácia. Nunca falha "alto" — devolve
 *  overlay vazio se ainda não existir ou se a leitura falhar, para nunca
 *  bloquear os módulos que só querem LER o catálogo. */
export async function carregarOverlay(dataStore) {
  try {
    const raw = await dataStore.getAsset(OVERLAY_ASSET_KEY);
    if (!raw) return overlayVazio();
    const parsed = JSON.parse(raw);
    return {
      adicionados: Array.isArray(parsed.adicionados) ? parsed.adicionados : [],
      removidosCodigos: Array.isArray(parsed.removidosCodigos) ? parsed.removidosCodigos.map(String) : [],
      editados: parsed.editados && typeof parsed.editados === "object" ? parsed.editados : {}
    };
  } catch (e) {
    return overlayVazio();
  }
}

async function gravarOverlay(dataStore, overlay) {
  await dataStore.setAsset(OVERLAY_ASSET_KEY, JSON.stringify(overlay));
  return overlay;
}

/**
 * BUG REAL corrigido (2026-09, durante a expansão dos testes e2e): cada uma
 * das operações abaixo (adicionarProdutos/editarProduto/removerProduto/
 * restaurarProduto) fazia "ler o overlay do servidor -> alterá-lo em memória
 * -> gravar o overlay inteiro de volta" — exatamente o mesmo padrão de "lost
 * update" já identificado e corrigido nos módulos de PIM e Gestão de Gabinete
 * (ver `gravarQueue`/`enqueueSync` em modulos/pim.html e modulos/gabinete.html).
 * Aqui o sintoma era: um utilizador que adicionasse/editasse/removesse dois
 * produtos em sucessão rápida (ex.: "Adicionar manualmente" duas vezes
 * seguidas sem esperar a 1ª terminar) podia perder silenciosamente a 1ª
 * alteração — a 2ª chamada lia o overlay ANTES do PUT da 1ª lá chegar, e o
 * seu próprio PUT, escrito por cima, apagava-a. Confirmado com um teste e2e
 * que dispara duas adições quase em simultâneo (tests/e2e/modules/08-catalogo-produtos.mjs).
 * Corrigido da mesma forma: uma fila serializa TODAS as leituras+gravações
 * do overlay desta página, para que cada operação só comece (e por isso só
 * leia o overlay) depois de a anterior já ter gravado a sua.
 */
let overlayQueue = Promise.resolve();
function enqueueOverlaySync(task) {
  const run = overlayQueue.then(task, task);
  overlayQueue = run.then(() => {}, () => {}); // a fila continua mesmo que esta tarefa falhe
  return run;
}

/** Catálogo efetivo desta farmácia: base + overlay já aplicado. É isto que
 *  qualquer módulo que precise de pesquisar/mostrar produtos deve usar. */
export async function carregarCatalogoEfetivo(dataStore) {
  const [base, overlay] = await Promise.all([carregarBase(), carregarOverlay(dataStore)]);
  const removidos = new Set(overlay.removidosCodigos);
  const editados = overlay.editados || {};
  const products = [];
  for (const p of base.products) {
    const codigo = String(p[1]);
    if (removidos.has(codigo)) continue;
    products.push(Object.prototype.hasOwnProperty.call(editados, codigo) ? editados[codigo] : p);
  }
  for (const p of overlay.adicionados) products.push(p);
  return { products, famNames: base.famNames || [], overlay };
}

/** Adiciona um ou vários produtos novos (manual, Excel, PDF ou DMF) ao
 *  overlay desta farmácia. Produtos cujo código já exista (base ou
 *  adicionados) são ignorados aqui — usar editarProduto() para alterar um
 *  já existente. Devolve { overlay, adicionados, ignorados }. */
export async function adicionarProdutos(dataStore, novosProdutos, catalogoEfetivoAtual) {
  return enqueueOverlaySync(async () => {
    const overlay = await carregarOverlay(dataStore);
    const codigosConhecidos = new Set(overlay.adicionados.map(p => String(p[1])));
    if (catalogoEfetivoAtual) {
      for (const p of catalogoEfetivoAtual.products) codigosConhecidos.add(String(p[1]));
    }
    const adicionados = [];
    const ignorados = [];
    for (const p of novosProdutos) {
      const codigo = String(p[1] ?? "").trim();
      const nome = String(p[0] ?? "").trim();
      if (!nome) continue;
      if (codigo && codigosConhecidos.has(codigo)) { ignorados.push(p); continue; }
      const entrada = [nome, codigo || ("custom_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)), Number.isInteger(p[2]) ? p[2] : 4];
      overlay.adicionados.unshift(entrada);
      if (codigo) codigosConhecidos.add(codigo);
      adicionados.push(entrada);
    }
    await gravarOverlay(dataStore, overlay);
    return { overlay, adicionados, ignorados };
  });
}

/** Edita um produto existente (base ou já adicionado por esta farmácia),
 *  identificado pelo seu código ATUAL no catálogo efetivo. */
export async function editarProduto(dataStore, codigoAtual, produtoEditado) {
  return enqueueOverlaySync(async () => {
    const overlay = await carregarOverlay(dataStore);
    const codigo = String(codigoAtual);
    const idx = overlay.adicionados.findIndex(p => String(p[1]) === codigo);
    if (idx >= 0) {
      overlay.adicionados[idx] = produtoEditado;
    } else {
      overlay.editados[codigo] = produtoEditado;
    }
    await gravarOverlay(dataStore, overlay);
    return overlay;
  });
}

/** Remove um produto do catálogo efetivo desta farmácia: se foi adicionado
 *  por ela, é apagado do overlay; se é do catálogo base, fica marcado como
 *  removido (o catálogo base nunca é alterado — é partilhado por todos). */
export async function removerProduto(dataStore, codigo) {
  return enqueueOverlaySync(async () => {
    const overlay = await carregarOverlay(dataStore);
    const codigoStr = String(codigo);
    const idx = overlay.adicionados.findIndex(p => String(p[1]) === codigoStr);
    if (idx >= 0) {
      overlay.adicionados.splice(idx, 1);
    } else {
      if (!overlay.removidosCodigos.includes(codigoStr)) overlay.removidosCodigos.push(codigoStr);
      delete overlay.editados[codigoStr];
    }
    await gravarOverlay(dataStore, overlay);
    return overlay;
  });
}

/** Repõe um produto do catálogo base que tinha sido removido. */
export async function restaurarProduto(dataStore, codigo) {
  return enqueueOverlaySync(async () => {
    const overlay = await carregarOverlay(dataStore);
    const codigoStr = String(codigo);
    overlay.removidosCodigos = overlay.removidosCodigos.filter(c => c !== codigoStr);
    await gravarOverlay(dataStore, overlay);
    return overlay;
  });
}
