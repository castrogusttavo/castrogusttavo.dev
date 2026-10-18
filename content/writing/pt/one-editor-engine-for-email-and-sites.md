---
title: Um motor de edição para e-mail e sites — o Steel Canvas e a coedição em cima dele
description: "O pedido era liberdade total: arrastar componentes, clicar e editar tudo num painel lateral, para e-mail em React Email e para sites no nível de Wix e WordPress. Dois editores duplicariam seleção, arrastar e soltar, histórico, camadas, inspetor, atalhos — e os bugs de cada um. Isto é o motor único que saiu disso: documento normalizado, operações puras com inversa, catálogo que declara e motor que executa, e como a coedição com Yjs foi encaixada sem abrir mão de nenhuma regra do catálogo."
icon: code
date: "2026-11-26"
---

O editor de e-mail do CRM do Steel era uma estrutura travada: o usuário
escolhia um modelo e trocava texto e imagem dentro das seções que o
modelo trazia. As landing pages, a mesma coisa. O product owner queria o
oposto: uma barra lateral com os componentes disponíveis, arrastar e
montar 100% da página, clicar num componente e o painel da direita virar
o menu de edição completo dele. Para o e-mail, sobre React Email. Para os
sites, nas palavras registradas na ADR 0026, "drag-and-drop completo —
igual a um Wix e WordPress", com várias páginas, blog e domínio próprio.

O Steel é a plataforma multi-tenant da Stratus Telecom — ServiceDesk ITIL
4, CRM, Comunicação/WhatsApp e o Steel AI por cima dos três. Sou Lead
Software Engineer na Stratus Telecom: construí a primeira versão do Steel
e hoje lidero a modernização técnica dele. Este post é sobre duas
decisões de arquitetura: a ADR 0026, que criou o Steel Canvas, e a ADR
0027, que colocou coedição em tempo real em cima dele.

## O problema: dois editores, duas vezes os mesmos bugs

E-mail e site parecem produtos diferentes, e na saída são: um e-mail
precisa sobreviver ao Outlook com tabela aninhada, um site precisa de CSS
responsivo e scripts. Mas o **editor** é o mesmo problema nos dois casos.
Selecionar um nó. Arrastar da paleta e soltar entre dois irmãos, recusando
destinos inválidos. Desfazer e refazer. Uma árvore de camadas com
renomear, ocultar e travar. Um inspetor com abas. Copiar, colar, duplicar,
atalhos de teclado.

Construir isso duas vezes duplicaria cada um desses pedaços — e, o que
pesa mais, duplicaria os bugs. O caso clássico de editor visual é o
desfazer que restaura metade de um arrasto, ou o colar que entra num
container que não aceitaria aquele filho. Num editor só, cada bug desses
é corrigido uma vez. Em dois, é corrigido duas vezes, de dois jeitos
diferentes, e um dos dois volta.

## A ideia: o motor não sabe o que é e-mail

A decisão da ADR 0026 é um **motor de edição comum**
(`src/lib/canvas/`, com o shell em `app/_components/canvas/`) e um
**catálogo de componentes por destino**. O catálogo de e-mail renderiza
com React Email; o de sites renderiza HTML/CSS responsivo. O motor não
sabe nada de nenhum dos dois — o comentário no topo de `types.ts` diz
isso literalmente: "The engine knows nothing about e-mail or HTML".

Tudo o que é específico de destino vai para o catálogo como declaração.
Tudo o que é comportamento de editor fica no motor. A ADR resume numa
frase: **o catálogo declara, o motor executa**.

## Como funciona

### Documento normalizado

O documento não é uma árvore aninhada. É um mapa plano de nós mais o id
da raiz:

```ts
export interface CanvasDocument {
  catalog: string
  version: number
  rootId: CanvasNodeId
  nodes: Record<CanvasNodeId, CanvasNode>
}
```

Cada nó tem `type` (`email.button`, `site.section`), `props`, `children`
como lista de ids e um `meta` só do editor (nome na árvore de camadas,
oculto, travado). As props de cada tipo são validadas pelo schema Zod que
o catálogo registra. Normalizado, e não aninhado, para que operações,
histórico e — a ADR já dizia isso antes da fase de coedição — um futuro
binding Yjs mexam **em um nó por vez**.

