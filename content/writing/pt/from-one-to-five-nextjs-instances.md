---
title: De uma para cinco instâncias do Next.js — o que quebra quando o processo deixa de ser um só
description: "Um teste de carga em produção derrubou a Nexo às 03:21 UTC, com o heap do Node estourado. A causa era um flush de log por requisição. Corrigido o vazamento, sobrava outro teto: um processo Node usa um núcleo. Este post mede o que aconteceu ao subir de uma para cinco instâncias atrás do nginx, e o que deixou de funcionar quando o estado em memória passou a existir cinco vezes."
icon: rocket
date: "2026-10-22"
---

Às 03:21 UTC de 16 de outubro, no meio de um teste de carga contra a
produção da Nexo, o processo do Next.js morreu com
`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.
O Docker subiu outro em cerca de um segundo, e o teste seguiu, agora contra
um processo novo. Mas a mensagem dizia uma
coisa que eu não sabia: a Nexo vazava memória a cada requisição, e com
tráfego suficiente ia cair sozinha, periodicamente, sem teste de carga
nenhum.

Este é o follow-up medido do
[post sobre 1 milhão de usuários](/pt/writing/scaling-nexo-1m-users). Lá, o
balanceador com quatro instâncias tinha rodado só num worktree local, e eu
deixei registrado que isso era uma lacuna a fechar antes de chamar a tabela
de pronta. Aqui está o fechamento: produção real, de uma instância para
cinco, com o que quebrou no caminho.

## O problema: um processo, um núcleo, e uma fila que nunca esvaziava

O teste rodou a partir do workflow `Load Test (Production)` do repositório,
num runner do GitHub fora do Brasil, contra `https://nexopm.com`. Antes dos
números, a unidade, porque o post anterior errou feio aqui: uma VU **não é**
uma requisição em loop. Neste cenário (`k6/load.js`), cada VU faz login uma
vez e depois **uma requisição a cada 5 a 7 segundos**: 40% páginas públicas
(`/`, `/pricing`, `/status`, `/about`) e 60% API autenticada (lista de issues
com `limit=50`, projetos, `/api/users/me`). Uma VU é aproximadamente um
usuário ativo clicando, não um robô.

O servidor era uma VM de 8 vCPU (4 núcleos físicos com hyperthreading) e
7,6 GB, com **uma** instância do `nextjs-app`. Cada nível rodou com 2 minutos
de rampa e 5 de platô:

| VUs | p95 API | p99 API | p95 página | Vazão no platô | Erros |
|---|---|---|---|---|---|
| 5 | 429 ms | 443 ms | 1.480 ms | ~0,75 req/s | 0% |
| 200 | 593 ms | 752 ms | 1.495 ms | 30,0 req/s | 0% |
| 300 | 1.066 ms | 1.362 ms | 1.774 ms | 43,8 req/s | 0% |
| 350 | 1.829 ms | 2.049 ms | 2.516 ms | 47,0 req/s | 0% |
| 400 | 2.346 ms | 2.653 ms | 3.019 ms | 50,1 req/s | 0% |
| 500 | 4.358 ms | 4.743 ms | 5.035 ms | 51,0 req/s | 0% |
| 700 | 8.513 ms | 9.002 ms | 9.196 ms | 51,1 req/s | 0% |

Os percentis vêm do resumo JSON que o k6 grava como artefato de cada run
(runs `38842949080`, `38842209419`, `38843248820`, `38845518212`,
`38846285743`, `38847051485` e `38847828623`). A vazão no platô eu calculei
das linhas de progresso do k6 no log de cada run (iterações completas entre
o começo e o fim dos 5 minutos de platô). A média que o próprio k6 reporta,
contando a rampa, é menor (45,1 req/s no de 500 VUs), e foi o número que
anotei na hora.

