# blog.umyar.com — Implementation Plan

> **For the executing agent (Claude Sonnet 4.6, high effort).** This is a complete, self-contained build spec for a multilingual blog at `blog.umyar.com`. Work phase by phase. Each phase has **Tasks** and **Acceptance criteria** — do not advance to the next phase until the current one's acceptance criteria pass. Code snippets are _starting points_, not gospel: verify APIs against the installed package versions and adapt. When a "Decision rule" is given, follow it instead of guessing.

---

## 1. Goal

A fast, statically-rendered, SEO/AEO-optimized personal blog with:

- **3 languages per post: RU / EN / PT.** Reader chooses the language. Any subset may exist (e.g. a post can have RU + PT but no EN).
- **Static pages** (real server-rendered HTML, fully indexable). Per-post URLs: `blog.umyar.com/posts/<lang>/<slug>` (e.g. `/posts/pt/my-first-post`, `/posts/en/my-first-post`).
- **A great editor UI** for writing posts (Keystatic), content stored as files in git.
- **Inline images** placed anywhere in the body (markdown/MDX).
- **Optional per-language audio narration** with a play button (RU + PT but maybe not EN, etc.).
- **Comments** gated by login: **Telegram** and **Email** (magic link). No phone/SMS.

Design must match the existing `umyar.com` site: **Montserrat** font, **red→blue gradient** accents, black text on white.

## 2. Locked decisions (do not re-litigate)

| Area           | Choice                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework      | **Astro** (static-first + server endpoints), Vercel adapter                                                                                     |
| Hosting        | **Vercel**, custom domain `blog.umyar.com`                                                                                                      |
| Repo           | **New, separate repo/project** (do NOT graft onto the existing static `umyar.com` site). This `BLOG.md` lives in the old repo only as the spec. |
| Editor / CMS   | **Keystatic** (git-based). Admin at `/keystatic`. Content as files in repo.                                                                     |
| Content format | **MDX** (markdown + inline images). See Risk R1 for the Markdoc fallback.                                                                       |
| Languages      | RU, EN, PT — grouped authoring (all 3 in one Keystatic entry), independent existence                                                            |
| Comments DB    | **Neon** (serverless Postgres)                                                                                                                  |
| ORM            | **Drizzle**                                                                                                                                     |
| Auth           | **Better Auth** — Telegram Login Widget + Email magic link (via **Resend**)                                                                     |
| Audio storage  | **Vercel Blob**                                                                                                                                 |
| Analytics      | Reuse the existing **Google Analytics** tag (`G-Q7F14H0MW7`)                                                                                    |

## 3. Design tokens (copy exactly from the current site)

Pulled from the existing `umyar.com` for visual consistency:

```css
/* Font */
font-family: 'Montserrat', sans-serif; /* weights 300, 400, 700 */
/* Google Fonts: https://fonts.googleapis.com/css?family=Montserrat:300,400,700&display=swap */

/* Colors */
--text: #000;
--bg: #fff;
--theme-color: #1a1a1a; /* <meta name="theme-color"> */

/* Signature gradient — used on h1/h2 via background-clip:text */
--gradient: linear-gradient(to left, #dc2424, #4a569d);
```

Gradient-text heading pattern (reuse for post titles / section headings):

```css
.gradient-text {
  background-image: linear-gradient(to left, #dc2424, #4a569d);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
}
```

Keep the responsive `html { font-size }` rem-scaling approach and generous spacing of the current site. Body copy ~1.8rem, comfortable max line length (~50em) for the article column.

## 4. Prerequisites & secrets

Create accounts / obtain tokens and put them in `.env` (local) + Vercel project env vars (prod). **Never commit `.env`.**

