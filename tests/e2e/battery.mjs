/**
 * Orquestrador da bateria de testes end-to-end — corre contra o
 * local-server.mjs (funções reais + Blobs em memória), usando o Chromium
 * pré-instalado via Playwright.
 *
 * A partir da expansão de 2026-09-12 ("aumentar o número de testes ao
 * máximo"), a bateria deixou de ser um único ficheiro monolítico: cada
 * módulo/ferramenta da Central ganhou o seu próprio ficheiro de testes em
 * tests/e2e/modules/<NN>-<nome>.mjs, cada um exportando
 * `export async function run(browser) { ... }`. Isto permite adicionar
 * cobertura módulo a módulo sem qualquer risco de conflito entre ficheiros.
 * Este ficheiro só descobre os módulos de teste (ordem alfabética/numérica
 * do nome do ficheiro), corre cada um contra o mesmo browser partilhado, e
 * imprime o resumo final agregado (contagem global de ✅/❌ de todos os
 * ficheiros juntos).
 *
 * tests/e2e/modules/00-core.mjs contém o conteúdo histórico original desta
 * bateria (bug de desempenho do logótipo, smoke-test dos 13 módulos em 3
 * larguras, criar utente em PIM, Poupança & ROI, GS1/DataMatrix).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { results, launchBrowser } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.join(__dirname, 'modules');

async function main() {
  const ficheiros = fs.readdirSync(MODULES_DIR)
    .filter(f => f.endsWith('.mjs'))
    .sort(); // "00-core.mjs" < "01-pim.mjs" < ... — ordem determinística

  const browser = await launchBrowser();

  for (const ficheiro of ficheiros) {
    const inicio = results.pass.length + results.fail.length;
    console.log(`\n--- ${ficheiro} ---`);
    try {
      const mod = await import(path.join(MODULES_DIR, ficheiro));
      if (typeof mod.run !== 'function') {
        console.log(`⚠️  ${ficheiro} não exporta run(browser) — ignorado`);
        continue;
      }
      await mod.run(browser);
    } catch (e) {
      console.log(`❌ ERRO FATAL em ${ficheiro}: ${e.stack || e.message}`);
      results.fail.push({ name: `${ficheiro} (erro fatal, ficheiro interrompido)`, detail: e.message });
    }
    const fim = results.pass.length + results.fail.length;
    console.log(`(${ficheiro}: ${fim - inicio} verificações)`);
  }

  await browser.close();

  console.log(`\n===== RESUMO: ${results.pass.length} passaram, ${results.fail.length} falharam (total: ${results.pass.length + results.fail.length}) =====`);
  if (results.fail.length) {
    console.log('\nFALHAS:');
    results.fail.forEach(f => console.log(' -', f.name, f.detail));
    process.exitCode = 1;
  }
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
