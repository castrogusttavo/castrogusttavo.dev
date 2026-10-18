---
title: Mutation testing no portão de autorização — 392 mutantes que a cobertura dava como testados
description: "Cravar \"é o lead\" como false no portão de autorização de projeto da Nexo sobreviveu em 64 lugares: nenhum teste do repositório jamais concedeu acesso a alguém por ser o lead. Este post é sobre o que o Stryker achou num backend com 88% de cobertura, a matriz de acesso que levou 392 sobreviventes a zero em 18 serviços, os prazos que nasceriam vencidos sem ninguém notar, como a mutação roda fora do portão do CI, e por que o score caiu de 80,09% para 78,58% sem o portão perceber."
icon: code
date: "2026-11-10"
---

Esta é a checagem de acesso que se repete nos services de projeto da Nexo.
A versão abaixo é do `issue-label.service.ts`:

```ts
const isLead = project.leadId === actorId
const isMember = project.members.some((m) => m.userId === actorId)
if (!membership.isPrivileged && !isLead && !isMember) {
  return err(issueForbidden())
}
```

Três condições, e passar em qualquer uma libera: ser `OWNER` ou `ADMIN`
do workspace, ser o lead do projeto, ou estar na lista de membros. Essas
linhas tinham cobertura, e o backend estava em 88,43% no Codecov. Em 20 de
setembro eu rodei mutation testing pela primeira vez e o Stryker trocou
`isLead` por `false`. O mutante sobreviveu em **64 lugares**. Trocou
`isMember` por `true`: sobreviveu em **47**. Trocou `.some` por `.every`:
sobreviveu em **16**.

Traduzindo: nenhum teste do repositório inteiro jamais concedeu acesso a
alguém **por ser o lead**. E nenhum teste negava acesso de um jeito que
dependesse da lista de membros. O portão estava sem prova nos dois
sentidos, e todos os testes estavam verdes.

O [post sobre autorização em três camadas](/pt/writing/three-layer-authorization)
explica onde essa decisão mora e por que ela mora no service. Este é sobre
como eu descobri que ninguém tinha provado que ela estava certa.

## O que a cobertura diz, e o que ela não diz

Cobertura diz que a linha executou. Mutation testing faz uma pergunta
diferente: se essa linha estivesse sutilmente errada, algum teste ficaria
vermelho? O Stryker gera milhares de versões do código, cada uma com um
defeito pequeno (um `>` virando `>=`, um `true` virando `false`, um corpo
de função esvaziado), e roda os testes contra cada uma. Mutante que faz um
teste falhar está "morto". Mutante que passa por todos é um sobrevivente, e
um sobrevivente é uma mudança de comportamento que a suíte aceitaria em
silêncio.

Os três sobreviventes do portão saem da mesma fixture. Antes da correção,
os testes de `issue-label.service.test.ts` montavam o projeto assim:

```ts
function projectWith(
  overrides?: Partial<ReturnType<typeof createFakeProject>>,
  members: { userId: string }[] = [{ userId: 'actor' }],
) {
  return {
    ...createFakeProject({ id: 'proj-1', leadId: 'lead-1', ...overrides }),
    members,
    favourites: [] as { id: string }[],
  }
}
```

Por padrão, o ator é membro, é o **único** membro, e não é o lead. Todo
teste "permitido" passava pelo braço `isMember`, então `isLead` podia ser
qualquer coisa. E numa lista de um elemento só, `.some` e `.every` dão a
mesma resposta, então o operador também podia ser qualquer um. A fixture
não está errada. Ela é conveniente, e a conveniência escolheu um único
caminho pelo portão pra todos os testes.

## A ideia: cada caso isola um braço

A correção não foi escrever mais testes do mesmo jeito. Foi mudar a forma
do teste: em cada caso "permitido", o **único** motivo pelo qual o ator
entra é o braço sendo testado; em cada caso "negado", a lista de membros
está **povoada**, pra que um `.every` ou um `isMember = true` faça
diferença. E toda negação confere que nada foi escrito, porque um
`forbidden` que já gravou no banco antes de recusar ainda é uma falha de
autorização.

## Como funciona: uma matriz, dezoito services

Isso virou um helper, `src/services/__tests__/_project-access-gate.ts`.
Cada suíte de service declara os métodos protegidos, e o helper roda a
mesma matriz pra cada um:

