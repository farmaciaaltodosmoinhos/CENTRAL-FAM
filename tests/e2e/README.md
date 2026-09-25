# Testes end-to-end (bateria completa)

Diferente dos testes em `tests/*.test.js` (unitários, isolados por função),
esta pasta corre a aplicação real — Central + módulos — contra as funções
reais do Netlify (`netlify/functions/*.js`), servidas por um pequeno servidor
local que substitui o Netlify Blobs por um mapa em memória. Não precisa da
`netlify-cli` nem de acesso à internet.

## Como correr

```bash
# 1. arranca o servidor local (funções reais + blobs em memória), numa aba
node tests/e2e/local-server.mjs 8888 .

# 2. noutra aba, corre a bateria de testes
node tests/e2e/battery.mjs
```

Precisa do Playwright instalado (`npm i -D playwright` ou equivalente) e do
Chromium correspondente — define `PLAYWRIGHT_CHROMIUM_PATH` se o binário não
estiver no caminho padrão do Playwright.

## O que cobre

- Autenticação real (signup/login) e isolamento entre farmácias.
- O bug de desempenho do logótipo (ver `src/actions.js`/`src/db.js` e a nota
  em cada `modulos/*.html`): confirma que o logótipo deixou de viajar dentro
  de `/api/data` (medindo o tamanho real do payload) e que farmácias antigas
  (logótipo só em `config.logo`, de antes desta correção) continuam a
  funcionar e migram sozinhas na primeira gravação de qualquer módulo.
- Todos os 13 módulos carregam sem erros de consola/página em 3 larguras
  (390 telemóvel / 800 tablet / 1440 desktop).
- Um fluxo funcional real (criar um utente em PIM) para apanhar regressões
  do género "bug de escopo do draft" (variável de módulo mutada por um
  `oninput` inline, que corre no escopo global — ver histórico de commits).

## Quando correr

Sempre que se mexer em `netlify/functions/*.js`, `src/db.js`, `src/actions.js`,
`assets/module-chrome.js`, ou na lógica de gravação/carregamento de qualquer
`modulos/*.html` — esta bateria teria apanhado a maioria dos bugs reais
encontrados nesta base de código até agora.
