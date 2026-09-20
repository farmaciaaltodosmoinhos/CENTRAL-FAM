/**
 * Testes e2e do painel "Poupança & ROI" (Configurações → separador
 * "Poupança & ROI", src/ui/poupanca.js + index.html). O ficheiro
 * tests/e2e/modules/00-core.mjs já cobre o essencial de
 * registarUso/debounce/robustez a um flush falhado e o carregamento básico
 * do dashboard — os testes aqui vão mais fundo, sem repetir esses:
 *
 *   - os cartões de resumo (Hoje/7 dias/Mês/Ano/Sempre) mostram valores
 *     COERENTES com o uso realmente registado via
 *     window.ModuleChrome.registarUso(...) (cálculo verificado à mão,
 *     usando as estimativas reais de src/usoCatalogo.js);
 *   - o valor/hora configurado reflete-se corretamente no € poupado;
 *   - editar um override de estimativa (tempo manual/tempo Central) na
 *     tabela de tarefas persiste (sobrevive a reload) e passa a refletir-se
 *     no cálculo agregado, sem reload, e depois de reload;
 *   - os chips de período/vista dos 3 gráficos mudam a classe .active no
 *     chip certo (e só nesse), de forma independente entre grupos, sem
 *     rebentar a tabela;
 *   - o período personalizado (datas) mostra/esconde o resumo consoante as
 *     datas sejam válidas, com valores coerentes;
 *   - duas edições de overrides em sucessão rápida (sem esperar a 1ª
 *     terminar) sobrevivem AMBAS — mesmo padrão de "gravação concorrente" a
 *     vigiar nesta expansão (ver tests/e2e/modules/08-catalogo-produtos.mjs
 *     para o caso em que esse padrão SE revelou um bug real).
 *
 * Cada farmácia de teste é criada com signupFarmacia() (nunca reaproveita as
 * de 00-core.mjs), para nunca colidir com outros ficheiros a correr em
 * paralelo. O desenho do próprio gráfico Chart.js (canvas) não é testado —
 * só os dados/estado subjacentes, que são o que pode genuinamente rebentar.
 */
import { ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports } from '../helpers.mjs';

const BASE = 'http://localhost:8888';

async function registarUsoReal(browser, token, perfil, chamadas) {
  // Abre um módulo qualquer (aqui "pim") só para ter acesso a
  // window.ModuleChrome.registarUso, exatamente como um módulo real faria.
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(400);
  await page.evaluate((lista) => {
    lista.forEach(([modulo, tarefaId, qtd]) => window.ModuleChrome.registarUso(modulo, tarefaId, qtd));
  }, chamadas);
  await page.waitForTimeout(2600); // debounce de 2s do flush + margem
  await ctx.close();
}

async function abrirPoupanca(browser, token, perfil) {
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click('#btnAbrirConfig');
  await page.waitForTimeout(200);
  await page.click('#modalConfig .modal-tab[data-tab="poupanca"]');
  await page.waitForTimeout(1200); // 1ª visita à aba: refrescarTudo() automático
  return { ctx, page };
}

function textoCartao(page, label) {
  return page.locator(`.poup-resumo-card:has-text("${label}")`).first();
}

async function configServidor(token) {
  const res = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
  return JSON.parse(res.body).config || {};
}

