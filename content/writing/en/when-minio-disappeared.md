---
title: The day MinIO disappeared — swapping production object storage without a shell session
description: "One September morning Nexo's CI went red with no commit of mine behind it: MinIO had withdrawn its entire public distribution — quay.io at 401, Docker Hub denying access, dl.min.io at 410, the repository archived. This is the swap to Silo, an AGPL fork: validating every S3 call the app makes and the on-disk format before adopting it, migrating production through a dispatchable workflow with a backup and a sha256, an automatic rollback that fired for the wrong reason, and finding out that the production compose and the repository's were two different files with the same name."
icon: terminal
date: "2026-11-24"
---

On September 24 at 10:20 (UTC−3), Nexo's e2e job failed with a line that
had nothing to do with the commit under test:

```
docker: error from registry: access to the requested resource is not authorized
```

The commit touched the status page. The step that broke was `Start
MinIO`, which brings up object storage for the e2e suite — the same step,
with the same pinned tag, that had been green the day before. Nobody had
touched `ci.yml`. What changed was the world outside it.

## The problem: a pin doesn't protect you from the registry vanishing

Four days earlier, in the [Nexo architecture post](/en/writing/nexo-architecture),
I'd written that MinIO now came from `quay.io` because MinIO had stopped
publishing to Docker Hub. That morning `quay.io` closed too. I checked
every distribution channel before concluding anything:

```
quay.io/minio/minio (any tag, including RELEASE.2025-09-07) → 401
quay API for the repository                                 → "Requires authentication"
docker.io/minio/minio, minio/mc                             → access denied
dl.min.io (server binary)                                   → 410 Gone
github.com/minio/minio                                      → AGPL, archived in April
```

Not a rate limit, not flakiness: no public tag worked anymore, and there
was no mirror. What MinIO still publishes is `quay.io/minio/aistor`, the
commercial line. I tried the free tier: the image pulls anonymously, the
container starts, formats the pool — and then **denies every S3
operation** with `No license is installed`. The free license exists, but
it's a file I'd have to keep in three places (CI, dev, production), and
its absence doesn't degrade anything: it takes everything down.

What I can still prove from the outside today, without my own logs: the
`minio/minio` GitHub repository is archived (last push 2026-04-24), and on
2026-10-17 `dl.min.io` still answers 410 for the server binary and
`quay.io` hands out an anonymous token with an empty action list for
`minio/minio` — a 401 on the manifest. I don't know the reasons or exact
dates of each withdrawal beyond what I saw that morning, and I won't
speculate.

CI was the cheap symptom. The expensive problem was production: the server
ran `minio/minio:RELEASE.2025-02-28` out of the local Docker cache. It
worked. But it was an image **nobody in the world could pull again** — lose
the cache, swap the disk, run one `docker image prune`, and storage
wouldn't come back. A pin protects you from upstream changing what a tag
points to. It doesn't protect you from upstream ceasing to exist.

## The idea: validate before adopting, and operate production with a log

