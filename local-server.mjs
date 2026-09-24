/**
 * Servidor local de integração — reproduz o comportamento do `netlify dev`
 * usando o MESMO código das funções reais (netlify/functions/*.js), mas
 * com um armazenamento em memória em vez do Netlify Blobs real. Não requer
 * a netlify-cli (bloqueada no registo do sandbox) nem rede — serve para
 * testes de ponta-a-ponta (Playwright) contra comportamento real de
 * auth/data/asset, incluindo tamanhos de payload e latência.
 *
 * Uso: node local-server.mjs [porta] [raizProjeto]
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.AUTH_JWT_SECRET = 'segredo-de-teste-bem-comprido-para-o-servidor-local-0123456789';
// Ponto 54 — conta fixa de teste e2e para o Painel Developer/Super-Admin.
process.env.SUPER_ADMIN_EMAILS = 'admin-e2e@teste.pt';

const PORT = Number(process.argv[2]) || 8888;
const ROOT = path.resolve(process.argv[3] || '/home/claude/central-operacional-saas');

const authFn = await import(path.join(ROOT, 'netlify/functions/auth.js'));
const dataFn = await import(path.join(ROOT, 'netlify/functions/data.js'));
const assetFn = await import(path.join(ROOT, 'netlify/functions/asset.js'));
const aprendizagensFn = await import(path.join(ROOT, 'netlify/functions/farma-aprendizagens.js'));

// --- armazenamento em memória, persistente durante a vida do processo ---
const stores = new Map();
function getStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const blobs = stores.get(name);
  return {
    async get(key, opts) {
      const v = blobs.get(key);
      if (v === undefined) return null;
      return v;
    },
    async setJSON(key, value) { blobs.set(key, value); },
    async set(key, value) { blobs.set(key, value); },
    async delete(key) { blobs.delete(key); },
    // Ponto 54 — subconjunto mínimo do `.list()` real do Netlify Blobs.
    async list(opts) {
      const prefix = (opts && opts.prefix) || "";
      return { blobs: [...blobs.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
    }
  };
}

// contadores globais de tráfego, para os testes de desempenho poderem medir
export const stats = { requests: [] };
globalThis.__localServerStats = stats;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', // farmaTreinoLocal.js importa scripts/*.mjs dinamicamente no browser (ponto 43)
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

async function serveStatic(urlPath, res) {
  let p = urlPath.split('?')[0];
  if (p === '/') p = '/index.html';
  let filePath = path.join(ROOT, decodeURIComponent(p));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    let data;
    try { data = await readFile(filePath); }
    catch { data = await readFile(filePath + '.html'); filePath += '.html'; } // mimica o comportamento de "serve" (extensionless -> .html)
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found: ' + filePath);
  }
}

function nodeReqToWebRequest(req, body) {
  const url = `http://localhost:${PORT}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) { if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v); }
  const init = { method: req.method, headers };
  if (body && body.length) init.body = body;
  return new Request(url, init);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function sendWebResponse(webRes, nodeRes) {
  const buf = Buffer.from(await webRes.arrayBuffer());
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  nodeRes.writeHead(webRes.status, headers);
  nodeRes.end(buf);
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    if (pathname.startsWith('/api/auth/')) {
      const acao = pathname.slice('/api/auth/'.length);
      const body = await readBody(req);
      const webReq = nodeReqToWebRequest(req, body);
      const webRes = await authFn.handleRequest(webReq, { params: { acao } }, getStore);
      await sendWebResponse(webRes, res);
    } else if (pathname === '/api/data') {
      const body = await readBody(req);
      const webReq = nodeReqToWebRequest(req, body);
      const webRes = await dataFn.handleRequest(webReq, getStore);
      stats.requests.push({ path: pathname, method: req.method, ms: Date.now() - t0, resBytes: Number(webRes.headers.get('content-length') || 0), reqBytes: body.length });
      await sendWebResponse(webRes, res);
    } else if (pathname.startsWith('/api/asset/')) {
      const key = decodeURIComponent(pathname.slice('/api/asset/'.length));
      const body = await readBody(req);
      const webReq = nodeReqToWebRequest(req, body);
      const webRes = await assetFn.handleRequest(webReq, { params: { key } }, getStore);
      stats.requests.push({ path: pathname, method: req.method, ms: Date.now() - t0, resBytes: Number(webRes.headers.get('content-length') || 0), reqBytes: body.length });
      await sendWebResponse(webRes, res);
    } else if (pathname === '/api/farma-aprendizagens') {
      const body = await readBody(req);
      const webReq = nodeReqToWebRequest(req, body);
      const webRes = await aprendizagensFn.handleRequest(webReq, getStore);
      stats.requests.push({ path: pathname, method: req.method, ms: Date.now() - t0, resBytes: Number(webRes.headers.get('content-length') || 0), reqBytes: body.length });
      await sendWebResponse(webRes, res);
    } else {
      await serveStatic(pathname, res);
    }
  } catch (err) {
    console.error('Erro no servidor local:', err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Erro interno: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Servidor local (funções reais + blobs em memória) em http://localhost:${PORT}`);
});
