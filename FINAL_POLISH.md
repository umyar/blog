# blog.umyar.com — Final Polish & Launch

> **For the executing agent.** This is the last stretch before calling `blog.umyar.com` done — carried over from the original `BLOG.md` Phase 6 (that file has since been removed; content moved here since design/content/SEO work is already largely built, and comments/auth now live in [`COMMENTS.md`](COMMENTS.md)). Don't start this until `COMMENTS.md`'s sub-phases are shipped — several items below assume comments/auth exist.

## Tasks

- Error/empty states, loading states, mobile pass (match the site's existing breakpoints).
- 404 page styled on-brand (already exists at `src/pages/404.astro` — re-check it still matches the gradient/Montserrat look after other changes).
- Verify GA events fire: pageviews, plus a `comment_posted` event once `COMMENTS.md` is live.
- Seed 1–2 real posts across all 3 languages with audio + inline images (beyond the existing sample post).
- Final SEO sweep: hreflang, JSON-LD, sitemap, RSS, OG images, canonical — re-verify nothing regressed while building comments/auth.
- README in the repo: how to write a post (Keystatic), how to add audio (paste-a-URL), how comments/moderation work, env vars, deploy.

## Acceptance criteria (Definition of Done)

- All acceptance criteria from prior phases (design system, content model, SEO, audio, comments/auth) pass on production `blog.umyar.com`.
- Lighthouse: SEO 100, Performance ≥ 90, Accessibility ≥ 95 on a real post.
- A non-technical author can publish a trilingual post end-to-end through `/keystatic` without touching code.
- A reader can log in, leave a text-anchored comment, and see it render correctly — without touching code.
