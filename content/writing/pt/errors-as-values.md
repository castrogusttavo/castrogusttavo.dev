---
title: Erros como valores — por que quase nada na Nexo usa `throw`
description: "Um repository engolia o erro do Prisma e devolvia só um DATABASE_ERROR opaco — a causa real nunca chegava ao log. Esse bug é o motivo pelo qual a Nexo trata erro como valor de retorno, não como exceção: um tipo Result<T, AppError> que atravessa repository → service → rota sem nunca lançar, e um único ponto de fronteira que traduz isso pra HTTP. Isto é como funciona, onde a disciplina falhou uma vez, e por que `throw` ainda é aceitável em três casos específicos."
icon: code
date: "2026-08-29"
---

Em algum commit anterior da Nexo, um repository fazia isto:

```ts
} catch (error) {
  return err(databaseError())
}
```

Sem logar `error`. A causa real da falha — timeout de conexão, constraint
violada, sintaxe de query quebrada — desaparecia no `catch`, e o que sobrava
no log era só `DATABASE_ERROR`, sempre a mesma string, pra qualquer coisa que
desse errado no Postgres. Descobrir *por que* uma query falhou virava
adivinhação.

O helper que existe hoje pra fechar esse buraco (`repositories/db-error.ts`)
carrega esse histórico no próprio comentário:

```ts
/**
 * Logs the underlying failure and returns a DATABASE_ERROR AppError.
 *
 * Repositories previously swallowed the Prisma error, so a failed query
 * surfaced only as an opaque DATABASE_ERROR. Route every repository catch
 * through this helper so the real cause is always logged.
 */
export function dbError(message: string, cause: unknown): AppError {
  logger.error('repository.database_error', {
    message,
    cause: cause instanceof Error ? cause.message : String(cause),
  })
  return databaseError(message)
}
```

Isso não é um exemplo hipotético de manual de boas práticas — é um bug real
que já aconteceu no meu próprio código, documentado no comentário de quem
consertou. E é o motivo mais concreto que tenho pra explicar por que a Nexo
trata erro como **valor de retorno**, não como exceção, em quase toda a
stack.

## O problema: `throw` esconde a causa até alguém ir procurar

`throw` como controle de fluxo tem um custo que só aparece depois: quem
chama uma função não sabe, olhando a assinatura dela, que ela pode falhar —
e quando falha, o erro sobe pilha acima até alguém pegar (ou até virar um
500 genérico), carregando só o que o `catch` mais próximo decidiu preservar.
Se esse `catch` for descuidado — como no exemplo acima — a causa real vira
uma string fixa, e o próximo passo de debug é reproduzir o bug de novo,
torcendo pra capturar mais contexto dessa vez.

O segundo problema é no outro lado da stack: o frontend. Sem um tipo de erro
discriminado, cada chamada de API vira um `try/catch` genérico inspecionando
`error.message` com string matching pra decidir o que mostrar pro usuário —
frágil, porque a mensagem é texto livre em PT-BR pensado pra debug, não um
contrato.

## A ideia: erro é um valor, não uma exceção

```ts
// src/lib/result.ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
```

`AppError` é um objeto imutável com um `code` de uma taxonomia fechada
(`UNAUTHORIZED`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, `DATABASE_ERROR`
etc.), uma mensagem e `details` opcional — sem stack trace, porque não é
pensado pra debug de exceção, é pensado pra virar resposta HTTP. A regra é
simples de enunciar e difícil de manter: **erro sobe como `Result.err` por
toda a stack até o handler da rota. Nunca como `throw`.**

## Como funciona: repository → service → rota, sem nenhum `throw` no meio

Repository devolve `Result`, nunca deixa o erro do Prisma escapar cru:

```ts
export const findBySlug = async (slug: string): Promise<Result<Workspace>> => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { slug } })
    if (!ws) return err(notFound('Workspace'))
    return ok(ws)
  } catch (error) {
    return err(databaseError(error instanceof Error ? error.message : undefined))
  }
}
```

Service propaga o erro do repository sem embrulhar de novo, e adiciona as
próprias regras de negócio como novos `err(...)`:

```ts
export const get = async (userId: string, slug: string) => {
  const wsResult = await WorkspaceRepository.findBySlug(slug)
  if (!wsResult.ok) return wsResult // propaga o AppError do repo

  const membership = await MembershipRepository.findFor(userId, wsResult.value.id)
  if (!membership.ok) return err(forbidden('not_a_member'))

  return ok(wsResult.value)
}
```

