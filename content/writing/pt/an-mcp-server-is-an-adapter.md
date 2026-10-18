---
title: Um servidor MCP é um adaptador — o difícil foi identidade e consentimento
description: "O servidor MCP do Steel tem 247 linhas de servidor e reaproveita 88 ferramentas que já existiam, já filtradas e já testadas. O protocolo foi a parte fácil. O trabalho de verdade foi responder quem está chamando, em qual workspace, com quais módulos e até quando — e fazer a resposta mudar na chamada seguinte quando alguém revoga o acesso."
icon: code
date: "2026-12-17"
---

O pedido era curto: clientes queriam usar o Steel de dentro do Claude, do
ChatGPT e do Cursor. Perguntar quais chamados vão estourar o SLA hoje, ver o
pipeline da semana, registrar uma nota, tudo sem abrir o app.

A primeira coisa que salta aos olhos num pedido desses é o protocolo. MCP,
transporte, JSON-RPC, `tools/list`, `tools/call`. É o que os tutoriais
ensinam e é o que aparece no diagrama. No Steel, o arquivo que fala MCP de
fato (`src/lib/mcp/server.ts`) tem **247 linhas**. O que deu trabalho foi
outra coisa: decidir quem está do outro lado de um `Authorization: Bearer`
e fazer essa resposta deixar de valer no instante em que deve deixar de
valer.

O Steel é a plataforma multi-tenant da Stratus Telecom — ServiceDesk ITIL 4,
CRM, Comunicação/WhatsApp e o Steel AI por cima dos três. Sou Lead Software Engineer na Stratus Telecom: construí a primeira versão do Steel e hoje lidero a modernização técnica dele. As decisões abaixo estão nas ADRs 0032 e 0033 do repositório público, de
17/10/2026, ambas com "Decisores: product owner + time de engenharia". Em
[Autonomia de agente de IA não é um booleano](/pt/writing/an-autonomy-spectrum-for-ai-agents)
o MCP aparece como um degrau do espectro, em poucos parágrafos. Aqui eu
desço no degrau inteiro.

## O problema: 731 rotas e uma chave que não sabe quem é você

O caminho óbvio de expor um produto via MCP é olhar a API e transformar
rota em ferramenta. A ADR 0032 conta **731 rotas** na API REST, **621** delas
sob `/workspaces/{id}`. Todas pensadas para a interface: paginação que a
tela controla, IDs que a tela já tem, filtros que a tela monta. Uma
ferramenta MCP por rota entregaria ao modelo 731 opções e o trabalho de
resolver IDs, encadear chamadas e adivinhar filtros sozinho.

O segundo problema era pior. Em 17/10, a API só aceitava o cookie de sessão
do navegador. A única chave de API que existia era a `crm_live_`: de
workspace, sem usuário, e só para leads. Um cliente MCP precisa agir **como
uma pessoa**, porque é assim que o RBAC do Steel funciona — o que você
enxerga num chamado depende do seu perfil, não do workspace. Uma chave de
workspace daria a qualquer app conectado o poder de todos os membros ao
mesmo tempo.

E havia um terceiro, mais sutil: revogação. Se a credencial for um JWT
autocontido, ela continua válida até expirar mesmo depois de o usuário sair
do workspace ou desconectar o app. O app até para de mostrar a conexão; o
token continua funcionando.

## A ideia: o registro já é o servidor, falta só a identidade

O Steel AI já tinha tudo que um servidor MCP precisa ter. Um registro de
ferramentas (`STEEL_AI_TOOLS`) com descrição para modelo, JSON Schema,
`parse`, `preview` e `execute`, filtrado por módulo e RBAC, rodando com as
permissões de quem pediu. Escrevi sobre esse contrato e sobre por que a
confirmação de uma escrita mora no servidor em
[A confirmação de uma escrita de IA mora no servidor](/pt/writing/ai-write-confirmation-belongs-on-the-server).

A decisão da ADR 0032 cabe numa frase: **`/api/mcp` é um adaptador sobre esse
registro, no mesmo processo do Next, sem repositório nem serviço à parte.**
O registro continua sendo a autoridade. O adaptador só faz duas coisas:
estreita o que o registro já permite ao que o token concedeu, e traduz
formatos.

