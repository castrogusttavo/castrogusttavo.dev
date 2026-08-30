---
title: Commit direto na main, sem PR — o que isso exige do pipeline
description: "Todo commit que chega na main da Nexo já passou pelo deploy antes de qualquer humano abrir uma aba de review — porque não existe review. O que substitui a revisão humana não é confiança, é um pipeline que torna impossível promover código vermelho: pre-commit local, CI no push, e CD que só dispara quando o CI anterior terminou verde. Isto é o que essa troca exige, e o risco real que ela aceita."
icon: terminal
date: "2026-08-29"
---

Todo commit que chega na `main` da Nexo já passou pelo build, pelos testes
e está a um `workflow_run` verde de distância de estar em produção — antes
de qualquer humano abrir uma aba de review. Não existe review, porque não
existe Pull Request no fluxo padrão. `main` é a única branch: não tem
`dev`, não tem branch por feature, não tem PR pra cada versão.

Isso soa arriscado até se ler o que substitui o review: não é confiança, é
um pipeline desenhado pra tornar **impossível** promover código vermelho
pra produção.

## O problema: PR não é sinônimo de segurança, é sinônimo de latência

A suposição comum é que Pull Request é a rede de segurança — sem ela, nada
protege a `main`. Na prática, um PR revisado só pelo próprio autor (comum
em time pequeno ou solo) adiciona a latência do fluxo de review sem
adicionar a proteção que o review deveria trazer. O que de fato impede
código quebrado de virar produção não é uma pessoa aprovando — é alguma
verificação automática, e essa verificação existe com ou sem PR no meio.

## A ideia: duas travas, sem review humano, sem burlar nenhuma

**Trava 1 — local, antes do commit sair da máquina:**

```
pre-commit  → pnpm check (Biome) + pnpm tsc --noEmit
commit-msg  → commitlint valida a mensagem
```

Um commit que não type-checka, ou que não segue o Conventional Commit, é
bloqueado **antes** de existir no histórico. Não é um ideal a seguir, é uma
trava executável.

**Trava 2 — remota, no push:**

```yaml
# ci.yml
on:
  push:
    branches: [main]
  pull_request:
```

CI roda tanto em `push` na `main` quanto em `pull_request` — os PRs de
exceção (Dependabot, contribuição externa) continuam cobertos. O detalhe
que separa os dois casos:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Um PR em iteração pode cancelar a run anterior — faz sentido, só o último
push importa. Um push direto na `main` **nunca** é cancelado: cada tip que
chega lá precisa resolver até o fim, porque cada um desses tips é candidato
a virar deploy.

## Como funciona: CD só nasce de um CI verde

```yaml
# cd.yml
on:
  workflow_run:
    workflows: ['CI']
    types: [completed]
    branches: [main]

jobs:
  migrate:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: self-hosted
    steps:
      - run: pnpm prisma:deploy

  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: self-hosted
    environment: { name: production, url: https://nexo.coodee.dev }
```

`cd.yml` não escuta `push` — escuta a **conclusão** do `ci.yml`. Se o CI
falhar, o `if: conclusion == 'success'` nunca é verdadeiro, e nenhum job do
CD roda. Não existe deploy manual paralelo que ignore essa checagem; o
único caminho pra produção passa pelo CI ter fechado verde primeiro.

`migrate` roda antes de `deploy`, como job separado — as migrations de
banco entram em produção antes da imagem nova subir, não junto.

## Resultados: a unidade de integração é o commit, não o PR

Sem PR pra "agrupar" trabalho relacionado, o commit vira a unidade real de
integração — é por isso que a granularidade dos commits (tematizados,
Conventional, uma intenção cada) importa tanto nesse fluxo: não existe
squash de PR pra limpar um histórico de commits soltos depois. O histórico
da `main` só fica legível se cada commit já nascer coeso.

## Onde quebrou: nenhuma revisão humana, e um ponto cego entre migrar e deployar

A limitação mais direta: **zero revisão de outra pessoa** em qualquer
commit solo-autorado. O pipeline garante que o código funciona (type-checka,
passa nos testes, lint limpo) — não garante que a decisão de design por
trás dele fez sentido. Isso é aceitável pra um time pequeno onde o mesmo
autor é quem mais entende o domínio, mas é uma troca real, não ausência de
risco.

Segunda: `migrate` e `deploy` são jobs separados, ambos condicionados ao
mesmo `if`, mas nada no workflow amarra explicitamente "se `deploy` falhar
depois que `migrate` já rodou, reverta a migration". Uma migration bem
sucedida seguida de uma falha no build/deploy da imagem deixa banco e
código momentaneamente dessincronizados — a documentação do pipeline não
descreve rollback automático pra esse cenário específico.

Terceira: os dois jobs mais sensíveis (`migrate`, `deploy`) rodam em
`runs-on: self-hosted` — um runner próprio é uma dependência de infra a
mais que, se cair, trava todo deploy até alguém notar e religar.

## O que isso prova, e o que não prova

Prova que "sem PR" não é sinônimo de "sem rede de segurança" — a rede
existe, só que é automática em vez de humana, e trava em dois pontos
diferentes (local e remoto) antes de qualquer coisa chegar em produção.
Prova que a `main` nunca recebe um deploy de CI vermelho, porque o
mecanismo que dispara o CD literalmente não existe sem essa condição. Não
prova que o fluxo substitui o valor de uma segunda pessoa revisando decisão
de design — não substitui, e não tenta. Não prova que migração e deploy
estão protegidos contra dessincronia entre si — esse é um risco aceito, não
resolvido.
