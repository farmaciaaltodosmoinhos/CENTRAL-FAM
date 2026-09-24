# Plano de Melhorias Pendentes — Central Multifarmácia
**Data:** 20 de setembro de 2026
**Pedido por:** Ivo, após revisão do PDF de auditoria e queixa sobre a FARMA não conseguir executar tarefas de facto.
**Natureza deste documento:** plano de análise e priorização — **nenhum código foi alterado nesta ronda**, conforme pedido explícito. Serve para decidires o que aprovar antes de qualquer implementação.

---

## 0. Resumo executivo

Fiz quatro investigações separadas antes de escrever este plano:

1. Verifiquei cada reivindicação ainda pendente do PDF de auditoria diretamente contra o código real (não confiei no PDF às cegas — já se confirmou nesta sessão que tem pontos desatualizados).
2. Auditei `src/farmaAcoes.js` de ponta a ponta: as 20 ações que a FARMA diz saber fazer — quais funcionam mesmo, quais são stubs, e porque é que sentes que ela "não consegue fazer as coisas".
3. Auditei o pipeline de "aprendizagem" da FARMA (Ponto 43): se é aprendizagem real ou só aparência.
4. Corri a bateria de testes completa da aplicação (679 testes unitários + 490 verificações e2e em navegador real) para ter uma fotografia atual e objetiva de bugs — **679/679 e 490/490 passaram, sem falhas**.

**A descoberta mais importante, e provavelmente a resposta direta à tua queixa:** as 20 ações que a FARMA sabe executar (criar pedidos de manipulados/AUE, mexer no catálogo, gerir stocks, listas, etc.) **funcionam de facto e estão testadas** — não é um problema de fiabilidade generalizado. O problema é que **o balão de chat sempre visível (o ponto de entrada que provavelmente usas mais) nunca foi ligado ao motor de ações** — só responde perguntas, nunca executa nada. E o único sítio onde as ações realmente disparam (o separador "FARMA IA" → botão "Ativar compreensão livre") exige descarregar um modelo de IA local pesado (algumas centenas de MB a alguns GB), está desligado por omissão, e quando não está carregado a FARMA simplesmente diz "não percebi" — sem nunca avisar que é preciso ativar aquele botão primeiro. Achas que a FARMA não sabe fazer as tarefas; na verdade, na maior parte das vezes ela nunca chega a tentar.

A aprendizagem real (Ponto 43) verificou-se genuína: há uma rede neuronal pequena treinada de facto no browser, cujos pesos mudam mensuravelmente as respostas da FARMA, mais uma pesquisa por semelhança sobre documentos carregados. Não é decorativa. As regras de produto (Função 1 nunca executa código sozinha, Função 4 só partilha vetores/estatísticas, nunca texto) confirmam-se cumpridas no código.

O PDF de auditoria tinha razão em vários pontos reais (falta validação de NIF/email no AUE, CDNs sem SRI, JSON de 2,2 MB embutido nas Devoluções com ~0,5% de registos corrompidos, falta recuperação de password/faturação/RGPD para venda como SaaS a terceiros) — mas também tinha pontos já desatualizados (multi-tenancy "ausente" quando já está implementada) e um ponto mal atribuído (handlers inline atribuídos ao ficheiro errado).

---

## 1. Prioridade 0 — a queixa da FARMA (recomendo começar aqui)

Isto é o que mais se aproxima de "a FARMA não consegue de facto fazer as tarefas".

### 1.1 O balão de chat (mini-chat) nunca liga a nenhuma ação — só Q&A
`src/ui/farmaMiniChat.js:19` só importa `responderPergunta`, `registarPerguntaNaoReconhecida`, `ensinarAlias` de `farmaIa.js`. Nunca importa nada de `farmaAcoes.js`. Isto significa que **qualquer pedido de ação escrito no balão flutuante é estruturalmente impossível de cumprir**, seja qual for o estado do resto da app. Se usas sobretudo o balão (o mais provável, por estar sempre visível em qualquer módulo), é natural sentires que a FARMA nunca faz nada — porque, ali, literalmente não pode.

**Proposta:** ligar `farmaMiniChat.js` ao motor de `farmaAcoes.js`, reutilizando o cartão "Confirmar/Cancelar" que já existe e funciona em `modulos/farma-ia.html`.

### 1.2 O motor de ações só existe atrás de um interruptor manual, desligado por omissão, sem aviso
Em `modulos/farma-ia.html`, todo o ramo de proposta de ações está dentro de `if (cerebroEngine) { ... }` (linha 805). `cerebroEngine` só existe depois de clicares em "Ativar compreensão livre (IA local, opcional)" (linha 229) — um download de várias centenas de MB. Por omissão, em cada visita ao módulo, está a `null`. Se pedires uma ação sem ter carregado esse modelo, o pedido cai silenciosamente para o motor de perguntas e respostas, que responde "Não percebi a pergunta" com sugestões só de perguntas — **nunca diz "para eu poder fazer isto, precisas de ativar a IA local acima"**.

