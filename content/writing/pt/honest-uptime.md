---
title: O e-mail não estava caindo — quatro defeitos de medição numa página de status
description: "A página de status pública da Nexo mostrava o e-mail com 51,7% de uptime num dia em que o Resend respondeu certo a toda requisição. Não era o Resend: eram quatro defeitos de medição empilhados — uma régua de 1,5 s para tudo, um uptime que contava lentidão como queda, uma amostra decidindo o dia e sondas disputando a máquina com o CI —, mais uma sonda da aplicação que devolvia OPERATIONAL fixo. Este é o conserto, o resultado (51,7% → 99,7%), e por que trocar a régua é exatamente o que faz um número parecer melhor."
icon: bug
date: "2026-11-19"
---

A página de status pública da Nexo mostrava isto pro e-mail, um dia por
coluna, de 19 a 22 de setembro:

```
email    83,3   71,5   57,0   51,7
```

Pra quem é cliente, isso diz que metade das tentativas de mandar um e-mail
de convite, de código de verificação ou de recuperação de senha falhou na
terça-feira. E nos mesmos dias o Resend respondeu certo a toda
requisição que a Nexo fez. Um cliente olhando aquela página veria um
produto que mal manda e-mail — e estaria errado, porque quem estava
errada era a página.

A tentação, nesse ponto, é ajustar o limiar até o número ficar bonito. É
exatamente o que este post faz, em parte, e por isso a seção mais
importante dele é a de limitações.

## O problema: quatro defeitos empilhados

Nenhum deles sozinho explicava 51,7%. Juntos, explicavam.

**1. Uma régua de 1,5 s pra tudo.** O mesmo limiar de latência valia pra
um `SELECT 1` no Postgres da mesma máquina e pra uma chamada HTTPS a
`api.resend.com`, nos Estados Unidos. São problemas físicos diferentes:
de São Paulo, só a ida e volta já custa ~120 ms, e cada sonda paga um
handshake TCP + TLS novo, porque uma chamada por minuto nunca acha
conexão quente no pool.

**2. O "uptime" contava DEGRADED como fora do ar.** A linha que somava a
disponibilidade era esta:

```ts
if (row.status === 'OPERATIONAL') acc.up += 1
```

Uma resposta correta e lenta virava indisponibilidade. O número que a
página chamava de uptime era, na prática, um SLO de latência com outro
nome.

**3. Uma amostra decidia.** Um único minuto acima do limiar já marcava o
componente como DEGRADED, e o resumo do dia pega a pior amostra do dia
(`worstStatus`). Um blip pintava o dia inteiro de amarelo.

**4. As sondas rodam na mesma máquina que o CI e o backup.** O coletor de
status, o runner self-hosted do CI e o backup das 03:15 dividem um
servidor. Todo build pesado somava centenas de milissegundos a consultas
saudáveis. O storage "oscilando sem motivo" era, em boa parte, a própria
Nexo ocupada consigo mesma.

E, por baixo dos quatro, duas sondas mediam a coisa errada. A da
aplicação era esta:

```ts
export async function probeApp(): Promise<ProbeResult> {
  return { status: 'OPERATIONAL', latencyMs: 0, error: null }
}
```

O único componente que nunca poderia ser visto caindo era justamente o
que serve a página de status. Por isso a linha "Aplicação" mostra 100% em
todo dia desde julho: não era medição, era constante.

A do storage pedia `/minio/health/live`, que responde 200 pra qualquer
um, sem credencial. Ela dizia que o processo estava vivo, não que a Nexo
conseguia usá-lo. Eu já tinha aprendido essa diferença do jeito caro três
dias antes: a chave do AbacatePay em produção tinha ficado inválida, todo
checkout respondia 502, e a página de status seguia verde, porque a sonda
de pagamento só considerava falha um 5xx — um 401 era lido como "o
gateway respondeu, então está de pé" (`ec8273ac`, "treat a rejected
payment credential as the outage it is"). Do lado do cliente, um gateway
que a gente não consegue usar e um gateway fora do ar são a mesma queda.

