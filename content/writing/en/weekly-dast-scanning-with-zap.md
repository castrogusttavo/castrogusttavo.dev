---
title: Why I run ZAP once a week, not on every PR
description: "The file that tells ZAP which findings to ignore has four lines — and every single one carries its own reason for being ignored, right in the file. That file is the summary of a bigger decision: DAST in Nexo blocks no PR, runs against production once a week, and turns into an issue for human review, never an automatic gate. This is why that cadence, and what stays unenforced when nobody looks at the issue."
icon: bug
date: "2026-08-29"
---

The file that tells OWASP ZAP which findings to ignore in Nexo
(`.zap/rules.tsv`) has four lines. Every one carries its own reason, right
in the file:

```
10038  IGNORE  (CSP Header Not Set - handled by proxy.ts and next.config.ts)
10063  IGNORE  (Feature Policy Header Not Set - handled via Permissions-Policy)
10015  IGNORE  (Re-examine Cache-control Directives - per-route cache policy will be set granularly)
10049  IGNORE  (Storable/Non-Storable/Non-Cacheable Content - per-route cache policy will be set granularly)
```

That's not a list of exceptions someone quietly accumulated without
explaining — it's a small list, each line justified, reviewable in
seconds. It's the kind of artifact that only exists because the decision
to run DAST was given its own cadence, instead of being forced into the
same rhythm as every PR's CI.

## The problem: DAST on every PR doesn't fit a PR's rhythm

A dynamic scan (DAST) needs a **genuinely running** application — it's not
static code analysis, it's a real attack against a real target. That
doesn't fit a PR's lifecycle: spinning up an ephemeral environment per PR
just to scan it is expensive, slow, and still scans an environment that
isn't production. The more common bad alternative is running no DAST at
all — SAST (Semgrep, Snyk) covers static code, but not what only shows up
at runtime: a header missing from a real response, behavior that only
exists under load, a production config that's drifted from what's in the
repo.

## The idea: a separate cadence per kind of check

```yaml
# security-dast.yml
on:
  schedule:
    - cron: '0 6 * * 1' # every Monday, 06:00 UTC
  workflow_dispatch:
```

DAST runs against the real target — `https://nexo.coodee.dev` — once a
week, decoupled from any push or PR. It blocks nothing: no commit waits on
ZAP finishing to get merged or deployed.

```yaml
- uses: zaproxy/action-baseline@...
  with:
    target: 'https://nexo.coodee.dev'
    rules_file_name: '.zap/rules.tsv'
    allow_issue_writing: true
    fail_action: false
```

`fail_action: false` is the central decision: a ZAP finding never fails the
workflow. It becomes a GitHub issue, for human review — never an automatic
gate blocking anyone.

## How it works: baseline, not full, and why

ZAP has modes with very different costs:

| Mode | Coverage | Time | Fits |
| --- | --- | --- | --- |
| Baseline | Passive spider, no active attack | minutes | frequent cadence |
| Full | Complete active attacks | much longer | point-in-time, deep analysis |

Nexo runs **baseline** weekly — a spider that crawls and observes, without
actively trying to exploit anything. It's the right mode to run every week
without becoming a recurring, heavy infrastructure cost. Complementing
that, `headers-check` runs a deterministic `curl -I` against the same
security headers — fast, no attack at all, just confirming presence.

There's a third job, `lpa2v-triage-full`, that cross-references ZAP's
result with Semgrep (SAST) and Snyk (SCA) via `lpa2v-appsec` — the
AI-assisted contextual-triage project that's already the subject of
another post on this blog. The idea there is specific: a finding SAST
flags as vulnerable but DAST can't reproduce against the real production
target (blocked by a WAF, say) is a signal of "inconsistent" — neither
confirmed nor dismissed — that manual triage looking at each tool in
isolation wouldn't catch.

## Results: four documented exceptions, zero unexplained ones

The number of ignored findings isn't the point that matters — it's that
**every one** carries its reason alongside it. That turns
`.zap/rules.tsv` into a reviewable artifact: anyone reading that file in
five minutes understands exactly what was decided not to fix, and why,
without reconstructing the reasoning from scratch.

## Where it broke: an unowned finding blocks nothing, and full has no fixed cadence

The most honest gap sits in `fail_action: false`: a new, real ZAP finding
stops nothing from continuing to happen. It becomes an issue — and if
nobody looks at that issue, the vulnerability stays documented but
unfixed, indefinitely. Unlike code CI (which blocks a merge), DAST depends
entirely on someone paying attention after the fact.

Second: baseline never attempts a genuinely active attack. That's a
deliberate cost choice, not a minor detail — it means a class of
vulnerability only visible under active exploitation (not just passive
spidering) may never show up in the weekly scan. Full mode exists as a
tool, but it isn't recorded as running on any recurring automated
cadence — it's point-in-time analysis, not continuous coverage.

## What this proves, and what it doesn't

It proves separating verification cadence by real cost (seconds for
headers, minutes for baseline, much longer for full) is what makes running
real DAST possible without stalling delivery. It proves every documented
exception is reviewable, not a list that grows without explanation. It
doesn't prove a new finding gets fixed — it only proves it gets
*recorded*; the fix depends on someone acting on the issue. It doesn't
prove continuous active-attack coverage — the mode that actually attacks
doesn't run every week, only the passive one does.
