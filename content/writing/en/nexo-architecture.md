---
title: Nexo's architecture in three diagrams — what runs, what's a target, and what survives if the server disappears
description: "In eight and a half months Nexo piled up 1,255 commits, 943 of them co-signed by an agent, and an architecture that no longer fits in a paragraph. This post is the map in three diagrams: what actually runs in production (nginx, three containers off the same image, Postgres with PgBouncer and a replica, TLS-only Redis, MinIO) and what is still only a target in the drawing; the backup that pg_dumps and mirrors MinIO every day at 03:15 and ships it encrypted to Backblaze B2; the four test layers that landed in three weeks — contract, browser, visual and mutation; and the CI migration to Avrea runners, opened by a bot and fixed by me."
icon: code
date: "2026-09-20"
---

Nexo has 1,255 commits. **943 of them** — 75% — carry a
`Co-Authored-By: Claude` trailer in the message. The first is from February
8th; the most recent is from today. Over those eight and a half months the
architecture went from "a Next.js talking to a Postgres" to three
containers, a pooler, a read replica, eight test layers and a pipeline with
thirteen jobs.

This post is the map. Three diagrams — global architecture, data and
backup, CI/CD — and, in each of them, the same discipline: separate what
runs in production today from what is still just a drawing. The repository
is public, so every claim here is checkable, and the ones I can't prove are
marked as such.

## The global diagram, and what `grep` confirms of it

