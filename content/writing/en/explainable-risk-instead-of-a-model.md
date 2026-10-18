---
title: Explainable risk instead of a model — predicting SLA breaches with a points table
description: "To warn before an SLA breaches, the obvious answer was to train a model on ticket history. Steel's ServiceDesk went another way: nine factors with fixed weights, a sum locked at 100 by a test, cuts at 40 and 70, and every factor storing the sentence that explains the score. This is the algorithm, one ticket worked by hand, what it is formally, how the repeated-incident signature is built — and the four gaps that writing this post exposed, now fixed, including a backtest that exists but hasn't run against real data yet."
icon: idea
date: "2026-12-10"
---

In a ServiceDesk, learning that a ticket breached its SLA is only useful
for the monthly report. What changes anything is knowing **before**: a
"this one is going to breach" badge on the board and in the queue, early
enough for someone to move an agent or pick up the ticket nobody owns.
The same need shows up with incidents: five "email is down" tickets in
the same week are probably one problem, and someone should open it.

Steel is Stratus Telecom's multi-tenant platform — ITIL 4 ServiceDesk,
CRM, Communication/WhatsApp, and Steel AI on top of the three. I'm a Lead
Software Engineer at Stratus Telecom: I built the first version of Steel
and now lead its technical modernization. This post is about ADR 0016,
which decided how the ServiceDesk predicts SLA breach risk — and why that
prediction isn't a trained model.

## The obvious answer, and its three costs

The obvious move is to take the ticket history, label what breached and
what didn't, and train a classifier. ADR 0016 lists three costs the
product doesn't pay today:

1. **Customer personal data leaving the database.** Training means
   shipping titles, descriptions, customers and conversations into a
   training pipeline. ADR 0006 had already drawn the opposite line for the
   central AI assistant: no customer personal data in prompts. A training
   pipeline is the same exposure through another door.
2. **Every workspace is a different system.** Phases, SLA policies and
   business-hour calendars are configurable per workspace (ADR 0008). A
   global model learns an average that exists nowhere — "8 hours without
   a reply" is normal for an infra team with a 3-day SLA and a crisis for
   a support desk with a 4-hour one. A per-workspace model fixes that but
   needs history, and a new customer arrives with zero tickets.
3. **A number without a reason doesn't change behavior.** The ADR says it
   better than a paraphrase would: an agent doesn't reshuffle a queue
   because "the AI said 0.82".

The third cost shapes everything else. If the goal is to make someone
act, the prediction has to come with its why — one the agent can confirm
by looking at the ticket.

## The idea: a points table, with the why stored next to it

Instead of learning weights, the ServiceDesk adds up points from a fixed
table versioned in code (`src/lib/servicedesk/risk.ts`). Nine factors,
each with a maximum weight, summing to 100:

| Factor | Measures | Max weight | Scoring |
|---|---|---|---|
| `sla_consumed` | % of the deadline used (business minutes) | **30** | ramp from 50% to 100%; breached = full |
| `unassigned` | no assignee | **12** | ramp from 0 to 4 h since opening |
| `priority` | priority or severity | **12** | position on the workspace's scale |
| `stale` | time since the team's last interaction | **12** | ramp from 8 h to 48 h |
| `reopened` | reopen count | **8** | 1 reopen = half, 2 = full |
| `queue_pressure` | department queue | **8** | 0 at the mean, full at 2× the mean |
| `waiting_third_party` | waiting phase with the clock running | **6** | all or nothing |
| `assignee_load` | assignee's open tickets | **6** | 0 at the mean, full at 2× the mean |
| `history` | customer/service breached before | **6** | one of them = 3, both = 6 |

The score falls into three bands: `LOW` under 40, `MEDIUM` from **40**,
`HIGH` from **70**. And the rule the ADR puts in bold: **the prediction
never shows up without its why**. Every factor that fires stores, in
`SdTicketRiskPrediction.factors`, the pt-BR sentence the UI shows. A
badge without a reason is a bug.

## How it works

### Each factor is a clipped ramp

Almost no factor is binary. The pure library (`risk-compute.ts`) turns
each signal into a fraction between 0 and 1 and multiplies it by the
table weight:

```ts
/** Rampa linear: 0 em `from`, 1 em `full` (os cortes nunca são iguais). */
function ramp(value: number, from: number, full: number): number {
  return clamp01((value - from) / (full - from))
}

function factor(key, ratio, detail) {
  const spec = SPECS[key]
  const share = clamp01(ratio)
  if (share === 0) return null
  return {
    key,
    label: spec.label,
    weight: Math.max(1, Math.round(spec.weight * share)),
    detail,
  }
}
```

