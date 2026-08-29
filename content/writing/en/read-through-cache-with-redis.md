---
title: The cache that never breaks a request — read-through with Redis in Nexo
description: "Every caching layer has one question that decides whether it's safe: what happens when Redis is down? In Nexo, the answer is that no cache method is allowed to propagate an exception — get degrades to a miss, set and invalidate degrade to a logged no-op, and the request never finds out Redis failed. This is how the per-entity read-through pattern works, the three logical Redis consumers sharing one physical server, and the gap left accepted on purpose: no stampede protection."
icon: code
date: "2026-08-29"
---

Every time someone adds a caching layer, there's one question that decides
whether it made the system safer or just added a new way to take production
down: **what happens when Redis is unreachable?** If the answer is "the
request breaks," the cache didn't reduce risk — it created a new, mandatory
dependency on a service that was only ever supposed to be optional.

In Nexo, the answer is testable by reading the code: every cache method —
`get`, `set`, `invalidate` — sits inside a `try/catch` that never lets
anything escape.

```ts
async get(id: string): Promise<T | null> {
  try {
    const client = await ensureRedisConnected()
    const data = await client.get(`${prefix}${id}`)
    if (!data) return null
    return JSON.parse(data) as T
  } catch (cause) {
    warn('get', id, cause)
  }
  return null
}
```

Redis being down and a cache miss produce the exact same result for the
caller: `null`. The only difference lives in the log.

## The problem: a cache becomes a hard dependency by accident

The most common way a caching layer turns into risk is exactly this: not
handling that case, letting the Redis client's exception climb raw. In a
naive implementation, a connection failure inside `get` becomes an
unhandled exception in the middle of a request, and what was supposed to be
a latency optimization becomes a new source of 500s that didn't exist
before the cache did. The second, less obvious problem is invalidation:
caching without a clear policy for when to invalidate produces stale data
served with full confidence — worse than having no cache at all, because
the failure is silent.

## The idea: per-entity read-through, degrading on every operation

Each domain cache is a `{ get, set, invalidate }` object, built by a shared
factory:

```ts
// src/cache/_cache.ts
export function createKeyedCache<T>({ prefix, ttl, name }: KeyedCacheConfig): KeyedCache<T> {
  // ...
  return {
    async get(id) { /* try/catch → null on any failure */ },
    async set(id, value) { /* try/catch → logged no-op */ },
    async invalidate(id) { /* try/catch → logged no-op */ },
  }
}
```

And each entity only declares a prefix, a TTL, and a name:

```ts
// src/cache/notification-setting.cache.ts
export const NotificationSettingCache = createKeyedCache<NotificationSettingDTO>({
  prefix: 'notif:',
  ttl: 15 * 60,
  name: 'notification_settings',
})
```

The read-through pattern itself — try the cache, fall back to the database
on a miss, populate the cache for the next request — doesn't live inside
the cache object. It lives in the service:

```ts
async get(actorId: string) {
  const cached = await NotificationSettingCache.get(actorId)
  if (cached) return ok(cached)

  const found = await NotificationSettingRepository.findByUserId(actorId)
  if (!found.ok) return found

  const dto = toNotificationSettingDTO(found.value)
  await NotificationSettingCache.set(actorId, dto)
  return ok(dto)
}
```

The cache object doesn't know about the repository — it only knows how to
store and return bytes. The service is what decides when to consult what,
which keeps the cache layer deliberately dumb and easy to test in
isolation.

## How it works: three caches today, TTL tied to a real window

| Cache | Key | TTL | Content |
| --- | --- | --- | --- |
| `UserCache` | `user:<userId>` | 15 min | `UserDTO` |
| `WorkspaceCache` | `workspace:<workspaceId>` | 15 min | `WorkspaceDTO` (no memberships) |
| `StatusCache` | `status:snapshot:v1` (single key) | 30 s | status-page snapshot |

The 15-minute TTL on `User`/`Workspace` isn't an arbitrary round number —
it's the same lifetime as the access token, so cache and session expire in
sync. `StatusCache` carries a version suffix (`:v1`) right in the key:
changing the snapshot's shape is just moving to `:v2`, no migration needed —
the old key simply stops being read and expires on its own.

The write policy fits in one sentence: **writes invalidate, they never
repopulate.** `create`/`update`/`delete` call `invalidate`; the next read
repopulates via read-through. That avoids ever caching an intermediate
state that never really existed in the database. There's also cross-entity
invalidation: when a membership change affects someone's cached
`WorkspaceDTO`, both `User` and `Workspace` get invalidated — because the
workspace DTO doesn't carry the member list, only whoever depends on that
relationship knows the other side needs invalidating too.

One structural detail only shows up when you look at the whole
infrastructure: Nexo has **three logical Redis consumers, two different
clients, one physical server.** The application cache uses `redis`
(node-redis) with a lazy connection — nothing connects on import, only the
first `ensureRedisConnected()` opens the socket. The background job queue
(BullMQ, a separate post) uses `ioredis`, with `maxRetriesPerRequest: null`
— a BullMQ requirement that's incompatible with the app cache's config. Two
clients that don't know about each other, pointed at the same Redis.

## Results: coverage discipline, not a benchmark

Unlike the post about scaling Nexo to a million users, I don't have a
hit-rate or latency number to show here — no load test has run against this
layer specifically. What exists is architecture by design: three caches
covering the most-read entities (user, workspace, status), a TTL tied to a
real business window instead of an arbitrary one, and an invalidation rule
that doesn't depend on remembering to repopulate. I'd rather own that gap
than invent a number I don't have.

## Where it broke: no stampede protection, on purpose

The realest, most documented, most accepted gap: **there's no stampede
protection.** If a TTL expires and several requests hit the same data at
once, all of them miss and all of them hit Postgres until the first `set`
finishes — N requests, N queries, none of them aware the others are doing
the exact same thing. This isn't an unnoticed bug: it's a recorded decision
not to solve it yet, because at current volumes the cost of a lock or
stale-while-revalidate would outweigh the problem it solves. It's left to
revisit if it ever becomes a real bottleneck.

Second gap: **no schema versioning**, except for `StatusCache`. Changing
the shape of `UserDTO` or `WorkspaceDTO` without bumping the prefix can
serve an old-shaped JSON until the TTL expires — the one cache that thought
about this from the start was the one that needed it least (a status-page
snapshot with a 30-second TTL).

Third: silent degradation is a double-edged design. Protecting the request
from a Redis failure is the goal — but since every failure only becomes a
`logger.warn`, Redis being down for hours breaks nothing visible to the
user. Without someone watching the `cache.*.get_failed` events in Axiom,
the whole system could be running with zero caching, silently hammering
Postgres harder, with no alarm going off.

## What this proves, and what it doesn't

It proves a Redis failure never becomes a request failure — degradation is
the default behavior of every cache operation, not something handled
case-by-case. It proves the invalidation policy is simple enough that it
doesn't depend on manual discipline at every call site: writes invalidate,
read-through repopulates. It doesn't prove the cache is fast — I have no
benchmark to back that claim. It doesn't prove it survives a stampede — the
documented decision is not to protect against that yet, and I shouldn't
pretend that gap doesn't exist.
