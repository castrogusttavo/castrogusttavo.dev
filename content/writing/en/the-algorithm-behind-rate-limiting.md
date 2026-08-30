---
title: The algorithm behind rate limiting — Flexible Fixed Window, not token bucket
description: "If you've ever implemented rate limiting, you probably reached for token bucket. The rate-limiter-flexible package Nexo runs in production isn't that — the library's own README calls its algorithm Flexible Fixed Window. This is the classic problem naive fixed windows have, what the flexible version fixes (and doesn't), and how the same six parameters of one algorithm become six different risk profiles in Nexo."
icon: idea
date: "2026-08-29"
---

If you've ever implemented rate limiting, you probably reached for token
bucket — it's the algorithm that comes up most when the topic surfaces.
`rate-limiter-flexible`, which Nexo runs in production, isn't that. The
library's own README is direct about which algorithm sits behind it:

> The Flexible Fixed Window algorithm starts counting from the moment a
> request is received, diversifying rate limit reset times across clients.

Fixed Window, not token bucket — with one detail in the name, "flexible,"
that's exactly what avoids the naive version's classic problem.

## The problem: a naive fixed window lets twice the limit through

A classic fixed window divides time into clock-aligned blocks — "10
requests per 15-minute window," counting `14:45:00` through `14:59:59`,
then `15:00:00` through `15:14:59`. The problem shows up exactly at the
boundary between two blocks: nothing stops 10 requests at `14:59:59` and
another 10 at `15:00:01` — 20 requests in two seconds, each falling inside
its own block, no rule violated on paper. The nominal "10 per 15 minutes"
limit, in practice, allows double that, concentrated right at the point a
brute-force attempt would want to hit.

## The idea: the window starts at the request, not at the clock

The "flexible" version changes one thing: the window doesn't start at a
global instant aligned to the clock — it starts the moment **that specific
key** receives its first request. Two different keys (two users, two IPs)
have windows starting at different moments, each resetting 15 minutes
after its own first consumption, not at the same `:00` second for
everyone.

That doesn't fully eliminate the boundary burst for a single key — it can
still, in theory, consume near the end of its own window and again right
after it resets. What the flexible version eliminates is the more
dangerous pattern at scale: an attacker can't synchronize multiple keys to
exploit the same global clock boundary, because that global boundary
doesn't exist — every key has its own.

## How it works: the same algorithm, six parameters, six risk profiles

```ts
export const authLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:auth', points: 10, duration: 900, blockDuration: 1800,
})
export const otpLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:otp', points: 5, duration: 900,
})
export const apiLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:api', points: 100, duration: 60,
})
export const exportLimiter = new RateLimiterRedis({
  keyPrefix: 'rl:export', points: 1, duration: 86400,
})
```

`points` is how many units a key can consume, `duration` is the window
size in seconds, `blockDuration` (only on `auth`) is an **additional**
lockout after the limit is blown — it isn't part of the fixed window
itself, it's an extra penalty stacked on top, reserved for the bucket that
protects against credential brute-forcing.

When the limit blows, the library throws `RateLimiterRes`, which Nexo
converts into the same error shape as the rest of the system:

```ts
if (cause instanceof RateLimiterRes) {
  const retryAfterSeconds = Math.max(1, Math.ceil(cause.msBeforeNext / 1000))
  return err(rateLimited(retryAfterSeconds))
}
```

`msBeforeNext` is how long until that specific key can consume again — not
a generic fixed value, it's computed from the moment that key's own window
started. That number becomes the `Retry-After` HTTP header on the final
response — the algorithm behind a number a lot of API clients read and
obey without knowing where it came from.

## Results: the same mechanism reused without rewriting anything

Six buckets, six risk profiles, zero duplicated rate-limiting logic —
`auth` is tight and penalizes a blown limit with an extra lockout because
it protects against brute-forcing; `export` allows one unit a day because
generating an export is expensive; `api` allows 100 a minute because
that's normal usage traffic. The algorithm is the same everywhere; only
the configuration changes, decided by the risk each route carries.

## Where it broke: fails open, and the in-memory backup isn't a real backup

The most concrete limitation already showed up in the defense-in-depth
post: if the Redis backing the limiter's state goes down, `consume()` lets
the request through — the algorithm simply stops being enforced, it
doesn't fail closed for safety.

The second is subtler, and specific to the algorithm: the
`insuranceLimiter` — configured only for `auth` and `otp` — is a
`RateLimiterMemory`, held in the local process. Running a single replica,
that works as expected. Running N replicas behind a load balancer, each
one keeps its **own** count in memory, with no shared state — an attacker
distributed across N replicas effectively gets N times the configured
limit, with no single replica seeing the full picture. The algorithm
itself stays correct; it's the fallback's topology that breaks the
guarantee it promises.

## What this proves, and what it doesn't

It proves "Flexible Fixed Window" isn't the same algorithm as token
bucket, and that the difference — a per-key window instead of a global
clock-aligned one — is what prevents burst synchronization across multiple
attackers, not the boundary-burst problem for a single key at its own
edge. It proves the same mechanism, with different parameters, covers very
different risk profiles without needing six separate implementations. It
doesn't prove the system holds up under Redis failure — it fails open, by
design. It doesn't prove the in-memory backup keeps the same guarantee
across multiple replicas — the count isn't shared, and that multiplies the
effective limit by however many instances are running.
