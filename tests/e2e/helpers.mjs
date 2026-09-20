/**
 * Auxiliares partilhados por toda a bateria e2e (battery.mjs + tests/e2e/modules/*.mjs).
 *
 * Desenhado para que cada ficheiro em modules/ possa ser escrito e corrido de
 * forma independente (um agente/sessão por ficheiro, sem conflitos entre si):
 * cada módulo chama `signupFarmacia()` para obter o seu próprio tenant de
 * teste isolado, usa o `browser` partilhado (passado pelo orquestrador) só
 * para abrir os seus próprios contextos/páginas, e regista os seus
 * resultados através de `ok()`, que escreve no array partilhado `results`
 * (para o resumo final ficar unificado) e imprime de imediato no ecrã.
 */
import http from 'node:http';

export const BASE = 'http://localhost:8888';
export const results = { pass: [], fail: [] };

export function ok(name, cond, detail) {
  (cond ? results.pass : results.fail).push({ name, detail: detail || '' });
  console.log((cond ? '✅' : '❌'), name, detail || '');
  return !!cond;
}

export async function apiFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const body = opts.body;
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Gera uma imagem base64 "realista" (grande, só para medir peso). */
export function fakeLogoBase64(kbSize) {
  const bytes = Buffer.alloc(Math.round(kbSize * 1024 * 0.73));
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  return 'data:image/png;base64,' + bytes.toString('base64');
}

export const MODULOS = [
  'pim', 'gabinete', 'documentos', 'aue', 'manipulados', 'stocks', 'devolucoes-armazenistas',
  'catalogo-produtos', 'devolucao-frio', 'mapa-cardiovascular', 'medela', 'reservas', 'conversor-pdf',
  'farma-ia'
];

export const viewports = { mobile: { width: 390, height: 844 }, tablet: { width: 800, height: 1100 }, desktop: { width: 1440, height: 900 } };

let _chromium;
export async function resolveChromium() {
  if (_chromium) return _chromium;
  try {
    ({ chromium: _chromium } = await import('playwright'));
  } catch {
    const pw = (await import('/home/claude/.npm-global/lib/node_modules/playwright/index.js')).default;
    _chromium = pw.chromium;
  }
  return _chromium;
}

import fs from 'node:fs';
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function launchBrowser() {
  const chromium = await resolveChromium();
  return chromium.launch({ executablePath: fs.existsSync(CHROMIUM_PATH) ? CHROMIUM_PATH : undefined, headless: true });
}

/** Nova página de browser com uma sessão (token+perfil) já em localStorage. */
export async function novaPaginaComSessao(browser, token, perfil, viewport = viewports.desktop) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(([t, p]) => {
    localStorage.setItem('central_saas_token', t);
    localStorage.setItem('central_saas_perfil', JSON.stringify(p));
  }, [token, perfil]);
  return { ctx, page };
}

/** Cria uma farmácia de teste nova (signup real via /api/auth/signup) e devolve token+perfil prontos a usar. */
export async function signupFarmacia(nomePrefixo = 'QA') {
  const email = `qa-${nomePrefixo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.pt`;
  const nomeFarmacia = `Farmácia ${nomePrefixo}`;
  const res = JSON.parse((await apiFetch('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeFarmacia, email, password: 'password123' })
  })).body);
  const perfil = { tenantId: res.tenantId, email, nomeFarmacia };
  return { token: res.token, tenantId: res.tenantId, email, nomeFarmacia, perfil };
}

/** Recolhe erros de página/consola de uma page já criada — usar antes de um page.goto(). */
export function coletarErros(page) {
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) erros.push('console.error: ' + msg.text()); });
  return erros;
}

/** Abre um módulo já com sessão válida (farmácia própria de teste) numa página desktop; devolve {ctx,page,erros}. */
export async function abrirModulo(browser, modulo, { prefixo = modulo, viewport = viewports.desktop } = {}) {
  const { token, perfil } = await signupFarmacia(prefixo);
  const { ctx, page } = await novaPaginaComSessao(browser, token, perfil, viewport);
  const erros = coletarErros(page);
  await page.goto(`${BASE}/modulos/${modulo}.html`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(500);
  return { ctx, page, erros, token, perfil };
}
