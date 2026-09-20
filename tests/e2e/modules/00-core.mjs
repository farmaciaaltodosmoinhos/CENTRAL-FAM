/**
 * Núcleo histórico da bateria e2e (conteúdo original de battery.mjs, movido
 * para cá quando a bateria foi reestruturada em ficheiros por módulo — ver
 * tests/e2e/battery.mjs para o orquestrador). Cobre:
 *  1. Autenticação real (signup) e obtenção de token.
 *  2. Confirmação do bug de desempenho do logótipo: tamanho do payload de
 *     /api/data com e sem logótipo embutido, antes/depois da correção.
 *  3. Cada um dos 13 módulos, carregado standalone com sessão válida, em 3
 *     larguras (390 telemóvel / 800 tablet / 1440 desktop): zero erros de
 *     consola/página, logótipo pintado corretamente.
 *  4. Fluxo funcional real: criar um utente em PIM e confirmar persistência
 *     (reload + reaparece), e confirmar que o logótipo antigo em config
 *     desaparece do estado do servidor após uma gravação (migração lenta).
 *  5. Retrocompatibilidade: uma conta com logótipo só em config.logo (estilo
 *     antigo) continua a mostrá-lo corretamente.
 *  6. Poupança & ROI: registarUso()/debounce/robustez a flush falhado + dashboard.
 *  7. Leitura de DataMatrix/parseGS1.
 */
import { BASE, ok, apiFetch, fakeLogoBase64, MODULOS, viewports, novaPaginaComSessao, signupFarmacia } from '../helpers.mjs';

