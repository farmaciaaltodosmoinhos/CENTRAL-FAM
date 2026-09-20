/**
 * src/farmaIa.js — lógica pura da "FARMA IA" (ponto 25, terceiro e último dos
 * "3 módulos grandes" do pedido de 12 itens, ver pontos 21/23/24), autónoma e
 * sem nenhuma chamada a um serviço externo de IA — o pedido do Ivo foi
 * explícito quanto a isto ("de forma bem completa", os 3 pilares, mas sem API
 * externa). Os "3 pilares":
 *
 *   1. Alertas/insights proativos — `gerarAlertas(estado, agora)`.
 *   2. Assistente de perguntas e respostas, por motor de regras —
 *      `responderPergunta(pergunta, estado, contexto)`.
 *   3. Deteção de oportunidades de automação/atalho, a partir do tracking de
 *      uso já existente (ponto 17) — `detectarOportunidadesAutomacao(diasUso, opts)`.
 *
 * Segue à letra o mesmo padrão arquitetural de src/manutencao.js (ponto 23):
 * nenhum acesso a rede/armazenamento aqui — tudo funções puras que recebem o
 * estado (o mesmo objeto completo de `dataStore.getEstadoCompleto()`, com as
 * fatias de cada módulo: `pim`, `gabinete`, `stocksErrados`, `aue`,
 * `manipulados`) e devolvem um resultado estruturado, nunca mutando o que
 * recebem. A camada de rede/UI vive em src/ui/farmaIa.js.
 *
 * Nota honesta de âmbito: `src/usoLeitura.js` só guarda CONTAGENS por dia por
 * tarefa (`{dia: {"modulo.tarefaId": contagem}}`) — sem timestamp nem ordem
 * dentro do dia. Por isso a deteção de "oportunidades de automação" (pilar 3)
 * não consegue detetar sequências ("o utilizador faz X e depois sempre Y") —
 * só consegue medir VOLUME/frequência de uma tarefa repetida, que é o sinal
 * realista disponível nos dados existentes.
 *
 * ---------------------------------------------------------------------
 * Ponto 26 — "Memória & Aprendizagem". Pedido do Ivo: "quero que a farma vá
 * aprendendo conforme os pedidos vão surgindo" + "dá à farma uma aceleração
 * de aprendizagem intensiva com tudo o que aches importante". Continua sem
 * NENHUMA API externa — "aprender" aqui significa memória persistida por
 * farmácia (`config.farmaIaMemoria`, gravada via dataStore.setConfig, o
 * mesmo padrão de `cidade`/`idioma` dos pontos 22/24), com 3 mecanismos:
 *
 *   a) Perguntas não reconhecidas ficam registadas (`registarPerguntaNao-
 *      Reconhecida`), para o histórico ficar disponível a quem gere a
 *      farmácia rever o que os utilizadores tentaram perguntar.
 *   b) Um "sim, quis dizer isto" da UI ensina um alias literal
 *      (`ensinarAlias`) — da próxima vez que a MESMA pergunta (normalizada)
 *      for feita, responde-se de imediato, sem adivinhar. Isto é uma tabela
 *      de correspondência exacta aprendida, não um modelo estatístico.
 *   c) Alertas podem ser silenciados temporariamente (`dispensarAlerta`,
 *      por omissão 7 dias — nunca para sempre, para nunca esconder de vez um
 *      problema real como uma validade expirada).
 *
 * Adicionalmente, esta ronda também alargou a cobertura de sinónimos dos
 * INTENTS existentes e acrescentou 3 novos (backup, oportunidades, ajuda) —
 * a "aceleração" pedida é sobretudo isto: mais vocabulário reconhecido à
 * partida, para haver menos perguntas por aprender pela via (a)/(b).
 * ---------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------
 * Ponto 27 — "Canal de Aprendizagem" (Ivo ↔ Claude). Pedido do Ivo: ligar a
 * FARMA a mim (Claude) "não como uma API, mas como um lugar onde nós os dois
 * possamos conversar e a FARMA aprender — não só do meu conhecimento mas
 * também da minha forma de ser". Decisão tomada (ver arquitetura-decisoes.md,
 * ponto 27, para o mecanismo completo): NÃO uma ligação ao vivo à API da
 * Claude — isso quebraria "sem IA externa" e mandaria dados de utentes para
 * fora do sistema a cada pergunta. Em vez disso: eu e o Ivo continuamos a
 * conversar (nesta sessão/projeto), eu reviso o que a FARMA ainda não sabe
 * responder (`perguntasNaoReconhecidas`, ponto 26) e o que ele quer que ela
 * passe a saber, e traduzo isso em regras/respostas novas AQUI, no código —
 * nunca uma chamada de rede em tempo de execução. A FARMA mantém-se 100%
 * local, grátis por pergunta e sem nenhum dado de farmácia a sair do sistema.
 *
 * O que isto muda na prática ao escrever/rever uma resposta (`respostaX`) ou
 * o texto de um alerta (`alerta(...)`) neste ficheiro — a "forma de ser" que
 * o Ivo pediu, resumida em 4 regras:
 *   1. Nunca inventar um número/facto que os dados não suportam — antes
 *      explicar a limitação (ver `respostaPoupanca` sem `contexto.diasUso`)
 *      do que fingir uma certeza que não existe.
 *   2. Dizer o essencial em poucas palavras, mas nunca ao ponto de a frase
 *      ficar seca/robótica — uma pessoa a ler tem de perceber o "porquê", não
 *      só o número.
 *   3. Ser honesto sobre os próprios limites (ver as notas de âmbito no
 *      início deste ficheiro) em vez de prometer uma capacidade que o motor
 *      de regras não tem.
 *   4. Português de Portugal, registo cordial mas direto — o mesmo tom já
 *      usado em todo `respostaX`/`alerta(...)` existente; qualquer resposta
 *      nova devia soar como se pertencesse ao mesmo conjunto.
 * ---------------------------------------------------------------------
 */
import { agregarPorTarefa, calcularPoupanca, fmtDuracao } from "./usoLeitura.js";
import { precisaBackupAutomatico } from "./manutencao.js";
import { preverIntent, similaridadeCosseno } from "./farmaRede.js";
import { pesquisarConhecimento } from "./farmaLeitura.js";

/* ======================================================================
   Limiares (exportados para os testes e para a UI poderem referir os
   mesmos números que o motor usa, em vez de os duplicar às cegas).
   ====================================================================== */