Two details matter. A factor at zero **doesn't appear** — there's no
"unassigned: 0 points" in the list of reasons. And a factor with any
positive fraction is worth **at least 1 point**: if the signal exists, it
shows up in the explanation even when rounding would erase it.

The ramp cut-offs live in a separate constant, `SD_RISK_TUNING`. Changing
a weight or a cut is changing the table — no database migration. The
catalog test locks the sum:

```ts
it('should keep the weights adding up to 100', () => {
  const total = SD_RISK_FACTOR_SPECS.reduce((sum, f) => sum + f.weight, 0)

  expect(total).toBe(100)
})
```

### The yardstick belongs to the workspace

"Full queue" and "overloaded assignee" aren't absolute numbers. The
worker loads, per workspace, open tickets per department and per
assignee, and the factor compares against **that workspace's mean**: 0
points up to the mean, full weight at twice it. A team of 3 isn't measured
by a team of 30's ruler. Priority works the same way — the factor reads
the ticket's position on that workspace's scale, `(level − 1) / (max − 1)`,
instead of assuming everyone uses P1–P4. The deadline uses the SLA
module's own clock: business minutes over the calendar, minus phase
pauses. A paused clock scores nothing. And there are two clocks: the
resolution one whenever it has a deadline, and first response while
nobody has answered. The factor scores the **more urgent** of the two (a
breach beats any percentage), and the breach forecast (`breachEtaAt`) is
the deadline that expires **first**.

"Interaction" in `stale` means the team: the worker reads the ticket's
last agent event (`actorKind = AGENT`). Customer messages, Steel AI
actions and system events don't count — if the team never acted, the
silence runs from opening.

### Computed in the worker, read ready-made

None of this runs at render time. The `servicedesk-risk` queue has two
jobs: `recompute-risk`, every 10 minutes (`*/10 * * * *`), recomputes
every open ticket in every workspace with the module on, in batches of
200, writing **one row per ticket** (upsert on `ticketId`); and
`scan-clusters`, hourly at minute 25, handles repeated incidents. Board,
queue and ticket screen just read the stored prediction.

The `sla.breach_predicted` notification fires only when a ticket
**enters** the high band — repeating it every 10 minutes would be spam —
and its body is the sentences of the top three factors, not the score.

## One ticket, worked by hand

A hypothetical ticket:

- opened 6 h ago while the SLA clock was running;
- the policy gives 4 business hours to first response and 8 to
  resolution → first response **breached** 2 h ago, resolution at **75%**;
- nobody has picked it up or answered;
- priority `P2`, level 3 on a scale that goes to 4;
- no team action since it was opened;
- its department has 14 open tickets; the workspace's department mean
  is 8;
- the customer has breached before; the service hasn't.

| Factor | Math | Points | Stored sentence |
|---|---|---|---|
| `sla_consumed` | first response breached → full weight, 1 × 30 | **30** | "Prazo de 1ª resposta já violado" |
| `unassigned` | 6 h / 4 h → saturates at 1 × 12 | **12** | "Sem responsável há 6 h" |
| `priority` | (3 − 1) / (4 − 1) = 0.667 × 12 | **8** | "Prioridade P2" |
| `stale` | 6 h < 8 h → ramp still at 0 | — | — |
| `queue_pressure` | (14 − 8) / 8 = 0.75 × 8 | **6** | "Fila do time com 14 chamados abertos (média do workspace: 8)" |
| `history` | customer only → 0.5 × 6 | **3** | "Este cliente já teve prazo violado antes" |
| **Total** | | **59** | `MEDIUM` |

Fifty-nine points, medium band, and five sentences the agent can check
against the ticket. The breach forecast points at the first-response
deadline, already gone, not at resolution, still 2 h out. Nobody has to
trust the number: "why is this one yellow" is answered by reading one
database row.

I redid this by hand (and checked it by running the library) after the
fixes described under "Where it broke". Before them, the same ticket
scored **44**: the deadline factor only looked at the resolution clock
(75% → 15 points) and the blown first response showed up nowhere in the
score.

The example also exposes a less obvious property of the table. If the
ticket sits until resolution breaches too, the score goes to **60** (the
same 59, plus the point `stale` starts adding after 8 h) — still
`MEDIUM`. The heaviest factor caps at 30, so reaching
`HIGH` requires at least 40 points from the other eight. The test case
that lands exactly on 70 is: breached (30) + unassigned (12) + top
priority (12) + idle for 48 h or more (12) + one reopen (4).

## What this is, formally

