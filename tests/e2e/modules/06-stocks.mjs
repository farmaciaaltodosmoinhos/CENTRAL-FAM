/**
 * Testes e2e do módulo Stocks Errados (modulos/stocks.html).
 *
 * Cobre: validação do campo obrigatório "Nome operador" (ao criar E ao
 * editar/renomear uma lista — acrescentado nesta sessão anterior), criar/
 * editar/eliminar uma lista via UI real com persistência confirmada no
 * servidor (/api/data, campo `stocksErrados`), adicionar produtos à lista
 * (via pesquisa no catálogo real e via "produto manual"), editar os campos
 * de stock e o campo "Motivo" (as 3 opções fixas + texto livre em
 * "Outros", também acrescentado nesta sessão anterior), remover um item, e
 * a compatibilidade com registos antigos que só têm `obs` (texto livre)
 * em vez de `motivo`.
 *
 * Nota sobre o mesmo padrão de bug de corrida do pim.html/gabinete.html:
 * gravarStocksErrados() tem o mesmo read-modify-write sem serialização
 * (corrigido também aqui, ver gravarQueue/enqueueSync em
 * modulos/stocks.html), mas tal como em manipulados.html (e ao contrário de
 * devolucoes-armazenistas.html, que tem 5 chaves internas independentes —
 * ver 07-devolucoes-armazenistas.mjs), o objeto `LISTS` é sempre a mesma
 * referência partilhada e só é lida no momento exato de cada PUT, por isso
 * duas gravações rápidas deste módulo não perdem dados da própria lista
 * entre si. A correção fica como hardening preventivo/consistência — não
 * há aqui, de propósito, um teste de corrida fabricado.
 *
 * Farmácia de teste sempre criada com signupFarmacia() (via abrirModulo),
 * nunca partilhada com outros ficheiros de tests/e2e/modules/.
 */
import { ok, apiFetch, abrirModulo } from '../helpers.mjs';

