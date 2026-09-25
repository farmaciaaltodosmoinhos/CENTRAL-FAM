/**
 * Testes e2e do módulo Conversor/Fusão de PDF — "DocConvert Pro"
 * (modulos/conversor-pdf.html).
 *
 * Módulo sem estado próprio a gravar (não lê/grava /api/data, nem
 * branding — confirmado no HTML: não há qualquer referência a
 * config.nomeFarmacia/logo neste módulo). Depende de duas bibliotecas de
 * terceiros carregadas por CDN (pdf.js e JSZip); este ambiente de testes
 * não tem acesso à rede externa (política do sandbox), o que é exatamente
 * o cenário que o próprio módulo já trata de forma graciosa para o pdf.js
 * — por isso testamos aqui essa mensagem de aviso a sério, e testamos a
 * fusão de documentos de texto (.txt), que não depende de nenhuma das
 * duas bibliotecas externas, incluindo o CONTEÚDO real do ficheiro fundido
 * (não só o ecrã de sucesso).
 *
 * Farmácia de teste sempre criada com signupFarmacia(), nunca partilhada
 * com outros ficheiros de tests/e2e/modules/.
 */
import { BASE, ok, apiFetch, viewports, novaPaginaComSessao, signupFarmacia, coletarErros } from '../helpers.mjs';

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
  return dia['conversor-pdf.' + tarefa] || 0;
}