### Toda mudança é uma operação pura com inversa

Nada edita o documento diretamente. Toda mudança é uma `CanvasOp`:

```ts
export type CanvasOp =
  | { kind: 'insert'; fragment: CanvasFragment; at: CanvasLocation }
  | { kind: 'remove'; id: CanvasNodeId }
  | { kind: 'move'; id: CanvasNodeId; to: CanvasLocation }
  | { kind: 'update'; id: CanvasNodeId; set: Record<string, unknown> }
  | { kind: 'meta'; id: CanvasNodeId; set: Partial<NonNullable<CanvasNode['meta']>> }
  | { kind: 'batch'; ops: CanvasOp[]; label?: string }
```

`applyOp(doc, op, catalog)` valida contra o catálogo, nunca lança exceção
e devolve o documento novo **e a operação inversa**. A inversa de um
`remove` é o `insert` da subárvore; a de um `update` é outro `update` com
os valores antigos dos mesmos caminhos. `batch` é tudo ou nada. Uma
operação recusada deixa o documento intacto e devolve o motivo
(`NOT_ACCEPTED`, `MAX_CHILDREN`, `REQUIRED`, `UNIQUE`, `LOCKED`,
`CYCLE`…), que o shell mostra em pt-BR.

O documento novo usa compartilhamento estrutural: nós não tocados mantêm
o mesmo objeto, e uma operação que não muda nada devolve o mesmo
documento — que não entra no histórico. Isso é o que deixa o
`React.memo` de cada nó funcionar, e, como veremos, é também o que deixa
a coedição barata.

O histórico guarda operações, não fotos do documento. Até **200** passos;
`update`s seguidos no mesmo nó e nos mesmos caminhos em até **500 ms**
viram um passo só — digitar uma palavra ou arrastar um slider de
espaçamento é um desfazer, não quarenta:

```ts
// Same paths: the latest op alone describes the change; the first
// inverse still restores the values from before the burst.
top.forward = op
top.at = now
top.token = nextToken++
```

### O catálogo declara

Uma definição de componente diz o que ele aceita e onde pode viver, e o
motor faz cumprir:

- `accepts` (lista de tipos ou função) e `parents`;
- `minChildren` e `maxChildren`;
- `required` — não pode ser excluído (o rodapé do e-mail);
- `unique` — um só por documento;
- `inspector` — a **descrição** do painel lateral: seções nas abas
  Conteúdo, Estilo e Avançado, cada campo com um caminho nas props e um
  tipo de controle (`spacing`, `typography`, `color`, `link`, `list`…).

Nenhum catálogo monta formulário próprio; o inspetor é gerado da
descrição. `defineCatalog` ainda confere no boot que todo `accepts` e
`parents` aponta para um tipo registrado — catálogo quebrado é erro de
programação, não condição de runtime.

### Valores responsivos em cascata

Um campo responsivo guarda `{ base, tablet?, mobile? }`. O breakpoint que
não tem valor herda do maior mais próximo — `base → tablet → mobile`:

```ts
for (let i = CANVAS_BREAKPOINTS.indexOf(breakpoint); i > 0; i--) {
  const override = value[CANVAS_BREAKPOINTS[i]]
  if (override !== undefined) return override
}
return value.base
```

O e-mail usa `base` + `mobile`; os sites, os três. O inspetor mostra em
qual breakpoint há sobrescrita, e "limpar sobrescrita" só remove a chave.

### Componentes reais no iframe, alças por cima

O canvas não desenha uma imitação dos componentes: renderiza os
componentes **reais** do catálogo dentro de um iframe, com o CSS isolado.
Contornos, alças, seleção e a linha azul de onde o item vai cair ficam
numa camada no documento pai, por cima do iframe, e por isso nunca entram
na saída. A única exigência ao catálogo é espalhar `attributes`
(`data-canvas-id`) no elemento mais externo de cada componente; na saída
final esse objeto vem vazio.

O alvo de soltar também não usa *droppables* por nó: a cada movimento o
ponteiro é testado no iframe (`elementFromPoint`) ou na árvore de
camadas, e o `canDrop` do motor decide. Arrastar e soltar usa `@dnd-kit`,
que já estava instalado, com sensor de teclado: espaço pega, setas
movem, espaço ou Enter solta, Esc cancela.

