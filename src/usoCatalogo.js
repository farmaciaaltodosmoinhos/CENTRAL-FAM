/**
 * src/usoCatalogo.js — catálogo de "tarefas" rastreáveis para o módulo de
 * Poupança & ROI (ver src/ui/poupanca.js).
 *
 * Cada entrada representa uma tarefa concreta que um módulo/ferramenta da
 * Central regista sempre que é concluída (ver `window.ModuleChrome.registarUso`
 * em assets/module-chrome.js, chamado a partir de cada módulo). Para cada
 * tarefa guardamos duas estimativas de tempo, em segundos:
 *
 *   - tempoManualSeg   — quanto tempo a mesma tarefa levaria feita à mão,
 *                         sem a Central (o "antes").
 *   - tempoCentralSeg  — quanto tempo leva feita através da Central (o
 *                         "depois").
 *
 * A diferença é o tempo poupado por cada ocorrência. Estas são estimativas
 * de referência, propositadamente conservadoras e explicáveis a uma farmácia
 * — não medições cronometradas. Podem ser ajustadas por farmácia em
 * Configurações → Poupança & ROI (guardadas em `config.usoEstimativas`,
 * como overrides parciais sobre este catálogo — ver `estimativaEfetiva`).
 *
 * A chave de uma tarefa é sempre `${modulo}.${tarefaId}` (ver `chaveTarefa`).
 * `modulo` usa sempre o mesmo id que já existe em `MODULOS_ATALHOS`
 * (src/domain.js), para que o catálogo, os atalhos e os separadores da
 * navegação estejam sempre alinhados.
 */

/**
 * Revisão do tempo manual (2026-09, pedido do utilizador "analisa melhor o
 * tempo manual das tarefas"): várias tarefas tinham o tempoManualSeg
 * subestimado face ao que realmente leva fazer à mão numa farmácia (ex.:
 * compor um pedido de manipulado envolve cálculo de fórmula + encomenda de
 * matérias-primas + folha de registo, não só "escrever um pedido"; um AUE
 * é um dossier regulamentar, não uma nota rápida; um Rótulo semanal com
 * polimedicação idosa demora bem mais do que reimprimir uma etiqueta). Os
 * valores abaixo foram revistos para refletir melhor o esforço manual real,
 * mantendo-se ainda assim conservadores (arredondados por baixo, nunca por
 * cima) — nunca uma medição cronometrada, apenas uma estimativa de
 * referência explicável a uma farmácia. Podem sempre ser ajustados por
 * farmácia em Configurações → Poupança & ROI.
 */
