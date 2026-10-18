---
title: Real-time collaboration with Yjs in Plate, and the bugs the docs don't warn you about
description: "After swapping tiptap for Plate in issue descriptions, Nexo's wiki was born on Plate with collaborative editing from day one: @platejs/yjs, self-hosted Hocuspocus and Redis pub/sub. Adding the plugin connected nothing, deleting everything crashed the editor, redo never enabled, and the menus copied from the registry spoke Radix in a project that uses Base UI. This is each root cause, and the bug still without one: the remote cursor doesn't show up."
icon: code
date: "2026-12-08"
---

I added `YjsPlugin` to the wiki editor's plugin array, opened a page, typed a
title and looked for where to write the body. There wasn't one. The editing
area just didn't appear until I clicked some toolbar button. After the first
fix the symptom changed shape: on F5, the editor sometimes came up on its
own and sometimes didn't, with no pattern between attempts.

In the [previous post](/en/writing/tiptap-to-platejs) I explained why I
swapped tiptap for Plate in Nexo's issue descriptions. The wiki came later
and was born on Plate, with a requirement issue descriptions never had: two
people editing the same page at once. The stack is `@platejs/yjs` on the
client, a self-hosted Hocuspocus server (the `realtime` process), and
Hocuspocus's Redis extension doing pub/sub across instances.

I built collaboration as Phase 1 of the wiki plan, before the rest of the
toolbar, on purpose: swapping autosave for a Yjs document halfway through
would mean redoing work. The phase's five commits landed on the same day,
August 30. Manual QA of the next phase, also on the 30th, surfaced the bugs
in this post.

## The problem: the document stops belonging to React

In a Plate editor without collaboration, the document is a `value` React
knows about: in as a prop, out through `onChange`, and Plate handles the rest
(normalisation, history, rendering) the standard Slate way.

With Yjs, the source of truth becomes a CRDT document arriving over a
WebSocket, asynchronously, after the React tree has already mounted. Every
part of the editor that assumed plain Slate becomes wrong in its own way: who
initialises the document, who guarantees it's never empty, who keeps the undo
history. None of these swaps produces a type error. They show up as odd
behaviour, and each one's odd behaviour looks like another's.

## The idea: read the installed code, don't guess the API

The rule that ended up solving every bug was the same: when the symptom
didn't match the docs, open the installed package's code in `node_modules`
(the real `.js`, the real `.d.ts`) instead of testing guesses by trial and
error. At least three of the root causes below were only found that way.

## How it works, bug by bug

### 1. A registered plugin connects nothing

Three chained causes in the same spot, each fix exposing the next.

First: **nobody called `yjs.init()`**. Registering `YjsPlugin` opens no
connection and hydrates no document. You have to call
`editor.getApi(YjsPlugin).yjs.init({ id, value })` in an effect, with
`yjs.destroy()` in the cleanup, as Plate's docs show.

Second: React's **Strict Mode** mounts, unmounts and mounts again in dev.
Unguarded, the phantom first cycle's `destroy()` corrupted the second
`init()`. The guard is a small hook:

```ts
export function useMounted() {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  return mounted
}
```

Third, the "sometimes it comes up" one: **a successful sync didn't re-render
the tree.** `onSyncChange` reported `true`, the document was hydrated, and
the editable area kept showing the previous state. The `editor.tf.init()`
that `yjs.init()` calls internally doesn't always push the new
`editor.children` into the React tree by itself. The fix (commit `0cd59b9`)
turns sync into React state and uses it as a `key`, forcing a remount when
sync completes:

```tsx
const [isSynced, setIsSynced] = useState(false)
// ...
<EditorContainer
  key={isSynced ? 'synced' : 'pending'}
  className='min-h-0 flex-1 no-scrollbar'
>
```

The same commit also defers `init()` until the page's `load` event: opening
the WebSocket while fonts, HMR and scripts were still competing for
connections made the browser drop it with "interrupted while the page was
loading".

### 2. Ctrl+A, Del, and the body vanishes

Select all and delete, and the editor disappeared: the title stayed, the body
was gone, and the console said `can't access property text of undefined`.

In regular Plate this can't happen because normalisation reinserts an empty
paragraph when the document has no blocks left. The cause was in the
installed `yjs.init()` (`@platejs/yjs` 53.2.0), which initialises the editor
like this:

```js
YjsEditor.connect(editor);
editor.tf.init({
  autoSelect,
  selection,
  shouldNormalizeEditor: false,
  value: null
});
```

