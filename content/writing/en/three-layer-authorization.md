---
title: Authorization in three layers — where Nexo decides who can do what
description: "Nexo's middleware can answer one question: does this request carry a session? It can't tell you whether that session is allowed to do what it's asking — and that split is deliberate, not a gap. This is how authorization breaks into three layers with strict responsibilities: edge gate, session resolution, and the real decision, which lives only in the service — never the route, never the middleware."
icon: code
date: "2026-08-29"
---

Nexo's middleware (`proxy.ts`) can answer exactly one question: does this
request carry a session cookie? It doesn't know, and doesn't try to know,
whether the owner of that session is allowed to do what it's asking. An
authenticated user with zero permissions passes through the middleware
exactly like a workspace `OWNER` — the difference only shows up later, in
the service.

```ts
const sessionToken =
  request.cookies.get('better-auth.session_token')?.value ||
  request.cookies.get('__Secure-better-auth.session_token')?.value

if (!sessionToken) {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, statusCode: 401, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    )
  }
  const redirectTo = encodeURIComponent(pathname + request.nextUrl.search)
  return NextResponse.redirect(new URL(`/sign-in?redirect=${redirectTo}`, request.url))
}
```

That isn't an incomplete implementation — it's the right boundary for this
code to live at. Authentication (who you are) and authorization (what you
can do) are different questions, answered in different places, on purpose.

## The problem: middleware that decides too much becomes a maintenance bottleneck

The temptation to put authorization in middleware is real — it's one
place, it runs before everything, it feels like the natural spot to
centralize rules. The problem shows up in practice: middleware has no
business context. It doesn't know whether the resource a request is
touching belongs to that user, or what their `role` is *in that specific
workspace* — that requires a database lookup, and every extra lookup in
middleware is latency every request pays, even the ones that never needed
the check.

The opposite also breaks: authorization scattered across each route,
decided ad hoc, produces inconsistency — one route remembers to check
ownership, another forgets, and there's no single place to audit "every
permission check in the system."

## The idea: three layers, three responsibilities, no overlap

**Layer 0 — edge gate** (`proxy.ts`): does a session cookie exist? A
private route with no cookie becomes a 401 (`/api/*`) or a redirect to
`/sign-in`. It only checks *presence*, never permission. Public routes
(`/`, `/sign-in`, `/api/status`, `/pricing`, `/careers`, among others, in an
explicit allowlist) skip the check entirely.

**Layer 1 — session** (`getAuthSession()`): resolves `actorId` from the
cookie, as a `Result`. Every authorization decision starts from that id —
nothing before this point knows who the actor is.

**Layer 2 — service**: the real decision, and only here. Two distinct
patterns coexist:

```ts
// Ownership — personal resource (sticky-note, short-link)
if (resource.userId !== actorId) return err(forbidden())

// RBAC — workspace resource (Membership.role)
if (membership.role !== 'OWNER') {
  auditMutation({
    entity: 'workspace', action: 'delete', actorId,
    targetId: workspaceId, outcome: 'failure', reason: 'insufficient_role',
  })
  return err(forbidden('Only OWNER can delete'))
}
```

Ownership is the simpler question: is this resource yours? RBAC is richer:
what's your role *in this workspace* — `OWNER`, `ADMIN`, `MEMBER`,
`VIEWER`, decreasing power hierarchy, a single `OWNER` per workspace by
business rule, not a database constraint.

## Results: zero authorization outside the service

The split is clean enough to become a testable rule: **zero permission
logic in middleware, zero permission logic in routes** — the route only
resolves identity (`getAuthSession`) and hands off to the service, which is
where 100% of the "allowed or not" decisions happen. That means auditing
authorization means auditing a finite, known set of files — the
services — not the entire route surface.

## Where it broke: a manual allowlist and prefix string matching

`PUBLIC_ROUTES` is a hand-maintained array. Forgetting to add a new route
to that list fails closed — it becomes a 401/redirect by default, the safe
side of the error. But the reverse is also possible:
`pathname.startsWith(`${route}/`)` matches any sub-route by prefix, so an
entry meant to expose `/docs` also exposes anything under
`/docs/whatever-comes-next` — nothing private has leaked this way so far,
but the mechanism depends on whoever writes the list thinking through that
side effect; the type system doesn't stop it.

Second gap: the RBAC model has exactly four fixed roles. There's no
granular per-action permission (for example, "can edit an issue but can't
invite a member") — anyone who needs more nuance than
`OWNER`/`ADMIN`/`MEMBER`/`VIEWER` has nowhere to put it today.

## What this proves, and what it doesn't

It proves authorization decided in one place (the service) is auditable in
a way scattered authorization never is — and that separating "has a
session" from "can do this" keeps middleware from becoming a bottleneck for
context it was never meant to have. It doesn't prove the public-route
allowlist is foolproof — it's a list kept correct by discipline, not by the
type system. It doesn't prove four fixed roles scale to every future
permission need — today they scale to what Nexo needs, not to whatever a
larger customer might eventually ask for.