export const LIMIAR_VALIDADE_AVISO_DIAS = 30;
export const LIMIAR_ROTULO_PIM_AVISO_DIAS = 7;
export const LIMIAR_PEDIDO_PARADO_AUE_DIAS = 10;
export const LIMIAR_PEDIDO_PARADO_MANIPULADOS_DIAS = 5;
export const LIMIAR_REPETICAO_STOCKS_LISTAS = 3;
export const LIMIAR_OPORTUNIDADE_OCORRENCIAS = 15;
export const LIMIAR_BACKUP_SEM_RECENTE_HORAS = 24 * 7; // 7 dias sem nenhuma cópia de segurança
export const LIMIAR_SILENCIAR_ALERTA_DIAS = 7; // "dispensar" um alerta é temporário, nunca definitivo

const GABINETE_STOCK_KEY = "gabinete_stock_v1";

function diasEntre(depois, antes) {
  const ms = depois.getTime() - antes.getTime();
  if (Number.isNaN(ms)) return NaN;
  return Math.floor(ms / 86400000);
}

function alerta(id, modulo, tipo, severidade, titulo, descricao, dados) {
  return { id, modulo, tipo, severidade, titulo, descricao, dados: dados || {} };
}

function resumirAlertas(alertas) {
  const porModulo = {};
  let urgentes = 0, avisos = 0, infos = 0;
  alertas.forEach(a => {
    porModulo[a.modulo] = (porModulo[a.modulo] || 0) + 1;
    if (a.severidade === "urgente") urgentes++;
    else if (a.severidade === "aviso") avisos++;
    else infos++;
  });
  return { total: alertas.length, urgentes, avisos, infos, porModulo };
}

/* ======================================================================
   Pilar 1 — Alertas/insights proativos
   ====================================================================== */

/** PIM — embalagens (pim_stock_v1) perto da validade/expiradas ou sem stock
 *  para um utente ativo. Utentes arquivados são ignorados (já não são
 *  seguidos ativamente, ver categoria do utente). */
function alertasPimStock(pim, agora) {
  const stock = Array.isArray(pim.pim_stock_v1) ? pim.pim_stock_v1 : [];
  const utentesPorId = new Map((Array.isArray(pim.pim_utentes_v1) ? pim.pim_utentes_v1 : []).map(u => [u?.id, u]));
  const medsPorId = new Map((Array.isArray(pim.pim_medicamentos_v1) ? pim.pim_medicamentos_v1 : []).map(m => [m?.id, m]));
  const out = [];
  stock.forEach(item => {
    if (!item || (item.status !== "em_uso" && item.status !== "reserva")) return;
    const utente = utentesPorId.get(item.utenteId);
    if (utente && utente.categoria === "arquivado") return;
    const nomeUtente = utente?.nome || "utente desconhecido";
    const med = medsPorId.get(item.medicamentoId);
    const nomeMed = med?.nomeComercial || item.nomeComercialLab || "medicamento";
    if (item.validade) {
      const dias = diasEntre(new Date(item.validade), agora);
      if (!Number.isNaN(dias)) {
        if (dias < 0) {
          out.push(alerta(`pim-validade-expirada-${item.id}`, "pim", "validade_expirada", "urgente",
            `Embalagem de "${nomeMed}" (${nomeUtente}) já expirou`,
            `Validade ${item.validade}, há ${Math.abs(dias)} dia(s).`,
            { utenteId: item.utenteId, itemId: item.id }));
        } else if (dias <= LIMIAR_VALIDADE_AVISO_DIAS) {
          out.push(alerta(`pim-validade-perto-${item.id}`, "pim", "validade_perto", "aviso",
            `Embalagem de "${nomeMed}" (${nomeUtente}) perto da validade`,
            `Expira em ${dias} dia(s) (${item.validade}).`,
            { utenteId: item.utenteId, itemId: item.id }));
        }
      }
    }
    if ((item.quantidadeAtual ?? 0) <= 0) {
      out.push(alerta(`pim-semstock-${item.id}`, "pim", "sem_stock", "aviso",
        `Sem stock de "${nomeMed}" para ${nomeUtente}`,
        "A embalagem ativa está com quantidade 0.",
        { utenteId: item.utenteId, itemId: item.id }));
    }
  });
  return out;
}

/** PIM — plano semanal (rótulo) mais recente de cada utente, a terminar ou já
 *  terminado sem que exista ainda um mais novo. Só olha ao rótulo mais
 *  recente por utente (pim_rotulos_v1 é um histórico completo — alertar
 *  sobre TODOS os rótulos passados geraria ruído sem sentido). Utentes
 *  arquivados ou em pausa não geram este alerta. */
function alertasPimRotulos(pim, agora) {
  const rotulos = Array.isArray(pim.pim_rotulos_v1) ? pim.pim_rotulos_v1 : [];
  const utentesPorId = new Map((Array.isArray(pim.pim_utentes_v1) ? pim.pim_utentes_v1 : []).map(u => [u?.id, u]));
  const maisRecentePorUtente = new Map();
  rotulos.forEach(r => {
    if (!r || !r.utenteId || !r.dataFim) return;
    const atual = maisRecentePorUtente.get(r.utenteId);
    if (!atual || String(r.dataFim) > String(atual.dataFim)) maisRecentePorUtente.set(r.utenteId, r);
  });
  const out = [];
  maisRecentePorUtente.forEach((r, utenteId) => {
    const utente = utentesPorId.get(utenteId);
    if (utente && (utente.categoria === "arquivado" || utente.pausa?.ativa)) return;
    const dias = diasEntre(new Date(r.dataFim), agora);
    if (Number.isNaN(dias)) return;
    const nomeUtente = utente?.nome || "utente desconhecido";
    if (dias < 0) {
      out.push(alerta(`pim-rotulo-terminado-${utenteId}`, "pim", "rotulo_terminado", "urgente",
        `Plano semanal de ${nomeUtente} já terminou`,
        `O plano mais recente terminou há ${Math.abs(dias)} dia(s) (${r.dataFim}) e ainda não há um mais novo.`,
        { utenteId, rotuloId: r.id }));
    } else if (dias <= LIMIAR_ROTULO_PIM_AVISO_DIAS) {
      out.push(alerta(`pim-rotulo-a-terminar-${utenteId}`, "pim", "rotulo_a_terminar", "aviso",
        `Plano semanal de ${nomeUtente} termina em breve`,
        `Termina em ${dias} dia(s) (${r.dataFim}).`,
        { utenteId, rotuloId: r.id }));
    }
  });
  return out;
}

