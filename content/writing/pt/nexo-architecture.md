---
title: A arquitetura da Nexo em três diagramas — o que roda, o que é alvo e o que sobra se o servidor sumir
description: "Em oito meses e meio a Nexo acumulou 1.255 commits, 943 deles co-assinados por um agente, e uma arquitetura que não cabe mais num parágrafo. Este post é o mapa em três diagramas: o que de fato roda em produção (nginx, três containers da mesma imagem, Postgres com PgBouncer e réplica, Redis só-TLS, MinIO) e o que ainda é alvo no desenho; o backup que faz pg_dump e espelha o MinIO todo dia às 03:15 e sobe cifrado pro Backblaze B2; as quatro camadas de teste que entraram em três semanas — contrato, browser, visual e mutação; e a migração do CI pra runners da Avrea, aberta por um bot e consertada por mim."
icon: code
date: "2026-09-20"
---

A Nexo tem 1.255 commits. **943 deles** — 75% — trazem um trailer
`Co-Authored-By: Claude` na mensagem. O primeiro é de 8 de fevereiro; o
mais recente é de hoje. Nesses oito meses e meio a arquitetura passou de "um
Next.js falando com um Postgres" pra três containers, um pooler, uma
réplica de leitura, oito camadas de teste e um pipeline com treze jobs.

Este post é o mapa. Três diagramas — arquitetura global, dado e backup,
CI/CD — e, em cada um, a mesma disciplina: separar o que roda em produção
hoje do que ainda é só desenho. O repositório é público, então toda
afirmação aqui é conferível, e as que eu não consigo provar estão marcadas
como tal.

## O diagrama global, e o que o `grep` confirma dele

![Arquitetura global da Nexo: usuários chegam por nginx, que distribui entre Next.js e Node; abaixo, Gateway e Pilot; do lado direito, object store, LangChain com OpenAI, PostgreSQL, Redis, Integrations (Slack, GitHub e outros) e SDK; tudo dentro de uma caixa Docker](/img/nexo-architecture/blog_diagram-global.png)

Esse é o desenho completo — o alvo. O que está em produção hoje é um
subconjunto dele, e vale dizer qual é qual antes de qualquer outra coisa:

**Existe e roda:** nginx na frente, o app Next.js, o processo Node
(worker), o PostgreSQL, o Redis, o object store (MinIO) e o Docker
envolvendo tudo.

**Ainda não existe no código:** `Gateway`, `Pilot`, `SDK`, o par
LangChain → OpenAI e a caixa `Integrations` com Slack e GitHub. Um `grep`
no repositório não acha nenhum deles — nem arquivo, nem dependência, nem
rota. São a forma que a plataforma deve ter, não a que ela tem.

Essa distinção não é detalhe de rodapé. Um diagrama de arquitetura é o
documento que mais facilmente vira ficção: ele é desenhado no começo, é
aspiracional por natureza, e ninguém volta pra apagar a caixa que nunca foi
implementada. Manter a legenda honesta é mais barato que manter o desenho
atualizado.

## Uma imagem, três processos

O que o diagrama resume como "Next.js" e "node" é, no `docker-compose.yml`
de produção, três serviços que puxam **a mesma imagem** e só diferem no
comando:

```yaml
nexo-app:
  image: ghcr.io/castrogusttavo/nexo:latest
  ports: ["3000:3000"]

nexo-worker:
  image: ghcr.io/castrogusttavo/nexo:latest
  command: ["node", "dist/worker.cjs"]

nexo-realtime:
  image: ghcr.io/castrogusttavo/nexo:latest
  command: ["node", "dist/realtime.cjs"]
  # Loopback only: o ponto de entrada público é o /realtime do nginx.
  ports: ["127.0.0.1:1234:1234"]
```

Uma imagem, três `command`. O build gera três artefatos — o `standalone` do
Next, um `worker.cjs` e um `realtime.cjs`, ambos empacotados com esbuild —
e cada container executa o seu. O ganho é que não existe deriva de versão
entre app e worker: os dois sobem do mesmo SHA, sempre, porque é
literalmente o mesmo `:latest` puxado três vezes.