export async function run(browser) {
  // ---------- 1. signup de duas farmácias de teste ----------
  const emailNovo = `qa-novo-${Date.now()}@x.pt`;
  const emailAntigo = `qa-antigo-${Date.now()}@x.pt`;
  const signupNovo = JSON.parse((await apiFetch('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeFarmacia: 'Farmácia QA Nova', email: emailNovo, password: 'password123' })
  })).body);
  const signupAntigo = JSON.parse((await apiFetch('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeFarmacia: 'Farmácia QA Antiga', email: emailAntigo, password: 'password123' })
  })).body);
  ok('signup cria conta nova e devolve token', !!signupNovo.token && !!signupAntigo.token);

  const tokenNovo = signupNovo.token, tokenAntigo = signupAntigo.token;
  const logo500kb = fakeLogoBase64(500);

  await apiFetch('/api/asset/branding-logo', { method: 'PUT', headers: { Authorization: `Bearer ${tokenNovo}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: logo500kb }) });
  await apiFetch('/api/data', {
    method: 'PUT', headers: { Authorization: `Bearer ${tokenAntigo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ servicos: [], categorias: [], config: { nomeFarmacia: 'Farmácia QA Antiga', logo: logo500kb } })
  });

  // ---------- 2. medir o payload de /api/data ANTES/DEPOIS da correção ----------
  const dataAntigoRes = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenAntigo}` } });
  const dataAntigoBody = JSON.parse(dataAntigoRes.body);
  ok('farmácia "antiga": GET /api/data ainda inclui o logótipo em config (esperado, antes da 1ª gravação de qualquer módulo)',
    !!dataAntigoBody.config.logo, `tamanho do payload: ${(dataAntigoRes.body.length/1024).toFixed(0)}KB`);

  const dataNovoRes = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenNovo}` } });
  const dataNovoBody = JSON.parse(dataNovoRes.body);
  ok('farmácia "nova": GET /api/data NÃO inclui o logótipo (vive só no asset)',
    !dataNovoBody.config || !dataNovoBody.config.logo, `tamanho do payload: ${(dataNovoRes.body.length/1024).toFixed(0)}KB (contra ~${(dataAntigoRes.body.length/1024).toFixed(0)}KB da farmácia antiga)`);

  const assetRes = await apiFetch('/api/asset/branding-logo', { headers: { Authorization: `Bearer ${tokenNovo}` } });
  ok('GET /api/asset/branding-logo devolve o logótipo isolado', JSON.parse(assetRes.body).content === logo500kb);

  // ---------- 3. Playwright: carregar central + todos os módulos ----------
  for (const modulo of MODULOS) {
    for (const [vpName, vp] of Object.entries(viewports)) {
      const { ctx, page } = await novaPaginaComSessao(browser, tokenNovo, { tenantId: signupNovo.tenantId, email: emailNovo, nomeFarmacia: 'Farmácia QA Nova' }, vp);
      const erros = [];
      page.on('pageerror', e => erros.push('pageerror: ' + e.message));
      page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) erros.push('console.error: ' + msg.text()); });
      try {
        await page.goto(`${BASE}/modulos/${modulo}.html`, { waitUntil: 'load', timeout: 15000 });
        await page.waitForTimeout(700);
        ok(`${modulo} [${vpName}] carrega sem erros`, erros.length === 0, erros.join(' | '));
      } catch (e) {
        ok(`${modulo} [${vpName}] carrega sem erros`, false, 'exceção: ' + e.message);
      }
      await ctx.close();
    }
  }

  // ---------- 4. logótipo pinta corretamente (farmácia nova, via asset) ----------
  {
    const { ctx, page } = await novaPaginaComSessao(browser, tokenNovo, { tenantId: signupNovo.tenantId, email: emailNovo, nomeFarmacia: 'Farmácia QA Nova' }, viewports.desktop);
    await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(500);
    const src = await page.locator('#brandLogoImg').getAttribute('src');
    ok('PIM (farmácia nova): logótipo real acaba no <img> (via asset)', src === logo500kb, `src length=${src?.length}`);
    await ctx.close();
  }

  // ---------- 5. retrocompatibilidade: farmácia "antiga" (logo só em config) ----------
  {
    const { ctx, page } = await novaPaginaComSessao(browser, tokenAntigo, { tenantId: signupAntigo.tenantId, email: emailAntigo, nomeFarmacia: 'Farmácia QA Antiga' }, viewports.desktop);
    await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(500);
    const src = await page.locator('#brandLogoImg').getAttribute('src');
    ok('PIM (farmácia antiga, logo só em config): continua a mostrar o logótipo (fallback)', src === logo500kb, `src length=${src?.length}`);
    await ctx.close();
  }

  // ---------- 6. fluxo funcional real: criar utente em PIM + persistência ----------
  async function criarUtenteViaUI(page, nome) {
    await page.click('.mc-bb-item:has-text("Utentes")');
    await page.waitForSelector('#viewUtentes:not([style*="display:none"]) button:has-text("Novo utente")', { timeout: 3000 }).catch(() => {});
    await page.click('#viewUtentes button:has-text("Novo utente")');
    await page.waitForSelector('#utenteModalOverlay.open input[oninput*="draftUtente.nome"]', { timeout: 3000 });
    await page.fill('#utenteModalOverlay input[oninput*="draftUtente.nome"]', nome);
    await page.click('#utenteModalOverlay button:has-text("Guardar")');
    await page.waitForTimeout(600);
    return page.locator(`text=${nome}`).count();
  }

  {
    const { ctx, page } = await novaPaginaComSessao(browser, tokenNovo, { tenantId: signupNovo.tenantId, email: emailNovo, nomeFarmacia: 'Farmácia QA Nova' }, viewports.desktop);
    await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(400);
    let criouUtente = false;
    try { criouUtente = (await criarUtenteViaUI(page, 'Maria QA Battery')) > 0; }
    catch (e) { console.log('nota: fluxo de criar utente falhou: ' + e.message); }
    ok('PIM: criar utente funciona (sem o bug de escopo do draft)', criouUtente);
    await ctx.close();
  }

  const dataNovoDepois = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenNovo}` } })).body);
  ok('depois de gravar em PIM: config ainda sem logo (farmácia nova)', !dataNovoDepois.config || !dataNovoDepois.config.logo);
  const assetDepois = JSON.parse((await apiFetch('/api/asset/branding-logo', { headers: { Authorization: `Bearer ${tokenNovo}` } })).body);
  ok('depois de gravar em PIM: logótipo no asset continua intacto', assetDepois.content === logo500kb);

  {
    const { ctx, page } = await novaPaginaComSessao(browser, tokenAntigo, { tenantId: signupAntigo.tenantId, email: emailAntigo, nomeFarmacia: 'Farmácia QA Antiga' }, viewports.desktop);
    await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(400);
    try { await criarUtenteViaUI(page, 'João QA Battery Antigo'); }
    catch (e) { console.log('nota: fluxo de criar utente (farmácia antiga) falhou: ' + e.message); }
    await ctx.close();
  }
  const dataAntigoDepois = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenAntigo}` } })).body);
  ok('farmácia antiga: após 1ª gravação real de qualquer módulo, config.logo converge e desaparece', !dataAntigoDepois.config || !dataAntigoDepois.config.logo);

  // ---------- 7. módulo Poupança & ROI: tracking de uso (registarUso) + dashboard ----------
  {
    const signupUso = await signupFarmacia('Uso');
    const tokenUso = signupUso.token;
    const perfilUso = signupUso.perfil;
    const hoje = new Date();
    const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');

    {
      const { ctx, page } = await novaPaginaComSessao(browser, tokenUso, perfilUso, viewports.desktop);
      await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(500);
      const temApi = await page.evaluate(() => typeof window.ModuleChrome?.registarUso === 'function');
      ok('window.ModuleChrome.registarUso está disponível nos módulos', temApi);
      await page.evaluate(() => {
        window.ModuleChrome.registarUso('pim', 'criar_utente');
        window.ModuleChrome.registarUso('pim', 'criar_utente');
        window.ModuleChrome.registarUso('pim', 'registar_receita');
      });
      await page.waitForTimeout(3000);
      await ctx.close();
    }
    const assetUsoRes = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${tokenUso}` } });
    const contagensUso = (JSON.parse(assetUsoRes.body).content ? JSON.parse(JSON.parse(assetUsoRes.body).content) : { dias: {} }).dias?.[diaChave] || {};
    ok('registarUso(): flush automático (debounce) persistiu "pim.criar_utente"=2', contagensUso['pim.criar_utente'] === 2);
    ok('registarUso(): flush automático (debounce) persistiu "pim.registar_receita"=1', contagensUso['pim.registar_receita'] === 1);

    {
      const { ctx, page } = await novaPaginaComSessao(browser, tokenUso, perfilUso, viewports.desktop);
      await page.goto(`${BASE}/modulos/pim.html`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.ModuleChrome.registarUso('pim', 'criar_evento'); });
      await page.goto(`${BASE}/modulos/gabinete.html`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(2500);
      await ctx.close();
    }
    const assetUsoRes2 = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${tokenUso}` } });
    const contagensUso2 = (JSON.parse(assetUsoRes2.body).content ? JSON.parse(JSON.parse(assetUsoRes2.body).content) : { dias: {} }).dias?.[diaChave] || {};
    ok('registarUso(): um flush falhado (navegação) nunca apaga uso já gravado ("pim.criar_utente" continua=2)', contagensUso2['pim.criar_utente'] === 2);
    ok('registarUso(): um flush falhado (navegação) nunca apaga uso já gravado ("pim.registar_receita" continua=1)', contagensUso2['pim.registar_receita'] === 1);

    {
      const { ctx, page } = await novaPaginaComSessao(browser, tokenUso, perfilUso, viewports.desktop);
      await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1000);
      await page.click('#btnAbrirConfig');
      await page.waitForTimeout(200);
      await page.click('#modalConfig .modal-tab[data-tab="poupanca"]');
      await page.waitForTimeout(1500);
      const linhasTabela = await page.evaluate(() => document.querySelectorAll('#poupTabelaTarefasBody tr').length);
      ok('Poupança & ROI: tabela de tarefas renderiza as linhas do catálogo (mesmo sem Chart.js/cdnjs)', linhasTabela >= 30, `linhas=${linhasTabela}`);
      const resumoHtml = await page.evaluate(() => document.getElementById('poupResumoGrid')?.innerHTML || '');
      ok('Poupança & ROI: resumo mostra os 5 cartões (hoje/semana/mês/ano/sempre)', (resumoHtml.match(/poup-resumo-card/g) || []).length === 5);
      await ctx.close();
    }
  }

  // ---------- 8. leitura de DataMatrix (zxing-wasm/BarcodeDetector) + parseGS1 ----------
  {
    const signupScan = await signupFarmacia('Scan');
    const tokenScan = signupScan.token;
    const perfilScan = signupScan.perfil;

    for (const modulo of ['gabinete', 'pim']) {
      const { ctx, page } = await novaPaginaComSessao(browser, tokenScan, perfilScan, viewports.desktop);
      await page.goto(`${BASE}/modulos/${modulo}.html`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(400);
      const temApi = await page.evaluate(() => !!(window.ModuleChrome && typeof window.ModuleChrome.ensureBarcodeLib === 'function' && typeof window.ModuleChrome.decodeBarcodeFrame === 'function'));
      ok(`${modulo}.html: window.ModuleChrome expõe ensureBarcodeLib/decodeBarcodeFrame (leitura de DataMatrix)`, temApi);

      const codigoHRI = '(01)07612345678903(17)251231(10)LOTE9XZ(21)SN00456(714)1234567';
      const viaHRI = await page.evaluate((c) => window.parseGS1(c), codigoHRI);
      ok(`${modulo}.html: parseGS1() decompõe corretamente um código GS1 em formato HRI (com parênteses)`, !!viaHRI &&
        viaHRI.pc === '07612345678903' && viaHRI.validadeRaw === '251231' && viaHRI.lote === 'LOTE9XZ' && viaHRI.sn === 'SN00456' && viaHRI.cnp === '1234567',
        JSON.stringify(viaHRI));

      const codigoAntigo = '010761234567890317251231714123456710LOTE9XZ21SN00456';
      const viaHeuristica = await page.evaluate((c) => window.parseGS1(c), codigoAntigo);
      ok(`${modulo}.html: parseGS1() continua a decompor o formato antigo sem parênteses (heurística, sem regressão)`, !!viaHeuristica &&
        viaHeuristica.pc === '07612345678903' && viaHeuristica.cnp === '1234567' && viaHeuristica.validadeRaw === '251231',
        JSON.stringify(viaHeuristica));

      await ctx.close();
    }
  }

  // ---------- 9. Auto-manutenção da Central (ponto 21/22): integridade + backups + saúde ----------
  {
    const signupManut = await signupFarmacia('Manut');
    const tokenManut = signupManut.token;
    const perfilManut = signupManut.perfil;

    // Backup automático diário: uma conta nova (sem nenhum manutBackups ainda)
    // deve ganhar um backup sozinha ao arrancar a Central, sem o utilizador
    // sequer abrir a aba de Auto-manutenção.
    {
      const { ctx, page } = await novaPaginaComSessao(browser, tokenManut, perfilManut, viewports.desktop);
      await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(2000);
      await ctx.close();
    }
    const configApósArranque = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenManut}` } })).body).config;
    const backupsAutomaticos = configApósArranque?.manutBackups || [];
    ok('Auto-manutenção: uma cópia de segurança automática é criada sozinha ao arrancar a Central (sem abrir a aba)',
      backupsAutomaticos.length === 1 && backupsAutomaticos[0].manual === false, JSON.stringify(backupsAutomaticos));

    // Semeia uma referência órfã real no PIM (medicamento a apontar para um
    // utente que já não existe) para testar verificação + reparação.
    const estadoAtual = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenManut}` } })).body);
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${tokenManut}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...estadoAtual,
        pim: {
          pim_utentes_v1: [{ id: 'u-manut-1', nome: 'Utente Manutenção QA' }],
          pim_medicamentos_v1: [
            { id: 'm-manut-1', utenteId: 'u-manut-1', nomeComercial: 'Ativo QA' },
            { id: 'm-manut-2', utenteId: 'u-fantasma-manut', nomeComercial: 'Órfão QA' }
          ]
        }
      })
    });

    const { ctx, page } = await novaPaginaComSessao(browser, tokenManut, perfilManut, viewports.desktop);
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.click('#btnAbrirConfig');
    await page.waitForTimeout(200);
    await page.click('#modalConfig .modal-tab[data-tab="manutencao"]');
    await page.waitForTimeout(500);

    // ---- Verificação de integridade encontra o problema semeado ----
    await page.click('#btnManutVerificar');
    await page.waitForTimeout(600);
    const resultadoTexto = await page.locator('#manutIntegridadeResultado').innerText();
    ok('Auto-manutenção: "Verificar agora" encontra a referência órfã semeada no PIM',
      resultadoTexto.includes('1') && /já não existe/i.test(resultadoTexto), resultadoTexto);
    const reparBtnAtivo = await page.locator('#btnManutReparar').isEnabled();
    ok('Auto-manutenção: "Reparar automaticamente" fica ativo quando há problemas reparáveis', reparBtnAtivo);

    // ---- Reparar automaticamente remove o registo órfão a sério (no servidor) ----
    await page.click('#btnManutReparar');
    await page.waitForTimeout(800);
    const resultadoAposReparar = await page.locator('#manutIntegridadeResultado').innerText();
    ok('Auto-manutenção: depois de reparar, a verificação seguinte mostra "tudo em ordem"', /ordem/i.test(resultadoAposReparar), resultadoAposReparar);
    const estadoAposReparar = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenManut}` } })).body);
    const medsRestantes = estadoAposReparar.pim.pim_medicamentos_v1;
    ok('Auto-manutenção: a reparação removeu mesmo o medicamento órfão no servidor, mantendo o válido',
      medsRestantes.length === 1 && medsRestantes[0].id === 'm-manut-1', JSON.stringify(medsRestantes));

    // ---- Cópia de segurança manual ----
    await page.click('#btnManutBackupAgora');
    await page.waitForTimeout(800);
    const linhasBackup = await page.locator('#manutBackupsLista tbody tr').count();
    ok('Auto-manutenção: "Criar cópia de segurança agora" acrescenta uma linha à lista (backup automático do arranque + este manual = 2)', linhasBackup === 2, `linhas=${linhasBackup}`);

    // ---- Painel de saúde mostra os 4 cartões ----
    const saudeHtml = await page.locator('#manutSaudeGrid').innerHTML();
    ok('Auto-manutenção: painel de saúde mostra os 4 cartões (tamanho/registos/backups/último backup)', (saudeHtml.match(/poup-resumo-card/g) || []).length === 4, saudeHtml);

    // ---- Restauro: adiciona um serviço a mais, restaura o backup manual (sem esse serviço) e confirma que desaparece ----
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${tokenManut}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...estadoAposReparar, servicos: [...estadoAposReparar.servicos, { id: 'servico-extra-manut-qa', nome: 'Serviço a mais QA' }] })
    });
    page.once('dialog', d => d.accept());
    await page.click('#manutBackupsLista .manut-restaurar-btn >> nth=0');
    await page.waitForTimeout(1500); // restauro + location.reload()
    await page.waitForTimeout(1500);
    const estadoAposRestauro = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${tokenManut}` } })).body);
    ok('Auto-manutenção: restaurar uma cópia de segurança repõe os serviços de então (o "a mais" desaparece)',
      !estadoAposRestauro.servicos.some(s => s.id === 'servico-extra-manut-qa'), JSON.stringify(estadoAposRestauro.servicos.map(s => s.id)));

    await ctx.close();
  }
}
