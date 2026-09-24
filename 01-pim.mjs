/**
 * Testes e2e da Gestão de PIM (modulos/pim.html) — utentes, medicamentos,
 * stock/embalagens, scanner (DataMatrix), rótulos (com dedução de stock) e
 * calendário/receitas. Cada bloco usa a sua própria farmácia de teste
 * (signupFarmacia via abrirModulo) para nunca colidir com outros ficheiros
 * de tests/e2e/modules/ a correr em paralelo.
 *
 * Cada verificação exercita uma ação real na UI (clicar, preencher, guardar)
 * e confirma o efeito real — no DOM e/ou persistido no servidor via
 * GET /api/data (apiFetch). Não há verificações "o botão existe" sem
 * exercitar a ação.
 */
import { ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports } from '../helpers.mjs';

const BASE = 'http://localhost:8888';

async function abrirPim(browser, prefixo) {
  const { token, perfil, tenantId } = await signupFarmacia(prefixo);
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  page.on('dialog', d => { try { d.accept(d.type() === 'prompt' ? 'Secção QA' : undefined); } catch (e) {} });
  await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(500);
  return { ctx, page, token, perfil, tenantId };
}

async function estadoServidor(token) {
  const res = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
  return JSON.parse(res.body);
}

async function criarUtenteViaUI(page, nome) {
  await page.click('.mc-bb-item:has-text("Utentes")');
  await page.waitForTimeout(150);
  await page.click('#viewUtentes button:has-text("Novo utente")');
  await page.waitForSelector('#utenteModalOverlay.open');
  await page.fill('#utenteModalOverlay input[oninput*="draftUtente.nome"]', nome);
  await page.click('#utenteModalOverlay button:has-text("Guardar")');
  await page.waitForTimeout(400);
}

async function abrirUtenteDetalhe(page, nome) {
  await page.click('.mc-bb-item:has-text("Utentes")');
  await page.waitForTimeout(150);
  await page.click(`.utente-card:has-text("${nome}")`);
  await page.waitForTimeout(250);
}