`shouldNormalizeEditor: false`. The empty-document safety net is no longer
guaranteed on every path, and deleting everything at once left an empty
`value` Slate considers invalid. The fix is a guard in `onChange`: if the
value arrives empty, insert a paragraph and propagate nothing to autosave.

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

### 3. Redo that never enables

Undo worked. Redo stayed disabled forever, even after several undos.

`@platejs/yjs` applies `withTYHistory`, which **overrides `editor.undo` and
`editor.redo`** to route through a `Y.UndoManager`, exposed as
`editor.undoManager` with `undoStack` and `redoStack`. Slate's standard
history, `editor.history.undos`/`redos`, stops reflecting reality. And the
redo button read `editor.history.redos.length`, which was never populated. I
confirmed it by reading the `YHistoryEditor` type in the installed source.
The fix (commit `d7f26ec`) reads the Yjs stack when it exists:

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

### 4. Base UI is not Radix

In the previous post I wrote that Plate's toolbar runs on Radix, and it still
does: `@radix-ui/react-toolbar` and `@radix-ui/react-tooltip` are in
`package.json`. But the menu components in Nexo's UI kit
(`dropdown-menu.tsx`, `context-menu.tsx`) are **Base UI** (`@base-ui/react`),
and Plate's official registry generates Radix code by default. That wasn't
written down anywhere in the project; I found out while debugging.

The chain of errors from pasting registry components was long, and each one
was a deliberate API difference:

- no `asChild`; Base UI uses `render={<Element />}`;
- no `DropdownMenuItemIndicator`; `RadioItem` and `CheckboxItem` draw it
  themselves;
- no `onCloseAutoFocus`; focus after close is `finalFocus`, or logic in
  `onOpenChange`;
- data attributes are presence-based (`data-checked`, `data-open`), not
  value-based (`data-state="checked"` is Radix only);
- a trigger whose `render` isn't a `<button>` needs `nativeButton={false}`,
  or the console warns it expected a native `<button>` (commit `166dd6a`, on
  the font size and list buttons);
- `ContextMenu.Root` doesn't accept `modal`.

The worst was the per-block context menu. It has to open from external Plate
state (`usePluginOption`), and I tried to control it with `open={isOpen}`. It
opened once, React complained about a controlled component turning
uncontrolled, and then the menu got stuck open or stopped opening. Plate's
state isn't synchronous enough for the controlled-component invariant.

The way out was to stop inventing. I ran
`npx shadcn@latest add <component> -b base` in a throwaway project outside
the repo, which generates the official Base UI translation, and copied the
pattern: a **fully uncontrolled** `ContextMenu`, `onOpenChange` for side
effects only, and the content mounted with a plain `{isOpen && (...)}`
(commit `b78cca7`):

```tsx
<ContextMenu
  onOpenChange={(open) => {
    if (!open) {
      api.blockMenu.hide()
    }
  }}
>
```

When an official pattern exists and I don't know it, generating it in a
scratch project takes a minute. Guessing took an afternoon.

### 5. The two bugs that weren't the editor's

The client's WebSocket to `realtime` was blocked by the browser. The CSP's
`connect-src` in `proxy.ts` only had a hardcoded `ws://localhost:4444`, left
over from an old dev process, not the service's real URL. The fix (commit
`ce2ee58`) always includes `NEXT_PUBLIC_REALTIME_URL`. Any service the
browser talks to directly has to be in the CSP, not just in `.env` and
`docker-compose.yml`.

And the `realtime` process hit `MaxRetriesPerRequestError` on shutdown. The
Hocuspocus Redis extension had been configured with just `{ host, port }`,
and Nexo's Redis requires TLS and a password. The connection tried, failed
auth, and retried until the limit. The right field, `options` taking
`ioredis`'s native `RedisOptions`, only turned up by reading the installed
package's `.d.ts`:

```ts
options: {
  password: redisUrl.password || undefined,
  ...(REDIS_TLS_ENABLED && {
    tls: REDIS_TLS_CA_PATH
      ? { ca: readFileSync(REDIS_TLS_CA_PATH) }
```

## Results

