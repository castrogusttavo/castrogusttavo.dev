---
title: Defense in depth — CSP, rate limits, and what protects Nexo before business code runs
description: "Every security guide says never use unsafe-inline in your CSP. Nexo does — and the comment in the code explains exactly why this is a documented exception, not an oversight. This is how Nexo's defenses layer up before any route runs: per-request nonce CSP, six rate-limit buckets tuned per risk profile, and a header check that runs against production every single week."
icon: bug
date: "2026-08-29"
---

Every security guide says never use `unsafe-inline` in your CSP. Nexo
does — in `style-src`, specifically — and the comment left in the code
explains exactly why this is a documented exception, not an oversight:

```ts
// style-src keeps 'unsafe-inline' as a deliberate trade-off, not an
// oversight: our UI primitives (Radix/Base UI popovers, tooltips, dropdowns)
// position themselves via inline style="" attributes, and CSP has no
// nonce/hash mechanism for the style attribute (only for <style>
// elements/blocks). Dropping unsafe-inline here would break floating-UI
// positioning app-wide. Re-evaluate if/when the UI kit moves off inline
// transforms.
```

`script-src`, on the other hand, gets no exception at all: per-request
nonce, `strict-dynamic`, zero `unsafe-inline`. The difference between the
two directives is the whole summary of how Nexo thinks about defense in
depth — each layer is configured for the real risk it covers, not a
generic checklist applied uniformly to everything.

## The problem: too strict a CSP breaks the UI, too loose protects nothing

The obvious temptation with a security guide in hand is applying the
strictest rule everywhere — zero `unsafe-inline`, always. In practice, UI
libraries that position elements via inline `style=""` (Radix, Base UI —
tooltips, popovers, dropdowns) break under that CSP, because CSP has no
nonce or hash mechanism for the `style` attribute, only for `<style>`
blocks. The most common wrong answer at that point is giving up on CSP
entirely, or throwing `unsafe-inline` into `script-src` too — the exception
that should have been surgical becomes a door left open on everything.

## The idea: each layer, its own scope, its own risk

```ts
function buildCspHeader(nonce: string): string {
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    frame-ancestors 'none';
    object-src 'none';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim()
}
```

The nonce is generated per request, in middleware, and propagated via an
`x-nonce` header — every response carries a different CSP, which makes
`script-src` genuinely closed: only a script carrying that exact request's
nonce runs, no static whitelist an injected XSS payload could reuse.
`style-src` opens the documented exception. `frame-ancestors 'none'` and
`object-src 'none'` shut down clickjacking and legacy plugins at zero UI
cost — there's no trade-off there, so there's no exception.

Rate limiting follows the same "each layer, its own risk" logic — six
buckets, six profiles:

| Bucket | Points | Window | Extra block |
| --- | --- | --- | --- |
| `auth` | 10 | 15 min | 30 min |
| `otp` | 5 | 15 min | — |
| `email` | 5 | 1 h | — |
| `api` | 100 | 1 min | — |
| `export` | 1 | 24 h | — |
| `upload` | 10 | 1 min | — |

`auth` is the only one with a `blockDuration` — ten wrong login attempts in
15 minutes cost an extra 30 minutes locked out, because it's the bucket
protecting against credential brute-forcing, the priciest risk on the
list. `export` allows one request per day — generating a user's data
export is expensive enough that anything more doesn't make sense.

Authenticated routes consume by `user:<id>`; public routes (no session,
like `talk-to-sales` or a job application) use a specific wrapper that
resolves the key by IP before the handler runs:

```ts
export const POST = withAxiom(
  withRateLimit(
    (request) => ({ limiter: apiLimiter, key: `ip:${getClientIp(request)}` }),
    async (request) => { /* ... */ },
  ),
)
```

## Results: checked every week, not just at code-review time

`headers-check`, a CI job, runs `curl -I` against production and fails if
any of five security headers is missing —
`x-frame-options`, `x-content-type-options`, `strict-transport-security`,
`content-security-policy`, `referrer-policy`. That turns "the headers are
there" from a claim about the code into a continuous check against what's
actually being served in production.

## Where it broke: rate limiting fails open when Redis fails

The most concrete gap sits right inside `consume()`:

```ts
} catch (cause) {
  if (cause instanceof RateLimiterRes) {
    return err(rateLimited(retryAfterSeconds)) // a real limit hit
  }
  // connection/infra error talking to Redis
  logger.error('rate_limit_store_error', { /* ... */ })
  return ok(undefined) // let it through
}
```

If the Redis backing the rate limiter is down, the request **goes
through** — fails open, not closed. It's the same philosophy as the cache
post: degrade instead of breaking the request. But here the cost is
different: with the cache, degrading costs latency; with rate limiting,
degrading costs the protection itself — exactly when infra is unstable
(a common reason a brute-force attempt gets tried in the first place) is
when the limit stops applying.

Second gap: only `auth` and `otp` have an `insuranceLimiter` (a
`RateLimiterMemory` backup) configured. `api`, `email`, `export`, and
`upload` don't — if Redis goes down, those four buckets have no safety net
at all, not even in memory. And even where it exists, the in-memory
limiter is per instance — running N replicas of the app, the effective
"backup" limit is N times looser than the configured number suggests.

## What this proves, and what it doesn't

It proves defense in depth doesn't mean applying the strictest rule
everywhere — it means choosing, layer by layer, where strictness is worth
the cost and documenting where it isn't. It proves the security headers are
checked continuously, not just trusted. It doesn't prove rate limiting
holds up under infrastructure failure — the design chosen degrades open,
not closed, and that's a real protection gap, not a hypothetical one. It
doesn't prove uniform fallback coverage — two of six buckets have a safety
net, four have none.
