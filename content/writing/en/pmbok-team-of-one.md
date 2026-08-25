---
title: How I applied PMBOK solo at Nexo
description: "One issue stayed alive for 88 days without ever having an estimate or a due date — not late, invisible, because there was no target to miss. I applied PMBOK adapted for a one-person team at Nexo: a 77-issue WBS, PERT, a risk register, a scope-change process — and cut half the framework because it solves a problem a one-person team doesn't have. This is what survived, what I dropped, and why."
icon: idea
date: "2026-08-24"
---

`STR-80`, "Your Work — the user's personal view", was created on May 29,
2026 at Nexo. It only entered progress 55 days later, on July 23, and has
stayed `In Progress` until today, August 24 — 32 more days. Eighty-eight
days alive, and at no point in those eighty-eight days did this issue have
an estimate or a due date.

That's not "we estimated X, it shipped at Y." It's worse: there was never an
X. I couldn't say `STR-80` was late, because late relative to what. It was
just sitting there, indefinitely in progress, and the only way to notice
something was wrong was for me to remember I'd opened it almost three
months earlier.

That's the starting point of this post: what I applied from PMBOK at Nexo
today, `day zero` of the formal process — what stayed, what I cut, and why
I cut it.

## The problem: 37 issues with no way to know what was late

Before today, Nexo's Linear board had 37 issues in a flat backlog. None had
a milestone. None had a cycle (sprint). None had an estimate. None had a
due date. The closest thing to prioritization was the `Priority` field —
`High`/`Medium`/`Low` — with no structure behind it deciding what that
priority actually meant in terms of timeline.

