---
title: Construindo a Nexo com agentes de código — o trabalho não sumiu, mudou de lugar
description: "Dos 1.414 commits da Nexo, 1.076 trazem o trailer de co-autoria do Claude; desde 9 de setembro são 275 de 301. O volume é a parte menos interessante. O que mudou foi onde mora a engenharia: testes que rodam do outro lado de cada fronteira, verificação contra o artefato e o banco reais em vez de contra a suposição de alguém, e regras operacionais para agentes em paralelo, cada uma escrita depois de um incidente."
icon: terminal
date: "2026-12-15"
---

Dos **1.414** commits da `main` da Nexo, **1.076** trazem um trailer
`Co-Authored-By: Claude` na mensagem — 76%. No [post de
arquitetura](/pt/writing/nexo-architecture), em 20 de setembro, o total
era 1.255. De 9 de setembro até hoje, 17 de outubro, entraram **301**
commits, e **275** deles são co-assinados: 91%.

Esses números dizem que um agente escreve a maior parte do código que
entra no repositório. Não dizem nada sobre se o código presta. E é aí que
está o assunto deste post: nesse último mês e pouco, o trabalho de
engenharia não diminuiu — ele saiu da digitação e foi parar em três
lugares que eu não esperava que fossem tão caros.

1. **Testes que rodam do outro lado de cada fronteira**, não do lado em
   que o código foi escrito.
2. **Verificação contra a realidade** — o artefato que vai para produção,
   o banco vivo, o código da dependência instalada — e não contra o
   modelo mental de quem pediu ou de quem fez.
3. **Regras operacionais para agentes em paralelo**, e cada uma delas
   existe porque alguma coisa quebrou antes.

A tese é essa: um agente multiplica a saída, e a engenharia que importa
passa a ser a dos guard-rails. O resto do post é a evidência, tirada do
`git log` (o repositório é público) e das notas de sessão que eu guardo
no meu vault a cada sessão de trabalho com agente.

O que eu delego ao agente cabe numa lista curta: criar commits e fazer
merge de PR, análise profunda de performance, escrever e rodar testes,
construir componentes de frontend complexos ou animados, e revisar uma
arquitetura que eu já decidi — essa última em sessões longas. A decisão de
arquitetura em si continua comigo; o agente revisa, mede e executa.

## Como os números foram contados

Para quem quiser conferir, no clone de `castrogusttavo/nexo`, em
`main` (`0beed010`, 2026-10-17 20:39 -03):

```bash
git rev-list --count HEAD                                            # 1414
git log -i --grep='^Co-Authored-By: Claude' --format=%H HEAD | wc -l # 1076

git rev-list --count --since='2026-09-09T00:00:00-03:00' HEAD        # 301
git log -i --grep='^Co-Authored-By: Claude' \
  --since='2026-09-09T00:00:00-03:00' --format=%H HEAD | wc -l       # 275
```

A contagem é de **commits** alcançáveis a partir da `main` (merges
incluídos), não de linhas de trailer — seis commits têm mais de um. O
filtro de data usa a data de commit, não a de autoria. O trailer diz que
um agente participou daquele commit; não diz quanto do diff é dele.

## 1. O teste certo roda do outro lado da fronteira

O padrão que mais se repetiu: o código passava em todos os testes do lado
em que foi escrito e quebrava do outro lado de uma fronteira que nenhum
teste atravessava.

**Produção sem middleware.** Em 20 de setembro, o agente que montava a
suíte de navegador escolheu subir o artefato standalone
(`node .next/standalone/server.js`) em vez de `next start`. Foi essa
escolha que mostrou que o `.dockerignore` listava `proxy.ts` como
ferramenta de dev — toda imagem de produção era construída **sem o
middleware**. Sem CSP, sem HSTS vindos da aplicação, e uma URL privada
respondendo 200 para visitante anônimo. O build nunca reclamou, porque
arquivo ausente num contexto de build falha em silêncio (`1d3f61bb`).
A história completa, incluindo a CSP que eu tinha descrito errado, está em
[o meu post sobre CSP estava errado](/pt/writing/my-csp-post-was-wrong).

