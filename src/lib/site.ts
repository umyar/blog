// Absolute base URL for links that leave the site (emails, mostly).
//
// `PUBLIC_*` variables are substituted at **build** time, not read at runtime.
// So when PUBLIC_SITE_URL is missing from the build environment this whole
// function compiles down to `return undefined`, and every outbound link becomes
// `undefined/api/...` — which mail clients render as `http://undefined/...`.
// That shipped in a real confirmation email, so the fallback below is not
// defensive padding: it is the difference between a working link and a dead one.
//
// Locally we follow the request origin so links work against `astro dev`. In
// production we pin to the canonical host so a preview deployment can't mail out
// preview-domain links — but only when we actually have one. An unset variable
// falls back to the request origin, which on a preview deployment is the "wrong"
// host yet still resolves; a dead link helps nobody.
export function siteUrl(request: Request): string {
  const configured = import.meta.env.PUBLIC_SITE_URL;
  if (!import.meta.env.DEV && configured) return configured;
  if (!import.meta.env.DEV) {
    console.error('PUBLIC_SITE_URL is not set at build time — emailed links fall back to the request origin.');
  }
  return new URL(request.url).origin;
}

/**
 * Canonical base URL for emails, which have no `Request` to fall back to.
 *
 * `sendOtpEmail` referenced `import.meta.env.PUBLIC_SITE_URL` directly and so
 * bypassed `siteUrl()`'s fallback entirely — an unset variable put
 * `undefined/signin` in the *sign-in* email, the one email the whole account
 * system depends on. The literal last resort duplicates `site` in
 * astro.config.mjs on purpose: two places to update is a fair price for never
 * mailing a dead link.
 */
export const canonicalUrl: string = import.meta.env.PUBLIC_SITE_URL || 'https://blog.umyar.com';
