---
title: Autonomia de agente de IA não é um booleano — um espectro com um cadeado a menos por degrau
description: "\"A IA pode escrever?\" é a pergunta errada. No Steel, cada modo do Steel AI — Ask, Teste, Build, Autopilot, Steel Agents e o servidor MCP — tira exatamente um cadeado do anterior e diz o que entra no lugar. Isto é o espectro inteiro, o que um prompt injetado consegue fazer em cada degrau, e onde o desenho ainda deixa buraco."
icon: idea
date: "2026-11-12"
---

Entre 06 e 17/10/2026, o Steel AI ganhou seis jeitos diferentes de deixar
uma IA mexer nos dados de um workspace. Cada um nasceu de um pedido concreto
do product owner, e cada um tem uma ADR. Olhando as seis juntas, o que
aparece não é uma lista de features — é que nenhuma delas responde "a IA
pode escrever, sim ou não?". Todas respondem uma pergunta mais estreita:
**qual trava este modo tira, e o que fica no lugar dela?**

O Steel é a plataforma multi-tenant da Stratus Telecom — ServiceDesk ITIL 4,
CRM, Comunicação/WhatsApp e o Steel AI por cima dos três. Sou Lead Software Engineer na Stratus Telecom: construí a primeira versão do Steel e hoje lidero a modernização técnica dele. As decisões abaixo estão nas ADRs 0018 a 0023, 0032 e 0033
do repositório público, todas com "Decisores: product owner + time de
engenharia".

## O problema: "autonomia" como interruptor único

A forma ingênua de pensar autonomia de agente é um interruptor: ou a IA só
lê, ou a IA executa. O interruptor quebra nas duas pontas.

Se ele fica em "só lê", o assistente vira um buscador caro. Se fica em
"executa", tudo que o modelo lê vira um vetor de escrita: o Steel AI lê
mensagem de WhatsApp, e-mail e descrição de chamado — texto escrito por gente
de fora do workspace —, e um prompt injetado ali tem exatamente o poder de
escrita do usuário que está conversando.

