/**
 * Testes e2e do Catálogo de Produtos (modulos/catalogo-produtos.html) —
 * pesquisar/filtrar, adicionar manualmente, editar, remover, restaurar e
 * importar via DMF (texto colado). src/produtosCatalogo.js já tem ~13 testes
 * de unidade (tests/produtosCatalogo.test.js) para a lógica pura de
 * overlay/catálogo efetivo — os testes aqui exercitam o fluxo REAL via UI
 * (Playwright): clicar, preencher, guardar, e confirmar o efeito tanto no
 * DOM como persistido no servidor (GET /api/asset/catalogoProdutos).
 *
 * Cada bloco usa a sua própria farmácia de teste (signupFarmacia), para nunca
 * colidir com outros ficheiros de tests/e2e/modules/ a correr em paralelo.
 *
 * NOTA sobre um bug real encontrado e corrigido durante a escrita destes
 * testes (ver comentário em src/produtosCatalogo.js): adicionar/editar/
 * remover/restaurar produtos fazia sempre "ler o overlay do servidor ->
 * alterar em memória -> gravar tudo de volta" sem qualquer serialização —
 * duas operações em sucessão rápida podiam perder uma alteração (mesmo
 * padrão de "lost update" já corrigido em PIM/Gabinete com gravarQueue). O
 * teste "concorrência" abaixo dispara duas adições quase em simultâneo e
 * confirma que AMBAS sobrevivem — falhava antes da correção.
 *
 * Também foi encontrado que `restaurarProduto` (src/produtosCatalogo.js)
 * estava importado em modulos/catalogo-produtos.html mas nunca usado — não
 * havia forma nenhuma, na UI, de ver ou repor um produto do catálogo base que
 * a farmácia tivesse removido. Foi acrescentado o filtro "Removidos por mim"
 * com um botão "Restaurar" por linha — os testes 7/8 abaixo cobrem-no.
 */
import { ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports } from '../helpers.mjs';

const BASE = 'http://localhost:8888';

// Produto fixo do catálogo base (assets/catalogo-base.json) usado como alvo
// determinístico de pesquisa/edição/remoção/restauro nos testes abaixo.
const PROD_BASE_NOME = 'Paracetamol Accel MG, 500 mg x 20 comp';
const PROD_BASE_CODIGO = '2222297';

