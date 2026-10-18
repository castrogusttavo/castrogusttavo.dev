---
title: AI agent autonomy isn't a boolean — a spectrum with one lock fewer per step
description: "\"Can the AI write?\" is the wrong question. In Steel, each Steel AI mode — Ask, Test, Build, Autopilot, Steel Agents and the MCP server — removes exactly one lock from the previous one and says what replaces it. This is the whole spectrum, what an injected prompt can do at each step, and where the design still leaks."
icon: idea
date: "2026-11-12"
---

Between 2026-10-06 and 2026-10-17, Steel AI gained six different ways of
letting an AI touch a workspace's data. Each came from a concrete product
owner request, and each has an ADR. Read together, they aren't a feature
list — none of them answers "can the AI write, yes or no?". They all answer
a narrower question: **which lock does this mode remove, and what takes its
place?**

Steel is Stratus Telecom's multi-tenant platform — ServiceDesk ITIL 4, CRM,
Communication/WhatsApp, and Steel AI on top of all three. I'm a Lead Software Engineer at Stratus Telecom: I built the first version of Steel and now lead its technical modernization. The decisions below are in ADRs 0018–0023, 0032 and 0033 of
the public repository, all signed "deciders: product owner + engineering
team".

## The problem: "autonomy" as a single switch

The naive model of agent autonomy is a switch: the AI either reads or acts.
It breaks at both ends. Read-only, the assistant is an expensive search box.
Acting, everything the model reads becomes a write vector: Steel AI reads
WhatsApp messages, e-mails and ticket descriptions written by people outside
the workspace, and a prompt injected there has exactly the write power of
the user in the conversation.

The common middle ground is a lock in the prompt ("ask before acting").
Steel had that — a `userConfirmed: true` the model filled in itself — and
ADR 0018 tore it down. I covered that in depth in [Confirming an AI write
belongs on the server](/en/writing/ai-write-confirmation-belongs-on-the-server):
every write becomes an `AiPendingAction` with a preview, executed only by a
human click on a route the model can't reach, with everything re-checked on
the server. That mechanism underpins most of the steps below; here I only
cover where each mode uses it, bends it, or switches it off.

## The idea: each step removes one lock and names its replacement

One tool registry (`STEEL_AI_TOOLS`, **98 tools** today, 44 of them reads)
serves every mode. What changes between modes isn't the tool — it's who
decides whether a write runs, and on whose behalf. The rule I take from the
six ADRs: **a new mode gets in only if it says which lock it removes and
what replaces it.** If the answer is "nothing", the mode isn't more
autonomous, just more dangerous.

## The spectrum, step by step

### Ask — reads only

`EXPLORE` in the API. The filter that runs before the model
(`isToolAllowed`) simply never offers a write tool:

```ts
if (tool.kind !== 'READ') {
  if (!isWriteMode(mode)) return false
  // TEST never writes, so the agent-mode kill switch does not apply.
  if (mode !== 'TEST' && !access.agentModeEnabled) return false
  if (mode === 'AUTOPILOT' && !access.autopilotEnabled) return false
}
return hasToolAccess(tool, access)
```

Nothing to lock, because nothing is offered.

### Test — real reads, writes simulated on the server

`TEST` (ADR 0023). Removes the "don't offer writes" lock: the model sees the
write tools and calls them as it would for real. In its place, a diversion
in the execution path — every write goes to `simulateWriteTool`, which runs
`parse` → `preview` and stops; `execute` is never called. The prompt
explains this to the model, but as the ADR puts it, the prompt explains, it
doesn't protect. Since nothing is written, Test doesn't depend on the
agent-mode switch.

### Build — writes proposed, a human confirms

`AGENT` (ADR 0018). Removes "writes are simulated". In its place,
server-side human confirmation: a pending action valid for 30 minutes,
double confirmation for deletes, and a click that re-checks owner, status,
expiry, mode, module and RBAC. Admins can turn the mode off for the whole
workspace (`agentModeEnabled`).

### Autopilot — runs immediately

`AUTOPILOT` (ADR 0021, 2026-10-07). Removes "a human clicks on every write"
— **deletes and customer messages included**, by explicit product owner
decision ("does everything on its own"). What replaces it isn't another
per-write check; it's a workspace decision plus a trail:

- it only exists if an admin turns on `autopilotEnabled` (off by default),
  and it also requires `agentModeEnabled`; asking for it while off returns
  `AI_AUTOPILOT_DISABLED`;
- the write still becomes an `AiPendingAction`, but **born claimed**
  (`status = EXECUTED`, `autoExecuted = true`) — never `PENDING`, never
  expires — through the same execution path as Build, minus the click;
- audit action `auto_execute`, `AiActionLog` with the user as actor;
- the turn doesn't stop after a write: the model gets the result and chains
  the next step, up to **8 rounds** (`STEEL_AI_MAX_TOOL_ROUNDS`).

```ts
const created = await proposeWriteTool(tool, ctx, rawArgs,
  { ...origin, claimedBy: ctx.actorId }, now)
if (!created.ok) return created

const claimed = await runClaimed(created.value, tool, {
  ctx,
  deciderId: ctx.actorId,
  autoMode: 'AUTOPILOT',
})
```

