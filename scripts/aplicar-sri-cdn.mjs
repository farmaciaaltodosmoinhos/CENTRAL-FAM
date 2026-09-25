#!/usr/bin/env node
/**
 * Aplica Subresource Integrity (SRI, `integrity="sha384-..."`) a todos os
 * `<script src="https://...">` da app que ainda não tenham esse atributo —
 * item real do PDF de auditoria de 20/09/2026 (ponto 49 de
 * arquitetura-decisoes.md): sem SRI, se o CDN (cdnjs.cloudflare.com) alguma
 * vez servir um ficheiro alterado — por um ataque ao próprio CDN, ou uma
 * versão "latest" que muda sem aviso — o browser dos operadores executa esse
 * código sem qualquer verificação.
 *
 * PRECISA DE ACESSO REAL À INTERNET. O sandbox de desenvolvimento onde este
 * ficheiro foi escrito tem a rede de saída bloqueada por política da
 * organização (confirmado nesta sessão: até o registo npm e o pypi
 * respondem 403 "host_not_allowed") — por isso este script nunca chegou a
 * correr aqui, e as 5 páginas afetadas (catalogo-produtos.html,
 * conversor-pdf.html, devolucoes-armazenistas.html, reservas.html,
 * stocks.html) continuam sem SRI até isto correr numa máquina com internet
 * a sério (ex.: o PC do Ivo, ou uma sessão futura em que a rede de saída
 * esteja disponível).
 *
 * Nunca inventa um hash: se uma transferência falhar a meio, o script pára
 * (erro, saída != 0) e não altera NENHUM ficheiro — um `integrity=` errado
 * bloqueia o browser de carregar o script inteiro, o que seria pior do que
 * não ter SRI nenhum (quebrava a exportação Excel/PDF/o leitor de PDF em
 * vários módulos de uma vez).
 *
 * Uso, a partir da raiz do projeto:
 *   node scripts/aplicar-sri-cdn.mjs --list    # só lista o que encontrou (sem rede)
 *   node scripts/aplicar-sri-cdn.mjs           # dry-run: transfere, calcula os hashes, mostra o que mudaria
 *   node scripts/aplicar-sri-cdn.mjs --write   # aplica mesmo, reescrevendo as tags nos ficheiros
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODE = process.argv.includes("--write") ? "write" : process.argv.includes("--list") ? "list" : "dry-run";

function listHtmlFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listHtmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

// Só <script src="https://...">...</script> (tag de abre-fecha, nunca
// self-closing) SEM já ter integrity= — para o script ser seguro de correr
// mais que uma vez (segunda corrida não encontra nada para mudar).
const TAG_RE = /<script\s+src="(https:\/\/[^"]+)"(\s+[^>]*)?><\/script>/g;

function findTags(html) {
  const out = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    const [full, url, rest = ""] = m;
    if (/integrity=/.test(rest)) continue; // já tem — não mexe
    out.push({ full, url, rest });
  }
  return out;
}

async function sriFor(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao transferir ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash("sha384").update(buf).digest("base64");
  return `sha384-${hash}`;
}

async function main() {
  const files = listHtmlFiles(ROOT);
  const byUrl = new Map(); // url -> [{file, tag}]
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    for (const tag of findTags(html)) {
      if (!byUrl.has(tag.url)) byUrl.set(tag.url, []);
      byUrl.get(tag.url).push({ file, tag });
    }
  }

  if (byUrl.size === 0) {
    console.log('Nenhum <script src="https://..."> sem integrity= encontrado — nada a fazer.');
    return;
  }

  const ficheirosAfetados = new Set([...byUrl.values()].flat().map(x => path.relative(ROOT, x.file)));
  console.log(`Encontrados ${byUrl.size} script(s) externo(s) sem SRI, em ${ficheirosAfetados.size} ficheiro(s):`);
  for (const [url, occurrences] of byUrl) {
    console.log(`  ${url}`);
    occurrences.forEach(o => console.log(`    em ${path.relative(ROOT, o.file)}`));
  }

  if (MODE === "list") {
    console.log("\n(--list: só a listar, nenhuma transferência feita)");
    return;
  }

  console.log("");
  const hashes = new Map();
  for (const url of byUrl.keys()) {
    process.stdout.write(`A transferir e calcular SHA-384: ${url} ... `);
    const hash = await sriFor(url);
    hashes.set(url, hash);
    console.log(hash);
  }

  if (MODE === "dry-run") {
    console.log("\n(dry-run — nenhum ficheiro foi alterado; corre com --write para aplicar)");
    return;
  }

  const changedFiles = new Set();
  for (const [url, occurrences] of byUrl) {
    const hash = hashes.get(url);
    for (const { file, tag } of occurrences) {
      let html = fs.readFileSync(file, "utf8");
      if (!html.includes(tag.full)) continue; // já foi mudado (ex. mesmo ficheiro, ocorrência repetida)
      const novaTag = `<script src="${tag.url}"${tag.rest} integrity="${hash}" crossorigin="anonymous"></script>`;
      html = html.split(tag.full).join(novaTag);
      fs.writeFileSync(file, html);
      changedFiles.add(file);
    }
  }
  console.log(`\nAtualizados ${changedFiles.size} ficheiro(s):`);
  changedFiles.forEach(f => console.log("  " + path.relative(ROOT, f)));
}

main().catch(e => {
  console.error("ERRO — parado antes de alterar qualquer ficheiro (nunca escreve um hash por confirmar):", e.message);
  process.exit(1);
});
