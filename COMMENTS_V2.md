# blog.umyar.com — Comments v2 (feedback fixes + newsletter alignment)

> Successor spec to [`COMMENTS.md`](COMMENTS.md). That document describes what was built and
> shipped; this one describes what changes in response to reader feedback (2026-08-08) plus the
> decision to merge the comments-auth pipeline with the newsletter pipeline. Work phase by phase;
> don't advance until the current phase's acceptance criteria pass.
>
> Where the two documents disagree, **this one wins** — see §11.

---

## 0. Where this came from

Reader feedback, 2026-08-08. Four complaints, verbatim intent:

| # | Complaint | Verdict after reading the code |
| --- | --- | --- |
| 1 | Signing in is awkward — going to the inbox is an extra trip. Add a caption saying comments require an account, and a visible link/button to a sign-in popup or page. | **Confirmed, and worse than it looks.** A first-time commenter makes two round trips: inbox for the magic link, then a full-page redirect to `/welcome` for three required profile fields. The only sign-in UI on the entire site is at the bottom of a post. |
| 2 | The email field is unique — validate it, add checks against bad actors. | **Confirmed asymmetry.** `/api/subscribe` is well hardened. The auth path has none of it, and Better Auth's `rateLimit.storage` defaults to `memory`, which on Vercel serverless is per-invocation — so in production the magic-link endpoint is effectively unlimited. |
| 3 | The photo field is required and it's a URL — awkward. Make it optional, allow a file upload, still accept a pasted URL, default avatar otherwise. | **Confirmed.** `src/pages/api/profile.ts` hard-rejects an empty `avatarUrl`. `BLOB_READ_WRITE_TOKEN` is already in `.env` and unused. |
| 4 | Commenting on a passage is nice, but you bounce up and down between the comment and the text. Highlight them somehow, or show the newest/most-liked few. | **Confirmed.** Clicking anything scrolls the page. The "most-liked" half of the idea is now in scope — see phase 6. |

Three findings the feedback couldn't see from outside:

- **No un-anchored comments.** Every comment must be attached to a text selection — there is no plain
  "leave a comment" box. Now **in scope**, phase 4.
- **Better Auth lowercases email on both create and lookup** (`internal-adapter.mjs` `createUser` /
  `findUserByEmail`). So `user.email` and `subscriber.email` are directly joinable with `=`, no
  normalization backfill needed. This is what makes phase 7 cheap.
- **`user.name` and `user.image` are dead columns.** Better Auth's core `user` table ships both; the
  magic-link plugin writes `name: ""` at signup (`magic-link/index.mjs:132`) and **nothing in this
  repo ever writes either one**. `firstName` / `lastName` / `avatarUrl` were added *beside* columns
  that already did the job. Fixed in phase 2.

## 1. Locked decisions (confirmed with the user 2026-08-10 — do not re-litigate)

| Area | Choice |
| --- | --- |
| Sign-in method | **Inline 6-digit email OTP** via `better-auth/plugins/email-otp`. The reader never leaves the page. The magic link stays only as a secondary link inside the same email. |
| Identity fields | **Auto-assigned reader number (`u1`, `u2`, `u16`…), first name (required), last name (required), avatar (optional).** Nobody picks the number and nobody can change it — a Postgres sequence issues it at signup. The dead `name` / `image` columns get folded away — see §4.1. |
| Avatar | **Optional.** Three ways to fill it: upload a file (resized client-side, stored on Vercel Blob), paste an image URL (existing behaviour, kept), or leave blank → generated initials monogram. |
| Comment kinds | **Both.** Anchored-to-a-selection (as today) **and plain whole-post comments** from a normal box. One table, one list, one API. |
| Reading comments | **Click-a-highlight popover everywhere, plus real comment cards in the right margin on wide screens.** Bare avatars remain the fallback at mid widths. |
| Likes | **In.** One like per user per comment, sign-in required. Hovering the count shows who liked — avatars and names. Unlocks a "most liked" sort. |
| Newsletter alignment | **A subscribe checkbox in the sign-in dialog only.** Unchecked by default. Because the reader typed a code we emailed them, the address is already proven — the row lands as `confirmed` with no second confirmation email. |
| Everything else in §2 of COMMENTS.md | **Still in force.** Astro stays `output: 'static'`, flat comments, Neon + Drizzle + Better Auth, same brand tokens. |

**Out of scope for v2** (asked about, explicitly declined): comment/reply notification emails, a
unified `/preferences` page, threading/replies, editing your own comment after posting.

**Friction budget.** Today a first comment costs three required fields plus an inbox round trip. After
this spec it costs **two: first and last name.** The avatar is skippable, the reader number is issued
automatically, and the inbox trip is gone.

## 2. Phase 0 — Unblock (user-side, ~15 min)

Nothing below ships without these. All three are outside what the executing agent can do.

- ✅ **Resend sending domain.** `umyar.com` is verified in Resend and `EMAIL_FROM` matches it, so
  sending is live. (Superseded the standing note about `poupy`.)