```ts
export interface GatedMethod {
  name: string
  grants: 'member' | 'lead'
  publicGrants?: boolean
  forbiddenCode: ErrorCode
  arrange: () => void
  call: (actorId: string) => Promise<Result<unknown>>
  /** Repository calls that must never run when the gate says no. */
  sideEffects?: () => unknown[]
}
```

`grants` diz quem passa além de `OWNER`, `ADMIN` e o lead: `member`, pra
leitura e trabalho em issue, ou `lead`, pra configuração do projeto
(estados, labels, ciclos). A matriz:

- o lead que **não** está na lista de membros é admitido;
- `OWNER` e `ADMIN` que não são nem lead nem membro são admitidos;
- um membro entre três é admitido, onde membros podem passar, e negado
  onde só o lead ou um admin podem, mesmo em projeto público;
- quem não está numa lista com dois membros é negado;
- um lead nulo, que é o que sobra quando o usuário lead foi excluído,
  nunca admite ninguém;
- em projeto público, qualquer membro do workspace passa onde `publicGrants`
  diz que passa, e um membro comum não passa onde só o lead pode.

Cada caso negado roda `expectDenied`, que confere o código de erro e que
nenhuma das chamadas de repository listadas em `sideEffects` aconteceu:

```ts
async function expectDenied(method: GatedMethod) {
  expectErr(await method.call(GATE_ACTOR), method.forbiddenCode)
  for (const effect of method.sideEffects?.() ?? []) {
    expect(effect).not.toHaveBeenCalled()
  }
}
```

O commit (`9d7dab3`) aplicou a matriz a 18 services. Rodando o Stryker só
sobre eles, os sobreviventes nas linhas do portão foram de **392 para 0**,
e o score desses arquivos foi de **68,95% para 82,72%**.

O caso do lead nulo merece uma linha. Ele só existe porque, no mesmo fim
de semana, a exclusão de conta passou a anonimizar o conteúdo em vez de
apagar, e um projeto pode ficar sem lead. `project.leadId === actorId` com
`leadId` nulo é falso, então hoje está certo. O teste existe pra que uma
refatoração futura que compare de outro jeito não transforme "sem lead"
em "qualquer um é lead".

## Os outros sobreviventes tinham a mesma doença

O portão era o achado maior, mas não o único, e quase todos os outros
tinham a mesma forma: um teste que existia e conferia a coisa errada.

**Três prazos aceitavam troca de sinal.** A carência de 30 dias da exclusão
de conta, o TTL de 7 dias do convite e a validade do link de exportação de
dados. Em todos, `+` virando `-` sobrevivia. O teste da exclusão de conta
conferia isto:

```ts
expect(typeof value.scheduledAt).toBe('string')
```

O tipo. Uma data 30 dias no passado também é uma string. A versão nova
confere que a data está no futuro e que a distância até ela fica entre a
carência menos um minuto e a carência exata:

```ts
const GRACE_MS = 30 * 24 * 60 * 60 * 1000
const scheduledAt = new Date(value.scheduledAt).getTime()
expect(scheduledAt).toBeGreaterThan(Date.now())
expect(scheduledAt - Date.now()).toBeGreaterThan(GRACE_MS - 60_000)
expect(scheduledAt - Date.now()).toBeLessThanOrEqual(GRACE_MS)
```

Com o sinal trocado, a conta seria agendada pra exclusão 30 dias atrás, ou
seja, agora. O convite e o link nasceriam vencidos.

**Limites de upload com `>` e `>=` intercambiáveis, em cinco lugares.** Todo
teste usava `LIMITE + 1` byte, que é rejeitado pelos dois operadores. Nada
fixava a borda. O teste novo manda um arquivo de exatamente 5 MB e espera
que ele passe, porque o limite é inclusivo.

**Cupom.** Os dois limites de valor são inclusivos de propósito e nenhuma
borda tinha teste, então um cupom de 100% de desconto nunca tinha sido
exercitado. E cupom com limite de resgates só tinha sido testado
**esgotado**: todo outro caso usava o default sem limite, e a comparação
de resgates só tinha sido vista no sentido de recusar.

**Severidade de incidente.** `>` virando `>=` sobrevivia porque nenhum
teste tinha uma sonda reportando a **mesma** severidade de um incidente já
aberto. Com `>=`, a timeline pública da página de status ganharia uma
entrada "severidade atualizada" a cada coleta.