Com isso, a pergunta "quais ferramentas o MCP tem?" vira "quem é você?". E
essa pergunta não tinha resposta no Steel. É ela que a ADR 0033 responde:
**OAuth 2.1 do próprio Steel, com cada concessão presa a um usuário, um
workspace, um conjunto de escopos e um conjunto de módulos.** Workspace,
usuário e módulos nunca vêm de argumento de ferramenta. Vêm do token.

## Como funciona

### A rota inteira cabe numa tela

A ordem das checagens em `app/api/mcp/route.ts` (trecho):

```ts
export const POST = withAxiom(async (request: NextRequest) => {
  const grant = await resolveMcpGrant(request)
  if (!grant.ok) {
    logMcpRejected({ reason: 'invalid_token', errorCode: grant.error.code })
    return mcpUnauthorized(request, BETTER_AUTH_URL)
  }

  const byUser = await consume(mcpUserLimiter, `mcp:${grant.value.userId}`)
  // ...
  const byClient = await consume(mcpClientLimiter, `mcp-client:${grant.value.clientId}`)
  // ...
  const access = await resolveToolAccess(grant.value.userId, grant.value.workspaceId)
  if (!access.ok) {
    // Removed from the workspace (or the workspace is gone) since the
    // token was issued: the grant no longer holds.
    const stale = isStaleGrantError(access.error)
    // ...
    if (stale) return mcpUnauthorized(request, BETTER_AUTH_URL)
    return handleError(access.error)
  }
  // ...
  return handleMcpRequest(request, grant.value, access.value, { /* ... */ })
})
```

Token → concessão → limite por usuário (120/min) e por cliente OAuth
(600/min) → acesso do usuário no workspace → servidor. `GET` e `DELETE`
respondem 405. O `401` sai sempre com
`WWW-Authenticate: Bearer resource_metadata="..."`, que é o que faz um
cliente MCP descobrir sozinho onde fazer login.

### Sem estado, de propósito

O transporte é Streamable HTTP sem sessão, com o SDK oficial
`@modelcontextprotocol/sdk`. Cada `POST` cria um servidor e um transporte
novos e fecha os dois no fim:

```ts
const server = createSteelMcpServer(grant, access, deps)
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
})
await server.connect(transport)
try {
  return await transport.handleRequest(request)
} finally {
  await server.close()
}
```

Não guardar sessão significa que qualquer uma das instâncias do app atende
qualquer chamada e que não existe estado de conexão para vazar entre
usuários. Custa duas coisas do protocolo, ambas registradas no contrato
(`docs/mcp/README.md`): não há `notifications/tools/list_changed` (a lista é
recalculada a cada `tools/list`) e não há *elicitation*, porque ela exige um
pedido do servidor para o cliente no meio da chamada, e um servidor que
morre no fim do `POST` não tem como receber a resposta. Isso volta mais
abaixo, na confirmação de ações com cliente final.

Rodar dentro do app também não é de graça na borda. A resposta pode vir
como SSE, e um proxy com buffering ou compressão segura os eventos até o
fim. O runbook `docs/runbooks/mcp-edge-proxy.md` existe por isso: na rota
`/api/mcp`, `proxy_buffering off`, `gzip off`, timeout de leitura de uma
hora, `Authorization`, `Host` e `X-Forwarded-Proto` repassados intactos — sem
este último, os metadados OAuth saem com `http://` e o cliente recusa.

### Identidade: um token sempre tem uma concessão atrás

O provedor é o `@better-auth/oauth-provider` (os plugins `oidc-provider` e
`mcp` do Better Auth 1.6 estão obsoletos). O fluxo é o que um cliente MCP
espera: código de autorização com PKCE `S256`, registro dinâmico de cliente
(RFC 7591, sem autenticação — o Claude, o ChatGPT e o Cursor se registram
sozinhos), `resource` apontando para `/api/mcp` (RFC 8707), metadados em
`/.well-known/oauth-protected-resource` (RFC 9728) e
`/.well-known/oauth-authorization-server` (RFC 8414), refresh e revogação.

