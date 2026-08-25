---
title: What I'd do to get Nexo to hold 1 million users
description: "I ran real load tests against Nexo until I found why /issues breaks well before 1M users — an unpaginated query returning 8.6MB per request —, shipped the fix plus four infrastructure layers, validated it against real production hardware, and found that fixing it only exposed a bigger ceiling hiding behind it: login, guarded by an algorithm that's deliberately expensive to compute."
icon: rocket
date: "2026-08-22"
---

I ran a load test against Nexo's real production deployment — the project
management SaaS I help build. I pointed 200 simultaneous clients at the
platform's most-used route, `/issues`, and before the first thirty seconds
of pressure the server was already returning `500` — not slow, wrong.
Almost half the requests failed. The host has 8 cores and was sitting at
22% CPU when this happened. The bottleneck wasn't compute.

That's the starting point of this post — not the end of it. This isn't
"how I proved Nexo handles 1 million users" — it still doesn't. It's the
account of actually shipping the fix, measuring the result against real
production hardware, and discovering that fixing the problem I could see
was hiding a bigger one I couldn't.

## The problem: a route that returns 8.6MB per request

`/issues` is a project's task list — the most-visited screen on the
platform, by definition. The implementation (`IssueRepository.listByProject`)
fetches every issue in the project at once, with no `take`, `skip`, or
cursor. For a project with 15,000 issues — a reasonable scale for a large
workspace, not an edge case — that's a **8.6MB JSON payload per request**.

With zero concurrency, that already costs 450-600ms per call — serializing
an object that size isn't free. Under real concurrency, the cost stops
being latency and becomes collapse: with 15 simultaneous users hitting the
route, p50 climbs from ~1s to nearly 12 seconds, and p95 goes from 3.5s to
over 25.

![p50 and p95 latency of /issues: baseline at ~1s/3.5s versus ~12s/25s under a stress test ramping to 200 VUs](/img/scaling-nexo-1m-users/en/latencia-baseline-vs-colapso.png)

The most direct symptom is CPU: because Node serializes that giant JSON
blob on a single thread, the process saturates one full core and never
recovers while load persists — climbing from 88% to 109% usage over the
course of the test, monotonically, with no plateau.

![Node process CPU over the stress test: climbs from 88% to 109% continuously and never recovers](/img/scaling-nexo-1m-users/en/cpu-single-thread-satura.png)

This isn't an infrastructure problem. It's an API contract problem: the
route promises "every issue in the project" in a single response, and that
contract doesn't scale with project size — it only gets worse as Nexo
grows, with zero infrastructure changes involved.

## The idea: let the numbers pick the next step, not instinct

The obvious temptation when a server is slow under load is to raise
something — more DB connections, more replicas, a bigger box. The problem
is each of those changes costs money and operational time, and only a
fraction of them actually address the real bottleneck. I tested each
hypothesis in isolation, one at a time, and let the data decide — instead
of applying three changes at once and never knowing which one mattered.

The first hypothesis tested — and dismissed — was the Postgres connection
pool. `DB_POOL_MAX` was hardcoded at 5; I raised it to 20 expecting a real
gain.

![Requests processed before collapse: 639 with pool=5 versus 785 with pool=20 — a small gain, same failure pattern](/img/scaling-nexo-1m-users/en/pool-nao-e-o-gargalo.png)

The gain went from 639 to 785 requests processed before the system
collapsed — positive, but marginal, and the failure pattern stayed
identical. That confirms what CPU already showed: the pool was never the
ceiling. Adding database connections to a process that's already spending
a full core serializing JSON is solving the wrong problem.

## Architecture: from root cause to a design for real scale

The structural fix is real pagination on `GET
/api/workspaces/[id]/projects/[slug]/issues` — optional `limit`/`cursor`,
preserving today's behavior when no parameters are passed, so it doesn't
break the client already consuming that route. That change alters a real
production API contract, so I implemented it on a separate branch
(`perf/scale-1m-users`), with cursor-based pagination (`Issue.number`,
already unique and immutable per project — no migration needed) and
rewrote the client hook (`useIssues`) to `useInfiniteQuery`, fetching all
pages automatically in the background. The visible result for the user is
identical — the list still shows everything — but the server stops doing
one giant `JSON.stringify` at once; it does several small ones.

Pagination alone isn't the whole story, though. While the root cause was
still unfixed, I tested what scaling horizontally on top of it would look
like — because that's exactly what any team under production pressure
would do before getting an API contract change reviewed and merged. With 4
Node processes (one per core), without touching a single line of
application code:

![Requests processed: 639-785 with one instance versus 1,245 with 4 instances — more raw throughput, without fixing the cause](/img/scaling-nexo-1m-users/en/escalonamento-horizontal-throughput.png)

