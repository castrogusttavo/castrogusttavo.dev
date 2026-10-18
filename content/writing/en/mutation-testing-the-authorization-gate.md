---
title: Mutation testing the authorization gate — 392 mutants coverage called tested
description: "Hardcoding \"is the lead\" to false in Nexo's project authorization gate survived in 64 places: no test in the repository had ever granted access to someone for being the lead. This post covers what Stryker found in a backend at 88% coverage, the access matrix that took 392 survivors to zero across 18 services, the deadlines that would have shipped already expired, how mutation runs outside the CI gate, and why the score slid from 80.09% to 78.58% without the gate noticing."
icon: code
date: "2026-11-10"
---

This is the access check repeated across Nexo's project services. The
version below is from `issue-label.service.ts`:

```ts
const isLead = project.leadId === actorId
const isMember = project.members.some((m) => m.userId === actorId)
if (!membership.isPrivileged && !isLead && !isMember) {
  return err(issueForbidden())
}
```

Three conditions, any one lets you in: being a workspace `OWNER` or
`ADMIN`, being the project lead, or being on the member list. Those lines
were covered, and the backend sat at 88.43% on Codecov. On September 20 I
ran mutation testing for the first time and Stryker replaced `isLead` with
`false`. The mutant survived in **64 places**. It replaced `isMember` with
`true`: survived in **47**. It swapped `.some` for `.every`: survived in
**16**.

In plain terms: no test in the whole repository had ever granted access to
someone **for being the lead**. And no test denied access in a way that
depended on the member list. The gate was unproven in both directions, and
every test was green.

The [three-layer authorization post](/en/writing/three-layer-authorization)
explains where this decision lives and why it lives in the service. This
one is about finding out nobody had proven it right.

## What coverage says, and what it doesn't

Coverage says the line ran. Mutation testing asks something else: if this
line were subtly wrong, would any test go red? Stryker generates thousands
of versions of the code, each with one small defect (a `>` turned into
`>=`, a `true` into `false`, a function body emptied), and runs the tests
against each. A mutant that fails a test is "killed". One that passes
everything survived, and a survivor is a behaviour change the suite would
silently accept.

All three gate survivors come from the same fixture. Before the fix, the
tests in `issue-label.service.test.ts` built the project like this:

```ts
function projectWith(
  overrides?: Partial<ReturnType<typeof createFakeProject>>,
  members: { userId: string }[] = [{ userId: 'actor' }],
) {
  return {
    ...createFakeProject({ id: 'proj-1', leadId: 'lead-1', ...overrides }),
    members,
    favourites: [] as { id: string }[],
  }
}
```

By default the actor is a member, the **only** member, and not the lead.
Every "allowed" test went through the `isMember` arm, so `isLead` could be
anything. And on a one-element list `.some` and `.every` agree, so the
operator could be anything too. The fixture isn't wrong. It's convenient,
and the convenience picked one single path through the gate for every
test.

## The idea: each case isolates one arm

The fix wasn't more tests of the same kind. It was a different test shape:
in every "allowed" case, the **only** reason the actor gets in is the arm
under test; in every "denied" case, the member list is **populated**, so an
`.every` or an `isMember = true` makes a difference. And every denial
checks nothing was written, because a `forbidden` that already hit the
database before refusing is still an authorization failure.

## How it works: one matrix, eighteen services

That became a helper, `src/services/__tests__/_project-access-gate.ts`.
Each service suite declares its gated methods, and the helper drives the
same matrix over each:

```ts
export interface GatedMethod {
  name: string
  grants: 'member' | 'lead'
  publicGrants?: boolean
  forbiddenCode: ErrorCode
  arrange: () => void
  call: (actorId: string) => Promise<Result<unknown>>
  /** Repository calls that must never run when the gate says no. */
  sideEffects?: () => unknown[]
}
```

`grants` says who gets through besides `OWNER`, `ADMIN` and the lead:
`member`, for reads and issue-level work, or `lead`, for project
configuration (states, labels, cycles). The matrix:

- the lead who is **not** on the member list is admitted;
- an `OWNER` or `ADMIN` who is neither lead nor member is admitted;
- one member among three is admitted where members may pass, and denied
  where only the lead or an admin may, even on a public project;
- an actor absent from a two-member list is denied;
- a null lead, which is what's left when the lead's account was deleted,
  never admits anyone;
- on a public project, any workspace member passes where `publicGrants`
  says so, and a plain member doesn't pass where only the lead may.

Every denied case runs `expectDenied`, which checks the error code and that
none of the repository calls listed in `sideEffects` happened:

```ts
async function expectDenied(method: GatedMethod) {
  expectErr(await method.call(GATE_ACTOR), method.forbiddenCode)
  for (const effect of method.sideEffects?.() ?? []) {
    expect(effect).not.toHaveBeenCalled()
  }
}
```

The commit (`9d7dab3`) applied the matrix to 18 services. With Stryker
scoped to them, survivors on the gate lines went from **392 to 0**, and
those files' score from **68.95% to 82.72%**.

The null-lead case is worth a line. It exists because, that same weekend,
account deletion started anonymizing content instead of deleting it, so a
project can end up without a lead. `project.leadId === actorId` with a null
`leadId` is false, so it's correct today. The test is there so a future
refactor that compares differently can't turn "no lead" into "anyone is
the lead".

## The other survivors had the same disease

The gate was the biggest finding, not the only one, and nearly all the
others had the same shape: a test that existed and checked the wrong thing.

**Three deadlines accepted a sign flip.** The 30-day account-deletion grace
period, the 7-day invitation TTL and the data-export link expiry. In all
three, `+` turning into `-` survived. The account-deletion test checked
this:

```ts
expect(typeof value.scheduledAt).toBe('string')
```

The type. A date 30 days in the past is also a string. The new version
checks the date is in the future and that the distance to it sits between
the grace period minus a minute and the exact grace period:

```ts
const GRACE_MS = 30 * 24 * 60 * 60 * 1000
const scheduledAt = new Date(value.scheduledAt).getTime()
expect(scheduledAt).toBeGreaterThan(Date.now())
expect(scheduledAt - Date.now()).toBeGreaterThan(GRACE_MS - 60_000)
expect(scheduledAt - Date.now()).toBeLessThanOrEqual(GRACE_MS)
```

With the sign flipped, the account would be scheduled for deletion 30 days
ago, which means now. The invitation and the link would be born expired.

**Upload limits where `>` and `>=` were interchangeable, in five places.**
Every test used `LIMIT + 1` bytes, which both operators reject. Nothing
pinned the boundary. The new test sends a file of exactly 5 MB and expects
it through, because the cap is inclusive.

**Coupons.** Both amount bounds are inclusive on purpose and neither edge
had a test, so a 100%-off coupon had never been exercised. Capped coupons
had only been tested **exhausted**: every other case used the uncapped
default, so the redemption comparison had only been seen rejecting.

**Incident severity.** `>` turning into `>=` survived because no test had a
probe reporting the **same** severity as an already open incident. Under
`>=`, the public status timeline would gain a "severity updated" entry on
every collection.

**The status page's 90-day uptime could become an empty function** and
nothing went red: no test read the number. And raw health-check pruning
accepted its cutoff flipped into the **future**, which would delete every
check.

**Project identifier derivation was entirely unverified.** The
`toUpperCase`, the character filter and the 6-character cut could all be
inverted without failing a test.

It's the same lesson as the frontend's complicit tests, which have
[their own post](/en/writing/98-percent-coverage-dead-kanban): a comparison
tested one way, a boundary never exercised, an assertion on the type
instead of the value.

## How Stryker runs

Config lives in `stryker.config.mjs`, `.mjs` so every choice can carry a
comment, and nearly every choice needed one.

**A Vitest config just for Stryker.** Stryker's Vitest runner has no
`--project`: it boots Vitest with a config file and runs every project it
finds. Pointing it at `vite.config.ts` would drag integration, e2e and
component in, which need Postgres, Redis and a running server, for each of
thousands of mutants. `vitest.stryker.config.ts` is the `unit` project
flattened into a single-project config, with a comment asking to keep the
two in sync.

**The pnpm trap.** Stryker's plugin discovery globs
`node_modules/@stryker-mutator/*` and doesn't follow pnpm's symlinks.
Without an explicit `plugins: ['@stryker-mutator/vitest-runner']`, it says
no test runner was loaded, with the runner installed.

**What's left out, and what's kept in on purpose.** The `StringLiteral`
mutator is off: nearly every string in this scope is a log event name, an
audit action name or a Portuguese message, and leaving it on produced
hundreds of unkillable mutants drowning the real findings. Behaviour that
*is* carried by strings, like error codes, queue names and DTO keys, lives
in `as const` objects, still mutated as `ObjectLiteral`. And
`ObjectLiteral` stays **on**, despite roughly 250 survivors that are
`auditMutation` and `logger` payloads being emptied, noise in the same
family as the strings. The same mutator empties the argument to
`Repository.create({...})` and the `where` of a `findMany`, and there a
survivor is a real hole. Turning it off would hide both. The noise is
priced into the threshold.

**`ignoreStatic: true`.** Module initialisation runs once per worker, so a
mutant in a constant table at the top of a file would require reloading
the whole environment for each. Ignoring them keeps the run tractable, at
the cost of not mutating tables like the error-code registry.