**Proposta:** ou (a) tornar o motor de ações disponível sem depender do modelo pesado para o conjunto de 20 ações já catalogadas (usando correspondência determinística por padrões, como já existe para as perguntas), reservando o modelo local só para pedidos mais livres; ou, no mínimo, (b) detetar quando um pedido não reconhecido "tem cara" de ação (contém verbos como "cria", "muda", "apaga", "marca") e responder com uma mensagem específica a explicar o que falta ativar.

### 1.3 Zero testes automáticos cobrem o percurso real de uma ação
`tests/e2e/modules/16-farma-ia.mjs` e `17-farma-aprender.mjs` (os dois ficheiros de teste da FARMA) não têm nenhuma verificação do fluxo `mostrar cartão → Confirmar → executar → gravar no servidor`. Os testes unitários de `farmaAcoes.js` (que confirmam que a lógica de cada ação está bem escrita) alimentam a função com JSON already-perfeito escrito à mão — nunca testam se um modelo real, a correr num browser real, consegue gerar esse JSON correto. É um ponto cego conhecido dos modelos pequenos locais (structured output/function-calling é onde falham mais).

**Proposta:** acrescentar testes e2e que exercitem o fluxo completo para as ações de maior uso (manipulados, AUE, stocks), mesmo que o passo de "o modelo interpretou o pedido" seja simulado/injetado em vez de depender de um WebGPU real no ambiente de testes.

### 1.4 Achados secundários (impacto menor)
- `catalogo.adicionar_produto` (`farmaAcoes.js:1261`) não passa o catálogo efetivo completo à verificação de duplicados no momento de confirmar — só verifica sobreposições desta farmácia, não a base de ~29 mil produtos. Janela estreita, mas real.
- `executarAcaoConfirmada` faz leitura-modificação-escrita do estado completo sem proteção contra corrida concorrente — o mesmo padrão de "escrita perdida" que já foi corrigido noutro sítio (`produtosCatalogo.js`) nunca foi aplicado aqui.

**O cartão "Confirmar/Cancelar" está corretamente aplicado em 100% dos casos** — confirmei que `executarAcaoConfirmada` só é chamada a partir de um único sítio no código inteiro (o botão de confirmação). Não há nenhuma ação que salte esse passo.

---

## 2. Prioridade 0 — aprendizagem real da FARMA (Ponto 43): confirmada genuína

Boas notícias, com um detalhe a ter em conta:

- **Função 2 (treino local):** é uma rede neuronal pequena real, treinada com retropropagação de facto no browser (`src/farmaTreinoLocal.js`), com um portão de sanidade que recusa modelos piores. Os pesos treinados são lidos de volta e usados nas respostas reais (`farmaIa.js:678`) — comportamento comprovado a mudar, não só dados a serem guardados.
- **Função 3 (aprender por leitura):** pesquisa por semelhança sobre documentos carregados, honesta sobre o que é (não finge "compreender"), também provada a mudar respostas (cita o excerto encontrado).
- **Função 1 (explorar central):** confirmado que nunca executa nem gera código sozinha — o "Aprovar" só muda um campo de estado para revisão humana. Não existe capacidade de execução automática no módulo, ponto final.
- **Função 4 (partilha entre farmácias):** confirmado que só envia vetores (288 números) e contagens agregadas — nunca texto literal — e o servidor valida isto rigorosamente, rejeitando qualquer payload com texto solto. Um detalhe a comunicar-te com honestidade: os vetores são um "hash" de trigramas, que não é criptograficamente inquebrável — em teoria, para frases curtas e comuns, um atacante motivado poderia tentar adivinhar por força bruta. Não é uma falha do que foi construído, é um limite conhecido desta técnica, e vale a pena saberes disso.
- Confirmado, por grep extensivo: **nenhuma chamada a APIs de IA externas** em todo este pipeline — cumpre a regra do ponto 29.

**Não há ação necessária aqui** a não ser, opcionalmente, reforçar a nota sobre o limite da anonimização por vetores se algum dia isso for relevante para a comunicação com outras farmácias parceiras.

---

## 3. Prioridade 1 — correções reais e ainda pendentes do PDF de auditoria

Verificadas contra o código, com localização exata:

| Item | Onde | Gravidade |
|---|---|---|
| AUE: sem validação de formato de NIF/Email (só verifica que não está vazio) | `modulos/aue.html:1323-1353`, `f_nif`/`f_email` | Importante |
| Catálogo/Conversor: scripts de CDN sem SRI (integrity=) | `catalogo-produtos.html:8-9`, `conversor-pdf.html:9-10` | Importante |
| Devoluções Armazenistas: 2,24 MB de JSON embutido no HTML (praticamente todo o ficheiro) | `devolucoes-armazenistas.html:737` | Importante |
| Devoluções Armazenistas: ~0,5% dos nomes de produto (152 de 29.294) com corrupção real de dados (palavras duplicadas, ex. "Ausonia Talco Talco 200 G") | dados embutidos | Importante |
| `/api/data` (AUE e ações da FARMA): sem bloqueio otimista — duas escritas em simultâneo podem perder uma alteração | `netlify/functions/data.js`, `farmaAcoes.js` | Importante |
| Conversor PDF: acumula todos os resultados em memória antes de zipar, e gera 2 ZIPs mesmo em lotes pequenos | `conversor-pdf.html:501-565` | Menor |
| Onboarding: registo automático já existe, mas sem verificação de email (a conta ativa-se sem confirmar posse do email) | `netlify/functions/auth.js:48-79` | Importante |

**Já desatualizado ou incorreto no PDF (nenhuma ação necessária):**
- "Multi-tenancy ausente" — já implementada (`auth.js` + `data.js` derivam sempre o `tenantId` do token JWT).
- Handlers `onclick` inline atribuídos ao `index.html` — o shell está limpo (0 ocorrências); são os módulos abertos em separado que os usam, por uma razão arquitetural já documentada e comentada no `netlify.toml`.
- "Onboarding ausente" em bloco — o registo self-service já funciona; só falta a verificação de email.

---

## 4. Prioridade 2 — maturidade SaaS (só relevante se pensas vender a outras farmácias)

Estes são reais e confirmados como ausentes, mas só importam se o plano é comercializar a app para lá da tua farmácia:

- Recuperação/reset de password (não existe nenhuma rota para isso).
- Painel de administração/super-admin (não existe nenhum, nem para ti geres as farmácias clientes).
- Faturação e subscrições (zero código de cobrança).
- Conformidade RGPD (sem exportação de dados, registo de acessos ou anonimização).
- Rate limiting no login/registo (risco de força bruta, não mencionado no PDF mas real).
- Monitorização/registo de erros em produção (não há Sentry nem equivalente).

Se a intenção é continuar só para a tua farmácia + eventuais parceiras próximas geridas por ti manualmente, estes itens podem esperar. Se pensas vender como produto, são bloqueadores reais antes de lançar.

---

## 5. Verificação intensiva de bugs — resultado

Corri agora a bateria de testes completa da aplicação (não é uma auditoria nova, é a suite de testes já existente, mas correr tudo de uma vez dá uma fotografia honesta do estado atual):

- **679 testes unitários** (`node --test tests/*.test.js`) — **679 passaram, 0 falharam**.
- **490 verificações e2e** em navegador real, cobrindo os 17 módulos com teste (login/signup, PIM, Gabinete, AUE, Manipulados, Documentos, Stocks, Catálogo, Conversor PDF, Devoluções, FARMA IA, Aprender, etc.) — **490 passaram, 0 falharam**.

Isto é uma boa notícia sobre a qualidade geral do código coberto por testes — mas é preciso ser honesto sobre o que isto NÃO prova: um teste só existe para comportamento que já se sabia que devia existir. O problema do §1 (mini-chat sem ligação a ações) tinha zero testes a cobri-lo precisamente porque ninguém tinha pedido esse comportamento antes — não é um "bug escondido que os testes não apanharam", é uma funcionalidade que nunca chegou a ser ligada. A bateria de testes confirma que o que está construído e testado está sólido; não substitui a revisão dirigida que fiz nas secções 1-3.

---

## 6. Prioridade sugerida, se quiseres aprovar por fases

1. **Fase A (maior impacto na tua queixa):** 1.1 + 1.2 do §1 — ligar o mini-chat ao motor de ações e avisar quando o modelo local não está carregado. É provavelmente o que mais muda a tua perceção do dia-a-dia da FARMA.
2. **Fase B:** 1.3 do §1 (testes e2e reais do fluxo de ações) — para nunca mais voltarmos a ter isto sem cobertura.
3. **Fase C:** correções do §3 (AUE, SRI, JSON das Devoluções e a corrupção de dados nele, bloqueio otimista).
4. **Fase D (só se for para venda a terceiros):** itens do §4.

Nada disto foi implementado ainda. Diz-me quais fases (ou itens individuais) queres avançar e programo o trabalho a partir daí.
