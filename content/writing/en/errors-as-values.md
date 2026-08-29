---
title: Errors as values — why almost nothing in Nexo throws
description: "A repository swallowed the underlying Prisma error and returned only an opaque DATABASE_ERROR — the real cause never reached the log. That bug is why Nexo treats errors as return values instead of exceptions: a Result<T, AppError> type that crosses repository → service → route without ever throwing, translated to HTTP at exactly one boundary. This is how it works, where the discipline broke once, and the three specific cases where throw is still fine."
icon: code
date: "2026-08-29"
---

Somewhere in an earlier Nexo commit, a repository did this:

```ts
} catch (error) {
  return err(databaseError())
}
```

Without logging `error`. The actual cause of the failure — a connection
timeout, a violated constraint, a broken query — disappeared inside the
`catch`, and all that survived in the log was `DATABASE_ERROR`, the same
string for anything that could go wrong in Postgres. Figuring out *why* a
query failed turned into guesswork.

The helper that exists today to close that hole (`repositories/db-error.ts`)
carries that history right in its own comment:

```ts
/**
 * Logs the underlying failure and returns a DATABASE_ERROR AppError.
 *
 * Repositories previously swallowed the Prisma error, so a failed query
 * surfaced only as an opaque DATABASE_ERROR. Route every repository catch
 * through this helper so the real cause is always logged.
 */
export function dbError(message: string, cause: unknown): AppError {
  logger.error('repository.database_error', {
    message,
    cause: cause instanceof Error ? cause.message : String(cause),
  })
  return databaseError(message)
}
```

That's not a hypothetical best-practices example — it's a real bug that
already happened in my own code, documented in the comment left by whoever
fixed it. And it's the most concrete reason I have for why Nexo treats
errors as **return values**, not exceptions, across almost the entire
stack.

## The problem: `throw` hides the cause until someone goes looking

Using `throw` for control flow has a cost that only shows up later: the
caller of a function can't tell from its signature that it might fail — and
when it does, the error climbs the call stack until something catches it
(or it becomes a generic 500), carrying only whatever the nearest `catch`
decided to preserve. If that `catch` is careless — like in the example
above — the real cause turns into a fixed string, and the next debugging
step is reproducing the bug again, hoping to capture more context this
time.

The second problem shows up on the other end of the stack: the frontend.
Without a discriminated error type, every API call turns into a generic
`try/catch` doing string-matching on `error.message` to decide what to show
the user — fragile, because that message is free-text in Portuguese meant
for debugging, not a contract.

## The idea: an error is a value, not an exception

```ts
// src/lib/result.ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
```