```bash
# Site
PUBLIC_SITE_URL=https://blog.umyar.com

# Neon Postgres
DATABASE_URL=postgres://...

# Better Auth
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://blog.umyar.com

# Telegram (create a bot via @BotFather; set domain with /setdomain)
TELEGRAM_BOT_TOKEN=...
PUBLIC_TELEGRAM_BOT_USERNAME=<bot_username_without_@>

# Email (Resend) — verify the sending domain
RESEND_API_KEY=...
EMAIL_FROM="Umiar <hello@umyar.com>"

# Vercel Blob (audio uploads)
BLOB_READ_WRITE_TOKEN=...

# Keystatic GitHub mode (prod editing only; local dev uses kind:'local')
KEYSTATIC_GITHUB_CLIENT_ID=...
KEYSTATIC_GITHUB_CLIENT_SECRET=...
KEYSTATIC_SECRET=<openssl rand -base64 32>
```

External setup checklist (do these as the relevant phase needs them):

- **Bot**: @BotFather → new bot → save token → `/setdomain` = `blog.umyar.com` (required for the Telegram Login Widget to work).
- **Neon**: create project + database, copy pooled `DATABASE_URL`.
- **Resend**: verify `umyar.com` (or a subdomain) for sending; create API key.
- **Vercel**: create project, add domain `blog.umyar.com`, add all env vars, enable Vercel Blob store.

---

## Phase 0 — Scaffold & deploy a skeleton

**Tasks**

1. `npm create astro@latest` → minimal/empty template, TypeScript strict, in a new directory (e.g. `umyar-blog`). Init git.
2. Add the Vercel adapter and integrations:
   ```bash
   npx astro add vercel mdx sitemap
   ```
   `astro.config.mjs`: `output: 'static'`, `adapter: vercel()`, `site: 'https://blog.umyar.com'`, integrations `[mdx(), sitemap()]`. Server-only routes (Keystatic, auth, comments API) will opt in with `export const prerender = false`.
3. Add a homepage `/` listing posts (empty for now) and a global layout with the shared `<head>` (Montserrat link, theme-color, GA tag).
4. Push to GitHub, import into Vercel, attach `blog.umyar.com`, deploy.

**Acceptance criteria**

- `https://blog.umyar.com` serves a deployed Astro page with Montserrat loaded and the gradient visible on a heading.
- `npm run build` is clean; Lighthouse SEO ≥ 95 on the placeholder homepage.

## Phase 1 — Design system

**Tasks**

1. Create `src/styles/global.css` with the tokens from §3 (reset, Montserrat, gradient helper, rem-scaling media queries mirroring the current site).
2. Build `src/layouts/BaseLayout.astro` — `<head>` (meta, fonts, theme-color, GA, canonical, OG/Twitter slots), header (logo/wordmark in the same style as the current site), footer (link to Telegram + back to `umyar.com`).
3. Build `src/layouts/PostLayout.astro` — article column (max line length ~50em), gradient post title, language switcher slot, audio-player slot, comments slot, prose styles for markdown (headings, links, inline images responsive `max-width:100%`, blockquotes, code).
4. Add a simple **language switcher** component that, given the current `slug` and the set of available languages, links to `/posts/<lang>/<slug>` for each existing translation and marks the active one.

**Acceptance criteria**

- A hard-coded sample post page visually matches the `umyar.com` aesthetic (font, gradient, spacing, black-on-white).
- Inline images in markdown render full-width-capped and responsive.
- Language switcher renders only languages that exist and highlights the current one.

## Phase 2 — Content model (Keystatic) + rendering + i18n routing

**Content shape (grouped authoring — one entry holds all 3 languages):**

```
src/content/posts/<slug>/
  index.yaml      # slug, date, tags, cover, audio URLs, per-lang titles/excerpts
  ru.mdx  en.mdx  pt.mdx   # any subset; a missing file = that language doesn't exist
```

**Tasks**