**O uptime de 90 dias da página de status podia virar uma função vazia**, e
nada ficava vermelho: nenhum teste lia o número. E a poda dos health checks
brutos aceitava o corte invertido pro **futuro**, o que apagaria todos os
checks.

**A derivação do identificador de projeto não era verificada em nada.** O
`toUpperCase`, o filtro de caracteres e o corte em 6 podiam ser invertidos
sem falhar teste nenhum.

É a mesma lição do teste cúmplice do frontend, que tem
[post próprio](/pt/writing/98-percent-coverage-dead-kanban): comparação
testada num sentido só, borda nunca exercitada, asserção sobre o tipo em
vez do valor.

## Como o Stryker roda

A configuração está em `stryker.config.mjs`, em `.mjs` pra poder comentar
cada escolha, e quase todas as escolhas precisaram de comentário.

**Um config de Vitest só pro Stryker.** O runner de Vitest do Stryker não
tem `--project`: ele sobe o Vitest com um arquivo de config e roda todo
project que achar. Apontar pro `vite.config.ts` arrastaria integração, e2e
e componente, que precisam de Postgres, Redis e um servidor rodando, pra
cada um dos milhares de mutantes. O `vitest.stryker.config.ts` é o project
`unit` achatado num config de project único, com um comentário pedindo pra
manter os dois em sincronia.

**A armadilha do pnpm.** A descoberta de plugins do Stryker procura em
`node_modules/@stryker-mutator/*` e não segue os symlinks do pnpm. Sem
`plugins: ['@stryker-mutator/vitest-runner']` explícito, ele diz que nenhum
test runner foi carregado, com o runner instalado.

**O que fica de fora, e o que fica dentro de propósito.** O mutador
`StringLiteral` está desligado: quase toda string nesse escopo é nome de
evento de log, nome de ação de auditoria ou mensagem em português, e
deixá-lo ligado produzia centenas de mutantes impossíveis de matar
afogando os achados reais. O comportamento que *é* carregado por string,
como códigos de erro, nomes de fila e chaves de DTO, mora em objetos
`as const`, que continuam mutados como `ObjectLiteral`. E o `ObjectLiteral`
ficou **ligado**, mesmo com cerca de 250 sobreviventes que são payloads de
`auditMutation` e `logger` sendo esvaziados, ruído na mesma família das
strings. O mesmo mutador esvazia o argumento de `Repository.create({...})`
e o `where` de um `findMany`, e ali um sobrevivente é buraco de verdade.
Desligar esconderia os dois. O ruído fica precificado no threshold.

**`ignoreStatic: true`.** Inicialização de módulo roda uma vez por worker,
então um mutante numa tabela de constantes no topo do arquivo exigiria
recarregar o ambiente inteiro pra cada um. Ignorar mantém a execução
tratável, ao custo de não mutar tabelas como o registro de códigos de erro.

**Semanal, fora do portão do CI.** O workflow roda às segundas, 04:00 UTC,
e sob demanda. O `cd.yml` dispara a partir de um CI verde, então colocar a
mutação no portão atrasaria todo deploy por uma métrica que se move
devagar. Uma correção de número: o commit original fala em 25 minutos, que
era a estimativa na minha máquina. No runner self-hosted, as execuções
completas levaram entre **10min37s e 12min36s**. Continua sendo mais que o
pipeline inteiro de CI, e o argumento se mantém.

## Os números

| Data | Execução | Score | `break` |
| --- | --- | --- | --- |
| 20/09 | primeira medição, local | 70,34% | — |
| 20/09 | depois dos primeiros testes de borda | 72,35% | 70 |
| 21/09 | primeira no CI, disparada à mão | falhou antes de começar | 70 |
| 21/09 | segunda no CI, depois da matriz | 80,09% | 70 → 77 |
| 26/09 | sob demanda | 79,91% | 77 |
| 28/09 | agendada | 78,60% | 77 |
| 05/10 | agendada | 78,58% | 77 |
| 12/10 | agendada | 78,58% | 77 |

A primeira execução no CI morreu no `prisma generate`, antes de o Stryker
sequer começar: o `prisma.config.ts` exige `DATABASE_URL` até pra gerar o
client, que nunca conecta em banco nenhum. O workflow agora define uma URL
que só precisa existir (`494749c`). O agendamento das 04:00 ainda não tinha
disparado quando eu rodei à mão; se eu tivesse esperado, ele falharia toda
segunda, num workflow que não bloqueia nada, sem ninguém olhar.

