---
title: Como responder "quem fez o quê" depois do fato — audit logging estruturado com Axiom
description: "auditMutation aceita só 24 tipos de entidade e um outcome binário — não dá pra logar 'meio que funcionou'. É essa restrição, não a ausência dela, que faz a trilha de auditoria da Nexo ser útil seis meses depois de escrita. Isto é como os dois esquemas fechados de evento — mutação e autenticação — viram consulta confiável no Axiom, e o ponto onde a disciplina, não o tipo, é o que garante que uma falha não fica sem registro."
icon: book
date: "2026-08-29"
---

`auditMutation`, a função que registra uma mudança de estado na Nexo, só
aceita 24 tipos de entidade (`user`, `workspace`, `subscription`, `issue`
e outras 20) e um `outcome` binário: `success` ou `failure`. Não dá pra
logar "meio que funcionou" nem inventar um tipo de entidade novo na hora —
o TypeScript recusa. Essa restrição é o ponto central: um log estruturado
só é útil meses depois se a estrutura foi decidida com antecedência, não
descoberta enquanto se escreve o `console.log`.

## O problema: log ad-hoc não sobrevive a "o que aconteceu aqui?"

`console.log` ou `logger.info` sem schema comum é rápido de escrever e
inútil de consultar depois. Cada call site inventa o próprio formato — um
loga `{ userId, action }`, outro loga uma string livre — e a pergunta "quem
excluiu esse workspace, e teve sucesso?" vira busca de texto em vez de
query estruturada. Pior: nada obriga logar a **falha** de uma ação
protegida, só o sucesso costuma ser lembrado, porque é o caminho mais
testado.

## A ideia: dois esquemas fechados, tipados, obrigatórios nas rotas

```ts
type AuditEntity = 'user' | 'workspace' | 'subscription' | 'issue' | /* + 20 outras */
type AuditAction = 'create' | 'update' | 'delete' | 'export_completed' | /* + ~16 outras */
type AuditOutcome = 'success' | 'failure'

type AuditAuthEvent =
  | 'user.created' | 'session.created' | 'auth.sign_in.success'
  | 'auth.sign_in.failure' | 'auth.2fa_enabled' | /* + outras */
```

Dois formatos de evento, cada um com seu propósito: `audit.mutation.<entity>.<action>`
pra mudança de estado num recurso, `audit.auth.<event>` pra eventos do
ciclo de autenticação em si (login, 2FA, sessão). O primeiro sempre carrega
`actorId`, `outcome`, e opcionalmente `reason`; o segundo é uma lista fixa
de nomes de evento, sem essa estrutura genérica — porque autenticação tem
vocabulário próprio, "criar workspace" e "fazer login" não são a mesma
forma de evento.

Todo esse logging passa por um wrapper único:

```ts
export const withAxiom = createAxiomRouteHandler(logger)
```

Uma linha, aplicada em toda rota — não é uma convenção que cada rota
lembra de seguir, é o handler em si que já sai instrumentado.

## Como funciona: falha também é evento, não exceção ao registro

```ts
if (membership.role !== 'OWNER') {
  auditMutation({
    entity: 'workspace',
    action: 'delete',
    actorId: userId,
    targetId: workspaceId,
    outcome: 'failure',
    reason: 'insufficient_role',
  })
  return err(forbidden('Apenas OWNER pode excluir'))
}
```

A regra é registrar sucesso **e** falha em toda mutação que passa por
checagem de autorização — não só o caminho feliz. `reason` é uma
convenção de string curta em snake_case (`not_a_member`,
`insufficient_role`, `email_conflict`) — não é `error.message`, é a chave
de classificação pensada pra virar filtro de query no Axiom, não texto pra
humano ler.

Retenção operacional: 365 dias — o mínimo exigido por SOC2 CC7.2, não um
número escolhido por conveniência de custo de armazenamento.

## Resultados: 24 entidades, ~20 ações, dois caminhos sempre cobertos

A cobertura hoje é de 24 tipos de entidade e cerca de 20 tipos de ação,
todos tipados — adicionar um evento novo é editar um union type, não
inventar uma string nova em algum lugar do código e torcer pra ninguém
digitar diferente da próxima vez. Cada mutação protegida por autorização
tem, por convenção, os dois branches (sucesso e falha) emitindo evento —
não é uma cobertura parcial documentada como aspiração, é a forma padrão de
escrever esse tipo de código na Nexo.

## Onde quebrou: a disciplina de auditar falha não é imposta pelo tipo

A limitação mais honesta: nada no compilador obriga chamar `auditMutation`
antes do `return err(...)`. O tipo garante que, **se** você chamar, a forma
do evento está certa — não garante que você vai lembrar de chamar. Esquecer
de auditar uma falha é um antipadrão documentado, não um erro que o
TypeScript pega. A trilha de auditoria depende de disciplina humana no
exato ponto em que ela mais importa — o caminho de erro, que é justamente o
menos testado por natureza.

Segunda lacuna: `reason` é uma convenção de string, não um enum fechado
como `AuditEntity`/`AuditAction`. Dois desenvolvedores podem escrever
`insufficient_role` e `insufficient_permission` pro mesmo motivo, e nada
avisa da duplicidade — a consulta no Axiom que deveria agrupar os dois como
um caso só vê dois.

## O que isso prova, e o que não prova

Prova que um esquema de evento fechado e tipado é consultável meses depois
de um jeito que log de texto livre nunca é — a pergunta "quem fez o quê, e
teve sucesso?" vira filtro, não busca. Prova que a instrumentação nasce com
a rota, via `withAxiom`, não é um passo extra que alguém pode pular. Não
prova que toda falha relevante é sempre auditada — depende de quem escreve
o código lembrar, e isso já falhou antes em outras partes da Nexo (ver o
post sobre erros como valores). Não prova que `reason` é uma taxonomia sem
duplicidade — é convenção de nome, não tipo.
