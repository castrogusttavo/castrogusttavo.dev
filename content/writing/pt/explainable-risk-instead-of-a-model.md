---
title: Risco explicável em vez de um modelo — prever violação de SLA com uma tabela de pontos
description: "Para avisar antes de o SLA estourar, a resposta óbvia era treinar um modelo com o histórico de chamados. No ServiceDesk do Steel a decisão foi outra: nove fatores com peso fixo, soma travada em 100 por teste, cortes em 40 e 70, e cada fator gravando a frase que explica a nota. Isto é o algoritmo, um chamado calculado à mão, o que ele é formalmente, como o agrupamento de incidentes repetidos monta a assinatura — e as quatro lacunas que escrever este post expôs, já corrigidas, incluindo um backtest que existe mas ainda não rodou contra dado real."
icon: idea
date: "2026-12-10"
---

Num ServiceDesk, saber que um chamado violou o prazo só serve para o
relatório do mês. O que muda alguma coisa é saber **antes**: um selo
"este chamado vai estourar" no quadro e na fila, a tempo de alguém
remanejar um agente ou pegar o chamado que ninguém assumiu. A mesma
necessidade aparece de outro jeito com incidentes: cinco chamados de
"e-mail fora do ar" na mesma semana provavelmente são um problema só, e
alguém deveria abrir esse problema.

O Steel é a plataforma multi-tenant da Stratus Telecom — ServiceDesk ITIL
4, CRM, Comunicação/WhatsApp e o Steel AI por cima dos três.
Sou Lead Software Engineer na Stratus Telecom: construí a primeira versão do Steel e hoje lidero a modernização técnica dele. Este post é sobre a ADR 0016, que decidiu
como o ServiceDesk prevê risco de violação de SLA — e por que essa
previsão não é um modelo treinado.

## A resposta óbvia, e os três custos dela

A saída óbvia é pegar o histórico de chamados, rotular quem violou e quem
não violou, e treinar um classificador. A ADR 0016 lista três custos que
o produto não paga hoje:

1. **Dado pessoal de cliente saindo do banco.** Treinar exige levar
   título, descrição, cliente e conversa para um pipeline de treino. A
   ADR 0006 já tinha fixado a linha oposta para o assistente de IA
   central: dado pessoal de cliente não entra em prompt. Um pipeline de
   treino seria a mesma exposição por outra porta.
2. **Cada workspace é um sistema diferente.** No Steel, fases, políticas
   de SLA e calendários de expediente são configuráveis por workspace
   (ADR 0008). Um modelo global aprenderia uma média que não existe em
   lugar nenhum — "8 horas sem resposta" é normal num time de
   infraestrutura com SLA de 3 dias e é crise num suporte com SLA de 4
   horas. Um modelo por workspace resolveria isso, mas precisa de
   histórico, e um cliente novo chega com zero chamados.
3. **Um número sem motivo não muda comportamento.** A frase da ADR é
   melhor do que qualquer paráfrase: agente não remaneja fila porque "a
   IA deu 0,82".

O terceiro custo é o que define o resto do desenho. Se o objetivo é fazer
alguém agir, a previsão precisa vir com o porquê — e um porquê que o
agente reconheça como verdade olhando o chamado.

## A ideia: uma tabela de pontos, e o porquê gravado junto

Em vez de aprender pesos, o ServiceDesk soma pontos de uma tabela fixa,
versionada em código (`src/lib/servicedesk/risk.ts`). São nove fatores,
cada um com um peso máximo, somando 100:

| Fator | O que mede | Peso máximo | Como pontua |
|---|---|---|---|
| `sla_consumed` | % do prazo consumido (minutos úteis) | **30** | rampa de 50% a 100%; violado = cheio |
| `unassigned` | chamado sem responsável | **12** | rampa de 0 a 4 h desde a abertura |
| `priority` | prioridade ou severidade | **12** | posição na escala do workspace |
| `stale` | tempo desde a última interação da equipe | **12** | rampa de 8 h a 48 h |
| `reopened` | reaberturas | **8** | 1 reabertura = metade, 2 = cheio |
| `queue_pressure` | fila do departamento | **8** | 0 na média, cheio em 2× a média |
| `waiting_third_party` | fase de espera com o relógio correndo | **6** | tudo ou nada |
| `assignee_load` | carga do responsável | **6** | 0 na média, cheio em 2× a média |
| `history` | cliente/serviço já violou prazo antes | **6** | um dos dois = 3, os dois = 6 |

