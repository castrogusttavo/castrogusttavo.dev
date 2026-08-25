---
title: Why I swapped tiptap for Plate in Nexo's editor
description: "tiptap is headless by design — it gives you the document engine and zero UI. That meant hand-building a selection menu, a slash command palette, and table controls from scratch, with no accessibility attributes at all. I swapped it for Plate, which ships component kits already aligned to shadcn/ui with Radix underneath — and the before/after numbers show exactly what that cost."
icon: code
date: "2026-08-25"
---

The selection menu on Nexo's issue-description editor — the one that pops
up when you highlight text and pick bold, italic, a link — was 174 lines
of code just to exist. Zero `aria-` attributes, zero `role`. The slash
command menu (`/`) was another 162. The table controls, another 54. Nearly
400 lines of hand-built UI for three pieces of chrome any rich text editor
"should" ship with — and none of them keyboard-navigable or
screen-reader-readable the right way.

That's not a tiptap bug. It's the whole premise: `tiptap`/`ProseMirror`
are **headless** by design — they give you the document model, the
schema, the editing commands, and no UI at all. Every pixel of interface
is your responsibility. For a plain text editor that's a feature. For a
product that needs to look like the rest of Nexo — which uses shadcn/ui
everywhere — and that I actually wanted accessible, it became the
opposite: I was rebuilding, piece by piece, a component system that
already exists somewhere else.

## The problem: headless isn't neutral, it's work someone has to do

In practice, headless meant three fronts to build from scratch at
once — function, visuals, and accessibility — and none of them ever
stayed finished. Adding a new slash-menu command wasn't just registering
the command; it was also getting the list item's styling right, and then
remembering to cover focus/keyboard/screen reader, which usually got
pushed to later and sometimes never arrived. Every change to these
screens shipped with a regression in one of the three — fix function,
break visuals; fix visuals, forget accessibility again. It's not an
occasional problem, it's the shape of the work when the tool doesn't own
any of the three.

The most visible symptom was visual: the editor didn't look like Nexo.
Buttons with their own styling, menus with their own spacing, none of it
inheriting the design tokens (`hover:bg-muted`, `focus-visible:ring-ring/50`)
the rest of the app uses. But the structural problem sat one level below
that — accessibility — and I only realized how deep it went once I
actually checked.

`components/editor/bubble-menu.tsx`, tiptap's selection menu: zero
occurrences of `aria-*` or `role=`. None. Every menu button was a `div` or
a `button` with no extra semantics to say "this is a menu item, this one's
marked active, this is a combobox" to anyone navigating by keyboard or
screen reader. The same pattern repeated in `slash-menu.tsx` and
`table-controls.tsx`. Not because anyone decided to skip accessibility on
purpose — tiptap doesn't give it to you for free, and writing it correctly
from scratch (focus management, `aria-activedescendant`,
coordinated `role="menu"`/`role="menuitem"`, screen-reader announcements
for dynamic state) is its own project, not a side effect of writing a
working bubble menu.

And it wasn't just accessibility that suffered — basic functionality
broke because of the same headless characteristic. A real example, from
the sticky-notes editor (which still runs on tiptap today):
`useEditor()` tries to render immediately on the client by default, which
in any SSR Next.js app produces a hydration mismatch — the server's HTML
doesn't match what React mounts in the browser. The fix is a not-obvious
flag, `immediatelyRender: false`, documented halfway through tiptap's SSR
guide, not in any warning from the editor itself:

```diff
  const editor = useEditor({
+   immediatelyRender: false,
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: false })],
```

I found that flag by accident, after already chasing the wrong hypothesis
(thought it was a React key issue, a render-order issue, CSS loading
late). That's the class of bug headless pushes onto whoever's integrating
it: it's not that the library is wrong, it's that every detail of how it
behaves inside your specific framework becomes yours to discover.

## The idea: use an editor that already ships aligned to your design system, don't build the alignment yourself

