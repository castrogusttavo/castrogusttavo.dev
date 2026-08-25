---
title: O que eu faria para a Nexo aguentar 1 milhão de usuários
description: "Rodei testes de carga reais contra a Nexo até achar por que /issues quebra bem antes de 1M de usuários — uma query sem paginação devolvendo 8,6MB por request —, implementei a correção e quatro camadas de infra, validei em produção real, e descobri que consertar isso só revelou um teto maior escondido atrás: login, protegido por um algoritmo deliberadamente caro de CPU."
icon: rocket
date: "2026-08-22"
---

Rodei um teste de carga contra a produção real da Nexo, o SaaS de gestão de
projetos que ajudo a construir. Levei 200 clientes simultâneos batendo na
rota mais usada da plataforma, `/issues`, e antes dos primeiros trinta
segundos de pressão o servidor já estava devolvendo `500` — não devagar,
errado. Quase metade dos requests falhou. O host tem 8 núcleos e ficou com
apenas 22% de CPU ocupada quando isso aconteceu. O gargalo não era
processamento.

Isso é o ponto de partida deste post — mas não o fim dele. Não é "como eu
provei que a Nexo aguenta 1 milhão de usuários" — ainda não aguenta. É o
relato de implementar a correção de verdade, medir o resultado em produção
real, e descobrir que consertar o problema que eu via escondia um problema
maior que eu não via.

## O problema: uma rota que devolve 8,6MB por request

`/issues` é a lista de tarefas de um projeto — a tela mais acessada da
plataforma, por definição. A implementação atual (`IssueRepository.listByProject`)
busca todas as issues do projeto de uma vez, sem `take`, `skip` ou cursor.
Com um projeto de 15 mil issues (uma escala razoável pra um workspace grande,
não um caso extremo), isso é um payload JSON de **8,6MB por request**.

Sem concorrência nenhuma, isso já custa 450-600ms por chamada — a
serialização de um objeto desse tamanho não é grátis. Sob concorrência real,
o custo deixa de ser latência e vira colapso: com 15 usuários simultâneos
batendo nessa rota, o p50 sobe de ~1s para quase 12 segundos, e o p95 passa
de 3,5s para mais de 25s.

![Latência p50 e p95 de /issues: baseline em ~1s/3,5s contra ~12s/25s sob stress test com rampa até 200 VUs](/img/scaling-nexo-1m-users/pt/latencia-baseline-vs-colapso.png)

O reflexo mais direto disso é CPU: como o Node.js roda a serialização desse
JSON gigante numa única thread, o processo satura um core inteiro e nunca
recupera enquanto a carga persiste — de 88% a 109% de uso ao longo do teste,
subindo de forma monótona, sem platô.

![CPU do processo Node ao longo do stress test: sobe de 88% para 109% de forma contínua e nunca recupera](/img/scaling-nexo-1m-users/pt/cpu-single-thread-satura.png)

Isso não é um problema de infraestrutura. É um problema de contrato de API:
a rota promete "todas as issues do projeto" em uma resposta só, e esse
contrato não escala com o tamanho do projeto — só piora conforme a Nexo
cresce, mesmo sem trocar uma linha de infra.

## A ideia: deixar os números escolherem o próximo passo, não a intuição

A tentação óbvia diante de "o servidor está devagar sob carga" é aumentar
alguma coisa — mais conexões de banco, mais réplicas, uma máquina maior.
O problema é que cada uma dessas mudanças custa dinheiro e tempo de operação,
e só uma parcela pequena delas realmente ataca o gargalo real. Testei cada
hipótese isolada, uma de cada vez, e deixei os dados decidirem — em vez de
aplicar as três de uma vez e nunca saber qual delas importou.

A primeira hipótese testada — e descartada — foi o pool de conexões do
Postgres. `DB_POOL_MAX` estava travado em 5; subi para 20 esperando um
ganho real.

