---
title: Teaching a cluster of paraconsistent neurons to triage vulnerabilities
description: How a hierarchical cluster of LPA2v neurons cut a simulated AppSec pipeline's false positives from 2,493 to 0, and what it did (and didn't) confirm against real findings.
icon: bug
date: "2026-08-18"
---

Any AppSec pipeline with a bit of maturity hits this wall: SAST, SCA and DAST
running on every commit, and a findings queue nobody trusts anymore. A scanner
that flickers between runs, a dependency flagged mid-way through a planned
migration, an endpoint SAST flags as vulnerable that DAST can't even reach
because there's a WAF in front of it. Each tool decides on its own, against an
isolated severity threshold, and the result is alert fatigue — the team stops
paying attention to the queue, because most of it is noise.

That's the problem I turned into my undergraduate thesis: instead of one more
`IF-THEN` rule to suppress a known noise pattern, try a mechanism that treats
contradictory evidence as contradictory evidence, not as a tie that has to be
resolved on the spot.

## The blind spot in both existing models

The two conventional ways to decide what becomes an alert:

- **Threshold** — any finding that crosses an isolated severity limit (CVSS ≥
  7, any SAST match) fires an alert. Simple, but ignores context entirely.
- **Rule-based** — combines exceptions defined ahead of time (test code, known
  maintenance windows, patches with no known exploit). Cuts some noise, but
  only covers what someone already thought to exempt. A new WAF in front of an
  endpoint, a scanner that starts flickering — none of that is on the
  exception list until someone notices the pattern and writes the rule.

The structural problem with both is that they're **binary**: every finding is
forced to land on one side, real or not-real. When SAST says "vulnerable" and
DAST says "can't confirm, blocked by a WAF", a binary mechanism has to discard
one of the two signals — usually silently, with no record that a contradiction
even happened.

## The idea: don't force the tie

Paraconsistent annotated logic with two values (LPA2v) starts from a different
premise: for a proposition P ("this finding is a real vulnerability"), there
are two independent evidence degrees — favorable (µ) and unfavorable (λ) — and
they don't have to sum to 1. Two derived values follow:

- **certainty degree**: `GC = µ − λ`
- **contradiction degree**: `GCT = µ + λ − 1`

When `GCT` is high, the system isn't "uncertain" in the sense of missing data —
it's receiving strong, opposing signals at the same time. That's exactly the
WAF case: SAST with high µ (found a vulnerable pattern in code), DAST with high
λ (tried to exploit it and got blocked). That's not noise to discard, it's a
genuine **inconsistent state** that deserves to be flagged as such.

## Architecture: specialized neurons plus a master neuron

The hierarchical cluster I built has one paraconsistent neuron per evidence
domain — SAST, SCA, DAST, code context, operational context — each estimating
its own (µ, λ) pair from that domain's signals (severity, confidence, runtime
reachability, patch availability, exploit maturity, public exposure, low-traffic
environment, and so on).

A master neuron aggregates those pairs two different ways, for two different
purposes:

1. **Weighted average of µ and λ** across domains — used for severity ranking.
   This decides whether a finding is "attention" or "critical".
2. **Max µ and max λ across the primary detectors** (SAST/SCA/DAST) — used
   specifically to detect genuine contradiction. A simple average here would
   dilute real contradiction: if three domains agree and one strongly
   disagrees, the average hides the disagreement. The max doesn't.

Before emitting a final classification (`normal`, `attention`, `degradation`,
`critical` or `inconsistent`), the cluster requires **three scan ticks of
temporal persistence** — a finding has to hold across consecutive runs before
escalating, which is what makes a flaky scanner (one that flips
finding/no-finding for no real reason) stop producing noise without anyone
writing a rule for that specific case.

## The simulator and the numbers

To test the architecture without depending on a real pipeline right away, I
wrote a TypeScript simulator: 206 synthetic assets across twelve representative
scenarios (dependency migration with expected noise, WAF-protected endpoint,
progressive secret leak, authorized pentest window, flaky scanner, confirmed
RCE, internal-network SQL injection, among others), totaling 3,005 events.

Comparing all three mechanisms on the same simulated scenario:

| Mechanism | Precision | Recall | False positives |
|---|---|---|---|
| Threshold | 8.0% | 86.8% | 2,493 |
| Rule-based | 10.4% | 86.8% | 1,868 |
| **LPA2v cluster** | **100%** | **65.6%** | **0** |

