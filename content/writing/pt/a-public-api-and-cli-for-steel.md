---
title: Contrato primeiro — a API pública, os webhooks e o CLI do Steel a partir de um documento só
description: "O SDK do Steel foi gerado de um documento de contrato antes de a API existir. Quando a API real ficou pronta, trocar um pelo outro custou seis apelidos de tipo e um cast no CLI. Isto é como uma API v1 de 29 operações, webhooks assinados e o `steel` CLI saíram do mesmo contrato — e onde esse contrato ainda deixa o SDK e o app se afastarem."
icon: terminal
date: "2026-12-22"
---

Até 17/10/2026, quem quisesse automatizar alguma coisa no Steel tinha duas
opções ruins. A API REST tem **1.125 operações** no `openapi.json`, quase
todas feitas para a interface do app e autenticadas só pelo cookie de
sessão do navegador. A outra era a chave `crm_live_`: de workspace, sem
usuário, só para criar leads. Um script de CI que abre um chamado quando o
deploy falha não tinha credencial própria, nem um contrato que não
quebrasse no deploy seguinte. E um sistema externo que quisesse saber quando
um chamado foi resolvido tinha que perguntar de tempos em tempos: o Steel
recebia webhooks de vários sistemas, mas não mandava nenhum.

O Steel é a plataforma multi-tenant da Stratus Telecom — ServiceDesk ITIL 4,
CRM, Comunicação/WhatsApp e o Steel AI por cima dos três. Sou Lead Software Engineer na Stratus Telecom: construí a primeira versão do Steel e hoje lidero a modernização técnica dele. Este post cobre três ADRs do repositório público — 0034 (CLI e SDK), 0035
(API pública v1 e tokens pessoais) e 0036 (webhooks de saída), todas com
"Decisores: product owner + time de engenharia" — e o repositório
[`steel-so/steel-cli`](https://github.com/steel-so/steel-cli).

## O problema: três entregas que dependem umas das outras

Um CLI para o Steel precisa de três coisas que não existiam: uma API que
não mude a cada deploy, uma credencial que não seja o cookie do navegador e
eventos para escutar (`steel listen`). Na ordem ingênua, isso é sequencial:
primeiro a API, depois os tokens, depois os webhooks, depois o SDK em cima
da API pronta, depois o CLI em cima do SDK. Cada camada espera a anterior
estabilizar.

O problema não é só tempo. Uma API construída sem o primeiro cliente na
mão tende a refletir o que o servidor tem, não o que o cliente precisa. E
um SDK escrito à mão em cima de uma API que ainda muda vira uma segunda
fonte de verdade que alguém precisa lembrar de atualizar.

## A ideia: escrever o contrato, gerar o resto, e tratar o CLI como o primeiro cliente

A decisão foi inverter a ordem. Primeiro um documento só,
`docs/cli/README.md`, que é o contrato entre as fatias: rotas da v1 com o
comando do CLI que usa cada uma, formato do token, códigos do fluxo de
dispositivo, corpo e cabeçalhos dos webhooks. A primeira linha diz "mudou o
contrato, mude aqui primeiro". Depois, do lado do app, o
`public/openapi.v1.json` gerado do código e travado no CI. Do lado do CLI,
um SDK gerado desse documento, nunca escrito à mão.

E uma regra da ADR 0034 que amarra tudo: **o CLI fala com o Steel só pela
API pública v1**. Nenhuma rota interna. Se o CLI precisa de algo, a v1
precisa ter — o que faz do CLI o primeiro cliente de verdade da API, e não
um atalho privilegiado.

## Como funciona

### O recorte da v1

`/api/v1` não é a API inteira com outro prefixo. É um recorte curado: **25
caminhos e 29 operações** no `openapi.v1.json` — autenticação (3), conta
(1), ServiceDesk (6), CRM (6), Comunicação (3) e webhooks (10) —, contra 766
caminhos e 1.125 operações do documento interno. A ADR 0035 proíbe regra de
negócio nova na camada v1: toda rota reaproveita o service que o app já
usa.

Todas passam pelo mesmo helper, `apiV1Route`. A ordem dele é o contrato de
segurança da v1 (trecho):

```ts
const resolved = await resolveApiSession(request)
if (!resolved.ok) return handleError(resolved.error)
const session = resolved.value

// The per-token budget is consumed by `resolveApiSession` itself.
const byUser = await consume(apiLimiter, `user:${session.userId}`)
if (!byUser.ok) return handleError(byUser.error)

if (options.access === 'write' && !session.scopes.includes('api:write')) {
  return handleError(apiTokenScopeRequired())
}
if (options.module && !session.modules.includes(options.module)) {
  return handleError(apiTokenModuleNotAllowed())
}
// ... consentimento LGPD nas escritas, Zod na query e no corpo ...
const result = await runWithAuditContext(
  { source: 'api', apiTokenId: session.tokenId },
  () => options.handler({ session, params, body, query, text: raw }),
)
```

Token pessoal (o cookie nunca vale aqui) → limite por token (300/min) e por
usuário → escopo → módulo → consentimento → validação → service, rodando
como o dono do token. A última linha é a fonte de auditoria: toda mutação
que os services já auditavam sai com `source: 'api'` e o id do token, sem
tocar em nenhum service.

Listas paginam por cursor: `?limit=` (padrão 25, máximo 100) e `?cursor=`,
com `data.items` e `data.nextCursor`. Algumas listas que o service devolve
inteiras (leads, funis, templates) paginam em memória com um cursor opaco
que codifica a posição — o cliente não sabe a diferença.

### O contrato travado no CI

`public/openapi.v1.json` é gerado do código (`pnpm openapi:generate`) e
commitado. No job "Lint & Type Check", `pnpm openapi:v1:compat --base <sha>`
compara o documento gerado no commit com o da base do PR e falha em
qualquer mudança incompatível. A lista do próprio verificador
(`src/openapi/v1/compat.ts`):

```ts
/**
 * Breaking:
 * - a path or operation removed, or a success status removed;
 * - a response field removed, made optional, or with a type it did not
 *   have (including becoming nullable);
 * - a request field or parameter removed, newly required, or accepting
 *   fewer types or enum values;
 * - a request body or content type that was accepted no longer is.
 */
```

Rota nova, campo opcional novo e código de erro novo passam. Uma rota só
sai depois de 6 meses com `Deprecation` e `Sunset`. As rotas internas
continuam livres para mudar; a v1, só para crescer.

### Identidade: token pessoal e um login pelo navegador

A identidade do MCP é OAuth com concessão por usuário e workspace — contei
isso em [Um servidor MCP é um adaptador](/pt/writing/an-mcp-server-is-an-adapter).
Para script e CI, a ADR 0035 escolheu outra coisa: um token OAuth exige um
cliente registrado e um navegador a cada renovação, e um job de CI não tem
navegador. O token pessoal (`ApiToken`) mantém a mesma forma de concessão —
um usuário, um workspace, escopos (`api:read`, `api:write`), módulos — com
validade explícita: padrão de 90 dias, máximo de 365. O valor é
`stl_pat_` + 43 caracteres aleatórios, guardado só como SHA-256 e mostrado
uma vez. Membro removido, workspace suspenso, token revogado ou vencido:
401 na chamada seguinte.

O `steel login` não pede para ninguém colar token. Ele usa o fluxo de
dispositivo: o terminal mostra um código de 8 caracteres (sem vogais nem
`0`/`1`, exibido como `BCDF-GH23`), a pessoa confirma em `/device` no Steel,
escolhe workspace, módulos e escopo, e o CLI, consultando a cada 5 s,
recebe um token chamado "Steel CLI — <máquina>". O código vale 10 minutos;
`SLOW_DOWN` soma 5 s ao intervalo.

A ADR previa o plugin `device-authorization` do Better Auth. O contrato
registra por que não ficou: o plugin devolve um token de **sessão** e não
guarda workspace, módulos nem escopo. O estado mora no Redis
(`src/cache/device-authorization.cache.ts`), e o token só é emitido na
consulta que encontra o login aprovado, uma vez. Se a pessoa perdeu o
acesso entre aprovar e o CLI consultar, a consulta devolve o erro do
emissor em vez de um token.

No CLI, o token vai para o chaveiro do sistema (Keychain, Gerenciador de
Credenciais, Secret Service) com um timeout de 3 s, porque algumas
instalações de Linux travam esperando um Secret Service que não existe.
Sem chaveiro, cai para `~/.config/steel/credentials` com permissão 600.
`STEEL_TOKEN` no ambiente tem precedência, para o CI. `steel logout` revoga
o token no Steel (`DELETE /api/v1/auth/token`) antes de apagar a cópia
local.

### Webhooks de saída: o mesmo catálogo para o ERP e para o terminal

O workspace cadastra endpoints HTTPS (até 20) que recebem eventos de um
catálogo versionado, `src/lib/webhooks/events.ts`: **19 tipos**, 12 do
ServiceDesk, 4 do CRM, 1 da Comunicação, 1 dos Steel Agents e o
`steel.ping`, que serve para teste e não é assinável. Cada tipo tem módulo,
descrição em pt-BR, schema Zod do `data` e dados de exemplo — o catálogo
vira contrato público com a mesma regra de estabilidade da v1.

A entrega sai por uma fila BullMQ (`webhooks-delivery`): corpo
`{ id, type, createdAt, workspaceId, data }`, até 6 tentativas com backoff
exponencial, timeout de 10 s, nenhum redirecionamento seguido. Endpoint que
falha por 3 dias seguidos é desativado e o admin é avisado; o log de
entregas guarda 30 dias, com reenvio manual. A URL passa por uma guarda de
SSRF ao ser salva **e** antes de cada tentativa, porque o DNS muda: só
HTTPS, sem credencial na URL, e o host — literal ou cada endereço resolvido —
precisa ser público.

A assinatura é a parte que o cliente vai reimplementar, então ela é curta:

```ts
export const WEBHOOK_HEADERS = {
  id: 'Steel-Webhook-Id',
  timestamp: 'Steel-Webhook-Timestamp',
  signature: 'Steel-Signature',
} as const

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex')
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`
}
```

`v1=<hex do HMAC-SHA256 de "<timestamp>.<corpo>">`, com o segredo
`whsec_...` do endpoint. Quem recebe compara em tempo constante, aceita
várias assinaturas separadas por vírgula (para trocar o segredo sem
derrubar nada) e recusa timestamp a mais de 5 minutos. O SDK publica essa
verificação como `verifySignature`, que nunca lança exceção.

### `steel listen --forward`: produção na sua máquina

Testar um receptor de webhook localmente costuma significar um túnel
público para a sua máquina ou um JSON colado à mão — que pula justamente a
verificação de assinatura. O `steel listen` abre um SSE
(`GET /api/v1/webhooks/listen`) que repassa os eventos do workspace em
tempo real, pelo Redis pub/sub. Cada mensagem traz o corpo e os três
valores de cabeçalho já calculados pelo servidor. Com `--forward`, o CLI
faz o `POST` para o app local com o mesmo corpo e os mesmos cabeçalhos
(`packages/cli/src/lib/forward.ts`, trecho):

```ts
const response = await fetchImpl(url, {
  method: 'POST',
  redirect: 'manual',
  signal: AbortSignal.timeout(options.timeoutMs ?? FORWARD_TIMEOUT_MS),
  headers: {
    'content-type': 'application/json',
    'user-agent': `Steel-Webhooks/1.0 (steel-cli/${VERSION})`,
    [WEBHOOK_HEADERS.id]: frame.id,
    [WEBHOOK_HEADERS.timestamp]: String(frame.timestamp),
    [WEBHOOK_HEADERS.signature]: frame.signature,
  },
  body: frame.body,
})
```

O corpo é a string exata, não um objeto re-serializado — re-serializar
mudaria a ordem ou o espaçamento e invalidaria o HMAC. O timeout de 10 s é
o mesmo de uma entrega real. O código de verificação do app roda sem
nenhum desvio "se for teste". Em outro terminal, `steel trigger
crm.lead.created` dispara um evento com os dados de exemplo do catálogo.

### O SDK gerado e o CLI em cima

`steel-so/steel-cli` é um monorepo pnpm com dois pacotes. `@steel-so/sdk` é
gerado com `openapi-typescript` a partir de um snapshot do
`openapi.v1.json` do app, e embrulha o `openapi-fetch` num resultado que
nunca lança exceção: toda chamada resolve em `{ ok: true, data }` ou
`{ ok: false, error: { status, code, message } }`. O gerador se recusa a
rodar sem um documento real — sem argumento, `STEEL_OPENAPI_SOURCE` ou um
checkout do Steel ao lado, ele falha e lista as opções. O CI do repo roda
`generate:check`: se o código gerado não bate com o snapshot commitado, o
build falha.

`@steel-so/cli` (binário `steel`, TypeScript + Ink) tem `login`, `logout`,
`whoami`, `profile`, `api` (qualquer rota da v1, com o corpo de `@arquivo`
ou stdin), `completion` para bash, zsh e fish, `listen`, `trigger`,
`webhooks`, os comandos de ServiceDesk, CRM e Comunicação, um painel
interativo quando roda sem argumentos e `steel mcp`, uma ponte stdio para
o servidor MCP. Fora de um terminal, tudo sai em JSON estável, sem cor, e o
código de saída diz o que houve: 0 sucesso, 1 erro, 2 uso incorreto, 3
autenticação, 130 cancelado.

## Resultados

A prova do contrato primeiro está na ordem dos commits, todos de 17/10
para 18/10:

| Hora | Repositório | O que entrou |
|---|---|---|
| 22h01 | `steel` | o contrato (`docs/cli/README.md`), em `2f5cb8e5` |
| 22h06 | `steel-cli` | scaffold do monorepo |
| 22h23 | `steel-cli` | SDK gerado de um fixture escrito a partir do contrato (`903b406`) |
| 22h34 | `steel` | primeiro `openapi.v1.json` gerado do código, com o check de compatibilidade no CI (`9fa51c66`) |
| 22h41 | `steel-cli` | comandos de ServiceDesk, CRM e Comunicação, ainda sobre o fixture |
| 23h28–23h56 | `steel` | merge de `feat/api-tokens`, `feat/api-v1` e `feat/webhooks-out` |
| 02h07 | `steel-cli` | SDK regerado do documento real; fixture de 3.327 linhas removido (`e18e902`) |

O SDK e os comandos de domínio foram escritos em cima de um documento que
descrevia uma API que ainda não existia. Quando o documento real chegou, a
diferença que importou foi de nomes: o fixture chamava as operações de
`listSdTickets`, `listCrmLeads`; o app gerou `listTickets`, `listLeads`. Os
**seis** apelidos de tipo do SDK (`SdTicketListQuery` e companhia)
absorveram a troca, e no CLI a mudança de código foi **um cast** em
`webhooks.tsx`, para o tipo novo da assinatura de eventos.

O que é contável hoje:

| | Antes (até 17/10) | Depois |
|---|---|---|
| Credencial para script e CI | cookie do navegador ou `crm_live_` (workspace, só leads) | `stl_pat_` por usuário × workspace × escopos × módulos |
| Contrato estável | nenhum (1.125 operações internas) | 29 operações v1, travadas no CI |
| Eventos para fora | só avisos no Slack | 18 tipos assináveis, entrega com 6 tentativas e log |
| Cliente tipado | nenhum | `@steel-so/sdk`, gerado do documento |

No `steel-cli`, a suíte tem **31 arquivos e 371 testes**, rodando em Node
22 e 24 no CI, com cobertura de **98,8%** de statements, **94,54%** de
branches, **98,4%** de funções e **99,5%** de linhas, contra limites de
95/90/95/95 que derrubam o build. No app, as fatias de tokens, v1 e
webhooks têm **39 arquivos de teste** dedicados, incluindo e2e contra o
Postgres do fluxo de dispositivo, da v1 e das rotas de webhook.

A v0.1.0 saiu em 18/10 com binários para `linux-x64`, `linux-arm64`,
`darwin-x64`, `darwin-arm64` e `windows-x64`, `SHA256SUMS`, atestação de
proveniência do GitHub Actions, os dois pacotes no npm e uma fórmula no tap
`steel-so/homebrew-tap`. A API, os webhooks e o CLI foram testados de ponta
a ponta por mim e por duas empresas clientes, com workspace e assinatura.
Não tenho números de uso — quantos tokens existem, quantas entregas falham.

## Onde quebrou / limitações

**O contrato era prosa.** `docs/cli/README.md` define rotas, campos e
códigos de erro, mas não os `operationId`. O fixture inventou uns, o
gerador do app produziu outros, e a troca só foi barata porque o SDK
expõe apelidos próprios em vez dos tipos gerados crus. A causa raiz é que
o primeiro documento de máquina nasceu do código, 33 minutos depois do
contrato, e não do contrato. Um contrato em OpenAPI desde o início teria
fixado os nomes; um contrato em Markdown fixou a intenção.

**O CI do SDK compara o SDK com ele mesmo.** `generate:check` garante que
o código gerado bate com o snapshot commitado no `steel-cli` — não que o
snapshot bate com o app. Os dois já se afastaram: depois do snapshot, o
commit `21fd34b8` do app trocou "Ajustes" por "Configurações" no caminho de
menu das descrições do `openapi.v1.json`, e o snapshot do SDK ainda diz
"Ajustes". É só texto, mas é a prova de que nada avisa. A ADR 0034 promete
"um teste de contrato contra a homologação a cada release"; o passo de
smoke do release roda o binário offline (`--version`, `profile list`, e
`steel mcp` sem token tem que sair com código 3) e não fala com nenhum
servidor. A causa raiz é estrutural: dois repositórios, e nenhum gatilho
de um para o outro.

**A v1 é um recorte, e o CLI só alcança o recorte.** 29 operações contra
1.125. A aba de Comunicação do painel mostra só templates aprovados,
porque as conversas aguardando resposta ainda não estão na v1 — e pela
regra da ADR 0034, o CLI não pode buscá-las por uma rota interna. A regra é
o que mantém a v1 honesta; o preço é que cada comando novo começa por uma
rota nova no app, com o compromisso de estabilidade que ela traz.

**Ainda não existe URL de produção no contrato.** O perfil `producao` do
CLI diz que a URL "ainda será definida", e o `servers` do
`openapi.v1.json` lista só homologação e desenvolvimento local. O
contrato é público; o ambiente definitivo, não ainda.

**A v0.1.0 saiu com dois defeitos.** O primeiro: um 401 ou 403 com código
específico (`API_TOKEN_SCOPE_REQUIRED`, módulo desligado, token vencido)
caía no ramo genérico e saía com código 1, embora o README prometa 3 para
falha de autenticação e permissão. O commit `78f034b` corrigiu mapeando
pelo status HTTP primeiro — depois da tag, então os binários da v0.1.0
ainda têm o defeito. O segundo: o README diz que o pacote npm sai com
`--provenance`, mas a 0.1.0 foi publicada à mão, sem atestação, porque o
2FA da conta npm passou a barrar o token do CI. O commit `5307225` trocou a
publicação para trusted publishing via OIDC, que vale da próxima versão em
diante.

**O `listen` verifica com outro segredo.** O segredo da escuta é derivado
do segredo do servidor por membro e workspace, não é o `whsec_` do
endpoint de produção. O código de verificação do app roda igual, mas
configurado com outro valor. Foi escolha — a escuta não tem endpoint
cadastrado, e derivar evita guardar mais um segredo —, só que um app que lê
o segredo errado em produção passa no teste local.

## O que isso prova, e o que não prova

Prova que um contrato escrito antes do código deixa API, webhooks, SDK e
CLI andarem em paralelo, em repositórios diferentes, e que gerar o SDK do
documento — em vez de escrevê-lo à mão — torna a troca de um documento
provisório pelo real uma mudança de nomes, não de comportamento. Prova
também que proibir o CLI de usar rota interna transforma o primeiro
cliente da API num teste contínuo do recorte público.

Não prova que o contrato se mantém sozinho: hoje, entre o app e o SDK,
nada impede o snapshot de envelhecer. Não prova que 29 operações bastam
para quem integra. Não diz nada sobre volume — nem de chamadas, nem de
entregas de webhook — porque esses números ainda não existem.
