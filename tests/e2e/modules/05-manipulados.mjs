/**
 * Testes e2e do módulo Gestão de Manipulados (modulos/manipulados.html).
 *
 * Cobre: validação de campos obrigatórios (incluindo os condicionais —
 * email quando o canal é "Email", nome do animal quando a prescrição é
 * veterinária), criar/editar/eliminar um pedido via UI real com
 * persistência confirmada no servidor (/api/data, campo `manipulados`),
 * pesquisa (incluindo o requisito específico desta sessão: encontrar
 * pedidos "entregue"/"cancelado" quando há texto, e manter o filtro por
 * estado inalterado quando não há texto), e — o mais importante — que cada
 * mudança de estado regista exatamente UMA tarefa de uso (nunca duas em
 * simultâneo, nunca a tarefa errada), incluindo o caso "reabrir_pedido"
 * (fechado -> aberto), via o asset `uso-AAAA-MM`.
 *
 * Nota sobre o padrão de bug de corrida do pim.html/gabinete.html:
 * gravarManipulados() tem o mesmo read-modify-write sem serialização
 * (corrigido também aqui, ver gravarQueue/enqueueSync em
 * modulos/manipulados.html), mas ao contrário de devolucoes-armazenistas.html
 * (5 chaves internas independentes, onde a corrida é demonstrável — ver
 * 07-devolucoes-armazenistas.mjs), aqui a lista `pedidos` é sempre a mesma
 * referência partilhada e só é lida no momento exato de cada PUT — por isso
 * duas gravações rápidas neste módulo não perdem dados da própria lista de
 * pedidos entre si. A correção fica como hardening preventivo/consistência,
 * não por haver aqui uma perda de dados demonstrável de pedidos (por isso
 * não há, de propósito, um teste de corrida fabricado neste ficheiro).
 *
 * Farmácia de teste sempre criada com signupFarmacia() (via abrirModulo),
 * nunca partilhada com outros ficheiros de tests/e2e/modules/.
 */
import { ok, apiFetch, abrirModulo } from '../helpers.mjs';

function usoChaves() {
  const hoje = new Date();
  const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
  return { mesChave, diaChave };
}

