// One Neon-backed rate limiter for the app's own endpoints (COMMENTS_V2.md §5.2),
// replacing the two ad-hoc "count recent rows" queries that lived in
// api/subscribe/index.ts (counting subscriber rows by IP) and
// api/comments/index.ts (counting comment rows by user).
//
// Why those had to go: counting rows in the table you are about to write to only
// works when the thing being limited *is* a row in that table. It cannot limit a
// request that gets rejected, cannot limit an endpoint that writes nothing
// (/api/avatar), and silently stops working the moment rows are deleted — a
// moderator clearing a spammer's comments would hand them a fresh allowance.
//
// It shares the `rate_limit` table with Better Auth rather than adding a second
// one: identical shape, identical semantics, one cleanup story. Keys here are
// prefixed `app:`; Better Auth's are `${ip}|${path}`, so the namespaces cannot
// collide.

import { sql } from 'drizzle-orm';
import { db } from './db';
import { rateLimit } from './db/schema';

export type RateLimitRule = {
  /** Window length in seconds. */
  window: number;
  /** Requests allowed per window. */
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the bucket frees up. 0 when allowed. */
  retryAfter: number;
};

/**
 * Count one request against `key` and say whether it is allowed.
 *
 * A single atomic INSERT … ON CONFLICT DO UPDATE, so it is correct without a
 * transaction. That matters here: the neon-http driver sends every statement as
 * its own round trip, so the read-then-write shape this replaces had a genuine
 * race — two concurrent requests both read "4 so far" and both proceed.
 *
 * Window semantics match Better Auth's own limiter: `last_request` advances on
 * each counted request, so the window is measured from the last *allowed* one.
 * Blocked attempts still bump `count` but deliberately leave `last_request`
 * alone — otherwise a confused reader hammering the button would keep pushing
 * their own unlock further away and never get back in.
 */
export async function consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = rule.window * 1000;

  // True once the previous window has fully elapsed, in which case this request
  // starts a fresh one.
  const expired = sql`${now}::bigint - ${rateLimit.lastRequest} > ${windowMs}::bigint`;

  const [row] = await db
    .insert(rateLimit)
    .values({
      id: crypto.randomUUID(),
      key: `app:${key}`,
      count: 1,
      lastRequest: now,
    })
    .onConflictDoUpdate({
      target: rateLimit.key,
      // Inside DO UPDATE, a qualified reference to the target table is the row
      // that is already there; `excluded` would be the one we tried to insert.
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case
          when ${expired} then ${now}::bigint
          when ${rateLimit.count} >= ${rule.max} then ${rateLimit.lastRequest}
          else ${now}::bigint end`,
      },
    })
    .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });

  // count === max is the max-th request and is still allowed; only the one past
  // it is refused. Letting count run above max is what makes "allowed" readable
  // from the returned row alone, without needing the pre-update value.
  if (!row || row.count <= rule.max) return { allowed: true, retryAfter: 0 };

  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((row.lastRequest + windowMs - now) / 1000)),
  };
}

/**
 * The caller's IP, or null when it can't be determined. On Vercel
 * `x-forwarded-for` is set by the platform and its first entry is the client;
 * behind no proxy at all this is null and the caller should fall back to a
 * limit that doesn't need an IP rather than to a shared bucket.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim() || null;
  return request.headers.get('x-real-ip');
}

/**
 * A stable, non-reversible bucket id for an email address.
 *
 * Addresses are hashed rather than stored: `rate_limit` would otherwise become a
 * log of every address that ever asked for a code, including addresses with no
 * account and typos of real ones, kept for a completely different lifetime than
 * `user` or `subscriber`. The hash only ever has to match itself.
 */
export async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 429 with a Retry-After header, so a well-behaved client backs off by itself.
 */
export function rateLimitedResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
    },
  });
}
