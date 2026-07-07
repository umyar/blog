# blog.umyar.com — Comments & Auth

> **For the executing agent (Claude Sonnet 5, high effort).** This is the build spec for comments + auth on `blog.umyar.com` — a Google-Docs-style, text-anchored commenting system. It's self-contained: locked decisions, prerequisites, data model, and design reference are all below. Work sub-phase by sub-phase; don't advance to the next until the current one's acceptance criteria pass.

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

- **Telegram bot**: @BotFather → new bot → save token → `/setdomain` = `blog.umyar.com` (required for the Telegram Login Widget to work at all — verify this before debugging the callback).
- **Neon**: create project + database, copy the pooled `DATABASE_URL`.
- **Resend**: verify the sending domain (`umyar.com` or a subdomain); create an API key.
- **Vercel**: add all of the above as env vars on the project once obtained.

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

**Tasks**

1. Install + configure **Better Auth** with the Drizzle adapter, pointed at Neon. Run its schema migration; add the `first_name` / `last_name` / `avatar_url` / `profile_complete` columns from §4.
2. **Email magic link**: enable Better Auth's magic-link plugin, send via **Resend**. Verify deliverability with a real send.
3. **Telegram login**: render the official Telegram Login Widget (`PUBLIC_TELEGRAM_BOT_USERNAME`). On callback, POST the widget payload to `/api/auth/telegram`; **verify the HMAC-SHA256 hash server-side** using `TELEGRAM_BOT_TOKEN` (standard Telegram data-check-string algorithm), reject stale `auth_date`. On success, upsert the Better Auth user and create a session. Implement as a custom verified credential, not a generic OAuth plugin — Telegram isn't OAuth2.
4. **Profile-completion gate**: after a session is created for a **brand-new** user (`profile_complete = false`), show a one-time modal/page asking first name, last name, photo URL (plain URL input — validate it looks like an `http(s)` URL, not `javascript:`; no file upload, no image hosting). On submit, set `profile_complete = true`. Returning users with `profile_complete = true` skip this entirely on future logins.
5. Any comment-writing action checks `profile_complete`; if false, redirect back into the completion flow instead of accepting the comment.

**Acceptance criteria**

- A first-time visitor can sign in via **either** Telegram or email magic link, is prompted exactly once for name/last name/photo URL, and lands back on the post afterward.
- A returning user (already `profile_complete`) logs in via either method and is never shown the profile form again.
- Telegram callback rejects a tampered/replayed payload (bad hash or stale `auth_date`).
- `avatar_url` accepting a non-image or `javascript:` URL is rejected client- and server-side (scheme allowlist: `http:`/`https:`).

## 6. Sub-phase B — Stable block indices for anchoring

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

- Re-rendering a post after a trivial content tweak (e.g., fixing a typo two paragraphs away) does not move or break existing anchors.
- Editing the exact quoted sentence causes that one comment's marker to disappear from the margin/inline highlight, while the comment still shows in the bottom list.
- A cross-paragraph selection is rejected by the UI before it ever reaches the API.

## 7. Sub-phase C — Comment API

**Routes** (`prerender = false`):

- `GET /api/comments?slug=&lang=` → all `visible` comments for that `(slug, lang)`, each with `{ id, blockIndex, anchorExact, anchorPrefix, anchorSuffix, anchorOffsetHint, body, createdAt, author: { firstName, lastName, avatarUrl } }`, sorted by `created_at` ascending.
- `POST /api/comments` → auth required **and** `profile_complete = true`; body = `{ slug, lang, blockIndex, anchorExact, anchorPrefix, anchorSuffix, anchorOffsetHint, body }`; validate length + selection non-empty + rate-limit per user/IP; insert as `status: 'visible'`.
- `DELETE /api/comments/:id` → author or admin only.

**Acceptance criteria**

- Posting while logged out returns 401; posting with an incomplete profile returns 403 with a clear reason the client can use to redirect into the profile flow.
- A RU comment on a slug never appears when fetching the EN comments for the same slug.
- Rate limiting blocks rapid repeat posts from the same user/IP.

## 8. Sub-phase D — Selection UI, margin avatars, bottom list

**Tasks**

1. **Selection capture** (client island scoped to `.prose`): on `selectionchange`/`mouseup` inside the article, if the selection is non-empty and within one block (§6), show a small floating "+" / "Add comment" bubble near the selection end. Clicking opens a popover with a textarea; if not logged in, the popover shows the login options instead (Telegram + email) and resumes the comment draft after auth.
2. **Highlight rendering**: for each fetched comment whose anchor resolves (§6), wrap the matched range in a `<mark class="comment-highlight" data-comment-id="...">` (or an absolutely-positioned overlay span, whichever is less invasive to the rendered HTML). Comments with unresolved anchors render no highlight.
3. **Margin avatars (desktop, ≥ the site's tablet breakpoint)**: a fixed-width column to the right of `.prose`. For each resolved comment, place its author's avatar at the same vertical offset as its highlighted span (`getBoundingClientRect().top` relative to the article). If two avatars would overlap vertically, stack them with a small offset. Clicking an avatar scrolls the bottom list to that comment (and vice versa — see below).
4. **Mobile (< breakpoint)**: no margin column. Highlighted text still gets the inline `mark` style. Tapping a highlighted span scrolls to and briefly flashes its entry in the bottom list.
5. **Bottom comment list**: below the post, all comments for the current `(slug, lang)` in chronological order (oldest first), each showing avatar, "First Last", relative date, comment body, and a **"Go to source"** button. If the anchor is orphaned, disable/hide that button and show a small note (e.g. "original passage no longer available") instead of a broken scroll target.
6. **"Go to source"**: `scrollIntoView({ behavior: 'smooth', block: 'center' })` on the resolved highlighted span, plus a brief flash/pulse class removed after ~1.5s.
7. Escape/sanitize all rendered comment bodies and author names (plain text only, no HTML interpretation). Style avatars, highlights, and the "Add comment"/"Go to source" affordances with the site's gradient accent (§2 Design) so the feature feels native, not bolted on.

**Acceptance criteria**

- Selecting text within a single paragraph shows the "Add comment" bubble; selecting across paragraphs does not.
- A logged-out user who starts a comment is walked through login and their draft survives the round trip.
- On desktop, avatars appear in the right margin aligned to their highlighted text; on mobile, the margin column is absent and highlights are tap-to-jump instead.
- The bottom list is sorted oldest → newest and "Go to source" scrolls to and flashes the right span.
- A comment whose source text was edited out of the post still appears in the bottom list with source-navigation disabled, and does not crash the page.
- An XSS payload (`<script>`, `<img onerror=...>`) in a comment body or name renders as inert text.

## 9. Sub-phase E — Moderation

**Tasks**

1. `ADMIN_USER_IDS` allowlist (env-based).
2. Minimal `/admin/comments` (auth-gated, admin-only): list all comments including `hidden`/`pending`, hide/delete action.
3. Rate limiting: cap posts per user/IP per minute — a simple in-memory or Neon-backed counter is enough for v1.

**Acceptance criteria**

- Non-admins get a 403/redirect on `/admin/comments`.
- Admin can hide/delete any comment; hidden comments stop appearing in `GET /api/comments` and disappear from both the margin and bottom list on next fetch.
- Rapid repeated posting from one account is blocked after the configured threshold.

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
- Editing/deleting your own comment after posting (only admin hide/delete in v1).
- Overlapping/nested highlights spanning the same text from multiple comments beyond simple vertical stacking of avatars.