/** Gabinete — stock (gabinete_stock_v1) perto da validade/expirado ou abaixo
 *  da quantidade mínima definida. */
function alertasGabinete(gabinete, agora) {
  const stock = Array.isArray(gabinete[GABINETE_STOCK_KEY]) ? gabinete[GABINETE_STOCK_KEY] : [];
  const out = [];
  stock.forEach(item => {
    if (!item) return;
    const nome = item.nome || "Produto";
    if (item.validade) {
      const dias = diasEntre(new Date(item.validade), agora);
      if (!Number.isNaN(dias)) {
        if (dias < 0) {
          out.push(alerta(`gabinete-validade-expirada-${item.id}`, "gabinete", "validade_expirada", "urgente",
            `"${nome}" do Gabinete já expirou`, `Validade ${item.validade}, há ${Math.abs(dias)} dia(s).`, { itemId: item.id }));
        } else if (dias <= LIMIAR_VALIDADE_AVISO_DIAS) {
          out.push(alerta(`gabinete-validade-perto-${item.id}`, "gabinete", "validade_perto", "aviso",
            `"${nome}" do Gabinete perto da validade`, `Expira em ${dias} dia(s) (${item.validade}).`, { itemId: item.id }));
        }
      }
    }
    if (typeof item.quantidade === "number" && typeof item.quantidadeMinima === "number" &&
      item.quantidadeMinima > 0 && item.quantidade < item.quantidadeMinima) {
      out.push(alerta(`gabinete-abaixo-minimo-${item.id}`, "gabinete", "abaixo_minimo", "aviso",
        `"${nome}" do Gabinete abaixo do mínimo`,
        `Quantidade atual ${item.quantidade}, mínimo definido ${item.quantidadeMinima}.`, { itemId: item.id }));
    }
  });
  return out;
}

/** Stocks Errados — produtos marcados como "procurei e não encontrei"
 *  (motivo:'procurei') de forma recorrente, em várias contagens diferentes
 *  — pode indicar um problema de localização/etiquetagem em vez de um erro
 *  pontual de contagem. */
function alertasStocksErrados(stocksErrados) {
  const listas = stocksErrados && typeof stocksErrados === "object" ? Object.values(stocksErrados) : [];
  const porCodigo = new Map();
  listas.forEach(lista => {
    (lista?.items || []).forEach(item => {
      if (!item || item.motivo !== "procurei" || !item.codigo) return;
      const atual = porCodigo.get(item.codigo) || { designacao: item.designacao, listas: new Set() };
      atual.listas.add(lista.id);
      if (!atual.designacao) atual.designacao = item.designacao;
      porCodigo.set(item.codigo, atual);
    });
  });
  const out = [];
  porCodigo.forEach((info, codigo) => {
    if (info.listas.size >= LIMIAR_REPETICAO_STOCKS_LISTAS) {
      out.push(alerta(`stocks-recorrente-${codigo}`, "stocks", "produto_nao_localizado_recorrente", "aviso",
        `"${info.designacao || codigo}" não é encontrado repetidamente nas contagens`,
        `Marcado como "procurei e não encontrei" em ${info.listas.size} contagens diferentes — pode valer a pena rever a localização/etiquetagem deste produto.`,
        { codigo }));
    }
  });
  return out;
}

/** AUE — pedidos não terminais (nem entregues nem indeferidos) sem qualquer
 *  atualização há muitos dias. Usa `updatedAt` quando existe, senão `criado`. */
function alertasAue(aue, agora) {
  const pedidos = Array.isArray(aue?.pedidos) ? aue.pedidos : [];
  const TERMINAIS = new Set(["entregue", "indeferido"]);
  const out = [];
  pedidos.forEach(p => {
    if (!p || p.deleted || TERMINAIS.has(p.status)) return;
    const refRaw = p.updatedAt || p.criado;
    if (!refRaw) return;
    const ref = new Date(refRaw);
    const dias = diasEntre(agora, ref);
    if (Number.isNaN(dias)) return;
    if (dias >= LIMIAR_PEDIDO_PARADO_AUE_DIAS) {
      out.push(alerta(`aue-parado-${p.id}`, "aue", "pedido_parado", "aviso",
        `Pedido AUE parado há ${dias} dia(s)`,
        `Estado atual "${p.status}", sem atualização há ${dias} dia(s).`, { pedidoId: p.id }));
    }
  });
  return out;
}

/** Manipulados — pedidos ainda em curso (não entregues/cancelados) há muitos
 *  dias desde a criação. Sem campo `updatedAt` neste módulo — usa a data de
 *  criação como aproximação (documentado: pode não refletir a última
 *  mudança de estado real, só a idade do pedido). */
function alertasManipulados(manipulados, agora) {
  const pedidos = Array.isArray(manipulados) ? manipulados : [];
  const NAO_TERMINAIS = new Set(["pendente_utente", "pendente_farmacia", "preparacao"]);
  const out = [];
  pedidos.forEach(p => {
    if (!p || !NAO_TERMINAIS.has(p.status) || !p.criado) return;
    const dias = diasEntre(agora, new Date(p.criado));
    if (Number.isNaN(dias)) return;
    if (dias >= LIMIAR_PEDIDO_PARADO_MANIPULADOS_DIAS) {
      out.push(alerta(`manip-parado-${p.id}`, "manipulados", "pedido_parado", "aviso",
        `Pedido de manipulado de "${p.nome || "utente"}" parado há ${dias} dia(s)`,
        `Estado atual "${p.status}", criado há ${dias} dia(s) (${p.criado}).`, { pedidoId: p.id }));
    }
  });
  return out;
}

/** Manutenção (ponto 23) — sem nenhuma cópia de segurança recente. Reutiliza
 *  `precisaBackupAutomatico` de src/manutencao.js sobre o mesmo manifesto
 *  (`config.manutBackups`) que o painel de Auto-manutenção lê/escreve — é o
 *  único alerta da FARMA IA que atravessa para outro dos "3 módulos
 *  grandes". ID estável (não depende de nenhum registo específico), para o
 *  "dispensar" (silenciar 7 dias) funcionar de forma previsível.
 *
 *  Nota: uma conta nova/estado de teste sem NENHUMA chave `manutBackups`
 *  ainda (undefined, não `[]`) significa que a Central ainda não correu
 *  sequer uma vez para criar o backup automático inicial — isso não é um
 *  problema a alertar, é só um estado transitório dos primeiros segundos
 *  de uma conta nova. Só se avalia quando o manifesto já existe (mesmo que
 *  vazio), i.e. quando o sistema de backups já foi mesmo inicializado. */
