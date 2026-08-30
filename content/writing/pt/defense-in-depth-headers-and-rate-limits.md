---
title: Defesa em camadas — CSP, rate limit e o que protege a Nexo antes do código de negócio
description: "Todo guia de segurança manda nunca usar unsafe-inline no CSP. A Nexo usa — e o comentário no código explica exatamente por que essa é a exceção documentada, não um descuido. Isto é como a defesa da Nexo se divide em camadas antes de qualquer rota rodar: CSP com nonce por request, seis buckets de rate limit com parâmetros diferentes por risco, e uma checagem contínua de headers que roda toda semana contra produção."
icon: bug
date: "2026-08-29"
---

Todo guia de segurança diz pra nunca usar `unsafe-inline` no CSP. A Nexo
usa — em `style-src`, especificamente — e o comentário deixado no código
explica exatamente por que essa é a exceção documentada, não um descuido:

```ts
// style-src keeps 'unsafe-inline' as a deliberate trade-off, not an
// oversight: our UI primitives (Radix/Base UI popovers, tooltips, dropdowns)
// position themselves via inline style="" attributes, and CSP has no
// nonce/hash mechanism for the style attribute (only for <style>
// elements/blocks). Dropping unsafe-inline here would break floating-UI
// positioning app-wide. Re-evaluate if/when the UI kit moves off inline
// transforms.
```

`script-src`, por outro lado, não abre exceção nenhuma: nonce por request,
`strict-dynamic`, zero `unsafe-inline`. A diferença entre as duas diretivas
é o resumo de como a Nexo pensa defesa em camadas — cada camada é
configurada pelo risco real que ela cobre, não por um checklist genérico
aplicado igual em tudo.

## O problema: CSP rígido demais quebra a UI, CSP frouxo demais não protege nada

A tentação óbvia diante de um guia de segurança é aplicar a regra mais
rígida em tudo — zero `unsafe-inline`, sempre. Na prática, bibliotecas de UI
que posicionam elementos via `style=""` inline (Radix, Base UI — tooltips,
popovers, dropdowns) quebram sob esse CSP, porque CSP não tem mecanismo de
nonce ou hash pro atributo `style`, só pra blocos `<style>`. A resposta
errada mais comum nesse ponto é desistir do CSP inteiro, ou jogar
`unsafe-inline` em `script-src` também — a exceção que devia ser cirúrgica
vira uma porta aberta em tudo.

## A ideia: cada camada, escopo próprio, risco próprio

```ts
function buildCspHeader(nonce: string): string {
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    frame-ancestors 'none';
    object-src 'none';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim()
}
```

O nonce é gerado por request, no middleware, e propagado via header
`x-nonce` — cada resposta carrega um CSP diferente, o que faz o
`script-src` fechado de verdade: só script com o nonce exato daquela
request roda, nada de whitelist estática que um XSS injetado pudesse
reaproveitar. `style-src` abre a exceção documentada. `frame-ancestors
'none'` e `object-src 'none'` fecham clickjacking e plugins legados sem
custo nenhum de UI — não existe trade-off ali, então não existe exceção.

Rate limit segue a mesma lógica de "cada camada, risco próprio" — seis
buckets, seis perfis:

| Bucket | Points | Janela | Bloqueio extra |
| --- | --- | --- | --- |
| `auth` | 10 | 15 min | 30 min |
| `otp` | 5 | 15 min | — |
| `email` | 5 | 1 h | — |
| `api` | 100 | 1 min | — |
| `export` | 1 | 24 h | — |
| `upload` | 10 | 1 min | — |

`auth` é o único com `blockDuration` — dez tentativas de login erradas em
15 minutos custam 30 minutos de bloqueio adicional, porque é o bucket que
protege contra brute-force de credencial, o risco mais caro da lista.
`export` libera um pedido por dia — gerar o export de dados de um usuário é
caro o bastante pra não fazer sentido liberar mais que isso.

Rotas autenticadas consomem por `user:<id>`; rotas públicas (sem sessão,
como `talk-to-sales` ou a aplicação de vaga) usam um wrapper específico que
resolve a chave por IP antes do handler:

```ts
export const POST = withAxiom(
  withRateLimit(
    (request) => ({ limiter: apiLimiter, key: `ip:${getClientIp(request)}` }),
    async (request) => { /* ... */ },
  ),
)
```

## Resultados: verificado toda semana, não só na hora de escrever o código

`headers-check`, job do CI, roda um `curl -I` contra produção e falha se
qualquer um dos cinco headers de segurança sumir — `x-frame-options`,
`x-content-type-options`, `strict-transport-security`,
`content-security-policy`, `referrer-policy`. Isso transforma "os headers
estão lá" de uma afirmação sobre o código pra uma verificação contínua
sobre o que está de fato servindo em produção.

## Onde quebrou: rate limit falha aberto quando o Redis falha

A lacuna mais concreta está no próprio `consume()`:

```ts
} catch (cause) {
  if (cause instanceof RateLimiterRes) {
    return err(rateLimited(retryAfterSeconds)) // limite bateu de verdade
  }
  // erro de conexão/infra com o Redis
  logger.error('rate_limit_store_error', { /* ... */ })
  return ok(undefined) // deixa passar
}
```

Se o Redis que guarda o estado do rate limit está fora do ar, a request
**passa** — falha aberto, não fechado. É a mesma filosofia do post sobre
cache: degradar em vez de derrubar o request. Mas aqui o preço é diferente:
com o cache, degradar custa latência; com rate limit, degradar custa a
própria proteção — exatamente quando a infra está instável (motivo comum
pra um ataque de força bruta ser tentado) é quando o limite para de valer.

Segunda lacuna: só `auth` e `otp` têm `insuranceLimiter` (um
`RateLimiterMemory` de backup) configurado. `api`, `email`, `export` e
`upload` não têm — se o Redis cair, esses quatro buckets não têm rede de
segurança nenhuma, nem em memória. E mesmo onde existe, o limitador em
memória é por instância — rodando N réplicas da aplicação, o "backup"
efetivo é N vezes mais permissivo do que o limite configurado sugere.

## O que isso prova, e o que não prova

Prova que defesa em camadas não significa aplicar a regra mais rígida em
tudo — significa escolher, camada por camada, onde a rigidez vale o custo e
documentar onde não vale. Prova que os headers de segurança são verificados
de forma contínua, não só confiados. Não prova que o rate limit segura sob
falha de infraestrutura — o design escolhido é degradar pra abrir, não pra
fechar, e isso é uma lacuna real de proteção, não hipotética. Não prova
cobertura uniforme de fallback — dois de seis buckets têm rede de
segurança, quatro não têm nenhuma.
