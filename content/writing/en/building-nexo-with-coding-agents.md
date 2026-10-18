---
title: Building Nexo with coding agents — the work didn't go away, it moved
description: "Of Nexo's 1,414 commits, 1,076 carry Claude's co-author trailer; since September 9 it's 275 of 301. The volume is the least interesting part. What changed is where the engineering lives: tests that run on the far side of every boundary, verification against the real artifact and the live database instead of anyone's assumptions, and operating rules for parallel agents, each one written after an incident."
icon: terminal
date: "2026-12-15"
---

Of the **1,414** commits on Nexo's `main`, **1,076** carry a
`Co-Authored-By: Claude` trailer — 76%. When I wrote the [architecture
post](/en/writing/nexo-architecture) on September 20, the total was 1,255.
From September 9 to today, October 17, **301** commits landed, and **275**
of them are co-signed: 91%.

Those numbers say an agent writes most of the code that goes into the
repository. They say nothing about whether that code is any good. That's
what this post is about: over the last month or so, the engineering work
didn't shrink — it left the typing and moved into three places I didn't
expect to be this expensive.

1. **Tests that run on the far side of each boundary**, not on the side
   where the code was written.
2. **Verification against reality** — the artifact that ships, the live
   database, the installed dependency's code — not against the mental
   model of whoever asked or whoever built it.
3. **Operating rules for parallel agents**, each of which exists because
   something broke first.

So the thesis: agents multiply output, and the engineering that matters
becomes the guardrails. The rest is evidence, taken from `git log` (the
repo is public) and from the session notes I keep in my vault for every
agent work session.

What I hand to the agent fits in a short list: creating commits and
merging PRs, deep performance analysis, writing and running tests,
building complex or animated frontend components, and reviewing an
architecture I've already decided — that last one in long sessions. The
architecture decision itself stays with me; the agent reviews, measures
and executes.

## How the numbers were counted

On a clone of `castrogusttavo/nexo`, `main` at `0beed010`
(2026-10-17 20:39 -03):

```bash
git rev-list --count HEAD                                            # 1414
git log -i --grep='^Co-Authored-By: Claude' --format=%H HEAD | wc -l # 1076

git rev-list --count --since='2026-09-09T00:00:00-03:00' HEAD        # 301
git log -i --grep='^Co-Authored-By: Claude' \
  --since='2026-09-09T00:00:00-03:00' --format=%H HEAD | wc -l       # 275
```

These count **commits** reachable from `main` (merges included), not
trailer lines — six commits have more than one. The date filter uses
commit date, not author date. A trailer says an agent took part in a
commit; it doesn't say how much of the diff is its work.

## 1. The right test runs on the other side of the boundary

The most repeated pattern: code passed every test on the side where it was
written and broke across a boundary no test crossed.

**Production without middleware.** On September 20, the agent building the
browser suite chose to boot the standalone artifact
(`node .next/standalone/server.js`) instead of `next start`. That choice
revealed that `.dockerignore` listed `proxy.ts` as dev tooling — every
production image had been built **without the middleware**. No CSP, no HSTS
from the app, and a private URL answering 200 to anonymous visitors. The
build never complained, because a missing file in a build context fails
silently (`1d3f61bb`). Full story, including the CSP I'd described wrong,
in [my CSP post was wrong](/en/writing/my-csp-post-was-wrong).

**Account deletion that never deleted.** Same day, the browser test caught
Postgres refusing `prisma.user.delete`: 12 relations to `User` had no
`onDelete`. The job threw, BullMQ retried three times and gave up, quietly.
Unit tests passed because their fixtures had no authored rows
(`94d044f2`). Details in [account deletion that never
deleted](/en/writing/account-deletion-that-never-deleted).

**Accomplice tests.** A component test **asserted the typo**
`FOUNDER_EXECUTIBE` that stalled onboarding. Three auth and OAuth tests were
fed error messages already in Portuguese, or matched accessible names by
substring — so they never saw better-auth's English leaking through, or a
button announcing "google-logo Continuar com Google". A fixture that
already carries the right answer tests nothing.

**An unproven authorization gate.** Mutation testing showed that across 18
services, hardcoding "is the lead" to `false` survived, and so did `.some`
→ `.every` — every test used a one-member project. Overnight on September
21, a helper started driving the same access matrix through every gated
method, and survivors on the gate lines went from **392 to 0**
(`9d7dab3e`). That one has its own post: [mutation testing the
authorization gate](/en/writing/mutation-testing-the-authorization-gate).

