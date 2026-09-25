/**
 * Testes e2e do módulo Pedidos AUE (modulos/aue.html).
 *
 * Cobre: criar/editar/eliminar um pedido via UI real com persistência
 * confirmada no servidor, validação de campos obrigatórios, anexar
 * documentos, pesquisa, mudança de estado, e — o mais importante — a
 * lógica de sincronização por fusão registo-a-registo (mergePedidosArrays,
 * por id/updatedAt, com tombstone para eliminar), simulando de forma
 * determinística um "segundo dispositivo" através de escritas diretas a
 * /api/data e depois forçando window.forceSync() na página real.
 *
 * Inclui também um teste de regressão específico para um bug já corrigido
 * nesta app: uma gravação que muda de estado só deve registar UMA tarefa de
 * uso (a específica, ex. "marcar_aprovado"), nunca essa E a genérica
 * "atualizar_pedido" ao mesmo tempo (ver o comentário em saveCurrent() no
 * próprio modulos/aue.html).
 *
 * Farmácia de teste sempre criada com signupFarmacia() (via abrirModulo),
 * nunca partilhada com outros ficheiros de tests/e2e/modules/.
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

function usoChaves() {
  const hoje = new Date();
  const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
  return { mesChave, diaChave };
}

export async function run(browser) {
  const { ctx, page, token } = await abrirModulo(browser, 'aue', { prefixo: 'AueQA' });

  // Desliga o envio automático de email (ativo por omissão): criar um pedido
  // ou mudar para um estado que dispara email (aprovado/disponível/indeferido)
  // abriria sozinho o modal de pré-visualização de email por cima de tudo,
  // impedindo os cliques seguintes deste teste — nada a ver com o que se
  // quer testar aqui (CRUD/validação/fusão), por isso desativa-se à parte.
  await page.evaluate(() => localStorage.setItem('aue_email_settings', JSON.stringify({ auto: false, url: '', armazenistaContacts: {} })));

  async function estadoAtual() {
    return JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body);
  }
  async function putEstado(patch) {
    const atual = await estadoAtual();
    const body = { ...atual, ...patch };
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return atual;
  }
  async function contagensUso(tarefas) {
    const { mesChave, diaChave } = usoChaves();
    const res = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = JSON.parse(res.body);
    const parsed = body.content ? JSON.parse(body.content) : { dias: {} };
    const dia = parsed.dias?.[diaChave] || {};
    const out = {};
    tarefas.forEach(t => { out[t] = dia['aue.' + t] || 0; });
    return out;
  }
  async function preencherPedido(campos) {
    for (const [id, val] of Object.entries(campos)) await page.fill('#' + id, val);
  }

  // ---------- 1. Validação: campos obrigatórios bloqueiam a gravação ----------
  await page.click('button:has-text("+ Novo pedido AUE")');
  await page.waitForTimeout(150);
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  const modalAindaAberto = await page.locator('#overlay.open').count();
  const nomeComErro = await page.locator('#f_nome.field-error').count();
  ok('AUE: guardar sem preencher campos obrigatórios não fecha o modal', modalAindaAberto === 1);
  ok('AUE: campo obrigatório vazio ganha a classe de erro visual', nomeComErro === 1);
  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 1b. Ponto 49: NIF/Email com formato inválido bloqueiam a gravação (antes só se confirmava que não estavam vazios) ----------
  await page.click('button:has-text("+ Novo pedido AUE")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Canabidiol 100mg/ml solução oral',
    f_nome: 'Utente Formato Inválido', f_nif: '123456780', f_telefone: '910000099', f_email: 'utenteformatoinvalido@qa.pt',
    f_medico: 'Dr. QA Formato'
  });
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(150);
  ok('AUE (ponto 49): NIF com dígito de controlo errado bloqueia a gravação (modal continua aberto)',
    await page.locator('#overlay.open').count() === 1);
  ok('AUE (ponto 49): o campo NIF ganha a classe de erro visual com um NIF inválido',
    await page.locator('#f_nif.field-error').count() === 1);

  await page.fill('#f_nif', '123456789'); // agora válido
  await page.fill('#f_email', 'utenteformatoinvalidoarroba'); // sem "@" nem domínio
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(150);
  ok('AUE (ponto 49): email sem "@"/domínio bloqueia a gravação (modal continua aberto)',
    await page.locator('#overlay.open').count() === 1);
  ok('AUE (ponto 49): o campo Email ganha a classe de erro visual com um email inválido',
    await page.locator('#f_email.field-error').count() === 1);
  ok('AUE (ponto 49): com o NIF já corrigido, o campo NIF deixa de ter a classe de erro',
    await page.locator('#f_nif.field-error').count() === 0);

  await page.fill('#f_email', 'utenteformatoinvalido@qa.pt'); // agora válido
  await page.fill('#f_telefone', '512345678'); // formato português inválido (não pode começar por 5)
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(150);
  ok('AUE (ponto 52): telefone com formato português inválido bloqueia a gravação (modal continua aberto)',
    await page.locator('#overlay.open').count() === 1);
  ok('AUE (ponto 52): o campo Telefone ganha a classe de erro visual com um telefone inválido',
    await page.locator('#f_telefone.field-error').count() === 1);
  ok('AUE (ponto 52): o email já corrigido não fica marcado como erro (só o telefone bloqueia agora)',
    await page.locator('#f_email.field-error').count() === 0);

  await page.click('.modal-foot button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // ---------- 2. Criar pedido real, com os 3 documentos obrigatórios ----------
  const nomeP1 = 'Utente QA Um';
  await page.click('button:has-text("+ Novo pedido AUE")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Canabidiol 100mg/ml solução oral',
    f_nome: nomeP1, f_nif: '111222338', f_telefone: '910000001', f_email: 'utente1@qa.pt',
    f_medico: 'Dr. QA Um'
  });
  await page.setInputFiles('#doc_input_receita', { name: 'receita.pdf', mimeType: 'application/pdf', buffer: Buffer.from('receita-qa') });
  await page.setInputFiles('#doc_input_declaracao', { name: 'declaracao.pdf', mimeType: 'application/pdf', buffer: Buffer.from('declaracao-qa') });
  await page.setInputFiles('#doc_input_formulario', { name: 'formulario.pdf', mimeType: 'application/pdf', buffer: Buffer.from('formulario-qa') });
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(400);

  const linhaP1 = await page.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('AUE: novo pedido criado via UI aparece na tabela', linhaP1 === 1);
  const textoLinhaP1 = await page.locator('tbody tr', { hasText: nomeP1 }).innerText();
  ok('AUE: pedido criado com os 3 documentos mostra "3/3" completo', textoLinhaP1.includes('3/3'));

  // ---------- 3. Persistência no servidor (metadados + flags de anexo) ----------
  const p1Remoto = await poll(async () => {
    const estado = await estadoAtual();
    return (estado.aue?.pedidos || []).find(p => p.nome === nomeP1) || null;
  });
  ok('AUE: pedido persistido no servidor (/api/data)', !!p1Remoto);
  ok('AUE: os 3 anexos ficam marcados como carregados (hasFile) no registo persistido',
    !!p1Remoto && ['receita', 'declaracao', 'formulario'].every(k => p1Remoto.docs?.[k]?.hasFile === true));

  // ---------- 4. Persistência real através de reload (novo contexto, mesma sessão) ----------
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.addInitScript(([t]) => { localStorage.setItem('central_saas_token', t); }, [token]);
  await page2.goto(page.url(), { waitUntil: 'load', timeout: 15000 });
  await page2.waitForTimeout(2200); // aguarda loadData() + o attemptSync automático ao arranque
  const linhaAposReload = await page2.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('AUE: pedido continua visível noutra sessão/dispositivo depois de sincronizar', linhaAposReload === 1);
  await ctx2.close();

  // ---------- 5. Pesquisa filtra corretamente ----------
  const nomeP2 = 'Utente QA Dois';
  await page.click('button:has-text("+ Novo pedido AUE")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Outro medicamento QA',
    f_nome: nomeP2, f_nif: '444555668', f_telefone: '910000002', f_email: 'utente2@qa.pt',
    f_medico: 'Dr. QA Dois'
  });
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(400);

  await page.fill('#searchInput', 'QA Dois');
  await page.waitForTimeout(200);
  const linhasPesquisa = await page.locator('tbody tr').count();
  const textoPesquisa = await page.locator('tbody tr').first().innerText();
  ok('AUE: pesquisa por nome devolve só o pedido correspondente',
    linhasPesquisa === 1 && textoPesquisa.includes(nomeP2), `linhas=${linhasPesquisa}`);
  await page.fill('#searchInput', '');
  await page.waitForTimeout(200);

  // ---------- 6. Editar sem mudar de estado: regista "atualizar_pedido" (não uma tarefa de estado) ----------
  await page.waitForTimeout(2600); // deixa esvaziar qualquer flush pendente das ações anteriores
  const baseline1 = await contagensUso(['atualizar_pedido', 'marcar_aprovado']);
  await page.locator('tbody tr', { hasText: nomeP1 }).click();
  await page.waitForTimeout(150);
  await page.fill('#f_comentarios', 'Nota adicionada em teste QA.');
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(2700); // debounce de 2s do flush de uso + rede
  const depois1 = await contagensUso(['atualizar_pedido', 'marcar_aprovado']);
  ok('AUE: editar um pedido sem mudar de estado regista "atualizar_pedido" (+1)',
    depois1.atualizar_pedido === baseline1.atualizar_pedido + 1, JSON.stringify({ baseline1, depois1 }));
  ok('AUE: editar sem mudar de estado NÃO regista a tarefa específica de estado',
    depois1.marcar_aprovado === baseline1.marcar_aprovado, JSON.stringify({ baseline1, depois1 }));

  // ---------- 7. REGRESSÃO: mudar de estado regista SÓ a tarefa específica, nunca também a genérica ----------
  const baseline2 = await contagensUso(['atualizar_pedido', 'marcar_aprovado']);
  await page.locator('tbody tr', { hasText: nomeP1 }).click();
  await page.waitForTimeout(150);
  await page.click('.status-picker button[data-s="aprovado"]');
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(2700);
  const depois2 = await contagensUso(['atualizar_pedido', 'marcar_aprovado']);
  ok('AUE [regressão]: mudar o estado para "Aprovado" regista "marcar_aprovado" (+1)',
    depois2.marcar_aprovado === baseline2.marcar_aprovado + 1, JSON.stringify({ baseline2, depois2 }));
  ok('AUE [regressão]: mudar o estado NÃO conta em dobro — "atualizar_pedido" fica inalterado na mesma gravação',
    depois2.atualizar_pedido === baseline2.atualizar_pedido, JSON.stringify({ baseline2, depois2 }));
  const textoAprovado = await page.locator('tbody tr', { hasText: nomeP1 }).innerText();
  ok('AUE: a tabela reflete o novo estado "Aprovado"', textoAprovado.includes('Aprovado'));

  // ---------- 8. Eliminar pedido (tombstone) ----------
  await page.locator('tbody tr', { hasText: nomeP2 }).click();
  await page.waitForTimeout(150);
  page.once('dialog', d => d.accept());
  await page.click('#deleteBtn');
  await page.waitForTimeout(400);
  const p2AindaNaTabela = await page.locator('tbody tr', { hasText: nomeP2 }).count();
  ok('AUE: eliminar pedido remove-o da tabela', p2AindaNaTabela === 0);

  const p2Tombstone = await poll(async () => {
    const estado = await estadoAtual();
    const p = (estado.aue?.pedidos || []).find(p => p.nome === nomeP2);
    return (p && p.deleted === true) ? p : null;
  });
  ok('AUE: eliminar pedido grava um tombstone (deleted:true) no servidor, não uma remoção física', !!p2Tombstone);

  // ==================== FUSÃO ENTRE "DISPOSITIVOS" (mergePedidosArrays) ====================

  // ---------- 9. União: um pedido criado noutro dispositivo aparece após sincronizar, sem perder os locais ----------
  const estadoAntesUniao = await estadoAtual();
  const pedidosAntesUniao = estadoAntesUniao.aue?.pedidos || [];
  const nomeDispositivo2 = 'Utente Dispositivo2 QA';
  const registoDispositivo2 = {
    id: 'aue_qa_dispositivo2_' + Date.now(), nome: nomeDispositivo2, telefone: '900000000', nif: '999888777',
    operador: 'Operador Dispositivo2', medicamento: 'Medicamento Dispositivo2', armazenista: 'OCP',
    medico: 'Dr. Dispositivo2', email: 'd2@qa.pt', comercial: '', preco: '', canal: 'Email',
    medicoContacto: '', instituicao: '', receita: '', codigoAcesso: '', codigoOpcao: '', registoAue: '', data: '',
    docs: { receita: null, declaracao: null, formulario: null }, comentarios: '', status: 'pendente_docs',
    criado: new Date().toISOString().slice(0, 10), deleted: false, updatedAt: Date.now()
  };
  await putEstado({ aue: { ...(estadoAntesUniao.aue || {}), pedidos: [...pedidosAntesUniao, registoDispositivo2] } });

  await page.evaluate(() => window.forceSync());
  await page.waitForTimeout(1800);

  const linhaDispositivo2 = await page.locator('tbody tr', { hasText: nomeDispositivo2 }).count();
  ok('AUE: sincronizar funde um pedido criado noutro dispositivo (união por id)', linhaDispositivo2 === 1);
  const linhaP1AposUniao = await page.locator('tbody tr', { hasText: nomeP1 }).count();
  ok('AUE: a fusão não perde os pedidos já existentes localmente', linhaP1AposUniao === 1);

  // ---------- 10. Tombstone vence a fusão: um dispositivo desatualizado não "ressuscita" um pedido eliminado ----------
  const nomeP3 = 'Utente Tombstone QA';
  await page.click('button:has-text("+ Novo pedido AUE")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Medicamento Tombstone QA',
    f_nome: nomeP3, f_nif: '777888998', f_telefone: '910000003', f_email: 'utente3@qa.pt',
    f_medico: 'Dr. QA Três'
  });
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForTimeout(1800); // sincronização automática após gravar

  const p3AntesEliminar = await poll(async () => {
    const estado = await estadoAtual();
    return (estado.aue?.pedidos || []).find(p => p.nome === nomeP3) || null;
  });
  ok('AUE: pedido "Tombstone QA" sincronizado com o servidor antes do teste de fusão', !!p3AntesEliminar);

  await page.locator('tbody tr', { hasText: nomeP3 }).click();
  await page.waitForTimeout(150);
  page.once('dialog', d => d.accept());
  await page.click('#deleteBtn');
  await page.waitForTimeout(1800); // sincronização automática após eliminar (tombstone chega ao servidor)

  const estadoComTombstone = await estadoAtual();
  const p3Tombstone = (estadoComTombstone.aue?.pedidos || []).find(p => p.id === p3AntesEliminar.id);
  ok('AUE: eliminação de "Tombstone QA" confirmada no servidor antes da simulação', p3Tombstone && p3Tombstone.deleted === true);

  // Simula um dispositivo desatualizado a reescrever diretamente no servidor uma
  // versão MAIS ANTIGA e não eliminada do mesmo pedido (updatedAt anterior ao
  // do tombstone) — nunca passaria pelo merge do próprio cliente, por isso só
  // é possível reproduzir isto escrevendo a server diretamente.
  const pedidosComVersaoAntiga = estadoComTombstone.aue.pedidos.map(p =>
    p.id === p3AntesEliminar.id
      ? { ...p3AntesEliminar, deleted: false, updatedAt: p3Tombstone.updatedAt - 60000 }
      : p
  );
  await putEstado({ aue: { ...estadoComTombstone.aue, pedidos: pedidosComVersaoAntiga } });

  // A página ainda tem em memória a versão com tombstone (updatedAt mais recente)
  // — força uma nova sincronização a partir dela.
  await page.evaluate(() => window.forceSync());
  await page.waitForTimeout(1800);

  const estadoFinal = await estadoAtual();
  const p3Final = (estadoFinal.aue?.pedidos || []).find(p => p.id === p3AntesEliminar.id);
  ok('AUE: a fusão por updatedAt mantém o tombstone mesmo depois de um dispositivo desatualizado reescrever uma versão mais antiga',
    !!p3Final && p3Final.deleted === true, JSON.stringify(p3Final));
  const p3AindaNaTabela = await page.locator('tbody tr', { hasText: nomeP3 }).count();
  ok('AUE: o pedido eliminado (tombstone vencedor) não reaparece na tabela depois da fusão', p3AindaNaTabela === 0);

  // ---------- 11. Editor de template de email arrastável (ponto 38) — só o email ao ARMAZENISTA ----------
  // Mesma funcionalidade do módulo Manipulados, aplicada aqui só ao email automático de pedido de
  // aquisição enviado ao armazenista (buildArmazenistaEmailContent) — deliberadamente NÃO às atualizações
  // automáticas ao utente (aprovado/disponível/indeferido), que têm barra de progresso e bloco de
  // pagamento condicional e ficam fora de âmbito. O conjunto de campos aqui é mais pequeno do que o dos
  // Manipulados (medicamento, nome, telefone, receita, farmácia, operador — sem animal/acesso/opção/
  // comentários), que corresponde exatamente aos dados já usados na lógica antiga deste email.
  // Volta a ligar o envio automático (desligado no início deste ficheiro) só para este teste, para que
  // criar um pedido novo dispare mesmo a pré-visualização do email.
  await page.evaluate(() => localStorage.setItem('aue_email_settings', JSON.stringify({ auto: true, url: '', armazenistaContacts: {} })));

  const nomeP4 = 'Utente Template QA';
  await page.click('button:has-text("+ Novo pedido AUE")');
  await preencherPedido({
    f_operador: 'Operador QA', f_medicamento: 'Canabidiol Template QA',
    f_nome: nomeP4, f_nif: '199199779', f_telefone: '912333444', f_email: 'template-qa@qa.pt',
    f_medico: 'Dr. Template QA', f_receita: 'REC-TPL-QA'
  });
  await page.selectOption('#f_armazenista', 'Empifarma');
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForSelector('#emailPreviewOverlay.open', { timeout: 5000 });
  const bodySemTemplateAue = await page.locator('#ep_body').inputValue();
  ok('AUE: sem template guardado, o email ao armazenista ainda usa a lógica antiga (compatibilidade preservada)',
    bodySemTemplateAue.includes('Vimos por este meio enviar em anexo documentos para pedido de AUE Canabidiol Template QA'));
  await page.click('.danger-link:has-text("Não enviar")');
  await page.waitForTimeout(200);

  await page.click('button:has-text("✉ Email")');
  await page.waitForSelector('#emailSettingsOverlay.open');
  await page.click('button:has-text("✎ Editar modelo de email")');
  await page.waitForSelector('#emailTemplateOverlay.open', { timeout: 5000 });
  const numChipsAue = await page.locator('#tplCamposGrid .field-chip').count();
  ok('AUE editor de template: abre com os 6 campos disponíveis (subconjunto dos Manipulados, sem animal/acesso/opção/comentários)',
    numChipsAue === 6);

  const dragAttrsAue = await page.evaluate(() => {
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
  ok('AUE editor de template: chips são arrastáveis e os campos de destino aceitam o drop nativo do browser',
    dragAttrsAue.draggable && dragAttrsAue.temDragstart && dragAttrsAue.subjectAceitaDrop && dragAttrsAue.bodyAceitaDrop);

  await page.fill('#tplSubject', 'Pedido urgente AUE: ');
  await page.click('#tplSubject');
  await page.evaluate(() => { const el = document.getElementById('tplSubject'); el.focus(); el.selectionStart = el.selectionEnd = el.value.length; });
  await page.click('#tplCamposGrid .field-chip:has-text("Medicamento")');
  await page.waitForTimeout(100);
  const assuntoComChipAue = await page.locator('#tplSubject').inputValue();
  ok('AUE editor de template: clicar num chip insere o token {{campo}} na posição do cursor',
    assuntoComChipAue === 'Pedido urgente AUE: {{medicamento}}');

  await page.fill('#tplBody', 'Boa tarde,\n\nSolicitamos autorização para {{medicamento}} para o utente {{nome}}.');
  await page.click('#tplPreviewBtn');
  await page.waitForTimeout(150);
  const previewTextoAue = await page.evaluate(() => document.getElementById('tplPreviewBody')?.textContent);
  ok('AUE editor de template: pré-visualização substitui os tokens por dados de exemplo',
    previewTextoAue === 'Boa tarde,\n\nSolicitamos autorização para Canabidiol 100mg/ml solução oral, 30ml para o utente Maria Silva.');
  await page.click('#tplVoltarBtn');
  await page.waitForTimeout(100);

  await page.click('button:has-text("↺ Repor original")');
  await page.waitForTimeout(100);
  const assuntoRepostoAue = await page.locator('#tplSubject').inputValue();
  ok('AUE editor de template: "Repor original" restaura o texto padrão',
    assuntoRepostoAue === 'Pedido de Autorização de Utilização Excecional (AUE) {{medicamento}}');

  await page.fill('#tplBody', '');
  await page.click('#emailTemplateOverlay button:has-text("Guardar")');
  await page.waitForTimeout(150);
  const aindaAbertoVazioAue = await page.evaluate(() => document.getElementById('emailTemplateOverlay').classList.contains('open'));
  ok('AUE editor de template: guardar com o corpo vazio não fecha o modal (validação)', aindaAbertoVazioAue);

  await page.fill('#tplSubject', 'Pedido urgente AUE: {{medicamento}}');
  await page.fill('#tplBody', 'Boa tarde,\n\nSolicitamos autorização para {{medicamento}} para o utente {{nome}}.');
  await page.click('#emailTemplateOverlay button:has-text("Guardar")');
  await page.waitForTimeout(200);
  const templateGuardadoAue = await page.evaluate(() => JSON.parse(localStorage.getItem('famam_aue_email_template') || 'null'));
  ok('AUE editor de template: template fica gravado em localStorage', templateGuardadoAue?.subject === 'Pedido urgente AUE: {{medicamento}}');

  await page.evaluate(() => { const o = document.getElementById('emailSettingsOverlay'); if (o) o.classList.remove('open'); });
  const nomeP5 = 'Segundo Utente Template QA';
  await page.click('button:has-text("+ Novo pedido AUE")');
  await preencherPedido({
    f_operador: 'Operador QA Dois', f_medicamento: 'Epidiolex Template QA',
    f_nome: nomeP5, f_nif: '199199884', f_telefone: '913444555', f_email: 'template2-qa@qa.pt',
    f_medico: 'Dra. Template QA Dois', f_receita: 'REC-TPL-QA-2'
  });
  await page.selectOption('#f_armazenista', 'OCP');
  await page.click('.modal-foot button:has-text("Guardar alterações")');
  await page.waitForSelector('#emailPreviewOverlay.open', { timeout: 5000 });
  const emailFinalAue = await page.evaluate(() => ({
    subject: document.getElementById('ep_subject')?.value,
    body: document.getElementById('ep_body')?.value,
  }));
  ok('AUE: depois de guardar o template, o email automático de um pedido real usa-o com os dados REAIS desse pedido (não os de exemplo)',
    emailFinalAue.subject === 'Pedido urgente AUE: Epidiolex Template QA' &&
    emailFinalAue.body === 'Boa tarde,\n\nSolicitamos autorização para Epidiolex Template QA para o utente Segundo Utente Template QA.');
  await page.click('.danger-link:has-text("Não enviar")');

  await ctx.close();
}
