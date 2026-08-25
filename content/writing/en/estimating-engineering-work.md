---
title: How I estimate a software engineer's work (including my own)
description: "Sean Goedecke calls software estimation a 'polite fiction' — and he's right about a good chunk of the work. This post draws the exact line where he's wrong: task breakdown, the Cone of Uncertainty, throughput simulated with Monte Carlo, and what PMBOK, Kanban, Scrum, SAFe, CMMI, XP and DSDM actually prescribe about estimation — the same process I use for my team and for my own work."
icon: idea
date: "2026-08-23"
---

Every time someone asks "how long will this take", the most common wrong
answer is a multiplication: 3 engineers, 40 hours each, 120 hours, done in
so many days. The math looks solid — it has people, hours, a date — but it's
already wrong at the premise: 40 hours of an engineer's time isn't 40 hours
of code.

The clearest data point on this comes from Software.com's (now Antenna)
Code Time Report, aggregating over 250,000 developers across 201 countries
between July and October 2021: median active coding time is **52 minutes a
day**. Add other in-editor activity (review, reading docs) and the total
climbs to 93 minutes — still just **19% of an 8-hour day**. The rest — 387
minutes, 81% of the day — is meetings, messages, admin overhead, and the
cost of context-switching.

![Out of an 8h workday, how much actually becomes code: 52 min (11%) active coding, 41 min (9%) other editor work, 387 min (81%) outside the editor — median across 250k+ devs, Software.com/Antenna, Jul-Oct 2021](/img/estimating-engineering-work/en/where-the-engineer-hour-goes.png)

