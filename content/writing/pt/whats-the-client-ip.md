---
title: Qual é o IP do cliente? — o registro de consentimento que gravava o endereço que o cliente escolhia
description: "Os registros de consentimento da Nexo, que existem pra servir de prova na LGPD, gravavam o primeiro valor do X-Forwarded-For — o único que o cliente escreve. Um curl com o header trocado registrava o IP que eu quisesse. Este post é a pergunta que parece trivial e não é: resolver o IP pelo salto mais à direita que não é proxy confiável, por que o X-Real-IP não salvava, o que mudou quando a Cloudflare entrou na frente do nginx, e o detalhe do teste de carga que precisou do oposto."
icon: code
date: "2026-10-27"
---

```bash
curl -H 'X-Forwarded-For: 1.2.3.4' ...
```

Com esse header, o `ConsentEvent` gravado no banco da Nexo dizia que o
aceite dos termos tinha vindo de `1.2.3.4`. `ConsentEvent` é a tabela que
guarda quem aceitou qual versão de qual documento, quando, de que IP e com
qual user agent — é o registro que eu apresentaria se alguém perguntasse
"como você sabe que esse usuário consentiu?". E o campo de IP aceitava
qualquer valor que o próprio usuário quisesse escrever.

Os três pontos que gravam consentimento — o aceite no cadastro, o do
onboarding e o de cookies — usavam a mesma linha, desde 18 de maio:

```ts
const ipAddress =
  reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  reqHeaders.get('x-real-ip') ||
  null
```

Achei isso no meio de outro trabalho, o mesmo que descobriu o vazamento
do portão de consentimento no layout. A
correção é pequena. A pergunta por trás dela não é.

## O problema: `X-Forwarded-For` é uma lista, e o começo dela é do cliente

`X-Forwarded-For` não é "o IP do cliente". É uma lista em que cada proxy
**acrescenta** o endereço de quem falou com ele. O nginx da Nexo faz isso
com `$proxy_add_x_forwarded_for`: pega o header que chegou e soma o
`$remote_addr` no fim.

Se o cliente não manda o header, a lista tem uma entrada só — o endereço
real, posto pelo nginx. Se manda, a lista chega no app assim:

```text
X-Forwarded-For: 1.2.3.4, 203.0.113.7
                 ^ cliente  ^ acrescentado pelo nginx (o endereço real)
```

A primeira entrada é texto livre. A última é a única que alguém confiável
escreveu. `split(',')[0]` pegava exatamente a errada.

O fallback não salvava. O `X-Real-IP` é preenchido pelo nginx, e até 15 de
outubro o nginx de produção o preenchia com `$http_x_forwarded_for` — o
header do próprio cliente, de novo. Nessa noite ele passou pra
`$remote_addr`, mas a configuração do nginx de produção não está no
repositório; isso está registrado nas minhas notas de operação, não num
commit.

E o mesmo bug morava num lugar mais óbvio: o `getClientIp` do rate limiter
da aplicação, o que aparece no [post sobre defesa em
camadas](/pt/writing/defense-in-depth-headers-and-rate-limits) montando a chave
`ip:${getClientIp(request)}`. Ele também lia a primeira entrada. Os meus
próprios scripts de carga dependiam disso: cada VU do k6 manda um
`X-Forwarded-For` diferente pra ganhar um bucket próprio no limiter da
aplicação. O registro do experimento, no `k6/EXPERIMENT-LOG.md`, diz com
todas as letras que esse spoof "funciona contra o rate limiter da
aplicação" e não engana o nginx — o `limit_req` do nginx é chaveado por
`$binary_remote_addr`, o IP do socket. A camada de fora segurava; a de
dentro, não.

## O outro lado: confiar em nada também quebra

