---
title: My CSP post was wrong — production was running with no middleware at all
description: "On August 29 I wrote that Nexo's script-src was locked down with a per-request nonce and strict-dynamic, zero unsafe-inline. On September 20 the first browser suite running the production artifact showed the deployed image never had the middleware: .dockerignore was silently dropping proxy.ts. And turning the middleware back on broke hydration, because a per-request nonce can't live in a prerendered shell. This is the correction: what was wrong, why I didn't see it, what replaced it, and what now stops it from happening again."
icon: bug
date: "2026-10-20"
---

On August 29 I published a post about Nexo's layered defenses, and wrote
this about the CSP:

> `script-src`, on the other hand, gets no exception at all: per-request
> nonce, `strict-dynamic`, zero `unsafe-inline`.

That sentence was wrong twice. First, production had no `script-src`,
because it had no CSP at all: the deployed image didn't contain the
middleware that sets the header. Second, and worse: had the middleware
been there with that CSP, the site wouldn't have worked.

This is the correction. The old post stays up, with a note at the top
pointing here.

## What I described, and what was actually being served

The code I quoted was real. It landed in `proxy.ts` on March 16
(`36221827`):

```ts
function buildCspHeader(nonce: string): string {
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
```

A fresh nonce per request, forwarded in an `x-nonce` header. On paper,
it's what Next's CSP guide recommends. I read the code, it made sense,
and I wrote about the code.

Production was serving something else. On September 20, while I was
building the first Playwright suite that runs the production artifact in
a real Chromium, comparing it against `nexopm.com` gave this:

```
$ curl -sI https://nexopm.com/sign-in | grep -i content-security-policy
(nothing)

$ curl -sI -o /dev/null -w "%{http_code}\n" https://nexopm.com/acme/projects
200      # expected: 307 → /sign-in?redirect=...
```

No CSP. And a private route answering **200** to an anonymous visitor,
rendering the private shell instead of bouncing to sign-in. The whole
edge was missing: the CSP, the app's HSTS, and the auth gate. What kept
the data safe were the API handlers, which check the session themselves
via `getAuthSession()`. The layer I'd described as the first one wasn't
there.

There was no symptom. The site worked, CI was green, deploys went
through.

## Cause 1: `.dockerignore` decided `proxy.ts` was a dev tool

On March 15 (`54a2123d`) I reorganized `.dockerignore` to slim down the
image. One section ended up like this:

```
# Dev tools & config
.agents
.claude
biome.json
commitlint.config.js
proxy.ts
```

Next 16 renamed `middleware.ts` to `proxy.ts`, and next to `biome.json`
and `commitlint.config.js` the new name reads like dev-server proxy
config. It went into the wrong list and stayed there for six months.

That failure is silent by design. A file missing from the build context
raises no error, no warning, no log line: `next build` inside Docker
just has no middleware to compile and carries on. On my machine
everything worked, because on my machine the file exists.

What bothers me most is the order of the dates. `.dockerignore` started
dropping `proxy.ts` on March 15; the nonce CSP landed in `proxy.ts` on
March 16. Going by git history, the header I wrote about never made it
into a deployed image.

## Cause 2: a per-request nonce doesn't fit a prerendered shell

Removing `proxy.ts` from `.dockerignore` was one line. Before shipping
it, I ran the standalone server locally with the middleware back — and
the site stopped hydrating.

Nexo has run with `cacheComponents: true` since February. That makes
Next prerender each page's shell **at build time**, with the bootstrap
`<script src>` tags baked into static HTML. A per-request nonce can't be
in HTML written before the request existed. And `'strict-dynamic'` makes
the browser **ignore** `'self'`, so the origin allowlist stops counting
and only the nonce is left — which those scripts don't carry.

Measured in Chromium against the standalone server: **27 scripts
blocked**, buttons dead, form validation never firing. `next dev`
doesn't show it, because dev renders every page per request.

Dropping `'strict-dynamic'` traded one problem for another: `'self'`
covered the chunks again, but now the inline RSC payload scripts were
blocked. Hashes don't help either: there are **~50 inline scripts** per
page and their content changes on every request. I hashed two
consecutive responses of the same page and not one hash matched.

Next's own CSP guide says this in one line, in the nonce section:
*"Partial Prerendering (PPR) is incompatible with nonce-based CSP since
static shell scripts won't have access to the nonce"*. The old code is
essentially the example at the top of that guide; the warning sits much
further down, and I stopped at the example.