And the case I find most worth telling, because the mistake is the agent's
own. On September 24 it added a new status page component, ran unit,
contract, component and integration before committing, and skipped the e2e
test that pins the API's component list. The session note records the
reasoning: it treated "needs a running server" as "CI will run it for me" —
the very layer that exists because it sees what the others don't. The fix
came from another agent, not from me (`34da4ab1`, co-signed too): the layer
the first one skipped was the one the second one ran.

Nexo's `CLAUDE.md` opens its testing section with the sentence that sums up
this whole section:

> Each layer answers a different question, and a bug that slips through
> one is usually invisible to the layers above it.

## 2. Verify against reality, not assumptions

The second shift: "the agent says it works" and "I think it works like
this" became the same kind of evidence — none.

On September 21 I sent three agents after six open items, and two of my
premises were wrong. The agents corrected them by reading code, not the
brief:

- **Stalled jobs already raised an alarm.** I thought they didn't. BullMQ
  5.79 doesn't send a stalled job straight to the failed set: it records a
  deferred failure, puts the job back in wait, and the next worker kills it
  with `UnrecoverableError`. The alarm fired — under the wrong label
  (`807fa5e8`).
- **The build warning wasn't about the status route.** It was all **42**
  `withAxiom` GET routes; `/api/status` only showed up because it started
  Axiom's batch timer first, which is why the warning came and went.
  Before: warning in 4 of 5 builds. After: 0 of 3 (`38cd2d1c`).

The note that stuck: reading the installed dependency's code beats docs or
memory — mine or the model's.

It cuts the other way too. On September 9 I asked for 98% e2e coverage.
The agent came back saying the number was unreachable in that setup: the
tests hit a server in another process via `fetch()`, and the coverage
collector only instruments its own process. We renegotiated to "cover the
routes with no test at all" — 12 real ones, after discarding 2 false
positives from the heuristic.

And the same bar applies to the agent. For account deletion, the check of
the 30 foreign keys pointing at `users` was run **against the live
database**, not `schema.prisma`. With PostHog, a session spent hours sure
ingestion was broken in production, when `posthog-js` silently drops every
event from a browser that looks automated — the bug was the verifier. Right
after one deploy, a real request without a session found a font
redirecting 307 to sign-in, because the proxy `matcher` excluded images but
not fonts; logged-in users never noticed, and no test had caught it. The
weekly mutation cron hadn't fired: run by hand, it failed before starting,
because `prisma generate` demands `DATABASE_URL` (`494749c4`). Left alone,
it would have failed every Monday unseen.

`CLAUDE.md` has this rule too, for me and the agent alike:

> Type-check and tests verify code correctness, not feature behavior —
> always smoke the golden path + a few edge cases in the browser.

## 3. Rules for parallel agents, each with an incident behind it

Running several agents at once is where the volume gain is biggest — on
September 19 it was 8 agents in parallel, one per domain, only creating
test files. It's also where the incidents no test catches showed up,
because they aren't code bugs: they're collisions between processes.

| What happened | Rule that came out of it |
|---|---|
| An agent ran `pnpm install` while other suites were running; `node_modules` was swapped under them and `@prisma/client` vanished mid visual run. All final verification was redone from scratch, sequentially. | Dependency changes go last, alone. In the next batch, the dependency agent only started after the other two finished. |
| Integration tests run against the local dev database wiped the local data. | Integration only against a disposable database. |
| Another Claude session pushed an image change and took a local commit from the first session along with it. | Never two sessions with push rights on the same `main` at once. |
| A validation worktree in `/tmp` (tmpfs, i.e. RAM) took the machine down on the first sweep. | Worktrees on disk, outside `/tmp`. |
| Playwright with 1 worker: every spec shares the worker's account and blows the per-user rate limit (429 on the wiki). | Locally, at least `--workers=2`, like CI. |

The second row bothers me most, because the rule already existed as
judgment. On September 9, in an unsupervised overnight session, the agent
**refused** to run e2e: `.env` pointed at a database with no `_test`
suffix, the setup runs `TRUNCATE ... CASCADE`, and it chose to deliver tests
checked only by `tsc` and Biome, with a warning to run them against a
disposable database. Thirteen days later, another session ran integration
against the local database and wiped it. Judgment that's right once and
wrong the next time isn't a rule. Now it's in `CLAUDE.md`:

> Integration tests truncate all tables `afterEach`
> (`src/__tests__/setup.integration.ts`), so they require a disposable dev
> database.