The ADR states the cost bluntly: a prompt injected into data the model reads
**can execute a write with the user's permissions**. Hence default off, an
admin switch and a full trail. Undo is manual.

### Steel Agents — per-tool autonomy, on someone's behalf

Autonomous agents (ADR 0020, 2026-10-06) have nobody chatting with them —
they run on a schedule or an event. Confirming everything makes them
useless; confirming nothing hands the database to an injected prompt. So
the lock was split into smaller ones.

**Identity.** The agent runs as its owner (`SteelAgent.ownerId`). The tools
offered to the model are the **intersection** of the agent's list and what
the owner can use:

```ts
const allowedNames = new Set(agent.tools.map((t) => t.toolName))
const tools = availableTools(
  access.value,
  run.isTest ? 'TEST' : 'AGENT',
).filter((tool) => allowedNames.has(tool.name))
```

**`AUTO` or `APPROVAL`, per tool**, default `APPROVAL`. `AUTO` writes run
directly and land in `ai_action_logs` (`source = AGENT`). `APPROVAL` writes
become an `AiPendingAction` valid for **72 h**, and the run pauses on
`WAITING_APPROVAL` with the full model conversation stored in
`SteelAgentRun.state`. Approval arrives through the inbox; the owner or
someone with `steel-agents` EDIT decides, on a dedicated route — the
assistant's confirm route refuses agent actions.

**Deletes always need approval, in three layers**: the editor locks the
toggle, the service stores `APPROVAL` for `DELETE` tools, and the runner
treats `DELETE` as approval even if the database says `AUTO`:

```ts
export function effectiveToolMode(
  kind: AiToolKind | undefined,
  mode: SteelAgentToolMode,
): SteelAgentToolMode {
  if (kind === 'DELETE') return 'APPROVAL'
  return mode
}
```

**Kill switches.** A run ends `SKIPPED`, with the reason, when the agent is
paused, has no owner, the owner left the workspace, the workspace is
suspended, Steel AI or Steel Agents are off, agent mode is off and the agent
has a write tool, the monthly run cap is hit, or the AI quota ran out.

**No event loops.** An agent's write runs inside an `AsyncLocalStorage`
context, and the event dispatcher checks it before triggering any agent:

```ts
const origin = currentSteelAgentContext()
if (origin) {
  logger.info('steel_agents.event_ignored_from_agent', /* ... */)
  return 0
}
```

Otherwise an agent that opens a ticket on "ticket opened" would call itself
forever.

**Single-attempt queue.** The `steel-agents` queue runs with `attempts: 1`.
It looks like an oversight until you read the ADR: a retry could duplicate
an automatic write. A run that fails midway stays failed.

### MCP — the same registry, for a model that isn't ours

The latest step (ADRs 0032 and 0033, 2026-10-17) exposes Steel to Claude,
ChatGPT, Cursor and other AI clients. The ADR counts **731 REST routes**,
621 of them under `/workspaces/{id}`, built for the app's UI; one MCP tool
per route would leave the model juggling IDs, pagination and filters.
Instead, `/api/mcp` is an adapter over the same Steel AI registry — same
tools, same `parse`, `preview` and `execute`, minus the 10 deletes.

The lock changes, because now neither the model nor the client is Steel's:

- **Identity:** Steel's own OAuth 2.1. Each grant (`IntegrationGrant`) is
  bound to **one user × one workspace × scopes × modules**, chosen by the
  user on the consent screen — never from a tool argument. A removed member
  or revoked grant gets 401 on the next call.
- **Writes:** only with the `mcp:write` scope **and** an admin turning on
  "Allow writes via MCP" (off by default). Consent plays the role of
  per-write confirmation, as in Autopilot — ordinary `CREATE`, `UPDATE` and
  `ACTION` run immediately, with an optional `idempotencyKey` for retries.
- **`DELETE` is never exposed**, whatever the scopes.
- **Customer-facing actions** (tools marked `customerFacing`, like replying
  to a requester or sending WhatsApp) go back to a 30-minute
  `AiPendingAction`, and the tool returns a link for the person to confirm
  inside Steel.

```ts
export function isMcpToolExposed(tool, grant, access): boolean {
  if (!access.aiEnabled) return false
  // DELETE is never exposed over MCP, whatever the scopes.
  if (tool.kind === 'DELETE') return false
  if (!mcpAllowedKinds(grant, access).includes(tool.kind)) return false
  if (tool.module && !grant.modules.includes(tool.module)) return false
  return hasToolAccess(tool, access)
}
```

One cost detail: MCP clients put every listed tool in the model's context.
Above **40** exposed tools, `tools/list` goes compact — platform tools,
every write, and up to 20 reads from the workspace's most-used categories —
and two meta-tools, `steel_find_tools` and `steel_call_tool`, reach the
rest. Writes are never hidden behind the generic tool: clients decide what
to confirm from each write's own annotations.