Without the ML vocabulary, it's an **additive scoring rule** — the same
family as points-based clinical scores like CHA₂DS₂-VASc: each risk
factor present adds points, the sum lands in a band, the band drives the
response. The difference is that contributions here are graded, not 0/1:

```
score = min(100, Σᵢ round(wᵢ · gᵢ(xᵢ)))
```

where `wᵢ` is the table weight and `gᵢ` is a function clipped to [0, 1] —
almost always a linear ramp. It's a generalized additive model whose
shape functions are written by hand instead of learned. Additivity is
what keeps the explanation honest: the score is **literally** the sum of
the lines on screen, with no hidden interaction between factors.

It also lays out the path to calibrate later, which the ADR mentions and
explicitly reserves for **a new ADR**, not a revision of this one. Each
workspace's history carries the label for free (`resolutionBreached`,
`firstResponseBreached`). A logistic regression over the same shape
functions,

```
logit P(breach) = β₀ + Σᵢ βᵢ · gᵢ(xᵢ)
```

would return one `βᵢ` per factor; rescaled to sum to 100, they become the
new weights of the same table. Factor format, sentences, API contract and
screen wouldn't change — only the "max weight" column. A workspace with no
history would keep today's fixed weights. That's a possible path, not
something done: there's no calibration code in the repository.

## Repeated incidents: a signature, not a similarity

The second half of the ADR applies the same yardstick — deterministic,
auditable, no LLM — to "these incidents are the same thing". The grouping
(`incident-cluster.ts`) computes no text distance. It builds a
**signature** per ticket and groups by exact equality:

```
category:subcategory:service:terms
```

Terms come from the title:

1. normalize: NFD, strip diacritics, lowercase, replace anything outside
   `a-z0-9` with a space;
2. drop words shorter than 3 characters, pure numbers (extension, IP,
   protocol — what varies between tickets groups nothing) and a stopword
   list: Portuguese function words plus generic ticket verbs (`urgente`,
   `favor`, `chamado`, `problema`, `erro`, `ajuda`, `preciso`…);
3. dedupe and, if more than **4** remain, keep the 4 most relevant: first
   the term repeated most in the title itself, then the one found in the
   most incidents of the **observation window**; alphabetical order only
   breaks ties;
4. sort the survivors alphabetically.

Window frequency rather than tf-idf is deliberate: idf rewards rare
terms, which are exactly the ones that don't repeat and so never form a
group. The final sort is what puts "Servidor de e-mail fora do ar" and "E-mail fora do
ar no servidor" in the same group: both become `fora-mail-servidor`. A
title with no meaningful term ("urgente!!!") gets no signature.

A group becomes a suggestion at **3 or more** incidents within **7
days**, stored in `SdIncidentCluster`, unique per
`(workspaceId, signature)`. Suggestion is the key word: the worker never
opens a problem on its own. Opening is the agent's action
(`openProblem`), which creates a `PROBLEM` ticket listing the incidents
and can link them as children. Dismissing is human too — and a dismissed
group is only suggested again once at least 3 more incidents arrive
**after** the dismissal. Otherwise the agent who said "no" would be
overruled every hour.

## Results: what can be measured today

What's verifiable is the contract, not the accuracy:

- **9 factors**, weights summing to **100**, locked by a test;
- **117 tests** across the four pure libraries (`risk.ts`,
  `risk-compute.ts`, `incident-cluster.ts` and the new `risk-backtest.ts`;
  the first three had 80 before the fixes), all passing, including the
  exact cuts (40 lands in `MEDIUM`, 70 in `HIGH`) and the 100 ceiling with
  every factor maxed;
- every stored prediction carries its factor sentences, so every score is
  auditable line by line;
- a useful prediction on a new workspace's first day, since only
  `history` depends on the past — and it's worth 6 points at most.

The comparison against an alternative — a trained model, or even the "at
risk" state the SLA module already had (by default from 80% of the
deadline) — **still doesn't exist**. The tool to measure it now does
(`pnpm risk:backtest`, below), but it hasn't run against real data, so I
have no precision, recall or calibration figure to show.

## Where it broke, and what's already fixed