export async function run(browser) {
  /* ============================================================
   * 1. UTENTES — criar, validar, pesquisar, persistência
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirPim(browser, 'PimUtentes');

    await criarUtenteViaUI(page, 'Maria Utente QA');
    const apareceu = await page.locator('.utente-card:has-text("Maria Utente QA")').count();
    ok('PIM utentes: criar utente via UI faz aparecer o cartão na lista', apareceu === 1);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.click('.mc-bb-item:has-text("Utentes")');
    await page.waitForTimeout(200);
    const sobrevive = await page.locator('.utente-card:has-text("Maria Utente QA")').count();
    ok('PIM utentes: utente sobrevive a um reload da página (persistiu no servidor)', sobrevive === 1);

    let estado = await estadoServidor(token);
    const utentesServidor = (estado.pim && estado.pim.pim_utentes_v1) || [];
    ok('PIM utentes: GET /api/data confirma o utente gravado em pim.pim_utentes_v1', utentesServidor.some(u => u.nome === 'Maria Utente QA'));

    // Validação: nome obrigatório
    await page.click('#viewUtentes button:has-text("Novo utente")');
    await page.waitForSelector('#utenteModalOverlay.open');
    await page.click('#utenteModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(300);
    const modalAindaAberto = await page.locator('#utenteModalOverlay.open').count();
    estado = await estadoServidor(token);
    const contagemDepois = ((estado.pim && estado.pim.pim_utentes_v1) || []).length;
    ok('PIM utentes: guardar sem nome é bloqueado (modal continua aberto, nenhum utente extra criado)',
      modalAindaAberto === 1 && contagemDepois === utentesServidor.length);
    await page.click('#utenteModalOverlay button:has-text("Cancelar")');

    // Pesquisa
    await criarUtenteViaUI(page, 'Zulmira Segunda QA');
    await page.click('.mc-bb-item:has-text("Utentes")');
    await page.waitForTimeout(150);
    await page.fill('#utentesSearch', 'Zulmira');
    await page.waitForTimeout(150);
    const visiveisZulmira = await page.locator('.utente-card').count();
    const contemZulmira = await page.locator('.utente-card:has-text("Zulmira Segunda QA")').count();
    const contemMaria = await page.locator('.utente-card:has-text("Maria Utente QA")').count();
    ok('PIM utentes: pesquisa filtra para mostrar só o utente correspondente', visiveisZulmira === 1 && contemZulmira === 1 && contemMaria === 0);

    await ctx.close();
  }

  /* ============================================================
   * 2. MEDICAMENTOS + STOCK + SCANNER (DataMatrix) + RÓTULO (dedução)
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirPim(browser, 'PimMeds');
    await criarUtenteViaUI(page, 'Utente Medicação QA');
    await abrirUtenteDetalhe(page, 'Utente Medicação QA');

    // Validação: nome do medicamento obrigatório
    await page.click('#udetailSubtabs button[data-tab="medicamentos"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Novo medicamento")');
    await page.waitForSelector('#medModalOverlay.open');
    await page.click('#medModalOverlay button:has-text("Guardar medicamento")');
    await page.waitForTimeout(300);
    let estado = await estadoServidor(token);
    const medsAntes = (estado.pim && estado.pim.pim_medicamentos_v1) || [];
    ok('PIM medicamentos: guardar sem nome é bloqueado (nenhum medicamento criado)',
      (await page.locator('#medModalOverlay.open').count()) === 1 && medsAntes.length === 0);

    // Criar medicamento real (nome livre) com posologia PA=1 (para o teste de rótulo abaixo)
    await page.click('#medModalOverlay button:has-text("Nome livre")');
    await page.fill('#medModalOverlay input[oninput*="draftMed.nomeComercial"]', 'Paracetamol QA');
    await page.fill(`#medModalOverlay input[oninput*="posologia['PA']"]`, '1');
    await page.click('#medModalOverlay button:has-text("Guardar medicamento")');
    await page.waitForTimeout(400);
    const medApareceu = await page.locator('#udetailTabContent:has-text("Paracetamol QA")').count();
    ok('PIM medicamentos: criar medicamento (nome livre + posologia) aparece na ficha do utente', medApareceu >= 1);

    estado = await estadoServidor(token);
    const medsDepois = (estado.pim && estado.pim.pim_medicamentos_v1) || [];
    const paracetamol = medsDepois.find(m => m.nomeComercial === 'Paracetamol QA');
    ok('PIM medicamentos: persiste com a posologia correta (PA=1)', !!paracetamol && paracetamol.posologia && paracetamol.posologia.PA === '1');

    // Adicionar embalagem manual (Stock)
    await page.click('#udetailSubtabs button[data-tab="stock"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Nova embalagem")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.lote"]', 'LOTE-MANUAL');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.validade"]', '2027-01-01');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.unidadesEmbalagem"]', '100');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.quantidadeAtual"]', '100');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);
    estado = await estadoServidor(token);
    let stockServidor = (estado.pim && estado.pim.pim_stock_v1) || [];
    let itemManual = stockServidor.find(s => s.lote === 'LOTE-MANUAL');
    ok('PIM stock: criar embalagem manual persiste com a quantidade indicada (100)', !!itemManual && Number(itemManual.quantidadeAtual) === 100);

    // Ajuste rápido de quantidade (+/-)
    const linhaManual = page.locator('.stock-row:has-text("LOTE-MANUAL")');
    await linhaManual.locator('.stock-qty button:has-text("+")').click();
    await page.waitForTimeout(250);
    estado = await estadoServidor(token);
    itemManual = ((estado.pim && estado.pim.pim_stock_v1) || []).find(s => s.lote === 'LOTE-MANUAL');
    ok('PIM stock: botão "+" incrementa e persiste a quantidade (100 -> 101)', Number(itemManual.quantidadeAtual) === 101);

    await linhaManual.locator('.stock-qty button:has-text("−")').click();
    await linhaManual.locator('.stock-qty button:has-text("−")').click();
    await page.waitForTimeout(250);
    estado = await estadoServidor(token);
    itemManual = ((estado.pim && estado.pim.pim_stock_v1) || []).find(s => s.lote === 'LOTE-MANUAL');
    ok('PIM stock: botão "−" decrementa e persiste a quantidade (101 -> 99)', Number(itemManual.quantidadeAtual) === 99);

    // ---- Histórico de Embalagens: ganhou Editar/Remover (pedido do Ivo, 2026-09-13) ----
    await page.click('#udetailSubtabs button[data-tab="historico"]');
    await page.waitForTimeout(200);
    const linhaHistEmbalagem = page.locator('#udetailTabContent tr', { hasText: 'LOTE-MANUAL' });
    ok('PIM Histórico de Embalagens: a linha da embalagem tem agora botões Editar/Remover',
      (await linhaHistEmbalagem.locator('button[title="Editar"]').count()) === 1 &&
      (await linhaHistEmbalagem.locator('button[title="Remover"]').count()) === 1);

    // ---- Histórico de Consumo: novo separador editável (pedido do Ivo, 2026-09-13) ----
    // A embalagem manual já gerou 4 registos até aqui: 1 "entrada" (ao criar) + 3 "ajuste manual" (+1, -1, -1).
    await page.click('#udetailSubtabs button[data-tab="consumo"]');
    await page.waitForTimeout(200);
    let linhasConsumoLote = page.locator('#udetailTabContent tr', { hasText: 'LOTE-MANUAL' });
    ok('PIM Histórico de Consumo: mostra os 4 registos reais já gerados por esta embalagem (entrada + 3 ajustes)',
      (await linhasConsumoLote.count()) === 4);

    // Adicionar um registo manual
    await page.click('#udetailTabContent button:has-text("Novo registo manual")');
    await page.waitForSelector('#consumoModalOverlay.open');
    await page.selectOption('#consumoModalOverlay select[onchange*="draftConsumo.tipo"]', 'ajuste manual');
    await page.fill('#consumoModalOverlay input[oninput*="draftConsumo.quantidade"]', '5');
    await page.fill('#consumoModalOverlay textarea[oninput*="draftConsumo.notas"]', 'Nota QA manual');
    await page.click('#consumoModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(300);
    linhasConsumoLote = page.locator('#udetailTabContent tr', { hasText: 'LOTE-MANUAL' });
    ok('PIM Histórico de Consumo: "+ Novo registo manual" acrescenta uma linha nova (4 -> 5)', (await linhasConsumoLote.count()) === 5);
    let estadoConsumo = await estadoServidor(token);
    let stockComHist = ((estadoConsumo.pim && estadoConsumo.pim.pim_stock_v1) || []).find(s => s.lote === 'LOTE-MANUAL');
    let novoRegisto = (stockComHist.historico || []).find(h => h.notas === 'Nota QA manual');
    ok('PIM Histórico de Consumo: o registo manual persiste no servidor com a quantidade indicada', !!novoRegisto && Number(novoRegisto.quantidade) === 5);

    // Editar esse registo
    const linhaNota = page.locator('#udetailTabContent tr', { hasText: 'Nota QA manual' });
    await linhaNota.locator('button[title="Editar"]').click();
    await page.waitForSelector('#consumoModalOverlay.open');
    await page.fill('#consumoModalOverlay input[oninput*="draftConsumo.quantidade"]', '9');
    await page.click('#consumoModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(300);
    estadoConsumo = await estadoServidor(token);
    stockComHist = ((estadoConsumo.pim && estadoConsumo.pim.pim_stock_v1) || []).find(s => s.lote === 'LOTE-MANUAL');
    novoRegisto = (stockComHist.historico || []).find(h => h.notas === 'Nota QA manual');
    ok('PIM Histórico de Consumo: editar um registo existente atualiza o valor persistido (5 -> 9)', Number(novoRegisto.quantidade) === 9);

    // Eliminar esse registo
    await page.locator('#udetailTabContent tr', { hasText: 'Nota QA manual' }).locator('button[title="Eliminar"]').click();
    await page.waitForTimeout(300);
    linhasConsumoLote = page.locator('#udetailTabContent tr', { hasText: 'LOTE-MANUAL' });
    ok('PIM Histórico de Consumo: eliminar o registo remove a linha (5 -> 4)', (await linhasConsumoLote.count()) === 4);
    estadoConsumo = await estadoServidor(token);
    stockComHist = ((estadoConsumo.pim && estadoConsumo.pim.pim_stock_v1) || []).find(s => s.lote === 'LOTE-MANUAL');
    ok('PIM Histórico de Consumo: o registo eliminado também desaparece do servidor', !(stockComHist.historico || []).some(h => h.notas === 'Nota QA manual'));

    // As 3 ações acima (criar/editar/eliminar registo de consumo) ficam
    // registadas em Poupança & ROI (ponto 127, pedido do Ivo: "registos
    // intensivos em tempo para novas funções"). registarUso() faz debounce
    // de 2s antes de enviar para o servidor (ver assets/module-chrome.js),
    // por isso esperamos mais do que isso antes de verificar.
    await page.waitForTimeout(2500);
    {
      const hoje = new Date();
      const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
      const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
      const res = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = JSON.parse(res.body);
      const parsed = body.content ? JSON.parse(body.content) : { dias: {} };
      const dia = parsed.dias?.[diaChave] || {};
      ok('PIM Histórico de Consumo: criar/editar/eliminar registo ficam todos registados em Poupança & ROI',
        (dia['pim.criar_registo_consumo'] || 0) === 1 && (dia['pim.editar_registo_consumo'] || 0) === 1 && (dia['pim.eliminar_registo_consumo'] || 0) === 1,
        JSON.stringify(dia));
    }

    // ---- Regressão: scanner DataMatrix, botão "✅ Usar estes dados" ----
    await page.click('#udetailSubtabs button[data-tab="medicamentos"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Novo medicamento")');
    await page.waitForSelector('#medModalOverlay.open');
    await page.click('#medModalOverlay button:has-text("Nome livre")');
    await page.fill('#medModalOverlay input[oninput*="draftMed.nomeComercial"]', 'Ibuprofeno QA Scan');
    await page.click('#medModalOverlay button:has-text("Scanear embalagem")');
    await page.waitForSelector('#medScanBox #hw_medScan');
    const codigoGS1 = '(01)07612345678903(17)251231(10)LOTE9XZ(21)SN00456(714)1234567';
    await page.fill('#medScanBox #hw_medScan', codigoGS1);
    await page.click('#medScanBox button:has-text("Analisar código")');
    await page.waitForTimeout(200);
    await page.click('#medModalOverlay button:has-text("Usar estes dados")');
    await page.waitForTimeout(200);
    const pcAplicado = await page.locator('#medModalOverlay input[oninput*="draftMed.pcInicial"]').inputValue();
    const loteAplicado = await page.locator('#medModalOverlay input[oninput*="draftMed.loteInicial"]').inputValue();
    const validadeAplicada = await page.locator('#medModalOverlay input[oninput*="draftMed.validadeInicial"]').inputValue();
    ok('PIM scanner DataMatrix: "Usar estes dados" aplica PC/Lote/Validade lidos do código GS1 ao formulário',
      pcAplicado === '07612345678903' && loteAplicado === 'LOTE9XZ' && validadeAplicada === '2025-12-31',
      `pc=${pcAplicado} lote=${loteAplicado} validade=${validadeAplicada}`);
    await page.click('#medModalOverlay button:has-text("Guardar medicamento")');
    await page.waitForTimeout(400);
    estado = await estadoServidor(token);
    const ibuprofeno = ((estado.pim && estado.pim.pim_medicamentos_v1) || []).find(m => m.nomeComercial === 'Ibuprofeno QA Scan');
    const stockIbuprofeno = ((estado.pim && estado.pim.pim_stock_v1) || []).find(s => s.medicamentoId === (ibuprofeno && ibuprofeno.id));
    ok('PIM scanner DataMatrix: medicamento + 1ª embalagem (dados do scan) ficam persistidos no servidor',
      !!ibuprofeno && ibuprofeno.cnp === '1234567' && !!stockIbuprofeno && stockIbuprofeno.lote === 'LOTE9XZ' && stockIbuprofeno.pc === '07612345678903');

    // ---- Rótulo: dedução automática de stock ao guardar ----
    await page.click('#udetailSubtabs button[data-tab="rotulos"]');
    await page.waitForTimeout(400);
    // O nome do medicamento na linha do rótulo é o VALUE de um <input>, não texto
    // visível (:has-text não o apanha) — verifica-se o atributo diretamente.
    const linhaRotuloVisivel = await page.locator('.rot-table input[value="Paracetamol QA"]').count();
    ok('PIM rótulo: linha do medicamento ativo é gerada automaticamente a partir da posologia', linhaRotuloVisivel >= 1);
    await page.click('#udetailTabContent button:has-text("Guardar rótulo")');
    await page.waitForTimeout(400);
    estado = await estadoServidor(token);
    itemManual = ((estado.pim && estado.pim.pim_stock_v1) || []).find(s => s.lote === 'LOTE-MANUAL');
    // 99 - (1 unidade/dia de posologia PA * 7 dias do período padrão do rótulo) = 92
    ok('PIM rótulo: guardar deduz do stock (posologia diária × dias do período) — 99 -> 92',
      Number(itemManual.quantidadeAtual) === 92, `quantidadeAtual=${itemManual.quantidadeAtual}`);

    await ctx.close();
  }

  /* ============================================================
   * 3. CALENDÁRIO — validação + criar evento de entrega
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirPim(browser, 'PimCal');
    await criarUtenteViaUI(page, 'Utente Calendario QA');

    await page.click('.mc-bb-item:has-text("Calendário")');
    await page.waitForTimeout(200);
    await page.click('#viewCalendario button:has-text("Novo evento")');
    await page.waitForSelector('#eventModalOverlay.open');

    // Validação: sem utente escolhido
    await page.click('#eventModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(250);
    let estado = await estadoServidor(token);
    const eventosAntes = ((estado.pim && estado.pim.pim_eventos_v1) || []).length;
    ok('PIM calendário: guardar evento sem utente escolhido é bloqueado',
      (await page.locator('#eventModalOverlay.open').count()) === 1 && eventosAntes === 0);

    await page.selectOption('#eventModalOverlay .field-block.full select', { label: 'Utente Calendario QA' });
    await page.fill('#eventModalOverlay input[type="date"]', '2026-09-20');
    await page.selectOption('#eventModalOverlay .form-grid > .field-block:not(.full) select', 'entrega');
    await page.waitForTimeout(150);
    await page.fill('#eventModalOverlay input[oninput*="draftEvento.lote"]', 'LOTE-EVT');
    await page.fill('#eventModalOverlay input[oninput*="draftEvento.responsavelEntrega"]', 'Téc. QA');
    await page.fill('#eventModalOverlay input[oninput*="draftEvento.proximoLevantamento"]', '2026-10-01');
    await page.click('#eventModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    estado = await estadoServidor(token);
    const eventos = (estado.pim && estado.pim.pim_eventos_v1) || [];
    const evento = eventos.find(e => e.lote === 'LOTE-EVT');
    ok('PIM calendário: criar evento de entrega persiste os campos preenchidos',
      !!evento && evento.tipo === 'entrega' && evento.responsavelEntrega === 'Téc. QA' && evento.proximoLevantamento === '2026-10-01' && evento.data === '2026-09-20');

    /* --------------------------------------------------------
     * RECEITAS (mesma farmácia/utente) — validação + criar
     * -------------------------------------------------------- */
    await abrirUtenteDetalhe(page, 'Utente Calendario QA');
    await page.click('#udetailSubtabs button[data-tab="receitas"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Nova receita")');
    await page.waitForSelector('#receitaModalOverlay.open');
    await page.click('#receitaModalOverlay button:has-text("Guardar receita")');
    await page.waitForTimeout(250);
    estado = await estadoServidor(token);
    const receitasAntes = ((estado.pim && estado.pim.pim_receitas_v1) || []).length;
    ok('PIM receitas: guardar sem nenhum código/ficheiro é bloqueado',
      (await page.locator('#receitaModalOverlay.open').count()) === 1 && receitasAntes === 0);

    await page.fill('#receitaModalOverlay input[oninput*="draftReceita.numeroReceita"]', 'REC-0099');
    await page.click('#receitaModalOverlay button:has-text("Guardar receita")');
    await page.waitForTimeout(400);
    estado = await estadoServidor(token);
    const receitas = (estado.pim && estado.pim.pim_receitas_v1) || [];
    ok('PIM receitas: criar receita com código persiste corretamente', receitas.some(r => r.numeroReceita === 'REC-0099'));

    await ctx.close();
  }

  /* ============================================================
   * 4. REMOÇÃO EM CASCATA — utente e medicamento
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirPim(browser, 'PimCascade');

    // 4a. Remover utente -> medicamentos, stock e eventos associados desaparecem
    await criarUtenteViaUI(page, 'Utente A Remover QA');
    await abrirUtenteDetalhe(page, 'Utente A Remover QA');
    await page.click('#udetailSubtabs button[data-tab="medicamentos"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Novo medicamento")');
    await page.waitForSelector('#medModalOverlay.open');
    await page.click('#medModalOverlay button:has-text("Nome livre")');
    await page.fill('#medModalOverlay input[oninput*="draftMed.nomeComercial"]', 'MedCascade1');
    await page.click('#medModalOverlay button:has-text("Guardar medicamento")');
    await page.waitForTimeout(300);
    await page.click('#udetailSubtabs button[data-tab="stock"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Nova embalagem")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.lote"]', 'LOTE-CASC1');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(300);

    let estado = await estadoServidor(token);
    const utenteARemover = ((estado.pim && estado.pim.pim_utentes_v1) || []).find(u => u.nome === 'Utente A Remover QA');
    ok('PIM cascata: pré-condição — utente, medicamento e stock existem antes da remoção',
      !!utenteARemover &&
      ((estado.pim.pim_medicamentos_v1 || []).some(m => m.utenteId === utenteARemover.id)) &&
      ((estado.pim.pim_stock_v1 || []).some(s => s.utenteId === utenteARemover.id)));

    await page.click('#viewUtenteDetalhe button:has-text("Remover utente")');
    await page.waitForTimeout(400);

    estado = await estadoServidor(token);
    const utentesDepois = estado.pim.pim_utentes_v1 || [];
    const medsDepois = estado.pim.pim_medicamentos_v1 || [];
    const stockDepois = estado.pim.pim_stock_v1 || [];
    ok('PIM cascata: remover utente elimina também os seus medicamentos e stock (mantém-se apenas os de outros utentes)',
      !utentesDepois.some(u => u.id === utenteARemover.id) &&
      !medsDepois.some(m => m.utenteId === utenteARemover.id) &&
      !stockDepois.some(s => s.utenteId === utenteARemover.id));

    // 4b. Remover só o medicamento -> stock desse medicamento desaparece, utente e outro medicamento mantêm-se
    await criarUtenteViaUI(page, 'Utente B Manter QA');
    await abrirUtenteDetalhe(page, 'Utente B Manter QA');
    await page.click('#udetailSubtabs button[data-tab="medicamentos"]');
    await page.waitForTimeout(150);
    for (const nome of ['MedManter', 'MedRemover']) {
      await page.click('#udetailTabContent button:has-text("Novo medicamento")');
      await page.waitForSelector('#medModalOverlay.open');
      await page.click('#medModalOverlay button:has-text("Nome livre")');
      await page.fill('#medModalOverlay input[oninput*="draftMed.nomeComercial"]', nome);
      await page.click('#medModalOverlay button:has-text("Guardar medicamento")');
      await page.waitForTimeout(300);
    }
    await page.click('#udetailSubtabs button[data-tab="stock"]');
    await page.waitForTimeout(150);
    // adiciona uma embalagem a cada um dos dois medicamentos (o botão "+ Adicionar a
    // primeira embalagem" de cada secção já pré-seleciona o medicamento correto)
    for (const [nomeMed, lote] of [['MedManter', 'LOTE-FICA'], ['MedRemover', 'LOTE-VAI']]) {
      await page.click(`.mgmt-section:has-text("${nomeMed}") button:has-text("Adicionar a primeira embalagem")`);
      await page.waitForSelector('#stockModalOverlay.open');
      await page.fill('#stockModalOverlay input[oninput*="draftStock.lote"]', lote);
      await page.click('#stockModalOverlay button:has-text("Guardar")');
      await page.waitForTimeout(300);
    }

    estado = await estadoServidor(token);
    const utenteB = (estado.pim.pim_utentes_v1 || []).find(u => u.nome === 'Utente B Manter QA');
    const medRemoverObj = (estado.pim.pim_medicamentos_v1 || []).find(m => m.utenteId === utenteB.id && m.nomeComercial === 'MedRemover');
    ok('PIM cascata: pré-condição — 2º utente tem dois medicamentos, cada um com a sua embalagem', !!medRemoverObj &&
      (estado.pim.pim_stock_v1 || []).some(s => s.medicamentoId === medRemoverObj.id && s.lote === 'LOTE-VAI'));

    await page.click('#udetailSubtabs button[data-tab="medicamentos"]');
    await page.waitForTimeout(150);
    await page.click(`.mgmt-item-row:has-text("MedRemover") .icon-btn.danger`);
    await page.waitForTimeout(400);

    estado = await estadoServidor(token);
    const utentesFinal = estado.pim.pim_utentes_v1 || [];
    const medsFinal = estado.pim.pim_medicamentos_v1 || [];
    const stockFinal = estado.pim.pim_stock_v1 || [];
    ok('PIM cascata: remover um medicamento específico elimina só o seu stock, mantendo utente e o outro medicamento',
      utentesFinal.some(u => u.id === utenteB.id) &&
      medsFinal.some(m => m.utenteId === utenteB.id && m.nomeComercial === 'MedManter') &&
      !medsFinal.some(m => m.id === medRemoverObj.id) &&
      !stockFinal.some(s => s.medicamentoId === medRemoverObj.id) &&
      stockFinal.some(s => s.lote === 'LOTE-FICA'));

    await ctx.close();
  }

  /* ============================================================
   * 5. ALERTAS — validade expirada é contabilizada corretamente
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirPim(browser, 'PimAlertas');
    await criarUtenteViaUI(page, 'Utente Alerta QA');
    await abrirUtenteDetalhe(page, 'Utente Alerta QA');
    await page.click('#udetailSubtabs button[data-tab="medicamentos"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Novo medicamento")');
    await page.waitForSelector('#medModalOverlay.open');
    await page.click('#medModalOverlay button:has-text("Nome livre")');
    await page.fill('#medModalOverlay input[oninput*="draftMed.nomeComercial"]', 'MedExpirado QA');
    await page.click('#medModalOverlay button:has-text("Guardar medicamento")');
    await page.waitForTimeout(300);
    await page.click('#udetailSubtabs button[data-tab="stock"]');
    await page.waitForTimeout(150);
    await page.click('#udetailTabContent button:has-text("Nova embalagem")');
    await page.waitForSelector('#stockModalOverlay.open');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.lote"]', 'LOTE-EXPIRADO');
    await page.fill('#stockModalOverlay input[oninput*="draftStock.validade"]', '2020-05-15');
    await page.click('#stockModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(400);

    const statValidades = await page.locator('#statValidades').textContent();
    ok('PIM alertas: estatística do cabeçalho conta a embalagem expirada (statValidades=1)', statValidades.trim() === '1');

    await page.click('.mc-bb-item:has-text("Alertas")');
    await page.waitForTimeout(300);
    const secExpirados = page.locator('.mgmt-section:has-text("Validades expiradas")');
    const textoSecao = await secExpirados.count() ? await secExpirados.first().innerText() : '';
    ok('PIM alertas: vista de Alertas mostra o utente/medicamento na secção "Validades expiradas (1)"',
      textoSecao.includes('Validades expiradas (1)') && textoSecao.includes('MedExpirado QA') && textoSecao.includes('Utente Alerta QA'));

    await ctx.close();
  }
}
