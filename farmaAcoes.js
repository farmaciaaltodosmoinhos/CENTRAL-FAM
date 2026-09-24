/**
 * src/farmaAcoes.js — ponto 30/31, "a FARMA executa tarefas na Central"
 * (pedido grande do Ivo). Arquitetura:
 *
 *  1. O motor de regras (`responderPergunta`, farmaIa.js) continua a ser
 *     SEMPRE tentado primeiro — grátis, imediato, sem IA nenhuma, cobre a
 *     maioria das perguntas já conhecidas. Nada disto muda.
 *  2. Só quando o motor de regras não reconhece a pergunta, E a farmácia
 *     escolheu (explicitamente, ver `src/ui/farmaCerebro.js`) carregar um
 *     modelo de IA local (WebLLM/WebGPU, corre no browser, nunca sai da
 *     farmácia, ver arquitetura-decisoes.md ponto 29/30), é que se tenta
 *     este caminho: pedir ao modelo local para decidir entre responder em
 *     texto livre OU propor uma AÇÃO estruturada de entre um catálogo
 *     pequeno e explícito (`ACOES_DISPONIVEIS`) — nunca inventado.
 *  3. Uma ação proposta pelo modelo NUNCA executa sozinha — só depois de o
 *     operador confirmar (ver módulo/mini-chat: mostra um resumo humano e
 *     um botão "Confirmar"). Pedido explícito do Ivo, e alinhado com a
 *     regra geral desta sessão de nunca fazer ações irreversíveis sem
 *     confirmação.
 *
 * Ponto 31 alargou o catálogo (pedido do Ivo: "preciso que a farma consiga
 * operar em toda a central") com mais 3 ações, cada uma escolhida por ser
 * uma operação de DADOS bem definida (não uma interação livre com um ecrã):
 * adicionar/editar produtos no Catálogo de Produtos (reutiliza
 * `src/produtosCatalogo.js`, já pensado para escrita concorrente segura —
 * ver `enqueueOverlaySync` nesse ficheiro), e preparar uma Etiqueta (o
 * desenho/impressão em si continua manual — a FARMA só deixa os dados
 * prontos no módulo Documentos → Etiquetas para o operador rever e
 * imprimir; nunca imprime sozinha). Cada ação nova junta-se ao mesmo
 * mecanismo (catálogo explícito → validação → resumo humano → confirmação
 * → execução) sem repetir a lógica de segurança.
 *
 * Nota de honestidade (ver arquitetura-decisoes.md, ponto 31): "operar em
 * toda a central" continua a ser um catálogo pequeno e explícito, não uma
 * promessa de "qualquer coisa" — cada ação nova tem de ser desenhada e
 * testada como as outras. Ficou deliberadamente de fora deste ponto a
 * atualização das "regras de aceitação dos laboratórios"
 * (`modulos/devolucoes-armazenistas.html`): a tabela de referência de
 * detentores de AIM vive hoje embutida por inteiro em cada carregamento da
 * página (não é um ficheiro partilhado como `assets/catalogo-base.json`),
 * por isso a FARMA não tem, ainda, uma forma fiável de encontrar o
 * detentor certo fora dessa página sem arriscar aplicar uma alteração ao
 * registo errado. Fica para uma sessão futura, depois de se extrair essa
 * tabela para um ficheiro partilhado — mesmo passo de arquitetura que já
 * foi dado para o catálogo de produtos (ponto 11).
 *
 * Ponto 34 (Gestão de Gabinete): confirmado primeiro, como para o AUE
 * (ponto 33), que `estado.gabinete` é a fonte única de verdade no servidor
 * (ver `gravarGabinete`/`doHydrateFromCloud` em `modulos/gabinete.html`) —
 * o `localStorage` aí é só cache otimista, por isso é seguro ler/escrever
 * ali diretamente sem ficar preso a um PC. "Lista de Controlo" e "Itens do
 * Gabinete" são hoje a MESMA base de dados (`gabinete_checklist_items_v1`,
 * um item com `qv:true` é uma entrada de stock) — por isso
 * `gabinete.remover_item_stock` cobre os dois conceitos que o Ivo pediu
 * juntos. Ficaram deliberadamente de fora deste ponto duas coisas, por
 * honestidade:
 *   1. Criar um item de checklist "genérico" (sem `qv`, com opções à
 *      escolha tipo "Conforme/Não conforme/Pedir" numa secção à escolha) —
 *      ao contrário de um produto de stock, isto exige escolher/():inventar
 *      uma secção e um conjunto de opções sem um valor por omissão óbvio;
 *      `gabinete.adicionar_item_stock` cobre o caso concreto que o Ivo
 *      descreveu (produtos com quantidade/validade).
 *   2. Preencher ou emitir (gerar PDF/imprimir) um relatório de gabinete já
 *      com respostas item a item: as respostas são observações de uma
 *      inspeção física (contagens, "conforme"/"não conforme") que a FARMA
 *      não tem como saber — inventá-las seria pior do que não as dar. A
 *      geração do PDF em si (`gerarPdfRelatorio`, em gabinete.html) também
 *      depende de renderizar o DOM real com html2canvas/jsPDF, algo que não
 *      existe fora dessa página. `gabinete.criar_relatorio` cria por isso
 *      só a "capa" vazia do relatório (data + responsável), pronta a abrir
 *      e preencher no módulo — nunca inventa respostas.
 *
 * Ponto 38 (continuação do catálogo, item "Stocks Errados" da nota de
 * honestidade dos pontos 32/33): confirmado primeiro, como sempre, que
 * `estado.stocksErrados` é a fonte única de verdade no servidor (ver
 * `gravarStocksErrados`/`loadInitialData` em `modulos/stocks.html`) — seguro
 * ler/escrever ali diretamente. Quatro ações novas: criar/apagar uma lista
 * de contagem, e registar/remover um produto numa lista já existente.
 * Decisão deliberada: um produto registado pela FARMA fica sempre como
 * entrada "manual" (nome tal como escrito pelo operador, sem tentar casar
 * contra o catálogo de ~29 mil produtos por substring) — um erro de
 * correspondência aqui gravaria uma divergência de stock contra o produto
 * ERRADO, pior do que perguntar o nome outra vez; é exatamente o mesmo botão
 * "produto manual" que o módulo já oferece ao operador humano.
 * Ponto 40 (Listas de Inscrição, `modulos/documentos.html`): uma primeira
 * leitura apressada da função `saveJSON()` desse módulo (parou na primeira
 * linha, `localStorage.setItem(...)`) levou a crer, erradamente, que
 * `cdocs_listas_v1` vivia só no browser — o que teria bloqueado esta peça
 * por violar a decisão do ponto 29. Lendo a função até ao fim: `saveJSON`
 * despacha também `gravarDocumentos(key, val)` para qualquer chave presente
 * em `CLOUD_SYNC_KEYS` (que inclui `cdocs_listas_v1`), e `hydrateFromCloud()`
 * — chamada ao arrancar a página — repõe `LISTAS` a partir de
 * `estado.documentos.cdocs_listas_v1` no servidor. Confirmado com Playwright
 * num segundo contexto de browser (simulando um segundo computador): uma
 * lista criada num "computador" aparece no outro depois de recarregar. É por
 * isso seguro operar aqui, tal como nos outros módulos — a FARMA lê/escreve
 * `estado.documentos.cdocs_listas_v1` diretamente, com o mesmo padrão de
 * merge que `gravarDocumentos()` já usa (só mexe nesta chave, preserva as
 * restantes chaves de `documentos` e o resto do estado).
 * Quatro ações novas: `listas.criar_lista` (gera os horários com o mesmo
 * algoritmo de `createLista()`), `listas.apagar_lista`,
 * `listas.inscrever` e `listas.remover_inscricao`. A parte mais interessante
 * é `listas.inscrever`: o exemplo mais complexo que o Ivo deu foi "adicionar
 * um utente perguntando primeiro qual o horário livre" — em vez de
 * arquitetura nova, isto usa o mecanismo que já existe desde o ponto 32
 * (memória de conversa): quando o operador não diz o horário, a ação não
 * falha às cegas — devolve a lista de horários livres na própria mensagem
 * de erro, que o modelo lê e mostra ao operador; a resposta seguinte dele
 * (com o horário escolhido) já tem o contexto da pergunta anterior.
 * Nota de honestidade que se mantém: gerar/imprimir o PDF da lista
 * (`printListaInscricao`) fica de fora — depende de `window.print()` sobre o
 * DOM realmente renderizado nessa página, algo que não existe fora dela
 * (mesma limitação, por natureza, de `gabinete.criar_relatorio`).
 */
import { STATUS_MANIPULADOS, encontrarPedidosPorTexto, mudarEstadoPedido } from "./manipuladosCore.js";
import { adicionarProdutos, editarProduto } from "./produtosCatalogo.js";

/** Catálogo de ações que a FARMA sabe propor. Cada entrada tem uma
 * descrição (para o prompt do modelo), os parâmetros OBRIGATÓRIOS — o
 * modelo tem de os preencher sempre, com texto não vazio, senão a ação é
 * tratada como inválida — e, opcionalmente, `parametrosOpcionais`: campos
 * que o modelo pode deixar como "" quando não sabe ou não se aplicam. */
