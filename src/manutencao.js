/**
 * src/manutencao.js — lógica pura de "Auto-manutenção da Central" (ponto 21
 * do pedido do Ivo, "Todos": verificação/reparação de integridade + cópias
 * de segurança automáticas com restauro + painel de saúde/desempenho).
 *
 * Deliberadamente sem nenhum acesso a rede/armazenamento — todas as funções
 * aqui são puras (recebem o estado, devolvem um resultado ou um novo
 * estado), para serem testáveis sem servidor. A camada de rede/UI vive em
 * src/ui/manutencao.js, que chama estas funções com o estado vindo de
 * `dataStore.getEstadoCompleto()`.
 *
 * "Estado" aqui é sempre o objeto completo devolvido por GET /api/data
 * (não só { servicos, categorias, config } — inclui também as fatias
 * próprias de cada módulo, ex. `pim`, `documentos`, `aue`, `stocks`, etc.).
 */
import { uid } from "./utils.js";

/* ======================================================================
   Verificação/reparação de integridade
   ====================================================================== */

/**
 * Percorre o estado à procura de arrays que sigam a convenção de "coleção
 * com id" (a maioria dos módulos guarda listas de registos com um campo
 * `id`). Genérico de propósito — em vez de listar à mão o nome de cada
 * coleção de cada módulo (o que ficaria desatualizado a cada módulo novo),
 * deteta a convenção pela forma dos dados: só considera uma coleção
 * "com id" se pelo menos metade dos seus itens já tiverem um `id`
 * preenchido — isto evita gerar ruído em arrays que nunca usaram id (ex.:
 * pares {label,value} de opções).
 */
function coletarColecoesComId(estado, profundidadeMax = 4) {
  const encontradas = [];
  function andar(valor, caminho, profundidade) {
    if (profundidade > profundidadeMax || valor == null || typeof valor !== "object") return;
    if (Array.isArray(valor)) {
      if (!valor.length) return;
      const itensObjeto = valor.filter(v => v && typeof v === "object" && !Array.isArray(v));
      if (itensObjeto.length < valor.length * 0.5) return; // não é uma lista de registos
      const comId = itensObjeto.filter(v => v.id !== undefined && v.id !== null && v.id !== "").length;
      if (comId < itensObjeto.length * 0.5) return; // esta coleção não segue a convenção de id
      encontradas.push({ modulo: caminho[0] || "central", chave: caminho.join("."), lista: valor });
      return; // não desce dentro de uma coleção já identificada
    }
    Object.entries(valor).forEach(([k, v]) => andar(v, [...caminho, k], profundidade + 1));
  }
  andar(estado, [], 0);
  return encontradas;
}