function alertasBackup(config, agora) {
  if (!config || !Array.isArray(config.manutBackups)) return [];
  const manifesto = config.manutBackups;
  if (!precisaBackupAutomatico(manifesto, agora, LIMIAR_BACKUP_SEM_RECENTE_HORAS)) return [];
  const ultimo = manifesto.length ? manifesto[manifesto.length - 1] : null;
  const dias = Math.round(LIMIAR_BACKUP_SEM_RECENTE_HORAS / 24);
  return [alerta("manut-sem-backup-recente", "manutencao", "sem_backup_recente", "aviso",
    "Sem cópia de segurança recente",
    ultimo
      ? `A última cópia de segurança foi feita a ${String(ultimo.criadoEm).slice(0, 10)}, há mais de ${dias} dias.`
      : "Ainda não existe nenhuma cópia de segurança guardada.",
    {})];
}

const ORDEM_SEVERIDADE = { urgente: 0, aviso: 1, info: 2 };

/**
 * Corre todas as regras de alerta/insight sobre o estado partilhado de uma
 * farmácia e devolve `{ alertas, resumo, totalDispensados }`, ordenados por
 * gravidade (urgente → aviso → info). Nunca modifica o estado recebido.
 *
 * `memoria` (opcional, ver ponto 26 — `config.farmaIaMemoria`) permite
 * filtrar alertas temporariamente silenciados por quem gere a farmácia
 * (`dispensarAlerta`); os alertas continuam a ser calculados na mesma (para
 * `totalDispensados` refletir a realidade), só não entram na lista nem no
 * resumo.
 */
export function gerarAlertas(estado, agora = new Date(), memoria = null) {
  if (!estado || typeof estado !== "object") return { alertas: [], resumo: resumirAlertas([]), totalDispensados: 0 };
  const pim = estado.pim || {};
  const gabinete = estado.gabinete || {};
  const todos = [
    ...alertasPimStock(pim, agora),
    ...alertasPimRotulos(pim, agora),
    ...alertasGabinete(gabinete, agora),
    ...alertasStocksErrados(estado.stocksErrados),
    ...alertasAue(estado.aue || {}, agora),
    ...alertasManipulados(estado.manipulados, agora),
    ...alertasBackup(estado.config, agora)
  ];
  const alertas = todos.filter(a => !alertaEstaDispensado(memoria, a.id, agora));
  alertas.sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade]);
  return { alertas, resumo: resumirAlertas(alertas), totalDispensados: todos.length - alertas.length };
}

/* ======================================================================
   Pilar 2 — Assistente de perguntas e respostas (motor de regras)
   ====================================================================== */

function normalizarTexto(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}

function corresponde(texto, grupos) {
  return grupos.every(grupo => grupo.some(palavra => texto.includes(palavra)));
}

function respostaAlertasResumo(alertas) {
  if (!alertas.length) return "Não há nenhum alerta ativo neste momento — tudo em ordem.";
  const urgentes = alertas.filter(a => a.severidade === "urgente").length;
  const avisos = alertas.filter(a => a.severidade === "aviso").length;
  return `Há ${alertas.length} alerta(s) ativo(s): ${urgentes} urgente(s) e ${avisos} de aviso. Consulte a lista de Alertas & Insights para o detalhe.`;
}

function respostaValidade(alertas) {
  const relevantes = alertas.filter(a => a.tipo === "validade_perto" || a.tipo === "validade_expirada");
  if (!relevantes.length) return "Não há medicamentos ou produtos perto da validade ou expirados neste momento (PIM e Gabinete).";
  const expirados = relevantes.filter(a => a.tipo === "validade_expirada").length;
  const pertoDaValidade = relevantes.length - expirados;
  const porModulo = {};
  relevantes.forEach(a => { porModulo[a.modulo] = (porModulo[a.modulo] || 0) + 1; });
  const partes = Object.entries(porModulo).map(([m, n]) => `${n} em ${m === "pim" ? "PIM" : "Gabinete"}`).join(", ");
  return `Há ${relevantes.length} item(ns) com a validade a precisar de atenção (${expirados} já expirado(s), ${pertoDaValidade} perto da validade) — ${partes}.`;
}

function respostaUtentes(estado) {
  const utentes = Array.isArray(estado.pim?.pim_utentes_v1) ? estado.pim.pim_utentes_v1 : [];
  if (!utentes.length) return "Ainda não há nenhum utente registado no PIM.";
  const ativos = utentes.filter(u => u && u.categoria !== "arquivado").length;
  return `Tem ${ativos} utente(s) ativo(s) no PIM, de um total de ${utentes.length} registado(s) (incluindo arquivados).`;
}

function respostaPedidosAue(estado) {
  const pedidos = Array.isArray(estado.aue?.pedidos) ? estado.aue.pedidos.filter(p => p && !p.deleted) : [];
  if (!pedidos.length) return "Ainda não há nenhum pedido AUE registado.";
  const TERMINAIS = new Set(["entregue", "indeferido"]);
  const ativos = pedidos.filter(p => !TERMINAIS.has(p.status)).length;
  return `Tem ${ativos} pedido(s) AUE em curso (nem entregues nem indeferidos), de um total de ${pedidos.length} pedido(s) ativo(s) no sistema.`;
}

function respostaPedidosManipulados(estado) {
  const pedidos = Array.isArray(estado.manipulados) ? estado.manipulados : [];
  if (!pedidos.length) return "Ainda não há nenhum pedido de manipulado registado.";
  const NAO_TERMINAIS = new Set(["pendente_utente", "pendente_farmacia", "preparacao"]);
  const emCurso = pedidos.filter(p => p && NAO_TERMINAIS.has(p.status)).length;
  return `Tem ${emCurso} pedido(s) de manipulados em curso (pendentes ou em preparação), de um total de ${pedidos.length} pedido(s).`;
}

function respostaStocksErrados(estado) {
  const listas = estado.stocksErrados && typeof estado.stocksErrados === "object" ? Object.values(estado.stocksErrados) : [];
  if (!listas.length) return "Ainda não há nenhuma contagem de Stocks Errados registada.";
  const totalItens = listas.reduce((acc, l) => acc + ((l?.items)?.length || 0), 0);
  return `Há ${listas.length} contagem(ns) de Stocks Errados guardada(s), com um total de ${totalItens} divergência(s) registada(s).`;
}

