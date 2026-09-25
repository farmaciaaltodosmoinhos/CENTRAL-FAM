/**
 * Testes e2e do módulo Reservas (modulos/reservas.html).
 *
 * Este módulo não tem estado próprio a gravar no servidor (não faz nenhum
 * PUT a /api/data nem a /api/asset além do registo de uso partilhado) — é
 * um gerador de folha de reservas em PDF a partir de um ficheiro exportado
 * do Sifarma (CSV ou Excel). Por isso os testes aqui focam-se no que
 * PODE genuinamente falhar: o mapeamento de cabeçalhos variados do
 * ficheiro para os campos internos, a filtragem/ordenação/paginação da
 * pré-visualização (que é literalmente o que sai no PDF), e a
 * harmonização de marca (nome + logótipo da farmácia, ponto 17 da
 * arquitetura) na folha impressa.
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
  return dia['reservas.' + tarefa] || 0;
}

function todayLabelPT() {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

const CSV_SIFARMA = [
  'Nº Reserva;Cliente;CNP;Designação;Qt. Reservada;Estado;Dt. Criação',
  '1001;João Silva;5601234567890;Ibuprofeno 400mg;2;RESERVADA;01/01/2026',
  '1002;Maria Santos;5609876543210;Paracetamol 500mg;3;RESERVADA;01/01/2026',
  '1003;Ana Costa;5605554443332;Vitamina C;5;ANULADA;01/01/2026'
].join('\n');

// 16 linhas RESERVADA, só para o teste de paginação (a opção mínima de
// "linhas por página" da UI é 15 — não existe opção "1" ou "2").
const CSV_PAGINACAO = [
  'Nº Reserva;Cliente;CNP;Designação;Qt. Reservada;Estado;Dt. Criação',
  ...Array.from({ length: 16 }, (_, i) => `${2000 + i};Cliente P${i + 1};560000000000${i};Produto Paginação ${String(i + 1).padStart(2, '0')};1;RESERVADA;01/01/2026`)
].join('\n');

export async function run(browser) {
  const { token, tenantId, email, nomeFarmacia } = await signupFarmacia('ReservasQA');
  const logo = fakeLogoBase64(50);
  await apiFetch('/api/asset/branding-logo', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: logo }) });

  const { ctx, page } = await novaPaginaComSessao(browser, token, { tenantId, email, nomeFarmacia }, viewports.desktop);
  const erros = coletarErros(page);
  await page.addInitScript(() => { window.__printChamadas = 0; const orig = window.print; window.print = function () { window.__printChamadas++; return orig ? orig.call(window) : undefined; }; });
  // Este sandbox de testes não tem acesso à rede externa (política do
  // ambiente — confirmado: cdnjs.cloudflare.com e registry.npmjs.org estão
  // ambos bloqueados), por isso o <script src="…papaparse…"> real do módulo
  // nunca chega a carregar. Para poder testar a lógica REAL do módulo
  // (mapeamento de cabeçalhos, filtragem, ordenação, paginação, marca) em
  // vez de nada, injeta-se aqui um Papa.parse mínimo mas fiel ao contrato
  // usado por reservas.html (file, {header, complete, error}) — o próprio
  // window.Papa fica definido antes do script real (bloqueado) tentar e
  // falhar em carregar, pelo que nunca é substituído.
  await page.addInitScript(() => {
    window.Papa = {
      parse(file, opts) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const texto = String(reader.result);
            const linhas = texto.split(/\r\n|\n|\r/).filter(l => l.length > 0);
            if (!linhas.length) { opts.complete({ data: [] }); return; }
            const delim = linhas[0].includes(';') ? ';' : ',';
            const cabecalhos = linhas[0].split(delim).map(h => h.trim());
            const data = linhas.slice(1).map(linha => {
              const celulas = linha.split(delim);
              const obj = {};
              cabecalhos.forEach((h, i) => { obj[h] = (celulas[i] !== undefined ? celulas[i] : '').trim(); });
              return obj;
            });
            opts.complete({ data });
          } catch (e) { if (opts.error) opts.error(e); else throw e; }
        };
        reader.onerror = () => { if (opts.error) opts.error(new Error('erro de leitura')); };
        reader.readAsText(file, opts.encoding || 'UTF-8');
      }
    };
  });
  await page.goto(`${BASE}/modulos/reservas.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(700); // dá tempo à leitura assíncrona de branding + logótipo (asset)

  // ---------- 1. Upload de CSV do Sifarma: cabeçalhos variados são mapeados corretamente ----------
  await page.setInputFiles('#fileInput', { name: 'reservas-sifarma.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_SIFARMA, 'utf8') });
  await page.waitForTimeout(400);
  const chipTexto = await page.locator('#fileStatus .file-chip').innerText().catch(() => '');
  ok('Reservas: ficheiro CSV é aceite e mostra confirmação com o nome do ficheiro', chipTexto.includes('reservas-sifarma.csv'), chipTexto);

  const statRows1 = await page.locator('#statRows').innerText();
  const statProducts1 = await page.locator('#statProducts').innerText();
  const linhasTabela1 = await page.locator('#previewInner table.res-table tbody tr').allInnerTexts();
  ok('Reservas: filtro "Apenas RESERVADA" (ligado por omissão) exclui o pedido ANULADO e ordena por produto (A–Z)',
    statRows1 === '2' && statProducts1 === '2' && linhasTabela1.length === 2 &&
    linhasTabela1[0].includes('Ibuprofeno') && linhasTabela1[1].includes('Paracetamol'),
    JSON.stringify({ statRows1, statProducts1, linhasTabela1 }));

  const temCNP = await page.locator('#previewInner .cnp-inline', { hasText: '5601234567890' }).count();
  ok('Reservas: CNP do ficheiro aparece junto à designação do produto', temCNP === 1);

  // ---------- 2. Desmarcar "Apenas reservada" revela outros estados ----------
  await page.click('#onlyReserved');
  await page.waitForTimeout(150);
  const statRows2 = await page.locator('#statRows').innerText();
  const temAnulado = await page.locator('#previewInner tbody tr', { hasText: 'Vitamina C' }).count();
  ok('Reservas: desmarcar "Apenas estado RESERVADA" revela também pedidos ANULADOS', statRows2 === '3' && temAnulado === 1, `statRows=${statRows2}`);

  // ---------- 3. Título editável reflete-se na folha impressa ----------
  await page.fill('#titleInput', 'Reservas de Teste QA — Turno da Tarde');
  await page.waitForTimeout(150);
  const tituloNaFolha = await page.locator('#previewInner .sh-title').first().innerText();
  ok('Reservas: título personalizado aparece na folha da pré-visualização (o que sai no PDF)', tituloNaFolha.includes('Reservas de Teste QA — Turno da Tarde'), tituloNaFolha);

  // ---------- 4. Paginação: nº de linhas por página determina o nº de páginas ----------
  // Novo ficheiro com 16 pedidos (todos RESERVADA) só para este teste — a
  // opção mínima de "linhas por página" da UI é 15, por isso precisamos de
  // mais de 15 linhas para provocar uma 2ª página.
  await page.click('#chipReset');
  await page.waitForTimeout(150);
  await page.setInputFiles('#fileInput', { name: 'reservas-paginacao.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_PAGINACAO, 'utf8') });
  await page.waitForTimeout(300);
  await page.selectOption('#rowsPerPage', '15');
  await page.waitForTimeout(150);
  const statPages = await page.locator('#statPages').innerText();
  const statRowsPag = await page.locator('#statRows').innerText();
  const rodapeUltimaPagina = await page.locator('#previewInner .sheet-foot').last().innerText();
  ok('Reservas: 16 pedidos com "15 por página" geram exatamente 2 páginas (16ª linha transborda para a página seguinte)',
    statRowsPag === '16' && statPages === '2' && /P.gina 2 de 2/.test(rodapeUltimaPagina),
    JSON.stringify({ statRowsPag, statPages, rodapeUltimaPagina }));
  await page.selectOption('#rowsPerPage', '0');
  await page.waitForTimeout(150);

  // ---------- 5. Orientação da folha (paisagem) ----------
  await page.selectOption('#orientationSelect', 'landscape');
  await page.waitForTimeout(150);
  const folhaLandscape = await page.locator('#previewInner .page-sheet.landscape').count();
  const larguraLandscape = await page.locator('#previewInner .page-sheet.landscape').first().evaluate(el => el.style.width);
  ok('Reservas: orientação "Paisagem" aplica folha A4 horizontal (297mm) na pré-visualização', folhaLandscape === 1 && larguraLandscape === '297mm', `width=${larguraLandscape}`);
  await page.selectOption('#orientationSelect', 'portrait');
  await page.waitForTimeout(150);

  // ---------- 6. Cores da tabela: alterar e repor a cor da marca ----------
  await page.evaluate(() => {
    const el = document.getElementById('headerColor');
    el.value = '#ff0000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const corAlterada = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tbl-header-bg').trim());
  await page.click('#btnResetColors');
  await page.waitForTimeout(150);
  const corHeaderApósReset = await page.inputValue('#headerColor');
  const corVarApósReset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tbl-header-bg').trim());
  ok('Reservas: "Repor cores da marca" restaura a cor de cabeçalho por omissão depois de alterada',
    corAlterada === '#ff0000' && corHeaderApósReset === '#1f543e' && corVarApósReset === '#1f543e',
    JSON.stringify({ corAlterada, corHeaderApósReset, corVarApósReset }));

  // ---------- 7. Harmonização de marca: nome e logótipo da farmácia na folha ----------
  await page.fill('#titleInput', 'Reservas de ' + todayLabelPT()); // qualquer alteração força um novo render() já com o logótipo carregado
  await page.waitForTimeout(200);
  // (a folha mostra o nome em maiúsculas por CSS/text-transform — puramente
  // visual; o que importa é que o TEXTO real corresponde à farmácia certa)
  const nomeNaFolha = await page.locator('#previewInner .sh-title small').first().innerText();
  const logoSrcNaFolha = await page.locator('#previewInner .sheet-head img').first().getAttribute('src');
  ok('Reservas: nome e logótipo reais da farmácia aparecem na folha impressa (harmonização de marca)',
    nomeNaFolha.toUpperCase() === nomeFarmacia.toUpperCase() && logoSrcNaFolha === logo,
    JSON.stringify({ nomeNaFolha, logoOk: logoSrcNaFolha === logo }));

  // ---------- 8. "Gerar PDF" chama window.print() e regista o uso exatamente uma vez ----------
  const usoAntes = await contagemUso(token, 'gerar_folha');
  await page.click('#btnPrint');
  await page.waitForTimeout(2600);
  const printChamadas = await page.evaluate(() => window.__printChamadas);
  const usoDepois = await contagemUso(token, 'gerar_folha');
  ok('Reservas: "Gerar PDF" chama window.print() e regista a tarefa de uso "gerar_folha" exatamente uma vez',
    printChamadas === 1 && (usoDepois - usoAntes) === 1, JSON.stringify({ printChamadas, usoAntes, usoDepois }));

  // ---------- 9. "Limpar ficheiro" repõe o estado vazio inicial ----------
  await page.click('#btnReset');
  await page.waitForTimeout(200);
  const emptyVisivel = await page.locator('#emptyPanel').isVisible();
  const controlsEscondido = await page.locator('#controlsPanel').isHidden();
  const statRowsFinal = await page.locator('#statRows').innerText();
  ok('Reservas: "Limpar ficheiro" repõe o painel vazio inicial e reinicia as estatísticas',
    emptyVisivel && controlsEscondido && statRowsFinal === '—', JSON.stringify({ emptyVisivel, controlsEscondido, statRowsFinal }));

  ok('Reservas: módulo carrega sem erros de consola/página', erros.length === 0, erros.join(' | '));

  await ctx.close();
}
