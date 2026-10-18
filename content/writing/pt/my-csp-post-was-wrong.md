---
title: Meu post sobre CSP estava errado — a produção rodava sem middleware nenhum
description: "Em 29 de agosto eu publiquei que o script-src da Nexo era fechado com nonce por request e strict-dynamic, zero unsafe-inline. Em 20 de setembro a primeira suíte de navegador rodando o artefato de produção mostrou que a imagem publicada nunca teve o middleware: o .dockerignore derrubava o proxy.ts em silêncio. E religar o middleware quebrava a hidratação, porque nonce por request não convive com shell pré-renderizado. Esta é a correção: o que estava errado, por que eu não vi, o que entrou no lugar e o que agora impede de acontecer de novo."
icon: bug
date: "2026-10-20"
---

Em 29 de agosto eu publiquei um post sobre a defesa em camadas da Nexo e
escrevi esta frase sobre o CSP:

> `script-src`, por outro lado, não abre exceção nenhuma: nonce por
> request, `strict-dynamic`, zero `unsafe-inline`.

Ela estava errada de dois jeitos. O primeiro: em produção não existia
`script-src` nenhum, porque não existia CSP nenhum. A imagem publicada
não tinha o middleware que gera o header. O segundo é pior: se o
middleware estivesse lá, com aquele CSP, o site não teria funcionado.

Este post é a correção. O post antigo continua no ar, com uma nota no
topo apontando pra cá.

## O que eu descrevi, e o que estava servindo

O código que eu citei existia. Ele entrou no `proxy.ts` em 16 de março
(`36221827`):

```ts
function buildCspHeader(nonce: string): string {
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
```

O nonce era gerado a cada request e repassado num header `x-nonce`. No
papel, é exatamente o que o guia de CSP do Next recomenda. Eu li o
código, ele fazia sentido, e eu escrevi sobre o código.

O que a produção servia era outra coisa. Em 20 de setembro, enquanto eu
montava a primeira suíte de Playwright que roda o artefato de produção
num Chromium de verdade, a comparação com `nexopm.com` deu isto:

```
$ curl -sI https://nexopm.com/sign-in | grep -i content-security-policy
(nada)

$ curl -sI -o /dev/null -w "%{http_code}\n" https://nexopm.com/acme/projects
200      # esperado: 307 → /sign-in?redirect=...
```

Nenhum CSP. E uma rota privada respondendo **200** pra um visitante
anônimo, renderizando o shell privado em vez de mandar pro login. A
borda inteira estava fora: CSP, o HSTS que o app manda e o portão de
autenticação. O que segurava os dados eram os handlers de API, que
checam a sessão por conta própria com `getAuthSession()`. A camada que
eu descrevi como a primeira não estava lá.

Não havia sintoma nenhum. O site funcionava, o CI estava verde, o deploy
passava.

## Causa 1: o `.dockerignore` achou que `proxy.ts` era ferramenta de dev

Em 15 de março (`54a2123d`) eu reorganizei o `.dockerignore` pra enxugar
a imagem. Uma das seções ficou assim:

```
# Dev tools & config
.agents
.claude
biome.json
commitlint.config.js
proxy.ts
```

O Next 16 renomeou `middleware.ts` pra `proxy.ts`, e o nome novo, ao lado
de `biome.json` e `commitlint.config.js`, lê como configuração de proxy
de dev server. Ele entrou na lista errada e ficou lá seis meses.

O efeito é silencioso por natureza. Um arquivo ausente do contexto de
build não gera erro, nem aviso, nem linha de log: o `next build` dentro
do Docker simplesmente não tem middleware pra compilar e segue em frente.
Na minha máquina tudo funcionava, porque na minha máquina o arquivo
existe.

O detalhe que mais me incomoda é a ordem das datas. O `.dockerignore`
passou a derrubar o `proxy.ts` em 15 de março; o CSP com nonce entrou no
`proxy.ts` em 16 de março. Pelo histórico do git, a versão do header que
eu descrevi no post nunca chegou numa imagem publicada.

## Causa 2: nonce por request não cabe num shell pré-renderizado

