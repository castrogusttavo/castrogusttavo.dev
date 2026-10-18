---
title: A layout is not a gate — the redirect that didn't stop the rest of the page from rendering
description: "Nexo's consent gate lived in a layout, under a comment saying not to remove or weaken it. It redirected correctly, and an unconsented member still got the workspace id and their own id in the RSC payload: in the App Router, the layouts of a path render in parallel, and a redirect in the top one doesn't cancel the ones below. This is the leak, the test helper that hid its path, swapping the gate for a Data Access Layer next to the data, and what that unlocked: the whole signed-in app as a partial prerender."
icon: bug
date: "2026-11-03"
---

The root layout of Nexo's private area had this comment above its consent
check:

```tsx
// SECURITY GATE (STR-61 ) - do not remove or weaken.
// Every authenticated path under (private) requires accepted Terms + Policy.
const consent = await requireConsent(session.value.user.id, 'page:(private)')
if (!consent.ok) redirect('/onboarding/consent-setup')

return <>{children}</>
```

STR-61 is the rule that nobody sees anything in the app before accepting
the terms of use and the privacy policy — the part of Brazil's LGPD that
turns into code. And the gate worked, as far as you could see: an
unconsented member opened the workspace and the browser landed on
`/onboarding/consent-setup`. No visible symptom.

What was wrong only showed up when I wrote a test that doesn't look at the
browser, it looks at the response body. For an unconsented member, the HTML
of `/<slug>` had both things at once (ids replaced here):

```text
NEXT_REDIRECT;replace;/onboarding/consent-setup;307
["$","$L40b",null,{"workspaceId":"<workspace id>","base":"/<slug>","userId":"<user id>","isPrivileged":false}]
```

The first line is the gate firing. The second is the layout below it
rendering anyway and sending props to the client.

## The problem: a layout doesn't decide whether the rest of the route renders

In the App Router, the layouts and the page of a path **render in
parallel** — the Next 16 data fetching guide says so in those words
("layouts and pages are rendered in parallel"), as a feature: every segment
starts fetching its data as early as possible. The side effect is in the
authentication guide, under "Layouts and auth checks":

> A layout also does not control whether the rest of the route renders.
> Route segments and parallel route slots are rendered by the router, so a
> layout that hides or swaps them does not stop them from running or from
> appearing in the RSC Payload.

So the `redirect()` in `(private)/layout.tsx` stopped that layout, not its
siblings. `(home)/layout.tsx`, two levels down, resolved session and
membership on its own — without checking consent — and handed
`workspaceId`, `userId` and `isPrivileged` to `SidebarProjects`, a client
component. Client component props travel in the RSC payload. The redirect
arrived alongside them.

To size the damage precisely: only ids leaked. The sidebar fetches the
project list itself from the API, and the API routes already had their own
consent gate (the same `requireConsent`). And whoever received those ids
was a member of that workspace — their own id and the id of a workspace
they belong to. Not a cross-tenant leak. A breach of the rule the comment
promised to enforce: nothing renders before consent. The code sending the
`workspaceId` from that layout has been in the repository since June 19;
the `userId` joined on October 13.

The layout's comment had sensed the problem from the wrong side, too. It
asked not to wrap the gate in `<Suspense>` "because the page would render
before the check finishes". The page was already rendering.

## Why no test caught it

Nexo has had API e2e tests for months, and the consent gate had tests.
What no test did was send the cookie the way a browser does.

The `createAuthenticatedUser` helper returned the raw `Set-Cookie` header
from the sign-in response, and tests sent it back as `Cookie`. A raw
`Set-Cookie` joins cookies with `", "` and carries attributes (`Path`,
`HttpOnly`, `Max-Age`). The server read `session_token` fine and folded the
rest into an attribute name — `better-auth.session_data`, Better Auth's
signed cookie cache, included. Every e2e read the session from the
database, and none exercised the path that depended on the cookie cache.

The fix was for the helper to also return what a browser would send:

```ts
// The Cookie header a browser would send: name=value pairs only. `cookie`
// (the raw Set-Cookie header) joins cookies with ", " and keeps their
// attributes, so a server reads the session token and folds the rest into
// attribute names: better-auth's session cache never arrives with it.
function toCookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(';')[0])
    .join('; ')
}
```

Plus a `withoutSessionCache(browserCookie)` for the other case: a missing
or expired cookie cache, which is the normal state every 5 minutes.

## The idea: the check lives next to the data

The same Next guide says where the check belongs: close to the data
source, in a Data Access Layer. If every function that reads workspace data
checks session, consent and membership before reading, it doesn't matter
how many layouts render in parallel — none of them can read without going
through the check.

That splits the job into two roles the layout used to blur:

- **Proxy, optimistic.** Reads the signed cookie cache, no database, and
  sends anyone who clearly hasn't consented to the consent step early. It's
  UX: it avoids rendering a page that's about to redirect.
