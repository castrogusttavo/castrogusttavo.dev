---
title: O algoritmo por trás do rate limit — Fixed Window Flexível, não token bucket
description: "Se você já implementou rate limit, provavelmente pensou em token bucket. O rate-limiter-flexible que a Nexo usa não é isso — o próprio README da lib chama o algoritmo de Flexible Fixed Window. Isto é o problema clássico do fixed window ingênuo, o que a versão flexível resolve (e o que não resolve), e como os mesmos seis parâmetros do algoritmo viram seis perfis de risco diferentes na Nexo."
icon: idea
date: "2026-08-29"
---

Se você já implementou rate limit alguma vez, provavelmente pensou em
token bucket — é o algoritmo mais citado quando o assunto aparece. O
`rate-limiter-flexible`, que a Nexo usa em produção, não é isso. O próprio
README da biblioteca é direto sobre qual algoritmo está por trás:

> The Flexible Fixed Window algorithm starts counting from the moment a
> request is received, diversifying rate limit reset times across clients.

Fixed Window, não token bucket — com um detalhe no nome, "flexible", que é
justamente o que evita o problema clássico da versão ingênua desse
algoritmo.

## O problema: fixed window ingênuo deixa passar o dobro do limite

Um fixed window clássico divide o tempo em blocos alinhados ao relógio —
"10 requests por janela de 15 minutos", contando `14:45:00` até `14:59:59`,
depois `15:00:00` até `15:14:59`. O problema aparece exatamente na fronteira
entre dois blocos: nada impede 10 requests em `14:59:59` e mais 10 em
`15:00:01` — 20 requests em dois segundos, cada leva dentro do próprio
bloco, nenhuma regra violada no papel. O limite nominal de "10 por 15
minutos" na prática permite o dobro, concentrado bem no ponto onde um
ataque de força bruta tentaria.

## A ideia: a janela começa no request, não no relógio

A versão "flexível" muda uma coisa: a janela não começa num instante global
alinhado ao relógio — começa no momento em que **aquela chave específica**
recebe seu primeiro request. Duas chaves diferentes (dois usuários, dois
IPs) têm janelas que começam em momentos diferentes, cada uma reiniciando
15 minutos depois do seu próprio primeiro consumo, não no mesmo segundo
`:00` pra todo mundo.

Isso não elimina por completo o burst de fronteira pra uma única chave — ela
ainda pode, em teoria, consumir perto do fim da própria janela e de novo
logo depois que ela reinicia. O que a versão flexível elimina é o padrão
mais perigoso em escala: um atacante não consegue sincronizar múltiplas
chaves pra explorar a mesma fronteira global de relógio, porque essa
fronteira global não existe — cada chave tem a sua.

## Como funciona: o mesmo algoritmo, seis parâmetros, seis riscos

```ts
export const authLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:auth', points: 10, duration: 900, blockDuration: 1800,
})
export const otpLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:otp', points: 5, duration: 900,
})
export const apiLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:api', points: 100, duration: 60,
})
export const exportLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:export', points: 1, duration: 86400,
})
```

`points` é quantas unidades a chave pode consumir, `duration` é o tamanho
da janela em segundos, `blockDuration` (só em `auth`) é um bloqueio
**adicional** depois de estourar o limite — não é parte do fixed window em
si, é uma penalidade extra empilhada em cima, reservada pro bucket que
protege contra brute-force de credencial.

Quando o limite estoura, a biblioteca lança `RateLimiterRes`, que a Nexo
converte no mesmo formato de erro do resto do sistema:

```ts
if (cause instanceof RateLimiterRes) {
  const retryAfterSeconds = Math.max(1, Math.ceil(cause.msBeforeNext / 1000))
  return err(rateLimited(retryAfterSeconds))
}
```

`msBeforeNext` é quanto tempo falta pra aquela chave especificamente poder
consumir de novo — não um valor fixo genérico, é calculado a partir do
instante em que a janela daquela chave começou. Esse número vira o header
HTTP `Retry-After` na resposta final — o algoritmo por trás de um número
que muitos clientes de API leem e obedecem sem saber de onde ele vem.

## Resultados: o mesmo mecanismo reaproveitado sem reescrever nada

Seis buckets, seis perfis de risco, zero lógica de rate limit duplicada —
`auth` é apertado e penaliza estouro com bloqueio extra porque protege
contra brute-force; `export` libera uma unidade por dia porque gerar um
export é caro; `api` libera 100 por minuto porque é o tráfego normal de
uso. O algoritmo é o mesmo em todo lugar; o que muda é só a configuração,
decidida pelo risco que cada rota carrega.

## Onde quebrou: falha aberto, e o backup em memória não é backup de verdade

A limitação mais concreta já apareceu no post sobre defesa em camadas: se o
Redis que guarda o estado do limitador cai, `consume()` deixa passar — o
algoritmo simplesmente para de ser aplicado, não fecha por segurança.

A segunda é mais sutil e específica do algoritmo: o `insuranceLimiter` —
configurado só em `auth` e `otp` — é um `RateLimiterMemory`, guardado no
processo local. Rodando uma réplica só, isso funciona como esperado. Rodando
N réplicas atrás de um load balancer, cada uma mantém sua **própria** contagem
em memória, sem compartilhar estado — um atacante distribuído entre N
réplicas tem, na prática, N vezes o limite configurado, sem que nenhuma
réplica individual veja o quadro completo. O algoritmo em si continua
correto; é a topologia do fallback que quebra a garantia que ele promete.

## O que isso prova, e o que não prova

Prova que "Fixed Window Flexível" não é o mesmo algoritmo que token bucket,
e que a diferença — janela por chave em vez de janela global de relógio — é
o que evita sincronização de burst entre múltiplos atacantes, não o
problema de burst de uma única chave na própria fronteira. Prova que o
mesmo mecanismo, com parâmetros diferentes, cobre perfis de risco bem
diferentes sem precisar de seis implementações distintas. Não prova que o
sistema segura sob falha do Redis — falha aberto, por design. Não prova que
o backup em memória mantém a mesma garantia em múltiplas réplicas — a conta
não é compartilhada, e isso multiplica o limite efetivo pelo número de
instâncias rodando.