Os sites usam layout **híbrido**: fluxo (seção → container flex/grade →
elementos) como padrão, e "posição livre" opcional dentro de um
container, por breakpoint, com guias de alinhamento.

## Coedição: Yjs sem perder o catálogo

O motor salvava por REST, com autosave de 1,5 s. Duas pessoas no mesmo
documento se sobrescreviam. A Wiki do Steel já editava em tempo real com
Yjs num processo próprio (Hocuspocus + Redis, atrás de `/realtime`), e a
ADR 0027 decidiu usar **o mesmo servidor e o mesmo caminho**, com salas
`canvas.<tipo>.<id>` (`site-page`, `site-global`, `email-template`). A
Wiki usa o id puro da página como sala; o prefixo garante que as duas
nunca colidam — e nenhuma regra nova nos proxies.

A parte difícil não é sincronizar bytes. É que Yjs é um CRDT: ele
converge sempre, mas converge para **qualquer** estado que a soma das
mudanças produzir — e o catálogo tem regras que nenhum CRDT conhece.

### O modelo Yjs, e por que as props são planas

O documento vira dois mapas de topo: `canvas.header` (catálogo, versão,
raiz) e `canvas.nodes` (id → `Y.Map` com `type`, `props`, `children` como
`Y.Array` de ids e `meta`). A decisão que mais importa está em `props`:
ele é um mapa **plano por caminho de folha**, com o separador `\u001f`
(␟) entre os segmentos — `style␟padding␟top`, não um `Y.Map` dentro de
outro.

O motivo aparece num exemplo pequeno. Um botão com props
`{ label: 'Comprar' }`, ainda sem nenhum `style`. Ao mesmo tempo, a Ana
define o espaçamento superior e o Bruno define a cor.

Com mapas aninhados, cada cliente precisa **criar** o objeto `style` que
ainda não existe:

```
Ana:   props.style = Y.Map { padding: Y.Map { top: 16 } }
Bruno: props.style = Y.Map { color: '#fff' }
```

São duas escritas concorrentes na mesma chave `style` do mapa `props`.
O Yjs resolve isso como resolve qualquer chave disputada: um dos dois
valores vence, de forma determinística, e o outro mapa inteiro some. Um
dos dois perde a edição sem ter mexido no que o outro mexeu.

Com o mapa plano, não há objeto para criar:

```
Ana:   props['style␟padding␟top'] = 16
Bruno: props['style␟color']       = '#fff'
```

Chaves diferentes, nenhuma disputa. Na leitura, `unflatten` remonta
`{ label: 'Comprar', style: { padding: { top: 16 }, color: '#fff' } }`.
Duas pessoas editando o **mesmo** caminho continuam com "o último vence",
e arrays e textos ricos são folhas inteiras — o que uma lista de itens ou
uma string de rich text precisa.

### Ida: só os caminhos que mudaram

Cada mudança do store — op, desfazer, refazer, reset — vira **uma**
transação Yjs que toca só os nós da op (`touchedIds`) e, dentro de cada
nó, só os caminhos de props que mudaram. Aqui o compartilhamento
estrutural paga a conta de novo: `syncProps` compara por identidade
antes de comparar por valor, então uma subárvore de props que é o mesmo
objeto nos dois documentos é pulada sem olhar dentro. E um caminho igual
nos dois lados não é reescrito — fica valendo o que estiver no Yjs, que
pode ser a mudança mais nova de outra pessoa.

A lista de filhos segue a mesma ideia: `syncIds` mantém o prefixo e o
sufixo comuns e faz um único `delete` + `insert` na parte que difere.

### Volta: projeção num documento válido

Mudanças concorrentes produzem estados que nenhuma operação isolada
produz: o mesmo nó movido para dois pais ao mesmo tempo, um filho
inserido numa seção que outra pessoa removeu, dois inserts que juntos
passam do `maxChildren`. O Yjs converge para esses estados sem reclamar.

