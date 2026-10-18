---
title: From any account to platform admin in three requests
description: "Nexo's edit-profile endpoint accepted a new e-mail and wrote it straight to the row, keeping it marked as verified. The platform admin list is keyed by e-mail. Any signed-in user could become admin in three requests, and the 2FA required the day before held nothing back, because the attacker owns the account. This is the postmortem: how it was found, why the gate was right and still failed, what changed and what still hasn't been checked."
icon: bug
date: "2026-12-01"
---

On the night of September 27, this sequence worked against a production
build of Nexo, starting from an ordinary, freshly created account with no
special role:

```
PATCH /api/users/me {"email":"<allowlisted address>"}  -> 200
POST  /api/auth/two-factor/enable {...}                -> 200
GET   /api/admin/careers                               -> 200, admin data
```

Three requests, no verification anywhere, and the result is platform
admin access: publishing public job posts on the site and reading
candidates' data. The fix is commit `f9053ab0`, live the same night.

## The problem: the gate trusted a field the user could write

The platform admin area doesn't use workspace RBAC. It's authorized by an
e-mail allowlist in an environment variable, `PLATFORM_ADMIN_EMAILS`. The
gate, in `resolvePlatformAdmin()`, asked the right question:

```ts
const email = user.email?.toLowerCase()
if (!email || !getPlatformAdminEmails().includes(email)) {
  return err(forbidden())
}
```

The defect lived in another file. `UpdateUserSchema`, which validates the
body of `PATCH /api/users/me`, had had an `email` field since February.
The service only checked whether another account already used that
address and, if not, handed the whole DTO to the repository:

```ts
const updateResult = await UserRepository.update(actorId, dto)
```

The e-mail changed. `emailVerified` stayed `true`, inherited from the old
address. The account now carried, stamped as verified, an address it had
never proven it owned. And the admin gate asks exactly that: what's your
e-mail?

### Why 2FA didn't help

The day before (`c1585aaf`), I'd started requiring a second factor for
the admin area. The reason was real: being on the allowlist alone meant
one leaked password opened everything. But 2FA protects against someone
who stole another person's account. Here the attacker owns the account.
They turn 2FA on for their own account, with their own phone, and walk
in. The new requirement turned a two-request path into a three-request
one.

### Preconditions

The attack only works if the allowlisted address **isn't registered** on
Nexo, because the service refused to switch to an e-mail another account
already used. When it was found, the address was registered, and the
path was closed in production for that reason alone. But either of two
things would open it:

- the admin account being deleted (which, after
  [fixing account deletion](/en/writing/account-deletion-that-never-deleted),
  actually happens);
- me adding a second address to the allowlist before someone created the
  account for it.

The second is the normal way to give a new person access. The product's
ordinary admin workflow opened the door.

## How it was found

Not by a scanner. That night I couldn't get into `/admin`. The cause was
two defects unrelated to security (`74945d20`): `/admin` had no page of
its own, only sub-routes, and the 2FA gate read `twoFactorEnabled` from
the session, which better-auth serves from a cookie cache for five
minutes. Someone who had just turned 2FA on was told to turn 2FA on.

While that was being fixed, I asked the agent working with me to try
every way into the admin area without being an admin. It brought up a
production build against throwaway Postgres and Redis and attacked with
four profiles: anonymous, ordinary signed-in user, allowlisted admin
without 2FA, and admin with 2FA as a control. Most of it held: anonymous
gets redirected or a 401, a user outside the allowlist gets 403 from the
API and no admin page, a tampered cookie goes nowhere, case and slash
variations in the path change nothing. The e-mail path didn't hold, and
it was reproduced end to end before anything was fixed.

## The idea: identity isn't a profile field

Name, username and cover image are profile. E-mail is identity, and on a
platform with an e-mail allowlist, identity is authorization. A profile
endpoint shouldn't be able to write either of the last two.

This is plain old *mass assignment*: the service takes an object and
saves the object, so any key the schema lets through becomes a changed
column. Zod drops unknown keys by default, which makes it feel like the
schema already handles that. But `email` wasn't unknown. It was in the
schema on purpose, since the first version of the endpoint.

## How the fix works

Four changes, each closing the door from a different side.

**The field left the schema.** `UpdateUserSchema` no longer has `email`,
and the comment in its place says why. An `email` in the body is now
dropped before reaching the service, with no error: a malformed address
is no longer an error to report, and someone else's is no longer a
conflict to reveal.

**The service writes fields by name.** Instead of handing over the DTO:

```ts
const updateResult = await UserRepository.update(actorId, {
  ...(dto.name !== undefined ? { name: dto.name } : {}),
  ...(dto.username !== undefined ? { username: dto.username } : {}),
  ...(dto.coverImage !== undefined ? { coverImage: dto.coverImage } : {}),
})
```

It's a second lock on the same door. If someone puts an identity field
back in the schema someday, the service won't write it, because it
doesn't know it exists.

**The gate requires a verified address.**

```ts
if (!user.emailVerified) return err(forbidden())
```

Today that's redundant: sign-in already requires a verified e-mail, and
the attack worked precisely because the flag stayed `true`. Redundancy is
the point. It's the check that still holds if someone loosens the sign-in
requirement one day.

