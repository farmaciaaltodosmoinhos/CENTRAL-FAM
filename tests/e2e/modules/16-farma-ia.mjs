/**
 * FARMA IA (pontos 25 e 26) — cobertura e2e real (browser), dos 3 pilares
 * originais mais a "Memória & Aprendizagem" do ponto 26 (ver src/farmaIa.js
 * para a lógica pura, já coberta exaustivamente por tests/farmaIa.test.js):
 *
 *  1. Alertas & Insights: semeia um cenário real (embalagem do PIM perto da
 *     validade, item do Gabinete abaixo do mínimo, pedido AUE parado,
 *     pedido de manipulado parado, produto recorrentemente "não encontrado"
 *     em Stocks Errados) e confirma que o módulo `modulos/farma-ia.html`
 *     mostra mesmo os alertas correspondentes no browser.
 *  2. Perguntar: faz uma pergunta real através do formulário da UI e
 *     confirma que aparece uma resposta reconhecida (não a mensagem de
 *     "não percebi").
 *  3. Oportunidades de automação: semeia uso real (mesmo blob `uso-AAAA-MM`
 *     que o painel de Poupança & ROI lê) acima do limiar e confirma que a
 *     tarefa aparece listada como oportunidade.
 *  4. (ver secções 5-7 mais abaixo) Ponto 26 — dispensar um alerta persiste
 *     no servidor (`config.farmaIaMemoria`) e sobrevive a um reload; ensinar
 *     um alias por clique numa sugestão faz a MESMA pergunta responder de
 *     imediato da próxima vez, sem reconhecer de novo; e o novo alerta de
 *     backup em atraso (cruza com src/manutencao.js, ponto 23) aparece
 *     quando semeado.
 */
import { BASE, ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports, coletarErros } from '../helpers.mjs';

function isoMenosDias(dias) { return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10); }
function isoDataHoraMenosDias(dias) { return new Date(Date.now() - dias * 86400000).toISOString(); }