![Requests processados antes do colapso: 639 com pool=5 contra 785 com pool=20 — ganho pequeno, mesmo padrão de falha](/img/scaling-nexo-1m-users/pt/pool-nao-e-o-gargalo.png)

O ganho foi de 639 para 785 requests processados antes do sistema colapsar —
positivo, mas marginal, e o padrão de falha continuou idêntico. Isso confirma
o que a CPU já mostrava: o pool nunca foi o teto. Aumentar conexões de banco
pra um processo que está gastando um core inteiro serializando JSON é
resolver o problema errado.

## Arquitetura: da causa raiz até um desenho pra escala real

A correção estrutural é paginação de verdade em `GET
/api/workspaces/[id]/projects/[slug]/issues` — `limit`/`cursor` opcionais,
mantendo o comportamento atual quando nenhum parâmetro é passado, pra não
quebrar o client que já consome essa rota. Essa mudança altera um contrato
de API real em produção, então implementei num branch separado
(`perf/scale-1m-users`), com paginação cursor-based (`Issue.number`, já
único e imutável por projeto — não precisou de migration nenhuma) e reescrevi
o hook cliente (`useIssues`) pra `useInfiniteQuery`, buscando todas as
páginas automaticamente em segundo plano. O resultado visual pro usuário é
idêntico — a lista continua completa — mas o servidor para de fazer um
`JSON.stringify` gigante de uma vez só; faz vários pequenos.

Só que paginação sozinha não é a história inteira. Enquanto a causa raiz não
está corrigida, testei o que acontece escalando horizontalmente por cima
dela — porque é exatamente isso que qualquer time faria sob pressão de
produção antes de conseguir revisar e mergear uma mudança de contrato de
API. Com 4 instâncias do processo Node (uma por core), sem tocar em nenhuma
linha de código de aplicação:

![Requests processados: 639-785 com uma instância contra 1.245 com 4 instâncias — mais throughput bruto, sem resolver a causa](/img/scaling-nexo-1m-users/pt/escalonamento-horizontal-throughput.png)

O ganho é real — de ~785 para 1.245 requests processados antes de degradar,
CPU por instância caindo para 54-60% (bem abaixo dos 88-109% de antes). Mas
o gargalo não desaparece, só se move: o Postgres compartilhado, que ficava
essencialmente ocioso com uma instância só, passou a oscilar entre 30% e
194% de CPU — porque agora são 4 processos rodando a mesma query cara, em
paralelo, contra o mesmo banco.

![CPU do container Postgres durante o teste com 4 instâncias: de ~0% ocioso para picos de 194%](/img/scaling-nexo-1m-users/pt/gargalo-move-pro-postgres.png)

Essa cadeia de evidência — não escalar às cegas — é o que virou o desenho de
arquitetura pra escala real. "1 milhão de usuários" não é uma carga, é uma
população; pra um SaaS de gestão de projetos, DAU realista fica em torno de
10-20%, e concorrência de pico numa fração menor ainda disso — o alvo de
capacidade que usei foi algo entre 500 e 1.500 requisições/segundo
sustentadas no endpoint mais pesado, não 1 milhão de conexões simultâneas.
Mantendo a mesma filosofia de infra que a Nexo já usa hoje (self-hosted,
Docker, sem trocar de nuvem gerenciada), a ordem de mudanças foi sempre
ligada a um achado específico dos testes — e, diferente da primeira versão
deste post, as cinco primeiras linhas da tabela abaixo não são mais
proposta: foram implementadas e testadas uma de cada vez no branch
`perf/scale-1m-users`, cada uma com seu próprio antes/depois medido.