**Changing an e-mail becomes a flow, not a field.** A new address should
only count once a message sent to it has been confirmed. That flow
doesn't exist yet. Today, on Nexo, you can't change your account's
e-mail.

The tests that went in replay the attack. One e2e sends the allowlisted
address in the `PATCH` and requires the account's e-mail to stay the
same; another sends the same `PATCH` and then requests
`/api/admin/careers`, requiring **403**. Schema and service tests check
the field is dropped at both layers.

The commit is from 21:51 on September 27 (UTC−3). The CD run that took
it to production finished at 22:32 the same night.

## The rest of the admin week

This bug showed up at the end of two days of work on the admin surface,
and the context matters, because almost all of it was hardening the
second factor:

| Commit | What |
| --- | --- |
| `05883c7e` (Sep 26) | authenticator app (TOTP) with backup codes, alongside the e-mailed code. OTPs are now stored hashed: the plugin's default kept the live second factor in clear text in the verification table. Lockout after **5** failed verifications, not 10, for 15 minutes. "Trust this device for 30 days" is refused for admins in a post-sign-in hook, because the sign-in page can't know who's an admin without being told, and telling it would leak the list |
| `8c0aa508` (Sep 26) | better-auth's lockout wrote to columns the schema didn't have; since the reset runs on the **success** path, a correct code failed sign-in just like a wrong one |
| `c1585aaf` (Sep 26) | admin requires a second factor; anyone outside the allowlist gets `notFound()` instead of a redirect, because a redirect confirms the route exists |
| `74945d20` (Sep 27) | the gate lives only in `resolvePlatformAdmin()`; a session claiming "no 2FA" is checked against the database before refusing |
| `2e349d83` (Sep 27) | `/admin` leaves `robots.txt`, which advertised to everyone the path the app hides behind a 404 |
| `4bace6de` (Sep 27) | sign-in stops mailing a code before it knows one is needed; for admins with a verified authenticator, the e-mail factor is refused server-side |

The last one deserves another line. better-auth accepts an e-mailed code
for any account with 2FA on, whatever factor was enrolled, because
`send-otp` only asks for a challenge in flight. As long as a code can be
mailed, a mailbox is enough to sign in, which is exactly what the
authenticator was supposed to fix.

## What this says about three-layer authorization

In the post on [authorization in three layers](/en/writing/three-layer-authorization),
I argued that the "can or can't" decision lives in one place, and that
this makes authorization auditable. This bug doesn't contradict that. The
gate was right, in the right place, asking the right thing. The audit
found the problem precisely because there was one gate and it could be
attacked head on.

What failed was a premise the model never wrote down: that the
attributes the decision rests on aren't writable by whoever is being
authorized. `Membership.role` changes through a service that requires
`OWNER` or `ADMIN`. The e-mail changed through an endpoint that only
required being signed in. Centralizing the decision protects nothing if
the data it reads can be written through another path.

## Where it broke

**The production window existed, and I didn't sweep its logs.** The
allowlist was only configured in production on September 26
(`f9762258`); before that, the admin area opened for nobody. Between that
configuration and the moment I registered the account for the allowlisted
address, the preconditions held in production. The window was a little
over a day at most, but it wasn't zero, and what happened in it isn't in
this post because I didn't go and look.

**The defect was written down, under the wrong name.** In my
architecture notes, since June, there was a pending-review item: "today
`PATCH /api/users/me { email }` keeps `emailVerified=true`". It was filed
as an account-flow fix. In July the admin allowlist arrived, and e-mail
became an authorization attribute. Nobody went back to the note. The
root cause isn't not knowing about the defect; it's that a change to the
authorization model didn't trigger a review of the fields it now
depended on.

**I didn't sweep the other DTOs.** The user service now writes field by
field, but **10 other services** still hand the whole DTO to the
repository (project, workspace, labels, states, job posts, among others).
The protection there is the same as before this bug: the schema. I looked
at one case, the project's `leadId`, which is an authorization attribute
and is validated against the member list before it's written. I didn't
audit the rest field by field.

**The e-mail allowlist is the fragile design, and it stays.** An address
is an attribute that changes, that can be released and reused. A list of
user ids, or a role column only an admin can write, wouldn't have this
problem. I kept the e-mail because the fix closed the known path and the
cost of migrating outweighs today's surface. That's a choice, and it
depends on no other path being able to write the e-mail, which is exactly
the premise that failed this time.

**The page title gave the area away.** In the audit, the prerendered
shell sent the admin pages' `<title>` to anyone, so the 404 hid the
content but not the route's existence. No data leaks that way, and I
haven't changed it.

## What this proves, and what it doesn't

It proves the path from e-mail to admin is closed at three independent
layers (schema, service and gate), that an e2e test replays the attack
and requires a 403, and that the fix reached production the same night
the problem was reproduced. It proves a correct authorization gate isn't
enough when the data it reads is writable through another endpoint.

It doesn't prove nobody used the production window, because its logs
weren't swept. It doesn't prove there's no other sensitive field being
mass-assigned in the other 10 services. And it doesn't prove an e-mail
allowlist is safe: only that, today, I know of no other way to write an
account's e-mail.
