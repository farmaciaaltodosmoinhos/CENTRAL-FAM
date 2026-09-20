/**
 * src/manipuladosCore.js — lógica pura extraída de `modulos/manipulados.html`
 * (ponto 30), para deixar de haver duas cópias da mesma informação/regras:
 * uma só fonte de verdade que tanto a UI do módulo como a FARMA (ponto 30,
 * `src/farmaAcoes.js`) usam para mudar o estado de um pedido de manipulado.
 *
 * Sem I/O nenhum aqui (sem fetch, sem DOM) — só transformações de dados,
 * testáveis isoladamente. Mesma filosofia de `src/farmaIa.js`/`src/manutencao.js`.
 */

export const STATUS_MANIPULADOS = {
  pendente_utente:    { label: 'Pendente — aguarda utente',   class: 's-pendente' },
  pendente_farmacia:  { label: 'Pendente — aguarda farmácia', class: 's-pendente2' },
  preparacao:         { label: 'Em preparação',               class: 's-preparacao' },
  pronto:             { label: 'Pronto p/ levantamento',      class: 's-pronto' },
  entregue:           { label: 'Entregue',                    class: 's-entregue' },
  cancelado:          { label: 'Cancelado',                   class: 's-cancelado' },
};

const FECHADOS = new Set(['entregue', 'cancelado']);

/** Mesma regra já usada em manipulados.html (ponto 20/30): identifica qual a
 * tarefa a registar em Poupança & ROI quando um pedido muda de estado.
 * Devolve `null` quando não há transição real a registar. */
export function tarefaTransicaoEstado(estadoAnterior, estadoNovo) {
  if (!estadoNovo || estadoAnterior === estadoNovo) return null;
  const veioFechado = FECHADOS.has(estadoAnterior);
  const vaiFechado = FECHADOS.has(estadoNovo);
  if (veioFechado && !vaiFechado) return 'reabrir_pedido';
  const porEstado = {
    pendente_utente: 'mudar_pendente_utente',
    pendente_farmacia: 'mudar_pendente_farmacia',
    preparacao: 'mudar_preparacao',
    pronto: 'mudar_pronto',
    entregue: 'marcar_entregue',
    cancelado: 'mudar_cancelado',
  };
  return porEstado[estadoNovo] || null;
}

/** Procura, entre os pedidos AINDA não fechados (entregue/cancelado), o(s)
 * que correspondem a um texto livre (nome do utente ou do medicamento —
 * a forma mais natural de alguém, ou a FARMA, referir um pedido sem saber
 * o id interno). Devolve todas as correspondências — quem chama decide o
 * que fazer com 0, 1 ou várias (nunca adivinha entre várias). */
export function encontrarPedidosPorTexto(pedidos, texto) {
  const alvo = (texto || '').trim().toLowerCase();
  if (!alvo) return [];
  return (pedidos || []).filter(p => {
    const nome = (p.nome || '').toLowerCase();
    const medicamento = (p.medicamento || '').toLowerCase();
    // ponto 32: também procura pelo nome do animal (prescrições de uso
    // veterinário) — na conversa, é normal referir-se ao pedido pelo animal
    // ("o pedido do Bolinha"), não só pelo dono ou pelo medicamento.
    const animal = (p.animal || '').toLowerCase();
    return nome.includes(alvo) || medicamento.includes(alvo) || (!!animal && animal.includes(alvo));
  });
}

/**
 * Aplica uma mudança de estado a UM pedido identificado por id, sem mutar a
 * lista recebida (devolve sempre uma lista nova). Não sabe nada de rede —
 * quem chama é responsável por persistir o resultado.
 *
 * @returns {{ok:true, pedidos:Array, estadoAnterior:string, tarefa:string|null}
 *          | {ok:false, motivo:string}}
 */
export function mudarEstadoPedido(pedidos, id, novoEstado) {
  if (!STATUS_MANIPULADOS[novoEstado]) {
    return { ok: false, motivo: `Estado "${novoEstado}" não existe.` };
  }
  const idx = (pedidos || []).findIndex(p => p.id === id);
  if (idx === -1) {
    return { ok: false, motivo: 'Pedido não encontrado.' };
  }
  const estadoAnterior = pedidos[idx].status;
  const novaLista = pedidos.slice();
  novaLista[idx] = { ...novaLista[idx], status: novoEstado };
  return {
    ok: true,
    pedidos: novaLista,
    estadoAnterior,
    tarefa: tarefaTransicaoEstado(estadoAnterior, novoEstado),
  };
}