| # | Camada | Mudança | Status | Por quê |
|---|---|---|---|---|
| 1 | App | Paginação/cursor em `/issues` (`Issue.number` como cursor, sem migration) | **Implementado** | Causa raiz confirmada — nenhuma infra resolve um payload que cresce sem limite |
| 2 | Cache | Redis cacheia resposta paginada por projeto+página, invalidada em escrita por versionamento (`INCR`, não `SCAN`+`DEL`) | **Implementado** | Reduz o fan-out de leitura antes de chegar no banco |
| 3 | Edge + App tier | nginx como LB real (4 instâncias nomeadas, health check passivo `max_fails`/`fail_timeout`) em vez do hack manual de portas | **Implementado** | Health check ativo é recurso pago do nginx; o passivo já resolve o caso real |
| 4 | Banco | PgBouncer em modo de pooling de transação na frente do Postgres | **Implementado** | Múltiplos nós de app × pool cada estoura `max_connections` rápido |
| 5 | Banco | Réplica de leitura via streaming replication (`pg_basebackup -R`), `/issues` roteado pra ela | **Implementado** | O Postgres foi de ocioso a 194% de CPU só com 4 processos em paralelo |
| 6 | App tier | Múltiplos nós físicos, com mais RAM que os 3,7GB usados hoje | Não implementável num único worktree | RAM chegou a 70% do host só com o teste de produção — pouca margem pra mais réplicas |
| 7 | Edge | CDN só para os assets estáticos do Next.js | Decisão de deploy, não de código | Assets já têm `Cache-Control` de longa duração; CDN é ortogonal a onde o app/DB rodam |
| 8 | Observabilidade | Prometheus + Grafana com alerta nos sinais que caçei manualmente aqui | Fora de escopo (decisão explícita) | Todo achado deste post veio de `ps`/`docker stats` rodado à mão — não escala pra produção real |

Sharding de tenant — particionar tabelas grandes por `workspace_id`, ou até
clusters de Postgres separados por faixa de tenant — fica de fora
deliberadamente. É a alavanca mais cara e mais difícil de reverter; só entra
em cena se, mesmo com paginação, cache e réplicas, o primary continuar sendo
o teto.

## Resultados: implementação, validação, e o problema escondido atrás do primeiro

Esta seção documentava só o "antes" na primeira versão deste post. Agora
documenta três coisas: como a paginação sozinha se comportou em produção
real, como as cinco camadas se comportaram juntas, e o que apareceu depois
que a causa raiz original parou de ser o gargalo dominante.

### A linha de base em produção real, sem paginação

Antes de implementar qualquer camada, repeti o teste local contra o
servidor de produção real da Nexo (8 núcleos, 3,7GB de RAM), pré-lançamento
e sem usuários reais ainda — rodando k6 no próprio host, contornando o
nginx (que tem rate limit por IP real e corretamente bloqueia um teste de
carga de máquina única em segundos — resultado válido por si só: a proteção
contra abuso funciona).

A rampa completa, de 10 a 200 clientes simultâneos, rodou até o fim sem
colapso total — algo que nenhuma rodada com uma única instância local
tinha conseguido. Login teve 100% de sucesso (1.382/1.382). `/issues`
(ainda sem paginação nesse ponto) teve 52,3% de sucesso (645/1.233) — e
aqui vale uma correção que já registrei no log na hora: a primeira leitura
que fiz desse resultado dizia "a maioria das falhas foi timeout de 30s".
Errado. Contando por status HTTP real, são **567 respostas `500`
explícitas** e 21 `401` — zero timeout de fato. O servidor não estava só
lento, estava ativamente devolvendo erro sob carga.

![Falhas em produção por status HTTP: 567 respostas 500, 21 respostas 401, zero timeout de fato](/img/scaling-nexo-1m-users/pt/producao-real-status-http.png)

O achado que não tinha aparecido nos testes locais: RAM, não só CPU. O
container da aplicação chegou a 2,6GB de pico, de 3,7GB totais do host —
70% da memória disponível, enquanto a CPU ficou em apenas 176% dos 800%
disponíveis (8 núcleos). O mesmo payload de 8,6MB por request, empilhado
sob concorrência, quase esgota a memória de uma instância de produção real
antes mesmo de saturar CPU — um risco de OOM que só aparece testando
hardware do tamanho real.

