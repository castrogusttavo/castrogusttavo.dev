---
title: Como eu apliquei o PMBOK sozinho na Nexo
description: "Uma issue ficou 88 dias viva sem nunca ter tido estimativa ou prazo — não atrasada, invisível, porque não havia alvo pra errar. Apliquei PMBOK adaptado pra um time de uma pessoa na Nexo: WBS de 77 issues, PERT, risk register, processo de mudança de escopo — e cortei metade do framework porque ele resolve um problema que um time de uma pessoa não tem. Isto é o que sobrou, o que descartei, e por quê."
icon: idea
date: "2026-08-24"
---

`STR-80`, "Seu Trabalho — visão pessoal do usuário", foi criada em 29 de maio
de 2026 na Nexo. Só entrou em andamento 55 dias depois, em 23 de julho, e
segue `In Progress` até hoje, 24 de agosto — mais 32 dias. Oitenta e oito
dias de vida, e em nenhum momento desses oitenta e oito dias essa issue teve
uma estimativa ou uma data de entrega.

Isso não é "estimamos X, saiu em Y". É pior: nunca houve um X. Não dava pra
dizer que `STR-80` estava atrasada, porque atrasada em relação a quê. Ela
estava só lá, indefinidamente em andamento, e o único jeito de perceber que
alguma coisa estava errada era eu mesmo lembrar que a abri há quase três
meses.

Esse é o ponto de partida deste post: o que eu apliquei do PMBOK na Nexo
hoje, o `dia zero` do processo formal — o que ficou, o que cortei, e por que
cortei.

## O problema: 37 issues sem nenhum jeito de saber o que estava atrasado

Antes de hoje, o board da Nexo no Linear tinha 37 issues em backlog plano.
Nenhuma tinha milestone. Nenhuma tinha cycle (sprint). Nenhuma tinha
estimativa. Nenhuma tinha data de entrega. A única coisa parecida com
priorização era o campo `Priority` — `High`/`Medium`/`Low` — sem nenhuma
estrutura por trás decidindo o que essa prioridade significava em prazo.

![Estado do backlog da Nexo antes do processo: 37 issues, e zero em cada categoria que permitiria medir atraso — milestone, cycle, estimativa, prazo](/img/pmbok-team-of-one/pt/antes-sem-medida.png)

O caso de `STR-80` não é isolado. No mesmo dia em que ela foi criada, abri
duas issues de segurança urgentes — `STR-96` (upload sem autenticação) e
`STR-61` (bypass de consentimento) — ambas fechadas cerca de cinco dias
depois, disputando a mesma janela de atenção. É plausível que essas duas
tenham empurrado `STR-80` para o fundo da fila por 55 dias; não tenho como
provar essa causalidade só com os dados do Linear, é inferência, não fato
registrado. O que é fato é que nada no processo teria me avisado de qualquer
jeito — não existia processo pra avisar.

Também não dá pra montar um baseline honesto de "% de tarefas entregues no
prazo antes do processo", porque nunca existiu uma data de entrega registrada
em nenhuma issue histórica pra comparar contra. O próprio fato de esse número
não existir já é o argumento: o problema não era entregar fora do prazo, era
não ter como saber.

## A ideia: aplicar só a parte do PMBOK que resolve um problema que eu tenho

A tentação ao ler o PMBOK Guide (PMI) inteiro é implementar tudo — dez áreas
de conhecimento, cinco grupos de processo, dezenas de artefatos. Isso é
desenhado pra coordenar múltiplas pessoas e partes interessadas com
interesses divergentes: um patrocinador que quer o orçamento sob controle,
um cliente que quer escopo fixo, uma equipe que quer prazo realista, um PMO
que quer rastreabilidade.

A Nexo hoje é 1 pessoa — eu, founder engineer, que é também quem estima,
executa, revisa e decide prioridade. Grande parte do PMBOK resolve uma dor
que esse arranjo não tem: não existe patrocinador pra convencer, não existe
fornecedor pra negociar, não existe stakeholder além de mim mesmo lendo meu
próprio board. Apliquei só a fração que ataca o problema real — não saber
que algo como `STR-80` estava parado — e descartei o resto deliberadamente,
não por preguiça. A seção de limitações no fim deste post lista exatamente o
que cortei e por quê.

