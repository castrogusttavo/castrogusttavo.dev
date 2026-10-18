---
title: Colaboração em tempo real com Yjs no Plate, e os bugs que a documentação não avisa
description: "Depois de trocar o tiptap pelo Plate na descrição de issue, a wiki da Nexo nasceu no Plate já com edição colaborativa: @platejs/yjs, Hocuspocus self-hosted e Redis pub/sub. Adicionar o plugin não conectou nada, apagar tudo derrubava o editor, o redo nunca habilitava e os menus copiados do registry falavam Radix num projeto que usa Base UI. Isto é cada causa raiz, e o bug que continua aberto: o cursor remoto até hoje não aparece."
icon: code
date: "2026-12-08"
---

Adicionei o `YjsPlugin` no array de plugins do editor da wiki, abri uma página,
escrevi o título e procurei onde digitar o corpo. Não tinha. A área de edição
simplesmente não aparecia, até eu clicar em algum botão da toolbar. Depois do
primeiro conserto o sintoma mudou de forma: dando F5 na página, o editor às
vezes subia sozinho, às vezes não, sem padrão entre uma tentativa e outra.

No [post anterior](/pt/writing/tiptap-to-platejs) contei por que troquei o
tiptap pelo Plate na descrição de issue da Nexo. A wiki veio depois e já
nasceu no Plate, com um requisito que a descrição de issue não tinha: duas
pessoas editando a mesma página ao mesmo tempo. A pilha é `@platejs/yjs` no
cliente, um servidor Hocuspocus self-hosted (o processo `realtime`) e a
extensão Redis do Hocuspocus fazendo pub/sub entre instâncias.

Fiz a colaboração como Fase 1 do plano da wiki, antes do resto da toolbar,
de propósito: trocar o autosave por um documento Yjs no meio do caminho seria
retrabalho. Os cinco commits da fase entraram no mesmo dia, 30 de agosto. No
QA manual da fase seguinte, também no dia 30, apareceram os bugs deste post.

## O problema: o documento deixa de ser do React

Num editor Plate sem colaboração, o documento é um `value` que o React
conhece: entra como prop, sai pelo `onChange`, e o Plate cuida do resto
(normalização, histórico, renderização) do jeito padrão do Slate.

Com Yjs, a fonte da verdade passa a ser um documento CRDT que chega por
WebSocket, de forma assíncrona, depois que a árvore React já montou. Cada
peça do editor que assumia o Slate puro passa a estar errada de um jeito
diferente: quem inicializa o documento, quem garante que ele nunca fica
vazio, quem guarda o histórico de undo. Nenhuma dessas trocas gera erro de
tipo. Elas aparecem como comportamento estranho, e o comportamento estranho
de cada uma se parece com o de outra.

## A ideia: ler o código instalado, não adivinhar a API

A regra que acabou resolvendo todos os bugs foi a mesma: quando o sintoma não
batia com a documentação, abrir o código do pacote instalado em
`node_modules` (o `.js` de verdade, o `.d.ts` de verdade) em vez de testar
hipótese por tentativa e erro. Pelo menos três das causas raiz abaixo só
foram encontradas assim.

## Como funciona, bug por bug

### 1. O plugin registrado não conecta nada

Eram três causas encadeadas na mesma área, e cada conserto revelava a próxima.

A primeira: **ninguém chamava `yjs.init()`**. Registrar o `YjsPlugin` não abre
conexão nem hidrata o documento. É preciso chamar
`editor.getApi(YjsPlugin).yjs.init({ id, value })` num efeito, com
`yjs.destroy()` no cleanup, como a documentação do Plate mostra.

A segunda: o **Strict Mode** do React roda montar, desmontar e montar de novo
em dev. Sem guarda, o `destroy()` do primeiro ciclo fantasma corrompia o
`init()` do segundo. A guarda é um hook pequeno:

```ts
export function useMounted() {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  return mounted
}
```

A terceira, que era a do "às vezes sobe, às vezes não": **o sync bem-sucedido
não re-renderizava a árvore.** O `onSyncChange` reportava `true`, o documento
estava hidratado, e a área editável continuava mostrando o estado de antes. O
`editor.tf.init()` que o `yjs.init()` chama por dentro nem sempre propaga o
novo `editor.children` pra árvore React sozinho. A correção (commit `0cd59b9`)
transforma o sync num estado React e usa esse estado como `key`, forçando o
remount quando o sync termina:

```tsx
const [isSynced, setIsSynced] = useState(false)
// ...
<EditorContainer
  key={isSynced ? 'synced' : 'pending'}
  className='min-h-0 flex-1 no-scrollbar'
>
```

O mesmo commit ainda adia o `init()` até o `load` da página: abrir o WebSocket
enquanto fontes, HMR e scripts ainda disputavam conexão fazia o navegador
derrubar a conexão com "interrupted while the page was loading".

### 2. Ctrl+A, Del, e o corpo some

Selecionar tudo e apagar fazia o editor sumir: sobrava o título, o corpo
desaparecia, e o console mostrava `can't access property text of undefined`.

Num Plate comum, isso não acontece porque a normalização reinsere um
parágrafo vazio quando o documento fica sem nenhum bloco. A causa estava no
`yjs.init()` instalado (`@platejs/yjs` 53.2.0), que inicializa o editor assim:

```js
YjsEditor.connect(editor);
editor.tf.init({
  autoSelect,
  selection,
  shouldNormalizeEditor: false,
  value: null
});
```

`shouldNormalizeEditor: false`. A rede de segurança contra documento vazio
deixa de estar garantida em todos os caminhos, e apagar tudo de uma vez
deixava um `value` vazio, inválido para o Slate. A correção é uma guarda no
`onChange`: se o valor chegou vazio, insere um parágrafo e não propaga nada
pro autosave.

```tsx
onChange={({ value }) => {
  if (value.length === 0) {
    editor.tf.insertNodes(editor.api.create.block({ type: KEYS.p }), {
      at: [0],
    })
    return
  }
  onChange(value)
}}
```

### 3. O redo que nunca habilita

O undo funcionava. O redo ficava desabilitado pra sempre, mesmo depois de
vários undos.

O `@platejs/yjs` aplica `withTYHistory`, que **sobrescreve `editor.undo` e
`editor.redo`** para rotear por um `Y.UndoManager`, exposto como
`editor.undoManager` com `undoStack` e `redoStack`. O histórico padrão do
Slate, `editor.history.undos`/`redos`, para de refletir o estado real. E o
botão de redo lia `editor.history.redos.length`, que nunca era populado.
Confirmei lendo o tipo `YHistoryEditor` no source instalado. A correção
(commit `d7f26ec`) lê a pilha do Yjs quando ela existe:

```ts
const yUndoManager = editor.undoManager as
  | { undoStack: unknown[]; redoStack: unknown[] }
  | undefined
if (yUndoManager) {
  return kind === 'undo'
    ? yUndoManager.undoStack.length
    : yUndoManager.redoStack.length
}
return kind === 'undo' ? editor.history.undos.length : editor.history.redos.length
```

### 4. Base UI não é Radix

No post anterior escrevi que o toolbar do Plate roda em cima de Radix, e
continua: `@radix-ui/react-toolbar` e `@radix-ui/react-tooltip` estão no
`package.json`. Mas os componentes de menu do kit de UI da Nexo
(`dropdown-menu.tsx`, `context-menu.tsx`) são **Base UI** (`@base-ui/react`),
e o registry oficial do Plate gera código para Radix por padrão. Isso não
estava escrito em lugar nenhum do projeto, e só descobri depurando.

A sequência de erros ao colar componentes do registry foi longa, e cada um
era uma diferença deliberada de API:

- não existe `asChild`; o Base UI usa `render={<Elemento />}`;
- não existe `DropdownMenuItemIndicator`; `RadioItem` e `CheckboxItem` já
  desenham o indicador;
- não existe `onCloseAutoFocus`; o foco pós-fechamento é `finalFocus`, ou
  lógica no `onOpenChange`;
- atributos de dado são por presença (`data-checked`, `data-open`), não por
  valor (`data-state="checked"` é só Radix);
- trigger com `render` apontando pra algo que não é `<button>` precisa de
  `nativeButton={false}`, senão o console avisa que esperava um `<button>`
  nativo (commit `166dd6a`, nos botões de tamanho de fonte e de lista);