export const TAREFAS_CATALOGO = [
  // ---------------------------------------------------------------- PIM
  { modulo: "pim", tarefaId: "criar_utente", nome: "Criar ficha de utente", tempoManualSeg: 240, tempoCentralSeg: 40 },
  { modulo: "pim", tarefaId: "criar_rotulo", nome: "Criar Rótulo (plano semanal)", tempoManualSeg: 900, tempoCentralSeg: 120 },
  { modulo: "pim", tarefaId: "reimprimir_rotulo", nome: "Reimprimir Rótulo", tempoManualSeg: 360, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "registar_receita", nome: "Registar receita sem papel", tempoManualSeg: 150, tempoCentralSeg: 30 },
  { modulo: "pim", tarefaId: "criar_evento", nome: "Agendar evento no calendário", tempoManualSeg: 60, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "alerta_terminar", nome: "Alerta automático de Rótulo a terminar", tempoManualSeg: 600, tempoCentralSeg: 5 },
  // Expansão 2026-09 (pedido do utilizador "acrescenta mais tarefas
  // medíveis... máximo de recolha de dados de utilização"): mais ações
  // reais do PIM, já implementadas, que ainda não eram contabilizadas.
  { modulo: "pim", tarefaId: "editar_utente", nome: "Atualizar ficha de utente", tempoManualSeg: 180, tempoCentralSeg: 30 },
  { modulo: "pim", tarefaId: "remover_utente", nome: "Remover utente e dados associados", tempoManualSeg: 300, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "adicionar_medicamento", nome: "Adicionar medicamento à ficha do utente", tempoManualSeg: 150, tempoCentralSeg: 35 },
  { modulo: "pim", tarefaId: "editar_medicamento", nome: "Editar dados de medicamento", tempoManualSeg: 120, tempoCentralSeg: 25 },
  { modulo: "pim", tarefaId: "descontinuar_medicamento", nome: "Descontinuar medicamento", tempoManualSeg: 90, tempoCentralSeg: 10 },
  { modulo: "pim", tarefaId: "remover_medicamento", nome: "Remover medicamento e stock associado", tempoManualSeg: 150, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "editar_receita", nome: "Editar receita registada", tempoManualSeg: 120, tempoCentralSeg: 25 },
  { modulo: "pim", tarefaId: "remover_receita", nome: "Remover receita", tempoManualSeg: 90, tempoCentralSeg: 10 },
  { modulo: "pim", tarefaId: "imprimir_codigos_receita", nome: "Imprimir códigos de receita", tempoManualSeg: 180, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "imprimir_arquivo_receita", nome: "Imprimir/consultar ficheiro anexado da receita", tempoManualSeg: 150, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "registar_embalagem_manual", nome: "Registar embalagem de stock (manual)", tempoManualSeg: 180, tempoCentralSeg: 35 },
  { modulo: "pim", tarefaId: "ajustar_stock_manual", nome: "Ajustar quantidade de stock", tempoManualSeg: 60, tempoCentralSeg: 8 },
  { modulo: "pim", tarefaId: "remover_embalagem", nome: "Remover embalagem do stock", tempoManualSeg: 90, tempoCentralSeg: 10 },
  // Ponto 121 (pedido do Ivo, 2026-09): Histórico de Consumo de Stock
  // passou a ser editável/eliminável, além do registo manual novo.
  { modulo: "pim", tarefaId: "criar_registo_consumo", nome: "Adicionar registo manual ao histórico de consumo", tempoManualSeg: 90, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "editar_registo_consumo", nome: "Editar registo do histórico de consumo", tempoManualSeg: 60, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "eliminar_registo_consumo", nome: "Eliminar registo do histórico de consumo", tempoManualSeg: 45, tempoCentralSeg: 8 },
  { modulo: "pim", tarefaId: "exportar_stock_excel", nome: "Exportar stock (Excel)", tempoManualSeg: 600, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "registar_embalagem_scan", nome: "Registar nova embalagem via scanner", tempoManualSeg: 240, tempoCentralSeg: 30 },
  { modulo: "pim", tarefaId: "registar_consumo_scan", nome: "Registar consumo via scanner", tempoManualSeg: 120, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "editar_evento", nome: "Editar evento de calendário", tempoManualSeg: 90, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "concluir_evento", nome: "Concluir evento agendado", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "pim", tarefaId: "remover_evento", nome: "Remover evento de calendário", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "pim", tarefaId: "remover_rotulo", nome: "Eliminar rótulo guardado", tempoManualSeg: 120, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "exportar_utentes_excel", nome: "Exportar lista de utentes (Excel)", tempoManualSeg: 600, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "exportar_entregas_excel", nome: "Exportar registo de entregas (Excel)", tempoManualSeg: 480, tempoCentralSeg: 20 },
  { modulo: "pim", tarefaId: "exportar_historico_utente_excel", nome: "Exportar histórico de medicação do utente (Excel)", tempoManualSeg: 300, tempoCentralSeg: 15 },
  { modulo: "pim", tarefaId: "imprimir_ficha_utente", nome: "Imprimir ficha completa do utente", tempoManualSeg: 240, tempoCentralSeg: 15 },

  // ------------------------------------------------------------ Gabinete
  { modulo: "gabinete", tarefaId: "atualizar_stock", nome: "Atualizar stock/validade", tempoManualSeg: 120, tempoCentralSeg: 30 },
  { modulo: "gabinete", tarefaId: "criar_relatorio", nome: "Criar relatório de atendimento", tempoManualSeg: 900, tempoCentralSeg: 180 },
  { modulo: "gabinete", tarefaId: "relatorio_pdf_email", nome: "Enviar relatório em PDF por email", tempoManualSeg: 360, tempoCentralSeg: 10 },
  { modulo: "gabinete", tarefaId: "scan_gs1", nome: "Ler código GS1 (lote/validade)", tempoManualSeg: 90, tempoCentralSeg: 5 },
  { modulo: "gabinete", tarefaId: "checklist", nome: "Concluir checklist diária", tempoManualSeg: 240, tempoCentralSeg: 60 },
  // Expansão 2026-09 — ver nota igual na secção PIM acima.
  { modulo: "gabinete", tarefaId: "ajustar_qtd_rapido", nome: "Ajustar quantidade rapidamente", tempoManualSeg: 30, tempoCentralSeg: 3 },
  { modulo: "gabinete", tarefaId: "remover_stock", nome: "Remover produto da lista de controlo", tempoManualSeg: 60, tempoCentralSeg: 8 },
  { modulo: "gabinete", tarefaId: "localizar_stock_scan", nome: "Localizar produto na lista por código", tempoManualSeg: 90, tempoCentralSeg: 10 },
  { modulo: "gabinete", tarefaId: "guardar_produto_scan", nome: "Guardar produto novo a partir do código lido", tempoManualSeg: 120, tempoCentralSeg: 15 },
  { modulo: "gabinete", tarefaId: "puxar_stock_relatorio", nome: "Puxar stock para item do relatório", tempoManualSeg: 90, tempoCentralSeg: 5 },
  { modulo: "gabinete", tarefaId: "remover_item_relatorio", nome: "Remover item do relatório/base de itens", tempoManualSeg: 60, tempoCentralSeg: 8 },
  { modulo: "gabinete", tarefaId: "criar_seccao_checklist", nome: "Criar nova secção da checklist", tempoManualSeg: 300, tempoCentralSeg: 20 },
  { modulo: "gabinete", tarefaId: "renomear_seccao_checklist", nome: "Renomear secção da checklist", tempoManualSeg: 90, tempoCentralSeg: 6 },
  { modulo: "gabinete", tarefaId: "remover_seccao_checklist", nome: "Remover secção da checklist", tempoManualSeg: 240, tempoCentralSeg: 10 },
  { modulo: "gabinete", tarefaId: "remover_item_checklist", nome: "Remover item da checklist", tempoManualSeg: 90, tempoCentralSeg: 8 },
  { modulo: "gabinete", tarefaId: "restaurar_item_checklist", nome: "Restaurar item da checklist", tempoManualSeg: 120, tempoCentralSeg: 5 },
  { modulo: "gabinete", tarefaId: "editar_relatorio", nome: "Editar relatório de atendimento existente", tempoManualSeg: 420, tempoCentralSeg: 90 },
  { modulo: "gabinete", tarefaId: "eliminar_relatorio", nome: "Eliminar relatório de atendimento", tempoManualSeg: 60, tempoCentralSeg: 5 },
  { modulo: "gabinete", tarefaId: "imprimir_relatorio", nome: "Imprimir relatório em papel", tempoManualSeg: 180, tempoCentralSeg: 10 },
  { modulo: "gabinete", tarefaId: "guardar_configuracao", nome: "Guardar configuração de alertas/sincronização", tempoManualSeg: 180, tempoCentralSeg: 15 },
  { modulo: "gabinete", tarefaId: "exportar_copia_seguranca", nome: "Exportar cópia de segurança dos dados", tempoManualSeg: 600, tempoCentralSeg: 5 },
  { modulo: "gabinete", tarefaId: "importar_copia_seguranca", nome: "Importar cópia de segurança", tempoManualSeg: 600, tempoCentralSeg: 10 },
  { modulo: "gabinete", tarefaId: "sincronizar_sheets_manual", nome: "Sincronizar tudo com o Google Sheets", tempoManualSeg: 900, tempoCentralSeg: 10 },
  { modulo: "gabinete", tarefaId: "sincronizar_nuvem_manual", nome: "Sincronizar dados com a nuvem", tempoManualSeg: 120, tempoCentralSeg: 5 },

  // --------------------------------------------------------- Manipulados
  { modulo: "manipulados", tarefaId: "criar_pedido", nome: "Criar pedido de manipulado", tempoManualSeg: 600, tempoCentralSeg: 90 },
  { modulo: "manipulados", tarefaId: "marcar_entregue", nome: "Marcar pedido como entregue", tempoManualSeg: 90, tempoCentralSeg: 10 },
  { modulo: "manipulados", tarefaId: "enviar_orcamento", nome: "Enviar orçamento", tempoManualSeg: 240, tempoCentralSeg: 30 },
  // Restantes mudanças de estado do pedido (pedido do utilizador: contar
  // toda a mudança de estado, não só a chegada a "entregue").
  { modulo: "manipulados", tarefaId: "mudar_pendente_utente", nome: "Mover pedido para 'Aguarda utente'", tempoManualSeg: 90, tempoCentralSeg: 15 },
  { modulo: "manipulados", tarefaId: "mudar_pendente_farmacia", nome: "Mover pedido para 'Aguarda farmácia'", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "manipulados", tarefaId: "mudar_preparacao", nome: "Marcar pedido em preparação", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "manipulados", tarefaId: "mudar_pronto", nome: "Marcar pedido pronto p/ levantamento (avisa utente)", tempoManualSeg: 120, tempoCentralSeg: 15 },
  { modulo: "manipulados", tarefaId: "mudar_cancelado", nome: "Cancelar pedido", tempoManualSeg: 180, tempoCentralSeg: 20 },
  { modulo: "manipulados", tarefaId: "reabrir_pedido", nome: "Reabrir pedido já fechado", tempoManualSeg: 240, tempoCentralSeg: 20 },

  // ----------------------------------------------------------- Documentos
  { modulo: "documentos", tarefaId: "gerar_declaracao", nome: "Gerar declaração oficial", tempoManualSeg: 600, tempoCentralSeg: 60 },
  { modulo: "documentos", tarefaId: "gerar_etiqueta", nome: "Gerar etiquetas", tempoManualSeg: 300, tempoCentralSeg: 45 },
  { modulo: "documentos", tarefaId: "gerar_bolacha", nome: "Gerar bolacha promocional", tempoManualSeg: 240, tempoCentralSeg: 30 },
  { modulo: "documentos", tarefaId: "gerar_lista_inscricao", nome: "Gerar lista de inscrição", tempoManualSeg: 180, tempoCentralSeg: 30 },
  { modulo: "documentos", tarefaId: "gerar_lombada", nome: "Gerar lombada", tempoManualSeg: 120, tempoCentralSeg: 20 },
  { modulo: "documentos", tarefaId: "arquivar_documento", nome: "Arquivar documento", tempoManualSeg: 90, tempoCentralSeg: 15 },
  // Expansão 2026-09 — ver nota igual na secção PIM acima.
  { modulo: "documentos", tarefaId: "criar_pasta_documentos", nome: "Criar pasta de documentos", tempoManualSeg: 90, tempoCentralSeg: 15 },
  { modulo: "documentos", tarefaId: "editar_pasta_documentos", nome: "Editar pasta de documentos", tempoManualSeg: 60, tempoCentralSeg: 12 },
  { modulo: "documentos", tarefaId: "eliminar_pasta_documentos", nome: "Eliminar pasta de documentos", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "carregar_documento_pasta", nome: "Carregar documento para pasta", tempoManualSeg: 90, tempoCentralSeg: 15 },
  { modulo: "documentos", tarefaId: "descarregar_documento_pasta", nome: "Consultar/descarregar documento", tempoManualSeg: 60, tempoCentralSeg: 8 },
  { modulo: "documentos", tarefaId: "renomear_documento_pasta", nome: "Renomear documento", tempoManualSeg: 30, tempoCentralSeg: 8 },
  { modulo: "documentos", tarefaId: "eliminar_documento_pasta", nome: "Eliminar documento da pasta", tempoManualSeg: 30, tempoCentralSeg: 8 },
  { modulo: "documentos", tarefaId: "eliminar_declaracao_personalizada", nome: "Eliminar declaração personalizada", tempoManualSeg: 20, tempoCentralSeg: 8 },
  { modulo: "documentos", tarefaId: "criar_declaracao_personalizada", nome: "Criar declaração personalizada", tempoManualSeg: 480, tempoCentralSeg: 60 },
  { modulo: "documentos", tarefaId: "editar_declaracao_personalizada", nome: "Editar declaração personalizada", tempoManualSeg: 240, tempoCentralSeg: 40 },
  { modulo: "documentos", tarefaId: "puxar_medicacao_pim", nome: "Puxar medicação do PIM para declaração", tempoManualSeg: 300, tempoCentralSeg: 15 },
  { modulo: "documentos", tarefaId: "guardar_bolacha_historico", nome: "Guardar bolacha no histórico", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "adicionar_medicamento_lista_etiquetas", nome: "Adicionar medicamento à lista de etiquetas", tempoManualSeg: 25, tempoCentralSeg: 6 },
  { modulo: "documentos", tarefaId: "adicionar_atendimento_extra_lista", nome: "Adicionar atendimento extra à lista", tempoManualSeg: 30, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "eliminar_lista_inscricao", nome: "Eliminar lista de inscrição", tempoManualSeg: 20, tempoCentralSeg: 8 },
  { modulo: "documentos", tarefaId: "exportar_lista_inscricao_csv", nome: "Exportar lista de inscrição (CSV)", tempoManualSeg: 300, tempoCentralSeg: 20 },
  { modulo: "documentos", tarefaId: "imprimir_lista_inscricao", nome: "Imprimir lista de inscrição", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "guardar_lombada_historico", nome: "Guardar lombada no histórico", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "gerar_separadores", nome: "Gerar separadores de dossier", tempoManualSeg: 480, tempoCentralSeg: 45 },
  { modulo: "documentos", tarefaId: "eliminar_livro_biblioteca", nome: "Eliminar livro da biblioteca", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "eliminar_documento_biblioteca", nome: "Eliminar documento da biblioteca", tempoManualSeg: 30, tempoCentralSeg: 8 },
  { modulo: "documentos", tarefaId: "imprimir_documento_biblioteca", nome: "Imprimir documento da biblioteca", tempoManualSeg: 90, tempoCentralSeg: 15 },
  { modulo: "documentos", tarefaId: "imprimir_talao_biblioteca", nome: "Imprimir talão associado", tempoManualSeg: 60, tempoCentralSeg: 10 },
  { modulo: "documentos", tarefaId: "criar_livro_biblioteca", nome: "Criar livro na biblioteca", tempoManualSeg: 240, tempoCentralSeg: 40 },

  // ---------------------------------------------------------------- AUE
  { modulo: "aue", tarefaId: "criar_pedido", nome: "Criar pedido AUE", tempoManualSeg: 900, tempoCentralSeg: 150 },
  { modulo: "aue", tarefaId: "atualizar_pedido", nome: "Atualizar estado do pedido", tempoManualSeg: 60, tempoCentralSeg: 15 },
  // Expansão 2026-09 — ver nota igual na secção PIM acima.
  { modulo: "aue", tarefaId: "anexar_documento", nome: "Anexar documento ao pedido", tempoManualSeg: 90, tempoCentralSeg: 12 },
  { modulo: "aue", tarefaId: "remover_documento", nome: "Remover documento anexado", tempoManualSeg: 40, tempoCentralSeg: 8 },
  { modulo: "aue", tarefaId: "marcar_aprovado", nome: "Marcar pedido como aprovado", tempoManualSeg: 60, tempoCentralSeg: 12 },
  { modulo: "aue", tarefaId: "marcar_disponivel", nome: "Marcar produto disponível para levantamento", tempoManualSeg: 60, tempoCentralSeg: 12 },
  { modulo: "aue", tarefaId: "marcar_entregue", nome: "Marcar pedido como entregue ao utente", tempoManualSeg: 90, tempoCentralSeg: 15 },
  { modulo: "aue", tarefaId: "marcar_indeferido", nome: "Marcar pedido como indeferido/cancelado", tempoManualSeg: 60, tempoCentralSeg: 12 },
  { modulo: "aue", tarefaId: "eliminar_pedido", nome: "Eliminar pedido AUE", tempoManualSeg: 120, tempoCentralSeg: 10 },
  { modulo: "aue", tarefaId: "exportar_csv", nome: "Exportar lista de pedidos para CSV", tempoManualSeg: 480, tempoCentralSeg: 20 },
  { modulo: "aue", tarefaId: "importar_csv", nome: "Importar pedidos em lote via CSV (por registo)", tempoManualSeg: 200, tempoCentralSeg: 5 },
  { modulo: "aue", tarefaId: "guardar_definicoes_email", nome: "Guardar definições de email/contactos de armazenistas", tempoManualSeg: 90, tempoCentralSeg: 20 },
  { modulo: "aue", tarefaId: "enviar_email_armazenista", nome: "Enviar email de pedido ao armazenista", tempoManualSeg: 420, tempoCentralSeg: 40 },
  { modulo: "aue", tarefaId: "enviar_email_utente_estado", nome: "Enviar email de atualização de estado ao utente", tempoManualSeg: 240, tempoCentralSeg: 25 },
  { modulo: "aue", tarefaId: "imprimir_formulario_aquisicao", nome: "Imprimir formulário de aquisição ao armazenista", tempoManualSeg: 240, tempoCentralSeg: 25 },
  { modulo: "aue", tarefaId: "restaurar_backup", nome: "Restaurar cópia de segurança local", tempoManualSeg: 300, tempoCentralSeg: 20 },

  // ------------------------------------------------------- Stocks Errados
  { modulo: "stocks", tarefaId: "criar_lista", nome: "Criar lista de stocks errados", tempoManualSeg: 60, tempoCentralSeg: 20 },
  { modulo: "stocks", tarefaId: "registar_item", nome: "Registar item com stock errado", tempoManualSeg: 90, tempoCentralSeg: 30 },
  { modulo: "stocks", tarefaId: "exportar_lista", nome: "Exportar lista (Excel/PDF)", tempoManualSeg: 600, tempoCentralSeg: 20 },
  // Expansão 2026-09 — ver nota igual na secção PIM acima.
  { modulo: "stocks", tarefaId: "renomear_lista", nome: "Renomear lista / atualizar operador", tempoManualSeg: 45, tempoCentralSeg: 15 },
  { modulo: "stocks", tarefaId: "apagar_lista", nome: "Apagar lista de stocks errados", tempoManualSeg: 40, tempoCentralSeg: 10 },
  { modulo: "stocks", tarefaId: "registar_stock_sistema", nome: "Registar stock em sistema do item", tempoManualSeg: 40, tempoCentralSeg: 10 },
  { modulo: "stocks", tarefaId: "registar_stock_contado", nome: "Registar stock contado do item", tempoManualSeg: 45, tempoCentralSeg: 10 },
  { modulo: "stocks", tarefaId: "selecionar_motivo", nome: "Selecionar motivo da discrepância", tempoManualSeg: 25, tempoCentralSeg: 5 },
  { modulo: "stocks", tarefaId: "especificar_motivo_outros", nome: "Especificar motivo \"outros\" (texto livre)", tempoManualSeg: 30, tempoCentralSeg: 12 },
  { modulo: "stocks", tarefaId: "remover_item", nome: "Remover item da lista", tempoManualSeg: 30, tempoCentralSeg: 8 },

  // -------------------------------------------------------------- Reservas
  { modulo: "reservas", tarefaId: "gerar_folha", nome: "Gerar folha de reservas", tempoManualSeg: 900, tempoCentralSeg: 60 },

  // ---------------------------------------------------------------- Medela
  { modulo: "medela", tarefaId: "gerar_contrato", nome: "Gerar contrato de aluguer", tempoManualSeg: 720, tempoCentralSeg: 90 },

  // ----------------------------------------------------------- Conversor PDF
  { modulo: "conversor-pdf", tarefaId: "converter_ficheiro", nome: "Converter/fundir ficheiro", tempoManualSeg: 300, tempoCentralSeg: 30 },
  // Expansão 2026-09 — o conversor tem, de facto, caminhos de código
  // distintos consoante o formato de destino (extrair texto, comprimir PDF,
  // converter para imagem, fundir documentos, combinar imagens, arquivar em
  // ZIP); passam a ser contabilizados separadamente do "converter_ficheiro"
  // genérico para refletir melhor o esforço manual de cada um.
  { modulo: "conversor-pdf", tarefaId: "extrair_texto_pdf", nome: "Extrair texto de PDF para documento editável", tempoManualSeg: 600, tempoCentralSeg: 40 },
  { modulo: "conversor-pdf", tarefaId: "comprimir_pdf", nome: "Comprimir/reotimizar PDF", tempoManualSeg: 180, tempoCentralSeg: 25 },
  { modulo: "conversor-pdf", tarefaId: "converter_pdf_imagem", nome: "Converter PDF/imagem para formato de imagem", tempoManualSeg: 240, tempoCentralSeg: 25 },
  { modulo: "conversor-pdf", tarefaId: "fundir_documentos", nome: "Fundir vários ficheiros num documento", tempoManualSeg: 480, tempoCentralSeg: 35 },
  { modulo: "conversor-pdf", tarefaId: "combinar_imagens", nome: "Combinar imagens numa só imagem", tempoManualSeg: 300, tempoCentralSeg: 20 },
  { modulo: "conversor-pdf", tarefaId: "arquivar_zip", nome: "Arquivar ficheiros em ZIP", tempoManualSeg: 60, tempoCentralSeg: 10 },

  // ------------------------------------------------------- Devolução de Frio
  { modulo: "devolucao-frio", tarefaId: "gerar_declaracao", nome: "Gerar declaração de devolução de frio", tempoManualSeg: 480, tempoCentralSeg: 90 },
  { modulo: "devolucao-frio", tarefaId: "auto_preencher_ia", nome: "Auto-preenchimento de declaração via IA (upload de ficheiro)", tempoManualSeg: 420, tempoCentralSeg: 45 },

  // --------------------------------------------------- Mapa Cardiovascular
  { modulo: "mapa-cardiovascular", tarefaId: "gerar_mapa", nome: "Gerar mapa/consentimento MAPA 48h", tempoManualSeg: 600, tempoCentralSeg: 120 },

  // ------------------------------------------------ Devoluções Armazenistas
  { modulo: "devolucoes-armazenistas", tarefaId: "consultar_regra", nome: "Consultar regra de devolução", tempoManualSeg: 240, tempoCentralSeg: 10 },
  { modulo: "devolucoes-armazenistas", tarefaId: "verificar_lote", nome: "Verificar produto em lote (por produto)", tempoManualSeg: 30, tempoCentralSeg: 2 },
  // Expansão 2026-09 — ver nota igual na secção PIM acima.
  { modulo: "devolucoes-armazenistas", tarefaId: "adicionar_produto", nome: "Adicionar produto personalizado", tempoManualSeg: 90, tempoCentralSeg: 8 },
  { modulo: "devolucoes-armazenistas", tarefaId: "editar_produto", nome: "Editar produto (associar detentor/família)", tempoManualSeg: 75, tempoCentralSeg: 6 },
  { modulo: "devolucoes-armazenistas", tarefaId: "remover_produto", nome: "Remover produto da consulta", tempoManualSeg: 20, tempoCentralSeg: 2 },
  { modulo: "devolucoes-armazenistas", tarefaId: "restaurar_produto", nome: "Restaurar produto removido", tempoManualSeg: 15, tempoCentralSeg: 2 },
  { modulo: "devolucoes-armazenistas", tarefaId: "adicionar_detentor", nome: "Adicionar detentor de AIM", tempoManualSeg: 120, tempoCentralSeg: 10 },
  { modulo: "devolucoes-armazenistas", tarefaId: "confirmar_associacao_detentor", nome: "Confirmar associação detentor-regra", tempoManualSeg: 60, tempoCentralSeg: 5 },
  { modulo: "devolucoes-armazenistas", tarefaId: "remover_detentor", nome: "Remover detentor personalizado", tempoManualSeg: 20, tempoCentralSeg: 2 },
  { modulo: "devolucoes-armazenistas", tarefaId: "editar_regra", nome: "Editar regra de devolução", tempoManualSeg: 45, tempoCentralSeg: 4 },
  { modulo: "devolucoes-armazenistas", tarefaId: "repor_regras_editadas", nome: "Repor regras editadas do armazenista", tempoManualSeg: 30, tempoCentralSeg: 3 },
  // Importação de regras a partir de Excel/CSV/PDF (aba Detentores e Regras) —
  // mesmo motor/UX de importação do Catálogo de Produtos (importar_produtos,
  // ver acima); qtd = nº de regras (linhas) efetivamente aplicadas, não o
  // tamanho do ficheiro. Tempo manual equivalente ao par "editar_regra" (cada
  // linha importada substitui uma edição manual célula-a-célula).
  { modulo: "devolucoes-armazenistas", tarefaId: "importar_regras", nome: "Importar regra de devolução via Excel/PDF (por regra)", tempoManualSeg: 45, tempoCentralSeg: 4 },

  // ------------------------------------------------------ Catálogo Produtos
  { modulo: "catalogo-produtos", tarefaId: "adicionar_produto", nome: "Adicionar produto ao catálogo", tempoManualSeg: 60, tempoCentralSeg: 20 },
  { modulo: "catalogo-produtos", tarefaId: "importar_produtos", nome: "Importar produto em lote (por produto)", tempoManualSeg: 60, tempoCentralSeg: 5 },
  { modulo: "catalogo-produtos", tarefaId: "editar_produto", nome: "Editar produto existente no catálogo", tempoManualSeg: 75, tempoCentralSeg: 20 },
  { modulo: "catalogo-produtos", tarefaId: "remover_produto", nome: "Remover produto do catálogo", tempoManualSeg: 90, tempoCentralSeg: 15 },
  // Par de "remover_produto": faltava (a UI para restaurar um produto
  // removido também não existia — ver o bug corrigido em
  // modulos/catalogo-produtos.html/src/produtosCatalogo.js) — sem esta
  // entrada, o registarUso('catalogo-produtos','restaurar_produto') feito
  // pela UI ficava a ser silenciosamente ignorado pelo painel de Poupança &
  // ROI (tarefa desconhecida). Valores em linha com o par equivalente já
  // existente em "devolucoes-armazenistas".
  { modulo: "catalogo-produtos", tarefaId: "restaurar_produto", nome: "Restaurar produto removido do catálogo", tempoManualSeg: 60, tempoCentralSeg: 10 },
  // ------------------------------------------------------------- FARMA IA
  // (ponto 25): as 3 tarefas rastreáveis do novo módulo — a estimativa
  // "manual" aqui é o tempo que levaria chegar à mesma conclusão revendo à
  // mão os dados de cada módulo (validades, pedidos pendentes, contagens),
  // não uma ação que já existisse antes da FARMA IA.
  { modulo: "farma-ia", tarefaId: "ver_alertas", nome: "Rever Alertas & Insights da FARMA IA", tempoManualSeg: 300, tempoCentralSeg: 15 },
  { modulo: "farma-ia", tarefaId: "perguntar", nome: "Perguntar ao assistente da FARMA IA", tempoManualSeg: 120, tempoCentralSeg: 10 },
  { modulo: "farma-ia", tarefaId: "ver_oportunidades", nome: "Rever oportunidades de automação da FARMA IA", tempoManualSeg: 180, tempoCentralSeg: 15 }
];

