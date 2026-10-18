---
title: What's the client's IP? — the consent record that stored whatever address the client picked
description: "Nexo's consent records, which exist to serve as LGPD evidence, stored the first X-Forwarded-For value — the only one the client writes. A curl with a swapped header recorded any IP I liked. This post is the question that sounds trivial and isn't: resolving the IP from the rightmost hop that isn't a trusted proxy, why X-Real-IP didn't help, what changed when Cloudflare went in front of nginx, and the load-test detail that needed the opposite."
icon: code
date: "2026-10-27"
---

```bash
curl -H 'X-Forwarded-For: 1.2.3.4' ...
```

With that header, the `ConsentEvent` stored in Nexo's database said the
terms had been accepted from `1.2.3.4`. `ConsentEvent` is the table that
records who accepted which version of which document, when, from what IP
and with what user agent — the record I'd show if someone asked "how do you
know this user consented?". And its IP field took whatever value the user
chose to write.

The three places that record consent — at sign-up, in onboarding, and for
cookies — shared the same line, since May 18:

```ts
const ipAddress =
  reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  reqHeaders.get('x-real-ip') ||
  null
```

I found it in the middle of other work, the same work that uncovered the
consent gate leaking through a layout. The
fix is small. The question behind it isn't.

## The problem: `X-Forwarded-For` is a list, and its start belongs to the client

`X-Forwarded-For` isn't "the client's IP". It's a list where each proxy
**appends** the address of whoever talked to it. Nexo's nginx does that
with `$proxy_add_x_forwarded_for`: take the incoming header and add
`$remote_addr` at the end.

If the client sends no header, the list has one entry — the real address,
put there by nginx. If it does, the list reaches the app like this:

```text
X-Forwarded-For: 1.2.3.4, 203.0.113.7
                 ^ client  ^ appended by nginx (the real address)
```

The first entry is free text. The last one is the only one written by
someone trustworthy. `split(',')[0]` took exactly the wrong one.

The fallback didn't help. `X-Real-IP` is filled in by nginx, and until
October 15 production nginx filled it with `$http_x_forwarded_for` — the
client's own header, again. That night it switched to `$remote_addr`, but
production's nginx config isn't in the repository; that change lives in my
ops notes, not in a commit.

And the same bug lived somewhere more obvious: the app rate limiter's
`getClientIp`, the one in the [defense-in-depth
post](/en/writing/defense-in-depth-headers-and-rate-limits) building the
`ip:${getClientIp(request)}` key. It read the first entry too. My own load
scripts depended on that: each k6 VU sends a different `X-Forwarded-For` to
get its own bucket in the app limiter. The experiment log,
`k6/EXPERIMENT-LOG.md`, says plainly that this spoof "works against the
application's rate limiter" and doesn't fool nginx — nginx's `limit_req` is
keyed by `$binary_remote_addr`, the socket IP. The outer layer held; the
inner one didn't.

## The other side: trusting nothing breaks too

Better Auth, which handles sign-in and sessions, fails the opposite way.
Without `trustedProxies`, it only accepts an `X-Forwarded-For` with **one**
entry. With two or more, the resolved IP is `null`, and its rate limiter
falls back to a single key per path, `no-trusted-ip`. For `/sign-in`, the
default rule is 3 requests every 10 seconds — for everyone in that bucket,
together.

That's what sank a load-test round with **99.76% sign-in failure**, also
in `EXPERIMENT-LOG.md`: behind nginx, every sign-in landed in the same
bucket. In production, any client that sent its own `X-Forwarded-For` (or
came through a corporate proxy that does) shared that limit with everyone
else in the same situation.

So there are two symmetric mistakes. Reading the leftmost entry trusts the
client. Refusing lists with more than one entry trusts nobody, and turns
different users into one.

## The idea: walk right to left until the first hop that isn't yours

