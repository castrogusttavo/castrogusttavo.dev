---
title: 98% de cobertura e um kanban que não arrastava — o problema dos testes cúmplices
description: "Em 20 de setembro o frontend da Nexo tinha 98,03% de linhas cobertas e um kanban em que nenhum card saía do lugar. A primeira execução da suíte de navegador achou quatro bugs que tinham atravessado mais de 3.600 testes, e dois deles estavam em arquivos cobertos por testes que afirmavam o defeito. Este post é sobre esses testes cúmplices: como eles nascem, os 23 bugs da suíte de componente agrupados pela causa, e o que mudou na forma de escrever teste depois disso."
icon: bug
date: "2026-11-05"
---

O teste de componente do kanban da Nexo começa com este comentário:

```tsx
// Drag-and-drop can't be simulated in jsdom, so the real <Kanban> is kept
// for rendering but its `onValueCommit` prop is captured. Tests call it
// directly with the meta dnd-kit would produce on drop, which exercises
// the view's own move handler without any pointer events.
```

O comentário é honesto e a decisão parece razoável: o jsdom não tem layout,
então não dá pra arrastar nada nele, e o teste pula direto pro que acontece
depois do drop. O problema é que nenhum usuário conseguia *começar* o
arrasto. O `KanbanItem` guarda os listeners do dnd-kit num contexto, pra um
`<KanbanItemHandle>` pegar, e nenhuma tela renderizava um handle. Todo card
do quadro era inerte. Os testes do que acontece depois do drop passavam,
verdes, sobre um drop que não podia acontecer.

Nesse dia o frontend tinha **98,03% de linhas cobertas** (branches em
93,1%, relatório do v8 no escopo de frontend, CI de 20 de setembro, medido
antes da correção do kanban). (O Codecov mostrava 94,97% para o mesmo
código naquele dia: ele conta como parcial uma linha com um branch não
percorrido. O número do v8 é de linhas executadas, só nos arquivos de
cliente.) Por baixo
dele havia 1.420 testes unitários, 549 de integração, 1.662 de componente e
18 de contrato. A primeira execução da suíte de navegador, que roda o
artefato de produção num Chromium de verdade, achou quatro bugs que
nenhum desses testes tinha visto. Dois estavam em arquivos "cobertos".

O [post de arquitetura](/pt/writing/nexo-architecture) já descreve as
camadas de teste que entraram em setembro. Este é sobre o que elas acharam,
e principalmente sobre por que as camadas de baixo não tinham achado antes.

## Cobertura mede execução, e o teste escolhe o que executar

Cobertura responde uma pergunta só: essa linha rodou durante algum teste?
Ela não sabe se o teste chegou nela pelo caminho que um usuário faz, nem se
a asserção depois dela confere a coisa certa. Um teste que monta o
componente e chama o callback interno executa as mesmas linhas que um
usuário arrastando um card executaria, se o usuário conseguisse arrastar.

O mecanismo que derruba a métrica é simples. Quem escreve o teste olhando o
código, e não o contrato, reproduz no teste as mesmas premissas do código.
Se o código tem um typo, o teste copia o typo. Se o código assume que a
biblioteca devolve mensagens em português, o mock devolve mensagens em
português. O teste não está errado no sentido de ser frouxo. Ele é preciso,
só que precisamente sobre a coisa errada.

## Teste cúmplice

O nome que eu passei a usar pra isso é **teste cúmplice**: um teste escrito
a partir do código que fotografa o defeito em vez de pegá-lo. Ele é pior
que teste nenhum por um motivo concreto: um arquivo sem teste aparece como
lacuna no relatório de cobertura, e um arquivo com teste cúmplice aparece
como resolvido. A ausência é visível. A cumplicidade, não.

O exemplo mais limpo é o do onboarding. No passo de cargo, a opção
"Fundador / Executivo" enviava este valor:

```tsx
{
  value: 'FOUNDER_EXECUTIBE',
  label: 'Fundador / Executivo',
  icon: Rocket01Icon,
},
```

O schema e o enum do Prisma esperam `FOUNDER_EXECUTIVE`. Quem escolhia
esse cargo não conseguia avançar o passo, e a tela mostrava a mensagem crua
do Zod, em inglês, no meio de um fluxo em português. E o teste de
componente do formulário dizia isto:

```tsx
expect(data.get('role')).toBe('FOUNDER_EXECUTIBE')
```

O typo entrou em 22 de junho, junto com o onboarding. O teste que o
afirmava foi escrito em 19 de setembro, quase três meses depois, e foi o
navegador que pegou os dois no dia seguinte. A correção foi uma letra no
componente e uma letra no teste.