![CPU e RAM do container da aplicação em produção durante o teste: CPU pica em 176% de 800% disponíveis, RAM chega a 2,6GB de 3,7GB totais](/img/scaling-nexo-1m-users/pt/producao-real-cpu-ram.png)

### A paginação sozinha, em produção real

Depois de implementar a Camada 1, testei ela isolada no mesmo servidor,
mesma metodologia. O payload de uma página (`?limit=1000`) caiu de 8,6MB
para **586KB** — quinze vezes menor — e confirmei que omitir o parâmetro
continua devolvendo os 8,6MB de sempre, provando retrocompatibilidade
real, não só no papel.

### As cinco camadas juntas, testadas de ponta a ponta

Com paginação, cache, LB+4 instâncias, PgBouncer e réplica de leitura todos
implementados e rodando juntos (worktree local), repeti a rampa de 10 a 200
VUs do Experimento 1 — a mesma que colapsava em ~100-180 VUs com 51-52% de
falha na Rodada 1.

- **Completa sem abortar**, com só **2,13% de falha residual**
- **3.378 requests** processados numa única instância paginada — 3,8× o
  melhor resultado de instância única antes da correção (785-934)
- Conexões reais no Postgres caem pra uma dúzia via PgBouncer; leitura de
  `/issues` migra pra réplica, confirmado por streaming replication de
  verdade (`pg_basebackup -R`), não simulado — testei escrever no primário
  e ler de volta pela réplica imediatamente depois, e o dado já estava lá
- **Failover real**: matei uma das 4 instâncias no meio do teste —
  171 de 171 requests seguintes tiveram sucesso, o nginx roteou em torno
  dela sem intervenção
- `k6/flows.js` completo (login → home → issues → onboarding) contra a
  pilha inteira: **2.248 de 2.248 checks, 100% de sucesso**

O padrão que se repetiu nas cinco camadas: a implementação em si raramente
foi o problema — foram **15 bugs reais** (um typo, uma race condition no
cache, cinco problemas de ambiente no LB, uma imagem Docker inexistente,
dois bugs no entrypoint da réplica, entre outros) que só apareceram
rodando cada camada de verdade, nunca lendo o código. Nenhum sobreviveu
sem correção antes do número final entrar no log.

### O problema que a correção escondia: login virou o novo teto

Testar a pilha completa contra tráfego cada vez maior — a pergunta óbvia
depois de "funciona" é "até onde" — esbarrou num problema de metodologia
primeiro: rodar o gerador de carga (k6) na mesma máquina de 4 núcleos que
hospedava a pilha inteira (9 containers) saturava o host inteiro, não só a
aplicação. `vmstat` mostrou 80-86% de CPU ocupada com fila de até 80
processos brigando por 4 núcleos — um artefato de teste, não um achado de
arquitetura, descartado do resultado pelo mesmo motivo que descartei o
"achado" do `next start` lá na Nota do início deste log.

O teste limpo — produção real, 8 núcleos, `/issues` já paginado — revelou
algo mais interessante que um artefato: `/issues` autenticado ficou rápido
de verdade (**p50 = 154ms**), mas **login** (`POST /api/auth/sign-in/email`)
tinha p50 de **quase 60 segundos** sob a mesma rajada. A causa raiz original
parou de ser o teto, e um segundo gargalo — que sempre esteve lá, só
escondido atrás do primeiro — ficou visível.

A causa: `argon2.verify()` roda nos parâmetros **padrão da própria lib**
(`memoryCost: 64MB`, `parallelism: 4` — cada verificação individual já
tenta usar 4 threads sozinha), desenhados pra um hash isolado rápido numa
máquina dedicada, não pra dezenas de logins concorrentes num SaaS. Isolando
só o login (sem `/issues` junto, 400 VUs com cadência real de 1-2s entre
tentativas — não loop apertado), o processo já saturava **571% de CPU**, de
800% disponíveis.