**Exclusão de conta que nunca excluiu.** No mesmo dia, o teste de navegador
pegou `prisma.user.delete` sendo recusado pelo Postgres: 12 relações com
`User` sem `onDelete`. O job lançava, o BullMQ tentava três vezes e
desistia, calado. Os testes unitários passavam porque as fixtures não
tinham nenhum conteúdo autorado (`94d044f2`). Detalhes em [a exclusão de
conta que nunca excluiu](/pt/writing/account-deletion-that-never-deleted).

**Testes cúmplices.** Um teste de componente **afirmava o typo**
`FOUNDER_EXECUTIBE` que travava o onboarding. Três testes de autenticação e
de OAuth eram alimentados com mensagens de erro já em português, ou batiam
o nome acessível por substring — por isso nunca viram o inglês do
better-auth vazando, nem o botão anunciando "google-logo Continuar com
Google". Fixture que já traz a resposta certa não testa nada.

**O portão de autorização sem prova.** O mutation testing mostrou que, em
18 serviços, fixar "é o lead" em `false` sobrevivia, e `.some` → `.every`
também — todo teste usava projeto com exatamente um membro. Na madrugada de
21 de setembro um helper passou a aplicar a mesma matriz de acesso a todo
método protegido, e os sobreviventes nas linhas do portão foram de **392
para 0** (`9d7dab3e`). Isso tem post próprio: [mutation testing no portão de
autorização](/pt/writing/mutation-testing-the-authorization-gate).

E o caso que eu acho mais honesto de contar, porque o erro é do próprio
agente. Em 24 de setembro ele adicionou um componente novo na status page,
rodou unit, contract, component e integration antes de comitar, e não rodou
o e2e que fixa a lista de componentes da API. A nota de sessão registra o
raciocínio: tratou "precisa de servidor no ar" como "o CI roda por mim" —
justamente a camada que existe porque enxerga o que as outras não veem. A
correção veio de outro agente, não de mim (`34da4ab1`, também co-assinado):
a camada que o primeiro pulou foi a que o segundo rodou.

O `CLAUDE.md` da Nexo abre a seção de testes com a frase que resume essa
seção inteira:

> Each layer answers a different question, and a bug that slips through
> one is usually invisible to the layers above it.

## 2. Verificar contra a realidade, não contra a suposição

A segunda mudança é que "o agente disse que funciona" e "eu acho que
funciona assim" viraram a mesma categoria de evidência: nenhuma.

Em 21 de setembro eu mandei três agentes atrás de seis pendências, e duas
das minhas premissas estavam erradas. Os agentes corrigiram lendo o código,
não o enunciado:

- **Jobs travados já alarmavam.** Eu achava que não. O BullMQ 5.79 não
  manda o job travado direto para a fila de falhas: grava uma falha adiada,
  devolve o job à fila, e o próximo worker o derruba com
  `UnrecoverableError`. O alarme disparava — com o rótulo errado
  (`807fa5e8`).
- **O aviso de build não era da rota de status.** Eram todas as **42**
  rotas GET com `withAxiom`; a `/api/status` só aparecia porque disparava
  primeiro o timer do lote do Axiom, e por isso o aviso ia e vinha. Antes:
  aviso em 4 de 5 builds. Depois: 0 de 3 (`38cd2d1c`).

A lição que ficou anotada: ler o código da dependência instalada vale mais
que a documentação ou a memória — a minha ou a do modelo.

O mesmo vale na outra direção. Em 9 de setembro eu pedi 98% de coverage no
e2e. O agente voltou dizendo que o número era inatingível naquele modelo:
os testes batem via `fetch()` num servidor em outro processo, e o coletor
de coverage só instrumenta o processo onde ele mesmo roda. Renegociamos
para "fechar as rotas sem teste nenhum", que eram 12 reais depois de
descartar 2 falsos positivos da heurística.