function getPorCaminho(obj, caminhoPontos) {
  return caminhoPontos.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function resumirProblemas(problemas) {
  const porModulo = {};
  let erros = 0, avisos = 0, reparaveis = 0;
  problemas.forEach(p => {
    porModulo[p.modulo] = (porModulo[p.modulo] || 0) + 1;
    if (p.severidade === "erro") erros++; else avisos++;
    if (p.reparavel) reparaveis++;
  });
  return { total: problemas.length, erros, avisos, reparaveis, porModulo };
}

/**
 * Corre as verificações estruturais conhecidas sobre o estado partilhado de
 * uma farmácia e devolve a lista de problemas encontrados — NUNCA modifica
 * o estado (ver repararIntegridade() para a reparação). Cada problema:
 *   { id, modulo, tipo, severidade:'aviso'|'erro', descricao, reparavel, reparo? }
 */
export function verificarIntegridade(estado) {
  const problemas = [];
  if (!estado || typeof estado !== "object") return { problemas, resumo: resumirProblemas(problemas) };

  // --- Regra concreta 1: registos do PIM que referenciam um utente que já
  //     não existe (utenteId órfão) — a única relação entre coleções que a
  //     Central já conhece hoje. Reparação segura: remover o registo órfão. ---
  const pim = estado.pim || {};
  const utentes = Array.isArray(pim.pim_utentes_v1) ? pim.pim_utentes_v1 : [];
  const idsUtentes = new Set(utentes.map(u => u?.id).filter(Boolean));
  [
    ["pim_medicamentos_v1", "medicamento"],
    ["pim_eventos_v1", "evento de calendário"],
    ["pim_stock_v1", "movimento de stock"],
    ["pim_rotulos_v1", "histórico de rótulo"],
  ].forEach(([chave, nomeItem]) => {
    const lista = Array.isArray(pim[chave]) ? pim[chave] : [];
    lista.forEach(item => {
      if (item && item.utenteId && !idsUtentes.has(item.utenteId)) {
        problemas.push({
          id: `pim-orfao-${chave}-${item.id || uid("tmp")}`,
          modulo: "pim", tipo: "referencia_orfa", severidade: "aviso",
          descricao: `Um registo de ${nomeItem} do PIM refere um utente que já não existe (utenteId "${item.utenteId}").`,
          reparavel: true, reparo: { acao: "remover_item", colecao: `pim.${chave}`, itemId: item.id }
        });
      }
    });
  });

  // --- Regra genérica 2: ids em falta ou duplicados em qualquer coleção
  //     conhecida (todos os módulos, sem precisar de os listar à mão). ---
  coletarColecoesComId(estado).forEach(({ modulo, chave, lista }) => {
    const vistos = new Map();
    lista.forEach((item, idx) => {
      if (!item || typeof item !== "object") return;
      if (item.id === undefined || item.id === null || item.id === "") {
        problemas.push({
          id: `${modulo}-semid-${chave}-${idx}`,
          modulo, tipo: "sem_id", severidade: "erro",
          descricao: `Um registo em "${chave}" não tem identificador (id) — pode impedir edição/remoção corretas.`,
          reparavel: true, reparo: { acao: "atribuir_id", colecao: chave, indice: idx }
        });
        return;
      }
      if (vistos.has(item.id)) {
        problemas.push({
          id: `${modulo}-dup-${chave}-${item.id}-${idx}`,
          modulo, tipo: "id_duplicado", severidade: "erro",
          descricao: `Existe mais de um registo com o mesmo identificador ("${item.id}") em "${chave}".`,
          reparavel: true, reparo: { acao: "renovar_id", colecao: chave, indice: idx }
        });
      }
      vistos.set(item.id, idx);
    });
  });

  return { problemas, resumo: resumirProblemas(problemas) };
}

/**
 * Aplica as reparações seguras de uma lista de problemas (normalmente a
 * devolvida por verificarIntegridade()) a uma CÓPIA do estado — nunca muta
 * o estado recebido. Devolve { estado: novoEstado, reparos: [...] }, onde
 * `reparos` são os problemas efetivamente corrigidos (para reportar ao
 * utilizador o que foi feito).
 */
export function repararIntegridade(estado, problemas) {
  const novoEstado = JSON.parse(JSON.stringify(estado || {}));
  const reparos = [];
  (problemas || []).filter(p => p.reparavel && p.reparo).forEach(p => {
    const r = p.reparo;
    const lista = getPorCaminho(novoEstado, r.colecao);
    if (!Array.isArray(lista)) return;
    if (r.acao === "remover_item") {
      const idx = lista.findIndex(it => it && it.id === r.itemId);
      if (idx >= 0) { lista.splice(idx, 1); reparos.push(p); }
    } else if (r.acao === "atribuir_id") {
      const item = lista[r.indice];
      if (item && (item.id === undefined || item.id === null || item.id === "")) {
        item.id = uid("rep");
        reparos.push(p);
      }
    } else if (r.acao === "renovar_id") {
      const item = lista[r.indice];
      if (item) { item.id = uid("rep"); reparos.push(p); }
    }
  });
  return { estado: novoEstado, reparos };
}

/* ======================================================================
   Cópias de segurança (manifesto — o conteúdo pesado de cada backup vive
   num asset próprio, `backup-<id>`, gravado/lido por src/ui/manutencao.js)
   ====================================================================== */

/** Mantém só os `maxBackups` mais recentes de um manifesto — devolve a
 *  lista podada e os removidos (para o chamador apagar os assets deles). */
export function podarBackups(manifesto, maxBackups = 20) {
  const lista = (Array.isArray(manifesto) ? [...manifesto] : []).sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
  if (lista.length <= maxBackups) return { manifestoPodado: lista, removidos: [] };
  return { manifestoPodado: lista.slice(lista.length - maxBackups), removidos: lista.slice(0, lista.length - maxBackups) };
}

/** true se já não há nenhum backup, ou se o mais recente tem mais de
 *  `intervaloHoras` — usado para decidir se se cria um backup automático
 *  silencioso ao abrir a Central (ver iniciarBackupAutomatico em
 *  src/ui/manutencao.js). */
export function precisaBackupAutomatico(manifesto, agora = new Date(), intervaloHoras = 24) {
  const lista = Array.isArray(manifesto) ? manifesto : [];
  if (!lista.length) return true;
  const ultimo = lista[lista.length - 1];
  if (!ultimo || !ultimo.criadoEm) return true;
  return (agora.getTime() - new Date(ultimo.criadoEm).getTime()) >= intervaloHoras * 3600 * 1000;
}

/* ======================================================================
   Painel de saúde/desempenho
   ====================================================================== */

export function fmtBytes(n) {
  if (!n) return "0 B";
  const unidades = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < unidades.length - 1) { v /= 1024; i++; }
  const casas = i > 0 && !Number.isInteger(v) ? 1 : 0;
  return `${v.toFixed(casas)} ${unidades[i]}`;
}

/** Resumo do "estado de saúde" desta farmácia: tamanho aproximado do estado
 *  partilhado, nº de registos por módulo, e informação do backup mais
 *  recente. `manifestoBackups` é opcional (config.manutBackups). */
export function calcularSaude(estado, manifestoBackups) {
  const json = JSON.stringify(estado || {});
  const tamanhoBytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).length : json.length;
  const contagens = {};
  let totalItens = 0;
  function andar(valor, caminho, profundidade) {
    if (profundidade > 3 || valor == null || typeof valor !== "object") return;
    if (Array.isArray(valor)) {
      if (valor.length) {
        const modulo = caminho[0] || "central";
        contagens[modulo] = (contagens[modulo] || 0) + valor.length;
        totalItens += valor.length;
      }
      return;
    }
    Object.entries(valor).forEach(([k, v]) => andar(v, [...caminho, k], profundidade + 1));
  }
  andar(estado, [], 0);
  const backups = Array.isArray(manifestoBackups) ? manifestoBackups : [];
  return {
    tamanhoBytes,
    contagens,
    totalItens,
    totalBackups: backups.length,
    ultimoBackup: backups.length ? backups[backups.length - 1] : null
  };
}
