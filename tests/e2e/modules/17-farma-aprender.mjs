/**
 * tests/e2e/modules/17-farma-aprender.mjs — smoke e2e da nova aba "Aprender"
 * (ponto 43): as 4 funções (explorar central, treino intensivo, aprender
 * por leitura, multifarma) num browser real, contra o servidor local de
 * integração (funções reais + blobs em memória).
 */
import { BASE, ok, apiFetch, signupFarmacia, novaPaginaComSessao, coletarErros, viewports } from '../helpers.mjs';

export async function run(browser) {
  const { token, perfil } = await signupFarmacia('FarmaAprender');
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  const erros = coletarErros(page);
  await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(500);

  // ---------- navegação: abrir a aba "Aprender" ----------
  await page.locator('#mcBottomBar .mc-bb-item:has-text("Aprender")').click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const viewAprenderVisivel = await page.locator('#viewAprender').isVisible();
  ok('Aprender: a view fica ativa ao clicar na aba', viewAprenderVisivel);

  // sub-aba "Explorar central" ativa por omissão
  const subExplorarVisivel = await page.locator('#subExplorar').isVisible();
  ok('Aprender/Explorar: a sub-aba "Explorar central" está ativa por omissão', subExplorarVisivel);

  // ---------- Função 1: explorar central ----------
  await page.locator('#btnExplorarCentral').click();
  await page.waitForTimeout(800);
  const statusExplorar = await page.locator('#statusExplorar').innerText();
  ok('Aprender/Explorar: o botão "Explorar a Central agora" corre sem erro e dá feedback',
    /proposta|Nenhuma/i.test(statusExplorar), statusExplorar);
  const listaPropostasTexto = await page.locator('#listaPropostas').innerText();
  ok('Aprender/Explorar: sem histórico de uso, não há propostas pendentes (mensagem honesta, nunca inventa)',
    /Sem propostas/i.test(listaPropostasTexto), listaPropostasTexto);

  // ---------- Função 2: treino intensivo ----------
  await page.locator('[data-sub="treino"]').click();
  await page.waitForTimeout(200);
  const statusAliases = await page.locator('#statusAliasesTreino').innerText();
  // ponto 46: mensagem reforçada para deixar claro PORQUE o botão está
  // desativado (achado real da investigação: um botão só cinzento, sem
  // motivo à vista, foi confundido com "não funciona").
  ok('Aprender/Treino: sem aliases ensinados ainda, avisa que precisa de pelo menos 3',
    /precisa de pelo menos 3/i.test(statusAliases), statusAliases);
  const btnTreinarDesabilitado = await page.locator('#btnTreinarAgora').isDisabled();
  ok('Aprender/Treino: o botão "Treinar agora" fica desabilitado sem aliases suficientes', btnTreinarDesabilitado);
  const chkPartilhadoDesabilitado = await page.locator('#chkUsarPartilhado').isDisabled();
  ok('Aprender/Treino: a opção de padrões partilhados fica desabilitada sem a Multifarma ativa', chkPartilhadoDesabilitado);

  // ---------- Função 3: aprender por leitura ----------
  await page.locator('[data-sub="leitura"]').click();
  await page.waitForTimeout(200);
  const listaDocsTexto = await page.locator('#listaDocumentosLidos').innerText();
  ok('Aprender/Leitura: sem nenhum documento carregado ainda, mostra a mensagem vazia',
    /Ainda não carregou/.test(listaDocsTexto), listaDocsTexto);

  // carrega um ficheiro .txt real através do input (não precisa de bibliotecas CDN, caminho mais simples e determinístico)
  const conteudoTxt = 'A amoxicilina é um antibiótico usado para tratar infeções bacterianas comuns em adultos.';
  await page.setInputFiles('#inputFicheiroLeitura', {
    name: 'bula-teste.txt', mimeType: 'text/plain', buffer: Buffer.from(conteudoTxt, 'utf8'),
  });
  await page.waitForTimeout(600);
  const statusLeitura = await page.locator('#statusLeitura').innerText();
  ok('Aprender/Leitura: um ficheiro .txt real é lido e aprendido com sucesso',
    /aprendido/.test(statusLeitura), statusLeitura);
  const listaDocsDepois = await page.locator('#listaDocumentosLidos').innerText();
  ok('Aprender/Leitura: o documento carregado aparece na lista de documentos aprendidos',
    /bula-teste\.txt/.test(listaDocsDepois), listaDocsDepois);

  // o documento fica de facto gravado no servidor (asset "farmaBaseConhecimento")
  const assetRes = await apiFetch(`/api/asset/farmaBaseConhecimento`, { headers: { Authorization: `Bearer ${token}` } });
  ok('Aprender/Leitura: a base de conhecimento fica gravada no servidor (asset store), nunca só na página',
    assetRes.status === 200 && JSON.parse(assetRes.body).content.includes('amoxicilina'), assetRes.status);

  // esquecer o documento
  await page.locator('[data-esquecer="bula-teste.txt"]').click();
  await page.waitForTimeout(400);
  const listaDocsApagado = await page.locator('#listaDocumentosLidos').innerText();
  ok('Aprender/Leitura: "Esquecer" remove o documento da lista',
    /Ainda não carregou/.test(listaDocsApagado), listaDocsApagado);

  // ---------- Função 4: aprendizagem multifarma ----------
  await page.locator('[data-sub="multifarma"]').click();
  await page.waitForTimeout(200);
  const conteudoEscondidoAntes = await page.locator('#multifarmaConteudo').isVisible();
  ok('Aprender/Multifarma: desligado por omissão — o conteúdo fica escondido', !conteudoEscondidoAntes);

  await page.locator('#chkMultifarmaAtiva').check();
  await page.waitForTimeout(600);
  const conteudoVisivelDepois = await page.locator('#multifarmaConteudo').isVisible();
  ok('Aprender/Multifarma: ao ativar o toggle, o conteúdo aparece', conteudoVisivelDepois);
  const resumoTexto = await page.locator('#resumoMultifarma').innerText();
  ok('Aprender/Multifarma: o resumo do conhecimento partilhado carrega (stats numéricas, nunca texto de outras farmácias)',
    /padrões partilhados/.test(resumoTexto) && /farmácias contribuintes/.test(resumoTexto), resumoTexto);

  // o opt-in fica de facto gravado no servidor
  const dataRes = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
  const configGravada = JSON.parse(dataRes.body)?.config?.farmaAprendizagemMultifarma;
  ok('Aprender/Multifarma: o opt-in fica gravado em config.farmaAprendizagemMultifarma.ativo no servidor',
    configGravada?.ativo === true, JSON.stringify(configGravada));

  // ---------- sem nenhum erro de página/consola durante todo o percurso ----------
  ok('Aprender: nenhum erro de página/consola durante o percurso completo das 4 funções', erros.length === 0, erros.join(' | '));

  await ctx.close();

  // ================================================================
  // Cenário 2 — Função 1 com dados de uso reais (proposta gerada e revista)
  // ================================================================
  {
    const { token: token2, perfil: perfil2 } = await signupFarmacia('FarmaExplorarReal');
    const hoje = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const mesChave = iso(hoje).slice(0, 7);
    await apiFetch(`/api/asset/uso-${mesChave}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: JSON.stringify({ dias: { [iso(hoje)]: { 'pim.criar_rotulo': 20 } } }) }),
    });

    const { ctx: ctx2, page: page2 } = await novaPaginaComSessao(browser, token2, perfil2, viewports.desktop);
    const erros2 = coletarErros(page2);
    await page2.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page2.waitForTimeout(500);
    await page2.locator('#mcBottomBar .mc-bb-item:has-text("Aprender")').click();
    await page2.waitForTimeout(300);

    await page2.locator('#btnExplorarCentral').click();
    await page2.waitForTimeout(800);
    const listaPropostasReal = await page2.locator('#listaPropostas').innerText();
    ok('Aprender/Explorar (real): uma tarefa muito repetida (20× no período) gera uma proposta real',
      /Rótulo/i.test(listaPropostasReal), listaPropostasReal);

    // aprovar a proposta — nunca implementa nada sozinha, só sinaliza para revisão
    await page2.locator('.proposta-card [data-acao="aprovar"]').first().click();
    await page2.waitForTimeout(500);
    const listaPropostasDepoisAprovar = await page2.locator('#listaPropostas').innerText();
    ok('Aprender/Explorar (real): depois de aprovada, a proposta sai da lista de pendentes',
      /Sem propostas/i.test(listaPropostasDepoisAprovar), listaPropostasDepoisAprovar);

    const dataRes2 = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token2}` } });
    const propostasGravadas = JSON.parse(dataRes2.body)?.config?.farmaPropostas || [];
    ok('Aprender/Explorar (real): a decisão "aprovada_para_revisão" fica gravada no servidor',
      propostasGravadas.some(p => p.estado === 'aprovada_para_revisao'), JSON.stringify(propostasGravadas));

    ok('Aprender/Explorar (real): nenhum erro de página/consola', erros2.length === 0, erros2.join(' | '));
    await ctx2.close();
  }

  // ================================================================
  // Cenário 3 — Função 2 (treino real) + Função 4 (contribuir real)
  // ================================================================
  {
    const { token: token3, perfil: perfil3 } = await signupFarmacia('FarmaTreinoReal');
    // ensina 4 aliases diretamente via /api/data (equivalente ao que ensinarAlias grava) —
    // mais rápido e determinístico do que repetir o fluxo de chat na UI.
    const aliases = {
      'dá-me o resumo de alertas da farmácia': 'alertas_resumo',
      'quero ver os medicamentos a validar em breve': 'validade',
      'mostra-me a lista de utentes cadastrados': 'utentes',
      'há novidades nos pedidos de aue': 'pedidos_aue',
    };
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${token3}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ servicos: [], categorias: [], config: { farmaIaMemoria: { perguntasNaoReconhecidas: [], aliases, alertasDispensados: {} } } }),
    });

    const { ctx: ctx3, page: page3 } = await novaPaginaComSessao(browser, token3, perfil3, viewports.desktop);
    const erros3 = coletarErros(page3);
    await page3.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page3.waitForTimeout(500);
    await page3.locator('#mcBottomBar .mc-bb-item:has-text("Aprender")').click();
    await page3.waitForTimeout(300);
    await page3.locator('[data-sub="treino"]').click();
    await page3.waitForTimeout(300);

    const statusAliasesComDados = await page3.locator('#statusAliasesTreino').innerText();
    ok('Aprender/Treino (real): com 4 aliases ensinados, mostra a contagem certa e liberta o botão',
      /4 perguntas ensinadas/.test(statusAliasesComDados), statusAliasesComDados);
    ok('Aprender/Treino (real): o botão "Treinar agora" fica ativo', await page3.locator('#btnTreinarAgora').isEnabled());

    await page3.locator('#btnTreinarAgora').click();
    // treino real: ~150 épocas sobre ~300 exemplos — demora vários segundos. Espera
    // pelo texto FINAL (não "#statusTreino:has-text" — o texto intermédio "A treinar…"
    // já contém "treinar" e faria o waitForSelector resolver cedo demais, antes do treino acabar).
    //
    // `page.waitForFunction(pageFunction, arg, options)` tem SEMPRE estes 3
    // parâmetros posicionais — chamado só com 2 (função + `{ timeout }`), o
    // Playwright interpreta o objeto de opções como `arg` (o argumento opaco
    // passado para dentro da função da página, aqui nunca usado) e não como
    // `options`, pelo que o timeout pedido era silenciosamente ignorado e o
    // timeout REAL era sempre o valor por omissão da biblioteca (30000ms) —
    // o que fazia este teste, computacionalmente pesado, falhar de forma
    // instável sempre que este sandbox estivesse momentaneamente mais lento.
    // Corrigido a passar `null` como `arg` para o timeout entrar mesmo como
    // `options`, e alargado de 30s para 60s de margem (verificado por medição
    // direta: a passagem real demora tipicamente poucos segundos; 60s dá
    // grande margem sem esconder uma falha real do treino).
    await page3.waitForFunction(
      () => /concluído e aceite|não aceite/.test(document.getElementById('statusTreino')?.textContent || ''),
      null,
      { timeout: 60000 }
    );
    const statusTreinoFinal = await page3.locator('#statusTreino').innerText();
    ok('Aprender/Treino (real): o treino real termina com sucesso ou com um motivo claro de recusa',
      /concluído e aceite|não aceite/.test(statusTreinoFinal), statusTreinoFinal);
    const relatorioTexto = await page3.locator('#relatorioTreino').innerText();
    ok('Aprender/Treino (real): o relatório mostra números reais (exatidão/sanidade), nunca vazio',
      /%/.test(relatorioTexto), relatorioTexto);

    if (/concluído e aceite/.test(statusTreinoFinal)) {
      const dataRes3 = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token3}` } });
      const treinoGravado = JSON.parse(dataRes3.body)?.config?.farmaTreinoLocal;
      ok('Aprender/Treino (real): o modelo aceite fica gravado em config.farmaTreinoLocal no servidor',
        treinoGravado?.aceite === true && !!treinoGravado.pesos, JSON.stringify(treinoGravado?.relatorio));
      const btnReverterVisivel = await page3.locator('#btnReverterTreino').isVisible();
      ok('Aprender/Treino (real): o botão "Reverter" aparece depois de um treino aceite', btnReverterVisivel);
    }

    // ---- Função 4: contribuir com o que ensinou (usa os mesmos aliases) ----
    await page3.locator('[data-sub="multifarma"]').click();
    await page3.waitForTimeout(200);
    await page3.locator('#chkMultifarmaAtiva').check();
    await page3.waitForTimeout(500);
    await page3.locator('#btnContribuirMultifarma').click();
    await page3.waitForTimeout(600);
    const statusMultifarmaFinal = await page3.locator('#statusMultifarma').innerText();
    ok('Aprender/Multifarma (real): contribuir com 4 aliases ensinados é aceite pelo servidor',
      /Contribuição enviada: 4 padr/.test(statusMultifarmaFinal), statusMultifarmaFinal);

    const partilhadoRes = await apiFetch('/api/farma-aprendizagens', { headers: { Authorization: `Bearer ${token3}` } });
    const partilhadoCorpo = JSON.parse(partilhadoRes.body);
    ok('Aprender/Multifarma (real): os padrões contribuídos aparecem no conhecimento partilhado, sem texto literal',
      partilhadoCorpo.padroes.length >= 4 && !JSON.stringify(partilhadoCorpo).includes('dá-me o resumo'),
      `padroes=${partilhadoCorpo.padroes.length}`);

    ok('Aprender/Treino+Multifarma (real): nenhum erro de página/consola', erros3.length === 0, erros3.join(' | '));
    await ctx3.close();
  }
}