## WBS: da Nexo inteira até 77 issues-folha

O primeiro artefato que criei foi uma WBS (work breakdown structure) de três
níveis: Projeto → 5 Milestones (`M0`–`M4`) → 9 Epics → 77 issues-folha.
Documentei isso em [Nexo — WBS & PERT](https://linear.app/str4tus/document/nexo-wbs-and-pert-3cdaec1875ed),
além da própria hierarquia estar refletida na estrutura do Linear.

| Nível | Quantidade |
| --- | --- |
| Milestones | 5 (`M0`–`M4`) |
| Epics | 9 |
| Issues-folha | 77 |

Não criei um WBS Dictionary formal — a ficha detalhada por elemento (critério
de aceite, recursos, premissas, cada um em documento próprio) que o PMBOK
prescreve. O que existe é a descrição de cada issue, mais magra: um tooltip
com o essencial e os três números de estimativa (otimista/mais provável/
pessimista). Com 77 itens e 1 leitor — eu mesmo — o dicionário completo seria
documentação que ninguém ia consultar.

## PERT: de otimista/mais provável/pessimista para dev-dia

Cada uma das 77 issues-folha recebeu três estimativas — otimista (O), mais
provável (M), pessimista (P) — combinadas pela fórmula de PERT do PMBOK
Guide:

```
E = (O + 4M + P) / 6
```

Um "dev-dia" nessas contas equivale a 8h de foco em software: 4,5h de código
ativo e 4,5h de revisão de código e deploy. Isso é separado do tempo de foco
em produto — marketing, reuniões, redes sociais — que não entra nessa conta.
É a mesma distinção que fiz no post anterior sobre estimativa: a estimativa
cobre o trabalho de engenharia, não o dia inteiro do founder.

Somando as 77 issues-folha, a base é **297 dev-dias**. Com a contingência
aplicada por milestone — a mesma reserva de 20% do post anterior, calculada
sobre a variância de cada milestone, não um número fixo aplicado igualmente
a tudo — o total sobe para **356,4 dev-dias**, ou **2.851,2h**. Distribuído
em sprints de 15 dias, isso dá **44 sprints**.

## Risk register, charter e o fim do "decido na hora"

Além da WBS e do PERT, formalizei três coisas que antes eram só memória
minha:

- **Risk register** — [10 riscos catalogados](https://linear.app/str4tus/document/nexo-risk-register-14ce7f312363)
  hoje, pontuados por probabilidade × impacto (escala 1–9). Nenhum "virou
  fato" ainda, porque o registro foi criado hoje — é preditivo, não um
  retrofit em cima de incidentes que já aconteceram. Fiz só a análise
  qualitativa; a quantitativa (Monte Carlo, EMV) exige histórico de
  velocity que ainda não existe, ou ferramental desproporcional pra 10
  riscos.
- **Project charter** — [um único termo de abertura](https://linear.app/str4tus/document/nexo-project-charter-9c6a5e9667b5)
  pra Nexo como produto inteiro, não um por epic. Um por epic seria
  overkill pra essa escala; antes disso, o "charter" era 100% implícito —
  o que estava na minha cabeça.
- **Processo de mudança de escopo** — [formalizado hoje](https://linear.app/str4tus/document/nexo-processo-de-mudanca-de-escopo-b71a457d2d65).
  Antes, mudança de escopo era "decido na hora". A regra nova: qualquer
  mudança que estoure 10% do buffer de uma milestone obriga recalcular a
  data de todas as milestones seguintes.

Não existe Change Control Board — o comitê que o PMBOK prescreve pra
aprovar mudanças. Simplifiquei pra "1 pessoa decide", porque não existe
segunda pessoa pra compor um comitê.

## Por que só SV/SPI, e não CPI/CV

Do conjunto de métricas de Earned Value Management, rastreio só `SV`
(Schedule Variance) e `SPI` (Schedule Performance Index). Deliberadamente
não rastreio `CPI` (Cost Performance Index) nem `CV` (Cost Variance).

Custo faz sentido rastrear quando alguém — financeiro, cliente, patrocinador
— precisa saber se o dinheiro dele está sendo bem gasto. Na Nexo, quem seria
esse "financeiro" e quem executa o trabalho é a mesma pessoa. `CPI` seria
medir a mim mesmo contra mim mesmo, sem nenhuma decisão nova que esse número
desbloquearia. Cronograma é diferente: saber que uma entrega está 25% atrasada
muda o que eu faço amanhã. Saber que "gastei X de mim mesmo" não muda nada.

## O que os números ainda podem provar, e o que não podem — ainda

Isso é importante deixar claro: o processo começou a valer hoje. O `Cycle 1`
começa hoje, 24 de agosto. Zero sprints fecharam até este momento — então
não existe "antes vs. depois" medido de verdade pra mostrar. Qualquer post
que afirmasse "isso reduziu o atraso pra X%" estaria inventando um resultado
que ainda não aconteceu.

O que eu tenho é uma simulação: rodei os 44 sprints planejados com uma
variação de execução simulada em cima de cada estimativa PERT, pra ver que
formato o painel de `SV`/`SPI` vai ter quando os dados começarem a chegar de
verdade. Isso não é previsão de que o processo vai funcionar — é o
equivalente a ligar o painel antes de ter dado real, pra garantir que ele
mostra o que eu preciso ver.

| Cycle | Datas | Entrega | Planejado | Simulado | Desvio | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 24/08–07/09 | Ciclos | 25,5h | 24h | −5,9% | no prazo |
| 1 | 24/08–07/09 | Módulos | 25,5h | 27h | +5,9% | no prazo |
| 2 | 07/09–21/09 | Páginas de projeto | 41,5h | 45h | +8,4% | no prazo |
| 2 | 07/09–21/09 | Canais de suporte | 8,5h | 9h | +5,9% | no prazo |
| 3 | 21/09–05/10 | Layouts | 16h | 15h | −6,3% | no prazo |
| 3 | 21/09–05/10 | Visão geral de progresso | 25,5h | 30h | +17,6% | atrasado |
| 3 | 21/09–05/10 | Power-K | 16h | 14h | −12,5% | no prazo |
| 4 | 05/10–19/10 | Visualizações | 25,5h | 28h | +9,8% | no prazo |
| 4 | 05/10–19/10 | Painel de uso | 25,5h | 33h | +29,4% | atrasado |
| 5 | 19/10–02/11 | RBAC | 25,5h | 26h | +2,0% | no prazo |
| 5 | 19/10–02/11 | Convidados | 41,5h | 52h | +25,3% | atrasado |
| 6 | 02/11–16/11 | Importar Jira | 41,5h | 58h | +39,8% | atrasado |
| 6 | 02/11–16/11 | Importar CSV | 25,5h | 24h | −5,9% | no prazo |
| 7 | 16/11–30/11 | Importar Linear | 41,5h | 44h | +6,0% | no prazo |
| 8 | 30/11–14/12 | Importar Asana | 41,5h | 60h | +44,6% | atrasado |
| 9 | 14/12–28/12 | Importar ClickUp | 41,5h | 43h | +3,6% | no prazo |

![Simulação de horas planejadas contra simuladas por entrega, Cycles 1 a 9 — não é dado real, é um dry-run do mecanismo de rastreio antes de haver ciclos fechados](/img/pmbok-team-of-one/pt/simulacao-planejado-vs-real.png)

![Desvio percentual por entrega na simulação, ordenado, com a linha de 15% marcando o limiar entre no prazo e atrasado](/img/pmbok-team-of-one/pt/simulacao-desvio.png)

Nessa simulação, 11 das 16 entregas — **~69%** — ficam dentro do prazo, com
desvio médio absoluto de **14,3 pontos percentuais**. Isso não prova nada
sobre a Nexo. Prova que a fórmula de PERT com contingência por milestone,
quando confrontada com uma variação de execução plausível, produz um painel
legível — sei antes de qualquer sprint real fechar o que "atrasado" vai
significar e como vou enxergar. É bem menos do que "o processo funciona". É
o mínimo necessário pra saber se estou medindo a coisa certa.

O resultado real e verificável que tenho hoje é outro, e está na próxima
seção.

## Onde esse framework quebra pra um time de uma pessoa

A causa raiz de quase tudo que cortei do PMBOK é a mesma: a maior parte do
framework existe pra coordenar múltiplas pessoas com interesses divergentes.
Com 1 dev que também é o product owner, esse problema não existe — não é
que a prática seja trabalhosa demais, é que ela resolve uma dor que a Nexo
não tem hoje.

- **`CPI`/`CV` abandonados, não simplificados.** Já explicado acima: rastrear
  custo faz sentido quando alguém mais precisa saber se o dinheiro dele
  está bem gasto. Aqui não tem esse alguém.
- **Procurement Management inaplicável, não simplificado pra menos.** Não
  existe fornecedor ou contrato sendo negociado — a infra (Postgres, Redis,
  BullMQ) já está provisionada. Não tem "comprar" pra gerenciar.
- **Stakeholder Register e Communications Management Plan abandonados.**
  Essas práticas mapeiam quem precisa saber o quê e quando. Com 1
  stakeholder, o "plano de comunicação" sou eu lendo meu próprio Linear.
- **Quality Management Plan formal simplificado.** Reaproveitei o gate que
  já existia — `pnpm test:all` e `check:ci` no pre-commit — em vez de criar
  uma camada PMBOK de qualidade em cima de um controle que já funciona.
- **Change Control Board simplificado pra "1 pessoa decide".** Documentado
  no processo de mudança de escopo. Não existe board porque não existe
  segunda pessoa pra compor board.
- **Análise quantitativa de risco não feita.** Só a qualitativa
  (probabilidade × impacto). A quantitativa exige histórico de velocity
  que ainda não existe, ou ferramental desproporcional pra 10 riscos.

E o custo real, medido, de montar tudo isso: a sessão inteira de hoje —
desenho da WBS, PERT das 77 issues, auditoria de código contra o catálogo
de pricing, e 127 chamadas de escrita só na execução no Linear (5
milestones, 9 epics, 77 issues, 4 documentos) — não produziu uma linha de
código de produto. Pra um time de uma pessoa, isso é um dia inteiro de
capacidade gasto em processo, não no backlog que o processo existe pra
organizar. Não sei ainda se isso foi investimento ou desperdício; só vou
saber depois que os primeiros sprints fecharem.

Tem também um risco que registrei mas ainda não aconteceu: a regra de
recalcular todas as milestones seguintes quando uma mudança estoura 10% do
buffer. Numa equipe grande, isso é saudável — todo mundo depende de datas
atualizadas. Com 1 dev, pode virar ritual caro pra mudanças pequenas — o
tipo de regra que parece disciplina no papel e vira fricção na prática.
Vou testar nos primeiros sprints e cortar se se confirmar.

As duas issues de "antes" — `STR-80` e as bugs de segurança — não servem de
exemplo de "processo atrapalhando", porque aconteceram antes de o processo
existir. Não foi o processo que atrasou aquilo, foi a ausência dele.
Misturar os dois enfraqueceria o argumento.

## O que isso prova, e o que ainda não prova

Prova que o problema central do PMBOK — coordenar interesses divergentes —
não desaparece quando o time é uma pessoa só, muda de forma. O alvo real
aqui não era "deixar a entrega mais previsível pra um chefe". Era tornar
visível pra mim mesmo o que já estava invisível: `STR-80` não estava
atrasada porque ninguém media, estava atrasada e ninguém, nem eu, conseguia
ver.

Não prova que a variância vai melhorar, que as estimativas vão ficar mais
precisas, ou que o custo de manter esse processo vale a pena a longo prazo
pra um time desse tamanho. Esse dado não existe ainda — `Cycle 1` começa
hoje. Isso vira o próximo post, quando os primeiros ciclos reais fecharem e
eu tiver `SV`/`SPI` de verdade pra comparar contra essa simulação.
