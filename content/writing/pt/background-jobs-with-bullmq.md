---
title: Fila de verdade — o que decidi tirar do request e virar job assíncrono
description: "O job que reverte trial vencido roda de hora em hora, não uma vez por dia como o resto da limpeza — o que significa que um workspace pode continuar com plano pago por até uma hora depois do trial acabar, de propósito. Essa cadência é o resumo de como a Nexo decide o que sai do ciclo de request e vira job assíncrono via BullMQ: filas tipadas, um worker que roda como processo Node separado do Next, e idempotência desenhada job a job, não genérica."
icon: terminal
date: "2026-08-29"
---

Na Nexo, o job que reverte um trial vencido roda **de hora em hora**
(`0 * * * *`, UTC). O resto da limpeza de dados — sessão expirada, convite
vencido, verificação de e-mail velha — roda **uma vez por dia**
(`0 3 * * *`). Não é inconsistência: é uma decisão de negócio embutida
numa expressão cron. Um trial que vence às 14h05 só é revertido às 15h00 —
até lá, o workspace continua com `activePlan` de plano pago, mesmo sem
assinatura. Até uma hora de acesso pago de graça, todo trial, de propósito,
porque a cadência mais apertada custa mais e o risco de uma hora extra é
aceitável.

Essa é a pergunta que qualquer sistema de background jobs obriga a
responder: com que frequência importa? A resposta não é igual pra tudo, e a
Nexo trata isso como decisão explícita por fila, não como um único cron
genérico.

## O problema: assíncrono no processo errado não sobrevive a nada

A forma mais simples de "fazer isso depois" é um `setTimeout` dentro do
próprio processo Next, ou disparar o trabalho e não esperar a resposta.
Funciona até o processo reiniciar — um deploy, um crash, um restart de
container — e o trabalho agendado simplesmente some, sem log, sem retry,
sem ninguém saber que devia ter acontecido. Pior ainda pra tarefas
recorrentes: com múltiplas instâncias do app rodando (qualquer deploy
horizontal), cada instância dispararia o próprio cron interno, duplicando
o trabalho.

## A ideia: comandos tipados numa fila, consumidos por um processo dedicado

Cada job é um comando — nome + payload — definido em tipos antes de existir
em runtime:

```ts
// src/lib/queue/jobs.ts
export const QueueName = {
  DataRetention: 'data-retention',
  AccountLifecycle: 'account-lifecycle',
  DataExport: 'data-export',
  TrialLifecycle: 'trial-lifecycle',
} as const

export const AccountLifecycleJob = { DeleteAccount: 'delete-account' } as const
export type AccountLifecycleJobPayload = {
  [AccountLifecycleJob.DeleteAccount]: { userId: string }
}
```

`Queue`/`Worker` são tipados com esses payloads — `queue.add(name, data)`
valida `data` em tempo de compilação, não existe string solta decidindo o
que um job recebe.

## Como funciona: quatro filas, um worker fora do Next

`queues.ts` expõe um getter lazy por fila, com opções padrão compartilhadas:

```ts
const defaultJobOptions = {
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 }, // 24h ou 1000 jobs
  removeOnFail: { age: 60 * 60 * 24 * 7 },               // 7 dias
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },         // 5s, 10s, 20s
} as const
```

Enfileirar a exclusão de uma conta usa um `jobId` determinístico:

```ts
// delete-account-<userId>, sem ':' — BullMQ usa ':' como separador de
// chave Redis, então o hífen é obrigatório, não estético
queue.add(AccountLifecycleJob.DeleteAccount, { userId }, {
  delay: Math.max(0, scheduledAt.getTime() - Date.now()),
  jobId: `delete-account-${userId}`,
})
```

Isso dá cancelamento de graça: `cancelAccountDeletion(userId)` chama
`queue.remove(jobId)` — se o job não existe mais (porque já rodou, ou nunca
existiu), o remove é um no-op, e a função retorna `false` em vez de lançar.
Cancelar uma exclusão de conta que ninguém agendou não é erro, é
idempotente por construção.