E a régua serve para o próprio agente. Na exclusão de conta, a conferência
das 30 FKs que apontam para `users` foi feita **contra o banco vivo**, não
contra o `schema.prisma`. No PostHog, uma sessão passou horas convencida de
que a ingestão estava quebrada em produção, quando o `posthog-js` descarta
em silêncio todo evento de navegador que parece automatizado — o bug era o
verificador. Logo depois de um deploy, uma requisição real sem sessão
achou uma fonte voltando 307 para o login, porque o `matcher` do proxy
excluía imagens mas não fontes; para quem está logado funcionava, e nenhum
teste tinha pego. O cron semanal de mutação não tinha disparado: rodado à
mão, falhou antes de começar, porque `prisma generate` exige `DATABASE_URL`
(`494749c4`). Deixado quieto, falharia toda segunda sem ninguém ver.

O `CLAUDE.md` também tem essa regra, escrita para mim e para o agente:

> Type-check and tests verify code correctness, not feature behavior —
> always smoke the golden path + a few edge cases in the browser.

## 3. Regras para agentes em paralelo, cada uma com um incidente atrás

Rodar vários agentes ao mesmo tempo é onde o ganho de volume é maior — em
19 de setembro foram 8 agentes em paralelo, um por domínio, só criando
arquivos de teste. É também onde apareceram os incidentes que nenhum teste
pega, porque não são bugs de código: são colisões entre processos.

| O que aconteceu | Regra que saiu |
|---|---|
| Um agente rodou `pnpm install` com outras suítes em execução; o `node_modules` trocou debaixo delas e o `@prisma/client` sumiu no meio da suíte visual. Toda a verificação final foi refeita do zero, sequencial. | Dependência muda por último, sozinha. Na leva seguinte, o agente de dependências só entrou depois que os outros dois terminaram. |
| Testes de integração rodados contra o banco de desenvolvimento local apagaram os dados locais. | Integração só contra banco descartável. |
| Outra sessão do Claude deu push de uma troca de imagem e levou junto um commit local da primeira sessão. | Não ter duas sessões com permissão de push na mesma `main` ao mesmo tempo. |
| Uma worktree de validação em `/tmp` (tmpfs, em RAM) derrubou a máquina na primeira varredura. | Worktree em disco, fora de `/tmp`. |
| Playwright com 1 worker: todos os specs compartilham a conta do worker e estouram o rate limit por usuário (429 na wiki). | Localmente, no mínimo `--workers=2`, como no CI. |

A segunda linha é a que mais me incomoda, porque a regra já existia como
julgamento. Em 9 de setembro, numa sessão noturna sem supervisão, o agente
**se recusou** a rodar o e2e: o `.env` apontava para um banco sem sufixo
`_test`, o setup faz `TRUNCATE ... CASCADE`, e ele preferiu entregar os
testes verificados só por `tsc` e Biome, com o aviso de que precisavam
rodar contra um banco descartável. Treze dias depois, outra sessão rodou a
integração contra o banco local e apagou tudo. Julgamento que acerta uma
vez e erra na outra não é regra. Hoje está no `CLAUDE.md`:

> Integration tests truncate all tables `afterEach`
> (`src/__tests__/setup.integration.ts`), so they require a disposable dev
> database.

Na mesma família, fora da tabela porque não é colisão entre agentes: uma
credencial colada num chat deve ser considerada queimada e rotacionada,
não importa quem vá ler o chat depois.

O custo do banco apagado foi médio: levou junto boa parte dos dados que
eu usava em testes de carga locais. Mas o prejuízo maior foi o que ele
revelou — não existiam arquivos de carga em lote para reconstruir aqueles
dados. Se um banco local não pode ser recriado com um comando, ele não é
descartável, e a regra "integração só contra banco descartável" pressupõe
justamente isso.

## A madrugada com autorização explícita

O caso que junta as três coisas é a madrugada de 21 de setembro. Pedi que
o agente corrigisse "todos os itens de visual, acessibilidade e outras
correções" e subisse um agente para os problemas de segurança, com
autorização explícita para conduzir tudo sozinho enquanto eu dormia. O
intervalo `ec8273ac..28ceb26` tem **22 commits**, todos co-assinados, em
três levas ao longo do dia; 12 deles entraram entre meia-noite e as 3h.

| Medida | Antes | Depois | Fonte |
|---|---|---|---|
| Alertas de code scanning abertos | 39 | 5 | API de code scanning do GitHub |
| `pnpm audit` | 62 (11 high) | 43 (1 high) | `ccac356e` |
| `pnpm audit`, leva da tarde | 43 | 1 low aceito | `c3c975de` |
| Sobreviventes de mutação no portão de autorização | 392 | 0 | `9d7dab3e` |