## Os quatro bugs que só o navegador viu

Cada um dos quatro é invisível para uma camada por um motivo diferente, e
nenhum deles é falta de esforço de quem escreveu os testes:

| Bug | Invisível para | Porque |
| --- | --- | --- |
| Kanban sem drag-and-drop | componente | jsdom não tem layout; o teste chamava `onValueCommit` direto |
| `FOUNDER_EXECUTIBE` | componente | o teste afirmava o typo |
| Saudação com o nome do autor | todas as camadas | Server Component não roda em jsdom e está fora do escopo de cobertura |
| Erro do better-auth em inglês | componente | o mock respondia com uma mensagem em português inventada |

**A saudação.** A home do workspace cumprimentava qualquer conta, em
qualquer workspace, como "Gusttavo Castro". Estava escrito no JSX desde 14
de maio:

```tsx
<H4>{getGreeting()}, Gusttavo Castro</H4>
```

A página é um Server Component. O Testing Library não renderiza Server
Component, então nenhum teste de componente executou esse arquivo, e ele
não aparecia nem como lacuna, porque o escopo de cobertura do frontend
exclui esse tipo de arquivo de propósito. O comentário no `vite.config.ts`
diz por quê:

```ts
// Server Components are left out on purpose — Testing Library cannot
// render them, so counting them would peg the metric below 100 no matter
// how many tests exist
```

A decisão é correta: um número que nunca pode chegar a 100 não serve pra
nada. Mas ela tem uma consequência que o número não mostra: a métrica é
cega pra uma categoria inteira de arquivo, e o bug morou exatamente nela
por quatro meses. Essa mudança de escopo, aliás, entrou na manhã do mesmo
dia 20. Antes dela o arquivo aparecia no relatório, mas como uma lacuna
entre dezenas de Server Components que ninguém conseguia testar, o que na
prática dá no mesmo.

**A mensagem em inglês.** Senha errada no login mostrava
`Invalid email or password`, vindo do better-auth, numa página toda em
português. O teste do formulário existia e passava, porque alimentava o
componente com isto:

```tsx
error: { status: 401, message: 'Credenciais incorretas' },
```

Uma mensagem em português que a biblioteca nunca manda. A correção mapeou
os códigos de erro do better-auth pra textos em pt-BR, e o teste passou a
mandar o formato exato que a biblioteca devolve, `code:
'INVALID_EMAIL_OR_PASSWORD'` e `message: 'Invalid email or password'`, e
a conferir que o texto em português aparece **e** que o inglês não aparece.
A segunda asserção é a que importa: sem ela, um teste que encontra o texto
certo continua passando se o errado aparecer do lado.

**O kanban** foi corrigido fazendo o card inteiro virar o handle; a
distância de ativação do dnd-kit continua deixando um clique simples abrir
a issue. O teste novo arrasta com o mouse, em passos, espera o PATCH e
**recarrega a página** antes de conferir a coluna. O reload é a parte que
separa "o estado local mudou" de "o servidor recebeu a mudança".

A mesma suíte achou um quinto problema, bem maior: a imagem de produção
nunca teve middleware. Esse tem [post próprio](/pt/writing/my-csp-post-was-wrong).

## Os 23 da suíte de componente, agrupados pela causa

A suíte de componente também achou bugs, e não poucos: cerca de 30 na
primeira passada, em 19 de setembro, e mais 23 na segunda, no dia 20. Todos
corrigidos com um teste vermelho antes. Agrupar esses 23 por tela não
ensina nada. Agrupar pela causa estrutural ensina.

**Acessibilidade sem verificação automática (9).** Controle sem nome
acessível não quebra nada visualmente, então atravessa revisão de código
sem levantar suspeita. Os dois piores estavam em caminhos que toda conta
percorre: o campo do código de 6 dígitos, usado no cadastro e no 2FA, e o
seletor de avatar eram anunciados por leitor de tela como campos vazios. O
resto era elemento interativo dentro de elemento interativo: checkbox
focável dentro de botão nas opções de cargo, o `role="button"` do dnd-kit
caindo no wrapper de um card que já era `<button>`.

O mecanismo que segura essa família é pequeno. O helper roda o axe sobre a
árvore renderizada, e quando uma tela viola uma regra que ainda não dá pra
corrigir, a regra é desligada naquela suíte com um comentário
`// TODO(a11y):` dizendo por quê. Corrigir o bug significa apagar o TODO, e
apagar o TODO religa a asserção. A dívida fica visível no código e o
conserto se verifica sozinho. Hoje sobra exatamente um no repositório, e
ele não é nosso:

```tsx
// TODO(a11y): aria-hidden-focus — Base UI wraps every popup in
// `data-base-ui-focus-guard` spans that are aria-hidden yet keep
// tabindex="0". This comes from the library, not from app code.
'aria-hidden-focus',
```

**Comparações exercidas num sentido só (3).** O filtro "meus projetos" não
filtrava nada:

```tsx
if (mine) result = result.filter((p) => p.leadId !== undefined)
```

`leadId` é sempre string, então a condição é sempre verdadeira. O teste
existia, e passava, porque só conferia que os projetos do usuário
apareciam, nunca que os dos outros sumiam. O filtro de data tinha a mesma
forma: o `nuqs` devolve meia-noite UTC e o limite era montado com partes de
hora local, então em UTC-3 "a partir de 10/03" começava às 21h do dia 9, e
o rótulo do próprio botão discordava do que estava sendo filtrado.

**Contrato entre camadas lido errado (2).** O cartão de exclusão de conta
lia `json?.error?.message`. O envelope da API põe a mensagem no topo e
deixa em `error` só `{ code, details }`. Toda explicação do servidor era
trocada por uma mensagem genérica. Uma varredura no repositório achou o
mesmo erro no upload de avatar do onboarding.

**Operação de vários passos sem ponto de commit (1).** Trocar o sistema de
estimativas de um projeto disparava um PATCH, N POSTs e M DELETEs soltos,
sem rollback: uma falha no meio deixava o projeto com os valores novos e os
antigos ao mesmo tempo. Não existe endpoint único pra essa troca, então o
fluxo foi reordenado com o PATCH como ponto de commit: cria os valores
novos, troca o sistema, e só depois apaga os antigos. Falha antes do commit
desfaz o que foi criado e diz "Nada foi alterado". Falha depois avisa que
sobraram valores antigos, em vez de mentir que a troca se perdeu.

**Premissa errada sobre a dependência.** Dois do backend, e são os
meus favoritos, porque ninguém erraria por descuido. O `remove()` do
BullMQ devolve `1` sempre que o job não está travado, **exista ele ou
não**, e `0` quando um worker já segura o lock. O `cancelAccountDeletion`
tratava o retorno como "removi um job", então cancelar uma exclusão que
nunca foi agendada respondia sucesso. A existência agora é lida com
`getJob()` antes. O espelho disso estava no agendamento: com `jobId`
customizado, o BullMQ mantém o primeiro job e descarta o `add()` seguinte
em silêncio, então reagendar uma exclusão nunca mudava o prazo.

O resto da lista são formulários (o campo de URL do workspace
re-slugificava a cada tecla e comia o hífen; "Minha Empresa" virava
`minhaempresa`), um código de erro respondendo com o código de outro, e
dois jobs que se comportavam mal quando não tinham nada pra fazer ou
quando o cache falhava depois do banco já ter mudado.

## O que mudou na forma de escrever teste

Três regras saíram disso, e as três são verificáveis no código:

1. **Ao corrigir um bug, procurar o teste que o protege.** O typo e o
   filtro "mine" tinham testes. O fluxo de correção virou: teste que falha
   no código atual, correção, verde, e conferir se algum teste existente
   precisou mudar pra acompanhar. Se precisou, ele era cúmplice.
2. **Comparação booleana se testa nos dois sentidos.** O teste que confere
   que o item certo aparece não diz nada sobre o filtro se não houver um
   item errado na lista pra sumir. Essa regra ficou bem maior do que eu
   imaginava quando o mutation testing mostrou que o portão de autorização
   de projeto inteiro tinha o mesmo problema, e isso tem
   post próprio.
3. **Bug corrigido numa tela costuma existir em outra.** O slug, a leitura
   de `error.message` e o fuso apareceram duas vezes cada, em telas
   diferentes. Corrigir a ocorrência relatada sem varrer o padrão deixa a
   segunda pra próxima suíte achar.

E uma quarta, mais de mock que de teste: o mock de uma biblioteca externa
responde no formato exato da biblioteca, copiado do que ela devolve de
verdade, nunca no formato que o código gostaria de receber.

## Quanto tempo cada um viveu

| Bug | Entrou | Saiu | Viveu |
| --- | --- | --- | --- |
| Saudação hardcoded | 14/05 | 20/09 | ~4 meses |
| `FOUNDER_EXECUTIBE` | 22/06 | 20/09 | ~3 meses |
| Kanban sem drag | 09/09 | 20/09 | 11 dias |
| Erro do better-auth em inglês | — | 21/09 | não rastreei a origem |