Tirar o `proxy.ts` do `.dockerignore` era uma linha. Antes de subir,
rodei o servidor standalone local com o middleware de volta, e o site
parou de hidratar.

A Nexo usa `cacheComponents: true` desde fevereiro. Com isso, o Next
pré-renderiza o shell das páginas **no build**, e os `<script src>` do
bootstrap ficam gravados no HTML estático. Um nonce gerado por request
não tem como estar num HTML que foi escrito antes da request existir. E
`'strict-dynamic'` faz o navegador **ignorar** o `'self'`: o allowlist de
origem deixa de valer e sobra só o nonce, que esses scripts não têm.

Medido no Chromium contra o standalone: **27 scripts bloqueados**, botão
sem resposta, validação de formulário que nunca dispara. Em `next dev`
isso não aparece, porque em dev toda página é renderizada por request.

Tirar o `'strict-dynamic'` trocou um problema pelo outro: o `'self'`
voltou a cobrir os chunks, mas aí os scripts inline do payload RSC
passaram a ser bloqueados. Hash também não resolve: são **~50 scripts
inline** por página e o conteúdo deles muda a cada request. Hasheei duas
respostas seguidas da mesma página e nenhum hash se repetiu.

O guia de CSP do próprio Next diz isso numa linha, na seção sobre
nonces: *"Partial Prerendering (PPR) is incompatible with nonce-based CSP
since static shell scripts won't have access to the nonce"*. O código
antigo é praticamente o exemplo do topo desse guia; o aviso fica bem
mais abaixo, e eu fiquei no exemplo.

Ou seja: a produção só funcionava porque estava desprotegida. Religar a
proteção sozinha teria derrubado o site.

## As três saídas que eu tinha

Eram três caminhos, e a decisão foi minha:

| Caminho | O que custa |
| --- | --- |
| Manter o PPR, `script-src 'self' 'unsafe-inline'` | CSP mais fraco contra script inline injetado |
| Desligar `cacheComponents`, nonce de verdade em tudo | Toda página volta a ser renderizada por request; mudança de arquitetura |
| Deixar sem middleware | Sem CSP, sem HSTS do app, sem portão de autenticação na borda |

Escolhi o primeiro. É estritamente melhor que o estado anterior, que era
o terceiro, e não mexe em arquitetura na véspera do beta. O segundo é o
único que entrega o que o post antigo prometia, mas trocar o modelo de
renderização inteiro pra consertar um header é uma decisão que eu não
queria tomar no mesmo dia em que descobri o problema.

A correção foi um commit só (`1d3f61b`): `proxy.ts` sai do
`.dockerignore`, o `script-src` vira `'self' 'unsafe-inline'`, e o porquê
fica escrito no código, do lado do comentário que já justificava o
`unsafe-inline` do `style-src`:

```ts
// script-src carries the same kind of trade-off, forced by cacheComponents:
// the shell is prerendered at build time, so neither its bootstrap
// <script src> tags nor the ~50 inline scripts Next streams per request can
// carry a per-request nonce, and the inline payload differs on every
// request, so hashes are out too.
```

A geração do nonce foi **removida**, não comentada. Nada consumia o
`x-nonce`, e um nonce gerado a cada request que ninguém lê é exatamente o
tipo de código que faz alguém (eu, daqui a seis meses) escrever de novo
que o CSP usa nonce.

O header que `nexopm.com` manda hoje, coletado com
`curl -sI https://nexopm.com/sign-in` em 18 de outubro:

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: https:; font-src 'self'; connect-src 'self' blob: data: https://*.axiom.co https://cdn.jsdelivr.net wss://nexopm.com/realtime https://….ingest.us.sentry.io; frame-src https://www.figma.com https://www.loom.com https://www.youtube.com https://docs.google.com; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests;
strict-transport-security: max-age=63072000; includeSubDomains; preload
```

E `/acme/projects` sem sessão responde `307` pra
`/sign-in?redirect=%2Facme%2Fprojects`.

## O que impede de acontecer de novo

Três travas, da mais barata pra mais cara.

**Um teste de contrato sobre o `.dockerignore`.** Ele lê o arquivo e
falha se algum padrão cobrir um arquivo que o servidor precisa, dizendo
qual:

```ts
const RUNTIME_FILES = [
  'proxy.ts',
  'next.config.ts',
  'package.json',
  // ...
]