1. Install Keystatic: `npm i @keystatic/core @keystatic/astro` and add the integration (adds `/keystatic` UI + `/api/keystatic/[...]` route; these are `prerender = false`).
2. `keystatic.config.ts` — one `posts` collection. Starting point (verify field APIs against installed version):

   ```ts
   import { config, fields, collection } from '@keystatic/core';

   export default config({
     storage:
       process.env.NODE_ENV === 'development'
         ? { kind: 'local' }
         : { kind: 'github', repo: 'umyar/umyar-blog' },
     collections: {
       posts: collection({
         label: 'Posts',
         slugField: 'slug',
         path: 'src/content/posts/*/',
         schema: {
           slug: fields.slug({ name: { label: 'Slug (shared across languages)' } }),
           date: fields.date({ label: 'Publish date' }),
           draft: fields.checkbox({ label: 'Draft', defaultValue: true }),
           tags: fields.array(fields.text({ label: 'Tag' }), { label: 'Tags' }),
           cover: fields.image({
             label: 'Cover image',
             directory: 'src/assets/posts',
             publicPath: '/src/assets/posts/',
           }),
           // Per-language metadata
           title: fields.object({
             ru: fields.text({ label: 'Title RU' }),
             en: fields.text({ label: 'Title EN' }),
             pt: fields.text({ label: 'Title PT' }),
           }),
           excerpt: fields.object({
             ru: fields.text({ label: 'Excerpt RU', multiline: true }),
             en: fields.text({ label: 'Excerpt EN', multiline: true }),
             pt: fields.text({ label: 'Excerpt PT', multiline: true }),
           }),
           // Per-language audio (Vercel Blob URL, optional)
           audio: fields.object({
             ru: fields.url({ label: 'Audio URL RU' }),
             en: fields.url({ label: 'Audio URL EN' }),
             pt: fields.url({ label: 'Audio URL PT' }),
           }),
           // Per-language bodies — each stored as its own .mdx file in the entry folder
           body_ru: fields.mdx({ label: 'Body RU' }),
           body_en: fields.mdx({ label: 'Body EN' }),
           body_pt: fields.mdx({ label: 'Body PT' }),
         },
       }),
     },
   });
   ```

   > Inline images inside a body: enable image upload on the `fields.mdx` (`options.image`) so the editor can drop images straight into the text, stored alongside the post.

3. **Consume content** via the Keystatic **Reader API** (`@keystatic/core/reader` → `createReader(process.cwd(), keystaticConfig)`) inside `getStaticPaths`. Build the param matrix: for each post, for each language whose body is non-empty and `draft === false`, emit `{ lang, slug }`.
4. **Routing**: `src/pages/posts/[lang]/[slug].astro` with `getStaticPaths` producing every `(lang, slug)` that exists. Render the chosen language's MDX body through `PostLayout`. Pass the set of available languages to the language switcher.
5. Homepage `/`: list posts. Decide the default listing language (EN), fall back to whichever language exists; each card links to the best available `/posts/<lang>/<slug>`.
6. Add `404` and a per-language "this post isn't available in X" graceful path (link to the languages that do exist).

**Decision rule — body rendering (see Risk R1):** First try rendering the `fields.mdx` output from the Reader API. If runtime MDX-string rendering proves brittle within the build, **switch the three body fields to `fields.markdoc`** and render with `@markdoc/markdoc` (clean programmatic transform→render). If _that_ is still awkward, fall back to **per-language Astro content-collection entries** (`src/content/posts/<lang>/<slug>.mdx` via the `glob` loader + native `render()`), keeping slugs synced. Pick the first option that renders reliably; document the choice at the top of the routing file.

**Acceptance criteria**

- `/keystatic` runs locally; you can create a post with RU+PT bodies (no EN) + a cover + drop an inline image, and it writes files under `src/content/posts/<slug>/`.
- After rebuild, `/posts/ru/<slug>` and `/posts/pt/<slug>` render; `/posts/en/<slug>` 404s (or shows the graceful "not available" page); homepage lists the post.
- Drafts do not appear in the build.

## Phase 3 — SEO / AEO (treat as first-class — explicit requirement)

**Tasks**

