---
title: The observability that lies to you
description: "I spent hours convinced PostHog was broken in Nexo's production. It never was: posthog-js silently drops every event when the browser looks automated, and I was checking with an automated browser. Pulling that thread surfaced three more holes: a GA4 our own CSP was blocking, a Sentry with zero source maps, and a privacy flag that discarded people who had clicked 'Accept'. None of them raised an error."
icon: bug
date: "2026-12-03"
---

I spent most of an afternoon convinced PostHog was broken in Nexo's
production. I'd open the site in a Playwright-driven Chromium, accept the
cookies, click around, and nothing arrived. No request, no console error, no
warning. `localStorage` had the `ph_<token>_posthog` key, the cookie was set,
`init()` had run. Everything looked healthy, and no event left the browser.

PostHog was never broken. The thing doing the checking was.

That day, September 22, turned into an audit of all of Nexo's observability.
The same pattern showed up in four places: the tool doesn't fail loudly, it
fails quietly, and it fails exactly when you go check whether it works.

## The problem: missing data is not a measurement

When a production system breaks, it usually tells you: a 500, an error log,
an alert. Analytics and observability tools break differently. They're built
to never get in the app's way, so they swallow their own failures. An event
that wasn't sent leaves no trace. A blocked script becomes a CSP violation
line nobody reads. A missing source map only shows up when you need a stack
trace and get minified chunk names.

So "I saw nothing arrive" has two readings that look identical from outside:
nothing happened worth measuring, or the measurement is off. Without a
positive control (a case where you **know** data should arrive), zero events
proves nothing.

Before that day, Nexo had three in-browser measurement tools, and none of
them was measuring what I thought:

- **Vercel Analytics and Speed Insights**: their beacons posted to
  `/_vercel/insights/*` on our own origin, a path that only exists on Vercel.
  Nexo runs on its own server, so the answer was a `307` to `/sign-in`. They
  collected nothing.
- **Google Analytics 4**: mounted behind the consent banner, collecting
  nothing (details below).
- **PostHog**: freshly installed and apparently mute.

## The idea: every check needs a case that should come back positive

Not a sophisticated insight, but it changed how I verify anything telemetry
related: before concluding something doesn't work, prove your checking
instrument can see the case where it does. And before concluding something
works, look at the artifact it should produce (the request, the `.map` file,
the row in the dashboard), not at the fact that it initialised without error.

An error-free `init()` is not evidence of collection. A release created in
Sentry is not evidence of symbolication. A banner with an "Accept" button is
not evidence that whoever accepted is being measured.

## How it works (and where each tool was lying)

### PostHog: the anti-bot defence that blinds you

`posthog-js` has a function, `isLikelyBot()`, that runs before anything is
sent. If it returns `true`, the event is dropped: no log, no request, no
error. In the installed bundle (`posthog-js` 1.433.5), minified, it reads:

```js
const Ua=function(t,i){if(!t)return!1;const e=t.userAgent;if(e&&Q(e,i))return!0;
try{const e=null==t?void 0:t.userAgentData;
if((null==e?void 0:e.brands)&&e.brands.some(t=>Q(null==t?void 0:t.brand,i)))return!0}
catch(t){}return!!t.webdriver}
```

Three markers, any one is enough:

1. `navigator.webdriver` set, which every automation-driven browser exposes;
2. a `userAgent` matching the bot list, which includes `headlesschrome`;
3. `navigator.userAgentData.brands` containing `HeadlessChrome`.

The third one fooled me last. Overriding `userAgent` in Playwright clears the
second marker, and I thought I'd fixed it. But `userAgentData` is a separate
API and survives the override. With it intact, the SDK kept dropping
everything.

Two false signals reinforced the wrong conclusion:

- `window.posthog` is **always** `undefined` when PostHog comes from the npm
  package. Only the CDN snippet creates that global. I read it as "didn't
  load".
- Turbopack chunks have hashed names. Finding no network resource with
  "posthog" in its name proves nothing.

With all three markers masked, the production check closed on both sides: no
consent, **zero** requests; with consent, `POST /ingest/e/` answering
`200 {"status":"Ok"}`, no CSP violation. And I tested the visitor's real path,
clicking "Aceitar" in the banner, not just a pre-set consent cookie.

### GA4: the script our CSP refused

