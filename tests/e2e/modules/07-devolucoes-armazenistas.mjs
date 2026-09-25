/**
 * Testes e2e do módulo Devoluções · Armazenistas (modulos/devolucoes-armazenistas.html).
 *
 * O módulo tem a sua própria barra de separadores horizontal (nav.tabs:
 * Consulta de Produto / Verificação em Lote / Produtos / Detentores &
 * Regras — não usa a barra inferior mc-bb-item dos outros módulos) e 5
 * chaves de estado internas gravadas independentemente dentro de
 * `devolucoesArmazenistas` (devol-rule-edits, devol-custom-holders,
 * devol-holder-override, devol-product-overrides, devol-custom-products).
 *
 * Os produtos/regras/detentores de teste usados abaixo foram escolhidos por
 * inspeção direta do catálogo real embutido (script#data-blob) para que a
 * classificação (pode devolver / não pode / verificar) seja determinística:
 *  - "HIDROALTESONA 30 CP, 20MG ALTER" (1001545): detentor "ALTER" tem
 *    correspondência a 100% em todos os armazenistas com regra que aceita
 *    devolução → sempre "pode devolver".
 *  - "sonda vesical ch12 - 18/20c" (1000174): detentor "." sem nenhuma
 *    correspondência a uma regra em nenhum armazenista → sempre "não pode
 *    devolver".
 *  - "CANIDRYL 50 MG * 30 CP" (1001735): categoria veterinária → nunca
 *    aceite em nenhum armazenista, independentemente do detentor.
 *  - "ARGILA VERDE 500G" (1000166): categoria "não especificada" mas com
 *    detentor ("Laboratório Maialab...") que TEM correspondência a uma
 *    regra em pelo menos um armazenista → "verificar antes de devolver".
 *
 * O mais importante: este módulo tem o MESMO bug de corrida de
 * leitura-modificação-escrita já corrigido antes em pim.html/gabinete.html
 * (ver o comentário em gravarDevolucoesArmazenistas() dentro de
 * modulos/devolucoes-armazenistas.html) — e, ao contrário de
 * manipulados.html/stocks.html (onde o "estado" gravado é uma única
 * referência partilhada e por isso a perda de dados não é demonstrável),
 * aqui É demonstrável de forma determinística: guardar QUALQUER uma das 5
 * chaves lê o estado completo do servidor, funde só essa chave, e grava
 * tudo outra vez — por isso, sem serialização, gravar duas chaves
 * DIFERENTES (ex.: um detentor novo e um produto novo) em sucessão rápida
 * pode fazer com que a gravação mais lenta a responder reverta, nessa
 * janela, a chave que a outra tinha acabado de gravar. O teste 11 abaixo
 * reproduz exatamente esse cenário.
 *
 * Farmácia de teste sempre criada com signupFarmacia() (via abrirModulo),
 * nunca partilhada com outros ficheiros de tests/e2e/modules/.
 */
import { ok, apiFetch, abrirModulo } from '../helpers.mjs';

const COD_OK = '1001545';       // HIDROALTESONA — sempre "pode devolver"
const COD_SEM_REGRA = '1000174'; // sonda vesical — sempre "não pode devolver" (sem regra)
const COD_VET = '1001735';       // CANIDRYL — sempre "não pode devolver" (veterinário)
const COD_VERIFICAR = '1000166'; // ARGILA VERDE 500G — sempre "verificar" (categoria não especificada)

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
async function contagemUso(token, tarefa) {
  const { mesChave, diaChave } = usoChaves();
  const res = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = JSON.parse(res.body);
  const parsed = body.content ? JSON.parse(body.content) : { dias: {} };
  const dia = parsed.dias?.[diaChave] || {};
  return dia['devolucoes-armazenistas.' + tarefa] || 0;
}