export const ACOES_DISPONIVEIS = {
  "manipulados.mudar_estado": {
    descricao: "Muda o estado de um pedido de manipulado já existente (ex.: marcar como entregue, " +
      "pôr a aguardar a farmácia, cancelar). NÃO cria pedidos novos.",
    parametros: {
      identificarPedido: "texto curto para encontrar o pedido — nome do utente OU nome do medicamento, tal como o operador o escreveu",
      novoEstado: `um destes valores exatos: ${Object.keys(STATUS_MANIPULADOS).join(", ")}`,
    },
  },
  "manipulados.criar_pedido": {
    descricao: "Cria um pedido novo de manipulado. Campos que faltem ficam em branco e podem ser " +
      "completados depois no módulo — mas pergunta sempre pelo telefone, NIF e nº de receita se o " +
      "operador não os tiver dado, em vez de os inventar.",
    parametros: {
      nome: "nome do utente (ou do dono do animal, se for prescrição veterinária)",
      medicamento: "nome/descrição do manipulado pedido",
    },
    parametrosOpcionais: {
      telefone: "contacto telefónico do utente",
      nif: "NIF do utente",
      receita: "número da receita",
      tipoPrescricao: 'um destes valores exatos: "Uso Humano" ou "Uso Veterinário" — usa "Uso Humano" se não for dito o contrário',
      animal: "nome do animal — só quando tipoPrescricao é \"Uso Veterinário\" (nesse caso é obrigatório perguntar se não for dado)",
      comentarios: "observações adicionais sobre o pedido",
    },
  },
  "manipulados.preparar_email_orcamento": {
    descricao: "Prepara (mas NUNCA envia sozinha) o email de pedido de orçamento para um pedido de " +
      "manipulado já existente — abre o programa de email do operador já preenchido, para ele rever e " +
      "só ele enviar. Usa isto quando o operador pedir para mandar/preparar um email sobre um manipulado, " +
      "ou quando, depois de criares um pedido novo, o operador confirmar que quer enviar o pedido de orçamento.",
    parametros: {
      identificarPedido: "texto curto para encontrar o pedido — nome do utente OU nome do medicamento, tal como o operador o escreveu",
    },
  },
  "aue.criar_pedido": {
    descricao: "Cria um pedido novo de Autorização de Utilização Excecional (AUE). Campos que faltem " +
      "ficam em branco e podem ser completados depois no módulo — mas pergunta sempre pelo NIF, telefone " +
      "e nome do médico se o operador não os tiver dado, em vez de os inventar.",
    parametros: {
      nome: "nome do utente",
      medicamento: "nome do medicamento pedido em regime de AUE",
      armazenista: 'um destes valores exatos: "Alliance Healthcare", "Empifarma", "OCP" ou "Plural" — a quem vai ser pedida a autorização',
    },
    parametrosOpcionais: {
      telefone: "contacto telefónico do utente",
      nif: "NIF do utente",
      medico: "nome do médico que prescreveu",
      comercial: "nome comercial do medicamento, se for diferente do genérico",
      receita: "número da receita",
      comentarios: "observações adicionais sobre o pedido",
    },
  },
  "aue.preparar_email_armazenista": {
    descricao: "Prepara (mas NUNCA envia sozinha) o email de pedido de AUE ao armazenista, para um pedido " +
      "já existente — abre o programa de email do operador já preenchido, para ele rever, anexar os " +
      "documentos obrigatórios se ainda não estiverem juntos ao pedido, e só ele enviar.",
    parametros: {
      identificarPedido: "texto curto para encontrar o pedido — nome do utente OU nome do medicamento, tal como o operador o escreveu",
    },
  },
  "catalogo.adicionar_produto": {
    descricao: "Adiciona um produto novo ao catálogo de produtos desta farmácia (um produto que ainda não existe no catálogo).",
    parametros: {
      nome: "nome/designação do produto a adicionar",
    },
    parametrosOpcionais: {
      codigo: "código do produto (CNP), só se for conhecido",
    },
  },
  "catalogo.editar_produto": {
    descricao: "Edita o nome e/ou o código de um produto já existente no catálogo. NÃO adiciona produtos novos e nunca muda a categoria/família do produto.",
    parametros: {
      identificarProduto: "nome ou código atual do produto a editar, tal como o operador o escreveu",
    },
    parametrosOpcionais: {
      novoNome: "novo nome/designação do produto, só se for isso que se quer mudar",
      novoCodigo: "novo código (CNP) do produto, só se for isso que se quer mudar",
    },
  },
  "documentos.preparar_etiqueta": {
    descricao: "Prepara os dados de uma etiqueta/rótulo (entrega ao domicílio, tester, ou medicamento) para o " +
      "operador rever e imprimir no módulo Documentos → Etiquetas. NUNCA imprime sozinha — só deixa os dados prontos.",
    parametros: {
      tipo: "um destes valores exatos: domicilio, tester, medicamento",
    },
    parametrosOpcionais: {
      nome: "nome do utente (etiqueta de entrega ao domicílio)",
      morada: "morada de entrega (etiqueta de entrega ao domicílio)",
      telefone: "telefone de contacto (etiqueta de entrega ao domicílio)",
      dataEntrega: "data de entrega no formato AAAA-MM-DD (etiqueta de entrega ao domicílio)",
      produtoTester: "nome do produto (etiqueta tester)",
      lote: "lote do produto (etiqueta tester)",
      validade: "validade no formato MM/AAAA (etiqueta tester)",
      produtoNome: "nome do medicamento (etiqueta de medicamento)",
      dosagem: "dosagem do medicamento, ex.: 500mg (etiqueta de medicamento)",
      posologia: "posologia, ex.: 1 comprimido 3x/dia (etiqueta de medicamento)",
      quantidade: "número de cópias a imprimir, só se for diferente de 1",
    },
  },
  "gabinete.adicionar_item_stock": {
    descricao: "Adiciona um produto novo à Lista de Controlo do Gabinete do Utente (ex.: material de " +
      "enfermagem, testes, kits). Usa isto só para produtos que ainda não estão na lista — para mudar " +
      "quantidade/validade de um produto já existente usa gabinete.atualizar_stock.",
    parametros: {
      nome: "nome do produto a adicionar",
    },
    parametrosOpcionais: {
      cnp: "código CNP do produto, se for conhecido",
      lote: "número de lote",
      validade: "data de validade no formato AAAA-MM-DD",
      quantidade: "quantidade inicial em stock (número)",
      quantidadeMinima: "quantidade mínima de alerta (número)",
      notas: "observações sobre o produto",
    },
  },
  "gabinete.remover_item_stock": {
    descricao: "Remove (desativa) um item já existente da Lista de Controlo ou dos Itens do Gabinete — " +
      "deixa de aparecer em relatórios futuros, mas o histórico de relatórios já guardados é mantido.",
    parametros: {
      identificarItem: "nome ou CNP do item a remover, tal como o operador o escreveu",
    },
  },
  "gabinete.atualizar_stock": {
    descricao: "Muda a quantidade, quantidade mínima, validade, lote ou notas de um produto já existente " +
      "na Lista de Controlo do Gabinete. NÃO cria produtos novos.",
    parametros: {
      identificarItem: "nome ou CNP do produto a atualizar, tal como o operador o escreveu",
    },
    parametrosOpcionais: {
      quantidade: "nova quantidade em stock (número)",
      quantidadeMinima: "nova quantidade mínima de alerta (número)",
      validade: "nova data de validade no formato AAAA-MM-DD",
      lote: "novo número de lote",
      notas: "novas observações",
    },
  },
  "gabinete.criar_relatorio": {
    descricao: "Cria um novo relatório (vazio) de gabinete do utente, pronto a abrir e preencher item a " +
      "item no módulo Gestão de Gabinete → Relatórios. NUNCA preenche sozinha as respostas de cada item " +
      "(isso exigiria inventar resultados de uma inspeção) — só cria o relatório com a data e o " +
      "responsável indicados.",
    parametros: {},
    parametrosOpcionais: {
      data: "data do relatório no formato AAAA-MM-DD — usa hoje se não for dito o contrário",
      farmaceutico: "nome do farmacêutico/técnico responsável",
    },
  },
  "stocks.criar_lista": {
    descricao: "Cria uma nova lista de contagem de Stocks Errados (divergências entre o stock do sistema e o " +
      "stock contado fisicamente). Usa isto quando o operador pedir para começar uma lista nova.",
    parametros: {},
    parametrosOpcionais: {
      nome: "nome da lista — usa a data de hoje (formato DD-MM-AAAA) se não for dito o contrário",
      operador: "nome do operador responsável pela contagem",
    },
  },
  "stocks.apagar_lista": {
    descricao: "Apaga (elimina) uma lista de Stocks Errados já existente, incluindo todos os produtos nela " +
      "registados. Ação irreversível — só executa depois de confirmação do operador.",
    parametros: {
      identificarLista: "nome da lista a apagar, tal como o operador o escreveu",
    },
  },
  "stocks.adicionar_produto": {
    descricao: "Regista um produto novo numa lista de Stocks Errados já existente (contagem de sistema/contado). " +
      "NÃO cria a lista — usa stocks.criar_lista primeiro se ainda não existir nenhuma lista.",
    parametros: {
      nome: "nome do produto a registar",
    },
    parametrosOpcionais: {
      identificarLista: "nome da lista onde adicionar — só é preciso indicar se houver mais do que uma lista criada",
      codigo: "código do produto (CNP), se for conhecido",
      stockSistema: "quantidade que o sistema informático indica (número)",
      stockContado: "quantidade contada fisicamente (número)",
    },
  },
  "stocks.remover_produto": {
    descricao: "Remove um produto já registado de uma lista de Stocks Errados.",
    parametros: {
      identificarProduto: "nome ou código do produto a remover, tal como o operador o escreveu",
    },
    parametrosOpcionais: {
      identificarLista: "nome da lista de onde remover — só é preciso indicar se houver mais do que uma lista criada",
    },
  },
  "listas.criar_lista": {
    descricao: "Cria uma nova lista de inscrição (ex.: minifaciais, formação, outro evento) com horários gerados automaticamente entre a hora de início e a hora de fim.",
    parametros: {},
    parametrosOpcionais: {
      nome: "nome do evento — usa \"Sessão de Minifaciais\" se não for dito o contrário",
      tipo: 'um destes valores exatos: "minifaciais", "formacao" ou "outro" — usa "minifaciais" se não for dito o contrário',
      data: "data do evento no formato AAAA-MM-DD — usa hoje se não for dito o contrário",
      inicio: "hora de início no formato HH:MM — usa \"09:00\" se não for dito o contrário",
      fim: "hora de fim no formato HH:MM — usa \"13:00\" se não for dito o contrário",
      duracao: "duração de cada sessão em minutos (número) — usa 20 se não for dito o contrário",
      responsavel: "nome do profissional responsável",
      responsavelContacto: "telefone ou email do responsável",
    },
  },
  "listas.apagar_lista": {
    descricao: "Apaga (elimina) uma lista de inscrição já existente, incluindo todas as inscrições nela registadas. Ação irreversível.",
    parametros: { identificarLista: "nome do evento a apagar, tal como o operador o escreveu" },
  },
  "listas.inscrever": {
    descricao: "Inscreve um utente num horário livre de uma lista de inscrição já existente. Se não souberes o horário " +
      "pretendido, NÃO adivinhes — usa esta ação na mesma sem o parâmetro \"horario\": a FARMA responde com os " +
      "horários livres para o operador escolher, e podes voltar a chamar esta ação com o horário escolhido.",
    parametros: {
      identificarLista: "nome do evento/lista onde inscrever, tal como o operador o escreveu",
      nome: "nome do utente a inscrever",
    },
    parametrosOpcionais: {
      horario: "horário pretendido, tal como aparece na lista (ex.: 09:20) — deixa em branco se não for dito",
      contacto: "contacto do utente",
      obs: "observações sobre a inscrição",
    },
  },
  "listas.remover_inscricao": {
    descricao: "Remove a inscrição de um utente já inscrito numa lista (o horário volta a ficar livre).",
    parametros: {
      identificarLista: "nome do evento/lista de onde remover a inscrição, tal como o operador o escreveu",
      identificarUtente: "nome do utente cuja inscrição remover",
    },
  },
};

/** Chaves usadas dentro de `estado.gabinete` — mesmas constantes/strings de
 * `modulos/gabinete.html` (STOCK_KEY/REPORTS_KEY/etc.) — têm de bater certo
 * byte a byte, senão a FARMA escrevia numa fatia que o módulo não lê. */
const GABINETE_CHECKLIST_ITEMS_KEY = "gabinete_checklist_items_v1";
const GABINETE_CHECKLIST_SECTIONS_KEY = "gabinete_checklist_sections_v1";
const GABINETE_REPORTS_KEY = "gabinete_reports_v1";

/** Constrói o prompt de sistema enviado ao modelo local. Português de
 * Portugal, registo direto — mesmo guia de voz do ponto 27 (farmaIa.js). */
export function construirPromptSistema() {
  const listaAcoes = Object.entries(ACOES_DISPONIVEIS)
    .map(([id, a]) => {
      const opcionais = a.parametrosOpcionais
        ? ` Parâmetros opcionais (usa "" quando não souberes ou não se aplicar): ${JSON.stringify(a.parametrosOpcionais)}.`
        : "";
      return `- "${id}": ${a.descricao} Parâmetros obrigatórios: ${JSON.stringify(a.parametros)}.${opcionais}`;
    })
    .join("\n");
  return [
    "És a FARMA, a assistente de uma farmácia portuguesa dentro da aplicação Central Operacional.",
    "Respondes SEMPRE em português de Portugal, de forma direta e sem inventar números ou factos.",
    "",
    "Só sabes executar estas ações (nada além destas — para qualquer outra coisa, responde em texto):",
    listaAcoes,
    "",
    "Respondes SEMPRE com um único objeto JSON, sem nenhum texto antes ou depois, numa destas duas formas:",
    '1) Para propor uma ação: {"tipo":"acao","acaoId":"<um dos ids acima>","parametros":{...}}',
    '2) Para responder em texto (inclui quando não sabes fazer o que pedem, ou falta informação): {"tipo":"resposta","texto":"..."}',
    "Se faltar informação obrigatória para executar uma ação com confiança, usa a forma 2 e pergunta o que falta — nunca adivinhes.",
  ].join("\n");
}

/** Tenta extrair um objeto JSON de um texto de resposta do modelo (alguns
 * modelos pequenos envolvem o JSON em ```json ... ``` ou acrescentam texto à
 * volta, mesmo quando pedido para não o fazer). Devolve `null` se não
 * conseguir encontrar nada que pareça JSON válido. */