A segunda passou com 80,09%, e o `break` subiu de 70 pra 77 no mesmo dia
(`10ee219`). Com o limite em 70, o score poderia cair dez pontos sem
falhar nada, e um limite muito abaixo do score não protege coisa nenhuma.
O `break` fica uns três pontos abaixo do medido de propósito: alguns
mutantes mudam de veredito entre execuções, e o portão não deve tropeçar
neles.

## Onde quebrou

**O score caiu 1,5 ponto e o portão não percebeu.** De 80,09% em 21 de
setembro pra 78,58% em 5 e 12 de outubro, sempre acima do `break` de 77.
Uma parte é código novo: entre 21 e 26 de setembro entraram quatro arquivos
e cerca de 420 mutantes testados a mais. A outra parte é estranha. Na
execução de 28 de setembro, `src/errors/app-error.ts` foi de 100% (8
mutantes, todos mortos) para **8,33%**, com 88 sobreviventes novos.
Mutantes testados subiram de 5.759 pra 5.854 com só 2 mutantes
instrumentados a mais, o que indica que 88 mutantes que o `ignoreStatic`
descartava passaram a ser testados. Pra cada um deles o log diz "Ran all
tests for this mutant", e todos sobreviveram, inclusive
`appError = () => undefined`, que derrubaria qualquer teste que confira um
código de erro se estivesse ativo de verdade. Minha leitura é que são falsos sobreviventes: mutantes
estáticos rodados sem recarregar o módulo, que nunca chegam a ser ativados.
Não confirmei, e não sei o que mudou a classificação deles; o único commit
nesse intervalo que tocou `src/errors` só adicionou uma função de erro
nova. Tirando esses 88, o score de 28 de setembro seria 79,80%, praticamente
igual ao de dois dias antes. Mas o que importa é que um diretório inteiro
foi de 100% pra 8% e o único sinal foi um número global que continuou
acima do limite. Um threshold global não enxerga uma regressão local, e
três execuções semanais passaram verdes por cima disso.

**O pulo de 72,35% pra 80,09% não é todo da matriz.** As duas medições
vieram de máquinas diferentes, com contagens de mutantes diferentes (5.269
na primeira local, 5.335 testados no CI), e entre elas entraram outros
commits com testes de backend. O número que eu atribuo à matriz com
segurança é o escopado: 392 sobreviventes pra 0 nas linhas do portão, e
68,95% pra 82,72% nos 18 services.

**O portão foi testado, não refatorado.** O commit da matriz diz isso com
todas as letras: a checagem continuava repetida em linha, "umas 75
vezes" segundo a mensagem. Um `grep` por `const isLead` nos services conta
82 ocorrências em 18 arquivos, tanto naquele commit quanto hoje. Um service novo que copie a checagem não ganha a matriz sozinho;
alguém precisa lembrar de chamar `describeProjectAccessGate`, e esse
alguém sou eu. Extrair a checagem pra uma função única resolveria as duas
coisas, e eu ainda não fiz.

**O ruído é permanente.** Os cerca de 250 sobreviventes de payload de
auditoria ficam no relatório toda semana, e quem lê precisa saber
pular eles e perseguir os de argumento de repository. É uma escolha, e ela
tem o custo de deixar o relatório mais difícil de ler do que precisaria.

## O que isso prova, e o que não prova

Prova que cobertura alta e autorização provada são coisas diferentes: as
linhas do portão estavam cobertas e nenhum teste distinguia o código certo
de três versões erradas dele. Prova também que o defeito estava na fixture
e não no volume de testes, e que mudar a forma do teste (um braço por caso,
lista povoada na negação, conferir que nada foi escrito) levou 392
sobreviventes a zero.

Não prova que a autorização da Nexo está correta. Prova que, nos 18
services que usam o helper, as três condições do portão de projeto são
distinguidas pelos testes. A autorização por papel do workspace, a de
recursos pessoais e qualquer service que não chame o helper estão fora
dessa afirmação.

E não prova que o score é confiável como alarme. Ele caiu um ponto e meio,
um diretório foi de 100% pra 8%, e o `break` não disparou. O número que eu
chamei de mais honesto no [post de arquitetura](/pt/writing/nexo-architecture) continua sendo o mais
honesto que eu tenho, mas ele precisa de alguém lendo o relatório por
diretório, não só olhando se o workflow ficou verde.