function respostaServicos(estado) {
  const servicos = Array.isArray(estado.servicos) ? estado.servicos : [];
  const categorias = Array.isArray(estado.categorias) ? estado.categorias : [];
  return `Tem ${servicos.length} serviço(s) organizados em ${categorias.length} categoria(s).`;
}

function respostaPoupanca(estado, contexto) {
  if (!contexto?.diasUso) {
    return 'Ainda não tenho dados de uso carregados para calcular a poupança — consulte o painel "Poupança & ROI" em Configurações para o detalhe completo.';
  }
  const { segundosPoupados, totalOcorrencias } = calcularPoupanca(contexto.diasUso, contexto.overrides);
  if (!totalOcorrencias) return "Ainda não há uso suficiente registado para calcular a poupança de tempo.";
  return `Neste período já poupou aproximadamente ${fmtDuracao(segundosPoupados)}, resultantes de ${totalOcorrencias} tarefa(s) registada(s) na Central.`;
}

function respostaBackup(alertas) {
  const alertaBackup = alertas.find(a => a.tipo === "sem_backup_recente");
  if (!alertaBackup) return "As cópias de segurança automáticas estão em dia — não há nenhum alerta de backup em atraso.";
  return alertaBackup.descricao + " Pode rever isto no módulo de Auto-manutenção.";
}

function respostaOportunidades(contexto) {
  if (!contexto?.diasUso) return 'Ainda não tenho dados de uso suficientes para sugerir oportunidades de automação — vá usando a Central normalmente e volte a perguntar dentro de alguns dias.';
  const oportunidades = detectarOportunidadesAutomacao(contexto.diasUso, contexto.overrides ? { overrides: contexto.overrides } : {});
  if (!oportunidades.length) return "Não há, neste momento, nenhuma tarefa repetida o suficiente para sugerir uma automação dedicada.";
  const top = oportunidades[0];
  return `Há ${oportunidades.length} oportunidade(s) de automação identificada(s). A mais frequente é "${top.nome}", repetida ${top.totalOcorrencias}× no período — consulte a aba "Oportunidades" para o detalhe completo.`;
}

function respostaAjuda() {
  return "Sou a FARMA IA: respondo a perguntas sobre o estado da farmácia (validades, utentes, pedidos AUE, manipulados, stocks errados, poupança de tempo, cópias de segurança) e mostro alertas e oportunidades de automação. " + PERGUNTA_EXEMPLO;
}

const PERGUNTA_EXEMPLO = 'Pode perguntar, por exemplo: "quantos utentes tenho no PIM?", "há medicamentos perto da validade?", ' +
  '"quantos pedidos AUE estão pendentes?", "quantas divergências de stock tenho?", "quantos alertas tenho?", ' +
  '"as cópias de segurança estão em dia?" ou "quanto tempo já poupei?".';

/* `grupos`: cada pergunta só reconhece o intent se, para CADA grupo, pelo
   menos uma palavra do grupo aparecer no texto (AND entre grupos, OR dentro
   de cada grupo). A maioria dos intents abaixo usa só 1 grupo (OR simples) —
   é a forma mais tolerante e evita falsos negativos em frases curtas.
   `INTENT_EXEMPLOS` alimenta as sugestões de "talvez quisesse dizer" quando
   a pergunta não é reconhecida (ver sugerirIntentsSemelhantes, ponto 26). */
const INTENT_EXEMPLOS = {
  alertas_resumo: "Quantos alertas tenho?",
  validade: "Há medicamentos perto da validade?",
  utentes: "Quantos utentes tenho no PIM?",
  pedidos_aue: "Quantos pedidos AUE estão pendentes?",
  pedidos_manipulados: "Quantos pedidos de manipulados estão em curso?",
  stocks_errados: "Quantas divergências de stock tenho?",
  servicos: "Quantos serviços tenho organizados?",
  poupanca: "Quanto tempo já poupei?",
  backup: "As cópias de segurança estão em dia?",
  oportunidades: "Há alguma oportunidade de automação?",
  ajuda: "O que sabes fazer?"
};

const INTENTS = [
  { id: "alertas_resumo", grupos: [["alerta", "alertas", "aviso", "avisos", "problema", "problemas", "insight", "insights", "atencao"]], responder: (estado, contexto, alertas) => respostaAlertasResumo(alertas) },
  { id: "validade", grupos: [["validade", "validades", "expira", "expirad", "vence", "vencid", "prazo", "prazos", "fora do prazo", "a vencer"]], responder: (estado, contexto, alertas) => respostaValidade(alertas) },
  { id: "utentes", grupos: [["utente", "utentes", "cliente", "clientes", "doente", "doentes"]], responder: (estado) => respostaUtentes(estado) },
  { id: "pedidos_aue", grupos: [["aue", "autorizacao de utilizacao excecional", "excecional"]], responder: (estado) => respostaPedidosAue(estado) },
  { id: "pedidos_manipulados", grupos: [["manipulado", "manipulados", "manipulacao", "formula magistral", "preparacao"]], responder: (estado) => respostaPedidosManipulados(estado) },
  { id: "stocks_errados", grupos: [["stock", "stocks", "estoque", "estoques", "divergencia", "divergencias", "contagem", "contagens", "inventario"]], responder: (estado) => respostaStocksErrados(estado) },
  { id: "servicos", grupos: [["servico", "servicos", "catalogo"]], responder: (estado) => respostaServicos(estado) },
  { id: "poupanca", grupos: [["poupanca", "poupei", "poupou", "economizei", "economizado", "tempo ganho", "roi", "retorno"]], responder: (estado, contexto) => respostaPoupanca(estado, contexto) },
  { id: "backup", grupos: [["backup", "backups", "copia de seguranca", "copias de seguranca", "salvaguarda"]], responder: (estado, contexto, alertas) => respostaBackup(alertas) },
  { id: "oportunidades", grupos: [["oportunidade", "oportunidades", "automacao", "automatizar", "atalho", "atalhos"]], responder: (estado, contexto) => respostaOportunidades(contexto) },
  { id: "ajuda", grupos: [["ajuda", "ajudar", "como funciona", "o que fazes", "o que sabes", "quem es"]], responder: () => respostaAjuda() }
];

