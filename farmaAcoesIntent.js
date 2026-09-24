/**
 * src/farmaAcoesIntent.js — ponto 46: reconhecimento de AÇÕES sem depender de
 * IA nenhuma (nem local, nem externa). Pedido explícito do Ivo: "liga
 * directamente o motor de ações da farma" — depois de confirmado (ver
 * arquitetura-decisoes.md, ponto 46) que o catálogo de ações em
 * `src/farmaAcoes.js` já funciona bem e está testado, mas só era alcançável
 * de duas formas, as duas com um problema real:
 *   1. `modulos/farma-ia.html`, e só depois de a farmácia clicar em "Ativar
 *      compreensão livre" (download de IA local, várias centenas de MB,
 *      desligado por omissão) — sem isso, um pedido de ação caía
 *      silenciosamente no motor de perguntas, que respondia "não percebi"
 *      sem nunca dizer que era preciso ativar aquele botão.
 *   2. O mini-chat (`src/ui/farmaMiniChat.js`), o ponto de entrada mais
 *      visível da FARMA (bolha sempre no ecrã), nunca sequer importava nada
 *      de `farmaAcoes.js` — um pedido de ação ali era estruturalmente
 *      impossível de cumprir, dependesse do que dependesse.
 *
 * Esta peça resolve os dois problemas com UM mecanismo novo: reconhecimento
 * de ações por padrões (palavras-chave + extração de parâmetros por
 * proximidade), o mesmo género de técnica já usada com sucesso no motor de
 * perguntas e respostas (`corresponde()`, farmaIa.js) — sem modelo nenhum,
 * sem download, disponível sempre, em qualquer sítio da app. Cobre as
 * mesmas 20 ações de `ACOES_DISPONIVEIS` (farmaAcoes.js) — nunca inventa uma
 * ação nova, só reconhece pedidos escritos de formas correntes.
 *
 * Nunca é a única linha de defesa: tudo o que esta peça propõe continua a
 * passar por `prepararAcao()` (validação contra os dados reais) e pelo
 * cartão "Confirmar/Cancelar" antes de executar — exatamente as mesmas
 * garantias que já existiam para o caminho da IA local. Um reconhecimento
 * errado, na pior das hipóteses, mostra um resumo estranho que o operador
 * cancela — nunca executa nada sozinho.
 *
 * Desenho deliberadamente conservador quanto a PARÂMETROS OBRIGATÓRIOS em
 * falta: em vez de adivinhar, devolve `tipo: "incompleta"` com uma pergunta
 * de esclarecimento — o mesmo espírito de honestidade do resto da FARMA
 * (nunca inventar um telefone, NIF, ou nome que não foi dito). Só os
 * parâmetros OPCIONAIS ficam de fora quando não encontrados (o catálogo já
 * trata opcionais como "" — nunca bloqueiam a ação).
 */
import { ACOES_DISPONIVEIS } from "./farmaAcoes.js";
import { STATUS_MANIPULADOS } from "./manipuladosCore.js";

/** Mesma normalização usada em `farmaRede.js`/`farmaIa.js` (minúsculas, sem
 * acentos) — duplicada aqui de propósito, é uma função pura de 3 linhas e
 * evita mais um import cruzado entre peças pequenas. */