Por isso a atualização remota não é aplicada — é **projetada**.
`projectCanvas` faz uma caminhada determinística a partir da raiz (pré-
ordem, a primeira ocorrência vence) que descarta ids pendurados e
duplicados, filhos que o pai não aceita ou acima do `maxChildren`, e
nós de tipo desconhecido ou com props inválidas — esses ficam na
**última versão boa** que o store tinha, em vez de sumir. O resultado
entra no store por `applyRemote`, que **não grava passo no histórico**.

Como todo cliente projeta o mesmo estado Yjs com a mesma caminhada, todos
chegam ao mesmo documento. O teste
`converges after random concurrent edits on three peers` exercita isso:
três clientes, 60 rodadas de updates, inserts, moves, remoções, undo e
redo aleatórios, sincronizando a cada três rodadas, e o mesmo documento
nos três no fim.

### Desfazer por usuário, sem `Y.UndoManager`

O Yjs tem um gerenciador de desfazer próprio. A ADR 0027 escolheu manter
o histórico de operações inversas do store: ele só contém as ops do
próprio usuário, e cada desfazer passa de novo pelo `applyOp` — ou seja,
é **revalidado pelo catálogo**. Um passo que não se aplica mais (o nó foi
removido por outra pessoa) é descartado, e os passos abaixo dele
continuam alcançáveis. O desfazer ignora `LOCKED` e `REQUIRED`, porque a
op original já passou por essas checagens; as regras estruturais
continuam valendo.

### Persistência pelo service dono, e merge com o mundo de fora

O servidor realtime não grava direto no banco. Ele grava pelo **service
dono** de cada documento — `SitePageService.update`,
`SiteGlobalService.update`, `CrmEmailTemplateService.update` —, com a
mesma validação, permissão e auditoria de um save por REST. Grava com o
debounce do Hocuspocus e sob demanda: antes de publicar, versionar ou
enviar teste, o editor manda `canvas.flush` e espera a confirmação; sem
confirmação, cai no REST. Um documento recusado pelo service é revertido
na sala para o último gravado, para todo mundo.

O estado Yjs fica em `canvas_collab_states` junto com o hash SHA-256 do
JSON gravado. Se, ao carregar a sala, o hash do documento no banco não
bate com o do estado Yjs, alguém mudou o documento por fora — o autosave
REST de quem estava sem realtime, uma restauração de versão, o gerador de
site com IA. Esse documento externo é mesclado em **três vias**, nó a nó:
entra no Yjs só o que mudou entre a base e o externo, o resto fica como
está na sala.

E se o realtime não sincronizar em **5 s** (ou cair), o editor mostra
"Sem colaboração em tempo real" e volta ao autosave REST. Ao reconectar,
o Yjs mescla o que foi editado.

## Resultados

O que dá para medir no repositório:

| | E-mail | Sites |
|---|---|---|
| Versão do catálogo | 2 | 1 |
| Tipos de componente registrados | **22** | **41** |
| Tipos visíveis na paleta | 20 | 35 |
| Breakpoints | `base`, `mobile` | `base`, `tablet`, `mobile` |
| Regras declaradas | rodapé `required` + `unique`; seção com no máximo 4 colunas | carrossel, abas e acordeão com `minChildren` 1 |

Os dois catálogos — 63 tipos no total — usam o mesmo `applyOp`, o mesmo
histórico, a mesma árvore de camadas, o mesmo inspetor gerado e os mesmos
atalhos. Nenhum dos dois tem código de seleção, arrasto ou desfazer.

Sobre desempenho, a regra de leitura `getNode(doc, id)` faz cada
operação custar O(profundidade + o que a op toca), e não O(tamanho do
documento). O teste de propriedades monta um documento de **2.002 nós** e
aplica 400 operações de cada tipo; o README registra ~0,03–0,05 ms por
op, e o teste só exige menos de 0,5 ms. Rodei o mesmo teste três vezes
na minha máquina: entre **0,028 e 0,092 ms** por operação, com `update`
o mais barato e `remove` o mais caro.

Testes: os 37 arquivos de teste com "canvas" no nome somam **683**
testes. Localmente passaram 674; os 9 que falharam estão nos dois
arquivos que precisam de Postgres de teste (o repositório e a integração
de persistência da coedição), que eu não tinha de pé. Só o binding Yjs
tem 24 testes, incluindo edição concorrente de caminhos irmãos num
objeto aninhado, nó movido para dois pais, insert numa subárvore
removida e o teto de `maxChildren` com inserts concorrentes.

