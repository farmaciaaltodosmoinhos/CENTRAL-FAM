/**
 * Testes e2e do módulo Declaração de Devolução de Produtos de Frio
 * (modulos/devolucao-frio.html — modelo Alliance Healthcare).
 *
 * Módulo sem estado próprio a gravar — cobre: o documento tem de bater
 * certo com o modelo oficial da Alliance Healthcare (título, sub-cabeçalho
 * "ALLIANCE HEALTHCARE", coluna "FACTURAS", código "COD.OPS.22B", frase
 * da faixa de temperatura 2°C–8°C), o nome da farmácia (só nome — este
 * modelo não usa logótipo, confirmado no HTML), as 10 linhas iniciais do
 * modelo e adicionar/remover linhas (incluindo remover exatamente a linha
 * certa, não outra), o limite de letra (9px–22px), e o registo de uso ao
 * gerar a declaração.
 *
 * Ponto 44/45: o auto-preenchimento por IA (upload de fatura + chave API da
 * Anthropic chamada diretamente do browser) foi removido a pedido explícito
 * do Ivo — violava a regra absoluta desta app de nunca usar IA externa. Os
 * testes que cobriam esse fluxo (botão "Carregar ficheiro", modal de upload,
 * aviso de chave em falta) foram removidos com ele; o preenchimento manual
 * dos campos, coberto pelas secções abaixo, continua exatamente igual.
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
  return dia['devolucao-frio.' + tarefa] || 0;
}

export async function run(browser) {
  const { token, tenantId, email, nomeFarmacia } = await signupFarmacia('DevFrioQA');
  const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
  const erros = coletarErros(page);
  await page.addInitScript(() => { window.__printChamadas = 0; const orig = window.print; window.print = function () { window.__printChamadas++; return orig ? orig.call(window) : undefined; }; });
  await page.goto(`${BASE}/modulos/devolucao-frio.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(600);

  // ---------- 1. O documento bate certo com o modelo oficial da Alliance Healthcare ----------
  const subTitulo = await page.locator('.sub-title').innerText();
  const cabecalho = await page.locator('.header-declaracao').innerText();
  const colFacturas = await page.locator('.th-fat').innerText();
  const codigo = await page.locator('.cod').innerText();
  const faixaTemp = await page.locator('.strip').innerText();
  ok('Devolução de Frio: documento mantém os elementos fixos do modelo oficial Alliance Healthcare (sub-cabeçalho, título, coluna, código, faixa 2°C–8°C)',
    subTitulo === 'ALLIANCE HEALTHCARE' && cabecalho.replace(/\s+/g, '') === 'DECLARAÇÃO' &&
    colFacturas === 'FACTURAS' && codigo === 'COD.OPS.22B' && faixaTemp.includes('2°C') && faixaTemp.includes('8°C'),
    JSON.stringify({ subTitulo, cabecalho, colFacturas, codigo }));

  // ---------- 2. Nome da farmácia (este modelo não mostra logótipo — só o nome, em maiúsculas) ----------
  const nomeRodape = await page.locator('#fnameFarmacia').innerText();
  ok('Devolução de Frio: nome real da farmácia aparece em maiúsculas no rodapé da declaração', nomeRodape === nomeFarmacia.toUpperCase(), nomeRodape);

  // ---------- 3. Modelo nasce com as 10 linhas originais do documento ----------
  const linhasIniciais = await page.locator('#tbody tr').count();
  ok('Devolução de Frio: documento nasce com as 10 linhas do modelo original', linhasIniciais === 10, `linhas=${linhasIniciais}`);

  // ---------- 4. Adicionar / remover linhas (incluindo remover exatamente a linha certa) ----------
  await page.click('.toolbar button:has-text("Adicionar linha")');
  await page.waitForTimeout(100);
  const após11 = await page.locator('#tbody tr').count();
  await page.click('.toolbar button:has-text("Remover última")');
  await page.waitForTimeout(100);
  const após10 = await page.locator('#tbody tr').count();

  await page.locator('#tbody tr').nth(2).locator('.inp-desig').fill('MARCADOR-LINHA-QA');
  await page.locator('#tbody tr').nth(2).locator('.del-btn').click();
  await page.waitForTimeout(100);
  const após9 = await page.locator('#tbody tr').count();
  const marcadorAindaExiste = await page.locator('#tbody tr', { hasText: 'MARCADOR-LINHA-QA' }).count();
  ok('Devolução de Frio: "+ Adicionar linha" / "− Remover última" ajustam o nº de linhas, e o botão ✕ de uma linha remove exatamente essa linha',
    após11 === 11 && após10 === 10 && após9 === 9 && marcadorAindaExiste === 0,
    JSON.stringify({ após11, após10, após9, marcadorAindaExiste }));

  // ---------- 5. Controlo de tamanho de letra: limitado entre 9px e 22px ----------
  const btnMenos = page.locator('.fs-ctrl button').first();
  const btnMais = page.locator('.fs-ctrl button').last();
  for (let i = 0; i < 10; i++) await btnMenos.click();
  const fsMin = await page.locator('#fsVal').innerText();
  for (let i = 0; i < 20; i++) await btnMais.click();
  const fsMax = await page.locator('#fsVal').innerText();
  ok('Devolução de Frio: tamanho de letra nunca desce abaixo de 9px nem sobe acima de 22px', fsMin === '9px' && fsMax === '22px', JSON.stringify({ fsMin, fsMax }));

  // ---------- 6. Ponto 44/45: o botão/modal de auto-preenchimento por IA (Anthropic direto do
  // browser) foi removido — confirma que não sobra nenhum vestígio na página. ----------
  const botaoIaAindaExiste = await page.locator('button:has-text("auto-preencher")').count();
  const modalUploadAindaExiste = await page.locator('#uploadZone').count();
  const campoApiKeyAindaExiste = await page.locator('#apiKeyInput').count();
  ok('Devolução de Frio: o auto-preenchimento por IA (chave Anthropic no browser) foi mesmo removido — sem botão, modal, ou campo de chave API',
    botaoIaAindaExiste === 0 && modalUploadAindaExiste === 0 && campoApiKeyAindaExiste === 0,
    JSON.stringify({ botaoIaAindaExiste, modalUploadAindaExiste, campoApiKeyAindaExiste }));

  // ---------- 7. "Imprimir" chama window.print() e regista o uso exatamente uma vez ----------
  const usoAntes = await contagemUso(token, 'gerar_declaracao');
  await page.click('.toolbar button:has-text("Imprimir")');
  await page.waitForTimeout(2600);
  const printChamadas = await page.evaluate(() => window.__printChamadas);
  const usoDepois = await contagemUso(token, 'gerar_declaracao');
  ok('Devolução de Frio: "Imprimir" chama window.print() e regista a tarefa de uso "gerar_declaracao" exatamente uma vez',
    printChamadas === 1 && (usoDepois - usoAntes) === 1, JSON.stringify({ printChamadas, usoAntes, usoDepois }));

  ok('Devolução de Frio: módulo carrega sem erros de consola/página', erros.length === 0, erros.join(' | '));

  await ctx.close();
}
