/**
 * store.js — Store reativo e imutável.
 *
 * - O estado nunca é mutado: cada ação produz um NOVO objeto de estado,
 *   devolvido pelo reducer puro `reducer()` e imediatamente congelado
 *   (`Object.freeze`, recursivo) antes de substituir o estado anterior.
 * - `dispatch()` só atualiza o estado em memória; não sabe nada de
 *   IndexedDB (local, hoje já não usado como fonte principal) ou à API do
 *   servidor. A persistência é responsabilidade da camada de "actions"
 *   (ver actions.js), que despacha a ação pura e agenda a gravação
 *   assíncrona à parte — separação clássica entre reducer (síncrono,
 *   sem efeitos) e efeitos (assíncronos, isolados).
 */
import { deepFreeze } from "./utils.js";
import { CATEGORIA_INDEFINIDA_ID, reatribuirAoEliminarCategoria } from "./domain.js";

export const initialState = Object.freeze({
  servicos: [],
  categorias: [],
  searchQuery: "",
  scope: { tipo: "home" },
  sortBy: "ordem",
  viewMode: "grid",
  logoBase64: null,
  nomeFarmacia: "Farmácia",
  morada: "",
  cidade: "",
  emailContacto: "",
  telefoneContacto: "",
  idioma: "pt",
  syncStatus: "synced",
  pronto: false
});

export function reducer(state, action) {
  switch (action.type) {
    case "INIT_STATE":
      return { ...state, ...action.payload, pronto: true };

    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };

    case "SET_SCOPE":
      return { ...state, scope: action.scope };

    case "SET_SORT":
      return { ...state, sortBy: action.sortBy };

    case "SET_VIEWMODE":
      return { ...state, viewMode: action.viewMode };

    case "SET_SYNC_STATUS":
      return { ...state, syncStatus: action.status };

    case "SET_LOGO":
      return { ...state, logoBase64: action.logoBase64 };

    case "SET_NOME_FARMACIA":
      return { ...state, nomeFarmacia: action.nome };

    case "SET_MORADA":
      return { ...state, morada: action.valor };

    case "SET_CIDADE":
      return { ...state, cidade: action.valor };

    case "SET_EMAIL_CONTACTO":
      return { ...state, emailContacto: action.valor };

    case "SET_TELEFONE_CONTACTO":
      return { ...state, telefoneContacto: action.valor };

    case "SET_IDIOMA":
      return { ...state, idioma: action.idioma };

    case "ADD_SERVICO":
      return { ...state, servicos: [...state.servicos, action.servico] };

    case "UPDATE_SERVICO":
      return { ...state, servicos: state.servicos.map(s => s.id === action.id ? { ...s, ...action.dados } : s) };

    case "REMOVE_SERVICO":
      return { ...state, servicos: state.servicos.filter(s => s.id !== action.id) };

    case "TOGGLE_FAVORITO":
      return { ...state, servicos: state.servicos.map(s => s.id === action.id ? { ...s, favorito: !s.favorito, atualizadoEm: Date.now() } : s) };

    case "REGISTER_ACESSO":
      return {
        ...state,
        servicos: state.servicos.map(s => s.id === action.id
          ? { ...s, ultimoAcesso: Date.now(), contadorAcessos: (s.contadorAcessos || 0) + 1 }
          : s)
      };

    case "REORDER_SERVICOS": {
      const lista = state.servicos.slice();
      const fromIdx = lista.findIndex(s => s.id === action.fromId);
      const toIdx = lista.findIndex(s => s.id === action.toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      const [moved] = lista.splice(fromIdx, 1);
      lista.splice(toIdx, 0, moved);
      const reindexed = lista.map((s, i) => ({ ...s, ordem: i }));
      return { ...state, servicos: reindexed };
    }

    case "ADD_CATEGORIA":
      return { ...state, categorias: [...state.categorias, action.categoria] };

    case "UPDATE_CATEGORIA":
      return { ...state, categorias: state.categorias.map(c => c.id === action.id ? { ...c, ...action.dados } : c) };

    case "REORDER_CATEGORIAS": {
      const { fromId, toId } = action;
      const from = state.categorias.find(c => c.id === fromId);
      const to = state.categorias.find(c => c.id === toId);
      if (!from || !to || from.parentId !== to.parentId) return state; // só reordena entre irmãs (mesmo nível)
      const irmas = state.categorias.filter(c => c.parentId === from.parentId).sort((a, b) => a.ordem - b.ordem);
      const outras = state.categorias.filter(c => c.parentId !== from.parentId);
      const fromIdx = irmas.findIndex(c => c.id === fromId);
      const toIdx = irmas.findIndex(c => c.id === toId);
      const [moved] = irmas.splice(fromIdx, 1);
      irmas.splice(toIdx, 0, moved);
      const reindexadas = irmas.map((c, i) => ({ ...c, ordem: i }));
      return { ...state, categorias: [...outras, ...reindexadas] };
    }

    case "REMOVE_CATEGORIA": {
      if (action.id === CATEGORIA_INDEFINIDA_ID) return state;
      const { categorias, servicos } = reatribuirAoEliminarCategoria(state.categorias, state.servicos, action.id);
      let scope = state.scope;
      if (scope.tipo !== "home" && scope.tipo !== "tudo" && scope.tipo !== "favoritos" && scope.categoriaId === action.id) {
        scope = { tipo: "home" };
      }
      return { ...state, categorias, servicos, scope };
    }

    case "SET_SERVICOS":
      return { ...state, servicos: action.servicos };

    case "SET_CATEGORIAS":
      return { ...state, categorias: action.categorias };

    case "IMPORT_DADOS":
      return { ...state, ...action.payload };

    case "RESET_TUDO":
      return { ...initialState, categorias: action.categoriasPadrao, pronto: true };

    default:
      return state;
  }
}

export function createStore(reducerFn, initState) {
  let state = deepFreeze(initState);
  const listeners = new Set();
  return {
    getState() { return state; },
    dispatch(action) {
      const next = reducerFn(state, action);
      if (next !== state) {
        state = deepFreeze(next);
        listeners.forEach(fn => { try { fn(state, action); } catch (e) { console.error("Erro num subscritor do store:", e); } });
      }
      return state;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