So production only worked because it was unprotected. Turning the
protection back on by itself would have taken the site down.

## The three ways out

Three options, and the call was mine:

| Option | Cost |
| --- | --- |
| Keep PPR, `script-src 'self' 'unsafe-inline'` | Weaker CSP against injected inline script |
| Turn off `cacheComponents`, real nonces everywhere | Every page rendered per request again; an architecture change |
| Leave it without middleware | No CSP, no app HSTS, no edge auth gate |

I picked the first. It's strictly better than where things stood (the
third), and it doesn't touch the architecture right before beta. The
second is the only one that delivers what the old post promised, but
swapping the whole rendering model to fix a header isn't a decision I
wanted to make the same day I found the problem.

The fix was one commit (`1d3f61b`): `proxy.ts` leaves `.dockerignore`,
`script-src` becomes `'self' 'unsafe-inline'`, and the reason is written
in the code next to the comment that already justified `style-src`:

```ts
// script-src carries the same kind of trade-off, forced by cacheComponents:
// the shell is prerendered at build time, so neither its bootstrap
// <script src> tags nor the ~50 inline scripts Next streams per request can
// carry a per-request nonce, and the inline payload differs on every
// request, so hashes are out too.
```

Nonce generation was **deleted**, not commented out. Nothing read
`x-nonce`, and a per-request nonce nobody consumes is exactly the kind
of code that gets someone (me, six months from now) to write again that
the CSP uses nonces.

What `nexopm.com` sends today, from `curl -sI https://nexopm.com/sign-in`
on October 18:

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: https:; font-src 'self'; connect-src 'self' blob: data: https://*.axiom.co https://cdn.jsdelivr.net wss://nexopm.com/realtime https://….ingest.us.sentry.io; frame-src https://www.figma.com https://www.loom.com https://www.youtube.com https://docs.google.com; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests;
strict-transport-security: max-age=63072000; includeSubDomains; preload
```

And `/acme/projects` without a session answers `307` to
`/sign-in?redirect=%2Facme%2Fprojects`.

## What keeps it from happening again

Three guards, cheapest first.

**A contract test on `.dockerignore`.** It reads the file and fails if
any pattern covers a file the server needs, naming it:

```ts
const RUNTIME_FILES = [
  'proxy.ts',
  'next.config.ts',
  'package.json',
  // ...
]

