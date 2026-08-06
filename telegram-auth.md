# Telegram login — implementation plan

> **For the executing agent.** This is the plan for the one piece of [`COMMENTS.md`](COMMENTS.md) §5 that's still open: Telegram as the second login method alongside the already-shipped email magic link. Everything else in `COMMENTS.md` (schema, profile-completion gate, comment API, selection UI, moderation) is done and unaffected by this — read it first for context (design tokens, locked decisions, the `user`/`session`/`account` schema). This doc only covers what's new.

**Blocked on:** you creating the Telegram bot via @BotFather and supplying `TELEGRAM_BOT_TOKEN` + `PUBLIC_TELEGRAM_BOT_USERNAME`. Nothing here can be verified end-to-end until that exists (see §6 — even then, the widget itself only works from the exact domain set via `/setdomain`, not `localhost`).

## 1. Goal

Add a "Log in with Telegram" option next to the email form everywhere it currently appears (`AuthWidget.astro`, `CommentsSection.astro`'s composer popover), per the locked decision in `COMMENTS.md` §2: *"Telegram Login Widget + Email magic link — no passwords."* Same downstream behavior as email: a brand-new account gets the one-time profile-completion gate (`/welcome`); a returning account skips straight through.

## 2. Prerequisites (your side, not mine)

- @BotFather → `/newbot` → save the token → `/setdomain` → `blog.umyar.com`. The widget silently no-ops if the domain isn't set (`COMMENTS.md` R5) — confirm this before assuming the verification code is broken.
- Put the token in `.env`/Vercel as `TELEGRAM_BOT_TOKEN` (secret) and the bot's `@username` (no `@`) as `PUBLIC_TELEGRAM_BOT_USERNAME` (public — it's embedded in client-side widget markup).

## 3. Why this isn't a generic OAuth plugin

Better Auth ships a `genericOAuth` plugin, but Telegram's Login Widget isn't OAuth2 — there's no authorization code, no token endpoint. Telegram signs a small JSON payload client-side and hands it to your page directly:

```
{ id, first_name, last_name?, username?, photo_url?, auth_date, hash }
```

`hash` is an HMAC-SHA256 of the other fields, keyed by a hash of the bot token. Verifying it is the entire "auth" step — there's no round trip to Telegram's servers. So this is implemented as a custom endpoint, not a plugin, exactly as `COMMENTS.md` §5 task 3 specifies.

I looked at Better Auth 1.6.23's internals (`node_modules/@better-auth/core/dist/types/context.d.mts`, `InternalAdapter`) to find the right primitives rather than fighting the OAuth-shaped plugin API:

```ts
internalAdapter.findAccountByProviderId(accountId: string, providerId: string): Promise<Account | null>
internalAdapter.createOAuthUser(user, account): Promise<{ user, account }>   // despite the name, no OAuth token exchange required — just user+account rows
internalAdapter.findUserById(userId: string): Promise<User | null>
internalAdapter.createSession(userId: string): Promise<Session>
setSessionCookie(ctx, { session, user })   // from 'better-auth/cookies'
```

