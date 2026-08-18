import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { subscriber } from '../../../lib/db/schema';

export const prerender = false;

// Step 3 of double opt-in: the link from the confirmation email lands here, and
// the row only becomes mailable at this point.
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');
  if (!token) return redirect('/subscribe?state=invalid', 302);

  const [row] = await db.select().from(subscriber).where(eq(subscriber.confirmToken, token));

  // Unknown token, or one belonging to someone who has since unsubscribed —
  // an old confirm link must never quietly resurrect a dead subscription.
  if (!row || row.status === 'unsubscribed') {
    return redirect('/subscribe?state=invalid', 302);
  }

  // The token is kept after confirming so that clicking the link twice (or a
  // mail client prefetching it) shows "you're in" rather than "invalid link".
  if (row.status === 'confirmed') {
    return redirect('/subscribe?state=confirmed', 302);
  }

  if (row.confirmExpiresAt && row.confirmExpiresAt.getTime() < Date.now()) {
    return redirect('/subscribe?state=expired', 302);
  }

  await db
    .update(subscriber)
    .set({ status: 'confirmed', confirmedAt: new Date() })
    .where(eq(subscriber.id, row.id));

  return redirect('/subscribe?state=confirmed', 302);
};