export function extrairJson(textoBruto) {
  if (!textoBruto) return null;
  const semCercas = textoBruto.replace(/```json|```/gi, "").trim();
  const inicio = semCercas.indexOf("{");
  const fim = semCercas.lastIndexOf("}");
  if (inicio === -1 || fim === -1 || fim < inicio) return null;
  try {
    return JSON.parse(semCercas.slice(inicio, fim + 1));
  } catch (e) {
    return null;
  }
}

/**
 * Interpreta e VALIDA a resposta bruta do modelo contra o catálogo de ações
 * — nunca confia cegamente no que o modelo devolveu. Resultado sempre um
 * destes três tipos: "acao" (validada, pronta a confirmar — `parametros` traz
 * todos os obrigatórios já preenchidos e todos os opcionais, mesmo que "" ),
 * "resposta" (texto simples), ou "invalido" (o modelo disse algo que não
 * bate certo — trata-se como "não percebi", nunca se tenta adivinhar o resto).
 */
export function interpretarRespostaLLM(textoBruto) {
  const json = extrairJson(textoBruto);
  if (!json || typeof json !== "object") {
    return { tipo: "invalido", motivo: "resposta do modelo não continha JSON válido" };
  }
  if (json.tipo === "resposta") {
    if (typeof json.texto !== "string" || !json.texto.trim()) {
      return { tipo: "invalido", motivo: "resposta sem texto" };
    }
    return { tipo: "resposta", texto: json.texto.trim() };
  }
  if (json.tipo === "acao") {
    const acao = ACOES_DISPONIVEIS[json.acaoId];
    if (!acao) {
      return { tipo: "invalido", motivo: `ação "${json.acaoId}" não existe no catálogo` };
    }
    const brutos = json.parametros && typeof json.parametros === "object" ? json.parametros : {};
    for (const chave of Object.keys(acao.parametros)) {
      if (!brutos[chave] || typeof brutos[chave] !== "string" || !brutos[chave].trim()) {
        return { tipo: "invalido", motivo: `falta o parâmetro "${chave}" para a ação "${json.acaoId}"` };
      }
    }
    const parametros = {};
    for (const chave of Object.keys(acao.parametros)) parametros[chave] = brutos[chave].trim();
    for (const chave of Object.keys(acao.parametrosOpcionais || {})) {
      parametros[chave] = typeof brutos[chave] === "string" ? brutos[chave].trim() : "";
    }
    return { tipo: "acao", acaoId: json.acaoId, parametros };
  }
  return { tipo: "invalido", motivo: `tipo de resposta desconhecido: "${json.tipo}"` };
}

/** Encontra produtos no catálogo efetivo por nome (substring) ou código
 * (igualdade exata — um código é um identificador preciso, não faz sentido
 * casar por substring e arriscar apanhar outro produto). */
function encontrarProdutosPorTexto(produtos, texto) {
  const alvo = (texto || "").trim().toLowerCase();
  if (!alvo) return [];
  return (produtos || []).filter(p => {
    const nome = String(p?.[0] || "").toLowerCase();
    const codigo = String(p?.[1] || "").toLowerCase();
    return codigo === alvo || nome.includes(alvo);
  });
}

const LABEL_TIPO_ETIQUETA = { domicilio: "entrega ao domicílio", tester: "tester", medicamento: "medicamento" };

/** Mesmo template de email de pedido de orçamento já usado no botão manual
 * de `modulos/manipulados.html` (`buildEmailContent`) — reescrito aqui como
 * função pura (sem DOM) para poder ser testado e reutilizado pela FARMA.
 * Omite de propósito os campos "código de acesso/dispensa" e "código de
 * direito de opção": pedidos criados pela FARMA não os têm preenchidos, e
 * inventar um valor aqui seria pior do que simplesmente não os mencionar. */
function construirConteudoEmailOrcamento(pedido, nomeFarmacia, destino) {
  const isVet = pedido.tipoPrescricao === "Uso Veterinário";
  const subject = "Pedido de orçamento — Manipulado: " + (pedido.medicamento || "");
  const linhas = [
    "Bom dia,", "",
    `Vimos por este meio pedir orçamento para o manipulado "${pedido.medicamento || ""}".`, "",
    "Dados do pedido:",
    isVet ? `Dono do animal: ${pedido.nome || "—"}` : `Utente: ${pedido.nome || "—"}`,
  ];
  if (isVet) linhas.push(`Animal: ${pedido.animal || "—"}`);
  linhas.push(
    `Contacto: ${pedido.telefone || "—"}`,
    `Nº de receita: ${pedido.receita || "—"}`,
  );
  if (pedido.comentarios && pedido.comentarios.trim()) linhas.push("", pedido.comentarios.trim());
  linhas.push("", "Com os melhores cumprimentos,", nomeFarmacia);
  return { to: destino || "", subject, body: linhas.join("\n") };
}

/** Os 4 armazenistas reais suportados pelo módulo AUE (`modulos/aue.html`,
 * `ARMAZENISTAS`) — lista pequena e fixa, por isso validada por igualdade
 * exata (sem espaço para o modelo "inventar" um armazenista novo). */
const AUE_ARMAZENISTAS = ["Alliance Healthcare", "Empifarma", "OCP", "Plural"];

/** Encontra pedidos de AUE por nome do utente ou nome do medicamento —
 * mesma ideia de `encontrarPedidosPorTexto` (manipuladosCore.js), mas para
 * `estado.aue.pedidos`, que é uma coleção à parte. */
function encontrarPedidosAuePorTexto(pedidos, texto) {
  const alvo = (texto || "").trim().toLowerCase();
  if (!alvo) return [];
  return (pedidos || []).filter(p => {
    const nome = String(p?.nome || "").toLowerCase();
    const medicamento = String(p?.medicamento || "").toLowerCase();
    return nome.includes(alvo) || medicamento.includes(alvo);
  });
}

/** Encontra itens ativos da Lista de Controlo/Itens do Gabinete
 * (`gabinete_checklist_items_v1`) por nome (substring) ou CNP (igualdade
 * exata). `apenasStock`, quando `true`, restringe a itens com `qv:true`
 * (os que têm quantidade/validade geridas — a Lista de Controlo
 * propriamente dita) — usado por `gabinete.atualizar_stock`, que só faz
 * sentido para esses. Itens já desativados (`ativo:false`) nunca são
 * devolvidos — corresponderiam a algo que já foi removido. */
function encontrarItensGabinetePorTexto(itens, texto, { apenasStock = false } = {}) {
  const alvo = (texto || "").trim().toLowerCase();
  if (!alvo) return [];
  return (itens || []).filter(it => {
    if (it.ativo === false) return false;
    if (apenasStock && !it.qv) return false;
    const nome = String(it?.nome || "").toLowerCase();
    const cnp = String(it?.cnp || "").toLowerCase();
    return (cnp && cnp === alvo) || nome.includes(alvo);
  });
}

/** Data de hoje no formato DD-MM-AAAA — mesmo formato de `todayLabel()` em
 * `modulos/stocks.html`, usado como nome por omissão de uma lista nova. */
function todayLabelDDMMYYYY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** Encontra listas de Stocks Errados por nome (substring, case-insensitive).
 * `estado.stocksErrados` é um objeto { [id]: {id,nome,operador,criadoEm,
 * atualizadoEm,items} } — mesma estrutura gravada por gravarStocksErrados()
 * em modulos/stocks.html (ver LISTS ali). */
function encontrarListasStocksPorTexto(listas, texto) {
  const alvo = (texto || "").trim().toLowerCase();
  if (!alvo) return [];
  return Object.values(listas || {}).filter(l => String(l?.nome || "").toLowerCase().includes(alvo));
}

/** Resolve QUAL lista de Stocks Errados usar quando o operador pode não a
 * ter identificado explicitamente: só é seguro adivinhar quando existe
 * exatamente uma lista criada — com 0 ou mais do que 1, pede para ser
 * específico em vez de arriscar escolher a lista errada. */
function resolverListaStocksAlvo(listas, identificarLista) {
  if (identificarLista && identificarLista.trim()) {
    const candidatos = encontrarListasStocksPorTexto(listas, identificarLista);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhuma lista de Stocks Errados a corresponder a "${identificarLista}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map(l => `"${l.nome}"`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que uma lista a corresponder a "${identificarLista}": ${nomes}. Sê mais específico.` };
    }
    return { ok: true, lista: candidatos[0] };
  }
  const todasListas = Object.values(listas || {});
  if (todasListas.length === 0) {
    return { ok: false, motivo: "Ainda não há nenhuma lista de Stocks Errados criada — cria uma primeiro." };
  }
  if (todasListas.length > 1) {
    return { ok: false, motivo: `Há ${todasListas.length} listas de Stocks Errados criadas — diz o nome da lista onde queres isto.` };
  }
  return { ok: true, lista: todasListas[0] };
}

/** Chave usada dentro de `estado.documentos` para Listas de Inscrição —
 * mesma constante `LISTAS_KEY` de `modulos/documentos.html`, tem de bater
 * certo byte a byte (ver comentário do ponto 40 acima). */
const DOCUMENTOS_LISTAS_KEY = "cdocs_listas_v1";
const LISTA_TIPO_LABEL_FARMA = { minifaciais: "Minifaciais", formacao: "Formação", outro: "Outro evento" };

/** Encontra listas de inscrição por nome (substring, case-insensitive). */
function encontrarListasInscricaoPorTexto(listas, texto) {
  const alvo = (texto || "").trim().toLowerCase();
  if (!alvo) return [];
  return Object.values(listas || {}).filter(l => String(l?.nome || "").toLowerCase().includes(alvo));
}

/** Resolve QUAL lista de inscrição usar — nunca adivinha com 0 ou mais do
 * que 1 candidato, mesmo padrão de resolverListaStocksAlvo acima. Ao
 * contrário de Stocks Errados, aqui identificarLista é sempre obrigatório
 * no catálogo (não há fallback "só há uma lista, uso essa"), porque é
 * normal haver várias listas de inscrição ativas ao mesmo tempo. */
function resolverListaInscricaoAlvo(listas, identificarLista) {
  const candidatos = encontrarListasInscricaoPorTexto(listas, identificarLista);
  if (candidatos.length === 0) {
    return { ok: false, motivo: `Não encontrei nenhuma lista de inscrição a corresponder a "${identificarLista}".` };
  }
  if (candidatos.length > 1) {
    const nomes = candidatos.map(l => `"${l.nome}"`).join(", ");
    return { ok: false, motivo: `Encontrei mais do que uma lista a corresponder a "${identificarLista}": ${nomes}. Sê mais específico.` };
  }
  return { ok: true, lista: candidatos[0] };
}

/** Gera os horários de uma lista de inscrição — mesmo algoritmo (e mesmo
 * separador en-dash "–", não hífen) de createLista() em
 * modulos/documentos.html, para o resultado ficar indistinguível de uma
 * lista criada manualmente na página. */
function gerarSlotsInscricao(inicio, fim, duracao) {
  const slots = [];
  const [h, m] = inicio.split(":").map(Number);
  const [fh, fm] = fim.split(":").map(Number);
  let cur = h * 60 + m;
  const end = fh * 60 + fm;
  const pad2 = n => String(n).padStart(2, "0");
  while (cur + duracao <= end) {
    const start = cur, stop = cur + duracao;
    slots.push({
      id: "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      horario: `${pad2(Math.floor(start / 60))}:${pad2(start % 60)} – ${pad2(Math.floor(stop / 60))}:${pad2(stop % 60)}`,
      utente: "", contacto: "", obs: "", bloqueado: false, extra: false,
    });
    cur += duracao;
  }
  return slots;
}

