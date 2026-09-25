/**
 * Script de reprodução (não faz parte da bateria oficial) — ponto 58.
 *
 * Hipótese confirmada: `recarregarDoServidor()` substitui SEMPRE o estado
 * local inteiro pelo que vier do servidor. O botão "Atualizar" (btnRefresh)
 * chama-o sem NENHUMA proteção de syncStatus. Se for clicado durante a
 * janela de "escrita pendente" de um serviço acabado de criar (debounce de
 * 350ms + viagem de rede até ao servidor), o serviço desaparece da UI — e,
 * pior, a gravação (já agendada, 350ms depois da criação) acaba por gravar
 * o estado JÁ SEM o serviço, perdendo-o também no servidor. Tudo isto numa
 * ÚNICA aba/computador, sem nenhuma concorrência entre abas envolvida —
 * diferente do bug do ponto 57 (já corrigido), mas com o mesmo sintoma
 * visível: "crio um serviço, vejo-o durante uns segundos e depois
 * desaparece".
 *
 * Nota sobre os cliques: usa `element.click()` diretamente no DOM (via
 * page.evaluate), em vez de `page.click()` do Playwright — o `page.click()`
 * espera pela "actionability" do elemento (estabilidade visual depois de o
 * modal fechar), o que sozinho já chegava para ultrapassar a janela de
 * 350ms e escondia o bug por completo. Um clique real de rato não tem essa
 * espera.
 *
 * Cenário:
 *  1. signup novo
 *  2. cria um serviço via UI (Configurações → Serviços → Adicionar)
 *  3. fecha o modal e clica em "Atualizar" imediatamente a seguir — exatamente
 *     o que um utilizador cauteloso faria para "confirmar que gravou"
 *  4. verifica se o serviço continua visível (usa a pesquisa, porque o
 *     ecrã inicial ("home") mostra categorias, não os cartões dos serviços)
 *     e se continua a existir no servidor depois de tudo assentar.
 */
import { launchBrowser, BASE, ok, apiFetch, novaPaginaComSessao, signupFarmacia, viewports, coletarErros } from './helpers.mjs';

const NOME = 'Serviço Repro Refresh';

async function contarNaPesquisa(page) {
  await page.evaluate((nome) => {
    const el = document.getElementById('searchInput');
    el.value = nome;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'Repro Refresh');
  await page.waitForTimeout(400); // debounce de 120ms do campo de pesquisa + render
  const n = await page.locator(`.card-servico:has-text("${NOME}")`).count();
  await page.evaluate(() => {
    const el = document.getElementById('searchInput');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  return n;
}

async function main() {
  const browser = await launchBrowser();
  const { token, perfil } = await signupFarmacia('ReproRefresh');
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewports.desktop);
  const erros = coletarErros(page);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1000); // deixa o iniciar() inicial (e o seeding de atalhos) assentar

  // 2. cria um serviço via UI
  await page.click('#btnNovoServico');
  await page.waitForTimeout(200);
  await page.fill('#servicoNome', NOME);
  await page.fill('#servicoUrl', 'https://exemplo.pt');

  // 3. clique real, imediato, no DOM — Guardar, fechar modal, Atualizar,
  // tudo em sequência sem esperas artificiais pelo meio.
  await page.evaluate(() => {
    document.getElementById('btnSalvarServico').click();
    document.getElementById('btnFecharConfig').click();
    document.getElementById('btnRefresh').click();
  });
  await page.waitForTimeout(2000); // dá tempo a tudo (recarregarDoServidor + o flush agendado) completar

  const contagemDepoisDoRefresh = await contarNaPesquisa(page);
  ok('repro/ponto58: serviço CONTINUA visível depois de "Atualizar" clicado logo a seguir a criar',
    contagemDepoisDoRefresh > 0, `contagem=${contagemDepoisDoRefresh}`);

  // 4. confirma também no servidor, depois de tudo assentar
  await page.waitForTimeout(500);
  const dataServidor = JSON.parse((await apiFetch('/api/data', { headers: { Authorization: `Bearer ${token}` } })).body);
  const existeNoServidor = (dataServidor.servicos || []).some(s => s.nome === NOME);
  ok('repro/ponto58: serviço existe no servidor depois de tudo assentar (não é perdido para sempre)', existeNoServidor, JSON.stringify((dataServidor.servicos || []).map(s => s.nome)));

  console.log('Erros de página/consola capturados:', erros);

  await ctx.close();
  await browser.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