async function poll(fn, { tries = 12, delay = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

export async function run(browser) {
  const { ctx, page, token } = await abrirModulo(browser, 'manipulados', { prefixo: 'ManipQA' });

  async function estadoAtual() {
    return JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body);
  }
  async function contagensUso(tarefas) {
    const { mesChave, diaChave } = usoChaves();
    const res = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = JSON.parse(res.body);
    const parsed = body.content ? JSON.parse(body.content) : { dias: {} };
    const dia = parsed.dias?.[diaChave] || {};
    const out = {};
    tarefas.forEach(t => { out[t] = dia['manipulados.' + t] || 0; });
    return out;
  }
  const TAREFAS_TODAS = ['criar_pedido', 'mudar_pendente_utente', 'mudar_pendente_farmacia', 'mudar_preparacao', 'mudar_pronto', 'marcar_entregue', 'mudar_cancelado', 'reabrir_pedido'];
  async function preencherPedido(campos) {
    for (const [id, val] of Object.entries(campos)) await page.fill('#' + id, val);
  }

  // ---------- 1. Validação: campos obrigatórios bloqueiam a gravação ----------
  await page.click('button:has-text("+ Novo pedido")');
  await page.waitForTimeout(150);
  await page.click('.modal-foot button:has-text("Guardar")');
  const modalAindaAberto1 = await page.locator('#overlay.open').count();
  ok('Manipulados: guardar sem preencher campos obrigatórios não fecha o modal', modalAindaAberto1 === 1);
  ok('Manipulados: nome do utente vazio ganha a classe de erro visual', await page.locator('#f_nome.field-error').count() === 1);
  ok('Manipulados: canal por omissão é "Email" — email vazio também ganha erro (obrigatório condicional)', await page.locator('#f_email.field-error').count() === 1);
  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 2. Validação condicional: prescrição veterinária exige nome do animal ----------
  await page.click('button:has-text("+ Novo pedido")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Manipulado veterinário QA',
    f_nome: 'Dono QA', f_telefone: '910000009', f_nif: '199199199', f_receita: 'REC-VET-1'
  });
  await page.selectOption('#f_canal', 'Balcão'); // evita o prompt() do canal Email neste teste
  await page.selectOption('#f_tipo_prescricao', 'Uso Veterinário');
  await page.click('.modal-foot button:has-text("Guardar")');
  const modalAindaAberto2 = await page.locator('#overlay.open').count();
  ok('Manipulados: prescrição veterinária sem nome do animal não fecha o modal', modalAindaAberto2 === 1);
  ok('Manipulados: campo "Nome do animal" ganha a classe de erro quando obrigatório', await page.locator('#f_animal.field-error').count() === 1);
  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 3. Canal "Email" pede o email do utente via prompt() ----------
  await page.click('button:has-text("+ Novo pedido")');
  page.once('dialog', d => d.accept('utente-canal@qa.pt'));
  await page.selectOption('#f_canal', 'Email');
  await page.waitForTimeout(150);
  const emailPreenchido = await page.inputValue('#f_email');
  ok('Manipulados: escolher canal "Email" pede o email por prompt() e preenche o campo', emailPreenchido === 'utente-canal@qa.pt', `valor=${emailPreenchido}`);
  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 4. Criar pedido real (canal Balcão, sem prompt) + persistência ----------
  const nomeP1 = 'Utente Manip QA Um';
  await page.click('button:has-text("+ Novo pedido")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Minoxidil 5% solução QA',
    f_nome: nomeP1, f_telefone: '910000001', f_nif: '111222333', f_receita: 'REC-QA-1'
  });
  await page.selectOption('#f_canal', 'Balcão');
  await page.click('.modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(400);
  const linhaP1 = await page.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('Manipulados: novo pedido criado via UI aparece na tabela', linhaP1 === 1);

  const p1Remoto = await poll(async () => {
    const estado = await estadoAtual();
    return (estado.manipulados || []).find(p => p.nome === nomeP1) || null;
  });
  ok('Manipulados: pedido persistido no servidor (/api/data, campo manipulados)', !!p1Remoto);
  ok('Manipulados: pedido novo nasce no estado "pendente_farmacia" por omissão', p1Remoto?.status === 'pendente_farmacia');

  // ---------- 5. Persistência real através de reload (novo contexto, mesma sessão) ----------
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.addInitScript(([t]) => { localStorage.setItem('central_saas_token', t); }, [token]);
  await page2.goto(page.url(), { waitUntil: 'load', timeout: 15000 });
  await page2.waitForTimeout(1200);
  const linhaAposReload = await page2.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('Manipulados: pedido continua visível noutra sessão/dispositivo depois de recarregar', linhaAposReload === 1);
  await ctx2.close();

  // ---------- 6. Editar sem mudar de estado: NÃO regista nenhuma tarefa de estado ----------
  await page.waitForTimeout(2600); // esvazia qualquer flush pendente das ações anteriores
  const baselineEdit = await contagensUso(TAREFAS_TODAS);
  await page.locator('tbody tr', { hasText: nomeP1 }).click();
  await page.waitForTimeout(150);
  await page.fill('#f_comentarios', 'Nota adicionada em teste QA, sem mudar o estado.');
  await page.click('.modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(2700);
  const depoisEdit = await contagensUso(TAREFAS_TODAS);
  ok('Manipulados: editar um pedido sem mudar de estado não regista nenhuma tarefa de transição de estado',
    TAREFAS_TODAS.filter(t => t !== 'criar_pedido').every(t => depoisEdit[t] === baselineEdit[t]),
    JSON.stringify({ baselineEdit, depoisEdit }));

  // ---------- 7. Mudança de estado real via UI: cada transição regista EXATAMENTE uma tarefa ----------
  async function mudarEstadoEVerificar(nomePedido, novoEstado, tarefaEsperada) {
    const baseline = await contagensUso(TAREFAS_TODAS);
    // garante que a linha está visível independentemente do filtro de estado
    // ativo (ex.: um pedido "entregue" fica escondido da aba "Todos" —
    // testado à parte na secção de pesquisa mais abaixo)
    await page.fill('#searchInput', nomePedido);
    await page.waitForTimeout(150);
    await page.locator('tbody tr', { hasText: nomePedido }).click();
    await page.waitForTimeout(150);
    await page.click(`.status-picker button[data-s="${novoEstado}"]`);
    await page.click('.modal-foot button:has-text("Guardar")');
    await page.waitForTimeout(2700);
    await page.fill('#searchInput', '');
    await page.waitForTimeout(150);
    const depois = await contagensUso(TAREFAS_TODAS);
    const deltas = {};
    TAREFAS_TODAS.forEach(t => { deltas[t] = depois[t] - baseline[t]; });
    const totalDelta = TAREFAS_TODAS.reduce((s, t) => s + deltas[t], 0);
    ok(`Manipulados: mudar para "${novoEstado}" regista "${tarefaEsperada}" (+1)`, deltas[tarefaEsperada] === 1, JSON.stringify(deltas));
    ok(`Manipulados: mudar para "${novoEstado}" regista SÓ essa tarefa (nunca em dobro/outra tarefa)`, totalDelta === 1, JSON.stringify(deltas));
  }
  await mudarEstadoEVerificar(nomeP1, 'preparacao', 'mudar_preparacao');
  await mudarEstadoEVerificar(nomeP1, 'pronto', 'mudar_pronto');
  await mudarEstadoEVerificar(nomeP1, 'entregue', 'marcar_entregue');
  // reabrir um pedido fechado (entregue -> preparacao) regista SÓ "reabrir_pedido",
  // nunca também "mudar_preparacao" (regressão específica pedida nesta sessão).
  await mudarEstadoEVerificar(nomeP1, 'preparacao', 'reabrir_pedido');

  // ---------- 8. Pesquisa: encontra pedidos "entregue"/"cancelado" quando há texto ----------
  // (o pedido nomeP1 já está em "preparacao" depois do reabrir_pedido acima;
  // muda-se para "entregue" aqui de propósito, para testar a pesquisa abaixo)
  await page.locator('tbody tr', { hasText: nomeP1 }).click();
  await page.waitForTimeout(150);
  await page.click('.status-picker button[data-s="entregue"]');
  await page.click('.modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(500);
  const nomeP2 = 'Utente Manip QA Cancelado';
  await page.click('button:has-text("+ Novo pedido")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Outro manipulado QA',
    f_nome: nomeP2, f_telefone: '910000002', f_nif: '444555666', f_receita: 'REC-QA-2'
  });
  await page.selectOption('#f_canal', 'Balcão');
  await page.click('.modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(400);
  await page.locator('tbody tr', { hasText: nomeP2 }).click();
  await page.waitForTimeout(150);
  await page.click('.status-picker button[data-s="cancelado"]');
  await page.click('.modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(500);

  // 8a. Sem texto de pesquisa, filtro "todos" continua a esconder entregue/cancelado (comportamento antigo preservado)
  await page.fill('#searchInput', '');
  await page.waitForTimeout(150);
  const p1VisivelSemPesquisa = await page.locator('tbody tr', { hasText: nomeP1 }).count();
  const p2VisivelSemPesquisa = await page.locator('tbody tr', { hasText: nomeP2 }).count();
  ok('Manipulados: sem texto de pesquisa, o pedido "entregue" continua fora da vista "Todos"', p1VisivelSemPesquisa === 0);
  ok('Manipulados: sem texto de pesquisa, o pedido "cancelado" continua fora da vista "Todos"', p2VisivelSemPesquisa === 0);

  // 8b. Com texto de pesquisa, ambos passam a ser encontráveis (correção desta sessão)
  await page.fill('#searchInput', nomeP1);
  await page.waitForTimeout(200);
  const p1ComPesquisa = await page.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('Manipulados: pesquisa por nome ENCONTRA um pedido "entregue" (correção desta sessão)', p1ComPesquisa === 1);

  await page.fill('#searchInput', nomeP2);
  await page.waitForTimeout(200);
  const p2ComPesquisa = await page.locator('tbody tr', { hasText: nomeP2 }).count();
  ok('Manipulados: pesquisa por nome ENCONTRA um pedido "cancelado" (correção desta sessão)', p2ComPesquisa === 1);
  await page.fill('#searchInput', '');
  await page.waitForTimeout(150);

  // ---------- 9. Filtro por estado continua a funcionar normalmente (sem pesquisa) ----------
  await page.evaluate(() => window.setFilter('cancelado'));
  await page.waitForTimeout(150);
  const soCanceladosNoFiltro = await page.locator('tbody tr').allInnerTexts();
  ok('Manipulados: filtro "Cancelado" (barra inferior) mostra só pedidos cancelados',
    soCanceladosNoFiltro.length === 1 && soCanceladosNoFiltro[0].includes(nomeP2), JSON.stringify(soCanceladosNoFiltro));
  await page.evaluate(() => window.setFilter('todos'));

  // ---------- 10. Eliminar pedido (remoção real, não tombstone) + persistência ----------
  // nomeP1 está atualmente em "entregue" (secção 8) — escondido da aba "Todos";
  // usa-se a pesquisa para o tornar visível independentemente do filtro ativo.
  await page.fill('#searchInput', nomeP1);
  await page.waitForTimeout(150);
  await page.locator('tbody tr', { hasText: nomeP1 }).click();
  await page.waitForTimeout(150);
  page.once('dialog', d => d.accept());
  await page.click('#deleteBtn');
  await page.waitForTimeout(400);
  const p1AindaNaTabela = await page.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('Manipulados: eliminar pedido remove-o da tabela', p1AindaNaTabela === 0);

  const p1RemovidoDoServidor = await poll(async () => {
    const estado = await estadoAtual();
    const ainda = (estado.manipulados || []).some(p => p.nome === nomeP1);
    return ainda ? null : true;
  });
  ok('Manipulados: eliminar pedido remove-o também do servidor (sem tombstone — remoção real da lista)', !!p1RemovidoDoServidor);

  // ---------- 11. Definições de email (ponto 37) — Fornecedores + Web App, ao estilo do AUE ----------
  // Cobre dois bugs reais encontrados e corrigidos nesta sessão (nenhum deles reportado pelo Ivo —
  // descobertos só ao escrever estes testes): (a) o formulário de Fornecedores usava
  // `oninput="tempFornecedores[i]..."` sem expor `tempFornecedores` em `window`, pelo que escrever nos
  // campos não gravava nada (mesma família de bug do ponto 34/36); (b) o botão "✉ Pedir orçamento" já
  // vinha, desde sempre, com `onclick="sendBudgetEmail(pedidos.find(x=>x.id===editingId))"` — `pedidos`/
  // `editingId` também nunca estiveram em `window`, pelo que o clique falhava sempre em silêncio e o
  // pedido de orçamento por email nunca tinha chegado a funcionar.
  await page.click('button:has-text("✉ Email")');
  await page.waitForSelector('#emailSettingsOverlay.open');
  await page.click('button:has-text("+ Adicionar fornecedor")');
  await page.waitForTimeout(100);
  let linha = page.locator('#fornecedoresGrid .fornecedor-row').nth(0);
  await linha.locator('input[placeholder*="Nome"]').fill('Laboratório QA Um');
  await linha.locator('input[placeholder*="pedidos"]').fill('lab1@qa.pt');

  await page.click('button:has-text("+ Adicionar fornecedor")');
  await page.waitForTimeout(100);
  linha = page.locator('#fornecedoresGrid .fornecedor-row').nth(1);
  await linha.locator('input[placeholder*="Nome"]').fill('Laboratório QA Dois');
  await linha.locator('input[placeholder*="pedidos"]').fill('lab2@qa.pt');
  await linha.locator('input[placeholder*="CC"]').fill('cc-lab2@qa.pt');
  await linha.locator('input[type=radio]').check(); // marca o 2º como padrão

  await page.click('#emailSettingsOverlay .modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(200);

  // Persistência real: recarrega a página (só localStorage, sem servidor) e confirma que sobrevive.
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('button:has-text("✉ Email")');
  await page.waitForSelector('#emailSettingsOverlay.open');
  const linhasAposReload = await page.locator('#fornecedoresGrid .fornecedor-row').count();
  const nomes = await page.$$eval('#fornecedoresGrid input[placeholder*="Nome"]', els => els.map(e => e.value));
  ok('Manipulados definições de email: 2 fornecedores sobrevivem a recarregar a página (persistência real)',
    linhasAposReload === 2 && nomes.includes('Laboratório QA Um') && nomes.includes('Laboratório QA Dois'));
  await page.click('#emailSettingsOverlay .close-x');

  // Cria um pedido novo e pede orçamento — deve abrir já com o fornecedor PADRÃO (QA Dois) pré-preenchido.
  await page.click('button:has-text("+ Novo pedido")');
  await page.waitForSelector('#overlay.open');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Manipulado QA Email',
    f_nome: 'Utente QA Email', f_telefone: '910000077', f_nif: '199199333', f_receita: 'REC-EMAIL-QA'
  });
  await page.selectOption('#f_canal', 'Balcão');
  await page.click('#overlay .modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(300);

  await page.locator('tbody tr', { hasText: 'Manipulado QA Email' }).click();
  await page.waitForSelector('#overlay.open');
  await page.click('#requestBudgetBtn');
  await page.waitForSelector('#emailPreviewOverlay.open', { timeout: 5000 });
  const preFornecedor = await page.locator('#ep_fornecedor').inputValue().then(async id => {
    const label = await page.locator(`#ep_fornecedor option[value="${id}"]`).textContent();
    return label;
  });
  const preTo = await page.locator('#ep_to').inputValue();
  const preCc = await page.locator('#ep_cc').inputValue();
  ok('Manipulados: "✉ Pedir orçamento" abre mesmo o preview (bug pré-existente corrigido) com o Fornecedor padrão pré-preenchido',
    (preFornecedor || '').includes('QA Dois') && preTo === 'lab2@qa.pt' && preCc === 'cc-lab2@qa.pt');

  // Troca para o outro fornecedor configurado — Para/CC devem mudar de acordo.
  const opcoesTexto = await page.locator('#ep_fornecedor option').allTextContents();
  const labelUm = opcoesTexto.find(t => t.includes('QA Um'));
  await page.selectOption('#ep_fornecedor', { label: labelUm });
  await page.waitForTimeout(100);
  const posTo = await page.locator('#ep_to').inputValue();
  ok('Manipulados: trocar de Fornecedor no preview do email atualiza o campo "Para"', posTo === 'lab1@qa.pt');
  await page.click('.danger-link:has-text("Não enviar")');

  // ---------- 12. Editor de template de email arrastável (ponto 38) ----------
  // Cobre: sem template guardado, o email continua a usar a lógica antiga (compatibilidade), o editor abre
  // com os campos disponíveis como "chips" arrastáveis, inserção por clique funciona (fallback do drag),
  // pré-visualização usa dados de exemplo, "Repor original" restaura o texto padrão, guardar com o corpo
  // vazio é recusado, e — o mais importante — depois de guardado, o email de um pedido REAL passa a usar
  // o template customizado com os dados REAIS desse pedido (não os de exemplo da pré-visualização).
  // A secção 11 deixou o modal do pedido (#overlay) aberto por trás do preview de email já fechado.
  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);
  await page.click('button:has-text("+ Novo pedido")');
  await page.waitForSelector('#overlay.open');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Manipulado Template QA',
    f_nome: 'Utente Template QA', f_telefone: '911222333', f_nif: '199199444', f_receita: 'REC-TPL-QA'
  });
  await page.selectOption('#f_canal', 'Balcão');
  await page.click('#overlay .modal-foot button:has-text("Guardar")');
  await page.waitForTimeout(300);

  await page.locator('tbody tr', { hasText: 'Manipulado Template QA' }).click();
  await page.waitForSelector('#overlay.open');
  await page.click('#requestBudgetBtn');
  await page.waitForSelector('#emailPreviewOverlay.open', { timeout: 5000 });
  const bodySemTemplate = await page.locator('#ep_body').inputValue();
  ok('Manipulados: sem template guardado, o email ainda usa a lógica antiga (compatibilidade preservada)',
    bodySemTemplate.includes('Vimos por este meio pedir orçamento para o manipulado "Manipulado Template QA"'));
  await page.click('.danger-link:has-text("Não enviar")');
  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  await page.click('button:has-text("✉ Email")');
  await page.waitForSelector('#emailSettingsOverlay.open');
  await page.click('button:has-text("✎ Editar modelo de email")');
  await page.waitForSelector('#emailTemplateOverlay.open', { timeout: 5000 });
  const numChips = await page.locator('#tplCamposGrid .field-chip').count();
  ok('Manipulados editor de template: abre com os 10 campos disponíveis como chips arrastáveis', numChips === 10);

  const dragAttrs = await page.evaluate(() => {
    const chip = document.querySelector('#tplCamposGrid .field-chip');
    const subject = document.getElementById('tplSubject');
    const body = document.getElementById('tplBody');
    return {
      draggable: chip?.getAttribute('draggable') === 'true',
      temDragstart: !!chip?.getAttribute('ondragstart'),
      subjectAceitaDrop: !!subject?.getAttribute('ondragover') && !subject?.getAttribute('ondrop'),
      bodyAceitaDrop: !!body?.getAttribute('ondragover') && !body?.getAttribute('ondrop'),
    };
  });
  ok('Manipulados editor de template: chips são arrastáveis e os campos de destino aceitam o drop nativo do browser (sem ondrop customizado)',
    dragAttrs.draggable && dragAttrs.temDragstart && dragAttrs.subjectAceitaDrop && dragAttrs.bodyAceitaDrop);

  // Inserção por clique (fallback do drag-and-drop)
  await page.fill('#tplSubject', 'Orçamento urgente: ');
  await page.click('#tplSubject');
  await page.evaluate(() => { const el = document.getElementById('tplSubject'); el.focus(); el.selectionStart = el.selectionEnd = el.value.length; });
  await page.click('#tplCamposGrid .field-chip:has-text("Medicamento/manipulado")');
  await page.waitForTimeout(100);
  const assuntoComChip = await page.locator('#tplSubject').inputValue();
  ok('Manipulados editor de template: clicar num chip insere o token {{campo}} na posição do cursor',
    assuntoComChip === 'Orçamento urgente: {{medicamento}}');

  await page.fill('#tplBody', 'Olá,\n\nPeço orçamento para ');
  await page.click('#tplBody');
  await page.evaluate(() => { const el = document.getElementById('tplBody'); el.focus(); el.selectionStart = el.selectionEnd = el.value.length; });
  await page.click('#tplCamposGrid .field-chip:has-text("Nome do utente")');
  await page.waitForTimeout(100);
  const corpoComChip = await page.locator('#tplBody').inputValue();
  ok('Manipulados editor de template: chip inserido no corpo do email', corpoComChip === 'Olá,\n\nPeço orçamento para {{nome}}');

  // Pré-visualização com dados de exemplo
  await page.click('#tplPreviewBtn');
  await page.waitForTimeout(150);
  const previewTexto = await page.evaluate(() => document.getElementById('tplPreviewBody')?.textContent);
  ok('Manipulados editor de template: pré-visualização substitui os tokens por dados de exemplo',
    previewTexto === 'Olá,\n\nPeço orçamento para Maria Silva');
  await page.click('#tplVoltarBtn');
  await page.waitForTimeout(100);
  const voltouAEditar = await page.evaluate(() => getComputedStyle(document.getElementById('tplEditArea')).display !== 'none');
  ok('Manipulados editor de template: "Voltar a editar" regressa ao modo de edição', voltouAEditar);

  // Repor original
  await page.click('button:has-text("↺ Repor original")');
  await page.waitForTimeout(100);
  const assuntoReposto = await page.locator('#tplSubject').inputValue();
  ok('Manipulados editor de template: "Repor original" restaura o texto padrão', assuntoReposto === 'Pedido de orçamento — Manipulado: {{medicamento}}');

  // Guardar com corpo vazio é recusado
  await page.fill('#tplBody', '');
  await page.click('#emailTemplateOverlay button:has-text("Guardar")');
  await page.waitForTimeout(150);
  const aindaAbertoVazio = await page.evaluate(() => document.getElementById('emailTemplateOverlay').classList.contains('open'));
  ok('Manipulados editor de template: guardar com o corpo vazio não fecha o modal (validação)', aindaAbertoVazio);

  // Guardar um template customizado válido
  await page.fill('#tplSubject', 'Orçamento urgente: {{medicamento}}');
  await page.fill('#tplBody', 'Olá,\n\nPeço orçamento para {{medicamento}} para o utente {{nome}}.');
  await page.click('#emailTemplateOverlay button:has-text("Guardar")');
  await page.waitForTimeout(200);
  const templateOverlayFechou = await page.evaluate(() => !document.getElementById('emailTemplateOverlay').classList.contains('open'));
  ok('Manipulados editor de template: guardar com sucesso fecha o modal', templateOverlayFechou);

  const templateGuardado = await page.evaluate(() => JSON.parse(localStorage.getItem('famam_email_template') || 'null'));
  ok('Manipulados editor de template: template fica gravado em localStorage', templateGuardado?.subject === 'Orçamento urgente: {{medicamento}}');

  // Confirma que o pedido real agora usa o template guardado, com os DADOS REAIS do próprio pedido.
  await page.evaluate(() => { const o = document.getElementById('emailSettingsOverlay'); if (o) o.classList.remove('open'); });
  await page.waitForTimeout(100);
  await page.locator('tbody tr', { hasText: 'Manipulado Template QA' }).click();
  await page.waitForSelector('#overlay.open');
  await page.click('#requestBudgetBtn');
  await page.waitForSelector('#emailPreviewOverlay.open', { timeout: 5000 });
  const emailFinal = await page.evaluate(() => ({
    subject: document.getElementById('ep_subject')?.value,
    body: document.getElementById('ep_body')?.value,
  }));
  ok('Manipulados: depois de guardar o template, o email de um pedido real usa-o com os dados REAIS desse pedido (não os de exemplo)',
    emailFinal.subject === 'Orçamento urgente: Manipulado Template QA' &&
    emailFinal.body === 'Olá,\n\nPeço orçamento para Manipulado Template QA para o utente Utente Template QA.');
  await page.click('.danger-link:has-text("Não enviar")');

  await ctx.close();
}
