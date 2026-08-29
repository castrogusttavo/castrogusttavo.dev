---
title: A real queue — what I moved out of the request and into a background job
description: "The job that reverts an expired trial runs every hour, not once a day like the rest of the cleanup work — meaning a workspace can keep its paid plan for up to an hour after the trial ends, on purpose. That cadence sums up how Nexo decides what leaves the request cycle and becomes an async job through BullMQ: typed queues, a worker that runs as its own Node process outside Next, and idempotency designed per job, not generically."
icon: terminal
date: "2026-08-29"
---

In Nexo, the job that reverts an expired trial runs **every hour**
(`0 * * * *`, UTC). The rest of the data-cleanup work — expired sessions,
stale invitations, old email verifications — runs **once a day**
(`0 3 * * *`). That's not inconsistency: it's a business decision baked
into a cron expression. A trial that expires at 2:05 PM only gets reverted
at 3:00 PM — until then, the workspace keeps its paid `activePlan` with no
active subscription behind it. Up to an hour of free paid-tier access, on
every trial, on purpose, because a tighter cadence costs more and an extra
hour of exposure is an acceptable trade.

That's the question any background-job system forces you to answer: how
often does this actually matter? The answer isn't the same for everything,
and Nexo treats it as an explicit per-queue decision, not one generic cron
for everything.

## The problem: async in the wrong process survives nothing

The simplest way to "do this later" is a `setTimeout` inside the Next
process itself, or firing off work without waiting on the response. That
works until the process restarts — a deploy, a crash, a container
restart — and the scheduled work just disappears, no log, no retry, no one
aware it was even supposed to happen. It's worse for recurring tasks: with
multiple app instances running (any horizontal deploy), each instance would
fire its own internal cron, duplicating the work.

## The idea: typed commands on a queue, consumed by a dedicated process

Each job is a command — name plus payload — defined in types before it ever
exists at runtime:

```ts
// src/lib/queue/jobs.ts
export const QueueName = {
  DataRetention: 'data-retention',
  AccountLifecycle: 'account-lifecycle',
  DataExport: 'data-export',
  TrialLifecycle: 'trial-lifecycle',
} as const

export const AccountLifecycleJob = { DeleteAccount: 'delete-account' } as const
export type AccountLifecycleJobPayload = {
  [AccountLifecycleJob.DeleteAccount]: { userId: string }
}
```

`Queue`/`Worker` are typed against these payloads — `queue.add(name, data)`
validates `data` at compile time, there's no loose string deciding what a
job receives.

## How it works: four queues, one worker living outside Next

`queues.ts` exposes a lazy getter per queue, with shared default options:

```ts
const defaultJobOptions = {
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 }, // 24h or 1000 jobs
  removeOnFail: { age: 60 * 60 * 24 * 7 },               // 7 days
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },         // 5s, 10s, 20s
} as const
```

Scheduling account deletion uses a deterministic `jobId`:

```ts
// delete-account-<userId>, no ':' — BullMQ uses ':' as its Redis key
// separator, so the hyphen is a requirement, not a style choice
queue.add(AccountLifecycleJob.DeleteAccount, { userId }, {
  delay: Math.max(0, scheduledAt.getTime() - Date.now()),
  jobId: `delete-account-${userId}`,
})
```

That gets cancellation for free: `cancelAccountDeletion(userId)` calls
`queue.remove(jobId)` — if the job no longer exists (already ran, or never
existed), the remove is a no-op and the function returns `false` instead of
throwing. Canceling a deletion nobody scheduled isn't an error, it's
idempotent by construction.

The consumer doesn't run inside Next. It's its own Node process
(`worker/index.ts`) that imports services and repositories directly — the
same modules the HTTP route uses. Since those modules import
`'server-only'`, and that doesn't exist outside the Next runtime, the
worker's build step aliases it to an empty shim:

```jsonc
"worker:build": "esbuild worker/index.ts --bundle --platform=node --target=node20 \
                  --alias:server-only=./worker/server-only.shim.ts \
                  --outfile=dist/worker.cjs \
                  --external:argon2 --external:@prisma/client --external:.prisma/client"
```

`server-only.shim.ts` is literally `export {}`. `argon2` (a native binary)
and the Prisma client stay `--external` because they can't be bundled.
There's an entire separate build pipeline whose only job is reusing Nexo's
service layer in a process Next never sees.

Each processor does a `switch (job.name)` and throws on an unknown one —
which BullMQ treats as a normal failure and applies backoff to:

```ts
export async function processDataRetention(job: Job): Promise<CleanupResult> {
  switch (job.name) {
    case DataRetentionJob.CleanupExpiredSessions: { /* ... */ }
    case DataRetentionJob.ExpireStaleInvitations: { /* ... */ }
    // ...
    default:
      throw new Error(`Unknown data-retention job: ${job.name}`)
  }
}
```

## Results: four queues, idempotency designed per job, not generic

| Queue | Cadence | Idempotency |
| --- | --- | --- |
| `data-retention` | daily, `0 3 * * *` | naturally idempotent — delete/update by cutoff, re-running against the same cutoff doesn't touch already-processed rows |
| `account-lifecycle` | on demand, delayed | `delete-account` re-validates state before acting — a missing user or an already-canceled deletion becomes `skipped`, not an error |
| `data-export` | on demand | `key = <userId>/<jobId>.json` — re-running the same job overwrites the same object, never duplicates |
| `trial-lifecycle` | hourly, `0 * * * *` | idempotent for the same reason as data-retention — the `where` clause already excludes anyone no longer eligible |

`upsertJobScheduler` — used by both recurring schedulers — is idempotent on
its own: running it on every worker boot never duplicates the schedule, so
restarting the worker frequently never multiplies repeated jobs.

## Where it broke: what's left without a safety net

Three real gaps, not hypothetical ones:

- **The trial's one-hour window is a choice, not a bug — but it's still a
  window.** A workspace can keep a paid plan for up to 60 minutes without
  paying for it. That's accepted because tightening the cadence costs more
  (more jobs, more load) than the risk of an hour of unpaid access — but
  it's an explicit trade-off, not a precision guarantee.
- **There's no Bull Board in production.** No `@bull-board` dependency, no
  service, no UI — inspecting a queue's state today means reading Axiom
  logs or querying Redis directly. It's marked as a roadmap item, not a
  final decision.
- **A job with an unknown name burns the entire retry budget.** The
  processor throws in its `default` case, and BullMQ treats that like any
  other failure — three attempts with exponential backoff (5s, 10s, 20s)
  before it lands in `removeOnFail`. A bad job name is never going to
  succeed on a second try, but the system doesn't know that and pays the
  full retry cost anyway.

## What this proves, and what it doesn't

It proves async work survives a restart, gets retries with backoff for
free, and doesn't duplicate on recurring jobs even when the worker restarts
every hour. It proves idempotency doesn't need to be generic to be real —
each job carries its own strategy, designed around what it actually does.
It doesn't prove the operation is observable enough in production — with no
queue dashboard, diagnosis depends on logs. It doesn't prove timing
precision on time-sensitive reversals — trial-lifecycle accepts up to an
hour of lag because that's the trade-off that was chosen, not because the
system guarantees anything tighter.