export async function run(browser) {
  const { ctx, page, token, erros } = await abrirModulo(browser, 'devolucoes-armazenistas', { prefixo: 'DevolArmQA' });
  await page.waitForTimeout(600); // init(): 5x storageGet (fetchEstado) + render inicial

  async function estadoDevol() {
    const estado = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body);
    return estado.devolucoesArmazenistas || {};
  }

  // ---------- 1. Barra de separadores própria: cada aba mostra a sua vista ----------
  const abas = [['single', 'Consulta de Produto'], ['batch', 'Verificação em Lote'], ['products', 'Produtos'], ['rules', 'Detentores & Regras']];
  for (const [view, label] of abas) {
    await page.click(`.tab-btn[data-view="${view}"]`);
    await page.waitForTimeout(150);
    const ativa = await page.locator(`#view-${view}.view.active`).count();
    const outrasEscondidas = await page.locator('.view.active').count();
    ok(`Devoluções: aba "${label}" mostra só a sua vista (#view-${view} ativa)`, ativa === 1 && outrasEscondidas === 1);
  }

  // ---------- 2. Consulta de produto único: resultado correto e determinístico ----------
  await page.click('.tab-btn[data-view="single"]');
  await page.waitForTimeout(150);
  await page.fill('#singleSearch', 'ARGILA VERDE 500G');
  await page.waitForSelector('#singleSuggest .opt', { timeout: 5000 });
  await page.click('#singleSuggest .opt >> nth=0');
  await page.waitForTimeout(200);
  const resultCard = await page.locator('#singleResult').innerText();
  ok('Devoluções: consulta de produto mostra a designação correta', resultCard.includes('ARGILA VERDE 500G'));
  ok('Devoluções: consulta de produto mostra o código correto', resultCard.includes('1000166'));
  ok('Devoluções: consulta de produto mostra o detentor de AIM real do catálogo', resultCard.includes('Maialab'));
  ok('Devoluções: produto com categoria não especificada mas detentor com correspondência é classificado "verificar"',
    resultCard.includes('Verificar antes de devolver'), resultCard.slice(0, 200));

  // ---------- 3. Verificação em lote: classificação determinística (4 produtos conhecidos) ----------
  await page.click('.tab-btn[data-view="batch"]');
  await page.waitForTimeout(150);
  await page.fill('#batchInput', [COD_OK, COD_SEM_REGRA, COD_VET, COD_VERIFICAR].join('\n'));
  await page.click('#btnRunBatch');
  await page.waitForTimeout(300);
  const countPode = await page.locator('#countPode').innerText();
  const countNaPode = await page.locator('#countNaPode').innerText();
  const countVerif = await page.locator('#countVerif').innerText();
  ok('Devoluções (lote): produto com detentor 100% correspondente e regra que aceita vai para "Pode devolver"', countPode === '1', `pode=${countPode}`);
  ok('Devoluções (lote): produto sem regra em nenhum armazenista + produto veterinário vão para "Não pode devolver"', countNaPode === '2', `napode=${countNaPode}`);
  ok('Devoluções (lote): produto de categoria não especificada mas com detentor correspondente vai para "Verificar"', countVerif === '1', `verificar=${countVerif}`);
  const colNaPodeTexto = await page.locator('#colNaPode').innerText();
  ok('Devoluções (lote): coluna "Não pode devolver" identifica o motivo veterinário', colNaPodeTexto.toLowerCase().includes('veterin'));

  // ---------- 4. Gestão de produtos: adicionar produto novo (customizado) + persistência ----------
  await page.click('.tab-btn[data-view="products"]');
  await page.waitForTimeout(200);
  const codigoNovoProduto = 'QA' + Date.now().toString().slice(-8);
  const nomeNovoProduto = 'Produto Novo QA Teste';
  await page.click('#btnAddProduct');
  await page.waitForTimeout(150);
  await page.fill('#prodNomeInput', nomeNovoProduto);
  await page.fill('#prodCodigoInput', codigoNovoProduto);
  await page.click('#btnSaveHolderFix');
  // espera a confirmação do servidor (não um timeout fixo): o modal só fecha
  // e a tabela só é re-renderizada DEPOIS do storageSet resolver.
  const devolAposProduto = await poll(async () => {
    const d = await estadoDevol();
    const lista = d['devol-custom-products'] || [];
    return lista.find(c => c.codigo === codigoNovoProduto) || null;
  });
  ok('Devoluções: produto novo persistido no servidor (devol-custom-products)', !!devolAposProduto);
  // O servidor confirmar a gravação (acima) e este separador re-renderizar a
  // tabela são dois sinais observados por dois canais diferentes (o pedido
  // HTTP direto do teste vs. o próprio evento-clique da página) — não há
  // garantia de ordem entre os dois processos, por isso sondamos o DOM em
  // vez de assumir que já está pronto no instante seguinte ao poll do servidor.
  const linhaNovoProduto = await poll(async () => (await page.locator('#productsTbody tr', { hasText: nomeNovoProduto }).count()) === 1 ? true : null);
  ok('Devoluções: produto novo aparece na tabela de Gestão de produtos', !!linhaNovoProduto);

  // ---------- 5. O produto novo passa a ser encontrável na Consulta de Produto ----------
  await page.click('.tab-btn[data-view="single"]');
  await page.waitForTimeout(150);
  await page.fill('#singleSearch', nomeNovoProduto);
  await page.waitForSelector('#singleSuggest .opt', { timeout: 5000 });
  await page.click('#singleSuggest .opt >> nth=0');
  await page.waitForTimeout(200);
  ok('Devoluções: produto adicionado em "Produtos" é encontrável na Consulta de Produto', (await page.locator('#singleResult').innerText()).includes(nomeNovoProduto));

  // ---------- 6. Editar categoria de um produto do catálogo muda a classificação ----------
  await page.click('.tab-btn[data-view="products"]');
  await page.waitForTimeout(150);
  await page.fill('#productsFilter', COD_VERIFICAR); // filtra pelo código para não ambiguar com "ARGILA VERDE 1KG" (produto distinto no catálogo)
  await page.waitForTimeout(250);
  await page.locator('#productsTbody tr', { hasText: 'ARGILA VERDE 500G' }).locator('[data-action="edit-product"]').click();
  await page.waitForTimeout(200);
  await page.selectOption('#prodFamSelect', '0'); // 0 = Medicamento (era categoria "não especificada")
  await page.click('#btnSaveHolderFix');
  await page.waitForTimeout(400);

  const overrideFamRemoto = await poll(async () => {
    const d = await estadoDevol();
    const ov = (d['devol-product-overrides'] || {})[COD_VERIFICAR];
    return (ov && String(ov.fam) === '0') ? ov : null;
  });
  ok('Devoluções: editar a categoria de um produto persiste a alteração no servidor (devol-product-overrides)', !!overrideFamRemoto);

  await page.click('.tab-btn[data-view="single"]');
  await page.waitForTimeout(150);
  await page.fill('#singleSearch', 'ARGILA VERDE 500G');
  await page.waitForSelector('#singleSuggest .opt', { timeout: 5000 });
  await page.click('#singleSuggest .opt >> nth=0');
  await page.waitForTimeout(200);
  const resultCardDepoisEdit = await page.locator('#singleResult').innerText();
  ok('Devoluções: mudar a categoria de "não especificada" para "Medicamento" muda o resultado (deixa de ser "verificar")',
    !resultCardDepoisEdit.includes('Verificar antes de devolver'), resultCardDepoisEdit.slice(0, 200));

  // ---------- 7. Remover um produto tira-o da Consulta de Produto; restaurar devolve-o ----------
  await page.click('.tab-btn[data-view="products"]');
  await page.waitForTimeout(150);
  await page.fill('#productsFilter', COD_SEM_REGRA); // filtra pelo código para não ambiguar com "SONDA VESICAL CH12 20CM ALÇON" (produto distinto no catálogo)
  await page.waitForTimeout(250);
  page.once('dialog', d => d.accept()); // remove-product pede confirmação nativa (confirm())
  await page.locator('#productsTbody tr', { hasText: 'sonda vesical ch12 - 18/20c' }).locator('[data-action="remove-product"]').click();
  // espera a confirmação do próprio servidor (não um timeout fixo) antes de
  // continuar — gravarDevolucoesArmazenistas() só fecha o ciclo depois de um
  // GET+PUT completo, que pode demorar mais que um timeout fixo curto.
  const overrideRemovidoConfirmado = await poll(async () => {
    const d = await estadoDevol();
    const ov = (d['devol-product-overrides'] || {})[COD_SEM_REGRA];
    return (ov && ov.removed === true) ? ov : null;
  });
  ok('Devoluções: remover produto persiste "removed:true" no servidor antes de continuar', !!overrideRemovidoConfirmado);
  await page.click('.tab-btn[data-view="single"]');
  await page.fill('#singleSearch', 'sonda vesical ch12 - 18/20c'); // designação exata — evita ambiguar com "SONDA VESICAL CH12 20CM ALÇON"
  await page.waitForTimeout(300);
  const semSugestaoAposRemover = await page.locator('#singleSuggest .opt').count();
  ok('Devoluções: remover um produto tira-o da Consulta de Produto (sem sugestões)', semSugestaoAposRemover === 0);

  await page.click('.tab-btn[data-view="products"]');
  await page.waitForTimeout(150);
  await page.fill('#productsFilter', COD_SEM_REGRA);
  await page.waitForTimeout(250);
  await page.locator('#productsTbody tr', { hasText: 'sonda vesical ch12 - 18/20c' }).locator('[data-action="restore-product"]').click();
  await page.waitForTimeout(400);
  const overrideRemovidoRemoto = await poll(async () => {
    const d = await estadoDevol();
    const ov = (d['devol-product-overrides'] || {})[COD_SEM_REGRA];
    return (ov && ov.removed === false) ? ov : null;
  });
  ok('Devoluções: restaurar um produto persiste no servidor (removed:false)', !!overrideRemovidoRemoto);

  // ---------- 8. Detentores & Regras (armazenista OCP — campo único "regra") ----------
  await page.click('.tab-btn[data-view="rules"]');
  await page.waitForTimeout(200);
  await page.click('#wholesalerSubtabs button[data-w="ocp"]');
  await page.waitForTimeout(200);

  const nomeDetentorNovo = 'Detentor QA Teste ' + Date.now();
  await page.click('#btnAddHolder');
  await page.waitForTimeout(150);
  await page.fill('#newHolderNome', nomeDetentorNovo);
  await page.fill('#newHolderRegra', 'Aceita até 4 meses antes do PV (regra QA)');
  await page.click('#btnSaveNewHolder');
  // espera a confirmação do servidor (não um timeout fixo): o modal só fecha
  // e a tabela só é re-renderizada DEPOIS do storageSet resolver.
  const detentorNovoRemoto = await poll(async () => {
    const d = await estadoDevol();
    const lista = (d['devol-custom-holders'] || {}).ocp || [];
    return lista.find(h => h.nome === nomeDetentorNovo) || null;
  });
  ok('Devoluções: novo detentor OCP persistido no servidor (devol-custom-holders)', !!detentorNovoRemoto && detentorNovoRemoto.regra === 'Aceita até 4 meses antes do PV (regra QA)');
  // a coluna "nome" de uma linha personalizada (isCustom) é um <input> editável
  // (ver renderRulesTable) — o nome vive no atributo `value`, não em texto
  // visível, por isso um locator baseado em hasText/innerText nunca o
  // encontraria; confirma-se diretamente o valor do input.
  const nomeApareceNaTabela = await page.locator('#rulesTbody input.rt-editable[data-field="nome"]')
    .evaluateAll((inputs, nome) => inputs.some(i => i.value === nome), nomeDetentorNovo);
  ok('Devoluções: novo detentor OCP aparece na tabela de regras', nomeApareceNaTabela);

  // ---------- 9. Editar diretamente uma regra existente (célula editável da tabela) ----------
  await page.fill('#rulesFilter', '3M PORTUGAL');
  await page.waitForTimeout(200);
  const linha3M = page.locator('#rulesTbody tr', { hasText: '3M PORTUGAL' });
  await linha3M.locator('.rt-editable[data-field="regra"]').fill('Regra editada em QA — aceita sempre');
  await linha3M.locator('.rt-editable[data-field="regra"]').press('Tab');
  await page.waitForTimeout(400);
  const regraEditadaRemota = await poll(async () => {
    const d = await estadoDevol();
    const edits = (d['devol-rule-edits'] || {}).ocp || {};
    return Object.values(edits).find(e => e.regra === 'Regra editada em QA — aceita sempre') || null;
  });
  ok('Devoluções: editar diretamente uma célula da tabela de regras persiste no servidor (devol-rule-edits)', !!regraEditadaRemota);

  // ---------- 10. "Repor regras originais" reverte as edições deste armazenista ----------
  page.once('dialog', d => d.accept());
  await page.click('#btnResetEdits');
  await page.waitForTimeout(400);
  const textoRegraAposReset = await linha3M.locator('.rt-editable[data-field="regra"]').inputValue();
  ok('Devoluções: "Repor regras originais" reverte o texto editado na tabela', textoRegraAposReset !== 'Regra editada em QA — aceita sempre', textoRegraAposReset);
  const editsAposReset = await poll(async () => {
    const d = await estadoDevol();
    const edits = (d['devol-rule-edits'] || {}).ocp || {};
    return Object.keys(edits).length === 0 ? true : null;
  });
  ok('Devoluções: "Repor regras originais" limpa também as edições persistidas no servidor', !!editsAposReset);

  // ---------- 11. BUG DE CORRIDA (corrigido nesta sessão): duas chaves diferentes gravadas em sucessão rápida ----------
  // Dispara duas gravações reais de CHAVES DIFERENTES (adicionar um detentor
  // OCP + adicionar um produto novo) sem esperar a primeira terminar — antes
  // da correção (fila gravarQueue/enqueueSync em
  // gravarDevolucoesArmazenistas), a 2ª gravação podia ler o servidor a meio
  // do PUT da 1ª e, ao gravar só a SUA própria chave por cima do que leu,
  // apagar a chave que a 1ª tinha acabado de gravar (lost update).
  //
  // O 1º modal (novo detentor) só fecha DEPOIS do seu próprio storageSet
  // resolver — por isso, para garantir a sobreposição real das duas
  // gravações (em vez de o Playwright ficar à espera que o 1º modal feche
  // antes de conseguir clicar em elementos por baixo dele), a 2ª ação é
  // disparada via clique nativo direto no botão (bypassa a verificação de
  // "está tapado por um overlay" do Playwright, mas continua a acionar o
  // mesmíssimo listener real de clique da aplicação — nenhuma lógica é
  // simulada, só a forma de despoletar o clique).
  //
  // Num servidor local tão rápido, os dois GET+PUT podem simplesmente não
  // chegar a sobrepor-se por acaso (confirmado experimentalmente: sem este
  // atraso, o teste passava mesmo com a correção desfeita de propósito,
  // porque as duas gravações raramente coincidiam a tempo). Para tornar a
  // sobreposição determinística (e por isso o teste um regressor real, não
  // dependente da sorte do timing de rede), atrasa-se deliberadamente cada
  // PUT a /api/data — o suficiente para a 2ª gravação arrancar em pleno
  // decurso da 1ª, mas sem afetar a correção do que está a ser testado.
  await page.route('**/api/data', async (route) => {
    if (route.request().method() === 'PUT') await new Promise(r => setTimeout(r, 400));
    await route.continue();
  });

  const nomeDetentorCorrida = 'Detentor Corrida QA ' + Date.now();
  const codigoProdutoCorrida = 'QAR' + Date.now().toString().slice(-8);
  const nomeProdutoCorrida = 'Produto Corrida QA';

  await page.click('#btnAddHolder');
  await page.waitForTimeout(150);
  await page.fill('#newHolderNome', nomeDetentorCorrida);
  await page.fill('#newHolderRegra', 'Regra da corrida QA');
  await page.click('#btnSaveNewHolder'); // gravação 1 (chave devol-custom-holders) — não se espera

  await page.waitForTimeout(60); // deliberadamente curto — a gravação 1 ainda está em curso (o seu PUT está atrasado pela rota acima)
  await page.evaluate(() => document.getElementById('btnAddProduct').click());
  await page.waitForTimeout(60);
  await page.evaluate((v) => { document.getElementById('prodNomeInput').value = v; }, nomeProdutoCorrida);
  await page.evaluate((v) => { document.getElementById('prodCodigoInput').value = v; }, codigoProdutoCorrida);
  await page.evaluate(() => document.getElementById('btnSaveHolderFix').click()); // gravação 2 (chave devol-custom-products), disparada em cima da 1ª
  await page.waitForTimeout(2200);
  await page.unroute('**/api/data');

  const estadoAposCorrida = await estadoDevol();
  const detentorSobreviveu = ((estadoAposCorrida['devol-custom-holders'] || {}).ocp || []).some(h => h.nome === nomeDetentorCorrida);
  const produtoSobreviveu = (estadoAposCorrida['devol-custom-products'] || []).some(c => c.codigo === codigoProdutoCorrida);
  ok('Devoluções: duas gravações de chaves DIFERENTES em sucessão rápida — o detentor da 1ª sobrevive', detentorSobreviveu);
  ok('Devoluções: duas gravações de chaves DIFERENTES em sucessão rápida — o produto da 2ª também sobrevive (nenhuma apaga a outra)', produtoSobreviveu);

  // ---------- 12. Importar regras de devolução (Excel/CSV/PDF) — mesmo motor de importação de
  // catalogo-produtos.html (deteção automática de colunas por palavras-chave no cabeçalho,
  // pré-visualização com mapeamento corrigível à mão, só grava depois de confirmado), adaptado ao
  // modelo real de "regra" deste módulo: por armazenista, um detentor tem um valor de TEXTO LIVRE
  // por campo (medicamentos/dm/otc na Alliance, msrm/mnsrm/dm/suppl na Empifarma, regra na OCP) —
  // não um simples booleano. O botão "Importar regras" opera sempre sobre o armazenista atualmente
  // selecionado no separador (tal como "+ Novo detentor de AIM" já fazia). ----------
  await page.click('#wholesalerSubtabs button[data-w="ocp"]');
  await page.waitForTimeout(150);
  await page.click('#btnImportRules');
  await page.waitForTimeout(150);
  const modalImportVisivelOcp = await page.locator('#modalImportRules.show').count();
  const labelArmazenistaImportOcp = await page.locator('#modalImportRulesWholesaler').innerText();
  ok('Devoluções (importar regras): o botão "Importar regras" abre o modal para o armazenista atualmente selecionado (OCP)',
    modalImportVisivelOcp === 1 && labelArmazenistaImportOcp.includes('OCP Portugal'), labelArmazenistaImportOcp);

  // ---------- 13. Importar um CSV com 3 linhas: atualiza um detentor OCP já existente ("3M
  // PORTUGAL"), cria um detentor novo, e ignora uma linha sem nenhum valor de regra reconhecido ----------
  const nomeDetentorImportadoNovo = 'Detentor Importado QA ' + Date.now();
  const csvRegrasOcp = [
    'Detentor de AIM,Regra de devolução',
    '3M PORTUGAL,Aceita até 5 meses antes do PV (import QA)',
    `${nomeDetentorImportadoNovo},Aceita sempre (import QA — novo detentor)`,
    'Detentor Sem Regra QA,', // sem valor na coluna de regra -> linha ignorada (nada para aplicar)
  ].join('\n');
  await page.setInputFiles('#importRulesFileInput', { name: 'regras-ocp-qa.csv', mimeType: 'text/csv', buffer: Buffer.from(csvRegrasOcp, 'utf8') });
  await page.waitForTimeout(300);
  const previewTexto = await page.locator('#importRulesArea').innerText();
  const mapeamentoNomeAutoDetetado = await page.locator('#mapNomeRegra').inputValue();
  ok('Devoluções (importar regras): a pré-visualização deteta as 3 linhas do CSV e mapeia automaticamente a coluna "Detentor de AIM"',
    previewTexto.includes('3 linha(s) detetada(s)') && mapeamentoNomeAutoDetetado !== '-1', previewTexto.slice(0, 200));

  await page.click('#btnConfirmarImportacaoRegras');
  await page.waitForTimeout(300);
  const resumoImportacaoOcp = await page.locator('#importRulesArea').innerText();
  ok('Devoluções (importar regras): o resumo final reporta exatamente 2 regras aplicadas (1 atualizada + 1 detentor novo) — a 3ª linha, sem valor de regra, foi corretamente ignorada',
    resumoImportacaoOcp.includes('2 regra(s) aplicada(s)') && resumoImportacaoOcp.includes('1 atualizada(s)') && resumoImportacaoOcp.includes('1 detentor(es) novo(s) criado(s)'),
    resumoImportacaoOcp);

  const estadoAposImportOcp = await poll(async () => {
    const d = await estadoDevol();
    const edits = (d['devol-rule-edits'] || {}).ocp || {};
    const holders = (d['devol-custom-holders'] || {}).ocp || [];
    const editou3M = Object.values(edits).find(e => e.regra === 'Aceita até 5 meses antes do PV (import QA)');
    const novoHolder = holders.find(h => h.nome === nomeDetentorImportadoNovo && h.regra === 'Aceita sempre (import QA — novo detentor)');
    const semRegraNaoCriado = !holders.some(h => h.nome === 'Detentor Sem Regra QA');
    return (editou3M && novoHolder && semRegraNaoCriado) ? { editou3M, novoHolder } : null;
  });
  ok('Devoluções (importar regras): a importação persiste no servidor tanto a atualização de uma regra já existente (devol-rule-edits) como o novo detentor criado (devol-custom-holders)',
    !!estadoAposImportOcp);

  await page.click('.modal-bg.show [data-close]');
  await page.waitForTimeout(150);
  await page.fill('#rulesFilter', '3M PORTUGAL');
  await page.waitForTimeout(200);
  const regra3MNaTabelaAposImport = await page.locator('#rulesTbody tr', { hasText: '3M PORTUGAL' }).locator('.rt-editable[data-field="regra"]').inputValue();
  ok('Devoluções (importar regras): a tabela reflete de imediato o texto importado para um detentor já existente',
    regra3MNaTabelaAposImport === 'Aceita até 5 meses antes do PV (import QA)', regra3MNaTabelaAposImport);

  await page.fill('#rulesFilter', nomeDetentorImportadoNovo);
  await page.waitForTimeout(200);
  const novoDetentorNaTabelaAposImport = await page.locator('#rulesTbody input.rt-editable[data-field="nome"]')
    .evaluateAll((inputs, nome) => inputs.some(i => i.value === nome), nomeDetentorImportadoNovo);
  ok('Devoluções (importar regras): o novo detentor criado pela importação aparece na tabela de regras', !!novoDetentorNaTabelaAposImport);

  // ---------- 14. Registo de uso: "importar_regras" conta as 2 regras EFETIVAMENTE aplicadas (não o nº de ficheiros nem de linhas do CSV) ----------
  await page.waitForTimeout(2600); // debounce (2s) + flush de registarUso (uso-AAAA-MM)
  const usoImportarRegras = await contagemUso(token, 'importar_regras');
  ok('Devoluções (importar regras): regista o uso "importar_regras" com qtd=2 (as 2 regras realmente aplicadas — 1 atualizada + 1 criada)', usoImportarRegras === 2, `uso=${usoImportarRegras}`);

  // ---------- 15. Caso de erro: um CSV só com cabeçalho (sem nenhuma linha de dados) é tratado sem rebentar a página ----------
  await page.click('#wholesalerSubtabs button[data-w="empifarma"]');
  await page.waitForTimeout(150);
  await page.click('#btnImportRules');
  await page.waitForTimeout(150);
  await page.setInputFiles('#importRulesFileInput', { name: 'vazio-qa.csv', mimeType: 'text/csv', buffer: Buffer.from('Detentor de AIM,MSRM\n', 'utf8') });
  await page.waitForTimeout(250);
  const mensagemFicheiroVazio = await page.locator('#importRulesArea').innerText();
  ok('Devoluções (importar regras): um CSV só com cabeçalho (sem linhas de dados) mostra uma mensagem clara em vez de rebentar a página',
    mensagemFicheiroVazio.includes('não tem linhas de dados'), mensagemFicheiroVazio);

  // ---------- 16. Caso de erro: sem nenhuma coluna reconhecível como "Detentor de AIM", a deteção
  // automática não arrisca um palpite errado (fica "(nenhuma)"), e confirmar sem mapear à mão não
  // grava nada no servidor (em vez de rebentar ou gravar lixo) ----------
  const estadoAntesTentativaSemColuna = await estadoDevol();
  await page.setInputFiles('#importRulesFileInput', { name: 'semcolunas-qa.csv', mimeType: 'text/csv', buffer: Buffer.from('Col A,Col B\nxxx,yyy\n', 'utf8') });
  await page.waitForTimeout(250);
  const mapeamentoNomeSemColuna = await page.locator('#mapNomeRegra').inputValue();
  ok('Devoluções (importar regras): colunas sem nenhuma palavra-chave reconhecível ficam por mapear ("(nenhuma)") em vez de um palpite errado',
    mapeamentoNomeSemColuna === '-1', mapeamentoNomeSemColuna);
  await page.click('#btnConfirmarImportacaoRegras');
  await page.waitForTimeout(250);
  const estadoDepoisTentativaSemColuna = await estadoDevol();
  ok('Devoluções (importar regras): tentar confirmar sem mapear a coluna do detentor não grava nada no servidor (nem detentores novos, nem edições de regras)',
    JSON.stringify(estadoDepoisTentativaSemColuna['devol-custom-holders']) === JSON.stringify(estadoAntesTentativaSemColuna['devol-custom-holders']) &&
    JSON.stringify(estadoDepoisTentativaSemColuna['devol-rule-edits']) === JSON.stringify(estadoAntesTentativaSemColuna['devol-rule-edits']));

  // ---------- 17. Importar via PDF: este ambiente de testes não tem acesso à rede externa (mesma
  // política de sandbox documentada em tests/e2e/modules/14-conversor-pdf.mjs), pelo que o pdf.js
  // do CDN não chega a carregar — este é exatamente o cenário real de produção quando essa
  // biblioteca de terceiros falha, e o teste confirma que o módulo o trata de forma graciosa (aviso
  // claro, sem rebentar a página), tal como catalogo-produtos.html/conversor-pdf.html já fazem. ----------
  await page.setInputFiles('#importRulesFileInput', { name: 'vazio-qa.csv', mimeType: 'text/csv', buffer: Buffer.from('', 'utf8') }); // limpa a pré-visualização anterior
  await page.waitForTimeout(150);
  const pdfjsCarregouNesteAmbiente = await page.evaluate(() => typeof window.pdfjsLib !== 'undefined');
  await page.setInputFiles('#importRulesFileInput', { name: 'regras-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 conteúdo de teste', 'utf8') });
  await page.waitForTimeout(300);
  const mensagemErroPdf = await page.locator('#importRulesArea').innerText();
  ok('Devoluções (importar regras): quando o pdf.js do CDN não carrega, importar um PDF mostra um erro claro em vez de rebentar a página',
    !pdfjsCarregouNesteAmbiente && mensagemErroPdf.includes('Erro ao processar o ficheiro'), JSON.stringify({ pdfjsCarregouNesteAmbiente, mensagemErroPdf }));

  await page.click('.modal-bg.show [data-close]');
  await page.waitForTimeout(150);

  // ---------- 18. Nenhum erro de consola/página inesperado ao longo de todo o módulo (incluindo os fluxos de importação acima) ----------
  ok('Devoluções: módulo carrega e é usado do início ao fim sem erros de consola/página inesperados', erros.length === 0, erros.join(' | '));

  await ctx.close();
}