[Plate](https://platejs.org) (MIT, built on Slate) solves this in a
specific way: it isn't just "another headless editor" — it ships with
ready component kits (`@platejs/basic-nodes`, `@platejs/code-block`,
`@platejs/list`, `@platejs/indent`) designed specifically to run on top of
shadcn/ui, with real Radix UI underneath (`@radix-ui/react-toolbar`,
`@radix-ui/react-tooltip`). The core difference: with tiptap, the UI is
100% your responsibility; with Plate plus the shadcn kit, the toolbar, the
command menu, and the block controls already carry Radix's accessibility
semantics built in — because Radix is designed that way from the ground
up.

Switching editors isn't just swapping a dependency — it's swapping
"headless engine, build your own UI" for "engine plus a UI kit already
wired into your design system," inheriting the accessibility work Radix
already did instead of redoing it.

## How it works: the real migration

The switch wasn't an `npm uninstall tiptap && npm install platejs` — the
data shape changed. `IssueDTO.description` under tiptap was `JSONContent`
(a nested `type`/`content` object); under Plate it's `Value`, an array of
elements. That rippled through the Zod schema:

```ts
const IssueContentSchema = z
  .array(z.record(z.string(), z.unknown()))
  .refine(
    (value) => JSON.stringify(value).length <= 100_000,
    'Descrição excede o tamanho permitido',
  )
```

(`z.record` became the element inside the array instead of the whole
schema — and the size `.refine` stayed exactly where it was, because that
never changed: an issue description always had a byte ceiling, regardless
of which editor produces the JSON.)

The trickiest detail was legacy data: the dev database already had issues
saved in the old tiptap shape. Without running a data migration
(descriptions are stored as loose JSON, not typed columns), the mapper
needed a defensive fallback:

```ts
description: Array.isArray(issue.description)
  ? (issue.description as Value)
  : EMPTY_ISSUE_DESCRIPTION,
```

One line, but it solves a real problem: `Array.isArray` tells a Plate
`Value` (always an array) apart from an old tiptap `JSONContent` (always
an object) — old issues fall back to `EMPTY_ISSUE_DESCRIPTION` instead of
breaking the render. Not elegant, a deliberate bridge until the old data
stops existing.

The rest of the rebuild was assembling the real components: the
`fixed-toolbar` (headings, blockquote, lists, marks), the block nodes —
code, blockquote, heading, highlight, `hr`, `kbd`, paragraph — each with a
static sibling variant (`*-node-static.tsx`) for read-only rendering (the
issue view doesn't need the whole editor loaded, just the result). The
plugin kits (`basic-nodes`, `list`, `code-block`, `indent`) plug in the
editing behavior; the styling comes aligned to shadcn from day one, not
layered on top.

### The mechanism, side by side: the same bold button

The "bold" button in tiptap's bubble menu was this — a shadcn `Button`
underneath, but active state controlled entirely by hand:

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

// in the bubble menu:
<ToggleButton
  icon={TextBoldIcon}
  active={editor.isActive('bold')}
  onClick={() => editor.chain().focus().toggleBold().run()}
/>
```

It works — but `active` is passed manually at every call site, and the
resulting element is a plain `<button>` with no `aria-pressed`, no `role`
at all: to assistive tech, it's indistinguishable from a regular button,
even while "active."

The Plate equivalent is `MarkToolbarButton`:

```tsx
export function MarkToolbarButton({ clear, nodeType, ...props }: ...) {
  const state = useMarkToolbarButtonState({ clear, nodeType })
  const { props: buttonProps } = useMarkToolbarButton(state)
  return <ToolbarButton {...props} {...buttonProps} />
}
```

State isn't passed by hand — it comes from a hook
(`useMarkToolbarButtonState`) that already knows how to query the
editor's current selection. And `ToolbarButton`, underneath, isn't a bare
`<button>`: when it receives a boolean `pressed`, it resolves to a
`ToolbarToggleItem` inside a `ToolbarToggleGroup` — Radix's toggle-group
primitives, which give real pressed-state semantics and arrow-key
navigation between toolbar items for free, because that's how the
primitive is designed, not because someone remembered to add it. The same
pattern repeats in the code block's language combobox
(`code-block-node.tsx`), which is born with `role="combobox"` and
`aria-expanded` coming from Radix's `Popover` underneath — neither line
was written by hand in this project.

## Results

| Metric | tiptap (removed) | Plate (current) |
|---|---|---|
| Editor UI lines | 1,468 (18 files) | 1,957 (25 files) |
| `aria-*`/`role=` in the selection menu | **0** | `role="button"`, `role="menuitem"`, `aria-checked`, `aria-expanded` |
| Visual alignment with shadcn/ui | None (own styling) | Direct — same design tokens (`hover:bg-muted`, `focus-visible:ring-ring/50`) |
| Full migration (57 files) | — | 2,460 insertions / 1,522 deletions |

More total lines of code — Plate isn't "less code," it's "the right code
paid for once by the framework instead of rewritten by me." The
difference that matters isn't the line count, it's what those lines do:
the new `toolbar.tsx` (363 lines) has real accessibility semantics built
in from its first version, because it inherits from Radix — the old
`bubble-menu.tsx` (174 lines) had none, because building that from
scratch is its own project I'd never prioritized.

There's a functional result here beyond accessibility, and it's the one
that most directly addresses the original "always had some functionality
problem" pain: under tiptap, `active={editor.isActive('bold')}` was
manual plumbing at **every** button — five different marks in the bubble
menu, five independent places to keep the right mark-name string and the
right `onClick` in sync. Under Plate, `useMarkToolbarButtonState`
centralizes that lookup in one hook reused by every mark button — there's
no new place to plumb state into every time I add a button, because the
button doesn't hold its own state, it queries the hook. That doesn't show
up in a line-count metric, but it's exactly the class of bug (one of the
three fronts — function, visuals, accessibility — breaking while I
touched another) that drove the whole switch: fewer places for that kind
of drift to happen, not a guaranteed zero, but structurally fewer.

## Where it broke — the migration isn't finished

tiptap didn't leave Nexo. `grep`-ing the codebase today still shows seven
files importing from `@tiptap/*`: the user **sticky notes** editor
(`app/_components/user/sticky/user-sticky.tsx`) and the **comments**
content format (`src/mappers/comment.mapper.ts`, `types/comment.d.ts`)
still run on old tiptap. `@tiptap/react`, `@tiptap/starter-kit`, and the
task-list extensions are still in `package.json`.

The order wasn't an accident: I started with the surface with the most
usage and the most UI risk — issue descriptions, where the accessibility
and visual-misalignment problems showed up the most — and sticky notes
and comments come next, still in progress as I write this. They're
smaller surfaces, with less chrome (no elaborate bubble menu, no slash
command), so the risk of them lagging behind longer is smaller than it
was for issue descriptions. But until that migration wraps, `package.json`
carries two rich-text editor dependencies at once — exactly the kind of
in-between state that needs a deadline, not just intent.

## What this proves, and what it doesn't

This proves, with a real accessibility number and not a visual
impression, that switching editor frameworks fixed a specific structural
problem: a headless UI with no dedicated accessibility investment becomes
a UI with no accessibility at all — not because anyone decided that, but
because nobody builds `aria-activedescendant` by accident. A framework
already aligned to your design system delivers that as a property of the
framework, not as a separate project competing for priority against
everything else.

It doesn't prove Plate is better than tiptap in general, or that headless
is the wrong choice — it proves it was the wrong choice **for this
specific case**, where accessibility and visual alignment with an
existing design system were requirements, not extras. And it doesn't
prove the migration is finished: two rich-text editors coexisting in the
same `package.json` is Nexo's real state today, not a footnote left out
of the summary.
