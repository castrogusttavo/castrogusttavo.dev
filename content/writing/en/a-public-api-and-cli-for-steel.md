---
title: Contract first — Steel's public API, webhooks and CLI from a single document
description: "Steel's SDK was generated from a contract document before the API existed. When the real API landed, swapping one for the other cost six type aliases and one cast in the CLI. This is how a 29-operation v1 API, signed webhooks and the `steel` CLI came out of the same contract — and where that contract still lets the SDK and the app drift apart."
icon: terminal
date: "2026-12-22"
---

Until 2026-10-17, anyone wanting to automate something in Steel had two bad
options. The REST API has **1,125 operations** in `openapi.json`, nearly all
built for the app's UI and authenticated only by the browser session cookie.
The other was the `crm_live_` key: per workspace, no user, leads only. A CI
script that opens a ticket when a deploy fails had no credential of its own
and no contract that would survive the next deploy. And an external system
that wanted to know when a ticket was resolved had to poll: Steel received
webhooks from plenty of systems but sent none.

Steel is Stratus Telecom's multi-tenant platform — ServiceDesk ITIL 4, CRM,
Communication/WhatsApp, and Steel AI on top of all three. I'm a Lead Software Engineer at Stratus Telecom: I built the first version of Steel and now lead its technical modernization. This post covers three ADRs in the public repository — 0034 (CLI and SDK),
0035 (public API v1 and personal tokens) and 0036 (outbound webhooks), all
signed "deciders: product owner + engineering team" — and the
[`steel-so/steel-cli`](https://github.com/steel-so/steel-cli) repository.

## The problem: three deliverables that depend on each other

A Steel CLI needs three things that didn't exist: an API that doesn't change
every deploy, a credential that isn't a browser cookie, and events to listen
to (`steel listen`). Done naively, that's sequential: API, then tokens, then
webhooks, then an SDK over the finished API, then the CLI over the SDK, each
layer waiting for the one below to settle.

It isn't only about time. An API built without its first client in hand
tends to mirror what the server has, not what the client needs. And a
hand-written SDK over an API that's still moving becomes a second source of
truth someone has to remember to update.

## The idea: write the contract, generate the rest, treat the CLI as the first customer

So the order flipped. First, one document — `docs/cli/README.md` — as the
contract between slices: v1 routes next to the CLI command that uses each
one, the token format, the device-flow error codes, the webhook body and
headers. Its first line says "contract changed? change it here first". Then,
on the app side, `public/openapi.v1.json` generated from code and locked in
CI. On the CLI side, an SDK generated from that document, never hand-written.

And one rule from ADR 0034 ties it together: **the CLI talks to Steel only
through public API v1.** No internal routes. If the CLI needs something, v1
has to have it — which makes the CLI the API's first real customer, not a
privileged back door.

## How it works

### The v1 slice

`/api/v1` isn't the whole API under a new prefix. It's a curated slice: **25
paths and 29 operations** in `openapi.v1.json` — auth (3), account (1),
ServiceDesk (6), CRM (6), Communication (3) and webhooks (10) — against 766
paths and 1,125 operations in the internal document. ADR 0035 forbids new
business logic in the v1 layer: every route reuses the service the app
already calls.

Every route goes through one helper, `apiV1Route`, whose order is v1's
security contract (trimmed):

```ts
const resolved = await resolveApiSession(request)
if (!resolved.ok) return handleError(resolved.error)
const session = resolved.value

// The per-token budget is consumed by `resolveApiSession` itself.
const byUser = await consume(apiLimiter, `user:${session.userId}`)
if (!byUser.ok) return handleError(byUser.error)

if (options.access === 'write' && !session.scopes.includes('api:write')) {
  return handleError(apiTokenScopeRequired())
}
if (options.module && !session.modules.includes(options.module)) {
  return handleError(apiTokenModuleNotAllowed())
}
// ... LGPD consent on writes, Zod on query and body ...
const result = await runWithAuditContext(
  { source: 'api', apiTokenId: session.tokenId },
  () => options.handler({ session, params, body, query, text: raw }),
)
```

Personal token (the cookie never counts here) → per-token (300/min) and
per-user limits → scope → module → consent → validation → service, running
as the token's owner. The last line is the audit source: every mutation the
services already audited now carries `source: 'api'` and the token id,
without touching a single service.

Lists use cursor pagination — `?limit=` (default 25, max 100) and
`?cursor=`, returning `data.items` and `data.nextCursor`. Some lists the
service returns whole (leads, pipelines, templates) are paged in memory
behind an opaque cursor that encodes the position; clients can't tell.

### The contract, locked in CI

`public/openapi.v1.json` is generated from code (`pnpm openapi:generate`) and
committed. In the "Lint & Type Check" job, `pnpm openapi:v1:compat --base
<sha>` diffs the document generated on the commit against the PR base and
fails on any breaking change. The checker's own list
(`src/openapi/v1/compat.ts`):

```ts
/**
 * Breaking:
 * - a path or operation removed, or a success status removed;
 * - a response field removed, made optional, or with a type it did not
 *   have (including becoming nullable);
 * - a request field or parameter removed, newly required, or accepting
 *   fewer types or enum values;
 * - a request body or content type that was accepted no longer is.
 */
```

New routes, new optional fields and new error codes pass. A route only goes
away after 6 months of `Deprecation` and `Sunset` headers. Internal routes
stay free to change; v1 can only grow.

### Identity: a personal token and a browser login

MCP's identity is OAuth with per-user, per-workspace grants — covered in
[An MCP server is an adapter](/en/writing/an-mcp-server-is-an-adapter). For
scripts and CI, ADR 0035 chose differently: an OAuth token needs a
registered client and a browser on every renewal, and a CI job has no
browser. The personal token (`ApiToken`) keeps the same grant shape — one
user, one workspace, scopes (`api:read`, `api:write`), modules — with an
explicit lifetime: 90 days by default, 365 at most. The value is `stl_pat_`
plus 43 random characters, stored only as SHA-256 and shown once. Removed
member, suspended workspace, revoked or expired token: 401 on the next call.

`steel login` never asks anyone to paste a token. It runs a device flow: the
terminal shows an 8-character code (no vowels, no `0`/`1`, displayed as
`BCDF-GH23`), the person confirms it at `/device` in Steel and picks
workspace, modules and scope, and the CLI, polling every 5 s, receives a token
named "Steel CLI — <machine>". The code lives 10 minutes; `SLOW_DOWN` adds 5 s
to the interval.

The ADR called for Better Auth's `device-authorization` plugin. The contract
records why it didn't stick: the plugin returns a **session** token and
stores neither workspace, modules nor scope. The state lives in Redis
(`src/cache/device-authorization.cache.ts`), and the token is minted only on
the poll that finds the login approved, exactly once. If the person lost
access between approving and the CLI polling, the poll returns the issuer's
error instead of a token.

On the CLI side, the token goes to the OS keychain (Keychain, Credential
Manager, Secret Service) with a 3 s timeout, because some Linux setups hang
waiting for a Secret Service that isn't there. Without a keychain it falls
back to `~/.config/steel/credentials` with mode 600. `STEEL_TOKEN` in the
environment wins, for CI. `steel logout` revokes the token in Steel
(`DELETE /api/v1/auth/token`) before deleting the local copy.

### Outbound webhooks: one catalog for the ERP and the terminal

A workspace registers HTTPS endpoints (up to 20) that receive events from a
versioned catalog, `src/lib/webhooks/events.ts`: **19 types** — 12 ServiceDesk,
4 CRM, 1 Communication, 1 Steel Agents, plus `steel.ping`, which is for
testing and can't be subscribed to. Each type has a module, a pt-BR
description, a Zod schema for `data` and sample data; the catalog is a public
contract under the same stability rule as v1.

Delivery runs through a BullMQ queue (`webhooks-delivery`): body
`{ id, type, createdAt, workspaceId, data }`, up to 6 attempts with exponential
backoff, a 10 s timeout, no redirects followed. An endpoint failing for 3
days straight is disabled and the admin is told; the delivery log keeps 30
days, with manual resend. The URL goes through an SSRF guard when saved
**and** before every attempt, because DNS changes: HTTPS only, no credentials
in the URL, and the host — literal or every resolved address — must be public.

The signature is the part receivers will reimplement, so it's short:

```ts
export const WEBHOOK_HEADERS = {
  id: 'Steel-Webhook-Id',
  timestamp: 'Steel-Webhook-Timestamp',
  signature: 'Steel-Signature',
} as const

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex')
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`
}
```

`v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`, keyed by the endpoint's
`whsec_...` secret. Receivers compare in constant time, accept several
comma-separated signatures (to rotate secrets without downtime) and reject
timestamps more than 5 minutes off. The SDK ships that check as
`verifySignature`, which never throws.

### `steel listen --forward`: production on your laptop

Testing a webhook receiver locally usually means a public tunnel into your
machine or hand-pasted JSON — which skips exactly the signature check. `steel
listen` opens an SSE stream (`GET /api/v1/webhooks/listen`) relaying the
workspace's events in real time over Redis pub/sub. Each message carries the
body and the three header values already computed by the server. With
`--forward`, the CLI POSTs to the local app with the same body and the same
headers (`packages/cli/src/lib/forward.ts`, trimmed):

```ts
const response = await fetchImpl(url, {
  method: 'POST',
  redirect: 'manual',
  signal: AbortSignal.timeout(options.timeoutMs ?? FORWARD_TIMEOUT_MS),
  headers: {
    'content-type': 'application/json',
    'user-agent': `Steel-Webhooks/1.0 (steel-cli/${VERSION})`,
    [WEBHOOK_HEADERS.id]: frame.id,
    [WEBHOOK_HEADERS.timestamp]: String(frame.timestamp),
    [WEBHOOK_HEADERS.signature]: frame.signature,
  },
  body: frame.body,
})
```

The body is the exact string, not a re-serialized object — re-serializing
would change key order or whitespace and break the HMAC. The 10 s timeout
matches a real delivery. The app's verification code runs with no "if test"
branch. In another terminal, `steel trigger crm.lead.created` fires an event
with the catalog's sample data.

### The generated SDK and the CLI on top

`steel-so/steel-cli` is a pnpm monorepo with two packages. `@steel-so/sdk` is
generated with `openapi-typescript` from a snapshot of the app's
`openapi.v1.json`, wrapping `openapi-fetch` in a result type that never
throws: every call resolves to `{ ok: true, data }` or
`{ ok: false, error: { status, code, message } }`. The generator refuses to
run without a real document — no argument, no `STEEL_OPENAPI_SOURCE`, no
sibling Steel checkout, and it fails listing the options. The repo's CI runs
`generate:check`: if the generated code doesn't match the committed snapshot,
the build fails.

`@steel-so/cli` (binary `steel`, TypeScript + Ink) has `login`, `logout`,
`whoami`, `profile`, `api` (any v1 route, body from `@file` or stdin),
`completion` for bash, zsh and fish, `listen`, `trigger`, `webhooks`, the
ServiceDesk, CRM and Communication commands, an interactive dashboard when run
with no arguments, and `steel mcp`, a stdio bridge to the MCP server. Outside a
terminal everything prints stable, colorless JSON, and the exit code says
what happened: 0 success, 1 error, 2 usage, 3 auth, 130 cancelled.

## Results

The evidence for contract-first is the commit order, all between the evening
of 2026-10-17 and the early hours of the 18th:

| Time | Repository | What landed |
|---|---|---|
| 22:01 | `steel` | the contract (`docs/cli/README.md`), in `2f5cb8e5` |
| 22:06 | `steel-cli` | monorepo scaffold |
| 22:23 | `steel-cli` | SDK generated from a fixture written from the contract (`903b406`) |
| 22:34 | `steel` | first `openapi.v1.json` generated from code, with the CI compatibility check (`9fa51c66`) |
| 22:41 | `steel-cli` | ServiceDesk, CRM and Communication commands, still on the fixture |
| 23:28–23:56 | `steel` | `feat/api-tokens`, `feat/api-v1` and `feat/webhooks-out` merged |
| 02:07 | `steel-cli` | SDK regenerated from the real document; 3,327-line fixture removed (`e18e902`) |

The SDK and the domain commands were written against a document describing an
API that didn't exist yet. When the real document arrived, the difference
that mattered was naming: the fixture called operations `listSdTickets`,
`listCrmLeads`; the app generated `listTickets`, `listLeads`. The SDK's **six**
type aliases (`SdTicketListQuery` and friends) absorbed it, and the CLI's code
change was **one cast** in `webhooks.tsx`, for the new event-subscription type.

What's countable today:

| | Before (until 2026-10-17) | After |
|---|---|---|
| Credential for scripts and CI | browser cookie or `crm_live_` (workspace, leads only) | `stl_pat_` per user × workspace × scopes × modules |
| Stable contract | none (1,125 internal operations) | 29 v1 operations, locked in CI |
| Outbound events | Slack notices only | 18 subscribable types, 6-attempt delivery with a log |
| Typed client | none | `@steel-so/sdk`, generated from the document |

In `steel-cli`, as of 0.1.1, the suite has **33 files and 393 tests** — the
two new files are the contract test and the compatibility checker described
below — running on Node 22 and 24 in CI, with **98.88%** statement,
**94.92%** branch, **98.46%** function and **99.54%** line coverage against
build-breaking thresholds of 95/90/95/95 (figures from the "Verify the tag"
job of the 0.1.1 release). In the app, the tokens, v1 and webhooks slices
have **39 dedicated test files**, including e2e against Postgres for the
device flow, v1 and the webhook routes.

v0.1.0 shipped on 2026-10-18 with binaries for `linux-x64`, `linux-arm64`,
`darwin-x64`, `darwin-arm64` and `windows-x64`, `SHA256SUMS`, GitHub Actions
provenance attestations on the binaries, both packages on npm and a formula
in the `steel-so/homebrew-tap` tap.
[0.1.1](https://github.com/steel-so/steel-cli/releases) followed the same
day, on the same five platforms, with the fixes described in the next
section.
The API, webhooks and CLI were tested end to end
by me and by two customer companies with their own workspace and
subscription. I have no usage numbers — how many tokens exist, how many
deliveries fail.

## Where it broke / limitations

**The contract was prose.** `docs/cli/README.md` pins routes, fields and error
codes, but not `operationId`s. The fixture made some up, the app's generator
produced others, and the swap was cheap only because the SDK exposes its own
aliases instead of raw generated types. The root cause is that the first
machine-readable document came from code, 33 minutes after the contract,
rather than from the contract. A contract written in OpenAPI from the start
would have pinned the names; one written in Markdown pinned the intent.

**The SDK's CI compared the SDK with itself — fixed in 0.1.1.**
`generate:check` ensures the generated code matches the snapshot committed in
`steel-cli`, not that the snapshot matches the app. The two did drift: after
the snapshot, app commit `21fd34b8` changed the menu path in
`openapi.v1.json` descriptions from "Ajustes" to "Configurações", and the
SDK snapshot kept saying "Ajustes" with nothing raising a flag. ADR 0034
promised "a contract test against staging on every release", but the release
smoke step ran the binary offline (`--version`, `profile list`, and
`steel mcp` without a token must exit 3) and talked to no server.

In 0.1.1 the snapshot was refreshed (`25ca7f7`): the generated types came out
identical, only descriptions changed, and they now say "Configurações ›
Segurança" — as does the CLI README. And the release gained the contract test
the ADR promised: before anything is published, it compares the v1 API served
by staging with the SDK's snapshot, using a copy of the app's checker
(`scripts/lib/openapi-compat.ts`, ported from `src/openapi/v1/compat.ts`), and
fails on any breaking change. With a read-only token it also runs `whoami`,
the ServiceDesk catalog and the CRM pipelines through the real CLI; if the
token has `api:write`, the release fails on purpose. It ran and passed on the
0.1.1 release.

What's left of the root cause: the trigger is still a `steel-cli` release,
not an app deploy — between two releases nobody compares the two (the app's
own CI compatibility check is what holds v1 in that window). And the checker
looks at shape, not text: a stale description like the "Ajustes" one would
slip through again.

**v1 is a slice, and the CLI only reaches the slice.** 29 operations against
1,125. The dashboard's Communication tab shows only approved templates,
because conversations awaiting a reply aren't in v1 yet — and under ADR 0034
the CLI can't fetch them through an internal route. That rule keeps v1
honest; the price is that every new command starts with a new app route and
the stability commitment that comes with it.

**There's no production URL in the contract yet.** The CLI's `producao`
profile says the URL "will still be defined", and the `servers` list in
`openapi.v1.json` has only staging and local development. The contract is
public; the final environment isn't yet.

**v0.1.0 shipped with two defects — fixed in 0.1.1.** First: a 401 or 403
with a specific code (`API_TOKEN_SCOPE_REQUIRED`, a disabled module, an
expired token) fell into the generic branch and exited 1, though the README
promises 3 for auth and permission failures. Commit `78f034b` maps on HTTP
status first: in 0.1.1 every 401 and 403 exits 3. The v0.1.0 binaries still
have the bug. Second: the README said the npm package ships with
`--provenance`, but 0.1.0 was published by hand, without an attestation,
because the npm account's 2FA started blocking the CI token. Commit `5307225`
moved publishing to trusted publishing over OIDC, and 0.1.1 is the first
version shipped that way: published from GitHub Actions with a provenance
attestation that `npm audit signatures` verifies. The packages no longer
accept token publishing, and the README now says 0.1.0 was published by hand.

**`listen` verifies with a different secret.** The listen secret is derived
from the server secret per member and workspace; it isn't the production
endpoint's `whsec_`. The app's verification code runs unchanged but is
configured with another value. That was deliberate — a listen session has no
registered endpoint, and deriving avoids storing yet another secret — but an
app that reads the wrong secret in production still passes locally.

## What this proves, and what it doesn't

It proves that a contract written before the code lets the API, webhooks, SDK
and CLI move in parallel, across repositories, and that generating the SDK
from the document — instead of hand-writing it — turns swapping a provisional
document for the real one into a renaming, not a behavior change. It also
proves that forbidding the CLI from using internal routes turns the API's
first client into a continuous test of the public slice.

It doesn't prove the contract keeps itself: since 0.1.1 a CLI release won't
ship against an incompatible v1, but between releases nothing compares the
app with the SDK, and stale text still gets through. It doesn't prove 29
operations are enough for integrators. And it says nothing about volume —
calls or webhook deliveries — because those numbers don't exist yet.
