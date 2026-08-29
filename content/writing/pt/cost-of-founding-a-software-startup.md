---
title: O preço de existir juridicamente antes da Nexo ter o primeiro cliente
description: "Antes de a Nexo faturar um real, eu e meu sócio já tínhamos gasto quase R$8 mil só pra empresa existir juridicamente — contador, taxa de Junta Comercial, taxa de prefeitura, certificado digital. Este post desmonta cada real e cada sigla desse processo: por que não abrimos MEI, como dividimos 60/40 com vesting de 48 meses, os custos recorrentes que saem todo mês antes de qualquer receita, e o modelo de rentabilidade que diz quantos clientes pagam a empresa inteira — hoje, zero."
icon: note
date: "2026-08-28"
---

Antes de a Nexo processar o pagamento de um cliente real, eu e meu sócio já
tínhamos gasto cerca de **R$8 mil só pra empresa existir juridicamente** —
metade pra cada um. Isso não inclui uma linha de código, um clique de
marketing ou um real de infraestrutura. É o custo de virar pessoa jurídica
antes de ter qualquer motivo pra ser uma.

Esse número tem dentro dele um contador, duas taxas de órgãos diferentes, uma
assinatura de certificado digital e uma dúzia de siglas que eu não sabia que
precisava entender pra abrir uma empresa de software. É isso que este post
desmonta: o jurídico, o societário e o financeiro que vêm antes — e continuam
depois — de qualquer produto. A Nexo é o SaaS de gestão de projetos que
construo como founder engineer; os números aqui são os dela, reais, não
estimativa de curso de empreendedorismo.

## O time: dois sócios, um deles fora da folha

A Nexo tem dois sócios. Eu sou o founder técnico — arquitetura, produto,
engenharia, sozinho no código desde o primeiro commit. Meu sócio cuida de
RH, gestão e da parte operacional da empresa. Marketing e vendas não é
atribuição de nenhum dos dois: é terceirizado pra uma PJ contratada
especificamente pra isso. Três frentes, duas pessoas com equity, um
fornecedor.

Essa divisão importa pro resto do post porque muda de quem é a decisão em
cada gasto. Contador, taxas e certificado digital são decisão conjunta —
existir juridicamente não é opcional pra nenhum dos dois. Marketing é
orçamento aprovado, não trabalho feito por sócio.

## Por que não abrimos MEI

A tentação óbvia pra quem tá começando é abrir MEI — mais barato, mais
rápido, sem contador obrigatório. Não serve pra esse caso, por dois motivos
estruturais, não de preferência:

- **MEI é individual.** O nome já diz — Microempreendedor **Individual**.
  Não comporta dois sócios com participação societária. Pra dividir equity
  de verdade, precisa de um tipo societário que reconheça sócios, não um CPF
  com CNPJ anexado.
- **MEI tem teto de faturamento** (hoje R$81 mil/ano). Um SaaS que projeta
  passar de R$300 mil/ano de receita recorrente nos primeiros dois anos
  estoura esse teto rápido — e migrar de MEI pro regime seguinte no meio do
  caminho é mais fricção do que abrir certo desde o início.

O que abrimos foi uma **Sociedade Limitada (LTDA)**, classificada como
**ME** (Microempresa) — que não é um tipo societário, é uma faixa de porte
dentro do Simples Nacional pra empresas com receita bruta anual de até
R$360 mil. `LTDA` é o tipo jurídico; `ME` é só o tamanho declarado. Boa
parte da confusão que eu tinha antes de abrir vinha de tratar as duas coisas
como sinônimos.

O CNAE principal registrado foi `6203-1/00` — desenvolvimento e
licenciamento de software não-customizável, o código que casa com SaaS de
prateleira. CNAEs secundários cobrem licenciamento de software customizável
e hospedagem/tratamento de dados, pra não ficar descoberto se o modelo de
negócio mudar de forma.

## O custo de abrir: Junta, prefeitura e contador

No orçamento que fizemos antes de existir, projetamos R$800 a R$1.500 pra
Junta Comercial mais contador na constituição. Na prática, o que pagamos
separado foi **R$220 de taxa da Junta Comercial** e **R$200 de taxa da
prefeitura** — o resto daquele intervalo é o serviço do próprio contador
pra conduzir a abertura, que cobra à parte da mensalidade recorrente.

| Item | Valor | Quando |
| --- | --- | --- |
| Taxa da Junta Comercial | R$220 | Na abertura |
| Taxa da prefeitura (alvará) | R$200 | Na abertura |
| Serviço do contador (abertura) | Resto do intervalo R$800-1.500 | Na abertura |
| Contabilidade recorrente | R$250/mês | Todo mês, indefinidamente |

