---
title: 98% coverage and a kanban that wouldn't drag — the problem with complicit tests
description: "On September 20, Nexo's frontend had 98.03% line coverage and a kanban board where no card would move. The first run of the browser suite found four bugs that had slipped past more than 3,600 tests, and two of them lived in covered files whose tests asserted the defect. This post is about those complicit tests: how they're born, the 23 bugs from the component suite grouped by cause, and what changed in how I write tests afterwards."
icon: bug
date: "2026-11-05"
---

Nexo's kanban component test opens with this comment:

```tsx
// Drag-and-drop can't be simulated in jsdom, so the real <Kanban> is kept
// for rendering but its `onValueCommit` prop is captured. Tests call it
// directly with the meta dnd-kit would produce on drop, which exercises
// the view's own move handler without any pointer events.
```

It's an honest comment and a reasonable call: jsdom has no layout, so
nothing can be dragged there, and the test skips straight to what happens
after the drop. The trouble is that no user could *start* a drag.
`KanbanItem` keeps dnd-kit's listeners in context for a
`<KanbanItemHandle>` to claim, and no screen rendered a handle. Every card
on the board was inert. The tests for what happens after a drop were green,
about a drop that could never happen.

That day the frontend sat at **98.03% line coverage** (93.1% branches, v8
report over the frontend scope, CI run of September 20, measured before the
kanban fix). (Codecov showed 94.97% for the same code that day: it counts a
line with an untaken branch as partial. The v8 figure is executed lines,
client files only.) Underneath it were 1,420
unit tests, 549 integration tests, 1,662 component tests and 18 contract
tests. The first run of the browser suite, which serves the production
artifact to a real Chromium, found four bugs none of them had seen. Two
were in "covered" files.

The [architecture post](/en/writing/nexo-architecture) already describes
the test layers that landed in September. This one is about what they
found, and mostly about why the layers below hadn't found it first.

## Coverage measures execution, and the test picks what to execute

Coverage answers one question: did this line run during some test? It
doesn't know whether the test got there the way a user would, or whether
the assertion afterwards checks the right thing. A test that mounts the
component and calls its internal callback executes the same lines a user
dragging a card would, if the user could drag.

The mechanism is simple. Whoever writes the test while reading the code,
rather than the contract, carries the code's assumptions into the test. If
the code has a typo, the test copies it. If the code assumes the library
replies in Portuguese, the mock replies in Portuguese. The test isn't
loose. It's precise, just precisely about the wrong thing.

## Complicit tests

The name I settled on is **complicit test**: a test written from the code
that photographs the defect instead of catching it. It's worse than no
test for a concrete reason: an untested file shows up as a gap in the
coverage report, and a file with a complicit test shows up as done.
Absence is visible. Complicity isn't.

The cleanest example is onboarding. On the role step, "Fundador /
Executivo" (Founder / Executive) submitted this:

```tsx
{
  value: 'FOUNDER_EXECUTIBE',
  label: 'Fundador / Executivo',
  icon: Rocket01Icon,
},
```

The schema and the Prisma enum expect `FOUNDER_EXECUTIVE`. Anyone picking
that role couldn't get past the step, and the screen showed Zod's raw
English message in the middle of a Portuguese flow. The form's component
test said:

```tsx
expect(data.get('role')).toBe('FOUNDER_EXECUTIBE')
```

The typo landed on June 22 with onboarding. The test asserting it was
written on September 19, almost three months later, and the browser caught
both the next day. The fix was one letter in the component and one in the
test.

## The four bugs only the browser saw

Each is invisible to a layer for a different reason, and none is a lack of
effort:

| Bug | Invisible to | Because |
| --- | --- | --- |
| Kanban without drag-and-drop | component | jsdom has no layout; the test called `onValueCommit` directly |
| `FOUNDER_EXECUTIBE` | component | the test asserted the typo |
| Greeting with the author's name | every layer | Server Components don't run in jsdom and sit outside the coverage scope |
| English better-auth error | component | the mock answered with a made-up Portuguese message |

**The greeting.** The workspace home greeted every account, in every
workspace, as "Gusttavo Castro". It had been in the JSX since May 14:

```tsx
<H4>{getGreeting()}, Gusttavo Castro</H4>
```

The page is a Server Component. Testing Library doesn't render Server
Components, so no component test ever executed that file, and it didn't
even show up as a gap, because the frontend coverage scope leaves that kind
of file out on purpose. The comment in `vite.config.ts` says why:

```ts
// Server Components are left out on purpose — Testing Library cannot
// render them, so counting them would peg the metric below 100 no matter
// how many tests exist
```