expect(
  excluded,
  `.dockerignore drops ${excluded.join(', ')} from the build context, ` +
    'so the deployed image runs without it',
).toEqual([])
```

No database, no server. Run against the old `.dockerignore`, it fails
with `drops proxy.ts from the build context`.

**The browser suite boots the standalone artifact**
(`node .next/standalone/server.js`), not `next start`, which refuses to
serve `output: 'standalone'` anyway. And it runs without `bypassCSP`: a
CSP that breaks hydration turns CI red before anyone opens the site.

**`e2e/specs/csp.spec.ts`** covers both causes: the header exists,
contains neither `strict-dynamic` nor `nonce-`, the sign-in form
hydrates under the real CSP with zero console violations, and an
anonymous visitor on a private route gets redirected. The hydration
check is simple: form validation only runs once React has hydrated, so
clicking "Continuar" on an empty form and waiting for "E-mail é
obrigatório" fails if the CSP blocked the bootstrap.

## Same sentence, four times in one day

`proxy.ts` wasn't the only case that September 20. While I was fixing
it, the same shape showed up three more times:

1. **The image** didn't have `proxy.ts`.
2. **The client bundle** in CI didn't have `NEXT_PUBLIC_AXIOM_TOKEN`:
   the browser re-validates env vars, and every page died with "This
   page couldn't load".
3. **The visual suite's container** didn't get the environment: CI has
   no mounted `.env`, so the server inside failed validation and
   answered 500 to everything.
4. **The machine**: same image, same Chromium, same fonts, and 1 pixel
   of a blue heading came out `rgb(38,68,103)` here and `rgb(40,72,109)`
   on the runner, because Skia picks its SIMD path based on the CPU.

All four say the same thing: **the artifact, where it actually runs,
doesn't have what it needs — and nothing warns.** Only the boundary
changes. Bugs only the browser saw are a post of their own; what matters
here is that none of the test layers that existed before could see this,
by construction. Unit, integration, jsdom components and HTTP e2e never
run the bundle in a browser that enforces CSP, and none of them runs the
deployed image. High coverage wouldn't have helped: the file wasn't
there to be covered.

## Before and after

| | Until 09/20 | After `1d3f61b` |
| --- | --- | --- |
| `content-security-policy` | missing | present |
| `script-src` | — | `'self' 'unsafe-inline'` |
| `strict-transport-security` | `max-age=31536000; includeSubDomains` (from nginx) | `max-age=63072000; includeSubDomains; preload` (from the app) |
| Private route, anonymous visitor | `200` | `307` → `/sign-in` |
| Blocked scripts in Chromium (standalone) | 27, with the old CSP turned back on | 0 |

The "until 09/20" HSTS value comes from a real log: the job that checks
production headers prints the full response before checking, and the
August 10 run shows nginx's HSTS and no CSP.

## Where it broke: the header is weaker, and an alarm was going off

**`unsafe-inline` is weaker, no euphemism.** If an XSS manages to inject
an inline `<script>`, this CSP lets it run. That's precisely what the
nonce promised to stop. What the header still buys: no scripts from any
other origin, no `eval` in production, `object-src 'none'`,
`base-uri 'self'` (nobody rewrites the base for relative paths),
`form-action 'self'` (no form posts elsewhere) and `frame-ancestors
'none'`. User uploads are served from the storage subdomain, not this
origin, so an uploaded file doesn't become a `'self'` script. It's a
real defense, just not the one I described in August.

**The old post was wrong for three weeks without my knowing, and four
more with it.** From August 29 to September 20 I didn't know. From
September 20 until today I knew, the code was fixed, and the post kept
claiming nonces and `strict-dynamic`. The correction note ships with
this post, not before it.

**Why my verification didn't catch it.** The short answer: I verified
the code, not what was being served. The full answer is less
comfortable. The old post has a section saying a weekly job checks the
five security headers against production and fails if any goes missing.
That job landed on March 16, in the same commit as the nonce CSP. Its
first scheduled run was March 23, and it failed **every single week**
from March 23 to September 14: 27 runs in a row, 24 of them before I
published. The oldest logs have expired, but the ones still around tell
the story:

- July 20 to August 10: `MISSING: content-security-policy`;
- August 16 onward, not even that: `curl` exited with code 60, failing
  to validate the old domain's TLS certificate, and the job died before
  looking at any header.

On August 16 I triggered that workflow by hand myself, the week I was
wiring the LPA2v triage into it, and the headers job failed right next
to it. The alarm was going off. It just didn't block anything: it's a
scheduled workflow outside the deploy gate, and I published the post
without checking its result. When I wrote that the headers were
"checked every week", it was true in the most useless sense possible.
Since the move to `nexopm.com` on September 19 and the fix deploy, all
four weekly runs have passed.

Both mistakes share one root cause: I trusted a reading of the code to
make a claim about what was running. The contract test and the
standalone suite close this specific case. What they don't close is a
check that fails where nobody looks — and that hasn't changed yet.

**The path I haven't tested.** There's a combination I haven't
validated on Nexo, and it's the next step: a nonce **without**
`strict-dynamic`, with the CSP also forwarded on the request headers,
which is where Next extracts the nonce to stamp its own inline scripts.
The prerendered shell's `<script src>` tags would stay covered by
`'self'`, and the per-request inline scripts would get the nonce. The
code I deleted didn't do that; it only forwarded `x-nonce`. Whether it
holds up with `cacheComponents` on and the RSC payload streaming, I
don't know. Until I measure it, the production header stays what's
above.

## What this proves, and what it doesn't

It proves that a file left out of the build context disappears without
a trace, and that the only way to see it is to test the artifact that
actually ships, from the far side of the boundary. It proves that
per-request nonces and a prerendered shell don't coexist, and that
Nexo's production only worked for six months because it was missing the
layer I described as the first.

It doesn't prove today's CSP is good. It's better than nothing and
worse than what I published, and anyone reading the old post deserved
to know that before copying the config. It doesn't prove no other
runtime file is being left out: the contract test covers a list I wrote
by hand, with the same kind of judgment that put `proxy.ts` in the wrong
place. And it doesn't prove I wouldn't do it again. The headers job sat
red for six months and I published on top of it. The new guard runs in
the gate; the lesson about reading the red that doesn't block is still
just a sentence.
