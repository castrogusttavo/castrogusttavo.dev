---
title: E-mail wasn't going down — four measurement defects on a status page
description: "Nexo's public status page showed e-mail at 51.7% uptime on a day Resend correctly answered every request. It wasn't Resend: four stacked measurement defects — one 1.5 s bar for everything, an uptime that counted slowness as downtime, a single sample deciding the day, and probes fighting CI for the same machine — plus an app probe that returned a hard-coded OPERATIONAL. This is the fix, the result (51.7% → 99.7%), and why changing the ruler is exactly what makes a number look better."
icon: bug
date: "2026-11-19"
---

Nexo's public status page showed this for e-mail, one day per column,
September 19 to 22:

```
email    83.3   71.5   57.0   51.7
```

To a customer, that says half of the invite e-mails, verification codes
and password resets failed on Tuesday. On those same days Resend correctly
answered every request Nexo made. A customer looking at that page would
see a product that can barely send e-mail — and would be wrong, because
the page was.

The temptation at that point is to tune the threshold until the number
looks good. That's partly what this post does, which is why its most
important section is the one on limitations.

## The problem: four stacked defects

None of them alone explained 51.7%. Together, they did.

**1. One 1.5 s bar for everything.** The same latency threshold applied to
a `SELECT 1` against Postgres on the same machine and to an HTTPS call to
`api.resend.com` in the US. Different physics: from São Paulo the round
trip alone is ~120 ms, and every probe pays a fresh TCP + TLS handshake,
because a once-a-minute call never finds a warm connection.

**2. "Uptime" counted DEGRADED as down.** The line that summed
availability was:

```ts
if (row.status === 'OPERATIONAL') acc.up += 1
```

A correct-but-slow answer became downtime. What the page called uptime
was really a latency SLO under another name.

**3. One sample decided.** A single minute over the bar marked the
component DEGRADED, and the daily rollup takes the day's worst sample
(`worstStatus`). One blip painted the whole day yellow.

**4. The probes run on the same machine as CI and backups.** The status
collector, the self-hosted CI runner and the 03:15 backup share a server.
Every heavy build added hundreds of milliseconds to healthy queries.
Storage "oscillating for no reason" was largely Nexo busy with itself.

And beneath all four, two probes measured the wrong thing. The app probe
was:

```ts
export async function probeApp(): Promise<ProbeResult> {
  return { status: 'OPERATIONAL', latencyMs: 0, error: null }
}
```

The one component that could never be seen to fail was the one serving
the status page. That's why the "Application" row shows 100% every day
since July: not a measurement, a constant.

The storage probe hit `/minio/health/live`, which answers 200 to anyone,
no credentials. It said the process was alive, not that Nexo could use
it. I'd learned that difference the expensive way three days earlier: the
production AbacatePay key had gone invalid, every checkout answered 502,
and the status page stayed green, because the payment probe only treated
5xx as failure — a 401 read as "the gateway answered, so it's up"
(`ec8273ac`, "treat a rejected payment credential as the outage it is").
From the customer's side, a gateway I can't use and a gateway that's down
are the same outage.

## The idea: uptime means "answered," latency is a separate signal

Split the two questions that had been folded into one number:

- **Did the component answer?** That's availability, and it's what uptime
  should count.
- **Did it answer fast enough *for itself*?** That's degradation, judged
  against each component's own physics, and it has to persist to count.

And in the probes, ask "can I use it?" instead of "is the process alive?"

## How it works

### One budget per component

| Component | Slow above | Timeout | Why |
| --- | --- | --- | --- |
| `database`, `cache` | 1,000 ms | 5 s | `SELECT 1` and `PING` answer in single-digit ms on a warm pool |
| `auth`, `storage` | 1,500 ms | 5 s | Argon2 plus a query; local S3 |
| `jobs` | 2,000 ms | 8 s | four Redis round trips per queue |
| `app` | 2,500 ms | 5 s | full HTTP through nginx and TLS |
| `payment`, `email` | 3,000 ms | 8 s | cross-border HTTPS with a cold handshake every sample |

The local budgets are generous on purpose: with CI on the same box,
anything tighter measures my deploys, not the database.

### Uptime counts who answered

```ts
function answered(status: ComponentStatus): boolean {
  return status !== 'MAJOR_OUTAGE' && status !== 'PARTIAL_OUTAGE'
}
// ...
if (answered(row.status)) acc.up += 1
```

Slowness doesn't disappear: it's still visible as the day's worst status
(the yellow bar) and in average latency. It just stops counting as
absence.

### Degradation only after three slow samples in a row