/** Limiares da rede neuronal (ponto 42, fase 2) — calibrados empiricamente
 * contra um conjunto de validação nunca visto no treino (ver
 * `scripts/treinar-rede-farma.mjs` e o registo em arquitetura-decisoes.md,
 * ponto 42): com estes dois valores, ZERO respostas erradas em 39 perguntas
 * de teste (22 aceites e corretas, 17 corretamente recusadas por falta de
 * confiança). Confiança alta sozinha não basta — uma rede pequena pode
 * estar confiante e errada — por isso também se exige uma margem clara
 * sobre a 2ª hipótese, nunca só a 1ª sozinha. */
const CONFIANCA_MINIMA_REDE = 0.85;
const MARGEM_MINIMA_REDE = 0.30;
/** Peso do sinal da rede neuronal nas sugestões "talvez quisesse dizer"
 * (fase 3) — um ponto inteiro na pontuação de palavras-chave corresponde a
 * UMA palavra da lista ter batido; este peso deixa uma previsão confiante
 * da rede (confiança perto de 1) pesar como pouco mais do que isso, sem
 * nunca dominar por completo um sinal genuinamente forte de palavras-chave. */
const PESO_REDE_NA_SUGESTAO = 1.5;

/**
 * Tenta reconhecer a pergunta pela rede neuronal (ponto 42, fase 2) quando
 * o motor de regras/aliases não reconheceu nada. Só aceita quando MUITO
 * confiante (ver `CONFIANCA_MINIMA_REDE`/`MARGEM_MINIMA_REDE`) — fora disso
 * devolve `null` sempre, nunca adivinha: quem chama cai para o fallback de
 * sempre ("não percebi" + sugestões). `pesosRede` é opcional — sem ele
 * (farmácia que ainda não carregou os pesos, ou chamada de teste que não os
 * passa), esta função é uma no-op e o comportamento fica IGUAL ao de antes
 * desta peça.
 */
export function tentarViaRedeNeural(texto, pesosRede) {
  if (!pesosRede || !texto) return null;
  const { previsoes } = preverIntent(texto, pesosRede);
  const [top1, top2] = previsoes;
  if (!top1) return null;
  if (top1.confianca < CONFIANCA_MINIMA_REDE) return null;
  if (top1.confianca - (top2?.confianca || 0) < MARGEM_MINIMA_REDE) return null;
  return { intentId: top1.intentId, confianca: top1.confianca };
}

/** Distância de edição (Levenshtein) simples, usada só para sugestões
 *  "talvez quisesse dizer" — nunca para decidir a resposta em si. */
function distanciaEdicao(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
    }
  }
  return d[m][n];
}

function palavraProxima(palavraTexto, palavraChave) {
  if (!palavraTexto || !palavraChave) return false;
  if (palavraTexto === palavraChave) return true;
  // palavras muito curtas (preposições/artigos como "de", "a", "e") geram
  // falsos positivos por 'includes' (ex.: "de" está dentro de "validade") —
  // só comparadas por igualdade exata, nunca por substring/edição.
  if (palavraTexto.length < 3 || palavraChave.length < 3) return false;
  if (palavraTexto.includes(palavraChave) || palavraChave.includes(palavraTexto)) return true;
  if (Math.min(palavraTexto.length, palavraChave.length) < 4) return false;
  return distanciaEdicao(palavraTexto, palavraChave) <= 2;
}

/**
 * Quando nenhum intent reconhece a pergunta, sugere os intents mais
 * "próximos" por semelhança de palavras (inclui erros de escrita/pequenas
 * variações, via distância de edição — nunca inventa significado). Devolve
 * até `limite` sugestões `{ intentId, exemplo }`, da mais para a menos
 * plausível. Usado pela UI para o "talvez quisesse dizer: ..." — quando o
 * utilizador confirma uma, `ensinarAlias` grava-a para a próxima vez.
 *
 * `pesosRede` (opcional, ponto 42 fase 3) — quando presente, a confiança da
 * rede neuronal por intent soma-se à pontuação por palavras-chave em vez de
 * a substituir: reforça sugestões que já tinham algum sinal, e sobretudo
 * passa a sugerir intents que a distância de edição sozinha não via NADA
 * (pontuação 0), quando a pergunta é uma paráfrase genuína sem nenhuma
 * palavra-chave nem variação próxima de uma (ex.: "o que precisa da minha
 * atenção" para alertas_resumo). Sem `pesosRede`, o comportamento fica
 * IGUAL ao de antes desta peça.
 */
export function sugerirIntentsSemelhantes(pergunta, limite = 3, pesosRede = null) {
  const texto = normalizarTexto(pergunta);
  if (!texto) return [];
  const palavrasTexto = texto.split(/\s+/).filter(Boolean);
  const pontuados = INTENTS.map(intent => {
    const chaves = intent.grupos.flat();
    let pontuacao = 0;
    chaves.forEach(chave => { if (palavrasTexto.some(pt => palavraProxima(pt, chave))) pontuacao++; });
    return { intentId: intent.id, pontuacao };
  });
  if (pesosRede) {
    const { previsoes } = preverIntent(texto, pesosRede);
    const confiancaPorIntent = Object.fromEntries(previsoes.map(p => [p.intentId, p.confianca]));
    pontuados.forEach(p => { p.pontuacao += (confiancaPorIntent[p.intentId] || 0) * PESO_REDE_NA_SUGESTAO; });
  }
  const comSinal = pontuados.filter(p => p.pontuacao > 0);
  comSinal.sort((a, b) => b.pontuacao - a.pontuacao);
  return comSinal.slice(0, limite).map(p => ({ intentId: p.intentId, exemplo: INTENT_EXEMPLOS[p.intentId] || "" }));
}

/**
 * Agrupa perguntas não reconhecidas quase-duplicadas para a UI de revisão
 * (ponto 42, fase 3) — puramente de apresentação: NÃO altera a memória
 * gravada, `perguntasNaoReconhecidas` continua exatamente como
 * `registarPerguntaNaoReconhecida` sempre gravou (uma entrada por texto
 * normalizado distinto, sem nenhum embedding persistido). Usa o embedding
 * da rede neuronal, calculado aqui na hora e nunca gravado, só para juntar
 * entradas MUITO parecidas na lista que se mostra a quem gere a farmácia —
 * sem isto, "quantos pedidos aue tenho" e "quantos pedidos de aue eu tenho"
 * apareciam como duas linhas separadas, cada uma com poucas ocorrências,
 * quando é claramente a mesma pergunta feita de duas formas. Devolve uma
 * lista ordenada por ocorrências totais, cada entrada com `variantes`
 * (todas as formulações agrupadas nessa entrada). Sem `pesosRede`, devolve
 * a lista tal como veio, cada uma na sua própria entrada.
 */
