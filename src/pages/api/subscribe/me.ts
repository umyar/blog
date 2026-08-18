import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { auth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { subscriber } from '../../../lib/db/schema';
import { normalizeEmail } from '../../../lib/email-address';
import { createToken } from '../../../lib/tokens';
import { clientIp, consume, rateLimitedResponse } from '../../../lib/rate-limit';

export const prerender = false;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The signed-in reader's *own* subscription state (COMMENTS_V2.md §9).
 *
 * Session-gated on both verbs, and it only ever touches the address on the
 * session — never one supplied in the payload. That is what keeps it from
 * becoming the enumeration oracle `/api/subscribe` deliberately isn't (§5.5):
 * you can only ask about, or subscribe, an address you have just proven you
 * control.
 */
export const GET: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: 'unauthenticated' }, 401);

  const email = normalizeEmail(session.user.email);
  const [row] = await db.select().from(subscriber).where(eq(subscriber.email, email));

  return json({ subscribed: row?.status === 'confirmed' }, 200);
};

export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: 'unauthenticated' }, 401);

  const limit = await consume(`subscribe:signin:${session.user.id}`, { window: 3600, max: 10 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);

  const email = normalizeEmail(session.user.email);
  const [existing] = await db.select().from(subscriber).where(eq(subscriber.email, email));

  // §9.4: an existing confirmed row is left exactly as it is. Rewriting it would
  // move confirmedAt and mint a new unsubscribe token, invalidating the link in
  // every email already sitting in their inbox.
  if (existing?.status === 'confirmed') {
    return json({ status: 'already' }, 200);
  }

  const now = new Date();

  // No confirmation email, deliberately (§9.2). The reader retrieved a code from
  // this inbox seconds ago, which is stronger proof of control than clicking a
  // link — so the double opt-in requirement is already met, by a better means.
  // The confirm token is cleared for the same reason: there is nothing to confirm.
  if (existing) {
    // Covers a stale 'pending' row and an 'unsubscribed' one coming back. The
    // latter is a resubscribe, which is legitimate precisely because ticking the
    // box is an explicit act — this endpoint is never called for an empty box.
    await db
      .update(subscriber)
      .set({
        status: 'confirmed',
        confirmedAt: now,
        confirmToken: null,
        confirmExpiresAt: null,
        unsubscribedAt: null,
        unsubscribeToken: createToken(),
        signupIp: clientIp(request),
        source: 'signin',
      })
      .where(eq(subscriber.id, existing.id));
  } else {
    await db.insert(subscriber).values({
      id: crypto.randomUUID(),
      email,
      status: 'confirmed',
      confirmedAt: now,
      unsubscribeToken: createToken(),
      signupIp: clientIp(request),
      source: 'signin',
    });
  }

  return json({ status: 'confirmed' }, 200);
};