A leitura é a de um sistema fechado batendo num teto. Acima de ~400 VUs a
vazão para de crescer, travada em ~51 req/s, e cada usuário a mais só
aumenta a fila. Dá pra conferir com a conta: com 700 VUs a 51 req/s, cada
VU completa um ciclo a cada 13,7 segundos, que são os 6 segundos de pausa
média mais ~7,7 segundos esperando resposta, praticamente a mediana de
página medida nesse nível. Nenhum erro em nenhum nível com o processo
limpo: o teto era de latência, não de falha.

E o teto tinha nome. Durante a carga, o `nextjs-app` ficava em 110-120% de
CPU, um núcleo cheio mais o que sobra de GC, enquanto o Postgres ficava em
4-10% e o host tinha mais três núcleos físicos parados. JavaScript roda numa
thread. Um processo Node, por mais máquina que você dê, usa um núcleo pra
executar o seu código.

### O vazamento: um flush por requisição

O teto de CPU era esperado. O que não era: o RSS do processo subia ~1,8 GB
a cada ~20 mil requisições e **não voltava** entre um teste e outro. Foi de
513 MB a 2,3 GB em cerca de 45 minutos de carga, e às 03:21 o heap acabou.
Os níveis da tabela acima foram medidos reiniciando o container antes de
cada um justamente por isso; duas rodadas que pegaram o processo já inchado
(400 VUs com 2 GB herdados, 350 com 2,35 GB) ficaram de fora, e a de 350
foi a que caiu no meio, com 2,5% de erro.

Reproduzi localmente, com o mesmo build standalone e o mesmo limite de heap,
e comparei heap snapshots antes e depois da carga. A causa está no commit
`b772a206`:

> 8.7k requests left 14k suspended flushes and 3.7k ServerResponse objects
> in the heap.

Duas linhas de código faziam `logger.flush()` do Axiom em toda requisição:
o wrapper dos route handlers (os callbacks padrão do
`createAxiomRouteHandler`) e o `proxy.ts`, que roda antes de **toda**
requisição, página inclusive:

```diff
-export function proxy(request: NextRequest, event: NextFetchEvent) {
+export function proxy(request: NextRequest) {
+  // No flush here: one per request queued behind the previous ones (see
+  // lib/axiom/server.ts). The barch client sends this within a second.
   logger.info(...transformMiddlewareRequest(request))
 
-  event.waitUntil(logger.flush())
-
```

O `@axiomhq/js` serializa os flushes, e cada um é um POST para o Axiom de
~400 ms. Isso dá poucos flushes por segundo de capacidade de escoamento,
contra dois por requisição chegando. A fila cresce sem limite, e cada flush
pendente vive dentro do contexto do `after()` da requisição que o criou —
o que mantém viva a requisição inteira, `ServerResponse` incluído. Não era
bug do Next nem do runtime: era a integração de log pedindo para enviar
agora, toda vez, algo que o próprio cliente já sabe agrupar (a cada 1
segundo ou 1.000 eventos). A correção foi parar de pedir. O custo aceito:
num deploy, até ~1 segundo de log ainda no buffer pode se perder quando o
container para.

Depois do deploy da correção, o processo passou a estabilizar em torno de
1 GB de RSS sob carga, que é o número que ficou registrado no comentário de
`infra/app.yml`.

## A ideia: se o processo usa um núcleo, rode um processo por núcleo

Sem o vazamento, o teto de ~45-51 req/s continuava lá, e por um motivo que
nenhuma correção de código remove: um processo, um núcleo. A saída mais
barata não é reescrever nada, é rodar várias cópias idênticas do mesmo
container atrás do nginx, que já estava na frente de tudo.

A parte que dá trabalho não é subir as cópias. É que tudo o que o app
guardava **na memória do processo** passa a existir N vezes, cada cópia com
a sua versão, e nenhuma sabe das outras. Sessões estavam no Postgres e o
rate limit do app no Redis, então isso já era compartilhado. O resto eu
precisei procurar.

## Como funciona: três cópias, depois cinco

