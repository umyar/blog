# blog.umyar.com — Comments & Auth

> **For the executing agent (Claude Sonnet 5, high effort).** This is the build spec for comments + auth on `blog.umyar.com` — a Google-Docs-style, text-anchored commenting system. It's self-contained: locked decisions, prerequisites, data model, and design reference are all below. Work sub-phase by sub-phase; don't advance to the next until the current one's acceptance criteria pass.

---

## 0. Status (2026-07-22)

| Sub-phase | State |
| --- | --- |
| A — Auth + profile completion | 🟡 **Email magic link done + verified end-to-end.** Telegram login (§5 task 3) not started — blocked on the bot not existing yet. |
| B — Stable block indices | ✅ **Done and tested** — rendering + resolve/capture helpers, proven both standalone and through sub-phase D's real usage. |
| C — Comment API | ✅ **Done and tested**, including author-or-admin `DELETE`. |
| D — Selection UI / margin avatars / bottom list | ✅ **Done and tested** (email login path only — Telegram still pending, see sub-phase A). |
| E — Moderation | ✅ **Done and tested.** Two of three tasks landed in sub-phase C already (allowlist, rate limiting) — see status note. |

Only Telegram login is left before the whole spec is done — its implementation plan now lives in a separate file, [`telegram-auth.md`](telegram-auth.md) (split out since it's blocked on external setup and has enough of its own detail — bot creation, the HMAC verification algorithm, the no-email design decision — to warrant its own doc). That file being written does **not** mean this task is done; it's still open until that plan is actually built and verified. Details and file list for everything else are inline in each sub-phase below (look for "**Status:**").

**One thing still needs your input:** `ADMIN_USER_IDS` is set locally to your account's id from testing — carry it into Vercel's env vars (and add any other admins) before deploying.

(The `DELETE` authorization question — author-or-admin vs. admin-only — is resolved: you confirmed authors can delete their own comments, admins can delete any. See the sub-phase C note.)

---

## 1. Goal

Readers select a span of text inside a post's prose column and attach a comment to it, the way Google Docs / Medium margin notes work:

- **Selecting text** → a small "Add comment" bubble appears near the selection.
- **Avatars in the right margin**, vertically aligned next to the highlighted range they belong to (desktop only).
- **The same comments also listed at the bottom of the post**, one by one, sorted by date, each with a **"Go to source"** button that scrolls the article to the highlighted range and flashes it.
- **Auth required to comment** (not to read them). First-time users complete a short profile (first name, last name, photo URL) once; afterwards the same account is reused — no repeat profile step.

## 2. Locked decisions (do not re-litigate — confirmed with the user)

| Area               | Choice                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site stack         | Existing repo: **Astro**, `output: 'static'` + Vercel adapter. Keep it static — only comment/auth/admin routes opt in via `export const prerender = false`. Don't flip the whole site to SSR.       |
| Login methods      | **Telegram Login Widget + Email magic link** — no passwords.                                                                                                                                       |
| Profile fields     | Collected **once**, right after a brand-new account's first successful login: **first name, last name, photo URL** (a pasted link, not an upload — same "paste-a-URL" pattern already used for post audio). |
| Anchoring strategy | **Robust text-quote anchoring with graceful fallback** — store the selected text + surrounding prefix/suffix context (Web Annotation style). If a later post edit removes the quoted text, drop the margin marker silently but keep the comment visible in the bottom list. |
| Mobile layout      | **Margin avatars are desktop-only.** Below the breakpoint, highlighted spans still render inline (subtle underline/background) but there's no side column; tapping a highlight jumps to that comment in the bottom list instead. |
| Threading          | **Flat, v1.** One comment per selected range. No replies/parent_id. Can be added later if needed.                                                                                                  |
| DB / ORM / auth    | **Neon** (serverless Postgres) + **Drizzle** (ORM) + **Better Auth**, comments API as Astro server routes.                                                                                         |
| Design             | Match the existing site exactly: **Montserrat**, black text on white, signature red→blue gradient (`linear-gradient(to left, #dc2424, #4a569d)`) for accents/headings. Tokens already live in `src/styles/global.css` (`--text`, `--bg`, `--theme`, `--grad`, `.gradient-text`, `.prose`) — reuse them, don't redefine. |

## 3. Prerequisites & secrets

Create accounts / obtain tokens and put them in `.env` (local) + Vercel project env vars (prod). **Never commit `.env`.** The repo's `.env.example` already lists the needed keys (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_TELEGRAM_BOT_USERNAME`, `RESEND_API_KEY`, `EMAIL_FROM`) — fill in real values as each sub-phase needs them.

External setup checklist:

- ⬜ **Telegram bot**: @BotFather → new bot → save token → `/setdomain` = `blog.umyar.com` (required for the Telegram Login Widget to work at all — verify this before debugging the callback). **Not created yet — blocks §5 task 3.**
- ✅ **Neon**: create project + database, copy the pooled `DATABASE_URL`. `DATABASE_URL` is set in local `.env`; schema pushed via `drizzle-kit push`.
- ✅ **Resend**: verify the sending domain (`umyar.com` or a subdomain); create an API key. `RESEND_API_KEY`/`EMAIL_FROM` set; a real magic-link send succeeded with no API error during testing (no inbox delivery check performed).
- ⬜ **Vercel**: add all of the above as env vars on the project once obtained. Only done locally so far — nothing pushed to the Vercel project's env vars yet.

## 4. Data model (Drizzle / Neon)

Better Auth manages its own `user` / `session` / `account` / `verification` tables. Extend `user` with profile fields, and add one flat `comment` table.

```
user (Better Auth managed + extra columns)
  ...
  first_name        text null
  last_name         text null
  avatar_url        text null
  profile_complete  boolean not null default false   -- gates commenting until filled in

comment(
  id                text pk,
  post_slug         text not null,
  lang              text not null,             -- comments are per (slug, lang), never shared across languages
  user_id           text not null -> user.id,
  block_index       int not null,              -- stable index of the content block the quote lives in (see §6)
  anchor_exact      text not null,              -- the selected/highlighted text
  anchor_prefix     text,                       -- ~30 chars of context immediately before the selection
  anchor_suffix     text,                       -- ~30 chars of context immediately after the selection
  anchor_offset_hint int,                       -- rough char offset within the block; tiebreaker only, never authoritative
  body              text not null,              -- plain text; render escaped
  status            text not null default 'visible',  -- 'visible' | 'hidden' | 'pending'
  created_at        timestamptz default now()
)
```

No `parent_id` — v1 is flat. `block_index` + prefix/suffix context resolve the common case where the same short phrase ("yes", "exactly", a repeated word) appears more than once in a post; scoping the search to one block plus context makes false matches rare.

## 5. Sub-phase A — Auth + profile completion

**Status: email magic link done and verified (2026-07-21). Telegram (task 3) not started — plan in [`telegram-auth.md`](telegram-auth.md), blocked on the bot existing.**

Files: [`src/lib/db/schema.ts`](src/lib/db/schema.ts) (Better Auth tables + profile columns + `comment` table), [`src/lib/auth.ts`](src/lib/auth.ts) (Better Auth + Drizzle adapter + magic-link plugin), [`src/lib/email.ts`](src/lib/email.ts) (Resend sender), [`src/lib/auth-client.ts`](src/lib/auth-client.ts), [`src/lib/validate.ts`](src/lib/validate.ts) (shared `http(s)`-only URL check), [`src/pages/api/auth/[...all].ts`](src/pages/api/auth/%5B...all%5D.ts) (Better Auth's Astro handler), [`src/pages/welcome.astro`](src/pages/welcome.astro) + [`src/pages/api/profile.ts`](src/pages/api/profile.ts) (profile-completion gate), [`src/components/AuthWidget.astro`](src/components/AuthWidget.astro) (login/signed-in status, wired into a real post page for testing).

In dev (`import.meta.env.DEV`), `baseURL`/`trustedOrigins` in `auth.ts` auto-switch to `localhost:4321` so magic links are clickable locally without touching the prod `BETTER_AUTH_URL`.

**Bug caught + fixed during testing:** the schema originally used plain `timestamp` columns. The neon-http driver round-trips those using the server process's local offset instead of UTC, which silently shifted `expires_at` by an hour — magic-link tokens would have looked expired almost immediately. Fixed by switching every timestamp column to `timestamptz` (`{ withTimezone: true }`).

Verified via a mix of the real browser and direct calls to the auth API: new-user sign-in → session created with `profile_complete: false` → redirected to `/welcome` → profile saved (`javascript:` avatar URL rejected with 400, `https://` URL accepted) → `profile_complete: true`. A second sign-in for the same email skips `/welcome` and goes straight back to the post. A tampered or replayed magic-link token is rejected with no session granted. The widget shows "Signed in as …" / sign-out correctly, and sign-out clears the session cookie.

Not done: Telegram login (task 3 below), and the "Telegram callback rejects a tampered/replayed payload" acceptance criterion (needs the bot to exist first).

**Tasks**

1. Install + configure **Better Auth** with the Drizzle adapter, pointed at Neon. Run its schema migration; add the `first_name` / `last_name` / `avatar_url` / `profile_complete` columns from §4.
2. **Email magic link**: enable Better Auth's magic-link plugin, send via **Resend**. Verify deliverability with a real send.
3. **Telegram login**: render the official Telegram Login Widget (`PUBLIC_TELEGRAM_BOT_USERNAME`). On callback, POST the widget payload to `/api/auth/telegram`; **verify the HMAC-SHA256 hash server-side** using `TELEGRAM_BOT_TOKEN` (standard Telegram data-check-string algorithm), reject stale `auth_date`. On success, upsert the Better Auth user and create a session. Implement as a custom verified credential, not a generic OAuth plugin — Telegram isn't OAuth2.
4. **Profile-completion gate**: after a session is created for a **brand-new** user (`profile_complete = false`), show a one-time modal/page asking first name, last name, photo URL (plain URL input — validate it looks like an `http(s)` URL, not `javascript:`; no file upload, no image hosting). On submit, set `profile_complete = true`. Returning users with `profile_complete = true` skip this entirely on future logins.
5. Any comment-writing action checks `profile_complete`; if false, redirect back into the completion flow instead of accepting the comment.

**Acceptance criteria**

- ✅🟡 A first-time visitor can sign in via **either** Telegram or email magic link, is prompted exactly once for name/last name/photo URL, and lands back on the post afterward. *(verified for email; Telegram not built yet)*
- ✅🟡 A returning user (already `profile_complete`) logs in via either method and is never shown the profile form again. *(verified for email; Telegram not built yet)*
- ⬜ Telegram callback rejects a tampered/replayed payload (bad hash or stale `auth_date`). *(blocked — bot doesn't exist yet)*
- ✅ `avatar_url` accepting a non-image or `javascript:` URL is rejected client- and server-side (scheme allowlist: `http:`/`https:`).

## 6. Sub-phase B — Stable block indices for anchoring

**Status: rendering + client helpers done and tested (2026-07-22). The "Add comment" UI itself is sub-phase D.**

Files: [`src/lib/posts.ts`](src/lib/posts.ts) (`assignBlockIndices` — tags each top-level Markdoc-rendered block with sequential `data-block-index`, wired into `renderPostBody`), [`src/lib/anchor.ts`](src/lib/anchor.ts) (`resolveAnchor` — resolves a stored anchor back to a live `Range`, for both highlight-wrapping and `getBoundingClientRect()` positioning in sub-phase D), [`src/lib/selection.ts`](src/lib/selection.ts) (`captureSelection` — the reverse direction: turns the current window selection into `{blockIndex, exact, prefix, suffix, offsetHint}`, returning `null` for empty or cross-block selections).

Verified live against the real post (`/posts/en/my-1st-year-in-portugal`, 37 blocks tagged): capture → resolve round-trips to the exact selected text; cross-block selection → `null`; orphaned text / nonexistent block → `null`, no throw.

**Bug caught + fixed:** when a selection sits at the very start or end of a block, `prefix` or `suffix` is empty, which made the primary "with context" match degenerate to a bare `exact` search — but that path wasn't using `offsetHint` to disambiguate duplicates, only the separate fallback path was. Fixed so both the context search and the fallback pick the occurrence nearest `offsetHint` (verified with a synthetic block containing "yes" three times).

Selection-based anchoring needs a stable coordinate system that survives re-renders but is cheap to compute. Rather than raw DOM offsets (which shift with any markup change), tag each **top-level block** of the rendered post body (`<p>`, `<li>`, `<blockquote>`, `<h2>`, `<h3>`, etc.) with a sequential `data-block-index` at render time.

**Tasks**

1. In the Markdoc render pipeline (`PostLayout.astro` / wherever the body is rendered), walk the top-level nodes of the rendered tree and assign `data-block-index="<n>"` to each block-level element, in document order.
2. Expose a small client-side helper `resolveAnchor(container, {blockIndex, exact, prefix, suffix, offsetHint})` that:
   - Finds the element with matching `data-block-index`.
   - Searches its `textContent` for `prefix + exact + suffix` (normalized whitespace).
   - Falls back to a plain `indexOf(exact)` within that block if the prefixed/suffixed match fails (post text shifted slightly but the quote itself survived); if there are multiple matches, pick the one nearest `offsetHint`.
   - Returns `null` (orphaned) if nothing matches — caller must handle this without throwing.
3. **Selection constraint**: the "Add comment" UI only activates for selections that stay within a single block element. If a user selects across two paragraphs, show an inline hint ("select within a single paragraph") instead of creating a cross-block anchor — keeps `block_index` scoping valid.

**Acceptance criteria**

- ✅ Re-rendering a post after a trivial content tweak (e.g., fixing a typo two paragraphs away) does not move or break existing anchors. *(structural — block indices are assigned per top-level block in document order, so editing text inside one block can't shift another's index)*
- 🟡 Editing the exact quoted sentence causes that one comment's marker to disappear from the margin/inline highlight, while the comment still shows in the bottom list. *(`resolveAnchor` returns `null` for this case, verified; the margin/bottom-list rendering that reacts to it is sub-phase D)*
- 🟡 A cross-paragraph selection is rejected by the UI before it ever reaches the API. *(`captureSelection` returns `null` for this case, verified; the actual "Add comment" UI that gates on it is sub-phase D)*

## 7. Sub-phase C — Comment API

**Status: done and tested (2026-07-22).**

Files: [`src/pages/api/comments/index.ts`](src/pages/api/comments/index.ts) (`GET`/`POST`), [`src/pages/api/comments/[id].ts`](src/pages/api/comments/%5Bid%5D.ts) (`DELETE`), [`src/lib/admin.ts`](src/lib/admin.ts) (`ADMIN_USER_IDS` allowlist check — needed now for `DELETE`'s authorization, even though the admin UI itself is sub-phase E). Rate limiting is Neon-backed (§9's "Neon-backed counter is enough for v1"): counts the user's own comments in the last 60s, caps at 5.

**Spec conflict, resolved (2026-08-06):** §7 describes `DELETE` as "author or admin only," but §11 (Out of scope) said *"Editing/deleting your own comment after posting (only admin hide/delete in v1)."* Initially implemented admin-only per §11; you confirmed self-delete is fine, so `DELETE` now allows the comment's own author **or** an admin — `isOwner || isAdmin(session.user.id)` in `[id].ts`, with a 404 if the id doesn't exist and 403 if neither check passes. §11's bullet is now stale (see below).

Also set `ADMIN_USER_IDS` in `.env` to your own user id (`Lh21q1yCrvn6nl6QEr72jpKmcHU4f7yZ`, the account under `umiarka@gmail.com` created during sub-phase A testing) so the admin path was actually testable — carry this into Vercel's env vars too when you deploy, and add any other admin user ids there once you know them.

Verified: `GET` filters/sorts correctly and rejects a bad query (400); `POST` returns 401 logged-out, 403 `profile_incomplete` for an unfinished profile, 400 for empty body/selection, 201 + row on success; an EN comment never showed up when fetching RU for the same slug; firing 6 rapid posts as one user let the first 5 through and 429'd the 6th; `DELETE` returned 401 logged-out, 404 for a nonexistent id, 403 for a non-owner non-admin, 204 for both the comment's own author and a separate admin account (comment gone from a follow-up `GET` either way). A `<script>` payload in `body` round-trips as an inert JSON string — actual HTML-escaping on render is sub-phase D's job, per §8's own XSS acceptance criterion.

**Routes** (`prerender = false`):

- `GET /api/comments?slug=&lang=` → all `visible` comments for that `(slug, lang)`, each with `{ id, blockIndex, anchorExact, anchorPrefix, anchorSuffix, anchorOffsetHint, body, createdAt, author: { firstName, lastName, avatarUrl } }`, sorted by `created_at` ascending.
- `POST /api/comments` → auth required **and** `profile_complete = true`; body = `{ slug, lang, blockIndex, anchorExact, anchorPrefix, anchorSuffix, anchorOffsetHint, body }`; validate length + selection non-empty + rate-limit per user/IP; insert as `status: 'visible'`.
- `DELETE /api/comments/:id` → author or admin only.

**Acceptance criteria**

- ✅ Posting while logged out returns 401; posting with an incomplete profile returns 403 with a clear reason the client can use to redirect into the profile flow.
- ✅ A RU comment on a slug never appears when fetching the EN comments for the same slug.
- ✅ Rate limiting blocks rapid repeat posts from the same user/IP. *(implemented per-user; the schema has no IP column, and posting is auth-only anyway, so IP wasn't added as a second dimension — see status note above)*

## 8. Sub-phase D — Selection UI, margin avatars, bottom list

**Status: done and tested (2026-07-22).**

Files: [`src/components/CommentsSection.astro`](src/components/CommentsSection.astro) (everything — selection capture, bubble/hint, composer popover, highlight rendering, margin avatar column, bottom list, go-to-source), [`src/lib/format.ts`](src/lib/format.ts) (relative-date helper), plus new rules in [`src/styles/global.css`](src/styles/global.css) (`.comment-highlight`, `#comment-margin-column`, `.comment-avatar-btn`, `.comment-flash`). Wired into [`src/pages/posts/[lang]/[slug].astro`](src/pages/posts/%5Blang%5D/%5Bslug%5D.astro) alongside `AuthWidget`.

Margin avatars are portal-appended to `<body>` at runtime and positioned in document coordinates (not viewport-relative), so they scroll with the page for free — only resize needs to recompute. Gated to `lg:` (1024px+); below that the column is torn down and highlights fall back to plain inline `<mark>` styling with tap-to-jump, per §2's mobile decision.

**Bug caught + fixed:** the composer's inline "sign in" form ignored `signIn.magicLink`'s `{ error }` result and unconditionally showed "check your inbox," even on a real failure — masking the *actual* root bug: the email `<input>` had no `name="email"`, so `FormData` never picked it up and every submission silently sent an empty string (which then always failed server-side validation, so `authClient.getSession()` never returned a session as the reader would have believed from the reused-testing account). Fixed both: added `name="email"`, and the form now shows a real error message instead of a false "sent" state.

Verified end-to-end in a real browser session (not just curl): single-block selection shows the "+ Add comment" bubble; cross-paragraph selection shows the "select within a single paragraph" hint instead; the popover correctly branches to compose / sign-in / "finish your profile" based on live session state; posting a comment renders its highlight, bottom-list entry, and margin avatar immediately; clicking "Go to source" flashes the highlight, clicking the avatar or (on mobile) tapping the highlight flashes the matching list entry; an orphaned or mismatched anchor renders no highlight and shows "Original passage no longer available" instead of a broken button, without crashing; an `<img onerror=...>` payload in a comment body round-trips as escaped, inert text; the full "select while logged out → sign in → click the real magic-link verify URL → land back on the same post → composer reopens pre-filled → submit" round trip works end-to-end.

**Tasks**

1. **Selection capture** (client island scoped to `.prose`): on `selectionchange`/`mouseup` inside the article, if the selection is non-empty and within one block (§6), show a small floating "+" / "Add comment" bubble near the selection end. Clicking opens a popover with a textarea; if not logged in, the popover shows the login options instead (Telegram + email) and resumes the comment draft after auth.
2. **Highlight rendering**: for each fetched comment whose anchor resolves (§6), wrap the matched range in a `<mark class="comment-highlight" data-comment-id="...">` (or an absolutely-positioned overlay span, whichever is less invasive to the rendered HTML). Comments with unresolved anchors render no highlight.
3. **Margin avatars (desktop, ≥ the site's tablet breakpoint)**: a fixed-width column to the right of `.prose`. For each resolved comment, place its author's avatar at the same vertical offset as its highlighted span (`getBoundingClientRect().top` relative to the article). If two avatars would overlap vertically, stack them with a small offset. Clicking an avatar scrolls the bottom list to that comment (and vice versa — see below).
4. **Mobile (< breakpoint)**: no margin column. Highlighted text still gets the inline `mark` style. Tapping a highlighted span scrolls to and briefly flashes its entry in the bottom list.
5. **Bottom comment list**: below the post, all comments for the current `(slug, lang)` in chronological order (oldest first), each showing avatar, "First Last", relative date, comment body, and a **"Go to source"** button. If the anchor is orphaned, disable/hide that button and show a small note (e.g. "original passage no longer available") instead of a broken scroll target.
6. **"Go to source"**: `scrollIntoView({ behavior: 'smooth', block: 'center' })` on the resolved highlighted span, plus a brief flash/pulse class removed after ~1.5s.
7. Escape/sanitize all rendered comment bodies and author names (plain text only, no HTML interpretation). Style avatars, highlights, and the "Add comment"/"Go to source" affordances with the site's gradient accent (§2 Design) so the feature feels native, not bolted on.

**Acceptance criteria**

- ✅ Selecting text within a single paragraph shows the "Add comment" bubble; selecting across paragraphs does not.
- ✅🟡 A logged-out user who starts a comment is walked through login and their draft survives the round trip. *(verified for email; Telegram not built yet)*
- ✅ On desktop, avatars appear in the right margin aligned to their highlighted text; on mobile, the margin column is absent and highlights are tap-to-jump instead.
- ✅ The bottom list is sorted oldest → newest and "Go to source" scrolls to and flashes the right span.
- ✅ A comment whose source text was edited out of the post still appears in the bottom list with source-navigation disabled, and does not crash the page.
- ✅ An XSS payload (`<script>`, `<img onerror=...>`) in a comment body or name renders as inert text.

## 9. Sub-phase E — Moderation

**Status: done and tested (2026-07-22).**

Tasks 1 (`ADMIN_USER_IDS` allowlist) and 3 (rate limiting) actually landed already in sub-phase C, since `DELETE /api/comments/:id` needed the admin concept for its own authorization before this sub-phase started — see [`src/lib/admin.ts`](src/lib/admin.ts) and the sub-phase C status note. Only task 2 was new here: [`src/pages/admin/comments.astro`](src/pages/admin/comments.astro) — server-rendered (direct Drizzle query in frontmatter, no separate list API needed), redirects non-admins to `/`, lists every comment regardless of status with Hide/Unhide and Delete buttons that call the sub-phase C `PATCH`/`DELETE` routes.

Verified in the real browser as the admin test account: the page lists both test comments; clicking Hide flips status to `hidden` and the comment immediately disappears from `GET /api/comments`; Delete removes it entirely. A non-admin session and a fully unauthenticated request both get redirected to `/` (302) rather than seeing the page.

**Tasks**

1. `ADMIN_USER_IDS` allowlist (env-based).
2. Minimal `/admin/comments` (auth-gated, admin-only): list all comments including `hidden`/`pending`, hide/delete action.
3. Rate limiting: cap posts per user/IP per minute — a simple in-memory or Neon-backed counter is enough for v1.

**Acceptance criteria**

- ✅ Non-admins get a 403/redirect on `/admin/comments`.
- ✅ Admin can hide/delete any comment; hidden comments stop appearing in `GET /api/comments` and disappear from both the margin and bottom list on next fetch.
- ✅ Rapid repeated posting from one account is blocked after the configured threshold. *(verified in sub-phase C: 6 rapid posts → first 5 succeed, 6th+ get 429)*

## 10. Risks & decision rules

- **R1 — Duplicate quotes within a block.** If the exact same short phrase occurs twice in one block, prefix/suffix context resolves it in almost all real cases; `anchor_offset_hint` is the last-resort tiebreaker. Don't over-engineer beyond this for v1.
- **R2 — Cross-block selection.** Selections must stay within a single block element (§6). This is a real UX constraint, not just an implementation shortcut — communicate it in the UI (e.g. a subtle tooltip) rather than silently failing.
- **R3 — Orphaned anchors.** A later edit to the post can invalidate an anchor. This must **never** be a hard error — always degrade to "comment visible, source navigation disabled."
- **R4 — Photo URL is unvalidated by nature.** Since v1 has no upload/hosting (same "paste-a-URL" pattern as audio), only validate URL scheme (`http`/`https`) and render with `referrerpolicy`/`loading="lazy"`; don't trust it further (no server-side fetch/proxy of arbitrary user-supplied URLs).
- **R5 — Telegram widget domain.** The Login Widget silently fails unless the bot's domain is set to `blog.umyar.com` via @BotFather `/setdomain`. Verify before debugging the callback.
- **R6 — Server routes on a static site.** Keep `output: 'static'`; mark only the dynamic routes (`/api/*`, `/admin/*`) `prerender = false`. Don't flip the whole site to SSR.

## 11. Out of scope for v1

- Replies/threading (flat comments only — see §2).
- Reactions/likes on comments.
- In-CMS or hosted photo upload (paste-a-URL only, same as audio).
- Editing your own comment after posting (still not supported). Deleting your own comment **is** now supported at the API level (`DELETE /api/comments/:id`, resolved 2026-08-06 — see §7) — this bullet originally said otherwise before that decision. No UI button for it yet, though: the bottom list (§8) doesn't currently show a delete affordance on your own comments, only admins get one via `/admin/comments`.
- Overlapping/nested highlights spanning the same text from multiple comments beyond simple vertical stacking of avatars.