async function abrirCatalogo(browser, prefixo) {
  const { token, perfil, tenantId } = await signupFarmacia(prefixo);
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  page.on('dialog', d => { try { d.accept(); } catch (e) {} });
  await page.goto(`${BASE}/modulos/catalogo-produtos.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(700); // catálogo base tem ~29 mil produtos — dá tempo ao 1º fetch/parse
  return { ctx, page, token, perfil, tenantId };
}

async function overlayServidor(token) {
  const res = await apiFetch('/api/asset/catalogoProdutos', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { adicionados: [], removidosCodigos: [], editados: {} };
  const body = JSON.parse(res.body);
  return body.content ? JSON.parse(body.content) : { adicionados: [], removidosCodigos: [], editados: {} };
}

async function usoDoDia(token, modulo, tarefaId) {
  const hoje = new Date();
  const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
  const res = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return {};
  const body = JSON.parse(res.body);
  const parsed = body.content ? JSON.parse(body.content) : { dias: {} };
  return (parsed.dias && parsed.dias[diaChave]) || {};
}

export async function run(browser) {
  /* ============================================================
   * 1. CARREGAMENTO INICIAL — estatísticas e limite de resultados
   * ============================================================ */
  {
    const { ctx, page } = await abrirCatalogo(browser, 'CatInicial');
    const statTotal = (await page.locator('#statTotal').textContent()).trim();
    const totalNum = parseInt(statTotal.replace(/\D/g, ''), 10);
    ok('Catálogo: estatística "produtos no catálogo" reflete o catálogo base carregado (~29 mil)', totalNum > 29000 && totalNum < 30000, `statTotal=${statTotal}`);

    const statOverlay = (await page.locator('#statOverlay').textContent()).trim();
    ok('Catálogo: farmácia nova começa sem personalizações ("0" no contador de overlay)', statOverlay === '0', `statOverlay=${statOverlay}`);

    const linhas = await page.locator('#resultsBody tr').count();
    const infoTexto = await page.locator('#resultsInfo').textContent();
    ok('Catálogo: sem pesquisa, a tabela mostra o limite de 200 linhas (nunca as ~29 mil de uma vez)', linhas === 200, `linhas=${linhas} info="${infoTexto}"`);

    await ctx.close();
  }

  /* ============================================================
   * 2. PESQUISAR — por nome e por código
   * ============================================================ */
  {
    const { ctx, page } = await abrirCatalogo(browser, 'CatPesquisa');
    await page.fill('#searchInput', 'Paracetamol Accel');
    await page.waitForTimeout(350); // debounce de 150ms da pesquisa
    const linhasNome = await page.locator(`#resultsBody tr:has-text("${PROD_BASE_CODIGO}")`).count();
    ok('Catálogo pesquisar: procurar por nome encontra o produto certo (com o seu código)', linhasNome === 1, `linhas=${linhasNome}`);

    await page.fill('#searchInput', PROD_BASE_CODIGO);
    await page.waitForTimeout(350);
    const linhasCodigo = await page.locator(`#resultsBody tr:has-text("${PROD_BASE_CODIGO}")`).count();
    ok('Catálogo pesquisar: procurar pelo código funciona tal como pelo nome', linhasCodigo === 1, `linhas=${linhasCodigo}`);

    await page.fill('#searchInput', 'xxxxxxxxxproduto-que-nao-existe-nunca');
    await page.waitForTimeout(350);
    const vazio = await page.locator('#resultsBody .empty').count();
    ok('Catálogo pesquisar: um termo sem correspondência mostra "Nenhum produto encontrado."', vazio === 1);

    await ctx.close();
  }

  /* ============================================================
   * 3. FILTRO "ORIGEM" — vazio até adicionar, depois aparece
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatOrigem');
    await page.selectOption('#searchOrigem', 'adicionado');
    await page.waitForTimeout(200);
    let vazio = await page.locator('#resultsBody .empty').count();
    ok('Catálogo filtro "Adicionados por mim": farmácia nova mostra vazio (nenhum produto próprio ainda)', vazio === 1);

    await page.selectOption('#searchOrigem', '');
    await page.click('button[data-tab="manual"]');
    await page.fill('#manualNome', 'Xarope Próprio Farmácia QA');
    await page.fill('#manualCodigo', 'CUSTOM-ORIGEM-1');
    await page.click('#btnManualGuardar');
    await page.waitForTimeout(500);

    await page.click('button[data-tab="pesquisar"]');
    await page.selectOption('#searchOrigem', 'adicionado');
    await page.waitForTimeout(200);
    const linhaAdicionado = await page.locator('#resultsBody tr:has-text("Xarope Próprio Farmácia QA")').count();
    ok('Catálogo filtro "Adicionados por mim": depois de adicionar um produto, ele passa a aparecer aqui', linhaAdicionado === 1);
    const tagMeu = await page.locator('#resultsBody tr:has-text("Xarope Próprio Farmácia QA") .tag-add').count();
    ok('Catálogo filtro "Adicionados por mim": a etiqueta mostrada é "Meu" (tag-add)', tagMeu === 1);

    const overlay = await overlayServidor(token);
    ok('Catálogo: produto adicionado fica persistido no overlay do servidor', overlay.adicionados.some(p => p[1] === 'CUSTOM-ORIGEM-1'));

    await ctx.close();
  }

  /* ============================================================
   * 4. ADICIONAR MANUALMENTE — sem código, sem nome, e com sucesso
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatAdicionar');
    const statTotalAntes = parseInt((await page.locator('#statTotal').textContent()).replace(/\D/g, ''), 10);

    await page.click('button[data-tab="manual"]');
    await page.click('#btnManualGuardar'); // sem nome preenchido
    await page.waitForTimeout(300);
    const toastErro = await page.locator('#toast.show.err').count();
    ok('Catálogo adicionar: guardar sem designação é bloqueado (toast de erro, nada é adicionado)', toastErro === 1);

    await page.fill('#manualNome', 'Produto Sem Código QA');
    await page.click('#btnManualGuardar'); // sem código -> gera "custom_..." automaticamente
    await page.waitForTimeout(500);
    const statTotalDepois = parseInt((await page.locator('#statTotal').textContent()).replace(/\D/g, ''), 10);
    ok('Catálogo adicionar: produto sem código gera código automático e o total do catálogo sobe em 1', statTotalDepois === statTotalAntes + 1, `antes=${statTotalAntes} depois=${statTotalDepois}`);

    const overlay = await overlayServidor(token);
    const custom = overlay.adicionados.find(p => p[0] === 'Produto Sem Código QA');
    ok('Catálogo adicionar: o código gerado automaticamente começa por "custom_"', !!custom && String(custom[1]).startsWith('custom_'));

    await ctx.close();
  }

  /* ============================================================
   * 5. EDITAR — produto próprio, via UI completa
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatEditar');
    await page.click('button[data-tab="manual"]');
    await page.fill('#manualNome', 'Produto A Editar QA');
    await page.fill('#manualCodigo', 'CUSTOM-EDITAR-1');
    await page.click('#btnManualGuardar');
    await page.waitForTimeout(500);

    await page.click('button[data-tab="pesquisar"]');
    await page.fill('#searchInput', 'CUSTOM-EDITAR-1');
    await page.waitForTimeout(300);
    await page.click('#resultsBody [data-editar]');
    await page.waitForTimeout(200);

    const tituloEmEdicao = (await page.locator('#manualTitulo').textContent()).trim();
    const nomePreenchido = await page.locator('#manualNome').inputValue();
    ok('Catálogo editar: clicar em "Editar" muda para o separador "manual" com o formulário pré-preenchido', tituloEmEdicao === 'Editar produto' && nomePreenchido === 'Produto A Editar QA');

    await page.fill('#manualNome', 'Produto Editado QA (novo nome)');
    await page.click('#btnManualGuardar');
    await page.waitForTimeout(500);

    await page.click('button[data-tab="pesquisar"]');
    await page.fill('#searchInput', 'CUSTOM-EDITAR-1');
    await page.waitForTimeout(300);
    const nomeAntigoSumiu = await page.locator('#resultsBody tr:has-text("Produto A Editar QA")').count();
    const nomeNovoApareceu = await page.locator('#resultsBody tr:has-text("Produto Editado QA (novo nome)")').count();
    ok('Catálogo editar: depois de guardar, o nome novo aparece na lista e o antigo desaparece', nomeAntigoSumiu === 0 && nomeNovoApareceu === 1);

    const overlay = await overlayServidor(token);
    ok('Catálogo editar: produto próprio editado é atualizado em "adicionados" (continua um só registo)', overlay.adicionados.filter(p => p[1] === 'CUSTOM-EDITAR-1').length === 1 &&
      overlay.adicionados.find(p => p[1] === 'CUSTOM-EDITAR-1')[0] === 'Produto Editado QA (novo nome)');

    await ctx.close();
  }

  /* ============================================================
   * 6. REMOVER um produto do CATÁLOGO BASE — desaparece da pesquisa normal
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatRemover');
    await page.fill('#searchInput', PROD_BASE_CODIGO);
    await page.waitForTimeout(300);
    await page.click(`#resultsBody tr:has-text("${PROD_BASE_CODIGO}") [data-remover]`);
    await page.waitForTimeout(500);

    const aindaAparece = await page.locator(`#resultsBody tr:has-text("${PROD_BASE_CODIGO}")`).count();
    ok('Catálogo remover: produto do catálogo base desaparece da pesquisa normal depois de removido', aindaAparece === 0);

    const overlay = await overlayServidor(token);
    ok('Catálogo remover: código do produto do catálogo base fica registado em removidosCodigos (o catálogo base nunca é tocado)', overlay.removidosCodigos.includes(PROD_BASE_CODIGO));

    await ctx.close();
  }

  /* ============================================================
   * 7/8. RESTAURAR — bug corrigido: agora há UI para ver e repor removidos
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatRestaurar');

    // remove primeiro, via UI normal
    await page.fill('#searchInput', PROD_BASE_CODIGO);
    await page.waitForTimeout(300);
    await page.click(`#resultsBody tr:has-text("${PROD_BASE_CODIGO}") [data-remover]`);
    await page.waitForTimeout(500);

    // filtro "Removidos por mim"
    await page.fill('#searchInput', '');
    await page.selectOption('#searchOrigem', 'removido');
    await page.waitForTimeout(300);
    const apareceRemovido = await page.locator(`#resultsBody tr:has-text("${PROD_BASE_NOME}")`).count();
    const temBotaoRestaurar = await page.locator('#resultsBody [data-restaurar]').count();
    ok('Catálogo restaurar: o filtro "Removidos por mim" mostra o produto removido, com botão "Restaurar"', apareceRemovido === 1 && temBotaoRestaurar >= 1);

    const statTotalRemovido = parseInt((await page.locator('#statTotal').textContent()).replace(/\D/g, ''), 10);

    await page.click(`#resultsBody tr:has-text("${PROD_BASE_NOME}") [data-restaurar]`);
    await page.waitForTimeout(500);

    const statTotalRestaurado = parseInt((await page.locator('#statTotal').textContent()).replace(/\D/g, ''), 10);
    ok('Catálogo restaurar: clicar "Restaurar" repõe o produto — o total do catálogo volta a subir em 1', statTotalRestaurado === statTotalRemovido + 1, `removido=${statTotalRemovido} restaurado=${statTotalRestaurado}`);

    await page.selectOption('#searchOrigem', '');
    await page.fill('#searchInput', PROD_BASE_CODIGO);
    await page.waitForTimeout(300);
    const voltouAparecerNaBusca = await page.locator(`#resultsBody tr:has-text("${PROD_BASE_CODIGO}")`).count();
    ok('Catálogo restaurar: o produto restaurado volta a aparecer na pesquisa normal', voltouAparecerNaBusca === 1);

    const overlay = await overlayServidor(token);
    ok('Catálogo restaurar: código já não consta em removidosCodigos no servidor', !overlay.removidosCodigos.includes(PROD_BASE_CODIGO));

    // window.ModuleChrome.registarUso só faz flush para o servidor 2s depois
    // do último registo (debounce) — a página tem de continuar aberta até lá.
    await page.waitForTimeout(2200);
    const uso = await usoDoDia(token, 'catalogo-produtos', 'restaurar_produto');
    ok('Catálogo restaurar: a ação fica registada em window.ModuleChrome.registarUso (Poupança & ROI)', (uso['catalogo-produtos.restaurar_produto'] || 0) >= 1, JSON.stringify(uso));

    await ctx.close();
  }

  /* ============================================================
   * 9. REMOVER um produto PRÓPRIO — desaparece por completo (não fica "removido")
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatRemoverProprio');
    await page.click('button[data-tab="manual"]');
    await page.fill('#manualNome', 'Produto Próprio A Remover QA');
    await page.fill('#manualCodigo', 'CUSTOM-REM-PROPRIO');
    await page.click('#btnManualGuardar');
    await page.waitForTimeout(500);

    await page.click('button[data-tab="pesquisar"]');
    await page.fill('#searchInput', 'CUSTOM-REM-PROPRIO');
    await page.waitForTimeout(300);
    await page.click('#resultsBody [data-remover]');
    await page.waitForTimeout(500);

    const overlay = await overlayServidor(token);
    ok('Catálogo remover produto próprio: desaparece de "adicionados" e NÃO fica marcado em "removidosCodigos" (nada a restaurar)',
      !overlay.adicionados.some(p => p[1] === 'CUSTOM-REM-PROPRIO') && !overlay.removidosCodigos.includes('CUSTOM-REM-PROPRIO'));

    await ctx.close();
  }

  /* ============================================================
   * 10. CONCORRÊNCIA — duas gravações do overlay ao mesmo tempo não se pisam
   *     (bug real encontrado e corrigido em src/produtosCatalogo.js: ver
   *     comentário no topo deste ficheiro e no próprio produtosCatalogo.js).
   *
   *     Testado chamando diretamente as funções exportadas do módulo (via
   *     import dinâmico dentro da página) com Promise.all — dispara as duas
   *     operações verdadeiramente ao mesmo tempo, sem depender do timing de
   *     dois cliques na UI (que na prática corre depressa demais para forçar
   *     a sobreposição de forma fiável: o "duplo clique" chega a ter um
   *     efeito colateral próprio — ver nota abaixo). Isto reproduz de forma
   *     determinística exatamente a mesma corrida que dois separadores da
   *     mesma farmácia (ou um duplo clique em "Guardar") podem provocar.
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatConcorrenciaAdd');

    const overlayDepoisDeAdicionar = await page.evaluate(async () => {
      const mod = await import('/src/produtosCatalogo.js');
      const dbMod = await import('/src/db.js');
      const ds = dbMod.makeDataStore();
      const catalogoAntes = await mod.carregarCatalogoEfetivo(ds);
      await Promise.all([
        mod.adicionarProdutos(ds, [['Produto Concorrente A', 'CONC-A', 4]], catalogoAntes),
        mod.adicionarProdutos(ds, [['Produto Concorrente B', 'CONC-B', 4]], catalogoAntes)
      ]);
      return mod.carregarOverlay(ds);
    });
    const codigosGravados = (overlayDepoisDeAdicionar?.adicionados || []).map(p => p[1]);
    ok('Catálogo concorrência (adicionar): duas gravações do overlay em paralelo ficam AMBAS persistidas (nenhuma "lost update")',
      codigosGravados.includes('CONC-A') && codigosGravados.includes('CONC-B'), `adicionados=${JSON.stringify(codigosGravados)}`);

    // confirma também do lado do servidor com um GET independente, e do lado da UI depois de recarregar
    const overlayServidorFinal = await overlayServidor(token);
    ok('Catálogo concorrência (adicionar): confirmado também por um GET independente ao servidor', overlayServidorFinal.adicionados.some(p => p[1] === 'CONC-A') && overlayServidorFinal.adicionados.some(p => p[1] === 'CONC-B'));

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.fill('#searchInput', 'Concorrente');
    await page.waitForTimeout(300);
    const linhasNaUI = await page.locator('#resultsBody tr:has-text("Concorrente")').count();
    ok('Catálogo concorrência (adicionar): depois de um reload, AMBOS os produtos concorrentes aparecem na pesquisa', linhasNaUI === 2, `linhas=${linhasNaUI}`);

    await ctx.close();
  }

  /* Mesma corrida, mas do lado de REMOVER dois produtos já existentes ao
   * mesmo tempo (o caso real mais provável: dois separadores/utilizadores da
   * mesma farmácia a arrumar o catálogo ao mesmo tempo). */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatConcorrenciaRemover');
    await page.click('button[data-tab="manual"]');
    await page.fill('#manualNome', 'Produto Race X');
    await page.fill('#manualCodigo', 'RACE-X');
    await page.click('#btnManualGuardar');
    await page.waitForTimeout(500);
    await page.fill('#manualNome', 'Produto Race Y');
    await page.fill('#manualCodigo', 'RACE-Y');
    await page.click('#btnManualGuardar');
    await page.waitForTimeout(500);

    await page.evaluate(async () => {
      const mod = await import('/src/produtosCatalogo.js');
      const dbMod = await import('/src/db.js');
      const ds = dbMod.makeDataStore();
      await Promise.all([mod.removerProduto(ds, 'RACE-X'), mod.removerProduto(ds, 'RACE-Y')]);
    });

    const overlayFinal = await overlayServidor(token);
    const nenhumSobrevive = !overlayFinal.adicionados.some(p => p[1] === 'RACE-X') && !overlayFinal.adicionados.some(p => p[1] === 'RACE-Y');
    ok('Catálogo concorrência (remover): duas remoções em paralelo ficam AMBAS aplicadas (nenhuma reaparece por cima da outra)', nenhumSobrevive, JSON.stringify(overlayFinal.adicionados.map(p => p[1])));

    await ctx.close();
  }

  /* ============================================================
   * 11. IMPORTAR — DMF (texto colado), motor genérico de importação
   * ============================================================ */
  {
    const { ctx, page, token } = await abrirCatalogo(browser, 'CatImportarDmf');
    await page.click('button[data-tab="dmf"]');
    const textoDmf = [
      'Designação\tCódigo\tFamília',
      'Produto DMF Um QA\tDMF-001\tDispositivo Médico (DM)',
      'Produto DMF Dois QA\tDMF-002\tHomeopatia'
    ].join('\n');
    await page.fill('#dmfPaste', textoDmf);
    await page.click('#btnDmfProcessarTexto');
    await page.waitForTimeout(300);

    const nomeColunaDesignacao = await page.locator('#mapNome option:checked').textContent();
    const nomeColunaCodigo = await page.locator('#mapCodigo option:checked').textContent();
    ok('Catálogo importar DMF: a pré-visualização adivinha corretamente as colunas "Designação" e "Código" pelo cabeçalho',
      nomeColunaDesignacao.trim() === 'Designação' && nomeColunaCodigo.trim() === 'Código');

    const linhasPreview = await page.locator('#dmfPreviewArea table tbody tr').count();
    ok('Catálogo importar DMF: a pré-visualização mostra as 2 linhas de dados coladas (sem contar o cabeçalho)', linhasPreview === 2);

    await page.click('#btnConfirmarImportacao');
    await page.waitForTimeout(600);

    const overlay = await overlayServidor(token);
    ok('Catálogo importar DMF: os 2 produtos ficam persistidos no overlay com o código correto',
      overlay.adicionados.some(p => p[1] === 'DMF-001' && p[0] === 'Produto DMF Um QA') &&
      overlay.adicionados.some(p => p[1] === 'DMF-002' && p[0] === 'Produto DMF Dois QA'));

    await page.waitForTimeout(2200); // debounce de 2s do flush de uso (ver nota acima)
    const uso = await usoDoDia(token, 'catalogo-produtos', 'importar_produtos');
    ok('Catálogo importar DMF: window.ModuleChrome.registarUso regista a importação em lote (qtd=2)', uso['catalogo-produtos.importar_produtos'] === 2, JSON.stringify(uso));

    await ctx.close();
  }
}