A nota cai em três faixas: `LOW` abaixo de 40, `MEDIUM` a partir de
**40**, `HIGH` a partir de **70**. E a regra que a ADR escreve em negrito:
**a previsão nunca aparece sem o porquê**. Cada fator que pega grava, em
`SdTicketRiskPrediction.factors`, a frase em pt-BR que a interface mostra.
Selo sem motivo é bug.

## Como funciona

### Cada fator é uma rampa recortada

Quase nenhum fator é binário. A lib pura (`risk-compute.ts`) transforma
cada sinal numa fração entre 0 e 1 e multiplica pelo peso da tabela:

```ts
/** Rampa linear: 0 em `from`, 1 em `full` (os cortes nunca são iguais). */
function ramp(value: number, from: number, full: number): number {
  return clamp01((value - from) / (full - from))
}

function factor(key, ratio, detail) {
  const spec = SPECS[key]
  const share = clamp01(ratio)
  if (share === 0) return null
  return {
    key,
    label: spec.label,
    weight: Math.max(1, Math.round(spec.weight * share)),
    detail,
  }
}
```

Dois detalhes desse trecho importam. Um fator com fração zero
**não aparece** — não existe "sem responsável: 0 pontos" na lista de
motivos. E um fator com fração positiva vale **no mínimo 1 ponto**: se o
sinal existe, ele aparece na explicação, mesmo que arredondado fosse a
zero.

Os cortes das rampas ficam numa constante separada, `SD_RISK_TUNING`
(prazo de 50% a 100%, sem responsável até 4 h, parado de 8 h a 48 h,
pressão saturando em 2× a média). Mudar peso ou corte é mudar a tabela —
sem migração de banco. O teste do catálogo trava a soma:

```ts
it('should keep the weights adding up to 100', () => {
  const total = SD_RISK_FACTOR_SPECS.reduce((sum, f) => sum + f.weight, 0)

  expect(total).toBe(100)
})
```

### A régua é do workspace, não global

"Fila cheia" e "responsável sobrecarregado" não são números absolutos.
O worker carrega, por workspace, a contagem de chamados abertos por
departamento e por responsável, e o fator compara contra a **média do
próprio workspace**: 0 pontos até a média, peso cheio em 2× a média. Um
time de 3 pessoas não é medido pela régua de um time de 30. Prioridade
funciona igual — o fator lê a posição do chamado na escala de
prioridades daquele workspace, `(level − 1) / (max − 1)`, em vez de
assumir que todo mundo usa P1–P4.

O prazo também é do workspace: `sla_consumed` usa o mesmo relógio do
módulo de SLA, em minutos úteis sobre o calendário de expediente e
descontando pausas de fase. Relógio pausado não pontua. E são dois
relógios: o de resolução, sempre que tem prazo, e o de 1ª resposta,
enquanto ninguém respondeu. O fator pontua pelo **mais urgente** dos dois
(violado vence qualquer porcentagem), e a previsão de estouro
(`breachEtaAt`) é o prazo que vence **primeiro**.

"Interação", em `stale`, é da equipe: o worker lê o último evento de
agente do chamado (`actorKind = AGENT`). Mensagem do cliente, ação do
Steel AI e evento de sistema não contam — se a equipe nunca agiu, o
silêncio conta desde a abertura.

### Calculado no worker, lido pronto na tela

Nada disso roda na renderização. A fila `servicedesk-risk` tem dois jobs:
`recompute-risk`, a cada 10 minutos (`*/10 * * * *`), recalcula todos os
chamados abertos de cada workspace com o módulo ligado, em lotes de 200,
e grava **uma linha por chamado** (upsert por `ticketId`); e
`scan-clusters`, de hora em hora no minuto 25, cuida dos incidentes
repetidos (abaixo). Quadro, fila e tela do chamado só leem a previsão
pronta.

A notificação também tem regra: o aviso `sla.breach_predicted` sai só
quando o chamado **entra** na faixa alta — a faixa anterior era outra, ou
não havia previsão. Repetir a cada 10 minutos seria spam. E o corpo da
notificação são as frases dos três primeiros fatores, não a nota.

## Um chamado, calculado à mão

Um chamado hipotético, para ver os números saírem da tabela:

- aberto há 6 h, num horário em que o relógio de SLA está correndo;
- a política dá 4 h úteis para a 1ª resposta e 8 h úteis para a
  resolução → 1ª resposta **violada** há 2 h, resolução em **75%**;
- ninguém assumiu, ninguém respondeu;
- prioridade `P2`, nível 3 numa escala que vai até 4;
- nenhuma ação da equipe desde a abertura;
- o departamento tem 14 chamados abertos; a média dos departamentos do
  workspace é 8;
- o cliente já teve um prazo violado antes; o serviço, não.