expect(
  excluded,
  `.dockerignore drops ${excluded.join(', ')} from the build context, ` +
    'so the deployed image runs without it',
).toEqual([])
```

Não precisa de banco nem de servidor. Rodado contra o `.dockerignore`
antigo, ele falha com `drops proxy.ts from the build context`.

**A suíte de navegador sobe o artefato standalone**
(`node .next/standalone/server.js`), não `next start`, que nem aceita
servir com `output: 'standalone'`. E roda sem `bypassCSP`: se um CSP
quebrar a hidratação, o CI fica vermelho antes de alguém abrir o site.

**`e2e/specs/csp.spec.ts`** cobre as duas causas: o header existe, não
contém `strict-dynamic` nem `nonce-`, o formulário de login hidrata sob o
CSP real sem nenhuma violação no console, e um visitante anônimo numa
rota privada é redirecionado. O teste de hidratação é simples: a
validação do formulário só roda depois que o React hidrata, então clicar
em "Continuar" vazio e esperar "E-mail é obrigatório" falha se o CSP
bloqueou o bootstrap.

## A mesma frase, quatro vezes no mesmo dia

O `proxy.ts` não foi o único caso daquele 20 de setembro. Enquanto eu
corrigia, o mesmo formato apareceu mais três vezes:

1. **A imagem** não tinha o `proxy.ts`.
2. **O bundle** do cliente no CI não tinha `NEXT_PUBLIC_AXIOM_TOKEN`: o
   navegador revalida as variáveis de ambiente e toda página morria com
   "This page couldn't load".
3. **O container** da suíte visual não recebia o ambiente: no CI não
   existe `.env` montado, e o servidor lá dentro falhava a validação e
   respondia 500 em tudo.
4. **A máquina**: mesma imagem, mesmo Chromium, mesmas fontes, e 1 pixel
   de um título azul saía `rgb(38,68,103)` aqui e `rgb(40,72,109)` no
   runner, porque o Skia escolhe o caminho SIMD conforme a CPU.

Os quatro dizem a mesma frase: **o artefato, no lugar onde ele de fato
roda, não tem o que precisa — e nada avisa.** Muda só a fronteira. Os
bugs que só o navegador viu ficam pra outro post; aqui o que importa é
que nenhuma das camadas de teste que existiam antes enxergava isso por
construção. Unidade, integração, componente em jsdom e e2e por HTTP não
executam o bundle num navegador que aplica CSP, e nenhuma delas roda a
imagem publicada. Cobertura alta não teria ajudado: o arquivo nem estava
lá pra ser coberto.

## Antes e depois

| | Até 20/09 | Depois de `1d3f61b` |
| --- | --- | --- |
| `content-security-policy` | ausente | presente |
| `script-src` | — | `'self' 'unsafe-inline'` |
| `strict-transport-security` | `max-age=31536000; includeSubDomains` (do nginx) | `max-age=63072000; includeSubDomains; preload` (do app) |
| Rota privada, visitante anônimo | `200` | `307` → `/sign-in` |
| Scripts bloqueados no Chromium (standalone) | 27, com o CSP antigo religado | 0 |

A coluna "até 20/09" do HSTS vem de um log real: o job que confere os
headers de produção imprime a resposta inteira antes de checar, e a
execução de 10 de agosto mostra o HSTS do nginx e nenhum CSP.

## Onde quebrou: o header é mais fraco, e eu tinha um alarme tocando

**`unsafe-inline` é mais fraco, sem eufemismo.** Se um XSS conseguir
injetar um `<script>` inline na página, esse CSP deixa ele rodar. Era
exatamente isso que o nonce prometia impedir. O que o header ainda
compra: recusa script de qualquer outra origem, recusa `eval` em
produção, `object-src 'none'`, `base-uri 'self'` (ninguém troca a base
dos caminhos relativos), `form-action 'self'` (nenhum formulário posta
pra fora) e `frame-ancestors 'none'`. Os uploads de usuário são servidos
pelo subdomínio de storage, não por esta origem, então um arquivo
enviado não vira script `'self'`. É uma defesa real, mas não é a que eu
descrevi em agosto.

**O post antigo ficou errado por três semanas sem eu saber, e mais
quatro sabendo.** De 29 de agosto a 20 de setembro eu não sabia. De 20
de setembro até hoje eu sabia, o código estava corrigido, e o post
continuava afirmando nonce e `strict-dynamic`. A nota de correção chega
junto com este post, não antes dele.

**Por que minha verificação não pegou.** A resposta curta é que eu
verifiquei o código, não o que estava servindo. A resposta completa é
mais desconfortável. O post antigo tem uma seção dizendo que um job
semanal confere os cinco headers de segurança contra produção e falha se
algum sumir. Esse job entrou em 16 de março, no mesmo commit que o CSP com nonce. A primeira execução
agendada foi em 23 de março, e ele falhou **todas as semanas** de 23 de
março a 14 de setembro: 27 execuções seguidas, 24 delas antes de eu
publicar. Os logs mais antigos já expiraram, mas os que ainda existem
contam a história:

- de 20 de julho a 10 de agosto, `MISSING: content-security-policy`;
- de 16 de agosto em diante, nem isso: o `curl` saía com código 60,
  falha ao validar o certificado TLS do domínio antigo, e o job morria
  antes de olhar header nenhum.

Em 16 de agosto eu mesmo disparei esse workflow à mão, na semana em que
ligava a triagem LPA2v nele, e o job de headers falhou do lado. O alarme
estava tocando. Ele só não bloqueava nada: é um workflow agendado, fora
do portão do deploy, e eu publiquei o post sem conferir o resultado dele.
Quando escrevi que os headers eram "verificados toda semana", era
verdade no sentido mais inútil possível. Desde a troca pra `nexopm.com`,
em 19 de setembro, e o deploy da correção, as quatro execuções semanais
passaram.

A causa raiz dos dois erros é a mesma: eu confiei numa leitura do
código pra afirmar algo sobre o que estava rodando. O teste de contrato
e a suíte no standalone fecham o caso específico. O que eles não fecham
é um check que falha num lugar onde ninguém olha, e esse ainda não
mudou.

**O caminho que eu ainda não testei.** Existe uma combinação que eu não
validei na Nexo e que é o próximo passo: nonce **sem** `strict-dynamic`,
com o CSP repassado também nos headers da request, que é de onde o Next
extrai o nonce pra carimbar os próprios scripts inline. Os
`<script src>` do shell pré-renderizado continuariam cobertos pelo
`'self'`, e os inline gerados por request receberiam o nonce. O código
que eu removi não fazia isso: repassava só o `x-nonce`. Se funciona com
o `cacheComponents` ligado, com o payload RSC em streaming, eu não sei.
Até medir, o header de produção continua o que está acima.

## O que isso prova, e o que não prova

Prova que um arquivo fora do contexto de build some sem deixar rastro, e
que a única forma de ver isso é testar o artefato que de fato sobe, do
lado de lá da fronteira. Prova que nonce por request e shell
pré-renderizado não convivem, e que a produção da Nexo só funcionou
durante seis meses porque estava sem a camada que eu descrevi como a
primeira.

Não prova que o CSP de hoje é bom. Ele é melhor que nada e pior que o
que eu publiquei, e quem lê o post antigo merecia saber disso antes de
copiar a configuração. Não prova que outros arquivos de runtime não
estão de fora: o teste de contrato cobre uma lista que eu escrevi à mão,
com o mesmo tipo de julgamento que pôs o `proxy.ts` no lugar errado. E
não prova que eu não faria de novo. O job de headers ficou vermelho por
seis meses e eu publiquei por cima dele. A trava nova roda no portão;
a lição sobre ler o vermelho que não bloqueia ainda é só uma frase.