The gain is real — from ~785 to 1,245 requests processed before
degrading, per-instance CPU dropping to 54-60% (well below the 88-109%
before). But the bottleneck doesn't disappear, it just moves: the shared
Postgres instance, which sat essentially idle with a single app instance,
started swinging between 30% and 194% CPU — because now 4 processes are
running the same expensive query, in parallel, against the same database.

![Postgres container CPU during the 4-instance test: from ~0% idle to peaks of 194%](/img/scaling-nexo-1m-users/en/gargalo-move-pro-postgres.png)

That evidence chain — not scaling blind — is what became the architecture
design for real scale. "1 million users" isn't a load figure, it's a
population; for a project-management SaaS, realistic DAU sits around
10-20%, and peak concurrency an even smaller slice of that — the capacity
target I used was somewhere between 500 and 1,500 sustained requests per
second on the heaviest endpoint, not 1 million simultaneous connections.
Keeping the same infra philosophy Nexo already runs on today (self-hosted,
Docker, no managed-cloud migration), the order of changes was always tied
to a specific test finding — and, unlike the first version of this post,
the first five rows below are no longer a proposal: they were implemented
and tested one at a time on the `perf/scale-1m-users` branch, each with
its own measured before/after.

| # | Layer | Change | Status | Why |
|---|---|---|---|---|
| 1 | App | Cursor pagination on `/issues` (`Issue.number` as cursor, no migration) | **Shipped** | Confirmed root cause — no infra fixes a payload that grows without bound |
| 2 | Cache | Redis caches the paginated response per project+page, invalidated on write via versioning (`INCR`, not `SCAN`+`DEL`) | **Shipped** | Cuts the read fan-out before it reaches the database |
| 3 | Edge + app tier | nginx as a real LB (4 named instances, passive health check via `max_fails`/`fail_timeout`) instead of the manual port hack | **Shipped** | Active health checks are a paid nginx feature; passive already covers the real case |
| 4 | Database | PgBouncer in transaction-pooling mode in front of Postgres | **Shipped** | Multiple app nodes × pool each blow through `max_connections` fast |
| 5 | Database | Read replica via real streaming replication (`pg_basebackup -R`), `/issues` routed to it | **Shipped** | Postgres went from idle to 194% CPU with just 4 processes in parallel |
| 6 | App tier | Multiple physical nodes, with more RAM than the 3.7GB in use today | Not implementable in a single worktree | RAM hit 70% of the host in the production test alone — little room for more replicas |
| 7 | Edge | CDN just for Next.js static assets | Deployment decision, not code | Assets already have long-lived `Cache-Control`; a CDN is orthogonal to where app/DB run |
| 8 | Observability | Prometheus + Grafana alerting on the signals I chased by hand here | Out of scope (explicit decision) | Every finding in this post came from `ps`/`docker stats` run manually — doesn't scale to real production |

Tenant sharding — partitioning large tables by `workspace_id`, or even
separate Postgres clusters per tenant range — is deliberately left out.
It's the most expensive and hardest-to-reverse lever; it only comes into
play if, even with pagination, cache, and replicas, the primary is still
the ceiling.

## Results: shipping it, validating it, and the problem hiding behind the first one

This section only documented the "before" in the first version of this
post. Now it covers three things: how pagination alone behaved against
real production, how the five layers behaved together, and what showed up
once the original root cause stopped being the dominant bottleneck.

### The real-production baseline, unpaginated

Before implementing anything, I re-ran the local test against Nexo's real
production server (8 cores, 3.7GB RAM), pre-launch and with no real users
yet — running k6 on the host itself, bypassing nginx (which has real
per-IP rate limiting and correctly blocks a single-machine load test
within seconds — a valid result on its own: the abuse protection works).

The full ramp, 10 to 200 concurrent clients, ran to completion without a
total collapse — something no single-instance local run had managed.
Login had 100% success (1,382/1,382). `/issues` (still unpaginated at
this point) had 52.3% success (645/1,233) — and here's a correction I
already logged at the time: my first read of this result said "most
failures were 30s timeouts." Wrong. Counting real HTTP status, it's
**567 explicit `500` responses** and 21 `401`s — zero actual timeouts. The
server wasn't just slow, it was actively erroring under load.

![Production failures by HTTP status: 567 500 responses, 21 401 responses, zero actual timeouts](/img/scaling-nexo-1m-users/en/producao-real-status-http.png)

The finding that hadn't shown up in local tests: RAM, not just CPU. The
app container peaked at 2.6GB, out of 3.7GB total on the host — 70% of
available memory, while CPU sat at just 176% of the 800% available (8
cores). The same 8.6MB-per-request payload, stacked under concurrency,
nearly exhausts memory on a real production instance before even
saturating CPU — an OOM risk that only shows up testing real-sized
hardware.

