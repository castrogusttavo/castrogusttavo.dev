---
title: Por que troquei o tiptap pelo Plate no editor da Nexo
description: "O tiptap é headless por design — te dá o motor do documento e zero interface. Isso significava construir menu de seleção, comando de barra e controles de tabela do zero, sem nenhum atributo de acessibilidade. Troquei pelo Plate, que já vem com kits de componente alinhados ao shadcn/ui e Radix por baixo — e os números do antes/depois mostram exatamente o que isso custava."
icon: code
date: "2026-08-25"
---

O menu de seleção do editor de descrição de issue na Nexo — aquele que aparece
quando você seleciona um texto e escolhe negrito, itálico, link — tinha 174
linhas de código só pra existir. Zero atributos `aria-`, zero `role`. O menu
de comando de barra (`/`) tinha mais 162. Os controles de tabela, mais 54.
Quase 400 linhas de interface construída à mão, para três pedaços de chrome
que qualquer editor de texto rico "deveria" ter pronto — e nenhuma delas
navegável por teclado ou legível por leitor de tela do jeito certo.

Isso não é um bug do tiptap. É a proposta dele: `tiptap`/`ProseMirror` são
**headless** por design — te dão o modelo do documento, o schema, os comandos
de edição, e nada de interface. Toda a interface é responsabilidade sua.
Pra um editor de texto simples isso é uma feature. Pra um produto que precisa
parecer parte do resto da Nexo — que usa shadcn/ui em todo canto — e que eu
queria de verdade acessível, virou o oposto: eu estava reconstruindo, peça
por peça, um sistema de componentes que já existe em outro lugar.

## O problema: headless não é neutro, é trabalho que alguém tem que fazer

Na prática, headless significava três frentes pra construir do zero ao
mesmo tempo — função, visual e acessibilidade — e nenhuma delas ficava
pronta de vez. Implementar um comando novo no slash menu não era só
registrar o comando; era também acertar o estilo do item na lista, e
depois lembrar de cobrir foco/teclado/leitor de tela, que geralmente ficava
pra depois e às vezes nunca chegava. Toda mudança nessas telas vinha com
regressão de alguma das três — arrumava função e quebrava visual, arrumava
visual e esquecia acessibilidade de novo. Não é um problema pontual, é o
formato do trabalho quando a ferramenta não assume nenhuma das três.

O sintoma mais visível era visual: o editor não parecia Nexo. Botões com
estilo próprio, menus com espaçamento próprio, nada herdando os tokens de
design (`hover:bg-muted`, `focus-visible:ring-ring/50`) que o resto da
aplicação usa. Mas o problema estrutural estava um nível abaixo disso — era
acessibilidade, e eu só percebi a extensão dele quando fui conferir.

`components/editor/bubble-menu.tsx`, o menu de seleção do tiptap: zero
ocorrências de `aria-*` ou `role=`. Nenhuma. Cada botão do menu era uma `div`
ou um `button` sem nenhuma semântica extra pra dizer "isso é um item de menu,
isso está marcado como ativo, isso é um combobox" pra quem navega com
teclado ou leitor de tela. O mesmo padrão se repetia no `slash-menu.tsx` e no
`table-controls.tsx`. Não porque alguém decidiu pular acessibilidade de
propósito — é que o tiptap não te dá isso de graça, e escrever certo do zero
(gerenciamento de foco, `aria-activedescendant`, `role="menu"`/`role="menuitem"`
coordenados, anúncios de leitor de tela pra estado dinâmico) é um projeto à
parte, não um efeito colateral de escrever um bubble menu funcional.

E não era só acessibilidade que sofria — funcionalidade básica também
quebrava por causa da mesma característica headless. Um exemplo real, do
editor de sticky notes (que até hoje continua no tiptap): `useEditor()` por
padrão tenta renderizar imediatamente no client, o que em qualquer app
Next.js com SSR gera um mismatch de hidratação — o HTML do servidor não
bate com o que o React monta no browser. A correção é uma flag pouco óbvia,
`immediatelyRender: false`, documentada no meio do guia de SSR do tiptap,
não em nenhum warning do editor em si:

```diff
  const editor = useEditor({
+   immediatelyRender: false,
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: false })],
```

Achei essa flag por acidente, depois de já ter descartado hipótese errada
(achei que era problema de key do React, de ordem de render, de CSS
carregando tarde). É esse o tipo de bug que o headless empurra pra cima de
quem integra: não é a lib que está errada, é que cada detalhe de como ela
se comporta dentro do seu framework específico vira responsabilidade sua
descobrir.

## A ideia: usar um editor que já vem alinhado ao design system, não construir o alinhamento

