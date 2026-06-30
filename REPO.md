# blog.umyar.com — Repo Bootstrap

> **For the executing agent (Claude Sonnet 4.6, high effort).** You are in a freshly cloned **empty git repo** that will become `blog.umyar.com`. This file sets up the project foundation: an Astro skeleton with tooling, on-brand styling, and a deployable placeholder homepage. Work top to bottom, run the commands, create the files **exactly** as given (adapt only if a pinned version's API differs). When you finish, the repo builds, deploys, and looks on-brand — then you hand off to **`BLOG.md` Phase 1** for features.
>
> **This bootstrap replaces BLOG.md "Phase 0".** After it's green, continue at **BLOG.md Phase 1 — Design system**.
>
> **Prerequisite:** copy `BLOG.md` into this repo root too (it's the feature spec you'll follow next). If it isn't here, ask the user for it before starting feature phases.

---

## 0. Environment

- **Node 24 LTS** (pin via `.nvmrc`). Package manager: **npm**.
- Confirm: `node -v` ≥ 20.3 (24.x preferred), `npm -v` ≥ 10.
- Your system default may be newer (e.g. Node 26) — that's fine; run this repo on the pinned LTS via `nvm use`. Verify Vercel offers Node 24 in Project → Settings → General → Node.js Version; if not, fall back to 22.

## 1. Scaffold Astro in place

The repo already contains `.git`, `REPO.md`, and (ideally) `BLOG.md`. Scaffold into a temp dir and move files up so nothing existing is clobbered:

```bash
# from repo root
npm create astro@latest .astro-tmp -- --template minimal --typescript strict --no-install --no-git --skip-houston
# move scaffold into repo root (keep existing .git / *.md), then clean up
rsync -a --exclude='.git' .astro-tmp/ ./
rm -rf .astro-tmp
```

If `rsync` is unavailable, use `cp -a .astro-tmp/. ./` then `rm -rf .astro-tmp`. Verify `astro.config.mjs`, `package.json`, `src/`, and `tsconfig.json` now exist at root.

## 2. Install integrations & dependencies

```bash
npx astro add vercel mdx sitemap --yes
npm i
npm i -D prettier prettier-plugin-astro
```

> Later feature phases (per BLOG.md) add their own deps — Keystatic (`@keystatic/core @keystatic/astro`), auth/DB (`better-auth drizzle-orm drizzle-kit @neondatabase/serverless`), email (`resend`), audio (`@vercel/blob`). **Do not install those now** unless you are doing that phase.

## 3. Config files

Create/overwrite these exactly.

**`astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://blog.umyar.com',
  output: 'static', // dynamic routes (Keystatic, /api/*) opt in via `export const prerender = false`
  adapter: vercel(),
  integrations: [mdx(), sitemap()],
});
```

**`.nvmrc`**

```
24
```

**`tsconfig.json`** — ensure it extends Astro strict (the scaffold likely already does):

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

**`.gitignore`**

```
node_modules
dist
.astro
.vercel
.env
.env.*
!.env.example
.DS_Store
.astro-tmp
```

**`prettier.config.js`** (mirrors the main umyar.com repo + Astro plugin)

```js
module.exports = {
  trailingComma: 'es5',
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  printWidth: 100,
  arrowParens: 'always',
  plugins: ['prettier-plugin-astro'],
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
};
```

**`.env.example`** (the full set the project will need; real values go in `.env` locally and in Vercel env vars — never commit `.env`)

```bash
# Site
PUBLIC_SITE_URL=https://blog.umyar.com

# Neon Postgres (Phase 5)
DATABASE_URL=

# Better Auth (Phase 5)
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://blog.umyar.com

# Telegram login (Phase 5)
TELEGRAM_BOT_TOKEN=
PUBLIC_TELEGRAM_BOT_USERNAME=

# Email / Resend (Phase 5)
RESEND_API_KEY=
EMAIL_FROM="Umiar <hello@umyar.com>"

# Vercel Blob — audio (Phase 4)
BLOB_READ_WRITE_TOKEN=

# Keystatic GitHub mode — prod editing (Phase 2)
KEYSTATIC_GITHUB_CLIENT_ID=
KEYSTATIC_GITHUB_CLIENT_SECRET=
KEYSTATIC_SECRET=
```

**`package.json`** — ensure these scripts exist:

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "format": "prettier --write ."
  }
}
```

## 4. Folder structure

Create the skeleton directories (empty `.gitkeep` where needed):

```
src/
  assets/posts/        # cover & inline images (optimized by Astro)
  components/          # UI islands (audio player, comments, lang switcher) — later phases
  content/posts/       # Keystatic writes posts here — Phase 2
  layouts/
  pages/
  styles/