O worker é um processo Node separado do Next de propósito — um
`setTimeout` dentro do processo do app não sobrevive a um deploy, e é isso
que o post sobre filas com BullMQ desmonta em detalhe. Ele roda o ciclo de
vida de conta, exportação de dados, retenção e o ciclo de trial. O
`realtime` é um servidor Hocuspocus para a edição colaborativa, exposto
só no loopback: quem chega de fora passa pelo `/realtime` do nginx, mesma
origem, pra que o cookie de sessão chegue até ele.

O nginx faz duas coisas que ninguém mais pode fazer: termina o TLS e é o
único ponto de entrada público. Tem um detalhe de rede registrado no
próprio compose que é o tipo de coisa que só aparece em produção — o
roteador não faz *hairpin*, então um container que resolve `nexopm.com`
pro IP público simplesmente estoura o timeout. A saída foi apontar os
nomes públicos pro endereço LAN do host via `extra_hosts`, onde o mesmo
nginx termina o mesmo TLS:

```yaml
x-internal-hosts: &internal-hosts
  - 'storage.nexopm.com:192.168.100.197'
  - 'nexopm.com:192.168.100.197'
```

Sem isso, URL pré-assinada de storage (assinada pro host público) não
funciona de dentro da própria rede.

## O banco: um pooler e uma réplica que nasceram de um teste de carga

O Postgres não está sozinho há algumas semanas. Na frente dele tem um
PgBouncer em modo de transação (`MAX_CLIENT_CONN: 200`,
`DEFAULT_POOL_SIZE: 20`) e, do lado, uma réplica de leitura por streaming
replication de verdade — `pg_basebackup -R`, não cópia de arquivo.

As três leituras do `IssueRepository` que a rota `/issues` usa passam pela
réplica; toda escrita continua no primário. Quando `DATABASE_URL_REPLICA`
não está setada, o client de réplica cai de volta no primário em vez de
quebrar — um ambiente sem réplica continua funcionando, só que mais lento.

Não vou repetir aqui de onde essas duas peças vieram: o post sobre aguentar
1 milhão de usuários conta a história inteira, com os números do teste de
carga que provaram que o gargalo tinha mudado de lugar. O que interessa
pro mapa é que o "PostgreSQL" do diagrama são três containers hoje —
primário, réplica e pooler —, e que só o primário guarda a verdade.

Duas decisões de imagem que valem o comentário que carregam no compose: o
Redis está **pinado por digest** (`bitnami/redis@sha256:1347d526…`, Redis
8.6.3 de 11/05/2026) porque o `latest` mais novo entra em crash-loop no
setup de TLS e as tags versionadas foram removidas do Docker Hub; e o
MinIO agora vem do `quay.io`, porque a MinIO parou de publicar imagem no
Docker Hub. Nos dois casos o comentário no arquivo explica o porquê e diz
como validar antes de mexer — é a diferença entre um pin e um pin que
alguém vai conseguir mudar daqui a seis meses.

O Redis, aliás, não escuta em porta não-TLS: `REDIS_PORT_NUMBER: 0`,
`REDIS_TLS_PORT_NUMBER: 6379`. Tem um job só pra isso no CI, o
`redis-tls-smoke`, que sobe um Redis com certificado gerado na hora e
conecta por `rediss://`. É meio minuto de pipeline pra garantir que a
configuração que protege o cache não regrediu.

## Backup: `pg_dump` às 03:15, cifrado antes de sair do servidor

![Fluxo de backup da Nexo: um worker aciona um processo Node que lê PostgreSQL e Object Storage, grava um backup local e envia pro Backblaze B2; uma seta de restore volta do B2 para o Node. Tudo dentro de uma caixa self-hosted](/img/nexo-architecture/blog_diagram-data.png)

Backup é o único subsistema da Nexo que **não está no repositório**. Ele
roda direto no servidor, por cron, e isso é uma escolha com custo: não
tem review, não tem CI, não tem histórico de mudança. Está aqui no post
porque é parte da arquitetura real, não porque é a parte bem feita dela.

O ciclo:

```
seg–sáb 03:15  →  daily/    local  7 dias   ·  Backblaze B2  30 dias
domingo 03:15  →  weekly/   local 56 dias   ·  Backblaze B2 180 dias
```

