/**
 * Multi-idioma (ponto 24) — cobertura e2e real (browser), focada no que os
 * testes unitários de tests/i18n.test.js não conseguem verificar sozinhos
 * (esses cobrem o dicionário/motor "no papel"; isto confirma que a Central a
 * sério, no browser, muda de facto de idioma e que a escolha sobrevive):
 *
 *  1. Mudar o idioma em Configurações → Geral atualiza a UI visível de
 *     imediato (sem reload).
 *  2. A escolha persiste depois de um reload da página (config.idioma vai
 *     mesmo para o servidor e volta a ser lida no arranque).
 *  3. O seletor de idioma no ato de criação de conta (signup) é honrado:
 *     uma farmácia nova criada com espanhol escolhido arranca já em
 *     espanhol, sem precisar de ir a Configurações mudar nada.
 *
 * Nota de âmbito (consistente com o resto desta sessão): esta bateria testa
 * a shell central (index.html) — a cobertura de tradução dos 13 módulos
 * standalone (modulos/*.html) fica fora deste ponto, ver arquitetura-
 * decisoes.md (ponto 24) para o plano de rollout.
 */
import { BASE, ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports } from '../helpers.mjs';

export async function run(browser) {
  // ---------- 1. mudar idioma em Configurações → Geral atualiza a UI de imediato ----------
  {
    const { token, perfil } = await signupFarmacia('I18n1');
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);

    const textoAntes = (await page.locator('#btnAbrirConfig').innerText()).trim();
    ok('i18n: botão "Configurações" começa em português (pt é o idioma por omissão)', /Configura/i.test(textoAntes), textoAntes);

    await page.click('#btnAbrirConfig');
    await page.waitForTimeout(300);
    await page.selectOption('#idiomaSelect', 'en');
    await page.waitForTimeout(500);

    const tituloModalEn = (await page.locator('#modalConfig h2').innerText()).trim();
    ok('i18n: mudar o seletor de idioma para "en" traduz o título do modal de imediato (sem reload)',
      /Settings/i.test(tituloModalEn), tituloModalEn);

    const tabGeralEn = (await page.locator('#modalConfig .modal-tab[data-tab="geral"]').innerText()).trim();
    ok('i18n: o separador "Geral" muda para "General" de imediato', tabGeralEn === 'General', tabGeralEn);

    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    ok('i18n: <html lang> é atualizado para "en"', htmlLang === 'en', htmlLang);

    await ctx.close();
  }

  // ---------- 2. a escolha de idioma persiste depois de um reload ----------
  {
    const { token, perfil } = await signupFarmacia('I18n2');
    const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click('#btnAbrirConfig');
    await page.waitForTimeout(300);
    await page.selectOption('#idiomaSelect', 'fr');
    await page.waitForTimeout(800); // dá tempo ao PUT /api/data (setConfig) completar

    const configNoServidor = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body).config;
    ok('i18n: setIdioma() grava "fr" em config.idioma no servidor', configNoServidor?.idioma === 'fr', JSON.stringify(configNoServidor?.idioma));

    await page.reload({ waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1000);

    const textoDepoisReload = (await page.locator('#btnAbrirConfig').innerText()).trim();
    ok('i18n: depois de um reload, a Central arranca já em francês (config.idioma foi lido no arranque)',
      /Param/i.test(textoDepoisReload), textoDepoisReload);

    const seletorDepoisReload = await page.locator('#idiomaSelect').inputValue().catch(async () => {
      await page.click('#btnAbrirConfig');
      await page.waitForTimeout(300);
      return page.locator('#idiomaSelect').inputValue();
    });
    ok('i18n: o seletor de idioma em Configurações mostra "fr" selecionado após o reload', seletorDepoisReload === 'fr', seletorDepoisReload);

    await ctx.close();
  }

  // ---------- 3. seletor de idioma no signup é honrado (conta nova arranca já traduzida) ----------
  {
    // Sem sessão prévia (ao contrário dos outros blocos): queremos mesmo
    // passar pelo formulário de criação de conta no login-gate, por isso não
    // usamos novaPaginaComSessao() aqui (que pré-preenche o token/perfil).
    const ctx = await browser.newContext({ viewport: viewports.desktop });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(600);

    await page.click('#loginTabs [data-tab="signup"]');
    await page.waitForTimeout(200);

    const emailNovo = `qa-i18n-signup-${Date.now()}@x.pt`;
    await page.fill('#signupNomeFarmacia', 'Farmácia QA i18n Signup');
    await page.fill('#signupEmail', emailNovo);
    await page.fill('#signupPassword', 'password123');
    await page.selectOption('#signupIdioma', 'es');
    await page.click('#signupSubmit');
    await page.waitForTimeout(1500);

    const textoConfigEs = (await page.locator('#btnAbrirConfig').innerText().catch(() => '')).trim();
    ok('i18n: uma conta nova criada com "es" escolhido no signup arranca já em espanhol (sem passar por Configurações)',
      /Configuraci/i.test(textoConfigEs), textoConfigEs);

    const htmlLangEs = await page.evaluate(() => document.documentElement.lang);
    ok('i18n: <html lang> da conta nova é "es" logo após o signup', htmlLangEs === 'es', htmlLangEs);

    const dataRes = JSON.parse((await apiFetch('/api/data', {
      headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('central_saas_token'))}` }
    })).body);
    ok('i18n: config.idioma="es" foi persistido no servidor logo a seguir ao signup', dataRes?.config?.idioma === 'es', JSON.stringify(dataRes?.config?.idioma));

    await ctx.close();
  }
}