- `ContextMenu.Root` não aceita `modal`.

O pior foi o menu de contexto por bloco. Ele precisa abrir a partir de um
estado externo do Plate (`usePluginOption`), e eu tentei controlá-lo com
`open={isOpen}`. Abria uma vez, o React reclamava de componente controlado
virando não controlado, e depois o menu ficava preso aberto ou parava de
abrir. O estado do Plate não é síncrono o bastante para o invariante de
componente controlado.

A saída foi parar de inventar. Rodei `npx shadcn@latest add <componente> -b base`
num projeto descartável fora do repo, que gera a tradução oficial do
componente para Base UI, e copiei o padrão: `ContextMenu` **totalmente não
controlado**, `onOpenChange` só para efeito colateral, e o conteúdo montado
com um `{isOpen && (...)}` simples (commit `b78cca7`):

```tsx
<ContextMenu
  onOpenChange={(open) => {
    if (!open) {
      api.blockMenu.hide()
    }
  }}
>
```

Quando existe um padrão oficial e eu não sei qual é, gerar o padrão oficial
num projeto de teste custa um minuto. Adivinhar custou uma tarde.

### 5. Os dois bugs que não eram do editor

O WebSocket do cliente para o `realtime` era bloqueado pelo navegador. O
`connect-src` da CSP em `proxy.ts` só tinha um `ws://localhost:4444` fixo, de
um processo antigo de dev, e não a URL real do serviço. A correção
(commit `ce2ee58`) passou a incluir `NEXT_PUBLIC_REALTIME_URL` sempre. Todo
serviço que o navegador acessa diretamente precisa estar na CSP, não só no
`.env` e no `docker-compose.yml`.

E o processo `realtime` estourava `MaxRetriesPerRequestError` ao encerrar. A extensão
Redis do Hocuspocus tinha sido configurada só com `{ host, port }`, e o Redis
da Nexo exige TLS e senha. A conexão tentava, falhava na autenticação e
tentava de novo até o limite. O campo certo, `options` aceitando as
`RedisOptions` nativas do `ioredis`, só apareceu lendo o `.d.ts` do pacote
instalado:

```ts
options: {
  password: redisUrl.password || undefined,
  ...(REDIS_TLS_ENABLED && {
    tls: REDIS_TLS_CA_PATH
      ? { ca: readFileSync(REDIS_TLS_CA_PATH) }
```

## Resultados

| Sintoma | Causa raiz | Correção |
|---|---|---|
| Corpo do editor não aparece / sobe às vezes | `yjs.init()` nunca chamado; Strict Mode; sync sem re-render | `0cd59b9`: efeito com `useMounted`, `isSynced` como `key` |
| Ctrl+A → Del derruba o editor | `yjs.init()` inicializa com `shouldNormalizeEditor: false` | `0cd59b9`: guarda que insere parágrafo vazio |
| Redo nunca habilita | `withTYHistory` move o histórico para `editor.undoManager` | `d7f26ec`: lê a pilha do `Y.UndoManager` |
| Avisos de `nativeButton` | trigger Base UI com `render` não-`<button>` | `166dd6a` |
| Menu de contexto preso aberto | `ContextMenu` controlado contra estado assíncrono | `b78cca7`: padrão oficial não controlado |
| WebSocket bloqueado | `connect-src` sem a URL do `realtime` | `ce2ee58` |
| `MaxRetriesPerRequestError` | Redis sem TLS nem senha | `options` do `ioredis` |

Sete sintomas, e nenhum deles era um erro de tipo. O TypeScript pegou parte
dos problemas de Base UI (`modal` inválido, `ItemIndicator` inexistente), mas
os quatro bugs do editor em si compilavam limpo.