O dump é `pg_dump -Fc`, por banco — formato custom, restaurável com
`pg_restore`, e não o cluster inteiro. Junto vai o espelho dos objetos do
MinIO: avatar, capa, upload de issue. Backup de banco sem os arquivos que
as linhas apontam não é backup, é metade de um — uma issue restaurada
apontando pra um anexo que não existe mais é um registro que mente.

A subida pro B2 é feita por um remote `crypt` do rclone. Isso significa que
o que sai da máquina já sai cifrado: **nome do arquivo e conteúdo**, os
dois, cifrados no cliente. O Backblaze guarda blobs que ele não consegue
ler e cujo nome não diz nada — quem tem acesso ao bucket não tem acesso ao
dado. A chave vive fora do bucket; se ela se perder, o backup também.

A expiração das cópias antigas no B2 é feita por lifecycle rule do próprio
bucket, não por um `rm` no fim do script. A diferença importa: um script
que apaga é um script que pode apagar errado, e uma regra de ciclo de vida
é declarativa e auditável do lado do provedor. O que o script faz é
escrever; quem esquece é o bucket.

E a seta `restore` do diagrama não é decorativa: o caminho de volta já foi
executado de verdade, ao menos uma vez, com dado real. Essa frase é a
única coisa que separa um backup de uma pasta grande.

**O que esse desenho não me dá:** dump lógico não é *point-in-time
recovery*. Entre duas execuções existe uma janela de até 24 horas de dado
que eu simplesmente não teria de volta — o RPO real é de um dia, não de
minutos. Pra fechar essa janela eu precisaria de archive de WAL, que é
outro subsistema e outro custo de armazenamento. Hoje o risco está aceito,
não resolvido; e como o cron não está versionado, a única prova de que ele
roda é o bucket ter arquivo novo toda manhã.

## Quatro camadas de teste que não existiam há três semanas

A Nexo já tinha unidade, integração, e2e de API e teste de componente. Em
setembro entraram mais quatro, cada uma respondendo a uma pergunta que
nenhuma das anteriores conseguia responder.

### Contrato: o OpenAPI parou de ser ficção

O `public/openapi.json` é escrito à mão e nada o verificava, então ele
derivou. As suítes de contrato não reescrevem a verdade — elas a
reconstroem a partir do código: o inventário de rotas é percorrido em
`app/api/**/route.ts`, a lista de rotas públicas é lida do `proxy.ts`, o
envelope de resposta sai de `types/http-response` e os corpos de request
são comparados campo a campo com os schemas Zod.

O que a primeira execução achou: `GET /health` não estava documentada; uma
rota de thumbnail declarava 1 dos seus 3 parâmetros; dois schemas usavam
`nullable` sem tipo, que o ajv se recusa a compilar; e **40 campos**
carregavam o `nullable: true` do OpenAPI 3.0, que todo leitor de 3.1
ignora — ou seja, estavam publicados como não-nuláveis.

