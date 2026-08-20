---
title: Everything I know about good API design
description: An article by Sean Goedecke crystallized an instinct I already had building nexo's backend — the difference isn't which rules you pick, it's where they're actually enforced and where someone admits they aren't.
icon: code
date: "2026-08-19"
---

There's a line in Sean Goedecke's post on API design
([seangoedecke.com/good-api-design](https://www.seangoedecke.com/good-api-design/))
that named an instinct I already had but had never quite put into words: a
published API is close to an immutable promise — "we do not break
userspace." He builds a dozen principles on top of that: versioning as a
necessary evil, API keys over OAuth for accessibility, cursor pagination
over offset, idempotency for anything that mutates state. I agree with
almost all of it.

But no single principle explains why parts of nexo's API — the SaaS I help
build — aged well, and other parts didn't. The difference was never in the
rule on paper. It was in where the rule actually got enforced everywhere it
needed to, and where someone consciously decided it wouldn't be, and said so
out loud.

## One envelope, one source of truth, no accidental exceptions

Every nexo API route returns the same shape: success is
`{ success, statusCode, data }`, errors are
`{ success, statusCode, message, error }`. That's not an informal
convention — it's a union type (`types/http-response.d.ts`) and two
functions (`successResponse`, `errorResponse` in `utils/http-response.ts`)
that are the only place in the codebase constructing those shapes. No
service or repository throws across layers: they return
`Result<T, AppError>`, and callers propagate the error until a route
decides what to do with it.

`AppError` itself comes from a central registry (`src/errors/codes.ts`)
mapping every domain error code to the right HTTP status. That should be
proof against bugs — and it almost is. But it's a hand-maintained text file,
and hand-maintained text files get bugs:

```ts
// src/errors/codes.ts
ESTIMATE_SETTINGS_FORBIDDEN: {
  code: 'ESTIMATE_SETTINGS_NOT_FOUND', // should be 'ESTIMATE_SETTINGS_FORBIDDEN'
  status: 403,
},
```

A client hitting a 403 on that route gets back
`error.code: "ESTIMATE_SETTINGS_NOT_FOUND"` — the wrong code, even though
the HTTP status is right. Elsewhere in the same file,
`MODULE_MEMBER_ALREADY_EXISTS` maps to **405** (Method Not Allowed), while
every other "already exists" error in the file uses 409 (Conflict).

That doesn't disprove centralizing the source of truth — it proves the
opposite. The bug is a one-line diff to fix, not a hunt across 89 route
files trying to remember where each error gets hand-built. The architecture
doesn't prevent the mistake; it shrinks the blast radius when one happens.
That's the metric that matters, not "zero bugs on the first commit."

## We don't version, and that's not laziness

nexo has no `/v1/` anywhere. Zero versioned routes, an OpenAPI spec pinned
at `1.0.0`, a project in active development, commits going straight to
`main` with no release branch. By Goedecke's own standard — never break a
published contract — that looks like an oversight. It isn't.

Versioning an API means promising to keep `/v1/` and `/v2/` running
simultaneously, forever, for users who might not even exist yet. nexo
hasn't paid the cost of publishing a contract to a broad, unknown audience
— today's API consumers are the app's own frontend and a small, identifiable
set of integrations. Adding versioning now would mean paying the complexity
of a promise nobody's actually holding you to. Goedecke draws this same
line himself: an internal API, with consumers you can coordinate directly,
doesn't need the same immutability as a public API with thousands of
unknown integrations. Not versioning isn't the absence of a decision — it's
the right call for the stage the project is at, revisable the day it stops
being right.

## Consistency isn't a written rule, it's an enforced one

Workspace member listing has real pagination, with a capped page size:

```ts
// src/schemas/member.schema.ts
page: z.coerce.number().int().min(1).default(1),
pageSize: z.coerce.number().int().min(1).max(100).default(20),
```

A project's issue listing — which grows with no natural ceiling, unlike the
member list — has no pagination at all:

```ts
// src/repositories/issue.repository.ts
async listByProject(projectId: string): Promise<Result<IssueWithGroups[]>> {
  const issues = await prisma.issue.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { number: 'asc' },
    include: issueWithGroupsInclude,
  })
  return ok(issues)
},
```

The right pattern exists in the codebase. It just never propagated to the
place that needed it most. That's more telling than if nexo simply didn't
know how to paginate anything — it shows that "having the pattern" and
"having the discipline to apply the pattern everywhere" are two different
things, and only the second one counts as real consistency.

One honest nuance: even the member pagination doesn't follow Goedecke's
specific advice, which favors cursor pagination over offset — offset makes
the database count through every row up to the requested page, which
degrades on large datasets; cursor (`WHERE id > cursor`) doesn't. nexo uses
offset with a capped size. At today's volume, that's not a real problem. If
issue listing ever needs pagination — and it will — the technically correct
choice is cursor, not copying the member pattern. Applying a pattern
everywhere is only a virtue when the pattern is still the right one for the
problem.

## The exception that knows it's an exception

The payment webhook (`app/api/payment/webhook/route.ts`) ignores the
standard response envelope entirely — it returns a raw `{ error: '...' }`,
with no `success`, no `statusCode`, none of the shape every other route in
the API uses:

```ts
// app/api/payment/webhook/route.ts
if (!result.ok) {
  // A flat 500 (not the app's usual per-code status mapping) is
  // deliberate here: AbacatePay retries on 5xx, so a transient lookup
  // failure should be retried, not treated as a permanent rejection.
  return Response.json({ error: result.error.message }, { status: 500 })
}
```

That comment is the difference between technical debt and a design
decision. The payment provider retries the webhook on any 5xx; a flat 500
here guarantees an automatic retry on a transient failure, while a 4xx
would mistakenly mark the event as permanently rejected. Someone thought
about this, chose to break the rule on purpose, and wrote down why.

Compare that to the edge session check (`proxy.ts`), which hand-writes its
own 401 instead of reusing `errorResponse`:

```ts
// proxy.ts
if (pathname.startsWith('/api/')) {
  return NextResponse.json(
    { success: false, statusCode: 401, error: { code: 'UNAUTHORIZED' } },
    { status: 401 },
  )
}
```

That response is missing the `message` field every other error in the API
carries. Nobody decided this route deserved a different shape — it was
just written before, or outside, the shared helper, and stayed that way.
There's no comment explaining why, because there is no why: it's the same
kind of envelope break the webhook has, minus the part where someone took
ownership of it.

## What that actually means

No list of principles — not Goedecke's, not one I'd write from scratch —
decides on its own whether an API ages well. What decides it is whether the
team enforces the rule it picked everywhere that rule needs to hold, and
whether, in the places it doesn't, that was a recorded choice instead of a
silent crack. The difference between nexo's webhook and the proxy's 401
isn't which one breaks convention — they both do. It's that only one of
them knows it does.

Good API design isn't having the right rules on paper. It's the discipline
to enforce them everywhere that matters, and the honesty to name, in
writing, the one place you decided it wasn't worth it.