export function agruparPerguntasSemelhantes(perguntasNaoReconhecidas, pesosRede, limiarSimilaridade = 0.92) {
  const lista = Array.isArray(perguntasNaoReconhecidas) ? perguntasNaoReconhecidas : [];
  if (!pesosRede || lista.length < 2) {
    return lista.map(p => ({ pergunta: p.pergunta, texto: p.texto, ocorrencias: p.ocorrencias, ultimaVez: p.ultimaVez, variantes: [p.pergunta] }));
  }
  const comEmbedding = lista.map(p => ({ ...p, embedding: preverIntent(p.texto, pesosRede).embedding }));
  const grupos = [];
  for (const item of comEmbedding) {
    const grupo = grupos.find(g => similaridadeCosseno(g.embedding, item.embedding) >= limiarSimilaridade);
    if (grupo) {
      grupo.ocorrencias += item.ocorrencias;
      grupo.variantes.push(item.pergunta);
      if (new Date(item.ultimaVez).getTime() > new Date(grupo.ultimaVez).getTime()) grupo.ultimaVez = item.ultimaVez;
    } else {
      grupos.push({ pergunta: item.pergunta, texto: item.texto, ocorrencias: item.ocorrencias, ultimaVez: item.ultimaVez, embedding: item.embedding, variantes: [item.pergunta] });
    }
  }
  return grupos
    .sort((a, b) => b.ocorrencias - a.ocorrencias)
    .map(({ embedding, ...resto }) => resto);
}

/**
 * Responde a uma pergunta em português (texto livre) sobre o estado da
 * farmácia, por reconhecimento de intenção baseado em regras/palavras-chave
 * — sem nenhuma API externa de IA. `contexto.diasUso` (opcional, mesma forma
 * de `carregarUsoPeriodo()`) permite responder a perguntas sobre poupança de
 * tempo; sem ele, essas perguntas respondem com uma explicação em vez de um
 * número inventado. `contexto.memoria` (opcional, ver ponto 26) é
 * consultada PRIMEIRO — se a pergunta (normalizada) já tiver um alias
 * ensinado, responde-se de imediato por essa via, sem correr o motor de
 * regras. `contexto.pesosRede` (opcional, ponto 42 fase 2) — os pesos da
 * rede neuronal treinada (ver `src/farmaRede.js`); quando presente, é
 * tentada DEPOIS do motor de regras/aliases (nunca antes — a correspondência
 * exata por palavras-chave continua a ter sempre prioridade) e só aceite
 * quando muito confiante (`tentarViaRedeNeural`). `contexto.baseConhecimento`
 * (opcional, ponto 43, "aprender por leitura") — excertos de documentos
 * carregados pelo operador (`src/farmaLeitura.js`); tentada por ÚLTIMO,
 * depois da rede, e só quando há um excerto claramente parecido com a
 * pergunta — a resposta cita o excerto tal como está no documento (nunca o
 * reformula), com o nome do ficheiro de origem, para o operador poder
 * sempre confirmar a fonte. Devolve
 * `{ resposta, intentId, viaAprendizagem, viaRedeNeural, viaConhecimento,
 * documentoFonte, sugestoes }` — `intentId: null` quando nada reconheceu a
 * pergunta (mesmo uma resposta via conhecimento tem `intentId: null`, já
 * que não corresponde a nenhuma das 11 intenções conhecidas), e nesse caso
 * `sugestoes` traz até 3 intents semelhantes para a UI oferecer (nunca
 * lança exceção).
 */
export function responderPergunta(pergunta, estado, contexto = {}) {
  const texto = normalizarTexto(pergunta);
  estado = estado || {};
  if (!texto) return { resposta: `Escreva uma pergunta. ${PERGUNTA_EXEMPLO}`, intentId: null };
  const agora = contexto.agora || new Date();
  const { alertas } = gerarAlertas(estado, agora, contexto.memoria);
  const aliasIntentId = contexto.memoria?.aliases?.[texto];
  const intentPorAlias = aliasIntentId ? INTENTS.find(i => i.id === aliasIntentId) : null;
  const intent = intentPorAlias || INTENTS.find(i => corresponde(texto, i.grupos));
  if (intent) return { resposta: intent.responder(estado, contexto, alertas), intentId: intent.id, viaAprendizagem: !!intentPorAlias };

  const previsaoRede = tentarViaRedeNeural(texto, contexto.pesosRede);
  if (previsaoRede) {
    const intentRede = INTENTS.find(i => i.id === previsaoRede.intentId);
    if (intentRede) return { resposta: intentRede.responder(estado, contexto, alertas), intentId: intentRede.id, viaRedeNeural: true };
  }

  if (contexto.baseConhecimento) {
    const [encontrado] = pesquisarConhecimento(pergunta, contexto.baseConhecimento, 1);
    if (encontrado) {
      return {
        resposta: `Encontrei isto no documento "${encontrado.ficheiro}": "${encontrado.texto}"`,
        intentId: null, viaConhecimento: true, documentoFonte: encontrado.ficheiro,
      };
    }
  }

  return { resposta: `Não percebi a pergunta. ${PERGUNTA_EXEMPLO}`, intentId: null, sugestoes: sugerirIntentsSemelhantes(pergunta, 3, contexto.pesosRede) };
}

/* ======================================================================
   Pilar 3 — Deteção de oportunidades de automação/atalho
   ====================================================================== */

/**
 * A partir dos registos diários de uso (mesma forma de
 * `carregarUsoPeriodo()`: `{dia: {"modulo.tarefaId": contagem}}`), devolve as
 * tarefas repetidas com mais frequência no período — candidatas a ganhar um
 * atalho/automação dedicada. Ver nota de âmbito no topo do ficheiro: isto é
 * deteção por VOLUME de uma tarefa isolada, não por sequência de ações (os
 * dados de uso não guardam ordem/timestamp dentro do dia).
 */
