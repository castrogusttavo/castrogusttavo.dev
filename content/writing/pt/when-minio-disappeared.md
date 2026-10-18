---
title: O dia em que o MinIO sumiu — trocar o object storage de produção sem uma sessão de shell
description: "Numa manhã de setembro o CI da Nexo ficou vermelho sem nenhum commit meu: a MinIO tinha retirado a distribuição pública inteira — quay.io em 401, Docker Hub negando, dl.min.io em 410, repositório arquivado. Este é o relato da troca pelo Silo, um fork AGPL: validar todas as operações S3 que o app faz e o formato em disco antes de adotar, migrar produção por um workflow disparável com backup e sha256, um rollback automático que disparou pelo motivo errado, e a descoberta de que o compose de produção e o do repositório eram dois arquivos diferentes com o mesmo nome."
icon: terminal
date: "2026-11-24"
---

Em 24 de setembro, às 10h20, o job de e2e da Nexo falhou com uma linha
que não tinha nada a ver com o commit que ele estava testando:

```
docker: error from registry: access to the requested resource is not authorized
```

O commit era uma mudança na página de status. O passo que quebrou era o
`Start MinIO`, que sobe o object storage pro e2e rodar contra ele — o
mesmo passo que tinha passado verde na véspera, com a mesma tag pinada.
Ninguém tinha mexido no `ci.yml`. O que mudou foi o mundo do lado de fora
dele.

## O problema: um pin não protege contra o registry sumir

Quatro dias antes, no post sobre a [arquitetura da Nexo](/pt/writing/nexo-architecture),
eu tinha escrito que o MinIO passara a vir do `quay.io` porque a MinIO
parou de publicar imagem no Docker Hub. Naquela manhã o `quay.io` também
fechou. Conferi cada canal de distribuição antes de concluir qualquer
coisa:

```
quay.io/minio/minio (qualquer tag, inclusive RELEASE.2025-09-07) → 401
API do quay para o repositório                                   → "Requires authentication"
docker.io/minio/minio, minio/mc                                  → acesso negado
dl.min.io (binário do servidor)                                  → 410 Gone
github.com/minio/minio                                           → AGPL, arquivado em abril
```

Não era rate limit nem instabilidade: não existia mais nenhuma tag
pública que funcionasse, nem espelho. O que a MinIO continua publicando é
o `quay.io/minio/aistor`, a linha comercial. Testei a faixa gratuita: a
imagem baixa sem autenticação, o container sobe, formata o pool — e então
**nega toda operação S3** com `No license is installed`. A licença
gratuita existe, mas é um arquivo que eu teria que manter em três lugares
(CI, desenvolvimento e produção) e cuja ausência não degrada nada: derruba
tudo.

O que eu consigo provar disso hoje, de fora, sem depender do meu log: o
repositório `minio/minio` no GitHub está marcado como arquivado (último
push em 24/04/2026), e em 17/10/2026 o `dl.min.io` ainda responde 410 pro
binário do servidor e o registry do `quay.io` emite um token anônimo com
a lista de ações vazia pro `minio/minio` — ou seja, 401 no manifesto. Não
sei o motivo nem a data exata de cada retirada além do que eu vi naquela
manhã, e não vou especular sobre isso aqui.

O CI era o sintoma barato. O problema caro estava em produção: o servidor
rodava `minio/minio:RELEASE.2025-02-28` a partir do cache local do Docker.
Funcionava. Mas era uma imagem que **ninguém no mundo conseguia mais
baixar** — se o cache sumisse, se o disco fosse trocado, se alguém
rodasse um `docker image prune`, o storage não voltava. Um pin protege
contra o upstream mudar o que uma tag aponta; não protege contra o
upstream deixar de existir.

## A ideia: validar antes de adotar, e operar produção com log