O meio-termo mais comum é pôr a trava no prompt ("pergunte antes de
executar"). O Steel já tinha isso — um `userConfirmed: true` que o próprio
modelo preenchia — e foi exatamente o que a ADR 0018 desmontou. Contei isso
em detalhe em [A confirmação de uma escrita de IA mora no
servidor](/pt/writing/ai-write-confirmation-belongs-on-the-server): toda
escrita vira uma `AiPendingAction` com prévia, que só executa num clique
humano numa rota que o modelo não alcança, com tudo revalidado no servidor.
Esse mecanismo é a base de quase todos os degraus abaixo; aqui eu não repito
como ele funciona, só onde cada modo o usa, o dobra ou o desliga.

## A ideia: cada degrau remove uma trava e nomeia o substituto

Um registro só de ferramentas (`STEEL_AI_TOOLS`, **98 ferramentas** hoje, 44
de leitura) atende todos os modos. O que muda de um modo para o outro não é a
ferramenta — é quem decide se a escrita roda, e em nome de quem. A regra que
eu tirei das seis ADRs é: **um modo novo só entra se disser qual trava tira e
o que põe no lugar.** Se a resposta for "nada", o modo não é mais autônomo,
é só mais perigoso.

## O espectro, degrau por degrau

### Ask — só leitura

Modo `EXPLORE` na API. O filtro que roda antes do modelo (`isToolAllowed`)
simplesmente não oferece ferramenta de escrita:

```ts
if (tool.kind !== 'READ') {
  if (!isWriteMode(mode)) return false
  // TEST never writes, so the agent-mode kill switch does not apply.
  if (mode !== 'TEST' && !access.agentModeEnabled) return false
  if (mode === 'AUTOPILOT' && !access.autopilotEnabled) return false
}
return hasToolAccess(tool, access)
```

Nada para travar, porque nada é oferecido. As leituras rodam com as
permissões do usuário, filtradas por módulo e RBAC.

### Teste — leituras reais, escritas simuladas no servidor

Modo `TEST` (ADR 0023). Tira a trava "não ofereça escrita": o modelo vê as
ferramentas de escrita e as chama como faria de verdade. O que entra no
lugar é um desvio no caminho de execução — toda escrita vai para
`simulateWriteTool`, que faz `parse` → `preview` e para; `execute` nunca é
chamado. O prompt do modo explica isso ao modelo, mas, nas palavras da ADR,
o prompt só explica, não protege. Como nada é escrito, o Teste não depende
do interruptor de modo agente.

### Build — escritas propostas, humano confirma

Modo `AGENT` (ADR 0018). Tira a trava "escrita é simulada". Entra no lugar a
confirmação humana no servidor: a escrita vira uma `AiPendingAction`
válida por 30 minutos, exclusão pede confirmação dupla, e o clique revalida
dono, status, validade, modo, módulo e RBAC. O admin desliga o modo do
workspace inteiro (`agentModeEnabled`).

### Autopilot — executa na hora

Modo `AUTOPILOT` (ADR 0021, 07/10/2026). Tira a trava "um humano clica em
cada escrita" — **inclusive exclusões e mensagens a clientes**, por decisão
explícita do product owner ("executa tudo sozinho"). O que entra no lugar
não é outra checagem por escrita; é uma decisão de workspace mais rastro:

- só existe se o admin ligar `autopilotEnabled` (padrão desligado), e exige
  também `agentModeEnabled`. Pedir `AUTOPILOT` com o interruptor desligado
  responde `AI_AUTOPILOT_DISABLED`;
- a escrita ainda vira uma `AiPendingAction`, mas **criada já reivindicada**
  (`status = EXECUTED`, `autoExecuted = true`), que nunca fica `PENDING` nem
  expira — o mesmo caminho de execução do Build, sem o clique;
- auditoria com a ação `auto_execute`, `AiActionLog` com o usuário como ator;
- o turno não para depois de uma escrita: o modelo recebe o resultado e
  encadeia o próximo passo, até o limite de **8 rodadas**
  (`STEEL_AI_MAX_TOOL_ROUNDS`).

```ts
const created = await proposeWriteTool(tool, ctx, rawArgs,
  { ...origin, claimedBy: ctx.actorId }, now)
if (!created.ok) return created

const claimed = await runClaimed(created.value, tool, {
  ctx,
  deciderId: ctx.actorId,
  autoMode: 'AUTOPILOT',
})
```

A ADR escreve o custo sem rodeio: um prompt injetado num dado lido **pode
executar uma escrita com as permissões do usuário**. Por isso padrão
desligado, interruptor de admin e rastro completo. E desfazer é manual.

### Steel Agents — autonomia por ferramenta, em nome de alguém

Agentes autônomos (ADR 0020, 06/10/2026) não têm ninguém conversando com
eles — rodam por gatilho de agenda ou de evento. Confirmar tudo os tornaria
inúteis; não confirmar nada entregaria o banco a um prompt injetado. A
resposta foi dividir a trava em várias menores:

**Identidade.** O agente roda como o responsável (`SteelAgent.ownerId`). As
ferramentas oferecidas ao modelo são a **interseção** da lista do agente com
o que o responsável pode usar:

```ts
const allowedNames = new Set(agent.tools.map((t) => t.toolName))
const tools = availableTools(
  access.value,
  run.isTest ? 'TEST' : 'AGENT',
).filter((tool) => allowedNames.has(tool.name))
```

O agente nunca faz mais do que o responsável faria.

**`AUTO` ou `APPROVAL`, por ferramenta.** O admin escolhe ferramenta a
ferramenta; o padrão é `APPROVAL`. Escrita `AUTO` roda direto e fica em
`ai_action_logs` (`source = AGENT`). Escrita `APPROVAL` vira uma
`AiPendingAction` com validade de **72 h** e a execução pausa em
`WAITING_APPROVAL`, com a conversa inteira com o modelo guardada em
`SteelAgentRun.state`. A aprovação chega pela caixa de entrada; decide o
responsável ou quem tem `steel-agents` EDIT, numa rota própria — a rota do
assistente recusa ações de agente.

**Exclusão sempre aprovada, em três camadas**: o editor trava o
interruptor, o service grava `APPROVAL` para ferramentas `DELETE`, e o
runner trata `DELETE` como aprovação mesmo que o banco diga `AUTO`:

```ts
export function effectiveToolMode(
  kind: AiToolKind | undefined,
  mode: SteelAgentToolMode,
): SteelAgentToolMode {
  if (kind === 'DELETE') return 'APPROVAL'
  return mode
}
```

**Interruptores.** A execução termina `SKIPPED`, com o motivo, quando o
agente está pausado, está sem responsável, o responsável saiu do workspace,
o workspace está suspenso, o Steel AI ou os Steel Agents estão desligados, o
modo agente está desligado e o agente tem alguma ferramenta de escrita, o
limite mensal de execuções acabou, ou a cota de IA acabou.

**Sem laço de eventos.** Uma escrita feita por agente roda dentro de um
`AsyncLocalStorage`, e o despachante de eventos olha esse contexto antes de
disparar qualquer agente:

```ts
const origin = currentSteelAgentContext()
if (origin) {
  logger.info('steel_agents.event_ignored_from_agent', /* ... */)
  return 0
}
```

Sem isso, um agente que abre chamado no evento "chamado aberto" se chamaria
para sempre.

**Fila de tentativa única.** A fila `steel-agents` roda com `attempts: 1`.
Parece descuido até ler o motivo na ADR: repetir uma execução poderia
duplicar uma escrita automática. Uma execução que falha no meio fica
falhada; não tenta de novo sozinha.

### MCP — o mesmo registro, para um modelo que não é nosso

O degrau mais recente (ADR 0032 e 0033, 17/10/2026) expõe o Steel para
Claude, ChatGPT, Cursor e outros clientes de IA. A ADR conta **731 rotas**
na API REST, 621 delas sob `/workspaces/{id}`, pensadas para a interface do
app. Uma ferramenta MCP por rota deixaria o modelo resolvendo IDs, paginação
e filtros sozinho. Em vez disso, `/api/mcp` é um adaptador sobre o mesmo
registro do Steel AI — as mesmas ferramentas, com o mesmo `parse`,
`preview` e `execute`, menos as 10 de exclusão.

O que muda é a trava, porque agora nem o modelo nem o cliente são do Steel:

- **Identidade:** OAuth 2.1 do próprio Steel. Cada concessão
  (`IntegrationGrant`) fica presa a **um usuário × um workspace × escopos ×
  módulos**, escolhidos pelo usuário na tela de consentimento. Nada disso vem
  de argumento de ferramenta. Membro removido ou concessão revogada responde
  401 na chamada seguinte.
- **Escrita:** só com o escopo `mcp:write` **e** o admin ligando "Permitir
  escrita via MCP" (padrão desligado). O consentimento faz o papel da
  confirmação por escrita, como no Autopilot — `CREATE`, `UPDATE` e
  `ACTION` comuns executam na hora, com `idempotencyKey` opcional para
  retentativas.
- **`DELETE` nunca é exposto**, com qualquer escopo.
- **Ações que falam com cliente final** (as ferramentas marcadas
  `customerFacing`, como responder ao solicitante ou mandar WhatsApp) voltam
  a ser uma `AiPendingAction` de 30 minutos, e a ferramenta devolve o link
  para a pessoa confirmar dentro do Steel.

```ts
export function isMcpToolExposed(tool, grant, access): boolean {
  if (!access.aiEnabled) return false
  // DELETE is never exposed over MCP, whatever the scopes.
  if (tool.kind === 'DELETE') return false
  if (!mcpAllowedKinds(grant, access).includes(tool.kind)) return false
  if (tool.module && !grant.modules.includes(tool.module)) return false
  return hasToolAccess(tool, access)
}
```

Um detalhe de custo: clientes MCP colocam toda ferramenta listada no
contexto do modelo. Acima de **40** ferramentas expostas, o `tools/list`
fica compacto — ferramentas de plataforma, todas as escritas e até 20 de
leitura das categorias mais usadas pelo workspace —, e duas meta-ferramentas,
`steel_find_tools` e `steel_call_tool`, alcançam o resto. Escrita nunca fica
escondida atrás da ferramenta genérica: o cliente decide o que confirmar
pelas anotações de cada escrita.

### Memória — a escrita que pula a confirmação

Há uma escrita que não segue nenhum degrau: `memory_save` e `memory_forget`
(ADR 0022) executam na hora, em qualquer modo — inclusive no Ask. A
justificativa é que memória é metadado do assistente, não dado de negócio, e
uma memória que pede confirmação deixa de ser automática. O que entra no
lugar: as ferramentas ficam fora de `STEEL_AI_TOOLS` (agentes e MCP não as
recebem), fato de workspace exige OWNER/ADMIN, uma guarda no servidor
(`memory-guard.ts`) recusa credenciais, documentos e dados sensíveis da LGPD,
e toda gravação aparece no histórico como um chip "Memória salva" com
**Desfazer**. No modo Teste, até a memória é simulada.

## Resultados: o espectro numa tabela

| Modo | Quem decide cada escrita | O que um prompt injetado consegue | Rastro |
|---|---|---|---|
| Ask | ninguém — não há escrita | influenciar o texto da resposta | histórico da conversa |
| Teste | ninguém — escrita simulada | gerar um cartão simulado | `AiActionLog` `outcome = simulated` |
| Build | o usuário, clique a clique | propor; o usuário vê a prévia | `AiPendingAction` + `AiActionLog` + auditoria `confirm` |
| Autopilot | o admin, uma vez por workspace | executar com as permissões do usuário, inclusive excluir e mandar mensagem | `AiPendingAction` `autoExecuted` + `AiActionLog` + auditoria `auto_execute` |
| Steel Agents | o admin por ferramenta; humano na inbox para `APPROVAL` e toda exclusão | usar as ferramentas `AUTO` liberadas, com as permissões do responsável | passos da execução + `AiActionLog` (`source = AGENT`) + auditoria |
| MCP | o usuário no consentimento + o admin no interruptor; humano no Steel para `customerFacing` | escrever (não excluir) com as permissões do usuário, se houver `mcp:write`; só propor ação com cliente | `AiActionLog` (`source = MCP`, cliente OAuth) + auditoria + log de toda chamada MCP |
| Memória | ninguém — executa na hora | gravar um fato **pessoal** (o de workspace exige admin), barrado pela guarda e visível com desfazer | chip + aba Memória + auditoria `ai_memory` (sem o conteúdo) |

Lida de cima para baixo, a coluna do meio é o que eu queria mostrar: o
estrago possível cresce de degrau em degrau, e em nenhum deles fica sem
dono. Toda linha a partir do Build tem uma decisão humana em algum lugar —
por escrita, por workspace, por ferramenta ou por concessão.

Não tenho números de uso para pôr do lado — quantos workspaces ligaram o
Autopilot, quantas aprovações expiram na inbox. O que é contável hoje é o
registro: 98 ferramentas, 54 de escrita, 10 de exclusão (que o MCP nunca
expõe e os agentes sempre aprovam) e 5 marcadas `customerFacing` (que o MCP
sempre devolve para confirmação).

## Onde quebrou / limitações

**O Autopilot é por workspace, não por pessoa.** Quando o admin liga
`autopilotEnabled`, qualquer membro com modo agente pode usar o Autopilot,
com as próprias permissões. Não dá para ligar só para quem usa o Steel AI o
dia todo, nem para tirar algumas ferramentas do Autopilot ou manter
confirmação só para exclusões. A causa raiz é que a decisão foi modelada como
configuração do workspace (`WorkspaceAiSettings`), não da pessoa; a ADR 0021
lista as três variações como "revisitar se surgir pedido".

**Não existe aprovação em lote.** Um agente que pede aprovação para vinte
ações gera vinte decisões na inbox, uma a uma; a execução só retoma quando
nada mais estiver pendente. Uma execução pode ficar dias em
`WAITING_APPROVAL`. As ADRs 0018 e 0020 deixam o lote como pendência
explícita — e, no limite, aprovação demais produz o mesmo efeito do Build
com muitos cartões: gente aprovando sem ler.

**Ferramentas somem do agente sem aviso.** Como o agente recebe a interseção
da lista dele com o acesso do responsável, se o responsável perder uma
permissão, as ferramentas que dependiam dela somem na próxima execução — e o
editor do agente não avisa. O agente passa a "não conseguir" fazer algo e o
admin só descobre olhando os passos da execução. É o lado ruim de calcular a
interseção em tempo de execução em vez de validar na configuração; a ADR
0020 registra revisitar com um alerta no editor.

**As descrições foram escritas para o nosso prompt e agora servem a modelos
de terceiros.** O MCP herda o registro inteiro, inclusive o texto que
explica cada ferramenta ao modelo. Esse texto nasceu para o system prompt do
Steel AI, que sabe que existe uma tela, um cartão, um chat. Um commit do dia
do lançamento (`947a1cd2`) reescreveu as descrições para serem neutras e o
contrato agora pede isso, mas a causa raiz continua: um texto só atende dois
públicos, e uma ferramenta nova escrita pensando no chat vai para o MCP no
mesmo deploy. Some-se a isso que o texto de terceiros (WhatsApp, e-mail,
chamado) que a ferramenta devolve chega ao modelo do cliente, onde o Steel
não controla prompt nem defesas — por isso `DELETE` ficou de fora e ações
com cliente pedem confirmação.

**O espectro não tem um degrau "Autopilot com rede".** Entre "um clique por
escrita" e "nenhum clique" não existe, hoje, um meio-termo no assistente
(por exemplo, confirmar só o que tem `destructiveHint` ou só o que é
`customerFacing`). O MCP já faz essa divisão por `customerFacing`; o
assistente in-app não.

## O que isso prova, e o que não prova

Prova que autonomia de agente pode ser desenhada como uma sequência de
trocas explícitas — cada modo tira uma trava e diz o que põe no lugar — em
cima de um único registro de ferramentas e de um único caminho de execução,
sem que cada modo vire um sistema à parte. E prova que dá para dizer, modo a
modo, o pior caso de um prompt injetado, porque esse pior caso está escrito
nas ADRs, não deduzido depois.

Não prova que os degraus de cima são seguros. O Autopilot e o MCP com
`mcp:write` aceitam, por decisão de produto, que um prompt injetado escreva
com as permissões do usuário; o que eles garantem é rastro e uma decisão
humana explícita para ligar, não prevenção. Não prova que admins escolhem bem
entre `AUTO` e `APPROVAL`, nem que aprovações na inbox são lidas. E sem dado
de uso, não diz nada sobre qual degrau as pessoas realmente usam.
