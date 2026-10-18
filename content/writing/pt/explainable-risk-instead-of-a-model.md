---
title: Risco explicável em vez de um modelo — prever violação de SLA com uma tabela de pontos
description: "Para avisar antes de o SLA estourar, a resposta óbvia era treinar um modelo com o histórico de chamados. No ServiceDesk do Steel a decisão foi outra: nove fatores com peso fixo, soma travada em 100 por teste, cortes em 40 e 70, e cada fator gravando a frase que explica a nota. Isto é o algoritmo, um chamado calculado à mão, o que ele é formalmente, como o agrupamento de incidentes repetidos monta a assinatura — e o fato de ainda não existir backtest nenhum."
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
| `stale` | tempo desde a última interação | **12** | rampa de 8 h a 48 h |
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
descontando pausas de fase. Relógio pausado não pontua.

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

- aberto há 6 h, num horário em que o relógio de SLA está correndo, com
  prazo de resolução de 8 h úteis → **75%** do prazo consumido;
- ninguém assumiu;
- prioridade `P2`, nível 3 numa escala que vai até 4;
- nenhuma interação desde a abertura;
- o departamento tem 14 chamados abertos; a média dos departamentos do
  workspace é 8;
- o cliente já teve um prazo violado antes; o serviço, não.

| Fator | Conta | Pontos | Frase gravada |
|---|---|---|---|
| `sla_consumed` | (75 − 50) / (100 − 50) = 0,5 × 30 | **15** | "75% do prazo de resolução consumido (em horário útil)" |
| `unassigned` | 6 h / 4 h → satura em 1 × 12 | **12** | "Sem responsável há 6 h" |
| `priority` | (3 − 1) / (4 − 1) = 0,667 × 12 | **8** | "Prioridade P2" |
| `stale` | 6 h < 8 h → rampa ainda em 0 | — | — |
| `queue_pressure` | (14 − 8) / 8 = 0,75 × 8 | **6** | "Fila do time com 14 chamados abertos (média do workspace: 8)" |
| `history` | só o cliente → 0,5 × 6 | **3** | "Este cliente já teve prazo violado antes" |
| **Total** | | **44** | `MEDIUM` |

Quarenta e quatro pontos, faixa média, e quatro frases que o agente
consegue conferir olhando o chamado. Ninguém precisa acreditar no
número: dá para responder "por que este chamado está amarelo" lendo uma
linha do banco, que é exatamente a consequência que a ADR queria.

O mesmo exemplo mostra uma propriedade menos óbvia da tabela. Se o
chamado seguir parado até estourar o prazo, `sla_consumed` vai a 30 e a
nota sobe para perto de **60** (59, mais o ponto que `stale` passa a
valer depois de 8 h) — ainda `MEDIUM`. O fator mais pesado satura em 30;
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
3. remove repetidos, **ordena alfabeticamente** e fica com no máximo **4**.

A ordenação é o que faz "Servidor de e-mail fora do ar" e "E-mail fora do
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
- **80 testes** nas três libs puras (`risk.ts`, `risk-compute.ts`,
  `incident-cluster.ts`), todos passando, incluindo os cortes exatos
  (nota 40 cai em `MEDIUM`, 70 em `HIGH`) e o teto de 100 com todos os
  fatores no máximo;
- cada previsão gravada carrega as frases dos fatores, então toda nota é
  auditável linha a linha;
- previsão útil no primeiro dia de um workspace novo, porque só
  `history` depende de passado — e ele vale no máximo 6 pontos.

A comparação contra a alternativa — um modelo treinado, ou mesmo o
estado "em risco" que o módulo de SLA já tinha (por padrão, a partir de
80% do prazo) — **não existe**. Procurei: o repositório não tem
avaliação, backtest, nem medida de precisão ou recall desta heurística.

## Onde quebra

**Não há backtest.** É a limitação mais importante, e a causa raiz é
de desenho: os pesos e cortes foram escolhidos, não ajustados. Ninguém
rodou a heurística sobre chamados já encerrados para ver quantos dos que
ela marcou como `HIGH` de fato violaram, e quantos dos que violaram ela
deixou em `LOW`. Sem isso, "40" e "70" são julgamento, não evidência. O
exemplo acima mostra que a tabela pode deixar um chamado já violado, sem
responsável, em `MEDIUM` — pode ser exatamente o comportamento certo, ou
não. Não dá para saber sem rodar contra o histórico. E o histórico para
isso existe: os chamados encerrados guardam o rótulo de violação. O
custo de fazer é baixo; ele só não foi pago.

**A nota não é probabilidade.** A ADR trava a soma em 100 para a nota
ser "legível como porcentagem" — porcentagem do máximo de pontos, não
chance de violar. 44 não quer dizer 44%. Na prática nem 100 é alcançável:
`unassigned` e `assignee_load` são mutuamente exclusivos (um exige não ter
responsável, o outro exige ter), então o teto real é **94** para chamado
sem responsável e **88** para chamado com.

**Fatores correlacionados contam duas vezes.** Um modelo aditivo assume
que cada linha traz informação nova. Aqui, um chamado sem responsável
quase sempre também está parado e consumindo prazo — três fatores
somando pontos pelo mesmo fato. Uma regressão absorveria isso nos pesos;
uma tabela escrita à mão, não.

**Só um relógio conta.** O fator de prazo usa o timer de resolução
sempre que ele existe, e só cai para o de 1ª resposta quando não há
prazo de resolução. Um chamado a 95% do prazo de 1ª resposta e a 30% do
de resolução pontua zero em `sla_consumed`. O módulo de SLA continua
marcando o timer de 1ª resposta como em risco por conta própria, mas a
nota preditiva não enxerga isso.

**"Sem interação da equipe" conta qualquer interação.** O fator `stale`
lê `lastActivityAt`, que é atualizado também quando o **cliente** manda
mensagem por WhatsApp ou e-mail. A frase diz "Sem interação da equipe há
X", mas o cliente cobrando "alguma novidade?" zera a rampa — a nota cai
justamente quando a insatisfação sobe.

**A assinatura de incidentes é frágil nas bordas.** Ela trunca para os 4
primeiros termos **em ordem alfabética**, não os 4 mais informativos.
"VPN cai ao acessar sistema financeiro remoto" vira
`acessar-cai-financeiro-remoto` — o termo `vpn`, o mais distintivo do
título, fica de fora; e o mesmo título sem a palavra "remoto" vira
`acessar-cai-financeiro-sistema`, outro grupo. Não há stemming
("impressora" e "impressoras" são termos diferentes), o corpo do chamado
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

Não prova que a heurística prevê bem. Não há medida de precisão nem de
recall, não há comparação com o estado "em risco" que já existia, e os
cortes 40 e 70 nunca foram confrontados com um chamado encerrado. O que
existe hoje é uma régua explicável para **priorizar fila** — o objetivo
que a própria ADR assume — e não uma previsão validada de quem vai
violar o prazo.