Writing this post with the code open next to it exposed four gaps. All
four were fixed in
[steel-so/steel#128](https://github.com/steel-so/steel/pull/128) and have
been in staging since 18/10/2026 (Steel `2026.10.18.4`). Weights, bands
and the factor format didn't change; ADR 0016 got an update note instead
of a rewrite.

### What was fixed

**"No team interaction" counted any interaction.** `stale` read
`lastActivityAt`, which also moves when the **customer** writes through
the portal, email or WhatsApp. The sentence said "Sem interação da equipe
há X", but a customer asking "any update?" reset the ramp — the score
dropped exactly when frustration rose. The worker now fetches each
ticket's last agent event, one query per 200-ticket batch; Steel AI and
system events don't count. If that query fails, the batch falls back to
the old behavior instead of treating every ticket as abandoned.

**Only one clock counted.** The deadline factor used the resolution timer
whenever there was one and fell back to first response only when there
wasn't. A ticket at 95% of its first-response deadline and 30% of its
resolution deadline scored zero on `sla_consumed`, and the forecast
showed the later deadline. Now both count while nobody has answered, the
factor takes the more urgent one and the forecast takes the one that
expires first — that's the gap between 44 and 59 in the hand-worked
ticket.

**The signature cut terms alphabetically.** With more than 4 terms, it
kept the first 4 in the alphabet, not the most informative. "VPN cai ao
acessar sistema financeiro remoto" became `acessar-cai-financeiro-remoto`,
and the same title without "remoto" became
`acessar-cai-financeiro-sistema`, a different group. The cut is now by
frequency in the title and in the window. With just those two tickets in
the window, `remoto` appears in only one and drops: both become
`acessar-cai-financeiro-sistema` and land in the same group. `vpn`,
though, is still left out here — it ties with `acessar`, `cai`,
`financeiro` and `sistema` (all in two tickets) and loses the alphabetical
tie-break. It only gets in when it repeats across the window more than
the rest: add a third ticket, "VPN caindo no sistema financeiro", and the
first two become `acessar-financeiro-sistema-vpn` (the third becomes
`caindo-financeiro-sistema-vpn` — with no stemming, `cai` and `caindo`
are different terms).

**There was no backtest.** Weights and cuts were chosen, not fitted, and
nobody had run the heuristic over closed tickets. There's now
`pnpm risk:backtest`, which only reads the database. For each closed
ticket with a deadline it takes three snapshots — at 25%, 50% and 75% of
the way from opening to breach (or close) — recomputes the score from
what was known at each instant, and compares the predicted band with the
real outcome: calibration per band (actual breach rate in `LOW`,
`MEDIUM` and `HIGH`), precision and recall of the high band as an alarm,
and lead time — how long before the breach the ticket reached `HIGH`.

### What's still broken

**The backtest exists but has no results yet.** It hasn't run against
real data, so there's no calibration figure to cite: 40 and 70 are still
judgment, not evidence. The example above shows the table leaving an
unassigned ticket with a blown first response at `MEDIUM` — that may be
right, or not, and only the history will tell. And even once it runs,
the figure will be biased low on three factors. The root cause is that
ticket history isn't versioned: the script doesn't rebuild each past
instant's phase or SLA pause (it assumes an in-progress phase with the
clock running) and recounts queue and load from the sample alone. So
`waiting_third_party`, `queue_pressure` and `assignee_load` come out
understated.

**The score isn't a probability.** The ADR locks the sum at 100 so the
score reads "as a percentage" — of the maximum points, not of the chance
to breach. 59 doesn't mean 59%. In practice even 100 is unreachable:
`unassigned` and `assignee_load` are mutually exclusive (one needs no
assignee, the other needs one), so the real ceiling is **94** without an
assignee and **88** with one.

**Correlated factors double-count.** An additive model assumes each line
brings new information. An unassigned ticket is almost always also idle
and burning deadline — three factors scoring the same fact. A regression
would absorb that into the weights; a hand-written table doesn't.

**The incident signature is still brittle at the edges.** The frequency
cut has an accepted cost: the signature of a title with more than 4 terms
can change as the window moves — the alphabetical cut was stable, just
arbitrary. There's no stemming
("impressora" and "impressoras" differ), the ticket body is ignored, and a
miscategorized incident never meets its group, because category,
subcategory and service are part of the key. Exact equality was
deliberate — any grouping can be explained by reading the signature — but
the price is recall.

## What this proves, and what it doesn't

It proves you can ship SLA risk prediction that's explainable by
construction, without moving customer data out of the database and
without needing history to work on day one: the score is the sum of the
sentences on screen, and any "why is this red" is answered by reading one
row. It also leaves the format ready for future calibration without
changing the contract — which is design, not a result.

It doesn't prove the heuristic predicts well. The tool to measure it now
exists but hasn't run against real data: there's no calibration,
precision or recall figure, no comparison with the "at risk" state that
already existed, and 40 and 70 still haven't been checked against a
closed ticket.
What exists today is an explainable yardstick to **prioritize a queue** —
the goal the ADR itself sets — not a validated prediction of who will
breach.