/** Mesmo template do email automático ao armazenista já usado em
 * `modulos/aue.html` (`buildArmazenistaEmailContent`) — reescrito aqui como
 * função pura (sem DOM/rede). Nunca inclui anexos: mesmo quando o módulo os
 * inclui automaticamente (se os 3 documentos obrigatórios já estiverem
 * juntos ao pedido), um pedido criado pela FARMA por linguagem natural
 * nunca tem esses documentos anexados (a leitura de imagens continua
 * deliberadamente adiada — ver ponto 29) — a mensagem devolvida por
 * `executarAcaoConfirmada` lembra o operador de os anexar manualmente. */
function construirConteudoEmailArmazenista(pedido, nomeFarmacia, destino, cc) {
  const subject = "Pedido de Autorização de Utilização Excecional (AUE) " + (pedido.medicamento || "");
  const linhas = [
    "Bom dia,", "",
    `Vimos por este meio enviar em anexo documentos para pedido de AUE ${pedido.medicamento || ""}.`, "",
    "Dados do pedido:",
    `Nome do utente: ${pedido.nome || "—"}`,
    `Contacto do utente: ${pedido.telefone || "—"}`,
    `Nº de receita: ${pedido.receita || "—"}`,
    "", "",
    "Com os melhores cumprimentos,",
    nomeFarmacia,
  ];
  return { to: destino || "", cc: cc || "", subject, body: linhas.join("\n") };
}

/**
 * Resolve uma ação já validada contra os DADOS REAIS (encontrar o pedido/
 * produto exato, confirmar valores válidos) e devolve um resumo pronto a
 * mostrar ao operador, SEM AINDA A EXECUTAR — a confirmação e a escrita
 * acontecem à parte (ver executarAcaoConfirmada), sempre depois de o
 * operador clicar em "Confirmar". Função pura e síncrona de propósito
 * (testável sem rede) — quando uma ação precisa de dados adicionais (ex.:
 * o catálogo de produtos, que não vive em `estado`), quem chama é
 * responsável por os carregar antecipadamente e anexá-los a `estado`
 * (ver `estado.catalogoProdutos` nas ações de catálogo abaixo).
 *
 * @returns {{ok:true, resumo:string, plano:object} | {ok:false, motivo:string}}
 */
