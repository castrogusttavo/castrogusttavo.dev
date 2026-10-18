---
title: From one to five Next.js instances — what breaks when the process stops being one
description: "A production load test took Nexo down at 03:21 UTC with an exhausted Node heap. The cause was one log flush per request. With the leak fixed, another ceiling remained: a Node process uses one core. This post measures what happened going from one to five instances behind nginx, and what stopped working once in-memory state existed five times."
icon: rocket
date: "2026-10-22"
---

At 03:21 UTC on October 16, halfway through a load test against Nexo's
production, the Next.js process died with
`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.
Docker brought a new one up in about a second and the test carried on
against a fresh process. But the message told me something I didn't know:
Nexo leaked memory on every request, and with enough traffic it would go
down on its own, periodically, no load test required.

This is the measured follow-up to the
[1 million users post](/en/writing/scaling-nexo-1m-users). There, the load
balancer with four instances had only run in a local worktree, and I wrote
that this was a gap to close before calling the table done. This is that
gap closed: real production, one instance to five, and what broke on the
way.

## The problem: one process, one core, and a queue that never drained

The test runs from the repo's `Load Test (Production)` workflow, on a
GitHub runner outside Brazil, against `https://nexopm.com`. First the unit,
because the previous post got it badly wrong: a VU is **not** a request in
a loop. In this scenario (`k6/load.js`) each VU signs in once and then
makes **one request every 5 to 7 seconds**: 40% public pages (`/`,
`/pricing`, `/status`, `/about`) and 60% authenticated API (issue list with
`limit=50`, projects, `/api/users/me`). A VU is roughly one active user
clicking around, not a bot.

The server was an 8 vCPU VM (4 physical cores with hyperthreading) and
7.6 GB, running **one** `nextjs-app` instance. Each level had a 2 minute
ramp and a 5 minute plateau:

| VUs | API p95 | API p99 | Page p95 | Plateau throughput | Errors |
|---|---|---|---|---|---|
| 5 | 429 ms | 443 ms | 1,480 ms | ~0.75 req/s | 0% |
| 200 | 593 ms | 752 ms | 1,495 ms | 30.0 req/s | 0% |
| 300 | 1,066 ms | 1,362 ms | 1,774 ms | 43.8 req/s | 0% |
| 350 | 1,829 ms | 2,049 ms | 2,516 ms | 47.0 req/s | 0% |
| 400 | 2,346 ms | 2,653 ms | 3,019 ms | 50.1 req/s | 0% |
| 500 | 4,358 ms | 4,743 ms | 5,035 ms | 51.0 req/s | 0% |
| 700 | 8,513 ms | 9,002 ms | 9,196 ms | 51.1 req/s | 0% |

Percentiles come from the JSON summary k6 uploads as an artifact of each run
(`38842949080`, `38842209419`, `38843248820`, `38845518212`, `38846285743`,
`38847051485`, `38847828623`). Plateau throughput I computed from k6's
progress lines in each run's log (iterations completed across the 5 minute
plateau). The average k6 itself reports includes the ramp and is lower
(45.1 req/s at 500 VUs); that was the number I wrote down at the time.

This is a closed system hitting a wall. Past ~400 VUs throughput stops at
~51 req/s, and every extra user only lengthens the queue. The arithmetic
checks out: 700 VUs at 51 req/s means each VU completes a cycle every 13.7
seconds, the 6 second average pause plus ~7.7 seconds waiting, which is
about the page median at that level. No errors at any level with a clean
process: the ceiling was latency, not failure.

The ceiling had a name. Under load `nextjs-app` sat at 110-120% CPU, one
full core plus GC, while Postgres sat at 4-10% and three physical cores
idled. JavaScript runs on one thread. However much machine you give a Node
process, it runs your code on one core.

### The leak: one flush per request

The CPU ceiling was expected. This wasn't: the process RSS grew ~1.8 GB per
~20k requests and **never came back** between tests. It went from 513 MB to
2.3 GB in about 45 minutes of load, and at 03:21 the heap ran out. That's
why every level in the table was measured after restarting the container;
two runs that inherited a bloated process (400 VUs with 2 GB, 350 with
2.35 GB) were thrown out, and the 350 one is the one that crashed mid-run
with 2.5% errors.

I reproduced it locally with the same standalone build and heap limit and
diffed heap snapshots taken before and after load. Commit `b772a206` has
the cause:

> 8.7k requests left 14k suspended flushes and 3.7k ServerResponse objects
> in the heap.

