---
title: An MCP server is an adapter — the hard part was identity and consent
description: "Steel's MCP server is 247 lines of server code reusing 88 tools that already existed, already filtered and already tested. The protocol was the easy part. The real work was answering who is calling, in which workspace, with which modules and until when — and making that answer change on the very next call once someone revokes access."
icon: code
date: "2026-12-17"
---

The request was short: customers wanted to use Steel from inside Claude,
ChatGPT and Cursor. Ask which tickets will breach their SLA today, see this
week's pipeline, add a note — without opening the app.

The first thing that jumps out of a request like that is the protocol: MCP,
transports, JSON-RPC, `tools/list`, `tools/call`. That's what the tutorials
teach and what shows up in the diagram. In Steel, the file that actually
speaks MCP (`src/lib/mcp/server.ts`) is **247 lines**. The work was
somewhere else: deciding who is on the other side of an
`Authorization: Bearer`, and making that answer stop being true the moment
it should.

Steel is Stratus Telecom's multi-tenant platform — ServiceDesk ITIL 4, CRM,
Communication/WhatsApp, and Steel AI on top of all three. I'm a Lead Software Engineer at Stratus Telecom: I built the first version of Steel and now lead its technical modernization. The decisions below are ADRs 0032 and 0033 of the public repository, both
dated 2026-10-17 and signed "deciders: product owner + engineering team".
In [AI agent autonomy isn't a boolean](/en/writing/an-autonomy-spectrum-for-ai-agents)
MCP gets a few paragraphs as one step of the spectrum. This post walks down
that whole step.

## The problem: 731 routes and a key that doesn't know who you are

The obvious way to put a product behind MCP is to turn routes into tools.
ADR 0032 counts **731 routes** in the REST API, **621** of them under
`/workspaces/{id}`, all shaped for the UI: pagination the screen drives, IDs
the screen already holds, filters the screen builds. One MCP tool per route
would hand the model 731 options and leave it to resolve IDs, chain calls and
guess filters on its own.

The second problem was worse. On 2026-10-17 the API only accepted the
browser session cookie. The only API key was `crm_live_`: per workspace, no
user, leads only. An MCP client has to act **as a person**, because that's
how Steel's RBAC works — what you see on a ticket depends on your role, not
on the workspace. A workspace key would give every connected app the powers
of every member at once.

The third was subtler: revocation. A self-contained JWT stays valid until it
expires, even after the user leaves the workspace or disconnects the app.
The UI stops showing the connection; the token keeps working.

## The idea: the registry already is the server — what's missing is identity

Steel AI already had everything an MCP server needs: a tool registry
(`STEEL_AI_TOOLS`) with model-facing descriptions, JSON Schema, `parse`,
`preview` and `execute`, filtered by module and RBAC and running with the
caller's permissions. I covered that contract, and why write confirmation
lives on the server, in
[AI write confirmation belongs on the server](/en/writing/ai-write-confirmation-belongs-on-the-server).

ADR 0032 fits in one sentence: **`/api/mcp` is an adapter over that registry,
in the same Next process, with no separate repo or service.** The registry
stays the authority. The adapter does two things: it narrows what the
registry already allows down to what the token was granted, and it
translates shapes.

That turns "which tools does MCP have?" into "who are you?" — a question
Steel had no answer to. ADR 0033 supplies it: **Steel's own OAuth 2.1, with
every grant bound to one user, one workspace, a set of scopes and a set of
modules.** Workspace, user and modules never come from tool arguments. They
come from the token.

## How it works

### The whole route fits on one screen

The order of checks in `app/api/mcp/route.ts` (trimmed):

```ts
export const POST = withAxiom(async (request: NextRequest) => {
  const grant = await resolveMcpGrant(request)
  if (!grant.ok) {
    logMcpRejected({ reason: 'invalid_token', errorCode: grant.error.code })
    return mcpUnauthorized(request, BETTER_AUTH_URL)
  }

  const byUser = await consume(mcpUserLimiter, `mcp:${grant.value.userId}`)
  // ...
  const byClient = await consume(mcpClientLimiter, `mcp-client:${grant.value.clientId}`)
  // ...
  const access = await resolveToolAccess(grant.value.userId, grant.value.workspaceId)
  if (!access.ok) {
    // Removed from the workspace (or the workspace is gone) since the
    // token was issued: the grant no longer holds.
    const stale = isStaleGrantError(access.error)
    // ...
    if (stale) return mcpUnauthorized(request, BETTER_AUTH_URL)
    return handleError(access.error)
  }
  // ...
  return handleMcpRequest(request, grant.value, access.value, { /* ... */ })
})
```

Token → grant → per-user (120/min) and per-OAuth-client (600/min) limits →
the user's access in the workspace → server. `GET` and `DELETE` answer 405.
Every `401` carries `WWW-Authenticate: Bearer resource_metadata="..."`, which
is how an MCP client discovers where to log in.

### Stateless on purpose

Streamable HTTP without sessions, on the official `@modelcontextprotocol/sdk`.
Each `POST` builds a fresh server and transport and closes both at the end:

```ts
const server = createSteelMcpServer(grant, access, deps)
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
})
await server.connect(transport)
try {
  return await transport.handleRequest(request)
} finally {
  await server.close()
}
```

No session means any app instance can serve any call and there's no
connection state to leak between users. It costs two protocol features,
both written down in the contract (`docs/mcp/README.md`): no
`notifications/tools/list_changed` (the list is recomputed on every
`tools/list`) and no elicitation, since that needs a server-to-client request
mid-call and a server that dies at the end of the `POST` can't receive the
reply. That comes back below, in customer-facing confirmation.

Living inside the app isn't free at the edge, either. Responses may be SSE,
and a buffering or compressing proxy holds events until the end. The runbook
`docs/runbooks/mcp-edge-proxy.md` exists for that: on `/api/mcp`,
`proxy_buffering off`, `gzip off`, a one-hour read timeout, and
`Authorization`, `Host` and `X-Forwarded-Proto` passed through untouched —
without the last one, the OAuth metadata comes out as `http://` and clients
refuse it.

### Identity: a token always has a grant behind it

The provider is `@better-auth/oauth-provider` (Better Auth 1.6's
`oidc-provider` and `mcp` plugins are deprecated). The flow is what an MCP
client expects: authorization code with PKCE `S256`, dynamic client
registration (RFC 7591, unauthenticated — Claude, ChatGPT and Cursor register
themselves), `resource` pointing at `/api/mcp` (RFC 8707), metadata at
`/.well-known/oauth-protected-resource` (RFC 9728) and
`/.well-known/oauth-authorization-server` (RFC 8414), refresh and revocation.

Two choices make revocation work:

- **Opaque tokens**, prefixed `stl_at_` / `stl_rt_` (so secret scanners catch
  leaks) and stored only as SHA-256. One-hour access tokens; 30-day refresh
  tokens, only with `offline_access`. No JWT: every call hits the database.
- **Every authorization goes through the consent screen.** The plugin asks
  for a `referenceId` for the consent, the code and the tokens. Steel makes
  that value the `IntegrationGrant` id, but the plugin only hands the
  callback a user and a session — so the id travels in an `AsyncLocalStorage`:

```ts
const storage = new AsyncLocalStorage<string>()

export const PENDING_GRANT_REFERENCE = 'pending-consent'

export function runWithGrantReference<T>(grantId: string, fn: () => Promise<T>) {
  return storage.run(grantId, fn)
}

export function currentGrantReference(): string {
  return storage.getStore() ?? PENDING_GRANT_REFERENCE
}
```

Outside the call the consent screen makes, the value is `pending-consent`,
which no consent row ever has. So there's no silent re-approval: the plugin
never finds a previous consent and always sends the user to
`/oauth/consent`. No token exists without a grant.

On the other end, `IntegrationGrantService.resolveAccessToken` runs on every
call: prefix → hash → token row (expired or disabled client is 401) → grant
(revoked, other user, other client is 401) → `assertMember` → modules still
enabled in the workspace → scopes held by both the token **and** the grant.
Any failure is `UNAUTHORIZED`; only database errors propagate. That's what
backs the ADR's promise: a removed member or a revoked grant gets 401 **on the
next call**, not at expiry.

### Consent is the decision, not registration

Dynamic registration is open on purpose: it decides nothing. The person
decides, on a pt-BR screen that says who wants to access their Steel, where
they'll land after allowing it, and that the app will act on their behalf
with their permissions. What counts as "who" changed on 2026-10-18 — more on
that under limitations. They pick the **workspace**, the
**modules** (enabled ones only) and the **access level**: read
(`mcp:read`) or read and change (`mcp:read` + `mcp:write`). The LGPD notice
says where the data goes — the AI app's provider — and is versioned
(`mcp-consent-v1`), recorded in the `auth.oauth_consent.granted` audit event
along with scopes and modules.

The accepted grant becomes an `IntegrationGrant` row (user, workspace,
client, destination host, scopes, modules, last use, revocation), unique per
user × client × workspace while active. Users see and revoke theirs under
Settings › Security › **Connected apps**, with the domain next to the app's
name. Workspace OWNERs/ADMINs get the same screen
for every member, with revocation per grant, per member or per app, and
per-app call counts over 7 and 30 days. Revoking, by any path, deletes the
access tokens, revokes the refresh tokens, removes the consent and, in the
same transaction, cancels that grant's pending actions.

### What each token sees

The whole exposure rule lives in `src/lib/mcp/tools.ts`:

```ts
const MCP_WRITE_KINDS: readonly AiToolKind[] = ['CREATE', 'UPDATE', 'ACTION']

export function mcpAllowedKinds(grant, access): readonly AiToolKind[] {
  if (grant.scopes.includes('mcp:write') && access.mcpWriteEnabled === true) {
    return ['READ', ...MCP_WRITE_KINDS]
  }
  return ['READ']
}
```

Writes need the scope **and** the admin's "Allow writes via MCP" switch
(`mcpWriteEnabled`, off by default). `DELETE` is never on the list. Then
the grant's modules filter, and finally the registry's own `hasToolAccess` —
the same module × RBAC check the in-app assistant uses. A tool outside the
grant answers exactly like one that doesn't exist (`-32602`), so a client
can't even probe what the user might have.

Because MCP clients put every listed tool into the model's context, above
**40** exposed tools `tools/list` goes compact: platform tools, every write
(the client decides what to confirm from each write's annotations), and up to
20 reads from the workspace's most-called categories, plus `steel_find_tools`
and `steel_call_tool` to reach the rest. Hiding is a listing decision, not an
access one: calling a hidden tool by its real name works.

### What a call returns

`tools/call` runs `parse` → `execute` with `source: 'mcp'` and the grant's
`actorId`. The result carries the `summary` as text and the data as
`structuredContent`, capped like the assistant (`TOOL_OUTPUT_MAX_BYTES`,
**20,000 bytes**) and flagged `truncated` when cut. Two adjustments exist only
because the model is no longer ours: every `href` starting with a single `/`
becomes `<origin><path>`, since an external client can't resolve app-relative
links; and `AppError` comes back as `isError: true` with a pt-BR message, for
the model to read and correct.

Writes split in two:

- **Not `customerFacing`**: runs at once, like Autopilot.
  `structuredContent = { status: 'executed', actionId, ... }`, with an
  `AiActionLog` of source `MCP` and the app's `clientId`.
- **`customerFacing`** (the 5 tools that reach an end customer: reply to the
  requester, send WhatsApp, request approval, change phase, cancel a ticket):
  becomes a 30-minute `AiPendingAction` and returns
  `status: 'pending_confirmation'` with a `confirmUrl` into Steel's inbox.
  That link is the answer to the elicitation a stateless transport can't do:
  it works in any client, and confirmation goes through the same route as
  the in-app chat.

Every write takes an optional `idempotencyKey`, which the adapter adds to
the `inputSchema` and strips before `parse` — the tool never sees it. In
Redis: a `SET NX` marker for 2 minutes, then the result kept for 24 h with a
hash of the arguments. Same key and arguments return the first result; a
call still running is `409`; same key, different arguments is `422`; a
failure frees the key. A client that lost a response to a timeout can retry
without creating two leads.

### Observability without payloads

Every call writes one `mcp.tool_call` line to Axiom — tool, kind, module,
workspace, user, client, outcome, error code, duration — and **never**
arguments, results or user text. Rejections log as `mcp.rejected` with a
reason (`invalid_token`, `stale_grant`, `rate_limited_user`,
`rate_limited_client`, `access_failed`). An exception inside a tool is caught
before the registry flattens it into a generic `INTERNAL_SERVER_ERROR` and
goes to Sentry with tags only. A ready dashboard
(`docs/mcp/axiom-dashboard.json`) and an incident runbook cover "which client
is doing this and how do I cut it off". `pnpm mcp:smoke --oauth` walks a real
client's path: dynamic registration, login, consent, code exchange,
`initialize`, `tools/list`, three reads, resources, prompts, and revocation
at the end.

## Results

What the adapter exposes, counted from the registry on `origin/main` today
(98 tools: 44 read, 44 write, 10 delete), for a user with access to all three
modules:

| Grant | Tools exposed | In `tools/list` (compact) | Deletes |
|---|---|---|---|
| `mcp:read` | 44 | 29 (27 + 2 meta-tools) | 0 |
| `mcp:write` + admin switch | 88 | 73 (71 + 2 meta-tools) | 0 |
| `mcp:write`, switch off | 44 | 29 | 0 |

Of the 44 writes, the **5** `customerFacing` ones never run over MCP without a
click inside Steel. No tool was written for MCP: all 88 are the in-app
assistant's, with the same `parse` and `execute`.

The comparison I wanted is between the two halves of the work. As a rough
proxy — lines don't measure difficulty — the protocol side (route,
`server.ts`, `tools.ts`, `discovery.ts`, `resources.ts`, `prompts.ts`,
`http.ts`) adds up to **1,497 lines**. The identity side (OAuth config and
gateway, grant, consent, Connected apps routes and screens, grant and OAuth
client services and repositories) adds up to **2,938** at `2026.10.18.4` —
it was 2,575 before the consent-screen fix, and all 363 extra lines landed
on the identity side; the protocol side didn't move. The 2026-10-17 wave has **26
dedicated test files**, unit through e2e against Postgres, and many of the
cases are about identity: expired token, another client's grant, removed
member, bulk revocation, a scope the token has and the grant doesn't.

Per git, the MCP contract landed at 17:04 on 2026-10-17 and the write wave
(`feat/mcp-governance`) merged at 21:59 the same day. That was only possible
because the registry, RBAC, pending actions and audit already existed; MCP
only added a source (`AiActionSource.MCP`) and a column
(`integrationGrantId`) to them.

The server was tested end to end by me and by two customer companies with
their own workspace and subscription. I have no usage numbers to show — how
many grants exist, which tools get called most, p95 latency. The dashboard
exists; the usage that would justify publishing a number doesn't yet.

## Where it broke / limitations

**The descriptions were written for our own prompt.** MCP inherits the whole
registry, text included. Each tool's `title` is its Steel AI `label`, in the
progressive form — "Consultando chamados" — meant for the chat's progress
indicator. In a connector directory it shows up as the tool's name. Commit
`947a1cd2` rewrote descriptions to be neutral, and `validateToolRegistry` now
fails the boot if a write doesn't declare `destructiveHint`, but the root
cause stands: one text serves two audiences, and a new tool written with the
chat in mind reaches MCP in the same deploy. The directory checklist
(`docs/mcp/directory-submission.md`) still lists an MCP-specific `title` as
pending.

**Found and fixed: the consent screen showed the name the client
declared.** Registration is open and unauthenticated, as MCP clients
require, and `client_name` comes from the client itself. Until 2026-10-18 the
screen said "<name> wants to access your Steel" and never showed the
`redirect_uri` domain — where the authorization code actually goes. Anyone
could register a client called "Claude" with their own `redirect_uri` and
send the victim the link: consent phishing. Scope, workspace and modules
were still the person's explicit choice, but the "who" of that choice was
self-declared. On top of that, the page read the signed query without
checking the signature, so a tampered link rendered fine and only failed on
"Permitir". The root cause is that the design put the whole decision on
consent — and consent is only as good as what it shows.

The fix ([steel-so/steel#129](https://github.com/steel-so/steel/pull/129),
recorded as an 18/10/2026 update to ADR 0033) changes the identity on
screen: the app is now identified by the **`redirect_uri` host**, read
server-side from the signed query, which the provider had already matched
against the registered URIs. The page verifies the signature before
rendering, so a tampered link never opens the screen. A short list in
`src/lib/mcp/client-trust.ts` marks only Claude, ChatGPT and Cursor as
"Verificado", recognized by domain and never by name. Anything else shows up
as "Um app em **<domain>** quer acessar o seu Steel" ("An app at <domain>
wants to access your Steel"), with an "App não verificado: Ele diz chamar-se
“…”" warning ("Unverified app: it says it's called “…”"). An app with a
local redirect shows up as "um app no seu computador" ("an app on your
computer"), because the code never leaves the person's machine. The host is
stored on the grant and in the audit event, and Connected apps shows the
domain next to the name. It shipped to staging on 2026-10-18 in
`2026.10.18.4`, and I checked it there. Grants made before the fix have no
host until their next authorization: the original `redirect_uri` was never
stored.

It's this post's thesis applied to the post itself: the protocol was fine
all along, and the hole was in who the screen said was on the other end.

**Third-party text reaches a model Steel doesn't control.** Tools return
WhatsApp messages, e-mails and ticket descriptions written by people outside
the workspace. Inside Steel AI, the prompt and defenses are ours; in an MCP
client, they aren't. With `mcp:write`, a prompt injected into a ticket can
create or change records with the authorizing user's permissions. That's why
`DELETE` stayed out and customer-facing actions need confirmation — which
limits the damage without preventing it. The rest is a recorded product
decision: MCP writes exist only if an admin turns them on.

**Opaque costs queries.** Opaque tokens resolved in the database on every
call are what makes revocation bite on the next call. The price is a lookup
for the token, the grant, the membership and the modules on every call,
before the tool runs. I haven't measured that cost in isolation. I chose
immediate revocation over latency without having the latency number, and
that needs measuring before someone asks.

**Per-app usage isn't billing-grade.** The per-app call count in Connected
apps is a Redis hash per workspace per day with a 32-day TTL. Lose Redis and
the window resets. Fine for an indicator, useless for invoicing — and ADR
0032 left the plan question open: MCP is on every plan and outside the AI
quota "for now", to be revisited "once usage is measured". With no measured
usage, the question stays open.

**Not in the directories yet.** Submission to the Claude and ChatGPT
connector directories waits for production: reviewers test the public URL,
the review account and the legal pages on the final domain. Every blocking
item on the checklist is still unchecked.

## What this proves, and what it doesn't

It proves that when a product already has a tool registry with validation,
RBAC and a server-guarded write path, an MCP server can be a thin adapter —
no new tools, no new service — and that the real work moves to identity: a
token that always points to an explicit grant, resolved on every call,
revocable by whoever granted it and whoever administers the workspace. It
also proves that a stateless transport forces confirmation down another path,
and that a link back into the product is one that works in any client.

It doesn't prove consent gets read carefully. The screen now shows where
the code goes and only calls three domains "Verificado", but it can't tell
whether an unknown domain is trustworthy — that call is still the person's. It doesn't prove the descriptions serve third-party
models well. It says nothing about latency or real usage, because those
numbers don't exist yet. And it doesn't make the write step safe: that is
still an explicit, traced human decision, not a guarantee.