The number moves between studies — a 2019 Microsoft Research paper ("Today
Was a Good Day: The Daily Life of Software Developers", Meyer, Barr, Bird
and Zimmermann, IEEE Transactions on Software Engineering, 5,971 responses
from Microsoft's own professional developers) cites prior findings ranging
from 9% to 61% coding time, depending on how each study defined "coding"
and how it collected the data. None of those numbers get anywhere near
100%. Multiplying "40 hours" by "number of engineers" treats the work week
as if it were entirely the small slice — code — when meetings, support,
review, incidents and time off eat into the same calendar.

After estimating wrong this way often enough, I landed on a process I use
for any task — from a small bug to my own work in a sprint. It doesn't
remove uncertainty. It swaps guesswork for measurement at every step:
breakdown, sizing, history, and a formal check before I commit to a date.

## The objection I can't wave away

There's a serious argument — not a complaint from someone who dislikes
deadlines — against the entire process I'm about to describe. Sean Goedecke
puts it this way, in a post about what he calls the "polite fiction" at the
heart of the software industry
([seangoedecke.com/how-i-estimate-work](https://www.seangoedecke.com/how-i-estimate-work/)):

> Estimating how long software projects will take is very hard, but not
> impossible. A skilled engineering team can, with time and effort, learn
> how long it will take for them to deliver work, which will in turn allow
> their organization to make good business plans.

Goedecke isn't endorsing that sentence — he calls it a "polite fiction" and
immediately says it's false. His argument: in large systems, most of the
real work is research and discovery, not execution of predefined tasks —
and only known work can be estimated. Unknown work, in his words, "always
takes 90% of the time", and no amount of upfront planning fixes that,
because real architecture decisions require touching actual code, not a
plan about it. His conclusion is that estimation mostly functions as a
political tool — allocating resources, prioritizing projects — not a
technical forecasting mechanism.

He's right about a real slice of engineering work. He isn't right about all
of it. Everything I describe below only holds inside a specific boundary —
decomposable work, with an established delivery pattern that generates
history — and that boundary is exactly where Goedecke's objection stops
applying. "Build an auth system" is known work: someone has already built
login and signup hundreds of times before. Genuine research — "I don't know
if this approach works", not "how long does it take to do the thing I
already know works" — is his territory, not mine, and I come back to that,
directly, in the limitations section below.

## The problem: a big task isn't estimable, it's a bet

"Build an auth system" isn't a task — it's a label for several different
tasks, with completely different risks and sizes, disguised as a single
backlog line. Nobody estimates that well, because there's nothing coherent
to estimate: it's too large to have a size.

That's not just intuition. It's what Steve McConnell documented as the
**Cone of Uncertainty**: the possible error in an estimate shrinks as the
project moves forward and concrete decisions eliminate variability — not
because someone "refines" the same estimate, but because the project itself
becomes less variable. At "Initial Concept" — the stage where "Build an
auth system" usually gets dropped into a backlog — an estimate made by a
competent team can still be off by a factor of **4x high or 4x low**, a
total range of 16x between best and worst case.

![The Cone of Uncertainty: how much an estimate can be off by project phase, from 4x/0.25x at initial concept down to 1x at software complete (McConnell/Construx)](/img/estimating-engineering-work/en/cone-of-uncertainty.png)

The cone only narrows when real decisions eliminate variability — deciding
what the product won't do, locking a requirement, designing the interface.
Breaking "Build an auth system" into smaller pieces is, in practice, forcing
those decisions to happen earlier, one at a time, instead of leaving all
the uncertainty stacked behind a single number:

```
Auth
├── User model
├── Sign-up
├── Login
├── JWT / session
├── Password recovery
├── Frontend integration
├── Tests
├── Logging and monitoring
└── Deploy
```

Only once it's broken down does each piece turn into a number — here, eight
of the nine parts get their own estimate; logging and monitoring folds into
deploy effort instead of standing as its own line:

| Item | Estimate |
|---|---|
| User model | 4h |
| Sign-up | 6h |
| Login | 6h |
| JWT | 4h |
| Password recovery | 8h |
| Frontend | 8h |
| Tests | 6h |
| Deploy | 4h |

Total: **46h**. On top of that goes an uncertainty margin — not because I
distrust the sum, but because every task carries risk that only shows up
during execution (a library that doesn't behave like its docs promise, a
requirement that shifts midway). I use **20%** as a standard contingency:
46h + 20% = **55h**. That number, not the raw 46h, is what becomes a
commitment.

## Size in Fibonacci, and split again past 13

Hours are a bad unit for communicating uncertainty — "6 hours" sounds
precise even when it isn't. So at the team level (not just my own
individual breakdown), I size each task on the Kanban scale: `1, 2, 3, 5,
8, 13, 21`.

The growing gaps are the point: the difference between `1` and `2` is small
because uncertainty at that size is small, but the difference between `13`
and `21` is large because, at that size, uncertainty stopped being linear a
while ago. This is a rule, not a preference: **any task that lands on 13 or
21 has to be split before it enters a sprint**. If it can't be split into
smaller pieces, that's a signal nobody understood the task well enough to
size it — and that's information, not just refinement bureaucracy.

## Let history predict the date, not intuition

Sizing a task solves relative size. It doesn't solve "when does it ship" —
for that, I use the team's own historical data, not an opinion about how
fast we feel like working this time.

Two metrics do that work: **average velocity per sprint** (how many points
the team historically closes per cycle — with a 23-point average, a
46-point feature isn't "an optimistic two weeks", it's two sprints, full
stop) and **throughput** (how many tasks ship per unit of time, regardless
of each one's size). Throughput is what feeds a better technique than
projecting the average with a ruler: Monte Carlo simulation over real
history, popularized in the Kanban world by Troy Magennis (*Forecasting and
Simulating Software Development Projects*) and Daniel Vacanti (*Actionable
Agile Metrics for Predictability*).

The method, in practice: instead of assuming "throughput = 13 tasks/week,
so backlog/13 = deadline", I repeatedly resample, **with replacement**,
from the weeks of throughput actually observed, and add them up until the
backlog is cleared. Repeat that thousands of times and read the resulting
distribution, instead of a single number. For a team with this 12-week
history — `9, 14, 11, 16, 10, 13, 15, 8, 17, 12, 14, 17` tasks (averaging
exactly 13) — and a 60-item backlog, I ran 20,000 simulations:

| Timeframe | Chance of finishing by then |
|---|---|
| 4 weeks | 10.1% |
| 5 weeks | 79.6% |
| 6 weeks | 99.5% |
| 7 weeks | 100% |

![Monte Carlo simulation over historical throughput, 20,000 runs: 10.1% finish in 4 weeks, 79.6% in 5, 99.5% in 6 — the 85%-confidence line lands at 6 weeks](/img/estimating-engineering-work/en/monte-carlo-forecast.png)

With this specific history, the **85%-confidence window closes at 6
weeks** — not because I picked 85% to land on a tidy number, that's the
percentile the simulation actually returned. It carries information a
simple average (60/13 ≈ 4.6 weeks) doesn't: there's a real tail, however
small (0.5% of runs go past 6 weeks), where the team's normal variance — a
bad week, a sprint with more people on vacation — stretches the timeline.
Promising "4.6 weeks" hides that tail. Promising "up to 6 weeks, at 85%
confidence" doesn't.

## Checking it against PMBOK before signing off

Kanban handles the team's day-to-day. But throughput and lead time are
local metrics — they only mean something to someone who already knows that
specific team's history. The moment an estimate leaves the team and becomes
a number a PMO, a client, or leadership will hold you to later, I translate
it into the vocabulary medium and large companies actually use for this:
PMBOK, from the Project Management Institute (pmi.org). Not because it's
superior to Kanban — because it's the standard that survives the context
switch, for whoever reads the estimate without having sat in the
refinement call.

Most of what I already described above is PMBOK, just without the formal
name:

- Breaking auth into summed subtasks is **bottom-up estimating** —
  building the total from the parts, not sizing the whole thing at once.
- The 20% contingency on top of the 46h is **reserve analysis** — a
  contingency reserve for known risk, distinct from a management reserve
  for unknown risk.
- Applying historical throughput to remaining scope to project a date is
  **parametric estimating** — a historical rate multiplied by the amount
  of work left.

What I add as a formal checkpoint is **three-point estimating** (PERT):
optimistic (O), most likely (M), pessimistic (P), combined as

```
E = (O + 4M + P) / 6
```

For the auth estimate, with O = 38h, M = 46h (the same total from the
breakdown) and P = 70h, that gives E ≈ **48.7h**, with standard deviation
σ = (P − O) / 6 ≈ **5.3h** — a range of roughly 43h to 54h at ~68%
confidence. The 55h that came out of the 20% contingency lands inside that
range, near the top.

![PERT (beta) distribution for the auth estimate: optimistic 38h, most likely 46h, pessimistic 70h, E=48.7h — the bottom-up estimate with contingency lands inside the distribution's right tail](/img/estimating-engineering-work/en/pert-beta-auth.png)

If the bottom-up estimate with contingency had landed outside the PERT
range, that would signal either that the breakdown missed a risk, or that
the pessimistic scenario is miscalibrated — not a cue to pick whichever
number and move on. I use the same cross-check on the throughput
probability window: when the parametric estimate (the Monte Carlo
simulation) and the three-point estimate don't overlap, that's a signal to
investigate before promising anything — usually because the history is
carrying an atypical sprint (a month with zero incidents, say) that
shouldn't repeat, or because the back-of-the-envelope pessimist isn't
taking seriously a variance the data has already shown can happen.

## Seven frameworks, the same core baked in

PMBOK isn't an eccentric outlier choice. I went straight to the official
material of the most-used delivery frameworks — and none of them treats
"estimating" as guessing a number; all of them, in different vocabularies,
converge on some version of breakdown + history + margin:

| Framework | How it officially estimates | Role of history |
|---|---|---|
| **PMBOK** (PMI) | Bottom-up, parametric, three-point (PERT), contingency reserve | Feeds parametric estimating and reserve analysis |
| **Kanban** (Kanban University) | Doesn't estimate effort — measures lead time, cycle time and throughput of real flow | Flow history *is* the forecast, not an input to one |
| **Scrum** (Scrum Guide 2020) | "Sizing" the backlog item — the guide prescribes no unit or technique | Left open; the community uses historical velocity by convention, not by rule |
| **SAFe** (Scaled Agile Framework) | Story points per user story, rolled up into capacity per Program Increment | Historical velocity across past PIs becomes the next PI's reliable capacity |
| **CMMI** (CMMI Institute/ISACA) | Statistical process performance baseline, required from maturity level 4 up | Formal, statistical history is a prerequisite, not an accessory |
| **XP** (Kent Beck) | "Ideal engineering days" per story, adjusted by a calendar load factor | The load factor is calibrated by watching what the team actually delivered in past iterations |
| **DSDM** (Agile Business Consortium) | Doesn't estimate scope duration — fixes time/cost/quality and prioritizes with MoSCoW (60/20/20) | Flips the logic: instead of estimating how long the scope takes, it decides how much scope fits the time already fixed |

The most telling detail is Scrum's: the 2020 Scrum Guide removed the word
"estimate" from the official text and switched to talking only about
"sizing" — not because estimating stopped mattering, but because the
organization behind the framework recognized that tying one specific
technique (story points, planning poker) to the guide created the illusion
that the technique was mandatory, when what actually matters is the team
having *some* consistent way to size work. DSDM goes the opposite,
more radical direction: instead of asking "how long does this take", it
fixes the time and turns the question into "how much of this scope fits
the time we already have" — the Cone of Uncertainty applied in reverse,
negotiating scope instead of deadline.

## From backlog to align-call: epic, feature, user story, task

All of this gets organized into a fixed format for aligning with the team
and whoever depends on the delivery: `epic → feature → user story → task`.
Every level inherits the aggregated estimate from the levels below it,
never the other way around — an epic doesn't get a number "off the top of
someone's head", it's the sum of what's already been broken down and sized.

Every task estimate always accounts for the same seven categories of
effort, even when one of them is small:

- code
- tests
- review
- refactoring
- integration
- deploy
- documentation

Forgetting one of these categories is the most common way an estimate looks
right on paper and breaks in practice — review and documentation are
usually the two that get left out, and the two that generate the most
silent delay afterward.

## Worked example: a payment gateway with three engineers

Feature: integrate a new payment gateway. After refinement, broken into
user stories:

| Story | Points |
|---|---|
| Set up credentials | 2 |
| Build integration | 5 |
| Build webhook | 5 |
| Build error flow | 3 |
| Write tests | 3 |
| Update frontend | 5 |

Total: **23 points**. This team historically delivers between **20 and 25
points per sprint**. Conclusion: the feature fits in a two-week sprint —
not because there are three engineers and "40 hours × 3 = 120 hours" makes
a tidy number on paper, but because 23 points sits inside the range this
specific team, with this specific composition, historically manages to
close.

## Where this method breaks

It depends on history — throughput, velocity, lead time. A brand-new team,
or one entering a domain genuinely new to it, has no such distribution to
consult, and borrowing an average from "some similar team" just
reintroduces the same opinion-disguised-as-data the method exists to avoid.
In those cases, the first sprints only exist to build the history — the
real estimate only starts being trustworthy after that.

This is exactly where Goedecke's objection comes back at full strength.
Genuine research work — the kind of task where the honest answer is "I
don't know if this works", not "how long does it take to do the thing I
already know works" — escapes the model entirely. Throughput measures
repetition of known work; it doesn't measure outcome uncertainty. No amount
of refinement, breakdown, or Monte Carlo simulation turns "let's see if
this approach works" into a sizeable task — and insisting on putting a
number there is exactly the polite fiction he describes.

Estimating your own work, specifically, carries a bias the method doesn't
correct by itself: the person who breaks down the task and the person who
executes it are the same person, so the incentive to look fast exists even
without meaning to. My defense is breaking down my own work with the same
seven-category checklist (code, tests, review, refactoring, integration,
deploy, documentation) I apply to the team, instead of giving myself a
discount I'd never give anyone else.

## What this process solves, and what stays a judgment call

It fixes the systematic error in the multiplication math: big tasks turn
small, small tasks turn into numbers with built-in contingency, and the
final date comes from a real distribution of past deliveries, not
optimism. That's why a range like "85% confidence within 6 weeks" is more
honest than a single date — it admits upfront that a tail of cases exists
where it doesn't hold, instead of hiding that tail behind a round number.

It doesn't solve how much risk is acceptable for a given deadline — that
stays a judgment call for whoever decides (me, the team, whoever's asking
for the delivery), not something a formula outputs. And it doesn't solve
Goedecke's core point: for genuinely unknown work, no technique in this
post — not PMBOK, not Monte Carlo, not the seven frameworks in the table
above — replaces admitting nobody knows yet. The entire value of the
process is in separating those two categories of work before estimating,
not in pretending a good-enough formula erases the difference between them.