O Better Auth, que cuida de login e sessão, erra pro lado oposto. Sem
`trustedProxies` configurado, ele só aceita um `X-Forwarded-For` de
**uma** entrada. Com duas ou mais, o IP resolvido é `null`, e o rate
limiter dele cai numa chave única por caminho, `no-trusted-ip`. Pra
`/sign-in`, a regra padrão é 3 requisições a cada 10 segundos — pra todo
mundo nesse bucket, junto.

Foi isso que derrubou uma rodada de teste de carga com **99,76% de falha
em login**, também registrada no `EXPERIMENT-LOG.md`: atrás do nginx, todo
login caía no mesmo bucket. Em produção, qualquer cliente que mandasse o
próprio `X-Forwarded-For` (ou passasse por um proxy corporativo que
manda) dividia esse limite com todos os outros na mesma situação.

Então são dois erros simétricos. Ler a entrada mais à esquerda confia no
cliente. Recusar listas com mais de uma entrada não confia em ninguém, e
transforma usuários diferentes num só.

## A ideia: andar da direita pra esquerda até o primeiro salto que não é seu

A resposta certa usa o que se sabe sobre a própria infraestrutura. Eu sei
quais proxies são meus. Lendo a lista da direita pra esquerda, cada
entrada que é um proxy meu pode ser descartada — ele só repassou. A
primeira entrada que **não** é um proxy meu é o endereço que o último
proxy confiável viu do outro lado da conexão. Tudo à esquerda dela foi
escrito por alguém em quem eu não confio, e é ignorado.

```text
X-Forwarded-For: 9.9.9.9, 4.4.4.4, 10.1.2.3, 127.0.0.1
                          ^ primeiro não confiável, lendo da direita
```

## Como funciona

O Better Auth já implementa essa resolução em `getIPFromHeader`, desde que
receba a lista de proxies confiáveis. A Nexo passou a configurar isso uma
vez, por variável de ambiente, e usar o mesmo resolvedor em todo lugar:

```ts
// src/lib/auth.ts
ipAddress: {
  ipAddressHeaders: ['x-forwarded-for'],
  trustedProxies: TRUSTED_PROXIES,
},
```

```ts
// src/lib/client-ip.ts
export function clientIp(headers: Headers | null | undefined): string | null {
  const forwardedFor = headers?.get('x-forwarded-for')
  if (!forwardedFor) return null

  return getIPFromHeader(forwardedFor, { trustedProxies: TRUSTED_PROXIES })
}
```

`TRUSTED_PROXIES` tem como padrão `127.0.0.1,::1`. Parece pouco, e é de
propósito: o nginx acrescenta o endereço do cliente e nunca o próprio,
então a última entrada já é a que interessa. O loopback serve só pra
ligar o modo de lista com várias entradas no Better Auth — sem nenhum
proxy confiável, ele volta a recusar listas.

Duas escolhas no helper:

- **`null`, não um placeholder.** Um registro de consentimento sem IP
  conhecido guarda "não sei", não `'unknown'`. Quem precisa de string é o
  rate limiter, e ele converte `null` em `'unknown'` sozinho.
- **`X-Real-IP` não é lido.** Nem como fallback. Um header só entra na
  resolução se eu souber exatamente quem o escreveu.

Os testes fixam o comportamento que importa, inclusive o caso do ataque:

```ts
it('should not let a spoofed leftmost entry pick the address', () => {
  const spoofed = headers({ 'x-forwarded-for': '9.9.9.9, 3.3.3.3' })
  const honest = headers({ 'x-forwarded-for': '3.3.3.3' })
  expect(clientIp(spoofed)).toBe(clientIp(honest))
})
```

E a prevenção é um `grep`: nenhum código em `app`, `src` ou `lib` lê
`x-forwarded-for` ou `x-real-ip` direto. Hoje ele só acha o `client-ip.ts`,
a configuração do Better Auth e comentários.

