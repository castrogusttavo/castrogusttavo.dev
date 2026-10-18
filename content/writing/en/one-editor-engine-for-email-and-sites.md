---
title: One editor engine for email and sites — Steel Canvas and the co-editing on top of it
description: "The ask was total freedom: drag components, click and edit everything in a side panel, for email on React Email and for sites at Wix and WordPress level. Two editors would duplicate selection, drag and drop, history, layers, inspector, shortcuts — and each one's bugs. This is the single engine that came out of it: a normalized document, pure operations with inverses, a catalog that declares and an engine that executes, and how Yjs co-editing was fitted in without giving up any catalog rule."
icon: code
date: "2026-11-26"
---

Steel's CRM email editor was a locked structure: you picked a template and
swapped text and images inside the sections it came with. Landing pages,
same thing. The product owner wanted the opposite: a sidebar with the
available components, drag and build 100% of the page, click a component
and the right panel becomes its full edit menu. For email, on React
Email. For sites, in the words recorded in ADR 0026, "full drag-and-drop —
like Wix and WordPress", with multiple pages, a blog and custom domains.

Steel is Stratus Telecom's multi-tenant platform — ITIL 4 ServiceDesk,
CRM, Communication/WhatsApp, and Steel AI on top of the three. I'm a Lead
Software Engineer at Stratus Telecom: I built the first version of Steel
and now lead its technical modernization. This post covers two
architecture decisions: ADR 0026, which created Steel Canvas, and ADR
0027, which put real-time co-editing on top of it.

## The problem: two editors, the same bugs twice

Email and sites look like different products, and their output is: an
email has to survive Outlook with nested tables, a site needs responsive
CSS and scripts. But the **editor** is the same problem in both. Select a
node. Drag from the palette and drop between two siblings, refusing
invalid targets. Undo and redo. A layers tree with rename, hide and lock.
A tabbed inspector. Copy, paste, duplicate, keyboard shortcuts.

Building that twice duplicates every piece — and, worse, every bug. The
classic visual-editor bug is the undo that restores half a drag, or the
paste that lands in a container that shouldn't accept that child. With
one editor each of those gets fixed once. With two, it gets fixed twice,
two different ways, and one of them comes back.

## The idea: the engine doesn't know what an email is

ADR 0026 decides on a **shared editing engine** (`src/lib/canvas/`, shell
in `app/_components/canvas/`) and a **component catalog per target**. The
email catalog renders with React Email; the site catalog renders
responsive HTML/CSS. The engine knows neither — the comment at the top of
`types.ts` says it literally: "The engine knows nothing about e-mail or
HTML". Everything target-specific goes into the catalog as declarations;
everything editor-behavior stays in the engine. **The catalog declares,
the engine executes.**

## How it works

### A normalized document

The document isn't a nested tree. It's a flat node map plus the root id:

```ts
export interface CanvasDocument {
  catalog: string
  version: number
  rootId: CanvasNodeId
  nodes: Record<CanvasNodeId, CanvasNode>
}
```

Each node has a `type` (`email.button`, `site.section`), `props`,
`children` as a list of ids, and editor-only `meta` (layer name, hidden,
locked). Props are validated by the Zod schema the catalog registers for
that type. Normalized so that operations, history and — the ADR already
said this before co-editing existed — a future Yjs binding touch **one
node at a time**.

### Every change is a pure operation with an inverse

Nothing edits the document directly. Every change is a `CanvasOp`:

```ts
export type CanvasOp =
  | { kind: 'insert'; fragment: CanvasFragment; at: CanvasLocation }
  | { kind: 'remove'; id: CanvasNodeId }
  | { kind: 'move'; id: CanvasNodeId; to: CanvasLocation }
  | { kind: 'update'; id: CanvasNodeId; set: Record<string, unknown> }
  | { kind: 'meta'; id: CanvasNodeId; set: Partial<NonNullable<CanvasNode['meta']>> }
  | { kind: 'batch'; ops: CanvasOp[]; label?: string }
```

`applyOp(doc, op, catalog)` validates against the catalog, never throws,
and returns the new document **and the inverse op**. The inverse of a
`remove` is an `insert` of the subtree; the inverse of an `update` is
another `update` with the old values at the same paths. `batch` is all
or nothing. A refused op leaves the document untouched and returns why
(`NOT_ACCEPTED`, `MAX_CHILDREN`, `REQUIRED`, `UNIQUE`, `LOCKED`, `CYCLE`…),
which the shell shows in Portuguese.