O commit `d5626518` subiu três instâncias (`nexo-app-1..3`), cada uma
escutando só em loopback (`127.0.0.1:3001-3003`), atrás de um `upstream` do
nginx com `least_conn`. A escolha de `least_conn` em vez de round-robin é
porque o custo das requisições é muito desigual: uma página de marketing de
1 MB de HTML de um lado, `/api/users/me` do outro. Três, e não oito, porque
eram 4 núcleos físicos: com 8 instâncias, os pares de hyperthread disputariam
o mesmo núcleo, e ainda precisava sobrar CPU para Postgres, Redis, worker e
realtime.

O deploy virou rolling, uma instância por vez, cada uma saudável antes de a
próxima cair:

```bash
# One app instance at a time, each healthy before the next goes
# down, so nginx's upstream always has four left to serve from.
for svc in nexo-app-1 nexo-app-2 nexo-app-3 nexo-app-4 nexo-app-5; do
  docker compose up -d --no-deps "$svc"
  status=starting
  for _ in $(seq 1 30); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$svc")
    [ "$status" = healthy ] && break
    sleep 3
  done
  if [ "$status" != healthy ]; then
    echo "::error::$svc is $status after 90s, stopping the rollout"
    docker logs --tail 50 "$svc"
    exit 1
  fi
done
```

Esse trecho já é a versão de cinco. No mesmo dia a VM foi de 4 para 6
núcleos físicos (12 vCPU) e de 7,6 para 12 GB, e o commit `6208b16e` subiu
para cinco instâncias: cinco núcleos para o Next, um para Postgres, Redis,
nginx e o resto, ~5,5 GB de RAM sob carga.

### O que quebra quando o processo deixa de ser um só

**1. O rate limit do Better Auth virou cinco rate limits.** O app já contava
os próprios limites no Redis, mas o limitador embutido do Better Auth guarda
os contadores num `Map` do módulo, na memória do processo:

```js
// better-auth 1.7.5, dist/api/rate-limiter/index.mjs
const memory = /* @__PURE__ */ new Map();
```

A regra padrão de `/sign-in` é 3 tentativas a cada 10 segundos. Com o nginx
espalhando as requisições de um mesmo IP entre cinco processos, cada um com
o seu `Map`, o limite efetivo vira até 15 a cada 10 segundos, e muda conforme
o balanceador decide. O commit `dd34816f` pluga um `customStorage` no
Redis, um limitador do `rate-limiter-flexible` por regra do Better Auth, com
um limitador em memória de seguro para quando o Redis cair, igual aos do
app:

```ts
limiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: `rl:better-auth:${id}`,
  points: max,
  duration: window,
  insuranceLimiter: new RateLimiterMemory({
    points: max,
    duration: window,
    keyPrefix: `rl:better-auth:mem:${id}`,
  }),
})
```

Isso é diferente do problema de descobrir **qual** é o IP do cliente atrás
de nginx e Cloudflare, que tem
post próprio.

**2. `use cache` com `updateTag` limpa uma instância só.** O cache padrão do
`'use cache'` vive na memória de cada processo. A documentação desta versão
do Next diz isso sem rodeio: sem um cache handler compartilhado, "each
instance maintains its own cache independently — features still work
correctly on each instance, but revalidation events don't propagate across
instances". Na prática, um admin publica uma vaga, a action chama
`updateTag`, e só a instância que atendeu essa action limpa o cache; as
outras quatro continuam servindo a lista antiga até expirar. Por isso
`/careers` (`99d74fab`) não usa `'use cache'`: a página é texto estático, e
só a lista de vagas lê o banco, em streaming dentro de um `<Suspense>`. O
que continua com `'use cache'` são coisas que só mudam no deploy, como os
posts do blog, em que cinco caches independentes têm sempre o mesmo
conteúdo.