Duas escolhas fazem a revogação funcionar:

- **Tokens opacos**, com prefixo `stl_at_` / `stl_rt_` (para scanners de
  segredo pegarem um vazamento) e guardados só como SHA-256. Access token de
  1 h; refresh de 30 dias, só com `offline_access`. Nada de JWT: cada
  chamada consulta o banco.
- **Toda autorização passa pela tela de consentimento.** O plugin pede um
  `referenceId` para o consentimento, o código e os tokens. O Steel faz esse
  valor ser o id da `IntegrationGrant`, mas o plugin só entrega usuário e
  sessão ao callback — então o id viaja por um `AsyncLocalStorage`:

```ts
const storage = new AsyncLocalStorage<string>()

export const PENDING_GRANT_REFERENCE = 'pending-consent'

export function runWithGrantReference<T>(grantId: string, fn: () => Promise<T>) {
  return storage.run(grantId, fn)
}

export function currentGrantReference(): string {
  return storage.getStore() ?? PENDING_GRANT_REFERENCE
}
```

Fora da chamada que a tela faz, o valor é `pending-consent`, que nenhuma
linha de consentimento tem. O efeito é que não existe aprovação automática:
o plugin nunca encontra um consentimento anterior e sempre manda a pessoa
para `/oauth/consent`. Nenhum token nasce sem concessão.

Do outro lado, `IntegrationGrantService.resolveAccessToken` faz, a cada
chamada: prefixo → hash → linha do token (vencido ou cliente desativado é
401) → concessão (revogada, de outro usuário ou de outro cliente é 401) →
`assertMember` → módulos ainda habilitados no workspace → escopos que o
token **e** a concessão têm. Qualquer falha vira `UNAUTHORIZED`; só erro de
banco propaga. É isso que sustenta a frase da ADR: membro removido ou
concessão revogada respondem 401 **na chamada seguinte**, não na expiração.

### O consentimento é a decisão, não o registro

O registro dinâmico é aberto de propósito: ele não decide nada. Quem
decide é a pessoa, numa tela em pt-BR que diz quem quer acessar o seu
Steel, para onde ela volta depois de permitir e que o app vai agir em seu
nome, com as suas permissões. Quem é esse "quem" mudou em 18/10 — conto
abaixo, nas limitações. Ela escolhe o
**workspace**, os **módulos** (só os habilitados) e o **nível de acesso**:
"Ler" (`mcp:read`) ou "Ler e alterar" (`mcp:read` + `mcp:write`). O aviso
LGPD diz para onde os dados vão — o provedor do app de IA — e tem versão
(`mcp-consent-v1`), registrada no evento de auditoria
`auth.oauth_consent.granted` junto com escopos e módulos.

A concessão aceita vira uma linha `IntegrationGrant` (usuário, workspace,
cliente, host de destino, escopos, módulos, último uso, revogação), única por
usuário × cliente × workspace enquanto ativa. O usuário vê e revoga as suas
em Configurações › Segurança › **Apps conectados**, com o domínio ao lado do
nome do app. O OWNER/ADMIN do workspace
tem a mesma tela para todos os membros, com revogação por concessão, por
membro ou por app, e contagem de chamadas por app em 7 e 30 dias. Revogar,
por qualquer caminho, apaga os access tokens, revoga os refresh tokens,
remove o consentimento e cancela, na mesma transação, as ações pendentes
daquela concessão.

### O que cada token enxerga

A regra de exposição inteira está em `src/lib/mcp/tools.ts`:

```ts
const MCP_WRITE_KINDS: readonly AiToolKind[] = ['CREATE', 'UPDATE', 'ACTION']

export function mcpAllowedKinds(grant, access): readonly AiToolKind[] {
  if (grant.scopes.includes('mcp:write') && access.mcpWriteEnabled === true) {
    return ['READ', ...MCP_WRITE_KINDS]
  }
  return ['READ']
}
```

