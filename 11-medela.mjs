/**
 * Testes e2e do módulo Contrato de Aluguer — Medela Symphony (modulos/medela.html).
 *
 * Módulo sem estado próprio a gravar (só lê /api/data e o asset do
 * logótipo ao arrancar, para pré-preencher a identidade da farmácia).
 * Cobre: nome/logótipo da farmácia (harmonização de marca, ponto 17 da
 * arquitetura), pré-preenchimento de morada/email a partir de
 * `config.morada`/`config.emailContacto` — incluindo a regra específica
 * deste módulo de NUNCA substituir texto que o utilizador já tenha editado
 * à mão no documento (mesmo que a leitura do estado ainda esteja em
 * curso) —, o campo fixo do modelo do equipamento, e o registo de uso ao
 * gerar o contrato.
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
  return dia['medela.' + tarefa] || 0;
}
async function gravarConfig(token, config) {
  await apiFetch('/api/data', {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ servicos: [], categorias: [], config })
  });
}

export async function run(browser) {
  // ---------- 1. Sem config.morada/email: nome vem do perfil, placeholders ficam intactos ----------
  {
    const { token, tenantId, email, nomeFarmacia } = await signupFarmacia('MedelaQASemCfg');
    const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
    const erros = coletarErros(page);
    await page.goto(`${BASE}/modulos/medela.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(700);
    const introNome = await page.locator('#introNomeFarmacia').innerText();
    const footerNome = await page.locator('#footerNomeFarmacia').innerText();
    const introMorada = await page.locator('#introMorada').innerText();
    const footerEmail = await page.locator('#footerEmail').innerText();
    ok('Medela: sem configuração de morada/email, nome da farmácia vem do perfil e os campos ficam com o texto de exemplo original',
      introNome === nomeFarmacia && footerNome === nomeFarmacia &&
      introMorada === 'morada da farmácia (clique para editar)' && footerEmail === 'email da farmácia',
      JSON.stringify({ introNome, footerNome, introMorada, footerEmail }));
    ok('Medela: módulo carrega sem erros de consola/página', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }

  // ---------- 2. Com config completa + logótipo: pré-preenchimento correto ----------
  let tokenCfg, nomeFarmaciaCfg, logo;
  {
    const sig = await signupFarmacia('MedelaQAComCfg');
    tokenCfg = sig.token; nomeFarmaciaCfg = sig.nomeFarmacia;
    logo = fakeLogoBase64(50);
    await apiFetch('/api/asset/branding-logo', { method: 'PUT', headers: { Authorization: `Bearer ${tokenCfg}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: logo }) });
    await gravarConfig(tokenCfg, { nomeFarmacia: nomeFarmaciaCfg, morada: 'Rua das Flores, 123, 1000-100 Lisboa', emailContacto: 'geral@farmaciaqa.pt' });

    const { ctx, page } = await novaPaginaComSessao(browser, tokenCfg, sig.perfil, viewports.desktop);
    await page.goto(`${BASE}/modulos/medela.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    const introMorada = await page.locator('#introMorada').innerText();
    const footerMorada = await page.locator('#footerMorada').innerText();
    const footerEmail = await page.locator('#footerEmail').innerText();
    const logoSrc = await page.locator('#brandLogoImg').getAttribute('src');
    ok('Medela: config.morada/config.emailContacto pré-preenchem a morada (intro + rodapé) e o email de contacto',
      introMorada === 'Rua das Flores, 123, 1000-100 Lisboa' && footerMorada === 'Rua das Flores, 123, 1000-100 Lisboa' && footerEmail === 'geral@farmaciaqa.pt',
      JSON.stringify({ introMorada, footerMorada, footerEmail }));
    ok('Medela: logótipo real da farmácia (asset) aparece no cabeçalho do contrato', logoSrc === logo, `src length=${logoSrc?.length}`);
    await ctx.close();
  }

  // ---------- 3. Nunca substitui texto já editado pelo utilizador, mesmo com a leitura do estado ainda em curso ----------
  {
    const sig = await signupFarmacia('MedelaQAGuard');
    await gravarConfig(sig.token, { nomeFarmacia: sig.nomeFarmacia, morada: 'Rua Que Nunca Devia Aparecer, 999' });
    const { ctx, page } = await novaPaginaComSessao(browser, sig.token, sig.perfil, viewports.desktop);
    await page.route('**/api/data', async (route) => { await new Promise(r => setTimeout(r, 700)); await route.continue(); });
    await page.goto(`${BASE}/modulos/medela.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(120); // antes da resposta (atrasada) do /api/data chegar
    await page.evaluate(() => { document.getElementById('introMorada').textContent = 'Morada escrita à mão pelo utilizador'; });
    await page.waitForTimeout(900); // dá tempo à resposta atrasada chegar e aplicarBrandingFarmacia() correr de novo
    const introMoradaFinal = await page.locator('#introMorada').innerText();
    ok('Medela: editar a morada antes da resposta do servidor chegar nunca é substituído pelo valor de config.morada',
      introMoradaFinal === 'Morada escrita à mão pelo utilizador', introMoradaFinal);
    await ctx.close();
  }

  // ---------- 4. Modelo do equipamento é fixo (Medela Symphony) e não editável ----------
  {
    const { token, perfil } = await signupFarmacia('MedelaQAModelo');
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.goto(`${BASE}/modulos/medela.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(500);
    const modeloInput = page.locator('.field-input[readonly]');
    const modeloValor = await modeloInput.inputValue();
    const modeloReadonly = await modeloInput.getAttribute('readonly');
    ok('Medela: campo "Modelo" está fixo em "Medela Symphony" e é só-leitura (contrato não pode divergir do modelo)',
      modeloValor === 'Medela Symphony' && modeloReadonly !== null, modeloValor);
    await ctx.close();
  }

  // ---------- 5. "Imprimir / PDF" chama window.print() e regista o uso exatamente uma vez ----------
  {
    const { token, perfil } = await signupFarmacia('MedelaQAUso');
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.addInitScript(() => { window.__printChamadas = 0; const orig = window.print; window.print = function () { window.__printChamadas++; return orig ? orig.call(window) : undefined; }; });
    await page.goto(`${BASE}/modulos/medela.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(500);
    const usoAntes = await contagemUso(token, 'gerar_contrato');
    await page.click('.print-btn');
    await page.waitForTimeout(2600);
    const printChamadas = await page.evaluate(() => window.__printChamadas);
    const usoDepois = await contagemUso(token, 'gerar_contrato');
    ok('Medela: "Imprimir / PDF" chama window.print() e regista a tarefa de uso "gerar_contrato" exatamente uma vez',
      printChamadas === 1 && (usoDepois - usoAntes) === 1, JSON.stringify({ printChamadas, usoAntes, usoDepois }));
    await ctx.close();
  }
}