async function poll(fn, { tries = 15, delay = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

export async function run(browser) {
  const { ctx, page, token } = await abrirModulo(browser, 'stocks', { prefixo: 'StocksQA' });
  await page.waitForTimeout(500); // catálogo de produtos + loadInitialData

  async function estadoAtual() {
    return JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body);
  }
  function listaPorNome(estado, nome) {
    return Object.values(estado.stocksErrados || {}).find(l => l.nome === nome) || null;
  }

  // ---------- 1. Validação: criar lista sem "Nome do operador" é bloqueada ----------
  await page.click('#btnNewList');
  await page.waitForTimeout(150);
  await page.fill('#modalListName', 'Lista sem operador QA');
  await page.fill('#modalListOperador', '');
  await page.click('#modalListSave');
  await page.waitForTimeout(200);
  ok('Stocks: criar lista sem "Nome do operador" não fecha o modal', await page.locator('#modalList.show').count() === 1);
  const listaBloqueada = await page.locator('.list-item .li-name:has-text("Lista sem operador QA")').count();
  ok('Stocks: lista sem operador não chega a ser criada', listaBloqueada === 0);

  // ---------- 2. Criar lista real (nome + operador) + persistência ----------
  const nomeLista1 = 'Lista QA ' + Date.now();
  await page.fill('#modalListName', nomeLista1);
  await page.fill('#modalListOperador', 'Ana QA Operadora');
  await page.click('#modalListSave');
  await page.waitForTimeout(400);
  ok('Stocks: lista criada com operador aparece na barra lateral', await page.locator('.list-item.active .li-name', { hasText: nomeLista1 }).count() === 1);

  const listaRemota1 = await poll(async () => listaPorNome(await estadoAtual(), nomeLista1));
  ok('Stocks: lista persistida no servidor (/api/data, campo stocksErrados)', !!listaRemota1);
  ok('Stocks: operador gravado corretamente no servidor', listaRemota1?.operador === 'Ana QA Operadora');

  // ---------- 3. Validação: editar/renomear uma lista sem operador também é bloqueada ----------
  await page.click('#btnRename');
  await page.waitForTimeout(150);
  await page.fill('#modalListOperador', '');
  await page.click('#modalListSave');
  await page.waitForTimeout(200);
  ok('Stocks: renomear lista apagando o "Nome do operador" não fecha o modal', await page.locator('#modalList.show').count() === 1);
  const estadoAposTentativa = await estadoAtual();
  ok('Stocks: o operador da lista no servidor não foi apagado pela tentativa bloqueada',
    listaPorNome(estadoAposTentativa, nomeLista1)?.operador === 'Ana QA Operadora');

  // renomear com sucesso (nome + operador preenchidos)
  const nomeLista1Renomeada = nomeLista1 + ' (renomeada)';
  await page.fill('#modalListName', nomeLista1Renomeada);
  await page.fill('#modalListOperador', 'Bruno QA Operador');
  await page.click('#modalListSave');
  await page.waitForTimeout(400);
  ok('Stocks: renomear lista com operador válido é aceite e reflete-se no título', await page.locator('#listTitle', { hasText: nomeLista1Renomeada }).count() === 1);
  const listaRenomeadaRemota = await poll(async () => listaPorNome(await estadoAtual(), nomeLista1Renomeada));
  ok('Stocks: renomeação (nome + novo operador) persiste no servidor', listaRenomeadaRemota?.operador === 'Bruno QA Operador');

  // ---------- 4. Adicionar produto via pesquisa no catálogo real ----------
  await page.fill('#productSearch', 'ALCOOL SANITARIO');
  await page.waitForTimeout(400); // catálogo pode ainda estar a carregar na primeira pesquisa
  await page.waitForSelector('#productSuggest .sg-item', { timeout: 5000 });
  await page.click('#productSuggest .sg-item >> nth=0');
  await page.waitForTimeout(400);
  const linhaAlcool = await page.locator('#itemsTbody tr', { hasText: 'ALCOOL SANITARIO' }).count();
  ok('Stocks: pesquisa no catálogo real adiciona o produto escolhido à lista', linhaAlcool === 1);
  const codigoAlcoolCell = await page.locator('#itemsTbody tr', { hasText: 'ALCOOL SANITARIO' }).locator('.code').innerText();
  ok('Stocks: produto adicionado via pesquisa traz o código correto do catálogo', codigoAlcoolCell.trim() === '1000026', `código=${codigoAlcoolCell}`);

  // ---------- 5. Adicionar produto manual (fora do catálogo) ----------
  await page.click('#btnToggleManual');
  await page.waitForTimeout(150);
  await page.fill('#manualName', 'PRODUTO MANUAL QA SEM CÓDIGO');
  await page.fill('#manualCode', '');
  await page.click('#btnManualAdd');
  await page.waitForTimeout(400);
  const linhaManual = await page.locator('#itemsTbody tr', { hasText: 'PRODUTO MANUAL QA SEM CÓDIGO' });
  ok('Stocks: produto manual (fora do catálogo) é adicionado à lista', await linhaManual.count() === 1);
  ok('Stocks: produto manual mostra o emblema "Manual" na tabela', (await linhaManual.innerText()).includes('Manual'));

  // ---------- 6. Editar stock sistema/contado — diferença calculada corretamente ----------
  const linhaAlcoolRow = page.locator('#itemsTbody tr', { hasText: 'ALCOOL SANITARIO' });
  await linhaAlcoolRow.locator('.in-sistema').fill('50');
  await linhaAlcoolRow.locator('.in-sistema').press('Tab');
  await linhaAlcoolRow.locator('.in-contado').fill('42');
  await linhaAlcoolRow.locator('.in-contado').press('Tab');
  await page.waitForTimeout(400);
  const diffTextoNeg = await page.locator('#itemsTbody tr', { hasText: 'ALCOOL SANITARIO' }).locator('.diff').innerText();
  ok('Stocks: diferença negativa (contado < sistema) mostra "-8"', diffTextoNeg.trim() === '-8', `texto=${diffTextoNeg}`);
  ok('Stocks: diferença negativa recebe a classe visual "neg"', await page.locator('#itemsTbody tr', { hasText: 'ALCOOL SANITARIO' }).locator('.diff.neg').count() === 1);

  const listaComStocksRemota = await poll(async () => {
    const l = listaPorNome(await estadoAtual(), nomeLista1Renomeada);
    const it = l?.items?.find(i => i.codigo === '1000026');
    return (it && String(it.stockSistema) === '50' && String(it.stockContado) === '42') ? it : null;
  });
  ok('Stocks: valores de stock sistema/contado persistidos no servidor', !!listaComStocksRemota);

  // ---------- 7. Campo "Motivo" — as 3 opções fixas + texto livre em "Outros" ----------
  await linhaAlcoolRow.locator('.in-motivo').selectOption('procurei');
  await page.waitForTimeout(400);
  const motivoProcureiRemoto = await poll(async () => {
    const l = listaPorNome(await estadoAtual(), nomeLista1Renomeada);
    const it = l?.items?.find(i => i.codigo === '1000026');
    return (it && it.motivo === 'procurei') ? it : null;
  });
  ok('Stocks: motivo "Procurei bem..." grava a chave fixa correta no servidor', !!motivoProcureiRemoto);

  await linhaAlcoolRow.locator('.in-motivo').selectOption('outros');
  await page.waitForTimeout(200);
  ok('Stocks: escolher "Outros" revela o campo de texto livre', await linhaAlcoolRow.locator('.in-motivo-outros:visible').count() === 1);
  await linhaAlcoolRow.locator('.in-motivo-outros').fill('Motivo específico escrito à mão em QA');
  await linhaAlcoolRow.locator('.in-motivo-outros').press('Tab');
  await page.waitForTimeout(400);
  const motivoOutrosRemoto = await poll(async () => {
    const l = listaPorNome(await estadoAtual(), nomeLista1Renomeada);
    const it = l?.items?.find(i => i.codigo === '1000026');
    return (it && it.motivo === 'outros' && it.motivoOutros === 'Motivo específico escrito à mão em QA') ? it : null;
  });
  ok('Stocks: motivo "Outros" grava também o texto livre associado', !!motivoOutrosRemoto);

  // ---------- 8. Remover item da lista + persistência ----------
  await page.locator('#itemsTbody tr', { hasText: 'PRODUTO MANUAL QA SEM CÓDIGO' }).locator('.btn-remove').click();
  await page.waitForTimeout(400);
  ok('Stocks: remover um item tira-o da tabela', await page.locator('#itemsTbody tr', { hasText: 'PRODUTO MANUAL QA SEM CÓDIGO' }).count() === 0);
  const listaSemManualRemota = await poll(async () => {
    const l = listaPorNome(await estadoAtual(), nomeLista1Renomeada);
    return (l && !l.items.some(i => i.designacao === 'PRODUTO MANUAL QA SEM CÓDIGO')) ? l : null;
  });
  ok('Stocks: remoção do item persiste no servidor', !!listaSemManualRemota);

  // ---------- 9. Compatibilidade com registos antigos (só `obs`, sem `motivo`) ----------
  const estadoParaLegado = await estadoAtual();
  const idLista1 = Object.keys(estadoParaLegado.stocksErrados).find(id => estadoParaLegado.stocksErrados[id].nome === nomeLista1Renomeada);
  estadoParaLegado.stocksErrados[idLista1].items.push({
    codigo: '9999999', designacao: 'PRODUTO ANTIGO QA (legado)', fam: null,
    stockSistema: '10', stockContado: '8', obs: 'observação antiga em texto livre'
  });
  await apiFetch('/api/data', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(estadoParaLegado) });
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('load');
  await page.waitForTimeout(1200);
  await page.click(`.list-item .li-name:has-text("${nomeLista1Renomeada}")`);
  await page.waitForTimeout(300);
  const linhaLegado = page.locator('#itemsTbody tr', { hasText: 'PRODUTO ANTIGO QA (legado)' });
  ok('Stocks: registo antigo sem `motivo` (só `obs`) continua a aparecer na tabela após reload', await linhaLegado.count() === 1);
  const textoLegado = await linhaLegado.innerText();
  ok('Stocks: registo antigo mostra a observação antiga claramente rotulada como "(registo antigo)"', textoLegado.includes('(registo antigo)') && textoLegado.includes('observação antiga em texto livre'), textoLegado);

  // ---------- 10. Eliminar lista + persistência ----------
  await page.click('#btnDeleteList');
  await page.waitForTimeout(150);
  await page.click('#confirmOkBtn');
  await page.waitForTimeout(400);
  ok('Stocks: eliminar lista remove-a da barra lateral', await page.locator('.list-item .li-name', { hasText: nomeLista1Renomeada }).count() === 0);
  await page.waitForTimeout(600);
  const listaAindaNoServidor = listaPorNome(await estadoAtual(), nomeLista1Renomeada);
  ok('Stocks: eliminar lista remove-a também do servidor', !listaAindaNoServidor);

  await ctx.close();
}
