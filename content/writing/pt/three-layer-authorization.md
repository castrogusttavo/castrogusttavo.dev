---
title: Autorização em três camadas — onde a Nexo decide quem pode o quê
description: "O middleware da Nexo sabe dizer se uma request tem uma sessão. Não sabe dizer se essa sessão pode fazer o que está pedindo — e essa separação é proposital, não uma lacuna. Isto é como a autorização se divide em três camadas com responsabilidades estritas: edge gate, resolução de sessão e a decisão real, que mora só no service — nunca na rota, nunca no middleware."
icon: code
date: "2026-08-29"
---

O middleware da Nexo (`proxy.ts`) sabe responder uma pergunta só: essa
request tem cookie de sessão? Não sabe, e não tenta saber, se o dono dessa
sessão pode fazer o que está pedindo. Um usuário autenticado sem nenhuma
permissão passa pelo middleware exatamente igual a um `OWNER` de workspace —
a diferença só aparece depois, no service.

```ts
const sessionToken =
  request.cookies.get('better-auth.session_token')?.value ||
  request.cookies.get('__Secure-better-auth.session_token')?.value

if (!sessionToken) {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, statusCode: 401, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    )
  }
  const redirectTo = encodeURIComponent(pathname + request.nextUrl.search)
  return NextResponse.redirect(new URL(`/sign-in?redirect=${redirectTo}`, request.url))
}
```

Isso não é uma implementação incompleta — é a fronteira certa pra esse
código morar. Autenticação (quem é) e autorização (o que pode) são
perguntas diferentes, respondidas em lugares diferentes, de propósito.

## O problema: middleware que decide demais vira gargalo de manutenção

A tentação de colocar autorização no middleware é real — é um lugar só, roda
antes de tudo, parece o ponto certo pra centralizar regra. O problema
aparece na prática: middleware não tem contexto de negócio. Ele não sabe se
o recurso que a request está tentando tocar pertence ao usuário, nem qual é
o `role` dele *naquele workspace específico* — isso exige consultar o banco,
e cada consulta a mais no middleware é latência que toda request paga, até
as que nem precisavam da checagem.

O oposto também quebra: autorização espalhada em cada rota, decidida ad-hoc,
produz inconsistência — uma rota lembra de checar ownership, outra esquece,
e não existe um lugar único pra auditar "toda checagem de permissão do
sistema".

## A ideia: três camadas, três responsabilidades, sem sobreposição

**Camada 0 — edge gate** (`proxy.ts`): existe cookie de sessão? Rota
privada sem cookie vira 401 (`/api/*`) ou redirect pra `/sign-in`. Só
verifica *presença*, nunca permissão. Rotas públicas (`/`, `/sign-in`,
`/api/status`, `/pricing`, `/careers`, entre outras, numa allowlist
explícita) pulam a checagem inteira.

**Camada 1 — sessão** (`getAuthSession()`): resolve o `actorId` a partir do
cookie, como `Result`. Toda decisão de autorização parte desse id — nada
antes disso sabe quem é o ator.

**Camada 2 — service**: a decisão real, e só aqui. Dois padrões distintos
convivem:

```ts
// Ownership — recurso pessoal (sticky-note, short-link)
if (resource.userId !== actorId) return err(forbidden())

// RBAC — recurso de workspace (Membership.role)
if (membership.role !== 'OWNER') {
  auditMutation({
    entity: 'workspace', action: 'delete', actorId,
    targetId: workspaceId, outcome: 'failure', reason: 'insufficient_role',
  })
  return err(forbidden('Apenas OWNER pode excluir'))
}
```

Ownership é a pergunta mais simples: o recurso é seu? RBAC é mais rica:
qual o seu papel *neste workspace* — `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`,
hierarquia decrescente de poder, um único `OWNER` por workspace por regra de
negócio, não por constraint de banco.

## Resultados: zero autorização fora do service

A divisão é limpa o bastante pra virar regra testável: **zero lógica de
permissão no middleware, zero lógica de permissão na rota** — a rota só
resolve identidade (`getAuthSession`) e repassa pro service, que é onde
100% das decisões de "pode ou não pode" acontecem. Isso significa que
auditar autorização é auditar um conjunto finito e conhecido de arquivos —
os services — não a superfície inteira de rotas.

## Onde quebrou: allowlist manual e string matching de prefixo

`PUBLIC_ROUTES` é um array mantido à mão. Esquecer de adicionar uma rota
nova nessa lista falha fechado — vira 401/redirect por padrão, o lado seguro
do erro. Mas o inverso também é possível: `pathname.startsWith(`${route}/`)`
casa qualquer sub-rota por prefixo, então uma entrada pensada pra liberar
`/docs` também libera qualquer coisa sob `/docs/o-que-for` — nunca vazou uma
rota privada por isso até hoje, mas o mecanismo depende de quem escreve a
lista pensar nesse efeito colateral, não é impedido pelo tipo.

Segunda lacuna: o modelo de RBAC tem só quatro papéis fixos. Não existe
permissão granular por ação (por exemplo, "pode editar issue mas não pode
convidar membro") — quem precisa de nuance maior que
`OWNER`/`ADMIN`/`MEMBER`/`VIEWER` não tem onde encaixar isso hoje.

## O que isso prova, e o que não prova

Prova que autorização decidida em um lugar só (o service) é auditável de um
jeito que autorização espalhada nunca é — e que separar "tem sessão" de
"pode fazer isso" evita que o middleware vire um gargalo de contexto que ele
não tem como ter. Não prova que a allowlist de rotas públicas é à prova de
erro — é uma lista mantida por disciplina, não por tipo. Não prova que
quatro papéis fixos escalam pra qualquer necessidade de permissão futura —
hoje escalam pro que a Nexo precisa, não pra qualquer coisa que um cliente
maior possa pedir.