- ⬜ **Vercel env vars.** COMMENTS.md §0 records that nothing was ever pushed to the Vercel project.
  Needed: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`,
  `ADMIN_USER_IDS`, `BLOB_READ_WRITE_TOKEN`, `PUBLIC_SITE_URL`.
- ✅ **`npm i @vercel/blob`** — installed (`^2.7.0` in `package.json`).

**The database is empty and disposable** (confirmed 2026-08-10): no users, no comments, no
subscribers — only the v1 test rows, which were cleared. Every schema change in this spec is
therefore a plain `drizzle-kit push`, and wiping and re-pushing is a legitimate move if a diff gets
awkward. There is no data to preserve, no backfill to order, and no reason to be careful with `DROP`.

This stops being true at the first real signup. Anything schema-shaped that's cheap now and expensive
later — notably the sequence start in §4.2.7 — should be settled before phase 1 ships.

## 3. Phase 1 — Sign in without leaving the page

Answers feedback #1. This is the phase the reader actually felt.

### Tasks

1. **Add the OTP plugin** to `src/lib/auth.ts`:

   ```ts
   emailOTP({
     otpLength: 6,
     expiresIn: 600,        // 10 minutes
     allowedAttempts: 3,
     sendVerificationOTP: async ({ email, otp, type }) => { await sendOtpEmail(email, otp); },
   })
   ```

   Keep the `magicLink` plugin registered — existing links in inboxes must not 404 — but stop
   offering it as the primary path in the UI.

   Client actions: `authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })` then
   `authClient.signIn.emailOtp({ email, otp })`. Server endpoints, for the rate-limit rules in
   phase 3, are `/email-otp/send-verification-otp` and `/sign-in/email-otp` under the auth basePath.

2. **`sendOtpEmail` in `src/lib/email.ts`.** Reuse the existing `shell()` — the code set large,
   monospace, letter-spaced, as the only thing above the fold. Include the expiry and the "ignore
   this if it wasn't you" line, matching `sendSubscribeConfirmEmail`'s tone.

3. **New `src/components/AuthDialog.astro`** — a native `<dialog>`, one implementation shared by the
   header, the comment composer and the like button, replacing the two near-duplicate forms currently
   in `AuthWidget.astro` and inside `CommentsSection.astro`. States: `email` → `code` → `profile`
   (only if incomplete) → done. Takes a callback so the caller can resume whatever the reader was
   doing; accepts a `next` for the page-based entry point.

4. **Invert the composer: type first, authenticate at Post.** Today `openComposer()` refuses to show
   the textarea when signed out. Change it to always show the textarea; on Post, if there's no
   session, open `AuthDialog` *over* the composer with the draft intact in memory. The whole
   `localStorage` `DRAFT_KEY` round-trip in `CommentsSection.astro` (`restoreDraft`, the draft write
   in the login-form handler) can be **deleted** — with OTP the page never unloads.

   This "act first, authenticate at the moment of commitment" pattern is reused verbatim by the plain
   composer (phase 4) and the like button (phase 6). Build it once, in `AuthDialog`.

5. **Make it discoverable**, exactly as the feedback asked:
   - **Header** (`src/components/Header.astro`): a sign-in button on the right next to `ThemeToggle`.
     Signed in → the reader's avatar opening a small menu (Profile / Sign out). This becomes the
     global identity affordance.
   - **`/signin` page** (`prerender = false`, accepts `?next=`) for anyone who wants a page rather
     than a dialog. Mirror the card styling of `subscribe.astro` / `welcome.astro`.
   - **Caption on the comments section**: `Comments (N) · Sign in to comment` — the literal
     "подпись что комментировать могут только авторизованные" ask.
6. **Retire `src/components/AuthWidget.astro`** and its slot in `src/pages/posts/[lang]/[slug].astro`.
   The header owns identity now; the comments caption owns the call to action.

### Acceptance criteria

- A signed-out reader selects text, writes a comment, clicks Post, types their email, types the
  6-digit code, and their comment appears — **without the page ever navigating away**.
- Wrong code three times → clear error, no session, and the composer still holds the draft.
- The header shows a sign-in control on every page, signed out and signed in.
- `/signin?next=/posts/en/foo` returns to that post after signing in.

## 4. Phase 2 — Identity: clean the table, number the readers, unblock the profile

Answers feedback #3, plus the table cleanup and automatic reader numbers.

### 4.1 No dead columns

**The database is empty** (see §2) — so this is schema design, not migration. Write `schema.ts` the
way it should look and push.

`name` still can't simply be omitted: Better Auth's core schema declares it `required: true` and
writes it on every signup (`@better-auth/core/dist/db/get-tables.mjs:134`). Leave the column out and
account creation breaks — which is why it exists in the current schema in the first place.

But it's **remappable**, as is `image`. `get-tables.mjs:137` and `:157` resolve their storage column
through `options.user.fields.*`, so Better Auth's own fields can be pointed at the columns you
actually want:

```ts
user: {
  fields: {
    name:  'first_name',   // Better Auth's required `name`  → the reader's first name
    image: 'avatar_url',   // Better Auth's optional `image` → the avatar
  },
  additionalFields: {
    userNumber:      { type: 'number',  required: false, input: false },
    lastName:        { type: 'string',  required: false },
    avatarSource:    { type: 'string',  required: false },
    profileComplete: { type: 'boolean', required: false, defaultValue: false, input: false },
  },
}
```

There are then no `name` or `image` columns at all — Better Auth's fields by those names simply live
in `first_name` and `avatar_url`. `first_name` is `notNull().default('')` to satisfy `required: true`:
Better Auth writes `""` at signup and `profileComplete` stays false until the reader fills it in.

Resulting `user` table — **six app columns, none dead**: `user_number`, `first_name`, `last_name`,
`avatar_url`, `avatar_source`, `profile_complete` (plus Better Auth's `id`, `email`, `email_verified`,
timestamps).

`userNumber` is declared `input: false` so Better Auth rejects any attempt to set it through an API
payload — the sequence is the only thing that ever writes it.

**`lastName` stays `required: false` here even though the product requires it, and `last_name` stays
nullable in Postgres.** Better Auth inserts the user row at first sign-in, long before the profile
step exists — mark the field required at the schema level and account creation fails on every signup.
"Required" for names means *required to finish your profile*, and it is enforced in one place:
`POST /api/profile` rejects an empty first or last name, and `profileComplete` (which gates
commenting) only flips when both are set. Same reasoning applies to `first_name`, which is
`notNull().default('')` rather than genuinely required.

**The one cost, stated plainly:** in application code the first name is reached as `session.user.name`,
not `session.user.firstName`, because that's Better Auth's field name for it. The DB column is still
honestly called `first_name`. If that indirection reads worse to you than one dead column would, the
fallback is to leave `name`/`image` in place unused — say so and I'll take that branch instead.

### 4.2 Reader numbers

Every reader gets a number at signup — `u1`, `u2`, `u16`. Nobody picks it, nobody can change it, and
there is no form field for it anywhere.

1. **Schema.** `userNumber integer` on `user`, `GENERATED ALWAYS AS IDENTITY`, `NOT NULL`. Rendered as
   `u${n}`. **Store the integer, not the string** — then the sequence itself is the uniqueness
   guarantee, and there is nothing to validate, nothing to check for availability, and no race to
   lose. Gaps are possible (a rolled-back signup consumes a value); that's fine, it's an identifier,
   not a tally.
2. **Assigned at row creation** — the moment Better Auth inserts the user on first sign-in, not at
   profile completion. Every user has one from the instant they exist, including those who never
   finish a profile.
3. **No backfill.** The table is empty, so the identity column is there from the first push and `u1`
   is the genuine first signup by construction — no ordering to reconstruct, no SQL to hand-run.
4. **What this removes** compared to reader-chosen handles: no availability endpoint, no debounce, no
   reserved-word list, no format regex, no ASCII/homoglyph rule, no unique-violation race to handle,
   no rate limit on lookups, no "change it later" flow. It also deletes impersonation as a category —
   nobody can register a number that looks like someone else's.
5. **What it's for.** Names are free text and nothing stops two readers entering the same one —
   including entering *yours*. With no handle to claim, the number is the only thing that
   distinguishes two identical bylines, and the only stable public identity a reader has.
6. **Rendering.** `Umiar Iusupov u16` — name at normal weight, number muted and smaller — everywhere
   an author appears: the bottom list, margin cards, the read-in-place popover, the like popover,
   `/admin/comments`. Add `userNumber` to the comment DTO and the liker DTO. (If you'd rather it read
   `@u16`, that's one line in the renderer.)
7. **One consequence worth knowing:** the numbers are public and monotonic, so anyone can read your
   approximate reader count off the newest comment and watch it grow. On a personal blog that's
   arguably a feature — `u1` is a badge. If you'd rather not publish the headcount, start the sequence
   at an offset (`START WITH 1000`) and it stops being a count while staying just as short. **Decide
   this before the first real signup** — it's free now and a renumbering later.

   **Decided 2026-08-18: start at 1.** `u1` is a badge; publishing the approximate headcount is
   accepted as a feature rather than a leak. The sequence was reset (`ALTER SEQUENCE
   user_user_number_seq RESTART WITH 1`) against an empty `user` table after verification data was
   cleared, so §4.2.3's "`u1` is the genuine first signup by construction" holds again — testing had
   consumed 1–16 and would otherwise have handed the first real reader `u17`.
8. **Forward path**, not built now: if you ever want custom handles, add a nullable `handle` column
   then and render it in preference to the number. The number stays as the permanent fallback, so
   nothing breaks and nobody is ever without an identity.

### 4.3 The profile stops being a wall

1. **First and last name required, avatar optional.** `src/pages/api/profile.ts:21` already rejects
   empty names and stays exactly as it is; only the `!avatarUrl` rejection at `:24` goes, leaving
   `isValidHttpUrl` for when a URL *is* supplied. `profileComplete` means **both names are set** —
   the number arrives on its own and the avatar no longer gates anything.
2. **Initials monogram fallback.** New `src/lib/avatar.ts` → deterministic inline SVG: initials on the
   site's red→blue gradient, hue-rotated by a hash of the user id so two readers don't collide.
   Deliberately **not** Gravatar — that would ship readers' email hashes to a third party. Initials
   are the first letter of each name.
   New `src/components/Avatar.astro` + a matching client-side helper, used by the comments list, the
   margin column, the like popover, the header menu and `/admin/comments`. Today three places build
   `<img>` by hand.
3. **File upload.**
   - Client: file → `<img>` → `<canvas>` cover-crop to 256×256 → `canvas.toBlob('image/webp', 0.85)`.
     Re-encoding through canvas means the bytes we store are ours — EXIF stripped, no untrusted image
     parser server-side, no `sharp` dependency, and the result is ~20–40 KB.
   - Server: `POST /api/avatar`, session-gated, rejects anything over 512 KB or not `image/webp`,
     then `put()` from `@vercel/blob` with `access: 'public'`, `addRandomSuffix: true`.
   - `avatar_source` (`'upload' | 'url' | null`) lets a replacement `del()` the old blob instead of
     orphaning it.
   - Preserves **R4** from COMMENTS.md §10: still no server-side fetch of a user-supplied URL.
4. **Same field, three inputs.** One control in the dialog and on `/profile`: drop/pick a file, or
   paste a URL, or leave it blank. A pasted URL is previewed by loading it in an `Image()`
   client-side — instant feedback, still no server fetch.
5. **Fold the profile step into the composer.** After OTP verification, if the profile is incomplete,
   the dialog shows first and last name inline on one row (avatar behind an "add a photo"
   disclosure); one Post saves profile *and* comment. `/welcome` survives as a standalone page for
   anyone arriving by an older magic link.
6. **New `/profile` page** so a reader can change their name or avatar later — currently impossible
   once `profileComplete` flips. The reader number is shown there but isn't editable.

### Acceptance criteria

- `name` and `image` no longer exist as columns; sign-in, signup and session reads all still work,
  and existing users' first names and avatars are untouched.
- A new reader can comment having typed **two fields**: first and last name. The avatar never blocks.
- Existing users are numbered by signup date — `u1` is genuinely the first account, not whichever row
  Postgres happened to scan first.
- A brand-new signup gets the next number automatically, with no form field and no code path that can
  fail to assign one.
- Comments render as `Firstname Lastname u16`.
- Signup still succeeds with the name fields empty (the row is created before the profile step); the
  reader simply can't comment until `profileComplete` flips.
- Uploading a 4 MB JPEG results in a stored WebP well under 100 KB, appearing everywhere.
- A pasted `https://…` URL still works exactly as before; replacing an uploaded avatar deletes the old blob.
- A reader with no avatar renders as a monogram in all five places.

