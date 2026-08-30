---
title: Por que rodo o ZAP uma vez por semana, não em cada PR
description: "O arquivo que diz ao ZAP quais achados ignorar tem quatro linhas — e cada uma delas carrega, no próprio arquivo, o motivo de ignorar. Esse arquivo é o resumo de uma decisão maior: DAST na Nexo não bloqueia PR nenhum, roda contra produção uma vez por semana, e vira issue pra revisão humana, nunca um gate automático. Isto é por que essa cadência, e o que fica sem forçamento quando ninguém olha a issue."
icon: bug
date: "2026-08-29"
---

O arquivo que diz ao OWASP ZAP quais achados ignorar na Nexo (`.zap/rules.tsv`)
tem quatro linhas. Cada uma carrega, no próprio arquivo, o motivo:

```
10038  IGNORE  (CSP Header Not Set - handled by proxy.ts and next.config.ts)
10063  IGNORE  (Feature Policy Header Not Set - handled via Permissions-Policy)
10015  IGNORE  (Re-examine Cache-control Directives - per-route cache policy will be set granularly)
10049  IGNORE  (Storable/Non-Storable/Non-Cacheable Content - per-route cache policy will be set granularly)
```

Não é uma lista de exceções que alguém foi acumulando sem explicar — é uma
lista pequena, cada linha justificada, revisável em segundos. É o tipo de
artefato que só existe porque a decisão de rodar DAST foi pensada com
cadência própria, não encaixada à força no mesmo ritmo do CI de cada PR.

## O problema: DAST em todo PR não cabe no ritmo de PR

Um scan dinâmico (DAST) precisa de uma aplicação **rodando de verdade** —
não é análise estática de código, é ataque real contra um alvo real. Isso
não cabe no ciclo de vida de um PR: subir um ambiente efêmero pra cada PR só
pra escanear é caro, lento, e ainda assim escaneia um ambiente que não é
produção. A alternativa ruim mais comum é não rodar DAST nenhum — SAST
(Semgrep, Snyk) cobre o código estático, mas não cobre o que só aparece em
runtime: header ausente numa resposta real, comportamento que só existe sob
carga, configuração de produção que diverge do que está no repositório.

## A ideia: cadência separada por tipo de verificação

```yaml
# security-dast.yml
on:
  schedule:
    - cron: '0 6 * * 1' # toda segunda, 06:00 UTC
  workflow_dispatch:
```

DAST roda contra o alvo real — `https://nexo.coodee.dev` — uma vez por
semana, desacoplado de qualquer push ou PR. Não bloqueia nada: nenhum
commit espera o ZAP terminar pra ser mergeado ou deployado.

```yaml
- uses: zaproxy/action-baseline@...
  with:
    target: 'https://nexo.coodee.dev'
    rules_file_name: '.zap/rules.tsv'
    allow_issue_writing: true
    fail_action: false
```

`fail_action: false` é a decisão central: um achado do ZAP nunca falha o
workflow. Vira issue no GitHub, pra revisão humana — nunca um gate
automático que bloqueia alguém.

## Como funciona: baseline, não full, e por quê

ZAP tem modos com custo bem diferente:

| Modo | Cobertura | Tempo | Adequado a |
| --- | --- | --- | --- |
| Baseline | Spider passivo, sem ataque ativo | minutos | cadência frequente |
| Full | Ataques ativos completos | muito mais longo | análise pontual, profunda |

A Nexo roda **baseline** semanalmente — spider que navega e observa, sem
tentar explorar nada ativamente. É o modo certo pra rodar toda semana sem
virar um custo de infraestrutura recorrente alto. Complementar a isso,
`headers-check` roda um `curl -I` determinístico contra os mesmos headers
de segurança — rápido, sem ataque nenhum, só confirmação de presença.

Tem ainda um terceiro job, `lpa2v-triage-full`, que cruza o resultado do
ZAP com Semgrep (SAST) e Snyk (SCA) usando o `lpa2v-appsec` — o projeto de
triagem contextual com IA que já é tema de outro post deste blog. A ideia
ali é específica: um achado que o SAST marca como vulnerável mas o DAST não
consegue reproduzir contra produção real (por exemplo, bloqueado por WAF) é
um sinal de "inconsistente" — nem confirma, nem descarta — que a triagem
manual sozinha, olhando cada ferramenta isolada, não enxergaria.

## Resultados: quatro exceções documentadas, zero exceção sem explicação

O ponto que mais importa não é o número de achados ignorados — é que **cada
um** carrega a razão junto. Isso transforma `.zap/rules.tsv` num artefato
revisável: qualquer pessoa lendo esse arquivo em cinco minutos entende
exatamente o que foi decidido não corrigir e por quê, sem precisar
reconstruir o raciocínio do zero.

## Onde quebrou: achado sem dono não bloqueia nada, e full não tem cadência fixa

A lacuna mais honesta está em `fail_action: false`: um achado novo e real
do ZAP não impede nada de continuar acontecendo. Vira issue — e se ninguém
olhar essa issue, a vulnerabilidade fica documentada, mas não corrigida,
indefinidamente. Diferente do CI de código (que bloqueia merge), o DAST
depende inteiramente de alguém prestar atenção depois do fato.

Segunda: baseline nunca tenta um ataque ativo de verdade. Isso é uma
escolha deliberada de custo, não um detalhe menor — significa que uma
classe de vulnerabilidade só visível sob exploração ativa (não só spider
passivo) pode nunca aparecer no scan semanal. O modo full existe como
ferramenta, mas não está registrado como rodando numa cadência automática
recorrente — é análise pontual, não cobertura contínua.

## O que isso prova, e o que não prova

Prova que separar a cadência de verificação por custo real (segundos pra
headers, minutos pro baseline, muito mais pro full) é o que torna possível
rodar DAST de verdade sem travar o fluxo de entrega. Prova que cada exceção
documentada é revisável, não uma lista que cresce sem explicação. Não prova
que um achado novo é corrigido — prova só que ele é *registrado*; a correção
depende de alguém agir sobre a issue. Não prova cobertura de ataque ativo
contínua — o modo que realmente ataca não roda toda semana, só o modo
passivo roda.