The right answer uses what you know about your own infrastructure. I know
which proxies are mine. Reading the list right to left, every entry that's
one of my proxies can be dropped — it just relayed. The first entry that
**isn't** one of my proxies is the address the last trusted proxy saw on
the other side of the connection. Everything to its left was written by
someone I don't trust, and is ignored.

```text
X-Forwarded-For: 9.9.9.9, 4.4.4.4, 10.1.2.3, 127.0.0.1
                          ^ first untrusted, reading from the right
```

## How it works

Better Auth already implements that resolution in `getIPFromHeader`, as
long as it gets the list of trusted proxies. Nexo now configures that once,
via an environment variable, and uses the same resolver everywhere:

```ts
// src/lib/auth.ts
ipAddress: {
  ipAddressHeaders: ['x-forwarded-for'],
  trustedProxies: TRUSTED_PROXIES,
},
```

```ts
// src/lib/client-ip.ts
export function clientIp(headers: Headers | null | undefined): string | null {
  const forwardedFor = headers?.get('x-forwarded-for')
  if (!forwardedFor) return null

  return getIPFromHeader(forwardedFor, { trustedProxies: TRUSTED_PROXIES })
}
```

`TRUSTED_PROXIES` defaults to `127.0.0.1,::1`. That looks thin, on
purpose: nginx appends the client's address and never its own, so the last
entry is already the one that matters. Loopback is only there to switch on
Better Auth's multi-entry mode — with no trusted proxy at all, it goes back
to refusing lists.

Two choices in the helper:

- **`null`, not a placeholder.** A consent record with no known IP stores
  "I don't know", not `'unknown'`. The rate limiter is what needs a string,
  and it maps `null` to `'unknown'` itself.
- **`X-Real-IP` isn't read.** Not even as a fallback. A header only enters
  the resolution if I know exactly who wrote it.

The tests pin the behavior that matters, the attack included:

```ts
it('should not let a spoofed leftmost entry pick the address', () => {
  const spoofed = headers({ 'x-forwarded-for': '9.9.9.9, 3.3.3.3' })
  const honest = headers({ 'x-forwarded-for': '3.3.3.3' })
  expect(clientIp(spoofed)).toBe(clientIp(honest))
})
```

Prevention is a `grep`: no code in `app`, `src` or `lib` reads
`x-forwarded-for` or `x-real-ip` directly. Today it only finds
`client-ip.ts`, the Better Auth config, and comments.

The fix came in two parts. On October 15, the app rate limiter and Better
Auth (`590bfc8c`). On October 17, the three consent points that had been
left out (`5fd075fa`) — and the limiter's `getClientIp` now builds on the
same `clientIp`.

## Then Cloudflare went in front

That same October 17, `nexopm.com` moved behind Cloudflare. That adds a
hop before nginx, and doing nothing had a predictable outcome: nginx's
`$remote_addr` would become a Cloudflare IP. Every consent record, every
session, every rate-limit key would see Cloudflare, and nginx's `limit_req`
would put every user into a handful of buckets.

There were two ways out. One was listing Cloudflare's ranges in
`TRUSTED_PROXIES` and letting the app skip those hops. The problem is that
only the app would be right — nginx would still see Cloudflare in
`$remote_addr` and in `limit_req`. The other is restoring the address in
nginx itself, before anything reads it. I did the second:

```nginx
real_ip_header CF-Connecting-IP;

set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ... 22 ranges in total: 15 IPv4, 7 IPv6
set_real_ip_from 2c0f:f248::/32;
```

What makes this safe is `set_real_ip_from`: nginx only honors
`CF-Connecting-IP` on connections coming from Cloudflare's published
ranges. A request that hits the origin directly keeps its own address, so
sending a fake `CF-Connecting-IP` from outside gets you nothing. With that,
everything downstream — `$remote_addr`, `limit_req`'s `$binary_remote_addr`,
`X-Real-IP` and the `X-Forwarded-For` entry `clientIp` reads — keeps seeing
the visitor. Not one line of the app changed.

Order mattered: the file was applied on the server **before** turning on
Cloudflare's proxy. The other way round, every record written in between
would carry a Cloudflare IP. The file is versioned in
`infra/nginx/cloudflare-realip.conf` (`464e964b`).