**Weekly, outside the CI gate.** The workflow runs Mondays at 04:00 UTC
and on demand. `cd.yml` deploys off a green CI, so putting mutation in the
gate would delay every deploy for a metric that moves slowly. A number
correction: the original commit says 25 minutes, which was the estimate on
my machine. On the self-hosted runner, full runs took between **10m37s and
12m36s**. Still longer than the whole CI pipeline, so the argument holds.

## The numbers

| Date | Run | Score | `break` |
| --- | --- | --- | --- |
| 09/20 | first measurement, local | 70.34% | — |
| 09/20 | after the first boundary tests | 72.35% | 70 |
| 09/21 | first on CI, manual | failed before starting | 70 |
| 09/21 | second on CI, after the matrix | 80.09% | 70 → 77 |
| 09/26 | on demand | 79.91% | 77 |
| 09/28 | scheduled | 78.60% | 77 |
| 10/05 | scheduled | 78.58% | 77 |
| 10/12 | scheduled | 78.58% | 77 |

The first CI run died in `prisma generate`, before Stryker even started:
`prisma.config.ts` demands `DATABASE_URL` just to generate the client,
which never connects to anything. The workflow now sets a URL that only has
to exist (`494749c`). The 04:00 schedule hadn't fired yet when I ran it by
hand; had I waited, it would have failed every Monday, in a workflow that
blocks nothing, with nobody looking.

The second passed at 80.09%, and `break` went from 70 to 77 the same day
(`10ee219`). At 70, the score could have dropped ten points without failing
anything, and a limit far below the score guards nothing. `break` sits
about three points under the measured score on purpose: a few mutants
change verdict between runs, and the gate shouldn't trip on them.

## Where it broke

**The score dropped 1.5 points and the gate didn't notice.** From 80.09% on
September 21 to 78.58% on October 5 and 12, always above the `break` of 77.
Part of it is new code: between September 21 and 26, four files and about
420 more tested mutants came in. The other part is odd. In the September 28
run, `src/errors/app-error.ts` went from 100% (8 mutants, all killed) to
**8.33%**, with 88 new survivors. Tested mutants rose from 5,759 to 5,854
with only 2 more instrumented, which says 88 mutants that `ignoreStatic`
used to drop started being tested. For each, the log says "Ran all tests
for this mutant", and all survived, including `appError = () => undefined`,
which would fail any test checking an error code if it were actually
active. My reading is that they're false survivors: static mutants run
without reloading the module, never actually switched on. I haven't
confirmed it, and I don't know what changed their classification; the
only commit in that window touching `src/errors` just added one new error
factory. Without those 88, the September 28 score would be 79.80%, flat
against two days earlier. What matters is that a whole directory went from
100% to 8% and the only signal was a global number that stayed above the
limit. A global threshold can't see a local regression, and three weekly
runs went green right over it.

**The jump from 72.35% to 80.09% isn't all the matrix.** The two
measurements came from different machines with different mutant counts
(5,269 on the first local run, 5,335 tested on CI), and other commits with
backend tests landed in between. The number I can safely credit to the
matrix is the scoped one: 392 survivors to 0 on the gate lines, and 68.95%
to 82.72% across the 18 services.

**The gate was tested, not refactored.** The matrix commit says so
outright: the check was still repeated inline, "~75 times" per the message.
A `grep` for `const isLead` across the services counts 82 occurrences in 18
files, both at that commit and today. A new service that copies the check
doesn't get the matrix for free; someone has to remember to call
`describeProjectAccessGate`, and that someone is me. Extracting the check
into one function would fix both, and I haven't done it.

**The noise is permanent.** The roughly 250 audit-payload survivors show
up in the report every week, and whoever reads it has to know to skip them
and chase the repository-argument ones. It's a choice, and it costs a
report that's harder to read than it needs to be.

## What this proves, and what it doesn't

It proves that high coverage and proven authorization are different
things: the gate's lines were covered and no test told the right code
apart from three wrong versions of it. It also proves the defect was in the
fixture, not in the number of tests, and that changing the test's shape
(one arm per case, a populated list on denial, checking nothing was
written) took 392 survivors to zero.

It doesn't prove Nexo's authorization is correct. It proves that, in the
18 services using the helper, the three conditions of the project gate are
told apart by the tests. Workspace role authorization, personal-resource
ownership and any service that doesn't call the helper are outside that
claim.

And it doesn't prove the score works as an alarm. It dropped a point and a
half, a directory went from 100% to 8%, and `break` never fired. The number
I called the most honest one in the [architecture post](/en/writing/nexo-architecture) is still the most
honest I have, but it needs someone reading the report per directory, not
just checking the workflow went green.