- **DAL, definitive.** Runs on every read, hits the database, and is the
  only thing that can actually deny access.

And the layout stops being a gate. In the [post on three-layer
authorization](/en/writing/three-layer-authorization) I described the proxy as an
edge gate that only checks for a cookie, with the real decision in the
service. What this bug showed is that there was an informal fourth "layer"
— the layout — that rendering trusted and that held nothing.

## How it works

### The DAL

`src/lib/dal.ts` has three functions: `getCurrentUser`,
`requireConsentedUser` and `requireMembership`. All three are
`'use cache: private'`:

```ts
export async function requireMembership(
  slug: string,
): Promise<{ user: CurrentUser; membership: MembershipDTO }> {
  'use cache: private'
  cacheLife(SHELL_STALE) // { stale: 300 }

  const user = await readUser()
  const consent = await requireConsent(user.id, `page:workspace:${slug}`)
  if (!consent.ok) redirect('/onboarding/consent-setup')

  const membership = await MembershipService.getByUserAndSlug(user.id, slug)
  if (membership.ok && membership.value) {
    return { user, membership: membership.value }
  }
  // ...onboarding, /create-workspace or notFound()
}
```

`use cache: private` stores nothing on the server: the function runs again
on every request. The browser's router is what keeps the result, for the
configured `stale`. And 300 seconds isn't arbitrary: Next's docs require at
least 30 seconds for per-link prefetching and **at least 5 minutes** for
the content to join the route's App Shell. That number is what makes an
access check compatible with instant navigation.

I considered caching membership on the server too and didn't. Nexo has no
member removal or role change today, and a server cache that someone
forgets to invalidate once that exists would keep a removed member in. A
database hit on every check is the price.

With the DAL in place, `(home)/layout` became:

```tsx
const { user, membership } = await requireMembership(slug)
```

instead of resolving session and membership by hand. Workspace pages and
the project and wiki contexts went the same way. A page with no server
data of its own (a client form, like create-workspace) gets a
`ConsentGate`: a server component that calls `requireConsentedUser` and
renders `null`, inside `<Suspense>`.

### The proxy

The proxy gained an optimistic check, on page GETs only:

```ts
if (
  request.method === 'GET' &&
  !pathname.startsWith('/api/') &&
  !pathname.startsWith('/onboarding') &&
  !request.headers.has('next-action')
) {
  const isSecure = request.cookies.has('__Secure-better-auth.session_token')
  if ((await readCookieConsent(request, isSecure)) === 'missing') {
    return NextResponse.redirect(
      new URL('/onboarding/consent-setup', request.url)
    )
  }
}
```

Server actions (POST) are skipped because they can't follow a redirect,
and the API because its routes enforce consent themselves.

The original plan was bigger: the proxy would also send invalid sessions to
`/sign-in`, without touching the database. It couldn't, and the reason is
in Better Auth 1.7.5's code: `getCookieCache` returns `null` when the HMAC
signature doesn't match **and** when the cookie simply expired. A tampered
cookie and one that's 5 minutes and 1 second old are indistinguishable
through that API. Redirecting on `null` would send every legitimate user to
sign-in every 5 minutes. So the result has three states, and only one
blocks:

```ts
// `unknown` covers no cache, an expired one (every 5 min, the normal case) and
// a tampered on alike: getCookieCache returns null for all three, so none of
// them is a reason to block.
export type CookieConsent = 'consented' | 'missing' | 'unknown'
```

The cookie cache brought a problem of its own: after accepting the terms,
the cookie still said "no consent" for up to 5 minutes, and the proxy would
bounce the user straight back. The consent action deletes `session_data` —
without the `nextCookies` plugin Better Auth can't refresh a cookie inside
a server action — and the next session read reissues it from the database.
For consent given on another device, a client `ConsentRefresh` asks for the
session with `disableCookieCache` and leaves with a full navigation, so no
router cache replays the stale answer.

### The bypass test

`app/(private)/__tests__/access.e2e.test.ts` requests **9 workspace
pages** — home, projects, archives, wiki, members, billing, a project's
issues, project settings and labels — as four visitors who shouldn't see
them:

| Visitor | Expected |
| --- | --- |
| Anonymous | 307 to `/sign-in` |
| Signed in, not a member | 404 |
| Unconsented member, with cookie cache | 307 from the proxy to `/onboarding/consent-setup` |
| Unconsented member, without cookie cache | redirect to consent, issued by the DAL |

In every case the body must not contain the workspace id or the name of a
project seeded just for this. That last check is what caught the leak: the
test landed in one commit and the fix in the next, 4 seconds later,
because the right order was to prove the hole before touching the gates.

### Removing the gate, and what it unlocked

Only with every read going through the DAL and the test green did
`(private)/layout.tsx` get deleted. Until then, the whole signed-in app
blocked by my own decision: on September 28 I'd declared `instant = false`
on that tree, with the reasoning in the commit — "making those routes
genuinely instant means a cached shell with the per-user parts behind
skeletons, which is a UX change, not a bug fix".