## A ideia: uptime é "respondeu", latência é outro sinal

Separar as duas perguntas que estavam misturadas num número só:

- **O componente respondeu?** Isso é disponibilidade, e é o que o número
  de uptime deve contar.
- **Respondeu rápido o suficiente pra *ele*?** Isso é degradação, julgada
  contra a realidade física de cada componente, e precisa persistir pra
  contar.

E, nas sondas, perguntar "conseguimos usar?" em vez de "o processo está
vivo?".

## Como funciona

### Um orçamento por componente

| Componente | Lento acima de | Timeout | Por quê |
| --- | --- | --- | --- |
| `database`, `cache` | 1.000 ms | 5 s | `SELECT 1` e `PING` respondem em milissegundos de um dígito com pool quente |
| `auth`, `storage` | 1.500 ms | 5 s | Argon2 mais uma query; S3 local |
| `jobs` | 2.000 ms | 8 s | quatro round trips ao Redis por fila |
| `app` | 2.500 ms | 5 s | HTTP completo por nginx e TLS |
| `payment`, `email` | 3.000 ms | 8 s | HTTPS internacional com handshake frio a cada amostra |

Os orçamentos locais são generosos de propósito: com o CI na mesma
máquina, qualquer coisa mais apertada mede os meus deploys, não o banco.

### Uptime conta quem respondeu

```ts
function answered(status: ComponentStatus): boolean {
  return status !== 'MAJOR_OUTAGE' && status !== 'PARTIAL_OUTAGE'
}
// ...
if (answered(row.status)) acc.up += 1
```

A lentidão não some: continua visível no pior status do dia (a barra
amarela) e na latência média. Ela só deixa de ser contada como ausência.

### Degradação só com três amostras lentas seguidas

Uma amostra lenta grava OPERATIONAL. Só a terceira seguida grava
DEGRADED. Com o coletor rodando a cada minuto, um componente que está de
fato sofrendo aparece em até três minutos, e um build, um backup ou um
pacote azarado não pintam o dia.

O detalhe que quase deu errado: a sequência é lida das **latências**
gravadas, não dos **status** gravados. Os status já saem suavizados — as
duas primeiras amostras lentas foram gravadas como OPERATIONAL —, então
comparar contra eles reiniciaria a contagem pra sempre, e um componente
permanentemente lento nunca degradaria.

Essa suavização vale só pra degradação por latência. Uma falha é gravada
como veio, na primeira amostra: queda é queda.

### Uma retentativa antes de declarar queda

Uma falha é tentada de novo uma vez, 250 ms depois, antes de virar
MAJOR_OUTAGE. Um socket resetado ou um pacote perdido não é um serviço
fora do ar, e uma página que declara queda por um pacote ensina todo mundo
a ignorá-la. O erro reportado é o da primeira tentativa, que costuma ser
o diagnóstico; a segunda falha muitas vezes com uma mensagem menos
específica.

### As sondas que perguntam "conseguimos usar?"

A da aplicação passou a fazer uma requisição HTTP de verdade à URL
pública, `/api/health`, cobrindo DNS, nginx, TLS e o proxy. A do storage
trocou o health endpoint por um `ListBuckets` autenticado com as
credenciais da aplicação. A do e-mail ganhou a mesma regra que a de
pagamento: 401 ou 403 do Resend é queda de entrega de e-mail, mesmo com o
Resend perfeitamente saudável.

Tudo isso está num commit só, `c4f48b0d`, "measure each component against
its own reality", com 659 linhas adicionadas, a maior parte em testes.

### O que veio junto

**Um componente que responde com uma frase.** No dia seguinte entrou o
componente de processamento em segundo plano (`f5718cc1`). O worker é um
processo separado do Next, e a falha que ninguém nota é ele morrer: a
aplicação continua servindo páginas enquanto exclusões de conta e
exportações de dados param de acontecer. A sonda pergunta ao Redis quantos
workers estão conectados a cada uma das quatro filas e quantos jobs
esperam. Fila sem consumidor é queda; mais de 25 jobs esperando é
degradação. Isso pediu uma forma nova: a sonda agora pode responder com
uma frase explicando por que está degradada mesmo tendo respondido rápido
— `N jobs aguardando na fila "<nome>"` diz mais que um número de
latência que ali não significaria nada.