## 5. Phase 3 — One hardened email pipeline

Answers feedback #2, and is the structural half of the alignment. Worth doing on its own merits: the
unlimited mailer is a live liability, and it shares a sending reputation with the newsletter.

**Status: done and verified (2026-08-15).** All four acceptance criteria below pass against a real
dev server + Neon. Files: [`src/lib/rate-limit.ts`](src/lib/rate-limit.ts) (shared limiter, one
atomic `INSERT … ON CONFLICT DO UPDATE`), [`src/lib/email-address.ts`](src/lib/email-address.ts),
[`src/lib/honeypot.ts`](src/lib/honeypot.ts), `rate_limit` in
[`src/lib/db/schema.ts`](src/lib/db/schema.ts), plus the `rateLimit` block, the OTP cooldown and the
honeypot `before` hook in [`src/lib/auth.ts`](src/lib/auth.ts). Limits applied to
`/api/subscribe`, `/api/comments` (per-user **and** the new per-IP), `/api/avatar`, `/api/profile`.

Two decisions worth knowing, neither of them in the task list above:

- **`resendStrategy: 'reuse'` was required, not preferred.** Better Auth's default mints a fresh code
  on every send, so suppressing a send during the §5.3 cooldown would have left the reader holding a
  code the server had already replaced. `reuse` resends the same one, which is what makes "quietly
  send nothing" correct rather than broken. Verified: three sends from three IPs left exactly one
  `verification` row.