`AppError` is an immutable object with a `code` drawn from a closed
taxonomy (`UNAUTHORIZED`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`,
`DATABASE_ERROR`, and so on), a message, and optional `details` — no stack
trace, because it isn't meant for exception debugging, it's meant to become
an HTTP response. The rule is simple to state and hard to keep: **an error
climbs the stack as `Result.err` all the way to the route handler. Never as
a `throw`.**

## How it works: repository → service → route, no `throw` in between

The repository returns a `Result` and never lets the raw Prisma error
escape:

```ts
export const findBySlug = async (slug: string): Promise<Result<Workspace>> => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { slug } })
    if (!ws) return err(notFound('Workspace'))
    return ok(ws)
  } catch (error) {
    return err(databaseError(error instanceof Error ? error.message : undefined))
  }
}
```

The service propagates the repository's error without re-wrapping it, and
layers its own business rules as new `err(...)` values:

```ts
export const get = async (userId: string, slug: string) => {
  const wsResult = await WorkspaceRepository.findBySlug(slug)
  if (!wsResult.ok) return wsResult // propagate the repo's AppError

  const membership = await MembershipRepository.findFor(userId, wsResult.value.id)
  if (!membership.ok) return err(forbidden('not_a_member'))

  return ok(wsResult.value)
}
```

And only the route — the boundary with HTTP — knows how to translate an
`AppError` into a `NextResponse`:

```ts
export const GET = withAxiom(async (req, { params }) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const result = await WorkspaceService.get(auth.value.user.id, params.slug)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
```

`handleError` is the only place in the code that knows the `code → HTTP
status` table:

| Class | Codes | Status |
| --- | --- | --- |
| Auth | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | 401 |
| Authz | `FORBIDDEN` | 403 |
| Client | `BAD_REQUEST` | 400 |
| Client | `RESOURCE_NOT_FOUND` | 404 |
| Client | `CONFLICT` | 409 |
| Client | `VALIDATION_ERROR` | 422 |
| Throttle | `RATE_LIMITED` | 429 |
| Server | `DATABASE_ERROR` | 500 |

The frontend only ever looks at `error.code` to decide behavior — never
parses `message`, which is free-text Portuguese aimed at whoever reads the
JSON for debugging, not a machine contract.

`throw` is still legitimate in three specific situations — it's not banned
outright:

1. **External adapters** (the Resend SDK, the AWS SDK) can throw — the
   boundary in our own code (service or repository) catches it and converts
   it to an `AppError` before letting anything climb further.
2. **`'server-only'`** catching misuse from client code — that's a build-time
   error, not a runtime one, so it's allowed to throw.
3. **Programmer error** (a `switch` with no `default`, a broken invariant) —
   a plain `throw new Error(...)` becomes a 500 via `withAxiom`, on purpose:
   it isn't an `AppError` because it isn't a business error, it's a bug.

## Results: real coverage, an unfinished migration

The pattern covers roughly 30 repositories and 20 mappers today, all
following the same shape. But the route layer — where everything
converges — still has three styles coexisting: the manual sequence
(`session → rate-limit → parse → service → response` written by hand)
dominates **roughly 40 of 42 routes**; two newer wrappers
(`withAuthenticatedRoute`/`withValidatedBody`) condense that sequence, but
they've only been adopted in `short-links` and `sticky-notes`, and only for
`GET`/`POST` — the `PATCH`/`DELETE` handlers in those same domains are still
manual. This isn't a finished migration, it's an ongoing one.

## Where it broke: the antipattern I committed myself

The most honest part of this post already showed up at the top: **I'm the
one who wrote the `catch` that swallowed the Prisma error.** `dbError()`
exists because someone — me, in an earlier commit — violated the exact rule
this post describes, and the comment in the code is proof of that, left on
purpose so it doesn't happen again.

Other real weak points, not hypothetical ones:

- **`Result` doesn't compose.** Every step needs a manual `if (!result.ok)
  return result` — there's no `.map`/`.andThen` like `neverthrow` or
  `fp-ts` give you. That's a deliberate trade for simplicity (zero
  dependencies, no learning curve for anyone who's never seen an Either),
  but it costs verbosity — a 5-step chain is 5 repeated guard clauses.
- **Keeping PII out of `details` is a discipline rule, not a type-level
  one.** The documented antipattern is "don't put email, session IDs, raw
  payloads in `details`" — but nothing in the compiler stops anyone from
  doing it. It depends on whoever writes the `AppError` remembering.
- **The route-wrapper migration stalled halfway.** `withAuthenticatedRoute`
  has existed long enough to become the default, but 40 of 42 routes are
  still manual — rewriting route by route has never outranked anything else
  on the priority list so far.

## What this proves, and what it doesn't

It proves a business error in Nexo never turns into an opaque 500 without a
`code` — every failure path that matters (authorization, conflict,
database) carries a closed category all the way to the client, and the bug
that prompted this post has already been fixed and documented so it doesn't
repeat. It doesn't prove `throw` disappeared from the code — it still
exists, on purpose, in the three cases listed above. It doesn't prove the
migration to the newer route wrappers is done — 40 of 42 routes still write
the manual sequence, and there's no deadline set for that to change.
