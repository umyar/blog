import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { subscriber } from '../../lib/db/schema';

export const prerender = false;

async function unsubscribe(token: string): Promise<boolean> {
  const [row] = await db.select().from(subscriber).where(eq(subscriber.unsubscribeToken, token));
  if (!row) return false;
  if (row.status === 'unsubscribed') return true; // idempotent

  await db
    .update(subscriber)
    .set({
      status: 'unsubscribed',
      unsubscribedAt: new Date(),
      // Kill any outstanding confirm link too, so the old email in their inbox
      // can't put them back on the list.
      confirmToken: null,
      confirmExpiresAt: null,
    })
    .where(eq(subscriber.id, row.id));

  return true;
}

// RFC 8058 one-click. Mail clients POST this URL straight from the
// List-Unsubscribe header, with no page ever being rendered.
export const POST: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token || !(await unsubscribe(token))) {
    return new Response('Unknown or already-removed address.', { status: 404 });
  }
  return new Response('Unsubscribed.', { status: 200 });
};

// A GET here is either someone poking the URL by hand or a link-scanning proxy
// following it. It deliberately does NOT unsubscribe — it hands off to the page
// with a confirm button, so a prefetch can't drop someone off the list.
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');
  if (!token) return redirect('/subscribe?state=invalid', 302);
  return redirect(`/unsubscribe?token=${encodeURIComponent(token)}`, 302);
};