E dois erros de status que eram bug de verdade.
`MODULE_MEMBER_ALREADY_EXISTS` estava registrado como **405** enquanto
todos os irmãos dele são 409: adicionar um membro duplicado respondia
"método não permitido". Esse passou batido pela checagem que compara
código documentado com registro, porque uma resposta `$ref` compartilhada
nunca nomeia o código dela. A prosa da operação nomeia ("Falha com `CODE`
(409) se…"), então esse par também é checado — e foi ele que pegou o
segundo caso, onde o documento é que estava errado.

São 4 arquivos e 18 testes que não precisam de banco, de Redis nem de
servidor: só leem arquivo e JSON. Por isso rodam num job próprio, em 36
segundos, em vez de esperar o job que sobe Postgres.

### Browser: o artefato de produção, num Chromium de verdade

Dezoito specs de Playwright pelos caminhos de ouro — cadastro até a tela de
OTP e o onboarding inteiro, login/logout e senha errada, criar projeto e
issue e mover o estado dela, configurações de workspace, sticky notes e
páginas de wiki sobrevivendo a um reload, e o caminho de rate limit onde a
interface precisa mostrar a mensagem do próprio servidor.

O detalhe que faz essa camada valer o custo: o servidor que ela sobe é o
**artefato standalone**, o mesmo que a produção roda — não o `next start`.
O `next.config` usa `output: 'standalone'`, que o `next start` se recusa a
servir. Foi essa diferença que expôs um bug de CSP: toda outra camada fala
HTTP ou renderiza em jsdom, onde a *enforcement* do navegador nunca
acontece.

Três specs entraram como `fixme`, com o bug que reproduzem escrito ao
lado — o drag-and-drop do kanban está morto porque os listeners do dnd-kit
só chegam num handle que nenhuma tela renderiza, o papel "Fundador /
Executivo" submete `FOUNDER_EXECUTIBE` e trava o passo, e a home do
workspace cumprimenta todo mundo por um nome hardcoded. Teste vermelho que
documenta bug conhecido vale mais que teste deletado.

A suíte inteira roda em 21 segundos, e no CI reaproveita o build, o banco e
o MinIO do job de e2e em vez de pagar um segundo `next build`.

### Visual: doze telas, quatro variantes, zero pixel de tolerância

Toda camada anterior checa comportamento: o botão existe, o clique manda o
PATCH certo. Nenhuma delas sabe que o botão ficou branco no branco, que um
gap empurrou a sidebar por cima do conteúdo, ou que um token quebrou o
modo escuro.

Doze telas em até quatro variantes cada — desktop e mobile, claro e escuro —,
44 imagens, e um pixel diferente falha o build com a imagem do diff junto.
O trabalho inteiro dessa camada é determinismo: a suíte roda dentro da
imagem oficial do Playwright (e o script se recusa a rodar se a tag e o
`@playwright/test` discordarem, porque um bump de navegador re-renderiza
toda baseline), o relógio é fixado antes da primeira navegação, a animação
é congelada de três formas, fonte e imagem lazy são aguardadas, e o dado é
semeado com nome e data de entrada fixos.

O limiar é `maxDiffPixelRatio: 0`. No default do Playwright, uma regressão
deliberada de `#fff` pra `#f5f5f4` passou despercebida — é assim que uma
suíte visual começa a não servir pra nada. Com o limiar cravado em zero,
essa mesma mudança falha exatamente as doze variantes claras que têm
superfície `bg-card` e deixa todas as escuras verdes.

E aí veio a lição de CI: a primeira execução no runner voltou 43 de 44,
falhando em **um pixel** de um título azul — `rgb(38,68,103)` na minha
máquina, `rgb(40,72,109)` no runner. Fixar o container fixa a fonte e o
build do Chromium, mas não fixa a CPU: o Skia escolhe o caminho SIMD em
tempo de execução, e a mesma página rasteriza um tom diferente em silício
diferente. A correção tentadora é `maxDiffPixels: 1` — e é exatamente
assim que uma suíte começa a derivar pra tolerâncias que escondem mudança
real. A correção certa foi remover a fonte da variação: sem opts de Skia em
runtime, sem LCD text, sem posicionamento subpixel, sem hinting, perfil de
cor fixo, sem raster parcial, sem GPU. Baselines regravadas contra isso.

### Mutação: a pergunta que a cobertura não responde

Cobertura diz que a linha executou. Não diz que um teste ficaria vermelho
se a linha estivesse errada. O Stryker muta a lógica de backend — services,
mappers, errors, queue, utils — e reroda o projeto de unidade contra cada
mutante. **5.269 mutantes, 25 minutos**, então roda semanal e sob demanda,
fora do portão do CI (o CD dispara a partir de um CI verde; dobrar o tempo
de todo deploy por isso não se paga).

A primeira rodada deu 70,3%, e os sobreviventes eram buracos reais:

- O portão de autorização de projeto estava **não-provado nos dois
  sentidos**. Cravar "é o lead" como `false` sobreviveu em 64 lugares:
  nenhum teste jamais concedeu acesso pela condição de lead. Cravar "é
  membro" como `true` sobreviveu em 47. E `.some` → `.every` sobreviveu em
  16 — o que significa que todo teste usava um projeto com exatamente um
  membro, onde os dois operadores concordam.
- Três prazos podiam ter o sinal invertido sem ninguém notar: a carência de
  30 dias da exclusão de conta, o TTL de 7 dias do convite e o link de
  exportação de dados. Cada um sairia já vencido.
- O uptime de 90 dias da página de status podia ser substituído por uma
  função vazia sem nada ficar vermelho: ninguém lia o número.
- Os dois limites de valor de cupom são inclusivos de propósito e nenhuma
  das bordas era testada — um cupom de 100% de desconto nunca tinha sido
  exercitado.
- Todo limite de tamanho de upload testava LIMITE+1 e nada fixava a borda,
  então `>` e `>=` eram intercambiáveis em cinco lugares.

Os testes que faltavam foram escritos; o score foi pra 72,4% e o `break`
ficou em 70. O portão continua honesto sem quebrar por causa do punhado de
mutantes cujo veredito oscila entre execuções.

### Os números, sem arredondar pra cima

| Camada | Arquivos | Testes | Onde roda |
| --- | --- | --- | --- |
| Unidade + integração | 184 | 1.971 | CI, com Postgres e Redis |
| Componente | 154 | 1.662 | CI, jsdom |
| E2E de API | 98 | 467 | CI, servidor de verdade |
| Contrato | 4 | 18 | CI, job próprio |
| Browser (Playwright) | 8 | 18 | CI, artefato standalone |
| Visual | 5 | 44 | CI, imagem do Playwright |
| Mutação (Stryker) | — | 5.269 mutantes | Semanal, runner próprio |

Cobertura, medida e não estimada: **88,43% no backend** e **94,97% no
frontend** no Codecov, com 91,02% no total do projeto. São dois números
separados de propósito, com flags separadas e baselines separadas, porque
juntar as duas coisas numa média só produz um número que não significa
nada — as ~500 telas de client afundariam o backend, e o backend maquiaria
o frontend. O relatório do v8 dentro do escopo de frontend dá 97,21% de
statements; o número do Codecov é menor porque ele conta branch parcial.

E nenhum desses números é o mais honesto da lista. O mais honesto é
**72,4%** — o score de mutação. É o único que responde "se eu quebrar isso,
alguém percebe?".

## CI/CD: treze jobs, um portão, e um bot que abriu PR

![Fluxo de CI/CD da Nexo: do desenvolvedor pro GitHub, do GitHub pro CI, que se divide em qualidade, testes e segurança; do CI pro CD, que se divide em migration, deploy e release. Tudo sobre GitHub Actions](/img/nexo-architecture/blog_diagram-cicd.png)

O `ci.yml` tem treze jobs. Eles se organizam exatamente como as três caixas
do diagrama:

**Qualidade** — `lint` (Biome com `--error-on-warnings` e `tsc --noEmit`) e
`pr-title` (commit convencional no título do PR, pros PRs de exceção).

**Testes** — `coverage-tests` (unidade, integração e componente, com upload
pro Codecov em duas flags), `e2e-tests` (que faz o único `next build` do
pipeline e depois encadeia e2e de API, browser e visual em cima do mesmo
build), `contract-tests` e `redis-tls-smoke`.

**Segurança** — `gitleaks` (segredo no histórico), `semgrep` (SAST, uma
execução com duas saídas: SARIF pra aba Security e JSON pra triagem),
`snyk`, `audit` e `lpa2v-triage`, que correlaciona os achados de SAST e SCA
pelo cluster de neurônios paraconsistentes do meu TCC antes de um humano
olhar — tem um post inteiro sobre ele aqui.

Três desses são deliberadamente não-bloqueantes (`snyk`, `audit`,
`lpa2v-triage`) e ficam fora do `needs` do portão. Monitoramento que
bloqueia deploy vira monitoramento que alguém desliga.

No fim, o job `gate`: ele não roda teste nenhum, só falha se qualquer um
dos sete jobs obrigatórios falhou ou foi cancelado. É um `needs` único pro
`cd.yml` escutar — e o `cd.yml` escuta a **conclusão** do CI, não o push.
Esse desenho, e por que a Nexo não usa Pull Request no fluxo padrão, é o
assunto de outro post; aqui basta dizer que `migrate` roda antes de
`deploy`, que a imagem é escaneada com Trivy e só sobe pro registry se
passar (bloqueia em CRITICAL, HIGH fica visível e vai pro Dependabot), e
que o segredo de produção é decifrado com SOPS + age na hora do deploy.

A release é CalVer: `2026.09.20`, e `.1`, `.2` pro segundo e terceiro
deploy do mesmo dia.

### A migração pra runners da Avrea

Em 19 de setembro, todos os jobs hospedados saíram de `ubuntu-latest` pra
`avrea-ubuntu-latest-2-vcpu`. O PR que fez isso — 15 substituições no
`ci.yml`, 6 workflows, +58/−30 — **foi aberto por um bot**, o `avrea[bot]`,
não por mim. É o primeiro PR do repositório inteiro aberto por um agente
que não é o Dependabot.

Aceitar não foi um clique. A branch do PR acumulou quatro execuções antes
de fechar verde — vermelha, cancelada, vermelha, verde — e duas coisas
quebraram de um jeito que só um runner diferente quebra:

1. Os runners da Avrea exportam `NODE_OPTIONS=--use-openssl-ca`, e o Node
   **proíbe** essa flag em worker thread. O `next build` morria com
   `ERR_WORKER_INVALID_EXEC_ARGV`. A correção é um `NODE_OPTIONS: ''` nos
   steps de build e de start — com o comentário explicando por quê, senão
   alguém remove isso em seis meses achando que é lixo.
2. A imagem do MinIO vinha do Docker Hub, de onde a MinIO parou de
   publicar. Passou a vir do `quay.io`, na mesma tag pinada que o compose
   de infra já usava.

O que a migração **não** fez foi acelerar o wall-clock. Antes da mudança o
CI fechava em ~5 minutos; depois, ~9. A causa não é o runner: as camadas de
browser e visual entraram no mesmo dia, e o job de e2e passou a fazer três
coisas onde antes fazia uma. Comparar os dois números seria desonesto, e
eu não tenho um A/B limpo pra afirmar ganho de velocidade — o que eu tenho
é o pipeline verde em 9 minutos com 4.180 testes dentro dele.

E os jobs mais sensíveis continuam onde estavam: `migrate`, `deploy` e o
job de mutação rodam em `self-hosted`, no meu próprio runner. Migration e
deploy precisam de acesso ao servidor; a mutação precisa de 25 minutos de
CPU que eu não quero pagar por minuto.

## Os três agentes

Dá pra contar quem trabalhou nesse repositório com `git log` e a API do
GitHub, então aqui vão os números em vez do adjetivo:

- **Claude** — 943 dos 1.255 commits trazem o trailer de co-autoria, desde
  8 de fevereiro. Entre os modelos: 501 Sonnet 5, 123 Opus 4.6, 113 Opus
  4.7, 76 Opus 5, 65 Opus 4.8, 45 Sonnet 4.6, 41 Fable 5.
- **Dependabot** — 22 dos 58 PRs do repositório. É o único agente que
  sempre trabalhou por PR, porque atualização de dependência é exatamente o
  tipo de mudança onde eu quero o diff isolado e o CI rodando sozinho antes
  de olhar.
- **Avrea** — 1 PR, a migração de runners descrita acima.

Fora isso: 41 PRs mergeados no total, 487 commits de `feat`, 304 de `fix`,
99 de `test`. Julho foi o mês mais pesado, com 339 commits.

O que esses números provam é volume e cadência. O que eles não provam é
qualidade — um commit co-assinado por um agente é um commit que eu revisei
e assinei, e a responsabilidade por cada um deles é minha, não do trailer.
O que sustenta essa velocidade não é o agente: é o portão que ele não
consegue burlar.

## O que isso prova, e o que não prova

Prova que dá pra rodar uma plataforma multi-tenant self-hosted com uma
imagem, três processos e um compose de infra que cabe numa tela — e que o
caro não é a arquitetura, é a disciplina de deixar registrado por que cada
pin, cada exceção e cada `NODE_OPTIONS: ''` está ali.

Prova que cobertura de linha não é a métrica: 88% de backend com 5.269
mutantes revelou um portão de autorização que nunca tinha sido provado em
nenhum dos dois sentidos. Os testes estavam verdes o tempo todo.

Não prova que a arquitetura do primeiro diagrama existe — metade dela é
alvo, e eu preferi dizer isso a deixar você descobrir sozinho abrindo o
repositório.

Não prova que o backup é bom. Ele é diário, cifrado, com retenção em dois
níveis e um restore já executado — e mesmo assim é um script fora do
controle de versão, com um RPO de 24 horas. É o subsistema mais importante
da lista e o único que não passa por nada do pipeline que o resto passa.
Essa frase é o próximo item da minha lista, não uma conclusão.
