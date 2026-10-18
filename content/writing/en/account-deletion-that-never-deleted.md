---
title: The account deletion that never deleted anyone
description: "For four months Nexo promised to erase an account 30 days after the request, and Postgres refused every deletion of anyone who had ever written anything. The job failed three times and died without anyone knowing. This is the root cause (ten required foreign keys with no onDelete), why I chose to anonymize instead of cascading, how nullability travelled from the database up to the UI, and what changed so that a job that always fails no longer looks like a job that never ran."
icon: bug
date: "2026-11-17"
---

Nexo has a delete-account button. You click, confirm, the UI tells you
the account will be erased in **30 days**, and you can change your mind
until then. When the 30 days are up, a job on the `account-lifecycle`
queue runs and deletes the user. It's the most literal LGPD obligation
the product has.

Between the commit that shipped the feature (`8f0f3be0`, May 18) and the
one that fixed it (`94d044f`, September 20), that job **never managed to
delete anyone who had authored anything**. One issue, one comment, one
wiki page, any recorded activity, and Postgres answered:

```
violates foreign key constraint "activities_actor_id_fkey"
```

The job threw, BullMQ retried twice with backoff, gave up and moved the
job to the failed set. Nobody was told. From the requester's side,
nothing visible happened: the account just stayed.

I didn't find this by looking at deletion. I found it by accident, when
the agent building the Playwright suite tried to clean up test data by
deleting the fixture user and hit that error.

## The problem: the schema decided, and nobody decided for the schema

The processor is short and there's nothing wrong with it:

```ts
const deleteResult = await UserRepository.deleteHard(userId)
if (!deleteResult.ok) {
  throw new Error(`deleteHard failed: ${deleteResult.error.code}`)
}
```

`deleteHard` is `prisma.user.delete({ where: { id } })`. The problem was
one level down, in `schema.prisma`: **12 relations to `User` declared no
`onDelete`**.

| Model | Field | Required before? |
| --- | --- | --- |
| `Project`, `Module`, `Cycle` | `leadId` | yes |
| `Issue`, `Comment`, `IssueUpdate`, `WikiComment` | `authorId` | yes |
| `Activity` | `actorId` | yes |
| `Attachment` | `uploadedById` | yes |
| `WikiPage` | `createdById` | yes |
| `WikiPage` | `updatedById` | no |
| `WikiComment` | `resolvedById` | no |

Without `onDelete`, Prisma picks for you. For an optional relation it uses
`SET NULL`, so `updatedById` and `resolvedById` were already fine. For the
**10 required ones**, the generated migration was:

```sql
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

`RESTRICT` is the right default for someone who hasn't thought about the
case: when in doubt, refuse. The mistake was not thinking about the case.
In practice **any user who had ever touched an issue could never be
deleted**, and that had been written in the schema from day one, as the
absence of a single word.

### Why the tests passed

There was a `deleteHard` test, and it passed. The fixture created a user,
deleted it, and checked it was gone. A user with **no content at all**:
the one kind of user who never asks to delete their account, because
the people who ask are the ones who used the product.

The processor test passed too, because it mocked the repository. Each
layer was tested on the assumption that the layer below worked, and the
layer below was tested with data that doesn't exist in the real world.

### Why nobody noticed

The queue defaults are `attempts: 3`, exponential backoff from 5 s, and
`removeOnFail` after **7 days**. A job that always fails burns its three
attempts, lands in the failed set and, a week later, is gone from Redis.
Each attempt was logged to Axiom, but nothing watched that log. I wrote
about this queue in the [BullMQ background jobs](/en/writing/background-jobs-with-bullmq)
post, and the missing dashboard was listed there as a gap. I just hadn't
seen how big it was.

## The idea: LGPD says erase personal data, not the team's work

Fixing the constraint was easy. Deciding what happens to the content of
someone who leaves was the real work. Three options:

| Option | What happens | Why not (or why) |
| --- | --- | --- |
| Cascade | delete everything the person created | issues, comments and wiki in someone else's workspace vanish without anyone on that team asking |
| Tombstone user | reassign authorship to a system account | skips the nullability migration, but adds a fake row every list, count and filter has to remember to hide |
| **Anonymize** | content stays, authorship becomes `null` | chosen |

I chose to anonymize. An issue someone opened, commented on and discussed
with five other people is collective work. The person who leaves takes
their name, e-mail, photo, sessions and preferences with them. They don't
take the rest of the team's project history. LGPD requires personal data
to leave the database; it doesn't require destroying the team's record.

The tombstone was the most tempting, because it touches the least code.
That's why I didn't pick it: it hides the problem. A "Removed user"
account with a real id passes every `!== null`, shows up in member lists,
counts in metrics. Nullability forces the code to handle the case. The
tombstone lets each screen quietly forget it.

## How it works: nullability travelling from the database to the screen

Migration `20260920201252_anonymize_deleted_user_content` does three
things to the 10 required columns: drop the FK, drop `NOT NULL`, recreate
the FK with `ON DELETE SET NULL`. The two already-optional ones got an
explicit `onDelete: SetNull` in the schema, no database change, just so
the intent is written down instead of inherited from a default.

The database is the small part. The commit touches **43 files**, and most
of that is nullability moving outward: the types (`types/*.d.ts`), the
repository include types, the mappers and the UI.

```ts
// types/issue.d.ts
-  authorId: string
+  authorId: string | null
```

The rule I set was no `!` and no `as string` anywhere on the way. If the
type says the author may not exist, every place that reads the author has
to decide what to show. Here's where that bites, in the comment thread:

```tsx
-  isOwn={comment.author.id === userId}
+  isOwn={!!comment.author && comment.author.id === userId}
```

The old line would have crashed the whole screen on the first comment by
someone who'd left. With a nullable type, TypeScript refused to compile
until every one of those spots was handled.

Fallback copy has one home, `lib/removed-user.ts`:

```ts
export const REMOVED_USER_NAME = 'Usuário removido'
export const NO_LEAD_NAME = 'Sem líder'

export function displayUserName(name?: string | null): string {
  return name?.trim() ? name : REMOVED_USER_NAME
}
```

And the "mine" and "created by" filters got an explicit null guard,
instead of relying on `null !== undefined` working out by accident:

```ts
case 'created-by':
  // A deleted author matches no member id, so `mine` and per-member
  // filters never claim an anonymized issue.
  return issue.authorId ? [issue.authorId] : []
```

### The bonus finding

The project members page only allowed management for the lead:
`context.userId === context.project.leadId`. With the lead deleted, nobody
could manage that project from the UI. But the service had always allowed
workspace `OWNER` and `ADMIN`; the UI was **stricter than the API** before
any lead disappeared. Anonymization just made the defect unavoidable. The
page now uses the service's rule, `isPrivileged || isLead`, which is the
point of [authorization in three layers](/en/writing/three-layer-authorization):
the service decides, and a screen shouldn't invent a tighter rule of its
own.

## Results: checked against the database, not the model

Verification was done against the live database, reading Postgres's
constraints rather than `schema.prisma`. The schema says what Prisma
*should* generate; the database says what exists.

| | Before | After |
| --- | --- | --- |
| FKs pointing at `users` | 30 | 30 |
| `ON DELETE CASCADE` | 18 | 18 |
| `ON DELETE SET NULL` | 2 | 12 |
| `ON DELETE RESTRICT` | **10** | **0** |
| User with content can be deleted | no | yes |

The 18 cascaded ones are mostly data that only makes sense with the
person: sessions, OAuth accounts, 2FA, preferences, favourites, project,
module and cycle membership, votes, subscriptions, notes and short links.
Pending invitations they sent go too. And there was a second question:
is any of those 18 tables referenced by another table with `RESTRICT`?
If so, deleting the user would cascade into it and get stuck one level
down. None is. There's no second-order block.

The missing test now exists, as an integration test against real
Postgres. It seeds a user who leads a project and wrote an issue, a
comment, a wiki page and an activity; deletes the user; and requires the
user to be gone and all five pieces of content to survive with null
authorship:

```ts
const result = await UserRepository.deleteHard(user.id)

expectOk(result)
expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull()
expect(await prisma.project.findUnique({ where: { id: project.id } }))
  .toMatchObject({ leadId: null })
expect(await prisma.issue.findUnique({ where: { id: issue.id } }))
  .toMatchObject({ authorId: null })
// ...comment, wikiPage, activity
```

What matters isn't that it passes. It's that restoring the old constraint
makes it fail **with the exact production error**. That was checked, not
assumed. A regression test that doesn't fail against the bug isn't a
regression test.

## The same queue was lying in two other ways

Early in the afternoon of that same September 20, hours before the FK
turned up, the component suite had caught two defects in this queue
(`220ad51b`):

- **`cancelAccountDeletion` always said it had cancelled.** BullMQ's
  `remove()` returns `1` whenever the job isn't locked, **whether it
  exists or not**, and `0` when a worker holds the lock. It doesn't throw
  for a missing job, so the `catch` meant to handle "nothing to cancel"
  never ran. Existence is now read with `getJob()` first.
- **Rescheduling a deletion was silently ignored.** With a custom `jobId`,
  BullMQ keeps the first job and drops the next `add()`. A new deadline
  never took effect. The pending job is now removed before the new `add()`.

I described the first one wrong myself. In the BullMQ post I wrote that
removing a missing job "is a no-op, and the function returns `false`
instead of throwing". The code assumed exactly that, and the post repeated
the code. Neither had read what BullMQ actually does.

Another layer limited the damage: the processor re-checks
`deletionScheduledAt` before acting, so a job that survived a
cancellation would find the field null and end as `skipped`. The lie was
in the answer to whoever cancelled, not in the deletion.

What bothers me most is the order. I spent the start of that day making
scheduling and cancellation "truthful" on a queue whose only job failed
for anyone who had actually used the product. Nothing in that queue told
me so.

## Where it broke: a job that always fails looks like one that never ran

The root cause isn't the constraint. The constraint is the symptom of two
things.

**First: the test exercised a path that doesn't exist in production.** A
deletion test with an empty fixture doesn't test deletion. If the object
has relations, the fixture needs them. That's a rule now, but a rule by
discipline: nothing in the types, the linter or CI stops someone from
writing the next deletion test with an empty user.

**Second, and worse: a job's final failure made no noise.** That's the
weakest point of the whole system, not just of deletion. Any job dying
after three attempts would have met the same fate. The fix came the next
day (`8be505a`): when a job exhausts its attempts, the worker emits a
single `queue.job.exhausted`. Retries that will still happen stay quiet.
The event name and fields are a stable contract, and the payload goes
through an allowlist (`userId`, `workspaceId`), so a new key in some job's
data never leaks into the logs by default. Since September 22
(`f40974bc`), the event also goes to Slack.

That first alarm had a wrong premise. The commit said a job killed by a
*stall* reached the failed set without the worker emitting `failed`, and
listed that as a gap. BullMQ 5.79 does it differently: the stall check
parks a deferred failure, puts the job back in the queue, and the next
worker fails it with an `UnrecoverableError`. The alarm fired, but labelled
`unrecoverable`, pointing whoever read the log at the wrong problem.
`807fa5e` labels those deaths `stalled`, adds a `QueueEvents` listener per
queue as a backstop and deduplicates, so a death seen by both paths
alarms once. Reading the installed dependency's code was worth more than
the docs or my memory.

What's still open:

- **I don't know how many real requests failed.** With a 7-day
  `removeOnFail`, any job that died before September 13 was already gone
  from Redis when I found the bug, and there was no alarm to have recorded
  the death. The same gap that hid the bug erased the evidence of its size.
  At the time, the only accounts outside the load-test seed were mine: the
  bug kept no one's data but my own. That was luck, not design.
- **End-to-end validation in production is pending.** The migration ran
  in CD and the 30 FKs were checked in the database, but I haven't yet
  scheduled the deletion of a test account with content, let the job run
  and checked the UI. The integration test proves the repository against
  Postgres; it doesn't prove the whole path, with queue, worker and cache.
- **There's a narrow race I didn't close.** If the worker is already
  processing a user's deletion job, a concurrent reschedule is lost:
  `remove()` returns `0` because of the lock and the next `add()` is
  dropped for the repeated `jobId`. The window is one job execution, and
  the outcome is the account being deleted on the old deadline, which the
  person had already accepted. I noted it instead of fixing it.
- **"No author" is a real state, but not a filterable one.** The "created
  by" filter has no "is empty" operator. That's a feature, not a fix, and
  it stayed out.

## What this proves, and what it doesn't

It proves a user with content can now be deleted: the 30 foreign keys to
`users` are cascade or `SET NULL` in the database, no cascaded table gets
stuck one level down, and there's a test that fails with the original
error if anyone brings the constraint back. It proves anonymizing isn't
just a migration: 43 files, mostly types and UI, and that cost is what
forces each screen to handle "no author" instead of crashing.

It doesn't prove deletion works end to end in production; that check
hasn't been done yet. It doesn't prove no other Nexo job fails silently:
only that, since September 22, when one dies for good, someone hears
about it. And it can't say how many people asked to leave between May and
September and stayed in the database, because the system that should
have kept that answer was configured to forget it within a week.