**Alertas só em transição.** Na véspera do conserto da régua, a
página tinha ganhado alertas no Slack (`f40974bc`). O coletor roda a cada
minuto, então as mensagens saem só quando o estado muda. Um componente que
oscila tem no máximo cinco mensagens por episódio: três avisos em 30
minutos, um "instável" e silêncio até ele segurar um estado por 15
minutos, e um "estabilizou" dizendo onde parou. Sem esse teto, a régua
velha teria mandado uma mensagem a cada blip do e-mail — e eu teria
silenciado o canal na primeira semana.

**O N+1 do coletor.** O Sentry apontou um N+1 no `POST
/api/status/collect/core` no primeiro dia ligado: o coletor lia os checks
de um componente e gravava um resumo por vez, 2N round trips por tier.
Duas consultas por tier resolveram (`aggregateForDayByKeys` e
`upsertDailies`, em `c028f79f`); medido contra um Postgres descartável com
`log_statement=all`, uma coleta dos dois tiers passou a emitir **dois**
`INSERT INTO component_dailies` em vez de sete. E um componente sem check
no período fica ausente do mapa, não zerado: lacuna no histórico não é
dia com 0%.

**O número que ninguém lia.** Três dias antes, o teste de mutação tinha
achado que o uptime de 90 dias da página podia ser substituído por uma
função vazia sem nenhum teste ficar vermelho (`fb8a2f42`). A régua estava
errada, e além disso nada verificava o número que ela produzia. Isso é
assunto de outro post.

**Uma linha que era mentira.** Ao revisar a página de status, apareceu
que o componente de storage se chamava "Armazenamento (AWS S3)" e que a
página de sub-processadores dizia que os arquivos ficavam na Amazon. A
Nexo nunca usou S3: o `src/lib/storage/s3.ts` fala com o storage no
próprio servidor. As duas linhas saíram (`98df9245`, `f2765330`), e a de
sub-processadores ganhou os três terceiros que recebem dado e não estavam
listados — Slack, Backblaze B2 e Better Stack — e a frase que faltava:
aplicação, banco e arquivos ficam num servidor próprio em São Paulo, e só
o backup sai do país. Uma página cujo trabalho inteiro é dizer a verdade
sobre a infraestrutura não pode nomear um fornecedor que não usamos.

## Resultados

O conserto entrou em produção na manhã de 23 de setembro. Pela API pública
da página de status (`/api/status`, consultada em 17/10/2026):

| Dia | E-mail | Pagamento | Storage |
| --- | --- | --- | --- |
| 19/09 | 83,3% | 100% | 100% |
| 20/09 | 71,5% | 97,2% | 99,7% |
| 21/09 | 57,0% | 99,7% | 100% |
| 22/09 | **51,7%** | 96,9% | 99,3% |
| 23/09 (deploy) | 96,9% | 100% | 100% |
| 24/09 | **99,7%** | 99,7% | 100% |
| 25/09 | 100% | 100% | 100% |

Nos 52 dias com registro antes do conserto (de 21 de julho a 22 de
setembro, com um buraco de 7 a 18 de setembro em que não há dado), o
e-mail teve média de **87,3%** por dia. Nos sete primeiros dias completos
com a régua nova (24 a 30 de setembro), **99,9%**.

O dia 23 é misto e vale a explicação: o resumo do dia corrente é
recalculado a cada coleta, então depois do deploy ele foi refeito com a
regra nova sobre as amostras da manhã inteira. Os 3,1% que faltam são
amostras gravadas como falha, não como lentidão.

## Onde quebrou