### Memory — the one write that skips confirmation

One write fits no step: `memory_save` and `memory_forget` (ADR 0022) run
immediately in every mode, Ask included. The argument is that memory is the
assistant's metadata, not business data, and memory that asks for
confirmation stops being automatic. In place of the lock: the tools live
outside `STEEL_AI_TOOLS` (agents and MCP don't get them), workspace facts
need OWNER/ADMIN, a server-side guard (`memory-guard.ts`) refuses
credentials, documents and LGPD-sensitive data, and every save shows up in
the chat as a "Memory saved" chip with **Undo**. In Test mode, even memory
is simulated.

## Results: the spectrum in one table

| Mode | Who decides each write | What an injected prompt can do | Trail |
|---|---|---|---|
| Ask | nobody — no writes | sway the answer text | conversation history |
| Test | nobody — simulated | produce a simulated card | `AiActionLog` `outcome = simulated` |
| Build | the user, click by click | propose; the user sees the preview | `AiPendingAction` + `AiActionLog` + `confirm` audit |
| Autopilot | the admin, once per workspace | write with the user's permissions, deletes and customer messages included | `AiPendingAction` `autoExecuted` + `AiActionLog` + `auto_execute` audit |
| Steel Agents | the admin per tool; a human in the inbox for `APPROVAL` and every delete | use the `AUTO` tools allowed, with the owner's permissions | run steps + `AiActionLog` (`source = AGENT`) + audit |
| MCP | the user at consent + the admin's switch; a human in Steel for `customerFacing` | write (not delete) with the user's permissions if `mcp:write`; only propose customer actions | `AiActionLog` (`source = MCP`, OAuth client) + audit + a log of every MCP call |
| Memory | nobody — runs immediately | save a **personal** fact (workspace facts need an admin), filtered by the guard and visible with undo | chip + Memory tab + `ai_memory` audit (no content) |

Read top to bottom, the middle column is the point: the possible damage
grows step by step, and at no step is it unowned. Every row from Build down
has a human decision somewhere — per write, per workspace, per tool, or per
grant.

I have no usage numbers to put next to it — how many workspaces turned
Autopilot on, how many approvals expire in the inbox. What's countable today
is the registry: 98 tools, 54 writes, 10 deletes (never exposed over MCP,
always approved for agents) and 5 marked `customerFacing` (always sent back
to confirmation over MCP).

## Where it breaks / limitations

**Autopilot is per workspace, not per person.** Once an admin turns on
`autopilotEnabled`, any member with agent mode can use it, with their own
permissions. You can't enable it only for heavy users, exclude some tools,
or keep confirmation for deletes only. The root cause is that the decision
was modeled as workspace configuration (`WorkspaceAiSettings`), not a
person's; ADR 0021 lists all three variations as "revisit if requested".

**There's no batch approval.** An agent asking approval for twenty actions
produces twenty inbox decisions, one by one, and the run only resumes when
nothing is pending — it can sit in `WAITING_APPROVAL` for days. ADRs 0018
and 0020 leave batching as an explicit open item. And too many approvals end
up where Build with too many cards does: people approving without reading.

**Tools vanish from agents silently.** Because an agent gets the
intersection of its list and its owner's access, if the owner loses a
permission, the tools that needed it disappear on the next run — and the
agent editor says nothing. The admin finds out by reading run steps. That's
the downside of computing the intersection at run time instead of
validating at configuration time; ADR 0020 records revisiting it with an
editor alert.

**Descriptions written for our prompt now serve third-party models.** MCP
inherits the whole registry, including the text that explains each tool to
the model — text born for Steel AI's own system prompt, which knows there's
a screen, a card, a chat. A launch-day commit (`947a1cd2`) rewrote the
descriptions to be neutral and the contract now requires it, but the root
cause stands: one text serves two audiences, and a new tool written with the
chat in mind ships to MCP in the same deploy. On top of that, third-party
text the tools return (WhatsApp, e-mail, tickets) reaches the client's
model, where Steel controls neither the prompt nor its defenses — which is
why `DELETE` stayed out and customer actions require confirmation.

**There's no "Autopilot with a net".** Between "one click per write" and "no
clicks" the in-app assistant has no middle step today (say, confirm only
what has `destructiveHint` or is `customerFacing`). MCP already splits on
`customerFacing`; the in-app assistant doesn't.

## What this proves, and what it doesn't

It proves agent autonomy can be designed as a sequence of explicit
trade-offs — each mode removes one lock and names its replacement — on top
of a single tool registry and a single execution path, without every mode
becoming its own system. And it proves you can state, mode by mode, the
worst case for an injected prompt, because that worst case is written in the
ADRs rather than inferred afterwards.

It doesn't prove the upper steps are safe. Autopilot and MCP with
`mcp:write` accept, by product decision, that an injected prompt can write
with the user's permissions; what they guarantee is a trail and an explicit
human decision to turn them on, not prevention. It doesn't prove admins pick
well between `AUTO` and `APPROVAL`, or that inbox approvals get read. And
without usage data, it says nothing about which step people actually use.
