/**
 * src/farmaLeituraTexto.js — ponto 43, Função 3 ("aprender por leitura").
 * Conversões de formatos simples PARA texto simples — a parte pura e
 * testável sem browser. Formatos que precisam de uma biblioteca pesada
 * (PDF, Word, Excel) NÃO vivem aqui: ver `src/ui/farmaLeituraFicheiros.js`,
 * que só corre no browser (FileReader, bibliotecas carregadas por CDN à
 * semelhança de `ensureBarcodeLib`/`src/ui/farmaCerebro.js`).
 */

/** Extensão em minúsculas (sem o ponto), ou "" se o nome não tiver nenhuma. */
export function extensaoDe(nomeFicheiro) {
  const nome = String(nomeFicheiro || "");
  const i = nome.lastIndexOf(".");
  if (i === -1 || i === nome.length - 1) return "";
  return nome.slice(i + 1).toLowerCase();
}

// Cobre as entidades nomeadas mais comuns em HTML exportado, incluindo as
// letras acentuadas do português — sem esta lista, texto real ("Preço",
// "não", "informação") ficava com as entidades por descodificar.
const ENTIDADES_HTML = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
  atilde: "ã", otilde: "õ", ntilde: "ñ",
  Atilde: "Ã", Otilde: "Õ", Ntilde: "Ñ",
  ccedil: "ç", Ccedil: "Ç",
  ordf: "ª", ordm: "º", deg: "°", euro: "€", middot: "·", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "'", rsquo: "'", ldquo: "“", rdquo: "”",
};

/**
 * Extrai o texto visível de HTML por remoção de tags — deliberadamente sem
 * `DOMParser` (não existe fora do browser, e assim esta função é pura e
 * testável em Node). Descarta sempre `<script>`/`<style>` por inteiro (o
 * conteúdo nunca é texto para o operador) e descodifica as entidades HTML
 * mais comuns.
 */
export function textoDeHtml(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  // blocos que na prática separam parágrafos, para o texto não ficar tudo colado.
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br)\s*>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES_HTML[code.toLowerCase()] ?? m;
  });
  return s.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

/**
 * Interpreta CSV simples (separador `,` ou `;`, sem células com aspas
 * multi-linha — suficiente para exportações típicas de Excel/PIM) e
 * devolve-o como texto legível, uma frase por linha ("campo: valor, campo:
 * valor"), para a pesquisa por semelhança (`pesquisarConhecimento`) ter
 * frases reais para comparar em vez de uma grelha de números/vírgulas.
 */
export function textoDeCsv(csv, nomeColunas) {
  const texto = String(csv || "").replace(/\r\n/g, "\n").trim();
  if (!texto) return "";
  const separador = (texto.split("\n")[0].match(/;/g) || []).length > (texto.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const linhas = texto.split("\n").map(l => l.split(separador).map(c => c.trim().replace(/^"|"$/g, "")));
  const cabecalho = nomeColunas || linhas[0];
  const corpo = nomeColunas ? linhas : linhas.slice(1);
  return corpo
    .filter(linha => linha.some(c => c))
    .map(linha => linha.map((valor, i) => `${cabecalho[i] || `col${i + 1}`}: ${valor}`).join(", "))
    .join("\n\n");
}

/** Extensões que este módulo (mais `farmaLeituraFicheiros.js` no browser)
 *  sabe processar, com o nome do "tipo" usado para escolher a estratégia. */
export const TIPOS_SUPORTADOS = {
  txt: "texto", md: "texto",
  html: "html", htm: "html",
  csv: "csv",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx", xls: "xlsx",
};

/** Diz se um nome de ficheiro tem uma extensão suportada — usado pela UI
 *  para recusar logo um ficheiro não suportado, antes de o tentar ler. */
export function tipoSuportado(nomeFicheiro) {
  return TIPOS_SUPORTADOS[extensaoDe(nomeFicheiro)] || null;
}