Same family, outside the table because it isn't an agent collision: a
credential pasted into a chat must be considered burned and rotated, no
matter who reads the chat later.

Losing the database cost me a medium amount: it took a good chunk of the
data I used for local load tests with it. The bigger cost was what it
exposed — there were no batch-load files to rebuild that data. A local
database you can't recreate with one command isn't disposable, and "integration only
against a disposable database" assumes exactly that.

## The overnight run with explicit authorization

The case that ties all three together is the night of September 21. I
asked the agent to fix "every visual, accessibility and other correction
item" and to spin up an agent for the security problems, with explicit
authorization to run everything alone while I slept. The range
`ec8273ac..28ceb26` holds **22 commits**, all co-signed, in three batches
through the day; 12 of them landed between midnight and 3 a.m.

| Measure | Before | After | Source |
|---|---|---|---|
| Open code scanning alerts | 39 | 5 | GitHub code scanning API |
| `pnpm audit` | 62 (11 high) | 43 (1 high) | `ccac356e` |
| `pnpm audit`, afternoon batch | 43 | 1 accepted low | `c3c975de` |
| Mutation survivors on the authorization gate | 392 | 0 | `9d7dab3e` |

I rebuilt the alert counts from each alert's `created_at`, `fixed_at` and
`dismissed_at` in the API: 39 open at 00:00 on 9/21 (-03), 5 at 09:00 —
32 fixed, 2 dismissed. Both dismissals were false positives
(`dangerouslySetInnerHTML` on the legal page), not fixes.

What made that night work wasn't the autonomy — it was that every number
was measured afterwards, sequentially, with no agent running, because that
was the night of the `pnpm install` in the middle of the suites.

Bigger work follows a different shape: plan first, approval, phases. The
plan for the instant private app (October 16) opens with what the Next
16.3 docs installed in `node_modules` say — read before proposing — lists
the risks for me to decide on, and was approved on the 17th. Each phase
became a commit, and wherever the implementation drifted from the plan,
the plan itself records the deviation and why. One phase found a real leak
already in production, through a bypass test written **before** removing
the old gate.

What made me comfortable authorizing that night wasn't trust in the agent:
the SDD (Spec Driven Development) was already fully written. The agent
wasn't deciding what to build; it was executing against specs I had
already closed — and against a pipeline that refuses whatever doesn't
pass.

## Where this argument is weak

**The trailer doesn't measure contribution.** 1,076 co-signed commits say
an agent took part, not how much of each diff is its work or how much I
rewrote. And there's no counterfactual: I can't say how many commits Nexo
would have without agents.

**The incidents I list are the ones someone noticed.** The rules table is,
by construction, a list of failures that left a trace.

**Most of the rules aren't in the repository.** "Dependencies last", "one
pushing session at a time", "worktrees off tmpfs" and "two workers" live in
my vault's session notes, not in the code. Only the disposable-database
rule is written in `CLAUDE.md` — and Nexo's `CLAUDE.md` is in
`.gitignore`, so even that isn't public. The quotes above are from the
file as it stands on my machine today.

**The overnight number didn't hold by itself.** Today the same API lists
**16** open code scanning alerts, 11 of them created on October 11, all
Snyk dependency findings. Guardrails catch what someone decided to
measure; new advisories keep arriving, and "39 → 5" is a snapshot of one
day, not a state.

**The same agent gets the same rule right and wrong.** The database case
is the example: the tool that refused to run against the wrong database
on the 9th ran against it on the 22nd. Writing the rule down reduces that;
it doesn't eliminate it.

## What this proves, and what it doesn't

It proves that in a repository where 91% of last month's commits are
co-signed by an agent, the worst defects that surfaced — production without
middleware, account deletion that never worked, an authorization gate with
no proof at all — were found by tests running on the far side of a
boundary and by verification against the real system. It also shows
that the incidents caused by the agent work itself were mostly operational
collisions between processes — and that each became a written-down rule,
even if only one of them made it into `CLAUDE.md`.

It doesn't prove agents make code better or worse — it proves the volume
they produce is only safe behind a [pipeline that won't let red code reach
production](/en/writing/trunk-based-with-a-real-safety-net), and someone who
treats the agent's claims, and their own, as hypotheses.

For me the role didn't shrink, it changed shape. I still model the
software's architecture, sketch ideas and how the pieces fit together —
and I always write the specs the agents follow. The volume in `git log` is
theirs; the design that volume obeys is still mine.