A saída que eu escolhi foi o [pgsty/silo](https://github.com/pgsty/silo),
fork AGPL do último servidor open-source da MinIO, mantido pelo pessoal
do Pigsty, que o roda como repositório de backup do próprio PostgreSQL
deles. Mas "é um fork, deve ser compatível" é exatamente o tipo de frase
que vira incidente. Então a regra foi: nada troca antes de duas provas.

A segunda decisão foi sobre *como* mexer em produção. Eu não tenho SSH
por chave configurado pra essa operação, e o runner self-hosted do GitHub
Actions vive na mesma máquina que a produção. Isso transforma um workflow
disparável numa ferramenta de operação melhor que um terminal: cada passo
fica num log que eu (ou qualquer pessoa com acesso ao repositório) consigo
reler depois, em vez de uma sessão de shell que ninguém revisa.

## Como funcionou

### Duas provas antes de trocar a imagem

**Todas as operações que a aplicação faz**, rodadas com o próprio
`src/lib/storage/s3.ts` contra o Silo: `ListBuckets` (que é o probe da
página de status), `CreateBucket`, `HeadBucket`, `PutObject`, `GetObject`
e um `PUT` por URL pré-assinada — o caminho dos uploads que saem do
navegador direto pro storage.

**Compatibilidade de dados**: gravei bucket, objeto e *bucket policy*
pública com a imagem antiga do MinIO, parei o container e subi o Silo
**no mesmo diretório**. Tudo sobreviveu: mesmo formato em disco, mesmo
comando (`server /data`), mesmas variáveis `MINIO_*`, mesmo
`/minio/health/live`, mesmo `mc` embutido que o healthcheck do compose
chama. Isso é o que torna a migração de produção uma troca de container,
não uma cópia de dados.

Essas duas provas foram feitas na minha máquina e estão registradas na
mensagem do commit que trocou a imagem do CI (`93b55b4c`), não como uma
suíte de teste no repositório. A mudança no CI em si é uma linha:

```diff
-            quay.io/minio/minio:RELEASE.2025-02-28T09-55-16Z server /data
+            docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z server /data
```

Pinado numa tag de release, nunca `latest`.

### O workflow: `inspect`, `migrate`, `rollback`, `purge`

O `storage-migrate.yml` tinha quatro modos, na ordem em que deviam ser
usados:

- `inspect` — só lê. Imprime o container, a imagem, os mounts, as portas,
  os **nomes** das variáveis de ambiente (os valores são as credenciais
  root do storage, e log de Actions não é lugar privado), o tamanho dos
  dados e o espaço livre.
- `migrate` — para o container, faz um tar do diretório de dados com
  `sha256sum` ao lado (e se recusa a continuar se o disco não comporta o
  arquivo), reescreve a imagem no compose que é dono do serviço, sobe de
  novo e verifica. Se a verificação falha, desfaz sozinho.
- `rollback` — devolve a imagem anterior, desde que ela ainda esteja em
  disco.
- `purge` — apaga as imagens do MinIO que sobraram, recusando tocar em
  qualquer uma que um container ainda referencie: essas imagens não podem
  ser baixadas de volta por ninguém.

Apagar a imagem antiga é opt-in e é o último passo, porque é o único da
migração que não tem volta.

### O `inspect` recusou rodar — e foi a primeira coisa útil do dia

A primeira execução falhou em menos de um segundo:

```
##[error]No container named nexo-minio on this machine.
nexo-mq-1    | rabbitmq:4-alpine
nexo-db-1    | postgres:17-alpine
nexo-minio-1 | minio/minio:RELEASE.2025-02-28T09-55-16Z
...
```

O compose do repositório chama o container de `nexo-minio`. O servidor
chamava de `nexo-minio-1`. E listava um RabbitMQ que não existe em lugar
nenhum do repositório. O label `com.docker.compose.project.config_files`
do container mostrou de onde ele vinha: um `docker-compose.infra.yml` que
vivia só no servidor, porque o CD copia o `docker-compose.yml` da
aplicação e **nunca copiou o de infra**. Os dois tinham divergido sem
ninguém ver. Guardei isso pra depois e rodei de novo com o nome certo.

### A primeira migração fez rollback sozinha, pelo motivo errado

A primeira tentativa de `migrate` fez tudo certo até o fim: backup de
1,7 MB com sha256, Silo baixado, compose reescrito, container de pé, health
respondendo no host. Aí veio a checagem que eu tinha adicionado minutos
antes — bater em `https://storage.nexopm.com`, porque um container que
responde em `localhost` enquanto o nginx não serve o vhost público ainda
é uma queda pra todo cliente que abre um anexo:

```
==> health endpoint answers on the host
==> https://storage.nexopm.com/minio/health/live -> 000000
##[error]The public endpoint does not answer 200 — rolling back.
```

`000` é o `curl` dizendo que nem conectou. O servidor não alcança o
próprio IP público: o roteador não faz *NAT hairpin*. De fora, a mesma URL
respondia 200 o tempo todo. O Silo estava perfeito; a verificação é que
dependia de um caminho de rede que a máquina não tem pra si mesma.

O constrangedor é que eu já sabia disso. O mesmo problema está documentado
no compose da aplicação desde antes — é por isso que os containers
resolvem `nexopm.com` pro endereço LAN via `extra_hosts`, e eu citei isso
no post de arquitetura. Escrevi a checagem nova sem lembrar dela.

A correção foi apontar o hostname pro loopback sem abrir mão do que a
checagem prova:

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' \
  --resolve storage.nexopm.com:443:127.0.0.1 \
  https://storage.nexopm.com/minio/health/live) || code='000'
```

O `--resolve` manda a requisição pro `127.0.0.1` mantendo o `Host` e o
SNI do TLS, então o nginx continua escolhendo o vhost de storage e
terminando o mesmo certificado. A checagem exercita a cadeia que o cliente
usa — nginx, TLS, container — sem depender da rota que não existe.

### A segunda tentativa

```
archive:  minio-pre-silo-20260924T151033Z.tar.gz (1,7M) + sha256
==> health endpoint answers on the host
==> nginx vhost storage.nexopm.com -> 200
==> buckets visible to the new server:
    [2026-09-20 02:37:26 UTC]     0B avatars/
```

E depois um `purge` que achou mais uma imagem esquecida —
`minio/minio:latest`, de algum deploy antigo — e a apagou. No servidor
sobrou `pgsty/silo:RELEASE.2026-09-16` e nenhuma imagem do MinIO.

### O backup não percebeu nada, e o motivo importa

O backup noturno (o mesmo do post de arquitetura) não passa pelo
container do storage: ele empacota o diretório de dados direto do host.
Trocar o servidor S3 que lê e escreve aquele diretório é invisível pra
ele. Rodei uma execução manual logo depois da migração e o arquivo do
storage subiu pro B2 com 1.782.856 bytes — 2.713 a mais que o da manhã,
ou seja, dado vivo sendo lido, não um arquivo de tamanho fixo. O script
também valida antes de subir (o dump precisa listar o próprio índice com
`pg_restore -l`, o tar precisa passar no `tar -tzf`) e apaga o arquivo
local se falhar, em vez de deixar uma falsa segurança no bucket. Esses
números vêm do log da execução no servidor; o script não está versionado,
então não dá pra conferir isso no repositório.

O que a execução também deixou claro foi um risco que não tem nada a ver
com MinIO: a chave do remote cifrado do rclone ficava guardada num único
lugar. Sem ela, nenhum backup remoto pode ser restaurado por ninguém —
inclusive por mim. Um backup cuja chave morre junto com o servidor não
protege contra o servidor morrer, que é o único cenário em que ele
importa.

## Resultados

| | Antes | Depois |
| --- | --- | --- |
| Imagem do storage em produção | `minio/minio:RELEASE.2025-02-28` (impossível de baixar de novo) | `pgsty/silo:RELEASE.2026-09-16` (pinada, pública) |
| CI | vermelho desde a manhã | verde a partir de `34da4ab1`, no mesmo dia |
| Execuções do workflow | — | 5: `inspect` falho, `inspect`, `migrate` revertido, `migrate`, `purge` |
| Tempo do `migrate` bem-sucedido | — | 18 s, do início do backup ao fim da remoção da imagem antiga |
| Imagens do MinIO no servidor | 2 | 0 |

As cinco execuções estão na aba Actions do repositório, das 15h04 às 15h12
UTC — oito minutos entre a primeira recusa e a limpeza final, com três
commits no próprio workflow no meio.

Dois dias depois o `storage-migrate.yml` foi apagado do repositório
(`697da691`): os modos `migrate` e `rollback` dependiam de uma imagem que
não existe mais em lugar nenhum, então o que sobrava eram 266 linhas que,
disparadas por engano, parariam o storage de produção pra trocá-lo por
algo impossível de baixar. A metade que valia a pena, a inspeção, já tinha
ido pro workflow de operações de servidor.

## Dois arquivos com o mesmo nome

Sobrou a pendência do `inspect`: o compose do servidor e o do repositório
não batiam. O pedido natural era "alinha os dois". A investigação mostrou
que não eram o mesmo arquivo com drift — eram **dois arquivos diferentes
com o mesmo nome**. O do repositório era o stack de *desenvolvimento*,
com réplica de leitura e PgBouncer. O do servidor era o de *produção*,
com RabbitMQ e sem réplica.

Copiar um por cima do outro teria sido o erro silencioso perfeito: o
container `nexo-db-1` viraria `nexo-db`, e o backup noturno faz `docker
exec nexo-db-1 pg_dump`. Ele quebraria naquela noite e só avisaria no dia
de restaurar.

A resolução levou quatro dias e virou uma série de commits pequenos:

- `c41a5887` (24/09) — o compose de produção passou a ser versionado,
  exportado do servidor, sem o RabbitMQ: nada no código fala AMQP, zero
  dependência, zero variável; as filas são BullMQ sobre Redis. Os nomes de
  container foram mantidos exatamente como estavam, por causa do backup.
  O CD copia o arquivo mas não o aplica: recriar Postgres ou Redis não é
  decisão que um deploy de aplicação deva tomar sozinho.
- `cde20c99` (24/09) — a comparação servidor × repositório passou a olhar
  pro arquivo de produção. Antes ela apontava pro de desenvolvimento e
  reportava 125 linhas de diferença que deviam mesmo estar lá.
- `eb04cf11` (26/09) — réplica de leitura e PgBouncer levados pra
  produção, com o primário deixado byte a byte igual ao que rodava pra não
  forçar um restart do banco.
- `4ce4d075` (28/09) — a aplicação passou a falar com o banco pelo
  PgBouncer. Medido antes: o Postgres permite 100 conexões e 11 estavam em
  uso.

E isso me obriga a uma correção. No [post de arquitetura](/pt/writing/nexo-architecture),
publicado quatro dias antes da migração, eu escrevi que o Postgres de
produção tinha PgBouncer e réplica "há algumas semanas", e que o Redis
estava pinado por digest. Eu estava descrevendo o compose do repositório,
que é o de desenvolvimento. Em produção, réplica e pooler só entraram em
26 de setembro, a aplicação só passou pelo pooler em 28, e o Redis do
compose de produção versionado ainda roda `bitnami/redis:latest`. O post
de arquitetura separava com cuidado o que roda do que é alvo — e errou
justamente a linha entre os dois arquivos, que eu nem sabia que eram dois.

## Onde quebrou

**O rollback disparou pelo motivo errado, e a mensagem mentiu sobre ele.**
O workflow fez a coisa certa — na dúvida, voltou pro estado anterior —,
mas pelo diagnóstico errado. Pior: o log da primeira tentativa diz
`000000`, não `000`, porque o `curl` já imprime `000` quando falha e o `||
echo 000` concatenava outro; e a última linha de erro dizia "Silo did not
answer in 60s", que era falso — o Silo respondeu, quem não respondeu foi a
rota até o IP público. A causa raiz não é o `curl`: é que eu escrevi uma
verificação sem testá-la no ambiente onde ela ia rodar, contra um problema
de rede que já estava documentado no repositório. O rollback automático me
salvou de um erro que eu mesmo tinha introduzido minutos antes.

**A resolução do compose derrubou a produção por cerca de 90 segundos.**
É o número mais feio deste post e ele não aconteceu na migração do
storage, aconteceu depois. O modo `infra-apply` do workflow de operações
rodava `docker compose -f docker-compose.infra.yml up -d --remove-orphans`
no diretório da aplicação. Os dois composes ali compartilham o mesmo nome
de projeto — `nexo`, herdado do diretório —, então pro arquivo de infra a
aplicação, o worker e o servidor de realtime eram todos "órfãos". Ele os
removeu junto com o RabbitMQ que devia remover, e `nexopm.com` respondeu
502 até um modo novo, `app-up`, subir os três de volta (`24816cee`). O
aviso estava lá pra ser lido: uma execução anterior da mesma sessão tinha
impresso `Found orphan containers ([nexo-worker nextjs-app nexo-realtime])`,
e o flag foi adicionado mesmo assim. A correção (`5a9aa8d9`) tirou o flag
e passou a listar órfãos sem apagá-los: decidir que algo é lixo é decisão
humana, e automatizar essa decisão foi exatamente o que quebrou.

**"Produção não piscou" é o que as checagens viram, não uma prova.**
`nexopm.com` e `storage.nexopm.com` responderam 200 em toda checagem que
fiz durante a migração, e o dia 24 aparece com 100% na página de status.
Mas o container de storage foi parado e religado três vezes (duas na
tentativa revertida, uma na boa), e na tentativa boa ele ficou parado da
hora do backup até o health voltar — uns 12 segundos pelos timestamps dos
passos. Uma sonda que roda uma vez por minuto não vê uma janela dessas, e
um upload que caísse nela teria falhado. Não tenho como afirmar que
nenhum falhou.

**Troquei um upstream por outro upstream.** O Silo resolve o problema de
hoje com o mesmo tipo de dependência que causou o de ontem: uma imagem
pública, publicada por terceiros, pinada por tag. Se o Pigsty retirar a
distribuição amanhã, o CI quebra igual. Não espelhei a imagem num registry
meu nem pinei por digest; a imagem antiga do MinIO foi apagada, então não
existe mais rollback pra ela. Foi uma escolha — manter um registry próprio
é mais um serviço pra operar sozinho —, mas é um risco aceito, não um risco
resolvido.

## O que isso prova, e o que não prova

Prova que dá pra trocar o object storage de produção de um projeto
self-hosted sem uma sessão de shell: um workflow com um modo só-leitura
que recusa o que não reconhece, backup com hash antes de qualquer
mudança, rollback automático e uma limpeza opt-in deixou cinco execuções
legíveis no lugar de um histórico de terminal. Prova também que a
validação feita antes — todas as chamadas S3 do app e o formato em disco
— é o que torna esse tipo de troca uma troca de container, e não uma
migração de dados.

Não prova que a migração teve zero indisponibilidade: houve janelas de
segundos que nenhum monitor meu tem resolução pra ver. Não prova que o
Silo é uma escolha durável — é um fork de um projeto arquivado, e eu
dependo dele do mesmo jeito que dependia do original. E a parte mais
importante do dia não foi o storage: foi descobrir que o arquivo que
descrevia a produção não estava no repositório, e que eu tinha publicado
um post de arquitetura em cima do arquivo errado.