E só a rota — a fronteira com HTTP — sabe traduzir `AppError` em
`NextResponse`:

```ts
export const GET = withAxiom(async (req, { params }) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const result = await WorkspaceService.get(auth.value.user.id, params.slug)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
```

`handleError` é o único ponto do código que conhece a tabela `code → status
HTTP`:

| Classe | Codes | Status |
| --- | --- | --- |
| Auth | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | 401 |
| Authz | `FORBIDDEN` | 403 |
| Client | `BAD_REQUEST` | 400 |
| Client | `RESOURCE_NOT_FOUND` | 404 |
| Client | `CONFLICT` | 409 |
| Client | `VALIDATION_ERROR` | 422 |
| Throttle | `RATE_LIMITED` | 429 |
| Server | `DATABASE_ERROR` | 500 |

O frontend olha só `error.code` pra decidir comportamento — nunca faz
parsing de `message`, que é texto livre em PT-BR voltado a quem lê o JSON
pra debug, não um contrato de máquina.

`throw` continua legítimo em três situações específicas, não banido por
completo:

1. **Adaptadores externos** (SDK do Resend, AWS SDK) podem lançar — o
   boundary do nosso código (service ou repository) captura e converte em
   `AppError` antes de deixar subir.
2. **`'server-only'`** detectando uso indevido em client — é erro de build,
   não de runtime, deixa lançar.
3. **Programador errado** (switch sem `default`, invariante violada) —
   `throw new Error(...)` vira 500 via `withAxiom`, de propósito: não é um
   `AppError` porque não é um erro de negócio, é um bug.

## Resultados: cobertura real, migração incompleta

O padrão está em ~30 repositories e ~20 mappers hoje, todos seguindo o mesmo
formato. Mas a rota — onde tudo converge — ainda tem três estilos
convivendo: o manual (`session → rate-limit → parse → service → response`
escrito à mão) domina **~40 das 42 rotas**; dois wrappers mais novos
(`withAuthenticatedRoute`/`withValidatedBody`) condensam essa sequência,
mas foram adotados só em `short-links` e `sticky-notes`, e só nos métodos
`GET`/`POST` — os `PATCH`/`DELETE` desses mesmos domínios continuam manuais.
Não é uma migração terminada, é uma em andamento.

## Onde quebrou: o antipadrão que eu mesmo cometi

A seção mais honesta deste post é a que já apareceu no início: **eu mesmo
escrevi o `catch` que engolia o erro do Prisma.** `dbError()` existe porque
alguém — eu, num commit anterior — violou a própria regra que este post
descreve, e o comentário no código é a prova disso, deixado de propósito
pra ninguém repetir.

Outros pontos fracos, reais, não hipotéticos:

- **`Result` não compõe.** Cada passo precisa do `if (!result.ok) return
  result` manual — não existe `.map`/`.andThen` como em `neverthrow` ou
  `fp-ts`. Escolha deliberada por simplicidade (zero dependência, zero
  curva de aprendizado pra quem nunca viu Either), mas custa verbosidade —
  uma cadeia de 5 chamadas é 5 guard clauses repetidas.
- **`details` com PII é regra de disciplina, não de tipo.** O antipadrão
  documentado é "não colocar e-mail, ID de sessão, payload bruto em
  `details`" — mas nada no compilador impede alguém de colocar. Depende de
  quem escreve o `AppError` lembrar.
- **A migração dos wrappers de rota parou na metade.** `withAuthenticatedRoute`
  existe há tempo suficiente pra virar padrão, mas 40 de 42 rotas ainda são
  manuais — o custo de reescrever rota por rota nunca foi maior que
  qualquer outra prioridade até agora.

## O que isso prova, e o que não prova

Prova que um erro de negócio na Nexo nunca vira um 500 opaco sem `code` —
todo caminho de falha relevante (autorização, conflito, banco) carrega uma
categoria fechada até o cliente, e o bug que motivou este post já foi
corrigido e documentado pra não se repetir. Não prova que `throw` sumiu do
código — continua existindo, de propósito, nos três casos listados acima.
Não prova que a migração para os wrappers de rota mais novos terminou —
40 de 42 rotas ainda escrevem a sequência manual, e não há prazo definido
pra isso mudar.