Escrita só com o escopo **e** o interruptor "Permitir escrita via MCP" do
admin (`mcpWriteEnabled`, padrão desligado). `DELETE` não está na lista em
nenhum caso. Depois disso vem o filtro de módulo da concessão e, por último,
o `hasToolAccess` do próprio registro — o mesmo módulo × RBAC do assistente
do app. Uma ferramenta fora da concessão responde igual a uma que não
existe (`-32602 Ferramenta desconhecida`): o cliente não consegue nem sondar
o que o usuário poderia ter.

Como clientes MCP põem toda ferramenta listada no contexto do modelo, acima
de **40** expostas o `tools/list` fica compacto: plataforma, todas as
escritas (o cliente decide o que confirmar pelas anotações de cada uma) e
até 20 leituras das categorias mais chamadas pelo workspace, mais
`steel_find_tools` e `steel_call_tool` para alcançar o resto. Esconder é
decisão de listagem, não de acesso: `tools/call` com o nome real de uma
ferramenta escondida funciona.

### O que volta de uma chamada

`tools/call` roda `parse` → `execute` com `source: 'mcp'` e o `actorId` da
concessão. O resultado leva o `summary` em texto e os dados em
`structuredContent`, com o mesmo teto do assistente
(`TOOL_OUTPUT_MAX_BYTES`, **20.000 bytes**) e a marca `truncated` quando
corta. Dois ajustes que só existem porque o modelo agora não é nosso:

- **Links absolutos.** As ferramentas devolvem `href` relativos às telas
  do app; o adaptador transforma todo `href` que começa com uma única `/`
  em `<origem><caminho>`, porque o cliente externo não tem como resolver.
- **Erro é resultado, não exceção.** `AppError` volta como `isError: true`
  com a mensagem em pt-BR, para o modelo ler e se corrigir.

Nas escritas, o caminho se divide em dois:

- **Sem `customerFacing`**: executa na hora, como o Autopilot.
  `structuredContent = { status: 'executed', actionId, ... }`, com
  `AiActionLog` de origem `MCP` e o `clientId` do app.
- **Com `customerFacing`** (as 5 ferramentas que falam com cliente final:
  responder ao solicitante, mandar WhatsApp, pedir aprovação, mudar a fase,
  cancelar chamado): vira uma `AiPendingAction` de 30 minutos e volta
  `status: 'pending_confirmation'` com um `confirmUrl` para a Caixa de
  entrada do Steel. Esse link é a resposta ao *elicitation* que o
  transporte sem estado não tem: funciona em qualquer cliente, e a
  confirmação passa pela mesma rota do chat do app.

Toda escrita aceita um `idempotencyKey` opcional, que o adaptador
acrescenta ao `inputSchema` e tira antes do `parse` — a ferramenta nunca o
vê. No Redis, `SET NX` de um marcador por 2 minutos e o resultado guardado
por 24 h com o hash dos argumentos. Mesma chave e mesmos argumentos devolvem
o primeiro resultado; chamada ainda rodando é `409`; mesma chave com outros
argumentos é `422`; falha libera a chave. Um cliente que perdeu a resposta
por timeout pode repetir sem criar dois leads.

### Observabilidade sem payload

Cada chamada gera uma linha `mcp.tool_call` no Axiom com ferramenta, tipo,
módulo, workspace, usuário, cliente, desfecho, código de erro e duração —
**nunca** argumentos, resultado ou texto do usuário. Recusas saem como
`mcp.rejected` com o motivo (`invalid_token`, `stale_grant`,
`rate_limited_user`, `rate_limited_client`, `access_failed`). Exceção dentro
de uma ferramenta é capturada antes que o registro a transforme num
`INTERNAL_SERVER_ERROR` genérico e vai para o Sentry só com tags
(`mcp.method`, `mcp.tool`, `mcp.client`). Um painel pronto
(`docs/mcp/axiom-dashboard.json`) e o runbook de incidente cobrem "qual
cliente está fazendo isso e como corto". E `pnpm mcp:smoke --oauth` faz o
caminho de um cliente real: registro dinâmico, login, consentimento, troca
do código, `initialize`, `tools/list`, três leituras, resources, prompts e
revogação no fim.

## Resultados

O que o adaptador expõe, contado no registro em `origin/main` hoje (98
ferramentas: 44 de leitura, 44 de escrita, 10 de exclusão), para um usuário
com acesso aos três módulos:

