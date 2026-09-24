/**
 * src/ui/farmaLeituraFicheiros.js — ponto 43, Função 3 ("aprender por
 * leitura"). Só corre no browser (usa `FileReader`/`window`) — extrai texto
 * simples de um ficheiro carregado pelo operador, para depois passar por
 * `src/farmaLeitura.js` (divisão em excertos + base de conhecimento
 * pesquisável). Nunca envia o ficheiro para fora do computador da
 * farmácia: tudo aqui é processamento local no browser.
 *
 * Formatos simples (.txt/.md/.csv/.html) são lidos e convertidos com
 * `src/farmaLeituraTexto.js` (puro, sem dependências). Formatos mais
 * complexos (.pdf/.docx/.xlsx) precisam de uma biblioteca a sério —
 * carregada por CDN só quando é mesmo preciso, à semelhança de
 * `ensureBarcodeLib` (assets/module-chrome.js) e da biblioteca WebLLM
 * (src/ui/farmaCerebro.js): nunca pesa no arranque do módulo para quem
 * nunca usa esta função. O PDF.js usado é a MESMA versão já validada em
 * produção por `modulos/conversor-pdf.html` (cdnjs, 3.11.174) — reaproveita
 * a fonte já confiável em vez de arriscar uma versão nova e não testada.
 */
import { extensaoDe, textoDeHtml, textoDeCsv, tipoSuportado } from "../farmaLeituraTexto.js";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_CDN = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const TIMEOUT_MS = 20000;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    const temporizador = setTimeout(() => reject(new Error(`"${src}" não respondeu em ${TIMEOUT_MS / 1000}s (timeout).`)), TIMEOUT_MS);
    tag.onload = () => { clearTimeout(temporizador); resolve(); };
    tag.onerror = () => { clearTimeout(temporizador); reject(new Error(`Não foi possível carregar "${src}".`)); };
    document.head.appendChild(tag);
  });
}

let pdfjsPromise = null;
async function garantirPdfjs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (!pdfjsPromise) {
    pdfjsPromise = carregarScript(PDFJS_CDN).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
      return window.pdfjsLib;
    });
  }
  return pdfjsPromise;
}

let mammothPromise = null;
async function garantirMammoth() {
  if (window.mammoth) return window.mammoth;
  if (!mammothPromise) mammothPromise = carregarScript(MAMMOTH_CDN).then(() => window.mammoth);
  return mammothPromise;
}

let xlsxPromise = null;
async function garantirXlsx() {
  if (window.XLSX) return window.XLSX;
  if (!xlsxPromise) xlsxPromise = carregarScript(XLSX_CDN).then(() => window.XLSX);
  return xlsxPromise;
}

function lerComoTexto(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error(`Não foi possível ler "${file.name}".`));
    r.readAsText(file);
  });
}

function lerComoArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Não foi possível ler "${file.name}".`));
    r.readAsArrayBuffer(file);
  });
}

async function extrairTextoPdf(file) {
  const pdfjsLib = await garantirPdfjs();
  const buffer = await lerComoArrayBuffer(file);
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    paginas.push(conteudo.items.map(it => it.str).join(" "));
  }
  return paginas.join("\n\n");
}

async function extrairTextoDocx(file) {
  const mammoth = await garantirMammoth();
  const buffer = await lerComoArrayBuffer(file);
  const resultado = await mammoth.extractRawText({ arrayBuffer: buffer });
  return resultado.value || "";
}

async function extrairTextoXlsx(file) {
  const XLSX = await garantirXlsx();
  const buffer = await lerComoArrayBuffer(file);
  const livro = XLSX.read(buffer, { type: "array" });
  return livro.SheetNames
    .map(nome => `--- folha: ${nome} ---\n${textoDeCsv(XLSX.utils.sheet_to_csv(livro.Sheets[nome]))}`)
    .join("\n\n");
}

/**
 * Extrai texto simples de um ficheiro (`File`/`Blob` do browser), segundo o
 * tipo detetado pela extensão (ver `tipoSuportado`, `farmaLeituraTexto.js`).
 * Lança um erro com uma mensagem clara para o operador (nunca falha
 * silenciosamente) quando o tipo não é suportado ou a extração falha.
 */
export async function extrairTextoDeFicheiro(file) {
  const tipo = tipoSuportado(file.name);
  if (!tipo) {
    throw new Error(`Formato ".${extensaoDe(file.name)}" não suportado. Formatos aceites: txt, md, html, csv, pdf, docx, xlsx.`);
  }
  if (tipo === "texto") return lerComoTexto(file);
  if (tipo === "html") return textoDeHtml(await lerComoTexto(file));
  if (tipo === "csv") return textoDeCsv(await lerComoTexto(file));
  if (tipo === "pdf") return extrairTextoPdf(file);
  if (tipo === "docx") return extrairTextoDocx(file);
  if (tipo === "xlsx") return extrairTextoXlsx(file);
  throw new Error(`Tipo "${tipo}" reconhecido mas sem extrator implementado.`);
}