This is the same low-level path the `generic-oauth` plugin itself bottoms out to (`node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs`), just without its OAuth-specific steps (token exchange, and its hard requirement that the provider return an email — Telegram doesn't).

## 4. The one real design decision: no email from Telegram

`user.email` is `not null unique` (`COMMENTS.md` §4, unchanged). Telegram never provides an email. Options:

- **Synthesize a placeholder** (`telegram-<id>@telegram.local`, a non-routable, clearly-synthetic address) — what this plan uses. Simple, satisfies the schema, never actually emailed.
- Leave `email` nullable — rejected, it's a locked-schema change and Better Auth's own tables assume email is the primary identifier in several places.

**Known consequence, not a bug:** a person who signs in with Telegram and later with email magic link (or vice versa) using the same real identity gets **two separate accounts** — there's no shared identifier to link them on. `COMMENTS.md` doesn't ask for account linking, so this plan doesn't build it. Flagging it so it's a conscious tradeoff, not a surprise.

## 5. Implementation

**New files:**

- `src/lib/telegram.ts` — pure verification function, no I/O, easy to unit-test with synthetic payloads:
  ```ts
  export function verifyTelegramAuth(data: Record<string, string>, botToken: string, maxAgeSeconds = 86400):
    { ok: true; id: string; firstName: string; lastName?: string; username?: string; photoUrl?: string }
    | { ok: false; reason: 'bad_hash' | 'stale' }
  ```
  Algorithm (Telegram's documented data-check-string): drop `hash`, sort remaining keys alphabetically, join as `key=value` with `\n`, HMAC-SHA256 that string using `sha256(bot_token)` as the key (raw digest bytes, not hex), compare hex digest to the received `hash` with a constant-time comparison (`crypto.timingSafeEqual`, not `===` — this is an auth check). Then check `Date.now()/1000 - Number(auth_date) <= maxAgeSeconds`.

- `src/pages/api/auth/telegram.ts` (`prerender = false`) — `POST`, body = the widget's payload:
  1. `verifyTelegramAuth(body, import.meta.env.TELEGRAM_BOT_TOKEN)` → 401 on `bad_hash` or `stale`.
  2. `internalAdapter.findAccountByProviderId(id, 'telegram')`.
  3. Found → `findUserById(account.userId)`, `isNewUser = false`.
     Not found → `createOAuthUser({ name: firstName, email: \`telegram-${id}@telegram.local\`, emailVerified: false, image: photoUrl ?? null, firstName, lastName: lastName ?? null, avatarUrl: photoUrl ?? null, profileComplete: false }, { providerId: 'telegram', accountId: id })`, `isNewUser = true`.
  4. `createSession(user.id)` → `setSessionCookie(ctx, { session, user })`.
  5. Respond `{ isNewUser }` as JSON (200). No redirect — see below.

- `src/components/TelegramLoginButton.astro` — renders the official widget script (`data-telegram-login={PUBLIC_TELEGRAM_BOT_USERNAME}`, `data-size="large"`, `data-onauth="onTelegramAuth(user)"`, `data-request-access` **omitted** — we only need identity, not message-send permission). Callback mode, not redirect mode (`data-auth-url`): the widget hands the payload straight to a JS function, no page navigation, which matches how `AuthWidget`/`CommentsSection` already do everything else (fetch → update DOM in place). `window.onTelegramAuth` POSTs to `/api/auth/telegram`, then on success either sends the browser to `/welcome?next=...` (new user, mirroring the magic-link `newUserCallbackURL` behavior) or just re-runs the existing `authClient.getSession()` refresh already in place (returning user).

**Existing files to touch:**

- `AuthWidget.astro` — add `<TelegramLoginButton />` next to the email form in the signed-out state.
- `CommentsSection.astro` — same, in the `#comment-popover-login` panel. The draft-persistence logic already built (`localStorage` → restore on reload) is provider-agnostic — it doesn't care how the session got created, so it needs no changes, just needs the popover to re-check `authClient.getSession()` after the Telegram callback the same way it already does after an email redirect.

No schema changes, no new env-var plumbing beyond what `.env.example` already lists (`TELEGRAM_BOT_TOKEN`, `PUBLIC_TELEGRAM_BOT_USERNAME`).

## 6. Testing — a real constraint, not a shortcut

The widget only renders/authenticates on the exact domain set via `/setdomain`. It will not work from `localhost` even with a valid token — this isn't a bug to chase. Two-tier testing plan:

1. **Server-side verification logic, fully testable locally without the widget**: craft a synthetic payload by hand using the real `TELEGRAM_BOT_TOKEN` (same technique already used in `COMMENTS.md` sub-phase A testing, where magic-link tokens were pulled straight from Neon rather than read from an inbox) — compute a valid HMAC in a small Node script, POST it to `/api/auth/telegram`, and confirm: valid payload → session created, correct `isNewUser` on first vs. second call for the same `id`; tampered field (flip one character) → `bad_hash`; `auth_date` far in the past → `stale`.
2. **The actual widget button, only testable on the real domain** (or a tunneled HTTPS domain added via a second `/setdomain`, if you want a staging option) — this is a manual check you'll need to do post-deploy, not something I can drive from here.

## 7. Acceptance criteria (carried from `COMMENTS.md` §5, Telegram-specific ones)

- A first-time visitor can sign in via Telegram, is prompted exactly once for name/last name/photo URL at `/welcome` (even though Telegram already supplied some of this — see the open question below), and lands back on the post afterward.
- A returning Telegram user skips `/welcome` on subsequent logins.
- The callback rejects a tampered payload (bad hash) and a stale one (old `auth_date`) — both via the synthetic-payload tests in §6, since the real widget can't be driven from here.

## 8. Open question for you

Telegram gives us `first_name` (always) and often `photo_url`/`last_name` too — unlike email, which gives nothing. Two options, your call:

- **(a) Still always show `/welcome` once** (this plan's default) — keeps behavior identical across both providers, simplest to reason about; `/welcome`'s inputs could optionally be pre-filled with whatever Telegram gave us so it's just "confirm" rather than "retype," but that's a small UX add-on, not required.
- **(b) Skip `/welcome` entirely if Telegram already gave us first name + photo** (`profileComplete: true` at creation time) — faster for Telegram users, but means the gate no longer uniformly means "the user actively confirmed this info."

Flag your preference when you're ready for me to build this and I'll implement whichever.