function normalizar(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function algumaPalavra(norm, palavras) {
  return palavras.some((p) => norm.includes(p));
}

/** Palavras/expressões que marcam o FIM do trecho a capturar a seguir a uma
 * palavra-âncora (ex.: depois de "para o utente", captura até à próxima
 * destas). Cobre pontuação, ligações comuns ("como", "e o/a") e o início de
 * outro campo mencionado a seguir na mesma frase — sem isto, "para a Maria,
 * nif 123456789" capturava o NIF inteiro dentro do nome, e "marca X como
 * entregue" capturava "como entregue" dentro do nome. Inclui também as
 * próprias palavras de domínio ("do gabinete", "da farmácia", "do
 * catálogo", …), que costumam fechar a frase depois do que se quer captar
 * ("remove o item X DO GABINETE"). */
const PALAVRAS_PARAGEM = [
  ",", ";", " - ", " nif ", " nif:", " telefone", " tlm", " tlf", " contacto", " receita",
  " medico", " médico", " armazenista", " codigo", " codigo:", " código", " cnp",
  " quantidade", " validade", " lote", " morada", " data ", " hora ", " horario", " horário",
  " observ", " nota", " notas", " medicamento", " produto", " animal", " comercial",
  " dosagem", " posologia", " responsavel", " responsável", " e o ", " e a ", " tipo ",
  " como ", " do gabinete", " da farmacia", " do catalogo", " da lista", " na lista",
  " do armazenista", " da armazenista", " do manipulado", " da manipulad", " do aue", " da aue",
];

/** Escapa caracteres especiais de regex — usado para transformar uma âncora
 * em texto literal dentro de uma expressão regular. */
function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Encontra a 1ª ocorrência de qualquer uma de `ancoras` em `texto`, exigindo
 * uma FRONTEIRA DE PALAVRA antes da âncora — sem isto, uma âncora como
 * "a lista" também "encontrava" o "a" final de "umA lista" (substring cego,
 * sem respeitar onde as palavras começam), roubando as duas primeiras
 * letras erradas. Devolve o trecho a seguir à âncora, cortado na próxima
 * palavra de paragem (ou fim da frase). Devolve "" se nenhuma âncora
 * aparecer isolada como palavra. */
function capturarApos(texto, ancoras) {
  const normTexto = normalizar(texto);
  let melhorIdx = -1, melhorFim = 0;
  for (const ancora of ancoras) {
    const re = new RegExp("(?:^|[^a-z0-9])(" + escaparRegex(normalizar(ancora)) + ")", "i");
    const m = normTexto.match(re);
    if (m) {
      const idx = m.index + m[0].length - m[1].length;
      if (melhorIdx === -1 || idx < melhorIdx) { melhorIdx = idx; melhorFim = idx + ancora.length; }
    }
  }
  if (melhorIdx === -1) return "";
  let fimCorte = texto.length;
  const restoNorm = normTexto.slice(melhorFim);
  for (const parada of PALAVRAS_PARAGEM) {
    const idxParada = restoNorm.indexOf(parada);
    if (idxParada !== -1 && melhorFim + idxParada < fimCorte) fimCorte = melhorFim + idxParada;
  }
  return texto.slice(melhorFim, fimCorte).trim()
    // limpa pontuação/cópula inicial que sobra quando a âncora corresponde a
    // "o campo" em vez de "o campo é"/"o campo:" (ex.: "o medicamento é X" ->
    // âncora "o medicamento" -> sobra " é X"; sem isto, "é" ficava colado ao
    // valor capturado).
    .replace(/^[:\-–]\s*/, "").replace(/^(e|é)\s+/i, "").replace(/[.!?]+$/, "").trim();
}

/** Texto entre aspas (retas ou curvas) — quando presente, é normalmente o
 * sinal mais fiável de "isto é o nome/produto exato", por isso é tentado
 * primeiro pela maioria dos extratores abaixo. Devolve todas as ocorrências,
 * pela ordem em que aparecem (1ª, 2ª, …). */
function capturarEntreAspas(texto) {
  const m = texto.match(/["“]([^"”]+)["”]|'([^']+)'/g) || [];
  return m.map((t) => t.replace(/^["“'"]|["”']$/g, "").trim()).filter(Boolean);
}

function extrairNumero(texto, ancoras) {
  for (const ancora of ancoras) {
    const re = new RegExp(normalizar(ancora) + "\\s*[:\\-]?\\s*(\\d+(?:[.,]\\d+)?)", "i");
    const m = normalizar(texto).match(re);
    if (m) return m[1].replace(",", ".");
  }
  return "";
}

/** Telefone PT — 9 dígitos seguidos, com ou sem espaços a separar grupos de
 * 3 (ex.: "912 345 678" ou "912345678"). Nunca exigido (é sempre um
 * parâmetro opcional no catálogo), por isso não há problema em devolver "". */
function extrairTelefone(texto) {
  const m = texto.match(/\b(9\d{2}|2\d{2})[\s.-]?\d{3}[\s.-]?\d{3}\b/);
  return m ? m[0].replace(/[\s.-]/g, "") : "";
}

/** NIF — só reconhecido quando precedido da palavra "nif" (9 dígitos
 * sozinhos, sem essa âncora, seriam facilmente confundidos com um telefone
 * ou um número de receita — mais vale não preencher do que arriscar trocar
 * os dois). Também sempre opcional no catálogo. */
function extrairNif(texto) {
  const m = normalizar(texto).match(/\bnif\s*[:\-]?\s*(\d{9})\b/);
  return m ? m[1] : "";
}

function extrairData(texto) {
  let m = texto.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = texto.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  return "";
}

function extrairHora(texto) {
  const m = texto.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/i);
  return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : "";
}

const MAPA_ESTADO_MANIPULADO = [
  [["entreguei", "entregue", "foi levantado", "ja foi levantado", "levantou"], "entregue"],
  [["cancela", "cancelado", "cancelar"], "cancelado"],
  [["pronto a levantar", "pronto para levantamento", "ja esta pronto", "está pronto"], "pronto"],
  [["em preparacao", "a preparar", "em preparação"], "preparacao"],
  [["aguarda a farmacia", "aguarda farmacia", "pendente farmacia", "aguarda a farmácia"], "pendente_farmacia"],
  [["aguarda o utente", "aguarda utente", "pendente utente"], "pendente_utente"],
];
function mapearNovoEstadoManipulado(norm) {
  for (const [chaves, estado] of MAPA_ESTADO_MANIPULADO) {
    if (algumaPalavra(norm, chaves)) return estado;
  }
  // fallback: aceita a própria palavra-chave do catálogo, tal como escrita (ex. "muda para preparacao")
  for (const chave of Object.keys(STATUS_MANIPULADOS)) {
    if (norm.includes(chave.replace(/_/g, " "))) return chave;
  }
  return "";
}

const AUE_ARMAZENISTAS = ["Alliance Healthcare", "Empifarma", "OCP", "Plural"];
function mapearArmazenista(norm) {
  if (norm.includes("alliance")) return "Alliance Healthcare";
  if (norm.includes("empifarma")) return "Empifarma";
  if (/\bocp\b/.test(norm)) return "OCP";
  if (norm.includes("plural")) return "Plural";
  return "";
}

function mapearTipoEtiqueta(norm) {
  if (algumaPalavra(norm, ["domicilio", "entrega ao domicilio", "entregar em casa"])) return "domicilio";
  if (norm.includes("tester")) return "tester";
  if (algumaPalavra(norm, ["medicamento", "dosagem", "posologia"])) return "medicamento";
  return "";
}

function mapearTipoLista(norm) {
  if (norm.includes("minifaciais")) return "minifaciais";
  if (algumaPalavra(norm, ["formacao", "formação"])) return "formacao";
  if (norm.includes("outro")) return "outro";
  return "";
}

/** Extrai um "nome de pessoa" — tenta, por ordem: texto entre aspas, depois
 * âncoras explícitas ("para o utente X", "chamado X", "do animal X", …).
 * `aspasIndice` permite escolher a 2ª/3ª ocorrência de aspas quando a
 * própria frase já usou a 1ª para outra coisa (ex.: nome do produto). */
function extrairNomePessoa(texto, aspasIndice = 0) {
  const aspas = capturarEntreAspas(texto);
  if (aspas[aspasIndice]) return aspas[aspasIndice];
  const especifico = capturarApos(texto, [
    "para o utente", "para a utente", "do utente", "da utente", "o utente", "a utente",
    "em nome de", "chamado", "chamada", "nome do utente", "nome:", "utente ",
  ]);
  if (especifico) return especifico;
  // fallback mais genérico ("cria um pedido ... para a Maria Silva") — só
  // tentado depois das âncoras específicas falharem, para não roubar um
  // "para" que pertença a outro campo (ex.: "para o armazenista Plural").
  return capturarApos(texto, ["para o ", "para a ", "para "]);
}

/** Cada ação suporta uma pequena descrição humana (para a mensagem de
 * esclarecimento quando falta algo) — não repete a `descricao` completa do
 * catálogo (essa é escrita para o prompt de um modelo, longa); esta é a
 * versão curta, para uma frase de chat. */
const DESCRICAO_CURTA = {
  "manipulados.mudar_estado": "mudar o estado de um pedido de manipulado",
  "manipulados.criar_pedido": "criar um novo pedido de manipulado",
  "manipulados.preparar_email_orcamento": "preparar o email de pedido de orçamento de um manipulado",
  "aue.criar_pedido": "criar um novo pedido de AUE",
  "aue.preparar_email_armazenista": "preparar o email de AUE para o armazenista",
  "catalogo.adicionar_produto": "adicionar um produto novo ao catálogo",
  "catalogo.editar_produto": "editar um produto do catálogo",
  "documentos.preparar_etiqueta": "preparar uma etiqueta",
  "gabinete.adicionar_item_stock": "adicionar um produto à Lista de Controlo do Gabinete",
  "gabinete.remover_item_stock": "remover um item do Gabinete",
  "gabinete.atualizar_stock": "atualizar um produto do Gabinete",
  "gabinete.criar_relatorio": "criar um novo relatório de Gabinete",
  "stocks.criar_lista": "criar uma lista de Stocks Errados",
  "stocks.apagar_lista": "apagar uma lista de Stocks Errados",
  "stocks.adicionar_produto": "registar um produto numa lista de Stocks Errados",
  "stocks.remover_produto": "remover um produto de uma lista de Stocks Errados",
  "listas.criar_lista": "criar uma lista de inscrição",
  "listas.apagar_lista": "apagar uma lista de inscrição",
  "listas.inscrever": "inscrever um utente numa lista",
  "listas.remover_inscricao": "remover uma inscrição de uma lista",
};

/**
 * Catálogo de reconhecimento — um "spec" por ação: `trigger(norm)` decide se
 * o texto parece pedir esta ação, `extrair(texto, norm)` tenta preencher os
 * parâmetros (obrigatórios e opcionais, o que conseguir). A ORDEM importa:
 * specs mais específicos (ex.: mudar_estado, que exige um verbo de estado
 * concreto) vêm antes dos mais genéricos da mesma família (ex.: criar_pedido,
 * que só precisa de um verbo de criação) — evita a versão genérica "roubar"
 * um pedido que já tinha um sinal mais preciso.
 */
const ACOES_SPECS = [
  {
    id: "manipulados.mudar_estado",
    trigger: (norm) => norm.includes("manipulad") && !!mapearNovoEstadoManipulado(norm),
    extrair: (texto, norm) => ({
      identificarPedido: capturarApos(texto, ["do manipulado", "da manipulad", "manipulado de", "manipulado do", "manipulado da", "pedido de", "pedido do", "pedido da", "do utente", "da utente"]) || extrairNomePessoa(texto),
      novoEstado: mapearNovoEstadoManipulado(norm),
    }),
  },
  {
    id: "manipulados.preparar_email_orcamento",
    trigger: (norm) => norm.includes("manipulad") && algumaPalavra(norm, ["email", "orcamento", "orçamento"]) && algumaPalavra(norm, ["manda", "envia", "prepara", "mandar", "enviar", "preparar"]),
    extrair: (texto) => ({
      identificarPedido: capturarApos(texto, ["do manipulado", "da manipulad", "manipulado de", "manipulado do", "manipulado da", "do utente", "da utente"]) || extrairNomePessoa(texto),
    }),
  },
  {
    id: "manipulados.criar_pedido",
    trigger: (norm) => norm.includes("manipulad") && algumaPalavra(norm, ["cria", "criar", "novo pedido", "preciso de um manipulado", "quero pedir", "pedir um manipulado", "fazer um pedido"]),
    extrair: (texto) => {
      const aspas = capturarEntreAspas(texto);
      const isVet = /veterinari/.test(normalizar(texto));
      return {
        nome: extrairNomePessoa(texto, 0),
        medicamento: capturarApos(texto, ["o medicamento", "medicamento e", "medicamento:", "medicamento ", "manipulado de", "manipulado:"]) || aspas[1] || "",
        telefone: extrairTelefone(texto), nif: extrairNif(texto),
        receita: capturarApos(texto, ["receita numero", "receita nº", "receita n.", "numero de receita", "nº de receita", "receita"]),
        tipoPrescricao: isVet ? "Uso Veterinário" : "",
        animal: isVet ? capturarApos(texto, ["do animal", "animal chamado", "para o animal", "animal:"]) : "",
        comentarios: "",
      };
    },
  },
  {
    id: "aue.preparar_email_armazenista",
    trigger: (norm) => (norm.includes(" aue") || norm.startsWith("aue") || norm.includes("autorizacao de utilizacao excecional")) && norm.includes("email") && algumaPalavra(norm, ["manda", "envia", "prepara", "mandar", "enviar", "preparar"]),
    extrair: (texto) => ({
      identificarPedido: capturarApos(texto, ["do utente", "da utente"]) || extrairNomePessoa(texto),
    }),
  },
  {
    id: "aue.criar_pedido",
    trigger: (norm) => (norm.includes(" aue") || norm.startsWith("aue") || norm.includes("autorizacao de utilizacao excecional")) && algumaPalavra(norm, ["cria", "criar", "novo pedido", "preciso", "quero pedir", "pedir"]),
    extrair: (texto, norm) => ({
      nome: extrairNomePessoa(texto, 0),
      medicamento: capturarApos(texto, ["o medicamento", "medicamento e", "medicamento:", "medicamento "]) || capturarEntreAspas(texto)[1] || "",
      armazenista: mapearArmazenista(norm),
      telefone: extrairTelefone(texto), nif: extrairNif(texto),
      medico: capturarApos(texto, ["medico ", "médico ", "dr.", "dra.", "prescrito pelo", "prescrito pela"]),
      comercial: "", receita: capturarApos(texto, ["receita numero", "numero de receita", "receita"]), comentarios: "",
    }),
  },
  {
    id: "catalogo.editar_produto",
    trigger: (norm) => algumaPalavra(norm, ["catalogo", "catálogo"]) && algumaPalavra(norm, ["edita", "editar", "corrige", "corrigir", "atualiza", "atualizar", "muda o nome", "muda o codigo"]),
    extrair: (texto) => ({
      identificarProduto: extrairNomePessoa(texto, 0) || capturarApos(texto, ["o produto", "produto ", "do produto"]) || capturarEntreAspas(texto)[0] || "",
      novoNome: capturarApos(texto, ["novo nome", "para o nome", "passa a chamar-se", "renomear para"]),
      novoCodigo: capturarApos(texto, ["novo codigo", "novo código", "codigo novo"]),
    }),
  },
  {
    id: "catalogo.adicionar_produto",
    trigger: (norm) => algumaPalavra(norm, ["catalogo", "catálogo"]) && algumaPalavra(norm, ["adiciona", "adicionar", "novo produto", "criar produto", "acrescenta"]),
    extrair: (texto) => ({
      nome: capturarEntreAspas(texto)[0] || capturarApos(texto, ["o produto", "produto ", "adiciona o", "adicionar o"]),
      codigo: capturarApos(texto, ["codigo", "código", "cnp"]),
    }),
  },
  {
    id: "documentos.preparar_etiqueta",
    trigger: (norm) => algumaPalavra(norm, ["etiqueta", "rotulo", "rótulo"]) && algumaPalavra(norm, ["prepara", "cria", "criar", "preparar", "imprime", "imprimir"]),
    extrair: (texto, norm) => ({
      tipo: mapearTipoEtiqueta(norm),
      nome: extrairNomePessoa(texto, 0), morada: capturarApos(texto, ["morada", "endereco", "endereço"]),
      telefone: extrairTelefone(texto), dataEntrega: extrairData(texto),
      produtoTester: mapearTipoEtiqueta(norm) === "tester" ? (capturarEntreAspas(texto)[0] || capturarApos(texto, ["o produto", "produto "])) : "",
      lote: capturarApos(texto, ["lote"]), validade: extrairData(texto),
      produtoNome: mapearTipoEtiqueta(norm) === "medicamento" ? (capturarEntreAspas(texto)[0] || capturarApos(texto, ["o medicamento", "medicamento "])) : "",
      dosagem: capturarApos(texto, ["dosagem"]), posologia: capturarApos(texto, ["posologia"]),
      quantidade: extrairNumero(texto, ["copias", "cópias", "quantidade"]),
    }),
  },
  {
    id: "gabinete.atualizar_stock",
    trigger: (norm) => norm.includes("gabinete") && algumaPalavra(norm, ["atualiza", "atualizar", "muda a quantidade", "altera", "mudar quantidade"]),
    extrair: (texto) => ({
      identificarItem: capturarEntreAspas(texto)[0] || extrairNomePessoa(texto, 0) || capturarApos(texto, ["o produto", "produto ", "item "]),
      quantidade: extrairNumero(texto, ["quantidade", "stock"]), quantidadeMinima: extrairNumero(texto, ["minimo", "mínimo", "quantidade minima"]),
      validade: extrairData(texto), lote: capturarApos(texto, ["lote"]), notas: "",
    }),
  },
  {
    id: "gabinete.remover_item_stock",
    trigger: (norm) => norm.includes("gabinete") && algumaPalavra(norm, ["remove", "remover", "apaga", "apagar", "elimina", "tira", "desativa"]),
    extrair: (texto) => ({
      identificarItem: capturarEntreAspas(texto)[0] || extrairNomePessoa(texto, 0) || capturarApos(texto, ["o produto", "produto ", "item ", "o item "]),
    }),
  },
  {
    id: "gabinete.criar_relatorio",
    trigger: (norm) => norm.includes("gabinete") && norm.includes("relatorio") && algumaPalavra(norm, ["cria", "criar", "novo", "abre"]),
    extrair: (texto) => ({ data: extrairData(texto), farmaceutico: capturarApos(texto, ["responsavel", "responsável", "farmaceutico", "farmacêutico"]) }),
  },
  {
    id: "gabinete.adicionar_item_stock",
    trigger: (norm) => norm.includes("gabinete") && algumaPalavra(norm, ["adiciona", "adicionar", "acrescenta", "novo produto"]),
    extrair: (texto) => ({
      nome: capturarEntreAspas(texto)[0] || capturarApos(texto, ["o produto", "produto ", "adiciona o", "adicionar o"]),
      cnp: capturarApos(texto, ["cnp", "codigo", "código"]), lote: capturarApos(texto, ["lote"]),
      validade: extrairData(texto), quantidade: extrairNumero(texto, ["quantidade"]),
      quantidadeMinima: extrairNumero(texto, ["minimo", "mínimo"]), notas: "",
    }),
  },
  {
    id: "stocks.apagar_lista",
    trigger: (norm) => algumaPalavra(norm, ["stocks errados", "stock errado", "divergencia", "divergência"]) && algumaPalavra(norm, ["apaga", "apagar", "elimina", "eliminar"]),
    extrair: (texto) => ({ identificarLista: capturarEntreAspas(texto)[0] || capturarApos(texto, ["a lista", "lista "]) }),
  },
  {
    id: "stocks.remover_produto",
    trigger: (norm) => algumaPalavra(norm, ["stocks errados", "stock errado", "divergencia", "divergência"]) && algumaPalavra(norm, ["remove", "remover", "tira", "apaga o produto"]),
    extrair: (texto) => ({
      identificarProduto: capturarEntreAspas(texto)[0] || capturarApos(texto, ["o produto", "produto "]),
      identificarLista: capturarApos(texto, ["da lista", "na lista", "lista "]),
    }),
  },
  {
    id: "stocks.criar_lista",
    trigger: (norm) => algumaPalavra(norm, ["stocks errados", "stock errado", "divergencia", "divergência"]) && algumaPalavra(norm, ["cria", "criar", "nova lista", "comecar", "começar"]),
    extrair: (texto) => ({ nome: capturarEntreAspas(texto)[0] || capturarApos(texto, ["a lista", "lista chamada", "nome "]), operador: capturarApos(texto, ["operador", "responsavel", "responsável"]) }),
  },
  {
    id: "stocks.adicionar_produto",
    trigger: (norm) => algumaPalavra(norm, ["stocks errados", "stock errado", "divergencia", "divergência"]) && algumaPalavra(norm, ["regista", "registar", "adiciona", "adicionar", "acrescenta"]),
    extrair: (texto) => ({
      nome: capturarEntreAspas(texto)[0] || capturarApos(texto, ["o produto", "produto "]),
      identificarLista: capturarApos(texto, ["na lista", "da lista", "lista "]),
      codigo: capturarApos(texto, ["codigo", "código", "cnp"]),
      stockSistema: extrairNumero(texto, ["sistema"]), stockContado: extrairNumero(texto, ["contado", "contagem"]),
    }),
  },
  {
    id: "listas.apagar_lista",
    trigger: (norm) => algumaPalavra(norm, ["lista de inscri", "minifaciais", "formacao", "formação"]) && algumaPalavra(norm, ["apaga", "apagar", "elimina", "eliminar"]),
    extrair: (texto) => ({ identificarLista: capturarEntreAspas(texto)[0] || capturarApos(texto, ["a lista", "o evento", "lista "]) }),
  },
  {
    id: "listas.remover_inscricao",
    trigger: (norm) => algumaPalavra(norm, ["inscricao", "inscrição", "inscrito"]) && algumaPalavra(norm, ["remove", "remover", "cancela", "cancelar", "tira", "apaga"]),
    extrair: (texto) => ({
      identificarLista: capturarApos(texto, ["da lista", "na lista", "do evento", "lista "]),
      // "remove a inscrição DA Maria" — padrão mais comum aqui; tentado
      // antes do genérico extrairNomePessoa pela mesma razão de
      // listas.inscrever acima.
      identificarUtente: capturarApos(texto, ["inscricao da", "inscricao do", "inscrição da", "inscrição do", "inscrito ", "inscrita "]) || extrairNomePessoa(texto, 0),
    }),
  },
  {
    id: "listas.criar_lista",
    // Verificado ANTES de listas.inscrever de propósito: "lista de
    // inscrição" (o nome genérico deste tipo de lista) contém a palavra
    // "inscrição", que também é a raiz do verbo "inscrever" — sem esta
    // ordem, "cria uma lista de inscrição chamada X" era mal-entendido como
    // um pedido para INSCREVER alguém chamado "X", em vez de criar a lista.
    trigger: (norm) => algumaPalavra(norm, ["lista de inscri", "minifaciais", "formacao", "formação"]) && algumaPalavra(norm, ["cria", "criar", "nova lista", "abre uma lista"]),
    extrair: (texto, norm) => ({
      nome: capturarEntreAspas(texto)[0] || capturarApos(texto, ["chamada", "para o evento", "evento "]),
      tipo: mapearTipoLista(norm), data: extrairData(texto),
      inicio: extrairHora(texto), fim: "", duracao: extrairNumero(texto, ["duracao", "duração", "minutos"]),
      responsavel: capturarApos(texto, ["responsavel", "responsável"]), responsavelContacto: extrairTelefone(texto),
    }),
  },
  {
    id: "listas.inscrever",
    // Só o VERBO "inscreve/inscrever" (nunca só o substantivo "inscrição",
    // que também aparece dentro de "lista de inscrição" — ver nota acima em
    // listas.criar_lista) — e nunca quando há um verbo de criação, para não
    // disputar com listas.criar_lista em frases ambíguas.
    trigger: (norm) => algumaPalavra(norm, ["inscreve", "inscrever"]) && !algumaPalavra(norm, ["remove", "remover", "cancela", "apaga", "elimina", "cria", "criar", "nova lista"]),
    extrair: (texto) => ({
      identificarLista: capturarApos(texto, ["na lista", "da lista", "no evento", "lista "]),
      // "inscreve a Maria na lista" — padrão de fala mais comum para esta
      // ação, por isso vem primeiro (antes do genérico extrairNomePessoa,
      // que exige "para"/"do utente" e não reconheceria este caso).
      nome: capturarApos(texto, ["inscreve a", "inscreve o", "inscrever a", "inscrever o", "inscrevar"]) || extrairNomePessoa(texto, 0),
      horario: extrairHora(texto), contacto: extrairTelefone(texto), obs: "",
    }),
  },
];

/**
 * Ponto de entrada. Devolve:
 *  - `null` — nenhum padrão de ação reconhecido (quem chama segue o fluxo
 *    normal: motor de perguntas, ou IA local se estiver ativa).
 *  - `{ tipo: "incompleta", acaoId, motivo }` — reconheceu a INTENÇÃO mas
 *    falta um parâmetro obrigatório; `motivo` já é uma pergunta pronta a
 *    mostrar ao operador.
 *  - `{ tipo: "pronta", acaoId, parametros }` — pronta a passar a
 *    `prepararAcao(acaoId, parametros, estado)` (ver farmaAcoes.js).
 *
 * Note-se que `catalogo.adicionar_produto`/`catalogo.editar_produto` também
 * precisam de `estado.catalogoProdutos` carregado (o mesmo que o caminho da
 * IA local já exige) — isso continua a ser responsabilidade de quem chama,
 * exatamente como já acontecia (ver `carregarEstadoParaAcao` em
 * modulos/farma-ia.html), esta função só reconhece o pedido, nunca toca em
 * `estado`.
 */
export function reconhecerAcaoDeterministica(textoOriginal) {
  const texto = String(textoOriginal || "");
  if (!texto.trim()) return null;
  const norm = normalizar(texto);

  for (const spec of ACOES_SPECS) {
    if (!spec.trigger(norm)) continue;
    const acao = ACOES_DISPONIVEIS[spec.id];
    const brutos = spec.extrair(texto, norm) || {};
    const faltam = Object.keys(acao.parametros).filter((chave) => !brutos[chave] || !String(brutos[chave]).trim());
    if (faltam.length) {
      const descricaoFaltam = faltam.map((chave) => acao.parametros[chave]).join("; ");
      return {
        tipo: "incompleta",
        acaoId: spec.id,
        faltam,
        motivo: `Percebi que quer ${DESCRICAO_CURTA[spec.id] || "fazer uma ação"}, mas preciso que me diga: ${descricaoFaltam}.`,
      };
    }
    const parametros = {};
    for (const chave of Object.keys(acao.parametros)) parametros[chave] = String(brutos[chave]).trim();
    for (const chave of Object.keys(acao.parametrosOpcionais || {})) {
      parametros[chave] = brutos[chave] ? String(brutos[chave]).trim() : "";
    }
    return { tipo: "pronta", acaoId: spec.id, parametros };
  }
  return null;
}

/** Exportado só para testes/depuração — nunca deve ser preciso fora daqui. */
export const _internos = {
  normalizar, capturarApos, capturarEntreAspas, extrairTelefone, extrairNif, extrairData, extrairHora,
  mapearNovoEstadoManipulado, mapearArmazenista, mapearTipoEtiqueta, mapearTipoLista, ACOES_SPECS,
};