O que faltava naquele dia era teste. O editor da wiki só monta depois que o
Yjs conecta ao Hocuspocus, e a suíte de navegador não subia o servidor
`realtime`, então o spec da wiki só conseguia checar o título. O corpo do
editor não tinha nenhum teste de navegador. Isso mudou em 21 de setembro: o
commit `e7bcf19` fez o Playwright subir o mesmo bundle que roda em produção
(`node dist/realtime.cjs`, reconstruído a cada execução, meio segundo) e
acrescentou dois specs: texto digitado no corpo sobrevive a um reload
(esperando o autosave e o estado Yjs gravado conterem o texto), e um bloco
Excalidraw inserido pelo menu de barra renderiza sem violação de CSP. Esse
segundo é o teste de regressão do `fc78ddc`, do mesmo dia: as fontes do
Excalidraw vinham do `esm.sh`, a CSP só aceita fonte de `'self'`, e o canvas
caía em outra fonte sem avisar. Hoje o build copia os 234 arquivos de fonte do
pacote instalado para a origem do próprio Nexo.

## Onde quebrou: o cursor remoto não aparece

Com duas contas editando a mesma página, o texto sincroniza em tempo real.
Mas nenhuma das duas vê o cursor nem a seleção da outra. Não há erro de
console. Revisei o histórico do repositório até hoje e não existe commit que
corrija isso: o bug continua aberto.

A investigação ficou parada um tempo, e o motivo foi uma escolha de
prioridade, não um descuido: o menu de contexto travando passou na frente.
As hipóteses que anotei naquele dia
eram três: algo removido ao adaptar o `cursor-overlay.tsx` do registry (tirei
as dependências de `@platejs/ai` e `@platejs/table`), o awareness do
Hocuspocus não propagar os dados do cursor, ou o overlay ser desenhado e
ficar invisível por CSS.

Lendo o código de novo para escrever este post, apareceu uma quarta. O que
está montado no editor é
o `CursorOverlayPlugin` do `@platejs/selection`, cujo `useCursorOverlay()`
desenha os cursores guardados no próprio estado do plugin. No projeto de
referência do Plate, esse overlay serve à seleção local e ao arrastar. Do
outro lado, o `YjsPlugin` com a opção `cursors` envolve o editor com
`withTCursors`, que publica a posição local no awareness. E nada no
repositório lê o estado de awareness dos **outros** clientes para desenhar.
O awareness em si funciona: os comentários em tempo real da wiki
(`1501f25`) usam esse mesmo canal, e o listener deles foi escrito
justamente para ignorar o fluxo constante de posição de cursor.

Essa eu verifiquei, com duas sessões locais: o awareness chega, nada
desenha. A sessão B recebe pelo WebSocket **29** frames de awareness com
`{name, color}` e a seleção de A em posições relativas do Yjs. E o DOM do
editor de B é idêntico antes e depois de A selecionar o texto, sem nenhum
caret remoto. O bug continua aberto, mas agora com causa conhecida. O
conserto está planejado junto com as próximas mudanças da wiki: um overlay
de cursor remoto que leia o awareness dos outros clientes, e a normalização
do matiz negativo em `colorFromUserId`, que hoje pode gerar uma cor como
`hsl(-245…)`.

A segunda limitação é custo do meu próprio conserto. Forçar o remount com
`key={isSynced ? ...}` descarta o que foi digitado antes do primeiro sync: o
editor pendente é substituído pelo sincronizado. O commit `fc78ddc` registra
isso e expôs `data-sync-state` no container para os testes esperarem o sync
em vez de esperar tempo. Para os testes, resolvido. Para um usuário numa
conexão lenta que começa a digitar rápido, não.

## O que isso prova, e o que não prova

Prova que integrar Yjs ao Plate não é "adicionar um plugin": o plugin troca,
por baixo, a inicialização, a normalização e o histórico do editor, e cada
lugar do código que lia o Slate padrão precisa ser revisto. Prova também que,
nesses bugs, ler o código instalado foi mais rápido do que qualquer outra
estratégia: `shouldNormalizeEditor: false`, `editor.undoManager` e o
`options` do Redis estavam escritos no `node_modules`, não na documentação.

Não prova que a colaboração da wiki está completa. Texto sincroniza, e
existe um teste de navegador que garante que ele sobrevive a um reload. Mas
colaboração sem ver onde o outro está editando é colaboração pela metade, e
esse é o estado real da wiki hoje. Também não prova que os consertos são os
melhores possíveis: o remount por `key` resolveu o sintoma e criou um custo
novo, e a guarda de documento vazio cobre o caminho que eu achei, não
necessariamente todos.