O [Plate](https://platejs.org) (MIT, baseado em Slate) resolve isso de um
jeito específico: ele não é só "outro editor headless" — vem com kits de
componente prontos (`@platejs/basic-nodes`, `@platejs/code-block`,
`@platejs/list`, `@platejs/indent`) desenhados especificamente pra rodar em
cima do shadcn/ui, com Radix UI por baixo da UI de verdade (`@radix-ui/react-toolbar`,
`@radix-ui/react-tooltip`). A diferença central: no tiptap, a interface é
100% sua responsabilidade; no Plate + kit shadcn, o toolbar, o menu de
comando e os controles de bloco já vêm com a semântica de acessibilidade dos
primitivos Radix embutida — porque Radix é desenhado assim desde a raiz.

Trocar de editor não é só trocar de dependência — é trocar "motor headless,
construa sua própria interface" por "motor + kit de interface já plugado no
seu sistema de design", herdando o trabalho de acessibilidade que Radix já
fez, em vez de refazer.

## Como funciona: a migração de verdade

A troca não foi um `npm uninstall tiptap && npm install platejs` — o formato
de dado mudou. `IssueDTO.description` no tiptap era `JSONContent` (um objeto
com `type`/`content` aninhado); no Plate é `Value`, um array de elementos.
Isso ondulou pelo schema Zod:

```ts
const IssueContentSchema = z
  .array(z.record(z.string(), z.unknown()))
  .refine(
    (value) => JSON.stringify(value).length <= 100_000,
    'Descrição excede o tamanho permitido',
  )
```

(`z.record` virou o elemento de dentro do array, não o schema inteiro — e o
`.refine` de tamanho continua ali, porque isso não mudou: descrição de issue
sempre teve um teto de bytes, independente de qual editor gera o JSON.)

O detalhe mais delicado foi dado legado: o banco de dev já tinha issues
salvas no formato antigo do tiptap. Sem rodar uma migration de dado (a
descrição fica armazenada como JSON solto, não em colunas tipadas), o mapper
precisou de um fallback defensivo:

```ts
description: Array.isArray(issue.description)
  ? (issue.description as Value)
  : EMPTY_ISSUE_DESCRIPTION,
```

Uma linha, mas resolve um problema real: `Array.isArray` distingue uma
`Value` do Plate (sempre array) de um `JSONContent` do tiptap antigo (sempre
objeto) — issues antigas caem no `EMPTY_ISSUE_DESCRIPTION` em vez de quebrar
a renderização. Não é elegante, é uma ponte deliberada até o dado antigo
deixar de existir.

O resto da reconstrução foi montar os componentes de verdade: o
`fixed-toolbar` (heading, blockquote, listas, marks), os nós de bloco — código,
citação, heading, highlight, `hr`, `kbd`, parágrafo — cada um com uma
variante estática irmã (`*-node-static.tsx`) pra renderização somente-leitura
(a visualização de issue não precisa do editor inteiro carregado, só do
resultado). Os kits de plugin (`basic-nodes`, `list`, `code-block`, `indent`)
plugam o comportamento de edição; o styling vem alinhado ao shadcn desde o
início, não por cima.

### O mecanismo, lado a lado: o mesmo botão de negrito

O botão de "negrito" no bubble menu do tiptap era isto — um `Button` do
shadcn por baixo, mas o estado ativo controlado inteiramente à mão:

```tsx
function ToggleButton({ icon, active, onClick }: {
  icon: IconType
  active: boolean
  onClick: () => void
}) {
  return (
    <Button type='button' variant={active ? 'secondary' : 'ghost'} size='icon-sm' onClick={onClick}>
      <NexoIcon icon={icon} strokeWidth={2} />
    </Button>
  )
}

// no bubble menu:
<ToggleButton
  icon={TextBoldIcon}
  active={editor.isActive('bold')}
  onClick={() => editor.chain().focus().toggleBold().run()}
/>
```

Funciona — mas `active` é passado manualmente em cada chamada, e o elemento
final é um `<button>` sem `aria-pressed` nem `role` nenhum: pra tecnologia
assistiva, é indistinguível de um botão comum, mesmo estando "ativado".

O equivalente no Plate é o `MarkToolbarButton`:

```tsx
export function MarkToolbarButton({ clear, nodeType, ...props }: ...) {
  const state = useMarkToolbarButtonState({ clear, nodeType })
  const { props: buttonProps } = useMarkToolbarButton(state)
  return <ToolbarButton {...props} {...buttonProps} />
}
```

O estado não é passado à mão — vem de um hook (`useMarkToolbarButtonState`)
que já sabe consultar a seleção atual do editor. E `ToolbarButton`, por
baixo, não é um `<button>` solto: quando recebe um `pressed` booleano, ele
resolve pra um `ToolbarToggleItem` dentro de um `ToolbarToggleGroup` — os
primitivos de toggle-group do Radix, que dão `role`/estado pressionado e
navegação por seta do teclado entre os itens do toolbar de graça, porque é
assim que o primitivo é desenhado, não porque alguém lembrou de adicionar.
A mesma lógica se repete no combobox de linguagem do bloco de código
(`code-block-node.tsx`), que já nasce com `role="combobox"` e
`aria-expanded` vindo do `Popover` do Radix por baixo — nenhuma dessas
duas linhas foi escrita à mão neste projeto.

## Resultados

| Métrica | tiptap (removido) | Plate (atual) |
|---|---|---|
| Linhas de UI do editor | 1.468 (18 arquivos) | 1.957 (25 arquivos) |
| `aria-*`/`role=` no menu de seleção | **0** | `role="button"`, `role="menuitem"`, `aria-checked`, `aria-expanded` |
| Alinhamento visual com shadcn/ui | Nenhum (estilo próprio) | Direto — mesmos tokens (`hover:bg-muted`, `focus-visible:ring-ring/50`) |
| Migração completa (57 arquivos) | — | 2.460 inserções / 1.522 deleções |

Mais linhas de código no total — o Plate não é "menos código", é "o código
certo pago uma vez pelo framework em vez de reescrito por mim". A diferença
que importa não é a contagem de linhas, é o que essas linhas fazem: o
`toolbar.tsx` novo (363 linhas) tem semântica de acessibilidade real embutida
desde a primeira versão, porque herda de Radix — o `bubble-menu.tsx` antigo
(174 linhas) não tinha nenhuma, porque construir isso do zero é um projeto
à parte que eu nunca tinha priorizado.

Tem um resultado funcional aqui além do de acessibilidade, e é o que mais
ataca a dor original de "sempre tinha problema de funcionalidade": no
tiptap, `active={editor.isActive('bold')}` era plumbing manual em **cada**
botão — cinco marks diferentes no bubble menu, cinco lugares
independentes pra manter a string do nome da mark certa e o `onClick`
certo em sincronia. No Plate, `useMarkToolbarButtonState` centraliza essa
consulta num hook reusado por todo botão de mark — não existe mais um
lugar novo pra plumbar estado a cada botão que eu adiciono, porque o botão
não guarda estado próprio, consulta o hook. Isso não aparece numa métrica
de linhas, mas é exatamente a classe de bug (uma das três frentes — função,
visual, acessibilidade — quebrando quando eu mexia noutra) que motivou a
troca inteira: menos lugares pra esse tipo de dessincronia acontecer, não
zero garantido, mas estruturalmente menos.

## Onde quebrou — a migração não terminou

O tiptap não saiu da Nexo. `grep` no código hoje ainda mostra sete arquivos
importando de `@tiptap/*`: o editor dos **sticky notes** de usuário
(`app/_components/user/sticky/user-sticky.tsx`) e o formato de conteúdo dos
**comentários** (`src/mappers/comment.mapper.ts`, `types/comment.d.ts`)
continuam no tiptap antigo. `@tiptap/react`, `@tiptap/starter-kit` e as
extensões de task list ainda estão no `package.json`.

A ordem não foi acidente: comecei pela superfície de maior uso e maior
risco de UI — descrição de issue, onde os problemas de acessibilidade e
desalinhamento visual mais apareciam — e sticky notes e comentários vêm em
seguida, ainda em andamento no momento em que escrevo isso. São superfícies
menores, com menos chrome (sem bubble menu elaborado, sem slash command),
então o risco de ficarem pra trás por mais tempo é menor do que era pra
descrição de issue. Mas até essa migração terminar, o `package.json` carrega
duas dependências de editor de texto rico ao mesmo tempo — exatamente o
tipo de estado intermediário que precisa de prazo, não só de intenção.

## O que isso prova, e o que não prova

Isso prova, com número real de acessibilidade e não impressão visual, que
trocar de framework de editor resolveu um problema estrutural específico:
interface headless sem investimento dedicado de acessibilidade vira
interface sem acessibilidade nenhuma, não porque alguém decidiu isso, mas
porque ninguém constrói `aria-activedescendant` por acidente. Um framework
que já vem alinhado ao seu sistema de design entrega isso como propriedade
do framework, não como projeto separado que compete por prioridade com todo
o resto.

Não prova que o Plate é melhor que o tiptap em geral, nem que headless é
uma escolha errada — prova que era a escolha errada **pra esse caso
específico**, onde acessibilidade e alinhamento visual com um design system
já existente eram requisito, não extra. E não prova que a migração está
completa: dois editores de texto rico convivendo no mesmo `package.json`
é o estado real da Nexo hoje, não um detalhe secundário deixado de fora do
resumo.