export function detectarOportunidadesAutomacao(diasUso, opts = {}) {
  const limiar = opts.limiarOcorrencias || LIMIAR_OPORTUNIDADE_OCORRENCIAS;
  const dias = diasUso || {};
  const numDias = opts.numDias || Math.max(1, Object.keys(dias).length);
  const porTarefa = agregarPorTarefa(dias, opts.overrides);
  return porTarefa
    .filter(t => t.totalOcorrencias >= limiar)
    .sort((a, b) => b.totalOcorrencias - a.totalOcorrencias)
    .map(t => ({
      chave: t.chave, modulo: t.modulo, tarefaId: t.tarefaId, nome: t.nome,
      totalOcorrencias: t.totalOcorrencias,
      mediaDiaria: Math.round((t.totalOcorrencias / numDias) * 10) / 10,
      segundosPoupadosJa: t.segundosPoupados,
      sugestao: t.totalOcorrencias >= limiar * 3
        ? `Tarefa muito repetida (${t.totalOcorrencias}× no período) — forte candidata a um atalho ou automação dedicada.`
        : `Tarefa repetida com frequência (${t.totalOcorrencias}× no período) — pode valer a pena criar um atalho.`
    }));
}

/* ======================================================================
   Memória & Aprendizagem (ponto 26)

   Tudo aqui é sobre um único objeto persistido, `config.farmaIaMemoria`
   (gravado/lido pela UI via dataStore.getConfig/setConfig, o mesmo padrão
   de `cidade`/`idioma`):

     {
       perguntasNaoReconhecidas: [{ pergunta, texto, ocorrencias, ultimaVez }],
       aliases: { [textoNormalizado]: intentId },
       alertasDispensados: { [alertaId]: { desde, ate } }
     }

   Como em todo o ficheiro, são só funções puras — recebem a memória actual
   e devolvem uma NOVA memória (nunca mutam a recebida). A camada de
   rede/UI (modulos/farma-ia.html) é responsável por carregar/gravar isto.
   ====================================================================== */

const LIMITE_PERGUNTAS_NAO_RECONHECIDAS = 30;

/** Memória vazia — usar como valor inicial antes da primeira gravação. */
export function criarMemoriaVazia() {
  return { perguntasNaoReconhecidas: [], aliases: {}, alertasDispensados: {} };
}

function normalizarMemoria(memoria) {
  return memoria && typeof memoria === "object" ? memoria : criarMemoriaVazia();
}

/**
 * Regista que `pergunta` não foi reconhecida por nenhum intent. Perguntas
 * repetidas (mesmo texto normalizado) não duplicam entradas — só atualizam
 * `ocorrencias`/`ultimaVez`, para o histórico mostrar o que é mais pedido
 * primeiro. Lista limitada às últimas `LIMITE_PERGUNTAS_NAO_RECONHECIDAS`
 * perguntas distintas, para a memória nunca crescer sem limite.
 */
export function registarPerguntaNaoReconhecida(memoria, pergunta, agora = new Date()) {
  const m = normalizarMemoria(memoria);
  const texto = normalizarTexto(pergunta);
  if (!texto) return m;
  const existentes = Array.isArray(m.perguntasNaoReconhecidas) ? m.perguntasNaoReconhecidas : [];
  const anterior = existentes.find(p => p.texto === texto);
  const registo = {
    pergunta: String(pergunta).trim(),
    texto,
    ocorrencias: (anterior?.ocorrencias || 0) + 1,
    ultimaVez: agora.toISOString()
  };
  const nova = [...existentes.filter(p => p.texto !== texto), registo].slice(-LIMITE_PERGUNTAS_NAO_RECONHECIDAS);
  return { ...m, perguntasNaoReconhecidas: nova };
}

/**
 * Ensina um alias literal: da próxima vez que a mesma `pergunta`
 * (normalizada) for feita, `responderPergunta` responde de imediato com o
 * intent `intentId`, sem precisar de a reconhecer pelas regras. Chamado
 * quando o utilizador confirma uma sugestão de "talvez quisesse dizer" na
 * UI. Remove a pergunta da lista de não-reconhecidas, já que passou a ter
 * resposta. `intentId` tem de corresponder a um intent real — caso
 * contrário a memória não é alterada (nunca aprende um destino inválido).
 */
export function ensinarAlias(memoria, pergunta, intentId) {
  const m = normalizarMemoria(memoria);
  const texto = normalizarTexto(pergunta);
  if (!texto || !INTENTS.some(i => i.id === intentId)) return m;
  const aliases = { ...(m.aliases || {}), [texto]: intentId };
  const perguntasNaoReconhecidas = (Array.isArray(m.perguntasNaoReconhecidas) ? m.perguntasNaoReconhecidas : [])
    .filter(p => p.texto !== texto);
  return { ...m, aliases, perguntasNaoReconhecidas };
}

/**
 * Silencia um alerta (por `id`) durante `dias` (por omissão
 * `LIMIAR_SILENCIAR_ALERTA_DIAS`, 7 dias) — nunca para sempre: um alerta
 * "dispensado" continua a ser recalculado a cada visita, só não é mostrado
 * enquanto o silêncio estiver a decorrer. Se a condição de origem persistir
 * depois do prazo (ex.: a validade continua expirada), o alerta volta a
 * aparecer sozinho — isto é deliberado, para nunca esconder de vez um
 * problema real.
 */
export function dispensarAlerta(memoria, alertaId, agora = new Date(), dias = LIMIAR_SILENCIAR_ALERTA_DIAS) {
  const m = normalizarMemoria(memoria);
  if (!alertaId) return m;
  const ate = new Date(agora.getTime() + dias * 86400000).toISOString();
  const alertasDispensados = { ...(m.alertasDispensados || {}), [alertaId]: { desde: agora.toISOString(), ate } };
  return { ...m, alertasDispensados };
}

/** Reativa um alerta previamente dispensado antes do prazo — ex.: botão
 *  "voltar a mostrar" na UI. Sem efeito se o alerta não estava dispensado. */
export function reativarAlerta(memoria, alertaId) {
  const m = normalizarMemoria(memoria);
  if (!alertaId || !m.alertasDispensados || !(alertaId in m.alertasDispensados)) return m;
  const alertasDispensados = { ...m.alertasDispensados };
  delete alertasDispensados[alertaId];
  return { ...m, alertasDispensados };
}

/** true enquanto o silêncio de `alertaId` ainda estiver a decorrer. Aceita
 *  `memoria` nula/indefinida (farmácias que ainda não gravaram memória
 *  nenhuma) — devolve sempre false nesse caso. */
export function alertaEstaDispensado(memoria, alertaId, agora = new Date()) {
  const registo = memoria && memoria.alertasDispensados ? memoria.alertasDispensados[alertaId] : null;
  if (!registo || !registo.ate) return false;
  return new Date(registo.ate).getTime() > agora.getTime();
}