The new document uses structural sharing: untouched nodes keep the same
object, and an op that changes nothing returns the same document — which
never enters history. That's what lets each node's `React.memo` work, and,
as we'll see, what makes co-editing cheap.

History stores operations, not snapshots. Up to **200** steps; consecutive
`update`s on the same node and paths within **500 ms** merge into one
step — typing a word or dragging a spacing slider is one undo, not forty:

```ts
// Same paths: the latest op alone describes the change; the first
// inverse still restores the values from before the burst.
top.forward = op
top.at = now
top.token = nextToken++
```

### The catalog declares

A component definition says what it accepts and where it can live, and
the engine enforces it: `accepts` and `parents`, `minChildren` and
`maxChildren`, `required` (can't be deleted — the email footer), `unique`
(one per document), and `inspector` — a **description** of the side
panel: sections on the Content, Style and Advanced tabs, each field with
a props path and a control kind (`spacing`, `typography`, `color`,
`link`, `list`…). No catalog builds its own form. `defineCatalog` also
checks at boot that every `accepts`/`parents` points at a registered
type — a broken catalog is a programming error, not a runtime condition.

### Responsive values that cascade

A responsive field stores `{ base, tablet?, mobile? }`. A breakpoint
without its own value inherits from the nearest larger one:

```ts
for (let i = CANVAS_BREAKPOINTS.indexOf(breakpoint); i > 0; i--) {
  const override = value[CANVAS_BREAKPOINTS[i]]
  if (override !== undefined) return override
}
return value.base
```

Email uses `base` + `mobile`; sites use all three.

### Real components in an iframe, handles on top

The canvas doesn't draw an imitation: it renders the catalog's **real**
components inside an iframe with isolated CSS. Outlines, handles,
selection and the blue drop line live in a layer on the parent document,
above the iframe, so they never reach the output. The only thing asked of
a catalog is to spread `attributes` (`data-canvas-id`) on each
component's outermost element; in the final output that object is empty.

Drop targets aren't per-node *droppables* either: on every move the
pointer is hit-tested in the iframe (`elementFromPoint`) or in the layers
tree, and the engine's `canDrop` decides. Drag and drop is `@dnd-kit`,
already installed, with a keyboard sensor: space picks up, arrows move,
space or Enter drops, Esc cancels. Sites use a **hybrid** layout: flow
(section → flex/grid container → elements) by default, optional free
positioning inside a container, per breakpoint, with alignment guides.

## Co-editing: Yjs without losing the catalog

The engine saved over REST with a 1.5 s autosave. Two people on the same
document overwrote each other. Steel's Wiki already edited in real time
with Yjs in its own process (Hocuspocus + Redis, behind `/realtime`), and
ADR 0027 chose **the same server and path**, with rooms
`canvas.<kind>.<id>` (`site-page`, `site-global`, `email-template`). The
Wiki uses the bare page id as its room; the prefix guarantees no
collision — and no new proxy rules.

The hard part isn't syncing bytes. Yjs is a CRDT: it always converges, but
to **whatever** state the sum of changes produces — and the catalog has
rules no CRDT knows about.

### The Yjs model, and why props are flat

The document becomes two top-level maps: `canvas.header` (catalog,
version, root) and `canvas.nodes` (id → `Y.Map` with `type`, `props`,
`children` as a `Y.Array` of ids, and `meta`). The decision that matters
most is `props`: a **flat map keyed by leaf path**, with `\u001f` (␟)
between segments — `style␟padding␟top`, not a `Y.Map` inside another.

A small example shows why. A button with props `{ label: 'Comprar' }`,
no `style` yet. At the same moment, Ana sets the top padding and Bruno
sets the color. With nested maps, each client has to **create** the
`style` object that doesn't exist yet:

```
Ana:   props.style = Y.Map { padding: Y.Map { top: 16 } }
Bruno: props.style = Y.Map { color: '#fff' }
```

Two concurrent writes to the same `style` key. Yjs resolves it like any
contested key: one value wins, deterministically, and the other map
vanishes whole. Someone loses an edit without having touched what the
other touched. With the flat map there's nothing to create:

```
Ana:   props['style␟padding␟top'] = 16
Bruno: props['style␟color']       = '#fff'
```

Different keys, no contest. On read, `unflatten` rebuilds
`{ label: 'Comprar', style: { padding: { top: 16 }, color: '#fff' } }`.
Two people editing the **same** path still get last-writer-wins, and
arrays and rich-text strings are whole leaves.

### Outbound: only the paths that changed

Every store change — op, undo, redo, reset — becomes **one** Yjs
transaction touching only the op's nodes (`touchedIds`) and, inside each,
only the props paths that changed. Structural sharing pays off again:
`syncProps` compares by identity before comparing by value, so a props
subtree that's the same object in both documents is skipped without
looking inside, and a path equal on both sides isn't rewritten — Yjs keeps
whatever it has, which may be someone else's newer value. Child lists get
the same treatment: `syncIds` keeps the common prefix and suffix and does
a single `delete` + `insert` on the part that differs.

### Inbound: projection into a valid document

Concurrent changes produce states no single op can: a node moved into two
parents at once, a child inserted into a section someone else removed, two
inserts that together exceed `maxChildren`. Yjs converges to those without
complaint. So the remote update isn't applied — it's **projected**.
`projectCanvas` does a deterministic walk from the root (pre-order, first
occurrence wins) that drops dangling and duplicate ids, children the
parent doesn't accept or beyond `maxChildren`, and nodes of unknown type
or with invalid props — those keep their **last good version** instead of
disappearing. The result enters the store through `applyRemote`, which
**records no history step**.

Since every client projects the same Yjs state with the same walk, they
all reach the same document. The test
`converges after random concurrent edits on three peers` exercises this:
three clients, 60 rounds of random updates, inserts, moves, removals,
undo and redo, syncing every three rounds, and the same document on all
three at the end.

### Per-user undo, without `Y.UndoManager`

Yjs ships its own undo manager. ADR 0027 kept the store's inverse-op
history instead: it holds only the user's own ops, and every undo goes
back through `applyOp` — it's **revalidated by the catalog**. A step that
no longer applies (someone else removed the node) is dropped, and the
steps below stay reachable. That covered a node that vanished, not a field
someone else rewrote afterwards — the hole and its fix are under "Where it
breaks".

### Persisting through the owning service, merging with the outside world

The realtime server doesn't write to the database directly. It saves
through the **owning service** of each document — `SitePageService.update`,
`SiteGlobalService.update`, `CrmEmailTemplateService.update` — with the
same validation, permissions and audit as a REST save. It saves on the
Hocuspocus debounce and on demand: before publishing, versioning or
sending a test, the editor sends `canvas.flush` and waits for
confirmation; without it, it falls back to REST. A document the service
refuses is reverted in the room to the last saved one, for everyone.

The Yjs state lives in `canvas_collab_states` alongside the SHA-256 hash
of the stored JSON. If, when a room loads, the stored document's hash
doesn't match the Yjs state's, someone changed it from outside — the REST
autosave of an editor without realtime, a version restore, the AI site
generator. That external document is merged **three ways**, node by node:
only what changed between base and external goes into Yjs.

And if realtime doesn't sync within **5 s** (or drops), the editor shows
"Sem colaboração em tempo real" and falls back to REST autosave. On
reconnect, Yjs merges what was edited.

## Results

What can be measured in the repository:

| | Email | Sites |
|---|---|---|
| Catalog version | 2 | 1 |
| Registered component types | **22** | **41** |
| Types shown in the palette | 20 | 35 |
| Breakpoints | `base`, `mobile` | `base`, `tablet`, `mobile` |
| Declared rules | footer `required` + `unique`; section with at most 4 columns | carousel, tabs and accordion with `minChildren` 1 |

Both catalogs — 63 types in total — run on the same `applyOp`, history,
layers tree, generated inspector and shortcuts. Neither has any
selection, drag or undo code of its own.

On performance, reading nodes through `getNode(doc, id)` makes each op
cost O(depth + what the op touches), not O(document size). The property
test builds a **2,002-node** document and applies 400 ops of each kind;
the README records ~0.03–0.05 ms per op, and the test only demands under
0.5 ms. I ran the same test three times on my machine: between **0.028
and 0.092 ms** per op, `update` cheapest and `remove` most expensive.

Tests: the 37 test files with "canvas" in their name hold **683** tests.
674 passed locally; the 9 that failed live in the two files that need a
test Postgres (the repository and the co-editing persistence
integration), which I didn't have running. The Yjs binding alone has 24
tests, including concurrent edits of sibling paths in a nested object, a
node moved into two parents, an insert into a removed subtree, and the
`maxChildren` cap under concurrent inserts. Those counts predate the undo
fix described below, which added six two-client tests to the binding
(24 → 30) and a new test file.

The comparison against "two editors" is counterfactual — the second
editor was never written, so there's no count of bugs avoided to show.

## Where it breaks

**Three catalog rules sit outside the projection.** The projection covers
`accepts`, `maxChildren`, type and props, because those are local checks
on a node and its children. `unique`, `required` and `minChildren` aren't:
they're about the whole document, or about what's **missing**, and the
walk can't conjure a footer someone deleted. They're only checked when
the service saves. In such a conflict — two people inserting the only
header, someone removing the last slide while another edits it — the
service refuses and the room reverts to the last save, taking **every**
change in the debounce window with it. The ADR says ~2 s, which is
Hocuspocus's default debounce; but that debounce restarts on every change
up to `maxDebounce`, 10 s by default, and the server overrides neither.
Under continuous editing the reverted window can be well over 2 s.

**Undo wiped out someone else's edit — fixed.** An `update`'s inverse
stores the values from before my edit. If I changed a heading's color,
Bruno changed the same color afterwards, and I undid, my inverse restored
the original value over his, for everyone. Redo had the same problem. The
existing test covered different paths (undoing my color keeps Bruno's
text), not the same path, and the only co-editing guard was dropping the
step when its node was gone. That was the price of skipping
`Y.UndoManager`: a catalog-revalidated history didn't know someone wrote
afterwards.

The fix ([steel-so/steel#126](https://github.com/steel-so/steel/pull/126),
in staging since 2026-10-18, Steel `2026.10.18.4`) is compare-and-set per
node and per field. Every history step now remembers, for each props path
or `meta` key its return trip will write, the value **it** left there
(`src/lib/canvas/history-guard.ts`). Before undoing or redoing, `guardOp`
strips the writes whose field no longer holds that value — a structural
comparison, since remote projection rebuilds objects — and the rest of the
step applies as usual. If Bruno touched the color after me, my undo skips
the color and the editor warns: "Parte do desfazer foi ignorada porque
outra pessoa alterou o mesmo campo." ("Part of the undo was skipped
because someone else changed the same field.") A step left with nothing to
apply leaves the history, as a removed-node step already did. Expectations
are recomputed after every trip, so redo holds only what the undo actually
undid. Before the fix, a two-client test interleaving edits failed 6 out of
6 times; the binding also gained a randomized property test whose
invariant is that an undo or redo only changes a field that still holds
what that person left there.

Two things still stand. Structural ops (insert, remove, move) are outside
compare-and-set and keep the old rule — catalog revalidation on replay —
so undoing my `move` puts the node back even if someone moved it
afterwards, as long as the catalog accepts it. And a field is compared at
the path the inverse writes: if my step created the whole `style` object,
someone else's change to a leaf inside it counts as a conflict and my undo
skips all of `style`. That was a choice: between skipping my undo and
deleting the other person's value, the fix skips.

**The realtime server got heavier.** To save through the owning services,
the realtime process now bundles the site and email services — email
rendering included. What was the Wiki's Yjs server became a process
carrying half the CRM domain. The ADR accepts this but doesn't measure the
bundle.

**The hash is a bit more sensitive than the content.** It uses JSON with
sorted keys — needed because Postgres `jsonb` reorders them — so identical
content hashes the same: a save outside the room with identical content
does **not** count as an external change. ADR 0027's consequences said the
opposite; the code was right, and the ADR got an update note correcting
the text ([steel-so/steel#126](https://github.com/steel-so/steel/pull/126)).
What still triggers a pointless merge is a document that's **equivalent
but not identical** — say, a `null` field where there used to be no key
(`stableStringify` only drops `undefined`). The merge is node by node and
writes nothing where nothing differs, so the cost is wasted work, not wrong
data.

**Old emails stay out.** `LEGACY` templates (free HTML from the old
editor, or the two original layouts) stay as they are and never enter the
canvas. `version: 1` block-builder documents are converted on open. The
conversion is deterministic — ids derive from the v1 section ids, so
converting again yields the same ids — and in a co-editing room the
converted template starts with an empty hash, which only forces its first
save to store it as v2.

## What this proves, and what it doesn't

It proves a visual editor can be split into an engine that knows no
target and catalogs that only declare: two very different outputs — email
for Outlook and Gmail, a responsive site with scripts — run on the same
`applyOp`, history and inspector. And it proves you can put a CRDT under
that engine without giving up the catalog's rules, as long as the way
back from Yjs is a validated projection rather than a blind apply.

It doesn't prove the single engine cost less than two editors would have —
the second one never existed to compare. It doesn't prove co-editing
holds up with many people in one document: the convergence tests use
three simulated clients, not real load. And it leaves the catalog's three
global rules open, enforced only on save, at the price of reverting
everything the room edited in the debounce window.