export function prepararAcao(acaoId, parametros, estado) {
  if (acaoId === "manipulados.mudar_estado") {
    const pedidos = Array.isArray(estado?.manipulados) ? estado.manipulados : [];
    const candidatos = encontrarPedidosPorTexto(pedidos, parametros.identificarPedido);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum pedido de manipulado a corresponder a "${parametros.identificarPedido}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map(p => `"${p.nome}" (${p.medicamento || "sem medicamento indicado"})`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um pedido a corresponder a "${parametros.identificarPedido}": ${nomes}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    if (!STATUS_MANIPULADOS[parametros.novoEstado]) {
      return { ok: false, motivo: `"${parametros.novoEstado}" não é um estado válido de manipulados.` };
    }
    const rotuloNovo = STATUS_MANIPULADOS[parametros.novoEstado].label;
    const rotuloAtual = STATUS_MANIPULADOS[alvo.status]?.label || alvo.status;
    return {
      ok: true,
      resumo: `Mudar o pedido de "${alvo.nome}" (${alvo.medicamento || "sem medicamento indicado"}) de "${rotuloAtual}" para "${rotuloNovo}".`,
      plano: { tipo: "manipulados.mudar_estado", pedidoId: alvo.id, novoEstado: parametros.novoEstado },
    };
  }

  if (acaoId === "manipulados.criar_pedido") {
    const nome = (parametros.nome || "").trim();
    const medicamento = (parametros.medicamento || "").trim();
    if (!nome) return { ok: false, motivo: "Falta o nome do utente (ou do dono do animal, se for uso veterinário)." };
    if (!medicamento) return { ok: false, motivo: "Falta o nome/descrição do manipulado a pedir." };
    const tipoPrescricao = (parametros.tipoPrescricao || "").trim() === "Uso Veterinário" ? "Uso Veterinário" : "Uso Humano";
    const animal = (parametros.animal || "").trim();
    if (tipoPrescricao === "Uso Veterinário" && !animal) {
      return { ok: false, motivo: "É uma prescrição de uso veterinário — falta o nome do animal." };
    }
    const dados = {
      nome, medicamento, tipoPrescricao,
      animal: tipoPrescricao === "Uso Veterinário" ? animal : "",
      telefone: (parametros.telefone || "").trim(),
      nif: (parametros.nif || "").trim(),
      receita: (parametros.receita || "").trim(),
      comentarios: (parametros.comentarios || "").trim(),
    };
    const emFalta = [];
    if (!dados.telefone) emFalta.push("telefone");
    if (!dados.nif) emFalta.push("NIF");
    if (!dados.receita) emFalta.push("nº de receita");
    const alvoDescricao = tipoPrescricao === "Uso Veterinário" ? `o animal "${animal}" (dono/a ${nome})` : nome;
    return {
      ok: true,
      resumo: `Criar um novo pedido de manipulado: "${medicamento}" para ${alvoDescricao}.` +
        (emFalta.length ? ` (por preencher: ${emFalta.join(", ")} — pode completar-se depois no módulo).` : ""),
      plano: { tipo: "manipulados.criar_pedido", dados },
    };
  }

  if (acaoId === "manipulados.preparar_email_orcamento") {
    const pedidos = Array.isArray(estado?.manipulados) ? estado.manipulados : [];
    const candidatos = encontrarPedidosPorTexto(pedidos, parametros.identificarPedido);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum pedido de manipulado a corresponder a "${parametros.identificarPedido}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map(p => `"${p.nome}" (${p.medicamento || "sem medicamento indicado"})`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um pedido a corresponder a "${parametros.identificarPedido}": ${nomes}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    return {
      ok: true,
      resumo: `Preparar o email de pedido de orçamento para "${alvo.medicamento || "sem medicamento indicado"}" (${alvo.nome}) — abre o teu programa de email para reveres e enviares.`,
      plano: { tipo: "manipulados.preparar_email_orcamento", pedidoId: alvo.id },
    };
  }

  if (acaoId === "aue.criar_pedido") {
    const nome = (parametros.nome || "").trim();
    const medicamento = (parametros.medicamento || "").trim();
    const armazenistaBruto = (parametros.armazenista || "").trim();
    const armazenista = AUE_ARMAZENISTAS.find(a => a.toLowerCase() === armazenistaBruto.toLowerCase());
    if (!nome) return { ok: false, motivo: "Falta o nome do utente." };
    if (!medicamento) return { ok: false, motivo: "Falta o nome do medicamento pedido em regime de AUE." };
    if (!armazenista) {
      return { ok: false, motivo: `"${armazenistaBruto || parametros.armazenista}" não é um armazenista válido — tem de ser um destes: ${AUE_ARMAZENISTAS.join(", ")}.` };
    }
    const dados = {
      nome, medicamento, armazenista,
      telefone: (parametros.telefone || "").trim(),
      nif: (parametros.nif || "").trim(),
      medico: (parametros.medico || "").trim(),
      comercial: (parametros.comercial || "").trim(),
      receita: (parametros.receita || "").trim(),
      comentarios: (parametros.comentarios || "").trim(),
    };
    const emFalta = [];
    if (!dados.telefone) emFalta.push("telefone");
    if (!dados.nif) emFalta.push("NIF");
    if (!dados.medico) emFalta.push("nome do médico");
    return {
      ok: true,
      resumo: `Criar um novo pedido de AUE: "${medicamento}" para ${nome}, a pedir ao armazenista ${armazenista}.` +
        (emFalta.length ? ` (por preencher: ${emFalta.join(", ")} — pode completar-se depois no módulo).` : ""),
      plano: { tipo: "aue.criar_pedido", dados },
    };
  }

  if (acaoId === "aue.preparar_email_armazenista") {
    const pedidos = Array.isArray(estado?.aue?.pedidos) ? estado.aue.pedidos : [];
    const candidatos = encontrarPedidosAuePorTexto(pedidos, parametros.identificarPedido);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum pedido de AUE a corresponder a "${parametros.identificarPedido}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map(p => `"${p.nome}" (${p.medicamento || "sem medicamento indicado"})`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um pedido a corresponder a "${parametros.identificarPedido}": ${nomes}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    return {
      ok: true,
      resumo: `Preparar o email de pedido de AUE ao armazenista ${alvo.armazenista || "(não definido)"} para "${alvo.medicamento || "sem medicamento indicado"}" (${alvo.nome}) — abre o teu programa de email para reveres, anexares os documentos e enviares.`,
      plano: { tipo: "aue.preparar_email_armazenista", pedidoId: alvo.id },
    };
  }

  if (acaoId === "catalogo.adicionar_produto") {
    const nome = (parametros.nome || "").trim();
    if (!nome) return { ok: false, motivo: "Falta o nome do produto a adicionar." };
    const codigo = (parametros.codigo || "").trim();
    const catalogo = Array.isArray(estado?.catalogoProdutos) ? estado.catalogoProdutos : [];
    if (codigo && catalogo.some(p => String(p?.[1]) === codigo)) {
      return { ok: false, motivo: `Já existe um produto com o código "${codigo}" no catálogo — usa a edição em vez de adicionar de novo.` };
    }
    return {
      ok: true,
      resumo: `Adicionar "${nome}"${codigo ? ` (código ${codigo})` : " (sem código indicado)"} ao catálogo de produtos.`,
      plano: { tipo: "catalogo.adicionar_produto", nome, codigo },
    };
  }

  if (acaoId === "catalogo.editar_produto") {
    const catalogo = Array.isArray(estado?.catalogoProdutos) ? estado.catalogoProdutos : [];
    const candidatos = encontrarProdutosPorTexto(catalogo, parametros.identificarProduto);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum produto a corresponder a "${parametros.identificarProduto}" no catálogo.` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.slice(0, 5).map(p => `"${p[0]}" (${p[1]})`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um produto a corresponder a "${parametros.identificarProduto}": ${nomes}${candidatos.length > 5 ? ", …" : ""}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    const novoNome = (parametros.novoNome || "").trim();
    const novoCodigo = (parametros.novoCodigo || "").trim();
    if (!novoNome && !novoCodigo) {
      return { ok: false, motivo: "Não indicaste o que mudar (nem novo nome nem novo código)." };
    }
    const partes = [];
    if (novoNome && novoNome !== alvo[0]) partes.push(`nome para "${novoNome}"`);
    if (novoCodigo && novoCodigo !== String(alvo[1])) partes.push(`código para "${novoCodigo}"`);
    if (!partes.length) {
      return { ok: false, motivo: "O novo nome/código indicado é igual ao atual — nada para alterar." };
    }
    return {
      ok: true,
      resumo: `Mudar o produto "${alvo[0]}" (${alvo[1]}): ${partes.join(", ")}.`,
      plano: {
        tipo: "catalogo.editar_produto",
        codigoAtual: String(alvo[1]),
        produtoEditado: [novoNome || alvo[0], novoCodigo || alvo[1], alvo[2]],
      },
    };
  }

  if (acaoId === "documentos.preparar_etiqueta") {
    const tipo = (parametros.tipo || "").trim().toLowerCase();
    if (!LABEL_TIPO_ETIQUETA[tipo]) {
      return { ok: false, motivo: `"${parametros.tipo}" não é um tipo de etiqueta válido (domicilio, tester ou medicamento).` };
    }
    const dados = {
      tipo,
      nome: (parametros.nome || "").trim(),
      morada: (parametros.morada || "").trim(),
      telefone: (parametros.telefone || "").trim(),
      dataEntrega: (parametros.dataEntrega || "").trim(),
      produtoTester: (parametros.produtoTester || "").trim(),
      lote: (parametros.lote || "").trim(),
      validade: (parametros.validade || "").trim(),
      produtoNome: (parametros.produtoNome || "").trim(),
      dosagem: (parametros.dosagem || "").trim(),
      posologia: (parametros.posologia || "").trim(),
      quantidade: Number.isInteger(parseInt(parametros.quantidade, 10)) && parseInt(parametros.quantidade, 10) > 0
        ? parseInt(parametros.quantidade, 10) : null,
    };
    const resumoPartes = [];
    if (tipo === "domicilio") {
      if (dados.nome) resumoPartes.push(`utente "${dados.nome}"`);
      if (dados.morada) resumoPartes.push(`morada "${dados.morada}"`);
    } else if (tipo === "tester") {
      if (dados.produtoTester) resumoPartes.push(`produto "${dados.produtoTester}"`);
    } else {
      if (dados.produtoNome) resumoPartes.push(`medicamento "${dados.produtoNome}"`);
    }
    return {
      ok: true,
      resumo: `Preparar etiqueta de ${LABEL_TIPO_ETIQUETA[tipo]}${resumoPartes.length ? ` — ${resumoPartes.join(", ")}` : ""} ` +
        `(fica pronta a rever e imprimir em Documentos → Etiquetas).`,
      plano: { tipo: "documentos.preparar_etiqueta", dados },
    };
  }

  if (acaoId === "gabinete.adicionar_item_stock") {
    const nome = (parametros.nome || "").trim();
    if (!nome) return { ok: false, motivo: "Falta o nome do produto a adicionar à Lista de Controlo." };
    const validade = (parametros.validade || "").trim();
    if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) {
      return { ok: false, motivo: `Data de validade inválida ("${validade}") — usa o formato AAAA-MM-DD.` };
    }
    const quantidade = parametros.quantidade !== undefined && parametros.quantidade !== "" && !Number.isNaN(Number(parametros.quantidade))
      ? Math.max(0, Math.trunc(Number(parametros.quantidade))) : 0;
    const quantidadeMinima = parametros.quantidadeMinima !== undefined && parametros.quantidadeMinima !== "" && !Number.isNaN(Number(parametros.quantidadeMinima))
      ? Math.max(0, Math.trunc(Number(parametros.quantidadeMinima))) : "";
    const dados = {
      nome, cnp: (parametros.cnp || "").trim(), lote: (parametros.lote || "").trim(),
      validade, quantidade, quantidadeMinima, notas: (parametros.notas || "").trim(),
    };
    return {
      ok: true,
      resumo: `Adicionar "${nome}" à Lista de Controlo do Gabinete` +
        (dados.quantidade ? `, quantidade ${dados.quantidade}` : "") +
        (dados.validade ? `, validade ${dados.validade}` : "") + ".",
      plano: { tipo: "gabinete.adicionar_item_stock", dados },
    };
  }

  if (acaoId === "gabinete.remover_item_stock") {
    const itens = Array.isArray(estado?.gabinete?.[GABINETE_CHECKLIST_ITEMS_KEY]) ? estado.gabinete[GABINETE_CHECKLIST_ITEMS_KEY] : [];
    const candidatos = encontrarItensGabinetePorTexto(itens, parametros.identificarItem);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum item ativo na Lista de Controlo/Itens do Gabinete a corresponder a "${parametros.identificarItem}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.slice(0, 5).map(it => `"${it.nome}"`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um item a corresponder a "${parametros.identificarItem}": ${nomes}${candidatos.length > 5 ? ", …" : ""}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    return {
      ok: true,
      resumo: `Remover "${alvo.nome}" da Lista de Controlo/Itens do Gabinete (fica desativado — o histórico de relatórios já guardados não é afetado).`,
      plano: { tipo: "gabinete.remover_item_stock", itemId: alvo.id, nome: alvo.nome },
    };
  }

  if (acaoId === "gabinete.atualizar_stock") {
    const itens = Array.isArray(estado?.gabinete?.[GABINETE_CHECKLIST_ITEMS_KEY]) ? estado.gabinete[GABINETE_CHECKLIST_ITEMS_KEY] : [];
    const candidatos = encontrarItensGabinetePorTexto(itens, parametros.identificarItem, { apenasStock: true });
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum produto ativo na Lista de Controlo a corresponder a "${parametros.identificarItem}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.slice(0, 5).map(it => `"${it.nome}"`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um produto a corresponder a "${parametros.identificarItem}": ${nomes}${candidatos.length > 5 ? ", …" : ""}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    const validade = (parametros.validade || "").trim();
    if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) {
      return { ok: false, motivo: `Data de validade inválida ("${validade}") — usa o formato AAAA-MM-DD.` };
    }
    const alteracoes = {};
    const partesResumo = [];
    if (parametros.quantidade !== undefined && parametros.quantidade !== "") {
      const q = Number(parametros.quantidade);
      if (Number.isNaN(q)) return { ok: false, motivo: `Quantidade inválida ("${parametros.quantidade}").` };
      alteracoes.quantidade = Math.max(0, Math.trunc(q));
      partesResumo.push(`quantidade para ${alteracoes.quantidade}`);
    }
    if (parametros.quantidadeMinima !== undefined && parametros.quantidadeMinima !== "") {
      const qm = Number(parametros.quantidadeMinima);
      if (Number.isNaN(qm)) return { ok: false, motivo: `Quantidade mínima inválida ("${parametros.quantidadeMinima}").` };
      alteracoes.quantidadeMinima = Math.max(0, Math.trunc(qm));
      partesResumo.push(`quantidade mínima para ${alteracoes.quantidadeMinima}`);
    }
    if (validade) { alteracoes.validade = validade; partesResumo.push(`validade para ${validade}`); }
    if (parametros.lote && parametros.lote.trim()) { alteracoes.lote = parametros.lote.trim(); partesResumo.push(`lote para "${alteracoes.lote}"`); }
    if (parametros.notas && parametros.notas.trim()) { alteracoes.notas = parametros.notas.trim(); partesResumo.push("notas"); }
    if (!Object.keys(alteracoes).length) {
      return { ok: false, motivo: "Não indicaste nenhuma alteração (quantidade, quantidade mínima, validade, lote ou notas)." };
    }
    return {
      ok: true,
      resumo: `Atualizar "${alvo.nome}" na Lista de Controlo: ${partesResumo.join(", ")}.`,
      plano: { tipo: "gabinete.atualizar_stock", itemId: alvo.id, alteracoes },
    };
  }

  if (acaoId === "gabinete.criar_relatorio") {
    const data = (parametros.data || "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return { ok: false, motivo: `Data inválida ("${parametros.data}") — usa o formato AAAA-MM-DD.` };
    }
    const farmaceutico = (parametros.farmaceutico || "").trim();
    return {
      ok: true,
      resumo: `Criar um novo relatório de gabinete do utente para ${data}` +
        (farmaceutico ? `, responsável ${farmaceutico}` : "") +
        `. Fica vazio, por preencher item a item no módulo — a FARMA não inventa respostas de inspeção.`,
      plano: { tipo: "gabinete.criar_relatorio", data, farmaceutico },
    };
  }

  if (acaoId === "stocks.criar_lista") {
    const nome = (parametros.nome || "").trim() || todayLabelDDMMYYYY();
    const operador = (parametros.operador || "").trim();
    return {
      ok: true,
      resumo: `Criar uma nova lista de Stocks Errados: "${nome}"${operador ? `, operador ${operador}` : ""}.`,
      plano: { tipo: "stocks.criar_lista", nome, operador },
    };
  }

  if (acaoId === "stocks.apagar_lista") {
    const listas = estado?.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
    const candidatos = encontrarListasStocksPorTexto(listas, parametros.identificarLista);
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhuma lista de Stocks Errados a corresponder a "${parametros.identificarLista}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map(l => `"${l.nome}"`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que uma lista a corresponder a "${parametros.identificarLista}": ${nomes}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    const n = (alvo.items || []).length;
    return {
      ok: true,
      resumo: `Apagar a lista de Stocks Errados "${alvo.nome}"${n ? ` (com ${n} produto${n === 1 ? "" : "s"} registados)` : ""} — ação irreversível.`,
      plano: { tipo: "stocks.apagar_lista", listaId: alvo.id, nome: alvo.nome },
    };
  }

  if (acaoId === "stocks.adicionar_produto") {
    const nome = (parametros.nome || "").trim();
    if (!nome) return { ok: false, motivo: "Falta o nome do produto a registar." };
    const listas = estado?.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
    const r = resolverListaStocksAlvo(listas, parametros.identificarLista);
    if (!r.ok) return r;
    const codigo = (parametros.codigo || "").trim();
    if (codigo && (r.lista.items || []).some(it => it.codigo === codigo)) {
      return { ok: false, motivo: `Já há um produto com o código "${codigo}" registado na lista "${r.lista.nome}".` };
    }
    const stockSistema = parametros.stockSistema !== undefined && parametros.stockSistema !== "" && !Number.isNaN(Number(parametros.stockSistema))
      ? Number(parametros.stockSistema) : "";
    const stockContado = parametros.stockContado !== undefined && parametros.stockContado !== "" && !Number.isNaN(Number(parametros.stockContado))
      ? Number(parametros.stockContado) : "";
    return {
      ok: true,
      resumo: `Registar "${nome}"${codigo ? ` (${codigo})` : ""} na lista "${r.lista.nome}"` +
        (stockSistema !== "" ? `, sistema ${stockSistema}` : "") +
        (stockContado !== "" ? `, contado ${stockContado}` : "") + ".",
      plano: { tipo: "stocks.adicionar_produto", listaId: r.lista.id, item: { codigo, designacao: nome, stockSistema, stockContado } },
    };
  }

  if (acaoId === "stocks.remover_produto") {
    const listas = estado?.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
    const r = resolverListaStocksAlvo(listas, parametros.identificarLista);
    if (!r.ok) return r;
    const alvoTexto = (parametros.identificarProduto || "").trim().toLowerCase();
    if (!alvoTexto) return { ok: false, motivo: "Falta o nome ou código do produto a remover." };
    const candidatosItem = (r.lista.items || []).filter(it =>
      (it.codigo && String(it.codigo).toLowerCase() === alvoTexto) || String(it.designacao || "").toLowerCase().includes(alvoTexto)
    );
    if (candidatosItem.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhum produto a corresponder a "${parametros.identificarProduto}" na lista "${r.lista.nome}".` };
    }
    if (candidatosItem.length > 1) {
      const nomes = candidatosItem.slice(0, 5).map(it => `"${it.designacao}"`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que um produto a corresponder a "${parametros.identificarProduto}" na lista "${r.lista.nome}": ${nomes}${candidatosItem.length > 5 ? ", …" : ""}. Sê mais específico.` };
    }
    const alvo = candidatosItem[0];
    return {
      ok: true,
      resumo: `Remover "${alvo.designacao}" da lista de Stocks Errados "${r.lista.nome}".`,
      plano: { tipo: "stocks.remover_produto", listaId: r.lista.id, codigo: alvo.codigo || "", designacao: alvo.designacao },
    };
  }

  if (acaoId === "listas.criar_lista") {
    const nome = (parametros.nome || "").trim() || "Sessão de Minifaciais";
    const tipoBruto = (parametros.tipo || "").trim().toLowerCase();
    const tipo = ["minifaciais", "formacao", "outro"].includes(tipoBruto) ? tipoBruto : "minifaciais";
    const data = (parametros.data || "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return { ok: false, motivo: `Data inválida ("${parametros.data}") — usa o formato AAAA-MM-DD.` };
    }
    const inicio = /^\d{2}:\d{2}$/.test((parametros.inicio || "").trim()) ? parametros.inicio.trim() : "09:00";
    const fim = /^\d{2}:\d{2}$/.test((parametros.fim || "").trim()) ? parametros.fim.trim() : "13:00";
    const duracaoNum = parseInt(parametros.duracao, 10);
    const duracao = Number.isInteger(duracaoNum) && duracaoNum > 0 ? duracaoNum : 20;
    const [hIni, mIni] = inicio.split(":").map(Number);
    const [hFim, mFim] = fim.split(":").map(Number);
    if (hIni * 60 + mIni >= hFim * 60 + mFim) {
      return { ok: false, motivo: `A hora de início (${inicio}) tem de ser antes da hora de fim (${fim}).` };
    }
    const numSlots = Math.floor((hFim * 60 + mFim - (hIni * 60 + mIni)) / duracao);
    const responsavel = (parametros.responsavel || "").trim();
    const responsavelContacto = (parametros.responsavelContacto || "").trim();
    return {
      ok: true,
      resumo: `Criar uma nova lista de inscrição "${nome}" (${LISTA_TIPO_LABEL_FARMA[tipo]}) para ${data}, ${inicio}–${fim}, sessões de ${duracao} min (${numSlots} horários)` +
        (responsavel ? `, responsável ${responsavel}` : "") + ".",
      plano: { tipo: "listas.criar_lista", dados: { tipo, nome, data, inicio, fim, duracao, responsavel, responsavelContacto } },
    };
  }

  if (acaoId === "listas.apagar_lista") {
    const listas = estado?.documentos?.[DOCUMENTOS_LISTAS_KEY] && typeof estado.documentos[DOCUMENTOS_LISTAS_KEY] === "object" ? estado.documentos[DOCUMENTOS_LISTAS_KEY] : {};
    const r = resolverListaInscricaoAlvo(listas, parametros.identificarLista);
    if (!r.ok) return r;
    const inscritos = (r.lista.slots || []).filter(s => s.utente && s.utente.trim()).length;
    return {
      ok: true,
      resumo: `Apagar a lista de inscrição "${r.lista.nome}"${inscritos ? ` (com ${inscritos} inscri${inscritos === 1 ? "ção já registada" : "ções já registadas"})` : ""} — ação irreversível.`,
      plano: { tipo: "listas.apagar_lista", listaId: r.lista.id, nome: r.lista.nome },
    };
  }

  if (acaoId === "listas.inscrever") {
    const nome = (parametros.nome || "").trim();
    if (!nome) return { ok: false, motivo: "Falta o nome do utente a inscrever." };
    const listas = estado?.documentos?.[DOCUMENTOS_LISTAS_KEY] && typeof estado.documentos[DOCUMENTOS_LISTAS_KEY] === "object" ? estado.documentos[DOCUMENTOS_LISTAS_KEY] : {};
    const r = resolverListaInscricaoAlvo(listas, parametros.identificarLista);
    if (!r.ok) return r;
    const livres = (r.lista.slots || []).filter(s => !s.bloqueado && !(s.utente && s.utente.trim()));
    if (livres.length === 0) {
      return { ok: false, motivo: `Não há horários livres na lista "${r.lista.nome}" — todos os horários já estão ocupados ou bloqueados.` };
    }
    const horarioBruto = (parametros.horario || "").trim();
    if (!horarioBruto) {
      const opcoes = livres.map(s => s.horario).join(", ");
      return { ok: false, motivo: `A lista "${r.lista.nome}" tem estes horários livres: ${opcoes}. Diz qual queres usar para ${nome}.` };
    }
    const alvoSlot = livres.find(s =>
      s.horario === horarioBruto ||
      s.horario.toLowerCase().replace(/\s+/g, "") === horarioBruto.toLowerCase().replace(/\s+/g, "") ||
      s.horario.split(/[–-]/)[0].trim() === horarioBruto
    );
    if (!alvoSlot) {
      const opcoes = livres.map(s => s.horario).join(", ");
      return { ok: false, motivo: `"${horarioBruto}" não é um horário livre na lista "${r.lista.nome}". Horários livres: ${opcoes}.` };
    }
    return {
      ok: true,
      resumo: `Inscrever "${nome}" na lista "${r.lista.nome}", horário ${alvoSlot.horario}.`,
      plano: { tipo: "listas.inscrever", listaId: r.lista.id, slotId: alvoSlot.id, dados: { utente: nome, contacto: (parametros.contacto || "").trim(), obs: (parametros.obs || "").trim() } },
    };
  }

  if (acaoId === "listas.remover_inscricao") {
    const listas = estado?.documentos?.[DOCUMENTOS_LISTAS_KEY] && typeof estado.documentos[DOCUMENTOS_LISTAS_KEY] === "object" ? estado.documentos[DOCUMENTOS_LISTAS_KEY] : {};
    const r = resolverListaInscricaoAlvo(listas, parametros.identificarLista);
    if (!r.ok) return r;
    const alvoTexto = (parametros.identificarUtente || "").trim().toLowerCase();
    if (!alvoTexto) return { ok: false, motivo: "Falta o nome do utente cuja inscrição remover." };
    const candidatos = (r.lista.slots || []).filter(s => s.utente && s.utente.trim().toLowerCase().includes(alvoTexto));
    if (candidatos.length === 0) {
      return { ok: false, motivo: `Não encontrei nenhuma inscrição a corresponder a "${parametros.identificarUtente}" na lista "${r.lista.nome}".` };
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map(s => `"${s.utente}" (${s.horario})`).join(", ");
      return { ok: false, motivo: `Encontrei mais do que uma inscrição a corresponder a "${parametros.identificarUtente}" na lista "${r.lista.nome}": ${nomes}. Sê mais específico.` };
    }
    const alvo = candidatos[0];
    return {
      ok: true,
      resumo: `Remover a inscrição de "${alvo.utente}" (horário ${alvo.horario}) da lista "${r.lista.nome}" — o horário volta a ficar livre.`,
      plano: { tipo: "listas.remover_inscricao", listaId: r.lista.id, slotId: alvo.id, utente: alvo.utente },
    };
  }

  return { ok: false, motivo: `Não sei ainda executar a ação "${acaoId}".` };
}

/**
 * Executa um plano já preparado (`prepararAcao`) e CONFIRMADO pelo operador.
 * `ctx` traz o necessário para I/O: `{ dataStore, registarUso }`.
 * Devolve uma mensagem pronta a mostrar, nunca lança — falhas de rede viram
 * uma mensagem de erro clara, como o resto da FARMA IA.
 */
export async function executarAcaoConfirmada(plano, ctx) {
  if (plano.tipo === "manipulados.mudar_estado") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const pedidos = Array.isArray(estado.manipulados) ? estado.manipulados : [];
      const r = mudarEstadoPedido(pedidos, plano.pedidoId, plano.novoEstado);
      if (!r.ok) return { ok: false, mensagem: r.motivo };
      // config.logo omitido de propósito antes de reenviar (mesmo cuidado do
      // resto da app — ver manipulados.html/gravarManipulados, ponto 15).
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, manipulados: r.pedidos });
      if (r.tarefa && ctx.registarUso) ctx.registarUso("manipulados", r.tarefa);
      const rotulo = STATUS_MANIPULADOS[plano.novoEstado]?.label || plano.novoEstado;
      return { ok: true, mensagem: `Feito — pedido atualizado para "${rotulo}".` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível gravar a alteração agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "manipulados.criar_pedido") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const pedidos = Array.isArray(estado.manipulados) ? estado.manipulados : [];
      const novoPedido = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        criado: new Date().toISOString().slice(0, 10),
        nome: plano.dados.nome, medicamento: plano.dados.medicamento,
        tipoPrescricao: plano.dados.tipoPrescricao, animal: plano.dados.animal,
        telefone: plano.dados.telefone, nif: plano.dados.nif, receita: plano.dados.receita,
        operador: "FARMA (assistente)", sifarma: "", canal: "", email: "",
        acesso: "", opcao: "", data: "", anexos: [], comentarios: plano.dados.comentarios,
        status: "pendente_utente",
      };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, manipulados: [novoPedido, ...pedidos] });
      if (ctx.registarUso) ctx.registarUso("manipulados", "criar_pedido");
      return {
        ok: true,
        mensagem: `Feito — pedido criado para "${plano.dados.nome}" (${plano.dados.medicamento}). Se quiseres, diz "farma prepara o email do orçamento deste pedido" para eu deixar o email pronto a enviar.`,
      };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível criar o pedido agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "manipulados.preparar_email_orcamento") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const pedidos = Array.isArray(estado.manipulados) ? estado.manipulados : [];
      const pedido = pedidos.find(p => p.id === plano.pedidoId);
      if (!pedido) return { ok: false, mensagem: "Esse pedido já não existe — pode ter sido removido entretanto." };
      const nomeFarmacia = estado.config?.nomeFarmacia || "Farmácia";
      const destino = ctx.emailDestinoOrcamento || "";
      const conteudo = construirConteudoEmailOrcamento(pedido, nomeFarmacia, destino);
      if (ctx.registarUso) ctx.registarUso("manipulados", "enviar_orcamento");
      return {
        ok: true,
        mensagem: destino
          ? "Email preparado — deve abrir já o teu programa de email para reveres e enviares."
          : "Email preparado, mas não há nenhum email predefinido para os pedidos de orçamento — indica o destinatário antes de enviar (o teu programa de email deve abrir já com o resto preenchido).",
        abrirEmail: conteudo,
      };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível preparar o email agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "aue.criar_pedido") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const pedidosAtuais = Array.isArray(estado.aue?.pedidos) ? estado.aue.pedidos : [];
      const novoPedido = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        criado: new Date().toISOString().slice(0, 10),
        deleted: false, updatedAt: Date.now(),
        nome: plano.dados.nome, medicamento: plano.dados.medicamento, armazenista: plano.dados.armazenista,
        telefone: plano.dados.telefone, nif: plano.dados.nif, medico: plano.dados.medico,
        comercial: plano.dados.comercial, receita: plano.dados.receita, comentarios: plano.dados.comentarios,
        operador: "FARMA (assistente)", canal: "", email: "", medicoContacto: "", instituicao: "",
        codigoAcesso: "", codigoOpcao: "", registoAue: "", preco: "", data: "",
        docs: { receita: null, declaracao: null, formulario: null },
        status: "pendente_docs",
      };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({
        ...estado, config: configSemLogo,
        aue: { ...(estado.aue || {}), pedidos: [novoPedido, ...pedidosAtuais] },
      });
      if (ctx.registarUso) ctx.registarUso("aue", "criar_pedido");
      return {
        ok: true,
        mensagem: `Feito — pedido de AUE criado para "${plano.dados.nome}" (${plano.dados.medicamento}), a pedir ao armazenista ${plano.dados.armazenista}. Ainda faltam os 3 documentos obrigatórios (receita, declaração de inexistência de alternativa terapêutica, formulário de aquisição) — anexa-os no módulo antes de enviar. Se quiseres, diz "farma prepara o email do armazenista deste pedido" para eu deixar o email pronto.`,
      };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível criar o pedido de AUE agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "aue.preparar_email_armazenista") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const pedidos = Array.isArray(estado.aue?.pedidos) ? estado.aue.pedidos : [];
      const pedido = pedidos.find(p => p.id === plano.pedidoId);
      if (!pedido) return { ok: false, mensagem: "Esse pedido já não existe — pode ter sido removido entretanto." };
      const nomeFarmacia = estado.config?.nomeFarmacia || "Farmácia";
      const contacto = (ctx.contactosArmazenista && ctx.contactosArmazenista[pedido.armazenista]) || { to: "", cc: "" };
      const conteudo = construirConteudoEmailArmazenista(pedido, nomeFarmacia, contacto.to, contacto.cc);
      if (ctx.registarUso) ctx.registarUso("aue", "enviar_email_armazenista");
      const avisoDocumentos = " Lembra-te de anexar os 3 documentos obrigatórios manualmente — o email não os inclui automaticamente (só o módulo o faz, quando já estão juntos ao pedido).";
      return {
        ok: true,
        mensagem: (contacto.to
          ? "Email preparado — deve abrir já o teu programa de email para reveres e enviares."
          : `Email preparado, mas não há nenhum contacto predefinido para "${pedido.armazenista}" — indica o destinatário antes de enviar (o teu programa de email deve abrir já com o resto preenchido).`) + avisoDocumentos,
        abrirEmail: conteudo,
      };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível preparar o email agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "catalogo.adicionar_produto") {
    try {
      const r = await adicionarProdutos(ctx.dataStore, [[plano.nome, plano.codigo, 4]]);
      if (r.ignorados && r.ignorados.length) {
        return { ok: false, mensagem: "Não adicionei — já existe um produto com esse código no catálogo." };
      }
      if (ctx.registarUso) ctx.registarUso("catalogo-produtos", "adicionar_produto");
      return { ok: true, mensagem: `Feito — "${plano.nome}" adicionado ao catálogo de produtos.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível gravar o produto novo agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "catalogo.editar_produto") {
    try {
      await editarProduto(ctx.dataStore, plano.codigoAtual, plano.produtoEditado);
      if (ctx.registarUso) ctx.registarUso("catalogo-produtos", "editar_produto");
      return { ok: true, mensagem: `Feito — produto atualizado para "${plano.produtoEditado[0]}".` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível gravar a alteração ao produto agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "documentos.preparar_etiqueta") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      configSemLogo.farmaEtiquetaPendente = plano.dados;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo });
      if (ctx.registarUso) ctx.registarUso("documentos", "gerar_etiqueta");
      return { ok: true, mensagem: "Feito — rótulo preparado. Abra Documentos → Etiquetas para rever e imprimir." };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível preparar o rótulo agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "gabinete.adicionar_item_stock") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const gab = estado.gabinete || {};
      const itensAtuais = Array.isArray(gab[GABINETE_CHECKLIST_ITEMS_KEY]) ? gab[GABINETE_CHECKLIST_ITEMS_KEY] : [];
      const seccoesAtuais = Array.isArray(gab[GABINETE_CHECKLIST_SECTIONS_KEY]) ? gab[GABINETE_CHECKLIST_SECTIONS_KEY] : [];
      // Mesma secção "avulso" usada por submitStockForm() em gabinete.html
      // (ensureSeccaoAvulso) — criada só se ainda não existir, para os
      // produtos adicionados pela FARMA aparecerem no mesmo sítio que os
      // adicionados manualmente pela Lista de Controlo sem secção própria.
      let seccaoAvulso = seccoesAtuais.find(s => s.id === "controlo-avulso");
      const seccoesNovas = seccaoAvulso ? seccoesAtuais : [
        ...seccoesAtuais,
        { id: "controlo-avulso", titulo: "Lista de Controlo (produtos avulsos)", desc: "Produtos de stock sem secção fixa, migrados automaticamente da antiga Lista de Controlo.", ordem: seccoesAtuais.length },
      ];
      if (!seccaoAvulso) seccaoAvulso = seccoesNovas[seccoesNovas.length - 1];
      const ordem = itensAtuais.filter(it => it.sectionId === seccaoAvulso.id).length;
      const novoItem = {
        id: "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
        sectionId: seccaoAvulso.id, nome: plano.dados.nome, sub: "", cnp: plano.dados.cnp || "", qr: "",
        qv: true, dateOnly: false, options: ["PEDIR"], ativo: true,
        pc: "", sn: "", lote: plano.dados.lote || "",
        validade: plano.dados.validade || "", quantidade: plano.dados.quantidade,
        quantidadeMinima: plano.dados.quantidadeMinima, notas: plano.dados.notas || "",
        ordem, criadoEm: new Date().toISOString(),
      };
      const novoGabinete = { ...gab, [GABINETE_CHECKLIST_SECTIONS_KEY]: seccoesNovas, [GABINETE_CHECKLIST_ITEMS_KEY]: [...itensAtuais, novoItem] };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, gabinete: novoGabinete });
      if (ctx.registarUso) ctx.registarUso("gabinete", "atualizar_stock");
      return { ok: true, mensagem: `Feito — "${plano.dados.nome}" adicionado à Lista de Controlo do Gabinete.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível adicionar o produto agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "gabinete.remover_item_stock") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const gab = estado.gabinete || {};
      const itensAtuais = Array.isArray(gab[GABINETE_CHECKLIST_ITEMS_KEY]) ? gab[GABINETE_CHECKLIST_ITEMS_KEY] : [];
      const idx = itensAtuais.findIndex(it => it.id === plano.itemId);
      if (idx === -1) return { ok: false, mensagem: "Esse item já não existe — pode ter sido removido entretanto." };
      const itensNovos = itensAtuais.slice();
      itensNovos[idx] = { ...itensNovos[idx], ativo: false };
      const novoGabinete = { ...gab, [GABINETE_CHECKLIST_ITEMS_KEY]: itensNovos };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, gabinete: novoGabinete });
      if (ctx.registarUso) ctx.registarUso("gabinete", "remover_stock");
      return { ok: true, mensagem: `Feito — "${plano.nome}" removido (desativado) da Lista de Controlo/Itens do Gabinete.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível remover o item agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "gabinete.atualizar_stock") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const gab = estado.gabinete || {};
      const itensAtuais = Array.isArray(gab[GABINETE_CHECKLIST_ITEMS_KEY]) ? gab[GABINETE_CHECKLIST_ITEMS_KEY] : [];
      const idx = itensAtuais.findIndex(it => it.id === plano.itemId);
      if (idx === -1) return { ok: false, mensagem: "Esse produto já não existe — pode ter sido removido entretanto." };
      const itensNovos = itensAtuais.slice();
      itensNovos[idx] = { ...itensNovos[idx], ...plano.alteracoes };
      const novoGabinete = { ...gab, [GABINETE_CHECKLIST_ITEMS_KEY]: itensNovos };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, gabinete: novoGabinete });
      if (ctx.registarUso) ctx.registarUso("gabinete", "atualizar_stock");
      return { ok: true, mensagem: `Feito — "${itensNovos[idx].nome}" atualizado na Lista de Controlo.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível gravar a alteração agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "gabinete.criar_relatorio") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const gab = estado.gabinete || {};
      const seccoes = (Array.isArray(gab[GABINETE_CHECKLIST_SECTIONS_KEY]) ? gab[GABINETE_CHECKLIST_SECTIONS_KEY] : [])
        .slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      const itens = Array.isArray(gab[GABINETE_CHECKLIST_ITEMS_KEY]) ? gab[GABINETE_CHECKLIST_ITEMS_KEY] : [];
      // Mesmo formato de `buildActiveStructureSnapshot()` em gabinete.html —
      // uma "fotografia" da estrutura ativa no momento da criação, para o
      // relatório continuar consistente mesmo que a checklist mude depois.
      const estrutura = seccoes.map(sec => ({
        id: sec.id, titulo: sec.titulo, desc: sec.desc,
        items: itens.filter(it => it.sectionId === sec.id && it.ativo !== false)
          .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
          .map(it => ({ id: it.id, nome: it.nome, sub: it.sub || "", options: (it.options || []).slice(), qv: !!it.qv, dateOnly: !!it.dateOnly, qr: it.qr || "", cnp: it.cnp || "" })),
      }));
      const novoRelatorio = {
        id: "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
        data: plano.data, farmaceutico: plano.farmaceutico, respostas: {},
        criadoEm: new Date().toISOString(), estrutura,
      };
      const relatoriosAtuais = Array.isArray(gab[GABINETE_REPORTS_KEY]) ? gab[GABINETE_REPORTS_KEY] : [];
      const novoGabinete = { ...gab, [GABINETE_REPORTS_KEY]: [novoRelatorio, ...relatoriosAtuais] };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, gabinete: novoGabinete });
      if (ctx.registarUso) ctx.registarUso("gabinete", "criar_relatorio");
      return {
        ok: true,
        mensagem: `Feito — relatório de gabinete criado para ${plano.data}` +
          (plano.farmaceutico ? `, responsável ${plano.farmaceutico}` : "") +
          `. Está vazio — abre Gestão de Gabinete → Relatórios para preencheres as respostas de cada item.`,
      };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível criar o relatório agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "stocks.criar_lista") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const listasAtuais = estado.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
      const id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const agora = new Date().toISOString();
      const novaLista = { id, nome: plano.nome, operador: plano.operador, criadoEm: agora, atualizadoEm: agora, items: [] };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, stocksErrados: { ...listasAtuais, [id]: novaLista } });
      if (ctx.registarUso) ctx.registarUso("stocks", "criar_lista");
      return { ok: true, mensagem: `Feito — lista de Stocks Errados "${plano.nome}" criada.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível criar a lista agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "stocks.apagar_lista") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const listasAtuais = estado.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
      if (!listasAtuais[plano.listaId]) return { ok: false, mensagem: "Essa lista já não existe — pode ter sido apagada entretanto." };
      const listasNovas = { ...listasAtuais };
      delete listasNovas[plano.listaId];
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, stocksErrados: listasNovas });
      if (ctx.registarUso) ctx.registarUso("stocks", "apagar_lista");
      return { ok: true, mensagem: `Feito — lista "${plano.nome}" apagada.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível apagar a lista agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "stocks.adicionar_produto") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const listasAtuais = estado.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
      const lista = listasAtuais[plano.listaId];
      if (!lista) return { ok: false, mensagem: "Essa lista já não existe — pode ter sido apagada entretanto." };
      if (plano.item.codigo && (lista.items || []).some(it => it.codigo === plano.item.codigo)) {
        return { ok: false, mensagem: "Esse produto já está registado nessa lista." };
      }
      const novoItem = {
        codigo: plano.item.codigo || "", designacao: plano.item.designacao, fam: null,
        stockSistema: plano.item.stockSistema, stockContado: plano.item.stockContado,
        motivo: "", motivoOutros: "", manual: true,
      };
      const agora = new Date().toISOString();
      const listaAtualizada = { ...lista, items: [novoItem, ...(lista.items || [])], atualizadoEm: agora };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, stocksErrados: { ...listasAtuais, [plano.listaId]: listaAtualizada } });
      if (ctx.registarUso) ctx.registarUso("stocks", "registar_item");
      return { ok: true, mensagem: `Feito — "${plano.item.designacao}" registado na lista.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível registar o produto agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "stocks.remover_produto") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const listasAtuais = estado.stocksErrados && typeof estado.stocksErrados === "object" ? estado.stocksErrados : {};
      const lista = listasAtuais[plano.listaId];
      if (!lista) return { ok: false, mensagem: "Essa lista já não existe — pode ter sido apagada entretanto." };
      const itens = lista.items || [];
      const idx = itens.findIndex(it => plano.codigo ? it.codigo === plano.codigo : it.designacao === plano.designacao);
      if (idx === -1) return { ok: false, mensagem: "Esse produto já não está nessa lista — pode ter sido removido entretanto." };
      const itensNovos = itens.slice();
      itensNovos.splice(idx, 1);
      const agora = new Date().toISOString();
      const listaAtualizada = { ...lista, items: itensNovos, atualizadoEm: agora };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({ ...estado, config: configSemLogo, stocksErrados: { ...listasAtuais, [plano.listaId]: listaAtualizada } });
      if (ctx.registarUso) ctx.registarUso("stocks", "remover_item");
      return { ok: true, mensagem: `Feito — "${plano.designacao}" removido da lista.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível remover o produto agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "listas.criar_lista") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const documentosAtuais = estado.documentos && typeof estado.documentos === "object" ? estado.documentos : {};
      const listasAtuais = documentosAtuais[DOCUMENTOS_LISTAS_KEY] && typeof documentosAtuais[DOCUMENTOS_LISTAS_KEY] === "object" ? documentosAtuais[DOCUMENTOS_LISTAS_KEY] : {};
      const slots = gerarSlotsInscricao(plano.dados.inicio, plano.dados.fim, plano.dados.duracao);
      const id = "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      const novaLista = {
        id, tipo: plano.dados.tipo, nome: plano.dados.nome, data: plano.dados.data,
        inicio: plano.dados.inicio, fim: plano.dados.fim, duracao: plano.dados.duracao,
        responsavel: plano.dados.responsavel, responsavelContacto: plano.dados.responsavelContacto,
        slots, createdAt: new Date().toISOString(),
      };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({
        ...estado, config: configSemLogo,
        documentos: { ...documentosAtuais, [DOCUMENTOS_LISTAS_KEY]: { ...listasAtuais, [id]: novaLista } },
      });
      if (ctx.registarUso) ctx.registarUso("documentos", "gerar_lista_inscricao");
      return { ok: true, mensagem: `Feito — lista de inscrição "${plano.dados.nome}" criada, com ${slots.length} horários.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível criar a lista agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "listas.apagar_lista") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const documentosAtuais = estado.documentos && typeof estado.documentos === "object" ? estado.documentos : {};
      const listasAtuais = documentosAtuais[DOCUMENTOS_LISTAS_KEY] && typeof documentosAtuais[DOCUMENTOS_LISTAS_KEY] === "object" ? documentosAtuais[DOCUMENTOS_LISTAS_KEY] : {};
      if (!listasAtuais[plano.listaId]) return { ok: false, mensagem: "Essa lista já não existe — pode ter sido apagada entretanto." };
      const listasNovas = { ...listasAtuais };
      delete listasNovas[plano.listaId];
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({
        ...estado, config: configSemLogo,
        documentos: { ...documentosAtuais, [DOCUMENTOS_LISTAS_KEY]: listasNovas },
      });
      if (ctx.registarUso) ctx.registarUso("documentos", "eliminar_lista_inscricao");
      return { ok: true, mensagem: `Feito — lista "${plano.nome}" apagada.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível apagar a lista agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "listas.inscrever") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const documentosAtuais = estado.documentos && typeof estado.documentos === "object" ? estado.documentos : {};
      const listasAtuais = documentosAtuais[DOCUMENTOS_LISTAS_KEY] && typeof documentosAtuais[DOCUMENTOS_LISTAS_KEY] === "object" ? documentosAtuais[DOCUMENTOS_LISTAS_KEY] : {};
      const lista = listasAtuais[plano.listaId];
      if (!lista) return { ok: false, mensagem: "Essa lista já não existe — pode ter sido apagada entretanto." };
      const slots = lista.slots || [];
      const idx = slots.findIndex(s => s.id === plano.slotId);
      if (idx === -1) return { ok: false, mensagem: "Esse horário já não existe nessa lista." };
      if (slots[idx].bloqueado || (slots[idx].utente && slots[idx].utente.trim())) {
        return { ok: false, mensagem: "Esse horário já foi ocupado ou bloqueado entretanto — escolhe outro." };
      }
      const slotsNovos = slots.slice();
      slotsNovos[idx] = { ...slotsNovos[idx], utente: plano.dados.utente, contacto: plano.dados.contacto, obs: plano.dados.obs };
      const listaAtualizada = { ...lista, slots: slotsNovos };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({
        ...estado, config: configSemLogo,
        documentos: { ...documentosAtuais, [DOCUMENTOS_LISTAS_KEY]: { ...listasAtuais, [plano.listaId]: listaAtualizada } },
      });
      // Sem registarUso aqui de propósito: isto espelha updateSlot() em
      // modulos/documentos.html, que também não regista nenhuma tarefa —
      // inventar uma seria estatística não comparável com o resto do módulo.
      return { ok: true, mensagem: `Feito — "${plano.dados.utente}" inscrito na lista "${lista.nome}", horário ${slots[idx].horario}.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível inscrever agora. Tenta novamente." };
    }
  }

  if (plano.tipo === "listas.remover_inscricao") {
    try {
      const estado = await ctx.dataStore.getEstadoCompleto();
      const documentosAtuais = estado.documentos && typeof estado.documentos === "object" ? estado.documentos : {};
      const listasAtuais = documentosAtuais[DOCUMENTOS_LISTAS_KEY] && typeof documentosAtuais[DOCUMENTOS_LISTAS_KEY] === "object" ? documentosAtuais[DOCUMENTOS_LISTAS_KEY] : {};
      const lista = listasAtuais[plano.listaId];
      if (!lista) return { ok: false, mensagem: "Essa lista já não existe — pode ter sido apagada entretanto." };
      const slots = lista.slots || [];
      const idx = slots.findIndex(s => s.id === plano.slotId);
      if (idx === -1) return { ok: false, mensagem: "Esse horário já não existe nessa lista." };
      if (!slots[idx].utente || !slots[idx].utente.trim()) {
        return { ok: false, mensagem: "Esse horário já não tinha ninguém inscrito — pode já ter sido removido entretanto." };
      }
      const slotsNovos = slots.slice();
      slotsNovos[idx] = { ...slotsNovos[idx], utente: "", contacto: "", obs: "" };
      const listaAtualizada = { ...lista, slots: slotsNovos };
      const configSemLogo = { ...(estado.config || {}) };
      delete configSemLogo.logo;
      await ctx.dataStore.gravarEstadoCompleto({
        ...estado, config: configSemLogo,
        documentos: { ...documentosAtuais, [DOCUMENTOS_LISTAS_KEY]: { ...listasAtuais, [plano.listaId]: listaAtualizada } },
      });
      return { ok: true, mensagem: `Feito — a inscrição de "${plano.utente}" foi removida; o horário ${slots[idx].horario} volta a ficar livre.` };
    } catch (e) {
      return { ok: false, mensagem: "Não foi possível remover a inscrição agora. Tenta novamente." };
    }
  }

  return { ok: false, mensagem: "Ação desconhecida." };
}