export async function run(browser) {
  const { token, perfil } = await signupFarmacia('ConvPdfQA');
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  const erros = coletarErros(page);
  page.on('download', (d) => d.cancel().catch(() => {}));
  await page.addInitScript(() => {
    window.__blobsCapturados = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { window.__blobsCapturados.push(b); return orig(b); };
  });
  await page.goto(`${BASE}/modulos/conversor-pdf.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(600);

  // ---------- 1. Aviso gracioso quando o pdf.js do CDN não carrega (sem rede externa neste ambiente) ----------
  const pdfjsCarregou = await page.evaluate(() => typeof window.pdfjsLib !== 'undefined');
  const avisoTexto = await page.locator('body > div', { hasText: 'Não foi possível carregar a biblioteca de conversão de PDF' }).count();
  ok('Conversor PDF: quando o pdf.js do CDN não carrega, mostra um aviso claro em vez de rebentar a página',
    !pdfjsCarregou && avisoTexto === 1, JSON.stringify({ pdfjsCarregou, avisoTexto }));

  // ---------- 2. Alternar entre separadores "Converter" e "Fundir" ----------
  await page.click('#t-merge');
  await page.waitForTimeout(100);
  const splitEscondido = await page.locator('#p-split').evaluate(el => !el.classList.contains('on'));
  const mergeVisivel = await page.locator('#p-merge').evaluate(el => el.classList.contains('on'));
  ok('Conversor PDF: separador "Fundir em Documento" mostra o painel correto e esconde o de conversão', splitEscondido && mergeVisivel);

  // ---------- 3. Selecionar ficheiros para fusão + remover um em concreto ----------
  const conteudoA = 'Conteúdo do arquivo A.\nSegunda linha A.';
  const conteudoB = 'Conteúdo do arquivo B.';
  const conteudoC = 'Conteúdo do arquivo C, diferente.';
  await page.setInputFiles('#p-merge input[type=file]', [
    { name: 'arquivo-a.txt', mimeType: 'text/plain', buffer: Buffer.from(conteudoA, 'utf8') },
    { name: 'arquivo-b.txt', mimeType: 'text/plain', buffer: Buffer.from(conteudoB, 'utf8') }
  ]);
  await page.waitForTimeout(150);
  const itensApós2 = await page.locator('#m-list .fitem').count();
  const btnHabilitadoCom2 = await page.locator('#btn-m').isEnabled();

  await page.locator('#m-list .fitem', { hasText: 'arquivo-a.txt' }).locator('.frm').click();
  await page.waitForTimeout(150);
  await page.setInputFiles('#p-merge input[type=file]', [{ name: 'arquivo-c.txt', mimeType: 'text/plain', buffer: Buffer.from(conteudoC, 'utf8') }]);
  await page.waitForTimeout(150);
  const nomesFinais = await page.locator('#m-list .fn').allInnerTexts();
  ok('Conversor PDF: remover um ficheiro específico da lista remove exatamente esse (não outro), e a lista/botão refletem sempre o conteúdo real',
    itensApós2 === 2 && btnHabilitadoCom2 && nomesFinais.length === 2 && nomesFinais[0] === 'arquivo-b.txt' && nomesFinais[1] === 'arquivo-c.txt',
    JSON.stringify({ itensApós2, btnHabilitadoCom2, nomesFinais }));

  // ---------- 4. Escolher formato de saída "TXT" (não depende de pdf.js/JSZip) ----------
  await page.click('#p-merge .fc:has-text("TXT")');
  await page.waitForTimeout(100);
  const pdfDeixouDeEstarOn = await page.locator('#p-merge .fc:has-text("PDF")').first().evaluate(el => !el.classList.contains('on'));
  const txtEstaOn = await page.locator('#p-merge .fc:has-text("TXT")').evaluate(el => el.classList.contains('on'));
  const infoTxt = await page.locator('#m-info').innerText();
  ok('Conversor PDF: escolher o formato "TXT" destaca só essa opção e atualiza a descrição', pdfDeixouDeEstarOn && txtEstaOn && infoTxt.includes('TXT'), infoTxt);

  // ---------- 5. Fusão real de 2 ficheiros .txt (funciona mesmo sem pdf.js/JSZip) + conteúdo correto ----------
  await page.click('#btn-m');
  await page.waitForTimeout(600);
  const dlVisivel = await page.locator('#m-dl.on').count();
  const resumoFusao = await page.locator('#m-dlsub').innerText();
  ok('Conversor PDF: fundir 2 ficheiros de texto em TXT conclui com sucesso e mostra o resumo correto (2 ficheiros)',
    dlVisivel === 1 && resumoFusao.includes('2 ficheiro(s) fundido(s)'), resumoFusao);

  await page.click('#m-dlbtn');
  await page.waitForTimeout(200);
  const conteudoFundido = await page.evaluate(async () => {
    const blobs = window.__blobsCapturados;
    const ultimo = blobs[blobs.length - 1];
    return ultimo ? await ultimo.text() : null;
  });
  ok('Conversor PDF: o ficheiro fundido contém o texto real de cada ficheiro, na ordem correta, com o separador entre secções',
    !!conteudoFundido && conteudoFundido.includes('arquivo-b.txt') && conteudoFundido.includes(conteudoB) &&
    conteudoFundido.includes('arquivo-c.txt') && conteudoFundido.includes(conteudoC) &&
    conteudoFundido.indexOf('arquivo-b.txt') < conteudoFundido.indexOf('arquivo-c.txt') &&
    !conteudoFundido.includes('arquivo-a.txt'),
    conteudoFundido ? conteudoFundido.slice(0, 200) : 'null');

  // ---------- 6. Registo de uso: tarefa genérica + tarefa específica de "fundir_documentos" (formato não-zip/imagem) ----------
  await page.waitForTimeout(2600); // dá tempo ao debounce (2s) + flush de registarUso (uso-AAAA-MM)
  const usoConverter = await contagemUso(token, 'converter_ficheiro');
  const usoFundir = await contagemUso(token, 'fundir_documentos');
  ok('Conversor PDF: fundir em TXT regista as tarefas de uso corretas ("converter_ficheiro" + "fundir_documentos"), cada uma exatamente uma vez',
    usoConverter === 1 && usoFundir === 1, JSON.stringify({ usoConverter, usoFundir }));

  // ---------- 7. "Nova Fusão" repõe o painel de fusão ao estado inicial ----------
  await page.click('#m-dl button:has-text("Nova Fusão")');
  await page.waitForTimeout(150);
  const mlCardEscondido = await page.locator('#ml-card').isHidden();
  const mdlEscondido = await page.locator('#m-dl.on').count();
  const btnDesabilitado = await page.locator('#btn-m').isDisabled();
  ok('Conversor PDF: "Nova Fusão" repõe a lista de ficheiros e o ecrã de sucesso ao estado inicial',
    mlCardEscondido && mdlEscondido === 0 && btnDesabilitado, JSON.stringify({ mlCardEscondido, mdlEscondido, btnDesabilitado }));

  // ---------- 8. Separador "Converter Documentos": adicionar ficheiro habilita o botão de conversão ----------
  await page.click('#t-split');
  await page.waitForTimeout(100);
  await page.setInputFiles('#p-split input[type=file]', { name: 'imagem-teste.txt', mimeType: 'text/plain', buffer: Buffer.from('conteúdo qualquer', 'utf8') });
  await page.waitForTimeout(150);
  const btnConverterHabilitado = await page.locator('#btn-s').isEnabled();
  const itemNaListaConversao = await page.locator('#s-list .fitem').count();
  ok('Conversor PDF: adicionar um ficheiro no separador de conversão mostra-o na lista e habilita "Iniciar Conversão"',
    btnConverterHabilitado && itemNaListaConversao === 1);

  ok('Conversor PDF: módulo carrega sem erros de consola/página inesperados', erros.length === 0, erros.join(' | '));

  await ctx.close();
}