1. **hreflang alternates**: on every post page, emit `<link rel="alternate" hreflang="<lang>" href=".../posts/<lang>/<slug>">` for each existing translation **plus** `x-default`. Same for canonical (`<link rel="canonical">` = the current page).
2. **JSON-LD** `BlogPosting` per post: `headline`, `inLanguage`, `datePublished`/`dateModified`, `author` (Umiar Iusupov), `image` (cover), `mainEntityOfPage`. Inject as `<script type="application/ld+json">`.
3. **Open Graph + Twitter** meta per post (title, excerpt, cover, `og:locale` = lang, `og:type=article`).
4. **Sitemap**: `@astrojs/sitemap` configured to include all language URLs; wire hreflang into the sitemap via its `serialize`/`i18n` options if feasible.
5. **RSS**: `@astrojs/rss` feed(s). At minimum one combined feed at `/rss.xml`; optionally per-language feeds.
6. **`robots.txt`** (allow all, point to sitemap) and an optional **`/llms.txt`** summarizing the blog + linking key posts (AEO).
7. Ensure every page has a unique `<title>` and `<meta name="description">` from the post excerpt.

**Acceptance criteria**

- View-source of a post shows: canonical, all hreflang alternates (incl. `x-default`), valid `BlogPosting` JSON-LD (passes Google Rich Results test), OG/Twitter tags.
- `/sitemap-index.xml` (or equivalent) and `/rss.xml` are valid and list posts.
- Lighthouse SEO = 100 on a real post.

## Phase 4 — Audio player

**Tasks**

1. **Upload path**: audio files live in **Vercel Blob**. Provide a tiny authenticated upload route (or a one-off script) that pushes a file to Blob and returns the public URL; the author pastes that URL into the post's `audio.<lang>` field in Keystatic. (Keep it simple — no need for in-CMS upload in v1.)
2. **Player component** (Astro island, vanilla JS or a tiny lib): renders only when `audio[currentLang]` exists. Styled to match the site (gradient accents). Play/pause, seek, current time/duration. Use a native `<audio>` element under the hood; lazy-load (`preload="none"`).
3. Place the player near the top of `PostLayout`, under the title.

**Acceptance criteria**

- A post with RU+PT audio shows the player on `/posts/ru/...` and `/posts/pt/...`; a language without audio shows no player.
- Audio streams from the Blob URL; no layout shift; `preload="none"` confirmed.

## Phase 5 — Comments + Auth

**Data model (Drizzle / Neon).** Tables (Better Auth manages its own `user`/`session`/`account`/`verification`; add `comments`):

```
comment(
  id              text pk,
  post_slug       text not null,
  lang            text not null,          -- comments are per (slug, lang)
  user_id         text not null -> user.id,
  body            text not null,          -- store as plain text; render escaped
  status          text not null default 'visible',  -- 'visible' | 'hidden' | 'pending'
  created_at      timestamptz default now(),
  parent_id       text null               -- optional single-level threading
)
```

**Tasks**

1. Install + configure **Better Auth** (`better-auth`, drizzle adapter). Run its schema/migrations into Neon. Add `comments` table + migration.
2. **Email magic link**: enable Better Auth's magic-link/email-OTP; send via **Resend**. Verify deliverability.
3. **Telegram login**: render the official **Telegram Login Widget** (configured for `PUBLIC_TELEGRAM_BOT_USERNAME`). On callback, POST the widget payload to `/api/auth/telegram`; **server-side verify the HMAC-SHA256 hash** using `TELEGRAM_BOT_TOKEN` (standard Telegram data-check-string algorithm) and reject stale `auth_date`. On success, upsert the user (custom Better Auth credential/social sign-in) and create a session.
   > Telegram is not a standard OAuth2 provider — implement it as a custom verified credential, not via a generic OAuth plugin.
4. **API routes** (`prerender = false`):
   - `GET /api/comments?slug=&lang=` → list `visible` comments (+ author display name/avatar).
   - `POST /api/comments` → auth required; validate (length, rate-limit per user/IP), insert.
   - `DELETE /api/comments/:id` → author or admin (you) only.