![Nexo's global architecture: users arrive through nginx, which splits between Next.js and Node; below them, Gateway and Pilot; on the right, object store, LangChain with OpenAI, PostgreSQL, Redis, Integrations (Slack, GitHub and more) and SDK; all inside a Docker box](/img/nexo-architecture/blog_diagram-global.png)

That is the full drawing — the target. What is in production today is a
subset of it, and it's worth saying which is which before anything else:

**Exists and runs:** nginx up front, the Next.js app, the Node process
(worker), PostgreSQL, Redis, the object store (MinIO) and the Docker box
around all of it.

**Does not exist in the code yet:** `Gateway`, `Pilot`, `SDK`, the
LangChain → OpenAI pair and the `Integrations` box with Slack and GitHub. A
`grep` over the repository finds none of them — no file, no dependency, no
route. They are the shape the platform should have, not the one it has.

That distinction isn't a footnote. An architecture diagram is the document
that most easily turns into fiction: it's drawn at the start, it's
aspirational by nature, and nobody goes back to erase the box that never
got implemented. Keeping the legend honest is cheaper than keeping the
drawing current.

## One image, three processes

What the diagram summarizes as "Next.js" and "node" is, in the production
`docker-compose.yml`, three services that pull **the same image** and
differ only in the command:

```yaml
nexo-app:
  image: ghcr.io/castrogusttavo/nexo:latest
  ports: ["3000:3000"]

nexo-worker:
  image: ghcr.io/castrogusttavo/nexo:latest
  command: ["node", "dist/worker.cjs"]

nexo-realtime:
  image: ghcr.io/castrogusttavo/nexo:latest
  command: ["node", "dist/realtime.cjs"]
  # Loopback only: the public entry point is nginx's /realtime location.
  ports: ["127.0.0.1:1234:1234"]
```

One image, three `command`s. The build produces three artifacts — Next's
`standalone` output, a `worker.cjs` and a `realtime.cjs`, both bundled with
esbuild — and each container runs its own. The gain is that no version
drift can exist between app and worker: both come up from the same SHA,
always, because it is literally the same `:latest` pulled three times.

The worker is a Node process separate from Next on purpose — a
`setTimeout` inside the app process does not survive a deploy, which is
what the BullMQ post takes apart in detail. It runs account lifecycle, data
export, retention and the trial lifecycle. `realtime` is a Hocuspocus
server for collaborative editing, bound to loopback only: anyone coming
from outside goes through nginx's `/realtime`, same origin, so the session
cookie reaches it.

nginx does two things nobody else can: it terminates TLS and it is the only
public entry point. There is a networking detail recorded in the compose
file itself that is the kind of thing only production surfaces — the router
does not hairpin, so a container resolving `nexopm.com` to the public IP
simply times out. The fix was pointing the public names at the host's LAN
address via `extra_hosts`, where the same nginx terminates the same TLS:

```yaml
x-internal-hosts: &internal-hosts
  - 'storage.nexopm.com:192.168.100.197'
  - 'nexopm.com:192.168.100.197'
```

Without it, a presigned storage URL (signed for the public host) doesn't
work from inside the network.

## The database: a pooler and a replica born from a load test

Postgres hasn't been alone for a few weeks now. In front of it sits a
PgBouncer in transaction mode (`MAX_CLIENT_CONN: 200`,
`DEFAULT_POOL_SIZE: 20`) and, beside it, a read replica over real streaming
replication — `pg_basebackup -R`, not a file copy.

The three `IssueRepository` reads that the `/issues` route uses go through
the replica; every write stays on the primary. When `DATABASE_URL_REPLICA`
isn't set, the replica client falls back to the primary instead of
breaking — an environment without a replica keeps working, just slower.

I won't repeat here where those two pieces came from: the post about
surviving 1 million users tells the whole story, with the load-test numbers
that proved the bottleneck had moved. What matters for the map is that the
diagram's "PostgreSQL" is three containers today — primary, replica and
pooler — and that only the primary holds the truth.

Two image decisions worth the comment they carry in the compose file: Redis
is **pinned by digest** (`bitnami/redis@sha256:1347d526…`, Redis 8.6.3 from
2026-05-11) because the newer `latest` crash-loops on TLS setup and the
versioned tags were removed from Docker Hub; and MinIO now comes from
`quay.io`, because MinIO stopped publishing to Docker Hub. In both cases
the comment in the file explains why and says how to validate before
touching it — that's the difference between a pin and a pin somebody will
manage to move six months from now.

Redis, incidentally, does not listen on a non-TLS port:
`REDIS_PORT_NUMBER: 0`, `REDIS_TLS_PORT_NUMBER: 6379`. There is a CI job
just for that, `redis-tls-smoke`, which brings up a Redis with a
certificate generated on the spot and connects over `rediss://`. Half a
minute of pipeline to make sure the configuration protecting the cache
hasn't regressed.

## Backup: `pg_dump` at 03:15, encrypted before it leaves the server

![Nexo's backup flow: a worker triggers a Node process that reads PostgreSQL and Object Storage, writes a local backup and ships it to Backblaze B2; a restore arrow comes back from B2 into Node. All inside a self-hosted box](/img/nexo-architecture/blog_diagram-data.png)

Backup is the only Nexo subsystem that is **not in the repository**. It
runs straight on the server, from cron, and that is a choice with a cost:
no review, no CI, no change history. It's in this post because it is part
of the real architecture, not because it is the well-built part of it.

The cycle:

```
Mon–Sat 03:15  →  daily/    local  7 days  ·  Backblaze B2  30 days
Sunday  03:15  →  weekly/   local 56 days  ·  Backblaze B2 180 days
```

The dump is `pg_dump -Fc`, per database — custom format, restorable with
`pg_restore`, not the whole cluster. Alongside it goes the mirror of the
MinIO objects: avatars, covers, issue uploads. A database backup without
the files its rows point at isn't a backup, it's half of one — a restored
issue pointing at an attachment that no longer exists is a record that
lies.

The upload to B2 goes through an rclone `crypt` remote. That means what
leaves the machine leaves encrypted: **filename and contents**, both,
encrypted client-side. Backblaze stores blobs it cannot read, under names
that say nothing — whoever has access to the bucket does not have access to
the data. The key lives outside the bucket; if it's lost, so is the backup.

Expiring old copies in B2 is done by the bucket's own lifecycle rule, not
by an `rm` at the end of the script. The difference matters: a script that
deletes is a script that can delete the wrong thing, and a lifecycle rule
is declarative and auditable on the provider's side. The script's job is to
write; forgetting is the bucket's job.

And the diagram's `restore` arrow isn't decorative: the way back has
already been executed for real, at least once, with real data. That
sentence is the only thing separating a backup from a large folder.

**What this design does not give me:** a logical dump is not point-in-time
recovery. Between two runs there is a window of up to 24 hours of data I
simply would not get back — the real RPO is a day, not minutes. Closing
that window would take WAL archiving, which is another subsystem and
another storage bill. Today the risk is accepted, not solved; and since the
cron isn't versioned, the only proof that it runs is the bucket having a
new file every morning.

## Four test layers that didn't exist three weeks ago

Nexo already had unit, integration, API e2e and component tests. In
September four more landed, each answering a question none of the previous
ones could.

### Contract: the OpenAPI stopped being fiction

`public/openapi.json` is written by hand and nothing checked it, so it
drifted. The contract suites don't restate the truth — they rebuild it from
the code: the route inventory is walked out of `app/api/**/route.ts`, the
public list is parsed from `proxy.ts`, the response envelope is derived
from `types/http-response`, and request bodies are compared field by field
against the Zod schemas.

What the first run caught: `GET /health` was undocumented; a thumbnail path
declared 1 of its 3 parameters; two schemas used `nullable` with no type,
which ajv refuses to compile; and **40 fields** carried OpenAPI 3.0's
`nullable: true`, which every 3.1 reader ignores — meaning they were
published as non-nullable.

Plus two status mismatches that were real bugs.
`MODULE_MEMBER_ALREADY_EXISTS` was registered as **405** while every
sibling is 409: adding a duplicate member answered "method not allowed".
That one slipped past the check comparing documented codes to the registry,
because a shared `$ref` response never names its code. The operation prose
does ("Fails with `CODE` (409) if…"), so that pairing is checked too — and
it's what caught the second case, where the document was the wrong one.

It's 4 files and 18 tests that need no database, no Redis and no server:
they only read files and JSON. That's why they get their own job, 36
seconds, instead of waiting on the job that boots Postgres.

### Browser: the production artifact, in a real Chromium

Eighteen Playwright specs over the golden paths — sign-up through the OTP
screen and the whole onboarding, sign-in/sign-out and a wrong password,
creating a project and an issue and moving its state, workspace settings,
sticky notes and wiki pages surviving a reload, and the rate-limit path
where the UI must show the server's own message.

The detail that makes this layer worth its cost: the server it boots is the
**standalone artifact**, the same one production runs — not `next start`.
`next.config` sets `output: 'standalone'`, which `next start` refuses to
serve. That difference is what exposed a CSP bug: every other layer speaks
HTTP or renders in jsdom, where a browser's own enforcement never happens.

Three specs landed as `fixme`, with the bug they reproduce written beside
them — kanban drag-and-drop is dead because the dnd-kit listeners only
reach a handle no screen renders, the "Fundador / Executivo" role submits
`FOUNDER_EXECUTIBE` and jams the step, and the workspace home greets
everyone by a name hardcoded in the page. A red test documenting a known
bug is worth more than a deleted test.

The whole suite runs in 21 seconds, and in CI it reuses the e2e job's
build, database and MinIO instead of paying for a second `next build`.

### Visual: twelve screens, four variants, zero pixels of tolerance

Every earlier layer checks behaviour: the button exists, the click sends
the right PATCH. None of them knows the button went white on white, that a
gap pushed the sidebar over the content, or that a token slip broke dark
mode.

Twelve screens in up to four variants each — desktop and mobile, light and dark —
44 images, and a single changed pixel fails the build with the diff image
attached. This layer's entire job is determinism: the suite runs inside the
official Playwright image (and the script refuses to run if its tag and
`@playwright/test` disagree, since a browser bump re-renders every
baseline), the clock is fixed before the first navigation, motion is frozen
three ways, fonts and lazy images are awaited, and the data is seeded with
fixed names and a fixed join date.

The threshold is `maxDiffPixelRatio: 0`. At Playwright's default, a
deliberate `#fff` to `#f5f5f4` regression passed unnoticed — that is how a
visual suite starts being worth nothing. With the threshold pinned at zero,
that same change fails exactly the twelve light variants with a `bg-card`
surface and leaves every dark one green.

Then came the CI lesson: the first run on the runner came back 43 of 44,
failing on **one pixel** of a blue heading — `rgb(38,68,103)` on my
machine, `rgb(40,72,109)` on the runner. Pinning the container pins the
fonts and the Chromium build, but it does not pin the CPU: Skia picks its
SIMD paths at runtime, so the same page rasterises a shade differently on
different silicon. The tempting fix is `maxDiffPixels: 1` — and that is
exactly how a suite starts drifting toward tolerances that hide real
changes. The right fix was removing the source of the variation: no runtime
Skia opts, no LCD text, no subpixel positioning, no hinting, a fixed colour
profile, no partial raster, no GPU. Baselines re-recorded against that.

### Mutation: the question coverage cannot answer

Coverage says the line ran. It does not say a test would go red if the line
were wrong. Stryker mutates the backend logic — services, mappers, errors,
queue, utils — and reruns the unit project against each mutant. **5,269
mutants, 25 minutes**, so it runs weekly and on demand, outside the CI gate
(CD fires off a green CI; doubling every deploy's time for this doesn't pay
for itself).

The first run scored 70.3%, and the survivors were real holes:

- The project authorization gate was **unproven in both directions**.
  Hardcoding "is the lead" to `false` survived in 64 places: no test ever
  granted access on the strength of being the lead. Hardcoding "is a
  member" to `true` survived in 47. And `.some` → `.every` survived in 16 —
  which means every test used a project with exactly one member, where the
  two operators agree.
- Three deadlines could have had their sign flipped unnoticed: the 30-day
  account-deletion grace period, the 7-day invitation TTL and the
  data-export download link. Each would ship already expired.
- The status page's 90-day uptime could be replaced with an empty function
  and nothing went red: nothing read the number.
- Both coupon amount bounds are inclusive on purpose and neither edge was
  tested — a 100%-off coupon had never been exercised.
- Every upload size limit tested LIMIT+1 and nothing pinned the boundary,
  so `>` and `>=` were interchangeable in five places.

The missing tests were written; the score went to 72.4% and `break` sits at
70. The gate stays honest without failing over the handful of mutants whose
verdict shifts between runs.

### The numbers, not rounded up

| Layer | Files | Tests | Where it runs |
| --- | --- | --- | --- |
| Unit + integration | 184 | 1,971 | CI, with Postgres and Redis |
| Component | 154 | 1,662 | CI, jsdom |
| API e2e | 98 | 467 | CI, a real server |
| Contract | 4 | 18 | CI, its own job |
| Browser (Playwright) | 8 | 18 | CI, standalone artifact |
| Visual | 5 | 44 | CI, Playwright image |
| Mutation (Stryker) | — | 5,269 mutants | Weekly, own runner |

Coverage, measured rather than estimated: **88.43% on the backend** and
**94.97% on the frontend** on Codecov, with 91.02% for the project overall.
They are two separate numbers on purpose, with separate flags and separate
baselines, because merging them into one average produces a number that
means nothing — the ~500 client screens would sink the backend, and the
backend would flatter the frontend. The v8 report inside the frontend scope
shows 97.21% of statements; the Codecov number is lower because it counts
partial branches.

And none of those is the most honest number on the list. The most honest
one is **72.4%** — the mutation score. It's the only one that answers "if I
break this, does anybody notice?".

## CI/CD: thirteen jobs, one gate, and a bot that opened a PR

![Nexo's CI/CD flow: from developer to GitHub, from GitHub to CI, which splits into quality, tests and security; from CI to CD, which splits into migration, deploy and release. All on GitHub Actions](/img/nexo-architecture/blog_diagram-cicd.png)

`ci.yml` has thirteen jobs. They organize themselves exactly like the three
boxes in the diagram (the labels are in Portuguese: *Qualidade*, *Testes*,
*Segurança*).

**Quality** — `lint` (Biome with `--error-on-warnings` plus
`tsc --noEmit`) and `pr-title` (conventional commit in the PR title, for
the exception PRs).

**Tests** — `coverage-tests` (unit, integration and component, uploading to
Codecov under two flags), `e2e-tests` (which does the pipeline's only
`next build` and then chains API e2e, browser and visual on top of that
same build), `contract-tests` and `redis-tls-smoke`.

**Security** — `gitleaks` (secrets in history), `semgrep` (SAST, one run
with two outputs: SARIF for the Security tab and JSON for triage), `snyk`,
`audit`, and `lpa2v-triage`, which correlates the SAST and SCA findings
through the paraconsistent neuron cluster from my thesis before a human
looks at them — there's a whole post about that one here.

Three of those are deliberately non-blocking (`snyk`, `audit`,
`lpa2v-triage`) and stay out of the gate's `needs`. Monitoring that blocks
deploys becomes monitoring somebody turns off.

At the end, the `gate` job: it runs no tests, it only fails if any of the
seven required jobs failed or was cancelled. It's a single `needs` for
`cd.yml` to listen to — and `cd.yml` listens to the CI's **conclusion**,
not to the push. That design, and why Nexo has no Pull Request in the
default flow, is another post's subject; here it's enough to say that
`migrate` runs before `deploy`, that the image is scanned with Trivy and
only reaches the registry if it passes (blocking on CRITICAL, with HIGH
staying visible and going to Dependabot), and that the production secrets
are decrypted with SOPS + age at deploy time.

Releases are CalVer: `2026.09.20`, then `.1`, `.2` for the second and third
deploy of the same day.

### The migration to Avrea runners

On September 19th, every hosted job moved from `ubuntu-latest` to
`avrea-ubuntu-latest-2-vcpu`. The PR that did it — 15 replacements in
`ci.yml`, 6 workflows, +58/−30 — **was opened by a bot**, `avrea[bot]`, not
by me. It's the first PR in the entire repository opened by an agent that
isn't Dependabot.

Accepting it wasn't one click. The PR branch piled up four runs before
going green — red, cancelled, red, green — and two things broke the way
only a different runner breaks them:

1. Avrea runners export `NODE_OPTIONS=--use-openssl-ca`, and Node
   **forbids** that flag in a worker thread. `next build` died with
   `ERR_WORKER_INVALID_EXEC_ARGV`. The fix is `NODE_OPTIONS: ''` on the
   build and start steps — with the comment explaining why, or somebody
   removes it in six months thinking it's junk.
2. The MinIO image came from Docker Hub, which MinIO stopped publishing to.
   It now comes from `quay.io`, on the same pinned tag the infra compose
   already used.

What the migration did **not** do was speed up the wall clock. Before the
change CI closed in ~5 minutes; after it, ~9. The cause isn't the runner:
the browser and visual layers landed the same day, and the e2e job went
from doing one thing to doing three. Comparing those two numbers would be
dishonest, and I don't have a clean A/B to claim a speed gain — what I have
is a green pipeline in 9 minutes with 4,180 tests inside it.

And the most sensitive jobs are still where they were: `migrate`, `deploy`
and the mutation job run on `self-hosted`, on my own runner. Migration and
deploy need access to the server; mutation needs 25 minutes of CPU I don't
want to pay for by the minute.

## The three agents

You can count who worked on this repository with `git log` and the GitHub
API, so here are the numbers instead of the adjective:

- **Claude** — 943 of the 1,255 commits carry the co-authorship trailer,
  starting February 8th. Across models: 501 Sonnet 5, 123 Opus 4.6, 113
  Opus 4.7, 76 Opus 5, 65 Opus 4.8, 45 Sonnet 4.6, 41 Fable 5.
- **Dependabot** — 22 of the repository's 58 PRs. It's the only agent that
  always worked through PRs, because a dependency bump is exactly the kind
  of change where I want the diff isolated and CI running on its own before
  I look.
- **Avrea** — 1 PR, the runner migration described above.

Beyond that: 41 PRs merged in total, 487 `feat` commits, 304 `fix`, 99
`test`. July was the heaviest month, at 339 commits.

What those numbers prove is volume and cadence. What they don't prove is
quality — a commit co-signed by an agent is a commit I reviewed and signed,
and responsibility for each of them is mine, not the trailer's. What
sustains that speed isn't the agent: it's the gate the agent can't bypass.

## What this proves, and what it doesn't

It proves you can run a self-hosted multi-tenant platform on one image,
three processes and an infra compose that fits on a screen — and that the
expensive part isn't the architecture, it's the discipline of writing down
why each pin, each exception and each `NODE_OPTIONS: ''` is there.

It proves line coverage isn't the metric: 88% on the backend, and 5,269
mutants revealed an authorization gate that had never been proven in either
direction. The tests were green the whole time.

It doesn't prove the first diagram's architecture exists — half of it is a
target, and I'd rather say so than let you find out by opening the
repository.

It doesn't prove the backup is good. It's daily, encrypted, with two-tier
retention and a restore already executed — and it's still a script outside
version control, with a 24-hour RPO. It's the most important subsystem on
the list and the only one that goes through none of the pipeline the rest
goes through. That sentence is the next item on my list, not a conclusion.