Fora do jurídico direto, o resto do aporte inicial de ~R$8 mil (~R$4 mil
por sócio) cobriu registro de marca no INPI, seis meses de capital de giro
pra manter as ferramentas mínimas rodando, e uma reserva de imprevisto. Esse
é o número que importa quando alguém pergunta "quanto custa começar": não
R$240 mil de aporte de aceleradora — **R$8 mil, uma vez, dividido em dois**.

## Contabilidade e certificado digital: os boletos que não param

A contabilidade da Nexo é com um contador direto — profissional autônomo
contratado, sem plataforma de contabilidade online no meio fazendo
intermediação. Na prática isso significa e-mail e WhatsApp direto com quem
resolve, não fila de suporte de plataforma.

Além da mensalidade dele (R$250), existe um segundo boleto recorrente
que ninguém menciona antes de abrir empresa: o **e-CPF**, certificado
digital assinado por R$49,90/mês. É ele que assina documentos fiscais e
autentica em portais do governo em nome do sócio — sem ele, o próprio
contador não consegue emitir nem transmitir boa parte das obrigações da
empresa em seu nome.

O regime tributário escolhido foi o **Simples Nacional**, dentro dele
decidido pelo **Fator R**:

```
Fator R = folha dos últimos 12 meses (pró-labore + encargos) ÷ receita bruta dos últimos 12 meses
```

Fator R **≥ 28%** cai no **Anexo III**; abaixo disso, no **Anexo V** — mais
caro. No início, com receita bruta anual abaixo de R$180 mil, a barreira é
trivial: **R$2.300/mês de pró-labore já garante o Anexo III a 6%** de
alíquota. Em receita mais alta, manter o Fator R fica caro o suficiente pra
não compensar — é conta que se refaz a cada faixa de faturamento, não se
decide uma vez. O pró-labore mínimo legal é um salário mínimo por sócio,
com 11% de INSS retido na fonte.

## O split: dividir o que a empresa ainda não tem

A parte mais cara da reunião de fundação não foi nenhuma das anteriores —
foi decidir quanto cada sócio tem de participação numa empresa que ainda
não fatura. Usamos um framework de peso explícito em vez de "dividir no
meio" ou "quem teve a ideia leva mais":

| Fator | Peso | O que pondera |
| --- | --- | --- |
| Ideia / concepção original | 5% | Quem trouxe a tese |
| Produto já construído (sunk work) | 20% | Fundação em produção, feita solo |
| Dedicação futura (horas/semana) | 30% | O que cada um entrega dos próximos 18 meses |
| Risco assumido (capital, saída do emprego) | 20% | Quem põe dinheiro e quem larga a renda antes |
| Competência crítica insubstituível | 20% | Sem esta pessoa, o negócio para? |

O resultado foi **60/40 pro lado técnico** — puxado principalmente pelo
produto já construído sozinho antes da sociedade formal existir. Esse split
não é a parte que protege a empresa, no entanto. Contrato social é registro
público mínimo; o que protege de verdade é o **acordo de sócios**, um
documento privado com as cláusulas que realmente importam quando as coisas
dão errado:

- **Vesting de 48 meses, cliff de 12** — sair antes de um ano dá zero
  participação; depois disso, aquisição mensal. Vesting é **reverso**: as
  quotas já são emitidas no contrato, mas a empresa recompra a parte
  não-vestida por valor simbólico se alguém sair antes do prazo.
- **Aceleração**: single trigger de 50% em venda da empresa; double trigger
  (venda + demissão sem justa causa) de 100%.
- **Cessão de propriedade intelectual** total e irrevogável — todo código,
  marca, domínio e conteúdo pertence à PJ, nunca à pessoa física. É a
  cláusula mais importante do documento: sem ela, um sócio que sai leva o
  produto junto.
- **Desempate**: voto de qualidade mais uma cláusula de *shotgun* — um
  sócio oferece um preço pela empresa, o outro decide se compra ou vende
  por aquele mesmo preço.

Dinheiro que um sócio coloca na empresa entra como **mútuo**, não como
aumento de capital: é dívida registrada, devolvida com prioridade quando
houver caixa, e — ponto central — **não altera o split**. Se entrasse como
capital social, cada aporte desigual reabriria a conversa de percentual.
Como mútuo, o dinheiro simplesmente volta.

Gasto tem alçada, pra não virar decisão informal de WhatsApp:

| Valor | Quem aprova |
| --- | --- |
| Até R$500/mês | Cada sócio, sozinho, na sua área |
| R$500-2.000/mês | Aviso ao outro, 24h pra vetar |
| Acima de R$2.000 ou contrato anual | Os dois, por escrito |

## As siglas que valem aprender

Nenhuma dessas siglas aparece num curso de programação, e todas apareceram
na minha caixa de e-mail nos primeiros meses da Nexo.

**Jurídico e tributário:**

| Sigla | O que é |
| --- | --- |
| `PJ` | Pessoa Jurídica — a empresa, distinta da pessoa física dos sócios |
| `LTDA` | Sociedade Limitada — o tipo societário; responsabilidade dos sócios limitada ao capital social |
| `ME` | Microempresa — faixa de porte por receita (até R$360 mil/ano), não um tipo societário |
| `MEI` | Microempreendedor Individual — regime pra um único dono, teto de R$81 mil/ano |
| `CNAE` | Código que classifica a atividade econômica da empresa perante o governo |
| `e-CPF` | Certificado digital que assina documentos fiscais e autentica em portais do governo |
| `INSS` | Contribuição previdenciária, retida sobre o pró-labore |
| `FGTS` | Fundo que incide sobre folha de funcionário CLT (não sobre pró-labore de sócio) |
| `Fator R` | Fórmula que decide o Anexo do Simples Nacional pela proporção folha/receita |
| `INPI` | Instituto que registra marca — sem ele, o nome da empresa não tem proteção legal |

**Financeiro e growth:**

| Sigla | O que é |
| --- | --- |
| `MRR` | Receita recorrente mensal |
| `ARR` | Receita recorrente anual (MRR × 12) |
| `ARPU` | Receita média por usuário/assento |
| `CAC` | Custo de aquisição de cliente |
| `LTV` | Valor projetado que um cliente gera ao longo da vida útil |
| `EBITDA` | Lucro antes de juros, impostos, depreciação e amortização |
| `COGS` | Custo direto de entregar o produto (infra, IA embarcada, gateway) |
| `ICP` | Perfil de cliente ideal |
| `TAM/SAM/SOM` | Mercado total / mercado atingível / mercado que dá pra capturar de fato |
| `PMF` | Product-market fit — clientes reais usando, retendo e indicando, não só validação da própria dor do fundador |

## Custos recorrentes: o que sai todo mês antes do primeiro real de receita

Separado do jurídico, existe a operação técnica e de marketing rodando em
paralelo — cada item com seu próprio boleto, mesmo sem nenhum cliente pagando
ainda:

| Item | Custo mensal | Categoria |
| --- | --- | --- |
| Contabilidade | R$250 | Jurídico |
| e-CPF | R$49,90 | Jurídico |
| Domínio (R$180/ano) | ~R$15 | Infra |
| Resend (US$20) | ~R$110 | Infra |
| VPS Hostinger Max | R$120 | Infra |
| GitHub Pro (US$4) | ~R$22 | Infra |
| Marketing | R$400-1.000 | Growth |
| Eventos/palestras (R$400-700 a cada 2-3 meses) | ~R$150-280 (média mensal) | Growth |

Somando as faixas baixa e alta, o custo mensal recorrente da Nexo hoje fica
entre **R$1.117** e **R$1.867** — sem contar pró-labore, sem contar
contratação, sem um real de receita de cliente cobrindo nada disso ainda.
É o número que qualquer founder técnico deveria saber de cabeça antes de
decidir que "já dá pra lançar".

## O modelo de rentabilidade: quantos clientes pagam a empresa

O modelo abaixo é **planejamento, não resultado medido** — a Nexo ainda não
tem clientes pagantes reais. É a mesma ressalva que uso em qualquer post
deste blog quando o número é projeção: cite a fonte, não infle o alcance.

O gateway de pagamento (AbacatePay) cobra taxas bem diferentes por método:
Pix custa R$0,80 fixo (~0,10% num ticket médio de R$812); cartão de crédito
custa 3,5% + R$0,60 (~3,57% no mesmo ticket). Num mix de 70% Pix / 30%
cartão, a taxa efetiva de gateway fica em **~1,14%**.

A margem bruta modelada é de **80%**, com custo direto (infra + IA
embarcada) em torno de **20%** — travado por um teto rígido de custo de IA
por assento, porque sem teto um punhado de usuários pesados destrói a
margem do plano inteiro. Nesse modelo, a margem de contribuição por cliente
fica em **R$592/mês**.

O breakeven não é uma data — é uma escada, destravada por cliente pagante,
não pelo calendário:

| Degrau | Custo fixo/mês | Clientes | MRR |
| --- | --- | --- | --- |
| Empresa se paga (ferramentas mínimas) | R$607 | **2** | R$1,6 mil |
| Stack completa | R$1.271 | **3** | R$2,4 mil |
| Um sócio full-time | R$6.271 | **11** | R$8,9 mil |
| Os dois full-time | R$11.271 | **20** | R$16,2 mil |
| Os dois + orçamento de marketing | R$13.271 | **23** | R$18,7 mil |
| Primeira contratação | R$21.271 | **36** | R$29,2 mil |

**Dois clientes pagam a empresa inteira hoje.** É o número que muda a
conversa quando alguém assume que abrir startup exige capital de aceleradora
— não exige R$240 mil, exige dois clientes.

No cenário base do modelo (100 clientes, ARPU R$812, MRR R$81.200), a
cascata até EBITDA fica assim:

| Linha | % | R$/mês |
| --- | --- | --- |
| Receita bruta (MRR) | 100% | 81.200 |
| (–) Taxa de gateway | 1,14% | (926) |
| (–) Impostos (Simples, Anexo III) | 12,34% | (10.020) |
| (–) COGS: infra + IA | ~20% | (16.240) |
| **= Lucro bruto** | **~66%** | **54.014** |
| (–) Pró-labore (2 sócios) | — | (10.000) |
| (–) Ferramentas | — | (1.271) |
| (–) Marketing/GTM | — | (2.000) |
| **= EBITDA** | **~50%** | **40.743** |

Esse cenário de 100 clientes é meta, não medição — assim como o SAM
projetado de ~R$153 milhões/ano pro mercado brasileiro de startups (17 mil
empresas × ticket médio anual) e o SOM de 50-150 clientes em 18 meses.
Churn (2%-6% ao mês) e CAC hoje são benchmark de mercado, não número
observado — transformar isso em medição real é trabalho dos próximos meses,
não algo que já aconteceu.

Como a Nexo documenta o processo em público, dá pra mostrar a projeção
inteira, não só o cenário base. O modelo roda três cenários — conservador,
base, otimista — variando clientes ao fim de 18 meses (SOM), CAC e churn:

| Métrica | Conservador | Base | Otimista |
| --- | --- | --- | --- |
| Clientes ao fim (SOM) | 50 | 100 | 150 |
| CAC | R$720 | R$360 | R$240 |
| Churn mensal | 6% | 4% | 2% |
| Vida média do cliente | 16,7 meses | 25 meses | 50 meses |
| LTV (ARPU × 80% × vida) | R$7.225 | R$16.240 | R$47.200 |
| LTV:CAC | ~10:1 | ~45:1 | ~197:1 |
| Payback do CAC | 1,7 meses | 0,55 meses | 0,25 meses |
| MRR | R$27.050 | R$81.200 | R$177.000 |
| ARR | R$324.600 | R$974.400 | R$2.124.000 |

Todo LTV:CAC dessa tabela está inflado porque assume CAC quase-zero —
aquisição founder-led/orgânica escalando até 150 clientes, o que não é
sustentável indefinidamente. Rodando o mesmo cenário base com um CAC de
aquisição paga tradicional (R$2.500), o quadro muda mas continua saudável:

| Métrica | Cenário base, CAC R$2.500 |
| --- | --- |
| LTV | R$16.240 |
| LTV:CAC | 6,5:1 |
| Payback | 3,9 meses |

6,5:1 ainda fica acima do benchmark de mercado de 3:1 — é o número a citar
se a pergunta for "e se o orgânico não escalar?".

## O que esse número prova, e o que não prova

Prova que existir juridicamente tem preço fixo e conhecido: ~R$8 mil pra
abrir, R$1.100-1.900/mês pra operar, e um punhado de siglas que valem mais
aprender antes de precisar delas sob pressão de prazo. Prova que o risco
financeiro real de começar uma startup de software com sócio é ordens de
grandeza menor do que R$240 mil de aporte — é o tamanho de dois clientes
pagando o suficiente pra cobrir a operação mínima.

Não prova que a Nexo vai encontrar product-market fit. Não prova que 60/40
foi o split certo, só que foi o que decidimos com o framework que tínhamos.
Não prova que os R$1,3 milhão de ARR do cenário otimista vão acontecer —
esse número é meta de planejamento, escrito antes do primeiro cliente, não
depois. O que abrir a empresa prova é mais estreito e mais chato do que
qualquer pitch: que dá pra existir juridicamente, com sócio, com contador,
com as siglas certas, gastando menos do que a maioria dos founders técnicos
imagina — e que nada disso substitui ter um cliente disposto a pagar.