/**
 * Ponto 41 — "raciocínio em vários passos". Pedido do Ivo: "quero que a
 * FARMA aprenda a pensar". Primeira peça de um plano maior documentado em
 * arquitetura-decisoes.md (ponto 41) — esta é a parte que dava para construir
 * já, sem depender de treinar nada nem de nenhuma infraestrutura nova.
 *
 * Até aqui (pontos 30-40), uma pergunta ao "cérebro" local (WebLLM) era
 * sempre um único disparo: pergunta -> resposta -> se `prepararAcao` recusar
 * (lista ambígua, falta um parâmetro, etc.), a FARMA desistia e mostrava o
 * motivo da recusa ao operador, mesmo quando esse motivo era claramente
 * corrigível pelo PRÓPRIO modelo (ex.: "há 2 listas, sê mais específico" —
 * informação que o modelo podia perfeitamente usar para tentar de novo,
 * sozinho, sem incomodar o operador).
 *
 * `resolverComRaciocinio` corrige isto com um ciclo "pensar -> agir ->
 * observar -> pensar melhor", ao estilo de como uma pessoa corrige um pedido
 * mal formulado a um colega: quando `prepararAcao` recusa, o motivo da
 * recusa é devolvido ao modelo como se fosse uma nova mensagem do operador
 * (`construirMensagemAutoCorrecao`), e o modelo tenta de novo — até
 * `maxTentativas` vezes. Só ao fim dessas tentativas é que a FARMA desiste e
 * mostra o motivo ao operador, exatamente como antes.
 *
 * Testável sem um motor WebLLM real: `perguntarFn(pergunta, historico)` é
 * injetado por quem chama — em produção é
 * `(pergunta, historico) => perguntarAoCerebro(cerebroEngine, promptSistema, pergunta, historico)`
 * (ver `modulos/farma-ia.html`); nos testes, uma função falsa que devolve
 * respostas predefinidas em sequência.
 *
 * As tentativas de auto-correção ficam de fora do histórico de conversa de
 * longo prazo que a página mantém entre perguntas (`historicoConversaLLM`)
 * — só a pergunta original e a resposta final (`brutoFinal`) é que lá
 * entram, tal como acontecia antes desta peça. Um modelo local pequeno tem
 * uma janela de contexto reduzida (ver ponto 32); encher essa janela com o
 * "rascunho" de tentativas falhadas gastaria espaço precioso sem valor para
 * as perguntas seguintes do operador.
 *
 * @param {string} pergunta - pergunta original do operador.
 * @param {object} opts
 * @param {(pergunta:string, historico:Array) => Promise<string>} opts.perguntarFn
 * @param {Array} [opts.historico] - histórico de conversa já existente (ponto 32).
 * @param {object} opts.estado
 * @param {(acaoId:string, estado:object) => Promise<object>} [opts.carregarEstadoParaAcao] -
 *   para ações que precisam de dados fora de `estado` (ex.: catálogo de produtos).
 * @param {number} [opts.maxTentativas=3]
 * @param {(tentativa:number, maxTentativas:number) => void} [opts.onTentativa] -
 *   chamado antes de cada pedido ao modelo (inclui a 1ª tentativa), para a UI
 *   poder mostrar "a pensar melhor…" só a partir da 2ª.
 * @returns {Promise<
 *   {tipo:"acao", resumo:string, plano:object, brutoFinal:string, tentativas:number} |
 *   {tipo:"resposta", texto:string, brutoFinal:string, tentativas:number} |
 *   {tipo:"invalido", motivo:string, brutoFinal:string, tentativas:number}
 * >}
 */