![CPU and RAM of the app container in production during the test: CPU peaks at 176% of 800% available, RAM reaches 2.6GB of 3.7GB total](/img/scaling-nexo-1m-users/en/producao-real-cpu-ram.png)

### Pagination alone, against real production

After shipping Layer 1, I tested it in isolation on the same server, same
method. The payload for one page (`?limit=1000`) dropped from 8.6MB to
**586KB** — fifteen times smaller — and I confirmed that omitting the
parameter still returns the same 8.6MB as before, proving backward
compatibility for real, not just on paper.

### All five layers together, tested end to end

With pagination, cache, LB+4 instances, PgBouncer, and read replica all
implemented and running together (local worktree), I repeated the
Experiment 1 ramp from 10 to 200 VUs — the same one that collapsed at
~100-180 VUs with 51-52% failure in Round 1.

- **Completed without aborting**, with just **2.13% residual failure**
- **3,378 requests** processed on a single paginated instance — 3.8× the
  best single-instance result before the fix (785-934)
- Real Postgres connections drop to about a dozen via PgBouncer; `/issues`
  reads migrate to the replica, confirmed with real streaming replication
  (`pg_basebackup -R`), not simulated — I wrote to the primary and read it
  back through the replica right after, and the data was already there
- **Real failover**: I killed one of the 4 instances mid-test — 171 of 171
  subsequent requests still succeeded, nginx routed around it with no
  intervention
- The full `k6/flows.js` suite (login → home → issues → onboarding)
  against the whole stack: **2,248 of 2,248 checks, 100% success**

The pattern that repeated across all five layers: the implementation
itself was rarely the problem — it was **15 real bugs** (a typo, a race
condition in the cache, five environment issues in the LB setup, a
nonexistent Docker image, two bugs in the replica's entrypoint, among
others) that only surfaced by actually running each layer, never by
reading the code. None of them survived without a fix before the final
number went into the log.

### The problem the fix was hiding: login became the new ceiling

Testing the full stack against ever-larger traffic — the obvious question
after "it works" is "up to where" — ran into a methodology problem first:
running the load generator (k6) on the same 4-core machine hosting the
whole stack (9 containers) saturated the entire host, not just the app.
`vmstat` showed 80-86% CPU busy with a run queue of up to 80 processes
fighting for 4 cores — a test artifact, not an architecture finding,
discarded from the result for the same reason I discarded the `next
start` "finding" back at the start of this investigation.

The clean test — real production, 8 cores, `/issues` already paginated —
revealed something more interesting than an artifact: authenticated
`/issues` got genuinely fast (**p50 = 154ms**), but **login**
(`POST /api/auth/sign-in/email`) had a p50 of **nearly 60 seconds** under
the same burst. The original root cause stopped being the ceiling, and a
second bottleneck — one that was always there, just hidden behind the
first — became visible.

The cause: `argon2.verify()` runs on the library's **default parameters**
(`memoryCost: 64MB`, `parallelism: 4` — each individual verification
already tries to use 4 threads on its own), tuned for one fast, isolated
hash on a dedicated machine, not for dozens of concurrent logins on a
SaaS. Isolating just login (no `/issues` traffic, 400 VUs with a realistic
1-2s cadence between attempts — not a tight loop), the process already
saturated **571% CPU**, out of 800% available.

Fixing this took four attempts, and not all of them helped — which, for
the purpose of this post, is just as worth showing as the one that did:

![p95 login latency at 400 concurrent VUs, across four fix attempts until backpressure actually solved it](/img/scaling-nexo-1m-users/en/login-p95-jornada.png)

1. **OWASP argon2 preset** (`memoryCost: 19MB`, `timeCost: 2`,
   `parallelism: 1`) — tested earlier on a 4-core worktree, it cut p95 by
   ~3× and eliminated errors entirely. In production (8 cores), it
   **barely helped at all** (13.1s → 14.7s p95) — something else was
   holding up the queue with comparable weight, masking the gain.
2. **`UV_THREADPOOL_SIZE=8`** — hypothesis: argon2 runs on libuv's
   threadpool, capped at 4 slots by default regardless of the 8 real
   cores. Raising it to 8 **made things worse**, reproducibly (14.7s →
   17.05s, repeated twice with nearly identical results). Likely
   explanation: a threadpool sized to the core count leaves zero headroom
   for Node's main thread and garbage collection — 4 slots left exactly
   that headroom.
3. **The actual culprit**: `DB_POOL_MAX` had never been set in
   production — it fell back to the code default, **5**, the same value
   dismissed as a bottleneck back in Experiment 1/2 (just hidden that
   time by the bigger CPU bottleneck in `/issues`). Login does a user
   lookup + password verification + a possible session write, all
   competing for the same 5 slots. Raising it to 25 gave the best result
   so far (17.05s → 12.71s) — confirming the pool was a real part of the
   problem, just not the whole thing.