5. **Comments island** in `PostLayout`: shows the thread for `(slug, lang)`, a login affordance offering **both** Telegram and Email, a comment box for authenticated users, optimistic post + refetch. Escape/sanitize all user text on render.
6. **Moderation**: an `ADMIN_USER_IDS` allowlist; a minimal `/admin/comments` (auth-gated) to hide/delete; rate-limit posting (e.g. ≤ N/min per user). The login gate + rate limit is the primary spam defense.

**Acceptance criteria**

- A logged-out reader sees existing comments and both login options.
- Login works via Telegram (hash verified server-side) **and** via email magic link.
- Authenticated user can post; comment appears under the correct `(slug, lang)` only; XSS payload in a comment renders inert.
- Admin can hide/delete; rate limiting blocks rapid spam.
- Comments are isolated per language (a RU comment does not show on the EN page).

## Phase 6 — Polish & launch

**Tasks**

- Error/empty states, loading states, mobile pass (match current site's breakpoints).
- 404 page styled on-brand.
- Verify GA events fire (pageviews; optionally a `comment_posted` event).
- Seed 1–2 real posts across all 3 languages with audio + inline images.
- Final SEO sweep: hreflang, JSON-LD, sitemap, RSS, OG images, canonical.
- README in the blog repo: how to write a post (Keystatic), how to add audio (Blob), env vars, deploy.

**Acceptance criteria (Definition of Done)**

- All earlier acceptance criteria pass on production `blog.umyar.com`.
- Lighthouse: SEO 100, Performance ≥ 90, Accessibility ≥ 95 on a real post.
- A non-technical author can publish a trilingual post end-to-end through `/keystatic` without touching code.

---

## Risks & decision rules

- **R1 — Keystatic body rendering.** Rendering Keystatic-authored MDX in Astro at build time can be fiddly. Resolve per the **Decision rule** in Phase 2 (MDX via Reader API → else Markdoc → else per-language native content collections). Spike this _first thing_ in Phase 2 with one sample post before building routing on top of it.
- **R2 — Keystatic production editing.** `kind:'local'` only works in dev. For editing on the live site, configure `kind:'github'` (GitHub App: `KEYSTATIC_GITHUB_*`) so saves commit to the repo and trigger a Vercel rebuild. Confirm the OAuth callback + app permissions early.
- **R3 — Telegram widget domain.** The Login Widget silently fails unless the bot's domain is set to `blog.umyar.com` via @BotFather `/setdomain`. Verify before debugging the callback.
- **R4 — Server routes on a static site.** Keep `output: 'static'` and mark only the dynamic routes (`/keystatic`, `/api/*`, admin) `prerender = false`. Don't flip the whole site to SSR — it would weaken the static/SEO posture.
- **R5 — Audio size / cost.** Narration files are large; keep them in Blob, never in git. `preload="none"` to avoid bandwidth on every pageview.
- **R6 — Slug sync across languages.** Slug is shared (one entry, 3 bodies) so the language switcher just swaps the path segment. If R1 forces per-language entries, enforce identical slugs across the 3 files (lint/check at build).

## Out of scope for v1 (note as future work)

- Phone/SMS OTP login (explicitly dropped — Telegram already proves a real, phone-verified person; revisit only if needed).
- Comment reactions/likes, deep threading (single-level replies max in v1).
- Full-text search, tags index pages, newsletter.
- In-CMS audio upload (v1 uses paste-a-Blob-URL).

## Suggested dependency list (verify latest at install time)

`astro`, `@astrojs/vercel`, `@astrojs/mdx`, `@astrojs/sitemap`, `@astrojs/rss`, `@keystatic/core`, `@keystatic/astro`, `better-auth`, `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `resend`, `@vercel/blob`, (`@markdoc/markdoc` only if R1 routes to the Markdoc fallback).