| Concessão | Ferramentas expostas | No `tools/list` (compacto) | Exclusões |
|---|---|---|---|
| `mcp:read` | 44 | 29 (27 + 2 meta-ferramentas) | 0 |
| `mcp:write` + interruptor do admin | 88 | 73 (71 + 2 meta-ferramentas) | 0 |
| `mcp:write` sem o interruptor | 44 | 29 | 0 |

Das 44 escritas, as **5** `customerFacing` nunca executam pelo MCP sem um
clique no Steel. Nenhuma ferramenta foi escrita para o MCP: as 88 são as
mesmas do assistente do app, com o mesmo `parse` e o mesmo `execute`.

A comparação que eu queria fazer é entre as duas metades do trabalho. Como
indicador grosseiro — linha não mede dificuldade —, o lado do protocolo
(rota, `server.ts`, `tools.ts`, `discovery.ts`, `resources.ts`, `prompts.ts`,
`http.ts`) soma **1.497 linhas**. O lado da identidade (configuração e
gateway do OAuth, concessão, consentimento, rotas e telas de Apps
conectados, services e repositórios de concessão e de cliente OAuth) soma
**2.938** na `2026.10.18.4` — eram 2.575 antes da correção da tela de
consentimento, e as 363 linhas a mais são todas do lado da identidade; o
do protocolo não mudou. A onda de 17/10 tem **26 arquivos de teste** dedicados, de
unitário a e2e contra o Postgres, e boa parte dos casos é de identidade:
token vencido, concessão de outro cliente, membro removido, revogação em
lote, escopo que o token tem e a concessão não.

Pelo git, o contrato do MCP entrou às 17h04 de 17/10 e a onda de escrita
(`feat/mcp-governance`) foi mergeada às 21h59 do mesmo dia. Isso só foi
possível porque o registro, o RBAC, a ação pendente e a auditoria já
existiam; o MCP só acrescentou a eles uma origem (`AiActionSource.MCP`) e
uma coluna (`integrationGrantId`).

O servidor foi testado de ponta a ponta por mim e por duas empresas
clientes, com workspace e assinatura. Não tenho número de uso para mostrar:
quantas concessões existem, quais ferramentas são mais chamadas, qual a
latência p95. O painel existe; os dados de uso que justificariam publicar
um número, ainda não.

## Onde quebrou / limitações

**As descrições foram escritas para o nosso prompt.** O MCP herda o
registro inteiro, inclusive o texto. O `title` de cada ferramenta é o
`label` do Steel AI, no gerúndio — "Consultando chamados" —, pensado para o
indicador de progresso do chat. Num diretório de conectores ele aparece
como nome da ferramenta. O commit `947a1cd2` reescreveu as descrições para
serem neutras, e hoje o `validateToolRegistry` derruba o boot se uma
escrita não declarar `destructiveHint`, mas a causa raiz continua: um texto só atende
dois públicos, e uma ferramenta nova pensada para o chat chega ao MCP no
mesmo deploy. O checklist de envio aos diretórios
(`docs/mcp/directory-submission.md`) deixa o `title` próprio para o MCP como
pendência.

**Encontrado e corrigido: a tela de consentimento mostrava o nome que o
cliente declarou.** O registro dinâmico é aberto e sem autenticação, como os
clientes MCP exigem, e o `client_name` vem do próprio cliente. Até 18/10, a
tela dizia "<nome> quer acessar o seu Steel" e não mostrava o domínio do
`redirect_uri` — para onde o código de autorização de fato vai. Qualquer um
podia registrar um cliente chamado "Claude" com um `redirect_uri` seu e
mandar o link para a vítima: *consent phishing*. Escopo, workspace e módulos
continuavam sendo escolha explícita da pessoa, mas o "quem" dessa decisão
era autodeclarado. E a página lia a query assinada sem conferir a
assinatura; um link adulterado renderizava normalmente e só falhava no
"Permitir". A causa raiz é que o desenho deixou toda a decisão no
consentimento — e o consentimento só é tão bom quanto o que ele mostra.