Two places called Axiom's `logger.flush()` on every request: the route
handler wrapper (`createAxiomRouteHandler`'s default callbacks) and
`proxy.ts`, which runs before **every** request, pages included:

```diff
-export function proxy(request: NextRequest, event: NextFetchEvent) {
+export function proxy(request: NextRequest) {
+  // No flush here: one per request queued behind the previous ones (see
+  // lib/axiom/server.ts). The barch client sends this within a second.
   logger.info(...transformMiddlewareRequest(request))
 
-  event.waitUntil(logger.flush())
-
```

`@axiomhq/js` serializes flushes, and each is a ~400 ms POST to Axiom. That
drains a handful per second while two per request keep arriving. The queue
grows without bound, and each pending flush lives inside the `after()`
context of the request that created it, which keeps that whole request,
`ServerResponse` included, alive. Not a Next bug, not a runtime bug: the
logging integration kept asking to send *now* something the client already
batches on its own (every second or 1,000 events). The fix was to stop
asking. Accepted cost: on a deploy, up to ~1 second of buffered logs may be
lost when the container stops.

After the fix shipped, each process settled around 1 GB of RSS under load,
the figure recorded in the `infra/app.yml` comment.

## The idea: if a process uses one core, run one process per core

Without the leak, the ~45-51 req/s ceiling was still there, for a reason no
code fix removes. The cheapest way out isn't a rewrite, it's identical
copies of the same container behind the nginx that already fronted
everything.

Starting copies is easy. The hard part is that everything the app kept
**in process memory** now exists N times, each copy with its own version,
none aware of the others. Sessions lived in Postgres and the app's rate
limits in Redis, so those were already shared. The rest I had to hunt down.

## How it works: three copies, then five

Commit `d5626518` started three instances (`nexo-app-1..3`), each listening
on loopback only (`127.0.0.1:3001-3003`), behind an nginx `upstream` with
`least_conn`, because request cost is very uneven: a 1 MB marketing page on
one side, `/api/users/me` on the other. Three, not eight, because there
were 4 physical cores: eight instances would have hyperthread pairs
fighting over the same core, and Postgres, Redis, the worker and realtime
need CPU too.

Deploys became rolling, one instance at a time, each healthy before the
next goes down:

```bash
# One app instance at a time, each healthy before the next goes
# down, so nginx's upstream always has four left to serve from.
for svc in nexo-app-1 nexo-app-2 nexo-app-3 nexo-app-4 nexo-app-5; do
  docker compose up -d --no-deps "$svc"
  status=starting
  for _ in $(seq 1 30); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$svc")
    [ "$status" = healthy ] && break
    sleep 3
  done
  if [ "$status" != healthy ]; then
    echo "::error::$svc is $status after 90s, stopping the rollout"
    docker logs --tail 50 "$svc"
    exit 1
  fi
done
```

That's already the five-instance version. The same day the VM went from 4
to 6 physical cores (12 vCPU) and from 7.6 to 12 GB, and commit `6208b16e`
went to five: five cores for Next, one for Postgres, Redis, nginx and the
rest, ~5.5 GB of RAM under load.

### What breaks when the process stops being one

**1. Better Auth's rate limit became five rate limits.** The app already
counted its own limits in Redis, but Better Auth's built-in limiter keeps
counters in a module-level `Map`, in process memory:

```js
// better-auth 1.7.5, dist/api/rate-limiter/index.mjs
const memory = /* @__PURE__ */ new Map();
```

The default `/sign-in` rule is 3 attempts per 10 seconds. With nginx
spreading one IP's requests across five processes, each with its own `Map`,
the effective limit becomes up to 15 per 10 seconds, depending on what the
balancer decides. Commit `dd34816f` plugs in a Redis-backed
`customStorage`, one `rate-limiter-flexible` limiter per Better Auth rule,
with an in-memory insurance limiter for when Redis is down, same as the
app's:

```ts
limiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: `rl:better-auth:${id}`,
  points: max,
  duration: window,
  insuranceLimiter: new RateLimiterMemory({
    points: max,
    duration: window,
    keyPrefix: `rl:better-auth:mem:${id}`,
  }),
})
```

That's a different problem from figuring out **which** IP is the client's
behind nginx and Cloudflare, which has
its own post.

**2. `use cache` plus `updateTag` clears one instance.** The default
`'use cache'` store lives in each process. This version's Next docs say so
plainly: without a shared cache handler, "each instance maintains its own
cache independently — features still work correctly on each instance, but
revalidation events don't propagate across instances". An admin publishes
an opening, the action calls `updateTag`, and only the instance that served
the action drops its cache; the other four keep the old list until it
expires. That's why `/careers` (`99d74fab`) doesn't use `'use cache'`: the
page is static copy, and only the openings list reads the database,
streamed inside a `<Suspense>`. What still uses `'use cache'` only changes
on deploy, like blog posts, where five independent caches always hold the
same thing.

**3. The Postgres connection budget multiplies.** Each process has its own
pool of up to `DB_POOL_MAX` (25). That was handled before the test, in
`4ce4d075`, when the app moved behind pgbouncer in `transaction` mode: the
25 become cheap client connections to the pooler, and the real Postgres
ceiling becomes `DEFAULT_POOL_SIZE`, which is per user/database pair, not
per process. Back then there were three processes (app, worker, realtime):
75 of 200 client slots, 20 of Postgres' 100 connections. Five app
instances changed the math twice: `DEFAULT_POOL_SIZE` went from 20 to 40
(plus 5 reserve, 45 of 100), and `MAX_CLIENT_CONN` from 200 to 300, since
5 × 25 plus worker and realtime would leave the old limit almost no room.
One detail: the URL has **no** `?pgbouncer=true`. That flag is for Prisma's
own engine; this app talks through `@prisma/adapter-pg`, which is
node-postgres and doesn't name prepared statements. I tried both forms
against a real database and both connect.

**4. Two versions live at once.** A tab left open across a deploy posts a
Server Action id the new build doesn't know, and Next answers
`Failed to find Server Action`. Four of those reached Sentry (NEXOPM-5)
before `c4fad13b` set `NEXT_DEPLOYMENT_ID` to the commit being shipped: the
client sees the mismatch in a response header and reloads instead of
firing the stale action. That predates multiple instances, but rolling
deploys widen it: during a rollout, which can take up to 90 seconds per
instance, the same `upstream` serves the old and new builds side by side,
with no sticky sessions.

### The cost instances didn't fix: pages

With three instances, the on-host test (next section) showed CPU wasn't
going where I thought. A CPU profile of a local build showed public pages
cost about 4× the CPU of an API call, because the root layout did
`await cookies()` and `getSession()` above `{children}`, so **no** page
could prerender. `/pricing`'s static shell was an empty `<body>` and its
1 MB of HTML rendered on every visit. Commits `4c6d07ea` and `087205dc`
took request reads out of the root layout (cookie consent read in the
browser; signed-in users go from `/` to `/home`), and `164c94b1` moved
compression from Node to nginx: locally, static pages went from 16.6 to 6.2
ms of CPU per request from that alone. Later, `26690cfc` removed ~550
repeated icons from the pricing table, taking `/pricing` from 1.04 MB to
653 KB of HTML.

That matters for reading the results: "after" isn't just "five instances".
It's five instances, on a bigger VM, with cheaper pages.

## Results

### On the host, without the network in between

To measure the server rather than the road to it, I ran k6 on the host
itself, with the pause already at 3 to 15 seconds (`c7a06b80`, 9 s on
average, ~35% fewer requests per VU than 5-7 s) and a target of p95 <
500 ms and p99 < 1 s on the API. The single instance was measured against
`localhost:3000`; from three instances on, through nginx with TLS on
`127.0.0.1`.

| Setup | Users within target | Source |
|---|---|---|
| 1 instance, 8 vCPU | ~400 | `d5626518` commit message |
| 3 instances, 8 vCPU | 800 | `6208b16e` commit message |
| 5 instances, 12 vCPU, pages fixed | 1,200 VUs: p95 137 ms / p99 238 ms | test notes, Oct 16 |
| same | 1,600 VUs: p95 542 ms / p99 1.18 s (just over) | test notes, Oct 16 |

From ~400 to ~1,500 users within target, zero errors, with the load
generator competing with the app for CPU.

### From outside, along a user's path

On October 17 the domain went behind Cloudflare (`464e964b`), and the
`0beed010` deploy shipped everything since: streamed private pages, the
smaller `/pricing`, CI changes. With it live, I ran the same GitHub
workflow three times at 1,500 VUs, 4 minute ramp, 5 minute plateau:

| Run | Requests | Errors | API p95 / p99 | Page p95 / p99 | Plateau throughput |
|---|---|---|---|---|---|
| `39080597950` | 70,551 | 0 | 598 / 789 ms | 681 / 845 ms | 160.3 req/s |
| `39083533814` | 70,596 | 0 | 594 / 774 ms | 684 / 835 ms | 160.3 req/s |
| `39084232455` | 70,503 | 3 | 603 / 774 ms | 704 / 850 ms | 159.7 req/s |
| `39081240533` (20 VUs, idle server) | 196 | 0 | 260 / 541 ms | 667 / 684 ms | ~2 req/s |

Three failures in ~211k requests. Pages barely degrade under load: 667 ms
p95 idle, 681-704 ms at 1,500 VUs.

![API p95, measured from the GitHub runner, against plateau throughput: with one instance latency explodes near 51 req/s; with five, 1,500 VUs sustain ~160 req/s at 594-603 ms p95](/img/from-one-to-five-nextjs-instances/en/p95-api-vs-vazao.png)

Comparing per VU is misleading because the pause model changed midway:
1,500 VUs at a 9 s average ask for about what 1,000 VUs at 6 s do. Hence
throughput on the X axis. With one instance the server topped out at ~51
req/s, with API p95 already at 4.4 s. With five, ~160 req/s comes out at
~600 ms p95 measured from another continent. And 160 isn't the ceiling,
just what 1,500 VUs at that pace ask for.

Much of those ~600 ms is road. With the server idle, the API median seen
from the runner is 223 ms, nearly all network and TLS. Subtracting ~220 ms
puts the server's p95 at 1,500 VUs near 380 ms. That's a crude subtraction,
a p95 minus a median, not a measurement; I treat it as an order of
magnitude. The measurement that matters for a user in Brazil: while GitHub
generated the 1,500 VUs, I ran 20 VUs from my own machine through
Cloudflare's São Paulo (GRU) edge, and the API came in at **300 ms p95**
(68 ms median), pages at **378 ms**.

## Where it broke, and what this test doesn't measure

**The generator is far away, and one number I relied on is inflated by my
own bug.** The GitHub runner is outside Brazil and every request pays ~220
ms of network before the server does anything. That I knew. What I didn't
know until writing this: the header meant to request compression in
`k6/load.js` is spelled `'Accept-Enconding'`, with an extra "n", since the
commit that added it. k6 never asked for compression. Bytes received agree:
~185 KB per request on average in the October 16 runs (~157 KB after the
smaller `/pricing`), consistent with raw HTML, not the ~42 KB a compressed
page weighs. So the "~1 s of network" on pages measured from the runner
isn't just distance: it's half a megabyte without gzip crossing a
continent. API numbers, being small JSON, are far less affected. It gets
fixed before the next round, and runner vs local page numbers shouldn't be
read as pure network cost.

**Generating load next to the server isn't clean either.** The on-host
numbers ran k6 on the same VM serving Nexo, competing with five instances,
Postgres and nginx's TLS. That makes them pessimistic for the server, but
"~1,500 users within target" was measured on a host doing two jobs at once.
And my own machine, 4 cores on a residential connection, can't generate
1,500 VUs: I tried, and got 44% failures from generator timeouts. It's only
good for measuring with a few VUs while something else generates the load.

**A VU is still not a user.** A VU here signs in once and then makes one
request every 3-15 s, across four public pages and three API endpoints.
Real users download JS, CSS and images (Cloudflare now absorbs the static
assets), prefetch links, open the realtime WebSocket and browse workspace
pages. None of that is in the scenario.

**Signed-in navigation wasn't load tested.** Workspace pages were rewritten
to render their heading at once and stream their data, and none of them is
in the scenario. The signed-in navigation load test is still pending; the
current one exercises the authenticated API, not private page rendering.

**The on-host numbers have no public run.** The GitHub ones anyone can
check: run id, JSON artifact, log. The on-host k6 ones, no: they live in
commit messages and my notes, and I didn't cleanly separate how much of the
gain came from five instances and how much from cheaper pages, because I
changed both the same day. The heap snapshot was also taken locally, on a
reproduction with 200 VUs for 4 minutes, not in production; in production
what I have is the RSS curve before and after. And the production nginx
`upstream` config isn't versioned in the repo (only the Cloudflare real-IP
one is), so the `least_conn` I describe you'll have to take on trust for
now.