![Precision, recall and F1-score by mechanism: threshold at 8%, rule-based at 10.4%, LPA2v cluster at 100% precision](/img/lpa2v/en/metrics.png)

False positives went from 2,493 (threshold) to zero — and that reduction
wasn't blind suppression: the cluster still caught 164 of the 250 simulated
positive cases. The real cost was recall, which dropped from 86.8% to 65.6%,
concentrated deliberately in three adverse scenarios — evidence from a single
domain, a progressive leak with a weak initial signal, and the warm-up period
of temporal persistence itself (the same mechanism that holds back noise also
delays the first real detection).

![True positive, false positive and false negative volume by mechanism: false positives drop from 2,493 under threshold to 0 under the LPA2v cluster](/img/lpa2v/en/error-volume.png)

In the WAF-protected endpoint scenario, all 300 events were classified as
`inconsistent` — neither confirmed nor dismissed — while threshold and
rule-based classified the entire batch as degradation: a consistent false
confidence, exactly the kind that teaches a team to ignore the queue.

![Asset-by-time heatmap for the waf-shield scenario: threshold and rule-based solid blue (degradation), LPA2v cluster solid purple (inconsistent)](/img/lpa2v/en/heatmap-waf.png)

The same pattern shows up differently in the flaky-scanner scenario: threshold
and rule-based spread attention/degradation classifications unpredictably
across assets and ticks, while the LPA2v cluster holds a single state
(`normal`) across the entire grid.

![Asset-by-time heatmap for the flaky-scanner scenario: threshold and rule-based scattered between attention and degradation, LPA2v cluster uniformly normal](/img/lpa2v/en/heatmap-flaky.png)

## Validating against real findings (with zero recalibration)

Synthetic simulation proves the logic works on paper. To find out if it
survives real data, I applied the same cluster — without touching a single
weight or threshold — to 559 real SAST/SCA/DAST findings collected from five
applications: two internal SaaS platforms (nexo and steel, same Next.js
stack), two sizable open source projects (freeCodeCamp and Plane), and my own
personal site. I ran Semgrep, Snyk and OWASP ZAP locally against each one, and
labeled ground truth through AI-assisted human review — never the tool's own
self-reported severity, since "false positive" only exists relative to a
reality external to the scanner.

Combined results:

| Mechanism | Precision | Recall |
|---|---|---|
| Threshold | 31.7% | 100% |
| Rule-based | 34.2% | 100% |
| **LPA2v cluster** | **86.8%** | **74.6%** |

![Precision, recall and F1-score by mechanism across the 559 combined real findings: LPA2v cluster at 86.84% precision against 31.66%–34.17% for the other two](/img/lpa2v/en/real-data-metrics.png)

With no recalibration at all, the simulated pattern held: precision far above
both conventional mechanisms, with a concentrated recall cost. Precision stayed
above 97% in three of the five repositories.

## Where it broke — and why that matters more than the good numbers

The weakest point of the study is recall on the Plane repository: **33.3%**,
against 100% for threshold. The cluster missed 8 of 12 real vulnerabilities
labeled there. Digging into the cause: they're all the same pattern (missing
password validation in Django flows, moderate severity from a single source) —
and moderate-severity evidence from a single domain gets structurally diluted
by the weighted average across the other, silent domains. The same pattern
explains a specific miss in nexo: two real vulnerabilities in an image
processing library (sharp, CVSS 7.0) landed at a certainty degree of 0.14
against a 0.15 threshold — missed by a margin that isn't a data accident, it's
a direct consequence of how the master neuron aggregates.

I didn't recalibrate the formula to fix this — it's logged as a concrete
direction for future work, alongside adaptive weight calibration from the 559
already-labeled findings (today the weights are set manually, not learned).

## What this proves, and what it doesn't

The architecture doesn't eliminate the scanners or their severity thresholds —
SAST, SCA and DAST keep running exactly as before. What changes is their role:
they stop being the final decision and become part of a set of evidence that's
allowed to genuinely disagree. That's what lets the system tell a flaky
scanner apart from a real vulnerability without writing a rule for every case,
and flag an inconsistent state as inconsistent instead of forcing it to one
side.

It's a contextual correlation layer on top of the scanners already in use, not
a replacement for them — and the recall trade-off it introduces is real,
measurable, and concentrated exactly where the evidence is weak and comes from
a single source.
