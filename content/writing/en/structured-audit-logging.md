---
title: Answering "who did what" after the fact — structured audit logging with Axiom
description: "auditMutation only accepts 24 entity types and a binary outcome — there's no logging 'kind of worked.' That restriction, not the absence of one, is what makes Nexo's audit trail useful six months after it was written. This is how the two closed event schemas — mutation and auth — turn into a reliable Axiom query, and the point where discipline, not the type system, is what guarantees a failure doesn't go unrecorded."
icon: book
date: "2026-08-29"
---

`auditMutation`, the function that records a state change in Nexo, only
accepts 24 entity types (`user`, `workspace`, `subscription`, `issue`, and
20 others) and a binary `outcome`: `success` or `failure`. There's no
logging "kind of worked," and no inventing a new entity type on the fly —
TypeScript refuses. That restriction is the whole point: a structured log
is only useful months later if the structure was decided ahead of time,
not discovered while someone was writing a `console.log`.

## The problem: ad hoc logging doesn't survive "what happened here?"

`console.log` or `logger.info` with no shared schema is fast to write and
useless to query later. Every call site invents its own shape — one logs
`{ userId, action }`, another logs a free-text string — and "who deleted
this workspace, and did it succeed?" turns into a text search instead of a
structured query. Worse: nothing forces logging the **failure** of a
protected action; only the success path tends to get remembered, because
it's the better-tested one.

## The idea: two closed, typed schemas, mandatory across routes

```ts
type AuditEntity = 'user' | 'workspace' | 'subscription' | 'issue' | /* + 20 others */
type AuditAction = 'create' | 'update' | 'delete' | 'export_completed' | /* + ~16 others */
type AuditOutcome = 'success' | 'failure'

type AuditAuthEvent =
  | 'user.created' | 'session.created' | 'auth.sign_in.success'
  | 'auth.sign_in.failure' | 'auth.2fa_enabled' | /* + others */
```

Two event shapes, each with its own purpose: `audit.mutation.<entity>.<action>`
for a state change on a resource, `audit.auth.<event>` for events in the
authentication lifecycle itself (login, 2FA, session). The first always
carries `actorId`, `outcome`, and optionally `reason`; the second is a
fixed list of event names, without that generic structure — because
authentication has its own vocabulary, "create a workspace" and "sign in"
aren't the same shape of event.

All of this logging flows through a single wrapper:

```ts
export const withAxiom = createAxiomRouteHandler(logger)
```

One line, applied to every route — not a convention each route has to
remember to follow, the handler itself ships instrumented.

## How it works: failure is also an event, not an exception to recording

```ts
if (membership.role !== 'OWNER') {
  auditMutation({
    entity: 'workspace',
    action: 'delete',
    actorId: userId,
    targetId: workspaceId,
    outcome: 'failure',
    reason: 'insufficient_role',
  })
  return err(forbidden('Only OWNER can delete'))
}
```

The rule is to record both success **and** failure on every mutation that
goes through an authorization check — not just the happy path. `reason` is
a short snake_case string convention (`not_a_member`, `insufficient_role`,
`email_conflict`) — it isn't `error.message`, it's a classification key
meant to become an Axiom query filter, not text for a human to read.

Operational retention: 365 days — the minimum required by SOC2 CC7.2, not
a number picked for storage-cost convenience.

## Results: 24 entities, ~20 actions, both paths always covered

Coverage today spans 24 entity types and roughly 20 action types, all
typed — adding a new event means editing a union type, not inventing a new
string somewhere in the code and hoping no one types it differently next
time. Every mutation gated by an authorization check has, by convention,
both branches (success and failure) emitting an event — that's not partial
coverage documented as an aspiration, it's the standard way of writing that
kind of code in Nexo.

## Where it broke: auditing failure isn't type-enforced

The most honest limitation: nothing in the compiler forces calling
`auditMutation` before the `return err(...)`. The type guarantees that
**if** you call it, the event's shape is correct — it doesn't guarantee
you'll remember to call it. Forgetting to audit a failure is a documented
antipattern, not a TypeScript error. The audit trail depends on human
discipline at exactly the point where it matters most — the error path,
which is by nature the least-tested one.

Second gap: `reason` is a string convention, not a closed enum like
`AuditEntity`/`AuditAction`. Two developers can write
`insufficient_role` and `insufficient_permission` for the same reason, and
nothing flags the duplication — the Axiom query meant to group both as one
case only sees two.

## What this proves, and what it doesn't

It proves a closed, typed event schema is queryable months later in a way
free-text logging never is — "who did what, and did it succeed?" becomes a
filter, not a search. It proves instrumentation is born with the route,
via `withAxiom`, not an extra step someone can skip. It doesn't prove every
relevant failure always gets audited — that depends on whoever wrote the
code remembering to, and that has already failed before elsewhere in Nexo
(see the post on errors as values). It doesn't prove `reason` is a
duplicate-free taxonomy — it's a naming convention, not a type.
