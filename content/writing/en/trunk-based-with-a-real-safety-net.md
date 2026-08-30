---
title: Committing straight to main, no PR — what that demands from the pipeline
description: "Every commit that lands on Nexo's main has already been through the deploy before any human opens a review tab — because there is no review. What replaces human review isn't trust, it's a pipeline built to make it impossible to promote red code. This is what that trade-off demands, and the real risk it accepts."
icon: terminal
date: "2026-08-29"
---

Every commit that lands on Nexo's `main` has already been through the
build, the tests, and is one green `workflow_run` away from production —
before any human opens a review tab. There's no review, because there's no
Pull Request in the default flow. `main` is the only branch: no `dev`, no
per-feature branch, no PR per release.

That sounds risky until you read what replaces the review: not trust, but
a pipeline built to make it **impossible** to promote red code to
production.

## The problem: a PR isn't a synonym for safety, it's a synonym for latency

The common assumption is that the Pull Request is the safety net — without
it, nothing protects `main`. In practice, a PR reviewed only by its own
author (common on a small or solo team) adds the latency of a review flow
without adding the protection a review is supposed to bring. What actually
stops broken code from becoming production isn't a person approving it —
it's some automated check, and that check exists whether or not a PR sits
in the middle.

## The idea: two gates, no human review, nothing bypassed

**Gate 1 — local, before the commit ever leaves the machine:**

```
pre-commit  → pnpm check (Biome) + pnpm tsc --noEmit
commit-msg  → commitlint validates the message
```

A commit that doesn't type-check, or doesn't follow Conventional Commits,
is blocked **before** it exists in the history. Not a guideline to follow —
an executable gate.

**Gate 2 — remote, on push:**

```yaml
# ci.yml
on:
  push:
    branches: [main]
  pull_request:
```

CI runs on both `push` to `main` and `pull_request` — the exception PRs
(Dependabot, external contributions) stay covered. The detail that
separates the two cases:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A PR mid-iteration can cancel its previous run — makes sense, only the
latest push matters. A direct push to `main` is **never** canceled: every
tip that lands there has to resolve fully, because every one of those tips
is a deploy candidate.

## How it works: CD only gets born from a green CI

```yaml
# cd.yml
on:
  workflow_run:
    workflows: ['CI']
    types: [completed]
    branches: [main]

jobs:
  migrate:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: self-hosted
    steps:
      - run: pnpm prisma:deploy

  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: self-hosted
    environment: { name: production, url: https://nexo.coodee.dev }
```

`cd.yml` doesn't listen to `push` — it listens to the **conclusion** of
`ci.yml`. If CI fails, `if: conclusion == 'success'` is never true, and no
CD job runs. There's no parallel manual deploy path that skips that check;
the only road to production runs through CI closing green first.

`migrate` runs before `deploy`, as a separate job — database migrations
land in production before the new image goes up, not alongside it.

## Results: the commit is the integration unit, not the PR

With no PR to "batch" related work, the commit becomes the real
integration unit — that's why commit granularity (thematized, Conventional,
one intent each) matters so much in this flow: there's no PR squash to
tidy up a messy commit history afterward. `main`'s history only stays
readable if every commit is born coherent.

## Where it broke: no human review, and a blind spot between migrating and deploying

The most direct limitation: **zero review from another person** on any
solo-authored commit. The pipeline guarantees the code works (type-checks,
passes tests, lints clean) — it doesn't guarantee the design decision
behind it made sense. That's acceptable for a small team where the same
author understands the domain best, but it's a real trade-off, not an
absence of risk.

Second: `migrate` and `deploy` are separate jobs, both gated on the same
`if`, but nothing in the workflow explicitly ties "if `deploy` fails after
`migrate` already ran, roll the migration back." A successful migration
followed by a failed image build/deploy leaves the database and the code
momentarily out of sync — the pipeline's documentation doesn't describe an
automatic rollback for that specific scenario.

Third: the two most sensitive jobs (`migrate`, `deploy`) run on
`runs-on: self-hosted` — a runner you own is one more piece of
infrastructure that, if it goes down, stalls every deploy until someone
notices and brings it back.

## What this proves, and what it doesn't

It proves "no PR" isn't a synonym for "no safety net" — the net exists, it's
just automated instead of human, and it gates at two different points
(local and remote) before anything reaches production. It proves `main`
never receives a deploy from a red CI run, because the mechanism that
triggers CD literally doesn't exist without that condition. It doesn't
prove the flow replaces the value of a second person reviewing a design
decision — it doesn't, and it doesn't try to. It doesn't prove migration
and deploy are protected against drifting out of sync with each other —
that's an accepted risk, not a solved one.