| Symptom | Root cause | Fix |
|---|---|---|
| Editor body missing / sometimes mounts | `yjs.init()` never called; Strict Mode; sync without re-render | `0cd59b9`: effect behind `useMounted`, `isSynced` as `key` |
| Ctrl+A → Del crashes the editor | `yjs.init()` initialises with `shouldNormalizeEditor: false` | `0cd59b9`: guard inserting an empty paragraph |
| Redo never enables | `withTYHistory` moves history to `editor.undoManager` | `d7f26ec`: read the `Y.UndoManager` stack |
| `nativeButton` warnings | Base UI trigger with a non-`<button>` `render` | `166dd6a` |
| Context menu stuck open | `ContextMenu` controlled against async state | `b78cca7`: official uncontrolled pattern |
| WebSocket blocked | `connect-src` missing the `realtime` URL | `ce2ee58` |
| `MaxRetriesPerRequestError` | Redis without TLS or password | `ioredis` `options` |

Seven symptoms, none of them a type error. TypeScript caught part of the Base
UI problems (invalid `modal`, missing `ItemIndicator`), but the four editor
bugs themselves compiled clean.

What that day lacked was tests. The wiki editor only mounts after Yjs
connects to Hocuspocus, and the browser suite didn't start the `realtime`
server, so the wiki spec could only check a title. The editor body had no
browser test at all. That changed on September 21: commit `e7bcf19` made
Playwright boot the same bundle production runs (`node dist/realtime.cjs`,
rebuilt every run, half a second) and added two specs: text typed into the
body survives a reload (waiting for the autosave and the stored Yjs state to
contain it), and an Excalidraw block inserted from the slash menu renders
with no CSP violation. The second is the regression test for `fc78ddc`, from
the same day: Excalidraw's fonts came from `esm.sh`, the CSP only allows
fonts from `'self'`, and the canvas silently fell back to other faces. The
build now copies the installed package's 234 font files to our own origin.

## Where it broke: the remote cursor doesn't show up

With two accounts editing the same page, text syncs in real time. But
neither sees the other's cursor or selection. No console error. I went
through the repo's history up to today and no commit fixes it: the bug is
still open.

The root cause is undetermined, and that's a priority call, not an
oversight: I paused the investigation when the stuck context menu jumped the
queue, and never came back to it. The hypotheses I wrote down that day were
three: something removed while adapting `cursor-overlay.tsx` from the
registry (I stripped its `@platejs/ai` and `@platejs/table` dependencies),
Hocuspocus awareness not propagating cursor data, or the overlay being drawn
but invisible through CSS.

Re-reading the code for this post, a different hypothesis got stronger, and
I haven't verified it by running anything. What's mounted in the editor is
`CursorOverlayPlugin` from `@platejs/selection`, whose `useCursorOverlay()`
draws cursors kept in the plugin's own state. In Plate's reference project
that overlay serves the local selection and dragging. On the other side,
`YjsPlugin` with the `cursors` option wraps the editor in `withTCursors`,
which publishes the local position to awareness. And nothing in the repo
reads the **other** clients' awareness state to draw it. Awareness itself
works: the wiki's real-time comments (`1501f25`) ride that same channel, and
their listener was written specifically to ignore the constant stream of
cursor positions. If the hypothesis holds, the data reaches every client and
no component draws it. I'll only know by opening two sessions and inspecting
awareness in devtools.

The second limitation is a cost of my own fix. Forcing a remount with
`key={isSynced ? ...}` throws away whatever was typed before the first sync:
the pending editor is replaced by the synced one. Commit `fc78ddc` records
this and exposes `data-sync-state` on the container so tests wait for sync
instead of for time. For tests, solved. For a user on a slow connection who
starts typing fast, not.

And some noise is left: the `connected`, `disconnected` and `sync change`
`console.log` calls I added to `yjs-kit.tsx` while debugging bug 1 are still
there.

## What this proves, and what it doesn't

It proves that integrating Yjs into Plate isn't "adding a plugin": the
plugin swaps, underneath, the editor's initialisation, normalisation and
history, and every place in the code that read standard Slate needs another
look. It also proves that, for these bugs, reading the installed code beat
every other strategy: `shouldNormalizeEditor: false`, `editor.undoManager`
and Redis's `options` were written in `node_modules`, not in the docs.

It doesn't prove the wiki's collaboration is complete. Text syncs, and a
browser test guarantees it survives a reload. But collaboration without
seeing where the other person is editing is half of it, and that's the
wiki's real state today. Nor does it prove these fixes are the best
possible: the `key` remount solved the symptom and created a new cost, and
the empty-document guard covers the path I found, not necessarily all of
them.