| Fator | Conta | Pontos | Frase gravada |
|---|---|---|---|
| `sla_consumed` | 1ª resposta violada → peso cheio, 1 × 30 | **30** | "Prazo de 1ª resposta já violado" |
| `unassigned` | 6 h / 4 h → satura em 1 × 12 | **12** | "Sem responsável há 6 h" |
| `priority` | (3 − 1) / (4 − 1) = 0,667 × 12 | **8** | "Prioridade P2" |
| `stale` | 6 h < 8 h → rampa ainda em 0 | — | — |
| `queue_pressure` | (14 − 8) / 8 = 0,75 × 8 | **6** | "Fila do time com 14 chamados abertos (média do workspace: 8)" |
| `history` | só o cliente → 0,5 × 6 | **3** | "Este cliente já teve prazo violado antes" |
| **Total** | | **59** | `MEDIUM` |

Cinquenta e nove pontos, faixa média, e cinco frases que o agente
consegue conferir olhando o chamado. A previsão de estouro aponta para o
prazo de 1ª resposta, que já passou, e não para a resolução, que ainda
tem 2 h. Ninguém precisa acreditar no
número: dá para responder "por que este chamado está amarelo" lendo uma
linha do banco, que é exatamente a consequência que a ADR queria.

Refiz essa conta à mão (e conferi rodando a lib) depois das correções
da seção "Onde quebrou".
Na versão anterior, o mesmo chamado dava **44**: o fator de prazo só
olhava o relógio de resolução (75% → 15 pontos) e a 1ª resposta
estourada não aparecia em lugar nenhum da nota.

O exemplo também mostra uma propriedade menos óbvia da tabela. Se o
chamado seguir parado até estourar também o prazo de resolução, a nota
vai a **60** (os mesmos 59, mais o ponto que `stale` passa a valer depois
de 8 h) — ainda `MEDIUM`. O fator mais pesado satura em 30;
chegar a `HIGH` (70) exige pelo menos 40 pontos vindos dos outros oito.
O caso de teste que acerta 70 em cheio é justamente isso: prazo violado
(30) + sem responsável (12) + prioridade máxima (12) + parado há 48 h ou
mais (12) + uma reabertura (4).

## O que isso é, formalmente

Sem o vocabulário de ML, isso é uma **regra de pontuação aditiva** — da
mesma família dos escores clínicos de pontos, como o CHA₂DS₂-VASc:
cada fator de risco presente soma pontos, a soma cai numa faixa, e a
faixa orienta a conduta. A diferença é que aqui a contribuição é
graduada, não 0/1. Escrita como fórmula:

```
nota = min(100, Σᵢ round(wᵢ · gᵢ(xᵢ)))
```

onde `wᵢ` é o peso da tabela e `gᵢ` é uma função recortada em [0, 1] —
quase sempre uma rampa linear. É um modelo aditivo generalizado com as
funções de forma escritas à mão em vez de aprendidas. Aditivo é o que
torna a explicação honesta: a nota é **literalmente** a soma das linhas
que a tela mostra, sem interação escondida entre fatores.

Isso também desenha o caminho para calibrar depois, que a ADR menciona e
deixa explicitamente para **uma ADR nova**, não uma revisão desta. O
histórico de cada workspace tem o rótulo de graça
(`resolutionBreached`, `firstResponseBreached`). Uma regressão logística
sobre as mesmas funções de forma,

```
logit P(violar) = β₀ + Σᵢ βᵢ · gᵢ(xᵢ)
```

devolveria um `βᵢ` por fator; reescalados para somar 100, eles viram os
novos pesos da mesma tabela. O formato dos fatores, a frase de cada um, o
contrato da API e a tela não mudariam — só os números da coluna "peso
máximo". E um workspace sem histórico continuaria com os pesos fixos de
hoje. Isso é um caminho possível, não algo feito: não existe código de
calibração no repositório.

## Incidentes repetidos: uma assinatura, não uma similaridade

A segunda metade da ADR aplica a mesma régua — determinístico, auditável,
sem LLM — ao "estes incidentes são a mesma coisa". O agrupamento
(`incident-cluster.ts`) não calcula distância entre textos. Ele monta uma
**assinatura** por chamado e agrupa por igualdade exata:

```
categoria:subcategoria:serviço:termos
```

Os termos saem do título assim:

1. normaliza: decompõe em NFD, remove diacríticos, minúsculas, troca tudo
   que não é `a-z0-9` por espaço;
2. descarta palavra com menos de 3 caracteres, número puro (ramal, IP,
   protocolo — o que varia entre chamados não agrupa nada) e uma lista de
   stopwords: palavras de ligação do português e os verbos genéricos de
   chamado (`urgente`, `favor`, `chamado`, `problema`, `erro`, `ajuda`,
   `preciso`…);
