/**
 * Testes e2e do módulo MAPA 48h Cardiovascular (modulos/mapa-cardiovascular.html).
 *
 * Módulo sem estado próprio a gravar — gera um documento de 6 páginas
 * (requisição, 2 páginas de consentimento informado, declaração de
 * responsabilidade, 2 páginas de instruções) a partir de dados fixos +
 * identidade da farmácia. Cobre: nome da farmácia aparece corretamente em
 * TODOS os pontos do documento onde é referida (declaração + as duas
 * frases "farmacia-nome-inline"), o logótipo real da farmácia propaga-se
 * corretamente às 3 imagens de logótipo do documento (harmonização de
 * marca, ponto 17 da arquitetura — um bug de sincronização aqui
 * significaria um documento legal/clínico impresso com logótipos
 * inconsistentes), a integridade estrutural do documento de 6 páginas, e
 * o registo de uso ao gerar/imprimir.
 *
 * Farmácia de teste sempre criada com signupFarmacia(), nunca partilhada
 * com outros ficheiros de tests/e2e/modules/.
 */
import { BASE, ok, apiFetch, fakeLogoBase64, viewports, novaPaginaComSessao, signupFarmacia, coletarErros } from '../helpers.mjs';

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
  return dia['mapa-cardiovascular.' + tarefa] || 0;
}

export async function run(browser) {
  const { token, tenantId, email, nomeFarmacia } = await signupFarmacia('MapaCVQA');
  const logo = fakeLogoBase64(50);
  await apiFetch('/api/asset/branding-logo', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: logo }) });

  const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
  const erros = coletarErros(page);
  await page.addInitScript(() => { window.__printChamadas = 0; const orig = window.print; window.print = function () { window.__printChamadas++; return orig ? orig.call(window) : undefined; }; });
  await page.goto(`${BASE}/modulos/mapa-cardiovascular.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(800); // dá tempo à leitura assíncrona de branding + logótipo (asset)

  // ---------- 1. Nome da farmácia em todos os pontos do documento onde é referida ----------
  const declNome = await page.locator('#declNomeFarmacia').innerText();
  const nomesInline = await page.locator('.farmacia-nome-inline').allInnerTexts();
  ok('MAPA CV: nome real da farmácia aparece na declaração de responsabilidade e nas duas referências dentro do texto',
    declNome === nomeFarmacia && nomesInline.length === 2 && nomesInline.every(t => t === nomeFarmacia),
    JSON.stringify({ declNome, nomesInline }));

  // ---------- 2. Logótipo real da farmácia propaga-se às 3 imagens do documento ----------
  const srcs = await page.locator('#brandLogoImg1, #brandLogoImg2, #brandLogoImg3').evaluateAll(imgs => imgs.map(i => i.src));
  ok('MAPA CV: logótipo real da farmácia (asset) aparece nas 3 páginas onde é mostrado, todas em sincronia',
    srcs.length === 3 && srcs.every(s => s === logo), `logótipos corretos: ${srcs.filter(s => s === logo).length}/3`);

  // ---------- 3. Integridade estrutural: documento tem exatamente as 6 páginas esperadas ----------
  const numPaginas = await page.locator('.page').count();
  ok('MAPA CV: documento gerado tem exatamente as 6 páginas do modelo (requisição, 2× consentimento, declaração, 2× instruções)',
    numPaginas === 6, `páginas=${numPaginas}`);

  // ---------- 4. "Imprimir" chama window.print() e regista o uso exatamente uma vez ----------
  const usoAntes = await contagemUso(token, 'gerar_mapa');
  await page.click('.print-btn');
  await page.waitForTimeout(2600);
  const printChamadas = await page.evaluate(() => window.__printChamadas);
  const usoDepois = await contagemUso(token, 'gerar_mapa');
  ok('MAPA CV: "Imprimir" chama window.print() e regista a tarefa de uso "gerar_mapa" exatamente uma vez',
    printChamadas === 1 && (usoDepois - usoAntes) === 1, JSON.stringify({ printChamadas, usoAntes, usoDepois }));

  ok('MAPA CV: módulo carrega sem erros de consola/página', erros.length === 0, erros.join(' | '));

  await ctx.close();
}