Google Analytics was mounted behind consent and collected nothing. `gtag/js`
comes from `googletagmanager.com`, and Nexo's CSP
(`script-src 'self' 'unsafe-inline'`) refuses scripts from other origins.
Every visit that accepted cookies produced a CSP violation and zero data.

I didn't punch a hole in the CSP. With PostHog working, there was no reason
for a second tool, let alone a blocked one. Commit `b7ebf52` removed GA, the
`@next/third-parties` package, `NEXT_PUBLIC_GA_ID`, and the cookie-policy
sentence claiming we used GA4.

The three deliberate events GA carried (`pricing_plan_click`,
`blog_post_read`, `talk_to_sales_submit`) moved to PostHog through a new
helper, `captureEvent`. What matters is where consent gets checked:

```ts
export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  if (!hasAnalyticsConsent()) return
  void loadPostHog().then((posthog) => {
    posthog?.capture(event, properties)
  })
}
```

It re-reads the consent cookie **on every call** instead of trusting the
caller. `<PostHogTracker />`, which sends pageviews, only mounts behind the
consent gate. But these events fire from click handlers across the marketing
site, and one firing for a visitor who refused analytics would initialise the
SDK and send a beacon. The gate can't live in a parent component when the
event can originate anywhere.

### Sentry: release created, nothing to symbolicate

Sentry was alive. A production error arrived with `release` set to the
deployed commit and `environment: production`; the server side too, with
database spans. What didn't work was symbolication, and only Sentry's API and
the bundle itself showed it:

- `find .next/static -name "*.js.map"`: **0** files;
- no `_sentryDebugIds` or `debugId` in any of the **12** production chunks
  checked;
- `debug_meta.images: 0` on a real client error event.

Meanwhile, the Sentry plugin had created **and finalised** the release during
the build. It ran with credentials, did everything right, and had nothing to
upload. Every client stack trace pointed at minified chunk names.

The cause was a comment of mine in `next.config.ts` claiming the upload was
"the only thing that would ever emit a `.map`". That's a webpack-era
assumption. With Turbopack, Next emits no browser source map without
`productionBrowserSourceMaps: true`, and the Sentry plugin doesn't set it for
you. The fix (commit "emit the browser source maps the upload needs") turns
generation on, tied to the same credentials as the upload:

```ts
const canUploadSourcemaps = Boolean(
  sentryOrg && sentryProject && sentryAuthToken,
);

const nextConfig: NextConfig = {
  // ...
  productionBrowserSourceMaps: canUploadSourcemaps,
```

The coupling is deliberate: maps must not be emitted where nothing will
delete them. In the CD build, `deleteSourcemapsAfterUpload` removes the files
and the `sourceMappingURL` comments once Sentry has them, so traces stay
readable in Sentry and unreadable in the browser. A local build against a
throwaway release (deleted afterwards) confirmed the whole cycle:
"Successfully uploaded source maps to Sentry", **267** chunks with debug ids,
then **zero** `.map` files and **zero** `sourceMappingURL` comments left in
`.next/static`.

### GPC: the lock was ours

After all that, an intermittent symptom remained: sometimes a real,
non-automated browser sent nothing. The cause was a line I had written:
`respect_dnt: true`.

With it, `posthog-js` treats the browser's `doNotTrack` and
`globalPrivacyControl` as refusal, and reports consent as denied **even with
`nx_cookie_consent=accepted` set**. Measured in real Firefox 155, against
production:

| Firefox setting | `dnt` | `gpc` | Events sent |
|---|---|---|---|
| Default (Standard protection) | `unspecified` | `false` | 1 |
| GPC on | `unspecified` | `true` | **0** |
| DNT on | `1` | `false` | **0** |

GPC is on by default in Firefox under "Strict" protection and in private
windows, and in Brave. In practice: Nexo asked for consent, the person
clicked "Accept", and we silently discarded their choice.

