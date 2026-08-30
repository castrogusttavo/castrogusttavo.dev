---
title: Three loads, three purposes — Nexo's k6 load-testing strategy
description: "The post about scaling Nexo to a million users told a story: a load test found a real bug. This one doesn't tell a story — it's the structure behind it. Why three separate load scripts exist, not one, each answering a different question, running at a different point in the pipeline, and what stays uncovered when none of them runs against real production."
icon: rocket
date: "2026-08-29"
---

The post about scaling Nexo to a million users told a story: a load test
found a real bug, a query with no pagination returning 8.6MB per request.
This post doesn't tell a story — it's the structure behind it. Why there
are **three** separate load scripts in the `k6/` directory, not one, and
why each one answers a different question.

## The problem: one load script only serves one question at a time

A test that ramps up heavy load is good at finding where the system
breaks, but terrible to run on every push — too slow and expensive for
that rhythm. A light test is fast enough to run always, but reveals
nothing about degradation under real pressure. Using the same script for
both means picking a side and going blind to the other risk.

## The idea: one script per question, its own cadence per script

**Smoke — "is it broken?"**

```js
export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}
```

A single VU, 30 seconds, checking that `/`, `/sign-in`, `/sign-up`,
`/contact` respond 200 in under 500ms. It doesn't test load, it tests
functional correctness under minimal conditions — if this fails, there's
no point running anything heavier.

**Load — "how does it degrade under a real ramp?"**

```js
export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
}
```

A ramp from 5 to 20 concurrent VUs, with percentile thresholds — not just
"did it break," but "how slow did it get, at p95 and p99, while the load
climbed."

**Api-smoke — auth in isolation.** A third script, focused only on
authentication routes, 1 VU/15s — separate from the general smoke test
because authentication has its own failure path (rate limiting, password
hashing) a static route doesn't.

## How it works: different cadence, not different intensity by accident

| Scenario | Load | When | Blocks? |
| --- | --- | --- | --- |
| `smoke-test.js` | 1 VU, 30s | PR/push (local) + weekly (production) | yes |
| `api-smoke-test.js` | 1 VU, 15s | PR/push (local) + weekly (production) | yes |
| `load-test.js` | ramp 5→20 VUs | PR/push (local) | no — `continue-on-error` |

Smoke runs in two places: against the local build on every PR/push, and
against real production, on a schedule. Load only runs locally, and with
`continue-on-error` — a blown latency threshold doesn't block the push, it
becomes a signal to look at, not a mandatory gate. The asymmetry is
deliberate: "is it broken" is binary and cheap enough to gate on; "did it
degrade under load" is too rich a piece of information to decide alone
whether a commit ships.

## Results: the structure that made the earlier post's bug findable

The reason `load-test.js` exists with a ramp and percentile thresholds —
not just a correctness smoke test — is exactly what made it possible to
find `/issues` returning 8.6MB per request in the earlier post: without
simulated pressure from multiple concurrent VUs, the symptom (latency
climbing from ~1s to ~12s under 15 concurrent users) would never have shown
up in a 1-VU test.

## Where it broke: local isn't production, and production only gets the lightest test

The most direct gap: `load-test.js`, the only one that genuinely stresses
concurrency, runs against the **local build** — not against production
infrastructure, with its own resource limits, real network latency, real
database size. Passing locally doesn't guarantee passing in production; it
was precisely by running a manual test, outside this automated cadence,
against real production, that the earlier post's bug surfaced — the k6 job
scheduled against production only runs the smoke test, the lightest of the
three.

That means production is never tested under load automatically and
recurrently — only for functional correctness. Any degradation that only
shows up with real data volume or real user concurrency depends, today, on
someone running that test manually, and in time, like it happened once.

## What this proves, and what it doesn't

It proves separating "is it broken" from "how does it degrade under load"
into different scripts, with different cadences, is what lets both exist
without one getting in the other's way — smoke fast enough to always gate
on, load rich enough to inform without blocking. It proves this structure
is what made the finding in the million-users post possible to catch in a
test, not just in production actually breaking. It doesn't prove
production is continuously protected against load degradation — only
smoke runs there, scheduled; real load testing depends on someone running
it by hand.
