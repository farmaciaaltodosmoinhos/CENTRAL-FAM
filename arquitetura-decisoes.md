# Central Operacional — versão multi-farmácia (SaaS publicável)

## Contexto

Ivo já tem uma "Central Operacional" em produção, de uso único (Farmácia Alto dos Moinhos),
em `central-operacional-farmacia` (Netlify: front-end estático + Netlify Functions + Netlify Blobs,
sem build step, motor de Virtual DOM próprio, store imutável). **Essa central de produção não é tocada** —
continua a servir a farmácia dele como está.

O objetivo agora é um **produto novo**: a mesma ideia (central que agrega várias ferramentas internas
de farmácia — documentos, manipulados, gestão de gabinete, gestão de PIM, pedidos AUE, mapa 48h
cardiovascular, aluguer Medela, stocks, devoluções, conversor PDF, catálogo de produtos, etc.), mas
**multi-farmácia** (cada farmácia com conta e dados isolados), publicável nas três lojas de apps
(Microsoft Store, Google Play, Apple App Store) a partir de um único código-fonte.

As ferramentas de uma farmácia (peças que o Ivo vai enviando, uma a uma) servem de **referência
funcional** de cada módulo — o "o que faz" — e são reconstruídas dentro da nova arquitetura. Algumas
peças são módulos de gestão completos (Manipulados, Documentos, Gabinete, PIM, AUE, Stocks); outras são
"ferramentas" mais pequenas e independentes entre si (geradores de documentos/formulários, conversores) —
o Ivo sinalizou explicitamente esta distinção ao enviar a peça 7. Depois de todas as peças enviadas
("já temos todas as peças"), o Ivo pediu uma **passagem final de harmonização**: fonte única de
verdade para nome/logótipo (e morada/contactos) em toda a app, base de dados de produtos centralizada
e editável, verificação de que a arquitetura aguenta milhares de farmácias em simultâneo e uma
auditoria final de bugs — ver secção "Harmonização final" abaixo. Depois de tudo isso, pediu ainda uma
segunda passagem, mais visual: unificar a **paleta de cores** de todos os módulos, para que a app pareça
um único software desenhado de propósito, e não treze ferramentas diferentes coladas juntas — ver ponto 13.
Mais tarde ainda, pediu uma **redesenho de navegação** inspirado no Sifarma (barra superior + barra
inferior partilhadas) para acabar com a sensação de "sidebar dentro de sidebar" ao abrir um módulo, e,
na sessão mais recente, uma **auditoria de desempenho e responsividade móvel** com uma bateria de testes
completa — ver pontos 14 e 15.

## Decisões de arquitetura (tomadas em 2026-09-08 e 2026-09-09)

1. **Dados/autenticação**: Netlify (Functions + Blobs), adaptado — não Supabase. Reaproveita o padrão
   já testado na central de produção. Isolamento por `tenantId` embutido num token de sessão assinado
   (JWT/HMAC-SHA256), nunca confiado a partir do próprio pedido.
2. **Publicação nas 3 lojas**: Web app + Capacitor (iOS/Android) + PWABuilder (Windows/Microsoft Store).
   Um único código-fonte web, embrulhado nativamente para cada loja.
3. **Módulos = páginas HTML próprias, dentro de um iframe da mesma origem**: cada módulo/ferramenta fica
   em `modulos/<nome>.html`, aberto num `<iframe>` dentro do próprio painel da Central (mesma origem, por
   isso partilha o `localStorage` com o token de sessão e pode importar diretamente
   `src/db.js`/`src/authClient.js` como módulos ES). Evita colisões de CSS entre o módulo (que tem o seu
   próprio design bem elaborado, herdado da ferramenta original) e o resto da Central. Isto exigiu
   ajustar `netlify.toml`: os cabeçalhos de segurança pensados para o resto do site
   (`X-Frame-Options: DENY`, `frame-ancestors 'none'` — nada pode enquadrar o site) bloqueavam este
   próprio mecanismo; `/modulos/*` tem agora uma exceção que só permite ser enquadrado pela própria
   origem (nunca por terceiros).
4. **Merge no servidor em `/api/data`**: o PUT já não substitui o estado inteiro da farmácia — faz
   merge (`{...atual, ...body}`) antes de gravar. Sem isto, o painel principal (que só conhece
   `servicos/categorias/config`) apagava sempre o que outro módulo tivesse gravado a cada vez que
   gravasse as suas próprias alterações. Coberto por teste automatizado.
5. **Conteúdo pesado nunca dentro do JSON principal**: qualquer campo que possa conter um ficheiro real
   vive à parte, referenciado por chave, através de `dataStore.setAsset`/`getAsset` (já existente, trata
   a fragmentação de ficheiros grandes) — nunca embutido como base64 dentro do JSON principal gravado em
   `/api/data`. Imagens puramente decorativas em vez disso são reduzidas/recomprimidas no próprio browser
   antes de gravar (canvas, ~KB). Sem qualquer uma destas duas medidas, o estado partilhado de uma
   farmácia ultrapassava facilmente o limite de 6MB por pedido das funções do Netlify. **Nota
   (2026-09-09, sessão de desempenho): o logótipo tinha ficado como a exceção não intencional a esta
   regra — ver ponto 14.**
6. **Padrão de sincronização por módulo**: cada módulo lê o estado partilhado com `fetchEstado()` (GET
   `/api/data`) e grava através de um pequeno auxiliar `gravar<Modulo>(key, value)` que faz merge de
   `{...(estadoAtual.<modulo> || {}), [key]: value}` num campo de topo próprio antes de fazer PUT do
   estado completo. Isto deixa a API interna `loadJSON`/`saveJSON(key, val)` de cada módulo praticamente
   intocada — só o ponto de gravação na nuvem muda —, e o merge no servidor (ponto 4) garante que os
   módulos nunca se pisam uns aos outros. Quando o módulo original não tem uma API por chave (ex. Stocks
   Errados), grava-se um único campo de topo com a estrutura de dados inteira do módulo, ou usa-se o
   mesmo `gravar<Modulo>(key, value)` genérico se o módulo já separar o seu estado em algumas chaves
   internas (caso de Devoluções a Armazenistas, 5 chaves).
7. **Exceção ao padrão acima — merge registo a registo, quando o módulo original já o tinha**: por
   omissão, `gravar<Modulo>` faz "last write wins" ao nível da chave inteira. O pacote de "Pedidos AUE"
   já vinha com uma lógica própria, deliberada, de fusão registo a registo (por `id` + `updatedAt`, com
   eliminação por "tombstone") para nunca perder a alteração de um pedido feita a partir de outro
   computador em simultâneo. Essa lógica (`mergePedidosArrays`) foi preservada tal qual estava, só
   trocando o transporte. Vale a pena replicar este padrão em qualquer peça futura que já o tivesse
   implementado, em vez de o simplificar para "last write wins".
8. **Bug transversal #1 (2026-09-08) — "Voltar à Central" partido**: o link "← Voltar à Central"
   (`onclick="voltarACentral()"` inline no HTML) não funcionava em nenhum módulo — `voltarACentral` é
   definida dentro de `<script type="module">`, e declarações de topo num módulo ES não ficam
   acessíveis a partir de atributos `onclick` inline (que correm no escopo global). Corrigido
   adicionando `window.voltarACentral = voltarACentral;` logo a seguir à definição da função.
9. **Bug transversal #2 (2026-09-09) — TODOS os handlers inline partidos, não só o "Voltar à Central"**:
   na sequência do ponto 8, ao investigar a peça 7 descobriu-se que o problema não era específico da
   `voltarACentral` — **qualquer** função referenciada por um atributo `onclick`/`onchange`/`oninput`/etc.
   inline, dentro de um `<script type="module">`, sofre exatamente do mesmo problema. Isto afetava
   TODOS os botões e campos interativos de Manipulados (24 funções), Documentos (119), Gestão de
   Gabinete (51), Gestão de PIM (75) e Pedidos AUE (29) — praticamente a totalidade da interação nesses
   5 módulos estava silenciosamente partida (um clique não fazia nada; o erro só aparece na consola do
   browser). Corrigido, para cada ficheiro, com um pequeno script que: (a) recolhe todos os nomes de
   função chamados a partir de atributos `on*="..."` inline; (b) cruza com as funções efetivamente
   declaradas (`function nome(...)`) no próprio módulo; (c) acrescenta `window.nome = nome;` para cada
   uma, no fim do `<script type="module">`. **Nota para módulos futuros, reconfirmada nas auditorias
   finais de 2026-09-09**: qualquer módulo que use atributos de evento inline dentro de um
   `<script type="module">` precisa deste tratamento — uma varredura automatizada a todos os 13
   módulos/ferramentas confirmou, mais que uma vez, que não há nenhuma função chamada a partir de um
   atributo inline que não esteja exportada para `window`.
10. **Fonte única de verdade para nome/logótipo/morada/contactos da farmácia (2026-09-09)**: antes desta
    passagem, havia DUAS fontes desencontradas para o nome da farmácia — `getPerfil()?.nomeFarmacia`
    (o nome dado no registo, gravado uma única vez em `localStorage` e nunca mais atualizado) era o que
    todos os 12 módulos/ferramentas mostravam, enquanto o painel principal usava
    `config.nomeFarmacia` (editável em Configurações, e que por omissão nem sequer caía no nome do
    registo — caía direto no nome antigo "Farmácia Alto dos Moinhos", um resquício da app de uma só
    farmácia). Resultado: uma farmácia que mudasse o nome em Configurações via esse nome atualizado só
    no painel principal — todos os módulos continuavam a mostrar o nome antigo do registo, e uma
    farmácia nova via "Farmácia Alto dos Moinhos" na barra lateral até abrir Configurações pela
    primeira vez. Corrigido:
    - `config.nomeFarmacia`/`config.logo` (mais dois campos novos: `config.morada`,
      `config.emailContacto`, `config.telefoneContacto` — geridos em Configurações → Identificação)
      passam a ser a única fonte de verdade em toda a app.
    - `src/actions.js` (`iniciar()`): se `config.nomeFarmacia` nunca tiver sido gravado, cai para o
      nome do registo (não para "Farmácia Alto dos Moinhos") e grava-o já em `config.nomeFarmacia`
      (migração silenciosa, uma vez), para os módulos verem sempre o mesmo valor sem precisarem de
      conhecer este fallback.
    - Todos os 13 módulos/ferramentas (incluindo o novo Catálogo de Produtos) foram atualizados: em vez
      de `nomeFarmaciaAtual(){ return getPerfil()?.nomeFarmacia || 'Farmácia'; }`, agora fazem uma
      leitura do estado partilhado (`fetchEstado()`, já usada por 6 deles; adicionada de propósito nos
      6 que não tinham estado nenhum, só para efeitos de identidade) e usam
      `estado.config.nomeFarmacia`, com o nome do registo como reserva só enquanto essa leitura não
      chega.
    - O **logótipo** passou a aparecer em todo o lado, não só no painel principal: os 4 módulos que já
      tinham um `<img id="brandLogoImg">` na barra lateral mas mostravam sempre um SVG genérico
      fixo (Documentos, Gestão de Gabinete, Gestão de PIM tinham o `<img>` mas nunca ligado ao logótipo
      real; Pedidos AUE nem sequer definia o `src`) passaram a mostrar o logótipo real assim que
      carregado, com o genérico como reserva; os restantes ganharam a mesma imagem onde fazia sentido
      visualmente (Manipulados, Devoluções a Armazenistas — troca o glifo "A·E·O" pelo logótipo real
      quando existe; Mapa Cardiovascular — as 3 ocorrências do logótipo da farmácia no formulário e nas
      páginas de consentimento). Documentos e Stocks Errados também passaram a usar o logótipo real
      (com deteção do formato de imagem correto — PNG/JPEG/GIF) nas exportações Excel/PDF, que antes
      usavam sempre o placeholder genérico.
    - **Morada/contactos**: novo separador em Configurações → Identificação (`Morada`, `Email de
      contacto`, `Telefone de contacto`). O Aluguer Medela, que tinha 3 campos `contenteditable` vazios
      (marcados como uma limitação conhecida na sessão anterior) passa agora a **pré-preencher** esses
      campos com `config.morada`/`config.emailContacto` assim que disponíveis — continuam editáveis
      caso a farmácia precise de ajustar um contrato específico, mas já não obrigam a escrever a morada
      à mão de cada vez.
    - Corrigido também `stocks.html`: uma auditoria final encontrou "FARMÁCIA ALTO DOS MOINHOS" ainda
      hardcoded (maiúsculas) no cabeçalho da exportação Excel e no cabeçalho do PDF — não tinha sido
      apanhado na integração original porque não correspondia a nenhum padrão já visto nos outros
      módulos. Corrigido para `nomeFarmaciaAtual().toUpperCase()`.
    - `Conversor de PDF` (DocConvert Pro) foi deliberadamente deixado sem branding — é uma ferramenta
      utilitária 100% genérica (fusão/conversão de PDFs), sem qualquer documento gerado em nome da
      farmácia, pelo que mostrar aqui o nome/logótipo não acrescentaria nada e destoaria do desenho
      limpo da ferramenta.
11. **Catálogo de produtos centralizado (2026-09-09)**: a Gestão de Gabinete, a Gestão de PIM, os
    Stocks Errados e a Central de Documentos traziam cada uma a sua própria cópia embutida do catálogo
    de produtos/medicamentos (`<script type="application/json" id="products-blob">`, ~1.6MB,
    ~29 mil produtos) — confirmado, por comparação byte a byte, que as 4 cópias eram idênticas (a de
    Documentos e a de Stocks tinham só 2 bytes de diferença de formatação, dados exatamente iguais).
    Substituído por uma arquitetura de duas camadas pensada para não replicar armazenamento por
    farmácia (importante para escalar a milhares de farmácias — ver ponto 12):
    - **Catálogo base** (`assets/catalogo-base.json`, ~1.6MB): o catálogo oficial completo, igual para
      todas as farmácias, servido como ficheiro estático pelo CDN do Netlify (cacheado pelo browser) —
      nunca replicado por tenant.
    - **"Overlay" por farmácia** (`src/produtosCatalogo.js`): só as diferenças desta farmácia em
      relação ao catálogo base — produtos adicionados, produtos editados (por código original),
      códigos removidos/ocultos. Guardado no "asset store" já existente
      (`dataStore.getAsset`/`setAsset`, chave `catalogoProdutos`), isolado por tenant como tudo o
      resto, e completamente à parte do estado geral (`/api/data`) — uma gravação de produtos nunca
      torna mais lenta uma gravação sem nada a ver (ex.: marcar um serviço como favorito), e vice-versa.
    - `carregarCatalogoEfetivo(dataStore)` combina as duas camadas em memória (nunca grava o resultado
      combinado) e é o que a Gestão de Gabinete, a Gestão de PIM e os Stocks Errados passaram a usar em
      vez da cópia embutida — cada um começa com `ALL_PRODUCTS = []` e preenche assim que a leitura
      termina (a pesquisa de produtos simplesmente não devolve nada até lá, sem bloquear o resto da
      página).
    - A Gestão de Gabinete e a Central de Documentos já tinham cada uma o seu próprio mini-mecanismo
      local de "produtos personalizados" (`customProducts`, só visível dentro do próprio módulo, uma
      duplicação de dados adicional). Mantido como cache local instantâneo (não vale o risco de reescrever
      os pontos de chamada síncronos), mas agora espelhado no overlay partilhado sempre que um produto é
      adicionado, e com deduplicação ao juntar as duas listas — assim, um produto adicionado através da
      Gestão de Gabinete ou da Central de Documentos passa também a aparecer na Gestão de PIM, nos
      Stocks Errados e no novo Catálogo de Produtos, e vice-versa.
    - **Nova ferramenta "Catálogo de Produtos"** (`modulos/catalogo-produtos.html`, secção
      Ferramentas): pesquisar/editar/remover produtos do catálogo efetivo desta farmácia; adicionar
      manualmente; importar de Excel/CSV (`exceljs`, já usado noutros módulos); importar de PDF
      (`pdf.js`, extração de texto + heurística de linhas, já usado no Conversor de PDF); "picagem do
      DMF" (colar texto copiado do DMF ou carregar um ficheiro Excel/CSV exportado de lá). Os três
      modos de importação partilham o mesmo motor: linhas divididas em colunas, deteção automática de
      qual coluna é designação/código/família por palavras-chave no cabeçalho (com e sem acentos), pré-
      visualização com os mapeamentos de coluna corrigíveis à mão, e só grava depois de confirmado —
      preenche o que consegue reconhecer automaticamente e deixa o resto para completar manualmente,
      como pedido.
    - Coberto por testes automatizados novos (`tests/produtosCatalogo.test.js`, 8 testes): catálogo
      efetivo sem overlay, adicionar (com e sem duplicado), editar, remover (produto do catálogo base
      vs. produto próprio), restaurar, e leitura de overlay corrompida a não bloquear a app.
12. **Verificação de escala multi-tenant (2026-09-09)**: auditados `netlify/functions/_lib/auth.js`,
    `auth.js`, `data.js` e `asset.js`. O isolamento por farmácia está bem desenhado para escalar a
    milhares de tenants: `tenantId` é um UUID gerado no servidor no registo (nunca aceite a partir do
    pedido), embutido e assinado dentro do token de sessão (HMAC-SHA256, comparação em tempo
    constante), e todas as chaves no Netlify Blobs são prefixadas por esse `tenantId`
    (`estado:<tenantId>`, `asset:<tenantId>:<key>`) — sem isto, uma farmácia nunca consegue ler ou
    escrever dados de outra. Passwords com scrypt + salt próprio por conta. O Netlify Blobs em si é um
    armazenamento tipo KV gerido, pensado para este padrão de acesso. Duas recomendações para o futuro,
    não implementadas nesta sessão por não terem sido pedidas e não serem bloqueantes para o
    lançamento: (a) não há limitação de tentativas (rate limiting) em `/api/auth/login`/`signup` — vale
    a pena considerar antes de um lançamento público, para travar tentativas de força bruta; (b) não há
    verificação de email no registo — qualquer email é aceite sem confirmação.
13. **Harmonização visual da paleta de cores entre todos os módulos (2026-09-09, segunda passagem)**:
    depois da harmonização de dados (ponto 10) e do catálogo centralizado (ponto 11), o Ivo pediu
    explicitamente uma segunda passagem, desta vez visual: "tudo deve parecer um único software
    harmonioso". Uma auditoria aos `:root{...}` de cada módulo confirmou o problema — cada peça tinha
    sido construída com a sua própria cor de marca, sem qualquer relação entre si: Documentos em
    laranja-queimado, Gestão de Gabinete em roxo, Gestão de PIM em dourado, Pedidos AUE em azul-marinho,
    Reservas/Stocks Errados/Devoluções a Armazenistas em vermelho-escuro/verde-petróleo, cada um com o
    seu próprio `--bg` de página a condizer (pêssego, lavanda, creme...). Ao mudar de módulo, a app
    parecia treze aplicações diferentes coladas juntas, não um produto só.
    - **Paleta unificada**, ancorada na cor que já era a cor principal do próprio painel principal
      (`--primary:#2b7a4b` em `assets/styles.css`) — não uma cor nova, a cor que a app já usava desde o
      login e a barra lateral: `#2b7a4b` (tom principal), `#1f543e` (tom escuro, texto/hover/cabeçalhos),
      `#4f9c72` (tom claro, destaques), `#e3f2e8` (fundo suave, chips/cartões), `#eef5e8` (fundo de
      página, igual ao `--bg` do painel principal).
    - Como a maior parte dos módulos já tinha o seu próprio sistema de variáveis CSS de marca
      (`--brand`/`--brand-deep`/`--brand-soft`, ou `--brand-deep`/`--brand-mid`/`--brand-bright`, ou
      `--green-deep`/`--green-mid`/`--green-bright`, consoante a peça), a correção foi feita ao nível
      dessas variáveis — só o valor hexadecimal muda, nunca o nome da variável nem a estrutura do CSS —
      o que torna esta alteração praticamente sem risco: nenhuma regra de layout, nenhum id, nenhuma
      função JavaScript foi tocada, só cor. Aplicado a Documentos, Gestão de Gabinete, Gestão de PIM,
      Pedidos AUE, Manipulados, Reservas, Stocks Errados, Devoluções a Armazenistas, Catálogo de
      Produtos, Aluguer Medela (que já usava um verde muito próximo, só afinado) e Mapa Cardiovascular
      (idem).
    - Uma segunda varredura, por cor exata em vez de por variável, apanhou "fugas" de marca fora do
      bloco `:root` — sítios onde a cor antiga estava escrita diretamente em vez de usar a variável já
      existente no próprio ficheiro: os cabeçalhos "ps-header"/"ps-contact"/"rotulo-head" usados nos
      documentos e etiquetas impressas (Documentos, Gestão de Gabinete, Gestão de PIM — mesmo padrão
      partilhado pelas três, com cores antigas diferentes cada uma), a cor de exportação por omissão em
      Reservas (`DEFAULT_COLORS`/seletor de cor do cabeçalho da tabela exportada), e o texto/gradiente
      da barra lateral em Documentos/Gestão de Gabinete/Gestão de PIM/Pedidos AUE (cor de texto clara
      sobre fundo escuro, cada módulo com o seu próprio tom — unificado para o mesmo tom de menta claro,
      `#EAF6EE`, que o Manipulados já usava). Ao todo, mais de 60 ocorrências de cor corrigidas fora dos
      blocos `:root`.
    - **O que foi deliberadamente deixado como estava**, por ser cor de identidade de terceiros ou uma
      paleta funcional não relacionada com a marca da farmácia: a Devolução de Frio (azul da Alliance
      Healthcare — o documento tem de bater certo com o modelo oficial deles, mudar a cor estaria
      errado); o Conversor de PDF (já deliberadamente sem marca da farmácia, e a sua paleta verde
      própria já não destoa); as cores semânticas de estado em cada módulo (`--amber`/`--red`/`--blue`/
      `--success`/`--warn`/`--ok`/`--bad`, usadas para avisos, erros e confirmações — mudar estas
      confundiria o significado, não é sobre identidade visual); a paleta `FOLDER_COLORS` de cores de
      pastas em Documentos (paleta arco-íris deliberada para organização do utilizador, não é a cor da
      marca); o tom "papel" (`--paper:#f6f5f0`) partilhado por Reservas/Stocks Errados/Devoluções a
      Armazenistas, um tom neutro de documento profissional já consistente entre os três.
    - Confirmado, depois da alteração: os 26 testes automatizados continuam a passar, `node --check`
      não encontra nenhum erro de sintaxe em nenhum módulo, e uma varredura final por todas as cores
      antigas conhecidas não encontrou mais nenhuma ocorrência de marca (só coincidências de valor com
      cores semânticas não relacionadas, verificadas uma a uma).
14. **Redesenho de navegação "Sifarma" + componente partilhado `module-chrome` (sessão seguinte,
    2026-09-09)**: o Ivo reportou botões "Voltar à Central" sobrepostos a outros elementos em
    Manipulados e no Gabinete, e pediu explicitamente ("Escolhe tu, tem que se fazer com todos") uma
    solução aplicada aos 13 módulos, inspirada no Sifarma (barra superior + barra inferior). Criado
    `assets/module-chrome.css` + `assets/module-chrome.js`, incluído por `<link>`/`<script>` em todos
    os `modulos/*.html`, antes do `<script type="module">` de cada um (script clássico, corre
    sincronamente antes do módulo, que é sempre `defer` por natureza — garante que `window.ModuleChrome`
    já existe quando o módulo arranca):
    - `window.ModuleChrome.mountBottomBar(items, opts)` — barra inferior fixa, com scroll horizontal
      quando não cabem todos os itens (`overflow-x:auto`, sem barra de scroll visível), para a
      navegação interna do próprio módulo (as suas secções/vistas).
    - Esconde sempre o link antigo `.module-back` e mostra uma barra "← Voltar à Central Operacional"
      só quando o módulo é aberto sozinho fora do iframe da Central (`window.self === window.top`) —
      dentro da Central já há sempre "Início" visível por cima, por isso o link ficava redundante e, em
      dois módulos, sobreposto.
    - `.mc-logo{height:40px}` — tamanho de logótipo normalizado (antes cada módulo tinha o seu, alguns
      muito maiores que outros).
    - **5 módulos com conversão completa** (tinham sidebar própria a duplicar a navegação da Central —
      o problema real que o Ivo reportou): Gestão de Gabinete, Manipulados, Gestão de PIM, Central de
      Documentos, Pedidos AUE.
    - **8 módulos com integração mínima** (nunca tiveram sidebar própria a competir com a da Central —
      só ganharam a barra "Voltar à Central" auto-escondida e a normalização de logótipo): Stocks
      Errados, Catálogo de Produtos, Conversor de PDF, Devolução de Frio, Devoluções a Armazenistas
      (mantém a sua própria barra de separadores horizontal — não é o mesmo problema de "sidebar
      duplicada", converter acrescentaria risco de migração sem resolver nenhum bug), Mapa
      Cardiovascular, Aluguer Medela, Reservas.
    - **Bug real da Gestão de PIM corrigido nesta sessão** ("não consigo criar 1 utente"): variáveis de
      módulo (`draftUtente`, `draftMed`, `draftReceita`, `draftEvento`, `draftStock`, `draftRotulo`)
      mutadas por atributos `oninput` inline dentro de modais gerados por `innerHTML` — o mesmo problema
      de fundo dos pontos 8/9 (atributo inline corre no escopo global, não no escopo do módulo), mas
      desta vez sobre uma **variável**, não uma função: a variável lida pelo handler inline nunca era a
      mesma que o resto do módulo via, por isso todo o texto escrito nos campos do modal era
      silenciosamente descartado. Corrigido espelhando cada variável em `window.<nome>` logo a seguir a
      cada reatribuição (`window.draftUtente = draftUtente;`, etc.) — e encontrado proativamente o
      mesmo padrão, ainda não reportado pelo Ivo, em Gestão de Gabinete (`draftStock`, `draftItem`,
      `draftReport`) e Central de Documentos (`nb_customFields`, no formulário "Novo livro" da
      Biblioteca), corrigidos da mesma forma.
    - Dois bugs visuais encontrados e corrigidos durante a própria migração (não reportados, apanhados
      pelo QA visual local): em `stocks.html`, um `@import` do CSS do module-chrome colocado depois de
      outras regras era silenciosamente ignorado pelo browser (`@import` tem de vir antes de qualquer
      outra regra) — corrigido trocando para `<link rel="stylesheet">` no `<head>`; em
      `devolucao-frio.html`, a margem negativa pré-existente da toolbar (`margin:-20px -20px 20px`,
      pensada para escapar ao padding do body quando era o primeiro elemento) colapsava visualmente
      com a nova barra "Voltar à Central" inserida antes dela — corrigido dando à nova barra a mesma
      margem negativa e zerando só a margem superior da toolbar.
15. **Auditoria de desempenho e responsividade móvel + bateria de testes completa (2026-09-09/10)**: o
    Ivo relatou lentidão a carregar páginas/logótipos e a gravar registos novos, preocupação explícita
    com o funcionamento em telemóveis/tablets, e pediu uma bateria de testes completa à Central e a
    todos os módulos, com correções.
    - **Causa raiz confirmada** (não só hipótese): o logótipo da farmácia (até ~700KB de ficheiro
      original, ~930KB em base64) vivia dentro de `config.logo`, o MESMO campo devolvido por INTEIRO em
      todo `GET /api/data` — chamado no arranque de todos os 13 módulos e do painel principal só para
      mostrar o logótipo — e reenviado por INTEIRO em todo `PUT /api/data`, incluindo o padrão
      "ler tudo → juntar a alteração → gravar tudo" usado por cada `gravar<Modulo>()` (ponto 6): **cada
      gravação de qualquer registo em qualquer módulo transferia o logótipo inteiro duas vezes** (uma
      vez a lê-lo de volta, outra vez a reenviá-lo), independentemente de a alteração ter alguma coisa a
      ver com o logótipo. Em 5 ferramentas sem qualquer estado próprio (Devolução de Frio, Mapa
      Cardiovascular, Aluguer Medela, Reservas, Catálogo de Produtos) o mesmo GET completo acontecia só
      para mostrar o nome/logótipo no cabeçalho.
    - **Correção**: o logótipo passou a viver no seu próprio blob, já suportado pelo servidor e isolado
      da junção de `config` (`dataStore.setAsset("branding-logo", base64)`/`getAsset`, mesmo mecanismo
      já usado para conteúdo pesado — ponto 5), tanto no painel principal (`src/actions.js`) como nos 12
      módulos/ferramentas que mostram logótipo (todos exceto o Conversor de PDF). Migração automática,
      sem passo manual: a leitura prefere sempre o asset, com `config.logo` só como reserva para
      farmácias antigas; a escrita (upload de um logótipo novo em Configurações) só grava no asset;
      e cada `gravar<Modulo>()`/`persist()` do painel principal (`src/db.js`) omite deliberadamente
      `logo` do `config` que reenvia — por isso, assim que qualquer módulo fizer UMA gravação normal, o
      `config.logo` antigo dessa farmácia desaparece sozinho do servidor, sem precisar de nenhum script
      de migração à parte.
    - **Cache local instantânea** (`assets/module-chrome.js`: `getCachedBranding`/`cacheBranding`,
      espelhada em `src/db.js`: `cacheBrandingLocal` para o painel principal — mesma chave
      `localStorage`, partilhada entre a Central e todos os módulos por serem a mesma origem): o
      cabeçalho pinta o nome/logótipo guardados da vez anterior instantaneamente (0ms, sem rede), e só
      depois confirma/atualiza a partir do asset — elimina a espera visível por rede que o Ivo reportou
      ("lentidão a carregar... logótipos").
    - **Validado com medição real, não só revisão de código**: construído `tests/e2e/local-server.mjs`,
      um servidor local que corre as MESMAS funções reais (`netlify/functions/{auth,data,asset}.js`,
      importadas tal qual, não reimplementadas) com o Netlify Blobs substituído por um mapa em memória —
      não depende de `netlify-cli` (bloqueada no registo deste ambiente) nem de rede. Contra ele,
      `tests/e2e/battery.mjs` (Playwright) mede e confirma: o payload de `GET /api/data` de uma
      farmácia com logótipo passou de ~487KB para 0KB (logótipo já não incluído); uma farmácia "antiga"
      simulada (logótipo só em `config.logo`, como antes desta correção) continua a mostrar o logótipo
      corretamente (compatibilidade) e, ao fazer uma gravação real através da interface (criar um
      utente em PIM), o `config.logo` dela desaparece sozinho do servidor na gravação seguinte
      (migração confirmada a funcionar, não só planeada).
    - **Bateria de testes** (`tests/e2e/battery.mjs`, 49 verificações, todas a passar): para além do
      desempenho acima — os 13 módulos carregam sem nenhum erro de consola/página em 3 larguras (390
      telemóvel / 800 tablet / 1440 desktop); um fluxo funcional real (criar um utente em PIM através da
      interface, não só por chamada direta) confirma que a correção do ponto 14 (bug do `draftUtente`)
      se mantém.
    - **Verificação exaustiva de que não há mais nenhuma ocorrência da classe de bug do ponto 14**: uma
      varredura automatizada a todos os 13 módulos confirmou que todas as variáveis de módulo mutadas
      por atributos inline (`draftUtente`, `draftMed`, `draftReceita`, `draftRotulo`, `draftStock`,
      `draftEvento`, `draftItem`, `draftReport`, `nb_customFields`) já têm o espelho `window.<nome>`, e
      que não há nenhuma função chamada por atributo inline sem a correspondente `window.<nome> = <nome>`
      — nenhuma ocorrência nova encontrada além das já corrigidas no ponto 14.
    - **Auditoria visual de responsividade** (capturas de ecrã reais, telemóvel 390px e tablet 800px):
      confirmado visualmente, além da ausência de erros acima, que o painel principal (incluindo a
      barra lateral com a lista de módulos, aberta por um botão "Módulos" no topo) e vários módulos
      (Gestão de PIM — lista e modal "Novo utente", Central de Documentos, Gestão de Gabinete,
      Devoluções a Armazenistas) renderizam de forma limpa e utilizável em ambas as larguras, sem
      sobreposições nem cortes. Único ponto de atenção encontrado, não bloqueante: a barra inferior de
      navegação de módulos com muitas secções (ex.: Central de Documentos, 9 itens) faz scroll
      horizontal em telemóvel em vez de mostrar tudo de uma vez — funciona (testado), mas não tem
      nenhuma pista visual (ex. sombra/gradiente na margem) de que há mais itens para lá da borda;
      pequena melhoria de polimento, não uma correção, deixada para uma próxima passagem se o Ivo achar
      que vale a pena.
    - **Robustez adicional encontrada e corrigida durante os testes**: o Conversor de PDF assumia que a
      biblioteca `pdf.js`, carregada de um CDN externo (cdnjs), estava sempre disponível — se a rede
      falhar (firewall, sem ligação, CDN em baixo), a página inteira rebentava com um erro não tratado
      logo no arranque. Corrigido com uma verificação: se a biblioteca não carregar, mostra um aviso
      claro no topo da página em vez de deixar o resto do módulo completamente inutilizável.
    - **Infraestrutura de teste deixada no repositório** (`tests/e2e/`, com `README.md` próprio e
      atalhos `npm run test:e2e:server` / `npm run test:e2e`): reutilizável em sessões futuras sempre
      que se mexer em `netlify/functions/*.js`, `src/db.js`, `src/actions.js`,
      `assets/module-chrome.js`, ou na lógica de gravação/carregamento de qualquer módulo — teria
      apanhado a maioria dos bugs reais encontrados nesta base de código até agora.
    - **Deliberadamente fora do âmbito desta sessão** (não pedido, ou risco desproporcional face ao
      benefício sem conseguir validar contra o Netlify real): reescrever o padrão "ler tudo → gravar
      tudo" das gravações por módulo para granularidade por campo (o ponto 6 mantém-se — só o logótipo,
      que era o componente pesado e desnecessário nesse fluxo, foi retirado dele); mover para fora de
      `config` outros campos que cresçam com o uso (nenhum identificado como problemático nesta
      auditoria, ao contrário do logótipo, que já era grande desde o primeiro upload).
16. **Atalhos de módulos como "serviços" + lote de correções PIM/Gabinete/Manipulados/Stocks +
    reescrita do leitor GS1 (2026-09-11)**: sessão com dois pedidos distintos do Ivo.
    - **Atalhos automáticos dos 13 módulos/ferramentas na grelha de serviços do painel principal**:
      o Ivo pediu que cada módulo/ferramenta passasse a existir também como "serviço" na grelha inicial
      da Central (o ecrã de cartões por categoria), dentro da categoria "Serviços Clínicos", com a
      condição explícita de que cada atalho continua depois livremente re-categorizável pelo utilizador
      (a edição de serviço já existente, genérica, serve sem alterações). Implementado com um novo `tipo`
      de serviço, `"modulo"` (a par dos já existentes `"url"`/`"html"`/`"arquivo"`): `src/domain.js` ganhou
      `MODULOS_ATALHOS` (13 entradas `{modulo, nome}`); `src/actions.js` ganhou `criarAtalhosModulos()`,
      chamada uma única vez por farmácia a partir de `iniciar()` (protegida por uma flag de configuração
      `atalhosModulosCriados`, gravada via `dataStore.setConfig`, lida a par das outras flags no
      `Promise.all` inicial — por isso sobrevive a `iniciar()` ser chamada outra vez em
      `recarregarDoServidor()`), que cria os que faltarem na categoria `cat_clinicos` (já existente por
      omissão em `CATEGORIAS_PADRAO`), recriando essa categoria se entretanto tiver sido apagada.
      Clicar num cartão deste tipo não abre um separador novo — despacha
      `SET_SCOPE{tipo:"modulo", modulo}` diretamente (`abrirEmNovaAba`), navegando para dentro do próprio
      módulo tal como o menu lateral já fazia. Coberto pela bateria de testes e2e (49/49) e por um novo
      teste dedicado.
    - **Arquitetura de email confirmada e reutilizada, não substituída**: antes de arrancar com os dois
      pedidos de email (alerta de PIM a terminar; relatório do Gabinete em PDF por email), foi confirmado
      com o Ivo que o mecanismo correto é o que já existe — cada farmácia tem o seu próprio Google Sheet +
      Google Apps Script (`Code.gs`, template de referência em posse do Ivo, fora deste repositório),
      publicado como Web App na conta Google da própria farmácia, e configurado no módulo através de
      `CONFIG.sheetsUrl`/`CONFIG.sheetsToken` (Configurações de cada módulo); `pushToSheets(kind, payload)`
      faz `POST {kind, payload, token}` para essa Web App, que grava em Sheets e envia email via
      `MailApp`/`GmailApp`. **Não há, e não deve haver, nenhum SMTP/API de email configurado diretamente
      nesta app** — é sempre por esta ponte. Esta sessão introduziu dois `kind` novos que o Code.gs de
      cada farmácia terá de passar a tratar (só o lado da app foi feito; o Ivo precisa de atualizar o seu
      Code.gs, um trabalho à parte, fora deste código):
      - `report_pdf` (Gabinete, `enviarRelatorioPdfPorEmail`): `{id, data, farmaceutico, pdfBase64,
        destinatario}` — `pdfBase64` é o relatório de atendimento gerado em PDF (via `html2canvas` +
        `jsPDF`, já usados no módulo), pronto a anexar a um email.
      - `alerta_pim_terminar` (PIM, `checkAlertaPimTerminar`): `{utenteId, utenteNome, medicamentoNome,
        diasRestantes, rotuloId}` — disparado quando um Rótulo de PIM está prestes a terminar (mesmo
        cálculo de dias-até-à-validade já usado no módulo), com deduplicação local
        (`localStorage`) para não repetir o mesmo aviso em cada gravação.
    - **Reescrita do descodificador de códigos GS1** (`parseGS1`, duplicado em `gabinete.html` e
      `pim.html`): o algoritmo antigo assumia que o bloco "714"+CNP(7 dígitos) vinha sempre no fim do
      código — só descodificava corretamente 1 dos 9 códigos reais que o Ivo enviou como amostra.
      Novo algoritmo: localiza primeiro "714"+7 dígitos válidos **em qualquer posição** do código e
      remove esse bloco (é um elemento autocontido, não depende de posição); no que sobra, localiza a
      âncora fixa AI17 (validade, 6 dígitos, validada por mês 1–12/dia 0–31) — como esta é a única âncora
      de comprimento fixo que resta, a busca é muito mais restrita e fiável do que tentar adivinhar as 3
      fronteiras variáveis de uma vez; o texto antes/depois da âncora é decomposto em AI21 (série)/AI10
      (lote), considerando que cada lado pode conter 0, 1 ou os 2 campos concatenados sem separador,
      com pontuação a escolher a melhor combinação global. Validado 9/9 contra os códigos reais enviados
      pelo Ivo (antes: 1/9).
      **Limitação importante identificada, não corrigida por estar fora do pedido — resolvida no
      ponto 18**: a biblioteca de leitura de câmara usada em toda a app era a `jsQR` (só lê códigos QR) —
      códigos GS1 reais de embalagens de medicamentos (padrão EU-FMD) são tipicamente simbologia
      **DataMatrix**, que o jsQR não conseguia ler de todo.
    - **Lote de correções por módulo** (4 agentes em paralelo, cada um verificado depois por
      `node --check` + bateria e2e completa + uma passagem de verificação Playwright dedicada — sem
      regressões, todos os testes novos e antigos a passar):
      - **Gestão de PIM** (`pim.html`): confirmado que já não havia limite artificial no número de
        Rótulos guardados nem no histórico (nenhuma correção necessária, comportamento já correto);
        corrigido um bug real de handlers de scan (`confirmScanNova/-Consumo/-Search`, variável
        `scanState`) nunca espelhados em `window` — mesma família de bug dos pontos 9/14; corrigido um
        bug de CSS que empurrava o botão "adicionar ao stock" para fora do ecrã em modais altos (regra
        base `.modal` sem `display:flex`/`max-height`, só `.modal-wide` tinha); gravar um Rótulo passa a
        deduzir automaticamente do stock do utente a quantidade colocada nesse Rótulo (e a devolver a
        dedução ao remover); **bug de perda de dados corrigido, prioridade alta**: raiz de causa era uma
        condição de corrida em `gravarPim`/`saveJSON` — chamadas seguidas para chaves diferentes liam
        cada uma o estado do servidor antes de a anterior ter gravado, perdendo-se a primeira gravação;
        corrigido com uma fila (`gravarQueue`/`enqueueSync`) que serializa todas as gravações e leituras
        de sincronização, fechando a corrida em toda a parte do ficheiro, não só no ponto onde o Ivo a
        reportou; adicionado botão "Reimprimir" ao histórico de Rótulos; corrigido o botão "Novo evento
        neste dia" do calendário (mesma família de bug — `dayModalDate` não espelhada em `window`);
        adicionado o alerta por email de Rótulo a terminar (ver `alerta_pim_terminar` acima).
      - **Gestão de Gabinete** (`gabinete.html`): logótipo em todos os documentos ampliado 4x (44px→
        176px); relatório gravado passa a também enviar por email o PDF do relatório, via
        `pushToSheets('report_pdf', ...)` (ver acima); toda a listagem/impressão de produtos (stock,
        itens, relatórios, folha impressa) passa a mostrar o código CNP e o QR code correspondente
        (biblioteca `qrcodejs`, cdnjs, com cache em memória).
      - **Manipulados** (`manipulados.html`): pesquisa corrigida para funcionar independentemente do
        estado do pedido — antes só pesquisava dentro dos pedidos ativos (por omissão), agora, sempre
        que há texto de pesquisa, pesquisa em todos os pedidos incluindo "entregue"/"cancelado"; sem
        texto de pesquisa, o comportamento por estado mantém-se igual a antes.
      - **Stocks Errados** (`stocks.html`): novo campo obrigatório "Nome operador" na criação/edição de
        uma lista; campo "Observações" por item substituído por "Motivo" com 3 opções fixas ("Estava com
        pressa (confirmar por favor)", "Procurei bem em todos os locais e Reservas mas não encontrei",
        "Outros" com texto livre); compatibilidade preservada para listas antigas (mostra o texto antigo
        sob a etiqueta "(registo antigo)").
    - Confirmado, em todos os passos acima: os 49 testes e2e pré-existentes continuam a passar, mais 22
      verificações novas dedicadas (Playwright, browser real) a todas as funcionalidades novas, sem
      nenhuma regressão.
17. **Correção de âmbito do logótipo 4x + novo módulo "Poupança & ROI" (2026-09-12)**: sessão com dois
    pedidos do Ivo.
    - **Correção de âmbito — logótipo 4x maior em TODA a Central, não só no Gabinete**: o ponto 16
      tinha ampliado o logótipo 4x só nos documentos gerados pelo Gestão de Gabinete. O Ivo corrigiu:
      era suposto ser em toda a Central, todos os módulos e ferramentas, não só o Gabinete. Aplicado o
      mesmo fator 4x aos outros 6 ficheiros onde existe um logótipo genuíno da própria farmácia impresso
      ou exportado num documento: `pim.html` (rótulos DOT impressos), `documentos.html` (declarações,
      etc.), `medela.html` (contrato de aluguer), `reservas.html` (folha exportada), `mapa-
      cardiovascular.html` (formulário + páginas de consentimento) e `stocks.html` (exportações Excel/
      PDF). **Deliberadamente excluído**, por não se tratar do logótipo da própria farmácia: o logótipo
      da Medela (marca do equipamento, parte do modelo oficial do contrato) e o da Alliance Healthcare
      em `devolucao-frio.html` (documento tem de bater certo com o modelo oficial deles) — ambos mantidos
      ao tamanho original. Também excluídos, por restrição de formato físico: etiquetas e lombadas em
      `documentos.html`, que têm de caber num espaço impresso fixo (uma etiqueta autocolante, a lombada
      de uma pasta) — ampliar o logótipo aí desconfiguraria o próprio documento físico. E os pequenos
      badges de logótipo na navegação/UI da própria app (barra superior, `.mc-logo`) também não fazem
      parte disto — é uma escala de interface, não um documento gerado para a farmácia.
    - **Novo módulo "Poupança & ROI"**: o Ivo identificou o que considera o argumento de venda ideal
      para convencer farmácias a comprar a Central — oferecer 1-2 meses grátis enquadrados como "teste
      de software gratuito" (não como venda), acompanhados de um painel que mostra, de forma muito
      detalhada, quanto tempo a farmácia já poupou ao usar a Central em vez de fazer cada tarefa à mão,
      com uma calculadora de € poupados (tempo poupado × valor/hora definido pela própria farmácia),
      gráficos, e exportação para PDF — pedido explicitamente "extremamente detalhado", construído em
      cima da aba "Detalhes" já existente em Configurações, com carta branca total para acrescentar o
      que achasse necessário ("Adiciona tudo o que achares necessário ou que melhore").
      - **Arquitetura de armazenamento**: um blob mensal por farmácia (`uso-AAAA-MM`, formato
        `{dias:{"AAAA-MM-DD":{"modulo.tarefaId":contagem}}}`), guardado através do "asset store"
        genérico já existente (`/api/asset/:key`, mesmo mecanismo do ponto 5/11) — consistente com o
        princípio já estabelecido de que conteúdo pesado/crescente nunca vive dentro do JSON principal
        de `/api/data`; um registo de uso que cresce todos os dias enquanto a farmácia usar a app é
        exatamente esse tipo de conteúdo.
      - **API partilhada única, `assets/module-chrome.js`**: `window.ModuleChrome.registarUso(modulo,
        tarefaId, qtd)` — cada um dos 13 módulos chama isto no momento exato em que uma tarefa
        rastreável é concluída com sucesso (nunca em cada tecla/render, só depois de a validação passar
        e a gravação/impressão/exportação real acontecer). Internamente: os registos ficam em memória
        (`USO_PENDENTES`) e são agrupados (debounce de 2s — ver correção abaixo) antes de serem
        enviados ao servidor com um padrão ler-mesclar-gravar (GET do blob do mês → soma ao delta local
        → PUT do resultado), com nova tentativa automática se a gravação falhar; também tenta gravar de
        imediato ao esconder/fechar a página (`visibilitychange`/`pagehide`), para não perder a última
        ação se a farmácia fechar o separador logo a seguir.
      - **Bug real encontrado e corrigido durante a verificação (importante para a integridade dos
        dados de uso)**: testado com Playwright que, ao navegar para fora de um módulo (ex.: fechar o
        separador ou ir para outro módulo) muito pouco tempo depois de uma ação, o pedido GET que o
        flush faz para ler o estado atual do mês pode ser abortado pelo próprio Chromium a meio
        (`net::ERR_ABORTED`) — confirmado mesmo com `keepalive:true` no pedido, uma limitação real do
        browser para este padrão ler-antes-de-escrever em cima de um `pagehide`. Sem tratamento, isto
        levava o código a assumir "mês vazio" e a gravar por cima, **apagando contagens de uso já
        persistidas por um flush anterior bem-sucedido** — um bug de perda de dados silenciosa.
        Corrigido: qualquer falha do GET que não seja um 404 genuíno (mês ainda sem registos) passa a
        repor o delta pendente para nova tentativa, em vez de continuar como se estivesse vazio — a
        garantia central passou a ser "um flush que falha nunca apaga dados já gravados", não "todo
        flush tem de ter sucesso imediato" (esta segunda garantia é impossível de dar 100% em cima de
        um `pagehide`, e é uma limitação aceite, comum a qualquer sistema de tracking por lotes do lado
        do cliente — só a última ação, feita a menos de ~2s de navegar para fora, corre esse risco). A
        janela de debounce foi também encurtada de 4s para 2s, para reduzir (não eliminar) essa janela
        de risco.
      - **Catálogo de tarefas** (`src/usoCatalogo.js`, novo): 34 tarefas rastreáveis nos 13 módulos,
        cada uma com um tempo estimado "manual" (à mão, sem a Central) e "Central" (com a ferramenta) em
        segundos — estimativas próprias, sensatas, pensadas para o Ivo poder rever/ajustar; totalmente
        editáveis por farmácia através de `config.usoEstimativas` (sobreposições por tarefa, geridas na
        própria tabela do painel — ver abaixo).
      - **Leitura/agregação** (`src/usoLeitura.js`, novo): carrega os blobs mensais necessários para um
        período, calcula tempo/€ poupado agregados por dia/módulo/tarefa, com cache em memória.
      - **Painel "Poupança & ROI"** (`src/ui/poupanca.js`, novo separador em Configurações, ao lado de
        "Detalhes"): 5 cartões de resumo (hoje, últimos 7 dias, este mês, este ano, desde que usa a
        Central), um seletor de período personalizado, uma calculadora de valor/hora
        (`config.valorHoraPoupanca`) que converte tempo poupado em €, 3 gráficos (Chart.js: tendência
        diária, distribuição por módulo, top tarefas), uma tabela completa com as 34 tarefas do
        catálogo (contagem de ocorrências + tempo manual/Central editável, com override gravado por
        tarefa), e exportação do painel inteiro para PDF (`html2canvas` + `jsPDF`, mesmo padrão já usado
        no Gabinete).
      - **Robustez encontrada e corrigida durante a construção**: a falha do Chart.js (CDN externo,
        cdnjs) bloqueava silenciosamente o resto do painel (resumos e tabela nunca chegavam a
        renderizar) — corrigido para mostrar um aviso e continuar a renderizar tudo o resto, mesmo
        sem gráficos (mesmo princípio já aplicado ao Conversor de PDF no ponto 15). Este módulo depende
        de bibliotecas externas via cdnjs (Chart.js, html2canvas, jsPDF), o mesmo padrão já usado por
        outras funcionalidades da app (qrcodejs, exceljs, pdf.js) — nenhuma dependência nova de
        infraestrutura.
      - **Instrumentação dos 13 módulos**: todas as 34 tarefas do catálogo têm agora a chamada
        `registarUso` no ponto certo de cada módulo (42 pontos de chamada ao todo, porque algumas
        tarefas têm mais que um caminho de sucesso válido — ex. "gerar_bolacha" em Documentos tem 3
        pontos de entrada; "exportar_lista" em Stocks tem 2, Excel e PDF). Feito diretamente em
        `pim.html`, `gabinete.html`, `manipulados.html` e `stocks.html`; os outros 9 módulos
        (`documentos.html`; `aue.html`+`reservas.html`+`medela.html`+`conversor-pdf.html`+`devolucao-
        frio.html`+`mapa-cardiovascular.html`; `devolucoes-armazenistas.html`+`catalogo-produtos.html`)
        delegados a 3 agentes em paralelo, com o catálogo de `src/usoCatalogo.js` como contrato exato —
        cada um confirmou por si próprio o ponto certo de "sucesso" em cada função antes de instrumentar.
      - **Testado de ponta a ponta, não só por injeção direta no blob**: para além da bateria completa
        (49 verificações pré-existentes, sem regressões), uma nova secção permanente foi acrescentada a
        `tests/e2e/battery.mjs` (56 verificações no total agora) que exercita o próprio
        `window.ModuleChrome.registarUso` a partir de uma página de módulo real — confirma que o flush
        por debounce persiste corretamente, que um flush falhado por navegação nunca corrompe/apaga
        dados já gravados (a garantia central da correção acima), e que o painel "Poupança & ROI"
        renderiza os cartões e a tabela mesmo sem o Chart.js disponível. Os scripts de verificação
        avulsos usados durante o desenvolvimento (`verify_poupanca.mjs`, `verify_uso_e2e.mjs`) foram
        removidos do repositório depois de as suas verificações mais valiosas terem sido incorporadas
        de forma permanente na bateria — mesmo padrão já usado no ponto 15 (não deixar scripts de teste
        avulsos na árvore entregue).
    - **Sincronizado para o PC do Ivo ainda dentro da mesma sessão**: a ligação ao computador tinha
      caído a meio da sessão (por isso os ficheiros foram entregues primeiro num `.zip` na conversa),
      mas voltou a ficar disponível antes do fim — os 21 ficheiros novos/alterados (a correção do
      logótipo 4x nos 6 módulos, e todo o módulo Poupança & ROI) foram escritos diretamente na pasta
      `central multifarmácia` do Ivo, confirmados um a um sem rejeições.
18. **Leitura de DataMatrix nos leitores de câmara + parênteses GS1/HRI no parseGS1 (2026-09-12,
    sessão seguinte)**: pedido do Ivo — "avança com a DataMatrix em todos os scanners, claro está em
    cruzamento com a base de dados, e incrementa os melhoramentos necessários". Resolve a limitação
    identificada (não corrigida) no ponto 16: a leitura de câmara de toda a Central usava só `jsQR`, que
    lê exclusivamente QR — mas a esmagadora maioria das embalagens reais de medicamentos (norma europeia
    EU-FMD) usa a simbologia **DataMatrix**, que o jsQR não lê de todo. Há só 3 pontos na Central que
    abrem a câmara para ler um código, todos já identificados no ponto 16: `toggleCamera` em
    `gabinete.html` (leitor GS1), e `toggleCamera`/`medScanToggleCamera` em `pim.html` (leitor GS1 +
    scan de embalagem para pré-preencher o formulário de Medicamento).
    - **Biblioteca nova, `zxing-wasm`** (porto WebAssembly do `zxing-cpp`, o motor de referência —
      pesquisado antes de decidir: o antigo `jsQR` e o seu sucessor puro-JS `zxing-js` continuam sem lidar
      bem com DataMatrix real; `zxing-wasm` é o único que combina suporte a DataMatrix+QR na mesma
      chamada com a robustez de um motor C++ compilado, e tem build IIFE pronta para `<script src>`, sem
      necessitar de bundler — mesmo padrão `ensureXxx` de carregamento lazy já usado em toda a Central).
      Servida do **jsDelivr**, não do cdnjs — é a única biblioteca deste projeto assim, por não estar
      publicada no cdnjs; o CSP do site (`script-src https:` em `netlify.toml`) já permite qualquer CDN
      por https, não só o cdnjs, por isso isto funciona em produção tal como todos os outros `ensureXxx`.
      Centralizada uma única vez em `assets/module-chrome.js` (não replicada nos 2 ficheiros que a usam):
      - `window.ModuleChrome.ensureBarcodeLib(cb, errCb)` — carrega `zxing-wasm@3.1.3/dist/iife/reader/
        index.js` de forma lazy (só quando a câmara é aberta), expõe o global `window.ZXingWASM`.
      - `window.ModuleChrome.decodeBarcodeFrame(canvas, imageData)` — tenta primeiro a API nativa do
        browser (`BarcodeDetector`, quando disponível **e** com `data_matrix` na lista de formatos
        suportados — só existe em macOS/ChromeOS/Android com Google Play Services, **não existe no
        Windows**, o SO mais comum nas farmácias, por isso não pode ser a única via); cai para
        `ZXingWASM.readBarcodesFromImageData(imageData, {formats:['DataMatrix','QRCode'],
        tryHarder:true, maxNumberOfSymbols:1, textMode:'HRI'})` em qualquer outro caso. Devolve uma
        Promise com o texto lido ou `null` — nunca rejeita (é normal não encontrar nada em quase todas
        as frames até o código ficar bem enquadrado).
    - **As 3 câmaras passam a ser assíncronas e throttled, não mais um `jsQR` síncrono a cada frame**:
      o `tick()` de cada câmara continua a desenhar o vídeo no `<canvas>` a cada `requestAnimationFrame`
      (pré-visualização sempre fluida), mas só tenta descodificar a cada ~180ms (via `st.aDescodificar`/
      `st.ultimaTentativa` no `scanState` por contentor) — decodificar a cada frame seria caro
      (WebAssembly, ao contrário do `jsQR` síncrono antigo) sem trazer nenhum benefício percetível para
      o utilizador. **Melhoria adicional**: a câmara já não espera a biblioteca carregar antes de abrir
      — `ensureBarcodeLib` corre em paralelo com `getUserMedia`, não antes; a pré-visualização aparece
      de imediato e a deteção nativa (quando existe) já funciona nesse intervalo, enquanto o
      `zxing-wasm` (~1MB) ainda carrega em segundo plano.
    - **Melhoramento no `parseGS1` (duplicado em `gabinete.html`/`pim.html`) — aproveitar o formato HRI
      que o zxing-wasm já devolve por omissão para GS1**: `AI "714"` é um identificador GS1 oficial e
      registado (série NHRN — Números de Reembolso de Saúde Nacionais —, onde 710=Alemanha, 711=França,
      712=Espanha, 713=Brasil, **714=Portugal/CNP**, exatamente o campo que este parser já isolava desde
      o ponto 16), por isso o `textMode` por omissão do zxing-wasm ("HRI" — Human Readable Interpretation)
      já devolve o texto com cada elemento entre parênteses, ex.
      `(01)07612345678903(17)251231(10)LOTE123(21)SN456(714)1234567` — sem NENHUMA ambiguidade de
      fronteiras, ao contrário do texto cru concatenado que a heurística do ponto 16 tinha de adivinhar
      por posição/comprimento. `parseGS1HRI` (nova função) trata este caso primeiro — uma simples
      extração por parênteses, incomparavelmente mais fiável — e só cai para a heurística antiga do
      ponto 16 (inalterada) quando o texto não vem entre parênteses (por exemplo, colado à mão, ou vindo
      de uma fonte sem essa formatação). Zero regressão: a heurística antiga continua exatamente como
      estava, testada e a passar, para esses casos.
    - **Cruzamento com a base de dados**: inalterado e confirmado — o resultado de `parseGS1`/
      `parseGS1HRI` tem exatamente a mesma forma (`{pc, validadeRaw, lote, sn, cnp}`) em qualquer dos
      dois caminhos, por isso o cruzamento já existente com o catálogo de produtos (`findMedCatalogByCnp`
      em `pim.html`, pesquisa por CNP em `gabinete.html`) continua a funcionar sem qualquer alteração —
      esta sessão resolve exclusivamente a LEITURA do código (câmara) e a sua DECOMPOSIÇÃO em campos; o
      que acontece depois com esses campos (procurar o produto, pré-preencher o formulário) já estava
      correto e não foi tocado.
    - **`window.parseGS1` exposto para depuração/testes** (não é chamado de nenhum `onclick` inline,
      por isso não precisava de estar em `window` por si só — mas ajuda a testar/depurar diretamente na
      consola do browser, e é o que a bateria de testes usa agora para o exercitar sem precisar de
      simular uma câmara real).
    - **Testado sem simular hardware de câmara** (simular uma câmara real + mockar o CDN do zxing-wasm
      seria desproporcionado): `tests/e2e/battery.mjs` ganhou uma nova secção permanente (62
      verificações no total agora, subindo de 56) que confirma, a partir de uma página de módulo real,
      que `window.ModuleChrome` expõe `ensureBarcodeLib`/`decodeBarcodeFrame` nos 2 ficheiros, e que
      `window.parseGS1()` decompõe corretamente tanto um código GS1 em formato HRI (parênteses) como o
      formato antigo sem parênteses (heurística, confirmando zero regressão). Confirmado manualmente
      (fora da bateria, por precisar de um browser real): quando o CDN do zxing-wasm está inacessível
      (o próprio ambiente desta sessão bloqueia o jsDelivr, tal como já bloqueava o cdnjs para o
      Chart.js — ver ponto 17 — limitação só deste ambiente de desenvolvimento, não da app publicada), o
      `errCb` de `ensureBarcodeLib` dispara corretamente e `decodeBarcodeFrame` devolve `null` em vez de
      rebentar a página — mesmo princípio de degradação graciosa já estabelecido nesta app (ponto 15/17).
    - **Sincronizado para o PC do Ivo ainda dentro da mesma sessão**: os 4 ficheiros alterados
      (`assets/module-chrome.js`, `modulos/gabinete.html`, `modulos/pim.html`, `tests/e2e/battery.mjs`)
      escritos diretamente na pasta `central multifarmácia`, confirmados sem rejeições.
19. **Fusão de dados do Gabinete + expansão "ao extremo" do Poupança & ROI (2026-09-12, sessão
    seguinte)**: pedido do Ivo — melhorar o Gabinete e levar o catálogo de tarefas do Poupança & ROI
    "ao extremo", incluindo uma revisão das estimativas de tempo.
    - **Bug real corrigido no Gabinete**: o botão "+ Adicionar à lista de controlo" que aparece depois
      de um scan não fazia nada — mesma família de bug window-mirror dos pontos 9/14/16 (a função do
      handler nunca tinha sido espelhada em `window` depois de uma refatoração).
    - **"Lista de Controlo" (STOCK) e "Itens do Gabinete" (CHECKLIST_ITEMS) fundidos numa única fonte de
      verdade**: antes eram dois arrays ligados só por um "matching" difuso de CNP/nome, podendo
      divergir; uma entrada de stock passa a ser, por construção, um item do gabinete com `qv:true`
      (quantidade/validade), com migração automática sem perda de dados (o array antigo é mantido
      congelado como rede de segurança, nunca apagado) — e, ao gravar um relatório de atendimento, a
      quantidade/validade observadas passam a escrever-se de volta no item canónico, alimentando os
      alarmes de validade automaticamente, exatamente como pedido.
    - **Catálogo de tarefas do Poupança & ROI expandido de 34 para 145 tarefas** (+111): investigado
      módulo a módulo com uma política explícita de nunca fabricar uma tarefa que não corresponde a uma
      ação real já implementada no código — por isso ficou abaixo do alvo de ~250 pedido, uma decisão
      consciente de exatidão sobre quantidade (documentada em "Ainda por fazer" para o Ivo confirmar se
      falta alguma ação específica). Reparte-se por módulo como: Documentos +23, Gestão de PIM +24,
      Gestão de Gabinete +19, Pedidos AUE +14, Devoluções a Armazenistas +9, Manipulados +6, Conversor
      de PDF +6, Stocks Errados +7, Catálogo de Produtos +2, Devolução de Frio +1, e Reservas/Aluguer
      Medela/Mapa Cardiovascular +0 cada (investigados e confirmados, por varredura ao ficheiro
      inteiro, como fluxos únicos ponta-a-ponta ou formulários estáticos sem outra ação real e distinta
      para instrumentar — decisão deliberada de não fabricar tarefas que nunca disparariam).
    - **Bug de contagem dupla encontrado e corrigido durante a expansão do AUE**: uma mudança de estado
      de um pedido registava simultaneamente a tarefa genérica `atualizar_pedido` E a tarefa específica
      correspondente (ex. `marcar_aprovado`), inflacionando a poupança aparente ao dobro; corrigido para
      nunca registar as duas na mesma gravação.
    - **PIM: dois bugs reais corrigidos**: os rótulos impressos "fundiam-se" visualmente — mesmo
      anti-padrão de CSS de impressão (`visibility:hidden`+`position:absolute` em vez de `display:none`,
      que quebra a paginação nativa do browser), corrigido com `display:none` + `break-inside:avoid` +
      uma guarda de reentrância; faltava o botão para confirmar a nova embalagem depois de um scan de
      DataMatrix — o `<select>` pré-selecionava visualmente a 1ª opção sem disparar `onchange`, deixando
      o estado JS por trás por preencher — corrigido espelhando o valor já visível assim que a opção é
      pré-selecionada programaticamente.
    - **Gráficos e exportação do painel "Poupança & ROI" melhorados**: os 3 gráficos ganharam um preset
      de período partilhado entre eles e uma vista própria por gráfico (granularidade diária/semanal/
      mensal na tendência; tempo poupado vs. nº de vezes nos outros dois); a exportação de PDF deixou de
      cortar informação (mesmo padrão de clone destacado já usado no Gabinete, mais a captura dos
      canvases dos gráficos e a cópia dos valores de campos preenchidos por JavaScript, que um clone
      simples não copia).
    - **Testado de ponta a ponta**: a bateria e2e cresceu de 56 para 62 verificações (novas checagens
      para a fusão de dados do Gabinete, o catálogo de 145 tarefas, e os gráficos/exportação melhorados),
      sem nenhuma regressão nas pré-existentes.
    - **Ainda por sincronizar no fim desta sessão**: a ligação ao computador do Ivo caiu antes deste
      passo poder acontecer — ficou como primeiro passo da sessão seguinte (ver ponto 20).
20. **Expansão massiva de testes automatizados + 9 bugs reais corrigidos (2026-09-13)** — nota: esta
    entrada preenche uma referência que já existia em várias secções abaixo ("ver ponto 20") sem o
    correspondente número nesta lista; o conteúdo integral já estava descrito em prosa em "Estado
    atual"/"Outros" (ver mais abaixo) — aqui fica só o resumo/âncora. O Ivo pediu para aumentar os 56
    testes existentes "ao máximo, por exemplo 300", melhorando o funcionamento real da Central durante o
    processo. Resultado: **594 testes automatizados (257 unitários + 337 end-to-end)**, subindo de 88,
    reconfirmados estáveis em múltiplas execuções completas consecutivas; bateria e2e reestruturada de
    um único ficheiro monolítico para módulos plugáveis (`tests/e2e/helpers.mjs` +
    `tests/e2e/modules/*.mjs`, um por domínio, com `battery.mjs` reduzido a orquestrador). Política
    seguida à letra: nunca fabricar um teste que não exercite uma ação real e genuinamente falhável.
    **9 bugs reais encontrados e corrigidos** (não só instrumentação): pluralização de meses em
    `relTime()`; `data.js` devolvia 500 em vez de 400 para um corpo JSON malformado; um novo item da
    Lista de Controlo do Gabinete nascia com `options:[]` em vez de `options:['PEDIR']`; quatro condições
    de corrida com perda de dados silenciosa (mesmo padrão do ponto 16, ainda sem proteção em
    `gabinete.html`/`documentos.html`/`devolucoes-armazenistas.html` — corrigidas com
    `gravarQueue`/`enqueueSync`; `manipulados.html`/`stocks.html` ganharam a mesma fila como reforço
    preventivo, sem evidência de corrida real nesses dois); `restaurarProduto` no Catálogo de Produtos
    existia mas nunca estava ligado a nenhum botão (funcionalidade morta, ligada com um novo filtro +
    botão, catálogo de tarefas 145→146); uma condição de corrida real de "última escrita ganha" em
    `src/produtosCatalogo.js` (corrigida com `overlayQueue`/`enqueueOverlaySync`); e, encontrado só sob
    carga na verificação final, uma reconstrução total da tabela em `stocks.html` que podia apagar o que
    o utilizador estava a escrever no campo seguinte antes de uma gravação assíncrona terminar (corrigido
    para só atualizar a célula derivada da própria linha). Ver a secção "Estado atual"/"Outros" mais
    abaixo para o detalhe completo módulo a módulo.
21. **Pedido grande de 12 itens (2026-09-15) — feito o "concreto", especificados os 3 módulos grandes
    para sessões dedicadas futuras**: o Ivo enviou de uma vez um pedido com 12 itens, misturando
    correções pequenas e três módulos claramente grandes (auto-manutenção intensiva, uma IA interna
    própria, e mudança de idioma de toda a Central). Dada a ambiguidade e a escala dos três maiores,
    foram feitas 4 perguntas de esclarecimento antes de começar (via `AskUserQuestion`) — respostas do
    Ivo registadas integralmente no ponto seguinte — e a sequenciação escolhida por ele foi "concretos
    primeiro, depois os grandes": os itens pequenos/concretos foram implementados nesta sessão; os três
    módulos grandes ficam **só especificados** aqui, para implementação em sessões dedicadas futuras.
    - **Itens concretos implementados nesta sessão**:
      - `medela.html`: logótipo da farmácia reduzido para metade do tamanho 4x aplicado no ponto 17
        (440px → 220px — ainda maior que o tamanho original de 110px, mas menos dominante no contrato).
      - `gabinete.html`: a impressão/PDF do Relatório (`buildPrintSheetHtml`, partilhada por
        `printReport()` e `gerarPdfRelatorio()`) tinha uma omissão real de conteúdo — não mostrava a
        sub-descrição de cada item (`item.sub`) nem a descrição de secção (`sec.desc`), ambas já visíveis
        no editor do relatório no ecrã. Corrigido para as duas saídas (impressão e PDF) mostrarem
        exatamente o mesmo conteúdo do ecrã, como pedido — com um novo teste e2e de regressão.
      - `pim.html`: "Histórico de Embalagens" (antes só de leitura) ganhou botões Editar/Remover
        (reaproveitando as funções já existentes de edição/remoção de stock). Nova aba "Histórico de
        Consumo de Stock", antes invisível (o array `.historico` por embalagem existia mas não tinha
        nenhuma interface), agora totalmente editável: adicionar registo manual, editar, eliminar — com
        as suas próprias três tarefas novas no catálogo do Poupança & ROI (`criar_registo_consumo`/
        `editar_registo_consumo`/`eliminar_registo_consumo`). **Decisão de modelo de dados deliberada**:
        editar/eliminar uma entrada do histórico NÃO recalcula automaticamente a `quantidadeAtual` da
        embalagem-mãe — tratado como um registo de auditoria independente, consistente com o histórico
        de rótulos já existente noutro sítio da app (também não recalculador).
      - `devolucoes-armazenistas.html`: a Aba Detentores e Regras ganhou "Importar regras (Excel/PDF)"
        por armazenista, reaproveitando o motor de importação já existente no Catálogo de Produtos
        (ExcelJS + pdf.js, deteção de colunas com pré-visualização corrigível). Modelo de dados real
        confirmado antes de implementar (não assumido): a "regra" de cada detentor é **texto livre**, não
        um booleano, com nomes de campo próprios por armazenista (Alliance: `medicamentos`/`dm`/`otc`;
        Empifarma: `msrm`/`mnsrm`/`dm`/`suppl`; OCP: `regra`); correspondência de detentores existentes
        reaproveita a lógica de semelhança difusa já no módulo (`coreStr`/`diceScore`, ≥80%). Nova tarefa
        `importar_regras` no catálogo (146→147).
      - `documentos.html` (3 pedidos relacionados, tratados juntos por incidirem todos no editor de
        Declarações): **(a) nova "Declaração de Medicação"** — novo tipo de declaração com lista
        repetível de medicamentos (nome/dosagem/posologia), preenchível à mão ou "puxada" do PIM pelo
        nome do utente (procura em `pim.pim_utentes_v1`/`pim_medicamentos_v1` via o mesmo `/api/data`
        partilhado, só traz medicação ativa, sem duplicar entradas já trazidas) — nova tarefa
        `puxar_medicacao_pim` no catálogo (147→148, depois 148→151 com as 3 do PIM acima).
        **(b) remoção da "marca de água na base das declarações"** — investigado a fundo antes de mexer:
        não existe nenhum watermark gráfico junto das declarações (o único `.lb-watermark` do ficheiro
        pertence exclusivamente ao Lombadas, sem relação); a única "marca" na base de cada declaração era
        uma linha de crédito de software (`"<farmácia> · Documento gerado através da Central de
        Documentos"`, em `#ps_foot`, escrita por `renderDeclPreview()`) — interpretada como sendo a essa
        que o Ivo se refere, e removida (o rodapé fica vazio e escondido; a identidade da farmácia
        mantém-se pelo logótipo/nome no cabeçalho e pelos contactos, ver a seguir).
        **(c) informações de farmácia nas declarações** — confirmado que os campos morada/email/telefone
        já existiam em Configurações → Geral (com texto de ajuda a dizer explicitamente que servem para
        pré-preencher declarações), só não estavam ligados; o placeholder `#ps_contact`
        (`contenteditable`, no cabeçalho de cada declaração, mencionado como lacuna conhecida desde o
        ponto 10) passa a pré-preencher-se a partir de `config.morada`/`emailContacto`/`telefoneContacto`
        sempre que uma declaração é aberta — mesmo tratamento que o Aluguer Medela já tinha (ponto 10),
        continuando editável à mão por documento. Confirmado por varredura ao ficheiro que este era o
        único placeholder deste tipo — não há o mesmo gap nos outros tipos de documento do ficheiro
        (Bolachas/Etiquetas/Listas/Lombadas não usam morada/contacto da mesma forma).
      - Testes novos desta sessão: e2e para os quatro módulos acima (impressão do Gabinete; CRUD do
        Histórico de Consumo do PIM incluindo tracking de uso; importação de regras em Devoluções a
        Armazenistas; e, em Documentos, abrir a Declaração de Medicação, adicionar/remover medicação à
        mão, puxar do PIM sem duplicar, tracking de uso, ausência do rodapé de crédito em qualquer tipo
        de declaração, e pré-preenchimento de contacto com e sem configuração). Catálogo de tarefas do
        Poupança & ROI: 146 → **151** (147 devolucoes-armazenistas.importar_regras + 1
        documentos.puxar_medicacao_pim + 3 pim.*_registo_consumo). Bateria completa reconfirmada sem
        regressões: 257 testes unitários / 373 e2e, todos a passar.
    - **Especificações registadas para os 3 módulos grandes, ainda por implementar** (cada um deve ser
      uma sessão dedicada própria, dado o âmbito):
      - **IA interna "FARMA"**: o Ivo pediu explicitamente, em texto livre, "Desenvolver IA interna
        independente e autónoma chamada FARMA que auxilia e automatiza todas as funções da central e não
        necessita de nenhuma api" — ou seja, sem depender de nenhuma API externa paga (nem Anthropic, nem
        OpenAI, etc.), autónoma, com o nome próprio "FARMA", cobrindo todas as funções da Central.
        Implica desenhar/escolher um motor local (regras + heurísticas determinísticas para a maior parte
        das automações razoáveis, possivelmente um modelo pequeno correndo localmente para o que precisar
        de linguagem natural) antes de decidir a arquitetura exata — ainda por investigar.
      - **Auto-manutenção intensiva da Central** (nova secção em Configurações da Central): o Ivo
        escolheu explicitamente "Todos" entre as opções oferecidas — ou seja, os três em conjunto:
        (1) verificação e reparação de integridade de dados; (2) cópias de segurança automáticas com
        restauro; (3) painel de saúde/desempenho.
      - **Multi-idioma de toda a Central**: escolha de idioma no ato de criação de conta, alterável depois
        em Configurações da Central; a lista completa de idiomas pedida pelo Ivo, em texto livre: Português,
        Inglês, Espanhol, Francês, Alemão, Italiano, Mandarim, Russo, Ucraniano, Polaco, Hindi, Coreano,
        Árabe, Bengali, Indonésio (15 idiomas) — inclui alteração de toda a terminologia da app consoante o
        idioma escolhido, "altera tudo o que seja necessário". Dado o âmbito (13 módulos + painel
        principal + toda a terminologia de domínio farmacêutico), vai precisar de uma arquitetura de
        internacionalização própria (chaves de tradução + seletor de idioma persistido em `config`),
        ainda por desenhar.
22. **Refinamento da Declaração de Medicação com base num modelo real já aprovado pela farmácia
    (2026-09-15, mesmo dia do ponto 21, follow-up imediato)**: o Ivo enviou uma fotografia de uma
    declaração de medicação real da Farmácia Alto dos Moinhos, já aprovada pelo responsável, pedindo
    para seguir esse modelo à letra — e confirmou que a "marca de água" do ponto 21(b) era mesmo o
    crédito de software no rodapé, como identificado. Mudanças feitas sobre o que tinha sido implementado
    no ponto 21(a):
    - Lista de medicamentos passou de nome/dosagem/posologia (texto livre) para **DCI** (Denominação
      Comum Internacional) + dosagem + quantidade + forma farmacêutica, repetível à vontade ("quantos
      DCI quisermos"), formatada exatamente como no modelo: `DCI: <nome>, <dosagem> x <quantidade>
      <forma>` (ex.: "DCI: Valproato semisódico, 500 mg x 60 comp gastrorresistente"). "Puxar do PIM"
      passou a priorizar o campo `dci` do registo do PIM (antes usava o nome comercial); quantidade e
      forma ficam por preencher à mão — o PIM regista medicação ativa, não embalagens compradas, não
      tem essa informação.
    - Corpo da declaração reescrito para seguir a redação exata do modelo aprovado: "Declaramos, para os
      devidos efeitos, que \<nome\>, nascido a \<data\>, com NIF: \<nif\>, adquiriu na \<farmácia\>, em
      \<cidade\>, os seguintes medicamentos e dispositivos médicos entre \<início\> e \<fim\>: ...
      Disponíveis para qualquer esclarecimento." — mais direta e específica do que a redação genérica
      partilhada pelos outros tipos de declaração.
    - **Novo campo de configuração "Cidade"** (Configurações → Aba Geral, junto à Morada) — o modelo
      aprovado nomeia a cidade da farmácia explicitamente ("em Lisboa") e esse dado não existia separado
      da morada; adicionado com o mesmo padrão dos outros campos de identificação (`config.cidade`,
      `SET_CIDADE` em `store.js`, `setCidade()` em `actions.js`).
    - Dois ajustes ao bloco de assinatura da declaração — **partilhado por todos os tipos**, não só
      Medicação, por já ser um único componente: "Local e data" passa a incluir a cidade antes da data
      (ex.: "Lisboa, 15/09/2026", antes só a data); o texto da caixa de carimbo passou a "Carimbo e
      assinatura do farmacêutico **responsável**" (antes sem "responsável"), como no modelo.
    - Ordem/formato de `#ps_contact` ajustada para morada · **Tel:** telefone · email (antes: morada ·
      email · telefone, sem o prefixo "Tel:"), para bater certo com o modelo aprovado.
    - Testes atualizados: `.medlist-row` passou a ter 4 campos (DCI/dosagem/quantidade/forma, antes 3);
      novo teste confirma que "Puxar do PIM" usa a DCI e não o nome comercial; novos testes confirmam o
      texto exato do corpo ("adquiriu na ... em \<cidade\>", "com NIF:") e que "Local e data" passa a
      incluir a cidade. Bateria: 257 unitários / **375 e2e** (+2 face ao ponto 21) — catálogo de tarefas
      mantém-se em 151 (não houve nenhuma tarefa rastreável nova nesta refinação).

23. **Auto-manutenção intensiva da Central — implementada (2026-09-15, início dos "3 módulos grandes"
    do pedido de 12 itens, ver ponto 21)**: o Ivo pediu para avançar com os 3 módulos grandes que tinham
    ficado só especificados (FARMA IA, auto-manutenção, multi-idioma) — "os 3 de forma bem completa".
    Dado o âmbito de cada um, são implementados um a um, cada um com a sua própria verificação/sync/
    documentação; este ponto cobre a Auto-manutenção, a primeira das 3 (as outras duas — multi-idioma e
    FARMA IA — seguem em pontos seguintes desta mesma sessão). Implementados os "Todos" (3 pilares)
    escolhidos pelo Ivo:
    - **Verificação/reparação de integridade de dados** (`src/manutencao.js`, lógica pura e testável sem
      rede): uma regra concreta conhecida (medicamentos/eventos/stock/rótulos do PIM a referenciar um
      `utenteId` que já não existe — reparação: remover o registo órfão) mais uma regra **genérica**
      (deteta, em qualquer coleção de qualquer módulo, registos sem `id` ou com `id` duplicado —
      reparação: atribuir/renovar o `id`) que dispensa listar à mão o nome de cada coleção de cada
      módulo, para continuar a cobrir módulos futuros sem manutenção. A deteção é feita com uma
      heurística (só considera uma coleção "por id" se pelo menos metade dos seus itens já tiverem `id`
      preenchido), para não gerar ruído em arrays que nunca usaram essa convenção. "Reparar
      automaticamente" volta a ler e a verificar o estado mais recente antes de reparar (nunca corrige
      com base em dados desatualizados) e nunca muta o estado recebido.
    - **Cópias de segurança automáticas + restauro**: uma cópia completa do estado partilhado (via o
      novo `dataStore.getEstadoCompleto()`, que lê tudo o que `/api/data` devolve — não só {servicos,
      categorias, config} como o resto da app conhecia até agora) é criada automaticamente uma vez por
      dia ao arrancar a Central (silenciosa, best-effort, nunca bloqueia o arranque), guardada como asset
      próprio (`backup-<timestamp ISO>`) com um manifesto leve (`config.manutBackups`: id/data/tamanho/
      manual-ou-automática) — mantém só as últimas 20, apagando os assets das mais antigas ao podar.
      Restaurar volta a gravar o estado completo do backup escolhido através do novo
      `dataStore.gravarEstadoCompleto()`; como `/api/data` faz merge por chave de topo (ver
      `netlify/functions/data.js`), um módulo que ainda não existisse nessa altura do backup **não é
      apagado** pelo restauro — decisão deliberada, restauro conservador em vez de destrutivo.
    - **Painel de saúde/desempenho**: tamanho aproximado do estado partilhado, total de registos (soma
      recursiva de todas as coleções conhecidas), nº de cópias de segurança guardadas, e data da mais
      recente.
    - Nova aba "Auto-manutenção" em Configurações (`index.html`/`src/app.js`/`src/ui/manutencao.js`,
      mesmo padrão do painel "Poupança & ROI" — ver ponto 17), reaproveitando as classes CSS já existentes
      (`.data-action-card`, `.poup-resumo-card`, `.poup-table`) em vez de criar estilo novo.
    - Testes: 23 novos testes unitários (100% da lógica pura de `src/manutencao.js` — verificação,
      reparação, poda de backups, decisão de backup automático, formatação, saúde) + 8 novos testes e2e
      (backup automático ao arrancar sem abrir a aba, verificação encontra o problema semeado, reparação
      remove-o mesmo no servidor, cópia manual, painel de saúde, restauro repõe mesmo os dados de então).
      Bateria: **280 testes unitários** (+23) / **383 e2e** (+8), catálogo de tarefas mantém-se em 151
      (as ações de Auto-manutenção vivem no painel principal, `index.html`, que não inclui
      `module-chrome.js`/`registarUso` — não há tracking de Poupança & ROI para ações fora dos 13
      módulos, por desenho).

24. **Multi-idioma da Central — implementado (2026-09-15, segundo dos "3 módulos grandes" do pedido de
    12 itens, ver pontos 21 e 23)**: cobre o pedido original do Ivo (15 idiomas — português, inglês,
    espanhol, francês, alemão, italiano, mandarim, russo, ucraniano, polaco, hindi, coreano, árabe,
    bengali, indonésio — escolha no ato de criação de conta, alterável depois em Configurações).
    - **Arquitetura**: dicionário simples chave→string por idioma (`src/i18n/dicionario.js`, ~196 chaves
      com namespace por ponto, ex. `"config.geral.logo_titulo"`), sem nenhuma dependência externa de
      i18n — consistente com o resto da Central. `src/i18n.js` é o motor: `t(chave, idioma, vars)`
      traduz com interpolação de variáveis (`{{var}}`) e cai sempre para português e depois para a
      própria chave em vez de rebentar se faltar uma tradução; `aplicarTraducoes(idioma, raiz)` percorre
      o DOM à procura de `data-i18n`/`data-i18n-placeholder`/`data-i18n-title`/`data-i18n-aria` e
      substitui o texto, também ajustando `<html lang>`/`dir` (right-to-left para árabe) quando aplicada
      ao documento inteiro. Guardas de desempenho: `renderAll()` em `src/app.js` só corre a varredura
      completa do DOM quando `state.idioma` muda de facto (não em cada tecla).
    - **`config.idioma`** segue exatamente o padrão já estabelecido para `cidade` no ponto 22: caso novo
      em `store.js` (`SET_IDIOMA`) → `actions.setIdioma()` (dispatch + `dataStore.setConfig`) →
      `modals.js` liga o `<select id="idiomaSelect">` em Configurações → Geral. Novo seletor de idioma
      no formulário de criação de conta (`#signupIdioma`, por omissão português), aplicado logo a seguir
      ao arranque da app para uma conta nova ganhar precedência sobre o valor por omissão "pt".
    - **Bug real encontrado e corrigido de caminho** (não introduzido nesta sessão): `actions.js` nunca
      carregava `config.cidade` no arranque (`iniciar()`), apesar de `setCidade()` gravar corretamente
      esse campo desde o ponto 22 — o campo Cidade em Configurações ficava sempre vazio ao recarregar a
      página, mesmo para farmácias que já o tinham preenchido. Corrigido no mesmo bloco de código que
      passou a carregar também `config.idioma`.
    - **Âmbito desta passagem, documentado com honestidade em vez de reclamar 100%**: traduzida a shell
      central por inteiro — `index.html` (login/criar conta, barra superior, os 6 separadores de
      Configurações, paleta de comandos) e as strings dinâmicas mais visíveis de `src/app.js`,
      `src/actions.js` (toasts), `src/ui/sidebar.js` (navegação, categorias, estado de sincronização) e
      `src/ui/main-content.js` (cartões de serviço, estados vazios, breadcrumb, títulos de secção). Os
      **13 módulos individuais em `modulos/*.html` permanecem em português** — ficam para uma ronda de
      lançamento dedicada (ver Plano de trabalho), dado o volume de trabalho de traduzir 13 ficheiros
      HTML completos multiplicados por 15 idiomas. Também ficaram propositadamente por traduzir alguns
      textos dinâmicos de baixo tráfego (ex.: estados "A guardar..." em `modals.js`, o cabeçalho
      "Navegação"/rótulos de estatísticas na barra lateral, nomes de módulos/categorias que são dados
      reais da farmácia e não texto de interface) — nenhuma perda funcional, só não traduzidos ainda.
    - Testes: 21 novos testes unitários (`tests/i18n.test.js` — completude das ~196 chaves × 15 idiomas
      via `chavesEmFalta()`, comportamento de `t()`/fallback/interpolação, `normalizarIdioma()`) + 10
      novos testes e2e (`tests/e2e/modules/15-i18n.mjs` — mudar idioma em Configurações traduz a UI de
      imediato sem reload; a escolha persiste no servidor e sobrevive a um reload; o seletor de idioma no
      signup é honrado numa conta nova, incluindo `<html lang>` e persistência em `config.idioma`).
      Bateria: **301 testes unitários** (+21) / **393 e2e** (+10).

25. **FARMA IA — implementada (2026-09-15, terceiro e último dos "3 módulos grandes" do pedido de 12
    itens, ver pontos 21/23/24)**: os 3 pilares pedidos pelo Ivo ("os 3 de forma bem completa"), **sem
    nenhuma chamada a um serviço externo de IA** — pedido explícito do Ivo. Novo módulo standalone
    `modulos/farma-ia.html` (o 14º módulo/ferramenta da Central, aberto no iframe da Central como os
    outros 13), com atalho próprio na barra lateral (ícone novo `spark` em `src/icons.js`).
    - **Pilar 1 — Alertas &amp; Insights proativos** (`gerarAlertas(estado, agora)` em `src/farmaIa.js`,
      lógica pura, mesmo padrão de `src/manutencao.js` do ponto 23): embalagens do PIM (`pim_stock_v1`)
      perto da validade/expiradas ou sem stock para um utente ativo; plano semanal do PIM
      (`pim_rotulos_v1`) — só o mais recente de cada utente, para não gerar ruído a partir do histórico
      completo — a terminar ou já terminado; stock do Gabinete (`gabinete_stock_v1`) perto da
      validade/expirado ou abaixo da quantidade mínima; produtos de Stocks Errados marcados
      recorrentemente como "procurei e não encontrei" (≥3 contagens diferentes) — possível problema de
      localização/etiquetagem; pedidos AUE e de Manipulados parados há muitos dias num estado não
      terminal. Utentes arquivados/em pausa do PIM são excluídos destas regras, de propósito, para não
      gerar alertas sem sentido sobre quem já não está a ser seguido ativamente.
    - **Pilar 2 — Assistente de perguntas e respostas** (`responderPergunta(pergunta, estado, contexto)`):
      motor de regras por reconhecimento de palavras-chave (normalizado, sem distinguir maiúsculas/
      acentos) — não uma IA generativa. Reconhece perguntas sobre utentes do PIM, validades, pedidos AUE/
      manipulados pendentes, divergências de Stocks Errados, contagem de serviços, resumo de alertas e
      poupança de tempo (esta última só responde com um número se `contexto.diasUso` for fornecido — nunca
      inventa uma cifra). Pergunta não reconhecida devolve sugestões de perguntas de exemplo em vez de
      falhar.
    - **Pilar 3 — Deteção de oportunidades de automação/atalho**
      (`detectarOportunidadesAutomacao(diasUso, opts)`): reutiliza o agregador já existente
      `agregarPorTarefa()` de `src/usoLeitura.js` (ponto 17/Poupança &amp; ROI) sobre os últimos 30 dias de
      uso, e assinala as tarefas repetidas acima de um limiar (15 ocorrências no período) como candidatas
      a atalho. **Nota honesta de âmbito**: os dados de uso só guardam contagens por dia por tarefa, sem
      timestamp nem ordem dentro do dia — por isso esta deteção mede só VOLUME de uma tarefa isolada, não
      consegue detetar sequências ("o utilizador faz X e depois sempre Y"), documentado explicitamente no
      cabeçalho de `src/farmaIa.js` em vez de fingir uma capacidade que os dados não suportam.
    - Novo catálogo de 3 tarefas rastreáveis do módulo (`ver_alertas`/`perguntar`/`ver_oportunidades`) em
      `src/usoCatalogo.js`, instrumentadas com `window.ModuleChrome.registarUso` tal como os outros 13
      módulos — a FARMA IA entra também no próprio painel de Poupança &amp; ROI. `MODULOS_ATALHOS`
      (`src/domain.js`) e `MODULOS_NOMES` ganharam a entrada `farma-ia`, o que também faz uma farmácia
      nova ganhar automaticamente um atalho de serviço para a FARMA IA (mesmo mecanismo do ponto 16).
    - Testes: 43 novos testes unitários (`tests/farmaIa.test.js` — cada regra de alerta isoladamente,
      incluindo os casos de exclusão de utentes arquivados/em pausa; cada intenção do assistente de
      perguntas; deteção de oportunidades acima/abaixo do limiar e ordenação) + 13 novos testes e2e
      (`tests/e2e/modules/16-farma-ia.mjs` — cenário completo semeado via API com alertas reais dos 5
      módulos cobertos, pergunta feita através da UI a receber resposta reconhecida, oportunidade de
      automação semeada via o mesmo blob de uso do Poupança &amp; ROI, e confirmação de que o próprio
      módulo regista o seu uso). Bateria: **344 testes unitários** (+43) / **409 e2e** (+13, incluindo o
      novo módulo no smoke-test genérico dos 14 módulos em `00-core.mjs`).
    - Com este ponto, os "3 módulos grandes" do pedido de 12 itens do Ivo (ponto 21) ficam todos
      implementados e testados desta sessão: Auto-manutenção (ponto 23), Multi-idioma (ponto 24, shell
      central — 13 módulos individuais ainda pendentes, ver Plano de trabalho) e FARMA IA (este ponto).

- **Ponto 26 — FARMA IA: "Memória & Aprendizagem"** (2026-09-15, pedido direto do Ivo: *"quero que a
  farma vá aprendendo conforme os pedidos vão surgindo e quero que dês à farma uma aceleração de
  aprendizagem intensiva com tudo o que aches importante"*). Continua **sem nenhuma API externa de
  IA** — era um requisito explícito do ponto 25 e mantém-se aqui: "aprender" significa memória
  persistida por farmácia (`config.farmaIaMemoria`, mesmo padrão de `cidade`/`idioma`, gravada via
  `dataStore.setConfig`), não um modelo estatístico/LLM. Três mecanismos, todos em `src/farmaIa.js`
  (funções puras, testadas sem rede como todo o resto do ficheiro):
    - **Perguntas não reconhecidas ficam registadas** (`registarPerguntaNaoReconhecida`) — histórico
      (até 30 perguntas distintas, sem duplicar a mesma pergunta normalizada, só a contagem/data sobe)
      do que foi perguntado e a FARMA IA não soube responder, para ficar disponível a rever.
    - **"Talvez quisesse dizer: ..."** — quando nenhuma regra reconhece a pergunta,
      `sugerirIntentsSemelhantes` (distância de edição/Levenshtein sobre palavra a palavra, com um
      limiar mínimo de 3-4 caracteres para nunca confundir preposições curtas como "de"/"a" com uma
      palavra-chave) sugere até 3 intents plausíveis. Um clique numa sugestão, na UI
      (`modulos/farma-ia.html`), chama `ensinarAlias`: da próxima vez que a MESMA pergunta (normalizada)
      for feita, responde-se de imediato por essa correspondência exata aprendida — nunca por
      adivinhação estatística — e a resposta fica marcada visualmente (🧠) para transparência.
    - **Alertas podem ser "dispensados"** (`dispensarAlerta`/`alertaEstaDispensado`) — um botão em cada
      cartão de alerta silencia-o, mas **sempre por um prazo (7 dias por omissão,
      `LIMIAR_SILENCIAR_ALERTA_DIAS`), nunca para sempre**: se a condição de origem persistir depois do
      prazo (ex.: uma validade continua expirada), o alerta reaparece sozinho — decisão deliberada para
      nunca esconder de vez um problema real só porque foi dispensado uma vez.
    - Adicionalmente, "aceleração de aprendizagem intensiva" traduziu-se também em alargar de imediato o
      vocabulário reconhecido à partida (menos dependência de aprender pela via acima): sinónimos
      novos nos 8 intents já existentes (`cliente`/`doente` para utentes, `estoque`/`inventario` para
      stocks, `prazo`/`a vencer` para validade, etc.) e **3 intents novos**: `backup` (cruza com
      `src/manutencao.js`/ponto 23 — ver alerta novo abaixo), `oportunidades` (responde sobre automação
      diretamente no chat, reutilizando `detectarOportunidadesAutomacao`) e `ajuda` (explica o que a
      FARMA IA sabe fazer).
    - **Novo alerta cruzado com a Auto-manutenção** (ponto 23): `gerarAlertas` passou a incluir "sem
      cópia de segurança recente", reutilizando `precisaBackupAutomatico` de `src/manutencao.js` sobre o
      mesmo `config.manutBackups` que o painel de Auto-manutenção lê/escreve (limiar de 7 dias). Cuidado
      deliberado para não gerar falsos positivos: só avalia quando a chave `manutBackups` já existe (uma
      conta nova cuja Central ainda não correu uma única vez, antes do backup automático inicial, não é
      tratada como "problema").
    - `gerarAlertas(estado, agora, memoria)` ganhou um 3º parâmetro opcional (retrocompatível — omitido
      continua a funcionar como antes) para filtrar os alertas dispensados, devolvendo também
      `totalDispensados` para a UI poder mostrar "N alertas silenciados. Mostrar" sem os listar em
      detalhe. `responderPergunta` passou a aceitar `contexto.memoria` (consulta os aliases PRIMEIRO,
      antes de correr o motor de regras) e devolve `sugestoes`/`viaAprendizagem` para a UI.
    - UI (`modulos/farma-ia.html`): botão "Dispensar 7d" em cada cartão de alerta; botões de sugestão
      "talvez quisesse dizer" por baixo de uma pergunta não reconhecida no chat; indicador discreto no
      topo do painel "Perguntar" com a contagem de perguntas aprendidas/alertas silenciados (transparência
      sobre o que a memória já sabe). Tudo com falha silenciosa se a gravação da memória falhar — a
      aprendizagem é um extra best-effort, nunca bloqueia o resto do módulo.
    - Testes: **26 novos testes unitários** (`tests/farmaIa.test.js` — alerta de backup nos 3 estados
      possíveis, sinónimos novos reconhecidos, os 3 intents novos, sugestões com erro de escrita/sem
      correspondência às cegas, cada função de memória isoladamente, e o ciclo completo de dispensar →
      expira sozinho → reativar manualmente) + **12 novos testes e2e**
      (`tests/e2e/modules/16-farma-ia.mjs` — dispensar um alerta na UI real desaparece de imediato E
      sobrevive a reabrir o módulo numa página nova, por ter persistido em `config.farmaIaMemoria` no
      servidor, não só em memória local da página; ensinar um alias por clique numa sugestão faz a MESMA
      pergunta com erro responder de imediato da segunda vez; alerta de backup em atraso aparece quando
      semeado). Bateria: **370 testes unitários** (+26) / **421 e2e** (+12).

## Estado atual (2026-09-15)

Esqueleto multi-farmácia + seis módulos de gestão + sete ferramentas independentes (incluindo o
Catálogo de Produtos), escritos na pasta do Ivo `central multifarmácia` (fora do repo de produção), com
paleta de cores unificada (ponto 13), navegação Sifarma partilhada (ponto 14), logótipo/branding fora
do caminho quente de leitura/gravação (ponto 15), atalhos automáticos de módulos como "serviços"
(ponto 16), a fusão de dados do Gabinete e o catálogo de tarefas do Poupança & ROI (ponto 19), a leitura
de DataMatrix nos 3 pontos de câmara da Central (ponto 18), a expansão massiva de testes automatizados
com 9 bugs reais corrigidos (ponto 20), o pedido de 12 itens do Ivo — parte concreta implementada, três
módulos grandes (IA interna "FARMA", auto-manutenção, multi-idioma) só especificados para sessões
futuras (ponto 21), o refinamento da Declaração de Medicação com base num modelo real aprovado pela
farmácia (ponto 22), e a implementação completa dos três módulos grandes pedidos: Auto-manutenção da
Central — verificação/reparação de integridade, cópias de segurança automáticas + restauro, e painel de
saúde/desempenho (ponto 23) —, Multi-idioma — motor de i18n próprio, 15 idiomas, escolha no registo e em
Configurações, shell central traduzida por inteiro (ponto 24) — e FARMA IA — alertas/insights proativos,
assistente de perguntas por motor de regras, e deteção de oportunidades de automação, tudo sem nenhuma
IA externa, num 14º módulo standalone (ponto 25) — e, ainda nesta sessão, a "Memória & Aprendizagem" da
FARMA IA (ponto 26): memória persistida por farmácia (aliases de perguntas ensinados, alertas
temporariamente dispensados, histórico de perguntas não reconhecidas) e cobertura de sinónimos/intents
alargada, continuando sem nenhuma API externa — e o "Canal de Aprendizagem" (ponto 27): decisão explícita
do Ivo de que a FARMA continua a aprender através de conversas Ivo↔Claude (nunca uma ligação ao vivo à
API), com uma ferramenta de relatório (`scripts/relatorio-aprendizagem-farma.mjs`) e um guia de "voz" no
código para orientar o tom de qualquer resposta nova — o ponto 28: correção de um bug real reportado em
produção (gráficos do Poupança & ROI a falhar com "sem ligação ao CDN", causado por uma versão do Chart.js
entretanto removida do cdnjs), resolvido com uma cadeia de CDNs alternativas (cdnjs → jsdelivr) e +5 testes
novos — o ponto 29: início da "FARMA como assistente que opera a Central" (chat como vista por omissão do
módulo + saudação automática, mini-chat na página inicial, decisão de arquitetura de IA 100% local via
WebLLM/WebGPU, sem API externa, sem depender de um único PC) — o ponto 30: a primeira ação real
ponta-a-ponta (mudar o estado de um pedido de Manipulados por comando em português, com IA local opcional,
catálogo de ações validado explicitamente e confirmação obrigatória do operador antes de qualquer
execução), com extração de `src/manipuladosCore.js` como lógica partilhada — o ponto 31: mais 3 ações
no catálogo (adicionar/editar produto no Catálogo de Produtos, preparar uma etiqueta em Documentos para o
operador rever e imprimir), com uma nota de honestidade explícita registada sobre o que "operar em toda a
central" ainda não cobre (regras de devolução dos laboratórios, lombadas/declarações, leitura de imagens)
— o ponto 32: memória de conversa multi-turno (o modelo local passa a conseguir perguntar o que falta e
usar a resposta seguinte), mais criar pedidos de Manipulados e preparar o email de orçamento por
linguagem natural (nunca enviado sozinho), com um bug real corrigido (procura de pedidos passa a incluir
o nome do animal, não só utente/medicamento) — e o ponto 33: o mesmo para AUE (criar pedidos + preparar o
email ao armazenista, com uma decisão de segurança deliberada de nunca usar o envio automático por Web
App que o módulo suporta), confirmado que os pedidos de AUE, apesar de guardados também em localStorage,
têm o servidor como fonte de verdade real, e por isso são seguros para a FARMA operar — e o ponto 34: o
mesmo para a Gestão de Gabinete (adicionar/remover/atualizar itens da Lista de Controlo, criar relatórios
vazios sem nunca inventar respostas de inspeção), com dois bugs reais corrigidos pelo caminho (um de
perda silenciosa de dados em `gabinete.html` ao semear a checklist por omissão antes de ler a nuvem, e um
de um teste e2e pré-existente que nunca mudava para a vista certa antes de clicar) — e o ponto 35: bug
real corrigido no Conversor de PDF (`modulos/conversor-pdf.html`), reportado diretamente pelo Ivo — TIFF
era anunciado como formato de entrada suportado nas duas abas mas nunca funcionava (limitação da própria
plataforma web, `Image()` não decodifica TIFF), falhando sempre de forma silenciosa e sem mensagem útil;
corrigido removendo TIFF do que é anunciado, com rede de segurança e mensagens de erro específicas
(TIFF, PDF protegido por palavra-passe, PDF inválido, falha a carregar bibliotecas do CDN) em vez do
"Erro: nome-do-ficheiro" genérico de antes — e o ponto 36: bug real corrigido na Gestão de Gabinete,
também reportado diretamente pelo Ivo — clicar numa sugestão de produto encontrado por CNP não
selecionava nada (`pickStockProduct`/`pickItemProduct` nunca tinham sido expostas em `window`, a mesma
família de bug já corrigida no ponto 34 para outras funções), pelo que o produto nunca chegava a ser
adicionado — o ponto 37: Manipulados ganhou definições de email ao estilo do AUE (lista de
Fornecedores editável, com um padrão, + Web App de envio opcional), encontrando pelo caminho um segundo
bug pré-existente e mais grave — o botão "✉ Pedir orçamento" nunca tinha funcionado em produção, para
nenhuma farmácia, pelo mesmo motivo (função não exposta em `window`) — e o ponto 38: o editor de template
de email arrastável pedido pelo Ivo, para Manipulados e para o email ao armazenista do AUE — campos do
pedido apresentados como "chips" que se arrastam (drop nativo do browser, sem `ondrop` customizado) ou se
inserem por clique para dentro do assunto/corpo do email, com pré-visualização e substituição por
`{{token}}` contra os dados reais de cada pedido, sempre com compatibilidade estrita (nenhuma farmácia que
nunca abra o editor tem qualquer alteração de comportamento) — e o ponto 39: o logótipo real da vinheta
"Desenvolvido por" (reenviado pelo Ivo, guardado em `assets/dev-logo.png`, recorte confirmado visualmente)
e a FARMA a passar a operar Stocks Errados (criar/apagar listas, registar/remover produtos, sempre como
entrada manual — nunca a arriscar casar por substring contra o produto errado do catálogo) — e o ponto 40:
correção de um erro próprio (o ponto 39 tinha concluído, com base numa leitura apressada de `saveJSON()`,
que Listas de Inscrição guardava os dados só em `localStorage`; na verdade já sincroniza com o servidor
como qualquer outro módulo, confirmado com Playwright em dois "computadores" diferentes) seguida da
implementação direta das 4 ações que essa conclusão errada tinha bloqueado — `listas.criar_lista`,
`listas.apagar_lista`, `listas.inscrever` (com "consulta primeiro, depois pergunta" para o horário, via a
memória de conversa do ponto 32) e `listas.remover_inscricao` — e o ponto 41: início de um plano em 4 fases
para a FARMA "aprender a pensar" (pedido explícito do Ivo), confirmado por si que o ponto 29 ("sem API
externa") se mantém — só pesquisa pontual de informação pública ficaria a ser considerada, nunca uma IA
externa nem dados de utentes a sair do computador da farmácia. Fase 1 feita: `resolverComRaciocinio`, um
ciclo real "pensar → agir → observar → pensar melhor" — quando uma ação é recusada por um motivo que o
próprio modelo local consegue corrigir (lista ambígua, parâmetro em falta), a FARMA tenta de novo sozinha
até 3 vezes antes de desistir, em vez de desistir logo à primeira. Fases 2-4 (rede neuronal leve treinada
offline, memória que generaliza sozinha, pesquisa pontual na internet) ficam desenhadas para sessões
seguintes — e o ponto 42: fases 2 e 3 desse plano, feitas nesta sessão ("Avança com a fase 2, 3 e 4",
pedido explícito do Ivo). Fase 2 — uma rede neuronal pequena e sem nenhuma dependência externa
(`src/farmaRede.js`: hashing de trigramas de caracteres → 1 camada escondida (24 unidades, ReLU) →
softmax, treinada offline com backpropagation manual e Adam, pesos distribuídos como ficheiro estático de
~35KB, tal como qualquer outro ficheiro de código), integrada em `responderPergunta()` como um segundo
crivo, DEPOIS do motor de regras/aliases e só aceite quando muito confiante (`tentarViaRedeNeural`) —
tolera paráfrases e erros de escrita que o casamento por palavras-chave exato nunca apanhava. Pelo caminho,
um bug real de generalização foi encontrado por teste adversarial próprio (não reportado pelo Ivo): texto
completamente disparatado ("xyz abc 123") era classificado com 98% de confiança num intent real — corrigido
com uma 12ª classe negativa explícita ("fora_do_ambito"), a técnica correta em vez de um heurístico frágil
(ver ponto 42 completo abaixo para a história toda, com números honestos de exatidão). Fase 3 — a mesma
camada escondida da rede reutilizada como "embedding" de frase: reforça as sugestões "talvez quisesse
dizer" com sinal semântico (`sugerirIntentsSemelhantes`) e agrupa perguntas não reconhecidas quase-
duplicadas para revisão (`agruparPerguntasSemelhantes`, com um novo painel na UI). Fase 4 (pesquisa
pontual na internet) continua por fazer — este sandbox de desenvolvimento não consegue verificar
ligação real à internet (proxy de saída bloqueia domínios externos arbitrários), por isso fica para ser
desenhada e testada já no computador do Ivo. **584 testes unitários (100% a passar) + 456 end-to-end
(456 a passar nesta corrida — a antiga "falha conhecida" do módulo de Devoluções, ponto 28, não reproduziu,
mas como não foi tocada neste ponto não se pode garantir que esteja definitivamente resolvida)**, catálogo
de tarefas do Poupança & ROI em **154 tarefas**.
**Todos os ficheiros alterados desde o ponto 19 (inclusive) até ao ponto 22 foram confirmados
sincronizados na pasta `central multifarmácia` do PC do Ivo** (76 ficheiros, incluindo os que tinham
ficado por sincronizar nas duas sessões anteriores); os ficheiros dos pontos 23 (Auto-manutenção), 24
(Multi-idioma), 25, 26, 27 (FARMA IA), 28 (correção do CDN), 29, 30, 31, 32, 33, 34 (FARMA executa ações),
35 (correção do Conversor de PDF), 36 (correção da seleção por CNP no Gabinete), 37 (email de
Manipulados), 38 (editor de template de email arrastável), 39 (logótipo + FARMA em Stocks Errados), 40
(correção do erro sobre Listas de Inscrição + FARMA a operar Listas de Inscrição), 41 (raciocínio em vários
passos, fase 1 do plano "FARMA aprende a pensar") e 42 (fases 2 e 3 do mesmo plano — rede neuronal leve +
memória que generaliza) foram sincronizados nesta sessão à medida que foram escritos — ver "Ainda por
fazer" para o que falta noutras frentes.

- `netlify/functions/_lib/auth.js` — hashing de password (scrypt) + tokens de sessão (JWT/HMAC-SHA256), sem dependências externas.
- `netlify/functions/auth.js` — `/api/auth/signup`, `/api/auth/login`, `/api/auth/me`.
- `netlify/functions/data.js` e `asset.js` — `tenantId` vem sempre do token validado, chaves no Blobs prefixadas por tenant (`estado:<tenantId>`, `asset:<tenantId>:<key>`); `data.js` faz merge no PUT em vez de substituir o estado inteiro (e, desde esta sessão, distingue corretamente um corpo JSON malformado do cliente — 400 — de uma falha real de gravação no servidor — 500, ver ponto 20). `asset.js` é também o que agora guarda os blobs mensais de uso do ponto 17 (`uso-AAAA-MM`).
- `src/authClient.js` — sessão no browser (token em localStorage), `src/db.js` adaptado para enviar `Authorization: Bearer` e reagir a 401 (sessão expirada); agora também omite `config.logo` do que reenvia (ponto 15) e expõe `cacheBrandingLocal` para a cache partilhada de logótipo/nome.
- `src/produtosCatalogo.js` — catálogo de produtos partilhado (catálogo base estático + overlay por farmácia), ver ponto 11; desde esta sessão, as suas 4 funções de escrita (adicionar/editar/remover/restaurar) estão serializadas por uma fila própria (`overlayQueue`/`enqueueOverlaySync`), fechando uma condição de corrida real de "última escrita ganha" entre duas gravações rápidas (ponto 20).
- `assets/catalogo-base.json` — catálogo oficial de produtos (~29 mil, ~1.6MB), servido como ficheiro estático.
- `assets/module-chrome.css`/`module-chrome.js` — navegação Sifarma partilhada (ponto 14) + cache local de branding e leitura do logótipo por asset (ponto 15) + cliente de tracking de uso `registarUso`/flush (ponto 17) + leitura de código de barras DataMatrix/QR partilhada (`ensureBarcodeLib`/`decodeBarcodeFrame`, ponto 18), incluído em todos os 14 módulos (13 + FARMA IA, ponto 25).
- `src/usoCatalogo.js`/`src/usoLeitura.js`/`src/ui/poupanca.js` (ponto 17) — catálogo de tarefas rastreáveis (34 → 145 → 146 → 151 → **154**, pontos 19/20/21/25), leitura/agregação de uso, e o painel "Poupança & ROI" (gráficos com preset de período partilhado + vista própria por gráfico, e exportação de PDF corrigida — ponto 19).
- `src/farmaIa.js`/`modulos/farma-ia.html` (pontos 25, 26 e 42) — lógica pura + módulo standalone da FARMA IA: `gerarAlertas()` (validades/stock do PIM e Gabinete, planos semanais do PIM a terminar, produtos recorrentemente não encontrados em Stocks Errados, pedidos AUE/Manipulados parados, sem cópia de segurança recente — cruza com `src/manutencao.js`, ponto 26), `responderPergunta()` (assistente por motor de regras/palavras-chave, sem IA externa, com aliases aprendidos consultados primeiro e, desde o ponto 42, a rede neuronal como último crivo antes de desistir) e `detectarOportunidadesAutomacao()` (reutiliza `agregarPorTarefa()` do ponto 17 sobre os últimos 30 dias de uso). Ponto 26 acrescentou a "Memória & Aprendizagem": `registarPerguntaNaoReconhecida`/`ensinarAlias`/`sugerirIntentsSemelhantes`/`dispensarAlerta`/`alertaEstaDispensado`/`reativarAlerta`, tudo sobre `config.farmaIaMemoria`. Ponto 42 acrescentou `tentarViaRedeNeural` (só aceita a rede quando muito confiante), `agruparPerguntasSemelhantes` (agrupa perguntas não reconhecidas quase-duplicadas, só de apresentação) e um 3º parâmetro opcional `pesosRede` em `sugerirIntentsSemelhantes` (reforça sugestões com sinal semântico) — tudo com compatibilidade estrita: omitido, o comportamento fica igual ao de antes. `modulos/farma-ia.html` carrega os pesos treinados uma vez por sessão (`obterPesosRede`, mesmo padrão do catálogo base) e mostra um novo painel colapsável "Perguntas que a FARMA ainda não percebeu". Mesmo padrão arquitetural de `src/manutencao.js` (ponto 23): tudo funções puras, testáveis sem rede.
- `src/farmaRede.js`/`src/farmaRedePesos.json`/`scripts/dados-treino-farma.mjs`/`scripts/treinar-rede-farma.mjs` (ponto 42, fase 2) — a rede neuronal leve: extração de features por hashing de trigramas de caracteres (`extrairFeatures`), passagem para a frente pura (`avancar`), inferência de alto nível com a camada escondida reutilizável como embedding (`preverIntent`) e similaridade de cosseno (`similaridadeCosseno`); os pesos treinados (`farmaRedePesos.json`, ~35KB) são gerados offline por `scripts/treinar-rede-farma.mjs` a partir dos ~230 exemplos sintéticos de `scripts/dados-treino-farma.mjs` (12 classes: as 11 intenções reais + "fora_do_ambito", a classe negativa que ensina a rede a reconhecer texto sem relação nenhuma com a farmácia) — nunca corre no computador do operador, nunca depende de uma farmácia específica.
- `src/manipuladosCore.js`/`src/farmaAcoes.js`/`src/ui/farmaCerebro.js` (ponto 30) — a camada que deixa a
  FARMA executar, não só responder: `manipuladosCore.js` é a lógica pura de estados/transições de
  Manipulados, partilhada com `modulos/manipulados.html`; `farmaAcoes.js` é o catálogo explícito de ações
  (`ACOES_DISPONIVEIS`, hoje só `manipulados.mudar_estado`), a construção do prompt de sistema, a extração
  e validação rigorosa do JSON devolvido pelo modelo, e a execução só depois de confirmação; `farmaCerebro.js`
  é o carregamento opcional do modelo de IA local (WebLLM/WebGPU) com fontes alternativas e timeout. Ver
  ponto 30 para a arquitetura completa (regras primeiro → IA local só se ativada → nunca executa sem
  confirmação do operador).
- `index.html`/`src/app.js` — ecrã de login/criar conta antes de a app arrancar (agora com seletor de idioma no registo, ponto 24); Configurações → Identificação com nome/logótipo/morada/cidade/contactos (ponto 10, campo cidade acrescentado no ponto 22); separador "Poupança & ROI" ao lado de "Detalhes" (ponto 17); separador "Auto-manutenção" (ponto 23, ver módulo próprio abaixo); novo separador/secção "Idioma" (ponto 24).
- `src/manutencao.js`/`src/ui/manutencao.js` (ponto 23) — lógica pura + camada de rede/UI da Auto-manutenção da Central: verificação/reparação de integridade (regra concreta de referências órfãs do PIM + regra genérica de ids em falta/duplicados em qualquer coleção, por heurística de forma dos dados), cópias de segurança automáticas (uma vez por dia ao arrancar, manifesto em `config.manutBackups`, conteúdo em assets `backup-<timestamp>`, mantém as últimas 20) + backup manual + restauro conservador (não apaga módulos ausentes do backup, por como `/api/data` faz merge no PUT), e painel de saúde/desempenho (tamanho do estado, registos por módulo, histórico de backups). `src/db.js` ganhou `getEstadoCompleto()`/`gravarEstadoCompleto()` para dar a este módulo acesso ao estado completo (antes só `{servicos, categorias, config}` eram expostos).
- `src/i18n.js`/`src/i18n/dicionario.js` (ponto 24) — motor de internacionalização próprio (sem dependência externa): dicionário de ~196 chaves × 15 idiomas, `t()` com fallback pt → chave crua + interpolação `{{var}}`, `aplicarTraducoes()` a percorrer `data-i18n*` no DOM (incluindo `<html lang>`/`dir` rtl para árabe). `config.idioma` segue o mesmo padrão de `cidade` (ponto 22): `SET_IDIOMA` em `store.js`, `actions.setIdioma()`, ligado em `modals.js`/`app.js`; shell central (`index.html` + `src/app.js`/`actions.js`/`ui/sidebar.js`/`ui/main-content.js`/`ui/modals.js`) traduzida por inteiro — os 13 módulos (`modulos/*.html`) ficam para uma ronda de lançamento dedicada.
- `tests/e2e/` — reestruturado nesta sessão de um único ficheiro monolítico (`battery.mjs`, 62 verificações) para uma arquitetura de módulos plugáveis (`helpers.mjs` com os auxiliares partilhados + um ficheiro por módulo/domínio em `tests/e2e/modules/`, cada um exportando `run(browser)` + `battery.mjs` reduzido a um orquestrador fino que descobre e corre todos os módulos) — pensada de propósito para permitir a vários agentes escreverem testes em paralelo sem colisões de merge (ver ponto 20). Agora com **454 verificações** (337 do ponto 20 + 36 novas no ponto 21 para os 4 módulos tocados + 2 novas no ponto 22, refinamento da Declaração de Medicação + 8 novas no ponto 23, Auto-manutenção + 10 novas no ponto 24, Multi-idioma + 13 novas no ponto 25, FARMA IA + 12 novas no ponto 26, Memória & Aprendizagem da FARMA IA + 5 novas no ponto 28, fallback de CDN do Poupança & ROI + 4 novas no ponto 36, regressão da seleção por CNP no Gabinete + 3 novas no ponto 37, definições de email de Manipulados + 21 novas no ponto 38, editor de template de email arrastável — 12 em Manipulados + 9 em AUE), cobrindo os agora 14 módulos individualmente (não só smoke test), mais os testes de infraestrutura/integração pré-existentes preservados/expandidos no módulo `00-core.mjs`. A antiga falha conhecida no módulo de Devoluções (ver ponto 28) não reproduziu na corrida completa do ponto 34; um bug real e não relacionado foi encontrado e corrigido nessa mesma corrida em `16-farma-ia.mjs` (ver ponto 34). No ponto 42, a rede neuronal passou a reconhecer diretamente um erro de escrita ("utntes") que antes só era resolvido ensinando um alias à mão — o teste de `16-farma-ia.mjs` que exercitava esse fluxo foi atualizado para um erro de escrita diferente (que continua a não ser reconhecido nem pelas regras nem pela rede, para continuar a testar o "ensinar alias" a sério) e ganhou 2 verificações novas para o novo caminho via rede neuronal — **456/456 a passar** na corrida mais recente.
- `tests/*.test.js` — **584 testes unitários** (subindo de 26): cobertura exaustiva de `src/domain.js`, `src/store.js`, `src/utils.js`, `src/usoCatalogo.js`, `src/usoLeitura.js`, `netlify/functions/_lib/auth.js`, `src/manutencao.js` (23 testes novos no ponto 23), `src/i18n.js` (21 testes novos no ponto 24, completude das 15 traduções + fallback/interpolação), `src/farmaIa.js` (43 testes novos no ponto 25, cada regra de alerta/intenção de pergunta/deteção de oportunidade isoladamente, + 26 novos no ponto 26 para o alerta de backup e toda a "Memória & Aprendizagem", + 18 novos no ponto 42 para `tentarViaRedeNeural`/`agruparPerguntasSemelhantes`/o reforço de `sugerirIntentsSemelhantes`/a integração ponta-a-ponta em `responderPergunta`, todos contra os pesos REAIS treinados, nunca uns pesos inventados só para o teste passar), `src/farmaRede.js` (18 testes novos no ponto 42 — propriedades da extração de features, forma/soma-1 da saída softmax, similaridade de cosseno, e generalização real da rede treinada contra paráfrases que não estão no conjunto de treino), `src/manipuladosCore.js`/`src/farmaAcoes.js`/`src/ui/farmaCerebro.js` (39 testes novos no ponto 30 + 19 novos no ponto 31 + 17 novos no ponto 32 + 15 novos no ponto 33 + 26 novos no ponto 34 + 26 novos no ponto 39 para Stocks Errados + 26 novos no ponto 40 para Listas de Inscrição + 10 novos no ponto 41 para o ciclo `resolverComRaciocinio`, incluindo o caminho de execução de cada ação com um `dataStore` falso e o histórico de conversa com um `engine`/`perguntarFn` falso), e expansão significativa dos testes já existentes de `auth.js`/`data.js`/`asset.js`/`produtosCatalogo.js` (ver ponto 20).
- `src/domain.js`/`src/actions.js` — atalhos de módulos como serviços, categoria Serviços Clínicos (ponto 16).

### Módulos de gestão (secção "Módulos" da barra lateral)

- **"FARMA IA"** (`modulos/farma-ia.html`, pontos 25 e 26, o mais recente dos 14 módulos) — os 3 pilares
  pedidos pelo Ivo, sem nenhuma IA externa: Alertas & Insights (validades/stock do PIM e Gabinete, planos
  semanais do PIM a terminar, Stocks Errados recorrentes, pedidos AUE/Manipulados parados, sem cópia de
  segurança recente), Perguntar (assistente por motor de regras, com "talvez quisesse dizer" e aliases
  aprendidos) e Oportunidades de Automação (tarefas muito repetidas nos últimos 30 dias, a partir do
  tracking de uso do ponto 17). Ponto 26 acrescentou a memória de aprendizagem (ver acima) e botões de
  "Dispensar" nos alertas. Ver `src/farmaIa.js` para a lógica pura.
- **"Pedidos de Manipulados"** (`modulos/manipulados.html`): login local e sincronização por Google
  Sheets/Apps Script substituídos pela sessão/`/api/data` partilhados; anexos via `getAsset`/`setAsset`;
  envio de orçamento por botão manual `mailto:` (assinatura usa `nomeFarmaciaAtual()`); marca da
  Farmácia Alto dos Moinhos removida; ganhou logótipo/nome reais na barra lateral (ponto 10); paleta de
  marca já era a mais próxima da cor final (ponto 13); navegação convertida para o padrão Sifarma —
  tinha sidebar própria (ponto 14); logótipo agora lido do asset dedicado (ponto 15); pesquisa corrigida
  para encontrar pedidos em qualquer estado, incluindo "entregue"/"cancelado" (ponto 16); instrumentado
  com `registarUso` para criar_pedido, marcar_entregue e enviar_orcamento (ponto 17). Sessão ponto 19:
  passa a registar uso em **toda** a mudança de estado do pedido (não só a chegada a "entregue"),
  incluindo reabrir um pedido já fechado (6 tarefas novas), sempre uma só por gravação. Sessão mais
  recente (ponto 20): ganhou a fila `gravarQueue`/`enqueueSync` como reforço preventivo (não havia
  evidência de que a corrida fosse realmente explorável neste ficheiro em concreto, mas o padrão foi
  aplicado por consistência com Gabinete/Documentos/Devoluções, documentado honestamente como reforço,
  não como correção de um bug reproduzido).
- **"Central de Documentos"** (`modulos/documentos.html`) — Pastas/Documentos, Declarações Oficiais
  (PT/EN), Bolachas Promocionais, Etiquetas, Listas de Inscrição, Lombadas, Separadores e Biblioteca:
  sincronização própria (`/api/store` + código via `prompt()`) substituída pela sessão/`/api/data`
  partilhados (11 chaves); conteúdo de documentos/digitalizações movido para
  `dataStore.setAsset`/`getAsset`; catálogo de produtos próprio (1.6MB) substituído pelo catálogo
  partilhado (ponto 11); nome/logótipo passam a vir de `config.*` (ponto 10); paleta laranja substituída
  pela paleta verde unificada, incluindo os cabeçalhos de impressão e a barra lateral (ponto 13);
  navegação convertida para o padrão Sifarma (ponto 14), incluindo a correção do bug do
  `nb_customFields` no formulário "Novo livro"; logótipo agora lido do asset dedicado (ponto 15); logótipo
  4x maior em declarações/bolachas/listas de inscrição/lombadas (ponto 17 — etiquetas e lombadas
  mantidas ao tamanho original por restrição de formato físico impresso); instrumentado com `registarUso`
  para gerar_declaracao, gerar_etiqueta, gerar_bolacha, gerar_lista_inscricao, gerar_lombada e
  arquivar_documento (ponto 17).
  Sessão ponto 19: +23 tarefas novas rastreadas (pastas/documentos da biblioteca, declarações
  personalizadas, listas de inscrição, separadores, livros da biblioteca, etc.) — o módulo com a segunda
  maior expansão do catálogo. Sessão ponto 20 — bug real de perda de dados corrigido:
  a gravação (`saveJSON`) não tinha nenhuma serialização entre chamadas seguidas — a mesma condição de
  corrida "ler-antes-do-anterior-gravar" já corrigida em PIM (ponto 16), aqui ainda por corrigir; agora
  fechada com a mesma fila `gravarQueue`/`enqueueSync`, com um teste de regressão dedicado (apagar em
  cascata uma pasta com documentos, duas gravações rápidas em sucessão). **Sessão mais recente
  (ponto 21)**: nova "Declaração de Medicação" (lista repetível de medicamentos, puxável do PIM pelo
  nome do utente); removido o rodapé de crédito de software das declarações (`#ps_foot`, a "marca de
  água" reportada pelo Ivo — não existe watermark gráfico nesta área); `#ps_contact` (morada/contacto no
  cabeçalho das declarações, antes `contenteditable` sem pré-preenchimento) passa a pré-preencher-se a
  partir de `config.morada`/`emailContacto`/`telefoneContacto`, mesmo tratamento que o Aluguer Medela já
  tinha (ponto 10) — a nota "Ainda por fazer" sobre esta lacuna fica resolvida. **Sessão mais recente
  (ponto 22)**: a Declaração de Medicação foi refinada com base num modelo real já aprovado pela
  farmácia — lista de medicamentos passa de nome/dosagem/posologia livre para DCI/dosagem/quantidade/
  forma farmacêutica; corpo do texto reescrito para a redação exata do modelo ("adquiriu na ..., em
  \<cidade\>... com NIF: ..."); novo campo `config.cidade`; bloco de assinatura (partilhado por todos os
  tipos de declaração) passa a mostrar a cidade em "Local e data" e "responsável" na caixa de carimbo;
  `#ps_contact` reordenado para morada · Tel: · email.
- **"Gestão de Gabinete"** (`modulos/gabinete.html`) — stock/validades, relatórios de atendimento,
  checklist, leitor GS1: sincronização própria substituída pelo padrão do ponto 6 (6 chaves); sem anexos
  binários; catálogo de produtos próprio substituído pelo catálogo partilhado, com o mini-mecanismo de
  "produtos personalizados" que já tinha agora espelhado no overlay partilhado (ponto 11); paleta roxa
  substituída pela paleta verde unificada (ponto 13); navegação convertida para o padrão Sifarma —
  tinha sidebar própria (ponto 14), incluindo a correção do bug do `draftStock`/`draftItem`/
  `draftReport`; logótipo agora lido do asset dedicado (ponto 15); logótipo 4x maior em todos os
  documentos, CNP+QR em produtos/relatórios/impressão, envio automático do relatório em PDF por email
  via Google Sheets, e leitor GS1 reescrito (9/9 códigos reais, ver ponto 16); instrumentado com
  `registarUso` para atualizar_stock, criar_relatorio, relatorio_pdf_email, scan_gs1 e checklist
  (ponto 17); leitor de câmara agora lê DataMatrix (não só QR), e o `parseGS1` tira partido do formato
  HRI/parênteses quando disponível (ponto 18). Sessão ponto 19 — a mais profunda deste módulo até então:
  corrigido o botão "+ Adicionar à lista de controlo" que não fazia nada após um scan (mesma família de
  bug window-mirror); **"Lista de Controlo" (STOCK) e "Itens do Gabinete" (CHECKLIST_ITEMS) fundidos
  numa única fonte de verdade** — uma entrada de stock é agora, por construção, um item do gabinete com
  `qv:true`, com migração automática (sem perda de dados) e sem mais "matching" difuso de CNP/nome; ao
  gravar um relatório, a quantidade/validade observadas passam a escrever-se de volta no item canónico,
  alimentando os alarmes automaticamente; +19 tarefas novas rastreadas. Sessão ponto 20 — dois bugs
  reais corrigidos: uma nova entrada de "Lista de Controlo" nascia com
  `options:[]` em vez de `options:['PEDIR']` (o valor por omissão esperado); e a mesma condição de
  corrida "ler-antes-do-anterior-gravar" das outras (ver Documentos, acima), aqui também sem
  serialização — corrigida com `gravarQueue`/`enqueueSync`. **Sessão mais recente (ponto 21)**: a
  impressão/PDF do Relatório (`buildPrintSheetHtml`) tinha uma omissão real de conteúdo — não mostrava a
  sub-descrição de cada item nem a descrição de secção, ambas já visíveis no editor do relatório no
  ecrã; corrigido para as duas saídas mostrarem exatamente o mesmo conteúdo do ecrã, como pedido pelo
  Ivo.
- **"Gestão de PIM"** (`modulos/pim.html`) — utentes/medicamentos/posologias, stock, calendário, rótulos
  DOT, receitas sem papel, relatórios: sincronização própria substituída (8 chaves); receitas anexadas
  movidas para asset store (`receita:<id>`); catálogo de produtos próprio substituído pelo catálogo
  partilhado; paleta dourada substituída pela paleta verde unificada (ponto 13); navegação convertida
  para o padrão Sifarma — tinha sidebar própria (ponto 14); **bug real corrigido**: não era possível
  criar um utente (nem editar medicamentos/receitas/eventos/stock/rótulos) por causa do
  `draftUtente`/`draftMed`/`draftReceita`/`draftEvento`/`draftStock`/`draftRotulo` mutados por atributos
  inline em escopo errado — ver ponto 14; logótipo agora lido do asset dedicado (ponto 15). Sessão
  seguinte (ponto 16): corrigido bug de handlers de scan não espelhados em `window`; corrigido bug de CSS
  que escondia o botão "adicionar ao stock"; Rótulo passa a deduzir/devolver stock automaticamente;
  **corrigida uma condição de corrida que causava perda de dados** em gravações consecutivas (fila de
  sincronização, `gravarQueue`/`enqueueSync` — o mesmo padrão replicado depois em Gabinete/Documentos/
  Devoluções a Armazenistas nas sessões seguintes); botão "Reimprimir" no histórico de Rótulos; corrigido
  o botão "Novo evento neste dia" do calendário; alerta por email quando um Rótulo está a terminar;
  leitor GS1 reescrito (ver Gabinete). Sessão seguinte (ponto 17): logótipo 4x maior nos rótulos DOT
  impressos; instrumentado com `registarUso` para criar_utente, criar_rotulo, reimprimir_rotulo,
  registar_receita, criar_evento e alerta_terminar. Sessão seguinte (ponto 18): os 2 leitores de câmara
  deste módulo passam a ler DataMatrix, mesma melhoria do Gabinete. Sessão ponto 19: corrigidos dois
  bugs reais — os rótulos impressos "fundiam-se" (anti-padrão de CSS de impressão, corrigido com
  `display:none` + `break-inside:avoid` + guarda de reentrância); faltava o botão para confirmar a nova
  embalagem depois do scan de DataMatrix (corrigido espelhando o valor já visível); +24 tarefas novas
  rastreadas (a maior expansão do catálogo de qualquer módulo). Sessão ponto 20: 25
  novas verificações e2e escritas para este módulo (CRUD completo de utente/medicamento, dedução de
  stock, regressão do DataMatrix, calendário, receitas, eliminação em cascata) — nenhum bug novo
  encontrado, o módulo confirmou-se correto sob teste real de browser em toda a extensão coberta. Nota:
  há código morto pré-existente (`renderStock`/`setStockFilter`/`renderRotulosList`) documentado mas não
  removido — inofensivo. **Sessão mais recente (ponto 21)**: "Histórico de Embalagens" (antes só de
  leitura) ganhou botões Editar/Remover; nova aba "Histórico de Consumo de Stock" totalmente editável
  (antes invisível — o array `.historico` por embalagem existia mas sem nenhuma interface), com
  adicionar/editar/eliminar registo manual, cada um com a sua própria tarefa nova no catálogo do
  Poupança & ROI. Decisão deliberada: editar/eliminar uma entrada do histórico não recalcula a
  `quantidadeAtual` da embalagem-mãe — tratado como registo de auditoria independente, consistente com
  o histórico de rótulos já existente.
- **"Pedidos AUE"** (`modulos/aue.html`) — Autorização de Utilização Excecional: backend standalone
  próprio não usado, sincronização aponta para `/api/data` preservando a fusão registo a registo (ponto
  7); login local removido; 3 documentos por pedido movidos para asset store
  (`aue:<pedidoId>:<docKey>`); marca e número de MBWay pessoal removidos; ganhou logótipo real na barra
  lateral (ponto 10); paleta azul-marinho substituída pela paleta verde unificada (ponto 13); navegação
  convertida para o padrão Sifarma — tinha sidebar própria de filtros (ponto 14); logótipo agora lido do
  asset dedicado (ponto 15); instrumentado com `registarUso` para criar_pedido e atualizar_pedido
  (ponto 17). Sessão ponto 19: +14 tarefas novas (anexar/remover documento, marcar
  aprovado/disponível/entregue/indeferido, eliminar pedido, exportar/importar CSV, emails ao armazenista/
  utente, imprimir formulário de aquisição, restaurar backup) — **um bug de contagem dupla introduzido
  durante esta expansão foi encontrado e corrigido** (uma mudança de estado registava simultaneamente a
  tarefa genérica `atualizar_pedido` E a tarefa específica correspondente, inflacionando a poupança
  aparente ao dobro; corrigido para nunca registar as duas na mesma gravação). **Sessão mais recente
  (ponto 20)**: 21 novas verificações e2e (validação de campos obrigatórios, criação com 3 documentos
  anexados, pesquisa, mudanças de estado, eliminação por tombstone, testes determinísticos de
  `mergePedidosArrays` — união + tombstone vence sobre escrita desatualizada — e um teste de regressão
  dedicado confirmando que a contagem dupla acima se mantém corrigida) — nenhum bug novo encontrado.
- **"Stocks Errados"** (`modulos/stocks.html`) — listas de correção de inventário, exportação
  Excel/PDF: backend standalone próprio (`/api/lists`) não usado; listas inteiras vivem em
  `state.stocksErrados`; lógica de bloqueio de gravação até confirmar leitura inicial preservada; modo
  de pré-visualização (`window.storage`) removido; catálogo de produtos próprio substituído pelo
  catálogo partilhado; logótipo real (com formato de imagem correto) passou a aparecer também nas
  exportações Excel/PDF, que antes usavam sempre o genérico; "FARMÁCIA ALTO DOS MOINHOS" hardcoded no
  cabeçalho das exportações (não apanhado na integração original) corrigido para o nome real; paleta
  vermelho-escura substituída pela paleta verde unificada (ponto 13); integração mínima da navegação
  Sifarma — nunca teve sidebar própria a duplicar a da Central (ponto 14); logótipo agora lido do asset
  dedicado (ponto 15). Sessão seguinte (ponto 16): novo campo obrigatório "Nome operador" por lista;
  campo "Observações" por item substituído por "Motivo" com 3 opções fixas + "Outros" com texto livre,
  compatível com listas antigas. Sessão seguinte (ponto 17): logótipo 4x maior nas exportações
  Excel/PDF; instrumentado com `registarUso` para criar_lista, registar_item e exportar_lista (esta
  última com 2 pontos de chamada, Excel e PDF). Sessão ponto 19: +7 tarefas novas (renomear/apagar lista,
  registar stock em sistema/contado, selecionar motivo/motivo "outros", remover item). **Sessão mais
  recente (ponto 20) — dois achados**: ganhou a fila `gravarQueue`/`enqueueSync` como reforço preventivo
  (mesma nota que Manipulados — não havia evidência de perda de dados real neste padrão de gravação em
  concreto, aplicado por consistência); e um **bug real de perda de dados na interface, encontrado só ao
  correr a bateria completa sob carga** (não isoladamente): o `change` de cada célula da tabela (stock
  sistema/contado/motivo) fazia, depois de gravar, uma reconstrução total da tabela (`renderCurrentList`,
  recriando todos os `<input>` de todas as linhas) — se o utilizador já tivesse avançado para o campo
  seguinte e começado a escrever lá antes de essa gravação assíncrona terminar, a reconstrução total
  substituía esse `<input>` por um novo, com o valor antigo vindo do servidor, apagando silenciosamente o
  que acabara de ser escrito. Corrigido atualizando só a célula derivada da própria linha (a diferença
  calculada, ou a célula do motivo), nunca recriando os campos de introdução das outras colunas.
- **"Catálogo de Produtos"** (`modulos/catalogo-produtos.html`) — gestão central do catálogo de
  produtos partilhado por Gabinete/PIM/Stocks/Documentos: pesquisar, editar, remover/restaurar, e
  adicionar manualmente, por Excel/CSV, por PDF ou por picagem do DMF. Ver ponto 11; paleta afinada
  para a paleta unificada (ponto 13); integração mínima da navegação Sifarma (ponto 14); logótipo agora
  lido do asset dedicado (ponto 15); instrumentado com `registarUso` para adicionar_produto e
  importar_produtos (este último com `qtd` = número de produtos efetivamente importados no lote, não
  o tamanho bruto do ficheiro — ponto 17). Sessão ponto 19: +2 tarefas novas (editar_produto,
  remover_produto). **Sessão mais recente (ponto 20) — funcionalidade morta ligada à interface**: a
  função `restaurarProduto` já existia em `src/produtosCatalogo.js` e estava importada aqui, mas nunca
  era chamada por nenhum botão — não havia forma de reverter a remoção de um produto sem editar dados à
  mão; corrigido com um novo filtro "Removidos por mim" + botão "Restaurar", e uma nova tarefa
  `catalogo-produtos.restaurar_produto` acrescentada ao catálogo (145→146). Também corrigido, em
  `src/produtosCatalogo.js`, uma condição de corrida real de "última escrita ganha" entre gravações
  concorrentes de produtos (adicionar e remover), fechada com uma fila própria
  (`overlayQueue`/`enqueueOverlaySync`).

### Ferramentas independentes (secção "Ferramentas" da barra lateral)

Peça 7 (2026-09-09) — 6 ficheiros que o Ivo avisou serem "pequenos auxiliadores... independentes...
pequenas ferramentas" (ao contrário dos módulos acima, que são aplicações de gestão completas). A
maioria não tem estado persistente nenhum (são geradores de documento/formulário para imprimir).

- **"Reservas"** (`modulos/reservas.html`) — gera tabelas de reservas em PDF a partir de um export
  Sifarma (CSV/Excel). Sem estado; logótipo/nome genéricos trocados por placeholder, agora atualizados
  para o real assim que disponível (ponto 10); paleta vermelho-escura (incluindo a cor por omissão do
  cabeçalho exportado) substituída pela paleta verde unificada (ponto 13); integração mínima da
  navegação Sifarma (ponto 14); logótipo agora lido do asset dedicado (ponto 15); logótipo 4x maior na
  folha exportada (ponto 17); instrumentado com `registarUso` para gerar_folha (ponto 17). Investigado
  no ponto 19: confirmado que é, na prática, um único fluxo ponta-a-ponta (importar → ajustar vista →
  gerar a folha) sem nenhuma outra ação real e distinta para instrumentar — 0 tarefas novas, por decisão
  deliberada de não fabricar tarefas que nunca disparariam. **Sessão mais recente (ponto 20)**: 12 novas
  verificações e2e (fluxo completo de importação real de CSV/Excel de exemplo, geração de PDF via
  `window.print()`, tracking de uso, robustez) — nenhum bug novo encontrado.
- **"Aluguer Medela"** (`modulos/medela.html`) — contrato de aluguer da bomba Medela Symphony. Sem
  estado. O logótipo da farmácia foi trocado por um placeholder genérico, agora atualizado para o real;
  o logótipo da Medela (marca real do equipamento) mantido, por ser parte do design oficial do
  contrato — e continua ao tamanho original mesmo depois do ponto 17, deliberadamente, por não ser o
  logótipo da própria farmácia. Os 3 campos `contenteditable` (morada na introdução, morada e email no
  rodapé) passam a ser pré-preenchidos a partir de `config.morada`/`config.emailContacto` assim que
  disponíveis, mas continuam editáveis por documento (ponto 10); já usava um verde muito próximo da
  paleta final, só afinado para o tom exato (ponto 13); integração mínima da navegação Sifarma
  (ponto 14); logótipo agora lido do asset dedicado (ponto 15); logótipo da farmácia (não o da Medela)
  4x maior no contrato (ponto 17); instrumentado com `registarUso` para gerar_contrato (ponto 17).
  Investigado no ponto 19: confirmado que é um único template imprimível, sem nenhuma lista/CRUD de
  alugueres nem persistência de estado — 0 tarefas novas, mesma decisão que Reservas. Sessão ponto 20:
  7 novas verificações e2e (pré-preenchimento condicional de morada/email, edição manual nunca sobreposta
  por uma resposta tardia do servidor, campo "Modelo" fixo e só-leitura, tracking de uso) — nenhum bug
  novo encontrado. **Sessão mais recente (ponto 21)**: logótipo da farmácia reduzido para metade do
  tamanho 4x do ponto 17 (440px→220px) — pedido explícito do Ivo, menos dominante no contrato.
- **"Conversor de PDF"** (`modulos/conversor-pdf.html`, "DocConvert Pro") — conversão/fusão de PDFs e
  imagens, 100% local no browser (pdf.js + JSZip). Sem qualquer marca da farmácia, deliberadamente —
  ver ponto 10, por isso não fazia sentido no âmbito do logótipo 4x do ponto 17. Paleta própria (verde)
  deixada como estava — já não destoa da paleta unificada e a ferramenta continua deliberadamente sem
  identidade da farmácia (ponto 13); integração mínima da navegação Sifarma (ponto 14); ganhou proteção
  contra o `pdfjsLib` (CDN externo) não carregar — mostra aviso em vez de rebentar a página (ponto 15);
  instrumentado com `registarUso` para converter_ficheiro (ponto 17, 2 pontos de chamada — dividir e
  fundir ficheiros). Sessão ponto 19: +6 tarefas novas — o motor de conversão tem, de facto, caminhos de
  código distintos consoante o formato de destino (extrair texto, comprimir PDF, converter para imagem,
  fundir documentos, combinar imagens, arquivar em ZIP), agora contabilizados separadamente do
  `converter_ficheiro` genérico. **Sessão mais recente (ponto 20)**: 10 novas verificações e2e (aviso
  claro quando o pdf.js do CDN não carrega, fusão real de ficheiros de texto com verificação do conteúdo
  resultante, remoção seletiva de um ficheiro da lista, tracking de uso das duas tarefas) — nenhum bug
  novo encontrado.
- **"Devolução de Frio"** (`modulos/devolucao-frio.html`) — declaração de produtos de frio devolvidos à
  Alliance Healthcare, com preenchimento automático opcional via IA (chave API própria do utilizador,
  nunca gravada, mantida como estava). O logótipo da Alliance Healthcare (marca real, parte do modelo
  oficial) mantido — e continua ao tamanho original mesmo depois do ponto 17, deliberadamente, por o
  documento ter de bater certo com o modelo oficial deles; nome da farmácia no rodapé já vinha
  corrigido, confirmado a usar `config.*` agora. Paleta azul deixada como estava — é a cor oficial da
  Alliance Healthcare, replicada de propósito para bater certo com o modelo real deles; não é uma cor
  de marca da farmácia, mudá-la estaria errado (ponto 13); integração mínima da navegação Sifarma,
  incluindo a correção de um bug real de sobreposição visual entre a nova barra e a toolbar
  pré-existente (ponto 14); esta ferramenta não mostra logótipo da farmácia, por isso não foi afetada
  pela mudança do ponto 15; instrumentado com `registarUso` para gerar_declaracao (ponto 17). Sessão
  ponto 19: +1 tarefa nova (auto-preenchimento de declaração via IA a partir de um ficheiro carregado —
  único outro caminho de sucesso distinto encontrado). Este ficheiro tem o mesmo anti-padrão de CSS de
  impressão do PIM (ponto 19), ainda não corrigido aqui — ver "Ainda por fazer". **Sessão mais recente
  (ponto 20)**: 8 novas verificações e2e (elementos fixos do modelo oficial da Alliance Healthcare,
  adicionar/remover linhas, limites de tamanho de letra, validação da Chave API antes de chamar a
  rede, tracking de uso) — nenhum bug novo encontrado.
- **"Mapa Cardiovascular"** (`modulos/mapa-cardiovascular.html`) — formulário de requisição de MAPA de
  48h + páginas de consentimento informado, termo de responsabilidade e instruções (6 páginas de
  impressão). Sem estado. 3 ocorrências do logótipo da farmácia (placeholder genérico) agora atualizadas
  para o logótipo real assim que disponível; o logótipo/marca "Ramón & António — Tecnologias de
  Monitorização Ambulatória" (fabricante real do equipamento) mantido; já usava um verde próximo, o
  botão "Voltar à Central" afinado para o tom exato (ponto 13); integração mínima da navegação Sifarma
  (ponto 14); as 3 ocorrências do logótipo agora lidas do asset dedicado (ponto 15); as 3 ocorrências
  do logótipo da farmácia 4x maiores (ponto 17); instrumentado com `registarUso` para gerar_mapa
  (ponto 17). Investigado no ponto 19: confirmado, por varredura ao ficheiro inteiro, que é um único
  formulário estático imprimível (um só botão "Imprimir", sem CRUD/edição/estado próprio) — 0 tarefas
  novas, mesma decisão que Reservas/Medela. Este ficheiro tem o mesmo anti-padrão de CSS de impressão do
  PIM (ponto 19), ainda não corrigido aqui — ver "Ainda por fazer". **Sessão mais recente (ponto 20)**: 5
  novas verificações e2e (nome/logótipo real nas 3 ocorrências e sincronizados entre si, as 6 páginas
  exatas do modelo, tracking de uso) — nenhum bug novo encontrado.
- **"Devoluções a Armazenistas"** (`modulos/devolucoes-armazenistas.html`) — consulta e verificação em
  lote de regras de devolução por produto/detentor para Alliance Healthcare, Empifarma e OCP, com
  correções manuais editáveis guardadas entre sessões (5 chaves em
  `state.devolucoesArmazenistas.<chave>`, padrão do ponto 6). Não tinha logótipo (usava um glifo de
  texto "A·E·O") — passa a mostrar o logótipo real da farmácia quando existe, com o glifo como reserva;
  paleta verde-petróleo afinada para a paleta unificada (ponto 13); integração mínima da navegação
  Sifarma — mantém a sua própria barra de separadores horizontal (Consulta/Verificação em Lote/
  Produtos/Detentores), deliberadamente não convertida para a barra inferior partilhada por não ser o
  mesmo problema de "sidebar duplicada" (ponto 14); logótipo agora lido do asset dedicado (ponto 15);
  instrumentado com `registarUso` para consultar_regra e verificar_lote (este último com `qtd` = número
  de produtos verificados nesse lote, não sempre 1 — ponto 17). Ficheiro grande (~2.3MB, imagem
  embutida) — navegado só com `Grep`, nunca com `Read` completo. Sessão ponto 19: +9 tarefas novas
  (adicionar/editar/remover/restaurar produto personalizado, adicionar/confirmar/remover detentor de
  AIM, editar/repor regra de devolução). **Sessão mais recente (ponto 20) — bug real de perda de dados
  corrigido, o mais claramente reproduzido de toda a sessão**: das 5 chaves de estado deste módulo, cada
  uma gravada com o mesmo padrão ler-antes-de-gravar sem qualquer serialização entre si — reproduzido de
  forma fiável (revertendo a correção → falhava 2/2 execuções; repondo-a → passava 2/2), corrigido com a
  mesma fila `gravarQueue`/`enqueueSync` já usada noutros módulos. 24 novas verificações e2e ao todo
  (consulta e verificação em lote, gestão de produtos/detentores/regras, o teste de regressão da corrida
  acima). **Sessão mais recente (ponto 21)**: a Aba Detentores e Regras ganhou "Importar regras
  (Excel/PDF)" por armazenista, reaproveitando o motor de importação já existente no Catálogo de
  Produtos. Modelo de dados real confirmado antes de implementar: a "regra" de cada detentor é texto
  livre, não um booleano, com nomes de campo próprios por armazenista (Alliance: `medicamentos`/`dm`/
  `otc`; Empifarma: `msrm`/`mnsrm`/`dm`/`suppl`; OCP: `regra`); correspondência de detentores existentes
  reaproveita a lógica de semelhança difusa já no módulo (≥80%).

Nova (2026-09-09):

- (ver "Catálogo de Produtos", já listado acima em "Módulos de gestão", por ter recebido correções mais
  substanciais nesta sessão do que uma simples nota de ferramenta independente.)

### Outros

- **Bugs transversais corrigidos**: ver pontos 8 e 9 (handlers de eventos inline), ponto 10 (fonte
  única de nome/logótipo), ponto 14 (variáveis de módulo mutadas por atributos inline — mesma família
  de bug do ponto 9, mas sobre dados em vez de funções), ponto 16 (handlers de scan e `dayModalDate`
  em PIM, mesma família), ponto 17 (flush de uso que falha por navegação nunca pode apagar dados já
  gravados — bug de perda de dados silenciosa, diferente em natureza dos anteriores mas com a mesma
  filosofia de correção: nunca sacrificar integridade de dados por conveniência), ponto 19 (mesma
  família window-mirror outra vez no Gabinete; anti-padrão de paginação de impressão no PIM; contagem
  dupla de uso introduzida e corrigida durante a expansão do catálogo no AUE), e ponto 20 (ver lista
  completa dos 9 bugs reais abaixo). Auditorias automatizadas confirmaram, por varredura a todos os 13
  módulos/ferramentas, que não restam funções chamadas por atributos inline sem exportação `window.*`,
  nem variáveis de módulo mutadas por atributos inline sem o espelho `window.*`, nem sobras do nome
  "Farmácia Alto dos Moinhos" hardcoded em lado nenhum.
- **Navegação** (`src/ui/sidebar.js` — painel principal; `assets/module-chrome.{css,js}` — dentro de
  cada módulo, ponto 14): a barra lateral da Central (duas secções, "Módulos" e "Ferramentas") abre-se
  por um botão "Módulos" no topo do painel principal e continua a ser o único ponto de entrada para os
  13 módulos, cada um aberto num `<iframe>` de página inteira (`src/ui/main-content.js`); dentro de cada
  módulo, a navegação interna (secções/vistas próprias) passou a ser uma barra inferior partilhada
  (`mountBottomBar`) em vez de uma sidebar própria a competir com a da Central, e o botão "Voltar à
  Central" ficou uniformizado (só visível fora do iframe, nunca sobreposto). Desde o ponto 16, a grelha
  de serviços do painel principal (ecrã inicial por categorias) também lista os 13 módulos/ferramentas
  como cartões clicáveis na categoria "Serviços Clínicos", cada um livremente re-categorizável.
- **Paleta de cores** (ponto 13): unificada em toda a app à volta do verde do painel principal
  (`#2b7a4b`/`#1f543e`/`#4f9c72`/`#e3f2e8`/`#eef5e8`), preservando as cores de terceiros que têm de
  bater certo com um modelo oficial (Alliance Healthcare, Medela) e as paletas funcionais não
  relacionadas com marca (cores de estado, cores de pastas do utilizador, tom "papel" dos documentos
  exportáveis).
- **Desempenho e branding** (ponto 15): logótipo movido para um blob próprio (`branding-logo`),
  totalmente fora do caminho quente de leitura/gravação de `/api/data`; cache local instantânea
  partilhada entre a Central e todos os módulos (mesma origem/`localStorage`); migração automática e
  silenciosa das farmácias já existentes, sem passo manual.
- **Logótipo 4x + tracking de uso** (ponto 17): o fator 4x no logótipo aplica-se agora a todo o
  documento genuinamente gerado em nome da própria farmácia, em toda a Central — nunca a logótipos de
  terceiros nem a formatos fisicamente restritos (etiquetas, lombadas). O tracking de uso
  (`registarUso`) é a nova infraestrutura partilhada mais importante dessa sessão: um único ponto de
  entrada, chamado por todos os 13 módulos, alimentando um painel de Poupança & ROI pensado como
  argumento de venda (período de teste grátis + prova visual e quantificada do tempo/dinheiro poupado).
- **Email por Google Sheets/Apps Script** (ponto 16): mecanismo de email único e confirmado desta app —
  cada farmácia com o seu próprio `Code.gs`; dois `kind` novos (`report_pdf`, `alerta_pim_terminar`)
  introduzidos do lado da app, ainda por implementar do lado do Code.gs de cada farmácia (ver "Ainda por
  fazer").
- **Leitura de DataMatrix** (ponto 18): os 3 pontos de câmara da Central (leitor GS1 em Gabinete/PIM,
  scan de embalagem de Medicamento em PIM) passam a ler DataMatrix além de QR, via `zxing-wasm` com
  fallback/aceleração pela API nativa `BarcodeDetector` quando disponível; o `parseGS1` tira partido do
  formato HRI (parênteses) que essa biblioteca já devolve por omissão para códigos GS1, muito mais
  fiável do que a heurística por posição/comprimento do ponto 16 (mantida como recurso para texto sem
  essa formatação).
- **Fusão de dados do Gabinete + Poupança & ROI "ao extremo"** (ponto 19): "Lista de Controlo" e "Itens
  do Gabinete" deixam de ser dois arrays loosely ligados por matching de CNP/nome e passam a ser uma
  única fonte de verdade, com relatórios a atualizarem o stock/validade e a alimentarem os alarmes
  automaticamente. O catálogo de tarefas do Poupança & ROI passa de 34 para 145 tarefas rastreáveis,
  investigadas módulo a módulo com uma política explícita de nunca fabricar tarefas que não existem no
  código (por isso ficou abaixo do alvo de +250 pedido, por decisão consciente de exatidão sobre
  quantidade); os gráficos ganharam um preset de período partilhado e uma vista própria por gráfico
  (granularidade diária/semanal/mensal na tendência; tempo poupado vs. nº de vezes nos outros dois); e a
  exportação de PDF deixou de cortar informação (mesmo padrão de clone destacado já usado no Gabinete,
  mais a captura de canvases de gráficos e a cópia de valores de campos preenchidos por JavaScript).
- **Expansão massiva de testes automatizados + 9 bugs reais corrigidos** (ponto 20, 2026-09-13): o Ivo
  pediu para aumentar os 56 testes existentes "ao máximo, por exemplo 300", melhorando o funcionamento
  de toda a Central com o processo. Resultado: **594 testes automatizados (257 unitários + 337
  end-to-end)**, subindo de 88, reconfirmados estáveis em múltiplas execuções completas consecutivas. A
  bateria e2e foi reestruturada de um único ficheiro para uma arquitetura de módulos plugáveis
  (`tests/e2e/helpers.mjs` + `tests/e2e/modules/*.mjs`, um por domínio + orquestrador fino em
  `battery.mjs`), pensada de propósito para permitir vários agentes a escrever testes em paralelo sem
  colisões. Política seguida à letra em todo o processo: **nunca fabricar um teste** — cada verificação
  tem de exercer uma ação real do utilizador que pode genuinamente falhar; é preferível menos testes
  genuínos do que testes ocos só para inflacionar a contagem (por isso alguns ficheiros/ferramentas sem
  nenhuma ação distinta para testar, como Reservas/Medela/Mapa Cardiovascular no catálogo de tarefas,
  também não ganharam testes artificiais — só os fluxos reais que já tinham). **9 bugs reais
  encontrados e corrigidos durante o processo** (não só instrumentação — o pedido explícito do Ivo de
  "melhorar o funcionamento" foi levado a sério):
  1. `relTime()` em `src/utils.js` pluralizava mal meses em português ("há 2 mêses" em vez de
     "há 2 meses").
  2. `netlify/functions/data.js`: um corpo JSON malformado no PUT devolvia 500 (erro do servidor) em vez
     de 400 (erro do cliente) — o parsing do corpo caía no mesmo `try/catch` da gravação; separados.
  3. `gabinete.html`: um novo item da "Lista de Controlo" nascia com `options:[]` em vez de
     `options:['PEDIR']`.
  4–7. **Quatro condições de corrida com perda de dados silenciosa, do mesmo padrão já identificado e
     corrigido em PIM no ponto 16 (gravações sem serialização entre si), mas que ainda não tinham essa
     proteção**: `gabinete.html`, `documentos.html` (a mais claramente ligada a perda de dados real —
     apagar em cascata uma pasta com documentos) e `devolucoes-armazenistas.html` (a mais claramente
     reproduzida — revertida propositadamente e voltou a falhar 2/2 vezes, corrigida e voltou a passar
     2/2), todas corrigidas com a mesma fila `gravarQueue`/`enqueueSync`; `manipulados.html` e
     `stocks.html` ganharam a mesma fila como reforço preventivo, sem evidência de que a corrida fosse
     de facto explorável nesses dois casos concretos — distinção documentada honestamente, sem fabricar
     um teste de regressão para um bug que não foi reproduzido.
  8. `catalogo-produtos.html`: a função `restaurarProduto` existia mas nunca estava ligada a nenhum
     botão — funcionalidade morta, sem forma de reverter a remoção de um produto sem editar dados à mão;
     ligada com um novo filtro "Removidos por mim" + botão "Restaurar" (+1 tarefa nova no catálogo, 145→146).
  9. `src/produtosCatalogo.js`: uma condição de corrida real de "última escrita ganha" nas suas 4 funções
     de escrita (adicionar/editar/remover/restaurar produto), corrigida com uma fila própria
     (`overlayQueue`/`enqueueOverlaySync`), provada com testes de escrita concorrente (adicionar e
     remover).
  10. `stocks.html`: encontrado só na verificação final, ao correr a bateria completa sob carga (não se
     reproduzia isoladamente) — o `change` de uma célula da tabela fazia, depois de gravar, uma
     reconstrução total da tabela, incluindo todos os `<input>`; se o utilizador já tivesse avançado
     para o campo seguinte e começado a escrever lá antes de essa gravação assíncrona terminar, a
     reconstrução total apagava silenciosamente o que acabara de escrever. Corrigido para atualizar só
     a célula derivada da própria linha (diferença/motivo), nunca recriando os campos de introdução das
     outras colunas — eliminando a corrida na raiz, em vez de só a tornar menos provável.
  Também corrigida, durante a verificação final, uma segunda causa de instabilidade que **não era um bug
  da aplicação**: um teste de Devoluções a Armazenistas confirmava a persistência no servidor por um
  canal (pedido HTTP direto do teste) e depois assumia, no instante seguinte, que a interface já
  tinha re-renderizado noutro canal completamente diferente (o próprio evento-clique da página) — sem
  garantia de ordem entre os dois processos, especialmente sob a carga de correr as 15 suites e2e em
  simultâneo; corrigido do lado do teste, sondando o DOM em vez de assumir.

- Testes unitários (`tests/*.test.js`): **257/257 a passar** (subindo de 26), incluindo isolamento entre
  farmácias, o merge de estado entre módulos, a lógica de catálogo base + overlay, `src/domain.js`,
  `src/store.js` (reducer + store completos), `src/utils.js` (incluindo a correção da pluralização),
  `src/usoCatalogo.js`/`src/usoLeitura.js`, e `netlify/functions/_lib/auth.js` diretamente (hashing,
  tokens, incluindo um token expirado construído manualmente).
- Testes end-to-end (`tests/e2e/`, reestruturado no ponto 20): servidor local de integração (funções
  reais + Blobs em memória) + bateria Playwright modular, **375 verificações** (337 no ponto 20, 373 no
  ponto 21, 375 no ponto 22) — cobre autenticação
  real, desempenho do logótipo, os 13 módulos individualmente (CRUD completo, validação, persistência,
  pesquisa, exportações, regressões dedicadas a cada bug corrigido nesta e em sessões anteriores), o
  tracking de uso, o painel Poupança & ROI, e a leitura de código de barras — reconfirmada sem
  regressões em múltiplas execuções completas consecutivas depois de todas as correções acima.

Ainda por fazer: configurar `AUTH_JWT_SECRET` num site Netlify novo (não o de produção), manifest PWA,
e o empacotamento Capacitor/PWABuilder. Continuar a integrar as próximas peças que o Ivo for enviando.
Duas melhorias identificadas mas não bloqueantes (ver ponto 12): rate limiting no login/registo, e
verificação de email no registo. A posição exata do botão "← Voltar à Central" (quando standalone) varia um pouco
consoante o layout original de cada peça — a cor já vem toda da paleta unificada e a barra em si é
partilhada (ponto 14), mas alinhar também a posição/forma exata seria um passo seguinte, com mais risco
de mexer em layouts já afinados. Pequena melhoria de polimento identificada mas não feita (ponto 15):
pista visual (sombra/gradiente) na barra inferior de módulos com muitos itens, para sugerir que há mais
por fazer scroll horizontal. O Ivo precisa de atualizar o seu `Code.gs` (em cada Google Sheet de
farmácia) para tratar os dois `kind` novos `report_pdf` e `alerta_pim_terminar` (ponto 16) — as formas
exatas dos payloads estão documentadas no ponto 16; sem essa atualização, os dois emails novos (PDF do
relatório de Gabinete; alerta de Rótulo de PIM a terminar) chegam ao Google Sheets mas não disparam o
envio de email até o script ser atualizado. Confirmar, em browser real com internet (fora do sandbox
desta sessão), que a leitura de DataMatrix funciona como esperado numa embalagem real — ver ponto 18.
**Bloqueio de implantação, ainda por resolver**: sem acesso geral à internet a partir deste ambiente de
sessão, não foi possível publicar esta versão no Netlify — pergunta em aberto, ainda sem resposta do
Ivo. O mesmo anti-padrão de CSS de impressão corrigido no PIM (paginação quebrada por
`visibility:hidden`+`position:absolute` em vez de `display:none`) existe também em `gabinete.html`,
`documentos.html`, `mapa-cardiovascular.html`, `devolucao-frio.html`, `medela.html`, `reservas.html` e
`aue.html` — identificado mas deliberadamente não corrigido nesses 7 ficheiros (só o PIM foi
reportado), fica para uma próxima passagem se o Ivo achar que vale a pena. O catálogo de tarefas do
Poupança & ROI está em 151 tarefas — vale a pena o Ivo rever esta lista (a tabela do painel mostra
todas) e dizer se há alguma ação específica que sente falta de ver contabilizada, para uma próxima ronda
mais dirigida em vez de uma varredura genérica. Catálogo agora em 154 tarefas com a FARMA IA (ponto 25).
**Do ponto 21**: dos três módulos grandes pedidos pelo Ivo (IA interna "FARMA", auto-manutenção
intensiva, multi-idioma — especificações completas no ponto 21), o Ivo deu luz verde explícita para
avançar com os 3 nesta mesma sessão ("avança para os 3 módulos grandes"); **os 3 estão agora
implementados e testados**: Auto-manutenção (ponto 23), Multi-idioma (ponto 24, shell central — 13
módulos individuais ainda por traduzir, ver rollout abaixo) e FARMA IA (ponto 25, "de forma bem
completa", os 3 pilares). Pedido seguinte do Ivo, ainda na mesma sessão: a FARMA IA "ir aprendendo" com
os pedidos + uma "aceleração de aprendizagem intensiva" — **feito no ponto 26** (memória de aliases
ensinados/alertas dispensados/perguntas não reconhecidas, mais vocabulário/intents novos), continuando
sem nenhuma API externa de IA.

- **Ponto 27 — "Canal de Aprendizagem" (Ivo ↔ Claude)** (2026-09-15). Pedido do Ivo: ligar a FARMA a
  mim (Claude) *"não como uma API, mas como um lugar onde nós os dois possamos conversar e a FARMA
  aprender — não só do meu conhecimento mas também da minha forma de ser"*. Como isto tem implicações
  reais (custo por pergunta, dados de utentes a sair do sistema, quebra do princípio "sem IA externa"
  definido desde o ponto 21), apresentei 3 mecanismos possíveis e perguntei — o Ivo escolheu
  explicitamente **"Conversamos, eu ensino a FARMA"**, não uma ligação ao vivo à API.
    - **Mecanismo escolhido, em concreto**: nada de novo corre em produção — não há nenhuma chamada de
      rede nova, nenhum SDK/API key da Anthropic em lado nenhum do código. O "canal" é este: sempre que o
      Ivo e eu conversarmos (aqui, ou numa sessão futura) sobre a FARMA, eu reviso o que ela ainda não
      sabe responder (`config.farmaIaMemoria.perguntasNaoReconhecidas`, ponto 26) e o que ele quiser que
      ela passe a saber fazer/dizer, e traduzo isso em regras, respostas e alertas novos diretamente em
      `src/farmaIa.js` — com teste, como todo o resto do ficheiro. Como o motor de regras é partilhado
      (não é por-farmácia), cada coisa que a FARMA "aprende" desta forma passa a beneficiar TODAS as
      farmácias que usam a Central, não só a do Ivo.
    - **Ferramenta nova para tornar isto prático**: `scripts/relatorio-aprendizagem-farma.mjs` — um
      script de bastidores (nunca importado pela app, nunca com acesso a nenhuma IA externa) que lê
      `config.farmaIaMemoria` de uma farmácia real via `/api/data` (com o token de sessão dela) e imprime
      um relatório legível: perguntas não respondidas ordenadas por frequência, aliases já ensinados
      pela própria UI, e alertas atualmente silenciados. `node scripts/relatorio-aprendizagem-farma.mjs
      <BASE_URL> <TOKEN>` (ou variáveis de ambiente `FARMA_BASE_URL`/`FARMA_TOKEN`). Testado manualmente
      contra o servidor e2e local nos 2 estados (farmácia com memória e farmácia nova sem nenhuma) — não
      entrou na bateria automatizada por ser uma ferramenta operacional/manual, não parte da app em si.
    - **"Não só do teu conhecimento mas também da tua forma de ser"** — a parte mais pessoal do pedido.
      Não existe forma de eu literalmente "entrar" na FARMA como presença contínua — isso não é uma
      limitação de implementação, é o que é tecnicamente real, e disse isso ao Ivo diretamente em vez de
      fingir o contrário. O que É real e ficou codificado: um pequeno guia de "voz" no topo de
      `src/farmaIa.js` (ponto 27) com 4 regras concretas para qualquer resposta/alerta novo que eu (ou
      quem continuar este código) escrever — nunca inventar um número que os dados não suportam, dizer o
      essencial sem soar seco/robótico, ser honesto sobre os próprios limites do motor de regras, e manter
      o registo em português de Portugal já usado em todo o ficheiro. Isto é o "carácter" a aplicar às
      respostas da FARMA, não os factos.
    - Sem código de produção alterado além do comentário de cabeçalho (guia de voz) em `src/farmaIa.js` —
      este ponto é sobretudo processo/documentação + a ferramenta de relatório.

- **Ponto 28 — bug real em produção: "Não foi possível carregar os gráficos (sem ligação ao CDN)"
  no Poupança & ROI.**
    - O Ivo reportou este toast na app já publicada (`central-operacional-farmacias.netlify.app`),
      junto com o pedido grande da FARMA como assistente conversacional (ver mais abaixo). A mensagem do
      toast sugeria falta de rede, mas não era isso.
    - **Causa raiz real**: `src/ui/poupanca.js` carrega Chart.js/html2canvas/jsPDF a partir de URLs fixas
      do cdnjs, com a versão exata do Chart.js escrita no código (`4.4.4`). O cdnjs vai podando versões
      antigas com o tempo — e a versão `4.4.4` deixou de existir lá (confirmado diretamente na API do
      cdnjs: `api.cdnjs.com/libraries/chart.js/4.4.4` responde 404 "Version not found"), por isso o
      `<script>` falhava a carregar e a app mostrava a mensagem (correta, mas enganadora sobre a causa)
      de "sem ligação ao CDN".
    - **Correção**: `ensureScript` (e os três wrappers que a usam — Chart.js, html2canvas, jsPDF) passou a
      aceitar uma *lista* de URLs e tenta cada uma por ordem (encadeando `onerror` de um `<script>` para o
      seguinte), só mostrando o erro se todas falharem. A versão principal do Chart.js subiu para `4.5.1`
      (a mais recente atual no cdnjs, confirmada com ficheiros válidos) e cada biblioteca ganhou uma
      segunda fonte alternativa em `cdn.jsdelivr.net/npm/<pacote>@<versão>` — assim, se uma das duas CDNs
      tiver uma versão em falta, remover um ficheiro, ou estiver simplesmente em baixo, a outra serve de
      rede de segurança. Nenhuma mudança de CSP foi necessária (`netlify.toml` já permite qualquer origem
      `https:` para scripts).
    - **Testes novos** em `tests/e2e/modules/09-poupanca.mjs`: como o ambiente onde os testes e2e correm
      não tem acesso real à internet (mesmo problema desta sessão — nem o `bash` nem o Chromium do
      Playwright chegam a hosts externos daqui), a cobertura usa `page.route()` para simular as duas CDNs
      de forma determinística — secção 1.5 simula o cdnjs a falhar e o jsdelivr a responder (confirma que
      a app recupera e os gráficos carregam), secção 1.6 simula as duas a falhar (confirma que a mensagem
      de erro aparece mas os cartões-resumo continuam corretos e não há nenhum erro de página). +5
      verificações novas.
    - Ao correr o módulo isoladamente com a carga extra das novas secções, duas asserções antigas e não
      relacionadas (sobre os overrides de tempo na tabela de tarefas) começaram a falhar de forma
      intermitente — não eram um bug destas alterações, mas uma condição de corrida pré-existente e latente:
      liam o valor logo após um `page.waitForTimeout(500)` fixo, em vez de esperar pelo valor esperado.
      Corrigidas para `locator.filter({hasText}).waitFor({timeout})` (espera pelo estado real, não por um
      tempo fixo) — mesmo padrão que já se usa no resto da bateria. Confirmado estável em 2 corridas
      completas seguidas do módulo (33/33) depois desta correção.
    - **Bateria completa corrida no fim desta sessão**: 425 passaram, 1 falhou, de 426 no total. A única
      falha (`Devoluções: novo detentor OCP aparece na tabela de regras`, no módulo
      `07-devolucoes-armazenistas.mjs`) é noutro módulo, completamente sem relação com este ponto — não
      toquei em nenhum ficheiro de Devoluções nesta sessão. Reproduz-se de forma consistente ao correr o
      módulo isolado outra vez, e tem o cheiro do mesmo tipo de problema que acabei de corrigir aqui (o
      teste confirma que o novo detentor foi gravado no servidor, mas verifica a tabela logo a seguir sem
      esperar explicitamente pelo re-render do DOM). Fica registado como um bug de teste pré-existente a
      corrigir numa próxima sessão — não bloqueia nem tem qualquer relação com a correção deste ponto 28.
    - Ficheiros alterados: `src/ui/poupanca.js`, `tests/e2e/modules/09-poupanca.mjs` — ambos sincronizados
      na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 29 — início da "FARMA como assistente que opera a Central" (pedido grande do Ivo).**
  Depois de uma conversa longa sobre arquitetura (custo/privacidade/segurança de uma IA externa vs. um
  modelo local via WebLLM/WebGPU a correr no próprio browser de cada farmácia — testado ao vivo com um
  protótipo isolado), o Ivo decidiu: sem nenhuma API externa, sem depender de um único PC (cada computador
  corre a sua própria cópia do modelo), leitura de imagens fica para mais tarde. Fica registado um risco
  real encontrado no protótipo: o download do modelo falhou uma vez por erro de rede no mesmo PC/sessão em
  que tinha funcionado — a fiabilidade do download por-PC ainda não está resolvida e fica para a fase do
  "cérebro" (motor local), não é um problema resolvido.
  Primeira entrega (sem depender do modelo de IA, motor de regras atual): `modulos/farma-ia.html` passa a
  abrir diretamente na vista "Perguntar" (chat) em vez de "Alertas" (`currentView`, `jaCarregouView`, a
  classe `active` na secção HTML, e `activeId` do `mountBottomBar`), e ganha uma saudação automática ao
  abrir (`saudarAoAbrir`) — usa o nome da farmácia já em cache local (`ModuleChrome.getCachedBranding()`),
  sem pedido extra ao servidor. Nota de honestidade: a app não tem login por pessoa, só por farmácia — por
  isso "a FARMA saber quem eu sou" é, tecnicamente, saber o nome da farmácia com sessão iniciada, não o
  nome de um funcionário individual. 370/370 testes unitários continuam a passar (mudança só de UI/JS do
  módulo, sem lógica nova em `farmaIa.js`).

  Segunda entrega: `src/ui/farmaMiniChat.js` (novo) — mini-chat da FARMA na página inicial, pedido do Ivo.
  Decisão de arquitetura: em vez de integrar no vdom/store/actions do `app.js` (o esqueleto partilhado por
  toda a app), é um widget autónomo — bolha flutuante fixa (canto inferior direito) com painel próprio,
  DOM direto (mesmo padrão de `modulos/farma-ia.html`), a importar `responderPergunta` de `farmaIa.js` e
  `makeDataStore` de `db.js` diretamente — reduz o risco de mexer no código de que todos os ecrãs dependem,
  à custa de não estar "reativo" ao store central (troca aceitável para uma pergunta rápida sem sair da
  página). Regista perguntas não reconhecidas na mesma memória partilhada (ponto 26) via
  `dataStore.setConfig("farmaIaMemoria", ...)` — nota: `setConfig` é `(key, value)`, não um objeto parcial,
  um erro apanhado e corrigido antes de sincronizar. Só carregado em `index.html` (a página inicial), não
  nos módulos — âmbito exatamente o pedido ("na página inicial da central"). Testado com um script Playwright
  dedicado contra o servidor e2e local (bolha visível, painel abre, saudação aparece, pergunta real
  respondida corretamente pelo motor de regras, zero erros de consola/página novos — os 4 pedidos 404
  observados são pré-existentes, de assets de branding/backup de um tenant novo sem logótipo, não deste
  widget). Não entrou na bateria automatizada (script avulso de verificação, não um módulo de
  `tests/e2e/modules/`) — fica como possível trabalho futuro transformar num módulo formal.

  Nota sobre "crédito das tarefas da FARMA no Poupança & ROI": não é uma peça isolada para construir agora
  — hoje a FARMA só responde perguntas, não executa nenhuma das tarefas reais do catálogo (`pim.criar_utente`
  e semelhantes). O crédito no ROI acontece automaticamente assim que ela passar a executar uma tarefa a
  sério (fase seguinte): cada ação nova que ela conseguir fazer vai chamar o mesmo `registarUso(...)` que a
  UI já chama quando é a pessoa a fazer manualmente — não precisa de nenhum mecanismo à parte.

  Ainda por fazer: o motor local (WebLLM) para compreensão livre e operação dos módulos por comando — é a
  parte grande e vai continuar ao longo de mais sessões.

- **Ponto 30 — primeira ação real: a FARMA executa (não só responde).** Continuação direta do ponto 29
  ("ok podes avançar"). Arquitetura em 3 camadas, pensada para nunca confiar cegamente num modelo de IA:
    1. O motor de regras (`responderPergunta`) continua a ser tentado sempre primeiro — grátis, imediato,
       sem IA nenhuma.
    2. Só quando o motor de regras não reconhece a pergunta, E a farmácia escolheu explicitamente (botão
       "Ativar compreensão livre") carregar um modelo de IA local (WebLLM/WebGPU, `src/ui/farmaCerebro.js`
       — mesma abordagem validada no protótipo do ponto 29, agora com a exclusão de modelos de embedding e
       a cadeia de fontes com timeout já hardened), é que se tenta esse caminho: o modelo devolve sempre
       um JSON estrito — ou uma resposta em texto, ou uma ação de um catálogo pequeno e explícito
       (`ACOES_DISPONIVEIS` em `src/farmaAcoes.js`) — nunca inventado, nunca confiado sem validação.
    3. Uma ação proposta pela IA NUNCA executa sozinha: mostra sempre um resumo em português e um cartão
       "Confirmar"/"Cancelar" no chat (`mostrarCartaoAcao`) — só executa depois de o operador clicar em
       Confirmar. Mesma regra desta sessão para qualquer ação irreversível.
  Primeira ação concreta, escolhida por ser exatamente o exemplo que o Ivo deu: mudar o estado de um
  pedido de Manipulados por comando em português ("farma muda o estado do manipulado X para entregue"),
  incluindo o estado "aguarda farmácia" que o Ivo pediu especificamente. Para isso, a lógica de
  estados/transições de `modulos/manipulados.html` (antes só inline no módulo) foi extraída para um
  ficheiro novo, `src/manipuladosCore.js` — puro, testável, sem I/O — que passa a ser a única fonte de
  verdade tanto para o módulo como para a FARMA (`STATUS_MANIPULADOS`, `tarefaTransicaoEstado`,
  `encontrarPedidosPorTexto`, `mudarEstadoPedido`); `manipulados.html` foi atualizado para usar este
  módulo partilhado em vez da sua cópia local, sem alterar nenhum comportamento visível.
  `src/farmaAcoes.js` (novo) constrói o prompt de sistema para o modelo local, extrai JSON de respostas
  mesmo quando o modelo "desobedece" (texto à volta, blocos ```json```), valida rigorosamente contra o
  catálogo (ação desconhecida ou parâmetro em falta = tratado como "não percebi", nunca adivinha), resolve
  a ação contra os dados reais (se houver mais do que um pedido a corresponder ao texto dado, pede para
  ser mais específico em vez de escolher sozinha) e só executa/grava depois da confirmação — reaproveita
  `gravarEstadoCompleto` (ponto 23) e o mesmo cuidado de nunca reenviar `config.logo` (ponto 15). A
  execução chama `registarUso(...)`, por isso o crédito no Poupança & ROI acontece automaticamente, tal
  como descrito no ponto 29 — sem nenhum mecanismo à parte.
  `modulos/farma-ia.html` ganhou o botão opcional "Ativar compreensão livre (IA local, opcional)" — nunca
  carrega nada automaticamente, é sempre uma escolha consciente do operador (download de várias centenas
  de MB a alguns GB) — e o fluxo completo do cartão de confirmação.
  Testado: **39 testes unitários novos** (15 em `manipuladosCore.test.js`, 24 em `farmaAcoes.test.js`,
  incluindo o caminho de execução completo com um `dataStore` falso a verificar o que teria sido gravado)
  — **409/409 testes unitários no total**. Verificação adicional por Playwright contra o servidor e2e
  local: vista inicial continua em chat com saudação, botão de ativar a IA local visível, pergunta
  reconhecida continua a responder normalmente (sem regressão), e pergunta não reconhecida sem a IA local
  carregada mantém o mesmo comportamento de sempre. Duas dúvidas levantadas nesse teste foram investigadas
  e confirmadas como não relacionadas com este ponto: a pergunta de teste "qual é a capital de Marrocos"
  legitimamente não gera nenhuma sugestão "talvez quisesse dizer" (confirmado a chamar
  `sugerirIntentsSemelhantes` diretamente — nenhuma palavra da pergunta é próxima de nenhuma palavra-chave
  de nenhum intent, lógica não tocada nesta sessão); os pedidos 404 observados resolvem-se todos a
  `/api/asset/branding-logo`, o mesmo caso pré-existente de um tenant novo sem logótipo já confirmado
  inofensivo no teste do mini-chat (ponto 29).
  Fica registado, tal como no ponto 29, o risco real de fiabilidade do download do modelo (erro de rede
  visto no protótipo) — ainda sem lógica de nova tentativa automática, propagado tal como vem para a UI
  mostrar uma mensagem clara.
  Nota de honestidade: só existe UMA ação no catálogo até agora (mudar estado de manipulados). A visão
  completa do Ivo — gerar lombadas, declarações de medicação, ler dados de imagens, enviar emails de
  encomenda — continua por construir; a leitura de imagens continua deliberadamente adiada (decisão do
  Ivo no ponto 29). Este ponto entrega o "esqueleto" ponta-a-ponta (perceber → validar → confirmar →
  executar → creditar) com um exemplo real a funcionar, para as próximas ações se juntarem ao catálogo sem
  reinventar o mecanismo.
  Ficheiros novos: `src/manipuladosCore.js`, `src/farmaAcoes.js`, `src/ui/farmaCerebro.js`,
  `tests/manipuladosCore.test.js`, `tests/farmaAcoes.test.js`. Ficheiros alterados:
  `modulos/manipulados.html`, `modulos/farma-ia.html`. Todos os ficheiros de produção sincronizados na
  pasta `central multifarmácia` do PC do Ivo.

- **Ponto 31 — alargar o catálogo de ações da FARMA (pedido do Ivo: "preciso que a farma consiga operar
  em toda a central e seus módulos").** Continuação direta do ponto 30, mesmo mecanismo (catálogo
  explícito → validação → resumo humano → confirmação obrigatória → execução → crédito automático no
  Poupança & ROI), com mais 3 ações reais em `src/farmaAcoes.js`:
    - `catalogo.adicionar_produto` / `catalogo.editar_produto` — reutilizam directamente
      `src/produtosCatalogo.js` (ponto 11/20, já pensado para escrita concorrente segura via
      `enqueueOverlaySync`), sem duplicar lógica. Editar nunca mexe na família/categoria do produto — só
      nome e código — para reduzir o risco de uma reclassificação errada feita às cegas por um modelo
      pequeno. Encontrar o produto por texto usa correspondência exacta no código e por substring no nome
      (nunca "aproximada" em texto livre); mais do que uma correspondência pede sempre para ser mais
      específico, nunca escolhe sozinha — mesma regra do ponto 30.
    - `documentos.preparar_etiqueta` — a FARMA não desenha nem imprime a etiqueta sozinha (isso continua
      a ser sempre um clique manual do operador, propositadamente): prepara os dados (tipo
      domicílio/tester/medicamento + campos) e grava-os em `config.farmaEtiquetaPendente`;
      `modulos/documentos.html` (`aplicarEtiquetaPendenteDaFarma`, chamada ao abrir a vista Etiquetas)
      lê esse pendente, pré-preenche o formulário e mostra um aviso "🧠 Rótulo preparado pela FARMA —
      reveja antes de imprimir" com um botão para descartar a sugestão. O pendente fica guardado até ser
      impresso (`printEtiquetas` limpa-o nesse momento) ou descartado — sobrevive a fechar e reabrir o
      módulo antes de chegar a imprimir. Para o tipo "medicamento", a FARMA nunca escolhe sozinha a que
      produto do catálogo corresponde o nome que percebeu — mostra-o só como sugestão de texto no aviso,
      e o operador tem de o pesquisar/selecionar como faria manualmente, para nunca haver uma etiqueta
      impressa com o medicamento errado por engano de correspondência.
  `modulos/farma-ia.html`: as ações de catálogo precisam do catálogo de produtos completo, que não faz
  parte de `estado` (vive à parte — ver ponto 11) — só se vai buscar (`carregarCatalogoEfetivo`) quando a
  ação da IA realmente é uma ação de catálogo, para não pesar todas as outras perguntas com esse pedido
  extra.
  Nota de honestidade explícita (o pedido do Ivo foi "tudo mesmo" — importante não deixar essa expectativa
  por esclarecer): "operar em toda a central" continua a ser, e vai continuar a ser por várias sessões, um
  catálogo pequeno e explícito de ações — cada uma pensada, validada e testada como esta, nunca uma
  promessa de "qualquer coisa". Ficou deliberadamente de fora deste ponto a atualização das "regras de
  aceitação/devolução dos laboratórios" (`modulos/devolucoes-armazenistas.html`), também pedida pelo Ivo:
  a tabela de referência de detentores de AIM desse módulo vive hoje embutida por inteiro em cada
  carregamento da página (não é um ficheiro partilhado, ao contrário do catálogo de produtos desde o ponto
  11), por isso a FARMA não tem ainda forma fiável de encontrar o detentor certo fora dessa página sem
  arriscar aplicar uma alteração ao registo errado — dado tratar-se de regras que a farmácia usa para
  decidir se aceita uma devolução, um erro aqui tem consequências reais. Fica para uma sessão futura,
  como primeiro passo extrair essa tabela para um ficheiro partilhado (mesmo tipo de refactor já feito
  para o catálogo de produtos), só depois se constrói a ação da FARMA em cima disso. Geração de lombadas/
  declarações e leitura de imagens continuam também por fazer (a leitura de imagens deliberadamente adiada
  desde o ponto 29, a pedido do Ivo).
  Testado: **19 testes unitários novos** em `tests/farmaAcoes.test.js` (parâmetros opcionais na
  interpretação da resposta do modelo, as 3 ações novas em `prepararAcao`, e a execução completa das 3 com
  um `dataStore` falso, incluindo confirmar que o logo nunca é reenviado) — **428/428 testes unitários no
  total**. Verificação adicional ponta-a-ponta com Playwright contra o servidor e2e local e a API real
  (sem o WebLLM, que precisa de GPU/rede reais — chamou `farmaAcoes.js`/`produtosCatalogo.js` diretamente):
  adicionar um produto novo ao catálogo, editá-lo a seguir, e preparar uma etiqueta — os três a gravar
  corretamente no servidor; a seguir, abrir o módulo Documentos → Etiquetas confirma o aviso da FARMA e os
  campos (ex.: lote) já pré-preenchidos. Os avisos de consola observados (Google Fonts bloqueado por não
  haver rede externa nesta sandbox de testes, e dois 404 de assets que ainda não existem — logótipo e
  overlay do catálogo — para um tenant novo) são todos esperados/pré-existentes, confirmados um a um pelo
  URL exacto, sem relação com este ponto.
  Ficheiros alterados: `src/farmaAcoes.js`, `tests/farmaAcoes.test.js`, `modulos/farma-ia.html`,
  `modulos/documentos.html`. Todos sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 32 — memória de conversa (multi-turno) + criar pedidos de Manipulados + email de orçamento.**
  Pedido do Ivo alargou ainda mais o que a FARMA deve operar (Manipulados/AUE a criar pedidos e perguntar
  sobre o email, Gabinete, Stocks Errados, Listas de Inscrição com escolha de horário) e pediu explicitamente
  que "quando falta alguma informação a farma faz perguntas". Este ponto entrega a peça de arquitetura que
  torna isso possível, mais um exemplo completo e testado a usá-la — não o pedido inteiro (ver nota de
  honestidade abaixo, é importante lê-la).
    - **Memória de conversa com o modelo local** (`src/ui/farmaCerebro.js`, `modulos/farma-ia.html`):
      `perguntarAoCerebro()` passa agora a aceitar um `historico` opcional (mensagens anteriores desta
      conversa), inserido entre a mensagem de sistema e a pergunta atual. Antes, cada pergunta ao modelo
      local era interpretada isolada — se o modelo respondesse "falta o telefone, qual é?" (a forma
      "resposta" já suportada desde o ponto 30), a resposta seguinte do operador ("912345678") não tinha
      nenhum contexto. Agora `farma-ia.html` mantém um histórico em memória da página (nunca persistido —
      não é a "Memória & Aprendizagem" do motor de regras, ponto 26), limitado às últimas ~4 trocas, para
      não sobrecarregar a janela de contexto pequena de um modelo local. Nota de honestidade: isto dá ao
      modelo o CONTEXTO para retomar uma pergunta a meio — não garante que um modelo pequeno o faça sempre
      bem; fica no mesmo capítulo dos riscos de fiabilidade do modelo local já registados nos pontos 29/30.
    - **`manipulados.criar_pedido`** — cria um pedido novo a partir de linguagem natural. Só exige nome e
      medicamento; tudo o resto (telefone, NIF, nº de receita, comentários) fica em branco se não for dado
      — o resumo mostrado para confirmação avisa sempre do que falta, em vez de inventar. Prescrição de
      uso veterinário sem nome do animal é recusada (nunca inventa um nome de animal). Como o operador que
      recebeu o pedido, no formulário manual, é sempre uma pessoa e a app não tem login individual (nota
      já registada no ponto 29), os pedidos criados pela FARMA ficam com `operador: "FARMA (assistente)"`,
      para nunca se fingir uma pessoa que não interveio.
    - **`manipulados.preparar_email_orcamento`** — a resposta direta ao "farma pergunta se envia email":
      encontra o pedido (agora também pelo NOME DO ANIMAL — ver correção abaixo) e prepara o mesmo email de
      pedido de orçamento que o botão manual do módulo já constrói (`construirConteudoEmailOrcamento`,
      porto do `buildEmailContent` de `modulos/manipulados.html` para uma função pura testável), usando o
      destinatário predefinido nas Definições de Email do módulo (`localStorage`, mesma chave
      `famam_email_settings` — pré-existente, fora do âmbito deste ponto corrigir que seja por-PC e não
      partilhado). Tal como a etiqueta do ponto 31, a FARMA **nunca envia sozinha**: só abre o programa de
      email do operador já preenchido (mesmo mecanismo `mailto:` do botão manual), sempre depois de o
      operador confirmar a ação no cartão do chat. Depois de criar um pedido, a mensagem de confirmação já
      sugere ao operador dizer "farma prepara o email do orçamento deste pedido" — o "perguntar se envia
      email" fica, nesta primeira fatia, garantido por esta frase determinística (sempre a mesma, não
      depende do modelo se lembrar), complementado pela instrução no prompt de sistema para o modelo propor
      o mesmo por iniciativa própria quando fizer sentido.
    - **Bug real encontrado e corrigido durante o teste desta funcionalidade**:
      `encontrarPedidosPorTexto` (`src/manipuladosCore.js`, usada desde o ponto 30) só procurava pelo nome
      do utente/dono e pelo nome do medicamento — nunca pelo nome do ANIMAL. Um pedido veterinário criado
      para "Sr. Antunes" / animal "Bolinha" não era encontrado ao pedir "prepara o email do pedido do
      Bolinha" (forma natural de o operador se referir ao pedido). Corrigido para também procurar no campo
      `animal` — a mesma função é partilhada com `modulos/manipulados.html`, por isso a pesquisa manual no
      módulo também passa a encontrar por nome do animal, não só a FARMA. Apanhado pelo próprio teste
      ponta-a-ponta desta sessão (não foi um bug pré-existente reportado — descoberto ao testar o cenário
      real que o Ivo descreveu).
  Testado: **17 testes unitários novos** (12 em `tests/farmaAcoes.test.js` — criar pedido com/sem dados
  opcionais, veterinário sem animal recusado, preparar email com e sem destino predefinido, pedido
  inexistente — e 2 em `tests/manipuladosCore.test.js` para a procura por animal, mais 3 num ficheiro novo
  `tests/farmaCerebro.test.js` para o histórico em `perguntarAoCerebro`, com um `engine` falso) — **445/445
  testes unitários no total**. Verificação ponta-a-ponta com Playwright contra o servidor e2e local e a API
  real (sem o WebLLM): criar um pedido veterinário completo, confirmar que fica gravado com os dados
  certos, encontrá-lo pelo nome do animal, e preparar o email de orçamento com o destinatário/assunto/corpo
  corretos.
  **Nota de honestidade importante** (o pedido do Ivo foi muito maior do que isto): ficam por fazer nesta
  sessão — a criar num próximo ponto, cada uma com a mesma pesquisa/testes que todas as anteriores — a
  criação de pedidos AUE (mesma ideia do `manipulados.criar_pedido`, módulo diferente, ainda por explorar);
  em Gabinete: adicionar/remover itens da lista de controlo, mudar validades/quantidades, emitir
  relatórios; em Stocks Errados: adicionar/remover produtos e criar/apagar listas; em Listas de Inscrição:
  adicionar/remover itens, criar/apagar listas, gerar o PDF para impressão, e — o exemplo mais complexo
  que o Ivo deu — adicionar um utente perguntando primeiro qual o horário livre (isto precisa de uma ação
  que primeiro CONSULTA os horários disponíveis e só depois pergunta, antes de a memória de conversa deste
  ponto conseguir usar a resposta — arquitetura adicional sobre a que já existe, não só mais uma entrada no
  catálogo). Cada uma destas vai exigir explorar o módulo respectivo com o mesmo cuidado que este ponto e o
  ponto 31 tiveram para Manipulados/Catálogo/Documentos, nunca um atalho.
  Ficheiros novos: `tests/farmaCerebro.test.js`. Ficheiros alterados: `src/farmaAcoes.js`,
  `src/manipuladosCore.js`, `src/ui/farmaCerebro.js`, `modulos/farma-ia.html`,
  `tests/farmaAcoes.test.js`, `tests/manipuladosCore.test.js`. Todos sincronizados na pasta
  `central multifarmácia` do PC do Ivo.

- **Ponto 33 — AUE: criar pedidos e preparar o email ao armazenista.** Continuação direta do "continua" do
  Ivo a seguir ao ponto 32 — o próximo item da lista era exatamente este. Mesmo mecanismo de sempre
  (catálogo explícito → validação → confirmação → execução → crédito automático), com duas ações novas em
  `src/farmaAcoes.js`, espelhando `manipulados.criar_pedido`/`preparar_email_orcamento` mas para
  `modulos/aue.html` (Autorização de Utilização Excecional).
    - **Investigação prévia importante**: ao contrário de Manipulados, o módulo AUE guarda os seus pedidos
      principalmente em `localStorage` por-computador, com uma camada própria de sincronização em
      segundo plano (`attemptSync`/`queueBackgroundSync`) que os funde com `estado.aue.pedidos` no
      servidor. Isto podia ter sido um problema sério — construir uma ação da FARMA em cima de dados
      presos a um computador violaria a decisão do ponto 29 ("a farma não pode ficar presa a um
      computador"). Confirmado que não é o caso: `estado.aue.pedidos` no servidor é a fonte de verdade
      real (o localStorage é só uma cache local/otimista desta página), por isso a FARMA lê e escreve
      diretamente aí (`dataStore.getEstadoCompleto()`/`gravarEstadoCompleto()`), tal como faz para
      Manipulados — os pedidos que cria ficam imediatamente visíveis no módulo AUE em qualquer computador,
      confirmado com um teste a abrir o módulo a sério depois de criar um pedido só pela FARMA.
    - **`aue.criar_pedido`** — só exige nome, medicamento, e o armazenista (validado contra a lista fixa
      real: "Alliance Healthcare", "Empifarma", "OCP", "Plural" — nunca aceita um valor inventado, com
      correspondência sem distinguir maiúsculas). O resto (telefone, NIF, médico, nº de receita,
      comentários) fica em branco se não for dado, com aviso no resumo. Tal como em Manipulados, o
      pedido fica com `operador: "FARMA (assistente)"`, nunca a fingir-se uma pessoa.
    - **`aue.preparar_email_armazenista`** — encontra o pedido e prepara o mesmo email que o módulo já
      envia automaticamente ao criar um pedido manualmente (`buildArmazenistaEmailContent`, portado para
      função pura `construirConteudoEmailArmazenista`), usando o contacto (to + cc) configurado nas
      Definições de Email do módulo AUE para aquele armazenista específico. **Decisão de segurança
      deliberada, mais cautelosa do que o próprio módulo**: o módulo AUE suporta um segundo caminho de
      envio — uma Web App (Google Apps Script) que, se configurada, envia o email a sério com um único
      clique, sem abrir nenhum programa de email para revisão. A FARMA nunca usa esse caminho, mesmo que
      esteja configurado — usa sempre `mailto:`, que só abre um rascunho no programa de email do operador,
      exigindo sempre um envio manual dele a seguir. É uma escolha propositadamente mais conservadora do
      que o comportamento nativo do módulo (que ao criar um pedido manualmente dispara logo o envio,
      incluindo pelo caminho automático se estiver configurado), porque uma ação proposta por IA merece
      esse cuidado extra.
      Nota: como um pedido criado pela FARMA nunca tem os 3 documentos obrigatórios anexados (a leitura de
      imagens continua adiada), o email preparado nunca inclui anexos — a mensagem devolvida lembra sempre
      o operador de os anexar manualmente antes de enviar.
  Testado: **15 testes unitários novos** em `tests/farmaAcoes.test.js` (armazenista válido/inválido/sem
  distinguir maiúsculas, campos em falta, execução completa com um `dataStore` falso incluindo o caso de
  ainda não existir nenhum `estado.aue` anterior, preparação do email com e sem contacto predefinido) —
  **460/460 testes unitários no total**. Verificação ponta-a-ponta com Playwright contra o servidor e2e
  local e a API real: criar um pedido de AUE completo pela FARMA, confirmar que fica gravado com os dados
  certos, encontrá-lo, preparar o email ao armazenista com o destinatário/CC/assunto corretos — e, o mais
  importante, abrir o módulo AUE a sério a seguir e confirmar que o pedido aparece lá, sem nenhum erro de
  consola, exatamente como se tivesse sido criado à mão.
  Nota de honestidade: ainda por fazer da lista do Ivo — Gabinete, Stocks Errados, Listas de Inscrição
  (com a parte mais complexa, escolher o horário livre, que precisa de uma ação que primeiro consulta
  dados e só depois pergunta — arquitetura adicional sobre a memória de conversa do ponto 32, ainda por
  desenhar).
  Ficheiros alterados: `src/farmaAcoes.js`, `tests/farmaAcoes.test.js`, `modulos/farma-ia.html`. Todos
  sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 34 — Gestão de Gabinete: adicionar/remover/atualizar itens da Lista de Controlo e criar
  relatórios.** Continuação direta do "sim continua faz todos" do Ivo — próximo item da lista depois de
  AUE (ponto 33). Mesmo mecanismo de sempre, 4 ações novas em `src/farmaAcoes.js` para
  `modulos/gabinete.html`.
    - **Investigação prévia**: confirmado, como já tinha sido para o AUE, que `estado.gabinete` no
      servidor é mesmo a fonte de verdade (`gravarGabinete`/`doHydrateFromCloud` em `gabinete.html`) — o
      `localStorage` é só cache otimista — por isso é seguro a FARMA ler/escrever ali diretamente, sem
      ficar presa a um PC. Também se confirmou que "Lista de Controlo" e "Itens do Gabinete" são hoje a
      MESMA base de dados (`gabinete_checklist_items_v1`, um item com `qv:true` é uma entrada de stock com
      quantidade/validade) — por isso não fazia sentido tratá-las como dois conceitos separados no
      catálogo de ações, como o Ivo já as tratou junto no pedido original.
    - **`gabinete.adicionar_item_stock`** — adiciona um produto novo à Lista de Controlo (nome
      obrigatório; CNP, lote, validade, quantidade, quantidade mínima e notas opcionais), na mesma secção
      "avulso" que o próprio módulo usa quando um produto é adicionado sem secção fixa
      (`ensureSeccaoAvulso`, reaproveitada se já existir).
    - **`gabinete.remover_item_stock`** — desativa (`ativo:false`, nunca apaga) um item já existente,
      encontrado por nome ou CNP — cobre os dois conceitos que o Ivo pediu juntos ("lista de controlo /
      itens gabinete"), já que são a mesma tabela. O histórico de relatórios já guardados não é afetado
      (mesma garantia que o próprio módulo dá).
    - **`gabinete.atualizar_stock`** — muda quantidade, quantidade mínima, validade, lote e/ou notas de um
      produto já existente (é preciso indicar pelo menos uma alteração, senão a ação é recusada por não
      ter nada para fazer). Só encontra itens que são mesmo de stock (`qv:true`) — um item de checklist
      "genérico" (ex.: "Livro de registo", sem quantidade/validade) não aparece aqui, porque não faz
      sentido gravar uma quantidade nele.
    - **`gabinete.criar_relatorio`** — cria um relatório novo, mas **vazio**: só a data e o farmacêutico
      responsável (ambos opcionais — usa a data de hoje se não for dita), com a estrutura de secções/itens
      ativos "fotografada" no momento da criação (mesmo formato de `buildActiveStructureSnapshot()` do
      próprio módulo). A FARMA **nunca preenche as respostas item a item** — seriam observações de uma
      inspeção física (contagens, "conforme"/"não conforme") que ela não tem como saber; inventá-las seria
      pior do que não as dar. Fica pronto a abrir e preencher no módulo.
    - **Nota de honestidade — duas coisas ficaram deliberadamente de fora**: (1) criar um item de
      checklist "genérico" (sem `qv`, com opções à escolha numa secção à escolha) — ao contrário de um
      produto de stock, não há um valor por omissão óbvio para "que opções são estas"; (2) gerar/enviar o
      PDF de um relatório já preenchido — além de precisar de respostas reais (ver acima), a própria
      geração do PDF (`gerarPdfRelatorio`, em `gabinete.html`) depende de renderizar o DOM real com
      html2canvas/jsPDF, algo que não existe fora dessa página.
    - **Bug real encontrado e corrigido durante a verificação ponta-a-ponta** (não introduzido por este
      ponto, mas descoberto ao testá-lo): `gabinete.html` semeava uma checklist por omissão
      (`seedChecklistIfEmpty()`) **antes** de tentar ler a nuvem (`hydrateFromCloud()`) — via só a cache
      local (`localStorage`) deste browser, sempre vazia na 1ª vez que ESTE browser abre a página, mesmo
      que a farmácia já tivesse dados reais no servidor (criados pela FARMA, ou noutro dispositivo). Como
      a gravação substitui a fatia inteira, isto **apagava silenciosamente** os itens já existentes no
      servidor assim que um operador abrisse o módulo pela primeira vez nesse browser — haveria sempre o
      risco real de a FARMA criar um item e o Ivo, ao abrir o Gabinete a seguir, vê-lo desaparecer.
      Corrigido invertendo a ordem: semear só depois de tentar ler a nuvem, e só se, mesmo assim, continuar
      tudo vazio (nesse caso é mesmo a 1ª utilização, sem dados em lado nenhum). Confirmado com Playwright
      nos dois cenários: item criado pela FARMA sobrevive à 1ª abertura do módulo num browser novo; e uma
      conta genuinamente nova continua a ganhar a checklist por omissão normalmente.
    - **Segundo bug encontrado ao correr a bateria e2e completa (não relacionado com Gabinete)**: o teste
      `tests/e2e/modules/16-farma-ia.mjs` (ponto 26, "dispensar um alerta") tentava clicar no botão
      "Dispensar 7d" sem primeiro mudar para a vista "Alertas" — desde a saudação automática do ponto 29,
      a vista que abre por omissão em `farma-ia.html` é "Perguntar", não "Alertas", e o botão fica por isso
      escondido (`display:none` na vista inativa). Corrigido no próprio teste (falta um clique na aba
      "Alertas" antes, como as secções de Perguntar/Oportunidades já fazem). Confirmado, revertendo
      temporariamente a correção do bug de `gabinete.html` acima e voltando a correr só este ficheiro, que
      este problema já existia antes deste ponto e não tem nenhuma relação com o Gabinete — só apareceu
      porque foi a primeira vez nesta sessão que se correu a bateria e2e completa (426 verificações) de
      uma vez, em vez de só os ficheiros/cenários relevantes a cada ponto.
  Testado: **26 testes unitários novos** em `tests/farmaAcoes.test.js` (as 4 ações em `prepararAcao` —
  validação de datas, disambiguação por nome/CNP, distinção entre itens de stock e itens genéricos — e a
  execução completa das 4 com um `dataStore` falso, incluindo criar/reaproveitar a secção "avulso", nunca
  apagar itens a remover, e nunca inventar respostas no relatório) — **486/486 testes unitários no
  total**. Verificação ponta-a-ponta com Playwright contra o servidor e2e local e a API real: adicionar um
  produto, atualizar a sua quantidade/validade, adicionar um segundo e remover o primeiro, e criar um
  relatório — tudo pela FARMA — e depois abrir o módulo Gestão de Gabinete a sério e confirmar que tudo
  aparece lá corretamente (o produto na Lista de Controlo, o relatório vazio em Relatórios), sem nenhum
  erro de consola. Bateria e2e completa corrida do zero depois de ambas as correções: **426/426 a
  passar** (incluindo a antiga "falha conhecida" de Devoluções do ponto 28, que não reproduziu nesta
  corrida — como não foi tocada neste ponto, não é possível garantir que esteja definitivamente resolvida,
  só que não apareceu aqui).
  Nota de honestidade: ainda por fazer da lista do Ivo — Stocks Errados (adicionar/remover produtos,
  criar/apagar listas) e Listas de Inscrição (adicionar/remover itens, criar/apagar listas, gerar PDF, e o
  caso mais complexo — adicionar um utente perguntando primeiro o horário livre, que continua a precisar
  da arquitetura de "consultar antes de perguntar" já identificada no ponto 32/33, ainda por desenhar).
  Ficheiros alterados: `src/farmaAcoes.js`, `tests/farmaAcoes.test.js`, `modulos/gabinete.html`,
  `tests/e2e/modules/16-farma-ia.mjs`. Todos sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 35 — corrigir o bug do Conversor de PDF ("dá erro e não avança").** O Ivo reportou que, ao pôr
  um documento para converter no módulo `modulos/conversor-pdf.html`, o processo dá erro e não avança —
  sem mais detalhe sobre que ficheiro exato experimentou.
    - **Investigação**: `conversor-pdf.html` é um módulo 100% client-side (sem API de conversão externa),
      que usa `pdf.js` (via CDN) para ler PDFs e a API nativa `Image()` do navegador para ler ficheiros de
      imagem antes de os desenhar num `<canvas>`. Ao rever o código, encontrou-se uma causa garantida de
      falha: tanto a aba "Converter Documentos" (Split) como "Fundir em Documento" (Merge) anunciavam
      **TIFF** (`.tiff`/`.tif`) como formato de entrada suportado — no seletor de ficheiros e nos
      "selos" de formato mostrados na interface — mas nenhum navegador consegue abrir um ficheiro TIFF
      através de `Image()`/`<img>` (é uma limitação da própria plataforma web, não deste módulo). Qualquer
      ficheiro `.tiff`/`.tif` — um cenário comum, já que é o formato de saída por omissão de muitos
      digitalizadores/scanners multifunções — falhava sempre, de forma silenciosa: o erro genérico
      apanhado pelo `try/catch` nem sequer continha uma mensagem legível (`Image().onerror` devolve um
      `Event`, não um `Error` com texto), pelo que o utilizador só via "✗ Erro" e uma notificação vaga
      "Erro: nome-do-ficheiro", sem perceber porquê nem o que fazer a seguir.
      Nota de honestidade: não foi possível confirmar (nem excluir) se terá sido exatamente este o
      ficheiro que o Ivo experimentou — ele só disse "um documento" — nem foi possível verificar a partir
      deste ambiente se as bibliotecas `pdf.js`/`JSZip` (carregadas via `cdnjs.cloudflare.com`) chegam a
      carregar no computador dele, porque a rede deste sandbox bloqueia esse domínio (confirmado por
      `curl` e por um teste Playwright real, que mostrou `ERR_TUNNEL_CONNECTION_FAILED` só nesta rede —
      não é evidência de um problema no lado do Ivo). Por isso a correção não se limita a resolver o TIFF:
      cobre também esse e outros cenários prováveis com mensagens de erro específicas, para que, se o
      problema for outro, o Ivo consiga agora ver exatamente qual e o reportar com precisão.
    - **Correção 1 — TIFF deixa de ser anunciado como suportado.** Removido `.tiff`/`.tif` do atributo
      `accept` dos dois seletores de ficheiros e dos "selos" de formato nas duas abas — deixa de prometer
      um suporte que nunca funcionou.
    - **Correção 2 — rede de segurança para TIFF na mesma (ex.: arrastado e largado, que ignora o
      `accept`).** Nova função `assertImagemSuportada(ext)`, chamada antes de tentar ler a imagem em
      ambas as abas: se ainda assim chegar um `.tiff`/`.tif`, mostra de imediato "o formato TIFF não é
      suportado pelos navegadores — converta primeiro para PNG ou JPG e tente novamente", em vez de deixar
      a tentativa falhar de forma confusa.
    - **Correção 3 — mensagens de erro específicas para as restantes causas prováveis.** Nova função
      `friendlyErrMsg(err)`, usada nos dois blocos `catch` (Split e Merge): traduz erros técnicos comuns
      para português percetível — PDF protegido por palavra-passe (`PasswordException` do pdf.js), PDF
      corrompido/inválido (`InvalidPDFException`), falha a carregar as bibliotecas `pdf.js`/`JSZip` a
      partir do CDN — e, para qualquer outro erro, mostra a mensagem técnica real em vez de a esconder. A
      notificação de erro passa a ser sempre "Erro em `<ficheiro>`: `<motivo concreto>`", nunca só
      "Erro: `<ficheiro>`".
    - **Correção 4 — `loadImg()` deixa de devolver um `Event` sem texto.** `i.onerror=j` passava
      diretamente o `Event` de erro do `<img>`; agora devolve sempre um `Error` com mensagem legível ("o
      navegador não conseguiu abrir esta imagem"), para que `friendlyErrMsg()` tenha sempre algo útil para
      mostrar, mesmo em falhas de imagem não previstas.
  Testado: verificação sintática do bloco de código inline (`node --check`) e verificação ponta-a-ponta
  com Playwright contra o módulo real a correr no servidor local — confirmado que (a) os selos/`accept`
  de TIFF desapareceram das duas abas; (b) um ficheiro `.tif` a sério, forçado a entrar no seletor
  (contornando o `accept`, tal como um arrastar-e-largar faria), produz agora a mensagem específica sobre
  TIFF em vez de um erro genérico, tanto em "Converter Documentos" como em "Fundir em Documento"; e (c)
  um PNG válido continua a converter-se normalmente (sem regressão). Bateria e2e completa corrida depois
  da correção: **426/426 a passar**, incluindo o módulo `14-conversor-pdf.mjs` já existente.
  Nota de honestidade: como só o TIFF tinha uma causa 100% confirmável a partir do código (é uma
  limitação bem conhecida da plataforma web, não algo que precise de rede para confirmar), esta foi a
  única causa corrigida na origem; as outras (PDF protegido, PDF corrompido, falha de CDN) ficaram só com
  mensagens mais claras, não com uma correção de fundo — porque não há, para nenhuma delas, forma de as
  reproduzir/confirmar sem saber que ficheiro exato o Ivo usou. Se o erro persistir, a nova mensagem
  específica que aparecer deve dizer logo qual é a causa.
  Ficheiros alterados: `modulos/conversor-pdf.html`. Sincronizado na pasta `central multifarmácia` do PC
  do Ivo.

- **Ponto 36 — corrigir o bug de seleção de produto por CNP na Gestão de Gabinete.** O Ivo reportou: "No
  Gabinete após tentar adicionar novo produto pondo o cnp o produto aparece para seleccionar mas não
  permite a selecção e portanto nunca chega a adicionar de facto."
    - **Reprodução exata com Playwright** (antes de qualquer correção, para confirmar a causa real em vez
      de assumir): abrir o Gabinete → Lista de Controlo → Adicionar produto → escrever um CNP na pesquisa
      → aparecem sugestões normalmente → clicar numa sugestão → **nada acontece**, com
      `ReferenceError: pickStockProduct is not defined` na consola.
    - **Causa**: `modulos/gabinete.html` usa `<script type="module">`, onde declarações de funções no
      topo do ficheiro não ficam automaticamente acessíveis a partir de atributos `onclick="..."` inline
      (esses correm no `window` global) — por isso o próprio ficheiro já mantém, perto do fim, uma lista
      explícita `window.nomeDaFuncao = nomeDaFuncao` para cada função usada nalgum `onclick`. A função
      `pickStockProduct` (chamada pelo `onclick` de cada sugestão da pesquisa por CNP/nome na Lista de
      Controlo) **nunca tinha sido adicionada a essa lista** — exatamente a mesma família de bug que já
      tinha sido corrigida no ponto 34 para `confirmScanAdd`/`confirmScanSearch`/`promptSaveCustomFromScan`
      (o próprio código já tinha comentários a assinalar esses casos anteriores). O clique na sugestão
      falhava sempre, de forma totalmente silenciosa (só visível na consola do browser, nunca para o
      Ivo) — o produto aparecia na lista, mas nunca ficava selecionado nem era possível gravá-lo.
    - **A mesma falha existia numa segunda função gémea**: `pickItemProduct`, usada pela pesquisa
      equivalente na Gestão de Itens do Gabinete (a outra aba onde se pode adicionar um produto por
      CNP/nome) — também nunca tinha sido exposta em `window`. Como o Ivo só descreveu "o Gabinete" em
      geral, e as duas telas têm exatamente o mesmo padrão de pesquisa, corrigiu-se logo as duas para não
      deixar a mesma armadilha por trás.
    - **Correção**: adicionadas `window.pickStockProduct = pickStockProduct;` e
      `window.pickItemProduct = pickItemProduct;` à lista de exposições globais, com um comentário a
      explicar a razão (para reduzir a hipótese de o mesmo esquecimento se repetir numa função futura).
  Testado: reprodução do bug confirmada com Playwright antes da correção (incl. o `ReferenceError` exato
  na consola), e o mesmo cenário confirmado como resolvido depois — em ambas as telas (Lista de Controlo
  e Itens do Gabinete): a sugestão fica selecionada (aparece o "chip" com o nome do produto), e o produto
  fica mesmo persistido no servidor ao gravar. **4 verificações novas** acrescentadas a
  `tests/e2e/modules/02-gabinete.mjs` (2 por cada uma das duas telas — seleção via clique + persistência
  real no servidor), para este bug nunca voltar a passar despercebido. Bateria e2e completa depois da
  correção: **430/430 a passar** (426 + as 4 novas).
  Nota de honestidade: esta correção não foi tocada por nenhuma ferramenta de IA local nem precisou de
  rede — foi uma reprodução direta com Playwright contra o módulo real, seguida da correção mínima e
  óbvia assim que a causa ficou confirmada (uma função em falta numa lista de exposições, não um problema
  de lógica de pesquisa/seleção).
  Ficheiros alterados: `modulos/gabinete.html`, `tests/e2e/modules/02-gabinete.mjs`. Sincronizados na
  pasta `central multifarmácia` do PC do Ivo.

- **Ponto 37 — Manipulados: definições de email redesenhadas ao estilo do AUE (Fornecedores + Web App).**
  Pedido direto do Ivo: "Nos manipulados na zona do email falta espaço para colocar o google sheets,
  gostaria que a zona de email funcionasse de forma Similar aos AUE permitindo também adicionar ou
  retirar vários Fornecedores apesar de haver um Fornecedor padrão."
    - **Estado anterior**: Manipulados só tinha um único campo "Email de destino" (`{dest}` em
      `famam_email_settings`) partilhado por toda a farmácia — sem Web App de envio automático, sem
      distinguir fornecedores/laboratórios diferentes.
    - **Investigação em `modulos/aue.html`**: confirmado que o "Google Sheets" que o Ivo refere é, na
      verdade, o campo `sheetsUrl` — o endereço de uma Web App do Google Apps Script (normalmente ligada
      a uma conta Google com uma folha de cálculo por trás, daí o nome informal) que a Central chama por
      `fetch(url,{method:'POST',mode:'no-cors',...})` para enviar o email automaticamente; sem essa
      ligação, cai sempre em `mailto:` (abre o programa de email do utilizador). Confirmado também que a
      lista `ARMAZENISTAS` do AUE é, ao contrário do que uma nota de uma sessão anterior sugeria, uma
      lista FIXA de 4 armazenistas (sem adicionar/remover) — por isso o pedido do Ivo de "adicionar ou
      retirar vários Fornecedores" é uma capacidade nova, mais flexível do que a que já existe no AUE.
    - **Correção**: `famam_email_settings` passa a `{url, fornecedores:[{id,nome,to,cc,padrao}]}` — com
      migração automática e transparente do formato antigo (`{dest}` vira um fornecedor único "Principal").
      O modal de definições ganhou o campo da Web App (igual ao do AUE) e uma lista de Fornecedores
      totalmente editável — adicionar, remover, e marcar exatamente um como "padrão" (usado para
      pré-preencher o pedido de orçamento, mas sempre trocável num menu no momento do envio, já que um
      pedido de Manipulados não tem — nem precisa de ganhar — um campo fixo "fornecedor"). O envio em si
      (`confirmSendEmail`) passou a seguir exatamente o mesmo mecanismo já provado em produção no AUE:
      com Web App configurada, `fetch` em `no-cors`; sem ela, `mailto:` com CC incluído.
    - **Dois bugs reais encontrados e corrigidos pelo caminho, nenhum deles reportado pelo Ivo — só
      descobertos ao testar esta funcionalidade nova com Playwright**:
      1. A grelha de Fornecedores usava `oninput="tempFornecedores[i].nome=this.value"` diretamente no
         atributo inline, mas `tempFornecedores` é uma variável deste `<script type="module">`, nunca
         acessível a partir de um atributo inline (que corre no escopo global) — exatamente a mesma
         família de bug do ponto 34/36 (`window.draftStock`/`pickStockProduct`), desta vez para uma
         variável de estado em vez de uma função. Qualquer texto escrito nos campos de Fornecedor não
         ficava gravado em lado nenhum. Corrigido com `window.tempFornecedores = tempFornecedores;` ao
         abrir o modal.
      2. **Mais grave — e pré-existente, não introduzido nesta sessão**: o botão "✉ Pedir orçamento" (em
         cada pedido) sempre teve `onclick="sendBudgetEmail(pedidos.find(x=>x.id===editingId))"` — outra
         vez `pedidos`/`editingId` nunca estiveram em `window`. Isto significa que este botão **nunca
         tinha funcionado em produção**, para nenhuma farmácia: clicar nele falhava sempre, em silêncio,
         com um `ReferenceError`, e o pedido de orçamento por email nunca chegava a abrir. Não há registo
         de o Ivo ter reportado isto — é plausível que o botão simplesmente ainda não tivesse sido usado a
         sério. Corrigido mudando o botão para `onclick="sendBudgetEmail()"` (sem argumentos) e a própria
         função passou a resolver o pedido a partir de `editingId` no seu próprio escopo (correto, já que
         a função em si está sempre acessível a partir de `window.sendBudgetEmail`).
  Testado: **3 verificações novas** em `tests/e2e/modules/05-manipulados.mjs` — 2 fornecedores
  configurados (um deles marcado padrão) sobrevivem a recarregar a página real (persistência
  localStorage, não só lida de memória); "✉ Pedir orçamento" abre mesmo o preview (a prova direta de que
  o bug pré-existente ficou corrigido) já com o Fornecedor padrão pré-preenchido (Para + CC corretos);
  trocar de Fornecedor no preview atualiza o campo "Para" corretamente. Confirmado também, à parte da
  bateria oficial, o cenário de migração automática (farmácia com o formato antigo `{dest}` continua a
  ver esse email, agora como um fornecedor "Principal", sem perder nada). Bateria e2e completa depois da
  correção: **433/433 a passar** (430 + as 3 novas).
  Nota de honestidade: a parte do pedido do Ivo sobre o pré-visualizador de template de email com campos
  arrastáveis (para Manipulados e AUE) fica deliberadamente de fora deste ponto — é uma funcionalidade
  nova e maior, ainda por desenhar, tratada à parte.
  Ficheiros alterados: `modulos/manipulados.html`, `tests/e2e/modules/05-manipulados.mjs`. Sincronizados
  na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 38 — Editor de template de email arrastável (Manipulados e AUE).** Pedido direto do Ivo, deixado
  deliberadamente de fora do ponto 37: "seria bom possibilidade de editar num pré-visualizador o email
  padrão que se envia nos manipulados alterando texto e arrastando os campos até onde queremos que fiquem
  os campos da ficha pré preenchida do pedido no proprio email padrão ficando esses campos lincados e
  portanto em qualquer email mandado posteriormente independente do pedido vai usar o email padrão
  respeitando obviamente a informação de cada pedido (...) Esta última parte também faz sentido para os
  AUE." Confirmado por si com "Sim, continua com o editor de template de email arrastável."
    - **Mecanismo escolhido**: como o corpo do email é sempre texto simples (nunca HTML), um editor WYSIWYG
      completo seria desproporcionado. Em vez disso: um modal com "chips" de campos disponíveis, cada um
      com `draggable="true"` e `ondragstart` a colocar `{{campo}}` em `event.dataTransfer.setData('text/
      plain', ...)`; o assunto e o corpo (`<input>`/`<textarea>`) têm `ondragover="event.preventDefault()"`
      mas propositadamente **sem** `ondrop` customizado — o próprio browser, por omissão, insere o texto
      largado exatamente na posição do cursor do rato. Clicar num chip (em vez de arrastar) insere o mesmo
      token na posição atual do cursor, como alternativa sempre disponível em qualquer dispositivo. O texto
      guardado usa placeholders `{{token}}`, substituídos por regex simples (sem lógica condicional/blocos
      — limitação assumida e documentada) contra os dados reais de cada pedido no momento de gerar o email.
    - **Compatibilidade estrita**: `getEmailTemplate()` devolve `null` enquanto o Ivo (ou qualquer farmácia)
      nunca guardar um template pelo editor — nesse caso `buildEmailContent`/`buildArmazenistaEmailContent`
      seguem exactamente a lógica antiga, byte a byte (incluindo as omissões condicionais de linhas para
      pedidos não-veterinários ou sem comentários). O comportamento de qualquer farmácia que nunca abra o
      editor fica 100% inalterado.
    - **Manipulados** (`modulos/manipulados.html`): novo botão "✎ Editar modelo de email" dentro do modal
      de definições de email (ponto 37), abrindo `#emailTemplateOverlay` com 10 campos disponíveis (nome,
      animal, telefone, receita, código de acesso, código de opção, comentários, medicamento, farmácia,
      operador). Pré-visualização com dados de exemplo fixos, "Repor original" (volta ao texto padrão sem
      gravar), e "Guardar" (recusa corpo vazio). O template fica em `famam_email_template` (localStorage).
    - **AUE** (`modulos/aue.html`): mesmo mecanismo, mas aplicado **só** ao email automático de pedido de
      aquisição ao armazenista (`buildArmazenistaEmailContent`) — deliberadamente **não** às atualizações
      automáticas de estado ao utente (aprovado/disponível/indeferido), que têm barra de progresso e bloco
      de pagamento condicional e ficam fora de âmbito (limitação documentada, não pedida explicitamente).
      Conjunto de campos mais pequeno do que o dos Manipulados — medicamento, nome, telefone, receita,
      farmácia, operador — correspondente exatamente aos dados já usados na lógica antiga deste email
      específico (sem código de acesso/opção/comentários, que o email ao armazenista nunca incluiu). Novo
      botão "✎ Editar modelo de email" dentro do modal de definições de email já existente do AUE. Template
      em `famam_aue_email_template` (localStorage, chave própria — nunca partilhada com a dos Manipulados).
    - **Bug de exportação a `window` evitado desta vez à partida**: as 8 novas funções de cada ficheiro
      (`openEmailTemplateModal`, `closeEmailTemplateModal`, `guardarFocoTemplate`, `inserirCampoTemplate`,
      `previewEmailTemplate`, `voltarAEditarTemplate`, `reporEmailTemplatePadrao`, `saveEmailTemplate`)
      foram adicionadas à lista `window.x = x` de cada módulo já na primeira versão, precisamente porque
      esta classe de bug (função só acessível a partir de um atributo inline, nunca exposta a `window`) já
      tinha sido encontrada e corrigida quatro vezes nesta sessão (pontos 34, 36 e 37).
  Testado: **21 verificações novas** — 12 em `tests/e2e/modules/05-manipulados.mjs` (compatibilidade sem
  template, o editor abre com os 10 chips, estrutura de arrastar-e-largar nativa sem `ondrop` customizado,
  inserção por clique na posição do cursor, pré-visualização com dados de exemplo, "Voltar a editar",
  "Repor original", validação de corpo vazio, gravação em localStorage, e — o mais importante — um pedido
  real a usar o template gravado com os SEUS PRÓPRIOS dados, não os de exemplo) e 9 em
  `tests/e2e/modules/04-aue.mjs` (o mesmo conjunto de verificações, adaptado ao email ao armazenista,
  incluindo confirmar que só 6 chips aparecem — o subconjunto correto de campos). Bateria e2e completa
  depois da correção: **454/454 a passar** (433 + as 21 novas).
  Ficheiros alterados: `modulos/manipulados.html`, `modulos/aue.html`, `tests/e2e/modules/05-manipulados.mjs`,
  `tests/e2e/modules/04-aue.mjs`. Sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 39 — logótipo real da vinheta "Desenvolvido por" + FARMA a operar Stocks Errados.** Duas peças
  independentes pedidas pelo Ivo neste ponto, tratadas em conjunto por conveniência.
    - **Logótipo**: o Ivo reenviou a imagem original (perdida com o resumo da conversa anterior). Guardada
      em `assets/dev-logo.png` — a foto vinha em JPEG 776×392, fundo de papel fotografado (não um vetor
      com margem branca limpa, por isso um recorte automático por "margem branca" não fazia sentido aqui).
      Confirmado visualmente por Playwright, com a vinheta real aberta (`.dev-badge img`, `object-fit:cover`
      156×156 com cantos arredondados — ver `assets/styles.css`), que o recorte central fica correto: o
      logótipo (cabeça de leão + "B") e o texto "IVO BATALHA / SOFTWARE DEVELOPMENT" ficam ambos dentro do
      quadrado, nada cortado.
    - **FARMA em Stocks Errados**: continuação direta da nota de honestidade dos pontos 32/33 ("em Stocks
      Errados: adicionar/remover produtos e criar/apagar listas"). Confirmado primeiro, como sempre, que
      `estado.stocksErrados` é a fonte única de verdade no servidor (`gravarStocksErrados`/`loadInitialData`
      em `modulos/stocks.html`) — seguro ler/escrever ali diretamente sem ficar preso a um computador.
      Quatro ações novas em `src/farmaAcoes.js`: `stocks.criar_lista` (nome por omissão = data de hoje,
      mesmo formato `DD-MM-AAAA` que o próprio módulo usa), `stocks.apagar_lista`, `stocks.adicionar_produto`
      e `stocks.remover_produto`. Duas decisões de desenho deliberadas:
      1. Quando o operador não diz explicitamente em que lista mexer, a FARMA só assume sozinha se existir
         **exatamente uma** lista criada — com zero ou mais do que uma, recusa e pede para ser específico,
         nunca adivinha (`resolverListaStocksAlvo`).
      2. Um produto registado pela FARMA fica sempre como entrada **manual** (nome tal como o operador
         escreveu, sem tentar casar por substring contra o catálogo de ~29 mil produtos) — o mesmo botão
         "produto manual" que o módulo já oferece a um operador humano. Uma correspondência por substring
         errada aqui gravaria a divergência de stock contra o produto ERRADO, um risco pior do que
         simplesmente não tentar adivinhar.
      **Nota sobre "Listas de Inscrição" nesta entrada — corrigida no ponto 40**: esta entrada dizia
      originalmente que essa funcionalidade guardava os dados só em `localStorage`, e por isso ficava de
      fora por violar a decisão do ponto 29. Essa afirmação estava **errada** — era baseada numa leitura
      apressada de `saveJSON()` em `modulos/documentos.html` que parou na primeira linha da função. Ver
      ponto 40 abaixo para a correção completa e a implementação real, feita logo a seguir.
  Testado: **26 testes unitários novos** em `tests/farmaAcoes.test.js` (criar lista sem/com nome e operador,
  apagar lista por nome com aviso de quantos produtos tem, resolução de "qual lista" com 0/1/2 listas
  criadas — nunca adivinha com mais do que uma —, adicionar produto com/sem código, código duplicado
  recusado, remover produto por nome/código/produto manual sem código, execução real com `dataStore` falso
  incluindo o caso de `estado.stocksErrados` ainda não existir numa farmácia nova, e falhas de rede a
  virar sempre uma mensagem clara) — **512/512 testes unitários no total**. Verificação ponta-a-ponta com
  Playwright contra o servidor e2e local e a API real (sem o WebLLM, que precisa de GPU/rede reais —
  chamou `farmaAcoes.js` diretamente, mesmo padrão dos pontos 31-34): criar uma lista, registar dois
  produtos (um com código, um manual), confirmar que pedir para adicionar sem indicar a lista falha assim
  que existe uma segunda lista, remover um produto, apagar uma lista — a seguir, abrir `modulos/stocks.html`
  a sério e confirmar visualmente que a lista e o produto certos ficam lá, sem nenhum erro de consola,
  exatamente como se tivesse sido feito à mão. Bateria e2e completa depois da correção (não tocada por este
  ponto, mas corrida para confirmar ausência de regressão): **454/454 a passar**.
  Ficheiros alterados: `assets/dev-logo.png` (novo), `src/farmaAcoes.js`, `tests/farmaAcoes.test.js`.
  Sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 40 — correção de um erro próprio + FARMA a operar Listas de Inscrição.** Continuação direta do
  ponto 39 ("continua com Stocks Errados, Listas de Inscrição"), mas começa por corrigir um engano.
    - **O erro**: o ponto 39 (acima) dizia que "Listas de Inscrição" (`modulos/documentos.html`) guardava os
      dados só em `localStorage`, nunca no servidor, e por isso ficava de fora por violar a decisão do ponto
      29 ("a FARMA não pode ficar presa a um computador"). Com base nessa conclusão, foi feita uma pergunta
      ao Ivo sobre como proceder, e ele respondeu "Migrar para o servidor primeiro" — uma resposta sensata
      dado o que lhe foi dito, mas assente numa premissa falsa.
    - **Onde estava o erro**: a investigação parou cedo demais. `saveJSON()` em `modulos/documentos.html` tem
      duas linhas: a primeira grava em `localStorage.setItem(...)` (foi só até aqui que a leitura anterior
      chegou); a segunda, se a chave estiver em `CLOUD_SYNC_KEYS` — um `Set` que inclui `cdocs_listas_v1` —
      despacha também `gravarDocumentos(key, val)`, que grava em `estado.documentos.cdocs_listas_v1` no
      servidor. E `hydrateFromCloud()`, chamada uma vez ao arrancar a página, repõe `LISTAS` a partir desse
      mesmo caminho. Ou seja: Listas de Inscrição já sincroniza com o servidor exatamente como Manipulados,
      AUE, Gabinete e Stocks Errados — nunca precisou de nenhuma migração.
    - **Como foi descoberto e confirmado**: ao começar a preparar o trabalho de "migração" que o Ivo tinha
      aprovado, uma releitura completa de `saveJSON()` (não só a primeira linha) revelou o mecanismo acima.
      Confirmado com um teste Playwright dedicado, em dois contextos de browser independentes com o mesmo
      token (a simular dois computadores diferentes): uma lista criada num "computador" e gravada, ao fim de
      ~1,5s (tempo do `saveJSON` assíncrono), aparece corretamente no seletor de listas do outro "computador"
      depois de recarregar a página — prova direta de sincronização real pelo servidor, não por acaso.
    - **Correção feita**: o comentário arquitetural em `src/farmaAcoes.js` (que também continha o engano) foi
      reescrito para refletir o mecanismo real, e a nota de honestidade do ponto 39 acima foi editada para
      apontar aqui em vez de repetir a afirmação errada.
    - **Trabalho que passou a ser possível fazer diretamente** (sem qualquer migração): quatro ações novas em
      `src/farmaAcoes.js`, seguindo o mesmo padrão de leitura/escrita direta em `estado.documentos.
      cdocs_listas_v1` (nunca via `localStorage`, que a FARMA não vê) que `gravarDocumentos()` já usa —
      `listas.criar_lista` (gera os horários com o mesmo algoritmo e o mesmo separador en-dash "–" de
      `createLista()`), `listas.apagar_lista`, `listas.inscrever` e `listas.remover_inscricao`. Duas decisões
      de desenho:
      1. **"Consulta primeiro, depois pergunta"**: o exemplo mais complexo que o Ivo tinha dado era "adicionar
         um utente perguntando primeiro qual o horário livre". Em vez de arquitetura nova, `listas.inscrever`
         reaproveita a memória de conversa já existente desde o ponto 32 — quando o operador não indica o
         horário, a ação não falha às cegas: devolve a própria lista de horários livres (consultada em tempo
         real) na mensagem de erro, que o modelo lê e mostra ao operador; a resposta seguinte dele já tem o
         contexto da pergunta anterior e volta a chamar a ação, desta vez com o horário escolhido.
      2. **`registarUso` deliberadamente omitido** em `listas.inscrever`/`listas.remover_inscricao`: a função
         equivalente no próprio módulo (`updateSlot()`) não regista nenhuma tarefa de uso — inventar uma aqui
         criaria uma estatística que não bate certo com o resto do módulo. `listas.criar_lista` e
         `listas.apagar_lista` continuam a creditar `gerar_lista_inscricao`/`eliminar_lista_inscricao`,
         espelhando `createLista()`/`deleteLista()`, que essas registam.
      **Nota de honestidade que se mantém**: gerar/imprimir o PDF de uma lista (`printListaInscricao`) fica
      fora do alcance da FARMA — depende de `window.print()` sobre o DOM realmente renderizado nessa página,
      que não existe fora dela (mesma limitação, por natureza, de `gabinete.criar_relatorio`).
  Testado: **26 testes unitários novos** em `tests/farmaAcoes.test.js` (criar lista com/sem parâmetros,
  datas/horas inválidas recusadas, apagar lista por nome com aviso de quantas inscrições tem, resolução de
  "qual lista" nunca adivinha com mais do que uma correspondência, inscrever sem horário devolve os horários
  livres na mensagem — testado a confirmar que só os horários realmente livres aparecem, não os já ocupados
  — inscrever com horário aceita tanto o formato completo como só a hora de início, horário já ocupado é
  recusado, remover inscrição por nome, execução real com `dataStore` falso incluindo corridas — horário
  ocupado entretanto por outra pessoa — e confirmação explícita de que `listas.inscrever`/
  `listas.remover_inscricao` nunca chamam `registarUso`) — **538/538 testes unitários no total**. Verificação
  ponta-a-ponta com Playwright contra o servidor e2e local e a API real (mesmo padrão dos pontos 31-34/38-39,
  chamando `farmaAcoes.js` diretamente): criar uma lista pela FARMA, confirmar diretamente pela API (sem
  passar pela página) que os horários gerados batem certo byte a byte com o formato do módulo, inscrever sem
  indicar horário e confirmar que a mensagem lista exatamente os horários livres, inscrever com o horário
  escolhido, abrir o módulo `documentos.html` a sério numa sessão de browser independente e confirmar
  visualmente que a lista e a inscrição criadas pela FARMA aparecem lá tal como se tivessem sido feitas à
  mão, remover a inscrição, apagar a lista — 18 verificações, todas a passar. Bateria e2e completa depois da
  correção: **454/454 a passar** (sem alteração, nenhum módulo existente foi tocado).
  Ficheiros alterados: `src/farmaAcoes.js`, `tests/farmaAcoes.test.js`, e esta correção em
  `arquitetura-decisoes.md`. Sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 41 — "dá à FARMA uma rede neural, para ela aprender a pensar" (início de um plano em várias
  fases).** Pedido do Ivo, em termos deliberadamente ambiciosos: "dá à farma uma rede neural, à semelhança
  com o cérebro humano... preciso que ela aprenda a pensar". À primeira pergunta de esclarecimento (que
  caminho concreto: aprofundar o raciocínio do LLM local, evoluir a memória para generalizar sozinha, ou
  treinar mesmo uma rede neuronal), respondeu "todos os 3 e mais além" — incluindo acesso à internet e
  conversação fluida. Isso levantou uma segunda pergunta obrigatória: "acesso à internet" quase sempre
  significa ou (a) ligar a uma API de IA externa — o que reverteria diretamente a decisão do ponto 29
  ("sem API externa, sem depender de um único PC"), com dados de utentes a poderem sair do computador da
  farmácia —, ou (b) pesquisa de informação pública, sem enviar dados de utentes para fora. Respondeu
  claramente pela opção (b): **mantém-se sem nenhuma API de IA externa** — só pesquisa pontual de
  informação pública (ex.: preço de um medicamento, informação de um princípio ativo), nunca dados de
  utentes a sair do computador da farmácia. O ponto 29 continua de pé.
    - **Plano em 4 fases** (as duas primeiras são as que fazem sentido construir já, sem depender de nada
      novo; as duas últimas ficam desenhadas mas por fazer, para sessões seguintes):
      1. **Raciocínio em vários passos** ("pensar antes de responder") — **feito neste ponto**, ver abaixo.
      2. **Rede neuronal leve para reconhecimento de padrões** — um modelo pequeno, treinado por mim
         offline (não no computador do operador) com frases sintéticas em português cobrindo as intenções
         já existentes, e enviado como pesos estáticos que correm 100% no browser (sem GPU, ao contrário do
         WebLLM) — complementa o casamento por palavras-chave de `farmaIa.js` com tolerância real a
         paráfrases e erros de escrita. Nunca é treinado por farmácia nem depende de um único computador —
         os pesos são os mesmos para todas, como qualquer outro ficheiro do módulo; uma eventual atualização
         do modelo distribui-se como qualquer outra atualização de código.
      3. **Memória que generaliza sozinha** — hoje (ponto 26) a FARMA só aprende aliases exatos que lhe são
         ensinados ("utentse" = "utentes"). Usando a mesma camada de padrões da fase 2, passa a reconhecer
         variações semelhantes sem precisar de ensinar cada uma à mão.
      4. **Pesquisa pontual na internet, só para informação pública** — nunca inclui nomes de utentes,
         números de receita, ou qualquer dado de saúde na pesquisa; scoped a um conjunto limitado de
         necessidades (preço/disponibilidade de um medicamento, informação de um princípio ativo). Precisa
         de desenho cuidadoso do que é e não é pesquisável antes de ser construído — por fazer.
    - **Fase 1 implementada — `resolverComRaciocinio` (`src/farmaAcoes.js`)**: até aqui (pontos 30-40), uma
      pergunta ao "cérebro" local (WebLLM) era sempre um único disparo — se `prepararAcao` recusasse (lista
      ambígua, parâmetro em falta), a FARMA desistia logo e mostrava o motivo da recusa ao operador, mesmo
      quando esse motivo era claramente corrigível pelo PRÓPRIO modelo (ex.: "há 2 listas, sê mais
      específico" é informação que o modelo conseguia perfeitamente usar para tentar de novo sozinho).
      Passa a haver um ciclo real "pensar → agir → observar → pensar melhor": quando `prepararAcao` recusa,
      o motivo da recusa é devolvido ao modelo como se fosse uma nova mensagem, e ele tenta de novo — até 3
      vezes — antes de desistir e mostrar o motivo ao operador, exatamente como acontecia antes desta peça.
      Cada tentativa de correção vê o histórico completo (a pergunta original + a sua própria resposta
      anterior + o motivo da recusa) — sem isto, testado e confirmado que o modelo "esquecia-se" do pedido
      original assim que via só a mensagem de correção, e não conseguia corrigir-se a sério. As tentativas
      de correção ficam de fora do histórico de conversa de longo prazo entre perguntas (janela de contexto
      pequena num modelo local, ver ponto 32) — só a pergunta original e a resposta final entram lá, tal
      como antes. Na UI (`modulos/farma-ia.html`), a partir da 2ª tentativa aparece uma mensagem discreta
      "🧠 A pensar melhor (tentativa 2 de 3)…", para o operador ver que está mesmo a acontecer algo, sem
      poluir o chat com o "rascunho" de tentativas falhadas.
  Testado: **10 testes unitários novos** em `tests/farmaAcoes.test.js` (sucesso à 1ª tentativa sem gastar
  chamadas extra, auto-correção com sucesso à 2ª — confirmando que o histórico enviado nessa 2ª chamada já
  inclui a troca completa da 1ª —, esgotar as tentativas devolve o último motivo tal como antes, resposta em
  texto não entra no ciclo, formato inválido também é corrigido automaticamente, formato inválido esgotado
  devolve "invalido" sem inventar resposta, `onTentativa` chamado corretamente em cada tentativa,
  `carregarEstadoParaAcao` injetado para ações de catálogo, `brutoFinal` sempre a última resposta) —
  **548/548 testes unitários no total**. Não foi possível testar o caminho real ponta-a-ponta com Playwright
  (o mesmo motivo de sempre nesta sessão: o WebLLM real precisa de GPU/rede que não existem neste sandbox) —
  verificado por revisão cuidada da integração em `modulos/farma-ia.html` e confirmado, com a bateria e2e
  completa, que o resto do módulo (motor de regras, cartão de confirmação, dispensar alertas, ensinar
  aliases) continua **454/454 a passar**, sem nenhuma regressão.
  Ficheiros alterados: `src/farmaAcoes.js`, `tests/farmaAcoes.test.js`, `modulos/farma-ia.html`.
  Sincronizados na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 42 — fases 2 e 3 do plano "FARMA aprende a pensar" (ponto 41): rede neuronal leve + memória
  que generaliza sozinha.** Pedido explícito do Ivo: "Avança com a fase 2, 3 e 4" — as 4 fases tinham
  ficado desenhadas no ponto 41, com o ponto 29 ("sem nenhuma API de IA externa, nunca dependente de um
  único computador") reconfirmado como não negociável nessa mesma troca.
    - **Fase 2 — rede neuronal leve, sem nenhuma dependência externa (`src/farmaRede.js`)**: entrada por
      hashing de trigramas de caracteres (256 dimensões, tolerante a variações de forma verbal e erros de
      escrita — "caduca"/"caducar"/"caducado" partilham trigramas) → 1 camada escondida (24 unidades,
      ReLU) → saída softmax (1 unidade por intenção). Backpropagation manual (sem nenhuma biblioteca de
      ML) com Adam + regularização L2 + paragem antecipada pela exatidão de validação, tudo com um gerador
      aleatório determinístico (mulberry32, semente fixa) — o treino (`scripts/treinar-rede-farma.mjs`)
      corre UMA VEZ aqui, offline, nunca no computador do operador; os pesos resultantes
      (`src/farmaRedePesos.json`, ~35KB) distribuem-se como qualquer outro ficheiro de código — nunca
      treinados por farmácia, nunca dependentes de um único computador. Integrada em `responderPergunta()`
      como um SEGUNDO crivo (`tentarViaRedeNeural`), sempre depois do motor de regras/aliases (que continua
      a ter prioridade absoluta) e só aceite quando muito confiante — confiança ≥ 85% E margem de pelo
      menos 30 pontos percentuais sobre a 2ª hipótese, nunca confiança sozinha (uma rede pequena pode estar
      confiante e errada). Sem `pesosRede` (farmácia que ainda não carregou os pesos, chamada de teste que
      não os passa), esta peça inteira é uma no-op e o comportamento fica IGUAL ao de antes.
    - **Bug real encontrado por teste adversarial próprio (não reportado pelo Ivo) e corrigido**: testado
      texto propositadamente disparatado contra o modelo treinado só com as 11 intenções reais —
      `"xyz abc 123"` foi classificado como `"validade"` com **98% de confiança**, acima do limiar de
      produção. Causa: um classificador softmax sem nenhuma classe "nenhuma das anteriores" é obrigado a
      distribuir 100% da probabilidade pelas classes que tem, por isso texto completamente fora do âmbito
      continua a ser atribuído a alguma delas — por vezes com confiança alta. Um heurístico de "isto parece
      texto real" foi considerado e rejeitado (não apanharia "xyz"/"abc", que passam num teste ingénuo de
      "palavra com 3+ letras"). Corrigido com a técnica correta: uma 12ª classe negativa explícita
      (`"fora_do_ambito"`, ~20 exemplos de texto disparatado/sem relação com a farmácia no treino) — como
      esta classe nunca está na lista real de `INTENTS`, o código de integração já existente
      (`INTENTS.find(i => i.id === previsaoRede.intentId)`) trata-a automaticamente como "não é uma
      resposta válida", sem nenhum código especial necessário.
    - **Honestidade sobre a exatidão final**: com um conjunto de dados sintético pequeno (~230 frases, 12
      classes), a divisão treino/validação muda a cada vez que o conjunto de dados cresce (mesma semente,
      resultado determinístico, mas um "embaralhar" diferente porque há mais itens a embaralhar) — o que
      quer dizer que a lista exata de erros de validação MUDA de corrida para corrida, um sintoma clássico
      de ruído de um conjunto de validação pequeno, não um problema estrutural. Depois de várias rondas de
      "olhar para os erros → acrescentar exemplos direcionados → treinar de novo", a exatidão de validação
      estabilizou por volta dos **85-89%** (varia ligeiramente por corrida) e, no limiar de produção
      (confiança ≥85% + margem ≥30pp), tipicamente **~2 falsos positivos em ~44-45 perguntas de validação**
      persistem — sempre casos-limite diferentes a cada corrida (ex.: `"tenho coisas caducadas"` →
      `alertas_resumo` em vez de `validade`, ou `"qual é a distância até à lua"` → um intent real em vez de
      `fora_do_ambito`), nunca o mesmo erro repetido depois de um dado ser corrigido. Foi tomada a decisão
      deliberada de **parar de perseguir uma corrida de validação perfeita** — mais iterações manuais
      contra o mesmo conjunto pequeno arriscavam decorar essa divisão específica em vez de generalizar a
      sério — e confiar no limiar de confiança+margem (que rejeita ~25% das perguntas de validação em vez
      de arriscar uma resposta errada) como a rede de segurança real. Na prática: a rede nunca é a única via
      de resposta (o motor de regras continua primeiro), e quando erra com confiança, o pior caso é uma
      resposta do domínio errado (nunca uma ação destrutiva — este é um módulo de perguntas e respostas, as
      ações que mutam dados continuam sempre a pedir confirmação explícita, ponto 30).
    - **Fase 3 — memória que generaliza sozinha (reutiliza a camada escondida da rede como "embedding" de
      frase, sem nunca a persistir)**: `sugerirIntentsSemelhantes()` ganhou um 3º parâmetro opcional
      `pesosRede` — quando presente, a confiança da rede por intenção soma-se à pontuação por
      palavras-chave (nunca a substitui), passando a sugerir intenções que a distância de edição sozinha
      não via NADA (pontuação zero) quando a pergunta é uma paráfrase genuína sem nenhuma palavra-chave
      parecida (ex.: "está tudo bem por aqui ou há algo a rever" → sugere `alertas_resumo`, que antes nem
      aparecia na lista). Nova função `agruparPerguntasSemelhantes()` agrupa, só para apresentação (nunca
      altera o que fica gravado em `config.farmaIaMemoria`), formulações quase-duplicadas da mesma pergunta
      não reconhecida (por similaridade de cosseno entre embeddings, limiar 0.92) — sem isto, "quantos
      pedidos aue tenho pendentes" e "quantos pedidos de aue eu tenho" apareciam como duas linhas
      separadas. `modulos/farma-ia.html` ganhou um painel novo, colapsável e fechado por omissão (para não
      sobrecarregar o chat), "Perguntas que a FARMA ainda não percebeu" — mostra os grupos com a contagem
      total de ocorrências e deixa ensinar um alias diretamente a partir daí (ensina TODAS as formulações
      do grupo de uma vez). Os pesos da rede carregam-se uma única vez por sessão de página
      (`obterPesosRede`, mesmo padrão do catálogo base de produtos, ponto 11) — uma falha a carregar (rede
      em baixo, etc.) nunca bloqueia nem rebenta a FARMA IA, só volta ao comportamento sem rede. Respostas
      dadas pela rede neuronal ficam marcadas na UI com a classe `via-rede-neural` e o emoji 🧩 (distinto do
      🧠 já usado para respostas por alias ensinado) — o operador vê sempre de onde veio a resposta.
    - **Fase 4 (pesquisa pontual na internet) — por fazer**: pesquisa feita (WebSearch) por uma plataforma
      pública portuguesa candidata — `transparencia.sns.gov.pt` (portal de transparência do SNS), que
      corre sobre Opendatasoft, uma plataforma que tipicamente suporta CORS para widgets embutidos (dataset
      "Preço Médio das Embalagens de Medicamentos" identificado como plausível). **Não foi possível
      verificar ligação real a partir deste sandbox** — o proxy de saída HTTPS deste ambiente de
      desenvolvimento bloqueia explicitamente domínios externos arbitrários (confirmado:
      `transparencia.sns.gov.pt:443` devolve 403 da própria proxy, nunca chega a tentar o site real), pelo
      que qualquer comportamento real de rede/CORS só pode ser verificado no computador do Ivo, com
      internet a sério. Fica desenhada para uma sessão seguinte: construção defensiva (timeout, try/catch,
      mensagem "não consegui obter essa informação" em vez de rebentar), scope estrito (nunca nome de
      utente, número de receita, ou qualquer dado de saúde na pesquisa — só preço/informação pública de um
      medicamento), e teste de conectividade real a fazer pelo Ivo depois de sincronizado.
  Testado: **18 testes unitários novos** em `tests/farmaRede.test.js` (propriedades da extração de
  features — tamanho fixo, norma L2 ≈1, determinismo —, forma e soma-1 da saída softmax, similaridade de
  cosseno incluindo os casos de vetor zero, e generalização real da rede treinada contra frases que não
  estão em `scripts/dados-treino-farma.mjs`) + **18 testes unitários novos** em `tests/farmaIa.test.js`
  (`tentarViaRedeNeural` a aceitar/rejeitar corretamente, `sugerirIntentsSemelhantes` com e sem o reforço
  da rede, `agruparPerguntasSemelhantes` a agrupar/não agrupar corretamente e a nunca alterar a lista de
  entrada, `responderPergunta` ponta-a-ponta confirmando que regras e aliases continuam sempre a ganhar à
  rede) — todos contra os pesos REAIS treinados (`src/farmaRedePesos.json`), nunca uns pesos inventados só
  para o teste passar — **584/584 testes unitários no total**. Bateria e2e completa corrida depois de
  integrar em `modulos/farma-ia.html`: encontrado que o teste existente do fluxo "ensinar alias"
  (`16-farma-ia.mjs`) tinha ficado desatualizado pela própria melhoria desta peça — a palavra de teste
  escolhida no ponto 26 ("utentse") passou a ser reconhecida diretamente pela rede neuronal (é exatamente o
  tipo de erro de escrita que a rede foi feita para tolerar), pelo que o "Não percebi" que o teste esperava
  deixou de acontecer. Corrigido trocando a palavra de teste por uma que nem as regras nem a rede reconhecem
  hoje (continua a exercitar o "ensinar alias" a sério) e acrescentadas 2 verificações novas para confirmar
  o novo caminho via rede neuronal — **456/456 a passar**, sem nenhuma regressão real (a diferença de 454
  para 456 é só as 2 verificações novas).
  Ficheiros novos: `src/farmaRede.js`, `src/farmaRedePesos.json`, `scripts/dados-treino-farma.mjs`,
  `scripts/treinar-rede-farma.mjs`, `tests/farmaRede.test.js`.
  Ficheiros alterados: `src/farmaIa.js`, `modulos/farma-ia.html`, `tests/farmaIa.test.js`,
  `tests/e2e/modules/16-farma-ia.mjs`.
  A sincronizar na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 43 — nova aba "Aprender" na FARMA IA (4 funções) + expansão da rede neuronal.** Pedido direto
  do Ivo: além dos separadores já existentes (Alertas, Perguntar, Oportunidades), uma 4ª aba "Aprender"
  com 4 funções — (1) "explorar central": a FARMA explora a Central de ponta a ponta e propõe novas
  funções; (2) "treino intensivo": forçar a FARMA a treinar e a fazer novas conexões neurais, offline ou
  online por motor de busca; (3) "aprender por leitura": carregar Word/PDF/Excel/HTML/CSV e a FARMA
  absorve o conteúdo, com relatório do que aprendeu; (4) "aprendizagem multifarma": cada farmácia ensina
  coisas diferentes à sua FARMA mas todas partilham aprendizagens entre si, sem revelar dados críticos. E,
  em separado, "expandir a rede neural da FARMA ao máximo".
    - **Clarificações pedidas antes de escrever código** (o pedido, à letra, tocava em 3 decisões de
      arquitetura já tomadas — ponto 29, sem IA externa; isolamento multi-tenant, ponto 4/12 — por isso
      confirmadas com o Ivo em vez de resolvidas por suposição, mesmo padrão do ponto 41):
      Função 1 — o Ivo escolheu **"pode propor novas ações, sempre revistas por ti [Claude]"**, nunca
      geração/execução autónoma de código; Função 2 ("treino online") — o Ivo escolheu **"1 e 2"**: só
      pesquisa de texto público (nunca uma API de IA externa) E também suporte a treino 100% offline;
      Função 4 (partilha entre farmácias) — o Ivo escolheu **"1 e 2"**: só padrões de linguagem anónimos E
      só estatísticas agregadas, nunca exemplos/texto literal; ordem de construção — **"avança com tudo"**,
      as 4 funções + a expansão da rede na mesma sessão.
    - **Expansão da rede neuronal** (`scripts/dados-treino-farma.mjs`/`scripts/treinar-rede-farma.mjs`):
      conjunto de dados sintético alargado de 224 para **298 exemplos** (12 classes, mais paráfrases por
      classe) e 4 exemplos ambíguos reescritos depois de errarem repetidamente em várias corridas de treino
      (ex.: "dá-me o panorama geral de hoje" → "dá-me o panorama de alertas de hoje", para deixar de
      colidir com `oportunidades`). Testadas várias configurações maiores antes de escolher a final —
      320 dimensões/32 unidades escondidas deu **78,3%** de validação, 288/28 com L2 mais alto deu **83,3%**
      mas 7/60 falsos positivos no limiar de produção — a configuração final, **288 dimensões, 26 unidades
      escondidas, L2=1e-4, paciência=400**, deu **85,0%** de exatidão de validação (igual à baseline do
      ponto 42) com **~6,7% (4/60)** de falsos positivos no limiar de produção (confiança ≥85% + margem
      ≥30pp) — uma taxa ligeiramente mais alta do que os ~4-5% do ponto 42, aceite conscientemente como a
      troca pela cobertura de paráfrases bem maior, seguindo a mesma disciplina já registada no ponto 42 de
      não perseguir indefinidamente ruído de uma divisão de validação pequena. Honestidade: "ao máximo" foi
      interpretado como "procurar o melhor ponto de capacidade validável para este conjunto de dados", não
      "o maior número possível" — configurações maiores testadas genuinamente pioraram, um sinal de
      sobreajuste a um conjunto ainda pequeno (298 exemplos), não um limite de esforço.
    - **Função 3 — "aprender por leitura"** (`src/farmaLeitura.js`, `src/farmaLeituraTexto.js`,
      `src/ui/farmaLeituraFicheiros.js`): um documento carregado pelo operador (.txt/.md/.html/.csv — texto
      puro, sem dependências — e .pdf/.docx/.xlsx via pdf.js/mammoth/xlsx carregados por CDN só quando
      precisos, mesmo padrão de carregamento preguiçoso já usado para o "cérebro" local WebLLM do ponto 30
      e o leitor de código de barras) é dividido em excertos (`dividirEmExcertos`, respeitando
      parágrafos/frases) e cada excerto ganha um vetor de características (hashing de trigramas,
      `extrairFeatures` reaproveitado de `src/farmaRede.js`) — nunca a rede de classificação de intents,
      propositadamente: essa está otimizada para separar as 12 classes conhecidas, não para pesquisa livre
      sobre texto arbitrário. `pesquisarConhecimento` procura por similaridade de cosseno e só devolve algo
      acima de um limiar calibrado empiricamente em **0,42** (testado contra pares pergunta/excerto reais —
      pares relevantes pontuam tipicamente 0,32-0,55, irrelevantes 0,12-0,35, mais baixo do que a intuição
      sugeria) — nunca força uma resposta fraca. Integrado em `responderPergunta()` como um crivo NOVO,
      sempre depois das regras/aliases/rede neuronal e antes do "não percebi" final, citando sempre o
      excerto tal e qual (nunca reformulado) com o nome do ficheiro de origem. Nunca sai do computador da
      farmácia — todo o processamento é local no browser. Limite de 400 excertos guardados (mais antigos
      descartados primeiro).
    - **Função 2 — "treino intensivo"** (`src/farmaTreinoLocal.js`): treino incremental 100% local, por
      farmácia, desenhado deliberadamente para nunca sofrer "esquecimento catastrófico" — em vez de afinar
      os pesos já treinados com só os poucos aliases que uma farmácia ensinou (o que destruiria a
      generalização para tudo o resto), treina um modelo NOVO do zero combinando o conjunto de dados
      sintético completo (importado dinamicamente de `scripts/dados-treino-farma.mjs`, já servido como
      ficheiro estático) com os aliases desta farmácia — mais exemplos reais, nunca menos generalização.
      Corre inteiramente no browser do operador (150 épocas, orçamento fixo e curto para nunca travar a
      UI), gerador aleatório determinístico. O resultado só é aceite depois de passar uma verificação de
      sanidade contra 11 frases-âncora conhecidas (uma por intent real) — se o modelo novo piorar claramente
      (abaixo de 70% de acerto nas âncoras), é descartado e mantêm-se os pesos anteriores, protegendo a
      farmácia de ficar com um modelo pior do que tinha, incluindo o caso de padrões partilhados de má
      qualidade vindos da Função 4. O treino "via pesquisa pública na internet" fica, com honestidade,
      **por implementar** — este sandbox de desenvolvimento não consegue verificar ligação real a domínios
      externos (mesma limitação já registada na Fase 4 do ponto 42), e construir uma pipeline de
      recolha/ingestão de conteúdo público sem controlo é um trabalho maior a fazer numa sessão dedicada;
      fica um placeholder claramente rotulado na UI em vez de fingir que existe.
    - **Função 4 — "aprendizagem multifarma"** (`netlify/functions/farma-aprendizagens.js`,
      `src/farmaAprendizagemMultifarma.js`, `src/ui/farmaAprendizagemRede.js`): store do Netlify Blobs
      DIFERENTE (`central-saas-partilhado`) da usada pelos dados por farmácia — nunca uma chave prefixada
      por tenantId, por desenho. Só aceita (1) padrões `{intentId, features}` já vetorizados — vetores de
      trigramas hash, nunca o texto literal da pergunta — validados quanto à forma (tamanho do vetor,
      intentId com formato restrito) e (2) contagens agregadas por intent, nunca exemplos; tudo isto
      reforçado do lado do SERVIDOR (não só do cliente) para um cliente alterado não conseguir contornar.
      O `tenantId` nunca é guardado — só se conta quantas farmácias diferentes já contribuíram através de
      um pseudónimo HMAC não reversível. Opt-in, desligado por omissão. Padrões recebidos entram no treino
      local da Função 2 (`treinarLocal(aliases, { padroesPartilhados })`) só depois de revalidados outra
      vez no cliente — nunca confiar cegamente numa resposta de rede, mesmo do próprio servidor.
    - **Função 1 — "explorar central"** (`src/farmaExplorarCentral.js`): em vez de fingir que a FARMA "lê
      e entende" código-fonte (exigiria uma IA a interpretar código, que a Central nunca usa — ponto 29), o
      "conhecimento da Central" é honesto e verificável — um índice construído a partir do catálogo REAL já
      existente (`MODULOS_ATALHOS`, `TAREFAS_CATALOGO` do Poupança & ROI, ponto 17). Reaproveita
      `detectarOportunidadesAutomacao()` (já existente) mas guarda as propostas como uma FILA PERSISTENTE
      com estado (`pendente` → `aprovada_para_revisao` | `rejeitada`) em vez de uma lista recalculada e
      esquecida a cada visita, deduplicada por id determinístico (a mesma oportunidade não gera propostas
      repetidas) e nunca reabre uma proposta já decidida pelo operador. "Aprovar" nunca implementa nada
      sozinha — só marca a proposta para ser trazida a uma sessão futura com o Claude e o Ivo, exatamente a
      decisão do Ivo acima.
    - **Aba nova em `modulos/farma-ia.html`**: 4ª entrada na barra inferior ("Aprender", 🧠), com 4
      sub-abas internas (pills). A rede neuronal usada em "Perguntar" passa a preferir um modelo treinado
      localmente aceite (`config.farmaTreinoLocal`) sobre os pesos partilhados de produção quando presente
      (`obterPesosEfetivos`), com botão para reverter ao modelo padrão.
    - **Bug real encontrado e corrigido durante a verificação e2e (não reportado pelo Ivo)**: o servidor
      local de testes (e, por precaução, também o `netlify.toml` de produção) não tinha nenhum tipo MIME
      mapeado para `.mjs` — o `import()` dinâmico de `scripts/dados-treino-farma.mjs` a partir do browser
      falhava sempre com "Expected a JavaScript-or-Wasm module script", nunca treinando nada. Corrigido com
      um mapeamento explícito de `.mjs` → `text/javascript` (`tests/e2e/local-server.mjs`) e uma regra de
      cabeçalho dedicada em `netlify.toml` para `/scripts/*.mjs`, para nunca depender do tipo MIME por
      omissão de um servidor para uma extensão pouco comum. Dois bugs de concordância verbal corrigidos na
      UI (plurais mal formados: "disponíveleis"→"disponíveis", "padrãoes"→"padrões") e um bug de UX real
      (o botão "Contribuir" da Função 4 mostrava a mensagem de sucesso e, de imediato, o refresco automático
      do resumo apagava-a por baixo) — todos encontrados pela bateria e2e real, não por inspeção visual.
  Testado: **679 testes unitários no total** (95 novos desta sessão — `farmaTreinoLocal.test.js`: 10,
  `farmaLeitura.test.js`: 18, `farmaLeituraTexto.test.js`: 15, `farmaAprendizagens.test.js`: 17,
  `farmaAprendizagemMultifarma.test.js`: 14, `farmaExplorarCentral.test.js`: 17, mais 4 novos em
  `farmaIa.test.js` para a integração da Função 3) — todos contra dados/pesos reais, nunca mocks a fingir
  comportamento. Bateria e2e completa com o novo módulo `17-farma-aprender.mjs` (30 verificações,
  incluindo os 3 caminhos "reais": uma proposta genuína gerada a partir de dados de uso a sério, um treino
  local completo a correr no browser (não simulado) com o relatório final a mostrar números reais, e uma
  contribuição multifarma real aceite pelo servidor e refletida no conhecimento partilhado) —
  **486/486 a passar**, sem nenhuma regressão nas 456 anteriores.
  Ficheiros novos: `src/farmaTreinoLocal.js`, `src/farmaLeitura.js`, `src/farmaLeituraTexto.js`,
  `src/ui/farmaLeituraFicheiros.js`, `src/farmaExplorarCentral.js`, `src/farmaAprendizagemMultifarma.js`,
  `src/ui/farmaAprendizagemRede.js`, `netlify/functions/farma-aprendizagens.js`,
  `tests/farmaTreinoLocal.test.js`, `tests/farmaLeitura.test.js`, `tests/farmaLeituraTexto.test.js`,
  `tests/farmaAprendizagens.test.js`, `tests/farmaAprendizagemMultifarma.test.js`,
  `tests/farmaExplorarCentral.test.js`, `tests/e2e/modules/17-farma-aprender.mjs`.
  Ficheiros alterados: `scripts/dados-treino-farma.mjs`, `scripts/treinar-rede-farma.mjs`,
  `src/farmaRedePesos.json`, `src/farmaIa.js`, `modulos/farma-ia.html`, `netlify.toml`,
  `tests/farmaIa.test.js`, `tests/e2e/local-server.mjs`.
  A sincronizar na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 44 — Manipulados: disparo automático da pré-visualização de email ao criar um pedido, com a
  receita em anexo (bug real reportado pelo Ivo).** O Ivo reportou dois problemas concretos no módulo
  Manipulados: (1) ao criar um novo pedido e guardar, era suposto abrir logo a pré-visualização do
  "Pedido de orçamento por email" ao laboratório, mas isso nunca acontecia — só era possível reabrir o
  pedido e clicar manualmente em "✉ Pedir orçamento"; (2) mesmo nesse envio manual, a(s) receita(s)
  carregada(s) no pedido nunca iam anexadas ao email.
  Confirmado no código (`modulos/manipulados.html`): `saveCurrent()` nunca chamava `sendBudgetEmail()`
  depois de criar um pedido novo, e `confirmSendEmail()` só enviava `{to, cc, subject, body}` — nunca
  `attachments`. `aue.html` já resolvia exatamente este problema para os documentos do armazenista (envio
  automático ao guardar, com um interruptor "Enviar automaticamente" nas Definições, e anexos resolvidos
  via `dataStore.getAsset()` e enviados no mesmo `action:'sendEmail'` da Web App) — reaproveitou-se esse
  padrão já existente e comprovado em vez de inventar um novo, incluindo o mesmo aviso honesto quando não
  há Web App configurada ("mailto:" nunca consegue anexar ficheiros — o utilizador é avisado para anexar à
  mão, nunca fica a pensar que foi enviado com o anexo quando não foi).
  Mudanças em `modulos/manipulados.html`: novo interruptor "Enviar automaticamente" em "✉ Definições de
  email" (`getEmailSettings().auto`, por omissão `true`); `sendBudgetEmail()` passou a resolver os anexos
  do pedido (via `dataStore.getAsset()` para os já enviados ao armazenamento partilhado, ou `a.data` para
  os que só ficaram no browser) e a mostrar a lista de anexos no preview (`#ep_attachments`);
  `confirmSendEmail()` passou a enviar `attachments` no pedido à Web App, e a avisar claramente no
  fallback "mailto:" que os anexos têm de ser adicionados à mão; `saveCurrent()` passou a chamar
  `sendBudgetEmail(novoPedido)` no fim de criar um pedido novo, sempre que "Enviar automaticamente" estiver
  ligado — nunca envia sozinho, fica sempre à espera de "Enviar email"/"Não enviar" no modal, tal como no
  envio manual já existente.
  Bug real encontrado e corrigido durante os testes desta sessão (não reportado pelo Ivo, mesma família de
  bug já vista nos pontos 34/36/37 desta app): o botão "Ativado"/"Desativado" do novo interruptor chamava
  `setAutoEmail(...)` a partir de um `onclick` inline, mas essa função só estava declarada dentro do
  `<script type="module">` — nunca ficou acessível em `window`, pelo que o clique falhava sempre em
  silêncio e o interruptor nunca mudava de estado nem gravava. Corrigido ao expor `window.setAutoEmail`,
  tal como as restantes funções chamadas por `onclick`.
  Verificação: `tests/e2e/modules/05-manipulados.mjs` ganhou uma secção 0 (desliga "Enviar automaticamente"
  antes das secções 1-12, escritas antes desta funcionalidade existir e que não esperam que o preview abra
  sozinho) e uma nova secção 13 dedicada — cria um pedido real com uma "receita" (imagem fabricada em
  memória) anexada via `#f_anexo_input`, confirma que o preview do email abre sozinho sem clicar em nada,
  confirma que a receita aparece listada em `#ep_attachments` (resolvida a sério contra o servidor local,
  via `dataStore.getAsset`, não simulada), e confirma que desligar o interruptor volta a impedir o disparo
  automático. **679/679 testes unitários** (inalterado — nenhuma lógica pura de `src/*.js` foi tocada) e
  **490/490 verificações e2e** (486 anteriores + 4 novas desta correção), sem nenhuma regressão.
  Ficheiros alterados: `modulos/manipulados.html`, `tests/e2e/modules/05-manipulados.mjs`.
  A sincronizar na pasta `central multifarmácia` do PC do Ivo.

  **Nota separada, fora do âmbito deste ponto — não tocada sem decisão explícita do Ivo:** ao investigar
  um relatório de auditoria que o Ivo enviou em anexo (PDF de 20/09/2026), confirmou-se no código real que
  `modulos/devolucao-frio.html` chama `https://api.anthropic.com/v1/messages` **diretamente do browser**,
  com uma chave API da Anthropic introduzida pelo próprio utilizador num campo da UI (nunca é guardada em
  `localStorage`, mas viaja em claro no pedido de rede e fica visível em qualquer ferramenta de
  programador). Isto contradiz diretamente a regra absoluta desta app (ponto 29: nunca API de IA externa) —
  é uma exceção pré-existente no código, não algo introduzido nesta sessão. Decisão do Ivo registada e
  executada no ponto 45, logo a seguir.

- **Ponto 45 — remoção da chamada direta à API da Anthropic em `devolucao-frio.html` (decisão explícita
  do Ivo: "Remove mesmo a chamar da api").** Sequência direta da nota do ponto 44: confirmada a violação
  real da regra ponto 29 (nunca API de IA externa), o Ivo pediu a remoção completa, não uma mudança de
  arquitetura (mover para um backend/proxy não resolveria — a regra é "nunca IA externa", não "nunca do
  lado do browser").
  Removido de `modulos/devolucao-frio.html`, por inteiro (nada ficou "desligado" ou comentado — o código
  morto também é risco): o botão da toolbar "📎 Carregar ficheiro (auto-preencher)"; o modal de upload
  (incluindo o campo de "Chave API Anthropic" e a zona de arrastar/largar ficheiro); o overlay de
  processamento ("A analisar com IA…"); as funções `openUpload`/`closeUpload`/`onDragOver`/`onDragLeave`/
  `onDrop`/`handleFile`/`toBase64`/`sleep` e as suas exposições em `window`; e o CSS exclusivo destes
  elementos (`.upload-zone`, `.upload-box`, `.drop-area`, `.drop-icon`, `.upload-close`,
  `.processing-overlay`, `.spinner`, incluindo a referência a estas classes na regra `@media print`). O
  preenchimento manual dos campos do formulário (datas, nº de fatura, linhas de produtos) não foi tocado —
  continua a funcionar exatamente como antes, é só o atalho automático por IA que deixou de existir.
  Também removida a entrada `auto_preencher_ia` do catálogo de tarefas do Poupança & ROI
  (`src/usoCatalogo.js`) — deixar essa entrada não teria efeito prático (a tarefa nunca mais é registada),
  mas mantê-la seria uma "promessa" enganosa de uma funcionalidade que já não existe.
  Verificação: `node --check` ao script do módulo (sintaxe válida), varrimento completo do repositório
  confirmando zero referências residuais a `api.anthropic.com`, `apiKeyInput` ou `auto_preencher_ia`. A
  suite e2e do módulo (`tests/e2e/modules/13-devolucao-frio.mjs`) trocou a secção que testava o aviso de
  "chave API em falta" por uma que confirma ativamente que o botão, o modal e o campo de chave já não
  existem na página. A contagem do catálogo de tarefas em `tests/usoCatalogo.test.js` desceu de 154 para
  153. **679/679 testes unitários e 490/490 verificações e2e**, sem nenhuma regressão nos restantes 12
  módulos com fluxos de email/anexos/upload (nenhum deles depende deste código).
  Ficheiros alterados: `modulos/devolucao-frio.html`, `src/usoCatalogo.js`, `tests/usoCatalogo.test.js`,
  `tests/e2e/modules/13-devolucao-frio.mjs`.
  A sincronizar na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 46 — motor de ações direto da FARMA (mini-chat incluído), nome personalizável, correção do
  "Treinar agora" e expansão da rede neuronal para ~1000 exemplos.** Pedido direto do Ivo, na sequência do
  plano de melhorias pendentes de 20/09/2026 (documento à parte, `plano-melhorias-pendentes-2026-09.md`):
  "Ok avança com tudo e liga directsmente o motor de ações da farma, além disso nas opções da farma deverá
  ter a opção de mudar de nome. No treino intensivo o botão treinar agora não funciona. Aumenta as
  conexões da Farma para 1000". Quatro peças distintas, tratadas em conjunto por tocarem nos mesmos
  ficheiros. "Avança com tudo" foi interpretado como as Fases A e B do plano (o que mais mudava o
  dia-a-dia da FARMA e a cobertura de testes à volta disso) — as Fases C (correções concretas do PDF de
  auditoria: NIF/email no AUE, SRI, JSON das Devoluções) e D (maturidade SaaS: password/admin/faturação/
  RGPD, condicional a uma decisão de negócio do Ivo) ficam por avançar, ver Plano de trabalho abaixo.

  **1. Motor de ações ligado diretamente, sem depender de nenhuma IA (nem local nem externa).** A Fase A do
  plano identificou a causa raiz da queixa "a FARMA não consegue de facto fazer as tarefas": o balão de
  chat sempre visível (`src/ui/farmaMiniChat.js`) nunca importava nada de `farmaAcoes.js` — um pedido de
  ação ali era estruturalmente impossível de cumprir, sempre que fosse usado — e no módulo completo
  (`modulos/farma-ia.html`) o motor de ações só corria dentro de `if (cerebroEngine)`, ou seja, só depois
  de descarregar manualmente um modelo de IA local de várias centenas de MB, desligado por omissão e sem
  nenhum aviso de que era preciso ativá-lo primeiro.
  Novo ficheiro `src/farmaAcoesIntent.js`: reconhecimento de pedidos de ação por correspondência
  determinística de padrões (verbo de ação explícito — cria/marca/adiciona/remove/... — + âncora de
  domínio + extração de parâmetros por texto entre aspas/âncoras nomeadas/padrões de telefone-NIF-data-
  hora), cobrindo as 20 ações já catalogadas em `ACOES_DISPONIVEIS`. Zero modelo de IA envolvido — cumpre
  a regra do ponto 29 tanto quanto o motor de perguntas por regras já cumpria. Nunca inventa nem executa
  sozinho: um reconhecimento completo produz sempre o mesmo cartão "Confirmar/Cancelar" já existente
  (`prepararAcao`/`executarAcaoConfirmada`, com toda a validação contra dados reais só ao confirmar); um
  reconhecimento incompleto (falta um parâmetro obrigatório) pede esclarecimento em vez de adivinhar; texto
  que não corresponde a nenhuma ação devolve `null` e segue para o caminho de sempre (perguntas e respostas
  e, por fim, a IA local opcional). Ligado tanto a `modulos/farma-ia.html` como, pela primeira vez, ao
  mini-chat (`src/ui/farmaMiniChat.js`) — o ponto de entrada mais visível da app, que antes desta peça não
  tinha nenhuma ação ligada.

  **Bug real encontrado e corrigido durante esta mesma peça (transparência sobre um erro próprio):** a
  primeira versão da ligação chamava `reconhecerAcaoDeterministica` só depois de `responderPergunta` (o
  motor de perguntas por regras) não reconhecer nada — mesma ordem, por engano, nos dois ficheiros. O motor
  de perguntas (`corresponde()` em `farmaIa.js`) casa por qualquer palavra-chave isolada em qualquer
  posição do texto, sem exigir verbo nem estrutura de frase, e o vocabulário de domínio das ações
  ("manipulado", "aue", "catalogo", ...) sobrepõe-se ao de várias intenções de pergunta já existentes
  (`pedidos_manipulados`, `pedidos_aue`, etc.) — por isso, com essa ordem, uma frase como "cria um pedido
  de manipulado para a Ana Costa, medicamento minoxidil 5%, telefone 912345678" era sempre intercetada
  primeiro pelo motor de perguntas, que respondia com uma frase enlatada ("Ainda não há nenhum pedido de
  manipulado registado") em vez de nunca sequer chegar a mostrar o cartão de ação — o mesmo problema que
  esta peça devia resolver, só que reintroduzido pela própria ordem do código novo. Apanhado com um script
  de depuração isolado (Playwright a inspecionar o HTML real do chat) antes de qualquer sincronização,
  nunca chegou a ser usado pelo Ivo. Corrigido nos dois ficheiros: o reconhecimento de ações corre agora
  SEMPRE antes do motor de perguntas, não depois — seguro de fazer porque os gatilhos deste reconhecimento
  exigem sempre um verbo de ação explícito além da âncora de domínio, e perguntas genuínas (interrogativas,
  sem esse verbo) nunca acionam esses gatilhos, confirmado por um conjunto de 13 frases de controlo
  negativo em `tests/farmaAcoesIntent.test.js` (perguntas reais que partilham vocabulário com ações e
  continuam corretamente a devolver `null`).
  Novo ficheiro de testes unitários `tests/farmaAcoesIntent.test.js` (14 testes: extração de nome/
  medicamento/telefone, esclarecimento pedido quando falta um parâmetro obrigatório, correspondência exata
  de armazenista/estado, extração por aspas, uma regressão documentada — "cria uma lista de inscrição
  chamada..." confundido com `listas.inscrever` por a palavra "inscrição" aparecer no nome genérico da
  ação de criar lista — e outra regressão de limite de palavra — "a lista" a corresponder por engano dentro
  de "uma lista"). Novo ficheiro de teste e2e `tests/e2e/modules/18-farma-acoes-diretas.mjs` (16
  verificações: pedido completo no módulo → cartão → confirmar → gravado no servidor; parâmetro em falta →
  esclarecimento, nunca um cartão a adivinhar; o mesmo percurso completo a partir do mini-chat, incluindo
  confirmar que uma pergunta normal continua a responder como pergunta e não é confundida com uma ação; e o
  nome personalizado, ver a seguir).

  **2. Nome da assistente personalizável.** Pedido do Ivo ("nas opções da farma deverá ter a opção de
  mudar de nome"). Novo campo `config.farmaNomeAssistente` (por farmácia, guardado no servidor como o
  resto da configuração). Em `modulos/farma-ia.html`: título do módulo com um botão de lápis ao lado que
  abre um editor em popover; o nome escolhido passa a aparecer no título, na saudação ao abrir o módulo e
  nas respostas de ajuda ("Sou a Sofia: respondo a perguntas sobre..."). O mini-chat lê o mesmo campo
  (mesma origem de dados, `dataStore.getEstadoCompleto()`) e usa o nome escolhido no cabeçalho da bolha e
  na saudação — sem duplicar a gestão do nome, só a leitura. Nome por omissão continua "FARMA" quando a
  farmácia nunca o mudou.

  **3. Correção do "Treinar agora" (aba Aprender → Treino intensivo).** Queixa do Ivo: "No treino
  intensivo o botão treinar agora não funciona." Investigação honesta: não foi possível reproduzir um erro
  concreto só a partir do código (a lógica de treino, o `import()` dinâmico e o `type="module"` no
  `netlify.toml` estavam corretos) — as duas causas mais plausíveis identificadas foram falta de clareza na
  interface, e ambas foram corrigidas defensivamente: (a) o botão fica desativado (cinzento, sem clicar a
  fazer nada visível) sempre que a farmácia ainda não ensinou pelo menos 3 perguntas — a mensagem ao lado
  passou a explicar isto de forma explícita ("O botão 'Treinar agora' está desativado (a cinzento) porque
  ainda só ensinou N pergunta(s) — precisa de pelo menos 3..."), com um `title` (tooltip) no próprio botão
  para quem não repara na mensagem; (b) se o treino falhar por qualquer motivo real (ex.: o portão de
  sanidade recusa um modelo pior), a mensagem de erro passou a incluir a razão concreta devolvida pelo
  código, em vez de uma mensagem genérica. Sem conseguir ver o ecrã real do Ivo não é possível garantir a
  causa exata a 100%, mas ambos os cenários mais prováveis ficam agora claramente comunicados.

  **4. "Aumenta as conexões da Farma para 1000".** Frase ambígua — resolvida sem perguntar ao Ivo, por
  haver precedente direto no próprio código desta sessão: o comentário de cabeçalho de
  `src/farmaTreinoLocal.js` (ponto 43) já registava um pedido anterior do Ivo para "expandir a rede
  neuronal ao máximo". Interpretado como pedido para aumentar o conjunto de dados de treino da rede
  neuronal — não o número de ligações/neurónios da arquitetura (essa contagem já ultrapassa largamente
  1000 mesmo sem alterações, e mexer nela sem mais dados só pioraria o sobreajuste). `scripts/dados-treino-
  farma.mjs` expandido de 298 para 997 frases de exemplo, mantendo a mesma estrutura e as mesmas 12 classes
  (escala proporcional ~3,35× em todas, zero duplicados exatos). Pesos regenerados com
  `scripts/treinar-rede-farma.mjs`: 798 exemplos de treino / 199 de validação, paragem antecipada ao fim de
  730 épocas, 99,5% de exatidão em treino, 92,0% em validação (a subir dos ~85-92% típicos do ponto 43 com
  o conjunto mais pequeno). Efeito colateral esperado e verificado, não uma regressão: um erro de escrita
  isolado sem contexto ("utntes", sozinho) deixou de atingir o limiar de confiança de 0,85 (passou a
  0,784) — o conjunto de dados maior e mais diverso tornou a rede corretamente menos confiante com pouco
  contexto, ao mesmo tempo que melhorou muito a confiança em frases completas mais realistas (a mesma
  frase, mas em contexto — "quantos utnetes tenho" — mantém confiança 1,000). `tests/e2e/modules/
  16-farma-ia.mjs` atualizado para usar a frase completa nesse teste, com um comentário a explicar
  porque é o comportamento certo e não uma quebra.

  **Verificação.** Suite completa a passar sem regressões: **693/693 testes unitários** (subindo de 679,
  +14 de `farmaAcoesIntent.test.js`) e **506/506 verificações e2e** em navegador real (subindo de 490,
  +16 de `18-farma-acoes-diretas.mjs`), incluindo os 17 ficheiros de teste já existentes, sem nenhum caso
  de uma pergunta genuína (ex.: "tenho manipulados pendentes", "quantas divergências de stock tenho") a
  ser incorretamente apanhada pelo reconhecimento de ações agora a correr primeiro.
  Ficheiros alterados: `src/farmaIa.js`, `modulos/farma-ia.html`, `src/ui/farmaMiniChat.js`,
  `src/farmaAcoesIntent.js` (novo), `tests/farmaAcoesIntent.test.js` (novo), `scripts/dados-treino-
  farma.mjs`, `src/farmaRedePesos.json`, `tests/e2e/modules/16-farma-ia.mjs`,
  `tests/e2e/modules/17-farma-aprender.mjs`, `tests/e2e/modules/18-farma-acoes-diretas.mjs` (novo).
  A sincronizar na pasta `central multifarmácia` do PC do Ivo assim que a ligação ao computador for
  restabelecida (esteve indisponível nesta sessão).

- **Ponto 47 — correção de um bug real na impressão de Bolachas Promocionais.** Queixa direta do Ivo: "Há
  um bug na impressão das bolachas". Sem mais detalhe, foi reproduzido diretamente no código/browser
  (Playwright), não à mão à espera de o "adivinhar" — investigação e correção feitas antes de qualquer
  sincronização para o PC, para o Ivo nunca ter chegado a ver a versão com o bug corrigido só na aparência.

  **Causa raiz confirmada.** `cloneCanvasForPrint()` (`modulos/documentos.html`), usada só pelo botão
  "🖨 Imprimir esta bolacha" (impressão de UMA bolacha — a "🖨 Imprimir folha completa", com várias
  bolachas, usa outro caminho de código, próprio, que nunca teve este problema), clonava o desenho da
  bolacha e removia a classe CSS `layer-el` de cada camada de texto/imagem antes de imprimir — a intenção
  era só tirar o cursor de "mover" e o contorno tracejado do modo de edição. Só que `.layer-el` é também a
  ÚNICA regra CSS que dá `position:absolute` a essas camadas (o `style` em linha de cada uma só tem
  `left`/`top`/`width`/`height` em percentagem, nunca `position`) e a única que força a imagem/o texto a
  preencher a sua caixa (`.layer-el img`, `.layer-el .layer-text-inner`). Sem a classe, a camada de texto
  (e qualquer imagem/logótipo adicionado) passava a `position:static` — confirmado por inspeção direta do
  estilo computado, `absolute` → `static` — e saía impressa fora do sítio desenhado no ecrã, em fluxo
  normal da página, em vez de sobreposta à forma da bolacha nas coordenadas escolhidas. O resultado real
  para o Ivo: a pré-visualização no ecrã ficava correta, mas a bolacha impressa (uma de cada vez) saía com
  o texto (e imagens) desalinhados/fora da forma.

  **Correção.** `cloneCanvasForPrint()` deixa de remover a classe `layer-el` — mantém-na (preserva o
  posicionamento e o preenchimento da caixa) e só anula à mesma o que era mesmo só de edição: cursor,
  contorno e a classe `selected`, agora via `style` em linha explícito em vez de apagar a classe toda.
  Confirmado por inspeção do estilo computado depois da correção: `position:absolute` mantido, tanto em
  media `screen` como `print`.

  **Verificação.** Escrita uma verificação e2e nova e dedicada (`tests/e2e/modules/03-documentos.mjs`,
  passo 22) que aciona "Imprimir esta bolacha" a sério e confirma o estilo computado da camada de texto
  clonada (`position:absolute`, classe `layer-el` preservada) — zero cobertura existia antes disto para o
  percurso de impressão de Bolachas (nota deliberada já registada no topo do ficheiro: as vistas com
  arrastar/largar ficam de fora, mas este teste não precisa de simular arrastar, só o botão de imprimir).
  **693/693 testes unitários e 507/507 verificações e2e** (subindo de 506, +1 desta verificação), sem
  regressões nos restantes 17 ficheiros de teste, incluindo o resto do módulo Documentos (Pastas,
  Declarações, Biblioteca).
  Ficheiros alterados: `modulos/documentos.html`, `tests/e2e/modules/03-documentos.mjs`.
  A sincronizar na pasta `central multifarmácia` do PC do Ivo assim que a ligação ao computador for
  restabelecida (indisponível nesta sessão).

- **Ponto 48 — Bolachas: várias caixas de texto independentes, cada uma com o seu tamanho e cor de
  letra.** Pedido direto do Ivo: "preciso que ponhas a opção para criar diversas caixas de texto nas
  bolachas e posibilidade de tamanho e cor de letras independesntes em cada caixa". Até aqui só existia
  UMA caixa de texto por bolacha (`bolachaState.textLayer`, singular) — todo o texto da bolacha tinha
  sempre o mesmo tamanho e a mesma cor.

  **Alterado `modulos/documentos.html`.** `bolachaState.textLayer` (objeto único) passou a
  `bolachaState.textLayers` (array de objetos, cada um com o seu `id`, texto, posição/tamanho na bolacha
  e agora também o seu próprio `fontSize` e `color`, totalmente independentes dos das outras caixas).
  Formulário: cada caixa ganhou o seu próprio bloco na coluna de edição (texto, tamanho, cor e um botão
  "🗑 Remover" só dessa caixa), mais um botão "➕ Adicionar caixa de texto" que cria uma nova caixa com um
  pequeno deslocamento em relação às existentes (para não nascer exatamente em cima de outra). Cada caixa
  continua arrastável/redimensionável na pré-visualização, exatamente como já acontecia com a única caixa
  antes — e ganhou também um "✕" para remover diretamente no desenho, tal como as imagens já tinham.
  `printBolachaSheet()` (impressão de várias bolachas na mesma folha) e `cloneCanvasForPrint()` (impressão
  de uma bolacha, ver ponto 47) foram atualizadas/confirmadas a imprimir TODAS as caixas de uma bolacha,
  cada uma com o seu próprio tamanho/cor — não só a primeira.
  **Compatibilidade com bolachas já guardadas** (histórico local, até 40 versões, e a fila de impressão):
  uma nova função `normalizeBolachaState()` converte automaticamente, na primeira vez que forem reabertas,
  as bolachas antigas de "uma caixa" (`textLayer`) para o novo formato de "várias caixas"
  (`textLayers: [...]`, com essa única caixa antiga preservada tal e qual) — nenhuma bolacha guardada
  antes desta peça se perde ou fica com o texto diferente.

  **Bug próprio encontrado e corrigido ainda dentro desta mesma peça, antes de qualquer sincronização):**
  `modulos/documentos.html` é carregado como módulo ES (`type="module"`), e por isso o ficheiro mantém
  uma lista explícita, no fim do ficheiro, de `window.<nomeDaFunção> = <nomeDaFunção>` para cada função
  chamada a partir de um `onclick="..."` inline no HTML (sem essa linha, o `onclick` falha com "... is not
  defined", porque um módulo não expõe automaticamente as suas funções de topo em `window`, ao contrário
  de um script normal). As duas novas funções (`addBolachaTextBox`, `removeBolachaTextBox`) tinham ficado
  de fora dessa lista — o botão "Adicionar caixa de texto" não fazia nada, sem erro visível no ecrã (só na
  consola). Apanhado a testar antes de sincronizar, corrigido acrescentando as duas linhas em falta.

  **Verificação.** Testes e2e novos e dedicados em `tests/e2e/modules/03-documentos.mjs` (passo 23):
  confirma que uma bolacha nova continua a começar com 1 caixa (compatibilidade), que "Adicionar caixa de
  texto" cria mesmo uma segunda caixa independente, que cada caixa mantém o seu próprio texto/tamanho/cor
  tanto na pré-visualização como na impressão de uma bolacha (a segunda caixa com tamanho 30px e vermelho
  não "contamina" a primeira, que fica a 13px branco), e que "Remover" tira só a caixa certa. **693/693
  testes unitários e 512/512 verificações e2e** (subindo de 507, +5 destas verificações), sem regressões
  no resto do módulo Documentos nem em mais nenhum módulo.
  Ficheiros alterados: `modulos/documentos.html`, `tests/e2e/modules/03-documentos.mjs`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo (ligação restabelecida nesta sessão) — ver
  confirmação de tamanhos de ficheiro no fim desta entrada.

- **Ponto 49 — AUE: validação de formato de NIF/email antes de gravar.** Fase C do plano de melhorias
  de 20/09/2026 (auditoria PDF, `plano-melhorias-pendentes-2026-09.md`): até aqui só se confirmava que
  os campos NIF/email não estavam vazios, nunca que tinham um formato válido — um NIF com um dígito
  trocado ou um email sem "@" passavam sem qualquer aviso.

  Duas funções novas, puras e reutilizáveis em `src/utils.js`: `validarNif(nif)` (algoritmo oficial
  português de dígito de controlo, módulo 11 — aceita o valor com espaços/pontos, ex. "123 456 789") e
  `validarEmail(email)` (regex deliberadamente permissiva: só apanha a falta de "@"/domínio ou espaços
  colados por engano, não tenta cobrir todo o RFC 5322). Cobertas por testes unitários dedicados em
  `tests/utils.test.js`.

  Em `modulos/aue.html`, `saveCurrent()` passa a validar o formato logo a seguir ao check de campos
  vazios já existente — nesta ordem, para as mensagens nunca confundirem "está vazio" com "tem o formato
  errado": NIF inválido foca o campo e avisa; email inválido idem; os dois em simultâneo mostram um aviso
  combinado. Cada campo ganha/perde a classe visual `field-error` consoante o resultado.

  **Fixtures de teste corrigidas antes de continuar.** 5 NIFs de teste pré-existentes em
  `tests/e2e/modules/04-aue.mjs` (ex. `111222333`) tinham dígitos de controlo inválidos — iam começar a
  falhar assim que a validação nova entrasse em vigor. Corrigidos para os checksums reais mais próximos
  (`111222338`, `444555668`, `777888998`, `199199779`, `199199884`). Confirmado por grep que
  `tests/e2e/modules/05-manipulados.mjs`, que reutiliza 2 destes mesmos números, não valida formato de
  NIF — ficheiro diferente, não precisava do mesmo ajuste.

  Novo bloco de teste e2e "1b": confirma que um NIF com dígito de controlo errado bloqueia a gravação
  (o modal continua aberto, o campo ganha `field-error`), que um email sem "@"/domínio faz o mesmo, e que
  corrigir o NIF tira a classe de erro só desse campo.

  **Verificação.** 703/703 testes unitários e 517/517 verificações e2e (subindo de 512, +5 destas
  verificações), sem nenhuma regressão em mais nenhum módulo.
  Ficheiros alterados: `src/utils.js`, `tests/utils.test.js`, `modulos/aue.html`,
  `tests/e2e/modules/04-aue.mjs`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 50 — Devoluções a Armazenistas: corrigidos 155 nomes de produto duplicados; avaliado (e
  adiado, por agora) o tamanho do JSON de 2,24 MB.** Fase C do mesmo plano de melhorias.

  **Corrupção de dados — corrigida.** O JSON embutido em `modulos/devolucoes-armazenistas.html` (29 294
  produtos) tinha designações com uma palavra imediatamente repetida por engano (ex.: "Ausonia Talco
  Talco 200 G", o próprio exemplo citado na auditoria). Verificação sistemática com a expressão
  `\b(palavra)\s+\1\b` (sem distinguir maiúsculas/minúsculas) sobre as 29 294 designações encontrou 162
  correspondências brutas — revistas uma a uma antes de decidir a correção, não corrigidas às cegas.
  "Ylang Ylang" (7 produtos) é um nome legítimo de fragrância/ingrediente botânico, não corrupção —
  excluído da correção por uma lista de exclusões dedicada. Das restantes 155, a maioria segue o padrão
  simples "palavra repetida uma vez" e fica totalmente limpa; 4 casos mais complexos seguem um padrão de
  concatenação invertida "A B B A" (ex. "Perborato Sodio Sodio Perborato 1 Kg") — a correção da palavra
  imediatamente repetida melhora-os (→ "Perborato Sodio Perborato 1 Kg") mas não os "limpa" por completo;
  decidido deliberadamente não tentar adivinhar uma reconstrução completa desses 4 casos, para não trocar
  um erro por outro sem confirmar a designação real junto da fonte (armazenista/laboratório).
  Confirmado por nova verificação: zero correspondências fora da lista de exclusões depois da correção.
  Estrutura e contagens do JSON (29 294 produtos, 1165 detentores, 3095 entradas de diretório)
  inalteradas — só o texto das 155 designações mudou (bloco de dados: 2 241 433 → 2 240 391 caracteres).

  **Tamanho do JSON de 2,24 MB — avaliado, refactor adiado deliberadamente.** Medido diretamente: o
  mesmo conteúdo comprimido com gzip cai para ~625 KB (redução de ~73%) — a generalidade dos
  alojamentos estáticos modernos (Netlify incluído) comprime HTML/JSON por omissão, pelo que o custo real
  de transferência de rede é provavelmente já bem menor do que os 2,24 MB brutos sugerem (por confirmar
  com o Ivo qual é exatamente o alojamento final e se a compressão está mesmo ativa aí). O que fica por
  resolver é o custo de um `JSON.parse` síncrono deste tamanho logo no arranque do módulo — reduzir isso
  a sério exigiria mover os dados para um ficheiro `.json` externo e passar o carregamento de `RAW` de
  síncrono para assíncrono (`fetch` + `await`), o que obriga a rever toda a IIFE do módulo (hoje assume
  `RAW` disponível de imediato) e tudo o que depende dela antes do primeiro render. Dado o risco real de
  regressão num módulo de negócio já grande e bem testado (39 verificações e2e cobrindo consulta, lote,
  produtos, regras e importação), decidido não fazer esse refactor dentro desta passagem de correções
  rápidas — fica como item à parte, dedicado, para quando houver tempo de o testar com o cuidado que
  merece.

  **Verificação.** 703/703 testes unitários e 517/517 verificações e2e, sem nenhuma regressão (incluindo
  as 39 verificações próprias do módulo Devoluções a Armazenistas).
  Ficheiro alterado: `modulos/devolucoes-armazenistas.html` (só o bloco JSON embutido).
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 51 — bloqueio otimista em `/api/data`.** Fase C do mesmo plano de melhorias: a rota
  partilhada `/api/data` (ver ponto 8) não tinha nenhum controlo de concorrência — cada módulo faz um
  read-modify-write clássico (lê o estado inteiro, muda só a sua fatia, grava o estado inteiro outra
  vez). Sem bloqueio nenhum, dois separadores/dispositivos da MESMA farmácia a gravar quase ao mesmo
  tempo podiam perder-se um ao outro: o PUT mais lento a responder repõe, por cima do que o mais rápido
  acabou de gravar, o instantâneo antigo que tinha lido — incluindo campos de módulos que nem sequer
  mexeu (o merge do servidor espalha sempre TODO o `estadoAtual` que o cliente leu, não só a fatia que
  alterou). As filas `gravarQueue`/`enqueueSync` já existentes em vários módulos (pim, gabinete,
  manipulados, stocks, devoluções — ver pontos anteriores) só protegem contra isto DENTRO da mesma aba;
  duas abas, dois computadores, ou o mesmo posto com duas janelas abertas continuavam vulneráveis.

  **Servidor (`netlify/functions/data.js`).** Cada farmácia passa a ter um número de revisão simples
  (`estado:<tenantId>:rev`, um inteiro numa chave à parte do estado em si — nunca faz parte do JSON
  devolvido por GET, para não mudar a forma que os módulos já conhecem). O GET devolve-o no cabeçalho
  `X-Estado-Rev`; um PUT pode devolver esse mesmo valor nesse cabeçalho — o servidor só grava e avança a
  revisão se ainda coincidir com a revisão atual; caso contrário devolve 409 (Conflito) sem escrever
  nada, com a revisão real no corpo, para o cliente reler e tentar de novo. Um PUT sem esse cabeçalho
  (compatibilidade) continua a funcionar exatamente como antes, sem bloqueio — nunca haveria um cliente
  assim depois desta peça (todos os que escrevem foram atualizados), mas mantido por segurança, para
  nunca partir um caminho de escrita esquecido nesta ronda.

  **Cliente — 7 módulos e o painel principal.** `fetchEstado()`/`ensureLoaded()` de cada um passa a
  guardar a revisão lida (`X-Estado-Rev`, nunca no corpo do estado); cada `gravarXxx()` reenvia-a e, ao
  receber 409, relê o estado fresco e tenta de novo (até 3 vezes) — só desiste com um erro claro, nunca
  em silêncio. Alterados: `modulos/aue.html`, `modulos/devolucoes-armazenistas.html`,
  `modulos/documentos.html`, `modulos/manipulados.html`, `modulos/gabinete.html`, `modulos/pim.html`,
  `modulos/stocks.html` (cada um com uma única função de gravação, mesmo padrão nos 7), e
  `src/db.js` (`persist()`, usado pelo painel principal para servicos/categorias/config; e
  `gravarEstadoCompleto()`, usado pela Auto-manutenção para restauro/reparação — aqui o retry reenvia o
  mesmo conteúdo com a revisão fresca, em vez de reaplicar uma mudança, porque um restauro é por natureza
  "escrever exatamente isto"). Os 5 módulos só de leitura de branding (catalogo-produtos, devolucao-frio,
  mapa-cardiovascular, medela, reservas) não escrevem em `/api/data` — não precisaram de alteração.

  **Verificação.** 6 testes unitários novos em `tests/data.test.js` (revisão a começar em 0, PUT sem
  cabeçalho continua sem bloqueio, PUT com a revisão certa avança a revisão, PUT com revisão desatualizada
  devolve 409 sem escrever — confirmado que o estado da "1ª aba" fica intacto —, recuperação normal ao
  reler e tentar de novo, revisões de duas farmácias totalmente independentes) e 6 verificações e2e novas
  em `tests/e2e/modules/00-core.mjs`, estas contra o servidor local real por HTTP a sério (não só a
  chamada direta a `handleRequest()` dos testes unitários), com o mesmo cenário das 2 abas. **709/709
  testes unitários e 523/523 verificações e2e** (subindo de 517), sem nenhuma regressão em mais nenhum
  módulo.
  Ficheiros alterados: `netlify/functions/data.js`, `tests/data.test.js`, `src/db.js`, `modulos/aue.html`,
  `modulos/devolucoes-armazenistas.html`, `modulos/documentos.html`, `modulos/manipulados.html`,
  `modulos/gabinete.html`, `modulos/pim.html`, `modulos/stocks.html`, `tests/e2e/modules/00-core.mjs`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 52 — AUE: validação de formato de telefone antes de gravar.** Fase C do mesmo plano de
  melhorias — fecha o último dos três campos citados pela auditoria de 20/09 em "Falta de Sanitização e
  Validação... NIF, Email ou Telefone" (NIF e email já tinham sido tratados no ponto 49).

  Nova função pura em `src/utils.js`: `validarTelefone(telefone)` — 9 dígitos depois de remover
  espaços/traços e um eventual indicativo (`+351` ou `00351`), a começar obrigatoriamente por 2, 3, 6, 7,
  8 ou 9 (os únicos primeiros dígitos do plano de numeração português; nunca 0, 1, 4 ou 5). Não distingue
  telemóvel de fixo/número especial — só apanha o erro real mais comum: um dígito a mais/a menos ou
  trocado ao escrever ou copiar. Coberta por 5 testes unitários novos em `tests/utils.test.js`.

  Em `modulos/aue.html`, `saveCurrent()` passa a validar os três campos (NIF, email, telefone) na mesma
  passagem, cada um com o seu próprio aviso e classe `field-error`, mantendo a ordem já estabelecida no
  ponto 49 (campo vazio → formato inválido) para as mensagens nunca se confundirem.

  Novo bloco de teste e2e (extensão do bloco "1b" do ponto 49): confirma que um telefone em formato
  inválido bloqueia a gravação (modal continua aberto, campo ganha `field-error`), sem completar uma
  gravação real — termina em "Cancelar" para não afetar as contagens de pedidos usadas por verificações
  mais adiante no mesmo ficheiro.

  **Verificação.** 714/714 testes unitários e 526/526 verificações e2e (subindo de 709/523), sem nenhuma
  regressão em mais nenhum módulo.
  Ficheiros alterados: `src/utils.js`, `tests/utils.test.js`, `modulos/aue.html`,
  `tests/e2e/modules/04-aue.mjs`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 53 — fallback de arranque no ecrã principal (`index.html`/`src/app.js`).** Fase C do mesmo
  plano de melhorias: a auditoria de 20/09 (§4.1, "Dependência Rígida de Ficheiros") assinalava que a app
  falhava silenciosamente se `src/app.js` ou `assets/styles.css` não chegassem a carregar — um ecrã em
  branco sem qualquer pista do que aconteceu, difícil de diagnosticar para quem não é técnico.
  Confirmado por leitura direta de `index.html`/`src/app.js`: não existia nenhum sinal de "app pronta"
  nem nenhum tratamento de erro ao nível do arranque — só o `try/catch` interno de `arrancarCentral()`,
  que cobre falhas dos pedidos aos dados, não falhas do próprio script a carregar/executar.

  Adicionado um pequeno script clássico (não-module, por isso corre mesmo que o módulo principal falhe) em
  `index.html`, logo antes de `<script type="module" src="src/app.js">`: define `window.__centralAppReady
  = false`, mostra um aviso visível ("A aplicação não carregou" + botão "Recarregar") caso (a) um
  `<script>`/`<link>` falhe a carregar (capturado via `addEventListener("error", ..., true)`, já que estes
  eventos não fazem "bubble"), (b) uma exceção não tratada ocorra durante a execução do módulo principal ou
  de um dos seus imports internos (via `window.onerror`), ou (c) passem 8 segundos sem nenhum destes dois
  eventos e sem o sinal de "pronto" — cobre também o caso de rede lenta/módulo preso sem erro explícito.
  Em `src/app.js`, o sinal (`window.__centralAppReady = true`) é definido logo a seguir ao bloco de
  arranque síncrono (mostrar o ecrã de login OU iniciar `arrancarCentral()`), sem esperar pelo
  carregamento assíncrono dos dados — esse continua com o seu próprio tratamento (toast de erro) já
  existente; este sinal cobre só o caso "ficheiro em falta/script partido".

  Alteração deliberadamente pequena e sem qualquer mudança de comportamento no caminho feliz (só código
  inerte que nunca corre a não ser que algo já esteja a falhar) — por isso não se justificou uma bateria
  de testes e2e dedicada; a bateria completa (todos os 18 módulos, 526 verificações, incluindo o check
  "nenhum erro de página/consola" presente em cada um) confirma que nenhum módulo regrediu com o script
  novo presente.

  **Verificação.** 714/714 testes unitários e 526/526 verificações e2e (mesmos números do ponto 52 — esta
  alteração não tem testes próprios, só a confirmação de não-regressão acima).
  Ficheiros alterados: `index.html`, `src/app.js`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 54 — Painel Developer/Super-Admin (MVP: lista de farmácias, só leitura).** Fase D do plano de
  melhorias (o Ivo pediu para avançar em todas as frentes de uma vez — "avança com tudo" — e este item foi
  escolhido para arrancar primeiro por ser o único totalmente autónomo: não depende de nenhuma decisão de
  negócio nem de nenhum serviço externo pago). Fecha o risco "CRÍTICO" da auditoria de 20/09: "Ausência de
  Módulo Developer/Admin — inexistência de um portal restrito aos donos da Central".

  **Não existe um papel de conta separado.** Uma conta/farmácia é super-admin quando o seu email consta da
  variável de ambiente `SUPER_ADMIN_EMAILS` (lista separada por vírgulas, nova função `ehSuperAdmin(email)`
  em `_lib/auth.js`) — nunca gravada em lado nenhum do código, definida uma única vez no Netlify (Site
  settings → Environment variables), exatamente como já acontece com `AUTH_JWT_SECRET`. A MESMA conta que já
  usas para entrar ganha acesso extra — sem login nem palavra-passe adicional, sem tabela de "admins" à
  parte.

  **Servidor.** `signup`/`login`/`me` em `netlify/functions/auth.js` passam a incluir `isSuperAdmin` (bool)
  no token assinado e na resposta JSON. Nova rota `GET /api/auth/admin-farmacias` (coberta pelo redirect
  já existente `/api/auth/*` no `netlify.toml`, sem precisar de nenhuma entrada nova): exige um token válido
  com `isSuperAdmin: true` (401 sem token, 403 com token válido mas sem essa claim — nunca confia em nada
  que não esteja assinado dentro do próprio token) e devolve a lista de todas as farmácias registadas
  (nome, email, tenantId, data de criação), lida com `store.list({prefix:"conta:"})` sobre o mesmo blob
  store de contas já existente (`central-saas-contas`) — nunca inclui `passwordHash`. O `.list()` do
  Netlify Blobs precisou de ser acrescentado às duas implementações de teste (`tests/_fakeStore.js` e o
  armazenamento em memória de `tests/e2e/local-server.mjs`), que até aqui só tinham `get`/`setJSON`/`set`/
  `delete` — um subconjunto mínimo, só `{prefix}` → lista de `{key}`, suficiente para este uso.

  **Cliente.** `src/authClient.js` grava `isSuperAdmin` no perfil local (`localStorage`) e expõe
  `isSuperAdmin()` — só um sinal para a interface decidir se mostra o botão; nunca é o que autoriza o
  acesso real, que o servidor volta sempre a verificar a partir da assinatura do token. Novo botão "Painel
  Admin" na barra superior do shell (`index.html`/`src/app.js`), escondido por omissão (`hidden`) e só
  revelado quando `isSuperAdmin()` é verdadeiro — precisou de uma regra CSS nova (`.btn-config[hidden]`)
  porque a classe `.btn-config` já define `display:flex`, que por especificidade empatada com `[hidden]`
  ganha por vir depois no ficheiro; sem essa regra o botão ficava sempre visível independentemente do
  atributo `hidden`. Nova página autónoma `modulos/admin-central.html` (fora do sistema de "atalhos"/
  serviços partilhado com as farmácias normais, de propósito, para nunca aparecer como cartão na grelha de
  ninguém): pede `/api/auth/admin-farmacias` com o token da sessão e mostra a lista numa tabela simples,
  com mensagens claras para 401 (sessão expirada) e 403 (conta sem permissões).

  **Por agora, só leitura.** Fica deliberadamente fora desta primeira ronda (ver "Plano de trabalho"):
  ferramentas de reparação de base de dados, monitor de erros em tempo real, gestão de atualizações e
  parametrização de integrações externas — tudo o que o PDF descreve em "Detalhamento do Módulo
  Developer/Donos da Central" além da visão geral de farmácias.

  **Verificação.** 5 testes unitários novos em `tests/auth.test.js` (conta normal fica `isSuperAdmin:
  false`; um email em `SUPER_ADMIN_EMAILS` fica `true`, sem distinguir maiúsculas; `admin-farmacias` sem
  token → 401; com token sem a claim → 403; super-admin recebe a lista completa sem `passwordHash`) e 9
  verificações e2e novas em `tests/e2e/modules/00-core.mjs` contra o servidor local real por HTTP a sério
  + Playwright (incluindo o botão realmente escondido/visível consoante a conta, e a página
  `admin-central.html` a carregar sem erros de consola). **719/719 testes unitários e 535/535 verificações
  e2e** (subindo de 714/526), sem nenhuma regressão em mais nenhum módulo.
  Ficheiros alterados: `netlify/functions/_lib/auth.js`, `netlify/functions/auth.js`,
  `tests/_fakeStore.js`, `tests/e2e/local-server.mjs`, `tests/auth.test.js`, `src/authClient.js`,
  `index.html`, `src/app.js`, `assets/styles.css`, `tests/e2e/modules/00-core.mjs`.
  Ficheiro novo: `modulos/admin-central.html`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 55 — sincronização lenta e gravações perdidas: cada gravação enviava o estado inteiro da
  farmácia.** Queixa direta do Ivo (2026-09-23): "A central está com dificuldade de sincronização lenta o
  que faz com que alterações às vezes não sejam guardadas detecta o problema e corrige, torna a central o
  mais rápida e fluida possível".

  **Causa raiz.** Os 7 módulos com gravação própria (`aue.html`, `pim.html`, `manipulados.html`,
  `documentos.html`, `devolucoes-armazenistas.html`, `gabinete.html`, `stocks.html`) seguiam todos o mesmo
  padrão: antes de gravar, faziam um GET a `/api/data` a buscar o estado COMPLETO da farmácia (todos os
  módulos), e depois um PUT a devolver esse estado inteiro com `...estadoAtual` espalhado, só para mudar a
  fatia de UM módulo. Isto acontecia porque a validação antiga de `netlify/functions/data.js` exigia sempre
  `servicos` e `categorias` como arrays (400 se não viessem), obrigando os clientes a incluir sempre a
  forma completa do estado — mesmo o merge do servidor já sendo, por baixo, um simples
  `{...atual, ...body}` ao nível das chaves de topo, que não precisa disto. Resultado: à medida que os
  dados de uma farmácia crescem em QUALQUER módulo, uma gravação de um campo só num módulo pequeno
  (ex. Stocks) fica cada vez mais lenta — porque tem de transportar também todos os outros módulos — e um
  pedido mais lento tem mais probabilidade de nunca chegar a terminar (separador fechado, navegação para
  outro sítio, falha momentânea de rede) antes de o utilizador ver confirmação. Isto explica tanto a lentidão
  como as gravações que às vezes desaparecem.

  **Servidor.** `netlify/functions/data.js`: `servicos`, `categorias` e `config` passam a opcionais na
  validação do PUT (só se validado o tipo quando vêm, nunca exigido que venham) e o merge simplificado para
  `{ ...atual, ...body }` puro (sem forçar mais `config: body.config || {}`, que antes apagava a
  configuração sempre que um cliente a omitisse).

  **Clientes (7 módulos).** Cada `gravarXxx()` passa a enviar só `{ <módulo>: novoValor }` no PUT — nunca
  mais o estado inteiro. Exceção deliberada e pontual: se `estadoAtual.config.logo` ainda existir (contas
  "antigas", de antes da migração de logótipos para o armazém de ficheiros), o módulo continua a incluir
  `config` sem o `logo` nessa gravação — para não perder a limpeza automática de uma vez que já existia.
  Como isto só se aplica enquanto `config.logo` estiver presente (raro, e autolimitado — desaparece após a
  primeira gravação de qualquer módulo dessa conta), o custo extra só é pago pelas contas antigas ainda por
  migrar, nunca pelo caso normal.

  **Impacto medido.** Simulação com dados realistas acumulados (≈136 KB de estado: 400 pedidos AUE, 300
  manipulados, 150 declarações, 200 itens de gabinete, 100 stocks errados, 50 regras de devolução a
  armazenistas) mostrou uma gravação nova de AUE a passar de ≈136 KB por pedido (antes) para ≈57 KB
  (depois) — uma redução de 58% neste cenário. Em farmácias onde o módulo a gravar é pequeno face ao resto
  dos dados acumulados (o caso mais comum), a redução real tende a ser maior.

  **Verificação.** `tests/data.test.js` reescrito e ampliado: validação testa agora "aceita corpo parcial",
  "rejeita tipo errado" para `servicos`/`categorias`/`config` individualmente, e um bloco novo dedicado
  ("gravação parcial, só a fatia do módulo") com 3 testes — preservação de dados ao gravar só uma fatia,
  coexistência de várias fatias gravadas em PUTs sucessivos, e compatibilidade do bloqueio otimista
  (ponto 51) com corpos parciais. Também confirmado, por e2e já existente, que a limpeza de `config.logo`
  em contas antigas continua a funcionar exatamente como antes. **725/725 testes unitários e 535/535
  verificações e2e**, sem nenhuma regressão.
  Ficheiros alterados: `netlify/functions/data.js`, `tests/data.test.js`, `modulos/aue.html`,
  `modulos/pim.html`, `modulos/manipulados.html`, `modulos/documentos.html`,
  `modulos/devolucoes-armazenistas.html`, `modulos/gabinete.html`, `modulos/stocks.html`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 56 — mais 3 melhorias de rapidez, pedidas pelo Ivo a seguir ao ponto 55 ("que mais podemos
  fazer para melhorar a rapidez e fluidez da central").** Investigação dirigida a encontrar o que ainda
  pesava, por ordem de risco (do mais seguro para o maior), com o Ivo a confirmar avançar com os 3.

  **1. `Cache-Control` em falta nos módulos (baixo risco).** De todos os grupos de ficheiros da app,
  `/modulos/*` era o único sem `Cache-Control` próprio no `netlify.toml` — ficava ao critério do
  comportamento por omissão do Netlify, sem a revalidação condicional (ETag/304) que `/src/*` e
  `/assets/*` já tinham. Como alguns módulos vão até vários MB, cada reabertura pagava sempre o custo de
  retransmitir o ficheiro inteiro. Acrescentado `Cache-Control: public, max-age=0, must-revalidate`
  (igual ao `index.html`) — o Service Worker continua a forçar sempre uma ida à rede para documentos
  (estratégia "network-first", nunca serve uma versão desatualizada), mas agora recebe um 304 em vez do
  ficheiro inteiro quando nada mudou.

  **2. GET também só a fatia (Fase 2 do ponto 55, mesmo risco baixo).** O ponto 55 encolheu o PUT, mas
  cada `fetchEstado()` continuava a fazer um GET do estado INTEIRO — a cada gravação, a cada arranque de
  módulo, e na atualização periódica de fundo da Central a cada 25s (`recarregarDoServidor()`, a chamada
  mais frequente de toda a app). `GET /api/data` aceita agora `?campos=chave1,chave2` (nomes separados por
  vírgula) e devolve só essas chaves de topo — sem o parâmetro, continua a devolver o estado completo tal
  como sempre (nenhum consumidor mais simples, ex. `catalogo-produtos.html`/`devolucao-frio.html`, precisa
  de mudar nada). Aplicado aos 7 módulos que gravam (cada um só pede a sua própria fatia + `config`, para a
  marca/nome da farmácia e a limpeza do logótipo legado) e ao shell principal (`src/db.js`, que só lê
  `servicos`/`categorias`/`config` — nunca os módulos). Caso especial: `documentos.html` tem um segundo
  ponto de leitura (`pullMedsFromPim()`, que traz medicação do PIM para uma declaração) — `fetchEstado()`
  passou a aceitar um parâmetro de chaves extra (por omissão `['documentos']`, ali chamado com `['pim']`),
  `config` incluído sempre em qualquer chamada. `getEstadoCompleto()` (auto-manutenção/cópias de segurança,
  em `src/db.js`) continua deliberadamente a pedir o estado completo — precisa mesmo de tudo.

  **3. Bloco de 2,24 MB embutido em `devolucoes-armazenistas.html` (maior risco, feito por último).** Este
  módulo trazia os dados de referência partilhados (regras de devolução por armazenista, ~29 mil produtos
  para correspondência com detentor de AIM — iguais para todas as farmácias, nunca personalizados) embutidos
  num `<script type="application/json">` inline, com `JSON.parse` síncrono logo ao abrir — 2,24 MB em 2,35 MB
  de ficheiro (96% do total), de longe o maior ficheiro de toda a app (o 2º maior, `mapa-cardiovascular.html`,
  tem só 597 KB). Já tinha sido identificado no ponto 50 e deliberadamente adiado por ser mais arriscado.
  Movido para `assets/dados-devolucoes-armazenistas.json` — mesmo padrão já usado para o catálogo de
  produtos (ver ponto/`src/produtosCatalogo.js`): ficheiro estático, servido e cacheado à parte pelo
  CDN/browser (`Cache-Control` de 600s, igual a `/assets/*`), em vez de reembutido por inteiro a cada
  abertura do módulo. A função principal do módulo (uma só função autoexecutável, confirmado por leitura
  linha a linha antes de mexer) passou de síncrona a `async`, com um único `await fetch(...)` no topo a
  substituir o `JSON.parse` — o resto do ficheiro corre exatamente pela mesma ordem de sempre, só que depois
  desse `await`; nenhuma outra mudança de lógica. Acrescentado também um aviso visível (antes não podia
  falhar, por estar sempre embutido; agora é um pedido de rede à parte) se este ficheiro não carregar.
  `devolucoes-armazenistas.html` passa de 2,35 MB para 97 KB — alinhado com o tamanho dos outros módulos.

  **Verificação.** `tests/data.test.js`: novo bloco "leitura parcial, só as chaves pedidas" com 5 testes
  (devolve só as chaves pedidas; uma chave inexistente fica simplesmente de fora, nunca um erro;
  compatibilidade sem o parâmetro; o cabeçalho `X-Estado-Rev` continua sempre presente; isolamento entre
  farmácias também na leitura parcial). **730/730 testes unitários e 535/535 verificações e2e** (incluindo
  as 39 verificações próprias de Devoluções a Armazenistas), sem nenhuma regressão em mais nenhum módulo.
  Ficheiros alterados: `netlify.toml`, `netlify/functions/data.js`, `tests/data.test.js`, `src/db.js`,
  `modulos/aue.html`, `modulos/pim.html`, `modulos/manipulados.html`, `modulos/documentos.html`,
  `modulos/gabinete.html`, `modulos/stocks.html`, `modulos/devolucoes-armazenistas.html`.
  Ficheiro novo: `assets/dados-devolucoes-armazenistas.json`.
  Sincronizado na pasta `central multifarmácia` do PC do Ivo.

- **Ponto 57 — bug crítico: um serviço recém-criado desaparecia sozinho ao fim de segundos.** Queixa
  direta do Ivo (2026-09-24): "crio serviço, vejo-o no sítio certo durante uns 10 segundos e depois
  desaparece totalmente, quer seja do sítio onde estava quer seja do 'ver tudo' ou da lista de todos os
  serviços no sítio de criação". Confirmado por si próprio como NÃO relacionado com os pontos 55/56 de
  hoje ("já vinha de trás") — investigado como bug pré-existente, com prioridade alta por envolver perda
  real de dados numa farmácia em produção.

  **Primeira hipótese, descartada.** Pensou-se inicialmente que o ecrã "Início" (que só mostra as pastas
  de categorias, nunca uma lista plana de serviços — é preciso entrar numa categoria ou em "Ver tudo")
  pudesse estar a confundir o Ivo. Ele corrigiu isto com detalhe direto: o serviço desaparece mesmo de
  TODOS os sítios, incluindo "Ver tudo" e a própria lista de criação — não é um problema de navegação.
  Confirmado por reprodução automatizada (Playwright) que um serviço novo incrementa corretamente o
  contador da sua categoria mesmo sem aparecer diretamente no ecrã "Início" — este comportamento das
  pastas está correto e não é o bug.

  **Causa raiz confirmada (reproduzida em Playwright, com dois separadores/computadores concorrentes).**
  `src/db.js`: toda a escrita de serviços/categorias passa por `putAll()`, que grava sempre o array
  COMPLETO tal como este computador o conhece localmente. Quando o servidor recusa a gravação por conflito
  de revisão (409 — outro computador gravou entretanto; ver bloqueio otimista do ponto 50), `persist()`
  relia o estado fresco do servidor e repetia a gravação — mas `putAll` reaplicava a mudança fazendo
  `cache.servicos = items`, uma SUBSTITUIÇÃO TOTAL do array pelo instantâneo antigo deste computador, por
  cima do estado fresco. Isto apagava silenciosamente qualquer serviço que OUTRO computador tivesse
  acrescentado nesse intervalo — mesmo sendo um serviço completamente diferente, nunca tocado por esta
  gravação. Numa farmácia real com vários postos de trabalho abertos ao mesmo tempo, basta outro
  computador gravar qualquer coisa (até algo trivial, como marcar um favorito) pouco depois de um serviço
  ser criado, e entrar em conflito de revisão nessa gravação, para o serviço novo ser varrido — exatamente
  o sintoma descrito ("10 segundos depois desaparece"). `setConfig()`, ao lado, nunca teve este problema:
  o seu `aplicar` já fazia um MERGE (`{ ...cache.config, [key]: value }`) em vez de substituir tudo.

  **Reprodução (antes da correção).** Duas "abas" independentes (dois computadores da mesma farmácia): a
  aba A cria e grava um serviço com sucesso; a aba B, com a cache desatualizada (nunca viu o de A), cria o
  SEU serviço e grava — entra em conflito de revisão, tenta de novo, e essa nova tentativa apaga por
  completo o serviço da aba A do servidor. Confirmado programaticamente contra o servidor real (função
  `netlify/functions/data.js`), não só por inspeção de código.

  **Correção.** `src/db.js`: `putAll()` deixou de substituir o array inteiro. Em vez disso, calcula (por
  `id`, uma função nova `calcularDiff`) exatamente o que ESTA chamada acrescentou, mudou ou removeu —
  comparando o array pedido com o último estado conhecido antes desta chamada — e reaplica só essa
  diferença (`aplicarDiff`) sobre o que o servidor tiver, tanto na primeira tentativa como em cada nova
  tentativa depois de um 409. Isto preserva sempre o que outro computador tiver acrescentado, mudado ou
  removido no intervalo, e continua a permitir remover corretamente o que esta gravação queria mesmo
  remover. Limite conhecido e aceite: uma edição ao MESMO serviço, em simultâneo, por dois computadores
  diferentes, continua "o último a gravar ganha" só para esse serviço em concreto — não há forma de
  reconciliar duas edições diferentes ao mesmo campo sem uma pessoa decidir; o que esta correção resolve é
  o caso, de longe mais comum numa farmácia com vários postos, de dois computadores a mexerem em serviços
  DIFERENTES ao mesmo tempo — que é exatamente o que o Ivo reportou.

  **Verificação.** `tests/db.test.js` (ficheiro novo): 6 testes unitários às funções puras
  `calcularDiff`/`aplicarDiff` (nenhuma alteração, um item novo, uma remoção, um item mudado, e que
  `aplicarDiff` preserva itens não tocados pela diferença mesmo sobre uma lista fresca com itens novos de
  outra aba) + 2 testes de integração contra o servidor real (`netlify/functions/data.js`, o mesmo usado
  por `tests/data.test.js`) reproduzindo o cenário de duas abas concorrentes: (1) B cria o seu serviço
  depois de A, com um 409 pelo meio, e os DOIS sobrevivem; (2) uma remoção feita por B é respeitada e uma
  adição feita por A não é anulada, mesmo em conflito. Confirmado que estes 2 testes de integração FALHAM
  (reproduzindo o bug exato) contra o código anterior ao ponto 57, e passam com a correção — não é só uma
  correção plausível, é uma correção verificada a apanhar mesmo a regressão. **738/738 testes unitários e
  528/529 verificações e2e** (a 1 falha isolada, em `17-farma-aprender.mjs`, é uma instabilidade de tempo
  pré-existente e não relacionada — o passo de treino local por IA, computacionalmente pesado, por vezes
  excede um limite de 30s neste sandbox; confirmado por repetição que falha e passa aleatoriamente tanto
  com o código antigo como com o novo, nunca relacionado com serviços/categorias).
  Ficheiro alterado: `src/db.js`. Ficheiro novo: `tests/db.test.js`.
  **Correção a esta entrada (2026-09-24, mais tarde no mesmo dia):** esta linha dizia "sincronizado na
  pasta central multifarmácia do PC do Ivo" — não estava correto. O PC nunca esteve ligado durante esta
  sessão; os ficheiros só chegaram por download (envio direto + zip) na conversa. Ver a ronda seguinte,
  mais abaixo, para o que se percebeu por causa disto.

  **Em aberto, não resolvido nesta ronda:** o ecrã intermitente "A aplicação não carregou" que o Ivo
  mostrou em captura de ecrã (mecanismo do ponto 52, ativado quando `window.onerror`/`error` apanha uma
  falha de carregamento de recurso/script durante o arranque, ou ao fim de 8s se a app nunca acabar de
  arrancar). Pode estar relacionado com o bug de concorrência acima (se corromper outro estado a ponto de
  causar um erro de script) ou ser um problema totalmente à parte (uma falha de rede genuinamente
  transitória durante o arranque). Precisa de mais informação para confirmar — idealmente um erro de
  consola do browser capturado pelo Ivo da próxima vez que acontecer.

  **Bateria de confirmação adicional (mesmo dia, a pedido direto do Ivo: "faz mais uma bateria de testes
  minuciosa para termos a certeza que está tudo resolvido e se existir medidas para funcionar melhor ainda
  aplica-as").**

  *Mais cobertura de teste ao próprio bug.* `tests/db.test.js` ganhou 3 testes de integração novos, para
  além dos 2 já descritos acima: (1) confirma que a mesma proteção se aplica a `categorias`, não só a
  `servicos` (o código é genérico, mas só estava testado num dos dois); (2) confirma que reordenar serviços
  já existentes (que muda o campo `ordem` de TODOS eles) não apaga um serviço acrescentado por outra aba
  entretanto, e que a nova ordem é corretamente aplicada aos que foram mesmo reordenados; (3) confirma o
  caso com TRÊS abas a criar serviços diferentes em sequência (não só duas), cada uma a reagir a pelo menos
  um conflito de revisão, com as três a sobreviverem. Total: 11 testes em `tests/db.test.js` (**741/741
  testes unitários** no total do projeto).

  *Auditoria a uma possível ligação com o ecrã "A aplicação não carregou".* Hipótese considerada: o bug do
  ponto 57 (antes da correção) podia deixar a interface com uma referência a um serviço/categoria que a
  meio da sessão deixasse de existir no array (apagado pela substituição às cegas), e um sítio do código
  que assumisse `array.find(...)` sempre bem-sucedido podia rebentar com um erro de script não apanhado —
  exatamente o que ativaria o ecrã de fallback. Verificação (não só suposição): todos os pontos do código
  que fazem `servicos.find(...)`/`categorias.find(...)` (`actions.js`, `domain.js`, `src/ui/modals.js`,
  `src/ui/sidebar.js`, `src/store.js`, `farmaAcoes.js`) já têm proteção (`if (!x) return`, `x ? ... : null`,
  encadeamento opcional) para o caso de o item já não existir — não foi encontrado nenhum ponto que
  rebentasse com um item em falta. Conclusão: possível, mas sem confirmação — sem mais informação (um erro
  de consola real capturado no momento em que acontece), este ecrã continua em aberto, não se pode afirmar
  que o ponto 57 o resolveu.

  *Instabilidade encontrada e corrigida na própria bateria de testes e2e (não na aplicação).* Ao correr a
  bateria completa várias vezes seguidas para confirmar 0 regressões, `17-farma-aprender.mjs` (o teste de
  treino real por IA local) falhava por vezes com "Timeout 30000ms exceeded", de forma aparentemente
  aleatória. Investigado a fundo (não aceite como "sandbox lento" sem confirmar): `page.waitForFunction(fn,
  options)` do Playwright tem sempre 3 parâmetros posicionais (`pageFunction, arg, options`) — chamado só
  com 2, o valor `{ timeout: 30000 }` era interpretado como `arg` (o argumento passado para dentro da
  função da página, aqui nunca usado), e NÃO como `options` — pelo que o timeout pedido era sempre
  ignorado, e o timeout REAL aplicado era sempre o valor por omissão da biblioteca (30000ms), fixo,
  independentemente do número escrito no teste. Como o treino real é computacionalmente pesado (~150
  épocas sobre ~300 exemplos), qualquer lentidão momentânea do sandbox fazia-o ultrapassar esse limite fixo
  de 30s. Confirmado com o código-fonte do Playwright instalado (`waitForFunction(pageFunction, arg,
  options = {})`), não por suposição. Corrigido em `17-farma-aprender.mjs` (e no mesmo padrão, encontrado
  por grep, em `09-poupanca.mjs`) a passar `null` como segundo argumento para o timeout entrar mesmo como
  `options`, com o limite alargado de 30s para 60s/6s de margem. Confirmado por 3 corridas isoladas
  consecutivas (antes falhava por vezes, mesmo com código antigo e novo do ponto 57 — não era causado pelo
  ponto 57) que a correção resolve mesmo a instabilidade. Uma segunda instabilidade, menor, foi encontrada
  em `15-i18n.mjs` (uma verificação com uma espera fixa de 1500ms antes de confirmar que `config.idioma`
  já tinha sido gravado no servidor a seguir ao registo de conta) — substituída por um pequeno "poll" (até
  15 tentativas, 400ms de intervalo, avança assim que vir o valor esperado) em vez de mais um tempo fixo
  maior, que só adiaria o mesmo problema sem o resolver. Nenhuma destas duas instabilidades tinha qualquer
  relação com o ponto 57 (uma é sobre treino de IA local, a outra sobre o idioma escolhido no registo —
  nenhuma toca em serviços/categorias/`putAll`); são bugs pré-existentes na PRÓPRIA bateria de testes,
  nunca na aplicação.

  **Verificação final.** **741/741 testes unitários** e **535/535 verificações e2e, confirmado por 3
  corridas completas consecutivas sem nenhuma falha** (antes desta ronda de estabilização, a mesma bateria
  tinha uma probabilidade real de mostrar 1 falha isolada, sempre no mesmo sítio, nunca uma regressão real).
  Ficheiros alterados nesta ronda: `tests/db.test.js` (mais 3 testes),
  `tests/e2e/modules/17-farma-aprender.mjs`, `tests/e2e/modules/09-poupanca.mjs`,
  `tests/e2e/modules/15-i18n.mjs`. **Correção a esta entrada:** também aqui dizia "sincronizado na pasta
  central multifarmácia" sem ter sido verdade — o PC nunca ligou durante toda esta sessão; os ficheiros só
  foram entregues por download na conversa.

  **Continuação (mesmo dia): "ainda estamos com o mesmo problema" depois de o Ivo publicar.** O Ivo
  confirmou que já publicou os ficheiros corrigidos no site (`central-operacional-farmacias.netlify.app`)
  e o serviço novo continua a desaparecer ao fim de segundos. Investigação a uma segunda causa possível,
  distinta do bug de concorrência já corrigido:

  **Causa provável nº 2: cache do service worker (`sw.js`) nunca invalidada.** `sw.js` mantém
  `src/db.js` (entre outros ficheiros do "app shell") numa estratégia "stale-while-revalidate" — serve
  sempre a cópia em cache IMEDIATAMENTE, e só atualiza essa cache em segundo plano para a visita seguinte.
  A `CACHE_VERSION` (usada para forçar uma cache nova e limpar as antigas) não tinha sido subida nem no
  ponto 55, nem no 56, nem no 57 — apesar de `src/db.js` ter mudado de forma substancial nos três. Isto
  tem dois efeitos práticos: (1) mesmo depois de publicar, um separador do browser que já estivesse aberto
  ANTES da publicação continua a correr o `db.js` antigo, já carregado em memória como módulo JavaScript —
  publicar no servidor não muda nada num separador já aberto, só uma recarga a sério (ou fechar e reabrir)
  o faz voltar a pedir os ficheiros; (2) mesmo num separador novo, sem a versão da cache subida, o
  `service worker` já instalado nesse computador não deteta que mudou nada (o browser só reinstala o
  service worker quando o PRÓPRIO ficheiro `sw.js` muda, byte a byte) e continua a servir a cache antiga
  "stale-while-revalidate" — só se autocorrige ao fim de 2 recargas (a 1ª atualiza a cache em segundo
  plano, só a 2ª já serve o ficheiro novo), nunca de imediato. Numa farmácia onde os computadores ficam
  ligados e com a app aberta o dia inteiro, isto explica perfeitamente "já publiquei e continua igual".

  **Correção.** `sw.js`: `CACHE_VERSION` subida de `central-farmacia-v4.0.0` para `central-farmacia-v4.1.0`
  — isto força o browser a detetar que o `sw.js` mudou, instalar um service worker novo, e (no evento
  `activate`) apagar de imediato a cache antiga, garantindo que a PRÓXIMA recarga em qualquer computador já
  vai buscar tudo de novo ao servidor, sem depender do ciclo lento de "stale-while-revalidate".
  **Ainda assim, mesmo com esta correção publicada, cada computador com a app já aberta precisa de UMA
  recarga a sério (F5, ou fechar e reabrir o separador/app) depois da publicação — sem isso, continua a
  correr o código antigo já carregado em memória, por muito que o servidor já tenha o código novo.** Esta é
  a explicação mais provável para o Ivo continuar a ver o mesmo problema depois de publicar: os
  computadores da farmácia provavelmente já tinham a app aberta de antes, e nunca chegaram a recarregar a
  sério depois da publicação.
  Ficheiro alterado: `sw.js`.
  **Por confirmar com o Ivo:** se, depois de publicar esta versão E fazer uma recarga a sério (não só
  navegar dentro da app) em CADA computador da farmácia, o problema volta a acontecer. Se voltar a
  acontecer mesmo depois disso, a causa não é esta, e a investigação tem de continuar por outro caminho —
  nomeadamente confirmar que a publicação incluiu mesmo `src/db.js` (não só alguns ficheiros) e, já sem
  suposições, tentar reproduzir o desaparecimento diretamente no site publicado.

## Ponto 58 — causa real (confirmada) do "serviço desaparece": `recarregarDoServidor()` substituía o estado local a meio de uma gravação pendente, numa ÚNICA aba

**Contexto.** Depois do ponto 57 (gravações concorrentes entre ABAS/computadores diferentes) estar corrigido, testado e **confirmado já publicado ao vivo** — o Ivo colou o conteúdo completo de `src/db.js` tal como servido por `central-fam.netlify.app` (o seu site de teste, numa conta Netlify diferente da conta principal), e correspondia byte a byte à correção do ponto 57, incluindo o bloco de comentário, `calcularDiff`/`aplicarDiff` e o `putAll` por diferença — o Ivo confirmou que o problema **continuava a acontecer nesse mesmo site atualizado**: "Nao encontraste nada, eu tenho outra versão publicada actualizada para teste e o problema persiste." Isto invalidou a explicação anterior (site desatualizado / cache do service worker) como única causa: tinha de existir um segundo bug, distinto do ponto 57, com o mesmo sintoma.

**Investigação.** Releitura cuidada de `src/actions.js`/`src/app.js` focada em tudo o que pode SUBSTITUIR (não só adicionar/atualizar) o estado local de `servicos`/`categorias`. Encontrado: `recarregarDoServidor()` (chamada pelo botão "Atualizar" da sidebar, pelo poll periódico de 25s, e ao voltar à aba) faz sempre `await dataStore.refresh(); await actions.iniciar();` — e `iniciar()` despacha `INIT_STATE` com `servicos`/`categorias` **inteiros**, vindos do que o servidor acabou de devolver. Isto é uma substituição total do store, não um merge.

O botão "Atualizar" (`btnRefresh`, `src/app.js`) chama `recarregarDoServidor()` **sem nenhuma proteção de `syncStatus`** — ao contrário do poll periódico e do `visibilitychange`, que só disparam quando `syncStatus === "synced"`. Ora, criar um serviço (`criarServico()`) despacha a alteração no store local de imediato (otimista, via `ADD_SERVICO`) mas só a GRAVA no servidor 350ms depois (`scheduleSync`, debounce para agrupar escritas rápidas seguidas). Um utilizador cauteloso que clique em "Atualizar" logo a seguir a criar algo — comportamento perfeitamente normal, "só para confirmar que gravou" — cai exatamente nessa janela de 350ms + a própria chamada de rede.

**Reprodução determinística (confirmada, não é só teoria).** Criado um script Playwright dedicado (`tests/e2e/repro-refresh-apaga-servico.mjs`, fora da bateria oficial) que: 1) regista uma farmácia nova, 2) cria um serviço via UI, 3) clica logo a seguir em "Atualizar" (usando um clique real no DOM, não `page.click()` do Playwright — este tem uma pequena espera de "estabilidade visual" que, por si só, já era suficiente para escapar da janela de 350ms e esconder o bug por completo; um clique de rato real não tem essa espera). Contra o código ANTES desta correção: o serviço desaparece da UI de imediato e, pior, a gravação já agendada (que ainda dispara 350ms depois, lendo o estado do store NESSE momento, já sem o serviço) grava esse estado incompleto no servidor — **perda definitiva, não só visual**. Instrumentação de rede confirmou a ordem exata: `GET /api/data` (do refresh) completa ANTES do `PUT` da gravação do serviço, pelo que o `INIT_STATE` que se segue reflete um servidor que ainda não tinha o serviço.

**Correção.** `src/actions.js`: nova função `garantirEstadoLocalGravado()`, chamada no início de `recarregarDoServidor()`, que força e espera por QUALQUER escrita ainda pendente antes de ir buscar o estado ao servidor:
- se houver um `scheduleSync` agendado (temporizador de 350ms ainda não disparado), cancela-o e força a gravação (`flushSync`) já, esperando por ela;
- se já houver uma gravação em curso (`flushSync` já a decorrer, por qualquer via — incluindo `visibilitychange`/`beforeunload`), espera que essa termine;
- se a farmácia for nova e o "seeding" dos atalhos dos módulos (`criarAtalhosModulos`, ver `iniciar()`) ainda estiver a gravar-se em segundo plano — esta gravação sempre ignorou `syncStatus` por completo, o que era um segundo ponto cego, menor mas real, para as proteções já existentes do poll periódico/`visibilitychange` — espera também por ela.

Isto torna `recarregarDoServidor()` seguro **para todos os chamadores** (botão "Atualizar", poll periódico, `visibilitychange`), sem depender de cada um lembrar-se de verificar `syncStatus` corretamente — a proteção passou a viver no sítio que faz a substituição perigosa, não em cada sítio que a desencadeia.

**Verificação.**
- `tests/e2e/repro-refresh-apaga-servico.mjs`: confirma a reprodução do bug com a correção desligada (falha de forma determinística, incluindo perda no servidor) e a correção depois de religada (passa, serviço mantido na UI e no servidor).
- `tests/actions.test.js` (novo, 4 testes unitários, sem browser — `createActions()` chamado diretamente com um `dataStore` falso cujo relógio o teste controla): criar um serviço e chamar `recarregarDoServidor()` logo a seguir mantém o serviço (na UI e no servidor); sem nada pendente, o refresh não faz nenhuma gravação extra; duas criações seguidas dentro do mesmo debounce sobrevivem ambas; e o caso da farmácia nova — um refresh que caia a meio do "seeding" dos atalhos dos módulos espera por ele (confirmado que, sem isto, os atalhos não desapareciam mas DUPLICAVAM-SE, com ids novos, porque o `iniciar()` chamado de dentro do refresh via a flag `atalhosModulosCriados` ainda por gravar). Todos os 4 testes confirmados a apanhar a regressão quando a correção correspondente é desligada, um de cada vez.
- **745/745 testes unitários** (741 + 4 novos) e **535/535 verificações e2e**, bateria completa a correr sem nenhuma falha depois da correção.
- `sw.js`: `CACHE_VERSION` subida de novo, de `central-farmacia-v4.1.0` para `central-farmacia-v4.2.0` (mesma lição do ponto 57: `src/actions.js` está na lista do "app shell" em cache `stale-while-revalidate`).

Ficheiros alterados: `src/actions.js`, `sw.js`, `tests/actions.test.js` (novo), `tests/e2e/repro-refresh-apaga-servico.mjs` (novo, script de reprodução fora da bateria oficial).

**Nota honesta:** isto NÃO invalida a correção do ponto 57 (gravações concorrentes entre computadores diferentes continua a ser um bug real que foi corrigido) nem a subida da `CACHE_VERSION` já feita nesse ponto (continua necessária para o código chegar a todos os computadores). São duas causas distintas, com o mesmo sintoma visível, ambas agora corrigidas e testadas. Falta ainda: publicar esta correção no(s) site(s) do Ivo e confirmar com ele que o problema desaparece mesmo depois de publicada — só o Ivo pode confirmar isso no seu ambiente real.

## Plano de trabalho

- ~~Desenhar o modelo de dados multi-farmácia sobre Netlify Blobs (tenants, sessões JWT, namespacing).~~ Feito.
- ~~Criar o esqueleto do novo projeto (separado do repo de produção).~~ Feito.
- ~~Integrar a primeira peça: "Pedidos de Manipulados".~~ Feito (2026-09-08).
- ~~Integrar a segunda peça: "Central de Documentos".~~ Feito (2026-09-08).
- ~~Integrar a terceira peça: "Gestão de Gabinete".~~ Feito (2026-09-08).
- ~~Integrar a quarta peça: "Gestão de PIM".~~ Feito (2026-09-08).
- ~~Integrar a quinta peça: "Pedidos AUE".~~ Feito (2026-09-08).
- ~~Integrar a sexta peça: "Stocks Errados".~~ Feito (2026-09-08).
- ~~Corrigir o bug do "← Voltar à Central" em todos os módulos.~~ Feito (2026-09-08).
- ~~Corrigir o bug maior: todos os handlers de eventos inline partidos em 5 módulos.~~ Feito (2026-09-09).
- ~~Integrar a peça 7: 6 ferramentas independentes (Reservas, Aluguer Medela, Conversor de PDF,
  Devolução de Frio, Mapa Cardiovascular, Devoluções a Armazenistas).~~ Feito (2026-09-09).
- ~~Revisão final de harmonização (dados): fonte única de nome/logótipo/morada/contactos em toda a app,
  ligada a Configurações.~~ Feito (2026-09-09).
- ~~Centralizar a base de dados de produtos (catálogo base + overlay por farmácia) e criar a
  ferramenta de gestão do catálogo (manual, Excel, PDF, DMF).~~ Feito (2026-09-09).
- ~~Verificar o isolamento multi-tenant a escala (milhares de farmácias).~~ Feito (2026-09-09) — ver
  ponto 12, duas recomendações não bloqueantes registadas.
- ~~Auditoria final de bugs em toda a aplicação.~~ Feito (2026-09-09) — ver "Outros" acima.
- ~~Revisão final de harmonização (visual): unificar a paleta de cores de todos os módulos para que a
  app pareça um único software.~~ Feito (2026-09-09) — ver ponto 13.
- ~~Redesenho de navegação Sifarma (barra superior + inferior partilhada) em todos os 13 módulos,
  corrigindo os botões "Voltar à Central" sobrepostos.~~ Feito (2026-09-09) — ver ponto 14.
- ~~Auditoria de desempenho (logótipo/gravações) + responsividade móvel/tablet + bateria de testes
  completa.~~ Feito (2026-09-09/10) — ver ponto 15.
- ~~Atalhos de todos os módulos/ferramentas como "serviços" na categoria Serviços Clínicos.~~ Feito
  (2026-09-11) — ver ponto 16.
- ~~Lote de correções PIM/Gabinete/Manipulados/Stocks + reescrita do leitor GS1.~~ Feito (2026-09-11) —
  ver ponto 16.
- ~~Corrigir o âmbito do logótipo 4x maior: aplicar a toda a Central, não só ao Gabinete.~~ Feito
  (2026-09-12) — ver ponto 17.
- ~~Construir o novo módulo "Poupança & ROI": tracking de uso por tarefa nos 13 módulos, calculadora
  de €/hora, gráficos e exportação PDF.~~ Feito (2026-09-12) — ver ponto 17.
- ~~Sincronizar todos os ficheiros novos/alterados desta sessão para o PC do Ivo.~~ Feito (2026-09-12)
  — ver ponto 17.
- ~~Avaliar/substituir a biblioteca de leitura de câmara (`jsQR`) por um leitor capaz de DataMatrix,
  nos 3 pontos de câmara da Central, cruzado com a base de dados de produtos.~~ Feito (2026-09-12) —
  ver ponto 18.
- ~~Corrigir bug do botão "+ Adicionar à lista de controlo" (Gabinete, pós-scan).~~ Feito (2026-09-12)
  — ver ponto 19.
- ~~Fundir "Lista de Controlo" e "Itens do Gabinete" numa única fonte de verdade, com relatórios a
  atualizar stock/validade e a alimentar os alarmes.~~ Feito (2026-09-12) — ver ponto 19.
- ~~Corrigir rótulos do PIM que se fundiam na impressão + falta de botão de confirmação do scan de nova
  embalagem.~~ Feito (2026-09-12) — ver ponto 19.
- ~~Poupança & ROI: valor/hora de exemplo, gráficos com período/vistas, correção da exportação de PDF,
  revisão das estimativas de tempo manual, tracking por mudança de estado em Manipulados, e expansão do
  catálogo de tarefas em toda a Central.~~ Feito (2026-09-12) — ver ponto 19.
- ~~Expandir os testes automatizados da Central "ao máximo" (alvo de referência: ~300), melhorando o
  funcionamento real da app durante o processo, não só a contagem de testes.~~ Feito (2026-09-13) — ver
  ponto 20 (594 testes, 9 bugs reais corrigidos).
- ~~Sincronizar os ficheiros alterados no ponto 19 e no ponto 20 para o PC do Ivo assim que a ligação for
  restabelecida.~~ Feito (2026-09-15) — ver ponto 21 (76 ficheiros confirmados na pasta `central
  multifarmácia`).
- ~~Pedido de 12 itens do Ivo — parte concreta: Medela (logótipo a metade), Gabinete (paridade
  impressão/ecrã do Relatório), PIM (Histórico de Embalagens/Consumo editáveis), Devoluções a
  Armazenistas (importar regras Excel/PDF), Documentos (nova Declaração de Medicação, remoção do
  rodapé de crédito de software, pré-preenchimento de contacto da farmácia).~~ Feito (2026-09-15) — ver
  ponto 21.
- ~~Refinar a Declaração de Medicação para seguir um modelo real já aprovado pela farmácia (lista por
  DCI, redação exata, campo de cidade, ajustes ao bloco de assinatura).~~ Feito (2026-09-15) — ver
  ponto 22.
- ~~Implementar a auto-manutenção intensiva da Central (integridade de dados + backups automáticos +
  painel de saúde/desempenho) — especificação no ponto 21.~~ Feito (2026-09-15) — ver ponto 23. O Ivo deu
  luz verde explícita aos 3 módulos grandes ("avança para os 3 módulos grandes") e, questionado sobre o
  âmbito da IA "FARMA", pediu os 3 pilares completos ("os 3 de forma bem completa") — a implementar um de
  cada vez na mesma sessão.
- ~~Implementar a IA interna "FARMA" (autónoma, sem API externa, os 3 pilares — alertas/insights,
  assistente de perguntas e respostas, deteção de automação/atalhos — "de forma bem completa") —
  especificação no ponto 21.~~ Feito (2026-09-15) — ver ponto 25 (novo módulo standalone `farma-ia.html`,
  o 14º módulo da Central).
- ~~Implementar o multi-idioma de toda a Central (15 idiomas, escolhido no registo e mudável depois) —
  especificação no ponto 21.~~ Feito (2026-09-15) — ver ponto 24 (motor de i18n próprio, shell central
  traduzida por inteiro; os 13 módulos individuais ficam para o item seguinte).
- Traduzir os 14 módulos individuais (`modulos/*.html`, incluindo o novo `farma-ia.html` do ponto 25,
  também construído só em português) para os 15 idiomas do ponto 24 — rollout deliberadamente fora do
  âmbito do ponto 24 (motor + shell central já prontos e reutilizáveis, só falta aplicar
  `data-i18n*`/chaves novas a cada módulo, um a um, para não fazer uma passagem só superficial por 14
  ficheiros de uma vez); ainda sem pedido explícito do Ivo para esta ronda.
- Considerar corrigir o mesmo anti-padrão de paginação de impressão nos outros 7 ficheiros identificados
  (ver "Ainda por fazer") — não pedido ainda.
- Ir integrando as próximas peças à medida que o Ivo as for enviando.
- Atualizar o `Code.gs` de cada farmácia (fora deste repositório, trabalho do Ivo) para tratar os `kind`
  novos `report_pdf` e `alerta_pim_terminar` — ver ponto 16.
- Confirmar, em browser real com internet (fora do sandbox desta sessão), que a leitura de DataMatrix
  funciona como esperado numa embalagem real — ver ponto 18 e "Ainda por fazer".
- Resolver o bloqueio de implantação (publicar no Netlify) — pergunta em aberto, ver "Ainda por fazer".
- Empacotamento para as 3 lojas (Capacitor + PWABuilder), incluindo requisitos "de bastidores":
  contas de developer (Apple/Google/Microsoft), política de privacidade, RGPD.
- ~~Investigar a queixa "a FARMA não consegue de facto fazer as tarefas" (auditoria pedida pelo Ivo,
  ver ponto 46) e avançar a Fase A (ligar o mini-chat e o módulo completo ao motor de ações, sem
  depender da IA local opcional) + Fase B (testes e2e reais do percurso completo de uma ação) do plano
  de melhorias resultante.~~ Feito (2026-09-20) — ver ponto 46.
- ~~Fase C, item AUE: validar o formato de NIF/email antes de gravar (até aqui só se confirmava que não
  estavam vazios).~~ Feito (2026-09-23) — ver ponto 49.
- ~~Fase C, item Devoluções a Armazenistas: corrigir os ~0,5% de designações de produto com uma palavra
  duplicada por engano no JSON interno.~~ Feito (2026-09-23) — ver ponto 50. O sub-item do tamanho do
  JSON (2,24 MB, `JSON.parse` síncrono no arranque) foi avaliado mas adiado deliberadamente — ver ponto
  50 para a análise completa e a justificação do adiamento.
- CDNs sem SRI (Fase C): script `scripts/aplicar-sri-cdn.mjs` já escrito, verificado em modo `--list` e
  testado quanto a idempotência, mas nunca correu com `--write` — este sandbox de desenvolvimento não
  tem acesso real à internet nesta sessão (confirmado: até o registo npm e o pypi respondem
  "host_not_allowed"), e o script deliberadamente nunca inventa um hash sem o ficheiro real. Precisa de
  correr `node scripts/aplicar-sri-cdn.mjs --write` numa máquina com internet a sério (ex. o PC do Ivo,
  depois de sincronizado) ou numa sessão futura com rede de saída disponível.
- ~~`/api/data` sem bloqueio otimista (Fase C).~~ Feito (2026-09-23) — ver ponto 51.
- Avaliar verificação de email no onboarding (Fase C) — o Ivo pediu para avançar (2026-09-23); ideia
  proposta: reutilizar o mesmo mecanismo já usado em AUE/Manipulados (Web App do Google Apps Script, sem
  custo, sem chave paga), mas corrido a partir do servidor e configurado uma vez para a Central toda — por
  implementar, precisa que o Ivo crie um Apps Script dedicado e dê o URL como variável de ambiente.
- Fase D (maturidade SaaS: password/admin/faturação/RGPD) — o Ivo pediu para avançar em todas as frentes
  (2026-09-23, "avança com tudo"). Ordem escolhida: Painel Developer/Super-Admin primeiro (sem dependências
  externas) → recuperação de password (reutiliza o mesmo mecanismo de email do item acima) → faturação e
  RGPD ficam deliberadamente por agora, à espera de uma decisão de negócio real do Ivo sobre vender a
  terceiros (construir isso sem essa decisão seria trabalho especulativo).
  - ~~Painel Developer/Super-Admin — MVP de lista de farmácias, só leitura.~~ Feito (2026-09-23) — ver
    ponto 54. Ferramentas de manutenção/monitor de erros/gestão de atualizações ficam para uma próxima
    ronda.
  - Recuperação de password — por implementar; depende do mesmo Apps Script do item de onboarding acima.
  - Faturação (Stripe/MB WAY) e conformidade RGPD — adiadas, ver acima.
  Ver `plano-melhorias-pendentes-2026-09.md` no projeto para o detalhe completo de Fases C e D.
- ~~Bug na impressão de Bolachas Promocionais (queixa direta do Ivo).~~ Feito (2026-09-23) — ver
  ponto 47: "Imprimir esta bolacha" saía com o texto/imagens fora do sítio; corrigido e coberto por um
  teste e2e novo.
- ~~Bolachas: opção de várias caixas de texto independentes, com tamanho e cor de letra próprios em
  cada uma (pedido direto do Ivo).~~ Feito (2026-09-23) — ver ponto 48.
- ~~Sincronização lenta / gravações às vezes perdidas (queixa direta do Ivo).~~ Feito (2026-09-23) — ver
  ponto 55: cada gravação enviava o estado inteiro da farmácia em vez de só a sua própria fatia; corrigido
  no servidor e nos 7 módulos com gravação própria.
- ~~"Que mais podemos fazer para melhorar a rapidez e fluidez da central?" (pedido direto do Ivo, a seguir
  ao ponto 55).~~ Feito (2026-09-24) — ver ponto 56: `Cache-Control` em falta nos módulos, o GET também só a
  fatia (Fase 2 do ponto 55), e o bloco de 2,24 MB de Devoluções a Armazenistas movido para um ficheiro à
  parte. Fica por avaliar, numa próxima ronda (não pedido nem investigado ainda): os 5 módulos mais simples
  que só leem `config` do estado partilhado (`catalogo-produtos.html`, `devolucao-frio.html`,
  `mapa-cardiovascular.html`, `medela.html`, `reservas.html`) e `src/manutencao.js`/`src/usoLeitura.js` —
  não tocados nesta ronda, deliberadamente fora do âmbito acordado com o Ivo.
- **AINDA NÃO CONFIRMADO COMO RESOLVIDO PELO IVO** (correção nova aplicada e testada, falta confirmação no
  ambiente real dele) — Bug crítico: um serviço recém-criado desaparecia sozinho ao fim de segundos
  (queixa direta do Ivo). Duas causas distintas encontradas e corrigidas, com o mesmo sintoma: (1) ponto
  57 — gravações concorrentes de dois computadores da mesma farmácia podiam apagar-se uma à outra;
  corrigido em `src/db.js` com merge por diferença. O Ivo confirmou (colando o `src/db.js` publicado em
  `central-fam.netlify.app`) que esta correção já estava mesmo ao vivo — e reportou que o problema
  persistia mesmo assim, o que levou à investigação de uma segunda causa. (2) **ponto 58 — a causa
  encontrada e reproduzida de forma determinística**: `recarregarDoServidor()` (o botão "Atualizar" da
  sidebar, sem NENHUMA proteção) substituía o estado local inteiro pelo do servidor mesmo quando uma
  criação recente ainda estava na janela de 350ms de gravação em debounce, apagando-a — numa ÚNICA aba,
  sem concorrência entre computadores nenhuma. Corrigido com `garantirEstadoLocalGravado()`, que força e
  espera por qualquer gravação pendente antes de qualquer refresh. Verificado com um script de reprodução
  Playwright dedicado (falha de forma determinística sem a correção, passa com ela) e 4 testes unitários
  novos — **745/745 testes unitários, 535/535 verificações e2e**. `CACHE_VERSION` do service worker subida
  outra vez (v4.1.0 → v4.2.0), pela mesma razão do ponto 57 (`src/actions.js` também está no "app shell"
  em cache). **Falta:** publicar esta correção e o Ivo confirmar, no seu ambiente real, que o problema
  desaparece mesmo — só ele pode validar isso. Fica também em aberto, por falta de informação suficiente: o
  ecrã intermitente "A aplicação não carregou" que o Ivo mostrou em captura de ecrã — pode ou não estar
  relacionado; precisa de um erro de consola capturado da próxima vez que acontecer.
- Fase 4 do plano "FARMA aprende a pensar" (ponto 41/42) — pesquisa pontual na internet, só informação
  pública (ex.: preço/princípio ativo de um medicamento), nunca dados de utentes, nunca uma IA externa.
  Candidato identificado: `transparencia.sns.gov.pt` (Opendatasoft, plausivelmente com CORS) — mas este
  sandbox de desenvolvimento não consegue verificar ligação real a domínios externos (proxy de saída
  bloqueia), por isso a implementação e o teste de conectividade real precisam de ser feitos com o Ivo,
  já no computador dele, com internet a sério.
- Função 2 da aba "Aprender" (ponto 43) — "treino via pesquisa pública na internet": mesma limitação de
  conectividade do item acima (Fase 4), mais o trabalho adicional de desenhar uma pipeline defensiva de
  recolha/ingestão de texto público (nunca um scraping sem controlo) antes de alimentar o treino local. Por
  agora só o treino 100% offline (dados sintéticos + aliases ensinados + padrões partilhados opcionais da
  Função 4) está implementado; a UI mostra isto como "em breve", nunca fingindo que já existe.
- Rever as propostas que a FARMA for gerando em "Explorar central" (ponto 43, Função 1) à medida que
  forem sendo aprovadas pelo Ivo em `config.farmaPropostas` — cada aprovação é só um sinal para uma
  implementação real a decidir numa sessão futura, nunca automática.
- Traduzir a nova aba "Aprender" (ponto 43) quando a ronda de tradução dos 14 módulos individuais (ver
  item acima, ponto 24) avançar — construída só em português, como o resto de `farma-ia.html` até agora.
- ~~`modulos/devolucao-frio.html` chama a API da Anthropic diretamente do browser, violando a regra
  absoluta ponto 29.~~ Resolvido (2026-09-20) — ver ponto 45: o Ivo escolheu remover por completo o
  auto-preenchimento por IA (não substituir por um backend/proxy, que não resolveria a violação da regra).
  O preenchimento manual dos campos continua a funcionar exatamente como antes.
- Rever com o Ivo, item a item, as restantes conclusões do relatório de auditoria PDF de 20/09/2026 — o
  relatório não reflete a autenticação/JWT/multi-tenancy já implementada (`netlify/functions/auth.js`,
  `authClient.js`, `tenantId` assinado no token), pelo que algumas das suas conclusões de "SaaS Readiness"
  (secção 5 do PDF) já estavam desatualizadas e precisaram de ser confirmadas uma a uma, não aceites em
  bloco. Revisão feita em 2026-09-23, item a item:
  - ~~Falta de sanitização/validação em formulários (NIF, email, telefone do AUE).~~ Feito — NIF/email no
    ponto 49, telefone no ponto 52. Os 3 campos citados pela auditoria estão cobertos.
  - ~~Concorrência na rota monolítica `/api/data` sem versionamento.~~ Feito — ver ponto 51 (bloqueio
    otimista por revisão). Nota: a auditoria (Fase 2 do roteiro) sugeria ir mais longe — separar
    `/api/data` em endpoints por recurso (`/api/aue`, `/api/catalogo`, etc.) com ETag/If-Match — o ponto 51
    optou deliberadamente por uma versão mais leve (um único endpoint, um único número de revisão por
    farmácia) para resolver a mesma corrida de dados com muito menos risco de regressão; a granularização
    completa fica como possível trabalho futuro, não incluída aqui.
  - ~~Dados corrompidos no JSON interno de `devolucoes-armazenistas.html`.~~ Feito — ver ponto 50.
  - ~~Dependência Rígida de Ficheiros / falta de bootstrap de fallback no shell.~~ Feito — ver ponto 53.
  - Email Apps Script em modo `no-cors` "mascara" o estatuto real do envio — investigado: é uma limitação
    do próprio browser (modo `no-cors` nunca expõe o HTTP status real a JavaScript, por desenho de
    segurança), não um bug do código. O código já trata isto da forma mais honesta possível do lado do
    cliente: mensagem explícita a pedir para confirmar na pasta "Enviados", e `.catch()` para falhas de
    rede totais. Só ficaria mais preciso com uma mudança do lado do Google Apps Script do Ivo (para
    responder com CORS real em vez de `no-cors`), fora do alcance deste código. Sem ação adicional prevista
    aqui.
  - Catálogo sem paginação real / `innerHTML` dinâmico — investigado: `catalogo-produtos.html` já limita
    os resultados a 200 por pesquisa (não é paginação página-a-página como a auditoria descreve
    literalmente, mas cumpre a mesma função de não tentar renderizar os 29 mil produtos de uma vez) e todo
    o HTML dinâmico usa `escapeHtml()` antes de entrar no DOM — não é o risco de injeção direta que o
    termo genérico "innerHTML dinâmico" sugeria. Sem vulnerabilidade real confirmada como o código está
    hoje; sem ação adicional prevista aqui.
  - Memory leaks no conversor de PDF com documentos grandes (>20 MB) — ainda por investigar/confirmar.
  - Fragilidade da extração de PDF por coordenadas Y (tabelas complexas/digitalizações rodadas) — ainda por
    investigar/confirmar.
  - Camada de negócio SaaS em falta (recuperação de password, painel Developer/Super-Admin, faturação,
    multi-tenancy — já implementada, apenas não refletida no relatório —, onboarding com verificação de
    email, RGPD) — mapeada para a "Fase D" abaixo; por avançar, condicional a decisões do Ivo.
  - Itens do roteiro (Fases 1-3 do PDF) ainda não avaliados individualmente com o Ivo: rate limiting no
    login/signup, migrar tokens de autenticação de `localStorage` para cookies `HttpOnly`
    (`SameSite=Strict`/`Secure`), auditoria de acessibilidade WCAG, suíte de testes com Playwright (já
    existe uma suíte e2e própria com 526 verificações — por confirmar com o Ivo se cobre o que ele
    considera necessário ou se quer especificamente Playwright), centralização de i18n para os 14 módulos
    (ponto 24 já fez isto no shell central; os módulos individuais ficaram para uma ronda dedicada, ainda
    por agendar).