**99,7% é o número depois de trocar a régua. Trocar a régua é exatamente
o que faz um número parecer melhor.** Não tenho como fugir disso, então
vale dizer o que mudou e por que eu ainda acho honesto. O que o número
conta agora é: a sonda recebeu uma resposta, em até duas tentativas,
dentro do timeout. Lentidão continua aparecendo — como barra amarela no
dia e como latência média —, mas não desconta disponibilidade. O que eu
perdi com isso é um sinal que a régua velha dava, ainda que mal: um
componente que responde certo e devagar o dia todo agora pode mostrar
100% e uma barra amarela. Se a pergunta do cliente for "o e-mail chega
rápido?", o 99,7% não responde; ele responde "o e-mail é entregue?". É
uma definição mais estreita, e eu escolhi ela porque é a que a palavra
uptime promete.

Duas salvaguardas contra me enganar. Os dias antigos **não foram
recalculados**: 19 a 22 de setembro continuam mostrando 83,3%, 71,5%,
57,0% e 51,7% na página, medidos com a régua com que foram medidos. Por
isso o uptime de 90 dias do e-mail hoje é **91,3%**, não 99%, e vai seguir
carregando os dias da régua velha até eles saírem da janela, em dezembro.
E a retentativa é uma só, com 250 ms de intervalo: um serviço que falha
duas vezes seguidas ainda é queda na primeira amostra.

**Eu não sei por que o e-mail piorava com o tempo.** A série antiga não é
estável: em julho os dias ficavam entre 94% e 99,7%, em agosto entre 75%
e 99%, em setembro entre 51% e 83%. Um limiar fixo não explica uma
tendência sozinho. A hipótese que eu tenho é que a carga do CI na mesma
máquina cresceu nesse período — setembro foi o mês em que entraram quatro
camadas de teste novas —, mas eu não medi isso, e não vou apresentar uma
correlação que não calculei como causa.

**As sondas continuam na mesma máquina que mede.** O orçamento generoso e
as três amostras seguidas são compensação, não solução. O coletor, o CI e
o backup ainda disputam a mesma CPU, e uma sonda que roda dentro do
servidor que ela vigia não vê o que o cliente vê de fora. Isso inclui a
rede: o servidor não alcança o próprio IP público (sem NAT hairpin), então
a sonda da aplicação chega à URL pública por um atalho de rede interno, não
pelo caminho que um cliente usa. E é uma região só: não existe sonda fora
de São Paulo.

**E, enquanto escrevo, a página está errada de novo.** Consultada em 17 de
outubro, ela mostra Aplicação e Armazenamento em **queda total desde 1º de
outubro** — 0% por dia, 16 dias seguidos —, enquanto `nexopm.com` e
`storage.nexopm.com` respondem 200 de fora e a própria API de status, que
é servida pela aplicação "fora do ar", responde normalmente. No dia 1º o
e-mail e o pagamento também caíram (87,6% e 89,8%) e voltaram no dia
seguinte; aplicação e storage não voltaram. Banco, cache, auth e jobs
seguem verdes. Ainda não
diagnostiquei a causa. O que dá pra dizer é que é a mesma classe de
defeito deste post — a sonda medindo o caminho dela, não o do cliente — e
que o desenho dos alertas não ajuda aqui: eles saem só em transição, e
um componente parado no mesmo estado há 16 dias não gera mensagem
nenhuma depois da primeira.

## O que isso prova, e o que não prova

Prova que um número de uptime ruim pode ser inteiramente um defeito de
medição: o mesmo Resend, as mesmas requisições, e a página foi de 51,7% a
99,7% sem nada mudar do lado do serviço. Prova que "o processo está vivo"
e "conseguimos usar" são perguntas diferentes — e que a sonda que só faz a
primeira deixa passar justamente as falhas que o cliente sente, como a
credencial rejeitada do AbacatePay.

Não prova que o e-mail da Nexo tem 99,7% de disponibilidade no sentido
que um cliente entende: prova que, medido de dentro do próprio servidor,
com a definição de "respondeu", ele teve. Não prova que a régua nova está
certa — a página está, neste exato momento, mostrando 16 dias de queda de
um componente que está no ar. Uma página de status honesta não é a que
mostra o número alto; é a que mede de onde o cliente está. A da Nexo ainda
não mede.