I went with [pgsty/silo](https://github.com/pgsty/silo), an AGPL fork of
MinIO's last open-source server, maintained by the Pigsty folks, who run
it as their own PostgreSQL backup repository. But "it's a fork, it should
be compatible" is exactly the kind of sentence that becomes an incident.
So the rule was: nothing changes before two proofs.

The second decision was about *how* to touch production. I don't have
key-based SSH set up for this, and the self-hosted GitHub Actions runner
lives on the production machine. That makes a dispatchable workflow a
better ops tool than a terminal: every step leaves a log I (or anyone with
repo access) can reread, instead of a shell session nobody reviews.

## How it worked

### Two proofs before swapping the image

**Every operation the application performs**, run through the app's own
`src/lib/storage/s3.ts` against Silo: `ListBuckets` (the status probe),
`CreateBucket`, `HeadBucket`, `PutObject`, `GetObject`, and a presigned
`PUT` — the path browser uploads take straight to storage.

**Data compatibility**: I wrote a bucket, an object, and a public bucket
policy with the old MinIO image, stopped the container, and started Silo
**on the same directory**. Everything survived: same on-disk format, same
command, same `MINIO_*` variables, same `/minio/health/live`, same bundled
`mc` the compose healthcheck calls. That's what turns the production
migration into a container swap rather than a data copy.

Both proofs were run on my machine and are recorded in the message of the
commit that swapped CI's image (`93b55b4c`), not as a test suite in the
repo. The CI change itself is one line:

```diff
-            quay.io/minio/minio:RELEASE.2025-02-28T09-55-16Z server /data
+            docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z server /data
```

Pinned to a release tag, never `latest`.

### The workflow: `inspect`, `migrate`, `rollback`, `purge`

`storage-migrate.yml` had four modes:

- `inspect` — read-only. Prints the container, image, mounts, ports, the
  **names** of the env vars (the values are storage root credentials, and
  an Actions log isn't private), data size and free space.
- `migrate` — stops the container, tars the data directory with a
  `sha256sum` next to it (refusing to continue if the disk can't hold the
  archive), rewrites the image in the compose file that owns the service,
  brings it back up and verifies. If verification fails, it undoes itself.
- `rollback` — puts the previous image back, as long as it's still on disk.
- `purge` — deletes leftover MinIO images, refusing to touch any that a
  container still references: nobody can pull those back.

Deleting the old image is opt-in and runs last, because it's the only step
with no way back.

### `inspect` refused to run — the first useful thing all day

The first run failed in under a second:

```
##[error]No container named nexo-minio on this machine.
nexo-mq-1    | rabbitmq:4-alpine
nexo-db-1    | postgres:17-alpine
nexo-minio-1 | minio/minio:RELEASE.2025-02-28T09-55-16Z
...
```

The repository's compose calls the container `nexo-minio`. The server
called it `nexo-minio-1`, and listed a RabbitMQ that exists nowhere in the
repository. The container's compose label showed where it came from: an
infra compose file that lived only on the server, because the CD copies
the application's `docker-compose.yml` and **never copied the infra
one**. They had drifted apart unseen. I parked that and reran with the
right name.

### The first migration rolled itself back, for the wrong reason

The first `migrate` did everything right up to the end: a 1.7 MB backup
with a sha256, Silo pulled, compose rewritten, container up, health
answering on the host. Then came the check I'd added moments earlier —
hit `https://storage.nexopm.com`, because a container answering on
`localhost` while nginx doesn't serve the public vhost is still an outage
for every customer opening an attachment:

```
==> health endpoint answers on the host
==> https://storage.nexopm.com/minio/health/live -> 000000
##[error]The public endpoint does not answer 200 — rolling back.
```

`000` is `curl` saying it never connected. The server can't reach its own
public IP: the router doesn't do NAT hairpinning. From outside, the same
URL answered 200 the whole time. Silo was fine; the check depended on a
network path the machine doesn't have to itself.

The embarrassing part is that I already knew. The same problem is
documented in the application's compose — it's why containers resolve
`nexopm.com` to the LAN address through `extra_hosts`, and I mentioned it
in the architecture post. I wrote the new check without remembering it.

The fix points the hostname at loopback without giving up what the check
proves:

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' \
  --resolve storage.nexopm.com:443:127.0.0.1 \
  https://storage.nexopm.com/minio/health/live) || code='000'
```

`--resolve` sends the request to `127.0.0.1` while keeping the `Host`
header and TLS SNI, so nginx still picks the storage vhost and terminates
the same certificate. The check exercises the customer's chain — nginx,
TLS, container — without the route that doesn't exist.

### The second attempt

```
archive:  minio-pre-silo-20260924T151033Z.tar.gz (1,7M) + sha256
==> health endpoint answers on the host
==> nginx vhost storage.nexopm.com -> 200
==> buckets visible to the new server:
    [2026-09-20 02:37:26 UTC]     0B avatars/
```

Then a `purge` that found one more forgotten image — a `minio/minio:latest`
from some old deploy — and deleted it. The server was left with
`pgsty/silo:RELEASE.2026-09-16` and no MinIO image at all.

### The backup didn't notice, and why matters

The nightly backup (the one from the architecture post) doesn't go through
the storage container: it archives the data directory straight from the
host. Swapping the S3 server that reads and writes that directory is
invisible to it. A manual run right after the migration shipped the
storage archive to B2 at 1,782,856 bytes — 2,713 more than that morning's,
so live data being read, not a fixed-size file. The script also validates
before uploading (the dump must list its own index with `pg_restore -l`,
the tar must pass `tar -tzf`) and deletes the local file on failure
instead of leaving false confidence in the bucket. Those numbers come from
the run's log on the server; the script isn't versioned, so you can't
check them in the repo.

The run also made me look at a risk that has nothing to do with MinIO: the
key to rclone's encrypted remote. Without it, no remote backup can be
restored by anyone — me included — and a backup whose key dies with the
server doesn't protect against the server dying, which is the only
scenario where it matters. The key doesn't live only on the server: both
variables, `B2_CRYPT_PASS` and `B2_CRYPT_SALT`, are also stored in two
Bitwarden accounts. And I tested the path that counts: a restore from
another machine, using that copy, worked.

## Results

| | Before | After |
| --- | --- | --- |
| Production storage image | `minio/minio:RELEASE.2025-02-28` (unpullable) | `pgsty/silo:RELEASE.2026-09-16` (pinned, public) |
| CI | red since the morning | green from `34da4ab1`, same day |
| Workflow runs | — | 5: failed `inspect`, `inspect`, rolled-back `migrate`, `migrate`, `purge` |
| Successful `migrate` duration | — | 18 s, from backup start to old-image removal |
| MinIO images on the server | 2 | 0 |

All five runs are in the repository's Actions tab, 15:04 to 15:12 UTC —
eight minutes from the first refusal to the final cleanup, with three
commits to the workflow itself in between.

Two days later `storage-migrate.yml` was deleted (`697da691`): `migrate`
and `rollback` depended on an image that no longer exists anywhere, so
what remained was 266 lines that, dispatched by accident, would stop
production storage to swap it for something unpullable. The part worth
keeping, inspection, had already moved into the server-ops workflow.

## Two files with the same name

That left `inspect`'s finding: the server's compose and the repository's
didn't match. The natural ask was "align them." It turned out they weren't
one file with drift — they were **two different files with the same
name**. The repository's was the *development* stack, with a read replica
and PgBouncer. The server's was *production*, with RabbitMQ and no
replica.

Copying one over the other would have been the perfect silent failure:
the `nexo-db-1` container would become `nexo-db`, and the nightly backup
runs `docker exec nexo-db-1 pg_dump`. It would have broken that night and
only said so on the day of a restore.

The resolution took four days and a string of small commits:

- `c41a5887` (Sep 24) — the production compose got versioned, exported
  from the server, minus RabbitMQ: nothing in the code speaks AMQP — no
  dependency, no variable; queues are BullMQ on Redis. Container names
  kept exactly as they were, because of the backup. The CD copies the file
  but doesn't apply it: recreating Postgres or Redis isn't a call an app
  deploy should make on its own.
- `cde20c99` (Sep 24) — the server-vs-repo comparison now targets the
  production file. It used to point at the dev one and report 125 lines of
  difference that were supposed to be there.
- `eb04cf11` (Sep 26) — read replica and PgBouncer brought to production,
  with the primary left byte-identical so the database wouldn't restart.
- `4ce4d075` (Sep 28) — the application started talking to the database
  through PgBouncer. Measured first: Postgres allows 100 connections and
  11 were in use.

Which forces a correction. In the [architecture post](/en/writing/nexo-architecture),
published four days before the migration, I wrote that production Postgres
had had PgBouncer and a replica "for a few weeks," and that Redis was
pinned by digest. I was describing the repository's compose — the
development one. In production, replica and pooler only arrived on
September 26, the app only went through the pooler on the 28th, and the
versioned production compose still runs `bitnami/redis:latest`. That post
carefully separated what runs from what's a target — and got the line
wrong exactly where two files met that I didn't know were two.

## Where it broke

**The rollback fired for the wrong reason, and its message lied about it.**
The workflow did the right thing — when in doubt, go back — on the wrong
diagnosis. Worse: the log says `000000`, not `000`, because `curl` already
prints `000` on failure and the `|| echo 000` appended another; and the
final error line said "Silo did not answer in 60s," which was false —
Silo answered, the route to the public IP didn't. The root cause isn't
`curl`: I wrote a check without testing it where it would run, against a
network problem already documented in the repository. The automatic
rollback saved me from a bug I'd introduced minutes earlier.

**Resolving the compose took production down for about 90 seconds.** It's
the ugliest number in this post, and it didn't happen during the storage
migration — it happened afterwards. The server-ops `infra-apply` mode ran
`docker compose -f docker-compose.infra.yml up -d --remove-orphans` in the
application directory. Both compose files there share one project name —
`nexo`, from the directory — so to the infra file the app, the worker and
the realtime server were all "orphans." It removed them along with the
RabbitMQ it was meant to remove, and `nexopm.com` answered 502 until a new
`app-up` mode brought them back (`24816cee`). The warning was there to
read: an earlier run in the same session had printed `Found orphan
containers ([nexo-worker nextjs-app nexo-realtime])`, and the flag went in
anyway. The fix (`5a9aa8d9`) drops the flag and lists orphans without
deleting them: deciding something is garbage is a human call, and
automating that call is exactly what broke.

**"Production never blinked" is what the checks saw, not proof.**
`nexopm.com` and `storage.nexopm.com` answered 200 on every check I ran
during the migration, and the 24th shows 100% on the status page. But the
storage container was stopped or recreated three times (twice in the
rolled-back attempt, once in the good one), and in the good one it was
down from the backup step until health came back — about 12 seconds by
the step timestamps. A once-a-minute probe can't see a window like that,
and an upload landing in it would have failed. I can't claim none did.

**I swapped one upstream for another.** Silo fixes today's problem with
the same kind of dependency that caused yesterday's: a public image,
published by a third party, pinned by tag. If Pigsty pulls its
distribution tomorrow, CI breaks the same way. I didn't mirror the image
into a registry of my own or pin it by digest, and the old MinIO image is
deleted, so there's no rollback to it anymore. That was a choice — a
private registry is one more service to run alone — but it's an accepted
risk, not a solved one.

## What this proves, and what it doesn't

It proves you can swap production object storage on a self-hosted project
without a shell session: a workflow with a read-only mode that refuses
what it doesn't recognize, a hashed backup before any change, automatic
rollback and an opt-in cleanup left five readable runs instead of a
terminal history. It also proves that the up-front validation — every S3
call the app makes, plus the on-disk format — is what makes this a
container swap rather than a data migration.

It doesn't prove zero downtime: there were second-long windows no monitor
of mine has the resolution to see. It doesn't prove Silo is a durable
choice — it's a fork of an archived project, and I depend on it the same
way I depended on the original. And the most important part of the day
wasn't storage: it was finding out that the file describing production
wasn't in the repository, and that I'd published an architecture post on
top of the wrong file.