4. **The actual fix**: an in-memory concurrency gate
   (`src/lib/auth-concurrency-gate.ts`), capping simultaneous
   `argon2.verify()` calls with a short queue and a timeout — past that,
   it rejects with `429`/`Retry-After` in milliseconds instead of leaving
   the request hanging. The client automatically retries up to twice with
   backoff. Result: **p95 from 12.71s to 1.18s**, with 83% final success
   (after retry) against 400 simultaneous logins — the best throughput of
   the entire day of testing (26.63 flows/s).

CPU didn't change across any of those four attempts (it sits at 570-600%
the whole time) — because none of them reduce the real cost of verifying
a password. What changed is what happens once that cost exceeds available
capacity: before, an invisible queue of up to 25 seconds with no
feedback; after, near-instant success for whoever fits the budget, and a
clear, immediate response for whoever doesn't.

Even so, **17% of logins don't recover even after 2 retries**, at 400
simultaneous attempts on the same instance. A conscious decision: I didn't
chase that number further this round — it's a far more extreme spike
scenario than "1 million users" suggests at first glance (login is a
one-time event per session, not continuous traffic), and Nexo, pre-launch,
has no reason to expect that traffic pattern today. It stays on record as
a revisable product decision, not an unresolved technical limitation.

## Where it broke — and what this doesn't prove

The weakest point of this whole investigation is the unit of measurement.
"200 VUs" in k6 isn't "200 users." A VU runs in a loop, with no pause at
all between requests — a single VU with no concurrency made 258 requests
in 3 seconds against `/issues`, a volume no human generates. A real user
hits that route maybe once every 15-20 seconds.

![Request rate of 1 k6 VU (86 req/s) versus an estimated real user (~0.04 req/s), log scale](/img/scaling-nexo-1m-users/en/vu-nao-e-usuario-real.png)

That means two things at once, and both matter: the test is more
aggressive than real traffic, so "broke at 200 VUs" isn't "breaks at 200
real users" — the real system probably handles more normal browsing than
that ramp suggests. But it also means the 500-1,500 requests/second
target I used for the architecture design is a back-of-envelope estimate,
not something measured against a real population of 1 million accounts —
which Nexo, being pre-launch, doesn't have yet.

The most important gap in this round: the three heaviest infrastructure
layers — the real nginx LB, PgBouncer, and the read replica — were
implemented and validated **only on the local worktree** (4 cores). They
were never deployed to production. What actually ran in production was
pagination, cache, the argon2 tuning, the connection pool, and the
backpressure gate — five real changes, but not the five infrastructure
layers in the full table. The failover numbers (171/171) and the
4-instance throughput (3,378 requests) are real and measured, just on
weaker hardware than production, not the final environment. That's a gap
to close before calling the table "done," not a cosmetic detail.

The other point without a clean answer: even after all this work, I don't
have a validated number for "how many sustained real users" Nexo can
handle today. Every attempt to find that ceiling ran into something else
first — initially the `/issues` bottleneck, then a methodology artifact
(running the load generator on the same 4-core machine hosting the whole
stack, which saturates the entire host, not just the app — I discarded
those numbers from the final result, same spirit as the `next start`
correction earlier in this log), and finally the login bottleneck. What I
have is the concurrent-login ceiling (~400 before degrading) and the
health of authenticated `/issues` (p50 154ms) — not a full curve of
sustained concurrent users.

## What this proves, and what it doesn't

This proves, with real numbers measured in production and not guesswork,
that the root cause identified in the first round — unpaginated `/issues`
saturating CPU and RAM — was actually fixed: a 15× smaller payload,
backward compatible, validated both in isolation and alongside four other
infrastructure layers. And it proves something I didn't expect when I
started writing the first version of this post: fixing the visible root
cause doesn't end the work, it reveals the next one. Login, guarded by an
algorithm that's deliberately CPU-expensive, became the real ceiling the
moment `/issues` stopped being one — and that ceiling doesn't get solved
with more infrastructure (scaling horizontally doesn't make a hash
cheaper), only with a change in behavior under overload: fail fast and
clearly instead of leaving the user waiting in silence.

It doesn't prove Nexo handles 1 million users — it still doesn't, and
that was never really the goal. It doesn't prove the three heaviest
infrastructure layers (real LB, PgBouncer, replica) work in production —
only on the local worktree, on weaker hardware. And it doesn't prove what
the ceiling for *sustained* real users is — only the one for login under
an extreme burst, which is a narrower, different question. What this post
proves is the method: ship one layer at a time, measure against real
hardware whenever possible, admit when a fix doesn't help
(`UV_THREADPOOL_SIZE` made things reproducibly worse — that's data too),
and let the numbers decide what the next problem is, not instinct about
what it should be.