A correção veio em duas partes. Em 15 de outubro, o rate limiter da
aplicação e o Better Auth (`590bfc8c`). Em 17 de outubro, os três pontos de
consentimento, que tinham ficado de fora (`5fd075fa`) — o
`getClientIp` do limiter passou a ser construído em cima do mesmo
`clientIp`.

## E aí a Cloudflare entrou na frente

No mesmo dia 17, o `nexopm.com` passou a ficar atrás da Cloudflare. Isso
acrescenta um salto antes do nginx, e sem fazer nada o resultado seria
previsível: o `$remote_addr` do nginx viraria um IP da Cloudflare. Todo
registro de consentimento, toda sessão, toda chave de rate limit passaria
a ver a Cloudflare, e o `limit_req` do nginx colocaria todos os
usuários num punhado de buckets.

Havia dois jeitos de resolver. Um era listar as faixas da Cloudflare em
`TRUSTED_PROXIES` e deixar a aplicação pular esses saltos. O problema é
que só a aplicação ficaria certa — o nginx continuaria vendo a Cloudflare
no `$remote_addr` e no `limit_req`. O outro é restaurar o endereço no
próprio nginx, antes de qualquer coisa ler. Fiz o segundo:

```nginx
real_ip_header CF-Connecting-IP;

set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ... 22 faixas no total: 15 IPv4, 7 IPv6
set_real_ip_from 2c0f:f248::/32;
```

O detalhe que faz isso ser seguro é o `set_real_ip_from`: o nginx só
aceita o `CF-Connecting-IP` em conexões que vêm das faixas publicadas da
Cloudflare. Quem bate direto na origem mantém o próprio endereço, então
mandar um `CF-Connecting-IP` falso de fora não adianta. Com isso, tudo
que vem depois — `$remote_addr`, o `$binary_remote_addr` do `limit_req`,
o `X-Real-IP` e a entrada do `X-Forwarded-For` que o `clientIp` lê —
continua vendo o visitante. Nenhuma linha da aplicação mudou.

A ordem importou: o arquivo foi aplicado no servidor **antes** de ligar o
proxy da Cloudflare. Na ordem inversa, cada registro gravado no intervalo
teria o IP da Cloudflare. O arquivo está versionado em
`infra/nginx/cloudflare-realip.conf` (`464e964b`).

### O teste de carga quer o contrário

O teste de carga em produção precisa de um bucket por VU, como teria um
usuário real. Por isso o nginx tem um caminho de exceção, liberado só com
um token de teste de carga: com ele, o `/api/auth/` repassa o
`X-Forwarded-For` que o k6 inventou, em vez de confiar no socket. É o
spoof, ligado de propósito e atrás de uma chave.

A Cloudflare quebrou isso de um jeito sutil. Ela também acrescenta ao
`X-Forwarded-For`, então o header chegava como `<IP do VU>, <IP do
runner>`. O resolvedor, corretamente, pegava a entrada da direita — o
runner — e todos os VUs voltavam a dividir um bucket. A correção foi o
mapa do nginx desse caminho de teste passar adiante só o primeiro valor.
Esse mapa vive no servidor, não no repositório; a mudança está nas minhas
notas.

## Resultados

| Onde o IP é lido | Antes | Depois |
| --- | --- | --- |
| `ConsentEvent` (cadastro, onboarding, cookies) | primeira entrada do XFF, depois `X-Real-IP` | `clientIp()` |
| Rate limiter da aplicação (Redis) | primeira entrada do XFF, depois `X-Real-IP` | `clientIp()` |
| Better Auth (limiter e IP da sessão) | só XFF de 1 entrada; senão bucket compartilhado | mesma resolução, com `trustedProxies` |
| `limit_req` do nginx | IP do socket | IP do socket, restaurado da Cloudflare |

Com a Cloudflare ligada, uma requisição pelo edge de São Paulo
(`cf-ray …-GRU`) chegou ao access log do nginx com o IP real do cliente —
conferido à mão no dia, não por um teste automatizado.