The decision is right: a number that can never reach 100 is useless. But it
has a consequence the number doesn't show: the metric is blind to a whole
category of file, and the bug lived in exactly that category for four
months. That scope change landed the morning of the same September 20.
Before it, the file did appear in the report, as one gap among dozens of
Server Components nobody could test, which in practice is the same thing.

**The English message.** A wrong password at sign-in showed `Invalid email
or password`, straight from better-auth, on an all-Portuguese page. The
form test existed and passed, because it fed the component this:

```tsx
error: { status: 401, message: 'Credenciais incorretas' },
```

A Portuguese message the library never sends. The fix maps better-auth's
error codes to pt-BR copy, and the test now sends the exact shape the
library returns, `code: 'INVALID_EMAIL_OR_PASSWORD'` and `message:
'Invalid email or password'`, and checks that the Portuguese text shows
**and** that the English doesn't. The second assertion is the one that
matters: without it, a test that finds the right text keeps passing with
the wrong one rendered beside it.

**The kanban** was fixed by making the whole card the handle; dnd-kit's
activation distance still lets a plain click open the issue. The new test
drags with the mouse in steps, waits for the PATCH and **reloads the page**
before checking the column. The reload is what separates "local state
changed" from "the server got the change".

The same suite found a fifth, much bigger problem: the production image
never had a middleware. That one has [its own post](/en/writing/my-csp-post-was-wrong).

## The component suite's 23, grouped by cause

The component suite found bugs too, and plenty: about 30 on the first pass,
September 19, and 23 more on the second, September 20, each fixed behind a
red test first. Grouping those 23 by screen teaches nothing. Grouping them
by structural cause does.

**Accessibility with no automated check (9).** A control with no
accessible name breaks nothing visually, so it survives code review. The
two worst were on paths every account goes through: the 6-digit code input
(sign-up and 2FA) and the avatar picker were announced as bare fields. The
rest were interactive elements nested in interactive elements: a focusable
checkbox inside a button on the role options, dnd-kit's `role="button"`
landing on the wrapper of a card that was already a `<button>`.

The mechanism holding this family in place is small. The helper runs axe
over the rendered tree, and when a screen breaks a rule that can't be fixed
yet, that suite disables the rule behind a `// TODO(a11y):` comment saying
why. Fixing the bug means deleting the TODO, and deleting the TODO re-arms
the assertion. The debt is visible in the code and the fix verifies itself.
Exactly one is left in the repository, and it isn't mine:

```tsx
// TODO(a11y): aria-hidden-focus — Base UI wraps every popup in
// `data-base-ui-focus-guard` spans that are aria-hidden yet keep
// tabindex="0". This comes from the library, not from app code.
'aria-hidden-focus',
```

**Comparisons exercised one way only (3).** The "my projects" filter
filtered nothing:

```tsx
if (mine) result = result.filter((p) => p.leadId !== undefined)
```

`leadId` is always a string, so the condition is always true. The test
existed and passed, because it only checked that the user's projects
appeared, never that anyone else's disappeared. The date filter had the
same shape: `nuqs` hands back UTC midnight and the bound was built from
local parts, so at UTC-3 "from March 10" started at 9 p.m. on March 9, and the
button's own label disagreed with what was being filtered.

**A contract between layers misread (2).** The delete-account card read
`json?.error?.message`. The API envelope puts the message at the top level
and keeps only `{ code, details }` under `error`. Every server explanation
was replaced with a generic one. A repo-wide sweep found the same read in
the onboarding avatar upload.

**A multi-step operation with no commit point (1).** Switching a project's
estimate system fired one PATCH, N POSTs and M DELETEs, no rollback: a
failure midway left the project holding the new values and the old ones at
once. There's no single endpoint for the switch, so the flow was reordered
with the PATCH as the commit point: create the new values, swap the system,
only then delete the old ones. A failure before the commit undoes what was
created and says "Nada foi alterado" (nothing was changed). A failure after
it warns that old values survived instead of claiming the switch was lost.

**A wrong assumption about a dependency.** Two backend ones, and my
favourites, because nobody gets these wrong out of carelessness. BullMQ's
`remove()` returns `1` whenever the job isn't locked, **whether or not it
exists**, and `0` when a worker holds the lock. `cancelAccountDeletion`
read the return as "I removed a job", so cancelling a deletion that was
never scheduled reported success. Existence is now read with `getJob()`
first. The mirror image was in scheduling: with a custom `jobId`, BullMQ
keeps the first job and silently drops the next `add()`, so rescheduling a
deletion never moved the deadline.

The rest of the list is forms (the workspace URL field re-slugified on
every keystroke and ate the hyphen; "Minha Empresa" became `minhaempresa`),
one error code answering with another's code, and two jobs misbehaving when
they had nothing to do or when the cache failed after the database had
already changed.