O que a tabela mostra é que tempo de vida não tem relação com gravidade. O
kanban morto era o pior dos quatro pra quem usa o produto e foi o que menos
durou, só porque a suíte de navegador chegou onze dias depois dele. A
saudação era a mais boba e a que mais durou, porque estava no único tipo de
arquivo que nenhuma camada executava.

## Onde quebrou

**O teste cúmplice voltou no mesmo dia.** Às 12h56 de 20 de setembro, no
commit que corrigia o filtro "mine" e o envelope de erro, entraram testes
novos pro cartão de 2FA. Eles alimentavam o componente com
`error: { message: 'Senha incorreta' }`, em português. Duas horas e meia
depois saiu o commit que corrigia o typo e registrava a lição do teste
cúmplice. No dia seguinte, consertando o erro em inglês do login, descobri
que as três telas de 2FA mostravam `Invalid password` cru, e que os testes
delas não viam porque tinham sido escritos daquele jeito. Na mesma leva, os
testes dos botões de OAuth conferiam o nome acessível com regex de
substring e nunca viram que ele começava com "google-logo". A causa raiz é
que a regra existia como lição numa nota, não como verificação: nada
impede um mock de devolver texto inventado. O que eu tenho hoje é a
convenção e a revisão, e as duas falharam no mesmo dia em que a regra foi
escrita.

**Existe uma corrida de hidratação aberta no produto.** O spec que renomeia
um projeto falhou duas vezes seguidas no CI e passava localmente. O trace
mostrou o corpo do PATCH com o nome **antigo**. Os inputs do formulário são
controlados, com `value={name}` sobre um `useState` semeado com o projeto
que o servidor mandou, e a hidratação renderiza esse estado, então o texto
digitado antes dela é sobrescrito. A API responde 200 pra um update que não
muda nada, o toast de sucesso aparece, e só o reload no fim do teste
revela o problema. No CI aparece e aqui não porque a hidratação é mais
lenta num runner de 2 vCPU carregado. O teste agora repete o `fill` até o
valor ficar, o que transforma a corrida numa pré-condição explícita, mas
isso protege o teste, não o usuário: alguém num aparelho lento que digita
logo depois de abrir a tela perde o que escreveu, sem aviso. Meu primeiro
diagnóstico, registrado na hora, culpava inputs não controlados; estava
errado, e o comentário do spec foi corrigido cinco dias depois. Isso
continua sem correção no produto.

**A cobertura continua cega pros Server Components.** A exclusão do escopo
é proposital e eu manteria ela, mas significa que a única coisa que executa
esses arquivos é a suíte de navegador, com 18 specs pelos caminhos
principais. Uma página server-side fora desses caminhos não é executada por
teste nenhum, e nenhum relatório me avisa disso.

**A suíte visual tem tolerância, só que não onde parece.** O limiar é
`maxDiffPixelRatio: 0`, nenhum pixel pode mudar, mas o `threshold` por
pixel é `0.02`: um pixel só conta como diferente quando a cor dele se move
uns 2%. Isso é seguro contra o rasterizador do runner cair um nível de cor
ao lado e ainda é apertado o bastante pra pegar um `#fff` virando
`#f5f5f4`, que o default de `0.2` deixa passar. Quando a primeira execução
no CI falhou por um pixel de um título azul, por causa do Skia escolhendo
caminhos SIMD diferentes conforme a CPU, a saída foi tirar a escolha do
hardware com flags do Chromium, não afrouxar o número. Mas é uma suíte de
44 imagens em 12 telas, e qualquer tela fora delas não tem verificação
visual nenhuma.

## O que isso prova, e o que não prova

Prova que uma cobertura de 98% de linhas convive tranquilamente com um
fluxo principal morto, e que a causa não é teste de menos: é teste escrito
a partir do código, que herda as premissas erradas dele. Quatro bugs que
atravessaram mais de 3.600 testes caíram na primeira execução de 18 specs
num navegador de verdade.

Não prova que a suíte de navegador resolve isso. Ela achou esses quatro
porque eram caminhos que ela percorre. Tudo que fica fora dos 18 specs
continua dependendo das camadas de baixo, com as mesmas cegueiras.

Não prova que eu parei de escrever teste cúmplice. A evidência é a
contrária: escrevi um no mesmo dia em que dei nome ao problema. O que
mudou é que agora eu sei o que procurar na revisão, e que um mock de
biblioteca com texto que a biblioteca nunca manda é, pra mim, um defeito
do teste e não um detalhe dele.
