/**
 * Testes e2e da Gestão de Gabinete (modulos/gabinete.html) — Lista de
 * Controlo (stock), scanner GS1, fusão Lista de Controlo <-> Itens do
 * Gabinete, secções/itens, e relatórios de atendimento. Cada bloco usa a
 * sua própria farmácia de teste (signupFarmacia) para nunca colidir com
 * outros ficheiros de tests/e2e/modules/ a correr em paralelo.
 *
 * Cada verificação exercita uma ação real na UI e confirma o efeito real —
 * no DOM e/ou persistido no servidor via GET /api/data (apiFetch).
 */
import { ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports } from '../helpers.mjs';

const BASE = 'http://localhost:8888';

async function abrirGabinete(browser, prefixo) {
  const { token, perfil } = await signupFarmacia(prefixo);
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  page.on('dialog', d => { try { d.accept(d.type() === 'prompt' ? 'Secção QA' : undefined); } catch (e) {} });
  await page.goto(`${BASE}/modulos/gabinete.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(600); // dá tempo à migração/seed inicial (seedChecklistIfEmpty) e ao hydrateFromCloud
  return { ctx, page, token, perfil };
}

async function estadoServidor(token) {
  const res = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
  return JSON.parse(res.body);
}

function itensChecklist(estado) {
  return (estado.gabinete && estado.gabinete.gabinete_checklist_items_v1) || [];
}

export async function run(browser) {
  /* ============================================================
   * 1. LISTA DE CONTROLO — criar produto, validação, persistência, fusão
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirGabinete(browser, 'GabStock');

    // Validação: nome obrigatório
    let estado = await estadoServidor(token);
    const totalAntes = itensChecklist(estado).length;
    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    await page.click('#viewStock button:has-text("Adicionar produto")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(250);
    estado = await estadoServidor(token);
    ok('Gabinete Lista de Controlo: guardar produto sem nome é bloqueado (nenhum item criado)',
      (await page.locator('#stockModalOverlay.open').count()) === 1 && itensChecklist(estado).length === totalAntes);

    // Regressão do bug reportado diretamente pelo Ivo (ponto 36): na aba
    // "Base de dados" (aberta por omissão), pesquisar por CNP mostrava
    // sugestões, mas clicar numa delas não selecionava nada — pickStockProduct
    // não estava exposto em window (necessário para handlers onclick inline
    // num módulo ES), pelo que o clique falhava com um ReferenceError
    // silencioso e o produto nunca chegava a ser adicionado de facto.
    await page.fill('#stockProductSearch', '1000000');
    await page.waitForTimeout(250);
    await page.click('#stockProductSuggest .sg-item >> nth=0');
    await page.waitForTimeout(150);
    const chipTexto = await page.locator('#stockSelectedChip').innerText().catch(() => '');
    ok('Gabinete Lista de Controlo: clicar numa sugestão de produto (pesquisa por CNP) seleciona mesmo o produto',
      chipTexto.includes('LIGADURA ALGODAO'));
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(350);
    estado = await estadoServidor(token);
    const itemPorCnp = itensChecklist(estado).find(i => i.cnp === '1000000');
    ok('Gabinete Lista de Controlo: produto escolhido por CNP na Base de dados fica mesmo persistido no servidor',
      !!itemPorCnp && itemPorCnp.nome === 'LIGADURA ALGODAO P/ GESSO 15 CM');

    // Criar produto real (Produto novo) com quantidade/mínimo
    await page.click('#viewStock button:has-text("Adicionar produto")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.click('#stockModalOverlay button:has-text("Produto novo")');
    await page.fill('#fNomeNovo', 'Produto QA Alfa');
    await page.fill('#fQtd', '12');
    await page.fill('#fQtdMin', '5');
    await page.fill('#fLote', 'LOTE-ALFA');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    const apareceuNoStock = await page.locator('.stock-row:has-text("Produto QA Alfa")').count();
    ok('Gabinete Lista de Controlo: criar produto novo aparece na lista', apareceuNoStock === 1);

    estado = await estadoServidor(token);
    const itemAlfa = itensChecklist(estado).find(i => i.nome === 'Produto QA Alfa');
    ok('Gabinete Lista de Controlo: produto persiste como item do gabinete com qv:true e quantidade correta',
      !!itemAlfa && itemAlfa.qv === true && Number(itemAlfa.quantidade) === 12 && Number(itemAlfa.quantidadeMinima) === 5);

    // Regressão "fusão": o MESMO produto aparece em Itens do Gabinete (mesma base de dados)
    await page.click('.mc-bb-item:has-text("Itens do Gabinete")');
    await page.waitForTimeout(200);
    await page.fill('#itensSearch', 'Produto QA Alfa');
    await page.waitForTimeout(200);
    const naListaDeItens = await page.locator('.mgmt-item-row:has-text("Produto QA Alfa")').count();
    ok('Gabinete: regressão da fusão Lista de Controlo <-> Itens do Gabinete — o mesmo produto aparece nos Itens do Gabinete', naListaDeItens === 1);
    await page.fill('#itensSearch', '');

    // Ajuste rápido de quantidade (+/-) na Lista de Controlo
    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    const linhaAlfa = page.locator('.stock-row:has-text("Produto QA Alfa")');
    await linhaAlfa.locator('.stock-qty button:has-text("+")').click();
    await linhaAlfa.locator('.stock-qty button:has-text("+")').click();
    await page.waitForTimeout(250);
    estado = await estadoServidor(token);
    let itemAlfaAgora = itensChecklist(estado).find(i => i.nome === 'Produto QA Alfa');
    ok('Gabinete Lista de Controlo: botão "+" incrementa e persiste a quantidade (12 -> 14)', Number(itemAlfaAgora.quantidade) === 14);

    await linhaAlfa.locator('.stock-qty button:has-text("−")').click();
    await page.waitForTimeout(250);
    estado = await estadoServidor(token);
    itemAlfaAgora = itensChecklist(estado).find(i => i.nome === 'Produto QA Alfa');
    ok('Gabinete Lista de Controlo: botão "−" decrementa e persiste a quantidade (14 -> 13)', Number(itemAlfaAgora.quantidade) === 13);

    // Criar um 2º produto e testar a pesquisa
    await page.click('#viewStock button:has-text("Adicionar produto")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.click('#stockModalOverlay button:has-text("Produto novo")');
    await page.fill('#fNomeNovo', 'Produto QA Beta');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    await page.fill('#stockSearch', 'QA Alfa');
    await page.waitForTimeout(200);
    const linhasFiltradas = await page.locator('.stock-row').count();
    const temAlfaFiltrado = await page.locator('.stock-row:has-text("Produto QA Alfa")').count();
    const temBetaFiltrado = await page.locator('.stock-row:has-text("Produto QA Beta")').count();
    ok('Gabinete Lista de Controlo: pesquisa filtra para mostrar só o produto correspondente',
      linhasFiltradas === 1 && temAlfaFiltrado === 1 && temBetaFiltrado === 0);
    await page.fill('#stockSearch', '');

    await ctx.close();
  }

  /* ============================================================
   * 2. SCANNER GS1 — regressão "+ Adicionar à lista de controlo" pós-scan
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirGabinete(browser, 'GabScan');
    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    await page.click('#viewStock button:has-text("Digitalizar")');
    await page.waitForSelector('#scanModalOverlay.open');

    const codigoGS1 = '(01)09999999999999(17)261231(10)LOTE-SCANGAB(21)SNGAB01(714)5551234';
    await page.fill('#hw_scanModalBody', codigoGS1);
    await page.click('#scanModalBody button:has-text("Analisar código")');
    await page.waitForTimeout(250);
    await page.click('#scanModalBody button:has-text("Adicionar à lista de controlo")');
    await page.waitForSelector('#stockModalOverlay.open');

    // Os campos comuns (Lote/Validade/PC/SN) já vêm pré-preenchidos com os dados do
    // código GS1 digitalizado — verifica-se ANTES de trocar de separador (a aba
    // "Produto novo" limpa apenas o campo nome/CNP, nunca estes campos comuns).
    const loteVal = await page.locator('#fLote').inputValue();
    const validadeVal = await page.locator('#fValidade').inputValue();
    const pcVal = await page.locator('#fPc').inputValue();
    const snVal = await page.locator('#fSn').inputValue();
    ok('Gabinete scanner: "+ Adicionar à lista de controlo" pré-preenche Lote/Validade/PC/SN a partir do código GS1 lido',
      loteVal === 'LOTE-SCANGAB' && validadeVal === '2026-12-31' && pcVal === '09999999999999' && snVal === 'SNGAB01',
      `lote=${loteVal} validade=${validadeVal} pc=${pcVal} sn=${snVal}`);

    // O CNP não estava na base de dados local — o produto novo é identificado manualmente
    await page.click('#stockModalOverlay button:has-text("Produto novo")');
    await page.fill('#fNomeNovo', 'Produto Scan QA');
    await page.fill('#fCnpNovo', '5551234');
    await page.fill('#fQtd', '5');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    const estado = await estadoServidor(token);
    const itemScan = itensChecklist(estado).find(i => i.nome === 'Produto Scan QA');
    ok('Gabinete scanner: produto adicionado via scan fica persistido com todos os dados lidos (cnp/lote/pc/sn/qtd)',
      !!itemScan && itemScan.cnp === '5551234' && itemScan.lote === 'LOTE-SCANGAB' && itemScan.pc === '09999999999999' &&
      itemScan.sn === 'SNGAB01' && itemScan.validade === '2026-12-31' && Number(itemScan.quantidade) === 5 && itemScan.qv === true);

    await ctx.close();
  }

  /* ============================================================
   * 3. ITENS DO GABINETE — remover/restaurar, secções, item manual
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirGabinete(browser, 'GabItens');
    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    await page.click('#viewStock button:has-text("Adicionar produto")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.click('#stockModalOverlay button:has-text("Produto novo")');
    await page.fill('#fNomeNovo', 'Produto QA Removivel');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    // Remover (soft-delete) a partir da Lista de Controlo
    await page.click('.stock-row:has-text("Produto QA Removivel") button[title="Remover"]');
    await page.waitForTimeout(300);
    let removidoDoStock = await page.locator('.stock-row:has-text("Produto QA Removivel")').count();
    let estado = await estadoServidor(token);
    let itemRemovivel = itensChecklist(estado).find(i => i.nome === 'Produto QA Removivel');
    ok('Gabinete: remover produto da Lista de Controlo desaparece da vista e fica ativo:false (soft-delete, preserva histórico)',
      removidoDoStock === 0 && itemRemovivel.ativo === false);

    // Continua visível em "Itens do Gabinete" quando se mostram os removidos, com a etiqueta "Removido"
    await page.click('.mc-bb-item:has-text("Itens do Gabinete")');
    await page.waitForTimeout(200);
    await page.check('#itensShowInactive');
    await page.waitForTimeout(200);
    const linhaRemovida = page.locator('.mgmt-item-row:has-text("Produto QA Removivel")');
    const marcadoRemovido = await linhaRemovida.locator('.tag-sm:has-text("Removido")').count();
    ok('Gabinete: item removido continua visível em "Itens do Gabinete" com "Mostrar itens removidos" (etiqueta Removido)', marcadoRemovido === 1);

    // Restaurar
    await linhaRemovida.locator('button[title="Restaurar"]').click();
    await page.waitForTimeout(300);
    estado = await estadoServidor(token);
    itemRemovivel = itensChecklist(estado).find(i => i.nome === 'Produto QA Removivel');
    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    removidoDoStock = await page.locator('.stock-row:has-text("Produto QA Removivel")').count();
    ok('Gabinete: restaurar item volta a marcar ativo:true e reaparece na Lista de Controlo', itemRemovivel.ativo === true && removidoDoStock === 1);

    // Nova secção (prompt) + item manual "apenas estado" dentro dela
    await page.click('.mc-bb-item:has-text("Itens do Gabinete")');
    await page.waitForTimeout(200);
    await page.click('#viewItens button:has-text("Nova secção")');
    await page.waitForTimeout(300);
    const seccaoCriada = await page.locator('.mgmt-section-head input[value="Secção QA"]').count();
    ok('Gabinete: "+ Nova secção" cria uma secção nova com o nome indicado', seccaoCriada === 1);

    // O título da secção é o VALUE de um <input> (não texto visível), por isso
    // localiza-se a secção pelo campo com esse valor, não por :has-text.
    const seccaoQA = page.locator('.mgmt-section').filter({ has: page.locator('input[value="Secção QA"]') });
    await seccaoQA.locator('button:has-text("Adicionar item a esta secção")').click();
    await page.waitForSelector('#itemModalOverlay.open');
    // Validação: nome obrigatório
    await page.click('#itemModalOverlay button:has-text("Guardar item")');
    await page.waitForTimeout(250);
    ok('Gabinete Itens do Gabinete: guardar item sem nome é bloqueado', (await page.locator('#itemModalOverlay.open').count()) === 1);

    // Mesma regressão do bug do Ivo (ponto 36), mas na sua versão gémea em
    // Itens do Gabinete: pickItemProduct também não estava exposto em
    // window, pelo que clicar numa sugestão da aba "Base de dados / Stock"
    // (a aba por omissão aqui) também não selecionava nada.
    await page.fill('#itemProductSearch', '1000018');
    await page.waitForTimeout(250);
    await page.click('#itemProductSuggest .sg-item >> nth=0');
    await page.waitForTimeout(150);
    const chipItemTexto = await page.locator('#itemSelectedChip').innerText().catch(() => '');
    ok('Gabinete Itens do Gabinete: clicar numa sugestão de produto (Base de dados / Stock) seleciona mesmo o produto',
      chipItemTexto.includes('SUPORTE BRAÇO ORTHOPRIM'));
    await page.click('#itemModalOverlay button:has-text("Guardar item")');
    await page.waitForTimeout(350);
    const produtoEscolhidoNaSeccao = await seccaoQA.locator('.mgmt-item-row:has-text("SUPORTE BRAÇO ORTHOPRIM")').count();
    ok('Gabinete Itens do Gabinete: produto escolhido pela Base de dados/Stock fica mesmo adicionado à secção',
      produtoEscolhidoNaSeccao === 1);

    await seccaoQA.locator('button:has-text("Adicionar item a esta secção")').click();
    await page.waitForSelector('#itemModalOverlay.open');
    await page.click('#itemModalOverlay button:has-text("Item manual")');
    await page.fill('#itemModalOverlay input[oninput*="draftItem.nome"]', 'Item Manual QA');
    await page.selectOption('#fItemTipo', 'estado');
    await page.click('#itemModalOverlay button:has-text("Guardar item")');
    await page.waitForTimeout(400);

    const itemManualNaSeccao = await seccaoQA.locator('.mgmt-item-row:has-text("Item Manual QA")').count();
    ok('Gabinete: item manual "apenas estado" fica na secção nova em Itens do Gabinete', itemManualNaSeccao === 1);

    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    const itemManualNoStock = await page.locator('.stock-row:has-text("Item Manual QA")').count();
    ok('Gabinete: item "apenas estado" (qv:false) não aparece na Lista de Controlo', itemManualNoStock === 0);

    await ctx.close();
  }

  /* ============================================================
   * 4. RELATÓRIOS — marcar "PEDIR", contagem de pedidos e escrita de
   *    volta (qtd/validade) para o item canónico; eliminar relatório
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirGabinete(browser, 'GabRelatorio');
    await page.click('.mc-bb-item:has-text("Lista de Controlo")');
    await page.waitForTimeout(200);
    await page.click('#viewStock button:has-text("Adicionar produto")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.click('#stockModalOverlay button:has-text("Produto novo")');
    await page.fill('#fNomeNovo', 'Produto QA Relatorio');
    await page.fill('#fQtd', '3');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    // Regressão do bug corrigido nesta sessão: um produto criado pela Lista de
    // Controlo já vem com a opção "PEDIR" disponível num relatório (antes vinha
    // sem opções nenhumas, options:[]).
    let estado = await estadoServidor(token);
    const itemRelatorio = itensChecklist(estado).find(i => i.nome === 'Produto QA Relatorio');
    ok('Gabinete (regressão corrigida nesta sessão): produto novo da Lista de Controlo já nasce com a opção "PEDIR" disponível',
      !!itemRelatorio && Array.isArray(itemRelatorio.options) && itemRelatorio.options.includes('PEDIR'));

    await page.click('.mc-bb-item:has-text("Relatórios")');
    await page.waitForTimeout(200);
    await page.click('#viewRelatorios button:has-text("Novo relatório")');
    await page.waitForSelector('#reportModalOverlay.open');
    await page.waitForTimeout(300);

    const bloco = page.locator('.checklist-item:has-text("Produto QA Relatorio")');
    await bloco.locator('input[type="radio"][value="PEDIR"]').check();
    await bloco.locator(`input[oninput$=".qty=this.value"]`).fill('7');
    await bloco.locator(`input[oninput$=".validade=this.value"]`).fill('12/2027');
    await page.click('#reportModalOverlay button:has-text("Guardar relatório")');
    await page.waitForTimeout(500);
    // saveReport() não fecha o modal sozinho — o utilizador fecha manualmente com o "✕"
    await page.click('#reportModalOverlay .close-x');
    await page.waitForTimeout(200);

    // ".folder-card" também existe na grelha do Início (HOME_CARDS) — tem de se
    // procurar só dentro de #relatoriosContent para apanhar o cartão certo.
    const cartaoRelatorio = page.locator('#relatoriosContent .folder-card').first();
    const textoCartao = await cartaoRelatorio.innerText();
    ok('Gabinete relatórios: o cartão do relatório mostra corretamente "1 pedido(s)" (só 1 item foi marcado PEDIR)',
      /1 pedido/.test(textoCartao), textoCartao);

    estado = await estadoServidor(token);
    const itemRelatorioDepois = itensChecklist(estado).find(i => i.nome === 'Produto QA Relatorio');
    ok('Gabinete relatórios: guardar o relatório escreve a quantidade/validade observadas de volta para o item canónico (Lista de Controlo)',
      Number(itemRelatorioDepois.quantidade) === 7 && itemRelatorioDepois.validade === '2027-12-31');

    const relatoriosAntes = ((await estadoServidor(token)).gabinete.gabinete_reports_v1 || []).length;
    await page.click('#relatoriosContent .folder-card button:has-text("Eliminar")');
    await page.waitForTimeout(300);
    estado = await estadoServidor(token);
    const relatoriosDepois = (estado.gabinete.gabinete_reports_v1 || []).length;
    ok('Gabinete relatórios: eliminar relatório remove-o da lista e do servidor', relatoriosDepois === relatoriosAntes - 1);

    await ctx.close();
  }

  /* ============================================================
   * 5. IMPRESSÃO DO RELATÓRIO (pedido do Ivo, 2026-09-13): a folha impressa
   *    tem de mostrar o mesmo conteúdo que o relatório no editor — antes,
   *    buildPrintSheetHtml() omitia a sub-etiqueta do item (item.sub, o
   *    campo "Descrição / sub-texto" do formulário "Item manual"), presente
   *    no editor (renderReportEditor/.ci-sub) mas ausente da impressão/PDF.
   * ============================================================ */
  {
    const { ctx, page } = await abrirGabinete(browser, 'GabImpressao');
    await page.click('.mc-bb-item:has-text("Itens do Gabinete")');
    await page.waitForTimeout(200);
    await page.click('#viewItens button:has-text("Nova secção")'); // dialog handler devolve "Secção QA"
    await page.waitForTimeout(300);
    const seccaoQA = page.locator('.mgmt-section').filter({ has: page.locator('input[value="Secção QA"]') });
    await seccaoQA.locator('button:has-text("Adicionar item a esta secção")').click();
    await page.waitForSelector('#itemModalOverlay.open');
    await page.click('#itemModalOverlay button:has-text("Item manual")');
    await page.fill('#itemModalOverlay input[oninput*="draftItem.nome"]', 'Item Com Sub-texto QA');
    await page.fill('#itemModalOverlay input[oninput*="draftItem.sub"]', 'Verificar a cada 3 meses');
    await page.selectOption('#fItemTipo', 'estado');
    await page.click('#itemModalOverlay button:has-text("Guardar item")');
    await page.waitForTimeout(400);

    await page.click('.mc-bb-item:has-text("Relatórios")');
    await page.waitForTimeout(200);
    await page.click('#viewRelatorios button:has-text("Novo relatório")');
    await page.waitForSelector('#reportModalOverlay.open');
    await page.waitForTimeout(300);

    // Confirma primeiro que o editor mostra a sub-etiqueta (para não testar
    // uma premissa falsa) — depois confirma que a impressão mostra o mesmo.
    const subNoEditor = await page.locator('#reportModalBody .ci-sub:has-text("Verificar a cada 3 meses")').count();
    ok('Gabinete: o editor do relatório mostra a sub-etiqueta do item ("Descrição/sub-texto")', subNoEditor === 1);

    await page.click('#reportModalOverlay button:has-text("🖨️ Imprimir / PDF")');
    await page.waitForTimeout(200);
    const printHtml = await page.locator('#printHolder').innerHTML();
    ok('Gabinete (bug corrigido nesta sessão): a impressão/PDF do relatório também mostra a sub-etiqueta do item, tal como o editor',
      printHtml.includes('Verificar a cada 3 meses'));

    await ctx.close();
  }
}
