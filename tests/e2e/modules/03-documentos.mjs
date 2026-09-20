/**
 * Testes e2e do módulo Central de Documentos (modulos/documentos.html) — o
 * módulo mais rico da app: pastas/biblioteca de ficheiros, declarações
 * personalizadas, e "livros" com campos de pesquisa personalizados.
 *
 * Cada verificação exerce uma ação real de utilizador (clicar, preencher,
 * guardar) e confirma um efeito real — o DOM mudou, o servidor persistiu o
 * dado (via /api/data), ou um filtro de pesquisa produziu exatamente o
 * resultado esperado. Farmácia de teste sempre criada com signupFarmacia(),
 * nunca partilhada com outros ficheiros de tests/e2e/modules/.
 *
 * NOTA: as vistas "Bolachas", "Etiquetas", "Lombadas" e "Separadores" usam
 * um motor de posicionamento por arrastar/largar (pointerdown/pointermove)
 * que não é razoável simular com fiabilidade em Playwright — por isso não
 * são cobertas aqui (omissão deliberada, não descuido). "Listas de
 * Inscrição" é coberta por ser uma funcionalidade puramente formulário +
 * cálculo, sem interação de arrastar.
 */
import { ok, apiFetch, abrirModulo } from '../helpers.mjs';

async function poll(fn, { tries = 12, delay = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

export async function run(browser) {
  const { ctx, page, token } = await abrirModulo(browser, 'documentos', { prefixo: 'DocsQA' });

  async function estadoAtual() {
    return JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body);
  }
  async function esperarFolder(nome) {
    return poll(async () => {
      const estado = await estadoAtual();
      return Object.values(estado.documentos?.cdocs_folders_v1 || {}).find(f => f.name === nome) || null;
    });
  }

  // ---------- 1. Dashboard inicial mostra as categorias reais do módulo ----------
  const catCount = await page.locator('#homeGrid .folder-card').count();
  ok('Documentos: painel inicial renderiza as 8 categorias do módulo', catCount === 8, `count=${catCount}`);

  // ---------- 2. Navegar para Pastas ----------
  await page.click('.mc-bb-item:has-text("Pastas")');
  await page.waitForTimeout(300);

  // ---------- 3. Validação: não deixa criar pasta sem nome ----------
  await page.click('#pastasActions button');
  await page.waitForTimeout(150);
  await page.fill('#fm_name', '');
  await page.click('#folderModalOverlay button:has-text("Guardar")');
  const stillOpenSemNome = await page.locator('#folderModalOverlay.open').count();
  ok('Documentos/Pastas: guardar sem nome não fecha o modal (bloqueado)', stillOpenSemNome === 1);
  await page.click('#folderModalOverlay button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 4. Criar pasta real via UI ----------
  await page.click('#pastasActions button');
  await page.fill('#fm_name', 'Receitas Especiais QA');
  await page.click('#folderModalOverlay button:has-text("Guardar")');
  await page.waitForTimeout(300);
  const folder1Visible = await page.locator('.folder-card h3:has-text("Receitas Especiais QA")').count();
  ok('Documentos/Pastas: criar pasta faz aparecer o cartão na grelha', folder1Visible === 1);

  const folder1 = await esperarFolder('Receitas Especiais QA');
  ok('Documentos/Pastas: pasta persistida no servidor via /api/data', !!folder1);

  // ---------- 5. Segunda pasta + pesquisa filtra corretamente ----------
  await page.click('#pastasActions button');
  await page.fill('#fm_name', 'Contratos Legais QA');
  await page.click('#folderModalOverlay button:has-text("Guardar")');
  await page.waitForTimeout(300);
  await esperarFolder('Contratos Legais QA');

  await page.fill('#pastasSearch', 'Especiais');
  await page.waitForTimeout(200);
  const nomesFiltrados = await page.locator('#pastasContent h3').allTextContents();
  ok('Documentos/Pastas: pesquisa mostra só a pasta correspondente',
    nomesFiltrados.length === 1 && nomesFiltrados[0].includes('Especiais'), JSON.stringify(nomesFiltrados));
  await page.fill('#pastasSearch', '');
  await page.waitForTimeout(150);

  // ---------- 6. Upload de documento real dentro da pasta ----------
  await page.click('.folder-card:has-text("Receitas Especiais QA")');
  await page.waitForTimeout(200);
  await page.setInputFiles('#docUploadInput', {
    name: 'receita-teste.pdf', mimeType: 'application/pdf', buffer: Buffer.from('CONTEUDO-PDF-TESTE-QA')
  });
  await page.waitForTimeout(500);
  const docListado = await page.locator('.doc-row .dinfo b:has-text("receita-teste.pdf")').count();
  ok('Documentos/Pastas: documento carregado aparece na lista da pasta', docListado === 1);

  const docPersistido = await poll(async () => {
    const estado = await estadoAtual();
    return Object.values(estado.documentos?.cdocs_documents_v1 || {}).find(d => d.name === 'receita-teste.pdf' && d.folderId === folder1.id) || null;
  });
  ok('Documentos/Pastas: documento persistido no servidor com a pasta correta', !!docPersistido);

  // ---------- 7. Renomear documento ----------
  await page.click('.doc-row button[title="Renomear"]');
  await page.fill('#dm_name', 'receita-teste-renomeada.pdf');
  await page.click('#docModalOverlay button:has-text("Guardar")');
  await page.waitForTimeout(300);
  const renomeado = await page.locator('.doc-row .dinfo b:has-text("receita-teste-renomeada.pdf")').count();
  ok('Documentos/Pastas: renomear documento atualiza o nome na lista', renomeado === 1);

  // ---------- 8. Eliminar documento ----------
  page.once('dialog', d => d.accept());
  await page.click('.doc-row button[title="Eliminar"]');
  await page.waitForTimeout(300);
  const semDocs = await page.locator('.doc-row').count();
  ok('Documentos/Pastas: eliminar documento remove-o da lista', semDocs === 0);

  const docRemovidoDoServidor = await poll(async () => {
    const estado = await estadoAtual();
    return !Object.values(estado.documentos?.cdocs_documents_v1 || {}).some(d => d.id === docPersistido.id);
  });
  ok('Documentos/Pastas: eliminação de documento persiste (não reaparece em /api/data)', !!docRemovidoDoServidor);

  // ---------- 9. Eliminar pasta ----------
  await page.click('#pastasCrumb a');
  await page.waitForTimeout(200);
  await page.click('.folder-card:has-text("Contratos Legais QA") .folder-menu-btn');
  await page.waitForTimeout(100);
  page.once('dialog', d => d.accept());
  await page.click('.folder-menu.open button.danger');
  await page.waitForTimeout(300);
  const pastaEliminadaDaGrelha = await page.locator('.folder-card h3:has-text("Contratos Legais QA")').count();
  ok('Documentos/Pastas: eliminar pasta remove-a da grelha', pastaEliminadaDaGrelha === 0);

  const pastaRemovidaDoServidor = await poll(async () => {
    const estado = await estadoAtual();
    return !Object.values(estado.documentos?.cdocs_folders_v1 || {}).some(f => f.name === 'Contratos Legais QA');
  });
  ok('Documentos/Pastas: eliminação de pasta persiste no servidor', !!pastaRemovidaDoServidor);

  // ---------- 10. Persistência real através de reload (nova página, mesma sessão) ----------
  const page2 = await ctx.newPage();
  await page2.goto(page.url(), { waitUntil: 'load', timeout: 15000 });
  await page2.waitForTimeout(1200);
  await page2.click('.mc-bb-item:has-text("Pastas")');
  await page2.waitForTimeout(400);
  const folderAposReload = await page2.locator('.folder-card h3:has-text("Receitas Especiais QA")').count();
  ok('Documentos/Pastas: a pasta criada continua visível depois de recarregar a página', folderAposReload === 1);
  await page2.close();

  // ==================== DECLARAÇÕES ====================
  await page.click('.mc-bb-item:has-text("Declarações")');
  await page.waitForTimeout(300);

  // ---------- 11. Validação: não deixa criar declaração personalizada sem título ----------
  await page.click('button:has-text("+ Nova declaração")');
  await page.waitForTimeout(150);
  await page.fill('#ncd_titlePt', '');
  await page.click('#ncd_saveBtn');
  const declModalAindaAberto = await page.locator('#customDeclModalOverlay.open').count();
  ok('Documentos/Declarações: guardar sem título não fecha o modal (bloqueado)', declModalAindaAberto === 1);
  await page.click('#customDeclModalOverlay button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 12. Criar declaração personalizada real ----------
  await page.click('button:has-text("+ Nova declaração")');
  await page.fill('#ncd_titlePt', 'Declaração de Entrega QA');
  await page.fill('#ncd_titleEn', 'QA Handover Declaration');
  await page.click('#ncd_saveBtn');
  await page.waitForTimeout(300);
  const declCriada = await page.locator('.decl-card h3:has-text("Declaração de Entrega QA")').count();
  ok('Documentos/Declarações: criar declaração personalizada aparece na grelha', declCriada === 1);

  const declPersistida = await poll(async () => {
    const estado = await estadoAtual();
    return Object.values(estado.documentos?.cdocs_customdecl_v1 || {}).find(d => d.titlePt === 'Declaração de Entrega QA') || null;
  });
  ok('Documentos/Declarações: declaração personalizada persistida no servidor', !!declPersistida);

  // ---------- 13. Pesquisa de declarações filtra corretamente ----------
  await page.fill('#declSearch', 'Entrega QA');
  await page.waitForTimeout(200);
  const resultadosDecl = await page.locator('#declGrid h3').allTextContents();
  ok('Documentos/Declarações: pesquisa devolve só a declaração correspondente',
    resultadosDecl.length === 1 && resultadosDecl[0].includes('Entrega QA'), JSON.stringify(resultadosDecl));
  await page.fill('#declSearch', '');
  await page.waitForTimeout(150);

  // ---------- 14. Editar declaração personalizada ----------
  await page.click('.decl-card:has-text("Declaração de Entrega QA") .folder-menu-btn');
  await page.waitForTimeout(100);
  await page.click('.folder-menu.open button:has-text("✎ Editar")');
  await page.waitForTimeout(150);
  await page.fill('#ncd_titlePt', 'Declaração de Entrega QA (Revista)');
  await page.click('#ncd_saveBtn');
  await page.waitForTimeout(300);
  const declEditada = await page.locator('.decl-card h3:has-text("Declaração de Entrega QA (Revista)")').count();
  ok('Documentos/Declarações: editar declaração personalizada atualiza o título', declEditada === 1);

  // ---------- 15. Eliminar declaração personalizada ----------
  await page.click('.decl-card:has-text("Declaração de Entrega QA (Revista)") .folder-menu-btn');
  await page.waitForTimeout(100);
  page.once('dialog', d => d.accept());
  await page.click('.folder-menu.open button.danger');
  await page.waitForTimeout(300);
  const declEliminadaDaGrelha = await page.locator('.decl-card:has-text("Declaração de Entrega QA")').count();
  ok('Documentos/Declarações: eliminar declaração personalizada remove-a da grelha', declEliminadaDaGrelha === 0);

  const declRemovidaDoServidor = await poll(async () => {
    const estado = await estadoAtual();
    return !Object.values(estado.documentos?.cdocs_customdecl_v1 || {}).some(d => d.id === declPersistida.id);
  });
  ok('Documentos/Declarações: eliminação de declaração personalizada persiste no servidor', !!declRemovidaDoServidor);

  // ==================== EDITOR DE DECLARAÇÕES (pontos 123/124/125) ====================
  // Grava alterações no /api/data sem destruir o resto do estado já
  // acumulado neste teste (pastas/declarações criadas acima) — o mesmo
  // padrão de merge que gravarDocumentos()/gravarPim() usam no próprio módulo.
  async function gravarEstadoParcial(patch) {
    const estado = await estadoAtual();
    const mesclado = { ...estado };
    for (const [chave, valor] of Object.entries(patch)) {
      mesclado[chave] = (valor && typeof valor === 'object' && !Array.isArray(valor))
        ? { ...(estado[chave] || {}), ...valor }
        : valor;
    }
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mesclado)
    });
  }

  // ---------- 22. Abrir a Declaração de Medicação (ponto 123) mostra o formulário certo ----------
  await page.click('button:has-text("+ Nova declaração")');
  await page.click('#customDeclModalOverlay button:has-text("Cancelar")');
  await page.waitForTimeout(150);
  const medicacaoCardVisivel = await page.locator('.decl-card h3:has-text("Declaração de Medicação")').count();
  ok('Documentos/Declarações: "Declaração de Medicação" aparece na grelha de tipos', medicacaoCardVisivel === 1);

  await page.click('.decl-card:has-text("Declaração de Medicação")');
  await page.waitForTimeout(250);
  const editorAberto = await page.locator('#declEditorOverlay.open').count();
  ok('Documentos/Declarações: clicar no cartão abre o editor da declaração', editorAberto === 1);

  const medListBtnVisivel = await page.locator('.medlist-pull-btn').count();
  ok('Documentos/Declarações (Medicação): formulário mostra o botão "Puxar do PIM" e a lista de medicamentos vazia',
    medListBtnVisivel === 1);
  const listaVaziaMsg = await page.locator('.medlist-empty').count();
  ok('Documentos/Declarações (Medicação): lista de medicamentos começa vazia', listaVaziaMsg === 1);

  // ---------- 23. Adicionar medicamento manualmente (por DCI) atualiza a pré-visualização ----------
  // Refinado (2026-09-15, modelo aprovado pela farmácia): a linha passou a
  // ser DCI/dosagem/quantidade/forma farmacêutica, em vez de nome/dosagem/
  // posologia — ver medListHtml() e o bloco hasMedList em renderDeclForm().
  await page.click('.medlist-add');
  await page.waitForTimeout(150);
  const medlistInputs = page.locator('.medlist-row input');
  await medlistInputs.nth(0).fill('Paracetamol QA'); // DCI
  await medlistInputs.nth(1).fill('500 mg');         // dosagem
  await medlistInputs.nth(2).fill('30');              // quantidade
  await medlistInputs.nth(3).fill('comp revestido');  // forma farmacêutica
  await page.waitForTimeout(200);
  const previewComMed = await page.locator('#ps_body').innerText();
  ok('Documentos/Declarações (Medicação): medicamento adicionado manualmente (DCI) aparece na pré-visualização no formato "DCI: nome, dosagem x quantidade forma"',
    previewComMed.includes('DCI: Paracetamol QA') && previewComMed.includes('500 mg x 30 comp revestido'),
    previewComMed);

  // ---------- 24. Remover a linha esvazia a lista de novo ----------
  await page.click('.medlist-remove');
  await page.waitForTimeout(150);
  const listaVaziaDeNovo = await page.locator('.medlist-empty').count();
  ok('Documentos/Declarações (Medicação): remover a única linha volta a mostrar "lista vazia"', listaVaziaDeNovo === 1);
  await page.click('#declEditorOverlay .close-x');
  await page.waitForTimeout(150);

  // ---------- 25. "Puxar do PIM" traz a medicação real de um utente do PIM (dados escritos diretamente via /api/data, simulando o módulo PIM) ----------
  const utenteIdQA = 'u-qa-' + Date.now();
  const medIdQA = 'm-qa-' + Date.now();
  await gravarEstadoParcial({
    pim: {
      pim_utentes_v1: [{ id: utenteIdQA, nome: 'Utente PIM QA' }],
      pim_medicamentos_v1: [
        { id: medIdQA, utenteId: utenteIdQA, dci: 'Omeprazol QA', nomeComercial: 'Nome Comercial QA', dosagem: '20 mg', ativo: true, posologia: { JJ: '1', PA: '', AL: '', LA: '', JT: '', DT: '' } },
        { id: 'm-qa-inativo-' + Date.now(), utenteId: utenteIdQA, dci: 'Medicamento Descontinuado QA', dosagem: '10 mg', ativo: false }
      ]
    }
  });

  const page3 = await ctx.newPage();
  await page3.goto(page.url(), { waitUntil: 'load', timeout: 15000 });
  await page3.waitForTimeout(1000);
  await page3.click('.mc-bb-item:has-text("Declarações")');
  await page3.waitForTimeout(300);
  await page3.click('.decl-card:has-text("Declaração de Medicação")');
  await page3.waitForTimeout(250);
  await page3.fill('.decl-form-col input[type="text"]', 'Utente PIM QA');
  await page3.click('.medlist-pull-btn');
  await page3.waitForTimeout(400);
  const medlistRowsAposPull = await page3.locator('.medlist-row').count();
  ok('Documentos/Declarações (Medicação): "Puxar do PIM" traz só a medicação ativa do utente encontrado (1 linha, não 2)',
    medlistRowsAposPull === 1, `rows=${medlistRowsAposPull}`);
  const previewAposPull = await page3.locator('#ps_body').innerText();
  ok('Documentos/Declarações (Medicação): a medicação puxada do PIM usa a DCI (Omeprazol QA), não o nome comercial, e a descontinuada não aparece',
    previewAposPull.includes('DCI: Omeprazol QA') && !previewAposPull.includes('Nome Comercial QA') && !previewAposPull.includes('Descontinuado'),
    previewAposPull);

  // Puxar de novo não duplica a linha já trazida
  await page3.click('.medlist-pull-btn');
  await page3.waitForTimeout(300);
  const medlistRowsAposSegundoPull = await page3.locator('.medlist-row').count();
  ok('Documentos/Declarações (Medicação): puxar do PIM outra vez não duplica medicação já trazida',
    medlistRowsAposSegundoPull === 1, `rows=${medlistRowsAposSegundoPull}`);

  // ---------- 26. Registo de uso da tarefa "puxar_medicacao_pim" ----------
  const usoRegistado = await poll(async () => {
    const hoje = new Date();
    const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
    const res = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) return null;
    const body = JSON.parse(res.body);
    const parsed = body.content ? JSON.parse(body.content) : { dias: {} };
    const dia = parsed.dias?.[diaChave] || {};
    return (dia['documentos.puxar_medicacao_pim'] || 0) > 0 ? true : null;
  });
  ok('Documentos/Declarações (Medicação): "Puxar do PIM" fica registado em Poupança & ROI', !!usoRegistado);
  await page3.close();

  // ---------- 27. Ponto 124 — a "marca de água" (crédito de software no rodapé) deixou de aparecer ----------
  const psFootTexto = await page.locator('#ps_foot').innerText();
  const psFootVisivel = await page.locator('#ps_foot').isVisible();
  ok('Documentos/Declarações: o rodapé com o crédito de software ("...Central de Documentos") já não aparece em nenhuma declaração',
    psFootTexto.trim() === '' && !psFootVisivel, JSON.stringify({ psFootTexto, psFootVisivel }));

  // ---------- 28. Ponto 125 — sem config de morada/contacto: placeholder original mantém-se ----------
  const psContactSemConfig = await page.locator('#ps_contact').innerText();
  ok('Documentos/Declarações: sem config.morada/emailContacto/telefoneContacto, #ps_contact mostra o texto de exemplo original',
    psContactSemConfig === 'Clique para indicar a morada e contactos da farmácia', psContactSemConfig);

  // ---------- 29. Ponto 125 — com config completa, #ps_contact pré-preenche a partir de Configurações → Geral ----------
  await gravarEstadoParcial({ config: { morada: 'Rua das Declarações, 45, 2000-200 Santarém QA', cidade: 'Santarém', emailContacto: 'declaracoes@farmaciaqa.pt', telefoneContacto: '243 000 111' } });
  const page4 = await ctx.newPage();
  await page4.goto(page.url(), { waitUntil: 'load', timeout: 15000 });
  await page4.waitForTimeout(1000);
  await page4.click('.mc-bb-item:has-text("Declarações")');
  await page4.waitForTimeout(300);
  await page4.click('.decl-card:has-text("Declaração de Vacinação")');
  await page4.waitForTimeout(300);
  const psContactComConfig = await page4.locator('#ps_contact').innerText();
  ok('Documentos/Declarações: com config completa, #ps_contact pré-preenche morada + telefone + email da Aba Geral das Configurações',
    psContactComConfig.includes('Rua das Declarações, 45, 2000-200 Santarém QA') &&
    psContactComConfig.includes('243 000 111') &&
    psContactComConfig.includes('declaracoes@farmaciaqa.pt'),
    psContactComConfig);
  const psFootTambemEscondidoNoutroTipo = await page4.locator('#ps_foot').isVisible();
  ok('Documentos/Declarações: o rodapé (marca de água removida) também não aparece nos tipos de declaração pré-definidos (ex.: Vacinação)',
    !psFootTambemEscondidoNoutroTipo);
  const psDateValueComCidade = await page4.locator('#ps_datevalue').innerText();
  ok('Documentos/Declarações: "Local e data" passa a incluir a cidade da farmácia (config.cidade), não só a data',
    psDateValueComCidade.startsWith('Santarém, '), psDateValueComCidade);

  // ---------- 30. Modelo aprovado (2026-09-15): texto da Declaração de Medicação segue exatamente a redação e o formato "DCI: nome, dosagem x quantidade forma" ----------
  await page4.click('#declEditorOverlay .close-x');
  await page4.waitForTimeout(150);
  await page4.click('.mc-bb-item:has-text("Declarações")');
  await page4.waitForTimeout(300);
  await page4.click('.decl-card:has-text("Declaração de Medicação")');
  await page4.waitForTimeout(300);
  const declInputs4 = page4.locator('.decl-form-col input');
  await declInputs4.nth(0).fill('Maria Modelo QA'); // nome
  await declInputs4.nth(2).fill('123456789'); // nif (nome, doc, nif, nasc)
  await page4.click('.medlist-add');
  await page4.waitForTimeout(150);
  const medInputs4 = page4.locator('.medlist-row input');
  await medInputs4.nth(0).fill('Valproato semisódico QA');
  await medInputs4.nth(1).fill('500 mg');
  await medInputs4.nth(2).fill('60');
  await medInputs4.nth(3).fill('comp gastrorresistente');
  await page4.waitForTimeout(250);
  const previewModelo = await page4.locator('#ps_body').innerText();
  ok('Documentos/Declarações (Medicação): corpo segue o modelo aprovado — "adquiriu na ... em <cidade> ... com NIF:" e a lista por DCI',
    previewModelo.includes('Maria Modelo QA') &&
    previewModelo.includes('com NIF: 123456789') &&
    previewModelo.includes('adquiriu na') &&
    previewModelo.includes('em Santarém') &&
    previewModelo.includes('DCI: Valproato semisódico QA') &&
    previewModelo.includes('500 mg x 60 comp gastrorresistente') &&
    previewModelo.includes('Disponíveis para qualquer esclarecimento.'),
    previewModelo);
  await page4.close();

  // ==================== BIBLIOTECA (livros com campos personalizados) ====================
  await page.click('.mc-bb-item:has-text("Biblioteca")');
  await page.waitForTimeout(300);

  // ---------- 16. Criar livro do zero com um campo de pesquisa personalizado ----------
  await page.click('button:has-text("+ Novo livro")');
  await page.waitForTimeout(150);
  await page.fill('#nb_nome', 'Livro QA');
  await page.click('button:has-text("+ Adicionar campo")');
  await page.waitForTimeout(100);
  await page.fill('#nb_fieldsList input[type="text"]', 'Nº de Lote');
  await page.click('#newBiblioBookModalOverlay button:has-text("Criar livro")');
  await page.waitForTimeout(300);
  const livroVisivel = await page.locator('.folder-card h3:has-text("Livro QA")').count();
  ok('Documentos/Biblioteca: criar livro personalizado aparece na grelha', livroVisivel === 1);

  const livroPersistido = await poll(async () => {
    const estado = await estadoAtual();
    return Object.values(estado.documentos?.cdocs_biblio_books_v1 || {}).find(b => b.nome === 'Livro QA') || null;
  });
  ok('Documentos/Biblioteca: livro (com o campo personalizado) persistido no servidor',
    !!livroPersistido && Array.isArray(livroPersistido.fields) && livroPersistido.fields.some(f => f.label === 'Nº de Lote'));

  // ---------- 17. Adicionar documentos ao livro, preenchendo o campo personalizado ----------
  await page.click('.folder-card:has-text("Livro QA")');
  await page.waitForTimeout(200);
  await page.click('#bibliotecaActions button:has-text("+ Adicionar documento")');
  await page.waitForTimeout(150);
  await page.fill('#bd_nome', 'Digitalização QA 001');
  await page.fill('[id^="bd_field_"]', 'LOTE-9988');
  await page.click('#biblioDocModalOverlay button:has-text("Guardar")');
  await page.waitForTimeout(300);

  await page.click('#bibliotecaActions button:has-text("+ Adicionar documento")');
  await page.waitForTimeout(150);
  await page.fill('#bd_nome', 'Digitalização QA 002');
  await page.fill('[id^="bd_field_"]', 'LOTE-1122');
  await page.click('#biblioDocModalOverlay button:has-text("Guardar")');
  await page.waitForTimeout(300);

  const doisDocsListados = await page.locator('#bibliotecaContent .doc-row').count();
  ok('Documentos/Biblioteca: os 2 documentos adicionados aparecem no livro', doisDocsListados === 2);
  const resumoComCampo = await page.locator('.doc-row:has-text("Digitalização QA 001")').innerText();
  ok('Documentos/Biblioteca: o valor do campo personalizado aparece no resumo do documento',
    resumoComCampo.includes('LOTE-9988'), resumoComCampo);

  // ---------- 18. Pesquisa na biblioteca filtra por valor de campo personalizado ----------
  await page.fill('#biblioSearchInput', 'LOTE-9988');
  await page.waitForTimeout(200);
  const filtradosBiblio = await page.locator('#bibliotecaContent .doc-row').count();
  ok('Documentos/Biblioteca: pesquisa por campo personalizado filtra para 1 resultado', filtradosBiblio === 1);
  await page.fill('#biblioSearchInput', '');
  await page.waitForTimeout(150);

  // ---------- 19. Persistência dos documentos do livro no servidor ----------
  const docsBiblioPersistidos = await poll(async () => {
    const estado = await estadoAtual();
    const docs = Object.values(estado.documentos?.cdocs_biblio_docs_v1 || {}).filter(d => d.bookId === livroPersistido.id);
    return docs.length === 2 ? docs : null;
  });
  ok('Documentos/Biblioteca: os 2 documentos do livro estão persistidos no servidor', !!docsBiblioPersistidos);

  // ---------- 20. Eliminar um documento do livro ----------
  page.once('dialog', d => d.accept());
  await page.click('.doc-row:has-text("Digitalização QA 002") button[title="Eliminar"]');
  await page.waitForTimeout(200);
  const umDocRestante = await page.locator('#bibliotecaContent .doc-row').count();
  ok('Documentos/Biblioteca: eliminar um documento deixa só o outro na lista', umDocRestante === 1);

  // ---------- 21. Eliminar o livro elimina em cascata os documentos ----------
  await page.click('#bibliotecaCrumb a');
  await page.waitForTimeout(200);
  await page.click('.folder-card:has-text("Livro QA") .folder-menu-btn');
  await page.waitForTimeout(100);
  page.once('dialog', d => d.accept());
  await page.click('.folder-menu.open button.danger');
  await page.waitForTimeout(300);
  const livroEliminado = await page.locator('.folder-card h3:has-text("Livro QA")').count();
  ok('Documentos/Biblioteca: eliminar o livro remove-o da grelha', livroEliminado === 0);

  const cascataPersistida = await poll(async () => {
    const estado = await estadoAtual();
    const semLivro = !Object.values(estado.documentos?.cdocs_biblio_books_v1 || {}).some(b => b.id === livroPersistido.id);
    const semDocs = !Object.values(estado.documentos?.cdocs_biblio_docs_v1 || {}).some(d => d.bookId === livroPersistido.id);
    return (semLivro && semDocs) || null;
  });
  ok('Documentos/Biblioteca: eliminar o livro remove também os seus documentos no servidor (cascata)', !!cascataPersistida);

  await ctx.close();
}