## Onde quebrou / limitações

**Os registros antigos não têm conserto.** De 18 de maio a 17 de outubro,
todo `ConsentEvent` gravou a primeira entrada do `X-Forwarded-For`. Pra
quem não mandou o header, ela é o endereço real; pra quem mandou, é o que
a pessoa escreveu. O banco não guarda a lista inteira, então não existe
como separar um caso do outro depois. O consentimento em si (documento,
versão, data, usuário) continua válido; o IP desses registros é uma
alegação, não uma prova. Na prática, nenhum registro de terceiro foi
afetado: fora as contas de seed do teste de carga, as únicas contas são
minhas.

**O próprio fix gravou IPv6 como prefixo /64 por quase um dia.** O
`getIPFromHeader` do Better Auth normaliza IPv6 pra sub-rede /64 por padrão
(`ipv6Subnet: 64`), porque foi pensado pra rate limit, onde agrupar por /64
é o certo. O `clientIp` que entrou com o `5fd075fa` herdou esse padrão, então
de 17/10 às 23:50 UTC até o deploy do
[`da4ba764`](https://github.com/castrogusttavo/nexo/commit/da4ba764), em 18/10 às 18:49 UTC,
um aceite feito por IPv6 gravou algo como
`2804:014c:005b:8000:0000:0000:0000:0000` — o prefixo da rede, não o
endereço do dispositivo. Pra rate limit era o certo; pra registro de
consentimento era menos preciso do que um leitor do campo esperaria. O
`da4ba764` separou os dois usos: os registros de consentimento e de
candidatura a vaga guardam o IPv6 inteiro, os 128 bits, e o rate limit
continua chaveando pelo /64, agora via `clientIpBucket`, porque um
assinante costuma ter um /64 inteiro e trocar de endereço dentro dele não
deveria zerar o limite.

**As faixas da Cloudflare são uma lista estática.** Se a Cloudflare
publicar uma faixa nova, conexões vindas dela não terão o endereço
restaurado e vão aparecer como IP da Cloudflare até alguém atualizar o
arquivo no repositório e no servidor. Não tem nada automatizando isso.

**Só parte do nginx de produção está versionada.** O arquivo de real IP
está no repositório; o `X-Real-IP` com `$remote_addr` e o mapa do teste
de carga, não. As duas mudanças que este post descreve fora do código
dependem de eu ter anotado o que fiz no servidor. E o comentário de
`TRUSTED_PROXIES` no código ainda sugere listar as faixas de uma CDN ali
"se uma ficar na frente" — exatamente o caminho que eu não segui.

**IP certo não resolve contagem certa.** Até 16 de outubro o limiter do
Better Auth contava em memória do processo, então com várias instâncias
cada cliente ganhava um bucket por instância (`dd34816f` passou a contagem
pro Redis) — mas isso é assunto de escala, não de IP, e está no [post
sobre subir de uma pra cinco instâncias](/pt/writing/from-one-to-five-nextjs-instances).

## O que isso prova, e o que não prova

Prova que "qual é o IP do cliente?" só tem resposta em relação a uma
topologia: a resposta é o endereço que o último proxy que eu controlo viu,
e o código precisa saber quais proxies são esses. Ler o começo da lista
confia no cliente; recusar listas não confia em ninguém. As duas versões
estavam em produção ao mesmo tempo, em bibliotecas diferentes.

Prova que restaurar o endereço na borda (o nginx) é melhor que ensinar
cada consumidor a pular saltos: uma configuração, e o rate limit do
nginx, o da aplicação, as sessões e os registros de consentimento passam
a concordar.

Não prova que os registros de consentimento anteriores a 17 de outubro
têm IP confiável — não têm, e não tem como saber quais. E não prova que o
IP gravado identifica uma pessoa: com NAT e CGNAT, ele identifica uma
rede, e é só isso que um registro desses deveria alegar.