**3. O orçamento de conexões do Postgres multiplica.** Cada processo tem o
próprio pool de até `DB_POOL_MAX` (25) conexões. Isso já tinha sido
endereçado antes do teste, no `4ce4d075`, quando o app passou a falar com o
Postgres via pgbouncer em modo `transaction`: as 25 viram conexões de
cliente para o pooler, baratas, e o teto real no Postgres vira o
`DEFAULT_POOL_SIZE`, que vale por par usuário/banco, não por processo. Na
época eram três processos (app, worker e realtime): 75 de 200 vagas de
cliente, 20 das 100 conexões do Postgres. Com cinco instâncias do app, a
conta mudou duas vezes: o `DEFAULT_POOL_SIZE` foi de 20 para 40 (mais 5 de
reserva, 45 de 100 no Postgres), e o `MAX_CLIENT_CONN` de 200 para 300,
porque 5 × 25 mais worker e realtime deixariam o limite antigo quase sem
folga. Um detalhe: a URL **não** leva
`?pgbouncer=true`. Essa flag é para o engine do próprio Prisma, e este app
fala com o banco via `@prisma/adapter-pg`, que é node-postgres e não nomeia
prepared statements; testei as duas formas contra um banco real, e as duas
conectam.

**4. Duas versões no ar ao mesmo tempo.** Uma aba aberta durante um deploy
manda o id de uma Server Action que o build novo não conhece, e o Next
responde `Failed to find Server Action`. Quatro desses chegaram ao Sentry
(NEXOPM-5) antes do `c4fad13b`, que passou a definir `NEXT_DEPLOYMENT_ID`
com o commit sendo publicado: o cliente percebe a divergência pelo header da
resposta e recarrega a página em vez de disparar a action velha. Isso
nasceu antes das múltiplas instâncias, mas o rolling deploy deixa o
problema mais largo: durante a troca, que pode levar até 90 segundos por
instância, o mesmo `upstream` serve o build antigo e o novo ao mesmo tempo,
sem sticky session.

### O custo que as instâncias não resolviam: as páginas

Com três instâncias, o teste no próprio host (próxima seção) mostrou que a
CPU não estava indo para onde eu achava. Um profile de CPU num build local
mostrou que as páginas públicas custavam cerca de 4× a CPU de uma chamada
de API, e o motivo estava no layout raiz: ele fazia `await cookies()` e
`getSession()` acima de `{children}`, então **nenhuma** página podia ser
pré-renderizada. O shell estático de `/pricing` era um `<body>` vazio, e o
1 MB de HTML era renderizado a cada visita. Os commits `4c6d07ea` e
`087205dc` tiraram a leitura da requisição do layout raiz (consentimento de
cookies lido no navegador; quem tem sessão vai de `/` para `/home`), e o
`164c94b1` passou a compressão do Node para o nginx: localmente, as páginas
estáticas foram de 16,6 para 6,2 ms de CPU por requisição só com isso. Mais
tarde, o `26690cfc` tirou ~550 ícones repetidos da tabela de preços, e o HTML
de `/pricing` caiu de 1,04 MB para 653 KB.

Isso importa para ler os resultados: o "depois" não é só "cinco instâncias".
É cinco instâncias, numa VM maior, com páginas mais baratas.

## Resultados

### No próprio host, sem a rede no meio

Para medir o servidor e não o caminho até ele, rodei o k6 no próprio host,
com a pausa entre requisições já em 3 a 15 segundos (`c7a06b80`, média de 9
s, ~35% menos requisições por VU do que 5-7 s) e meta de p95 < 500 ms e
p99 < 1 s na API. A instância única foi medida contra `localhost:3000`; a
partir de três instâncias, passando pelo nginx com TLS em `127.0.0.1`.

| Configuração | Usuários dentro da meta | Fonte |
|---|---|---|
| 1 instância, 8 vCPU | ~400 | mensagem do `d5626518` |
| 3 instâncias, 8 vCPU | 800 | mensagem do `6208b16e` |
| 5 instâncias, 12 vCPU, páginas corrigidas | 1.200 VUs: p95 137 ms / p99 238 ms | nota do teste, 16/10 |
| idem | 1.600 VUs: p95 542 ms / p99 1,18 s (passou um pouco) | nota do teste, 16/10 |