Corrigir isso levou quatro tentativas, e nem todas ajudaram — o que, pro
propósito deste post, é tão importante de mostrar quanto a que funcionou:

![p95 de latência de login em 400 VUs simultâneos, ao longo de quatro tentativas de correção até o backpressure resolver de verdade](/img/scaling-nexo-1m-users/pt/login-p95-jornada.png)

1. **Preset OWASP de argon2** (`memoryCost: 19MB`, `timeCost: 2`,
   `parallelism: 1`) — testado antes num worktree de 4 núcleos, cortou p95
   em ~3× e zerou erro. Em produção (8 núcleos), **não ajudou quase nada**
   (13,1s → 14,7s de p95) — algo mais estava segurando a fila com peso
   parecido, escondendo o ganho.
2. **`UV_THREADPOOL_SIZE=8`** — hipótese: argon2 roda no threadpool do
   libuv, travado em 4 slots por padrão, independente dos 8 núcleos reais.
   Subir pra 8 **piorou**, de forma reproduzível (14,7s → 17,05s, repetido
   duas vezes com resultado quase idêntico). Provável explicação: threadpool
   igual ao número de núcleos não deixa folga nenhuma pra thread principal
   do Node e coleta de lixo — 4 slots sobrava exatamente essa folga.
3. **O culpado real**: `DB_POOL_MAX` nunca tinha sido setado em produção —
   caía no default do código, **5**, o mesmo valor descartado como gargalo
   lá no Experimento 1/2 (só que naquela época escondido pelo gargalo maior
   de CPU do `/issues`). Login faz lookup de usuário + verificação + escrita
   de sessão, todas competindo pelas mesmas 5 vagas. Subir pra 25 deu o
   melhor resultado até então (17,05s → 12,71s) — confirma que o pool era
   parte real do problema, mas não fecha ele sozinho.
4. **O fix de verdade**: um gate de concorrência em memória
   (`src/lib/auth-concurrency-gate.ts`), limitando `argon2.verify()` a
   poucas chamadas simultâneas com fila curta e timeout — passado isso,
   rejeita com `429`/`Retry-After` em milissegundos em vez de deixar o
   request pendurado. O client tenta de novo automaticamente até 2 vezes
   com backoff. Resultado: **p95 de 12,71s pra 1,18s**, com 83% de sucesso
   final (depois do retry) contra 400 logins simultâneos — o melhor
   throughput do dia inteiro de testes (26,63 fluxos/s).

CPU não mudou em nenhuma dessas quatro tentativas (fica em 570-600% o tempo
todo) — porque nenhuma delas reduz o custo real de verificar uma senha. O
que mudou foi o que acontece quando esse custo é maior que a capacidade
disponível: antes, uma fila invisível de até 25 segundos sem feedback;
depois, sucesso quase instantâneo pra quem cabe no orçamento, e uma
resposta clara e imediata pra quem não cabe.

Ainda assim, **17% dos logins não se recuperam nem depois de 2 tentativas**
de retry, com 400 tentativas simultâneas na mesma instância. Decisão
consciente: não persegui esse número mais nesta rodada — é um cenário de
pico bem mais extremo do que "1 milhão de usuários" sugere à primeira
vista (login é evento pontual por sessão, não tráfego contínuo), e a
Nexo, pré-lançamento, não tem hoje motivo pra esperar esse padrão de
tráfego. Fica registrado como decisão de produto revisável, não como
limitação técnica não resolvida.

## Onde quebrou — e o que este teste não prova

O ponto mais frágil de todo esse trabalho é a unidade de medida. "200 VUs"
no k6 não é "200 usuários". Uma VU roda em loop, sem pausa nenhuma entre
requests — uma única VU sem concorrência fez 258 requests em 3 segundos
contra `/issues`, um volume que nenhum humano gera. Um usuário real bate
nessa rota talvez uma vez a cada 15-20 segundos.

