/**
 * Ponto 46 — reconhecimento de AÇÕES sem depender de nenhuma IA (nem local
 * nem externa): src/farmaAcoesIntent.js, ligado tanto ao módulo FARMA IA
 * completo (modulos/farma-ia.html) como ao mini-chat sempre visível
 * (src/ui/farmaMiniChat.js, index.html). Pedido explícito do Ivo: "liga
 * directamente o motor de ações da farma".
 *
 * Cobre exatamente o que faltava (achado real da investigação desta sessão,
 * ver arquitetura-decisoes.md ponto 46): zero cobertura automática do
 * percurso completo "escreve um pedido de ação em português corrente ->
 * aparece o cartão Confirmar/Cancelar -> confirma -> fica mesmo gravado no
 * servidor" — SEM carregar o "cérebro" (IA local/WebLLM), e a partir do
 * ponto de entrada mais visível da app (o mini-chat), que antes desta peça
 * não tinha ação nenhuma ligada.
 *
 * Farmácia de teste sempre criada com signupFarmacia(), nunca partilhada
 * com outros ficheiros de tests/e2e/modules/.
 */
import { BASE, ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports, coletarErros } from '../helpers.mjs';

export async function run(browser) {
  const { token, tenantId, email, nomeFarmacia } = await signupFarmacia('FarmaAcoesQA');

  // ---------- 1. modulos/farma-ia.html — pedido completo, sem IA local carregada ----------
  {
    const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
    const erros = coletarErros(page);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(600);

    await page.fill('#inputPergunta', 'cria um pedido de manipulado para a Ana Costa, medicamento minoxidil 5%, telefone 912345678');
    await page.click('#formPergunta button[type="submit"]');
    await page.waitForTimeout(500);

    const cartao = page.locator('.acao-card').last();
    const resumoTexto = await cartao.innerText().catch(() => '');
    ok('FARMA IA (ações diretas): pedido em português corrente gera logo um cartão de ação, SEM ter carregado a IA local',
      /Ana Costa/.test(resumoTexto) && /minoxidil/i.test(resumoTexto), resumoTexto);

    await cartao.locator('.confirmar').click();
    await page.waitForTimeout(600);
    const ultimaMsg = await page.locator('.msg.resposta').last().innerText();
    ok('FARMA IA (ações diretas): depois de "Confirmar", a FARMA responde com uma mensagem de sucesso', ultimaMsg.length > 0, ultimaMsg);

    const estadoRes = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
    const estado = JSON.parse(estadoRes.body);
    const pedidoCriado = (estado.manipulados || []).find(p => p.nome === 'Ana Costa' && /minoxidil/i.test(p.medicamento || ''));
    ok('FARMA IA (ações diretas): o pedido de manipulado ficou mesmo gravado no servidor (estado.manipulados)', !!pedidoCriado, JSON.stringify(pedidoCriado));

    // ---------- 2. parâmetro obrigatório em falta -> pede esclarecimento, nunca inventa ----------
    await page.fill('#inputPergunta', 'cria um pedido de manipulado para o Carlos Mendes');
    await page.click('#formPergunta button[type="submit"]');
    await page.waitForTimeout(500);
    const respostaIncompleta = await page.locator('.msg.resposta').last().innerText();
    const apareceuCartaoIndevido = await page.locator('.acao-card').count();
    ok('FARMA IA (ações diretas): falta o medicamento -> pede esclarecimento em vez de mostrar um cartão a adivinhar',
      /manipulado pedido|medicamento/i.test(respostaIncompleta) && !/não percebi/i.test(respostaIncompleta), respostaIncompleta);

    // o cartão da Ana Costa já foi removido do DOM ao confirmar (padrão
    // existente em mostrarCartaoAcao: card.remove() após executarAcaoConfirmada) —
    // por isso o esperado aqui é mesmo zero cartões, não um cartão "antigo" a mais.
    ok('FARMA IA (ações diretas): nenhum cartão de ação indevido apareceu para o pedido incompleto',
      apareceuCartaoIndevido === 0, `cartões visíveis: ${apareceuCartaoIndevido}`);

    ok('FARMA IA (ações diretas): módulo carrega e responde sem erros de consola/página', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }

  // ---------- 3. mini-chat (index.html) — o ponto de entrada que antes não tinha ação nenhuma ligada ----------
  {
    const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
    const erros = coletarErros(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);

    await page.click('.farma-mini-bolha');
    await page.waitForTimeout(300);
    ok('Mini-chat: a bolha abre o painel de conversa', await page.locator('.farma-mini-painel.aberto').count() === 1, '');

    await page.fill('.farma-mini-form input', 'cria um pedido de manipulado para a Beatriz Nunes, medicamento pomada de calêndula');
    await page.click('.farma-mini-form button[type="submit"]');
    await page.waitForTimeout(500);

    const cartaoMini = page.locator('.farma-mini-acao').last();
    const resumoMini = await cartaoMini.innerText().catch(() => '');
    ok('Mini-chat (ponto 46): um pedido de ação no mini-chat AGORA gera um cartão Confirmar/Cancelar (antes desta peça, o mini-chat nunca sequer reconhecia ações)',
      /Beatriz Nunes/.test(resumoMini) && /calêndula/i.test(resumoMini), resumoMini);

    await cartaoMini.locator('.confirmar').click();
    await page.waitForTimeout(600);
    const ultimaMsgMini = await page.locator('.farma-mini-msg.resposta').last().innerText();
    ok('Mini-chat: depois de "Confirmar", responde com uma mensagem de sucesso', ultimaMsgMini.length > 0, ultimaMsgMini);

    const estadoRes2 = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
    const estado2 = JSON.parse(estadoRes2.body);
    const pedidoCriadoMini = (estado2.manipulados || []).find(p => p.nome === 'Beatriz Nunes');
    ok('Mini-chat: o pedido criado a partir da bolha ficou mesmo gravado no servidor', !!pedidoCriadoMini, JSON.stringify(pedidoCriadoMini));

    // pergunta normal (Q&A) continua a funcionar exatamente como antes, sem ser confundida com uma ação
    await page.fill('.farma-mini-form input', 'quantos utentes tenho no pim');
    await page.click('.farma-mini-form button[type="submit"]');
    await page.waitForTimeout(500);
    const respostaQA = await page.locator('.farma-mini-msg.resposta').last().innerText();
    // o cartão da Beatriz já foi removido do DOM ao confirmar (mesmo padrão
    // de mostrarCartaoAcao referido acima) — uma pergunta normal não deve
    // criar nenhum cartão novo, por isso o esperado é zero.
    ok('Mini-chat: uma pergunta normal continua a responder normalmente (não é tratada como ação)',
      /utente/i.test(respostaQA) && await page.locator('.farma-mini-acao').count() === 0, respostaQA);

    ok('Mini-chat: nenhum erro de página/consola durante todo o percurso', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }

  // ---------- 4. ponto 46: nome personalizado da assistente ----------
  {
    const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
    const erros = coletarErros(page);
    await page.goto(`${BASE}/modulos/farma-ia.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(600);

    await page.click('#btnEditarNomeAssistente');
    await page.fill('#inputNomeAssistente', 'Sofia');
    await page.click('#btnGuardarNomeAssistente');
    await page.waitForTimeout(400);
    const tituloVisivel = await page.locator('#tituloAssistenteNome').innerText();
    ok('Nome da assistente: o título do módulo reflete o nome escolhido', tituloVisivel === 'Sofia', tituloVisivel);

    const estadoRes3 = await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } });
    const estado3 = JSON.parse(estadoRes3.body);
    ok('Nome da assistente: ficou gravado no servidor (config.farmaNomeAssistente)', estado3.config?.farmaNomeAssistente === 'Sofia', estado3.config?.farmaNomeAssistente);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    const saudacao = await page.locator('.msg.resposta').first().innerText();
    ok('Nome da assistente: a saudação ao reabrir o módulo já usa o nome novo', /Sofia/.test(saudacao), saudacao);

    ok('Nome da assistente: nenhum erro de página/consola', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }
}