![Nexo's backlog state before the process: 37 issues, and zero in every category that would let anyone measure delay — milestone, cycle, estimate, due date](/img/pmbok-team-of-one/en/before-no-measurement.png)

`STR-80` isn't an isolated case. The same day it was created, I opened two
urgent security issues — `STR-96` (upload with no auth) and `STR-61`
(consent bypass) — both closed roughly five days later, competing for the
same window of attention. It's plausible those two pushed `STR-80` to the
back of the queue for 55 days; I can't prove that causality from the Linear
data alone, it's an inference, not a recorded fact. What is a fact: nothing
in the process would have warned me either way, because there was no
process to warn me.

I also can't build an honest baseline for "% of tasks delivered on time
before the process," because no historical issue ever had a recorded due
date to compare against. The fact that this number doesn't exist is itself
the argument: the problem wasn't shipping late, it was having no way to
know.

## The idea: apply only the part of PMBOK that solves a problem I have

The temptation reading the full PMBOK Guide (PMI) is to implement all of
it — ten knowledge areas, five process groups, dozens of artifacts. That's
designed to coordinate multiple people and stakeholders with divergent
interests: a sponsor who wants budget under control, a client who wants
fixed scope, a team that wants a realistic deadline, a PMO that wants
traceability.

Nexo today is 1 person — me, founder engineer, who is also the one who
estimates, executes, reviews, and decides priority. Most of PMBOK solves a
pain that arrangement doesn't have: there's no sponsor to convince, no
vendor to negotiate with, no stakeholder besides me reading my own board.
I applied only the fraction that attacks the real problem — not knowing
something like `STR-80` was stuck — and deliberately dropped the rest, not
out of laziness. The limitations section at the end of this post lists
exactly what I cut and why.

## WBS: from all of Nexo down to 77 leaf issues

The first artifact I built was a three-level WBS (work breakdown
structure): Project → 5 Milestones (`M0`–`M4`) → 9 Epics → 77 leaf issues.
Documented in [Nexo — WBS & PERT](https://linear.app/str4tus/document/nexo-wbs-and-pert-3cdaec1875ed),
plus the hierarchy itself lives in Linear's structure.

| Level | Count |
| --- | --- |
| Milestones | 5 (`M0`–`M4`) |
| Epics | 9 |
| Leaf issues | 77 |

I didn't create a formal WBS Dictionary — the detailed per-element sheet
(acceptance criteria, resources, assumptions, each in its own document)
that PMBOK prescribes. What exists is each issue's description, much
thinner: a tooltip with the essentials and the three estimate numbers
(optimistic/most likely/pessimistic). With 77 items and 1 reader — me — a
full dictionary would be documentation nobody would ever open.

## PERT: from optimistic/most-likely/pessimistic to dev-day

Each of the 77 leaf issues got three estimates — optimistic (O), most
likely (M), pessimistic (P) — combined with the PMBOK Guide's PERT formula:

```
E = (O + 4M + P) / 6
```

A "dev-day" in this math equals 8h of software focus: 4.5h of active
coding plus 4.5h of code review and deploy. That's separate from
product-focus time — marketing, meetings, social media — which doesn't
enter this count. It's the same distinction I made in the previous post
about estimation: the estimate covers the engineering work, not the
founder's whole day.

Summed across the 77 leaf issues, the base is **297 dev-days**. With
contingency applied per milestone — the same 20% reserve from the previous
post, calculated on each milestone's own variance, not one flat number
applied equally everywhere — the total climbs to **356.4 dev-days**, or
**2,851.2h**. Spread across 15-day sprints, that's **44 sprints**.

## Risk register, charter, and the end of "I decide on the spot"

Beyond the WBS and PERT, I formalized three things that used to live only
in my head:

- **Risk register** — [10 risks cataloged](https://linear.app/str4tus/document/nexo-risk-register-14ce7f312363)
  as of today, scored by probability × impact (1–9 scale). None has
  "become fact" yet, because the register was created today — it's
  predictive, not a retrofit over incidents that already happened. I only
  did the qualitative analysis; the quantitative one (Monte Carlo, EMV)
  needs velocity history that doesn't exist yet, or tooling
  disproportionate for 10 risks.
- **Project charter** — [a single charter](https://linear.app/str4tus/document/nexo-project-charter-9c6a5e9667b5)
  for Nexo as a whole product, not one per epic. One per epic would be
  overkill at this scale; before this, the "charter" was 100% implicit —
  whatever was in my head.
- **Scope-change process** — [formalized today](https://linear.app/str4tus/document/nexo-processo-de-mudanca-de-escopo-b71a457d2d65).
  Before, scope changes were "decide on the spot." The new rule: any
  change that burns more than 10% of a milestone's buffer forces a
  recalculation of every subsequent milestone's dates.

There's no Change Control Board — the committee PMBOK prescribes to
approve changes. I simplified that to "1 person decides," because there's
no second person to form a board with.

## Why only SV/SPI, not CPI/CV

Of the Earned Value Management metrics, I only track `SV` (Schedule
Variance) and `SPI` (Schedule Performance Index). I deliberately don't
track `CPI` (Cost Performance Index) or `CV` (Cost Variance).

Cost is worth tracking when someone — finance, a client, a sponsor — needs
to know if their money is being well spent. At Nexo, that "finance person"
and the person doing the work are the same person. `CPI` would measure me
against myself, with no new decision that number would unlock. Schedule is
different: knowing a delivery is 25% late changes what I do tomorrow.
Knowing "I spent X of myself" changes nothing.

## What the numbers can prove, and what they can't — yet

This matters to say plainly: the process took effect today. `Cycle 1`
starts today, August 24. Zero sprints have closed as of this moment — so
there's no real measured "before vs. after" to show. Any post claiming
"this cut delay to X%" would be inventing a result that hasn't happened
yet.

What I have is a simulation: I ran the 44 planned sprints with simulated
execution variance layered on top of each PERT estimate, to see what shape
the `SV`/`SPI` dashboard will take once real data starts arriving. This
isn't a prediction that the process will work — it's the equivalent of
turning the dashboard on before there's real data, to make sure it shows
what I actually need to see.

| Cycle | Dates | Delivery | Planned | Simulated | Deviation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 08/24–09/07 | Cycles | 25.5h | 24h | −5.9% | on time |
| 1 | 08/24–09/07 | Modules | 25.5h | 27h | +5.9% | on time |
| 2 | 09/07–09/21 | Project pages | 41.5h | 45h | +8.4% | on time |
| 2 | 09/07–09/21 | Support channels | 8.5h | 9h | +5.9% | on time |
| 3 | 09/21–10/05 | Layouts | 16h | 15h | −6.3% | on time |
| 3 | 09/21–10/05 | Progress overview | 25.5h | 30h | +17.6% | late |
| 3 | 09/21–10/05 | Power-K | 16h | 14h | −12.5% | on time |
| 4 | 10/05–10/19 | Visualizations | 25.5h | 28h | +9.8% | on time |
| 4 | 10/05–10/19 | Usage dashboard | 25.5h | 33h | +29.4% | late |
| 5 | 10/19–11/02 | RBAC | 25.5h | 26h | +2.0% | on time |
| 5 | 10/19–11/02 | Guests | 41.5h | 52h | +25.3% | late |
| 6 | 11/02–11/16 | Import Jira | 41.5h | 58h | +39.8% | late |
| 6 | 11/02–11/16 | Import CSV | 25.5h | 24h | −5.9% | on time |
| 7 | 11/16–11/30 | Import Linear | 41.5h | 44h | +6.0% | on time |
| 8 | 11/30–12/14 | Import Asana | 41.5h | 60h | +44.6% | late |
| 9 | 12/14–12/28 | Import ClickUp | 41.5h | 43h | +3.6% | on time |

![Simulated planned vs. simulated hours per delivery, Cycles 1 through 9 — not real data, it's a dry-run of the tracking mechanism before any cycle has closed](/img/pmbok-team-of-one/en/simulation-planned-vs-actual.png)

![Percent deviation per delivery in the simulation, sorted, with the 15% line marking the threshold between on time and late](/img/pmbok-team-of-one/en/simulation-deviation.png)

In this simulation, 11 of the 16 deliveries — **~69%** — land on time, with
a mean absolute deviation of **14.3 percentage points**. That doesn't
prove anything about Nexo. It proves that the PERT formula with
per-milestone contingency, run against a plausible execution variance,
produces a readable dashboard — I know before any real sprint closes what
"late" will mean and how I'll see it. That's a lot less than "the process
works." It's the minimum needed to know I'm measuring the right thing.

The real, verifiable result I have today is a different one, and it's in
the next section.

## Where this framework breaks for a team of one

The root cause behind almost everything I cut from PMBOK is the same: most
of the framework exists to coordinate multiple people with divergent
interests. With 1 dev who's also the product owner, that problem doesn't
exist — it's not that the practice is too much work, it's that it solves
a pain Nexo doesn't have today.

- **`CPI`/`CV` dropped, not simplified.** Already explained above: cost
  tracking makes sense when someone else needs to know their money is well
  spent. There's no one else here.
- **Procurement Management not applicable, not scaled down.** There's no
  vendor or contract being negotiated — infra (Postgres, Redis, BullMQ) is
  already provisioned. There's nothing to "procure."
- **Stakeholder Register and Communications Management Plan dropped.**
  These practices map who needs to know what and when. With 1 stakeholder,
  the "communications plan" is me reading my own Linear.
- **Formal Quality Management Plan simplified.** I reused the gate that
  already existed — `pnpm test:all` and `check:ci` in the pre-commit hook —
  instead of building a PMBOK quality layer on top of a control that
  already works.
- **Change Control Board simplified to "1 person decides."** Documented in
  the scope-change process. There's no board because there's no second
  person to form one with.
- **Quantitative risk analysis not done.** Only the qualitative one
  (probability × impact). The quantitative version needs velocity history
  that doesn't exist yet, or tooling disproportionate for 10 risks.

And the real, measured cost of setting all this up: today's entire
session — designing the WBS, running PERT on the 77 issues, auditing code
against the pricing catalog, and 127 write calls just on Linear execution
(5 milestones, 9 epics, 77 issues, 4 documents) — produced zero lines of
product code. For a one-person team, that's a full day of capacity spent
on process, not on the backlog the process exists to organize. I don't
know yet whether that was an investment or waste; I'll only know once the
first sprints close.

There's also a risk I registered but that hasn't happened yet: the rule
that recalculates every subsequent milestone when a change burns 10% of a
buffer. On a large team, that's healthy — everyone depends on updated
dates. With 1 dev, it could turn into an expensive ritual for small
changes — the kind of rule that looks like discipline on paper and turns
into friction in practice. I'll test it over the first sprints and cut it
if that's confirmed.

The two "before" issues — `STR-80` and the security bugs — don't work as
an example of "process getting in the way," because they happened before
the process existed. It wasn't the process that delayed that work, it was
the absence of one. Mixing the two would weaken the argument.

## What this proves, and what it doesn't yet

It proves that PMBOK's central problem — coordinating divergent interests
— doesn't disappear when the team is one person, it changes shape. The
real target here wasn't "make delivery more predictable for a boss." It
was making visible to myself what was already invisible: `STR-80` wasn't
late because nobody measured it — it was late, and no one, not even me,
could see it.

It doesn't prove that variance will improve, that estimates will get more
accurate, or that the cost of keeping this process is worth it long-term
for a team this size. That data doesn't exist yet — `Cycle 1` starts
today. That's the next post, once the first real cycles close and I have
actual `SV`/`SPI` to compare against this simulation.