A comparação contra "dois editores" é contrafactual — o segundo editor
nunca foi escrito, então não existe número de bug evitado para mostrar.

## Onde quebra

**Três regras do catálogo ficam fora da projeção.** A projeção cobre
`accepts`, `maxChildren`, tipo e props, porque são checagens locais de um
nó e seus filhos. `unique`, `required` e `minChildren` não: são regras
sobre o documento inteiro ou sobre o que **falta**, e a caminhada não tem
como inventar um rodapé que alguém removeu. Elas só são verificadas
quando o service grava. Num conflito desses — duas pessoas inserindo o
único cabeçalho, alguém removendo o último slide enquanto outra pessoa
mexe nele —, o service recusa e a sala é revertida para o último
gravado, levando junto **todas** as mudanças da janela de debounce. A ADR
fala em ~2 s, que é o debounce padrão do Hocuspocus; mas esse debounce é
reiniciado a cada mudança até o `maxDebounce`, que por padrão é 10 s, e o
servidor não sobrescreve nenhum dos dois. Com edição contínua, a janela
revertida pode passar bem de 2 s.

**O desfazer usa a inversa da época.** A inversa de um `update` guarda os
valores de antes da minha edição. Se eu mudo a cor de um título, o Bruno
muda a mesma cor depois, e eu desfaço, a minha inversa restaura o valor
original por cima do dele. O teste que existe cobre o caso de caminhos
diferentes (desfazer a minha cor mantém o texto do Bruno), não o do mesmo
caminho. É o preço de não usar `Y.UndoManager`: o histórico revalidado
pelo catálogo não sabe que alguém escreveu depois.

**O servidor realtime engordou.** Para gravar pelo service dono, o
processo realtime passou a empacotar os services de sites e de e-mail —
inclusive a renderização do e-mail. O que era um servidor de Yjs da Wiki
virou um processo que carrega metade do domínio do CRM. A ADR aceita isso
como consequência, mas não mede o tamanho do bundle.

**O hash é mais sensível do que o conteúdo.** O hash usa JSON com chaves
ordenadas — necessário porque o `jsonb` do Postgres reordena chaves. A
ADR registra como consequência que qualquer gravação fora da sala, mesmo
de conteúdo igual, conta como mudança externa e dispara o merge. Lendo
`stableStringify`, o caso é mais estreito do que isso: o mesmo JSON gera o
mesmo hash. O que dispara merge à toa é um documento **equivalente mas não
idêntico** — por exemplo, um campo `null` onde antes não havia chave
(`stableStringify` só descarta `undefined`). O merge em si é nó a
nó e não escreve nada onde não há diferença, então o custo é trabalho
jogado fora, não dado errado.

**E-mails antigos ficam de fora.** Templates `LEGACY` (HTML livre do
editor antigo, ou os dois layouts originais) continuam como estavam e
nunca entram no canvas. Os documentos `version: 1` do construtor de
blocos são convertidos para o formato do canvas ao abrir; na sala de
coedição, um template v1 convertido só passa a ter ids estáveis depois da
primeira gravação como v2.

## O que isso prova, e o que não prova

Prova que um editor visual pode ser separado em um motor que não conhece
destino nenhum e catálogos que só declaram: dois produtos de saída bem
diferentes — e-mail para Outlook e Gmail, site responsivo com scripts —
rodam sobre o mesmo `applyOp`, o mesmo histórico e o mesmo inspetor. E
prova que dá para colocar um CRDT por baixo desse motor sem abrir mão das
regras do catálogo, desde que a volta do Yjs seja uma projeção validada
e não uma aplicação cega.

Não prova que o motor único custou menos do que dois editores custariam
— o segundo nunca existiu para comparar. Não prova que a coedição se
comporta bem com muita gente no mesmo documento: os testes de
convergência usam três clientes simulados, não carga real. E deixa em
aberto as três regras globais do catálogo, que hoje só são cobradas na
gravação, ao preço de reverter tudo o que a sala editou na janela de
debounce.