One slow sample records OPERATIONAL. Only the third in a row records
DEGRADED. With the collector running every minute, a genuinely
struggling component shows up within three minutes, and a build, a backup
or one unlucky packet don't paint the day.

The detail that nearly went wrong: the streak is read from recorded
**latencies**, not recorded **statuses**. Statuses are already smoothed —
the first two slow samples were stored as OPERATIONAL — so comparing
against them would reset the streak forever, and a permanently slow
component would never degrade.

The smoothing applies only to latency-derived degradation. A failure is
recorded as it came, on the first sample: an outage is an outage.

### One retry before declaring an outage

A failure is retried once, 250 ms later, before it becomes MAJOR_OUTAGE.
A reset socket or a dropped packet isn't a service being down, and a page
that declares an outage over one packet teaches everyone to ignore it. The
error reported is the first attempt's, which is usually the diagnostic
one.

### Probes that ask "can I use it?"

The app probe now makes a real HTTP request to the public URL's
`/api/health`, covering DNS, nginx, TLS and the proxy. Storage swapped the
health endpoint for an authenticated `ListBuckets` with the app's
credentials. E-mail got the payment probe's rule: a 401 or 403 from Resend
is an e-mail delivery outage, even with Resend perfectly healthy.

All of that is one commit, `c4f48b0d`, "measure each component against
its own reality": 659 lines added, most of them tests.

### What came with it

**A component that answers with a sentence.** The next day brought a
background-processing component (`f5718cc1`). The worker is a separate
process from Next, and the failure nobody notices is it dying: the app
keeps serving pages while account deletions and data exports quietly stop.
The probe asks Redis how many workers are attached to each of the four
queues and how many jobs are waiting. A queue with no consumer is an
outage; more than 25 waiting is a degradation. That needed a new shape: a
probe can now answer with a sentence explaining why it's degraded despite
answering quickly — `N jobs aguardando na fila "<name>"` says more than a
latency number that would mean nothing there.

**Alerts only on transitions.** The day before the ruler fix, the page had
gained Slack alerts (`f40974bc`). The collector runs every minute, so
messages go out only when state changes. A flapping component gets at most
five messages per episode: three announcements in 30 minutes, one
"unstable" and then silence until it holds a state for 15 minutes, and one
"settled" saying where it landed. Without that cap, the old ruler would
have posted on every e-mail blip — and I'd have muted the channel within a
week.