## What changed in how I write tests

Three rules came out of this, all checkable in the code:

1. **When fixing a bug, look for the test protecting it.** The typo and the
   "mine" filter both had tests. The flow became: a test that fails on the
   current code, the fix, green, and a check on whether an existing test
   had to change to follow. If it did, it was complicit.
2. **A boolean comparison gets tested both ways.** A test that the right
   item shows says nothing about the filter if there's no wrong item to
   disappear. This rule got much bigger than I expected once mutation
   testing showed the whole project authorization gate had the same
   problem, which has its own post.
3. **A bug fixed on one screen usually exists on another.** The slug, the
   `error.message` read and the timezone showed up twice each, on different
   screens. Fixing the reported one without sweeping for the pattern leaves
   the second for the next suite to find.

And a fourth, about mocks more than tests: a mock of an external library
answers in the library's exact shape, copied from what it really returns,
never in the shape the code would like to receive.

## How long each one lived

| Bug | In | Out | Lived |
| --- | --- | --- | --- |
| Hardcoded greeting | 05/14 | 09/20 | ~4 months |
| `FOUNDER_EXECUTIBE` | 06/22 | 09/20 | ~3 months |
| Kanban without drag | 09/09 | 09/20 | 11 days |
| English better-auth error | — | 09/21 | origin not traced |

Lifetime has nothing to do with severity. The dead kanban was the worst of
the four for anyone using the product and the shortest-lived, only because
the browser suite arrived eleven days after it. The greeting was the
silliest and lasted longest, because it lived in the one kind of file no
layer executed.

## Where it broke

**The complicit test came back the same day.** At 12:56 on September 20,
in the commit that fixed the "mine" filter and the error envelope, new
tests went in for the 2FA card. They fed the component
`error: { message: 'Senha incorreta' }`, in Portuguese. About two and a
half hours later came the commit that fixed the typo and wrote down the
complicit-test lesson. The next day, fixing the English sign-in error, I
found all three 2FA screens showing raw `Invalid password`, and their tests
didn't see it because they'd been written exactly that way. In the same
batch, the OAuth button tests matched the accessible name with a substring
regex and never noticed it started with "google-logo". The root cause is
that the rule existed as a lesson in a note, not as a check: nothing stops
a mock from returning made-up text. What I have today is the convention
and review, and both failed on the day the rule was written.

**There's an open hydration race in the product.** The spec that renames a
project failed twice in a row on CI and passed locally. The trace showed
the PATCH body carrying the **old** name. The form's inputs are controlled,
`value={name}` over a `useState` seeded from the project the server sent,
and hydration renders that state, so anything typed before it lands is
overwritten. The API answers 200 for a no-op update, the success toast
shows, and only the reload at the end of the test reveals the problem. It
shows on CI and not locally because hydration is slower on a loaded 2-vCPU
runner. The test now retries the `fill` until the value sticks, which turns
the race into an explicit precondition, but that protects the test, not the
user: someone on a slow device who types right after the screen opens
loses what they typed, silently. My first diagnosis, written down at the
time, blamed uncontrolled inputs; it was wrong, and the spec's comment was
corrected five days later. The product side is still unfixed.

**Coverage is still blind to Server Components.** Leaving them out is
deliberate and I'd keep it, but it means the only thing executing those
files is the browser suite, 18 specs over the main paths. A server-side
page off those paths is run by no test, and no report tells me.

**The visual suite has a tolerance, just not where it looks.** The limit is
`maxDiffPixelRatio: 0`, not one pixel may change, but the per-pixel
`threshold` is `0.02`: a pixel only counts as different once its colour
moves about 2%. That's insurance against the runner's rasteriser landing a
level off, and still tight enough to catch `#fff` turning into `#f5f5f4`,
which the default `0.2` lets through. When the first CI run failed on one
pixel of a blue heading, because Skia picks SIMD paths by CPU, the answer
was to take that choice away from the hardware with Chromium flags, not to
loosen the number. But it's 44 images over 12 screens, and any screen
outside them has no visual check at all.

## What this proves, and what it doesn't

It proves that 98% line coverage lives comfortably alongside a dead core
flow, and that the cause isn't too few tests: it's tests written from the
code, inheriting its wrong assumptions. Four bugs that got past more than
3,600 tests fell on the first run of 18 specs in a real browser.

It doesn't prove the browser suite solves this. It found these four
because they were on paths it walks. Everything outside those 18 specs
still depends on the layers below, with the same blind spots.

It doesn't prove I stopped writing complicit tests. The evidence says the
opposite: I wrote one the same day I named the problem. What changed is
that I know what to look for in review, and that a library mock with text
the library never sends is, to me, a defect in the test and not a detail of
it.