export async function run(browser) {
  /* ============================================================
   * 1. CARTÕES DE RESUMO — coerência com uso real registado hoje
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupResumo');
    // pim.criar_utente: manual=240s central=40s poupado=200s/ocorrência
    // pim.criar_rotulo: manual=900s central=120s poupado=780s/ocorrência
    // 3x criar_utente + 2x criar_rotulo = 600 + 1560 = 2160s = 36min, 5 tarefas
    await registarUsoReal(browser, token, perfil, [
      ['pim', 'criar_utente', 3],
      ['pim', 'criar_rotulo', 2]
    ]);

    const { ctx, page } = await abrirPoupanca(browser, token, perfil);

    const hojeTexto = await textoCartao(page, 'Hoje').innerText();
    ok('Poupança resumo: cartão "Hoje" mostra o tempo poupado calculado corretamente (36min) a partir do uso real registado',
      hojeTexto.includes('36min'), hojeTexto.replace(/\n/g, ' | '));
    const hojeSub = await textoCartao(page, 'Hoje').locator('.prc-sub').textContent();
    ok('Poupança resumo: cartão "Hoje" mostra o nº de tarefas certo (5)', hojeSub.trim().startsWith('5 tarefas'), hojeSub);

    // farmácia acabada de criar: toda a atividade é de hoje, logo estes
    // períodos maiores têm de mostrar EXATAMENTE o mesmo tempo poupado que "Hoje".
    for (const label of ['Últimos 7 dias', 'Este mês', 'Este ano', 'Desde que usa a Central']) {
      const texto = await textoCartao(page, label).innerText();
      ok(`Poupança resumo: cartão "${label}" é coerente com "Hoje" (farmácia nova, única atividade é hoje) — mostra 36min também`,
        texto.includes('36min'), texto.replace(/\n/g, ' | '));
    }

    const inicioTexto = await textoCartao(page, 'Desde que usa a Central').locator('.prc-sub').textContent();
    const hojeIso = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    ok('Poupança resumo: "a usar desde" mostra a data de hoje (1º dia de uso desta farmácia nova)', inicioTexto.includes(hojeIso), inicioTexto);

    await ctx.close();
  }

  /* ============================================================
   * 1.5 CHART.JS — fallback de CDN funciona mesmo (regressão real: a
   * versão fixa do Chart.js no cdnjs deixou de existir a meio da sessão
   * anterior — a API do cdnjs respondia "Version not found" — e isso
   * rebentava o painel inteiro com "sem ligação ao CDN" apesar de a rede
   * estar perfeita; ver src/ui/poupanca.js). Este ambiente de teste não tem
   * acesso à internet real (cdnjs/jsdelivr não são alcançáveis a partir
   * daqui), por isso o que se testa aqui não é "o cdnjs está no ar" — é o
   * mecanismo em si: `ensureScript` tenta cada URL da lista por ordem e
   * segue para a seguinte se uma falhar, em vez de desistir logo na
   * primeira. Simula-se isso bloqueando a 1ª URL (cdnjs) e servindo um
   * script válido só na 2ª (jsdelivr), sem depender de nenhum CDN real.
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupCdnFallback');
    await registarUsoReal(browser, token, perfil, [['pim', 'criar_utente', 1]]);
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);

    await page.route('**/cdnjs.cloudflare.com/ajax/libs/Chart.js/**', route => route.abort('failed'));
    await page.route('**/cdn.jsdelivr.net/npm/chart.js@**', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart = { __stub: true };' }));

    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click('#btnAbrirConfig');
    await page.waitForTimeout(200);
    await page.click('#modalConfig .modal-tab[data-tab="poupanca"]');

    const chartCarregouViaFallback = await page.waitForFunction(() => !!window.Chart, { timeout: 6000 }).then(() => true).catch(() => false);
    ok('Poupança CDN: com a 1ª fonte (cdnjs) bloqueada, o Chart.js carrega na mesma pela 2ª fonte (jsdelivr)', chartCarregouViaFallback);

    const toastCdnTexto = await page.locator('#toastStack').innerText().catch(() => '');
    ok('Poupança CDN: com o fallback a funcionar, não aparece nenhum toast de "sem ligação ao CDN"', !/sem ligação ao CDN/.test(toastCdnTexto), toastCdnTexto);

    await ctx.close();
  }

  /* ============================================================
   * 1.6 CHART.JS — com AMBAS as fontes bloqueadas, o painel não rebenta:
   * mostra o toast de aviso e os cartões/tabela (que não dependem do
   * Chart.js) continuam normais.
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupCdnFalha');
    await registarUsoReal(browser, token, perfil, [['pim', 'criar_utente', 1]]);
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));

    await page.route('**/cdnjs.cloudflare.com/ajax/libs/Chart.js/**', route => route.abort('failed'));
    await page.route('**/cdn.jsdelivr.net/npm/chart.js@**', route => route.abort('failed'));

    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click('#btnAbrirConfig');
    await page.waitForTimeout(200);
    await page.click('#modalConfig .modal-tab[data-tab="poupanca"]');
    await page.waitForTimeout(1500);

    const toastFalhaTexto = await page.locator('#toastStack').innerText().catch(() => '');
    ok('Poupança CDN: com as 2 fontes bloqueadas, aparece o toast a avisar (em vez de rebentar em silêncio)', /sem ligação ao CDN/.test(toastFalhaTexto), toastFalhaTexto);

    const hojeAindaVisivel = await textoCartao(page, 'Hoje').innerText().catch(() => '');
    ok('Poupança CDN: mesmo sem o Chart.js, o cartão "Hoje" continua a mostrar o resumo correto', hojeAindaVisivel.includes('min') || hojeAindaVisivel.includes('h'), hojeAindaVisivel);
    ok('Poupança CDN: nenhum erro de página (JS) por causa da falha do CDN', erros.length === 0, erros.join(' | '));

    await ctx.close();
  }

  /* ============================================================
   * 2. VALOR/HORA — reflete-se corretamente no € poupado
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupValorHora');
    // pim.criar_evento: manual=60s central=20s poupado=40s; 9x -> 360s = 0.1h
    await registarUsoReal(browser, token, perfil, [['pim', 'criar_evento', 9]]);
    const { ctx, page } = await abrirPoupanca(browser, token, perfil);

    await page.fill('#poupValorHoraInput', '20');
    await page.locator('#poupValorHoraInput').dispatchEvent('change');
    await page.waitForTimeout(400);

    // 0.1h * 20€/h = 2,00€
    const hojeTexto = await textoCartao(page, 'Hoje').innerText();
    ok('Poupança valor/hora: definir 20€/hora com 0.1h poupada hoje mostra 2,00 € no cartão "Hoje"', /2,00\s*€/.test(hojeTexto), hojeTexto.replace(/\n/g, ' | '));

    const configPersistido = await configServidor(token);
    ok('Poupança valor/hora: fica persistido em config.valorHoraPoupanca no servidor', configPersistido.valorHoraPoupanca === 20, JSON.stringify(configPersistido.valorHoraPoupanca));

    await ctx.close();
  }

  /* ============================================================
   * 3. TABELA DE TAREFAS — override de estimativa persiste e recalcula
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupOverride');
    // pim.criar_utente: manual=240 central=40 -> 3x = poupado 600s = 10min (antes do override)
    await registarUsoReal(browser, token, perfil, [['pim', 'criar_utente', 3]]);
    const { ctx, page } = await abrirPoupanca(browser, token, perfil);

    const linha = page.locator('tr[data-chave="pim.criar_utente"]');
    const ocorrenciasNaTabela = await linha.locator('.pt-num').textContent();
    ok('Poupança tabela: linha "pim.criar_utente" mostra o nº de ocorrências certo (3)', ocorrenciasNaTabela.trim() === '3');

    const valorManualAntes = await linha.locator('input[data-campo="tempoManualSeg"]').inputValue();
    ok('Poupança tabela: antes de qualquer override, o campo "tempo manual" mostra a estimativa do catálogo (240s)', valorManualAntes === '240');

    // Aumenta o tempo manual estimado de 240s para 500s -> poupado passa a (500-40)*3=1380s=23min
    await linha.locator('input[data-campo="tempoManualSeg"]').fill('500');
    await linha.locator('input[data-campo="tempoManualSeg"]').dispatchEvent('change');
    await linha.locator('.pt-poupado').filter({ hasText: '23min' }).waitFor({ timeout: 5000 });

    const poupadoNaLinha = await linha.locator('.pt-poupado').textContent();
    ok('Poupança tabela: depois do override, o "tempo poupado" da própria linha recalcula sem reload (23min)', poupadoNaLinha.includes('23min'), poupadoNaLinha);

    const hojeTexto = await textoCartao(page, 'Hoje').innerText();
    ok('Poupança tabela: o cartão de resumo "Hoje" também recalcula de imediato com o novo override (23min)', hojeTexto.includes('23min'), hojeTexto.replace(/\n/g, ' | '));

    const configAntesReload = await configServidor(token);
    ok('Poupança tabela: o override fica persistido em config.usoEstimativas no servidor', configAntesReload.usoEstimativas?.['pim.criar_utente']?.tempoManualSeg === 500, JSON.stringify(configAntesReload.usoEstimativas));

    // PERSISTÊNCIA APÓS RELOAD
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.click('#btnAbrirConfig');
    await page.waitForTimeout(200);
    await page.click('#modalConfig .modal-tab[data-tab="poupanca"]');
    await page.waitForTimeout(1200);

    const valorManualDepoisReload = await page.locator('tr[data-chave="pim.criar_utente"] input[data-campo="tempoManualSeg"]').inputValue();
    ok('Poupança tabela: o override do "tempo manual" continua lá depois de um reload completo da página (500)', valorManualDepoisReload === '500');
    const hojeTextoReload = await textoCartao(page, 'Hoje').innerText();
    ok('Poupança tabela: o cálculo agregado depois do reload continua a refletir o override (23min)', hojeTextoReload.includes('23min'), hojeTextoReload.replace(/\n/g, ' | '));

    // Editar também o "tempo Central": 500-100=400s*3=1200s=20min
    const linha2 = page.locator('tr[data-chave="pim.criar_utente"]');
    await linha2.locator('input[data-campo="tempoCentralSeg"]').fill('100');
    await linha2.locator('input[data-campo="tempoCentralSeg"]').dispatchEvent('change');
    await linha2.locator('.pt-poupado').filter({ hasText: '20min' }).waitFor({ timeout: 5000 });
    const poupadoComOsDoisOverrides = await linha2.locator('.pt-poupado').textContent();
    ok('Poupança tabela: editar também o "tempo Central" recalcula corretamente com os dois overrides juntos (20min)', poupadoComOsDoisOverrides.includes('20min'), poupadoComOsDoisOverrides);

    await ctx.close();
  }

  /* ============================================================
   * 4. CHIPS — período/vista dos gráficos: .active no chip certo, isolados
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupChips');
    await registarUsoReal(browser, token, perfil, [['pim', 'criar_utente', 1]]);
    const { ctx, page } = await abrirPoupanca(browser, token, perfil);
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });

    // grupo "período dos gráficos": por omissão "30 dias" está ativo
    ok('Poupança chips: por omissão, o chip "30 dias" está ativo no grupo de período', await page.locator('#poupChartsPeriodo .poup-chip[data-periodo="30"]').evaluate(el => el.classList.contains('active')));

    await page.click('#poupChartsPeriodo .poup-chip[data-periodo="90"]');
    await page.waitForTimeout(300);
    const ativos90 = await page.locator('#poupChartsPeriodo .poup-chip.active').count();
    const chip90Ativo = await page.locator('#poupChartsPeriodo .poup-chip[data-periodo="90"]').evaluate(el => el.classList.contains('active'));
    const chip30JaNaoAtivo = await page.locator('#poupChartsPeriodo .poup-chip[data-periodo="30"]').evaluate(el => el.classList.contains('active'));
    ok('Poupança chips: clicar "90 dias" ativa SÓ esse chip do grupo (o anterior "30 dias" perde o active)',
      ativos90 === 1 && chip90Ativo && !chip30JaNaoAtivo);

    // grupo de granularidade da tendência é independente do grupo de período
    await page.click('#poupChartTendGranularidade .poup-chip[data-gran="semana"]');
    await page.waitForTimeout(300);
    const granSemanaAtiva = await page.locator('#poupChartTendGranularidade .poup-chip[data-gran="semana"]').evaluate(el => el.classList.contains('active'));
    const periodo90AindaAtivo = await page.locator('#poupChartsPeriodo .poup-chip[data-periodo="90"]').evaluate(el => el.classList.contains('active'));
    ok('Poupança chips: mudar a granularidade da tendência não mexe no chip de período (grupos independentes)', granSemanaAtiva && periodo90AindaAtivo);

    // grupos de métrica de módulos e de tarefas também são independentes entre si
    await page.click('#poupChartModulosMetrica .poup-chip[data-metrica="ocorrencias"]');
    await page.waitForTimeout(300);
    const modulosMetricaOcorrencias = await page.locator('#poupChartModulosMetrica .poup-chip[data-metrica="ocorrencias"]').evaluate(el => el.classList.contains('active'));
    const tarefasMetricaContinuaOcorrencias = await page.locator('#poupChartTarefasMetrica .poup-chip[data-metrica="ocorrencias"]').evaluate(el => el.classList.contains('active'));
    ok('Poupança chips: mudar a métrica do gráfico "por módulo" não afeta o chip de métrica do gráfico "por tarefa"',
      modulosMetricaOcorrencias && tarefasMetricaContinuaOcorrencias);

    const linhasTabelaDepoisDosChips = await page.locator('#poupTabelaTarefasBody tr').count();
    ok('Poupança chips: depois de trocar vários chips, a tabela de tarefas continua populada (nada rebentou)', linhasTabelaDepoisDosChips >= 30, `linhas=${linhasTabelaDepoisDosChips}`);
    ok('Poupança chips: nenhuma das trocas de chip gerou erro de página/consola', erros.length === 0, erros.join(' | '));

    await ctx.close();
  }

  /* ============================================================
   * 5. PERÍODO PERSONALIZADO — mostra/esconde consoante datas válidas
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupCustom');
    // pim.registar_receita: manual=150 central=30 poupado=120s; 4x = 480s = 8min
    await registarUsoReal(browser, token, perfil, [['pim', 'registar_receita', 4]]);
    const { ctx, page } = await abrirPoupanca(browser, token, perfil);

    const escondidoAntes = await page.locator('#poupCustomResumo').evaluate(el => getComputedStyle(el).display === 'none');
    ok('Poupança período personalizado: começa escondido (nenhuma data escolhida ainda)', escondidoAntes);

    const hoje = new Date().toISOString().slice(0, 10);
    await page.fill('#poupPeriodoInicio', hoje);
    await page.locator('#poupPeriodoInicio').dispatchEvent('change');
    await page.waitForTimeout(200);
    let aindaEscondido = await page.locator('#poupCustomResumo').evaluate(el => getComputedStyle(el).display === 'none');
    ok('Poupança período personalizado: só com a data de início preenchida (sem fim) continua escondido', aindaEscondido);

    await page.fill('#poupPeriodoFim', hoje);
    await page.locator('#poupPeriodoFim').dispatchEvent('change');
    await page.waitForTimeout(300);
    const visivelComAmbasDatas = await page.locator('#poupCustomResumo').evaluate(el => getComputedStyle(el).display !== 'none');
    const textoCustom = await page.locator('#poupCustomResumo').innerText();
    ok('Poupança período personalizado: com início=fim=hoje, mostra o resumo com o tempo poupado coerente (8min)',
      visivelComAmbasDatas && textoCustom.includes('8min'), textoCustom.replace(/\n/g, ' | '));

    // fim < início -> volta a esconder (não mostra um resumo sem sentido)
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await page.fill('#poupPeriodoFim', ontem);
    await page.locator('#poupPeriodoFim').dispatchEvent('change');
    await page.waitForTimeout(300);
    const escondidoComFimAntesDoInicio = await page.locator('#poupCustomResumo').evaluate(el => getComputedStyle(el).display === 'none');
    ok('Poupança período personalizado: se a data de fim for anterior à de início, volta a esconder o resumo (edge case sem rebentar)', escondidoComFimAntesDoInicio);

    await ctx.close();
  }

  /* ============================================================
   * 6. CONCORRÊNCIA — dois overrides editados quase ao mesmo tempo
   *    (mesmo padrão de bug a vigiar nesta expansão — ver 08-catalogo-produtos.mjs)
   * ============================================================ */
  {
    const { token, perfil } = await signupFarmacia('PoupConcorrencia');
    await registarUsoReal(browser, token, perfil, [['pim', 'criar_utente', 1], ['pim', 'criar_rotulo', 1]]);
    const { ctx, page } = await abrirPoupanca(browser, token, perfil);

    // dispara as duas edições (linhas DIFERENTES) sem esperar a 1ª terminar
    const linhaA = page.locator('tr[data-chave="pim.criar_utente"] input[data-campo="tempoManualSeg"]');
    const linhaB = page.locator('tr[data-chave="pim.criar_rotulo"] input[data-campo="tempoManualSeg"]');
    await linhaA.fill('999');
    await linhaB.fill('888');
    await Promise.all([linhaA.dispatchEvent('change'), linhaB.dispatchEvent('change')]);
    await page.waitForTimeout(600);

    const configFinal = await configServidor(token);
    const overridesFinal = configFinal.usoEstimativas || {};
    ok('Poupança concorrência: duas edições de overrides em linhas diferentes, quase simultâneas, ficam AMBAS persistidas',
      overridesFinal['pim.criar_utente']?.tempoManualSeg === 999 && overridesFinal['pim.criar_rotulo']?.tempoManualSeg === 888,
      JSON.stringify(overridesFinal));

    await ctx.close();
  }
}