3. remove repetidos e, se sobrarem mais de **4**, fica com os 4 mais
   relevantes: primeiro o termo que mais se repete no próprio título,
   depois o que aparece em mais incidentes da **janela de observação**; a
   ordem alfabética só desempata;
4. põe os escolhidos em ordem alfabética.

Frequência na janela, e não tf-idf, foi de propósito: o idf premia o
termo raro, que é justamente o que não se repete e portanto não forma
grupo. E a ordenação final é o que faz "Servidor de e-mail fora do ar" e "E-mail fora do
ar no servidor" caírem no mesmo grupo: os dois viram `fora-mail-servidor`.
Título sem nenhum termo significativo ("urgente!!!") não gera assinatura
— agrupar todos esses juntaria chamados que não têm nada a ver.

Um grupo só vira sugestão com **3 ou mais** incidentes numa janela de
**7 dias**, e fica em `SdIncidentCluster`, único por
`(workspaceId, signature)`. Sugestão é a palavra-chave: o worker nunca
abre problema sozinho. Abrir é ação do agente (`openProblem`), que cria o
chamado do tipo `PROBLEM` com a lista dos incidentes na descrição e,
opcionalmente, vincula os incidentes como filhos. Descartar também é ação
humana — e um grupo descartado só volta a ser sugerido quando entram
pelo menos mais 3 incidentes **depois** do descarte. Senão o agente que
disse "não" seria ignorado a cada hora.

## Resultados: o que dá para medir hoje

O que este trabalho entrega de verificável é o contrato, não a precisão:

- **9 fatores**, pesos somando **100**, travados por teste;
- **117 testes** nas quatro libs puras (`risk.ts`, `risk-compute.ts`,
  `incident-cluster.ts` e o novo `risk-backtest.ts`; eram 80 nas três
  primeiras antes das correções), todos passando, incluindo os cortes exatos
  (nota 40 cai em `MEDIUM`, 70 em `HIGH`) e o teto de 100 com todos os
  fatores no máximo;
- cada previsão gravada carrega as frases dos fatores, então toda nota é
  auditável linha a linha;
- previsão útil no primeiro dia de um workspace novo, porque só
  `history` depende de passado — e ele vale no máximo 6 pontos.

A comparação contra a alternativa — um modelo treinado, ou mesmo o
estado "em risco" que o módulo de SLA já tinha (por padrão, a partir de
80% do prazo) — **ainda não existe**. A ferramenta para medir agora
existe (`pnpm risk:backtest`, abaixo), mas ainda não rodou contra dado
real, então não tenho número de precisão, recall ou calibração para
mostrar.

## Onde quebrou, e o que já foi corrigido