export async function run(browser) {
  // ---------- 1 + 2: cenário completo de alertas, semeado via API ----------
  const { token, perfil } = await signupFarmacia('FarmaIa');

  const estadoSemeado = {
    servicos: [], categorias: [], config: {},
    pim: {
      pim_utentes_v1: [{ id: 'u1', nome: 'Ana Teste FarmaIA', categoria: 'ativo' }],
      pim_medicamentos_v1: [{ id: 'm1', utenteId: 'u1', nomeComercial: 'EutiroxTesteQA' }],
      pim_stock_v1: [{ id: 'e1', utenteId: 'u1', medicamentoId: 'm1', status: 'em_uso', quantidadeAtual: 5, validade: isoMenosDias(-15) }]
    },
    gabinete: {
      gabinete_stock_v1: [
        { id: 'g1', nome: 'AlcoolGelTesteQA', quantidade: 1, quantidadeMinima: 5 },
        { id: 'g2', nome: 'SoroFisiologicoTesteQA', quantidade: 10, quantidadeMinima: 2, validade: isoMenosDias(3) }
      ]
    },
    aue: {
      pedidos: [{ id: 'p1', status: 'pendente_docs', updatedAt: isoDataHoraMenosDias(15) }]
    },
    manipulados: [
      { id: 'mp1', status: 'preparacao', criado: isoMenosDias(10), nome: 'BrunoTesteQA' }
    ],
    stocksErrados: {
      l0: { id: 'l0', nome: 'Lista QA 0', items: [{ codigo: 'CODQA1', designacao: 'ParacetamolTesteQA', motivo: 'procurei' }] },
      l1: { id: 'l1', nome: 'Lista QA 1', items: [{ codigo: 'CODQA1', designacao: 'ParacetamolTesteQA', motivo: 'procurei' }] },
      l2: { id: 'l2', nome: 'Lista QA 2', items: [{ codigo: 'CODQA1', designacao: 'ParacetamolTesteQA', motivo: 'procurei' }] }
    }
  };
  const putRes = await apiFetch('/api/data', {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(estadoSemeado)
  });
  ok('FARMA IA: cenário de teste (PIM/Gabinete/AUE/Manipulados/Stocks Errados) gravado com sucesso', putRes.status === 200, `status=${putRes.status}`);

  {
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    const erros = coletarErros(page);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1200);
    ok('FARMA IA: módulo carrega sem erros de consola/página', erros.length === 0, erros.join(' | '));

    const chipsTexto = await page.locator('#resumoChips').innerText();
    ok('FARMA IA: resumo mostra pelo menos 1 alerta urgente e 1 de aviso', /urgente/.test(chipsTexto) && /aviso/.test(chipsTexto), chipsTexto);

    const listaTexto = await page.locator('#listaAlertas').innerText();
    ok('FARMA IA: alerta de embalagem do PIM perto/expirada aparece com o nome do medicamento', listaTexto.includes('EutiroxTesteQA'), listaTexto.slice(0, 400));
    ok('FARMA IA: alerta de item do Gabinete abaixo do mínimo aparece', listaTexto.includes('AlcoolGelTesteQA'), listaTexto.slice(0, 400));
    ok('FARMA IA: alerta de item do Gabinete já expirado (urgente) aparece', listaTexto.includes('SoroFisiologicoTesteQA'), listaTexto.slice(0, 400));
    ok('FARMA IA: alerta de pedido AUE parado aparece', /AUE/.test(listaTexto), listaTexto.slice(0, 400));
    ok('FARMA IA: alerta de pedido de manipulado parado aparece com o nome do utente', listaTexto.includes('BrunoTesteQA'), listaTexto.slice(0, 400));
    ok('FARMA IA: alerta de produto recorrentemente não encontrado (Stocks Errados) aparece', listaTexto.includes('ParacetamolTesteQA'), listaTexto.slice(0, 400));

    // ---- pilar 2: perguntar ----
    await page.click('.mc-bb-item:has-text("Perguntar")');
    await page.waitForTimeout(300);
    await page.fill('#inputPergunta', 'Quantos alertas tenho?');
    await page.click('#formPergunta button[type="submit"]');
    await page.waitForTimeout(500);
    const chatTexto = await page.locator('#chatLog').innerText();
    ok('FARMA IA: pergunta "quantos alertas tenho?" recebe uma resposta reconhecida (não "não percebi")', /alerta/i.test(chatTexto) && !/Não percebi/.test(chatTexto), chatTexto);

    // pergunta com exemplo pré-definido (clique num chip de exemplo)
    await page.click('.exemplo-btn[data-pergunta="Quantos utentes tenho no PIM?"]');
    await page.waitForTimeout(500);
    const chatTexto2 = await page.locator('#chatLog').innerText();
    ok('FARMA IA: clicar num exemplo de pergunta também gera resposta (utentes ativos no PIM)', /utente/i.test(chatTexto2), chatTexto2.slice(-300));

    await ctx.close();
  }

  // ---------- 3: oportunidades de automação, semeadas via uso real ----------
  {
    const { token: tokenOport, perfil: perfilOport } = await signupFarmacia('FarmaIaOport');
    const hoje = new Date();
    const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
    const usoSemeado = { dias: { [diaChave]: { 'pim.criar_utente': 20 } } }; // 20 > LIMIAR_OPORTUNIDADE_OCORRENCIAS (15)
    await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${tokenOport}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: JSON.stringify(usoSemeado) })
    });

    const { ctx, page } = await novaPaginaComSessao(browser, tokenOport, perfilOport, viewports.desktop);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click('.mc-bb-item:has-text("Oportunidades")');
    await page.waitForTimeout(700);
    const oportTexto = await page.locator('#listaOportunidades').innerText();
    ok('FARMA IA: tarefa muito repetida (pim.criar_utente, 20x no dia) aparece como oportunidade de automação',
      /criar ficha de utente/i.test(oportTexto) && /20/.test(oportTexto), oportTexto);

    await ctx.close();
  }

  // ---------- 4: uso das 3 tarefas trackáveis é mesmo registado (Poupança & ROI) ----------
  {
    const { token: tokenUso, perfil: perfilUso } = await signupFarmacia('FarmaIaUso');
    const { ctx, page } = await novaPaginaComSessao(browser, tokenUso, perfilUso, viewports.desktop);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1000); // ver_alertas já disparado no arranque
    // Debounce do flush de uso é de 2s (ver assets/module-chrome.js) — espera-se
    // por ele em vez de contar só com o pagehide do ctx.close(), que pode
    // interromper o fetch a meio antes de o intervalo de 2s sequer disparar.
    await page.waitForTimeout(2500);
    await ctx.close();

    const hoje = new Date();
    const mesChave = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    const diaChave = mesChave + '-' + String(hoje.getDate()).padStart(2, '0');
    const assetRes = await apiFetch(`/api/asset/${encodeURIComponent('uso-' + mesChave)}`, { headers: { Authorization: `Bearer ${tokenUso}` } });
    const contagens = (JSON.parse(assetRes.body).content ? JSON.parse(JSON.parse(assetRes.body).content) : { dias: {} }).dias?.[diaChave] || {};
    ok('FARMA IA: abrir o módulo regista mesmo "farma-ia.ver_alertas" no tracking de uso (Poupança & ROI)', contagens['farma-ia.ver_alertas'] >= 1, JSON.stringify(contagens));
  }

  // ---------- 5 (ponto 26): dispensar um alerta persiste e sobrevive a reload ----------
  {
    const { token, perfil } = await signupFarmacia('FarmaIaDispensar');
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servicos: [], categorias: [], config: {},
        gabinete: { gabinete_stock_v1: [{ id: 'gd1', nome: 'DispensarTesteQA', quantidade: 1, quantidadeMinima: 5 }] }
      })
    });

    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1000);

    const antesTexto = await page.locator('#listaAlertas').innerText();
    ok('FARMA IA (dispensar): alerta aparece antes de ser dispensado', antesTexto.includes('DispensarTesteQA'), antesTexto.slice(0, 300));

    // Bug do próprio teste corrigido (encontrado ao correr a bateria completa no
    // ponto 34): desde a saudação automática do ponto 29, a vista que abre por
    // omissão é "Perguntar", não "Alertas" — .innerText() lê o texto de
    // #listaAlertas na mesma mesmo com a vista escondida (display:none), mas
    // .click() exige o botão visível, e por isso ficava sempre a tentar clicar
    // num botão nunca visível. Falta mudar explicitamente para a vista Alertas
    // primeiro, como as secções de Perguntar/Oportunidades já fazem acima.
    await page.click('.mc-bb-item:has-text("Alertas")');
    await page.waitForTimeout(300);
    await page.click('.dispensar-btn');
    await page.waitForTimeout(600);
    const depoisTexto = await page.locator('#listaAlertas').innerText();
    ok('FARMA IA (dispensar): alerta desaparece da lista imediatamente após clicar em "Dispensar"', !depoisTexto.includes('DispensarTesteQA'), depoisTexto.slice(0, 300));
    ok('FARMA IA (dispensar): nota de alertas silenciados aparece', /silenciado/.test(depoisTexto), depoisTexto.slice(0, 300));

    await ctx.close();

    // confirma que ficou mesmo gravado no servidor (config.farmaIaMemoria), não só em memória local da página
    const dataRes = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
    const memoriaGravada = JSON.parse(dataRes.body)?.config?.farmaIaMemoria;
    ok('FARMA IA (dispensar): config.farmaIaMemoria.alertasDispensados ficou gravado no servidor', !!memoriaGravada && Object.keys(memoriaGravada.alertasDispensados || {}).length === 1, JSON.stringify(memoriaGravada));

    // reabre numa página nova (sem estado local nenhum) — o alerta continua escondido
    const { ctx: ctx2, page: page2 } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page2.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page2.waitForTimeout(1000);
    const reloadTexto = await page2.locator('#listaAlertas').innerText();
    ok('FARMA IA (dispensar): alerta continua escondido depois de reabrir o módulo (persistiu no servidor)', !reloadTexto.includes('DispensarTesteQA'), reloadTexto.slice(0, 300));
    await ctx2.close();
  }

  // ---------- 6 (ponto 26): ensinar um alias por sugestão — pergunta passa a responder de imediato ----------
  {
    const { token, perfil } = await signupFarmacia('FarmaIaAprender');
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ servicos: [], categorias: [], config: {}, pim: { pim_utentes_v1: [{ id: 'u1', nome: 'Carla Aprender QA', categoria: 'ativo' }] } })
    });

    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click('.mc-bb-item:has-text("Perguntar")');
    await page.waitForTimeout(300);

    // "utenets" (letras trocadas) não bate em nenhuma palavra-chave por
    // substring, nem pelo motor de regras nem pela rede neuronal do ponto 42
    // (fase 2) com confiança suficiente para responder sozinha — só é
    // reconhecida pela via de sugestão (sugerirIntentsSemelhantes), o que
    // continua a testar o fluxo de "ensinar alias" ponto a ponto. (Um erro de
    // escrita mais "normal" como "utentse"/"utntes" já é hoje reconhecido
    // DIRETAMENTE pela rede neuronal — ver o teste seguinte, "tolerância a
    // erros de escrita via rede neuronal" — precisamente o ganho do ponto 42:
    // antes exigia sempre ensinar o alias à mão, mesmo para um erro óbvio.)
    const perguntaComErro = 'utenets';
    await page.fill('#inputPergunta', perguntaComErro);
    await page.click('#formPergunta button[type="submit"]');
    await page.waitForTimeout(500);
    const naoReconhecidoTexto = await page.locator('#chatLog').innerText();
    ok('FARMA IA (aprender): pergunta com erro de escrita não é reconhecida de início', /Não percebi/.test(naoReconhecidoTexto), naoReconhecidoTexto.slice(-300));

    const sugestaoVisivel = await page.locator('.sugestao-btn').count();
    ok('FARMA IA (aprender): aparece pelo menos 1 sugestão de "talvez quisesse dizer"', sugestaoVisivel > 0, String(sugestaoVisivel));

    await page.click('.sugestao-btn >> nth=0');
    await page.waitForTimeout(500);
    const ultimaResposta = page.locator('.msg.resposta').last();
    const ultimaClasse = await ultimaResposta.getAttribute('class');
    ok('FARMA IA (aprender): a resposta gerada pela sugestão fica marcada como "aprendido"', /aprendido/.test(ultimaClasse || ''), ultimaClasse);
    const aprendidoTexto = await ultimaResposta.innerText();
    ok('FARMA IA (aprender): clicar na sugestão responde mesmo com a contagem de utentes', /utente/i.test(aprendidoTexto), aprendidoTexto);

    // faz a MESMA pergunta com erro outra vez — desta vez deve responder de
    // imediato via o alias aprendido, sem mostrar "Não percebi" nem novas sugestões
    await page.fill('#inputPergunta', perguntaComErro);
    await page.click('#formPergunta button[type="submit"]');
    await page.waitForTimeout(500);
    const ultimaResposta2 = page.locator('.msg.resposta').last();
    const ultimaClasse2 = await ultimaResposta2.getAttribute('class');
    ok('FARMA IA (aprender): a mesma pergunta repetida já responde via alias aprendido, sem precisar de sugestão',
      /aprendido/.test(ultimaClasse2 || ''), ultimaClasse2);

    // ponto 42 (fase 2): um erro de escrita "normal" (troca de duas letras
    // adjacentes) já não precisa de passar pelo fluxo de ensinar alias acima
    // — a rede neuronal reconhece-o sozinha, com confiança, e responde de
    // imediato marcada com a classe via-rede-neural (🧩 na UI).
    await page.fill('#inputPergunta', 'utntes');
    await page.click('#formPergunta button[type="submit"]');
    await page.waitForTimeout(500);
    const respostaRede = page.locator('.msg.resposta').last();
    const classeRespostaRede = await respostaRede.getAttribute('class');
    ok('FARMA IA (rede neuronal): erro de escrita comum é reconhecido diretamente, marcado como via-rede-neural',
      /via-rede-neural/.test(classeRespostaRede || ''), classeRespostaRede);
    const textoRespostaRede = await respostaRede.innerText();
    ok('FARMA IA (rede neuronal): a resposta reconhecida via rede continua a responder com a contagem certa de utentes',
      /utente/i.test(textoRespostaRede), textoRespostaRede);

    await ctx.close();

    const dataRes = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
    const memoriaGravada = JSON.parse(dataRes.body)?.config?.farmaIaMemoria;
    ok('FARMA IA (aprender): o alias ensinado ficou gravado em config.farmaIaMemoria.aliases no servidor',
      !!memoriaGravada && Object.keys(memoriaGravada.aliases || {}).length >= 1, JSON.stringify(memoriaGravada));
  }

  // ---------- 7 (ponto 26): alerta de backup em atraso (cruza com src/manutencao.js) ----------
  {
    const { token, perfil } = await signupFarmacia('FarmaIaBackup');
    await apiFetch('/api/data', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ servicos: [], categorias: [], config: { manutBackups: [{ id: 'b1', criadoEm: isoDataHoraMenosDias(10) }] } })
    });

    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1000);
    const listaTexto = await page.locator('#listaAlertas').innerText();
    ok('FARMA IA (backup): alerta "sem cópia de segurança recente" aparece quando o último backup tem mais de 7 dias', /cópia de segurança/i.test(listaTexto), listaTexto.slice(0, 300));
    await ctx.close();
  }
}
