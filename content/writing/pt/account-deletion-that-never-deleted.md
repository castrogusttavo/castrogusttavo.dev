---
title: A exclusão de conta que nunca excluiu ninguém
description: "Por quatro meses, a Nexo prometeu apagar a conta 30 dias depois do pedido, e o Postgres recusou toda exclusão de quem já tinha escrito alguma coisa. O job falhava três vezes e morria sem ninguém saber. Isto é a causa raiz (dez chaves estrangeiras obrigatórias sem onDelete), por que escolhi anonimizar em vez de apagar em cascata, como a nulidade subiu do banco até a interface e o que mudou para que um job que sempre falha não pareça mais um job que nunca rodou."
icon: bug
date: "2026-11-17"
---

A Nexo tem um botão de excluir conta. Você clica, confirma, a interface
diz que a conta será apagada em **30 dias**, e durante esse prazo dá para
voltar atrás. Passados os 30 dias, um job na fila `account-lifecycle`
roda e apaga o usuário. É a obrigação de LGPD mais literal que o produto
tem.

Entre o commit que entregou essa feature (`8f0f3be0`, 18/05) e o que a
consertou (`94d044f`, 20/09), esse job **nunca conseguiu apagar ninguém
que tivesse escrito alguma coisa**. Uma issue, um comentário, uma página
de wiki, qualquer atividade registrada, e o Postgres respondia isto:

```
violates foreign key constraint "activities_actor_id_fkey"
```

O job lançava, o BullMQ tentava de novo duas vezes com backoff, desistia e
movia o job para o conjunto de falhas. Ninguém era avisado. Do lado de
quem pediu a exclusão, nada visível: a conta simplesmente continuava lá.

Não achei isso olhando para a exclusão. Achei por acaso, quando o agente
que montava a suíte de Playwright tentou limpar os dados de teste
apagando o usuário criado pela fixture, e bateu nesse erro.

## O problema: o schema decidiu, e ninguém decidiu pelo schema

O processor é curto, e não tem nada errado nele:

```ts
const deleteResult = await UserRepository.deleteHard(userId)
if (!deleteResult.ok) {
  throw new Error(`deleteHard failed: ${deleteResult.error.code}`)
}
```

`deleteHard` é um `prisma.user.delete({ where: { id } })`. O problema
estava um nível abaixo, no `schema.prisma`: **12 relações com `User` não
declaravam `onDelete`**.

| Model | Campo | Obrigatório antes? |
| --- | --- | --- |
| `Project`, `Module`, `Cycle` | `leadId` | sim |
| `Issue`, `Comment`, `IssueUpdate`, `WikiComment` | `authorId` | sim |
| `Activity` | `actorId` | sim |
| `Attachment` | `uploadedById` | sim |
| `WikiPage` | `createdById` | sim |
| `WikiPage` | `updatedById` | não |
| `WikiComment` | `resolvedById` | não |

Sem `onDelete`, o Prisma escolhe por você. Em relação opcional ele usa
`SET NULL`, então `updatedById` e `resolvedById` já se comportavam bem.
Nas **10 obrigatórias**, a migration gerada foi esta:

```sql
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

`RESTRICT` é o default certo para quem não pensou no caso: na dúvida, o
banco recusa. O erro foi não ter pensado no caso. Na prática, **qualquer
usuário que tivesse tocado numa issue jamais poderia ser apagado**, e
isso estava escrito no schema desde o começo, só que como ausência de uma
palavra.

### Por que os testes passavam

Havia teste de `deleteHard`, e ele passava. A fixture criava um usuário,
apagava, e conferia que ele sumiu. Um usuário **sem nenhum conteúdo**. É
o único tipo de usuário que nunca pede exclusão de conta em produção:
quem pede é justamente quem usou o produto.

O teste do processor também passava, porque mockava o repository. Cada
camada estava testada contra a hipótese de que a camada de baixo
funcionava, e a de baixo estava testada com um dado que não existe no
mundo real.

### Por que ninguém viu

As opções padrão da fila são `attempts: 3`, backoff exponencial a partir
de 5 s e `removeOnFail` com idade de **7 dias**. Um job que falha sempre
gasta as três tentativas, vai para o conjunto de falhas e, uma semana
depois, é apagado do Redis. O log de cada tentativa ia para o Axiom, mas
nada olhava para esse log. Escrevi sobre essa fila no post de
[background jobs com BullMQ](/pt/writing/background-jobs-with-bullmq), e
a falta de painel estava lá como lacuna. Eu só não tinha percebido o
tamanho dela.

## A ideia: a LGPD manda apagar o dado pessoal, não o trabalho do time

Consertar a constraint era fácil. Decidir o que acontece com o conteúdo de
quem sai era a parte de verdade. Levantei três caminhos:

| Opção | O que acontece | Por que não (ou por que sim) |
| --- | --- | --- |
| Cascatear | apaga tudo que a pessoa criou | issues, comentários e wiki de um workspace de terceiros somem sem que ninguém do time tenha pedido nada |
| Usuário-lápide | reatribui a autoria a uma conta de sistema | evita a migração de nulidade, mas cria uma linha falsa que toda listagem, contagem e filtro precisa lembrar de esconder |
| **Anonimizar** | o conteúdo fica, a autoria vira `null` | escolhida |

Escolhi anonimizar. Uma issue que alguém abriu, comentou e discutiu com
mais cinco pessoas é trabalho coletivo. Quem sai leva o nome, o e-mail, a
foto, a sessão e as preferências. Não leva junto a história do projeto
dos outros. A LGPD exige que o dado pessoal saia do banco; não exige
destruir o registro do time.

O usuário-lápide foi o que mais me tentou, porque é a opção que menos
mexe no código. Esse foi o motivo para não escolher: ele deixa o
problema escondido. Uma conta "Usuário removido" com id real passa em
todo `!== null`, aparece em lista de membros, conta em métricas. A
nulidade obriga o código a tratar o caso. A lápide deixa cada tela
esquecer dele em silêncio.

## Como funciona: a nulidade subindo do banco até a tela

A migration `20260920201252_anonymize_deleted_user_content` faz três
coisas nas 10 colunas obrigatórias: derruba a FK, tira o `NOT NULL` e
recria a FK com `ON DELETE SET NULL`. As duas que já eram opcionais
ganharam `onDelete: SetNull` explícito no schema, sem mudança no banco,
só para a intenção ficar escrita em vez de herdada do default.

O banco é a parte pequena. O commit mexe em **43 arquivos**, e a maior
parte deles é a nulidade subindo: os tipos (`types/*.d.ts`), os include
types dos repositories, os mappers e a interface.

```ts
// types/issue.d.ts
-  authorId: string
+  authorId: string | null
```

A regra que me impus foi não usar nenhum `!` nem `as string` no caminho.
Se o tipo diz que o autor pode não existir, cada lugar que lê o autor
precisa decidir o que mostrar. Um exemplo de onde isso morde, no fio de
comentários:

```tsx
-  isOwn={comment.author.id === userId}
+  isOwn={!!comment.author && comment.author.id === userId}
```

A versão antiga quebraria a tela inteira no primeiro comentário de alguém
que saiu. Com o tipo nulável, o TypeScript recusou compilar até que cada
um desses pontos fosse tratado.

Os textos de fallback têm um lugar só, `lib/removed-user.ts`:

```ts
export const REMOVED_USER_NAME = 'Usuário removido'
export const NO_LEAD_NAME = 'Sem líder'

export function displayUserName(name?: string | null): string {
  return name?.trim() ? name : REMOVED_USER_NAME
}
```

E os filtros "minhas issues" e "criado por" ganharam guarda explícita de
nulo, em vez de depender de `null !== undefined` dar certo por acidente:

```ts
case 'created-by':
  // A deleted author matches no member id, so `mine` and per-member
  // filters never claim an anonymized issue.
  return issue.authorId ? [issue.authorId] : []
```

### O achado de brinde

A página de membros do projeto liberava a gestão só para quem era lead:
`context.userId === context.project.leadId`. Com o lead apagado, ninguém
mais conseguiria gerenciar aquele projeto pela interface. Só que o service
sempre permitiu `OWNER` e `ADMIN` do workspace; a interface já era **mais
restritiva que a API** antes de qualquer lead sumir. A anonimização só
tornou o defeito inevitável. A página passou a usar o mesmo critério do
service, `isPrivileged || isLead`, que é a regra do post sobre
[autorização em três camadas](/pt/writing/three-layer-authorization): quem
decide é o service, e a tela não deveria inventar uma regra mais apertada
por conta própria.

## Resultados: conferido no banco, não no modelo

A verificação foi feita contra o banco vivo, lendo as constraints do
Postgres, não o `schema.prisma`. O schema diz o que o Prisma *deveria*
gerar; o banco diz o que existe.

| | Antes | Depois |
| --- | --- | --- |
| FKs que apontam para `users` | 30 | 30 |
| `ON DELETE CASCADE` | 18 | 18 |
| `ON DELETE SET NULL` | 2 | 12 |
| `ON DELETE RESTRICT` | **10** | **0** |
| Usuário com conteúdo pode ser apagado | não | sim |

As 18 em cascata são, na maior parte, dados que só fazem sentido com a
pessoa: sessões, contas OAuth, 2FA, preferências, favoritos, participação
em projetos, módulos e ciclos, votos, inscrições, notas e links curtos.
Os convites pendentes que ela enviou também vão junto. E faltava
uma segunda pergunta: alguma dessas 18 tabelas é referenciada por outra
tabela com `RESTRICT`? Se fosse, apagar o usuário cascatearia até ela e
travaria um nível abaixo. Nenhuma é. Não existe bloqueio de segunda
ordem.

O teste que faltava agora existe, e é de integração, contra Postgres de
verdade. Ele semeia um usuário que lidera um projeto e escreveu uma
issue, um comentário, uma página de wiki e uma atividade; apaga o
usuário; e exige que o usuário suma e que os cinco conteúdos sobrevivam
com autoria nula:

```ts
const result = await UserRepository.deleteHard(user.id)

expectOk(result)
expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull()
expect(await prisma.project.findUnique({ where: { id: project.id } }))
  .toMatchObject({ leadId: null })
expect(await prisma.issue.findUnique({ where: { id: issue.id } }))
  .toMatchObject({ authorId: null })
// ...comment, wikiPage, activity
```

O mais importante desse teste não é que ele passa. É que restaurar a
constraint antiga faz ele falhar **com o erro exato de produção**. Isso
foi verificado, não suposto. Um teste de regressão que não falha contra
o bug não é teste de regressão.

## A mesma fila mentia de outros dois jeitos

No começo da tarde do mesmo 20/09, horas antes de achar a FK, a suíte de
componente tinha pegado dois defeitos nessa fila (`220ad51b`):

- **`cancelAccountDeletion` sempre dizia que tinha cancelado.** O
  `remove()` do BullMQ devolve `1` sempre que o job não está travado,
  **exista ele ou não**, e `0` quando um worker segura o lock. Ele não
  lança para job inexistente, então o `catch` que deveria pegar "não havia
  nada para cancelar" nunca rodava. A existência agora é lida com
  `getJob()` antes do `remove()`.
- **Reagendar a exclusão era ignorado em silêncio.** Com `jobId`
  customizado, o BullMQ mantém o primeiro job e descarta o `add()`
  seguinte. Um prazo novo nunca valia. Agora o job pendente é removido
  antes do novo `add()`.

O primeiro defeito eu mesmo descrevi errado. No post sobre BullMQ,
escrevi que o `remove` de um job inexistente "é um no-op, e a função
retorna `false` em vez de lançar". O código assumia exatamente isso, e o
texto repetiu o código. Nenhum dos dois tinha lido o que o BullMQ faz de
fato.

O dano dele era limitado por outra camada: o processor revalida
`deletionScheduledAt` antes de agir, então um job que sobrevivesse a um
cancelamento acharia o campo nulo e terminaria como `skipped`. A mentira
estava na resposta para quem cancelou, não na exclusão.

O detalhe que mais me incomoda é a ordem. Passei o começo daquele dia deixando o
agendamento e o cancelamento "verdadeiros" numa fila cujo único job
falhava para qualquer pessoa que tivesse de fato usado o produto. Nada
nessa fila me dizia isso.

## Onde quebrou: um job que sempre falha é igual a um que nunca rodou

A causa raiz do incidente não é a constraint. A constraint é o sintoma de
duas coisas.

**Primeira: o teste exercitava um caminho que não existe em produção.**
Teste de exclusão com fixture vazia não testa exclusão. Se o objeto tem
relações, a fixture precisa tê-las. Essa virou regra, mas é regra por
disciplina: nada no tipo, no lint ou na CI impede alguém de escrever o
próximo teste de exclusão com um usuário vazio.

**Segunda, e mais grave: falha final de job não fazia barulho.** Esse é o
ponto mais fraco do sistema todo, não só da exclusão. Qualquer job que
morresse depois das três tentativas teria o mesmo destino. A correção
veio no dia seguinte (`8be505a`): quando um job esgota as tentativas, o
worker emite um único `queue.job.exhausted`. Retry que ainda vai
acontecer fica quieto. O nome do evento e os campos são contrato estável,
e o payload passa por uma allowlist (`userId`, `workspaceId`), para que
uma chave nova no dado de algum job nunca vaze para o log por padrão.
Desde 22/09 (`f40974bc`), esse evento também vai para o Slack.

Essa primeira versão do alarme tinha uma premissa errada. O commit dizia
que um job morto por *stall* chegava ao conjunto de falhas sem o worker
emitir `failed`, e listava isso como lacuna. No BullMQ 5.79 é diferente:
o stall check grava uma falha adiada, devolve o job para a fila, e o
próximo worker o derruba com `UnrecoverableError`. O alarme disparava,
mas com o rótulo `unrecoverable`, apontando quem lesse o log para o
problema errado. O `807fa5e` rotula essas mortes como `stalled`,
acrescenta um `QueueEvents` por fila como reserva e deduplica, para que
uma morte vista pelos dois caminhos alarme uma vez só. Ler o código da
dependência instalada valeu mais que a documentação e mais que a minha
memória.

O que continua sem resposta:

- **Não sei quantos pedidos reais falharam.** Com `removeOnFail` de 7
  dias, qualquer job morto antes de 13/09 já tinha sumido do Redis quando
  achei o bug, e não existia alarme para ter registrado a morte. A mesma
  lacuna que escondeu o bug apagou a evidência do tamanho dele.
- **A validação ponta a ponta em produção está pendente.** A migration
  rodou no CD e as 30 FKs foram conferidas no banco, mas
  ainda não agendei a exclusão de uma conta de teste com conteúdo,
  esperei o job rodar e conferi na interface. O teste de integração
  prova o repository contra Postgres; não prova o caminho inteiro, com
  fila, worker e cache.
- **Existe uma corrida estreita que não fechei.** Se o worker já está
  processando o job de exclusão de um usuário, um reagendamento
  simultâneo se perde: o `remove()` devolve `0` por causa do lock e o
  `add()` seguinte é descartado pelo `jobId` repetido. A janela é a
  duração de uma execução do job, e o resultado é a conta ser apagada
  no prazo antigo, que a pessoa já tinha aceitado. Deixei
  anotado em vez de corrigir.
- **"Sem autor" é um estado real, mas não é filtrável.** O filtro "criado
  por" não tem operador "está vazio". Isso é feature, não conserto, e
  ficou fora.

## O que isso prova, e o que não prova

Prova que um usuário com conteúdo agora pode ser apagado: as 30 chaves
estrangeiras para `users` estão em cascata ou `SET NULL` no banco,
nenhuma tabela cascateada trava um nível abaixo, e existe um
teste que falha com o erro original se alguém reintroduzir a constraint.
Prova que anonimizar não é só uma migration: são 43 arquivos, a maioria
tipo e interface, e esse custo é o que obriga cada tela a tratar "sem
autor" em vez de quebrar.

Não prova que a exclusão funciona ponta a ponta em produção; essa
verificação ainda não foi feita. Não prova que nenhum outro job da Nexo
falha calado: prova só que, desde 22/09, quando um falhar de vez, alguém
fica sabendo. E não diz quantas pessoas pediram para sair entre maio e
setembro e continuaram no banco, porque o sistema que deveria guardar
essa resposta foi configurado para esquecê-la em uma semana.
