import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { auth } from '../../lib/auth';
import { db } from '../../lib/db';
import { user } from '../../lib/db/schema';
import { isValidHttpUrl } from '../../lib/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
  const avatarUrl = typeof body?.avatarUrl === 'string' ? body.avatarUrl.trim() : '';

  if (!firstName || firstName.length > 60 || !lastName || lastName.length > 60) {
    return new Response(JSON.stringify({ error: 'invalid_name' }), { status: 400 });
  }
  if (!avatarUrl || !isValidHttpUrl(avatarUrl)) {
    return new Response(JSON.stringify({ error: 'invalid_avatar_url' }), { status: 400 });
  }

  await db
    .update(user)
    .set({ firstName, lastName, avatarUrl, profileComplete: true })
    .where(eq(user.id, session.user.id));

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
