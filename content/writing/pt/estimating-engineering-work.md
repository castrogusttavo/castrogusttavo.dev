---
title: Como eu estimo o trabalho de um engenheiro de software (até o meu)
description: "Sean Goedecke chama estimar software de 'ficção educada' — e está certo pra boa parte do trabalho. Este post traça a fronteira exata onde ele erra: quebra de tarefa, Cone de Incerteza, throughput simulado por Monte Carlo, e o que PMBOK, Kanban, Scrum, SAFe, CMMI, XP e DSDM prescrevem sobre estimativa — o mesmo processo que uso pro time e pro meu próprio trabalho."
icon: idea
date: "2026-08-23"
---

Toda vez que alguém pergunta "quanto tempo leva pra fazer isso", a resposta
errada mais comum é uma conta de multiplicação: 3 engenheiros, 40 horas cada,
120 horas, entrega em tantos dias. A conta parece sólida — tem gente, tem
hora, tem prazo — mas já começa errada na premissa: 40 horas de um
engenheiro não são 40 horas de código.

O dado mais direto sobre isso vem do Code Time Report da Software.com
(hoje Antenna), agregando mais de 250 mil desenvolvedores em 201 países
entre julho e outubro de 2021: a mediana de tempo ativo de codificação é
**52 minutos por dia**. Somando outras atividades dentro do próprio editor
(review, leitura de documentação), o total sobe pra 93 minutos — ainda
assim, **19% de um dia de 8 horas**. O resto — 387 minutos, 81% do dia —
é reunião, mensagem, contexto administrativo e o custo de trocar de
tarefa.

![De uma jornada de 8h, quanto vira código de fato: 52 min (11%) de codificação ativa, 41 min (9%) de outro trabalho no editor, 387 min (81%) fora do editor — mediana de 250 mil+ devs, Software.com/Antenna, jul-out 2021](/img/estimating-engineering-work/pt/onde-vai-a-hora-do-engenheiro.png)

Esse número varia entre estudos — uma revisão de literatura publicada pela
Microsoft Research em 2019 ("Today Was a Good Day: The Daily Life of
Software Developers", Meyer, Barr, Bird e Zimmermann, IEEE Transactions
on Software Engineering, com 5.971 respostas de desenvolvedores
profissionais da própria Microsoft) cita achados de outros trabalhos indo
de 9% a 61% de tempo em código, dependendo de como cada estudo definiu
"codificar" e de como coletou o dado. Nenhum desses números chega perto de
100%. Multiplicar "40 horas" por "número de engenheiros" trata a semana de
trabalho como se ela fosse só a fração pequena — código — quando reunião,
suporte, revisão, incidente e férias também consomem a mesma agenda.

Depois de estimar errado desse jeito tempo suficiente, cheguei num processo
que uso pra qualquer tarefa — de um bug pequeno até o meu próprio trabalho
numa sprint. Ele não remove a incerteza. Troca achismo por medição em cada
etapa: quebra, pontuação, histórico, e uma validação formal antes de eu
prometer uma data pra alguém.

## A objeção que eu não posso ignorar