export function construirMensagemAutoCorrecao(motivo) {
  return `Isso não resultou: ${motivo} Tenta de novo com um "acaoId"/"parametros" ajustados de acordo com o que falta, ` +
    `ou usa {"tipo":"resposta",...} se não for mesmo possível.`;
}

const MENSAGEM_FORMATO_INVALIDO =
  'Não respondeste no formato esperado — responde SEMPRE com um único objeto JSON, ' +
  '{"tipo":"acao",...} ou {"tipo":"resposta",...}, sem texto antes ou depois.';

export async function resolverComRaciocinio(pergunta, opts) {
  const {
    perguntarFn, historico = [], estado, carregarEstadoParaAcao,
    maxTentativas = 3, onTentativa,
  } = opts;
  // Cresce a cada tentativa falhada (pergunta enviada + resposta bruta do
  // modelo), para a tentativa seguinte ver o pedido original E a sua própria
  // resposta anterior — sem isto, o modelo "esquecia-se" do que tinha
  // proposto mal assim que via só a mensagem de correção, e não conseguia
  // corrigir-se a sério (só adivinhar de novo às cegas).
  let historicoInterno = historico.slice();
  let perguntaAtual = pergunta;
  let brutoFinal = "";
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    if (onTentativa) onTentativa(tentativa, maxTentativas);
    const bruto = await perguntarFn(perguntaAtual, historicoInterno);
    brutoFinal = bruto;
    const interpretado = interpretarRespostaLLM(bruto);

    if (interpretado.tipo === "resposta") {
      return { tipo: "resposta", texto: interpretado.texto, brutoFinal, tentativas: tentativa };
    }

    if (interpretado.tipo === "acao") {
      const estadoParaAcao = carregarEstadoParaAcao ? await carregarEstadoParaAcao(interpretado.acaoId, estado) : estado;
      const plano = prepararAcao(interpretado.acaoId, interpretado.parametros, estadoParaAcao);
      if (plano.ok) {
        return { tipo: "acao", resumo: plano.resumo, plano: plano.plano, brutoFinal, tentativas: tentativa };
      }
      if (tentativa < maxTentativas) {
        historicoInterno = [...historicoInterno, { role: "user", content: perguntaAtual }, { role: "assistant", content: bruto }];
        perguntaAtual = construirMensagemAutoCorrecao(plano.motivo);
        continue;
      }
      return { tipo: "resposta", texto: plano.motivo, brutoFinal, tentativas: tentativa };
    }

    // "invalido" — o modelo não devolveu JSON reconhecível.
    if (tentativa < maxTentativas) {
      historicoInterno = [...historicoInterno, { role: "user", content: perguntaAtual }, { role: "assistant", content: bruto }];
      perguntaAtual = MENSAGEM_FORMATO_INVALIDO;
      continue;
    }
    return { tipo: "invalido", motivo: interpretado.motivo, brutoFinal, tentativas: tentativa };
  }
}