A correção ([steel-so/steel#129](https://github.com/steel-so/steel/pull/129),
registrada como "Atualização (18/10/2026)" na ADR 0033) troca a identidade
mostrada: o app passa a ser identificado pelo **host do `redirect_uri`**,
lido no servidor da query assinada, que o provedor já conferiu com as URIs
registradas. A página confere a assinatura antes de renderizar, e um link
adulterado nem abre a tela. Uma lista curta em `src/lib/mcp/client-trust.ts`
marca como "Verificado" só o Claude, o ChatGPT e o Cursor, reconhecidos pelo
domínio e nunca pelo nome. Qualquer outro aparece como "Um app em
**<domínio>** quer acessar o seu Steel", com o aviso "App não verificado:
Ele diz chamar-se “…”". Um app com redirect local aparece como "um app no
seu computador", porque ali o código não sai da máquina da pessoa. O host
fica gravado na concessão e no evento de auditoria, e Apps conectados
mostra o domínio ao lado do nome. Foi para homologação em 18/10, na versão
`2026.10.18.4`, e conferi lá. Concessões anteriores à correção ficam sem
host até a próxima autorização: o `redirect_uri` original nunca foi
guardado.

É a tese do post aplicada a ele mesmo: o protocolo estava certo o tempo
todo, e o furo estava em quem a tela dizia que estava do outro lado.

**Texto de terceiros chega a um modelo que o Steel não controla.** As
ferramentas devolvem mensagens de WhatsApp, e-mails e descrições de
chamado, escritos por gente de fora do workspace. Lá dentro do Steel AI, o
prompt e as defesas são nossos; no cliente MCP, não. Com `mcp:write`, um
prompt injetado num chamado pode criar ou alterar registros com as
permissões de quem autorizou. É por isso que `DELETE` ficou de fora e as
ações com cliente final pedem confirmação — mas isso limita o estrago, não
o impede. O resto é decisão de produto registrada: escrita via MCP só
existe se um admin ligar.

**Opaco custa consultas.** Tokens opacos resolvidos no banco a cada chamada
são o que faz a revogação valer na chamada seguinte. O preço é uma ida ao
banco para o token, outra para a concessão, outra para a filiação e outra
para os módulos, em toda chamada, antes de a ferramenta rodar. Não medi
esse custo isolado. Escolhi a revogação imediata sobre a latência sem ter
o número da latência, e isso precisa ser medido antes de alguém perguntar.

**O uso por app não serve para cobrança.** A contagem de chamadas por app
em Apps conectados é um hash no Redis por workspace por dia, com TTL de 32
dias. Perda do Redis zera a janela. É aceitável para um indicador e
inútil para faturar — e a ADR 0032 deixou a pergunta do plano em aberto: o
MCP está em todos os planos e fora da cota de IA "por enquanto", a
revisitar "quando houver uso medido". Sem uso medido, a pergunta continua
sem resposta.

**Ainda não está nos diretórios.** O envio aos diretórios de conectores do
Claude e do ChatGPT espera a produção: os revisores testam a URL pública, a
conta de revisão e as páginas legais no domínio definitivo. Todos os itens
de bloqueio do checklist estão desmarcados.

## O que isso prova, e o que não prova

Prova que, quando o produto já tem um registro de ferramentas com
validação, RBAC e caminho de escrita guardado no servidor, um servidor MCP
pode ser um adaptador fino — sem ferramenta nova, sem serviço novo — e que o
trabalho de verdade migra para a identidade: um token que sempre aponta
para uma concessão explícita, resolvida a cada chamada, revogável por quem
deu e por quem administra. Prova também que um transporte sem estado
obriga a resolver confirmação por outro caminho, e que um link de volta ao
produto é um caminho que funciona em qualquer cliente.

Não prova que o consentimento é bem lido. A tela agora mostra para onde o
código vai e só chama de "Verificado" três domínios, mas não sabe se um
domínio desconhecido é confiável — essa decisão continua com a pessoa. Não prova que as descrições servem bem a modelos de terceiros. Não
diz nada sobre latência, nem sobre como o MCP é usado de fato, porque esses
números ainda não existem. E não torna seguro o degrau de escrita: ele
continua sendo uma decisão humana explícita, com rastro, não uma garantia.