Escrever este post, com o código aberto do lado, expôs quatro lacunas.
As quatro foram corrigidas no
[steel-so/steel#128](https://github.com/steel-so/steel/pull/128) e estão
em homologação desde 18/10/2026 (Steel `2026.10.18.4`). Pesos, faixas e
o formato dos fatores não mudaram; a ADR 0016 ganhou uma nota de
atualização em vez de ser reescrita.

### O que foi corrigido

**"Sem interação da equipe" contava qualquer interação.** O fator
`stale` lia `lastActivityAt`, que também anda quando o **cliente** manda
mensagem pelo portal, por e-mail ou WhatsApp. A frase dizia "Sem
interação da equipe há X", mas o cliente cobrando "alguma novidade?"
zerava a rampa — a nota caía justamente quando a insatisfação subia.
Agora o worker busca o último evento de agente de cada chamado, numa
consulta por lote de 200; Steel AI e sistema não contam. Se essa
consulta falhar, o lote volta ao comportamento antigo em vez de tratar
todo chamado como abandonado.

**Só um relógio contava.** O fator de prazo usava o timer de resolução
sempre que ele existia e só caía para o de 1ª resposta quando não havia
prazo de resolução. Um chamado a 95% do prazo de 1ª resposta e a 30% do
de resolução pontuava zero em `sla_consumed`, e a previsão de estouro
mostrava o prazo mais distante. Agora os dois entram enquanto ninguém
respondeu, o fator usa o mais urgente e a previsão usa o que vence
primeiro — é a diferença entre 44 e 59 no chamado calculado à mão.

**A assinatura cortava os termos em ordem alfabética.** Com mais de 4
termos, ficavam os 4 primeiros do alfabeto, não os mais informativos.
"VPN cai ao acessar sistema financeiro remoto" virava
`acessar-cai-financeiro-remoto`, e o mesmo título sem "remoto" virava
`acessar-cai-financeiro-sistema`, outro grupo. Agora o corte é por
frequência no título e na janela. Com esses dois chamados sozinhos na
janela, `remoto` aparece em um só e sai: os dois viram
`acessar-cai-financeiro-sistema` e caem no mesmo grupo. O `vpn`, porém,
continua de fora nesse caso — empata com `acessar`, `cai`, `financeiro`
e `sistema` (todos em dois chamados) e perde no desempate alfabético. Ele
só entra quando se repete na janela mais do que os outros: com um
terceiro chamado, "VPN caindo no sistema financeiro", os dois primeiros
viram `acessar-financeiro-sistema-vpn` (o terceiro vira
`caindo-financeiro-sistema-vpn` — sem stemming, `cai` e `caindo` são
termos diferentes).

**Não havia backtest.** Os pesos e cortes foram escolhidos, não
ajustados, e ninguém tinha rodado a heurística sobre chamados encerrados.
Agora existe `pnpm risk:backtest`, que só lê o banco. Para cada chamado
encerrado com prazo, ele tira três fotos — a 25%, 50% e 75% do caminho
entre a abertura e a violação (ou o encerramento) —, recalcula a nota com
o que se sabia em cada instante e compara a faixa prevista com o
desfecho real: calibração por faixa (taxa real de violação em `LOW`,
`MEDIUM` e `HIGH`), precisão e recall da faixa alta como alarme, e
antecedência — quanto tempo antes da violação o chamado entrou em
`HIGH`.

### O que continua quebrado

**O backtest existe, mas ainda não tem resultado.** Ele não rodou contra
dado real, então não há número de calibração para citar: "40" e "70"
continuam sendo julgamento, não evidência. O exemplo acima mostra que a
tabela deixa um chamado com a 1ª resposta estourada, sem responsável, em
`MEDIUM` — pode ser o comportamento certo, ou não, e só o histórico vai
dizer. E mesmo quando rodar, o número vai sair enviesado para baixo em
três fatores. A causa raiz é que o histórico do chamado não é
versionado: o script não reconstrói a fase nem a pausa de SLA de cada
instante passado (assume fase em andamento com o relógio correndo) e
reconta fila e carga só com os chamados da amostra. Por isso
`waiting_third_party`, `queue_pressure` e `assignee_load` saem
subestimados.

**A nota não é probabilidade.** A ADR trava a soma em 100 para a nota
ser "legível como porcentagem" — porcentagem do máximo de pontos, não
chance de violar. 59 não quer dizer 59%. Na prática nem 100 é alcançável:
`unassigned` e `assignee_load` são mutuamente exclusivos (um exige não ter
responsável, o outro exige ter), então o teto real é **94** para chamado
sem responsável e **88** para chamado com.

**Fatores correlacionados contam duas vezes.** Um modelo aditivo assume
que cada linha traz informação nova. Aqui, um chamado sem responsável
quase sempre também está parado e consumindo prazo — três fatores
somando pontos pelo mesmo fato. Uma regressão absorveria isso nos pesos;
uma tabela escrita à mão, não.

**A assinatura de incidentes ainda é frágil nas bordas.** O corte por
frequência tem um custo aceito: a assinatura de um título com mais de 4
termos pode mudar conforme a janela muda — o corte alfabético era
estável, só que arbitrário. Não há stemming ("impressora" e
"impressoras" são termos diferentes), o corpo do chamado
é ignorado, e um incidente categorizado errado nunca encontra o grupo
dos certos, porque categoria, subcategoria e serviço fazem parte da
chave. A escolha por igualdade exata foi deliberada — dá para explicar
qualquer agrupamento lendo a assinatura —, mas o preço é recall: o
detector deixa passar repetição escrita de jeitos diferentes.

## O que isso prova, e o que não prova

Prova que dá para entregar previsão de risco de SLA com explicação por
construção, sem tirar dado de cliente do banco e sem depender de
histórico para funcionar no primeiro dia: a nota é a soma das frases que
a tela mostra, e qualquer "por que está vermelho" se responde lendo uma
linha. E deixa o formato pronto para uma calibração futura sem mudar
contrato — o que é desenho, não resultado.

Não prova que a heurística prevê bem. A ferramenta para medir existe
agora, mas ainda não rodou contra dado real: não há medida de calibração,
precisão nem recall, não há comparação com o estado "em risco" que já
existia, e os cortes 40 e 70 ainda não foram confrontados com um chamado
encerrado. O que
existe hoje é uma régua explicável para **priorizar fila** — o objetivo
que a própria ADR assume — e não uma previsão validada de quem vai
violar o prazo.