public/                # favicon, robots.txt, static assets
```

Add `public/favicon.ico` (reuse the one from the main site if available, else a placeholder) and a basic `public/robots.txt`:

```
User-agent: *
Allow: /
Sitemap: https://blog.umyar.com/sitemap-index.xml
```

## 5. Design tokens — `src/styles/global.css`

On-brand with umyar.com: Montserrat, black-on-white, red→blue gradient. Create exactly:

```css
/* Montserrat is loaded via <link> in BaseLayout */
:root {
  --text: #000;
  --bg: #fff;
  --theme: #1a1a1a;
  --grad: linear-gradient(to left, #dc2424, #4a569d);
  --maxline: 50em;
}

html {
  font-size: 100%;
}
@media (max-width: 1980px) {
  html {
    font-size: 62.5%;
  }
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  color: var(--text);
  background: var(--bg);
  font-family: 'Montserrat', sans-serif;
  font-size: 1.8rem;
  line-height: 1.6;
}

a {
  color: inherit;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Signature gradient text — use on h1/h2 / post titles */
.gradient-text {
  background-image: var(--grad);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
}

.container {
  width: 100%;
  max-width: 80rem;
  margin: 0 auto;
  padding: 0 3rem;
}

/* Article prose column */
.prose {
  max-width: var(--maxline);
}
.prose p {
  margin: 1em 0;
}
.prose h2,
.prose h3 {
  margin: 1.5em 0 0.5em;
}
.prose img {
  margin: 1.5em 0;
  border-radius: 0.4rem;
}
```

## 6. Base layout — `src/layouts/BaseLayout.astro`

`<head>` with SEO slots, Montserrat, theme-color, Google Analytics (reuse the existing tag `G-Q7F14H0MW7`), header wordmark in the gradient style, footer linking to Telegram and back to umyar.com.

```astro
---
const {
  title = 'umyar — blog',
  description = 'Notes by Umiar Iusupov — in RU, EN, PT.',
  lang = 'en',
} = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site).href;
---

<!doctype html>
<html lang={lang}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#1a1a1a" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <link rel="icon" href="/favicon.ico" />
    <link
      href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700&display=swap"
      rel="stylesheet"
    />
    <slot name="head" />
    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-Q7F14H0MW7"></script>
    <script is:inline>
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag('js', new Date());
      gtag('config', 'G-Q7F14H0MW7');
    </script>
  </head>
  <body>
    <header class="container" style="padding-top:3rem;padding-bottom:1rem;">
      <a href="/" style="text-decoration:none;">
        <strong class="gradient-text" style="font-size:3rem;letter-spacing:-1px;">umyar</strong>
      </a>
    </header>
    <main class="container">
      <slot />
    </main>
    <footer class="container" style="margin:5rem auto;font-size:1.3rem;">
      <a href="https://t.me/umyar">Telegram</a> · <a href="https://umyar.com">umyar.com</a>
    </footer>
    <style>
      @import '../styles/global.css';
    </style>
  </body>
</html>
```

> If the `<style>@import` doesn't resolve in your Astro version, import the CSS in the frontmatter instead (`import '../styles/global.css';`).

## 7. Placeholder homepage — `src/pages/index.astro`

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="umyar — blog" description="Notes by Umiar Iusupov — RU · EN · PT.">
  <h1 class="gradient-text" style="font-size:4rem;letter-spacing:-2px;margin:4rem 0 1rem;">blog</h1>
  <p>Coming soon — posts in Russian, English and Portuguese.</p>
</BaseLayout>
```

## 8. Build, format, commit

```bash
npm run format
npm run build      # must succeed with no errors
git add -A
git commit -m "chore: bootstrap Astro skeleton for blog.umyar.com"
git push -u origin main   # or master — match the repo's default branch
```

## 9. Deploy to Vercel

1. Import the repo in Vercel (framework preset auto-detects **Astro**). Set Node version to **24** (match `.nvmrc`).
2. Add the domain **`blog.umyar.com`** (add the CNAME/record it shows at your DNS provider).
3. Add env vars from `.env.example` as you reach the phases that need them (none required for this skeleton to build).
4. Trigger a deploy; confirm the live URL renders the placeholder.

## 10. Acceptance criteria (bootstrap done)

- `npm run build` is clean; `npm run dev` serves the homepage locally.
- `https://blog.umyar.com` shows the branded placeholder: **Montserrat** font, **gradient** "umyar"/"blog" headings, black-on-white.
- Google Analytics tag present in page source; canonical + theme-color present.
- Repo committed and pushed; Vercel auto-deploys on push.
- Folder skeleton (`src/content/posts`, `src/components`, `src/assets/posts`, etc.) and `.env.example` exist.

## 11. Handoff

Bootstrap complete. **Continue at `BLOG.md` → Phase 1 (Design system)**, then Phases 2–6 (Keystatic content model, SEO/AEO, audio, comments + auth, polish). Follow BLOG.md's per-phase acceptance criteria and its Risks section (especially **R1** — validate Keystatic→Astro body rendering before building routing).
