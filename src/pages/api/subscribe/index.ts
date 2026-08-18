import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { subscriber } from '../../../lib/db/schema';
import { sendSubscribeConfirmEmail } from '../../../lib/email';
import { createToken } from '../../../lib/tokens';
import { siteUrl } from '../../../lib/site';
import { isValidEmail, normalizeEmail } from '../../../lib/email-address';
import { clientIp, consume, rateLimitedResponse } from '../../../lib/rate-limit';
import { isBotSubmission } from '../../../lib/honeypot';

export const prerender = false;

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
// Re-submitting an address that's already pending only re-sends the confirmation
// this often, so the endpoint can't be used to mailbomb someone.
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';

  if (!isValidEmail(email)) {
    return json({ error: 'invalid_email' }, 400);
  }

  // Same 400 as a malformed address: a script that trips this learns only that
  // its input was rejected, not which of the two checks caught it.
  if (isBotSubmission(body)) {
    return json({ error: 'invalid_email' }, 400);
  }

  const ip = clientIp(request);
  if (ip) {
    // Was a count of subscriber rows created by this IP in the last hour, which
    // stopped limiting anything the moment a row was deleted — and never
    // limited the requests that were rejected before insert.
    const { allowed, retryAfter } = await consume(`subscribe:ip:${ip}`, {
      window: 3600,
      max: 5,
    });
    if (!allowed) return rateLimitedResponse(retryAfter);
  }

  const [existing] = await db.select().from(subscriber).where(eq(subscriber.email, email));

  // Every path below answers with the same 200. Telling the caller "already
  // subscribed" would turn this endpoint into a way to test whether a given
  // address reads this blog.
  const ok = json({ ok: true }, 200);

  if (existing?.status === 'confirmed') {
    return ok;
  }

  // Still pending and we mailed them recently — don't send again, but don't
  // reveal that either.
  if (
    existing?.status === 'pending' &&
    existing.confirmSentAt &&
    Date.now() - existing.confirmSentAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    return ok;
  }

  const confirmToken = createToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONFIRM_TTL_MS);

  if (existing) {
    // Covers both a stale 'pending' row and a previously 'unsubscribed' one
    // coming back — either way they have to prove the address again.
    await db
      .update(subscriber)
      .set({
        status: 'pending',
        confirmToken,
        confirmExpiresAt: expiresAt,
        confirmSentAt: now,
        signupIp: ip,
      })
      .where(eq(subscriber.id, existing.id));
  } else {
    await db.insert(subscriber).values({
      id: crypto.randomUUID(),
      email,
      status: 'pending',
      confirmToken,
      confirmExpiresAt: expiresAt,
      confirmSentAt: now,
      unsubscribeToken: createToken(),
      signupIp: ip,
      // Without this the column is never populated from the footer form at all
      // (COMMENTS_V2.md §9.3).
      source: 'footer',
    });
  }

  const url = `${siteUrl(request)}/api/subscribe/confirm?token=${encodeURIComponent(confirmToken)}`;

  try {
    await sendSubscribeConfirmEmail(email, url);
  } catch {
    // The row stays 'pending' with an unused token, so retrying after the
    // cooldown picks up cleanly.
    return json({ error: 'send_failed' }, 502);
  }

  return ok;
};