De ~400 para ~1.500 usuários dentro da meta, sem nenhum erro, com o gerador
de carga disputando CPU com o próprio app.

### De fora, pelo mesmo caminho de um usuário

Em 17/10 o domínio passou a ficar atrás da Cloudflare (`464e964b`), e o
deploy de `0beed010` levou junto tudo o que veio depois: páginas privadas
em streaming, o `/pricing` menor, o CI. Com ele no ar, rodei três vezes o
mesmo workflow do GitHub com 1.500 VUs, 4 minutos de rampa e 5 de platô:

| Run | Requisições | Erros | p95 / p99 API | p95 / p99 página | Vazão no platô |
|---|---|---|---|---|---|
| `39080597950` | 70.551 | 0 | 598 / 789 ms | 681 / 845 ms | 160,3 req/s |
| `39083533814` | 70.596 | 0 | 594 / 774 ms | 684 / 835 ms | 160,3 req/s |
| `39084232455` | 70.503 | 3 | 603 / 774 ms | 704 / 850 ms | 159,7 req/s |
| `39081240533` (20 VUs, servidor ocioso) | 196 | 0 | 260 / 541 ms | 667 / 684 ms | ~2 req/s |

Três falhas em ~211 mil requisições. As páginas praticamente não pioram sob
carga: 667 ms de p95 com o servidor ocioso, 681-704 ms com 1.500 VUs.

![p95 da API, medido do runner do GitHub, contra a vazão sustentada no platô: com uma instância, a latência explode perto de 51 req/s; com cinco instâncias, 1.500 VUs sustentam ~160 req/s com p95 de 594-603 ms](/img/from-one-to-five-nextjs-instances/pt/p95-api-vs-vazao.png)

A comparação direta por VU engana, porque o modelo de pausa mudou no meio:
1.500 VUs com pausa média de 9 s pedem mais ou menos o mesmo que 1.000 VUs
com 6 s. Por isso o gráfico usa vazão no eixo X. Com uma instância, o
servidor não passava de ~51 req/s, e lá o p95 da API já estava em 4,4 s.
Com cinco, ~160 req/s saem com p95 de ~600 ms medido do outro lado do
continente. E 160 não é o teto: é só o que 1.500 VUs nessa cadência pedem.

Desses ~600 ms, boa parte é estrada. Com o servidor ocioso, a mediana da
API vista do runner é 223 ms, quase toda rede e TLS. Descontando ~220 ms, o p95 do servidor a
1.500 VUs fica perto de 380 ms. É uma subtração grosseira, um p95 menos uma
mediana, e não uma medição: trato como ordem de grandeza. A medição que
sobra é a que importa para um usuário no Brasil: enquanto o GitHub gerava
os 1.500 VUs, rodei 20 VUs da minha máquina, pelo edge da Cloudflare em
Guarulhos, e a API ficou em **p95 de 300 ms** (mediana de 68 ms), as páginas
em **378 ms**.

## Onde quebrou, e o que este teste não mede

**O gerador está longe, e um dos números que eu usei está inflado por um
erro meu.** O runner do GitHub fica fora do Brasil, e cada requisição paga
~220 ms de rede antes de o servidor começar a trabalhar. Isso eu sabia. O
que eu não sabia até escrever este post: o header que deveria pedir
compressão em `k6/load.js` está escrito `'Accept-Enconding'`, com um "n" a
mais, desde o commit que o criou. O k6 nunca pediu compressão. Os bytes
recebidos confirmam: ~185 KB por requisição em média nos testes de 16/10
(~157 KB depois da `/pricing` menor), compatível com HTML cru, não com os
~42 KB que uma página comprimida pesaria. Então o "~1 s de rede" das
páginas medidas do runner não é só distância: é baixar meio megabyte sem
gzip atravessando um continente. Os números de API, que são JSON pequeno,
são muito menos afetados. Fica para corrigir antes da próxima rodada, e a
comparação de páginas entre runner e máquina local não deve ser lida como
custo puro de rede.