![Taxa de request de 1 VU do k6 (86 req/s) contra estimativa de um usuário real (~0,04 req/s), em escala logarítmica](/img/scaling-nexo-1m-users/pt/vu-nao-e-usuario-real.png)

Isso significa duas coisas ao mesmo tempo, e as duas importam: o teste é mais
agressivo que tráfego real, então "quebrou com 200 VUs" não é "quebra com
200 usuários reais" — a base real provavelmente aguenta mais gente
navegando normalmente do que essa rampa sugere. Mas também significa que o
alvo de 500-1.500 requisições/segundo que usei pro desenho de arquitetura é
uma estimativa de fundo de envelope, não algo medido contra um volume real
de 1 milhão de contas — que a Nexo, sendo pré-lançamento, ainda não tem.

A lacuna mais importante desta rodada: as três camadas mais pesadas de
infra — nginx como LB real, PgBouncer e a réplica de leitura — foram
implementadas e validadas **só no worktree local** (4 núcleos). Elas nunca
foram deployadas em produção. O que rodou em produção de verdade foi
paginação, cache, o ajuste de argon2, o pool de conexão e o gate de
backpressure — cinco mudanças reais, mas não as cinco camadas de infra da
tabela inteira. Os números de failover (171/171) e de throughput com 4
instâncias (3.378 req) são reais e medidos, só que num hardware mais fraco
que o de produção, não no ambiente final. Isso é uma lacuna a fechar antes
de considerar a tabela "pronta", não um detalhe cosmético.

O outro ponto sem resposta limpa: mesmo depois de todo esse trabalho, não
tenho um número validado de "quantos usuários reais sustentados" a Nexo
aguenta hoje. Toda tentativa de achar esse teto esbarrou em outra coisa
primeiro — inicialmente no gargalo de `/issues`, depois num artefato de
metodologia (rodar o gerador de carga na mesma máquina de 4 núcleos que
hospedava a pilha inteira, que satura o host inteiro e não só a aplicação
— descartei esses números do resultado final, mesmo espírito da correção
do `next start` lá no início deste log), e por fim no gargalo de login. O
que tenho é o teto de login concorrente (~400 antes de degradar) e a
saúde de `/issues` autenticado (p50 154ms) — não uma curva completa de
usuários simultâneos sustentados.

## O que isso prova, e o que não prova

Isso prova, com número real medido em produção e não achismo, que a causa
raiz identificada na primeira rodada — `/issues` sem paginação saturando
CPU e RAM — foi corrigida de verdade: payload 15× menor, retrocompatível,
validado isolado e junto com quatro outras camadas de infra. E prova algo
que eu não esperava quando comecei a escrever a primeira versão deste
post: corrigir a causa raiz visível não termina o trabalho, revela a
próxima. Login, protegido por um algoritmo deliberadamente caro de CPU,
virou o teto real assim que `/issues` parou de ser — e esse teto não se
resolve com mais infra (escalar horizontalmente não barateia um hash),
só com uma mudança de comportamento sob sobrecarga: falhar rápido e claro
em vez de deixar o usuário esperando em silêncio.

Não prova que a Nexo aguenta 1 milhão de usuários — ainda não aguenta, e
esse nunca foi o objetivo real. Não prova que as três camadas de infra
mais pesadas (LB real, PgBouncer, réplica) funcionam em produção — só no
worktree local, hardware mais fraco. E não prova qual é o teto de
usuários reais *sustentados* — só o de login em rajada extrema, que é uma
pergunta diferente e mais estreita. O que este post prova é o método:
implementar uma camada de cada vez, medir contra o hardware real sempre
que possível, admitir quando uma correção não ajuda (o `UV_THREADPOOL_SIZE`
piorou as coisas, de forma reproduzível — isso também é dado), e deixar
os números decidirem qual é o próximo problema, não a intuição sobre qual
deveria ser.