/** Nomes amigáveis dos módulos — mesmos usados em MODULOS_ATALHOS (src/domain.js)
 *  e em src/ui/main-content.js, repetidos aqui para este ficheiro não depender
 *  deles (evita import cruzado desnecessário; mantém-se sincronizado à mão
 *  sempre que um módulo novo for adicionado). */
export const MODULOS_NOMES = {
  manipulados: "Manipulados", documentos: "Documentos", gabinete: "Gestão de Gabinete", pim: "Gestão de PIM",
  aue: "Pedidos AUE", stocks: "Stocks Errados", reservas: "Reservas", medela: "Aluguer Medela",
  "conversor-pdf": "Conversor de PDF", "devolucao-frio": "Devolução de Frio",
  "mapa-cardiovascular": "Mapa Cardiovascular", "devolucoes-armazenistas": "Devoluções a Armazenistas",
  "catalogo-produtos": "Catálogo de Produtos", "farma-ia": "FARMA IA"
};

export function chaveTarefa(modulo, tarefaId) { return modulo + "." + tarefaId; }

let indice = null;
function indiceCatalogo() {
  if (!indice) {
    indice = new Map();
    for (const t of TAREFAS_CATALOGO) indice.set(chaveTarefa(t.modulo, t.tarefaId), t);
  }
  return indice;
}

/** Estimativa efetiva de uma tarefa: o catálogo por omissão, com os overrides
 *  guardados em `config.usoEstimativas` (objeto parcial, chave `modulo.tarefaId`,
 *  cada valor `{tempoManualSeg, tempoCentralSeg}`) aplicados por cima. */
export function estimativaEfetiva(chave, overrides) {
  const base = indiceCatalogo().get(chave);
  if (!base) return null;
  const over = (overrides && overrides[chave]) || {};
  return {
    modulo: base.modulo, tarefaId: base.tarefaId, nome: base.nome,
    tempoManualSeg: typeof over.tempoManualSeg === "number" ? over.tempoManualSeg : base.tempoManualSeg,
    tempoCentralSeg: typeof over.tempoCentralSeg === "number" ? over.tempoCentralSeg : base.tempoCentralSeg
  };
}

export function todasEstimativas(overrides) {
  return TAREFAS_CATALOGO.map(t => estimativaEfetiva(chaveTarefa(t.modulo, t.tarefaId), overrides));
}
