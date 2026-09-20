# Central Operacional — versão multi-farmácia (SaaS)

Bifurcação da central de produção de uma farmácia (`central-operacional-farmacia`), transformada
num produto para **várias farmácias**, cada uma com a sua própria conta e os seus próprios dados,
isolados das restantes. O objetivo final é publicar isto na Microsoft Store, na Google Play e na
App Store a partir deste mesmo código-fonte web (via Capacitor para iOS/Android e PWABuilder para
Windows) — essa parte ainda não está feita, ver "Próximos passos" no fim.

Mantém a arquitetura da central original — front-end estático sem passo de build, motor de Virtual
DOM próprio, store imutável, Netlify Functions + Netlify Blobs como backend — e acrescenta uma
camada de autenticação e isolamento por farmácia.

## O que mudou em relação à central de uma farmácia só

- **Autenticação** (`netlify/functions/auth.js` + `netlify/functions/_lib/auth.js`): cada farmácia
  cria uma conta (`POST /api/auth/signup`: nome da farmácia, email, palavra-passe) ou inicia sessão
  (`POST /api/auth/login`). A password é guardada com hash `scrypt` (nunca em texto simples). A
  sessão é um token assinado (HMAC-SHA256, formato JWT), válido por 30 dias, guardado no browser
  (`localStorage`, ver `src/authClient.js`) e enviado em `Authorization: Bearer <token>` em cada
  pedido à API.
- **Isolamento de dados**: `netlify/functions/data.js` e `netlify/functions/asset.js` já não confiam
  em nenhum `tenantId` vindo do pedido — extraem-no sempre do token validado no servidor, e usam-no
  para prefixar as chaves no Netlify Blobs (`estado:<tenantId>`, `asset:<tenantId>:<key>`). Uma
  farmácia nunca consegue ler nem escrever os dados de outra.
- **Ecrã de entrada** (`index.html` + `src/app.js`): a app só arranca (`actions.iniciar()`) depois de
  autenticado; sem sessão válida mostra o ecrã de login/criar conta.

## Configuração necessária no Netlify (por fazer antes do primeiro deploy)

Defina a variável de ambiente **`AUTH_JWT_SECRET`** em Site settings → Environment variables — uma
string aleatória longa (ex.: `openssl rand -hex 32`). Sem ela, as funções de autenticação recusam-se
a arrancar (por segurança, nunca caem para um segredo previsível). É a única variável necessária —
o `@netlify/blobs` continua a detetar o contexto do site automaticamente.

## Testes

```bash
npm install
npm test
```

`tests/auth.test.js`, `tests/data.test.js` e `tests/asset.test.js` cobrem: criação de conta, login,
validação de sessão, e — o mais importante — que uma farmácia nunca vê nem apaga os dados de outra
(testado diretamente contra as chaves gravadas na store simulada).

## Próximos passos

1. Ir integrando os módulos das farmácias (a primeira peça em curso: "Pedidos de Manipulados").
2. Revisão final de harmonização (design, navegação) quando todos os módulos estiverem integrados.
3. Manifest PWA + service worker ajustado para instalação.
4. Empacotamento: Capacitor (iOS/Android) e PWABuilder (Windows/Microsoft Store).
5. Aspetos "de bastidores" para publicar nas lojas: contas de developer (Apple/Google/Microsoft),
   política de privacidade, conformidade RGPD, modelo de preços/subscrição por farmácia.