Existe um argumento sério — não uma reclamação de quem não gosta de prazo —
contra o processo inteiro que estou prestes a descrever. Sean Goedecke
resume assim, num post que ele chama de sobre a "ficção educada" no centro
da indústria de software
([seangoedecke.com/how-i-estimate-work](https://www.seangoedecke.com/how-i-estimate-work/)):

> Estimar quanto tempo os projetos de software levarão é muito difícil, mas
> não impossível. Uma equipe de engenharia qualificada pode, com tempo e
> esforço, aprender quanto tempo levará para eles entregarem trabalho, o
> que, por sua vez, permitirá que sua organização faça bons planos de
> negócios.

Goedecke não defende essa frase — ele a chama de "ficção educada" e diz,
na sequência, que ela é falsa. O argumento dele: em sistemas grandes, a
maior parte do trabalho de verdade é pesquisa e descoberta, não execução de
tarefas predefinidas — e só o trabalho conhecido pode ser estimado. Nas
palavras dele, o trabalho desconhecido "sempre consome 90% do tempo", e
nenhum planejamento antecipado resolve isso, porque decisão de arquitetura
real exige interagir com o código de verdade, não com um plano sobre ele.
A conclusão dele é que estimativa serve, na prática, como ferramenta
política — para alocar recursos e priorizar projetos —, não como mecanismo
técnico de previsão.

Ele está certo sobre uma fração real do trabalho de engenharia. Não está
certo sobre toda ela. Todo o processo que descrevo a seguir só faz sentido
dentro de uma fronteira específica — trabalho decomponível, com um padrão
de entrega repetido o bastante pra gerar histórico — e essa fronteira é
exatamente onde a objeção de Goedecke deixa de se aplicar. "Criar sistema
de autenticação" é trabalho conhecido: alguém já fez login e cadastro
centenas de vezes antes. Pesquisa genuína — "não sei se essa abordagem
funciona", não "quanto tempo leva pra fazer o que eu sei que funciona" — é
o território dele, não o meu, e eu volto a isso, sem rodeio, na seção de
limitações deste post.

## O problema: tarefa grande não é estimável, é uma aposta

"Criar sistema de autenticação" não é uma tarefa — é um rótulo pra várias
tarefas diferentes, com riscos e tamanhos completamente diferentes,
disfarçadas de uma linha só de backlog. Ninguém estima isso direito, porque
não tem o que estimar: é grande demais pra ter um tamanho.

Isso não é só intuição. É o que Steve McConnell documentou como o **Cone de
Incerteza**: o erro possível de uma estimativa cai conforme o projeto
avança e decisões concretas eliminam variabilidade — não porque alguém
"refina" a mesma estimativa, mas porque o próprio projeto fica menos
variável. No "Conceito Inicial" — o estágio em que "Criar sistema de
autenticação" normalmente é jogado num backlog —, uma estimativa feita por
um time competente ainda pode errar por um fator de **4x pra mais ou 4x
pra menos**, uma faixa total de 16x entre o pior e o melhor caso.

![O Cone de Incerteza: erro possível de uma estimativa por fase do projeto, de 4x/0,25x no conceito inicial até 1x no software completo (McConnell/Construx)](/img/estimating-engineering-work/pt/cone-da-incerteza.png)

O cone só estreita quando decisões reais eliminam variabilidade — definir o
que o produto não vai fazer, fechar requisito, desenhar a interface. Quebrar
"Criar sistema de autenticação" em partes menores é, na prática, forçar
essas decisões a acontecer mais cedo, uma de cada vez, em vez de deixar
toda a incerteza empilhada atrás de um único número:

```
Autenticação
├── Modelagem do usuário
├── Cadastro
├── Login
├── JWT / sessão
├── Recuperação de senha
├── Integração com frontend
├── Testes
├── Logs e monitoramento
└── Deploy
```

Só depois de quebrado é que cada item vira um número — aqui, oito das nove
partes recebem estimativa própria; logs e monitoramento entra dentro do
esforço de deploy, não como linha separada:

| Item | Estimativa |
|---|---|
| Modelagem | 4h |
| Cadastro | 6h |
| Login | 6h |
| JWT | 4h |
| Recuperação de senha | 8h |
| Frontend | 8h |
| Testes | 6h |
| Deploy | 4h |

Total: **46h**. Em cima disso entra uma margem de incerteza — não porque eu
não confio na soma, mas porque toda tarefa carrega um risco que só aparece na
execução (uma lib que não se comporta como a documentação promete, um
requisito que muda no meio do caminho). Uso **20%** como contingência padrão:
46h + 20% = **55h**. Esse número, não o 46h bruto, é o que vira compromisso.

## Pontuar em Fibonacci, e quebrar de novo se passar de 13

Hora é uma unidade ruim pra comunicar incerteza — "6 horas" soa preciso
mesmo quando não é. Por isso, pro nível de time (não só o meu breakdown
individual), eu pontuo cada tarefa na escala de Kanban: `1, 2, 3, 5, 8, 13,
21`.

O espaçamento crescente é a parte que importa: a diferença entre `1` e `2` é
pequena porque a incerteza nesse tamanho é pequena, mas a diferença entre
`13` e `21` é grande porque, nesse tamanho, a incerteza já deixou de ser
linear. Isso é uma regra, não uma preferência: **qualquer tarefa que receba
13 ou 21 pontos precisa ser quebrada antes de entrar em sprint**. Se não dá
pra quebrar em pedaços menores, é sinal de que ninguém entendeu o suficiente
da tarefa pra estimar — e isso é informação, não só burocracia de refinamento.

## Deixar o histórico prever o prazo, não a intuição

Pontuar a tarefa resolve tamanho relativo. Não resolve "quando entrega" — pra
isso, uso dado histórico do próprio time, não uma opinião sobre quão rápido
achamos que vamos trabalhar dessa vez.

Duas métricas fazem esse trabalho: **velocidade média por sprint** (quantos
pontos o time historicamente fecha por ciclo — com 23 pontos de média, uma
feature de 46 pontos não é "duas semanas otimistas", é duas sprints, ponto)
e **throughput** (quantas tarefas saem por unidade de tempo, independente do
tamanho de cada uma). É o throughput que dá o dado bruto pra uma técnica
melhor do que projetar a média na régua: simulação de Monte Carlo sobre o
histórico real, popularizada no contexto de Kanban por Troy Magennis
(*Forecasting and Simulating Software Development Projects*) e por Daniel
Vacanti (*Actionable Agile Metrics for Predictability*).

O método, na prática: em vez de assumir "throughput = 13 tarefas/semana,
logo backlog/13 = prazo", eu sorteio repetidamente, **com reposição**, das
semanas de throughput realmente observadas, e somo até o backlog fechar.
Repito isso milhares de vezes e leio a distribuição de resultados, em vez de
um único número. Para um time com este histórico de 12 semanas — `9, 14,
11, 16, 10, 13, 15, 8, 17, 12, 14, 17` tarefas (média de exatamente 13) — e
um backlog de 60 itens, rodei 20 mil simulações:

| Prazo | Chance de concluir até lá |
|---|---|
| 4 semanas | 10,1% |
| 5 semanas | 79,6% |
| 6 semanas | 99,5% |
| 7 semanas | 100% |

![Simulação de Monte Carlo sobre throughput histórico, 20 mil simulações: 10,1% concluem em 4 semanas, 79,6% em 5, 99,5% em 6 — a linha de 85% de confiança cai em 6 semanas](/img/estimating-engineering-work/pt/simulacao-monte-carlo-throughput.png)

Com esse histórico específico, a faixa de **85% de confiança fecha em 6
semanas** — não porque eu escolhi 85% pra caber num número bonito, é o
percentil que a simulação devolveu. A informação que isso carrega e uma
média simples (60/13 ≈ 4,6 semanas) não carrega: existe uma cauda real, por
menor que seja (0,5% dos casos passam de 6 semanas), onde a variação normal
do próprio time — uma semana ruim, uma sprint com mais gente de férias —
estica o prazo. Prometer "4,6 semanas" esconde essa cauda. Prometer "até 6
semanas, com 85% de confiança" não.

## Validar contra PMBOK antes de assinar embaixo

Kanban resolve o dia a dia do time. Mas throughput e lead time são métricas
locais — só significam alguma coisa pra quem já conhece o histórico daquele
time específico. No momento em que a estimativa sai da equipe e vira um
número que um PMO, um cliente ou a diretoria vai cobrar depois, eu traduzo
pro vocabulário que médias e grandes empresas efetivamente usam pra isso: o
PMBOK, do Project Management Institute (pmi.org). Não porque é superior ao
Kanban — é porque é o padrão que sobrevive à troca de contexto, quando quem
lê a estimativa não estava na refinement.

Boa parte do que já descrevi acima já é PMBOK, só sem o nome formal:

- A quebra da autenticação em subtarefas somadas é **estimativa bottom-up**
  — construir o total a partir das partes, não estimar o todo de uma vez.
- Os 20% de contingência em cima do 46h são **análise de reservas**
  (*reserve analysis*) — reserva de contingência pro risco conhecido, distinta
  de uma reserva de gerenciamento pra risco desconhecido.
- Aplicar throughput histórico sobre o escopo restante pra projetar prazo é
  **estimativa paramétrica** — uma taxa histórica multiplicada pela
  quantidade de trabalho que falta.

O que eu adiciono como checkpoint formal é a **estimativa de três pontos**
(PERT): otimista (O), mais provável (M), pessimista (P), combinados em

```
E = (O + 4M + P) / 6
```

Pra autenticação, com O = 38h, M = 46h (o mesmo total do breakdown) e P =
70h, isso dá E ≈ **48,7h**, com desvio padrão σ = (P − O) / 6 ≈ **5,3h** — ou
seja, uma faixa de ~43h a ~54h com confiança de ~68%. As 55h que saíram da
contingência de 20% caem dentro dessa faixa, perto do teto.

![Distribuição PERT (beta) da estimativa de autenticação: otimista 38h, mais provável 46h, pessimista 70h, E=48,7h — a estimativa bottom-up com contingência de 55h cai dentro da cauda direita da distribuição](/img/estimating-engineering-work/pt/distribuicao-pert-autenticacao.png)

Se a estimativa bottom-up com contingência tivesse caído fora do intervalo
do PERT, isso seria sinal de que ou o breakdown esqueceu risco, ou o
cenário pessimista está mal calibrado — não de escolher qualquer um dos
dois números e seguir em frente. Uso o mesmo cruzamento na faixa
probabilística do throughput: quando a estimativa paramétrica (a simulação
de Monte Carlo) e a estimativa de três pontos não se sobrepõem, é sinal de
investigar antes de prometer — normalmente porque o histórico está
carregando uma sprint atípica (um mês sem nenhum incidente, por exemplo)
que não deveria se repetir, ou porque o pessimista de cabeça não está
levando a sério uma variação que os dados já mostraram acontecer antes.

## Sete frameworks, o mesmo núcleo embutido

PMBOK não é uma escolha excêntrica isolada. Fui direto nos materiais
oficiais dos frameworks de entrega mais usados — e nenhum deles trata
"estimar" como adivinhar um número; todos, com vocabulários diferentes,
convergem pra alguma versão de quebra + histórico + margem:

| Framework | Como estima oficialmente | Papel do histórico |
|---|---|---|
| **PMBOK** (PMI) | Bottom-up, paramétrica, três pontos (PERT), reserva de contingência | Alimenta a estimativa paramétrica e a análise de reservas |
| **Kanban** (Kanban University) | Não estima esforço — mede lead time, cycle time e throughput do fluxo real | O histórico de fluxo *é* a previsão, não um insumo pra ela |
| **Scrum** (Scrum Guide 2020) | "Sizing" do item de backlog — o guia não prescreve unidade nem técnica | Deixado em aberto; a comunidade usa velocity histórica por convenção, não por regra do guia |
| **SAFe** (Scaled Agile Framework) | Story points por user story, agregados em capacity por Program Increment | Velocity histórica de PIs anteriores vira a capacity confiável do próximo |
| **CMMI** (CMMI Institute/ISACA) | Baseline estatística de desempenho de processo, exigida a partir do nível de maturidade 4 | Histórico formal e estatístico é pré-requisito, não acessório |
| **XP** (Kent Beck) | "Ideal engineering days" por story, ajustado por um load factor de calendário | O load factor é calibrado observando quanto o time realmente entregou nas últimas iterações |
| **DSDM** (Agile Business Consortium) | Não estima duração do escopo — fixa tempo/custo/qualidade e prioriza por MoSCoW (60/20/20) | Inverte a lógica: em vez de estimar quanto tempo o escopo leva, decide quanto escopo cabe no tempo já fixado |

O detalhe mais revelador é o da Scrum Guide: a versão de 2020 removeu a
palavra "estimate" do texto oficial e passou a falar só em "sizing" — não
porque estimar parou de importar, mas porque a própria organização por trás
do framework reconheceu que amarrar uma técnica específica (story points,
planning poker) ao guia criava a ilusão de que aquela técnica era
obrigatória, quando o que realmente importa é o time ter *algum* jeito
consistente de dimensionar trabalho. DSDM vai na direção oposta e mais
radical: em vez de perguntar "quanto tempo isso leva", fixa o tempo e faz a
pergunta virar "quanto desse escopo cabe no tempo que já temos" — o
Cone de Incerteza aplicado ao contrário, negociando escopo em vez de prazo.

## Do backlog ao align-call: epic, feature, user story, task

O resultado disso tudo é organizado num formato fixo pra alinhamento com o
time e com quem depende da entrega: `epic → feature → user story → task`.
Cada nível herda a estimativa agregada dos níveis abaixo, nunca o contrário —
uma epic não recebe um número "de cabeça", ela é a soma do que já foi
quebrado e pontuado.

Em toda estimativa de tarefa, sempre entram as mesmas sete categorias de
esforço, mesmo quando alguma delas é pequena:

- código
- testes
- review
- refatoração
- integração
- deploy
- documentação

Esquecer uma dessas categorias é a forma mais comum de uma estimativa "bater"
no papel e furar na prática — normalmente review e documentação são as duas
que mais ficam de fora, e as duas que mais geram atraso silencioso depois.

## Exemplo prático: gateway de pagamento com três engenheiros

Feature: criar integração com um novo gateway de pagamento. Depois de
refinamento, quebrada em user stories:

| Story | Pontos |
|---|---|
| Configurar credenciais | 2 |
| Criar integração | 5 |
| Criar webhook | 5 |
| Criar fluxo de erro | 3 |
| Criar testes | 3 |
| Atualizar frontend | 5 |

Total: **23 pontos**. Esse time historicamente entrega entre **20 e 25
pontos por sprint**. Conclusão: a feature cabe numa sprint de duas semanas —
não porque tem três engenheiros e "40 horas × 3 = 120 horas" dá um número
bonito no papel, mas porque 23 pontos está dentro da faixa que esse time
específico, com essa composição específica, historicamente consegue fechar.

## Onde esse método quebra

Ele depende de histórico — throughput, velocidade, lead time. Um time novo,
recém-formado, ou entrando num domínio genuinamente novo pra ele não tem essa
distribuição pra consultar, e aplicar uma média de "outro time parecido" é
reintroduzir a mesma opinião disfarçada de dado que o método inteiro existe
pra evitar. Nesses casos, as primeiras sprints servem só pra construir o
histórico — a estimativa real começa a ficar confiável só depois disso.

É exatamente aqui que a objeção de Goedecke volta com força total. Trabalho
de pesquisa genuína — o tipo de tarefa onde a resposta é "não sei se isso
funciona", não "quanto tempo leva pra fazer o que eu sei que funciona" —
escapa do modelo por completo. Throughput mede repetição de trabalho
conhecido; não mede incerteza de resultado. Nenhuma quantidade de
refinamento, quebra ou simulação de Monte Carlo transforma "vamos ver se
essa abordagem funciona" em uma tarefa de tamanho estimável — e insistir em
pôr um número ali é exatamente a ficção educada que ele descreve.

Estimar o próprio trabalho, especificamente, carrega um viés que o método
não corrige sozinho: quem quebra a tarefa e quem executa a tarefa é a mesma
pessoa, então o incentivo de parecer rápido existe mesmo sem intenção — a
defesa que uso é quebrar meu próprio trabalho com o mesmo checklist de sete
categorias (código, testes, review, refatoração, integração, deploy,
documentação) que aplico ao time, em vez de me dar um desconto que eu nunca
daria pra ninguém.

## O que esse processo resolve, e o que continua sendo julgamento

Ele resolve o erro sistemático da conta de multiplicação: tarefas grandes
viram pequenas, pequenas viram números com contingência embutida, e o prazo
final vem de uma distribuição real de entregas passadas, não de otimismo. É
por isso que uma faixa como "85% de confiança em até 6 semanas" é mais
honesta do que uma data única — ela admite de saída que existe uma cauda de
casos em que não bate, em vez de esconder essa cauda atrás de um número
redondo.

Não resolve a decisão de quanto risco é aceitável pra um prazo específico —
isso continua sendo julgamento de quem decide (eu, o time, quem pede a
entrega), não saída de fórmula. E não resolve o ponto central de Goedecke:
pra trabalho genuinamente desconhecido, nenhuma técnica deste post — nem
PMBOK, nem Monte Carlo, nem os sete frameworks da tabela acima — substitui
admitir que ninguém sabe ainda. O valor inteiro do processo está em separar
essas duas categorias de trabalho antes de estimar, não em fingir que uma
fórmula boa o suficiente apaga a diferença entre elas.