Os alertas eu reconstruí a partir de `created_at`, `fixed_at` e
`dismissed_at` de cada alerta na API: 39 abertos às 00:00 de 21/09 (-03),
5 às 09:00 — 32 corrigidos e 2 dispensados. As duas dispensas foram
falsos positivos (`dangerouslySetInnerHTML` na página legal), não
correções.

O que fez essa noite funcionar não foi a autonomia — foi que cada número
foi medido depois, sequencialmente, sem agente nenhum rodando, porque
aquela foi a noite do `pnpm install` no meio das suítes.

Para trabalho maior, o formato é outro: plano antes, aprovação, fases. O
plano do app privado instantâneo (16 de outubro) começa com o que a
documentação do Next 16.3 instalada em `node_modules` diz — lida antes de
propor —, lista os riscos para eu decidir, e foi aprovado no dia 17. Cada
fase virou commit, e onde a implementação se afastou do plano, o próprio
plano registra o desvio e o motivo. Uma das fases achou um vazamento real
já em produção, por um teste de bypass escrito **antes** de remover o
portão antigo.

O que me deixou confortável em autorizar aquela madrugada não foi
confiança no agente: foi que o SDD (*Spec Driven Development*) já estava
inteiro escrito. O agente não estava decidindo o que construir, estava
executando contra especificações que eu já tinha fechado — e contra um
pipeline que recusa o que não passa.

## Onde esse argumento é fraco

**O trailer não mede contribuição.** 1.076 commits co-assinados dizem que
um agente participou, não quanto do diff é dele nem quanto eu reescrevi.
Também não existe contrafactual: não tenho como dizer quantos commits a
Nexo teria sem agente.

**Os incidentes que eu conto são os que alguém percebeu.** A tabela de
regras é, por construção, uma lista de falhas que deixaram rastro. Falha
que não deixou rastro não está nela.

**Boa parte das regras não está no repositório.** "Dependência por último",
"uma sessão com push por vez", "worktree fora de tmpfs" e "dois workers"
vivem nas notas de sessão do meu vault, não no código. Só a do banco
descartável está escrita no `CLAUDE.md` — e o `CLAUDE.md` da Nexo está no
`.gitignore`, então nem ele é público. As citações acima são do arquivo
como está hoje na minha máquina.

**O número da madrugada não se sustentou sozinho.** Hoje a mesma API lista
**16** alertas de code scanning abertos, 11 deles criados em 11 de outubro,
todos do Snyk sobre dependências. Os guard-rails pegam o que foi decidido
medir; advisories novos continuam chegando, e "39 → 5" é uma foto de um
dia, não um estado.

**Um mesmo agente acerta e erra a mesma regra.** O caso do banco é o
exemplo: a mesma ferramenta que se recusou a rodar contra o banco errado
no dia 9 rodou contra ele no dia 22. Regra escrita reduz isso; não zera.

## O que isso prova, e o que não prova

Prova que, num repositório onde 91% dos commits do último mês são
co-assinados por um agente, os defeitos mais graves que apareceram —
produção sem middleware, exclusão de conta que nunca funcionou, um portão
de autorização sem prova nenhuma — foram achados por testes que rodam do
outro lado de uma fronteira, e por verificação contra o sistema real. Mostra
também que os incidentes causados pelo próprio trabalho com agentes foram,
na maioria, colisões operacionais entre processos — e que cada um virou uma
regra anotada, mesmo que só uma esteja no `CLAUDE.md`.

Não prova que agentes deixam o código melhor nem pior — prova que o
volume que eles produzem só é seguro atrás de um
[pipeline que não deixa código vermelho chegar a produção](/pt/writing/trunk-based-with-a-real-safety-net)
e de alguém que trata a afirmação do agente, e a própria, como hipótese.

Para mim, o papel não encolheu, mudou de forma. Continuo modelando a
arquitetura do software, desenhando ideias e formatos de montagem — e
sempre escrevendo as specs que os agentes seguem. O volume do `git log` é
deles; o desenho que esse volume obedece continua sendo meu.
