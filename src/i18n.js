/**
 * src/i18n.js — motor de internacionalização da Central (ponto 24,
 * multi-idioma: "Português, Inglês, Espanhol, Francês, Alemão, Italiano,
 * Mandarim, Russo, Ucraniano, Polaco, Hindi, Coreano, Árabe, Bengali,
 * Indonésio (15 idiomas)... escolha de idioma no ato de criação de conta,
 * alterável depois em Configurações da Central" — pedido original do Ivo,
 * ponto 21).
 *
 * Desenho: dicionário simples de chave→string por idioma (src/i18n/
 * dicionario.js), sem nenhuma dependência externa (sem biblioteca de i18n)
 * — consistente com o resto da Central, que evita dependências sempre que
 * uma solução simples e própria chega lá. `t()` traduz uma chave com
 * interpolação de variáveis ({{var}}); `aplicarTraducoes()` percorre o DOM
 * à procura de `data-i18n*` e substitui o texto — chamado uma vez no
 * arranque e sempre que o idioma muda (ver app.js).
 *
 * `idioma` é sempre um código de 2 letras (ver IDIOMAS); guardado em
 * `config.idioma` (SET_IDIOMA em store.js, setIdioma() em actions.js),
 * com "pt" como valor por omissão para farmácias que ainda não escolheram
 * nenhum (compatibilidade com todas as contas criadas antes deste ponto).
 */
import { CHAVES } from "./i18n/dicionario.js";

export const IDIOMAS = [
  { codigo: "pt", nome: "Português" },
  { codigo: "en", nome: "English" },
  { codigo: "es", nome: "Español" },
  { codigo: "fr", nome: "Français" },
  { codigo: "de", nome: "Deutsch" },
  { codigo: "it", nome: "Italiano" },
  { codigo: "zh", nome: "中文" },
  { codigo: "ru", nome: "Русский" },
  { codigo: "uk", nome: "Українська" },
  { codigo: "pl", nome: "Polski" },
  { codigo: "hi", nome: "हिन्दी" },
  { codigo: "ko", nome: "한국어" },
  { codigo: "ar", nome: "العربية", rtl: true },
  { codigo: "bn", nome: "বাংলা" },
  { codigo: "id", nome: "Bahasa Indonesia" }
];

export const DEFAULT_IDIOMA = "pt";

const CODIGOS_VALIDOS = new Set(IDIOMAS.map(i => i.codigo));

export function idiomaValido(codigo) {
  return CODIGOS_VALIDOS.has(codigo);
}

/** Normaliza um valor vindo do estado/config: só devolve códigos
 *  reconhecidos, caindo para pt em qualquer outro caso (undefined, string
 *  vazia, código desconhecido/antigo). */
export function normalizarIdioma(codigo) {
  return idiomaValido(codigo) ? codigo : DEFAULT_IDIOMA;
}

/**
 * Traduz `chave` para `idioma`. Cai para pt se a tradução para esse idioma
 * estiver em falta (nunca deve acontecer — ver tests/i18n.test.js — mas
 * mantém a app utilizável mesmo que uma chave nova ainda não tenha sido
 * traduzida para todos os idiomas) e, na pior hipótese, devolve a própria
 * chave (mais fácil de detetar visualmente do que rebentar).
 */
export function t(chave, idioma = DEFAULT_IDIOMA, vars) {
  const entrada = CHAVES[chave];
  let texto = entrada ? (entrada[idioma] || entrada[DEFAULT_IDIOMA]) : null;
  if (texto == null) texto = chave;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      texto = texto.split(`{{${k}}}`).join(String(v));
    });
  }
  return texto;
}

export function ehRtl(idioma) {
  return IDIOMAS.find(i => i.codigo === idioma)?.rtl === true;
}

/**
 * Aplica as traduções a todos os elementos com atributos `data-i18n*`
 * dentro de `raiz` (por omissão, o documento inteiro):
 *   data-i18n            → textContent
 *   data-i18n-placeholder → placeholder
 *   data-i18n-title       → title
 *   data-i18n-aria        → aria-label
 * Quando `raiz` é o próprio documento, também atualiza <html lang>/dir
 * (dir="rtl" para árabe). Chamado uma vez no arranque e sempre que o
 * idioma muda (ver renderAll() em app.js).
 */
export function aplicarTraducoes(idioma, raiz) {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return;
  const alvo = raiz || doc;
  if (alvo === doc) {
    doc.documentElement.lang = idioma;
    doc.documentElement.dir = ehRtl(idioma) ? "rtl" : "ltr";
  }
  alvo.querySelectorAll("[data-i18n]").forEach(elx => { elx.textContent = t(elx.getAttribute("data-i18n"), idioma); });
  alvo.querySelectorAll("[data-i18n-placeholder]").forEach(elx => { elx.placeholder = t(elx.getAttribute("data-i18n-placeholder"), idioma); });
  alvo.querySelectorAll("[data-i18n-title]").forEach(elx => { elx.title = t(elx.getAttribute("data-i18n-title"), idioma); });
  alvo.querySelectorAll("[data-i18n-aria]").forEach(elx => { elx.setAttribute("aria-label", t(elx.getAttribute("data-i18n-aria"), idioma)); });
}

/** Lista de chaves em falta para um dado idioma — usado por
 *  tests/i18n.test.js para garantir que nenhum dos 15 idiomas fica com
 *  chaves por traduzir (a app nunca rebenta com uma chave em falta — cai
 *  para pt — mas isso não deve acontecer silenciosamente). */
export function chavesEmFalta(idioma) {
  return Object.keys(CHAVES).filter(k => !CHAVES[k][idioma]);
}

export function todasAsChaves() {
  return Object.keys(CHAVES);
}