**Per-instance state isn't gone, just inventoried.** Rate limits and
connections are solved. `'use cache'` was worked around page by page, not
solved with a shared cache handler: the next page that needs cache with
invalidation has to remember this, and nothing in the build will warn. The
argon2 concurrency gate (`AUTH_VERIFY_CONCURRENCY`) is per instance too;
there that's desired, since login capacity grows with it, but the number of
concurrent logins allowed is five times the configured value. And I didn't
test the two-versions window during a rolling deploy: I know it exists, I
don't know what a client sees if it lands on the old build after loading
the new one.

## What this proves, and what it doesn't

It proves that in real production one instance's ceiling was single-thread
CPU (~51 req/s at plateau, with Postgres at 4-10%), and that five instances
behind nginx, on a 6 physical core VM with prerendered public pages,
sustain ~160 req/s for 5 minutes at 1,500 VUs, three times over, with 3
failures in ~211k requests. It proves the memory crash had a one-line
cause, a log flush per request, hidden behind the CPU ceiling until
someone applied load long enough. And it proves replicating a process is
the easy part: the real work was finding everything that lived in its
memory.

It doesn't prove how many real users Nexo can take: the scenario doesn't
browse signed-in pages, doesn't download assets and runs at a pace I
chose. It doesn't separate how much of the gain is instances versus cheaper
pages. It doesn't prove 160 req/s is the current hardware's ceiling, since
none of the outside tests saturated it. And it says nothing about deploying
under load, because no deploy happened during a test.