With no gate in the layout, that UX change became possible:

- The workspace layout renders its frame at once; header, sidebar and
  trial banner wait in their own `<Suspense>`.
- The home, settings, project settings and wiki sidebars, and the project
  tabs, stream beside the page with a same-size skeleton.
- Every workspace page shows breadcrumb and title immediately and reads its
  data inside a `<Suspense>` with a `PageSkeleton`. At build time every
  workspace route becomes a partial prerender.
- `app/loading.tsx` shows the animated Nexo mark (`NexoMarkLoader`), its
  two pieces lighting up in turn, still under `prefers-reduced-motion`.
- `validationLevel: 'manual-warning'` left `next.config.ts`: Next validates
  instant navigation on every page again.

## Results

| | Layout gate | DAL + optimistic proxy |
| --- | --- | --- |
| Unconsented member, no cookie cache | redirect **and** ids in the payload | redirect, no ids in the body |
| Where STR-61 is enforced at render | 1 layout | every workspace data read |
| Pages validated as instant (`instant = true`) | only those that opted in | **32** |
| Segments that block on purpose (`instant = false`) | the whole private tree | **7** (6 pages and the admin layout) |

In local validation I swept the routes with a test user counting
`Error: Route` in the `next dev` log (Cache Components' warning for a route
that blocks without declaring it): **0** across 33 private routes, 33
public and 6 onboarding. That figure comes from my validation notes, not a
CI job — what CI guarantees is the access test and Next's validation, which
now runs on every page.

The number this post **doesn't** have is latency. I didn't measure
signed-in navigation before and after; the load test for that profile
needs a deploy and hasn't run. "Instant" here means what Next validates —
the route has a shell ready to show immediately — not a p95.

## Where it broke / limitations

**Revocation takes up to 5 minutes to reach an open tab.** That's the
direct cost of `stale: 300`. The server and API routes see a revoked
session or withdrawn consent at once; a tab already holding the shell in
its router keeps showing authenticated content until the cache expires.
It's exactly the price of joining the App Shell, and I accepted it because
every mutation still goes through the API.

**A redirect after the shell is no longer a 307.** When the check runs
inside `<Suspense>`, the HTTP status has already gone out as 200 before it
finishes. The redirect becomes a meta refresh mid-HTML, and a 404 becomes a
200 with `NEXT_HTTP_ERROR_FALLBACK;404` in the body — that's why the access
test accepts both forms. For a user nothing changes; for a monitor reading
status codes, a missing workspace looks like it exists. It's also why the
public pages whose content is the record itself (`/careers/[slug]`,
`/status/incident/[id]`, `/blog/[slug]`) keep `instant = false`: an unknown
id must answer a real 404. The admin area and the `projects/[slug]`
redirect stayed blocking too.

**Reading the clock after a private cache.** The trial banner read
`Date.now()` after `requireMembership`. Since membership is a private
cache, that code lands in the prefetched shell, where Next refuses clock
reads — and every workspace route reported it. Deciding "is the trial in
its last days?" moved to the browser, in a client `HeaderTrialBanner`. The
side effect: the trial end date now reaches the client whenever there's a
trial without a subscription, not only in its last days. It isn't sensitive
for a member, but it's more data in the payload than before.

**`use cache` is per instance.** Production runs five app instances behind
nginx, and the default `'use cache'` store lives in each one. An
`updateTag` in a mutation clears only the instance that served the request.
That's why `/careers` streams instead of caching — the "cache the openings
list" path exists and I didn't take it.

**The proxy can't say "invalid session".** For the `getCookieCache` reason
above, the proxy redirects exactly one case: a valid cookie without
consent. Everything else falls to the DAL. Not a security gap — the DAL is
the gate — but the optimistic check ended up smaller than I planned.

**The access test's page list is maintained by hand.** The 9 pages are
written in the file. A new private page nobody adds there isn't checked
from outside. Same weakness as the proxy's `PUBLIC_ROUTES`: discipline, not
types.

And a note for anyone checking the history: the deletion of
`(private)/layout.tsx` landed inside commit `7db5f436`, whose title is
about a form test timeout. The file's `git log` leads there; the actual
change is described in `bad53505`, right after.

## What this proves, and what it doesn't

It proves that an authorization gate in an App Router layout is weaker
than it looks: it redirects, the browser obeys, and the rest of the route
renders anyway. And it proves the only way to see it is to read the
response body, not the browser's behavior — and to send the cookie the way
a browser sends it.

It proves that moving the check next to the data is what unlocks the
instant shell: with no blocking gate at the top, each piece of the page can
wait only for what it needs.

It doesn't prove the app got faster in numbers — I didn't measure. It
doesn't prove every private page is covered by the access test, only the 9
on the list. And it doesn't prove there's no other layout reading data
outside the DAL: today that rule is a documented convention plus a sampled
test, not something the compiler prevents.