O consumidor não roda dentro do Next. É um processo Node próprio
(`worker/index.ts`) que importa services e repositories diretamente — os
mesmos módulos que a rota HTTP usa. Como esses módulos importam
`'server-only'`, e isso não existe fora do runtime do Next, o build do
worker faz um alias pra um shim vazio:

```jsonc
"worker:build": "esbuild worker/index.ts --bundle --platform=node --target=node20 \
                  --alias:server-only=./worker/server-only.shim.ts \
                  --outfile=dist/worker.cjs \
                  --external:argon2 --external:@prisma/client --external:.prisma/client"
```

`server-only.shim.ts` é literalmente `export {}`. `argon2` (binário nativo)
e o client do Prisma ficam `--external` porque não são bundláveis. Existe
um pipeline de build inteiro só pra reusar a camada de serviço da Nexo num
processo que o Next nunca vê.

Cada processor faz `switch (job.name)` e lança em job desconhecido — o que
o BullMQ conta como falha e aplica o backoff normalmente:

```ts
export async function processDataRetention(job: Job): Promise<CleanupResult> {
  switch (job.name) {
    case DataRetentionJob.CleanupExpiredSessions: { /* ... */ }
    case DataRetentionJob.ExpireStaleInvitations: { /* ... */ }
    // ...
    default:
      throw new Error(`Unknown data-retention job: ${job.name}`)
  }
}
```

## Resultados: quatro filas, idempotência desenhada por job, não genérica

| Fila | Cadência | Idempotência |
| --- | --- | --- |
| `data-retention` | diária, `0 3 * * *` | naturalmente idempotente — delete/update por cutoff, reexecutar sobre o mesmo cutoff não afeta linhas já processadas |
| `account-lifecycle` | sob demanda, com delay | `delete-account` revalida estado antes de agir — user sumiu ou cancelamento já feito viram `skipped`, não erro |
| `data-export` | sob demanda | `key = <userId>/<jobId>.json` — reexecutar o mesmo job sobrescreve o mesmo objeto, nunca duplica |
| `trial-lifecycle` | de hora em hora, `0 * * * *` | idempotente pelo mesmo motivo do data-retention — o `where` já exclui quem não está mais elegível |

`upsertJobScheduler` — usado pelos dois schedulers recorrentes — é
idempotente por si só: rodar no boot do worker toda vez não duplica o
agendamento, então reiniciar o worker com frequência nunca multiplica jobs
repetidos.

## Onde quebrou: o que fica sem rede de segurança

Três lacunas reais, não hipotéticas:

- **A janela de uma hora do trial é uma escolha, não um bug — mas ainda é
  uma janela.** Um workspace pode ficar até 60 minutos com plano pago sem
  pagar por ele. Aceito porque o custo de apertar a cadência (mais jobs,
  mais carga) supera o risco de uma hora de acesso indevido — mas é uma
  troca explícita, não uma garantia de precisão.
- **Não existe Bull Board em produção.** Sem dependência `@bull-board`, sem
  serviço, sem UI — inspecionar o estado de uma fila hoje é ler logs do
  Axiom ou consultar o Redis direto. Está marcado como roadmap, não como
  decisão final.
- **Job com nome desconhecido gasta o orçamento de retry inteiro.** O
  processor lança em `default`, e o BullMQ trata isso como qualquer outra
  falha — três tentativas com backoff exponencial (5s, 10s, 20s) antes de
  ir pro `removeOnFail`. Um erro de nome de job nunca vai ter sucesso na
  segunda tentativa, mas o sistema não sabe disso e paga o custo completo
  do retry mesmo assim.

## O que isso prova, e o que não prova

Prova que trabalho assíncrono sobrevive a restart, tem retry com backoff de
graça, e não duplica em jobs recorrentes mesmo reiniciando o worker toda
hora. Prova que idempotência não precisa ser genérica pra ser real — cada
job tem a própria estratégia, desenhada pro que ele faz. Não prova que a
operação é observável o bastante em produção — sem painel de fila, o
diagnóstico depende de log. Não prova precisão de horário nas reversões
sensíveis a tempo — o trial-lifecycle aceita até uma hora de atraso porque
essa foi a troca escolhida, não porque o sistema garante melhor que isso.