I decided to remove the lock (commit "stop a browser privacy signal from
overriding consent", `respect_dnt: false`). The reasoning is mine, not legal
advice: GPC is a construct of the CCPA, California's privacy law, about the
**sale or sharing** of personal data, which Nexo doesn't do. Our privacy
policy already said we don't respond to Do Not Track and that GPC is honoured
"when required by applicable law". The code was stricter than our own
published text, and that gap cost data without protecting anyone from
anything the text promised. The gate that matters is untouched and still
verified: no consent cookie, or a refusing one, and the SDK doesn't even load.

### Only then: the funnel

With collection proven, PostHog still had only pageviews and the three
marketing events, which only tell you which pages people open. Six days
later, commit `1d60777` instrumented the six moments of the activation
funnel, all through the same `captureEvent`:

| Event | What it answers |
|---|---|
| `signup_submitted` | fired after validation, before the request |
| `signup_completed` | the gap between the two is what the API itself costs in abandoned signups |
| `email_verified` | a hard gate: no verification, no session |
| `issue_created` | the activation moment; PostHog derives the first occurrence per person |
| `invite_sent` | someone brought another person in, the strongest adoption signal |
| `checkout_started` | fired on the screen where the order is filled in, before the payment provider |

No onboarding event: its four steps are pages, so pageviews already give the
step-by-step drop-off. And no server-side capture anywhere, on purpose. The
payment webhook is the most tempting place to count "bought", but it has no
browser, and counting from it would be analytics outside the consent the
banner asks for and the privacy policy describes. The trade is written in the
code: someone who closes the tab mid-payment is missing from the funnel and
present in the database, which is where revenue gets counted anyway.

## Results

| Tool | Before Sep 22 | After |
|---|---|---|
| Vercel Analytics / Speed Insights | beacons answered `307` to `/sign-in`, nothing collected | removed, with their CSP host |
| GA4 | blocked by CSP, one violation per accepting visit | removed; 3 events moved to PostHog |
| PostHog | looked mute (it was the checker) | no consent: 0 requests; with: `POST /ingest/e/` → `200` |
| Sentry (client) | 0 `.map`, `debug_meta.images: 0` | local build: 267 chunks with debug ids, 0 `.map` left |
| Firefox with GPC or DNT | 0 events even after "Accept" | lock removed; the banner is the gate |
| Product events | 3 (in GA, which collected nothing) | 3 marketing + 6 activation funnel |

The honest comparison isn't "we collected little, now we collect a lot". It's
that I **believed** I had three tools measuring, and had zero. None of the
four holes raised an error anywhere. All of them were found by looking at the
artifact that should exist (the request, the file, the event in real Firefox)
instead of at whether the tool had initialised.

## Where it broke: what still isn't proven

The first limitation is the ironic one: **Nexo's browser suite still can't
assert anything about PostHog.** The check that closed the case was manual,
masking the three automation markers by hand. No spec in `e2e/` does that
today. The root cause is the original bug: Playwright is exactly the kind of
browser `isLikelyBot()` was built to ignore, so a test asserting "no event
sent without consent" would pass even with the consent gate broken, because
the SDK would drop everything anyway. A test that always passes is worse than
no test. To be useful, the spec has to mask `webdriver`, the user agent and
`userAgentData`, and I haven't written it yet.

Second: the source map upload was proven in a local build, not in CD. In the
CD log, the build runs inside `docker buildx`, and the Sentry plugin's output
doesn't surface there in a way I can point at an "uploaded" line. Until I
open a client error in Sentry after a deploy and see a symbolicated trace,
"CD uploads the maps" is an inference from the same configuration, not a
measurement.

Third is by design, not a bug: **the funnel only sees people who accepted
analytics.** Whoever refuses the banner doesn't exist for PostHog, on
purpose. So the funnel's conversion rates come from a self-selected sample,
not the visitor population. I chose that knowingly over server-side capture,
and the price is that no funnel number can be read as "x% of visitors".

And the last silent hole showed up later, in another layer: the route
wrapper and `proxy.ts` called Axiom's `logger.flush()` on every request, and
under load that took production down through heap exhaustion. That one is in
the [post about going from one to five instances](/en/writing/from-one-to-five-nextjs-instances).

## What this proves, and what it doesn't

It proves that, at Nexo, the four observability failures found that day had
the same shape: none raised an error, and each looked healthy through some
secondary signal (an `init()` that runs, a release that gets created, a
cookie that gets written). And it proves that, for these tools specifically,
missing data in an automated browser is evidence of nothing: `posthog-js` is
designed to be blind there.

It doesn't prove Nexo's observability is complete now. The PostHog check
isn't automated, the CD source map upload wasn't observed directly, and the
funnel only sees people who consented. Nor does it prove the GPC decision
carries over to another product: it rests on Nexo not selling or sharing data
and on what our policy already said. What I take from it is a habit, not a
guarantee: before trusting a zero, prove the instrument is able to show a
positive.