- **`storeOTP: 'encrypted'`** — one line, not asked for, adjacent to "hardened": the `verification`
  table stops being a list of live sign-in codes. Reuse still works (only the `hashed` option is
  one-way). Drop it if you'd rather stay closer to the spec.

The honeypot and timing checks fire only on *positive* evidence — a filled hidden field, or an
elapsed time present and under 1.5 s. A **missing** signal deliberately passes, because that is what a
page cached from before this shipped sends, and failing closed on it would turn a deploy into a
sign-in outage. Requests that never touch the form are the rate limiter's job.

Not exercised end-to-end: the comment POST limiter, which needs an authenticated session — it calls
the same `consume()` proven twice elsewhere, but it has not been driven through the real route.

### Tasks

1. **Turn on a rate limiter that actually works in serverless** — `src/lib/auth.ts`:

   ```ts
   rateLimit: {
     enabled: true,
     storage: 'database',
     window: 60,
     max: 30,
     customRules: {
       '/email-otp/send-verification-otp': { window: 3600, max: 5 },
       '/sign-in/email-otp':               { window: 300,  max: 10 },
       '/sign-in/magic-link':              { window: 3600, max: 5 },
     },
   }
   ```

   Database storage needs a `rateLimit` model in `src/lib/db/schema.ts`. Shape read off
   `better-auth/dist/api/rate-limiter/index.mjs`: `key` (text), `count` (integer),
   `lastRequest` (**bigint, epoch milliseconds** — it is compared numerically against `Date.now()`,
   not a timestamp), plus a text `id` primary key. Push with `drizzle-kit push`.

2. **Extract the duplicated primitives** — the newsletter already solved these once:
   - `src/lib/email-address.ts`: `normalizeEmail()` and `isValidEmail()`, lifted out of
     `src/pages/api/subscribe/index.ts:26`. Used by subscribe, the OTP path and profile.
   - `src/lib/rate-limit.ts`: one Neon-backed limiter replacing the two ad-hoc "count recent rows"
     queries (`subscribe/index.ts` counting `subscriber` rows by IP, `comments/index.ts` counting
     `comment` rows by user). Applied to: subscribe, comment POST (**add per-IP** — it only limits
     per-user today), likes (phase 6), `/api/avatar`, `/api/profile`.
3. **Per-address OTP cooldown**, mirroring `subscriber.confirmSentAt`: the same address can't be
   mailed a fresh code more than once every 60 s regardless of source IP. The Better Auth limiter is
   keyed by IP and therefore protects *us*; this protects the *recipient* from being mailbombed.
4. **Honeypot + submit timing** on both the subscribe form and the sign-in dialog: a hidden field
   real people never fill, and rejection of submissions faster than ~1.5 s. Free, no CAPTCHA, no
   privacy cost. `better-auth/plugins/captcha` (Turnstile) stays in reserve if real abuse appears.
5. **Match the newsletter's enumeration-safety.** `/api/subscribe` deliberately returns an identical
   200 whether or not the address is known (`subscribe/index.ts:61`). The OTP send endpoint must
   behave the same way — never reveal whether an address already has an account.

### Acceptance criteria

- ✅ Six OTP requests within an hour from one IP → the sixth gets 429. *(5 × 200 then 429 on the 6th
  and 7th. Five got through rather than the plugin's own default of three, which is what proves the
  `customRules` entry overrode the plugin rule.)*
- ✅ The same address can't be sent two codes inside 60 s even from different IPs. *(Three sends from
  203.0.113.1/.2/.3: each IP's own Better Auth bucket shows `count 1` — so the per-IP limiter stopped
  none of them — while `app:otp-send:<hash>` counted all three and allowed one. Exactly one
  `verification` row remained.)*
- ✅ Rate-limit state survives across Vercel invocations (i.e. the `rateLimit` table has rows).
  *(Rows present under both namespaces, `${ip}|${path}` and `app:*`, with no collision. Blocked
  attempts bump `count` but leave `last_request` alone, so hammering the button cannot push your own
  unlock further away.)*
- ✅ Requesting a code for a known vs. unknown address produces byte-identical responses. *(Identical
  status, body and headers. Structural, not incidental: `shouldSendOTP` is
  `type === 'sign-in' && !disableSignUp`, so with sign-up enabled both branches end in
  `{ success: true }` — setting `disableSignUp` later would silently reintroduce a difference.
  Residual: the known path does a `findUserByEmail` that hits and the unknown one misses, so a timing
  side-channel is not ruled out; the criterion as written is about the response.)*