### The load test wants the opposite

The production load test needs one bucket per VU, like a real user would
have. So nginx has an exception path, unlocked only with a load-test
token: with it, `/api/auth/` forwards the `X-Forwarded-For` that k6 made up
instead of trusting the socket. It's the spoof, switched on deliberately
and behind a key.

Cloudflare broke that subtly. It appends to `X-Forwarded-For` too, so the
header arrived as `<VU IP>, <runner IP>`. The resolver, correctly, took the
rightmost entry — the runner — and every VU was back to sharing a bucket.
The fix was for that test path's nginx map to pass along only the first
value. That map lives on the server, not in the repository; the change is
in my notes.

## Results

| Where the IP is read | Before | After |
| --- | --- | --- |
| `ConsentEvent` (sign-up, onboarding, cookies) | first XFF entry, then `X-Real-IP` | `clientIp()` |
| App rate limiter (Redis) | first XFF entry, then `X-Real-IP` | `clientIp()` |
| Better Auth (limiter and session IP) | single-entry XFF only; otherwise a shared bucket | same resolution, with `trustedProxies` |
| nginx `limit_req` | socket IP | socket IP, restored from Cloudflare |

With Cloudflare on, a request through the São Paulo edge
(`cf-ray …-GRU`) reached nginx's access log with the client's real IP —
checked by hand that day, not by an automated test.

## Where it broke / limitations

**The old records can't be fixed.** From May 18 to October 17, every
`ConsentEvent` stored the first `X-Forwarded-For` entry. For someone who
sent no header, that's the real address; for someone who did, it's what
they wrote. The database doesn't keep the full list, so there's no way to
tell the two apart after the fact. The consent itself (document, version,
date, user) still stands; the IP on those records is a claim, not
evidence.

**IPv6 is stored as a /64 prefix.** Better Auth's `getIPFromHeader`
normalizes IPv6 to a /64 subnet by default, because it was built for rate
limiting, where grouping by /64 is right. `clientIp` doesn't override that,
so a consent given over IPv6 stores something like
`2804:014c:005b:8000:0000:0000:0000:0000` — the network prefix, not the
device's address. For rate limiting that's what you want; for a consent
record it's less precise than someone reading the field would expect. I
haven't changed it yet.

**Cloudflare's ranges are a static list.** If Cloudflare publishes a new
range, connections from it won't have their address restored and will show
up as a Cloudflare IP until someone updates the file in the repository and
on the server. Nothing automates that.

**Only part of production's nginx is versioned.** The real-IP file is in
the repository; `X-Real-IP` set from `$remote_addr` and the load-test map
aren't. The two out-of-code changes in this post rely on my having written
down what I did on the server. And the `TRUSTED_PROXIES` comment in the
code still suggests listing a CDN's ranges there "if one ever sits in
front" — exactly the path I didn't take.

**The right IP doesn't mean the right count.** Until October 16, Better
Auth's limiter counted in process memory, so with several instances each
client got one bucket per instance (`dd34816f` moved the count to Redis) —
but that's a scaling topic, not an IP one, and it's in the [post on going
from one to five instances](/en/writing/from-one-to-five-nextjs-instances).

## What this proves, and what it doesn't

It proves that "what's the client's IP?" only has an answer relative to a
topology: the answer is the address the last proxy I control saw, and the
code has to know which proxies those are. Reading the start of the list
trusts the client; refusing lists trusts nobody. Both versions were in
production at the same time, in different libraries.

It proves that restoring the address at the edge (nginx) beats teaching
every consumer to skip hops: one config, and nginx's rate limit, the app's,
the sessions and the consent records all agree.

It doesn't prove the consent records before October 17 carry a reliable
IP — they don't, and there's no telling which. And it doesn't prove the
stored IP identifies a person: with NAT, CGNAT and IPv6's /64, it
identifies a network, and that's all a record like this should claim.