**Gerar a carga perto do servidor também não é limpo.** Os números do host
rodaram o k6 na mesma VM que serve a Nexo, disputando CPU com as cinco
instâncias, o Postgres e o TLS do nginx. Isso deixa os números pessimistas
para o servidor, mas significa que "~1.500 usuários dentro da meta" foi
medido num host que estava fazendo duas coisas ao mesmo tempo. E da minha
máquina, de 4 núcleos e conexão residencial, os 1.500 VUs não saem: tentei,
deu 44% de falha por timeout no gerador. Ela só serve para medir com poucas
VUs enquanto outro gera a carga.

**VU continua não sendo usuário.** Uma VU aqui faz login uma vez e depois
uma requisição a cada 3-15 s, com quatro páginas públicas e três endpoints
de API. Usuário de verdade baixa JavaScript, CSS e imagens (a Cloudflare
agora absorve os estáticos), dispara prefetch de links, abre WebSocket do
realtime e navega por páginas do workspace. Nada disso está no cenário.

**A navegação logada não foi testada sob carga.** As páginas do workspace
foram reescritas para renderizar o cabeçalho na hora e o conteúdo em
streaming, e nenhuma delas está no cenário. O teste de
carga de navegação logada é o que ficou pendente. O cenário atual exercita
a API autenticada, não o render das páginas privadas.

**Os números do host não têm um run público.** Os do GitHub qualquer um
confere: run id, artefato JSON, log. Os do k6 no host, não: estão nas
mensagens dos commits e nas minhas notas, e eu não separei de forma limpa
quanto do ganho veio das cinco instâncias e quanto veio das páginas mais
baratas, porque mudei as duas coisas no mesmo dia. O heap snapshot também
foi feito localmente, numa reprodução com 200 VUs por 4 minutos, não em
produção; em produção o que eu tenho é a curva de RSS antes e depois. E a
configuração do `upstream` do nginx em produção não está versionada no
repositório (só a de IP real da Cloudflare está), então o `least_conn` que
eu descrevo, por enquanto, você tem que acreditar.

**O estado por instância não acabou, só foi listado.** Rate limit e conexões
foram resolvidos. O cache do `'use cache'` foi contornado por decisão
página a página, não resolvido com um cache handler compartilhado: a
próxima página que precisar de cache com invalidação vai ter de lembrar
disso, e nada no build avisa. O gate de concorrência do argon2
(`AUTH_VERIFY_CONCURRENCY`) também é por instância; aí isso é desejado,
porque a capacidade de login cresce junto, mas vale saber que o número de
logins simultâneos permitido é cinco vezes o valor configurado. E a janela
de duas versões no ar durante o rolling deploy eu não testei: sei que ela
existe, não sei o que um cliente vê se for parar no build antigo depois de
ter carregado o novo.

## O que isso prova, e o que não prova

Prova que, em produção real, o teto de uma instância era CPU de uma thread
(~51 req/s no platô, com o Postgres a 4-10%), e que cinco instâncias atrás
do nginx, numa VM de 6 núcleos físicos e com as páginas públicas
pré-renderizadas, sustentam ~160 req/s por 5 minutos com 1.500 VUs, três
vezes, com 3 falhas em ~211 mil requisições. Prova que a queda por memória
tinha uma causa de uma linha, um flush de log por requisição, e que ela
estava escondida atrás do teto de CPU até alguém aplicar carga por tempo
suficiente. E prova que replicar um processo é a parte fácil: o trabalho de
verdade foi achar tudo o que vivia na memória dele.

Não prova quantos usuários reais a Nexo aguenta: o cenário não navega por
páginas logadas, não baixa assets e roda com uma cadência que eu escolhi.
Não separa quanto do ganho é instância e quanto é página mais barata. Não
prova que 160 req/s é o teto do hardware atual, porque nenhum dos testes de
fora chegou a saturá-lo. E não prova nada sobre deploy sob carga, porque
nenhum deploy aconteceu durante um teste.