## 6. Phase 4 — Plain comments

Closes the structural gap: today a comment cannot exist without a text selection. It ships **before**
phase 5 so the reading surfaces are built once, against both comment kinds, instead of retrofitted.

**Status: done; server and client both verified (2026-08-18).** Files:
[`src/lib/db/schema.ts`](src/lib/db/schema.ts) (anchor columns nullable),
[`src/pages/api/comments/index.ts`](src/pages/api/comments/index.ts) (anchor branching),
[`src/components/CommentsSection.astro`](src/components/CommentsSection.astro) (plain composer, three
list states, `submitComment` extracted so both composers share one auth-retry),
[`src/pages/admin/comments.astro`](src/pages/admin/comments.astro).

One thing §6 didn't call out that had to be fixed: `/admin/comments` rendered `anchorExact` in a
bordered quote bar unconditionally, which for a plain comment would have drawn an **empty** quote bar
on every row. It now shows "On the post as a whole" instead.

**The client-side half is now verified** (2026-08-18), against a real dev server + Neon with three
seeded comments — one of each list state. The earlier blocker was environmental, not real: the browser
reaches the dev server fine; what failed before was a *port* mismatch. Two things to know for anyone
repeating this:

- **`auth.ts:13` hardcodes the dev `baseURL` and `trustedOrigins` to `http://localhost:4321`.** A dev
  server on any other port serves pages normally but cannot complete auth — the origin isn't trusted.
  So verification must run on 4321, and `astro dev` silently falling through to 4322 when 4321 is
  taken is enough to break sign-in with no obvious cause.
- **The margin column only populates on a `resize` after the viewport has a real width.**
  `positionMarginAvatars()` bails when `innerWidth < 1024`; a headless pane reporting width 0 clears
  the column and does not re-run on its own.

One leg of the first criterion is still open, and it is blocked on a decision rather than on work —
see the criterion itself.

### Tasks

1. **Schema.** `comment.blockIndex` and `comment.anchorExact` become **nullable**. A row with
   `anchorExact = null` *is* a plain comment — no separate type column, no discriminator to keep in
   sync. Dropping `NOT NULL` is non-destructive, so `drizzle-kit push` handles it.
2. **`POST /api/comments` branches on the anchor.**
   - No `anchorExact` → plain: require `slug`, `lang`, `body` only; store `blockIndex: null` and all
     anchor fields `null`.
   - `anchorExact` present → validation exactly as today.
   - Reject a request carrying *some* anchor fields but not `anchorExact` — a half-anchor is a bug in
     the caller, not a comment kind.
   - The existing per-user rate limit covers both without change.
3. **`GET /api/comments`** is unchanged in shape; `blockIndex` / `anchorExact` are now nullable in the
   DTO. Sort stays `createdAt` ascending, both kinds interleaved.
4. **Three list states, not two** — this is the part that will silently break if it's missed.
   `buildListItem(c, hasSource)` currently renders "Original passage no longer available." for
   *every* comment without a resolved mark, which would fire on all plain comments and read as an
   error. The states are now:

   | Condition | Rendering |
   | --- | --- |
   | `anchorExact === null` | Plain. No quote, no "Go to source", **no note.** |
   | `anchorExact` set, anchor resolves | Quote + "Go to source →" (and the margin card in phase 5). |
   | `anchorExact` set, anchor doesn't resolve | Orphaned. Keep today's "Original passage no longer available." note — this is **R3** and must stay. |

5. **Composer at the top of the comments section**: the reader's avatar next to a `Leave a comment…`
   textarea that expands on focus, with a Post button. Uses the same *type first, authenticate at
   Post* flow as phase 1 — it opens the same `AuthDialog` and resumes the same way.
6. **`loadComments()` skips anchor resolution** for rows with `anchorExact === null` — no
   `resolveAnchor` call, no `<mark>`, no entry in `resolved`, so they never reach the margin column.
7. **Reword the empty state.** `#comments-empty` currently reads "No comments yet — select any text
   above to leave the first one," which stops being the whole truth. Something like "No comments yet —
   leave one below, or select any passage above to comment on it directly."

### Acceptance criteria

- 🟡 A signed-out reader types in the plain box, hits Post, authenticates inline, and the comment
  appears — no text selection involved anywhere. **Verified up to the sign-in itself:** the textarea
  is shown while signed out, Post opens `AuthDialog` over the composer, and the draft survives in the
  textarea with no error. The server half was already proven (a payload with no anchor fields returns
  201 and stores nulls across every anchor column). **Unverified: the resume leg** — that a successful
  OTP actually lands the held draft. There is no way to exercise it locally without sending a real
  email: `sendOtpEmail` calls Resend unconditionally (no dev short-circuit) and `storeOTP: 'encrypted'`
  means the code cannot be read back out of `verification`. Cheapest fix, if this is to stay testable:
  in `sendOtpEmail`, `console.log` the code instead of sending when `import.meta.env.DEV`.
- ✅ Plain comments show **no** "Go to source" button and **no** "passage no longer available" note.
  *(The §6.4 trap, checked by element and not by text: the plain row has zero `<button>`s and zero
  nodes reading "Original passage no longer available.")*
- ✅ An anchored comment whose passage was edited away still shows that note (R3 unbroken). *(A row
  anchored to text absent from the post renders the note and no "Go to source" button.)*
- ✅ Plain comments produce no `<mark>`, no margin avatar and no margin card. *(With one plain, one
  resolving and one orphaned comment on the page, exactly one `mark.comment-highlight` exists and it
  carries the resolving comment's id; at 1440px the margin column holds exactly one avatar, titled
  "Umiar Iusupov u1" — so the plain and orphaned rows reach neither surface.)*
- ✅ Both kinds interleave correctly by date in one list. *(One plain + two anchored posted through
  the real route, returned by `GET` in ascending `createdAt` order with the plain row carrying
  `blockIndex: null, anchorExact: null` and no row half-set.)*