**The collector's N+1.** Sentry flagged an N+1 on `POST
/api/status/collect/core` on its first day: the collector read one
component's checks and wrote one rollup at a time, 2N round trips per
tier. Two queries per tier fixed it (`aggregateForDayByKeys` and
`upsertDailies`, in `c028f79f`); measured against a disposable Postgres
with `log_statement=all`, one collection of both tiers now issues **two**
`INSERT INTO component_dailies` instead of seven. And a component with no
checks in the window is absent from the map, not zeroed: a gap in the
history isn't a day at 0%.

**The number nobody read.** Three days earlier, mutation testing had found
that the page's 90-day uptime could be replaced with an empty function
without a single test going red (`fb8a2f42`). The ruler was wrong, and
nothing checked the number it produced either. That's another post.

**A line that was a lie.** Reviewing the status page turned up a storage
component named "Storage (AWS S3)" and a sub-processors page saying files
lived at Amazon. Nexo never used S3: `src/lib/storage/s3.ts` talks to
storage on Nexo's own server. Both lines went (`98df9245`, `f2765330`), and
the sub-processors page gained the three third parties that do receive
data and weren't listed — Slack, Backblaze B2 and Better Stack — plus the
sentence it was missing: the app, the database and the files live on Nexo's
own server in São Paulo, and only backups leave the country. A page whose
entire job is telling the truth about my infrastructure can't name a
vendor I don't use.

## Results

The fix reached production on the morning of September 23. From the
status page's public API (`/api/status`, queried 2026-10-17):

| Day | E-mail | Payment | Storage |
| --- | --- | --- | --- |
| Sep 19 | 83.3% | 100% | 100% |
| Sep 20 | 71.5% | 97.2% | 99.7% |
| Sep 21 | 57.0% | 99.7% | 100% |
| Sep 22 | **51.7%** | 96.9% | 99.3% |
| Sep 23 (deploy) | 96.9% | 100% | 100% |
| Sep 24 | **99.7%** | 99.7% | 100% |
| Sep 25 | 100% | 100% | 100% |

Unrounded, the 22nd closed at 51.736% and the 24th at 99.653%.

Across the 52 recorded days before the fix (July 21 to September 22, with
a September 7–18 gap with no data), e-mail averaged **87.3%** per day.
Across the first seven full days on the new ruler (September 24–30),
**99.9%**.

The 23rd is mixed: the current day's rollup is recomputed on every
collection, so after the deploy it was rebuilt with the new rule over the
whole morning's samples. The missing 3.1% are samples recorded as
failures, not as slowness. A partial reading of the 23rd, taken before the
day closed, showed 50.6%; the day closed at 96.9%.

## Where it broke

**99.7% is the number after changing the ruler. Changing the ruler is
exactly what makes a number look better.** No way around that, so here's
what changed and why I still think it's honest. The number now counts: the
probe got an answer, within two attempts, inside the timeout. Slowness
still shows — as a yellow bar on the day and as average latency — but it
no longer subtracts availability. What I lost is a signal the old ruler
gave, badly: a component answering correctly and slowly all day can now
show 100% and a yellow bar. If the customer's question is "does e-mail
arrive fast?", 99.7% doesn't answer it; it answers "is e-mail delivered?"
It's a narrower definition, and I chose it because it's the one the word
uptime promises.

Two guardrails against fooling myself. Old days were **not recomputed**:
September 19–22 still show 83.3%, 71.5%, 57.0% and 51.7% on the page,
measured with the ruler they were measured with. That's why e-mail's
90-day uptime today is **91.3%**, not 99%, and it'll keep carrying the old
ruler's days until they leave the window in December. And the retry is a
single one, 250 ms apart: a service failing twice in a row is still an
outage on the first sample.

**I don't know why e-mail was getting worse over time.** The old series
isn't stable: July days sat between 94% and 99.7%, August between 75% and
99%, September between 51% and 83%. A fixed threshold doesn't explain a
trend on its own. My hypothesis is that CI load on the same machine grew
over that period — September is when four new test layers landed — but I
didn't measure it, and I won't present a correlation I never computed as a
cause.

**The probes still live on the machine they measure.** Generous budgets
and three-in-a-row are compensation, not a fix. The collector, CI and the
backup still share a CPU, and a probe inside the server it watches doesn't
see what customers see from outside. That includes the network: the
server can't reach its own public IP (no NAT hairpin), so the app probe
reaches the public URL through an internal network shortcut, not the path
a customer takes. And it's one region: there's no probe outside São Paulo.

**In October, the same lesson again.** From October 1 to 18 the page
showed Application and Storage in **full outage** — 0% per day, 16 whole
days — while `nexopm.com` and `storage.nexopm.com` answered 200 from
outside. On the 1st the host rebooted and came back with a different LAN
IP: I changed it myself, because of problems with the old parent server.
`infra/app.yml` pinned the public hostnames to the old LAN IP — that was
the internal shortcut from the previous paragraph — and the log showed
`connect EHOSTUNREACH …:443`. It wasn't only the probe. Every server-side
call to storage failed in that window: data export, the CV purge, any S3
operation made by the server. Browser uploads through presigned URLs were
probably unaffected, since they go straight from the client to storage,
but I didn't verify that.

So the page was half right: the app was up for anyone coming from outside,
and storage really was unreachable for the app itself. What failed was the
thing that should have made me look. A single Slack alert went out, at the
start; since alerts only fire on transitions, 17 days stuck in one state
produced nothing more. It's this post's lesson again: the probe measured
its own path, not the customer's, and the alert meant to make up for that
spoke once and went quiet. I fixed both: containers
now reach nginx through `host-gateway`, which follows the host wherever its
LAN IP goes ([`596ddc4`](https://github.com/castrogusttavo/nexo/commit/596ddc4b)), and while a component stays down
Slack gets a reminder every 6 h ([`719a766`](https://github.com/castrogusttavo/nexo/commit/719a766c)). Application and
Storage came back at 18:48 UTC on October 18.

## What this proves, and what it doesn't

It proves a bad uptime number can be entirely a measurement defect: same
Resend, same requests, and the page went from 51.7% to 99.7% with nothing
changing on the service's side. It proves "the process is alive" and "I
can use it" are different questions — and that a probe asking only the
first lets through exactly the failures customers feel, like AbacatePay's
rejected credential.

It doesn't prove Nexo's e-mail has 99.7% availability in the sense a
customer means: it proves that, measured from inside its own server with
"answered" as the definition, it did. It doesn't prove the new ruler is
right — in October the page spent 17 days showing the app as down while it
answered normally from outside, with a single alert on the first day. An honest status page isn't the one showing the high number;
it's the one measuring from where the customer stands. Nexo's doesn't yet.
