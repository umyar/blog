// Absolute base URL for links that leave the site (emails, mostly).
// Mirrors the DEV check in lib/auth.ts: locally we follow the request origin so
// confirm links work against `astro dev`, in production we pin to the canonical
// host so a Vercel preview deployment can't mail out preview-domain links.
export function siteUrl(request: Request): string {
  if (import.meta.env.DEV) return new URL(request.url).origin;
  return import.meta.env.PUBLIC_SITE_URL;
}