- ✅ `/admin/comments` lists and moderates both kinds without change. *(3 total; one "On the post as
  a whole" marker, two quote bars, Hide/Delete on all three.)*

Also verified, though not written as criteria: a payload carrying `blockIndex`, `anchorPrefix` **or**
`anchorOffsetHint` without `anchorExact` is rejected 400 in all three shapes (§6.2's half-anchor
rule), and an empty body is still 400.

## 7. Phase 5 — Read comments without jumping

Answers feedback #4.

**Status: built and verified (2026-08-18)** against a real dev server + Neon with ten seeded comments
— five anchored-and-resolving, one orphaned, four plain. Files:
[`src/components/CommentsSection.astro`](src/components/CommentsSection.astro) (read popover, margin
cards, hover sync, quoted list items, collapsed list),
[`src/styles/global.css`](src/styles/global.css) (card, sheet and `.is-active` styles, the 2xl column
shift), [`src/layouts/PostLayout.astro`](src/layouts/PostLayout.astro) (`post-column` hook).

Three deviations from the task list, all deliberate:

- **The sort toggle is not built.** §7.5 asks for Newest / Most liked, noting that "until then the
  toggle is Newest only" — a toggle with one option is a control that does nothing, so the list ships
  sorted newest-first with the *collapse* (§7.5's other half) fully working, and the toggle lands in
  phase 6 alongside the counts that give it a second option. `renderList()` is where it goes.
- **The bottom list is now newest-first.** The API still returns `createdAt` ascending (§6.3) and the
  margin column still follows document order; only this list is reversed, because "show me the latest
  five" is what it is for. Worth knowing before phase 6 sorts it again.
- **`goToListItem()` is gone**, not just unhooked. Nothing called it once highlights opened a popover
  instead of scrolling, and the margin avatars moved to the same popover for consistency — a bare
  avatar that scrolled while a card next to it opened in place would be an odd pair of behaviours.
  `goToSource()` (list → passage) stays; that direction was never the complaint.

### Tasks

1. **Click a highlight → the comment opens in place.** `mark.comment-highlight`'s click handler
   currently calls `goToListItem()`, which scrolls. Replace with a read-only popover anchored to the
   span, reusing the positioning helpers already written for the composer (`anchorToSelection`,
   `dock`, `clamp` in `CommentsSection.astro`). On coarse pointers, a bottom sheet instead. This
   alone removes most of the bouncing.
2. **Comment cards in the margin, not just avatars.** Avatar + name + number + body clamped to
   three lines, aligned to its highlight, collision-stacked. The stacking loop at
   `CommentsSection.astro:233` already does the hard part and only needs a width.

   **Space budget** (measured against the current layout: `max-w-7xl` + `lg:px-24`, prose
   `max-w-2xl`): at a 1280px viewport there are ~208px of margin — too tight for a readable card.
   So:

   | Viewport | Treatment |
   | --- | --- |
   | `< lg` (1024) | Highlight → bottom sheet. No side column. |
   | `lg`–`2xl` | Bare avatars as today; click → popover. |
   | `≥ 2xl` (1536) | Full cards, ~320px, with the prose column shifted left inside the container to open the room. |

   The prose shift is the only layout change and it is confined to `2xl`, so nothing below it moves.
3. **Two-way hover sync.** Hovering a card or a list item strengthens its highlight; hovering a
   highlight lifts its card. Cheap, and it's what makes the pairing legible.
4. **Show the quote in the list item.** An anchored comment in the bottom list currently gives no hint
   of what it's about until you jump. Render the stored `anchorExact` above the body as a short
   clamped blockquote — the same treatment `#comment-popover-quote` already uses. Often removes the
   need to jump at all, and costs nothing: the text is already in the payload.
5. **Bottom list: newest 5 + "Show all (N)"**, with a sort toggle — **Newest / Most liked** (phase 6
   provides the counts; until then the toggle is Newest only). This is the reader's "последние три или
   пять или самые залайканые" idea.

### Acceptance criteria

- ✅ Clicking a highlight shows its comment **without the page scrolling at all**. *(`scrollY`
  identical before and after the click, popover open with the right comment. Same for a click on a
  margin card.)*
- ✅ At ≥1536px, comment text is readable beside the passage it refers to, with no overlap between
  stacked cards and no horizontal overflow. *(At 1536 and 1600: prose 672px wide, a 320px card column
  beside it, `scrollWidth === innerWidth`. Five cards of differing measured heights, zero overlapping
  pairs — including two anchored to the **same line**, where the second is pushed exactly one card
  height + 8px gap below the first. That case is why cards are appended before being measured: unlike
  the fixed-size avatars, a card's height depends on how its body wraps.)*
- ✅ Between 1024 and 1536px nothing regresses versus today. *(At 1280: bare avatars, the post column
  still centred — the `post-column` rule is inert below 2xl — and no overflow.)*
- ✅ On a phone, tapping a highlight opens a sheet, not a scroll jump. *(375×812 with touch emulation:
  `pointer: coarse` matches, the panel spans the full width and docks to the bottom edge, `scrollY`
  unchanged, and the margin column is `display: none`.)*
- ✅ An orphaned anchor (**R3**) still degrades silently: comment listed, no highlight, no card, no
  error. *(Still listed with its note and its quote; no `<mark>` and no margin card.)*
- ✅ Plain comments (phase 4) appear only in the bottom list, never in the margin. *(With ten comments
  the margin holds exactly the five anchored-and-resolving ones.)*

Also verified: the collapsed list shows the newest 5 with "Show all (10)", expands to all ten with
"Show fewer", and collapses back; hovering any one of highlight / card / list item marks all three
`is-active`, and clears on leave.

## 8. Phase 6 — Likes

The reader floated this as a "if you ever add it" — it's in. COMMENTS.md §11 listed reactions as out
of scope for v1; that is **reversed** here.

**Status: built and verified (2026-08-18)**, server and client, against a real dev server + Neon.
Files: `comment_like` in [`src/lib/db/schema.ts`](src/lib/db/schema.ts),
[`src/pages/api/comments/[id]/like.ts`](src/pages/api/comments/[id]/like.ts) (toggle),
[`src/pages/api/comments/index.ts`](src/pages/api/comments/index.ts) (inline like data on GET),
[`src/components/CommentsSection.astro`](src/components/CommentsSection.astro) (control on all three
surfaces, likers popover, sort toggle), [`src/styles/global.css`](src/styles/global.css).

Two things §8 didn't anticipate:

- **The heart and the count are separate controls.** §8.4 wants a press to like; §8.6 wants a tap to
  show the likers. Folded into one button those are the same gesture on a phone. So the heart toggles
  and the count — rendered only above zero, which also satisfies "count hidden at zero" for free —
  opens the popover on hover (mouse) or tap (touch).
- **The sort toggle from §7.5 ships here**, not in phase 5, because this is the phase that gives it a
  second option. Deferred deliberately rather than shipping a one-option control; see §7's status note.

### Tasks

1. **Schema — `commentLike`:**

   ```ts
   id, commentId → comment.id (cascade), userId → user.id (cascade), createdAt
   uniqueIndex('comment_like_comment_user_idx').on(commentId, userId)
   ```

   As with `subscriber_email_idx` and `broadcast_post_slug_idx`, **the unique index is the actual
   guard** against a double-like from a double-click or two concurrent requests; the check in the
   route exists only to return a friendlier response. Cascade on both FKs means deleting a comment or
   a user takes their likes with it.
2. **`POST /api/comments/[id]/like`** — toggles. 401 signed out, 404 if the comment doesn't exist or
   isn't `status: 'visible'`. Returns `{ liked, count }`. Goes through the shared limiter from phase 3
   keyed per user — a toggle is trivially spammable and each press is a write.
3. **`GET /api/comments` carries the like data inline**, per comment: `likeCount`, `likedByMe`, and
   `likers` — up to 12 `{ name, lastName, userNumber, avatarUrl }` — plus `likerOverflow`. Inline rather
   than a fetch per comment: at this blog's volume it's one extra query (fetch all likes for the
   returned comment ids, merge in JS — no lateral join, no N+1) and the popover then opens with zero
   round trip. Past 12 likers the popover shows "+N more" and doesn't expand; fine for v2.
4. **Like button on every comment surface** — bottom-list item, margin card, and the read-in-place
   popover from phase 5. Optimistic toggle, revert on error. Count hidden at zero.
5. **Signed out → `AuthDialog`**, then the like is applied automatically on success. Identical to the
   Post path from phase 1; no second click.
6. **Who-liked popover.** Hover on fine pointers, tap on coarse. Avatar + name + number only — no
   dates, no profile links, nothing clickable. Uses the same `Avatar` component, so monograms work.
7. **Enables the "Most liked" sort** in the phase 5 list toggle. Ties break by newest.
8. **Self-likes are allowed** — no special case. Blocking them costs a branch everywhere and buys
   nothing.

### Acceptance criteria

- ⚠️ ~~Double-clicking Like leaves exactly one row~~ — **this criterion is wrong as written, and was
  rewritten rather than satisfied.** On a *toggle*, two presses mean like-then-unlike, so a genuine
  double-click correctly leaves **zero** rows, not one; two sequential requests were observed doing
  exactly that. What the criterion was actually protecting against — two rows — holds: a direct
  duplicate insert is rejected by `comment_like_comment_user_idx`, so it is the unique index and not
  the route's read-then-write that makes concurrency safe, which is what §8.1 claimed. The route uses
  `onConflictDoNothing` so a true race resolves to one row and both callers still get a coherent
  answer.
- 🟡 Clicking Like signed out opens the dialog and the like lands after authentication, without a
  second click. **Verified up to the sign-in:** the press opens `AuthDialog` reading "Sign in to like
  this comment", and the optimistic state is rolled back while the dialog is up so the reader isn't
  looking at a like that hasn't happened. **The leg after a successful OTP is unverified**, blocked on
  exactly the same thing as phase 4's first criterion — see there.
- ✅ The popover shows likers' avatars, names and numbers, monogram included, and "+N more" past 12.
  *(14 likers on one comment → 12 rows with avatar, name and `uN`, plus "+2 more". Likers carry `id`
  as well as the fields §8.3 lists, so the monogram seeds the same way it does elsewhere.)*
- ✅ "Most liked" reorders the bottom list; ties fall back to newest. *(14, then 1, then the zeros in
  newest-first order.)*
- ✅ Deleting a comment from `/admin/comments` removes its likes (cascade, no orphan rows). *(Deleting
  the comment row took its like with it; a left join across the whole table finds zero orphans.)*
- ✅ Rapid toggling is rate-limited rather than writing unbounded rows. *(34 rapid presses: exactly 30
  × 200 then 4 × 429.)*

Also verified: the like control renders on all three surfaces and a press updates every one of them
at once; counts are hidden at zero; an optimistic toggle that fails is rolled back (`liked/1` →
`unliked/0` → back to `liked/1` on a 429); a hidden comment answers 404 exactly like one that does not
exist.

## 9. Phase 7 — Subscribe from the sign-in dialog

The one alignment piece in scope.

**Status: built and verified (2026-08-18)**, with one deliberate departure from §9.1 below. Files:
`subscriber.source` in [`src/lib/db/schema.ts`](src/lib/db/schema.ts),
[`src/pages/api/subscribe/me.ts`](src/pages/api/subscribe/me.ts) (new, session-gated),
[`src/pages/api/subscribe/index.ts`](src/pages/api/subscribe/index.ts) (writes `'footer'`),
[`src/components/AuthDialog.astro`](src/components/AuthDialog.astro).

**§9.1 and §9.5 contradict each other, and §9.5 lost its placement argument.** §9.1 puts the checkbox
on the code-entry step; §9.5 wants an already-subscribed reader to see that state instead of a no-op
checkbox. But subscription state can only be known once there is a session, and the code step is
*before* the reader has proven anything — looking the typed address up there would answer "does this
address read this blog?" to anyone who can type one, which is precisely the enumeration hole §5.5
closed on the OTP endpoint.

Built first exactly as §9.1 says, this was not a theoretical problem: the state resolved correctly and
rendered on an element that was **not visible**, because the only case that can compute it is the one
where the dialog opens on the *profile* step. So the checkbox now lives outside the step containers
and shows on both `code` and `profile` — unchecked and inert before sign-in, real state after it. One
checkbox, no lookup on an unproven address, and §9.5 is actually reachable.

The new endpoint only ever reads the address off the session, never one supplied in a payload, so it
cannot be turned into the oracle `/api/subscribe` deliberately isn't.

### Tasks

1. **Checkbox in `AuthDialog`**, on the code-entry step: *"Also email me when there's a new post."*
   **Unchecked by default.**
2. **On successful OTP verification with the box ticked**, upsert into `subscriber` as
   `status: 'confirmed'`, `confirmedAt: now`, with a fresh `unsubscribeToken` — **and no confirmation
   email**. The reader retrieved a code from that inbox seconds earlier; that is stronger proof of
   control than clicking a link, so the double opt-in requirement is already met by a better means.
3. **Add `subscriber.source text`** (`'footer' | 'signin' | 'welcome'`) as consent evidence alongside
   the existing `signupIp` / `createdAt` (GDPR art. 7(1) — the sender carries the burden of proof).
   No backfill needed — the table is empty (§2). `src/pages/api/subscribe/index.ts` must start writing
   `'footer'` on its insert, or the column is never populated from the footer path at all.
4. **Never silently re-subscribe.** If a row exists with `status: 'unsubscribed'`, ticking the box
   does resubscribe them — that's an explicit act — but an existing `'confirmed'` row is left
   untouched, and an unticked box must never change subscription state in either direction.
5. **Show current state.** If the signed-in reader's address is already `confirmed`, render the
   checkbox ticked and disabled with "You're already subscribed" rather than offering a no-op.

### Acceptance criteria

- 🟡 Ticking the box during sign-in produces a `confirmed` subscriber row and **zero** extra emails.
  **The row is verified**: `POST /api/subscribe/me` on a real session lands `status: 'confirmed'`,
  `source: 'signin'`, `confirmed_at` set, `confirm_token` null and a fresh 43-char unsubscribe token.
  **Zero emails is structural** — the route imports no mailer at all, so there is no path from it to
  Resend. Unverified: the wiring from the tick to that call, which only runs after a successful OTP.
- 🟡 Leaving it unticked produces no subscriber row at all. Guaranteed by construction rather than by
  test: `applySubscription()` returns before issuing any request when the box is clear, and this
  endpoint is the only thing that writes a `'signin'` row. Not exercised end-to-end, same OTP blocker.
- ✅ An already-subscribed reader sees that state instead of an actionable checkbox. *(Dialog opened
  on a session whose address is `confirmed`: checkbox checked, **disabled**, labelled "You're already
  subscribed." and — after the placement fix above — actually visible. Signed out it is unchecked,
  enabled, default label, and hidden entirely on the email step.)*
- ✅ The next broadcast reaches addresses that subscribed this way, each with a working unsubscribe
  link. *(The broadcast recipient query is `status = 'confirmed'`, which selects the `'signin'` row;
  `POST /api/unsubscribe` with that row's token returns "Unsubscribed." and flips it to
  `unsubscribed` with `unsubscribed_at` set. The GET on that URL only redirects to a confirmation
  page, so a mail scanner following the link cannot unsubscribe anyone.)*

Not exercised: `/api/subscribe` writing `source: 'footer'`. Driving it end-to-end means letting it
send a real confirmation email, which was out of bounds for this session — the write itself is one
field on the existing insert.

## 10. Sequencing

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7`.

- **1 + 2 ship together** — they're what the reader actually experienced, and phase 2 rebuilds the
  form phase 1 introduces. Phase 2 is the larger of the two, but with an empty database its schema
  work is a rewrite-and-push rather than a migration.
- **3 is independently justified** and shouldn't be deferred behind visual work; the unlimited mailer
  is live right now.
- **4 before 5** so the reading surfaces are written against both comment kinds from the start.
- **6 after 5** because the like button lives inside the card and popover that phase 5 builds.
- **7 is separable** and can land any time after phase 1.

## 11. Superseded / changed from COMMENTS.md

- **§2 "Login methods: Telegram + email magic link"** → email is now **OTP-first**; magic link is
  retained only so links already in inboxes keep working. Telegram
  ([`telegram-auth.md`](telegram-auth.md)) is still unbuilt and still blocked on bot creation; it
  remains the strongest answer to "the inbox is an extra trip" and is worth doing after this spec.
- **§2 "Profile fields: first name, last name, photo URL"** → both names stay **required, unchanged**;
  only the photo changes — now **optional and uploadable**. Adds an auto-assigned reader number nobody
  has to fill in. The `user` table loses its two dead columns in the process (§4.1).
- **§2 "Threading: flat, one comment per selected range"** → still flat and still no replies, but a
  comment no longer needs a range at all (phase 4).
- **§4 data model** → `user` gains `user_number` and `avatar_source` and loses `name` and `image`;
  `comment.block_index` and `comment.anchor_exact` become nullable; `comment_like`, `rate_limit` and
  `subscriber.source` are new.
- **§10 R4 "photo URL is unvalidated by nature"** → still true for pasted URLs, but uploads are now
  first-party and normalized through a canvas re-encode.
- **§11 out of scope: "in-CMS or hosted photo upload"** → **reversed**, phase 2 adds it via Vercel Blob.
- **§11 out of scope: "reactions/likes on comments"** → **reversed**, phase 6.
- **§11 out of scope: threading/replies, editing your own comment** → **unchanged**, still out.
